// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11431 — the STRING family and its declared `maxLength`.
 *
 * ## The defect
 *
 * `createColumn` mapped `string` / `email` / `url` / `phone` / `password` with a
 * bare `table.string(name)`, so every one of them took knex's invented default
 * of 255 and the field's own `maxLength` was never read. Measured on the
 * pre-fix tree against live MySQL 8.0.46 and Postgres 16, through the driver's
 * own `initObjects`:
 *
 *   wide_email    email({ maxLength: 400  })  -> varchar(255)
 *   wide_url      url({   maxLength: 1024 })  -> varchar(255)
 *   narrow_phone  phone({ maxLength: 20   })  -> varchar(255)
 *
 * and a 300-character write into the `maxLength: 1024` column — legal under the
 * declaration, and accepted by the record validator's own `max_length` check —
 * was refused by both enforcing dialects: MySQL `ER_DATA_TOO_LONG`, Postgres
 * `22001 value too long for type character varying(255)`.
 *
 * The bound was inert in BOTH directions, which is why this file pins both.
 * `schema-drift.ts` has always treated `varchar(field.maxLength)` as the
 * expected physical shape, so before the fix a freshly created table reported
 * drift against itself — measured on that same table: two `widen_varchar`
 * (warning/safe) plus one `narrow_varchar` (error/**destructive**), on a table
 * with no rows in it.
 *
 * ## Why narrowing is pinned here and is NOT a destructive migration
 *
 * It reads like one, so it is worth stating with the mechanism: `createColumn`
 * has exactly four call sites, and every one of them is a `CREATE TABLE` or an
 * `ALTER TABLE ADD COLUMN` for a column that does not exist yet. The column it
 * sizes is always EMPTY. Narrowing an existing populated `varchar(255)` is a
 * different road entirely — the `narrow_varchar` drift op, category
 * `destructive`, behind `os migrate apply --allow-destructive` — and this
 * change does not touch it. `schema-drift.ts` is byte-identical.
 *
 * Opt-in for the live halves — they need real servers:
 *
 *   OS_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306/conformance \
 *   OS_TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
 *     pnpm --filter @objectstack/driver-sql test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { MYSQL_CELL, PG_CELL, dialectCell, declareDialectCell } from './live-dialect-matrix.testkit.js';

const T = 'os11431_strings';
const PARENT = 'os11431_parent';

/**
 * One table holding every corner of the decision at once, so a change to it
 * cannot be green in five places and wrong in the sixth.
 */
const stringObject = () => ({
  name: T,
  fields: {
    // ── the rule, both directions ──────────────────────────────
    wide_email: { type: 'email', maxLength: 400 },
    wide_url: { type: 'url', maxLength: 1024 },
    narrow_phone: { type: 'phone', maxLength: 20 },
    narrow_password: { type: 'password', maxLength: 60 },
    // ── no declaration → knex's 255, unchanged ─────────────────
    plain_email: { type: 'email' },
    // ── a malformed declaration is not a bound ─────────────────
    bogus_url: { type: 'url', maxLength: 0 },
    fractional_url: { type: 'url', maxLength: 12.5 },
    // ── past the varchar ceiling → TEXT, never a clamp ─────────
    huge_url: { type: 'url', maxLength: 100000 },
    // ── the three families deliberately left at 255 ────────────
    a_lookup: { type: 'lookup', maxLength: 20, reference: PARENT },
    a_user: { type: 'user', maxLength: 30 },
    an_autonumber: { type: 'autonumber', maxLength: 8 },
    a_secret: { type: 'secret', maxLength: 4000 },
    a_select: { type: 'select', maxLength: 4000, options: ['a', 'b'] },
  },
});

const parentObject = () => ({ name: PARENT, fields: { name: { type: 'text', maxLength: 64 } } });

/** `type(maxLength)` per column, normalised across the three dialects. */
async function columnShapes(driver: any, table: string): Promise<Record<string, string>> {
  const info: Record<string, any> = await driver.knex(table).columnInfo();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(info)) {
    const t = String((v as any)?.type ?? '').toLowerCase();
    const n = (v as any)?.maxLength;
    out[k] = /char/.test(t) && n ? `varchar(${n})` : t;
  }
  return out;
}

// ── The emission rule, on a dialect every runner has ───────────────────────

describe('string-family columns take their declared maxLength (#11431)', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  it('emits varchar(maxLength) in BOTH directions, and 255 without a declaration', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([parentObject(), stringObject()]);
    const shapes = await columnShapes(driver as any, T);

    // Wider than knex's default — the reported defect.
    expect(shapes.wide_email).toBe('varchar(400)');
    expect(shapes.wide_url).toBe('varchar(1024)');
    // Narrower — the same defect's other half. Empty column, nothing to truncate.
    expect(shapes.narrow_phone).toBe('varchar(20)');
    expect(shapes.narrow_password).toBe('varchar(60)');
    // Undeclared stays exactly where it was.
    expect(shapes.plain_email).toBe('varchar(255)');
  });

  it('treats a malformed maxLength as no declaration rather than guessing', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([parentObject(), stringObject()]);
    const shapes = await columnShapes(driver as any, T);
    // `varchar(0)` and `varchar(12.5)` are not DDL; neither is a bound.
    expect(shapes.bogus_url).toBe('varchar(255)');
    expect(shapes.fractional_url).toBe('varchar(255)');
  });

  it('falls back to TEXT past the varchar ceiling instead of clamping', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([parentObject(), stringObject()]);
    const shapes = await columnShapes(driver as any, T);
    // ⛔ NOT varchar(16383). Clamping would reinstate the very defect being
    // fixed — a column narrower than the declaration, refusing legal writes.
    expect(shapes.huge_url).toBe('text');
  });

  it('leaves lookup / user / autonumber / catch-all at 255 — they do not store the declared value', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([parentObject(), stringObject()]);
    const shapes = await columnShapes(driver as any, T);
    // A lookup holds the referenced row's ID, not the declared value: a
    // platform id is 26 characters, so `varchar(20)` could hold none of them.
    expect(shapes.a_lookup).toBe('varchar(255)');
    expect(shapes.a_user).toBe('varchar(255)');
    // Runtime-issued; `maxLength` has no write-time counterpart on this type.
    expect(shapes.an_autonumber).toBe('varchar(255)');
    // `secret` persists an opaque sys_secret ref; `select` a machine name.
    expect(shapes.a_secret).toBe('varchar(255)');
    expect(shapes.a_select).toBe('varchar(255)');
  });
});

