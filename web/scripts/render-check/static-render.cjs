#!/usr/bin/env node
/**
 * Renders the REAL built-in static SPA (src/neurolens/server/static/app.js) in
 * jsdom against the live API, and walks every screen it defines.
 *
 * This is the second front end the README promises. It shares the API with the
 * Next.js workspace, so a field rename breaks both -- and nothing else covered it.
 */
const { JSDOM } = require("jsdom");

const ORIGIN = process.env.NEUROLENS_STATIC_ORIGIN || "http://127.0.0.1:8000";
const nodeFetch = global.fetch;

const SCREENS = [
  "home", "datasets", "features", "cohort", "audit", "comparison",
  "fairness", "reliability", "cases", "export", "reproducibility", "glossary",
];

async function main() {
  const html = await (await nodeFetch(ORIGIN + "/")).text();
  const src = await (await nodeFetch(ORIGIN + "/static/app.js")).text();
  const report = await (await nodeFetch(ORIGIN + "/api/report")).json();
  const cases = await (await nodeFetch(ORIGIN + "/api/cases?limit=1")).json();

  const dom = new JSDOM(html, { url: ORIGIN + "/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = (u, i) =>
    nodeFetch(typeof u === "string" && !u.startsWith("http") ? ORIGIN + u : u, i);
  for (const k of ["requestAnimationFrame", "cancelAnimationFrame"]) {
    window[k] = (cb) => setTimeout(() => cb(Date.now()), 0);
  }
  window.scrollTo = () => {};

  const jsErrors = [];
  window.addEventListener("error", (e) => jsErrors.push(String(e.message || e)));

  window.eval(src);
  // app.js boots on DOMContentLoaded, which already fired before this eval.
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

  const settle = async () => {
    let previous = "";
    let stable = 0;
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      const now = window.document.body.textContent || "";
      if (now === previous && now.length > 0) {
        stable += 1;
        if (stable >= 3) break;
      } else stable = 0;
      previous = now;
    }
    return previous;
  };

  await settle();

  const results = [];
  for (const id of SCREENS) {
    window.location.hash = `#/${id}`;
    window.dispatchEvent(new window.Event("hashchange"));
    const text = await settle();
    const bad = [];
    if (/\bundefined\b/.test(text)) bad.push("renders 'undefined'");
    if (/\bNaN\b/.test(text)) bad.push("renders 'NaN'");
    if (/could not be rendered/i.test(text)) bad.push("screen threw");
    const thin = text.trim().length < 300;
    results.push({ id, ok: bad.length === 0 && !thin, bad, chars: text.trim().length });
  }

  // The per-case screen needs an argument.
  const pid = cases.cases[0].patient_id;
  window.location.hash = `#/case/${encodeURIComponent(pid)}`;
  window.dispatchEvent(new window.Event("hashchange"));
  const caseText = await settle();
  const caseBad = [];
  if (!caseText.includes(pid)) caseBad.push("patient id missing");
  if (/\bundefined\b/.test(caseText)) caseBad.push("renders 'undefined'");
  if (/\bNaN\b/.test(caseText)) caseBad.push("renders 'NaN'");
  if (/could not be rendered/i.test(caseText)) caseBad.push("screen threw");
  results.push({ id: "case/[id]", ok: caseBad.length === 0, bad: caseBad, chars: caseText.trim().length });

  // Spot-check that real values from the report reached the fairness screen.
  window.location.hash = "#/fairness";
  window.dispatchEvent(new window.Event("hashchange"));
  const fairText = await settle();
  const worst = report.fairness.worst_group.worst_group;
  const valueChecks = [
    ["worst subgroup on fairness screen", fairText.includes(worst)],
    ["dataset key somewhere", (window.document.body.textContent || "").includes(report.cohort.dataset) || fairText.includes(report.cohort.dataset)],
  ];
  for (const [name, ok] of valueChecks) {
    results.push({ id: `value: ${name}`, ok, bad: ok ? [] : ["not found"], chars: null });
  }

  let failed = 0;
  console.log(`\nstatic UI at ${ORIGIN}`);
  console.log(`run: ${report.manifest.run_id}\n`);
  console.log("screen                 result   chars  problem");
  console.log("-".repeat(66));
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(
      `${r.id.padEnd(22)} ${(r.ok ? "PASS" : "FAIL").padEnd(8)} ${String(r.chars ?? "").padStart(5)}  ${r.bad.join(", ")}`,
    );
  }
  console.log("-".repeat(66));
  if (jsErrors.length) {
    failed += 1;
    console.log("uncaught JS errors:");
    for (const e of [...new Set(jsErrors)].slice(0, 5)) console.log(`  ! ${e.slice(0, 110)}`);
  }
  const nScreens = results.filter((r) => !r.id.startsWith("value:")).length;
  const nValues = results.length - nScreens;
  console.log(
    failed === 0
      ? `all ${nScreens} static screens render live data (${nValues} value assertions pass)`
      : `${failed} static screen(s) failed`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(2);
});
