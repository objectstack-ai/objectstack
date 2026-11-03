// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29176 — the write door's one string-stored arm, at the validator module:
 * `normalizeBlankTypedValues` stores `''` as `null` on an OPTIONAL text-like
 * column that a unique constraint covers, and on no other string-stored
 * column.
 *
 * The population is read from the spec's own `STRING_VALUE_TYPES`, so a type
 * joining the text-like class tomorrow is covered here without an edit, and
 * the two credential types are pinned OUT by name. The engine-level half (what
 * reaches the driver on every door) is `../engine-optional-unique-blank-door.test.ts`;
 * the physical column and the status, through REST on SQLite, are
 * `packages/rest/src/rest-data-optional-unique-blank.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { STRING_VALUE_TYPES } from '@objectstack/spec/data';
import { normalizeBlankTypedValues } from './record-validator.js';

const CREDENTIAL = ['password', 'secret'];
const textLike = [...STRING_VALUE_TYPES].filter((t) => !CREDENTIAL.includes(t));
// A string-stored type outside both string arms: `unique` alone never pulls it
// in. (The single-value option and reference types have their own arm since
// #29277, unique or not: `record-validator.single-value-blank.test.ts`.)
const otherStringStored = ['autonumber'];

type Def = Record<string, unknown>;
function schemaOf(types: readonly string[], extra: Def = {}, indexes?: unknown[]) {
  const fields: Record<string, Def> = {};
  for (const t of types) {
    fields[`f_${t}`] = {
      name: `f_${t}`,
      type: t,
      ...(t === 'lookup' || t === 'master_detail' ? { reference: 'other' } : {}),
      ...(t === 'select' || t === 'radio' ? { options: [{ value: 'a', label: 'A' }] } : {}),
      ...extra,
    };
  }
  return { fields, ...(indexes ? { indexes } : {}) } as any;
}
const rowOf = (types: readonly string[], value: unknown) => Object.fromEntries(types.map((t) => [`f_${t}`, value]));

describe('normalizeBlankTypedValues: optional unique text-like columns (#29176)', () => {
  it('the population is the spec text-like class minus the credential types', () => {
    // A control on the set itself: if it ever emptied, every case below would
    // pass over nothing.
    expect(textLike.sort()).toEqual(
      ['code', 'color', 'email', 'html', 'markdown', 'phone', 'qrcode', 'richtext', 'signature', 'text', 'textarea', 'url'],
    );
    for (const t of CREDENTIAL) expect(STRING_VALUE_TYPES.has(t), t).toBe(true);
  });

  it.each([[true], ['global'], ['organization']])('field-level unique %j: "" on every text-like column becomes null', (unique) => {
    const out = normalizeBlankTypedValues(schemaOf(textLike, { unique }), rowOf(textLike, '')) as Record<string, unknown>;
    for (const t of textLike) expect(out[`f_${t}`], t).toBeNull();
  });

  it('a member of a declared unique index becomes null; a plain index member keeps ""', () => {
    const schema = schemaOf(['text'], {}, [{ fields: ['f_text', 'f_textarea'], unique: 'global' }]);
    schema.fields.f_textarea = { name: 'f_textarea', type: 'textarea' };
    schema.fields.f_plain = { name: 'f_plain', type: 'text' };
    schema.indexes.push({ fields: ['f_plain'] }, { fields: ['f_plain'], unique: false });
    const out = normalizeBlankTypedValues(schema, { f_text: '', f_textarea: '', f_plain: '' }) as Record<string, unknown>;
    expect(out).toEqual({ f_text: null, f_textarea: null, f_plain: '' });
  });

  it('the controls keep "": no unique constraint, unique: false, required, credentials, other string-stored types', () => {
    const cases: Array<[string, any, Record<string, unknown>]> = [
      ['no unique', schemaOf(textLike), rowOf(textLike, '')],
      ['unique: false', schemaOf(textLike, { unique: false }), rowOf(textLike, '')],
      ['required', schemaOf(textLike, { unique: true, required: true }), rowOf(textLike, '')],
      ['credentials', schemaOf(CREDENTIAL, { unique: true }), rowOf(CREDENTIAL, '')],
      ['other string-stored', schemaOf(otherStringStored, { unique: true }), rowOf(otherStringStored, '')],
    ];
    for (const [label, schema, row] of cases) expect(normalizeBlankTypedValues(schema, row), label).toBe(row);
  });

  it('a lifecycle column the engine owns is never rewritten, even when declared unique', () => {
    const schema = { fields: { id: { name: 'id', type: 'text', unique: true } } } as any;
    const row = { id: '' };
    expect(normalizeBlankTypedValues(schema, row)).toBe(row);
  });

  it('whitespace, and every non-blank value, pass through untouched', () => {
    for (const v of ['  ', '\t', ' x ', 'abc', '0', null, undefined, 0, false]) {
      const row = rowOf(textLike, v);
      expect(normalizeBlankTypedValues(schemaOf(textLike, { unique: true }), row), String(v)).toBe(row);
    }
  });

  it('pure: an array is rewritten per row, the caller rows are never mutated', () => {
    const schema = schemaOf(['text'], { unique: true });
    const rows = [{ f_text: '' }, { f_text: 'S1' }];
    const out = normalizeBlankTypedValues(schema, rows) as Array<Record<string, unknown>>;
    expect(out).not.toBe(rows);
    expect(out).toEqual([{ f_text: null }, { f_text: 'S1' }]);
    expect(out[1]).toBe(rows[1]);
    expect(rows[0]!.f_text).toBe('');
  });
});
