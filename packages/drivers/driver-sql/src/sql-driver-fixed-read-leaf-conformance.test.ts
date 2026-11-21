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
 * - **O2 on PostgreSQL (ruled A)**: a federated table keyed by integer,
 *   bigint, uuid, `character(n)` or a domain answers the list's rows, because
 *   the inner read casts `record_id` to the key's base type
 *   (`fixed-read-leaf-key-type.ts`); a text key keeps step 3's statement;
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
  type DriverOptions,
  type FixedReadLeafRow,
} from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import { DIALECT_CELLS, PG_CELL, currentLiveSchema, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';
import { RELATION_GROUP_JOINS, type RelationGroupJoin } from './sql-driver-aggregation.js';
import { primeFixedReadLeafKeyTypes } from './fixed-read-leaf-key-type.js';
import type { DriverQuery } from '@objectstack/spec/contracts';

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

      if (cell.id === 'pg') declarePgKeyTypePins(() => driver, () => knex);
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

// ── O2 on PostgreSQL: the outer key's base type (ruled A) ───────────────────

/**
 * [ADR-0155 O2, ruling 7051669729 (A)] On PostgreSQL the inner read projects
 * `record_id` cast to the outer key column's base type, read once per table
 * from the catalog (`fixed-read-leaf-key-type.ts`). Each key type here is a
 * federated table made by raw DDL and bound with `registerExternalObject`,
 * the way a sharing-scoped external object meets the leaf, and each pin holds
 * the leaf to the rows TODAY'S LIST of the same grants answers (D-0), on
 * `find`, `count` and the predicate update, plus the `$or` and nested
 * `ReadableIds` positions. A malformed grant id fails the statement in the
 * list's own envelope.
 */
interface PgKeyCase {
  readonly name: string;
  /** The `id` column's DDL type. */
  readonly ddl: string;
  /** Row ids, as inserted. */
  readonly ids: readonly string[];
  /** Grant `record_id`s for u9, as today's list would bind them. */
  readonly grants: readonly string[];
  /** The ids both forms answer, as the driver reads them back (sorted text). */
  readonly expected: readonly string[];
  /** The cast the compiled inner read carries, `null` for none. */
  readonly cast: string | null;
  /** Bind the table with `external.remoteSchema` (the schema-qualified catalog read). */
  readonly qualified?: boolean;
}

const PG_KEY_CASES: readonly PgKeyCase[] = [
  { name: 'integer', ddl: 'integer', ids: ['7', '42', '43'], grants: ['42', '07', ' 7'], expected: ['42', '7'], cast: '"pg_catalog"."int4"' },
  { name: 'smallint', ddl: 'smallint', ids: ['7', '42', '43'], grants: ['07', '42'], expected: ['42', '7'], cast: '"pg_catalog"."int2"' },
  // Scale is the column's typmod, which the cast leaves off: `42.0` names 42.00, as a bound member does.
  { name: 'numeric(10,2)', ddl: 'numeric(10,2)', ids: ['7', '42', '8.5'], grants: ['7', '07', '42.0'], expected: ['42.00', '7.00'], cast: '"pg_catalog"."numeric"' },
  { name: 'bigint', ddl: 'bigint', ids: ['7', '9007199254740993', '9007199254740994'], grants: ['07', '9007199254740993'], expected: ['7', '9007199254740993'], cast: '"pg_catalog"."int8"' },
  {
    name: 'uuid',
    ddl: 'uuid',
    ids: ['8a1f0c3e-1b2c-4d5e-8f90-123456789abc', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
    grants: ['8A1F0C3E-1B2C-4D5E-8F90-123456789ABC', '{00000000-0000-0000-0000-000000000001}'],
    expected: ['00000000-0000-0000-0000-000000000001', '8a1f0c3e-1b2c-4d5e-8f90-123456789abc'],
    cast: '"pg_catalog"."uuid"',
    qualified: true,
  },
  // A string key that is not text: the list compares as `bpchar` (padding
  // ignored), so the inner read is cast to `bpchar` too, with no length.
  { name: 'character(4)', ddl: 'character(4)', ids: ['k1', 'k2', 'k3'], grants: ['k1  ', 'k2'], expected: ['k1  ', 'k2  '], cast: '"pg_catalog"."bpchar"' },
  // A domain is cast to the type under it.
  { name: 'a domain over integer', ddl: 'srid_pk_dom', ids: ['7', '42', '43'], grants: ['07', '42'], expected: ['42', '7'], cast: '"pg_catalog"."int4"' },
  // Every table the platform manages: no cast, step 3's statement.
  { name: 'text', ddl: 'text', ids: ['k1', 'k2', 'k3'], grants: ['k1', 'k2 '], expected: ['k1'], cast: null },
];

function declarePgKeyTypePins(driverOf: () => SqlDriver, knexOf: () => Knex): void {
  describe('O2 on PostgreSQL: record_id is cast to the outer key\'s base type (ruled A)', () => {
    const EXT = (c: PgKeyCase) => `srid_pk_${c.name.replace(/[^a-z0-9]+/g, '_')}`;
    const CHILD = 'srid_pk_child';
    const CHAR_CHILD = 'srid_pk_char_child';
    const grantRows = (c: PgKeyCase) => [
      ...c.grants.map((g, i) => ({ id: `${EXT(c)}_g${i}`, object_name: EXT(c), recipient_type: 'user', recipient_id: 'u9', record_id: g, access_level: 'lvl_edit', organization_id: 'org_a' })),
      // N4's witness on a typed key: a blank grant the cast must never see as a value.
      { id: `${EXT(c)}_blank`, object_name: EXT(c), recipient_type: 'user', recipient_id: 'u9', record_id: '', access_level: 'lvl_edit', organization_id: 'org_a' },
    ];

    beforeAll(async () => {
      const driver = driverOf();
      const knex = knexOf();
      await driver.execute('drop domain if exists srid_pk_dom cascade').catch(() => {});
      await driver.execute('create domain srid_pk_dom as integer check (value > 0)');
      const schema = currentLiveSchema();
      for (const c of PG_KEY_CASES) {
        await driver.execute(`drop table if exists ${EXT(c)}`);
        await driver.execute(`create table ${EXT(c)} (id ${c.ddl} primary key, label text)`);
        await knex(EXT(c)).insert(c.ids.map((id) => ({ id, label: 'x' })));
        await knex(GRANTS).insert(grantRows(c));
        driver.registerExternalObject({
          name: EXT(c),
          fields: { label: { type: 'text' } },
          ...(c.qualified ? { external: { remoteName: EXT(c), remoteSchema: schema } } : {}),
        } as any);
      }
      await driver.execute(`drop table if exists ${CHAR_CHILD}`);
      await driver.execute(`create table ${CHAR_CHILD} (id text primary key, parent character(4), label text)`);
      await knex(CHAR_CHILD).insert([{ id: 'cc1', parent: 'k1' }, { id: 'cc2', parent: 'k2' }, { id: 'cc3', parent: 'k3' }]);
      await driver.execute(`drop table if exists ${CHILD}`);
      await driver.execute(`create table ${CHILD} (id text primary key, parent integer, label text)`);
      await knex(CHILD).insert([{ id: 'c7', parent: 7 }, { id: 'c42', parent: 42 }, { id: 'c43', parent: 43 }]);
      driver.registerExternalObject({ name: CHILD, fields: { parent: { type: 'number' }, label: { type: 'text' } } } as any);
    }, 60_000);

    afterAll(async () => {
      const driver = driverOf();
      const knex = knexOf();
      for (const c of PG_KEY_CASES) {
        await knex(GRANTS).where('object_name', EXT(c)).del().catch(() => {});
        await driver.execute(`drop table if exists ${EXT(c)}`).catch(() => {});
      }
      await driver.execute(`drop table if exists ${CHAR_CHILD}`).catch(() => {});
      await driver.execute(`drop table if exists ${CHILD}`).catch(() => {});
      await driver.execute('drop domain if exists srid_pk_dom cascade').catch(() => {});
    });

    for (const c of PG_KEY_CASES) {
      describe(`${c.name} key`, () => {
        const leaf = () => seamed({ id: { $in: SharedRecordIds.read(EXT(c), 'u9') } });
        const list = () => seamed({ id: { $in: [...c.grants] } });

        it('find and count: the leaf answers the rows today\'s list answers', async () => {
          const driver = driverOf();
          const viaList = sortedIds(await driver.find(EXT(c), { where: list() }));
          expect(viaList).toEqual([...c.expected]);
          expect(sortedIds(await driver.find(EXT(c), { where: leaf() }))).toEqual(viaList);
          expect(await driver.count(EXT(c), { where: leaf() })).toBe(viaList.length);
        });

        it('the negation and an $or position answer as the list does', async () => {
          const driver = driverOf();
          const not = sortedIds(await driver.find(EXT(c), { where: seamed({ $not: { id: { $in: SharedRecordIds.read(EXT(c), 'u9') } } }) }));
          expect(not).toEqual(sortedIds(await driver.find(EXT(c), { where: seamed({ $not: { id: { $in: [...c.grants] } } }) })));
          const orLeaf = seamed({ $or: [{ id: { $in: SharedRecordIds.read(EXT(c), 'u9') } }, { label: 'none' }] });
          const orList = seamed({ $or: [{ id: { $in: [...c.grants] } }, { label: 'none' }] });
          expect(sortedIds(await driver.find(EXT(c), { where: orLeaf }))).toEqual(sortedIds(await driver.find(EXT(c), { where: orList })));
        });

        it('the predicate update: the write form touches the list\'s rows', async () => {
          const driver = driverOf();
          const knex = knexOf();
          const where = seamed({ id: { $in: SharedRecordIds.write(EXT(c), 'u9', ['lvl_edit', 'lvl_full']) } });
          try {
            expect(await driver.updateMany(EXT(c), { where }, { label: 'touched' })).toBe(c.expected.length);
            expect(sortedIds(await knex(EXT(c)).where('label', 'touched').select('id'))).toEqual([...c.expected]);
          } finally {
            await knex(EXT(c)).update({ label: 'x' });
          }
        });

        it(c.cast === null ? 'the statement is step 3\'s: no cast' : `the statement casts record_id to ${c.cast}`, async () => {
          const knex = knexOf();
          const seen: string[] = [];
          const onQuery = (q: { sql: string }) => { if (q.sql.includes(GRANTS)) seen.push(q.sql); };
          knex.on('query', onQuery);
          try {
            await driverOf().find(EXT(c), { where: leaf() });
          } finally {
            knex.removeListener('query', onQuery);
          }
          expect(seen).toHaveLength(1);
          if (c.cast === null) {
            expect(seen[0]).toContain('in (select "record_id" from "sys_record_share"');
            expect(seen[0]).not.toMatch(/CAST\(/i);
          } else {
            expect(seen[0]).toContain(`in (select CAST(NULLIF("record_id", '') AS ${c.cast}) from "sys_record_share"`);
          }
        });
      });
    }

    it('nested under a composed ReadableIds scope: the parent\'s key type is the one cast to', async () => {
      const driver = driverOf();
      const intCase = PG_KEY_CASES[0];
      const scoped = (scope: unknown) => seamed({ parent: { $in: ReadableIds.compose(ReadableIds.of(EXT(intCase)), scope as FilterCondition) } });
      const viaList = sortedIds(await driver.find(CHILD, { where: scoped({ id: { $in: [...intCase.grants] } }) }));
      expect(viaList).toEqual(['c42', 'c7']);
      expect(sortedIds(await driver.find(CHILD, { where: scoped({ id: { $in: SharedRecordIds.read(EXT(intCase), 'u9') } }) }))).toEqual(viaList);
      expect(await driver.count(CHILD, { where: scoped({ id: { $in: SharedRecordIds.read(EXT(intCase), 'u9') } }) })).toBe(2);
    });

    it('aggregate agrees with find on a typed key', async () => {
      const intCase = PG_KEY_CASES[0];
      const out = await driverOf().aggregate(
        EXT(intCase),
        { where: seamed({ id: { $in: SharedRecordIds.read(EXT(intCase), 'u9') } }), aggregations: [{ function: 'count', alias: 'n' }] },
      );
      expect(Number((out[0] as any).n)).toBe(intCase.expected.length);
    });

    it('a malformed grant id fails the statement in the envelope today\'s list fails it in', async () => {
      const driver = driverOf();
      const knex = knexOf();
      const intCase = PG_KEY_CASES[0];
      await knex(GRANTS).insert({ id: 'srid_pk_bad', object_name: EXT(intCase), recipient_type: 'user', recipient_id: 'u9', record_id: 'abc', access_level: 'lvl_edit', organization_id: 'org_a' });
      try {
        const viaList = await driver.find(EXT(intCase), { where: seamed({ id: { $in: [...intCase.grants, 'abc'] } }) }).catch((e) => e);
        const viaLeaf = await driver.find(EXT(intCase), { where: seamed({ id: { $in: SharedRecordIds.read(EXT(intCase), 'u9') } }) }).catch((e) => e);
        expect(viaList).toMatchObject({ code: 'DATABASE_ERROR', status: 500 });
        expect(viaLeaf).toMatchObject({ code: viaList.code, status: viaList.status });
        // The same database refusal: invalid input for the key's type (22P02), not a missing operator (42883).
        expect(String(viaLeaf.cause?.code ?? viaLeaf.message)).toMatch(/22P02|invalid input syntax for type integer/);
      } finally {
        await knex(GRANTS).where('id', 'srid_pk_bad').del();
      }
    });

    /**
     * Every door primes for itself. Each pin below makes its door the FIRST
     * statement a fresh driver (a fresh knex client, so an empty cache) runs,
     * on the `character(4)` key, where a missed prime is a silent miss rather
     * than an error: the answer must be the list's and the statement must
     * carry the cast. `find` opens every per-key describe above.
     */
    describe('each door primes the key type itself: its first statement on a fresh driver', () => {
      const charCase = () => PG_KEY_CASES.find((c) => c.ddl === 'character(4)')!;
      const leafOf = (c: PgKeyCase) => seamed({ id: { $in: SharedRecordIds.read(EXT(c), 'u9') } });
      const CAST = `CAST(NULLIF("record_id", '') AS "pg_catalog"."bpchar")`;

      /** Run `door` as the first statement of a fresh driver; answer its result and every statement reading the grants. */
      async function firstOnFresh<T>(door: (fresh: SqlDriver) => Promise<T>): Promise<{ out: T; statements: string[] }> {
        const fresh = new SqlDriver(PG_CELL.config());
        const knex: Knex = (fresh as any).knex;
        for (const c of PG_KEY_CASES) fresh.registerExternalObject({ name: EXT(c), fields: { label: { type: 'text' } } } as any);
        fresh.registerExternalObject({ name: CHAR_CHILD, fields: { parent: { type: 'text' }, label: { type: 'text' } } } as any);
        const statements: string[] = [];
        const onQuery = (q: { sql: string }) => { if (q.sql.includes(GRANTS)) statements.push(q.sql); };
        knex.on('query', onQuery);
        try {
          return { out: await door(fresh), statements };
        } finally {
          knex.removeListener('query', onQuery);
          await fresh.disconnect?.();
        }
      }
      const castIn = (statements: string[]) => {
        expect(statements.length).toBeGreaterThanOrEqual(1);
        for (const sql of statements) expect(sql).toContain(CAST);
      };

      it('count', async () => {
        const c = charCase();
        const { out, statements } = await firstOnFresh((d) => d.count(EXT(c), { where: leafOf(c) }));
        expect(out).toBe(c.expected.length);
        castIn(statements);
      });

      it('updateMany (the predicate update\'s write)', async () => {
        const c = charCase();
        const knex = knexOf();
        try {
          const where = seamed({ id: { $in: SharedRecordIds.write(EXT(c), 'u9', ['lvl_edit', 'lvl_full']) } });
          const { out, statements } = await firstOnFresh((d) => d.updateMany(EXT(c), { where }, { label: 'touched' }));
          expect(out).toBe(c.expected.length);
          expect(sortedIds(await knex(EXT(c)).where('label', 'touched').select('id'))).toEqual([...c.expected]);
          castIn(statements);
        } finally {
          await knex(EXT(c)).update({ label: 'x' });
        }
      });

      it('deleteMany', async () => {
        const c = charCase();
        const knex = knexOf();
        try {
          const { out, statements } = await firstOnFresh((d) => d.deleteMany(EXT(c), { where: leafOf(c) }));
          expect(out).toBe(c.expected.length);
          expect(sortedIds(await knex(EXT(c)).select('id'))).toEqual(['k3  ']);
          castIn(statements);
        } finally {
          await knex(EXT(c)).del();
          await knex(EXT(c)).insert(c.ids.map((id) => ({ id, label: 'x' })));
        }
      });

      it('distinct', async () => {
        const c = charCase();
        const { out, statements } = await firstOnFresh((d) => d.distinct(EXT(c), 'id', leafOf(c)));
        expect(out.map(String).sort()).toEqual([...c.expected]);
        castIn(statements);
      });

      it('aggregate', async () => {
        const c = charCase();
        const { out, statements } = await firstOnFresh((d) =>
          d.aggregate(EXT(c), { where: leafOf(c), aggregations: [{ function: 'count', alias: 'n' }] }));
        expect(Number((out[0] as any).n)).toBe(c.expected.length);
        castIn(statements);
      });

      it('aggregate\'s joined parent (a relation group join whose composed scope holds the leaf)', async () => {
        const c = charCase();
        const join: RelationGroupJoin = {
          field: 'parent',
          parent: ReadableIds.compose(ReadableIds.of(EXT(c)), leafOf(c) as FilterCondition),
          attrs: [{ attr: 'label', alias: 'rg_label' }],
          resolvedAlias: 'rg_resolved',
        };
        // No leaf in the aggregated object's own where: only the joined parent's prime can type it.
        const query = { aggregations: [{ function: 'count', alias: 'n' }], [RELATION_GROUP_JOINS]: [join] } as unknown as DriverQuery;
        const { out, statements } = await firstOnFresh((d) => d.aggregate(CHAR_CHILD, query));
        const byResolved = Object.fromEntries(out.map((r: any) => [Number(r.rg_resolved), Number(r.n)]));
        // cc1 (parent k1, granted padded) and cc2 (parent k2) join a readable parent; cc3 (k3) does not.
        expect(byResolved).toEqual({ 1: 2, 0: 1 });
        castIn(statements);
      });

      it('analyzeQuery (the plan is of the statement find runs)', async () => {
        const c = charCase();
        const { out, statements } = await firstOnFresh((d) => d.analyzeQuery(EXT(c), { where: leafOf(c) }));
        expect(out.error).toBeUndefined();
        expect(out.sql).toContain(CAST);
        // EXPLAIN ANALYZE ran it: the top node's actual rows are the list's count.
        expect(out.plan.rows[0]['QUERY PLAN'][0].Plan['Actual Rows']).toBe(c.expected.length);
        castIn(statements);
      });

      it('findWithWindowFunctions', async () => {
        const c = charCase();
        const { out, statements } = await firstOnFresh((d) =>
          d.findWithWindowFunctions(EXT(c), { where: leafOf(c), windowFunctions: [{ function: 'row_number', alias: 'rn' }] }));
        expect(sortedIds(out)).toEqual([...c.expected]);
        castIn(statements);
      });
    });

    /**
     * F1: a table this driver holds no reading of is REFUSED on PostgreSQL
     * (ADR-0139 D3's envelope, `INTERNAL_ERROR` / 500, logged once), never
     * compiled uncast: uncast, a `character(n)` key misses a padded grant
     * silently. The catalog read runs on a pooled connection, so (a) a pool
     * the caller's own transaction holds times the read out, and (b) a table
     * created in the caller's uncommitted transaction is not visible to it.
     */
    describe('no reading is refused, never compiled uncast (ADR-0155 D2)', () => {
      const charCase = () => PG_KEY_CASES.find((c) => c.ddl === 'character(4)')!;
      const leafOf = (object: string) => seamed({ id: { $in: SharedRecordIds.read(object, 'u9') } });
      const inTrx = (transaction: Knex.Transaction): DriverOptions => ({ transaction });
      const refused = (err: unknown) => {
        expect(err, 'refused').toBeInstanceOf(Error);
        expect(err).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
        expect((err as Error).message).toContain('holds no reading');
      };

      it('(a) the catalog read times out on a saturated pool: find, count and updateMany refuse, nothing is written, logged once; the next statement asks again', async () => {
        const c = charCase();
        const fresh = new SqlDriver({ ...PG_CELL.config(), pool: { min: 0, max: 1 }, acquireConnectionTimeout: 1000 } as SqlDriverConfig);
        const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
        (fresh as any).logger = logger;
        fresh.registerExternalObject({ name: EXT(c), fields: { label: { type: 'text' } } } as any);
        const knex: Knex = (fresh as any).knex;
        const statements: string[] = [];
        const onQuery = (q: { sql: string }) => { if (q.sql.includes(GRANTS)) statements.push(q.sql); };
        knex.on('query', onQuery);
        try {
          // The caller's transaction holds the pool's one connection.
          const trx = await fresh.beginTransaction();
          try {
            refused(await fresh.find(EXT(c), { where: leafOf(EXT(c)) }, inTrx(trx)).catch((e) => e));
            refused(await fresh.count(EXT(c), { where: leafOf(EXT(c)) }, inTrx(trx)).catch((e) => e));
            refused(await fresh.updateMany(EXT(c), { where: leafOf(EXT(c)) }, { label: 'touched' }, inTrx(trx)).catch((e) => e));
          } finally {
            await trx.rollback();
          }
          expect(statements).toEqual([]);
          expect(await knexOf()(EXT(c)).where('label', 'touched').count({ n: '*' })).toEqual([{ n: '0' }]);
          expect(logger.error).toHaveBeenCalledTimes(1);
          // Nothing was cached: with the connection back, the next statement reads the catalog and answers the list's rows.
          expect(sortedIds(await fresh.find(EXT(c), { where: leafOf(EXT(c)) }))).toEqual([...c.expected]);
          for (const sql of statements) expect(sql).toContain(`CAST(NULLIF("record_id", '') AS "pg_catalog"."bpchar")`);
        } finally {
          knex.removeListener('query', onQuery);
          await fresh.disconnect?.();
        }
      });

      it('(b) a table created in the caller\'s uncommitted transaction: refused, then rolled back', async () => {
        const TXN = 'srid_pk_txn';
        const fresh = new SqlDriver(PG_CELL.config());
        fresh.registerExternalObject({ name: TXN, fields: { label: { type: 'text' } } } as any);
        const trx = await fresh.beginTransaction();
        try {
          await trx.raw(`create table ${TXN} (id character(4) primary key, label text)`);
          await trx(TXN).insert([{ id: 'k1', label: 'x' }, { id: 'k2', label: 'x' }]);
          await trx(GRANTS).insert({ id: 'srid_pk_txn_g0', object_name: TXN, recipient_type: 'user', recipient_id: 'u9', record_id: 'k1  ', access_level: 'lvl_edit', organization_id: 'org_a' });
          // Today's list, in the same transaction, answers k1: the leaf must not answer anything else.
          expect(sortedIds(await fresh.find(TXN, { where: seamed({ id: { $in: ['k1  '] } }) }, inTrx(trx)))).toEqual(['k1  ']);
          refused(await fresh.find(TXN, { where: leafOf(TXN) }, inTrx(trx)).catch((e) => e));
          refused(await fresh.count(TXN, { where: leafOf(TXN) }, inTrx(trx)).catch((e) => e));
        } finally {
          await trx.rollback();
          await fresh.disconnect?.();
        }
      });
    });

    it('reads the catalog once per table: a second statement and another verb ask it nothing', async () => {
      const fresh = new SqlDriver(PG_CELL.config());
      const knex: Knex = (fresh as any).knex;
      const intCase = PG_KEY_CASES[0];
      fresh.registerExternalObject({ name: EXT(intCase), fields: { label: { type: 'text' } } } as any);
      const catalogReads: string[] = [];
      const onQuery = (q: { sql: string }) => { if (q.sql.includes('pg_attribute')) catalogReads.push(q.sql); };
      knex.on('query', onQuery);
      try {
        const where = seamed({ id: { $in: SharedRecordIds.read(EXT(intCase), 'u9') } });
        expect(sortedIds(await fresh.find(EXT(intCase), { where }))).toEqual([...intCase.expected]);
        expect(catalogReads).toHaveLength(1);
        await fresh.find(EXT(intCase), { where });
        await fresh.count(EXT(intCase), { where });
        expect(catalogReads).toHaveLength(1);
        // A statement with no leaf reads nothing.
        await fresh.find(EXT(intCase), { where: { label: 'x' } as any });
        expect(catalogReads).toHaveLength(1);
      } finally {
        knex.removeListener('query', onQuery);
        await fresh.disconnect?.();
      }
    });
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, 'SharedRecordIds conformance', declareFixedReadLeafSweep);

// ── The compiled statement, on every dialect driver-sql ships ───────────────

class CompileProbe extends SqlDriver {
  /**
   * The door's catalog prime (ADR-0155 O2). On PostgreSQL the read is
   * answered by a stub (a text key, which takes no cast): a leaf compiled
   * with no reading is refused, so the statement needs one. Every other
   * dialect reads nothing.
   */
  async prime(where: FilterCondition): Promise<void> {
    const client = (this as any).knex.client as { dialect?: string; raw: (...args: unknown[]) => unknown };
    if (client.dialect === 'postgresql') {
      const original = client.raw.bind(client);
      client.raw = (...args: unknown[]) => (String(args[0]).includes('pg_attribute')
        ? Promise.resolve({ rows: [{ column_name: 'id', type_schema: 'pg_catalog', type_name: 'text' }] })
        : original(...args));
    }
    await primeFixedReadLeafKeyTypes({ getBuilder: (o) => this.getBuilder(o) }, DOC, where);
  }
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
    it(`${dialect}: one subquery in the list's position, every value bound, no tenant scope inside it`, async () => {
      const probe = new CompileProbe(config);
      expect(probe.supports.fixedReadLeaves).toEqual(['SharedRecordIds']);
      await probe.prime({ id: { $in: SharedRecordIds.read(DOC, 'u1') } } as unknown as FilterCondition);
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

  it('pg: a leaf compared with a table the catalog has not answered for is refused (INTERNAL_ERROR / 500), never compiled uncast', () => {
    const probe = new CompileProbe(COMPILE_CONFIGS.pg);
    let caught: unknown;
    try {
      probe.compileWhere({ id: { $in: SharedRecordIds.read(DOC, 'u1') } } as unknown as FilterCondition);
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: unknown }).code).toBe('INTERNAL_ERROR');
    expect((caught as { status?: unknown }).status).toBe(500);
  });
});
