/**
 * objectstack#35513 — `useObjectLabel().packageName` / `packageDescription`,
 * a package's name in the reader's language.
 *
 * The served translation document carries `packages.MANIFEST_ID.name`, and
 * `transformSpecTranslations` copies the group onto the `app` namespace. A
 * manifest id is reverse-domain (`com.hotcrm.revenue`), so a dot-separated
 * `t()` key path would split it into segments and never match: these cases
 * pin that the lookup reads the dotted id as ONE key, and that a miss falls
 * back to the manifest's own name, then to the id.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '../provider';
import { useObjectLabel } from '../useObjectLabel';
import { transformSpecTranslations } from '../utils/spec-translations';

function wrapperFor(language: 'en' | 'zh-CN') {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(I18nProvider, {
      config: { defaultLanguage: language, detectBrowserLanguage: false },
      persistLanguage: false,
      children,
    });
}

function hookIn(language: 'en' | 'zh-CN', served?: Record<string, unknown>) {
  const { result } = renderHook(
    () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
    { wrapper: wrapperFor(language) },
  );
  if (served) {
    result.current.i18n.addResourceBundle(language, 'translation', transformSpecTranslations(served), true, true);
  }
  return result;
}

const REVENUE = { id: 'com.hotcrm.revenue', name: 'HotCRM Revenue', description: 'Quotes, contracts and collections' };

describe('useObjectLabel().packageName (objectstack#35513)', () => {
  it('zh-CN: the served translation names the package, read by its dotted manifest id', () => {
    const result = hookIn('zh-CN', {
      packages: { 'com.hotcrm.revenue': { name: '回款', description: '报价、合同与回款' } },
    });
    expect(result.current.labels.packageName(REVENUE)).toBe('回款');
    expect(result.current.labels.packageDescription(REVENUE)).toBe('报价、合同与回款');
  });

  it('a package the bundle does not name keeps its manifest name, then its id', () => {
    const result = hookIn('zh-CN', {
      packages: { 'com.hotcrm.revenue': { name: '回款' } },
    });
    expect(result.current.labels.packageName({ id: 'com.hotcrm.service', name: 'HotCRM Service' })).toBe('HotCRM Service');
    expect(result.current.labels.packageName({ id: 'com.hotcrm.service' })).toBe('com.hotcrm.service');
    // A translated name with no translated description keeps the manifest's.
    expect(result.current.labels.packageDescription(REVENUE)).toBe(REVENUE.description);
    expect(result.current.labels.packageDescription({ id: 'com.hotcrm.revenue' })).toBeUndefined();
  });

  it('does not match a row keyed by one segment of the id', () => {
    // A bundle that nested the id (`com: { hotcrm: { revenue: … } }`) is the
    // shape a `t('packages.com.hotcrm.revenue.name')` lookup would have read.
    const result = hookIn('zh-CN', {
      packages: { com: { hotcrm: { revenue: { name: '错的' } } } },
    });
    expect(result.current.labels.packageName(REVENUE)).toBe('HotCRM Revenue');
  });

  it('en with no bundle: the manifest name', () => {
    const result = hookIn('en');
    expect(result.current.labels.packageName(REVENUE)).toBe('HotCRM Revenue');
  });
});
