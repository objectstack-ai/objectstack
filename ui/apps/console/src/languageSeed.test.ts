/**
 * `seedTenantLanguage` — the bounded first-visit race for the tenant's UI
 * language (objectui#4035, ruling point 3 on objectstack#5419).
 *
 * The contract these pin, in one sentence: the boot is never held for longer
 * than the bound, never fails closed, and never spends a request it does not
 * need — and a seed that arrives too late lands in the cache for the next boot
 * instead of yanking the language out from under a user mid-session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  I18nProvider,
  LOCALE_STORAGE_KEY,
  LOCALE_SEED_STORAGE_KEY,
  preloadBootstrapLocale,
  useObjectTranslation,
} from '@object-ui/i18n';
import { clearSharedDiscoveryCache } from '../../../packages/data-objectstack/src/sharedDiscovery';
import { resolveLocaleAmong } from '@objectstack/spec/system';
import { __resetPreferredLocaleForTests, pickPreferredLocale, seedTenantLanguage } from './languageSeed';

const BASE = '';
const TENANT_LOCALE = 'zh-CN';
const DISCOVERY = '/api/v1/discovery';

/**
 * Discovery as a server that serves no `locale` block (a 404): the browser
 * rung, which is what every test above the objectstack#33985 block exercises.
 */
const noDiscovery = { ok: false, status: 404, json: async () => ({}) };

/** How many `/auth/me/localization` requests went out. */
function meCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith(DISCOVERY)).length;
}

/** A fetch whose answer this test controls the timing of. */
function deferredFetch(body: unknown, ok = true) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith(DISCOVERY)) return noDiscovery;
    await gate;
    return { ok, status: ok ? 200 : 500, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, release };
}

function immediateFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn(async (url: string) =>
    String(url).endsWith(DISCOVERY)
      ? noDiscovery
      : { ok, status: ok ? 200 : 500, json: async () => body },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.localStorage.clear();
  __resetPreferredLocaleForTests();
  clearSharedDiscoveryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('seedTenantLanguage', () => {
  it('caches the tenant locale when the fetch wins the race', async () => {
    immediateFetch({ authenticated: true, locale: TENANT_LOCALE });

    await seedTenantLanguage(BASE, 1_000);

    // Cached before the boot proceeds, so the provider reads it synchronously
    // at bootstrap and the app mounts in the tenant's locale with no flash.
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe(TENANT_LOCALE);
  });

  it('gives up at the bound and still caches the late answer for the next boot', async () => {
    const { fetchMock, release } = deferredFetch({ authenticated: true, locale: TENANT_LOCALE });

    // The race is bounded: this resolves on the timeout, with the request still
    // in flight. If it were unbounded, a slow endpoint would hold first paint —
    // which is what the ruling forbids.
    await seedTenantLanguage(BASE, 1);
    await vi.waitFor(() => expect(meCalls(fetchMock)).toBe(1));
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull();

    // The answer is not thrown away — it lands in the cache, so the NEXT boot
    // is in the tenant's locale. Deliberately not a live switch: this boot has
    // already committed to browser/`en`, and swapping the whole UI at an
    // unbounded later moment is the opposite of a bounded race.
    release();
    await vi.waitFor(() =>
      expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe(TENANT_LOCALE),
    );
  });

  it('does not spend a request when the user already has an explicit choice', async () => {
    const fetchMock = immediateFetch({ authenticated: true, locale: TENANT_LOCALE });
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');

    await seedTenantLanguage(BASE, 1_000);

    // The user's choice outranks the tenant, so there is nothing to decide.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull();
  });

  it('does not wait when a seed is already cached (stale-while-revalidate)', async () => {
    const fetchMock = immediateFetch({ authenticated: true, locale: 'ja-JP' });
    window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, TENANT_LOCALE);

    await seedTenantLanguage(BASE, 1_000);

    // The cached seed applies at boot immediately. Revalidation is the in-app
    // `LocalizationFetchProvider` fetch's job — which already runs on every
    // boot, so racing a second request here would buy nothing. (The discovery
    // read it starts is the data adapter's own request, shared.)
    expect(meCalls(fetchMock)).toBe(0);
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe(TENANT_LOCALE);
  });

  it('treats an unauthenticated answer as saying nothing about the tenant', async () => {
    // The endpoint is allow-listed for gated users and replies like this before
    // sign-in. Writing it through would clear a good seed on every visit to the
    // login page.
    immediateFetch({ authenticated: false });

    await seedTenantLanguage(BASE, 1_000);

    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull();
  });

  it('never fails closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    // A language seed is cosmetic. Boot proceeds, unseeded.
    await expect(seedTenantLanguage(BASE, 1_000)).resolves.toBeUndefined();
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull();
  });

  it('ignores a non-OK response', async () => {
    immediateFetch({ authenticated: true, locale: TENANT_LOCALE }, false);

    await seedTenantLanguage(BASE, 1_000);

    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull();
  });

  it('cannot overrule a choice the user makes while it is still in flight', async () => {
    // The race pin. The seed's only application point is bootstrap, so an
    // answer that lands after the user has switched changes the CACHE and
    // nothing else — it never touches the explicit-choice slot and never
    // re-languages a live session.
    const { release } = deferredFetch({ authenticated: true, locale: TENANT_LOCALE });

    await seedTenantLanguage(BASE, 1);

    // The user switches to Japanese while the request is still outstanding.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'ja');

    release();
    await vi.waitFor(() =>
      expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe(TENANT_LOCALE),
    );

    // The explicit choice is untouched, and it is what the next boot reads.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja');
  });
});

