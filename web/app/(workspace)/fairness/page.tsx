"use client";

import { useMemo, useState } from "react";
import { BarChart } from "@/components/charts";
import { DataTable, type Column } from "@/components/table";
import {
  Callout,
  Chip,
  EmptyState,
  Metric,
  MetricGrid,
  PageHeader,
  Panel,
  SubgroupStatus,
} from "@/components/ui";
import { fmt, fmtCi, fmtInt, fmtPct, humanLabel } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { FairnessRow } from "@/lib/types";

type Row = FairnessRow & Record<string, unknown>;

export default function FairnessPage() {
  const { report } = useStore();
  const [axis, setAxis] = useState<string>("all");
  const rows = useMemo(() => {
    if (!report) return [];
    return axis === "all"
      ? report.fairness.rows
      : report.fairness.rows.filter((row) => row.axis === axis);
  }, [report, axis]);

  if (!report) return null;
  const { fairness } = report;
  const worst = fairness.worst_group;

  const counts = {
    pass: fairness.rows.filter((row) => row.status === "PASS").length,
    warn: fairness.rows.filter((row) => row.status === "WARN").length,
    insufficient: fairness.rows.filter((row) => row.status === "INSUFFICIENT DATA").length,
  };

  const columns: Column<Row>[] = [
    {
      key: "subgroup",
      label: "Subgroup",
      render: (row) => (
        <span>
          <span className="text-ink-950">{humanLabel(row.subgroup)}</span>
          <span className="block text-body-sm text-ink-500">{humanLabel(row.axis)}</span>
        </span>
      ),
      sortable: true,
      sortValue: (row) => row.subgroup,
    },
    {
      key: "n",
      label: "n",
      align: "right",
      render: (row) => (
        <span className={`mono ${row.n < 10 ? "text-insufficient-700" : "text-ink-900"}`}>
          {fmtInt(row.n)}
        </span>
      ),
      sortable: true,
      sortValue: (row) => row.n,
    },
    {
      key: "estimate",
      label: "Estimate",
      align: "right",
      render: (row) =>
        row.estimate === null || Number.isNaN(row.estimate) ? (
          <span className="text-ink-400">not reported</span>
        ) : (
          <span className="mono text-ink-900">{fmt(row.estimate)}</span>
        ),
      sortable: true,
      sortValue: (row) => (row.estimate === null ? Number.NaN : row.estimate),
    },
    {
      key: "ci",
      label: "95% CI",
      align: "right",
      render: (row) => <span className="mono text-body-sm text-ink-600">{fmtCi(row.ci)}</span>,
      hideBelow: "md",
    },
    {
      key: "gap",
      label: "Gap vs reference",
      align: "right",
      render: (row) =>
        row.gap === null || Number.isNaN(row.gap) ? (
          <span className="text-ink-400">—</span>
        ) : (
          <span className="mono text-ink-900">{fmt(row.gap)}</span>
        ),
      sortable: true,
      sortValue: (row) => (row.gap === null ? Number.NaN : row.gap),
    },
    {
      key: "gap_ci",
      label: "Gap 95% CI",
      align: "right",
      render: (row) => <span className="mono text-body-sm text-ink-600">{fmtCi(row.gap_ci)}</span>,
      hideBelow: "lg",
    },
    {
      key: "relative_gap",
      label: "Relative",
      align: "right",
      render: (row) =>
        row.relative_gap === null || Number.isNaN(row.relative_gap) ? (
          <span className="text-ink-400">—</span>
        ) : (
          <span
            className={`mono ${
              row.relative_gap > 0.2 ? "text-risk-700" : row.relative_gap < -0.2 ? "text-affirm-700" : "text-ink-800"
            }`}
          >
            {fmtPct(row.relative_gap, 0)}
          </span>
        ),
      sortable: true,
      sortValue: (row) => (row.relative_gap === null ? Number.NaN : row.relative_gap),
      hideBelow: "sm",
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <SubgroupStatus status={row.status} n={row.n} adequacy={row.adequacy} />,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Evaluate"
        title="Fairness audit"
        lede="Per-subgroup error with its sample size, confidence interval, gap to the reference group, and adequacy. There is no composite fairness score and no binary fair/unfair label — a single number would hide exactly the cells that matter."
        actions={
          <label className="flex items-center gap-2">
            <span className="text-label text-ink-500">Axis</span>
            <select
              data-testid="fairness-axis"
              aria-label="Fairness axis"
              value={axis}
              onChange={(event) => setAxis(event.target.value)}
              className="rounded-[6px] border border-ink-300 bg-paper px-2 py-1.5 text-body-sm text-ink-900 hover:border-ink-400"
            >
              <option value="all">All axes</option>
              {fairness.axes.map((name) => (
                <option key={name} value={name}>
                  {humanLabel(name)}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Worst group" description="Across every reportable subgroup.">
          {worst.worst_group ? (
            <>
              <p className="text-h2 text-ink-950">{humanLabel(worst.worst_group)}</p>
              <p className="mt-0.5 text-body-sm text-ink-600">
                {humanLabel(worst.worst_axis ?? "")} · n={fmtInt(worst.worst_n ?? 0)}
              </p>
              <div className="mt-3">
                <Metric label="Error" value={fmt(worst.worst_estimate)} size="sm" tone="warn" />
              </div>
            </>
          ) : (
            <EmptyState title="No reportable subgroup">
              {worst.note ?? "Every cell on every axis fell below the reportable minimum."}
            </EmptyState>
          )}
          {worst.worst_group && worst.best_group && (
            <p className="mt-3 border-t border-ink-200 pt-3 text-body-sm text-ink-600">
              Best group <strong>{humanLabel(worst.best_group)}</strong> (
              {humanLabel(worst.best_axis ?? "")}, n={fmtInt(worst.best_n ?? 0)}) at{" "}
              {fmt(worst.best_estimate)} — a spread of {fmt(worst.spread)} (
              {fmtPct(worst.relative_spread, 0)} relative).
            </p>
          )}
        </Panel>

        <Panel title="Verdicts" className="lg:col-span-2">
          <MetricGrid columns={3}>
            <Metric label="Pass" value={fmtInt(counts.pass)} tone="affirm" />
            <Metric label="Warn" value={fmtInt(counts.warn)} tone="warn" />
            <Metric label="Insufficient data" value={fmtInt(counts.insufficient)} tone="insufficient" />
          </MetricGrid>
          <div className="mt-4 border-t border-ink-200 pt-4">
            <Callout tone="info" title="How to read a verdict">
              <ul className="mt-1 space-y-1.5">
                <li>
                  <strong>PASS</strong> — no adverse gap beyond the predeclared threshold that
                  survives its own confidence interval.
                </li>
                <li>
                  <strong>WARN</strong> — an adverse gap: this subgroup does worse than the reference
                  group by more than {fmtPct(0.2, 0)}, and the gap's CI excludes zero.
                </li>
                <li>
                  <strong>INSUFFICIENT DATA</strong> — below the reportable minimum. No estimate is
                  given, because a small cell's estimate would be noise dressed as a finding.
                </li>
              </ul>
            </Callout>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Subgroup error by axis"
          description="Bars show the subgroup estimate; the whisker is its 95% confidence interval."
        >
          {(() => {
            const reportable = fairness.rows.filter(
              (row) => row.estimate !== null && !Number.isNaN(row.estimate),
            );
            if (!reportable.length) {
              return (
                <EmptyState title="Nothing is reportable">
                  Every subgroup on every axis is below the predeclared reportable minimum of 10
                  patients. No fairness claim can be made from this run in either direction.
                </EmptyState>
              );
            }
            return (
              <BarChart
                data={reportable.map((row) => ({
                  label: `${humanLabel(row.subgroup)}`,
                  value: row.estimate as number,
                  low: row.ci[0] ?? undefined,
                  high: row.ci[1] ?? undefined,
                  tone:
                    row.status === "WARN"
                      ? "warn"
                      : row.adequacy === "EXPLORATORY"
                        ? "insufficient"
                        : "primary",
                  annotation: `${fmt(row.estimate)} · n=${row.n}`,
                }))}
                summary={`Subgroup error by axis. ${reportable
                  .map((row) => `${humanLabel(row.subgroup)} ${fmt(row.estimate)} (n=${row.n})`)
                  .join(", ")}. Bars marked amber are adverse gaps; grey bars are exploratory cell sizes.`}
              />
            );
          })()}
          {counts.insufficient > 0 && (
            <p className="mt-3 text-body-sm text-ink-600">
              {fmtInt(counts.insufficient)} subgroup cells are omitted from this chart entirely
              because they carry no estimate.
            </p>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Every subgroup row"
          dense
          description="Nothing is aggregated away. Each row carries its own n, estimate, CI, gap, gap CI, adequacy, and verdict."
          footer="The reference group is the largest level of each axis, fixed before evaluation. Only adverse gaps are flagged — a subgroup that does better than the reference is reported but never called a disparity."
        >
          <DataTable<Row>
            columns={columns}
            rows={rows as Row[]}
            rowKey={(row) => `${row.axis}-${row.subgroup}`}
            initialSort={{ key: "relative_gap", direction: "desc" }}
            caption="Fairness audit by subgroup"
            summary={`Fairness audit across ${fmtInt(
              rows.length,
            )} subgroup cells: ${fmtInt(counts.pass)} pass, ${fmtInt(counts.warn)} warn, ${fmtInt(
              counts.insufficient,
            )} insufficient data. Worst group ${humanLabel(worst.worst_group ?? "none")}.`}
          />
        </Panel>
      </div>

      {fairness.rows.some((row) => row.note) && (
        <div className="mt-4">
          <Panel title="Notes on individual cells" description="Why a cell was flagged, or why it carries no estimate.">
            <ul className="space-y-2">
              {fairness.rows
                .filter((row) => row.note)
                .map((row) => (
                  <li key={`${row.axis}-${row.subgroup}`} className="flex flex-wrap gap-x-3 gap-y-1 border-b border-ink-100 pb-2 last:border-0">
                    <Chip
                      tone={
                        row.status === "PASS" ? "affirm" : row.status === "WARN" ? "warn" : "insufficient"
                      }
                    >
                      {humanLabel(row.subgroup)}
                    </Chip>
                    <span className="min-w-0 flex-1 text-body-sm text-ink-700">{row.note}</span>
                  </li>
                ))}
            </ul>
          </Panel>
        </div>
      )}

      <div className="mt-4">
        <Callout tone="warn" title="What this audit does not establish">
          A PASS verdict means no adverse gap was detected at this sample size — it is not a
          certificate of fairness. Subgroups marked INSUFFICIENT DATA carry no estimate at all, and
          absence of a disparity signal there is not evidence of fairness. Intersectional cells are
          smaller still, so they are reported only where cell size permits.
        </Callout>
      </div>
    </>
  );
}
