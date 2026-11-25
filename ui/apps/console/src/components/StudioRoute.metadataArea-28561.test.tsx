// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28561 — the "All metadata" area's routes in the `/studio`
 * subtree (ADR-0146 D1), on the REAL `studioRoutes` the console mounts.
 *
 *  - A package's area (`/studio/<package>/metadata/*`) is the pillar builder
 *    with its area open: the surface draws the header and mounts the area, so
 *    the route hands it `area="metadata"`. `:packageId/:tab` matches one
 *    segment, so without this route an area URL such as
 *    `/studio/crm/metadata/flow` matched nothing.
 *  - The cross-package leg (`/studio/~all/metadata/*`) is the same builder
 *    route with `~all` as its segment (objectstack#36899): the surface draws
 *    the area alone, with no package, beside the left menu every Studio page
 *    has. Every other `~all` URL lands on it, so none reaches a pillar.
 *  - The entry gate decides first, as for every Studio URL, the left menu's
 *    targets included.
 *
 * The builder module is mocked with markers (as in
 * `StudioRoute.lazyBuilder-11798.test.tsx`); the gate, the frame and the
 * router are real.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation, useParams } from 'react-router-dom';

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
// seam `StudioRoute.test.tsx` documents.
vi.mock('../../../../packages/auth/src/useAuth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => auth,
}));

// The real barrel's surface is inherited (`check:vi-mock-inherit`); the route
// constants (`STUDIO_ALL_PACKAGES_SEGMENT`, `STUDIO_METADATA_AREA`,
// `studioMetadataAreaPath`) are the real ones. The barrel's own builder
// components are overridden with a marker no case looks for: the route reaches
// them only through `./studioBuilder`.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BuilderLanding: () => <div data-testid="barrel-builder" />,
  StudioDesignSurface: () => <div data-testid="barrel-builder" />,
  StudioMetadataArea: () => <div data-testid="barrel-builder" />,
  ConnectedShell: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  RequireOrganization: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  RedirectWithSplash: () => <div data-testid="redirect" />,
  LoadingFallback: () => <div data-testid="loading" />,
  LoadingScreen: () => <div data-testid="error-screen" />,
  getProductName: () => 'ObjectOS',
  useHomePath: () => '/home',
}));

function SurfaceMarker({ area }: { area?: string }) {
  const { packageId, tab } = useParams();
  return (
    <div data-testid="studio-pillar-builder" data-package={packageId} data-tab={tab ?? ''} data-area={area ?? ''} />
  );
}

vi.mock('./studioBuilder', () => ({
  BuilderLanding: () => <div data-testid="studio-front-door" />,
  StudioDesignSurface: SurfaceMarker,
  StudioMetadataArea: ({ packageId }: { packageId: string | null }) => (
    <div data-testid="studio-metadata-area" data-package={String(packageId)} />
  ),
}));

import { STUDIO_ENTRY_CAPABILITY } from './studioEntry';
import { studioRoutes } from './StudioRoute';

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="pathname">{`${pathname}${search}`}</div>;
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
const location = () => screen.getByTestId('pathname').textContent;

beforeEach(() => {
  auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } };
  permissionsFetch = answer([STUDIO_ENTRY_CAPABILITY]);
  // The frame mounts the real `AppHeader`, whose feeds answer empty here.
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/studio — the "All metadata" area\'s routes (objectstack#28561)', () => {
  it('a package\'s area is the pillar builder with its area open, the rest of the path its own', async () => {
    renderStudio('/studio/com.example.crm/metadata/flow/f1/history?package=com.example.crm');
    const surface = await screen.findByTestId('studio-pillar-builder');
    expect(surface).toHaveAttribute('data-package', 'com.example.crm');
    expect(surface).toHaveAttribute('data-area', 'metadata');
    expect(location()).toBe('/studio/com.example.crm/metadata/flow/f1/history?package=com.example.crm');
    expect(screen.queryByTestId('barrel-builder')).toBeNull();
  });

  it('CONTROL — a pillar is the pillar builder with no area', async () => {
    renderStudio('/studio/com.example.crm/data');
    const surface = await screen.findByTestId('studio-pillar-builder');
    expect(surface).toHaveAttribute('data-tab', 'data');
    expect(surface).toHaveAttribute('data-area', '');
  });

  it('the cross-package leg is the builder with its area open on `~all` (objectstack#36899: one shell, one menu)', async () => {
    renderStudio('/studio/~all/metadata/permission?scope=environment');
    const surface = await screen.findByTestId('studio-pillar-builder');
    expect(surface).toHaveAttribute('data-package', '~all');
    expect(surface).toHaveAttribute('data-area', 'metadata');
    // The landing's frame (the console's top bar) no longer draws it.
    // By its test id, not its name: the name depends on the width
    // (objectstack#37163), and an absence asserted by an old name passes on
    // a mark that is drawn.
    expect(screen.queryByTestId('app-bar-product-home')).toBeNull();
    expect(screen.queryByTestId('studio-metadata-area')).toBeNull();
    expect(location()).toBe('/studio/~all/metadata/permission?scope=environment');
  });

  it.each(['/studio/~all', '/studio/~all/data', '/studio/~all/flow/f1'])(
    '%s lands on the cross-package area, never on a pillar',
    async (url) => {
      renderStudio(url);
      const surface = await screen.findByTestId('studio-pillar-builder');
      expect(location()).toBe('/studio/~all/metadata');
      expect(surface).toHaveAttribute('data-area', 'metadata');
      expect(surface).toHaveAttribute('data-package', '~all');
    },
  );

  it.each([
    '/studio/~all/metadata',
    '/studio/com.example.crm/metadata',
    // objectstack#36899 — the left menu's targets that are not an area list.
    '/studio/~org/automations',
    // objectstack#36905 — the sharing overview's own route, and the old address that redirects to it.
    '/studio/com.example.crm/owd',
    '/studio/com.example.crm/access?surface=owd%3Aoverview',
    '/studio/com.example.crm/metadata/_diagnostics',
  ])(
    'a principal the gate refuses gets none of them: %s',
    async (url) => {
      permissionsFetch = answer(['setup.access']);
      renderStudio(url);
      expect(await screen.findByTestId('studio-access-required')).toBeInTheDocument();
      expect(screen.queryByTestId('studio-metadata-area')).toBeNull();
      expect(screen.queryByTestId('studio-pillar-builder')).toBeNull();
      // The refusal is said where the caller asked.
      expect(location()).toBe(url);
    },
  );
});
