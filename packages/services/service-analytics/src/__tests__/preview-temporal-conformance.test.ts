// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the draft-preview evaluator (ADR-0053 D-A3).
 *
 * The cases come from `@objectstack/spec/data` so this backend, the three
 * drivers and `formula`'s write-side `check` evaluator are all held to one
 * standard — see `temporal-conformance.ts` for the four divergences that
 * standard exists to prevent.
 *
 * This surface has its own reason to care: a Live Canvas dashboard charts REAL
 * numbers from DRAFTED seed data, and publish materialises the same seed. If
 * the preview and the driver disagree about a window, the numbers jump across
 * the publish boundary — the continuity the preview exists to provide.
 *
 * [ADR-0053 D-D1, amended — #5930 step 4] The whole-day bound is the shared
 * lowering's on this face, applied by `evaluateAnalyticsQueryOverRows` with the
 * drafted object's declared types (`queryDataset` hands it `sourceFieldMeta`);
 * the matcher compares what it is handed. So the matrix runs through the
 * evaluator twice: with the declared types (`at` a `datetime`, `on` a `date`),
 * the reader production hands it, and with none, where every column reads
 * type-blind (item 7). Both readers must answer every case. The `Field.time`
 * cases carry no bare day, so the matcher answers them as written.
 */

import { describe, it, expect } from 'vitest';
import {
  TEMPORAL_CASES,
  TEMPORAL_NOW,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
} from '@objectstack/spec/data';
import type { Cube } from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { evaluateAnalyticsQueryOverRows, matchesWhere } from '../preview-evaluator.js';

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

/**
 * The storage-form axis on a type-blind surface (#4191).
 *
 * There is no storage to inject into here, but the same cross-type pairing
 * arrives all the same, and not synthetically: `Field.datetime`'s storage form
 * is a BSON `Date` on `driver-mongodb` (D-E2), so rows fetched from a
 * mongo-backed dataset reach this evaluator as `Date` objects while the
 * comparands stay wire text. The shared `writerForm` tag names exactly that
 * population.
 *
 * Measured before the fix: 10 of the 16 shared cases diverged — and in BOTH
 * directions, which is what makes this surface's variant nastier than the
 * drivers'. `String(new Date())` is `'Mon Jul 27 2026 …'`, which sorts after
 * every `'2026-…'` comparand, so a window dropped rows that belong in it and
 * admitted rows that do not. A drafted chart therefore showed numbers that
 * changed at publish — precisely the continuity this evaluator exists to
 * provide.
 */
const nativeRows = TEMPORAL_ROWS.map((r) => ({
  ...r,
  at: r.writerForm === 'native' ? new Date(r.at) : r.at,
}));

const CUBE = {
  name: 'conformance_ds',
  sql: 'conformance',
  dimensions: { id: { type: 'string', sql: 'id' } },
  measures: { count: { type: 'count', sql: '*' } },
} as unknown as Cube;

const READERS: Array<[string, ((field: string) => string | undefined) | undefined]> = [
  ['the declared types', (field) => (field === 'at' ? 'datetime' : field === 'on' ? 'date' : undefined)],
  ['no declared type (type-blind)', undefined],
];

/** The ids a query selects through the evaluator, grouped by `id` so the output rows ARE the ids. */
const idsFor = (
  rest: Record<string, unknown>,
  rows: ReadonlyArray<Record<string, unknown>>,
  declaredType: ((field: string) => string | undefined) | undefined,
): string[] =>
  evaluateAnalyticsQueryOverRows(
    { measures: ['count'], dimensions: ['id'], ...rest } as never,
    CUBE,
    rows.map((r) => ({ ...r })),
    declaredType,
  ).rows.map((r) => String(r.id)).sort();

for (const [reader, declaredType] of READERS) {
  describe(`preview-evaluator — temporal conformance, read with ${reader}`, () => {
    for (const c of TEMPORAL_CASES) {
      const expected = [...c.expected].sort();
      it(c.name, () => {
        expect(idsFor({ where: c.filter }, TEMPORAL_ROWS as never, declaredType), c.note).toEqual(expected);
      });

      it(`${c.name} — on a native-writer (BSON Date) row population`, () => {
        expect(idsFor({ where: c.filter }, nativeRows as never, declaredType), c.note).toEqual(expected);
      });

      // The D-A3 token axis (#4081): the same case spelled in relative tokens,
      // resolved at the pinned instant, must reach the same rows.
      if (c.tokenFilter) {
        it(`${c.name} — via relative tokens`, () => {
          expect(idsFor({ where: resolveTokens(c.tokenFilter) }, TEMPORAL_ROWS as never, declaredType), c.note).toEqual(expected);
        });
      }

      // The dashboard-window path — the surface #3650 broke (the range was
      // dropped entirely and every row charted).
      if (c.dateRange) {
        it(`${c.name} — via timeDimensions.dateRange`, () => {
          const window = { timeDimensions: [{ dimension: c.field, dateRange: resolveTokens(c.dateRange) }] };
          expect(idsFor(window, TEMPORAL_ROWS as never, declaredType), c.note).toEqual(expected);
          expect(idsFor(window, nativeRows as never, declaredType), `${c.note} (BSON Date rows)`).toEqual(expected);
        });
      }
    }
  });
}

describe('preview-evaluator — Field.time conformance', () => {
  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, () => {
      const got = TEMPORAL_TIME_ROWS.filter((r) => matchesWhere(r as any, c.filter as any)).map((r) => r.id);
      expect(got, c.note).toEqual(c.expected);
    });
  }
});
