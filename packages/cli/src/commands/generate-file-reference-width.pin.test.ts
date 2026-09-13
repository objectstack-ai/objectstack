// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE #17883 PIN: one `os generate migration`, one column width for the file
 * family — whichever `--format` the author picked.
 *
 * ## The defect
 *
 * `generate.ts` carries two migration formats, and they answered the same
 * FILE_REFERENCE_TYPES field with two different widths:
 *
 * ```
 *   --format sql   f_file  VARCHAR(2048)          FIELD_TYPE_SQL_MAP
 *   typescript     f_file  table.string('f_file') knex's varchar(255)
 * ```
 *
 * `generate.ts` states that second equality itself, in as many words on the
 * `autonumber` entry: "`table.string(name)` = knex's `varchar(255)`
 * (`DEFAULT_STRING_VARCHAR_CHARS`)". The typescript half reached it by riding
 * the REFERENCE_VALUE_TYPES arm, whose derivation is the TARGET row's `id`
 * column — a derivation that was never the file family's, whose value is an
 * opaque `sys_file` id.
 *
 * ## Why the typescript half is the side that moves
 *
 * 2048 is not a width invented to settle a disagreement. It is the width
 * ADR-0104 ruled and the rest of the tree has already shipped:
 *
 *   - ADR-0104, recording the maintainer ruling on #15041: "The driver is the
 *     side that moves; the generator's `VARCHAR(2048)` already states the ruled
 *     end-state and stands."
 *   - #15989 moved `driver-sql`: `MEDIA_ID_VARCHAR_CHARS = 2048` and
 *     `table.string(name, MEDIA_ID_VARCHAR_CHARS)` on the moved arm.
 *   - `os migrate files-to-references --apply` retypes the column to
 *     `varchar(2048)` (`MEDIA_ID_MOVE_WIDTH`, transcribed from the same width).
 *
 * So a deployment scaffolded from the typescript format was the one place left
 * standing at 255 — its declared width disagreeing with the width the migration
 * it will later run retypes to. ⛔ The repair is the typescript half joining
 * the shipped target, never the two halves meeting in the middle, which is why
 * the sweep below asserts the AGREED width against the driver's own constant
 * rather than merely asserting the two formats equal. Two formats that had both
 * drifted to 255 would satisfy an equality-only pin perfectly.
 *
 * ## The control, and where it comes from
 *
 * ⛔ Not invented here: `generate.ts` documents one. Its `text` entry carries a
 * measured row for `f_text` — "sql gen f_text varchar(255) / ts gen f_text
 * varchar(255)" — a NON-file family whose two halves already agree. Measured
 * before and after the repair, `f_text` and every other non-family column in
 * the same emission are byte-identical; only the five family rows move. The
 * sweep pins that shape: the family agrees at the driver's width, and the
 * neighbours it used to share an arm with keep the unsized call.
 *
 * ## What this pin does NOT assert
 *
 * Nothing about live DDL. `generate-string-family-width.pin.test.ts` carries
 * the measured-on-PostgreSQL evidence for the character families; this file
 * measures agreement between two emitters and the driver's own stated width,
 * which is the whole content of the card. And nothing about the JSON-vs-varchar
 * question that #15989 settled — `generate-field-type-vocabulary.pin.test.ts`
 * holds that one, including the control that reddens if the driver reverts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FILE_REFERENCE_TYPES, REFERENCE_VALUE_TYPES } from '@objectstack/spec/data';
import { describe, expect, it } from 'vitest';

import { generateMigrationSql, generateMigrationTs } from './generate.js';

/** `packages/drivers/driver-sql/src` — declared for `@objectstack/cli#test` in `turbo.json`. */
const DRIVER_SQL_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drivers/driver-sql/src');
const SQL_DRIVER_SOURCE = fs.readFileSync(path.join(DRIVER_SQL_SRC, 'sql-driver.ts'), 'utf8');

/** The control the generator documents, plus the arm the family used to ride. */
const CONTROL_TYPES = ['text', ...REFERENCE_VALUE_TYPES, 'autonumber'] as const;

function probeConfig(): Record<string, unknown> {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const type of [...FILE_REFERENCE_TYPES, ...CONTROL_TYPES]) fields[`f_${type}`] = { type };
  return { objects: { probe: { name: 'probe', label: 'Probe', fields } } };
}

const SQL_OUT = generateMigrationSql(probeConfig());
const TS_OUT = generateMigrationTs(probeConfig());

/** The column declaration one field type contributes to the sql format. */
function sqlColumn(type: string): string | null {
  const m = SQL_OUT.match(new RegExp(`^ {2}"f_${type}" (.+?),?$`, 'm'));
  return m ? m[1] : null;
}

