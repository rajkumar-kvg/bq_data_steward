# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**BQ Steward** — a web app for managing BigQuery connections, browsing datasets/tables, and auto-generating Cube.js semantic data models with LLM-powered metadata enrichment.

## Development Commands

### Full Stack (Docker)
```bash
docker-compose up --build    # Start all services (PostgreSQL, FastAPI, React, Cube.js)
```

### Backend (FastAPI)
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql://steward:steward@localhost:5432/steward
uvicorn main:app --reload    # Dev server on :8000

# Utility scripts
python test_llm.py            # Test LLM connectivity and prompt output
python regenerate_models.py   # Regenerate all Cube.js models via LLM
python fix_all_models.py      # Fix broken Cube.js models
```

### Frontend (React + Vite)
```bash
cd frontend
npm install
VITE_API_URL=http://localhost:8000 npm run dev   # Dev server on :5173
npm run build                                     # Production build
npm run lint                                      # ESLint
```

## Architecture

### Three-Tier Stack
- **Frontend**: React 19 + Vite, single SPA with Axios for API calls and Cube.js client for analytics queries
- **Backend**: FastAPI + SQLAlchemy 2.0, PostgreSQL 15 via psycopg2
- **Semantic Layer**: Cube.js on port 4000, backed by BigQuery

### Core Data Flow
1. User uploads GCP service account JSON → backend validates and stores credentials
2. User syncs datasets → backend fetches from BigQuery API, caches in PostgreSQL
3. User selects a table → frontend fetches BigQuery schema via backend
4. User triggers AI generation → LLM (OpenAI-compatible) generates column definitions, metrics, or Cube.js JS models
5. Cube.js dynamically pulls credentials (`GET /connections/{id}/credentials`) and models (`GET /connections/{id}/cube-models/internal`) from the backend at query time
6. Frontend queries Cube.js REST API → renders KPI dashboards

### Backend Structure (`/backend`)
- `main.py` — all ~20 API endpoint definitions (~570 lines)
- `models.py` — SQLAlchemy ORM: `Connection`, `DatasetMeta`, `TableMeta`
- `schemas.py` — Pydantic request/response models
- `bigquery_utils.py` — BigQuery API client utilities
- `llm_utils.py` — LLM generation functions for columns, metrics, and Cube models (~318 lines)
- `database.py` — SQLAlchemy engine and session setup

### Frontend Structure (`/frontend/src`)
- `App.jsx` — main layout with sidebar navigation
- `api.js` — Axios client wrapping all backend API calls
- `components/ConnectionForm.jsx` — create connections via service account JSON upload
- `components/ConnectionDetail.jsx` — browse datasets and tables for a connection
- `components/DatasetPanel.jsx` — dataset list and sync UI
- `components/TableDetail.jsx` — table metadata editor: schema, definitions, metrics, Cube model (~805 lines)
- `components/KPIDashboard.jsx` — Cube.js query builder and dashboard renderer

### Cube.js Integration (`/cube`)
- `cube/cube.js` — configures BigQuery driver factory, authentication, and dynamic model repository (fetches models from backend)
- `cube/model/` — intentionally empty; Cube.js loads models dynamically from backend

### Key Reference File
- `cube_data_model_syntax.md` — Cube.js OLAP model syntax reference used as context in LLM prompts for model generation

## Environment Variables

```
DATABASE_URL          # PostgreSQL connection (docker: postgresql://steward:steward@db:5432/steward)
VITE_API_URL          # Backend URL for frontend (default: http://localhost:8000)
LLM_OPENAI_API_KEY    # OpenAI-compatible API key
LLM_BASE_URL          # LLM endpoint (default: https://api.openai.com/v1)
LLM_MODEL_NAME        # Model name (default: gpt-3.5-turbo)
```

Copy `.env.example` to `.env` before first run.

## Services & Ports

| Service    | Port | Notes                        |
|------------|------|------------------------------|
| PostgreSQL | 5432 | credentials: steward/steward |
| FastAPI    | 8000 | `/docs` for Swagger UI       |
| React      | 5173 | Vite dev server              |
| Cube.js    | 4000 | `/cubejs-api/v1`             |

---

## Claude Code Configuration (`.claude/`)

### Skills

Load a skill when working in its domain. Skills are in `.claude/skills/`.

| Skill | When to load |
|---|---|
| `bq-schema-reader` | Working on schema sync, column definitions, BQ introspection code, or `bigquery_utils.py` |
| `cube-model-generator` | Generating, editing, or reviewing Cube.js JS models; modifying Cube model prompts in `llm_utils.py` |
| `data-steward-architecture` | Starting any backend or full-stack task; need module map, API contracts, or naming conventions |
| `llm-prompt-patterns` | Modifying `llm_utils.py` prompts, adding a new generation function, or tuning temperature/output format |

### Hooks (active)

Hooks are wired in `.claude/settings.json` and run automatically.

| Hook | Trigger | What it does |
|---|---|---|
| `pre_tool_validate.py` | Before every Bash call | Blocks `git push` to main/master; blocks `DROP TABLE`/`DELETE FROM` BQ commands; logs all Bash calls to `.claude/logs/tool_calls.log` |
| `post_edit_lint.py` | After every Write/Edit | Runs `ruff check` on Python files (warn-only); validates required keys in `/prompts/*.yaml`; validates `cube(` root in Cube model JS files |
| `session_context_inject.py` | On every user prompt | Prepends today's date and current git branch to the prompt |

### Sub-agents

Invoke sub-agents by delegating to them explicitly: "use the `cube-model-reviewer` agent to validate this model."

| Agent | Purpose | When to invoke |
|---|---|---|
| `bq-explorer` | Read-only BQ schema researcher | When a new table is added to Data-Steward and you need schema, partition, clustering, and size info |
| `cube-model-reviewer` | Cube model quality validator | After generating any Cube JS model, before saving to `TableMeta.cube_model` |
| `metric-designer` | Business metric ideation | During metric generation step; give it the column definitions and business context |

---

## Project Conventions

### Naming
- Backend files: `snake_case.py`
- API route parameters: `conn_id`, `dataset_id`, `table_id` (never bare `id`)
- SQLAlchemy models: PascalCase class, `snake_case` columns
- Pydantic schemas: `{Model}Out` for responses, `{Model}Create` for creation requests
- Frontend components: PascalCase `.jsx`
- API functions in `api.js`: camelCase, verb-first (`getConnections`, `generateColumns`)

### Adding a new LLM generation feature
1. Add generation function to `llm_utils.py`
2. Add endpoint to `main.py` under the table metadata route group
3. Add `api.js` function (camelCase, verb-first)
4. Wire UI trigger in `TableDetail.jsx`
5. Update Pydantic schema in `schemas.py` if response shape is new
6. Test with `python backend/test_llm.py` before full integration

### Cube model storage
Cube models are stored as raw JavaScript strings in `TableMeta.cube_model`. They are served at runtime via `GET /connections/{id}/cube-models/internal` — Cube.js evaluates them dynamically. Never write static `.js` files to `cube/model/` by hand.
