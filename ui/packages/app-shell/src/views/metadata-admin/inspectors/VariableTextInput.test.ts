// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { formatToken, insertToken } from './VariableTextInput';

describe('formatToken', () => {
  it('inserts a bare token in expression fields (ADR-0032)', () => {
    expect(formatToken('discount_pct', 'expression')).toBe('discount_pct');
    expect(formatToken('record.amount', 'expression')).toBe('record.amount');
  });
  it('has no single-brace spelling: no mode wraps a token in one brace pair (objectui#12329)', () => {
    // The spec 18 engine reads no `{x}` token in a flow string, so the picker
    // writes none. Single brace = an opening brace not followed by another.
    const singleBrace = /(^|[^{])\{(?!\{)[^{}]*\}/;
    for (const mode of ['expression', 'hole'] as const) {
      expect(formatToken('record.amount', mode)).not.toMatch(singleBrace);
      expect(insertToken('Hi ', mode, 'record.name', 3, 3).next).not.toMatch(singleBrace);
    }
    // The pattern can fire: a control on the spelling the picker used to write.
    expect('{record.amount}').toMatch(singleBrace);
    expect('{{ record.amount }}').not.toMatch(singleBrace);
  });
  it('wraps a token in a {{ }} hole in a flow text slot (objectui#11824)', () => {
    expect(formatToken('record.amount', 'hole')).toBe('{{ record.amount }}');
    expect(insertToken('Hi ', 'hole', 'record.name', 3, 3)).toEqual({ next: 'Hi {{ record.name }}', caret: 20 });
  });
});

describe('insertToken (cursor splice)', () => {
  it('appends at the caret (end of value) — expression mode, no braces', () => {
    const r = insertToken('lead_score >= ', 'expression', 'record.amount', 14, 14);
    expect(r.next).toBe('lead_score >= record.amount');
    expect(r.caret).toBe('lead_score >= record.amount'.length);
  });
  it('inserts mid-string at the caret', () => {
    // caret between "a " and "b": "a | b"
    const r = insertToken('a  b', 'expression', 'x', 2, 2);
    expect(r.next).toBe('a x b');
    expect(r.caret).toBe(3);
  });
  it('replaces the current selection', () => {
    const r = insertToken('hello OLD world', 'expression', 'NEW', 6, 9);
    expect(r.next).toBe('hello NEW world');
  });
  it('wraps with double braces in hole mode, caret after the hole', () => {
    const r = insertToken('Hi ', 'hole', 'record.name', 3, 3);
    expect(r.next).toBe('Hi {{ record.name }}');
    expect(r.caret).toBe('Hi {{ record.name }}'.length);
  });
  it('clamps out-of-range / reversed selections instead of corrupting the value', () => {
    expect(insertToken('abc', 'expression', 'X', 99, 99).next).toBe('abcX');
    expect(insertToken('abc', 'expression', 'X', 3, 1).next).toBe('aX'); // reversed [3,1] → selects 'bc', replaced
    expect(insertToken('', 'hole', 'v', -5, -5).next).toBe('{{ v }}');
  });
});
