// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24131] The emptiness rule `required` is judged by, pinned per arm, and
 * read through core's `.` entry — the specifier both of its doors import
 * (`@objectstack/objectql`'s record validator, `@objectstack/rest`'s public-form
 * submit route).
 *
 * The arms are the ones the rule moved out of `record-validator.ts` with:
 * absent, `null`, `''`, a whitespace-only string, `[]` on a field whose
 * declared value is a set (empty), and `[]` on a structured-JSON field (a
 * document, NOT empty). Each "empty" row sits beside a present twin, so a
 * predicate that answered `true` for everything fails as loudly as one that
 * answered `false`.
 */

import { describe, it, expect } from 'vitest';
import { isEmptyForRequired, isMissing } from '../index.js';

const TEXT = { type: 'text' };
const TAGS = { type: 'tags' };
const MULTISELECT = { type: 'multiselect' };
const MULTI_LOOKUP = { type: 'lookup', multiple: true };
const SINGLE_LOOKUP = { type: 'lookup' };
const JSON_FIELD = { type: 'json' };

describe('[#24131] isMissing — the def-free half', () => {
  it.each([
    ['absent (undefined)', undefined],
    ['null', null],
    ["the empty string ''", ''],
    ['a whitespace-only string', '   '],
    ['a tab-and-newline string', '\t\n'],
  ])('%s is missing', (_label, value) => {
    expect(isMissing(value)).toBe(true);
  });

  it.each([
    ['a non-blank string', 'Ada'],
    ['a padded non-blank string', '  Ada  '],
    ['zero', 0],
    ['false', false],
    ['an empty list (def-free: never missing here)', []],
    ['an empty object', {}],
  ])('%s is present', (_label, value) => {
    expect(isMissing(value)).toBe(false);
  });
});

describe('[#24131] isEmptyForRequired — isMissing, plus [] where the declared value is a set', () => {
  it.each([
    ['absent', TEXT, undefined],
    ['null', TEXT, null],
    ["''", TEXT, ''],
    ['whitespace-only', TEXT, '   '],
    ['[] on tags (an inherently-multi type)', TAGS, []],
    ['[] on multiselect', MULTISELECT, []],
    ['[] on a lookup flagged multiple: true', MULTI_LOOKUP, []],
    ['null on tags', TAGS, null],
  ])('%s is empty', (_label, def, value) => {
    expect(isEmptyForRequired(def, value)).toBe(true);
  });

  it.each([
    ['a non-blank string', TEXT, 'ada@example.test'],
    ['zero', { type: 'number' }, 0],
    ['false', { type: 'boolean' }, false],
    ['a one-member list on tags', TAGS, ['x']],
    ['a one-member list on a multi lookup', MULTI_LOOKUP, ['rec_1']],
    // A structured-JSON field's `[]` is a legitimate document, not an emptied
    // set — the half of the rule a value-shape guess would get wrong.
    ['[] on a json field (a document, not an emptied set)', JSON_FIELD, []],
    // A single-valued lookup's declared value is NOT a set, so its `[]` is
    // not judged empty here; the value-shape arm downstream refuses it.
    ['[] on a single-valued lookup', SINGLE_LOOKUP, []],
  ])('%s is not empty', (_label, def, value) => {
    expect(isEmptyForRequired(def, value)).toBe(false);
  });
});
