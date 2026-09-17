"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { artifactUrl } from "@/lib/api";
import { fmtDate, humanLabel, runIdLabel, shortHash } from "@/lib/format";
import { NAV } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { Button, Chip, StatusGlyph } from "@/components/ui";

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden="true">
        <rect width="28" height="28" rx="7" fill="#0f5f63" />
        <path
          d="M7 19.5V8.5M7 14h5.5M12.5 8.5v11M17 8.5c2.6 0 4 1.7 4 5.5s-1.4 5.5-4 5.5"
          stroke="#dcf1f0"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span className="min-w-0">
        <span className="block text-[15px] leading-[18px] font-semibold tracking-[-0.01em] text-paper">
          NeuroLens
        </span>
        <span className="block text-[11px] leading-[14px] text-primary-200">evidence workspace</span>
      </span>
    </span>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace sections" className="flex flex-col gap-5">
      {NAV.map((group) => (
        <div key={group.label}>
          <p className="px-3 text-label text-ink-400">{group.label}</p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-[6px] px-3 py-1.5 text-body-sm transition-colors ${
                      active
                        ? "bg-ink-800 font-medium text-paper"
                        : "text-ink-300 hover:bg-ink-800/70 hover:text-paper"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-primary-500" : "bg-ink-700"}`}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ProvenanceStrip() {
  const { report, runId } = useStore();
  if (!report) return null;
  const items = [
    { label: "Run", value: runIdLabel(report.manifest.run_id), mono: false },
    { label: "Split", value: shortHash(report.cohort.split.split_hash, 16), mono: true },
    { label: "Config", value: shortHash(report.manifest.config_hash, 16), mono: true },
    { label: "Seed", value: String(report.manifest.seed), mono: true },
    { label: "Dataset", value: humanLabel(report.cohort.dataset), mono: false },
    { label: "Generated", value: fmtDate(report.generated_utc), mono: false },
  ];
  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-body-sm">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="text-label text-ink-500">{item.label}</dt>
          <dd className={item.mono ? "mono text-[12px] text-ink-800" : "text-ink-800"}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RunSwitcher() {
  const { runs, runId, setRunId, report } = useStore();
  if (runs.length <= 1 && !report) return null;
  const options = runs.length ? runs : report ? [{ run_id: report.manifest.run_id }] : [];
  return (
    <label className="flex items-center gap-2">
      <span className="text-label text-ink-500">Run</span>
      <select
        data-testid="run-switcher"
        value={runId ?? options[0]?.run_id ?? ""}
        onChange={(event) => setRunId(event.target.value)}
        className="max-w-[16rem] rounded-[6px] border border-border-input bg-paper px-2 py-1.5 text-body-sm text-ink-900 hover:border-ink-500"
      >
        {options.map((run) => (
          <option key={run.run_id} value={run.run_id}>
            {runIdLabel(run.run_id)}
            {"release_ready" in run && !(run as { release_ready?: boolean }).release_ready
              ? " · blocked"
              : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { report, loading, error, retry } = useStore();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const readiness = report?.release_readiness;
  const blockers = report?.cohort.n_excluded ?? 0;

  return (
    <div className="min-h-screen bg-paper-50">
      <a
        href="#main"
        data-testid="skip-link"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-[6px] focus:bg-primary-700 focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to content
      </a>

      {/* Left rail — persistent on desktop, sheet below 1200px */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[248px] overflow-y-auto bg-ink-950 px-3 py-5 transition-transform duration-200 xl:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Primary navigation"
      >
        <div className="mb-6 flex items-center justify-between px-1">
          <Wordmark />
          <button
            type="button"
            onClick={() => setOpen(false)}
            data-testid="nav-close"
            className="rounded-[6px] p-1.5 text-ink-300 hover:bg-ink-800 hover:text-paper xl:hidden"
            aria-label="Close navigation"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <NavList onNavigate={() => setOpen(false)} />

        {report && (
          <div className="mt-7 rounded-[6px] border border-ink-800 bg-ink-900 p-3">
            <p className="text-label text-ink-400">Release</p>
            <p className="mt-1.5 flex items-center gap-2 text-body-sm text-paper">
              <StatusGlyph
                tone={readiness?.release_ready ? "affirm" : "risk"}
                className="h-4 w-4"
              />
              {readiness?.release_ready ? "Ready" : "Blocked"}
            </p>
            <p className="mt-1 text-body-sm text-ink-300">
              {readiness?.blockers.length
                ? readiness.blockers.join("; ")
                : `${Object.keys(readiness?.checks ?? {}).length} checks passed`}
            </p>
          </div>
        )}
      </aside>

      {open && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          data-testid="nav-overlay"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink-950/45 xl:hidden"
        />
      )}

      <div className="xl:pl-[248px]">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-ink-200 bg-paper/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
            <button
              type="button"
              onClick={() => setOpen(true)}
              data-testid="nav-open"
              className="rounded-[6px] border border-ink-300 p-1.5 text-ink-700 hover:bg-paper-50 xl:hidden"
              aria-label="Open navigation"
              aria-expanded={open}
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <RunSwitcher />
            </div>
            {report && (
              <div className="hidden items-center gap-2 lg:flex">
                {report.cohort.dataset_access !== "open" && (
                  <Chip tone="warn" title="This dataset is not open access">
                    {report.cohort.dataset_access} access
                  </Chip>
                )}
                <Chip tone={blockers ? "warn" : "affirm"} icon={false}>
                  {blockers ? `${blockers} excluded` : "no exclusions"}
                </Chip>
                {report && (
                  <Button href={artifactUrl("model_card.md", report.manifest.run_id)} target="_blank">
                    Model card
                  </Button>
                )}
                <Button
                  href={artifactUrl("audit_report.html", report.manifest.run_id)}
                  target="_blank"
                  variant="primary"
                >
                  Full report
                </Button>
              </div>
            )}
          </div>
          <div className="border-t border-ink-100 bg-paper-25 px-4 py-2 sm:px-6">
            <div className="mx-auto max-w-[1440px]">
              {report ? (
                <ProvenanceStrip />
              ) : (
                <p className="text-body-sm text-ink-500">{loading ? "Loading audit package…" : "No run loaded"}</p>
              )}
            </div>
          </div>
        </header>

        {/* Persistent research-use notice — never dismissible */}
        <div className="border-b border-warn-700/25 bg-warn-100" data-testid="research-notice" role="note">
          <div className="mx-auto flex max-w-[1440px] items-start gap-2.5 px-4 py-2 sm:px-6">
            <StatusGlyph tone="warn" className="mt-0.5 h-4 w-4 text-warn-700" />
            <p className="text-body-sm text-warn-700">
              {report?.research_use_notice ??
                "NeuroLens is a research prototype. It is not clinically validated and must not be used for diagnosis or treatment decisions."}
            </p>
          </div>
        </div>

        {/* tabIndex={-1} is what makes the skip link actually move focus:
            without it the browser only moves the sequential focus start point
            and `main` never becomes the active element. */}
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 focus:outline-none"
        >
          {error ? (
            <div
              data-testid="load-error"
              role="alert"
              className="flex flex-col items-start gap-3 rounded-[10px] border border-risk-700/25 bg-risk-100 px-5 py-5"
            >
              <p className="flex items-center gap-2 text-h3 text-risk-700">
                <StatusGlyph tone="risk" className="h-4 w-4" />
                The audit package could not be loaded
              </p>
              <p className="max-w-[70ch] text-body text-risk-700">{error}</p>
              <Button variant="primary" onClick={retry} data-testid="load-error-retry">
                Try again
              </Button>
            </div>
          ) : (
            children
          )}
        </main>

        <footer className="border-t border-ink-200 bg-paper">
          <div className="mx-auto max-w-[1440px] px-4 py-5 text-body-sm text-ink-600 sm:px-6">
            <p>
              NeuroLens is a research prototype for neurodegenerative disease progression modelling.
              Feature attributions describe model association, not biological causation.
            </p>
            {report && (
              <p className="mt-2 mono text-[12px] text-ink-500">
                {report.reproduce_command}
              </p>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <div className="h-7 w-64 animate-pulse rounded-[6px] bg-ink-100" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded-[6px] bg-ink-100" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-24 animate-pulse rounded-[10px] bg-ink-100" />
        ))}
      </div>
      <p className="mt-2 text-body-sm text-ink-500">Loading the audit package…</p>
    </div>
  );
}
