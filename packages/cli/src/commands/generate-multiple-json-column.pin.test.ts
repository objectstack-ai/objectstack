// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE #14829 PIN: one authored `multiple: true` field, three surfaces, ONE answer.
 *
 * ## The defect
 *
 * `multiple` appeared exactly FOUR times in `generate.ts`, and all four were on
 * the TypeScript side (measured at `origin/main` 5bc2f2727a:
 * `git grep -n multiple origin/main -- packages/cli/src/commands/generate.ts`):
 *
 *   :562  function fieldTypeToTs(fieldType: string, multiple?: boolean)
 *   :564    return multiple ? `${base}[]` : base;
 *   :607    const tsType = fieldTypeToTs(fType, !!fieldDef.multiple);   // os generate types
 *   :831    const tsType = fieldTypeToTs(fType, !!fieldDef.multiple);   // os generate client
 *
 * Neither migration generator read it, and `fieldTypeToSql` did not even take
 * the parameter. So ONE authored field produced two incompatible answers from
 * one config in one run — `Field.lookup({ reference: 'account', multiple: true })`
 * emitted `account?: string[]` from `os generate types` and a scalar
 * `VARCHAR(36)` / `table.uuid('account')` column from the two migration
 * generators. Nothing warns: the scaffold looks right, the generated
 * TypeScript IS right, and only the column is wrong, so the first symptom is a
 * write. That is the `#field-zoo` failure one layer out — there the DDL switch
 * and `isJsonField` had drifted into two lists inside the driver; here the
 * platform and the GENERATED DDL are the two lists.
 *
 * ## Which surface is authoritative, and why it is NOT `isMultiValueField`
 *
 * Measured on `origin/main`, the platform answers "which column does this field
 * get" from the FLAG ALONE, before it looks at the type, and says so in three
 * places:
 *
 *   packages/drivers/driver-sql/src/sql-driver.ts  `createColumn`
 *     `if (field.multiple) { this.jsonColumn(table, name); return; }` — stated
 *     above the `switch (type)`, so the element type never gets a vote.
 *   packages/drivers/driver-sql/src/sql-driver.ts  `isJsonField`
 *     `JSON_COLUMN_TYPES.has(type) || !!field.multiple`
 *   packages/drivers/driver-sql/src/schema-drift.ts  `fieldHasColumn`
 *     `if (field?.multiple) return true;` — under the comment "Mirrors
 *     `SqlDriver.createColumn` exactly … everything else — including `multiple`
 *     (a JSON column) — gets one."
 *
 * The spec's `isMultiValueField` is a DIFFERENT question with a different
 * answer: it is the ADR-0104 D1 VALUE contract ("is the persisted value an
 * array"), and it gates on `MULTI_CAPABLE_TYPES` —
 * `MULTI_OPTION_TYPES.has(type) || (MULTI_CAPABLE_TYPES.has(type) && multiple)`.
 * A generator that asked it instead would answer VARCHAR for a `text` field
 * flagged `multiple: true` while the driver gives that same field a JSON
 * column — reintroducing this very drift one notch narrower. `FieldSchema`
 * does not refuse the combination either (`multiple` is a plain
 * `z.boolean().default(false)` on every field; only `radio` + `multiple` is
 * refused, by name, in `field.zod.ts`'s superRefine), and the CLI generators
 * sit DOWNSTREAM of validation and explicitly serve the unvalidated authoring
 * door. So the column authority is the driver's flag-first rule, and this pin
 * asserts against that.
 *
 * `MULTI_CAPABLE_TYPES` is still imported here rather than transcribed — it is
 * the roster this pin SWEEPS, so a type added to that spec class is measured on
 * the day it lands. It is not the implementation's gate, and the type-blindness
 * control below is what states the difference as an assertion.
 *
 * ## Anti-vacuity
 *
 * Every arm has a control, because a pin that measured nothing would pass
 * loudest of all. The controls are separate `it` blocks with `control —` in
 * their names, so a red run says in its own title whether the discriminating
 * arm fired or merely the harness: the roster really loaded, the generators
 * really emitted, and — the one that matters — the SAME type WITHOUT the flag
 * still gets its scalar column, so "JSONB everywhere" cannot pass this file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MULTI_CAPABLE_TYPES } from '@objectstack/spec/data';
import { describe, expect, it } from 'vitest';

import {
  generateMigrationSql,
  generateMigrationTs,
  generateTypesFromConfig,
} from './generate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVER_SQL_SRC = path.resolve(HERE, '../../../drivers/driver-sql/src');

/**
 * The types swept for the flag. The spec's multi-capable roster (imported, not
 * restated) plus `text` — a type that is NOT in that roster and whose scalar
 * answer is a varchar, which is what makes the type-blindness of the rule
 * assertable rather than merely described.
 */
const FLAGGED_TYPES: readonly string[] = [...MULTI_CAPABLE_TYPES, 'text'];

/** One object carrying, for each swept type, a flagged field and its scalar twin. */
function probeConfig(): Record<string, unknown> {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const type of FLAGGED_TYPES) {
    fields[`multi_${type}`] = { type, multiple: true };
    fields[`single_${type}`] = { type };
  }
  return { objects: { probe: { name: 'probe', label: 'Probe', fields } } };
}

