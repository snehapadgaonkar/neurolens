"use client";

import { useId } from "react";
import { fmt, fmtInt } from "@/lib/format";

/*
 * Hand-rolled SVG charts.
 *
 * No chart library: the workspace has to load fast, print cleanly, and work
 * without a network. Every chart takes an explicit `summary` string that is
 * rendered as accessible text, and most screens pair the chart with a data
 * table so the underlying numbers are never only pixels (DESIGN.md).
 */

// Chart palette, kept in sync with the design tokens in app/globals.css.
//
// This is duplicated rather than read from CSS variables, which is a known
// weakness: when the v2 token migration warmed the ink scale and moved the
// clinical hue, these literals were left on the v1 values and the charts
// silently disagreed with the rest of the UI. SVG attributes do accept
// var(--color-*), so folding these into the token layer is the right follow-up.
const INK = {
  axis: "#b6b9bb",
  grid: "#e9e9e7",
  text: "#6b7276",
  textStrong: "#3d4347",
  primary: "#0b5e5a",
  primarySoft: "#dcedeb",
  risk: "#97333c",
  warn: "#8a5300",
  info: "#2f6db5",
  insufficient: "#5a6369",
  affirm: "#1f6f4a",
};

function Figure({
  title,
  summary,
  children,
  height,
}: {
  title?: string;
  summary: string;
  children: React.ReactNode;
  height: number;
}) {
  return (
    <figure className="min-w-0">
      {title && <figcaption className="mb-2 text-body-sm font-medium text-ink-700">{title}</figcaption>}
      <div className="w-full overflow-x-auto" style={{ minHeight: height }}>
        {children}
      </div>
      <p className="mt-2 text-body-sm text-ink-600">
        <span className="sr-only">Chart summary. </span>
        {summary}
      </p>
    </figure>
  );
}

/* ------------------------------------------------- predicted vs observed */

export interface Point {
  x: number;
  y: number;
  low?: number;
  high?: number;
  label?: string;
  flagged?: boolean;
}

