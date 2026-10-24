/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * "Not now" is a real answer from `/me/permissions`, and it used to strand the
 * console.
 *
 * On a multi-tenant host the endpoint is served by the environment kernel that
 * owns the session, and a COLD one answers `503` + `Retry-After` while it warms
 * (objectstack#4159 / cloud#927). The provider treated that like any other
 * failure: it set `error`, and a consumer that passes no `errorFallback` — the
 * console passes only `loadingFallback={<LoadingScreen />}` — renders the
 * loading node for the error state too. So the app sat on its spinner forever,
 * with a `retry` nobody could reach.
 *
 * These pin the retry: transient answers are re-attempted (server-stated delay
 * first), real answers about the caller are not, and the fail-closed loading
 * state holds throughout rather than flashing permissive.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider } from '../MePermissionsProvider';
import { parseRetryAfterMs } from '@object-ui/types';
import { usePermissions } from '../usePermissions';

function Probe() {
  const { isLoaded, check } = usePermissions();
  return (
    <div>
      <span data-testid="loaded">{String(isLoaded)}</span>
      <span data-testid="edit">{String(check('account', 'update').allowed)}</span>
    </div>
  );
}

const PAYLOAD = {
  authenticated: true,
  userId: 'u1',
  tenantId: 't1',
  roles: [],
  permissionSets: ['member_default'],
  objects: { account: { allowRead: true, allowEdit: false } },
  fields: {},
};

const ok = () => ({ ok: true, status: 200, headers: new Headers(), json: async () => PAYLOAD });
const fail = (status: number, headers: Record<string, string> = {}) => ({
  ok: false,
  status,
  headers: new Headers(headers),
  json: async () => ({}),
});

/** Render with retries fast enough that the tests need no timer control. */
const renderProvider = (props: Record<string, unknown> = {}) =>
  render(
    <MePermissionsProvider retryBaseDelayMs={1} {...props}>
      <Probe />
    </MePermissionsProvider>,
  );

describe('MePermissionsProvider retries a transient failure', () => {
  beforeEach(() => { vi.spyOn(global, 'fetch' as any); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('recovers from a warming 503 and serves the real answer', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(fail(503, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(ok());

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    // The permission answer really arrived — not the anonymous fail-open.
    expect(screen.getByTestId('edit').textContent).toBe('false');
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);
  });

  it('prefers the server-stated Retry-After over its own backoff', async () => {
    // Timer-free proof: the backoff base is 100s, so if the header were ignored
    // this test could not finish. `Retry-After: 0` says "now".
    (global.fetch as any)
      .mockResolvedValueOnce(fail(503, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(ok());

    renderProvider({ retryBaseDelayMs: 100_000 });

    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
  });

  it('retries a thrown fetch (offline / DNS / aborted) too', async () => {
    (global.fetch as any)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok());

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
  });

  it('holds the fail-closed loading state while retrying — never a permissive flash', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(ok());

    renderProvider({ loadingFallback: <span data-testid="spinner" /> });

    // Children (and therefore any permissive default) are not rendered yet.
    expect(screen.getByTestId('spinner')).toBeTruthy();
    expect(screen.queryByTestId('loaded')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
  });

  it('gives up after maxRetries and surfaces the error', async () => {
    (global.fetch as any).mockResolvedValue(fail(503));

    const errorFallback = vi.fn((err: Error) => <span data-testid="err">{err.message}</span>);
    renderProvider({ maxRetries: 2, errorFallback });

    await waitFor(() => expect(screen.getByTestId('err')).toBeTruthy());
    expect(screen.getByTestId('err').textContent).toContain('503');
    expect((global.fetch as any)).toHaveBeenCalledTimes(3); // 1 attempt + 2 retries
  });
});

describe('MePermissionsProvider does NOT retry a real answer about the caller', () => {
  beforeEach(() => { vi.spyOn(global, 'fetch' as any); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([401, 403, 404, 500])('gives up immediately on %i', async (status) => {
    (global.fetch as any).mockResolvedValue(fail(status));

    const errorFallback = vi.fn((err: Error) => <span data-testid="err">{err.message}</span>);
    renderProvider({ errorFallback });

    await waitFor(() => expect(screen.getByTestId('err')).toBeTruthy());
    expect((global.fetch as any)).toHaveBeenCalledTimes(1);
  });

  it('maxRetries: 0 disables retrying entirely', async () => {
    (global.fetch as any).mockResolvedValue(fail(503));

    const errorFallback = vi.fn((err: Error) => <span data-testid="err">{err.message}</span>);
    renderProvider({ maxRetries: 0, errorFallback });

    await waitFor(() => expect(screen.getByTestId('err')).toBeTruthy());
    expect((global.fetch as any)).toHaveBeenCalledTimes(1);
  });
});

describe('parseRetryAfterMs', () => {
  const NOW = Date.parse('2026-07-30T12:00:00Z');

  it('reads delta-seconds', () => {
    expect(parseRetryAfterMs('4', NOW)).toBe(4000);
    expect(parseRetryAfterMs('0', NOW)).toBe(0);
    expect(parseRetryAfterMs('  7  ', NOW)).toBe(7000);
  });

  it('reads an HTTP-date, relative to now', () => {
    expect(parseRetryAfterMs('Thu, 30 Jul 2026 12:00:03 GMT', NOW)).toBe(3000);
  });

  it('clamps a far-future value so it cannot park the UI', () => {
    expect(parseRetryAfterMs('999999', NOW)).toBe(30_000);
    expect(parseRetryAfterMs('Fri, 31 Jul 2026 12:00:00 GMT', NOW)).toBe(30_000);
  });

  it('ignores absent, empty, unparseable and past values', () => {
    for (const v of [null, undefined, '', '   ', 'soon', 'Thu, 30 Jul 2026 11:59:00 GMT']) {
      expect(parseRetryAfterMs(v, NOW), String(v)).toBeUndefined();
    }
  });
});
