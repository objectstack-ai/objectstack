// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The extractor half of `action.cancelText`, the label of the dismiss button on
// the dialog an action opens before it runs.
//
// `translateAction` overlays `objects.OBJECT._actions.ACTION.cancelText`
// (`globalActions.ACTION.cancelText` for an object-less action) only onto an
// action that opens one of the two dialogs carrying that button: the confirm
// dialog of a declared `confirmText`, or the param dialog of a non-empty
// `params`. `os i18n extract` scaffolds the slot on exactly that population:
// there it is an optional slot like `submitText`, and anywhere else there is no
// slot at all. The last test walks ONE fixture action through all three
// surfaces — `ActionSchema` accepts it, the extractor emits its key, the
// translation schema accepts the bundle written at that key — because each half
// passing alone does not prove the addresses agree.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { ActionSchema } from '@objectstack/spec/ui';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';

const paths = (config: any) => collectExpectedEntries(config).map((e) => e.path.join('.'));

const PARAMS = [{ name: 'reason', label: 'Reason', type: 'text' }];

describe('the extractor emits action-level `cancelText` beside `confirmText` or a non-empty `params`', () => {
  it('emits it for a TOP-LEVEL object action with a confirm dialog', () => {
    const keys = paths({
      actions: [{
        name: 'cancel_invitation', objectName: 'sys_invitation', label: 'Cancel Invitation',
        confirmText: 'Cancel this invitation?', cancelText: 'Keep invitation',
      }],
    });

    expect(keys).toContain('objects.sys_invitation._actions.cancel_invitation.cancelText');
  });

  it('emits it for a GLOBAL action with a param dialog', () => {
    const keys = paths({
      actions: [{ name: 'close_period', label: 'Close Period', params: PARAMS, cancelText: 'Keep open' }],
    });

    expect(keys).toContain('globalActions.close_period.cancelText');
  });

  it('emits it for an action declared INLINE on the object', () => {
    const keys = paths({
      objects: [
        {
          name: 'sys_invitation',
          label: 'Invitation',
          actions: [{ name: 'cancel_invitation', label: 'Cancel Invitation', confirmText: 'Sure?', cancelText: 'Keep invitation' }],
        },
      ],
    });

    expect(keys).toContain('objects.sys_invitation._actions.cancel_invitation.cancelText');
  });

  it('records a seed-less slot for a dialog action that names no label — the dialog keeps "Cancel"', () => {
    const config = {
      objects: [{ name: 'sys_invitation', label: 'Invitation', actions: [{ name: 'resend', label: 'Resend', confirmText: 'Resend it?' }] }],
    };
    const key = 'objects.sys_invitation._actions.resend.cancelText';
    const entry = collectExpectedEntries(config).find((e) => e.path.join('.') === key);

    expect(entry).toBeDefined();
    expect(entry?.inline).toBeUndefined();
    expect(entry?.sourceValue).toBeUndefined();

    const { bundles } = extractTranslations(config, { defaultLocale: 'en', fill: 'default' });
    expect(bundles.en.objects?.sys_invitation?._actions?.resend).not.toHaveProperty('cancelText');
    expect(computeI18nCoverage({ ...config, translations: [{ 'zh-CN': {} }] }).issues.map((i) => i.key))
      .not.toContain(key);
  });

  it('emits NO slot for an action that opens no dialog — neither `confirmText` nor a non-empty `params`', () => {
    for (const params of [undefined, []]) {
      const keys = paths({
        objects: [
          {
            name: 'sys_invitation',
            label: 'Invitation',
            actions: [{ name: 'archive', label: 'Archive', ...(params ? { params } : {}) }],
          },
        ],
        actions: [{ name: 'refresh_all', label: 'Refresh', ...(params ? { params } : {}) }],
      });

      expect(keys).toContain('objects.sys_invitation._actions.archive.label');
      expect(keys).not.toContain('objects.sys_invitation._actions.archive.cancelText');
      expect(keys).toContain('globalActions.refresh_all.label');
      expect(keys).not.toContain('globalActions.refresh_all.cancelText');
    }
  });

  it('carries the declared label into the bundle, and gates it until it is translated', () => {
    const config: any = {
      objects: [
        {
          name: 'sys_invitation',
          label: 'Invitation',
          actions: [{ name: 'cancel_invitation', label: 'Cancel Invitation', confirmText: 'Sure?', cancelText: 'Keep invitation' }],
        },
      ],
      translations: [
        { 'zh-CN': { objects: { sys_invitation: { label: '邀请', _actions: { cancel_invitation: { label: '取消邀请', confirmText: '确定？' } } } } } },
      ],
    };
    const key = 'objects.sys_invitation._actions.cancel_invitation.cancelText';

    const entry = collectExpectedEntries(config).find((e) => e.path.join('.') === key);
    expect(entry?.source).toBe('action');
    expect(entry?.inline).toBe('Keep invitation');

    const { bundles } = extractTranslations(config, { defaultLocale: 'en', fill: 'default' });
    expect(bundles.en.objects?.sys_invitation?._actions?.cancel_invitation.cancelText).toBe('Keep invitation');

    expect(computeI18nCoverage(config).issues.map((i) => i.key)).toContain(key);
    config.translations[0]['zh-CN'].objects.sys_invitation._actions.cancel_invitation.cancelText = '保留邀请';
    expect(computeI18nCoverage(config).issues.map((i) => i.key)).not.toContain(key);
  });
});

describe('one fixture action, all three surfaces (cancelText end-to-end)', () => {
  const authored = {
    name: 'cancel_invitation',
    objectName: 'sys_invitation',
    label: 'Cancel Invitation',
    type: 'script',
    target: 'cancelInvitation',
    confirmText: 'Cancel this invitation?',
    cancelText: 'Keep invitation',
  };

  it('parses as metadata, extracts to a key, and that key round-trips a bundle', () => {
    const parsed = ActionSchema.safeParse(authored);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.cancelText).toBe('Keep invitation');

    const { bundles } = extractTranslations({ actions: [authored] }, {
      defaultLocale: 'en',
      locales: ['zh-CN'],
      fill: 'empty',
    });
    const bundle: any = bundles['zh-CN'];
    expect(bundle.objects.sys_invitation._actions.cancel_invitation).toHaveProperty('cancelText');

    bundle.objects.sys_invitation._actions.cancel_invitation.cancelText = '保留邀请';
    const translated = ObjectTranslationDataSchema.safeParse(bundle.objects.sys_invitation);
    expect(translated.success).toBe(true);
    expect(translated.success && translated.data._actions?.cancel_invitation?.cancelText).toBe('保留邀请');
  });
});
