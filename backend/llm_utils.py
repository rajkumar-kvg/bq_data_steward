import os
import json
import re
from dataclasses import dataclass
from openai import OpenAI
from typing import List, Dict, Any, Tuple

# ── Valid Cube.js type sets ────────────────────────────────────────────────────
_VALID_MEASURE_TYPES = {
    "count", "sum", "avg", "min", "max",
    "countDistinct", "countDistinctApprox", "number", "string",
}
_VALID_DIMENSION_TYPES = {"string", "number", "boolean", "time", "geo"}

# All valid types in both categories (for fast membership test)
_ALL_VALID_TYPES = _VALID_MEASURE_TYPES | _VALID_DIMENSION_TYPES


@dataclass
class CubeModelIssue:
    severity: str   # "error" | "warning"
    message: str


def validate_cube_model(
    cube_model_js: str,
    expected_table_ref: str = "",
) -> Tuple[List[CubeModelIssue], bool]:
    """
    Heuristic QC validation of a Cube.js JavaScript model string.

    Returns (issues, is_valid) where is_valid is False if any 'error'-severity
    issue is found.  Warnings are informational only — the model can still be saved.

    Args:
        cube_model_js:     The raw JS string to validate.
        expected_table_ref: Optional fully-qualified BQ ref (project.dataset.table)
                            to verify the model points at the right table.
    """
    issues: List[CubeModelIssue] = []

    def err(msg: str) -> None:
        issues.append(CubeModelIssue("error", msg))

    def warn(msg: str) -> None:
        issues.append(CubeModelIssue("warning", msg))

    # ── 1. Non-empty ──────────────────────────────────────────────────────────
    if not cube_model_js or not cube_model_js.strip():
        err("Model is empty.")
        return issues, False

    js = cube_model_js.strip()

    # ── 2. Root cube() expression ─────────────────────────────────────────────
    if not re.search(r"\bcube\s*\(", js):
        err("Missing cube() root expression. Model must start with cube(`name`, {...}).")

    # ── 3. cube() name present ────────────────────────────────────────────────
    name_match = re.search(r"cube\s*\(\s*[`'\"](\w[\w-]*)[`'\"]", js)
    if not name_match:
        err("Could not parse cube name from cube(`name`, {...}).")

    # ── 4. sql_table or sql present ───────────────────────────────────────────
    if not re.search(r"\b(sql_table|sql)\s*:", js):
        err("Missing sql or sql_table field. Cube.js needs to know which table to query.")

    # ── 5. Correct BQ table reference (if expected_table_ref provided) ────────
    if expected_table_ref:
        if expected_table_ref not in js:
            err(
                f"Expected BigQuery table reference '{expected_table_ref}' not found in model. "
                "The model may query the wrong table."
            )

    # ── 6. At least one measure ───────────────────────────────────────────────
    if not re.search(r"\bmeasures\s*:", js):
        warn(
            "No measures block found. The KPI dashboard will have nothing to display. "
            "Add at least a base count measure."
        )

    # ── 7. Invalid types ──────────────────────────────────────────────────────
    # Capture all  type: `value`  /  type: 'value'  /  type: "value"  occurrences.
    # \1 backreference ensures matched delimiters; group(2) is the type value.
    type_hits = [m[1] for m in re.findall(r'''type\s*:\s*([`'"])(\w+)\1''', js)]
    for raw_t in type_hits:
        t_lower = raw_t.lower()
        if raw_t not in _ALL_VALID_TYPES:
            suggested = _BQ_TO_CUBE_TYPE.get(t_lower)
            if suggested and suggested != raw_t:
                err(
                    f"Invalid type '{raw_t}': BigQuery field type used directly. "
                    f"Use Cube.js type '{suggested}' instead."
                )
            else:
                err(
                    f"Invalid type '{raw_t}'. "
                    f"Allowed dimension types: {sorted(_VALID_DIMENSION_TYPES)}. "
                    f"Allowed measure types: {sorted(_VALID_MEASURE_TYPES)}."
                )

    # ── 8. count measures must not have a sql field ───────────────────────────
    # Heuristic: find any block that has type: `count` AND sql: `something`
    count_with_sql = re.search(
        r"type\s*:\s*[`'\"]count[`'\"].*?sql\s*:|sql\s*:.*?type\s*:\s*[`'\"]count[`'\"]",
        js,
        re.DOTALL,
    )
    if count_with_sql:
        warn(
            "A 'count' measure appears to have a sql field. "
            "Remove the sql field from count measures — Cube.js counts rows automatically."
        )

    # ── 9. sum/avg must have a sql field ─────────────────────────────────────
    # Look for sum/avg blocks missing sql: — rough heuristic (not a full AST parse)
    for agg_type in ("sum", "avg"):
        # Find each `type: `sum`` occurrence and look ahead for a sql field within ~200 chars
        for m in re.finditer(rf"\btype\s*:\s*[`'\"]({agg_type})[`'\"]", js):
            # Grab surrounding 200 chars to check for sql
            start = max(0, m.start() - 200)
            end   = min(len(js), m.end() + 200)
            snippet = js[start:end]
            if not re.search(r"\bsql\s*:", snippet):
                warn(
                    f"A '{agg_type}' measure may be missing a sql field. "
                    "All aggregate measures except 'count' need sql: `column_name`."
                )

    # ── 10. Primary key dimension ─────────────────────────────────────────────
    if not re.search(r"primary_key\s*:\s*true", js):
        warn(
            "No dimension has primary_key: true. "
            "Cube.js requires a primary key for correct join and deduplication behaviour."
        )

    # ── 11. Forbidden JS constructs ───────────────────────────────────────────
    if re.search(r"\brequire\s*\(", js):
        err("Forbidden: require() calls are not allowed in Cube.js model files.")
    if re.search(r"^\s*import\b", js, re.MULTILINE):
        err("Forbidden: import statements are not allowed in Cube.js model files.")
    if re.search(r"\bmodule\.exports\b", js):
        err("Forbidden: module.exports is not allowed. The model must be a bare cube() call.")

    # ── 12. Balanced braces (cheap sanity check) ──────────────────────────────
    open_b  = js.count("{")
    close_b = js.count("}")
    if open_b != close_b:
        err(
            f"Unbalanced braces: {open_b} opening vs {close_b} closing. "
            "The model JS is syntactically broken."
        )

    is_valid = not any(i.severity == "error" for i in issues)
    return issues, is_valid


