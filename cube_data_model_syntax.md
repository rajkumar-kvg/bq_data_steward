# Cube Data Model Syntax

Entities within the data model (e.g., cubes, views, etc.) should be placed under
the `model` folder, follow naming conventions, and be defined using a supported syntax.

---

## Folder Structure

Data model files should be placed inside the `model` folder. You can use the
`schema_path` configuration option to override the folder name, or the `repository_factory`
configuration option to dynamically define the folder name and data model file contents.

It is recommended to place each cube or view in a separate file, under `model/cubes`
and `model/views` folders respectively. Example:

```
model
├── cubes
│   ├── orders.yml
│   ├── products.yml
│   └── users.yml
└── views
    └── revenue.yml
```

---

## Model Syntax

Cube supports two ways to define data model files: **YAML** or **JavaScript**.

- YAML files use the `.yml` extension.
- JavaScript files use the `.js` extension.
- You can mix YAML and JavaScript files within a single data model.

**JavaScript example:**
```js
cube(`orders`, {
  sql: `
    SELECT *
    FROM orders, line_items
    WHERE orders.id = line_items.order_id
  `
})
```

**YAML example:**
```yaml
cubes:
  - name: orders
    sql: |
      SELECT *
      FROM orders, line_items
      WHERE orders.id = line_items.order_id
```

You can define the data model statically or build dynamic data models programmatically.
YAML data models use Jinja and Python; JavaScript data models use JavaScript.

YAML is recommended for its simplicity and readability. JavaScript offers more flexibility
for dynamic data modeling.

---

## Naming

All names within the data model must:

- Start with a letter.
- Consist of letters, numbers, and underscore (`_`) symbols only.
- Not be a reserved keyword in Python (e.g., `from`, `return`, `yield`).
- When using the DAX API, not clash with names of columns in date hierarchies.

It is also recommended that names use **snake_case**.

**Good examples:**
- Cubes: `orders`, `stripe_invoices`, `base_payments`
- Views: `opportunities`, `cloud_accounts`, `arr`
- Measures: `count`, `avg_price`, `total_amount_shipped`
- Dimensions: `name`, `is_shipped`, `created_at`
- Pre-aggregations: `main`, `orders_by_status`, `lambda_invoices`

---

## SQL Expressions

When defining cubes, you will often provide SQL snippets in `sql` and `sql_table` parameters.
SQL expressions should match your database SQL dialect.

**YAML example:**
```yaml
cubes:
  - name: orders
    sql_table: orders

    measures:
      - name: statuses
        sql: "STRING_AGG(status)"
        type: string

    dimensions:
      - name: status
        sql: "UPPER(status)"
        type: string
```

**JavaScript example:**
```js
cube(`orders`, {
  sql_table: `orders`,

  measures: {
    statuses: {
      sql: `STRING_AGG(status)`,
      type: `string`
    }
  },

  dimensions: {
    status: {
      sql: `UPPER(status)`,
      type: `string`
    }
  }
})
```

> **Note:** Cube does not wrap SQL snippets in parentheses during SQL generation.
> In case of non-trivial snippets, this may lead to unexpected results.

### User-Defined Functions

If you have created a user-defined function (UDF) in your data source, you can use it
in the `sql` parameter as well.

### Case Sensitivity

If your database uses case-sensitive identifiers, make sure to properly quote table
and column names.

**YAML example:**
```yaml
cubes:
  - name: orders
    sql_table: 'public."Orders"'
```

**JavaScript example:**
```js
cube(`orders`, {
  sql_table: `public."Orders"`
})
```

---

## References

To write versatile data models, you need to reference members of cubes and views
(measures, dimensions) as well as table columns. Cube supports the following syntax.

### `column`

Use bare column names in the `sql` parameter of measures or dimensions.

```yaml
cubes:
  - name: users
    sql_table: users

    dimensions:
      - name: name
        sql: name
        type: string
```

```js
cube(`users`, {
  sql_table: `users`,

  dimensions: {
    name: {
      sql: `name`,
      type: `string`
    }
  }
})
```

> This works well for simple use cases, but may produce ambiguous SQL when cubes
> have joins with overlapping column names.

---

### `{member}`

Reference other members of the **same cube** by wrapping their names in curly braces.

**YAML example:**
```yaml
cubes:
  - name: users
    sql_table: users

    dimensions:
      - name: name
        sql: name
        type: string

      - name: surname
        sql: "UPPER(surname)"
        type: string

      - name: full_name
        sql: "CONCAT({name}, ' ', {surname})"
        type: string
```

**JavaScript example:**
```js
cube(`users`, {
  sql_table: `users`,

  dimensions: {
    name: {
      sql: `name`,
      type: `string`
    },

    surname: {
      sql: `UPPER(surname)`,
      type: `string`
    },

    full_name: {
      sql: `CONCAT(${name}, ' ', ${surname})`,
      type: `string`
    }
  }
})
```

---

### `{time_dimension.granularity}`

When referencing a time dimension, you can specify a granularity to refer to a time value
at a particular level. This can be one of the default granularities (e.g., `year`, `week`)
or a custom granularity.

