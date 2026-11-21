// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36167] The Studio CEL hint carries the object's list-valued fields
 * (`CelSchemaHint.multiValueFields` → the engine's
 * `ExprSchemaHint.multiValueFields`), so `record.<list field> == <scalar>` —
 * which answers one constant on every row — is refused in Studio as the
 * publish lint refuses it. The object draft gate reads each field through
 * `isMultiValueField`, so a `select` / `user` declared `multiple: true` is a
 * list there too. Against the REAL `@objectstack/formula` engine.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { validateMetadataDraft } from './clientValidation';
import { __setCelFormulaLoader, lintCelPredicate } from './celAuthoring';

afterEach(() => __setCelFormulaLoader(undefined));

const OPTIONS = [
  { label: 'Frontend', value: 'frontend' },
  { label: 'QA', value: 'qa' },
];

describe('lintCelPredicate — multiValueFields', () => {
  it('refuses a list field compared with a scalar when the hint names it', async () => {
    const issues = await lintCelPredicate("record.watchers == 'u1'", {
      fields: ['watchers'],
      multiValueFields: ['watchers'],
      scope: 'record',
    });
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('`record.watchers` holds a list');
    expect(errors[0].message).toContain('in record.watchers');
  });

  it('CONTROL — without the hint member the same source is clean (as before)', async () => {
    const issues = await lintCelPredicate("record.watchers == 'u1'", { fields: ['watchers'], scope: 'record' });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('validateMetadataDraft — object field rules on a list field', () => {
  const draft = (visibleWhen: string) => ({
    name: 'ticket',
    label: 'Ticket',
    fields: {
      labels: { type: 'multiselect', label: 'Labels', options: OPTIONS },
      stage: { type: 'select', label: 'Stage', options: OPTIONS, multiple: true },
      single: { type: 'select', label: 'Single', options: OPTIONS },
      note: { type: 'text', label: 'Note', visibleWhen },
    },
  });

  it.each([
    ["record.labels == 'frontend'", 'record.labels'],
    ["record.stage != 'qa'", 'record.stage'],
  ])('refuses %s under fields.note.visibleWhen', async (source, reference) => {
    const res = await validateMetadataDraft('object', draft(source));
    const issue = res.issues.find((i) => i.path === 'fields.note.visibleWhen');
    expect(issue?.message).toContain(`\`${reference}\` holds a list`);
  });

  it.each(["record.single == 'qa'", "'qa' in record.stage", 'record.labels != null'])(
    'CONTROL — %s raises no issue',
    async (source) => {
      const res = await validateMetadataDraft('object', draft(source));
      expect(res.issues.filter((i) => i.path === 'fields.note.visibleWhen')).toEqual([]);
    },
  );
});
