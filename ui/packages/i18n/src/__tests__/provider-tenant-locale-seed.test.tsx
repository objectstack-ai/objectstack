/**
 * I18nProvider — the tenant's server-side locale seeds the UI language
 * (objectui#4035, ruling on objectstack#5419).
 *
 * `/auth/me/localization` has always been fetched and its `locale` always
 * dropped on the floor as far as the UI language was concerned, so a tenant
 * configured `zh-CN` handed every new device an English console until each user
 * switched by hand.
 *
 * These pin the precedence chain and — just as importantly — the *provenance*
 * rule that keeps it honest:
 *
 *   explicit choice > tenant seed > browser language > `en`
 *
 * A "reload" here is an unmount + a fresh `I18nProvider` mount, which builds a
 * new i18next instance exactly as a page load does: anything the new instance
 * knows had to come out of storage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import {
  I18nProvider,
  useObjectTranslation,
  LOCALE_STORAGE_KEY,
  LOCALE_SEED_STORAGE_KEY,
  cacheLanguageSeed,
  readCachedLanguageSeed,
} from '../provider';

function mount(props: Partial<React.ComponentProps<typeof I18nProvider>> = {}) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(I18nProvider, { ...props, children });
  return renderHook(() => useObjectTranslation(), { wrapper });
}

/** Pin the browser language so the environment tier is deterministic. */
function stubBrowserLanguage(lang: string) {
  Object.defineProperty(window.navigator, 'language', { value: lang, configurable: true });
}

/** What the platform actually answers: a region-qualified BCP-47 tag. */
const TENANT_LOCALE = 'zh-CN';

beforeEach(() => {
  window.localStorage.clear();
  stubBrowserLanguage('en-US');
});

