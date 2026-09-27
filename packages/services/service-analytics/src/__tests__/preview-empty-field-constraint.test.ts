// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19835] The draft-preview matcher answered a field constraint with ZERO
 * operators — `{ name: {} }` — with EVERY row.
 *
 * `matchesWhere`'s per-field loop iterates the constraint's entries; an empty
 * object has none, so the loop never ran and the row fell through to the
 * closing `return true`. Probe at `origin/main` before the repair:
 * `matchesWhere({ name: 'Globex' }, { name: {} })` → `true`. The #19810
 * operator-vocabulary refusal could not reach it: no key, no lookup to fail.
 *
 * Every shipped driver refuses the shape (`driver-memory` / `driver-mongodb`
 * `emptyFieldConstraintError`, `driver-sql` at the top level and inside
 * combinators) — ruled on #5240, refused everywhere. So the preview charted
 * every row for a filter publish refuses outright.
 *
 * ## What this file pins
 *
 * 1. **Refused** — `INVALID_FILTER` / 400 (ADR-0112), pinned by `code` +
 *    `status`, never by a bare `toThrow()`. ⛔ Not "matches zero rows": that
 *    is the other silent reading the ruling declined.
 * 2. **Not bypassable by nesting** — under `$and`, `$or` (including the arm a
 *    short-circuit would never reach) and `$not`, and over an EMPTY seed.
 * 3. **Unchanged** — a constraint that names an operator, an implicit
 *    comparand, and an empty NODE (`{}` as the whole `where` or as a
 *    combinator arm — the identity, not a field constraint) answer exactly
 *    what they answered before.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { evaluateAnalyticsQueryOverRows, matchesWhere } from '../preview-evaluator.js';

type Refusal = Error & { code?: string; status?: number };

const ROWS: Record<string, unknown>[] = [
  { id: '1', name: 'Acme Corp', amount: 1200 },
  { id: '2', name: 'Globex', amount: 800 },
];

const CUBE: Cube = new AnalyticsService().registerDataset(
  DatasetSchema.parse({
    name: 'expense_ds',
    label: 'Expense',
    object: 'expense',
    dimensions: [{ name: 'name', field: 'name', type: 'string', label: 'Name' }],
    measures: [{ name: 'count', aggregate: 'count' }],
  }),
).cube;

function run(where: Record<string, unknown>, rows = ROWS) {
  return evaluateAnalyticsQueryOverRows(
    { cube: 'expense_ds', measures: ['count'], dimensions: ['name'], where },
    CUBE,
    rows,
  );
}

function refusalFor(thunk: () => unknown): Refusal | undefined {
  try {
    thunk();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

function namesAnswered(where: Record<string, unknown>): string[] {
  return run(where).rows.map((r) => String(r.name)).sort();
}

describe('[#19835] a field constraint with zero operators on the draft preview', () => {
  it('the card probe — `matchesWhere({ name: "Globex" }, { name: {} })` — refuses instead of matching', () => {
    const err = refusalFor(() => matchesWhere({ name: 'Globex' }, { name: {} }));
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
  });

  it('refuses a whole preview query at the top level, naming the field and its position', () => {
    const err = refusalFor(() => run({ name: {} }));
    expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    expect(err?.message).toContain('where.name');
    expect(err?.message).toContain('{ "name": {} }');
  });

  it('refuses over an EMPTY seed draft — the walk is not a function of the data', () => {
    expect(refusalFor(() => run({ name: {} }, []))).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
  });

  describe('nesting cannot route around it', () => {
    it('inside `$and`', () => {
      const err = refusalFor(() => run({ $and: [{ name: 'Globex' }, { amount: {} }] }));
      expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
      expect(err?.message).toContain('where.$and[1].amount');
    });

    it('inside `$or`, in the arm a short-circuit would never reach for a matching row', () => {
      // Row `Globex` satisfies arm 0, so a per-row walk would `some()` past arm
      // 1 and answer it; the refusal must not depend on which row is tested.
      const err = refusalFor(() => run({ $or: [{ name: 'Globex' }, { amount: {} }] }));
      expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
      expect(err?.message).toContain('where.$or[1].amount');
    });

    it('under `$not`', () => {
      const err = refusalFor(() => run({ $not: { name: {} } }));
      expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
      expect(err?.message).toContain('where.$not.name');
    });

    it('several combinators deep', () => {
      const err = refusalFor(() => run({ $and: [{ $or: [{ $not: { name: {} } }] }] }));
      expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    });

    it('through `matchesWhere` directly, under `$and`', () => {
      const err = refusalFor(() => matchesWhere({ name: 'Globex' }, { $and: [{ name: {} }] }));
      expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    });
  });

  describe('non-empty constraints answer exactly as before', () => {
    it('an operator constraint', () => {
      expect(namesAnswered({ name: { $eq: 'Globex' } })).toEqual(['Globex']);
      expect(namesAnswered({ amount: { $gt: 1000 } })).toEqual(['Acme Corp']);
      expect(matchesWhere({ name: 'Globex' }, { name: { $ne: 'Globex' } })).toBe(false);
    });

    it('an implicit-equality comparand', () => {
      expect(namesAnswered({ name: 'Globex' })).toEqual(['Globex']);
    });

    it('an empty NODE — the whole `where`, or a combinator arm — is the identity, not a field constraint', () => {
      expect(namesAnswered({})).toEqual(['Acme Corp', 'Globex']);
      expect(namesAnswered({ $and: [{}] })).toEqual(['Acme Corp', 'Globex']);
      expect(matchesWhere({ name: 'Globex' }, {})).toBe(true);
    });
  });
});
