---
name: cube-model-generator
description: Expert in Cube.dev YAML model syntax — cubes, measures, dimensions, joins, pre-aggregations — and Data-Steward's LLM output format. Use when generating, editing, or reviewing Cube YAML models.
---

## Cube.dev YAML Model Structure

Data-Steward generates Cube models as JavaScript (`.js`) files but the LLM prompt references YAML-like structure. The output stored in `TableMeta.cube_model` is a JS string that Cube.js evaluates dynamically.

### Canonical JS Model Template

```javascript
cube(`Orders`, {
  sql_table: `{project}.{dataset}.{table}`,  // TODO: fill from connection metadata

  joins: {
    // TODO: add joins to related cubes if foreign keys exist
    // Users: {
    //   sql: `${Orders}.user_id = ${Users}.id`,
    //   relationship: `many_to_one`
    // }
  },

  measures: {
    count: {
      type: `count`,
      description: `Total number of orders`
    },
    total_revenue: {
      sql: `revenue_usd`,
      type: `sum`,
      description: `Sum of revenue in USD`
    },
    avg_revenue: {
      sql: `revenue_usd`,
      type: `avg`,
      description: `Average revenue per order`
    },
    unique_users: {
      sql: `user_id`,
      type: `countDistinct`,
      description: `Number of distinct users`
    }
  },

  dimensions: {
    id: {
      sql: `order_id`,
      type: `string`,
      primary_key: true
    },
    status: {
      sql: `status`,
      type: `string`,
      description: `Order status`
    },
    created_at: {
      sql: `created_at`,
      type: `time`,
      description: `When the order was created`
    }
  },

  pre_aggregations: {
    // Add pre-aggs for high-frequency dashboard queries
    // main: {
    //   measures: [count, total_revenue],
    //   dimensions: [status],
    //   time_dimension: created_at,
    //   granularity: `day`
    // }
  }
});
```

---

## Measure Types

| Type | When to Use | SQL Required? |
|---|---|---|
| `count` | Row count; always include as the base measure | No |
| `sum` | Additive numeric columns (revenue, quantity, duration) | Yes — column name |
| `avg` | Per-row averages (avg order value, avg session length) | Yes — column name |
| `countDistinct` | Unique entities (users, sessions, orders) | Yes — column name |
| `countDistinctApprox` | Same but 10–20× faster at scale via HLL | Yes — column name |
| `max` / `min` | Latest timestamp, highest score | Yes — column name |
| `number` | Derived/calculated measure using other measures | Yes — formula using `${measure}` refs |

**Rule**: Never use `sum` on a column that could contain NULLs without noting it. Cube sums NULLs as 0.

---

## Dimension Types

| Type | BQ Source Types | Notes |
|---|---|---|
| `string` | STRING, BOOL (cast), INT64 (IDs) | Default for non-numeric, non-time |
| `number` | INT64, FLOAT64, NUMERIC | Use for dimensions you may filter by range |
| `time` | TIMESTAMP, DATETIME, DATE | Must have for time-series queries |
| `boolean` | BOOL | Renders as true/false filter in dashboards |
| `geo` | GEOGRAPHY | Limited Cube support; document but don't expose in pre-aggs |

---

## Time Dimension Granularities

Always include at minimum `day`. Add finer granularities only if dashboards need them:

```javascript
created_at: {
  sql: `created_at`,
  type: `time`,
  // Cube infers granularities automatically; no explicit list needed in JS syntax
}
```

In query context, granularities available: `second`, `minute`, `hour`, `day`, `week`, `month`, `quarter`, `year`.

**Partition alignment**: For BigQuery performance, the time dimension used in `pre_aggregations` should match the partition column. Check `schema_json.partition_field`.

---

## Join Strategies

```javascript
joins: {
  TargetCube: {
    sql: `${SourceCube}.foreign_key = ${TargetCube}.primary_key`,
    relationship: `many_to_one`   // source has many rows per target row
    // relationship: `one_to_many` // source is the "one" side
    // relationship: `one_to_one`  // 1:1 lookup table
  }
}
```

**Rules**:
- Only join from the fact cube to dimension/lookup cubes
- Never create circular joins
- Joins must reference cubes that exist in the model repository
- If the target cube doesn't exist yet, add a `// TODO: requires {TargetCube} cube` comment

---

## Pre-aggregation Patterns

Only add pre-aggregations when explicitly requested or when the table has `num_rows > 1_000_000`:

```javascript
pre_aggregations: {
  daily_summary: {
    measures: [count, total_revenue],
    dimensions: [status, country_code],
    time_dimension: created_at,
    granularity: `day`,
    partition_granularity: `month`,   // for BQ cost control
    refresh_key: {
      every: `1 hour`
    }
  }
}
```

---

## Data-Steward Output Format

The LLM in `llm_utils.py` generates Cube models as a raw JavaScript string. The output is stored in `TableMeta.cube_model` (TEXT column) and served via `GET /connections/{id}/cube-models/internal`.

**Validation rules** (enforced by `post_edit_lint.py`):
- Output must contain `cube(` as the root expression
- Must include at least one measure and one dimension
- `sql_table` must reference a valid `{project}.{dataset}.{table}` pattern
- No `require()` or `import` statements allowed (Cube sandbox)

---

## Common Anti-Patterns to Avoid

- **Exposing PII in dimensions**: Don't create dimensions for `email`, `phone`, `ssn` etc.
- **sum on ID columns**: `user_id` → `countDistinct`, never `sum`
- **Missing primary key**: Every cube needs exactly one `primary_key: true` dimension
- **Joining on nullable columns**: Note in a TODO comment if the join key is nullable
- **Pre-agg on unbounded string dimension**: High-cardinality strings (UUIDs, emails) in pre-agg dimensions kill performance
