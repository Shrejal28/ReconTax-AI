"""
app/api/v1/endpoints/ocr.py
-------------------------------
POST /api/v1/ocr/parse   — upload a PDF/image, get real OCR'd fields back.
POST /api/v1/ocr/commit  — persist a reviewed (possibly corrected) set of
                            fields to the OcrStagingCommit table.

See app/services/ocr_engine.py's module docstring for exactly what the
extraction can and can't do. See app/db_models.py's OcrStagingCommit
docstring for why a commit here does NOT feed into the fraud-scoring
pipeline's master_frame.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.db import get_db
from app.db_models import OcrStagingCommit, User
from app.deps import get_current_user, tenant_key_for
from app.schemas.ocr import (
    LOW_CONFIDENCE_THRESHOLD,
    OcrCommitRequest,
    OcrCommitResponse,
    OcrFieldOut,
    OcrParseResponse,
)
from app.services.ocr_engine import OcrError, extract_invoice_fields

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ocr", tags=["ocr"])

RAW_TEXT_PREVIEW_CHARS = 2000


@router.post("/parse", response_model=OcrParseResponse)
async def parse_document(file: UploadFile, _user: User = Depends(get_current_user)) -> OcrParseResponse:
    """Run real OCR (Tesseract, via pdf2image for PDFs) over the uploaded
    document and extract GSTIN / CGST / SGST / IGST / invoice_total.
    Every confidence value returned is a genuine Tesseract measurement —
    no field is ever fabricated or hardcoded (see ocr_engine.py)."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")

    content_type = file.content_type or ""
    try:
        result = await run_in_threadpool(extract_invoice_fields, content, content_type)
    except OcrError as exc:
        logger.warning("OCR parse failed for %r: %s", file.filename, exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    fields_out = [
        OcrFieldOut(
            field_name=f.field_name,
            value=f.value,
            confidence=f.confidence,
            source_text=f.source_text,
            low_confidence=f.confidence < LOW_CONFIDENCE_THRESHOLD,
        )
        for f in result.fields
    ]

    return OcrParseResponse(
        filename=file.filename or "upload",
        page_count=result.page_count,
        file_hash=result.file_hash,
        fields=fields_out,
        low_confidence_field_count=sum(1 for f in fields_out if f.low_confidence),
        raw_text_preview=result.raw_text[:RAW_TEXT_PREVIEW_CHARS],
    )


@router.post("/commit", response_model=OcrCommitResponse)
def commit_staging_record(
    payload: OcrCommitRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> OcrCommitResponse:
    """Persist a reviewed OCR staging record. Rejects the commit with a
    409 if any field is below LOW_CONFIDENCE_THRESHOLD and the reviewer
    hasn't set low_confidence_overridden=True — this mirrors (and
    defends server-side) the frontend's disabled Commit button, so the
    gate can't be bypassed by calling the API directly."""
    low_conf_fields = [f for f in payload.fields if f.confidence < LOW_CONFIDENCE_THRESHOLD]
    if low_conf_fields and not payload.low_confidence_overridden:
        names = ", ".join(f.field_name for f in low_conf_fields)
        raise HTTPException(
            status_code=409,
            detail=f"Fields below {LOW_CONFIDENCE_THRESHOLD}% confidence ({names}) require "
            "low_confidence_overridden=true to commit.",
        )

    supplier_gstin = next((f.value for f in payload.fields if f.field_name == "gstin"), None)
    tenant_key = tenant_key_for(user)

    record = OcrStagingCommit(
        tenant_id=tenant_key,
        filename=payload.filename,
        file_hash=payload.file_hash,
        supplier_gstin=supplier_gstin,
        fields_payload={f.field_name: {"value": f.value, "confidence": f.confidence} for f in payload.fields},
        low_confidence_overridden=payload.low_confidence_overridden,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    logger.info(
        "OCR staging commit id=%s filename=%r gstin=%s overridden=%s",
        record.id, payload.filename, supplier_gstin, payload.low_confidence_overridden,
    )

    return OcrCommitResponse(
        id=record.id,
        status="committed",
        filename=record.filename,
        file_hash=record.file_hash,
        supplier_gstin=record.supplier_gstin,
        low_confidence_overridden=record.low_confidence_overridden,
    )
