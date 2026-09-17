import { AlertTriangle, FileWarning, Receipt, ShieldAlert } from "lucide-react";
import type { IngestResponse, ReconcileResponse, ScoreResponse } from "../lib/api";

interface KpiGridProps {
  ingestResponse: IngestResponse | null;
  reconcileResponse: ReconcileResponse | null;
  scoreResponse: ScoreResponse | null;
}

const currencyFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US");

/**
 * Four top-line KPI cards. "Total Invoices" and "Total Exposure Gap" come
 * from POST /api/v1/reconcile's summary; "Tier 1"/"Tier 2" counts come
 * from POST /api/v1/score's risk_tier_counts (the real LightGBM output,
 * not a reconciliation-status proxy). Each card shows "—" — not a fake
 * zero — until its source endpoint has actually returned data, so an
 * empty state is never mistaken for a real "0".
 */
export default function KpiGrid({ ingestResponse, reconcileResponse, scoreResponse }: KpiGridProps) {
  // Prefer the ingest response so this KPI populates as soon as ingest
  // completes, without waiting on reconciliation to also have run —
  // both report the same row count once both exist, since reconciliation
  // runs over the full ingested frame.
  const totalInvoices = ingestResponse?.master_frame_shape[0] ?? reconcileResponse?.summary.total_rows ?? null;
  const totalExposure = reconcileResponse?.summary.total_telemetry_delta_gap ?? null;
  const tier1Count = scoreResponse?.risk_tier_counts.TIER_1 ?? null;
  const tier2Count = scoreResponse?.risk_tier_counts.TIER_2 ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Total Invoices"
        value={totalInvoices === null ? null : numberFormatter.format(totalInvoices)}
        icon={<Receipt className="h-5 w-5" />}
        accentClassName="text-stone-700"
      />
      <KpiCard
        label="Total Exposure Gap"
        value={totalExposure === null ? null : currencyFormatter.format(totalExposure)}
        icon={<FileWarning className="h-5 w-5" />}
        accentClassName="text-amber-500"
      />
      <KpiCard
        label="Tier 1 (High-Confidence Leak)"
        value={tier1Count === null ? null : numberFormatter.format(tier1Count)}
        icon={<ShieldAlert className="h-5 w-5" />}
        accentClassName="text-red-500"
      />
      <KpiCard
        label="Tier 2 (Structural Anomaly)"
        value={tier2Count === null ? null : numberFormatter.format(tier2Count)}
        icon={<AlertTriangle className="h-5 w-5" />}
        accentClassName="text-amber-500"
      />
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string | null;
  icon: React.ReactNode;
  accentClassName: string;
}

function KpiCard({ label, value, icon, accentClassName }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-600">{label}</span>
        <span className={accentClassName}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-stone-950">
        {value ?? <span className="text-stone-400">—</span>}
      </div>
    </div>
  );
}
