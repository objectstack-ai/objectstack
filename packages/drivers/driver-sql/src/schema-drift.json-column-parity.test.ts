// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15771] The DETECTOR's JSON-class predicate is the WRITER's, and stays it.
 *
 * The defect was a fork, not a missing rule. `createColumn` gives a field a
 * json column when `JSON_COLUMN_TYPES.has(type)` — the type ALONE — and
 * `isJsonField`, the read-side deserializer, is `JSON_COLUMN_TYPES.has(type) ||
 * !!field.multiple`. `diffManagedTable`'s base-type branch asked only
 * `field.multiple === true`. So a SINGLE-VALUE JSON-class field (`file`,
 * `location`, `record`, `vector`, the option families) on a `varchar`/`text`
 * column was written as JSON by the writer and did not exist to the differ —
 * permanently, because the additive sync never revisits a column, and silently,
 * because nothing else reports it.
 *
 * Measured on the pre-fix tree, one `diffManagedTable` call per type: all
 * FIFTEEN JSON-class types the spec declares returned ZERO entries over a
 * `character varying(2048)` column on `postgres`, while the same column under a
 * `{ multiple: true }` field returned one in the same run.
 *
 * ## Why this file exists rather than a list in the source
 *
 * `sql-driver.ts` imports `schema-drift.ts`, so the differ cannot import the
 * writer's `JSON_COLUMN_TYPES` — the same cycle `UNBOUNDED_TEXT_FIELD_TYPES`
 * documents. {@link JSON_COLUMN_FIELD_TYPES} is therefore a second constant,
 * seeded from the SAME `@objectstack/spec` sets, and a second constant is only
 * as good as the pin that holds it equal. Both directions are load-bearing:
 *
 *   - `⊇` — a value-shape class added to the spec that reaches the writer but
 *     not the differ re-opens exactly this blind spot, by the door it came in.
 *   - `⊆` — a type listed here that the writer does NOT give a json column
 *     would be reported as needing a conversion to a column shape the platform
 *     would never create: a finding an operator can act on and be left with
 *     drift.
 *
 * The classification PROBES the driver rather than restating its cases (the
 * technique `schema-drift.unbounded-text-column.test.ts` and
 * `sql-driver-12017-bounded-string-spec-parity.test.ts` use), and the last case
 * probes the DIFFER's observable verdict rather than the constant, so the two
 * halves are compared where they actually meet.
 *
 * ## [#15989] The parity is now held ACROSS AN ARM, not at one point
 *
 * The ADR-0104 addendum made the FILE family's column shape a DEPLOYMENT fact:
 * a single-value `file` / `image` / `avatar` / `video` / `audio` is a json
 * column until this deployment has moved its columns and a `varchar` after. So
 * neither half can name the family in a constant any more, and "the two halves
 * agree" has to be asserted on BOTH arms — a fork that only appears on the
 * moved arm is exactly the shape #15771 was, one deployment-state later.
 *
 * ⛔ The two arms must NOT be collapsed into one run with the family excluded.
 * That is the vacuous version: it would pass over a driver that ignored the arm
 * entirely, which is the defect with the largest blast radius here (a driver
 * writing bare ids into a json column, or JSON-quoted ids into a varchar).
 * Every case below therefore drives the same probe twice and asserts the answer
 * MOVES, by name, on exactly the five members of the family.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { FieldType, FILE_REFERENCE_TYPES } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import { diffManagedTable, JSON_COLUMN_FIELD_TYPES, type PhysicalColumn } from './schema-drift.js';
import { dialectCell } from './live-dialect-matrix.testkit.js';

/** `SqlDriver.isJsonField` is protected — the writer's own predicate, exposed unchanged. */
class WriterProbe extends SqlDriver {
  asksJson(type: string, field: Record<string, unknown> = {}): boolean {
    return this.isJsonField(type, field);
  }
}

const STALE: PhysicalColumn[] = [{ name: 'doc', type: 'character varying', nullable: true, maxLength: 2048 }];

/**
 * Does the DIFFER report the base-type divergence for this declaration, on a
 * deployment whose media columns have (`moved`) or have not moved?
 */
const differReports = (field: Record<string, unknown>, moved = false): boolean =>
  diffManagedTable({
    table: 'proj_task',
    fields: { doc: field } as never,
    columns: STALE,
    dialect: 'postgres',
    fileColumnsMoved: moved,
  }).some((d) => d.op.type === 'manual_column_type_change');

/** A writer probe on the arm under test. `moved` is the driver's own arm. */
const writerOn = (moved: boolean): WriterProbe =>
  new WriterProbe({ ...dialectCell('sqlite').config(), fileColumnsMoved: moved });

/** The set the differ declares json for on this arm — the family is per-arm. */
const declaredOn = (moved: boolean): string[] =>
  [...JSON_COLUMN_FIELD_TYPES, ...(moved ? [] : FILE_REFERENCE_TYPES)];

const MEDIA = [...FILE_REFERENCE_TYPES].sort();

