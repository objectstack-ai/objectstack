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
 * ## What this pin asserts, and what it deliberately does NOT
 *
 * FORWARD ONLY: every token the three vocabularies key on is a `FieldType`
 * member. The converse is NOT asserted — plenty of real members (`secret`,
 * `address`, `location`, `code`, `tags`, …) have no entry and fall to the
 * `default` arm / the `|| fallback`, and that fallback is deliberate. Demanding
 * total coverage would be a different card with a different decision behind it
 * (what column type each unmapped member deserves), and this pin is written so
 * it does not prejudge that.
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

import { FieldType } from '@objectstack/spec/data';
import { describe, expect, it } from 'vitest';

const GENERATE_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'generate.ts');
const SOURCE = fs.readFileSync(GENERATE_TS, 'utf8');

/** The authority. Imported from the package that owns it, never transcribed. */
const REAL_FIELD_TYPES: ReadonlySet<string> = new Set(FieldType.options);

/** `const NAME: Record<string, string> = {` at top level — the lookup tables. */
const LOOKUP_TABLE_DECL = /^const (\w+): Record<string, string> = \{$/gm;

/** The one field-type switch in the migration (typescript) generator. */
const FIELD_TYPE_SWITCH = /switch \(fType\)/g;

function lookupTableNames(): string[] {
  return [...SOURCE.matchAll(LOOKUP_TABLE_DECL)].map((m) => m[1]);
}

/** The keys of one top-level `Record<string, string>` table, in source order. */
function lookupTableKeys(name: string): string[] {
  const declaration = `const ${name}: Record<string, string> = {`;
  const start = SOURCE.indexOf(declaration);
  if (start < 0) throw new Error(`lookup table not found in generate.ts: ${name}`);
  const end = SOURCE.indexOf('\n};', start);
  if (end < 0) throw new Error(`unterminated lookup table in generate.ts: ${name}`);
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
});
