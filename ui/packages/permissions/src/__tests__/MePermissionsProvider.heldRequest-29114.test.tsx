/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#29114 — a `/me/permissions` request asked before its provider
 * mounted is taken by that provider, once, instead of asked a second time.
 *
 * The console asks as soon as the session answer names the active
 * organization (`startMePermissionsRequest`), while the provider that reads the
 * answer still waits below the organization gate and the metadata shell. These
 * pin what the provider does with that request: the same endpoint and key take
 * it as the first attempt (no second request); any other question asks as
 * before and drops it; a request nobody took can be released; and a transient
 * failure of the held request is retried like the provider's own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import {
  MePermissionsProvider,
  releaseMePermissionsRequest,
  startMePermissionsRequest,
} from '../MePermissionsProvider';
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

const ENDPOINT = '/api/v1/auth/me/permissions';
const answer = (allowEdit: boolean, status = 200) => ({
  ok: status < 400,
  status,
  headers: new Headers(),
  json: async () => ({
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    positions: [],
    permissionSets: [],
    objects: { account: { allowRead: true, allowEdit } },
    fields: {},
  }),
});

function renderProvider(fetcher: typeof fetch, requestKey?: string) {
  return render(
    <MePermissionsProvider endpoint={ENDPOINT} fetcher={fetcher} requestKey={requestKey} retryBaseDelayMs={1}>
      <Probe />
    </MePermissionsProvider>,
  );
}

beforeEach(() => {
  cleanup();
  // Nothing held across cases: a take empties the slot, and so does this.
  releaseMePermissionsRequest(ENDPOINT, 'u1:org_1');
  releaseMePermissionsRequest(ENDPOINT, 'u1:org_2');
});

describe('MePermissionsProvider takes the request asked before it mounted (objectstack#29114)', () => {
  it('the same endpoint and key: the held request is the answer, and the provider asks nothing', async () => {
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key: 'u1:org_1' });
    expect(early).toHaveBeenCalledTimes(1);

    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch, 'u1:org_1');
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(screen.getByTestId('edit').textContent).toBe('true');
    expect(own).not.toHaveBeenCalled();
    expect(early).toHaveBeenCalledTimes(1);
  });

  it('starting the same request twice asks once', () => {
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key: 'u1:org_1' });
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key: 'u1:org_1' });
    expect(early).toHaveBeenCalledTimes(1);
  });

  it('taken once: a second provider for the same key asks for itself', async () => {
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key: 'u1:org_1' });
    renderProvider(vi.fn(async () => answer(false)) as unknown as typeof fetch, 'u1:org_1');
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    cleanup();

    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch, 'u1:org_1');
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(own).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('edit').textContent).toBe('false');
  });

  it('another key is another question: the provider asks, and the held request is dropped', async () => {
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key: 'u1:org_1' });
    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch, 'u1:org_2');
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(own).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('edit').textContent).toBe('false');
    cleanup();

    // Dropped, not kept for later: the org_1 provider now asks for itself.
    const later = vi.fn(async () => answer(false));
    renderProvider(later as unknown as typeof fetch, 'u1:org_1');
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a provider without a key asks for itself, as before', async () => {
    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(own).toHaveBeenCalledTimes(1);
  });

  it('a released request is not taken', async () => {
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key: 'u1:org_1' });
    releaseMePermissionsRequest(ENDPOINT, 'u1:org_1');
    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch, 'u1:org_1');
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(own).toHaveBeenCalledTimes(1);
  });

  it('a transient failure of the held request is retried by the provider', async () => {
    const early = vi.fn(async () => answer(true, 503));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key: 'u1:org_1' });
    const own = vi.fn(async () => answer(true));
    renderProvider(own as unknown as typeof fetch, 'u1:org_1');
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(early).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledTimes(1);
  });
});
