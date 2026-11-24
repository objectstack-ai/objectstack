// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { BUILTIN_SYSTEM_FIELD_LABEL_LOCALES } from '@objectstack/spec/system';

import { AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';
import { FIELD_LABEL_DUPLICATE, lintDuplicateFieldLabels } from './lint-duplicate-field-labels.js';

/** The staging object: an AI-added `user` field labelled like the platform's `owner_id` in zh-CN. */
function ticketObject(assignee: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'e9gv_ticket',
    label: '工单',
    fields: {
      title: { type: 'text', label: '标题' },
      assignee: { type: 'user', label: '负责人', ...assignee },
    },
  };
}

describe('lintDuplicateFieldLabels', () => {
  it('reports the injected owner_id and an authored field the zh-CN reader sees under one label', () => {
    const findings = lintDuplicateFieldLabels({ objects: [ticketObject()] });
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(FIELD_LABEL_DUPLICATE);
    expect(f.severity).toBe('error');
    expect(f.where).toBe('object "e9gv_ticket"');
    expect(f.path).toBe('objects[0].fields');
    expect(f.message).toContain("'assignee' and 'owner_id'");
    expect(f.message).toContain('"负责人"');
    expect(f.message).toContain('locale zh-CN');
    expect(f.hint).toContain("'owner_id'");
  });

  it('does not compare a hidden field', () => {
    expect(lintDuplicateFieldLabels({ objects: [ticketObject({ hidden: true })] })).toEqual([]);
  });

  it('passes fields whose labels differ in every locale', () => {
    expect(lintDuplicateFieldLabels({ objects: [ticketObject({ label: '处理人' })] })).toEqual([]);
  });

  it('does not compare owner_id where the platform injects none', () => {
    const obj = { ...ticketObject(), ownership: 'none' };
    expect(lintDuplicateFieldLabels({ objects: [obj] })).toEqual([]);
  });

  it('reports a clash only a translation bundle creates, naming that locale alone', () => {
    const stack = {
      objects: [
        { name: 'deal', fields: { amount: { type: 'currency', label: 'Amount' }, total: { type: 'currency', label: 'Total' } } },
      ],
      translations: [
        { 'ja-JP': { objects: { deal: { fields: { amount: { label: '金額' }, total: { label: '金額' } } } } } },
      ],
    };
    const findings = lintDuplicateFieldLabels(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("'amount' and 'total'");
    expect(findings[0].message).toContain('"金額" when read in locale ja-JP,');
  });

  it('reports an authored clash once, naming no locale', () => {
    const stack = {
      objects: [
        { name: 'deal', fields: { stage: { type: 'text', label: 'Status' }, status: { type: 'select', label: ' Status ' } } },
      ],
    };
    const findings = lintDuplicateFieldLabels(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("'stage' and 'status' under one label \"Status\", so");
  });

  it('reads an authored owner_id with its own label in place of the injected column', () => {
    const obj = {
      name: 'e9gv_ticket',
      fields: { owner_id: { type: 'lookup', reference: 'sys_user', label: '所有者' }, assignee: { type: 'user', label: '负责人' } },
    };
    expect(lintDuplicateFieldLabels({ objects: [obj] })).toEqual([]);
  });

  it('is a gating entry the three commands and the object and object_extension publish doors run', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'lintDuplicateFieldLabels');
    expect(entry?.tier).toBe('gating');
    // [#33644] `object_extension` joins; its door pins live in
    // `runtime-gate.object-writes.test.ts`.
    expect(entry?.runtimeTypes).toEqual(['object', 'object_extension']);
    const stack = { objects: [ticketObject()] };
    for (const command of ['validate', 'build', 'lint'] as const) {
      const rules = runAuthoringRules(command, { normalized: stack, parsed: stack }).filter((f) => f.rule === FIELD_LABEL_DUPLICATE);
      expect(rules.map((f) => f.severity), command).toEqual(['error']);
    }
  });

  it('the explanation names exactly the locales the platform translates the injected columns into', () => {
    const text = explainRule(FIELD_LABEL_DUPLICATE)!.paragraphs.join(' ');
    const named = new Set([...text.matchAll(/`([a-z]{2}(?:-[A-Z]{2})?)`/g)].map((m) => m[1]));
    expect([...named].sort()).toEqual([...BUILTIN_SYSTEM_FIELD_LABEL_LOCALES].sort());
  });
});
