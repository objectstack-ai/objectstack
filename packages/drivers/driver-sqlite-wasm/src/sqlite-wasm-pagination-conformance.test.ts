// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deterministic paged reads for the wasm driver (objectui#3106,
 * objectstack#4363) — the contract on `IDataDriver.find`, run against the
 * shared `@objectstack/spec/data` cases like every other driver.
 *
 * `SqliteWasmDriver extends SqlDriver`, so the ORDER BY is *built* by inherited
 * code and nothing here re-implements it. What this pins is the other half:
 * the clause has to survive a different **engine**. This driver swaps knex's
 * transport for a custom sql.js dialect (`Client_WasmSqlite`), which compiles
 * and executes the statement and marshals every row back through its own path.
 * A dialect that reordered, dropped or mis-bound the trailing `ORDER BY id`
 * would produce exactly the failure the contract exists to rule out — full
 * pages, real rows, one served twice and one never served — and it would fail
 * in no other suite in the repo.
 *
 * That is the same reason the temporal suite next door exists: inheritance
 * makes it easy to assume the behavior comes along for free, and the dialect
 * seam is precisely where it might not.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  type DriverOptions,
  PAGINATION_ALL_IDS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
  PAGINATION_ZERO_LIMIT_CASES,
} from '@objectstack/spec/data';
import { SqliteWasmDriver } from './index.js';

/** Shared read options — a named const so no call site casts its own (#4674). */
const READ_OPTIONS: DriverOptions = { bypassTenantAudit: true };

describe('driver-sqlite-wasm — paged reads are a partition of the result set', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: 'ticket',
        fields: {
          status: { type: 'string' },
          rank: { type: 'integer' },
          name: { type: 'string' },
        },
      },
    ]);
    for (const row of PAGINATION_ROWS) {
      await driver.create('ticket', { ...row }, { bypassTenantAudit: true });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  const walk = async (pageSize: number, orderBy?: ReadonlyArray<{ field: string; order: 'asc' | 'desc' }>) => {
    const seen: string[] = [];
    for (let offset = 0; offset < PAGINATION_ROWS.length; offset += pageSize) {
      const page = await driver.find(
        'ticket',
        { ...(orderBy ? { orderBy: [...orderBy] } : {}), limit: pageSize, offset } as any,
        { bypassTenantAudit: true },
      );
      seen.push(...page.map((r: any) => String(r.id)));
    }
    return seen;
  };

  for (const testCase of PAGINATION_CASES) {
    it(`visits every row exactly once — ${testCase.name}`, async () => {
      const seen = await walk(testCase.pageSize, testCase.orderBy);
      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });

    it(`page boundaries are invisible — ${testCase.name}`, async () => {
      const paged = await walk(testCase.pageSize, testCase.orderBy);
      const whole = await driver.find(
        'ticket',
        { orderBy: [...testCase.orderBy] } as any,
        { bypassTenantAudit: true },
      );
      expect(paged).toEqual(whole.map((r: any) => String(r.id)));
    });
  }

  for (const testCase of PAGINATION_UNORDERED_CASES) {
    it(`visits every row exactly once with NO orderBy at all — ${testCase.name}`, async () => {
      const seen = await walk(testCase.pageSize);
      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });

    it(`walks an unsorted read in id order — ${testCase.name}`, async () => {
      // The fixture's ids are shuffled relative to insertion order, so this
      // distinguishes "the inherited ORDER BY reached the wasm engine" from
      // "sql.js happened to hand back insertion order".
      expect(await walk(testCase.pageSize)).toEqual([...PAGINATION_ALL_IDS].sort());
    });
  }

  it('leaves an UNPAGED unordered read alone — no sort is imposed on a caller who asked for none', async () => {
    const rows = await driver.find('ticket', {} as any, { bypassTenantAudit: true });
    expect(rows.map((r: any) => r.id)).toEqual(PAGINATION_ROWS.map((r) => r.id));
  });

  /**
   * `limit: 0` means "return no records" (#6485/#6577). Inherited from
   * `SqlDriver.findRows()`, which has always compiled `limit` on presence — but
   * "inherits, therefore fine" is the assumption this whole file exists to
   * disprove, and the sql.js dialect binds the LIMIT placeholder itself. A
   * dialect that mis-bound a zero would fail in no other suite in the repo.
   */
  describe('`limit: 0` returns no records', () => {
    for (const testCase of PAGINATION_ZERO_LIMIT_CASES) {
      it(testCase.name, async () => {
        const rows = await driver.find('ticket', { ...testCase.query }, READ_OPTIONS);
        expect(rows).toHaveLength(testCase.expectedRowCount);
      });
    }
  });
});
