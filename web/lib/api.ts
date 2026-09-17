import type {
  AuditReport,
  CaseDetail,
  CasesResponse,
  DatasetManifest,
  GlossaryTerm,
  RunSummary,
} from "./types";

/**
 * All requests are relative `/api/...` paths.
 *
 * The browser never addresses the FastAPI backend directly: in the preview the
 * page origin is a proxied host, so `next.config.ts` rewrites `/api/*` to the
 * backend. That keeps one code path for local, preview, and production.
 */
async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, detail, path);
  }
  return (await response.json()) as T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly path: string,
  ) {
    super(`${status} ${detail} (${path})`);
    this.name = "ApiError";
  }
}

export const fetchReport = (runId?: string) =>
  get<AuditReport>(`/api/report${runId ? `?run=${encodeURIComponent(runId)}` : ""}`);

export const fetchRuns = () => get<{ runs: RunSummary[] }>("/api/runs");

export const fetchDatasets = () =>
  get<{ datasets: DatasetManifest[] }>("/api/datasets");

export const fetchGlossary = () => get<{ terms: GlossaryTerm[] }>("/api/glossary");

/**
 * Sort keys `/api/cases` accepts. These mirror the server's own allow-list, and
 * the server rejects anything outside it with a 400 rather than silently
 * returning unsorted rows.
 */
export type CaseSortKey =
  | "uncertainty"
  | "error"
  | "patient_id"
  | "truth"
  | "prediction"
  | "ood_score"
  | "interval_width";

export interface CaseQuery {
  search?: string;
  flaggedOnly?: boolean;
  sort?: CaseSortKey;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export const fetchCases = (query: CaseQuery = {}) => {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.flaggedOnly) params.set("flagged_only", "true");
  if (query.sort) params.set("sort", query.sort);
  if (query.order) params.set("order", query.order);
  params.set("limit", String(query.limit ?? 50));
  params.set("offset", String(query.offset ?? 0));
  return get<CasesResponse>(`/api/cases?${params.toString()}`);
};

export const fetchCase = (patientId: string) =>
  get<CaseDetail>(`/api/case/${encodeURIComponent(patientId)}`);

export const artifactUrl = (name: string, runId?: string) =>
  `/api/artifact/${name.split("/").map(encodeURIComponent).join("/")}${
    runId ? `?run=${encodeURIComponent(runId)}` : ""
  }`;
