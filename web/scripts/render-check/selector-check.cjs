#!/usr/bin/env node
/**
 * Selector verification for the Playwright suite.
 *
 * The browser suite cannot run in every environment (it needs a real browser
 * binary), but a wrong selector fails silently and identically everywhere: the
 * locator matches nothing and the test times out with no useful message. Two
 * such bugs were already found by inspection — a `data-testid` passed to a
 * component that did not forward unknown props, and a landmark selector aimed
 * at an `<aside>` labelled "Primary navigation" when the real `<nav>` is
 * labelled "Workspace sections".
 *
 * So this renders the REAL components in jsdom against the live API and asserts
 * that every hook the e2e suite uses resolves. It is not a substitute for the
 * browser suite — it cannot test interaction, layout, or focus — but it does
 * catch the class of bug that would otherwise make 98 tests fail for one
 * shared reason.
 */
const { JSDOM } = require("jsdom");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const WEB = path.resolve(__dirname, "..", "..");
const ORIGIN = process.env.NEUROLENS_ORIGIN || "http://127.0.0.1:3000";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: ORIGIN + "/",
  pretendToBeVisual: true,
});

for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  SVGElement: dom.window.SVGElement,
  getComputedStyle: dom.window.getComputedStyle,
})) {
  global[key] = value;
}
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.IS_REACT_ACT_ENVIRONMENT = true;

// Silence React's act() nag but keep genuine warnings visible.
for (const level of ["error", "warn"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
    if (!/act\(|fire events|assert on the output|ensures that you|wrap-tests-with-act/.test(text)) {
      original(...args);
    }
  };
}

const nodeFetch = global.fetch;

/**
 * Fetch shim with a programmable failure policy.
 *
 * The failure-state tests in the suite are driven by intercepting the network,
 * so the hooks they assert on only exist in an error render. Reproducing that
 * here is the only way to verify them without a browser.
 */
global.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const absolute = url.startsWith("http") ? url : ORIGIN + url;
  const policy = globalThis.__FETCH_POLICY__;
  if (policy) {
    const override = policy(absolute);
    if (override) {
      // Node's own Response, not jsdom's: this jsdom build exposes no Response
      // constructor, and constructing one threw, which made every stubbed
      // failure surface as a network error instead of its real status.
      return Promise.resolve(
        new Response(JSON.stringify(override.body), {
          status: override.status,
          headers: { "content-type": "application/json" },
        }),
      );
    }
  }
  return nodeFetch(absolute, init);
};

const shimDir = __dirname;
const navShim = path.join(shimDir, "nav-shim.js");
const linkShim = path.join(shimDir, "link-shim.js");
fs.writeFileSync(
  navShim,
  `export function useParams(){return {patientId: globalThis.__CASE_ID__ || ""};}\n` +
    `export function usePathname(){return globalThis.__PATHNAME__ || "/";}\n` +
    `export function useRouter(){return {push(){},replace(){},back(){}};}\n` +
    `export function useSearchParams(){return new URLSearchParams();}\n`,
);
fs.writeFileSync(
  linkShim,
  `import {createElement} from "react";\n` +
    `export default function Link({href, children, ...rest}){\n` +
    `  return createElement("a", {href, ...rest}, children);\n}\n`,
);

const entrySrc = path.join(shimDir, "_selector-entry.tsx");
fs.writeFileSync(
  entrySrc,
  `import { createRoot } from "react-dom/client";
import { act } from "react";
import { createElement } from "react";
import { StoreProvider } from "@/lib/store";
import { Shell } from "@/components/shell";
import Cases from "@/app/(workspace)/cases/page";
import Fairness from "@/app/(workspace)/fairness/page";
import Release from "@/app/(workspace)/release/page";
import CaseDetail from "@/app/(workspace)/cases/[patientId]/page";

const COMPONENTS: Record<string, () => any> = {
  cases: Cases,
  fairness: Fairness,
  release: Release,
  caseDetail: CaseDetail,
};

async function settle(host: HTMLElement, maxTicks = 60): Promise<void> {
  let previous = "";
  let stable = 0;
  for (let i = 0; i < maxTicks; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const text = host.textContent || "";
    stable = text === previous ? stable + 1 : 0;
    previous = text;
    if (stable >= 3 && i >= 4) return;
  }
}

export async function mount(
  kind: "shell" | keyof typeof COMPONENTS,
): Promise<{ host: HTMLElement; unmount: () => void }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const child =
    kind === "shell"
      ? createElement(Shell, null, createElement("div", null, "page content"))
      : createElement(COMPONENTS[kind]);
  await act(async () => {
    root.render(createElement(StoreProvider, null, child));
  });
  await settle(host);
  return { host, unmount: () => root.unmount() };
}
`,
);

