// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21227] `create` and `bulkCreate` answer the rows they STORED, on every
 * dialect: one record per written row, in the written order.
 *
 * # The defect
 *
 * Both doors ran `builder.insert(...).returning('*')` and answered what the
 * statement answered. MySQL has no `RETURNING`: knex's MySQL compiler drops the
 * clause with a `.returning() is not supported by mysql` warning and answers
 * `[insertId]`, which is `0` for this driver's string primary key and ONE
 * element whatever the row count. Measured on live MySQL 8.0.46 at `62b90d74`,
 * every row stored correctly each time:
 *
 * | call | answered |
 * |:--|:--|
 * | `create` (generated id) | `0` |
 * | `create` (supplied id) | `0` |
 * | `bulkCreate`, 3 rows | `[0]` (length 1) |
 * | `bulkCreate`, 1 row | `[0]` |
 *
 * One layer up, the auth adapter answers what `create` answers, so sign-up on
 * MySQL answered `400 FAILED_TO_CREATE_USER` with the user row stored and no
 * account row; and the engine's one-result-per-row guard refuses a multi-row
 * `bulkCreate` AFTER every row has landed.
 *
 * # What is asserted, per cell
 *
 * The answer is compared with the row read back through the driver's own
 * `findOne`, and it must carry `done: false`, a value only the column's
 * DEFAULT supplies (the payload never names `done`): an answer that echoed the
 * payload fails here, and so does `0`.
 *
 * Cells: SQLite always; live PostgreSQL and MySQL where provisioned (the
 * `Temporal Conformance (live PG + MySQL)` job runs this package against both)
 * and declared un-run otherwise. SQLite and PostgreSQL answer from `RETURNING`,
 * unchanged by the fix, and are the control: they passed before it and must
 * pass after it, in ONE statement each. MySQL reads back, in two.
 *
 * One more cell, always run: SQLite with the read-back path forced
 * (`insertReturnsStoredRows` overridden to `false`), so the read-back's own
 * logic (written order, the written tenant scope, the caller's transaction,
 * the refusal when a written row is gone) is measured on every CI run, not
 * only on the job that has a MySQL server.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver, type SqlDriverConfig } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os21227_stored_row';

const OBJECT = {
  name: TABLE,
  fields: {
    organization_id: { type: 'string' },
    title: { type: 'string' },
    qty: { type: 'number' },
    // Filled by the column DEFAULT, never by a payload in this file: the field
    // that tells a stored row from an echo of what was sent.
    done: { type: 'boolean', defaultValue: false },
    meta: { type: 'json' },
  },
} as any;

/** SQLite, with the read-back path the MySQL family takes. */
class ReadBackPathSqlDriver extends SqlDriver {
  protected override get insertReturnsStoredRows(): boolean {
    return false;
  }
}

interface Face {
  label: string;
  make(): SqlDriver;
  /** Whether this face answers by reading back (two statements) rather than from RETURNING. */
  readsBack: boolean;
  /** Whether a trigger can delete the row its own INSERT wrote (SQLite only). */
  sqliteTriggers: boolean;
}