/** The `table.x('f_type'[, …])` call one field type contributes to the typescript format. */
function tsColumn(type: string): string | null {
  const m = TS_OUT.match(new RegExp(`^ {4}(table\\.\\w+\\('f_${type}'(?:, [^)]*)?\\)).*$`, 'm'));
  return m ? m[1] : null;
}

/** The character width one format states, or `null` when it states none. */
function sqlWidth(type: string): number | null {
  const m = /^VARCHAR\((\d+)\)$/.exec(sqlColumn(type) ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * The width the typescript format's call carries. `null` for a bare
 * `table.string(name)` — which is a WIDTH, knex's 255, and is exactly the
 * answer this card is about; the sweep names it rather than reading it as
 * absence.
 */
function tsWidth(type: string): number | null {
  const m = /^table\.string\('f_[a-z_]+', (\d+)\)$/.exec(tsColumn(type) ?? '');
  return m ? Number(m[1]) : null;
}

/** The driver's own width for a moved media column, read where it is declared. */
function driverMediaChars(): number {
  const m = SQL_DRIVER_SOURCE.match(/const MEDIA_ID_VARCHAR_CHARS = (\d+);/);
  if (!m) {
    throw new Error(
      'MEDIA_ID_VARCHAR_CHARS is no longer declared in driver-sql/src/sql-driver.ts. That constant ' +
      'is the width #15989 moved the driver to, and this pin has nothing to measure the generators ' +
      'against without it — re-read ADR-0104 and #15989 before re-anchoring it.',
    );
  }
  return Number(m[1]);
}

describe('#17883 — both migration formats give the file family one width', () => {
  it('control — the probe really emitted both formats, and the readers discriminate', () => {
    // Non-vacuity: readers that matched nothing would make every `toBe(null)`
    // below pass while measuring literally nothing.
    expect(FILE_REFERENCE_TYPES.size).toBe(5);
    expect(SQL_OUT).toContain('CREATE TABLE IF NOT EXISTS "probe"');
    expect(TS_OUT).toContain("db.schema.createTable('probe'");
    expect(sqlColumn('file')).not.toBeNull();
    expect(tsColumn('file')).not.toBeNull();
    // …and they tell two different answers apart, in both formats.
    expect(sqlColumn('text')).not.toBe(sqlColumn('file'));
    expect(tsColumn('text')).not.toBe(tsColumn('file'));
    // A width reader that always answered `null` would make the sweep vacuous.
    expect(sqlWidth('lookup')).not.toBeNull();
    expect(sqlWidth('text')).toBeNull();
  });

  it('the driver states a media width this pin can anchor to', () => {
    // The anchor is READ, never transcribed: a literal here would be a third
    // copy of the number the card exists to stop copying.
    expect(driverMediaChars()).toBeGreaterThan(255);
    expect(SQL_DRIVER_SOURCE).toContain('table.string(name, MEDIA_ID_VARCHAR_CHARS)');
  });

  for (const type of FILE_REFERENCE_TYPES) {
    it(`${type} takes the same width in both formats, at the shipped target`, () => {
      const width = driverMediaChars();
      expect(
        sqlWidth(type),
        `os generate migration --format sql no longer states the ruled end-state width for ${type}. ` +
        'ADR-0104 ruled that the GENERATOR states it and the driver moves to it — so a change here ' +
        'is the two halves meeting in the middle, which #17883 forbids.',
      ).toBe(width);
      expect(
        tsWidth(type),
        `os generate migration (typescript) gave ${type} a different width from the sql format. A ` +
        'bare `table.string(name)` reads as null here and is knex\'s varchar(255) — the #17883 ' +
        'defect exactly: one command, one field, two widths depending on --format.',
      ).toBe(width);
      // Stated once more as the emitted text, so a reader of a failure sees the
      // two lines rather than two numbers.
      expect(sqlColumn(type)).toBe(`VARCHAR(${width})`);
      expect(tsColumn(type)).toBe(`table.string('f_${type}', ${width})`);
    });
  }

  it('the control does not move: the non-file families keep their own answers', () => {
    // `f_text` is the control `generate.ts` documents on its own `text` entry —
    // a non-file family whose two halves already agree. ⛔ Not invented here.
    expect(sqlColumn('text')).toBe('TEXT');
    expect(tsColumn('text')).toBe("table.text('f_text')");

    // And the arm the family used to ride: a reference column holds the target
    // row's id, `table.string('id').primary()` = knex's default width, so it
    // takes the UNSIZED call. If the repair had widened this class too, it
    // would have carried the file family's width into columns that never
    // wanted it.
    for (const type of [...REFERENCE_VALUE_TYPES, 'autonumber']) {
      expect(tsWidth(type), `${type} was widened along with the file family`).toBeNull();
      expect(tsColumn(type)).toBe(`table.string('f_${type}')`);
      expect(sqlWidth(type)).not.toBe(driverMediaChars());
    }
  });
});
