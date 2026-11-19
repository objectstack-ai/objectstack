// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Schema sync indexes two system-column keys without a declaration (#33695,
 * maintainer ruling 「两个都加」, superseding scope B of the #31882 ruling for
 * these two keys):
 *
 *   - `(created_at, id)`: the default list order, `created_at desc, id desc`.
 *     Without it a default-ordered page sorts its whole filtered set
 *     (PostgreSQL 16, 1M rows: the admin page statement 317 ms before, 1.3 ms
 *     with the index).
 *   - `(owner_id)`: the column a private-OWD read filters on, on an object
 *     whose fields carry it.
 *
 * The keys join the implicit set the #31882 reference indexes started
 * (`sql-driver-31882-reference-index-dialects.test.ts`), so the boot sync
 * builds them, the drift differ expects them and a second sync is silent.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { SqlDriver, expectedIndexes } from '../src/index.js';
import { diffUnbuildableIndexes } from './schema-drift.js';
import { declareDialectCell, dialectCell, PG_CELL, type DialectCell } from './live-dialect-matrix.testkit.js';

const OWNED = 'os33695_deal';
const UNOWNED = 'os33695_catalog';

/** An object the injection pass gave an owner: `owner_id` is a declared field. */
const ownedObject = (declared: any[] = []) => ({
  name: OWNED,
  fields: {
    name: { type: 'text' },
    amount: { type: 'number' },
    owner_id: { type: 'lookup', reference: 'sys_user' },
  },
  ...(declared.length > 0 ? { indexes: declared } : {}),
});

/** No owner, no reference, no unique, no declared index: only the default-order key applies. */
const unownedObject = () => ({ name: UNOWNED, fields: { name: { type: 'text' }, code: { type: 'number' } } });

const defaultOrderIndex = (table: string) => `idx_${table}_created_at_id`;
const ownerIndex = (table: string) => `idx_${table}_owner_id`;

const expectedOver = (obj: { name: string; fields: Record<string, any>; indexes?: any[] }, physical?: string[]) =>
  expectedIndexes({
    table: obj.name,
    fields: obj.fields,
    tenantField: null,
    declaredIndexes: obj.indexes,
    physicalColumns: new Set(physical ?? ['id', 'created_at', 'updated_at', ...Object.keys(obj.fields)]),
  });

describe('the expected index set: system-column keys (#33695)', () => {
  it('adds (created_at, id) and (owner_id) on an owned object, after the declared set', () => {
    expect(expectedOver(ownedObject())).toEqual([
      { name: defaultOrderIndex(OWNED), columns: ['created_at', 'id'], unique: false },
      { name: ownerIndex(OWNED), columns: ['owner_id'], unique: false },
    ]);
  });

  it('adds only (created_at, id) on an object without owner_id: no dangling owner index', () => {
    expect(expectedOver(unownedObject())).toEqual([
      { name: defaultOrderIndex(UNOWNED), columns: ['created_at', 'id'], unique: false },
    ]);
  });

  it('a declared index whose key STARTS WITH the whole system key replaces it; one that only leads with created_at does not', () => {
    const covered = expectedOver(ownedObject([{ fields: ['created_at', 'id', 'amount'] }, { fields: ['owner_id', 'amount'] }]));
    expect(covered.map((i) => i.name)).toEqual([
      `idx_${OWNED}_created_at_id_amount`,
      `idx_${OWNED}_owner_id_amount`,
    ]);
    const partial = expectedOver(ownedObject([{ fields: ['created_at'] }, { fields: ['amount', 'owner_id'] }]));
    expect(partial.map((i) => i.name)).toEqual([
      `idx_${OWNED}_created_at`,
      `idx_${OWNED}_amount_owner_id`,
      defaultOrderIndex(OWNED),
      ownerIndex(OWNED),
    ]);
  });

  it('an author who declares the same key converges on the same name: one index, not two', () => {
    const names = expectedOver(ownedObject([{ fields: ['created_at', 'id'] }, { fields: ['owner_id'] }])).map((i) => i.name);
    expect(names).toEqual([defaultOrderIndex(OWNED), ownerIndex(OWNED)]);
  });

  it('skips a multi-valued or formula owner_id: neither stores one id', () => {
    for (const owner of [{ type: 'user', multiple: true }, { type: 'formula', expression: 'name' }]) {
      const obj = { ...ownedObject(), fields: { ...ownedObject().fields, owner_id: owner } };
      expect(expectedOver(obj).map((i) => i.name), JSON.stringify(owner)).not.toContain(ownerIndex(OWNED));
    }
  });

  it('a table without a created_at column expects no default-order index, and reports nothing unbuildable', () => {
    const obj = unownedObject();
    const physical = ['id', ...Object.keys(obj.fields)];
    expect(expectedOver(obj, physical)).toEqual([]);
    expect(
      diffUnbuildableIndexes({ table: obj.name, fields: obj.fields, tenantField: null, physicalColumns: new Set(physical) }),
    ).toEqual([]);
  });
});

