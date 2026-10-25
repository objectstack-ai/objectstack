/**
 * I18nProvider — the language choice survives a reload (objectstack#5406).
 *
 * Before this, switching the console language took effect immediately and was
 * never written anywhere: the next page load (or a new tab) reverted the whole
 * UI to `en`, which made every non-`en` locale demo-only.
 *
 * A "reload" here is an unmount + a fresh `I18nProvider` mount — the provider
 * builds a new i18next instance, exactly as a page load does, so anything the
 * new instance knows had to come out of storage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation, LOCALE_STORAGE_KEY, readStoredLanguage } from '../provider';

/** Mount a provider and expose the translation context, as a page load would. */
function mount(props: Partial<React.ComponentProps<typeof I18nProvider>> = {}) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(I18nProvider, { ...props, children });
  return renderHook(() => useObjectTranslation(), { wrapper });
}

/** Pin the browser language so detection is deterministic (and contestable). */
function stubBrowserLanguage(lang: string) {
  Object.defineProperty(window.navigator, 'language', { value: lang, configurable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  stubBrowserLanguage('en-US');
});

describe('language preference persistence', () => {
  it('writes the chosen language to localStorage on switch', async () => {
    const { result } = mount({ config: { defaultLanguage: 'en', detectBrowserLanguage: false } });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();

    await act(async () => {
      await result.current.changeLanguage('zh');
    });

    await waitFor(() => expect(result.current.language).toBe('zh'));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');
  });

  it('restores the stored language across a reload — on the FIRST render', async () => {
    const first = mount({ config: { defaultLanguage: 'en', detectBrowserLanguage: false } });
    await act(async () => {
      await first.result.current.changeLanguage('zh');
    });
    first.unmount();

    // Reload: a brand-new provider + instance, same storage.
    const second = mount({ config: { defaultLanguage: 'en', detectBrowserLanguage: false } });

    // Asserted without waitFor on purpose: the restore must land in the
    // bootstrap language, not as an async correction after an English first
    // paint. `<html lang>` seeds Accept-Language on every API call (#1319), so
    // a late switch would fetch server-resolved labels in the wrong locale.
    expect(second.result.current.language).toBe('zh');
    expect(second.result.current.t('common.save')).toBe('保存');
    await waitFor(() => expect(document.documentElement.lang).toBe('zh'));
  });

  it('persists a switch made directly on the i18next instance', async () => {
    const { result } = mount({ config: { defaultLanguage: 'en', detectBrowserLanguage: false } });

    // A switcher reaching for react-i18next's own API instead of the context
    // must not silently lose the preference.
    await act(async () => {
      await result.current.i18n.changeLanguage('ja');
    });

    await waitFor(() => expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja'));
  });

  it('an explicit stored choice outranks browser detection', () => {
    stubBrowserLanguage('ja-JP');

    // Baseline: with nothing stored, detection wins over `defaultLanguage`.
    const detected = mount({ config: { defaultLanguage: 'en' } });
    expect(detected.result.current.language).toBe('ja');
    detected.unmount();

    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh');

    const restored = mount({ config: { defaultLanguage: 'en' } });
    expect(restored.result.current.language).toBe('zh');
  });

  it('restores an RTL locale with its direction intact', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'ar');

    const { result } = mount({ config: { defaultLanguage: 'en', detectBrowserLanguage: false } });

    expect(result.current.language).toBe('ar');
    expect(result.current.direction).toBe('rtl');
  });

  it('honours a stored language supplied only through config.resources', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'th');

    const { result } = mount({
      config: {
        defaultLanguage: 'en',
        detectBrowserLanguage: false,
        resources: { th: { common: { save: 'บันทึก' } } },
      },
    });

    expect(result.current.language).toBe('th');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('th');
  });

  it('drops AND purges a stored language the app no longer offers', () => {
    // The app shipped `th` yesterday and dropped it today: a leftover entry
    // must not lock the UI to a locale with no translations.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'th');

    const { result } = mount({ config: { defaultLanguage: 'en', detectBrowserLanguage: false } });

    expect(result.current.language).toBe('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('ignores a junk value that only exists on Object.prototype', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'constructor');

    const { result } = mount({ config: { defaultLanguage: 'en', detectBrowserLanguage: false } });

    expect(result.current.language).toBe('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('persistLanguage={false} neither restores nor writes', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh');

    const { result } = mount({
      config: { defaultLanguage: 'en', detectBrowserLanguage: false },
      persistLanguage: false,
    });
    expect(result.current.language).toBe('en');

    await act(async () => {
      await result.current.changeLanguage('ja');
    });

    await waitFor(() => expect(result.current.language).toBe('ja'));
    // The pre-existing preference is left exactly as it was, not overwritten.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');
  });

  it('survives storage being blocked (Safari private mode / partitioned iframe)', async () => {
    // Not a spy on Storage.prototype: the runner may swap `localStorage` for a
    // plain in-memory object (vitest.setup.base.ts), which no prototype spy
    // would reach. Replace the property itself so the throw is unavoidable.
    const real = window.localStorage;
    const throws = () => { throw new Error('SecurityError: storage is disabled'); };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: throws, setItem: throws, removeItem: throws, clear: throws, key: throws, length: 0 },
    });

    try {
      const { result } = mount({ config: { defaultLanguage: 'en', detectBrowserLanguage: false } });
      expect(result.current.language).toBe('en');

      await act(async () => {
        await result.current.changeLanguage('zh');
      });

      // The switch still applies for this session; only its persistence is lost.
      await waitFor(() => expect(result.current.language).toBe('zh'));
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: real });
    }
  });

  it('readStoredLanguage reads back what the provider wrote', async () => {
    const { result } = mount({ config: { defaultLanguage: 'en', detectBrowserLanguage: false } });

    await act(async () => {
      await result.current.changeLanguage('de');
    });

    await waitFor(() => expect(readStoredLanguage()).toBe('de'));
  });
});
