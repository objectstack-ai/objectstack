// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `metric-filters-removed` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `metricFiltersRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `measures.<metric>.filters` — a declared per-metric raw-SQL filter with zero
 * consumers (#10414, ADR-0049 enforce-or-remove). Both SQL strategies
 * (`NativeSQLStrategy.resolveMeasureSql`, `ObjectQLStrategy.
 * resolveMeasureAggregation`) aggregate the metric's `sql` and never read
 * `filters`, so an authored `filters: [{ sql: "stage = 'closed_won'" }]`
 * parsed, registered, and silently returned the UNFILTERED aggregate under the
 * author's metric name — the #10298 dataset shape for a hand-authored cube.
 * The strip is a pure lossless delete: the key never had an effect to lose,
 * and deleting it preserves observed behaviour exactly. Metrics live in the
 * cube's `measures` RECORD (keyed by name), one level below the collection
 * item, so the top-level-only `stripKeys` runs per metric, not per cube.
 */
const metricFiltersRemoved: MetadataConversion = {
  id: 'metric-filters-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.1.0',
  surface: 'analyticsCubes[].measures.<metric>.filters',
  summary:
    "cube metric key 'filters' removed (ADR-0049 — no strategy ever read it: the "
    + 'authored raw-SQL condition was parsed and dropped, and the query returned the '
    + "unfiltered aggregate. Filter at query time with `where`, or use an ADR-0021 dataset "
    + "measure's structured `filter`; a metric's own `sql` is a column reference)",
  apply(stack, emit) {
    return mapCollection(stack, 'analyticsCubes', (cube, path) => {
      const measures = cube.measures;
      if (!isDict(measures)) return cube;
      let touched = false;
      const nextMeasures: Record<string, unknown> = { ...measures };
      for (const [name, metric] of Object.entries(measures)) {
        if (!isDict(metric)) continue;
        const stripped = stripKeys(metric, ['filters'], emit, `${path}.measures.${name}`);
        if (stripped === metric) continue;
        nextMeasures[name] = stripped;
        touched = true;
      }
      if (!touched) return cube;
      return { ...cube, measures: nextMeasures };
    });
  },
  fixture: {
    before: {
      analyticsCubes: [{
        name: 'orders',
        sql: 'orders',
        measures: {
          // The card's measured shape: parsed, registered, returned unfiltered.
          closed_won_revenue: {
            label: 'Closed-Won Revenue',
            type: 'sum',
            sql: 'amount',
            filters: [{ sql: "stage = 'closed_won'" }],
          },
          // A metric WITHOUT the key rides through untouched — the strip
          // dispatches on key presence, and the copy-on-write contract keeps
          // the reference.
          order_count: { label: 'Orders', type: 'count', sql: 'id' },
        },
        dimensions: {
          stage: { label: 'Stage', type: 'string', sql: 'stage' },
        },
      }],
    },
    after: {
      analyticsCubes: [{
        name: 'orders',
        sql: 'orders',
        measures: {
          closed_won_revenue: {
            label: 'Closed-Won Revenue',
            type: 'sum',
            sql: 'amount',
          },
          order_count: { label: 'Orders', type: 'count', sql: 'id' },
        },
        dimensions: {
          stage: { label: 'Stage', type: 'string', sql: 'stage' },
        },
      }],
    },
    // One notice: the single metric carrying `filters`.
    expectedNotices: 1,
  },
};

export { metricFiltersRemoved };
