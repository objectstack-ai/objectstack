// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20336] Pins for the number-comparand declared-type door's CONTRACT — the
 * grammar, the verdict, the refusal words, the fixture and the derived case
 * table. The door itself (the engine seam) is the engine lane's; this file
 * keeps honest that the data the door and the write side consume says what the
 * module header argues, in both directions.
 */

import { describe, it, expect } from 'vitest';
import {
  BOOLEAN_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  CLOCK_TIME_TYPES,
  COMPUTED_VALUE_TYPES,
  FILE_REFERENCE_TYPES,
  INSTANT_TYPES,
  MULTI_OPTION_TYPES,
  NUMERIC_VALUE_TYPES,
  REFERENCE_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  STRING_VALUE_TYPES,
  STRUCTURED_JSON_TYPES,
} from './field-value.zod';
import { FieldSchema, FieldType } from './field.zod';
import { ObjectSchema } from './object.zod';
import { FieldOperatorsSchema, parseFilterAST } from './filter.zod';
import { normalizeFilterComparandTypes } from './filter-comparand-type';
import { TEXT_FILTER_OPERATORS } from './filter-text-operator-declared-type';
import { numericColumnFor } from './numeric-column-representation';
import {
  NON_NUMERIC_STRING_FORMS,
  NON_NUMERIC_VALUE_FORMS,
  NUMBER_COMPARAND_DOOR_CASES,
  NUMBER_COMPARAND_DOOR_FIXTURE,
  NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS,
  NUMBER_COMPARAND_DOOR_FIXTURE_OBJECT,
  NUMBER_COMPARAND_DOOR_JUDGED_TYPES,
  NUMBER_COMPARAND_DOOR_LIST_OPERATORS,
  NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS,
  NUMERIC_STRING_GRAMMAR_CASES,
  NUMERIC_STRING_PATTERN,
  numberComparandDoorVerdict,
  numberComparandFieldVerdict,
  numberComparandRefusalMessage,
  parseNumericString,
  readNumericString,
  type NumberComparandDoorCase,
  type NumberComparandDoorNarrowsCase,
  type NumberComparandDoorRefusalCase,
} from './filter-number-comparand-declared-type';
import { StandardErrorCode } from '../api/errors.zod';

const sorted = (s: Iterable<string>) => [...s].sort();

// ── The grammar ──────────────────────────────────────────────────────────────

