// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `report-joined-chart-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `reportJoinedChartRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * A `joined` report's `chart` leaves, at both of its coordinates (protocol 18,
 * #20161 — ADR-0049 enforce-or-remove; triage direction "retire, premise
 * first", the premise measured clean: zero joined reports with a `chart` in
 * this repo's examples, in the showcase, or in hotcrm).
 *
 * Nothing ever drew either one. At this repo's `.objectui-sha` pin
 * `f8a9d0fb0596f4521076628e2bbfe27e6ce67d52`, `DatasetReportRenderer`'s joined
 * branch draws each block as a table and returns before the one `report.chart`
 * read below it, and there is no read of a block's `chart` anywhere
 * (`block.chart`: zero hits over objectui `packages/`, against a lit
 * `block.runtimeFilter` control). So both were pure no-ops, and deleting them
 * is lossless: the document changes, not a pixel of the rendered report.
 *
 * Two coordinates, one entry, because they are one retirement — an author
 * upgrading a joined report carries both together:
 *
 *   - `reports[].blocks[].chart` — REMOVED from `JoinedReportBlockSchema`'s
 *     closed shape (its `guidance` table carries the prescription). Stripped
 *     on every report, not only a `joined` one: the block shape is the same
 *     schema whatever the container's type, so a block chart is refused under
 *     any container.
 *   - `reports[].chart` on a `type: 'joined'` report — still DECLARED (it is
 *     the live embedded chart of every non-joined report) and refused by the
 *     joined arm of `ReportSchema`'s refinement. Stripped only there.
 *
 * `retiredFromLoadPath`: a live author is refused at parse with the
 * prescription rather than silently rewritten. The entry exists so stored
 * `sys_metadata` report rows written through the Studio form (which offered a
 * block `chart` input until this change) replay clean through
 * `applyConversionsToStoredItem`, and so `os migrate meta --from 17` lists the
 * mechanical edits for author sources. `stripKeys`-shaped deletion is
 * idempotent by construction.
 *
 * ⚠️ Overlap with `chart-config-aria-removed`, which strips `aria` INSIDE a
 * block chart and runs earlier in this chain: on a stored block chart carrying
 * `aria`, that entry strips `aria` and this one then strips the whole `chart` —
 * the compound result is the same document this entry alone produces. Its
 * fixture therefore no longer carries a block chart (the fixture-disjointness
 * contract), and its apply is left as it shipped.
 */
const reportJoinedChartRemoved: MetadataConversion = {
  id: 'report-joined-chart-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'report.blocks[].chart / report.chart on a joined report',
  summary:
    "a joined report's 'chart' removed from its blocks and refused on the container (ADR-0049 "
    + 'enforce-or-remove: the joined renderer draws each block as a table and never read '
    + 'either, so the chart parsed and nothing was plotted; a non-joined report keeps its live '
    + "'chart')",
  apply(stack, emit) {
    return mapCollection(stack, 'reports', (r, path) => {
      const own = r.type === 'joined' ? stripKeys(r, ['chart'], emit, path) : r;
      const blocks = own.blocks;
      if (!Array.isArray(blocks)) return own;
      let touched = false;
      const rebuilt = blocks.map((b, i) => {
        if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
        const next = stripKeys(b as Record<string, unknown>, ['chart'], emit, `${path}.blocks[${i}]`);
        if (next !== b) touched = true;
        return next;
      });
      if (!touched) return own;
      return { ...own, blocks: rebuilt };
    });
  },
  fixture: {
    before: {
      reports: [
        {
          name: 'task_overview',
          type: 'joined',
          chart: { type: 'bar', xAxis: 'status', yAxis: 'task_count' },
          blocks: [
            {
              name: 'open_block',
              dataset: 'task_metrics',
              rows: ['status'],
              values: ['task_count'],
              chart: { type: 'pie', xAxis: 'status', yAxis: 'task_count' },
            },
            // A block with nothing to strip keeps its identity (copy-on-write).
            { name: 'done_block', dataset: 'task_metrics', rows: ['status'], values: ['task_count'] },
          ],
        },
        // A NON-joined report keeps its container `chart`: it is the live
        // embedded chart there.
        {
          name: 'hours_by_status',
          type: 'summary',
          dataset: 'task_metrics',
          rows: ['status'],
          values: ['est_hours'],
          chart: { type: 'bar', xAxis: 'status', yAxis: 'est_hours' },
        },
      ],
    },
    after: {
      reports: [
        {
          name: 'task_overview',
          type: 'joined',
          blocks: [
            { name: 'open_block', dataset: 'task_metrics', rows: ['status'], values: ['task_count'] },
            { name: 'done_block', dataset: 'task_metrics', rows: ['status'], values: ['task_count'] },
          ],
        },
        {
          name: 'hours_by_status',
          type: 'summary',
          dataset: 'task_metrics',
          rows: ['status'],
          values: ['est_hours'],
          chart: { type: 'bar', xAxis: 'status', yAxis: 'est_hours' },
        },
      ],
    },
    // One per stripped SITE — the joined container's chart and one block's.
    expectedNotices: 2,
  },
};

export { reportJoinedChartRemoved };