describe('tenant locale seed', () => {
  it('boots in the tenant locale when the user has chosen nothing', () => {
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, TENANT_LOCALE);

    const { result } = mount({ config: { defaultLanguage: 'en' } });

    // Asserted without waitFor on purpose: the seed must land in the BOOTSTRAP
    // language, not as an async correction after an English first paint.
    // `<html lang>` seeds Accept-Language on every API call (#1319).
    expect(result.current.language).toBe(TENANT_LOCALE);
    expect(result.current.t('common.save')).toBe('保存');
  });

  it('resolves the region-qualified tag onto the pack it actually ships', () => {
    // The packs are keyed by base language; the platform answers `zh-CN`.
    // Rejecting the region subtag would reject the single most common tenant
    // configuration there is. Since objectui#11326 the `zh` pack serves
    // `zh-CN` directly, so the seed boots in the tag the server stated — the
    // same tag a stored `zh-CN` keeps — and renders from the `zh` pack.
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, TENANT_LOCALE);
    const { result } = mount({ config: { defaultLanguage: 'en' } });
    expect(result.current.language).toBe(TENANT_LOCALE);
    expect(result.current.t('common.save')).toBe('保存');
  });

  it('prefers an exact regional pack over the base language when one exists', () => {
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, 'pt-BR');

    const { result } = mount({
      config: { defaultLanguage: 'en', resources: { 'pt-BR': { common: { save: 'Salvar-BR' } } } },
    });

    expect(result.current.language).toBe('pt-BR');
  });

  it('outranks the browser language — a deliberate signal beats an incidental one', () => {
    stubBrowserLanguage('ja-JP');

    // Baseline: with no seed, detection wins.
    const detected = mount({ config: { defaultLanguage: 'en' } });
    expect(detected.result.current.language).toBe('ja');
    detected.unmount();

    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, TENANT_LOCALE);

    expect(mount({ config: { defaultLanguage: 'en' } }).result.current.language).toBe(TENANT_LOCALE);
  });

  it('loses to an explicit choice, however stale the choice looks', () => {
    // The precedence pin. The user picked English on a tenant configured
    // zh-CN; the tenant does not get to overrule them.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, TENANT_LOCALE);

    expect(mount({ config: { defaultLanguage: 'en' } }).result.current.language).toBe('en');
  });

  it('never writes itself into the explicit-choice slot', () => {
    // The provenance pin, and the reason the two slots exist. If applying a
    // seed wrote the explicit key, the seed would become indistinguishable
    // from a deliberate choice: it would outrank the next tenant change and
    // pin this device forever, and it would suppress browser detection for a
    // user who never expressed a preference.
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, TENANT_LOCALE);

    const { result } = mount({ config: { defaultLanguage: 'en' } });
    expect(result.current.language).toBe(TENANT_LOCALE);

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    // ...and the seed stays exactly as the server stated it, un-promoted.
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe(TENANT_LOCALE);
  });

  it('is superseded, not merely overridden, once the user switches by hand', async () => {
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, TENANT_LOCALE);
    const first = mount({ config: { defaultLanguage: 'en' } });
    expect(first.result.current.language).toBe(TENANT_LOCALE);

    await act(async () => {
      await first.result.current.changeLanguage('ja');
    });
    await waitFor(() => expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja'));
    first.unmount();

    // Only a manual switch promotes a language to an explicit choice — and from
    // then on it outranks the seed, which is left untouched for the day the
    // user clears their preference.
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe(TENANT_LOCALE);
    expect(mount({ config: { defaultLanguage: 'en' } }).result.current.language).toBe('ja');
  });

  it('falls through to the next tier for a locale this console does not ship', () => {
    // Ruling point 4. `th` is a well-formed tag with no pack behind it — the
    // admin configured something this build cannot render.
    stubBrowserLanguage('ja-JP');
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, 'th');

    // Falls to the browser tier, NOT to `en` and NOT to a half-rendered `th`.
    expect(mount({ config: { defaultLanguage: 'en' } }).result.current.language).toBe('ja');
  });

  it('does not take a dynamic loader as proof the tenant locale ships', () => {
    // The asymmetry that keeps ruling points 3 and 4 compatible. A *stored*
    // choice is accepted on the loader's credit, because the user picked it
    // out of a menu built from the app's real locale list and a `provisional`
    // self-heal adjudicates it afterwards. A tenant seed passed through no
    // menu and has no self-heal behind it, so extending the same credit would
    // mean booting into an unconfirmed locale and retracting it later — a
    // flash manufactured on exactly the first-visit path point 3 bounds.
    stubBrowserLanguage('ja-JP');
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, 'th');

    const { result } = mount({
      config: { defaultLanguage: 'en' },
      loadLanguage: async () => ({}),
    });

    expect(result.current.language).toBe('ja');
  });

  it('ignores a malformed tenant locale instead of booting into it', () => {
    stubBrowserLanguage('ja-JP');
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, 'en_US');

    expect(mount({ config: { defaultLanguage: 'en' } }).result.current.language).toBe('ja');
  });

  it('follows a tenant reconfiguration on the next boot (stale-while-revalidate)', () => {
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, TENANT_LOCALE);
    const first = mount({ config: { defaultLanguage: 'en' } });
    expect(first.result.current.language).toBe(TENANT_LOCALE);
    first.unmount();

    // The tenant switches to Japanese; the in-app fetch refreshes the cache.
    cacheLanguageSeed('ja-JP');
    expect(readCachedLanguageSeed()).toBe('ja-JP');

    // The device follows on its next boot — an old seed never pins it.
    expect(mount({ config: { defaultLanguage: 'en' } }).result.current.language).toBe('ja-JP');
  });

  it('drops the cached seed when the tenant unsets its locale', () => {
    stubBrowserLanguage('ja-JP');
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, TENANT_LOCALE);

    cacheLanguageSeed(null);

    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull();
    expect(mount({ config: { defaultLanguage: 'en' } }).result.current.language).toBe('ja');
  });

  it('is ignored entirely on a surface that opted out of persistence', () => {
    // Previews / demos / screenshot harnesses must stay on a fixed language
    // regardless of what is on this origin — the tenant seed included.
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, TENANT_LOCALE);

    const { result } = mount({
      config: { defaultLanguage: 'en', detectBrowserLanguage: false },
      persistLanguage: false,
    });

    expect(result.current.language).toBe('en');
  });

  it('keeps the seed in a slot of its own', () => {
    expect(LOCALE_SEED_STORAGE_KEY).not.toBe(LOCALE_STORAGE_KEY);
  });
});
