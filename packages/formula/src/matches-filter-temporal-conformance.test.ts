// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal filter conformance for the record-at-a-time evaluator
 * (ADR-0053 D-A3).
 *
 * The shared cases come from `@objectstack/spec/data` — see
 * `temporal-conformance.ts` for the four incidents (#3650/#3773/#3777/#4047)
 * the table exists to end. This evaluator's own stake is the write-side twin
 * of #3777: a `check` policy of `{ signed_on: { $lte: '{today}' } }` against a
 * `datetime` post-image denied every write made after 00:00 until it adopted
 * the shared calendar-day rule (D-D2).
 *
 * The records are the fixture rows verbatim — canonical UTC ISO text for
 * `datetime`, bare-day text for `date` — which is exactly what an RLS `check`
 * sees in a post-image now that every driver stores one canonical form.
 *
 * Literal spellings only: this package deliberately depends on nothing but
 * `spec` (the D-D2 dependency argument), and the `{token}` resolver lives in
 * `@objectstack/core` — the token axis is swept by the five backends that can
 * reach it. By the time a filter arrives here, tokens are already resolved.
 */

import { describe, expect, it } from 'vitest';
import { TEMPORAL_CONFORMANCE_CASES, TEMPORAL_CONFORMANCE_ROWS } from '@objectstack/spec/data';

import { matchesFilterCondition as m } from './matches-filter';

const RECORDS = TEMPORAL_CONFORMANCE_ROWS.map(({ id, happened_at, happened_on }) => ({
  id,
  happened_at,
  happened_on,
}));

describe('matchesFilterCondition — temporal conformance', () => {
  for (const c of TEMPORAL_CONFORMANCE_CASES) {
    it(c.name, () => {
      const got = RECORDS.filter((r) => m(r, c.filter))
        .map((r) => r.id)
        .sort();
      expect(got, c.note).toEqual(c.expected);
    });
  }
});
