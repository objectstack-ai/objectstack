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
 * Type-blind, like `formula`: it evaluates a bare row with no schema, so both
 * the `datetime` and `date` cases run against the raw string values.
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

describe('preview-evaluator — temporal conformance', () => {
  for (const c of TEMPORAL_CASES) {
    it(c.name, () => {
      const got = TEMPORAL_ROWS.filter((r) => matchesWhere(r as any, c.filter as any)).map((r) => r.id);
      expect(got, c.note).toEqual(c.expected);
    });

    it(`${c.name} — on a native-writer (BSON Date) row population`, () => {
      const got = nativeRows.filter((r) => matchesWhere(r as any, c.filter as any)).map((r) => r.id);
      expect(got, c.note).toEqual(c.expected);
    });

    // The D-A3 token axis (#4081): the same case spelled in relative tokens,
    // resolved at the pinned instant, must reach the same rows.
    if (c.tokenFilter) {
      it(`${c.name} — via relative tokens`, () => {
        const where = resolveTokens(c.tokenFilter);
        const got = TEMPORAL_ROWS.filter((r) => matchesWhere(r as any, where as any)).map((r) => r.id);
        expect(got, c.note).toEqual(c.expected);
      });
    }
  }
});

describe('preview-evaluator — timeDimensions.dateRange temporal conformance', () => {
  // The dashboard-window path — the surface #3650 broke (the range was
  // dropped entirely and every row charted). Windows tagged with a
  // `dateRange` spelling run through the full evaluator, grouped by `id` so
  // the output rows ARE the matched row ids.
  const CUBE = {
    name: 'conformance_ds',
    sql: 'conformance',
    dimensions: { id: { name: 'id', type: 'string', sql: 'id' } },
    measures: { count: { name: 'count', type: 'count', sql: '*' } },
  } as unknown as Cube;

  for (const c of TEMPORAL_CASES) {
    if (!c.dateRange) continue;
    it(`${c.name} — via timeDimensions.dateRange`, () => {
      const result = evaluateAnalyticsQueryOverRows(
        {
          measures: ['count'],
          dimensions: ['id'],
          timeDimensions: [{ dimension: c.field, dateRange: resolveTokens(c.dateRange) }],
        },
        CUBE,
        TEMPORAL_ROWS.map((r) => ({ ...r })),
      );
      const got = result.rows.map((r) => String(r.id)).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

describe('preview-evaluator — Field.time conformance', () => {
  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, () => {
      const got = TEMPORAL_TIME_ROWS.filter((r) => matchesWhere(r as any, c.filter as any)).map((r) => r.id);
      expect(got, c.note).toEqual(c.expected);
    });
  }
});
