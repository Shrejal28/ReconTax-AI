"""
app/main.py — ReconTax AI FastAPI entry point.

App wiring for Phase 1 (ingestion), Phase 2 (scoring), Phase 3
(reconciliation), and the Phase 3.5 triage-notice stub (placeholder for
the real Phase 4 LangChain/Gemini agent — see
app/api/v1/endpoints/triage.py's module docstring).

State flow across requests, within one running app process:
  POST /api/v1/ingest     -> populates app.state.master_frame
  POST /api/v1/score      -> reads app.state.master_frame
                              -> populates app.state.model, app.state.scored_frame
  POST /api/v1/reconcile  -> reads app.state.master_frame (or ingests
                              fresh if dataset_path is given in its body)
                              -> populates app.state.reconciled_frame
  POST /api/v1/triage/notice -> stateless; drafts a notice from the
                              request body alone (template stub — see
                              endpoint docstring)

Persistence: every successful ingest/score/reconcile response above is
ALSO written to a SQLite database (app/db.py) as a PipelineRun row, so
the values survive a process restart even though the live pipeline
state does not. GET /api/v1/pipeline/runs and
GET /api/v1/pipeline/runs/latest/{type} read that history back. See
app/db.py's module docstring for the exact scope of what this does and
doesn't persist.

Multi-tenant auth: every pipeline endpoint above now requires a valid
session (Authorization: Bearer <token>, from POST /api/v1/auth/login)
and is scoped to the caller's own tenant — see app/deps.py,
app/services/tenant_state.py, and app/api/v1/endpoints/{auth,tenants}.py.
A business gets an account through POST /api/v1/tenants/request (public)
followed by an ADMIN's POST /api/v1/admin/tenants/requests/{id}/approve,
which creates the Tenant, a real bcrypt-hashed User, and returns a
one-time temporary password.
"""

from fastapi import FastAPI

from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.ingest import router as ingest_router
from app.api.v1.endpoints.ocr import router as ocr_router
from app.api.v1.endpoints.pipeline_runs import router as pipeline_runs_router
from app.api.v1.endpoints.reconcile import router as reconcile_router
from app.api.v1.endpoints.score import router as score_router
from app.api.v1.endpoints.tax_planning import router as tax_planning_router
from app.api.v1.endpoints.tenants import router as tenants_router
from app.api.v1.endpoints.triage import router as triage_router
from app.db import SessionLocal, init_db
from app.services.bootstrap import seed_bootstrap_admin

app = FastAPI(title="ReconTax AI", version="0.1.0")

app.include_router(ingest_router)
app.include_router(score_router)
app.include_router(reconcile_router)
app.include_router(triage_router)
app.include_router(tax_planning_router)
app.include_router(pipeline_runs_router)
app.include_router(ocr_router)
app.include_router(auth_router)
app.include_router(tenants_router)

# Create tables (if missing) and seed the bootstrap ADMIN account (if no
# ADMIN exists yet). Called at import time rather than via an
# @app.on_event("startup") handler, because that handler only fires
# under a real ASGI lifespan (uvicorn, or TestClient used as a `with`
# context manager) — a plain TestClient(app) instance, as this project's
# test fixtures use, never triggers it. init_db()/seed_bootstrap_admin()
# are both idempotent, so calling them unconditionally here is safe on
# every import.
init_db()
_seed_db = SessionLocal()
try:
    seed_bootstrap_admin(_seed_db)
finally:
    _seed_db.close()

# CORS: the frontend dev server proxies /api -> this app (per the Vite
# proxy config), so no cross-origin requests actually happen in dev.
# Left unconfigured here deliberately; add fastapi.middleware.cors if the
# frontend is ever served from a different origin than the API in prod.


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
