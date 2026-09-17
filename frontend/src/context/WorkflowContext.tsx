/**
 * src/context/WorkflowContext.tsx
 * -----------------------------------
 * Lifts the ingest/score/reconcile pipeline state that used to live in a
 * single App.tsx component up into a context, now that Ingestion,
 * Scoring, Reconciliation, Dashboard, and Triage are separate routes —
 * without this, navigating between pages would lose whatever you'd
 * already run. All three actions make real calls to the FastAPI backend
 * (see lib/api.ts) — nothing here is mocked.
 *
 * PERSISTENCE: datasetPath/seed/ingestResponse/scoreResponse/
 * reconcileResponse are mirrored to localStorage and rehydrated on
 * mount, so a browser refresh doesn't blank the dashboard back to
 * empty. This is a per-viewer display cache only — it does NOT re-run
 * anything against the backend. If the FastAPI process itself has
 * restarted (its in-memory app.state.master_frame/model are gone),
 * clicking Score or Reconcile again will still correctly 409 until you
 * Ingest again; the cached numbers just mean the page doesn't look
 * empty while you decide what to do next.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  ingestDataset,
  scoreDataset,
  reconcileDataset,
  type IngestResponse,
  type ReconcileResponse,
  type ScoreResponse,
} from "../lib/api";

export interface BannerState {
  message: string;
  /** True for a 409 "no ingested dataset" response — callers show the
   * "click Ingest Dataset first" prompt instead of a generic error. */
  isMissingState: boolean;
}

interface WorkflowContextValue {
  datasetPath: string;
  setDatasetPath: (value: string) => void;
  seed: number;
  setSeed: (value: number) => void;

  ingestLoading: boolean;
  scoreLoading: boolean;
  reconcileLoading: boolean;

  ingestResponse: IngestResponse | null;
  scoreResponse: ScoreResponse | null;
  reconcileResponse: ReconcileResponse | null;

  banner: BannerState | null;
  clearBanner: () => void;

  runIngest: () => Promise<void>;
  runScore: () => Promise<void>;
  runReconcile: () => Promise<void>;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

const STORAGE_KEY = "recontax:workflow:v1";

interface PersistedShape {
  datasetPath: string;
  seed: number;
  ingestResponse: IngestResponse | null;
  scoreResponse: ScoreResponse | null;
  reconcileResponse: ReconcileResponse | null;
}

function loadPersisted(): PersistedShape | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedShape;
  } catch {
    // Private-browsing mode, corrupted value, storage disabled, etc. —
    // just fall back to a fresh, empty session rather than throwing.
    return null;
  }
}

export function WorkflowProvider({ children }: { children: ReactNode }) {
  const persisted = loadPersisted();

  const [datasetPath, setDatasetPath] = useState(persisted?.datasetPath ?? "");
  const [seed, setSeed] = useState(persisted?.seed ?? 42);

  const [ingestLoading, setIngestLoading] = useState(false);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [reconcileLoading, setReconcileLoading] = useState(false);

  const [ingestResponse, setIngestResponse] = useState<IngestResponse | null>(
    persisted?.ingestResponse ?? null,
  );
  const [scoreResponse, setScoreResponse] = useState<ScoreResponse | null>(
    persisted?.scoreResponse ?? null,
  );
  const [reconcileResponse, setReconcileResponse] = useState<ReconcileResponse | null>(
    persisted?.reconcileResponse ?? null,
  );

  const [banner, setBanner] = useState<BannerState | null>(null);

  // Persist on every relevant change. Best-effort — storage quota errors
  // or a disabled localStorage should never crash the app.
  useEffect(() => {
    try {
      const toStore: PersistedShape = {
        datasetPath,
        seed,
        ingestResponse,
        scoreResponse,
        reconcileResponse,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // ignore — see module docstring, this is a best-effort convenience
    }
  }, [datasetPath, seed, ingestResponse, scoreResponse, reconcileResponse]);

  function handleApiError(err: unknown) {
    if (err instanceof ApiError) {
      setBanner({ message: err.message, isMissingState: err.isMissingStateError });
    } else {
      setBanner({ message: "Unexpected error — see console for details.", isMissingState: false });
      console.error(err);
    }
  }

  async function runIngest() {
    setIngestLoading(true);
    setBanner(null);
    try {
      const res = await ingestDataset({ dataset_path: datasetPath });
      setIngestResponse(res);
      // A fresh ingest invalidates any previous score/reconciliation run.
      setScoreResponse(null);
      setReconcileResponse(null);
    } catch (err) {
      handleApiError(err);
    } finally {
      setIngestLoading(false);
    }
  }

  async function runScore() {
    setScoreLoading(true);
    setBanner(null);
    try {
      const res = await scoreDataset({});
      setScoreResponse(res);
    } catch (err) {
      handleApiError(err);
    } finally {
      setScoreLoading(false);
    }
  }

  async function runReconcile() {
    setReconcileLoading(true);
    setBanner(null);
    try {
      const res = await reconcileDataset({ seed, top_n_anomalies: 25 });
      setReconcileResponse(res);
    } catch (err) {
      handleApiError(err);
    } finally {
      setReconcileLoading(false);
    }
  }

  return (
    <WorkflowContext.Provider
      value={{
        datasetPath,
        setDatasetPath,
        seed,
        setSeed,
        ingestLoading,
        scoreLoading,
        reconcileLoading,
        ingestResponse,
        scoreResponse,
        reconcileResponse,
        banner,
        clearBanner: () => setBanner(null),
        runIngest,
        runScore,
        runReconcile,
      }}
    >
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflow(): WorkflowContextValue {
  const ctx = useContext(WorkflowContext);
  if (!ctx) throw new Error("useWorkflow must be used within a WorkflowProvider");
  return ctx;
}
