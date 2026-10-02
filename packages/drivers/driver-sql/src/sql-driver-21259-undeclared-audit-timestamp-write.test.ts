// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21259] A builtin audit timestamp the object did NOT declare is written in
 * the storage form of the column this driver provisioned for it — on every
 * dialect, through every write door.
 *
 * # The defect
 *
 * `initObjects` creates `created_at` and `updated_at` on EVERY managed table
 * ({@link SqlDriver.createAuditTimestampColumn}: `DATETIME(3)` on MySQL), and
 * the engine's `sys_stamp_audit_insert` hook stamps BOTH on every insert, as
 * `new Date().toISOString()` — `YYYY-MM-DDTHH:MM:SS.sssZ`. `formatInput`
 * rewrites that canonical text into the MySQL literal only for a column in
 * `datetimeFields`, i.e. one the object DECLARED as `Field.datetime`. The
 * registry declares both for most objects, but injects nothing for a
 * `managedBy: 'better-auth'` or `systemFields: false` object, so a column such
 * an object leaves undeclared reached MySQL as the raw ISO text, which MySQL
 * refuses (`Incorrect datetime value … for column 'updated_at'`).
 *
 * Measured on live MySQL 8.0.46 at `8dea55d3`, `pnpm dev:crm -- --fresh
 * --database mysql://…`: `sys_jwks` declares `created_at` and not `updated_at`,
 * so the JWT signing-key row was never written (`created_at` bound as
 * `2026-10-01 23:35:47.598`, `updated_at` as `2026-10-01T23:35:47.598Z`, one
 * stamp), and `GET /api/v1/auth/jwks` and `GET /api/v1/auth/token` answered
 * 500. `sys_member` failed the same way. Of the 81 objects that boot registers,
 * 9 declare `created_at` without `updated_at` and 2 declare neither.
 *
 * # What is asserted, per cell
 *
 * Two objects in the two shapes the census found — `created_at` declared,
 * `updated_at` not (the `sys_jwks` shape), and neither declared — written
 * through `create`, `bulkCreate`, `upsert`, `update` and `updateMany` with the hook's exact
 * value, and read back as the same instant. Each write records the value the
 * driver BOUND for the undeclared column: the MySQL literal on MySQL, and on
 * SQLite and PostgreSQL the hook's text unchanged, byte for byte — those two
 * cells passed before the fix and are the control.
 *
 * A `Date` takes the same rule a declared `Field.datetime` takes, so it is
 * stored as the canonical instant on every dialect too.
 *
 * Cells: SQLite always; live PostgreSQL and MySQL where provisioned (the
 * `Temporal Conformance (live PG + MySQL)` job runs this package against both)
 * and declared un-run otherwise.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from './index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** Driver options every write here uses — these fixtures are not tenant-scoped. */
const OPTS = { bypassTenantAudit: true } as any;

/** Declares `created_at` and not `updated_at` — the `sys_jwks` shape. */
const CREATED_ONLY = 'os21259_created_only';
/** Declares neither audit column — the `sys_oauth_client_assertion` shape. */
const NEITHER = 'os21259_neither';

const OBJECTS = [
  {
    name: CREATED_ONLY,
    fields: {
      label: { type: 'string' },
      created_at: { type: 'datetime' },
    },
  },
  {
    name: NEITHER,
    fields: {
      label: { type: 'string' },
    },
  },
] as any[];

/** What the engine's audit hook stamps: `new Date().toISOString()`. */
const STAMP = '2026-10-01T21:49:27.479Z';
const LATER = '2026-10-02T03:04:05.006Z';

/** The physical spelling the driver binds for `STAMP`'s instant on `cell`. */
function boundFor(cell: DialectCell, iso: string): string {
  return cell.id === 'mysql' ? iso.replace('T', ' ').replace('Z', '') : iso;
}

