import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the evidence-workspace journeys.
 *
 * Two rules shape everything here:
 *
 * 1. Assertions derive from the live API, never from a hardcoded metric. The
 *    suite seeds a real run, and a re-seeded run has different numbers — a test
 *    that baked in `0.266` would pass today and fail on the next reseed.
 *
 * 2. Every screen is a client component that returns `null` until the report
 *    fetch resolves. So "the page loaded" means "the H1 rendered", not "the
 *    HTML shell returned 200". A 200 shell with an empty body is exactly the
 *    failure mode these tests exist to catch.
 */

/** Patient ids that are known to carry subgroup context in a seeded run. */
export const CASE_WITH_SUBGROUPS = "sub-274";
export const CASE_PLAIN = "sub-1139";
/** Deliberately absent from every run — exercises the not-found path. */
export const CASE_MISSING = "sub-0000000";

export interface RunInfo {
  runId: string;
  mae: number;
  maeCi: [number, number];
  axes: string[];
}

/** Mirrors `fmt()` from lib/format.ts so expectations match the DOM exactly. */
export const fmt = (value: number, digits = 3): string =>
  value.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** Mirrors `fmtCi()`. */
export const fmtCi = (ci: [number, number], digits = 3): string =>
  `[${fmt(ci[0], digits)}, ${fmt(ci[1], digits)}]`;

/** Read the active run's headline numbers straight from the API under test. */
export async function readRunInfo(page: Page): Promise<RunInfo> {
  const response = await page.request.get("/api/report");
  expect(response.ok(), "the API under test must serve a report").toBeTruthy();
  const report = await response.json();
  return {
    runId: report.manifest.run_id as string,
    mae: report.tasks.continuous.metrics.mae as number,
    maeCi: report.tasks.continuous.metrics.mae_ci as [number, number],
    axes: report.fairness.axes as string[],
  };
}

/**
 * Navigate and wait for real content.
 *
 * The research notice is deliberately NOT the readiness signal: it renders its
 * fallback string even when the report fetch fails. The H1 only exists once the
 * report has hydrated, which is the state every assertion below depends on.
 */
export async function gotoScreen(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Fail on any leaked `undefined`/`NaN` in visible text — a silent data bug. */
export async function expectNoLeakedPlaceholders(page: Page): Promise<void> {
  const body = await page.locator("main").innerText();
  expect(body, "rendered 'undefined'").not.toMatch(/\bundefined\b/);
  expect(body, "rendered 'NaN'").not.toMatch(/\bNaN\b/);
}

/** The 14 screens and their H1s, in left-rail order. */
export const SCREENS: ReadonlyArray<{ path: string; heading: string }> = [
  { path: "/", heading: "What this run shows, and how far to trust it" },
  { path: "/cohort", heading: "Cohort" },
  { path: "/target", heading: "Target definition" },
  { path: "/splits", heading: "Splits" },
  { path: "/data", heading: "Data" },
  { path: "/models", heading: "Models" },
  { path: "/reliability", heading: "Reliability" },
  { path: "/fairness", heading: "Fairness audit" },
  { path: "/mitigation", heading: "Mitigation comparison" },
  { path: "/explanations", heading: "Explanations" },
  { path: "/cases", heading: "Cases" },
  { path: "/release", heading: "Audit report" },
  { path: "/glossary", heading: "Glossary" },
];
