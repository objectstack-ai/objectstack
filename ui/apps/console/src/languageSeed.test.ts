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
import { clearSharedDiscoveryCache } from '@object-ui/data-objectstack';
import { __resetAppDefaultLocaleForTests, seedTenantLanguage } from './languageSeed';

const BASE = '';
const TENANT_LOCALE = 'zh-CN';
const DISCOVERY = '/api/v1/discovery';

/**
 * Discovery as a server that serves no `locale.default` (a 404): the browser
 * rung, which is what every test above the objectstack#33231 block exercises.
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
  __resetAppDefaultLocaleForTests();
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

describe("the app's declared default outranks the browser (objectstack#33231)", () => {
  /**
   * A server that answers `/auth/me/localization` by its three rungs: the
   * user's own `sys_user.locale`, else the request's `Accept-Language`, else
   * the deployment default. A request that states no `Accept-Language` carries
   * the browser's own, which is what a bare `fetch` sends.
   */
  function fakeServer(opts: { appDefault?: string; userLocale?: string; browser: string }) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith(DISCOVERY)) {
        if (!opts.appDefault) return noDiscovery;
        const data = { locale: { default: opts.appDefault, supported: [opts.appDefault], timezone: 'UTC' } };
        return { ok: true, status: 200, json: async () => ({ success: true, data }) };
      }
      const stated = (init?.headers as Record<string, string> | undefined)?.['Accept-Language'];
      const locale = opts.userLocale ?? stated ?? opts.browser;
      return { ok: true, status: 200, json: async () => ({ authenticated: true, locale }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(opts.browser);
    return fetchMock;
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

  it('a user with no personal locale gets the declared zh-CN in an en-US browser', async () => {
    const fetchMock = fakeServer({ appDefault: 'zh-CN', browser: 'en-US' });

    const seen = await bootConsole();

    expect(seen.text).toBe('zh-CN|取消');
    expect(seen.htmlLang).toBe('zh-CN');
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe('zh-CN');
    // One discovery read, one localization read; nothing chosen on the device.
    expect(meCalls(fetchMock)).toBe(1);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it("a personal locale still outranks the app's declared default", async () => {
    fakeServer({ appDefault: 'zh-CN', userLocale: 'en', browser: 'zh-CN' });

    const seen = await bootConsole();

    expect(seen.text).toBe('en|Cancel');
    expect(seen.htmlLang).toBe('en');
  });

  it('with no default served, the browser language decides', async () => {
    const fetchMock = fakeServer({ browser: 'ja' });

    const seen = await bootConsole();

    expect(seen.text).toBe('ja|キャンセル');
    expect(seen.htmlLang).toBe('ja');
    // No default to state, so the request carried the browser's own header.
    const meInit = fetchMock.mock.calls.find(([url]) => !String(url).endsWith(DISCOVERY))?.[1];
    expect((meInit?.headers as Record<string, string>)['Accept-Language']).toBeUndefined();
  });
});
