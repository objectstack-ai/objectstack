// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 plan step 3] `TursoDriver` compiles the `SharedRecordIds`
 * fixed-read leaf on BOTH faces, and refuses a misplaced one with ADR-0139
 * D3's envelope:
 *
 * - **local** inherits `SqlDriver`'s compile (`fixedReadLeafSubquery`);
 * - **remote** is an independent compiler: `TursoDriver.toRemoteWhere` passes
 *   a placed leaf through by reference and `RemoteTransport.fixedInnerReadSQL`
 *   compiles the subquery from the same predicates
 *   (`fixedInnerReadPredicates`, `@objectstack/driver-sql`).
 *
 * Each face declares the leaf (`supports.fixedReadLeaves`, inherited), and
 * runs the shared case-set (`SHARED_RECORD_IDS_CASE_SET.cases`), the predicate
 * update's two statements (the prior-row `find` and `updateMany`, ③ ruled A),
 * the `<> ''` witness of the blank-id guard (step 1's L2 N4), and the
 * refusals. The remote face also pins the statement it sends.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
import { TursoDriver } from './turso-driver.js';
import { remoteReadableIdsSemiJoin } from './remote-transport.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const set = SHARED_RECORD_IDS_CASE_SET;
const seamed = (where: unknown): any => lowerFilterCondition(where, { isDatetimeColumn: () => false });

const DOC = 'srid_doc';
const GRANTS = 'sys_record_share';
const WRITE_LEVELS = ['lvl_edit', 'lvl_full'];

const rowsOf = (object: string): readonly FixedReadLeafRow[] => set.tables.find((t) => t.object === object)!.rows;
const objectOf = (object: string, rows: readonly FixedReadLeafRow[]) => ({
  name: object,
  fields: Object.fromEntries(
    [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== 'id').map((k) => [k, { type: 'string' }]),
  ),
});
const sortedIds = (rows: Array<Record<string, unknown>>): string[] => rows.map((r) => String(r.id)).sort();
const holdsWriteForm = (node: unknown): boolean => {
  if (isSharedRecordIds(node)) return node.accessLevels !== undefined;
  if (node === null || typeof node !== 'object') return false;
  return (Array.isArray(node) ? node : Object.values(node)).some(holdsWriteForm);
};

type Face = 'local' | 'remote';

function declareFace(face: Face): void {
  describe(`[ADR-0155 step 3] TursoDriver — SharedRecordIds conformance (${face} face)`, () => {
    let driver: TursoDriver;
    let stub: LibsqlSqliteStub | undefined;
    /** A raw statement on the face's own database, outside the driver's doors. */
    let raw: (sql: string, ...args: unknown[]) => Promise<any[]>;

    const seedDocs = async () => {
      await raw(`delete from ${DOC}`);
      for (const r of rowsOf(DOC)) {
        await raw(`insert into ${DOC} (id, owner, label, organization_id) values (?, ?, ?, ?)`, r.id, r.owner, r.label, r.organization_id);
      }
    };
    const touched = async () => (await raw(`select id from ${DOC} where label = 'touched'`)).map((r) => String(r.id)).sort();

    beforeAll(async () => {
      const objects = set.tables.map((t) => objectOf(t.object, t.rows));
      if (face === 'remote') {
        stub = makeLibsqlSqliteStub();
        driver = new TursoDriver({ url: 'libsql://shared-record-ids.turso.io', client: stub as never });
        await driver.connect();
        expect(driver.transportMode).toBe('remote');
        for (const obj of objects) await driver.syncSchema(obj.name, obj);
        raw = async (sql, ...args) => {
          const statement = stub!.raw.prepare(sql);
          if (statement.reader) return statement.all(...args);
          statement.run(...args);
          return [];
        };
      } else {
        driver = new TursoDriver({ url: ':memory:' });
        expect(driver.transportMode).toBe('local');
        await driver.initObjects(objects as any);
        const knex = (driver as any).knex;
        raw = async (sql, ...args) => {
          const out = await knex.raw(sql, args);
          return Array.isArray(out) ? out : (out?.rows ?? []);
        };
      }
      for (const t of set.tables) {
        for (const r of t.rows) {
          const cols = Object.keys(r);
          await raw(`insert into ${t.object} (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => r[c]));
        }
      }
    }, 60_000);

    afterAll(async () => {
      await driver?.disconnect();
      stub?.close();
    });

    it('declares the leaf it compiles, inherited from SqlDriver: supports.fixedReadLeaves is [SharedRecordIds]', () => {
      expect(driver.supports.fixedReadLeaves).toEqual(['SharedRecordIds']);
    });

    describe('shared conformance cases (find, and count with the same where)', () => {
      for (const c of set.cases) {
        it(c.name, async () => {
          const rows = await driver.find(c.object, { where: seamed(c.where()) }, c.options);
          expect(sortedIds(rows), c.note).toEqual([...c.expected]);
          expect(await driver.count(c.object, { where: seamed(c.where()) }, c.options), c.note).toBe(c.expected.length);
        });
      }
    });

    describe('the predicate update\'s two statements (③ ruled A)', () => {
      const writeCases = set.cases.filter((c) => holdsWriteForm(c.where()));

      it('the case-set carries write-form cases to run', () => {
        expect(writeCases.length).toBeGreaterThanOrEqual(2);
      });

      for (const c of writeCases) {
        it(`${c.name}: the prior-row read and the write each answer the case's rows`, async () => {
          await seedDocs();
          const where = seamed(c.where());
          expect(sortedIds(await driver.find(c.object, { where }, c.options))).toEqual([...c.expected]);
          await driver.updateMany(c.object, { where }, { label: 'touched' }, c.options);
          expect(await touched()).toEqual([...c.expected]);
          await seedDocs();
        });
      }

      it('under a tenant: the outer statement is walled and the inner read is not', async () => {
        await seedDocs();
        const where = seamed({ id: { $in: SharedRecordIds.write(DOC, 'u1', WRITE_LEVELS) } });
        expect(sortedIds(await driver.find(DOC, { where }, { tenantId: 'org_a' }))).toEqual(['d2', 'd7']);
        await driver.updateMany(DOC, { where }, { label: 'touched' }, { tenantId: 'org_a' });
        expect(await touched()).toEqual(['d2', 'd7']);
        await seedDocs();
      });
    });

    describe('N4: the `<> \'\'` half of the blank-id guard', () => {
      beforeAll(async () => {
        await raw(`insert into ${DOC} (id, owner, label, organization_id) values ('', 'u2', 'keep', 'org_a')`);
      });
      afterAll(async () => {
        await raw(`delete from ${DOC} where id = ''`);
      });

      it('the empty id names no record: the leaf does not admit it, and the negation does', async () => {
        const leaf = () => SharedRecordIds.read(DOC, 'u1');
        expect(sortedIds(await driver.find(DOC, { where: seamed({ id: { $in: leaf() } }) }))).toEqual(['d1', 'd2', 'd7', 'd8']);
        expect(sortedIds(await driver.find(DOC, { where: seamed({ $not: { id: { $in: leaf() } } }) }))).toEqual(
          ['', 'd3', 'd4', 'd5', 'd6', 'd9'],
        );
      });
    });

    if (face === 'remote') {
      it('the statement the transport sends: one subquery, bound inputs, the tenant scope outside it only', async () => {
        const sent: { sql: string; args: unknown[] }[] = [];
        const execute = stub!.execute.bind(stub);
        const spy = vi.spyOn(stub!, 'execute').mockImplementation(async (stmt: any) => {
          if (typeof stmt === 'object' && String(stmt.sql).includes(GRANTS)) sent.push({ sql: stmt.sql, args: [...(stmt.args ?? [])] });
          return execute(stmt);
        });
        try {
          await driver.find(DOC, { where: seamed({ id: { $in: SharedRecordIds.write(DOC, 'u1', WRITE_LEVELS) } }) }, { tenantId: 'org_a' });
        } finally {
          spy.mockRestore();
        }
        expect(sent).toHaveLength(1);
        const subquery =
          '"id" IN (SELECT "record_id" FROM "sys_record_share" WHERE "object_name" = ? AND "recipient_type" = ? '
          + 'AND "recipient_id" = ? AND "access_level" IN (?, ?) AND "record_id" IS NOT NULL AND "record_id" <> ?)';
        // The subquery carries no organization predicate; the outer statement carries its one.
        expect(sent[0].sql).toContain(subquery);
        expect(sent[0].sql.match(/organization_id/g)).toHaveLength(1);
        expect(sent[0].args).toEqual(expect.arrayContaining([DOC, 'user', 'u1', 'lvl_edit', 'lvl_full', '', 'org_a']));
      });
    }

    describe('refusals: a leaf anywhere but a field\'s $in comparand', () => {
      const leaf = () => SharedRecordIds.read(DOC, 'u1');
      const misplaced: [string, string, () => unknown][] = [
        ['under $nin', DOC, () => ({ id: { $nin: leaf() } })],
        ['as a member of a $in list', DOC, () => ({ id: { $in: [leaf()] } })],
        ['as $not\'s operand', DOC, () => ({ $not: leaf() })],
        ['misplaced inside a composed ReadableIds scope', 'srid_note', () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(DOC), { owner: leaf() }) } })],
      ];
      for (const [name, object, where] of misplaced) {
        it(`${name}: INTERNAL_ERROR / 500 on find, count and updateMany`, async () => {
          const w = where() as FilterCondition;
          await expect(driver.find(object, { where: w })).rejects.toMatchObject(READABLE_IDS_REFUSAL);
          await expect(driver.count(object, { where: w })).rejects.toMatchObject(READABLE_IDS_REFUSAL);
          await expect(driver.updateMany(object, { where: w }, { label: 'touched' })).rejects.toMatchObject(READABLE_IDS_REFUSAL);
          expect(await touched()).toEqual([]);
        });
      }

      it('names the position and the leaf, never its recipient', async () => {
        const err = await driver.find(DOC, { where: { id: { $nin: leaf() } } as any }).catch((e) => e);
        expect(err).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
        expect(err.message).toContain('[driver-turso] where.id.$nin holds a SharedRecordIds leaf');
        expect(err.message).not.toContain('u1');
      });
    });
  });
}

