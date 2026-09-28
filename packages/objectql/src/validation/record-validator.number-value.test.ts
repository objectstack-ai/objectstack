// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20309 — the number arm refuses a value that is neither a number nor a
 * string: an array, a boolean, an object.
 *
 * ## The defect
 *
 * The arm judged `Number(value)` and the write carried `value`. So every value
 * JS coerces to a finite number passed the check and reached the driver as it
 * was sent. Measured on `origin/main` c74de10a94 through the real engine and
 * REST doors:
 *
 * - `[500]`: SQLite stored the TEXT `'[500]'` and memory stored the array;
 * - `[]`: SQLite stored `'[]'` and memory stored the array;
 * - `true` / `false`: SQLite stored `1` / `0` and memory stored the boolean.
 *
 * `[5, 7]` and `{}` were already refused, because `Number()` of each is `NaN`.
 *
 * ## What this file pins
 *
 * - The refusal set on every judged type, on insert and update, as the
 *   `VALIDATION_FAILED` envelope with `invalid_number`.
 * - Parity with the spec over every non-string input: the arm refuses exactly
 *   what the spec's stored value schema for the type (`valueSchemaFor`,
 *   `z.number().finite()`) refuses.
 * - The controls: a finite number passes, including `0` and a negative; a
 *   blank is still `null` before the arm (#20308); `summary` is still not
 *   judged (the seat ruling on #20308).
 * - The STRING half (the second part of #20309): a string is judged by the
 *   spec's one numeric grammar, `parseNumericString`, driven here through its
 *   own case table `NUMERIC_STRING_GRAMMAR_CASES` — never a list of this
 *   file's. Before it, the arm read a string by `Number()` and the write
 *   carried the string: memory stored `'12'` as the string `'12'`, SQLite
 *   stored `'0x10'` as TEXT. An admitted string is now judged as its number
 *   and `normalizeNumericStringValues` writes that number into the payload; a
 *   string the grammar does not read is `invalid_number`. The strings
 *   `Number()` read as finite and the grammar refuses are the narrowing, named
 *   below.
 * - `min`, `max`, `scale` and `precision` read the parsed number: a string and
 *   the number it denotes get the same answer.
 *
 * The driver-facing half (what reaches the driver on each engine door) is
 * `../engine-number-value-door.test.ts`. The physical column, through REST on
 * SQLite, is `packages/rest/src/rest-data-number-value.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPUTED_VALUE_TYPES,
  NUMERIC_STRING_GRAMMAR_CASES,
  NUMERIC_VALUE_TYPES,
  parseNumericString,
  valueSchemaFor,
} from '@objectstack/spec/data';
import {
  normalizeBlankTypedValues,
  normalizeNumericStringValues,
  validateRecord,
  ValidationError,
} from './record-validator.js';

const JUDGED = [...NUMERIC_VALUE_TYPES].filter((t) => !COMPUTED_VALUE_TYPES.has(t));

/** Non-strings JS coerces to a finite number, which the old arm let through. */
const NEWLY_REFUSED: ReadonlyArray<readonly [string, unknown]> = [
  ['[500]', [500]],
  ['[]', []],
  ['[\'12\']', ['12']],
  ['true', true],
  ['false', false],
  ['a Date', new Date(0)],
  ['a Number object', Object(7)],
];
/** Values the old arm already refused; their answer is unchanged. */
const ALREADY_REFUSED: ReadonlyArray<readonly [string, unknown]> = [
  ['[5, 7]', [5, 7]],
  ['{}', {}],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ["'Infinity'", 'Infinity'],
  ["'abc'", 'abc'],
];
const ACCEPTED: ReadonlyArray<readonly [string, unknown]> = [
  ['500', 500],
  ['12.5', 12.5],
  ['0', 0],
  ['-3', -3],
  ['1e21', 1e21],
];

function schemaOf(types: readonly string[]) {
  return { fields: Object.fromEntries(types.map((t) => [`f_${t}`, { name: `f_${t}`, type: t }])) } as any;
}

/** The field-level answer, or `null` when the write is accepted. */
function answer(type: string, value: unknown, mode: 'insert' | 'update') {
  try {
    validateRecord(schemaOf([type]), { [`f_${type}`]: value }, mode);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as ValidationError).code).toBe('VALIDATION_FAILED');
    return (e as ValidationError).fields.map((x) => [x.field, x.code]);
  }
}

describe('the number arm: an array, boolean or object is invalid_number (#20309)', () => {
  it('the judged population is the spec numeric class minus the computed class: the six types', () => {
    // A control on the set itself: if it emptied, every case below would pass
    // over nothing.
    expect([...JUDGED].sort()).toEqual(['currency', 'number', 'percent', 'progress', 'rating', 'slider']);
  });

  describe.each(JUDGED)('%s', (type) => {
    it.each([...NEWLY_REFUSED, ...ALREADY_REFUSED])('refuses %s with invalid_number, on insert and update', (_label, value) => {
      for (const mode of ['insert', 'update'] as const) {
        expect(answer(type, value, mode), mode).toEqual([[`f_${type}`, 'invalid_number']]);
      }
    });

    it.each(ACCEPTED)('accepts the number %s, on insert and update', (_label, value) => {
      for (const mode of ['insert', 'update'] as const) {
        expect(answer(type, value, mode), mode).toBeNull();
      }
    });
  });

  it("refuses exactly what the spec's stored value schema refuses, over every non-string input", () => {
    // `valueSchemaFor` is the spec's declaration of the stored value for the
    // type. Off the string half, the arm and the declaration must not disagree.
    for (const type of JUDGED) {
      const declared = valueSchemaFor({ type }, 'stored');
      for (const [label, value] of [...NEWLY_REFUSED, ...ALREADY_REFUSED, ...ACCEPTED]) {
        if (typeof value === 'string') continue;
        const specAccepts = declared.safeParse(value).success;
        expect(answer(type, value, 'insert') === null, `${type} ${label}`).toBe(specAccepts);
      }
    }
  });

  it('CONTROL: a blank is still null before the arm, so it is never judged (#20308)', () => {
    for (const blank of ['', '  ']) {
      const row = normalizeBlankTypedValues(schemaOf(JUDGED), Object.fromEntries(JUDGED.map((t) => [`f_${t}`, blank])));
      for (const t of JUDGED) expect((row as Record<string, unknown>)[`f_${t}`], t).toBeNull();
      expect(() => validateRecord(schemaOf(JUDGED), row as Record<string, unknown>, 'insert')).not.toThrow();
    }
  });

  it('CONTROL: summary is not judged by the arm (the seat ruling on #20308)', () => {
    expect(COMPUTED_VALUE_TYPES.has('summary')).toBe(true);
    for (const [, value] of [...NEWLY_REFUSED, ...ACCEPTED]) {
      expect(answer('summary', value, 'insert')).toBeNull();
    }
  });
});

// ── The string half (#20309): the spec's numeric grammar ─────────────────────

/** The grammar's own table, split by its own verdict. Blank rows are the blank
 *  rule's (#20308): they never reach the arm as a string on these types. */
const ADMITTED_STRINGS = NUMERIC_STRING_GRAMMAR_CASES.filter((c) => c.numeric);
const REFUSED_STRINGS = NUMERIC_STRING_GRAMMAR_CASES.filter((c) => !c.numeric && c.form !== 'empty');
const BLANK_STRINGS = NUMERIC_STRING_GRAMMAR_CASES.filter((c) => !c.numeric && c.form === 'empty');

/** The rewrite, then the validator: the two halves of the write door, in order. */
function doorAnswer(type: string, value: unknown, mode: 'insert' | 'update') {
  const row = normalizeNumericStringValues(schemaOf([type]), { [`f_${type}`]: value });
  return answer(type, row[`f_${type}`], mode);
}

describe('the number arm reads a string by the spec numeric grammar (#20309, the string half)', () => {
  it('CONTROL: the case table has both halves and every non-blank form, so nothing below passes over nothing', () => {
    expect(ADMITTED_STRINGS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(REFUSED_STRINGS.map((c) => (c.numeric ? '' : c.form)))).toEqual(new Set([
      'padded', 'placeholder', 'radix-prefix', 'non-finite', 'digit-separator', 'non-json-spelling', 'not-a-number',
    ]));
    expect(BLANK_STRINGS.length).toBeGreaterThan(0);
  });

  describe.each(JUDGED)('%s', (type) => {
    it.each(ADMITTED_STRINGS.map((c) => [JSON.stringify(c.input), c.input] as const))(
      'admits %s on insert and update, straight to the arm and through the door rewrite',
      (_l, input) => {
        for (const mode of ['insert', 'update'] as const) {
          expect(answer(type, input, mode), mode).toBeNull();
          expect(doorAnswer(type, input, mode), mode).toBeNull();
        }
      },
    );

    it.each(REFUSED_STRINGS.map((c) => [JSON.stringify(c.input), c.numeric ? '' : c.form, c.input] as const))(
      'refuses %s (%s) with invalid_number on insert and update, straight to the arm and through the door rewrite',
      (_l, _form, input) => {
        const expected = [[`f_${type}`, 'invalid_number']];
        for (const mode of ['insert', 'update'] as const) {
          expect(answer(type, input, mode), mode).toEqual(expected);
          expect(doorAnswer(type, input, mode), mode).toEqual(expected);
        }
      },
    );
  });

  it('the arm accepts a string exactly when parseNumericString reads it — no second grammar', () => {
    const probes = [
      ...NUMERIC_STRING_GRAMMAR_CASES.map((c) => c.input),
      // Beyond the table, to catch a private reading that happens to agree on it.
      '-0.0', '1E3', '1.e3', '-.5', '00', '0x', '١٢', '12 ', ' ', ' 12', '1e+', '9007199254740993',
    ].filter((s) => s.trim() !== '');
    for (const type of JUDGED) {
      for (const s of probes) {
        const read = parseNumericString(s) !== undefined;
        expect(answer(type, s, 'insert') === null, `${type} ${JSON.stringify(s)}`).toBe(read);
      }
    }
  });

  it('NAMED NARROWING: the strings Number() read as finite that the grammar refuses, each now invalid_number', () => {
    // What the old arm (`Number(value)` finite) admitted and the grammar does
    // not: the BREAKING set, read off the spec table rather than listed here
    // as a claim — the literal below pins that the table's set is what the
    // changeset names.
    const narrowed = NUMERIC_STRING_GRAMMAR_CASES
      .filter((c) => !c.numeric && c.form !== 'empty' && Number.isFinite(Number(c.input)))
      .map((c) => c.input);
    expect(narrowed).toEqual([' 12 ', '12\n', '\t-3', '0x10', '0X1A', '0o17', '0b101', '+5', '.5', '5.', '007']);
    for (const type of JUDGED) {
      for (const s of narrowed) expect(answer(type, s, 'insert'), `${type} ${JSON.stringify(s)}`).toEqual([[`f_${type}`, 'invalid_number']]);
    }
  });

  it('CONTROL: the table\'s blank rows never reach the arm — the blank rule makes them null first (#20308)', () => {
    for (const c of BLANK_STRINGS) {
      const row = normalizeBlankTypedValues(schemaOf(JUDGED), Object.fromEntries(JUDGED.map((t) => [`f_${t}`, c.input])));
      for (const t of JUDGED) expect((row as Record<string, unknown>)[`f_${t}`], `${t} ${JSON.stringify(c.input)}`).toBeNull();
      // …and the numeric rewrite leaves a blank for the blank rule: it reads no number.
      const untouched = { f_number: c.input };
      expect(normalizeNumericStringValues(schemaOf(['number']), untouched)).toBe(untouched);
    }
  });
});

describe('normalizeNumericStringValues: an admitted string is written as its number (#20309)', () => {
  it('writes every admitted row of the grammar table as the table\'s own number, on every judged type', () => {
    for (const type of JUDGED) {
      for (const c of ADMITTED_STRINGS) {
        if (!c.numeric) continue;
        const out = normalizeNumericStringValues(schemaOf([type]), { [`f_${type}`]: c.input });
        expect(Object.is(out[`f_${type}`], c.value), `${type} ${JSON.stringify(c.input)} -> ${String(out[`f_${type}`])}`).toBe(true);
      }
    }
  });

  it('what it writes is the spec\'s stored value for the type, and the arm accepts it: one value judged and stored', () => {
    for (const type of JUDGED) {
      const stored = valueSchemaFor({ type }, 'stored');
      for (const c of ADMITTED_STRINGS) {
        const out = normalizeNumericStringValues(schemaOf([type]), { [`f_${type}`]: c.input });
        expect(stored.safeParse(out[`f_${type}`]).success, `${type} ${JSON.stringify(c.input)}`).toBe(true);
        expect(answer(type, out[`f_${type}`], 'insert'), `${type} ${JSON.stringify(c.input)}`).toBeNull();
      }
    }
  });

  it('leaves every string the grammar refuses exactly as sent (the same reference back), so the arm refuses it', () => {
    for (const type of JUDGED) {
      for (const c of REFUSED_STRINGS) {
        const row = { [`f_${type}`]: c.input };
        expect(normalizeNumericStringValues(schemaOf([type]), row), `${type} ${JSON.stringify(c.input)}`).toBe(row);
      }
    }
  });

  it('rewrites only what the arm judges: not a text field, not summary, not a system or readonly field, not id, not a non-string', () => {
    const schema = {
      fields: {
        id: { name: 'id', type: 'number' },
        created_at: { name: 'created_at', type: 'number' },
        f_text: { name: 'f_text', type: 'text' },
        f_summary: { name: 'f_summary', type: 'summary' },
        f_formula: { name: 'f_formula', type: 'formula' },
        f_system: { name: 'f_system', type: 'number', system: true },
        f_readonly: { name: 'f_readonly', type: 'number', readonly: true },
        f_number: { name: 'f_number', type: 'number' },
      },
    } as any;
    const row = {
      id: '12', created_at: '12', f_text: '12', f_summary: '12', f_formula: '12', f_system: '12', f_readonly: '12',
      f_undeclared: '12', f_number: 12,
    };
    expect(normalizeNumericStringValues(schema, row)).toBe(row);
    // CONTROL: the same schema does rewrite its judged field when it is a string.
    expect(normalizeNumericStringValues(schema, { ...row, f_number: '12' }).f_number).toBe(12);
  });

  it('is pure: the caller\'s record is never mutated; one record or an array of them, copied only where changed', () => {
    const schema = schemaOf(['number']);
    const a = { f_number: '12' };
    const b = { f_number: 7 };
    const one = normalizeNumericStringValues(schema, a);
    expect(one).not.toBe(a);
    expect(one).toEqual({ f_number: 12 });
    expect(a).toEqual({ f_number: '12' });

    const list = [a, b];
    const out = normalizeNumericStringValues(schema, list);
    expect(out).not.toBe(list);
    expect(out[0]).toEqual({ f_number: 12 });
    expect(out[1]).toBe(b);
    expect(list[0]).toBe(a);

    const clean = [b];
    expect(normalizeNumericStringValues(schema, clean)).toBe(clean);
    // A field named after an Object.prototype member is looked up as an own property.
    const proto = { fields: { valueOf: { name: 'valueOf', type: 'number' } } } as any;
    expect(normalizeNumericStringValues(proto, { valueOf: '3' })).toEqual({ valueOf: 3 });
    expect(normalizeNumericStringValues(schema, { constructor: '3' })).toEqual({ constructor: '3' });
  });
});

describe('bounds, scale and precision read the parsed number: a string answers as its number does (#20309)', () => {
  const field = (type: string, extra: Record<string, unknown>) => ({ fields: { f: { name: 'f', type, ...extra } } }) as any;
  /** Every field-level error, whole — code, constraint and message. */
  const whole = (schema: any, value: unknown) => {
    try { validateRecord(schema, { f: value }, 'insert'); return null; }
    catch (e) { expect(e).toBeInstanceOf(ValidationError); return (e as ValidationError).fields; }
  };

  const CASES: ReadonlyArray<readonly [string, string, Record<string, unknown>, string, string | null]> = [
    ['12.50 under scale 1', 'number', { scale: 1 }, '12.50', null],
    ['12.55 under scale 1', 'number', { scale: 1 }, '12.55', 'max_scale'],
    ['1e-7 under scale 2', 'number', { scale: 2 }, '1e-7', 'max_scale'],
    ['0.10 under scale 1', 'number', { scale: 1 }, '0.10', null],
    ['2.5E+3 under scale 0', 'number', { scale: 0 }, '2.5E+3', null],
    ['3.5 on a rating under scale 0', 'rating', { scale: 0 }, '3.5', 'max_scale'],
    ['3 on a rating under scale 0', 'rating', { scale: 0 }, '3', null],
    ['150 over max 100', 'number', { max: 100 }, '150', 'max_value'],
    ['-5 under min 0', 'number', { min: 0 }, '-5', 'min_value'],
    ['150 over a progress max 100', 'progress', { max: 100 }, '150', 'max_value'],
    ['1234.5 over precision 5 at scale 2', 'number', { precision: 5, scale: 2 }, '1234.5', 'max_precision'],
    ['999.99 at precision 5, scale 2', 'number', { precision: 5, scale: 2 }, '999.99', null],
    ['0.1234 on a fraction percent at scale 2', 'percent', { scale: 2 }, '0.1234', null],
    ['0.12345 on a fraction percent at scale 2', 'percent', { scale: 2 }, '0.12345', 'max_scale'],
  ];

  it.each(CASES)('%s', (_l, type, extra, input, code) => {
    const schema = field(type, extra);
    const asString = whole(schema, input);
    expect(asString?.map((x) => x.code) ?? null).toEqual(code === null ? null : [code]);
    // The same answer, byte for byte, as the number the string denotes.
    expect(asString).toEqual(whole(schema, parseNumericString(input)));
    // And the door writes that number.
    expect(normalizeNumericStringValues(schema, { f: input }).f).toBe(parseNumericString(input));
  });
});
