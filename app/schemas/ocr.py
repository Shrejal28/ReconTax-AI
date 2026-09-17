"""
app/schemas/ocr.py
----------------------
Pydantic v2 models for POST /api/v1/ocr/parse and POST /api/v1/ocr/commit.
See app/services/ocr_engine.py's module docstring for exactly what the
extraction can and can't do, and what `confidence` actually measures
(real Tesseract word-confidence, never fabricated).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

OcrFieldName = Literal["gstin", "cgst", "sgst", "igst", "invoice_total"]

# Fields below this confidence render with an amber warning in the UI and
# block committing unless the reviewer explicitly overrides.
LOW_CONFIDENCE_THRESHOLD = 85.0


class OcrFieldOut(BaseModel):
    field_name: OcrFieldName
    value: str
    confidence: float = Field(
        ge=0, le=100, description="Real mean Tesseract word confidence (0-100) for the OCR'd "
        "line this value was extracted from."
    )
    source_text: str = Field(description="The raw OCR'd line the value was parsed from.")
    low_confidence: bool = Field(description=f"True when confidence < {LOW_CONFIDENCE_THRESHOLD}.")


class OcrParseResponse(BaseModel):
    filename: str
    page_count: int
    file_hash: str = Field(description="SHA-256 of the uploaded file's bytes, computed server-side.")
    fields: list[OcrFieldOut]
    low_confidence_field_count: int
    raw_text_preview: str = Field(description="First ~2000 chars of the full OCR'd text, for debugging.")


class OcrCommitFieldIn(BaseModel):
    """One field's value as the reviewer is committing it — may have been
    hand-corrected in the UI, and always carries the confidence that
    parse originally reported for it (not recomputed here)."""

    field_name: OcrFieldName
    value: str
    confidence: float = Field(ge=0, le=100)


class OcrCommitRequest(BaseModel):
    filename: str
    file_hash: str
    fields: list[OcrCommitFieldIn]
    low_confidence_overridden: bool = Field(
        default=False,
        description="Must be True if any field's confidence is below "
        f"{LOW_CONFIDENCE_THRESHOLD} — the reviewer explicitly acknowledged and "
        "overrode the low-confidence warning to commit anyway.",
    )


class OcrCommitResponse(BaseModel):
    id: int
    status: Literal["committed"]
    filename: str
    file_hash: str
    supplier_gstin: str | None
    low_confidence_overridden: bool
