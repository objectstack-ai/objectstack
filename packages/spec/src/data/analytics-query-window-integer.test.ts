// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21365] An analytics query's row window — `limit` and `offset` — is a
 * non-negative integer each, on every schema that carries it.
 *
 * ## The shape this closes
 *
 * Both were a bare `z.number()`, and every value outside the non-negative
 * integers had no single answer. Measured at `POST /api/v1/analytics/query`
 * (the real dispatcher route, `AnalyticsServicePlugin` over a real `ObjectQL`
 * engine and `SqlDriver`) on `main` `ee75aae1a`, SQLite and PostgreSQL 16.14:
 *
 * | window | native SQLite | native PostgreSQL | ObjectQL face |
 * |:--|:--|:--|:--|
 * | `limit: -1` | every row | 500 | all but the last row |
 * | `limit: 1.5` | 500 | 2 rows | 1 row |
 * | `offset: -1` | 500 | 500 | every row |
 *
 * The schema now refuses each of them, and the route answers
 * `400 VALIDATION_FAILED` before any engine runs (pinned at the route in
 * `packages/runtime/src/analytics-query-window-validity.test.ts`).
 *
 * ## The three schemas, and why each is asserted
 *
 * `AnalyticsQuerySchema` declares the two fields. `AnalyticsQueryRequestSchema`
 * (the `/analytics/query` and `/analytics/sql` body) extends it, and
 * `DatasetSelectionSchema` (the `/analytics/dataset/query` selection) reads the
 * two declarations off its `shape`. One declaration, three doors: the identity
 * pin below is what makes "no second declaration" a fact rather than a claim.
 *
 * A refusal is asserted by the issue's path and code — the named subject and
 * the kind — never by zod's message. An acceptance is a whole `safeParse`
 * success, because this is a value verdict (an `unrecognized_keys`-free parse
 * would say nothing about the value).
 */

import { describe, it, expect } from 'vitest';

import { AnalyticsQuerySchema } from './analytics.zod';
import { AnalyticsQueryRequestSchema, DatasetSelectionSchema } from '../api/analytics.zod';

type Parser = { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; code: string }> } } };

/** Each door with the smallest body it accepts. */
const DOORS: ReadonlyArray<[string, Parser, Record<string, unknown>]> = [
  ['AnalyticsQuerySchema', AnalyticsQuerySchema as unknown as Parser, { measures: ['orders.count'] }],
  ['AnalyticsQueryRequestSchema', AnalyticsQueryRequestSchema as unknown as Parser, { cube: 'orders', measures: ['count'] }],
  ['DatasetSelectionSchema', DatasetSelectionSchema as unknown as Parser, { measures: ['revenue'] }],
];

/** The values with no single answer, the key each sits on, and the zod issue code it raises. */
const REFUSED: ReadonlyArray<[string, Record<string, unknown>, 'limit' | 'offset', string]> = [
  ['a negative limit', { limit: -1 }, 'limit', 'too_small'],
  ['a fractional limit', { limit: 1.5 }, 'limit', 'invalid_type'],
  ['a negative offset', { offset: -1 }, 'offset', 'too_small'],
  ['a fractional offset', { offset: 1.5 }, 'offset', 'invalid_type'],
];

/** CONTROL: integer windows — the offset-only one included, which is valid and rendered per dialect, never refused. */
const ACCEPTED: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['a limit and an offset', { limit: 2, offset: 1 }],
  ['limit 0 (no rows, as LIMIT 0)', { limit: 0 }],
  ['offset 0', { offset: 0 }],
  ['an offset with no limit', { offset: 1 }],
  ['no window at all', {}],
];

for (const [name, schema, base] of DOORS) {
  describe(`${name} — the window is a non-negative integer`, () => {
    for (const [label, window, key, code] of REFUSED) {
      it(`refuses ${label} at \`${key}\``, () => {
        const r = schema.safeParse({ ...base, ...window });
        expect(r.success, `expected a refusal of ${JSON.stringify(window)}`).toBe(false);
        const issues = r.error!.issues;
        expect(issues).toHaveLength(1);
        expect(issues[0].path).toEqual([key]);
        expect(issues[0].code).toBe(code);
      });
    }

    for (const [label, window] of ACCEPTED) {
      it(`CONTROL accepts ${label}`, () => {
        const r = schema.safeParse({ ...base, ...window });
        expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      });
    }
  });
}

describe('the dataset selection holds the query\'s own declarations, not a copy', () => {
  it('`limit` and `offset` on DatasetSelectionSchema are the AnalyticsQuerySchema instances', () => {
    expect(DatasetSelectionSchema.shape.limit).toBe(AnalyticsQuerySchema.shape.limit);
    expect(DatasetSelectionSchema.shape.offset).toBe(AnalyticsQuerySchema.shape.offset);
  });
});
