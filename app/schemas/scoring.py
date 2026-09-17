"""
app/schemas/scoring.py
------------------------
Pydantic v2 models for POST /api/v1/score.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from app.services.ml_engine import TIER_1_THRESHOLD, TIER_2_THRESHOLD


class ScoreRequest(BaseModel):
    """Body of POST /api/v1/score."""

    retrain: bool = Field(
        default=False,
        description="If a model was already trained on this app instance, reuse it "
        "unless this is True. Set True after re-ingesting different/updated data.",
    )
    tier1_threshold: float = Field(default=TIER_1_THRESHOLD, ge=0.0, le=1.0)
    tier2_threshold: float = Field(default=TIER_2_THRESHOLD, ge=0.0, le=1.0)


class SplitMetrics(BaseModel):
    """Mirrors app.services.ml_engine.EvaluationMetrics.as_dict()."""

    split_name: str
    n_rows: int = Field(ge=0)
    fraud_rate: float = Field(ge=0.0, le=1.0)
    roc_auc: float = Field(ge=0.0, le=1.0)
    average_precision: float = Field(ge=0.0, le=1.0)
    tier1_threshold: float
    precision_at_tier1: float = Field(ge=0.0, le=1.0)
    recall_at_tier1: float = Field(ge=0.0, le=1.0)
    n_flagged_tier1: int = Field(ge=0)


class RiskTierCounts(BaseModel):
    TIER_1: int = Field(default=0, ge=0)
    TIER_2: int = Field(default=0, ge=0)
    TIER_3: int = Field(default=0, ge=0)


class ScoreResponse(BaseModel):
    """Body of the POST /api/v1/score response."""

    status: str = Field(description='"ok".')
    model_retrained: bool = Field(description="True if training ran this call, False if a cached model was reused.")
    n_scored: int = Field(ge=0, description="Total rows scored (all splits combined).")
    risk_tier_counts: RiskTierCounts = Field(description="Counts across the FULL dataset (all splits).")
    val_metrics: Optional[SplitMetrics] = None
    test_metrics: Optional[SplitMetrics] = None
