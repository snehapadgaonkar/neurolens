"use client";

import { useEffect, useState } from "react";
import { fetchDatasets } from "@/lib/api";
import { Callout, Card, Chip, Code, KeyValue, PageHeader, Panel } from "@/components/ui";
import { humanLabel } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { DatasetManifest } from "@/lib/types";

const ACCESS_TONE: Record<string, "affirm" | "warn" | "risk"> = {
  open: "affirm",
  registration: "warn",
  dua: "risk",
};

export default function DataPage() {
  const { report } = useStore();
  const [datasets, setDatasets] = useState<DatasetManifest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDatasets()
      .then((response) => setDatasets(response.datasets))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  const active = report ? datasets?.find((item) => item.key === report.cohort.dataset) : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Build"
        title="Data"
        lede="NeuroLens runs only on real, globally accessible data. There is no synthetic cohort anywhere in the project — not in the library, not in the tests, not as a fallback."
      />

      <Callout tone="info" title="Data policy">
        If a dataset cannot be reached, the pipeline records that in the QC ledger and stops. It never
        manufactures rows, never imputes demographics, and never redistributes restricted
        patient-level data.
      </Callout>

      {report && (
        <div className="mt-4">
          <Panel
            title="Dataset behind this run"
            description={report.cohort.dataset_title}
            actions={
              <Chip tone={ACCESS_TONE[report.cohort.dataset_access] ?? "neutral"}>
                {report.cohort.dataset_access} access
              </Chip>
            }
          >
            <KeyValue
              items={[
                { label: "Key", value: <Code>{report.cohort.dataset}</Code> },
                { label: "Version", value: report.cohort.dataset_version, mono: true },
                { label: "Licence", value: report.cohort.dataset_license },
                {
                  label: "Redistributable",
                  value: (
                    <Chip tone={report.cohort.redistributable ? "affirm" : "risk"} icon={false}>
                      {report.cohort.redistributable ? "yes" : "no"}
                    </Chip>
                  ),
                },
                {
                  label: "Modalities available",
                  value: Object.entries(report.cohort.modalities_available)
                    .filter(([, available]) => available)
                    .map(([modality]) => humanLabel(modality))
                    .join(", ") || "none",
                },
                {
                  label: "Modalities missing",
                  value:
                    Object.entries(report.cohort.modalities_available)
                      .filter(([, available]) => !available)
                      .map(([modality]) => humanLabel(modality))
                      .join(", ") || "none",
                },
                { label: "Citation", value: report.cohort.dataset_citation, span: true },
                { label: "Notes", value: report.cohort.dataset_notes, span: true },
                {
                  label: "Source",
                  value: (
                    <a
                      href={report.cohort.dataset_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary-700 underline"
                    >
                      {report.cohort.dataset_url}
                    </a>
                  ),
                  span: true,
                },
              ]}
            />
            {active?.download_command && (
              <div className="mt-4 border-t border-ink-200 pt-4">
                <p className="text-label text-ink-500">Fetch this dataset</p>
                <pre className="mono mt-1.5 overflow-x-auto rounded-[6px] bg-ink-950 px-4 py-3 text-[12px] leading-[18px] text-ink-100">
                  {active.download_command}
                </pre>
              </div>
            )}
          </Panel>
        </div>
      )}

      <div className="mt-4">
        <Panel
          title="Registered datasets"
          description="Every dataset NeuroLens can ingest, with its access tier and redistribution rights."
        >
          {error && (
            <Callout tone="risk" title="The dataset registry could not be loaded">
              {error}
            </Callout>
          )}
          {!datasets && !error && <p className="text-body-sm text-ink-600">Loading registry…</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            {datasets?.map((dataset) => {
              const isActive = report?.cohort.dataset === dataset.key;
              return (
                <Card
                  key={dataset.key}
                  className={`p-4 ${isActive ? "border-primary-700 ring-1 ring-primary-700/25" : ""}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-h3 text-ink-950">{dataset.title}</h3>
                    <Chip tone={ACCESS_TONE[dataset.access] ?? "neutral"}>
                      {dataset.access}
                    </Chip>
                  </div>
                  <p className="mono mt-1 text-body-sm text-ink-500">{dataset.key}</p>
                  <p className="mt-2 text-body text-ink-700">{dataset.disease}</p>
                  <dl className="mt-3 space-y-1.5 text-body-sm">
                    <div className="flex gap-2">
                      <dt className="text-ink-500">Version</dt>
                      <dd className="mono text-ink-800">{dataset.version}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-500">Licence</dt>
                      <dd className="text-ink-800">{dataset.license}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-500">Modalities</dt>
                      <dd className="text-ink-800">{dataset.modalities.map(humanLabel).join(", ")}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-500">Redistributable</dt>
                      <dd className="text-ink-800">{dataset.redistributable ? "yes" : "no"}</dd>
                    </div>
                  </dl>
                  {dataset.access !== "open" && (
                    <p className="mt-3 rounded-[6px] border border-warn-700/25 bg-warn-100 px-3 py-2 text-body-sm text-warn-700">
                      Not open access. NeuroLens never downloads, caches, mirrors, or redistributes
                      this data — you must already hold the right to use it.
                    </p>
                  )}
                  {isActive && (
                    <p className="mt-3 text-body-sm font-medium text-primary-700">
                      Used by the current run
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Why the default cohort is not an HD cohort"
          description="The honest answer, rather than a convenient one."
        >
          <div className="space-y-3 text-body text-ink-700">
            <p>
              NeuroLens is built for Huntington's disease progression. The HD neuroimaging data that
              exists is real, harmonised, and BIDS-formatted — it is simply not open. The harmonised
              collections (TRACK-HD, TRACKOn-HD, PREDICT-HD, IMAGE-HD, HD-YAS, SHIELD-HD, PEARL-HD,
              LONGPDE10) combine into six BIDS datasets totalling 2,216 participants and 7,073
              sessions, with FreeSurfer and fMRIPrep derivatives.
            </p>
            <p>
              Access is granted by the CHDI Foundation under a data use agreement obtained through{" "}
              <a
                href="https://www.enroll-hd.org/for-researchers/datasets/"
                target="_blank"
                rel="noreferrer"
                className="text-primary-700 underline"
              >
                Enroll-HD
              </a>
              . Three independent checks confirmed that no zero-barrier open HD imaging cohort
              exists: a sweep of the OpenNeuro metadata index, a sweep of OpenNeuro's git-annex
              mirror repositories, and the published literature on HD neuroimaging data
              availability.
            </p>
            <p>
              So the project ships two pathways that share every line of code downstream of
              ingestion. The open pathway runs on real CC0 data today; the HD pathway uses the
              identical cohort builder, splits, fairness audit, and reporting against data you
              already hold.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
