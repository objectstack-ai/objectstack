// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5222] Cross-field `{ $field }` push-down conformance for the wasm driver —
 * the same corpus `driver-sql` runs, through this driver's own pipeline.
 *
 * `SqliteWasmDriver extends SqlDriver`, so `applyCrossFieldComparison` and the
 * validation gate around it are INHERITED and nothing here re-implements them.
 * What this pins is the other half, the same half this driver's temporal,
 * pagination and filter-logic suites pin: the compiled predicate has to
 * survive a different **engine**. This driver swaps knex's transport for a
 * custom sql.js dialect (`Client_WasmSqlite`) that compiles the statement,
 * binds its parameters and marshals the rows back through its own path.
 *
 * That matters more here than for an ordinary value comparison, and it is why
 * this file exists rather than a comment asserting inheritance. A cross-field
 * predicate is emitted through `whereRaw` with **identifier** bindings (`??`)
 * and repeats each column expression several times to stay total across NULLs
 * — a dialect that mis-ordered or mis-escaped that binding list would produce
 * exactly the failure the capability exists to rule out: a filter that looks
 * applied and selects the wrong rows. "It inherits the compiler, therefore it
 * is fine" is the assumption those sibling suites exist to disprove.
 *
 * The corpus is imported from `@objectstack/driver-sql` — the package this one
 * already depends on — so the two drivers cannot drift into fixtures that
 * differ in a way that matters. See its header for why it does not live in
 * `packages/spec/src/data`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { matchesFilterCondition } from '@objectstack/formula';
import { parseFilterAST, type FilterCondition } from '@objectstack/spec/data';
import {
  CROSS_FIELD_AUTHORED_CASES,
  CROSS_FIELD_CASES,
  CROSS_FIELD_OBJECT_FIELDS,
  CROSS_FIELD_OPERAND_NAMES,
  CROSS_FIELD_REFUSALS,
  CROSS_FIELD_ROWS,
} from '@objectstack/driver-sql';
import { SqliteWasmDriver } from './index.js';

describe('[#5222] driver-sqlite-wasm — cross-field `$field` push-down conformance', () => {
  let driver: SqliteWasmDriver;
  let records: Array<Record<string, unknown>>;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      { name: 'cross_field_deal', fields: CROSS_FIELD_OBJECT_FIELDS } as any,
    ]);
    for (const row of CROSS_FIELD_ROWS) await driver.create('cross_field_deal', { ...row });
    records = (await driver.find('cross_field_deal', {})) as Array<Record<string, unknown>>;
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('the fixture round-tripped with its NULLs intact', () => {
    // The control every null case depends on — and it is a real risk on THIS
    // driver rather than a copied assertion: the wasm dialect marshals values
    // back through its own row mapper, so a NULL that returned as `undefined`
    // or `''` here would quietly turn the null cases green.
    expect(records).toHaveLength(CROSS_FIELD_ROWS.length);
    const byId = new Map(records.map((r) => [r.id as string, r]));
    expect(byId.get('6')!.amount).toBeNull();
    expect(byId.get('6')!.stage).toBeNull();
    expect(byId.get('4')!.amount).toBeNull();
    expect(byId.get('4')!.budget).toBe(5);
    expect(byId.get('5')!.budget).toBeNull();
  });

  const sqlIds = async (filter: unknown): Promise<string[]> => {
    const rows = await driver.find('cross_field_deal', {
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
      expect(memoryIds(testCase.filter), `in-memory evaluator disagreed${note}`).toEqual(expected);
      expect(await sqlIds(testCase.filter), `wasm push-down disagreed${note}`).toEqual(expected);
    });
  }

  describe('[#7597] the AUTHORING arm — the array sugar a client actually sends', () => {
    // Run here as well as on `driver-sql` for the reason the whole corpus is
    // shared: this driver inherits that compiler but executes through its own
    // sql.js dialect, and the lowered `$eq` reference has to mean the same
    // rows on both. See the corpus header for the defect it pins.
    for (const authoredCase of CROSS_FIELD_AUTHORED_CASES) {
      it(`${authoredCase.name} — lowers as declared, same rows on both paths`, async () => {
        const note = authoredCase.note ? `\n${authoredCase.note}` : '';
        const lowered = parseFilterAST(authoredCase.authored);
        expect(lowered, `parseFilterAST lowered the authored array to an unexpected shape${note}`)
          .toEqual(authoredCase.loweredTo);

        const expected = [...authoredCase.expected].sort();
        expect(memoryIds(lowered), `in-memory evaluator disagreed${note}`).toEqual(expected);
        expect(await sqlIds(lowered), `wasm push-down disagreed${note}`).toEqual(expected);
      });
    }
  });

  describe('the refusal arm — narrowed, never removed (ADR-0112 envelope)', () => {
    for (const refusal of CROSS_FIELD_REFUSALS) {
      it(`${refusal.name} → 400 INVALID_FILTER, operands withheld`, async () => {
        // [#7929] The wasm driver inherits the withhold with the compiler, and
        // "inherits it, therefore it is fine" is exactly what this file exists
        // to disprove — the sink is `SqlDriver.logger`, and a subclass that
        // replaced the logger or the filter entry point would drop the
        // server-side half while the response still looked right.
        const logged: string[] = [];
        const restore = (driver as unknown as { logger: { warn: (m: string) => void } }).logger;
        (driver as unknown as { logger: unknown }).logger = {
          ...restore,
          warn: (m: string) => { logged.push(m); },
        };
        let error: (Error & { code?: string; status?: number }) | null = null;
        try {
          await sqlIds(refusal.filter);
        } catch (e) {
          error = e as Error & { code?: string; status?: number };
        } finally {
          (driver as unknown as { logger: unknown }).logger = restore;
        }
        expect(error, `expected a refusal${refusal.note ? `\n${refusal.note}` : ""}`).not.toBeNull();
        expect(error!.code).toBe('INVALID_FILTER');
        expect(error!.status).toBe(400);
        expect(error!).not.toBeInstanceOf(TypeError);
        expect(error!.message).not.toContain('can only bind');
        expect(error!.message).not.toContain('[sql-driver]');
        // The disclosure half: neither operand reaches the caller.
        for (const name of CROSS_FIELD_OPERAND_NAMES) {
          expect(error!.message, `caller-visible message names "${name}"`).not.toContain(name);
        }
        // …and the diagnostic half: the wording that says WHICH ruling bit is
        // in the server log, so the refusal is still debuggable by an operator.
        const diagnostic = logged.join('\n');
        for (const fragment of refusal.diagnosticIncludes) {
          expect(diagnostic, `server log lost "${fragment}"`).toContain(fragment);
        }
      });
    }
  });
});
