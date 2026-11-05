// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0021 — semantic layer] A report's `runtimeFilter` keys resolve on the
 * bound dataset's object graph (#29900).
 *
 * A report's `runtimeFilter` is ANDed into its dataset query exactly as a
 * dashboard widget's own `filter` is (`DatasetReportRenderer` hands it to the
 * dataset door as the selection's `runtimeFilter`), and the dataset door refuses
 * a key it cannot bind with `400` — every reader of the report then sees a
 * "Dataset query failed" panel instead of numbers. The dashboard twin,
 * `widget-filter-field-unknown`, has refused the identical key at publish since
 * #14148; until this rule a report was the one consumer of the same dataset
 * query that shipped it broken.
 *
 * ## One rule, the twin's resolver
 *
 * - `report-filter-field-unknown` (`error`) — a key of the report's
 *   `runtimeFilter` (or of a joined block's) resolves to no column on the bound
 *   dataset's object graph, and names no dimension of that dataset.
 *
 * The judgement is {@link judgeDatasetFilterKeys}, the function the dashboard
 * twin calls, so the two positions accept the same keys: every authored filter
 * shape (`$and` / `$or` / `$not`, the `{ field, operator }` rule, the
 * `[field, op, value]` triple), dotted relationship paths, and the three skips
 * every field-existence rule in this package takes (an object this stack does
 * not define, one with no readable field map, a registry-injected system
 * column). One addition, never a refusal the twin does not make: a bare key
 * that names a DIMENSION of the bound dataset is accepted, because the dataset
 * door resolves a bare `where` key through the cube's members first
 * (`dataset-filter-field-binding.ts`, «a key naming only a dimension still
 * resolves through that dimension»).
 *
 * ## Which dataset a filter is judged against
 *
 *  - A non-joined report: its own `dataset`.
 *  - A `joined` report: each block's own `dataset`, for the block's
 *    `runtimeFilter` AND for the container's — the renderer merges the
 *    report-level `runtimeFilter` into every block's query
 *    (`DatasetReportRenderer`: `mergeFilters(outerFilter, block.runtimeFilter)`),
 *    so a container key a block's object lacks breaks that block.
 *
 * ## Not judged here
 *
 *  - A `dataset` that resolves to nothing: `chart-dataset-unknown` owns that
 *    typo, once.
 *  - A dotted key that resolves but whose relationship prefix the dataset's
 *    `include` does not declare: the twin's `widget-filter-field-not-included`
 *    question, not this card's.
 */

import { indexServedObjectGraph, recordsOf } from './object-graph.js';
import type { AnyRec } from './page-walk.js';
import { indexResolvableDatasets, judgeDatasetFilterKeys } from './validate-widget-bindings.js';

export const REPORT_FILTER_FIELD_UNKNOWN = 'report-filter-field-unknown';

export interface ReportRuntimeFilterFinding {
  severity: 'error';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `report "pipeline"` or `report "x" · block "y"`. */
  where: string;
  /** Config path, e.g. `reports[2].runtimeFilter.stage`. */
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

export function validateReportRuntimeFilters(stack: AnyRec): ReportRuntimeFilterFinding[] {
  const findings: ReportRuntimeFilterFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const reports = recordsOf(stack.reports);
  if (reports.length === 0) return findings;
  const datasets = indexResolvableDatasets(stack);
  const graph = indexServedObjectGraph(stack);

  const judge = (filter: unknown, path: string, dsName: string | undefined, where: string): void => {
    if (filter === undefined || filter === null) return;
    const dataset = dsName ? datasets.get(dsName) : undefined;
    // Unbound or unresolvable: the shape rule and `chart-dataset-unknown` own it.
    if (!dsName || !dataset) return;
    const dimensions = new Set<string>();
    for (const d of recordsOf(dataset.dimensions)) {
      const n = strName(d.name);
      if (n) dimensions.add(n);
    }
    for (const verdict of judgeDatasetFilterKeys(graph, dataset, filter, path)) {
      if (verdict.kind !== 'unknown') continue;
      if (dimensions.has(verdict.field)) continue; // the cube binds a dimension name
      findings.push({
        severity: 'error',
        rule: REPORT_FILTER_FIELD_UNKNOWN,
        where,
        path: verdict.path,
        message: verdict.message,
        hint:
          `Filter on a field of "${verdict.object}" (dataset "${dsName}"), a dimension of that dataset, ` +
          `or a relationship path whose prefix its \`include\` declares.`,
      });
    }
  };

  for (let ri = 0; ri < reports.length; ri++) {
    const report = reports[ri];
    if (!isRec(report)) continue;
    const reportName = strName(report.name) ?? `#${ri}`;
    const path = `reports[${ri}]`;

    if (report.type !== 'joined') {
      judge(report.runtimeFilter, `${path}.runtimeFilter`, strName(report.dataset), `report "${reportName}"`);
      continue;
    }

    const blocks = Array.isArray(report.blocks) ? report.blocks : [];
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      if (!isRec(block)) continue;
      const where = `report "${reportName}" · block "${strName(block.name) ?? `#${bi}`}"`;
      const dsName = strName(block.dataset);
      judge(report.runtimeFilter, `${path}.runtimeFilter`, dsName, where);
      judge(block.runtimeFilter, `${path}.blocks[${bi}].runtimeFilter`, dsName, where);
    }
  }

  return findings;
}
