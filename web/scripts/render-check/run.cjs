#!/usr/bin/env node
/**
 * Renders every workspace screen with the real components against the live
 * evidence API, and asserts that real numbers from the audit report reach the
 * DOM. This catches the failure the browser would show: a screen that mounts
 * but renders nothing because a field the UI reads is absent.
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

// --- browser globals the components rely on -------------------------------
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.IS_REACT_ACT_ENVIRONMENT = true;

// React reports NaN SVG attributes, missing keys and unknown props through
// console.error/warn. Those are silent in a browser but mean a chart draws
// nothing, so treat any of them as a failure.
const reactWarnings = [];
for (const level of ["error", "warn"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
    if (/Received NaN|unique "key" prop|not wrapped in act|Each child in a list/.test(text)) {
      if (!/not wrapped in act/.test(text)) reactWarnings.push(text.split("\n")[0]);
    }
    if (!/act\(|fire events|assert on the output|ensures that you|wrap-tests-with-act/.test(text)) {
      original(...args);
    }
  };
}

// Real fetch, pointed at the running app so requests traverse the same
// /api/* proxy the browser uses. Capture the original before shadowing it,
// otherwise the wrapper recurses into itself.
const nodeFetch = global.fetch;
global.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const absolute = url.startsWith("http") ? url : ORIGIN + url;
  return nodeFetch(absolute, init);
};

// next/navigation is not available outside the router; the case screen reads
// the patient id from useParams. Read it at call time so the harness can set
// the id after this shim has already been bundled.
const navShim = path.join(__dirname, "nav-shim.js");
fs.writeFileSync(
  navShim,
  `export function useParams(){return {patientId: globalThis.__CASE_ID__ || ""};}\n` +
    `export function usePathname(){return "/";}\n` +
    `export function useRouter(){return {push(){},replace(){},back(){}};}\n` +
    `export function useSearchParams(){return new URLSearchParams();}\n`,
);

// next/link renders a plain anchor.
const linkShim = path.join(__dirname, "link-shim.js");
fs.writeFileSync(
  linkShim,
  `import {createElement} from "react";\n` +
    `export default function Link({href, children, ...rest}){\n` +
    `  return createElement("a", {href, ...rest}, children);\n}\n`,
);

async function main() {
  const outfile = path.join(__dirname, "bundle.cjs");
  await esbuild.build({
    entryPoints: [path.join(__dirname, "entry.tsx")],
    bundle: true,
    outfile,
    platform: "node",
    format: "cjs",
    target: "node20",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    alias: {
      "@": path.join(WEB),
      "next/navigation": navShim,
      "next/link": linkShim,
    },
    external: ["react", "react-dom", "react-dom/client"],
    logLevel: "error",
  });

  const entry = require(outfile);

  // What must appear, pulled from the live report so the assertions track the
  // data rather than a hardcoded transcript.
  const report = await (await fetch(ORIGIN + "/api/report")).json();
  const health = await (await fetch(ORIGIN + "/api/health")).json();
  const glossary = await (await fetch(ORIGIN + "/api/glossary")).json();
  const datasets = await (await fetch(ORIGIN + "/api/datasets")).json();

  const fmt = (n, d = 3) => (n === null || n === undefined ? null : Number(n).toFixed(d));
  const cont = report.tasks.continuous.metrics;
  const worst = report.fairness.worst_group;

  // Prefer a patient whose subgroup_context is non-empty: a patient with none
  // renders an empty list, so a wrong field name inside that list stays hidden.
  const allCases = (await (await fetch(ORIGIN + "/api/cases?limit=200")).json()).cases;
  let CASE_ID = allCases[0].patient_id;
  for (const candidate of allCases) {
    const detail = await (await fetch(ORIGIN + "/api/case/" + encodeURIComponent(candidate.patient_id))).json();
    if ((detail.subgroup_context || []).length) { CASE_ID = candidate.patient_id; break; }
  }

  const expectations = {
    // The overview renders metrics, not provenance: run id and the research
    // notice live in the shell chrome, which this harness does not mount.
    overview: [fmt(cont.mae), String(cont.n), worst.worst_group],
    cohort: [String(report.cohort.n_analysed), String(report.cohort.n_excluded)],
    target: [report.cohort.target_definition.units],
    splits: [report.cohort.split.split_hash.slice(0, 8)],
    data: [datasets.datasets[0].key],
    models: [report.model_comparison[0].name],
    reliability: [String(report.trust.ood.n), String(report.trust.ood.n_flagged_shift)],
    fairness: [worst.worst_group, "INSUFFICIENT DATA"],
    mitigation: [report.fairness.preferred_model],
    explanations: [report.explainability.global_importance[0].label],
    cases: [String(report.tasks.continuous.metrics.n)],
    release: [report.reproduce_command],
    glossary: [glossary.terms[0].term],
  };

  const results = [];
  let failed = 0;

  for (const [name, mustContain] of Object.entries(expectations)) {
    let text = "";
    let error = null;
    try {
      text = await entry.mount(name);
    } catch (cause) {
      error = cause;
    }
    if (error) {
      failed += 1;
      results.push({ name, ok: false, error: error.message, text: "" });
      continue;
    }
    const missing = mustContain.filter((needle) => needle && !text.includes(String(needle)));
    // A field the UI reads but the API does not send renders as the literal
    // text "undefined" or a NaN coordinate. Both are silent in a browser.
    const bad = [];
    if (/\bundefined\b/.test(text)) bad.push("renders 'undefined'");
    if (/\bNaN\b/.test(text)) bad.push("renders 'NaN'");
    const thin = text.trim().length < 200;
    const ok = missing.length === 0 && bad.length === 0 && !thin;
    if (!ok) failed += 1;
    results.push({ name, ok, missing: [...missing, ...bad], chars: text.trim().length, thin });
  }

  // Case detail, mounted separately because it reads useParams.
  globalThis.__CASE_ID__ = CASE_ID;
  try {
    const text = await entry.mountCaseDetail(CASE_ID);
    const missing = [CASE_ID].filter((n) => !text.includes(n));
    if (/\bundefined\b/.test(text)) missing.push("renders 'undefined'");
    if (/\bNaN\b/.test(text)) missing.push("renders 'NaN'");
    const ok = missing.length === 0 && text.trim().length > 200;
    if (!ok) failed += 1;
    results.push({ name: "cases/[patientId]", ok, missing, chars: text.trim().length });
  } catch (cause) {
    failed += 1;
    results.push({ name: "cases/[patientId]", ok: false, error: cause.message });
  }

  console.log(`\norigin: ${ORIGIN}`);
  console.log(`run:    ${report.manifest.run_id}`);
  console.log(`health.active_run: ${health.active_run}`);
  console.log(
    `continuous MAE: ${fmt(cont.mae)}  n=${cont.n}  ` +
      `fairness worst=${worst.worst_group}  cases[0]=${CASE_ID}\n`,
  );
  console.log("screen                result   chars  missing");
  console.log("-".repeat(72));
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    const detail = r.error
      ? r.error.slice(0, 44)
      : r.missing && r.missing.length
        ? r.missing.map((m) => String(m).slice(0, 22)).join(",")
        : r.thin
          ? "rendered too little content"
          : "";
    console.log(
      `${r.name.padEnd(21)} ${status.padEnd(8)} ${String(r.chars ?? 0).padStart(5)}  ${detail}`,
    );
  }
  console.log("-".repeat(72));
  if (reactWarnings.length) {
    failed += 1;
    console.log("\nReact warnings during render:");
    for (const w of [...new Set(reactWarnings)]) console.log(`  ! ${w.slice(0, 110)}`);
  }
  console.log(failed === 0 ? `all ${results.length} screens render live data, no React warnings` : `${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(2);
});
