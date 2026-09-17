"""
app/api/v1/endpoints/ingest.py
-------------------------------
POST /api/v1/ingest

Loads and merges the parquet dataset bundle, stores the resulting
invoice-grain DataFrame on `app.state`, and returns a structured
integrity report.

The heavy pandas work runs in a threadpool via `run_in_threadpool` so a
300k-row merge does not block the async event loop for other requests.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.db import get_db
from app.db_models import User
from app.deps import get_current_user, tenant_key_for
from app.schemas.ingestion import IngestionReport, IngestRequest, IngestResponse
from app.services.loader import SchemaValidationError, load_and_merge_parquet
from app.services.pipeline_history import record_pipeline_run
from app.services.tenant_state import get_tenant_bucket

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["ingest"])


@router.post("/ingest", response_model=IngestResponse)
async def ingest_dataset(
    payload: IngestRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> IngestResponse:
    """Ingest the parquet bundle at `payload.dataset_path`.

    - `strict=True` (default): any FK orphan, duplicate key, or grain
      mismatch aborts the request with HTTP 422 and the violation detail.
    - `strict=False`: ingestion proceeds regardless; the response's
      `report` carries the violation counts and `status` becomes
      "ok_with_warnings" if any were found.

    Requires a valid session (Authorization: Bearer <token>). On success,
    the merged DataFrame is stored in THIS USER'S TENANT'S bucket only
    (app/services/tenant_state.py) — a different business's login never
    sees it, and vice versa.
    """
    tenant_key = tenant_key_for(user)
    try:
        df, load_report = await run_in_threadpool(
            load_and_merge_parquet, payload.dataset_path, payload.strict
        )
    except SchemaValidationError as exc:
        # Only reachable when strict=True; a real integrity violation.
        logger.warning("Ingest rejected for %s: %s", payload.dataset_path, exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        report = IngestionReport.from_load_report(load_report)
    except ValidationError as exc:
        # Defensive: a malformed LoadReport should never reach the client
        # as a raw pandas/pydantic traceback.
        logger.error("IngestionReport validation failed: %s", exc)
        raise HTTPException(status_code=500, detail="Internal report validation error") from exc

    get_tenant_bucket(request.app, tenant_key)["master_frame"] = df

    status = "ok" if report.is_clean else "ok_with_warnings"
    logger.info(
        "Ingest complete: shape=%s status=%s fraud_rate=%s",
        df.shape, status, report.fraud_rate,
    )

    response = IngestResponse(
        status=status,
        master_frame_shape=(df.shape[0], df.shape[1]),
        report=report,
    )

    await run_in_threadpool(
        record_pipeline_run,
        db,
        run_type="INGEST",
        tenant_id=tenant_key,
        request_payload=payload.model_dump(mode="json"),
        response_payload=response.model_dump(mode="json"),
    )

    return response
