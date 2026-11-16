// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { readOrganizationLocaleSetting, resolveOrganizationLocale } from './organization-locale.js';

/** A settings door answering `localization.locale` with `answer`, recording the scope it was asked in. */
function settingsAnswering(answer: { value?: unknown; source?: string } | undefined) {
  return { get: vi.fn(async () => answer) };
}

const i18nDefault = (locale: unknown) => ({ getDefaultLocale: () => locale });

describe('resolveOrganizationLocale — the deployment-default ladder for text written on the organization\'s behalf', () => {
  it('rung 1: a Localization setting somebody set wins over the app default', async () => {
    const settings = settingsAnswering({ value: 'ja-JP', source: 'tenant' });
    expect(await resolveOrganizationLocale({ settings, i18n: i18nDefault('zh-CN'), organizationId: 'org_1' }))
      .toEqual({ locale: 'ja-JP', source: 'organization-setting' });
    expect(settings.get).toHaveBeenCalledWith('localization', 'locale', { tenantId: 'org_1' });
  });

  it('the manifest placeholder (`source: default`) is not a choice: the app default answers', async () => {
    const settings = settingsAnswering({ value: 'en-US', source: 'default' });
    expect(await resolveOrganizationLocale({ settings, i18n: i18nDefault('zh-CN') }))
      .toEqual({ locale: 'zh-CN', source: 'app-default' });
    // CONTROL: the same answer with any other source is the organization's.
    expect(await resolveOrganizationLocale({ settings: settingsAnswering({ value: 'en-US', source: 'global' }), i18n: i18nDefault('zh-CN') }))
      .toEqual({ locale: 'en-US', source: 'organization-setting' });
  });

  it('no settings service, no getDefaultLocale, a throwing one or a blank answer: nothing is guessed', async () => {
    expect(await resolveOrganizationLocale({})).toBeUndefined();
    expect(await resolveOrganizationLocale({ i18n: {} })).toBeUndefined();
    expect(await resolveOrganizationLocale({ i18n: { getDefaultLocale: () => { throw new Error('x'); } } })).toBeUndefined();
    expect(await resolveOrganizationLocale({ i18n: i18nDefault('  ') })).toBeUndefined();
    expect(await resolveOrganizationLocale({ settings: settingsAnswering(undefined), i18n: i18nDefault(' zh-CN ') }))
      .toEqual({ locale: 'zh-CN', source: 'app-default' });
  });

  it('a settings read that throws propagates — a failed read is not "not set"', async () => {
    const settings = { get: vi.fn(async () => { throw new Error('store down'); }) };
    await expect(resolveOrganizationLocale({ settings, i18n: i18nDefault('zh-CN') })).rejects.toThrow('store down');
  });

  it('readOrganizationLocaleSetting asks with no scope for a caller naming no organization', async () => {
    const settings = settingsAnswering({ value: ' fr-FR ', source: 'env' });
    expect(await readOrganizationLocaleSetting(settings, undefined)).toBe('fr-FR');
    expect(settings.get).toHaveBeenCalledWith('localization', 'locale', {});
    expect(await readOrganizationLocaleSetting({ get: 'not a function' }, 'org_1')).toBeUndefined();
  });
});
