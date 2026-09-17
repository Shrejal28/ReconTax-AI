/**
 * src/pages/AuditPage.tsx
 * ---------------------------
 * Route: /audit (any authenticated role)
 *
 * Table of this session's SHA-256 hash-chained audit events, with a
 * "VERIFIED" badge per entry from actually re-deriving the chain (see
 * lib/auditChain.ts's verifyChain) rather than assuming it's intact.
 * See that module's docstring for the honest scope of what this proves.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Download, ShieldAlert } from "lucide-react";
import { useAudit } from "../context/AuditContext";
import { verifyChain } from "../lib/auditChain";

export default function AuditPage() {
  const { entries } = useAudit();
  const [brokenAtId, setBrokenAtId] = useState<string | null | "checking">("checking");

  useEffect(() => {
    let cancelled = false;
    setBrokenAtId("checking");
    verifyChain(entries).then((result) => {
      if (!cancelled) setBrokenAtId(result);
    });
    return () => {
      cancelled = true;
    };
  }, [entries]);

  function handleExport() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recontax-audit-ledger-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-stone-950">Session Audit Ledger</h2>
          <p className="mt-1 text-xs text-stone-500">
            SHA-256 hash-chained log of provisioning and triage actions taken this session.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={entries.length === 0}
          className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-stone-200 px-3 py-1.5 text-xs font-medium text-stone-900 hover:bg-stone-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          Export Ledger (JSON)
        </button>
      </div>

      <div className="flex items-start gap-2 rounded-2xl border border-amber-200/50 bg-amber-50/20 px-4 py-2.5 text-xs text-amber-700/90">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>
          This ledger is in-memory for the current browser tab only — it resets on reload and is
          never sent to or verified by a server. &quot;VERIFIED&quot; below means the chain is
          internally consistent right now, not that it&apos;s tamper-proof against someone editing
          this page&apos;s memory directly.
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4 text-sm text-stone-500">
          No audit events yet this session. Actions on the Provisioning or Triage pages will appear
          here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-stone-100/60 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Timestamp</th>
                <th className="px-4 py-2.5 font-medium">Actor / Role</th>
                <th className="px-4 py-2.5 font-medium">Event Type</th>
                <th className="px-4 py-2.5 font-medium">Payload Hash</th>
                <th className="px-4 py-2.5 font-medium">Verified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200/60">
              {entries.map((entry) => {
                const brokenHere = brokenAtId !== "checking" && brokenAtId === entry.id;
                return (
                  <tr key={entry.id}>
                    <td className="px-4 py-2.5 text-xs text-stone-600">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-stone-700">
                      {entry.actor} <span className="text-stone-400">·</span> {entry.role}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-stone-700">{entry.eventType}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-stone-500" title={entry.payloadHash}>
                      {entry.payloadHash.slice(0, 16)}…
                    </td>
                    <td className="px-4 py-2.5">
                      {brokenAtId === "checking" ? (
                        <span className="text-[11px] text-stone-400">checking…</span>
                      ) : brokenHere ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 ring-1 ring-inset ring-red-500/30">
                          <XCircle className="h-3 w-3" />
                          BROKEN
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/30">
                          <CheckCircle2 className="h-3 w-3" />
                          VERIFIED
                        </span>
                      )}
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
