// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7872] `driver-turso` held to `FILTER_COMPARAND_TYPE_CASES` — the
 * comparand-type door, both directions, on the local (SqlDriver-inherited)
 * execution path.
 *
 * The REMOTE transport's own half of this policy predates the door and stays
 * pinned in `remote-transport-comparand-refusal.test.ts` — including the
 * native `bigint` BIND for a direct transport caller, which the door
 * deliberately leaves reachable (an engine-path bigint arrives already
 * narrowed to its exact number; a direct caller keeps libsql's own binding).
 * `serializeComparand`'s type membership and its refusal sentence are sourced
 * from the door's set since #7872, so the two faces cannot drift; the replica
 * mode shares the local engine this suite drives.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  FILTER_COMPARAND_TYPE_CASES,
  FILTER_COMPARAND_TYPE_ROWS,
  parseFilterAST,
  type FilterCondition,
} from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';

const TABLE = 'comparand_conformance';

describe('[#7872] TursoDriver — comparand-type conformance (local mode, behind the door)', () => {
  let driver: TursoDriver;

  beforeAll(async () => {
    driver = new TursoDriver({ url: ':memory:' });
    expect(driver.transportMode).toBe('local');
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
