"""
app/schemas/triage.py
------------------------
Pydantic v2 models for POST /api/v1/triage/notice.

Phase 4: the endpoint calls a real LLM (via OpenRouter — see
app/services/agent.py) to draft the notice, falling back to a
deterministic template only if the live call fails (missing API key,
network error, unparseable response). `generated_by` tells you which one
actually answered for a given response — either an OpenRouter model slug
(e.g. "google/gemini-2.0-flash-thinking-exp") or "template_fallback".
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TriageNoticeRequest(BaseModel):
    """One anomalous record to draft a notice for — matches the shape of
    an item in ReconcileResponse.anomalous_records."""

    invoice_id: str
    supplier_id: str
    invoice_amount: float = Field(gt=0)
    reconciliation_status: Literal["AMOUNT_MISMATCH", "MISSING_SFT", "MISSING_GSTR"]
    telemetry_delta_gap: float = Field(ge=0.0)


class TriageNoticeResponse(BaseModel):
    """Body of the POST /api/v1/triage/notice response."""

    invoice_id: str
    severity: Literal["HIGH", "MEDIUM"]
    notice_text: str
    recommended_action: str
    generated_by: str = Field(
        description="The OpenRouter model slug that actually drafted this notice "
        "(e.g. 'google/gemini-2.0-flash-thinking-exp'), or 'template_fallback' if the "
        "live call failed and a deterministic template was used instead.",
    )
    severity_overridden: bool = Field(
        default=False,
        description="True if the model proposed a different severity than the deterministic "
        "reconciliation_status→severity mapping — the deterministic value always wins "
        "(see app/services/agent.py's module docstring); this flag just surfaces that "
        "a disagreement happened, for audit visibility. Always False on a template_fallback response.",
    )
