// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21238] `multiValueStorageForm` — the ONE rule that puts a value written to a
// declared multi-valued column into its stored form: objectql's record
// validator applies it at the write door (`normalizeMultiValueFields`, pinned in
// `record-validator.test.ts`), and plugin-security's write check applies it to
// the image it judges (`rls-check-stored-form.test.ts`). This file pins the rule
// itself.

import { describe, it, expect } from 'vitest';
import { multiValueStorageForm } from './multi-value-storage-form.js';

describe('multiValueStorageForm — a lone scalar becomes a one-member list', () => {
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ['a string', 'x'],
    ['a string with surrounding space, kept as written', ' x '],
    ['a number', 1],
    ['zero', 0],
    ['NaN, a number', Number.NaN],
    ['true', true],
    ['false', false],
  ];
  for (const [name, input] of cases) {
    it(name, () => expect(multiValueStorageForm(input)).toEqual([input]));
  }
});

describe('multiValueStorageForm — everything else is returned as the SAME value', () => {
  const list = ['x', 'y'];
  const object = { nested: true };
  const date = new Date('2026-01-05T00:00:00Z');
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ['a list, already in the form', list],
    ['an empty list', []],
    ['undefined', undefined],
    ['null', null],
    ['the empty string, read as missing', ''],
    ['a string of whitespace, read as missing', '  \t '],
    ['a plain object, left for the validator to refuse', object],
    ['a Date, not a scalar the rule reads', date],
    ['a bigint, not a scalar the rule reads', 1n],
  ];
  for (const [name, input] of cases) {
    it(name, () => expect(multiValueStorageForm(input)).toBe(input));
  }
});
