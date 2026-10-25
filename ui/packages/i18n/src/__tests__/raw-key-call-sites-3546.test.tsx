/**
 * The five keys behind objectui#3546's eight no-fallback `t()` call sites now
 * resolve **from the locale packs, with a provider mounted**.
 *
 * ## Why a provider-mounted test, and why `zh` is the load-bearing half
 *
 * This is the trap #3546 documents. `createSafeTranslation` probes ONE
 * `testKey`; if that key resolves, it hands the caller i18next's `t` for
 * *every* key. So a key that lives only in a component's defaults map is
 * served correctly in a provider-less unit test and degrades to the raw key in
 * the real console. A green suite proves nothing unless a provider is mounted —
 * hence `I18nProvider` here rather than `renderHook` on its own.
 *
 * `en` alone is not enough either, and for a second reason. Two of the eight
 * sites were NOT rendering a raw key before the fix, because their fallback
 * genuinely worked (measured, not assumed — see the PR body):
 *
 *   - `wizard.missingRequired` is its own hook's `testKey`, so the probe failed
 *     and `createSafeTranslation` correctly served the English default.
 *   - `gantt.toolbar.refresh` goes through `useGanttTranslation`, which does
 *     per-key fallback and deliberately does NOT use `createSafeTranslation`.
 *
 * For those two the pre-fix `en` output was already "Please complete…" /
 * "Refresh" — identical to the post-fix pack value. An `en`-only assertion
 * would have been green before the fix and is therefore worthless as a guard.
 * **`zh` is what discriminates**: before the packs were backfilled a `zh`
 * session got the English default, and after it gets Chinese. Every assertion
 * below that actually pins this fix is a `zh` one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '../provider';
import { createSafeTranslation } from '../useSafeTranslation';
import { builtInLocales } from '../locales/index';

/** The five keys this slice backfilled, with their call sites. */
const KEYS = [
  'console.objectView.cannotEditMetaView',
  'console.objectView.cannotDeleteMetaView',
  'detail.viewSource',
  'gantt.toolbar.refresh',
  'wizard.missingRequired',
] as const;

// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` below would be an
// implicit-`any` index into a `const` map (TS7053) and the suite would compare
// packs the compiler never confirmed exist. Same convention as
// `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

const wrapperFor = (lang: string) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      I18nProvider,
      { config: { defaultLanguage: lang, detectBrowserLanguage: false }, children },
    );
  };

beforeEach(() => {
  // The provider remembers the language across mounts (objectstack#5406), so a
  // stale `zh` would otherwise leak into the `en` cases below.
  window.localStorage.clear();
});

