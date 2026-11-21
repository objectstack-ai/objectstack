// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 plan step 3] `driver-sql` compiles the `SharedRecordIds`
 * fixed-read leaf to its fixed inner read, `field IN (SELECT record_id FROM
 * sys_record_share WHERE … AND record_id IS NOT NULL AND record_id <> '')`,
 * with no tenant scope on the subquery (① ruled A), on reads and on the
 * predicate-update path (③ ruled A), and refuses a misplaced leaf with
 * ADR-0139 D3's envelope.
 *
 * Every live dialect cell runs:
 *
 * - **the shared case-set** (`SHARED_RECORD_IDS_CASE_SET.cases`,
 *   `@objectstack/spec/data`), `find` and `count`, no per-driver hand copy;
 * - **the predicate update's two statements**: the engine's prior-row read,
 *   `driver.find(object, ast, preOpts)`, and the write,
 *   `driver.updateMany(object, ast, data, opts)` (`engine-update.ts`), each
 *   evaluating the share arm for itself (ADR-0155, Consequences, Freshness);
 * - **N4 (step 1's L2)**: the `<> ''` half of the blank-id guard, witnessed by
 *   a record whose id is the empty string, which no registration door writes
 *   and so the shared fixture cannot hold;
 * - **O2**: the comparison is the outer column's against `record_id` under the
 *   dialect's own collation, exactly as today's list binds it, so the leaf and
 *   the list answer the same rows for case and padding variants too;
 * - the declaration, the absence of a tenant scope in the statement, the
 *   bindings, and the refusals with `code` and `status`.
 *
 * MSSQL and Oracle are pinned by the compiled statement (no server here).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Knex } from 'knex';
import {
  READABLE_IDS_REFUSAL,
  ReadableIds,
  SHARED_RECORD_IDS_CASE_SET,
  SharedRecordIds,
  isSharedRecordIds,
  lowerFilterCondition,
  type FilterCondition,
  type FixedReadLeafRow,
} from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const set = SHARED_RECORD_IDS_CASE_SET;
const seamed = (where: unknown): any => lowerFilterCondition(where, { isDatetimeColumn: () => false });

const DOC = 'srid_doc';
const GRANTS = 'sys_record_share';
/** O2's object: ids that a case- or padding-insensitive collation would confuse with a grant's spelling. */
const O2 = 'srid_o2';
const TABLES = [DOC, GRANTS, 'srid_note', O2];

const rowsOf = (object: string): readonly FixedReadLeafRow[] => set.tables.find((t) => t.object === object)!.rows;
const fieldsOf = (rows: readonly FixedReadLeafRow[]): Record<string, { type: 'text' }> =>
  Object.fromEntries([...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== 'id').map((k) => [k, { type: 'text' }]));
const sortedIds = (rows: any[]): string[] => rows.map((r) => String(r.id)).sort();

/** Does `where` hold a WRITE-form leaf (one that carries `accessLevels`), at any depth? */
const holdsWriteForm = (node: unknown): boolean => {
  if (isSharedRecordIds(node)) return node.accessLevels !== undefined;
  if (node === null || typeof node !== 'object') return false;
  return (Array.isArray(node) ? node : Object.values(node)).some(holdsWriteForm);
};

const O2_ROWS = [
  { id: 'k1', organization_id: 'org_a' },
  { id: 'k2', organization_id: 'org_a' },
  { id: 'k3', organization_id: 'org_a' },
];
/** A grant per spelling: a case variant, a trailing space, and the exact id. */
const O2_GRANTS = [
  { id: 'o2g1', object_name: O2, recipient_type: 'user', recipient_id: 'u9', record_id: 'K1', access_level: 'lvl_read', organization_id: 'org_a' },
  { id: 'o2g2', object_name: O2, recipient_type: 'user', recipient_id: 'u9', record_id: 'k2 ', access_level: 'lvl_read', organization_id: 'org_a' },
  { id: 'o2g3', object_name: O2, recipient_type: 'user', recipient_id: 'u9', record_id: 'k3', access_level: 'lvl_read', organization_id: 'org_a' },
];

async function seedDocs(driver: SqlDriver): Promise<void> {
  const knex: Knex = (driver as any).knex;
  await knex(DOC).del();
  await knex(DOC).insert(rowsOf(DOC).map((r) => ({ ...r })));
}

