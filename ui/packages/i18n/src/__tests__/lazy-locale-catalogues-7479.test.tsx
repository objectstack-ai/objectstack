/**
 * The lazy catalogue runtime (objectui#7479) — what a host actually observes.
 *
 * `entry-locale-shape-7479.test.ts` pins the export SHAPE and
 * `scripts/check-eager-locale-catalogues.mjs` pins the built BUNDLE. Neither
 * says the mechanism works. These are the three behaviours a host depends on,
 * and each is stated the way the documentation states it:
 *
 *   1. a locale whose catalogue has NOT been fetched renders through `en` —
 *      correct strings, never a raw key, never blank;
 *   2. a host that awaits `preloadBootstrapLocale()` gets the right language on
 *      the FIRST render, with no `en` in between;
 *   3. switching locale at runtime resolves the new catalogue — the lazy path,
 *      not just the boot path.
 *
 * ## Why the first two reset modules and the third does not
 *
 * The registry memoises: once a catalogue is resident it stays resident for the
 * life of the module instance, and the `unit` project shares one module graph
 * per worker (`isolate: false`), so "not yet loaded" is not a state a later
 * test file can assume it still has. Cases 1 and 2 are ABOUT that state, so
 * they take a fresh module graph and never touch React — `vi.resetModules()`
 * with React in the picture would hand RTL one copy of React and the component
 * another. Case 3 is about a transition and asserts both ends of it, so it is
 * true from either starting point and needs no reset.
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { I18nProvider, useObjectTranslation, useI18nContext } from '../provider.js';
import { isBuiltInLocaleLoaded } from '../locales/registry.js';
import ru from '../locales/ru.js';
import ko from '../locales/ko.js';

/**
 * A fresh module graph for the i18n package, so the registry starts with `en`
 * resident and nothing else. ⛔ React must stay out of anything this returns.
 */
async function freshI18n() {
  vi.resetModules();
  const [{ createI18n }, registry, provider] = await Promise.all([
    import('../i18n.js'),
    import('../locales/registry.js'),
    import('../provider.js'),
  ]);
  return { createI18n, ...registry, preloadBootstrapLocale: provider.preloadBootstrapLocale };
}

describe('a catalogue that has not been fetched yet', () => {
  it('renders through `en` — the documented fallback, not a raw key', async () => {
    const { createI18n, isBuiltInLocaleLoaded: loaded } = await freshI18n();
    expect(loaded('ko')).toBe(false);

    const i18n = createI18n({ defaultLanguage: 'ko', detectBrowserLanguage: false });
    expect(i18n.language).toBe('ko');

    // The failure this asserts against is `'common.save'` — the key itself,
    // which is what an absent `en` bundle would render in nine languages.
    expect(i18n.t('common.save')).toBe('Save');
    expect(i18n.t('common.save')).not.toBe('common.save');
  });

  it('still enumerates every language the renderer can produce', async () => {
    const { createI18n, BUILT_IN_LANGUAGE_CODES } = await freshI18n();
    const i18n = createI18n({ detectBrowserLanguage: false });
    // `getAvailableLanguages` reads `options.resources`, so the empty bundles
    // `createI18n` registers for the unfetched codes are what keeps a language
    // switcher offering all ten instead of shrinking to whatever loaded first.
    expect(Object.keys(i18n.options.resources ?? {}).sort()).toEqual(
      [...BUILT_IN_LANGUAGE_CODES].sort(),
    );
  });

  it('resolves `null` for a code this package does not ship', async () => {
    const { loadBuiltInLocale } = await freshI18n();
    await expect(loadBuiltInLocale('tlh')).resolves.toBeNull();
  });
});

describe('a host that resolves before first render', () => {
  it('has the catalogue resident by the time `createI18n` reads it', async () => {
    const { createI18n, preloadBootstrapLocale, isBuiltInLocaleLoaded: loaded } = await freshI18n();
    expect(loaded('ko')).toBe(false);

    await preloadBootstrapLocale({
      config: { defaultLanguage: 'ko', detectBrowserLanguage: false },
      persistLanguage: false,
    });
    expect(loaded('ko')).toBe(true);

    // The point of the await: the FIRST `t()` — which is the first render — is
    // already Korean. No `en` in between, so no flash.
    const i18n = createI18n({ defaultLanguage: 'ko', detectBrowserLanguage: false });
    expect(i18n.t('common.save')).toBe(ko.common.save);
    expect(i18n.t('common.save')).not.toBe('Save');
  });

  it('never rejects — a catalogue that will not download must not take the boot down', async () => {
    const { preloadBootstrapLocale } = await freshI18n();
    await expect(
      preloadBootstrapLocale({
        config: { defaultLanguage: 'tlh', detectBrowserLanguage: false },
        persistLanguage: false,
      }),
    ).resolves.toBeUndefined();
  });
});

function Probe() {
  const { t } = useObjectTranslation();
  const { changeLanguage, language } = useI18nContext();
  return (
    <div>
      <span data-testid="save">{t('common.save')}</span>
      <span data-testid="lang">{language}</span>
      <button onClick={() => void changeLanguage('ru')}>switch</button>
    </div>
  );
}

describe('switching locale at runtime', () => {
  it('fetches the new catalogue and renders it', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <Probe />
      </I18nProvider>,
    );

    // Both ends of the transition are asserted, which is what makes this
    // independent of whether `ru` happened to be resident already.
    expect(screen.getByTestId('save').textContent).toBe('Save');

    screen.getByRole('button').click();

    await waitFor(() => {
      expect(screen.getByTestId('lang').textContent).toBe('ru');
    });
    await waitFor(() => {
      expect(screen.getByTestId('save').textContent).toBe(ru.common.save);
    });
    // The catalogue really arrived; it did not merely re-render the fallback.
    expect(isBuiltInLocaleLoaded('ru')).toBe(true);
    expect(ru.common.save).not.toBe('Save');
  });
});
