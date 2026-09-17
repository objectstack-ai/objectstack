// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18408] The remote transport's column builder asks the ONE definition of
 * "is this field multi-valued" — `@objectstack/spec`'s `isMultiValueField` —
 * and ⛔ not the raw `field.multiple` flag.
 *
 * ## The ruling this file pins
 *
 * Maintainer, 2026-09-13 (decision batch #128 item 5, option 1′): there is ONE
 * definition of "multi-valued", `isMultiValueField`, and **storage follows it**.
 * `driver-sql` was aligned by #17469 and `os generate migration` by #18199.
 * `RemoteTransport.mapFieldTypeToSQL` was the remaining storage side reading the
 * flag raw, and it short-circuits the whole type switch on it.
 *
 * ## The measured consequence, inside ONE driver
 *
 * `TursoDriver` is dual-transport: local/replica mode extends `SqlDriver` —
 * aligned since #17469 — while remote mode spells its own column types here. So
 * the same declaration reached two different storage classes depending on which
 * URL the deployment happened to hold:
 *
 * ```text
 *  declared field                        local (SqlDriver, aligned #17469)   remote (before #18408)
 *  ------------------------------------  ---------------------------------  ----------------------
 *  { type: 'number',  multiple: true }   float   (REAL affinity)             TEXT
 *  { type: 'boolean', multiple: true }   boolean                             TEXT
 *  { type: 'lookup',  multiple: true }   TEXT    (genuinely multi-valued)    TEXT
 * ```
 *
 * The first two rows are the defect: the flag is INERT on a type outside
 * `MULTI_CAPABLE_TYPES` ∪ `MULTI_OPTION_TYPES` — `FieldSchema` refuses it there
 * at the authoring entrance, and every aligned storage side ignores it — so the
 * remote transport was building a JSON-array column for a field nothing else in
 * the platform calls multi-valued. The third row is the control: `lookup` IS
 * multi-capable, the predicate answers `true`, and nothing about it moves.
 *
 * ## Reachability, stated so the pin is not over-graded
 *
 * `FieldSchema` refuses `multiple` on a non-capable type since #17469, so these
 * declarations arrive only through doors that never run it — `syncSchema` /
 * `initObjects` on a raw object definition, which is exactly what a driver test
 * calls and what `registerExternalObject` does in production (#18199's bounding
 * argument). Reachable, no longer authorable.
 *
 * ## ⛔ What to do when this file goes red
 *
 * It goes red when the remote transport stops asking the one predicate, or when
 * the predicate's own type sets move under it. Both are decisions. ⛔ Never
 * edit the expectations to match new output — `isMultiValueField` is the
 * authority, and a disagreement means one side has to move, not that the pin
 * has to be re-baselined.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/18408 (this alignment)
 * @see https://github.com/objectstack-ai/objectstack/issues/17469 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/18199 (the CLI half)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isMultiValueField } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const TABLE = 'multi_value_18408';

/**
 * One column per verdict of the one predicate, plus the two controls.
 *
 * `v_number_multi` / `v_boolean_multi` carry the flag on a type the predicate
 * calls SINGLE-valued; `v_lookup_multi` carries it on a multi-capable type;
 * `v_multiselect` is inherently multi and carries NO flag — the direction a raw
 * read gets wrong in the other sense; `v_text_multi` is the control for the
 * alignment moving only what the predicate moves (a `text` column is TEXT on
 * both sides of the change).
 */
const FIELDS = {
  v_number_multi: { type: 'number', multiple: true },
  v_boolean_multi: { type: 'boolean', multiple: true },
  v_text_multi: { type: 'text', multiple: true },
  v_lookup_multi: { type: 'lookup', multiple: true },
  v_multiselect: { type: 'multiselect' },
} as const;

const DECLARED_COLUMNS = Object.keys(FIELDS);
const OBJECT = { name: TABLE, fields: { ...FIELDS } };

const catalogSql = (table: string) => `select name, type from pragma_table_info('${table}')`;

const toTypeMap = (rows: Array<{ name: string; type: string }>): Record<string, string> =>
  Object.fromEntries(
    rows.filter((r) => DECLARED_COLUMNS.includes(r.name)).map((r) => [r.name, r.type]),
  );

/** One row, one value per declared column — the §2 probe's whole input. */
const ROW = {
  id: 'row_18408',
  v_number_multi: 12.5,
  v_boolean_multi: true,
  v_text_multi: 'abc',
  v_lookup_multi: ['rec_1', 'rec_2'],
  v_multiselect: ['a', 'b'],
};

const storageSql = (table: string) =>
  `select ${DECLARED_COLUMNS.map((c) => `typeof("${c}") as "t_${c}"`).join(', ')} from "${table}"`;

/** `typeof(col)` per column — the storage class SQLite actually chose. */
const storageClassOf = (rows: any[]): Record<string, string> =>
  Object.fromEntries(DECLARED_COLUMNS.map((c) => [c, rows[0]?.[`t_${c}`]]));

describe('[#18408] driver-turso remote — the multi-value short-circuit is the spec predicate', () => {
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;
  let remoteTypes: Record<string, string>;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://multi-value-18408.turso.io', client: stub as never });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(TABLE, OBJECT);
    remoteTypes = toTypeMap(stub.raw.prepare(catalogSql(TABLE)).all() as never);
    await remote.create(TABLE, { ...ROW });
  }, 60_000);

  afterAll(async () => {
    await remote.disconnect();
    stub?.close();
  });

  // ─── §1 The site under test ──────────────────────────────────────────────

  it('THE SITE: the flag no longer short-circuits the type switch on a single-valued type', () => {
    // Before #18408 every one of these five read `TEXT`, because
    // `if (field.multiple) return 'TEXT'` ran before the switch and the four
    // flagged declarations all carry the flag. Three of them are types the one
    // definition calls single-valued.
    expect(remoteTypes).toEqual({
      v_number_multi: 'REAL',
      v_boolean_multi: 'INTEGER',
      v_text_multi: 'TEXT',
      v_lookup_multi: 'TEXT',
      v_multiselect: 'TEXT',
    });
  });

  it('THE AUTHORITY: every column agrees with `isMultiValueField`, asked directly', () => {
    // The pin above states the answers; this one states WHY they are the
    // answers, against the predicate itself rather than a table reproduced by
    // hand. A multi-valued field takes the JSON-array route (`TEXT`); a
    // single-valued one takes the route its own type names.
    const multiValued = DECLARED_COLUMNS.filter((c) =>
      isMultiValueField(FIELDS[c as keyof typeof FIELDS] as never),
    );
    expect(multiValued.sort()).toEqual(['v_lookup_multi', 'v_multiselect']);
    for (const c of multiValued) expect(remoteTypes[c], `${c} is multi-valued`).toBe('TEXT');
    // And the flag alone is not what decides it: FOUR columns carry
    // `multiple: true` and only one of them is on that list, while a column
    // that carries no flag at all IS on it.
    const flagged = DECLARED_COLUMNS.filter(
      (c) => (FIELDS[c as keyof typeof FIELDS] as { multiple?: boolean }).multiple === true,
    );
    expect(flagged.sort()).toEqual([
      'v_boolean_multi', 'v_lookup_multi', 'v_number_multi', 'v_text_multi',
    ]);
  });

  // ─── §2 The consequence: one driver, one storage class ───────────────────

  it('THE CONSEQUENCE: the two transports of this ONE driver land each value in the same storage class', async () => {
    // Measured on the STORAGE CLASS of a written value, ⛔ not on the declared
    // type string and ⛔ not on the affinity label derived from it. The two
    // authors of DDL write different words for the same class by design
    // (`float`/`REAL`, `boolean`/`INTEGER`), and one of those pairs does not
    // even share an affinity label — `boolean` takes NUMERIC by SQLite's own
    // rule while `INTEGER` takes INTEGER — yet both put 0/1 in an integer cell.
    // That is the recorded cosmetic asymmetry (#12586 header), and asserting on
    // labels would report it as this change's divergence. `typeof(col)` is the
    // observable both #12738 and this file are actually about.
    const local = new TursoDriver({ url: ':memory:' });
    try {
      expect(local.transportMode).toBe('local');
      await local.initObjects([OBJECT]);
      await local.create(TABLE, { ...ROW }, { bypassTenantAudit: true });
      const localStorage = storageClassOf((await local.execute(storageSql(TABLE))) as never);
      const remoteStorage = storageClassOf(stub.raw.prepare(storageSql(TABLE)).all() as never);

      const divergent = DECLARED_COLUMNS.filter(
        (c) => localStorage[c] !== remoteStorage[c],
      ).map((c) => `${c}: local=${localStorage[c]} remote=${remoteStorage[c]}`);

      expect(
        divergent,
        'Each declared field, compared by the storage class the value landed in on each transport. ' +
          'An EMPTY list is the #18408 post-state: one definition of multi-valued, so one storage ' +
          'class per declaration whichever transport built the column. Before #18408 this list held ' +
          '`v_number_multi: local=real remote=text` — the flag bought a JSON-array column from the ' +
          'remote transport for a field the one definition calls single-valued. A NON-EMPTY list ' +
          'means one side moved: a decision, not a broken expectation.',
      ).toEqual([]);
    } finally {
      await local.disconnect();
    }
  }, 60_000);
});
