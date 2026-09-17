/**
 * src/pages/ReconciliationPage.tsx
 * -------------------------------------
 * Route: /reconciliation (any authenticated role; AUDITOR is read-only)
 *
 * Real POST /api/v1/reconcile call via WorkflowContext. Reuses the
 * existing ReconBreakdown component for the 4-status exposure grid.
 */

import { AlertTriangle, GitCompareArrows, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useWorkflow } from "../context/WorkflowContext";
import ReconBreakdown from "../components/ReconBreakdown";

export default function ReconciliationPage() {
  const { user } = useAuth();
  const { seed, setSeed, reconcileLoading, reconcileResponse, banner, runReconcile } = useWorkflow();
  const readOnly = user?.role === "AUDITOR";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <div>
        <h2 className="text-base font-semibold text-stone-950">SFT / GSTR Reconciliation</h2>
        <p className="mt-1 text-xs text-stone-500">
          Simulates external bank/tax telemetry and computes per-invoice reconciliation status.
        </p>
      </div>

      {readOnly && (
        <div className="rounded-2xl border border-stone-300/60 bg-stone-100/40 px-4 py-2.5 text-xs text-stone-600">
          AUDITOR role is read-only — triggering reconciliation is disabled.
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-100 p-4 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1.5 sm:w-32">
          <span className="text-xs font-medium uppercase tracking-wide text-stone-600">Seed</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
            disabled={readOnly}
            className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={runReconcile}
          disabled={readOnly || reconcileLoading}
          className="inline-flex items-center gap-2 rounded-xl bg-pink-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {reconcileLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GitCompareArrows className="h-4 w-4" />
          )}
          Run Reconciliation
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

      <ReconBreakdown summary={reconcileResponse?.summary ?? null} />
    </div>
  );
}