// ── The halves only a length-ENFORCING server can measure ──────────────────

for (const cell of [MYSQL_CELL, PG_CELL]) {
  declareDialectCell(cell, 'string-family maxLength (#11431)', (c) => {
    describe(`string-family maxLength on ${c.label} (#11431)`, () => {
      let driver: SqlDriver;

      afterEach(async () => {
        for (const t of [T, PARENT]) await driver?.execute(`drop table if exists ${t}`).catch(() => {});
        await driver?.disconnect().catch(() => {});
      });

      it('accepts a write the declaration allows — the whole defect, in one assertion', async () => {
        driver = new SqlDriver(c.config());
        for (const t of [T, PARENT]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
        await driver.initObjects([parentObject(), stringObject()]);

        const shapes = await columnShapes(driver as any, T);
        expect(shapes.wide_url).toBe('varchar(1024)');
        expect(shapes.narrow_phone).toBe('varchar(20)');

        // Pre-fix this was REFUSED — `ER_DATA_TOO_LONG` on MySQL, `22001` on
        // Postgres — for a value the declaration plainly permits.
        await driver.create(T, { id: 'r1', wide_url: 'u'.repeat(300) });

        // Read the length back from the SERVER rather than through the
        // driver's deserializer: what is being asserted is that the column
        // really holds 300 characters, and `char_length` is the database's own
        // answer to that on both dialects.
        const res: any = await driver.execute(
          `select char_length(wide_url) as n from ${T} where id = 'r1'`,
        );
        const rows: any[] = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res?.rows ?? res);
        expect(Number(rows[0]?.n ?? rows[0]?.N)).toBe(300);
      });

      it('reports no varchar drift against a table it just created', async () => {
        driver = new SqlDriver(c.config());
        for (const t of [T, PARENT]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
        await driver.initObjects([parentObject(), stringObject()]);

        const drift: any[] = await (driver as any).detectTableDrift(T, stringObject().fields, []);
        const varcharDrift = drift.filter(
          (d) => d.op?.type === 'widen_varchar' || d.op?.type === 'narrow_varchar',
        );

        // The emitter and the differ finally agree about the string family.
        // Pre-fix this table reported two `widen_varchar` AND a
        // `narrow_varchar` (error/destructive) against itself, with no rows in
        // it. What remains is only the families this card deliberately left
        // alone, so the assertion names them rather than expecting zero.
        expect(varcharDrift.map((d) => d.column).sort()).toEqual(
          ['a_lookup', 'a_secret', 'a_select', 'a_user', 'an_autonumber'].sort(),
        );
        for (const col of ['wide_email', 'wide_url', 'narrow_phone', 'narrow_password', 'plain_email']) {
          expect(varcharDrift.map((d) => d.column)).not.toContain(col);
        }

        // `huge_url` is TEXT, and the differ is right to say nothing about it:
        // it compares a numeric `col.maxLength`, which a TEXT column does not
        // report. A TEXT column refuses nothing the declaration allows, so
        // there is no divergence to plan an ALTER for.
        expect(varcharDrift.map((d) => d.column)).not.toContain('huge_url');

        // ⛔ The malformed pair, and the reason `schema-drift.ts` is in this
        // diff at all. On the pre-fix tree BOTH of these reported
        // `narrow_varchar` at severity `error` / category `destructive` —
        // `maxLength: 0` takes the narrowing arm because `0 > 255` is false —
        // so `os migrate apply --allow-destructive` was being asked to run
        // `varchar(0)` and `varchar(12.5)`, DDL no server accepts. The emitter
        // treats a malformed bound as no bound; the differ now applies the
        // same predicate, which is the whole point of the fix.
        expect(varcharDrift.map((d) => d.column)).not.toContain('bogus_url');
        expect(varcharDrift.map((d) => d.column)).not.toContain('fractional_url');
      });

      it('still refuses a value past the DECLARED bound — the bound binds, it did not merely move', async () => {
        driver = new SqlDriver(c.config());
        for (const t of [T, PARENT]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
        await driver.initObjects([parentObject(), stringObject()]);

        // ⛔ The negative half. `varchar(20)` must really be 20 — a fix that
        // widened everything to silence the symptom would pass every
        // assertion above and fail this one.
        await expect(
          driver.create(T, { id: 'r2', narrow_phone: 'p'.repeat(300) }),
        ).rejects.toThrow(/too long|ER_DATA_TOO_LONG|22001/i);
      });
    });
  });
}
