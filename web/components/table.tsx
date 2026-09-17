"use client";

import { useState, type ReactNode } from "react";
import { fmtInt } from "@/lib/format";

export interface Column<Row> {
  key: string;
  label: string;
  /** Cell renderer for the desktop table. */
  render: (row: Row) => ReactNode;
  /** Compact value for the mobile card layout. */
  mobile?: (row: Row) => ReactNode;
  align?: "left" | "right";
  sortable?: boolean;
  sortValue?: (row: Row) => number | string;
  width?: string;
  /** Hide below this breakpoint to keep dense tables readable on small screens. */
  hideBelow?: "sm" | "md" | "lg";
  /** Short label used in the mobile card layout. */
  mobileLabel?: string;
}

type SortState = { key: string; direction: "asc" | "desc" } | null;

const HIDE: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

/**
 * Evidence table: sticky header, `aria-sort` on the sorted column, zebra rows,
 * and a card layout below 768px so nothing has to be scrolled sideways on a
 * phone (DESIGN.md responsive order).
 */
export function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  initialSort,
  sort: controlledSort,
  onSortChange,
  emptyLabel = "Nothing to show.",
  caption,
  summary,
  dense = false,
  onRowClick,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  initialSort?: { key: string; direction: "asc" | "desc" };
  /**
   * Controlled sort state. When supplied the table no longer owns sorting, so a
   * page-level control and the column headers stay in step instead of fighting
   * over the row order.
   */
  sort?: { key: string; direction: "asc" | "desc" } | null;
  /** Called when a column header is clicked; required alongside `sort`. */
  onSortChange?: (next: { key: string; direction: "asc" | "desc" }) => void;
  emptyLabel?: string;
  caption?: string;
  /** Accessible text alternative for the table's content. */
  summary?: string;
  dense?: boolean;
  onRowClick?: (row: Row) => void;
}) {
  const [internalSort, setInternalSort] = useState<SortState>(initialSort ?? null);
  // `controlledSort` may legitimately be null (unsorted), so test for undefined
  // rather than truthiness before deferring to internal state.
  const sort = controlledSort === undefined ? internalSort : controlledSort;

  const active = columns.find((column) => column.key === sort?.key && column.sortable);
  const sorted = (() => {
    if (!active || !sort || !active.sortValue) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = active.sortValue!(a);
      const right = active.sortValue!(b);
      if (typeof left === "number" && typeof right === "number") {
        if (Number.isNaN(left)) return 1;
        if (Number.isNaN(right)) return -1;
        return (left - right) * factor;
      }
      return String(left).localeCompare(String(right)) * factor;
    });
  })();

  const toggle = (key: string) => {
    const next = {
      key,
      direction: (sort?.key === key
        ? sort.direction === "asc"
          ? "desc"
          : "asc"
        : "asc") as "asc" | "desc",
    };
    if (onSortChange) {
      onSortChange(next);
    } else {
      setInternalSort(next);
    }
  };

  if (!rows.length) {
    return (
      // Test hook: the same empty-state copy is often rendered elsewhere on the
      // screen (e.g. a chart panel's fallback), and Playwright's getByText() is
      // strict, so callers need a way to target the table's own copy.
      <p data-testid="table-empty" className="px-4 py-6 text-body-sm text-ink-600 sm:px-5">
        {emptyLabel}
      </p>
    );
  }

  const pad = dense ? "px-3 py-1.5" : "px-3 py-2.5";

  return (
    <div className="table-scroll">
      {summary && <p className="sr-only">{summary}</p>}
      {/* Desktop / tablet */}
      <table className="hidden w-full min-w-[640px] border-collapse text-body sm:table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-ink-300 bg-paper-50">
            {columns.map((column) => {
              const isSorted = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    isSorted ? (sort!.direction === "asc" ? "ascending" : "descending") : "none"
                  }
                  className={`${pad} text-left text-label text-ink-600 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5 ${
                    column.align === "right" ? "text-right" : ""
                  } ${column.hideBelow ? HIDE[column.hideBelow] : ""} ${column.width ?? ""}`}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      data-testid={`sort-header-${column.key}`}
                      onClick={() => toggle(column.key)}
                      className="inline-flex items-center gap-1 hover:text-ink-950"
                    >
                      {column.label}
                      <span aria-hidden="true" className="text-ink-400">
                        {isSorted ? (sort!.direction === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-ink-100 last:border-0 ${
                index % 2 === 1 ? "bg-paper-25" : "bg-paper"
              } ${onRowClick ? "cursor-pointer hover:bg-primary-50" : ""}`}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`${pad} align-top first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5 ${
                    column.align === "right" ? "text-right tnum" : ""
                  } ${column.hideBelow ? HIDE[column.hideBelow] : ""}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: one card per row, ordered by column priority */}
      <ul className="divide-y divide-ink-200 sm:hidden">
        {sorted.map((row) => (
          <li
            key={rowKey(row)}
            className={`px-4 py-3 ${onRowClick ? "cursor-pointer active:bg-primary-50" : ""}`}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((column) => (
              <div key={column.key} className="flex justify-between gap-3 py-0.5">
                <span className="shrink-0 text-body-sm text-ink-500">
                  {column.mobileLabel ?? column.label}
                </span>
                <span className="min-w-0 text-right text-body-sm text-ink-950">
                  {(column.mobile ?? column.render)(row)}
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>

      <p className="border-t border-ink-200 px-4 py-2 text-body-sm text-ink-500 sm:px-5">
        {fmtInt(sorted.length)} {sorted.length === 1 ? "row" : "rows"}
        {sort && active ? ` · sorted by ${active.label} (${sort.direction})` : ""}
      </p>
    </div>
  );
}
