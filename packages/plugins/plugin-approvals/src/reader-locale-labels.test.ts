// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24863] The pick `reader-locale-labels.ts` makes, in isolation.
 *
 *  - The keys: each one the reader asks is an address the translation contract
 *    DECLARES. Every key is turned back into the nested bundle shape a pack
 *    carries and parsed by `TranslationDataSchema`, so a spelling the `flows`
 *    face does not declare is red here, not silently a miss at read time. A
 *    control proves the round trip can fail.
 *  - The pick: the reader's locale is negotiated against the service's locales
 *    (`resolveBundleLocale`), a miss (the echoed key, an empty or blank entry)
 *    or a throwing service picks nothing, and a read with no locale or no
 *    service picks nothing at all.
 *  - The overlay: the step is served under two names that move together, and a
 *    label nothing is picked for keeps the row's own value.
 *
 * The i18n service is the REAL in-memory implementation (`createMemoryI18n`,
 * `@objectstack/core`), loaded the way `AppPlugin` loads a stack's packs.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { TranslationDataSchema, objectLabelKey } from '@objectstack/spec/system';

import {
  approvalStepLabelKey,
  flowLabelKey,
  flowNameOfProcess,
  localizeRequestLabels,
  readerLabelsFor,
  type ReaderLabelI18n,
} from './reader-locale-labels.js';

/** A dot-notation key and its value, as the nested object a language pack carries. */
function packOf(entries: Record<string, string>): Record<string, unknown> {
  const pack: Record<string, any> = {};
  for (const [key, value] of Object.entries(entries)) {
    const parts = key.split('.');
    let at = pack;
    for (const part of parts.slice(0, -1)) at = (at[part] ??= {});
    at[parts[parts.length - 1]] = value;
  }
  return pack;
}

function i18nWith(packs: Record<string, Record<string, string>>) {
  const i18n = createMemoryI18n();
  for (const [locale, entries] of Object.entries(packs)) i18n.loadTranslations(locale, packOf(entries));
  return i18n;
}

const ZH = {
  [flowLabelKey('account_approval')]: '客户审批',
  [approvalStepLabelKey('account_approval', 'manager_review')]: '经理审核',
  [objectLabelKey('account')]: '客户',
};

describe('[#24863] every key the reader asks is one the translation contract declares', () => {
  it('spells the flow label, the approval step label and the object label', () => {
    expect(flowLabelKey('account_approval')).toBe('flows.account_approval.label');
    expect(approvalStepLabelKey('account_approval', 'manager_review'))
      .toBe('flows.account_approval.approvals.manager_review.label');
    expect(objectLabelKey('account')).toBe('objects.account.label');
  });

  it('a pack holding exactly those keys parses, and keeps each value at its address', () => {
    const result = TranslationDataSchema.safeParse(packOf(ZH)) as { success: boolean; data?: any; error?: unknown };
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    expect(result.data.flows.account_approval.label).toBe('客户审批');
    expect(result.data.flows.account_approval.approvals.manager_review.label).toBe('经理审核');
    expect(result.data.objects.account.label).toBe('客户');
  });

  it('control: the same round trip refuses a step key the face does not declare', () => {
    const result = TranslationDataSchema.safeParse(packOf({ 'flows.account_approval.approvals.manager_review.heading': 'x' }));
    expect(result.success).toBe(false);
  });
});

describe('[#24863] the flow a process name names', () => {
  it('is the name after the `flow:` prefix', () => {
    expect(flowNameOfProcess('flow:account_approval')).toBe('account_approval');
  });

  it('is none for a name without the prefix, or with nothing after it', () => {
    expect(flowNameOfProcess('account_approval')).toBeUndefined();
    expect(flowNameOfProcess('flow:')).toBeUndefined();
    expect(flowNameOfProcess(undefined)).toBeUndefined();
  });
});

