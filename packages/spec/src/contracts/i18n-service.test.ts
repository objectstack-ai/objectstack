import { describe, it, expect } from 'vitest';
import type { II18nService } from './i18n-service';
import type { TranslationCoverageResult, TranslationDiffItem } from '../system/translation.zod';

describe('I18n Service Contract', () => {
  it('should allow a minimal II18nService implementation with required methods', () => {
    const service: II18nService = {
      t: (_key, _locale, _params?) => '',
      getTranslations: (_locale) => ({}),
      loadTranslations: (_locale, _translations) => {},
      getLocales: () => [],
    };

    expect(typeof service.t).toBe('function');
    expect(typeof service.getTranslations).toBe('function');
    expect(typeof service.loadTranslations).toBe('function');
    expect(typeof service.getLocales).toBe('function');
  });

  it('should allow a full implementation with optional methods', () => {
    const service: II18nService = {
      t: () => '',
      getTranslations: () => ({}),
      loadTranslations: () => {},
      getLocales: () => [],
      getDefaultLocale: () => 'en',
      setDefaultLocale: (_locale) => {},
    };

    expect(service.getDefaultLocale).toBeDefined();
    expect(service.setDefaultLocale).toBeDefined();
  });

  it('should translate a key', () => {
    const translations = new Map<string, Record<string, unknown>>();
    translations.set('en', { 'objects.account.label': 'Account' });
    translations.set('zh-CN', { 'objects.account.label': '客户' });

    const service: II18nService = {
      t: (key, locale) => {
        const bundle = translations.get(locale);
        return (bundle?.[key] as string) ?? key;
      },
      getTranslations: (locale) => translations.get(locale) ?? {},
      loadTranslations: (locale, data) => { translations.set(locale, data); },
      getLocales: () => Array.from(translations.keys()),
    };

    expect(service.t('objects.account.label', 'en')).toBe('Account');
    expect(service.t('objects.account.label', 'zh-CN')).toBe('客户');
    expect(service.t('missing.key', 'en')).toBe('missing.key');
  });

  it('should load and retrieve translations', () => {
    const store = new Map<string, Record<string, unknown>>();

    const service: II18nService = {
      t: (key, locale) => {
        const bundle = store.get(locale);
        return (bundle?.[key] as string) ?? key;
      },
      getTranslations: (locale) => store.get(locale) ?? {},
      loadTranslations: (locale, data) => { store.set(locale, data); },
      getLocales: () => Array.from(store.keys()),
    };

    service.loadTranslations('ja', { greeting: 'こんにちは' });
    expect(service.getLocales()).toContain('ja');
    expect(service.getTranslations('ja')).toEqual({ greeting: 'こんにちは' });
    expect(service.t('greeting', 'ja')).toBe('こんにちは');
  });

  it('should manage default locale', () => {
    let defaultLocale = 'en';

    const service: II18nService = {
      t: () => '',
      getTranslations: () => ({}),
      loadTranslations: () => {},
      getLocales: () => ['en', 'zh-CN', 'ja'],
      getDefaultLocale: () => defaultLocale,
      setDefaultLocale: (locale) => { defaultLocale = locale; },
    };

    expect(service.getDefaultLocale!()).toBe('en');
    service.setDefaultLocale!('zh-CN');
    expect(service.getDefaultLocale!()).toBe('zh-CN');
  });

  it('should allow implementation with getCoverage', () => {
    const service: II18nService = {
      t: () => '',
      getTranslations: () => ({}),
      loadTranslations: () => {},
      getLocales: () => ['en', 'zh-CN'],
      getCoverage: (locale, objectName?) => {
        const result: TranslationCoverageResult = {
          locale,
          objectName,
          totalKeys: 50,
          translatedKeys: 45,
          missingKeys: 5,
          redundantKeys: 0,
          staleKeys: 0,
          coveragePercent: 90,
          items: [
            { key: 'objects.account.fields.website.label', status: 'missing', objectName: 'account', locale },
          ],
        };
        return result;
      },
    };

    const coverage = service.getCoverage!('zh-CN', 'account');
    expect(coverage.locale).toBe('zh-CN');
    expect(coverage.objectName).toBe('account');
    expect(coverage.coveragePercent).toBe(90);
    expect(coverage.missingKeys).toBe(5);
    expect(coverage.items).toHaveLength(1);
    expect(coverage.items[0].status).toBe('missing');
  });

  it('should keep backward compatibility — new methods are optional', () => {
    const minimalService: II18nService = {
      t: (_key, _locale) => '',
      getTranslations: (_locale) => ({}),
      loadTranslations: (_locale, _translations) => {},
      getLocales: () => [],
    };

    expect(minimalService.getCoverage).toBeUndefined();
    expect(minimalService.suggestTranslations).toBeUndefined();
  });

  it('should allow implementation with suggestTranslations', async () => {
    const service: II18nService = {
      t: () => '',
      getTranslations: () => ({}),
      loadTranslations: () => {},
      getLocales: () => ['en', 'zh-CN'],
      suggestTranslations: async (_locale, items) => {
        return items.map(item => ({
          ...item,
          aiSuggested: `AI翻译: ${item.key}`,
          aiConfidence: 0.85,
        }));
      },
    };

    const items: TranslationDiffItem[] = [
      { key: 'objects.account.fields.website.label', status: 'missing', locale: 'zh-CN' },
    ];
    const suggestions = await service.suggestTranslations!('zh-CN', items);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].aiSuggested).toBe('AI翻译: objects.account.fields.website.label');
    expect(suggestions[0].aiConfidence).toBe(0.85);
  });
});
