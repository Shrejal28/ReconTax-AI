"""
app/schemas/tax_planning.py
-------------------------------
Pydantic v2 models for POST /api/v1/tax-planning/simulate.

This is a deterministic, formula-driven scenario calculator — not a tax
opinion and not a call to any LLM. It compares two illustrative flat
effective-rate regimes against the same taxable-income base, so a given
input always produces the same output. The rates below are the ones the
product spec calls for; they are simplified stand-ins for real corporate
tax regimes (India's normal vs. concessional 115BAA-style rate structure
is the shape being illustrated), NOT a citation of current law, and the
response says so explicitly so nobody mistakes this for filed-return
guidance.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Illustrative flat effective rates. Not sourced from live tax law — see
# module docstring and TaxScenarioResponse.disclaimer.
STANDARD_REGIME_RATE = 0.255
CONCESSIONAL_REGIME_RATE = 0.220

# Below this absolute savings threshold, the concessional regime's benefit
# is judged too marginal for a confident automated recommendation, and
# HUMAN_REVIEW_RECOMMENDED is returned instead of picking a side.
MARGINAL_SAVINGS_THRESHOLD = 10_000.0


class TaxScenarioRequest(BaseModel):
    """Body of POST /api/v1/tax-planning/simulate."""

    projected_ebitda: float = Field(
        ..., gt=0, description="Projected EBITDA for the scenario period, in the reporting currency."
    )
    planned_capex: float = Field(
        default=0.0, ge=0,
        description="Planned capital-expenditure additions for the period. Reduces taxable "
        "income dollar-for-dollar in this simplified model (a stand-in for depreciation/"
        "investment-linked deductions, not real depreciation-schedule math).",
    )
    section_80_deductions: float = Field(
        default=0.0, ge=0,
        description="Other planned deductions for the period (Section 80-style), also reducing "
        "taxable income dollar-for-dollar in this simplified model.",
    )


class RegimeResult(BaseModel):
    """One regime's outcome for the given scenario inputs."""

    regime: Literal["STANDARD", "CONCESSIONAL"]
    effective_rate: float = Field(description="Flat effective rate applied for this regime.")
    taxable_income: float = Field(
        description="projected_ebitda minus deductions. CONCESSIONAL regimes conventionally "
        "restrict which deductions apply — see allows_deductions."
    )
    allows_deductions: bool = Field(
        description="Whether planned_capex/section_80_deductions were subtracted for this "
        "regime. The concessional regime here does not allow them (mirroring the real-world "
        "trade-off: a lower flat rate in exchange for giving up most deductions), so its "
        "taxable_income is the full projected_ebitda."
    )
    tax_payable: float = Field(description="taxable_income * effective_rate, floored at 0.")


class TaxScenarioResponse(BaseModel):
    """Body of the POST /api/v1/tax-planning/simulate response."""

    standard: RegimeResult
    concessional: RegimeResult
    savings_vs_standard: float = Field(
        description="standard.tax_payable - concessional.tax_payable. Positive means the "
        "concessional regime pays less tax for this scenario."
    )
    recommendation: Literal[
        "RECOMMEND_CONCESSIONAL_REGIME",
        "RECOMMEND_STANDARD_REGIME",
        "HUMAN_REVIEW_RECOMMENDED",
    ] = Field(
        description="Deterministic recommendation from comparing tax_payable across regimes. "
        "HUMAN_REVIEW_RECOMMENDED when the two are within MARGINAL_SAVINGS_THRESHOLD of each "
        "other — the model does not force a pick when the numbers are this close."
    )
    disclaimer: str = Field(
        default=(
            "Illustrative scenario comparison using simplified flat effective rates. "
            "Not tax, legal, or financial advice — consult a qualified advisor before "
            "acting on any regime choice."
        )
    )
