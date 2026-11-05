// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `dataset-count-measure-empty-field-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `datasetCountMeasureEmptyFieldRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * A dataset `count` measure drops an empty `field` (protocol 18, #21220).
 *
 * A dataset measure's `field` is a column reference (`ui/dataset.zod.ts`, the
 * one accept set in `data/analytics-column-reference.ts`), so `''` is refused
 * at parse. On ONE sub-shape that refusal has a lossless repair: a measure
 * with `aggregate: 'count'` and `field: ''`. The dataset's own refinement
 * already read `''` as "no field" on a count (only `count` may omit it), the
 * analytics dataset door never judged it (it skips an empty `field`), and the
 * measure compiled to `sql: m.field ?? '*'` with the `''` intact — answered on
 * SQLite's native-SQL path as `COUNT()` (its row count) and refused on the
 * ObjectQL path. Without the key it compiles to `COUNT(*)`: the row count both
 * meant. Its producer is named: Studio's dataset inspector seeds every new
 * measure row with `field: ''`, so a count whose Field box was left blank was
 * stored that way.
 *
 * Scope — this sub-shape and nothing else. A non-count measure with `''` (the
 * refinement already refused it: only `count` may omit `field`), a dimension
 * with `''` (it groups by nothing), a padded value and every expression have no
 * working row or no mechanical rewrite; they stay as stored and the D3 entry
 * `dataset-member-field-expression-refused` carries them.
 *
 * Retired from the load path: an author is refused at parse with the
 * prescription to omit the key; data at rest and `os migrate meta` replay it.
 */
const datasetCountMeasureEmptyFieldRemoved: MetadataConversion = {
  id: 'dataset-count-measure-empty-field-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.5.0',
  surface: 'dataset.measures[].field (aggregate count, empty string)',
  summary:
    "a `count` dataset measure's empty `field` is removed: a count with no `field` counts rows, which "
    + "is what the empty string compiled to, and a measure's `field` is now a column reference that "
    + 'refuses an empty string',
  apply(stack, emit) {
    return mapCollection(stack, 'datasets', (dataset, path) => {
      const measures = dataset.measures;
      if (!Array.isArray(measures)) return dataset;
      let changed = false;
      const next = measures.map((m, i) => {
        if (!isDict(m) || m.aggregate !== 'count' || m.field !== '') return m;
        changed = true;
        return stripKeys(m, ['field'], emit, `${path}.measures[${i}]`);
      });
      return changed ? { ...dataset, measures: next } : dataset;
    });
  },
  fixture: {
    before: {
      datasets: [{
        name: 'deal_metrics',
        label: 'Deal Metrics',
        object: 'deal',
        // A dimension's empty `field` has no lossless rewrite: left as stored.
        dimensions: [{ name: 'stage', field: 'stage' }, { name: 'blank_axis', field: '' }],
        measures: [
          // The Studio-seeded shape: a count whose Field box was left blank.
          { name: 'deal_count', aggregate: 'count', field: '' },
          { name: 'won_count', aggregate: 'count', field: '', filter: { stage: 'won' } },
          // Untouched: a count over `*`, a count with no `field`, a count over a
          // column, and a `sum` over `''` (refused already, no lossless rewrite).
          { name: 'star_count', aggregate: 'count', field: '*' },
          { name: 'row_count', aggregate: 'count' },
          { name: 'owner_count', aggregate: 'count', field: 'owner' },
          { name: 'blank_sum', aggregate: 'sum', field: '' },
        ],
      }],
    },
    after: {
      datasets: [{
        name: 'deal_metrics',
        label: 'Deal Metrics',
        object: 'deal',
        dimensions: [{ name: 'stage', field: 'stage' }, { name: 'blank_axis', field: '' }],
        measures: [
          { name: 'deal_count', aggregate: 'count' },
          { name: 'won_count', aggregate: 'count', filter: { stage: 'won' } },
          { name: 'star_count', aggregate: 'count', field: '*' },
          { name: 'row_count', aggregate: 'count' },
          { name: 'owner_count', aggregate: 'count', field: 'owner' },
          { name: 'blank_sum', aggregate: 'sum', field: '' },
        ],
      }],
    },
    // One per removed `field`: the two blank counts.
    expectedNotices: 2,
  },
};

export { datasetCountMeasureEmptyFieldRemoved };
