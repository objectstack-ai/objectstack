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

describe('preview-evaluator — temporal conformance', () => {
  for (const c of TEMPORAL_CASES) {
    it(c.name, () => {
      const got = TEMPORAL_ROWS.filter((r) => matchesWhere(r as any, c.filter as any)).map((r) => r.id);
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
