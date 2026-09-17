"""
app/services/reconciliation.py
--------------------------------
ReconTax AI — Phase 3: SFT/GSTR Reconciliation & telemetry_delta_gap.

`app/services/loader.py` (Phase 1) flagged that `telemetry_delta_gap`
(PRD section 4A.2) cannot be computed from the procurement parquet bundle
alone — it requires cross-checking invoice amounts against external bank
settlement telemetry (`sft_bank_ledgers`) and tax filings (`gstr_filings`),
neither of which exist in the real dataset. This module:

  1. Synthesizes deterministic, seeded mock versions of both external
     tables, aligned to invoice grain, with controlled/known mismatch
     injection (so ground truth for testing is exact, not incidental).
  2. Joins them onto the master frame and computes `telemetry_delta_gap`
     and `reconciliation_status`.
  3. Summarizes anomalies by status for reporting/audit-trail purposes.

Grain choice: PAN/GSTIN-style tables in the original PRD sketch are
entity-level (one row per taxpayer per period). This module instead
synthesizes them at INVOICE grain (with `supplier_id`/`tax_entity_id`
carried alongside `invoice_id`), because `telemetry_delta_gap` is
consumed as a per-invoice feature by the LightGBM scorer (Phase 2) — an
entity-level table would need to be disaggregated back onto invoices
before it could be useful there, which just pushes today's problem one
step later. If a genuinely entity-level reconciliation view is wanted
later (e.g. for a supplier-level dashboard), it can be built by grouping
this module's invoice-grain output by `tax_entity_id` — the reverse
direction is a cheap groupby, the forward direction isn't.

Vectorization constraint: no `.iterrows()`, no `.apply(axis=1)` anywhere
in this file. All row-wise logic uses `.merge()`, `np.select()`/`np.where()`,
and elementwise Series arithmetic.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Reconciliation status categories, in the priority order applied by
# compute_reconciliation_features (see its docstring for why this order).
STATUS_MISSING_SFT = "MISSING_SFT"
STATUS_MISSING_GSTR = "MISSING_GSTR"
STATUS_AMOUNT_MISMATCH = "AMOUNT_MISMATCH"
STATUS_MATCHED = "MATCHED"

ALL_STATUSES = (STATUS_MISSING_SFT, STATUS_MISSING_GSTR, STATUS_AMOUNT_MISMATCH, STATUS_MATCHED)

# Mismatch-tolerance: a delta smaller than this is treated as floating-point/
# rounding noise, not a genuine discrepancy, so trivially-off amounts don't
# spuriously trigger AMOUNT_MISMATCH.
ABS_TOLERANCE = 1.0        # currency units
REL_TOLERANCE = 0.01       # 1% of invoice_amount

# Synthesis rates (see synthesize_external_telemetry docstring).
DEFAULT_MISSING_SFT_RATE = 0.05
DEFAULT_MISSING_GSTR_RATE = 0.07
DEFAULT_MISMATCH_RATE = 0.15


class ReconciliationError(ValueError):
    """Raised for invalid inputs to the reconciliation functions."""


# ---------------------------------------------------------------------------
# Phase 3a: synthesize mock external telemetry
# ---------------------------------------------------------------------------

def synthesize_external_telemetry(
    df_master: pd.DataFrame,
    seed: int = 42,
    missing_sft_rate: float = DEFAULT_MISSING_SFT_RATE,
    missing_gstr_rate: float = DEFAULT_MISSING_GSTR_RATE,
    mismatch_rate: float = DEFAULT_MISMATCH_RATE,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Generate deterministic mock `sft_bank_ledgers` and `gstr_filings`
    tables aligned to `df_master`'s invoice grain.

    Determinism: identical `seed` always produces identical output for a
    given set of invoice_ids, REGARDLESS of what row order they arrive in.
    This matters in practice: `app/services/loader.py` exposes two ways to
    get an invoice-grain frame (`load_dataset`, which concatenates
    train/val/test splits, vs `load_and_merge_parquet`, which preserves
    the source parquet's natural order) and they do not produce the same
    row order for the same underlying data. Keying randomness off row
    position (`rng.random(n)` in original order) would silently assign a
    different missing/mismatch outcome to the same invoice_id depending on
    which loader function was used upstream — a determinism gap that
    would only surface as "the same seed gave different numbers" days
    later. Instead, all randomness is drawn in a canonical order (sorted
    by `invoice_id`) and then scattered back to the caller's original row
    order, so the result depends only on {seed, set of invoice_ids},
    never on their arrival order. Uses `numpy.random.default_rng(seed)`,
    not global numpy random state.

    Mismatch injection (three independent mechanisms, each vectorized):
      1. `missing_sft_rate` fraction of invoices get NO row in the
         returned `sft_bank_ledgers` frame at all — simulating a bank
         settlement that was never observed/telemetered for that invoice.
      2. `missing_gstr_rate` fraction (drawn independently) get no row in
         `gstr_filings` — simulating a GST return that was never filed
         for that invoice.
      3. Among invoices that DO have both records, `mismatch_rate`
         fraction get a deliberately altered amount:
           - SFT-side mismatches are symmetric noise (over- or
             under-settlement), reflecting bank-side timing/partial
             payment effects.
           - GSTR-side mismatches are systematically UNDER-reported
             (declared amount sampled below invoice_amount), reflecting
             the PRD's under-reporting/shell-company narrative rather
             than symmetric noise — a taxpayer underclaiming turnover
             looks different from a bank settlement lagging by a few
             rand.
      Rows not selected by any of the above are exact matches (up to a
      small rounding-realistic noise term), by construction — so tests
      can assert exact status for known-seed rows.

    Returns
    -------
    (sft_df, gstr_df) : each has columns
        invoice_id, supplier_id, tax_entity_id, <amount column>, plus a
        date/period column. sft_df's amount column is
        `sft_reported_amount`; gstr_df's is `gstr_declared_amount`.
    """
    required_cols = {"invoice_id", "supplier_id", "invoice_amount"}
    missing = required_cols - set(df_master.columns)
    if missing:
        raise ReconciliationError(f"df_master is missing required columns: {sorted(missing)}")
    for name, rate in [
        ("missing_sft_rate", missing_sft_rate),
        ("missing_gstr_rate", missing_gstr_rate),
        ("mismatch_rate", mismatch_rate),
    ]:
        if not (0.0 <= rate <= 1.0):
            raise ReconciliationError(f"{name} must be in [0, 1], got {rate}")

    n = len(df_master)
    rng = np.random.default_rng(seed)

    invoice_id = df_master["invoice_id"].to_numpy()
    supplier_id = df_master["supplier_id"].to_numpy()
    tax_entity_id = np.char.add("TAX_", supplier_id.astype(str))
    invoice_amount = df_master["invoice_amount"].to_numpy(dtype=float)

    has_date = "invoice_date" in df_master.columns
    invoice_date = df_master["invoice_date"] if has_date else None

    # --- draw all randomness in a canonical (invoice_id-sorted) order,
    # then scatter back to the caller's actual row order. This is what
    # makes the result depend only on {seed, set of invoice_ids} and not
    # on row order (see determinism note in the docstring above). ---
    canonical_order = np.argsort(invoice_id, kind="stable")
    scatter_back = np.empty(n, dtype=np.intp)
    scatter_back[canonical_order] = np.arange(n)

    def _draw(rng_fn, *args, **kwargs):
        """Draw in canonical order, return scattered back to input row order."""
        values_in_canonical_order = rng_fn(*args, size=n, **kwargs)
        return values_in_canonical_order[scatter_back]

    missing_sft_mask = _draw(rng.random) < missing_sft_rate
    missing_gstr_mask = _draw(rng.random) < missing_gstr_rate
    sft_mismatch_mask = (_draw(rng.random) < mismatch_rate) & ~missing_sft_mask
    gstr_mismatch_mask = (_draw(rng.random) < mismatch_rate) & ~missing_gstr_mask

    # Small always-on rounding noise so "matched" isn't suspiciously exact
    # to the cent (realistic for bank/tax reporting).
    rounding_noise_sft = _draw(rng.normal, loc=0.0, scale=0.05)
    rounding_noise_gstr = _draw(rng.normal, loc=0.0, scale=0.05)

    # SFT-side mismatch: symmetric relative noise, magnitude 5-25%.
    sft_mismatch_pct = _draw(rng.uniform, low=-0.25, high=0.25)
    sft_mismatch_pct = np.where(np.abs(sft_mismatch_pct) < 0.05,
                                 np.sign(sft_mismatch_pct) * 0.05, sft_mismatch_pct)

    # GSTR-side mismatch: systematic under-declaration, 10-50% of true amount.
    gstr_underreport_factor = _draw(rng.uniform, low=0.50, high=0.90)

    sft_reported_amount = np.where(
        sft_mismatch_mask,
        invoice_amount * (1.0 + sft_mismatch_pct),
        invoice_amount + rounding_noise_sft,
    )
    gstr_declared_amount = np.where(
        gstr_mismatch_mask,
        invoice_amount * gstr_underreport_factor,
        invoice_amount + rounding_noise_gstr,
    )

    sft_df = pd.DataFrame({
        "invoice_id": invoice_id,
        "supplier_id": supplier_id,
        "tax_entity_id": tax_entity_id,
        "sft_reported_amount": np.round(sft_reported_amount, 2),
    })
    sft_df = sft_df.loc[~missing_sft_mask].reset_index(drop=True)
    if has_date:
        settlement_lag_days = _draw(rng.integers, low=0, high=15)
        sft_settlement_date = invoice_date + pd.to_timedelta(settlement_lag_days, unit="D")
        sft_df_dates = pd.Series(sft_settlement_date, name="sft_settlement_date")[~missing_sft_mask].reset_index(drop=True)
        sft_df["sft_settlement_date"] = sft_df_dates

    gstr_df = pd.DataFrame({
        "invoice_id": invoice_id,
        "supplier_id": supplier_id,
        "tax_entity_id": tax_entity_id,
        "gstr_declared_amount": np.round(gstr_declared_amount, 2),
    })
    gstr_df = gstr_df.loc[~missing_gstr_mask].reset_index(drop=True)
    if has_date:
        gstr_period = invoice_date.dt.to_period("M").astype(str)
        gstr_df_period = pd.Series(gstr_period, name="gstr_period")[~missing_gstr_mask].reset_index(drop=True)
        gstr_df["gstr_period"] = gstr_df_period

    logger.info(
        "Synthesized telemetry: sft_bank_ledgers=%d/%d rows (%.1f%% missing), "
        "gstr_filings=%d/%d rows (%.1f%% missing), seed=%d",
        len(sft_df), n, 100 * missing_sft_mask.mean(),
        len(gstr_df), n, 100 * missing_gstr_mask.mean(),
        seed,
    )
    return sft_df, gstr_df


