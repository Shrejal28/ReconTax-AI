"""
app/services/loader.py
-----------------------
ReconTax AI — Phase 1: Multi-Table Parquet Loader

Loads the procurement/invoice fraud dataset (invoices, suppliers, departments,
labels, behavioural_features, splits) from a directory of parquet files,
validates relational integrity, performs a vectorized join sequence, and
returns train/val/test feature frames aligned to the pre-computed splits.

Empirical ground truth this loader was built against (see audit notes):
  - invoices, labels, behavioural_features, splits are all 300k rows,
    1:1 on `invoice_id`, zero missing keys in either direction.
  - suppliers (2,000 rows) and departments (50 rows) are dimension tables
    with zero orphan foreign keys from invoices.
  - is_fraud positive rate ≈ 22.1% (not extreme rare-event imbalance).
  - behavioural_features is already row-level (1 row per invoice), NOT a
    supplier+window aggregate — no custom rolling groupby is needed to
    bring it in.
  - splits.parquet assigns train/val/test per invoice_id; this loader does
    NOT perform its own random split, to avoid leakage/inconsistency with
    any other pipeline (e.g. the LightGBM trainer) reading the same splits.

No row-wise Python loops are used anywhere in the merge path — every join
is a vectorized pandas `merge`, and validation uses vectorized set/isin
operations rather than iterrows().
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

import pandas as pd

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REQUIRED_TABLES = (
    "invoices",
    "suppliers",
    "departments",
    "labels",
    "behavioural_features",
    "splits",
)

VALID_SPLITS = {"train", "val", "test"}


class SchemaValidationError(ValueError):
    """Raised when the dataset fails a relational-integrity or grain check."""


@dataclass
class LoadReport:
    """Diagnostics captured while loading, for logging / API responses / audit trail."""

    row_counts: Dict[str, int] = field(default_factory=dict)
    orphan_supplier_rows: int = 0
    orphan_department_rows: int = 0
    missing_label_rows: int = 0
    missing_behavioural_rows: int = 0
    missing_split_rows: int = 0
    duplicate_invoice_ids: int = 0
    fraud_rate: Optional[float] = None
    split_counts: Dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "row_counts": self.row_counts,
            "orphan_supplier_rows": self.orphan_supplier_rows,
            "orphan_department_rows": self.orphan_department_rows,
            "missing_label_rows": self.missing_label_rows,
            "missing_behavioural_rows": self.missing_behavioural_rows,
            "missing_split_rows": self.missing_split_rows,
            "duplicate_invoice_ids": self.duplicate_invoice_ids,
            "fraud_rate": self.fraud_rate,
            "split_counts": self.split_counts,
        }


# ---------------------------------------------------------------------------
# Raw table loading
# ---------------------------------------------------------------------------

def load_raw_tables(data_dir: str | Path) -> Dict[str, pd.DataFrame]:
    """Read the required parquet files from `data_dir` into a dict of DataFrames.

    Raises FileNotFoundError early (per-file) rather than letting pandas
    raise an opaque error later, so a missing file is obvious immediately.
    """
    data_dir = Path(data_dir)
    tables: Dict[str, pd.DataFrame] = {}
    for name in REQUIRED_TABLES:
        path = data_dir / f"{name}.parquet"
        if not path.exists():
            raise FileNotFoundError(f"Required table missing: {path}")
        tables[name] = pd.read_parquet(path)
        logger.info("Loaded %s: %s rows, %s cols", name, *tables[name].shape)
    return tables


# ---------------------------------------------------------------------------
# Validation (vectorized — no iterrows/apply-per-row)
# ---------------------------------------------------------------------------

def validate_tables(tables: Dict[str, pd.DataFrame], strict: bool = True) -> LoadReport:
    """Validate primary-key cardinality and foreign-key integrity.

    All checks are vectorized (`Series.duplicated`, `Series.isin`) — O(n)
    hash-based operations, not per-row Python.

    If `strict` is True, any violation raises SchemaValidationError. If
    False, violations are recorded in the returned LoadReport but do not
    raise (useful for exploratory profiling of a new data drop).
    """
    invoices = tables["invoices"]
    suppliers = tables["suppliers"]
    departments = tables["departments"]
    labels = tables["labels"]
    behavioural = tables["behavioural_features"]
    splits = tables["splits"]

    report = LoadReport(row_counts={k: len(v) for k, v in tables.items()})

    # --- Primary key cardinality on invoices ---
    dup_mask = invoices["invoice_id"].duplicated()
    report.duplicate_invoice_ids = int(dup_mask.sum())
    if strict and report.duplicate_invoice_ids:
        raise SchemaValidationError(
            f"invoices.invoice_id has {report.duplicate_invoice_ids} duplicate rows; "
            "expected 1 row per invoice_id."
        )

    # --- Foreign key: invoices.supplier_id -> suppliers.supplier_id ---
    valid_supplier_ids = suppliers["supplier_id"]
    orphan_supplier_mask = ~invoices["supplier_id"].isin(valid_supplier_ids)
    report.orphan_supplier_rows = int(orphan_supplier_mask.sum())
    if strict and report.orphan_supplier_rows:
        raise SchemaValidationError(
            f"{report.orphan_supplier_rows} invoice rows reference a supplier_id "
            "not present in suppliers.parquet."
        )

    # --- Foreign key: invoices.department_id -> departments.department_id ---
    valid_dept_ids = departments["department_id"]
    orphan_dept_mask = ~invoices["department_id"].isin(valid_dept_ids)
    report.orphan_department_rows = int(orphan_dept_mask.sum())
    if strict and report.orphan_department_rows:
        raise SchemaValidationError(
            f"{report.orphan_department_rows} invoice rows reference a department_id "
            "not present in departments.parquet."
        )

    # --- 1:1 grain checks: labels, behavioural_features, splits vs invoices ---
    invoice_ids = invoices["invoice_id"]

    missing_labels_mask = ~invoice_ids.isin(labels["invoice_id"])
    report.missing_label_rows = int(missing_labels_mask.sum())
    if strict and report.missing_label_rows:
        raise SchemaValidationError(
            f"{report.missing_label_rows} invoices have no matching row in labels.parquet."
        )

    missing_behav_mask = ~invoice_ids.isin(behavioural["invoice_id"])
    report.missing_behavioural_rows = int(missing_behav_mask.sum())
    if strict and report.missing_behavioural_rows:
        raise SchemaValidationError(
            f"{report.missing_behavioural_rows} invoices have no matching row in "
            "behavioural_features.parquet."
        )

    missing_split_mask = ~invoice_ids.isin(splits["invoice_id"])
    report.missing_split_rows = int(missing_split_mask.sum())
    if strict and report.missing_split_rows:
        raise SchemaValidationError(
            f"{report.missing_split_rows} invoices have no split assignment in splits.parquet."
        )

    # --- Split value sanity ---
    bad_splits = set(splits["split"].unique()) - VALID_SPLITS
    if bad_splits:
        msg = f"splits.parquet contains unexpected split labels: {bad_splits}"
        if strict:
            raise SchemaValidationError(msg)
        logger.warning(msg)
    report.split_counts = splits["split"].value_counts().to_dict()

    # --- Class balance (informational, not a failure condition) ---
    if "is_fraud" in labels.columns:
        report.fraud_rate = float(labels["is_fraud"].mean())

    return report


# ---------------------------------------------------------------------------
# Join sequence (all vectorized pandas merges)
# ---------------------------------------------------------------------------

def build_master_frame(tables: Dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Join the six tables into a single invoice-grain feature/label frame.

    Join sequence (matches the empirically-verified relational structure):
      1. invoices  INNER JOIN  labels               on invoice_id
      2.    ...    INNER JOIN  splits                on invoice_id
      3.    ...    LEFT  JOIN  suppliers             on supplier_id
      4.    ...    LEFT  JOIN  departments           on department_id
      5.    ...    LEFT  JOIN  behavioural_features  on invoice_id

    Inner joins are used for labels/splits because every invoice is
    expected to have both (verified: zero missing in either direction);
    an inner join here is a correctness assertion as much as a join —
    if a future data drop breaks that guarantee, row counts will visibly
    drop rather than silently producing NaN labels.

    Left joins are used for the dimension tables and behavioural_features
    so that a genuinely new/unseen supplier or department (which does not
    occur in the current data, but could in a future drop) degrades to
    NaN dimension attributes rather than silently dropping the invoice
    from the training set.
    """
    invoices = tables["invoices"]
    suppliers = tables["suppliers"]
    departments = tables["departments"]
    labels = tables["labels"]
    behavioural = tables["behavioural_features"]
    splits = tables["splits"]

    n_start = len(invoices)

    df = invoices.merge(
        labels[["invoice_id", "is_fraud", "fraud_type", "fraud_tags"]],
        on="invoice_id",
        how="inner",
        validate="one_to_one",
    )
    df = df.merge(
        splits[["invoice_id", "split"]],
        on="invoice_id",
        how="inner",
        validate="one_to_one",
    )
    df = df.merge(
        suppliers,
        on="supplier_id",
        how="left",
        validate="many_to_one",
    )
    df = df.merge(
        departments,
        on="department_id",
        how="left",
        validate="many_to_one",
    )
    df = df.merge(
        behavioural,
        on="invoice_id",
        how="left",
        validate="one_to_one",
    )

    n_end = len(df)
    if n_end != n_start:
        # `validate=` above already guards against fan-out duplication;
        # this is a belt-and-suspenders check against row loss from the
        # inner joins silently dropping invoices.
        logger.warning(
            "Row count changed during master-frame join: %s -> %s (%s dropped)",
            n_start, n_end, n_start - n_end,
        )

    return df


