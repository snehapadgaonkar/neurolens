"use client";

import Link from "next/link";
import { BarChart, Histogram } from "@/components/charts";
import {
  Button,
  Callout,
  Card,
  Chip,
  Code,
  KeyValue,
  Metric,
  MetricGrid,
  PageHeader,
  Panel,
  SubgroupStatus,
} from "@/components/ui";
import { fmt, fmtCi, fmtInt, fmtPct, humanLabel, shortHash } from "@/lib/format";
import { useStore } from "@/lib/store";

export default function OverviewPage() {
  const { report } = useStore();
  if (!report) return null;

  const { cohort, tasks, trust, fairness, explainability, release_readiness } = report;
  const continuous = tasks.continuous;
  const stage = tasks.stage;
  const metrics = continuous.metrics ?? {};
  const intervals = continuous.intervals ?? {};
  const ood = trust.ood;
  const cw = trust.confident_and_wrong;

  // Ordered per DESIGN.md: reliability/OOD before any headline metric, so the
  // reader meets the caveats before the number.
  const worst = fairness.worst_group;
  const flaggedRows = fairness.rows.filter((row) => row.status === "WARN");
  const insufficient = fairness.rows.filter((row) => row.status === "INSUFFICIENT DATA");

  const coverageGap =
    intervals.picp !== undefined && intervals.target_coverage !== undefined
      ? intervals.picp - intervals.target_coverage
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="What this run shows, and how far to trust it"
        lede={report.research_question}
        actions={
          <>
            <Link href="/reliability">
              <Button>Reliability</Button>
            </Link>
            <Link href="/cases">
              <Button variant="primary">Open a case</Button>
            </Link>
          </>
        }
      />

      {/* 1. Reliability and OOD — before the headline number */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-ink-200 px-4 py-3 sm:px-5">
            <h2 className="text-h3">Read this before the metrics</h2>
            <p className="mt-1 text-body-sm text-ink-600">
              Whether the stated uncertainty can be acted on, and whether the model notices when a
              patient is unlike its training data.
            </p>
          </div>
          <div className="grid gap-x-6 gap-y-5 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
            <Metric
              label="Uncertainty vs error"
              value={fmt(trust.uncertainty_error.spearman, 2)}
              sublabel={trust.uncertainty_error.verdict}
              tone={Math.abs(trust.uncertainty_error.spearman) >= 0.3 ? "affirm" : "warn"}
              hint="Spearman rank correlation between stated uncertainty and realised absolute error"
            />
            <Metric
              label="OOD separation"
              value={ood.auroc_shift_detection === null ? "n/a" : fmt(ood.auroc_shift_detection, 2)}
              sublabel={`${fmtInt(ood.n_flagged_shift)} of ${fmtInt(ood.n)} held-out cases flagged`}
              tone={
                ood.auroc_shift_detection === null
                  ? "insufficient"
                  : ood.auroc_shift_detection >= 0.7
                    ? "affirm"
                    : "warn"
              }
            />
            <Metric
              label="Confident and wrong"
              value={`${cw.n} of ${cw.n_total}`}
              sublabel={fmtPct(cw.rate)}
              tone={cw.rate > 0.05 ? "risk" : "warn"}
              hint={cw.definition}
            />
          </div>
          <div className="border-t border-ink-200 px-4 py-3 sm:px-5">
            <Callout
              tone={Math.abs(trust.uncertainty_error.spearman) >= 0.3 ? "info" : "warn"}
              title={trust.uncertainty_error.verdict}
            >
              Stated uncertainty and realised error correlate at ρ ={" "}
              {fmt(trust.uncertainty_error.spearman, 3)} (p ={" "}
              {fmt(trust.uncertainty_error.p_value, 3)}, n = {fmtInt(trust.uncertainty_error.n)}).
              {Math.abs(trust.uncertainty_error.spearman) >= 0.3
                ? " The intervals are informative enough to support abstention."
                : " Interval width should not be used to decide which predictions to withhold."}
            </Callout>
          </div>
        </Card>

        <Panel
          title="Where it fails"
          description="Subgroup error across the predeclared fairness axes."
        >
          <MetricGrid columns={2}>
            <Metric
              label="Worst group"
              value={worst.worst_group ? humanLabel(worst.worst_group) : "—"}
              sublabel={
                worst.worst_axis
                  ? `${humanLabel(worst.worst_axis)} · n=${fmtInt(worst.worst_n ?? 0)}`
                  : "no reportable subgroup"
              }
              size="sm"
              tone={worst.worst_group ? "warn" : "insufficient"}
            />
            <Metric
              label="Spread"
              value={worst.relative_spread === null ? "—" : fmtPct(worst.relative_spread, 0)}
              sublabel={`worst vs best ${humanLabel(worst.best_group ?? "")}`}
              size="sm"
            />
          </MetricGrid>
          <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-ink-200 pt-4">
            <div>
              <dt className="text-label text-ink-500">Warn</dt>
              <dd className="mt-1 text-metric-sm text-warn-700">{fmtInt(worst.n_warn)}</dd>
            </div>
            <div>
              <dt className="text-label text-ink-500">Pass</dt>
              <dd className="mt-1 text-metric-sm text-affirm-700">
                {fmtInt(worst.n_reportable - worst.n_warn)}
              </dd>
            </div>
            <div>
              <dt className="text-label text-ink-500">Insufficient</dt>
              <dd className="mt-1 text-metric-sm text-insufficient-700">
                {fmtInt(worst.n_insufficient)}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/fairness">
              <Button>Full fairness audit</Button>
            </Link>
            <Link href="/mitigation">
              <Button>Mitigation comparison</Button>
            </Link>
          </div>
        </Panel>
      </div>

      {/* 2. Prediction and metric */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Continuous progression"
          description={
            <>
              {cohort.target_definition.units} · model <Code>{continuous.model ?? "—"}</Code>
            </>
          }
        >
          <MetricGrid columns={2}>
            <Metric
              label="MAE"
              value={fmt(metrics.mae)}
              unit={cohort.target_definition.annualized ? "per year" : undefined}
              sublabel={`95% CI ${fmtCi(metrics.mae_ci)}`}
            />
            <Metric label="R²" value={fmt(metrics.r2, 2)} sublabel={`RMSE ${fmt(metrics.rmse)}`} />
            <Metric label="Bias" value={fmt(metrics.bias)} sublabel="mean prediction − truth" />
            <Metric label="Test n" value={fmtInt(metrics.n)} sublabel="held-out patients" />
          </MetricGrid>
        </Panel>

        <Panel
          title="Disease stage"
          description={
            <>
              {stage.classes.length} of {cohort.target_definition.stage_labels.length} predeclared
              bands present · model <Code>{stage.model ?? "—"}</Code>
            </>
          }
        >
          <MetricGrid columns={2}>
            <Metric label="Macro-F1" value={fmt(stage.metrics.macro_f1, 3)} />
            <Metric
              label="Accuracy"
              value={fmt(stage.metrics.accuracy, 3)}
              tone="warn"
              sublabel={
                stage.outcome_distribution.majority_class_accuracy !== undefined
                  ? `majority-class floor ${fmt(stage.outcome_distribution.majority_class_accuracy, 3)}`
                  : undefined
              }
            />
            <Metric
              label="Balanced accuracy"
              value={fmt(stage.metrics.balanced_accuracy, 3)}
              sublabel="the number to read here"
            />
            <Metric label="AUROC (OvR)" value={fmt(stage.metrics.auroc_ovr_macro, 3)} />
          </MetricGrid>
          {stage.outcome_distribution.verdict && (
            <div className="mt-4">
              <Chip
                tone={
                  stage.outcome_distribution.verdict === "severely imbalanced" ? "warn" : "neutral"
                }
              >
                {stage.outcome_distribution.verdict}
              </Chip>
              <p className="mt-2 text-body-sm text-ink-600">
                {Object.entries(stage.outcome_distribution.counts ?? {})
                  .map(([label, count]) => `${humanLabel(label)} ${fmtInt(count as number)}`)
                  .join(" · ")}
              </p>
            </div>
          )}
        </Panel>
      </div>

      {stage.notes.length > 0 && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {stage.notes.map((note) => (
            <Callout key={note} tone="warn" title="Reading the stage result">
              {note}
            </Callout>
          ))}
        </div>
      )}

      {/* 3. Interval and CI */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-ink-200 px-4 py-3 sm:px-5">
            <h2 className="text-h3">Prediction intervals</h2>
            <p className="mt-1 text-body-sm text-ink-600">
              Split conformal intervals at {fmtPct(1 - (continuous.alpha ?? 0.1), 0)} nominal
              coverage, calibrated on the validation split only.
            </p>
          </div>
          <div className="grid gap-x-6 gap-y-5 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
            <Metric
              label="Coverage (PICP)"
              value={fmtPct(intervals.picp, 1)}
              sublabel={`nominal ${fmtPct(intervals.target_coverage, 0)}`}
              tone={
                coverageGap === null
                  ? "insufficient"
                  : coverageGap < -0.05
                    ? "risk"
                    : Math.abs(coverageGap) <= 0.05
                      ? "affirm"
                      : "warn"
              }
            />
            <Metric
              label="Mean width"
              value={fmt(intervals.mean_interval_width)}
              sublabel={`median ${fmt(intervals.median_interval_width)}`}
            />
            <Metric label="Winkler" value={fmt(intervals.winkler_score)} sublabel="lower is better" />
            <Metric
              label="Calibration slope"
              value={fmt(continuous.calibration_regression?.slope, 2)}
              sublabel={continuous.calibration_regression?.interpretation}
              tone={
                Math.abs((continuous.calibration_regression?.slope ?? 1) - 1) < 0.15
                  ? "affirm"
                  : "warn"
              }
            />
          </div>
          {coverageGap !== null && coverageGap < -0.05 && (
            <div className="border-t border-ink-200 px-4 py-3 sm:px-5">
              <Callout tone="risk" title="Coverage is below the nominal level">
                {fmtPct(intervals.picp, 1)} of held-out cases fell inside their interval against a{" "}
                {fmtPct(intervals.target_coverage, 0)} target. The intervals are too narrow for this
                cohort and should not be quoted as{" "}
                {fmtPct(intervals.target_coverage, 0)} intervals.
              </Callout>
            </div>
          )}
        </Card>

        <Panel title="Target distribution" description="Annualised outcome across the cohort.">
          <Histogram
            binCentres={cohort.target_histogram.bin_centres}
            series={[{ values: cohort.target_histogram.counts, label: "patients", fill: "#0f5f63" }]}
            xLabel={cohort.target_definition.units}
            summary={`Distribution of ${cohort.target_definition.units} across ${fmtInt(
              cohort.target_distribution.n,
            )} patients: mean ${fmt(cohort.target_distribution.mean)}, SD ${fmt(
              cohort.target_distribution.sd,
            )}, range ${fmt(cohort.target_distribution.min)} to ${fmt(cohort.target_distribution.max)}.`}
            height={180}
          />
        </Panel>
      </div>

      {/* 4. Explanation */}
      <div className="mt-4">
        <Panel
          title="What drives the predictions"
          description="Permutation importance on the test split. These describe model association, not biological causation."
          actions={
            <Link href="/explanations">
              <Button>Explanations</Button>
            </Link>
          }
        >
          <BarChart
            data={explainability.global_importance.slice(0, 8).map((item) => ({
              label: item.label,
              value: item.importance,
              low: item.importance - item.importance_sd,
              high: item.importance + item.importance_sd,
              tone: item.family === "mri" ? "primary" : item.family === "clinical" ? "affirm" : "insufficient",
            }))}
            unit={` Δ${explainability.global_importance[0]?.metric ?? "metric"}`}
            summary={`Top features by permutation importance: ${explainability.global_importance
              .slice(0, 5)
              .map((item) => `${item.label} ${fmt(item.importance, 4)}`)
              .join(", ")}. Importance is the increase in ${
                explainability.global_importance[0]?.metric ?? "error"
              } when the feature is shuffled.`}
          />
          <p className="mt-3 text-body-sm text-ink-600">{explainability.causation_notice}</p>
        </Panel>
      </div>

      {/* 5. Provenance */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Cohort provenance">
          <KeyValue
            items={[
              { label: "Dataset", value: cohort.dataset_title },
              {
                label: "Access",
                value: (
                  <Chip
                    tone={cohort.dataset_access === "open" ? "affirm" : "warn"}
                    icon={false}
                  >
                    {cohort.dataset_access}
                  </Chip>
                ),
              },
              { label: "Licence", value: cohort.dataset_license },
              {
                label: "Cohort",
                value: `${fmtInt(cohort.n_analysed)} analysed of ${fmtInt(cohort.n_indexed)} indexed (${fmtInt(
                  cohort.n_excluded,
                )} excluded, every one logged)`,
              },
              { label: "Split", value: <Code>{shortHash(cohort.split.split_hash, 16)}</Code>, mono: true },
              {
                label: "Leakage-free",
                value: (
                  <Chip tone={cohort.split.leakage_free ? "affirm" : "risk"}>
                    {cohort.split.leakage_free ? "yes — patient-level" : "no"}
                  </Chip>
                ),
              },
              { label: "Citation", value: cohort.dataset_citation, span: true },
            ]}
          />
        </Panel>

        <Panel
          title="Release readiness"
          description="Every check must pass before this run is quotable."
          actions={
            <Link href="/release">
              <Button>Audit report</Button>
            </Link>
          }
        >
          <div className="flex items-center gap-3">
            <Chip tone={release_readiness.release_ready ? "affirm" : "risk"}>
              {release_readiness.release_ready ? "RELEASE READY" : "BLOCKED"}
            </Chip>
            <span className="text-body-sm text-ink-600">
              {Object.values(release_readiness.checks).filter(Boolean).length} of{" "}
              {Object.keys(release_readiness.checks).length} checks passed
            </span>
          </div>
          {release_readiness.blockers.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-body-sm text-risk-700">
              {release_readiness.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {Object.entries(release_readiness.checks).map(([name, passed]) => (
              <li key={name} className="flex items-start gap-2 text-body-sm">
                <Chip tone={passed ? "affirm" : "risk"} icon={false} className="px-1.5 py-0">
                  {passed ? "✓" : "✕"}
                </Chip>
                <span className="text-ink-700">{humanLabel(name)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* 6. Limitations up front */}
      <div className="mt-4">
        <Panel title="Limitations" description="Generated from what actually happened in this run.">
          <ul className="space-y-2">
            {report.limitations.map((item) => (
              <li key={item} className="flex gap-2.5 text-body text-ink-700">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {flaggedRows.length > 0 && (
        <div className="mt-4">
          <Panel
            title="Flagged subgroups"
            description="Adverse gaps only. A favourable gap is reported but never flagged as a disparity."
          >
            <ul className="space-y-2.5">
              {flaggedRows.slice(0, 6).map((row) => (
                <li
                  key={`${row.axis}-${row.subgroup}`}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-2.5 last:border-0 last:pb-0"
                >
                  <span className="text-body text-ink-900">
                    {humanLabel(row.subgroup)}
                    <span className="text-ink-500"> · {humanLabel(row.axis)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="mono text-body-sm text-ink-600">
                      gap {fmt(row.gap)} · {fmtPct(row.relative_gap, 0)}
                    </span>
                    <SubgroupStatus status={row.status} n={row.n} adequacy={row.adequacy} />
                  </span>
                </li>
              ))}
            </ul>
            {insufficient.length > 0 && (
              <p className="mt-3 text-body-sm text-ink-600">
                {insufficient.length} further subgroup cells carry no estimate at all — they are
                below the predeclared reportable minimum, and absence of a disparity signal there is
                not evidence of fairness.
              </p>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
