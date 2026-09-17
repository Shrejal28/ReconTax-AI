"""
app/services/ml_engine.py
---------------------------
ReconTax AI — Phase 2: LightGBM Calibrated Risk Scorer.

Trains a leaf-wise gradient-boosted binary classifier on the invoice-grain
frame produced by app.services.loader, scores new batches, and buckets
probability outputs into the three operational risk tiers from the PRD
(section 4B).

Design notes:
  - Respects the pre-assigned train/val/test masks from splits.parquet
    (via app.services.loader.split_frame) — this module never re-splits
    or shuffles rows itself, to stay leak-free relative to whatever split
    boundary the rest of the pipeline (and any other model) is using.
  - `scale_pos_weight` is computed FROM THE TRAIN SPLIT'S OWN LABEL
    DISTRIBUTION at train time, not hardcoded to the ~3.5:1 empirical
    ratio observed on this dataset snapshot. Hardcoding it would silently
    go stale the moment the fraud rate drifts in a future data refresh;
    computing it from `train_df` keeps the weighting correct automatically.
  - Early stopping is on validation `binary_logloss` (NOT AUC — see the
    note in train_lgbm_scorer's docstring), never on test, so the test
    split stays untouched until final evaluation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

logger = logging.getLogger(__name__)

TARGET_COL = "is_fraud"
SCORE_COL = "pred_fraud_prob"
TIER_COL = "risk_tier"
TIER_ACTION_COL = "risk_action"

TIER_1_THRESHOLD = 0.85
TIER_2_THRESHOLD = 0.50

# Default hyperparameters per the directive. scale_pos_weight is deliberately
# NOT set here — it's computed per-train-set at call time (see
# compute_scale_pos_weight) and merged in by train_lgbm_scorer.
DEFAULT_LGBM_PARAMS: dict = {
    "boosting_type": "gbdt",
    "objective": "binary",
    # binary_logloss listed FIRST: early stopping below uses
    # first_metric_only=True and monitors this one. auc is still computed
    # and reported each round for visibility, but must not drive the stop
    # decision — see the early-stopping-metric-choice note in
    # train_lgbm_scorer's docstring for why.
    "metric": ["binary_logloss", "auc"],
    "num_leaves": 31,
    "learning_rate": 0.03,
    "verbose": -1,
}


class MLEngineError(ValueError):
    """Raised for invalid inputs to the training/scoring/tiering functions."""


# Feature columns used by this module's own __main__ example and by
# scripts/run_pipeline.py, kept in one place so the two don't drift apart.
# NOTE (leakage): split_invoice_flag and blacklisted_flag are ~98%
# deterministic of is_fraud on the empirical dataset this was built
# against (see changes.md Phase 2 entry) — they read as generated
# alongside the label rather than independently observable. Included
# here for the reference pipeline; exclude them for a more honest read
# on generalization to features available before a fraud determination.
DEFAULT_FEATURE_COLUMNS: list[str] = [
    "invoice_amount",
    "submission_hour",
    "dept_deviation_ratio",
    "supplier_invoice_frequency",
    "supplier_avg_amount_90d",
    "invoice_amount_zscore",
    "duplicate_invoice_flag",
    "split_invoice_flag",
    "late_night_submission_flag",
    "supplier_age_days",
    "supplier_risk_score",
    "blacklisted_flag",
    "avg_invoice_amount",
    "annual_budget",
]


# ---------------------------------------------------------------------------
# Class-imbalance handling
# ---------------------------------------------------------------------------

def compute_scale_pos_weight(y: pd.Series) -> float:
    """Return neg_count / pos_count for the given binary label series.

    On this dataset's train split (~77.9% negative / ~22.1% positive) this
    evaluates to ~3.5, matching the directive's target ratio — but it is
    computed empirically rather than hardcoded, so it stays correct if the
    train split's class balance shifts on a future data refresh.
    """
    pos = int((y == 1).sum())
    neg = int((y == 0).sum())
    if pos == 0:
        raise MLEngineError(
            "Cannot compute scale_pos_weight: train split contains zero positive "
            "(is_fraud=1) examples."
        )
    weight = neg / pos
    logger.info("scale_pos_weight computed from train split: %d neg / %d pos = %.4f", neg, pos, weight)
    return weight


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train_lgbm_scorer(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    feature_cols: list[str],
    target_col: str = TARGET_COL,
    params_override: Optional[dict] = None,
    num_boost_round: int = 2000,
    early_stopping_rounds: int = 50,
) -> lgb.Booster:
    """Train a LightGBM binary classifier with early stopping on `val_df`.

    Parameters
    ----------
    train_df, val_df : DataFrames from app.services.loader.split_frame
        (or any frame carrying `feature_cols` + `target_col`). These must
        already reflect the pre-assigned splits.parquet masks — this
        function does not re-split anything.
    feature_cols : columns to use as model inputs. Passed explicitly
        (rather than inferred) so the caller controls exactly what the
        model sees — e.g. to exclude IDs, dates, and label-adjacent
        columns like fraud_type/fraud_tags.
    params_override : optional dict merged over DEFAULT_LGBM_PARAMS
        (e.g. {"num_leaves": 63} to tune without touching this file).

    Returns
    -------
    lgb.Booster trained with early stopping; `booster.best_iteration` is
    the iteration selected by best validation `binary_logloss`.

    Why stop on logloss, not AUC
    -----------------------------
    AUC is rank-invariant: it only cares whether fraud rows score higher
    than non-fraud rows, not by how much. On this dataset a handful of
    near-deterministic features (see the leakage note below) let the
    model reach near-ceiling AUC after essentially one boosting round —
    but at that point the predicted probabilities are barely nudged off
    the training set's base rate (empirically: max probability ~0.24,
    with `learning_rate=0.03` and 1 tree). Since risk-tiering thresholds
    on ABSOLUTE probability (Tier 1 at p >= 0.85), an AUC-early-stopped
    model would satisfy the ranking metric perfectly while never
    producing a single Tier 1 flag. `binary_logloss` penalizes
    miscalibrated probabilities directly, so early stopping on it
    continues boosting until the probabilities themselves — not just
    their rank order — are well separated. `auc` is still tracked and
    logged each round for visibility, just not used as the stop signal
    (`first_metric_only=True` below pins the stop decision to the first
    metric in DEFAULT_LGBM_PARAMS["metric"], which is `binary_logloss`).

    Leakage note
    ------------
    On the empirical dataset this was built against, `split_invoice_flag`
    and `blacklisted_flag` are ~98% deterministic of `is_fraud` (they
    appear to be generated alongside `fraud_type` by the same synthetic
    process, rather than independently observable signals). Training on
    them produces a model that mirrors those two columns rather than
    learning generalizable fraud patterns from `invoice_amount`,
    behavioral z-scores, etc. This function does not filter feature_cols
    on your behalf — you choose what the model sees — but if the goal is
    a model that would still work when those two columns aren't already
    a giveaway, exclude them from `feature_cols` and expect materially
    lower (but more meaningful) AUC.
    """
    _validate_columns(train_df, feature_cols + [target_col], "train_df")
    _validate_columns(val_df, feature_cols + [target_col], "val_df")

    scale_pos_weight = compute_scale_pos_weight(train_df[target_col])

    params = dict(DEFAULT_LGBM_PARAMS)
    params["scale_pos_weight"] = scale_pos_weight
    if params_override:
        params.update(params_override)

    train_set = lgb.Dataset(train_df[feature_cols], label=train_df[target_col])
    val_set = lgb.Dataset(val_df[feature_cols], label=val_df[target_col], reference=train_set)

    logger.info(
        "Training LightGBM: %d train rows, %d val rows, %d features, params=%s",
        len(train_df), len(val_df), len(feature_cols), params,
    )

    booster = lgb.train(
        params,
        train_set,
        num_boost_round=num_boost_round,
        valid_sets=[train_set, val_set],
        valid_names=["train", "val"],
        callbacks=[
            # first_metric_only=True: the stop decision is driven ONLY by
            # the first metric in params["metric"] (binary_logloss), even
            # though auc is also being computed/reported. See the
            # "Why stop on logloss, not AUC" note above.
            lgb.early_stopping(stopping_rounds=early_stopping_rounds, first_metric_only=True, verbose=False),
            lgb.log_evaluation(period=0),  # silent; caller can re-enable via period>0 if desired
        ],
    )

    val_scores = booster.best_score["val"]
    logger.info(
        "Training complete: best_iteration=%d best_val_logloss=%.5f best_val_auc=%.5f",
        booster.best_iteration,
        val_scores.get("binary_logloss", float("nan")),
        val_scores.get("auc", float("nan")),
    )
    return booster


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_batch(model: lgb.Booster, df: pd.DataFrame, feature_cols: list[str]) -> pd.DataFrame:
    """Score `df` with `model`, returning a COPY of `df` with a new
    `pred_fraud_prob` column (probability of is_fraud == 1).

    Uses `model.best_iteration` automatically when the booster was trained
    with early stopping, so callers don't need to track it separately.
    """
    _validate_columns(df, feature_cols, "df")

    best_iter = getattr(model, "best_iteration", None)
    num_iteration = best_iter if best_iter else None  # None -> lgb uses all trees

    probs = model.predict(df[feature_cols], num_iteration=num_iteration)
    out = df.copy()
    out[SCORE_COL] = probs
    return out


# ---------------------------------------------------------------------------
# Risk-tier post-processing (PRD section 4B)
# ---------------------------------------------------------------------------

def categorize_risk_tiers(
    df_scored: pd.DataFrame,
    score_col: str = SCORE_COL,
    tier1_threshold: float = TIER_1_THRESHOLD,
    tier2_threshold: float = TIER_2_THRESHOLD,
) -> pd.DataFrame:
    """Bucket `score_col` into the three operational risk tiers.

    Adds two columns:
      - `risk_tier`: "TIER_1" | "TIER_2" | "TIER_3"
      - `risk_action`: the downstream routing action for that tier,
        matching the PRD's Section-148-style compliance workflow.

    Tier boundaries (probability p = df_scored[score_col]):
      TIER_1: p >= tier1_threshold        -> "AUTO_QUEUE_COMPLIANCE_NOTICE"
      TIER_2: tier2_threshold <= p < t1    -> "HUMAN_REVIEW_QUEUE"
      TIER_3: p < tier2_threshold          -> "AUDIT_LOG_ONLY"
    """
    if score_col not in df_scored.columns:
        raise MLEngineError(f"'{score_col}' not found — did you call score_batch() first?")
    if not (0.0 <= tier2_threshold < tier1_threshold <= 1.0):
        raise MLEngineError(
            f"Invalid thresholds: require 0 <= tier2_threshold < tier1_threshold <= 1 "
            f"(got tier2={tier2_threshold}, tier1={tier1_threshold})"
        )

    p = df_scored[score_col]
    conditions = [p >= tier1_threshold, p >= tier2_threshold]
    tier_choices = ["TIER_1", "TIER_2"]
    action_choices = ["AUTO_QUEUE_COMPLIANCE_NOTICE", "HUMAN_REVIEW_QUEUE"]

    out = df_scored.copy()
    out[TIER_COL] = np.select(conditions, tier_choices, default="TIER_3")
    out[TIER_ACTION_COL] = np.select(conditions, action_choices, default="AUDIT_LOG_ONLY")
    return out


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

@dataclass
class EvaluationMetrics:
    split_name: str
    n_rows: int
    fraud_rate: float
    roc_auc: float
    average_precision: float
    tier1_threshold: float
    precision_at_tier1: float
    recall_at_tier1: float
    n_flagged_tier1: int

    def as_dict(self) -> dict:
        return {
            "split_name": self.split_name,
            "n_rows": self.n_rows,
            "fraud_rate": self.fraud_rate,
            "roc_auc": self.roc_auc,
            "average_precision": self.average_precision,
            "tier1_threshold": self.tier1_threshold,
            "precision_at_tier1": self.precision_at_tier1,
            "recall_at_tier1": self.recall_at_tier1,
            "n_flagged_tier1": self.n_flagged_tier1,
        }


def evaluate_model(
    df_scored: pd.DataFrame,
    split_name: str,
    target_col: str = TARGET_COL,
    score_col: str = SCORE_COL,
    tier1_threshold: float = TIER_1_THRESHOLD,
) -> EvaluationMetrics:
    """Compute ROC-AUC (threshold-independent) plus precision/recall AT the
    Tier 1 decision boundary (i.e. treating `pred_fraud_prob >= tier1_threshold`
    as the positive prediction) on `df_scored`.

    Precision/recall are reported at Tier 1 specifically — not an
    arbitrary 0.5 cutoff — because Tier 1 is the threshold that triggers
    an automated compliance notice in production; that's the operating
    point whose false-positive/false-negative cost actually matters here.
    """
    if target_col not in df_scored.columns:
        raise MLEngineError(f"'{target_col}' not found in df_scored.")
    if score_col not in df_scored.columns:
        raise MLEngineError(f"'{score_col}' not found — did you call score_batch() first?")

    y_true = df_scored[target_col].to_numpy()
    y_prob = df_scored[score_col].to_numpy()
    y_pred_tier1 = (y_prob >= tier1_threshold).astype(int)

    roc_auc = roc_auc_score(y_true, y_prob)
    ap = average_precision_score(y_true, y_prob)
    precision = precision_score(y_true, y_pred_tier1, zero_division=0)
    recall = recall_score(y_true, y_pred_tier1, zero_division=0)

    metrics = EvaluationMetrics(
        split_name=split_name,
        n_rows=len(df_scored),
        fraud_rate=float(y_true.mean()),
        roc_auc=float(roc_auc),
        average_precision=float(ap),
        tier1_threshold=tier1_threshold,
        precision_at_tier1=float(precision),
        recall_at_tier1=float(recall),
        n_flagged_tier1=int(y_pred_tier1.sum()),
    )
    logger.info("Evaluation [%s]: %s", split_name, metrics.as_dict())
    return metrics


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _validate_columns(df: pd.DataFrame, cols: list[str], df_name: str) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise MLEngineError(f"{df_name} is missing required columns: {missing}")


if __name__ == "__main__":
    import argparse
    import json

    from app.services.loader import load_dataset

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Train and evaluate the ReconTax AI LightGBM scorer.")
    parser.add_argument("data_dir", help="Directory containing the parquet files.")
    args = parser.parse_args()

    splits, load_report = load_dataset(args.data_dir)
    train_df, val_df, test_df = splits["train"], splits["val"], splits["test"]

    feature_cols = DEFAULT_FEATURE_COLUMNS
    # dept_deviation_ratio is NaN for any department with zero train rows;
    # not possible on this dataset (50 departments, 210k train rows), but
    # guarded generically for a future data drop.
    train_df = train_df.dropna(subset=feature_cols)

    booster = train_lgbm_scorer(train_df, val_df, feature_cols)

    val_scored = categorize_risk_tiers(score_batch(booster, val_df, feature_cols))
    test_scored = categorize_risk_tiers(score_batch(booster, test_df, feature_cols))

    val_metrics = evaluate_model(val_scored, "val")
    test_metrics = evaluate_model(test_scored, "test")

    print(json.dumps({"val": val_metrics.as_dict(), "test": test_metrics.as_dict()}, indent=2))
    print("\nval risk_tier distribution:")
    print(val_scored["risk_tier"].value_counts())
    print("\ntest risk_tier distribution:")
    print(test_scored["risk_tier"].value_counts())
