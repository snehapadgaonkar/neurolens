"use client";

import type { ReactNode } from "react";
import { fmt, fmtInt } from "@/lib/format";
import type { Adequacy, Verdict } from "@/lib/types";

/* ------------------------------------------------------------------ surfaces */

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag
      className={`rounded-[10px] border border-ink-200 bg-paper shadow-[var(--shadow-1)] ${className}`}
    >
      {children}
    </Tag>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  footer,
  className = "",
  dense = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <Card className={className}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-h3 text-ink-950">{title}</h2>}
            {description && (
              <p className="mt-1 max-w-[70ch] text-body-sm text-ink-600">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={dense ? "" : "px-4 py-4 sm:px-5"}>{children}</div>
      {footer && (
        <footer className="border-t border-ink-200 bg-paper-25 px-4 py-3 text-body-sm text-ink-600 sm:px-5">
          {footer}
        </footer>
      )}
    </Card>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-4 border-b border-ink-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-label text-primary-700">{eyebrow}</p>}
        <h1 className="mt-1.5 text-h1 text-ink-950">{title}</h1>
        {lede && <p className="mt-2 max-w-[78ch] text-body text-ink-600">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* -------------------------------------------------------------------- status */

type Tone = "affirm" | "warn" | "insufficient" | "risk" | "info" | "neutral" | "primary";

const TONES: Record<Tone, { className: string; label: string }> = {
  affirm: { className: "bg-affirm-100 text-affirm-700 border-affirm-700/25", label: "affirm" },
  warn: { className: "bg-warn-100 text-warn-700 border-warn-700/25", label: "warn" },
  insufficient: {
    className: "bg-insufficient-100 text-insufficient-700 border-insufficient-700/25",
    label: "insufficient",
  },
  risk: { className: "bg-risk-100 text-risk-700 border-risk-700/25", label: "risk" },
  info: { className: "bg-info-100 text-info-700 border-info-700/25", label: "info" },
  neutral: { className: "bg-ink-100 text-ink-700 border-ink-300", label: "neutral" },
  primary: { className: "bg-primary-100 text-primary-800 border-primary-700/25", label: "primary" },
};

/** A status glyph. Status is never conveyed by colour alone (DESIGN.md). */
export function StatusGlyph({ tone, className = "" }: { tone: Tone; className?: string }) {
  const common = `${className} shrink-0`;
  switch (tone) {
    case "affirm":
      return (
        <svg viewBox="0 0 16 16" className={common} aria-hidden="true" fill="none">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.2 8.2 7.1 10l3.7-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "warn":
      return (
        <svg viewBox="0 0 16 16" className={common} aria-hidden="true" fill="none">
          <path d="M8 2.4 14.4 13.6H1.6L8 2.4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 6.6v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="11.6" r="0.85" fill="currentColor" />
        </svg>
      );
    case "risk":
      return (
        <svg viewBox="0 0 16 16" className={common} aria-hidden="true" fill="none">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "insufficient":
      return (
        <svg viewBox="0 0 16 16" className={common} aria-hidden="true" fill="none">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2.1" />
          <path d="M6.4 6.2a1.7 1.7 0 1 1 2.5 1.5c-.6.35-.9.8-.9 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="11.4" r="0.8" fill="currentColor" />
        </svg>
      );
    case "info":
    case "primary":
      return (
        <svg viewBox="0 0 16 16" className={common} aria-hidden="true" fill="none">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="5" r="0.85" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" className={common} aria-hidden="true" fill="none">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.4 8h5.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

export function Chip({
  children,
  tone = "neutral",
  icon = true,
  title,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: boolean;
  title?: string;
  className?: string;
}) {
  const resolved = TONES[tone];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 text-body-sm font-medium whitespace-nowrap ${resolved.className} ${className}`}
    >
      {icon && <StatusGlyph tone={tone} className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

export const verdictTone = (status: Verdict): Tone =>
  status === "PASS" ? "affirm" : status === "WARN" ? "warn" : "insufficient";

export const adequacyTone = (adequacy: Adequacy): Tone =>
  adequacy === "ADEQUATE" ? "affirm" : adequacy === "EXPLORATORY" ? "warn" : "insufficient";

/** A verdict chip with the subgroup's n always visible next to it. */
export function SubgroupStatus({
  status,
  n,
  adequacy,
}: {
  status: Verdict;
  n: number;
  adequacy: Adequacy;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Chip tone={verdictTone(status)}>{status}</Chip>
      <span className="mono text-body-sm text-ink-600">n={fmtInt(n)}</span>
      {adequacy !== "ADEQUATE" && (
        <Chip tone={adequacyTone(adequacy)} icon={false}>
          {adequacy}
        </Chip>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------- metrics */

export function Metric({
  label,
  value,
  unit,
  sublabel,
  hint,
  tone = "neutral",
  size = "md",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sublabel?: ReactNode;
  hint?: string;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
}) {
  const valueClass =
    size === "lg" ? "text-metric" : size === "sm" ? "text-metric-sm" : "text-[24px] leading-[28px] font-semibold tracking-[-0.018em] tnum";
  const toneClass =
    tone === "neutral"
      ? "text-ink-950"
      : tone === "affirm"
        ? "text-affirm-700"
        : tone === "warn"
          ? "text-warn-700"
          : tone === "risk"
            ? "text-risk-700"
            : tone === "primary"
              ? "text-primary-700"
              : "text-insufficient-700";
  return (
    <div className="min-w-0" title={hint}>
      <p className="text-label text-ink-500">{label}</p>
      <p className={`mt-1.5 flex items-baseline gap-1.5 ${valueClass} ${toneClass}`}>
        <span className="truncate">{value}</span>
        {unit && <span className="text-body-sm font-normal text-ink-500">{unit}</span>}
      </p>
      {sublabel && <p className="mt-1 text-body-sm text-ink-600">{sublabel}</p>}
    </div>
  );
}

export function MetricGrid({
  children,
  columns = 4,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
}) {
  const span =
    columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4";
  return (
    <div className={`grid grid-cols-1 gap-x-6 gap-y-5 ${span}`}>{children}</div>
  );
}

/* --------------------------------------------------------------------- text */

export function KeyValue({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode; mono?: boolean; span?: boolean }[];
  columns?: 1 | 2 | 3;
}) {
  const span = columns === 1 ? "" : columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2";
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${span}`}>
      {items.map((item) => (
        <div key={item.label} className={item.span ? "sm:col-span-2 lg:col-span-3" : "min-w-0"}>
          <dt className="text-label text-ink-500">{item.label}</dt>
          <dd
            className={`mt-1 break-words text-body text-ink-950 ${item.mono ? "mono text-body-sm" : ""}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  className = "",
  ...rest
}: {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const resolved = TONES[tone];
  return (
    <div
      className={`flex gap-3 rounded-[6px] border px-4 py-3 ${resolved.className} ${className}`}
      {...rest}
    >
      <StatusGlyph tone={tone} className="mt-0.5 h-4 w-4" />
      <div className="min-w-0 text-body">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "mt-1" : ""}>{children}</div>
      </div>
    </div>
  );
}

export function Code({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <code className={`mono rounded-[4px] bg-ink-100 px-1.5 py-0.5 text-[12px] text-ink-900 ${className}`}>
      {children}
    </code>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[6px] border border-dashed border-ink-300 bg-paper-25 px-5 py-6">
      <p className="text-h3 text-ink-800">{title}</p>
      {children && <div className="max-w-[70ch] text-body-sm text-ink-600">{children}</div>}
      {action}
    </div>
  );
}

export function ProgressBar({
  value,
  total,
  tone = "primary",
  label,
}: {
  value: number;
  total: number;
  tone?: Tone;
  label?: string;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const bar =
    tone === "affirm"
      ? "bg-affirm-700"
      : tone === "warn"
        ? "bg-warn-700"
        : tone === "risk"
          ? "bg-risk-700"
          : tone === "insufficient"
            ? "bg-insufficient-700"
            : "bg-primary-700";
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
      role="img"
      aria-label={label ?? `${fmtInt(value)} of ${fmtInt(total)} (${fmt(pct, 0)}%)`}
    >
      <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Button({
  children,
  href,
  onClick,
  variant = "secondary",
  active = false,
  ...rest
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  active?: boolean;
  target?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-[6px] px-3 py-1.5 text-body-sm font-medium transition-colors disabled:opacity-50";
  const skin =
    variant === "primary"
      ? "bg-primary-700 text-paper hover:bg-primary-800"
      : active
        ? "border border-primary-700 bg-primary-50 text-primary-800"
        : variant === "ghost"
          ? "text-ink-700 hover:bg-ink-100"
          : "border border-ink-300 bg-paper text-ink-800 hover:border-ink-400 hover:bg-paper-50";
  const className = `${base} ${skin}`;
  if (href) {
    return (
      <a href={href} className={className} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} {...rest}>
      {children}
    </button>
  );
}
