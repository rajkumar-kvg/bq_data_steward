from pydantic import BaseModel
from datetime import datetime
from typing import Any, Dict, Optional


class ConnectionCreate(BaseModel):
    name: str
    credentials: Dict[str, Any]  # full service account JSON
    business_definition: Optional[str] = None


class ConnectionOut(BaseModel):
    id: int
    name: str
    project_id: str
    business_definition: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class TestResult(BaseModel):
    success: bool
    message: str


class DatasetOut(BaseModel):
    dataset_id: str
    full_name: str
    location: Optional[str] = None

    class Config:
        from_attributes = True


class TableOut(BaseModel):
    table_id: str
    full_name: str
    table_type: Optional[str] = None


from typing import List
class MetricItem(BaseModel):
    name: str
    type: str
    column: Optional[str] = None
    definition: Optional[str] = None

class MetricsUpdate(BaseModel):
    metrics: List[MetricItem]


class TableMetaOut(BaseModel):
    id: int
    connection_id: int
    dataset_id: str
    table_id: str
    definition: Optional[str] = None
    bq_schema: Optional[Any] = None
    schema_synced_at: Optional[datetime] = None
    metrics: Optional[Any] = None
    cube_model: Optional[str] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class CubeModelUpdate(BaseModel):
    cube_model: str


class CubeModelGenerateOut(TableMetaOut):
    """Extended response for the generate-cube-model endpoint.
    Includes QC warnings so the UI can surface them without blocking the save."""
    cube_model_warnings: List[str] = []
