// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21241] A declared `Field.datetime` defaulting to `'NOW()'` gets the SAME
 * column a builtin audit timestamp gets, on every dialect, so MySQL accepts it.
 *
 * # The defect
 *
 * On MySQL a declared `Field.datetime` is built `DATETIME(3)`. Its `NOW()`
 * default came from `nowColumnDefault('datetime')`, which fell through to a
 * bare `knex.fn.now()`: `CURRENT_TIMESTAMP`, precision 0. MySQL refuses a
 * `CURRENT_TIMESTAMP` default whose precision differs from its `DATETIME`
 * column's, so the whole `CREATE TABLE` failed. Measured on MySQL 8.0.46 at
 * `be5a83cf`, booting the CRM and the showcase:
 *
 * ```
 * create table `sys_activity` (… `timestamp` datetime(3) default CURRENT_TIMESTAMP …)
 *   - Invalid default value for 'timestamp'
 * create table `sys_presence` (… `last_seen` datetime(3) default CURRENT_TIMESTAMP …)
 *   - Invalid default value for 'last_seen'
 * ```
 *
 * The builtin `created_at` / `updated_at` beside them carried `now(3)`, a
 * second literal, and were accepted. The fix gives the precision ONE source
 * (`MYSQL_DATETIME_PRECISION`) and routes the builtin default through
 * `nowColumnDefault`, so a declared NOW() column and a builtin one are one
 * definition.
 *
 * # What is asserted
 *
 * §1 runs on every runner, with no server: the DDL each dialect compiles for a
 * declared NOW() datetime column is byte-identical to the builtin audit
 * column's. Before the fix the `mysql2` row differed (`CURRENT_TIMESTAMP`
 * against `CURRENT_TIMESTAMP(3)`); `pg` and `better-sqlite3` were already
 * equal and are the control.
 *
 * §2 is the card's cell, one per dialect, through `declareDialectCell`: the
 * table with a required NOW() datetime field SYNCS (create, and add-column on a
 * table that already exists), an insert that omits the field answers the
 * instant the column DEFAULT stored, and the server's own catalogue reports the
 * declared column's type and default equal to `created_at`'s. SQLite and
 * PostgreSQL passed before the fix and are the control; MySQL failed at sync.
 *
 * §3 is MySQL only: a legacy `TIMESTAMP` NOW() column, widened to `DATETIME(n)`
 * at schema sync, keeps a default — the same one `created_at` keeps. Before,
 * the widening restated the audit columns' default and dropped the declared
 * one, so an insert omitting the field answered `null`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os21241_now_default';

/** The shape `sys_activity.timestamp` and `sys_presence.last_seen` declare. */
const NOW_FIELD = { type: 'datetime', required: true, defaultValue: 'NOW()' };

const OBJECT = {
  name: TABLE,
  fields: {
    title: { type: 'string' },
    stamped_at: NOW_FIELD,
  },
} as any;

/** The same object before `stamped_at` was declared — the add-column door. */
const OBJECT_WITHOUT_FIELD = {
  name: TABLE,
  fields: { title: { type: 'string' } },
} as any;

/** Compile DDL for one dialect without opening a connection. */
class DdlProbe extends SqlDriver {
  /** `create table` holding one column, built the way a declared field is. */
  declaredColumnSql(field: Record<string, unknown>): string {
    return this.knex.schema
      .createTable('t', (table: Knex.CreateTableBuilder) => {
        this.createColumn(table, 'c', field);
      })
      .toString();
  }

  /** `create table` holding one column, built the way a builtin audit column is. */
  auditColumnSql(): string {
    return this.knex.schema
      .createTable('t', (table: Knex.CreateTableBuilder) => {
        this.createAuditTimestampColumn(table, 'c');
      })
      .toString();
  }
}

