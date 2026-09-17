/**
 * src/pages/LandingPage.tsx
 * ----------------------------
 * Route: /
 *
 * Full marketing-style landing page, restyled after a reference site the
 * user shared (playful illustrated fintech aesthetic — bright color
 * blocks, rounded shapes, wavy section dividers). Two things are
 * deliberately NOT copied from that reference, on purpose:
 *   - No fabricated customer testimonials or invented impact numbers
 *     presented as real. The "Live Session Stats" section below only
 *     shows numbers this session's own backend calls actually returned
 *     (via WorkflowContext) — it reads "Not yet run" until you've
 *     actually used the app, rather than making up a number.
 *   - No copied illustrations/logo/copy from the reference brand. The
 *     hero graphic and section dividers below are original, drawn as
 *     inline SVG in the same rounded/flat illustration spirit.
 */

import { Link } from "react-router-dom";
import { ArrowRight, Database, ScanSearch, GitCompareArrows, Sparkles } from "lucide-react";
import Starfield from "../components/background/Starfield";
import { useWorkflow } from "../context/WorkflowContext";

const STEPS = [
  { icon: Database, title: "Ingest", body: "Load and validate the parquet invoice bundle — schema checks, orphan-row detection, dedup, all vectorized." },
  { icon: ScanSearch, title: "Score", body: "A calibrated LightGBM model routes every invoice into Tier 1 / 2 / 3 by fraud probability." },
  { icon: GitCompareArrows, title: "Reconcile", body: "Cross-check every invoice against simulated SFT/GSTR telemetry to surface amount mismatches and missing filings." },
  { icon: Sparkles, title: "Triage", body: "A real LLM call drafts a compliance notice for the highest-exposure anomalies, with a deterministic fallback if it can't reach the model." },
];

