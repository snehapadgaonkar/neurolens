"use client";

import { BarChart } from "@/components/charts";
import { DataTable, type Column } from "@/components/table";
import {
  Callout,
  Chip,
  KeyValue,
  Metric,
  MetricGrid,
  PageHeader,
  Panel,
  ProgressBar,
} from "@/components/ui";
import { fmt, fmtInt, fmtPct, humanLabel } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { QcRecord } from "@/lib/types";

type QcRow = QcRecord & Record<string, unknown>;

const SEVERITY_TONE: Record<string, "risk" | "warn" | "neutral"> = {
  exclusion: "risk",
  warning: "warn",
  note: "neutral",
};

export default function CohortPage() {
  const { report } = useStore();
  if (!report) return null;
  const { cohort } = report;

  const qcColumns: Column<QcRow>[] = [
    { key: "entity_type", label: "Entity", render: (row) => humanLabel(row.entity_type) },
    {
      key: "entity_id",
      label: "Identifier",
      render: (row) => <span className="mono text-body-sm">{row.entity_id}</span>,
    },
    {
      key: "reason",
      label: "Reason",
      render: (row) => <span className="mono text-body-sm">{row.reason}</span>,
      sortable: true,
      sortValue: (row) => row.reason,
    },
    {
      key: "severity",
      label: "Severity",
      render: (row) => (
        <Chip tone={SEVERITY_TONE[row.severity] ?? "neutral"} icon={false}>
          {row.severity}
        </Chip>
      ),
      hideBelow: "md",
    },
    {
      key: "detail",
      label: "Detail",
      render: (row) => row.detail || <span className="text-ink-400">—</span>,
      hideBelow: "lg",
    },
  ];

  const retention = cohort.n_indexed > 0 ? cohort.n_analysed / cohort.n_indexed : 0;

  return (
    <>
      <PageHeader
        eyebrow="Build"
        title="Cohort"
        lede="Who entered the analysis, who did not, and the reason for every exclusion. Nothing is dropped silently."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Inclusion" className="lg:col-span-2">
          <MetricGrid columns={3}>
            <Metric label="Indexed" value={fmtInt(cohort.n_indexed)} sublabel="patients in the source" />
            <Metric
              label="Analysed"
              value={fmtInt(cohort.n_analysed)}
              sublabel={fmtPct(retention, 1)}
              tone="primary"
            />
            <Metric
              label="Excluded"
              value={fmtInt(cohort.n_excluded)}
              sublabel="every one logged below"
              tone={cohort.n_excluded ? "warn" : "affirm"}
            />
          </MetricGrid>
          <div className="mt-4">
            <ProgressBar value={cohort.n_analysed} total={cohort.n_indexed} label="analysed share" />
            <p className="mt-1.5 text-body-sm text-ink-600">
              {fmtPct(retention, 1)} of indexed patients met the predeclared inclusion rules for the{" "}
              {cohort.target_definition.index_session} → {cohort.target_definition.outcome_session}{" "}
              target.
            </p>
          </div>
        </Panel>

        <Panel title="Modalities present" description="What this dataset actually provides.">
          <ul className="space-y-2.5">
            {Object.entries(cohort.modalities_available).map(([modality, available]) => (
              <li key={modality} className="flex items-center justify-between gap-3">
                <span className="text-body text-ink-900">{humanLabel(modality)}</span>
                <span className="flex items-center gap-2">
                  <span className="mono text-body-sm text-ink-500">
                    {fmtInt(cohort.modality_feature_counts[modality] ?? 0)} features
                  </span>
                  <Chip tone={available ? "affirm" : "insufficient"} icon={false}>
                    {available ? "available" : "unavailable"}
                  </Chip>
                </span>
              </li>
            ))}
          </ul>
          {!cohort.modalities_available.mri && (
            <p className="mt-3 text-body-sm text-ink-600">
              The MRI-only comparison is recorded under skipped comparisons rather than silently
              dropped. Fetch the imaging derivative to enable it.
            </p>
          )}
        </Panel>
      </div>

      {report.skipped_comparisons.length > 0 && (
        <div className="mt-4">
          <Callout tone="warn" title="Comparisons this run could not perform">
            <ul className="mt-1 space-y-1">
              {report.skipped_comparisons.map((item) => (
                <li key={item.comparison}>
                  <strong>{humanLabel(item.comparison)}</strong> — {item.reason}
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Exclusion reasons"
          description="Counts by reason. A patient may appear in more than one category."
        >
          <BarChart
            data={Object.entries(cohort.exclusion_reasons)
              .sort(([, a], [, b]) => b - a)
              .map(([reason, count]) => ({
                label: humanLabel(reason),
                value: count,
                tone: count > cohort.n_excluded ? "warn" : "primary",
                annotation: fmtInt(count),
              }))}
            zeroBased
            summary={`Exclusion reasons: ${Object.entries(cohort.exclusion_reasons)
              .map(([reason, count]) => `${humanLabel(reason)} ${count}`)
              .join(", ")}.`}
          />
        </Panel>

        <Panel
          title="Subgroup sizes"
          description="Cell counts for every predeclared fairness axis, before any model is fitted."
        >
          {Object.entries(cohort.subgroup_sizes).map(([axis, levels]) => (
            <div key={axis} className="mb-4 last:mb-0">
              <p className="text-label text-ink-500">{humanLabel(axis)}</p>
              <ul className="mt-1.5 space-y-1.5">
                {Object.entries(levels)
                  .sort(([, a], [, b]) => b - a)
                  .map(([level, count]) => (
                    <li key={level} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-body-sm text-ink-800">
                        {humanLabel(level)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <ProgressBar
                          value={count}
                          total={cohort.n_analysed}
                          tone={count < 10 ? "insufficient" : count < 30 ? "warn" : "affirm"}
                          label={`${humanLabel(level)}: ${fmtInt(count)} patients`}
                        />
                      </span>
                      <span className="w-24 shrink-0 text-right">
                        <span className="mono text-body-sm text-ink-700">{fmtInt(count)}</span>
                        {count < 10 && (
                          <Chip tone="insufficient" icon={false} className="ml-1.5">
                            n&lt;10
                          </Chip>
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Features in the design matrix" description="Index-session information only.">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {cohort.features.map((feature) => (
              <li key={feature} className="flex items-center justify-between gap-2">
                <span className="mono text-body-sm text-ink-800">{feature}</span>
                <span className="text-body-sm text-ink-500">
                  {fmtPct(cohort.feature_missingness[feature] ?? 0, 1)} missing
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Source record">
          <KeyValue
            items={[
              { label: "Dataset", value: cohort.dataset_title },
              { label: "Version", value: cohort.dataset_version, mono: true },
              { label: "Access", value: cohort.dataset_access },
              { label: "Licence", value: cohort.dataset_license },
              {
                label: "Redistributable",
                value: (
                  <Chip tone={cohort.redistributable ? "affirm" : "warn"} icon={false}>
                    {cohort.redistributable ? "yes" : "no"}
                  </Chip>
                ),
              },
              { label: "QC events", value: fmtInt(cohort.n_qc_events) },
              { label: "Notes", value: cohort.dataset_notes, span: true },
              {
                label: "URL",
                value: (
                  <a href={cohort.dataset_url} className="text-primary-700 underline" target="_blank" rel="noreferrer">
                    {cohort.dataset_url}
                  </a>
                ),
                span: true,
              },
            ]}
          />
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="QC ledger"
          dense
          description={`Every exclusion and data-quality event, ${fmtInt(cohort.n_qc_events)} in total.`}
          footer="The ledger is the audit trail for the cohort. A row here is why a patient is absent from every metric in this workspace."
        >
          <DataTable<QcRow>
            columns={qcColumns}
            rows={cohort.qc_ledger as QcRow[]}
            rowKey={(row) => `${row.entity_type}-${row.entity_id}-${row.reason}`}
            initialSort={{ key: "reason", direction: "asc" }}
            caption="Quality-control ledger"
            summary={`Quality-control ledger with ${fmtInt(cohort.n_qc_events)} records. Top reasons: ${Object.entries(
              cohort.qc_reasons,
            )
              .slice(0, 4)
              .map(([reason, count]) => `${humanLabel(reason)} (${fmtInt(count)})`)
              .join(", ")}.`}
          />
        </Panel>
      </div>
    </>
  );
}