# ---------------------------------------------------------------------------
# Phase 3b: reconciliation features
# ---------------------------------------------------------------------------

def compute_reconciliation_features(
    df_master: pd.DataFrame,
    sft_df: pd.DataFrame,
    gstr_df: pd.DataFrame,
    abs_tolerance: float = ABS_TOLERANCE,
    rel_tolerance: float = REL_TOLERANCE,
) -> pd.DataFrame:
    """Left-join `sft_df`/`gstr_df` onto `df_master` (on `invoice_id`) and
    compute `telemetry_delta_gap` and `reconciliation_status`.

    telemetry_delta_gap formula
    ----------------------------
    A MISSING filing is treated as a reported/declared amount of ZERO,
    not excluded from the gap calculation — an invoice with no matching
    bank settlement or GST return represents value that is entirely
    unaccounted for from that channel's perspective, which is the
    maximum-exposure reading and the one relevant to fraud detection
    (silently dropping missing rows from the gap calculation would make
    the least-verifiable invoices look the most "clean", which is
    backwards). Concretely:

        sft_gap  = |invoice_amount - sft_reported_amount.fillna(0)|
        gstr_gap = |invoice_amount - gstr_declared_amount.fillna(0)|
        telemetry_delta_gap = max(sft_gap, gstr_gap)   # elementwise

    reconciliation_status priority
    --------------------------------
    Exactly one status per row, decided in this priority order:
      1. MISSING_SFT   — no matching sft_bank_ledgers row. Bank telemetry
         is checked first because it's the more real-time signal in the
         PRD's workflow (SFT arrives before the GST filing cycle closes).
      2. MISSING_GSTR  — sft matched, but no matching gstr_filings row.
      3. AMOUNT_MISMATCH — both matched, but the gap exceeds tolerance
         (`max(abs_tolerance, rel_tolerance * invoice_amount)`, so a
         handful of currency units of noise on a small invoice isn't
         over-flagged, and a proportional amount on a large invoice is
         still caught).
      4. MATCHED — both matched, within tolerance.
    A row missing BOTH sft and gstr is reported as MISSING_SFT (priority
    1 wins) rather than a fifth category, keeping `reconciliation_status`
    a clean 4-value categorical as specified; `telemetry_delta_gap` still
    reflects the full double-missing exposure regardless of which single
    label is shown.
    """
    required = {"invoice_id", "invoice_amount"}
    if not required.issubset(df_master.columns):
        raise ReconciliationError(f"df_master missing required columns: {required - set(df_master.columns)}")
    if "invoice_id" not in sft_df.columns or "sft_reported_amount" not in sft_df.columns:
        raise ReconciliationError("sft_df must contain 'invoice_id' and 'sft_reported_amount'")
    if "invoice_id" not in gstr_df.columns or "gstr_declared_amount" not in gstr_df.columns:
        raise ReconciliationError("gstr_df must contain 'invoice_id' and 'gstr_declared_amount'")
    if sft_df["invoice_id"].duplicated().any():
        raise ReconciliationError("sft_df has duplicate invoice_id values; expected at most one row per invoice.")
    if gstr_df["invoice_id"].duplicated().any():
        raise ReconciliationError("gstr_df has duplicate invoice_id values; expected at most one row per invoice.")

    n_start = len(df_master)

    df = df_master.merge(
        sft_df[["invoice_id", "sft_reported_amount"]],
        on="invoice_id",
        how="left",
        validate="one_to_one",
    )
    df = df.merge(
        gstr_df[["invoice_id", "gstr_declared_amount"]],
        on="invoice_id",
        how="left",
        validate="one_to_one",
    )

    if len(df) != n_start:
        # Left joins should never change row count; validate= above already
        # guards fan-out, this catches any other silent row-count drift.
        raise ReconciliationError(
            f"Row count changed during reconciliation join: {n_start} -> {len(df)}"
        )

    sft_missing_mask = df["sft_reported_amount"].isna()
    gstr_missing_mask = df["gstr_declared_amount"].isna()

    sft_gap = (df["invoice_amount"] - df["sft_reported_amount"].fillna(0.0)).abs()
    gstr_gap = (df["invoice_amount"] - df["gstr_declared_amount"].fillna(0.0)).abs()
    df["telemetry_delta_gap"] = pd.concat([sft_gap, gstr_gap], axis=1).max(axis=1)

    tolerance = np.maximum(abs_tolerance, rel_tolerance * df["invoice_amount"].to_numpy())
    both_present_gap = pd.concat(
        [
            (df["invoice_amount"] - df["sft_reported_amount"]).abs(),
            (df["invoice_amount"] - df["gstr_declared_amount"]).abs(),
        ],
        axis=1,
    ).max(axis=1)
    amount_mismatch_mask = (~sft_missing_mask) & (~gstr_missing_mask) & (both_present_gap.to_numpy() > tolerance)

    df["reconciliation_status"] = np.select(
        condlist=[sft_missing_mask, gstr_missing_mask, amount_mismatch_mask],
        choicelist=[STATUS_MISSING_SFT, STATUS_MISSING_GSTR, STATUS_AMOUNT_MISMATCH],
        default=STATUS_MATCHED,
    )

    logger.info(
        "Reconciliation complete: %d rows, status counts=%s",
        len(df), df["reconciliation_status"].value_counts().to_dict(),
    )
    return df


