"use client";

import { useEffect, useState } from "react";
import { Callout, PageHeader, Panel } from "@/components/ui";
import { fetchGlossary } from "@/lib/api";
import type { GlossaryTerm } from "@/lib/types";

export default function GlossaryPage() {
  const [terms, setTerms] = useState<GlossaryTerm[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGlossary()
      .then((response) => setTerms(response.terms))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Release"
        title="Glossary"
        lede="What each term in this workspace means, in the sense NeuroLens uses it. Definitions are served by the API so the words in the UI always match the code that produced the numbers."
      />

      {error && (
        <Callout tone="risk" title="The glossary could not be loaded">
          {error}
        </Callout>
      )}

      {!terms && !error && <p className="text-body-sm text-ink-600">Loading glossary…</p>}

      {terms && (
        <div className="grid gap-4 lg:grid-cols-2">
          {terms.map((term) => (
            <Panel key={term.term} title={term.term}>
              <p className="text-body text-ink-700">{term.definition}</p>
            </Panel>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Panel title="Terms NeuroLens deliberately does not use">
          <ul className="space-y-2.5 text-body text-ink-700">
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-risk-700" />
              <span>
                <strong>Fairness score.</strong> There is no single number, because collapsing
                subgroup performance into one value hides exactly the cells that need attention.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-risk-700" />
              <span>
                <strong>Fair / unfair.</strong> A binary label cannot be defended at these sample
                sizes. The audit reports PASS, WARN, or INSUFFICIENT DATA with the evidence attached.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-risk-700" />
              <span>
                <strong>Causal effect, driver, or risk factor.</strong> Attributions describe what the
                fitted model used. Nothing in this workspace estimates a causal quantity.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-risk-700" />
              <span>
                <strong>Prognosis or risk of disease.</strong> NeuroLens models progression within a
                studied cohort. It does not diagnose, stage for care, or predict who will develop a
                disease.
              </span>
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
