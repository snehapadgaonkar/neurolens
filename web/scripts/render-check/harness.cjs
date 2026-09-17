/**
 * Shared bootstrap for the jsdom render probes.
 *
 * Every probe needs the same thing: a jsdom document, the browser globals the
 * components touch, a fetch that resolves relative URLs against the origin
 * (Node's global fetch cannot), and a shim for next/navigation so page
 * components can be mounted outside Next.
 *
 * This used to be copy-pasted into each script with small drift between copies
 * -- one omitted cancelAnimationFrame, another hardcoded the origin instead of
 * reading NEUROLENS_ORIGIN. Keeping it here means a probe cannot quietly diverge.
 */
const path = require("path");
const { JSDOM } = require("jsdom");

const WEB = path.resolve(__dirname, "..", "..");

/** The running Next.js dev server every probe talks to. */
const ORIGIN = process.env.NEUROLENS_ORIGIN || "http://127.0.0.1:3000";

const NAV_SHIM = path.join(WEB, "scripts/render-check/nav-shim.js");
const LINK_SHIM = path.join(WEB, "scripts/render-check/link-shim.js");

/**
 * Stand up a jsdom document and install the globals React and the components
 * expect. Returns the dom so a probe can inspect it directly if it needs to.
 */
const setupDom = () => {
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

  return dom;
};

/**
 * Node's global fetch rejects relative URLs such as "/api/report". Wrap it so
 * probes can write the same relative paths the browser uses.
 *
 * `policy`, when set, is consulted first with the absolute URL and may return
 * `{ status, body }` to stub a response. The failure-state assertions need this
 * because those hooks only exist in an error render.
 *
 * Returns the original fetch, because several probes also need to call the API
 * directly and compare.
 */
const setupFetch = (policy) => {
  const nodeFetch = global.fetch;
  global.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const absolute = url.startsWith("http") ? url : ORIGIN + url;
    const override = policy ? policy(absolute) : null;
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
    return nodeFetch(absolute, init);
  };
  return nodeFetch;
};

/**
 * Drive the event loop inside act() until the rendered text stops changing.
 *
 * Must be emitted INTO the generated entry source: it calls act() from the same
 * React copy the bundle uses. A length threshold here would reintroduce the
 * flakiness this replaced -- RunSwitcher renders nothing while it has one run
 * and no report, so "long enough" and "done" are not the same thing.
 */
const SETTLE_SOURCE = `
async function settle(host) {
  let previous = "";
  let stable = 0;
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const now = host.textContent || "";
    if (now === previous && now.length > 0) {
      stable += 1;
      if (stable >= 3) break;
    } else stable = 0;
    previous = now;
  }
}
`;

module.exports = { WEB, ORIGIN, NAV_SHIM, LINK_SHIM, setupDom, setupFetch, SETTLE_SOURCE };
