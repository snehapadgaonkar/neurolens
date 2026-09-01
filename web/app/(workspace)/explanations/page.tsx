"use client";

import { AttributionChart, BarChart } from "@/components/charts";
import {
  Callout,
  Chip,
  Code,
  KeyValue,
  Metric,
  MetricGrid,
  PageHeader,
  Panel,
} from "@/components/ui";
import { fmt, fmtCi, fmtInt, humanLabel } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ExplanationCase } from "@/lib/types";

const REASON_LABEL: Record<string, string> = {
  highest_uncertainty: "Highest stated uncertainty",
  largest_error: "Largest realised error",
  most_accurate: "Most accurate prediction",
  ood_flagged: "Flagged out-of-distribution",
};

function CaseCard({ explanation }: { explanation: ExplanationCase }) {
  const families = Object.entries(explanation.share_of_absolute_attribution);
  return (
    <div className="border-b border-ink-200 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="mono text-body text-ink-950">{explanation.patient_id}</p>
          <p className="mt-0.5 text-body-sm text-ink-600">
            {REASON_LABEL[explanation.selection_reason] ?? humanLabel(explanation.selection_reason)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-body-sm">
          <span className="mono text-ink-800">
            predicted {fmt(explanation.prediction)} · truth {fmt(explanation.truth)}
          </span>
          <span className="mono text-ink-600">
            interval {fmtCi(explanation.interval, 2)}
          </span>
          <a
            href={`/cases/${encodeURIComponent(explanation.patient_id)}`}
            className="text-primary-700 underline"
          >
            Open case
          </a>
        </div>
      </div>
      <div className="grid gap-4 px-4 pb-4 sm:px-5 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          <AttributionChart
            contributions={explanation.contributions}
            summary={`Patient ${explanation.patient_id}: top attributions are ${explanation.top
              .slice(0, 4)
              .map((item) => `${item.label} ${item.attribution >= 0 ? "+" : "−"}${fmt(Math.abs(item.attribution), 3)}`)
              .join(", ")}. Attributions sum to ${fmt(
              explanation.sum_of_attributions,
            )} plus base ${fmt(explanation.base_value)}, reconstructing the prediction ${fmt(
              explanation.prediction,
            )} to within ${fmt(explanation.residual, 8)}.`}
          />
        </div>
        <div className="min-w-0">
          <p className="text-label text-ink-500">Reconstruction</p>
          <KeyValue
            columns={1}
            items={[
              { label: "Base value", value: <span className="mono">{fmt(explanation.base_value)}</span> },
              { label: "Σ attributions", value: <span className="mono">{fmt(explanation.sum_of_attributions)}</span> },
              { label: "Prediction", value: <span className="mono">{fmt(explanation.prediction)}</span> },
              { label: "Residual", value: <span className="mono">{fmt(explanation.residual, 8)}</span> },
              { label: "Coalitions", value: fmtInt(explanation.n_coalitions) },
              { label: "Background", value: `${fmtInt(explanation.n_background)} patients` },
            ]}
          />
          <p className="mt-3 text-label text-ink-500">Share of attribution</p>
          <ul className="mt-1.5 space-y-1">
            {families.map(([family, share]) => (
              <li key={family} className="flex items-center justify-between gap-2 text-body-sm">
                <span className="text-ink-800">{humanLabel(family)}</span>
                <span className="mono text-ink-700">{fmt(share * 100, 1)}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function ExplanationsPage() {
  const { report } = useStore();
  if (!report) return null;
  const { explainability } = report;

  return (
    <>
      <PageHeader
        eyebrow="Inspect"
        title="Explanations"
        lede="What the fitted model used — globally, and for individual patients whose predictions are worth examining."
      />

      <Callout tone="warn" title={explainability.causation_notice}>
        These attributions describe the fitted model. They are not evidence that any variable causes
        disease progression, and they cannot be read as a biological mechanism.
      </Callout>

      <div className="mt-4">
        <Panel
          title="Global feature importance"
          description={explainability.method.global}
          footer="Importance is the increase in error when a feature is shuffled. Bars show ±1 SD across repeats. Features are coloured by family, not by importance."
        >
          <BarChart
            data={explainability.global_importance.map((item) => ({
              label: item.label,
              value: item.importance,
              low: item.importance - item.importance_sd,
              high: item.importance + item.importance_sd,
              tone:
                item.family === "mri"
                  ? "primary"
                  : item.family === "clinical"
                    ? "affirm"
                    : item.family === "genetics"
                      ? "warn"
                      : "insufficient",
              annotation: fmt(item.importance, 4),
            }))}
            summary={`Global permutation importance (${
              explainability.global_importance[0]?.metric ?? "error"
            }): ${explainability.global_importance
              .map((item) => `${item.label} ${fmt(item.importance, 4)}`)
              .join(", ")}.`}
          />
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-body-sm">
            {[
              { label: "MRI", colour: "#0f5f63" },
              { label: "Clinical", colour: "#1f6f4a" },
              { label: "Genetic", colour: "#8a5300" },
              { label: "Demographic", colour: "#4e5a63" },
            ].map((entry) => (
              <span key={entry.label} className="flex items-center gap-1.5 text-ink-700">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ background: entry.colour }}
                />
                {entry.label}
              </span>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Method"
          description="Declared and versioned, so an explanation can be reproduced or audited later."
        >
          <KeyValue
            items={[
              { label: "Global", value: explainability.method.global },
              { label: "Local", value: explainability.method.local },
              { label: "Version", value: <Code>{explainability.method.version}</Code> },
            ]}
          />
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Representative cases"
          dense
          description="Selected by predeclared rules, not chosen to flatter the model. Each includes the case that was flagged out-of-distribution."
        >
          {explainability.cases.map((explanation) => (
            <CaseCard key={explanation.patient_id} explanation={explanation} />
          ))}
        </Panel>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Callout tone="info" title="Why the attributions sum exactly">
          KernelSHAP satisfies the efficiency identity: attributions plus the base value reconstruct
          the prediction. The residual is printed for every case so a reader can check it rather than
          take it on trust.
        </Callout>
        <Callout tone="warn" title="Attribution is not importance in the world">
          A large attribution means the model leaned on that feature for this patient. It says nothing
          about whether the feature is modifiable, causal, or clinically actionable.
        </Callout>
      </div>
    </>
  );
}
