# BQ Steward — BigQuery Connection Manager

A simple, fast, and user-friendly web app for managing BigQuery connections via service account JSON keys. Built with **React**, **FastAPI**, and **PostgreSQL**.

## Features

- 🔑 **Add connections** — paste or drag-and-drop a GCP service account JSON key
- ✅ **Test connection** — verify credentials against the BigQuery API
- 📂 **List datasets** — browse all datasets in the project
- 📋 **List tables** — expand any dataset to see its tables (lazy-loaded)
- 🗑️ **Delete connections** — remove saved connections

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (Vite), Vanilla CSS |
| Backend | FastAPI, SQLAlchemy |
| Database | PostgreSQL 15 |
| BQ Client | google-cloud-bigquery |

## Quick Start (Docker)

```bash
git clone <repo>
cd prototype-data-steward
docker-compose up --build
```

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:8000
- **Swagger UI:** http://localhost:8000/docs

## Local Development

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql://steward:steward@localhost:5432/steward
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
VITE_API_URL=http://localhost:8000 npm run dev
```

## Service Account Setup

1. In GCP Console, go to **IAM & Admin → Service Accounts**
2. Create a service account with the **BigQuery Data Viewer** role
3. Generate a **JSON key** and download it
4. Paste or upload the JSON in the app

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://steward:steward@db:5432/steward` | Postgres connection string |
| `VITE_API_URL` | `http://localhost:8000` | Backend API URL for the frontend |
