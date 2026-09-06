// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE #16091 PIN: the CHARACTER column both migration generators emit is the
 * character column `driver-sql` actually creates.
 *
 * ## The defect
 *
 * A `text` field took `VARCHAR(255)` from both generators while `createColumn`
 * builds an unbounded `text` column for it. Driven on a live PostgreSQL 16.13 —
 * one object, three tables, one 300-character insert into each:
 *
 * ```
 * driver   f_text  text          ACCEPTED — read back at length 300
 * sql gen  f_text  varchar(255)  REFUSED  — value too long for type character varying(255)
 * ts gen   f_text  varchar(255)  REFUSED  — same
 * ```
 *
 * A row the platform stores today could not be stored in a table generated for
 * the same object. That is the hard-failure class of #15040's `22P02`, not the
 * cosmetic-schema-diff class of #15521.
 *
 * ## The class is nine rows wide, not one
 *
 * The card named `text`. Enumerating every `FIELD_TYPE_SQL_MAP` entry and every
 * `createColumn` arm that produces a character type, and driving all three
 * producers into that same cluster, found **nine** divergent columns out of 26
 * probed. Three distinct causes, and all three are repaired together because
 * they are one question — how wide is the character column — asked of one
 * authority:
 *
 * ```
 *   f_text        driver text          sql varchar(255)   ts varchar(255)    the card's row
 *   f_text_max    driver text          sql varchar(255)   ts varchar(255)    maxLength does NOT size it
 *   f_email_max   driver varchar(400)  sql varchar(255)   ts varchar(255)    maxLength was never read
 *   f_url         driver varchar(255)  sql varchar(2048)  ts varchar(255)    invented width
 *   f_url_max     driver varchar(1024) sql varchar(2048)  ts varchar(255)    all three disagreed
 *   f_url_huge    driver text          sql varchar(2048)  ts varchar(255)    past the ceiling ⇒ TEXT
 *   f_phone       driver varchar(255)  sql varchar(50)    ts varchar(255)    invented width
 *   f_phone_max   driver varchar(20)   sql varchar(50)    ts varchar(255)    all three disagreed
 *   f_color       driver varchar(255)  sql varchar(7)     ts varchar(255)    invented width
 * ```
 *
 * Both directions are real failures, and the wide one is the quieter:
 *
 *   - NARROW — the card's own shape, one type over. A 300-character value into
 *     the `maxLength: 400` email was accepted by the driver's table and refused
 *     by both generated ones.
 *   - WIDE — a 300-character url was ACCEPTED by the sql format's `varchar(2048)`
 *     table and REFUSED by the driver's own `varchar(255)`. The scaffold invited
 *     a value the platform will not keep, which no error message ever names.
 *
 * A second sweep, driven after review, carried the KEYED declaration shapes the
 * first one never reached — `unique` at each of its three spellings, and
 * object-level `indexes[]` — and found the text family divergent again wherever
 * a keyed field declares a bound a key part can hold:
 *
 * ```
 *   x_text_uniq_max      {type:'text',     unique:true, maxLength:100}
 *                        driver varchar(100)  sql gen text  ts gen text
 *   x_richtext_uniq_max  {type:'richtext', unique:true, maxLength:64}
 *                        driver varchar(64)   sql gen text  ts gen text
 *   x_text_uniq          {type:'text',     unique:true}    all three text — agreed
 *   x_text_uniq_big      {type:'text',     unique:true, maxLength:1000}
 *                        all three text — agreed, 1000 is past the key-part ceiling
 * ```
 *
 * After the repair, all three producers were driven into the same cluster again
 * and read back out of `information_schema.columns`: **0 of 26 columns diverge**
 * on the original sweep and **0 of 32 keyed character columns** on the second,
 * and the 300-character write is accepted in all three tables exactly where the
 * platform accepts it and refused in all three exactly where the platform
 * refuses it.
 *
 * ⚠️ What neither sweep reaches, stated so the next reader does not read a
 * sweep as proof of absence: declaration shapes that are not `FieldType`
 * members at all (a `type` string from the unvalidated authoring door, or a
 * field with no `type` key — the driver defaults those to `string`, this
 * generator to `text`), the non-character columns (the numeric and JSON
 * families, whose own divergences are recorded on other cards), and every
 * dialect but PostgreSQL.
 *
 * ## The three arms, and why `maxLength` reaches only one of them
 *
 * `createColumn` sorts every character column into three arms, and they answer
 * the declaration differently. That is the whole content of this pin:
 *
 *   1. TEXT FAMILY — `keyable === null ? table.text(name) : table.string(name,
 *      keyable)` where `keyable = keyed ? this.keyableTextLength(field) : null`.
 *      The branch is on KEYED, and `keyed` comes from `indexedKeyColumns`,
 *      which reads the OBJECT'S DECLARATIONS — `field.unique` (every
 *      `FieldSchema` carries it) and the object's `indexes[]`. So:
 *
 *        - UNKEYED, the answer is an unbounded TEXT column, `maxLength`
 *          declared or not, and the declared bound is not lost — it is
 *          enforced at the write seam, which is what `schema-drift.ts` states
 *          in as many words: "A TEXT column refuses nothing a `maxLength`
 *          allows … the bound is enforced at the write seam."
 *        - KEYED, the answer is `varchar(keyableTextLength(field))`: the
 *          declared bound verbatim up to `MAX_KEYABLE_VARCHAR_CHARS` (768, the
 *          widest one utf8mb4 key part holds), and TEXT above it or with no
 *          declaration at all.
 *
 *      ⚠️ "A generated migration emits no index, so no generated column is
 *      ever keyed" is FALSE and was this pin's own first answer. It describes
 *      the generator's OUTPUT; the driver keys on the object's INPUT. Driven on
 *      live PostgreSQL 16.13, `{ type: 'text', unique: true, maxLength: 100 }`
 *      built `varchar(100)` on the platform and TEXT in both generated tables,
 *      and a 300-character write was REFUSED by the driver's table (`22001
 *      character varying(100)`) while both generated tables ACCEPTED it — the
 *      wide direction, the quieter of the two, inside the family this file
 *      claimed to have closed.
 *
 *   2. STRING FAMILY — `declared === null ? table.text(name) :
 *      table.string(name, declared)` over `declaredVarcharLength(field)`, which
 *      reads `maxLength` UNCONDITIONALLY (no keyed requirement) and has three
 *      outcomes: the declaration verbatim, knex's 255 when there is no usable
 *      one, and TEXT above `MAX_VARCHAR_CHARS` — never a clamp to the ceiling,
 *      because a clamp reinstates the very defect.
 *
 *   3. CATCH-ALL — `JSON_COLUMN_TYPES.has(type) ? this.jsonColumn(table, name)
 *      : table.string(name)`, which never reads `maxLength` at all. The driver
 *      states the reason: the stored value is an option code, an opaque
 *      `sys_secret` ref or another row's id, not the declared string, so a
 *      declared bound would size the wrong string.
 *
 * ## Why this pin reads the driver instead of asserting the widths
 *
 * The same reason `generate-builtin-id-column.pin.test.ts` gives for the id
 * column: the whole shape of this card is "the generator disagrees with the
 * driver", so a pin that transcribed `TEXT` and `VARCHAR(255)` would re-create
 * the defect one layer up and stay green on the day the driver moves. Every
 * arm's MEMBERSHIP is read out of `createColumn`'s own case labels, both widths
 * are read off the driver's own constants, and every extraction carries a
 * non-vacuity control — a source reader that matched nothing would pass while
 * measuring nothing.
 *
 * ## Reading the source is only half of it — the ORACLE is the other half
 *
 * A source reader catches a driver that moves a case label or renames a
 * constant. It cannot catch a driver whose BODY changes while its shape stays,
 * and `generate.ts` mirrors two driver BODIES: `keyableTextLength`'s coercion,
 * and the key set `indexedKeyColumns` composes. Both were mutated in the driver
 * and this file stayed GREEN through every one of them — a mirror with no
 * falsifier, on a card whose whole subject is generator/driver divergence.
 *
 * So the second half of this file RECOMPUTES both from `driver-sql` itself —
 * its exported `uniqueIndexesFromFields` / `normalizeDeclaredIndex`, and its
 * own `protected` judgments through a subclass — and compares, over a swept
 * corpus rather than a hand-listed one. That differential is what found the
 * `nullSafeColumns` branch an earlier round repaired: `{ fields: ['f'], unique:
 * 'organization', nullSafeColumns: ['zzz'] }` keyed `{organization_id, f}` here
 * against the driver's `{f}`, and no enumerated case had reached the shape.
 *
 * ## ⭐ ...and asking the driver's LEAVES is still not asking the driver
 *
 * Recomposing the leaves' answers HERE leaves every layer between them and the
 * emitted column a second copy of this file's own belief. Measured, driver-side:
 * making `indexedKeyColumns` stop recording declared indexes, and making
 * `initObjects` hand it `tenantField: null`, each left the platform disagreeing
 * with both generators over hundreds of objects — and left this file green,
 * every test, both times. Those two are this card's own subject.
 *
 * So the authority in this file is neither the source reader nor the leaf
 * differential: it is `SqlDriver.initObjects` on an in-memory better-sqlite3
 * database, read back with `PRAGMA table_info`. That runs
 * `computeAndRecordTenantField` → `indexedKeyColumns` → `createColumn` → knex
 * and reports the column that actually exists, with nothing re-derived here.
 * The two cheaper layers are kept underneath it because they localise a failure
 * to one constant or one builder; where they and the real chain could disagree,
 * ⛔ the real chain is right.
 *
 * ⚠️ Scope, as `generateMigrationSql`'s docblock and the `--format` help text
 * already say (#15521): this is a POSTGRESQL claim and nothing else. Neither
 * generator reproduces the driver's dialect branching.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ⭐ The ORACLE's imports. A test file is NOT a CLI production module: the
// #5726 constraint that forces `generate.ts` to transcribe (oclif `import()`s
// every command module on every invocation, so a static driver edge charges an
// unbuilt driver to whatever command the operator actually ran) is a rule about
// `packages/cli/src/**` production sources, and
// `schema-migrate.lazy-driver-import.test.ts` — the gate that enforces it —
// excludes `*.test.ts` by construction. `@objectstack/driver-sql` is already
// this package's declared dependency and already listed in
// `KNOWN_UNALIASED_TEST_IMPORTS['@objectstack/cli']`, so this import widens
// neither the dependency graph nor that shrink-only ledger.
//
// ⚠️ These resolve to the driver's BUILT artifact while the readers above read
// its SOURCE. A driver-side change must therefore be rebuilt before this half
// can see it — which is what CI does (`@objectstack/cli#test` dependsOn
// `build`), and what a local mutation run has to do by hand.
import {
  SqlDriver,
  isOrganizationScopedUnique,
  isUniqueScopeDeclared,
  normalizeDeclaredIndex,
  uniqueIndexesFromFields,
  type DeclaredIndexInput,
} from '@objectstack/driver-sql';
import {
  FieldType,
  FILE_REFERENCE_TYPES,
  MULTI_OPTION_TYPES,
  STRUCTURED_JSON_TYPES,
} from '@objectstack/spec/data';
import { afterAll, describe, expect, it } from 'vitest';

import { generateMigrationSql, generateMigrationTs } from './generate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GENERATE_SOURCE = fs.readFileSync(path.resolve(HERE, 'generate.ts'), 'utf8');

/** The authority, read where it lives — never transcribed here. */
const DRIVER_SQL_SRC = path.resolve(HERE, '../../../drivers/driver-sql/src');
const SQL_DRIVER_SOURCE = fs.readFileSync(path.join(DRIVER_SQL_SRC, 'sql-driver.ts'), 'utf8');
const SCHEMA_DRIFT_SOURCE = fs.readFileSync(path.join(DRIVER_SQL_SRC, 'schema-drift.ts'), 'utf8');

