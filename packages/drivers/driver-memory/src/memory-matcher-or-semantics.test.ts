// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for the in-memory matcher.
 *
 * The cases come from `@objectstack/spec/data` so this backend, `driver-sql`,
 * `formula`'s `matchesFilterCondition` and `read-scope-sql` are all held to one
 * standard — see `filter-logic-conformance.ts` for why that standard exists
 * (#3774). Adding a case there adds it to all four at once; that is the point.
 */

import { describe, it, expect } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';

import { match } from './memory-matcher.js';

describe('memory-matcher — filter logic conformance', () => {
  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, () => {
      const got = FILTER_LOGIC_ROWS.filter((r) => match(r, c.filter)).map((r) => r.id);
      expect(got, c.note).toEqual(c.expected);
    });
  }
});
