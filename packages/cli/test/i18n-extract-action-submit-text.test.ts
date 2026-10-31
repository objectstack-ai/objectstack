// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The extractor half of `action.submitText`, the verb on the submit button of
// the dialog an action opens to collect its `params`.
//
// `translateAction` overlays `objects.OBJECT._actions.ACTION.submitText`
// (`globalActions.ACTION.submitText` for an object-less action) only onto an
// action with a non-empty `params`, because no other action opens that dialog.
// `os i18n extract` scaffolds the slot on exactly that population: beside a
// non-empty `params` it is an optional slot like `description`, and anywhere
// else there is no slot at all. The last test walks ONE fixture action through
// all three surfaces — `ActionSchema` accepts it, the extractor emits its key,
// the translation schema accepts the bundle written at that key — because each
// half passing alone does not prove the addresses agree.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { ActionSchema } from '@objectstack/spec/ui';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';

const paths = (config: any) => collectExpectedEntries(config).map((e) => e.path.join('.'));

const PARAMS = [{ name: 'subject', label: 'Subject', type: 'text' }];

describe('the extractor emits action-level `submitText` beside a non-empty `params`', () => {
  it('emits it for a TOP-LEVEL object action that declares one', () => {
    const keys = paths({
      actions: [{ name: 'send_email', objectName: 'crm_contact', label: 'Send Email', params: PARAMS, submitText: 'Send' }],
    });

    expect(keys).toContain('objects.crm_contact._actions.send_email.submitText');
  });

  it('emits it for a GLOBAL action that declares one', () => {
    const keys = paths({
      actions: [{ name: 'log_call', label: 'Log Call', params: PARAMS, submitText: 'Log Call' }],
    });

    expect(keys).toContain('globalActions.log_call.submitText');
  });

  it('emits it for an action declared INLINE on the object', () => {
    const keys = paths({
      objects: [
        {
          name: 'crm_contact',
          label: 'Contact',
          actions: [{ name: 'send_email', label: 'Send Email', params: PARAMS, submitText: 'Send' }],
        },
      ],
    });

    expect(keys).toContain('objects.crm_contact._actions.send_email.submitText');
  });

  it('records a seed-less slot for an action with params that names no verb — the dialog keeps "Confirm"', () => {
    const config = {
      objects: [{ name: 'crm_contact', label: 'Contact', actions: [{ name: 'send_email', label: 'Send Email', params: PARAMS }] }],
    };
    const key = 'objects.crm_contact._actions.send_email.submitText';
    const entry = collectExpectedEntries(config).find((e) => e.path.join('.') === key);

    expect(entry).toBeDefined();
    expect(entry?.inline).toBeUndefined();
    expect(entry?.sourceValue).toBeUndefined();

    const { bundles } = extractTranslations(config, { defaultLocale: 'en', fill: 'default' });
    expect(bundles.en.objects?.crm_contact?._actions?.send_email).not.toHaveProperty('submitText');
    expect(computeI18nCoverage({ ...config, translations: [{ 'zh-CN': {} }] }).issues.map((i) => i.key))
      .not.toContain(key);
  });

  it('emits NO slot for an action without params — no dialog opens, so there is no button to name', () => {
    for (const params of [undefined, []]) {
      const keys = paths({
        objects: [
          {
            name: 'crm_contact',
            label: 'Contact',
            actions: [{ name: 'archive', label: 'Archive', ...(params ? { params } : {}) }],
          },
        ],
        actions: [{ name: 'refresh_all', label: 'Refresh', ...(params ? { params } : {}) }],
      });

      expect(keys).toContain('objects.crm_contact._actions.archive.label');
      expect(keys).not.toContain('objects.crm_contact._actions.archive.submitText');
      expect(keys).toContain('globalActions.refresh_all.label');
      expect(keys).not.toContain('globalActions.refresh_all.submitText');
    }
  });

  it('carries the declared verb into the bundle, and gates it until it is translated', () => {
    const config: any = {
      objects: [
        {
          name: 'crm_contact',
          label: 'Contact',
          actions: [{ name: 'send_email', label: 'Send Email', params: PARAMS, submitText: 'Send' }],
        },
      ],
      translations: [
        { 'zh-CN': { objects: { crm_contact: { label: '联系人', _actions: { send_email: { label: '发送邮件', params: { subject: { label: '主题' } } } } } } } },
      ],
    };
    const key = 'objects.crm_contact._actions.send_email.submitText';

    const entry = collectExpectedEntries(config).find((e) => e.path.join('.') === key);
    expect(entry?.source).toBe('action');
    expect(entry?.inline).toBe('Send');

    const { bundles } = extractTranslations(config, { defaultLocale: 'en', fill: 'default' });
    expect(bundles.en.objects?.crm_contact?._actions?.send_email.submitText).toBe('Send');

    expect(computeI18nCoverage(config).issues.map((i) => i.key)).toContain(key);
    config.translations[0]['zh-CN'].objects.crm_contact._actions.send_email.submitText = '发送';
    expect(computeI18nCoverage(config).issues.map((i) => i.key)).not.toContain(key);
  });
});

describe('one fixture action, all three surfaces (submitText end-to-end)', () => {
  const authored = {
    name: 'send_email',
    objectName: 'crm_contact',
    label: 'Send Email',
    type: 'script',
    target: 'sendEmail',
    params: PARAMS,
    submitText: 'Send',
  };

  it('parses as metadata, extracts to a key, and that key round-trips a bundle', () => {
    const parsed = ActionSchema.safeParse(authored);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.submitText).toBe('Send');

    const { bundles } = extractTranslations({ actions: [authored] }, {
      defaultLocale: 'en',
      locales: ['zh-CN'],
      fill: 'empty',
    });
    const bundle: any = bundles['zh-CN'];
    expect(bundle.objects.crm_contact._actions.send_email).toHaveProperty('submitText');

    bundle.objects.crm_contact._actions.send_email.submitText = '发送';
    const translated = ObjectTranslationDataSchema.safeParse(bundle.objects.crm_contact);
    expect(translated.success).toBe(true);
    expect(translated.success && translated.data._actions?.send_email?.submitText).toBe('发送');
  });
});
