/**
 * src/pages/ScoringPage.tsx
 * -----------------------------
 * Route: /scoring (any authenticated role; AUDITOR is read-only)
 *
 * Real POST /api/v1/score call via WorkflowContext.
 */

import { AlertTriangle, Loader2, ScanSearch } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useWorkflow } from "../context/WorkflowContext";

export default function ScoringPage() {
  const { user } = useAuth();
  const { scoreLoading, scoreResponse, banner, runScore } = useWorkflow();
  const readOnly = user?.role === "AUDITOR";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <div>
        <h2 className="text-base font-semibold text-stone-950">Model Scoring</h2>
        <p className="mt-1 text-xs text-stone-500">
          Trains (or reuses a cached) LightGBM risk scorer and applies Tier 1/2/3 routing.
        </p>
      </div>

      {readOnly && (
        <div className="rounded-2xl border border-stone-300/60 bg-stone-100/40 px-4 py-2.5 text-xs text-stone-600">
          AUDITOR role is read-only — triggering scoring is disabled.
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={runScore}
          disabled={readOnly || scoreLoading}
          className="inline-flex items-center gap-2 rounded-xl bg-pink-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scoreLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
          Trigger Score
        </button>
      </div>

      {banner && (
        <div
          className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
            banner.isMissingState
              ? "border-amber-200/60 bg-amber-50/40 text-amber-800"
              : "border-red-100/60 bg-red-50/40 text-red-800"
          }`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{banner.message}</span>
        </div>
      )}

      {scoreResponse && (
        <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4">
          <h3 className="text-sm font-semibold text-stone-800">Score Summary</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <SummaryItem
              label="Model Retrained"
              value={scoreResponse.model_retrained ? "Yes (fresh train)" : "No (cache hit)"}
            />
            <SummaryItem label="Rows Scored" value={scoreResponse.n_scored.toLocaleString()} />
            <SummaryItem label="Tier 1" value={scoreResponse.risk_tier_counts.TIER_1.toLocaleString()} />
            <SummaryItem label="Tier 2" value={scoreResponse.risk_tier_counts.TIER_2.toLocaleString()} />
            <SummaryItem label="Tier 3" value={scoreResponse.risk_tier_counts.TIER_3.toLocaleString()} />
            {scoreResponse.val_metrics && (
              <>
                <SummaryItem label="Val ROC-AUC" value={scoreResponse.val_metrics.roc_auc.toFixed(4)} />
                <SummaryItem
                  label="Val Avg Precision"
                  value={scoreResponse.val_metrics.average_precision.toFixed(4)}
                />
                <SummaryItem
                  label="Precision @ Tier 1"
                  value={`${(scoreResponse.val_metrics.precision_at_tier1 * 100).toFixed(2)}%`}
                />
              </>
            )}
          </dl>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-700">
              Raw response JSON
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-stone-50 p-3 text-xs text-stone-600">
              {JSON.stringify(scoreResponse, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums text-stone-900">{value}</dd>
    </div>
  );
}
