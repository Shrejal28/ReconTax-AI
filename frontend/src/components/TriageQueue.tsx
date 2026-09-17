import { Sparkles } from "lucide-react";
import type { AnomalousRecord, ReconciliationStatus } from "../lib/api";

interface TriageQueueProps {
  records: AnomalousRecord[];
  onTriage: (record: AnomalousRecord) => void;
}

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

/**
 * Renders ReconcileResponse.anomalous_records (real, server-computed top-N
 * exposure rows — never client-fabricated). Each row's [AI Triage Notice]
 * button hands the record up to App.tsx, which opens TriageModal; this
 * component makes no API call itself.
 */
export default function TriageQueue({ records, onTriage }: TriageQueueProps) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4">
      <h2 className="text-sm font-semibold text-stone-800">Triage Queue</h2>

      {records.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">
          Run reconciliation to populate the highest-exposure anomalous invoices here.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-4 font-medium">Invoice</th>
                <th className="py-2 pr-4 font-medium">Supplier</th>
                <th className="py-2 pr-4 font-medium text-right">Amount</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium text-right">Exposure Gap</th>
                <th className="py-2 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.invoice_id} className="border-b border-stone-200/60 last:border-0">
                  <td className="py-2.5 pr-4 font-mono text-xs text-stone-700">{record.invoice_id}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-stone-600" title={record.supplier_id}>
                    {record.supplier_id.slice(0, 8)}…
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-stone-700">
                    {currencyFormatter.format(record.invoice_amount)}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE_CLASS[record.reconciliation_status]}`}
                    >
                      {record.reconciliation_status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums font-medium text-red-600">
                    {currencyFormatter.format(record.telemetry_delta_gap)}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onTriage(record)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-900 hover:bg-stone-300"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      AI Triage Notice
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
