/**
 * src/pages/DashboardPage.tsx
 * -------------------------------
 * Route: /dashboard
 *
 * Executive summary view. All numbers here come from WorkflowContext's
 * real ingest/score/reconcile responses (or show an explicit "not yet
 * run" empty state) — except the SLA turnaround metric, which the
 * backend has no endpoint for at all; that card is labeled illustrative
 * rather than presented as live telemetry, per "zero fake mock data
 * where live backend endpoints exist."
 */

import { Link } from "react-router-dom";
import {
  FileWarning,
  ShieldAlert,
  Gauge,
  Cpu,
  Clock,
  ArrowRight,
} from "lucide-react";
import { useWorkflow } from "../context/WorkflowContext";

const currencyFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("en-US");

export default function DashboardPage() {
  const { ingestResponse, scoreResponse, reconcileResponse } = useWorkflow();

  const totalExposure = reconcileResponse?.summary.total_telemetry_delta_gap ?? null;
  const tier1Count = scoreResponse?.risk_tier_counts.TIER_1 ?? null;
  const tier2Count = scoreResponse?.risk_tier_counts.TIER_2 ?? null;
  const tier3Count = scoreResponse?.risk_tier_counts.TIER_3 ?? null;
  const tierTotal =
    tier1Count !== null && tier2Count !== null && tier3Count !== null
      ? tier1Count + tier2Count + tier3Count
      : null;

  const rocAuc = scoreResponse?.val_metrics?.roc_auc ?? null;
  const avgPrecision = scoreResponse?.val_metrics?.average_precision ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <div>
        <h2 className="text-base font-semibold text-stone-950">Executive Overview</h2>
        <p className="mt-1 text-xs text-stone-500">
          Live from this session&apos;s pipeline run — run{" "}
          <Link to="/ingestion" className="text-pink-600 hover:underline">
            Ingestion
          </Link>
          ,{" "}
          <Link to="/scoring" className="text-pink-600 hover:underline">
            Scoring
          </Link>
          , and{" "}
          <Link to="/reconciliation" className="text-pink-600 hover:underline">
            Reconciliation
          </Link>{" "}
          to populate these.
        </p>
      </div>

      {/* Executive KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total Exposure"
          value={totalExposure === null ? null : currencyFormatter.format(totalExposure)}
          icon={<FileWarning className="h-5 w-5" />}
          accentClassName="text-amber-500"
        />
        <KpiCard
          label="High-Risk Anomaly Count (Tier 1)"
          value={tier1Count === null ? null : numberFormatter.format(tier1Count)}
          icon={<ShieldAlert className="h-5 w-5" />}
          accentClassName="text-red-500"
        />
        <KpiCard
          label="SLA Compliance"
          value="94.2%"
          icon={<Gauge className="h-5 w-5" />}
          accentClassName="text-emerald-500"
          illustrative
        />
      </div>

      {/* Model metadata banner */}
      <div className="rounded-2xl border border-stone-200/80 bg-stone-100/60 p-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-stone-500" />
            <span className="text-xs text-stone-500">Active Model</span>
            <span className="rounded-full bg-stone-200 px-2 py-0.5 font-mono text-xs text-stone-800">
              lightgbm-gbdt-v2
            </span>
          </div>
          <MetricPill label="Validation ROC-AUC" value={rocAuc === null ? null : rocAuc.toFixed(3)} />
          <MetricPill
            label="Validation AP"
            value={avgPrecision === null ? null : avgPrecision.toFixed(3)}
          />
          {!scoreResponse && (
            <Link
              to="/scoring"
              className="ml-auto inline-flex items-center gap-1 text-xs text-pink-600 hover:underline"
            >
              Run Scoring for live metrics
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>

      {/* SLA turnaround clock — illustrative, no backend SLA telemetry exists */}
      <div className="flex items-center gap-4 rounded-2xl border border-dashed border-stone-300/60 bg-stone-100/40 p-4">
        <Clock className="h-5 w-5 flex-shrink-0 text-stone-500" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-stone-600">
            Median turnaround: <span className="font-semibold text-stone-900">3.8 hrs</span>
          </span>
          <span className="text-stone-600">
            Target SLA: <span className="font-semibold text-stone-900">4.0 hrs</span>
          </span>
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-stone-500">
            Illustrative — no backend SLA telemetry yet
          </span>
        </div>
      </div>

      {/* Tier distribution */}
      <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4">
        <h3 className="text-sm font-semibold text-stone-800">Risk Tier Distribution</h3>
        {!scoreResponse ? (
          <p className="mt-3 text-sm text-stone-500">
            Run{" "}
            <Link to="/scoring" className="text-pink-600 hover:underline">
              Scoring
            </Link>{" "}
            to populate tier counts.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <TierBar label="TIER_1" count={tier1Count ?? 0} total={tierTotal ?? 1} colorClass="bg-red-500" />
            <TierBar label="TIER_2" count={tier2Count ?? 0} total={tierTotal ?? 1} colorClass="bg-amber-500" />
            <TierBar
              label="TIER_3"
              count={tier3Count ?? 0}
              total={tierTotal ?? 1}
              colorClass="bg-emerald-500"
            />
          </div>
        )}
      </div>

      {!ingestResponse && (
        <div className="rounded-2xl border border-amber-200/50 bg-amber-50/20 px-4 py-3 text-sm text-amber-800">
          No dataset ingested yet this session.{" "}
          <Link to="/ingestion" className="font-medium underline">
            Go to Ingestion
          </Link>{" "}
          to get started.
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  accentClassName,
  illustrative,
}: {
  label: string;
  value: string | null;
  icon: React.ReactNode;
  accentClassName: string;
  illustrative?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-600">{label}</span>
        <span className={accentClassName}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-stone-950">
        {value ?? <span className="text-stone-400">—</span>}
      </div>
      {illustrative && <p className="mt-1 text-[10px] text-stone-400">Illustrative demo value</p>}
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-stone-500">{label}</span>
      <span className="font-mono font-medium text-stone-800">
        {value ?? <span className="text-stone-400">—</span>}
      </span>
    </div>
  );
}

function TierBar({
  label,
  count,
  total,
  colorClass,
}: {
  label: string;
  count: number;
  total: number;
  colorClass: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-stone-700">{label}</span>
        <span className="tabular-nums text-stone-600">
          {numberFormatter.format(count)} ({pct.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200">
        <div className={`h-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
