// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19939] The spec's value-slot template judge reads the `{…}` dialect the
 * way THIS package's interpolator does — the drift pin its module docblock
 * names (`@objectstack/spec/automation`, `flow-value-slot-template.ts`).
 *
 * The spec cannot import the interpolator, so it carries a copy of
 * `resolveToken`'s dispatch: date macro, then `$User.`, then a variable path,
 * then an expression. If the two readings drifted, the judge would refuse a
 * spelling the retirement keeps (a run-time capability lost with no remedy),
 * or keep one it should refuse (the dialect surviving in a value slot). So the
 * interpolator itself is driven over the same tokens the judge classifies:
 *
 *  - every KEPT spelling resolves through `interpolateString` to a value — the
 *    date macros to ISO text, `$User` to the run user — and the judge
 *    refuses none of them;
 *  - every REFUSED spelling resolves through the variables (a path), computes
 *    (an expression), or resolves to nothing — and the judge refuses each,
 *    including the dispatch-order edges (`{$User}` with no path, `{NOW}` with
 *    no call, a padded `{ amount }`).
 */

import { describe, expect, it } from 'vitest';
import { valueSlotTemplateRefusals } from '@objectstack/spec/automation';
import { interpolateString } from './template.js';

const VARIABLES = new Map<string, unknown>([
  ['amount', 1234.5],
  ['record', { owner: 'usr_7', name: 'Acme' }],
  ['list', ['a', 'b']],
  ['$error', { message: 'boom' }],
  ['days', 3],
]);
const CONTEXT = { userId: 'usr_1', user: { email: 'ada@example.com' } } as never;

describe('a spelling the retirement KEEPS resolves through the interpolator, and is not refused', () => {
  it.each([
    ['{NOW()}', /^\d{4}-\d{2}-\d{2}T/],
    ['{TODAY()}', /^\d{4}-\d{2}-\d{2}$/],
    ['{TODAY() + 7}', /^\d{4}-\d{2}-\d{2}$/],
    ['{TODAY() - days}', /^\d{4}-\d{2}-\d{2}$/],
    ['{NOW() + 2}', /^\d{4}-\d{2}-\d{2}T/],
  ])('%s — a date macro', (token, shape) => {
    expect(String(interpolateString(token, VARIABLES, CONTEXT))).toMatch(shape);
    expect(valueSlotTemplateRefusals(token)).toEqual([]);
  });

  it.each([
    ['{$User.Id}', 'usr_1'],
    ['{$User.Email}', 'ada@example.com'],
  ])('%s — the run user', (token, value) => {
    expect(interpolateString(token, VARIABLES, CONTEXT)).toBe(value);
    expect(valueSlotTemplateRefusals(token)).toEqual([]);
  });
});

describe('a spelling the retirement REFUSES is one the interpolator reads as template dialect', () => {
  it.each([
    ['{amount}', 1234.5],
    ['{ amount }', 1234.5],
    ['{record.owner}', 'usr_7'],
    ['{list.0}', 'a'],
    ['{$error.message}', 'boom'],
  ])('%s — a variable path, resolved through the variables', (token, value) => {
    expect(interpolateString(token, VARIABLES, CONTEXT)).toBe(value);
    expect(valueSlotTemplateRefusals(token)).toHaveLength(1);
  });

  it.each([
    ['{amount * 2}', 2469],
    ['{round(amount)}', 1235],
    ['{max(amount, 10)}', 1234.5],
  ])('%s — an expression, computed', (token, value) => {
    expect(interpolateString(token, VARIABLES, CONTEXT)).toBe(value);
    expect(valueSlotTemplateRefusals(token)).toHaveLength(1);
  });

  it.each([
    // No `.` after `$User`: not the user shortcut — a variable path to a
    // variable nobody binds.
    '{$User}',
    // No call: not the date macro — a variable path.
    '{NOW}',
    '{missing.key}',
  ])('%s — a dispatch-order edge: a path that resolves to nothing', (token) => {
    expect(interpolateString(token, VARIABLES, CONTEXT)).toBeUndefined();
    expect(valueSlotTemplateRefusals(token)).toHaveLength(1);
  });

  it('text with holes renders through the interpolator, and is refused as one string', () => {
    expect(interpolateString('Owner {record.owner} of {record.name}', VARIABLES, CONTEXT)).toBe('Owner usr_7 of Acme');
    expect(valueSlotTemplateRefusals('Owner {record.owner} of {record.name}')).toHaveLength(1);
  });

  it('a token-free string is the same text to both: no substitution, no refusal', () => {
    expect(interpolateString('approved', VARIABLES, CONTEXT)).toBe('approved');
    expect(interpolateString('a {} b', VARIABLES, CONTEXT)).toBe('a {} b');
    expect(valueSlotTemplateRefusals('approved')).toEqual([]);
    expect(valueSlotTemplateRefusals('a {} b')).toEqual([]);
  });
});
