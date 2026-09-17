"""
app/api/v1/endpoints/tax_planning.py
----------------------------------------
POST /api/v1/tax-planning/simulate

Stateless, deterministic scenario comparator — see app/schemas/tax_planning.py's
module docstring for what the two regimes represent and why the rates are
illustrative rather than sourced from live tax law. No LLM call, no
app.state dependency: the same request body always returns the same
response, which is the point for a "what-if" planning tool.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas.tax_planning import (
    CONCESSIONAL_REGIME_RATE,
    MARGINAL_SAVINGS_THRESHOLD,
    STANDARD_REGIME_RATE,
    RegimeResult,
    TaxScenarioRequest,
    TaxScenarioResponse,
)

router = APIRouter(prefix="/api/v1", tags=["tax-planning"])


def _compute_regime(
    *,
    regime: str,
    rate: float,
    projected_ebitda: float,
    deductions: float,
    allows_deductions: bool,
) -> RegimeResult:
    taxable_income = projected_ebitda - deductions if allows_deductions else projected_ebitda
    taxable_income = max(taxable_income, 0.0)
    tax_payable = round(taxable_income * rate, 2)
    return RegimeResult(
        regime=regime,
        effective_rate=rate,
        taxable_income=round(taxable_income, 2),
        allows_deductions=allows_deductions,
        tax_payable=tax_payable,
    )


@router.post("/tax-planning/simulate", response_model=TaxScenarioResponse)
def simulate_tax_scenario(payload: TaxScenarioRequest) -> TaxScenarioResponse:
    """Compare STANDARD vs CONCESSIONAL regime tax payable for one scenario.

    STANDARD applies the higher flat rate to income net of planned capex +
    Section 80-style deductions. CONCESSIONAL applies the lower flat rate
    to gross EBITDA (no deductions allowed) — the conventional trade-off
    a concessional-rate regime makes in exchange for the lower rate.
    """
    total_deductions = payload.planned_capex + payload.section_80_deductions

    standard = _compute_regime(
        regime="STANDARD",
        rate=STANDARD_REGIME_RATE,
        projected_ebitda=payload.projected_ebitda,
        deductions=total_deductions,
        allows_deductions=True,
    )
    concessional = _compute_regime(
        regime="CONCESSIONAL",
        rate=CONCESSIONAL_REGIME_RATE,
        projected_ebitda=payload.projected_ebitda,
        deductions=total_deductions,
        allows_deductions=False,
    )

    savings = round(standard.tax_payable - concessional.tax_payable, 2)

    if abs(savings) < MARGINAL_SAVINGS_THRESHOLD:
        recommendation = "HUMAN_REVIEW_RECOMMENDED"
    elif savings > 0:
        recommendation = "RECOMMEND_CONCESSIONAL_REGIME"
    else:
        recommendation = "RECOMMEND_STANDARD_REGIME"

    return TaxScenarioResponse(
        standard=standard,
        concessional=concessional,
        savings_vs_standard=savings,
        recommendation=recommendation,
    )
