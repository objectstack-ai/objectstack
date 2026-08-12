// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5222] Cross-path conformance: one `{ $field }` filter, two execution
 * paths, the same rows.
 *
 * This is the acceptance face of the issue. #5041 measured a capability that
 * existed on ONE path — `compileCelToFilter` emits `{ $field: path }` for a
 * field-to-field comparison in a CEL permission/RLS rule, the in-memory
 * evaluator resolves it, and SQL push-down answered 400 — so one permission
 * rule had two behaviours chosen by whether the query reached a database. This
 * suite is what makes the new compilation *equivalent* rather than merely
 * present: every case runs through `@objectstack/formula`'s
 * `matchesFilterCondition` AND through this driver, against the SAME seeded
 * rows, and both are held to the same declared id list.
 *
 * ## Why both paths are asserted against `expected`, not just against each other
 *
 * Two paths agreeing proves nothing on its own — they can agree on a wrong
 * answer, and a bug in the fixture makes them agree trivially. The declared
 * `expected` list is a third, independent statement of the semantics, so a
 * case fails loudly when both paths drift together. It is the same discipline
 * `filter-logic-conformance` applies for the combinators.
 *
 * ## The NULL rows are the point
 *
 * SQL is three-valued and the memory evaluator is two-valued JS, and that is
 * the ONE place these paths can genuinely diverge. The corpus therefore
 * carries every NULL arrangement two columns can be in (rows 4-6), and
 * `$eq`/`$ne` over row 6 — both columns NULL — is the case a naive `a = b`
 * lowering gets wrong. See `cross-field-conformance-cases.ts`.
 *
 * The refusal arm is asserted here too, in the same file and against the same
 * fixture: the boundary is only defensible while the supported arm is proven,
 * so the two halves are read together rather than filed apart.
 *
 * ## The DIALECT axis, and why this suite runs it
 *
 * Every sweep below runs once per cell of `DIALECT_CELLS` — SQLite always,
 * live Postgres and MySQL when the runner provisions them (ADR-0053 D-A3's
 * "Postgres at minimum", and the reason `live-dialect-matrix.testkit.ts`
 * exists rather than a hard-coded `client: 'better-sqlite3'` per suite).
 *
 * It earns the axis rather than inheriting it by convention. A cross-field
 * predicate is the one filter shape whose SQL text carries TWO identifiers and
 * no bound value, so it exercises per-dialect identifier quoting where an
 * ordinary comparison exercises parameter binding. And the type rule this
 * capability enforces has a genuinely different failure per dialect: comparing
 * a text column to a numeric one is a silent wrong answer on SQLite (storage
 * classes order before values), while Postgres raises an operator-does-not-
 * exist error outright. The class guard is what neither backend ever gets to
 * see — a matrix is how that stays true.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { matchesFilterCondition } from '@objectstack/formula';
