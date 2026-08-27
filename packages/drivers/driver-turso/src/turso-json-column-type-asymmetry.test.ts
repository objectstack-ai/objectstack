// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12586] **The declared physical column type for a `Field.json` is DIFFERENT
 * on this driver's two transports, and that is intended.** This file is the
 * record of that decision and the pin that fails if either side moves.
 *
 * ```text
 *  declared field   local (TursoDriver extends SqlDriver, knex)   remote (RemoteTransport)
 *  ---------------  -------------------------------------------  ------------------------
 *  { type: 'json' }  json                                          TEXT
 *  { multiple: true} json                                          TEXT
 * ```
 *
 * ## Why a reader should not "fix" this
 *
 * The two halves are written by two different authors of DDL. Local mode
 * inherits `SqlDriver.createColumn`, which hands the column to knex's
 * `table.json(name)`; remote mode does not go through knex at all and spells
 * its own SQLite types in `RemoteTransport.mapFieldTypeToSQL`. **Every** column
 * type in this driver is spelled differently by the two — `varchar(255)` vs
 * `TEXT`, `float` vs `REAL`, `boolean` vs `INTEGER` — and for all of those the
 * difference is cosmetic, because SQLite derives a column's *affinity* from
 * substrings of the declared type name and the two spellings land in the same
 * affinity class.
 *
 * `json` is the one that does not. It contains none of SQLite's affinity
 * markers (`INT`, `CHAR`/`CLOB`/`TEXT`, `BLOB`, `REAL`/`FLOA`/`DOUB`), so it
 * takes **NUMERIC** affinity and converts a number-like value on the way in;
 * `TEXT` takes **TEXT** affinity and converts nothing. So this is the one
 * column where the two transports disagree about *what a value becomes on
 * disk*, and that is a different question from the spelling.
 *
 * ## Why it is safe today — and why "safe" is not the same as "the same"
 *
 * Both transports round-trip every `VALUE_ROUNDTRIP_CASES` value faithfully
 * (`turso-value-roundtrip-conformance.test.ts`, both halves green). They get
 * there by different routes: #12380 made the local `Field.json` codec
 * injective, so what reaches the NUMERIC-affinity column is an encoded form
 * that affinity has nothing to convert; the remote transport's own
 * `serializeValue`/`mapRows` reach the same answer over a column where no
 * conversion was available in the first place.
 *
 * ⚠️ Equal answers, unequal bytes. Measured on the fixture below: of the cases
 * in the shared table, the two transports store **different storage classes**
 * for `n_int` and `n_real` — an INTEGER/REAL cell locally, a TEXT cell
 * remotely — while both `find()` calls answer `123` and `1.5`. That is the
 * #11535 class in its quiet phase: two paths that agree on every visible
 * answer while standing on different ground, so the next codec change has no
 * reason to be kind to both. PR #12585's ablation is the loud phase — restoring
 * the pre-#12380 SQLite `json` branch broke the two transports by DIFFERENT
 * counts, diverging on `s_0123`, because only the local column's NUMERIC
 * affinity was there to destroy a bare `'0123'`.
 *
 * ## ⛔ What to do when this file goes red
 *
 * It goes red when one transport's emitted type for `Field.json` moves and the
 * other's does not, or when they are made to converge. Both are real decisions
 * and this pin exists so they are taken **knowingly**:
 *
 * - **Converging them** (#12586 disposition 1) changes what new columns are
 *   physically declared as, and is deliberately NOT done here: it needs "why
 *   did remote choose `TEXT`?" answered first, which is un-measured. File it,
 *   measure it, and then **delete or invert this pin** as part of that change.
 * - ⛔ **Never patch the expectations green.** Editing the tables below to
 *   match whatever the code now emits turns this file from a record of a
 *   decision into a mirror of the code, which is the one thing it cannot be
 *   and still be worth running.
 *
 * ## The instrument
 *
 * The fixture is `VALUE_ROUNDTRIP_FIELDS` / `VALUE_ROUNDTRIP_CASES` — the same
 * shared table `turso-value-roundtrip-conformance.test.ts` drives, for the
 * reason #12586 named it: the case-set already covers both transports, so the
 * pin and the round-trip conformance answer questions about the same columns
 * and the same written values, and cannot drift onto different fixtures.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/12586 (this pin)
 * @see https://github.com/objectstack-ai/objectstack/issues/12380 (the injective local codec)
 * @see https://github.com/objectstack-ai/objectstack/issues/11535 (the class)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  VALUE_ROUNDTRIP_CASES,
  VALUE_ROUNDTRIP_FIELDS,
  VALUE_ROUNDTRIP_ROWS,
} from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const TABLE = 'asymmetry_12586';
const OBJECT = { name: TABLE, fields: { ...VALUE_ROUNDTRIP_FIELDS } };

