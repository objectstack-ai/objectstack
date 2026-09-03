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
 * ⚠️ What is NOT asserted, and why the difference is the point: that a mapping
 * is CORRECT. This pin measures presence, not the value — a wrong-but-present
 * entry is a different defect (`autonumber: 'SERIAL'` against a runtime that
 * writes a rendered string, `formula` given a column the runtime never
 * creates), filed separately rather than pinned here on a guess.
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

/**
 * The terminator every lookup table must carry — the type-level half of the
 * #14657 totality rule. Required rather than tolerated: if someone deletes the
 * annotation, extraction fails loudly here instead of the compiler silently
 * stopping to check.
 */
const TABLE_TERMINATOR = '\n} satisfies Record<FieldType, string>;';

/** The keys of one top-level `Record<string, string>` table, in source order. */
function lookupTableKeys(name: string): string[] {
  const declaration = `const ${name}: Record<string, string> = {`;
  const start = SOURCE.indexOf(declaration);
  if (start < 0) throw new Error(`lookup table not found in generate.ts: ${name}`);
  const end = SOURCE.indexOf(TABLE_TERMINATOR, start);
  if (end < 0) {
    throw new Error(
      `lookup table ${name} in generate.ts is not closed by \`${TABLE_TERMINATOR.trim()}\` — ` +
      'the satisfies annotation is the type-level half of the #14657 totality rule and must stay.',
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
        SOURCE.includes(`const ${table}: Record<string, string> = {`),
        `${table} declaration moved`,
      ).toBe(true);
      expect(() => lookupTableKeys(table)).not.toThrow();
    }
    expect(SOURCE.match(/\} satisfies Record<FieldType, string>;/g)).toHaveLength(2);
  });
});
