/**
 * Regression check for the controlled-sort contract on DataTable.
 *
 * The case table used to pass a fixed `initialSort`, which DataTable read only
 * into useState on mount. The page's "Sort by" buttons therefore changed the
 * API request but never the visible row order -- and `aria-sort` kept reporting
 * the stale column. This renders the REAL component and asserts that a
 * controlled `sort` prop now drives both.
 */
const { JSDOM } = require("jsdom");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const WEB = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "_sort-entry.tsx");
const BUNDLE = path.join(__dirname, "_sort.cjs");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:3000/",
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

// The pages request relative URLs like /api/cases. Node's global fetch cannot
// resolve those, so rewrite them against the live origin the way the other
// render checks do.
const ORIGIN = process.env.NEUROLENS_ORIGIN || "http://127.0.0.1:3000";
const nodeFetch = global.fetch;
global.fetch = (input, init) =>
  nodeFetch(
    typeof input === "string" && !input.startsWith("http") ? ORIGIN + input : input,
    init,
  );

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

/** Wait until the rendered tree stops changing, rather than for a length. */
const settle = async (host, maxTicks = 60) => {
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
};

const SHIM_DIR = __dirname;
const navShim = path.join(SHIM_DIR, "nav-shim.js");
const linkShim = path.join(SHIM_DIR, "link-shim.js");

/**
 * Mount a REAL workspace page inside the real StoreProvider, against the live
 * API. Next.js hooks are shimmed the same way selector-check shims them.
 */
const mountRealPage = async (kind) => {
  const entry = path.join(SHIM_DIR, "_sort-page-entry.tsx");
  const bundle = path.join(SHIM_DIR, "_sort-page.cjs");
  fs.writeFileSync(
    entry,
    `import { createRoot } from "react-dom/client";\n` +
      `import { act } from "react";\n` +
      `import { createElement } from "react";\n` +
      `import { StoreProvider } from "@/lib/store";\n` +
      `import Cases from "@/app/(workspace)/cases/page";\n` +
      `export { StoreProvider };\n` +
      `export function Page() { return createElement(Cases); }\n`,
  );
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile: bundle,
    platform: "node",
    format: "cjs",
    target: "node20",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    absWorkingDir: WEB,
    alias: { "@": WEB, "next/navigation": navShim, "next/link": linkShim },
    external: ["react", "react-dom", "react-dom/client"],
    logLevel: "error",
  });

  const { Page, StoreProvider } = require(bundle);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(StoreProvider, null, React.createElement(Page)));
  });
  await settle(host);
  return { host, unmount: () => root.unmount() };
};

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        actual   ${JSON.stringify(actual)}`);
  }
};

fs.writeFileSync(
  OUT,
  `import { useState } from "react";
import { DataTable, type Column } from "@/components/table";

type Row = { patient_id: string; uncertainty: number; error: number } & Record<string, unknown>;

// Deliberately chosen so that no two columns ever produce the same ordering.
// An earlier fixture had ascending error coincidentally equal to ascending
// patient_id, which would have let a wrong sort key pass the check.
const ROWS: Row[] = [
  { patient_id: "sub-1", uncertainty: 0.9, error: 0.5 },
  { patient_id: "sub-2", uncertainty: 0.1, error: 0.9 },
  { patient_id: "sub-3", uncertainty: 0.5, error: 0.1 },
];

const columns: Column<Row>[] = [
  { key: "patient_id", label: "Patient", render: (r) => r.patient_id, sortable: true, sortValue: (r) => r.patient_id },
  { key: "uncertainty", label: "Uncertainty", render: (r) => r.uncertainty, sortable: true, sortValue: (r) => r.uncertainty },
  { key: "error", label: "Error", render: (r) => r.error, sortable: true, sortValue: (r) => r.error },
];

/** A parent that owns the sort, exactly like the cases page does. */
export function Harness() {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "uncertainty",
    direction: "desc",
  });
  return (
    <div>
      <button type="button" data-testid="parent-error" onClick={() => setSort({ key: "error", direction: "desc" })}>
        parent: error
      </button>
      <button type="button" data-testid="parent-flip" onClick={() => setSort((c) => ({ key: c.key, direction: c.direction === "asc" ? "desc" : "asc" }))}>
        parent: flip
      </button>
      <DataTable<Row>
        columns={columns}
        rows={ROWS}
        rowKey={(r) => r.patient_id}
        sort={sort}
        onSortChange={setSort}
      />
    </div>
  );
}

