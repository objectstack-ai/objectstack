// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12017 — the driver's varchar-sizing type switch and the spec's
 * `BOUNDED_STRING_FIELD_TYPES` now depend on each other, and until this file
 * NOTHING asserted the relationship.
 *
 * ## The gap, stated precisely
 *
 * Two lists landed a day apart and are related by reasoning alone:
 *
 *   - `packages/spec`'s `BOUNDED_STRING_FIELD_TYPES` decides which types may
 *     DECLARE a `maxLength` at all (`FieldSchema` refuses it elsewhere), and
 *     objectql's record-validator enforces the bound on exactly that set.
 *   - this driver's `varcharColumnChars` / `createColumn` switch decides what
 *     the COLUMN is: sized from the declaration (`declaredVarcharLength`),
 *     TEXT-unless-keyed (`keyableTextLength`), or neither.
 *
 * The failure mode the card names: spec admits a new type into the bounded set,
 * the driver's hand-maintained switch does not learn about it, and the type
 * falls to the catch-all `table.string(name)` — knex's varchar(255). The author
 * declared `maxLength: 2000`, the platform formally accepted the declaration,
 * and the column silently refuses at 255. That is #11431's defect re-entering
 * through a different door, against a bound the platform now accepts.
 *
 * ⛔ It is a MISSING GUARD, not a live defect: the two lists were measured on
 * `origin/main` and they agree. So a green run here proves nothing on its own —
 * what this file is worth is what it does when they DRIFT, which is stated as
 * an executable classification rather than as prose.
 *
 * ## What the two existing pins in this directory do NOT cover
 *
 *   - `sql-driver-11565-row-byte-budget.test.ts` pins the width MIRROR against
 *     `createColumn`'s own switch over every `FieldType`. Both sides of that
 *     pin are the driver, so a type that fell to the catch-all satisfies it
 *     perfectly: the mirror says varchar(255) and the column IS varchar(255).
 *   - `sql-driver-11794-richtext-text-family.test.ts` pins the driver's
 *     unbounded-when-unkeyed SET — against a hand-written list in that file.
 *     It is the driver pinned against itself, one copy further out.
 *
 * Neither reads the spec's set. This file is the missing edge.
 *
 * ## ⭐ The relationship, in the form the assertions below state it
 *
 *     { t ∈ FieldType.options : the switch sizes t from the field's own
 *       maxLength }  ===  BOUNDED_STRING_FIELD_TYPES
 *
 * — set EQUALITY, both directions load-bearing:
 *
 *   - `⊇` is the card's failure mode. A member of the spec's set that the
 *     switch does not size is a declared bound the column ignores.
 *   - `⊆` is its mirror image, and is the reason this is not written as a
 *     subset check. A type the switch sizes from `maxLength` while
 *     `FieldSchema` REFUSES `maxLength` on it is sizing code no authored
 *     metadata can reach — and, in the TEXT branch, an unbounded column whose
 *     bound no write seam enforces, which is exactly the invariant #11794
 *     admits text-family members under.
 *
 * ⚠️ The naive form of this — "the spec's set equals the union of the driver's
 * two branches" — is FALSE as stated, and the exception is the whole reason the
 * assertion is scoped to `FieldType.options`. The switch's varchar branch also
 * answers for the literal `'string'`, which is not a `FieldType` at all: it is
 * the untyped default (`field?.type || 'string'`), knex's BUILDER name, not a
 * spec type. A guard written the naive way would red on day one for a reason
 * that is not the defect. `'string'` is pinned as that default below, so the
 * scoping is a stated fact rather than a convenient omission.
 *
 * ## Why a PIN here and not a DERIVATION
 *
 * The driver COULD read `BOUNDED_STRING_FIELD_TYPES` and derive its text family
 * as "the spec's set minus my varchar family" — this file's PR body argues the
 * fork in full. The short form: the spec's set answers "may this type declare a
 * bound?", the switch answers "which physical column shape?", and the set does
 * not carry the varchar/TEXT partition that second question needs. Deriving
 * would therefore have to INVENT a default for every future member (TEXT), at
 * the one seam where the choice has consequences the maintainer has actually
 * ruled on per type (#11794 measured it; #11875 ruled it). A pin fails loudly
 * at the moment that decision is needed instead of supplying an unchosen answer
 * silently, and unlike a derivation it also holds the `⊆` direction.
 *
 * ## How the branches are identified — no fourth hand-maintained list
 *
 * The branch a type takes is READ OFF THE DRIVER'S OWN DISPATCH rather than
 * restated here, because a copied case list is the very defect this card is
 * about (and is what the #11794 pin had to accept). Three probes separate the
 * four outcomes; see {@link columnShapeOf}.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { FieldType, BOUNDED_STRING_FIELD_TYPES } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';
import { dialectCell } from './live-dialect-matrix.testkit.js';

/**
 * The bound every probe declares.
 *
 * Three constraints, all of them from the driver's own constants rather than
 * chosen for looks: wider than `DEFAULT_STRING_VARCHAR_CHARS` (255) so the
 * catch-all's answer is DISTINGUISHABLE from an honoured declaration — that
 * difference is the defect's whole signature — and inside both
 * `MAX_KEYABLE_VARCHAR_CHARS` (768) and `MAX_VARCHAR_CHARS` (16383), so
 * neither ceiling turns the answer into `null` and mis-classifies the type.
 */
const PROBE_CHARS = 700;

/** knex's default width, read from the driver so this file states no number twice. */
const DEFAULT_CHARS = (SqlDriver as any).DEFAULT_STRING_VARCHAR_CHARS as number;

type ColumnShape =
  /** `declaredVarcharLength` — varchar(maxLength). Sized from the declaration. */
  | 'varchar-from-declaration'
  /** `keyableTextLength` — TEXT unkeyed, varchar(maxLength) when keyed. Sized from the declaration. */
  | 'text-family'
  /** The catch-all `table.string(name)`. The declaration is IGNORED — the defect's shape. */
  | 'default-varchar-255'
  /** JSON / virtual / non-string primitives. Not a varchar and not sized from metadata. */
  | 'not-sized-from-metadata';

/** The two shapes that honour the field's own `maxLength`. */
const SIZED_FROM_DECLARATION: readonly ColumnShape[] = ['varchar-from-declaration', 'text-family'];

/**
 * Which branch of the switch a type takes, decided by PROBING the driver.
 *
 * The four outcomes are separated by the two answers below, which the switch
 * produces without this file knowing a single one of its cases:
 *
 * | branch                  | unkeyed        | keyed          |
 * |-------------------------|----------------|----------------|
 * | varchar-from-declaration| `PROBE_CHARS`  | `PROBE_CHARS`  |
 * | text-family             | `null`         | `PROBE_CHARS`  |
 * | default-varchar-255     | `255`          | `255`          |
 * | not-sized-from-metadata | `null`         | `null`         |
 *
 * ⚠️ The keyed probe is what makes `text-family` distinguishable from
 * `not-sized-from-metadata` at all: unkeyed, both answer `null`. That
 * conflation is precisely why the #11794 pin needed a 36-name hand list to say
 * anything about the text family, and avoiding it is what lets this file carry
 * none.
 *
 * An answer outside the table is a THROW rather than a default bucket: a switch
 * that grew a fifth behaviour must be classified on purpose, and silently
 * filing it under "not sized" would be this card's own defect committed by its
 * own guard.
 */
function columnShapeOf(driver: SqlDriver, type: string): ColumnShape {
  const mirror = (keyed?: { unique: boolean }) =>
    (driver as any).varcharColumnChars({ type, maxLength: PROBE_CHARS }, keyed) as number | null;
  const unkeyed = mirror(undefined);
  const keyed = mirror({ unique: false });

  if (unkeyed === PROBE_CHARS && keyed === PROBE_CHARS) return 'varchar-from-declaration';
  if (unkeyed === null && keyed === PROBE_CHARS) return 'text-family';
  if (unkeyed === DEFAULT_CHARS && keyed === DEFAULT_CHARS) return 'default-varchar-255';
  if (unkeyed === null && keyed === null) return 'not-sized-from-metadata';
  throw new Error(
    `#12017: varcharColumnChars answered (unkeyed=${String(unkeyed)}, keyed=${String(keyed)}) ` +
      `for type '${type}' at maxLength ${PROBE_CHARS} — a branch this guard does not classify. ` +
      `Classify it on purpose rather than widening a bucket.`,
  );
}

/** TEXT and not any varchar — `longtext`/`mediumtext` satisfy it too (#11794's reading). */
const isTexty = (t: unknown) => /text/i.test(String(t)) && !/varchar/i.test(String(t));

type ColumnInfo = Record<string, { type?: string; maxLength?: number | string }>;

describe('driver varchar sizing agrees with the spec bounded-string set (#12017)', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  /**
   * ⭐ THE ASSERTION. Over the spec's whole `FieldType` vocabulary, the types
   * this driver sizes from a declared `maxLength` are EXACTLY the types the
   * spec permits to declare one.
   *
   * Adding a member to `BOUNDED_STRING_FIELD_TYPES` without teaching the switch
   * reds here by name, and so does the converse. Neither list is written down
   * in this file.
   */
  it('sizes from a declaration exactly the FieldTypes the spec lets declare a bound', () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    const types = FieldType.options as readonly string[];
    expect(types.length).toBeGreaterThan(40); // the registry really was read

    const shapes = new Map(types.map((t) => [t, columnShapeOf(driver, t)] as const));
    const sized = types.filter((t) => SIZED_FROM_DECLARATION.includes(shapes.get(t)!)).sort();
    const permitted = [...BOUNDED_STRING_FIELD_TYPES].sort();

    // Non-vacuity, three ways: the spec's set is real, the classifier resolved
    // BOTH sizing branches (a probe that silently matched only one would make
    // the equality below far weaker than it reads), and the catch-all is
    // reachable — the last is the positive control for the failure mode itself,
    // since a classifier that could never SAY 'default-varchar-255' could never
    // report the drift this file exists to catch.
    expect(permitted.length).toBeGreaterThan(5);
    expect([...shapes.values()]).toContain('varchar-from-declaration');
    expect([...shapes.values()]).toContain('text-family');
    expect([...shapes.values()]).toContain('default-varchar-255');

    expect(sized).toEqual(permitted);
  });

  /**
   * ⚠️ The asymmetry the equality above is scoped around, pinned so the scoping
   * cannot be read as a convenient omission.
   *
   * `'string'` is in the switch's varchar branch and in NO spec set, because it
   * is not a spec type at all — it is what `field?.type || 'string'` supplies
   * when a field declares no type, i.e. knex's builder name. A field with no
   * `type` must therefore get the SAME answer as one typed `'string'`; that
   * equality is what makes "the untyped default" a measurement here rather than
   * a claim about intent.
   */
  it("pins 'string' as the switch's untyped default and not a spec FieldType", () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    const mirror = (field: any) => (driver as any).varcharColumnChars(field, undefined) as number | null;

    expect(FieldType.options as readonly string[]).not.toContain('string');
    expect(columnShapeOf(driver, 'string')).toBe('varchar-from-declaration');
    // No type at all — the default in the expression, not a case in the switch.
    expect(mirror({ maxLength: PROBE_CHARS })).toBe(PROBE_CHARS);
    expect(mirror({ type: 'string', maxLength: PROBE_CHARS })).toBe(PROBE_CHARS);

    // ⛔ The negative control for the classifier: an unknown type declaring the
    // same bound gets 255 — the declaration ignored. This is the exact shape a
    // drifted spec member would take, produced here on purpose so the guard is
    // known to be able to SEE it in this very run.
    expect(columnShapeOf(driver, 'os12017_not_a_field_type')).toBe('default-varchar-255');
    expect(mirror({ type: 'os12017_not_a_field_type', maxLength: PROBE_CHARS })).toBe(DEFAULT_CHARS);
  });

  /**
   * The physical half. The mirror is pinned to `createColumn` by #11565, but a
   * relationship this file states about COLUMNS is worth asserting against a
   * column: one real table, one field per member of the spec's set, each
   * declaring a bound four times wider than the catch-all's.
   *
   * The assertion is the invariant, not the partition: every member's column
   * either carries the declared width or is TEXT — never varchar(255), which
   * would mean the declaration was ignored. Stating it that way is deliberate;
   * asserting WHICH member gets which shape would copy the driver's partition
   * into this file and re-create the hand-maintained list the card is about.
   */
  it('lands no bounded-string member at varchar(255) when it declares a wider bound', async () => {
    const permitted = [...BOUNDED_STRING_FIELD_TYPES];
    const fields: Record<string, unknown> = Object.fromEntries(
      permitted.map((t) => [`f_${t}`, { type: t, maxLength: PROBE_CHARS }]),
    );
    // ⛔ The in-run control: `color` is the #11875 ruling's explicit carve-out —
    // NOT in the spec's set, so `FieldSchema` refuses this very declaration.
    // It is here only to show what the defect looks like physically, in this
    // table, in this run: a declared 700 landing as varchar(255). Without it a
    // green above could mean "the driver honours declarations" or "this table
    // never showed a 255 to begin with".
    fields.c_control_color = { type: 'color', maxLength: PROBE_CHARS };

    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([{ name: 'os12017_bounded_parity', fields }]);
    // The PRAGMA, not the emitter.
    const info: ColumnInfo = await (driver as any).knex('os12017_bounded_parity').columnInfo();

    const ignored: string[] = [];
    for (const t of permitted) {
      const landed = info[`f_${t}`];
      const type = String(landed?.type ?? '');
      const honoured = isTexty(type) || (/varchar/i.test(type) && Number(landed?.maxLength) === PROBE_CHARS);
      if (!honoured) ignored.push(`${t}: declared ${PROBE_CHARS}, landed ${type}(${String(landed?.maxLength)})`);
    }
    expect(ignored).toEqual([]);

    // The control really did produce the defect's signature.
    expect(/varchar/i.test(String(info.c_control_color?.type))).toBe(true);
    expect(Number(info.c_control_color?.maxLength)).toBe(DEFAULT_CHARS);
  });
});
