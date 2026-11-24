// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36732 — the desktop Home target never names an app the member's
 * permission sets hide, wherever the chrome reads it.
 *
 * `useHomePath()` narrows through `useServedApps`, which narrows only below a
 * `LauncherAppsProvider` whose `/me/apps` answer is held. `/studio/*` and
 * `/ai/*` mount the chrome OUTSIDE that provider, and inside it the first
 * read can still be out: in both places the list is unnarrowed, so the hook
 * must name `/home` (the route that waits for the answer) and not resolve an
 * app itself.
 *
 * These run the REAL provider and hook — no `useLauncherApps` mock — fed a
 * `/me/apps` double.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  lastApp: null as string | null,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: state.apps, loading: false }),
}));
vi.mock('../usePhoneViewport', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePhoneViewport: () => false,
}));
vi.mock('../../context/LastAppProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLastApp: () => ({ lastApp: state.lastApp, settled: true, rememberApp: () => {} }),
}));

import { LauncherAppsProvider } from '../useLauncherApps';
import { useHomePath } from '../useHomePath';

const ENDPOINT = '/me-apps-double';

function HomeProbe() {
  return <div data-testid="home">{useHomePath()}</div>;
}

beforeEach(() => {
  // `hr` is the member's last app, and a permission set hides it.
  state.apps = [{ name: 'hr' }, { name: 'sales' }, { name: 'setup', _packageId: 'com.objectstack.setup' }];
  state.lastApp = 'hr';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectstack#36732 — the desktop Home target and a set-hidden app', () => {
  it('outside a LauncherAppsProvider (studio, ai) names /home, never the hidden last app', () => {
    render(<HomeProbe />);
    expect(screen.getByTestId('home')).toHaveTextContent(/^\/home$/);
  });

  it('inside the provider names /home while the first read is out, then the first app it serves', async () => {
    let answer!: (res: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    render(
      <LauncherAppsProvider endpoint={ENDPOINT} fetcher={fetcher as unknown as typeof fetch}>
        <HomeProbe />
      </LauncherAppsProvider>,
    );
    expect(screen.getByTestId('home')).toHaveTextContent(/^\/home$/);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    answer(new Response(JSON.stringify({ apps: [{ name: 'sales' }, { name: 'setup' }] }), { status: 200 }));
    await waitFor(() => expect(screen.getByTestId('home')).toHaveTextContent(/^\/apps\/sales$/));
  });

  it('inside the provider, a failed read settles and falls open to the declared list', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi.fn(async () => new Response('{}', { status: 500 }));
    render(
      <LauncherAppsProvider endpoint={ENDPOINT} fetcher={fetcher as unknown as typeof fetch}>
        <HomeProbe />
      </LauncherAppsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('home')).toHaveTextContent(/^\/apps\/hr$/));
  });
});