# ── BigQuery field_type → Cube.js dimension/measure type ─────────────────────
# Keys are lowercase; matching is done case-insensitively at call time.
# Value None means "exclude the column" (handled upstream, not here).
_BQ_TO_CUBE_TYPE: Dict[str, str] = {
    # String / text
    "string":       "string",
    "varchar":      "string",
    "char":         "string",
    "text":         "string",
    "bytes":        "string",   # closest safe approximation
    "json":         "string",
    # Numeric
    "integer":      "number",
    "int":          "number",
    "int64":        "number",
    "float":        "number",
    "float64":      "number",
    "numeric":      "number",
    "bignumeric":   "number",
    "decimal":      "number",
    "bigdecimal":   "number",
    "double":       "number",
    "number":       "number",   # already correct — pass-through
    # Boolean
    "boolean":      "boolean",
    "bool":         "boolean",
    # Temporal  (all BQ temporal types → Cube `time`)
    "date":         "time",
    "datetime":     "time",
    "timestamp":    "time",
    "time":         "time",     # already correct — pass-through
    # Geo
    "geography":    "geo",
    "geo":          "geo",      # already correct — pass-through
    # Measure-only aliases the LLM sometimes produces
    "average":      "avg",
    "count_distinct": "countDistinct",
}


def sanitize_cube_model(cube_model_js: str) -> str:
    """
    Post-process a Cube.js JS model string to fix common LLM type errors.

    Handles:
    - All uppercase BigQuery field types (STRING, INTEGER, FLOAT64, BOOLEAN,
      TIMESTAMP, DATE, DATETIME, GEOGRAPHY, …) → correct Cube.js lowercase types
    - 'average' → 'avg', 'count_distinct' → 'countDistinct'
    - Ensures countDistinct is correctly cased
    """
    if not cube_model_js:
        return cube_model_js

    def _map_type(match: re.Match) -> str:
        # group(1) = delimiter  group(2) = type value
        raw = match.group(2)
        cube_type = _BQ_TO_CUBE_TYPE.get(raw.lower())
        if cube_type is None or cube_type == raw:
            return match.group(0)     # unknown or already correct — leave as-is
        return f"type: `{cube_type}`"

    # Match  type: `VALUE`  /  type: 'VALUE'  /  type: "VALUE"
    # \1 backreference ensures opening and closing delimiters match.
    result = re.sub(
        r'''type\s*:\s*([`'"])(\w+)\1''',
        _map_type,
        cube_model_js,
    )
    return result


