import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation, useI18nContext } from '../provider';
import { createI18n } from '../i18n';

// Each test below is written as a fresh browser: the provider now remembers the
// language across mounts (objectstack#5406), so the `changeLanguage` test would
// otherwise hand its `zh` to every test after it — including the ones asserting
// a config-supplied bootstrap language. Persistence itself is covered in
// `provider-locale-persistence.test.tsx`.
beforeEach(() => {
  window.localStorage.clear();
});

describe('I18nProvider', () => {
  it('creates i18n instance from config', () => {
    // `children` goes IN the props object, not in `createElement`'s variadic
    // third argument. `I18nProviderProps.children` is required, and React's
    // `createElement` overloads check the props object alone — the variadic
    // form never satisfies a required `children`, so every wrapper in this
    // package was a `TS2769` the moment anything compiled these files (#4040).
    // Identical at runtime; React merges the variadic children into props.
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(I18nProvider, { config: { defaultLanguage: 'en', detectBrowserLanguage: false }, children });

    const { result } = renderHook(() => useObjectTranslation(), { wrapper });

    expect(result.current.i18n).toBeDefined();
    expect(result.current.language).toBe('en');
  });

  it('accepts pre-created instance', () => {
    const instance = createI18n({ defaultLanguage: 'fr', detectBrowserLanguage: false });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(I18nProvider, { instance, children });

    const { result } = renderHook(() => useObjectTranslation(), { wrapper });

    expect(result.current.i18n).toBeDefined();
    expect(result.current.language).toBe('fr');
  });
});

describe('useObjectTranslation', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(I18nProvider, { config: { defaultLanguage: 'en', detectBrowserLanguage: false }, children });

  it('returns t, language, changeLanguage, direction, i18n', () => {
    const { result } = renderHook(() => useObjectTranslation(), { wrapper });

    expect(result.current.t).toBeTypeOf('function');
    expect(result.current.language).toBeTypeOf('string');
    expect(result.current.changeLanguage).toBeTypeOf('function');
    expect(result.current.direction).toBeTypeOf('string');
    expect(result.current.i18n).toBeDefined();
  });

  it('translates keys correctly', () => {
    const { result } = renderHook(() => useObjectTranslation(), { wrapper });

    expect(result.current.t('common.save')).toBe('Save');
    expect(result.current.t('common.cancel')).toBe('Cancel');
    expect(result.current.t('common.delete')).toBe('Delete');
  });

  it('returns en as default language', () => {
    const { result } = renderHook(() => useObjectTranslation(), { wrapper });

    expect(result.current.language).toBe('en');
  });

  it('works with Chinese language', () => {
    const zhWrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(I18nProvider, { config: { defaultLanguage: 'zh', detectBrowserLanguage: false }, children });

    const { result } = renderHook(() => useObjectTranslation(), { wrapper: zhWrapper });

    expect(result.current.language).toBe('zh');
    expect(result.current.t('common.save')).toBe('保存');
    expect(result.current.t('common.cancel')).toBe('取消');
  });

  it('changeLanguage updates language', async () => {
    const { result } = renderHook(() => useObjectTranslation(), { wrapper });

    expect(result.current.language).toBe('en');

    await act(async () => {
      await result.current.changeLanguage('zh');
    });

    await waitFor(() => {
      expect(result.current.language).toBe('zh');
    });
  });

  it('returns RTL direction for Arabic', () => {
    const arWrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(I18nProvider, { config: { defaultLanguage: 'ar', detectBrowserLanguage: false }, children });

    const { result } = renderHook(() => useObjectTranslation(), { wrapper: arWrapper });

    expect(result.current.direction).toBe('rtl');
  });
});

describe('useI18nContext', () => {
  it('throws when used outside provider', () => {
    // Suppress console.error from React for the expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useI18nContext());
    }).toThrow('useI18nContext must be used within an I18nProvider');

    spy.mockRestore();
  });

  it('returns context inside provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(I18nProvider, { config: { defaultLanguage: 'en', detectBrowserLanguage: false }, children });

    const { result } = renderHook(() => useI18nContext(), { wrapper });

    expect(result.current.language).toBe('en');
    expect(result.current.changeLanguage).toBeTypeOf('function');
    expect(result.current.direction).toBe('ltr');
    expect(result.current.i18n).toBeDefined();
  });
});