const TYPES_OUT = generateTypesFromConfig(probeConfig());
const SQL_OUT = generateMigrationSql(probeConfig());
const TS_OUT = generateMigrationTs(probeConfig());

/** The `"name" TYPE` column body one field contributes to the SQL migration. */
function sqlColumn(field: string): string {
  const m = SQL_OUT.match(new RegExp(`^ {2}"${field}" (.+?),?$`, 'm'));
  if (!m) throw new Error(`no SQL column emitted for ${field}`);
  return m[1];
}

/** The `table.x('name')…` call one field contributes to the TS migration. */
function tsColumn(field: string): string {
  const m = TS_OUT.match(new RegExp(`^ {4}(table\\.\\w+\\('${field}'\\)).*$`, 'm'));
  if (!m) throw new Error(`no TS migration column emitted for ${field}`);
  return m[1];
}

/** The declared property type one field contributes to the generated interface. */
function tsInterfaceType(field: string): string {
  const m = TYPES_OUT.match(new RegExp(`^ {2}${field}\\??: (.+);$`, 'm'));
  if (!m) throw new Error(`no interface member emitted for ${field}`);
  return m[1];
}

describe('#14829 — `multiple: true` is one answer across all three surfaces', () => {
  it('control — the spec multi-capable roster really loaded', () => {
    expect(MULTI_CAPABLE_TYPES.size).toBeGreaterThanOrEqual(6);
    for (const known of ['select', 'lookup', 'user', 'file', 'image']) {
      expect(MULTI_CAPABLE_TYPES.has(known)).toBe(true);
    }
    // `text` is the type-blindness probe: it must NOT be in the roster, or the
    // control below stops distinguishing the flag rule from the value rule.
    expect(MULTI_CAPABLE_TYPES.has('text')).toBe(false);
  });

  it('control — all three generators really emitted a table for the probe', () => {
    expect(TYPES_OUT).toContain('export interface ProbeRecord {');
    expect(SQL_OUT).toContain('CREATE TABLE IF NOT EXISTS "probe" (');
    expect(TS_OUT).toContain("await db.schema.createTable('probe'");
    // Non-vacuity for the readers: every swept field really reached the output.
    expect(FLAGGED_TYPES.length).toBeGreaterThanOrEqual(7);
    for (const type of FLAGGED_TYPES) {
      expect(() => sqlColumn(`multi_${type}`)).not.toThrow();
      expect(() => tsColumn(`multi_${type}`)).not.toThrow();
      expect(() => tsInterfaceType(`multi_${type}`)).not.toThrow();
    }
  });

  it('control — the SAME type without the flag still gets its scalar column', () => {
    // THE discriminating control. If this file could be satisfied by emitting a
    // JSON column for everything, the arms below would prove nothing.
    //
    // #14828 moved the unflagged `lookup` answers — `VARCHAR(36)` /
    // `table.uuid` became `VARCHAR(255)` / `table.string`, the driver's own
    // answer for a reference column. The control is unweakened by that: what it
    // discriminates is scalar-vs-JSON, and both spellings are scalar. `select`
    // is swept alongside because it is a scalar of a DIFFERENT family, so the
    // control cannot be satisfied by one column shape for everything either.
    expect(sqlColumn('single_lookup')).toBe('VARCHAR(255)');
    expect(tsColumn('single_lookup')).toBe("table.string('single_lookup')");
    // #16091 — `text` is an unbounded TEXT column now, which is what
    // `createColumn`'s text-family arm builds for every unkeyed column. The
    // control is unweakened by that for exactly the reason the `lookup` note
    // above gives: what it discriminates is scalar-vs-JSON, and TEXT is scalar.
    expect(sqlColumn('single_text')).toBe('TEXT');
    expect(tsColumn('single_text')).toBe("table.text('single_text')");
    // …and it still discriminates: the scalar answer is not the JSON one.
    expect(sqlColumn('single_text')).not.toBe(sqlColumn('multi_text'));
    expect(sqlColumn('single_file')).toBe('VARCHAR(2048)');
    expect(tsInterfaceType('single_lookup')).toBe('string');
  });

  for (const type of FLAGGED_TYPES) {
    it(`${type} + multiple:true — array TS type AND a JSON column in both migrations`, () => {
      const declared = tsInterfaceType(`multi_${type}`);
      expect(declared, `os generate types must give a flagged ${type} an array type`)
        .toMatch(/\[\]$/);

      expect(
        sqlColumn(`multi_${type}`),
        `os generate migration --format sql gave a flagged ${type} a scalar column while ` +
        'the platform stores it as JSON (driver-sql createColumn decides `multiple` before ' +
        'the type switch), and os generate types called it an array',
      ).toBe('JSONB');

      expect(
        tsColumn(`multi_${type}`),
        `os generate migration (typescript) gave a flagged ${type} a scalar column while ` +
        'the platform stores it as JSON, and os generate types called it an array',
      ).toBe(`table.jsonb('multi_${type}')`);
    });
  }

  it('the flag decides before the type — a type outside MULTI_CAPABLE_TYPES too', () => {
    // Stated as its own assertion because it is the one place this pin departs
    // from the spec's value predicate on purpose. `text` is not multi-capable
    // under `isMultiValueField`, and the driver gives it a JSON column anyway.
    expect(MULTI_CAPABLE_TYPES.has('text')).toBe(false);
    expect(sqlColumn('multi_text')).toBe('JSONB');
    expect(tsColumn('multi_text')).toBe("table.jsonb('multi_text')");
  });

  it('nullability still comes from `required`, not from the flag', () => {
    const out = generateMigrationSql({
      objects: { probe: { name: 'probe', fields: { tags_req: { type: 'lookup', multiple: true, required: true } } } },
    });
    expect(out).toContain('"tags_req" JSONB NOT NULL');
    const ts = generateMigrationTs({
      objects: { probe: { name: 'probe', fields: { tags_req: { type: 'lookup', multiple: true, required: true } } } },
    });
    expect(ts).toContain("table.jsonb('tags_req').notNullable();");
  });

  // ── The authority, read where it lives ──────────────────────────────────
  //
  // Source-read rather than imported: `createColumn` is `protected` and needs a
  // knex table builder, so driving it would mean a live driver and a built
  // `dist`. What has to be pinned is the SHAPE of its decision — flag first,
  // type second — and that is legible in the source. If the driver ever moves
  // this rule, these fail and whoever moved it re-derives the generators.

  it('driver-sql `createColumn` still decides `multiple` BEFORE the type switch', () => {
    const source = fs.readFileSync(path.join(DRIVER_SQL_SRC, 'sql-driver.ts'), 'utf8');
    // Non-vacuity: the file was really read, and the two landmarks really found.
    expect(source.length).toBeGreaterThan(10_000);
    const start = source.indexOf('protected createColumn(');
    expect(start, 'createColumn moved or was renamed in driver-sql').toBeGreaterThan(0);
    const switchAt = source.indexOf('switch (type)', start);
    expect(switchAt, 'the per-type switch in createColumn moved').toBeGreaterThan(start);

    const preSwitch = source.slice(start, switchAt);
    expect(
      preSwitch,
      'driver-sql no longer short-circuits on `field.multiple` before its per-type switch. ' +
      'That short-circuit is the authority this pin and the CLI migration generators mirror ' +
      '(#14829) — re-derive both sides before changing it.',
    ).toMatch(/if \(field\.multiple\)/);
    expect(preSwitch).toMatch(/this\.jsonColumn\(/);
  });

  it('driver-sql `fieldHasColumn` still answers the flag before the type', () => {
    const source = fs.readFileSync(path.join(DRIVER_SQL_SRC, 'schema-drift.ts'), 'utf8');
    expect(source.length).toBeGreaterThan(10_000);
    const start = source.indexOf('export function fieldHasColumn(');
    expect(start, 'fieldHasColumn moved or was renamed in driver-sql').toBeGreaterThan(0);
    expect(source.slice(start, start + 300)).toMatch(/if \(field\?\.multiple\) return true;/);
  });

  // ── The former SCOPE FENCE for #14828 — DISCHARGED, and kept as the seam ──
  //
  // This block was written by #14829 as a fence, not an endorsement: the five
  // scalar answers disagreed with what the platform stores, #14829 left them
  // byte-for-byte because they were a different card, and asserted them here so
  // that changing one would have to be a deliberate edit to this block rather
  // than a side effect of a card about the `multiple` flag. #14828 is that card
  // and this is that deliberate edit — the values below are now the platform's,
  // each read from `driver-sql`.
  //
  // ⛔ The block stays rather than being deleted, and its job is unchanged: it
  // is still the one place where the scalar answers are stated next to the
  // flagged ones, so a future card that moves either half has to move it here,
  // in view of the other. The rule BEHIND these values — derived from the spec
  // value classes and the driver's own switch, never retyped — lives in
  // `generate-field-type-vocabulary.pin.test.ts`; this block is the record of
  // what that rule resolves to today, and the two go red together.
  it('#14828 discharged — the five disputed SCALAR answers are the platform’s', () => {
    // A reference column holds the target's `id`: `table.string(name)`, knex's
    // varchar(255). `table.uuid` was the one HARD failure of the five — a
    // platform id is 26 characters and Postgres refuses one in a `uuid` column.
    expect(sqlColumn('single_lookup')).toBe('VARCHAR(255)');
    expect(tsColumn('single_lookup')).toBe("table.string('single_lookup')");

    const config = () => ({
      objects: { probe: { name: 'probe', fields: {
        a: { type: 'autonumber' }, f: { type: 'formula' },
        m: { type: 'multiselect' }, v: { type: 'vector' }, d: { type: 'master_detail' },
        t: { type: 'text' },
      } } },
    });
    const other = generateMigrationSql(config());
    const otherTs = generateMigrationTs(config());

    // Non-vacuity: the probe really produced a table, and a control field that
    // this card does NOT touch is present in both outputs. Without it, "does
    // not contain" would pass on an empty string.
    expect(other).toContain('CREATE TABLE IF NOT EXISTS "probe" (');
    expect(other).toContain('"t" TEXT');
    expect(otherTs).toContain("table.text('t')");

    // A RENDERED string (prefix + counter + suffix), never an integer sequence.
    expect(other).toContain('"a" VARCHAR(255)');
    // MULTI_OPTION_TYPES and STRUCTURED_JSON_TYPES both seed the driver's
    // JSON_COLUMN_TYPES. `VECTOR` was additionally pgvector-only.
    expect(other).toContain('"m" JSONB');
    expect(other).toContain('"v" JSONB');
    // The other half of the reference class.
    expect(other).toContain('"d" VARCHAR(255)');
    // VIRTUAL — no column at all, in either format. `createColumn` answers
    // `case 'formula': return;` and `fieldHasColumn` answers false.
    expect(other).not.toContain('"f" ');
    expect(otherTs).not.toContain("('f')");
  });
});