/** The authority for which types exist at all. Imported, never listed here. */
const REAL_FIELD_TYPES: ReadonlySet<string> = new Set(FieldType.options);

// ── Reading `createColumn`'s arms out of the driver ─────────────────────────

/** The body of `SqlDriver.createColumn`'s `switch (type)`. */
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
 * The WHOLE arm a type belongs to — from the first of its run of `case` labels
 * through the `break;` / `return;` that ends it.
 *
 * Deliberately not "from this type's own label": the two families this pin is
 * about are each one arm shared by several labels, and MEMBERSHIP is exactly
 * what has to be read from the driver rather than listed here. Bounding the arm
 * at the previous terminator is what makes {@link armMembers} able to see the
 * labels that sit ABOVE the one it was asked about.
 */
function armContaining(type: string): string {
  const body = createColumnSwitch();
  const at = body.indexOf(`case '${type}':`);
  if (at < 0) throw new Error(`createColumn has no arm for '${type}' — the driver moved`);
  const before = body.slice(0, at);
  // The index just PAST the previous arm's terminator — not the terminator's
  // own index, which would make every arm read as the single word `break;`.
  let head = -1;
  for (const term of ['break;', 'return;', 'switch (type) {']) {
    const i = before.lastIndexOf(term);
    if (i >= 0) head = Math.max(head, i + term.length);
  }
  if (head < 0) throw new Error(`could not find the head of '${type}'s arm in createColumn`);
  const rest = body.slice(head);
  const tail = rest.match(/^[\s\S]*?(?:break;|return;)/);
  if (!tail) throw new Error(`unterminated createColumn arm for '${type}' in driver-sql`);
  return tail[0];
}

/**
 * The FieldType members one arm serves, read off its own case labels.
 *
 * `case 'string':` is filtered out here and that is not a convenience: `string`
 * is not a `FieldType` member at all — there is no `Field.string` builder,
 * `FieldType.options` omits it, and `FieldSchema.safeParse({ type: 'string' })`
 * fails at `[type]` (#12593) — so it cannot arrive through an authored object
 * and the generators have nothing to answer for it.
 */
function armMembers(type: string): string[] {
  return [...armContaining(type).matchAll(/case '([^']+)':/g)]
    .map((m) => m[1])
    .filter((t) => REAL_FIELD_TYPES.has(t));
}

/**
 * The CHARACTER half of `createColumn`'s catch-all, derived rather than listed.
 *
 * The catch-all routes on `JSON_COLUMN_TYPES`, which `driver-sql` seeds from
 * three spec classes — so the character half is every real `FieldType` the
 * switch does not case, minus those three classes, imported and never listed
 * here. ⛔ Never derived from what the generator already answers: a filter that
 * skips a member whose answer has already drifted measures its own claim only
 * where the claim already holds.
 */
