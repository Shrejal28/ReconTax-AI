/**
 * src/components/OcrStagingGrid.tsx
 * ---------------------------------------
 * Ingestion page, Tab 2: Smart OCR Staging Grid.
 *
 * Drop a vendor PDF/image -> real POST /api/v1/ocr/parse (actual
 * Tesseract OCR, no mocked output — see app/services/ocr_engine.py) ->
 * editable line-item review table -> POST /api/v1/ocr/commit.
 *
 * Confidence guard: any field below 85% renders with an amber warning
 * and blocks the "Commit to Staging Ledger" button until the reviewer
 * explicitly checks "I reviewed the low-confidence fields" — the
 * backend enforces the same gate server-side (409 without the override
 * flag), so this can't be bypassed by calling the API directly.
 *
 * Scope note, stated plainly in the UI too: a committed record is
 * persisted to its own OcrStagingCommit table, NOT merged into the
 * fraud-scoring pipeline's master_frame — a scanned invoice can't supply
 * the full behavioural/label feature set the model was trained on.
 */

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileWarning, Loader2, UploadCloud } from "lucide-react";
import {
  ApiError,
  requestOcrCommit,
  requestOcrParse,
  type OcrFieldName,
  type OcrFieldOut,
} from "../lib/api";
import { useAudit } from "../context/AuditContext";
import { useAuth } from "../context/AuthContext";

const FIELD_LABELS: Record<OcrFieldName, string> = {
  gstin: "Supplier GSTIN",
  cgst: "CGST",
  sgst: "SGST",
  igst: "IGST",
  invoice_total: "Invoice Total",
};

const LOW_CONFIDENCE_THRESHOLD = 85;

