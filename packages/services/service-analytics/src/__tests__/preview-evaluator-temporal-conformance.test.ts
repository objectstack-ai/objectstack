// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal filter conformance for the dataset draft preview evaluator
 * (ADR-0053 D-A3).
 *
 * The shared cases come from `@objectstack/spec/data` — see
 * `temporal-conformance.ts` for the four incidents (#3650/#3773/#3777/#4047)
 * the table exists to end. The preview's stake: a drafted chart must show the
 * same numbers the published one computes through the engine strategies, so
 * this evaluator has to agree with every driver about what a temporal filter
 * matches — #3777's whole-day rule included.
 *
 * Two sweeps, because the preview has two temporal surfaces:
 *   1. `matchesWhere` — the Mongo-style `where` subset, run over the fixture
 *      rows in their canonical read forms (literal and token spellings). Its
 *      DSL subset has no `$between`, and unknown operators are deliberately
 *      permissive there, so `operator: 'between'` cases are excluded rather
 *      than vacuously passed.
 *   2. `timeDimensions.dateRange` via `evaluateAnalyticsQueryOverRows` — the
 *      dashboard window path, the surface #3650 broke (the range was dropped
 *      entirely and every row charted).
 */

import { describe, expect, it } from 'vitest';
import {
  TEMPORAL_CONFORMANCE_CASES,
  TEMPORAL_CONFORMANCE_NOW,
  TEMPORAL_CONFORMANCE_ROWS,
} from '@objectstack/spec/data';
import type { Cube } from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';

import { evaluateAnalyticsQueryOverRows, matchesWhere } from '../preview-evaluator.js';

const ROWS = TEMPORAL_CONFORMANCE_ROWS.map(({ id, happened_at, happened_on }) => ({
  id,
  happened_at,
  happened_on,
}));

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_CONFORMANCE_NOW) });

const matchIds = (where: Record<string, unknown>) =>
  ROWS.filter((r) => matchesWhere(r, where))
    .map((r) => r.id)
    .sort();

describe('preview-evaluator matchesWhere — temporal conformance', () => {
  // `$between` is not part of the preview's where subset (unknown operators
  // are permissive by design in a read-only preview), so those cases would
  // pass vacuously — the spec table tags them so consumers like this one can
  // exclude them visibly instead.
  const CASES = TEMPORAL_CONFORMANCE_CASES.filter((c) => c.operator !== 'between');

  for (const c of CASES) {
    it(c.name, () => {
      expect(matchIds(c.filter as Record<string, unknown>), c.note).toEqual(c.expected);
    });

    if (c.tokenFilter) {
      it(`${c.name} — via relative tokens`, () => {
        expect(matchIds(resolveTokens(c.tokenFilter) as Record<string, unknown>), c.note).toEqual(c.expected);
      });
    }
  }
});

describe('preview-evaluator timeDimensions.dateRange — temporal conformance', () => {
  const CUBE = {
    name: 'task_ds',
    sql: 'task',
    dimensions: { id: { name: 'id', type: 'string', sql: 'id' } },
    measures: { count: { name: 'count', type: 'count', sql: '*' } },
  } as unknown as Cube;

  const FIELD = { date: 'happened_on', datetime: 'happened_at' } as const;

  for (const c of TEMPORAL_CONFORMANCE_CASES) {
    if (!c.dateRange) continue;
    it(`${c.name} — via timeDimensions.dateRange`, () => {
      const result = evaluateAnalyticsQueryOverRows(
        {
          measures: ['count'],
          dimensions: ['id'],
          timeDimensions: [{ dimension: FIELD[c.fieldType], dateRange: resolveTokens(c.dateRange) }],
        },
        CUBE,
        ROWS,
      );
      const got = result.rows.map((r) => String(r.id)).sort();
      expect(got, c.note).toEqual(c.expected);
    });
  }
});
