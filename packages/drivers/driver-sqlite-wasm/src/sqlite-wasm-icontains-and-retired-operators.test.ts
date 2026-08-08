// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5702] `$icontains` and the `$regex` retirement, EXECUTED by sql.js.
 *
 * `SqliteWasmDriver extends SqlDriver`, so the compiler is inherited and nothing
 * here re-implements it. What this pins is the other half — the half its
 * temporal, pagination and filter-logic suites exist for: the compiled predicate
 * has to survive a different ENGINE. This driver swaps knex's transport for a
 * custom sql.js dialect (`Client_WasmSqlite`) that compiles the statement, binds
 * its parameters and marshals the rows back through its own path.
 *
 * `$icontains` is the first operator this package has ever run whose predicate
 * is a FUNCTION CALL on the column (`LOWER(col) LIKE LOWER(?) ESCAPE ?`) rather
 * than a bare column reference. Every text predicate before it compiled to
 * `col LIKE ?`. A dialect that mis-binds the parameters of the three-argument
 * form, or that renders `??` inside a function call differently, produces
 * precisely the failure a shared standard exists to rule out — a filter that
 * looks applied and selects the wrong rows — and it would fail in no other suite
 * in the repo. "It inherits the compiler, therefore it is fine" is the
 * assumption these suites exist to disprove.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import { SqliteWasmDriver } from './index.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

describe('[#5702] driver-sqlite-wasm — $icontains and the retired $regex, on sql.js', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: 'txt', fields: { name: { type: 'string' } } }]);
    for (const row of FILTER_TEXT_ROWS) {
      await driver.create('txt', { ...row }, BYPASS);
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  const ids = async (where: FilterCondition): Promise<string[]> => {
    const rows = await driver.find('txt', { where }, BYPASS);
    return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
  };

  it('the fixture really is all nine rows', async () => {
    expect(await ids({})).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('$icontains folds ASCII case in both directions, through the wasm engine', async () => {
    expect(await ids({ name: { $icontains: 'acme' } })).toEqual(['1', '2']);
    expect(await ids({ name: { $icontains: 'ACME' } })).toEqual(['1', '2']);
  });

  it('$icontains folds ASCII ONLY — sql.js `lower()` must not reach É', async () => {
    // The dialect boundary #4706 Q1 = A pinned, asserted against THIS engine's
    // `lower()` rather than against better-sqlite3's. Both are SQLite, but they
    // are separately compiled builds and an ICU-enabled one would fold É and
    // answer ['3','4'] to both lines.
    expect(await ids({ name: { $icontains: 'café' } })).toEqual(['4']);
    expect(await ids({ name: { $icontains: 'CAFÉ' } })).toEqual(['3']);
  });

  it('$icontains keeps the LIKE metacharacters literal across the wasm bind path', async () => {
    // The bound `ESCAPE ?` is a THIRD parameter on a predicate whose first
    // operand is now a function call. This is the assertion that a wasm dialect
    // binding those three positionally in the wrong order would fail.
    expect(await ids({ name: { $icontains: '100%' } })).toEqual(['5']);
    expect(await ids({ name: { $icontains: 'a_b' } })).toEqual(['7']);
    expect(await ids({ name: { $icontains: 'a.b' } })).toEqual(['9']);
  });

  it('REFUSES the retired $regex, in the ADR-0112 envelope, naming $icontains', async () => {
    const err = await driver
      .find('txt', { where: { name: { $regex: 'ac.*' } } }, BYPASS)
      .then(() => null, (e: unknown) => e as WireBearingError);
    expect(err).toBeInstanceOf(Error);
    expect(err!.code).toBe('INVALID_FILTER');
    expect(err!.status).toBe(400);
    expect(err!.message).toContain('$regex');
    expect(err!.message).toContain('$icontains');
  });

  it('REFUSES an $icontains comparand that constrains nothing', async () => {
    for (const comparand of ['', 42] as const) {
      const err = await driver
        .find('txt', { where: { name: { $icontains: comparand } } }, BYPASS)
        .then(() => null, (e: unknown) => e as WireBearingError);
      expect(err, `expected ${JSON.stringify(comparand)} to be refused`).toBeInstanceOf(Error);
      expect(err!.code).toBe('INVALID_FILTER');
      expect(err!.status).toBe(400);
    }
  });
});