# ---------------------------------------------------------------------------
# Phase 3c: anomaly summary
# ---------------------------------------------------------------------------

def summarize_reconciliation_anomalies(
    df_recon: pd.DataFrame,
    amount_col: str = "invoice_amount",
    gap_col: str = "telemetry_delta_gap",
    status_col: str = "reconciliation_status",
) -> dict:
    """Aggregate counts and financial exposure per reconciliation status.

    Returns a JSON-serializable dict:
        {
          "total_rows": int,
          "total_invoice_amount": float,
          "total_telemetry_delta_gap": float,
          "by_status": {
            "<STATUS>": {
              "count": int,
              "pct_of_rows": float,
              "invoice_amount_sum": float,
              "telemetry_delta_gap_sum": float,
            },
            ...  # one entry per status present, in ALL_STATUSES order
          }
        }
    Statuses with zero rows are still included (with zeroed values) so
    downstream consumers (dashboard, alerting) can rely on a stable key
    set rather than checking for key existence.
    """
    for col in (amount_col, gap_col, status_col):
        if col not in df_recon.columns:
            raise ReconciliationError(f"df_recon is missing required column: '{col}'")

    total_rows = len(df_recon)
    grouped = df_recon.groupby(status_col).agg(
        count=(amount_col, "size"),
        invoice_amount_sum=(amount_col, "sum"),
        telemetry_delta_gap_sum=(gap_col, "sum"),
    )

    by_status: dict = {}
    for status in ALL_STATUSES:
        if status in grouped.index:
            row = grouped.loc[status]
            count = int(row["count"])
            by_status[status] = {
                "count": count,
                "pct_of_rows": round(100.0 * count / total_rows, 4) if total_rows else 0.0,
                "invoice_amount_sum": float(row["invoice_amount_sum"]),
                "telemetry_delta_gap_sum": float(row["telemetry_delta_gap_sum"]),
            }
        else:
            by_status[status] = {
                "count": 0,
                "pct_of_rows": 0.0,
                "invoice_amount_sum": 0.0,
                "telemetry_delta_gap_sum": 0.0,
            }

    summary = {
        "total_rows": total_rows,
        "total_invoice_amount": float(df_recon[amount_col].sum()),
        "total_telemetry_delta_gap": float(df_recon[gap_col].sum()),
        "by_status": by_status,
    }
    logger.info("Reconciliation anomaly summary: %s", summary)
    return summary


