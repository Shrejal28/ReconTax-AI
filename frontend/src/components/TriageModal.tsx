import { useEffect, useState } from "react";
import { AlertOctagon, Loader2, ShieldAlert, X } from "lucide-react";
import {
  ApiError,
  requestTriageNotice,
  type AnomalousRecord,
  type TriageNoticeResponse,
} from "../lib/api";

interface TriageModalProps {
  /** The record to draft a notice for. Modal is open iff this is non-null. */
  record: AnomalousRecord | null;
  onClose: () => void;
}

/**
 * Modal that calls POST /api/v1/triage/notice for the given record and
 * displays the result: severity badge, notice text, recommended action.
 *
 * The call happens for real on open — no client-side mock. Phase 4: the
 * backend tries a real LLM call (OpenRouter, see app/services/agent.py)
 * first, and only falls back to a deterministic template if that call
 * fails (no API key, network error, unparseable response — see
 * app/api/v1/endpoints/triage.py). The response's `generated_by` field
 * says which one actually answered ("template_fallback", or a model slug
 * like "google/gemini-2.0-flash-thinking-exp"), and this modal surfaces
 * that plainly rather than presenting a fallback notice as if it were the
 * live AI-drafted one. It also flags `severity_overridden`, the rare case
 * where the model proposed a different severity than the deterministic
 * mapping — the severity shown is always the deterministic one regardless.
 */
export default function TriageModal({ record, onClose }: TriageModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<TriageNoticeResponse | null>(null);

  useEffect(() => {
    if (!record) {
      setNotice(null);
      setError(null);
      return;
    }
    if (record.reconciliation_status === "MATCHED") {
      setError("Cannot triage a MATCHED invoice — no anomaly to review.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);

    requestTriageNotice({
      invoice_id: record.invoice_id,
      supplier_id: record.supplier_id,
      invoice_amount: record.invoice_amount,
      reconciliation_status: record.reconciliation_status,
      telemetry_delta_gap: record.telemetry_delta_gap,
    })
      .then((res) => {
        if (!cancelled) setNotice(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? err.status === 404
              ? "Triage endpoint not found (404) — Phase 4 agent may not be deployed yet."
              : err.message
            : "Unexpected error requesting the triage notice.";
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [record]);

  if (!record) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-stone-200 bg-stone-100 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <h3 className="text-sm font-semibold text-stone-900">
            Triage Notice — <span className="font-mono text-stone-600">{record.invoice_id}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-xl p-1 text-stone-600 hover:bg-stone-200 hover:text-stone-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 py-6 text-sm text-stone-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Drafting notice…
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-100/50 bg-red-50/40 px-3 py-2.5 text-sm text-red-700">
              <AlertOctagon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && notice && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={notice.severity} />
                {notice.generated_by === "template_fallback" ? (
                  <span
                    className="inline-flex items-center rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-medium text-stone-600 ring-1 ring-inset ring-stone-300"
                    title="The live AI drafting service was unavailable for this request — see server logs for the underlying error."
                  >
                    Template fallback (AI drafting unavailable)
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/30"
                    title="This notice was drafted live by the named model."
                  >
                    AI-drafted · {notice.generated_by}
                  </span>
                )}
                {notice.severity_overridden && (
                  <span
                    className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 ring-1 ring-inset ring-amber-500/30"
                    title="The model proposed a different severity than the deterministic reconciliation_status mapping. The severity shown here is always the deterministic value — this is audit visibility into the disagreement, not a warning about the severity's correctness."
                  >
                    Model severity overridden
                  </span>
                )}
              </div>

              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-stone-50 p-3 font-mono text-xs leading-relaxed text-stone-700">
                {notice.notice_text}
              </pre>

              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  Recommended Compliance Action
                </span>
                <p className="mt-1 text-sm text-stone-800">{notice.recommended_action}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-stone-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-stone-300 bg-stone-200 px-3.5 py-1.5 text-sm font-medium text-stone-900 hover:bg-stone-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: "HIGH" | "MEDIUM" }) {
  const classes =
    severity === "HIGH"
      ? "bg-red-500/10 text-red-600 ring-red-500/30"
      : "bg-amber-500/10 text-amber-600 ring-amber-500/30";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${classes}`}
    >
      <ShieldAlert className="h-3.5 w-3.5" />
      {severity}
    </span>
  );
}
