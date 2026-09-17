/** Formatting helpers — one place where number and label rendering is decided. */

export const fmt = (value: number | null | undefined, digits = 3): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

export const fmtInt = (value: number | null | undefined): string =>
  value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : Math.round(value).toLocaleString("en-GB");

export const fmtPct = (value: number | null | undefined, digits = 1): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
};

/** Render a CI as "[a, b]" with an em dash when unavailable. */
export const fmtCi = (
  ci: [number | null, number | null] | null | undefined,
  digits = 3,
): string => {
  if (!ci) return "—";
  const [low, high] = ci;
  if (low === null || high === null || Number.isNaN(low) || Number.isNaN(high)) return "—";
  return `[${fmt(low, digits)}, ${fmt(high, digits)}]`;
};

export const fmtDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
};

/** `20260901T160438Z-openneuro-ds004856` -> `1 Sep 2026, 16:04 UTC` */
export const runIdLabel = (runId: string): string => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-(.*)$/.exec(runId);
  if (!match) return runId;
  const [, year, month, day, hour, minute, , dataset] = match;
  const date = new Date(
    Date.UTC(+year, +month - 1, +day, +hour, +minute),
  );
  return `${date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })} · ${dataset}`;
};

export const humanLabel = (value: string): string =>
  value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

export const shortHash = (value: string | undefined, length = 8): string =>
  value ? value.slice(0, length) : "—";
