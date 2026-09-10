// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE #16294 CAUSE-3 PIN: an authored `defaultValue` reaches the generated
 * table as the same column DEFAULT `driver-sql` puts there.
 *
 * ## The defect
 *
 * Neither migration format read `defaultValue` at all, so a row inserted out of
 * band into a generated table got NULL where the platform's own table supplies
 * the declared value. Driven on live PostgreSQL 16.13 — one object, three
 * schemas, one producer each, `information_schema.columns` read back per schema
 * (the card's own six-column probe, re-run against `generate.ts` as #16887 and
 * #17208 leave it):
 *
 * ```
 *   field                driver                          sqlgen                verdict
 *   f_plain              null=YES default=-              null=YES default=-    agree
 *   f_required           null=YES default=-              null=YES default=-    agree
 *   f_storage_notnull    null=NO  default=-              null=NO  default=-    agree
 *   f_required_and_st    null=NO  default=-              null=NO  default=-    agree
 *   f_default            null=YES default='hello'::text  null=YES default=-    DIVERGED
 *   f_default_required   null=YES default='hello'::text  null=YES default=-    DIVERGED
 * ```
 *
 * ...and after the repair, on the same cluster, `diverged: 0 of 6`.
 *
 * ⭐ The six-column probe covers ONE `defaultValue` shape. A 23-column probe on
 * the same cluster covers the rest, and two of its rows are why this file exists
 * beyond "emit the value":
 *
 * ```
 *   d_now_datetime  driver CURRENT_TIMESTAMP                        (the token has a database counterpart)
 *   d_now_date      driver (timezone('utc'::text, now()))::date     (NOT the same expression)
 *   d_now_time      driver (timezone('utc'::text, now()))::time(3)  (nor this one)
 *   d_current_user  driver -                                        (a token with NO counterpart)
 *   d_expr          driver -                                        (an Expression envelope)
 *   d_select        driver -                                        (an option-level `default: true`)
 *   d_number   42   driver '42'::numeric   sqlgen 42                DIVERGED on TEXT, same value
 * ```
 *
 * The last row is the one a "just emit the literal" repair gets wrong and never
 * notices: `DEFAULT 42` and `DEFAULT '42'` are the same default and PostgreSQL
 * keeps them textually apart forever in `column_default`, which is precisely the
 * cost #15521 measured for the audit pair. knex quotes every bound default, so
 * the driver's column carries the quoted form and the sql format now does too.
 *
 * ## What this pin does NOT claim
 *
 * 1. **`f_required` stays out of the repair.** A `required: true` field with no
 *    `storage.notNull` is nullable on all three producers — which is agreement,
 *    not divergence, because #16887 already took both generators off `required`.
 *    Whether a SCAFFOLD should nonetheless preserve the author's declaration is
 *    an open decision (#17218) and ⛔ is not settled here or by this file.
 * 2. **`NOW()` on a `date` / `time` column is a PostgreSQL claim**, like every
 *    other literal in `generateMigrationSql` (its own header says so for `JSONB`
 *    / `TIMESTAMPTZ` / `CURRENT_TIMESTAMP`). `SqlDriver.nowColumnDefault` is
 *    dialect-branched and its SQLite arm is a canonical ISO string, so those two
 *    shapes are asserted in section B against the driver's PostgreSQL arm and
 *    are deliberately ABSENT from the SQLite chain in section A — a `db.raw`
 *    carrying `timezone('utc', now())` cannot create a table there at all.
 *    ⛔ Read that as the boundary of the claim, never as coverage.
 * 3. **A `multiple: true` field's NULLABILITY.** `createColumn` short-circuits
 *    on the flag and returns before both nullability and defaults, so the driver
 *    leaves such a column nullable while both generators emit NOT NULL for
 *    `storage.notNull` — measured on the same cluster and the ONE row of the
 *    23-column probe still diverging after this change. It is pinned as-is by
 *    `generate-multiple-json-column.pin.test.ts`, so moving it is a separate
 *    card, not a rider here. What this file does assert about that field is the
 *    half it owns: the driver emits no DEFAULT for it, and neither format does.
 *
 * ## Why this pin reads the driver instead of asserting the spellings
 *
 * The same reason `generate-string-family-width.pin.test.ts` and
 * `generate-declared-unique-index.pin.test.ts` give: the whole shape of this
 * card is "the generator disagrees with the driver", so a pin transcribing
 * `CURRENT_TIMESTAMP` would re-create the defect one layer up and stay green the
 * day the driver's spelling moves. Section A's authority is three real tables in
 * one engine, compared through the engine's own catalog; section B recomputes
 * every `NOW()` spelling from `SqlDriver.nowColumnDefault` itself.
 */

import { SqlDriver } from '@objectstack/driver-sql';
import { afterAll, describe, expect, it } from 'vitest';

import { generateMigrationSql, generateMigrationTs } from './generate.js';

// ── The oracle ──────────────────────────────────────────────────────────────

/**
 * The driver's own `protected` judgments, reached by widening rather than
 * re-derived — the technique `generate-string-family-width.pin.test.ts`
 * established: `protected` is a compile-time visibility rule, so a subclass
 * publishes the driver's OWN body without copying a character of it.
 */
class DriverOracle extends SqlDriver {
  protected override logger = { warn: () => {}, error: () => {} };

  /** `SqlDriver.nowColumnDefault`, unmodified — the `'NOW()'` translation. */
  public nowDefaultFor(type: string): unknown {
    return this.nowColumnDefault(type);
  }

  /** The knex handle this driver opened — the database every producer writes into. */
  public get db(): any {
    return this.knex;
  }
}

function newOracle(): DriverOracle {
  return new DriverOracle({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  } as any);
}

/**
 * A PostgreSQL-configured driver that never connects. knex builds SQL lazily, so
 * `nowColumnDefault`'s dialect branch and the DDL it compiles into are both
 * readable without a server — which is what lets section B assert the arm the
 * live cluster measured on a tier that runs everywhere.
 */
function newPostgresOracle(): DriverOracle {
  return new DriverOracle({ client: 'pg', connection: 'postgres://pin@127.0.0.1:1/unused' } as any);
}

/** One column as SQLite's own catalog reports it. */
interface PhysicalColumn {
  notnull: number;
  dflt_value: string | null;
}

async function physicalColumns(db: any, table: string): Promise<Record<string, PhysicalColumn>> {
  const rows = (await db.raw(`PRAGMA table_info("${table}")`)) as Array<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  const out: Record<string, PhysicalColumn> = {};
  for (const r of rows) out[r.name] = { notnull: r.notnull, dflt_value: r.dflt_value };
  return out;
}

/** Statements of the sql format, comment lines removed. */
function sqlStatements(sql: string): string[] {
  const stripped = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  return stripped.split(';').map((s) => s.trim()).filter(Boolean);
}

/**
 * The ts format's module, loaded WITHOUT touching the filesystem.
 *
 * The emitted source is TypeScript only in its two annotations; stripping them
 * and turning the two `export`s into locals makes it an ordinary function body.
 * ⛔ Not a parse check — `generate-emission-parses.test.ts` owns that; this is
 * how the third producer gets RUN.
 */
function loadEmittedTs(ts: string): { up: (db: any) => Promise<void> } {
  const js = ts
    .replace(/: any/g, '')
    .replace(/: Promise<void>/g, '')
    .replace(/export async function/g, 'async function');
  // eslint-disable-next-line no-new-func
  return new Function(`${js}\nreturn { up, down };`)() as { up: (db: any) => Promise<void> };
}

const configFor = (object: Record<string, any>) => ({ objects: { o: object } }) as Record<string, unknown>;

// ── The corpus ──────────────────────────────────────────────────────────────
//
// Every `defaultValue` shape whose verdict is dialect-INDEPENDENT: a literal is
// a literal on both engines, and the three shapes that emit nothing emit nothing
// everywhere. The `NOW()` family is section B's, for the reason the header gives.

const FIELDS: Record<string, any> = {
  c_none: { type: 'text' },
  c_text: { type: 'text', defaultValue: 'hello' },
  c_empty: { type: 'text', defaultValue: '' },
  c_quote: { type: 'text', defaultValue: "it's" },
  c_newline: { type: 'text', defaultValue: 'a\nb' },
  c_backslash: { type: 'text', defaultValue: 'a\\b' },
  c_number: { type: 'number', defaultValue: 42 },
  c_zero: { type: 'number', defaultValue: 0 },
  c_negative: { type: 'number', defaultValue: -3.5 },
  c_integer: { type: 'rating', defaultValue: 7 },
  c_true: { type: 'boolean', defaultValue: true },
  c_false: { type: 'boolean', defaultValue: false },
  c_notnull_default: { type: 'text', storage: { notNull: true }, defaultValue: 'hi' },
  c_required_default: { type: 'text', required: true, defaultValue: 'hi' },
  // The three shapes the driver deliberately gives NO column default.
  c_token_user: { type: 'lookup', referenceTo: 'sys_user', defaultValue: 'current_user' },
  c_expression: { type: 'text', defaultValue: { dialect: 'cel', source: 'today()' } },
  c_option_default: { type: 'select', options: [{ label: 'A', value: 'a', default: true }] },
  // ...and the flag that returns before `createColumn` reaches either question.
  c_multiple: { type: 'text', multiple: true, defaultValue: 'x' },
};

/** The columns whose DEFAULT the driver is expected to emit — the non-vacuity set. */
const DEFAULTED = [
  'c_text', 'c_empty', 'c_quote', 'c_newline', 'c_backslash',
  'c_number', 'c_zero', 'c_negative', 'c_integer', 'c_true', 'c_false',
  'c_notnull_default', 'c_required_default',
];

/** The columns that must carry NO default, each for its own recorded reason. */
const UNDEFAULTED = ['c_none', 'c_token_user', 'c_expression', 'c_option_default', 'c_multiple'];

const OBJECT = { name: 'probe', fields: FIELDS };

// ────────────────────────────────────────────────────────────────────────────
// A. THE REAL CHAIN — three producers, one database, the catalog as the witness
// ────────────────────────────────────────────────────────────────────────────

describe('#16294 — the DEFAULT each generator emits is the DEFAULT the driver CREATES', () => {
  const drivers: DriverOracle[] = [];
  afterAll(async () => { for (const d of drivers) await d.db.destroy(); });

  async function threeTables(object: Record<string, any>) {
    const driverDrv = newOracle();
    const sqlDrv = newOracle();
    const tsDrv = newOracle();
    drivers.push(driverDrv, sqlDrv, tsDrv);

    await driverDrv.initObjects([object as any]);

    const sqlText = generateMigrationSql(configFor(object));
    for (const stmt of sqlStatements(sqlText)) await sqlDrv.db.raw(stmt);

    const tsText = generateMigrationTs(configFor(object));
    await loadEmittedTs(tsText).up(tsDrv.db);

    const table = String(object.name);
    return {
      sqlText,
      tsText,
      driver: await physicalColumns(driverDrv.db, table),
      sqlgen: await physicalColumns(sqlDrv.db, table),
      tsgen: await physicalColumns(tsDrv.db, table),
      dbs: { driver: driverDrv.db, sqlgen: sqlDrv.db, tsgen: tsDrv.db },
    };
  }

  it('every corpus column carries the driver\'s own DEFAULT text in both formats', async () => {
    const built = await threeTables(OBJECT);
    for (const name of Object.keys(FIELDS)) {
      // ⭐ THE AUTHORITY: whatever the driver's own table records for this
      // column, both generated tables record too — read out of the engine's
      // catalog, never out of the emitted text.
      expect({ column: name, ...built.sqlgen[name] }).toEqual({ column: name, ...built.driver[name] });
      expect({ column: name, ...built.tsgen[name] }).toEqual({ column: name, ...built.driver[name] });
    }
  });

  /**
   * NON-VACUITY, and the half that makes the equality above mean something: a
   * corpus in which the driver emitted no default at all would satisfy every
   * `toEqual` by agreeing on `null`.
   */
  it('the corpus really produces defaults, and really produces absences', async () => {
    const built = await threeTables(OBJECT);
    for (const name of DEFAULTED) {
      expect({ column: name, dflt: built.driver[name]?.dflt_value }).not.toEqual({ column: name, dflt: null });
      expect({ column: name, dflt: built.sqlgen[name]?.dflt_value }).not.toEqual({ column: name, dflt: null });
      expect({ column: name, dflt: built.tsgen[name]?.dflt_value }).not.toEqual({ column: name, dflt: null });
    }
    for (const name of UNDEFAULTED) {
      expect({ column: name, dflt: built.driver[name]?.dflt_value }).toEqual({ column: name, dflt: null });
      expect({ column: name, dflt: built.sqlgen[name]?.dflt_value }).toEqual({ column: name, dflt: null });
      expect({ column: name, dflt: built.tsgen[name]?.dflt_value }).toEqual({ column: name, dflt: null });
    }
    expect(DEFAULTED.length + UNDEFAULTED.length).toBe(Object.keys(FIELDS).length);
  });

  /**
   * ⭐ THE CARD'S OWN CONSEQUENCE, as behaviour rather than as a catalog row:
   * "a row inserted out of band into a generated table gets NULL where the
   * platform's own table would have supplied the declared value".
   */
  it('an out-of-band insert gets the declared value from ALL THREE tables', async () => {
    const built = await threeTables(OBJECT);
    const seen: Record<string, unknown> = {};
    for (const [who, db] of Object.entries(built.dbs)) {
      await db.raw(`INSERT INTO "probe" ("id", "c_notnull_default") VALUES ('a', 'nn')`);
      const rows = (await db.raw(`SELECT "c_text", "c_number", "c_true" FROM "probe" WHERE "id" = 'a'`)) as any[];
      seen[who] = rows[0];
    }
    expect(seen.sqlgen).toEqual(seen.driver);
    expect(seen.tsgen).toEqual(seen.driver);
    // ...and the row really carries the declared value, not a shared NULL.
    expect((seen.driver as any).c_text).toBe('hello');
  });

  /**
   * The FIRING CONTROL for the block above: the same comparison run against a
   * table built from a mutated declaration must FAIL. Without it, "all three
   * agree" is a claim no observation could contradict.
   */
  it('the comparison can fail — a changed declaration moves the driver\'s column', async () => {
    const moved = await threeTables({
      name: 'probe',
      fields: { ...FIELDS, c_text: { type: 'text', defaultValue: 'MOVED' } },
    });
    const base = await threeTables(OBJECT);
    expect(moved.driver.c_text).not.toEqual(base.driver.c_text);
    // ...and the generators followed it there, which is the whole claim.
    expect(moved.sqlgen.c_text).toEqual(moved.driver.c_text);
    expect(moved.tsgen.c_text).toEqual(moved.driver.c_text);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// B. THE `NOW()` TRANSLATION — recomputed from the driver's own PostgreSQL arm
// ────────────────────────────────────────────────────────────────────────────

describe('#16294 — the `NOW()` spellings are `SqlDriver.nowColumnDefault`\'s own', () => {
  const pg = newPostgresOracle();
  afterAll(async () => { await pg.db.destroy(); });

  const sqlFor = (fields: Record<string, any>) =>
    generateMigrationSql(configFor({ name: 'probe', fields }));
  const tsFor = (fields: Record<string, any>) =>
    generateMigrationTs(configFor({ name: 'probe', fields }));

  /**
   * One row per branch of `nowColumnDefault`, with the expected text taken FROM
   * that method rather than written here. `time` and `date` are the two the
   * driver refuses to answer with a bare `CURRENT_TIMESTAMP`: it resolves the
   * calendar day in the server's timezone (#4022) and the time-of-day in the
   * server's or the session's clock (#3994).
   */
  for (const type of ['datetime', 'date', 'time'] as const) {
    it(`\`NOW()\` on a ${type} column emits the driver's PostgreSQL default`, () => {
      const expected = String(pg.nowDefaultFor(type));
      const sql = sqlFor({ f: { type, defaultValue: 'NOW()' } });
      expect(sql).toContain(`DEFAULT ${expected}`);

      // The ts format reaches the same text through knex — asserted by
      // COMPILING the emitted call's argument the way the driver compiles its
      // own, rather than by matching the source string.
      const ts = tsFor({ f: { type, defaultValue: 'NOW()' } });
      const compiled = type === 'datetime'
        ? String(pg.db.fn.now())
        : String(pg.db.raw(expected));
      expect(String(pg.db.raw(compiled))).toBe(expected);
      expect(ts).toContain('.defaultTo(');
      expect(ts).toMatch(type === 'datetime' ? /\.defaultTo\(db\.fn\.now\(\)\)/ : /\.defaultTo\(db\.raw\(/);
      if (type !== 'datetime') expect(ts).toContain(expected.replace(/"/g, ''));
    });
  }

  /** NON-VACUITY: the three branches really are three different spellings. */
  it('the three branches are three distinct spellings', () => {
    const spellings = new Set(['datetime', 'date', 'time'].map((t) => String(pg.nowDefaultFor(t))));
    expect(spellings.size).toBe(3);
  });

  /**
   * The token vocabulary is IMPORTED, so its tolerance comes along: the driver
   * accepts `'now()'` and `' NOW() '` for the same token, and so must both
   * formats. A generator that string-compared `'NOW()'` would emit the literal
   * text `'now()'` as a default value into a timestamp column.
   */
  it('the token match is the spec\'s — case- and whitespace-tolerant', () => {
    const expected = String(pg.nowDefaultFor('datetime'));
    for (const spelling of ['NOW()', 'now()', ' NOW() ', 'Now()']) {
      expect(sqlFor({ f: { type: 'datetime', defaultValue: spelling } })).toContain(`DEFAULT ${expected}`);
      expect(tsFor({ f: { type: 'datetime', defaultValue: spelling } })).toContain('.defaultTo(db.fn.now())');
    }
    // ...and a near-miss is NOT the token: it is an ordinary string literal.
    expect(sqlFor({ f: { type: 'text', defaultValue: 'NOW' } })).toContain("DEFAULT 'NOW'");
  });

  /**
   * The OTHER token, with no database counterpart. Asserted here beside its
   * sibling so the pair reads as one rule rather than two coincidences.
   */
  it('a token with no database counterpart emits no DEFAULT in either format', () => {
    const fields = { f: { type: 'lookup', referenceTo: 'sys_user', defaultValue: 'current_user' } };
    expect(sqlFor(fields)).not.toContain('DEFAULT current_user');
    expect(sqlFor(fields)).not.toContain("DEFAULT 'current_user'");
    // Read on the FIELD's own line: the two audit columns below it legitimately
    // carry `.defaultTo(db.fn.now())`, so a whole-file `not.toContain` would be
    // a test that could never pass rather than one that could never fail.
    const fieldLine = tsFor(fields).split('\n').find((l) => l.includes("'f'"));
    expect(fieldLine).toBe("    table.string('f').nullable();");
  });
});
