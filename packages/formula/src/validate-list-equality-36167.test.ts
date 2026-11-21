// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36167] `validateExpression` refuses `==` / `!=` between a LIST-valued
 * field and a non-null scalar literal (`list-equality`).
 *
 * CEL compares the whole list with the scalar, so `record.labels == 'frontend'`
 * is `false` for `['frontend', 'qa']` and for `null` alike: the condition
 * answers one constant on every row. A field is a list subject when its
 * `fieldTypes` type is inherently multi (`multiselect` / `checkboxes` /
 * `tags`) or `ExprSchemaHint.multiValueFields` names it (a `select` /
 * `lookup` / `user` declared `multiple: true`).
 *
 * The first describe proves the premise on the evaluator itself, so the
 * refusal below is about a real constant and not a guess.
 */

import { describe, it, expect } from 'vitest';

import { celEngine } from './cel-engine';
import { validateExpression, type ExprSchemaHint } from './validate';

const MULTI_TYPES = ['multiselect', 'checkboxes', 'tags'] as const;
const CAPABLE_TYPES = ['select', 'lookup', 'user'] as const;

/** A record-scoped hint over one field `f` of `type`, optionally declared multi-valued. */
function hintFor(type: string, multi = false, scope: 'record' | 'flattened' = 'record'): ExprSchemaHint {
  return {
    objectName: 'probe',
    fields: ['f', 'name', 'g'],
    fieldTypes: { f: type, name: 'text' },
    ...(multi ? { multiValueFields: ['f'] } : {}),
    scope,
  };
}

/** Every operand order and member spelling of `<root>.f <op> 'a'`. */
function comparisons(root: string, op: '==' | '!='): readonly string[] {
  return [
    `${root}.f ${op} 'a'`,
    `'a' ${op} ${root}.f`,
    `${root}['f'] ${op} 'a'`,
    `'a' ${op} ${root}["f"]`,
    `${root}.?f ${op} 'a'`,
    `${root}[?'f'] ${op} 'a'`,
    `${root}.f ${op} 3`,
    `${root}.f ${op} true`,
    `${root}.name == 'x' && ${root}.f ${op} 'a'`,
  ];
}

function refusalsOf(source: string, hint: ExprSchemaHint, role: 'predicate' | 'value' = 'predicate') {
  return validateExpression(role, source, hint).errors;
}

describe('the premise — on the evaluator, a list compared with a scalar is a constant', () => {
  const run = (source: string, labels: unknown) =>
    celEngine.evaluate({ dialect: 'cel', source }, { record: { labels } });
  it.each([[['frontend', 'qa']], [['qa']], [[]], [null]])('labels = %j', (labels) => {
    expect(run("record.labels == 'frontend'", labels)).toEqual({ ok: true, value: false });
    expect(run("record.labels != 'frontend'", labels)).toEqual({ ok: true, value: true });
  });
  it('CONTROL — the prescribed membership test answers per row', () => {
    const src = "record.labels != null && 'frontend' in record.labels";
    expect(run(src, ['frontend', 'qa'])).toEqual({ ok: true, value: true });
    expect(run(src, ['qa'])).toEqual({ ok: true, value: false });
    expect(run(src, null)).toEqual({ ok: true, value: false });
  });
});

describe('list-equality — refused on an inherently multi-value type', () => {
  for (const type of MULTI_TYPES) {
    for (const root of ['record', 'previous']) {
      for (const op of ['==', '!='] as const) {
        for (const source of comparisons(root, op)) {
          it(`${type}: refuses ${source}`, () => {
            const errors = refusalsOf(source, hintFor(type));
            expect(errors.map((e) => e.code)).toEqual(['list-equality']);
            const [e] = errors;
            expect(e.code === 'list-equality' && e.params.reference).toBe(`${root}.f`);
            expect(e.code === 'list-equality' && e.params.operator).toBe(op);
            expect(e.code === 'list-equality' && e.params.answer).toBe(op === '==' ? 'false' : 'true');
            expect(e.message).toContain(`\`${root}.f\``);
            expect(e.message).toContain(' in ');
            expect(e.message).toContain(op === '==' ? `in ${root}.f\`` : `!(`);
          });
        }
      }
    }
  }

  it('refuses in a flattened (flow) condition and in a formula value too', () => {
    expect(refusalsOf("record.f == 'a'", hintFor('tags', false, 'flattened')).map((e) => e.code)).toEqual(['list-equality']);
    expect(refusalsOf("record.f == 'a'", hintFor('tags'), 'value').map((e) => e.code)).toEqual(['list-equality']);
  });

  it('refuses each comparison once, in the order written', () => {
    const errors = refusalsOf("record.f == 'a' || previous.f != 'b'", hintFor('multiselect'));
    expect(errors.map((e) => e.code === 'list-equality' && [e.params.reference, e.params.operator])).toEqual([
      ['record.f', '=='],
      ['previous.f', '!='],
    ]);
  });
});

describe('list-equality — select / lookup / user follow multiValueFields', () => {
  for (const type of CAPABLE_TYPES) {
    for (const op of ['==', '!='] as const) {
      it(`${type} declared multiple: refuses record.f ${op} 'a'`, () => {
        const errors = refusalsOf(`record.f ${op} 'a'`, hintFor(type, true));
        expect(errors.map((e) => e.code)).toEqual(['list-equality']);
        expect(errors[0].message).toContain('`record.f`');
        expect(errors[0].message).toMatch(/\bin record\.f/);
      });
      it(`${type} not declared multiple: accepts record.f ${op} 'a' (absent key, as before)`, () => {
        expect(validateExpression('predicate', `record.f ${op} 'a'`, hintFor(type)).ok).toBe(true);
      });
    }
  }

  it('multiValueFields alone (no fieldTypes) is enough', () => {
    const r = validateExpression('predicate', "record.f == 'a'", { fields: ['f'], scope: 'record', multiValueFields: ['f'] });
    expect(r.errors.map((e) => e.code)).toEqual(['list-equality']);
  });
});

describe('list-equality — accepted shapes', () => {
  const accepted = [
    'record.f == null',
    'record.f != null',
    'null == record.f',
    'null != previous.f',
    "'a' in record.f",
    "record.f != null && 'a' in record.f",
    "record.f == null || !('a' in record.f)",
    "record.f == ['a', 'b']",
    'record.f == previous.f',
    'size(record.f) == 2',
    "record.f[0] == 'a'",
    'record.f == record.g',
  ];
  for (const source of accepted) {
    it(`accepts ${source}`, () => {
      const r = validateExpression('predicate', source, hintFor('multiselect'));
      expect(r.errors.map((e) => e.code)).toEqual([]);
    });
  }

  it('CONTROL — a scalar field compared with a scalar is accepted', () => {
    for (const type of ['text', 'select', 'lookup', 'user', 'number']) {
      for (const op of ['==', '!=']) {
        expect(validateExpression('predicate', `record.f ${op} 'a'`, hintFor(type)).ok).toBe(true);
      }
    }
    expect(validateExpression('predicate', "record.name == 'a'", hintFor('multiselect')).ok).toBe(true);
  });

  it('CONTROL — no hint, no verdict', () => {
    expect(validateExpression('predicate', "record.f == 'a'").ok).toBe(true);
    expect(validateExpression('predicate', "record.f == 'a'", { scope: 'record' }).ok).toBe(true);
  });
});
