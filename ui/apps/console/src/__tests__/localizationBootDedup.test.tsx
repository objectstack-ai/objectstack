/**
 * objectui#5544 — one cold load, one `GET /api/v1/auth/me/localization`.
 *
 * On a device's true first visit two callers ask this endpoint at once:
 * `seedTenantLanguage()` (which keeps running past its 500 ms race, by design)
 * and `LocalizationFetchProvider` (which mounts as soon as that race resolves).
 * The card measured the pair as `me/localization ×2` on staging.
 *
 * The interesting half is not the request count — it is that the SECOND caller
 * must still be served. `LocalizationFetchProvider` is the one with a retry
 * policy, so these pin that a shared answer reaches it, that a shared 503
 * reaches it as a 503 (not as an empty success), and that once the shared
 * request has settled a later mount fetches again.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useLocalization, readCachedLanguageSeed } from '@object-ui/i18n';
import { clearSharedDiscoveryCache } from '../../../../packages/data-objectstack/src/sharedDiscovery';
import { resetInflightGetsForTesting } from '../../../../packages/types/src/http-inflight';
import { __resetPreferredLocaleForTests, seedTenantLanguage } from '../languageSeed';
import { LocalizationFetchProvider } from '../LocalizationFetchProvider';
// Off the `@object-ui/auth` barrel; the vitest alias maps that barrel to
// `packages/auth/src`, so this is the module the owner count is read from.
import { SessionUserScope } from '../../../../packages/auth/src/ActiveOrganizationStorage';

const ENDPOINT = '/api/v1/auth/me/localization';
const DISCOVERY = '/api/v1/discovery';

/**
 * The boot's discovery read (objectstack#33985) is the data adapter's request,
 * not this endpoint's: these answer it as a server serving no locale, unless a
 * test says otherwise, and count only the localization requests.
 */
const isDiscovery = (url: unknown) => String(url).endsWith(DISCOVERY);
const meCalls = (fetchStub: ReturnType<typeof vi.fn>) =>
  fetchStub.mock.calls.filter(([url]) => !isDiscovery(url)).length;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(body),
    headers: { get: () => null },
  } as unknown as Response;
}

/** Reads the value the provider publishes, so a starved consumer is visible. */
function Consumer() {
  const { currency, locale } = useLocalization();
  return <span data-testid="value">{`${locale ?? '-'}/${currency ?? '-'}`}</span>;
}

beforeEach(() => {
  resetInflightGetsForTesting();
  localStorage.clear();
  __resetPreferredLocaleForTests();
  clearSharedDiscoveryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetInflightGetsForTesting();
  localStorage.clear();
});