def get_top_anomalies(
    df_recon: pd.DataFrame,
    n: int = 50,
    gap_col: str = "telemetry_delta_gap",
    status_col: str = "reconciliation_status",
    exclude_status: str = STATUS_MATCHED,
    extra_cols: tuple[str, ...] = (),
) -> pd.DataFrame:
    """Return the top-`n` non-matched rows by `telemetry_delta_gap`, for
    surfacing in a review queue (e.g. the dashboard's TriageQueue table).

    Uses `DataFrame.nlargest`, which is a vectorized partial-sort — not a
    Python-level loop — so this stays cheap even on the full 300k-row
    frame. `extra_cols` lets a caller pull in additional columns (e.g.
    `fraud_type` for context) without this function needing to know the
    full invoice-grain schema.
    """
    if status_col not in df_recon.columns or gap_col not in df_recon.columns:
        raise ReconciliationError(f"df_recon must contain '{status_col}' and '{gap_col}'")

    base_cols = ["invoice_id", "supplier_id", "invoice_amount", status_col, gap_col]
    cols = base_cols + [c for c in extra_cols if c not in base_cols]
    missing_cols = [c for c in cols if c not in df_recon.columns]
    if missing_cols:
        raise ReconciliationError(f"df_recon is missing requested columns: {missing_cols}")

    anomalies = df_recon.loc[df_recon[status_col] != exclude_status, cols]
    return anomalies.nlargest(n, gap_col).reset_index(drop=True)


if __name__ == "__main__":
    import argparse
    import json

    from app.services.loader import load_dataset

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Run SFT/GSTR reconciliation against the ReconTax dataset.")
    parser.add_argument("data_dir", help="Directory containing the parquet files.")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    splits, _ = load_dataset(args.data_dir)
    df_master = pd.concat(splits.values(), ignore_index=True)

    sft_df, gstr_df = synthesize_external_telemetry(df_master, seed=args.seed)
    df_recon = compute_reconciliation_features(df_master, sft_df, gstr_df)
    summary = summarize_reconciliation_anomalies(df_recon)

    print(json.dumps(summary, indent=2))
