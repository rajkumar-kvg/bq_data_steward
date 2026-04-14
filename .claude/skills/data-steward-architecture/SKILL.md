---
name: data-steward-architecture
description: Auto-loaded context for the Data-Steward codebase — FastAPI service structure, SQLAlchemy models, Pydantic schemas, React state, API contracts, and module conventions. Use at the start of any backend or full-stack task.
---

## Module Map

```
prototype-data-steward/
├── backend/
│   ├── main.py           # All API route definitions (~570 lines); no business logic
│   ├── models.py         # SQLAlchemy ORM — Connection, DatasetMeta, TableMeta
│   ├── schemas.py        # Pydantic v2 request/response models
│   ├── bigquery_utils.py # BQ API calls (list datasets, list tables, fetch schema)
│   ├── llm_utils.py      # LLM generation: columns, metrics, Cube models (~318 lines)
│   └── database.py       # SQLAlchemy async engine + session factory
├── frontend/src/
│   ├── App.jsx           # Root layout, sidebar, connection selection
│   ├── api.js            # Axios client — single source of truth for all API calls
│   └── components/
│       ├── ConnectionForm.jsx   # Service account JSON upload → POST /connections
│       ├── ConnectionDetail.jsx # Dataset browser, table list
│       ├── DatasetPanel.jsx     # Sync trigger, dataset listing
│       ├── TableDetail.jsx      # Main editing surface (~805 lines)
│       └── KPIDashboard.jsx     # Cube.js query builder + chart renderer
├── cube/
│   └── cube.js           # Cube.js config: BQ driver factory, dynamic model repo
└── cube_data_model_syntax.md  # LLM context injected into Cube model prompts
```

---

## SQLAlchemy Models (`backend/models.py`)

```python
class Connection(Base):
    id: int (PK)
    name: str
    project_id: str               # GCP project ID
    service_account_json: str     # Full SA JSON (stored encrypted or plaintext)
    definition: str | None        # Business context for LLM prompts
    created_at: datetime

class DatasetMeta(Base):
    id: int (PK)
    connection_id: int (FK → Connection)
    dataset_id: str               # BQ dataset name
    description: str | None
    synced_at: datetime | None

class TableMeta(Base):
    id: int (PK)
    connection_id: int (FK)
    dataset_id: str
    table_id: str
    definition: str | None        # Human/LLM-written table description
    schema_json: dict | None      # Raw BQ schema (columns, partition, clustering)
    columns_meta: dict | None     # {col_name: {definition, type, ...}}
    metrics: list | None          # [{name, description, measure_type, sql}]
    cube_model: str | None        # Generated JS string
    updated_at: datetime
```

---

## Pydantic Schemas (`backend/schemas.py`)

Key response shapes:
- `ConnectionOut` — id, name, project_id, definition
- `DatasetOut` — id, connection_id, dataset_id, description, synced_at
- `TableMetaOut` — full TableMeta including schema_json, columns_meta, metrics, cube_model
- `ColumnDefinition` — {name, type, definition, is_partition_key, is_clustering_key}
- `MetricDefinition` — {name, description, measure_type, sql_expression}

---

## API Contract Summary (`backend/main.py`)

### Connection endpoints
```
POST   /connections                         # Create from SA JSON upload
GET    /connections                         # List all
DELETE /connections/{conn_id}
PATCH  /connections/{conn_id}/definition    # Update business context
POST   /connections/{conn_id}/test          # Validate BQ credentials
```

### Dataset/Table browsing
```
GET    /connections/{conn_id}/datasets
POST   /connections/{conn_id}/datasets/sync
GET    /connections/{conn_id}/datasets/{dataset_id}/tables
```

### Table metadata (the core workflow)
```
GET    /connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta
PUT    /connections/{conn_id}/datasets/{dataset_id}/tables/{table_id}/meta
POST   .../meta/sync-schema                 # Fetch schema from BQ → store in schema_json
POST   .../meta/generate-columns            # LLM → columns_meta
PUT    .../meta/columns/{column_name}       # Update single column definition
POST   .../meta/generate-metrics            # LLM → metrics
PUT    .../meta/metrics                     # Update metrics array
POST   .../meta/generate-cube-model         # LLM → cube_model string
PUT    .../meta/cube-model                  # Update cube_model string
```

### Cube.js internal endpoints (called by Cube runtime, not UI)
```
GET    /connections/{conn_id}/cube-models/internal   # Returns all JS model strings
GET    /connections/{conn_id}/credentials            # Returns SA JSON for BQ driver
GET    /connections/{conn_id}/models                 # Tables that have cube_model set
POST   /connections/{conn_id}/test-cube              # Test Cube.js connectivity
```

---

## LLM Generation Pattern (`backend/llm_utils.py`)

All three generation functions follow the same structure:

```python
async def generate_X(connection: Connection, table_meta: TableMeta, ...) -> OutputType:
    system_prompt = "..."          # Role + output format instructions
    user_prompt = f"..."           # Injected schema, definitions, context
    
    response = await openai_client.chat.completions.create(
        model=settings.LLM_MODEL_NAME,
        messages=[{"role": "system", ...}, {"role": "user", ...}],
        temperature=0.2,           # Low temp for structured output
        response_format={"type": "json_object"}  # where applicable
    )
    return parse_response(response)
```

**Context injected into every prompt**:
1. `Connection.definition` — business context set by user
2. `TableMeta.schema_json` — raw BQ column list with types
3. `TableMeta.definition` — table-level description (if set)
4. For Cube model: full contents of `cube_data_model_syntax.md`

---

## Frontend State Pattern

The frontend does **not** use Zustand yet (noted in request as a goal). Currently uses React `useState` with prop drilling. Key state:

- `App.jsx` holds: `selectedConnection`, `selectedDataset`, `selectedTable`
- `TableDetail.jsx` holds all editing state for a single table: `columns`, `metrics`, `cubeModel`
- `api.js` is the single place to add/modify API calls — never call `fetch` or `axios` directly from components

---

## SSE Streaming

Long-running LLM calls stream progress via Server-Sent Events. Pattern in `main.py`:

```python
from fastapi.responses import StreamingResponse

async def stream_generator():
    async for chunk in llm_stream(...):
        yield f"data: {json.dumps({'chunk': chunk})}\n\n"
    yield "data: [DONE]\n\n"

return StreamingResponse(stream_generator(), media_type="text/event-stream")
```

Frontend consumes with `EventSource` in the relevant component.

---

## Naming Conventions

- **Backend files**: `snake_case.py`
- **API route parameters**: `conn_id`, `dataset_id`, `table_id` (never `id` alone)
- **SQLAlchemy models**: PascalCase class, `snake_case` columns
- **Pydantic schemas**: `{Model}Out` for responses, `{Model}In` or `{Model}Create` for requests
- **Frontend components**: PascalCase `.jsx` files
- **API functions in `api.js`**: camelCase, verb-first (`getConnections`, `generateColumns`)
