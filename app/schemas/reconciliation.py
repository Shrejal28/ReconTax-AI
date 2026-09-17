"""
app/schemas/reconciliation.py
-------------------------------
Pydantic v2 models for POST /api/v1/reconcile.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.ingestion import REQUIRED_PARQUET_FILES
from app.services.reconciliation import (
    DEFAULT_MISMATCH_RATE,
    DEFAULT_MISSING_GSTR_RATE,
    DEFAULT_MISSING_SFT_RATE,
)


class ReconcileRequest(BaseModel):
    """Body of POST /api/v1/reconcile.

    `dataset_path` is OPTIONAL: if omitted, the endpoint reconciles
    whatever DataFrame is already sitting in `app.state.master_frame`
    (populated by a prior POST /api/v1/ingest in the same app process).
    If provided, the endpoint loads and merges that dataset directory
    fresh — useful for reconciling without a prior ingest call, e.g. a
    stateless/scripted client that doesn't want to depend on server-side
    session state across two requests.
    """

    dataset_path: Optional[str] = Field(
        default=None,
        description="If set, ingest this directory fresh instead of using "
        "app.state.master_frame. If unset, POST /api/v1/ingest must have "
        "already populated app.state.master_frame in this app process.",
    )
    seed: int = Field(default=42, description="Seed for deterministic mock telemetry synthesis.")
    missing_sft_rate: float = Field(default=DEFAULT_MISSING_SFT_RATE, ge=0.0, le=1.0)
    missing_gstr_rate: float = Field(default=DEFAULT_MISSING_GSTR_RATE, ge=0.0, le=1.0)
    mismatch_rate: float = Field(default=DEFAULT_MISMATCH_RATE, ge=0.0, le=1.0)
    top_n_anomalies: int = Field(
        default=50, ge=0, le=1000,
        description="Number of highest-exposure non-MATCHED invoices to include in the response.",
    )

    @field_validator("dataset_path")
    @classmethod
    def path_must_exist_and_be_a_directory(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        path = Path(v)
        if not path.exists():
            raise ValueError(f"dataset_path does not exist: {v}")
        if not path.is_dir():
            raise ValueError(f"dataset_path must be a directory, got a file: {v}")
        missing = [f for f in REQUIRED_PARQUET_FILES if not (path / f).exists()]
        if missing:
            raise ValueError(f"dataset_path is missing required files: {missing}")
        return v


class ReconciliationStatusBreakdown(BaseModel):
    count: int = Field(ge=0)
    pct_of_rows: float = Field(ge=0.0, le=100.0)
    invoice_amount_sum: float
    telemetry_delta_gap_sum: float = Field(ge=0.0)


class ReconciliationSummary(BaseModel):
    """Mirrors the dict returned by
    app.services.reconciliation.summarize_reconciliation_anomalies."""

    total_rows: int = Field(ge=0)
    total_invoice_amount: float
    total_telemetry_delta_gap: float = Field(ge=0.0)
    by_status: dict[str, ReconciliationStatusBreakdown]


class AnomalousRecord(BaseModel):
    """One row from app.services.reconciliation.get_top_anomalies."""

    invoice_id: str
    supplier_id: str
    invoice_amount: float
    reconciliation_status: str
    telemetry_delta_gap: float = Field(ge=0.0)


class ReconcileResponse(BaseModel):
    """Body of the POST /api/v1/reconcile response."""

    status: str = Field(description='"ok".')
    source: str = Field(description='"app.state.master_frame" or the dataset_path that was freshly ingested.')
    reconciled_frame_shape: tuple[int, int]
    seed: int
    summary: ReconciliationSummary
    anomalous_records: list[AnomalousRecord] = Field(
        description="Top-N highest-exposure non-MATCHED invoices, sorted by telemetry_delta_gap descending.",
    )
