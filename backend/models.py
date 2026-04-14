from sqlalchemy import Column, Integer, String, DateTime, JSON, Text, UniqueConstraint, ForeignKey
from sqlalchemy.sql import func
from database import Base


class Connection(Base):
    __tablename__ = "connections"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    project_id = Column(String(255), nullable=False)
    credentials = Column(JSON, nullable=False)
    business_definition = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DatasetMeta(Base):
    __tablename__ = "datasets"
    __table_args__ = (
        UniqueConstraint("connection_id", "dataset_id", name="uq_dataset"),
    )

    id = Column(Integer, primary_key=True, index=True)
    connection_id = Column(Integer, ForeignKey("connections.id", ondelete="CASCADE"), nullable=False, index=True)
    dataset_id = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    location = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TableMeta(Base):
    __tablename__ = "table_metadata"
    __table_args__ = (
        UniqueConstraint("connection_id", "dataset_id", "table_id", name="uq_table_meta"),
    )

    id = Column(Integer, primary_key=True, index=True)
    connection_id = Column(Integer, ForeignKey("connections.id", ondelete="CASCADE"), nullable=False, index=True)
    dataset_id = Column(String(255), nullable=False)
    table_id = Column(String(255), nullable=False)
    definition = Column(Text, nullable=True)
    bq_schema = Column(JSON, nullable=True)  # list of field dicts from BigQuery
    schema_synced_at = Column(DateTime(timezone=True), nullable=True)
    metrics = Column(JSON, nullable=True)  # AI-generated metrics recommendations
    cube_model = Column(Text, nullable=True)  # AI-generated or manually edited Cube.js model
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
