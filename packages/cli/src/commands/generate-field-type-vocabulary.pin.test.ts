// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE #13871 PIN: every field type `generate.ts` keys on is a real `FieldType`
 * member.
 *
 * ## The defect
 *
 * `generate.ts` carries THREE hand-authored field-type vocabularies — the
 * `FIELD_TYPE_MAP` that `os generate types` reads, the `FIELD_TYPE_SQL_MAP`
 * that `os generate migration --format sql` reads, and the `switch (fType)`
 * that `os generate migration` (typescript, the DEFAULT format) reads. None of
 * the three was ever derived from, or checked against, the `FieldType` enum
 * they claim to describe, and all three had drifted into naming types that do
 * not exist: `slug`, `ip_address`, `encrypted`, `integer`, `uuid` — plus
 * `geo_point` in the two maps.
 *
 * History says these are not leftovers of retired spec types. `git log -S` over
 * the whole reachable history of `packages/spec/src/data/field.zod.ts` returns
 * ZERO commits for every one of those tokens: they never existed on the other
 * side. They were invented in the CLI (the maps in "Phase 9 … generate types
 * CLI", the migration codegen mirroring that vocabulary six hours later) and
 * propagated table-to-table inside this one file.
 *
 * ## Why it matters even though the arms were unreachable
 *
 * Measured on both doors into the codegen:
 *
 *   - Through every SUPPORTED authoring path the arms are dead. `os init`
 *     scaffolds `export default defineStack({ … })` and every config in this
 *     repo goes through a `define*` helper, which is a strict `Schema.parse`.
 *     A field typed `slug` is refused during config-module evaluation, inside
 *     `bundleRequire`, before the codegen runs a line — with a named
 *     `Invalid field type 'slug'` diagnostic.
 *   - Through the UNVALIDATED door (a plain-object config export, or
 *     `defineStack(x, { strict: false })`) nothing parses, any string reaches
 *     `fType`, and the ghost arms fire: `slug` emitted `table.string`,
 *     `integer` emitted `table.integer`.
 *
 * So the labels never served a valid input, and on the one input class that
 * could reach them they advertised an acceptance surface the runtime cannot
 * honour. That is the hazard: a vocabulary is a claim about what the platform
 * accepts, and an AI or a human reading this switch to learn the field types
 * would learn four that do not exist.
 *
 * ## What this pin asserts
 *
 * BOTH DIRECTIONS, since #14657.
 *
 * FORWARD (#13871): every token the three vocabularies key on is a `FieldType`
 * member.
 *
 * BACKWARD (#14657): every `FieldType` member is keyed on by all three. #13871
 * deliberately did not assert this, because "what column type does each
 * unmapped member deserve" was an open question; #14657 answered it member by
 * member and this half became assertable. It matters because the gap was
 * SILENT: 21 real members had no entry in either map (24 in the switch), and
 * every one of them generated a plausible-looking wrong schema — TS `unknown`,
 * a `TEXT` / `table.text` column — with nothing to tell the author. `secret`
 * and `location` were among them.
 *
 * The two lookup tables carry the same rule a second time as
 * `satisfies Record<FieldType, string>`, which makes a missing member a named
 * `tsc` error (`packages/cli` type-checks `src/**`) as well as a red test. That
 * annotation is itself pinned below: the extractor here REQUIRES it as each
 * table's terminator, so deleting it cannot quietly demote the type-level half
 * to nothing. The `switch` cannot carry a `satisfies` — its scrutinee is a
 * plain `string` off an unvalidated config — so for that vocabulary this file
 * is the only mechanism, which is why the totality assertion lives here rather
 * than being left to the compiler.
 *
 * ## The #14828 half: the VALUE, for the classes whose answer is derivable
 *
 * #13871 and #14657 both measured PRESENCE only, and said so: "a
 * wrong-but-present entry is a different defect (`autonumber: 'SERIAL'` against
 * a runtime that writes a rendered string, `formula` given a column the runtime
 * never creates), filed separately rather than pinned here on a guess." That
 * card is #14828, and this is where its rule lands — as the triage note said it
 * should, because a FOURTH hand-carried table of right answers would be the
 * same defect one file over.
 *
 * So nothing below transcribes a value. Each rule is one of:
 *
 *   - a SPEC CLASS the driver derives its own behaviour from (`MULTI_OPTION_TYPES`,
 *     `STRUCTURED_JSON_TYPES`, `REFERENCE_VALUE_TYPES` — imported, swept, never
 *     listed here), asserted against what the generators actually EMIT;
 *   - the DRIVER'S OWN SOURCE, read where it lives, for the questions the spec
 *     does not answer — which types are virtual, and what a reference column's
 *     physical shape is. ⛔ The driver is the authority for which column
 *     exists; the spec's `isMultiValueField` is the ADR-0104 D1 VALUE contract
 *     and answers a different question (#14829's pin argues this in full);
 *   - or the file's INTERNAL agreement — an array-typed answer in
 *     `FIELD_TYPE_MAP` and a scalar column in `FIELD_TYPE_SQL_MAP` is a
 *     contradiction whoever is right, and `autonumber` was exactly that.
 *
 * ⚠️ Still NOT asserted, deliberately: the FILE_REFERENCE_TYPES family. Those
 * five ARE in the driver's `JSON_COLUMN_TYPES` today while this generator gives
 * them a varchar — but that is #14657's ADR-0104 D3 answer against a driver
 * that is still pre-D3, i.e. a decision about which side moves, not a wrong
 * value to correct. It is recorded below as a measured divergence so it cannot
 * be mistaken for coverage, and filed rather than fixed here.
 *
 * The runtime fallbacks (`|| 'unknown'`, `|| 'TEXT'`, `default:`) stay and are
 * NOT dead: they answer a `type` string that is not a `FieldType` at all, which
 * the UNVALIDATED authoring door still delivers. Totality is over the enum, not
 * over every string that can reach the generator.
 *
 * The `FieldType` side is imported, never transcribed: a list written out here
 * would just relocate the drift into this file. And the vocabularies are read
 * out of `generate.ts` itself rather than re-declared, so a fourth vocabulary,
 * or a new label in an existing one, cannot arrive unmeasured — the structural
 * assertions below fail if the shapes this reader depends on move.
 *
 * Every extraction carries a NON-VACUITY control. An extractor that silently
 * matched nothing would make this whole file pass while measuring literally
 * nothing, which is the failure mode a source-reading pin has to buy its way
 * out of.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FieldType,
  FILE_REFERENCE_TYPES,
  MULTI_OPTION_TYPES,
  REFERENCE_VALUE_TYPES,
  STRUCTURED_JSON_TYPES,
} from '@objectstack/spec/data';
import { describe, expect, it } from 'vitest';

import { generateMigrationSql, generateMigrationTs, generateTypesFromConfig } from './generate.js';

const GENERATE_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'generate.ts');
const SOURCE = fs.readFileSync(GENERATE_TS, 'utf8');

/** The authority. Imported from the package that owns it, never transcribed. */
const REAL_FIELD_TYPES: ReadonlySet<string> = new Set(FieldType.options);

/**
 * `const NAME: Record<string, VALUE> = {` at top level — the lookup tables.
 *
 * `VALUE` is captured rather than fixed because `FIELD_TYPE_SQL_MAP` answers
 * `string | null` since #14828: `null` is the VIRTUAL answer (no column at
 * all), carried in the table so the two migration generators cannot disagree
 * about which fields materialise. The terminator each table must carry is
 * DERIVED from its own declared value type below, so widening one table cannot
 * quietly loosen the other's compile-time totality guarantee.
 */
const LOOKUP_TABLE_DECL = /^const (\w+): Record<string, (string(?: \| null)?)> = \{$/gm;

/** The one field-type switch in the migration (typescript) generator. */
const FIELD_TYPE_SWITCH = /switch \(fType\)/g;

function lookupTableNames(): string[] {
  return [...SOURCE.matchAll(LOOKUP_TABLE_DECL)].map((m) => m[1]);
}

/** The value type one lookup table declares — `string`, or `string | null`. */
function lookupTableValueType(name: string): string {
  const decl = [...SOURCE.matchAll(LOOKUP_TABLE_DECL)].find((m) => m[1] === name);
  if (!decl) throw new Error(`lookup table not found in generate.ts: ${name}`);
  return decl[2];
}

/**
 * The terminator every lookup table must carry — the type-level half of the
 * #14657 totality rule. Required rather than tolerated: if someone deletes the
 * annotation, extraction fails loudly here instead of the compiler silently
 * stopping to check.
 */
function tableTerminator(name: string): string {
  return `} satisfies Record<FieldType, ${lookupTableValueType(name)}>;`;
}

/** The keys of one top-level `Record<string, string>` table, in source order. */
function lookupTableKeys(name: string): string[] {
  const declaration = `const ${name}: Record<string, ${lookupTableValueType(name)}> = {`;
  const start = SOURCE.indexOf(declaration);
  if (start < 0) throw new Error(`lookup table not found in generate.ts: ${name}`);
  // Bound the table at ITS OWN closing line — the first line starting with `}`
  // after the declaration — and then require that line to be the terminator.
  // Searching for the terminator directly would silently run past a table
  // whose annotation was deleted and swallow the NEXT table's body, turning a
  // removed guard into a wrong measurement instead of a named failure.
  const closing = SOURCE.slice(start).search(/\n\}/);
  if (closing < 0) throw new Error(`unterminated lookup table in generate.ts: ${name}`);
  const end = start + closing;
  const closingLine = SOURCE.slice(end + 1, SOURCE.indexOf('\n', end + 1));
  if (closingLine !== tableTerminator(name)) {
    throw new Error(
      `${name} in generate.ts must be closed by \`${tableTerminator(name)}\`, but it is closed by ` +
      `\`${closingLine}\`. That annotation is the type-level half of the #14657 rule that every ` +
      'FieldType member has an entry: without it, adding a field type to the spec stops being a ' +
      'compile error here and goes back to silently generating `unknown` / a TEXT column.',
    );
  }
  const body = SOURCE.slice(start + declaration.length, end);
  return [...body.matchAll(/^ {2}([A-Za-z_][\w]*):/gm)].map((m) => m[1]);
}

/** The `case '…':` labels of the migration generator's field-type switch. */
function migrationSwitchLabels(): string[] {
  const start = SOURCE.search(FIELD_TYPE_SWITCH);
  if (start < 0) throw new Error('field-type switch not found in generate.ts');
  // The switch ends where the emitted column line is pushed, immediately after it.
  const end = SOURCE.indexOf('lines.push(', start);
  if (end < 0) throw new Error('could not bound the field-type switch in generate.ts');
  return [...SOURCE.slice(start, end).matchAll(/case '([^']+)':/g)].map((m) => m[1]);
}

describe('generate.ts field-type vocabularies (#13871)', () => {
  it('reads a real FieldType enum (control for the import)', () => {
    expect(REAL_FIELD_TYPES.size).toBeGreaterThan(40);
    for (const known of ['text', 'number', 'boolean', 'lookup', 'secret', 'address']) {
      expect(REAL_FIELD_TYPES.has(known)).toBe(true);
    }
  });

  it('has exactly the vocabularies this pin knows how to read', () => {
    // A fourth table, or a second field-type switch, must not arrive unmeasured.
    expect(lookupTableNames()).toEqual(['FIELD_TYPE_MAP', 'FIELD_TYPE_SQL_MAP']);
    expect(SOURCE.match(FIELD_TYPE_SWITCH)).toHaveLength(1);
  });

  for (const table of ['FIELD_TYPE_MAP', 'FIELD_TYPE_SQL_MAP'] as const) {
    it(`${table} keys on real field types only`, () => {
      const keys = lookupTableKeys(table);
      // Non-vacuity: an extractor that matched nothing would pass silently.
      expect(keys.length).toBeGreaterThan(20);
      expect(keys).toContain('text');
      expect(keys).toContain('boolean');

      const ghosts = keys.filter((k) => !REAL_FIELD_TYPES.has(k));
      expect(ghosts, `${table} keys on types that are not FieldType members`).toEqual([]);
    });
  }

  it('the migration generator switch cases on real field types only', () => {
    const labels = migrationSwitchLabels();
    // Non-vacuity: the switch really was read, and read whole.
    expect(labels.length).toBeGreaterThan(20);
    expect(labels).toContain('text');
    expect(labels).toContain('boolean');
    expect(labels).toContain('user');

    const ghosts = labels.filter((l) => !REAL_FIELD_TYPES.has(l));
    expect(ghosts, 'the field-type switch cases on types that are not FieldType members').toEqual([]);
  });

  // ── The #14657 half: no real member may go unmapped ──────────────────────
  //
  // Read this as one rule stated three times, not three rules: the authority is
  // `FieldType`, and each vocabulary is measured against it. A member added to
  // the spec with no answer here used to produce TS `unknown` and a `TEXT`
  // column in silence; it now names itself in a failing assertion.

  const VOCABULARIES: ReadonlyArray<readonly [string, () => string[]]> = [
    ['FIELD_TYPE_MAP (os generate types)', () => lookupTableKeys('FIELD_TYPE_MAP')],
    ['FIELD_TYPE_SQL_MAP (os generate migration --format sql)', () => lookupTableKeys('FIELD_TYPE_SQL_MAP')],
    ['the migration switch (os generate migration, typescript)', migrationSwitchLabels],
  ];

  for (const [label, read] of VOCABULARIES) {
    it(`${label} covers every FieldType member`, () => {
      const covered = new Set(read());
      // Non-vacuity: the same control the forward assertions buy. An extractor
      // that returned nothing would make "everything is missing" the finding,
      // not a silent pass — but state it anyway so the failure is legible.
      expect(covered.size).toBeGreaterThan(20);

      const unmapped = [...REAL_FIELD_TYPES].filter((t) => !covered.has(t));
      expect(
        unmapped,
        `${label} has no entry for these real FieldType members, so each one silently ` +
        'takes the generator default (TS `unknown` / a TEXT column). Add an entry — or, ' +
        'if the default is genuinely the right answer for it, say so with an explicit ' +
        'entry that spells the default out, so the decision is written down rather than ' +
        'left as an absence.',
      ).toEqual([]);
    });
  }

  it('the two lookup tables carry the type-level totality annotation', () => {
    // The runtime half above and the compile-time half must both be present:
    // `tsc` names a missing member at build time, this file names it in CI even
    // if the annotation is loosened. `lookupTableKeys` throws without it, so
    // this assertion is the readable statement of a rule already enforced.
    for (const table of ['FIELD_TYPE_MAP', 'FIELD_TYPE_SQL_MAP'] as const) {
      expect(
        SOURCE.includes(`const ${table}: Record<string, ${lookupTableValueType(table)}> = {`),
        `${table} declaration moved`,
      ).toBe(true);
      expect(() => lookupTableKeys(table)).not.toThrow();
      expect(SOURCE.includes(tableTerminator(table)), `${table} terminator moved`).toBe(true);
    }
    expect(
      SOURCE.match(/^\} satisfies Record<FieldType, string(?: \| null)?>;$/gm),
      'both FIELD_TYPE_MAP and FIELD_TYPE_SQL_MAP must close with the satisfies annotation ' +
      'that makes an unmapped FieldType member a compile error',
    ).toHaveLength(2);
  });
});


/* ────────────────────────────────────────────────────────────────────────────
 * #14828 — the VALUES, derived from the platform rather than retyped here
 * ──────────────────────────────────────────────────────────────────────────── */

/** `packages/drivers/driver-sql/src` — declared for `@objectstack/cli#test` in `turbo.json`. */
const DRIVER_SQL_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drivers/driver-sql/src');
const SQL_DRIVER_SOURCE = fs.readFileSync(path.join(DRIVER_SQL_SRC, 'sql-driver.ts'), 'utf8');
const SCHEMA_DRIFT_SOURCE = fs.readFileSync(path.join(DRIVER_SQL_SRC, 'schema-drift.ts'), 'utf8');

/**
 * The body of `SqlDriver.createColumn`'s `switch (type)` — THE authority on
 * which physical column a field type gets.
 *
 * Source-read rather than driven, for the reason #14829's pin already states:
 * `createColumn` is `protected` and needs a knex table builder, so exercising
 * it would mean a live driver and a built `dist`. What has to be pinned is its
 * DECISION, and that is legible in the source.
 */
function createColumnSwitch(): string {
  const start = SQL_DRIVER_SOURCE.indexOf('protected createColumn(');
  if (start < 0) throw new Error('createColumn moved or was renamed in driver-sql');
  const switchAt = SQL_DRIVER_SOURCE.indexOf('switch (type)', start);
  if (switchAt < 0) throw new Error('the per-type switch inside createColumn moved');
  const end = SQL_DRIVER_SOURCE.indexOf('\n    if (col) {', switchAt);
  if (end < 0) throw new Error("could not bound createColumn's switch in driver-sql");
  return SQL_DRIVER_SOURCE.slice(switchAt, end);
}

/**
 * The arm `createColumn` runs for one field type — from its `case` label to the
 * `break;` / `return;` that ends the arm — or `null` when the type has no case
 * at all and therefore takes the catch-all. `null` is a real answer here, which
 * is why the control below asserts a type that DOES have one.
 */
function createColumnArm(type: string): string | null {
  const body = createColumnSwitch();
  const at = body.indexOf(`case '${type}':`);
  if (at < 0) return null;
  // `.*` after the terminator keeps a trailing same-line comment — the driver
  // states this arm's whole reason there (`return; // Virtual — no column`) —
  // while `.` still cannot cross the newline that ends the arm.
  const arm = body.slice(at).match(/^[\s\S]*?(?:break;|return;).*/);
  if (!arm) throw new Error(`unterminated createColumn arm for '${type}' in driver-sql`);
  return arm[0];
}

/** `createColumn`'s catch-all — where an un-cased type lands. */
function createColumnDefaultArm(): string {
  const body = createColumnSwitch();
  const at = body.indexOf('default:');
  if (at < 0) throw new Error("createColumn's catch-all moved in driver-sql");
  return body.slice(at);
}

/** One object carrying one field of every real `FieldType` member. */
function probeConfig(): Record<string, unknown> {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const type of REAL_FIELD_TYPES) fields[`f_${type}`] = { type };
  return { objects: { probe: { name: 'probe', label: 'Probe', fields } } };
}