describe('[#20336] the numeric grammar', () => {
  it('admits exactly the case table\'s admitted rows, each at its value, and refuses the rest with their form', () => {
    for (const row of NUMERIC_STRING_GRAMMAR_CASES) {
      const reading = readNumericString(row.input);
      if (row.numeric) {
        expect(reading, JSON.stringify(row.input)).toEqual({ numeric: true, value: row.value });
        expect(Object.is(parseNumericString(row.input), row.value), JSON.stringify(row.input)).toBe(true);
      } else {
        expect(reading, JSON.stringify(row.input)).toEqual({ numeric: false, form: row.form });
        expect(parseNumericString(row.input), JSON.stringify(row.input)).toBeUndefined();
      }
    }
  });

  it('an admitted string means what the same characters mean as a JSON number', () => {
    for (const row of NUMERIC_STRING_GRAMMAR_CASES.filter((r) => r.numeric)) {
      expect(Object.is(JSON.parse(row.input), parseNumericString(row.input)), row.input).toBe(true);
    }
  });

  it('round-trips String(n) for every finite number it is shown — a stringified number is never refused', () => {
    const samples = [
      0, -0, 1, -1, 12, 12.5, 0.1, 0.30000000000000004, 1 / 3, -2.5e-7, 1e-7, 1e21, 1.5e300,
      Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, Number.EPSILON,
    ];
    // A deterministic spread across magnitudes and signs, no Math.random.
    let x = 0.123456789;
    for (let i = 0; i < 400; i += 1) {
      x = (x * 9301 + 49297) % 233280;
      samples.push((i % 2 ? -1 : 1) * (x / 233280) * 10 ** ((i % 61) - 30));
    }
    for (const n of samples) {
      const s = String(n);
      expect(NUMERIC_STRING_PATTERN.test(s), s).toBe(true);
      expect(Object.is(parseNumericString(s), Object.is(n, -0) ? 0 : n), s).toBe(true);
    }
  });

  it('every form has at least one row, and no row names a form outside the vocabulary', () => {
    const forms = new Set(NUMERIC_STRING_GRAMMAR_CASES.flatMap((r) => (r.numeric ? [] : [r.form])));
    expect(sorted(forms)).toEqual(sorted(NON_NUMERIC_STRING_FORMS));
  });

  it('answers each form the card asked about — whitespace, empty, hex, exponent, Infinity, NaN, locale separators', () => {
    const verdictOf = (input: string) => NUMERIC_STRING_GRAMMAR_CASES.find((r) => r.input === input);
    for (const input of [' 12 ', '12\n', '', '   ', '0x10', '1e3', 'Infinity', 'NaN', '1,000', '1.000,5']) {
      expect(verdictOf(input), `the table has a row for ${JSON.stringify(input)}`).toBeDefined();
    }
    expect(verdictOf('1e3')?.numeric).toBe(true);
    for (const input of [' 12 ', '', '0x10', 'Infinity', 'NaN', '1,000']) expect(verdictOf(input)?.numeric, input).toBe(false);
  });

  it('is STRICTER than Number() — the rows Number() reads as finite are refused on purpose, each with a named form', () => {
    // These are the strings the write door accepted before this grammar (it
    // judged `Number(value)`); each must be a deliberate refusal, not an accident.
    const numberReads = NUMERIC_STRING_GRAMMAR_CASES
      .filter((r) => !r.numeric && Number.isFinite(Number(r.input)))
      .map((r) => r.input);
    expect(sorted(numberReads)).toEqual(sorted([
      '', '   ', ' 12 ', '12\n', '\t-3', '0x10', '0X1A', '0o17', '0b101', '+5', '.5', '5.', '007',
    ]));
  });

  it('never admits a placeholder — every filter-token kind is refused as one', () => {
    for (const token of ['{current_user_id}', '{current_org_id}', '{record_id}', '{today}', '{30_days_ago}', '{wat}', '${today}']) {
      expect(readNumericString(token), token).toEqual({ numeric: false, form: 'placeholder' });
    }
  });
});

// ── Which fields ─────────────────────────────────────────────────────────────

describe('[#20336] the judged fields', () => {
  it('are NUMERIC_VALUE_TYPES itself, by identity — nothing re-listed', () => {
    expect(NUMBER_COMPARAND_DOOR_JUDGED_TYPES).toBe(NUMERIC_VALUE_TYPES);
  });

  it('judges every FieldType member exactly by membership, and formula by its returnType', () => {
    for (const t of FieldType.options) {
      if (t === 'formula') continue;
      expect(numberComparandFieldVerdict({ type: t }), t).toBe(NUMERIC_VALUE_TYPES.has(t) ? 'judged' : 'not-judged');
    }
    expect(numberComparandFieldVerdict({ type: 'formula', returnType: 'number' })).toBe('judged');
    for (const rt of ['text', 'boolean', 'date']) {
      expect(numberComparandFieldVerdict({ type: 'formula', returnType: rt }), rt).toBe('not-judged');
    }
    expect(numberComparandFieldVerdict({ type: 'formula' })).toBe('deferred');
    expect(numberComparandFieldVerdict({ type: 'formula', returnType: 'dyn' })).toBe('deferred');
  });

  it('every judged type has a NUMERIC column on the SQL dialects — the column, not the writer, is the axis', () => {
    for (const t of NUMBER_COMPARAND_DOOR_JUDGED_TYPES) expect(numericColumnFor(t), t).toBeDefined();
  });

  it('judges `summary` though the write door exempts it — COMPUTED_VALUE_TYPES is who writes, not what compares', () => {
    expect(COMPUTED_VALUE_TYPES.has('summary')).toBe(true);
    expect(numberComparandFieldVerdict({ type: 'summary' })).toBe('judged');
    expect(numberComparandDoorVerdict({ type: 'summary' }, 'abc')).toMatchObject({ verdict: 'door-refusal' });
  });
});

// ── Which positions ──────────────────────────────────────────────────────────

describe('[#20336] the judged positions', () => {
  it('partition FieldOperatorsSchema\'s keys with the text operators and the three flag operators', () => {
    const judged = [...NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS, ...NUMBER_COMPARAND_DOOR_LIST_OPERATORS];
    // [#20311] `$empty` is a boolean flag like `$null` / `$exists`, not a value of the field.
    const partition = [...judged, ...TEXT_FILTER_OPERATORS, '$null', '$exists', '$empty'];
    expect(new Set(partition).size, 'the four parts overlap').toBe(partition.length);
    expect(sorted(partition)).toEqual(sorted(Object.keys(FieldOperatorsSchema.shape)));
  });
});

