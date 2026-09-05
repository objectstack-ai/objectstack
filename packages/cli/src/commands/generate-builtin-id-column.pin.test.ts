// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE #15040 PIN: the `id` column both migration generators emit is the column
 * `driver-sql` actually creates.
 *
 * ## The defect
 *
 * `generate.ts` hardcodes the table's own primary key in each of its two
 * migration generators, and both said `uuid`:
 *
 * ```
 * generateMigrationSql   '  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),'
 * generateMigrationTs    "    table.uuid('id').primary().defaultTo(db.fn.uuid());"
 * ```
 *
 * The platform emits `table.string('id').primary()` — knex's `varchar(255)`,
 * `SqlDriver.DEFAULT_STRING_VARCHAR_CHARS`. A platform id is not a uuid, so on
 * Postgres the generated table refuses the platform's first insert outright
 * with `22P02 invalid input syntax for type uuid`.
 *
 * ⭐ The `DEFAULT gen_random_uuid()` half is the one this pin is really for,
 * because it is the half that is NOT loud. The driver emits no database-side
 * default at all: its insert path always supplies the id itself (`create()`
 * takes `_id`, else a caller-supplied `id`, else mints one). So the default
 * never fires for a platform write and only ever fires for an out-of-band one —
 * handing that row a 36-character uuid this platform's generator would never
 * mint, leaving one table holding two incompatible id shapes, silently.
 *
 * ## Why the pin reads the driver instead of asserting `varchar(255)`
 *
 * The whole shape of this card is "the generator disagrees with the driver". A
 * pin that transcribed `VARCHAR(255)` would re-create that defect one layer up:
 * the day the driver's id column moves, the generator would be wrong again and
 * this file would still be green. So the width is READ from
 * `DEFAULT_STRING_VARCHAR_CHARS` where it is declared, and the typescript
 * generator's line is compared against the driver's own call, byte for byte.
 * Both extractions carry a non-vacuity control — a source reader that matched
 * nothing would pass while measuring nothing.
 *
 * This is the same authority `generate-field-type-vocabulary.pin.test.ts`
 * already reads for the REFERENCE_VALUE_TYPES width, and for the same reason: a
 * reference column holds the TARGET's id, so both questions have one answer.
 * That pin covers the FIELDS; this one covers the builtin column itself, which
 * is not a vocabulary entry and so had no rule anywhere.
 *
 * ## The audit-stamp columns: one half ruled (#15521), one half still recorded
 *
 * #15040 measured a THIRD disagreement in the same pass and recorded it here
 * without correcting it. #15521 split that record in two and ruled only the
 * half that was decidable:
 *
 *   TYPE — RULED. The sql format spelled both columns bare `TIMESTAMP`
 *   (`timestamp WITHOUT time zone`) while the driver and the typescript format
 *   both build them with knex's `table.timestamp` = `timestamptz`. Driven on a
 *   live PostgreSQL 16.13: two defaulted rows inserted 6 ms apart under
 *   different session timezones landed NINE HOURS apart in the zone-naive
 *   column and 3 ms apart in the aware one. One producer of three was wrong and
 *   nothing had to be decided, so the sql format moved.
 *
 *   NULLABILITY (and the `now()` / `CURRENT_TIMESTAMP` default spelling) —
 *   STILL RECORDED, still not ruled: the driver leaves both columns nullable
 *   and both generators say NOT NULL. Nothing fails either way, so which side
 *   moves is a ruling #15521 holds open.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateMigrationSql, generateMigrationTs } from './generate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GENERATE_TS = path.resolve(HERE, 'generate.ts');
const GENERATE_SOURCE = fs.readFileSync(GENERATE_TS, 'utf8');

/** The authority, read where it lives — never transcribed here. */
const DRIVER_SQL_SRC = path.resolve(HERE, '../../../drivers/driver-sql/src');
const SQL_DRIVER_SOURCE = fs.readFileSync(path.join(DRIVER_SQL_SRC, 'sql-driver.ts'), 'utf8');

/** The one line the driver emits for a managed table's primary key. */
const DRIVER_ID_COLUMN = "table.string('id').primary();";

/** `varchar(n)` for a bare `table.string(name)`, read off the driver's constant. */
function driverDefaultVarcharChars(): number {
  const m = SQL_DRIVER_SOURCE.match(/DEFAULT_STRING_VARCHAR_CHARS = (\d+);/);
  if (!m) {
    throw new Error(
      'DEFAULT_STRING_VARCHAR_CHARS not found in sql-driver.ts. That constant is the width this ' +
      'pin reads instead of transcribing, so a rename must fail loudly here rather than leave ' +
      'the generators unmeasured.',
    );
  }
  return Number(m[1]);
}

const CONFIG = {
  objects: {
    account: {
      name: 'account',
      fields: { title: { type: 'text' }, owner: { type: 'lookup' } },
    },
  },
};

