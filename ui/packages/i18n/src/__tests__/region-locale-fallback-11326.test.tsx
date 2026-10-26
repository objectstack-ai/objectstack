/**
 * A region-tagged language code reaches the built-in catalogue of its base
 * language (objectui#11326).
 *
 * The platform answers full BCP-47 tags (`zh-CN`), the Console's language menu
 * offers them, and the provider stores what the user picked — while the
 * built-in catalogues are keyed by base language (`zh`). The registry used to
 * look a code up EXACTLY, so `loadBuiltInLocale('zh-CN')` resolved `null` and
 * `isBuiltInLanguage('zh-CN')` answered `false`: a stored `zh-CN` booted the
 * provider with no Chinese catalogue at all, and every built-in string fell
 * through to `en` on every reload.
 *
 * ## Why these cases take a FRESH module graph
 *
 * The DOM projects make all ten catalogues resident before any test runs
 * (`vitest.setup.i18n-catalogues.ts`). With `zh` resident, i18next answers a
 * `zh-CN` lookup out of the `zh` bundle by its own language hierarchy — so in
 * that state the defect is invisible and a pin passes on the broken code. A
 * real page load has `en` resident and nothing else, which is the state
 * `vi.resetModules()` hands back: only then does the catalogue have to come
 * through the registry, which is the thing under test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

import zh from '../locales/zh.js';
import en from '../locales/en.js';
import { matchLanguageTag } from '../locales/registry.js';

const STORED = 'objectui-locale';
const CONFIG = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

/**
 * The i18n package as a page load finds it: `en` resident, nothing else. The
 * dynamic imports live in the test BODY (through this helper), never in a
 * hook — they must read module state that only exists after the reset.
 */
async function freshI18n() {
  vi.resetModules();
  const [provider, registry] = await Promise.all([
    import('../provider.js'),
    import('../locales/registry.js'),
  ]);
  return { ...provider, ...registry };
}

type Fresh = Awaited<ReturnType<typeof freshI18n>>;

/** A reader built from the FRESH provider's hook, so it reads the fresh instance. */
function probeFor(useObjectTranslation: Fresh['useObjectTranslation']) {
  return function Probe() {
    const { t, language, changeLanguage } = useObjectTranslation();
    return (
      <div>
        <span data-testid="save">{t('common.save')}</span>
        <span data-testid="lang">{language}</span>
        <button onClick={() => void changeLanguage('zh-CN')}>switch</button>
      </div>
    );
  };
}

const saveText = () => screen.getByTestId('save').textContent;
const langText = () => screen.getByTestId('lang').textContent;

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = '';
});

describe('the registry answers a region-tagged code with its base catalogue', () => {
  it('`loadBuiltInLocale(\'zh-CN\')` resolves the `zh` catalogue', async () => {
    const { loadBuiltInLocale, isBuiltInLocaleLoaded } = await freshI18n();
    expect(isBuiltInLocaleLoaded('zh')).toBe(false);

    const viaRegion = (await loadBuiltInLocale('zh-CN')) as typeof zh | null;

    expect(viaRegion).not.toBeNull();
    expect(viaRegion?.common.save).toBe(zh.common.save);
    expect(zh.common.save).not.toBe(en.common.save);
  });

  it('`en` is the control: it resolves itself, unchanged', async () => {
    const { loadBuiltInLocale, isBuiltInLanguage } = await freshI18n();

    const control = (await loadBuiltInLocale('en')) as typeof en | null;

    expect(control?.common.save).toBe(en.common.save);
    expect(isBuiltInLanguage('en')).toBe(true);
  });

  it('`isBuiltInLanguage(\'zh-CN\')` agrees with the loader', async () => {
    const { isBuiltInLanguage } = await freshI18n();
    expect(isBuiltInLanguage('zh-CN')).toBe(true);
  });

  it('a code with no base catalogue is still refused, exactly as before', async () => {
    const { loadBuiltInLocale, isBuiltInLanguage } = await freshI18n();

    expect(isBuiltInLanguage('xx-YY')).toBe(false);
    await expect(loadBuiltInLocale('xx-YY')).resolves.toBeNull();
    expect(isBuiltInLanguage('tlh')).toBe(false);
    await expect(loadBuiltInLocale('tlh')).resolves.toBeNull();
  });
});