describe('first-visit localization request budget', () => {
  it('serves the seed and the provider from ONE request', async () => {
    const gate = deferred<Response>();
    const fetchStub = vi.fn((url: string) =>
      isDiscovery(url) ? Promise.resolve(jsonResponse({}, 404)) : gate.promise,
    );
    vi.stubGlobal('fetch', fetchStub);

    // True first visit: no stored choice, no cached seed ⇒ the seed fetches and
    // races a timeout. A tiny timeout keeps the test fast; the shape is the same
    // one production has at 500 ms — the race resolves while the fetch runs on.
    await seedTenantLanguage('', 1);
    await waitFor(() => expect(meCalls(fetchStub)).toBe(1));

    // The provider mounts right after the boot's `Promise.all` resolves — while
    // the seed's request is still in flight.
    render(
      <LocalizationFetchProvider endpoint={ENDPOINT}>
        <Consumer />
      </LocalizationFetchProvider>,
    );

    gate.resolve(jsonResponse({ authenticated: true, locale: 'zh-CN', currency: 'CNY' }));

    // ── the consumer is served, not starved ──
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('zh-CN/CNY'));
    // ── and the seed got the same answer ──
    await waitFor(() => expect(readCachedLanguageSeed()).toBe('zh-CN'));
    // ── from one network call ──
    expect(meCalls(fetchStub)).toBe(1);
  });

  it('still ONE request when both state the supported browser language (objectstack#33985)', async () => {
    const gate = deferred<Response>();
    const fetchStub = vi.fn((url: string, _init?: RequestInit) =>
      isDiscovery(url)
        ? Promise.resolve(jsonResponse({ locale: { default: 'en', supported: ['en', 'zh-CN'], timezone: 'UTC' } }))
        : gate.promise,
    );
    vi.stubGlobal('fetch', fetchStub);
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('zh-CN');

    await seedTenantLanguage('', 1);
    await waitFor(() => expect(meCalls(fetchStub)).toBe(1));
    render(
      <LocalizationFetchProvider endpoint={ENDPOINT}>
        <Consumer />
      </LocalizationFetchProvider>,
    );

    gate.resolve(jsonResponse({ authenticated: true, locale: 'zh-CN', currency: 'CNY' }));

    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('zh-CN/CNY'));
    await waitFor(() => expect(readCachedLanguageSeed()).toBe('zh-CN'));
    // The two state the same `Accept-Language`, so they share the request.
    expect(meCalls(fetchStub)).toBe(1);
    const stated = fetchStub.mock.calls
      .filter(([url]) => !isDiscovery(url))
      .map(([, init]) => init?.headers as Record<string, string>);
    expect(stated.map((h) => h['Accept-Language'])).toEqual(['zh-CN']);
  });

  it('passes a shared 503 through to the retry policy rather than resolving it empty', async () => {
    const gate = deferred<Response>();
    let first = true;
    const fetchStub = vi.fn(async (url: string) => {
      if (isDiscovery(url)) return jsonResponse({}, 404);
      if (first) {
        first = false;
        return gate.promise;
      }
      return jsonResponse({ authenticated: true, locale: 'ja-JP', currency: 'JPY' });
    });
    vi.stubGlobal('fetch', fetchStub);

    await seedTenantLanguage('', 1);
    render(
      <LocalizationFetchProvider endpoint={ENDPOINT}>
        <Consumer />
      </LocalizationFetchProvider>,
    );

    // The shared request fails transiently. Both sharers see the failure; only
    // the provider has a retry policy, and it must still fire — a dedup that
    // handed it an empty success would leave the console with no currency and
    // no way back.
    gate.resolve(jsonResponse(null, 503));

    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('ja-JP/JPY'), {
      timeout: 5000,
    });
    expect(meCalls(fetchStub)).toBeGreaterThanOrEqual(2);
  });

  it('takes the seed\'s settled answer: one request even when the seed settled before the mount (objectstack#35455)', async () => {
    const fetchStub = vi.fn(async (url: string) =>
      isDiscovery(url)
        ? jsonResponse({}, 404)
        : jsonResponse({ authenticated: true, locale: 'en-US', currency: 'USD' }),
    );
    vi.stubGlobal('fetch', fetchStub);

    // The seed's request settles completely inside its race, before the mount.
    await seedTenantLanguage('', 1_000);
    // CONTROL (the locale still applies before first paint): the seed is
    // cached by the time the boot's race resolves, ahead of any render.
    expect(readCachedLanguageSeed()).toBe('en-US');
    expect(meCalls(fetchStub)).toBe(1);

    render(
      <LocalizationFetchProvider endpoint={ENDPOINT}>
        <Consumer />
      </LocalizationFetchProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('en-US/USD'));
    expect(meCalls(fetchStub)).toBe(1);
  });

  it('CONTROL: the hand-off is spent once — a later mount asks the server', async () => {
    const fetchStub = vi.fn(async (url: string) =>
      isDiscovery(url)
        ? jsonResponse({}, 404)
        : jsonResponse({ authenticated: true, locale: 'en-US', currency: 'USD' }),
    );
    vi.stubGlobal('fetch', fetchStub);

    await seedTenantLanguage('', 1_000);
    const first = render(
      <LocalizationFetchProvider endpoint={ENDPOINT}>
        <Consumer />
      </LocalizationFetchProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('en-US/USD'));
    first.unmount();

    render(
      <LocalizationFetchProvider endpoint={ENDPOINT}>
        <Consumer />
      </LocalizationFetchProvider>,
    );
    await waitFor(() => expect(meCalls(fetchStub)).toBe(2));
  });

  it('CONTROL: an unauthenticated seed answer is not handed over', async () => {
    let answer: unknown = { authenticated: false };
    const fetchStub = vi.fn(async (url: string) =>
      isDiscovery(url) ? jsonResponse({}, 404) : jsonResponse(answer),
    );
    vi.stubGlobal('fetch', fetchStub);

    await seedTenantLanguage('', 1_000);
    expect(meCalls(fetchStub)).toBe(1);
    // Signed in since: the provider's read is about the caller, so it asks.
    answer = { authenticated: true, locale: 'ja-JP', currency: 'JPY' };

    render(
      <LocalizationFetchProvider endpoint={ENDPOINT}>
        <Consumer />
      </LocalizationFetchProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('ja-JP/JPY'));
    expect(meCalls(fetchStub)).toBe(2);
  });

  it('CONTROL: an answer asked for the previous owner of the browser is not handed over', async () => {
    SessionUserScope._resetForTests();
    localStorage.setItem('auth-session-user-id', 'u_alice');
    let answer: unknown = { authenticated: true, locale: 'de-DE', currency: 'EUR' };
    const fetchStub = vi.fn(async (url: string) =>
      isDiscovery(url) ? jsonResponse({}, 404) : jsonResponse(answer),
    );
    vi.stubGlobal('fetch', fetchStub);

    await seedTenantLanguage('', 1_000);
    expect(readCachedLanguageSeed()).toBe('de-DE');
    // The browser changes hands between the seed's answer and the mount.
    expect(SessionUserScope.adopt('u_bob')).toBe(true);
    answer = { authenticated: true, locale: 'fr-FR', currency: 'EUR' };

    render(
      <LocalizationFetchProvider endpoint={ENDPOINT}>
        <Consumer />
      </LocalizationFetchProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('fr-FR/EUR'));
    expect(meCalls(fetchStub)).toBe(2);
  });
});
