"""
One-time script to repair the two models that break Cube.js compilation.

Problems found (from live Cube.js compile error):
  - clickstream_events: `properties` dimension has type 'json' (not a valid Cube type);
    `count` measure illegally has sql: `COUNT(*)`;
    countDistinct sql fields have redundant DISTINCT keyword.
  - conversions_daily: entirely wrong format — contains a `schema: [...]` block,
    uppercase BQ types (STRING, TIMESTAMP, FLOAT), and `sql: COUNT("*")` (broken syntax).
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from database import get_db
from models import TableMeta

db = next(get_db())

# ── Fixed: clickstream_events ─────────────────────────────────────────────────
# Changes:
#   • Removed `properties` dimension (type 'json' is not valid in Cube.js)
#   • Removed `sql` field from the `count` measure
#   • Removed redundant DISTINCT keyword from countDistinct sql fields
CLICKSTREAM_EVENTS_MODEL = """cube(`clickstream_events`, {
  sql: `SELECT * FROM \`lateral-raceway-466009-s9.fibr_stage.clickstream_events\``,

  measures: {
    count: {
      type: `count`
    },
    count_distinct_user_id: {
      type: `countDistinct`,
      sql: `user_id`
    },
    count_distinct_session_id: {
      type: `countDistinct`,
      sql: `session_id`
    },
    count_distinct_event_type: {
      type: `countDistinct`,
      sql: `event_type`
    },
    count_distinct_page_url: {
      type: `countDistinct`,
      sql: `page_url`
    },
    count_distinct_element_id: {
      type: `countDistinct`,
      sql: `element_id`
    },
    count_distinct_experiment_id: {
      type: `countDistinct`,
      sql: `experiment_id`
    },
    count_distinct_variant_id: {
      type: `countDistinct`,
      sql: `variant_id`
    },
    count_distinct_device_type: {
      type: `countDistinct`,
      sql: `device_type`
    },
    count_distinct_geo_country: {
      type: `countDistinct`,
      sql: `geo_country`
    },
    count_distinct_utm_source: {
      type: `countDistinct`,
      sql: `utm_source`
    }
  },

  dimensions: {
    event_id: {
      sql: `event_id`,
      type: `string`,
      primary_key: true
    },
    event_timestamp: {
      sql: `event_timestamp`,
      type: `time`
    },
    user_id: {
      sql: `user_id`,
      type: `string`
    },
    session_id: {
      sql: `session_id`,
      type: `string`
    },
    event_type: {
      sql: `event_type`,
      type: `string`
    },
    page_url: {
      sql: `page_url`,
      type: `string`
    },
    element_id: {
      sql: `element_id`,
      type: `string`
    },
    experiment_id: {
      sql: `experiment_id`,
      type: `string`
    },
    variant_id: {
      sql: `variant_id`,
      type: `string`
    },
    device_type: {
      sql: `device_type`,
      type: `string`
    },
    geo_country: {
      sql: `geo_country`,
      type: `string`
    },
    utm_source: {
      sql: `utm_source`,
      type: `string`
    },
    ingested_at: {
      sql: `ingested_at`,
      type: `time`
    }
  }
});"""

# ── Fixed: conversions_daily ──────────────────────────────────────────────────
# Changes:
#   • Removed the entire invalid `schema: [...]` block
#   • Replaced all uppercase BQ types with correct Cube.js lowercase types
#   • Rewrote `count` measure: removed `sql: COUNT("*")` (count needs no sql)
#   • Added meaningful sum/avg measures on revenue_usd
#   • Added primary_key on conversion_id
CONVERSIONS_DAILY_MODEL = """cube(`conversions_daily`, {
  sql: `SELECT * FROM \`lateral-raceway-466009-s9.fibr_stage.conversions_daily\``,

  measures: {
    count: {
      type: `count`
    },
    total_revenue_usd: {
      type: `sum`,
      sql: `revenue_usd`
    },
    avg_revenue_usd: {
      type: `avg`,
      sql: `revenue_usd`
    }
  },

  dimensions: {
    conversion_id: {
      type: `string`,
      sql: `conversion_id`,
      primary_key: true
    },
    session_id: {
      type: `string`,
      sql: `session_id`
    },
    conversion_timestamp: {
      type: `time`,
      sql: `conversion_timestamp`
    },
    conversion_type: {
      type: `string`,
      sql: `conversion_type`
    },
    revenue_usd: {
      type: `number`,
      sql: `revenue_usd`
    },
    attribution_source: {
      type: `string`,
      sql: `attribution_source`
    },
    ingested_at: {
      type: `time`,
      sql: `ingested_at`
    }
  }
});"""

fixes = {
    ("fibr_stage", "clickstream_events"): CLICKSTREAM_EVENTS_MODEL,
    ("fibr_stage", "conversions_daily"):  CONVERSIONS_DAILY_MODEL,
}

updated = 0
for (dataset_id, table_id), new_model in fixes.items():
    row = db.query(TableMeta).filter_by(dataset_id=dataset_id, table_id=table_id).first()
    if row:
        row.cube_model = new_model
        updated += 1
        print(f"  ✓ Fixed {dataset_id}.{table_id}")
    else:
        print(f"  ✗ Not found: {dataset_id}.{table_id}")

db.commit()
print(f"\nDone. Updated {updated} models.")
