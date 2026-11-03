// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A CEL refusal keeps the engine's own fault code and the source range it
 * points at (#27904).
 *
 * `invalid-cel` used to carry only `role` and `detail` — cel-js's rendered
 * text, with a `^` under the spot. An editor that wants to say "a closing
 * bracket is missing at character 17" in the author's language had nothing
 * structured to say it from, and `EvalError.pos` was declared and never
 * filled. These tests pin, per fault class:
 *
 *  - the code is cel-js's own (`ParseError#code` / `TypeError#code`), read from
 *    the error object and never from its prose;
 *  - the range is the one cel-js reports, pinned against the source text it
 *    points at (the `)` that is missing, the `#` that is not CEL);
 *  - the English `message` is the same sentence as before — our words around
 *    the engine's pass-through `detail`, byte for byte;
 *  - where the engine read a REWRITTEN source (the #3306 null-guard lowering),
 *    the range would point into text the author never wrote, so it is absent —
 *    never a guessed `0`.
 */

import { describe, expect, it } from 'vitest';
import { celEngine, rewriteNullableTernary } from './cel-engine';
import { validateExpression } from './validate';

/** The one `invalid-cel` refusal `validateExpression` reports for `source`. */
function invalidCel(source: string, role: 'predicate' | 'value' = 'predicate') {
  const r = validateExpression(role, source);
  expect(r.ok).toBe(false);
  expect(r.errors).toHaveLength(1);
  const [err] = r.errors;
  expect(err.code).toBe('invalid-cel');
  return err as typeof err & { code: 'invalid-cel' };
}

/** The engine's own diagnostic — what `detail` passes through, and the message embeds. */
function engineDetail(source: string): string {
  const compiled = celEngine.compile(source);
  if (compiled.ok) throw new Error(`expected \`${source}\` not to compile`);
  return compiled.error.message;
}

interface Case {
  readonly name: string;
  readonly source: string;
  readonly celCode: string;
  readonly pos: { readonly start: number; readonly end: number };
  /** What `source.slice(pos.start, pos.end)` is — the text the range points at. */
  readonly at: string;
}

const CASES: readonly Case[] = [
  {
    // Unexpected end: the expression stops where an operand is owed.
    name: 'unexpected end (operand missing after `>=`)',
    source: 'record.rating >=',
    celCode: 'unexpected_token',
    pos: { start: 16, end: 16 },
    at: '',
  },
  {
    // A missing `)`: cel-js points at the end of the source, where it wanted it.
    name: 'missing closing bracket',
    source: '(record.a > 1 && record.b < 2',
    celCode: 'expected_token',
    pos: { start: 29, end: 29 },
    at: '',
  },
  {
    // A character that is not CEL, in the middle of the source.
    name: 'unexpected character mid-source',
    source: 'record.a # 1',
    celCode: 'unexpected_character',
    pos: { start: 9, end: 10 },
    at: '#',
  },
  {
    // A stray `)` after a complete expression.
    name: 'stray closing bracket',
    source: 'record.a > 1 )',
    celCode: 'unexpected_character',
    pos: { start: 13, end: 14 },
    at: ')',
  },
  {
    // An unterminated string: the range covers the opened literal.
    name: 'unterminated string',
    source: "record.a == 'abc",
    celCode: 'unterminated_string',
    pos: { start: 12, end: 16 },
    at: "'abc",
  },
];

describe('invalid-cel carries the engine fault code and its source range (#27904)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const err = invalidCel(c.source);
      expect(err.params).toEqual({ role: 'predicate', detail: engineDetail(c.source), celCode: c.celCode, pos: c.pos });
      // The range is pinned against the source, not only as numbers.
      expect(c.source.slice(err.params.pos!.start, err.params.pos!.end)).toBe(c.at);
      if (c.pos.start === c.pos.end && c.at === '') expect(c.pos.start).toBe(c.source.length);
      // The sentence is unchanged: our words around the engine's own text.
      expect(err.message).toBe(
        `invalid CEL predicate: ${engineDetail(c.source)} — predicates are bare CEL (e.g. \`record.rating >= 4\`).`,
      );
    });
  }

  it('a type fault carries the type checker\'s code and range on the same members', () => {
    const source = "1 + 'a'";
    const err = invalidCel(source, 'value');
    expect(err.params).toEqual({ role: 'value', detail: engineDetail(source), celCode: 'no_such_overload', pos: { start: 0, end: 7 } });
    expect(err.message).toBe(`invalid CEL value: ${engineDetail(source)} — values are bare CEL (e.g. \`record.rating >= 4\`).`);
  });

  it('no range is invented where the engine read a rewritten source', () => {
    // The #3306 null-guard lowering reserializes this source before the check,
    // so the checker's range points into the rewritten text. The code is still
    // the engine's; the range is absent rather than wrong.
    const source = "record.x > 1 ? 1 + 'a' : null";
    // Control: the source really is rewritten, so the absence below is the guard's.
    expect(rewriteNullableTernary(source)).not.toBe(source);
    const err = invalidCel(source, 'value');
    expect(err.params.celCode).toBe('no_such_overload');
    expect('pos' in err.params).toBe(false);
  });
});

describe('EvalError.pos is filled where the engine reports a range (#27904)', () => {
  it('compile: a parse fault', () => {
    const compiled = celEngine.compile('record.a # 1');
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.error.kind).toBe('parse');
    expect(compiled.error.pos).toEqual({ start: 9, end: 10 });
  });

  it('compile: a missing closing bracket, at the end of the source', () => {
    const source = '(record.a > 1 && record.b < 2';
    const compiled = celEngine.compile(source);
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.error.kind).toBe('parse');
    expect(compiled.error.pos).toEqual({ start: source.length, end: source.length });
  });

  it('compile: a check fault', () => {
    const compiled = celEngine.compile("1 + 'a'");
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.error.kind).toBe('type');
    expect(compiled.error.pos).toEqual({ start: 0, end: 7 });
  });

  it('compile: absent, not invented, over a rewritten source', () => {
    const source = "record.x > 1 ? 1 + 'a' : null";
    expect(rewriteNullableTernary(source)).not.toBe(source);
    const compiled = celEngine.compile(source);
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.error.kind).toBe('type');
    expect('pos' in compiled.error).toBe(false);
  });

  it('evaluate: a parse fault', () => {
    const r = celEngine.evaluate({ dialect: 'cel', source: 'record.a # 1' }, { record: { a: 1 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('parse');
    expect(r.error.pos).toEqual({ start: 9, end: 10 });
  });

  it('evaluate: a runtime fault, pinned against the key it names', () => {
    const source = 'record.missing.x > 1';
    const r = celEngine.evaluate({ dialect: 'cel', source }, { record: { a: 1 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('runtime');
    expect(r.error.pos).toEqual({ start: 7, end: 14 });
    expect(source.slice(7, 14)).toBe('missing');
  });

  it('evaluate: absent, not invented, over a rewritten source', () => {
    const source = 'record.x > 1 ? record.missing.y : null';
    expect(rewriteNullableTernary(source)).not.toBe(source);
    const r = celEngine.evaluate({ dialect: 'cel', source }, { record: { x: 2 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('runtime');
    expect('pos' in r.error).toBe(false);
  });

  it('a fault that is not cel-js\'s carries no range', () => {
    // `matches()` hands cel-js a native regex SyntaxError: no cel-js range exists.
    const r = celEngine.evaluate({ dialect: 'cel', source: "matches(record.name, '(')" }, { record: { name: 'x' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('runtime');
    expect('pos' in r.error).toBe(false);
  });
});