/** The fixture's own declared columns — the builtins are a different question. */
const DECLARED_COLUMNS = Object.keys(VALUE_ROUNDTRIP_FIELDS);

/**
 * The two transports' declared types, read from the CATALOG rather than from
 * the DDL string either side emitted. A pin that read the emitted DDL would be
 * asserting that a builder said something, not that SQLite recorded it.
 */
type TypeMap = Record<string, string>;

const catalogSql = (table: string) => `select name, type from pragma_table_info('${table}')`;

const toTypeMap = (rows: Array<{ name: string; type: string }>): TypeMap =>
  Object.fromEntries(
    rows.filter((r) => DECLARED_COLUMNS.includes(r.name)).map((r) => [r.name, r.type]),
  );

/**
 * The storage class SQLite actually put in each cell, per case.
 *
 * `typeof(col)` is the observable consequence of affinity, and it is what this
 * file is really about — an affinity label derived from the type NAME by the
 * rules in prose would be this file asserting its own reasoning back at itself.
 */
const storageSql = (table: string) =>
  `select label, ${DECLARED_COLUMNS.filter((c) => c !== 'label')
    .map((c) => `typeof("${c}") as "t_${c}"`)
    .join(', ')} from "${table}"`;

const storageClassOf = (rows: any[]): Map<string, string> => {
  const byLabel = new Map(rows.map((r) => [r.label as string, r]));
  const out = new Map<string, string>();
  for (const c of VALUE_ROUNDTRIP_CASES) out.set(c.name, byLabel.get(c.name)?.[`t_${c.column}`]);
  return out;
};