def generate_column_definitions(
    business_def: str,
    table_def: str,
    schema_fields: List[Dict[str, Any]]
) -> List[Dict[str, str]]:
    """
    Calls an OpenAI-compatible LLM to generate column definitions.
    Returns a list of dicts: [{"name": <col_name>, "ai_description": <generated_text>}, ...]
    """
    api_key = os.environ.get("LLM_OPENAI_API_KEY", "dummy-key")
    base_url = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
    model_name = os.environ.get("LLM_MODEL_NAME", "gpt-3.5-turbo")

    client = OpenAI(
        api_key=api_key,
        base_url=base_url
    )

    # Prepare simpler schema context (just column names and their types) to save tokens
    simplified_schema = []
    for f in schema_fields:
        col_info = {"name": f.get("name"), "type": f.get("field_type")}
        if f.get("description"):
            col_info["existing_description"] = f.get("description")
        simplified_schema.append(col_info)

    system_prompt = """You are an expert Data Steward.
Your task is to generate clear, accurate definitions for each column of a database table.
You will be provided with:
1. The business definition (context of the connection)
2. The table definition (context of the table)
3. The table schema (column names and types, and potentially existing descriptions)

Return ONLY a valid JSON object with this exact structure:
{
  "columns": [
    {
      "name": "column_name",
      "ai_description": "A clear and concise definition for this column based on the context."
    }
  ]
}
Make sure to generate a definition for EVERY column provided in the schema. Do not include markdown formatting like ```json in the output, return just the plain JSON string.
"""

    user_content = f"""
Business Definition:
{business_def or "None"}

Table Definition:
{table_def or "None"}

Table Schema:
{json.dumps(simplified_schema, indent=2)}
"""

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            temperature=0.3,
        )
        
        content = response.choices[0].message.content.strip()
        # Clean up potential markdown formatting if the model disobeys
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
            
        parsed = json.loads(content.strip())
        return parsed.get("columns", [])
        
    except Exception as e:
        print(f"Error generating definitions: {e}")
        raise e

def generate_table_metrics(
    business_def: str,
    table_def: str,
    schema_fields: List[Dict[str, Any]]
) -> List[Dict[str, str]]:
    """
    Calls an OpenAI-compatible LLM to generate table metrics for reporting and analytics.
    Returns a list of dicts: [{"name": "...", "definition": "...", "type": "..."}, ...]
    """
    api_key = os.environ.get("LLM_OPENAI_API_KEY", "dummy-key")
    base_url = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
    model_name = os.environ.get("LLM_MODEL_NAME", "gpt-3.5-turbo")

    client = OpenAI(
        api_key=api_key,
        base_url=base_url
    )

    simplified_schema = []
    for f in schema_fields:
        col_info = {"name": f.get("name"), "type": f.get("field_type")}
        if f.get("description"):
            col_info["existing_description"] = f.get("description")
        simplified_schema.append(col_info)

    system_prompt = """You are an expert Data Steward and BI Developer.
Your task is to generate a list of applicable reporting and analytics metrics for a database table based on its context and schema.
These metrics will be used to create Cube.js or other semantic models, so please provide detailed metric types (e.g., count, sum, average, min, max, countDistinct).

Return ONLY a valid JSON object with this exact structure:
{
  "metrics": [
    {
      "name": "metric_name",
      "definition": "A clear definition of what this metric calculates.",
      "type": "Aggregation type (e.g., count, sum, average, min, max, countDistinct)",
      "column": "The exact column name this metric is calculated on. If it's a general table count, you can use '*' or null."
    }
  ]
}
IMPORTANT: Only calculate metrics using the columns explicitly provided in the table schema. Do NOT create or hallucinate metrics that rely on columns that do not exist.
Make sure to generate applicable metrics using the numerical and categorical columns provided in the schema. Do not include markdown formatting like ```json in the output, return just the plain JSON string.
"""

    user_content = f"""
Business Definition:
{business_def or "None"}

Table Definition:
{table_def or "None"}

Table Schema:
{json.dumps(simplified_schema, indent=2)}
"""

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            temperature=0.3,
        )
        
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
            
        parsed = json.loads(content.strip())
        return parsed.get("metrics", [])
        
    except Exception as e:
        print(f"Error generating metrics: {e}")
        raise e

