// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7872] `driver-sql` held to `FILTER_COMPARAND_TYPE_CASES` — the
 * comparand-type door, both directions, on the compiled-SQL path.
 *
 * This driver is one of the two independent implementations the door's set was
 * MEASURED from (`isBindableComparand` / `isRenderableTextComparand`, whose
 * type membership is now sourced from the door instead of duplicated — see
 * their [#7872] notes). The refusal direction is therefore doubly guarded
 * here: the door refuses at the platform face, and this driver's own gate
 * still refuses the same types for direct callers, in its own ADR-0112
 * envelope (pinned by `sql-driver-silent-empty-predicate.test.ts` and
 * siblings). This suite pins the door half, so the shared table drives every
 * backend identically.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  FILTER_COMPARAND_TYPE_CASES,
  FILTER_COMPARAND_TYPE_ROWS,
  parseFilterAST,
  type FilterCondition,
} from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';

const TABLE = 'comparand_conformance';

describe('[#7872] SqlDriver — comparand-type conformance (behind the door)', () => {
  let driver: SqlDriver;
  let knex: any;

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = (driver as any).knex;
    await knex.schema.createTable(TABLE, (t: any) => {
      t.string('id').primary();
      t.integer('qty');
      t.string('label');
      t.boolean('active');
      t.string('note');
    });
    await knex(TABLE).insert(FILTER_COMPARAND_TYPE_ROWS.map((r) => ({ ...r })));
  });

  afterAll(async () => {
    await knex.destroy();
  });

  const ids = async (where: FilterCondition | undefined): Promise<string[]> => {
    const rows = await driver.find(TABLE, { fields: ['id'], where });
    return rows.map((r: any) => String(r.id)).sort((x, y) => x.localeCompare(y));
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
