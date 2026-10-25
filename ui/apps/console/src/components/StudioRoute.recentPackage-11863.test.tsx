// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11863 (Q3) — a visit to a package's pillar builder is recorded as a
 * recent `package` entry, by IDENTITY and with no label (the objectui#11678
 * shape), so the `/studio` landing can list the packages an author was last in.
 *
 * ## Why the route, and why this instrument
 *
 * `useTrackRouteAsRecent` reads `/apps/APP/...` paths only, so before this card
 * a `/studio/PKG/TAB` visit wrote nothing at all. `StudioRoute.tsx` owns the
 * `/studio` subtree, so the visit is recorded there. This file mounts the REAL
 * `studioRoutes` inside the REAL `RecentItemsProvider` and reads the list the
 * provider holds and the copy it writes to localStorage: a transcription of the
 * route tree, or a stubbed store, would be free to agree with itself.
 *
 * "Writes nothing" is read off that persisted copy: absent when nothing was
 * ever written (the provider only reads on mount), and byte-identical, its
 * `visitedAt` included, when a later visit must not have written. A
 * `Storage.prototype.setItem` spy is not the instrument here: under this
 * project's DOM environment it counted zero calls for a write the persisted
 * copy shows, so a zero from it says nothing.
 *
 * The builder itself is a stub (`./studioBuilder`), as in
 * `StudioRoute.lazyBuilder-11798.test.tsx`: what is measured is what the ROUTE
 * records, not what the builder renders.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

let auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } as unknown };

let permissionsFetch: (input: unknown, init?: unknown) => Promise<Response> = async () =>
  jsonResponse({ authenticated: true, systemPermissions: [] });

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => auth,
  createAuthenticatedFetch: () => (input: unknown, init?: unknown) => permissionsFetch(input, init),
}));

// `AuthGuard` reads `useAuth` through the auth package's own module graph; the
// same seam `StudioRoute.test.tsx` documents.
vi.mock('../../../../packages/auth/src/useAuth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => auth,
}));

// The real barrel is inherited, so `RecentItemsProvider` and `useRecentItems`
// below are the real store; only the frame `ProtectedRoute` mounts is passed
// through.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConnectedShell: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  RequireOrganization: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  RedirectWithSplash: () => <div data-testid="redirect" />,
  LoadingFallback: () => <div data-testid="loading" />,
  LoadingScreen: () => <div data-testid="error-screen" />,
  getProductName: () => 'ObjectOS',
  useHomePath: () => '/home',
}));

vi.mock('./studioBuilder', () => ({
  BuilderLanding: () => <div data-testid="studio-front-door">pick a package</div>,
  StudioDesignSurface: () => <div data-testid="studio-pillar-builder">pillars</div>,
}));

import { RecentItemsProvider, useRecentItems } from '@object-ui/app-shell';
import { STUDIO_ENTRY_CAPABILITY } from './studioEntry';
import { studioRoutes } from './StudioRoute';

/** Where the provider keeps user `u1`'s list (`scopedKey` in `UserStateAdapters`). */
const STORAGE_KEY = 'objectui-recent-items:u:u1';

function RecentProbe() {
  const { recentItems } = useRecentItems();
  return <pre data-testid="recent">{JSON.stringify(recentItems)}</pre>;
}

/** Navigates to `to` when clicked — a client-side transition, as a pillar tab is. */
function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid={`go:${to}`} onClick={() => navigate(to)}>
      {to}
    </button>
  );
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

function renderStudio(url: string) {
  return render(
    <RecentItemsProvider>
      <MemoryRouter initialEntries={[url]}>
        <LocationProbe />
        <RecentProbe />
        <Go to="/studio/com.acme.crm/automations" />
        <Routes>
          {studioRoutes}
          <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
        </Routes>
      </MemoryRouter>
    </RecentItemsProvider>,
  );
}

const recent = () => JSON.parse(screen.getByTestId('recent').textContent ?? '[]') as Array<Record<string, unknown>>;

const holder = async () =>
  jsonResponse({ authenticated: true, userId: 'u1', systemPermissions: [STUDIO_ENTRY_CAPABILITY], objects: {}, fields: {} });

/** The persisted copy of the list, as written; `null` when nothing was ever written. */
const persisted = () => localStorage.getItem(STORAGE_KEY);

beforeEach(() => {
  auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } };
  permissionsFetch = holder;
  localStorage.clear();
  // The landing mounts the real `AppHeader` (objectui#11863), which reads its
  // user-scoped feeds and the AI agent catalogue on mount; each answers empty
  // here, so no request leaves the process. The entry gate's own read goes
  // through the mocked `createAuthenticatedFetch`, not this.
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/studio/PKG/TAB records the package as a recent entry (objectui#11863)', () => {
  it('a pillar visit writes one package entry, keyed by the package id, with no label', async () => {
    renderStudio('/studio/com.acme.crm/data');
    await screen.findByTestId('studio-pillar-builder');

    await waitFor(() => expect(recent()).toHaveLength(1));
    const [entry] = recent();
    expect(entry).toEqual({
      id: 'package:com.acme.crm',
      type: 'package',
      name: 'com.acme.crm',
      href: '/studio/com.acme.crm',
      visitedAt: expect.any(String),
    });
    // Identity only: no display text is minted from the route (objectui#11678).
    expect(entry).not.toHaveProperty('label');
    // And it is what the persisted copy holds.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([entry]);
  });

  it('the bare package route records it too, once it lands on the Data pillar', async () => {
    renderStudio('/studio/com.acme.crm');
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/studio/com.acme.crm/data'));
    await waitFor(() => expect(recent().map((r) => r.id)).toEqual(['package:com.acme.crm']));
  });

  it('switching pillars inside the same package changes nothing, so it writes nothing', async () => {
    renderStudio('/studio/com.acme.crm/data');
    await waitFor(() => expect(recent()).toHaveLength(1));
    const before = persisted();
    expect(before).not.toBeNull();
    // Long enough that a second write would carry a different `visitedAt`.
    await new Promise((r) => setTimeout(r, 20));

    act(() => screen.getByTestId('go:/studio/com.acme.crm/automations').click());
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/studio/com.acme.crm/automations'));
    await screen.findByTestId('studio-pillar-builder');

    expect(persisted()).toBe(before);
    expect(recent()).toEqual(JSON.parse(before ?? '[]'));
  });

  it('the package-less scope is not a package, and the landing is not a visit: neither records anything', async () => {
    renderStudio('/studio/~org/automations');
    await screen.findByTestId('studio-pillar-builder');
    cleanup();

    renderStudio('/studio');
    await screen.findByTestId('studio-front-door');

    expect(recent()).toEqual([]);
    expect(persisted()).toBeNull();
  });

  it('a principal the entry gate refuses records nothing: the visit is recorded behind the gate', async () => {
    permissionsFetch = async () => jsonResponse({ authenticated: true, systemPermissions: ['setup.access'] });
    renderStudio('/studio/com.acme.crm/data');

    // The refusal, said in place since objectui#12035, is the decided state.
    expect(await screen.findByTestId('studio-access-required')).toBeInTheDocument();
    expect(screen.getByTestId('pathname')).toHaveTextContent('/studio/com.acme.crm/data');
    expect(recent()).toEqual([]);
    expect(persisted()).toBeNull();
  });
});
