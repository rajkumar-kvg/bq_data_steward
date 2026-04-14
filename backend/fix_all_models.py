import re
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import get_db
from models import TableMeta
import llm_utils

db = next(get_db())
tables = db.query(TableMeta).all()


def fix_model(content: str) -> str:
    """Apply all sanitization passes to a stored Cube.js model string."""
    if not content:
        return content

    # ── Pass 1: fix BigQuery uppercase types and measure type aliases ─────────
    content = llm_utils.sanitize_cube_model(content)

    # ── Pass 2: normalise cube-level sql_table reference ──────────────────────
    match = re.search(r"([a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)", content)
    if match:
        full_ref = match.group(1)
        # Use `sql: SELECT * FROM \`ref\`` so backtick-quoting is emitted in SQL —
        # required for GCP project IDs that contain hyphens.
        correct_sql = f"sql: `SELECT * FROM \\`{full_ref}\\``"

        measures_pos = min(
            p for p in [
                content.find("measures:"),
                content.find("dimensions:"),
                len(content),
            ] if p != -1
        )
        cube_header = content[:measures_pos]
        cube_rest   = content[measures_pos:]

        new_header = re.sub(
            r"(sql_table|sql)\s*:\s*`(?:[^`\\]|\\.)*`",
            correct_sql,
            cube_header,
            count=1,
        )
        content = new_header + cube_rest

    # ── Pass 3: fix preAggregations CUBE.member → string reference ───────────
    content = re.sub(r"measures:\s*\[\s*CUBE\.(\w+)", r"measures: ['\1'", content)
    content = re.sub(r"dimensions:\s*\[\s*CUBE\.(\w+)", r"dimensions: ['\1'", content)

    return content


fixed = 0
warned = 0
for t in tables:
    if not t.cube_model:
        continue
    old = t.cube_model
    new = fix_model(old)
    if old != new:
        t.cube_model = new
        fixed += 1

    # Run QC and report any remaining issues without blocking the save
    issues, is_valid = llm_utils.validate_cube_model(new)
    if not is_valid:
        warned += 1
        print(f"  [WARN] {t.dataset_id}.{t.table_id} still has errors after fix:")
        for issue in issues:
            if issue.severity == "error":
                print(f"    ✗ {issue.message}")

db.commit()
print(f"\nFixed {fixed} models. {warned} models still have validation errors (see above).")
