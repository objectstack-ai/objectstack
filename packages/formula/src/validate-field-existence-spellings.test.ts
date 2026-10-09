// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field existence judges a member of `record` / `previous` in EVERY spelling
 * that names one — not only the dot spelling.
 *
 * `record.f`, `record.?f`, `record['f']` and `record[?'f']` read the same
 * column, and `has(…)` around any of them reads it too. A check that saw only
 * the dot let a typo written any other way reach the evaluator with no
 * authoring verdict. The members now come from `readRootMembers`, the one AST
 * member reader the relationship-traversal analysis is folded from, so every
 * spelling gets the same verdict as the dot.
 *
 * Each verdict is asserted on its `code` and `params` (the named subject), the
 * machine-readable half of the refusal.
 */

import { describe, it, expect } from 'vitest';

import { validateExpression, type ExprSchemaHint } from './validate';

const SCHEMA: ExprSchemaHint = {
  objectName: 'fx_probe',
  fields: ['name', 'status', 'amount'],
  scope: 'record',
};

/** Every spelling that names member `f` of `root`, as an author writes it in a predicate. */
const spellings = (root: string, f: string): ReadonlyArray<readonly [string, string]> => [
  ['dot', `${root}.${f} == 'a'`],
  ['bracket', `${root}['${f}'] == 'a'`],
  ['double-quoted bracket', `${root}["${f}"] == 'a'`],
  ['optional selection', `${root}.?${f}.orValue('') == 'a'`],
  ['optional index', `${root}[?'${f}'].orValue('') == 'a'`],
  ['has() presence test', `has(${root}.${f})`],
];

function refusalsOf(source: string, schema: ExprSchemaHint = SCHEMA) {
  return validateExpression('predicate', source, schema).errors.map((e) => ({ code: e.code, params: e.params }));
}

describe('field existence — every member spelling on record and previous', () => {
  for (const root of ['record', 'previous']) {
    for (const [spelling, source] of spellings(root, 'zz_typo')) {
      it(`refuses an undeclared field written as ${root} ${spelling}: ${source}`, () => {
        expect(refusalsOf(source)).toEqual([
          { code: 'unknown-field', params: { field: 'zz_typo', objectName: 'fx_probe' } },
        ]);
      });
    }

    for (const [spelling, source] of spellings(root, 'status')) {
      it(`CONTROL — accepts a declared field written as ${root} ${spelling}: ${source}`, () => {
        const r = validateExpression('predicate', source, SCHEMA);
        expect(r.errors).toEqual([]);
        expect(r.ok).toBe(true);
      });
    }
  }

  it('keeps the did-you-mean in a non-dot spelling', () => {
    expect(refusalsOf("record['stauts'] == 'a'")).toEqual([
      { code: 'unknown-field', params: { field: 'stauts', objectName: 'fx_probe', suggestion: 'status' } },
    ]);
  });

  it('reports one name once, across spellings and across both roots', () => {
    expect(refusalsOf("record.zz == 1 && record['zz'] == 2 && previous.?zz.orValue(0) == 3")).toEqual([
      { code: 'unknown-field', params: { field: 'zz', objectName: 'fx_probe' } },
    ]);
  });

  it('reports distinct names in source order, whatever their spellings', () => {
    expect(refusalsOf("record['zz_b'] == 1 && record.zz_a == 2").map((r) => r.params)).toEqual([
      { field: 'zz_b', objectName: 'fx_probe' },
      { field: 'zz_a', objectName: 'fx_probe' },
    ]);
  });

  it('judges a member read inside a comprehension body', () => {
    expect(refusalsOf("[1, 2].exists(x, record['zz_typo'] == x)")).toEqual([
      { code: 'unknown-field', params: { field: 'zz_typo', objectName: 'fx_probe' } },
    ]);
  });

  it('gives a computed key no verdict — it names no member before evaluation', () => {
    // The key is another field's VALUE; only the read that names a member
    // (`record.name`, declared) is judged.
    const r = validateExpression('predicate', "record[record.name] == 'a'", SCHEMA);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('reads members, not text: a string literal that spells `record.<x>` is not a read', () => {
    expect(refusalsOf("record.name == 'record.zz_typo'")).toEqual([]);
  });

  it('judges nothing without a field list, in any spelling (control)', () => {
    for (const [, source] of spellings('record', 'zz_typo')) {
      expect(refusalsOf(source, { scope: 'record' }), source).toEqual([]);
    }
  });
});