export function ScatterWithIntervals({
  points,
  xLabel,
  yLabel,
  summary,
  width = 560,
  height = 300,
}: {
  points: Point[];
  xLabel: string;
  yLabel: string;
  summary: string;
  width?: number;
  height?: number;
}) {
  if (!points.length) return <p className="text-body-sm text-ink-600">No cases to plot.</p>;
  const pad = { top: 12, right: 16, bottom: 38, left: 48 };
  const xs = points.map((p) => p.x);
  const ys = points.flatMap((p) => [p.y, p.low ?? p.y, p.high ?? p.y]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const sx = (value: number) => pad.left + ((value - minX) / spanX) * (width - pad.left - pad.right);
  const sy = (value: number) => height - pad.bottom - ((value - minY) / spanY) * (height - pad.top - pad.bottom);

  const lo = Math.min(minX, minY);
  const hi = Math.max(maxX, maxY);

  return (
    <Figure summary={summary} height={height}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[320px]" role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = pad.top + tick * (height - pad.top - pad.bottom);
          const x = pad.left + tick * (width - pad.left - pad.right);
          const valueY = maxY - tick * spanY;
          const valueX = minX + tick * spanX;
          return (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke={INK.grid} strokeWidth="1" />
              <line x1={x} x2={x} y1={pad.top} y2={height - pad.bottom} stroke={INK.grid} strokeWidth="1" />
              <text x={pad.left - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill={INK.text}>
                {fmt(valueY, 2)}
              </text>
              <text x={x} y={height - pad.bottom + 15} textAnchor="middle" fontSize="10" fill={INK.text}>
                {fmt(valueX, 2)}
              </text>
            </g>
          );
        })}
        <line x1={sx(lo)} x2={sx(hi)} y1={sy(lo)} y2={sy(hi)} stroke={INK.textStrong} strokeWidth="1" strokeDasharray="4 3" />
        {points.map((point, index) => (
          <g key={index}>
            {point.low !== undefined && point.high !== undefined && (
              <line
                x1={sx(point.x)}
                x2={sx(point.x)}
                y1={sy(point.low)}
                y2={sy(point.high)}
                stroke={point.flagged ? INK.risk : INK.primary}
                strokeOpacity="0.35"
                strokeWidth="1.5"
              />
            )}
            <circle
              cx={sx(point.x)}
              cy={sy(point.y)}
              r="3.2"
              fill={point.flagged ? INK.risk : INK.primary}
              fillOpacity={point.flagged ? 0.9 : 0.75}
              stroke={point.flagged ? INK.risk : "none"}
              strokeWidth={point.flagged ? 1.5 : 0}
            >
              {point.label && <title>{point.label}</title>}
            </circle>
          </g>
        ))}
        <text x={width / 2} y={height - 4} textAnchor="middle" fontSize="11" fill={INK.textStrong}>
          {xLabel}
        </text>
        <text
          transform={`translate(12 ${height / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="11"
          fill={INK.textStrong}
        >
          {yLabel}
        </text>
      </svg>
    </Figure>
  );
}

/* ------------------------------------------------------------- bar chart */

export interface BarDatum {
  label: string;
  value: number;
  low?: number;
  high?: number;
  tone?: "primary" | "risk" | "warn" | "affirm" | "insufficient";
  annotation?: string;
}

const BAR_FILL: Record<string, string> = {
  primary: INK.primary,
  risk: INK.risk,
  warn: INK.warn,
  affirm: INK.affirm,
  insufficient: INK.insufficient,
};

export function BarChart({
  data,
  summary,
  unit = "",
  zeroBased = true,
  height,
  orientation = "horizontal",
}: {
  data: BarDatum[];
  summary: string;
  unit?: string;
  zeroBased?: boolean;
  height?: number;
  orientation?: "horizontal" | "vertical";
}) {
  const gradientId = useId();
  if (!data.length) return <p className="text-body-sm text-ink-600">No data to plot.</p>;

  if (orientation === "vertical") {
    const width = Math.max(320, data.length * 64);
    const chartHeight = height ?? 240;
    const pad = { top: 14, right: 12, bottom: 56, left: 44 };
    const values = data.flatMap((d) => [d.value, d.low ?? d.value, d.high ?? d.value]);
    const max = Math.max(...values, zeroBased ? 0 : -Infinity);
    const min = Math.min(...values, zeroBased ? 0 : Infinity);
    const span = max - min || 1;
    const band = (width - pad.left - pad.right) / data.length;
    const sy = (value: number) =>
      chartHeight - pad.bottom - ((value - min) / span) * (chartHeight - pad.top - pad.bottom);
    return (
      <Figure summary={summary} height={chartHeight}>
        <svg viewBox={`0 0 ${width} ${chartHeight}`} className="h-auto w-full min-w-[320px]" role="img">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={INK.primary} stopOpacity="0.95" />
              <stop offset="100%" stopColor={INK.primary} stopOpacity="0.72" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((tick) => {
            const value = min + tick * span;
            return (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={sy(value)} y2={sy(value)} stroke={INK.grid} />
                <text x={pad.left - 6} y={sy(value) + 3.5} textAnchor="end" fontSize="10" fill={INK.text}>
                  {fmt(value, 2)}
                </text>
              </g>
            );
          })}
          {data.map((datum, index) => {
            const x = pad.left + index * band + band * 0.18;
            const barWidth = band * 0.64;
            const y = sy(Math.max(datum.value, zeroBased ? 0 : datum.value));
            const base = sy(zeroBased ? Math.max(min, 0) : min);
            const barHeight = Math.max(1, Math.abs(base - sy(datum.value)));
            return (
              <g key={datum.label}>
                <rect
                  x={x}
                  y={datum.value >= 0 ? y : base}
                  width={barWidth}
                  height={barHeight}
                  rx="2"
                  fill={`url(#${gradientId})`}
                >
                  <title>{`${datum.label}: ${fmt(datum.value, 3)}${unit}`}</title>
                </rect>
                {datum.low !== undefined && datum.high !== undefined && (
                  <line
                    x1={x + barWidth / 2}
                    x2={x + barWidth / 2}
                    y1={sy(datum.high)}
                    y2={sy(datum.low)}
                    stroke={INK.textStrong}
                    strokeWidth="1.2"
                  />
                )}
                <text
                  x={x + barWidth / 2}
                  y={chartHeight - pad.bottom + 14}
                  textAnchor="middle"
                  fontSize="10"
                  fill={INK.text}
                >
                  {datum.label.length > 12 ? `${datum.label.slice(0, 11)}…` : datum.label}
                </text>
              </g>
            );
          })}
        </svg>
      </Figure>
    );
  }

  const rowHeight = 30;
  const chartHeight = height ?? data.length * rowHeight + 24;
  const width = 560;
  const pad = { top: 8, right: 64, bottom: 22, left: 168 };
  const values = data.flatMap((d) => [d.value, d.high ?? d.value]);
  const max = Math.max(...values, zeroBased ? 0 : -Infinity) || 1;
  const sx = (value: number) => pad.left + (value / max) * (width - pad.left - pad.right);

  return (
    <Figure summary={summary} height={chartHeight}>
      <svg viewBox={`0 0 ${width} ${chartHeight}`} className="h-auto w-full min-w-[320px]" role="img">
        {[0, 0.5, 1].map((tick) => (
          <line
            key={tick}
            x1={sx(max * tick)}
            x2={sx(max * tick)}
            y1={pad.top}
            y2={chartHeight - pad.bottom}
            stroke={INK.grid}
          />
        ))}
        {data.map((datum, index) => {
          const y = pad.top + index * rowHeight + 5;
          return (
            <g key={datum.label}>
              <text x={pad.left - 10} y={y + 12} textAnchor="end" fontSize="11" fill={INK.textStrong}>
                {datum.label.length > 26 ? `${datum.label.slice(0, 25)}…` : datum.label}
              </text>
              <rect
                x={pad.left}
                y={y}
                width={Math.max(1.5, sx(datum.value) - pad.left)}
                height={rowHeight - 14}
                rx="2"
                fill={BAR_FILL[datum.tone ?? "primary"]}
                fillOpacity="0.85"
              >
                <title>{`${datum.label}: ${fmt(datum.value, 3)}${unit}`}</title>
              </rect>
              {datum.low !== undefined && datum.high !== undefined && (
                <line
                  x1={sx(datum.low)}
                  x2={sx(datum.high)}
                  y1={y + (rowHeight - 14) / 2}
                  y2={y + (rowHeight - 14) / 2}
                  stroke={INK.textStrong}
                  strokeWidth="1.4"
                />
              )}
              <text x={width - pad.right + 8} y={y + 12} fontSize="10.5" fill={INK.textStrong} className="tnum">
                {datum.annotation ?? fmt(datum.value, 3)}
              </text>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}

/* -------------------------------------------------------------- histogram */

export function Histogram({
  binCentres,
  series,
  summary,
  height = 220,
  xLabel,
}: {
  binCentres: number[];
  series: { values: number[]; label: string; fill: string }[];
  summary: string;
  height?: number;
  xLabel?: string;
}) {
  if (!binCentres.length) return <p className="text-body-sm text-ink-600">No data to plot.</p>;
  const width = 560;
  const pad = { top: 12, right: 12, bottom: 34, left: 40 };
  const max = Math.max(1, ...series.flatMap((entry) => entry.values));
  const band = (width - pad.left - pad.right) / binCentres.length;
  const sy = (value: number) =>
    height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);

  return (
    <Figure summary={summary} height={height}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[320px]" role="img">
        {[0, 0.5, 1].map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={sy(max * tick)} y2={sy(max * tick)} stroke={INK.grid} />
            <text x={pad.left - 6} y={sy(max * tick) + 3.5} textAnchor="end" fontSize="10" fill={INK.text}>
              {fmtInt(max * tick)}
            </text>
          </g>
        ))}
        {series.map((entry, seriesIndex) =>
          entry.values.map((value, index) => {
            const subBand = band / series.length;
            const x = pad.left + index * band + seriesIndex * subBand;
            return (
              <rect
                key={`${entry.label}-${index}`}
                x={x + 0.5}
                y={sy(value)}
                width={Math.max(1, subBand - 1)}
                height={Math.max(0, height - pad.bottom - sy(value))}
                fill={entry.fill}
                fillOpacity="0.85"
              >
                <title>{`${entry.label} @ ${fmt(binCentres[index], 2)}: ${fmtInt(value)}`}</title>
              </rect>
            );
          }),
        )}
        {binCentres.map((centre, index) =>
          index % Math.ceil(binCentres.length / 6) === 0 ? (
            <text
              key={centre}
              x={pad.left + index * band + band / 2}
              y={height - pad.bottom + 14}
              textAnchor="middle"
              fontSize="10"
              fill={INK.text}
            >
              {fmt(centre, 2)}
            </text>
          ) : null,
        )}
        {xLabel && (
          <text x={width / 2} y={height - 4} textAnchor="middle" fontSize="11" fill={INK.textStrong}>
            {xLabel}
          </text>
        )}
      </svg>
    </Figure>
  );
}

/* ------------------------------------------------------------ risk-coverage */

export function RiskCoverageChart({
  curve,
  maeFull,
  summary,
}: {
  curve: {
    abstention_fraction: number;
    coverage: number;
    n_retained: number;
    mae: number;
  }[];
  maeFull: number;
  summary: string;
}) {
  if (!curve.length) return <p className="text-body-sm text-ink-600">No curve to plot.</p>;
  const width = 560;
  const height = 240;
  const pad = { top: 14, right: 16, bottom: 40, left: 48 };
  const ys = curve.map((point) => point.mae);
  const minY = Math.min(...ys) * 0.9;
  const maxY = Math.max(...ys, maeFull) * 1.05;
  const span = maxY - minY || 1;
  const sx = (abstention: number) => pad.left + abstention * (width - pad.left - pad.right);
  const sy = (mae: number) => height - pad.bottom - ((mae - minY) / span) * (height - pad.top - pad.bottom);
  const path = curve
    .map((point, index) => `${index === 0 ? "M" : "L"}${sx(point.abstention_fraction)},${sy(point.mae)}`)
    .join(" ");

  return (
    <Figure summary={summary} height={height}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[320px]" role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={sy(minY + tick * span)} y2={sy(minY + tick * span)} stroke={INK.grid} />
            <text x={pad.left - 6} y={sy(minY + tick * span) + 3.5} textAnchor="end" fontSize="10" fill={INK.text}>
              {fmt(minY + tick * span, 2)}
            </text>
          </g>
        ))}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={sy(maeFull)}
          y2={sy(maeFull)}
          stroke={INK.textStrong}
          strokeDasharray="4 3"
          strokeWidth="1"
        />
        <text x={width - pad.right} y={sy(maeFull) - 5} textAnchor="end" fontSize="10" fill={INK.textStrong}>
          no abstention
        </text>
        <path d={path} fill="none" stroke={INK.primary} strokeWidth="2" strokeLinejoin="round" />
        {curve.map((point) => (
          <circle key={point.abstention_fraction} cx={sx(point.abstention_fraction)} cy={sy(point.mae)} r="2.6" fill={INK.primary}>
            <title>{`${fmt(point.abstention_fraction * 100, 0)}% abstained · MAE ${fmt(point.mae, 3)} · n kept ${point.n_retained}`}</title>
          </circle>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <text
            key={tick}
            x={sx(tick)}
            y={height - pad.bottom + 15}
            textAnchor="middle"
            fontSize="10"
            fill={INK.text}
          >
            {fmt(tick * 100, 0)}%
          </text>
        ))}
        <text x={width / 2} y={height - 4} textAnchor="middle" fontSize="11" fill={INK.textStrong}>
          highest-uncertainty cases abstained
        </text>
        <text
          transform={`translate(12 ${height / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="11"
          fill={INK.textStrong}
        >
          MAE of kept cases
        </text>
      </svg>
    </Figure>
  );
}

/* ------------------------------------------------------ confusion matrix */

export function ConfusionMatrix({
  matrix,
  labels,
  summary,
}: {
  matrix: number[][];
  labels: string[];
  summary: string;
}) {
  if (!matrix.length) return <p className="text-body-sm text-ink-600">No confusion matrix.</p>;
  const max = Math.max(1, ...matrix.flat());
  const size = 92;
  const labelWidth = 128;
  const width = labelWidth + labels.length * size + 8;
  const height = labels.length * size + 54;

  return (
    <Figure summary={summary} height={height}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto max-w-full" role="img">
        <text x={labelWidth - 10} y={18} textAnchor="end" fontSize="10" fill={INK.text}>
          true ↓ / predicted →
        </text>
        {labels.map((column, columnIndex) => (
          <text
            key={`col-${column}`}
            x={labelWidth + columnIndex * size + size / 2}
            y={36}
            textAnchor="middle"
            fontSize="10.5"
            fill={INK.textStrong}
          >
            {column}
          </text>
        ))}
        {matrix.map((row, rowIndex) => (
          <g key={`row-${rowIndex}`}>
            <text x={labelWidth - 10} y={54 + rowIndex * size + size / 2 + 4} textAnchor="end" fontSize="10.5" fill={INK.textStrong}>
              {labels[rowIndex]}
            </text>
            {row.map((count, columnIndex) => {
              const intensity = count / max;
              const isDiagonal = rowIndex === columnIndex;
              return (
                <g key={`cell-${rowIndex}-${columnIndex}`}>
                  <rect
                    x={labelWidth + columnIndex * size + 2}
                    y={44 + rowIndex * size + 2}
                    width={size - 4}
                    height={size - 4}
                    rx="3"
                    fill={isDiagonal ? INK.primary : INK.risk}
                    fillOpacity={isDiagonal ? 0.1 + intensity * 0.6 : 0.06 + intensity * 0.55}
                  />
                  <text
                    x={labelWidth + columnIndex * size + size / 2}
                    y={44 + rowIndex * size + size / 2 + 5}
                    textAnchor="middle"
                    fontSize="15"
                    fontWeight="600"
                    fill={INK.textStrong}
                  >
                    {fmtInt(count)}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </Figure>
  );
}

/* ------------------------------------------------------------- attribution */

export function AttributionChart({
  contributions,
  summary,
  maxBars = 12,
}: {
  contributions: { label: string; attribution: number; family: string }[];
  summary: string;
  maxBars?: number;
}) {
  const rows = contributions.slice(0, maxBars);
  if (!rows.length) return <p className="text-body-sm text-ink-600">No attributions.</p>;
  const FAMILY_FILL: Record<string, string> = {
    mri: INK.info,
    genetics: "#7a5aa8",
    clinical: "#b5643a",
    demographic: "#3f7f7a",
  };
  const rowHeight = 26;
  const width = 560;
  const pad = { top: 8, right: 16, bottom: 20, left: 176 };
  const height = rows.length * rowHeight + pad.top + pad.bottom;
  const max = Math.max(...rows.map((row) => Math.abs(row.attribution))) || 1;
  const zero = pad.left + (width - pad.left - pad.right) / 2;
  const scale = (width - pad.left - pad.right) / 2 / max;

  return (
    <Figure summary={summary} height={height}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[320px]" role="img">
        <line x1={zero} x2={zero} y1={pad.top} y2={height - pad.bottom} stroke={INK.axis} strokeWidth="1" />
        {rows.map((row, index) => {
          const y = pad.top + index * rowHeight + 4;
          const barWidth = Math.abs(row.attribution) * scale;
          const positive = row.attribution >= 0;
          return (
            <g key={row.label}>
              <text x={pad.left - 10} y={y + 12} textAnchor="end" fontSize="11" fill={INK.textStrong}>
                {row.label.length > 28 ? `${row.label.slice(0, 27)}…` : row.label}
              </text>
              <rect
                x={positive ? zero : zero - barWidth}
                y={y}
                width={Math.max(1.5, barWidth)}
                height={rowHeight - 12}
                rx="2"
                fill={FAMILY_FILL[row.family] ?? INK.primary}
                fillOpacity="0.85"
              >
                <title>{`${row.label}: ${row.attribution >= 0 ? "increases" : "decreases"} prediction by ${fmt(Math.abs(row.attribution), 4)}`}</title>
              </rect>
              <text
                x={positive ? zero + barWidth + 6 : zero - barWidth - 6}
                y={y + 12}
                fontSize="10"
                textAnchor={positive ? "start" : "end"}
                fill={INK.text}
                className="tnum"
              >
                {row.attribution >= 0 ? "+" : "−"}
                {fmt(Math.abs(row.attribution), 3)}
              </text>
            </g>
          );
        })}
        <text x={zero - (width - pad.left - pad.right) / 2} y={height - 4} fontSize="10" fill={INK.text}>
          ← decreases prediction
        </text>
        <text x={width - pad.right} y={height - 4} textAnchor="end" fontSize="10" fill={INK.text}>
          increases prediction →
        </text>
      </svg>
    </Figure>
  );
}
