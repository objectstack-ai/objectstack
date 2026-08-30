// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12738] **INVERTED.** This file was created by #12586 to pin an ASYMMETRY —
 * a declared `Field.json` became a `json` column on the local transport and a
 * `TEXT` column on the remote one. That asymmetry is **gone**, deliberately,
 * and this file now pins the convergence and the affinity that replaced it.
 *
 * ```text
 *  declared field    local (TursoDriver extends SqlDriver, knex)   remote (RemoteTransport)
 *  ----------------  -------------------------------------------  ------------------------
 *  { type: 'json' }  TEXT   (was: json)                            TEXT   (unchanged)
 *  { multiple: true} TEXT   (was: json)                            TEXT   (unchanged)
 * ```
 *
 * ⚠️ Those are CATALOG readings, and the local one is worth a sentence because
 * it surprises. knex writes `` `v_json` text `` (lower case) into the stored
 * `CREATE TABLE` — measured in `sqlite_master` — and `pragma_table_info`
 * reports it back as `TEXT`. So the convergence is not merely onto one affinity
 * class, which is all the ruling required: the two transports turn out to
 * declare the **byte-identical** type string. The affinity assertion below is
 * still written as the primary one, because affinity is the property that
 * matters and an exact-string pin would go red over a cosmetic re-spelling.
 *
 * ## Why the pin was inverted rather than re-baselined
 *
 * The #12586 header instructed exactly this: *"When convergence is genuinely
 * taken on, delete or invert that pin as part of the change; never edit its
 * expectations to match new output."* The expectations below are not the old
 * ones nudged — every one of them states the OPPOSITE fact, on purpose, and the
 * old fact is quoted beside it so the change is legible.
 *
 * ## The ruling that moved it
 *
 * Maintainer, 2026-08-28 (recorded on #12738): each dialect declares the
 * semantically correct JSON column type. Server dialects keep their native JSON
 * types; the **SQLite family declares `text`** — what SQLite's JSON1 functions
 * actually operate on, and what `RemoteTransport.mapFieldTypeToSQL` had spelled
 * all along. So the two transports converge onto the side **without** the
 * affinity trap: it is the LOCAL half that moved.
 *
 * ⛔ The other direction was refused by name. Converging onto `json` would have
 * given the remote transport NUMERIC affinity — `json` contains none of
 * SQLite's affinity markers (`INT`, `CHAR`/`CLOB`/`TEXT`, `BLOB`,
 * `REAL`/`FLOA`/`DOUB`) — i.e. the measured `'0123'` → `123` exposure that
 * #12380 had to defeat on the local half, imported into the half that never had
 * it.
 *
 * ## The instrument is AFFINITY-LEVEL, and that is a requirement, not a taste
 *
 * #12738's own content is a negative result: the shared `VALUE_ROUNDTRIP`
 * case-set is **green on both sides of this decision** (88 passed, unchanged
 * under convergence), because both transports round-trip every value faithfully
 * either way. It therefore cannot adjudicate the direction, and using it as
 * evidence is an error. What this file asserts instead, on **both** transports:
 *
 *  - the declared type each side records in the catalog;
 *  - `typeof(col)` — the **storage class** SQLite actually put in each cell,
 *    which is the observable consequence of affinity;
 *  - a raw-SQL bare `'0123'`, which must survive as **text** on both sides.
 *
 * The last one is the whole decision in one statement: before this change that
 * probe returned the integer `123` locally and the string `'0123'` remotely.
 *
 * ## What did NOT change
 *
 * Only what NEW columns are declared as. A column created before this change
 * keeps its `json` declaration, keeps NUMERIC affinity, and keeps being
 * defended by #12380's injective codec — `SqlDriver.buildRebuiltColumn` still
 * re-declares an introspected `json` column as `json`, so not even a drift
 * rebuild converts one. Nothing on the read path consults the physical type
 * (`isJsonField` answers from metadata), so decoding is identical either way.
 *
 * ## ⛔ What to do when this file goes red
 *
 * It goes red when the two transports stop agreeing, or when the type they
 * agree on stops being TEXT-affinity. Both are real decisions. ⛔ Never patch
 * the expectations green — editing the tables below to match whatever the code
 * now emits turns this file from a record of a decision into a mirror of the
 * code, which is the one thing it cannot be and still be worth running.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/12738 (this inversion)
 * @see https://github.com/objectstack-ai/objectstack/issues/12586 (the pin this replaces)
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

