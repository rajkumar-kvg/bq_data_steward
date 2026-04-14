import os
import re
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# Load env from parent dir
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

import models
import llm_utils

# Override DATABASE_URL to use localhost if it points to 'db'
db_url = os.getenv("DATABASE_URL", "postgresql://steward:steward@localhost:5432/steward")
db_url = db_url.replace("@db:", "@localhost:")

engine = create_engine(db_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db = SessionLocal()

def regenerate():
    tables = db.query(models.TableMeta).all()
    count = 0
    
    for t in tables:
        if not t.bq_schema or not t.bq_schema.get("fields"):
            print(f"Skipping {t.table_id}: No schema.")
            continue
            
        print(f"Regenerating model for {t.dataset_id}.{t.table_id}...")
        
        conn = db.query(models.Connection).filter_by(id=t.connection_id).first()
        if not conn:
            print(f"Skipping {t.table_id}: Connection not found.")
            continue
            
        project_id = conn.credentials.get("project_id", conn.project_id)
        metrics = t.metrics or []
        
        try:
            new_model = llm_utils.generate_cube_model(
                table_id=t.table_id,
                dataset_id=t.dataset_id,
                project_id=project_id,
                schema_fields=t.bq_schema["fields"],
                metrics=metrics
            )
            
            # Post-process to fix common LLM type errors
            new_model = llm_utils.sanitize_cube_model(new_model)
            
            # Ensure the model uses the fully qualified and backticked BQ name.
            raw_full_table_ref = f"{project_id}.{t.dataset_id}.{t.table_id}"
            sql_pattern = f"sql: `SELECT * FROM \\`{raw_full_table_ref}\\``"
            
            new_model = re.sub(
                r"(sql_table|sql)\s*:\s*`[^,]*",
                sql_pattern,
                new_model,
                count=1
            )
            
            t.cube_model = new_model
            count += 1
            print(f"Successfully updated {t.table_id}.")
            
        except Exception as e:
            print(f"Failed to regenerate {t.table_id}: {e}")
            
    db.commit()
    print(f"Regenerated {count} models.")

if __name__ == "__main__":
    regenerate()
