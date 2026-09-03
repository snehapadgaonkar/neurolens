import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { MARKER, type SeededRun } from "./global-setup";

/**
 * Remove exactly what global-setup created, and nothing else.
 *
 * This lives in its own module on purpose: Playwright resolves `globalTeardown`
 * as a config *path*, so a named `globalTeardown` export sitting next to the
 * setup function is never invoked. The ownership marker written by setup is the
 * only thing that authorises a deletion here — any run the developer already
 * had is recorded with `created: false` and left alone.
 *
 * Setup seeds two runs, so the marker holds a list. Each entry is validated
 * independently: one bad path must not stop the others from being cleaned up,
 * and must not let a path outside `runs/` through.
 */

const REPO = path.resolve(__dirname, "..", "..");
const RUNS = path.join(REPO, "runs");

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(MARKER)) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(MARKER, "utf-8"));
  } catch {
    rmSync(MARKER, { force: true });
    return;
  }

  const runs = Array.isArray((parsed as { runs?: unknown }).runs)
    ? ((parsed as { runs: SeededRun[] }).runs)
    : [];

  for (const entry of runs) {
    if (!entry?.created || !entry.runDir) continue;

    const runDir = path.resolve(REPO, entry.runDir);

    // Defence in depth: never delete anything outside runs/, and never the
    // directory itself. A marker that names `runs/` would otherwise wipe every
    // run on the machine.
    const insideRuns = runDir.startsWith(RUNS + path.sep);
    if (!insideRuns) continue;

    rmSync(runDir, { recursive: true, force: true });
    console.log(`[e2e] removed seeded run ${entry.runId}`);
  }

  rmSync(MARKER, { force: true });
}
