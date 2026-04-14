---
name: bq-schema-reader
description: Knows Data-Steward's BigQuery table introspection patterns, field type mappings, and how partition/clustering fields should be documented in metadata and Cube models. Use when working on schema sync, column definitions, or BQ introspection code.
---

## BigQuery → Semantic Type Mappings

When reading a BigQuery schema (from `INFORMATION_SCHEMA.COLUMNS` or the BQ API), map column types to semantic categories used in Cube measures and column metadata:

| BQ Data Type | Semantic Category | Default Cube Role | Notes |
|---|---|---|---|
| `INT64`, `INTEGER`, `NUMERIC`, `BIGNUMERIC`, `FLOAT64` | `numeric` | measure (sum/avg) or dimension | Check column name for clues: `_id` → dimension |
| `STRING` | `string` | dimension | High-cardinality strings → avoid in pre-aggs |
| `BOOL`, `BOOLEAN` | `boolean` | dimension | Map to `count` measure with filter if needed |
| `DATE` | `date` | time dimension | Granularities: day, week, month, quarter, year |
| `DATETIME` | `datetime` | time dimension | Same granularities as DATE |
| `TIMESTAMP` | `time` | time dimension | Primary partition key is almost always TIMESTAMP |
| `ARRAY` | `array` | skip or unnest | Flag in column definition; Cube can't query directly |
| `STRUCT` | `record` | skip or flatten | Note nested fields in definition |
| `GEOGRAPHY` | `geo` | dimension only | Not aggregatable |
| `JSON` | `json` | skip | Flag for extraction pre-processing |
| `BYTES` | `bytes` | skip | Not human-readable; exclude from metrics |

---

## INFORMATION_SCHEMA Query Patterns

Data-Steward uses `bigquery_utils.py` to introspect schemas. The underlying query pattern is:

```sql
SELECT
  column_name,
  data_type,
  is_nullable,
  is_partitioning_column,
  clustering_ordinal_position
FROM `{project}.{dataset}.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = '{table}'
ORDER BY ordinal_position
```

Key fields to surface in column definitions:
- `is_partitioning_column = 'YES'` → note as "partition key; used for query cost control"
- `clustering_ordinal_position IS NOT NULL` → note as "clustering key #{ordinal}; improves filter performance"
- `is_nullable = 'NO'` → note as required/non-null in business definition

---

## Partitioning Patterns

| Partition Type | BQ Syntax Indicator | How to Document |
|---|---|---|
| Ingestion-time | `_PARTITIONTIME` pseudo-column | "Ingestion-time partitioned; filter with `_PARTITIONDATE`" |
| Column-based (DATE/TIMESTAMP) | `is_partitioning_column = YES` on a date column | "Partitioned by `{col}` ({type}); always filter on this column in queries" |
| Integer range | `is_partitioning_column = YES` on INT64 | "Integer-range partitioned by `{col}`; range defined at table creation" |
| No partition | None flagged | "Unpartitioned; full table scans are expensive at scale" |

When a table has no partition key, flag it in the table-level `definition` field:
> ⚠️ Unpartitioned table — queries will full-scan unless filtered on a clustered column.

---

## BQ API Response → TableMeta Schema

The backend's `sync-schema` endpoint calls BigQuery and stores results in `TableMeta.schema_json`. The structure is:

```json
{
  "columns": [
    {
      "name": "user_id",
      "type": "STRING",
      "mode": "NULLABLE",
      "description": ""
    },
    {
      "name": "created_at",
      "type": "TIMESTAMP",
      "mode": "REQUIRED",
      "description": ""
    }
  ],
  "partition_field": "created_at",
  "clustering_fields": ["user_id", "country_code"],
  "num_rows": 14200000,
  "num_bytes": 892340000
}
```

Use `num_rows` and `num_bytes` to calibrate metric suggestions (e.g., avoid `countDistinct` pre-aggregations on billion-row tables).

---

## Sample Schema Introspection Output

**Table**: `analytics.events.user_sessions`  
**Project**: `my-gcp-project` ← TODO: replace with actual project name

```
Column               Type        Mode       Partition  Cluster
-------------------  ----------  ---------  ---------  -------
session_id           STRING      REQUIRED   No         No
user_id              STRING      NULLABLE   No         1
started_at           TIMESTAMP   REQUIRED   YES (col)  No
ended_at             TIMESTAMP   NULLABLE   No         No
country_code         STRING      NULLABLE   No         2
device_type          STRING      NULLABLE   No         No
page_views           INT64       NULLABLE   No         No
converted            BOOL        NULLABLE   No         No
revenue_usd          NUMERIC     NULLABLE   No         No
```

**Interpretation**:
- `session_id` → string dimension (primary key)
- `user_id` → string dimension + `countDistinct` measure candidate
- `started_at` → primary time dimension (partition key; use for Cube `timeDimension`)
- `ended_at` → secondary time dimension
- `country_code` → string dimension + segment candidate
- `page_views` → `sum` and `avg` measure candidates
- `converted` → `count` with filter, or `sum` after CAST
- `revenue_usd` → `sum` and `avg` measures

---

## Column Definition Quality Checklist

When generating or reviewing column definitions in Data-Steward:

- [ ] Definition explains **business meaning**, not just the data type
- [ ] Partition/clustering role is noted if applicable
- [ ] Enums or known value sets are documented (e.g., "`device_type`: one of `mobile`, `desktop`, `tablet`")
- [ ] Foreign key relationships called out (e.g., "`user_id` references `users.user_id`")
- [ ] Nullable columns note when NULL is meaningful vs. missing data
- [ ] ARRAY/STRUCT columns note how they should be unnested for analysis
