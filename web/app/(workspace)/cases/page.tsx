"use client";

import { useEffect, useMemo, useState } from "react";
import { ScatterWithIntervals } from "@/components/charts";
import { DataTable, type Column } from "@/components/table";
import { Button, Callout, Chip, Metric, MetricGrid, PageHeader, Panel } from "@/components/ui";
import { fetchCases } from "@/lib/api";
import { fmt, fmtCi, fmtInt } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { CaseRow } from "@/lib/types";

type Row = CaseRow & Record<string, unknown>;
type SortKey = "uncertainty" | "error" | "patient_id";

export default function CasesPage() {
  const { report } = useStore();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("uncertainty");
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCases({ search: query || undefined, flaggedOnly, sort, order: "desc", limit: 200 })
      .then((response) => {
        if (cancelled) return;
        setCases(response.cases);
        setTotal(response.total);
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
  }, [query, flaggedOnly, sort]);

  const flagged = useMemo(
    () => (cases ?? []).filter((item) => item.ood_score >= item.ood_threshold).length,
    [cases],
  );

  const columns: Column<Row>[] = [
    {
      key: "patient_id",
      label: "Patient",
      render: (row) => (
        <a
          href={`/cases/${encodeURIComponent(row.patient_id)}`}
          className="mono text-body-sm text-primary-700 underline"
        >
          {row.patient_id}
        </a>
      ),
      sortable: true,
      sortValue: (row) => row.patient_id,
    },
    {
      key: "truth",
      label: "Observed",
      align: "right",
      render: (row) => <span className="mono text-ink-900">{fmt(row.truth)}</span>,
      sortable: true,
      sortValue: (row) => row.truth,
    },
    {
      key: "prediction",
      label: "Predicted",
      align: "right",
      render: (row) => <span className="mono text-ink-900">{fmt(row.prediction)}</span>,
      sortable: true,
      sortValue: (row) => row.prediction,
    },
    {
      key: "interval",
      label: "90% interval",
      align: "right",
      render: (row) => <span className="mono text-body-sm text-ink-600">{fmtCi(row.interval, 2)}</span>,
      hideBelow: "md",
    },
    {
      key: "error",
      label: "|Error|",
      align: "right",
      render: (row) => (
        <span className={`mono ${Math.abs(row.prediction - row.truth) > 0.5 ? "text-risk-700" : "text-ink-800"}`}>
          {fmt(Math.abs(row.prediction - row.truth))}
        </span>
      ),
      sortable: true,
      sortValue: (row) => Math.abs(row.prediction - row.truth),
    },
    {
      key: "uncertainty",
      label: "Uncertainty",
      align: "right",
      render: (row) => <span className="mono text-ink-800">{fmt(row.uncertainty)}</span>,
      sortable: true,
      sortValue: (row) => row.uncertainty,
      hideBelow: "sm",
    },
    {
      key: "ood",
      label: "OOD",
      render: (row) =>
        row.ood_score >= row.ood_threshold ? (
          <Chip tone="risk" title={`score ${fmt(row.ood_score, 3)} ≥ threshold ${fmt(row.ood_threshold, 3)}`}>
            flagged
          </Chip>
        ) : (
          <span className="mono text-body-sm text-ink-600">{fmt(row.ood_score, 2)}</span>
        ),
      sortable: true,
      sortValue: (row) => row.ood_score,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Inspect"
        title="Cases"
        lede="Every held-out patient with their prediction, interval, realised error, uncertainty, and OOD score. Open a case for its full explanation and caveats."
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Panel title="Filter" className="lg:col-span-2">
          <label className="block">
            <span className="text-label text-ink-500">Search patient identifier</span>
            <input
              type="search"
              data-testid="case-search"
              aria-label="Search patient identifier"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="e.g. sub-1139"
              className="mono mt-1.5 w-full rounded-[6px] border border-ink-300 bg-paper px-3 py-2 text-body-sm text-ink-900 placeholder:text-ink-400 hover:border-ink-400"
            />
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              active={flaggedOnly}
              data-testid="flagged-toggle"
              aria-pressed={flaggedOnly}
              onClick={() => setFlaggedOnly((value) => !value)}
            >
              {flaggedOnly ? "Showing flagged only" : "Flagged OOD only"}
            </Button>
            <span className="text-label text-ink-500">Sort by</span>
            {(
              [
                ["uncertainty", "Uncertainty"],
                ["error", "Error"],
                ["patient_id", "Patient"],
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <Button
                key={key}
                active={sort === key}
                data-testid={`sort-${key}`}
                aria-pressed={sort === key}
                onClick={() => setSort(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-body-sm text-ink-600" data-testid="case-count">
            {loading
              ? "Loading cases…"
              : `${fmtInt(cases?.length ?? 0)} shown of ${fmtInt(total)} held-out cases · ${fmtInt(flagged)} flagged OOD`}
          </p>
        </Panel>

        <Panel title="Reading a row" className="lg:col-span-2">
          <MetricGrid columns={2}>
            <Metric
              label="Flagged OOD"
              value={fmtInt(flagged)}
              size="sm"
              tone={flagged ? "risk" : "affirm"}
              sublabel={`threshold ${fmt(cases?.[0]?.ood_threshold, 3)}`}
            />
            <Metric
              label="Units"
              value={cases?.[0]?.units ? "per year" : "—"}
              size="sm"
              sublabel={cases?.[0]?.units}
            />
          </MetricGrid>
          <p className="mt-3 text-body-sm text-ink-600">
            A flagged OOD score means this patient sits outside the training feature distribution.
            Their prediction should be read as advisory, not as an estimate to act on.
          </p>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Predicted against observed"
          description="Each point is one held-out patient; the vertical line is their prediction interval. The dashed line is perfect prediction."
        >
          {cases && cases.length ? (
            <ScatterWithIntervals
              points={cases.map((item) => ({
                x: item.truth,
                y: item.prediction,
                low: item.interval[0],
                high: item.interval[1],
                label: `${item.patient_id}: truth ${fmt(item.truth)}, predicted ${fmt(item.prediction)}`,
                flagged: item.ood_score >= item.ood_threshold,
              }))}
              xLabel="observed progression"
              yLabel="predicted progression"
              summary={`Scatter of predicted against observed progression for ${fmtInt(
                cases.length,
              )} held-out patients. ${fmtInt(
                flagged,
              )} are flagged out-of-distribution and shown in crimson. Points below the dashed line are under-predictions.`}
            />
          ) : (
            <p className="text-body-sm text-ink-600">No cases match the current filter.</p>
          )}
        </Panel>
      </div>

      {error && (
        <div className="mt-4">
          <Callout tone="risk" title="Cases could not be loaded" data-testid="cases-error">
            {error}
          </Callout>
        </div>
      )}

      <div className="mt-4">
        <Panel title="Held-out cases" dense>
          <DataTable<Row>
            columns={columns}
            rows={(cases ?? []) as Row[]}
            rowKey={(row) => row.patient_id}
            initialSort={{ key: "uncertainty", direction: "desc" }}
            emptyLabel={loading ? "Loading cases…" : "No cases match the current filter."}
            caption="Held-out case predictions"
            summary={`Table of ${fmtInt(
              cases?.length ?? 0,
            )} held-out cases with observed value, prediction, 90% interval, absolute error, uncertainty, and OOD score.`}
            onRowClick={undefined}
          />
        </Panel>
      </div>

      {report && (
        <div className="mt-4">
          <Callout tone="info" title="What a single case can and cannot tell you">
            One patient's prediction is a point in a distribution, not a prognosis. The interval is a{" "}
            {fmt((1 - (report.tasks.continuous.alpha ?? 0.1)) * 100, 0)} conformal interval
            calibrated on this cohort, and this workspace is a research prototype that must not be
            used for clinical decisions.
          </Callout>
        </div>
      )}
    </>
  );
}