describe('the boot sync builds the system-column keys (#33695, SQLite)', () => {
  let driver: SqlDriver;
  let knex: any;
  let ddl: string[];
  let errors: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    knex = (driver as any).knex;
    errors = vi.fn();
    (driver as any).logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: errors };
    ddl = [];
    knex.on('query', (q: any) => {
      if (/^\s*(create|alter|drop)\b/i.test(q.sql)) ddl.push(q.sql);
    });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  const indexesOn = async (table: string): Promise<Record<string, string[]>> => {
    const out: Record<string, string[]> = {};
    for (const r of await knex.raw(`select name from pragma_index_list(?)`, [table])) {
      if (String(r.name).startsWith('sqlite_autoindex_')) continue;
      out[r.name] = (await knex.raw(`select name from pragma_index_info(?) order by seqno`, [r.name])).map((c: any) => c.name);
    }
    return out;
  };

  it('a new table gets both keys; an object with nothing else to index still gets (created_at, id)', async () => {
    await driver.initObjects([ownedObject() as any, unownedObject() as any]);
    expect(await indexesOn(OWNED)).toEqual({
      [defaultOrderIndex(OWNED)]: ['created_at', 'id'],
      [ownerIndex(OWNED)]: ['owner_id'],
    });
    expect(await indexesOn(UNOWNED)).toEqual({ [defaultOrderIndex(UNOWNED)]: ['created_at', 'id'] });
    expect(errors).not.toHaveBeenCalled();
    expect(await driver.detectManagedDrift()).toEqual([]);
  });

  it('an earlier release\'s table is planned as safe create_index, gains both on the next sync, and a third sync does nothing', async () => {
    await driver.initObjects([ownedObject() as any, unownedObject() as any]);
    for (const name of [defaultOrderIndex(OWNED), ownerIndex(OWNED), defaultOrderIndex(UNOWNED)]) {
      await knex.raw(`drop index ${name}`);
    }

    const plan = await driver.detectManagedDrift();
    expect(
      plan.map((d) => [d.op.type, (d.op as any).indexName, (d.op as any).columns, d.category]).sort(),
    ).toEqual(
      [
        ['create_index', defaultOrderIndex(OWNED), ['created_at', 'id'], 'safe'],
        ['create_index', ownerIndex(OWNED), ['owner_id'], 'safe'],
        ['create_index', defaultOrderIndex(UNOWNED), ['created_at', 'id'], 'safe'],
      ].sort(),
    );

    ddl.length = 0;
    await driver.initObjects([ownedObject() as any, unownedObject() as any]);
    expect(ddl.filter((s) => /create index/i.test(s))).toHaveLength(3);
    expect(await driver.detectManagedDrift()).toEqual([]);

    ddl.length = 0;
    await driver.initObjects([ownedObject() as any, unownedObject() as any]);
    expect(ddl).toEqual([]);
  });

  it('an adopted table with no created_at column: no index attempted, no error line, no drift loop', async () => {
    await knex.schema.createTable(UNOWNED, (t: any) => {
      t.string('id').primary();
      t.string('name');
      t.float('code');
    });
    ddl.length = 0;
    await driver.initObjects([unownedObject() as any]);
    expect(ddl.filter((s) => /create index/i.test(s))).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect((await driver.detectManagedDrift()).filter((d) => /index/.test(d.op.type))).toEqual([]);
  });
});

