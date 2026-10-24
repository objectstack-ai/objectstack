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
import { resetInflightGetsForTesting } from '@object-ui/types';
import { seedTenantLanguage } from '../languageSeed';
import { LocalizationFetchProvider } from '../LocalizationFetchProvider';

const ENDPOINT = '/api/v1/auth/me/localization';

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
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetInflightGetsForTesting();
  localStorage.clear();
});

describe('first-visit localization request budget', () => {
  it('serves the seed and the provider from ONE request', async () => {
    const gate = deferred<Response>();
    const fetchStub = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchStub);

    // True first visit: no stored choice, no cached seed ⇒ the seed fetches and
    // races a timeout. A tiny timeout keeps the test fast; the shape is the same
    // one production has at 500 ms — the race resolves while the fetch runs on.
    await seedTenantLanguage('', 1);
    expect(fetchStub).toHaveBeenCalledTimes(1);

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
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('passes a shared 503 through to the retry policy rather than resolving it empty', async () => {
    const gate = deferred<Response>();
    const fetchStub = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockImplementation(async () =>
        jsonResponse({ authenticated: true, locale: 'ja-JP', currency: 'JPY' }),
      );
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
    expect(fetchStub.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not share once the request has settled', async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse({ authenticated: true, locale: 'en-US', currency: 'USD' }),
    );
    vi.stubGlobal('fetch', fetchStub);

    // Let the seed's request settle completely before the provider mounts.
    await seedTenantLanguage('', 1);
    await waitFor(() => expect(readCachedLanguageSeed()).toBe('en-US'));
    expect(fetchStub).toHaveBeenCalledTimes(1);

    render(
      <LocalizationFetchProvider endpoint={ENDPOINT}>
        <Consumer />
      </LocalizationFetchProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('en-US/USD'));
    // Two waves, two requests: this is in-flight sharing, not a cache.
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});
