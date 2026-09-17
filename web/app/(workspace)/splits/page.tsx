"use client";

import {
  Callout,
  Card,
  Chip,
  Code,
  KeyValue,
  Metric,
  MetricGrid,
  PageHeader,
  Panel,
  ProgressBar,
} from "@/components/ui";
import { fmtInt, fmtPct, shortHash } from "@/lib/format";
import { useStore } from "@/lib/store";

export default function SplitsPage() {
  const { report } = useStore();
  if (!report) return null;
  const { split, n_analysed } = report.cohort;

  const order = ["train", "validation", "test"];
  const entries = order.filter((name) => split.counts[name] !== undefined);
  const overlaps = Object.entries(split.patient_overlap);

  return (
    <>
      <PageHeader
        eyebrow="Build"
        title="Splits"
        lede="Patient-level partitioning. A patient can appear in exactly one partition, so no patient's own follow-up can leak into training."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-ink-200 px-4 py-3 sm:px-5">
            <h2 className="text-h3">Partitions</h2>
            <p className="mt-1 text-body-sm text-ink-600">
              {fmtInt(split.n_patients)} patients · strategy {split.strategy} · seed {split.seed}
            </p>
          </div>
          <ul className="divide-y divide-ink-100">
            {entries.map((name) => {
              const count = split.counts[name];
              const share = split.n_patients ? count / split.n_patients : 0;
              const role =
                name === "train"
                  ? "Model fitting"
                  : name === "validation"
                    ? "Conformal calibration and model selection"
                    : "Single held-out evaluation";
              return (
                <li key={name} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-h3 text-ink-950">{name}</span>
                    <span className="mono text-body-sm text-ink-700">
                      {fmtInt(count)} patients · {fmtPct(share, 1)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar
                      value={count}
                      total={split.n_patients}
                      tone={name === "test" ? "warn" : name === "validation" ? "primary" : "affirm"}
                      label={`${name}: ${fmtInt(count)} patients`}
                    />
                  </div>
                  <p className="mt-1.5 text-body-sm text-ink-600">{role}</p>
                </li>
              );
            })}
          </ul>
        </Card>

        <Panel title="Leakage check" description="Pairwise patient overlap between partitions.">
          <div className="flex items-center gap-3">
            <Chip tone={split.leakage_free ? "affirm" : "risk"}>
              {split.leakage_free ? "LEAKAGE-FREE" : "LEAKAGE DETECTED"}
            </Chip>
          </div>
          <ul className="mt-4 space-y-2">
            {overlaps.map(([pair, count]) => (
              <li key={pair} className="flex items-center justify-between gap-3">
                <span className="mono text-body-sm text-ink-800">{pair}</span>
                <Chip tone={count === 0 ? "affirm" : "risk"} icon={false}>
                  {fmtInt(count)} shared
                </Chip>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-ink-200 pt-4">
            <Metric label="Total overlap" value={fmtInt(split.total_overlap)} tone={split.total_overlap ? "risk" : "affirm"} />
          </div>
        </Panel>
      </div>

      {!split.leakage_free && (
        <div className="mt-4">
          <Callout tone="risk" title="This run is not quotable">
            Patients appear in more than one partition, so the held-out evaluation is contaminated.
            Every metric in this workspace should be treated as invalid until the split is fixed.
          </Callout>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Reproducibility">
          <KeyValue
            items={[
              { label: "Split version", value: split.split_version, mono: true },
              { label: "Split hash", value: <Code>{shortHash(split.split_hash, 16)}</Code> },
              { label: "Seed", value: String(split.seed), mono: true },
              {
                label: "Stratified on",
                value: split.stratified_on ? (
                  <span className="mono text-body-sm">{split.stratified_on}</span>
                ) : (
                  "not stratified"
                ),
              },
            ]}
          />
          <p className="mt-3 text-body-sm text-ink-600">
            Two runs with the same split hash were evaluated on identical partitions. The hash covers
            the patient-to-partition assignment, so a change in cohort construction changes it.
          </p>
        </Panel>

        <Panel
          title="Why patient-level matters"
          description="Longitudinal data makes subject-level leakage easy to introduce by accident."
        >
          <ul className="space-y-2.5 text-body text-ink-700">
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-700" />
              Splitting by <em>session</em> would put two visits from the same patient on opposite
              sides of the boundary. The model would learn that patient, not the disease.
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-700" />
              Features are built only from the index session and the target only from a later
              session, so a patient's own future cannot appear in their feature vector.
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-700" />
              Stratification keeps small stage bands represented in every partition without
              sacrificing the patient-level guarantee.
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