describe('[#24863] the pick', () => {
  it('reads the reader\'s locale, negotiated: a bare `zh` reaches the `zh-CN` pack', () => {
    const i18n = i18nWith({ 'zh-CN': ZH });
    for (const locale of ['zh-CN', 'zh']) {
      const labels = readerLabelsFor(i18n, locale)!;
      expect(labels.flowLabel('account_approval')).toBe('客户审批');
      expect(labels.stepLabel('account_approval', 'manager_review')).toBe('经理审核');
      expect(labels.objectLabel('account')).toBe('客户');
    }
  });

  it('negotiates through `resolveBundleLocale` even for a service that resolves exactly', () => {
    // A service that answers only the exact tag it holds, as `FileI18nAdapter` does.
    const exact: ReaderLabelI18n = {
      t: (key, locale) => (locale === 'zh-CN' && key === flowLabelKey('f') ? '流程' : key),
      getLocales: () => ['en', 'zh-CN'],
    };
    expect(readerLabelsFor(exact, 'zh')!.flowLabel('f')).toBe('流程');
  });

  it('picks nothing on a miss: no entry, an empty entry, a blank entry', () => {
    const i18n = i18nWith({ 'zh-CN': { [flowLabelKey('empty')]: '', [flowLabelKey('blank')]: '  ' } });
    const labels = readerLabelsFor(i18n, 'zh-CN')!;
    expect(labels.flowLabel('account_approval')).toBeUndefined();
    expect(labels.flowLabel('empty')).toBeUndefined();
    expect(labels.flowLabel('blank')).toBeUndefined();
  });

  it('picks nothing for a locale no pack holds', () => {
    expect(readerLabelsFor(i18nWith({ 'zh-CN': ZH }), 'ja-JP')!.flowLabel('account_approval')).toBeUndefined();
  });

  it('picks nothing from a service that throws, and does not throw itself', () => {
    const throwing: ReaderLabelI18n = {
      t: () => { throw new Error('i18n exploded'); },
      getLocales: () => { throw new Error('locales exploded'); },
    };
    expect(readerLabelsFor(throwing, 'zh-CN')!.flowLabel('account_approval')).toBeUndefined();
  });

  it('is no pick at all for a read with no locale, or with no service', () => {
    expect(readerLabelsFor(i18nWith({ 'zh-CN': ZH }), undefined)).toBeUndefined();
    expect(readerLabelsFor(i18nWith({ 'zh-CN': ZH }), '')).toBeUndefined();
    expect(readerLabelsFor(undefined, 'zh-CN')).toBeUndefined();
  });

  it('asks the service once per key per read', () => {
    const asked: string[] = [];
    const counting: ReaderLabelI18n = { t: (key) => { asked.push(key); return key; } };
    const labels = readerLabelsFor(counting, 'zh-CN')!;
    labels.flowLabel('f');
    labels.flowLabel('f');
    expect(asked).toEqual([flowLabelKey('f')]);
  });
});

describe('[#24863] the overlay on a served row', () => {
  const served = () => ({
    process_name: 'flow:account_approval',
    current_step: 'manager_review',
    object_name: 'account',
    process_label: 'Account Approval',
    step_label: 'Manager Review',
    current_step_label: 'Manager Review',
    object_label: 'Account',
  });

  it('moves the flow label, both names of the step label, and the object label', () => {
    const row = served();
    localizeRequestLabels(row, readerLabelsFor(i18nWith({ 'zh-CN': ZH }), 'zh-CN')!);
    expect(row).toMatchObject({
      process_label: '客户审批', step_label: '经理审核', current_step_label: '经理审核', object_label: '客户',
    });
  });

  it('keeps each label nothing is picked for', () => {
    const row = served();
    localizeRequestLabels(row, readerLabelsFor(i18nWith({ 'zh-CN': { [flowLabelKey('account_approval')]: '客户审批' } }), 'zh-CN')!);
    expect(row).toMatchObject({
      process_label: '客户审批', step_label: 'Manager Review', current_step_label: 'Manager Review', object_label: 'Account',
    });
  });

  it('reads no flow key for a process name that names no flow', () => {
    const row = { ...served(), process_name: 'account_approval' };
    localizeRequestLabels(row, readerLabelsFor(i18nWith({ 'zh-CN': ZH }), 'zh-CN')!);
    expect(row).toMatchObject({ process_label: 'Account Approval', step_label: 'Manager Review', object_label: '客户' });
  });
});