def generate_cube_model(
    table_id: str,
    schema_fields: List[Dict[str, Any]],
    metrics: List[Dict[str, Any]],
    dataset_id: str = "",
    project_id: str = ""
) -> str:
    """
    Calls an OpenAI-compatible LLM to generate a Cube.js data model based on the syntax guide.
    """
    # Sanitize table_id for cube name (must be a valid JS identifier)
    cube_name = re.sub(r'[^a-zA-Z0-9_]', '_', table_id)
    if cube_name and cube_name[0].isdigit():
        cube_name = "_" + cube_name

    api_key = os.environ.get("LLM_OPENAI_API_KEY", "dummy-key")
    base_url = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
    model_name = os.environ.get("LLM_MODEL_NAME", "gpt-3.5-turbo")

    client = OpenAI(
        api_key=api_key,
        base_url=base_url
    )

    # Read the syntax guide — try several candidate locations so this works both
    # locally (file is at repo root) and inside Docker (backend dir is /app).
    _this_dir = os.path.dirname(os.path.abspath(__file__))
    _syntax_candidates = [
        os.path.join(_this_dir, 'cube_data_model_syntax.md'),            # copied into backend/
        os.path.join(_this_dir, '..', 'cube_data_model_syntax.md'),      # repo root locally
        '/cube_data_model_syntax.md',                                     # repo root in Docker
    ]
    syntax_guide = ""
    for _path in _syntax_candidates:
        try:
            with open(_path, 'r', encoding='utf-8') as f:
                syntax_guide = f.read()
            break
        except FileNotFoundError:
            continue
    if not syntax_guide:
        print("Warning: cube_data_model_syntax.md not found — LLM prompt will use inline rules only.")

    simplified_schema = []
    for f in schema_fields:
        col_info = {"name": f.get("name"), "type": f.get("field_type")}
        simplified_schema.append(col_info)

    system_prompt = f"""You are an expert Cube.js Developer.
Your task is to generate a Cube.js data model (in standard JavaScript format, using the 'cube(`cube_name`, ...)' syntax) for a database table.
You must strictly follow the rules outlined in the provided Cube Data Model Syntax guide.

Syntax Guide:
{syntax_guide}

CRITICAL NAMING RULE:
- The cube MUST be named '{cube_name}'. Use the following syntax: cube(`{cube_name}`, {{ ... }});

CRITICAL TYPE RULES (you MUST follow exactly):
- Measure types MUST only be one of: count, sum, avg, min, max, countDistinct, number
  - Use 'avg' NOT 'average'
  - Use 'countDistinct' NOT 'count_distinct'
  - 'count' measures should NOT have a 'sql' field. All other types require a 'sql' field.
- Dimension types MUST only be one of: string, number, boolean, time, geo
  - Use 'time' for date/datetime/timestamp columns, NOT 'date', NOT 'datetime'
  - Use 'number' for INTEGER, FLOAT, NUMERIC columns
  - Use 'string' for STRING, VARCHAR columns
  - Use 'boolean' for BOOLEAN columns
- Each measure/dimension must have a 'sql' field with a backtick string containing JUST the column name (e.g., sql: \`column_name\`) unless it's a complicated expression.
  - Exception: 'count' type measures should NOT have a sql field

CRITICAL BIGQUERY RULE:
- You MUST use the fully-qualified table name: `project_id.dataset_id.table_id`
- You MUST wrap it in backticks: `sql: \`SELECT * FROM \\\`project_id.dataset_id.table_id\\\`\``
- Note: This ensures the inner backticks are escaped within the outer template literal.

Pre-Aggregations: Do NOT include any preAggregations block for now.

Generate the Cube.js model using EXACTLY the schema fields and the metrics provided.
The output MUST ONLY be valid JavaScript code. Do not wrap the response with markdown formatting like ```js or ```javascript, and do not include any conversational text. Return just the raw JavaScript code.
"""


    user_content = f"""
Project ID:
{project_id}

Dataset ID:
{dataset_id}

Table ID:
{table_id}

Table Schema:
{json.dumps(simplified_schema, indent=2)}

Generated Metrics:
{json.dumps(metrics, indent=2)}
"""

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            temperature=0.2,
        )
        
        content = response.choices[0].message.content.strip()
        # Clean up potential markdown formatting if the model disobeys
        if content.startswith("```json"):
            content = content[7:]
        elif content.startswith("```js"):
            content = content[5:]
        elif content.startswith("```javascript"):
            content = content[13:]
        elif content.startswith("```"):
            content = content[3:]
            
        if content.endswith("```"):
            content = content[:-3]
            
        return content.strip()
        
    except Exception as e:
        print(f"Error generating cube model: {e}")
        raise e


