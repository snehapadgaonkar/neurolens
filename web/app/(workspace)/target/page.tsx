"use client";

import { Histogram } from "@/components/charts";
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
import { fmt, fmtInt, humanLabel } from "@/lib/format";
import { useStore } from "@/lib/store";

export default function TargetPage() {
  const { report } = useStore();
  if (!report) return null;
  const { cohort } = report;
  const definition = cohort.target_definition;
  const distribution = cohort.target_distribution;

  return (
    <>
      <PageHeader
        eyebrow="Build"
        title="Target definition"
        lede="The outcome is frozen before any model sees the data. Features come only from the index session; the target comes only from a later session."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Continuous outcome" className="lg:col-span-2">
          <KeyValue
            items={[
              { label: "Measure", value: humanLabel(definition.outcome_measure) },
              {
                label: "Window",
                value: `${definition.index_session} → ${definition.outcome_session}`,
              },
              {
                label: "Annualised",
                value: (
                  <Chip tone={definition.annualized ? "affirm" : "neutral"} icon={false}>
                    {definition.annualized ? "yes" : "no"}
                  </Chip>
                ),
              },
              { label: "Sign convention", value: humanLabel(definition.sign_convention) },
              { label: "Units", value: definition.units, span: true },
              { label: "Definition version", value: definition.version, mono: true },
            ]}
          />
          <div className="mt-4 border-t border-ink-200 pt-4">
            <p className="text-body-sm text-ink-600">
              A positive value means <strong>worsening</strong> under the{" "}
              <Code>{definition.sign_convention}</Code> convention. The sign is fixed here so that a
              larger number always means faster progression, in every table and figure downstream.
            </p>
          </div>
        </Panel>

        <Panel title="Distribution">
          <MetricGrid columns={2}>
            <Metric label="n" value={fmtInt(distribution.n)} size="sm" />
            <Metric label="Mean" value={fmt(distribution.mean)} size="sm" />
            <Metric label="SD" value={fmt(distribution.sd)} size="sm" />
            <Metric
              label="Range"
              value={`${fmt(distribution.min, 2)} – ${fmt(distribution.max, 2)}`}
              size="sm"
            />
          </MetricGrid>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Outcome histogram"
          description={`Annualised ${humanLabel(definition.outcome_measure)} change across the analysed cohort.`}
        >
          <Histogram
            binCentres={cohort.target_histogram.bin_centres}
            series={[{ values: cohort.target_histogram.counts, label: "patients", fill: "#0f5f63" }]}
            xLabel={definition.units}
            summary={`Histogram of ${definition.units} over ${fmtInt(
              distribution.n,
            )} patients, bin width ${fmt(
              cohort.target_histogram.bin_width,
              3,
            )}. Mean ${fmt(distribution.mean)}, SD ${fmt(distribution.sd)}.`}
            height={240}
          />
        </Panel>

        <Panel
          title="Ordinal stage bands"
          description="Predeclared cutpoints, not fitted to the data — so they cannot be tuned on the test split."
        >
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="border-b border-ink-300">
                <th scope="col" className="py-2 text-left text-label text-ink-600">
                  Band
                </th>
                <th scope="col" className="py-2 text-left text-label text-ink-600">
                  Range
                </th>
                <th scope="col" className="py-2 text-right text-label text-ink-600">
                  Patients
                </th>
              </tr>
            </thead>
            <tbody>
              {definition.stage_bands.map((band) => (
                <tr key={band.label} className="border-b border-ink-100 last:border-0">
                  <td className="py-2 text-ink-900">{humanLabel(band.label)}</td>
                  <td className="mono py-2 text-body-sm text-ink-700">{band.range}</td>
                  <td className="py-2 text-right">
                    <span className="mono text-ink-900">
                      {fmtInt(cohort.stage_distribution[band.label] ?? 0)}
                    </span>
                    {(cohort.stage_distribution[band.label] ?? 0) === 0 && (
                      <Chip tone="insufficient" icon={false} className="ml-2">
                        absent
                      </Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 border-t border-ink-200 pt-3">
            <KeyValue
              columns={1}
              items={[
                { label: "Measure", value: humanLabel(definition.outcome_measure) },
                { label: "Definition", value: definition.stage_definition, mono: true },
                {
                  label: "Cutpoints",
                  value: definition.stage_cutpoints.map((cut) => fmt(cut, 0)).join(" / "),
                  mono: true,
                },
              ]}
            />
          </div>
        </Panel>
      </div>

      {definition.stage_bands.some((band) => (cohort.stage_distribution[band.label] ?? 0) === 0) && (
        <div className="mt-4">
          <Callout tone="warn" title="Not every predeclared band occurs in this cohort">
            At least one stage band has zero patients, so the stage task has fewer classes than the
            definition allows. With two classes the ordinal cumulative-link model reduces to plain
            binary logistic regression, and the ordinal-versus-multiclass comparison cannot be
            resolved by this run.
          </Callout>
        </div>
      )}

      <div className="mt-4">
        <Panel
          title="Shift cohort"
          description="The predeclared out-of-distribution definition, fixed before evaluation."
        >
          <KeyValue
            items={[
              {
                label: "Rule",
                value: (
                  <Code>
                    {cohort.shift_cohort.definition.column} {cohort.shift_cohort.definition.operator}{" "}
                    {cohort.shift_cohort.definition.value}
                  </Code>
                ),
              },
              {
                label: "Patients meeting the rule",
                value: `${fmtInt(cohort.shift_cohort.n)} of ${fmtInt(cohort.n_analysed)}`,
              },
            ]}
          />
          <p className="mt-3 text-body-sm text-ink-600">
            OOD detection is evaluated against this cohort on the held-out test split. The rule is
            declared in configuration so it cannot be chosen after seeing which patients the model
            gets wrong.
          </p>
        </Panel>
      </div>
    </>
  );
}
