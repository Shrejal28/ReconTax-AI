"""
app/api/v1/endpoints/score.py
--------------------------------
POST /api/v1/score

Wires Phase 2 (app/services/ml_engine.py) into the API: trains (or reuses
a cached) LightGBM booster on app.state.master_frame's 'train'/'val' split
rows, scores the FULL dataset, and returns real risk-tier counts plus
val/test evaluation metrics — no synthetic/placeholder numbers.

Requires POST /api/v1/ingest to have run first in this app process
(app.state.master_frame must exist and carry a 'split' column, which
load_and_merge_parquet always includes).
"""

from __future__ import annotations

import logging

import lightgbm as lgb
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.db import get_db
from app.db_models import User
from app.deps import get_current_user, tenant_key_for
from app.schemas.scoring import RiskTierCounts, ScoreRequest, ScoreResponse, SplitMetrics
from app.services.ml_engine import (
    DEFAULT_FEATURE_COLUMNS,
    MLEngineError,
    categorize_risk_tiers,
    evaluate_model,
    score_batch,
    train_lgbm_scorer,
)
from app.services.pipeline_history import record_pipeline_run
from app.services.tenant_state import get_tenant_bucket

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["score"])


def _train_score_and_evaluate(
    df_master: pd.DataFrame,
    cached_model: lgb.Booster | None,
    retrain: bool,
    tier1_threshold: float,
    tier2_threshold: float,
) -> tuple[lgb.Booster, bool, pd.DataFrame, dict, dict]:
    """Synchronous helper run inside a threadpool by the endpoint below."""
    if "split" not in df_master.columns:
        raise MLEngineError(
            "app.state.master_frame has no 'split' column — was it built by "
            "load_and_merge_parquet (Phase 1), which always includes it?"
        )

    model_retrained = False
    booster = cached_model
    if booster is None or retrain:
        train_df = df_master.loc[df_master["split"] == "train"].dropna(subset=DEFAULT_FEATURE_COLUMNS)
        val_df = df_master.loc[df_master["split"] == "val"]
        booster = train_lgbm_scorer(train_df, val_df, DEFAULT_FEATURE_COLUMNS)
        model_retrained = True

    scored = categorize_risk_tiers(
        score_batch(booster, df_master, DEFAULT_FEATURE_COLUMNS),
        tier1_threshold=tier1_threshold,
        tier2_threshold=tier2_threshold,
    )

    val_metrics = None
    val_rows = scored.loc[scored["split"] == "val"]
    if len(val_rows):
        val_metrics = evaluate_model(val_rows, split_name="val", tier1_threshold=tier1_threshold).as_dict()

    test_metrics = None
    test_rows = scored.loc[scored["split"] == "test"]
    if len(test_rows):
        test_metrics = evaluate_model(test_rows, split_name="test", tier1_threshold=tier1_threshold).as_dict()

    return booster, model_retrained, scored, val_metrics, test_metrics


@router.post("/score", response_model=ScoreResponse)
async def score_dataset(
    payload: ScoreRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScoreResponse:
    """Train (or reuse) a LightGBM scorer and return real risk-tier counts.

    Requires a valid session. Reads/writes THIS USER'S TENANT'S bucket
    only (app/services/tenant_state.py) — a business only ever scores
    its own ingested data, never another tenant's.

    Model caching: the trained booster is cached per-tenant, so repeated
    calls to /score for the same business don't retrain from scratch
    unless `retrain=True` or no model has been trained yet for that
    tenant.
    """
    tenant_key = tenant_key_for(user)
    bucket = get_tenant_bucket(request.app, tenant_key)

    df_master = bucket.get("master_frame")
    if df_master is None:
        raise HTTPException(
            status_code=409,
            detail="No ingested dataset available for this tenant. Call POST /api/v1/ingest first.",
        )

    cached_model = bucket.get("model")

    try:
        booster, model_retrained, scored, val_metrics, test_metrics = await run_in_threadpool(
            _train_score_and_evaluate,
            df_master,
            cached_model,
            payload.retrain,
            payload.tier1_threshold,
            payload.tier2_threshold,
        )
    except MLEngineError as exc:
        logger.warning("Scoring failed: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    bucket["model"] = booster
    bucket["scored_frame"] = scored

    tier_counts = scored["risk_tier"].value_counts().to_dict()
    logger.info(
        "Scoring complete: retrained=%s n_scored=%d tier_counts=%s",
        model_retrained, len(scored), tier_counts,
    )

    response = ScoreResponse(
        status="ok",
        model_retrained=model_retrained,
        n_scored=len(scored),
        risk_tier_counts=RiskTierCounts(**{k: v for k, v in tier_counts.items() if k in RiskTierCounts.model_fields}),
        val_metrics=SplitMetrics(**val_metrics) if val_metrics else None,
        test_metrics=SplitMetrics(**test_metrics) if test_metrics else None,
    )

    await run_in_threadpool(
        record_pipeline_run,
        db,
        run_type="SCORE",
        tenant_id=tenant_key,
        request_payload=payload.model_dump(mode="json"),
        response_payload=response.model_dump(mode="json"),
    )

    return response