def fix_cube_model_with_error(
    broken_model_js: str,
    cube_error: str,
    cube_name: str,
) -> str:
    """
    Passes a broken Cube.js model plus the exact compile error from the Cube.js
    runtime back to the LLM and asks it to produce a corrected model.

    Returns the fixed model JS string (still needs sanitize_cube_model applied).
    """
    api_key    = os.environ.get("LLM_OPENAI_API_KEY", "dummy-key")
    base_url   = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
    model_name = os.environ.get("LLM_MODEL_NAME", "gpt-3.5-turbo")

    client = OpenAI(api_key=api_key, base_url=base_url)

    system_prompt = f"""You are an expert Cube.js Developer tasked with fixing a broken Cube.js JavaScript data model.

The model failed to compile in the Cube.js runtime. You will be given:
1. The broken model
2. The exact compile error from Cube.js

Your job is to return a corrected version of the model that will pass Cube.js compilation.

STRICT RULES — you MUST follow all of these exactly:
- Output ONLY valid Cube.js JavaScript. No markdown, no prose, no triple-backtick fences.
- The cube MUST be named `{cube_name}`.
- Dimension types: ONLY string | number | boolean | time | geo
- Measure types: ONLY count | sum | avg | min | max | countDistinct | number
- `count` measures must NOT have a `sql` field.
- All other measure types MUST have a `sql` field with a backtick string (e.g. sql: `column_name`).
- The `sql` field of every measure and dimension must be a plain backtick string — NOT an object, NOT an arrow function, NOT an array.
- Do NOT include `drillMembers`, `segments`, `preAggregations`, or any other blocks not in the original.
- Do NOT invent new columns. Use only the column names that appear in the original model.
- The table reference in the top-level `sql` must be kept exactly as-is.
"""

    user_content = f"""Broken Cube.js model:
```
{broken_model_js}
```

Cube.js compile error:
```
{cube_error}
```

Return ONLY the corrected JavaScript. No explanation, no markdown fences."""

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_content},
            ],
            temperature=0.1,   # very low — we need deterministic fixes
        )
        content = response.choices[0].message.content.strip()
        # Strip any markdown the model adds despite instructions
        for prefix in ("```javascript", "```js", "```json", "```"):
            if content.startswith(prefix):
                content = content[len(prefix):]
                break
        if content.endswith("```"):
            content = content[:-3]
        return content.strip()
    except Exception as e:
        print(f"Error fixing cube model: {e}")
        raise e


