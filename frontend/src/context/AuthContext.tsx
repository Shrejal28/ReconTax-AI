/**
 * src/context/AuthContext.tsx
 * ------------------------------
 * Real auth. Signs in against POST /api/v1/auth/login (bcrypt-verified,
 * server-side session — see app/api/v1/endpoints/auth.py), persists the
 * opaque session token to localStorage so a page reload doesn't sign the
 * user out, and restores the session on load via GET /api/v1/auth/me.
 *
 * The role reported here now comes from the database row the backend
 * checked to issue the token — it is enforced server-side on every
 * pipeline/admin route (app/deps.py's get_current_user/get_current_admin),
 * not just hidden in the UI. There is no client-side role switcher: that
 * would let anyone flip their own permissions in devtools, which defeats
 * the point of a real auth boundary.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  fetchCurrentUser,
  requestLogin,
  requestLogout,
  setAuthToken,
  getAuthToken,
  type AuthUserOut,
  type UserRole,
} from "../lib/api";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  tenantId: number | null;
  tenantName: string | null;
  mustChangePassword: boolean;
}

function toAuthUser(u: AuthUserOut): AuthUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    tenantId: u.tenant_id,
    tenantName: u.tenant_name,
    mustChangePassword: u.must_change_password,
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True while the initial session-restore (GET /me using a stored
   * token) is in flight — callers that redirect unauthenticated users
   * (ProtectedRoute) should wait for this before deciding. */
  initializing: boolean;
  login: (username: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!getAuthToken()) {
        setInitializing(false);
        return;
      }
      try {
        const me = await fetchCurrentUser();
        if (!cancelled) setUser(toAuthUser(me));
      } catch {
        // Stored token is missing/expired/invalid — clear it and fall
        // back to signed-out rather than retrying forever.
        setAuthToken(null);
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = username.trim();
    if (!trimmed || !password) {
      return { ok: false, error: "Username and password are required." };
    }
    try {
      const res = await requestLogin(trimmed, password);
      setAuthToken(res.token);
      setUser(toAuthUser(res.user));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof ApiError ? err.message : "Unable to sign in right now." };
    }
  }

  function logout() {
    // Fire-and-forget: invalidate the session server-side too (instant
    // revocation), but don't block the UI on it — the local sign-out is
    // what the user is waiting on.
    void requestLogout().catch(() => {});
    setAuthToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, initializing, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
