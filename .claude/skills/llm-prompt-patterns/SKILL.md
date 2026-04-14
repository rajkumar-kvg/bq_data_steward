---
name: llm-prompt-patterns
description: Best practices for writing and editing LLM prompts in Data-Steward — column definition prompts, metric generation prompts, Cube model prompts, system/user split, temperature settings, and local testing. Use when modifying llm_utils.py or prompt logic.
---

## Prompt Architecture in Data-Steward

Prompts live inline in `backend/llm_utils.py` as f-strings (not external YAML yet — TODO for Phase 2). Each generation function has:

1. **System prompt** — role definition + output format contract
2. **User prompt** — dynamic context injection (schema, definitions, business context)

---

## System Prompt Patterns

### Column Definition Generator

```python
COLUMN_DEF_SYSTEM = """You are a data documentation expert. Given a BigQuery table schema, 
write clear, concise business definitions for each column.

Output JSON with this exact structure:
{
  "columns": {
    "<column_name>": {
      "definition": "<1-2 sentence business meaning>",
      "notes": "<optional: enum values, nullability semantics, relationships>"
    }
  }
}

Rules:
- Focus on business meaning, not technical type
- For partition/clustering columns, note their query performance role
- For ID columns, name what entity they reference
- Keep definitions under 50 words each
- If a column purpose is genuinely unclear, say "Purpose unclear — requires domain expert review"
"""
```

### Metric Generator

```python
METRIC_SYSTEM = """You are a business analytics expert. Given a BigQuery table schema and 
column definitions, propose meaningful business metrics.

Output JSON:
{
  "metrics": [
    {
      "name": "<snake_case_metric_name>",
      "description": "<what this measures and why it matters>",
      "measure_type": "<count|sum|avg|countDistinct|countDistinctApprox|max|min>",
      "sql_expression": "<column_name or SQL expression>",
      "rationale": "<why this metric is valuable>"
    }
  ]
}

Rules:
- Propose 5-10 metrics; prefer quality over quantity
- Always include a base `count` metric
- Match measure_type to column semantics (never sum a string or ID)
- sql_expression should be valid BigQuery SQL referencing only columns in the schema
- Flag any metric that requires a JOIN with a TODO comment
"""
```

### Cube Model Generator

```python
CUBE_MODEL_SYSTEM = """You are a Cube.dev semantic layer expert. Generate a valid Cube.js 
JavaScript model for the given BigQuery table.

Output a single JavaScript cube() definition as a raw string (no markdown, no code fences).

Rules:
- Use the sql_table pattern: `{project_id}.{dataset_id}.{table_id}`
- Include all confirmed metrics as measures with their sql and type
- Include key dimensions; omit ARRAY/STRUCT/BYTES columns
- Set primary_key: true on the ID dimension
- Add a time dimension for every TIMESTAMP/DATE column
- Do not add pre_aggregations unless explicitly requested
- Do not use require() or import statements
"""
```

---

## User Prompt Construction

### Variable Injection Convention

```python
def build_column_user_prompt(table_meta: TableMeta, connection: Connection) -> str:
    schema = table_meta.schema_json or {}
    columns = schema.get("columns", [])
    
    return f"""
Table: {connection.project_id}.{table_meta.dataset_id}.{table_meta.table_id}

Business Context:
{connection.definition or "No business context provided."}

Table Description:
{table_meta.definition or "No table description provided."}

Schema ({len(columns)} columns):
{format_schema_for_prompt(columns)}

Partition: {schema.get('partition_field', 'None')}
Clustering: {', '.join(schema.get('clustering_fields', [])) or 'None'}
Estimated rows: {schema.get('num_rows', 'Unknown'):,}
"""
```

### Schema Formatting Helper

```python
def format_schema_for_prompt(columns: list[dict]) -> str:
    lines = []
    for col in columns:
        nullable = "NULLABLE" if col.get("mode") == "NULLABLE" else "REQUIRED"
        lines.append(f"  - {col['name']} ({col['type']}, {nullable}): {col.get('description', '')}")
    return "\n".join(lines)
```

---

## Temperature Settings

| Task | Temperature | Reason |
|---|---|---|
| Column definitions | `0.2` | Need consistent, deterministic output |
| Metric generation | `0.3` | Slight creativity acceptable for ideation |
| Cube model generation | `0.1` | Strict syntax required; low variance |

**Never use `temperature > 0.5`** for structured JSON output — hallucination rate spikes.

---

## Response Format Enforcement

Use `response_format={"type": "json_object"}` for column and metric generation (OpenAI/Claude-compatible). For Cube model generation, prompt explicitly prohibits code fences and use string parsing:

```python
raw = response.choices[0].message.content.strip()
# Strip accidental markdown fences
if raw.startswith("```"):
    raw = re.sub(r"^```\w*\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)
```

---

## Local Prompt Testing

Use `backend/test_llm.py` to test prompt changes without running the full app:

```python
# test_llm.py pattern
import asyncio
from llm_utils import generate_column_definitions
from models import Connection, TableMeta

# Mock objects
conn = Connection(project_id="my-project", definition="E-commerce platform")
table = TableMeta(
    dataset_id="analytics",
    table_id="orders",
    schema_json={
        "columns": [
            {"name": "order_id", "type": "STRING", "mode": "REQUIRED"},
            {"name": "revenue_usd", "type": "NUMERIC", "mode": "NULLABLE"},
        ]
    }
)

result = asyncio.run(generate_column_definitions(conn, table))
print(result)
```

Run with: `cd backend && python test_llm.py`

---

## Prompt Quality Checklist

When editing a prompt, verify:

- [ ] System prompt specifies exact output JSON schema
- [ ] User prompt injects: business context, table description, full schema with types
- [ ] Output schema matches the Pydantic model that will parse it
- [ ] Null/missing fields are handled (connection.definition may be None)
- [ ] Temperature is appropriate for the output type
- [ ] Tested locally with `test_llm.py` before committing
- [ ] Response parsing handles both JSON and raw string outputs defensively

---

## Adding a New Generation Function

1. Add the generation function to `llm_utils.py` following the existing pattern
2. Add a new endpoint in `main.py` under the table metadata group
3. Add a new `api.js` function (verb-first camelCase)
4. Wire the UI trigger in `TableDetail.jsx`
5. Update the Pydantic schema in `schemas.py` if a new response shape is needed
6. Test with `test_llm.py` mock before full integration test
