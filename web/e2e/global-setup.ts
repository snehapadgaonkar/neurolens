import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Seed real runs for the E2E suite.
 *
 * Three constraints shape this:
 *
 * 1. The project's standing rule is real data only — no synthetic cohort is
 *    generated anywhere, including tests. So seeding means running the real
 *    pipeline against the real OpenNeuro ds004856 metadata, exactly as
 *    `neurolens run` does for a human.
 *
 * 2. Two runs are seeded, not one. The run switcher is an approved journey, and
 *    with a single run its "switch and reload" assertion can only ever skip —
 *    a test that never runs is not coverage. Both runs come from the same real
 *    dataset under different seeds, so nothing synthetic is introduced.
 *
 * 3. The server is read-only, so a test can never corrupt a run. Cleanup is
 *    therefore about not leaving our own runs behind in the developer's `runs/`
 *    directory, not about restoring state.
 *
 * What we create is recorded in a marker file so teardown (a separate file,
 * because Playwright only calls a `globalTeardown` *config path*, never a
 * named export from this module) can only ever delete the directories this
 * setup produced. Runs the developer already had are never touched.
 */

export const MARKER = path.join(tmpdir(), "neurolens-e2e-seed.json");

export interface SeededRun {
  runId: string;
  runDir: string;
  created: boolean;
}

const REPO = path.resolve(__dirname, "..", "..");
const RUNS = path.join(REPO, "runs");
const DATA = path.join(REPO, "data", "raw", "ds004856");

/** Distinct seeds over the same real dataset: two genuinely different runs. */
const SEEDS = [20240917, 20240918];

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

/** Parse the `directory  : runs/<id>` line the CLI prints on success. */
function runDirFrom(output: string): string {
  const match = /^directory\s*:\s*(\S+)$/m.exec(output);
  if (!match) {
    throw new Error(`Could not determine the run directory from:\n${output}`);
  }
  return path.resolve(REPO, match[1]);
}

export default async function globalSetup(): Promise<void> {
  ensureData();

  const before = new Set(existsSync(RUNS) ? readdirSync(RUNS) : []);
  const seeded: SeededRun[] = [];

  for (const seed of SEEDS) {
    const output = neurolens([
      "run",
      "--dataset",
      "openneuro-ds004856",
      "--data-dir",
      DATA,
      "--seed",
      String(seed),
    ]);

    const runDir = runDirFrom(output);
    const runId = path.basename(runDir);

    // Run ids are stamped to the second. Two back-to-back runs cannot collide
    // in practice (each takes ~10s), but if they ever did, the switcher would
    // silently have one option and the journey would start skipping again.
    if (seeded.some((run) => run.runId === runId)) {
      throw new Error(
        `Seeding produced a duplicate run id ${runId}; the run switcher would ` +
          "have nothing to switch between.",
      );
    }

    seeded.push({ runId, runDir, created: !before.has(runId) });
    console.log(
      `[e2e] seeded run ${runId} (seed ${seed}, created by this suite: ${!before.has(runId)})`,
    );
  }

  // Written last, so a partial seed never leaves teardown holding a marker for
  // a directory that does not exist.
  writeFileSync(MARKER, JSON.stringify({ runs: seeded }));

  // Deliberately no process.env handoff to the tests: Playwright runs global
  // setup in a separate process from the workers, so assignments here would not
  // reach them. Tests read the run they are served from the API instead, which
  // keeps a single source of truth and survives a re-seeded run.
}
