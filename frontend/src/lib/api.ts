/**
 * src/lib/api.ts
 * ----------------
 * Fetch wrapper for the ReconTax AI backend. Every type here mirrors a
 * Pydantic model in the FastAPI app field-for-field (app/schemas/*.py) —
 * kept in sync deliberately, the same way the backend's own audit pass
 * checked schema-to-service field alignment. If a field is renamed on
 * the backend, TypeScript will flag every call site that breaks.
 *
 * All requests go to relative "/api/v1/..." paths; the Vite dev server
 * proxies "/api" -> http://localhost:8000 (see vite.config.ts), so this
 * file never hardcodes a host. No mock data or fallback values live
 * here — every exported function makes a real network call, and errors
 * are surfaced as a typed ApiError rather than swallowed.
 */

// ---------------------------------------------------------------------------
// Shared error type
// ---------------------------------------------------------------------------

/** Thrown by every function below on a non-2xx response or a network failure. */
export class ApiError extends Error {
  /** HTTP status code, or 0 for a network-level failure (fetch threw). */
  status: number;
  /** True when the backend refused because required state is missing
   * (POST /ingest hasn't been called yet) — the specific case the UI
   * needs to show its "click Ingest Dataset first" banner for. */
  isMissingStateError: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isMissingStateError = status === 409;
  }
}

/** FastAPI's error body is either {"detail": "some string"} (HTTPException)
 * or {"detail": [{"type","loc","msg",...}, ...]} (pydantic validation error).
 * This extracts a single human-readable string from either shape. */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : JSON.stringify(d)))
        .join("; ");
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Auth token storage — every pipeline/admin endpoint now requires a real
// session (Authorization: Bearer <token>, issued by POST /api/v1/auth/login,
// see app/deps.py). Kept here, not in AuthContext, so every helper below —
// including the multipart OCR calls that bypass request() — attaches it the
// same way. AuthContext owns *when* this gets set/cleared; this module only
// owns *how* it's stored and attached.
// ---------------------------------------------------------------------------

const TOKEN_STORAGE_KEY = "recontax.session_token";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // localStorage unavailable (private browsing, etc.) — the session
    // simply won't survive a reload; not fatal to the current tab.
  }
}

function authHeader(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<TResponse>(path: string, body: unknown): Promise<TResponse> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    // fetch() itself threw: backend unreachable, proxy down, CORS, etc.
    throw new ApiError(
      networkErr instanceof Error ? `Network error: ${networkErr.message}` : "Network error",
      0,
    );
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Non-JSON body (e.g. a raw 500 HTML page) — fall through, `parsed`
    // stays null, extractErrorMessage will use the fallback text.
  }

  if (!res.ok) {
    throw new ApiError(
      extractErrorMessage(parsed, `Request to ${path} failed with status ${res.status}`),
      res.status,
    );
  }

  return parsed as TResponse;
}

async function requestGet<TResponse>(path: string): Promise<TResponse> {
  let res: Response;
  try {
    res = await fetch(path, { method: "GET", headers: { ...authHeader() } });
  } catch (networkErr) {
    throw new ApiError(
      networkErr instanceof Error ? `Network error: ${networkErr.message}` : "Network error",
      0,
    );
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // fall through; extractErrorMessage uses the fallback text below
  }

  if (!res.ok) {
    throw new ApiError(
      extractErrorMessage(parsed, `Request to ${path} failed with status ${res.status}`),
      res.status,
    );
  }

  return parsed as TResponse;
}

// ---------------------------------------------------------------------------
// Auth — POST /api/v1/auth/login, POST /api/v1/auth/logout, GET /api/v1/auth/me
// Real bcrypt-verified login against app/db_models.User, an opaque
// server-side session token — mirrors app/schemas/auth.py field-for-field.
// ---------------------------------------------------------------------------

export type UserRole = "ADMIN" | "ANALYST" | "AUDITOR";

export interface AuthUserOut {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  tenant_id: number | null;
  tenant_name: string | null;
  must_change_password: boolean;
}

export interface LoginResponse {
  token: string;
  user: AuthUserOut;
}

export function requestLogin(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/api/v1/auth/login", { username, password });
}

export async function requestLogout(): Promise<void> {
  await request<{ status: string }>("/api/v1/auth/logout", {});
}

export function fetchCurrentUser(): Promise<AuthUserOut> {
  return requestGet<AuthUserOut>("/api/v1/auth/me");
}

// ---------------------------------------------------------------------------
// Tenant provisioning — POST /api/v1/tenants/request (public),
// GET/POST /api/v1/admin/tenants/requests[/...]  (ADMIN only)
// Mirrors app/schemas/auth.py's TenantAccessRequestIn/Out and
// ApproveTenantResponse. See app/api/v1/endpoints/tenants.py's module
// docstring: this is the real version of what AdminProvisioningPage used
// to fake client-side with crypto.randomUUID().
// ---------------------------------------------------------------------------

export interface TenantAccessRequestIn {
  company_name: string;
  gstin: string;
  contact_email: string;
}

