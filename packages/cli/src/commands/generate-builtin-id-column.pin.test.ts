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
 * ## ⚠️ Recorded divergence, NOT a ruling: the audit-stamp columns (#15040)
 *
 * The last `it` below records — and deliberately does not correct — a THIRD
 * disagreement measured in the same pass. It is recorded so it cannot change
 * shape unnoticed, and so no reader mistakes this file for having decided it.
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

  // ── Recorded divergence, NOT coverage, and NOT a ruling ──────────────────
  //
  // Measured in the same pass as the id column, on the same two generators.
  // The audit-stamp columns disagree with the driver too, in a way the id
  // column did not, and the disagreement is NULLABILITY rather than type:
  //
  //   driver-sql   `table.timestamp(name).defaultTo(knex.fn.now())`  (nullable)
  //   sql gen      `"created_at" TIMESTAMP NOT NULL DEFAULT now()`
  //   ts gen       `table.timestamps(true, true)` — knex 3.3.0 compiles this
  //                to `.notNullable().defaultTo(CURRENT_TIMESTAMP)` on both
  //                columns (`knex/lib/schema/tablebuilder.js`).
  //
  // Compiled offline against knex's pg dialect, the two shapes are:
  //
  //   driver  "created_at" timestamptz default CURRENT_TIMESTAMP
  //   ts gen  "created_at" timestamptz not null default CURRENT_TIMESTAMP
  //
  // Unlike the id column this is not obviously a wrong value: the driver stamps
  // both columns on every write, so NOT NULL is arguably the truer constraint —
  // and the driver's own DDL is dialect-branched (`datetime(3)` on MySQL, a
  // canonical ISO default on SQLite) in a way a Postgres-flavoured generated
  // migration does not try to reproduce. Which side moves is not this card's to
  // decide, so nothing here changes those lines. Asserted only so the
  // divergence cannot change shape unnoticed.
  it('#15040 record — the audit-stamp columns diverge from the driver, deliberately unresolved', () => {
    const sql = generateMigrationSql(CONFIG as Record<string, unknown>);
    expect(sql).toContain('"created_at" TIMESTAMP NOT NULL DEFAULT now()');
    expect(sql).toContain('"updated_at" TIMESTAMP NOT NULL DEFAULT now()');
    expect(generateMigrationTs(CONFIG as Record<string, unknown>)).toContain('table.timestamps(true, true);');
    // The driver side, read where it lives: one audit-column builder, and its
    // default arm carries no `.notNullable()`.
    expect(
      SQL_DRIVER_SOURCE,
      'driver-sql\'s audit-column DDL moved — re-read the #15040 record above before trusting it.',
    ).toContain('table.timestamp(name).defaultTo(this.knex.fn.now());');
    const auditArm = SQL_DRIVER_SOURCE.slice(
      SQL_DRIVER_SOURCE.indexOf('protected createAuditTimestampColumn('),
    ).slice(0, 600);
    expect(auditArm.length).toBeGreaterThan(100);
    expect(auditArm).not.toContain('notNullable()');
  });
});
