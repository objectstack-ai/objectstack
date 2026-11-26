// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #35143: the second batch of publish-time checks, Data model family, the
 * two field-shape rules of `lintFieldReferenceShapes`. Each has a pin that
 * fires, a pin that stays silent, and the runtime publish gate's own verdict on
 * the write it judges. The family's other lines are pinned in the harness of
 * the rule they extend: the summary relation arm in
 * `data-model-rules.summary-rollup.test.ts`, the approval detail table in
 * `validate-approval-approvers.test.ts`, and the formula-over-a-bare-summary
 * line (covered by `field/summary-without-operations`) in
 * `validate-functional-completeness.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { lintFieldReferenceShapes } from './data-model-rules.js';

type AnyRec = Record<string, any>;

const REFERENCE_ON_NON_REFERENCE_TYPE = 'field/reference-on-non-reference-type';
const COUNT_NAMED_LOOKUP = 'field/count-named-lookup';

const rulesOf = (findings: readonly { rule: string }[]) => findings.map((f) => f.rule);

describe('field/reference-on-non-reference-type', () => {
  const object = (fields: AnyRec): AnyRec => ({ name: 'deal', label: 'Deal', fields: { name: { type: 'text', label: 'Name' }, ...fields } });

  it('refuses reference on a text, number or date field, whose inline editor becomes the record picker', () => {
    for (const def of [
      { type: 'text', label: 'Account', reference: 'account' },
      { type: 'number', label: 'Account', reference: 'account' },
      { type: 'date', label: 'Account', reference: 'account' },
    ]) {
      const hit = lintFieldReferenceShapes([object({ account: def })]).filter((f) => f.rule === REFERENCE_ON_NON_REFERENCE_TYPE);
      expect(hit, def.type).toHaveLength(1);
      expect(hit[0]).toMatchObject({ severity: 'error', path: 'objects[0].fields.account.reference' });
      expect(hit[0].message).toContain('record picker');
      expect(hit[0].fix).toContain("{ type: 'lookup', reference: 'account' }");
    }
  });

  it('refuses it on a select too, saying only that it links nothing: the inline editor draws the select first', () => {
    const hit = lintFieldReferenceShapes([
      object({ account: { type: 'select', label: 'Account', reference: 'account', options: [{ value: 'a', label: 'A' }] } }),
    ]).filter((f) => f.rule === REFERENCE_ON_NON_REFERENCE_TYPE);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'error', path: 'objects[0].fields.account.reference' });
    expect(hit[0].message).not.toContain('record picker');
  });

  it('on a formula it says only that the key links nothing: the record page gives a formula no editor', () => {
    const hit = lintFieldReferenceShapes([
      object({ account_name: { type: 'formula', label: 'Account', expression: 'record.name', reference: 'account' } }),
    ]).filter((f) => f.rule === REFERENCE_ON_NON_REFERENCE_TYPE);
    expect(hit).toHaveLength(1);
    expect(hit[0].message).not.toContain('record picker');
  });

  it('is silent on the four reference types, on a summary, and on a blank reference', () => {
    const findings = lintFieldReferenceShapes([
      object({
        account: { type: 'lookup', label: 'Account', reference: 'account' },
        parent_deal: { type: 'master_detail', label: 'Parent', reference: 'deal' },
        rep: { type: 'user', label: 'Rep', reference: 'sys_user' },
        parent: { type: 'tree', label: 'Parent', reference: 'deal' },
        lines: { type: 'summary', label: 'Lines', reference: 'deal_line', summaryOperations: { object: 'deal_line', function: 'count' } },
        note: { type: 'text', label: 'Note', reference: '' },
      }),
    ]);
    expect(rulesOf(findings)).not.toContain(REFERENCE_ON_NON_REFERENCE_TYPE);
  });

  it('judges the fields an object extension adds, located in the extension', () => {
    const cli = runAuthoringRules('validate', {
      normalized: { objects: [object({})], objectExtensions: [{ extend: 'deal', fields: { region_code: { type: 'text', label: 'Region', reference: 'region' } } }] },
      parsed: { objects: [object({})], objectExtensions: [{ extend: 'deal', fields: { region_code: { type: 'text', label: 'Region', reference: 'region' } } }] },
    } as never);
    const hit = cli.filter((f) => f.rule === REFERENCE_ON_NON_REFERENCE_TYPE);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'error', path: 'objectExtensions[0].fields.region_code.reference' });
  });

  it('the runtime publish gate refuses the object write and the object_extension write', () => {
    const objectVerdict = runRuntimeAuthoringRules({
      type: 'object',
      item: object({ account: { type: 'text', label: 'Account', reference: 'account' } }),
      context: { objects: [] },
    });
    expect(rulesOf(objectVerdict.errors)).toContain(REFERENCE_ON_NON_REFERENCE_TYPE);
    const extensionVerdict = runRuntimeAuthoringRules({
      type: 'object_extension',
      item: { extend: 'deal', fields: { account: { type: 'text', label: 'Account', reference: 'account' } } },
      context: { objects: [object({})] },
    });
    expect(rulesOf(extensionVerdict.errors)).toContain(REFERENCE_ON_NON_REFERENCE_TYPE);
    const clean = runRuntimeAuthoringRules({
      type: 'object',
      item: object({ account: { type: 'lookup', label: 'Account', reference: 'account' } }),
      context: { objects: [] },
    });
    expect(rulesOf(clean.errors)).not.toContain(REFERENCE_ON_NON_REFERENCE_TYPE);
  });
});

describe('field/count-named-lookup', () => {
  const object = (fields: AnyRec): AnyRec => ({ name: 'account', label: 'Account', fields: { name: { type: 'text', label: 'Name' }, ...fields } });

  it('warns on a lookup or master_detail named like a count or a total', () => {
    for (const name of ['contact_count', 'total_amount', 'count', 'deal_totals']) {
      const hit = lintFieldReferenceShapes([object({ [name]: { type: 'lookup', label: 'X', reference: 'contact' } })]).filter(
        (f) => f.rule === COUNT_NAMED_LOOKUP,
      );
      expect(hit, name).toHaveLength(1);
      expect(hit[0]).toMatchObject({ severity: 'warning', path: `objects[0].fields.${name}.type` });
      expect(hit[0].fix).toContain("type: 'number'");
    }
  });

  it('is silent on names that only contain the letters (account, discount, country) and on a number named so', () => {
    const findings = lintFieldReferenceShapes([
      object({
        account: { type: 'lookup', label: 'Account', reference: 'account' },
        discount: { type: 'lookup', label: 'Discount', reference: 'discount' },
        country: { type: 'lookup', label: 'Country', reference: 'country' },
        contact_count: { type: 'number', label: 'Contacts' },
      }),
    ]);
    expect(rulesOf(findings)).not.toContain(COUNT_NAMED_LOOKUP);
  });

  it('rides the runtime publish gate as an advisory, never a refusal', () => {
    const verdict = runRuntimeAuthoringRules({
      type: 'object',
      item: object({ contact_count: { type: 'lookup', label: 'Contacts', reference: 'contact' } }),
      context: { objects: [] },
    });
    expect(rulesOf(verdict.errors)).not.toContain(COUNT_NAMED_LOOKUP);
    expect(rulesOf(verdict.advisories)).toContain(COUNT_NAMED_LOOKUP);
  });
});