**YAML example:**
```yaml
cubes:
  - name: users
    sql_table: users

    dimensions:
      - name: created_at
        sql: created_at
        type: time

        granularities:
          - name: sunday_week
            interval: 1 week
            offset: -1 day

      - name: created_at__year
        sql: "{created_at.year}"
        type: time

      - name: created_at__sunday_week
        sql: "{created_at.sunday_week}"
        type: time
```

**JavaScript example:**
```js
cube(`users`, {
  sql_table: `users`,

  dimensions: {
    created_at: {
      sql: `created_at`,
      type: `time`,

      granularities: {
        sunday_week: {
          interval: `1 week`,
          offset: `-1 day`
        }
      }
    },

    created_at__year: {
      sql: `${created_at.year}`,
      type: `time`
    },

    created_at__sunday_week: {
      sql: `${created_at.sunday_week}`,
      type: `time`
    }
  }
})
```

---

### `{cube}.column`, `{cube.member}`

Qualify column and member names with a cube name to remove ambiguity when cubes
are joined, or to reference members of other cubes.

**YAML example:**
```yaml
cubes:
  - name: users
    sql_table: users

    joins:
      - name: contacts
        sql: "{users}.contact_id = {contacts.id}"
        relationship: one_to_one

    dimensions:
      - name: id
        sql: "{users}.id"
        type: number
        primary_key: true

      - name: name
        sql: "COALESCE({users.name}, {contacts.name})"
        type: string

  - name: contacts
    sql_table: contacts

    dimensions:
      - name: id
        sql: "{contacts}.id"
        type: number
        primary_key: true

      - name: name
        sql: "{contacts}.name"
        type: string
```

**JavaScript example:**
```js
cube(`users`, {
  sql_table: `users`,

  joins: {
    contacts: {
      sql: `${users}.contact_id = ${contacts.id}`,
      relationship: `one_to_one`
    }
  },

  dimensions: {
    id: {
      sql: `${users}.id`,
      type: `number`,
      primary_key: true
    },

    name: {
      sql: `COALESCE(${users}.name, ${contacts.name})`,
      type: `string`
    }
  }
})

cube(`contacts`, {
  sql_table: `contacts`,

  dimensions: {
    id: {
      sql: `${contacts}.id`,
      type: `number`,
      primary_key: true
    },

    name: {
      sql: `${contacts}.name`,
      type: `string`
    }
  }
})
```

> In production, using fully-qualified names is generally encouraged for maintainability.

---

### `{cube1.cube2.member}`

Qualify member names with more than one cube name (separated by dots) to provide a
**join path** and remove ambiguity in join resolution. Join paths can be used in
calculated members, views, and pre-aggregation definitions.

This is especially important for **diamond subgraphs** in the join tree — where cube `a`
joins to `b` and `c`, and both `b` and `c` join to `d`.

**YAML example:**
```yaml
cubes:
  - name: a
    sql: |
      SELECT 1 AS id UNION ALL
      SELECT 2 AS id UNION ALL
      SELECT 3 AS id

    dimensions:
      - name: id
        sql: id
        type: number
        primary_key: true

      - name: d_via_b
        sql: "{b.d.id}"
        type: number

      - name: d_via_c
        sql: "{c.d.id}"
        type: number

    joins:
      - name: b
        sql: "{a.id} = {b.id}"
        relationship: one_to_one

      - name: c
        sql: "{a.id} = {c.id}"
        relationship: one_to_one

  - name: b
    sql: |
      SELECT 1 AS id UNION ALL
      SELECT 2 AS id UNION ALL
      SELECT 3 AS id

    dimensions:
      - name: id
        sql: id
        type: number
        primary_key: true

    joins:
      - name: d
        sql: "{b.id} = {d.id}"
        relationship: one_to_one

  - name: c
    sql: |
      SELECT 1 AS id UNION ALL
      SELECT 2 AS id UNION ALL
      SELECT 3 AS id

    dimensions:
      - name: id
        sql: id
        type: number
        primary_key: true

    joins:
      - name: d
        sql: "{c.id} = {d.id}"
        relationship: one_to_one

  - name: d
    sql: |
      SELECT 1 AS id UNION ALL
      SELECT 2 AS id UNION ALL
      SELECT 3 AS id

    dimensions:
      - name: id
        sql: id
        type: number
        primary_key: true
```

---

### `{CUBE}` Variable

Use the `{CUBE}` context variable (uppercase) to reference the **current cube** without
repeating its name. Works for both column and member references.

**JavaScript example:**
```js
cube(`users`, {
  sql_table: `users`,

  joins: {
    contacts: {
      sql: `${CUBE}.contact_id = ${contacts.id}`,
      relationship: `one_to_one`
    }
  },

  dimensions: {
    id: {
      sql: `${CUBE}.id`,
      type: `number`,
      primary_key: true
    },

    name: {
      sql: `COALESCE(${CUBE}.name, ${contacts.name})`,
      type: `string`
    }
  }
})

cube(`contacts`, {
  sql_table: `contacts`,

  dimensions: {
    id: {
      sql: `${CUBE}.id`,
      type: `number`,
      primary_key: true
    },

    name: {
      sql: `${CUBE}.name`,
      type: `string`
    }
  }
})
```

