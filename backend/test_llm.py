import llm_utils
import os

print("KEY:", os.environ.get("LLM_OPENAI_API_KEY"))

try:
    defs = llm_utils.generate_column_definitions("bus", "tbl", [{"name": "col1", "field_type": "STRING"}])
    print("Generated defs:", defs)
except Exception as e:
    print("Error:", type(e), e)
