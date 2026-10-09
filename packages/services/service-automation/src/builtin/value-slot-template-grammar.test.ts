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
 *    no call, a padded `{ amount }`);
 *  - for a refused PATH, the remedy the judge prints reads the same value
 *    through this package's CEL evaluator (`evaluateValueEnvelope`: the
 *    author-time envelope check, then the built `@objectstack/formula` engine
 *    over the flow's real CEL scope) as the interpolator read from the
 *    template — including a head variable named like an identifier CEL claims
 *    for itself (`{list.0}` → `vars["list"][0]`, #22290).
 */

import { describe, expect, it } from 'vitest';
import { valueSlotTemplateRefusals } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
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

describe('the remedy a refused path prints reads, through CEL, the value the interpolator read', () => {
  const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => quiet } as never;
  const engine = new AutomationEngine(quiet);

  /** The CEL spellings the one refusal of `token` names: the envelope's source, and the `has()` guard when it prints one. */
  function printedSpellings(token: string): string[] {
    const refusals = valueSlotTemplateRefusals(token);
    expect(refusals, `exactly one refusal for ${token}`).toHaveLength(1);
    const message = refusals[0]!.message;
    const envelope = /Write `[^`]+` as \{ dialect: 'cel', source: (?:'([^']*)'|("(?:[^"\\]|\\.)*")) \}/.exec(message);
    expect(envelope, `an envelope remedy in: ${message}`).not.toBeNull();
    const guard = /: `(has\([^`]*)` \(the guarded form writes `null`\)/.exec(message);
    return [envelope![1] ?? (JSON.parse(envelope![2]!) as string), ...(guard ? [guard[1]!] : [])];
  }

  /** Both readings of `token` over `variables`, and every printed spelling evaluated to the interpolator's value. */
  function expectReadingsAgree(token: string, variables: Map<string, unknown>, value: unknown): void {
    expect(interpolateString(token, variables, CONTEXT)).toEqual(value);
    for (const source of printedSpellings(token)) {
      expect(engine.evaluateValueEnvelope({ dialect: 'cel', source }, variables, token), source).toEqual(value);
    }
  }

  // Every identifier CEL claims before a flow variable can (`flow-template-token.ts`
  // in the spec reads them off cel-js 8.0.0): the type identifiers, the namespace
  // constants, the reserved words and the keywords. `__proto__` is claimed there
  // too, and is left out of this list: the flow CEL scope is a plain object, where
  // `__proto__` names the prototype rather than a key, so no CEL spelling reads a
  // variable of that name.
  it.each([
    'bool', 'bytes', 'double', 'int', 'list', 'map', 'null_type', 'string', 'type', 'uint',
    'cel', 'google', 'optional',
    'as', 'break', 'const', 'continue', 'else', 'for', 'function', 'if', 'import', 'let', 'loop', 'namespace',
    'package', 'return', 'var', 'void', 'while', 'prototype',
    'true', 'false', 'null', 'in',
  ])('a head variable named `%s`', (name) => {
    const value = ['first', { key: 'second' }];
    const variables = new Map<string, unknown>([[name, value]]);
    expectReadingsAgree(`{${name}}`, variables, value);
    expectReadingsAgree(`{${name}.0}`, variables, 'first');
    expectReadingsAgree(`{${name}.1.key}`, variables, 'second');
  });

  it('a later keyword segment, and an index in the middle of a path', () => {
    const variables = new Map<string, unknown>([['record', { in: 'x', tags: { null: 'y' } }], ['rows', [{ name: 'r0' }]]]);
    expectReadingsAgree('{record.in}', variables, 'x');
    expectReadingsAgree('{record.tags.null}', variables, 'y');
    expectReadingsAgree('{rows.0.name}', variables, 'r0');
  });

  it.each(['items', 'timestamp', 'duration', 'dyn'])('control: an ordinary head `%s` is read bare, unchanged', (name) => {
    const variables = new Map<string, unknown>([[name, ['first', { key: 'second' }]]]);
    expect(printedSpellings(`{${name}.0}`)).toEqual([`${name}[0]`]);
    expectReadingsAgree(`{${name}.0}`, variables, 'first');
    expectReadingsAgree(`{${name}.1.key}`, variables, 'second');
  });

  it('control: a `$`-named head is still read through `vars`', () => {
    expect(printedSpellings('{$error.message}')).toEqual(['vars["$error"].message']);
    expectReadingsAgree('{$error.message}', VARIABLES, 'boom');
  });
});
