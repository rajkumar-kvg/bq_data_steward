from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional, Tuple
from pydantic import BaseModel
import urllib.request
import urllib.error
import json
import re

import models
import schemas
import bigquery_utils
from database import engine, get_db, Base


# ── Cube.js runtime compile checker ──────────────────────────────────────────

def _compile_check_via_cube(conn_id: int) -> Tuple[bool, str]:
    """
    Asks the Cube.js runtime to compile all current models by hitting /meta.
    Returns (is_ok, error_message).
    The error_message is the raw compile error string from Cube.js, or "" if clean.
    """
    req = urllib.request.Request(
        "http://cube:4000/cubejs-api/v1/meta",
        headers={
            "Authorization": "Bearer bq_steward_secret_key",
            "x-cube-conn-id": str(conn_id),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode())
            # Cube returns 200 even on compile errors — check for error key
            if "error" in body:
                return False, body["error"]
            return True, ""
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            body = json.loads(raw)
            return False, body.get("error", raw)
        except Exception:
            return False, raw
    except Exception as e:
        return False, str(e)


def _extract_cube_error_for(cube_name: str, full_error: str) -> str:
    """
    Cube.js compile errors list all broken cubes together.
    Extract only the lines relevant to cube_name so the LLM gets focused context.
    Falls back to the full error if nothing matches.
    """
    lines = full_error.splitlines()
    relevant, in_block = [], False
    for line in lines:
        if f"{cube_name} cube:" in line or f"`{cube_name}`" in line:
            in_block = True
        if in_block:
            relevant.append(line)
            # Stop at next cube's error block or end of Possible reasons section
            if relevant and line.strip() == "" and len(relevant) > 2:
                break
    return "\n".join(relevant) if relevant else full_error

def _parse_cube_model_schema(cube_model_js: str) -> dict:
    """
    Extract cube name, measures, and dimensions from a Cube.js JS model string.
    Returns:
        {
          "cube_name": str | None,
          "measures": [{"key": str, "type": str}, ...],
          "dimensions": [{"key": str, "type": str}, ...]
        }
    Mirrors the brace-counting approach in KPIDashboard.jsx:parseMeasuresFromModel().
    """
    if not cube_model_js:
        return {"cube_name": None, "measures": [], "dimensions": []}

    name_match = re.search(r"cube\s*\(\s*[`'\"](\w[\w-]*)[`'\"]", cube_model_js)
    cube_name = name_match.group(1) if name_match else None

    def _extract_block_members(js: str, block_keyword: str) -> list:
        members = []
        block_start = re.search(rf"\b{block_keyword}\s*:\s*\{{", js)
        if not block_start:
            return members

        open_pos = js.index("{", block_start.start())
        depth, i, block_chars = 0, open_pos, []
        while i < len(js):
            ch = js[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            block_chars.append(ch)
            i += 1
        block_content = "".join(block_chars[1:])  # strip leading {

        current_depth = 0
        current_member_name = None
        current_member_lines: list = []

        for line in block_content.split("\n"):
            stripped = line.strip()
            if not stripped:
                continue

            if current_depth == 0:
                key_match = re.match(r"^(\w+)\s*:\s*\{", stripped)
                if key_match:
                    current_member_name = key_match.group(1)
                    current_member_lines = [stripped]
            elif current_member_name:
                current_member_lines.append(stripped)

            for ch in stripped:
                if ch == "{":
                    current_depth += 1
                elif ch == "}":
                    current_depth -= 1
                    if current_depth == 0 and current_member_name:
                        member_text = " ".join(current_member_lines)
                        type_match = re.search(r"type\s*:\s*[`'\"](\w+)[`'\"]", member_text)
                        members.append({
                            "key": current_member_name,
                            "type": type_match.group(1) if type_match else "unknown",
                        })
                        current_member_name = None
                        current_member_lines = []

        return members

    return {
        "cube_name": cube_name,
        "measures": _extract_block_members(cube_model_js, "measures"),
        "dimensions": _extract_block_members(cube_model_js, "dimensions"),
    }


def _execute_cube_query(conn_id: int, query: dict) -> dict:
    """
    Execute a Cube REST API query against the Cube.js runtime.
    Returns the parsed JSON response body.
    Raises HTTPException on network or Cube errors.
    """
    payload = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(
        "http://cube:4000/cubejs-api/v1/load",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer bq_steward_secret_key",
            "x-cube-conn-id": str(conn_id),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            if "error" in body:
                raise HTTPException(
                    status_code=422,
                    detail=f"Cube.js query error: {body['error']}",
                )
            return body
    except HTTPException:
        raise
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            body = json.loads(raw)
            raise HTTPException(
                status_code=422,
                detail=f"Cube.js error: {body.get('error', raw)}",
            )
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=422, detail=f"Cube.js HTTP error: {raw[:500]}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cannot reach Cube.js: {str(e)}")


# Create tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="BigQuery Connection Manager",
    description="Manage BigQuery connections via service account JSON",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Connections ───────────────────────────────────────────────────────────────

@app.post("/connections", response_model=schemas.ConnectionOut, status_code=201)
def create_connection(payload: schemas.ConnectionCreate, db: Session = Depends(get_db)):
    """Save a new BigQuery connection."""
    creds = payload.credentials
    if creds.get("type") != "service_account":
        raise HTTPException(status_code=400, detail="JSON must be a service account key file.")
    project_id = creds.get("project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="'project_id' not found in credentials.")

    conn = models.Connection(
        name=payload.name,
        project_id=project_id,
        credentials=creds,
        business_definition=payload.business_definition,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn


@app.get("/connections", response_model=List[schemas.ConnectionOut])
def list_connections(db: Session = Depends(get_db)):
    """List all saved connections."""
    return db.query(models.Connection).order_by(models.Connection.created_at.desc()).all()


@app.delete("/connections/{conn_id}", status_code=204)
def delete_connection(conn_id: int, db: Session = Depends(get_db)):
    """Delete a connection."""
    conn = db.query(models.Connection).filter(models.Connection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    db.delete(conn)
    db.commit()


class DefinitionUpdate(BaseModel):
    business_definition: Optional[str] = None


@app.patch("/connections/{conn_id}/definition", response_model=schemas.ConnectionOut)
def update_definition(conn_id: int, payload: DefinitionUpdate, db: Session = Depends(get_db)):
    """Update the business definition for a connection."""
    conn = _get_connection_or_404(conn_id, db)
    conn.business_definition = payload.business_definition
    db.commit()
    db.refresh(conn)
    return conn


# ── Test / Datasets / Tables ──────────────────────────────────────────────────

def _get_connection_or_404(conn_id: int, db: Session) -> models.Connection:
    conn = db.query(models.Connection).filter(models.Connection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    return conn


@app.post("/connections/{conn_id}/test", response_model=schemas.TestResult)
def test_connection(conn_id: int, db: Session = Depends(get_db)):
    """Test a BigQuery connection."""
    conn = _get_connection_or_404(conn_id, db)
    result = bigquery_utils.test_connection(conn.credentials)
    return result


@app.get("/connections/latest/credentials", include_in_schema=False)
def get_latest_credentials_internal(db: Session = Depends(get_db)):
    """Internal endpoint for Cube to fetch the most recent credentials."""
    conn = db.query(models.Connection).order_by(models.Connection.id.desc()).first()
    if not conn:
        raise HTTPException(status_code=404, detail="No connections found.")
    return {"project_id": conn.project_id, "credentials": conn.credentials}


@app.get("/connections/{conn_id}/credentials", include_in_schema=False)
def get_credentials_internal(conn_id: int, db: Session = Depends(get_db)):
    """Internal endpoint for Cube to fetch specific credentials."""
    conn = _get_connection_or_404(conn_id, db)
    return {"project_id": conn.project_id, "credentials": conn.credentials}


@app.get("/connections/latest/cube-models/internal", include_in_schema=False)
def get_latest_cube_models_internal(db: Session = Depends(get_db)):
    """Internal endpoint for Cube to fetch generated models."""
    conn = db.query(models.Connection).order_by(models.Connection.id.desc()).first()
    if not conn:
        raise HTTPException(status_code=404, detail="No connections found.")
    
    table_metas = db.query(models.TableMeta).filter(
        models.TableMeta.connection_id == conn.id,
        models.TableMeta.cube_model != None
    ).all()
    
    result = []
    for meta in table_metas:
        if meta.cube_model:
            file_name = f"{meta.dataset_id}_{meta.table_id}.js"
            result.append({"fileName": file_name, "content": meta.cube_model})
    return result


@app.get("/connections/{conn_id}/cube-models/internal", include_in_schema=False)
def get_cube_models_internal(conn_id: int, db: Session = Depends(get_db)):
    """Internal endpoint for Cube to fetch generated models."""
    _get_connection_or_404(conn_id, db)
    table_metas = db.query(models.TableMeta).filter(
        models.TableMeta.connection_id == conn_id,
        models.TableMeta.cube_model != None
    ).all()
    
    result = []
    for meta in table_metas:
        if meta.cube_model:
            file_name = f"{meta.dataset_id}_{meta.table_id}.js"
            result.append({"fileName": file_name, "content": meta.cube_model})
    return result


@app.post("/connections/{conn_id}/test-cube", response_model=schemas.TestResult)
def test_cube_connection(conn_id: int, db: Session = Depends(get_db)):
    """Test the Cube connection by hitting the Cube meta API."""
    import urllib.request
    import urllib.error
    
    _get_connection_or_404(conn_id, db)
    
    req = urllib.request.Request(
        "http://cube:4000/cubejs-api/v1/meta",
        headers={
            "x-cube-conn-id": str(conn_id),
            "Authorization": "bq_steward_secret_key"
        }
    )
    
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                return {"success": True, "message": "Successfully communicated with Cube service."}
            else:
                return {"success": False, "message": f"Cube returned status {response.status}"}
    except urllib.error.HTTPError as e:
        return {"success": False, "message": f"Cube error: {e.code} {e.reason}"}
    except Exception as e:
        return {"success": False, "message": f"Failed to connect to Cube: {str(e)}"}


@app.get("/connections/{conn_id}/datasets", response_model=List[schemas.DatasetOut])
def get_datasets(conn_id: int, db: Session = Depends(get_db)):
    """List datasets for a connection."""
    _get_connection_or_404(conn_id, db)
    datasets = db.query(models.DatasetMeta).filter_by(connection_id=conn_id).all()
    return datasets


@app.post("/connections/{conn_id}/datasets/sync", response_model=List[schemas.DatasetOut])
def sync_datasets(conn_id: int, db: Session = Depends(get_db)):
    """Fetch fresh datasets from BigQuery and store in DB."""
    conn = _get_connection_or_404(conn_id, db)
    try:
        bq_datasets = bigquery_utils.list_datasets(conn.credentials)
        for bq_ds in bq_datasets:
            db_ds = db.query(models.DatasetMeta).filter_by(connection_id=conn_id, dataset_id=bq_ds["dataset_id"]).first()
            if db_ds:
                db_ds.full_name = bq_ds.get("full_name", bq_ds["dataset_id"])
                db_ds.location = bq_ds.get("location")
            else:
                db_ds = models.DatasetMeta(
                    connection_id=conn_id,
                    dataset_id=bq_ds["dataset_id"],
                    full_name=bq_ds.get("full_name", bq_ds["dataset_id"]),
                    location=bq_ds.get("location")
                )
                db.add(db_ds)
        db.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return db.query(models.DatasetMeta).filter_by(connection_id=conn_id).all()


@app.get(
    "/connections/{conn_id}/datasets/{dataset_id}/tables",
    response_model=List[schemas.TableOut],
)
def get_tables(conn_id: int, dataset_id: str, db: Session = Depends(get_db)):
    """List tables in a dataset."""
    conn = _get_connection_or_404(conn_id, db)
    try:
        tables = bigquery_utils.list_tables(conn.credentials, dataset_id)
        return tables
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/connections/{conn_id}/models", response_model=List[schemas.TableMetaOut])
def get_connection_models(conn_id: int, db: Session = Depends(get_db)):
    """Return all table metadata that have cube models."""
    _get_connection_or_404(conn_id, db)
    return db.query(models.TableMeta).filter(
        models.TableMeta.connection_id == conn_id,
        models.TableMeta.cube_model != None
    ).all()


@app.get("/health")
def health():
    return {"status": "ok"}


# ── Table Metadata ────────────────────────────────────────────────────────────

def _get_or_create_table_meta(
    conn_id: int, dataset_id: str, table_id: str, db: Session
) -> models.TableMeta:
    row = (
        db.query(models.TableMeta)
        .filter_by(connection_id=conn_id, dataset_id=dataset_id, table_id=table_id)
        .first()
    )
    if not row:
        row = models.TableMeta(
            connection_id=conn_id,
            dataset_id=dataset_id,
            table_id=table_id,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@app.get(
    "/connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta",
    response_model=schemas.TableMetaOut,
)
def get_table_meta(conn_id: int, dataset_id: str, table_id: str, db: Session = Depends(get_db)):
    """Return stored metadata for a table, creating an empty record if needed."""
    _get_connection_or_404(conn_id, db)
    row = _get_or_create_table_meta(conn_id, dataset_id, table_id, db)
    return row


class TableDefinitionUpdate(BaseModel):
    definition: Optional[str] = None


@app.put(
    "/connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta",
    response_model=schemas.TableMetaOut,
)
def upsert_table_definition(
    conn_id: int,
    dataset_id: str,
    table_id: str,
    payload: TableDefinitionUpdate,
    db: Session = Depends(get_db),
):
    """Save / update the business definition for a table."""
    _get_connection_or_404(conn_id, db)
    row = _get_or_create_table_meta(conn_id, dataset_id, table_id, db)
    row.definition = payload.definition
    db.commit()
    db.refresh(row)
    return row


@app.post(
    "/connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta/sync-schema",
    response_model=schemas.TableMetaOut,
)
def sync_table_schema(
    conn_id: int,
    dataset_id: str,
    table_id: str,
    db: Session = Depends(get_db),
):
    """Pull schema from BigQuery and cache it in Postgres."""
    from datetime import datetime, timezone

    conn = _get_connection_or_404(conn_id, db)
    try:
        schema_data = bigquery_utils.get_table_schema(conn.credentials, dataset_id, table_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    row = _get_or_create_table_meta(conn_id, dataset_id, table_id, db)
    row.bq_schema = schema_data
    row.schema_synced_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


@app.post(
    "/connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta/generate-columns",
    response_model=schemas.TableMetaOut,
)
def generate_columns(
    conn_id: int,
    dataset_id: str,
    table_id: str,
    db: Session = Depends(get_db),
):
    """Use AI to generate column definitions."""
    import llm_utils
    
    conn = _get_connection_or_404(conn_id, db)
    row = _get_or_create_table_meta(conn_id, dataset_id, table_id, db)
    
    if not row.bq_schema or not row.bq_schema.get("fields"):
        raise HTTPException(status_code=400, detail="Cannot generate column definitions without a synced schema.")
        
    try:
        new_defs = llm_utils.generate_column_definitions(
            business_def=conn.business_definition,
            table_def=row.definition,
            schema_fields=row.bq_schema["fields"]
        )
        print("NEW DEFS from LLM:", new_defs)
        
        import copy
        schema_data = copy.deepcopy(row.bq_schema)
        fields = schema_data.get("fields", [])
        
        def_map = {item.get("name"): item.get("ai_description") for item in new_defs if item.get("name")}
        
        for f in fields:
            f_name = f.get("name")
            if f_name in def_map and def_map[f_name]:
                f["ai_description"] = def_map[f_name]
                
        schema_data["fields"] = fields
        row.bq_schema = schema_data
        
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(row, "bq_schema")
        
        db.commit()
        db.refresh(row)
        return row
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ColumnAiDefinitionUpdate(BaseModel):
    ai_description: Optional[str] = None


@app.put(
    "/connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta/columns/{column_name}",
    response_model=schemas.TableMetaOut,
)
def update_column_ai_definition(
    conn_id: int,
    dataset_id: str,
    table_id: str,
    column_name: str,
    payload: ColumnAiDefinitionUpdate,
    db: Session = Depends(get_db),
):
    """Save / update the ai_description for a specific table column."""
    _get_connection_or_404(conn_id, db)
    row = _get_or_create_table_meta(conn_id, dataset_id, table_id, db)
    
    if not row.bq_schema or not row.bq_schema.get("fields"):
        raise HTTPException(status_code=400, detail="Cannot edit column definition without a synced schema.")
        
    import copy
    from sqlalchemy.orm.attributes import flag_modified
    
    schema_data = copy.deepcopy(row.bq_schema)
    fields = schema_data.get("fields", [])
    
    found = False
    for f in fields:
        if f.get("name") == column_name:
            if payload.ai_description:
                f["ai_description"] = payload.ai_description
            else:
                f.pop("ai_description", None)
            found = True
            break
            
    if not found:
        raise HTTPException(status_code=404, detail=f"Column '{column_name}' not found in schema.")
        
    schema_data["fields"] = fields
    row.bq_schema = schema_data
    flag_modified(row, "bq_schema")
    
    db.commit()
    db.refresh(row)
    return row

@app.post(
    "/connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta/generate-metrics",
    response_model=schemas.TableMetaOut,
)
def generate_table_metrics_endpoint(
    conn_id: int,
    dataset_id: str,
    table_id: str,
    db: Session = Depends(get_db),
):
    """Use AI to generate table metrics recommendations."""
    import llm_utils
    
    conn = _get_connection_or_404(conn_id, db)
    row = _get_or_create_table_meta(conn_id, dataset_id, table_id, db)
    
    if not row.bq_schema or not row.bq_schema.get("fields"):
        raise HTTPException(status_code=400, detail="Cannot generate metrics without a synced schema.")
        
    try:
        new_metrics = llm_utils.generate_table_metrics(
            business_def=conn.business_definition,
            table_def=row.definition,
            schema_fields=row.bq_schema["fields"]
        )
        print("NEW METRICS from LLM:", new_metrics)
        
        row.metrics = new_metrics
        db.commit()
        db.refresh(row)
        return row
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put(
    "/connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta/metrics",
    response_model=schemas.TableMetaOut,
)
def update_table_metrics(
    conn_id: int,
    dataset_id: str,
    table_id: str,
    payload: schemas.MetricsUpdate,
    db: Session = Depends(get_db),
):
    """Update manually modified metrics or new metrics."""
    _get_connection_or_404(conn_id, db)
    row = _get_or_create_table_meta(conn_id, dataset_id, table_id, db)
    
    row.metrics = [m.model_dump() for m in payload.metrics]
    
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(row, "metrics")
    
    db.commit()
    db.refresh(row)
    return row

_MAX_FIX_ATTEMPTS = 3


def _normalise_table_ref(model_js: str, raw_full_table_ref: str) -> str:
    """Replace the cube-level sql/sql_table with the correct BQ SELECT form."""
    measures_pos = min(
        p for p in [
            model_js.find("measures:"),
            model_js.find("dimensions:"),
            len(model_js),
        ] if p != -1
    )
    header = model_js[:measures_pos]
    rest   = model_js[measures_pos:]

    replacement = f"sql: `SELECT * FROM \\`{raw_full_table_ref}\\``"
    new_header = re.sub(
        r"(sql_table|sql)\s*:\s*`(?:[^`\\]|\\.)*`",
        replacement,
        header,
        count=1,
    )
    if new_header == header and not re.search(r"(sql_table|sql)\s*:", header):
        new_header = re.sub(
            r"(cube\s*\(\s*`[^`]+`\s*,\s*\{)",
            rf"\1\n  sql: `SELECT * FROM \\`{raw_full_table_ref}\\``,",
            header,
            count=1,
        )
    return new_header + rest


@app.post(
    "/connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta/generate-cube-model",
    response_model=schemas.CubeModelGenerateOut,
)
def generate_table_cube_model(
    conn_id: int,
    dataset_id: str,
    table_id: str,
    db: Session = Depends(get_db),
):
    """
    Generate a Cube.js model via LLM, then validate it against the live Cube.js
    runtime.  If compilation fails the error is fed back to the LLM for repair,
    up to _MAX_FIX_ATTEMPTS times.  The model is only kept if it compiles cleanly.
    """
    import llm_utils

    conn = _get_connection_or_404(conn_id, db)
    row  = _get_or_create_table_meta(conn_id, dataset_id, table_id, db)

    if not row.bq_schema or not row.bq_schema.get("fields"):
        raise HTTPException(status_code=400, detail="Cannot generate cube model without a synced schema.")

    metrics    = row.metrics or []
    project_id = conn.credentials.get("project_id", conn.project_id)
    raw_full_table_ref = f"{project_id}.{dataset_id}.{table_id}"
    cube_name  = re.sub(r'[^a-zA-Z0-9_]', '_', table_id)
    if cube_name and cube_name[0].isdigit():
        cube_name = "_" + cube_name

    # Remember the previous cube_model so we can roll back if all attempts fail
    previous_model = row.cube_model

    def _prepare(model_js: str) -> str:
        """Apply sanitize + table-ref normalisation."""
        model_js = llm_utils.sanitize_cube_model(model_js)
        model_js = _normalise_table_ref(model_js, raw_full_table_ref)
        return model_js

    def _persist(model_js: str) -> None:
        row.cube_model = model_js
        db.commit()

    try:
        # ── Step 1: initial LLM generation ───────────────────────────────────
        print(f"[cube-gen] Generating model for {table_id} …")
        candidate = llm_utils.generate_cube_model(
            table_id=table_id,
            dataset_id=dataset_id,
            project_id=project_id,
            schema_fields=row.bq_schema["fields"],
            metrics=metrics,
        )
        candidate = _prepare(candidate)

        # ── Step 2: static QC (fast, no network) ─────────────────────────────
        issues, is_valid = llm_utils.validate_cube_model(candidate, expected_table_ref=raw_full_table_ref)
        if not is_valid:
            static_errors = "; ".join(i.message for i in issues if i.severity == "error")
            print(f"[cube-gen] Static QC failed: {static_errors}")
            # Feed static errors back to LLM as attempt 0 before touching Cube
            candidate = llm_utils.fix_cube_model_with_error(candidate, static_errors, cube_name)
            candidate = _prepare(candidate)

        # ── Step 3: Cube.js runtime compile-and-fix loop ──────────────────────
        attempt = 0
        compile_ok, cube_error = False, ""
        while attempt <= _MAX_FIX_ATTEMPTS:
            _persist(candidate)
            compile_ok, cube_error = _compile_check_via_cube(conn_id)

            if compile_ok:
                print(f"[cube-gen] Cube compile OK on attempt {attempt}")
                break

            attempt += 1
            if attempt > _MAX_FIX_ATTEMPTS:
                break

            focused_error = _extract_cube_error_for(cube_name, cube_error)
            print(f"[cube-gen] Cube compile error (attempt {attempt}): {focused_error[:200]}")

            candidate = llm_utils.fix_cube_model_with_error(candidate, focused_error, cube_name)
            candidate = _prepare(candidate)

        if not compile_ok:
            # Roll back — restore the previous model (or NULL) so we don't leave
            # a broken model in the DB that would poison all other cubes.
            row.cube_model = previous_model
            db.commit()
            raise HTTPException(
                status_code=422,
                detail={
                    "message": f"Model still fails Cube.js compilation after {_MAX_FIX_ATTEMPTS} fix attempts. Not saved.",
                    "cube_error": _extract_cube_error_for(cube_name, cube_error),
                },
            )

        # ── Step 4: collect non-blocking warnings ─────────────────────────────
        issues_final, _ = llm_utils.validate_cube_model(candidate, expected_table_ref=raw_full_table_ref)
        warning_msgs = [i.message for i in issues_final if i.severity == "warning"]
        if warning_msgs:
            print(f"[cube-gen] Warnings for {table_id}: {warning_msgs}")

        db.refresh(row)
        out = schemas.CubeModelGenerateOut.model_validate(row)
        out.cube_model_warnings = warning_msgs
        return out

    except HTTPException:
        raise
    except Exception as e:
        row.cube_model = previous_model
        db.commit()
        raise HTTPException(status_code=500, detail=str(e))

@app.put(
    "/connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta/cube-model",
    response_model=schemas.TableMetaOut,
)
def update_table_cube_model(
    conn_id: int,
    dataset_id: str,
    table_id: str,
    payload: schemas.CubeModelUpdate,
    db: Session = Depends(get_db),
):
    """Update manually modified cube model."""
    _get_connection_or_404(conn_id, db)
    row = _get_or_create_table_meta(conn_id, dataset_id, table_id, db)
    
    row.cube_model = payload.cube_model

    db.commit()
    db.refresh(row)
    return row


# ── Chat endpoint ─────────────────────────────────────────────────────────────

@app.post("/connections/{conn_id}/chat", response_model=schemas.ChatResponse)
def chat_query(
    conn_id: int,
    payload: schemas.ChatRequest,
    db: Session = Depends(get_db),
):
    """
    Two-pass LLM chatbot for querying Cube models in natural language.

    Pass 1 (temp=0.1): natural language → Cube REST API query JSON
    Pass 2 (temp=0.3): Cube result data → natural language answer
    """
    import llm_utils

    _get_connection_or_404(conn_id, db)

    # Load all table metas with a generated Cube model for this connection
    table_metas = (
        db.query(models.TableMeta)
        .filter(
            models.TableMeta.connection_id == conn_id,
            models.TableMeta.cube_model.isnot(None),
        )
        .all()
    )

    if not table_metas:
        raise HTTPException(
            status_code=400,
            detail="No Cube models found for this connection. Generate Cube models for your tables first.",
        )

    # Build schema context string for the LLM prompt
    schema_parts = []
    for meta in table_metas:
        parsed = _parse_cube_model_schema(meta.cube_model)
        if not parsed["cube_name"]:
            continue
        cube_name = parsed["cube_name"]
        lines = [f"Cube: {cube_name}"]

        if parsed["measures"]:
            lines.append("  Measures:")
            for m in parsed["measures"]:
                lines.append(f"    - {cube_name}.{m['key']} (type: {m['type']})")

        if parsed["dimensions"]:
            lines.append("  Dimensions:")
            for d in parsed["dimensions"]:
                lines.append(f"    - {cube_name}.{d['key']} (type: {d['type']})")

        # Include human-readable metric definitions for extra context
        if meta.metrics:
            lines.append("  Business Metrics (descriptions only, not queryable members):")
            for metric in (meta.metrics or [])[:10]:
                name = metric.get("name", "")
                defn = metric.get("definition", "")
                if name:
                    lines.append(f"    - {name}: {defn}")

        schema_parts.append("\n".join(lines))

    schema_context = "\n\n".join(schema_parts)
    history = [{"role": m.role, "content": m.content} for m in payload.history]

    # ── Pass 1: generate Cube query ───────────────────────────────────────────
    try:
        cube_query = llm_utils.generate_cube_query(
            question=payload.message,
            schema_context=schema_context,
            history=history,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query generation failed: {str(e)}")

    # LLM signals the question cannot be answered with the available schema
    if "error" in cube_query and len(cube_query) == 1:
        return schemas.ChatResponse(
            answer=f"I cannot answer that with the available data. {cube_query['error']}",
            error=cube_query["error"],
        )

    # ── Execute Cube query ────────────────────────────────────────────────────
    cube_result = _execute_cube_query(conn_id, cube_query)

    # ── Pass 2: generate natural language answer ──────────────────────────────
    try:
        answer = llm_utils.generate_chat_answer(
            question=payload.message,
            cube_query=cube_query,
            cube_result=cube_result,
            history=history,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Answer generation failed: {str(e)}")

    return schemas.ChatResponse(
        answer=answer,
        cube_query=cube_query,
        cube_result=cube_result,
    )