// ── The verdict ──────────────────────────────────────────────────────────────

describe('[#20336] numberComparandDoorVerdict', () => {
  it('refuses a non-numeric string on a number field with the INVALID_FILTER / 400 envelope and its form', () => {
    expect(numberComparandDoorVerdict({ type: 'number' }, 'abc')).toEqual({
      verdict: 'door-refusal', form: 'not-a-number', code: 'INVALID_FILTER', status: 400,
    });
    expect(StandardErrorCode.enum.INVALID_FILTER).toBe('INVALID_FILTER');
  });

  it('narrows a numeric string to its number', () => {
    expect(numberComparandDoorVerdict({ type: 'currency' }, '12.5')).toEqual({ verdict: 'narrows', value: 12.5 });
    expect(numberComparandDoorVerdict({ type: 'formula', returnType: 'number' }, '1e3')).toEqual({ verdict: 'narrows', value: 1000 });
  });

  it('[#20502] refuses a boolean, a Date and an array on a number field with the INVALID_FILTER / 400 envelope and its form', () => {
    const refused: ReadonlyArray<readonly [unknown, string]> = [
      [true, 'boolean'], [false, 'boolean'],
      [new Date(0), 'date'], [new Date(Number.NaN), 'date'],
      [[1, 2], 'array'], [[], 'array'], [['12'], 'array'],
    ];
    for (const [v, form] of refused) {
      for (const type of NUMBER_COMPARAND_DOOR_JUDGED_TYPES) {
        expect(numberComparandDoorVerdict({ type }, v), `${type} · ${String(v)}`).toEqual({
          verdict: 'door-refusal', form, code: 'INVALID_FILTER', status: 400,
        });
      }
      expect(numberComparandDoorVerdict({ type: 'formula', returnType: 'number' }, v), String(v))
        .toMatchObject({ verdict: 'door-refusal', form });
    }
    expect(sorted(new Set(refused.map(([, form]) => form)))).toEqual(sorted(NON_NUMERIC_VALUE_FORMS));
  });

  it('[#20502] passes a number, a bigint and null, and leaves every value outside the accepted comparand types to the comparand-type door', () => {
    const passes: readonly unknown[] = [
      12, 0, -1.5, 1e21, 10n, null,
      // Outside the comparand-type door's accepted set — refused THERE, on every field.
      undefined, { a: 1 }, { $field: 'x' }, new Map(), Symbol('s'), () => 1,
    ];
    for (const v of passes) {
      expect(numberComparandDoorVerdict({ type: 'number' }, v), String(typeof v)).toEqual({ verdict: 'passes' });
    }
    // The ones the comparand-type door refuses are really refused there, by that door, on a number field too.
    for (const v of [undefined, { a: 1 }, new Map()]) {
      let thrown: (Error & { code?: string; status?: number }) | undefined;
      try { normalizeFilterComparandTypes({ amount: { $gt: v } }); } catch (e) { thrown = e as typeof thrown; }
      expect({ code: thrown?.code, status: thrown?.status }, String(typeof v)).toEqual({ code: 'INVALID_FILTER', status: 400 });
    }
  });

  it('[#20502] a boolean or a Date on a field that is NOT numeric is not this door\'s subject', () => {
    for (const t of [...BOOLEAN_VALUE_TYPES, ...CALENDAR_DATE_TYPES, ...INSTANT_TYPES, ...STRING_VALUE_TYPES]) {
      for (const v of [true, new Date(0), [1]]) {
        expect(numberComparandDoorVerdict({ type: t }, v), `${t} · ${String(v)}`).toEqual({ verdict: 'passes' });
      }
    }
    expect(numberComparandDoorVerdict({ type: 'formula', returnType: 'boolean' }, true)).toEqual({ verdict: 'passes' });
    expect(numberComparandDoorVerdict({ type: 'formula' }, true)).toEqual({ verdict: 'deferred' });
  });

  it('passes any string on a field that is not numeric, and defers on an unreadable formula', () => {
    for (const t of [...STRING_VALUE_TYPES, ...BOOLEAN_VALUE_TYPES, ...CALENDAR_DATE_TYPES, ...STRUCTURED_JSON_TYPES]) {
      expect(numberComparandDoorVerdict({ type: t }, 'abc'), t).toEqual({ verdict: 'passes' });
    }
    expect(numberComparandDoorVerdict({ type: 'formula', returnType: 'text' }, 'abc')).toEqual({ verdict: 'passes' });
    expect(numberComparandDoorVerdict({ type: 'formula' }, 'abc')).toEqual({ verdict: 'deferred' });
  });
});