describe('a supported browser language, else the server decides (objectstack#33985, objectstack#34392)', () => {
  /**
   * A server that answers `/auth/me/localization` by its rungs: the user's own
   * `sys_user.locale`, else the request's `Accept-Language` when the app lists
   * it (in the app's spelling), else the organization's `localization.locale`,
   * else the app's declared default. A request that states no
   * `Accept-Language` carries the browser's own, which is what a bare `fetch`
   * sends. Discovery serves the app's `locale.default` and `locale.supported`
   * (the default alone when no list is given); with no app default it serves
   * no locale block, and the server has no list to match the request against.
   */
  function fakeServer(opts: {
    appDefault?: string;
    supported?: string[];
    orgLocale?: string;
    userLocale?: string;
    browser: string;
  }) {
    const served = opts.appDefault ? (opts.supported ?? [opts.appDefault]) : undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith(DISCOVERY)) {
        if (!opts.appDefault) return noDiscovery;
        const data = { locale: { default: opts.appDefault, supported: served, timezone: 'UTC' } };
        return { ok: true, status: 200, json: async () => ({ success: true, data }) };
      }
      const stated = (init?.headers as Record<string, string> | undefined)?.['Accept-Language'];
      const requested = stated ?? opts.browser;
      const listed = served ? resolveLocaleAmong(requested, served) : requested;
      const locale = opts.userLocale ?? listed ?? opts.orgLocale ?? opts.appDefault;
      return { ok: true, status: 200, json: async () => ({ authenticated: true, locale }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(opts.browser);
    return fetchMock;
  }

  /** The `Accept-Language` the boot's localization read stated, if any. */
  function statedLanguage(fetchMock: ReturnType<typeof fakeServer>): string | undefined {
    const meInit = fetchMock.mock.calls.find(([url]) => !String(url).endsWith(DISCOVERY))?.[1];
    return (meInit?.headers as Record<string, string> | undefined)?.['Accept-Language'];
  }

  /** The console's first paint after the boot's seed: language, `<html lang>`, a label. */
  function Probe() {
    const { t, language } = useObjectTranslation();
    return createElement('span', { 'data-testid': 'probe' }, `${language}|${t('common.cancel')}`);
  }

  async function bootConsole(): Promise<{ text: string; htmlLang: string }> {
    await seedTenantLanguage(BASE, 1_000);
    await preloadBootstrapLocale({ hasLoader: true });
    render(createElement(I18nProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).not.toContain('common.cancel'));
    return { text: screen.getByTestId('probe').textContent ?? '', htmlLang: document.documentElement.lang };
  }

  afterEach(() => {
    cleanup();
    document.documentElement.lang = '';
  });

  it('a zh-CN browser on an app that ships zh-CN beside an en default gets zh-CN', async () => {
    const fetchMock = fakeServer({ appDefault: 'en', supported: ['en', 'zh-CN'], browser: 'zh-CN' });

    const seen = await bootConsole();

    expect(seen.text).toBe('zh-CN|取消');
    expect(seen.htmlLang).toBe('zh-CN');
    expect(statedLanguage(fetchMock)).toBe('zh-CN');
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe('zh-CN');
    // One discovery read, one localization read; nothing chosen on the device.
    expect(meCalls(fetchMock)).toBe(1);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it("an fr browser on an app that does not ship fr gets the organization's language (objectstack#34392)", async () => {
    const fetchMock = fakeServer({ appDefault: 'en', supported: ['en', 'zh-CN'], orgLocale: 'zh-CN', browser: 'fr' });

    const seen = await bootConsole();

    expect(seen.text).toBe('zh-CN|取消');
    expect(seen.htmlLang).toBe('zh-CN');
    // No language the app ships to state: the server's deployment default decides.
    expect(statedLanguage(fetchMock)).toBeUndefined();
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe('zh-CN');
  });

  it('CONTROL: an fr browser on the same app with no organization language gets the app default en', async () => {
    const fetchMock = fakeServer({ appDefault: 'en', supported: ['en', 'zh-CN'], browser: 'fr' });

    const seen = await bootConsole();

    expect(seen.text).toBe('en|Cancel');
    expect(seen.htmlLang).toBe('en');
    expect(statedLanguage(fetchMock)).toBeUndefined();
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe('en');
  });

  it('a browser language the app does not ship gets the app default (en-US browser, zh-CN app)', async () => {
    const fetchMock = fakeServer({ appDefault: 'zh-CN', supported: ['zh-CN'], browser: 'en-US' });

    const seen = await bootConsole();

    expect(seen.text).toBe('zh-CN|取消');
    expect(seen.htmlLang).toBe('zh-CN');
    expect(statedLanguage(fetchMock)).toBeUndefined();
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe('zh-CN');
  });

  it("a browser language the app ships still outranks the organization's language", async () => {
    const fetchMock = fakeServer({ appDefault: 'en', supported: ['en', 'zh-CN'], orgLocale: 'zh-CN', browser: 'en-GB' });

    const seen = await bootConsole();

    expect(seen.text).toBe('en|Cancel');
    expect(statedLanguage(fetchMock)).toBe('en');
  });

  it("an en-US browser on a zh-CN app that also ships en gets the app's en", async () => {
    const fetchMock = fakeServer({ appDefault: 'zh-CN', supported: ['zh-CN', 'en'], browser: 'en-US' });

    const seen = await bootConsole();

    expect(seen.text).toBe('en|Cancel');
    // The app's own spelling of the language it ships is what the server is asked for.
    expect(statedLanguage(fetchMock)).toBe('en');
  });

  it("a personal locale still outranks the browser and the app's declared default", async () => {
    fakeServer({ appDefault: 'en', supported: ['en', 'zh-CN'], userLocale: 'ja', browser: 'zh-CN' });

    const seen = await bootConsole();

    expect(seen.text).toBe('ja|キャンセル');
    expect(seen.htmlLang).toBe('ja');
  });

  it('with no locale block served, the browser language decides', async () => {
    const fetchMock = fakeServer({ browser: 'ja' });

    const seen = await bootConsole();

    expect(seen.text).toBe('ja|キャンセル');
    expect(seen.htmlLang).toBe('ja');
    // Nothing to state, so the request carried the browser's own header.
    expect(statedLanguage(fetchMock)).toBeUndefined();
  });
});

describe('pickPreferredLocale', () => {
  it('picks the browser language when the app lists it, in the app spelling', () => {
    expect(pickPreferredLocale('zh-CN', ['en', 'zh-CN'])).toBe('zh-CN');
    expect(pickPreferredLocale('zh-cn', ['en', 'zh-CN'])).toBe('zh-CN');
  });

  it('matches a regional browser tag to the bare language the app ships', () => {
    expect(pickPreferredLocale('en-US', ['zh-CN', 'en'])).toBe('en');
  });

  it("reads the browser tag through the platform table's aliases, as the server's rung does", () => {
    expect(pickPreferredLocale('ja', ['en', 'ja-JP'])).toBe('ja-JP');
    expect(pickPreferredLocale('zh-TW', ['en', 'zh-Hant'])).toBe('zh-Hant');
    expect(pickPreferredLocale('zh-HK', ['en', 'zh-Hant'])).toBe('zh-Hant');
  });

  it('expands a browser language to a variant the app ships', () => {
    expect(pickPreferredLocale('es-MX', ['en', 'es-ES'])).toBe('es-ES');
    expect(pickPreferredLocale('pt', ['en', 'pt-BR'])).toBe('pt-BR');
    // The platform table reads a bare `zh` as Simplified, as the server answers that header.
    expect(pickPreferredLocale('zh', ['en', 'zh-CN', 'zh-TW'])).toBe('zh-CN');
  });

  it('CONTROL: answers nothing for an unsupported or absent browser language, or an empty list (objectstack#34392)', () => {
    expect(pickPreferredLocale('fr', ['en', 'zh-CN'])).toBeUndefined();
    expect(pickPreferredLocale(undefined, ['en', 'zh-CN'])).toBeUndefined();
    expect(pickPreferredLocale('  ', ['en', 'zh-CN'])).toBeUndefined();
    expect(pickPreferredLocale('zh-CN', [])).toBeUndefined();
  });
});
