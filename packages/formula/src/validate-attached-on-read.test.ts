// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ExprSchemaHint.attachedOnRead` — the second segment of
 * `record.<block>.<leaf>` judged against a declared read attachment (#22211
 * ruling A, #22386).
 *
 * A read attachment is a block a service sets on each row it serves, computed
 * per caller and never stored — plugin-approvals' `viewer: { can_act,
 * can_override, is_submitter }` on `sys_approval_request` is the worked case.
 * The block name resolves like a field (the caller lists it in `fields`); the
 * hint only adds the judgement of the segment after it, under the EXISTING
 * `unknown-field` code — no new code, and nothing keyed on the name `viewer`.
 *
 * Each verdict is asserted on its `code` and `params` (the named subject and
 * the remedy), the machine-readable half of the refusal.
 */

import { describe, it, expect } from 'vitest';

import { validateExpression, type ExprSchemaHint } from './validate';

const LEAVES = ['can_act', 'can_override', 'is_submitter'] as const;

/** An object that declares the `viewer` read attachment, as the lint field index hands it over. */
const DECLARED: ExprSchemaHint = {
  objectName: 'sys_approval_request',
  fields: ['status', 'submitter_id', 'viewer'],
  attachedOnRead: { viewer: LEAVES },
  scope: 'record',
};

/** The same object WITHOUT the key — today's hint, byte for byte. */
const UNDECLARED: ExprSchemaHint = {
  objectName: 'sys_approval_request',
  fields: ['status', 'submitter_id'],
  scope: 'record',
};

function refusalsOf(source: string, schema: ExprSchemaHint) {
  return validateExpression('predicate', source, schema).errors.map((e) => ({ code: e.code, params: e.params }));
}

describe('ExprSchemaHint.attachedOnRead — record.<block>.<leaf>', () => {
  it('accepts a leaf the block declares', () => {
    for (const leaf of LEAVES) {
      const r = validateExpression('predicate', `record.viewer.${leaf} == true`, DECLARED);
      expect(r.errors, leaf).toEqual([]);
      expect(r.ok).toBe(true);
    }
    // The shipped shape: an OR of two leaves and a status read, one predicate.
    expect(
      validateExpression('predicate', "record.status == 'pending' && (record.viewer.can_act || record.viewer.can_override)", DECLARED).errors,
    ).toEqual([]);
  });

  it('refuses a misspelt leaf under the existing `unknown-field` code, naming the declared leaves', () => {
    expect(refusalsOf('record.viewer.can_actt == true', DECLARED)).toEqual([
      {
        code: 'unknown-field',
        params: {
          field: 'viewer.can_actt',
          objectName: 'sys_approval_request',
          suggestion: 'viewer.can_act',
          block: 'viewer',
          leaves: ['can_act', 'can_override', 'is_submitter'],
        },
      },
    ]);
  });

  it('refuses a leaf with no near declared spelling, still naming every declared leaf', () => {
    expect(refusalsOf('record.viewer.approved', DECLARED)).toEqual([
      {
        code: 'unknown-field',
        params: {
          field: 'viewer.approved',
          objectName: 'sys_approval_request',
          block: 'viewer',
          leaves: ['can_act', 'can_override', 'is_submitter'],
        },
      },
    ]);
  });

  it('judges the `previous` root the same way, and reports one leaf once', () => {
    expect(refusalsOf('previous.viewer.can_actt || record.viewer.can_actt', DECLARED)).toEqual([
      {
        code: 'unknown-field',
        params: {
          field: 'viewer.can_actt',
          objectName: 'sys_approval_request',
          suggestion: 'viewer.can_act',
          block: 'viewer',
          leaves: ['can_act', 'can_override', 'is_submitter'],
        },
      },
    ]);
  });

  it('refuses an undeclared block exactly as today — the FIRST segment, not the second', () => {
    expect(refusalsOf('record.viewr.can_act == true', DECLARED)).toEqual([
      { code: 'unknown-field', params: { field: 'viewr', objectName: 'sys_approval_request', suggestion: 'viewer' } },
    ]);
  });

  it('an object without the key keeps today’s verdicts (control)', () => {
    // The block is unknown as a FIELD, exactly as before the key existed …
    expect(refusalsOf('record.viewer.can_act == true', UNDECLARED)).toEqual([
      { code: 'unknown-field', params: { field: 'viewer', objectName: 'sys_approval_request' } },
    ]);
    // … and a second segment off a known field is not judged at all.
    expect(refusalsOf('record.submitter_id.name == "x"', UNDECLARED)).toEqual([]);
    // Same expression, same verdict, with or without an EMPTY declaration.
    expect(refusalsOf('record.submitter_id.name == "x"', { ...UNDECLARED, attachedOnRead: {} })).toEqual([]);
  });

  it('judges only a declared block: a second segment off any other field stays unjudged', () => {
    expect(refusalsOf('record.submitter_id.nmae == "x"', DECLARED)).toEqual([]);
  });

  it('judges the leaf in every member spelling, as it judges the dot', () => {
    const refused = [{
      code: 'unknown-field',
      params: {
        field: 'viewer.can_actt',
        objectName: 'sys_approval_request',
        suggestion: 'viewer.can_act',
        block: 'viewer',
        leaves: ['can_act', 'can_override', 'is_submitter'],
      },
    }];
    for (const source of [
      "record.viewer['can_actt'] == true",
      "record.viewer.?can_actt.orValue(false) == true",
      "record.viewer[?'can_actt'].orValue(false) == true",
      "record['viewer'].can_actt == true",
      "previous.?viewer.can_actt.orValue(false) == true",
      'has(record.viewer.can_actt)',
    ]) {
      expect(refusalsOf(source, DECLARED), source).toEqual(refused);
    }
    // Control: the declared leaf in the same spellings.
    for (const source of [
      "record.viewer['can_act'] == true",
      "record.viewer.?can_act.orValue(false) == true",
      "record['viewer'][?'can_act'].orValue(false) == true",
      'has(record.viewer.can_act)',
    ]) {
      expect(refusalsOf(source, DECLARED), source).toEqual([]);
    }
  });

  it('leaves a computed key, a method call and a third segment unjudged — missed catches, never false refusals', () => {
    expect(refusalsOf('record.viewer[record.status] == true', DECLARED)).toEqual([]);
    expect(refusalsOf("record.viewer.split(',') == []", DECLARED)).toEqual([]);
    expect(refusalsOf('record.viewer.can_act.foo == true', DECLARED)).toEqual([]);
  });

  it('reads the declaration by OWN key only — an inherited name is never a block', () => {
    const hint: ExprSchemaHint = { ...DECLARED, fields: [...(DECLARED.fields ?? []), 'constructor'] };
    expect(refusalsOf('record.constructor.name == "x"', hint)).toEqual([]);
  });
});
