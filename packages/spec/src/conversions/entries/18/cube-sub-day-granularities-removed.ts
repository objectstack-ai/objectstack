// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `cube-sub-day-granularities-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `cubeSubDayGranularitiesRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { RETIRED_SUB_DAY_INTERVALS } from '../../../data/analytics.zod.js';
import { isDict } from '../shared.js';

/**
 * `dimensions.<dim>.granularities` — the three sub-day names `TimeUpdateInterval`
 * declared until protocol 18 (#17296, ADR-0049 enforce-or-remove).
 *
 * A VALUE strip rather than a key strip: the key stays, and the three retired
 * members are dropped from the authored list. Lossless in the only sense that
 * matters here — no backend ever bucketed them, so a cube offering `hour`
 * offered a granularity that answered 501 on `driver-memory` and
 * `driver-mongodb` and one group per distinct timestamp on the engine's
 * in-memory path. Deleting the offer preserves every observable answer.
 *
 * A dimension left with an EMPTY list after the strip drops the key entirely
 * rather than declaring `granularities: []`: the key's own meaning is "the
 * granularities this dimension offers", and an empty list is the one value
 * that reads as "none" while the absent key reads as "all", which is what the
 * cube meant before it named only sub-day ones it never had.
 */
const cubeSubDayGranularitiesRemoved: MetadataConversion = {
  id: 'cube-sub-day-granularities-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'analyticsCubes[].dimensions.<dim>.granularities',
  summary:
    "cube dimension granularities 'second' / 'minute' / 'hour' removed (ADR-0049 — no "
    + 'backend bucketed them and none could advertise them: `supports.queryDateGranularity` is a '
    + 'record over `DateGranularity`, which declares day, week, month, quarter, year. Offer the '
    + 'coarsest interval that still answers the question)',
  apply(stack, emit) {
    return mapCollection(stack, 'analyticsCubes', (cube, path) => {
      const dimensions = cube.dimensions;
      if (!isDict(dimensions)) return cube;
      let touched = false;
      const nextDimensions: Record<string, unknown> = { ...dimensions };
      for (const [name, dim] of Object.entries(dimensions)) {
        if (!isDict(dim)) continue;
        const list = dim.granularities;
        if (!Array.isArray(list)) continue;
        const kept = list.filter((g) => !(RETIRED_SUB_DAY_INTERVALS as readonly string[]).includes(g as string));
        if (kept.length === list.length) continue;
        const where = `${path}.dimensions.${name}.granularities`;
        emit({ from: JSON.stringify(list), to: kept.length > 0 ? JSON.stringify(kept) : '(removed)', path: where });
        const nextDim: Record<string, unknown> = { ...dim };
        if (kept.length > 0) nextDim.granularities = kept;
        else delete nextDim.granularities;
        nextDimensions[name] = nextDim;
        touched = true;
      }
      if (!touched) return cube;
      return { ...cube, dimensions: nextDimensions };
    });
  },
  fixture: {
    before: {
      analyticsCubes: [{
        name: 'events',
        sql: 'events',
        measures: { count: { label: 'Events', type: 'count', sql: 'id' } },
        dimensions: {
          // Mixed list — the sub-day names go, the rest stays in its order.
          created_at: {
            label: 'Created At', type: 'time', sql: 'created_at',
            granularities: ['hour', 'day', 'month'],
          },
          // Sub-day ONLY — the key goes rather than becoming an empty list.
          touched_at: {
            label: 'Touched At', type: 'time', sql: 'touched_at',
            granularities: ['second', 'minute'],
          },
          // Neither retired member nor the key at all: both ride through, and
          // the copy-on-write contract keeps the references.
          closed_at: {
            label: 'Closed At', type: 'time', sql: 'closed_at',
            granularities: ['day', 'week'],
          },
          stage: { label: 'Stage', type: 'string', sql: 'stage' },
        },
      }],
    },
    after: {
      analyticsCubes: [{
        name: 'events',
        sql: 'events',
        measures: { count: { label: 'Events', type: 'count', sql: 'id' } },
        dimensions: {
          created_at: {
            label: 'Created At', type: 'time', sql: 'created_at',
            granularities: ['day', 'month'],
          },
          touched_at: {
            label: 'Touched At', type: 'time', sql: 'touched_at',
          },
          closed_at: {
            label: 'Closed At', type: 'time', sql: 'closed_at',
            granularities: ['day', 'week'],
          },
          stage: { label: 'Stage', type: 'string', sql: 'stage' },
        },
      }],
    },
    // Two notices: the mixed list and the sub-day-only one. The two untouched
    // dimensions are the fixture's own control — they prove the walk dispatches
    // on a retired MEMBER rather than on the key's presence.
    expectedNotices: 2,
  },
};

export { cubeSubDayGranularitiesRemoved };
