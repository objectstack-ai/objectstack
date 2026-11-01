// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `label(record.<field>)` on a declared field that declares no options is
 * refused at author time (#28659).
 *
 * `label()` (#26608) answers on a field whose definition carries an `options`
 * list: the engine builds its label map from exactly those fields, read
 * through `declaresOptions`. On any other field the evaluator faults on every
 * row and the formula reads null forever. `validateExpression` now gives that
 * verdict before the formula is stored, when the caller hands it the object's
 * option-bearing fields (`ExprSchemaHint.optionFields`), in the evaluator's
 * own words.
 *
 * Each refusal asserts the code and the named field, not the prose around it;
 * the message pin lives with the other code pins in
 * `expression-refusal-codes.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { celEngine } from './cel-engine';
import { declaresOptions } from './stdlib';
import { validateExpression, type ExprSchemaHint } from './validate';

/** The card's object: `first` is text, `kind` a select with options, `stage` a radio with options. */
const P4: ExprSchemaHint = {
  scope: 'record',
  objectName: 'qaformula_p4',
  fields: ['first', 'kind', 'stage', 'pf'],
  fieldTypes: { first: 'text', kind: 'select', stage: 'radio', pf: 'formula' },
  traversalHydration: true,
  optionFields: ['kind', 'stage'],
};

const codes = (source: string, schema: ExprSchemaHint = P4) => {
  const r = validateExpression('value', source, schema);
  return r.errors.map((e) => ({ code: e.code, params: e.params }));
};

describe('label(record.FIELD) on a field that declares no options is refused (#28659)', () => {
  it('⭐ LIT — the card\'s `label(record.first)` (text) is refused, naming `first`', () => {
    const r = validateExpression('value', 'label(record.first)', P4);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => ({ code: e.code, params: e.params }))).toEqual([
      { code: 'label-field-no-options', params: { field: 'first' } },
    ]);
    expect(r.errors[0]!.message).toContain('`first` declares no options');
    expect(r.warnings).toEqual([]);
  });

  it('⭐ LIT — the compound `label(record.kind) + label(record.first)` is refused for `first` alone', () => {
    expect(codes('label(record.kind) + label(record.first)')).toEqual([
      { code: 'label-field-no-options', params: { field: 'first' } },
    ]);
  });

  it('one refusal per field, however many calls name it', () => {
    expect(codes("label(record.first) + ' / ' + label(record.first)")).toEqual([
      { code: 'label-field-no-options', params: { field: 'first' } },
    ]);
    expect(codes("label(record.first) + label(record.pf)")).toEqual([
      { code: 'label-field-no-options', params: { field: 'first' } },
      { code: 'label-field-no-options', params: { field: 'pf' } },
    ]);
  });

  it('a call nested anywhere in the expression is judged', () => {
    expect(codes("record.kind == 'clean' ? label(record.first) : 'x'")).toEqual([
      { code: 'label-field-no-options', params: { field: 'first' } },
    ]);
    expect(codes('size(label(record.first)) > 0 ? 1 : 0')).toEqual([
      { code: 'label-field-no-options', params: { field: 'first' } },
    ]);
  });

  it('CONTROL — label() on fields that declare options is admitted, whatever their type', () => {
    expect(validateExpression('value', 'label(record.kind)', P4)).toEqual({ ok: true, errors: [], warnings: [] });
    expect(validateExpression('value', "label(record.kind) + ' · ' + label(record.stage)", P4)).toEqual({
      ok: true,
      errors: [],
      warnings: [],
    });
  });

  it('CONTROL — an undeclared field keeps its `unknown-field` refusal and gets no second one', () => {
    expect(codes('label(record.nope)')).toEqual([
      { code: 'unknown-field', params: { field: 'nope', objectName: 'qaformula_p4' } },
    ]);
  });

  it('CONTROL — an unregistered function keeps its refusal', () => {
    expect(codes('sqrt(4)').map((c) => c.code)).toEqual(['cel-unknown-function']);
  });

  it('CONTROL — reading the optionless field directly is admitted', () => {
    expect(validateExpression('value', "record.first + ' · ' + label(record.kind)", P4).ok).toBe(true);
  });

  it('opt-in: without `optionFields` (or without `fields`) nothing is judged, as before', () => {
    const { optionFields: _omit, ...noOptions } = P4;
    expect(validateExpression('value', 'label(record.first)', noOptions).ok).toBe(true);
    const { fields: _f, ...noFields } = P4;
    expect(validateExpression('value', 'label(record.first)', noFields).ok).toBe(true);
    expect(validateExpression('value', 'label(record.first)').ok).toBe(true);
  });

  it('the refusal is the evaluator\'s own fault sentence for the same call', () => {
    const run = celEngine.evaluate({ dialect: 'cel', source: 'label(record.first)' }, {
      record: { first: 'hello', kind: 'clean' },
      optionLabels: { kind: { clean: 'Clean' } },
    });
    expect(run.ok).toBe(false);
    const refused = validateExpression('value', 'label(record.first)', P4).errors[0]!;
    if (!run.ok) expect(run.error.message).toBe(refused.message);
  });
});

describe('declaresOptions — the one reading of "has options" (#28659)', () => {
  it('is true exactly when the definition carries an options list', () => {
    expect(declaresOptions({ type: 'select', options: [{ value: 'a', label: 'A' }] })).toBe(true);
    expect(declaresOptions({ type: 'multiselect', options: [] })).toBe(true);
    expect(declaresOptions({ type: 'text' })).toBe(false);
    expect(declaresOptions({ type: 'select' })).toBe(false);
    expect(declaresOptions({ type: 'select', options: 'a,b' })).toBe(false);
    expect(declaresOptions(null)).toBe(false);
    expect(declaresOptions(undefined)).toBe(false);
  });
});
