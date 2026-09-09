// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE #16318 PIN: the NUMERIC column both migration generators emit is the
 * numeric column `driver-sql` actually creates, and both read it from the one
 * table `packages/spec` states.
 *
 * ## The defect
 *
 * One object, seven plain numeric declarations, three producers, driven into
 * live PostgreSQL 16.13 and read back out of `information_schema.columns` with
 * `numeric_precision` / `numeric_scale` — the half a bare `data_type` read
 * hides:
 *
 * ```
 *              driver    sql gen         ts gen
 * number       real      numeric(18,2)   numeric(8,2)
 * currency     real      numeric(18,2)   numeric(8,2)
 * percent      real      numeric(5,2)    numeric(8,2)
 * slider       real      numeric(18,2)   numeric(8,2)
 * summary      real      numeric(18,2)   numeric(8,2)
 * progress     real      numeric(5,2)    numeric(8,2)
 * rating       real      integer         integer
 * ```
 *
 * 7 of 7 diverged, and six of them THREE ways rather than the two the report
 * named — `table.decimal(name)` with no arguments is knex's `decimal(8, 2)`, so
 * the two halves of one command never agreed with each other either. A control
 * family already unified (#16091: `text` / `email` / `boolean` / `date`) came
 * back 0-of-4 divergent in the same run, so AGREE is a reading the instrument
 * can produce. After the repair the same command reports 0 of 7.
 *
 * ## Why this pin reads the spec instead of asserting the numbers
 *
 * The same reason `generate-string-family-width.pin.test.ts` gives for the
 * character widths: the whole shape of this card is "the producers disagree",
 * so a pin that transcribed `DECIMAL(65,30)` would re-create the defect one
 * layer up and stay green on the day the table moves. Every expectation here is
 * derived from `numericColumnFor`, and the membership of the family from
 * `NUMERIC_VALUE_TYPES` — neither is listed in this file.
 *
 * ## The oracle
 *
 * `SqlDriver.initObjects` on an in-memory better-sqlite3 database, read back
 * with `PRAGMA table_info`, exactly as the #16091 pin does it: it runs the real
 * `createColumn` chain and reports the column that actually exists. ⚠️ SQLite
 * is where the oracle can run in a unit test, and SQLite applies no precision
 * and no scale — `ColumnCompiler_SQLite3.prototype.decimal` is the literal
 * `'float'`. So the oracle answers the question SQLite can answer (which ARM
 * each type takes: the exact-decimal one or the integer one) and the PostgreSQL
 * precision/scale claim is carried by the spec-side equality below plus the
 * live run recorded in the PR. ⛔ Do not read the oracle as a precision check.
 *
 * ## The nullability half (ADR-0113, #16294 cause 1)
 *
 * `SqlDriver.createColumn` emits the physical NOT NULL from `storage.notNull`
 * and deliberately not from `required` — its own arm records why: binding the
 * DDL to `required` made every post-deploy tightening a destructive migration.
 * Both generators were still on `required`. Driven on live PostgreSQL 16.13
 * after the repair, four declaration shapes through all three producers:
 * `required` alone is NULLABLE on all three, `storage.notNull` is NOT NULL on
 * all three, 0 of 4 diverge, and the probe still distinguishes the two verdicts.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { SqlDriver } from '@objectstack/driver-sql';
import {
  NUMERIC_VALUE_TYPES,
  numericColumnFor,
  type NumericColumnRepresentation,
} from '@objectstack/spec/data';

import { generateMigrationSql, generateMigrationTs } from './generate.js';

const NUMERIC_TYPES = [...NUMERIC_VALUE_TYPES].sort();

/**
 * ⭐ THE REAL CHAIN, widened exactly as `generate-string-family-width.pin.test`
 * widens it: `protected` is a compile-time visibility rule, so a subclass can
 * publish the driver's own `knex` without copying a character of its logic.
 * `initObjects` dispatches every field through `createColumn` and hands the
 * result to knex; `PRAGMA table_info` reports the column that then exists.
 */
class DriverOracle extends SqlDriver {
  public async createdColumns(object: { name: string; fields?: Record<string, unknown> }): Promise<Map<string, string>> {
    await this.initObjects([object as never]);
    const rows = (await this.knex.raw(`PRAGMA table_info("${object.name}")`)) as Array<{
      name: string;
      type: string;
    }>;
    return new Map(rows.map((row) => [row.name, row.type]));
  }
}

const ORACLE = new DriverOracle({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
});

afterAll(async () => {
  await ORACLE.disconnect();
});

/** The answer this file is allowed to expect — resolved, never transcribed. */
function stated(type: string): NumericColumnRepresentation {
  const answer = numericColumnFor(type);
  if (!answer) throw new Error(`packages/spec states no column for the numeric type '${type}'`);
  return answer;
}

function objectOf(types: readonly string[]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const t of types) fields[`f_${t}`] = { type: t };
  return { name: 'num_zoo', fields };
}

