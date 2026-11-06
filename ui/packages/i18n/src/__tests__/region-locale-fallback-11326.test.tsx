/**
 * A region-tagged language code reaches the built-in catalogue it means
 * (objectui#11326), for BOTH Chinese scripts (objectstack#30511).
 *
 * The platform answers full BCP-47 tags (`zh-CN`), the Console's language menu
 * offers them, and the provider stores what the user picked. The registry used
 * to look a code up EXACTLY, so `loadBuiltInLocale('zh-CN')` resolved `null` and
 * `isBuiltInLanguage('zh-CN')` answered `false`: a stored `zh-CN` booted the
 * provider with no Chinese catalogue at all, and every built-in string fell
 * through to `en` on every reload.
 *
 * Since objectstack#30511 the catalogues are keyed by the platform locale
 * table's tags (`zh-Hans`, `zh-Hant`, `pt-BR`) and a code is read through the
 * table's read aliases first, so the base language is no longer enough: `zh`
 * cannot tell a Taiwan reader from a mainland one. `zh-CN`, `zh-SG` and a bare
 * `zh` read as `zh-Hans`; `zh-TW`, `zh-HK` and `zh-MO` read as `zh-Hant`. The
 * key every case below reads, `common.save`, is spelled differently in the two
 * packs (保存 / 儲存), so a case that reached the wrong script fails.
 *
 * ## Why these cases take a FRESH module graph
 *
 * The DOM projects make every catalogue resident before any test runs
 * (`vitest.setup.i18n-catalogues.ts`). With the packs resident, i18next can
 * answer a `zh-CN` lookup out of a resident bundle through its fallback chain —
 * so in that state the defect is invisible and a pin passes on the broken code. A
 * real page load has `en` resident and nothing else, which is the state
 * `vi.resetModules()` hands back: only then does the catalogue have to come
 * through the registry, which is the thing under test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

import zhHans from '../locales/zh-Hans.js';
import zhHant from '../locales/zh-Hant.js';
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
function probeFor(useObjectTranslation: Fresh['useObjectTranslation'], switchTo = 'zh-CN') {
  return function Probe() {
    const { t, language, changeLanguage } = useObjectTranslation();
    return (
      <div>
        <span data-testid="save">{t('common.save')}</span>
        <span data-testid="lang">{language}</span>
        <button onClick={() => void changeLanguage(switchTo)}>switch</button>
      </div>
    );
  };
}

/** The codes each Chinese pack serves: the table's read aliases, plus the tag. */
const SIMPLIFIED_CODES = ['zh-Hans', 'zh', 'zh-CN', 'zh-SG', 'zh-Hans-CN'] as const;
const TRADITIONAL_CODES = ['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant-TW', 'zh-Hant-HK'] as const;

it('the two packs really spell the probe key differently — otherwise no case below can tell them apart', () => {
  expect(zhHans.common.save).toBe('保存');
  expect(zhHant.common.save).toBe('儲存');
  expect(en.common.save).not.toBe(zhHans.common.save);
});

const saveText = () => screen.getByTestId('save').textContent;
const langText = () => screen.getByTestId('lang').textContent;

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = '';
});

