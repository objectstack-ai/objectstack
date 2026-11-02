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
 * before and drops it; a request nobody took can be released; a StrictMode
 * replay of either end asks nothing extra; and a transient failure of the held
 * request is retried like the provider's own.
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

let n = 0;
/** A key no earlier case asked for, so nothing held by one case reaches the next. */
const freshKey = () => `u${++n}:org_1`;
const nextTask = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  cleanup();
});

describe('MePermissionsProvider takes the request asked before it mounted (objectstack#29114)', () => {
  it('the same endpoint and key: the held request is the answer, and the provider asks nothing', async () => {
    const key = freshKey();
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key });
    expect(early).toHaveBeenCalledTimes(1);

    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch, key);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(screen.getByTestId('edit').textContent).toBe('true');
    expect(own).not.toHaveBeenCalled();
    expect(early).toHaveBeenCalledTimes(1);
  });

  it('starting the same request twice asks once', () => {
    const key = freshKey();
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key });
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key });
    expect(early).toHaveBeenCalledTimes(1);
  });

  it('used once: a second provider for the same key asks for itself', async () => {
    const key = freshKey();
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key });
    renderProvider(vi.fn(async () => answer(false)) as unknown as typeof fetch, key);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    cleanup();

    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch, key);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(own).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('edit').textContent).toBe('false');
  });

  it('another key is another question: the provider asks, and the held request is dropped', async () => {
    const key = freshKey();
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key });
    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch, `${key}:other`);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(own).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('edit').textContent).toBe('false');
    cleanup();

    // Dropped, not kept for later: a provider for the first key now asks for itself.
    const later = vi.fn(async () => answer(false));
    renderProvider(later as unknown as typeof fetch, key);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a provider without a key asks for itself, as before', async () => {
    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(own).toHaveBeenCalledTimes(1);
  });

  it('a released request is dropped on the next task and is not taken', async () => {
    const key = freshKey();
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key });
    releaseMePermissionsRequest(ENDPOINT, key);
    await nextTask();
    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch, key);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(own).toHaveBeenCalledTimes(1);
  });

  it('a replayed starter (start, release, start) asks once, and the provider takes that request', async () => {
    const key = freshKey();
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key });
    releaseMePermissionsRequest(ENDPOINT, key);
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key });
    await nextTask();
    const own = vi.fn(async () => answer(false));
    renderProvider(own as unknown as typeof fetch, key);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(early).toHaveBeenCalledTimes(1);
    expect(own).not.toHaveBeenCalled();
  });

  it('under StrictMode (the provider effect mounts, unmounts, mounts) the held request is still the only one', async () => {
    const key = freshKey();
    const early = vi.fn(async () => answer(true));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key });
    const own = vi.fn(async () => answer(false));
    render(
      <React.StrictMode>
        <MePermissionsProvider endpoint={ENDPOINT} fetcher={own as unknown as typeof fetch} requestKey={key} retryBaseDelayMs={1}>
          <Probe />
        </MePermissionsProvider>
      </React.StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(screen.getByTestId('edit').textContent).toBe('true');
    expect(own).not.toHaveBeenCalled();
    expect(early).toHaveBeenCalledTimes(1);
  });

  it('a transient failure of the held request is retried by the provider', async () => {
    const key = freshKey();
    const early = vi.fn(async () => answer(true, 503));
    startMePermissionsRequest({ endpoint: ENDPOINT, fetcher: early as unknown as typeof fetch, key });
    const own = vi.fn(async () => answer(true));
    renderProvider(own as unknown as typeof fetch, key);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(early).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledTimes(1);
  });
});