/* ------------------------------------------------------------------ checks */

const results = [];
const record = (scenario, name, ok, detail = "") =>
  results.push({ scenario, name, ok, detail });

/** Assert a data-testid resolves, mirroring page.getByTestId(). */
const expectTestId = (host, scenario, id) => {
  const found = host.querySelectorAll(`[data-testid="${id}"]`).length;
  record(scenario, `getByTestId("${id}")`, found > 0, `${found} match(es)`);
};

/** Assert a CSS selector resolves to exactly n elements. */
const expectCount = (host, scenario, label, selector, expected) => {
  const found = host.querySelectorAll(selector).length;
  record(scenario, label, found === expected, `found ${found}, want ${expected}`);
};

/** Assert visible text contains a substring. */
const expectText = (host, scenario, label, needle) => {
  const text = host.textContent || "";
  record(scenario, label, text.includes(needle), text.includes(needle) ? "" : `missing "${needle}"`);
};

/**
 * Count the elements Playwright's text engine would return for a locator.
 *
 * Playwright matches the *smallest* element containing the text, and a bare
 * getByText() runs in strict mode, so two sibling matches throw instead of
 * picking one. Counting every ancestor too would over-report, so an element
 * only counts when none of its children also match.
 */
const countTextMatches = (host, needle) => {
  const norm = (value) => (value || "").replace(/\s+/g, " ").trim();
  const target = norm(needle);
  const all = [...host.querySelectorAll("*")];
  return all.filter((element) => {
    if (norm(element.textContent) !== target) return false;
    return ![...element.children].some((child) => norm(child.textContent) === target);
  }).length;
};

/** Assert a getByText() locator would resolve to exactly one element. */
const expectUniqueText = (host, scenario, needle, expected = 1) => {
  const found = countTextMatches(host, needle);
  record(
    scenario,
    `getByText("${needle}") matches ${expected}`,
    found === expected,
    `found ${found} — strict mode ${found === 1 ? "ok" : "would throw"}`,
  );
};