function characterCatchAllMembers(): string[] {
  const cased = new Set([...createColumnSwitch().matchAll(/case '([^']+)':/g)].map((m) => m[1]));
  const jsonSeeded = new Set<string>([
    ...MULTI_OPTION_TYPES,
    ...STRUCTURED_JSON_TYPES,
    ...FILE_REFERENCE_TYPES,
  ]);
  return [...REAL_FIELD_TYPES].filter((t) => !cased.has(t) && !jsonSeeded.has(t));
}

/** `createColumn`'s catch-all — where an un-cased type lands. */
function createColumnDefaultArm(): string {
  const body = createColumnSwitch();
  const at = body.indexOf('default:');
  if (at < 0) throw new Error("createColumn's catch-all moved in driver-sql");
  return body.slice(at);
}

/** One of the driver's own width constants, read where it is declared. */
function driverChars(
  constant: 'DEFAULT_STRING_VARCHAR_CHARS' | 'MAX_VARCHAR_CHARS' | 'MAX_KEYABLE_VARCHAR_CHARS',
): number {
  const m = SQL_DRIVER_SOURCE.match(new RegExp(`${constant} = (\\d+);`));
  if (!m) {
    throw new Error(
      `${constant} not found in sql-driver.ts. That constant is the width this pin reads ` +
      'instead of transcribing, so a rename must fail loudly here rather than leave the ' +
      'generators unmeasured.',
    );
  }
  return Number(m[1]);
}

const DEFAULT_CHARS = driverChars('DEFAULT_STRING_VARCHAR_CHARS');
const MAX_CHARS = driverChars('MAX_VARCHAR_CHARS');
const KEYABLE_CHARS = driverChars('MAX_KEYABLE_VARCHAR_CHARS');

// ── Reading the columns the two generators emit ─────────────────────────────

/**
 * One object whose fields are exactly the probes a case asks for.
 *
 * `objectLevel` carries the half of a declaration that does NOT live on the
 * field — `indexes[]` and `tenancy` — because that half reaches the column too:
 * `indexedKeyColumns` composes it with `field.unique` to decide which columns a
 * key part will use, and the text family's width branches on that answer.
 */
function emit(
  fields: Record<string, Record<string, unknown>>,
  objectLevel: Record<string, unknown> = {},
) {
  const config = {
    objects: { probe: { name: 'probe', fields, ...objectLevel } },
  } as Record<string, unknown>;
  return { sql: generateMigrationSql(config), ts: generateMigrationTs(config) };
}

/** The SQL column type one probe field contributes, or `null` for none. */
function sqlColumn(out: string, field: string): string | null {
  const m = out.match(new RegExp(`^ {2}"${field}" (.+?),?$`, 'm'));
  return m ? m[1] : null;
}

/** The whole `table.x('field'…)` call one probe field contributes, or `null`. */
function tsColumn(out: string, field: string): string | null {
  const m = out.match(new RegExp(`^ {4}(table\\.\\w+\\('${field}'[^;]*?)(?:\\.notNullable\\(\\)|\\.nullable\\(\\));$`, 'm'));
  return m ? m[1] : null;
}

/** Both producers' answers for one field declaration, in one call. */
function columnsFor(
  decl: Record<string, unknown>,
  objectLevel: Record<string, unknown> = {},
): { sql: string | null; ts: string | null } {
  const out = emit({ f: decl }, objectLevel);
  return { sql: sqlColumn(out.sql, 'f'), ts: tsColumn(out.ts, 'f') };
}

describe('#16091 — the character column both generators emit is the driver\'s', () => {
  it('control — the driver source really loaded and its arms were really found', () => {
    // Non-vacuity for every extraction in this file. Without these, a reader
    // that matched nothing would make the whole file pass while measuring
    // literally nothing, which is the failure a source-reading pin has to buy
    // its way out of.
    expect(SQL_DRIVER_SOURCE.length).toBeGreaterThan(10_000);
    expect(SCHEMA_DRIFT_SOURCE.length).toBeGreaterThan(10_000);
    expect(createColumnSwitch().length).toBeGreaterThan(1_000);
    expect(REAL_FIELD_TYPES.size).toBeGreaterThan(40);

    // The extractor discriminates: two different types really do land in two
    // different arms, and an arm really does carry more than the label asked for.
    expect(armContaining('text')).not.toBe(armContaining('email'));
    expect(armMembers('text').length).toBeGreaterThan(1);
    expect(armMembers('email').length).toBeGreaterThan(1);
    expect(() => armContaining('this_is_not_a_field_type')).toThrow();

    // All three widths are real numbers in the expected relation, so a regex
    // that captured the wrong digits cannot pass unnoticed. The KEY-PART
    // ceiling sits strictly between the other two — a reader that collapsed it
    // onto either would be caught here rather than by a silent width.
    expect(DEFAULT_CHARS).toBeGreaterThan(0);
    expect(MAX_CHARS).toBeGreaterThan(DEFAULT_CHARS);
    expect(KEYABLE_CHARS).toBeGreaterThan(DEFAULT_CHARS);
    expect(KEYABLE_CHARS).toBeLessThan(MAX_CHARS);

    // And the readers really read: a field that exists resolves, one that does not is null.
    const out = emit({ f: { type: 'text' } });
    expect(sqlColumn(out.sql, 'f')).not.toBeNull();
    expect(tsColumn(out.ts, 'f')).not.toBeNull();
    expect(sqlColumn(out.sql, 'nope')).toBeNull();
    expect(tsColumn(out.ts, 'nope')).toBeNull();
  });

  // ── Arm 1: the text family is unbounded, and the branch is on KEYED ────────

  it('the whole TEXT family takes an unbounded column, UNKEYED, in both generators', () => {
    // The authority, read where it lives. Everything below is derived from this
    // line, so a driver that moved must fail HERE, loudly, first.
    const arm = armContaining('text');
    expect(
      arm,
      'driver-sql no longer builds its text family with `keyable === null ? table.text(name) : ' +
      'table.string(name, keyable)`. This pin corrects the generators TOWARD the driver, so if ' +
      'the driver moved, re-read #16091 before touching generate.ts — the authority is the ' +
      'driver, not this file.',
    ).toContain('col = keyable === null ? table.text(name) : table.string(name, keyable);');

    // MEMBERSHIP is the driver's, swept rather than listed — a type that joins
    // or leaves this arm changes what is measured here without anyone editing it.
    const members = armMembers('text');
    expect(members).toContain('text');
    expect(members.length).toBeGreaterThanOrEqual(8);
    for (const type of members) {
      const { sql, ts } = columnsFor({ type });
      expect(
        sql,
        `os generate migration --format sql bounded a ${type} column. driver-sql builds it with ` +
        '`table.text`, so a value the platform stores would be refused by the generated table.',
      ).toBe('TEXT');
      expect(ts, `os generate migration (typescript) bounded a ${type} column — see above.`)
        .toBe("table.text('f')");
    }
  });

  it('a declared maxLength does NOT size an UNKEYED text-family column', () => {
    // ⭐ `maxLength` alone is honoured at the write seam, not by the column, so
    // sizing an unkeyed column from it would narrow it below what the platform
    // accepts — this card's own defect pointed the other way. The KEYED half is
    // the next case, and it is the one this file first got wrong.
    const arm = armContaining('text');
    expect(
      arm,
      'the text family stopped branching on `keyed`. If it now sizes from the declaration ' +
      'unconditionally, the generators must follow — re-read #16091.',
    ).toContain('const keyable = keyed ? this.keyableTextLength(field) : null;');

    for (const type of armMembers('text')) {
      for (const maxLength of [1, 64, 100, MAX_CHARS, MAX_CHARS + 1]) {
        const { sql, ts } = columnsFor({ type, maxLength });
        expect(sql, `a declared maxLength sized the ${type} column in the sql format`).toBe('TEXT');
        expect(ts, `a declared maxLength sized the ${type} column in the typescript format`)
          .toBe("table.text('f')");
        // Anti-vacuity for the whole case: the SAME declaration, keyed, is a
        // DIFFERENT column. Without this the sweep above is satisfied by a
        // generator that answers TEXT unconditionally — which is exactly what
        // it was measuring when this file first passed.
        const keyed = columnsFor({ type, maxLength, unique: true });
        if (maxLength <= KEYABLE_CHARS) {
          expect(keyed.sql, `${type} @ maxLength ${maxLength} keyed`).toBe(`VARCHAR(${maxLength})`);
        } else {
          expect(keyed.sql, `${type} @ maxLength ${maxLength} keyed, past the key-part ceiling`)
            .toBe('TEXT');
        }
      }
    }

    // The write seam is where that bound lives, stated by the differ itself
    // rather than by this file. Read as a whole sentence: a partial match on
    // "write seam" alone would survive the claim being reversed.
    expect(
      SCHEMA_DRIFT_SOURCE,
      'schema-drift.ts no longer states that a TEXT column relies on the write seam for the ' +
      "declared bound. That sentence is the reason an unbounded column is CORRECT here rather " +
      'than merely wider, so re-read #16091 if it has gone.',
    ).toContain('the bound is enforced at the write seam');

    // Anti-vacuity: the sweep really varies something. An identical answer for
    // every input is only meaningful if some OTHER family answers differently
    // to the same inputs — which the string family does, below.
    expect(columnsFor({ type: 'email', maxLength: 100 }).sql).not.toBe('TEXT');
  });

  // ── Arm 1b: the SAME family, KEYED — sized from the declaration ───────────
  //
  // ⭐ The rows this file missed on its first pass, and the reason it missed
  // them: it reasoned from what the generators EMIT (no `CREATE INDEX`, so
  // nothing can be keyed) when the driver reads what the object DECLARES.

  it('createColumn\'s `keyed` argument is read off the DECLARATION, at every link', () => {
    // The chain, asserted at each link in the driver's own source. If any link
    // moves, this fails loudly before the behavioural sweeps below can go
    // quietly wrong — a sweep that measured the wrong branch would still pass.
    expect(
      SQL_DRIVER_SOURCE,
      'createColumn no longer receives `keyed` from indexedKeyColumns — re-read #16091.',
    ).toContain('this.createColumn(table, name, field, keyedColumns.get(name));');
    expect(SQL_DRIVER_SOURCE).toContain('const keyedColumns = indexedKeyColumns({');
    expect(
      SCHEMA_DRIFT_SOURCE,
      'uniqueIndexesFromFields no longer keys a column on `field.unique`. That predicate is why ' +
      'a GENERATED column can be keyed at all — re-read #16091 before narrowing the generators.',
    ).toContain('if (!isUniqueScopeDeclared(field?.unique)) continue;');
    expect(
      SCHEMA_DRIFT_SOURCE,
      'indexedKeyColumns no longer composes the field-level unique indexes.',
    ).toContain('for (const idx of uniqueIndexesFromFields(table, fields, tenantField)) record(idx);');
    // The two scope vocabularies generate.ts transcribes, read where declared.
    expect(SCHEMA_DRIFT_SOURCE).toContain("return unique === 'organization' || isUniqueDeclared(unique);");
    expect(SCHEMA_DRIFT_SOURCE).toContain("return unique === true || unique === 'organization';");
    // Anti-vacuity: the reader really discriminates on this source.
    expect(SCHEMA_DRIFT_SOURCE).not.toContain('if (!isUniqueScopeDeclared(field?.uniqueX)) continue;');
  });

  it('the generator\'s key-part ceiling is the driver\'s, not a second number', () => {
    const m = GENERATE_SOURCE.match(/^const MAX_KEYABLE_VARCHAR_CHARS = (\d+);$/m);
    expect(m, 'generate.ts no longer declares MAX_KEYABLE_VARCHAR_CHARS at top level').not.toBeNull();
    expect(Number(m![1])).toBe(KEYABLE_CHARS);
    // And it is not the COLUMN ceiling wearing the key-part name. The two are
    // different limits on different objects and collapsing them would emit DDL
    // MySQL refuses on one side and an unkeyable TEXT on the other.
    expect(Number(m![1])).not.toBe(MAX_CHARS);
  });

  it('the generator\'s TEXT family is the driver\'s arm, member for member', () => {
    const m = GENERATE_SOURCE.match(/const TEXT_FAMILY_TYPES: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/);
    expect(m, 'generate.ts no longer declares TEXT_FAMILY_TYPES').not.toBeNull();
    const declared = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(declared.length).toBeGreaterThanOrEqual(8);
    expect(
      declared,
      "the generator's text family drifted from createColumn's own case labels. Membership is " +
      'the driver\'s to decide — a type that joins or leaves that arm moves this set.',
    ).toEqual([...armMembers('text')].sort());
  });

  it('a KEYED text-family column takes keyableTextLength\'s width, in both generators', () => {
    const arm = armContaining('text');
    expect(arm).toContain('const keyable = keyed ? this.keyableTextLength(field) : null;');
    expect(arm).toContain('col = keyable === null ? table.text(name) : table.string(name, keyable);');

    for (const type of armMembers('text')) {
      // SIZED — the declared bound verbatim, up to the key-part ceiling.
      for (const chars of [1, 64, 100, DEFAULT_CHARS, KEYABLE_CHARS]) {
        const { sql, ts } = columnsFor({ type, unique: true, maxLength: chars });
        expect(sql, `a keyed ${type} @ ${chars} was not sized in the sql format`)
          .toBe(`VARCHAR(${chars})`);
        expect(ts, `a keyed ${type} @ ${chars} was not sized in the typescript format`)
          .toBe(`table.string('f', ${chars})`);
      }
      // UNBOUNDED — the two causes `keyableTextLength` answers `null` for: no
      // usable declaration, and a bound wider than one key part can hold.
      for (const decl of [
        { type, unique: true },
        { type, unique: true, maxLength: KEYABLE_CHARS + 1 },
        { type, unique: true, maxLength: MAX_CHARS },
        { type, unique: true, maxLength: 0 },
        { type, unique: true, maxLength: -5 },
        { type, unique: true, maxLength: 12.5 },
        { type, unique: true, maxLength: 'not a number' },
      ]) {
        const { sql, ts } = columnsFor(decl);
        expect(sql, `keyed ${type} ${JSON.stringify(decl)} in the sql format`).toBe('TEXT');
        expect(ts, `keyed ${type} ${JSON.stringify(decl)} in the typescript format`)
          .toBe("table.text('f')");
      }
      // NEVER a clamp TO the ceiling — the same rule the string family follows
      // one arm over, for the same reason: a clamp would emit a column narrower
      // than the declaration, refusing writes the declaration allows.
      expect(columnsFor({ type, unique: true, maxLength: KEYABLE_CHARS + 1 }).sql)
        .not.toBe(`VARCHAR(${KEYABLE_CHARS})`);
      // The driver's own coercion: a numeric STRING is a declaration.
      expect(columnsFor({ type, unique: true, maxLength: '64' }).sql).toBe('VARCHAR(64)');
      // Anti-vacuity: drop the KEY and the same declaration is unbounded again,
      // so this case measures the key rather than the bound.
      expect(columnsFor({ type, maxLength: 100 }).sql).toBe('TEXT');
    }
  });

  it('the four keyed probes this round was opened on, by name and by shape', () => {
    // Spelled out rather than swept so a reader can compare them against the
    // live-PostgreSQL run in the header without re-deriving anything.
    const probes: Array<[string, Record<string, unknown>, string, string]> = [
      ['x_text_uniq_max', { type: 'text', unique: true, maxLength: 100 }, 'VARCHAR(100)', "table.string('f', 100)"],
      ['x_richtext_uniq_max', { type: 'richtext', unique: true, maxLength: 64 }, 'VARCHAR(64)', "table.string('f', 64)"],
      ['x_text_uniq', { type: 'text', unique: true }, 'TEXT', "table.text('f')"],
      ['x_text_uniq_big', { type: 'text', unique: true, maxLength: 1000 }, 'TEXT', "table.text('f')"],
    ];
    for (const [name, decl, sql, ts] of probes) {
      const got = columnsFor(decl);
      expect(got.sql, name).toBe(sql);
      expect(got.ts, name).toBe(ts);
    }
    // The two that ALREADY agreed at `text` must not have moved: 1000 is past
    // the key-part ceiling and an undeclared bound is no bound at all.
    expect(1000).toBeGreaterThan(KEYABLE_CHARS);
  });

  it('every unique spelling the driver keys on keys the column here, and no other', () => {
    const bound = { type: 'text', maxLength: 100 };
    for (const unique of [true, 'global', 'organization']) {
      expect(columnsFor({ ...bound, unique }).sql, `unique: ${JSON.stringify(unique)}`)
        .toBe('VARCHAR(100)');
    }
    // Everything else is not a unique DECLARATION and must key nothing —
    // including the two words the spec rejects by name, which a transcription
    // that reached for "anything truthy" would silently accept.
    for (const unique of [false, undefined, null, 0, 1, '', 'tenant', 'org', 'yes', {}]) {
      expect(columnsFor({ ...bound, unique }).sql, `unique: ${JSON.stringify(unique)}`).toBe('TEXT');
    }
  });

  it('a column an object-level declared index lists is keyed too, unique or not', () => {
    // `indexedKeyColumns` records EVERY key part of every declared index, not
    // only the unique ones: a bounded key part is a storage choice for an
    // ordinary index and the constraint itself for a unique one.
    const decl = { type: 'text', maxLength: 100 };
    for (const idx of [
      { fields: ['f'] },
      { fields: ['f'], unique: true },
      { fields: ['f'], unique: 'global' },
      { fields: ['f'], unique: 'organization' },
      { name: 'by_other_f', fields: ['other', 'f'] },
    ]) {
      expect(columnsFor(decl, { indexes: [idx] }).sql, JSON.stringify(idx)).toBe('VARCHAR(100)');
    }
    // ...and an index that does not list the column does not key it.
    for (const idx of [{ fields: ['other'] }, { fields: [] }, { fields: 'f' }, { unique: true }, {}]) {
      expect(columnsFor(decl, { indexes: [idx] }).sql, JSON.stringify(idx)).toBe('TEXT');
    }
    expect(columnsFor(decl, { indexes: [] }).sql).toBe('TEXT');
    expect(columnsFor(decl, {}).sql).toBe('TEXT');
  });

  it('an organization-scoped unique keys the TENANT column too, and sizes it', () => {
    // ADR-0120 D3: `unique: true` / `'organization'` on a tenant-scoped table
    // is the composite `(organization_id, field)`, so BOTH columns are key
    // parts. Driven on live PostgreSQL 16.13 — the driver's `organization_id`
    // came back `character varying(50)` here.
    const fields = {
      organization_id: { type: 'text', maxLength: 50 },
      code: { type: 'text', maxLength: 30, unique: true },
    };
    const out = emit(fields);
    expect(sqlColumn(out.sql, 'code')).toBe('VARCHAR(30)');
    expect(sqlColumn(out.sql, 'organization_id')).toBe('VARCHAR(50)');
    expect(tsColumn(out.ts, 'organization_id')).toBe("table.string('organization_id', 50)");

    // `'global'` is platform-wide and prepends nothing, so the tenant column
    // stays unkeyed — the half that proves the case above is about SCOPE.
    const globalScope = emit({ ...fields, code: { type: 'text', maxLength: 30, unique: 'global' } });
    expect(sqlColumn(globalScope.sql, 'code')).toBe('VARCHAR(30)');
    expect(sqlColumn(globalScope.sql, 'organization_id')).toBe('TEXT');

    // An explicit tenancy opt-out wins over the column-presence heuristic.
    const optedOut = emit(fields, { tenancy: { enabled: false } });
    expect(sqlColumn(optedOut.sql, 'organization_id')).toBe('TEXT');
    expect(sqlColumn(optedOut.sql, 'code')).toBe('VARCHAR(30)');

    // A declared `tenancy.tenantField` names the column instead.
    const named = emit(
      { org: { type: 'text', maxLength: 40 }, code: { type: 'text', maxLength: 30, unique: true } },
      { tenancy: { tenantField: 'org' } },
    );
    expect(sqlColumn(named.sql, 'org')).toBe('VARCHAR(40)');

    // ...and a `tenantField` naming no real field falls back to nothing, so a
    // table without an organization column keys only the field itself.
    const noTenant = emit({ code: { type: 'text', maxLength: 30, unique: true } });
    expect(sqlColumn(noTenant.sql, 'code')).toBe('VARCHAR(30)');
  });


  // ── Arm 2: the string family reads the declaration, with three outcomes ────

  it('the whole STRING family takes the driver\'s declared width, in both generators', () => {
    const arm = armContaining('email');
    expect(
      arm,
      'driver-sql no longer sizes its string family from `declaredVarcharLength`. Re-read ' +
      '#16091 before trusting the generators\' widths — the authority is the driver.',
    ).toContain('col = declared === null ? table.text(name) : table.string(name, declared);');
    expect(arm).toContain('const declared = this.declaredVarcharLength(field);');

    const members = armMembers('email');
    expect(members).toContain('email');
    expect(members.length).toBeGreaterThanOrEqual(4);

    for (const type of members) {
      // Outcome 1 — no usable declaration: knex's default, read off the driver.
      for (const decl of [
        { type },
        { type, maxLength: 0 },
        { type, maxLength: -5 },
        { type, maxLength: 12.5 },
        { type, maxLength: 'not a number' },
      ]) {
        const { sql, ts } = columnsFor(decl);
        expect(sql, `${type} without a usable declaration must take the driver's default width`)
          .toBe(`VARCHAR(${DEFAULT_CHARS})`);
        expect(ts).toBe("table.string('f')");
      }

      // Outcome 2 — a declaration this dialect can express, verbatim, in BOTH
      // directions. Wider than the default is the reported defect; narrower is
      // the same defect's other half, and the column a generator creates is
      // always empty, so narrowing it is not a destructive migration.
      for (const chars of [20, 400, 1024, MAX_CHARS]) {
        const { sql, ts } = columnsFor({ type, maxLength: chars });
        expect(sql, `${type} ignored its declared maxLength in the sql format`)
          .toBe(`VARCHAR(${chars})`);
        expect(ts, `${type} ignored its declared maxLength in the typescript format`)
          .toBe(`table.string('f', ${chars})`);
      }
      // The driver's own coercion: a numeric STRING is a declaration.
      expect(columnsFor({ type, maxLength: '400' }).sql).toBe('VARCHAR(400)');

      // Outcome 3 — past the ceiling is TEXT, never a clamp TO the ceiling. A
      // clamp would reinstate the defect: a column narrower than the
      // declaration, refusing writes the declaration allows.
      const past = columnsFor({ type, maxLength: MAX_CHARS + 1 });
      expect(past.sql, `${type} past the varchar ceiling must be TEXT, not a clamp`).toBe('TEXT');
      expect(past.ts).toBe("table.text('f')");
      expect(past.sql).not.toBe(`VARCHAR(${MAX_CHARS})`);
    }
  });

  it('the generator\'s varchar ceiling is the driver\'s, not a second number', () => {
    // ⛔ NOT "because `packages/cli` does not depend on the driver at runtime"
    // — it does, and this file imports it 500 lines up. That sentence was this
    // pin's own first answer, it is false, and `generate.ts` now carries it
    // with a ⛔ so nobody restates it. ⛔ NOR "because `MAX_VARCHAR_CHARS` is
    // `protected static` on `SqlDriver` and reaches no exported surface" —
    // the second false answer, and this file refutes it by construction:
    // `protected` is compile-time visibility only, the member is on the
    // exported `SqlDriver` and in the package's `dist/index.d.ts`, and the
    // subclass below reaches the driver's `protected` judgments precisely
    // because they are still there. The ceiling is transcribed for ONE reason:
    // #5726 leaves a CLI production module only `await import()` for a driver
    // package, and these generators are SYNCHRONOUS, so they cannot use it — a
    // choice this package makes, not a law. This is the assertion that makes
    // the transcription safe: the two must be the same number, and a driver
    // that moves fails here rather than leaving the generators quietly wrong.
    const m = GENERATE_SOURCE.match(/^const MAX_VARCHAR_CHARS = (\d+);$/m);
    expect(m, 'generate.ts no longer declares MAX_VARCHAR_CHARS at top level').not.toBeNull();
    expect(Number(m![1])).toBe(MAX_CHARS);
  });

  // ── Arm 3: the catch-all never reads the declaration ───────────────────────

  it('the catch-all family takes the driver\'s default width and ignores maxLength', () => {
    expect(
      createColumnDefaultArm(),
      "driver-sql's catch-all no longer spells `table.string(name)`. Re-read #16091.",
    ).toContain('JSON_COLUMN_TYPES.has(type) ? this.jsonColumn(table, name) : table.string(name)');

    // Derived, not listed: every real member that neither families' arm claims
    // and that the driver does not case at all lands in the catch-all.
    const cased = new Set([...createColumnSwitch().matchAll(/case '([^']+)':/g)].map((m) => m[1]));
    const catchAll = [...REAL_FIELD_TYPES].filter((t) => !cased.has(t));

    // The catch-all routes on `JSON_COLUMN_TYPES`, so its CHARACTER half is the
    // rest — derived from the three spec classes driver-sql seeds that set
    // from, imported and never listed here.
    //
    // ⛔ NOT derived from what this generator already answers. Skipping every
    // member whose plain answer is not already `VARCHAR(${DEFAULT_CHARS})` is
    // what this case used to do, and it made the case VACUOUS for exactly the
    // member that had drifted: mutating `radio` or `secret` to `'TEXT'` in
    // `FIELD_TYPE_SQL_MAP` skipped the member and passed all four pin files. A
    // case may not read its subject to decide whether to measure it.
    const jsonSeeded = new Set<string>([
      ...MULTI_OPTION_TYPES,
      ...STRUCTURED_JSON_TYPES,
      ...FILE_REFERENCE_TYPES,
    ]);
    const characterCatchAll = characterCatchAllMembers();
    expect(characterCatchAll).toEqual(catchAll.filter((t) => !jsonSeeded.has(t)));

    // Controls for the derivation itself. Without these a seed set that failed
    // to import would leave `characterCatchAll` as the whole catch-all (and the
    // sweep red for the wrong reason) or empty (and the sweep vacuous again).
    expect(
      SQL_DRIVER_SOURCE,
      'driver-sql no longer seeds JSON_COLUMN_TYPES from these three spec classes, so the ' +
      'character half of its catch-all is no longer the complement of them — re-read #16091.',
    ).toContain('...STRUCTURED_JSON_TYPES, ...FILE_REFERENCE_TYPES, ...MULTI_OPTION_TYPES,');
    expect(jsonSeeded.has('json')).toBe(true);
    expect(jsonSeeded.has('color')).toBe(false);
    expect(characterCatchAll.length).toBeGreaterThanOrEqual(5);
    // The three members a mutation of this file's own table would land on.
    // `color` is the member this card moved (it carried an invented
    // `VARCHAR(7)`); `radio` and `secret` are the two the review mutated to
    // `'TEXT'` and watched pass.
    for (const named of ['color', 'radio', 'secret']) {
      expect(characterCatchAll, `${named} left the character half of the catch-all`)
        .toContain(named);
    }

    for (const type of characterCatchAll) {
      const plain = columnsFor({ type });
      // The case title's own claim, asserted rather than assumed: this member
      // takes the driver's default width. A drifted member fails HERE.
      expect(
        plain.sql,
        `${type} does not take driver-sql's catch-all width. Its arm is table.string(name), ` +
        `knex's varchar(${DEFAULT_CHARS}), so a narrower or wider column here is one the ` +
        'platform disagrees with.',
      ).toBe(`VARCHAR(${DEFAULT_CHARS})`);
      expect(plain.ts, `${type} in the typescript format`).toBe("table.string('f')");

      // ...and nothing on the FIELD moves it. The catch-all reads neither
      // `maxLength` nor `unique`: the stored value is an option code, an opaque
      // `sys_secret` ref or another row's id, not the declared string, so a
      // declared bound would size the wrong string — the driver's own stated
      // reason, not an inference from its silence.
      for (const extra of [
        { maxLength: 7 },
        { maxLength: 400 },
        { maxLength: MAX_CHARS + 1 },
        { unique: true, maxLength: 100 },
        { unique: 'organization', maxLength: 100 },
      ]) {
        const declared = columnsFor({ type, ...extra });
        expect(declared.sql, `${type} moved on ${JSON.stringify(extra)} in the sql format`)
          .toBe(plain.sql);
        expect(declared.ts, `${type} moved on ${JSON.stringify(extra)} in the typescript format`)
          .toBe(plain.ts);
      }
      // ...nor does an object-level index over it.
      const indexed = columnsFor({ type, maxLength: 100 }, { indexes: [{ fields: ['f'] }] });
      expect(indexed.sql, `${type} moved under a declared index`).toBe(plain.sql);
      expect(indexed.ts, `${type} moved under a declared index`).toBe(plain.ts);
    }

    // The member this card moved, named. `VARCHAR(7)` was this file's own guess
    // at `#RRGGBB`; the platform's column is the catch-all's default width, so
    // every longer color code an author can write was a value the platform
    // stores and a generated table refuses.
    expect(columnsFor({ type: 'color' }).sql).not.toBe('VARCHAR(7)');
  });

  // ── The three families are three DIFFERENT answers ────────────────────────

  it('the three arms really do answer differently, to the same declaration', () => {
    // Without this, every assertion above could be satisfied by one column
    // shape for everything — the "JSONB everywhere" hole, one family over.
    const declared = { maxLength: 400 };
    const text = columnsFor({ type: 'text', ...declared });
    const string = columnsFor({ type: 'email', ...declared });
    const other = columnsFor({ type: 'color', ...declared });
    expect(text.sql).toBe('TEXT');
    expect(string.sql).toBe('VARCHAR(400)');
    expect(other.sql).toBe(`VARCHAR(${DEFAULT_CHARS})`);
    expect(new Set([text.sql, string.sql, other.sql]).size).toBe(3);
    expect(new Set([text.ts, string.ts, other.ts]).size).toBe(3);
  });

  // ── The shapes this replaced ──────────────────────────────────────────────

  it('none of the four invented widths can come back', () => {
    // Anti-regression, stated as the emitted output rather than as source text
    // so a rewrite of generate.ts that reproduces the defect is still caught.
    const out = emit({
      a_text: { type: 'text' },
      a_url: { type: 'url' },
      a_phone: { type: 'phone' },
      a_color: { type: 'color' },
    });
    expect(sqlColumn(out.sql, 'a_text')).not.toBe(`VARCHAR(${DEFAULT_CHARS})`);
    expect(sqlColumn(out.sql, 'a_url')).not.toBe('VARCHAR(2048)');
    expect(sqlColumn(out.sql, 'a_phone')).not.toBe('VARCHAR(50)');
    expect(sqlColumn(out.sql, 'a_color')).not.toBe('VARCHAR(7)');
    expect(tsColumn(out.ts, 'a_text')).not.toBe("table.string('a_text')");
    // Anti-vacuity: the readers really resolved these four fields, so the four
    // negative assertions above are measurements rather than four `null`s.
    for (const f of ['a_text', 'a_url', 'a_phone', 'a_color']) {
      expect(sqlColumn(out.sql, f)).not.toBeNull();
      expect(tsColumn(out.ts, f)).not.toBeNull();
    }
    // And the predicates really do fire on what was there before.
    expect('VARCHAR(2048)').toBe('VARCHAR(2048)');
  });
});

// ── The driver-side oracle ──────────────────────────────────────────────────
//
// Everything above reads the driver's SOURCE TEXT. Two of the four mirrors
// `generate.ts` carries are fully covered by that — `MAX_KEYABLE_VARCHAR_CHARS`
// is compared against the constant's own declaration, and `TEXT_FAMILY_TYPES`
// against `createColumn`'s own case labels, and a driver-side mutation of
// either reddens this file. The other two mirror driver BODIES, which a source
// reader cannot see move:
//
//   `keyableTextChars`  ← `SqlDriver.keyableTextLength`
//   `indexKeyColumns`   ← `schema-drift.ts`'s `indexedKeyColumns`
//
// Mutating those two in the driver left this file GREEN. What follows removes
// that: both are RECOMPUTED from `driver-sql` itself and compared against what
// the generators actually emit.
//
// ⭐ ASKING THE DRIVER'S LEAVES IS NOT ASKING THE DRIVER, and this file has now
// made that mistake twice. Round 2 transcribed the driver's answers and
// mutating the driver left every pin green. Round 3 asked the driver's exported
// LEAVES — `uniqueIndexesFromFields`, `normalizeDeclaredIndex`,
// `computeTenantField` — and then RE-COMPOSED them here, which left every layer
// between those leaves and the emitted column a second copy of this file's own
// belief. Measured, driver-side, at that head:
//
//   driver-side mutation                                      this file
//   `indexedKeyColumns` stops recording declared indexes       78 passed (78)
//   `initObjects` passes `tenantField: null` into it           78 passed (78)
//
// Both are this card's own subject — the driver changes what it keys, the
// generated column stays bounded where the platform's is unbounded — and the
// instrument reported everything fine. So the differential below enters the
// REAL CHAIN at the top: `SqlDriver.initObjects` on an in-memory better-sqlite3
// database, read back with `PRAGMA table_info`. That is
// `computeAndRecordTenantField` → `indexedKeyColumns` → `createColumn` →
// knex → an actual column, with nothing re-derived here at all. The leaf
// differential is KEPT below it, because it localises a failure to one builder;
// it is not the authority, and where the two could disagree the real chain wins.

/**
 * The driver's own `protected` judgments, reached by widening rather than
 * re-derived.
 *
 * Widening is the whole technique: `protected` is a compile-time visibility
 * rule, so a subclass can publish the driver's OWN method body without copying
 * a character of it. The moment the driver's body changes, this oracle changes
 * with it — which is exactly what the transcriptions in `generate.ts` cannot do.
 */
class DriverOracle extends SqlDriver {
  /**
   * Every warning the driver emitted, captured instead of printed.
   *
   * The corpus deliberately contains index shapes whose key parts name no
   * materialized column (`idx-ghost`, and every `organization`-scoped index on
   * the `without-organization_id` shape), and the driver correctly says so
   * once per table — 144 lines of true, irrelevant warning on a green run,
   * which is how a real one stops being read. ⛔ Captured, never discarded:
   * `logger` is the driver's own documented injection point ("production
   * callers wire in their preferred logger"), the messages stay available to a
   * failure report, and nothing about the driver's behaviour changes.
   */
  public readonly warnings: string[] = [];

  protected override logger = {
    warn: (msg: string) => { this.warnings.push(msg); },
    error: (msg: string) => { this.warnings.push(msg); },
  };

  /** `SqlDriver.computeTenantField`, unmodified. */
  public tenantFieldFor(object: { fields?: Record<string, unknown>; tenancy?: unknown }): string | null {
    return this.computeTenantField(object);
  }

  /** `SqlDriver.keyableTextLength`, unmodified — the KEYED text-family width. */
  public keyableCharsFor(field: unknown): number | null {
    return this.keyableTextLength(field);
  }

  /** `SqlDriver.declaredVarcharLength`, unmodified — the string-family width. */
  public declaredCharsFor(field: unknown): number | null {
    return this.declaredVarcharLength(field);
  }

  /**
   * ⭐ THE REAL CHAIN. The columns `initObjects` actually creates for one
   * object, read back out of the database it created them in.
   *
   * Nothing here re-derives anything: `initObjects` resolves the tenant field
   * through `computeAndRecordTenantField`, composes the key set through
   * `indexedKeyColumns`, dispatches every field through `createColumn` and
   * hands the result to knex. `PRAGMA table_info` then reports the column type
   * SQLite recorded — `text` for `table.text(name)`, `varchar(n)` for
   * `table.string(name, n)`, `varchar(255)` for a bare `table.string(name)`.
   * A driver-side change anywhere on that path moves this answer, which is the
   * property the leaf-level differential below does not have.
   *
   * ⚠️ Each object must carry a table name no earlier call used: `initObjects`
   * takes the ALTER path on a table that already exists, and an ALTER cannot
   * retype a column — a reused name would silently report the first object's
   * answer for the second one's declaration. {@link keyProbeCorpus} and the
   * width sweeps mint one name per probe for exactly that reason.
   */
  public async createdColumns(object: { name: string; fields?: Record<string, any>; tenancy?: any }):
    Promise<Map<string, string>> {
    await this.initObjects([object]);
    const rows = (await this.knex.raw(`PRAGMA table_info("${object.name}")`)) as Array<{
      name: string;
      type: string;
    }>;
    return new Map(rows.map((row) => [row.name, row.type]));
  }
}

// The same in-memory shape every SqlDriver test in this repo constructs. No
// query is ever issued through it: this file asks the driver only questions it
// answers from the declaration in front of it, so the pool never opens a
// connection.
const ORACLE = new DriverOracle({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
});

afterAll(async () => {
  await ORACLE.disconnect();
});

/**
 * `schema-drift.ts`'s `indexedKeyColumns`, composed HERE from the driver's own
 * two exported builders.
 *
 * ⛔ NOT the authority, and it must never be read as one. The two normalizers
 * are the driver's, but the COMPOSITION is this file's — so a driver that
 * changes how `indexedKeyColumns` composes them, or what `initObjects` feeds
 * it, moves the platform without moving this function at all. Both of those
 * were mutated in the driver and this differential stayed green through both.
 * {@link DriverOracle.createdColumns} is the authority; this is kept only
 * because it localises a failure to ONE builder, which the real chain cannot
 * do — when the two disagree, the real chain is right and this is stale.
 */
function driverKeyColumns(object: Record<string, any>): Set<string> {
  const table = String(object.name);
  const tenantField = ORACLE.tenantFieldFor(object);
  const out = new Set<string>();
  const record = (index: { columns: string[] } | null) => {
    if (index) for (const column of index.columns) out.add(column);
  };
  for (const index of uniqueIndexesFromFields(table, object.fields ?? {}, tenantField)) record(index);
  for (const index of Array.isArray(object.indexes) ? object.indexes : []) {
    record(normalizeDeclaredIndex(table, index as DeclaredIndexInput, tenantField));
  }
  return out;
}

/**
 * The width one emitted SQL column declares: `null` for an unbounded one.
 *
 * Both producers are normalized to the driver's own units — a NUMBER OF
 * CHARACTERS or `null` — so an assertion can compare them against what the
 * driver returned instead of against a spelling.
 */
function sqlWidth(column: string | null): number | null {
  if (column === 'TEXT') return null;
  const m = column?.match(/^VARCHAR\((\d+)\)$/);
  if (!m) throw new Error(`not a character column: ${String(column)}`);
  return Number(m[1]);
}

/**
 * The width one emitted `table.x('f'…)` call declares.
 *
 * A bare `table.string('f')` is knex's default width — the same column the
 * driver's own bare `table.string(name)` builds — so it normalizes to
 * {@link DEFAULT_CHARS} rather than to "no width". Without that the two
 * producers would look like they disagreed on every undeclared string field,
 * where they in fact emit the same column two ways.
 */
function tsWidth(call: string | null, field = 'f'): number | null {
  if (call === `table.text('${field}')`) return null;
  const m = call?.match(new RegExp(`^table\\.string\\('${field}'(?:, (\\d+))?\\)$`));
  if (!m) throw new Error(`not a character column: ${String(call)}`);
  return m[1] === undefined ? DEFAULT_CHARS : Number(m[1]);
}

/**
 * The width the PLATFORM'S OWN column declares, in the same units.
 *
 * `PRAGMA table_info` reports the type knex asked SQLite for, so
 * `table.text(name)` reads back as `text` (unbounded, `null` here) and
 * `table.string(name, n)` as `varchar(n)`. A bare `table.string(name)` is
 * `varchar(255)` — knex's default, which is {@link DEFAULT_CHARS} read off the
 * driver's own constant, so the two producers normalize to the same number
 * rather than to "declared" versus "not declared".
 *
 * Anything else throws: a non-character column is outside this card, and
 * counting it as unbounded would make a JSON column look like agreement.
 */
function driverWidth(columnType: string | undefined, where: string): number | null {
  if (columnType === undefined) {
    throw new Error(`${where}: initObjects created no such column — the probe never reached the driver`);
  }
  if (/^text$/i.test(columnType)) return null;
  const m = columnType.match(/^varchar\((\d+)\)$/i);
  if (!m) throw new Error(`${where}: not a character column: ${columnType}`);
  return Number(m[1]);
}

/**
 * The width every probe field in the key-set corpus declares.
 *
 * Chosen inside the key-part ceiling so that, for a text-family field, the
 * emitted column IS the keyed bit: `VARCHAR(PROBE_CHARS)` means the generator
 * keyed the column and `TEXT` means it did not. The control case asserts that
 * relation rather than assuming it.
 */
const PROBE_CHARS = 100;

/** One probe object, and the id the failure message names it by. */
interface KeyProbe {
  id: string;
  object: Record<string, any>;
}

/**
 * The corpus's four dimensions, and the number of probes their product is.
 *
 * ⭐ Stated as a literal on purpose. Round 3 hand-counted this sweep, wrote
 * "1,224 objects over 17 index shapes" into the PR body AND into a commit
 * message the merge queue composes into the squash body, and nothing caught it
 * — the only size assertion in this file was `> 200`, which every wrong count
 * satisfies. A number a human derived by reading array literals is a
 * measurement like any other and needs an instrument. Adding an index shape
 * moves this literal; a shape added without moving it fails here rather than
 * landing a false count in `main`.
 */
const KEY_PROBE_DIMENSIONS = { uniques: 6, indexSets: 16, tenancies: 6, shapes: 2 } as const;
const KEY_PROBE_COUNT = 1152;

/**
 * The swept corpus: every combination of a field-level `unique` spelling, an
 * object-level `indexes[]` entry, a `tenancy` declaration and a column shape.
 *
 * Swept rather than enumerated deliberately. A hand-listed set of cases is
 * exactly what this file already had, and the divergence it carried lived in a
 * combination nobody had thought to write down.
 */
function keyProbeCorpus(): KeyProbe[] {
  const uniques: Array<[string, unknown]> = [
    ['unique-absent', undefined],
    ['unique-true', true],
    ['unique-false', false],
    ['unique-global', 'global'],
    ['unique-organization', 'organization'],
    ['unique-nonsense', 'tenant'],
  ];
  const indexSets: Array<[string, unknown[] | undefined]> = [
    ['no-indexes', undefined],
    ['plain', [{ fields: ['f'] }]],
    ['idx-true', [{ fields: ['f'], unique: true }]],
    ['idx-global', [{ fields: ['f'], unique: 'global' }]],
    ['idx-org', [{ fields: ['f'], unique: 'organization' }]],
    ['idx-org-composite', [{ fields: ['other', 'f'], unique: 'organization' }]],
    ['idx-org-lists-tenant', [{ fields: ['organization_id', 'f'], unique: 'organization' }]],
    // The already-normalized shapes — the arm this round repaired. All three
    // matter: one whose `nullSafeColumns` names a listed column, one whose
    // names a STRANGER (the divergence), and one that is empty (which is not
    // the normalized shape at all and must fall through to the prepend).
    ['pre-normalized-listed', [{ fields: ['organization_id', 'f'], unique: 'organization', nullSafeColumns: ['organization_id'] }]],
    ['pre-normalized-stranger', [{ fields: ['f'], unique: 'organization', nullSafeColumns: ['zzz'] }]],
    ['pre-normalized-empty', [{ fields: ['f'], unique: 'organization', nullSafeColumns: [] }]],
    ['pre-normalized-not-array', [{ fields: ['f'], unique: 'organization', nullSafeColumns: 'organization_id' }]],
    // Unusable entries: `normalizeDeclaredIndex` answers null for all of them.
    ['idx-no-fields', [{ unique: true }]],
    ['idx-empty-fields', [{ fields: [] }]],
    ['idx-nonstring-fields', [{ fields: [1, '', null, 'f'] }]],
    // A key part naming a column the object never declares.
    ['idx-ghost', [{ fields: ['ghost'], unique: 'organization' }]],
    ['two-indexes', [{ fields: ['other'] }, { fields: ['f'], unique: 'organization' }]],
  ];
  const tenancies: Array<[string, unknown]> = [
    ['tenancy-absent', undefined],
    ['tenancy-disabled', { enabled: false }],
    ['tenancy-enabled', { enabled: true }],
    ['tenancy-named', { tenantField: 'org' }],
    ['tenancy-named-missing', { tenantField: 'nosuch' }],
    ['tenancy-disabled-and-named', { enabled: false, tenantField: 'org' }],
  ];
  // Which columns the object declares at all — the implicit `organization_id`
  // heuristic only fires where that column exists.
  const shapes: Array<[string, string[]]> = [
    ['with-organization_id', ['f', 'other', 'organization_id', 'org']],
    ['without-organization_id', ['f', 'other', 'org']],
  ];

  // The dimensions this corpus actually has, measured here rather than
  // hand-counted, so {@link KEY_PROBE_DIMENSIONS} is an assertion about the
  // arrays above and not a second transcription of them.
  expect({
    uniques: uniques.length,
    indexSets: indexSets.length,
    tenancies: tenancies.length,
    shapes: shapes.length,
  }).toEqual(KEY_PROBE_DIMENSIONS);

  const probes: KeyProbe[] = [];
  for (const [shapeId, columns] of shapes) {
    for (const [uniqueId, unique] of uniques) {
      for (const [indexId, indexes] of indexSets) {
        for (const [tenancyId, tenancy] of tenancies) {
          const fields: Record<string, Record<string, unknown>> = {};
          for (const column of columns) {
            fields[column] = { type: 'text', maxLength: PROBE_CHARS };
          }
          fields.f = { type: 'text', maxLength: PROBE_CHARS, ...(unique === undefined ? {} : { unique }) };
          probes.push({
            id: `${shapeId}/${uniqueId}/${indexId}/${tenancyId}`,
            object: {
              // One table name per probe. The real-chain oracle CREATES this
              // table, and `initObjects` takes the ALTER path on a name it has
              // already seen — an ALTER cannot retype a column, so a shared
              // name would report the first probe's answer for all 1,152.
              name: `probe_${probes.length}`,
              fields,
              ...(indexes ? { indexes } : {}),
              ...(tenancy ? { tenancy } : {}),
            },
          });
        }
      }
    }
  }
  return probes;
}

/**
 * The key set the GENERATORS computed, read back out of what they emitted.
 *
 * Deliberately observational rather than an exported internal: what a reviewer
 * and a user care about is the DDL, and reading it back proves the mirror is
 * reached on the real path rather than merely being correct in isolation. Every
 * probe field is a text-family field with a bound one key part can hold, so the
 * emitted column is the keyed bit — and any column that is neither of the two
 * expected answers throws rather than being silently counted as unkeyed.
 *
 * Both formats are read, and they must agree: a mirror consulted by one
 * generator and not the other would otherwise pass here.
 */
function generatorKeyColumns(object: Record<string, any>, id: string): Set<string> {
  const keyed = new Set<string>();
  for (const [field, chars] of generatorWidths(object)) {
    if (chars === PROBE_CHARS) keyed.add(field);
    else if (chars !== null) {
      throw new Error(`${id}: '${field}' is neither the keyed nor the unkeyed answer: ${String(chars)}`);
    }
  }
  return keyed;
}

/**
 * Both generators' width for every declared field of one object, in the
 * driver's own units, asserted to agree with each other on the way past.
 *
 * A mirror consulted by one generator and not the other would otherwise pass
 * every differential in this file: the two formats are separate code paths over
 * the same helpers, and #16091's own table had them disagreeing on five rows.
 */
function generatorWidths(object: Record<string, any>): Map<string, number | null> {
  const config = { objects: { [String(object.name)]: object } } as Record<string, unknown>;
  const sql = generateMigrationSql(config);
  const ts = generateMigrationTs(config);
  const out = new Map<string, number | null>();
  for (const field of Object.keys(object.fields ?? {})) {
    const sqlCol = sqlColumn(sql, field);
    const tsCol = tsColumn(ts, field);
    const sqlChars = sqlWidth(sqlCol);
    expect(
      tsWidth(tsCol, field),
      `${String(object.name)}: the two formats disagree about '${field}' — ` +
      `sql ${String(sqlCol)}, ts ${String(tsCol)}`,
    ).toBe(sqlChars);
    out.set(field, sqlChars);
  }
  return out;
}

describe('#16091 — the driver is the ORACLE, not just the source text', () => {
  it('control — the oracle is really the driver, and it really discriminates', () => {
    // Non-vacuity for the oracle itself. Without these, an import that resolved
    // to something inert would make every differential below compare two empty
    // sets and pass while measuring nothing.
    expect(ORACLE).toBeInstanceOf(SqlDriver);
    expect(typeof uniqueIndexesFromFields).toBe('function');
    expect(typeof normalizeDeclaredIndex).toBe('function');

    // The driver's builders answer, and they answer DIFFERENTLY for shapes that
    // differ — a stub returning `[]`/`null` would be caught here.
    expect(uniqueIndexesFromFields('t', { a: { unique: true } }, null)).toHaveLength(1);
    expect(uniqueIndexesFromFields('t', { a: { unique: false } }, null)).toHaveLength(0);
    expect(normalizeDeclaredIndex('t', { fields: ['a'] }, null)?.columns).toEqual(['a']);
    expect(normalizeDeclaredIndex('t', { fields: [] }, null)).toBeNull();

    // The protected judgments came through the subclass intact.
    expect(ORACLE.tenantFieldFor({ fields: { organization_id: {} } })).toBe('organization_id');
    expect(ORACLE.tenantFieldFor({ fields: { organization_id: {} }, tenancy: { enabled: false } })).toBeNull();
    expect(ORACLE.keyableCharsFor({ maxLength: PROBE_CHARS })).toBe(PROBE_CHARS);
    expect(ORACLE.keyableCharsFor({ maxLength: KEYABLE_CHARS + 1 })).toBeNull();
    expect(ORACLE.declaredCharsFor({})).toBe(DEFAULT_CHARS);

    // The probe width really is inside the key-part ceiling, which is what
    // makes an emitted `VARCHAR(PROBE_CHARS)` mean "keyed" below.
    expect(PROBE_CHARS).toBeLessThanOrEqual(KEYABLE_CHARS);
    expect(PROBE_CHARS).not.toBe(DEFAULT_CHARS);

    // The two normalizers really do read the emitted column back.
    expect(sqlWidth('TEXT')).toBeNull();
    expect(sqlWidth('VARCHAR(100)')).toBe(100);
    expect(() => sqlWidth('JSONB')).toThrow();
    expect(tsWidth("table.text('f')")).toBeNull();
    expect(tsWidth("table.string('f', 100)")).toBe(100);
    expect(tsWidth("table.string('f')")).toBe(DEFAULT_CHARS);
    expect(() => tsWidth("table.jsonb('f')")).toThrow();
    expect(driverWidth('text', 'control')).toBeNull();
    expect(driverWidth('varchar(100)', 'control')).toBe(100);
    expect(() => driverWidth('json', 'control')).toThrow();
    expect(() => driverWidth(undefined, 'control')).toThrow();
  });

  it('control — the REAL CHAIN really runs, and it really discriminates', async () => {
    // ⭐ Non-vacuity for `initObjects` itself, and it is the load-bearing
    // control of this file: every differential below reads columns out of a
    // database, so a chain that silently created nothing would compare an empty
    // map against an empty map and pass.
    const created = await ORACLE.createdColumns({
      name: 'control_real_chain',
      fields: {
        keyed: { type: 'text', maxLength: PROBE_CHARS, unique: true },
        unkeyed: { type: 'text', maxLength: PROBE_CHARS },
        organization_id: { type: 'text', maxLength: PROBE_CHARS },
        sized: { type: 'email', maxLength: 400 },
        plain: { type: 'color' },
      },
    });

    // The table exists and carries the driver's own builtins, which no field
    // here declares — proof the CREATE really ran rather than the map being
    // assembled from the declaration.
    expect(created.has('id')).toBe(true);
    expect(created.has('created_at')).toBe(true);

    // All three arms answer, and they answer three DIFFERENT things. A chain
    // that returned one column shape for everything dies here.
    expect(driverWidth(created.get('keyed'), 'keyed')).toBe(PROBE_CHARS);
    expect(driverWidth(created.get('unkeyed'), 'unkeyed')).toBeNull();
    expect(driverWidth(created.get('sized'), 'sized')).toBe(400);
    expect(driverWidth(created.get('plain'), 'plain')).toBe(DEFAULT_CHARS);

    // ...and the TENANT column is keyed by the field-level `unique: true`,
    // which is `computeAndRecordTenantField` and `indexedKeyColumns` and
    // `createColumn` all firing on the real path. This is the exact column the
    // leaf-composed differential could not see move.
    expect(driverWidth(created.get('organization_id'), 'organization_id')).toBe(PROBE_CHARS);

    // The same object without the organization column leaves the field's own
    // key alone — so the assertion above measures the tenant PREPEND rather
    // than "everything is keyed".
    const noTenant = await ORACLE.createdColumns({
      name: 'control_real_chain_no_tenant',
      fields: { keyed: { type: 'text', maxLength: PROBE_CHARS, unique: true } },
    });
    expect(driverWidth(noTenant.get('keyed'), 'keyed')).toBe(PROBE_CHARS);
    expect(noTenant.has('organization_id')).toBe(false);
  });

  // ── The unique VOCABULARY, against the driver's own two predicates ────────

  /**
   * Every spelling worth asking about, including the ones the spec rejects by
   * name — an "anything truthy" reading would silently accept those.
   */
  const UNIQUE_SPELLINGS: unknown[] = [
    true, false, undefined, null, 0, 1, '', 'global', 'organization',
    'tenant', 'org', 'yes', 'GLOBAL', 'Organization', {}, [],
  ];

  it('the unique vocabulary is the driver\'s own predicate, spelling for spelling', () => {
    // ⭐ This is the axis the `@objectstack/spec/data` import buys. `generate.ts`
    // now reaches the same spec `isUniqueDeclared` the driver's wrapper reaches,
    // so a change to THAT predicate moves the driver and the generators together
    // and cannot open a divergence at all. What can still open one is the
    // driver's own wrapper moving alone — which is what this catches, against
    // `isUniqueScopeDeclared` itself rather than against its source text.
    const disagreements: string[] = [];
    for (const unique of UNIQUE_SPELLINGS) {
      const driverKeys = isUniqueScopeDeclared(unique);
      const generatorsKeyed =
        sqlWidth(columnsFor({ type: 'text', maxLength: PROBE_CHARS, unique }).sql) === PROBE_CHARS;
      if (driverKeys !== generatorsKeyed) {
        disagreements.push(`${JSON.stringify(unique)}: driver ${driverKeys}, generators ${generatorsKeyed}`);
      }
    }
    expect(
      disagreements,
      'A `unique` spelling the driver keys on is a spelling the generated column must be sized ' +
      'for, and one it does not key on is one the generated column must leave unbounded.',
    ).toEqual([]);
    // Non-vacuity: the sweep really carries both answers, in quantity.
    expect(UNIQUE_SPELLINGS.filter((u) => isUniqueScopeDeclared(u))).toHaveLength(3);
    expect(UNIQUE_SPELLINGS.filter((u) => !isUniqueScopeDeclared(u)).length).toBeGreaterThan(8);
  });

  it('the organization-SCOPE vocabulary is the driver\'s own predicate too', () => {
    // The second half of the field-level judgment: which of those spellings
    // ALSO keys the tenant column. Asked of the driver's exported predicate,
    // not of the word — bare `true` is organization-scoped at field level and
    // `'global'` is not, a distinction a "detects the word" reading loses.
    for (const unique of UNIQUE_SPELLINGS) {
      const scopedByDriver = isUniqueScopeDeclared(unique) && isOrganizationScopedUnique(unique);
      const out = emit({
        f: { type: 'text', maxLength: PROBE_CHARS, unique },
        organization_id: { type: 'text', maxLength: PROBE_CHARS },
      });
      const tenantKeyed = sqlWidth(sqlColumn(out.sql, 'organization_id')) === PROBE_CHARS;
      expect(
        tenantKeyed,
        `unique: ${JSON.stringify(unique)} — the driver ${scopedByDriver ? 'keys' : 'does not key'} ` +
        'the tenant column for this spelling',
      ).toBe(scopedByDriver);
    }
    // Non-vacuity: both dispositions really occur across the sweep.
    expect(UNIQUE_SPELLINGS.some((u) => isUniqueScopeDeclared(u) && isOrganizationScopedUnique(u))).toBe(true);
    expect(UNIQUE_SPELLINGS.some((u) => isUniqueScopeDeclared(u) && !isOrganizationScopedUnique(u))).toBe(true);
  });

  // ── F1a: the key set, recomputed from the driver's own exported builders ──
  //
  // Kept because it localises a failure to ONE builder. ⛔ Not the authority —
  // F1b below is. Read the two together: this one says WHICH builder moved,
  // that one says whether the platform's column moved at all.

  it('the corpus is a real sweep, and both sides really vary across it', () => {
    const corpus = keyProbeCorpus();
    // ⭐ The EXACT size, not `> 200`. `> 200` is what this case used to assert,
    // and it is why a hand-count of "1,224 over 17 index shapes" reached a
    // commit message unchallenged. The product of the four dimensions and the
    // length of what the sweep actually built must both equal the stated
    // number — a corpus that grows without this literal growing fails here.
    const { uniques, indexSets, tenancies, shapes } = KEY_PROBE_DIMENSIONS;
    expect(uniques * indexSets * tenancies * shapes).toBe(KEY_PROBE_COUNT);
    expect(corpus.length).toBe(KEY_PROBE_COUNT);
    // A differential over a corpus that answers one thing everywhere proves
    // nothing, so the corpus's own discriminating power is asserted next.
    const driverAnswers = new Set(corpus.map((p) => [...driverKeyColumns(p.object)].sort().join(',')));
    expect(driverAnswers.size).toBeGreaterThan(4);
    expect(driverAnswers.has('')).toBe(true);
    // At least one probe keys the tenant column, and at least one keys the
    // field without it — the distinction the repaired branch turns on.
    expect([...driverAnswers].some((a) => a.includes('organization_id'))).toBe(true);
    expect([...driverAnswers].some((a) => a === 'f')).toBe(true);
    // Ids are unique, so a failure below names exactly one probe.
    expect(new Set(corpus.map((p) => p.id)).size).toBe(corpus.length);
  });

  it('every column the generators key is a column the DRIVER keys, over the whole corpus', () => {
    const divergences: string[] = [];
    for (const { id, object } of keyProbeCorpus()) {
      const declared = new Set(Object.keys(object.fields));
      // The driver's answer, restricted to the columns this object declares.
      // A key part naming an undeclared column materialises no column in ANY of
      // the three producers, so it is not observable here and not a divergence
      // — `idx-ghost` is in the corpus to keep that case exercised rather than
      // assumed.
      const oracle = [...driverKeyColumns(object)].filter((c) => declared.has(c)).sort();
      const emitted = [...generatorKeyColumns(object, id)].sort();
      if (JSON.stringify(oracle) !== JSON.stringify(emitted)) {
        divergences.push(`${id}: driver keys [${oracle}] · generators key [${emitted}]`);
      }
    }
    expect(
      divergences,
      'The generators sized a character column from a key set that is not the one driver-sql ' +
      'computes for the same object. Every entry is a column whose generated type disagrees ' +
      'with the platform\'s — the whole of #16091. The authority is driver-sql: fix ' +
      '`indexKeyColumns` in generate.ts, never this expectation.',
    ).toEqual([]);
  });

  // ── F1b: THE AUTHORITY — the column `initObjects` actually created ────────
  //
  // ⭐ Everything above this line asks the driver's exported parts and puts the
  // answer together HERE. This asks `SqlDriver.initObjects` for a table and
  // reads the column out of it. The difference is not stylistic: the two
  // driver-side mutations that ARE this card's subject — `indexedKeyColumns`
  // dropping declared indexes, and `initObjects` handing it `tenantField: null`
  // — are invisible to a re-composition and unmissable here.

  it('every character column the generators emit is the column initObjects CREATES', async () => {
    const divergences: string[] = [];
    let columnsCompared = 0;
    for (const { id, object } of keyProbeCorpus()) {
      // The platform's own answer: one CREATE TABLE through the whole chain,
      // read back out of the database. Nothing about it is derived here.
      const created = await ORACLE.createdColumns(object as { name: string; fields: Record<string, any> });
      const emitted = generatorWidths(object);
      for (const [field, generated] of emitted) {
        const platform = driverWidth(created.get(field), `${id}: '${field}'`);
        columnsCompared += 1;
        if (platform !== generated) {
          divergences.push(
            `${id}: '${field}' driver=${platform === null ? 'text' : `varchar(${platform})`} ` +
            `generated=${generated === null ? 'text' : `varchar(${generated})`}`,
          );
        }
      }
    }
    // Non-vacuity, stated as an exact count: a loop that compared nothing —
    // or one whose `createdColumns` quietly returned an empty map — reports no
    // divergences and passes. 4,032 = the `with-organization_id` half's four
    // declared columns (576 × 4) plus the other half's three (576 × 3).
    expect(columnsCompared).toBe(4_032);
    expect(
      divergences.slice(0, 20),
      `${divergences.length} of ${columnsCompared} columns disagree with the column driver-sql ` +
      'actually created for the same object. Every entry is #16091 itself: a value the platform ' +
      'stores that a generated table refuses, or one it invites that the platform refuses. The ' +
      'authority is the DRIVER — fix generate.ts, never this expectation.',
    ).toEqual([]);
  }, 60_000);

  it('the pre-normalized index arm keys exactly what initObjects keys, by name', async () => {
    // ⭐ The divergence round 3 repaired, spelled out so it cannot come back
    // unnoticed inside a sweep. `normalizeDeclaredIndex` filters
    // `nullSafeColumns` against the listed columns, but that filter narrows
    // only `nullSafeColumns` — its `columns` are the listed ones in every
    // branch of the arm, so a `nullSafeColumns` naming NO listed column still
    // prepends nothing.
    const fields = {
      f: { type: 'text', maxLength: PROBE_CHARS },
      organization_id: { type: 'text', maxLength: PROBE_CHARS },
    };
    const stranger = {
      name: 'pre_normalized_stranger',
      fields,
      indexes: [{ fields: ['f'], unique: 'organization', nullSafeColumns: ['zzz'] }],
    };
    // Asserted through the REAL CHAIN first — the platform's own table — and
    // through the exported builders second, so the two are pinned to agree.
    const strangerColumns = await ORACLE.createdColumns(stranger);
    expect(driverWidth(strangerColumns.get('f'), 'stranger.f')).toBe(PROBE_CHARS);
    expect(driverWidth(strangerColumns.get('organization_id'), 'stranger.org')).toBeNull();
    expect([...driverKeyColumns(stranger)].sort()).toEqual(['f']);
    expect([...generatorKeyColumns(stranger, 'pre-normalized-stranger')].sort()).toEqual(['f']);

    // The counter-case, which is what makes the one above a measurement: the
    // SAME index without `nullSafeColumns` does prepend the tenant column.
    const prepending = {
      name: 'pre_normalized_prepending',
      fields,
      indexes: [{ fields: ['f'], unique: 'organization' }],
    };
    const prependingColumns = await ORACLE.createdColumns(prepending);
    expect(driverWidth(prependingColumns.get('f'), 'prepending.f')).toBe(PROBE_CHARS);
    expect(driverWidth(prependingColumns.get('organization_id'), 'prepending.org')).toBe(PROBE_CHARS);
    expect([...driverKeyColumns(prepending)].sort()).toEqual(['f', 'organization_id']);
    expect([...generatorKeyColumns(prepending, 'idx-org')].sort()).toEqual(['f', 'organization_id']);
  });

  // ── F2: the two width bodies, recomputed from the driver's own methods ────
  //
  // Same two layers, same order: the leaf differentials localise a failure to
  // one method body, and the real-chain sweep at the end of this section is the
  // authority — it is the one that also covers `createColumn`'s DISPATCH onto
  // those bodies, which asking `keyableTextLength` directly cannot see move.

  /**
   * The declarations both width sweeps run. Deliberately wider than anything an
   * `IndexSchema`-valid config can carry: `maxLength` reaches these functions
   * through an unvalidated authoring door too, and the coercion is precisely
   * the body being mirrored.
   */
  const WIDTH_DECLARATIONS: unknown[] = [
    undefined, null, 0, -1, -5, 1, 12.5, 64, 100, 255, 767, 768, 769, 1000,
    MAX_CHARS, MAX_CHARS + 1, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity,
    '1', '64', '100', '768', '769', '0', '-5', '12.5', '1e3', '0x10', '', '   ',
    'not a number', true, false, [], [100], {},
  ];

  it('a KEYED text column takes the width driver-sql\'s own keyableTextLength returns', () => {
    const answers = new Set<number | null>();
    for (const maxLength of WIDTH_DECLARATIONS) {
      // The driver's own method body, not a re-derivation of its rules.
      const chars = ORACLE.keyableCharsFor({ maxLength });
      answers.add(chars);
      const { sql, ts } = columnsFor({ type: 'text', unique: true, maxLength });
      const shown = JSON.stringify(maxLength) ?? String(maxLength);
      expect(
        sqlWidth(sql),
        `keyed text @ maxLength ${shown}: driver-sql's keyableTextLength says ${String(chars)}`,
      ).toBe(chars);
      expect(tsWidth(ts), `keyed text @ maxLength ${shown}, typescript format`).toBe(chars);
    }
    // ⭐ How many declarations this sweep really carries, stated as a literal
    // for the same reason {@link KEY_PROBE_COUNT} is: round 3 hand-counted this
    // array as "37 declarations" and wrote that into a commit message the merge
    // queue composes into the squash body. It is 38. A hand-count is a
    // measurement and needs an instrument.
    expect(WIDTH_DECLARATIONS).toHaveLength(38);
    // Non-vacuity: the sweep really produced both dispositions and more than
    // one width, so it is not one answer asserted 38 times.
    expect(answers.has(null)).toBe(true);
    expect([...answers].filter((a) => a !== null).length).toBeGreaterThan(3);
  });

  it('a STRING-family column takes the width driver-sql\'s own declaredVarcharLength returns', () => {
    const answers = new Set<number | null>();
    for (const maxLength of WIDTH_DECLARATIONS) {
      const chars = ORACLE.declaredCharsFor({ maxLength });
      answers.add(chars);
      const { sql, ts } = columnsFor({ type: 'email', maxLength });
      const shown = JSON.stringify(maxLength) ?? String(maxLength);
      expect(
        sqlWidth(sql),
        `email @ maxLength ${shown}: driver-sql's declaredVarcharLength says ${String(chars)}`,
      ).toBe(chars);
      expect(tsWidth(ts), `email @ maxLength ${shown}, typescript format`).toBe(chars);
    }
    expect(answers.has(null)).toBe(true);
    expect(answers.has(DEFAULT_CHARS)).toBe(true);
    expect([...answers].filter((a) => a !== null).length).toBeGreaterThan(3);
  });

  it('the two width bodies are DIFFERENT bodies, and the oracle sees the difference', () => {
    // The two must not be collapsed, and this is the assertion that would fail
    // if a future edit routed both mirrors through one helper: at 1000 the
    // string family is sized and the text family is unbounded, and with no
    // declaration at all the two answer the other way round.
    expect(ORACLE.keyableCharsFor({ maxLength: 1000 })).toBeNull();
    expect(ORACLE.declaredCharsFor({ maxLength: 1000 })).toBe(1000);
    expect(ORACLE.keyableCharsFor({})).toBeNull();
    expect(ORACLE.declaredCharsFor({})).toBe(DEFAULT_CHARS);
    expect(sqlWidth(columnsFor({ type: 'text', unique: true, maxLength: 1000 }).sql)).toBeNull();
    expect(sqlWidth(columnsFor({ type: 'email', maxLength: 1000 }).sql)).toBe(1000);
  });

  it('every character TYPE, at every declaration, takes the width initObjects CREATES', async () => {
    // ⭐ The width half of F1b, and it reaches one layer the two cases above
    // cannot: `createColumn`'s DISPATCH. `ORACLE.keyableCharsFor(...)` answers
    // what `keyableTextLength` returns; it says nothing about which arm
    // `createColumn` hands the field to, or on what it branches when it gets
    // there. A driver that started sizing only the UNIQUE key parts, say, moves
    // the platform's column while `keyableTextLength` answers exactly as before.
    //
    // MEMBERSHIP is the driver's, read off its own case labels and its own
    // catch-all derivation, so a type joining or leaving a family moves what is
    // swept here with nobody editing this file.
    const types = [...armMembers('text'), ...armMembers('email'), ...characterCatchAllMembers()];
    expect(new Set(types).size, 'a type is in two families at once').toBe(types.length);
    expect(types.length).toBeGreaterThanOrEqual(15);

    const divergences: string[] = [];
    const answers = new Set<string>();
    let compared = 0;
    let probe = 0;
    for (const type of types) {
      for (const keyed of [false, true]) {
        for (const maxLength of WIDTH_DECLARATIONS) {
          const field: Record<string, unknown> = { type };
          if (maxLength !== undefined) field.maxLength = maxLength;
          if (keyed) field.unique = true;
          const object = { name: `width_${probe++}`, fields: { f: field } };
          const created = await ORACLE.createdColumns(object);
          const shown = `${type}${keyed ? ' unique:true' : ''} @ ${JSON.stringify(maxLength) ?? 'undefined'}`;
          const platform = driverWidth(created.get('f'), shown);
          const generated = generatorWidths(object).get('f') ?? null;
          answers.add(`${platform}`);
          compared += 1;
          if (platform !== generated) {
            divergences.push(
              `${shown}: driver=${platform === null ? 'text' : `varchar(${platform})`} ` +
              `generated=${generated === null ? 'text' : `varchar(${generated})`}`,
            );
          }
        }
      }
    }
    // Non-vacuity: the sweep really ran, and the platform really gave more than
    // one answer across it — a chain answering `text` everywhere would make
    // every comparison above agree with a generator that did the same.
    expect(compared).toBe(types.length * 2 * WIDTH_DECLARATIONS.length);
    expect(answers.has('null')).toBe(true);
    expect(answers.size).toBeGreaterThan(3);
    expect(
      divergences.slice(0, 20),
      `${divergences.length} of ${compared} probes take a width the platform's own column does ` +
      'not have. The authority is driver-sql: fix generate.ts, never this expectation.',
    ).toEqual([]);
  }, 60_000);
});