def generate_cube_query(
    question: str,
    schema_context: str,
    history: List[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Pass 1 of chat: convert a natural language question into a Cube REST API query JSON.
    Temperature 0.1 — deterministic, schema-grounded output.

    Returns a dict. If the question cannot be answered with the available schema,
    returns {"error": "reason"}.
    Raises json.JSONDecodeError or OpenAI exception on failure.
    """
    api_key    = os.environ.get("LLM_OPENAI_API_KEY", "dummy-key")
    base_url   = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
    model_name = os.environ.get("LLM_MODEL_NAME", "gpt-3.5-turbo")
    client = OpenAI(api_key=api_key, base_url=base_url)

    system_prompt = f"""You are a Cube.js query expert. Your ONLY job is to convert a natural language question into a Cube REST API query JSON object.

AVAILABLE SCHEMA:
{schema_context}

RULES:
1. Output ONLY valid JSON. No markdown, no explanation, no text before or after the JSON.
2. Use ONLY measure/dimension names that appear EXACTLY in the AVAILABLE SCHEMA above. Do NOT invent names.
3. Every member reference must use the format "CubeName.memberKey" where both CubeName and memberKey come verbatim from the schema.
4. The JSON must have at least one of: "measures" or "dimensions".
5. Valid top-level keys: measures (array), dimensions (array), filters (array), timeDimensions (array), limit (number, max 1000).
6. Filter format: {{"member": "CubeName.dimension", "operator": "equals", "values": ["val"]}}
   Valid operators: equals, notEquals, contains, notContains, gt, gte, lt, lte, set, notSet, inDateRange
7. TimeDimension format: {{"dimension": "CubeName.timeDimension", "granularity": "day|week|month|quarter|year"}}
8. If the question CANNOT be answered with the available schema, output exactly: {{"error": "brief reason why"}}
9. Do NOT add any text before or after the JSON. The entire response must be parseable by json.loads().
10. Default limit to 100 unless the user specifies more (max 1000)."""

    messages = [{"role": "system", "content": system_prompt}]

    if history:
        for msg in history:
            if msg.get("role") in ("user", "assistant"):
                messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": question})

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=messages,
            temperature=0.1,
        )
        content = response.choices[0].message.content.strip()
        # Strip markdown fences if the model disobeys
        for prefix in ("```json", "```"):
            if content.startswith(prefix):
                content = content[len(prefix):]
                break
        if content.endswith("```"):
            content = content[:-3]
        return json.loads(content.strip())
    except json.JSONDecodeError as e:
        print(f"[generate_cube_query] JSON parse error: {e}. Raw: {content[:300]}")
        raise
    except Exception as e:
        print(f"[generate_cube_query] Error: {e}")
        raise


def generate_chat_answer(
    question: str,
    cube_query: Dict[str, Any],
    cube_result: Dict[str, Any],
    history: List[Dict[str, str]] = None,
) -> str:
    """
    Pass 2 of chat: convert (question + Cube.js result data) into a natural language answer.
    Temperature 0.3 — readable, slightly varied prose.

    Returns a plain text answer string.
    Raises OpenAI exception on failure.
    """
    api_key    = os.environ.get("LLM_OPENAI_API_KEY", "dummy-key")
    base_url   = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
    model_name = os.environ.get("LLM_MODEL_NAME", "gpt-3.5-turbo")
    client = OpenAI(api_key=api_key, base_url=base_url)

    system_prompt = """You are a helpful data analyst assistant for BQ Steward, a BigQuery data governance tool.
You will be given the user's original question, the query that was executed, and the data results returned.
Answer the question in plain, clear language based on the data provided.

RULES:
- Be concise but complete. 1-3 sentences for simple numbers, a short paragraph for lists.
- If the data is empty, say so clearly and suggest why (e.g., filters too narrow, no data in range).
- Format numbers with commas for readability (e.g., 1,234,567).
- Do NOT make up data or invent values not present in the results.
- Do NOT mention technical query terms — speak as a data analyst to a business user.
- If there are multiple rows, briefly summarize the key finding rather than listing every row."""

    # Trim to 50 rows to avoid token overflow
    result_data = cube_result.get("data", [])
    total_rows = len(result_data)
    if total_rows > 50:
        result_data = result_data[:50]
        data_note = f" (showing first 50 of {total_rows} rows)"
    else:
        data_note = ""

    user_content = f"""Question: {question}

Query executed:
{json.dumps(cube_query, indent=2)}

Data results{data_note}:
{json.dumps(result_data, indent=2)}"""

    messages = [{"role": "system", "content": system_prompt}]

    if history:
        for msg in history:
            if msg.get("role") in ("user", "assistant"):
                messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": user_content})

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=messages,
            temperature=0.3,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"[generate_chat_answer] Error: {e}")
        raise
