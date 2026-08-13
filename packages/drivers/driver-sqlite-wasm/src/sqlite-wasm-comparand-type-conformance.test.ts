// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7872] `driver-sqlite-wasm` held to `FILTER_COMPARAND_TYPE_CASES` — the
 * comparand-type door, both directions, on the sql.js execution path.
 *
 * This driver inherits `SqlDriver`'s filter compiler (so its refusal half for
 * DIRECT callers is that driver's, now sourced from the door's set); what this
 * suite adds is the executable proof that the WASM engine also runs every
 * door-validated accepted type — an inherited compiler is not an inherited
 * execution result (#6518's lesson: sql.js and better-sqlite3 answered case
 * folding differently under one compiler).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  FILTER_COMPARAND_TYPE_CASES,
  FILTER_COMPARAND_TYPE_ROWS,
  parseFilterAST,
  type FilterCondition,
} from '@objectstack/spec/data';
import { SqliteWasmDriver } from './index.js';

const TABLE = 'comparand_conformance';

describe('[#7872] SqliteWasmDriver — comparand-type conformance (behind the door)', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: TABLE,
        fields: {
          qty: { type: 'number' },
          label: { type: 'string' },
          active: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    ]);
    for (const row of FILTER_COMPARAND_TYPE_ROWS) {
      await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  const ids = async (where: FilterCondition | undefined): Promise<string[]> => {
    const rows = await driver.find(TABLE, { fields: ['id'], where });
    return (rows as Array<Record<string, unknown>>)
      .map((r) => String(r.id))
      .sort((x, y) => x.localeCompare(y));
  };

  for (const c of FILTER_COMPARAND_TYPE_CASES) {
    if (c.verdict === 'door-refusal') {
      it(`${c.name} — refused at the door, before any SQL compiles`, () => {
        let caught: (Error & { code?: string; status?: number }) | null = null;
        try {
          parseFilterAST(c.filter());
        } catch (e) {
          caught = e as Error & { code?: string; status?: number };
        }
        expect(caught, c.note).not.toBeNull();
        expect(caught?.code, c.name).toBe(c.code);
        expect(caught?.status, c.name).toBe(400);
        for (const fragment of c.mustMention) expect(caught?.message).toContain(fragment);
      });
    } else if (c.verdict === 'matches') {
      it(c.name, async () => {
        expect(await ids(parseFilterAST(c.filter())), c.note).toEqual([...c.expected]);
      });
    } else {
      it(`${c.name} — executes without refusal`, async () => {
        await expect(ids(parseFilterAST(c.filter()))).resolves.toBeDefined();
      });
    }
  }

  it('the fixture really is both rows', async () => {
    expect(await ids(undefined)).toEqual(['1', '2']);
  });
});