describe('the registry answers a region-tagged code with the catalogue of its script', () => {
  it('`loadBuiltInLocale(\'zh-CN\')` resolves the `zh-Hans` catalogue', async () => {
    const { loadBuiltInLocale, isBuiltInLocaleLoaded } = await freshI18n();
    expect(isBuiltInLocaleLoaded('zh-CN')).toBe(false);

    const viaRegion = (await loadBuiltInLocale('zh-CN')) as typeof zhHans | null;

    expect(viaRegion).not.toBeNull();
    expect(viaRegion?.common.save).toBe(zhHans.common.save);
  });

  it('`loadBuiltInLocale(\'zh-TW\')` resolves the `zh-Hant` catalogue, not the Simplified one', async () => {
    const { loadBuiltInLocale, isBuiltInLocaleLoaded } = await freshI18n();
    expect(isBuiltInLocaleLoaded('zh-TW')).toBe(false);

    const viaRegion = (await loadBuiltInLocale('zh-TW')) as typeof zhHant | null;

    expect(viaRegion).not.toBeNull();
    expect(viaRegion?.common.save).toBe(zhHant.common.save);
    // Loading Traditional fetched Traditional only.
    expect(isBuiltInLocaleLoaded('zh-CN')).toBe(false);
  });

  it.each(SIMPLIFIED_CODES)('`%s` reads as `zh-Hans`', async (code) => {
    const { resolveBuiltInLanguage, isBuiltInLanguage } = await freshI18n();
    expect(resolveBuiltInLanguage(code)).toBe('zh-Hans');
    expect(isBuiltInLanguage(code)).toBe(true);
  });

  it.each(TRADITIONAL_CODES)('`%s` reads as `zh-Hant`', async (code) => {
    const { resolveBuiltInLanguage, isBuiltInLanguage } = await freshI18n();
    expect(resolveBuiltInLanguage(code)).toBe('zh-Hant');
    expect(isBuiltInLanguage(code)).toBe(true);
  });

  it('reads a stored code case-insensitively, as the table does', async () => {
    const { resolveBuiltInLanguage } = await freshI18n();
    expect(resolveBuiltInLanguage('ZH-tw')).toBe('zh-Hant');
    expect(resolveBuiltInLanguage('zh-cn')).toBe('zh-Hans');
    expect(resolveBuiltInLanguage('zh-hant')).toBe('zh-Hant');
  });

  it('the other renamed pack: a stored `pt` (and a Portuguese region) reads as `pt-BR`', async () => {
    const { resolveBuiltInLanguage } = await freshI18n();
    expect(resolveBuiltInLanguage('pt')).toBe('pt-BR');
    expect(resolveBuiltInLanguage('pt-BR')).toBe('pt-BR');
    expect(resolveBuiltInLanguage('pt-PT')).toBe('pt-BR');
  });

  it('`en` is the control: it resolves itself, unchanged', async () => {
    const { loadBuiltInLocale, isBuiltInLanguage } = await freshI18n();

    const control = (await loadBuiltInLocale('en')) as typeof en | null;

    expect(control?.common.save).toBe(en.common.save);
    expect(isBuiltInLanguage('en')).toBe(true);
  });

  it('`isBuiltInLanguage(\'zh-CN\')` and `(\'zh-TW\')` agree with the loader', async () => {
    const { isBuiltInLanguage } = await freshI18n();
    expect(isBuiltInLanguage('zh-CN')).toBe(true);
    expect(isBuiltInLanguage('zh-TW')).toBe(true);
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
  // `matchLanguageTag` is the generic matcher the provider seed and the
  // `studio` namespace use over their own sets; the built-in catalogues are
  // matched by `resolveBuiltInLanguage`, through the table's aliases first.
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
    expect(resolveBuiltInLanguage('zh-CN')).toBe('zh-Hans');
    expect(resolveBuiltInLanguage('zh-TW')).toBe('zh-Hant');
  });

  it('falls back by prefix for a region the table does not alias', async () => {
    const { resolveBuiltInLanguage } = await freshI18n();
    expect(resolveBuiltInLanguage('fr-CA')).toBe('fr');
    expect(resolveBuiltInLanguage('en-GB')).toBe('en');
    expect(resolveBuiltInLanguage('es-MX')).toBe('es');
    expect(resolveBuiltInLanguage('xx-YY')).toBeNull();
    expect(resolveBuiltInLanguage('')).toBeNull();
  });

  it('memoises under the table tag — `zh-CN`, `zh` and `zh-Hans` share one catalogue', async () => {
    const { loadBuiltInLocale, getLoadedBuiltInLocales, isBuiltInLocaleLoaded } = await freshI18n();

    const viaRegion = await loadBuiltInLocale('zh-CN');

    expect(await loadBuiltInLocale('zh')).toBe(viaRegion);
    expect(await loadBuiltInLocale('zh-Hans')).toBe(viaRegion);
    // `createI18n` and the app-shell splash read this snapshot by table tag;
    // a `zh-CN` key here would be a catalogue neither of them finds.
    expect(Object.keys(getLoadedBuiltInLocales()).sort()).toEqual(['en', 'zh-Hans']);
    expect(isBuiltInLocaleLoaded('zh-CN')).toBe(true);
    expect(isBuiltInLocaleLoaded('zh-TW')).toBe(false);
  });

  it('memoises Traditional under `zh-Hant` — `zh-TW` and `zh-HK` share one catalogue', async () => {
    const { loadBuiltInLocale, getLoadedBuiltInLocales } = await freshI18n();

    const viaTaiwan = await loadBuiltInLocale('zh-TW');

    expect(await loadBuiltInLocale('zh-HK')).toBe(viaTaiwan);
    expect(Object.keys(getLoadedBuiltInLocales()).sort()).toEqual(['en', 'zh-Hant']);
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

    await waitFor(() => expect(saveText()).toBe(zhHans.common.save));
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

    await waitFor(() => expect(saveText()).toBe(zhHans.common.save));
  });

  it('paints Chinese on the FIRST render when the host awaited `preloadBootstrapLocale`', async () => {
    const { I18nProvider, useObjectTranslation, preloadBootstrapLocale, isBuiltInLocaleLoaded } =
      await freshI18n();
    const Probe = probeFor(useObjectTranslation);
    window.localStorage.setItem(STORED, 'zh-CN');

    // What `apps/console/src/main.tsx` does before `createRoot().render()`.
    await preloadBootstrapLocale({ config: CONFIG, hasLoader: true });
    expect(isBuiltInLocaleLoaded('zh-Hans')).toBe(true);

    render(
      <I18nProvider config={CONFIG} loadLanguage={async () => ({})}>
        <Probe />
      </I18nProvider>,
    );

    // No waitFor: the first paint is the assertion.
    expect(saveText()).toBe(zhHans.common.save);
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

    await waitFor(() => expect(saveText()).toBe(zhHans.common.save));
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
  it('fetches the `zh-Hans` catalogue and keeps `zh-CN` as the language', async () => {
    const { I18nProvider, useObjectTranslation, isBuiltInLocaleLoaded } = await freshI18n();
    const Probe = probeFor(useObjectTranslation);

    render(
      <I18nProvider config={CONFIG}>
        <Probe />
      </I18nProvider>,
    );
    expect(saveText()).toBe(en.common.save);
    expect(isBuiltInLocaleLoaded('zh-Hans')).toBe(false);

    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(langText()).toBe('zh-CN'));
    expect(saveText()).toBe(zhHans.common.save);
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(window.localStorage.getItem(STORED)).toBe('zh-CN');
  });
});

describe('a provider bootstrapped with a stored Traditional code', () => {
  it.each(['zh-TW', 'zh-HK'])('a stored `%s` renders a built-in key in Traditional Chinese', async (code) => {
    const { I18nProvider, useObjectTranslation } = await freshI18n();
    const Probe = probeFor(useObjectTranslation);
    window.localStorage.setItem(STORED, code);

    render(
      <I18nProvider config={CONFIG} loadLanguage={async () => ({})}>
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => expect(saveText()).toBe(zhHant.common.save));
    // The user's tag is kept, exactly as for `zh-CN`.
    expect(langText()).toBe(code);
    expect(document.documentElement.lang).toBe(code);
    expect(window.localStorage.getItem(STORED)).toBe(code);
  });

  it('paints Traditional on the FIRST render when the host awaited `preloadBootstrapLocale`', async () => {
    const { I18nProvider, useObjectTranslation, preloadBootstrapLocale, isBuiltInLocaleLoaded } =
      await freshI18n();
    const Probe = probeFor(useObjectTranslation);
    window.localStorage.setItem(STORED, 'zh-TW');

    await preloadBootstrapLocale({ config: CONFIG, hasLoader: true });
    expect(isBuiltInLocaleLoaded('zh-Hant')).toBe(true);
    expect(isBuiltInLocaleLoaded('zh-Hans')).toBe(false);

    render(
      <I18nProvider config={CONFIG} loadLanguage={async () => ({})}>
        <Probe />
      </I18nProvider>,
    );

    expect(saveText()).toBe(zhHant.common.save);
  });

  it('a stored legacy `zh` still renders Simplified — the value phase 1 menus wrote', async () => {
    const { I18nProvider, useObjectTranslation } = await freshI18n();
    const Probe = probeFor(useObjectTranslation);
    window.localStorage.setItem(STORED, 'zh');

    render(
      <I18nProvider config={CONFIG} loadLanguage={async () => ({})}>
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => expect(saveText()).toBe(zhHans.common.save));
    expect(langText()).toBe('zh');
  });
});

describe('switching to `zh-TW` at runtime', () => {
  it('fetches the `zh-Hant` catalogue and keeps `zh-TW` as the language', async () => {
    const { I18nProvider, useObjectTranslation, isBuiltInLocaleLoaded } = await freshI18n();
    const Probe = probeFor(useObjectTranslation, 'zh-TW');

    render(
      <I18nProvider config={CONFIG}>
        <Probe />
      </I18nProvider>,
    );
    expect(saveText()).toBe(en.common.save);
    expect(isBuiltInLocaleLoaded('zh-Hant')).toBe(false);

    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(langText()).toBe('zh-TW'));
    expect(saveText()).toBe(zhHant.common.save);
    expect(isBuiltInLocaleLoaded('zh-Hans')).toBe(false);
    expect(document.documentElement.lang).toBe('zh-TW');
    expect(window.localStorage.getItem(STORED)).toBe('zh-TW');
  });
});
