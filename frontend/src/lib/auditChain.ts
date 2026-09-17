/**
 * src/lib/auditChain.ts
 * -------------------------
 * Session-local SHA-256 hash-chained audit log, built with the browser's
 * native `crypto.subtle.digest`.
 *
 * WHAT THIS ACTUALLY PROVES: each entry's `payloadHash` covers that
 * entry's own payload, and `prevHash` links it to the previous entry's
 * hash — so re-hashing the chain client-side (AuditPage's "VERIFIED"
 * check) detects if an entry in THIS in-memory array was altered after
 * the fact, within this one browser tab, this one session. It is NOT a
 * server-anchored, tamper-evident ledger: nothing here is persisted,
 * signed, or verifiable by anyone else, and the array lives in ordinary
 * React state that any script in the page (or a page reload) can wipe.
 * Treat it as a demo of the hash-chaining *technique*, not as a real
 * compliance audit trail. A real implementation would append-only write
 * these entries server-side, ideally with the previous entry's hash
 * fetched from the server rather than trusted from client memory.
 */

import type { ChainedAuditEntry } from "../types/audit";
import type { Role } from "../types/auth";

/** Hash of an empty string — the fixed "prevHash" for the first entry in
 * a chain (the "genesis block" fallback the spec asked for). */
export const GENESIS_HASH = "0".repeat(64);

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Appends one new chained entry to `entries` and returns the new array
 * (does not mutate the input). `payload` is hashed as canonical JSON
 * (sorted keys) so the same logical payload always hashes the same way
 * regardless of key insertion order. */
export async function appendChainedAudit(
  entries: ChainedAuditEntry[],
  params: {
    actor: string;
    role: Role;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<ChainedAuditEntry[]> {
  const prevHash = entries.length > 0 ? entries[entries.length - 1].payloadHash : GENESIS_HASH;

  const canonicalPayload = JSON.stringify(params.payload, Object.keys(params.payload).sort());
  const payloadHash = await sha256Hex(`${prevHash}:${canonicalPayload}`);

  const entry: ChainedAuditEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    payloadHash,
    prevHash,
    actor: params.actor,
    role: params.role,
    eventType: params.eventType,
    payload: params.payload,
  };

  return [...entries, entry];
}

/** Re-derives each entry's hash from its own payload + the previous
 * entry's stored hash, and checks it matches what's stored. Returns the
 * id of the first entry that fails (chain broken from there on), or null
 * if the whole chain verifies. */
export async function verifyChain(entries: ChainedAuditEntry[]): Promise<string | null> {
  let expectedPrevHash = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrevHash) return entry.id;
    const canonicalPayload = JSON.stringify(entry.payload, Object.keys(entry.payload).sort());
    const recomputed = await sha256Hex(`${expectedPrevHash}:${canonicalPayload}`);
    if (recomputed !== entry.payloadHash) return entry.id;
    expectedPrevHash = entry.payloadHash;
  }
  return null;
}
