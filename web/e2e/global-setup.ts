import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Seed a real run for the E2E suite.
 *
 * Two constraints shape this:
 *
 * 1. The project's standing rule is real data only — no synthetic cohort is
 *    generated anywhere, including tests. So seeding means running the real
 *    pipeline against the real OpenNeuro ds004856 metadata, exactly as
 *    `neurolens run` does for a human.
 *
 * 2. The server is read-only, so a test can never corrupt a run. Cleanup is
 *    therefore about not leaving our own run behind in the developer's `runs/`
 *    directory, not about restoring state.
 *
 * What we create is recorded in a marker file so teardown (a separate file,
 * because Playwright only calls a `globalTeardown` *config path*, never a
 * named export from this module) can only ever delete the directory this setup
 * produced. A run the developer already had is never touched.
 */

export const MARKER = path.join(tmpdir(), "neurolens-e2e-seed.json");

const REPO = path.resolve(__dirname, "..", "..");
const RUNS = path.join(REPO, "runs");
const DATA = path.join(REPO, "data", "raw", "ds004856");

const NEUROLENS_BIN =
  process.env.NEUROLENS_BIN ??
  (process.env.CI ? "neurolens" : path.join(REPO, ".venv", "bin", "neurolens"));

function neurolens(args: string[]): string {
  return execFileSync(NEUROLENS_BIN, args, {
    cwd: REPO,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function ensureData(): void {
  if (existsSync(path.join(DATA, "participants.tsv"))) return;
  // Real CC0 metadata. This throws rather than falling back to anything fake.
  neurolens(["fetch-data", "--dataset", "openneuro-ds004856"]);
  if (!existsSync(path.join(DATA, "participants.tsv"))) {
    throw new Error(
      "Could not obtain the real OpenNeuro ds004856 metadata. The E2E suite " +
        "refuses to run against generated data. Run `neurolens fetch-data " +
        "--dataset openneuro-ds004856` on a machine with network access.",
    );
  }
}

export default async function globalSetup(): Promise<void> {
  ensureData();

  const before = new Set(existsSync(RUNS) ? readdirSync(RUNS) : []);

  const output = neurolens([
    "run",
    "--dataset",
    "openneuro-ds004856",
    "--data-dir",
    DATA,
    "--seed",
    "20240917",
  ]);

  const match = /^directory\s*:\s*(\S+)$/m.exec(output);
  if (!match) {
    throw new Error(
      `Could not determine the seeded run directory from:\n${output}`,
    );
  }

  const runDir = path.resolve(REPO, match[1]);
  const runId = path.basename(runDir);

  // Only claim ownership of it if it did not already exist.
  const created = !before.has(runId);
  writeFileSync(MARKER, JSON.stringify({ runId, runDir, created }));

  process.env.E2E_RUN_ID = runId;
  console.log(
    `[e2e] seeded run ${runId} (created by this suite: ${created})`,
  );

  // Surface the run id to the tests without a second source of truth.
  const snapshot = JSON.parse(
    readFileSync(path.join(runDir, "audit_report.json"), "utf-8"),
  );
  process.env.E2E_RUN_COHORT_N = String(snapshot.cohort?.analysed ?? "");
}
