/**
 * Mounts the REAL page components against the live evidence API.
 *
 * This is not a re-implementation of the screens: it imports the same modules
 * the router renders, puts them inside the same <StoreProvider>, and lets the
 * real `fetch` run. If a screen reads a field the API does not send, the render
 * throws here exactly as it would in a browser.
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { createElement, StrictMode, type ReactElement } from "react";
import { StoreProvider } from "@/lib/store";

import Overview from "@/app/(workspace)/page";
import Cohort from "@/app/(workspace)/cohort/page";
import Target from "@/app/(workspace)/target/page";
import Splits from "@/app/(workspace)/splits/page";
import Data from "@/app/(workspace)/data/page";
import Models from "@/app/(workspace)/models/page";
import Reliability from "@/app/(workspace)/reliability/page";
import Fairness from "@/app/(workspace)/fairness/page";
import Mitigation from "@/app/(workspace)/mitigation/page";
import Explanations from "@/app/(workspace)/explanations/page";
import Cases from "@/app/(workspace)/cases/page";
import Release from "@/app/(workspace)/release/page";
import Glossary from "@/app/(workspace)/glossary/page";

// Pages return null while the store is still loading, so the map allows it.
export const PAGES: Record<string, () => ReactElement | null> = {
  overview: Overview,
  cohort: Cohort,
  target: Target,
  splits: Splits,
  data: Data,
  models: Models,
  reliability: Reliability,
  fairness: Fairness,
  mitigation: Mitigation,
  explanations: Explanations,
  cases: Cases,
  release: Release,
  glossary: Glossary,
};

let root: Root | null = null;

/**
 * Pump the event loop until the rendered text stops changing.
 *
 * Length thresholds are unreliable here: several screens render a substantial
 * skeleton before their fetch resolves, so the harness would read the skeleton
 * and report the screen as thin or missing data.
 */
async function settle(host: HTMLElement, maxTicks = 60): Promise<string> {
  let previous = "";
  let stable = 0;
  for (let i = 0; i < maxTicks; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const current = host.textContent ?? "";
    if (current === previous && current.length > 0) {
      stable += 1;
      if (stable >= 3) break;
    } else {
      stable = 0;
    }
    previous = current;
  }
  return previous;
}

export async function mount(name: string): Promise<string> {
  const Page = PAGES[name];
  if (!Page) throw new Error(`unknown page ${name}`);

  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(
      createElement(StrictMode, null, createElement(StoreProvider, null, createElement(Page))),
    );
  });

  // Let the real fetch + state updates settle. Wait for the text to stop
  // changing rather than passing a length threshold: a screen can render a
  // full skeleton that is already long before its data arrives.
  const text = await settle(host);
  root.unmount();
  host.remove();
  root = null;
  return text;
}

export async function mountCaseDetail(patientId: string): Promise<string> {
  const mod = await import("@/app/(workspace)/cases/[patientId]/page");
  const Page = mod.default;
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(
      createElement(StrictMode, null, createElement(StoreProvider, null, createElement(Page))),
    );
  });
  const text = await settle(host);
  root.unmount();
  host.remove();
  root = null;
  return text;
}
