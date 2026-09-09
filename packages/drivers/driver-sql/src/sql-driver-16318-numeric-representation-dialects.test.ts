// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16318] The NUMERIC family's physical representation, PINNED ON THE SERVER
 * DIALECTS it was chosen for — one cell per dialect through the shared live
 * matrix (`OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL`, run by the
 * `Temporal Conformance (live PG + MySQL)` job).
 *
 * ## Why this file exists beside the SQLite one
 *
 * `sql-driver-16318-numeric-representation.test.ts` pins the SQLite half —
 * affinity and storage class — and says so honestly. It cannot pin the property
 * the table was actually chosen for: SQLite applies neither precision nor scale,
 * and it never hands back a string for a `float` column, so the exact-decimal
 * DDL and the read-side repair that makes it safe both had ZERO automated
 * coverage on the two dialects they exist for. Everything below was session
 * prose in the PR body until this file; the instrument was already here and
 * already running in CI.
 *
 * ## The three properties, and the measurement each one pins
 *
 * 1. **The column.** `numeric(65,30)` on PostgreSQL, `decimal(65,30)` on MySQL,
 *    `integer` / `int` for `rating` — read out of `information_schema` rather
 *    than out of the DDL this driver emitted, so the assertion is what the
 *    SERVER made of it. The numbers come from the spec constants, never from a
 *    literal here (a literal would let the two drift and still pass).
 *
 * 2. **The read seam.** node-postgres parses `numeric` to a STRING where it
 *    parses `real` to a number, and mysql2 does the same for `DECIMAL`, so
 *    without `formatOutput`'s coercion a declared `number` would read back as a
 *    string on exactly these two dialects — a wire-contract break, since
 *    `valueSchemaFor` gives the whole class `z.number().finite()`.
 *
 * 3. ⭐ **What a fractional `rating` does, per dialect — the claim this file was
 *    written to stop being unmeasured.** Measured on PostgreSQL 16.13 and MySQL
 *    8.0.46, through the driver's own write door:
 *
 *    ```
 *      dialect   rating <- 4.5              rating <- 4.4      column
 *      pg        REFUSED  22P02             REFUSED  22P02     integer
 *      mysql     ACCEPTED, stored 5         ACCEPTED, stored 4 int
 *      sqlite    ACCEPTED, stored REAL 4.5  (no integer door)  integer
 *    ```
 *
 *    MySQL rounds half-away-from-zero into an INTEGER column and — measured —
 *    `SHOW WARNINGS` comes back EMPTY for it in strict mode: not a Note, not a
 *    truncation warning, nothing. (The `Note 1265 Data truncated` MySQL does
 *    raise is for an over-scale DECIMAL, a different statement.) So on this
 *    dialect the refusal `rating` gains on PostgreSQL is a SILENT ROUNDING
 *    instead — the class this table was chosen to end (#7501), surviving in the
 *    one place the table cannot reach. Stated in the changeset, pinned here,
 *    and ⛔ never again asserted as "refused on PostgreSQL and MySQL".
 *
 * 4. **The scope bound.** The read coercion runs on every dialect since #16318,
 *    over `numericRepairFieldsFor` — the spec class alone off SQLite. An
 *    EXTERNAL/introspected `bigint` under a driver-alias field (`integer` /
 *    `int` / `float`) is a column this table does not decide and the ruling
 *    excluded (「不考虑现有数据」), and node-postgres hands it back as a STRING:
 *    `Number()`-ing it would round it above 2^53. Pinned as the discriminating
 *    PG cell, with the platform's own numeric column in the SAME ROW as the
 *    control.
 *
 * Every live cell is a NAMED skip without its URL and a red under
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1`, through `declareDialectCell`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  NUMERIC_COLUMN_PRECISION,
  NUMERIC_COLUMN_SCALE,
  NUMERIC_VALUE_TYPES,
  numericColumnFor,
} from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'NUMERIC column representation (#16318)';

const TABLE = 'os16318_numeric';
const EXT_TABLE = 'os16318_legacy_wide';

const NUMERIC_TYPES = [...NUMERIC_VALUE_TYPES].sort();

/** 2^53 + 1 — the smallest integer a JS double cannot represent. */
const BEYOND_DOUBLE = '9007199254740993';

/**
 * What each dialect does with a FRACTIONAL value written to `rating`'s column.
 * Measured, not assumed — see the head note; `sqlite` has no integer door at
 * all and `pg` is the only one that refuses.
 */
const FRACTIONAL_RATING: Record<string, { refuses: boolean; stored?: number }> = {
  pg: { refuses: true },
  mysql: { refuses: false, stored: 5 },
  sqlite: { refuses: false, stored: 4.5 },
};

class Probe extends SqlDriver {
  /** `information_schema` on the server dialects, `PRAGMA` on SQLite. */
  public async columnFacts(
    table: string,
  ): Promise<Map<string, { type: string; precision: number | null; scale: number | null }>> {
    if (this.isSqlite) {
      const rows = (await this.knex.raw(`PRAGMA table_info("${table}")`)) as Array<{ name: string; type: string }>;
      return new Map(rows.map((r) => [r.name, { type: r.type.toLowerCase(), precision: null, scale: null }]));
    }
    const raw = await this.knex.raw(
      `select column_name, data_type, numeric_precision, numeric_scale
         from information_schema.columns
        where table_name = ? and table_schema = ${this.isMysql ? 'database()' : 'current_schema()'}`,
      [table],
    );
    const rows: any[] = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : ((raw as any)?.rows ?? raw);
    return new Map(
      rows.map((r) => [
        String(r.column_name ?? r.COLUMN_NAME),
        {
          type: String(r.data_type ?? r.DATA_TYPE).toLowerCase(),
          precision: r.numeric_precision ?? r.NUMERIC_PRECISION ?? null,
          scale: r.numeric_scale ?? r.NUMERIC_SCALE ?? null,
        },
      ]),
    );
  }

  /** A raw read, so a stored value is never read back through the coercion. */
  public async rawColumn(table: string, column: string, id: string): Promise<unknown> {
    const raw = await this.knex.raw(`select ${column} as v from ${table} where id = ?`, [id]);
    const rows: any[] = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : ((raw as any)?.rows ?? raw);
    return rows?.[0]?.v ?? rows?.[0]?.V;
  }

  public async warnings(): Promise<unknown[]> {
    if (!this.isMysql) return [];
    const raw = await this.knex.raw('show warnings');
    return (Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : ((raw as any)?.rows ?? raw)) as unknown[];
  }
}

function objectShape(): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    id: { type: 'text', label: 'Id' },
    note: { type: 'text', label: 'Note' },
  };
  for (const t of NUMERIC_TYPES) fields[`f_${t}`] = { type: t, label: t };
  return { name: TABLE, label: 'Numeric zoo', fields };
}

function declareSuite(cell: DialectCell): void {
  describe(`${MATRIX} — ${cell.label}`, () => {
    let driver: Probe;

    beforeEach(async () => {
      driver = new Probe(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([objectShape() as never]);
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.execute(`drop table if exists ${EXT_TABLE}`).catch(() => {});
      await driver.disconnect();
    });

    it('gives every member the column `packages/spec` states, read back out of the catalog', async () => {
      const facts = await driver.columnFacts(TABLE);
      // Non-vacuity: an empty catalog read would pass every loop below.
      expect(NUMERIC_TYPES.length).toBeGreaterThanOrEqual(7);
      expect(facts.size).toBeGreaterThan(NUMERIC_TYPES.length);

      for (const t of NUMERIC_TYPES) {
        const answer = numericColumnFor(t);
        expect(answer, t).toBeDefined();
        const fact = facts.get(`f_${t}`);
        expect(fact, `f_${t} must exist in the catalog`).toBeDefined();

        if (answer!.kind === 'integer') {
          expect(fact!.type, t).toMatch(/^int(eger)?$/);
          continue;
        }
        if (cell.id === 'sqlite') {
          // knex compiles decimal(p,s) to the literal `float` here; SQLite
          // applies neither precision nor scale. Stated, not asserted away.
          expect(fact!.type, t).toBe('float');
          continue;
        }
        expect(fact!.type, t).toMatch(/^(numeric|decimal)$/);
        // ⛔ The constants, never a literal: a drift between the spec table and
        // the server must fail here rather than pass against a copy.
        expect(Number(fact!.precision), `${t} precision`).toBe(NUMERIC_COLUMN_PRECISION);
        expect(Number(fact!.scale), `${t} scale`).toBe(NUMERIC_COLUMN_SCALE);
      }

      // CONTROL, in the same read: a text column carries no numeric facts, so
      // "precision 65" above is a discriminating reading and not a constant the
      // catalog hands out for everything.
      const note = facts.get('note');
      expect(note, 'the control column must exist').toBeDefined();
      expect(note!.type, 'control').not.toMatch(/^(numeric|decimal|float)$/);
      if (cell.id !== 'sqlite') expect(note!.precision, 'control precision').toBeNull();
    });

    it('reads every member back as a JS number — the seam node-postgres and mysql2 break', async () => {
      const written: Record<string, number> = {};
      for (const t of NUMERIC_TYPES) written[`f_${t}`] = t === 'rating' ? 4 : 1234567.89;
      await driver.create(TABLE, { id: 'r1', note: 'ctl', ...written });

      const [back] = await driver.find(TABLE, { filters: ['id', '=', 'r1'] } as never);
      for (const [k, v] of Object.entries(written)) {
        expect(typeof back[k], `${k} must be a number, not the string the dialect returns`).toBe('number');
        expect(back[k], k).toBe(v);
      }
      // CONTROL: the pass converts numeric fields and nothing else — a declared
      // text field beside them is still a string.
      expect(typeof back.note, 'control').toBe('string');
    });

    it('does what this dialect really does with a FRACTIONAL rating — refuse (pg) or silently round (mysql)', async () => {
      const expected = FRACTIONAL_RATING[cell.id];
      expect(expected, `no measured expectation for ${cell.id}`).toBeDefined();

      let refused = false;
      try {
        await driver.create(TABLE, { id: 'frac', note: 'frac', f_rating: 4.5 });
      } catch {
        refused = true;
      }
      expect(refused, `${cell.label}: fractional rating refusal`).toBe(expected.refuses);

      if (!expected.refuses) {
        expect(await driver.rawColumn(TABLE, 'f_rating', 'frac'), `${cell.label}: stored rating`).toBe(
          expected.stored,
        );
        if (cell.id === 'mysql') {
          // ⭐ The finding: the rounding is not merely un-refused, it is UNWARNED.
          // If a future MySQL raises a Note here, this red is the good news.
          expect(await driver.warnings(), 'mysql raised no warning for the rounding').toEqual([]);
        }
      }

      // CONTROL: an INTEGRAL rating is accepted on every dialect, so the leg
      // above is about fractionality and not about the column being unusable.
      await driver.create(TABLE, { id: 'whole', note: 'whole', f_rating: 5 });
      expect(await driver.rawColumn(TABLE, 'f_rating', 'whole')).toBe(5);
    });

    it('leaves a pre-existing WIDE integer column under a driver-alias field alone (the "new tables only" bound)', async () => {
      const wide = cell.id === 'sqlite' ? 'integer' : 'bigint';
      const exact =
        cell.id === 'sqlite'
          ? 'float'
          : `${cell.id === 'mysql' ? 'decimal' : 'numeric'}(${NUMERIC_COLUMN_PRECISION},${NUMERIC_COLUMN_SCALE})`;
      await driver.execute(`drop table if exists ${EXT_TABLE}`).catch(() => {});
      await driver.execute(
        `create table ${EXT_TABLE} (id varchar(255), legacy_count ${wide}, amount ${exact})`,
      );
      await driver.execute(
        `insert into ${EXT_TABLE} (id, legacy_count, amount) values ('w1', ${BEYOND_DOUBLE}, 1.5)`,
      );
      // `integer` is a DRIVER ALIAS, not a FieldType — the class this table has
      // no opinion about. The schema sync is additive, so the pre-existing
      // column keeps its own type.
      await driver.initObjects([
        {
          name: EXT_TABLE,
          label: 'Legacy wide',
          fields: {
            id: { type: 'text', label: 'Id' },
            legacy_count: { type: 'integer', label: 'Legacy' },
            amount: { type: 'number', label: 'Amount' },
          },
        } as never,
      ]);

      const [row] = await driver.find(EXT_TABLE, { filters: ['id', '=', 'w1'] } as never);

      // The CONTROL first, in the same row: the spec-class column IS coerced,
      // so an unchanged `legacy_count` is a scope reading and not a dead pass.
      expect(typeof row.amount, 'the spec class is still coerced').toBe('number');
      expect(row.amount).toBe(1.5);

      if (cell.id === 'pg') {
        // ⭐ The discriminating leg. node-postgres returns `int8` as a STRING;
        // an unscoped pass would `Number()` it to 9007199254740992 — a silent
        // rounding of a column this change does not decide.
        expect(typeof row.legacy_count, 'an external bigint must not be coerced on pg').toBe('string');
        expect(row.legacy_count).toBe(BEYOND_DOUBLE);
      } else if (cell.id === 'mysql') {
        // mysql2 parses BIGINT to a JS number BEFORE the driver sees it, so
        // this dialect cannot discriminate — the loss here is the connector's
        // and predates this change. Asserted as "not made into a string, and
        // not touched by us"; pg is the leg that decides.
        expect(typeof row.legacy_count).toBe('number');
      } else {
        // SQLite keeps the WIDER list (the legacy TEXT-affinity repair): the
        // alias fields are still repaired there, which is the half that must
        // not regress.
        expect(typeof row.legacy_count).toBe('number');
      }
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareSuite);
}
