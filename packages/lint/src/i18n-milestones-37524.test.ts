// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `objects.<object>._milestones.<field>.<value>.summary` on the two lint
// readers every object translation group has: the extractor walk that
// scaffolds and gates the key, and the orphan rule that refuses a key nothing
// reads. Both key on the pair an `activityMilestones` entry fires on.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries } from './i18n-walk.js';
import { validateTranslationReferences, TRANSLATION_TARGET_UNKNOWN } from './validate-translation-references.js';

const CASE = {
  name: 'crm_case',
  label: 'Case',
  fields: {
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    status: { name: 'status', type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
  },
  activityMilestones: [
    { field: 'status', value: 'closed', summary: 'Case closed — {subject}' },
    // The same pair again: the writer fires the first, so this one is never rendered.
    { field: 'status', value: 'closed', summary: 'Never shown' },
    { field: 'status', value: 'open', summary: 'Case reopened — {subject}' },
  ],
};

describe('collectExpectedEntries — an activity milestone\'s summary (#37524)', () => {
  const entries = collectExpectedEntries({ objects: [CASE] }, { warnedGroups: new Set() });
  const milestoneEntries = entries.filter((e) => e.path[2] === '_milestones');

  it('emits one key per fired pair, seeded with the authored template, tokens and all', () => {
    expect(milestoneEntries.map((e) => [e.path, e.sourceValue])).toEqual([
      [['objects', 'crm_case', '_milestones', 'status', 'closed', 'summary'], 'Case closed — {subject}'],
      [['objects', 'crm_case', '_milestones', 'status', 'open', 'summary'], 'Case reopened — {subject}'],
    ]);
    expect(milestoneEntries.every((e) => e.source === 'object' && e.objectName === 'crm_case')).toBe(true);
  });
});

describe('validateTranslationReferences — _milestones (#37524)', () => {
  const stackWith = (milestones: Record<string, unknown>) => ({
    objects: [CASE],
    translations: [{ 'zh-CN': { objects: { crm_case: { _milestones: milestones } } } }],
  });

  it('resolves a key over each declared pair', () => {
    expect(validateTranslationReferences(stackWith({
      status: { closed: { summary: '工单已关闭 — {subject}' }, open: { summary: '工单已重开 — {subject}' } },
    }))).toEqual([]);
  });

  it('flags a value no milestone of the field fires on, and a field no milestone watches', () => {
    const findings = validateTranslationReferences(stackWith({
      status: { close: { summary: '已关闭' } },
      priority: { high: { summary: '高' } },
    }));
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [TRANSLATION_TARGET_UNKNOWN, 'error', 'translations[0]["zh-CN"].objects.crm_case._milestones.status.close'],
      [TRANSLATION_TARGET_UNKNOWN, 'error', 'translations[0]["zh-CN"].objects.crm_case._milestones.priority.high'],
    ]);
    // A misspelt value is pointed at the declared one it nearly names.
    expect(findings[0].message).toContain('"closed"');
    for (const f of findings) {
      expect(f.message.length, f.message).toBeLessThanOrEqual(200);
      expect(f.hint.length, f.hint).toBeLessThanOrEqual(200);
    }
  });
});