export default function LandingPage() {
  const { ingestResponse, scoreResponse, reconcileResponse } = useWorkflow();
  const totalInvoices = ingestResponse?.master_frame_shape[0] ?? reconcileResponse?.summary.total_rows;
  const tier1 = scoreResponse?.risk_tier_counts.TIER_1;
  const rocAuc = scoreResponse?.val_metrics?.roc_auc;

  return (
    <div className="bg-stone-50">
      {/* Announcement bar */}
      <div className="bg-stone-950 px-4 py-2 text-center text-xs text-stone-200">
        Already signed in?{" "}
        <Link to="/dashboard" className="font-semibold text-amber-300 hover:underline">
          Go to your Dashboard
        </Link>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-amber-300 via-amber-200 to-pink-200">
        <Starfield />
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-20 md:grid-cols-2">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-stone-700 backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5 text-pink-600" />
              SFT / GSTR Reconciliation &amp; Fraud Triage
            </div>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-stone-950 sm:text-5xl">
              Stop invoice fraud before it costs you.
            </h1>
            <p className="mt-4 max-w-md text-base text-stone-700">
              ReconTax AI ingests your procurement data, scores every invoice with a calibrated
              model, reconciles it against tax/bank telemetry, and drafts compliance notices for
              the invoices that matter most — running the real pipeline, not a demo.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/login" className="inline-flex items-center gap-2 rounded-full bg-pink-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-600/30 hover:bg-pink-500">
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-full border-2 border-stone-950 bg-white px-6 py-3 text-sm font-semibold text-stone-950 hover:bg-stone-100">
                Explore the Dashboard
              </Link>
            </div>
          </div>
          <HeroIllustration />
        </div>
        <WaveDivider fill="#fafaf9" />
      </section>

      {/* Tagline */}
      <section className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-stone-950 sm:text-3xl">
          Not your typical fraud-detection tool.
        </h2>
        <p className="mt-3 text-stone-600">
          Every number on this site comes from a real API call to a running FastAPI backend — a
          real LightGBM model, real vectorized reconciliation, a real LLM-backed compliance agent.
          Nothing here is a mockup.
        </p>
        <Link to="/login" className="mt-6 inline-flex items-center gap-2 rounded-full bg-stone-950 px-6 py-3 text-sm font-semibold text-white hover:bg-stone-800">
          Try the Pipeline
        </Link>
      </section>

      {/* How it works */}
      <section className="relative bg-pink-100 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold text-stone-950 sm:text-3xl">How it works</h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div key={step.title} className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-300 text-sm font-bold text-stone-950">
                  {i + 1}
                </div>
                <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-pink-700">
                  <step.icon className="h-4 w-4" />
                  {step.title}
                </h3>
                <p className="mt-2 text-sm text-stone-600">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
        <WaveDivider fill="#1c1917" flip />
      </section>

      {/* Mission */}
      <section className="bg-stone-900 px-4 py-16 text-stone-50">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-10 md:flex-row">
          <MissionIllustration />
          <div>
            <h2 className="text-2xl font-bold sm:text-3xl">Our mission</h2>
            <p className="mt-3 max-w-md text-stone-300">
              Compliance teams shouldn&apos;t have to choose between speed and rigor. ReconTax AI
              exists to make invoice-fraud triage fast enough to actually keep up with a real
              procurement pipeline, without cutting corners on the reconciliation math or hiding
              how the risk score was reached.
            </p>
          </div>
        </div>
      </section>

      {/* Live session stats — real numbers only, never fabricated */}
      <section className="relative overflow-hidden bg-gradient-to-br from-amber-300 to-amber-200 py-16">
        <div className="mx-auto max-w-5xl px-4 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-stone-700">Live for this session</p>
          <h2 className="mt-2 text-2xl font-bold text-stone-950 sm:text-3xl">Run the pipeline, see it here.</h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <StatCard label="Invoices Ingested" value={totalInvoices?.toLocaleString()} />
            <StatCard label="Tier 1 Flagged" value={tier1?.toLocaleString()} />
            <StatCard label="Model ROC-AUC" value={rocAuc?.toFixed(3)} />
          </div>
          <Link to="/login" className="mt-10 inline-flex items-center gap-2 rounded-full bg-stone-950 px-6 py-3 text-sm font-semibold text-white hover:bg-stone-800">
            Sign In to Run It
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-stone-950 px-4 py-12 text-stone-400">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pink-600">
              <Sparkles className="h-4 w-4 text-white" />
            </span>
            <span className="text-base font-bold tracking-tight text-white">ReconTax</span>
          </div>
          <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
            <FooterColumn title="Pipeline" links={[{ label: "Ingestion", to: "/ingestion" }, { label: "Scoring", to: "/scoring" }, { label: "Reconciliation", to: "/reconciliation" }]} />
            <FooterColumn title="Compliance" links={[{ label: "Triage", to: "/triage" }, { label: "Audit Ledger", to: "/audit" }]} />
            <FooterColumn title="Account" links={[{ label: "Sign In", to: "/login" }]} />
          </div>
        </div>
        <div className="mx-auto mt-10 max-w-6xl border-t border-stone-800 pt-6 text-xs text-stone-500">
          ReconTax AI — a demo fraud-reconciliation pipeline. Not a real compliance product.
        </div>
      </footer>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-6 backdrop-blur-sm">
      <p className="text-3xl font-extrabold tabular-nums text-stone-950">
        {value ?? <span className="text-stone-400">Not yet run</span>}
      </p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-stone-600">{label}</p>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; to: string }[] }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-pink-400">{title}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {links.map((link) => (
          <li key={link.to}>
            <Link to={link.to} className="hover:text-white">{link.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Original flat-illustration-style wave divider between sections. */
function WaveDivider({ fill, flip }: { fill: string; flip?: boolean }) {
  return (
    <svg viewBox="0 0 1440 80" className={`absolute bottom-0 left-0 w-full ${flip ? "rotate-180" : ""}`} preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,32 C240,80 480,0 720,24 C960,48 1200,88 1440,32 L1440,80 L0,80 Z" fill={fill} />
    </svg>
  );
}

/** Original hero illustration — an invoice being checked off by a shield,
 * drawn flat/geometric in the brand palette. Not a copy of any reference
 * artwork. */
function HeroIllustration() {
  return (
    <svg viewBox="0 0 400 340" className="mx-auto w-full max-w-sm" aria-hidden="true">
      <circle cx="200" cy="170" r="150" fill="#fff" opacity="0.35" />
      <rect x="110" y="60" width="150" height="200" rx="14" fill="#ffffff" stroke="#1c1917" strokeWidth="4" />
      <rect x="130" y="90" width="110" height="10" rx="5" fill="#f472b6" />
      <rect x="130" y="115" width="80" height="8" rx="4" fill="#e7e5e4" />
      <rect x="130" y="135" width="90" height="8" rx="4" fill="#e7e5e4" />
      <rect x="130" y="155" width="60" height="8" rx="4" fill="#e7e5e4" />
      <rect x="130" y="200" width="110" height="10" rx="5" fill="#fbbf24" />
      <path d="M280 140 L330 158 L330 200 C330 232 306 254 280 264 C254 254 230 232 230 200 L230 158 Z" fill="#db2777" stroke="#1c1917" strokeWidth="4" />
      <path d="M260 200 L274 214 L302 182" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="90" cy="70" r="10" fill="#fbbf24" />
      <circle cx="330" cy="260" r="14" fill="#fbbf24" />
      <circle cx="70" cy="260" r="8" fill="#db2777" />
    </svg>
  );
}

/** Original mission-section illustration — a simple balance/scale motif in
 * the brand palette, flat/geometric style. */
function MissionIllustration() {
  return (
    <svg viewBox="0 0 240 200" className="w-48 flex-shrink-0" aria-hidden="true">
      <circle cx="120" cy="100" r="95" fill="#292524" />
      <line x1="120" y1="40" x2="120" y2="150" stroke="#fbbf24" strokeWidth="6" strokeLinecap="round" />
      <line x1="60" y1="70" x2="180" y2="70" stroke="#fbbf24" strokeWidth="6" strokeLinecap="round" />
      <circle cx="60" cy="70" r="22" fill="none" stroke="#f472b6" strokeWidth="6" />
      <circle cx="180" cy="70" r="22" fill="none" stroke="#f472b6" strokeWidth="6" />
      <rect x="95" y="150" width="50" height="12" rx="6" fill="#fbbf24" />
    </svg>
  );
}
