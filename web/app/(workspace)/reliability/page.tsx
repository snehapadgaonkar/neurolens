"use client";

import { Histogram, RiskCoverageChart } from "@/components/charts";
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
import { fmt, fmtCi, fmtInt, fmtPct, humanLabel } from "@/lib/format";
import { useStore } from "@/lib/store";

export default function ReliabilityPage() {
  const { report } = useStore();
  if (!report) return null;
  const { trust, tasks } = report;
  const ood = trust.ood;
  const intervals = tasks.continuous.intervals ?? {};
  const calibration = tasks.continuous.calibration_regression ?? {};
  const cw = trust.confident_and_wrong;

  const coverageGap =
    intervals.picp !== undefined && intervals.target_coverage !== undefined
      ? intervals.picp - intervals.target_coverage
      : null;

  const comparisonRows = [
    {
      label: "Absolute error (MAE)",
      data: ood.absolute_error,
      better: "lower",
    },
    {
      label: "Stated uncertainty",
      data: ood.uncertainty,
      better: "lower",
    },
    {
      label: "Interval width",
      data: ood.interval_width,
      better: "narrower",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Evaluate"
        title="Reliability"
        lede="Whether the stated uncertainty can be acted on, and whether the model notices when a patient is unlike its training data. This is the screen to read before quoting any number."
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Panel title="Uncertainty vs realised error" className="lg:col-span-2">
          <Metric
            label="Spearman ρ"
            value={fmt(trust.uncertainty_error.spearman, 3)}
            sublabel={`p = ${fmt(trust.uncertainty_error.p_value, 3)} · n = ${fmtInt(trust.uncertainty_error.n)}`}
            tone={Math.abs(trust.uncertainty_error.spearman) >= 0.3 ? "affirm" : "warn"}
          />
          <div className="mt-3">
            <Callout
              tone={Math.abs(trust.uncertainty_error.spearman) >= 0.3 ? "info" : "warn"}
              title={trust.uncertainty_error.verdict}
            >
              {Math.abs(trust.uncertainty_error.spearman) >= 0.3
                ? "Wide intervals do mark the cases the model gets wrong, so abstention based on interval width is defensible."
                : "A wide interval does not mark the cases this model gets wrong. Do not use interval width to decide which predictions to withhold — it would discard cases at random."}
            </Callout>
          </div>
        </Panel>

        <Panel title="Confident and wrong">
          <Metric
            label="Cases"
            value={`${fmtInt(cw.n)} / ${fmtInt(cw.n_total)}`}
            sublabel={fmtPct(cw.rate)}
            tone={cw.rate > 0.05 ? "risk" : "warn"}
          />
          <p className="mt-2 text-body-sm text-ink-600">{cw.definition}</p>
          {cw.patient_ids.length > 0 && (
            <p className="mono mt-2 break-all text-[12px] text-ink-700">
              {cw.patient_ids.join(", ")}
            </p>
          )}
        </Panel>

        <Panel title="OOD separation">
          <Metric
            label="AUROC"
            value={ood.auroc_shift_detection === null ? "n/a" : fmt(ood.auroc_shift_detection, 3)}
            sublabel={`${fmtInt(ood.n_flagged_shift)} of ${fmtInt(ood.n)} flagged`}
            tone={
              ood.auroc_shift_detection === null
                ? "insufficient"
                : ood.auroc_shift_detection >= 0.7
                  ? "affirm"
                  : "warn"
            }
          />
          <p className="mt-2 text-body-sm text-ink-600">{ood.verdict}</p>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Do OOD cases actually do worse?"
          description="The predeclared shift cohort against in-distribution cases, on the held-out split."
        >
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="border-b border-ink-300">
                <th scope="col" className="py-2 text-left text-label text-ink-600">Measure</th>
                <th scope="col" className="py-2 text-right text-label text-ink-600">In distribution</th>
                <th scope="col" className="py-2 text-right text-label text-ink-600">Shift cohort</th>
                <th scope="col" className="py-2 text-right text-label text-ink-600">Difference (95% CI)</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label} className="border-b border-ink-100 last:border-0">
                  <td className="py-2.5 text-ink-900">{row.label}</td>
                  <td className="mono py-2.5 text-right text-ink-800">
                    {fmt(row.data.mean_in_distribution)}
                  </td>
                  <td className="mono py-2.5 text-right text-ink-800">{fmt(row.data.mean_shift)}</td>
                  <td className="py-2.5 text-right">
                    <span
                      className={`mono ${
                        row.data.difference_ci[0] > 0
                          ? "text-risk-700"
                          : "text-ink-600"
                      }`}
                    >
                      {fmt(row.data.difference)} {fmtCi(row.data.difference_ci, 2)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone={ood.absolute_error.shift_is_worse ? "warn" : "affirm"}>
              {ood.absolute_error.shift_is_worse
                ? "shift cases are less accurate"
                : "no accuracy penalty detected"}
            </Chip>
            <span className="text-body-sm text-ink-600">
              n = {fmtInt(ood.absolute_error.n_shift)} shift vs{" "}
              {fmtInt(ood.absolute_error.n_in_distribution)} in distribution
            </span>
          </div>
          {ood.absolute_error.difference_ci[0] <= 0 && (
            <p className="mt-2 text-body-sm text-ink-600">
              The confidence interval spans zero, so the observed difference is not statistically
              distinguishable from no difference at this sample size. That is not evidence that OOD
              cases are fine.
            </p>
          )}
        </Panel>

        <Panel
          title="OOD score distribution"
          description="Percentile rank against the training distribution, by cohort."
        >
          <Histogram
            binCentres={ood.score_histogram.bin_centres}
            series={[
              { values: ood.score_histogram.in_distribution, label: "in distribution", fill: "#0f5f63" },
              { values: ood.score_histogram.shift, label: "shift cohort", fill: "#97333c" },
            ]}
            xLabel="OOD score (training percentile)"
            summary={`OOD score distribution: in-distribution cases concentrate at low scores while shift-cohort cases spread higher. Threshold ${fmt(
              ood.threshold,
              3,
            )}; ${fmtInt(ood.n_flagged_shift)} of ${fmtInt(ood.n)} held-out cases exceed it.`}
            height={220}
          />
          <div className="mt-3 flex flex-wrap gap-4 text-body-sm">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-primary-700" aria-hidden="true" />
              in distribution ({fmtInt(ood.n_in_distribution)})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-risk-700" aria-hidden="true" />
              shift cohort ({fmtInt(ood.n_flagged_shift)})
            </span>
            <span className="mono text-ink-600">threshold {fmt(ood.threshold, 3)}</span>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Prediction intervals"
          description="Split conformal prediction, calibrated on the validation split only."
        >
          <MetricGrid columns={2}>
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
            <Metric label="Mean width" value={fmt(intervals.mean_interval_width)} />
            <Metric label="Median width" value={fmt(intervals.median_interval_width)} />
            <Metric label="Winkler score" value={fmt(intervals.winkler_score)} sublabel="lower is better" />
          </MetricGrid>
          {coverageGap !== null && coverageGap < -0.05 && (
            <div className="mt-3">
              <Callout tone="risk" title="Under-coverage">
                {fmtPct(intervals.picp, 1)} of held-out cases fell inside their interval against a{" "}
                {fmtPct(intervals.target_coverage, 0)} target. These intervals are too narrow for
                this cohort; quoting them as {fmtPct(intervals.target_coverage, 0)} intervals would
                overstate their guarantee.
              </Callout>
            </div>
          )}
          {coverageGap !== null && Math.abs(coverageGap) <= 0.05 && (
            <div className="mt-3">
              <Callout tone="affirm" title="Coverage is close to nominal">
                The finite-sample exchangeability assumption still has to hold for the guarantee to
                apply. A shift between calibration and deployment would invalidate it.
              </Callout>
            </div>
          )}
        </Panel>

        <Panel
          title="Calibration"
          description="Slope of the observed outcome regressed on the prediction. 1.0 is ideal."
        >
          <MetricGrid columns={2}>
            <Metric
              label="Slope"
              value={fmt(calibration.slope, 3)}
              tone={Math.abs((calibration.slope ?? 1) - 1) < 0.15 ? "affirm" : "warn"}
            />
            <Metric label="Intercept" value={fmt(calibration.intercept, 3)} />
          </MetricGrid>
          <p className="mt-3 text-body text-ink-700">{calibration.interpretation}</p>
          <p className="mt-2 text-body-sm text-ink-600">
            A slope below 1 means predictions are more extreme than outcomes; above 1 means they are
            shrunk toward the mean. Either way the model's spread does not match reality, and
            intervals built on it inherit the mismatch.
          </p>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Risk–coverage"
          description="What happens to error as the highest-uncertainty cases are abstained on."
          footer="A flat or rising curve means the uncertainty ranking carries no usable signal. This is the test that decides whether abstention is defensible."
        >
          <RiskCoverageChart
            curve={trust.risk_coverage.curve}
            maeFull={trust.risk_coverage.mae_full}
            summary={`Risk–coverage curve: MAE at no abstention ${fmt(
              trust.risk_coverage.mae_full,
            )}, at 50% abstention ${fmt(
              trust.risk_coverage.mae_at_50pct_abstention,
            )}, area under the curve ${fmt(trust.risk_coverage.aurc)}.`}
          />
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Metric label="MAE, no abstention" value={fmt(trust.risk_coverage.mae_full)} size="sm" />
            <Metric
              label="MAE at 50% abstention"
              value={fmt(trust.risk_coverage.mae_at_50pct_abstention)}
              size="sm"
              tone={
                trust.risk_coverage.mae_at_50pct_abstention > trust.risk_coverage.mae_full
                  ? "warn"
                  : "affirm"
              }
            />
            <Metric label="AURC" value={fmt(trust.risk_coverage.aurc)} size="sm" />
          </div>
          {trust.risk_coverage.mae_at_50pct_abstention > trust.risk_coverage.mae_full && (
            <div className="mt-3">
              <Callout tone="warn" title="Abstention makes error worse">
                Discarding the half of cases with the widest intervals <em>raises</em> mean absolute
                error from {fmt(trust.risk_coverage.mae_full)} to{" "}
                {fmt(trust.risk_coverage.mae_at_50pct_abstention)}. The uncertainty ranking is not
                aligned with error in this run, which is consistent with the correlation above.
              </Callout>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="How OOD is scored" description="Declared in configuration, not tuned on the test split.">
          <KeyValue
            items={[
              { label: "Method", value: <Code>{ood.method.method}</Code> },
              { label: "k for kNN", value: fmtInt(ood.method.knn_k) },
              {
                label: "Threshold",
                value: `${fmt(ood.method.threshold, 3)} (the ${fmtPct(ood.method.threshold_quantile, 0)} training quantile)`,
              },
              { label: "Fitted on", value: `${fmtInt(ood.method.n_train)} training patients` },
              { label: "Feature dimensions", value: fmtInt(ood.method.n_features) },
              { label: "Interpretation", value: ood.method.interpretation, span: true },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
