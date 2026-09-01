"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, fetchReport, fetchRuns } from "./api";
import type { AuditReport, RunSummary } from "./types";

interface Store {
  report: AuditReport | null;
  runs: RunSummary[];
  runId: string | undefined;
  setRunId: (runId: string | undefined) => void;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const StoreContext = createContext<Store | null>(null);

/**
 * One fetch of the audit report for the whole workspace.
 *
 * Every screen reads the same run, so the report is fetched once here and shared
 * rather than re-requested per page. Switching runs re-fetches and every screen
 * updates together.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [runsResponse, reportResponse] = await Promise.all([
          fetchRuns().catch(() => ({ runs: [] as RunSummary[] })),
          fetchReport(runId),
        ]);
        if (cancelled) return;
        setRuns(runsResponse.runs);
        setReport(reportResponse);
        if (!runId) setRunId(reportResponse.manifest.run_id);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause.status === 404
              ? "No completed run was found. Run `neurolens run` to produce an audit package, then reload."
              : `The evidence API returned ${cause.status}: ${cause.detail}`
            : "The evidence API could not be reached. Is `neurolens serve` running?",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runId, nonce]);

  const retry = useCallback(() => setNonce((value) => value + 1), []);

  const value = useMemo<Store>(
    () => ({ report, runs, runId, setRunId, loading, error, retry }),
    [report, runs, runId, loading, error, retry],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}

/** The report, or null while loading — for screens that cannot render without it. */
export function useReport(): AuditReport | null {
  return useStore().report;
}