// ── The words ────────────────────────────────────────────────────────────────

describe('[#20336] numberComparandRefusalMessage', () => {
  const site = {
    field: 'amount', declaredType: 'number', path: 'where.amount.$gt', value: 'abc', form: 'not-a-number' as const,
  };

  it('names the field, its declared type, the comparand, its position and the remedy — behind the caller prefix', () => {
    const message = numberComparandRefusalMessage(site, "find('deal')");
    expect(message.startsWith("find('deal'): filter on 'amount' compares a declared number field against \"abc\" at where.amount.$gt"))
      .toBe(true);
    expect(message).toContain('not a number');
    expect(message).toContain('NOT applied');
    expect(numberComparandRefusalMessage(site).startsWith("filter on 'amount'")).toBe(true);
  });

  it('names a formula\'s return type', () => {
    expect(numberComparandRefusalMessage({ ...site, declaredType: 'formula', returnType: 'number' }))
      .toContain('formula field returning number');
  });

  const ALL_FORMS = [...NON_NUMERIC_STRING_FORMS, ...NON_NUMERIC_VALUE_FORMS];

  it('says something different for every form, and carries no tracker number', () => {
    const messages = ALL_FORMS.map((form) => numberComparandRefusalMessage({ ...site, form }));
    expect(new Set(messages).size).toBe(ALL_FORMS.length);
    for (const m of messages) expect(m).not.toMatch(/#\d/);
  });

  it('[#20502] names a Date AS a Date — its JSON form is a quoted string, which would read as the string the grammar refuses', () => {
    const at = new Date(Date.UTC(2026, 0, 1));
    const message = numberComparandRefusalMessage({ ...site, value: at, form: 'date' }, "find('deal')");
    expect(message.startsWith(
      "find('deal'): filter on 'amount' compares a declared number field against Date(2026-01-01T00:00:00.000Z) at where.amount.$gt",
    )).toBe(true);
    expect(numberComparandRefusalMessage({ ...site, value: new Date(Number.NaN), form: 'date' })).toContain('Date(Invalid Date)');
    expect(numberComparandRefusalMessage({ ...site, value: true, form: 'boolean' })).toContain('against true at where.amount.$gt');
    expect(numberComparandRefusalMessage({ ...site, value: [1, 2], form: 'array' })).toContain('against [1,2] at where.amount.$gt');
    // A string renders exactly as before this change.
    expect(numberComparandRefusalMessage(site)).toContain('against "abc" at where.amount.$gt');
  });

  it('stays inside the 500-character client bound for every refusal in the case table, at the longest position', () => {
    for (const c of NUMBER_COMPARAND_DOOR_CASES.filter(isRefusal)) {
      const message = numberComparandRefusalMessage({
        field: c.key, declaredType: c.declaredType, returnType: c.returnType,
        path: `aggregations[0].filter.${c.position}`, value: c.comparand, form: c.form,
      }, `aggregate('${NUMBER_COMPARAND_DOOR_FIXTURE_OBJECT}')`);
      expect(message.length, c.name).toBeLessThanOrEqual(500);
    }
  });

  it('front-loads what a caller acts on: with 40-character names the head still ends inside the first 500 characters', () => {
    const name = 'f'.repeat(40);
    const longest: Record<string, unknown> = { boolean: false, date: new Date(8.64e15), array: Array.from({ length: 200 }, () => 1) };
    for (const form of ALL_FORMS) {
      const message = numberComparandRefusalMessage({
        field: name, declaredType: 'formula', returnType: 'number',
        path: `aggregations[12].filter.${name}.$between[1]`, value: form in longest ? longest[form] : 'x'.repeat(200), form,
      }, `aggregate('${'o'.repeat(40)}')`);
      const head = message.slice(0, message.indexOf(' The filter was NOT applied'));
      expect(head.length, form).toBeLessThanOrEqual(500);
      expect(message.slice(0, 500), form).toContain(head);
    }
  });
});

// ── The fixture ──────────────────────────────────────────────────────────────

describe('[#20336] the fixture', () => {
  it('carries one field per FieldType member (f_<type>), four typed formulas and one untyped', () => {
    const names = NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    const plain = NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS.filter((f) => f.type !== 'formula').map((f) => f.type);
    expect(sorted(plain)).toEqual(sorted(FieldType.options.filter((t) => t !== 'formula')));
    const formulas = NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS.filter((f) => f.type === 'formula');
    expect(sorted(formulas.map((f) => f.returnType ?? '(none)'))).toEqual(['(none)', 'boolean', 'date', 'number', 'text']);
  });

  it('every field is a legal FieldSchema input, and the object a legal ObjectSchema input', () => {
    for (const f of NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS) {
      const r = FieldSchema.safeParse(f);
      expect(r.success, `${f.name}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
    const obj = ObjectSchema.safeParse(NUMBER_COMPARAND_DOOR_FIXTURE);
    expect(obj.success, obj.success ? '' : JSON.stringify(obj.error.issues)).toBe(true);
    expect(NUMBER_COMPARAND_DOOR_FIXTURE.name).toBe(NUMBER_COMPARAND_DOOR_FIXTURE_OBJECT);
    expect(Object.keys(NUMBER_COMPARAND_DOOR_FIXTURE.fields)).toHaveLength(NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS.length + 1);
  });

  it('the classes the fixture is built from are the census the text door pins — none missing, none twice', () => {
    const classes = [
      NUMERIC_VALUE_TYPES, STRING_VALUE_TYPES, new Set(['autonumber']), SINGLE_OPTION_TYPES, MULTI_OPTION_TYPES,
      REFERENCE_VALUE_TYPES, FILE_REFERENCE_TYPES, BOOLEAN_VALUE_TYPES, CALENDAR_DATE_TYPES, INSTANT_TYPES,
      CLOCK_TIME_TYPES, STRUCTURED_JSON_TYPES,
    ];
    const members = classes.flatMap((c) => [...c]);
    expect(new Set(members).size, 'a type sits in two classes').toBe(members.length);
    expect(sorted(members)).toEqual(sorted(FieldType.options.filter((t) => t !== 'formula')));
  });
});

// ── The derived case table ───────────────────────────────────────────────────

const isRefusal = (c: NumberComparandDoorCase): c is NumberComparandDoorRefusalCase => c.verdict === 'door-refusal';
const isNarrows = (c: NumberComparandDoorCase): c is NumberComparandDoorNarrowsCase => c.verdict === 'narrows';
const fieldOf = (c: NumberComparandDoorCase) => NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS.find((f) => f.name === c.key)!;

/** The comparand the case's filter holds at its position, read back off the filter. */
function comparandAt(c: NumberComparandDoorCase, filter: Record<string, unknown>): unknown {
  const m = /^[^.]+(?:\.(\$\w+)(?:\[(\d)\])?)?$/.exec(c.position);
  const spec = filter[c.key];
  if (!m?.[1]) return spec;
  const at = (spec as Record<string, unknown>)[m[1]];
  return m[2] === undefined ? at : (at as unknown[])[Number(m[2])];
}

describe('[#20336] NUMBER_COMPARAND_DOOR_CASES', () => {
  it('has unique case names — they are used as test names', () => {
    const names = NUMBER_COMPARAND_DOOR_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every verdict agrees with numberComparandDoorVerdict over the field and the comparand at its position', () => {
    for (const c of NUMBER_COMPARAND_DOOR_CASES) {
      const f = fieldOf(c);
      expect(f, c.name).toBeDefined();
      expect(c.declaredType, c.name).toBe(f.type);
      expect(c.returnType, c.name).toBe(f.returnType);
      expect(comparandAt(c, c.filter() as Record<string, unknown>), c.name).toEqual(c.comparand);
      // The verdict is defined at a JUDGED position; a flag operator's comparand is never handed to it.
      const op = /\.(\$\w+)/.exec(c.position)?.[1];
      const judgedPosition = op === undefined
        || [...NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS, ...NUMBER_COMPARAND_DOOR_LIST_OPERATORS].includes(op as never);
      expect(c.verdict, c.name).toBe(judgedPosition ? numberComparandDoorVerdict(f, c.comparand).verdict : 'passes');
    }
  });

  it('[#20502] the flag operators pass their boolean — the door never judges $null / $exists / $empty, whatever the verdict says of a boolean', () => {
    const flags = NUMBER_COMPARAND_DOOR_CASES.filter((c) => /\.\$(?:null|exists|empty)$/.test(c.position));
    expect(sorted(flags.map((c) => c.position))).toEqual(['f_number.$empty', 'f_number.$exists', 'f_number.$null']);
    for (const c of flags) {
      expect(typeof c.comparand, c.name).toBe('boolean');
      expect(c.verdict, c.name).toBe('passes');
      // …while the same boolean at a judged position is refused: the position, not the value, decides.
      expect(numberComparandDoorVerdict({ type: 'number' }, c.comparand), c.name).toMatchObject({ verdict: 'door-refusal', form: 'boolean' });
    }
  });

  it('the census covers every fixture field, refusing exactly the numeric class and formula returning number', () => {
    const census = NUMBER_COMPARAND_DOOR_CASES.filter((c) => c.name.startsWith('[census]'));
    expect(sorted(census.map((c) => c.key))).toEqual(sorted(NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS.map((f) => f.name)));
    expect(sorted(census.filter(isRefusal).map((c) => c.key)))
      .toEqual(sorted([...[...NUMERIC_VALUE_TYPES].map((t) => `f_${t}`), 'f_formula_number']));
    expect(census.filter((c) => c.verdict === 'deferred').map((c) => c.key)).toEqual(['f_formula_untyped']);
    expect(census.filter(isNarrows)).toEqual([]);
  });

  it('every judged position is exercised three ways on f_number: refused, narrowed, and a number that passes', () => {
    const positions = NUMBER_COMPARAND_DOOR_CASES.filter((c) => c.name.startsWith('[position]'));
    const judged = new Set(positions.map((c) => c.position));
    // implicit + 6 scalar + 3 list operators × 2 members
    expect(judged.size).toBe(1 + NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS.length + NUMBER_COMPARAND_DOOR_LIST_OPERATORS.length * 2);
    for (const p of judged) {
      const at = positions.filter((c) => c.position === p).map((c) => c.verdict);
      expect(sorted(at), p).toEqual(['door-refusal', 'narrows', 'passes']);
    }
  });

  it('every grammar row appears once at $eq on f_number, with the grammar\'s answer', () => {
    const grammar = NUMBER_COMPARAND_DOOR_CASES.filter((c) => c.name.startsWith('[grammar]'));
    expect(grammar).toHaveLength(NUMERIC_STRING_GRAMMAR_CASES.length);
    for (const [i, row] of NUMERIC_STRING_GRAMMAR_CASES.entries()) {
      const c = grammar[i];
      expect(c.position).toBe('f_number.$eq');
      expect(c.comparand).toBe(row.input);
      if (row.numeric) expect(isNarrows(c) && Object.is(c.value, row.value), c.name).toBe(true);
      else expect(isRefusal(c) && c.form === row.form, c.name).toBe(true);
    }
  });

  it('[#20502] refuses false at $gt on every judged field, and true and a Date at every judged position on f_number', () => {
    const value = NUMBER_COMPARAND_DOOR_CASES.filter((c) => c.name.startsWith('[value]'));
    const judgedFields = NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS.filter((f) => numberComparandFieldVerdict(f) === 'judged');
    const falseAtGt = value.filter((c) => c.comparand === false);
    expect(sorted(falseAtGt.map((c) => c.key))).toEqual(sorted(judgedFields.map((f) => f.name)));
    for (const c of falseAtGt) expect(isRefusal(c) && c.form === 'boolean', c.name).toBe(true);

    const onNumber = value.filter((c) => c.key === 'f_number' && c.comparand !== false);
    const judged = new Set(NUMBER_COMPARAND_DOOR_CASES.filter((c) => c.name.startsWith('[position]')).map((c) => c.position));
    for (const p of judged) {
      const forms = onNumber.filter((c) => c.position === p && isRefusal(c)).map((c) => (c as NumberComparandDoorRefusalCase).form);
      const equality = /^f_number(?:\.\$(?:eq|ne))?$/.test(p);
      expect(sorted(forms), p).toEqual(sorted(equality ? ['boolean', 'date'] : ['array', 'boolean', 'date']));
    }
  });

  it('[#20502] the non-string rows that PASS: the null test, and a boolean or a Date on a field class that holds one', () => {
    const passing = NUMBER_COMPARAND_DOOR_CASES.filter((c) => c.name.startsWith('[value]') && c.verdict === 'passes');
    expect(passing.map((c) => [c.position, c.comparand instanceof Date ? 'Date' : c.comparand])).toEqual([
      ['f_number', null], ['f_number.$ne', null], ['f_boolean.$eq', true], ['f_datetime.$gt', 'Date'],
    ]);
  });

  it('[#20502] the refused forms: every string form and every value form is in the table', () => {
    const forms = new Set(NUMBER_COMPARAND_DOOR_CASES.filter(isRefusal).map((c) => c.form));
    expect(sorted(forms)).toEqual(sorted([...NON_NUMERIC_STRING_FORMS, ...NON_NUMERIC_VALUE_FORMS]));
  });

  it('covers all four verdicts — a table with one answer would not need the discriminant', () => {
    const verdicts = new Set(NUMBER_COMPARAND_DOOR_CASES.map((c) => c.verdict));
    expect(sorted(verdicts)).toEqual(['deferred', 'door-refusal', 'narrows', 'passes']);
  });

  it('every refusal carries the ADR-0112 envelope and names the key, the declared type, the comparand and its position', () => {
    for (const c of NUMBER_COMPARAND_DOOR_CASES.filter(isRefusal)) {
      expect(c.code, c.name).toBe(StandardErrorCode.enum.INVALID_FILTER);
      expect(c.status, c.name).toBe(400);
      const rendered = c.comparand instanceof Date ? `Date(${c.comparand.toISOString()})` : JSON.stringify(c.comparand);
      expect(c.mustMention, c.name).toEqual(expect.arrayContaining([c.key, c.declaredType, rendered, c.position]));
      // …and the words the module hands the door do contain each of them.
      const message = numberComparandRefusalMessage({
        field: c.key, declaredType: c.declaredType, returnType: c.returnType,
        path: `where.${c.position}`, value: c.comparand, form: c.form,
      }, `find('${NUMBER_COMPARAND_DOOR_FIXTURE_OBJECT}')`);
      for (const s of c.mustMention) expect(message, c.name).toContain(s);
    }
  });

  it('a narrowed case\'s expected filter is its filter with the one comparand replaced by its number', () => {
    for (const c of NUMBER_COMPARAND_DOOR_CASES.filter(isNarrows)) {
      const expected = c.expectedFilter() as Record<string, unknown>;
      expect(Object.is(comparandAt(c, expected), c.value), c.name).toBe(true);
      expect(typeof comparandAt(c, expected), c.name).toBe('number');
      expect(JSON.stringify(expected).replace(String(c.value), '#'), c.name)
        .toBe(JSON.stringify(c.filter()).replace(JSON.stringify(c.comparand), '#'));
    }
  });

  it('every filter passes the SYNTAX door — a refusal can only be a field-aware door\'s', () => {
    for (const c of NUMBER_COMPARAND_DOOR_CASES) {
      expect(() => parseFilterAST(c.filter()), c.name).not.toThrow();
      if (isNarrows(c)) expect(() => parseFilterAST(c.expectedFilter()), c.name).not.toThrow();
    }
  });

  it('the factories return a fresh object per call — no suite can edit what another judges', () => {
    const c = NUMBER_COMPARAND_DOOR_CASES.find(isNarrows)!;
    expect(c.filter()).not.toBe(c.filter());
    expect(c.filter()).toEqual(c.filter());
    expect(c.expectedFilter()).not.toBe(c.expectedFilter());
    // [#20502] A Date or an array comparand is mutable: each filter holds its own copy.
    for (const mutable of [
      NUMBER_COMPARAND_DOOR_CASES.find((x) => x.comparand instanceof Date)!,
      NUMBER_COMPARAND_DOOR_CASES.find((x) => Array.isArray(x.comparand))!,
    ]) {
      const first = comparandAt(mutable, mutable.filter() as Record<string, unknown>);
      const second = comparandAt(mutable, mutable.filter() as Record<string, unknown>);
      expect(first, mutable.name).not.toBe(second);
      expect(first, mutable.name).not.toBe(mutable.comparand);
      expect(first, mutable.name).toEqual(mutable.comparand);
    }
  });
});