export default function OcrStagingGrid() {
  const { user } = useAuth();
  const { logEvent } = useAudit();
  const readOnly = user?.role === "AUDITOR";

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filename, setFilename] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [fields, setFields] = useState<OcrFieldOut[]>([]);
  const [overrideChecked, setOverrideChecked] = useState(false);

  const [committing, setCommitting] = useState(false);
  const [committedId, setCommittedId] = useState<number | null>(null);

  const hasLowConfidence = fields.some((f) => f.confidence < LOW_CONFIDENCE_THRESHOLD);
  const canCommit = fields.length > 0 && (!hasLowConfidence || overrideChecked);

  async function handleFile(file: File) {
    setParsing(true);
    setError(null);
    setCommittedId(null);
    setOverrideChecked(false);
    try {
      const res = await requestOcrParse(file);
      setFilename(res.filename);
      setFileHash(res.file_hash);
      setFields(res.fields);
      if (res.fields.length === 0) {
        setError(
          "OCR ran successfully but found none of the expected fields (GSTIN, CGST, SGST, IGST, Total) — try a clearer scan or a different page.",
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unexpected error parsing the document.");
      setFields([]);
      setFilename(null);
      setFileHash(null);
    } finally {
      setParsing(false);
    }
  }

  function handleFieldValueChange(fieldName: OcrFieldName, value: string) {
    setFields((prev) => prev.map((f) => (f.field_name === fieldName ? { ...f, value } : f)));
  }

  async function handleCommit() {
    if (!filename || !fileHash || fields.length === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await requestOcrCommit({
        filename,
        file_hash: fileHash,
        fields: fields.map((f) => ({ field_name: f.field_name, value: f.value, confidence: f.confidence })),
        low_confidence_overridden: overrideChecked,
      });
      setCommittedId(res.id);

      const supplierGstin = fields.find((f) => f.field_name === "gstin")?.value ?? null;
      await logEvent({
        actor: user?.email ?? "unknown",
        role: user?.role ?? "ANALYST",
        eventType: "OCR_STAGING_COMMIT",
        payload: {
          commit_id: res.id,
          filename,
          file_hash: fileHash,
          supplier_gstin: supplierGstin,
          low_confidence_overridden: overrideChecked,
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unexpected error committing the record.");
    } finally {
      setCommitting(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (readOnly) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="flex flex-col gap-6">
      {readOnly && (
        <div className="rounded-2xl border border-stone-300/60 bg-stone-100/40 px-4 py-2.5 text-xs text-stone-600">
          AUDITOR role is read-only — OCR staging is disabled.
        </div>
      )}

      <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-bold text-stone-950">Smart OCR Staging Grid</h3>
        <p className="mt-1 text-xs text-stone-500">
          Drop a vendor invoice (PDF or image) to run real OCR extraction — GSTIN, CGST/SGST/IGST,
          and invoice total, each with a genuine confidence score from the OCR engine.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!readOnly) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => !readOnly && fileInputRef.current?.click()}
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            readOnly
              ? "cursor-not-allowed border-stone-200 bg-stone-50/40 opacity-50"
              : dragActive
                ? "border-pink-400 bg-pink-50/50"
                : "border-pink-300 bg-pink-50/20 hover:bg-pink-50/40"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="hidden"
            disabled={readOnly}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          {parsing ? (
            <Loader2 className="h-7 w-7 animate-spin text-pink-500" />
          ) : (
            <UploadCloud className="h-7 w-7 text-pink-500" />
          )}
          <p className="text-sm font-medium text-stone-700">
            {parsing ? "Running OCR…" : "Drop a PDF or image here, or click to choose a file"}
          </p>
          <p className="text-xs text-stone-400">PNG, JPEG, or PDF — parsed by a real Tesseract OCR call</p>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100/60 bg-red-50/40 px-3 py-2.5 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {fields.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wide text-pink-700">
                Extracted Line Items — {filename}
              </h4>
              <span className="text-[11px] text-stone-400">
                file hash: <code className="text-stone-500">{fileHash?.slice(0, 16)}…</code>
              </span>
            </div>

            <div className="overflow-hidden rounded-xl border border-stone-200">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Value (editable)</th>
                    <th className="px-3 py-2">Confidence</th>
                    <th className="px-3 py-2">Source OCR Line</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {fields.map((f) => (
                    <tr key={f.field_name}>
                      <td className="px-3 py-2.5 font-medium text-stone-800">{FIELD_LABELS[f.field_name]}</td>
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={f.value}
                          disabled={readOnly}
                          onChange={(e) => handleFieldValueChange(f.field_name, e.target.value)}
                          className="w-40 rounded-lg border border-stone-300 bg-stone-50 px-2 py-1 text-sm text-stone-900 outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400 disabled:opacity-50"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        {f.confidence < LOW_CONFIDENCE_THRESHOLD ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                            <FileWarning className="h-3 w-3" />
                            {f.confidence.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            {f.confidence.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="max-w-xs truncate px-3 py-2.5 font-mono text-[11px] text-stone-500" title={f.source_text}>
                        {f.source_text}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasLowConfidence && (
              <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200/60 bg-amber-50/40 px-3 py-2.5 text-xs text-amber-800">
                <input
                  type="checkbox"
                  checked={overrideChecked}
                  disabled={readOnly}
                  onChange={(e) => setOverrideChecked(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  One or more fields are below {LOW_CONFIDENCE_THRESHOLD}% confidence. I&apos;ve reviewed
                  the values above and confirm they&apos;re correct before committing.
                </span>
              </label>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleCommit}
                disabled={readOnly || !canCommit || committing}
                className="inline-flex items-center gap-2 rounded-full bg-pink-600 px-5 py-2 text-sm font-semibold text-white hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {committing && <Loader2 className="h-4 w-4 animate-spin" />}
                Commit to Staging Ledger
              </button>
              {committedId !== null && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Committed as record #{committedId}
                </span>
              )}
            </div>

            <p className="mt-3 text-[11px] text-stone-400">
              Committing saves this record to its own OCR staging ledger and logs an
              OCR_STAGING_COMMIT audit event with the file hash and supplier GSTIN — it does not
              feed into the fraud-scoring pipeline, since a scanned invoice can&apos;t supply the
              full feature set the model was trained on.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