function suite(cell: DialectCell) {
  describe(`sql-driver — an undeclared builtin audit timestamp is written in its column's form (${cell.label}) [#21259]`, () => {
    let driver: SqlDriver;

    /** Bindings of the writes this test issued against the fixture tables, in order. */
    let writes: { sql: string; bindings: unknown[] }[] = [];
    const record = (q: { sql?: string; bindings?: unknown[] }) => {
      const sql = String(q?.sql ?? '');
      if (!/^\s*(insert|update)/i.test(sql)) return;
      if (!sql.includes(CREATED_ONLY) && !sql.includes(NEITHER)) return;
      writes.push({ sql, bindings: [...(q.bindings ?? [])] });
    };

    /** Every value bound in the recorded writes. */
    const bound = () => writes.flatMap((w) => w.bindings);

    const stored = async (object: string, id: string) => {
      const row = await driver.findOne(object, { where: { id } }, OPTS);
      expect(row, `row ${id} was not stored`).not.toBeNull();
      return row!;
    };

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      for (const o of OBJECTS) await driver.getKnex().schema.dropTableIfExists(o.name);
      await driver.initObjects(OBJECTS);
      writes = [];
      driver.getKnex().on('query', record);
    });

    afterEach(async () => {
      driver.getKnex().removeListener('query', record);
      for (const o of OBJECTS) await driver.getKnex().schema.dropTableIfExists(o.name);
      await driver.disconnect();
    });

    it('measures the shape it claims to: `updated_at` is undeclared and its column exists', async () => {
      const fields = (driver as any).declaredFieldsFor(CREATED_ONLY);
      expect(Object.keys(fields)).toEqual(['label', 'created_at']);
      expect((driver as any).datetimeFields[CREATED_ONLY]?.has('updated_at') ?? false).toBe(false);
      const columns = Object.keys(await driver.getKnex()(CREATED_ONLY).columnInfo());
      expect(columns).toEqual(expect.arrayContaining(['created_at', 'updated_at']));
    });

    it('create: the hook-stamped pair lands on the `sys_jwks` shape, as one instant', async () => {
      await driver.create(CREATED_ONLY, { id: 'c1', label: 'one', created_at: STAMP, updated_at: STAMP }, OPTS);

      const row = await stored(CREATED_ONLY, 'c1');
      expect(row.created_at).toBe(STAMP);
      expect(row.updated_at).toBe(STAMP);
      // Both columns are bound in the column's form — the declared one always
      // was; the undeclared one is the fix. On SQLite and Postgres this is the
      // hook's text, unchanged.
      expect(bound().filter((v) => v === boundFor(cell, STAMP))).toHaveLength(2);
      if (cell.id === 'mysql') expect(bound()).not.toContain(STAMP);
    });

    it('create: an object that declares neither audit column takes both', async () => {
      await driver.create(NEITHER, { id: 'n1', label: 'one', created_at: STAMP, updated_at: LATER }, OPTS);

      const row = await stored(NEITHER, 'n1');
      expect(row.created_at).toBe(STAMP);
      expect(row.updated_at).toBe(LATER);
      expect(bound()).toEqual(expect.arrayContaining([boundFor(cell, STAMP), boundFor(cell, LATER)]));
    });

    it('bulkCreate: every row of the batch lands', async () => {
      await driver.bulkCreate(
        CREATED_ONLY,
        [
          { id: 'b1', label: 'one', created_at: STAMP, updated_at: STAMP },
          { id: 'b2', label: 'two', created_at: LATER, updated_at: LATER },
        ],
        OPTS,
      );

      expect((await stored(CREATED_ONLY, 'b1')).updated_at).toBe(STAMP);
      expect((await stored(CREATED_ONLY, 'b2')).updated_at).toBe(LATER);
    });

    it('upsert: the INSERT branch lands the supplied instant', async () => {
      await driver.upsert(NEITHER, { id: 'u1', label: 'one', created_at: STAMP, updated_at: STAMP }, undefined, OPTS);

      const row = await stored(NEITHER, 'u1');
      expect(row.created_at).toBe(STAMP);
      expect(row.updated_at).toBe(STAMP);
    });

    it('update under `preserveAudit`: the supplied `updated_at` is kept, in the column form', async () => {
      // Seeded with no audit value, so this case measures the UPDATE door alone.
      await driver.create(CREATED_ONLY, { id: 'p1', label: 'one' }, OPTS);
      writes = [];

      await driver.update(CREATED_ONLY, 'p1', { label: 'one!', updated_at: LATER }, { ...OPTS, preserveAudit: true });

      const row = await stored(CREATED_ONLY, 'p1');
      expect(row.label).toBe('one!');
      expect(row.updated_at).toBe(LATER);
      expect(bound()).toContain(boundFor(cell, LATER));
    });

    it('updateMany under `preserveAudit`: the supplied `updated_at` is kept, in the column form', async () => {
      await driver.create(NEITHER, { id: 'm1', label: 'bulk' }, OPTS);
      await driver.create(NEITHER, { id: 'm2', label: 'bulk' }, OPTS);
      writes = [];

      await driver.updateMany(NEITHER, { where: { label: 'bulk' } }, { updated_at: LATER }, { ...OPTS, preserveAudit: true });

      expect((await stored(NEITHER, 'm1')).updated_at).toBe(LATER);
      expect((await stored(NEITHER, 'm2')).updated_at).toBe(LATER);
      expect(bound()).toContain(boundFor(cell, LATER));
    });

    it('a `Date` is stored as the same canonical instant, as a declared `Field.datetime` is', async () => {
      await driver.create(NEITHER, { id: 'd1', label: 'one', created_at: new Date(STAMP), updated_at: new Date(LATER) }, OPTS);

      const row = await stored(NEITHER, 'd1');
      expect(row.created_at).toBe(STAMP);
      expect(row.updated_at).toBe(LATER);
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'undeclared builtin audit timestamp write (#21259)', (c: DialectCell) => suite(c));
}