describe('objectui#3546 slice one — the five raw-key call-site keys', () => {
  it('covers all ten packs (guards the loop from silently emptying)', () => {
    expect(LANGS).toHaveLength(10);
    expect(KEYS).toHaveLength(5);
  });

  it.each(LANGS)('%s defines all five keys as non-empty strings', (lang) => {
    for (const key of KEYS) {
      const value = at(builtInLocales[lang], key);
      expect(typeof value, `${lang}.${key}`).toBe('string');
      expect((value as string).trim().length, `${lang}.${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('every pack but en carries a real translation, not the English string', () => {
    // The failure this catches is a backfill that copy-pastes `en` into the
    // other nine packs: full key parity, ten packs green, and nine languages
    // still reading English. `all-locales-key-parity` cannot see it.
    const untranslated: string[] = [];
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      for (const key of KEYS) {
        if (at(builtInLocales[lang], key) === at(builtInLocales.en, key)) {
          untranslated.push(`${lang}.${key}`);
        }
      }
    }
    expect(untranslated).toEqual([]);
  });

  describe("ObjectView's binding — plain useObjectTranslation, no defaults map", () => {
    // ObjectView.tsx calls `useObjectTranslation()` directly, so a missing key
    // reached the user verbatim: the toast literally read
    // `console.objectView.cannotEditMetaView`. Nothing shadowed it, which is
    // why these two are the sites the issue verified on the page.
    it.each(['en', 'zh'] as const)('%s resolves both meta-view toasts from the pack', (lang) => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      for (const key of [
        'console.objectView.cannotEditMetaView',
        'console.objectView.cannotDeleteMetaView',
      ]) {
        const value = result.current.t(key);
        expect(value, `${lang}.${key} rendered the raw key`).not.toBe(key);
        expect(value).toBe(at(builtInLocales[lang], key));
      }
    });

    it('the zh toast is Chinese — the assertion that would fail without the packs', () => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      expect(result.current.t('console.objectView.cannotEditMetaView')).toBe(
        '该视图为内置视图，由代码定义，无法修改。',
      );
      expect(result.current.t('console.objectView.cannotDeleteMetaView')).toBe(
        '该视图为内置视图，由代码定义，无法删除。',
      );
    });
  });

  describe("WizardForm's binding — createSafeTranslation whose testKey IS the key", () => {
    // `createSafeTranslation({...}, 'wizard.missingRequired')`. Before the
    // backfill the probe failed (the key was in no pack), so the hook served
    // its own English default to every language. Now the probe succeeds and
    // i18next serves the pack — so `zh` finally gets Chinese.
    const useWizardTranslation = createSafeTranslation(
      { 'wizard.missingRequired': 'Please complete the required fields: {{fields}}' },
      'wizard.missingRequired',
    );

    it('en interpolates {{fields}} from the pack', () => {
      const { result } = renderHook(() => useWizardTranslation(), { wrapper: wrapperFor('en') });
      expect(result.current.t('wizard.missingRequired', { fields: 'Name, Owner' })).toBe(
        'Please complete the required fields: Name, Owner',
      );
    });

    it('zh serves Chinese, NOT the hook default (the pre-fix behaviour)', () => {
      const { result } = renderHook(() => useWizardTranslation(), { wrapper: wrapperFor('zh') });
      const value = result.current.t('wizard.missingRequired', { fields: 'Name, Owner' });
      expect(value).toBe('请填写以下必填字段：Name, Owner');
      expect(value).not.toContain('Please complete');
    });
  });

  describe("RecordActivityTimeline's binding — testKey resolves, so i18next wins", () => {
    // `createSafeTranslation(DETAIL_DEFAULT_TRANSLATIONS, 'detail.back')`.
    // `detail.back` HAS always been in the packs, so the probe succeeded, the
    // defaults map was bypassed wholesale, and `detail.viewSource` — present
    // in the map, absent from every pack — reached the user as a raw key.
    const useDetailish = createSafeTranslation(
      { 'detail.back': 'Back', 'detail.viewSource': 'View source' },
      'detail.back',
    );

    it.each(['en', 'zh'] as const)('%s resolves detail.viewSource from the pack', (lang) => {
      const { result } = renderHook(() => useDetailish(), { wrapper: wrapperFor(lang) });
      const value = result.current.t('detail.viewSource');
      expect(value, `${lang} rendered the raw key`).not.toBe('detail.viewSource');
      expect(value).toBe(at(builtInLocales[lang], 'detail.viewSource'));
    });

    it('zh is Chinese', () => {
      const { result } = renderHook(() => useDetailish(), { wrapper: wrapperFor('zh') });
      expect(result.current.t('detail.viewSource')).toBe('查看来源');
    });
  });

  describe("GanttView's binding — per-key fallback, so English always rendered", () => {
    // `useGanttTranslation` deliberately avoids `createSafeTranslation` and
    // falls back per key, so `gantt.toolbar.refresh` rendered "Refresh", not
    // the raw key — the aria-label was in English, never a key. The defect at
    // this site is that ten languages could not translate it.
    const perKey = (hostT: (k: string) => string, defaults: Record<string, string>) =>
      (key: string) => {
        const hostValue = hostT(key);
        return typeof hostValue === 'string' && hostValue !== key ? hostValue : defaults[key] || key;
      };

    it.each(['en', 'zh'] as const)('%s resolves the refresh aria-label from the pack', (lang) => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      const t = perKey(result.current.t, { 'gantt.toolbar.refresh': 'Refresh' });
      expect(t('gantt.toolbar.refresh')).toBe(at(builtInLocales[lang], 'gantt.toolbar.refresh'));
    });

    it('zh reaches the pack instead of stopping at the bundled English default', () => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      // Pre-fix this returned 'Refresh': the pack missed the key, so the
      // per-key fallback served the English default under a zh provider.
      expect(result.current.t('gantt.toolbar.refresh')).toBe('刷新');
    });
  });
});
