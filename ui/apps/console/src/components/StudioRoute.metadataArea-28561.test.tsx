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
 *    has. Every other `~all` URL lands on Setup's environment directory, the
 *    leg's root's page since it left Studio (objectstack#37565), so none
 *    reaches a pillar.
 *  - The entry gate decides first, as for every Studio URL, the left menu's
 *    targets included.
 *
 * The builder module is mocked with markers (as in
 * `StudioRoute.lazyBuilder-11798.test.tsx`); the gate, the frame and the
 * router are real.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  StudioEntryRedirect: () => <div data-testid="barrel-builder" />,
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

vi.mock('./studioBuilder', async () => ({
  StudioEntryRedirect: () => <div data-testid="studio-entry" />,
  StudioDesignSurface: SurfaceMarker,
  StudioMetadataArea: ({ packageId }: { packageId: string | null }) => (
    <div data-testid="studio-metadata-area" data-package={String(packageId)} />
  ),
  // objectstack#36909 — the retired pillar addresses' redirect, real: its table is what the last describe walks.
  StudioPillarRedirect: (await vi.importActual<typeof import('@object-ui/app-shell')>('@object-ui/app-shell'))
    .StudioPillarRedirect,
}));

import { STUDIO_ENTRY_CAPABILITY } from './studioEntry';
import { studioRoutes } from './StudioRoute';

/** Every location the router showed, in order: one redirect is two entries. */
let seen: string[] = [];

/**
 * Records in a LAYOUT effect, which runs in the same commit that writes the
 * DOM: once a routed target is visible, its location is already in `seen`.
 * A passive `useEffect` is flushed later, so on a slow runner a case that
 * waited for the DOM read `seen` one entry short.
 */
function LocationProbe() {
  const { pathname, search } = useLocation();
  const here = `${pathname}${search}`;
  React.useLayoutEffect(() => {
    seen.push(here);
  }, [here]);
  return <div data-testid="pathname">{here}</div>;
}

function renderStudio(url: string) {
  seen = [];
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
      <Routes>
        {studioRoutes}
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
        <Route path="/apps/setup/component/security/access-directory/*" element={<div data-testid="setup-directory" />} />
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

  it('CONTROL — the sharing overview\'s own route is the builder with no area', async () => {
    renderStudio('/studio/com.example.crm/owd');
    const surface = await screen.findByTestId('studio-pillar-builder');
    expect(surface).toHaveAttribute('data-tab', 'owd');
    expect(surface).toHaveAttribute('data-area', '');
  });

  it('the cross-package leg is the builder with its area open on `~all` (objectstack#36899: one shell, one menu)', async () => {
    renderStudio('/studio/~all/metadata/permission?scope=environment');
    const surface = await screen.findByTestId('studio-pillar-builder');
    expect(surface).toHaveAttribute('data-package', '~all');
    expect(surface).toHaveAttribute('data-area', 'metadata');
    // No console top bar frames it: the builder's own header is the only one.
    // By its test id, not its name: the name depends on the width
    // (objectstack#37163), and an absence asserted by an old name passes on
    // a mark that is drawn.
    expect(screen.queryByTestId('app-bar-product-home')).toBeNull();
    expect(screen.queryByTestId('studio-metadata-area')).toBeNull();
    expect(location()).toBe('/studio/~all/metadata/permission?scope=environment');
  });

  // objectstack#37565 — rewritten on purpose: these landed on the leg's root, which is Setup's
  // environment directory now (ADR-0084, amended 2026-11-26), for whoever may open Setup. Still never a pillar.
  it.each(['/studio/~all', '/studio/~all/data', '/studio/~all/flow/f1'])(
    '%s lands on Setup\'s environment directory, in one hop, never on a pillar',
    async (url) => {
      permissionsFetch = answer([STUDIO_ENTRY_CAPABILITY, 'setup.access']);
      renderStudio(url);
      expect(await screen.findByTestId('setup-directory')).toBeInTheDocument();
      expect(location()).toBe('/apps/setup/component/security/access-directory');
      expect(screen.queryByTestId('studio-pillar-builder')).toBeNull();
      expect(seen).toEqual([url, '/apps/setup/component/security/access-directory']);
    },
  );

  // objectstack#37565 — one who may not open Setup keeps the leg's root, where the directory still is for them.
  it.each(['/studio/~all', '/studio/~all/data'])(
    '%s, without Setup\'s entry capability, lands on the leg\'s root in one hop',
    async (url) => {
      renderStudio(url);
      expect(await screen.findByTestId('studio-pillar-builder')).toHaveAttribute('data-package', '~all');
      expect(location()).toBe('/studio/~all/metadata');
      expect(screen.queryByTestId('setup-directory')).toBeNull();
      expect(seen).toEqual([url, '/studio/~all/metadata']);
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

/**
 * objectstack#36909 — the retired pillar addresses, on the REAL routes and the
 * real redirect: every old address reaches the page that replaced it in ONE
 * redirect (the probe sees the old address and the new one, nothing between),
 * and a current address is not redirected at all. The redirect's full table,
 * every query spelling included, is `studioPillarRedirectModel.test.ts`.
 */
describe('/studio — every retired pillar address redirects once, to its new address (objectstack#36909)', () => {
  const PKG = 'com.example.crm';
  const PAIR = 'com.example.crm.custom';

  it.each([
    [`/studio/${PKG}`, `/studio/${PKG}/metadata/object?package=${PKG}`],
    [`/studio/${PKG}/data`, `/studio/${PKG}/metadata/object?package=${PKG}`],
    [`/studio/${PKG}/data?surface=object%3Aaccount`, `/studio/${PKG}/metadata/object/account?package=${PKG}`],
    // The server's draft review link (`studioChangesReviewLink`).
    [`/studio/${PKG}/data?changes=review`, `/studio/${PKG}/metadata/object?changes=review&package=${PKG}`],
    [`/studio/${PKG}/automations`, `/studio/${PKG}/metadata/flow?package=${PKG}`],
    [`/studio/${PKG}/automations?surface=flow%3Anotify`, `/studio/${PKG}/metadata/flow/notify?package=${PKG}`],
    // A package with no pair names its sets without a read.
    [`/studio/${PKG}/access`, `/studio/${PKG}/metadata/permission?package=${PKG}`],
    [`/studio/${PKG}/access?surface=owd%3Aoverview`, `/studio/${PKG}/owd`],
    // A pair's Access pillar is its base's (a set the pair holds is read for:
    // `StudioDesignSurface.accessPairCopy-29674.test.tsx`).
    [`/studio/${PAIR}/access`, `/studio/${PKG}/metadata/permission?package=${PKG}`],
    [`/studio/${PKG}/interfaces?surface=page%3Ahome`, `/studio/${PKG}/metadata/object?package=${PKG}`],
    [`/studio/${PAIR}/interfaces`, `/studio/${PKG}/metadata/object?package=${PKG}`],
    // The package-less scope: its bare leg and its one pillar.
    ['/studio/~org', '/studio/~org/metadata/flow?source=runtime'],
    ['/studio/~org/automations', '/studio/~org/metadata/flow?source=runtime'],
    ['/studio/~org/automations?surface=flow%3Aclone_1', '/studio/~org/metadata/flow/clone_1?source=runtime'],
  ])('%s → %s, in one redirect', async (from, to) => {
    renderStudio(from);
    await waitFor(() => expect(location()).toBe(to));
    await screen.findByTestId('studio-pillar-builder');
    expect(seen).toEqual([from, to]);
  });

  it.each([
    `/studio/${PKG}/owd`,
    `/studio/${PKG}/owd?object=account`,
    `/studio/${PKG}/metadata/object?package=${PKG}`,
    `/studio/${PKG}/metadata/flow/notify?package=${PKG}`,
    // A segment no page has: the builder, which draws its not-found state.
    `/studio/${PKG}/bogus_pillar`,
  ])('CONTROL — the current address %s is not redirected', async (url) => {
    renderStudio(url);
    await screen.findByTestId('studio-pillar-builder');
    expect(location()).toBe(url);
    expect(seen).toEqual([url]);
  });
});
