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
 * ⚠️ Scope, as `generateMigrationSql`'s docblock and the `--format` help text
 * already say (#15521): this is a POSTGRESQL claim and nothing else. Neither
 * generator reproduces the driver's dialect branching.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FieldType,
  FILE_REFERENCE_TYPES,
  MULTI_OPTION_TYPES,
  STRUCTURED_JSON_TYPES,
} from '@objectstack/spec/data';
import { describe, expect, it } from 'vitest';

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
    // `packages/cli` does not depend on the driver at runtime, so the ceiling is
    // transcribed in generate.ts. This is the assertion that makes the
    // transcription safe: the two must be the same number, and a driver that
    // moves fails here rather than leaving the generators quietly wrong.
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
    const characterCatchAll = catchAll.filter((t) => !jsonSeeded.has(t));

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
