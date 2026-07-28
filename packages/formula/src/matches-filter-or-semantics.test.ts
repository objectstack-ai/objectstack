// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for the record-at-a-time evaluator.
 *
 * The cases come from `@objectstack/spec/data` so this backend, `driver-sql`,
 * `driver-memory` and `read-scope-sql` are all held to one standard — see
 * `filter-logic-conformance.ts` for why that standard exists (#3774). Adding a
 * case there adds it to all four at once; that is the point.
 *
 * Agreement matters here beyond tidiness: this evaluator decides the RLS
 * `check` clause on writes while the SQL compilers decide the `where` on reads.
 * If they disagree, a record can be writable but unreadable — or readable when
 * the scope says otherwise.
 */

import { describe, expect, it } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';

import { matchesFilterCondition as m } from './matches-filter';

describe('matchesFilterCondition — filter logic conformance', () => {
  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, () => {
      const got = FILTER_LOGIC_ROWS.filter((r) => m(r as unknown as Record<string, unknown>, c.filter)).map(
        (r) => r.id,
      );
      expect(got, c.note).toEqual(c.expected);
    });
  }
});