describe('#16318 — both migration formats emit the stated numeric column', () => {
  it('the family is non-empty and this file did not invent its membership', () => {
    // Non-vacuity: every assertion below loops over NUMERIC_TYPES, so an empty
    // set would pass every one of them while measuring nothing.
    expect(NUMERIC_TYPES.length).toBeGreaterThanOrEqual(7);
    expect(NUMERIC_TYPES).toContain('currency');
    expect(NUMERIC_TYPES).toContain('rating');
  });

  it('the sql format emits the stated column for every member', () => {
    const sql = generateMigrationSql({ objects: { num_zoo: objectOf(NUMERIC_TYPES) } });
    for (const type of NUMERIC_TYPES) {
      const answer = stated(type);
      const expected =
        answer.kind === 'integer' ? 'INTEGER' : `DECIMAL(${answer.precision},${answer.scale})`;
      expect(sql, type).toContain(`"f_${type}" ${expected}`);
    }
    // The two shapes this card removed must be gone from the whole emission,
    // not merely absent from the rows above.
    expect(sql).not.toContain('DECIMAL(18,2)');
    expect(sql).not.toContain('DECIMAL(5,2)');
  });

  it('the typescript format emits the stated column for every member', () => {
    const ts = generateMigrationTs({ objects: { num_zoo: objectOf(NUMERIC_TYPES) } });
    for (const type of NUMERIC_TYPES) {
      const answer = stated(type);
      const expected =
        answer.kind === 'integer'
          ? `table.integer('f_${type}')`
          : `table.decimal('f_${type}', ${answer.precision}, ${answer.scale})`;
      expect(ts, type).toContain(expected);
    }
    // Knex's argument-less `decimal` is `decimal(8, 2)` — the third answer in
    // the divergence, and the one no reader of this file would guess.
    expect(ts).not.toMatch(/table\.decimal\('f_[a-z]+'\)/);
  });

  it('the two formats agree with each other on every member', () => {
    const sql = generateMigrationSql({ objects: { num_zoo: objectOf(NUMERIC_TYPES) } });
    const ts = generateMigrationTs({ objects: { num_zoo: objectOf(NUMERIC_TYPES) } });
    for (const type of NUMERIC_TYPES) {
      const answer = stated(type);
      if (answer.kind === 'integer') {
        expect(sql, type).toContain(`"f_${type}" INTEGER`);
        expect(ts, type).toContain(`table.integer('f_${type}')`);
      } else {
        expect(sql, type).toContain(`"f_${type}" DECIMAL(${answer.precision},${answer.scale})`);
        expect(ts, type).toContain(`table.decimal('f_${type}', ${answer.precision}, ${answer.scale})`);
      }
    }
  });

  /**
   * The ORACLE. Which ARM the driver puts each type in — the only half of the
   * claim SQLite can carry, see the docblock.
   */
  it('the driver puts every member in the arm the spec states', async () => {
    const byName = await ORACLE.createdColumns(objectOf(NUMERIC_TYPES) as never);

    // Non-vacuity: the read must have found the columns at all.
    for (const type of NUMERIC_TYPES) expect(byName.has(`f_${type}`), `f_${type} missing`).toBe(true);

    for (const type of NUMERIC_TYPES) {
      const answer = stated(type);
      // knex compiles BOTH `decimal(p, s)` and `float` to the literal `float`
      // on SQLite, which is exactly the measurement that makes this move
      // affinity-neutral for the six exact-decimal members.
      expect(byName.get(`f_${type}`)?.toLowerCase(), type).toBe(
        answer.kind === 'integer' ? 'integer' : 'float',
      );
    }
    // The discriminating control: the two arms must not have collapsed into
    // one, or "the driver agrees" would be a constant rather than a reading.
    expect(new Set(NUMERIC_TYPES.map((t) => byName.get(`f_${t}`)?.toLowerCase())).size).toBe(2);
  });
});

describe('#16318 / ADR-0113 — both formats take NOT NULL from `storage.notNull`', () => {
  const FIELDS = {
    f_required_only: { type: 'text', required: true },
    f_storage_only: { type: 'text', storage: { notNull: true } },
    f_both: { type: 'text', required: true, storage: { notNull: true } },
    f_neither: { type: 'text' },
  };
  const config = { objects: { nn: { name: 'nn', fields: FIELDS } } };

  it('the sql format constrains exactly the columns the driver constrains', () => {
    const sql = generateMigrationSql(config);
    expect(sql).toContain('"f_storage_only" TEXT NOT NULL');
    expect(sql).toContain('"f_both" TEXT NOT NULL');
    // `required` alone is the WRITE-time contract; it must not reach the DDL.
    expect(sql).toMatch(/"f_required_only" TEXT(?! NOT NULL)/);
    expect(sql).toMatch(/"f_neither" TEXT(?! NOT NULL)/);
  });

  it('the typescript format constrains exactly the same columns', () => {
    const ts = generateMigrationTs(config);
    expect(ts).toContain(`table.text('f_storage_only').notNullable()`);
    expect(ts).toContain(`table.text('f_both').notNullable()`);
    expect(ts).toContain(`table.text('f_required_only').nullable()`);
    expect(ts).toContain(`table.text('f_neither').nullable()`);
  });

  it('the probe distinguishes its two verdicts', () => {
    // Without this the two tests above would pass against a generator that
    // emitted NOT NULL for everything, or for nothing.
    const ts = generateMigrationTs(config);
    expect(ts).toContain('.notNullable()');
    expect(ts).toContain('.nullable()');
  });
});
