/**
 * src/types/auth.ts
 * --------------------
 * See context/AuthContext.tsx's module docstring for the trust-boundary
 * caveat: this app has no backend auth, so "role" here is a client-side
 * UI convenience only, never a real authorization boundary.
 */

export type Role = "ADMIN" | "ANALYST" | "AUDITOR";

export const ALL_ROLES: Role[] = ["ADMIN", "ANALYST", "AUDITOR"];