describe('the exact-then-base order', () => {
  // No built-in catalogue is keyed by a full tag at the time of writing, so the
  // "exact wins" half cannot be shown on a real `zh-TW` beside `zh`. It is
  // pinned on the normaliser itself, and on every real catalogue code
  // resolving to itself — which a future full-tag catalogue would inherit.
  it('prefers an exact match over the base language, and falls back to the base', () => {
    const has = (code: string) => code === 'pt' || code === 'pt-BR';

    expect(matchLanguageTag('pt-BR', has)).toBe('pt-BR');
    expect(matchLanguageTag('pt-PT', has)).toBe('pt');
    expect(matchLanguageTag('pt', has)).toBe('pt');
    expect(matchLanguageTag('xx-YY', has)).toBeNull();
  });

  it('resolves every built-in catalogue code to itself', async () => {
    const { resolveBuiltInLanguage, BUILT_IN_LANGUAGE_CODES } = await freshI18n();

    for (const code of BUILT_IN_LANGUAGE_CODES) {
      expect(resolveBuiltInLanguage(code)).toBe(code);
    }
    expect(resolveBuiltInLanguage('zh-CN')).toBe('zh');
  });

  it('memoises under the catalogue code — `zh-CN` and `zh` share one catalogue', async () => {
    const { loadBuiltInLocale, getLoadedBuiltInLocales, isBuiltInLocaleLoaded } = await freshI18n();

    const viaRegion = await loadBuiltInLocale('zh-CN');

    expect(await loadBuiltInLocale('zh')).toBe(viaRegion);
    // `createI18n` and the app-shell splash read this snapshot by catalogue
    // code; a `zh-CN` key here would be a catalogue neither of them finds.
    expect(Object.keys(getLoadedBuiltInLocales()).sort()).toEqual(['en', 'zh']);
    expect(isBuiltInLocaleLoaded('zh-CN')).toBe(true);
  });
});

describe('a provider bootstrapped with a stored `zh-CN`', () => {
  it('renders a built-in key in Chinese — the Console shape, with a `loadLanguage` loader wired', async () => {
    const { I18nProvider, useObjectTranslation } = await freshI18n();
    const Probe = probeFor(useObjectTranslation);
    window.localStorage.setItem(STORED, 'zh-CN');

    render(
      <I18nProvider config={CONFIG} loadLanguage={async () => ({})}>
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => expect(saveText()).toBe(zh.common.save));
  });

  it('renders a built-in key in Chinese — a host with no loader', async () => {
    const { I18nProvider, useObjectTranslation } = await freshI18n();
    const Probe = probeFor(useObjectTranslation);
    window.localStorage.setItem(STORED, 'zh-CN');

    render(
      <I18nProvider config={CONFIG}>
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => expect(saveText()).toBe(zh.common.save));
  });

  it('paints Chinese on the FIRST render when the host awaited `preloadBootstrapLocale`', async () => {
    const { I18nProvider, useObjectTranslation, preloadBootstrapLocale, isBuiltInLocaleLoaded } =
      await freshI18n();
    const Probe = probeFor(useObjectTranslation);
    window.localStorage.setItem(STORED, 'zh-CN');

    // What `apps/console/src/main.tsx` does before `createRoot().render()`.
    await preloadBootstrapLocale({ config: CONFIG, hasLoader: true });
    expect(isBuiltInLocaleLoaded('zh')).toBe(true);

    render(
      <I18nProvider config={CONFIG} loadLanguage={async () => ({})}>
        <Probe />
      </I18nProvider>,
    );

    // No waitFor: the first paint is the assertion.
    expect(saveText()).toBe(zh.common.save);
  });

  it('keeps the user\'s tag — the language, `<html lang>` and the stored value stay `zh-CN`', async () => {
    const { I18nProvider, useObjectTranslation } = await freshI18n();
    const Probe = probeFor(useObjectTranslation);
    window.localStorage.setItem(STORED, 'zh-CN');

    render(
      <I18nProvider config={CONFIG} loadLanguage={async () => ({})}>
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => expect(saveText()).toBe(zh.common.save));
    expect(langText()).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(window.localStorage.getItem(STORED)).toBe('zh-CN');
  });

  it('`en` is the control: a stored `en` renders English', async () => {
    const { I18nProvider, useObjectTranslation } = await freshI18n();
    const Probe = probeFor(useObjectTranslation);
    window.localStorage.setItem(STORED, 'en');

    render(
      <I18nProvider config={CONFIG} loadLanguage={async () => ({})}>
        <Probe />
      </I18nProvider>,
    );

    expect(saveText()).toBe(en.common.save);
    expect(langText()).toBe('en');
  });
});

describe('switching to `zh-CN` at runtime', () => {
  it('fetches the `zh` catalogue and keeps `zh-CN` as the language', async () => {
    const { I18nProvider, useObjectTranslation, isBuiltInLocaleLoaded } = await freshI18n();
    const Probe = probeFor(useObjectTranslation);

    render(
      <I18nProvider config={CONFIG}>
        <Probe />
      </I18nProvider>,
    );
    expect(saveText()).toBe(en.common.save);
    expect(isBuiltInLocaleLoaded('zh')).toBe(false);

    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(langText()).toBe('zh-CN'));
    expect(saveText()).toBe(zh.common.save);
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(window.localStorage.getItem(STORED)).toBe('zh-CN');
  });
});
