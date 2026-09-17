/**
 * src/context/AuditContext.tsx
 * --------------------------------
 * Session-local chained audit log shared across AuditPage and any page
 * that logs an action (AdminProvisioningPage, TriagePage's Hold/Approve).
 * See lib/auditChain.ts's module docstring for exactly what this does
 * and does not guarantee.
 */

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { appendChainedAudit } from "../lib/auditChain";
import type { ChainedAuditEntry } from "../types/audit";
import type { Role } from "../types/auth";

interface AuditContextValue {
  entries: ChainedAuditEntry[];
  logEvent: (params: {
    actor: string;
    role: Role;
    eventType: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
}

const AuditContext = createContext<AuditContextValue | null>(null);

export function AuditProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ChainedAuditEntry[]>([]);
  // A ref mirrors `entries` so concurrent logEvent() calls chain off the
  // latest hash synchronously, rather than off a possibly-stale closure
  // over React state (state updates are async/batched).
  const entriesRef = useRef<ChainedAuditEntry[]>([]);

  async function logEvent(params: {
    actor: string;
    role: Role;
    eventType: string;
    payload: Record<string, unknown>;
  }) {
    const next = await appendChainedAudit(entriesRef.current, params);
    entriesRef.current = next;
    setEntries(next);
  }

  return <AuditContext.Provider value={{ entries, logEvent }}>{children}</AuditContext.Provider>;
}

export function useAudit(): AuditContextValue {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error("useAudit must be used within an AuditProvider");
  return ctx;
}