function declareFixedReadLeafSweep(cell: DialectCell): void {
  describe(`[ADR-0155 step 3] driver-sql — SharedRecordIds conformance (${cell.label})`, () => {
    let driver: SqlDriver;
    let knex: Knex;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knex = (driver as any).knex;
      for (const t of TABLES) await driver.execute(`drop table if exists ${t}`).catch(() => {});
      await driver.initObjects([
        ...set.tables.map((t) => ({ name: t.object, fields: fieldsOf(t.rows) })),
        { name: O2, fields: fieldsOf(O2_ROWS) },
      ] as any);
      for (const t of set.tables) await knex(t.object).insert(t.rows.map((r) => ({ ...r })));
      await knex(O2).insert(O2_ROWS);
      await knex(GRANTS).insert(O2_GRANTS);
    }, 60_000);

    afterAll(async () => {
      for (const t of TABLES) await driver?.execute(`drop table if exists ${t}`).catch(() => {});
      await driver?.disconnect?.();
    });

    it('declares the leaf it compiles: supports.fixedReadLeaves is exactly [SharedRecordIds]', () => {
      expect(driver.supports.fixedReadLeaves).toEqual(['SharedRecordIds']);
    });

    describe('shared conformance cases (find, and count with the same where)', () => {
      for (const c of set.cases) {
        it(c.name, async () => {
          const rows = await driver.find(c.object, { where: seamed(c.where()) }, c.options);
          expect(sortedIds(rows), c.note).toEqual([...c.expected]);
          // One statement: `count` answers the same population as `find`.
          expect(await driver.count(c.object, { where: seamed(c.where()) }, c.options), c.note).toBe(c.expected.length);
        });
      }

      it('aggregate agrees with find: the leaf is one statement on every read verb', async () => {
        const out = await driver.aggregate(
          DOC,
          { where: seamed({ id: { $in: SharedRecordIds.read(DOC, 'u1') } }), aggregations: [{ function: 'count', alias: 'n' }] },
          { tenantId: 'org_a' },
        );
        expect(Number((out[0] as any).n)).toBe(3);
      });
    });

    describe('the predicate update\'s two statements (③ ruled A)', () => {
      const writeCases = set.cases.filter((c) => holdsWriteForm(c.where()));

      it('the case-set carries write-form cases to run', () => {
        expect(writeCases.length).toBeGreaterThanOrEqual(2);
      });

      for (const c of writeCases) {
        it(`${c.name}: the prior-row read and the write each answer the case's rows`, async () => {
          await seedDocs(driver);
          const where = seamed(c.where());
          // The engine's prior-row read: driver.find(object, ast, preOpts).
          expect(sortedIds(await driver.find(c.object, { where }, c.options))).toEqual([...c.expected]);
          // The write: driver.updateMany(object, ast, data, opts), the same AST.
          const touched = await driver.updateMany(c.object, { where }, { label: 'touched' }, c.options);
          expect(touched).toBe(c.expected.length);
          expect(sortedIds(await knex(c.object).where('label', 'touched').select('id'))).toEqual([...c.expected]);
          await seedDocs(driver);
        });
      }

      it('under a tenant: the write is walled on the outer statement and the inner read stays unwalled', async () => {
        await seedDocs(driver);
        const where = seamed({ id: { $in: SharedRecordIds.write(DOC, 'u1', ['lvl_edit', 'lvl_full']) } });
        expect(sortedIds(await driver.find(DOC, { where }, { tenantId: 'org_a' }))).toEqual(['d2', 'd7']);
        expect(await driver.updateMany(DOC, { where }, { label: 'touched' }, { tenantId: 'org_a' })).toBe(2);
        // d7 through g7, stamped org_b (no tenant scope on the inner read); d8 in org_b, outside the outer wall.
        expect(sortedIds(await knex(DOC).where('label', 'touched').select('id'))).toEqual(['d2', 'd7']);
        await seedDocs(driver);
      });

      it('freshness: each statement reads the grants as they stand when it runs', async () => {
        await seedDocs(driver);
        const where = () => seamed({ id: { $in: SharedRecordIds.write(DOC, 'u1', ['lvl_edit', 'lvl_full']) } });
        expect(sortedIds(await driver.find(DOC, { where: where() }))).toEqual(['d2', 'd7', 'd8']);
        // A grant lands between the prior-row read and the write; another is revoked.
        await knex(GRANTS).insert({ id: 'g_fresh', object_name: DOC, recipient_type: 'user', recipient_id: 'u1', record_id: 'd1', access_level: 'lvl_edit', organization_id: 'org_a' });
        await knex(GRANTS).where('id', 'g8').del();
        try {
          expect(await driver.updateMany(DOC, { where: where() }, { label: 'touched' })).toBe(3);
          expect(sortedIds(await knex(DOC).where('label', 'touched').select('id'))).toEqual(['d1', 'd2', 'd7']);
        } finally {
          await knex(GRANTS).where('id', 'g_fresh').del();
          await knex(GRANTS).insert(rowsOf(GRANTS).filter((r) => r.id === 'g8').map((r) => ({ ...r })));
          await seedDocs(driver);
        }
      });
    });

    describe('N4: the `<> \'\'` half of the blank-id guard', () => {
      // A record whose id is the empty string: g10 grants it to u1 by its
      // `record_id`, so only the `<> ''` half keeps it out of the set.
      beforeAll(async () => {
        await knex(DOC).insert({ id: '', owner: 'u2', label: 'keep', organization_id: 'org_a' });
      });
      afterAll(async () => {
        await knex(DOC).where('id', '').del();
      });

      it('the empty id names no record: the leaf does not admit it', async () => {
        const rows = await driver.find(DOC, { where: seamed({ id: { $in: SharedRecordIds.read(DOC, 'u1') } }) });
        expect(sortedIds(rows)).toEqual(['d1', 'd2', 'd7', 'd8']);
        expect(await driver.count(DOC, { where: seamed({ id: { $in: SharedRecordIds.read(DOC, 'u1') } }) })).toBe(4);
      });

      it('and the negation answers it: not shared', async () => {
        const rows = await driver.find(DOC, { where: seamed({ $not: { id: { $in: SharedRecordIds.read(DOC, 'u1') } } }) });
        expect(sortedIds(rows)).toEqual(['', 'd3', 'd4', 'd5', 'd6', 'd9']);
      });

      it('the write path keeps it out too', async () => {
        const where = seamed({ id: { $in: SharedRecordIds.write(DOC, 'u1', ['lvl_edit', 'lvl_full']) } });
        try {
          expect(await driver.updateMany(DOC, { where }, { label: 'touched' })).toBe(3);
          expect(await knex(DOC).where('id', '').first()).toMatchObject({ label: 'keep' });
        } finally {
          await knex(DOC).where('label', 'touched').update({ label: 'keep' });
          await knex(DOC).where('id', 'd7').update({ label: 'drop' });
        }
      });
    });

    describe('O2: the comparison, type and collation are today\'s list\'s', () => {
      const leaf = () => seamed({ id: { $in: SharedRecordIds.read(O2, 'u9') } });
      const list = () => seamed({ id: { $in: O2_GRANTS.map((g) => g.record_id) } });

      it('the leaf answers the rows today\'s list of the same grants answers, under this dialect\'s collation', async () => {
        const viaList = sortedIds(await driver.find(O2, { where: list() }));
        expect(sortedIds(await driver.find(O2, { where: leaf() }))).toEqual(viaList);
        expect(await driver.count(O2, { where: leaf() })).toBe(viaList.length);
      });

      if (cell.id === 'sqlite' || cell.id === 'pg') {
        it('a deterministic, unpadded collation: only the exact spelling matches, as in the list', async () => {
          expect(sortedIds(await driver.find(O2, { where: leaf() }))).toEqual(['k3']);
        });
      }

      if (cell.id === 'sqlite') {
        // D-0's other type: a federated table keyed by INTEGER. SQLite applies
        // the column's numeric affinity to `record_id` in the subquery as it does
        // to each bound member of the list, so '07' names 7 both ways.
        it('an INTEGER outer key answers the rows today\'s list answers', async () => {
          const EXT = 'srid_o2_int';
          await driver.execute(`drop table if exists ${EXT}`).catch(() => {});
          await driver.execute(`create table ${EXT} (id integer primary key, label text)`);
          const grants = [
            { id: 'o2i1', object_name: EXT, recipient_type: 'user', recipient_id: 'u9', record_id: '42', access_level: 'lvl_read', organization_id: 'org_a' },
            { id: 'o2i2', object_name: EXT, recipient_type: 'user', recipient_id: 'u9', record_id: '07', access_level: 'lvl_read', organization_id: 'org_a' },
          ];
          try {
            await knex(EXT).insert([{ id: 7, label: 'a' }, { id: 42, label: 'b' }, { id: 43, label: 'c' }]);
            await knex(GRANTS).insert(grants);
            driver.registerExternalObject({ name: EXT, fields: { label: { type: 'text' } } });
            const viaList = await driver.find(EXT, { where: seamed({ id: { $in: grants.map((g) => g.record_id) } }) });
            const viaLeaf = await driver.find(EXT, { where: seamed({ id: { $in: SharedRecordIds.read(EXT, 'u9') } }) });
            expect(sortedIds(viaLeaf)).toEqual(sortedIds(viaList));
            expect(sortedIds(viaLeaf)).toEqual(['42', '7']);
          } finally {
            await knex(GRANTS).whereIn('id', grants.map((g) => g.id)).del();
            await driver.execute(`drop table if exists ${EXT}`).catch(() => {});
          }
        });
      }
    });

    describe('the statement', () => {
      it('carries the outer tenant wall once and none inside the subquery, and binds the leaf\'s inputs only', async () => {
        const seen: { sql: string; bindings: readonly unknown[] }[] = [];
        const onQuery = (q: { sql: string; bindings?: readonly unknown[] }) => {
          if (q.sql.includes('sys_record_share')) seen.push({ sql: q.sql, bindings: q.bindings ?? [] });
        };
        knex.on('query', onQuery);
        try {
          await driver.find(DOC, { where: seamed({ id: { $in: SharedRecordIds.read(DOC, 'u1') } }) }, { tenantId: 'org_a' });
        } finally {
          knex.removeListener('query', onQuery);
        }
        expect(seen).toHaveLength(1);
        const { sql, bindings } = seen[0];
        const inner = sql.slice(sql.toLowerCase().indexOf('(select'));
        expect(sql.match(/organization_id/g)).toHaveLength(1);
        expect(inner).not.toMatch(/organization_id/);
        expect(inner.toLowerCase()).toMatch(/is not null and .record_id. <> /);
        expect(bindings).toEqual(expect.arrayContaining([DOC, 'user', 'u1', '', 'org_a']));
        // No per-id parameter, whatever the grants hold: the inner read's four and the wall's one.
        expect(bindings).toHaveLength(5);
      });
    });

    describe('refusals: a leaf anywhere but a field\'s $in comparand', () => {
      const leaf = () => SharedRecordIds.read(DOC, 'u1');
      const misplaced: [string, () => unknown][] = [
        ['as a field\'s bare value', () => ({ id: leaf() })],
        ['under $nin', () => ({ id: { $nin: leaf() } })],
        ['under $eq', () => ({ id: { $eq: leaf() } })],
        ['as a member of a $in list', () => ({ id: { $in: [leaf()] } })],
        ['as a $and member', () => ({ $and: [leaf()] })],
        ['as $not\'s operand', () => ({ $not: leaf() })],
        ['misplaced inside a composed ReadableIds scope', () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(DOC), { owner: leaf() }) } })],
      ];
      for (const [name, where] of misplaced) {
        it(`${name}: INTERNAL_ERROR / 500 on find, count and updateMany, no row written`, async () => {
          const object = name.includes('ReadableIds') ? 'srid_note' : DOC;
          const w = where() as FilterCondition;
          await expect(driver.find(object, { where: w })).rejects.toMatchObject(READABLE_IDS_REFUSAL);
          await expect(driver.count(object, { where: w })).rejects.toMatchObject(READABLE_IDS_REFUSAL);
          await expect(driver.updateMany(object, { where: w }, { label: 'touched' })).rejects.toMatchObject(READABLE_IDS_REFUSAL);
          expect(Number((await knex(DOC).where('label', 'touched').count({ n: '*' }))[0].n)).toBe(0);
        });
      }

      it('the refusal names the position and the leaf, never its recipient', async () => {
        const err = await driver.find(DOC, { where: { id: { $nin: leaf() } } as any }).catch((e) => e);
        expect(err).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
        expect(err.message).toContain('[driver-sql] where.id.$nin holds a SharedRecordIds leaf');
        expect(err.message).not.toContain('u1');
      });

      it('is logged at error once per driver, and every refusal reaches the caller', async () => {
        const fresh = new SqlDriver(cell.config());
        const error = vi.spyOn((fresh as any).logger, 'error');
        for (let i = 0; i < 2; i++) {
          await expect(fresh.find(DOC, { where: { id: { $nin: leaf() } } as any })).rejects.toMatchObject(READABLE_IDS_REFUSAL);
        }
        expect(error).toHaveBeenCalledTimes(1);
        await fresh.disconnect?.();
      });
    });
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, 'SharedRecordIds conformance', declareFixedReadLeafSweep);