/** The pre-existing contract: initialSort only, table owns its own state. */
export function Uncontrolled() {
  return (
    <DataTable<Row>
      columns={columns}
      rows={ROWS}
      rowKey={(r) => r.patient_id}
      initialSort={{ key: "uncertainty", direction: "desc" }}
    />
  );
}
`,
);

(async () => {
  await esbuild.build({
    entryPoints: [OUT],
    bundle: true,
    outfile: BUNDLE,
    platform: "node",
    format: "cjs",
    target: "node20",
    jsx: "automatic",
    external: ["react", "react-dom", "react-dom/client"],
    absWorkingDir: WEB,
    alias: { "@": path.join(WEB) },
    logLevel: "error",
  });

  const { Harness } = require(BUNDLE);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(Harness));
  });

  const order = () =>
    [...host.querySelectorAll("tbody tr")].map((tr) => tr.firstElementChild.textContent.trim());
  const ariaSort = () =>
    [...host.querySelectorAll("thead th")].map((th) => th.getAttribute("aria-sort"));

  console.log("controlled DataTable sort:");

  // 1. The initial controlled sort drives the order.
  check("initial sort=uncertainty desc", order(), ["sub-1", "sub-3", "sub-2"]);
  check("initial aria-sort", ariaSort(), ["none", "descending", "none"]);

  // 2. THE BUG: changing the controlled prop must change the VISIBLE order.
  await act(async () => {
    host.querySelector('[data-testid="parent-error"]').dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
  check("parent change -> visible order follows", order(), ["sub-2", "sub-1", "sub-3"]);
  check("parent change -> aria-sort follows", ariaSort(), ["none", "none", "descending"]);

  // 3. Direction flips propagate too.
  await act(async () => {
    host.querySelector('[data-testid="parent-flip"]').dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
  // The flip button flips the direction of the CURRENT key, which is now
  // `error` -- not the `uncertainty` it started on. Ascending by error:
  // sub-3 (0.1), sub-1 (0.5), sub-2 (0.9).
  check("parent flip -> ascending order", order(), ["sub-3", "sub-1", "sub-2"]);
  check("parent flip -> aria-sort ascending", ariaSort(), ["none", "none", "ascending"]);

  // 4. A column-header click must go THROUGH the parent (onSortChange), not
  //    diverge into private state.
  await act(async () => {
    host.querySelector('[data-testid="sort-header-patient_id"]').dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
  check("header click -> onSortChange applied", order(), ["sub-1", "sub-2", "sub-3"]);
  check("header click -> aria-sort moves", ariaSort(), ["ascending", "none", "none"]);

  // 5. Uncontrolled mode (initialSort, no onSortChange) must still work, so the
  //    other 13 tables that use DataTable are unaffected.
  await act(async () => {
    root.unmount();
  });
  const host2 = document.createElement("div");
  document.body.appendChild(host2);
  const root2 = createRoot(host2);
  const Uncontrolled = require(BUNDLE).Uncontrolled;
  await act(async () => {
    root2.render(React.createElement(Uncontrolled));
  });
  const order2 = () =>
    [...host2.querySelectorAll("tbody tr")].map((tr) => tr.firstElementChild.textContent.trim());
  check("uncontrolled initialSort still honoured", order2(), ["sub-1", "sub-3", "sub-2"]);

  /* ------------------------------------------------- real page integration */
  // The assertions above exercise DataTable in isolation, but the defect lived
  // in the page's wiring -- a fixed initialSort plus a server that ignored
  // `sort`. So render the REAL /cases page against the live API and click its
  // real "Sort by Error" button.
  const { host: pageHost, unmount: unmountPage } = await mountRealPage("cases");
  const pageOrder = () =>
    [...pageHost.querySelectorAll("tbody tr")].map(
      (tr) => tr.firstElementChild && tr.firstElementChild.textContent.trim(),
    );

  const rowsBefore = pageOrder();
  if (rowsBefore.length < 2) {
    failures++;
    console.log(`  FAIL  real page rendered too few rows to check (${rowsBefore.length})`);
  } else {
    const button = pageHost.querySelector('[data-testid="sort-error"]');
    if (!button) {
      failures++;
      console.log("  FAIL  real page has no [data-testid=sort-error] control");
    } else {
      console.log("\nreal /cases page (live API):");
      await act(async () => {
        button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
      // The click triggers a refetch; wait for the tree to stop changing.
      await settle(pageHost);

      const rowsAfter = pageOrder();
      check(
        "clicking Sort by Error reorders the real table",
        rowsAfter.join(",") === rowsBefore.join(","),
        false,
      );

      // The |Error| column is the 5th cell; it must be descending.
      const errs = [...pageHost.querySelectorAll("tbody tr td:nth-child(5)")].map((td) =>
        parseFloat(td.textContent || ""),
      );
      const sorted = errs.every((value, i) => i === 0 || value <= errs[i - 1]);
      check("|Error| column is genuinely descending", sorted, true);

      const headerTh = pageHost.querySelector('[data-testid="sort-header-error"]');
      check(
        "aria-sort moves to the Error column",
        headerTh && headerTh.closest("th").getAttribute("aria-sort"),
        "descending",
      );
    }
  }
  // Flush any in-flight fetch-driven update before unmounting, otherwise React
  // reports "not wrapped in act" on the way out and the warning drowns the
  // result line. check:render treats React warnings as failures; so should this.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await act(async () => {
    unmountPage();
  });

  console.log(failures === 0 ? `\nall sort assertions pass` : `\n${failures} sort assertion(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
