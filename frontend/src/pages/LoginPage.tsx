/**
 * src/pages/LoginPage.tsx
 * --------------------------
 * Route: /login
 *
 * Real sign-in against POST /api/v1/auth/login — see AuthContext.tsx.
 * There's no demo/quick-fill shortcut here: the one seeded account is the
 * platform ADMIN (app/services/bootstrap.py), and every business account
 * after that is created for real via the request-access -> admin-approve
 * flow (RequestAccessPage / AdminProvisioningPage), so a hardcoded
 * client-side credential would just be misleading now.
 */

import { useState, type FormEvent } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { ShieldCheck, AlertTriangle, Building2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const result = await login(username, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    navigate(redirectTo, { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-stone-100/70 p-6 shadow-2xl backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-2.5">
          <ShieldCheck className="h-6 w-6 text-emerald-500" />
          <div>
            <h1 className="text-sm font-semibold text-stone-950">ReconTax AI</h1>
            <p className="text-xs text-stone-500">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="username" className="mb-1 block text-xs font-medium text-stone-600">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your.company.owner1234"
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400"
              autoComplete="username"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-stone-600">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-100/50 bg-red-50/40 px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 w-full rounded-xl bg-pink-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-5 rounded-2xl border border-stone-200/70 bg-white/50 p-3 text-[11px] leading-relaxed text-stone-500">
          <p>
            New business?{" "}
            <Link to="/request-access" className="font-medium text-pink-600 hover:underline">
              Request platform access
            </Link>{" "}
            — an admin reviews the request and issues you a username and temporary password.
          </p>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-dashed border-amber-200/60 bg-amber-50/20 p-3 text-[11px] leading-relaxed text-amber-700/90">
          <Building2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Platform admin: sign in with the bootstrap ADMIN account your operator configured (see
            deployment notes) to review and approve access requests.
          </span>
        </div>
      </div>
    </div>
  );
}
