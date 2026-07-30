// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the RLS write-side `check` evaluator (ADR-0053 D-A3).
 *
 * The cases come from `@objectstack/spec/data` so this backend, the three
 * drivers and the analytics preview are all held to one standard — see
 * `temporal-conformance.ts` for the four divergences that standard exists to
 * prevent. Adding a case there adds it here.
 *
 * This evaluator is type-blind: it sees a bare record with no schema, so both
 * the `datetime` and `date` cases run against the raw string values. That both
 * kinds pass unmodified is itself the assertion — it is what lets the rule be
 * applied without a field-type lookup on this surface.
 */

import { describe, it, expect } from 'vitest';
import { TEMPORAL_CASES, TEMPORAL_ROWS } from '@objectstack/spec/data';

import { matchesFilterCondition } from './matches-filter';

describe('matchesFilterCondition — temporal conformance', () => {
  for (const c of TEMPORAL_CASES) {
    it(c.name, () => {
      const got = TEMPORAL_ROWS.filter((r) => matchesFilterCondition(r, c.filter)).map((r) => r.id);
      expect(got, c.note).toEqual(c.expected);
    });
  }
});

/**
 * The matrix's relative-token axis (`TEMPORAL_TOKEN_CASES`) is deliberately NOT
 * run here, and the reason is architectural rather than a gap in coverage.
 *
 * This evaluator's filters come from `compileCelToFilter`: an RLS `check` is a
 * CEL expression, where a relative date is the *function* `today()` evaluated
 * during compilation. A `{token}` string never reaches it — `resolveFilterTokens`
 * runs on the ObjectQL read path (`engine.ts`), which the write-side `check` does
 * not go through.
 *
 * Asserting the axis here would therefore test a shape this backend cannot be
 * handed; if that ever changes — if a `check` gains a token-bearing filter form —
 * this comment is the thing to delete, and the axis is already sitting in spec
 * ready to be consumed.
 */
