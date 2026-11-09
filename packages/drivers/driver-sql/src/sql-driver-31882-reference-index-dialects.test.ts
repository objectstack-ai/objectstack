// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An authored single-valued reference column is indexed without a
 * declaration (#31882).
 *
 * A read by parent (`controlled_by_parent`, a related list, the
 * referential-integrity read on a parent delete) filters a detail table on its
 * `master_detail` / `lookup` / `user` column. The SQL driver used to build only
 * the indexes metadata declares, so on a walled table that read walked the
 * whole organization through the tenant index, and on an unwalled one it
 * scanned the table (measured on PostgreSQL 16 at 1M rows: 73 ms before,
 * 1.4 ms with the index).
 *
 * The seat's ruling on the card fixes the shape: every AUTHORED single-valued
 * reference column gets a non-unique `(column)` index named
 * `idx_<table>_<column>` (the name an author's own `{ fields: [column] }`
 * produces), unless a declared index already leads with that column. System
 * columns (`created_by`, `updated_by`, `owner_id`, `owning_business_unit_id`,
 * the tenant column) and multi-valued (JSON) columns are skipped.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { SqlDriver, expectedIndexes } from '../src/index.js';
import { declareDialectCell, dialectCell, PG_CELL, type DialectCell } from './live-dialect-matrix.testkit.js';

const PARENT = 'os31882_project';
const DETAIL = 'os31882_time_entry';
const PARENTS = 20;
const ROWS_PER_PARENT = 10;

const parentObject = {
  name: PARENT,
  fields: {
    organization_id: { type: 'lookup', reference: 'sys_organization' },
    name: { type: 'text' },
  },
  indexes: [{ fields: ['organization_id'] }],
};

/** A detail object as the registry hands it over: the tenant index is provisioned and appended last. */
const detailObject = (declared: any[] = []) => ({
  name: DETAIL,
  fields: {
    organization_id: { type: 'lookup', reference: 'sys_organization' },
    project: { type: 'master_detail', reference: PARENT },
    task: { type: 'lookup', reference: 'os31882_task' },
    member: { type: 'user' },
    watchers: { type: 'user', multiple: true },
    tags: { type: 'lookup', reference: 'os31882_tag', multiple: true },
    created_by: { type: 'lookup', reference: 'sys_user' },
    updated_by: { type: 'lookup', reference: 'sys_user' },
    owner_id: { type: 'lookup', reference: 'sys_user' },
    owning_business_unit_id: { type: 'lookup', reference: 'sys_business_unit' },
    hours: { type: 'number' },
  },
  indexes: [...declared, { fields: ['organization_id'] }],
});

const implicitName = (column: string) => `idx_${DETAIL}_${column}`;

const expectedFor = (obj: ReturnType<typeof detailObject>) =>
  expectedIndexes({
    table: DETAIL,
    fields: obj.fields,
    tenantField: 'organization_id',
    declaredIndexes: obj.indexes,
    physicalColumns: new Set(['id', ...Object.keys(obj.fields)]),
  });

describe('the expected index set (#31882)', () => {
  it('adds a (column) index for each authored single-valued master_detail, lookup and user column', () => {
    const implicit = expectedFor(detailObject()).filter((i) => i.name !== implicitName('organization_id'));
    expect(implicit).toEqual([
      { name: implicitName('project'), columns: ['project'], unique: false },
      { name: implicitName('task'), columns: ['task'], unique: false },
      { name: implicitName('member'), columns: ['member'], unique: false },
    ]);
  });

  it('skips multi-valued references and the system columns', () => {
    const names = expectedFor(detailObject()).map((i) => i.name);
    for (const column of ['watchers', 'tags', 'created_by', 'updated_by', 'owner_id', 'owning_business_unit_id']) {
      expect(names, column).not.toContain(implicitName(column));
    }
    // The tenant column's one index is the provisioned declaration, not a second implicit one.
    expect(names.filter((n) => n === implicitName('organization_id'))).toHaveLength(1);
  });

  it('builds nothing for a column a declared index already leads with, whatever its name', () => {
    const names = expectedFor(detailObject([{ name: 'by_project_and_hours', fields: ['project', 'hours'] }])).map(
      (i) => i.name,
    );
    expect(names).toContain('by_project_and_hours');
    expect(names).not.toContain(implicitName('project'));
  });

  it('still indexes a column that a declared index carries only behind another column', () => {
    const names = expectedFor(detailObject([{ fields: ['organization_id', 'project'] }])).map((i) => i.name);
    expect(names).toContain(implicitName('project'));
  });

  it('CONTROL: the declared indexes are unchanged, in order, ahead of the implicit ones', () => {
    const declared = [{ fields: ['hours'] }, { fields: ['task', 'hours'], unique: 'organization' as const }];
    const obj = detailObject(declared);
    const all = expectedFor(obj);
    expect(all.slice(0, 3)).toEqual([
      { name: `idx_${DETAIL}_hours`, columns: ['hours'], unique: false },
      { name: `uniq_${DETAIL}_organization_id_task_hours`, columns: ['organization_id', 'task', 'hours'], unique: true },
      { name: implicitName('organization_id'), columns: ['organization_id'], unique: false },
    ]);
    expect(all.slice(3).every((i) => !i.unique && i.columns.length === 1)).toBe(true);
  });
});

describe('the boot sync on an existing database (#31882, SQLite)', () => {
  let driver: SqlDriver;
  let knex: any;
  let ddl: string[];

  beforeEach(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    knex = (driver as any).knex;
    (driver as any).logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    ddl = [];
    knex.on('query', (q: any) => {
      if (/^\s*(create|alter|drop)\b/i.test(q.sql)) ddl.push(q.sql);
    });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  const indexNames = async (): Promise<string[]> =>
    (await knex.raw(`select name from sqlite_master where type = 'index' and tbl_name = ? order by name`, [DETAIL])).map(
      (r: any) => r.name,
    );

  it('an earlier release\'s table is planned, then gains the index on the next sync; a second sync does nothing', async () => {
    await driver.initObjects([detailObject() as any]);
    // The table an earlier release built: no implicit index.
    await knex.raw(`drop index ${implicitName('project')}`);
    expect(await indexNames()).not.toContain(implicitName('project'));

    const plan = await driver.detectManagedDrift();
    const entry = plan.find((d) => d.op.type === 'create_index' && (d.op as any).indexName === implicitName('project'));
    expect(entry?.category).toBe('safe');
    expect(entry?.op).toMatchObject({ table: DETAIL, columns: ['project'], unique: false });

    ddl.length = 0;
    await driver.initObjects([detailObject() as any]);
    expect(await indexNames()).toContain(implicitName('project'));
    expect(ddl.filter((s) => /create index/i.test(s))).toHaveLength(1);
    expect(await driver.detectManagedDrift()).toEqual([]);

    ddl.length = 0;
    await driver.initObjects([detailObject() as any]);
    expect(ddl).toEqual([]);
  });

  it('an author who later declares { fields: [column] } converges on the same index, with no duplicate', async () => {
    await driver.initObjects([detailObject() as any]);
    const before = await indexNames();
    expect(before).toContain(implicitName('project'));

    ddl.length = 0;
    await driver.initObjects([detailObject([{ fields: ['project'] }]) as any]);
    expect(ddl).toEqual([]);
    expect(await indexNames()).toEqual(before);
    const onProject = (await knex.raw(`select name from pragma_index_list(?)`, [DETAIL])).filter(
      (r: any) => r.name !== 'sqlite_autoindex_' + DETAIL + '_1',
    );
    const keyedOnProjectOnly: string[] = [];
    for (const r of onProject) {
      const cols = (await knex.raw(`select name from pragma_index_info(?)`, [r.name])).map((c: any) => c.name);
      if (cols.length === 1 && cols[0] === 'project') keyedOnProjectOnly.push(r.name);
    }
    expect(keyedOnProjectOnly).toEqual([implicitName('project')]);
    expect(await driver.detectManagedDrift()).toEqual([]);
  });

  it('builds no index on a multi-valued reference or a system column', async () => {
    await driver.initObjects([detailObject() as any]);
    const names = await indexNames();
    for (const column of ['watchers', 'tags', 'created_by', 'updated_by', 'owner_id', 'owning_business_unit_id']) {
      expect(names, column).not.toContain(implicitName(column));
    }
  });
});

/**
 * The read by parent plans as an index search on the implicit index. The
 * organization holds every row, so the tenant index is no help and a planner
 * that finds no index on `project` walks the whole organization.
 */
function declareReadByParentPlan(cell: DialectCell): void {
  describe(`read by parent plans as an index search — ${cell.label} (#31882)`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      // One pooled connection, so the planner setting below holds for the EXPLAIN.
      driver = new SqlDriver({ ...cell.config(), pool: { min: 1, max: 1 } } as any);
      (driver as any).logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
      for (const t of [DETAIL, PARENT]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
      await driver.initObjects([parentObject as any, detailObject() as any]);
      const knex = (driver as any).knex;
      const rows = [];
      for (let p = 0; p < PARENTS; p++) {
        for (let r = 0; r < ROWS_PER_PARENT; r++) {
          rows.push({ id: `te_${p}_${r}`, organization_id: 'org_a', project: `prj_${p}`, task: `tsk_${r}`, hours: r });
        }
      }
      await knex.batchInsert(DETAIL, rows, 100);
      await driver.execute(cell.id === 'pg' ? `analyze ${DETAIL}` : 'analyze');
      // PostgreSQL prefers a sequential scan on a table this small whatever
      // indexes exist; with it off, the plan names the index it CAN use.
      if (cell.id === 'pg') await driver.execute('set enable_seqscan = off');
    });

    afterEach(async () => {
      for (const t of [DETAIL, PARENT]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
      await driver.disconnect();
    });

    const planOf = async (where: Record<string, unknown>) => {
      const res = await driver.analyzeQuery(DETAIL, { where, fields: ['id', 'hours'] } as any, { tenantId: 'org_a' } as any);
      expect(res.error, res.error).toBeUndefined();
      // The statement is the one find() runs, organization predicate included.
      expect(res.sql).toContain('organization_id');
      return JSON.stringify(cell.id === 'pg' ? res.plan.rows : res.plan);
    };

    it('the organization-scoped read of one parent', async () => {
      const plan = await planOf({ project: 'prj_7' });
      expect(plan).toContain(implicitName('project'));
    });

    it('the controlled_by_parent read of several parents', async () => {
      const plan = await planOf({ project: { $in: ['prj_3', 'prj_4', 'prj_5'] } });
      expect(plan).toContain(implicitName('project'));
    });
  });
}

declareDialectCell(dialectCell('sqlite'), 'read by parent index search (#31882)', declareReadByParentPlan);
declareDialectCell(PG_CELL, 'read by parent index search (#31882)', declareReadByParentPlan);