# ---------------------------------------------------------------------------
# Feature engineering (section 4A of the spec — vectorized, no per-row loops)
# ---------------------------------------------------------------------------

def add_engineered_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add the Phase 1 feature-engineering columns from spec section 4A.

    1. dept_deviation_ratio: invoice_amount / mean(invoice_amount by department_id)
       — computed on TRAIN split only, then applied to all rows, to avoid
       leaking val/test distribution into the ratio's denominator.
    3. supplier_invoice_frequency: already provided as
       `supplier_invoice_count_30d` in behavioural_features — reused
       rather than recomputed (see loader module docstring / directive
       item 2). Aliased here for naming clarity in downstream code.

    telemetry_delta_gap is NOT computed here: it depends on
    `sft_bank_ledgers` / `gstr_filings`, which do not exist in this
    dataset and are synthesized in reconciliation.py (Phase 3).
    """
    df = df.copy()

    train_mask = df["split"] == "train"
    dept_mean_amount = (
        df.loc[train_mask]
        .groupby("department_id")["invoice_amount"]
        .mean()
    )
    # map() is a vectorized lookup, not a per-row Python loop
    df["dept_mean_amount_train"] = df["department_id"].map(dept_mean_amount)
    df["dept_deviation_ratio"] = df["invoice_amount"] / df["dept_mean_amount_train"]

    df["supplier_invoice_frequency"] = df["supplier_invoice_count_30d"]

    return df


# ---------------------------------------------------------------------------
# Split slicing
# ---------------------------------------------------------------------------

def split_frame(df: pd.DataFrame) -> Dict[str, pd.DataFrame]:
    """Slice the master frame into train/val/test using the `split` column
    that came from splits.parquet — never a fresh random split."""
    return {name: df.loc[df["split"] == name].drop(columns=["split"]).reset_index(drop=True)
            for name in VALID_SPLITS}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def load_dataset(data_dir: str | Path, strict: bool = True) -> tuple[Dict[str, pd.DataFrame], LoadReport]:
    """Full Phase 1 pipeline: load → validate → join → engineer → split.

    Returns a dict with keys "train", "val", "test" (each a DataFrame),
    plus the LoadReport diagnostics object for logging / the /api/v1/ingest
    response body / the audit trail.
    """
    tables = load_raw_tables(data_dir)
    report = validate_tables(tables, strict=strict)
    master = build_master_frame(tables)
    master = add_engineered_features(master)
    splits = split_frame(master)

    logger.info(
        "Dataset ready: train=%s val=%s test=%s | fraud_rate=%.4f",
        len(splits["train"]), len(splits["val"]), len(splits["test"]),
        report.fraud_rate or float("nan"),
    )

    return splits, report


def load_and_merge_parquet(dataset_path: str | Path, strict: bool = True) -> tuple[pd.DataFrame, LoadReport]:
    """Load, validate, and merge the parquet bundle into a single invoice-grain
    DataFrame (the `split` column stays IN this frame, unlike `load_dataset`,
    which slices it away into train/val/test dicts).

    This is the single-DataFrame entry point used by the FastAPI ingestion
    endpoint (`app/api/v1/endpoints/ingest.py`), which stores the returned
    frame in `app.state` and hands the LoadReport back to the caller as the
    API response body.

    Deliberately synchronous: pandas/pyarrow parquet I/O and the merge are
    CPU/disk-bound, not I/O-bound-on-the-event-loop, so there is nothing an
    `async def` here would usefully await. The FastAPI endpoint runs this
    function in a threadpool (`fastapi.concurrency.run_in_threadpool`) so it
    does not block the event loop while it runs.
    """
    tables = load_raw_tables(dataset_path)
    report = validate_tables(tables, strict=strict)
    df = build_master_frame(tables)
    df = add_engineered_features(df)
    return df, report


if __name__ == "__main__":
    import argparse
    import json

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Load and validate the ReconTax AI dataset.")
    parser.add_argument("data_dir", help="Directory containing the parquet files.")
    parser.add_argument("--lenient", action="store_true", help="Report issues instead of raising.")
    args = parser.parse_args()

    result, load_report = load_dataset(args.data_dir, strict=not args.lenient)
    print(json.dumps(load_report.as_dict(), indent=2))
    for split_name, frame in result.items():
        print(f"{split_name}: {frame.shape}")
