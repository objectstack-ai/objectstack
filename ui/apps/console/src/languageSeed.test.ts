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
import { LOCALE_STORAGE_KEY, LOCALE_SEED_STORAGE_KEY } from '@object-ui/i18n';
import { seedTenantLanguage } from './languageSeed';

const BASE = '';
const TENANT_LOCALE = 'zh-CN';

/** A fetch whose answer this test controls the timing of. */
function deferredFetch(body: unknown, ok = true) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchMock = vi.fn(async () => {
    await gate;
    return { ok, status: ok ? 200 : 500, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, release };
}

function immediateFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.localStorage.clear();
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    // boot, so racing a second request here would buy nothing.
    expect(fetchMock).not.toHaveBeenCalled();
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
