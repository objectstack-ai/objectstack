// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20308 — the write door's reading of a BLANK string, and the numeric type
 * door, at the validator module.
 *
 * `normalizeBlankTypedValues` rewrites `''` / whitespace on a non-string-typed
 * column to `null` and leaves everything else alone. Both populations are read
 * from the spec's own sets, so a type joining `NON_TEXT_STORED_VALUE_TYPES`,
 * `NUMERIC_VALUE_TYPES` or `COMPUTED_VALUE_TYPES` tomorrow is covered here
 * without an edit — and a type leaving the string side would turn the control
 * half red.
 *
 * The engine-level half (what reaches the driver on every door) is
 * `../engine-blank-typed-value-door.test.ts`; the physical-column half, through
 * REST on SQLite, is `packages/rest/src/rest-data-blank-typed-value.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPUTED_VALUE_TYPES,
  NON_TEXT_STORED_VALUE_TYPES,
  NUMERIC_VALUE_TYPES,
  STRING_VALUE_TYPES,
} from '@objectstack/spec/data';
import { normalizeBlankTypedValues, validateRecord, ValidationError } from './record-validator.js';

const typed = [...NON_TEXT_STORED_VALUE_TYPES];
// The string-stored controls: the whole string class, plus the other types
// whose stored value is a string (`str_empty`'s side of the line).
const stringStored = [...STRING_VALUE_TYPES, 'select', 'radio', 'lookup', 'master_detail', 'user', 'autonumber'];

function schemaOf(types: readonly string[]) {
  const fields: Record<string, { name: string; type: string; reference?: string; options?: unknown[] }> = {};
  for (const t of types) {
    fields[`f_${t}`] = {
      name: `f_${t}`,
      type: t,
      ...(t === 'lookup' || t === 'master_detail' ? { reference: 'other' } : {}),
      ...(t === 'select' || t === 'radio' ? { options: [{ value: 'a', label: 'A' }] } : {}),
    };
  }
  return { fields } as any;
}

function rowOf(types: readonly string[], value: unknown) {
  return Object.fromEntries(types.map((t) => [`f_${t}`, value]));
}

describe('normalizeBlankTypedValues (#20308)', () => {
  it('the population is the spec set, and it is the one the card names', () => {
    // A control on the set itself: if it ever emptied, every case below would
    // pass over nothing.
    expect(typed.sort()).toEqual(
      ['boolean', 'currency', 'date', 'datetime', 'number', 'percent', 'progress', 'rating', 'slider', 'summary', 'time', 'toggle'],
    );
    for (const t of stringStored) expect(NON_TEXT_STORED_VALUE_TYPES.has(t)).toBe(false);
  });

  it.each([[''], ['   '], ['\t\n']])('a blank %j on every non-string-typed column becomes null', (blank) => {
    const out = normalizeBlankTypedValues(schemaOf(typed), rowOf(typed, blank)) as Record<string, unknown>;
    for (const t of typed) expect(out[`f_${t}`], t).toBeNull();
  });

  it("a string-stored column's blank is untouched — the str_empty side", () => {
    for (const blank of ['', '  ']) {
      const row = rowOf(stringStored, blank);
      const out = normalizeBlankTypedValues(schemaOf(stringStored), row);
      expect(out).toBe(row);
      for (const t of stringStored) expect((out as Record<string, unknown>)[`f_${t}`], t).toBe(blank);
    }
  });

  it('a non-blank value of any kind passes through untouched — falsy is not blank', () => {
    for (const v of [null, undefined, 0, false, 'abc', ' x ', '0', 'false', '2026-09-27', 42, true]) {
      const row = rowOf(typed, v);
      expect(normalizeBlankTypedValues(schemaOf(typed), row), String(v)).toBe(row);
    }
  });

  it('never mutates the caller: a copy comes back only when something changed', () => {
    const schema = schemaOf(['number', 'text']);
    const row = { f_number: '', f_text: '', extra: 1 };
    const out = normalizeBlankTypedValues(schema, row) as Record<string, unknown>;
    expect(out).not.toBe(row);
    expect(row).toEqual({ f_number: '', f_text: '', extra: 1 });
    expect(out).toEqual({ f_number: null, f_text: '', extra: 1 });
  });

  it('an array: rows copied only where they changed, the array only when a row did', () => {
    const schema = schemaOf(['date', 'text']);
    const clean = { f_date: '2026-01-01' };
    const blank = { f_date: '' };
    const rows = [clean, blank];
    const out = normalizeBlankTypedValues(schema, rows) as Array<Record<string, unknown>>;
    expect(out).not.toBe(rows);
    expect(out[0]).toBe(clean);
    expect(out[1]).toEqual({ f_date: null });
    expect(rows[1]).toBe(blank);
    expect(blank.f_date).toBe('');
    const untouched = [clean, { f_text: '' }];
    expect(normalizeBlankTypedValues(schema, untouched)).toBe(untouched);
  });

  it('an undeclared key, an inherited name and a schema without fields are left alone', () => {
    const schema = schemaOf(['number']);
    const row = { nope: '', constructor: '' };
    expect(normalizeBlankTypedValues(schema, row)).toBe(row);
    expect(normalizeBlankTypedValues({} as any, { f_number: '' })).toEqual({ f_number: '' });
    expect(normalizeBlankTypedValues(null, { f_number: '' })).toEqual({ f_number: '' });
  });
});

// The door the number branch reads: the numeric class minus the server-computed
// class (seat ruling on #20308 — `summary` is producer-owned).
const typeChecked = [...NUMERIC_VALUE_TYPES].filter((t) => !COMPUTED_VALUE_TYPES.has(t));
const computedNumeric = [...NUMERIC_VALUE_TYPES].filter((t) => COMPUTED_VALUE_TYPES.has(t));

describe('the numeric type door is NUMERIC_VALUE_TYPES minus COMPUTED_VALUE_TYPES (#20308)', () => {
  function refusal(type: string, value: unknown) {
    try {
      validateRecord(schemaOf([type]), { [`f_${type}`]: value }, 'insert');
      return null;
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      return e as ValidationError;
    }
  }

  it('the two populations are the ones the ruling names — progress judged, summary exempt', () => {
    // A control on the sets themselves: if either emptied, the cases below
    // would pass over nothing.
    expect(typeChecked.sort()).toEqual(['currency', 'number', 'percent', 'progress', 'rating', 'slider']);
    expect(computedNumeric).toEqual(['summary']);
  });

  it.each(typeChecked)('%s refuses a non-numeric string with invalid_number', (type) => {
    const e = refusal(type, 'abc');
    expect(e?.code).toBe('VALIDATION_FAILED');
    expect(e?.fields.map((f) => [f.field, f.code])).toEqual([[`f_${type}`, 'invalid_number']]);
  });

  it.each([...NUMERIC_VALUE_TYPES])('%s still accepts a finite number', (type) => {
    expect(refusal(type, 7)).toBeNull();
  });

  it.each(computedNumeric)('%s is exempt: its shape is the producer\'s (COMPUTED_VALUE_TYPES), not this check\'s', (type) => {
    // What the roll-up recompute writes — a date string for a `max` over a
    // temporal child field — is not refused here. (A blank still becomes null
    // at the door; that is `normalizeBlankTypedValues`, above.)
    expect(refusal(type, '2026-01-05')).toBeNull();
    expect(refusal(type, 'abc')).toBeNull();
  });

  it('summary takes no check at all, and progress no `scale` — a declared `max` / `scale` on summary is not read', () => {
    // The boundary the branch states for `summary`: its shape is the producer's,
    // so a declared `max` / `scale` is never enforced on it.
    const summary = { f_summary: { name: 'f_summary', type: 'summary', max: 100, scale: 0 } } as any;
    expect(() => validateRecord({ fields: summary }, { f_summary: 150.5 }, 'insert')).not.toThrow();
    // `progress` took the type check here, and its declared `min` / `max` since
    // #20386 (record-validator.progress-bounds.test.ts) — but still no `scale`.
    const progress = { f_progress: { name: 'f_progress', type: 'progress', max: 100, scale: 0 } } as any;
    expect(() => validateRecord({ fields: progress }, { f_progress: 50.5 }, 'insert')).not.toThrow();
  });
});
