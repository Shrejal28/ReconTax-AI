"""
app/api/v1/endpoints/pipeline_runs.py
------------------------------------------
GET /api/v1/pipeline/runs
GET /api/v1/pipeline/runs/latest/{run_type}

Read-only endpoints over the SQLite pipeline-run history (app/db.py,
app/db_models.py, app/services/pipeline_history.py). Requires a valid
session and is always scoped to the requesting user's own tenant
(app/deps.py's tenant_key_for) — one business can never see another's
run history through these endpoints.

See app/db.py's module docstring for what this does and doesn't restore
after a restart: it's a durable log of what each successful Ingest/
Score/Reconcile call actually returned, not a way to skip re-running
them — the tenant's live pipeline state still starts empty in a fresh
process (app/services/tenant_state.py).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.db_models import PipelineRun, User
from app.deps import get_current_user, tenant_key_for
from app.schemas.pipeline_run import PipelineRunOut, RunType

router = APIRouter(prefix="/api/v1/pipeline", tags=["pipeline-history"])


@router.get("/runs", response_model=list[PipelineRunOut])
def list_pipeline_runs(
    run_type: RunType | None = Query(default=None, description="Filter to one run type."),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[PipelineRun]:
    """Most recent runs first, optionally filtered to one run_type.
    Always scoped to the caller's own tenant."""
    tenant_key = tenant_key_for(user)
    stmt = (
        select(PipelineRun)
        .where(PipelineRun.tenant_id == tenant_key)
        .order_by(PipelineRun.created_at.desc())
        .limit(limit)
    )
    if run_type is not None:
        stmt = stmt.where(PipelineRun.run_type == run_type)
    return list(db.execute(stmt).scalars().all())


@router.get("/runs/latest/{run_type}", response_model=PipelineRunOut)
def latest_pipeline_run(
    run_type: RunType, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> PipelineRun:
    """The single most recent persisted run of the given type for the
    caller's own tenant, or 404 if none has ever completed successfully."""
    tenant_key = tenant_key_for(user)
    stmt = (
        select(PipelineRun)
        .where(PipelineRun.run_type == run_type, PipelineRun.tenant_id == tenant_key)
        .order_by(PipelineRun.created_at.desc())
        .limit(1)
    )
    run = db.execute(stmt).scalars().first()
    if run is None:
        raise HTTPException(status_code=404, detail=f"No persisted {run_type} run found yet for this tenant.")
    return run
