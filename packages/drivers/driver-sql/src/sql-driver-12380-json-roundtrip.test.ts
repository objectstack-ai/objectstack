// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12380] A `Field.json` column round-trips FAITHFULLY — what you wrote is what
 * you read back — on every dialect this driver speaks.
 *
 * ## What was measured, and why the contract decides it
 *
 * Measured 2026-08-26 through the driver boundary on live SQLite (better-sqlite3),
 * live Postgres 16.13 (server TZ `Asia/Shanghai`) and live MySQL 8.0.46 (server
 * TZ `+08:00`), with the stored cell read back through a SEPARATE RAW QUERY
 * against the catalog (`typeof()` / `json_typeof()` / `json_type()`), never
 * through the emitted DDL. Before the fix: **Postgres and MySQL 17/17 faithful,
 * SQLite 13/17 type-changed.**
 *
 * `json`'s stored contract is `z.unknown()` — deliberately open
 * (`spec/src/data/field-value.zod.ts`: *"openness is now an explicit decision,
 * not an accident of nobody checking"*). An explicitly-open contract admits BOTH
 * `123` and `'123'` as legal values of one field, so no driver has license to
 * collapse them onto one representation. That is what makes Postgres and MySQL
 * right and SQLite wrong here — a contract argument, not a strictness one.
 * Maintainer ruling 2026-08-26: make SQLite injective, deleting a dialect branch
 * rather than adding one.
 *
 * ## Three mechanisms, and only two of them were ever reversible
 *
 * 1. **Read-side.** `formatOutput` `JSON.parse`s every string in a json column,
 *    so a stored string whose CONTENT parses came back type-changed.
 * 2. **Write-side.** The column is declared type `json`, which contains none of
 *    `INT`/`CHAR`/`CLOB`/`TEXT`/`BLOB`/`REAL`/`FLOA`/`DOUB`, so SQLite's
 *    affinity rules fall through to NUMERIC and a bound number-like string was
 *    converted to INTEGER/REAL **before storage**. ⛔ Not reversible.
 * 3. **Native booleans.** `true` was bound as INTEGER 1 and read back as the
 *    number `1`; `formatOutput`'s `booleanFields` pass is keyed to declared
 *    `Field.boolean` COLUMNS, not to booleans inside a json payload.
 *
 * §3 is the one that decides the design and is pinned LIVE rather than reasoned:
 * the declared column type is unchanged, so NUMERIC affinity is still in force —
 * and the suite proves it is, in the same statement in which it proves the
 * driver's encoded form defeats it.
 *
 * ## Assertion conventions
 *
 * Values are asserted with `toStrictEqual` **and** an explicit `typeof` pin. The
 * before-state is a WRONG TYPE carrying a right-looking value: `'123'` read back
 * as `123` passes `toEqual`-style coercion and every truthiness pin, which is
 * exactly how this survived to be found by reading the code. A round-trip pin
 * that does not compare types is not a round-trip pin.
 *
 * Postgres and MySQL were faithful BEFORE this change and are the regression
 * control: if the fix ever moves the defect onto them instead of closing it,
 * §1 goes red on those cells first.
 *
 * ⛔ Deliberately NOT here: the cross-driver `VALUE_ROUNDTRIP` conformance
 * case-set. It is ruled in but sequenced SECOND (it is cross-driver by design
 * and would ship red on SQLite by construction if it landed before this fix),
 * and this suite consumes no `CASE_SETS` marker, so the conformance census does
 * not score it. It states its dialect stance through `DIALECT_CELLS` anyway.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, dialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'json_roundtrip_12380';
const LEGACY_TABLE = 'json_legacy_12380';

const FIELDS = {
  label: { type: 'string' },
  val: { type: 'json' },
} as const;

/**
 * The boundary set. Every STRING here has content that is valid JSON or is
 * number-like (or both) — the two classes the pre-fix encoding destroyed — plus
 * the ordinary strings that always worked, as controls. `wrote` is the exact JS
 * value handed to `create()`; the read must be `toStrictEqual` to it.
 */
const CASES: Array<{ label: string; wrote: unknown; note: string }> = [
  // ── strings whose content is valid JSON (mechanism 1) ──────────────────────
  { label: 's_true', wrote: 'true', note: 'string, parses as boolean' },
  { label: 's_false', wrote: 'false', note: 'string, parses as boolean' },
  { label: 's_null', wrote: 'null', note: 'string, parses as null' },
  { label: 's_arr', wrote: '[]', note: 'string, parses as array' },
  { label: 's_obj', wrote: '{"a":1}', note: 'string, parses as object' },
  { label: 's_quoted', wrote: '"quoted"', note: 'string, parses as string' },
  // ── number-like strings (mechanism 2 — irreversible before the fix) ────────
  { label: 's_123', wrote: '123', note: 'string, number-like' },
  { label: 's_pad', wrote: '  123  ', note: 'string, number-like with padding' },
  { label: 's_0123', wrote: '0123', note: 'string, leading zero' },
  { label: 's_1e5', wrote: '1e5', note: 'string, exponent form' },
  { label: 's_1p0', wrote: '1.0', note: 'string, trailing zero' },
  { label: 's_neg0', wrote: '-0', note: 'string, negative zero' },
  // ── ordinary strings — controls that were faithful before ─────────────────
  { label: 's_empty', wrote: '', note: 'empty string' },
  { label: 's_tz', wrote: 'America/New_York', note: 'ordinary string' },
  { label: 's_bad', wrote: '{bad json', note: 'string that does not parse' },
  { label: 's_nan', wrote: 'NaN', note: 'string, not valid JSON' },
  // ── native (non-string) JSON values ───────────────────────────────────────
  { label: 'n_true', wrote: true, note: 'native boolean (mechanism 3)' },
  { label: 'n_false', wrote: false, note: 'native boolean (mechanism 3)' },
  { label: 'n_int', wrote: 123, note: 'native number' },
  { label: 'n_real', wrote: 1.5, note: 'native number' },
  { label: 'n_null', wrote: null, note: 'native null' },
  { label: 'n_obj', wrote: { a: 1 }, note: 'native object' },
  { label: 'n_arr', wrote: [1, 2], note: 'native array' },
  { label: 'n_str', wrote: 'plain', note: 'native plain string' },
];

/**
 * The pairs that must stay DISTINGUISHABLE ON DISK: the string form of a value
 * against the native form it looks like. Three of these six collided on SQLite
 * before the fix (`'123'`/`123`, `'[]'`/`[]`, `'{"a":1}'`/`{a:1}`) and a fourth
 * collided on read (`'null'`/`null`); all six were distinct on PG and MySQL.
 */
const COLLISION_PAIRS: Array<[string, string]> = [
  ['s_123', 'n_int'],
  ['s_arr', 'n_arr_empty'],
  ['s_obj', 'n_obj'],
  ['s_true', 'n_true'],
  ['s_null', 'n_null'],
  ['s_quoted', 'n_quoted'],
];

/** Extra rows that exist only to be the native half of a collision pair. */
const PAIR_ROWS: Array<{ label: string; wrote: unknown }> = [
  { label: 'n_arr_empty', wrote: [] },
  { label: 'n_quoted', wrote: 'quoted' },
];

/** knex's raw result shape differs per client; this is the only place that knows. */
function rowsOf(cell: DialectCell, res: any): any[] {
  if (cell.id === 'pg') return res?.rows ?? [];
  if (cell.id === 'mysql') return Array.isArray(res) ? (res[0] ?? []) : [];
  return Array.isArray(res) ? res : (res?.rows ?? []);
}

/**
 * Read one cell's STORED form through a separate raw query — the storage class
 * (or JSON type) the server reports, plus the stored text. Never the DDL.
 */
async function diskCell(
  driver: SqlDriver,
  cell: DialectCell,
  table: string,
  label: string,
): Promise<{ t: string | null; v: string | null }> {
  const sql =
    cell.id === 'pg'
      ? `select json_typeof("val") as t, "val"::text as v from "${table}" where "label" = ?`
      : cell.id === 'mysql'
        ? `select json_type(\`val\`) as t, cast(\`val\` as char) as v from \`${table}\` where \`label\` = ?`
        : `select typeof("val") as t, cast("val" as text) as v from "${table}" where "label" = ?`;
  const rows = rowsOf(cell, await driver.execute(sql, [label]));
  expect(rows, `no disk row for ${label}`).toHaveLength(1);
  return { t: rows[0].t ?? null, v: rows[0].v ?? null };
}

/** The physical column type, read from the CATALOG rather than the emitted DDL. */
async function catalogType(driver: SqlDriver, cell: DialectCell, table: string): Promise<string> {
  const sql =
    cell.id === 'pg'
      ? `select udt_name as ty from information_schema.columns
           where table_schema = current_schema() and table_name = ? and column_name = 'val'`
      : cell.id === 'mysql'
        ? `select data_type as ty from information_schema.columns
             where table_schema = database() and table_name = ? and column_name = 'val'`
        : `select type as ty from pragma_table_info(?) where name = 'val'`;
  const rows = rowsOf(cell, await driver.execute(sql, [table]));
  expect(rows, `no catalog row for ${table}.val`).toHaveLength(1);
  return String(rows[0].ty).toLowerCase();
}

/**
 * [#12738] The stored `CREATE TABLE` statement for a table, from SQLite's own
 * catalog. Used to build a LEGACY-shaped table out of the table the driver
 * actually emits, so the legacy fixture cannot drift from the real one.
 */
async function createStatementOf(driver: SqlDriver, cell: DialectCell, table: string): Promise<string> {
  const rows = rowsOf(cell, await driver.execute(`select sql from sqlite_master where name = ?`, [table]));
  expect(rows, `no CREATE statement for ${table}`).toHaveLength(1);
  return String(rows[0].sql);
}

/**
 * [#12738] Turn a driver-emitted `CREATE TABLE` into the PRE-#12738 one: rename
 * the table and put `val` back to its old `json` declaration.
 *
 * ⚠️ The rewrite is ASSERTED, not assumed. A regex that silently matched
 * nothing would produce a table declared `text` and every "legacy" expectation
 * below would then be measuring the new column while claiming to measure the
 * old one — green, and about the wrong table.
 */
function legacyDdlFrom(create: string, from: string, to: string): string {
  const renamed = create.replace(new RegExp(`(["\`]?)${from}\\1`), `"${to}"`);
  expect(renamed, `table ${from} was not renamed to ${to}`).toContain(to);
  const legacy = renamed.replace(/(["`]?val["`]?)\s+text\b/i, '$1 json');
  expect(legacy, 'the `val` column was not put back to its legacy `json` declaration').toMatch(/val["`]?\s+json\b/i);
  expect(legacy).not.toMatch(/val["`]?\s+text\b/i);
  return legacy;
}

function declareRoundTrip(cell: DialectCell): void {
describe(`[#12380] driver-sql — Field.json round-trips faithfully (${cell.label})`, () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.initObjects([{ name: TABLE, fields: { ...FIELDS } }]);
    for (const c of [...CASES, ...PAIR_ROWS]) {
      await driver.create(TABLE, { label: c.label, val: c.wrote }, { bypassTenantAudit: true });
    }
  }, 60_000);

  afterAll(async () => {
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  // The fixture read back rather than trusted: a seed that dropped or folded a
  // row would turn every assertion below into a test of the wrong table.
  it('the fixture is one row per case', async () => {
    const rows = (await driver.find(TABLE, {})) as Array<{ label: string }>;
    expect(rows.map((r) => r.label).sort()).toEqual(
      [...CASES, ...PAIR_ROWS].map((c) => c.label).sort(),
    );
  });

  // ─── §1 The round trip itself — value AND type ───────────────────────────

  for (const c of CASES) {
    it(`round-trips ${c.label} (${c.note})`, async () => {
      const rows = (await driver.find(TABLE, { where: { label: c.label } } as DriverQuery)) as any[];
      expect(rows).toHaveLength(1);
      const read = rows[0].val;
      // The type pin comes first: `'123'` read back as `123` is the exact
      // before-state, and it survives every value-only comparison.
      expect(typeof read, `typeof for ${c.label}`).toBe(typeof c.wrote);
      expect(read, `value for ${c.label}`).toStrictEqual(c.wrote);
    });
  }

  it('every case in the boundary set round-trips — the whole matrix at once', async () => {
    const rows = (await driver.find(TABLE, {})) as any[];
    const byLabel = new Map(rows.map((r) => [r.label, r.val]));
    const unfaithful = CASES.filter(
      (c) =>
        typeof byLabel.get(c.label) !== typeof c.wrote ||
        JSON.stringify(byLabel.get(c.label)) !== JSON.stringify(c.wrote),
    ).map((c) => `${c.label}: wrote ${JSON.stringify(c.wrote)} (${typeof c.wrote}), read ${JSON.stringify(byLabel.get(c.label))} (${typeof byLabel.get(c.label)})`);
    expect(unfaithful, `${CASES.length - unfaithful.length}/${CASES.length} faithful`).toEqual([]);
  });

  // ─── §2 Distinguishable ON DISK, read through a separate raw query ───────

  it('a string and the native value it looks like are distinct ON DISK', async () => {
    const collisions: string[] = [];
    for (const [strLabel, nativeLabel] of COLLISION_PAIRS) {
      const a = await diskCell(driver, cell, TABLE, strLabel);
      const b = await diskCell(driver, cell, TABLE, nativeLabel);
      if (a.t === b.t && a.v === b.v) {
        collisions.push(`${strLabel} vs ${nativeLabel}: both ${a.t} ${JSON.stringify(a.v)}`);
      }
    }
    expect(collisions, `${collisions.length}/${COLLISION_PAIRS.length} collided`).toEqual([]);
  });

  it('a string and the native value it looks like are distinct ON READ', async () => {
    const rows = (await driver.find(TABLE, {})) as any[];
    const byLabel = new Map(rows.map((r) => [r.label, r.val]));
    for (const [strLabel, nativeLabel] of COLLISION_PAIRS) {
      const s = byLabel.get(strLabel);
      const n = byLabel.get(nativeLabel);
      expect(typeof s, `${strLabel} must read as a string`).toBe('string');
      expect(s === n, `${strLabel} and ${nativeLabel} read identically`).toBe(false);
    }
  });

  // ─── §3 The column type, and the affinity it still carries ───────────────

  it('the physical column type is the dialect-correct JSON type, read from the catalog', async () => {
    // [#12738] INVERTED for SQLite only; `json` was asserted on all three
    // dialects before. `createColumn` now emits the type each dialect actually
    // has: Postgres `json` and MySQL `json` are native and UNTOUCHED, while
    // SQLite — which has no JSON type — declares `text`, the type its own JSON1
    // functions operate on and the one that carries TEXT affinity instead of
    // the NUMERIC affinity `json` silently picks up there.
    expect(await catalogType(driver, cell, TABLE)).toBe(cell.id === 'sqlite' ? 'text' : 'json');
  });
});
}

/**
 * ⚠️ SQLite only. **[#12738] INVERTED, and split in two.**
 *
 * This block used to assert that the DDL was UNCHANGED — that a `Field.json`
 * column was still declared `json`, still carried NUMERIC affinity, and that
 * #12380's encoded form survived it. #12738 changed the DDL: the SQLite family
 * now declares `text`, so NUMERIC affinity is gone from NEW columns and the
 * exposure is closed at the root rather than encoded around.
 *
 * Both facts still need pinning, and they are now about two different columns,
 * which is why this describe covers both:
 *
 *  - **§A the column the driver emits today** — declared `text`, TEXT affinity,
 *    so a bare number-like value written by raw SQL is no longer destroyed.
 *  - **§B a LEGACY column** — declared `json` by hand, which is what every
 *    database created before #12738 holds. NUMERIC affinity is still in force
 *    there and #12380's encoding still defeats it. This is the half the #12738
 *    ruling requires to stay green: existing columns keep their declared type,
 *    so the codec that protects them stays load-bearing forever.
 *
 * §B is also §A's negative control. Without it, a §A that answered `text`
 * because the write silently stopped happening would read exactly like a pass.
 */
function declareAffinity(): void {
describe('[#12738] SQLite affinity: gone from new columns, still defeated on legacy ones', () => {
  const cell = dialectCell('sqlite');
  const T = 'json_affinity_12380';
  const LEGACY_T = 'json_affinity_legacy_12738';
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${T}`).catch(() => {});
    await driver.initObjects([{ name: T, fields: { ...FIELDS } }]);

    // The legacy shape, built by hand from the table the driver just made so
    // nothing about it is guessed: same columns, same constraints, with `val`
    // declared the pre-#12738 way. Reproducing the old deployment is the only
    // way to keep measuring the affinity that old deployments still have.
    await driver.execute(`drop table if exists ${LEGACY_T}`).catch(() => {});
    await driver.execute(legacyDdlFrom(await createStatementOf(driver, cell, T), T, LEGACY_T));
  }, 60_000);

  afterAll(async () => {
    await driver.execute(`drop table if exists ${T}`).catch(() => {});
    await driver.execute(`drop table if exists ${LEGACY_T}`).catch(() => {});
    await driver.disconnect();
  });

  // ─── §A the column the driver emits today ────────────────────────────────

  it('[#12738] the declared type is now `text` — the DDL DID change, and that is the fix', async () => {
    // INVERTED from `toBe('json')`. ⛔ Do not restore it: `json` names a type
    // SQLite does not have, and its affinity fallback is the whole defect.
    expect(await catalogType(driver, cell, T)).toBe('text');
  });

  it.each(['123', '  123  ', '0123', '1e5', '1.0', '-0'])(
    'raw %j now SURVIVES as text on the emitted column, and so does its JSON encoding',
    async (raw) => {
      const bare = `bare_${raw}`;
      const enc = `enc_${raw}`;
      // ONE statement, one column, two bindings: the pre-#12380 form and the
      // form `formatInput` produces. Bound through raw SQL so nothing but
      // SQLite's own affinity rule can be responsible for the outcome.
      await driver.execute(
        `insert into "${T}" ("id", "label", "val") values (?, ?, ?), (?, ?, ?)`,
        [`i_${bare}`, bare, raw, `i_${enc}`, enc, JSON.stringify(raw)],
      );
      const bareDisk = await diskCell(driver, cell, T, bare);
      const encDisk = await diskCell(driver, cell, T, enc);
      // INVERTED. This asserted `['integer','real']` — the affinity eating the
      // value — before #12738. The bare value is now preserved BYTE FOR BYTE,
      // which is what "removed at the root" means: raw SQL against this column
      // no longer needs the codec to be safe.
      expect(bareDisk.t, `bare ${raw} must now stay TEXT`).toBe('text');
      expect(bareDisk.v, `bare ${raw} bytes`).toBe(raw);
      // …and the encoded form is unaffected by the change, as it always was.
      expect(encDisk.t, `encoded ${raw} must stay TEXT`).toBe('text');
      expect(encDisk.v, `encoded ${raw} bytes`).toBe(JSON.stringify(raw));
      expect(JSON.parse(encDisk.v!), `encoded ${raw} parses back`).toBe(raw);
    },
  );

  it('[#12738] a native number now lands as TEXT on disk — and still reads back as a number', async () => {
    // INVERTED from `toBe('integer')`. The READ is the half that must not move,
    // and it does not: `formatOutput` parses the encoded form, so the value is
    // still the number 4200. Only the storage class changed.
    await driver.create(T, { label: 'num', val: 4200 }, { bypassTenantAudit: true });
    const d = await diskCell(driver, cell, T, 'num');
    expect(d.t).toBe('text');
    expect(d.v).toBe('4200');
    const rows = (await driver.find(T, { where: { label: 'num' } } as DriverQuery)) as any[];
    expect(rows[0].val).toBe(4200);
  });

  // ─── §B the legacy column — #12380 still in force, and still needed ───────

  it('[#12738] a LEGACY column is still declared `json` — the fixture is real', async () => {
    expect(await catalogType(driver, cell, LEGACY_T)).toBe('json');
  });

  it.each(['123', '  123  ', '0123', '1e5', '1.0', '-0'])(
    'raw %j is STILL eaten by NUMERIC affinity on a legacy column, and #12380 still defeats it',
    async (raw) => {
      const bare = `bare_${raw}`;
      const enc = `enc_${raw}`;
      await driver.execute(
        `insert into "${LEGACY_T}" ("id", "label", "val") values (?, ?, ?), (?, ?, ?)`,
        [`i_${bare}`, bare, raw, `i_${enc}`, enc, JSON.stringify(raw)],
      );
      const bareDisk = await diskCell(driver, cell, LEGACY_T, bare);
      const encDisk = await diskCell(driver, cell, LEGACY_T, enc);
      // Unchanged from the pre-#12738 assertion, on purpose: this is the exact
      // measurement #12380 made, still true, now correctly scoped to the
      // columns it is still true OF.
      expect(['integer', 'real'], `bare ${raw} must be eaten by NUMERIC affinity`).toContain(bareDisk.t);
      expect(encDisk.t, `encoded ${raw} must stay TEXT`).toBe('text');
      expect(encDisk.v, `encoded ${raw} bytes`).toBe(JSON.stringify(raw));
      expect(JSON.parse(encDisk.v!), `encoded ${raw} parses back`).toBe(raw);
    },
  );
});
}

/**
 * ⚠️ SQLite only. The storage-format migration: what it converts, what it
 * refuses to guess at, that it changes no read, and that it is idempotent.
 *
 * Legacy rows are planted through raw SQL with the values the PRE-fix
 * `formatInput` would have bound — so the same affinity rule that produced the
 * legacy corpus produces this one.
 *
 * ⚠️ [#12738] The table is now built with an explicit `json` column instead of
 * being taken from `initObjects`, and that is a STRENGTHENING rather than a
 * workaround. The corpus's defining property is that its number-like cells were
 * eaten by NUMERIC affinity — which only a `json`-declared column does. Since
 * #12738 the emitter produces `text`, so letting `initObjects` create this table
 * would have quietly produced a corpus with no legacy cells in it, and every
 * assertion below would have passed while measuring nothing. The migration
 * itself is unchanged and untouched by #12738: it selects on
 * `typeof(col) = 'text' and json_valid(col) = 0`, never on the declared type.
 */
function declareMigration(): void {
describe('[#12380] the storage-format migration over legacy SQLite json rows', () => {
  const cell = dialectCell('sqlite');
  let driver: SqlDriver;

  /** label → the value the PRE-fix formatInput would have BOUND for it. */
  const LEGACY: Array<{ label: string; bound: unknown; wasWritten: string }> = [
    { label: 'l_plain', bound: 'America/New_York', wasWritten: "the string 'America/New_York'" },
    { label: 'l_empty', bound: '', wasWritten: "the empty string" },
    { label: 'l_bad', bound: '{bad json', wasWritten: "the string '{bad json'" },
    { label: 'l_obj', bound: '{"a":1}', wasWritten: 'an object {a:1} — OR the string \'{"a":1}\'' },
    { label: 'l_arr', bound: '["x"]', wasWritten: "an array ['x'] — OR the string '[\"x\"]'" },
    { label: 'l_strtrue', bound: 'true', wasWritten: "the string 'true'" },
    { label: 'l_int', bound: 123, wasWritten: 'the number 123 — OR the string \'123\'' },
    { label: 'l_bool', bound: 1, wasWritten: 'the boolean true — OR the number 1' },
  ];

  async function plant(): Promise<void> {
    for (const r of LEGACY) {
      await driver.execute(
        `insert into "${LEGACY_TABLE}" ("id", "label", "val") values (?, ?, ?)`,
        [`i_${r.label}`, r.label, r.bound as any],
      );
    }
  }

  async function snapshot(): Promise<Record<string, { t: string | null; v: string | null }>> {
    const out: Record<string, { t: string | null; v: string | null }> = {};
    for (const r of LEGACY) out[r.label] = await diskCell(driver, cell, LEGACY_TABLE, r.label);
    return out;
  }

  async function readAll(): Promise<Map<string, unknown>> {
    const rows = (await driver.find(LEGACY_TABLE, {})) as any[];
    return new Map(rows.map((r) => [r.label, r.val]));
  }

  let beforeDisk: Record<string, { t: string | null; v: string | null }>;
  let beforeRead: Map<string, unknown>;
  let afterDisk: Record<string, { t: string | null; v: string | null }>;
  let afterRead: Map<string, unknown>;
  let twiceDisk: Record<string, { t: string | null; v: string | null }>;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    const shape = `${LEGACY_TABLE}_shape`;
    await driver.execute(`drop table if exists ${LEGACY_TABLE}`).catch(() => {});
    await driver.execute(`drop table if exists ${shape}`).catch(() => {});
    // Pass 1 CREATES the table, so the backfill correctly does nothing. It is
    // created in the PRE-#12738 shape: the driver emits the table, and `val` is
    // put back to `json` so the corpus below really is a legacy corpus.
    await driver.initObjects([{ name: shape, fields: { ...FIELDS } }]);
    await driver.execute(
      legacyDdlFrom(await createStatementOf(driver, cell, shape), shape, LEGACY_TABLE),
    );
    await driver.execute(`drop table if exists ${shape}`).catch(() => {});
    // Register the metadata over the now-existing legacy table. Additive sync
    // adds nothing (every column is present) and the backfill converts nothing
    // (no rows yet), so this is the "old database boots on new code" moment.
    await driver.initObjects([{ name: LEGACY_TABLE, fields: { ...FIELDS } }]);
    expect(await catalogType(driver, cell, LEGACY_TABLE), 'the legacy fixture must be `json`').toBe('json');
    await plant();
    beforeDisk = await snapshot();
    beforeRead = await readAll();
    // Pass 2 finds the table EXISTING, which is what runs the migration.
    await driver.initObjects([{ name: LEGACY_TABLE, fields: { ...FIELDS } }]);
    afterDisk = await snapshot();
    afterRead = await readAll();
    // Pass 3 — idempotence.
    await driver.initObjects([{ name: LEGACY_TABLE, fields: { ...FIELDS } }]);
    twiceDisk = await snapshot();
  }, 120_000);

  afterAll(async () => {
    await driver.execute(`drop table if exists ${LEGACY_TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  it('the legacy corpus really is in the pre-fix storage form', () => {
    // The plain strings are bare TEXT — not valid JSON, which is what makes
    // them the one unambiguous class.
    expect(beforeDisk.l_plain).toEqual({ t: 'text', v: 'America/New_York' });
    expect(beforeDisk.l_bad).toEqual({ t: 'text', v: '{bad json' });
    // …and the number-like/boolean ones were already eaten by NUMERIC affinity.
    expect(beforeDisk.l_int.t).toBe('integer');
    expect(beforeDisk.l_bool.t).toBe('integer');
  });

  it('CONVERTS the one unambiguous class: bare TEXT that is not valid JSON', () => {
    expect(afterDisk.l_plain.v).toBe('"America/New_York"');
    expect(afterDisk.l_empty.v).toBe('""');
    expect(afterDisk.l_bad.v).toBe('"{bad json"');
    for (const label of ['l_plain', 'l_empty', 'l_bad']) {
      expect(afterDisk[label].t, `${label} stays TEXT`).toBe('text');
      expect(afterDisk[label].v, `${label} was rewritten`).not.toBe(beforeDisk[label].v);
    }
  });

  it('⛔ REFUSES to guess: INTEGER/REAL cells are left exactly as they are', () => {
    // `123` the number, `'123'` the string and the boolean `true` are the same
    // bytes on disk. Guessing would corrupt two of the three.
    expect(afterDisk.l_int).toEqual(beforeDisk.l_int);
    expect(afterDisk.l_bool).toEqual(beforeDisk.l_bool);
  });

  it('⛔ REFUSES to guess: TEXT cells that already parse are left exactly as they are', () => {
    // Re-quoting these would turn every legacy object and array into a string —
    // corrupting the common case to guess at the rare one.
    expect(afterDisk.l_obj).toEqual(beforeDisk.l_obj);
    expect(afterDisk.l_arr).toEqual(beforeDisk.l_arr);
    expect(afterDisk.l_strtrue).toEqual(beforeDisk.l_strtrue);
  });

  it('changes NO read — every legacy row reads back exactly as it did before', () => {
    for (const r of LEGACY) {
      expect(afterRead.get(r.label), `${r.label} (${r.wasWritten})`).toStrictEqual(
        beforeRead.get(r.label),
      );
    }
    // Spelled out for the two that matter most: the converted row still reads as
    // its string, and the unrecoverable row still reads as the number it became.
    expect(afterRead.get('l_plain')).toBe('America/New_York');
    expect(afterRead.get('l_int')).toBe(123);
    expect(afterRead.get('l_obj')).toStrictEqual({ a: 1 });
  });

  it('is IDEMPOTENT — a second run rewrites nothing and double-encodes nothing', () => {
    expect(twiceDisk).toEqual(afterDisk);
    // The specific failure a naive migration has: `"America/New_York"` becoming
    // `"\"America/New_York\""` on the second pass.
    expect(twiceDisk.l_plain.v).toBe('"America/New_York"');
  });

  it('a table this call CREATED is skipped — no scan, nothing to converge', async () => {
    const fresh = 'json_fresh_12380';
    await driver.execute(`drop table if exists ${fresh}`).catch(() => {});
    await driver.initObjects([{ name: fresh, fields: { ...FIELDS } }]);
    await driver.create(fresh, { label: 'x', val: 'America/New_York' }, { bypassTenantAudit: true });
    // Written by the NEW codec, so it is already canonical.
    expect((await diskCell(driver, cell, fresh, 'x')).v).toBe('"America/New_York"');
    await driver.execute(`drop table if exists ${fresh}`).catch(() => {});
  });
});
}

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it.
describe('[#12380] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'json value round-trip', declareRoundTrip);
}
declareAffinity();
declareMigration();
