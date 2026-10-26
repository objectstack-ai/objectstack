/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12980, part 3 — two shell readers that mount UNDER the boot splash
 * wait for the page's first paint, not the splash's:
 *
 *   - `NavigationSyncEffect` reads the `pages` / `dashboards` lists (lazy
 *     getters: reading one starts its `/meta/:type` read) only once the splash
 *     is gone and a frame has painted;
 *   - the bell's Activity feed, until the bell asks for it, does not even ask
 *     whether `sys_activity` exists: inside an app that answer is its own
 *     by-name read through the app's object scope, which used to go out in
 *     the chrome's render on every open;
 *   - `useSignedInUserLocale` reads the user's `sys_user` row at the same
 *     moment, not beside the page's own reads. It is kept (not folded into
 *     `GET /auth/me/localization`): that answer merges the column with the
 *     request's `Accept-Language` and the deployment default, and this hook
 *     must tell "the column is unset" apart.
 *
 * Each case: (a) nothing is read while the splash is up; (b) the read goes out
 * once it is gone, and its data is used.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, renderHook, screen, waitFor, act } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { MetadataCtx, AdapterCtx, type MetadataContextValue } from '@object-ui/react';

const session = vi.hoisted(() => ({
  user: null as { id: string } | null,
  adapter: null as unknown,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: session.user, isAuthenticated: Boolean(session.user), isLoading: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NavigationSyncEffect } from '../useNavigationSync';
import { useSignedInUserLocale } from '../useUserLocale';
import { __resetFirstPaint, useSharedActivityFeed } from '../sharedUserFeeds';
import { ExpressionProvider } from '../../providers/ExpressionProvider';

let splash: HTMLElement | null = null;
function raiseSplash() {
  splash = document.createElement('div');
  splash.setAttribute('data-boot-splash', '');
  document.body.appendChild(splash);
}
function dropSplash() {
  act(() => {
    splash?.remove();
    splash = null;
  });
}
/** A few real frames: long enough for a deferred read to have gone out if it were going to. */
const someFrames = () => act(() => new Promise<void>((r) => setTimeout(r, 80)));

beforeEach(() => {
  __resetFirstPaint();
  raiseSplash();
  session.user = null;
  session.adapter = null;
  window.localStorage.clear();
});

afterEach(() => {
  splash?.remove();
  splash = null;
  vi.restoreAllMocks();
});

describe('NavigationSyncEffect reads the page and dashboard lists after the first paint (objectui#12980)', () => {
  function metadataRecording(read: Set<string>): MetadataContextValue {
    return {
      apps: [{ name: 'crm', label: 'CRM', navigation: [] }],
      get pages() {
        read.add('page');
        return [];
      },
      get dashboards() {
        read.add('dashboard');
        return [];
      },
      objects: [],
      reports: [],
      loading: false,
      error: null,
      refresh: async () => {},
      invalidate: () => {},
      ensureType: async () => [],
      getItem: async () => null,
      getItemsByType: () => [],
      getTypeStatus: () => 'ready',
    } as unknown as MetadataContextValue;
  }

  it('reads neither list while the boot splash is up, and both once it is gone', async () => {
    const read = new Set<string>();
    const adapter = { getClient: () => ({ meta: { saveItem: vi.fn() } }) } as unknown as React.ComponentProps<
      typeof AdapterCtx.Provider
    >['value'];
    render(
      <AdapterCtx.Provider value={adapter}>
        <MetadataCtx.Provider value={metadataRecording(read)}>
          <NavigationSyncEffect />
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>,
    );
    await someFrames();
    expect([...read]).toEqual([]);

    dropSplash();
    await waitFor(() => expect([...read].sort()).toEqual(['dashboard', 'page']));
  });
});

describe('useSignedInUserLocale reads the user row after the first paint (objectui#12980)', () => {
  function Probe() {
    useSignedInUserLocale();
    const { language } = useObjectTranslation();
    return <span data-testid="language">{language}</span>;
  }

  it('does not read sys_user while the boot splash is up, and applies the column once it is gone', async () => {
    const findOne = vi.fn(async () => ({ id: 'usr_1', locale: 'ja' }));
    session.user = { id: 'usr_1' };
    session.adapter = { findOne, update: vi.fn() };
    render(
      <AdapterCtx.Provider value={session.adapter as React.ComponentProps<typeof AdapterCtx.Provider>['value']}>
        <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
          <Probe />
        </I18nProvider>
      </AdapterCtx.Provider>,
    );
    await someFrames();
    expect(findOne).not.toHaveBeenCalled();
    expect(screen.getByTestId('language')).toHaveTextContent('en');

    dropSplash();
    await waitFor(() => expect(findOne).toHaveBeenCalledWith('sys_user', 'usr_1'));
    await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent('ja'));
  });
});

describe('the Activity feed asks nothing, not even presence, until it is asked for (objectui#12980)', () => {
  it('asks the app scope for no name while not asked for, and for sys_activity once it is', () => {
    const askedNames: string[] = [];
    const ctx = {
      apps: [],
      objects: [],
      dashboards: [],
      reports: [],
      pages: [],
      loading: false,
      error: null,
      refresh: async () => {},
      invalidate: () => {},
      ensureType: async () => [],
      getItem: async () => null,
      getItemsByType: () => [],
      // Nothing has asked for the whole registry: presence goes through the scope.
      getTypeStatus: (type: string) => (type === 'object' ? 'idle' : 'ready'),
      readObjectScope: (scope: { packageId?: string; names?: readonly string[] }) => {
        askedNames.push(...(scope.names ?? []).filter(Boolean));
        return { objects: [], served: [], missing: [], settled: false };
      },
    } as unknown as MetadataContextValue;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ExpressionProvider app={{ name: 'crm', _packageId: 'com.acme.crm' }}>
        <MetadataCtx.Provider value={ctx}>{children}</MetadataCtx.Provider>
      </ExpressionProvider>
    );
    const { rerender } = renderHook(({ enabled }) => useSharedActivityFeed({ enabled }), {
      wrapper,
      initialProps: { enabled: false },
    });
    expect(askedNames).toEqual([]);

    rerender({ enabled: true });
    expect(askedNames).toContain('sys_activity');
  });
});
