/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `/auth/me/localization` answers `503` + `Retry-After` while a cold environment
 * kernel warms (objectstack#4159), so a transient failure is a normal part of a
 * cold start on a multi-tenant host. This provider used to make ONE attempt and
 * `.catch()` into silence, which meant a single 503 during warm-up degraded
 * currency and locale for the whole session — silently, permanently, long after
 * the kernel was ready.
 *
 * These pin the recovery AND the posture it must not lose: unlike the permission
 * layer, this one is cosmetic, so it keeps rendering children throughout and
 * never gates the app on the answer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LOCALE_SEED_STORAGE_KEY, LOCALE_STORAGE_KEY, useLocalization } from '@object-ui/i18n';
import { formatDateTime, setDisplayTimeZone } from '@object-ui/core';
import { LocalizationFetchProvider } from './LocalizationFetchProvider';
// Not on the `@object-ui/auth` barrel; the vitest alias maps that barrel to
// `packages/auth/src`, so this deep path is the SAME module instance the
// provider's `getSessionOwnerChangeCount` reads.
import { SessionUserScope } from '../../../packages/auth/src/ActiveOrganizationStorage';

const ENDPOINT = '/api/v1/auth/me/localization';

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => body,
});
const fail = (status: number, headers: Record<string, string> = {}) => ({
  ok: false,
  status,
  headers: new Headers(headers),
  json: async () => ({}),
});

function renderProvider() {
  return render(
    <LocalizationFetchProvider endpoint={ENDPOINT}>
      <span data-testid="child">child</span>
    </LocalizationFetchProvider>,
  );
}

