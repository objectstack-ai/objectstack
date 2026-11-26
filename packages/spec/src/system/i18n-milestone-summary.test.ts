// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `objects.<object>._milestones.<field>.<value>.summary`: the template an
// activity milestone's timeline row is composed from in the reader's language.

import { describe, it, expect } from 'vitest';
import { ObjectTranslationDataSchema, type TranslationBundle } from './translation.zod';
import { resolveObjectMilestoneSummary, translateObject } from './i18n-resolver';

describe('resolveObjectMilestoneSummary — objects.<o>._milestones.<field>.<value>.summary (#37524)', () => {
  const bundle: TranslationBundle = {
    'zh-CN': {
      objects: {
        crm_case: { _milestones: { status: { closed: { summary: '工单已关闭：{subject}' }, 'v1.0': { summary: '版本 {subject}' } } } },
      },
    },
    en: { objects: { crm_case: { _milestones: { status: { escalated: { summary: 'Escalated: {subject}' } } } } } },
  };

  it('reads the template keyed by the watched field and the value, tokens untouched', () => {
    expect(resolveObjectMilestoneSummary(bundle, 'crm_case', 'status', 'closed', { locale: 'zh-CN' })).toBe('工单已关闭：{subject}');
  });

  it('indexes a dotted value as one key, never splitting it', () => {
    expect(resolveObjectMilestoneSummary(bundle, 'crm_case', 'status', 'v1.0', { locale: 'zh-CN' })).toBe('版本 {subject}');
  });

  it('walks the declared fallback chain, and answers undefined on a miss', () => {
    expect(resolveObjectMilestoneSummary(bundle, 'crm_case', 'status', 'escalated', { locale: 'zh-CN', fallbackChain: ['en'] })).toBe('Escalated: {subject}');
    expect(resolveObjectMilestoneSummary(bundle, 'crm_case', 'status', 'reopened', { locale: 'zh-CN' })).toBeUndefined();
    expect(resolveObjectMilestoneSummary(bundle, 'crm_case', 'priority', 'closed', { locale: 'zh-CN' })).toBeUndefined();
    expect(resolveObjectMilestoneSummary(undefined, 'crm_case', 'status', 'closed', { locale: 'zh-CN' })).toBeUndefined();
  });

  it('the object translation schema accepts the group, and translateObject leaves the authored summary on the served object', () => {
    expect(ObjectTranslationDataSchema.safeParse({ _milestones: { status: { closed: { summary: '已关闭' } } } }).success).toBe(true);
    expect(ObjectTranslationDataSchema.safeParse({ _milestones: { status: { closed: { label: '已关闭' } } } }).success).toBe(false);
    const served = translateObject(
      { name: 'crm_case', activityMilestones: [{ field: 'status', value: 'closed', summary: 'Case closed: {subject}' }] } as any,
      bundle,
      { locale: 'zh-CN' },
    ) as any;
    expect(served.activityMilestones[0].summary).toBe('Case closed: {subject}');
  });
});
