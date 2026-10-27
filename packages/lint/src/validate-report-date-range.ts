// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0021 — semantic layer] A report's `dateRange` resolves to ONE date
 * dimension of the dataset it binds (#26548; ruling 6408567749 on #25873,
 * letter B: "applied when the dataset has a time dimension").
 *
 * `ReportSchema.dateRange` is `{ dimension?, defaultRange, allowCustomRange }`.
 * The schema parses a report WITHOUT its dataset, so it can check only the
 * shape; which dimension the window lands on is a question about the dataset,
 * and it is answered here, beside `validate-chart-bindings.ts`, which resolves
 * the same report against the same `stack.datasets`.
 *
 * ## What "a date dimension" means
 *
 * A dataset dimension declaring `type: 'date'`. The analytics compiler types
 * exactly those as time dimensions and every other one — `type` absent
 * included — as a string axis (`dimensionType` in
 * `services/service-analytics/src/dataset-compiler.ts`), so a dimension over a
 * date column that does not say `type: 'date'` cannot carry a date window.
 *
 * ## The four verdicts, all `error`
 *
 *  - `report-date-range-dimension-unknown` — `dimension` names no dimension
 *    of the bound dataset.
 *  - `report-date-range-dimension-not-date` — it names one that does not
 *    declare `type: 'date'`.
 *  - `report-date-range-dimension-ambiguous` — `dimension` is omitted and the
 *    dataset declares two or more date dimensions, so nothing says which one
 *    the window applies to (`examples/app-todo`'s task dataset declares
 *    `due_date` and `completed_date`).
 *  - `report-date-range-dimension-none` — `dimension` is omitted and the
 *    dataset declares none, so the period has no column to apply to.
 *
 * The omitted-dimension rule is the one the dashboard executor applies to an
 * omitted `compareTo.dimension`: exactly one candidate is used, zero or
 * several is a loud error naming what it found. Every case is an `error`
 * because each one is a window the renderer cannot apply — a report whose
 * period selector would either fail its query or filter a column nobody
 * chose.
 *
 * ## Not judged here
 *
 *  - A report whose `dataset` resolves to nothing: `chart-dataset-unknown`
 *    owns that, once; repeating it here would report one typo twice.
 *  - A `joined` report: `ReportSchema` refuses a container `dateRange` and a
 *    block declares none, so there is no binding to resolve.
 *  - The window's `defaultRange` / `allowCustomRange`: shape, owned by the
 *    schema (the dashboard's preset table, verbatim).
 */

import { recordsOf, suggestName } from './object-graph.js';
import type { AnyRec } from './page-walk.js';

export const REPORT_DATE_RANGE_DIMENSION_UNKNOWN = 'report-date-range-dimension-unknown';
export const REPORT_DATE_RANGE_DIMENSION_NOT_DATE = 'report-date-range-dimension-not-date';
export const REPORT_DATE_RANGE_DIMENSION_AMBIGUOUS = 'report-date-range-dimension-ambiguous';
export const REPORT_DATE_RANGE_DIMENSION_NONE = 'report-date-range-dimension-none';

export interface ReportDateRangeFinding {
  severity: 'error';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `report "pipeline" · dateRange`. */
  where: string;
  /** Config path, e.g. `reports[2].dateRange.dimension`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function list(names: Iterable<string>): string {
  const all = [...names].sort();
  return all.length ? all.join(', ') : '(none)';
}

/** One dataset's dimensions, name → whether it declares `type: 'date'`. */
type DimensionTypes = Map<string, boolean>;

function indexDatasetDimensions(stack: AnyRec): Map<string, DimensionTypes> {
  const out = new Map<string, DimensionTypes>();
  for (const ds of recordsOf(stack.datasets)) {
    const name = strName(ds.name);
    if (!name) continue;
    const dims: DimensionTypes = new Map();
    for (const d of recordsOf(ds.dimensions)) {
      const n = strName(d.name);
      if (n) dims.set(n, d.type === 'date');
    }
    out.set(name, dims);
  }
  return out;
}

export function validateReportDateRange(stack: AnyRec): ReportDateRangeFinding[] {
  const findings: ReportDateRangeFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const reports = recordsOf(stack.reports);
  if (reports.length === 0) return findings;
  const datasets = indexDatasetDimensions(stack);

  for (let ri = 0; ri < reports.length; ri++) {
    const report = reports[ri];
    if (!isRec(report) || report.type === 'joined' || !isRec(report.dateRange)) continue;
    const dsName = strName(report.dataset);
    const dims = dsName ? datasets.get(dsName) : undefined;
    // Unbound or unresolvable: the shape rule and `chart-dataset-unknown` own it.
    if (!dsName || !dims) continue;

    const reportName = strName(report.name) ?? `#${ri}`;
    const where = `report "${reportName}" · dateRange`;
    const path = `reports[${ri}].dateRange`;
    const dateDims = [...dims].filter(([, isDate]) => isDate).map(([n]) => n);
    const dimension = strName(report.dateRange.dimension);

    if (dimension) {
      if (!dims.has(dimension)) {
        findings.push({
          severity: 'error',
          rule: REPORT_DATE_RANGE_DIMENSION_UNKNOWN,
          where,
          path: `${path}.dimension`,
          message: `"${dimension}" is not a dimension of dataset "${dsName}", so the report's date range has no column to apply to.`,
          hint:
            `Name a date dimension of "${dsName}" (${list(dateDims)}), or declare one with \`type: 'date'\`.` +
            suggestName(dimension, dateDims),
        });
      } else if (!dims.get(dimension)) {
        findings.push({
          severity: 'error',
          rule: REPORT_DATE_RANGE_DIMENSION_NOT_DATE,
          where,
          path: `${path}.dimension`,
          message: `dimension "${dimension}" of dataset "${dsName}" does not declare \`type: 'date'\`, so it is not a time dimension and cannot carry a date window.`,
          hint: `Declare \`type: 'date'\` on that dimension if it is a date, or name a date dimension (${list(dateDims)}).`,
        });
      }
      continue;
    }

    if (dateDims.length > 1) {
      findings.push({
        severity: 'error',
        rule: REPORT_DATE_RANGE_DIMENSION_AMBIGUOUS,
        where,
        path,
        message: `dataset "${dsName}" declares ${dateDims.length} date dimensions (${list(dateDims)}) and \`dimension\` names none, so the window has no single column.`,
        hint: `Set \`dateRange.dimension\` to the one the period applies to, e.g. \`dimension: '${[...dateDims].sort()[0]}'\`.`,
      });
    } else if (dateDims.length === 0) {
      findings.push({
        severity: 'error',
        rule: REPORT_DATE_RANGE_DIMENSION_NONE,
        where,
        path,
        message: `dataset "${dsName}" declares no \`type: 'date'\` dimension, so the report's date range has no column to apply to.`,
        hint: `Declare \`type: 'date'\` on the dataset's date dimension, or remove \`dateRange\`.`,
      });
    }
  }

  return findings;
}