describe('LocalizationFetchProvider', () => {
  beforeEach(() => { vi.spyOn(globalThis, 'fetch' as never); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('recovers from a warming 503 instead of degrading for the session', async () => {
    (globalThis.fetch as never as ReturnType<typeof vi.fn>)
      // `Retry-After: 0` keeps the test timer-free while still exercising the
      // server-stated-delay path.
      .mockResolvedValueOnce(fail(503, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(ok({ authenticated: true, currency: 'CNY', locale: 'zh-CN' }));

    renderProvider();

    await waitFor(() =>
      expect((globalThis.fetch as never as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2),
    );
    // The point of the retry: the tenant default actually arrives.
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('retries a thrown fetch (offline / DNS / aborted) too', async () => {
    (globalThis.fetch as never as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok({ authenticated: true, currency: 'EUR' }));

    renderProvider();

    // A thrown fetch carries no `Retry-After`, so this one waits out the real
    // exponential backoff (BASE_DELAY_MS) rather than a server-stated 0.
    await waitFor(
      () => expect((globalThis.fetch as never as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2),
      { timeout: 4000 },
    );
  }, 10_000);

  it.each([401, 403, 404, 500])(
    'does NOT retry %i — a real answer about this caller will not change',
    async (status) => {
      (globalThis.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue(fail(status));

      renderProvider();

      // Give any (wrongly scheduled) retry a chance to fire before asserting.
      await new Promise((r) => setTimeout(r, 50));
      expect((globalThis.fetch as never as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    },
  );

  it('never blocks: children render while the fetch is still failing', async () => {
    (globalThis.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue(
      fail(503, { 'Retry-After': '0' }),
    );

    renderProvider();

    // The posture that separates this provider from MePermissionsProvider — it
    // is cosmetic, so nothing waits on the answer, not even mid-retry.
    expect(screen.getByTestId('child')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('stops after the retry budget rather than hammering forever', async () => {
    (globalThis.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue(
      fail(503, { 'Retry-After': '0' }),
    );

    renderProvider();

    // 1 attempt + MAX_RETRIES(4); waitFor settles once the count stops moving.
    await waitFor(() =>
      expect((globalThis.fetch as never as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(5),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect((globalThis.fetch as never as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(5);
  });

  // The UI-language seed cache (objectui#4035). This provider is the
  // "revalidate" half of stale-while-revalidate: it already fetches the tenant
  // locale on every boot, so refreshing the cache here costs no extra request
  // and keeps a tenant reconfiguration reaching choice-less devices.
  describe('tenant language seed cache', () => {
    beforeEach(() => { window.localStorage.clear(); });

    it('refreshes the seed cache from a successful answer', async () => {
      (globalThis.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok({ authenticated: true, currency: 'CNY', locale: 'zh-CN' }),
      );

      renderProvider();

      await waitFor(() =>
        expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe('zh-CN'),
      );
      // A cache write only — this boot's language is already decided, and the
      // explicit-choice slot is never touched by a server value.
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    });

    it('clears the seed when the tenant unsets its locale', async () => {
      window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, 'zh-CN');
      (globalThis.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok({ authenticated: true, currency: 'USD', locale: null }),
      );

      renderProvider();

      // An old seed must never pin a device past a tenant reconfiguration.
      await waitFor(() =>
        expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull(),
      );
    });

    it('keeps a good seed when the fetch never succeeds', async () => {
      window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, 'zh-CN');
      (globalThis.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue(
        fail(503, { 'Retry-After': '0' }),
      );

      renderProvider();

      // Revalidation that cannot complete leaves the stale value in place —
      // that is the whole point of stale-while-revalidate.
      await waitFor(() =>
        expect((globalThis.fetch as never as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(5),
      );
      expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe('zh-CN');
    });

    // objectui#10193: the write sits outside the `cancelled` guard on purpose,
    // so an answer requested for the PREVIOUS owner could land after
    // `SessionUserScope.adopt` handed the browser to someone else, and seed
    // the new owner's next boot with the previous owner's language.
    it('drops an answer that lands after the browser changed owner', async () => {
      SessionUserScope._resetForTests();
      window.localStorage.setItem('auth-session-user-id', 'u_alice');
      let answer!: (value: unknown) => void;
      (globalThis.fetch as never as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => { answer = resolve; }),
      );

      renderProvider();
      await waitFor(() => expect(answer).toBeTypeOf('function'));

      // The browser changes hands while Alice's request is in flight…
      expect(SessionUserScope.adopt('u_bob')).toBe(true);
      // …and then her answer arrives.
      answer(ok({ authenticated: true, currency: 'JPY', locale: 'ja' }));
      await new Promise((r) => setTimeout(r, 20));

      expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull();
      // One request, answered — not a request that never came back.
      expect((globalThis.fetch as never as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });
  });

  // objectui#11693: the answer carries `timezone` beside `currency` and
  // `locale`, and this provider used to keep only those two. The probe renders
  // a datetime through the central face the way a cell does — locale threaded,
  // zone not — so the served zone has to arrive through the provider alone.
  // The suite runs in UTC (objectui#8366), so UTC is the viewer's zone here.
  describe('the served time zone', () => {
    /** 03:00 on Sep 2nd in UTC, 11:00 on Sep 2nd in Shanghai. */
    const INSTANT = '2026-09-02T03:00:00.000Z';

    function ZoneProbe() {
      const { timezone } = useLocalization();
      return <span data-testid="zone">{`${timezone ?? '∅'}|${formatDateTime(INSTANT, { locale: 'en-US' })}`}</span>;
    }

    function renderZoneProbe() {
      return render(
        <LocalizationFetchProvider endpoint={ENDPOINT}>
          <ZoneProbe />
        </LocalizationFetchProvider>,
      );
    }

    afterEach(() => { setDisplayTimeZone(undefined); });

    it('renders a datetime in the zone the server answers', async () => {
      (globalThis.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok({ authenticated: true, currency: null, locale: 'en-US', timezone: 'Asia/Shanghai' }),
      );

      renderZoneProbe();

      // Before the answer the viewer's zone renders, as it always did.
      expect(screen.getByTestId('zone')).toHaveTextContent('∅|Sep 2, 2026, 03:00 AM');
      await waitFor(() =>
        expect(screen.getByTestId('zone')).toHaveTextContent('Asia/Shanghai|Sep 2, 2026, 11:00 AM'),
      );
    });

    it('an answer with no zone leaves the viewer\'s zone in place', async () => {
      (globalThis.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok({ authenticated: true, currency: 'CNY', locale: 'en-US', timezone: null }),
      );

      renderZoneProbe();

      await waitFor(() =>
        expect((globalThis.fetch as never as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1),
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.getByTestId('zone')).toHaveTextContent('∅|Sep 2, 2026, 03:00 AM');
    });
  });
});
