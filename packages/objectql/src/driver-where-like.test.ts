// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27277] `$like` / `$ilike` in the walker's `where` position — the pattern
 * operators a driver `where` carries and `having` never did. The walker reads
 * a pattern with the spec's one compiler (`likePatternToRegExp`) and refuses
 * the shapes the spec refuses (a dangling escape, a NUL, a non-string), in the
 * ADR-0112 envelope; `having` and the per-aggregation `filter` still refuse
 * both operators as outside their vocabulary.
 */

import { describe, it, expect } from 'vitest';
import { applyHaving, matchesDriverWhere } from './having-filter.js';

const ROWS = [
  { id: '1', name: 'ACME Corp' },
  { id: '2', name: 'acme corp' },
  { id: '3', name: '100% match' },
  { id: '4', name: '100X match' },
  { id: '5', name: 'a_b' },
  { id: '6', name: 'axb' },
  { id: '7', name: null },
];

const select = (where: Record<string, unknown>) =>
  ROWS.filter((row) => matchesDriverWhere(row, where as any)).map((row) => row.id);

function refusal(run: () => unknown): Error & { code?: string; status?: number } {
  try {
    run();
  } catch (e) {
    return e as Error & { code?: string; status?: number };
  }
  throw new Error('expected a refusal');
}

describe('[#27277] $like / $ilike in a driver where', () => {
  it('$like is case-sensitive; % and _ are wildcards', () => {
    expect(select({ name: { $like: 'ACME%' } })).toEqual(['1']);
    expect(select({ name: { $like: 'a_b' } })).toEqual(['5', '6']);
  });

  it('$ilike folds ASCII case', () => {
    expect(select({ name: { $ilike: 'acme%' } })).toEqual(['1', '2']);
  });

  it('an escaped wildcard is literal', () => {
    expect(select({ name: { $like: '100\\%%' } })).toEqual(['3']);
    expect(select({ name: { $like: 'a\\_b' } })).toEqual(['5']);
  });

  it('a row with no value never matches', () => {
    expect(select({ name: { $like: '%' } })).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('a dangling escape, a NUL and a non-string pattern are refused INVALID_FILTER / 400', () => {
    for (const pattern of ['abc\\', 'a\u0000b', 42]) {
      const err = refusal(() => select({ name: { $like: pattern } }));
      expect(err.code, String(pattern)).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('$like');
    }
  });

  it('`having` still refuses both as outside its vocabulary', () => {
    for (const op of ['$like', '$ilike']) {
      const err = refusal(() => applyHaving([{ n: 'x' }], { n: { [op]: 'x%' } } as any));
      expect(err.code, op).toBe('INVALID_FILTER');
      expect(err.message).toContain(op);
    }
  });
});
