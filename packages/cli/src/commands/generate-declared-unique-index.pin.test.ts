// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE #16317 PIN: a FIELD-LEVEL `unique` declaration reaches the generated
 * table as the same index `driver-sql` creates for the same object.
 *
 * ## The defect
 *
 * Both migration formats emitted a table and no constraint at all. Driven on
 * live PostgreSQL 16.13 — one object, three schemas, one producer each,
 * `pg_indexes` read back per schema:
 *
 * ```
 *   { name: 'probe', fields: { keyed_unique: { type: 'text', unique: true, maxLength: 100 } } }
 *
 *   driver   probe_pkey, uniq_probe_keyed_unique
 *   sql gen  probe_pkey
 *   ts gen   probe_pkey
 * ```
 *
 * Two rows with the same `keyed_unique` value were REFUSED by the platform's
 * table (`23505 ... violates unique constraint "uniq_probe_keyed_unique"`) and
 * ACCEPTED by both generated ones, with nothing reporting it. A scaffold that
 * creates the table for an object dropped a uniqueness guarantee the object
 * declares. After the repair, on the same cluster:
 *
 * ```
 *   driver   probe_pkey, uniq_probe_keyed_unique
 *   sql gen  probe_pkey, uniq_probe_keyed_unique
 *   ts gen   probe_pkey, uniq_probe_keyed_unique
 * ```
 *
 * ...and the duplicate insert is refused by all three, each naming the same
 * constraint. The COLUMN — the #16091 result this change must not spend — read
 * `character varying(100)` on all three both before and after.
 *
 * ## What this pin does NOT claim, stated so nobody reads it as closed
 *
 * Two declaration shapes are deliberately unemitted, and this file asserts that
 * they are unemitted *and named*, never that they are handled:
 *
 *   1. The ADR-0120 D3 ORGANIZATION-SCOPED form — `(COALESCE(<tenant>,
 *      '__global__'), <field>)`. Emitting the bare composite instead would be
 *      worse than emitting nothing: under SQL's NULL-distinct UNIQUE a bare
 *      `(organization_id, field)` constrains NOTHING on rows with no
 *      organization, which on a single-tenant stack is every row (#5030) — a
 *      constraint advertised and not delivered, which is the failure Prime
 *      Directive #10 names.
 *   2. OBJECT-LEVEL `indexes[]`. `normalizeDeclaredIndex` is a second
 *      normalizer that reads the same `unique: true` token DIFFERENTLY (verbatim
 *      as global, a maintainer ruling), so it is a second transcription with a
 *      second pin, not a loop added to this one.
 *
 * ⭐ Measured for the record, because "can the TypeScript format express an
 * expression key part through knex at all" was the open question that kept the
 * scoped form off this change (knex 3.3.0, live PostgreSQL 16.13):
 *
 * ```
 *   table.unique([knex.raw("COALESCE(...)"), 'f'], {indexName})
 *        -> knex compiles ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (COALESCE(...), "f")
 *        -> PostgreSQL: syntax error at or near "("      (a UNIQUE CONSTRAINT
 *           takes no expression key part; only a unique INDEX does)
 *   table.unique(["COALESCE(...)", 'f'], {indexName})
 *        -> knex quotes it as an identifier
 *        -> PostgreSQL: column "COALESCE(""organization_id"", '__global__')" does not exist
 *   db.raw(`CREATE UNIQUE INDEX ... (COALESCE("organization_id", '__global__'), "f")`)
 *        -> ACCEPTED; materialised as
 *           CREATE UNIQUE INDEX k_c ON t USING btree (COALESCE(organization_id, '__global__'::character varying), f)
 * ```
 *
 * So the two formats are NOT unequally capable — the emitted `up(db)` receives a
 * knex handle and `db.raw` is exactly the seam `SqlDriver.createNullSafeUniqueIndex`
 * already uses for this — but knex's SCHEMA BUILDER cannot express it in either
 * format, so the scoped form costs a raw statement rather than another
 * `table.unique(...)` line. That is a fact for whoever takes the scoped half,
 * recorded here rather than acted on.
 *
 * ## Why this pin reads the driver instead of asserting the names
 *
 * The same reason `generate-string-family-width.pin.test.ts` gives: the whole
 * shape of this card is "the generator disagrees with the driver", so a pin that
 * transcribed `uniq_probe_keyed_unique` would re-create the defect one layer up
 * and stay green the day the driver's naming moves. Every name and every key-part
 * ordering here is recomputed from `driver-sql`'s own exported
 * `uniqueIndexesFromFields` / `buildIndexName` / `GLOBAL_TENANT`.
 *
 * ⭐ And the leaves are not the authority. Above the differential sits THE REAL
 * CHAIN: all three producers driven into ONE in-memory better-sqlite3 database,
 * one table each, with the indexes read back out of the database's own catalog
 * and the duplicate row offered to each table. That is the live-PostgreSQL
 * acceptance above, transplanted into a tier that runs everywhere — the
 * differential underneath localises a failure to one builder and is explicitly
 * NOT the authority where the two could disagree.
 *
 * ⚠️ One SQLite artifact, named so nobody reads it as a finding: SQLite ignores
 * the identifier on a table-level `CONSTRAINT <name> UNIQUE (...)` and
 * materialises `sqlite_autoindex_<table>_N` instead. The sql format's DDL is a
 * PostgreSQL claim by #15521 and its constraint NAME is asserted textually
 * (against the driver's own computed name) plus on the live cluster above; what
 * the SQLite chain carries for that format is the KEY PARTS and the ENFORCEMENT.
 * The ts format's `table.unique(cols, { indexName })` is a named index on both
 * engines and is compared by name.
 *
 * ⚠️ Parse-time defaults are outside this comparison ON PURPOSE. An `autonumber`
 * field that omits `unique` is `unique: 'organization'` by contract, materialized
 * in `FieldSchema`'s `.overwrite()` tail — so it reaches BOTH producers already
 * present, and every case here feeds the generator and the driver the SAME
 * object. A pin that fed one a parsed object and the other a raw one would be
 * measuring the parser.
 */

import { SqlDriver, GLOBAL_TENANT, buildIndexName, uniqueIndexesFromFields } from '@objectstack/driver-sql';
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
  public readonly warnings: string[] = [];

  protected override logger = {
    warn: (msg: string) => { this.warnings.push(msg); },
    error: (msg: string) => { this.warnings.push(msg); },
  };

  /** `SqlDriver.computeTenantField`, unmodified. */
  public tenantFieldFor(object: { fields?: Record<string, unknown>; tenancy?: unknown }): string | null {
    return this.computeTenantField(object);
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

/** One index as the catalog reports it: `{ name, unique, columns | expression }`. */
interface PhysicalIndexRow {
  name: string;
  unique: boolean;
  /** SQLite's own provenance: `pk` | `u` (a UNIQUE constraint) | `c` (CREATE INDEX). */
  origin: string;
  /** The key parts as SQLite reports them; `null` for an expression key part. */
  columns: Array<string | null>;
}

/**
 * Every index on a table, MINUS the primary key.
 *
 * The `id` PRIMARY KEY is a unique index on all three producers and always has
 * been (`probe_pkey` in the card's own PostgreSQL table); leaving it in would
 * make "all three agree" true for a reason that has nothing to do with this
 * card. `origin` is SQLite's own answer, not a name heuristic.
 */
async function physicalIndexes(db: any, table: string): Promise<PhysicalIndexRow[]> {
  const list = (await db.raw(`PRAGMA index_list("${table}")`)) as Array<{
    name: string;
    unique: number;
    origin: string;
  }>;
  const out: PhysicalIndexRow[] = [];
  for (const row of list) {
    if (row.origin === 'pk') continue;
    const info = (await db.raw(`PRAGMA index_info("${row.name}")`)) as Array<{ name: string | null }>;
    out.push({ name: row.name, unique: row.unique === 1, origin: row.origin, columns: info.map((c) => c.name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
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
function loadEmittedTs(ts: string): { up: (db: any) => Promise<void>; down: (db: any) => Promise<void> } {
  const js = ts
    .replace(/: any/g, '')
    .replace(/: Promise<void>/g, '')
    .replace(/export async function/g, 'async function');
  // eslint-disable-next-line no-new-func
  return new Function(`${js}\nreturn { up, down };`)() as { up: (db: any) => Promise<void>; down: (db: any) => Promise<void> };
}

// ── The corpus ──────────────────────────────────────────────────────────────

interface Probe {
  label: string;
  object: Record<string, any>;
  /** What the object's declarations mean for the emitters, asserted below. */
  expect: 'emitted' | 'scoped-not-emitted' | 'no-column' | 'none';
}

const ORG = { type: 'text', maxLength: 64 } as const;
const KEYED = { type: 'text', maxLength: 100 } as const;

const CORPUS: Probe[] = [
  {
    label: "the card's own object — plain `unique: true`, no organization column",
    object: { name: 'p_plain', fields: { keyed_unique: { ...KEYED, unique: true } } },
    expect: 'emitted',
  },
  {
    label: "`unique: 'global'` beside an organization column — platform-wide, single-column",
    object: { name: 'p_global', fields: { organization_id: ORG, f: { ...KEYED, unique: 'global' } } },
    expect: 'emitted',
  },
  {
    label: '`unique: true` beside an organization column — the ADR-0120 D3 scoped composite',
    object: { name: 'p_scoped_true', fields: { organization_id: ORG, f: { ...KEYED, unique: true } } },
    expect: 'scoped-not-emitted',
  },
  {
    label: "explicit `unique: 'organization'` — the same scoped composite",
    object: { name: 'p_scoped_word', fields: { organization_id: ORG, f: { ...KEYED, unique: 'organization' } } },
    expect: 'scoped-not-emitted',
  },
  {
    label: 'unique ON the organization column itself — "one row per tenant" stays single-column',
    object: { name: 'p_on_tenant', fields: { organization_id: { ...ORG, unique: true } } },
    expect: 'emitted',
  },
  {
    label: '`tenancy: { enabled: false }` — the explicit opt-out beats column presence',
    object: {
      name: 'p_no_tenancy',
      tenancy: { enabled: false },
      fields: { organization_id: ORG, f: { ...KEYED, unique: true } },
    },
    expect: 'emitted',
  },
  {
    label: 'a declared `tenancy.tenantField` naming a real field',
    object: {
      name: 'p_declared_tenant',
      tenancy: { tenantField: 'org' },
      fields: { org: ORG, f: { ...KEYED, unique: true } },
    },
    expect: 'scoped-not-emitted',
  },
  {
    label: 'a name past the 60-character identifier budget — hash-suffixed',
    object: {
      name: 'p_' + 'n'.repeat(64),
      fields: { keyed_unique_with_a_long_name: { ...KEYED, unique: true } },
    },
    expect: 'emitted',
  },
  {
    label: 'unique on a VIRTUAL field — the driver materialises no column, so neither may we',
    object: { name: 'p_virtual', fields: { f: { type: 'formula', unique: true } } },
    expect: 'no-column',
  },
  {
    label: 'two unique fields at different scopes on one object',
    object: {
      name: 'p_two',
      fields: { a: { ...KEYED, unique: true }, b: { type: 'email', maxLength: 80, unique: 'global' } },
    },
    expect: 'emitted',
  },
  {
    label: 'no unique declaration at all',
    object: { name: 'p_none', fields: { f: KEYED } },
    expect: 'none',
  },
  {
    label: 'an explicit `unique: false` opt-out',
    object: { name: 'p_false', fields: { f: { ...KEYED, unique: false } } },
    expect: 'none',
  },
];

const configFor = (object: Record<string, any>) => ({ objects: { o: object } }) as Record<string, unknown>;

/** The index descriptors the DRIVER's own normalizer says an object asks for. */
function driverIndexes(oracle: DriverOracle, object: Record<string, any>) {
  return uniqueIndexesFromFields(
    String(object.name),
    (object.fields ?? {}) as Record<string, any>,
    oracle.tenantFieldFor(object),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// A. THE REAL CHAIN — three producers, one database, the catalog as the witness
// ────────────────────────────────────────────────────────────────────────────

describe('#16317 — the index each generator emits is the index the driver CREATES', () => {
  const drivers: DriverOracle[] = [];
  afterAll(async () => { for (const d of drivers) await d.db.destroy(); });

  async function threeTables(object: Record<string, any>) {
    const base = String(object.name);
    const driverDrv = newOracle();
    const sqlDrv = newOracle();
    const tsDrv = newOracle();
    drivers.push(driverDrv, sqlDrv, tsDrv);

    await driverDrv.initObjects([object as any]);

    const sql = generateMigrationSql(configFor(object));
    for (const stmt of sqlStatements(sql)) await sqlDrv.db.raw(stmt);

    const ts = generateMigrationTs(configFor(object));
    await loadEmittedTs(ts).up(tsDrv.db);

    return {
      sqlText: sql,
      tsText: ts,
      driver: await physicalIndexes(driverDrv.db, base),
      sqlgen: await physicalIndexes(sqlDrv.db, base),
      tsgen: await physicalIndexes(tsDrv.db, base),
      dbs: { driver: driverDrv.db, sqlgen: sqlDrv.db, tsgen: tsDrv.db },
    };
  }

  /** The key-part shape of every UNIQUE index on a table, name-free. */
  const uniqueShapes = (rows: PhysicalIndexRow[]) =>
    rows.filter((r) => r.unique).map((r) => r.columns.join(',')).sort();

  for (const probe of CORPUS) {
    it(`${probe.label}`, async () => {
      const built = await threeTables(probe.object);
      const wanted = driverIndexes(newOracle(), probe.object);

      // ⭐ THE AUTHORITY. Whatever the driver's own table carries, the ts
      // format's table carries too — by NAME, because both go through knex's
      // named-index spelling — except for the two declared exclusions.
      const emittable = probe.expect === 'emitted';
      if (emittable) {
        expect(uniqueShapes(built.tsgen)).toEqual(uniqueShapes(built.driver));
        expect(uniqueShapes(built.sqlgen)).toEqual(uniqueShapes(built.driver));
        const driverNames = built.driver.filter((r) => r.unique).map((r) => r.name).sort();
        const tsNames = built.tsgen.filter((r) => r.unique).map((r) => r.name).sort();
        expect(tsNames).toEqual(driverNames);
        // The sql format's identifier: SQLite drops it (see the header), so it
        // is read out of the DDL and compared with the driver's own name.
        for (const want of wanted) expect(built.sqlText).toContain(`CONSTRAINT "${want.name}" UNIQUE (`);
      }

      if (probe.expect === 'scoped-not-emitted') {
        // The driver DOES build it — the expression key part is why we do not.
        expect(wanted.length).toBeGreaterThan(0);
        for (const want of wanted) {
          expect(want.nullSafeColumns ?? []).not.toHaveLength(0);
          // ⛔ Absence must be loud: named in the generated file, both formats.
          expect(built.sqlText).toContain(`NOT EMITTED: UNIQUE index "${want.name}"`);
          expect(built.tsText).toContain(`NOT EMITTED: UNIQUE index '${want.name}'`);
          expect(built.sqlText).toContain(`COALESCE("${want.nullSafeColumns![0]}", '${GLOBAL_TENANT}')`);
          // ...and NOT emitted as the bare composite, which would advertise a
          // constraint the table does not carry (#5030).
          expect(built.sqlText).not.toContain(`CONSTRAINT "${want.name}" UNIQUE (`);
          expect(built.tsText).not.toContain(`indexName: '${want.name}'`);
        }
        expect(uniqueShapes(built.tsgen)).toHaveLength(0);
        expect(uniqueShapes(built.sqlgen)).toHaveLength(0);
      }

      if (probe.expect === 'no-column') {
        // The driver asks for the index and then skips it — no column was
        // materialized. The generator must reach the same end, and say so.
        expect(wanted.length).toBeGreaterThan(0);
        expect(uniqueShapes(built.driver)).toHaveLength(0);
        expect(uniqueShapes(built.tsgen)).toHaveLength(0);
        expect(uniqueShapes(built.sqlgen)).toHaveLength(0);
        for (const want of wanted) {
          expect(built.sqlText).toContain(`NOT EMITTED: UNIQUE index "${want.name}"`);
          expect(built.tsText).toContain(`NOT EMITTED: UNIQUE index '${want.name}'`);
        }
      }

      if (probe.expect === 'none') {
        expect(wanted).toHaveLength(0);
        expect(uniqueShapes(built.driver)).toHaveLength(0);
        expect(uniqueShapes(built.tsgen)).toHaveLength(0);
        expect(uniqueShapes(built.sqlgen)).toHaveLength(0);
        expect(built.sqlText).not.toContain('NOT EMITTED');
        expect(built.tsText).not.toContain('NOT EMITTED');
      }
    });
  }

  /**
   * ⭐ THE CARD'S OWN CONSEQUENCE, as a behaviour rather than as a catalog row:
   * "two rows with the same `keyed_unique` value are refused by the platform's
   * table and accepted by both generated ones".
   */
  it("the duplicate row the platform refuses is refused by BOTH generated tables", async () => {
    const object = { name: 'p_enforce', fields: { keyed_unique: { ...KEYED, unique: true } } };
    const built = await threeTables(object);
    const verdicts: Record<string, string> = {};
    for (const [who, db] of Object.entries(built.dbs)) {
      await db.raw(`INSERT INTO "p_enforce" ("id", "keyed_unique") VALUES ('a', 'dup')`);
      try {
        await db.raw(`INSERT INTO "p_enforce" ("id", "keyed_unique") VALUES ('b', 'dup')`);
        verdicts[who] = 'accepted';
      } catch {
        verdicts[who] = 'refused';
      }
    }
    expect(verdicts).toEqual({ driver: 'refused', sqlgen: 'refused', tsgen: 'refused' });
  });

  /**
   * NON-VACUITY for the whole block. A corpus that built no unique index at all
   * would satisfy every `toEqual` above by agreeing on emptiness.
   */
  it('the corpus actually exercises every class it claims to', async () => {
    const oracle = newOracle();
    drivers.push(oracle);
    const counts = { emitted: 0, scoped: 0, noColumn: 0, none: 0, hashed: 0 };
    for (const probe of CORPUS) {
      const wanted = driverIndexes(oracle, probe.object);
      if (probe.expect === 'emitted') counts.emitted += wanted.length;
      if (probe.expect === 'scoped-not-emitted') counts.scoped += wanted.length;
      if (probe.expect === 'no-column') counts.noColumn += wanted.length;
      if (probe.expect === 'none') counts.none += wanted.length;
      for (const w of wanted) if (/_[0-9a-f]{8}$/.test(w.name)) counts.hashed += 1;
    }
    expect(counts.emitted).toBeGreaterThanOrEqual(5);
    expect(counts.scoped).toBeGreaterThanOrEqual(3);
    expect(counts.noColumn).toBe(1);
    expect(counts.none).toBe(0);
    expect(counts.hashed).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// B. THE LEAF DIFFERENTIAL — the transcriptions against the driver's exports
// ────────────────────────────────────────────────────────────────────────────

describe('#16317 — the transcriptions in generate.ts are the driver\'s own', () => {
  const oracle = newOracle();
  afterAll(async () => { await oracle.db.destroy(); });

  /**
   * `buildIndexName` — swept rather than sampled, and over the truncation
   * boundary in particular: a mirror that dropped the hash suffix agrees with
   * the driver on every short name and diverges on every long one.
   */
  it('every generated identifier is buildIndexName\'s own answer, hash suffix included', () => {
    let hashed = 0;
    for (const width of [1, 10, 40, 47, 48, 49, 50, 51, 60, 61, 90]) {
      const table = 't'.repeat(width);
      const object = { name: table, fields: { f: { ...KEYED, unique: true } } };
      const [want] = driverIndexes(oracle, object);
      expect(generateMigrationSql(configFor(object))).toContain(`CONSTRAINT "${want.name}" UNIQUE ("f")`);
      expect(generateMigrationTs(configFor(object))).toContain(`{ indexName: '${want.name}' }`);
      expect(want.name).toBe(buildIndexName(table, ['f'], true));
      if (/_[0-9a-f]{8}$/.test(want.name)) hashed += 1;
    }
    // Non-vacuity: the sweep really did cross the budget.
    expect(hashed).toBeGreaterThanOrEqual(3);
  });

  /** The `__global__` sentinel the unemitted-index note names. */
  it('the sentinel the NOT EMITTED note prints is the driver\'s GLOBAL_TENANT', () => {
    const object = { name: 'g_probe', fields: { organization_id: ORG, f: { ...KEYED, unique: true } } };
    expect(generateMigrationSql(configFor(object))).toContain(`'${GLOBAL_TENANT}'`);
    expect(generateMigrationTs(configFor(object))).toContain(`'${GLOBAL_TENANT}'`);
  });

  /**
   * The scoping rule itself, over the whole corpus: NAME, KEY PARTS and their
   * ORDER, recomputed from `uniqueIndexesFromFields`.
   */
  it('name, key parts and their order match uniqueIndexesFromFields across the corpus', () => {
    let checked = 0;
    for (const probe of CORPUS) {
      const sql = generateMigrationSql(configFor(probe.object));
      const ts = generateMigrationTs(configFor(probe.object));
      for (const want of driverIndexes(oracle, probe.object)) {
        checked += 1;
        const scoped = (want.nullSafeColumns ?? []).length > 0;
        const emitted = probe.expect === 'emitted';
        const cols = want.columns.map((c) => `"${c}"`).join(', ');
        if (emitted) {
          expect(scoped).toBe(false);
          expect(sql).toContain(`CONSTRAINT "${want.name}" UNIQUE (${cols})`);
          expect(ts).toContain(
            `table.unique([${want.columns.map((c) => `'${c}'`).join(', ')}], { indexName: '${want.name}' });`,
          );
        } else {
          expect(sql).toContain(`NOT EMITTED: UNIQUE index "${want.name}" on (${want.columns.join(', ')})`);
          expect(ts).toContain(`NOT EMITTED: UNIQUE index '${want.name}' on (${want.columns.join(', ')})`);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(9);
  });

  /**
   * ⛔ OBJECT-LEVEL `indexes[]` stays unemitted — asserted, so the day someone
   * adds it they land here and read the header rather than discovering that a
   * second normalizer with different token semantics was silently folded in.
   */
  it('object-level indexes[] is still emitted by neither format', () => {
    const object = {
      name: 'p_declared_idx',
      fields: { a: KEYED, b: KEYED },
      indexes: [{ fields: ['a', 'b'], unique: true }],
    };
    const sql = generateMigrationSql(configFor(object));
    const ts = generateMigrationTs(configFor(object));
    expect(sql).not.toContain('UNIQUE (');
    expect(ts).not.toContain('table.unique(');
    // ...and the column-width answer #16091 computes from the same declaration
    // is untouched by that: `a` and `b` are key parts, so they are sized.
    expect(sql).toContain('"a" VARCHAR(100)');
    expect(ts).toContain("table.string('a', 100)");
  });
});