function probe(client: string): DdlProbe {
  return new DdlProbe({ client, connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
}

// ── §1 One definition, compiled on every dialect ─────────────────────────────

describe('#21241 §1 — a declared NOW() datetime column compiles to the builtin audit column', () => {
  for (const client of ['mysql2', 'pg', 'better-sqlite3']) {
    it(`${client}: the declared column and the audit column are byte-identical DDL`, async () => {
      const driver = probe(client);
      try {
        // A plain declaration (no `storage.notNull`), so the declared column
        // carries no `not null` the audit column lacks: what is left to differ
        // is the type and the default.
        const declared = driver.declaredColumnSql({ type: 'datetime', defaultValue: 'NOW()' });
        expect(declared).toBe(driver.auditColumnSql());
        // The comparison is not vacuous: the column really has a default.
        expect(declared).toMatch(/ default /);
      } finally {
        await driver.disconnect();
      }
    });
  }

  it('mysql2: a REQUIRED NOW() datetime column defaults at its own precision', async () => {
    // The `sys_activity.timestamp` shape. Read off the compiled DDL rather
    // than against a literal: whatever precision the column is built with,
    // its CURRENT_TIMESTAMP default must name the same one (no `(n)` is
    // precision 0, which is what MySQL refuses beside a `datetime(3)`).
    const driver = probe('mysql2');
    try {
      const sql = driver.declaredColumnSql(NOW_FIELD);
      const m = /`c` datetime\((\d+)\)(?: not null)? default CURRENT_TIMESTAMP(?:\((\d+)\))?/.exec(sql);
      expect(m, sql).not.toBeNull();
      expect(m![2] ?? '0', sql).toBe(m![1]);
    } finally {
      await driver.disconnect();
    }
  });
});

// ── §2 The live cells ────────────────────────────────────────────────────────

/** Whatever a dialect handed back for a timestamp, as epoch ms. */
function asInstant(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}

/**
 * Slack for the server's clock against this process's. Wide on purpose: what
 * it must still catch is a zone error (the CI servers run at +08:00, so a
 * default resolved in the server's zone lands hours off), not clock jitter.
 */
const CLOCK_SLACK_MS = 60_000;

/** The type and default the server's own catalogue reports for one column. */
async function catalogueColumn(cell: DialectCell, knex: Knex, column: string): Promise<Record<string, unknown>> {
  if (cell.id === 'mysql') {
    const [rows]: any = await knex.raw(
      'select column_type as type, datetime_precision as fsp, column_default as dflt ' +
        'from information_schema.columns where table_schema = database() and table_name = ? and column_name = ?',
      [TABLE, column],
    );
    expect(rows, column).toHaveLength(1);
    return { ...rows[0] };
  }
  if (cell.id === 'pg') {
    const res: any = await knex.raw(
      'select data_type as type, datetime_precision as fsp, column_default as dflt ' +
        'from information_schema.columns where table_schema = current_schema() and table_name = ? and column_name = ?',
      [TABLE, column],
    );
    expect(res.rows, column).toHaveLength(1);
    return { ...res.rows[0] };
  }
  const rows: any[] = await knex.raw(`pragma table_info(${TABLE})`);
  const row = rows.find((r) => r.name === column);
  expect(row, column).toBeDefined();
  return { type: row.type, dflt: row.dflt_value };
}

function measure(cell: DialectCell): void {
  describe(`#21241 §2 — a required NOW() datetime field syncs and defaults (${cell.label})`, () => {
    let driver: SqlDriver;
    const knex = () => driver.getKnex();

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      await knex().schema.dropTableIfExists(TABLE);
    });

    afterEach(async () => {
      await knex().schema.dropTableIfExists(TABLE);
      await driver.disconnect();
    });

    it('creates the table, with the declared column typed and defaulted like created_at', async () => {
      await driver.initObjects([OBJECT]);

      expect(await knex().schema.hasTable(TABLE)).toBe(true);
      const declared = await catalogueColumn(cell, knex(), 'stamped_at');
      const builtin = await catalogueColumn(cell, knex(), 'created_at');
      expect(declared.dflt, 'the declared column has a default at all').not.toBeNull();
      expect(declared).toEqual(builtin);
      if (cell.id === 'mysql') {
        // The pairing MySQL enforces, read from the server rather than a literal.
        expect(String(declared.dflt)).toBe(`CURRENT_TIMESTAMP(${declared.fsp})`);
      }
    });

    it('an insert omitting the field answers the instant the column DEFAULT stored', async () => {
      await driver.initObjects([OBJECT]);

      const before = Date.now();
      const answer = await driver.create(TABLE, { title: 'defaulted' });
      const after = Date.now();

      expect(answer.stamped_at).not.toBeNull();
      expect(answer.stamped_at).not.toBeUndefined();
      const instant = asInstant(answer.stamped_at);
      expect(instant).toBeGreaterThanOrEqual(before - CLOCK_SLACK_MS);
      expect(instant).toBeLessThanOrEqual(after + CLOCK_SLACK_MS);
      expect(answer).toEqual(await driver.findOne(TABLE, { where: { id: answer.id } }));
    });

    it('a raw insert that never names the column is filled by the DEFAULT alone', async () => {
      // Past every app-side default path: nothing but the column DEFAULT can
      // put a value in a column the statement never names.
      await driver.initObjects([OBJECT]);

      const before = Date.now();
      await knex()(TABLE).insert({ id: 'raw-1', title: 'raw' });
      const after = Date.now();

      const row = await driver.findOne(TABLE, { where: { id: 'raw-1' } });
      expect(row).not.toBeNull();
      const instant = asInstant(row!.stamped_at);
      expect(instant).toBeGreaterThanOrEqual(before - CLOCK_SLACK_MS);
      expect(instant).toBeLessThanOrEqual(after + CLOCK_SLACK_MS);
    });

    it('adds the NOW() column to a table that already exists, and it defaults there too', async () => {
      await driver.initObjects([OBJECT_WITHOUT_FIELD]);
      await driver.initObjects([OBJECT]);

      expect(await knex().schema.hasColumn(TABLE, 'stamped_at')).toBe(true);
      const answer = await driver.create(TABLE, { title: 'after add-column' });
      expect(answer.stamped_at).not.toBeNull();
      expect(Number.isNaN(asInstant(answer.stamped_at))).toBe(false);
    });

    if (cell.id === 'mysql') {
      it('§3 a legacy TIMESTAMP NOW() column keeps its default through the DATETIME widening', async () => {
        // The pre-DATETIME(3) shape, when every datetime column was TIMESTAMP
        // and a bare CURRENT_TIMESTAMP default was legal on it. Schema sync
        // widens such a column with `ALTER … MODIFY`, which drops any default
        // the statement does not restate.
        await knex().raw(
          `create table ${TABLE} (id varchar(255) not null primary key, ` +
            'created_at timestamp null default current_timestamp, ' +
            'updated_at timestamp null default current_timestamp, ' +
            'title varchar(255) null, stamped_at timestamp null default current_timestamp)',
        );
        await driver.initObjects([OBJECT]);

        const declared = await catalogueColumn(cell, knex(), 'stamped_at');
        expect(String(declared.type), 'the widening ran').toMatch(/^datetime\(/);
        expect(declared).toEqual(await catalogueColumn(cell, knex(), 'created_at'));
        const answer = await driver.create(TABLE, { title: 'after widening' });
        expect(answer.stamped_at).not.toBeNull();
        expect(Number.isNaN(asInstant(answer.stamped_at))).toBe(false);
      });
    }
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'NOW() datetime default precision (#21241)', measure);
}
