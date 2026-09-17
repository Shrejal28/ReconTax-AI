import type { ReconciliationStatus, ReconciliationSummary } from "../lib/api";

interface ReconBreakdownProps {
  summary: ReconciliationSummary | null;
}

const STATUS_ORDER: ReconciliationStatus[] = [
  "MATCHED",
  "AMOUNT_MISMATCH",
  "MISSING_GSTR",
  "MISSING_SFT",
];

const STATUS_LABEL: Record<ReconciliationStatus, string> = {
  MATCHED: "Matched",
  AMOUNT_MISMATCH: "Amount Mismatch",
  MISSING_GSTR: "Missing GSTR Filing",
  MISSING_SFT: "Missing SFT Record",
};

// emerald for MATCHED, amber for MISMATCH, red for the two MISSING states —
// per the enterprise fintech compliance palette.
const STATUS_DOT: Record<ReconciliationStatus, string> = {
  MATCHED: "bg-emerald-500",
  AMOUNT_MISMATCH: "bg-amber-500",
  MISSING_GSTR: "bg-red-500",
  MISSING_SFT: "bg-red-500",
};

const STATUS_TEXT: Record<ReconciliationStatus, string> = {
  MATCHED: "text-emerald-500",
  AMOUNT_MISMATCH: "text-amber-500",
  MISSING_GSTR: "text-red-500",
  MISSING_SFT: "text-red-500",
};

const currencyFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("en-US");

/**
 * Renders the 4-status reconciliation breakdown from
 * ReconcileResponse.summary.by_status. Shows an empty-state message
 * (not a table of zeroes) until a real /reconcile response exists.
 */
export default function ReconBreakdown({ summary }: ReconBreakdownProps) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4">
      <h2 className="text-sm font-semibold text-stone-800">Reconciliation Breakdown</h2>

      {!summary ? (
        <p className="mt-3 text-sm text-stone-500">
          Run reconciliation to see the SFT/GSTR status breakdown.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium text-right">Rows</th>
                <th className="py-2 pr-4 font-medium text-right">% of Total</th>
                <th className="py-2 pr-4 font-medium text-right">Invoice Amount</th>
                <th className="py-2 font-medium text-right">Exposure Gap</th>
              </tr>
            </thead>
            <tbody>
              {STATUS_ORDER.map((status) => {
                const row = summary.by_status[status];
                return (
                  <tr key={status} className="border-b border-stone-200/60 last:border-0">
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
                        <span className="font-medium text-stone-800">{STATUS_LABEL[status]}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-stone-700">
                      {numberFormatter.format(row?.count ?? 0)}
                    </td>
                    <td className={`py-2.5 pr-4 text-right tabular-nums font-medium ${STATUS_TEXT[status]}`}>
                      {(row?.pct_of_rows ?? 0).toFixed(2)}%
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-stone-700">
                      {currencyFormatter.format(row?.invoice_amount_sum ?? 0)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-stone-700">
                      {currencyFormatter.format(row?.telemetry_delta_gap_sum ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