const TYPES_OUT = generateTypesFromConfig(probeConfig());
const SQL_OUT = generateMigrationSql(probeConfig());
const TS_OUT = generateMigrationTs(probeConfig());

/** The SQL column type one field type contributes, or `null` when it emits none. */
function sqlColumn(type: string): string | null {
  const m = SQL_OUT.match(new RegExp(`^ {2}"f_${type}" (.+?),?$`, 'm'));
  return m ? m[1] : null;
}

/** The `table.x('f_type')` call one field type contributes, or `null` for none. */
function tsColumn(type: string): string | null {
  const m = TS_OUT.match(new RegExp(`^ {4}(table\\.\\w+\\('f_${type}'\\)).*$`, 'm'));
  return m ? m[1] : null;
}

/** The declared property type one field type contributes to the generated interface. */
function tsInterfaceType(type: string): string {
  const m = TYPES_OUT.match(new RegExp(`^ {2}f_${type}\\??: (.+);$`, 'm'));
  if (!m) throw new Error(`no interface member emitted for ${type}`);
  return m[1];
}

/** How THIS generator spells a JSON column — read from its own `json` answer. */
const JSON_SQL = sqlColumn('json');
const JSON_TS_METHOD = 'table.jsonb';

describe('#14828 — the SQL answers are the platform’s, not this file’s inventions', () => {
  it('control — the driver source really loaded and its switch was really found', () => {
    expect(SQL_DRIVER_SOURCE.length).toBeGreaterThan(10_000);
    expect(SCHEMA_DRIFT_SOURCE.length).toBeGreaterThan(10_000);
    const body = createColumnSwitch();
    expect(body.length).toBeGreaterThan(1_000);
    // The extractor discriminates: a type WITH an arm returns one, and that arm
    // really is the type's own. Without this, `null` for every type would make
    // the catch-all assertions below pass while measuring nothing.
    expect(createColumnArm('boolean')).toContain('table.boolean(name)');
    expect(createColumnArm('lookup')).not.toBeNull();
    expect(createColumnArm('this_is_not_a_field_type')).toBeNull();
  });

  it('control — all three generators really emitted for the whole probe', () => {
    expect(TYPES_OUT).toContain('export interface ProbeRecord {');
    expect(SQL_OUT).toContain('CREATE TABLE IF NOT EXISTS "probe" (');
    expect(TS_OUT).toContain("await db.schema.createTable('probe'");
    expect(REAL_FIELD_TYPES.size).toBeGreaterThan(40);
    // Every member reached the TYPES output; the migration outputs are checked
    // per rule below, because one member deliberately emits no column at all.
    for (const type of REAL_FIELD_TYPES) expect(() => tsInterfaceType(type)).not.toThrow();
    expect(JSON_SQL, "this generator's own JSON spelling").toBe('JSONB');
  });

  // ── Rule 1: the virtual type materialises no column, on the driver's say-so ──
  //
  // The spec has no class for this: `COMPUTED_VALUE_TYPES` holds `formula`,
  // `summary` AND `autonumber`, and the latter two DO get columns. Which types
  // are virtual is the driver's answer alone, so it is read from the driver.

  it('driver-sql answers `formula` with no column at all', () => {
    const arm = createColumnArm('formula');
    expect(arm, 'formula lost its arm in createColumn').not.toBeNull();
    expect(arm, 'createColumn no longer returns without emitting for `formula`').toMatch(/\breturn;/);
    expect(arm, 'the formula arm now assigns a column').not.toContain('col =');
    expect(arm).toContain('Virtual');
    // The second statement of the same rule, in the differ.
    const at = SCHEMA_DRIFT_SOURCE.indexOf('export function fieldHasColumn(');
    expect(at, 'fieldHasColumn moved or was renamed in driver-sql').toBeGreaterThan(0);
    expect(SCHEMA_DRIFT_SOURCE.slice(at, at + 200)).toContain("!== 'formula'");
  });

  it('neither migration generator emits a column for a virtual field', () => {
    expect(
      sqlColumn('formula'),
      'os generate migration --format sql created a column for a `formula` field. The runtime ' +
      'never writes it: driver-sql answers `case ‘formula’: return; // Virtual — no column`, ' +
      'and schema-drift’s `fieldHasColumn` answers false for it.',
    ).toBeNull();
    expect(
      tsColumn('formula'),
      'os generate migration (typescript) created a column for a `formula` field — see above.',
    ).toBeNull();
    // Anti-vacuity: the readers are not simply blind. A sibling in the SAME
    // output still resolves, so "no column" is a measurement, not a miss.
    expect(sqlColumn('text')).not.toBeNull();
    expect(tsColumn('text')).not.toBeNull();
    // And a formula field is still part of the RECORD — only of no column.
    expect(tsInterfaceType('formula')).toBe('unknown');
  });

  // ── Rule 2: the JSON classes take the JSON column ────────────────────────
  //
  // Swept from the two spec classes the driver seeds `JSON_COLUMN_TYPES` from,
  // imported and never listed here. FILE_REFERENCE_TYPES is the third seed and
  // is deliberately NOT swept — see the recorded divergence below.

  const JSON_CLASS_TYPES = [...MULTI_OPTION_TYPES, ...STRUCTURED_JSON_TYPES];

  it('control — the JSON value classes really loaded', () => {
    expect(JSON_CLASS_TYPES.length).toBeGreaterThanOrEqual(9);
    expect(MULTI_OPTION_TYPES.has('multiselect')).toBe(true);
    expect(STRUCTURED_JSON_TYPES.has('vector')).toBe(true);
    // The discriminating half: a type OUTSIDE these classes must not be JSON,
    // or "JSONB everywhere" would satisfy the sweep below.
    expect(MULTI_OPTION_TYPES.has('text') || STRUCTURED_JSON_TYPES.has('text')).toBe(false);
    expect(sqlColumn('text')).not.toBe(JSON_SQL);
    expect(tsColumn('text')).not.toContain(JSON_TS_METHOD);
  });

  for (const type of JSON_CLASS_TYPES) {
    it(`${type} takes a JSON column in both migration generators`, () => {
      expect(
        sqlColumn(type),
        `${type} is in the spec class driver-sql seeds JSON_COLUMN_TYPES from, so the runtime ` +
        'stores it in a JSON column and this generator must emit one too.',
      ).toBe(JSON_SQL);
      expect(tsColumn(type)).toBe(`${JSON_TS_METHOD}('f_${type}')`);
    });
  }

  // ── Rule 3: one reference class, one column shape ────────────────────────

  it('driver-sql gives a reference column the default string column, not a uuid', () => {
    const arm = createColumnArm('lookup');
    expect(arm).toContain('table.string(name)');
    expect(arm, 'driver-sql does not give a lookup a uuid column').not.toContain('table.uuid(');
    // `master_detail` is not cased at all — it lands in the catch-all, which
    // routes by JSON membership and otherwise spells the same call.
    expect(createColumnArm('master_detail')).toBeNull();
    expect(createColumnDefaultArm()).toContain('JSON_COLUMN_TYPES.has(type) ? this.jsonColumn(table, name) : table.string(name)');
    expect(REFERENCE_VALUE_TYPES.has('master_detail')).toBe(true);
    expect(MULTI_OPTION_TYPES.has('master_detail') || STRUCTURED_JSON_TYPES.has('master_detail')).toBe(false);
  });

  it('every REFERENCE_VALUE_TYPES member takes one and the same column', () => {
    expect(REFERENCE_VALUE_TYPES.size).toBeGreaterThanOrEqual(4);
    const answers = new Set([...REFERENCE_VALUE_TYPES].map((t) => sqlColumn(t)));
    expect(
      [...answers],
      'the reference types disagree about their column width. A reference column holds the ' +
      "TARGET's `id`, which driver-sql emits as `table.string('id').primary()` — one shape for " +
      'the whole class, never a per-type guess.',
    ).toHaveLength(1);
    for (const type of REFERENCE_VALUE_TYPES) {
      expect(sqlColumn(type)).toMatch(/^VARCHAR\(\d+\)$/);
      expect(
        tsColumn(type),
        `os generate migration (typescript) gave a ${type} column something other than a string ` +
        'column. A platform id is 26 characters (driver-sql spells one out in its lookup arm), ' +
        'so a `uuid` column refuses it outright on Postgres with 22P02.',
      ).toBe(`table.string('f_${type}')`);
    }
    // The width is knex's default for a bare `table.string(name)`, which is the
    // call driver-sql makes for the id column itself.
    expect(SQL_DRIVER_SOURCE).toContain("table.string('id').primary();");
    expect(sqlColumn('lookup')).toBe('VARCHAR(255)');
  });

  // ── Rule 4: the file's own vocabularies may not contradict each other ────
  //
  // `autonumber` was exactly this: `FIELD_TYPE_MAP` said `string` and
  // `FIELD_TYPE_SQL_MAP` said `SERIAL`. No outside authority is needed to call
  // that wrong, and the same rule catches an array-typed member given a scalar
  // column, which is how `multiselect` and `vector` read before this card.

  it('a member typed as an ARRAY on the record takes a JSON column', () => {
    const arrayTyped = [...REAL_FIELD_TYPES].filter((t) => tsInterfaceType(t).endsWith('[]'));
    expect(arrayTyped.length, 'no array-typed members found — the reader is broken').toBeGreaterThanOrEqual(5);
    for (const type of arrayTyped) {
      expect(sqlColumn(type), `${type} is an array on the record but a scalar column`).toBe(JSON_SQL);
      expect(tsColumn(type)).toBe(`${JSON_TS_METHOD}('f_${type}')`);
    }
    // Anti-vacuity: a scalar member is NOT array-typed and does NOT take JSON.
    expect(arrayTyped).not.toContain('text');
  });

  it('a member typed as a STRING on the record never takes a NUMERIC column', () => {
    // ⚠️ Deliberately "not numeric" rather than "is a character column".
    // `date` / `datetime` / `time` are strings on the record and take DATE /
    // TIMESTAMP / TIME columns, which is correct — a rule demanding a varchar
    // would report those three as defects. What `autonumber` did is the
    // narrower thing: a rendered string in a column that only accepts numbers.
    const NUMERIC_COLUMN = /^(SERIAL|BIGSERIAL|SMALLSERIAL|INTEGER|INT|BIGINT|SMALLINT|DECIMAL|NUMERIC|REAL|FLOAT|DOUBLE)\b/i;
    const stringTyped = [...REAL_FIELD_TYPES].filter((t) => tsInterfaceType(t) === 'string');
    expect(stringTyped.length).toBeGreaterThanOrEqual(10);
    expect(stringTyped, 'autonumber is a rendered string on the record').toContain('autonumber');
    for (const type of stringTyped) {
      expect(
        sqlColumn(type),
        `${type} is a string on the record but its column only accepts numbers. That is the ` +
        'within-file contradiction #14828 was filed for: `autonumber` carried `string` in ' +
        'FIELD_TYPE_MAP and `SERIAL` — an integer column with a sequence — in ' +
        'FIELD_TYPE_SQL_MAP, so the runtime’s rendered `INV-0001` met a Postgres ' +
        '`22P02 invalid input syntax for type integer` on the first write.',
      ).not.toMatch(NUMERIC_COLUMN);
    }
    // Anti-vacuity: the predicate really does fire on a numeric column, and a
    // genuinely numeric member really has one.
    expect('SERIAL').toMatch(NUMERIC_COLUMN);
    expect(sqlColumn('number')).toMatch(NUMERIC_COLUMN);
    expect(tsInterfaceType('number')).toBe('number');
    // The driver's own answer for the headline member, read where it lives.
    expect(createColumnArm('autonumber')).toContain('table.string(name)');
    expect(sqlColumn('autonumber')).toBe(sqlColumn('text'));
    expect(tsColumn('autonumber')).toBe("table.string('f_autonumber')");
  });

  // ── Recorded divergence, NOT coverage: FILE_REFERENCE_TYPES (#15041) ─────
  //
  // These five are in driver-sql's `JSON_COLUMN_TYPES` (it spreads the class by
  // name) while this generator gives them a varchar. Unlike the five rows above
  // that is not a wrong value but two ADR-0104 positions: the driver is pre-D3
  // (the stored value may still be an inline metadata OBJECT) and #14657 chose
  // the post-D3 answer (an opaque `sys_file` id STRING). Which side moves is
  // #15041's question. Asserted here only so the disagreement cannot change
  // shape unnoticed, and so no reader mistakes this file for having ruled on it.
  it('#15041 record — the file family diverges from the driver, deliberately unresolved', () => {
    expect(FILE_REFERENCE_TYPES.size).toBe(5);
    expect(
      SQL_DRIVER_SOURCE,
      'driver-sql no longer seeds JSON_COLUMN_TYPES from FILE_REFERENCE_TYPES — re-read #15041, ' +
      'the divergence this records may have been resolved from the other side.',
    ).toContain('...STRUCTURED_JSON_TYPES, ...FILE_REFERENCE_TYPES, ...MULTI_OPTION_TYPES,');
    for (const type of FILE_REFERENCE_TYPES) {
      expect(sqlColumn(type)).toBe('VARCHAR(2048)');
      expect(tsColumn(type)).toBe(`table.string('f_${type}')`);
    }
  });
});
