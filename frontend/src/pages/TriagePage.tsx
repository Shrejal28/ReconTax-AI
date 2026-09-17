/**
 * src/pages/TriagePage.tsx
 * -----------------------------
 * Route: /triage (any authenticated role; AUDITOR is read-only)
 *
 * Anomalous record queue (real data from WorkflowContext's last
 * /reconcile call) + the real AI compliance-notice generator (real POST
 * /api/v1/triage/notice via TriageModal). Adds two things the backend
 * has no endpoint for, both labeled as such:
 *   - an SLA "turnaround" timer badge — client-side elapsed time since
 *     the record was first seen in this browser session, not a real
 *     backend-tracked queue time.
 *   - Hold/Approve buttons — a local disposition on top of the triage
 *     notice, logged to the session audit chain (AuditContext); there is
 *     no backend endpoint to persist this decision.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, PauseCircle, Sparkles, Clock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useWorkflow } from "../context/WorkflowContext";
import { useAudit } from "../context/AuditContext";
import TriageModal from "../components/TriageModal";
import type { AnomalousRecord, ReconciliationStatus } from "../lib/api";

const STATUS_BADGE_CLASS: Record<ReconciliationStatus, string> = {
  MATCHED: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/30",
  AMOUNT_MISMATCH: "bg-amber-500/10 text-amber-600 ring-amber-500/30",
  MISSING_GSTR: "bg-red-500/10 text-red-600 ring-red-500/30",
  MISSING_SFT: "bg-red-500/10 text-red-600 ring-red-500/30",
};

const currencyFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 2,
});

const SLA_TARGET_MS = 4 * 60 * 60 * 1000; // 4.0 hr target, matches DashboardPage's illustrative SLA card

type Disposition = "PENDING" | "HELD" | "APPROVED";

export default function TriagePage() {
  const { user } = useAuth();
  const { reconcileResponse } = useWorkflow();
  const { logEvent } = useAudit();
  const readOnly = user?.role === "AUDITOR";

  const records = reconcileResponse?.anomalous_records ?? [];

  // Client-side "first seen" timestamps, purely for the illustrative SLA
  // badge — see module docstring. Keyed by invoice_id; a fresh
  // reconciliation run (new records) just adds new entries.
  const [firstSeen, setFirstSeen] = useState<Record<string, number>>({});
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>({});
  const [now, setNow] = useState(Date.now());
  const [triageRecord, setTriageRecord] = useState<AnomalousRecord | null>(null);

  useEffect(() => {
    setFirstSeen((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of records) {
        if (!(r.invoice_id in next)) {
          next[r.invoice_id] = Date.now();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconcileResponse]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  async function handleDisposition(record: AnomalousRecord, disposition: "HELD" | "APPROVED") {
    if (readOnly || !user) return;
    setDispositions((prev) => ({ ...prev, [record.invoice_id]: disposition }));
    await logEvent({
      actor: user.email,
      role: user.role,
      eventType: disposition === "HELD" ? "TRIAGE_HOLD" : "TRIAGE_APPROVE",
      payload: {
        invoice_id: record.invoice_id,
        supplier_id: record.supplier_id,
        reconciliation_status: record.reconciliation_status,
        telemetry_delta_gap: record.telemetry_delta_gap,
      },
    });
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <div>
        <h2 className="text-base font-semibold text-stone-950">Triage Queue</h2>
        <p className="mt-1 text-xs text-stone-500">
          Highest-exposure anomalous invoices from the last reconciliation run. SLA badges are a
          client-side elapsed-time indicator for this session, not a persisted backend queue time.
        </p>
      </div>

      {readOnly && (
        <div className="rounded-2xl border border-stone-300/60 bg-stone-100/40 px-4 py-2.5 text-xs text-stone-600">
          AUDITOR role is read-only — Hold/Approve actions are disabled.
        </div>
      )}

      {records.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4 text-sm text-stone-500">
          No anomalous records yet — run Reconciliation first.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-stone-100/60 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Invoice</th>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Exposure Gap</th>
                <th className="px-4 py-2.5 font-medium">SLA</th>
                <th className="px-4 py-2.5 font-medium">Disposition</th>
                <th className="px-4 py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200/60">
              {records.map((record) => {
                const disposition = dispositions[record.invoice_id] ?? "PENDING";
                const startedAt = firstSeen[record.invoice_id] ?? now;
                const elapsedMs = now - startedAt;
                const overSla = elapsedMs > SLA_TARGET_MS;
                return (
                  <tr key={record.invoice_id}>
                    <td className="px-4 py-2.5 font-mono text-xs text-stone-700">{record.invoice_id}</td>
                    <td
                      className="px-4 py-2.5 font-mono text-xs text-stone-600"
                      title={record.supplier_id}
                    >
                      {record.supplier_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-stone-700">
                      {currencyFormatter.format(record.invoice_amount)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE_CLASS[record.reconciliation_status]}`}
                      >
                        {record.reconciliation_status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-red-600">
                      {currencyFormatter.format(record.telemetry_delta_gap)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                          overSla
                            ? "bg-red-500/10 text-red-600 ring-red-500/30"
                            : "bg-stone-200 text-stone-600 ring-stone-300"
                        }`}
                        title="Illustrative — client-side elapsed time, not a persisted backend metric"
                      >
                        <Clock className="h-3 w-3" />
                        {formatElapsed(elapsedMs)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <DispositionBadge disposition={disposition} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setTriageRecord(record)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-900 hover:bg-stone-300"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          AI Notice
                        </button>
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => handleDisposition(record, "HELD")}
                          className="inline-flex items-center gap-1 rounded-xl border border-amber-300/60 bg-amber-100/20 px-2 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100/40 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Hold"
                        >
                          <PauseCircle className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => handleDisposition(record, "APPROVED")}
                          className="inline-flex items-center gap-1 rounded-xl border border-emerald-300/60 bg-emerald-100/20 px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100/40 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Approve"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TriageModal record={triageRecord} onClose={() => setTriageRecord(null)} />
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function DispositionBadge({ disposition }: { disposition: Disposition }) {
  if (disposition === "PENDING") {
    return <span className="text-xs text-stone-400">—</span>;
  }
  const classes =
    disposition === "HELD"
      ? "bg-amber-500/10 text-amber-600 ring-amber-500/30"
      : "bg-emerald-500/10 text-emerald-600 ring-emerald-500/30";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${classes}`}>
      {disposition}
    </span>
  );
}
