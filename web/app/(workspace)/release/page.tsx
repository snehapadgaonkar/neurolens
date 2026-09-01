"use client";

import { DataTable, type Column } from "@/components/table";
import {
  Button,
  Callout,
  Chip,
  Code,
  KeyValue,
  Metric,
  MetricGrid,
  PageHeader,
  Panel,
} from "@/components/ui";
import { artifactUrl } from "@/lib/api";
import { fmtDate, fmtInt, humanLabel, shortHash } from "@/lib/format";
import { useStore } from "@/lib/store";

const ARTIFACTS: [string, string][] = [
  ["audit_report.json", "Machine-readable audit package"],
  ["audit_report.md", "Markdown audit report"],
  ["audit_report.html", "Self-contained HTML audit report"],
  ["model_card.md", "Model card"],
  ["predictions.csv", "Per-case predictions with intervals and OOD scores"],
  ["fairness_audit.csv", "Subgroup metrics with adequacy and status"],
  ["explanations.csv", "Patient-level attributions"],
  ["qc_ledger.csv", "Every exclusion with its reason"],
  ["manifest.json", "Reproducibility manifest"],
  ["config.yaml", "Exact configuration"],
];

type ArtifactRow = { name: string; description: string } & Record<string, unknown>;

export default function ReleasePage() {
  const { report, runId } = useStore();
  if (!report) return null;
  const { release_readiness, manifest, cohort } = report;
  const failed = Object.entries(release_readiness.checks).filter(([, passed]) => !passed);

  const artifactColumns: Column<ArtifactRow>[] = [
    {
      key: "name",
      label: "Artifact",
      render: (row) => (
        <a
          href={artifactUrl(row.name, runId)}
          target="_blank"
          rel="noopener noreferrer"
          className="mono text-body-sm text-primary-700 underline"
        >
          {row.name}
        </a>
      ),
    },
    { key: "description", label: "Contents", render: (row) => row.description },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Release"
        title="Audit report"
        lede="Everything needed to reproduce, challenge, or quote this run — and an explicit statement of what it cannot support."
        actions={
          <>
            <Button href={artifactUrl("model_card.md", runId)} target="_blank">
              Model card
            </Button>
            <Button href={artifactUrl("audit_report.html", runId)} target="_blank" variant="primary">
              Full report
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Release readiness" className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <Chip tone={release_readiness.release_ready ? "affirm" : "risk"}>
              {release_readiness.release_ready ? "RELEASE READY" : "BLOCKED"}
            </Chip>
            <span className="text-body-sm text-ink-600">
              {Object.values(release_readiness.checks).filter(Boolean).length} of{" "}
              {Object.keys(release_readiness.checks).length} checks passed
            </span>
          </div>
          {release_readiness.blockers.length > 0 && (
            <div className="mt-3">
              <Callout tone="risk" title="Blockers">
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {release_readiness.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </Callout>
            </div>
          )}
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {Object.entries(release_readiness.checks).map(([name, passed]) => (
              <li key={name} className="flex items-start gap-2 text-body-sm">
                <Chip tone={passed ? "affirm" : "risk"} icon={false} className="px-1.5 py-0">
                  {passed ? "✓" : "✕"}
                </Chip>
                <span className="text-ink-700">{humanLabel(name)}</span>
              </li>
            ))}
          </ul>
          {failed.length > 0 && (
            <p className="mt-3 text-body-sm text-risk-700">
              {failed.length} checks failed. This run must not be quoted until they pass.
            </p>
          )}
        </Panel>

        <Panel title="Intended use">
          <p className="text-body text-ink-700">{report.intended_use}</p>
          <p className="mt-3 border-t border-ink-200 pt-3 text-body-sm text-ink-600">
            Out of scope: diagnosis, staging for care decisions, treatment recommendation, and any
            causal claim about a biomarker.
          </p>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Reproducibility manifest">
          <KeyValue
            items={[
              { label: "Run", value: <Code>{manifest.run_id}</Code> },
              { label: "Config hash", value: <Code>{shortHash(manifest.config_hash, 16)}</Code> },
              { label: "Seed", value: String(manifest.seed), mono: true },
              { label: "Model version", value: <Code>{manifest.model_version}</Code> },
              { label: "Split hash", value: <Code>{shortHash(cohort.split.split_hash, 16)}</Code> },
              { label: "Split version", value: cohort.split.split_version, mono: true },
              {
                label: "Target definition",
                value: cohort.target_definition.version,
                mono: true,
              },
              { label: "Host", value: manifest.hostname, mono: true },
              { label: "Generated", value: fmtDate(manifest.created_utc) },
              { label: "Runtime", value: `${report.runtime_seconds.toFixed(1)} s` },
            ]}
          />
          <div className="mt-4 border-t border-ink-200 pt-4">
            <p className="text-label text-ink-500">Reproduce with</p>
            <pre className="mono mt-1.5 overflow-x-auto rounded-[6px] bg-ink-950 px-4 py-3 text-[12px] leading-[18px] text-ink-100">
              {report.reproduce_command}
            </pre>
          </div>
        </Panel>

        <Panel title="Environment">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {Object.entries(manifest.package_versions).map(([name, version]) => (
              <li key={name} className="flex items-baseline justify-between gap-2">
                <span className="text-body-sm text-ink-700">{name}</span>
                <span className="mono text-body-sm text-ink-900">{version}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-ink-200 pt-4">
            <p className="text-label text-ink-500">Pipeline stages</p>
            <ol className="mt-1.5 flex flex-wrap gap-1.5">
              {manifest.pipeline_stages.map((stage, index) => (
                <li key={stage} className="flex items-center gap-1.5">
                  <span className="rounded-[4px] bg-ink-100 px-2 py-0.5 text-body-sm text-ink-800">
                    {index + 1}. {stage}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Limitations"
          description="Generated from what actually happened in this run — not boilerplate."
        >
          <ol className="space-y-2.5">
            {report.limitations.map((item, index) => (
              <li key={item} className="flex gap-3 text-body text-ink-700">
                <span className="mono shrink-0 text-body-sm text-ink-400">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel
          title="Known failure modes"
          description="Where this model is expected to be wrong, stated before anyone asks."
        >
          <ul className="space-y-2.5">
            {report.known_failure_modes.map((item) => (
              <li key={item} className="flex gap-2.5 text-body text-ink-700">
                <Chip tone="warn" icon={false} className="mt-0.5 px-1.5 py-0">
                  !
                </Chip>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Artifacts"
          dense
          description="Everything this run wrote. Each file is self-contained and can be audited without the UI."
          footer="The audit package is read-only here. The server never mutates a run, so a package that has been reviewed cannot change behind a reviewer's back."
        >
          <DataTable<ArtifactRow>
            columns={artifactColumns}
            rows={ARTIFACTS.map(([name, description]) => ({ name, description }))}
            rowKey={(row) => row.name}
            caption="Run artifacts"
            summary={`This run wrote ${fmtInt(
              ARTIFACTS.length,
            )} artifacts including the audit report, model card, predictions, fairness audit, QC ledger, and reproducibility manifest.`}
          />
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Headline numbers at a glance" description="Quotable only alongside the limitations above.">
          <MetricGrid columns={4}>
            <Metric
              label="Continuous MAE"
              value={report.tasks.continuous.metrics.mae === undefined
                ? "—"
                : report.tasks.continuous.metrics.mae.toFixed(3)}
              size="sm"
              sublabel={`n=${fmtInt(report.tasks.continuous.metrics.n ?? 0)}`}
            />
            <Metric
              label="Stage macro-F1"
              value={report.tasks.stage.metrics.macro_f1 === undefined
                ? "—"
                : report.tasks.stage.metrics.macro_f1.toFixed(3)}
              size="sm"
            />
            <Metric
              label="Interval coverage"
              value={
                report.tasks.continuous.intervals.picp === undefined
                  ? "—"
                  : `${(report.tasks.continuous.intervals.picp * 100).toFixed(1)}%`
              }
              size="sm"
              tone={
                (report.tasks.continuous.intervals.picp ?? 1) <
                (report.tasks.continuous.intervals.target_coverage ?? 0.9) - 0.05
                  ? "risk"
                  : "affirm"
              }
            />
            <Metric
              label="Subgroups warned"
              value={fmtInt(report.fairness.worst_group.n_warn)}
              size="sm"
              tone={report.fairness.worst_group.n_warn ? "warn" : "affirm"}
              sublabel={`${fmtInt(report.fairness.worst_group.n_insufficient)} insufficient`}
            />
          </MetricGrid>
        </Panel>
      </div>
    </>
  );
}
