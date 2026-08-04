// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5240] `{ field: {} }` — a field constrained by ZERO operators — is REFUSED
 * by `matchesFilterCondition`, with the same `INVALID_FILTER` envelope
 * `driver-sql` and `driver-memory` raise.
 *
 * # This is the RLS `check` evaluation path, so the change is observable
 *
 * `matchesFilterCondition` is what `plugin-security` runs against the POST-IMAGE
 * of an insert/update to enforce a row-level `check` — there is no query to push
 * down to, so this evaluator IS the enforcement. It answered `false` for the
 * shape from an explicit fail-closed arm (`keys.length === 0 || …`), which is
 * why the divergence never surfaced as an error: the write was simply denied.
 *
 * Refusing instead lands on the #4775 posture (a `check` that cannot be
 * evaluated fails the operation), and the direction is honest about ONE case
 * that flips outright:
 *
 * | `check` policy | before | after |
 * |---|---|---|
 * | `{ a: {} }` | `false` → write DENIED (403) | throws → write FAILS (400) |
 * | `{ $or: [ { a: {} }, { owner: '{userId}' } ] }` | the `false` disjunct was absorbed → write **ALLOWED** | throws → write FAILS |
 * | `{ $not: { a: {} } }` | `!false` → write **ALLOWED** | throws → write FAILS |
 *
 * The last two rows are writes that used to succeed and now do not. That is the
 * point of the ruling rather than a side effect of it: a permission rule whose
 * meaning depends on which of four backends evaluated it is the defect, and a
 * rule carrying `{ field: {} }` is a rule whose author lost an operator.
 */

import { describe, it, expect } from 'vitest';
import { matchesFilterCondition } from './matches-filter';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const RECORD = { id: '1', stage: 'won', owner: 'u1', amount: 10 };

const refusalOf = (filter: unknown): WireBearingError => {
  try {
    matchesFilterCondition(RECORD, filter as never);
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the evaluator to refuse this filter, but it answered');
};

describe('[#5240] matchesFilterCondition refuses a zero-operator field constraint', () => {
  const positions: Array<[string, unknown, string]> = [
    ['top level', { stage: {} }, 'filter.stage'],
    ['inside $or', { $or: [{ stage: {} }, { owner: 'u2' }] }, 'filter.$or[0].stage'],
    ['inside $and', { $and: [{ stage: 'won' }, { owner: {} }] }, 'filter.$and[1].owner'],
    ['inside $not', { $not: { stage: {} } }, 'filter.$not.stage'],
    ['nested two combinators deep', { $and: [{ $or: [{ stage: {} }] }] }, 'filter.$and[0].$or[0].stage'],
  ];

  for (const [name, filter, position] of positions) {
    it(`${name} → INVALID_FILTER naming ${position}`, () => {
      const err = refusalOf(filter);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(position);
      expect(err.message).toContain('zero operators');
    });
  }

  // ── The behaviour change, stated as tests ─────────────────────────────────

  describe('the RLS `check` consequence, pinned explicitly', () => {
    it('a check that used to DENY now fails the operation instead', () => {
      // Same outcome for the caller's data (the write does not land), different
      // failure: INVALID_FILTER names the broken policy instead of blaming the
      // writer with a permission denial.
      expect(() => matchesFilterCondition(RECORD, { stage: {} } as never)).toThrow(/zero operators/);
    });

    it('a check that used to ALLOW (the false disjunct was absorbed) now fails', () => {
      // Pre-fix: `{ a: {} }` → false, `{ owner: 'u1' }` → true, `$or` → true →
      // the write was permitted by a policy half of which was meaningless.
      expect(() => matchesFilterCondition(RECORD, { $or: [{ stage: {} }, { owner: 'u1' }] } as never))
        .toThrow(/zero operators/);
    });

    it('a check under $not that used to ALLOW now fails', () => {
      // Pre-fix: `!false` → true → permitted.
      expect(() => matchesFilterCondition(RECORD, { $not: { stage: {} } } as never)).toThrow(/zero operators/);
    });

    it('the refusal does not depend on the RECORD, so a policy is not row-dependent', () => {
      const rows = [RECORD, { id: '2', stage: 'lost', owner: 'u2', amount: 20 }, {}];
      for (const row of rows) {
        expect(() => matchesFilterCondition(row as never, { stage: 'no-match', owner: {} } as never))
          .toThrow(/zero operators/);
      }
    });
  });

  // ── The fail-closed posture is otherwise untouched ────────────────────────

  describe('every other unevaluable shape still fails CLOSED (returns false)', () => {
    it('an unknown operator', () => {
      expect(matchesFilterCondition(RECORD, { stage: { $sounds_like: 'won' } } as never)).toBe(false);
    });

    it('a nested relation object a flat record cannot satisfy', () => {
      expect(matchesFilterCondition(RECORD, { stage: { nested: 'won' } } as never)).toBe(false);
    });

    it('a bare array field spec', () => {
      expect(matchesFilterCondition(RECORD, { stage: ['won'] } as never)).toBe(false);
    });

    it('an unknown top-level operator', () => {
      expect(matchesFilterCondition(RECORD, { $nope: 1 } as never)).toBe(false);
    });

    it('a non-object filter', () => {
      expect(matchesFilterCondition(RECORD, 'x' as never)).toBe(false);
    });
  });

  describe('ordinary evaluation is byte-identical', () => {
    it('answers the same booleans as before', () => {
      expect(matchesFilterCondition(RECORD, { stage: 'won' } as never)).toBe(true);
      expect(matchesFilterCondition(RECORD, { stage: 'lost' } as never)).toBe(false);
      expect(matchesFilterCondition(RECORD, { amount: { $gt: 5 } } as never)).toBe(true);
      expect(matchesFilterCondition(RECORD, { $or: [{ stage: 'lost' }, { owner: 'u1' }] } as never)).toBe(true);
      expect(matchesFilterCondition(RECORD, { $not: { stage: 'won' } } as never)).toBe(false);
      expect(matchesFilterCondition(RECORD, {} as never)).toBe(true);
      expect(matchesFilterCondition(RECORD, null)).toBe(true);
    });

    it('an EMPTY NODE keeps its #5134 identity meaning, it is not this shape', () => {
      expect(matchesFilterCondition(RECORD, { $or: [{ stage: 'lost' }, {}] } as never)).toBe(true);
      expect(matchesFilterCondition(RECORD, { $not: {} } as never)).toBe(false);
    });

    it('a Date comparand enumerates to nothing but is NOT a zero-operator constraint', () => {
      const d = new Date('2026-01-01T00:00:00Z');
      expect(matchesFilterCondition({ due: d }, { due: d } as never)).toBe(true);
    });
  });
});