declareFace('local');
declareFace('remote');

describe('[ADR-0155 step 3] the refusal is logged at error once per driver', () => {
  for (const face of ['local', 'remote'] as const) {
    it(`${face} face`, async () => {
      const stub = face === 'remote' ? makeLibsqlSqliteStub() : undefined;
      const driver = face === 'remote'
        ? new TursoDriver({ url: 'libsql://refusal-log.turso.io', client: stub as never })
        : new TursoDriver({ url: ':memory:' });
      await driver.connect();
      const doc = objectOf(DOC, rowsOf(DOC));
      if (face === 'remote') await driver.syncSchema(doc.name, doc);
      else await driver.initObjects([doc] as any);
      const error = vi.spyOn((driver as any).logger, 'error');
      for (let i = 0; i < 2; i++) {
        await expect(driver.find(DOC, { where: { id: { $nin: SharedRecordIds.read(DOC, 'u1') } } as any })).rejects.toMatchObject(
          READABLE_IDS_REFUSAL,
        );
      }
      expect(error).toHaveBeenCalledTimes(1);
      await driver.disconnect();
      stub?.close();
    });
  }
});

describe('[ADR-0155 step 3] RemoteTransport driven standalone refuses a misplaced leaf before compiling', () => {
  it('buildWhereSQL answers the envelope, not a compiled statement', async () => {
    const stub = makeLibsqlSqliteStub();
    const driver = new TursoDriver({ url: 'libsql://standalone.turso.io', client: stub as never });
    await driver.connect();
    const transport = (driver as any).remoteTransport;
    expect(() => transport.buildWhereSQL(DOC, { id: { $eq: SharedRecordIds.read(DOC, 'u1') } })).toThrow(
      expect.objectContaining(READABLE_IDS_REFUSAL),
    );
    // A placed leaf compiles, directly and inside a resolved semi-join's scope,
    // which the walk reads as a node (a composed scope the driver resolved).
    expect(transport.buildWhereSQL(DOC, { id: { $in: SharedRecordIds.read(DOC, 'u1') } }).whereClauses).toMatch(/^"id" IN \(SELECT "record_id"/);
    const semiJoin = remoteReadableIdsSemiJoin({ object: DOC, table: DOC, scope: { id: { $in: SharedRecordIds.read(DOC, 'u1') } }, tenant: undefined });
    expect(transport.buildWhereSQL('srid_note', { record_id: { $in: semiJoin } }).whereClauses).toBe(
      '"record_id" IN (SELECT "id" FROM "srid_doc" WHERE ("id" IN (SELECT "record_id" FROM "sys_record_share" WHERE '
        + '"object_name" = ? AND "recipient_type" = ? AND "recipient_id" = ? AND "record_id" IS NOT NULL AND "record_id" <> ?)))',
    );
    const misplacedInScope = remoteReadableIdsSemiJoin({ object: DOC, table: DOC, scope: { owner: SharedRecordIds.read(DOC, 'u1') } as any, tenant: undefined });
    expect(() => transport.buildWhereSQL('srid_note', { record_id: { $in: misplacedInScope } })).toThrow(
      expect.objectContaining(READABLE_IDS_REFUSAL),
    );
    await driver.disconnect();
    stub.close();
  });
});
