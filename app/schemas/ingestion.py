"""
app/schemas/ingestion.py
-------------------------
Pydantic v2 models for the ReconTax AI ingestion API.

These validate the request (a dataset directory path) and shape the
response (a structured ingestion/integrity report), mirroring the
diagnostics produced by app.services.loader.validate_tables.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field, field_validator

REQUIRED_PARQUET_FILES = (
    "invoices.parquet",
    "suppliers.parquet",
    "departments.parquet",
    "labels.parquet",
    "behavioural_features.parquet",
    "splits.parquet",
)


class IngestRequest(BaseModel):
    """Body of POST /api/v1/ingest."""

    dataset_path: str = Field(
        ...,
        description="Directory containing the parquet bundle "
        "(invoices, suppliers, departments, labels, behavioural_features, splits).",
        min_length=1,
    )
    strict: bool = Field(
        default=True,
        description="If True, raise on any schema/FK violation. If False, "
        "ingest anyway and report violations in the response.",
    )

    @field_validator("dataset_path")
    @classmethod
    def path_must_exist_and_be_a_directory(cls, v: str) -> str:
        path = Path(v)
        if not path.exists():
            raise ValueError(f"dataset_path does not exist: {v}")
        if not path.is_dir():
            raise ValueError(f"dataset_path must be a directory, got a file: {v}")
        missing = [f for f in REQUIRED_PARQUET_FILES if not (path / f).exists()]
        if missing:
            raise ValueError(
                f"dataset_path is missing required files: {missing}"
            )
        return v


class SplitCounts(BaseModel):
    """Row counts per split, as found in splits.parquet."""

    train: int = 0
    val: int = 0
    test: int = 0


class IngestionReport(BaseModel):
    """Structured relational-integrity diagnostics for one ingest run.

    Field semantics match app.services.loader.LoadReport 1:1 so the two
    can be converted without loss (see IngestionReport.from_load_report).
    """

    row_counts: dict[str, int]
    orphan_supplier_rows: int = Field(
        ge=0, description="Invoice rows whose supplier_id has no match in suppliers.parquet."
    )
    orphan_department_rows: int = Field(
        ge=0, description="Invoice rows whose department_id has no match in departments.parquet."
    )
    missing_label_rows: int = Field(
        ge=0, description="Invoices with no matching row in labels.parquet."
    )
    missing_behavioural_rows: int = Field(
        ge=0, description="Invoices with no matching row in behavioural_features.parquet."
    )
    missing_split_rows: int = Field(
        ge=0, description="Invoices with no split assignment in splits.parquet."
    )
    duplicate_invoice_ids: int = Field(
        ge=0, description="Duplicate invoice_id values found in invoices.parquet."
    )
    fraud_rate: Optional[float] = Field(
        default=None, ge=0.0, le=1.0, description="Mean of is_fraud across all ingested rows."
    )
    split_counts: SplitCounts = Field(default_factory=SplitCounts)

    @property
    def is_clean(self) -> bool:
        """True iff no integrity violations were found."""
        return (
            self.orphan_supplier_rows == 0
            and self.orphan_department_rows == 0
            and self.missing_label_rows == 0
            and self.missing_behavioural_rows == 0
            and self.missing_split_rows == 0
            and self.duplicate_invoice_ids == 0
        )

    @classmethod
    def from_load_report(cls, report) -> "IngestionReport":  # report: loader.LoadReport
        data = report.as_dict()
        data["split_counts"] = SplitCounts(**data.get("split_counts", {}))
        return cls(**data)


class IngestResponse(BaseModel):
    """Body of the POST /api/v1/ingest response."""

    status: str = Field(description='"ok" or "ok_with_warnings" (lenient mode with issues found).')
    master_frame_shape: tuple[int, int] = Field(
        description="(rows, columns) of the merged invoice-grain frame stored in app.state."
    )
    report: IngestionReport