// ── The compiled statement, on every dialect driver-sql ships ───────────────

class CompileProbe extends SqlDriver {
  compileWhere(where: FilterCondition): { sql: string; bindings: readonly unknown[] } {
    const builder: Knex.QueryBuilder = this.getKnex()(DOC);
    this.applyFilters(builder, where);
    const native = builder.toSQL().toNative();
    return { sql: native.sql, bindings: native.bindings };
  }
}

const COMPILE_CONFIGS: Record<string, SqlDriverConfig> = {
  sqlite: { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as SqlDriverConfig,
  pg: { client: 'pg', connection: {} } as unknown as SqlDriverConfig,
  mysql: { client: 'mysql2', connection: {} } as unknown as SqlDriverConfig,
  mssql: { client: 'mssql', connection: {}, schemaMode: 'external' } as unknown as SqlDriverConfig,
  oracle: {
    client: 'oracledb',
    connection: { user: 'nobody', password: 'unused', connectString: '127.0.0.1:1/NONE' },
    schemaMode: 'external',
  } as unknown as SqlDriverConfig,
};

/** What each dialect compiles `{ id: { $in: <read form> } }` and the write form to. Never dialled. */
const COMPILED: Record<string, { read: string; write: string }> = {
  sqlite: {
    read: 'select * from `srid_doc` where `id` in (select `record_id` from `sys_record_share` where `object_name` = ? and `recipient_type` = ? and `recipient_id` = ? and `record_id` is not null and `record_id` <> ?)',
    write: 'select * from `srid_doc` where `id` in (select `record_id` from `sys_record_share` where `object_name` = ? and `recipient_type` = ? and `recipient_id` = ? and `access_level` in (?, ?) and `record_id` is not null and `record_id` <> ?)',
  },
  pg: {
    read: 'select * from "srid_doc" where "id" in (select "record_id" from "sys_record_share" where "object_name" = $1 and "recipient_type" = $2 and "recipient_id" = $3 and "record_id" is not null and "record_id" <> $4)',
    write: 'select * from "srid_doc" where "id" in (select "record_id" from "sys_record_share" where "object_name" = $1 and "recipient_type" = $2 and "recipient_id" = $3 and "access_level" in ($4, $5) and "record_id" is not null and "record_id" <> $6)',
  },
  mysql: {
    read: 'select * from `srid_doc` where `id` in (select `record_id` from `sys_record_share` where `object_name` = ? and `recipient_type` = ? and `recipient_id` = ? and `record_id` is not null and `record_id` <> ?)',
    write: 'select * from `srid_doc` where `id` in (select `record_id` from `sys_record_share` where `object_name` = ? and `recipient_type` = ? and `recipient_id` = ? and `access_level` in (?, ?) and `record_id` is not null and `record_id` <> ?)',
  },
  mssql: {
    read: 'select * from [srid_doc] where [id] in (select [record_id] from [sys_record_share] where [object_name] = @p0 and [recipient_type] = @p1 and [recipient_id] = @p2 and [record_id] is not null and [record_id] <> @p3)',
    write: 'select * from [srid_doc] where [id] in (select [record_id] from [sys_record_share] where [object_name] = @p0 and [recipient_type] = @p1 and [recipient_id] = @p2 and [access_level] in (@p3, @p4) and [record_id] is not null and [record_id] <> @p5)',
  },
  // Oracle stores '' as NULL, so `<> ''` would be `<> NULL`, true for no row: `IS NOT NULL` is the whole guard.
  oracle: {
    read: 'select * from "srid_doc" where "id" in (select "record_id" from "sys_record_share" where "object_name" = :1 and "recipient_type" = :2 and "recipient_id" = :3 and "record_id" is not null)',
    write: 'select * from "srid_doc" where "id" in (select "record_id" from "sys_record_share" where "object_name" = :1 and "recipient_type" = :2 and "recipient_id" = :3 and "access_level" in (:4, :5) and "record_id" is not null)',
  },
};

describe('[ADR-0155 step 3] the compiled fixed inner read, per dialect (no server)', () => {
  for (const [dialect, config] of Object.entries(COMPILE_CONFIGS)) {
    it(`${dialect}: one subquery in the list's position, every value bound, no tenant scope inside it`, () => {
      const probe = new CompileProbe(config);
      expect(probe.supports.fixedReadLeaves).toEqual(['SharedRecordIds']);
      const read = probe.compileWhere({ id: { $in: SharedRecordIds.read(DOC, 'u1') } } as unknown as FilterCondition);
      expect(read.sql).toBe(COMPILED[dialect].read);
      expect(read.bindings).toEqual(dialect === 'oracle' ? [DOC, 'user', 'u1'] : [DOC, 'user', 'u1', '']);
      const write = probe.compileWhere({ id: { $in: SharedRecordIds.write(DOC, 'u1', ['lvl_edit', 'lvl_full']) } } as unknown as FilterCondition);
      expect(write.sql).toBe(COMPILED[dialect].write);
      expect(write.bindings).toEqual(
        dialect === 'oracle' ? [DOC, 'user', 'u1', 'lvl_edit', 'lvl_full'] : [DOC, 'user', 'u1', 'lvl_edit', 'lvl_full', ''],
      );
    });
  }
});