export type TenantRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface TenantAccessRequestOut {
  id: number;
  company_name: string;
  gstin: string;
  contact_email: string;
  status: TenantRequestStatus;
  created_at: string;
  resolved_tenant_id: number | null;
}

export interface ApproveTenantResponse {
  tenant_id: number;
  company_name: string;
  username: string;
  /** Shown exactly once, at approval time — never recoverable afterward. */
  temporary_password: string;
}

export function requestTenantAccess(req: TenantAccessRequestIn): Promise<TenantAccessRequestOut> {
  return request<TenantAccessRequestOut>("/api/v1/tenants/request", req);
}

export function listTenantRequests(): Promise<TenantAccessRequestOut[]> {
  return requestGet<TenantAccessRequestOut[]>("/api/v1/admin/tenants/requests");
}

export function approveTenantRequest(requestId: number): Promise<ApproveTenantResponse> {
  return request<ApproveTenantResponse>(`/api/v1/admin/tenants/requests/${requestId}/approve`, {});
}

export function rejectTenantRequest(requestId: number): Promise<TenantAccessRequestOut> {
  return request<TenantAccessRequestOut>(`/api/v1/admin/tenants/requests/${requestId}/reject`, {});
}

// ---------------------------------------------------------------------------
// POST /api/v1/ingest — mirrors app/schemas/ingestion.py
// ---------------------------------------------------------------------------

export interface IngestRequest {
  dataset_path: string;
  strict?: boolean;
}

export interface SplitCounts {
  train: number;
  val: number;
  test: number;
}

export interface IngestionReport {
  row_counts: Record<string, number>;
  orphan_supplier_rows: number;
  orphan_department_rows: number;
  missing_label_rows: number;
  missing_behavioural_rows: number;
  missing_split_rows: number;
  duplicate_invoice_ids: number;
  fraud_rate: number | null;
  split_counts: SplitCounts;
}

export interface IngestResponse {
  status: "ok" | "ok_with_warnings";
  master_frame_shape: [number, number];
  report: IngestionReport;
}

export function ingestDataset(req: IngestRequest): Promise<IngestResponse> {
  return request<IngestResponse>("/api/v1/ingest", req);
}

// ---------------------------------------------------------------------------
// POST /api/v1/score — mirrors app/schemas/scoring.py
// ---------------------------------------------------------------------------

export interface ScoreRequest {
  retrain?: boolean;
  tier1_threshold?: number;
  tier2_threshold?: number;
}

export interface SplitMetrics {
  split_name: string;
  n_rows: number;
  fraud_rate: number;
  roc_auc: number;
  average_precision: number;
  tier1_threshold: number;
  precision_at_tier1: number;
  recall_at_tier1: number;
  n_flagged_tier1: number;
}

export interface RiskTierCounts {
  TIER_1: number;
  TIER_2: number;
  TIER_3: number;
}

export interface ScoreResponse {
  status: "ok";
  model_retrained: boolean;
  n_scored: number;
  risk_tier_counts: RiskTierCounts;
  val_metrics: SplitMetrics | null;
  test_metrics: SplitMetrics | null;
}

export function scoreDataset(req: ScoreRequest = {}): Promise<ScoreResponse> {
  return request<ScoreResponse>("/api/v1/score", req);
}

// ---------------------------------------------------------------------------
// POST /api/v1/reconcile — mirrors app/schemas/reconciliation.py
// ---------------------------------------------------------------------------

export type ReconciliationStatus = "MATCHED" | "AMOUNT_MISMATCH" | "MISSING_SFT" | "MISSING_GSTR";

export interface ReconcileRequest {
  dataset_path?: string | null;
  seed?: number;
  missing_sft_rate?: number;
  missing_gstr_rate?: number;
  mismatch_rate?: number;
  top_n_anomalies?: number;
}

export interface ReconciliationStatusBreakdown {
  count: number;
  pct_of_rows: number;
  invoice_amount_sum: number;
  telemetry_delta_gap_sum: number;
}

export interface ReconciliationSummary {
  total_rows: number;
  total_invoice_amount: number;
  total_telemetry_delta_gap: number;
  by_status: Record<ReconciliationStatus, ReconciliationStatusBreakdown>;
}

export interface AnomalousRecord {
  invoice_id: string;
  supplier_id: string;
  invoice_amount: number;
  reconciliation_status: ReconciliationStatus;
  telemetry_delta_gap: number;
}

export interface ReconcileResponse {
  status: "ok";
  source: string;
  reconciled_frame_shape: [number, number];
  seed: number;
  summary: ReconciliationSummary;
  anomalous_records: AnomalousRecord[];
}

export function reconcileDataset(req: ReconcileRequest = {}): Promise<ReconcileResponse> {
  return request<ReconcileResponse>("/api/v1/reconcile", req);
}

