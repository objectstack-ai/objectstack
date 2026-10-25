/**
 * I18nProvider — a user-picked APP locale survives a reload (objectui#4039).
 *
 * The lockstep half of the switcher change, and the card's own warning:
 * PR objectui#3376 validated a restored language against "the locales this
 * provider can produce" — built-in packs plus `config.resources`. That bound
 * was correct precisely *because* the menu offered exactly the built-in ten.
 * The moment the menu grows to the app's real locale list, a locale the user
 * can now pick is a locale that bound rejects, and the preference is purged on
 * the next page load — the next thing that does not survive a reload.
 *
 * The console is the case that matters: it wires `loadLanguage` and NO
 * `config.resources`, so an app pack for `th` lives behind
 * `GET /api/v1/i18n/translations/th` and is invisible to any synchronous check.
 *
 * A "reload" here is an unmount + a fresh `I18nProvider` mount — a new i18next
 * instance, so anything it knows had to come out of storage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation, LOCALE_STORAGE_KEY } from '../provider';

/** The console's wiring: app packs fetched on demand, nothing in `resources`. */
function mountConsole(
  props: Partial<React.ComponentProps<typeof I18nProvider>> = {},
  appLocales: string[] | null = ['en', 'zh', 'th'],
) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(I18nProvider, {
      config: { defaultLanguage: 'en', detectBrowserLanguage: false },
      loadLanguage: async (lang: string) => (lang === 'th' ? { common: { save: 'บันทึก' } } : {}),
      ...(appLocales ? { loadLocales: async () => appLocales } : {}),
      ...props,
      children,
    });
  return renderHook(() => useObjectTranslation(), { wrapper });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('app-locale restore (lockstep with the switcher)', () => {
  it('restores an app-shipped locale that has no built-in pack', async () => {
    const first = mountConsole();
    await act(async () => {
      await first.result.current.changeLanguage('th');
    });
    await waitFor(() => expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('th'));
    first.unmount();

    // Reload. Before the widening this asserted `en`: `th` is not a built-in
    // pack and not in `config.resources`, so the restore validation dropped
    // AND purged it — the user's pick lost on the first F5.
    const second = mountConsole();
    expect(second.result.current.language).toBe('th');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('th');
  });

  it('restores it in the BOOTSTRAP language, not as a late correction', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'th');

    const { result } = mountConsole();

    // Asserted without waitFor on purpose, same reason as the #5406 suite:
    // `<html lang>` seeds Accept-Language on every API call (#1319), so a late
    // switch would fetch the first wave of server-resolved labels in the wrong
    // locale and then have to remount to fix it.
    expect(result.current.language).toBe('th');
  });

  it('keeps rejecting junk that is not a language tag at all', () => {
    // The widening is "a well-formed tag the loader may be able to fetch", not
    // "anything in storage". `constructor` is the prototype-pollution probe the
    // original guard was written for; `en_US` is a malformed tag.
    for (const junk of ['constructor', '__proto__', 'en_US']) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, junk);
      const { result, unmount } = mountConsole();
      expect(result.current.language).toBe('en');
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
      unmount();
    }
  });

  it('treats an empty stored value as nothing stored', () => {
    // Not folded into the junk loop above: `''` never reaches the tag check —
    // `readStoredLanguage` returning `''` is falsy, so the bootstrap reads it
    // as "no preference" and leaves the (empty, harmless) entry where it is.
    // Pinned so the distinction is a decision rather than a surprise.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, '');

    const { result } = mountConsole();

    expect(result.current.language).toBe('en');
  });

  it('still drops a stale app locale when the app no longer ships it', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'th');

    // The app dropped `th` today. Nothing synchronous can know that, so the
    // bootstrap accepts it on the loader's credit — and the app's own answer
    // then adjudicates it. One stale entry must never lock the UI to a locale
    // with no translations (the invariant the #3376 guard was written for).
    const { result } = mountConsole({}, ['en', 'zh']);

    await waitFor(() => expect(result.current.language).toBe('en'));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('does not yank a language the user picked while the list was in flight', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'th');

    const { result } = mountConsole({}, ['en', 'zh']);
    await act(async () => {
      await result.current.changeLanguage('ja');
    });

    // The self-heal undoes exactly our own bootstrap optimism — never a
    // deliberate in-session choice that has since replaced it.
    await waitFor(() => expect(result.current.language).toBe('ja'));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja');
  });

  it('leaves the stored locale alone when the app answers with nothing', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'th');

    // An empty/failed answer is "I don't know", not "I ship no locales" —
    // a backend outage must not wipe the user's preference.
    const { result } = mountConsole({}, []);

    await waitFor(() => expect(result.current.language).toBe('th'));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('th');
  });

  it('an app with NO dynamic loader keeps the narrow bound', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'th');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(I18nProvider, {
        config: { defaultLanguage: 'en', detectBrowserLanguage: false },
        children,
      });
    const { result } = renderHook(() => useObjectTranslation(), { wrapper });

    // Nothing can fetch `th` here, so accepting it would be the very "locked to
    // a locale with no translations" state the guard exists to prevent. The
    // widening is scoped to apps that wired a loader; every other app keeps
    // exactly the #3376 behaviour.
    expect(result.current.language).toBe('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });
});

describe('offerableLanguages — the intersection the switcher renders', () => {
  it('is the app list ∩ what this renderer can resolve', async () => {
    const { result } = mountConsole({}, ['en', 'zh', 'th']);

    await waitFor(() => expect(result.current.offerableLanguages).toEqual(['en', 'zh', 'th']));
  });

  it('drops an app locale this renderer cannot produce', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(I18nProvider, {
        config: { defaultLanguage: 'en', detectBrowserLanguage: false },
        loadLocales: async () => ['en', 'zh', 'th'],
        children,
      });
    const { result } = renderHook(() => useObjectTranslation(), { wrapper });

    // No loader and no `config.resources`: `th` is in the app's list but this
    // renderer has no way to produce a single string of it.
    await waitFor(() => expect(result.current.offerableLanguages).toEqual(['en', 'zh']));
  });

  it('is null while the app list is in flight', () => {
    const { result } = mountConsole({ loadLocales: () => new Promise<string[]>(() => {}) });

    expect(result.current.offerableLanguages).toBeNull();
  });

  it('asks the app exactly once, under StrictMode and re-renders alike', async () => {
    // `main.tsx` mounts the console inside `<React.StrictMode>`, which
    // double-invokes effects — and an inline `loadLocales` prop changes
    // identity on every render. Both must still produce ONE request, and the
    // answer must still land: a guard that skips the re-run while the first
    // run's request was cancelled would leave the switcher blank forever.
    const calls = { n: 0 };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(I18nProvider, {
          config: { defaultLanguage: 'en', detectBrowserLanguage: false },
          loadLocales: async () => {
            calls.n += 1;
            return ['en', 'zh'];
          },
          children,
        }),
      );
    const { result, rerender } = renderHook(() => useObjectTranslation(), { wrapper });

    await waitFor(() => expect(result.current.offerableLanguages).toEqual(['en', 'zh']));
    rerender();
    rerender();
    expect(calls.n).toBe(1);
  });
});
