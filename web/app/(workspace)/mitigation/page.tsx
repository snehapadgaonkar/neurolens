"use client";

import { DataTable, type Column } from "@/components/table";
import {
  Callout,
  Chip,
  Code,
  Metric,
  MetricGrid,
  PageHeader,
  Panel,
} from "@/components/ui";
import { fmt, fmtInt, fmtPct, humanLabel } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { MitigationRow } from "@/lib/types";

type Row = MitigationRow & Record<string, unknown>;

const ORDER = ["none", "reweighting", "group_aware"];

export default function MitigationPage() {
  const { report } = useStore();
  if (!report) return null;
  const { fairness } = report;

  const tasks = ["continuous", "stage"];
  const columns: Column<Row>[] = [
    {
      key: "mitigation",
      label: "Mitigation",
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-ink-950">{humanLabel(row.mitigation)}</span>
          {row.name === fairness.preferred_model && (
            <Chip tone="primary" icon={false}>
              preferred
            </Chip>
          )}
        </span>
      ),
      sortable: true,
      sortValue: (row) => ORDER.indexOf(row.mitigation),
    },
    {
      key: "name",
      label: "Model",
      render: (row) => <span className="mono text-body-sm text-ink-800">{row.name}</span>,
      hideBelow: "md",
    },
    {
      key: "overall",
      label: "Overall",
      align: "right",
      render: (row) => <span className="mono text-ink-900">{fmt(row.overall)}</span>,
      sortable: true,
      sortValue: (row) => row.overall,
    },
    {
      key: "worst_group",
      label: "Worst group",
      align: "right",
      render: (row) => <span className="mono text-warn-700">{fmt(row.worst_group)}</span>,
      sortable: true,
      sortValue: (row) => row.worst_group,
    },
    {
      key: "per_group",
      label: "Per group",
      render: (row) => (
        <ul className="space-y-0.5">
          {Object.entries(row.per_group).map(([group, value]) => (
            <li key={group} className="mono text-body-sm text-ink-700">
              {humanLabel(group)} {fmt(value.error)} <span className="text-ink-500">n={fmtInt(value.n)}</span>
            </li>
          ))}
        </ul>
      ),
      hideBelow: "lg",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Evaluate"
        title="Mitigation comparison"
        lede="None, reweighting, and group-aware training compared on an identical, untouched test split. Mitigation changes the training weights only — it never touches the data used to evaluate."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {tasks.map((task) => {
          const rows = fairness.mitigation_comparison.filter((row) => row.task === task);
          if (!rows.length) return null;
          const preference = fairness.preferred_by_task[task];
          const baseline = rows.find((row) => row.mitigation === "none");
          const best = rows.reduce(
            (acc, row) => (row.worst_group < acc.worst_group ? row : acc),
            rows[0],
          );
          const improvement = baseline ? baseline.worst_group - best.worst_group : 0;
          const cost = baseline ? best.overall - baseline.overall : 0;

          return (
            <Panel
              key={task}
              title={`${humanLabel(task)} task`}
              description={
                <>
                  Metric: <Code>{rows[0].metric}</Code> · lower is better
                </>
              }
            >
              <MetricGrid columns={3}>
                <Metric
                  label="Baseline worst group"
                  value={fmt(baseline?.worst_group)}
                  size="sm"
                  sublabel="no mitigation"
                />
                <Metric
                  label="Best worst group"
                  value={fmt(best.worst_group)}
                  size="sm"
                  tone="affirm"
                  sublabel={humanLabel(best.mitigation)}
                />
                <Metric
                  label="Improvement"
                  value={fmt(improvement)}
                  size="sm"
                  tone={improvement > 0 ? "affirm" : "insufficient"}
                  sublabel={`overall cost ${fmt(cost)}`}
                />
              </MetricGrid>
              <div className="mt-4 border-t border-ink-200 pt-3">
                <p className="text-label text-ink-500">Preferred</p>
                <p className="mono mt-1 text-body text-ink-950">{preference?.model ?? "—"}</p>
                <p className="mt-1.5 text-body-sm text-ink-600">{preference?.rationale}</p>
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="mt-4">
        <Panel
          title="All cells"
          dense
          description="Every mitigation, evaluated on the same held-out patients."
          footer="Reweighting equalises group frequency in the loss. Group-aware training adds one round of worst-group upweighting. Neither changes the evaluation data, so the comparison is apples to apples."
        >
          <DataTable<Row>
            columns={columns}
            rows={fairness.mitigation_comparison as Row[]}
            rowKey={(row) => row.name}
            initialSort={{ key: "worst_group", direction: "asc" }}
            caption="Mitigation comparison"
            summary={`Mitigation comparison across ${fmtInt(
              fairness.mitigation_comparison.length,
            )} cells. Preferred model ${fairness.preferred_model}: ${fairness.preferred_rationale}`}
          />
        </Panel>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Callout tone="info" title="The selection rule is predeclared">
          A mitigation is preferred only if it lowers worst-group error without degrading overall
          error by more than {fmtPct(0.05, 0)}. Both numbers come from the untouched test split, and
          the rationale is printed with the choice so the trade-off is visible rather than implicit.
        </Callout>
        <Callout tone="warn" title="Mitigation is not a fairness fix">
          A lower worst-group error is a measured improvement on this cohort, not evidence that the
          model is fair. Subgroups marked INSUFFICIENT DATA in the fairness audit are not covered by
          any of these numbers.
        </Callout>
      </div>
    </>
  );
}