const TABLE = 'convergence_12738';
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

describe('[#12738] driver-turso — the two transports declare ONE physical column type for Field.json', () => {
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

  it('local mode declares the fixture through knex — `text` for both JSON routes (#12738; was `json`)', () => {
    // INVERTED. Before #12738 both JSON routes read `json` here — knex's
    // sqlite3 dialect overrides the base compiler's `text` with `json`
    // (`ColumnCompiler_SQLite3.prototype.json = 'json'`), naming a type SQLite
    // does not have. `SqlDriver.jsonColumn` now routes the SQLite family to
    // `table.text()` instead. Every non-JSON row below is untouched.
    expect(localTypes).toEqual({
      label: 'varchar(255)',
      v_json: 'TEXT',
      v_multi: 'TEXT',
      v_string: 'varchar(255)',
      v_number: 'float',
      v_boolean: 'boolean',
    });
  });

  it("remote mode declares the fixture through RemoteTransport.mapFieldTypeToSQL — `TEXT` for both JSON routes, UNCHANGED by #12738", () => {
    expect(remoteTypes).toEqual({
      label: 'TEXT',
      v_json: 'TEXT',
      v_multi: 'TEXT',
      v_string: 'TEXT',
      v_number: 'REAL',
      v_boolean: 'INTEGER',
    });
  });

  // ─── §2 The convergence, named ───────────────────────────────────────────

  it('THE CONVERGENCE: one declared Field.json, ONE affinity class on both transports (#12738)', () => {
    // INVERTED from `['json', 'TEXT']`. The pair is compared by AFFINITY, not
    // by spelling: the two authors of DDL still write different words for every
    // column (`varchar(255)`/`TEXT`, `float`/`REAL`, `boolean`/`INTEGER`), and
    // that was never the question. What #12586 recorded — and what #12738 fixed
    // — is that `json` was the one spelling that landed in a DIFFERENT affinity
    // class than its opposite number. Both now contain `TEXT`, so both take
    // TEXT affinity by SQLite's own rule.
    for (const [route, note] of [
      ['v_json', 'the `type: "json"` route'],
      ['v_multi', 'the `multiple: true` route, which short-circuits before the type switch on both sides'],
    ] as const) {
      const pair = [localTypes[route], remoteTypes[route]];
      expect(
        pair.map((t) => /char|clob|text/i.test(t)),
        `${route} — ${note}. Both transports must declare a TEXT-affinity type. If this is red ` +
          'because they DISAGREE again, one side moved: that is a decision, not a broken ' +
          'expectation. Fix the emitter, or invert this file again with the reason recorded — ' +
          'do NOT edit the expectation to match new output.',
      ).toEqual([true, true]);
    }
    // The spellings themselves, pinned so a silent move is legible in the diff.
    // They happen to be identical here — see the header note; that is a
    // measured bonus, not the contract the affinity check above states.
    expect([localTypes.v_json, remoteTypes.v_json]).toEqual(['TEXT', 'TEXT']);
    expect([localTypes.v_multi, remoteTypes.v_multi]).toEqual(['TEXT', 'TEXT']);
  });

  // ─── §3 The mechanism, measured rather than argued ───────────────────────

  it('THE MECHANISM: a bare number-like string survives as TEXT on BOTH transports now (#12738)', async () => {
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

    // INVERTED. Before #12738 this read `local: { ty: 'integer', v: 123 }` —
    // the local column's NUMERIC affinity ate the leading zero — against
    // `remote: { ty: 'text', v: '0123' }`. That difference IS the decision
    // #12738 took, and it is now closed in the safe direction: the local half
    // moved to the remote half's behaviour, never the reverse.
    //
    // ⛔ This is the assertion that would go red if anyone converged these two
    // onto `json` instead. It is stated as the RAW-SQL truth on purpose: it
    // asks what the COLUMN does, bypassing the driver codec whose job is to
    // make the column's answer not matter. #12380's codec still runs and is
    // still required — for LEGACY columns, which keep their `json` declaration
    // and therefore keep NUMERIC affinity.
    expect(
      { local: localCell[0], remote: remoteCell[0] },
      'A bare number-like string written by raw SQL must come back as TEXT, byte for byte, on BOTH ' +
        'transports. If the local half reads `{ ty: "integer", v: 123 }` again, the SQLite JSON ' +
        'column has regained NUMERIC affinity — the exposure #12380 defeated and #12738 removed at ' +
        'the root. Fix the emitter; do NOT edit this expectation.',
    ).toEqual({
      local: { ty: 'text', v: bare },
      remote: { ty: 'text', v: bare },
    });
  });

  it('THE MECHANISM, CONTROL: a column still declared `json` DOES eat it — so the probe can fail', async () => {
    // The negative control the inverted mechanism test needs. Without it, a
    // probe that returned 'text' because the write silently stopped happening
    // would read exactly like a pass. This creates the LEGACY shape by hand —
    // a column explicitly declared `json`, which is what every pre-#12738
    // deployment holds — and shows the affinity is real, present, and still
    // eating bare values on this very SQLite build.
    const bare = VALUE_ROUNDTRIP_CASES.find((c) => c.name === 's_0123')!.wrote as string;
    const legacy = `${TABLE}_legacy_json`;

    await local.execute(`create table "${legacy}" ("v" json)`);
    await local.execute(`insert into "${legacy}" ("v") values ('${bare}')`);
    const cell: any = await local.execute(`select typeof(v) as ty, v as v from "${legacy}"`);

    expect(
      cell[0],
      'NUMERIC affinity on a `json`-declared SQLite column, measured on the same build that answers ' +
        '`text` above. This is why legacy columns keep #12380 in force, and why #12738 changes only ' +
        'what NEW columns are declared as.',
    ).toEqual({ ty: 'integer', v: 123 });
  });

  // ─── §4 The consequence on the values the drivers really write ───────────

  it('THE CONSEQUENCE: equal answers AND equal bytes — the transports diverge on NOTHING (#12738)', () => {
    const divergent = VALUE_ROUNDTRIP_CASES.filter(
      (c) => localStorage.get(c.name) !== remoteStorage.get(c.name),
    ).map((c) => `${c.name}(${c.column}): local=${localStorage.get(c.name)} remote=${remoteStorage.get(c.name)}`);

    // INVERTED. This list held exactly two entries before #12738 —
    // `n_int(v_json): local=integer remote=text` and
    // `n_real(v_json): local=real remote=text` — the #11535 class in its quiet
    // phase: two paths agreeing on every visible ANSWER while standing on
    // different ground. The ground is now the same, so the list is empty.
    //
    // ⚠️ Note what this is NOT evidence of. The round-trip case-set is green on
    // both sides of the decision (88 passed, unchanged under convergence), so
    // it could never have adjudicated the direction. THIS is the measurement
    // that can: it compares the storage class, not the answer.
    expect(
      divergent,
      `Every value in VALUE_ROUNDTRIP_CASES written through each transport's own create(), compared by ` +
        `the storage class it landed in. An EMPTY list is the #12738 post-state: the two transports ` +
        `store the same bytes as well as answering the same values. A NON-EMPTY list means one side ` +
        `moved — a decision, not a broken expectation. Fix the emitter, or invert this file with the ` +
        `reason recorded.`,
    ).toEqual([]);
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