function suite(face: Face) {
  describe(`sql-driver — create / bulkCreate answer the stored row (${face.label}) [#21227]`, () => {
    let driver: SqlDriver;
    const knex = () => driver.getKnex();

    /** Statements this test issued against the fixture table, in order. */
    let statements: string[] = [];
    const record = (q: { sql?: string }) => {
      const sql = String(q?.sql ?? '');
      if (sql.includes(TABLE)) statements.push(sql.trim().split(/\s+/)[0].toLowerCase());
    };

    const stored = async (id: unknown) => {
      const row = await driver.findOne(TABLE, { where: { id } });
      expect(row, `row ${String(id)} was not stored`).not.toBeNull();
      return row!;
    };

    beforeEach(async () => {
      driver = face.make();
      await knex().schema.dropTableIfExists(TABLE);
      await driver.initObjects([OBJECT]);
      statements = [];
      knex().on('query', record);
    });

    afterEach(async () => {
      knex().removeListener('query', record);
      await knex().schema.dropTableIfExists(TABLE);
      await driver.disconnect();
    });

    it('measures the path it claims to (the cell is not vacuous)', () => {
      expect((driver as any).insertReturnsStoredRows).toBe(!face.readsBack);
    });

    it('create with a generated id answers the stored row', async () => {
      const answer = await driver.create(TABLE, { title: 'generated', qty: 1, meta: { k: [1, 2] } });

      expect(typeof answer.id).toBe('string');
      expect(answer.id).not.toBe('');
      expect(answer.done).toBe(false);
      expect(answer.meta).toEqual({ k: [1, 2] });
      expect(answer).toEqual(await stored(answer.id));
    });

    it('create with a supplied id answers that row, in one statement or two by path', async () => {
      const answer = await driver.create(TABLE, { id: 'given-1', title: 'supplied', qty: 2 });

      expect(answer).toEqual(await stored('given-1'));
      expect(answer.title).toBe('supplied');
      expect(answer.done).toBe(false);
      // The findOne above is the test's own read; the door's statements precede it.
      expect(statements.slice(0, face.readsBack ? 2 : 1)).toEqual(face.readsBack ? ['insert', 'select'] : ['insert']);
      expect(statements[face.readsBack ? 2 : 1]).toBe('select'); // the test's findOne
    });

    it('bulkCreate answers one stored row per written row, in the written order', async () => {
      const answer = await driver.bulkCreate(TABLE, [
        { title: 'b1' },
        { id: 'given-b2', title: 'b2', qty: 2 },
        { title: 'b3', qty: 3 },
      ]);

      expect(answer).toHaveLength(3);
      expect(answer.map((r) => r.title)).toEqual(['b1', 'b2', 'b3']);
      expect(answer[1].id).toBe('given-b2');
      // The batch is ONE insert, and on the read-back path ONE read.
      expect(statements).toEqual(face.readsBack ? ['insert', 'select'] : ['insert']);
      for (const row of answer) {
        expect(row.done).toBe(false);
        expect(row).toEqual(await stored(row.id));
      }
    });

    it('bulkCreate of one row answers one stored row', async () => {
      const answer = await driver.bulkCreate(TABLE, [{ id: 'only', title: 'single' }]);

      expect(answer).toHaveLength(1);
      expect(answer[0]).toEqual(await stored('only'));
    });

    it('a tenanted create answers the row stamped with the caller tenant', async () => {
      const answer = await driver.create(TABLE, { id: 't-own', title: 'own' }, { tenantId: 'org_a' });

      expect(answer.organization_id).toBe('org_a');
      expect(answer).toEqual(await stored('t-own'));
    });

    it('an admin write naming another tenant answers the row it stored, not a refusal', async () => {
      // `injectTenantOnInsert` never overwrites an explicit tenant, so the row
      // lands under org_b while the call carries org_a. A read-back scoped to
      // the caller's ACTIVE org would miss it.
      const answer = await driver.create(
        TABLE,
        { id: 't-named', title: 'named', organization_id: 'org_b' },
        { tenantId: 'org_a' },
      );
      expect(answer.organization_id).toBe('org_b');
      expect(answer).toEqual(await stored('t-named'));

      const batch = await driver.bulkCreate(
        TABLE,
        [
          { id: 't-b1', title: 'stamped' },
          { id: 't-b2', title: 'named', organization_id: 'org_c' },
        ],
        { tenantId: 'org_a' },
      );
      expect(batch.map((r) => [r.id, r.organization_id])).toEqual([
        ['t-b1', 'org_a'],
        ['t-b2', 'org_c'],
      ]);
    });

    it('inside a caller transaction, create and bulkCreate answer the uncommitted rows and the rollback keeps', async () => {
      const trx = await driver.beginTransaction();
      let single!: Record<string, unknown>;
      let batch!: Record<string, unknown>[];
      try {
        single = await driver.create(TABLE, { id: 'tx-1', title: 'in tx' }, { transaction: trx });
        batch = await driver.bulkCreate(TABLE, [{ id: 'tx-2', title: 'in tx' }, { id: 'tx-3', title: 'in tx' }], {
          transaction: trx,
        });
      } finally {
        await driver.rollback(trx);
      }
      expect(single.id).toBe('tx-1');
      expect(single.done).toBe(false);
      expect(batch.map((r) => r.id)).toEqual(['tx-2', 'tx-3']);
      expect(await driver.find(TABLE, {})).toEqual([]);
    });

    if (face.readsBack && face.sqliteTriggers) {
      it('a written row that is gone before the read-back is refused, once, and never re-issued', async () => {
        await knex().raw(
          `create trigger os21227_vanish after insert on ${TABLE} begin delete from ${TABLE} where id = new.id; end`,
        );
        statements = [];

        const err = await driver.create(TABLE, { id: 'gone', title: 'vanishes' }).then(
          () => null,
          (e: unknown) => e as { code?: string; status?: number },
        );
        expect(err).not.toBeNull();
        expect(err!.code).toBe('DATABASE_ERROR');
        expect(err!.status).toBe(500);
        // One insert, one read, no retry: re-issuing would duplicate a row that landed.
        expect(statements).toEqual(['insert', 'select']);
      });
    }
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'create / bulkCreate stored row (#21227)', (c: DialectCell) =>
    suite({
      label: c.label,
      make: () => new SqlDriver(c.config()),
      readsBack: c.id === 'mysql',
      sqliteTriggers: c.id === 'sqlite',
    }),
  );
}

suite({
  label: 'sqlite, read-back path forced',
  make: () => new ReadBackPathSqlDriver(dialectSqliteConfig()),
  readsBack: true,
  sqliteTriggers: true,
});

function dialectSqliteConfig(): SqlDriverConfig {
  return DIALECT_CELLS.find((c) => c.id === 'sqlite')!.config();
}
