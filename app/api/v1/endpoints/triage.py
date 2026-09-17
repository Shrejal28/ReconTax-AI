"""
app/api/v1/endpoints/triage.py
----------------------------------
POST /api/v1/triage/notice

Phase 4: drafts a compliance-review notice via a real LLM call (OpenRouter
— see app/services/agent.py for the model, prompt-sandboxing, and
severity-override-protection design). If that call fails for any reason
(no API key configured, network unreachable, malformed model response),
falls back to the same deterministic template this endpoint used before
Phase 4 existed — so the endpoint degrades gracefully instead of 500ing
the whole triage flow when the LLM provider has a bad moment. The
response's `generated_by` field always says which path actually answered.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.schemas.triage import TriageNoticeRequest, TriageNoticeResponse
from app.services.agent import AgentError, generate_compliance_notice

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["triage"])

# --- deterministic fallback (identical to the pre-Phase-4 stub) ---

_RECOMMENDED_ACTION_BY_STATUS = {
    "MISSING_SFT": "Escalate to bank settlement verification; request supplier remittance proof.",
    "MISSING_GSTR": "Escalate to GST filing verification; request supplier's filed GSTR-1/3B for the period.",
    "AMOUNT_MISMATCH": "Route to human review queue for line-item reconciliation before any notice is issued.",
}

_SEVERITY_BY_STATUS = {
    "MISSING_SFT": "HIGH",
    "MISSING_GSTR": "HIGH",
    "AMOUNT_MISMATCH": "MEDIUM",
}

_STATUS_EXPLANATION = {
    "MISSING_SFT": "No matching bank settlement record was found for this invoice in the SFT telemetry.",
    "MISSING_GSTR": "No matching GST return filing was found for this invoice for the relevant period.",
    "AMOUNT_MISMATCH": "The amount reported to external telemetry diverges from the invoiced amount beyond tolerance.",
}

_NOTICE_TEMPLATE = (
    "COMPLIANCE REVIEW NOTICE (DRAFT — TEMPLATE FALLBACK, NOT LEGAL ADVICE)\n\n"
    "Invoice: {invoice_id}\n"
    "Supplier: {supplier_id}\n"
    "Invoice Amount: {invoice_amount:,.2f}\n"
    "Reconciliation Status: {reconciliation_status}\n"
    "Unaccounted Exposure (telemetry_delta_gap): {telemetry_delta_gap:,.2f}\n\n"
    "This invoice was flagged during automated SFT/GSTR reconciliation. "
    "{status_explanation} "
    "This is a system-generated draft for internal review and does not "
    "constitute a formal notice until reviewed and issued by a compliance officer.\n\n"
    "[Note: this notice was drafted by the deterministic fallback template because the "
    "live AI drafting service was unavailable — see server logs for the underlying error.]"
)


def _deterministic_fallback_notice(payload: TriageNoticeRequest) -> TriageNoticeResponse:
    notice_text = _NOTICE_TEMPLATE.format(
        invoice_id=payload.invoice_id,
        supplier_id=payload.supplier_id,
        invoice_amount=payload.invoice_amount,
        reconciliation_status=payload.reconciliation_status,
        telemetry_delta_gap=payload.telemetry_delta_gap,
        status_explanation=_STATUS_EXPLANATION[payload.reconciliation_status],
    )
    return TriageNoticeResponse(
        invoice_id=payload.invoice_id,
        severity=_SEVERITY_BY_STATUS[payload.reconciliation_status],
        notice_text=notice_text,
        recommended_action=_RECOMMENDED_ACTION_BY_STATUS[payload.reconciliation_status],
        generated_by="template_fallback",
        severity_overridden=False,
    )


@router.post("/triage/notice", response_model=TriageNoticeResponse)
async def generate_triage_notice(payload: TriageNoticeRequest) -> TriageNoticeResponse:
    """Draft a compliance-review notice for one anomalous invoice.

    Tries the real agent (app.services.agent.generate_compliance_notice,
    a blocking HTTP call run in a threadpool) first; on any AgentError
    (missing OPENROUTER_API_KEY, network failure, malformed model
    response), logs the failure and falls back to a deterministic
    template rather than returning a 5xx — a compliance officer should
    still get SOME actionable draft even if the LLM provider is down.
    """
    record = payload.model_dump()

    try:
        draft = await run_in_threadpool(generate_compliance_notice, record)
    except AgentError as exc:
        logger.warning(
            "Live agent call failed for invoice_id=%r, falling back to template: %s",
            payload.invoice_id, exc,
        )
        return _deterministic_fallback_notice(payload)

    return TriageNoticeResponse(
        invoice_id=payload.invoice_id,
        severity=draft.severity,
        notice_text=draft.notice_text,
        recommended_action=draft.recommended_action,
        generated_by=draft.generated_by,
        severity_overridden=draft.severity_overridden,
    )
