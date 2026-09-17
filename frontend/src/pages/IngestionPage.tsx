/**
 * src/pages/IngestionPage.tsx
 * -------------------------------
 * Route: /ingestion (any authenticated role; AUDITOR is read-only)
 *
 * Real POST /api/v1/ingest call via WorkflowContext — no mock data.
 */

import { useState } from "react";
import { AlertTriangle, Database, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useWorkflow } from "../context/WorkflowContext";
import OcrStagingGrid from "../components/OcrStagingGrid";

type IngestionTab = "dataset" | "ocr";

export default function IngestionPage() {
  const { user } = useAuth();
  const { datasetPath, setDatasetPath, ingestLoading, ingestResponse, banner, runIngest } =
    useWorkflow();
  const readOnly = user?.role === "AUDITOR";
  const [tab, setTab] = useState<IngestionTab>("dataset");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <div>
        <h2 className="text-base font-semibold text-stone-950">Dataset Ingestion</h2>
        <p className="mt-1 text-xs text-stone-500">
          Loads and validates the parquet dataset bundle via a real backend call, or stage a
          single vendor invoice through real OCR extraction.
        </p>
      </div>

      <div className="inline-flex w-fit items-center gap-1 rounded-full bg-stone-100 p-1 text-sm">
        <button
          type="button"
          onClick={() => setTab("dataset")}
          className={`rounded-full px-3.5 py-1.5 font-medium transition-colors ${
            tab === "dataset" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
          }`}
        >
          Dataset Ingestion
        </button>
        <button
          type="button"
          onClick={() => setTab("ocr")}
          className={`rounded-full px-3.5 py-1.5 font-medium transition-colors ${
            tab === "ocr" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
          }`}
        >
          Smart OCR Staging
        </button>
      </div>

      {tab === "ocr" ? (
        <OcrStagingGrid />
      ) : (
        <>
      {readOnly && (
        <div className="rounded-2xl border border-stone-300/60 bg-stone-100/40 px-4 py-2.5 text-xs text-stone-600">
          AUDITOR role is read-only — ingestion is disabled.
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-100 p-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-stone-600">
            Dataset Path
          </span>
          <input
            type="text"
            value={datasetPath}
            onChange={(e) => setDatasetPath(e.target.value)}
            disabled={readOnly}
            placeholder="/path/to/Procurement Invoice Fraud Dataset v1"
            className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={runIngest}
          disabled={readOnly || ingestLoading || datasetPath.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-pink-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          Ingest Dataset
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

      {ingestResponse && (
        <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4">
          <h3 className="text-sm font-semibold text-stone-800">Ingestion Summary</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <SummaryItem label="Status" value={ingestResponse.status} />
            <SummaryItem
              label="Total Rows"
              value={ingestResponse.master_frame_shape[0].toLocaleString()}
            />
            <SummaryItem
              label="Duplicate Invoice IDs"
              value={ingestResponse.report.duplicate_invoice_ids.toLocaleString()}
            />
            <SummaryItem
              label="Orphan Supplier Rows"
              value={ingestResponse.report.orphan_supplier_rows.toLocaleString()}
            />
            <SummaryItem
              label="Orphan Department Rows"
              value={ingestResponse.report.orphan_department_rows.toLocaleString()}
            />
            <SummaryItem
              label="Fraud Rate"
              value={
                ingestResponse.report.fraud_rate === null
                  ? "—"
                  : `${(ingestResponse.report.fraud_rate * 100).toFixed(2)}%`
              }
            />
          </dl>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-700">
              Raw response JSON
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-stone-50 p-3 text-xs text-stone-600">
              {JSON.stringify(ingestResponse, null, 2)}
            </pre>
          </details>
        </div>
      )}
        </>
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
