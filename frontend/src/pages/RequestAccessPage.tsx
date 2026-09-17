/**
 * src/pages/RequestAccessPage.tsx
 * ------------------------------------
 * Route: /request-access (public, no auth required)
 *
 * A prospective business owner asks for platform access —
 * POST /api/v1/tenants/request (app/api/v1/endpoints/tenants.py). This
 * only files the request; an ADMIN still has to review and approve it
 * (AdminProvisioningPage) before real credentials exist. No credentials
 * are issued or shown here.
 */

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import { ApiError, requestTenantAccess } from "../lib/api";

export default function RequestAccessPage() {
  const [companyName, setCompanyName] = useState("");
  const [gstin, setGstin] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedRequestId, setSubmittedRequestId] = useState<number | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await requestTenantAccess({
        company_name: companyName.trim(),
        gstin: gstin.trim().toUpperCase(),
        contact_email: contactEmail.trim(),
      });
      setSubmittedRequestId(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to submit the request right now.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-stone-100/70 p-6 shadow-2xl backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-2.5">
          <ShieldCheck className="h-6 w-6 text-emerald-500" />
          <div>
            <h1 className="text-sm font-semibold text-stone-950">Request Platform Access</h1>
            <p className="text-xs text-stone-500">A ReconTax AI admin will review and provision your account.</p>
          </div>
        </div>

        {submittedRequestId !== null ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-emerald-200/60 bg-emerald-50/40 px-4 py-4 text-sm text-emerald-800">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Request submitted (#{submittedRequestId})
            </div>
            <p className="text-xs text-emerald-700/90">
              An admin will review this request and, once approved, send your username and a
              temporary password to the contact email you provided. You'll sign in and be
              prompted to set a new password.
            </p>
            <Link to="/login" className="text-xs font-medium text-pink-600 hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div>
              <label htmlFor="companyName" className="mb-1 block text-xs font-medium text-stone-600">
                Company name
              </label>
              <input
                id="companyName"
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Apex Logistics Ltd"
                className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400"
              />
            </div>
            <div>
              <label htmlFor="gstin" className="mb-1 block text-xs font-medium text-stone-600">
                GSTIN
              </label>
              <input
                id="gstin"
                type="text"
                required
                minLength={15}
                maxLength={15}
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                placeholder="27AABCA1234F1Z9"
                className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm uppercase text-stone-900 placeholder-stone-400 outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400"
              />
            </div>
            <div>
              <label htmlFor="contactEmail" className="mb-1 block text-xs font-medium text-stone-600">
                Contact email
              </label>
              <input
                id="contactEmail"
                type="email"
                required
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="owner@yourcompany.com"
                className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400"
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
              {submitting ? "Submitting…" : "Submit request"}
            </button>

            <Link to="/login" className="mt-1 text-center text-xs text-stone-500 hover:underline">
              Already have an account? Sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
