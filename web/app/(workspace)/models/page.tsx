"use client";

import { ConfusionMatrix } from "@/components/charts";
import { DataTable, type Column } from "@/components/table";
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
import type { ModelCell } from "@/lib/types";

type Row = ModelCell & Record<string, unknown>;

export default function ModelsPage() {
  const { report } = useStore();
  if (!report) return null;
  const { tasks, cohort } = report;

  const continuousCells = report.model_comparison.filter((cell) => cell.task === "continuous");
  const stageCells = report.model_comparison.filter((cell) => cell.task === "stage");
  const bestContinuous = continuousCells.reduce(
    (best, cell) => ((cell.metrics.mae ?? Infinity) < (best?.metrics.mae ?? Infinity) ? cell : best),
    undefined as ModelCell | undefined,
  );

  const columns: Column<Row>[] = [
    {
      key: "name",
      label: "Model",
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="mono text-body-sm text-ink-900">{row.name}</span>
          {bestContinuous && row.name === bestContinuous.name && (
            <Chip tone="primary" icon={false}>
              selected
            </Chip>
          )}
        </span>
      ),
      sortable: true,
      sortValue: (row) => row.name,
    },
    {
      key: "family",
      label: "Family",
      render: (row) => humanLabel(row.family),
      hideBelow: "md",
      sortable: true,
      sortValue: (row) => row.family,
    },
    {
      key: "n_features",
      label: "Features",
      align: "right",
      render: (row) => fmtInt(row.n_features),
      hideBelow: "lg",
      sortable: true,
      sortValue: (row) => row.n_features,
    },
    {
      key: "mae",
      label: "MAE",
      align: "right",
      render: (row) =>
        row.metrics.mae !== undefined ? (
          <span className="mono text-ink-900">{fmt(row.metrics.mae)}</span>
        ) : (
          "—"
        ),
      sortable: true,
      sortValue: (row) => row.metrics.mae ?? Number.NaN,
    },
    {
      key: "mae_ci",
      label: "95% CI",
      align: "right",
      render: (row) => (
        <span className="mono text-body-sm text-ink-600">{fmtCi(row.metrics.mae_ci)}</span>
      ),
      hideBelow: "lg",
    },
    {
      key: "r2",
      label: "R²",
      align: "right",
      render: (row) => (row.metrics.r2 !== undefined ? fmt(row.metrics.r2, 2) : "—"),
      hideBelow: "md",
      sortable: true,
      sortValue: (row) => row.metrics.r2 ?? Number.NaN,
    },
    {
      key: "worst",
      label: "Worst group",
      align: "right",
      render: (row) => (
        <span className="mono text-ink-800">{fmt(row.worst_group_error)}</span>
      ),
      sortable: true,
      sortValue: (row) => row.worst_group_error,
    },
    {
      key: "mitigation",
      label: "Mitigation",
      render: (row) => (
        <Chip tone={row.mitigation === "none" ? "neutral" : "info"} icon={false}>
          {humanLabel(row.mitigation)}
        </Chip>
      ),
      hideBelow: "md",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Evaluate"
        title="Models"
        lede="Every family × comparison × mitigation cell, each fitted on the untouched training split, calibrated on validation, and evaluated once on test."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Selected continuous model" className="lg:col-span-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <Code>{tasks.continuous.model ?? "—"}</Code>
            <span className="text-body-sm text-ink-600">{cohort.target_definition.units}</span>
          </div>
          <div className="mt-4">
            <MetricGrid columns={4}>
              <Metric
                label="MAE"
                value={fmt(tasks.continuous.metrics.mae)}
                sublabel={`95% CI ${fmtCi(tasks.continuous.metrics.mae_ci)}`}
              />
              <Metric label="R²" value={fmt(tasks.continuous.metrics.r2, 2)} />
              <Metric label="RMSE" value={fmt(tasks.continuous.metrics.rmse)} />
              <Metric label="Bias" value={fmt(tasks.continuous.metrics.bias)} />
            </MetricGrid>
          </div>
        </Panel>

        <Panel title="Selection rule" description="Validation-split MAE decides; the test split is never used to choose.">
          <KeyValue
            columns={1}
            items={[
              { label: "Cells trained", value: fmtInt(report.model_comparison.length) },
              { label: "Continuous cells", value: fmtInt(continuousCells.length) },
              { label: "Stage cells", value: fmtInt(stageCells.length) },
              {
                label: "Mitigations",
                value: [...new Set(report.model_comparison.map((cell) => cell.mitigation))]
                  .map(humanLabel)
                  .join(", "),
              },
            ]}
          />
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Continuous progression — all cells"
          dense
          description="Sorted by MAE. Confidence intervals are bootstrap CIs over the test split."
          footer="A difference between two models is only meaningful if their confidence intervals do not overlap. With this test-split size, most family differences are not resolvable."
        >
          <DataTable<Row>
            columns={columns}
            rows={continuousCells as Row[]}
            rowKey={(row) => row.name}
            initialSort={{ key: "mae", direction: "asc" }}
            caption="Continuous model comparison"
            summary={`Continuous model comparison across ${fmtInt(
              continuousCells.length,
            )} cells. Best MAE ${fmt(bestContinuous?.metrics.mae)} from ${
              bestContinuous?.name ?? "none"
            }.`}
          />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Disease stage — all cells"
          description="Macro-F1 and balanced accuracy, because the class prior is skewed."
        >
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="border-b border-ink-300">
                <th scope="col" className="py-2 text-left text-label text-ink-600">Model</th>
                <th scope="col" className="py-2 text-right text-label text-ink-600">Macro-F1</th>
                <th scope="col" className="py-2 text-right text-label text-ink-600">Bal. acc</th>
                <th scope="col" className="py-2 text-right text-label text-ink-600">AUROC</th>
              </tr>
            </thead>
            <tbody>
              {stageCells.map((cell) => (
                <tr key={cell.name} className="border-b border-ink-100 last:border-0">
                  <td className="py-2">
                    <span className="mono text-body-sm text-ink-900">{cell.name}</span>
                  </td>
                  <td className="py-2 text-right mono text-ink-900">{fmt(cell.metrics.macro_f1, 3)}</td>
                  <td className="py-2 text-right mono text-ink-700">
                    {fmt(cell.metrics.balanced_accuracy, 3)}
                  </td>
                  <td className="py-2 text-right mono text-ink-700">
                    {cell.metrics.auroc_ovr_macro === null || cell.metrics.auroc_ovr_macro === undefined
                      ? "—"
                      : fmt(cell.metrics.auroc_ovr_macro, 3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          title="Confusion matrix"
          description={`${tasks.stage.model ?? "—"} on the held-out test split.`}
        >
          {tasks.stage.metrics.confusion_matrix && tasks.stage.metrics.confusion_labels ? (
            <>
              <ConfusionMatrix
                matrix={tasks.stage.metrics.confusion_matrix}
                labels={tasks.stage.metrics.confusion_labels}
                summary={`Confusion matrix for ${tasks.stage.model}. Rows are true labels, columns predicted: ${tasks.stage.metrics.confusion_labels
                  .map(
                    (label, rowIndex) =>
                      `${label}: ${tasks.stage.metrics.confusion_matrix![rowIndex]
                        .map((count, columnIndex) =>
                          `${fmtInt(count)} predicted ${tasks.stage.metrics.confusion_labels![columnIndex]}`,
                        )
                        .join(", ")}`,
                  )
                  .join("; ")}.`}
              />
              <ul className="mt-3 space-y-1.5">
                {Object.entries(tasks.stage.metrics.per_class ?? {}).map(([label, metrics]) => (
                  <li key={label} className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
                    <span className="text-ink-900">{humanLabel(label)}</span>
                    <span className="mono text-ink-600">
                      support {fmtInt(metrics.support)} · precision {fmt(metrics.precision, 2)} ·
                      recall {fmt(metrics.recall, 2)} · F1 {fmt(metrics.f1, 2)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-body-sm text-ink-600">No confusion matrix for this run.</p>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Callout tone="info" title="What this comparison can and cannot tell you">
          All cells share the same split, the same features, and the same evaluation, so differences
          are attributable to the model family. But with a test split of{" "}
          {fmtInt(tasks.continuous.metrics.n)} patients, most differences here are inside the
          confidence interval. Read the interval, not the point estimate, before preferring one
          family over another.
        </Callout>
      </div>

      <div className="mt-4">
        <Panel
          title="Modality comparison"
          description="MRI-only versus multimodal, where the data allows it."
        >
          {report.skipped_comparisons.length ? (
            <Callout tone="warn" title="Not evaluable in this run">
              <ul className="mt-1 space-y-1">
                {report.skipped_comparisons.map((item) => (
                  <li key={item.comparison}>
                    <strong>{humanLabel(item.comparison)}</strong> — {item.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                The comparison is recorded rather than silently dropped. Fetch the missing modality
                and the identical pipeline will run it.
              </p>
            </Callout>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {["mri_only", "multimodal"].map((comparison) => {
                const cells = continuousCells.filter((cell) => cell.comparison === comparison);
                if (!cells.length) return null;
                const best = cells.reduce(
                  (acc, cell) => ((cell.metrics.mae ?? Infinity) < (acc?.metrics.mae ?? Infinity) ? cell : acc),
                  undefined as ModelCell | undefined,
                );
                return (
                  <div key={comparison} className="rounded-[6px] border border-ink-200 p-4">
                    <p className="text-h3 text-ink-950">{humanLabel(comparison)}</p>
                    <p className="mt-1 text-body-sm text-ink-600">
                      {cells[0].modalities.map(humanLabel).join(" + ")}
                    </p>
                    <p className="mt-3 text-metric-sm text-ink-950">{fmt(best?.metrics.mae)}</p>
                    <p className="text-body-sm text-ink-600">best MAE · {best?.name}</p>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {tasks.stage.notes.length > 0 && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {tasks.stage.notes.map((note) => (
            <Callout key={note} tone="warn" title="Stage task caveat">
              {note}
            </Callout>
          ))}
        </div>
      )}
    </>
  );
}