// ---------------------------------------------------------------------------
// POST /api/v1/triage/notice — mirrors app/schemas/triage.py
//
// Phase 4: this endpoint calls a real LLM (OpenRouter — see
// app/services/agent.py) to draft the notice, falling back to a
// deterministic template only if the live call fails (missing API key,
// network error, unparseable model response). `generated_by` on the
// response tells you which one actually answered: an OpenRouter model
// slug like "google/gemini-2.0-flash-thinking-exp" (contains a "/"), or
// literally "template_fallback". `severity_overridden` is true only when
// the model proposed a different severity than the deterministic
// reconciliation_status→severity mapping — the deterministic value is
// always what's in `severity`; this flag is just audit visibility into a
// disagreement (always false on a template_fallback response).
// ---------------------------------------------------------------------------

export interface TriageNoticeRequest {
  invoice_id: string;
  supplier_id: string;
  invoice_amount: number;
  reconciliation_status: Exclude<ReconciliationStatus, "MATCHED">;
  telemetry_delta_gap: number;
}

export interface TriageNoticeResponse {
  invoice_id: string;
  severity: "HIGH" | "MEDIUM";
  notice_text: string;
  recommended_action: string;
  generated_by: string;
  severity_overridden: boolean;
}

export function requestTriageNotice(req: TriageNoticeRequest): Promise<TriageNoticeResponse> {
  return request<TriageNoticeResponse>("/api/v1/triage/notice", req);
}

// ---------------------------------------------------------------------------
// Tax planning — POST /api/v1/tax-planning/simulate
// ---------------------------------------------------------------------------
// Stateless, deterministic regime-comparison scenario calculator (no
// LLM call, no app.state dependency — see app/schemas/tax_planning.py's
// module docstring for what STANDARD vs CONCESSIONAL represent and why
// the rates are illustrative, not sourced from live tax law). The same
// request body always returns the same response.
// ---------------------------------------------------------------------------

export interface TaxScenarioRequest {
  projected_ebitda: number;
  planned_capex?: number;
  section_80_deductions?: number;
}

export type TaxRegimeName = "STANDARD" | "CONCESSIONAL";

export interface RegimeResult {
  regime: TaxRegimeName;
  effective_rate: number;
  taxable_income: number;
  allows_deductions: boolean;
  tax_payable: number;
}

export type TaxRecommendation =
  | "RECOMMEND_CONCESSIONAL_REGIME"
  | "RECOMMEND_STANDARD_REGIME"
  | "HUMAN_REVIEW_RECOMMENDED";

export interface TaxScenarioResponse {
  standard: RegimeResult;
  concessional: RegimeResult;
  savings_vs_standard: number;
  recommendation: TaxRecommendation;
  disclaimer: string;
}

export function requestTaxScenario(req: TaxScenarioRequest): Promise<TaxScenarioResponse> {
  return request<TaxScenarioResponse>("/api/v1/tax-planning/simulate", req);
}

// ---------------------------------------------------------------------------
// OCR staging — POST /api/v1/ocr/parse, POST /api/v1/ocr/commit
// ---------------------------------------------------------------------------
// /ocr/parse takes a real file upload (multipart/form-data), so it can't
// go through the JSON-only request() helper above — this uses fetch()
// directly with a FormData body. See app/services/ocr_engine.py's module
// docstring: extraction runs real Tesseract OCR, and every confidence
// number below is a genuine measurement, never fabricated.
// ---------------------------------------------------------------------------

export type OcrFieldName = "gstin" | "cgst" | "sgst" | "igst" | "invoice_total";

export interface OcrFieldOut {
  field_name: OcrFieldName;
  value: string;
  confidence: number; // 0-100, real Tesseract mean word confidence
  source_text: string;
  low_confidence: boolean; // true when confidence < 85
}

export interface OcrParseResponse {
  filename: string;
  page_count: number;
  file_hash: string;
  fields: OcrFieldOut[];
  low_confidence_field_count: number;
  raw_text_preview: string;
}

export async function requestOcrParse(file: File): Promise<OcrParseResponse> {
  const formData = new FormData();
  formData.append("file", file);

  let res: Response;
  try {
    res = await fetch("/api/v1/ocr/parse", { method: "POST", headers: { ...authHeader() }, body: formData });
  } catch (networkErr) {
    throw new ApiError(
      networkErr instanceof Error ? `Network error: ${networkErr.message}` : "Network error",
      0,
    );
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // fall through; extractErrorMessage uses the fallback text below
  }

  if (!res.ok) {
    throw new ApiError(extractErrorMessage(parsed, `OCR parse failed with status ${res.status}`), res.status);
  }
  return parsed as OcrParseResponse;
}

export interface OcrCommitFieldIn {
  field_name: OcrFieldName;
  value: string;
  confidence: number;
}

export interface OcrCommitRequest {
  filename: string;
  file_hash: string;
  fields: OcrCommitFieldIn[];
  low_confidence_overridden: boolean;
}

export interface OcrCommitResponse {
  id: number;
  status: "committed";
  filename: string;
  file_hash: string;
  supplier_gstin: string | null;
  low_confidence_overridden: boolean;
}

export function requestOcrCommit(req: OcrCommitRequest): Promise<OcrCommitResponse> {
  return request<OcrCommitResponse>("/api/v1/ocr/commit", req);
}
