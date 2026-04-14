from google.oauth2 import service_account
from google.cloud import bigquery
from typing import Any, Dict, List


def get_bq_client(credentials_dict: Dict[str, Any]) -> bigquery.Client:
    """Create an authenticated BigQuery client from a service account dict."""
    credentials = service_account.Credentials.from_service_account_info(
        credentials_dict,
        scopes=["https://www.googleapis.com/auth/bigquery.readonly"],
    )
    return bigquery.Client(
        credentials=credentials,
        project=credentials_dict.get("project_id"),
    )


def test_connection(credentials_dict: Dict[str, Any]) -> dict:
    """Test BQ connection by listing datasets (lightweight auth check)."""
    try:
        client = get_bq_client(credentials_dict)
        # Try a minimal API call to verify credentials work
        next(iter(client.list_datasets(max_results=1)), None)
        return {"success": True, "message": "Connection successful!"}
    except Exception as e:
        return {"success": False, "message": str(e)}


def list_datasets(credentials_dict: Dict[str, Any]) -> List[dict]:
    """List all datasets in the project."""
    client = get_bq_client(credentials_dict)
    datasets = client.list_datasets()
    result = []
    for ds in datasets:
        ds_ref = client.get_dataset(ds.reference)
        result.append({
            "dataset_id": ds.dataset_id,
            "full_name": ds.full_dataset_id,
            "location": ds_ref.location,
        })
    return result


def list_tables(credentials_dict: Dict[str, Any], dataset_id: str) -> List[dict]:
    """List all tables in a given dataset."""
    client = get_bq_client(credentials_dict)
    project_id = credentials_dict.get("project_id")
    tables = client.list_tables(f"{project_id}.{dataset_id}")
    result = []
    for tbl in tables:
        result.append({
            "table_id": tbl.table_id,
            "full_name": f"{tbl.project}.{tbl.dataset_id}.{tbl.table_id}",
            "table_type": tbl.table_type,
        })
    return result


def _flatten_fields(fields, prefix: str = "") -> List[dict]:
    """Recursively flatten BQ schema fields (handles RECORD nesting)."""
    result = []
    for f in fields:
        name = f"{prefix}{f.name}" if prefix else f.name
        result.append({
            "name": name,
            "field_type": f.field_type,
            "mode": f.mode,
            "description": f.description or "",
        })
        if f.field_type == "RECORD" and f.fields:
            result.extend(_flatten_fields(f.fields, prefix=f"{name}."))
    return result


def get_table_schema(credentials_dict: Dict[str, Any], dataset_id: str, table_id: str) -> dict:
    """Fetch the schema for a single table and return as a structured dict."""
    client = get_bq_client(credentials_dict)
    project_id = credentials_dict.get("project_id")
    table_ref = f"{project_id}.{dataset_id}.{table_id}"
    table = client.get_table(table_ref)
    return {
        "full_name": f"{table.project}.{table.dataset_id}.{table.table_id}",
        "table_type": table.table_type,
        "num_rows": table.num_rows,
        "fields": _flatten_fields(table.schema),
    }