**YAML example:**
```yaml
cubes:
  - name: users
    sql_table: users

    joins:
      - name: contacts
        sql: "{CUBE}.contact_id = {contacts.id}"
        relationship: one_to_one

    dimensions:
      - name: id
        sql: "{CUBE}.id"
        type: number
        primary_key: true

      - name: name
        sql: "COALESCE({CUBE.name}, {contacts.name})"
        type: string

  - name: contacts
    sql_table: contacts

    dimensions:
      - name: id
        sql: "{CUBE}.id"
        type: number
        primary_key: true

      - name: name
        sql: "{CUBE}.name"
        type: string
```

Referencing another cube in a dimension definition instructs Cube to make an implicit join.
For example, querying `users.name` with the model above generates:

```sql
SELECT COALESCE("users".name, "contacts".name) "users__name"
FROM users "users"
LEFT JOIN contacts "contacts"
  ON "users".contact_id = "contacts".id
```

---

### `{cube.sql()}` Function

Reference the `sql` parameter of another cube to reuse its SQL query. Particularly
useful for polymorphic cubes or data blending.

**JavaScript example:**
```js
cube(`organisms`, {
  sql_table: `organisms`
})

cube(`animals`, {
  sql: `
    SELECT *
    FROM ${organisms.sql()}
    WHERE kingdom = 'animals'
  `
})

cube(`dogs`, {
  sql: `
    SELECT *
    FROM ${animals.sql()}
    WHERE species = 'dogs'
  `,

  measures: {
    count: {
      type: `count`
    }
  }
})
```

**YAML example:**
```yaml
cubes:
  - name: organisms
    sql_table: organisms

  - name: animals
    sql: |
      SELECT *
      FROM {organisms.sql()}
      WHERE kingdom = 'animals'

  - name: dogs
    sql: |
      SELECT *
      FROM {animals.sql()}
      WHERE species = 'dogs'

    measures:
      - name: count
        type: count
```

Querying `dogs.count` generates:

```sql
SELECT count(*) "dogs__count"
FROM (
  SELECT *
  FROM (
    SELECT *
    FROM organisms
    WHERE kingdom = 'animals'
  )
  WHERE species = 'dogs'
) AS "dogs"
```

---

### Curly Braces and Escaping

Within SQL expressions, curly braces are used to reference cubes and members.

- **In YAML**: use `{reference}`
- **In JavaScript**: use `${reference}` inside template literals

**YAML example:**
```yaml
cubes:
  - name: orders
    sql: |
      SELECT id, created_at
      FROM {other_cube.sql()}

    dimensions:
      - name: status
        sql: status
        type: string

      - name: status_x2
        sql: "{status} || ' ' || {status}"
        type: string
```

**JavaScript example:**
```js
cube(`orders`, {
  sql: `
    SELECT id, created_at
    FROM ${other_cube.sql()}
  `,

  dimensions: {
    status: {
      sql: `status`,
      type: `string`
    },

    status_x2: {
      sql: `${status} || ' ' || ${status}`,
      type: `string`
    }
  }
})
```

To use **literal (non-referential) curly braces** in YAML (e.g., for JSON objects),
escape them with a backslash:

```yaml
cubes:
  - name: json_object_in_postgres
    sql: SELECT CAST('\{"key":"value"\}'::JSON AS TEXT) AS json_column

  - name: csv_from_s3_in_duckdb
    sql: |
      SELECT *
      FROM read_csv(
        's3://bbb/aaa.csv',
        delim = ',',
        header = true,
        columns=\{'time':'DATE','count':'NUMERIC'\}
      )
```

---

### Non-SQL References

Outside SQL expressions, bare names are treated as **member names**, not column names.
This means you can skip curly braces and reference members directly as `member`,
`cube_name.member`, or `CUBE.member`.

**YAML example:**
```yaml
cubes:
  - name: orders
    sql_table: orders

    dimensions:
      - name: status
        sql: status
        type: string

    measures:
      - name: count
        type: count

    pre_aggregations:
      - name: orders_by_status
        dimensions:
          - CUBE.status
        measures:
          - CUBE.count
```

**JavaScript example:**
```js
cube(`orders`, {
  sql_table: `orders`,

  dimensions: {
    status: {
      sql: `status`,
      type: `string`
    }
  },

  measures: {
    count: {
      type: `count`
    }
  },

  pre_aggregations: {
    orders_by_status: {
      dimensions: [CUBE.status],
      measures: [CUBE.count]
    }
  }
})
```

---

## Context Variables

In addition to `{CUBE}`, a few more context variables are available within the data model.
They are useful for optimizing generated SQL queries and defining dynamic data models.
See the Context Variables reference for details.

---

## Troubleshooting

### `Can't parse timestamp`

**Error:** `Can't parse timestamp: 2023-11-07T14:33:23.16.000`

This indicates the data source was unable to recognize the value of a time dimension
as a timestamp. Check that the SQL expression of the time dimension evaluates to a
`TIMESTAMP` type. If the column stores time as a string, use a casting expression in
the `sql` parameter to convert it appropriately.
