import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { MARKER } from "./global-setup";

/**
 * Remove exactly what global-setup created, and nothing else.
 *
 * This lives in its own module on purpose: Playwright resolves `globalTeardown`
 * as a config *path*, so a named `globalTeardown` export sitting next to the
 * setup function is never invoked. The ownership marker written by setup is the
 * only thing that authorises a deletion here — if a developer already had the
 * run, `created` is false and we leave it alone.
 */

const REPO = path.resolve(__dirname, "..", "..");
const RUNS = path.join(REPO, "runs");

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(MARKER)) return;

  let marker: { runId?: string; runDir?: string; created?: boolean };
  try {
    marker = JSON.parse(readFileSync(MARKER, "utf-8"));
  } catch {
    rmSync(MARKER, { force: true });
    return;
  }

  const runDir = marker.runDir ? path.resolve(marker.runDir) : "";

  // Defence in depth: never delete anything outside runs/, and never the root.
  const insideRuns = runDir.startsWith(RUNS + path.sep);
  if (marker.created && insideRuns) {
    rmSync(runDir, { recursive: true, force: true });
    console.log(`[e2e] removed seeded run ${marker.runId}`);
  }

  rmSync(MARKER, { force: true });
}
