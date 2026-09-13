// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  resolvePackageL10n,
  resolvePackageL10nField,
  resolveScreenshotCaptions,
} from './package-l10n';
import { PackageTranslationSchema, PackageTranslationsSchema } from './package.zod';

describe('PackageTranslationSchema', () => {
  it('accepts a partial override', () => {
    expect(() => PackageTranslationSchema.parse({ displayName: '客户管理' })).not.toThrow();
  });

  it('accepts screenshot captions keyed by index', () => {
    expect(() => PackageTranslationSchema.parse({
      screenshotCaptions: { '0': 'Dashboard', '1': 'Inbox' },
    })).not.toThrow();
  });

  it('rejects displayName over 128 chars', () => {
    expect(() => PackageTranslationSchema.parse({ displayName: 'a'.repeat(129) })).toThrow();
  });
});

describe('PackageTranslationsSchema', () => {
  it('accepts BCP-47 locale tags', () => {
    const value = {
      en: { displayName: 'CRM' },
      'zh-CN': { displayName: '客户管理' },
      ja: { displayName: 'CRM' },
    };
    expect(() => PackageTranslationsSchema.parse(value)).not.toThrow();
  });

  it('rejects malformed locale tags', () => {
    expect(() => PackageTranslationsSchema.parse({ EN: { displayName: 'x' } })).toThrow();
    expect(() => PackageTranslationsSchema.parse({ 'zh_CN': { displayName: 'x' } })).toThrow();
  });
});

describe('resolvePackageL10nField', () => {
  const pkg = {
    display_name: 'Customer Management',
    description: 'Manage customers',
    translations: {
      zh: { displayName: '客户管理', description: '管理你的客户' },
      'zh-CN': { displayName: '客户管理（简体）' },
      ja: { displayName: '顧客管理' },
    },
  };

  it('returns the exact-locale match first', () => {
    expect(resolvePackageL10nField(pkg, 'displayName', { locale: 'zh-CN' }))
      .toBe('客户管理（简体）');
  });

  it('falls back to language-only when region missing', () => {
    expect(resolvePackageL10nField(pkg, 'displayName', { locale: 'zh-TW' }))
      .toBe('客户管理');
  });

  it('falls back to fallbackLocale before the base column', () => {
    expect(resolvePackageL10nField({
      display_name: 'Base',
      translations: { en: { displayName: 'English' } },
    }, 'displayName', { locale: 'ko' })).toBe('English');
  });

  it('falls back to base snake_case column when no translation matches', () => {
    expect(resolvePackageL10nField(pkg, 'displayName', { locale: 'ko' }))
      .toBe('Customer Management');
  });

  it('falls back to base camelCase column too', () => {
    expect(resolvePackageL10nField({ displayName: 'Inline' }, 'displayName', { locale: 'ko' }))
      .toBe('Inline');
  });

  it('returns undefined when neither translation nor base is set', () => {
    expect(resolvePackageL10nField({}, 'displayName', { locale: 'en' })).toBeUndefined();
  });

  it('honours a custom fallbackLocale', () => {
    expect(resolvePackageL10nField(pkg, 'displayName', { locale: 'ko', fallbackLocale: 'ja' }))
      .toBe('顧客管理');
  });
});

describe('resolvePackageL10n', () => {
  it('resolves every translatable field', () => {
    const result = resolvePackageL10n({
      display_name: 'CRM',
      description: 'Manage customers',
      readme: '# CRM',
      translations: {
        zh: { displayName: '客户管理', description: '管理客户', readme: '# 客户管理', tagline: '简单 CRM' },
      },
    }, { locale: 'zh' });

    expect(result).toMatchObject({
      displayName: '客户管理',
      description: '管理客户',
      readme: '# 客户管理',
      tagline: '简单 CRM',
    });
  });
});

describe('resolveScreenshotCaptions', () => {
  it('merges fallback then language then exact locale', () => {
    const captions = resolveScreenshotCaptions({
      translations: {
        en: { screenshotCaptions: { '0': 'Dashboard', '1': 'Inbox', '2': 'Settings' } },
        zh: { screenshotCaptions: { '0': '仪表盘', '1': '收件箱' } },
        'zh-CN': { screenshotCaptions: { '0': '仪表板' } },
      },
    }, { locale: 'zh-CN' });

    expect(captions).toEqual({
      '0': '仪表板',   // zh-CN wins
      '1': '收件箱',   // zh fills in
      '2': 'Settings', // en fallback fills in
    });
  });

  it('returns undefined when no translation has captions', () => {
    expect(resolveScreenshotCaptions({ translations: { en: { displayName: 'x' } } }, { locale: 'zh' }))
      .toBeUndefined();
  });
});
