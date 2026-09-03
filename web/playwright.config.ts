import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration for the NeuroLens evidence workspace.
 *
 * The workspace needs TWO processes: the FastAPI evidence API (which owns the
 * run artifacts) and this Next.js app (which proxies /api/* to it). Both are
 * started here so `npm run test:e2e` works from a clean checkout.
 *
 * Nothing in this suite mutates a run — the server is read-only by design — so
 * seeding means "make sure a run exists", and cleanup means "remove the run
 * this suite created", never "reset shared state".
 */

const CI = !!process.env.CI;

/** Port the Next.js app listens on. Kept distinct from the API's 8000. */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8000);

/**
 * The API binary. Locally the project uses a virtualenv; CI puts it on PATH.
 * Override with NEUROLENS_BIN if neither applies.
 */
const NEUROLENS_BIN =
  process.env.NEUROLENS_BIN ??
  (process.env.CI ? "neurolens" : "../.venv/bin/neurolens");

/** In CI we exercise the production build; locally the dev server is faster. */
const webCommand = CI ? "npm run build && npm run start" : "npm run dev";

export default defineConfig({
  testDir: "./e2e",

  /* Screens never write to each other, so run them concurrently. */
  fullyParallel: true,

  /* A test that mutates a shared run would be a bug; fail loudly if one does. */
  forbidOnly: CI,

  /* Flaky retries: none locally (you want the failure immediately), two in CI
     where a cold Turbopack compile can lose a race. */
  retries: CI ? 2 : 0,

  /* The API is a single-process uvicorn; parallelising harder just times out. */
  workers: CI ? 2 : undefined,

  reporter: CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["html", { open: "on-failure" }], ["list"]],

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,

    /* Capture enough to diagnose a CI failure without paying for it on green. */
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

    /* The whole app is client-rendered off one shared report fetch; waiting on
       the network to settle is what makes these assertions deterministic. */
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  expect: {
    /* Charts and figures are fetched after first paint. */
    timeout: 15_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    /* The DESIGN.md breakpoint rules are a product requirement, so mobile is a
       first-class project rather than an afterthought. */
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],

  /* Global setup seeds a run; teardown removes exactly what setup created.
     These must be separate config paths — Playwright resolves each as a file
     and does not read a `globalTeardown` export out of the setup module. */
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  webServer: [
    {
      command: `${NEUROLENS_BIN} serve --runs-root ../runs --host 127.0.0.1 --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: webCommand,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !CI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { NEUROLENS_API: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