(async () => {
  await esbuild.build({
    entryPoints: [entrySrc],
    bundle: true,
    outfile: path.join(shimDir, "_selector.cjs"),
    platform: "node",
    format: "cjs",
    target: "node20",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    alias: { "@": WEB, "next/navigation": navShim, "next/link": linkShim },
    external: ["react", "react-dom", "react-dom/client"],
    logLevel: "error",
  });

  const { mount } = require(path.join(shimDir, "_selector.cjs"));

  // ---- scenario 1: shell, healthy -------------------------------------
  globalThis.__FETCH_POLICY__ = null;
  {
    const { host, unmount } = await mount("shell");
    const S = "shell (healthy)";
    for (const id of [
      "skip-link",
      "run-switcher",
      "nav-open",
      "nav-close",
      "research-notice",
    ]) {
      expectTestId(host, S, id);
    }
    // nav-overlay only exists once the sheet is open; assert it is absent now
    // so the suite's open->close sequence is testing a real state change.
    expectCount(host, S, 'nav-overlay absent until open', '[data-testid="nav-overlay"]', 0);
    expectCount(host, S, 'error callout absent when healthy', '[data-testid="load-error"]', 0);

    // The landmark the navigation tests target. An <aside> is role
    // "complementary", so this must be a real <nav> with the exact label.
    expectCount(
      host, S,
      'nav landmark: nav[aria-label="Workspace sections"]',
      'nav[aria-label="Workspace sections"]', 1,
    );
    // The skip link's target must be focusable, or focus never moves.
    expectCount(host, S, 'main#main is focusable (tabindex="-1")', 'main#main[tabindex="-1"]', 1);
    expectCount(host, S, "exactly one <main>", "main", 1);
    expectCount(host, S, "header landmark present", "header", 1);
    expectCount(host, S, "footer landmark present", "footer", 1);

    const switcher = host.querySelector('[data-testid="run-switcher"]');
    record(S, "run-switcher has a selected value", !!switcher?.value, switcher?.value || "none");
    unmount();
  }

  // ---- scenario 2: shell, report 404 ----------------------------------
  {
    globalThis.__FETCH_POLICY__ = (url) =>
      url.includes("/api/report")
        ? { status: 404, body: { detail: "no completed run" } }
        : null;
    const { host, unmount } = await mount("shell");
    const S = "shell (report 404)";
    expectTestId(host, S, "load-error");
    expectTestId(host, S, "load-error-retry");
    expectCount(host, S, 'load-error exposes role="alert"', '[data-testid="load-error"][role="alert"]', 1);
    expectText(host, S, "404 wording matches lib/store.tsx", "No completed run was found.");
    unmount();
  }

  // ---- scenario 3: shell, report 503 ----------------------------------
  {
    globalThis.__FETCH_POLICY__ = (url) =>
      url.includes("/api/report")
        ? { status: 503, body: { detail: "run directory is locked" } }
        : null;
    const { host, unmount } = await mount("shell");
    const S = "shell (report 503)";
    expectText(host, S, "status is surfaced", "503");
    expectText(host, S, "server detail is surfaced", "run directory is locked");
    unmount();
  }

  // ---- scenario 4: cases page, healthy --------------------------------
  globalThis.__FETCH_POLICY__ = null;
  {
    const { host, unmount } = await mount("cases");
    const S = "cases (healthy)";
    for (const id of [
      "case-search",
      "flagged-toggle",
      "sort-uncertainty",
      "sort-error",
      "sort-patient_id",
      "case-count",
    ]) {
      expectTestId(host, S, id);
    }
    expectCount(host, S, "case-search is a search input", 'input[data-testid="case-search"][type="search"]', 1);
    expectCount(host, S, "flagged-toggle publishes aria-pressed", '[data-testid="flagged-toggle"][aria-pressed]', 1);
    expectCount(host, S, "error callout absent when healthy", '[data-testid="cases-error"]', 0);

    // Sortable headers: the table-sort test targets these by column key.
    for (const key of ["uncertainty", "error", "patient_id"]) {
      expectCount(host, S, `sort-header-${key}`, `[data-testid="sort-header-${key}"]`, 1);
    }
    // aria-sort must be present on exactly one column at a time.
    expectCount(
      host, S,
      "exactly one th carries a concrete aria-sort",
      'th[aria-sort="ascending"], th[aria-sort="descending"]', 1,
    );
    expectCount(host, S, "charts render (figure)", "figure", 1);
    expectText(host, S, "chart summary is published", "Chart summary.");
    expectText(host, S, "count line reports held-out cases", "held-out cases");

    // Rows link through to the detail route the drill-down test clicks.
    const firstLink = host.querySelector("tbody tr a");
    record(
      S, "case row links to /cases/{id}",
      !!firstLink && /^\/cases\/sub-/.test(firstLink.getAttribute("href") || ""),
      firstLink?.getAttribute("href") || "no link",
    );
    unmount();
  }

  // ---- scenario 5: cases page, case query fails -----------------------
  {
    globalThis.__FETCH_POLICY__ = (url) =>
      url.includes("/api/cases")
        ? { status: 500, body: { detail: "index unavailable" } }
        : null;
    const { host, unmount } = await mount("cases");
    const S = "cases (query 500)";
    expectTestId(host, S, "cases-error");
    expectText(host, S, "callout title renders", "Cases could not be loaded");
    unmount();
  }

  // ---- scenario 5b: cases page, empty result set ----------------------
  // The suite asserts on the "no cases match" copy, and the component renders
  // that string in two places (the chart panel's fallback and the table's
  // emptyLabel). A bare getByText() is strict, so duplicates would throw.
  {
    globalThis.__FETCH_POLICY__ = (url) =>
      url.includes("/api/cases") ? { status: 200, body: { cases: [], total: 0 } } : null;
    const { host, unmount } = await mount("cases");
    const S = "cases (empty result set)";
    // The copy itself is rendered twice (chart panel fallback + table
    // emptyLabel), which is exactly why the suite targets the table's own hook
    // instead of using a strict getByText().
    expectUniqueText(host, S, "No cases match the current filter.", 2);
    expectCount(host, S, "table-empty hook resolves once", '[data-testid="table-empty"]', 1);
    const empty = host.querySelector('[data-testid="table-empty"]');
    record(
      S, "table-empty carries the emptyLabel copy",
      (empty?.textContent || "").trim() === "No cases match the current filter.",
      JSON.stringify((empty?.textContent || "").trim()),
    );
    expectText(host, S, "count line still renders", "0 shown of 0");
    unmount();
  }

  // ---- scenario 6: fairness page, healthy -----------------------------
  globalThis.__FETCH_POLICY__ = null;
  const axes = (await (await nodeFetch(ORIGIN + "/api/report")).json()).fairness.axes;
  {
    const { host, unmount } = await mount("fairness");
    const S = "fairness (healthy)";
    expectTestId(host, S, "fairness-axis");
    const select = host.querySelector('[data-testid="fairness-axis"]');
    const options = select ? select.querySelectorAll("option").length : 0;
    record(
      S, "axis select offers 'All axes' + one option per report axis",
      options === axes.length + 1,
      `${options} options, ${axes.length} axes`,
    );
    record(
      S, "first option is the aggregate view",
      (select?.querySelector("option")?.value || "") === "all",
      select?.querySelector("option")?.value || "none",
    );
    unmount();
  }

  // ---- scenario 6b: release page, healthy -----------------------------
  // The suite locates the artifact buttons by accessible name and does not use
  // .first(), so a second element sharing that name would throw in strict mode.
  {
    const { host, unmount } = await mount("release");
    const S = "release (healthy)";
    for (const label of ["Model card", "Full report"]) {
      const links = [...host.querySelectorAll("a")].filter(
        (a) => (a.textContent || "").replace(/\s+/g, " ").trim() === label,
      );
      record(
        S, `getByRole("link", { name: "${label}" }) matches 1`,
        links.length === 1,
        `found ${links.length}`,
      );
      const href = links[0]?.getAttribute("href") || "";
      record(
        S, `"${label}" href targets /api/artifact/`,
        href.startsWith("/api/artifact/"),
        href || "no href",
      );
    }
    // The readiness test counts these and asserts exactly one is present.
    const ready = countTextMatches(host, "RELEASE READY");
    const blocked = countTextMatches(host, "BLOCKED");
    record(
      S, "exactly one readiness verdict renders",
      ready + blocked === 1,
      `RELEASE READY=${ready}, BLOCKED=${blocked}`,
    );
    unmount();
  }

  // ---- scenario 6c: case detail, patient that exists ------------------
  {
    const allCases = (await (await nodeFetch(ORIGIN + "/api/cases?limit=200")).json()).cases;
    let withExplanation = "";
    for (const candidate of allCases) {
      const detail = await (
        await nodeFetch(ORIGIN + "/api/case/" + encodeURIComponent(candidate.patient_id))
      ).json();
      if (detail.explanation) {
        withExplanation = candidate.patient_id;
        break;
      }
    }
    record("case detail (real patient)", "found a patient with an explanation",
      !!withExplanation, withExplanation || "none in run");

    if (withExplanation) {
      globalThis.__CASE_ID__ = withExplanation;
      const { host, unmount } = await mount("caseDetail");
      const S = "case detail (real patient)";
      // Located without .first() in the suite, so it must be unique.
      expectUniqueText(host, S, "Why the model predicted this");
      const patientId = withExplanation;
      expectText(host, S, "patient id is rendered in the page", patientId);
      unmount();
      globalThis.__CASE_ID__ = "";
    }
  }

  // ---- scenario 7: case detail, unknown patient -----------------------
  {
    globalThis.__CASE_ID__ = "sub-0000000";
    const { host, unmount } = await mount("caseDetail");
    const S = "case detail (unknown id)";
    expectText(host, S, "not-found state renders", "Case not found");
    // The suite locates this without .first(), so it must be unique.
    expectUniqueText(host, S, "Case not found");
    const back = [...host.querySelectorAll("a")].find((a) =>
      (a.textContent || "").includes("Back to cases"),
    );
    record(S, "'Back to cases' recovery link present", !!back, back?.getAttribute("href") || "missing");
    unmount();
    globalThis.__CASE_ID__ = "";
  }

  /* --------------------------------------------------------------- report */
  let failures = 0;
  let current = null;
  console.log("");
  for (const result of results) {
    if (result.scenario !== current) {
      current = result.scenario;
      console.log(`\n${current}`);
    }
    if (!result.ok) failures += 1;
    const note = result.ok ? "" : `   <- ${result.detail}`;
    console.log(`  ${result.ok ? "PASS" : "FAIL"}  ${result.name}${note}`);
  }
  console.log(
    failures === 0
      ? `\nall ${results.length} selector assertions resolve in the real DOM`
      : `\n${failures} of ${results.length} selector assertions FAILED`,
  );
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
