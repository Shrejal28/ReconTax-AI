/**
 * src/components/ProtectedRoute.tsx
 * ------------------------------------
 * Client-side route gate driven by AuthContext. The UI-level convenience
 * (hiding nav links, redirecting away) mirrors what the backend already
 * enforces on every pipeline/admin route (app/deps.py) — this exists so
 * an unauthenticated visitor sees a login screen instead of a broken
 * page, not as the actual security boundary; that's the 401/403 on the
 * API itself.
 */

import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types/auth";

interface ProtectedRouteProps {
  children: ReactNode;
  /** If set, the signed-in user's role must be in this set (a single
   * Role, or an array for "any of these"), or they're redirected to "/"
   * with an unauthorized state instead of the page. */
  requireRole?: Role | Role[];
}

export default function ProtectedRoute({ children, requireRole }: ProtectedRouteProps) {
  const { user, initializing } = useAuth();

  if (initializing) {
    // Restoring a session from a stored token (GET /me) — avoid a flash
    // redirect to /login before we know whether one exists.
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-stone-400">
        Loading…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (requireRole) {
    const allowed = Array.isArray(requireRole) ? requireRole : [requireRole];
    if (!allowed.includes(user.role)) {
      return <Navigate to="/" replace />;
    }
  }
  return <>{children}</>;
}
