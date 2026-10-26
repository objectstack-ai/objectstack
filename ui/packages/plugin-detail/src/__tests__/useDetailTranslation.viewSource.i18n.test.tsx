/**
 * `detail.viewSource` — the activity-timeline "drill to source" link — resolves
 * from the locale packs with a provider mounted (objectui#3546).
 *
 * ## Why this site really did render a raw key
 *
 * `useDetailTranslation` is `createSafeTranslation(DETAIL_DEFAULT_TRANSLATIONS,
 * 'detail.back')`. That factory probes exactly ONE key: if `detail.back`
 * resolves, it hands the caller i18next's `t` for **every** key and the
 * defaults map is bypassed wholesale. `detail.back` has always been in the
 * packs, so in the real console the probe succeeded — and `detail.viewSource`,
 * present in the map but in none of the ten packs, reached the user verbatim
 * as `detail.viewSource`.
 *
 * That is why the test mounts a provider. Without one the probe fails, the
 * defaults map serves "View source", and the assertion passes while the
 * console is broken — the exact false-green #3546 was filed about.
 *
 * The real hook and the real defaults map are imported (rather than a local
 * stand-in) so this also fails if the map and the `en` pack ever drift apart.
 */
import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { I18nProvider } from '@object-ui/i18n';
import { useDetailTranslation, DETAIL_DEFAULT_TRANSLATIONS } from '../useDetailTranslation';

const wrapperFor = (lang: string) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
        {children}
      </I18nProvider>
    );
  };

beforeEach(() => {
  // The provider persists the last language (objectstack#5406).
  window.localStorage.clear();
});

describe('detail.viewSource under a mounted I18nProvider (objectui#3546)', () => {
  it('en resolves to English — never the raw key', () => {
    const { result } = renderHook(() => useDetailTranslation(), { wrapper: wrapperFor('en') });
    const value = result.current.t('detail.viewSource');
    // Pre-fix this assertion failed with the literal string 'detail.viewSource'.
    expect(value).not.toBe('detail.viewSource');
    expect(value).toBe('View source');
  });

  it('zh resolves to Chinese', () => {
    const { result } = renderHook(() => useDetailTranslation(), { wrapper: wrapperFor('zh') });
    expect(result.current.t('detail.viewSource')).toBe('查看来源');
  });

  it("the probe key still resolves — otherwise this file tests the fallback, not the packs", () => {
    // If `detail.back` ever leaves the packs, `createSafeTranslation` starts
    // serving the defaults map for everything and the two cases above would go
    // green for the wrong reason (the provider-less false-green this issue is
    // about). Pin the precondition explicitly.
    const { result } = renderHook(() => useDetailTranslation(), { wrapper: wrapperFor('zh') });
    expect(result.current.t('detail.back')).not.toBe('detail.back');
    expect(result.current.t('detail.back')).not.toBe(DETAIL_DEFAULT_TRANSLATIONS['detail.back']);
  });
});
