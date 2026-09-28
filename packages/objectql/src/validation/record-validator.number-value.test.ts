// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20309 — the number arm accepts only a finite JS number, the value the
 * driver will then receive.
 *
 * ## The defect
 *
 * The arm judged `Number(value)` and the write carried `value`. So every value
 * JS coerces to a finite number passed the check and reached the driver as it
 * was sent. Measured on `origin/main` c74de10a94 through the real engine and
 * REST doors:
 *
 * - `[500]`: SQLite stored the TEXT `'[500]'` and memory stored the array;
 * - `[]`: SQLite stored `'[]'`;
 * - `true` / `false`: SQLite stored `1` / `0`, and memory stored the boolean;
 * - `'0x10'`: SQLite stored the TEXT `'0x10'`, which its read repair presents
 *   as `16`;
 * - `' 12 '`, `'12'`, `'1e3'`: memory stored the string.
 *
 * `[5, 7]`, `{}` and `'Infinity'` were refused, because `Number()` of each is
 * not finite.
 *
 * ## What this file pins
 *
 * - The refusal set on every judged type, on insert and update, as the
 *   `VALIDATION_FAILED` envelope with `invalid_number`.
 * - Parity with the spec: the arm refuses exactly what the spec's stored value
 *   schema for the type (`valueSchemaFor`, `z.number().finite()`) refuses, over
 *   the whole grid.
 * - The controls: a finite number passes, including `0` and a negative; a
 *   blank is still `null` before the arm (#20308); `summary` is still not
 *   judged (the seat ruling on #20308).
 *
 * The driver-facing half (what reaches the driver on each engine door) is
 * `../engine-number-value-door.test.ts`. The physical column, through REST on
 * SQLite, is `packages/rest/src/rest-data-number-value.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { COMPUTED_VALUE_TYPES, NUMERIC_VALUE_TYPES, valueSchemaFor } from '@objectstack/spec/data';
import { normalizeBlankTypedValues, validateRecord, ValidationError } from './record-validator.js';

const JUDGED = [...NUMERIC_VALUE_TYPES].filter((t) => !COMPUTED_VALUE_TYPES.has(t));

/** Values JS coerces to a finite number, which the old arm let through. */
const COERCIBLE: ReadonlyArray<readonly [string, unknown]> = [
  ['[500]', [500]],
  ['[]', []],
  ['true', true],
  ['false', false],
  ["'0x10'", '0x10'],
  ["' 12 '", ' 12 '],
  ["'12'", '12'],
  ["'12.5'", '12.5'],
  ["'-3'", '-3'],
  ["'1e3'", '1e3'],
  ['a Date', new Date(0)],
];
/** Values the old arm already refused; their answer is unchanged. */
const ALREADY_REFUSED: ReadonlyArray<readonly [string, unknown]> = [
  ['[5, 7]', [5, 7]],
  ['{}', {}],
  ["'Infinity'", 'Infinity'],
  ["'abc'", 'abc'],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
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

describe('the number arm: only a finite JS number passes (#20309)', () => {
  it('the judged population is the spec numeric class minus the computed class: the six types', () => {
    // A control on the set itself: if it emptied, every case below would pass
    // over nothing.
    expect([...JUDGED].sort()).toEqual(['currency', 'number', 'percent', 'progress', 'rating', 'slider']);
  });

  describe.each(JUDGED)('%s', (type) => {
    it.each([...COERCIBLE, ...ALREADY_REFUSED])('refuses %s with invalid_number, on insert and update', (_label, value) => {
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

  it("refuses exactly what the spec's stored value schema refuses, over the whole grid", () => {
    // `valueSchemaFor` is the spec's declaration of the stored value for the
    // type. The arm and the declaration must not disagree on any input.
    for (const type of JUDGED) {
      const declared = valueSchemaFor({ type }, 'stored');
      for (const [label, value] of [...COERCIBLE, ...ALREADY_REFUSED, ...ACCEPTED]) {
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
    for (const [, value] of [...COERCIBLE, ...ACCEPTED]) {
      expect(answer('summary', value, 'insert')).toBeNull();
    }
  });
});