import { parseFilterAST, type FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './index.js';
import { DIALECT_CELLS, declareUnprovisionedCell, type DialectCell } from './live-dialect-matrix.testkit.js';
import {
  CROSS_FIELD_AUTHORED_CASES,
  CROSS_FIELD_CASES,
  CROSS_FIELD_OBJECT_FIELDS,
  CROSS_FIELD_REFUSALS,
  CROSS_FIELD_ROWS,
} from './cross-field-conformance-cases.js';

const TABLE = 'cross_field_deal';

function declareCrossFieldSweep(cell: DialectCell): void {
describe(`[#5222] driver-sql — cross-field \`$field\` push-down conformance (${cell.label})`, () => {
  let driver: SqlDriver;
  /** The seeded rows AS THE DRIVER RETURNS THEM — the memory path's input. */
  let records: Array<Record<string, unknown>>;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    // Live cells reuse one database, so the sweep starts from a dropped table.
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.initObjects([{ name: TABLE, fields: CROSS_FIELD_OBJECT_FIELDS } as any]);
    for (const row of CROSS_FIELD_ROWS) await driver.create(TABLE, { ...row });
    // Reading the rows BACK (rather than evaluating the literals in
    // CROSS_FIELD_ROWS) is deliberate: it makes the memory path's input the
    // same storage round-trip the SQL path compares against, so a coercion
    // that changed a value on write would fail here instead of being
    // cancelled out by a fixture that never went through the database. It also
    // makes the memory path see each DIALECT's read shape, which is the point
    // of running this sweep per cell.
    records = (await driver.find(TABLE, {})) as Array<Record<string, unknown>>;
  });

  afterAll(async () => {
    await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver?.disconnect?.();
  });

  it('the fixture round-tripped with its NULLs intact', () => {
    // The control every null case depends on. A `NOT NULL` column or a write
    // coercion that substituted `''` for `null` would turn the NULL cases
    // green for the wrong reason — the divergence they exist to catch is
    // exactly what a row with no value does.
    expect(records).toHaveLength(CROSS_FIELD_ROWS.length);
    const byId = new Map(records.map((r) => [r.id as string, r]));
    expect(byId.get('6')!.amount).toBeNull();
    expect(byId.get('6')!.stage).toBeNull();
    expect(byId.get('6')!.starts_on).toBeNull();
    expect(byId.get('4')!.amount).toBeNull();
    expect(byId.get('4')!.budget).toBe(5);
    expect(byId.get('5')!.budget).toBeNull();
    expect(byId.get('5')!.amount).toBe(10);
  });

  const sqlIds = async (filter: unknown): Promise<string[]> => {
    const rows = await driver.find(TABLE, {
      fields: ['id'],
      where: filter as FilterCondition,
    });
    return rows.map((r: any) => String(r.id)).sort();
  };

  const memoryIds = (filter: unknown): string[] =>
    records
      .filter((r) => matchesFilterCondition(r, filter as FilterCondition))
      .map((r) => String(r.id))
      .sort();

  for (const testCase of CROSS_FIELD_CASES) {
    it(`${testCase.name} — same rows on both paths`, async () => {
      const expected = [...testCase.expected].sort();
      const note = testCase.note ? `\n${testCase.note}` : '';

      // The memory path first: it is the reference implementation this issue
      // is bringing SQL into line with, so when a case fails it matters
      // whether the reference itself moved.
      expect(memoryIds(testCase.filter), `in-memory evaluator disagreed${note}`).toEqual(expected);
      expect(await sqlIds(testCase.filter), `SQL push-down disagreed${note}`).toEqual(expected);
    });
  }

  describe('[#7597] the AUTHORING arm — the array sugar a client actually sends', () => {
    // The sink these cases enter through (`parseFilterAST`) is where #7597
    // was: the four equality spellings dropped the operator on a `{ $field }`
    // comparand and produced a field spec no backend reads as an equality, so
    // `['amount', '=', ref]` silently matched nothing while `['amount', '>',
    // ref]` worked. Lowering and row set are asserted together because either
    // one alone can be right while the pair is wrong.
    for (const authoredCase of CROSS_FIELD_AUTHORED_CASES) {
      it(`${authoredCase.name} — lowers as declared, same rows on both paths`, async () => {
        const note = authoredCase.note ? `\n${authoredCase.note}` : '';
        const lowered = parseFilterAST(authoredCase.authored);
        expect(lowered, `parseFilterAST lowered the authored array to an unexpected shape${note}`)
          .toEqual(authoredCase.loweredTo);

        const expected = [...authoredCase.expected].sort();
        expect(memoryIds(lowered), `in-memory evaluator disagreed${note}`).toEqual(expected);
        expect(await sqlIds(lowered), `SQL push-down disagreed${note}`).toEqual(expected);
      });
    }
  });

  describe('the refusal arm — narrowed, never removed (ADR-0112 envelope)', () => {
    for (const refusal of CROSS_FIELD_REFUSALS) {
      it(`${refusal.name} → 400 INVALID_FILTER`, async () => {
        let error: (Error & { code?: string; status?: number }) | null = null;
        try {
          await sqlIds(refusal.filter);
        } catch (e) {
          error = e as Error & { code?: string; status?: number };
        }
        expect(error, `expected a refusal${refusal.note ? `\n${refusal.note}` : ""}`).not.toBeNull();
        expect(error!.code).toBe('INVALID_FILTER');
        expect(error!.status).toBe(400);
        // #5041's floor: never a bare TypeError from the binder, and never
        // driver-internal wording on the wire (#3867).
        expect(error!).not.toBeInstanceOf(TypeError);
        expect(error!.message).not.toContain('can only bind');
        expect(error!.message).not.toContain('[sql-driver]');
        for (const fragment of refusal.messageIncludes) {
          expect(error!.message).toContain(fragment);
        }
      });
    }
  });
});
}

// ── The driver axis ─────────────────────────────────────────────────────────

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    // Reported, never omitted — a named skip locally, a red under
    // `OS_EXPECT_LIVE_DIALECT_MATRIX=1`. The guard is the testkit's, shared
    // with the temporal / pagination / filter-logic matrices, so it cannot
    // weaken in this consumer's copy alone.
    declareUnprovisionedCell(cell, 'cross-field comparison');
    continue;
  }
  declareCrossFieldSweep(cell);
}
