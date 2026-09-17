/**
 * src/pages/TaxPlanningPage.tsx
 * ----------------------------------
 * Route: /tax-planning (ADMIN and ANALYST only — see App.tsx's
 * ProtectedRoute requireRole={["ADMIN", "ANALYST"]})
 *
 * Executive Scenario Simulator: a real, stateless POST to
 * /api/v1/tax-planning/simulate on every input change (debounced), never
 * computed client-side — the backend's formula is the single source of
 * truth so the UI can't silently drift from it. See
 * app/schemas/tax_planning.py's module docstring for what STANDARD vs
 * CONCESSIONAL represent: illustrative flat effective rates, not a
 * citation of current tax law. The disclaimer the backend returns is
 * always shown, not just accepted and dropped.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Info, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { ApiError, requestTaxScenario, type TaxScenarioResponse } from "../lib/api";

const DEFAULTS = {
  projected_ebitda: 5_000_000,
  planned_capex: 500_000,
  section_80_deductions: 150_000,
};

const RECOMMENDATION_COPY: Record<
  TaxScenarioResponse["recommendation"],
  { label: string; className: string }
> = {
  RECOMMEND_CONCESSIONAL_REGIME: {
    label: "RECOMMEND_CONCESSIONAL_REGIME",
    className: "bg-pink-600 text-white",
  },
  RECOMMEND_STANDARD_REGIME: {
    label: "RECOMMEND_STANDARD_REGIME",
    className: "bg-stone-950 text-white",
  },
  HUMAN_REVIEW_RECOMMENDED: {
    label: "HUMAN_REVIEW_RECOMMENDED",
    className: "bg-amber-400 text-stone-950",
  },
};

export default function TaxPlanningPage() {
  const [ebitda, setEbitda] = useState(DEFAULTS.projected_ebitda);
  const [capex, setCapex] = useState(DEFAULTS.planned_capex);
  const [section80, setSection80] = useState(DEFAULTS.section_80_deductions);

  const [result, setResult] = useState<TaxScenarioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced live re-simulation: real backend call, not a client-side
  // formula, so the numbers on screen can never drift from the API.
  useEffect(() => {
    if (ebitda <= 0) {
      setError("Projected EBITDA must be greater than 0.");
      setResult(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      requestTaxScenario({
        projected_ebitda: ebitda,
        planned_capex: capex,
        section_80_deductions: section80,
      })
        .then((res) => {
          if (!cancelled) setResult(res);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof ApiError ? err.message : "Unexpected error running the scenario.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [ebitda, capex, section80]);

  return (
    <div className="min-h-[calc(100vh-57px)] bg-[#FAF8F5]">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-bold text-stone-950">Executive Scenario Simulator</h2>
          <p className="mt-1 text-xs text-stone-500">
            Compares two illustrative flat-rate regimes for the same scenario — every number
            below is a live call to <code className="text-stone-600">POST /api/v1/tax-planning/simulate</code>,
            recomputed as you adjust the inputs.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          {/* Left: parameter drawer */}
          <div className="h-fit rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-pink-700">Scenario Inputs</h3>
            <div className="mt-4 flex flex-col gap-5">
              <ParamInput
                label="Projected EBITDA"
                value={ebitda}
                min={0}
                max={50_000_000}
                step={50_000}
                onChange={setEbitda}
              />
              <ParamInput
                label="Planned Capex Additions"
                value={capex}
                min={0}
                max={10_000_000}
                step={10_000}
                onChange={setCapex}
              />
              <ParamInput
                label="Section 80 Deductions"
                value={section80}
                min={0}
                max={5_000_000}
                step={10_000}
                onChange={setSection80}
              />
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100/60 bg-red-50/40 px-3 py-2 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Right: comparative intelligence canvas */}
          <div className="flex flex-col gap-5">
            {loading && !result && (
              <div className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Running scenario…
              </div>
            )}

            {result && (
              <>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <RegimeCard
                    title="Standard Corporate Rate"
                    subtitle={`${(result.standard.effective_rate * 100).toFixed(1)}% effective`}
                    regime={result.standard}
                    accent="stone"
                  />
                  <RegimeCard
                    title="Concessional Alternative"
                    subtitle={`${(result.concessional.effective_rate * 100).toFixed(1)}% effective`}
                    regime={result.concessional}
                    accent="pink"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    {result.savings_vs_standard >= 0 ? (
                      <TrendingDown className="h-5 w-5 text-pink-600" />
                    ) : (
                      <TrendingUp className="h-5 w-5 text-stone-700" />
                    )}
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                        Savings vs. Standard (Concessional)
                      </p>
                      <p
                        className={`text-xl font-bold tabular-nums ${
                          result.savings_vs_standard >= 0 ? "text-pink-600" : "text-stone-900"
                        }`}
                      >
                        {result.savings_vs_standard >= 0 ? "+" : ""}
                        {result.savings_vs_standard.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-bold tracking-wide ${
                      RECOMMENDATION_COPY[result.recommendation].className
                    }`}
                  >
                    {RECOMMENDATION_COPY[result.recommendation].label}
                  </span>
                </div>

                <div className="flex items-start gap-2 rounded-2xl border border-amber-200/60 bg-amber-50/40 px-4 py-3 text-xs text-amber-800">
                  <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>{result.disclaimer}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ParamInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-medium text-stone-600">{label}</label>
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-32 rounded-lg border border-stone-300 bg-stone-50 px-2 py-1 text-right text-xs font-medium tabular-nums text-stone-900 outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-pink-600"
      />
    </div>
  );
}

function RegimeCard({
  title,
  subtitle,
  regime,
  accent,
}: {
  title: string;
  subtitle: string;
  regime: TaxScenarioResponse["standard"];
  accent: "stone" | "pink";
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-stone-950">{title}</h4>
          <p className={`text-xs font-semibold ${accent === "pink" ? "text-pink-600" : "text-stone-500"}`}>
            {subtitle}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            accent === "pink" ? "bg-pink-100 text-pink-700" : "bg-stone-100 text-stone-600"
          }`}
        >
          {regime.regime}
        </span>
      </div>

      <dl className="flex flex-col gap-2 text-sm">
        <Row label="Taxable Income" value={regime.taxable_income.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
        <Row
          label="Deductions Applied"
          value={regime.allows_deductions ? "Yes" : "No (flat-rate trade-off)"}
        />
        <Row
          label="Tax Payable"
          value={regime.tax_payable.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          emphasize
        />
      </dl>
    </div>
  );
}

function Row({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-stone-100 pt-2 first:border-0 first:pt-0">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className={`tabular-nums ${emphasize ? "text-base font-bold text-stone-950" : "text-sm font-medium text-stone-800"}`}>
        {value}
      </dd>
    </div>
  );
}
