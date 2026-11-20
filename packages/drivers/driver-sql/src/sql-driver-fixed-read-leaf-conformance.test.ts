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
 * - **O2 on Oracle (ruling A carried to Oracle)**: a federated table keyed by
 *   `RAW(16)` uuid answers the list's rows, because the inner read converts
 *   `record_id` as the list binds a member (`HEXTORAW` over the undashed hex,
 *   `oracleUuidRawProjection`); a `NUMBER` key keeps step 3's statement. Its
 *   own cell (`ORACLE_CELL`, federation-only: raw DDL, no `initObjects`);
 * - the declaration, the absence of a tenant scope in the statement, the
 *   bindings, and the refusals with `code` and `status`.
 *
 * MSSQL is pinned by the compiled statement (no server here); Oracle by the
 * compiled statement and by its live cell.
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
import { DIALECT_CELLS, ORACLE_CELL, PG_CELL, currentLiveSchema, declareDialectCell, type DialectCell, type FederationDialectCell } from './live-dialect-matrix.testkit.js';
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
     * In the caller's transaction the catalog is read ON that transaction's
     * connection, inside a savepoint (ADR-0155 D-0: the leaf answers the
     * list's rows wherever the list does). So (a) a pool the transaction
     * holds cannot time the read out, (b) a table the transaction created is
     * read, and (c) a catalog read that fails there is refused
     * (`INTERNAL_ERROR` / 500, logged once, F1) while the caller's
     * transaction stays usable: the savepoint, not the transaction, rolled back.
     */
    describe('in the caller\'s transaction the catalog is read on its connection, under a savepoint', () => {
      const charCase = () => PG_KEY_CASES.find((c) => c.ddl === 'character(4)')!;
      const leafOf = (object: string) => seamed({ id: { $in: SharedRecordIds.read(object, 'u9') } });
      const inTrx = (transaction: Knex.Transaction): DriverOptions => ({ transaction });
      const CAST = `CAST(NULLIF("record_id", '') AS "pg_catalog"."bpchar")`;
      /** Every statement `trx` runs that reads the grants. */
      const grantStatementsOf = (trx: Knex.Transaction): string[] => {
        const statements: string[] = [];
        trx.on('query', (q: { sql: string }) => { if (q.sql.includes(GRANTS)) statements.push(q.sql); });
        return statements;
      };
      const castIn = (statements: string[], n: number) => {
        expect(statements).toHaveLength(n);
        for (const sql of statements) expect(sql).toContain(CAST);
      };

      it('(a) a single-connection pool the transaction holds: find, count and updateMany answer the list\'s rows, cast', async () => {
        const c = charCase();
        const fresh = new SqlDriver({ ...PG_CELL.config(), pool: { min: 0, max: 1 }, acquireConnectionTimeout: 1000 } as SqlDriverConfig);
        const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
        (fresh as any).logger = logger;
        fresh.registerExternalObject({ name: EXT(c), fields: { label: { type: 'text' } } } as any);
        try {
          // The caller's transaction holds the pool's one connection: a pooled catalog read would time out.
          const trx = await fresh.beginTransaction();
          try {
            const statements = grantStatementsOf(trx);
            const viaList = sortedIds(await fresh.find(EXT(c), { where: seamed({ id: { $in: [...c.grants] } }) }, inTrx(trx)));
            expect(viaList).toEqual([...c.expected]);
            expect(sortedIds(await fresh.find(EXT(c), { where: leafOf(EXT(c)) }, inTrx(trx)))).toEqual(viaList);
            expect(await fresh.count(EXT(c), { where: leafOf(EXT(c)) }, inTrx(trx))).toBe(viaList.length);
            expect(await fresh.updateMany(EXT(c), { where: leafOf(EXT(c)) }, { label: 'touched' }, inTrx(trx))).toBe(viaList.length);
            expect(sortedIds(await trx(EXT(c)).where('label', 'touched').select('id'))).toEqual(viaList);
            castIn(statements, 3);
          } finally {
            await trx.rollback();
          }
          expect(logger.error).not.toHaveBeenCalled();
        } finally {
          await fresh.disconnect?.();
        }
      });

      it('(b) a character(4) table created in the caller\'s uncommitted transaction: the leaf answers [k1], cast', async () => {
        const TXN = 'srid_pk_txn';
        const fresh = new SqlDriver(PG_CELL.config());
        fresh.registerExternalObject({ name: TXN, fields: { label: { type: 'text' } } } as any);
        const trx = await fresh.beginTransaction();
        try {
          await trx.raw(`create table ${TXN} (id character(4) primary key, label text)`);
          await trx(TXN).insert([{ id: 'k1', label: 'x' }, { id: 'k2', label: 'x' }]);
          await trx(GRANTS).insert({ id: 'srid_pk_txn_g0', object_name: TXN, recipient_type: 'user', recipient_id: 'u9', record_id: 'k1  ', access_level: 'lvl_edit', organization_id: 'org_a' });
          const statements = grantStatementsOf(trx);
          expect(sortedIds(await fresh.find(TXN, { where: seamed({ id: { $in: ['k1  '] } }) }, inTrx(trx)))).toEqual(['k1  ']);
          expect(sortedIds(await fresh.find(TXN, { where: leafOf(TXN) }, inTrx(trx)))).toEqual(['k1  ']);
          expect(await fresh.count(TXN, { where: leafOf(TXN) }, inTrx(trx))).toBe(1);
          castIn(statements, 2);
        } finally {
          await trx.rollback();
          await fresh.disconnect?.();
        }
      });

      it('(c) a catalog read that fails in the transaction is refused (500, logged once), and the caller\'s transaction stays usable', async () => {
        const c = charCase();
        const fresh = new SqlDriver(PG_CELL.config());
        const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
        (fresh as any).logger = logger;
        fresh.registerExternalObject({ name: EXT(c), fields: { label: { type: 'text' } } } as any);
        const trx = await fresh.beginTransaction();
        try {
          // Test seam: inside the savepoint the catalog read becomes a statement PostgreSQL fails (22012),
          // which aborts that savepoint on the caller's connection.
          const ownTransaction = trx.transaction;
          const openSavepoint = trx.transaction.bind(trx) as (handler: (sp: Knex.Transaction) => unknown) => Promise<unknown>;
          let failed = 0;
          // knex defines both methods as configurable, non-writable properties.
          const swap = (target: object, name: string, value: unknown) => Object.defineProperty(target, name, { value, configurable: true });
          swap(trx, 'transaction', (handler: (sp: Knex.Transaction) => unknown) => openSavepoint((sp) => {
            const raw = sp.raw.bind(sp) as (...args: unknown[]) => unknown;
            swap(sp, 'raw', (sql: unknown, bindings?: unknown) => {
              if (!String(sql).includes('pg_attribute')) return raw(sql, bindings);
              failed++;
              return raw('select 1/0');
            });
            return handler(sp);
          }));
          const refusedFind = await fresh.find(EXT(c), { where: leafOf(EXT(c)) }, inTrx(trx)).catch((e) => e);
          expect(refusedFind).toBeInstanceOf(Error);
          expect(refusedFind).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
          const refusedCount = await fresh.count(EXT(c), { where: leafOf(EXT(c)) }, inTrx(trx)).catch((e) => e);
          expect(refusedCount).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
          expect(failed).toBe(2);
          expect(logger.error).toHaveBeenCalledTimes(1);
          // The caller's transaction is not aborted: its next statements run.
          expect((await trx.raw('select 1 as one')).rows).toEqual([{ one: 1 }]);
          expect(sortedIds(await fresh.find(EXT(c), { where: seamed({ id: { $in: [...c.grants] } }) }, inTrx(trx)))).toEqual([...c.expected]);
          // Nothing was cached: with the seam gone, the next leaf statement reads the catalog and answers the list's rows.
          swap(trx, 'transaction', ownTransaction);
          expect(sortedIds(await fresh.find(EXT(c), { where: leafOf(EXT(c)) }, inTrx(trx)))).toEqual([...c.expected]);
        } finally {
          await trx.rollback();
          await fresh.disconnect?.();
        }
      });

      /**
       * `updateMany` on a managed object whose `updated_at` is only presumed
       * issues its stamped attempt inside a savepoint DERIVED from the
       * caller's transaction (`updateWithPresumedTimestamp` →
       * `attemptWithoutPoisoning`), so the leaf compiles under a transaction
       * object the door did not prime under: the reading taken on the
       * caller's transaction must reach it.
       */
      describe('(d) the presumed-updated_at write path compiles in a savepoint derived from the caller\'s transaction', () => {
        const PRESUMED = [
          { table: 'srid_pk_presumed_text', ddl: 'text', grants: ['k1', 'k2'], expected: ['k1', 'k2'], cast: false },
          { table: 'srid_pk_presumed_char', ddl: 'character(4)', grants: ['k1  ', 'k2'], expected: ['k1  ', 'k2  '], cast: true },
        ] as const;

        beforeAll(async () => {
          const driver = driverOf();
          const knex = knexOf();
          for (const p of PRESUMED) {
            await driver.execute(`drop table if exists ${p.table}`);
            await driver.execute(`create table ${p.table} (id ${p.ddl} primary key, label text, created_at timestamptz default now(), updated_at timestamptz default now())`);
            await knex(p.table).insert([{ id: 'k1', label: 'x' }, { id: 'k2', label: 'x' }, { id: 'k3', label: 'x' }]);
            await knex(GRANTS).insert(p.grants.map((g, i) => ({ id: `${p.table}_g${i}`, object_name: p.table, recipient_type: 'user', recipient_id: 'u9', record_id: g, access_level: 'lvl_edit', organization_id: 'org_a' })));
          }
        });

        afterAll(async () => {
          const driver = driverOf();
          const knex = knexOf();
          for (const p of PRESUMED) {
            await knex(GRANTS).where('object_name', p.table).del().catch(() => {});
            await driver.execute(`drop table if exists ${p.table}`).catch(() => {});
          }
        });

        for (const p of PRESUMED) {
          it(`${p.ddl} key: a predicate updateMany with the write-form leaf answers the list's rows and touches them`, async () => {
            const fresh = new SqlDriver(PG_CELL.config());
            // Managed metadata over a table this driver did not create: `updated_at` is presumed.
            fresh.registerObjectMetadata([{ name: p.table, fields: { label: { type: 'text' } } } as any]);
            expect((fresh as any).updatedAtStampIsPresumed(p.table)).toBe(true);
            const trx = await fresh.beginTransaction();
            try {
              const statements = grantStatementsOf(trx);
              const where = seamed({ id: { $in: SharedRecordIds.write(p.table, 'u9', ['lvl_edit', 'lvl_full']) } });
              expect(await fresh.updateMany(p.table, { where }, { label: 'touched' }, inTrx(trx))).toBe(p.expected.length);
              expect(sortedIds(await trx(p.table).where('label', 'touched').select('id'))).toEqual([...p.expected]);
              // The list's rows, read in the same transaction after the write.
              expect(sortedIds(await fresh.find(p.table, { where: seamed({ id: { $in: [...p.grants] } }) }, inTrx(trx)))).toEqual([...p.expected]);
              // The stamped attempt landed, so the presumption settled.
              expect((fresh as any).updatedAtStampIsPresumed(p.table)).toBe(false);
              expect(statements.length).toBeGreaterThanOrEqual(1);
              for (const sql of statements) expect(sql.includes(CAST)).toBe(p.cast);
            } finally {
              await trx.rollback();
              await fresh.disconnect?.();
            }
          });
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

// ── O2 on Oracle: a RAW(16) uuid key, ruling A carried to Oracle ────────────

/**
 * [ADR-0155 O2, ruling 7051669729 (A) carried to Oracle] Oracle is
 * federation-only, so its cell builds the remote tables by raw DDL (the grant
 * table included) and binds them with `registerExternalObject`, as
 * `sql-driver-oracle-federation-conformance.test.ts` does.
 *
 * Where the outer key is a `RAW(16)` uuid column (the catalog prime the list's
 * `HEXTORAW(?)` binding reads), the inner read projects
 * `HEXTORAW(REPLACE(record_id, '-', ''))` (`oracleUuidRawProjection`). Before
 * it, Oracle compared the column as its upper-case hex text: the leaf answered
 * no row and its negation every row, with no error (measured on Oracle Free
 * 23ai). Each pin holds the leaf to the rows TODAY'S LIST of the same grants
 * answers (D-0); a `NUMBER` key keeps step 3's statement and converts the
 * grants as it converts the list's text binds.
 *
 * The grants the list refuses before any statement (not uuid text) have no
 * refusal in the leaf, which reads stored rows: those pins state both
 * envelopes as measured, the difference reported for the maintainer's word.
 */
const ORA_GRANTS = 'sys_record_share';
const ORA_RAW = { table: 'SRIDO_RAW', object: 'srido_raw' };
const ORA_NUM = { table: 'SRIDO_NUM', object: 'srido_num' };
const ORA_CHILD = { table: 'SRIDO_CHILD', object: 'srido_child' };
const ORA_BYPASS = { bypassTenantAudit: true } as const;
const ORA_U1 = '8a1f0c3e-1b2c-4d5e-8f90-123456789abc';
const ORA_U2 = '00000000-0000-0000-0000-000000000001';
const ORA_U3 = '00000000-0000-0000-0000-000000000002';
const ORA_U4 = '00000000-0000-0000-0000-000000000003';

interface OracleKeyCase {
  readonly name: string;
  readonly object: string;
  /** Grant `record_id`s for u9, as today's list would bind them. */
  readonly grants: readonly string[];
  /** The ids both forms answer, as the driver reads them back (sorted text). */
  readonly expected: readonly string[];
  /** The rows the negation answers: the complement, never every row. */
  readonly complement: readonly string[];
  /** The projection the compiled inner read carries. */
  readonly projection: string;
}

const ORACLE_KEY_CASES: readonly OracleKeyCase[] = [
  {
    // Upper-case dashed, lower-case dashed and undashed: the uuid text the list accepts.
    name: 'RAW(16) uuid',
    object: ORA_RAW.object,
    grants: [ORA_U1.toUpperCase(), ORA_U2, ORA_U3.replace(/-/g, '')],
    expected: [ORA_U2, ORA_U3, ORA_U1].sort(),
    complement: [ORA_U4],
    projection: `HEXTORAW(REPLACE("record_id", '-', ''))`,
  },
  {
    name: 'NUMBER(10)',
    object: ORA_NUM.object,
    grants: ['42', '07', ' 7'],
    expected: ['42', '7'],
    complement: ['43'],
    projection: '"record_id"',
  },
];

async function dropOracleTable(knex: Knex, table: string): Promise<void> {
  await knex.raw(
    `BEGIN EXECUTE IMMEDIATE 'DROP TABLE "${table}" PURGE'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;`,
  );
}

/** A refusal's envelope, or the rows: what each form answered. */
async function oracleAnswer(p: Promise<unknown[]>): Promise<{ rows: string[] } | { code: unknown; status: unknown; ora: string | null }> {
  try {
    return { rows: sortedIds(await p) };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; message?: unknown; cause?: { message?: unknown } };
    const ora = /ORA-\d{5}/.exec(`${String(err.message)} ${String(err.cause?.message ?? '')}`)?.[0] ?? null;
    return { code: err.code, status: err.status, ora };
  }
}

function declareOracleKeyTypePins(cell: FederationDialectCell): void {
  describe(`[ADR-0155 O2] driver-sql — SharedRecordIds on Oracle key types (${cell.label})`, () => {
    let driver: SqlDriver;
    let knex: Knex;
    const tables = [ORA_GRANTS, ORA_RAW.table, ORA_NUM.table, ORA_CHILD.table];
    const grantRows = (c: OracleKeyCase, recipient = 'u9', grants: readonly string[] = c.grants) => [
      ...grants.map((g, i) => ({ id: `${c.object}_${recipient}_g${i}`, object_name: c.object, recipient_type: 'user', recipient_id: recipient, record_id: g, access_level: 'lvl_edit', organization_id: 'org_a' })),
      // N4's witness on a typed key: a blank grant (stored as NULL here) the projection never sees as a value.
      { id: `${c.object}_${recipient}_blank`, object_name: c.object, recipient_type: 'user', recipient_id: recipient, record_id: '', access_level: 'lvl_edit', organization_id: 'org_a' },
    ];
    const hex = (u: string) => u.replace(/-/g, '').toUpperCase();

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.connect();
      knex = driver.getKnex();
      for (const t of tables) await dropOracleTable(knex, t);
      await knex.raw(
        `CREATE TABLE "${ORA_GRANTS}" ("id" VARCHAR2(64) PRIMARY KEY, "object_name" VARCHAR2(200), "recipient_type" VARCHAR2(200), ` +
          `"recipient_id" VARCHAR2(200), "record_id" VARCHAR2(200), "access_level" VARCHAR2(200), "organization_id" VARCHAR2(200))`,
      );
      await knex.raw(`CREATE TABLE "${ORA_RAW.table}" ("ID" RAW(16) PRIMARY KEY, "LABEL" VARCHAR2(100))`);
      await knex.raw(`CREATE TABLE "${ORA_NUM.table}" ("ID" NUMBER(10) PRIMARY KEY, "LABEL" VARCHAR2(100))`);
      await knex.raw(`CREATE TABLE "${ORA_CHILD.table}" ("ID" VARCHAR2(10) PRIMARY KEY, "PARENT" RAW(16), "LABEL" VARCHAR2(100))`);
      for (const u of [ORA_U1, ORA_U2, ORA_U3, ORA_U4]) {
        await knex.raw(`INSERT INTO "${ORA_RAW.table}" ("ID", "LABEL") VALUES (HEXTORAW(?), 'x')`, [hex(u)]);
      }
      for (const n of [7, 42, 43]) await knex.raw(`INSERT INTO "${ORA_NUM.table}" ("ID", "LABEL") VALUES (?, 'x')`, [n]);
      for (const [id, parent] of [['c1', ORA_U1], ['c2', ORA_U2], ['c4', ORA_U4]] as const) {
        await knex.raw(`INSERT INTO "${ORA_CHILD.table}" ("ID", "PARENT", "LABEL") VALUES (?, HEXTORAW(?), 'x')`, [id, hex(parent)]);
      }
      for (const fx of [ORA_RAW, ORA_NUM]) {
        (driver as any).registerExternalObject({
          name: fx.object,
          external: { remoteName: fx.table, columnMap: { ID: 'id', LABEL: 'label' } },
          fields: { label: { type: 'text' } },
        });
      }
      (driver as any).registerExternalObject({
        name: ORA_CHILD.object,
        external: { remoteName: ORA_CHILD.table, columnMap: { ID: 'id', PARENT: 'parent', LABEL: 'label' } },
        fields: { parent: { type: 'lookup', reference: ORA_RAW.object }, label: { type: 'text' } },
      });
      for (const c of ORACLE_KEY_CASES) await knex(ORA_GRANTS).insert(grantRows(c));
    }, 120_000);

    afterAll(async () => {
      for (const t of tables) await dropOracleTable(knex, t).catch(() => {});
      await driver?.disconnect?.();
    });

    for (const c of ORACLE_KEY_CASES) {
      describe(`${c.name} key`, () => {
        const leaf = () => seamed({ id: { $in: SharedRecordIds.read(c.object, 'u9') } });
        const list = () => seamed({ id: { $in: [...c.grants] } });

        it('find and count: the leaf answers the rows today\'s list answers', async () => {
          const viaList = sortedIds(await driver.find(c.object, { where: list() }, ORA_BYPASS));
          expect(viaList).toEqual([...c.expected]);
          expect(sortedIds(await driver.find(c.object, { where: leaf() }, ORA_BYPASS))).toEqual(viaList);
          expect(await driver.count(c.object, { where: leaf() }, ORA_BYPASS)).toBe(viaList.length);
        });

        it('the negation and an $or position answer as the list does', async () => {
          const notLeaf = sortedIds(await driver.find(c.object, { where: seamed({ $not: { id: { $in: SharedRecordIds.read(c.object, 'u9') } } }) }, ORA_BYPASS));
          const notList = sortedIds(await driver.find(c.object, { where: seamed({ $not: { id: { $in: [...c.grants] } } }) }, ORA_BYPASS));
          expect(notList).toEqual([...c.complement]);
          // The complement, not every row: before the projection a RAW key's negation answered all of them.
          expect(notLeaf).toEqual(notList);
          const orLeaf = seamed({ $or: [{ id: { $in: SharedRecordIds.read(c.object, 'u9') } }, { label: 'none' }] });
          const orList = seamed({ $or: [{ id: { $in: [...c.grants] } }, { label: 'none' }] });
          expect(sortedIds(await driver.find(c.object, { where: orLeaf }, ORA_BYPASS))).toEqual(sortedIds(await driver.find(c.object, { where: orList }, ORA_BYPASS)));
        });

        it('the predicate update: the write form touches the list\'s rows', async () => {
          const where = seamed({ id: { $in: SharedRecordIds.write(c.object, 'u9', ['lvl_edit', 'lvl_full']) } });
          try {
            expect(await driver.updateMany(c.object, { where }, { label: 'touched' }, ORA_BYPASS)).toBe(c.expected.length);
            expect(sortedIds(await driver.find(c.object, { where: { label: 'touched' } }, ORA_BYPASS))).toEqual([...c.expected]);
          } finally {
            await knex(c.object === ORA_RAW.object ? ORA_RAW.table : ORA_NUM.table).update({ LABEL: 'x' });
          }
        });

        it(`the statement projects ${c.projection}`, async () => {
          const seen: string[] = [];
          const onQuery = (q: { sql: string }) => { if (q.sql.includes(ORA_GRANTS)) seen.push(q.sql); };
          knex.on('query', onQuery);
          try {
            await driver.find(c.object, { where: leaf() }, ORA_BYPASS);
          } finally {
            knex.removeListener('query', onQuery);
          }
          expect(seen).toHaveLength(1);
          expect(seen[0]).toContain(`"ID" in (select ${c.projection} from "${ORA_GRANTS}"`);
        });
      });
    }

    it('nested under a composed ReadableIds scope: the RAW parent\'s grants are converted as its list is', async () => {
      // The child's door primes the child alone; a read of the parent primes its
      // RAW(16) columns, for the list and the leaf alike.
      await driver.find(ORA_RAW.object, { where: { label: 'none' } as any }, ORA_BYPASS);
      const raw = ORACLE_KEY_CASES[0];
      const scoped = (scope: unknown) => seamed({ parent: { $in: ReadableIds.compose(ReadableIds.of(ORA_RAW.object), scope as FilterCondition) } });
      const viaList = sortedIds(await driver.find(ORA_CHILD.object, { where: scoped({ id: { $in: [...raw.grants] } }) }, ORA_BYPASS));
      expect(viaList).toEqual(['c1', 'c2']);
      expect(sortedIds(await driver.find(ORA_CHILD.object, { where: scoped({ id: { $in: SharedRecordIds.read(ORA_RAW.object, 'u9') } }) }, ORA_BYPASS))).toEqual(viaList);
      expect(await driver.count(ORA_CHILD.object, { where: scoped({ id: { $in: SharedRecordIds.read(ORA_RAW.object, 'u9') } }) }, ORA_BYPASS)).toBe(2);
    });

    it('aggregate agrees with find on a RAW(16) key', async () => {
      const raw = ORACLE_KEY_CASES[0];
      const out = await driver.aggregate(
        raw.object,
        { where: seamed({ id: { $in: SharedRecordIds.read(raw.object, 'u9') } }), aggregations: [{ function: 'count', alias: 'n' }] },
        ORA_BYPASS,
      );
      expect(Number((out[0] as any).n ?? (out[0] as any).N)).toBe(raw.expected.length);
    });

    describe('a grant the list refuses: both envelopes, as measured (the D-0 difference reported, never a new refusal)', () => {
      /** Each malformed grant sits beside a valid one, as one recipient's grants. */
      const MALFORMED: readonly { name: string; recipient: string; grant: string; leaf: { rows: string[] } | { code: string; status: number; ora: string } }[] = [
        { name: 'not hex (`not-a-uuid`)', recipient: 'u_bad', grant: 'not-a-uuid', leaf: { code: 'DATABASE_ERROR', status: 500, ora: 'ORA-01465' } },
        { name: 'braced uuid text', recipient: 'u_brace', grant: `{${ORA_U2}}`, leaf: { code: 'DATABASE_ERROR', status: 500, ora: 'ORA-01465' } },
        // Valid hex of another length converts to bytes no RAW(16) key holds: it names no row.
        { name: 'hex of another length (`0123`)', recipient: 'u_short', grant: '0123', leaf: { rows: [ORA_U1] } },
      ];
      const raw = ORACLE_KEY_CASES[0];

      beforeAll(async () => {
        for (const m of MALFORMED) await knex(ORA_GRANTS).insert(grantRows(raw, m.recipient, [m.grant, ORA_U1]));
      });
      afterAll(async () => {
        for (const m of MALFORMED) await knex(ORA_GRANTS).where('recipient_id', m.recipient).del();
      });

      for (const m of MALFORMED) {
        it(`${m.name}: the list answers INVALID_FILTER / 400 before any statement; the leaf answers ${'rows' in m.leaf ? 'the other grant\'s rows' : `${m.leaf.code} / ${m.leaf.status} (${m.leaf.ora})`}`, async () => {
          const viaList = await oracleAnswer(driver.find(raw.object, { where: seamed({ id: { $in: [m.grant, ORA_U1] } }) }, ORA_BYPASS));
          expect(viaList).toEqual({ code: 'INVALID_FILTER', status: 400, ora: null });
          const viaLeaf = await oracleAnswer(driver.find(raw.object, { where: seamed({ id: { $in: SharedRecordIds.read(raw.object, m.recipient) } }) }, ORA_BYPASS));
          expect(viaLeaf).toEqual(m.leaf);
        });
      }

      it('a NUMBER key: a grant that is not a number fails both forms alike (DATABASE_ERROR / 500, ORA-01722)', async () => {
        const num = ORACLE_KEY_CASES[1];
        await knex(ORA_GRANTS).insert(grantRows(num, 'u_nan', ['abc', '42']));
        try {
          const viaList = await oracleAnswer(driver.find(num.object, { where: seamed({ id: { $in: ['abc', '42'] } }) }, ORA_BYPASS));
          expect(viaList).toEqual({ code: 'DATABASE_ERROR', status: 500, ora: 'ORA-01722' });
          expect(await oracleAnswer(driver.find(num.object, { where: seamed({ id: { $in: SharedRecordIds.read(num.object, 'u_nan') } }) }, ORA_BYPASS))).toEqual(viaList);
        } finally {
          await knex(ORA_GRANTS).where('recipient_id', 'u_nan').del();
        }
      });
    });
  });
}

declareDialectCell(ORACLE_CELL, 'SharedRecordIds conformance on Oracle key types', declareOracleKeyTypePins);

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

  // [ADR-0155 O2 on Oracle] The RAW(16) reading the list's `HEXTORAW(?)` binding
  // reads (`oracleRawUuidFieldsByObject`, primed from the catalog at every door),
  // set by hand: the compile never dials.
  const withRawId = (config: SqlDriverConfig): CompileProbe => {
    const probe = new CompileProbe(config);
    (probe as any).oracleRawUuidFieldsByObject.set(DOC, new Set(['id']));
    return probe;
  };

  it('oracle, a RAW(16) uuid key: the inner read projects the list\'s conversion, HEXTORAW over the undashed text', () => {
    const probe = withRawId(COMPILE_CONFIGS.oracle);
    const projected = (sql: string) => sql.replace('select "record_id" from', `select HEXTORAW(REPLACE("record_id", '-', '')) from`);
    const read = probe.compileWhere({ id: { $in: SharedRecordIds.read(DOC, 'u1') } } as unknown as FilterCondition);
    expect(read.sql).toBe(projected(COMPILED.oracle.read));
    // The guard and the predicates still read the stored text; no binding is added.
    expect(read.bindings).toEqual([DOC, 'user', 'u1']);
    const write = probe.compileWhere({ id: { $in: SharedRecordIds.write(DOC, 'u1', ['lvl_edit', 'lvl_full']) } } as unknown as FilterCondition);
    expect(write.sql).toBe(projected(COMPILED.oracle.write));
  });

  it('oracle: a column the reading does not name keeps step 3\'s statement', () => {
    const probe = withRawId(COMPILE_CONFIGS.oracle);
    const read = probe.compileWhere({ owner: { $in: SharedRecordIds.read(DOC, 'u1') } } as unknown as FilterCondition);
    expect(read.sql).toBe(COMPILED.oracle.read.replace('where "id" in', 'where "owner" in'));
  });

  it('oracle: a key with no RAW(16) reading at all (never primed) compiles step 3\'s statement; PostgreSQL\'s no-reading refusal is never Oracle\'s', () => {
    // Oracle's list binds an unprimed key's members as text and answers; the
    // leaf compiles as that list does, never INTERNAL_ERROR / 500.
    const probe = new CompileProbe(COMPILE_CONFIGS.oracle);
    expect((probe as any).oracleRawUuidFieldsByObject.has(DOC)).toBe(false);
    const read = probe.compileWhere({ id: { $in: SharedRecordIds.read(DOC, 'u1') } } as unknown as FilterCondition);
    expect(read.sql).toBe(COMPILED.oracle.read);
  });

  for (const dialect of ['sqlite', 'pg', 'mysql', 'mssql'] as const) {
    it(`${dialect}: a RAW(16) reading, which only Oracle primes, changes nothing`, async () => {
      const probe = withRawId(COMPILE_CONFIGS[dialect]);
      await probe.prime({ id: { $in: SharedRecordIds.read(DOC, 'u1') } } as unknown as FilterCondition);
      const read = probe.compileWhere({ id: { $in: SharedRecordIds.read(DOC, 'u1') } } as unknown as FilterCondition);
      expect(read.sql).toBe(COMPILED[dialect].read);
    });
  }
});