describe('the JSON-class predicate the differ reads is the one the writer reads (#15771)', () => {
  let driver: WriterProbe;
  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  it.each([
    { arm: 'has NOT moved its media columns', moved: false },
    { arm: 'HAS moved its media columns', moved: true },
  ])('holds the set equal to `isJsonField` over every FieldType the spec declares — deployment $arm', ({ moved }) => {
    driver = writerOn(moved);
    const types = FieldType.options as readonly string[];
    expect(types.length).toBeGreaterThan(40); // the spec registry really was read

    const writerSaysJson = types.filter((t) => driver.asksJson(t)).sort();
    const declared = declaredOn(moved).filter((t) => types.includes(t)).sort();

    // Non-vacuity: the writer answered NO for a large part of the vocabulary,
    // so an equality between two everything-sets cannot pass for a measurement.
    expect(types.filter((t) => !driver.asksJson(t)).length).toBeGreaterThan(10);
    expect(writerSaysJson).toEqual(declared);
    // …and YES for a real part of it. The floor moves by exactly the size of
    // the file family, because that is what leaves the set on the moved arm —
    // spelled as the difference rather than as a second literal so the two arms
    // cannot be made to agree by lowering one number.
    expect(writerSaysJson.length).toBeGreaterThan(10 - (moved ? MEDIA.length : 0));
  });

  it('[#15989] the arm MOVES the answer, and moves it on exactly the file family', async () => {
    // ⭐ The anti-vacuity case for the two runs above: without it both would
    // still pass over a driver that ignored `fileColumnsMoved` entirely, as
    // long as the differ ignored it in the same way.
    const types = FieldType.options as readonly string[];
    const unmoved = writerOn(false);
    const moved = writerOn(true);
    try {
      const jsonOn = (d: WriterProbe) => new Set(types.filter((t) => d.asksJson(t)));
      const before = jsonOn(unmoved);
      const after = jsonOn(moved);

      const dropped = [...before].filter((t) => !after.has(t)).sort();
      const gained = [...after].filter((t) => !before.has(t)).sort();
      expect(dropped).toEqual(MEDIA);
      expect(gained).toEqual([]);
      expect(MEDIA).toHaveLength(5);

      // A `multiple: true` media field is a LIST of ids — a json column on
      // every deployment, and the one member of the family the arm must NOT
      // move. `createColumn` short-circuits on `multiple` above its type
      // switch, so a driver that keyed the arm too high would break it here.
      for (const type of MEDIA) {
        expect(unmoved.asksJson(type, { type, multiple: true }), type).toBe(true);
        expect(moved.asksJson(type, { type, multiple: true }), type).toBe(true);
      }

      // The differ moves with it, by name, over the same declarations.
      for (const type of MEDIA) {
        expect(differReports({ type }, false), type).toBe(true);
        expect(differReports({ type }, true), type).toBe(false);
      }
    } finally {
      await unmoved.disconnect().catch(() => {});
      await moved.disconnect().catch(() => {});
    }
  });

  it('an OMITTED `fileColumnsMoved` reads as NOT moved, so an unthreaded caller keeps today\'s verdicts', () => {
    // The additive default the parameter documents. A direct caller of the
    // exported `diffManagedTable` that has never heard of the arm must keep
    // reporting a `varchar` media column as the #15771 corruption it is on an
    // unmoved deployment — omission is not "unknown, so silent".
    for (const type of MEDIA) {
      const omitted = diffManagedTable({
        table: 'proj_task', fields: { doc: { type } } as never, columns: STALE, dialect: 'postgres',
      }).some((d) => d.op.type === 'manual_column_type_change');
      expect(omitted, type).toBe(true);
      expect(omitted, type).toBe(differReports({ type }, false));
    }
  });

  it('the only NON-FieldType members are the two driver-internal aliases, and the writer owns them too', () => {
    driver = new WriterProbe(dialectCell('sqlite').config());
    const types = FieldType.options as readonly string[];

    // `object` / `array` name introspected external columns, not authorable
    // types — they are the one hand-written part of the set, so they are the
    // one part that can silently gain a third member.
    const aliases = [...JSON_COLUMN_FIELD_TYPES].filter((t) => !types.includes(t)).sort();
    expect(aliases).toEqual(['array', 'object']);
    for (const alias of aliases) expect(driver.asksJson(alias), alias).toBe(true);
  });

  it.each([
    { arm: 'has NOT moved its media columns', moved: false },
    { arm: 'HAS moved its media columns', moved: true },
  ])('the DIFFER agrees with the writer over the whole vocabulary, `multiple` and not — deployment $arm', ({ moved }) => {
    // ⭐ The pin that matters: not "two constants match" but "the two halves
    // reach the same verdict about the same declaration". Probed through
    // `diffManagedTable`'s output, so it fails if the branch stops consulting
    // the set as much as if the set drifts — and now on both arms, so it fails
    // if either half stops consulting the ARM.
    driver = writerOn(moved);
    const types = FieldType.options as readonly string[];

    const disagreements: string[] = [];
    for (const type of types) {
      for (const multiple of [false, true]) {
        const field = multiple ? { type, multiple: true } : { type };
        const writer = driver.asksJson(type, field);
        if (writer !== differReports(field, moved)) disagreements.push(`${type}${multiple ? ' multiple' : ''}`);
      }
    }
    expect(disagreements).toEqual([]);

    // Non-vacuity in both directions, in the same run: the loop above saw real
    // trues and real falses rather than passing over a uniform answer.
    expect(differReports({ type: 'file' }, moved)).toBe(!moved);
    expect(differReports({ type: 'file', multiple: true }, moved)).toBe(true);
    expect(differReports({ type: 'string', multiple: true }, moved)).toBe(true);
    expect(differReports({ type: 'string' }, moved)).toBe(false);
    expect(differReports({ type: 'integer' }, moved)).toBe(false);
  });
});
