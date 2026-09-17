/**
 * src/pages/AdminProvisioningPage.tsx
 * ---------------------------------------
 * Route: /admin/provisioning (role-gated to ADMIN via ProtectedRoute, and
 * to ADMIN again server-side by every endpoint here — app/deps.py's
 * get_current_admin)
 *
 * Real business tenant requests (GET /api/v1/admin/tenants/requests) with
 * Approve/Reject actions (POST .../approve, .../reject —
 * app/api/v1/endpoints/tenants.py). Approving creates a real Tenant + a
 * bcrypt-hashed User row and returns a one-time plaintext temporary
 * password — shown here exactly once, with a "copy it now" warning,
 * because the backend never stores or returns it again. Also logs an
 * APPROVE_AND_PROVISION event to the session's SHA-256 hash-chained audit
 * log (AuditContext / lib/auditChain.ts) — see AuditPage for the ledger.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, KeyRound, ScrollText, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useAudit } from "../context/AuditContext";
import {
  ApiError,
  approveTenantRequest,
  listTenantRequests,
  rejectTenantRequest,
  type ApproveTenantResponse,
  type TenantAccessRequestOut,
} from "../lib/api";

export default function AdminProvisioningPage() {
  const { user } = useAuth();
  const { logEvent } = useAudit();

  const [requests, setRequests] = useState<TenantAccessRequestOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<number | null>(null);
  const [issuedById, setIssuedById] = useState<Record<number, ApproveTenantResponse>>({});

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listTenantRequests();
      setRequests(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load access requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function handleApprove(req: TenantAccessRequestOut) {
    if (!user) return;
    setActingOnId(req.id);
    setError(null);
    try {
      const issued = await approveTenantRequest(req.id);
      setIssuedById((prev) => ({ ...prev, [req.id]: issued }));
      await loadRequests();

      await logEvent({
        actor: user.email,
        role: user.role,
        eventType: "APPROVE_AND_PROVISION",
        payload: {
          requestId: req.id,
          companyName: req.company_name,
          gstin: req.gstin,
          issuedUsername: issued.username,
          issuedTenantId: issued.tenant_id,
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to approve this request.");
    } finally {
      setActingOnId(null);
    }
  }

  async function handleReject(req: TenantAccessRequestOut) {
    if (!user) return;
    setActingOnId(req.id);
    setError(null);
    try {
      await rejectTenantRequest(req.id);
      await loadRequests();
      await logEvent({
        actor: user.email,
        role: user.role,
        eventType: "APPROVE_AND_PROVISION",
        payload: { requestId: req.id, companyName: req.company_name, action: "REJECTED" },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to reject this request.");
    } finally {
      setActingOnId(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <div>
        <h2 className="text-base font-semibold text-stone-950">Business Tenant Provisioning</h2>
        <p className="mt-1 text-xs text-stone-500">
          Review incoming business owner requests and provision real, per-tenant accounts.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-200/50 bg-amber-50/20 px-4 py-2.5 text-xs text-amber-700/90">
        Approving issues a real bcrypt-hashed login and a one-time temporary password. Copy it
        immediately — the backend never stores or shows the plaintext again; relay it to the
        business owner out-of-band.
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-100/60 bg-red-50/40 px-3 py-2.5 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-stone-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading requests…
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-stone-100/40 px-4 py-6 text-center text-sm text-stone-500">
          No access requests yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-100/60 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">GSTIN</th>
                <th className="px-4 py-2.5 font-medium">Contact</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Issued Credentials</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {requests.map((req) => {
                const issued = issuedById[req.id];
                const busy = actingOnId === req.id;
                return (
                  <tr key={req.id} className="text-stone-800">
                    <td className="px-4 py-3 font-medium">{req.company_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-600">{req.gstin}</td>
                    <td className="px-4 py-3 text-xs text-stone-600">{req.contact_email}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {issued ? (
                        <div className="flex flex-col gap-0.5 font-mono text-stone-600">
                          <span>{issued.username}</span>
                          <span className="text-amber-600">{issued.temporary_password}</span>
                          <span className="text-[10px] text-stone-400">shown once — copy now</span>
                        </div>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {req.status === "PENDING" ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleApprove(req)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300/60 bg-emerald-100/20 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100/40 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                            Approve &amp; Provision
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleReject(req)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <XCircle className="h-3 w-3" />
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Link
        to="/audit"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-pink-600 hover:underline"
      >
        <ScrollText className="h-3.5 w-3.5" />
        View full chained audit ledger
      </Link>
    </div>
  );
}

function StatusBadge({ status }: { status: TenantAccessRequestOut["status"] }) {
  if (status === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 ring-1 ring-inset ring-amber-500/30">
        <Clock className="h-3 w-3" />
        PENDING
      </span>
    );
  }
  if (status === "APPROVED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/30">
        <CheckCircle2 className="h-3 w-3" />
        APPROVED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-stone-500/10 px-2 py-0.5 text-[11px] font-medium text-stone-600 ring-1 ring-inset ring-stone-500/30">
      <XCircle className="h-3 w-3" />
      REJECTED
    </span>
  );
}
