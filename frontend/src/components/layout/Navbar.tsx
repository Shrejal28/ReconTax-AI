/**
 * src/components/layout/Navbar.tsx
 * ------------------------------------
 * Top nav shown once signed in. Full route links, the signed-in user's
 * tenant (their own company for a business login, or "Platform Admin"
 * for the bootstrap ADMIN), a real role badge (read-only — the role
 * comes from the server-verified session, not something the UI can flip),
 * and "Provisioning" gated to role === "ADMIN".
 */

import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, Building2, LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { Role } from "../../types/auth";

const NAV_LINKS: { to: string; label: string }[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/ingestion", label: "Ingestion" },
  { to: "/scoring", label: "Scoring" },
  { to: "/reconciliation", label: "Reconciliation" },
  { to: "/triage", label: "Triage" },
  { to: "/audit", label: "Audit" },
];

const ROLE_BADGE_CLASS: Record<Role, string> = {
  ADMIN: "bg-amber-500/10 text-amber-600 ring-amber-500/30",
  ANALYST: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/30",
  AUDITOR: "bg-stone-500/10 text-stone-700 ring-stone-500/30",
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  if (!user) {
    return (
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-stone-50/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pink-600">
              <ShieldCheck className="h-4.5 w-4.5 text-white" />
            </span>
            <span className="text-base font-bold tracking-tight text-stone-950">ReconTax</span>
          </Link>
          <Link
            to="/login"
            className="ml-auto rounded-full bg-pink-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-pink-500"
          >
            Sign In
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-stone-50/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <Link to="/dashboard" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pink-600">
            <ShieldCheck className="h-4.5 w-4.5 text-white" />
          </span>
          <span className="text-base font-bold tracking-tight text-stone-950">ReconTax</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1 rounded-full bg-stone-100 p-1 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-full px-3 py-1.5 font-medium text-stone-600 hover:bg-white hover:text-stone-900"
            >
              {link.label}
            </Link>
          ))}
          {user.role !== "AUDITOR" && (
            <Link
              to="/tax-planning"
              className="rounded-full px-3 py-1.5 font-medium text-stone-600 hover:bg-white hover:text-stone-900"
            >
              Tax Planning
            </Link>
          )}
          {user.role === "ADMIN" && (
            <Link
              to="/admin/provisioning"
              className="rounded-full px-3 py-1.5 font-medium text-stone-600 hover:bg-white hover:text-stone-900"
            >
              Provisioning
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/30"
            title={user.tenantName ? `Signed in to ${user.tenantName}` : "Platform admin sandbox"}
          >
            <Building2 className="h-3 w-3" />
            {user.tenantName ?? "Platform Admin"}
          </span>

          <span className="text-xs text-stone-500">{user.email}</span>

          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${ROLE_BADGE_CLASS[user.role]}`}
          >
            {user.role}
          </span>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1 rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-200"
          >
            <LogOut className="h-3 w-3" />
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
