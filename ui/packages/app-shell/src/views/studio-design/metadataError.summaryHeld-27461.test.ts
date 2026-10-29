// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27461 — the Data pillar holds a roll-up (`summary`) field until
 * it is set up, the way it holds a choice field before its options.
 *
 * The card: "Add field" with Type = Rollup sent `{ type: 'summary' }` at once,
 * and the server saved it (200, with the draft's `_diagnostics` reporting
 * `field/summary-without-operations`): a field that reads 0 everywhere. The
 * write guard lets a roll-up through at every stage, so the hold asks the
 * spec's own judges instead, and every case below pairs the hold with their
 * verdict on the same field: the completeness rule for a roll-up with no
 * `summaryOperations`, and `FieldSchema` for what a started one still lacks.
 * The hold is never stricter than the contract.
 */

import { describe, expect, it } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';
import { checkFieldCompleteness, FIELD_SUMMARY_WITHOUT_OPERATIONS } from '@objectstack/spec/kernel';
import { objectHeldEdit } from './metadataError';
import { t, tFormat } from '../metadata-admin/i18n';

const parent = (fields: unknown) => ({ name: 'crm_account', label: 'Account', fields });

/** The clause naming the roll-up input `inputKey` on the field labelled `field`. */
const needs = (inputKey: string, field: string, locale = 'en') =>
  tFormat('engine.studio.held.fieldNeedsInput', locale, { input: t(inputKey, locale), field });

/** The spec's verdict on one field definition: its issue paths, and the completeness rules it trips. */
function specVerdict(def: Record<string, unknown>): { paths: string[]; rules: string[] } {
  const parsed = FieldSchema.safeParse({ name: 'probe', ...def });
  return {
    paths: parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.')),
    rules: checkFieldCompleteness(def).map((f) => f.rule),
  };
}

describe('a roll-up is held until it is set up (objectstack#27461)', () => {
  it('just created (no summaryOperations): held on the child object, naming the field by its label', () => {
    const def = { label: 'Child Count', type: 'summary' };
    expect(specVerdict(def).rules).toContain(FIELD_SUMMARY_WITHOUT_OPERATIONS);
    expect(objectHeldEdit(parent({ child_count: def }), 'en')).toEqual({
      clause: needs('designer.field.summary.object', 'Child Count'),
      target: { kind: 'field', id: 'child_count' },
    });
  });

  it('a child object but no function: held on the aggregation', () => {
    const def = { label: 'Total', type: 'summary', summaryOperations: { object: 'crm_order' } };
    expect(specVerdict(def).paths).toContain('summaryOperations.function');
    expect(objectHeldEdit(parent({ total: def }), 'en')?.clause).toBe(
      needs('designer.field.summary.function', 'Total'),
    );
  });

  it('a function but no child object: held on the child object first, in the inspector\'s order', () => {
    const def = { label: 'Total', type: 'summary', summaryOperations: { function: 'sum' } };
    expect(specVerdict(def).paths).toContain('summaryOperations.object');
    expect(objectHeldEdit(parent({ total: def }), 'en')?.clause).toBe(
      needs('designer.field.summary.object', 'Total'),
    );
  });

  it('a sum with no child field: held on the field to aggregate', () => {
    const def = { label: 'Total', type: 'summary', summaryOperations: { object: 'crm_order', function: 'sum' } };
    expect(specVerdict(def).paths).toEqual(['summaryOperations.field']);
    expect(objectHeldEdit(parent([{ name: 'total', ...def }]), 'en')).toEqual({
      clause: needs('designer.field.summary.field', 'Total'),
      target: { kind: 'field', id: 'total' },
    });
  });

  it('zh: the clause reads in the designer locale', () => {
    expect(objectHeldEdit(parent({ total: { label: 'Total', type: 'summary' } }), 'zh-CN')?.clause).toBe(
      needs('designer.field.summary.object', 'Total', 'zh-CN'),
    );
  });

  // CONTROLS: what the spec accepts is sent, and so is what is finished but wrong.
  it('a count with no field, or a sum with one: not held, and the spec accepts both', () => {
    for (const ops of [
      { object: 'crm_order', function: 'count' },
      { object: 'crm_order', function: 'sum', field: 'amount' },
    ]) {
      const def = { label: 'Total', type: 'summary', summaryOperations: ops };
      expect(specVerdict(def)).toEqual({ paths: [], rules: [] });
      expect(objectHeldEdit(parent({ total: def }), 'en')).toBeNull();
    }
  });

  it('a finished roll-up the spec refuses for another reason is sent, so its refusal shows', () => {
    const def = {
      label: 'Total',
      type: 'summary',
      summaryOperations: { object: 'crm_order', function: 'median', field: 'amount' },
    };
    expect(specVerdict(def).paths).toContain('summaryOperations.function');
    expect(objectHeldEdit(parent({ total: def }), 'en')).toBeNull();
  });

  it('a choice field the guard refuses is named before a roll-up', () => {
    const body = parent({
      total: { label: 'Total', type: 'summary' },
      status: { label: 'Status', type: 'select' },
    });
    expect(objectHeldEdit(body, 'en')?.target).toEqual({ kind: 'field', id: 'status' });
  });
});
