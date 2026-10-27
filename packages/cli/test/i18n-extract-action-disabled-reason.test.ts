// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#26619 — the extractor half of `action.disabledReason`.
//
// The ruling puts the reason's translation slot under
// `objects.OBJECT._actions.ACTION` beside `confirmText` / `successMessage`, so
// `os i18n extract` must scaffold it; without that a zh-CN workspace shows an
// English reason on a Chinese button with no diagnostic. The last test walks
// ONE fixture action through all three surfaces — `ActionSchema` accepts it,
// the extractor emits its key, the translation schema accepts the bundle
// written at that key — because each half passing alone does not prove the
// addresses agree.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { ActionSchema } from '@objectstack/spec/ui';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';

const paths = (config: any) => collectExpectedEntries(config).map((e) => e.path.join('.'));

const REASON = 'An approved legal review is required first.';

describe('the extractor emits action-level `disabledReason` (#26619)', () => {
  it('emits it for a TOP-LEVEL object action that declares one', () => {
    const keys = paths({
      actions: [{ name: 'submit_for_approval', objectName: 'clm_contract', label: 'Submit', disabledReason: REASON }],
    });

    expect(keys).toContain('objects.clm_contract._actions.submit_for_approval.disabledReason');
  });

  it('emits it for a GLOBAL action that declares one', () => {
    const keys = paths({
      actions: [{ name: 'leave_organization', label: 'Leave', disabledReason: 'You are the sole owner.' }],
    });

    expect(keys).toContain('globalActions.leave_organization.disabledReason');
  });

  it('emits it for an action declared INLINE on the object', () => {
    const keys = paths({
      objects: [
        {
          name: 'clm_contract',
          label: 'Contract',
          actions: [{ name: 'submit_for_approval', label: 'Submit', disabledReason: REASON }],
        },
      ],
    });

    expect(keys).toContain('objects.clm_contract._actions.submit_for_approval.disabledReason');
  });

  it('seeds NOTHING for an action that declares none — the console has its own default reason', () => {
    // Same shape as an undeclared `description`: `pushOptional` records a
    // seed-less path, and nothing is gated as a translation gap.
    const config = {
      objects: [{ name: 'clm_contract', label: 'Contract', actions: [{ name: 'archive', label: 'Archive' }] }],
    };
    const entries = collectExpectedEntries(config);
    const root = 'objects.clm_contract._actions.archive';
    const at = (key: string) => entries.find((e) => e.path.join('.') === key);

    expect(at(`${root}.disabledReason`)?.inline).toBeUndefined();
    expect(at(`${root}.disabledReason`)?.sourceValue).toBeUndefined();

    const { bundles } = extractTranslations(config, { defaultLocale: 'en', fill: 'default' });
    expect(bundles.en.objects.clm_contract._actions.archive).not.toHaveProperty('disabledReason');
    expect(computeI18nCoverage({ ...config, translations: [{ 'zh-CN': {} }] }).issues.map((i) => i.key))
      .not.toContain(`${root}.disabledReason`);
  });

  it('carries the declared text into the bundle, and gates it until it is translated', () => {
    const config: any = {
      objects: [
        {
          name: 'clm_contract',
          label: 'Contract',
          actions: [{ name: 'submit_for_approval', label: 'Submit', disabledReason: REASON }],
        },
      ],
      translations: [
        { 'zh-CN': { objects: { clm_contract: { label: '合同', _actions: { submit_for_approval: { label: '送审' } } } } } },
      ],
    };
    const key = 'objects.clm_contract._actions.submit_for_approval.disabledReason';

    const entry = collectExpectedEntries(config).find((e) => e.path.join('.') === key);
    expect(entry?.source).toBe('action');
    expect(entry?.inline).toBe(REASON);

    const { bundles } = extractTranslations(config, { defaultLocale: 'en', fill: 'default' });
    expect(bundles.en.objects.clm_contract._actions.submit_for_approval.disabledReason).toBe(REASON);

    expect(computeI18nCoverage(config).issues.map((i) => i.key)).toContain(key);
    config.translations[0]['zh-CN'].objects.clm_contract._actions.submit_for_approval.disabledReason =
      '需要一条通过的法务审查后才能送审。';
    expect(computeI18nCoverage(config).issues.filter((i) => i.source !== 'metadataForm')).toEqual([]);
  });
});

describe('one fixture action, all three surfaces (#26619 end-to-end)', () => {
  const authored = {
    name: 'submit_for_approval',
    objectName: 'clm_contract',
    label: 'Submit for approval',
    target: 'submitForApproval',
    disabled: "record.legal_review_status != 'approved'",
    disabledReason: REASON,
  };

  it('parses as metadata, extracts to a key, and that key round-trips a bundle', () => {
    const parsed = ActionSchema.safeParse(authored);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.disabledReason).toBe(REASON);

    const { bundles } = extractTranslations({ actions: [authored] }, {
      defaultLocale: 'en',
      locales: ['zh-CN'],
      fill: 'empty',
    });
    const bundle: any = bundles['zh-CN'];
    expect(bundle.objects.clm_contract._actions.submit_for_approval).toHaveProperty('disabledReason');

    bundle.objects.clm_contract._actions.submit_for_approval.disabledReason = '需要一条通过的法务审查后才能送审。';
    const translated = ObjectTranslationDataSchema.safeParse(bundle.objects.clm_contract);
    expect(translated.success).toBe(true);
    expect(translated.success && translated.data._actions?.submit_for_approval?.disabledReason)
      .toBe('需要一条通过的法务审查后才能送审。');

    expect(paths({ actions: [authored] })).toContain('objects.clm_contract._actions.submit_for_approval.disabledReason');
  });
});