/** The default-ordered page and the owner read plan as index reads on the implicit keys. */
function declareSystemKeyPlans(cell: DialectCell): void {
  describe(`system-column keys serve their reads — ${cell.label} (#33695)`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver({ ...cell.config(), pool: { min: 1, max: 1 } } as any);
      (driver as any).logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
      await driver.execute(`drop table if exists ${OWNED}`).catch(() => {});
      await driver.initObjects([ownedObject() as any]);
      const rows = [];
      for (let i = 0; i < 400; i++) {
        rows.push({ id: `d_${String(i).padStart(4, '0')}`, name: `Deal ${i}`, amount: i, owner_id: `u_${i % 40}` });
      }
      await (driver as any).knex.batchInsert(OWNED, rows, 100);
      await driver.execute(cell.id === 'pg' ? `analyze ${OWNED}` : 'analyze');
      // PostgreSQL prefers a sequential scan on a table this small whatever
      // indexes exist; with it off, the plan names the index it CAN use.
      if (cell.id === 'pg') await driver.execute('set enable_seqscan = off');
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${OWNED}`).catch(() => {});
      await driver.disconnect();
    });

    const planOf = async (query: Record<string, unknown>) => {
      const res = await driver.analyzeQuery(OWNED, { fields: ['id', 'name'], ...query } as any);
      expect(res.error, res.error).toBeUndefined();
      return JSON.stringify(cell.id === 'pg' ? res.plan.rows : res.plan);
    };

    it('the default-ordered page', async () => {
      const plan = await planOf({
        orderBy: [
          { field: 'created_at', order: 'desc' },
          { field: 'id', order: 'desc' },
        ],
        limit: 50,
      });
      expect(plan).toContain(defaultOrderIndex(OWNED));
    });

    it('the owner read', async () => {
      expect(await planOf({ where: { owner_id: 'u_7' } })).toContain(ownerIndex(OWNED));
    });
  });
}

declareDialectCell(dialectCell('sqlite'), 'system-column key plans (#33695)', declareSystemKeyPlans);
declareDialectCell(PG_CELL, 'system-column key plans (#33695)', declareSystemKeyPlans);

/** An existing table gains both keys on the next sync (CONCURRENTLY on PostgreSQL, #31901), and the plan reads empty. */
function declareExistingTableSync(cell: DialectCell): void {
  describe(`an existing table gains the system-column keys — ${cell.label} (#33695)`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver(cell.config() as any);
      (driver as any).logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
      await driver.execute(`drop table if exists ${OWNED}`).catch(() => {});
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${OWNED}`).catch(() => {});
      await driver.disconnect();
    });

    it('planned as safe create_index, built by the next sync, then silent', async () => {
      await driver.initObjects([ownedObject() as any]);
      for (const name of [defaultOrderIndex(OWNED), ownerIndex(OWNED)]) await driver.execute(`drop index ${name}`);

      const plan = (await driver.detectManagedDrift([ownedObject() as any])).map((d) => [
        d.op.type,
        (d.op as any).indexName,
        d.category,
      ]);
      expect(plan.sort()).toEqual(
        [
          ['create_index', defaultOrderIndex(OWNED), 'safe'],
          ['create_index', ownerIndex(OWNED), 'safe'],
        ].sort(),
      );

      await driver.initObjects([ownedObject() as any]);
      expect(await driver.detectManagedDrift([ownedObject() as any])).toEqual([]);
      expect((driver as any).logger.error).not.toHaveBeenCalled();
    });
  });
}

declareDialectCell(PG_CELL, 'existing-table system-column keys (#33695)', declareExistingTableSync);