describe('[#12586] driver-turso — the Field.json column type is deliberately asymmetric across the two transports', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;
  let localTypes: TypeMap;
  let remoteTypes: TypeMap;
  let localStorage: Map<string, string>;
  let remoteStorage: Map<string, string>;

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT]);
    for (const row of VALUE_ROUNDTRIP_ROWS) {
      await local.create(TABLE, { ...row }, { bypassTenantAudit: true });
    }
    localTypes = toTypeMap((await local.execute(catalogSql(TABLE))) as never);
    localStorage = storageClassOf((await local.execute(storageSql(TABLE))) as never);

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://asymmetry.turso.io', client: stub as never });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(TABLE, OBJECT);
    for (const row of VALUE_ROUNDTRIP_ROWS) await remote.create(TABLE, { ...row });
    // The remote half reads through the stub's own database handle — the seam
    // the testkit publishes for exactly this ("for asserting on what actually
    // landed on disk"). The transport has no knex connection to ask.
    remoteTypes = toTypeMap(stub.raw.prepare(catalogSql(TABLE)).all() as never);
    remoteStorage = storageClassOf(stub.raw.prepare(storageSql(TABLE)).all() as never);
  }, 60_000);

  afterAll(async () => {
    await local.disconnect();
    await remote.disconnect();
    stub?.close();
  });

  // ─── §1 What each side declares ──────────────────────────────────────────

  it('local mode declares the fixture through knex — `json` for both JSON routes', () => {
    expect(localTypes).toEqual({
      label: 'varchar(255)',
      v_json: 'json',
      v_multi: 'json',
      v_string: 'varchar(255)',
      v_number: 'float',
      v_boolean: 'boolean',
    });
  });

  it("remote mode declares the fixture through RemoteTransport.mapFieldTypeToSQL — `TEXT` for both JSON routes", () => {
    expect(remoteTypes).toEqual({
      label: 'TEXT',
      v_json: 'TEXT',
      v_multi: 'TEXT',
      v_string: 'TEXT',
      v_number: 'REAL',
      v_boolean: 'INTEGER',
    });
  });

  // ─── §2 The asymmetry, named ─────────────────────────────────────────────

  it('THE ASYMMETRY: one declared Field.json, two physical column types — intended, not an oversight', () => {
    expect(
      [localTypes.v_json, remoteTypes.v_json],
      'The local/remote pair for a declared `Field.json`. If this is red because the two now AGREE, ' +
        'that is #12586 disposition 1 (convergence) — a decision this pin exists to make deliberate. ' +
        'Delete or invert this file as part of that change; do NOT edit the expectation to match.',
    ).toEqual(['json', 'TEXT']);
    expect(
      [localTypes.v_multi, remoteTypes.v_multi],
      'The same asymmetry reached by the OTHER route: `multiple: true` short-circuits before the ' +
        'type switch on both sides, so it can move independently of `type: "json"`.',
    ).toEqual(['json', 'TEXT']);
  });

  // ─── §3 The mechanism, measured rather than argued ───────────────────────

  it('THE MECHANISM: the local column converts a bare number-like string on the way in, the remote one does not', async () => {
    // Written with raw SQL on purpose: this asks what the COLUMN does, so it
    // has to bypass the driver codec whose job is to make the column's answer
    // not matter. The value is the ablation's own divergent case.
    const bare = VALUE_ROUNDTRIP_CASES.find((c) => c.name === 's_0123')!.wrote as string;
    const probe = `${TABLE}_bare`;

    await local.execute(`create table "${probe}" ("v" ${localTypes.v_json})`);
    await local.execute(`insert into "${probe}" ("v") values ('${bare}')`);
    const localCell: any = await local.execute(`select typeof(v) as ty, v as v from "${probe}"`);

    stub.raw.prepare(`create table "${probe}" ("v" ${remoteTypes.v_json})`).run();
    stub.raw.prepare(`insert into "${probe}" ("v") values ('${bare}')`).run();
    const remoteCell: any = stub.raw.prepare(`select typeof(v) as ty, v as v from "${probe}"`).all();

    expect(
      { local: localCell[0], remote: remoteCell[0] },
      'NUMERIC affinity (local `json`) destroys the leading zero; TEXT affinity (remote `TEXT`) does not. ' +
        'This is the "why it is safe today" of #12586: the local codec never hands this column a bare ' +
        'number-like string, and #12380 is what made that true.',
    ).toEqual({
      local: { ty: 'integer', v: 123 },
      remote: { ty: 'text', v: bare },
    });
  });

  // ─── §4 The consequence on the values the drivers really write ───────────

  it('THE CONSEQUENCE: equal answers, unequal bytes — the two transports diverge on exactly two cases', () => {
    const divergent = VALUE_ROUNDTRIP_CASES.filter(
      (c) => localStorage.get(c.name) !== remoteStorage.get(c.name),
    ).map((c) => `${c.name}(${c.column}): local=${localStorage.get(c.name)} remote=${remoteStorage.get(c.name)}`);

    expect(
      divergent,
      `Every value in VALUE_ROUNDTRIP_CASES written through each transport's own create(), compared by ` +
        `the storage class it landed in. Both transports READ every one of them back faithfully — that is ` +
        `turso-value-roundtrip-conformance.test.ts, and it is green either way, which is exactly why this ` +
        `pin is a separate file. An EMPTY list here means the transports have converged; a LONGER list ` +
        `means one side moved. Both are decisions, neither is a broken expectation.`,
    ).toEqual([
      'n_int(v_json): local=integer remote=text',
      'n_real(v_json): local=real remote=text',
    ]);
  });

  it('CONTROL: every non-JSON column agrees on storage class across the transports, though none agrees on spelling', () => {
    const jsonRoutes = new Set(['v_json', 'v_multi']);
    const scalarCases = VALUE_ROUNDTRIP_CASES.filter((c) => !jsonRoutes.has(c.column));
    expect(scalarCases.length, 'the control must not be empty').toBeGreaterThan(0);

    // Same-class despite different spellings — `varchar(255)`/`TEXT`,
    // `float`/`REAL`, `boolean`/`INTEGER`. This is the half that proves the
    // divergence above is about affinity and not about the two authors simply
    // writing different words.
    for (const c of scalarCases) {
      expect(localStorage.get(c.name), `${c.name} (${c.column}) storage class`).toBe(
        remoteStorage.get(c.name),
      );
    }
    for (const col of ['v_string', 'v_number', 'v_boolean']) {
      expect(localTypes[col], `${col} spelling must still differ across transports`).not.toBe(
        remoteTypes[col],
      );
    }
  });
});
