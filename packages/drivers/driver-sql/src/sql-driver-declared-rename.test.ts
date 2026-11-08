// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [epic cloud#3652 D3 「写进清单 renamedFrom」, #30885] A field's declared
 * `renamedFrom` carries the old column's values to the new key in the schema
 * sync, or the sync refuses before any DDL, naming the field, the old key and
 * the reason.
 *
 * ## Two halves
 *
 * The **rule half** feeds the pure planner (`declared-rename.ts`) the field map
 * and the physical columns: every refusal it owns has a case naming its
 * reason, and the facet's two refusals that need a dialect it cannot provision
 * here (`index_cannot_follow` is MySQL's) or a transport (`transport`) are
 * measured through the facet on a stub host.
 *
 * The **live half** runs on every provisioned dialect cell
 * (`declareDialectCell`: SQLite always, Postgres under
 * `OS_TEST_POSTGRES_URL`, MySQL under `OS_TEST_MYSQL_URL`) through the
 * driver's own sync (`initObjects`, the path the boot, `os start` / `os dev`,
 * `os migrate apply` and the install door's `syncSchemas` take): v1 rows in
 * `a`, v2 declares `b` `renamedFrom: ['a']`, and `b` holds the rows, `a` is
 * gone, the count is unchanged; a second sync changes nothing; a refusal
 * leaves the table exactly as it was; a forced failure mid-way leaves v1's
 * columns and rows intact.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import {
  DeclaredRenameRefusal,
  executeDeclaredRenames,
  planDeclaredRenames,
  type DeclaredRenameRefusalReason,
} from './declared-rename.js';
import { DeclaredRenameFacet } from './sql-driver-declared-rename.js';
import { hashShadowColumnFor, isHashShadowCarrier } from './schema-drift.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'declared rename carry';

const scratch = mkdtempSync(join(tmpdir(), 'os30885-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const reasons = (plan: { refusals: Array<{ reason: DeclaredRenameRefusalReason }> }) => plan.refusals.map((r) => r.reason);

// ── Half 1: the rule ────────────────────────────────────────────────────────

describe('planDeclaredRenames — the rule, read from the new metadata and the physical table (#30885)', () => {
  const plan = (fields: Record<string, unknown>, columns: string[], extra: { tenantField?: string; liveKeys?: string[] } = {}) =>
    planDeclaredRenames({ table: 't', fields, physicalColumns: new Set(['id', ...columns]), ...extra });

  it('carries a → b when the table has a, has no b, and the object no longer declares a', () => {
    expect(plan({ b: { type: 'text', renamedFrom: ['a'] } }, ['a'])).toEqual({
      carries: [{ table: 't', from: 'a', to: 'b' }],
      refusals: [],
    });
  });

  it('is idempotent: with b in place and a gone, there is nothing to carry', () => {
    expect(plan({ b: { type: 'text', renamedFrom: ['a'] } }, ['b'])).toEqual({ carries: [], refusals: [] });
  });

  it('takes the one listed key that still has a column, in a list of several', () => {
    expect(plan({ b: { type: 'text', renamedFrom: ['a0', 'a'] } }, ['a']).carries).toEqual([{ table: 't', from: 'a', to: 'b' }]);
  });

  it('a builtin key is not a rename target', () => {
    expect(plan({ created_at: { type: 'datetime', renamedFrom: ['a'] } }, ['a'])).toEqual({ carries: [], refusals: [] });
  });

  it('refuses `destructive_type` for a virtual target while the old column stands — never passed over in silence', () => {
    const p = plan({ b: { type: 'formula', expression: '1', renamedFrom: ['a'] } }, ['a']);
    expect(reasons(p)).toEqual(['destructive_type']);
    expect(p.carries).toEqual([]);
    expect(p.refusals[0]!.message).toContain("t.b declares `renamedFrom` 'a'");
    expect(p.refusals[0]!.message).toContain('stores no column');
    // Once the old column is gone there is nothing left to strand: no refusal.
    expect(plan({ b: { type: 'formula', expression: '1', renamedFrom: ['a'] } }, [])).toEqual({ carries: [], refusals: [] });
  });

  it('refuses `platform_column`: the record id, an audit column, the tenant column', () => {
    for (const old of ['id', 'created_at', 'updated_at', 'org_id']) {
      const p = plan({ b: { type: 'text', renamedFrom: [old] } }, [old], { tenantField: 'org_id' });
      expect(reasons(p), old).toEqual(['platform_column']);
      expect(p.carries).toEqual([]);
      expect(p.refusals[0]!.message).toContain(`t.b declares \`renamedFrom\` '${old}'`);
    }
  });

  it('refuses `live_key`: the old key is still a field of the object (an extension still declares it)', () => {
    const p = plan({ a: { type: 'text' }, b: { type: 'text', renamedFrom: ['a'] } }, ['a']);
    expect(reasons(p)).toEqual(['live_key']);
    expect(p.carries).toEqual([]);
    // The door passes the map the upgrade leaves, which can differ from `fields`.
    expect(reasons(plan({ b: { type: 'text', renamedFrom: ['a'] } }, ['a'], { liveKeys: ['a', 'b'] }))).toEqual(['live_key']);
  });

  it('refuses `claimed_twice`: two fields claim the same old key', () => {
    const p = plan({ b: { type: 'text', renamedFrom: ['a'] }, c: { type: 'text', renamedFrom: ['a'] } }, ['a']);
    expect(reasons(p)).toEqual(['claimed_twice']);
    expect(p.refusals[0]!.field).toBe('c');
  });

  it('refuses `both_columns`: the old column and the new one both exist', () => {
    const p = plan({ b: { type: 'text', renamedFrom: ['a'] } }, ['a', 'b']);
    expect(reasons(p)).toEqual(['both_columns']);
    expect(p.refusals[0]!.from).toEqual(['a']);
  });

  it('refuses `several_old_columns`: two old keys in one list both still have columns', () => {
    const p = plan({ b: { type: 'text', renamedFrom: ['a', 'a2'] } }, ['a', 'a2']);
    expect(reasons(p)).toEqual(['several_old_columns']);
    expect(p.refusals[0]!.from).toEqual(['a', 'a2']);
  });
});

/** A stub host for the facet: the table's columns, its indexes, the dialect. */
function stubHost(opts: {
  columns: Record<string, { type: string; maxLength?: number }>;
  dialectName?: 'sqlite' | 'postgres' | 'mysql' | 'unknown';
  indexes?: Array<{ name: string; columns: string[]; unique: boolean; shadowKey?: Array<{ column: string }> }>;
}) {
  const dialectName = opts.dialectName ?? 'sqlite';
  const knex: any = () => ({ columnInfo: async () => opts.columns });
  knex.schema = { hasTable: async () => true };
  const host: any = {
    dialectName,
    isMysql: dialectName === 'mysql',
    knex,
    fileColumnsMoved: false,
    resolveTenantField: () => null,
    varcharColumnChars: () => null,
    introspectColumns: async () => Object.entries(opts.columns).map(([name, c]) => ({
      name, type: c.type, nullable: true, maxLength: c.maxLength, defaultValue: null,
    })),
    introspectIndexes: async () => opts.indexes ?? [],
  };
  host.declaredRenameLimit = () => DeclaredRenameFacet.declaredRenameLimit.call(host);
  return host;
}

describe('DeclaredRenameFacet.planDeclaredRenames — the refusals that need a dialect or a transport (#30885)', () => {
  it('refuses `index_cannot_follow` on MySQL: a hash-shadow unique keys the old column by name', async () => {
    const carrier = { name: 'uniq_t_a', columns: [hashShadowColumnFor('uniq_t_a')], unique: true, shadowKey: [{ column: 'a' }] };
    expect(isHashShadowCarrier(carrier as any)).toBe(true);
    const host = stubHost({ dialectName: 'mysql', columns: { id: { type: 'varchar' }, a: { type: 'text' } }, indexes: [carrier] });
    const plan = await DeclaredRenameFacet.planDeclaredRenames.call(host, 't', { fields: { b: { type: 'text', renamedFrom: ['a'] } } });
    expect(reasons(plan)).toEqual(['index_cannot_follow']);
    expect(plan.refusals[0]!.message).toContain("'uniq_t_a'");
    expect(plan.carries).toEqual([]);
    // The same table on PostgreSQL carries: the index follows the column there.
    const pg = stubHost({ dialectName: 'postgres', columns: { id: { type: 'varchar' }, a: { type: 'text' } }, indexes: [carrier] });
    expect((await DeclaredRenameFacet.planDeclaredRenames.call(pg, 't', { fields: { b: { type: 'text', renamedFrom: ['a'] } } })).carries)
      .toEqual([{ table: 't', from: 'a', to: 'b' }]);
  });

  it('refuses `transport` when the dialect renames no column — only when there is a column to carry', async () => {
    const owes = stubHost({ dialectName: 'unknown', columns: { id: { type: 'varchar' }, a: { type: 'text' } } });
    const plan = await DeclaredRenameFacet.planDeclaredRenames.call(owes, 't', { fields: { b: { type: 'text', renamedFrom: ['a'] } } });
    expect(reasons(plan)).toEqual(['transport']);
    expect(plan.refusals[0]!.message).toContain('renames no column');
    const done = stubHost({ dialectName: 'unknown', columns: { id: { type: 'varchar' }, b: { type: 'text' } } });
    expect(await DeclaredRenameFacet.planDeclaredRenames.call(done, 't', { fields: { b: { type: 'text', renamedFrom: ['a'] } } }))
      .toEqual({ carries: [], refusals: [] });
  });

  it('refuses `destructive_type`: the old column read under the new declaration narrows it', async () => {
    const host = stubHost({ dialectName: 'postgres', columns: { id: { type: 'varchar' }, a: { type: 'character varying', maxLength: 255 } } });
    host.varcharColumnChars = () => 20;
    const plan = await DeclaredRenameFacet.planDeclaredRenames.call(host, 't', {
      fields: { b: { type: 'email', maxLength: 20, renamedFrom: ['a'] } },
    });
    expect(reasons(plan)).toEqual(['destructive_type']);
    expect(plan.refusals[0]!.message).toContain("t.b declares `renamedFrom` 'a'");
  });
});

// ── Half 2: live, on every provisioned dialect cell ─────────────────────────

const V1 = (table: string, extra: Record<string, unknown> = {}) => ({
  name: table,
  fields: { a: { type: 'text' }, n: { type: 'number' }, ...extra },
});
const V2 = (table: string, b: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  name: table,
  fields: { b: { type: 'text', renamedFrom: ['a'], ...b }, n: { type: 'number' }, ...extra },
});

function declareDeclaredRenameSuite(cell: DialectCell): void {
  describe(`declared rename through the schema sync — ${cell.label} (#30885)`, () => {
    const opened: SqlDriver[] = [];
    const lines: string[] = [];
    // SQLite's cell is `:memory:`, one database per connection: a file here,
    // so a second driver (the boot on the new artifact) opens the same one.
    const file = join(scratch, `${cell.id}.sqlite`);
    const open = (): SqlDriver => {
      const config = cell.id === 'sqlite' ? { ...cell.config(), connection: { filename: file } } : cell.config();
      const driver = new SqlDriver(config as any);
      (driver as any).logger = { warn: (m: string) => lines.push(m), info: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
      opened.push(driver);
      return driver;
    };
    const columns = async (driver: SqlDriver, table: string) =>
      Object.keys(await (driver as any).knex(table).columnInfo()).sort();
    const rows = async (driver: SqlDriver, table: string) =>
      (await (driver as any).knex(table).select('*').orderBy('n')) as Array<Record<string, unknown>>;
    const fresh = async (driver: SqlDriver, table: string) => {
      await (driver as any).knex.schema.dropTableIfExists(table);
    };
    const seed = async (driver: SqlDriver, table: string) => {
      await driver.initObjects([V1(table)]);
      for (const [i, v] of ['alpha', 'beta', 'gamma'].entries()) await driver.create(table, { id: `r${i}`, a: v, n: i });
    };

    afterEach(async () => {
      lines.length = 0;
      while (opened.length) {
        const d = opened.pop()!;
        await d.disconnect().catch(() => {});
      }
    });

    it('v1 rows in a → v2 b renamedFrom [a]: b holds the rows, a is gone, the count is unchanged; the log names it', async () => {
      const table = 'os30885_carry';
      const v1 = open();
      await fresh(v1, table);
      await seed(v1, table);
      await v1.disconnect();

      // A boot on the new artifact: a new driver, the same database.
      const v2 = open();
      await v2.initObjects([V2(table)]);
      const cols = await columns(v2, table);
      expect(cols).toContain('b');
      expect(cols).not.toContain('a');
      const after = await rows(v2, table);
      expect(after.map((r) => r.b)).toEqual(['alpha', 'beta', 'gamma']);
      expect(after).toHaveLength(3);
      // The driver's own read path serves the new key.
      expect((await v2.findOne(table, { where: { id: 'r1' } }))?.b).toBe('beta');
      expect(lines.some((l) => l.includes(`carried the declared rename ${table}.a → ${table}.b`))).toBe(true);
      await fresh(v2, table);
    });

    it('a second sync changes nothing', async () => {
      const table = 'os30885_again';
      const v1 = open();
      await fresh(v1, table);
      await seed(v1, table);
      await v1.initObjects([V2(table)]);
      lines.length = 0;
      const before = await columns(v1, table);

      const again = open();
      await again.initObjects([V2(table)]);
      expect(await columns(again, table)).toEqual(before);
      expect((await rows(again, table)).map((r) => r.b)).toEqual(['alpha', 'beta', 'gamma']);
      expect(lines.some((l) => l.includes('carried the declared rename'))).toBe(false);
      await fresh(again, table);
    });

    it('without renamedFrom the sync stays additive: b is a new, empty column beside a', async () => {
      const table = 'os30885_undeclared';
      const driver = open();
      await fresh(driver, table);
      await seed(driver, table);
      await driver.initObjects([{ name: table, fields: { b: { type: 'text' }, n: { type: 'number' } } }]);
      const cols = await columns(driver, table);
      expect(cols).toEqual(expect.arrayContaining(['a', 'b']));
      expect((await rows(driver, table)).map((r) => r.b)).toEqual([null, null, null]);
      await fresh(driver, table);
    });

    it('a unique on the old key follows the column: the new key is enforced, and the old name is retired', async () => {
      const table = 'os30885_uniq';
      const driver = open();
      await fresh(driver, table);
      await driver.initObjects([V1(table, { a: { type: 'text', maxLength: 64, unique: true } })]);
      await driver.create(table, { id: 'r0', a: 'k0', n: 0 });
      await driver.initObjects([V2(table, { maxLength: 64, unique: true })]);
      const names = ((await (driver as any).introspectIndexes(table)) as Array<{ name: string; columns: string[] }>);
      expect(names.some((i) => i.columns.includes('b'))).toBe(true);
      expect(names.map((i) => i.name)).not.toContain(`uniq_${table}_a`);
      await expect(driver.create(table, { id: 'r1', b: 'k0', n: 1 })).rejects.toThrow();
      await driver.create(table, { id: 'r2', b: 'k2', n: 2 });
      await fresh(driver, table);
    });

    it('a lookup (reference) renamed carries the ids it holds', async () => {
      const table = 'os30885_ref';
      const driver = open();
      await fresh(driver, table);
      await driver.initObjects([{ name: table, fields: { acct: { type: 'lookup', reference: 'account' }, n: { type: 'number' } } }]);
      await driver.create(table, { id: 'r0', acct: 'acc_1', n: 0 });
      await driver.initObjects([{ name: table, fields: { account: { type: 'lookup', reference: 'account', renamedFrom: ['acct'] }, n: { type: 'number' } } }]);
      expect((await rows(driver, table))[0]!.account).toBe('acc_1');
      await fresh(driver, table);
    });

    for (const [reason, v2, setup] of [
      ['both_columns', V2('t'), async (d: SqlDriver, table: string) => (d as any).knex.schema.alterTable(table, (t: any) => t.text('b'))],
      ['several_old_columns', { name: 't', fields: { b: { type: 'text', renamedFrom: ['a', 'a2'] }, n: { type: 'number' } } },
        async (d: SqlDriver, table: string) => (d as any).knex.schema.alterTable(table, (t: any) => t.text('a2'))],
      ['platform_column', { name: 't', fields: { a: { type: 'text' }, b: { type: 'text', renamedFrom: ['created_at'] }, n: { type: 'number' } } }, null],
      ['live_key', { name: 't', fields: { a: { type: 'text' }, b: { type: 'text', renamedFrom: ['a'] }, n: { type: 'number' } } }, null],
      ['claimed_twice', { name: 't', fields: { b: { type: 'text', renamedFrom: ['a'] }, c: { type: 'text', renamedFrom: ['a'] }, n: { type: 'number' } } }, null],
      ['destructive_type', { name: 't', fields: { b: { type: 'formula', expression: '1', renamedFrom: ['a'] }, n: { type: 'number' } } }, null],
    ] as const) {
      it(`refuses \`${reason}\` before any DDL: no column renamed, added or dropped, every row kept`, async () => {
        const table = `os30885_r_${reason}`;
        const driver = open();
        await fresh(driver, table);
        await seed(driver, table);
        if (setup) await setup(driver, table);
        const before = await columns(driver, table);
        const declared = { ...(v2 as any), name: table };
        const err = await driver.initObjects([declared]).then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(DeclaredRenameRefusal);
        expect((err as DeclaredRenameRefusal).refusals.map((r) => r.reason)).toContain(reason);
        expect((err as Error).message).toContain('Nothing was changed on this table');
        expect(await columns(driver, table)).toEqual(before);
        expect((await rows(driver, table)).map((r) => r.a)).toEqual(['alpha', 'beta', 'gamma']);
        await fresh(driver, table);
      });
    }

    it('a forced failure mid-way leaves v1 serving: every column where it was, every row intact', async () => {
      const table = 'os30885_midway';
      const driver = open();
      await fresh(driver, table);
      await seed(driver, table);
      await (driver as any).knex.schema.alterTable(table, (t: any) => t.text('c'));
      // Two renames of one table; the second names a column that is not there,
      // so the statement fails after the first has run.
      await expect(executeDeclaredRenames((driver as any).knex, (driver as any).dialectName, table, [
        { from: 'a', to: 'b' },
        { from: 'missing', to: 'd' },
      ])).rejects.toThrow();
      const cols = await columns(driver, table);
      expect(cols).toContain('a');
      expect(cols).not.toContain('b');
      expect((await rows(driver, table)).map((r) => r.a)).toEqual(['alpha', 'beta', 'gamma']);
      // …and v1 still reads them through the driver.
      expect((await driver.findOne(table, { where: { id: 'r2' } }))?.a).toBe('gamma');
      await fresh(driver, table);
    });

    it('`reverseDeclaredRenames` puts a carry back, values and all', async () => {
      const table = 'os30885_reverse';
      const driver = open();
      await fresh(driver, table);
      await seed(driver, table);
      const carries = await driver.carryDeclaredRenames(table, V2(table));
      expect(carries).toEqual([{ table, from: 'a', to: 'b' }]);
      await driver.reverseDeclaredRenames(carries);
      expect(await columns(driver, table)).toContain('a');
      expect((await rows(driver, table)).map((r) => r.a)).toEqual(['alpha', 'beta', 'gamma']);
      await fresh(driver, table);
    });

    it('`os migrate` preview names the carry (`rename_columns`) and a refusal (`refuse_table`) without running either', async () => {
      const table = 'os30885_preview';
      const refused = 'os30885_preview_refused';
      const driver = open();
      await fresh(driver, table);
      await fresh(driver, refused);
      await seed(driver, table);
      await seed(driver, refused);
      await (driver as any).knex.schema.alterTable(refused, (t: any) => t.text('b'));
      driver.setDeferredDdl(true);
      await driver.initObjects([V2(table), V2(refused)]);
      const pending = await driver.previewDeferredSchemaWork();
      expect(pending.find((p) => p.table === table)).toMatchObject({ kind: 'rename_columns', columns: ['b'], renames: [{ from: 'a', to: 'b' }] });
      expect(pending.find((p) => p.table === refused)).toMatchObject({ kind: 'refuse_table' });
      expect(await columns(driver, table)).toContain('a');
      await fresh(driver, table);
      await fresh(driver, refused);
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareDeclaredRenameSuite);
}
