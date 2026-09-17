# ReconTax AI

**Procurement Fraud Intelligence Platform** — ingest procurement invoices, score every one with a calibrated ML model, reconcile them against tax/bank telemetry, and draft compliance notices for the invoices that matter most. Multi-tenant, with real auth and tenant isolation enforced on every request.

> Real vs illustrative: LightGBM training, Tesseract OCR, SQLite persistence, bcrypt auth, tenant isolation, and the SHA-256 audit chain are all live and verified end-to-end. SFT/GSTR bank & tax telemetry is **simulated**, not a live filing feed, and the Tax Planning numbers use simplified flat rates — clearly disclaimed, not legal or financial advice.

---
## Screenshots
[screencapture-localhost-5173-2026-09-17-22_29_04.pdf](https://github.com/user-attachments/files/32350220/screencapture-localhost-5173-2026-09-17-22_29_04.pdf)
[screencapture-localhost-5173-triage-2026-09-17-22_33_58.pdf](https://github.com/user-attachments/files/32350266/screencapture-localhost-5173-triage-2026-09-17-22_33_58.pdf)
[screencapture-localhost-5173-triage-2026-09-17-22_33_42.pdf](https://github.com/user-attachments/files/32350264/screencapture-localhost-5173-triage-2026-09-17-22_33_42.pdf)
[screencapture-localhost-5173-tax-planning-2026-09-17-22_34_58.pdf](https://github.com/user-attachments/files/32350263/screencapture-localhost-5173-tax-planning-2026-09-17-22_34_58.pdf)
[screencapture-localhost-5173-scoring-2026-09-17-22_33_04.pdf](https://github.com/user-attachments/files/32350250/screencapture-localhost-5173-scoring-2026-09-17-22_33_04.pdf)
[screencapture-localhost-5173-reconciliation-2026-09-17-22_33_27.pdf](https://github.com/user-attachments/files/32350247/screencapture-localhost-5173-reconciliation-2026-09-17-22_33_27.pdf)
[screencapture-localhost-5173-ingestion-2026-09-17-22_32_40.pdf](https://github.com/user-attachments/files/32350246/screencapture-localhost-5173-ingestion-2026-09-17-22_32_40.pdf)
[screencapture-localhost-5173-ingestion-2026-09-17-22_32_09.pdf](https://github.com/user-attachments/files/32350244/screencapture-localhost-5173-ingestion-2026-09-17-22_32_09.pdf)
[screencapture-localhost-5173-dashboard-2026-09-17-22_29_51.pdf](https://github.com/user-attachments/files/32350238/screencapture-localhost-5173-dashboard-2026-09-17-22_29_51.pdf)
[screencapture-localhost-5173-dashboard-2026-09-17-22_29_51 (1).pdf](https://github.com/user-attachments/files/32350229/screencapture-localhost-5173-dashboard-2026-09-17-22_29_51.1.pdf)
[screencapture-localhost-5173-audit-2026-09-17-22_34_29.pdf](https://github.com/user-attachments/files/32350227/screencapture-localhost-5173-audit-2026-09-17-22_34_29.pdf)


## Table of contents

- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [The pipeline (core workflow)](#the-pipeline-core-workflow)
- [Multi-tenant access & security](#multi-tenant-access--security)
- [Project structure](#project-structure)
- [API reference](#api-reference)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Frontend pages](#frontend-pages)
- [What's real vs illustrative](#whats-real-vs-illustrative)
- [Roadmap](#roadmap)

---

## Tech stack

| Layer | Technology |
|---|---|
| **Client** | React 18 · Vite · TypeScript · Tailwind CSS · React Router |
| **API** | FastAPI on Uvicorn — one REST router per pipeline stage |
| **Scoring engine** | pandas + calibrated LightGBM (Tier 1 / 2 / 3 fraud probability) |
| **OCR engine** | Tesseract (via `pytesseract` + `pdf2image`) — real text extraction, no mocked output |
| **Compliance agent** | LLM call drafts each triage notice, with a deterministic template fallback |
| **Persistence** | SQLite (`SQLAlchemy`) — every pipeline run, OCR commit, tenant, user and session |
| **Auth** | bcrypt-hashed passwords, opaque server-side sessions, per-tenant isolation |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Client — React 18 · Vite · TypeScript · Tailwind                 │
│  one page per pipeline stage                                      │
└───────────────────────────────┬─────────────────────────────────┘
                                 │
┌───────────────────────────────▼─────────────────────────────────┐
│  API — FastAPI on Uvicorn                                         │
│  one REST route per pipeline stage, tenant-scoped on every request│
└──────┬─────────────────┬─────────────────┬──────────────────────┘
       │                 │                 │
┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼───────────┐
│ Scoring     │   │ OCR Engine  │   │ Compliance Agent  │
│ Engine      │   │ Tesseract   │   │ live LLM call,    │
│ pandas +    │   │ text        │   │ deterministic     │
│ LightGBM    │   │ extraction  │   │ template fallback │
└──────┬──────┘   └──────┬──────┘   └──────┬────────────┘
       │                 │                 │
┌──────▼─────────────────▼─────────────────▼──────────────────────┐
│  Persistence & Auth — SQLite                                      │
│  every run, OCR commit, tenant, user and session; bcrypt-hashed   │
│  passwords and opaque server-side sessions enforce tenant isolation│
└─────────────────────────────────────────────────────────────────┘
```

Requests flow client → API → the relevant engine(s) → SQLite, and every pipeline endpoint requires a valid session scoped to the caller's own tenant (see [Multi-tenant access & security](#multi-tenant-access--security)).

## The pipeline (core workflow)

One pipeline, four real stages, driven by the in-process app state (`app.state`) and mirrored to SQLite on every successful call:

| # | Stage | Route | What it does |
|---|---|---|---|
| 01 | **Ingest** | `POST /api/v1/ingest` | Loads and validates the parquet invoice bundle — schema checks, orphan-row detection, dedup, all vectorized pandas. Populates `app.state.master_frame`. |
| 02 | **Score** | `POST /api/v1/score` | A calibrated LightGBM model reads `master_frame` and routes every invoice into Tier 1 / 2 / 3 by fraud probability. Populates `app.state.model`, `app.state.scored_frame`. |
| 03 | **Reconcile** | `POST /api/v1/reconcile` | Cross-checks every invoice against simulated SFT / GSTR telemetry to surface amount mismatches and missing filings. Populates `app.state.reconciled_frame`. |
| 04 | **Triage** | `POST /api/v1/triage/notice` | Stateless — drafts a compliance notice for a flagged invoice from the request body alone: a real LLM call first, a deterministic template if that call isn't available. |

Supporting stages:

- **OCR** (`POST /api/v1/ocr/parse`, `POST /api/v1/ocr/commit`) — real Tesseract extraction over an uploaded invoice image/PDF, staged for review, then committed into the pipeline.
- **Tax Planning** (`POST /api/v1/tax-planning/simulate`) — slides EBITDA, capex and Section 80 deductions through two illustrative regimes (Standard vs. Concessional) and returns a live-computed comparison plus a recommendation flag.
- **Pipeline history** (`GET /api/v1/pipeline/runs`, `GET /api/v1/pipeline/runs/latest/{run_type}`) — every successful ingest/score/reconcile is persisted as a `PipelineRun` row, so values survive a process restart even though live in-memory state doesn't.

## Multi-tenant access & security

```
1. Business requests access          2. Admin approves               3. Business signs in
   POST /api/v1/tenants/request   →      POST /api/v1/admin/         →   POST /api/v1/auth/login
   (company name, GSTIN, email,          tenants/requests/{id}/          lands in their own
   no credentials needed yet)            approve — issues a real         isolated tenant sandbox
                                          bcrypt-hashed login + a
                                          one-time temp password
```

- Every pipeline endpoint requires `Authorization: Bearer <token>` (from `POST /api/v1/auth/login`) and is scoped server-side to the caller's own tenant — enforced on every request, not just hidden in the UI. Verified by a live two-tenant test: neither business can see the other's data.
- Approving a request issues a real bcrypt-hashed login and a one-time temporary password — the backend never stores or displays the plaintext again.
- No client-side shortcuts: the old "any password works" login and the role-switcher pill are gone. Roles come only from the server-verified session.
- **Session Audit Ledger** — every OCR commit and triage disposition (hold/approve) is logged to a SHA-256 hash-chained ledger (actor, role, event type, payload hash), exportable as JSON. "Verified" means the chain is internally consistent right now; it's in-memory for the browser tab and resets on reload.

## Project structure

```
app/                       # FastAPI backend
├── main.py                 # app wiring, router registration, state-flow docs
├── db.py                   # SQLite session + init
├── db_models.py             # SQLAlchemy models
├── deps.py                  # auth/session dependencies
├── api/v1/endpoints/
│   ├── auth.py               # login / logout / me
│   ├── tenants.py             # tenant request + admin approve/reject
│   ├── ingest.py               # Stage 01
│   ├── score.py                 # Stage 02
│   ├── reconcile.py              # Stage 03
│   ├── triage.py                  # Stage 04 — notice drafting
│   ├── ocr.py                      # OCR parse + commit
│   ├── tax_planning.py              # scenario simulator
│   └── pipeline_runs.py              # run history
├── services/
│   ├── loader.py             # parquet loading/validation
│   ├── ml_engine.py           # LightGBM training/scoring
│   ├── reconciliation.py       # SFT/GSTR matching logic
│   ├── ocr_engine.py            # Tesseract extraction
│   ├── agent.py                  # compliance-notice LLM agent + fallback
│   ├── auth.py                    # bcrypt hashing, session tokens
│   ├── security.py                 # tenant-scoping helpers
│   ├── tenant_state.py              # per-tenant in-memory state
│   ├── pipeline_history.py           # PipelineRun persistence
│   └── bootstrap.py                   # seeds the bootstrap admin
└── schemas/                 # Pydantic request/response models, one per stage

frontend/                  # React + Vite + TypeScript dashboard
├── src/pages/               # one page per pipeline stage (see below)
├── src/components/           # shared UI (grids, modals, layout, charts)
├── src/context/                # auth/session context
└── src/lib/                     # API client

scripts/                    # standalone pipeline runner (CLI)
tests/                      # pytest suite (backend)
```

## API reference

All routes are prefixed `/api/v1` unless noted; pipeline routes require a bearer token from `/api/v1/auth/login`.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Authenticate, returns a session token |
| `POST` | `/api/v1/auth/logout` | Invalidate the current session |
| `GET`  | `/api/v1/auth/me` | Current user/tenant info |
| `POST` | `/api/v1/tenants/request` | Public — request platform access |
| `GET`  | `/api/v1/admin/tenants/requests` | Admin — list pending requests |
| `POST` | `/api/v1/admin/tenants/requests/{id}/approve` | Admin — approve + provision (issues credentials) |
| `POST` | `/api/v1/admin/tenants/requests/{id}/reject` | Admin — reject a request |
| `POST` | `/api/v1/ingest` | Stage 01 — load & validate invoice bundle |
| `POST` | `/api/v1/score` | Stage 02 — LightGBM fraud scoring |
| `POST` | `/api/v1/reconcile` | Stage 03 — SFT/GSTR reconciliation |
| `POST` | `/api/v1/triage/notice` | Stage 04 — draft a compliance notice |
| `POST` | `/api/v1/ocr/parse` | OCR — extract fields from an uploaded invoice |
| `POST` | `/api/v1/ocr/commit` | OCR — commit staged/verified fields into the pipeline |
| `POST` | `/api/v1/tax-planning/simulate` | Run the Standard vs. Concessional tax scenario simulator |
| `GET`  | `/api/v1/pipeline/runs` | List persisted pipeline runs |
| `GET`  | `/api/v1/pipeline/runs/latest/{run_type}` | Latest run of a given type (`ingest`/`score`/`reconcile`) |

Interactive docs are available at `/docs` (Swagger UI) once the server is running.

## Getting started

### Backend

```bash
cd app/..                       # repo root
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The first run seeds a bootstrap admin account (see `app/services/bootstrap.py`) and creates `recontax.db` (SQLite) if it doesn't exist. Requires a working `tesseract` binary on `PATH` for OCR.

### Frontend

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

Set `VITE_ENABLE_DEMO_LOGIN` in `frontend/.env.local` if you want the demo-login shortcut in local dev; leave it unset/false for a build that mirrors production auth.

## Testing

```bash
pytest                          # from repo root, with venv active
```

Covers ingestion/loader validation, ML scoring, reconciliation matching, OCR extraction, the triage agent (and its fallback), tax-planning simulation, pipeline-history persistence, and the API layer end-to-end.

## Frontend pages

One page per pipeline stage, plus admin/auth screens:

`LandingPage` · `RequestAccessPage` · `LoginPage` · `AdminProvisioningPage` · `DashboardPage` · `IngestionPage` · `ScoringPage` · `ReconciliationPage` · `TriagePage` · `TaxPlanningPage` · `AuditPage`

## What's real vs illustrative

| | |
|---|---|
| ✅ **Real** | LightGBM training, Tesseract OCR, SQLite persistence, bcrypt auth, tenant isolation, SHA-256 audit chain — all live, all verified end-to-end. |
| ⚠️ **Illustrative** | SFT/GSTR bank & tax telemetry is simulated, not a live filing feed. Tax Planning rates are simplified flat rates, clearly disclaimed — not legal or financial advice. |
| ⚡ **Next** | Connect real SFT/GSTR data feeds, add password rotation for issued accounts, and expand the triage agent's action set beyond notice drafting. |

## Roadmap

- [ ] Connect real SFT/GSTR data feeds (replace the simulated telemetry)
- [ ] Password rotation for issued tenant accounts
- [ ] Expand the triage agent's action set beyond notice drafting
- [ ] Persist the audit ledger beyond the browser tab

---

*Built by Aisshwarya Gurav (frontend) and Shrejal Bhosale (backend).*
