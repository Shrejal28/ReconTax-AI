"""
app/services/pipeline_history.py
------------------------------------
Thin helper the ingest/score/reconcile endpoints call, after building a
successful response, to persist it to SQLite (see app/db.py,
app/db_models.py). Isolated here so the endpoint modules don't each need
their own SQLAlchemy error-handling boilerplate.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.db_models import PipelineRun

logger = logging.getLogger(__name__)


def record_pipeline_run(
    db: Session,
    *,
    run_type: str,
    tenant_id: int,
    request_payload: dict[str, Any],
    response_payload: dict[str, Any],
) -> None:
    """Insert one PipelineRun row and commit.

    tenant_id scopes this run to one business (or app.deps's
    PLATFORM_ADMIN_TENANT_KEY for a platform admin's own sandbox use) —
    see app/db_models.py's PipelineRun docstring.

    Persistence failures are logged, not raised: the caller already has
    a valid, successful response to return to the client by the time
    this runs, and a database hiccup (locked file, disk full) shouldn't
    turn that success into a 500. This is best-effort history layered on
    top of the request/response cycle, not part of its correctness.
    """
    try:
        db.add(
            PipelineRun(
                run_type=run_type,
                tenant_id=tenant_id,
                request_payload=request_payload,
                response_payload=response_payload,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to persist pipeline run history (run_type=%s)", run_type)