/** The `id` line `os generate migration --format sql` emits. */
function emittedSqlIdLine(): string {
  const lines = generateMigrationSql(CONFIG as Record<string, unknown>).split('\n');
  const found = lines.filter((l) => /^\s*"id"\s/.test(l));
  expect(found, 'the sql generator emitted no id column at all — the reader is broken').toHaveLength(1);
  return found[0].trim();
}

/** The `id` line `os generate migration` (typescript, the DEFAULT format) emits. */
function emittedTsIdLine(): string {
  const lines = generateMigrationTs(CONFIG as Record<string, unknown>).split('\n');
  const found = lines.filter((l) => /table\.\w+\('id'\)/.test(l));
  expect(found, 'the typescript generator emitted no id column at all — the reader is broken').toHaveLength(1);
  return found[0].trim();
}

describe('the builtin id column both migration generators emit (#15040)', () => {
  it('reads a real driver source that still owns the id column (control)', () => {
    // Non-vacuity for both extractions below.
    expect(SQL_DRIVER_SOURCE.length).toBeGreaterThan(10_000);
    expect(
      SQL_DRIVER_SOURCE,
      'driver-sql no longer emits `table.string(\'id\').primary()`. This pin corrects the ' +
      'generators TOWARD the driver, so if the driver moved, re-read #15040 before touching ' +
      'generate.ts — the authority is the driver, not this file.',
    ).toContain(DRIVER_ID_COLUMN);
    expect(driverDefaultVarcharChars()).toBeGreaterThan(0);
  });

  it('the typescript generator emits the driver\'s own line, byte for byte', () => {
    expect(emittedTsIdLine()).toBe(DRIVER_ID_COLUMN);
  });

  it('the sql generator emits the driver\'s width, read from the driver', () => {
    expect(emittedSqlIdLine()).toBe(`"id" VARCHAR(${driverDefaultVarcharChars()}) PRIMARY KEY,`);
  });

  it('neither generator gives the id a uuid type', () => {
    // The loud half: a platform id is not a uuid, and Postgres says so with
    // `22P02 invalid input syntax for type uuid` on the first insert.
    expect(emittedSqlIdLine()).not.toMatch(/\bUUID\b/i);
    expect(emittedTsIdLine()).not.toMatch(/table\.uuid\(/);
    // Anti-vacuity: the predicates really do fire on the shapes this replaced.
    expect('"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),').toMatch(/\bUUID\b/i);
    expect("table.uuid('id').primary().defaultTo(db.fn.uuid());").toMatch(/table\.uuid\(/);
  });

  it('neither generator gives the id a database-side default', () => {
    // The quiet half, and the reason this is p2 rather than p3. The driver
    // emits no default because `create()` always supplies an id; a default
    // therefore only ever fires for an out-of-band insert, and mints an id
    // shape the platform never would.
    expect(emittedSqlIdLine()).not.toMatch(/\bDEFAULT\b/i);
    expect(emittedTsIdLine()).not.toMatch(/defaultTo\(/);
    // The driver's own id line carries no default either — read, not assumed.
    expect(DRIVER_ID_COLUMN).not.toMatch(/defaultTo\(/);
    // Anti-vacuity: both predicates fire on what was there before.
    expect('"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),').toMatch(/\bDEFAULT\b/i);
    expect("table.uuid('id').primary().defaultTo(db.fn.uuid());").toMatch(/defaultTo\(/);
  });

  it('the id column is still emitted by BOTH generators, in each table', () => {
    // The correction must not be mistaken for a deletion: the primary key is
    // still there, and still first.
    const sql = generateMigrationSql(CONFIG as Record<string, unknown>);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "account" (');
    expect(sql.indexOf('"id"')).toBeLessThan(sql.indexOf('"title"'));
    const ts = generateMigrationTs(CONFIG as Record<string, unknown>);
    expect(ts).toContain("await db.schema.createTable('account'");
    expect(ts.indexOf("table.string('id')")).toBeLessThan(ts.indexOf("table.string('title')"));
    // Each generator carries exactly ONE hardcoded id line — the shape that let
    // these two disagree with the driver in the first place, and the reason a
    // fix to one of them can silently leave the other behind. Counted over the
    // source so a third copy cannot arrive unmeasured; the literals are the
    // emitted lines themselves, so this cannot drift from what is asserted above.
    for (const line of [emittedSqlIdLine(), emittedTsIdLine()]) {
      expect(GENERATE_SOURCE.split(line), `generate.ts emits \`${line}\` from more than one place`)
        .toHaveLength(2);
    }
  });

  // ── #15521, the TYPE half: ruled, and now asserted as agreement ────────
  //
  // Bare `TIMESTAMP` is `timestamp WITHOUT time zone`. Both knex producers of
  // these same two columns — `driver-sql`'s `createAuditTimestampColumn` and
  // `generateMigrationTs`'s `table.timestamps(true, true)` — yield
  // `timestamptz`. Read back out of `information_schema.columns` on a live
  // PostgreSQL 16.13, all three producers driven:
  //
  //   driver   created_at  timestamp with time zone     null=YES  default=CURRENT_TIMESTAMP
  //   ts gen   created_at  timestamp with time zone     null=NO   default=CURRENT_TIMESTAMP
  //   sql gen  created_at  timestamp without time zone  null=NO   default=now()
  //
  // Asserted as AGREEMENT with the driver rather than as the literal
  // `TIMESTAMPTZ` alone: the driver's builder is read where it lives, so the day
  // it stops emitting a knex `table.timestamp` this fails here instead of
  // leaving the generators quietly wrong again — the same discipline the id
  // column above already uses for its width.
  it('#15521 — the audit columns take the driver\'s zone-AWARE type in both generators', () => {
    const sql = generateMigrationSql(CONFIG as Record<string, unknown>);
    for (const col of ['created_at', 'updated_at']) {
      expect(sql).toContain(`"${col}" TIMESTAMPTZ NOT NULL DEFAULT now()`);
      // `\b` discriminates: `TIMESTAMPTZ` is not a match for `TIMESTAMP\b`.
      expect(
        sql,
        `the sql format spells ${col} zone-NAIVE again — a defaulted row then records the ` +
        'wall clock of whatever session wrote it, with nothing left to recover the offset from',
      ).not.toMatch(new RegExp(`"${col}" TIMESTAMP\\b`));
    }
    // Anti-vacuity: the predicate really does fire on the shape this replaced.
    expect('  "created_at" TIMESTAMP NOT NULL DEFAULT now()').toMatch(/"created_at" TIMESTAMP\b/);
    // The authority, read where it lives — both knex paths, neither transcribed.
    expect(
      SQL_DRIVER_SOURCE,
      'driver-sql no longer builds the audit columns with knex\'s `table.timestamp`, which is ' +
      'what makes them `timestamptz` on Postgres. Re-read #15521 before trusting the ' +
      'generators\' TIMESTAMPTZ.',
    ).toContain('table.timestamp(name).defaultTo(this.knex.fn.now());');
    expect(generateMigrationTs(CONFIG as Record<string, unknown>)).toContain('table.timestamps(true, true);');
  });

  // ── #15521, the NULLABILITY half: recorded, NOT coverage, and NOT a ruling ──
  //
  // The driver leaves both columns nullable; both generators say NOT NULL:
  //
  //   driver-sql   `table.timestamp(name).defaultTo(knex.fn.now())`   (nullable)
  //   sql gen      `"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()`
  //   ts gen       `table.timestamps(true, true)` — knex 3.3.0 compiles this to
  //                `.notNullable().defaultTo(CURRENT_TIMESTAMP)` on both columns
  //                (`knex/lib/schema/tablebuilder.js`), which the live-Postgres
  //                catalog read above confirms as `null=NO`.
  //
  // Unlike the type half this is not a wrong value: the driver stamps both
  // columns on every write, so NOT NULL is arguably the truer constraint, and
  // the driver's own audit DDL is dialect-branched (`datetime(3)` on MySQL, a
  // canonical ISO default on SQLite) in a way a Postgres-flavoured generated
  // migration does not try to reproduce — so "match the driver byte for byte"
  // is not even well-defined across dialects. Which side moves is #15521's to
  // decide; nothing here changes those lines.
  //
  // The DEFAULT spelling rides with it: this generator's `now()` and the
  // driver's `CURRENT_TIMESTAMP` are the same instant (both are
  // `transaction_timestamp()`), but Postgres keeps them textually apart in the
  // catalog, so they are two rows of the same schema-diff noise.
  it('#15521 record — the audit columns\' NULLABILITY diverges, deliberately unresolved', () => {
    const sql = generateMigrationSql(CONFIG as Record<string, unknown>);
    expect(sql).toContain('"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(sql).toContain('"updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(generateMigrationTs(CONFIG as Record<string, unknown>)).toContain('table.timestamps(true, true);');
    // The driver side, read where it lives: one audit-column builder, and its
    // default arm carries no `.notNullable()`.
    expect(
      SQL_DRIVER_SOURCE,
      'driver-sql\'s audit-column DDL moved — re-read the #15521 record above before trusting it.',
    ).toContain('table.timestamp(name).defaultTo(this.knex.fn.now());');
    const auditArm = SQL_DRIVER_SOURCE.slice(
      SQL_DRIVER_SOURCE.indexOf('protected createAuditTimestampColumn('),
    ).slice(0, 600);
    expect(auditArm.length).toBeGreaterThan(100);
    expect(auditArm).not.toContain('notNullable()');
  });
});
