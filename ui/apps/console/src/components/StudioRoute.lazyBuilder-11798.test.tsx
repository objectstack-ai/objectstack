// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11798 — the Studio builder loads WITH ITS ROUTE, and the entry gate
 * still decides first.
 *
 * ## What changed, and what this file pins about it
 *
 * `StudioDesignSurface` and `BuilderLanding` used to be static imports of
 * `StudioRoute.tsx`, so the builder sat in the eager closure of every console
 * page. They now arrive through `import('./studioBuilder')` behind `lazy()`.
 * The bundle half of that (which chunks a page load fetches) is measured on the
 * built console, not here: `pnpm check:eager-closure` weighs it, and the PR
 * records the before/after reading. What a unit test CAN pin is the order of
 * events the bundle split relies on, so that is the subject:
 *
 *  1. a principal the gate refuses never causes the builder MODULE to be
 *     evaluated at all, in the browser, that is "never requests its chunk";
 *  2. while the gate's answer is pending, the module is not evaluated either;
 *  3. a holder gets the module, once, and the builder renders.
 *
 * `StudioRoute.test.tsx` keeps pinning the entry decision itself (who gets in,
 * what a refused principal is shown); this file adds only the module dimension.
 *
 * ## The instrument: a counted mock factory
 *
 * `vi.mock('./studioBuilder', factory)` runs `factory` when the module is first
 * imported, and not before. So `builderModuleLoads` counts evaluations of the
 * module the route defers, which is the unit-level image of "its chunk was
 * fetched". A STATIC import of `./studioBuilder` anywhere in `StudioRoute.tsx`'s
 * graph would run the factory while this file imports `studioRoutes`, before
 * any case starts, and case 1 reds on its first assertion.
 *
 * ⚠️ The module registry is per FILE, so a load cannot be undone between
 * cases. The cases that need an unloaded module therefore run first, and each
 * asserts the count it STARTS from, so a reorder fails loudly instead of
 * passing on a module some earlier case already loaded.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

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

// The real barrel's surface is inherited (`check:vi-mock-inherit`), and the
// names `StudioRoute.tsx` and `ProtectedRoute.tsx` render are overridden. The
// barrel's OWN builder components are overridden with a marker the cases below
// never look for: the route must reach the builder only through the mocked
// `./studioBuilder`, so a regression that imports it from the barrel again
// renders the marker instead of `studio-pillar-builder`, leaves the module
// count at zero, and reds the holder case.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BuilderLanding: () => <div data-testid="barrel-builder" />,
  StudioDesignSurface: () => <div data-testid="barrel-builder" />,
  ConnectedShell: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  RequireOrganization: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  RedirectWithSplash: () => <div data-testid="redirect" />,
  LoadingFallback: () => <div data-testid="loading" />,
  LoadingScreen: () => <div data-testid="error-screen" />,
  STUDIO_ORG_SCOPE_SEGMENT: '~org',
  STUDIO_ORG_SCOPE_PILLAR: 'automations',
  getProductName: () => 'ObjectOS',
  useHomePath: () => '/home',
}));

const { builderModuleLoads } = vi.hoisted(() => ({ builderModuleLoads: { count: 0 } }));

vi.mock('./studioBuilder', () => {
  builderModuleLoads.count += 1;
  return {
    BuilderLanding: () => <div data-testid="studio-front-door">pick a package</div>,
    StudioDesignSurface: () => <div data-testid="studio-pillar-builder">pillars</div>,
  };
});

import { STUDIO_ENTRY_CAPABILITY } from './studioEntry';
import { studioRoutes } from './StudioRoute';

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

function renderStudio(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
      <Routes>
        {studioRoutes}
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const answer = (systemPermissions: string[]) => async () =>
  jsonResponse({ authenticated: true, userId: 'u1', systemPermissions, objects: {}, fields: {} });

beforeEach(() => {
  auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } };
  // The landing mounts the real `AppHeader` (objectui#11863), which reads its
  // user-scoped feeds and the AI agent catalogue on mount; each answers empty
  // here, so no request leaves the process. The entry gate's own read goes
  // through the mocked `createAuthenticatedFetch`, not this.
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/studio/* — the builder module loads behind the gate (objectui#11798)', () => {
  it('a principal the gate refuses never loads the builder module', async () => {
    // Precondition, not decoration: importing `studioRoutes` evaluated nothing
    // of the builder. A static import would already have counted one.
    expect(builderModuleLoads.count).toBe(0);

    permissionsFetch = answer(['setup.access']);
    renderStudio('/studio/hotcrm/data');

    // The refusal, said in place since objectui#12035, is the decided state.
    expect(await screen.findByTestId('studio-access-required')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/studio/hotcrm/data');
    expect(builderModuleLoads.count).toBe(0);
  });

  it('the pending window holds the module back too, and a holder then gets it once', async () => {
    expect(builderModuleLoads.count).toBe(0);

    let release: (() => void) | undefined;
    permissionsFetch = () =>
      new Promise<Response>((resolve) => {
        release = () =>
          resolve(
            jsonResponse({ authenticated: true, systemPermissions: [STUDIO_ENTRY_CAPABILITY] }),
          );
      });

    renderStudio('/studio/hotcrm/data');

    // The gate's own splash; the builder's chunk has not been asked for.
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(builderModuleLoads.count).toBe(0);

    release?.();
    await waitFor(() => expect(screen.getByTestId('studio-pillar-builder')).toBeInTheDocument());
    expect(builderModuleLoads.count).toBe(1);
  });

  it('the front door renders inside its painted frame from the same module', async () => {
    permissionsFetch = answer([STUDIO_ENTRY_CAPABILITY]);
    renderStudio('/studio');

    await waitFor(() => expect(screen.getByTestId('studio-front-door')).toBeInTheDocument());
    // The console header is the frame the landing's fallback sits under; its
    // brand links home (objectui#11863), named 「PRODUCT home」 since
    // objectui#12605.
    expect(screen.getByRole('link', { name: 'ObjectOS home' })).toHaveAttribute('href', '/home');
    // Both `lazy()` declarations name one specifier, so one module serves both.
    expect(builderModuleLoads.count).toBe(1);
  });
});
