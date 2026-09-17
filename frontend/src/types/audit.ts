/**
 * src/types/audit.ts
 * ---------------------
 * See lib/auditChain.ts's module docstring: this is a session-local,
 * in-memory hash chain for UI demo purposes. It proves internal
 * consistency of what happened in THIS browser tab this session, not
 * tamper-evidence against a server-side record — there is no server
 * persisting or verifying these entries.
 */

import type { Role } from "./auth";

export interface ChainedAuditEntry {
  id: string;
  timestamp: string; // ISO 8601
  payloadHash: string; // hex SHA-256 of `payload`
  prevHash: string; // hex SHA-256 of the previous entry, or the genesis hash
  actor: string; // actor's email
  role: Role;
  eventType: string;
  payload: Record<string, unknown>;
}
