"""
app/api/v1/endpoints/reconcile.py
------------------------------------
POST /api/v1/reconcile

Runs Phase 3 (synthesize_external_telemetry -> compute_reconciliation_features
-> summarize_reconciliation_anomalies) against either:
  - the DataFrame already stored on `app.state.master_frame` by a prior
    POST /api/v1/ingest call in this app process (the default), or
  - a freshly-ingested dataset directory, if `dataset_path` is given in
    the request body.

The reconciled frame is stored on `app.state.reconciled_frame` for later
phases (agent notice generation, dashboard) to consume without redoing
the join/synthesis work.
"""

from __future__ import annotations

import logging

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.db import get_db
from app.db_models import User
from app.deps import get_current_user, tenant_key_for
from app.schemas.reconciliation import ReconcileRequest, ReconcileResponse, ReconciliationSummary
from app.services.loader import load_and_merge_parquet
from app.services.pipeline_history import record_pipeline_run
from app.services.reconciliation import (
    ReconciliationError,
    compute_reconciliation_features,
    get_top_anomalies,
    summarize_reconciliation_anomalies,
    synthesize_external_telemetry,
)
from app.services.tenant_state import get_tenant_bucket

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["reconcile"])


def _run_reconciliation(
    df_master: pd.DataFrame,
    seed: int,
    missing_sft_rate: float,
    missing_gstr_rate: float,
    mismatch_rate: float,
    top_n_anomalies: int,
) -> tuple[pd.DataFrame, dict, pd.DataFrame]:
    """Synchronous helper run inside a threadpool by the endpoint below."""
    sft_df, gstr_df = synthesize_external_telemetry(
        df_master,
        seed=seed,
        missing_sft_rate=missing_sft_rate,
        missing_gstr_rate=missing_gstr_rate,
        mismatch_rate=mismatch_rate,
    )
    df_recon = compute_reconciliation_features(df_master, sft_df, gstr_df)
    summary = summarize_reconciliation_anomalies(df_recon)
    top_anomalies = get_top_anomalies(df_recon, n=top_n_anomalies)
    return df_recon, summary, top_anomalies


@router.post("/reconcile", response_model=ReconcileResponse)
async def reconcile_dataset(
    payload: ReconcileRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReconcileResponse:
    """Run SFT/GSTR reconciliation and return the anomaly summary.

    Requires a valid session. Source-of-data resolution, scoped to THIS
    USER'S TENANT bucket only (app/services/tenant_state.py):
      - `payload.dataset_path` set -> ingest that directory fresh
        (via `load_and_merge_parquet`, strict validation) and use it,
        WITHOUT touching the tenant's cached master_frame.
      - `payload.dataset_path` unset -> require the tenant's
        master_frame to already exist (i.e. POST /api/v1/ingest must
        have run first for this business); 409 if it doesn't.

    On success, the reconciled frame is stored in the tenant's bucket.
    """
    tenant_key = tenant_key_for(user)
    bucket = get_tenant_bucket(request.app, tenant_key)

    if payload.dataset_path is not None:
        try:
            df_master, _load_report = await run_in_threadpool(
                load_and_merge_parquet, payload.dataset_path, True
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        source = payload.dataset_path
    else:
        df_master = bucket.get("master_frame")
        if df_master is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "No ingested dataset available for this tenant. Call POST /api/v1/ingest "
                    "first, or include 'dataset_path' in this request to ingest fresh."
                ),
            )
        source = "tenant.master_frame"

    try:
        df_recon, summary_dict, top_anomalies_df = await run_in_threadpool(
            _run_reconciliation,
            df_master,
            payload.seed,
            payload.missing_sft_rate,
            payload.missing_gstr_rate,
            payload.mismatch_rate,
            payload.top_n_anomalies,
        )
    except ReconciliationError as exc:
        logger.warning("Reconciliation failed: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    bucket["reconciled_frame"] = df_recon

    logger.info(
        "Reconciliation complete: source=%s shape=%s total_exposure=%.2f",
        source, df_recon.shape, summary_dict["total_telemetry_delta_gap"],
    )

    response = ReconcileResponse(
        status="ok",
        source=source,
        reconciled_frame_shape=(df_recon.shape[0], df_recon.shape[1]),
        seed=payload.seed,
        summary=ReconciliationSummary(**summary_dict),
        anomalous_records=top_anomalies_df.to_dict(orient="records"),
    )

    await run_in_threadpool(
        record_pipeline_run,
        db,
        run_type="RECONCILE",
        tenant_id=tenant_key,
        request_payload=payload.model_dump(mode="json"),
        response_payload=response.model_dump(mode="json"),
    )

    return response
