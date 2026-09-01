"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AttributionChart } from "@/components/charts";
import {
  Button,
  Callout,
  Card,
  Chip,
  EmptyState,
  KeyValue,
  Metric,
  MetricGrid,
  PageHeader,
  Panel,
} from "@/components/ui";
import { fetchCase } from "@/lib/api";
import { fmt, fmtCi, fmtInt, fmtPct, humanLabel } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { CaseDetail } from "@/lib/types";

export default function CasePage() {
  const params = useParams<{ patientId: string }>();
  const patientId = decodeURIComponent(params.patientId ?? "");
  const { report } = useStore();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    setLoading(true);
    fetchCase(patientId)
      .then((response) => {
        if (cancelled) return;
        setDetail(response);
        setError(null);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite">
        <PageHeader eyebrow="Inspect" title={patientId} lede="Loading this case…" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <>
        <PageHeader
          eyebrow="Inspect"
          title={patientId}
          lede="This case could not be loaded."
          actions={
            <Link href="/cases">
              <Button>Back to cases</Button>
            </Link>
          }
        />
        <EmptyState title="Case not found">
          {error ??
            "No held-out prediction exists for this identifier. Only patients in the test split appear in the case explorer."}
        </EmptyState>
      </>
    );
  }

  const { prediction, explanation } = detail;
  const error_ = Math.abs(prediction.prediction - prediction.truth);
  const flagged = prediction.ood_score >= prediction.ood_threshold;
  const covered =
    prediction.truth >= prediction.interval[0] && prediction.truth <= prediction.interval[1];
  const stagePairs = (prediction.stage_classes ?? []).map((label, index) => ({
    label,
    probability: prediction.stage_probabilities?.[index] ?? 0,
  }));
  const topStage = stagePairs.reduce(
    (best, item) => (item.probability > best.probability ? item : best),
    stagePairs[0] ?? { label: "—", probability: 0 },
  );

  return (
    <>
      <PageHeader
        eyebrow="Inspect"
        title={patientId}
        lede="One held-out patient: what was predicted, how certain the model was, why, and what should not be concluded from it."
        actions={
          <Link href="/cases">
            <Button>Back to cases</Button>
          </Link>
        }
      />

      {/* Research-use warning first, then reliability, then the prediction */}
      <Callout tone="warn" title="Research use only">
        {detail.research_use_notice}
      </Callout>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-ink-200 px-4 py-3 sm:px-5">
            <h2 className="text-h3">Reliability first</h2>
            <p className="mt-1 text-body-sm text-ink-600">
              Read these before the prediction. They decide how much weight the number can carry.
            </p>
          </div>
          <div className="grid gap-x-6 gap-y-5 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
            <Metric
              label="OOD score"
              value={fmt(prediction.ood_score, 3)}
              sublabel={`threshold ${fmt(prediction.ood_threshold, 3)}`}
              tone={flagged ? "risk" : "affirm"}
            />
            <Metric
              label="Interval covers truth"
              value={covered ? "yes" : "no"}
              tone={covered ? "affirm" : "risk"}
              sublabel={fmtCi(prediction.interval, 2)}
            />
            <Metric
              label="Stated uncertainty"
              value={fmt(prediction.uncertainty)}
              sublabel={`width ${fmt(prediction.interval_width)}`}
            />
          </div>
          {flagged && (
            <div className="border-t border-ink-200 px-4 py-3 sm:px-5">
              <Callout tone="risk" title="This patient is outside the training distribution">
                Their feature values sit beyond the {fmtPct(0.95, 0)} training quantile used as the
                OOD threshold. The model has no basis for extrapolating here, and the run's own
                failure-mode list records that such predictions can be confidently wrong. Treat this
                prediction as advisory only.
              </Callout>
            </div>
          )}
        </Card>

        <Panel title="Prediction">
          <p className="text-label text-ink-500">Predicted progression</p>
          <p className="text-metric text-ink-950">{fmt(prediction.prediction)}</p>
          <p className="mt-0.5 text-body-sm text-ink-600">{detail.units}</p>
          <div className="mt-4 rounded-[6px] border border-ink-200 bg-paper-25 p-3">
            <p className="text-label text-ink-500">
              {fmt((1 - (report?.tasks.continuous.alpha ?? 0.1)) * 100, 0)} prediction interval
            </p>
            <p className="mono mt-1 text-body text-ink-900">{fmtCi(prediction.interval, 3)}</p>
            <div className="relative mt-3 h-2 rounded-full bg-ink-100">
              {(() => {
                const [low, high] = prediction.interval;
                const span = high - low || 1;
                const position = ((prediction.truth - low) / span) * 100;
                const inside = position >= 0 && position <= 100;
                return (
                  <>
                    <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-primary-100" />
                    <span
                      className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper"
                      style={{
                        left: `${Math.max(-4, Math.min(104, position))}%`,
                        background: inside ? "#1f6f4a" : "#97333c",
                      }}
                      role="img"
                      aria-label={`Observed value ${fmt(
                        prediction.truth,
                      )} falls ${inside ? "inside" : "outside"} the interval`}
                    />
                  </>
                );
              })()}
            </div>
            <p className="mt-2 text-body-sm text-ink-600">
              Observed <span className="mono">{fmt(prediction.truth)}</span> ·{" "}
              {covered ? "inside" : "outside"} the interval
            </p>
          </div>
          <dl className="mt-4 space-y-1.5 text-body-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Absolute error</dt>
              <dd className="mono text-ink-900">{fmt(error_)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Split</dt>
              <dd className="mono text-ink-900">{prediction.split}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      {stagePairs.length > 0 && (
        <div className="mt-4">
          <Panel title="Stage probabilities" description="Posterior over the predeclared ordinal bands.">
            <ul className="space-y-2">
              {stagePairs.map((item) => (
                <li key={item.label} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-body-sm text-ink-800">{humanLabel(item.label)}</span>
                  <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink-100">
                    <span
                      className="block h-full rounded-full bg-primary-700"
                      style={{ width: `${Math.min(100, item.probability * 100)}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right mono text-body-sm text-ink-900">
                    {fmtPct(item.probability, 1)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-body-sm text-ink-600">
              Most probable band: <strong>{humanLabel(topStage.label)}</strong> at{" "}
              {fmtPct(topStage.probability, 1)}.
            </p>
          </Panel>
        </div>
      )}

      <div className="mt-4">
        {explanation ? (
          <Panel
            title="Why the model predicted this"
            description={`KernelSHAP over ${fmtInt(explanation.n_coalitions)} feature coalitions with a ${fmtInt(
              explanation.n_background,
            )}-patient background sample.`}
            actions={
              <Chip tone="neutral" icon={false}>
                {explanation.explanation_version}
              </Chip>
            }
          >
            <Callout tone="warn" title={detail.causation_notice}>
              These attributions describe what the fitted model used for this patient. They are not
              evidence that any of these variables causes progression.
            </Callout>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
              <div className="min-w-0">
                <AttributionChart
                  contributions={explanation.contributions}
                  summary={`Attributions for ${patientId}: ${explanation.top
                    .slice(0, 5)
                    .map(
                      (item) =>
                        `${item.label} ${item.attribution >= 0 ? "+" : "−"}${fmt(Math.abs(item.attribution), 3)} (${item.direction})`,
                    )
                    .join("; ")}.`}
                />
              </div>
              <div className="min-w-0">
                <KeyValue
                  columns={1}
                  items={[
                    { label: "Base value", value: <span className="mono">{fmt(explanation.base_value)}</span> },
                    {
                      label: "Σ attributions",
                      value: <span className="mono">{fmt(explanation.sum_of_attributions)}</span>,
                    },
                    { label: "Prediction", value: <span className="mono">{fmt(explanation.prediction)}</span> },
                    { label: "Residual", value: <span className="mono">{fmt(explanation.residual, 8)}</span> },
                  ]}
                />
                <p className="mt-3 text-body-sm text-ink-600">
                  Attributions plus the base value reconstruct the prediction to within{" "}
                  {fmt(explanation.residual, 8)} — the efficiency identity, shown rather than
                  asserted.
                </p>
              </div>
            </div>
            <div className="mt-4 border-t border-ink-200 pt-4">
              <table className="w-full border-collapse text-body">
                <thead>
                  <tr className="border-b border-ink-300">
                    <th scope="col" className="py-2 text-left text-label text-ink-600">Feature</th>
                    <th scope="col" className="py-2 text-left text-label text-ink-600">Family</th>
                    <th scope="col" className="py-2 text-right text-label text-ink-600">Value</th>
                    <th scope="col" className="py-2 text-right text-label text-ink-600">Attribution</th>
                    <th scope="col" className="py-2 text-left text-label text-ink-600">Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {explanation.contributions.map((item) => (
                    <tr key={item.feature} className="border-b border-ink-100 last:border-0">
                      <td className="py-2 text-ink-900">{item.label}</td>
                      <td className="py-2">
                        <Chip tone="neutral" icon={false}>
                          {humanLabel(item.family)}
                        </Chip>
                      </td>
                      <td className="mono py-2 text-right text-ink-800">{fmt(item.value, 3)}</td>
                      <td className="mono py-2 text-right text-ink-900">
                        {item.attribution >= 0 ? "+" : "−"}
                        {fmt(Math.abs(item.attribution), 4)}
                      </td>
                      <td className="py-2 text-body-sm text-ink-600">{item.direction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : (
          <Panel title="Why the model predicted this">
            <EmptyState title="No explanation available for this patient">
              Explanations are computed for a predeclared set of representative cases — highest
              uncertainty, largest error, most accurate, and OOD-flagged — rather than for every
              patient.
            </EmptyState>
          </Panel>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Subgroup context" description="Where this patient sits in the fairness audit.">
          {detail.subgroup_context.length ? (
            <ul className="space-y-2">
              {detail.subgroup_context.map((item) => (
                <li key={`${item.axis}-${item.level}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body text-ink-900">
                    {humanLabel(item.level)}
                    <span className="text-ink-500"> · {humanLabel(item.axis)}</span>
                  </span>
                  <span className="mono text-body-sm text-ink-600">n={fmtInt(item.n)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-sm text-ink-600">
              No subgroup membership was recorded for this patient on the audited axes.
            </p>
          )}
          <p className="mt-3 text-body-sm text-ink-600">
            A subgroup's average error is not this patient's error. It tells you how the model has
            behaved for patients like them, which is the honest limit of what subgroup analysis can
            say about an individual.
          </p>
        </Panel>

        <Panel title="What not to conclude">
          <ul className="space-y-2 text-body text-ink-700">
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn-700" />
              This is not a prognosis. It is one model's estimate for one patient in a research
              cohort.
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn-700" />
              The attributions are not a mechanism. They say what the model used, not what causes
              progression.
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn-700" />
              The interval's guarantee holds on average across this cohort under exchangeability — not
              for this individual.
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn-700" />
              Nothing here supports a diagnosis, staging decision, or treatment choice.
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
