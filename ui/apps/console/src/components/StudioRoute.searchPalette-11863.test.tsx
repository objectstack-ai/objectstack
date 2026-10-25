// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11863 (Q2) — the `/studio` landing mounts the command palette, in
 * its `studio` scope, so the header's search trigger appears there and opens a
 * palette that lists the Studio.
 *
 * Before it, only `ConsoleLayout` (inside an app) mounted a
 * `CommandPaletteProvider`, and `AppHeader` draws its "Search ⌘K" trigger only
 * under one (objectui#11912), so the landing's `studio` header had no search at
 * all and `Ctrl+K` opened nothing. Pinned through the REAL `studioRoutes` tree,
 * the real `AppHeader`, `CommandPaletteProvider` and `CommandPalette`, and the
 * real `fetchPackages` over a stubbed `fetch`:
 *
 *  - the header draws both triggers (desktop and compact) on `/studio`;
 *  - the desktop trigger and `Ctrl+K` each open the palette (`?palette=1`);
 *  - the palette lists the Studio's packages, and picking one opens its pillar
 *    builder through the real route tree.
 *
 * `t` answers in keys, as in `StudioRoute.landingI18n.test.tsx`, so a heading
 * is read off the key it asks for.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

/** Auth facts. This file only ever drives the holder path. */
const auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } as unknown };

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
  createAuthenticatedFetch: () => async () =>
    jsonResponse({
      authenticated: true,
      userId: 'u1',
      systemPermissions: ['studio.access'],
      objects: {},
      fields: {},
    }),
}));

// `AuthGuard` reaches `useAuth` through the auth package's OWN module graph,
// not through its entry point — the same seam `StudioRoute.test.tsx` documents.
vi.mock('../../../../packages/auth/src/useAuth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => auth,
}));

// The same barrel seam as `StudioRoute.landingI18n.test.tsx`: `chrome/` is
// pulled whole, so `CommandPalette` is the real one.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await vi.importActual<Record<string, unknown>>(
    '../../../../packages/app-shell/src/chrome/index'
  )),
  ConnectedShell: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  RequireOrganization: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  LoadingFallback: () => <div data-testid="loading" />,
  LoadingScreen: () => <div data-testid="error-screen" />,
  getProductName: () => 'ObjectOS',
  BuilderLanding: () => <div data-testid="studio-front-door">pick a package</div>,
  StudioDesignSurface: () => <div data-testid="studio-pillar-builder" />,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => `«${key}»`,
  }),
}));

import { studioRoutes } from './StudioRoute';

const DESKTOP = 'action:command-palette:open';
const MOBILE = 'action:command-palette:open-mobile';
const OVERLAY = 'overlay:command-palette';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location" data-path={`${location.pathname}${location.search}`} />;
}

function renderStudio(at = '/studio') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        {studioRoutes}
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
        <Route path="/login" element={<div data-testid="login-page">login</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function locationNow(): string {
  return screen.getByTestId('location').getAttribute('data-path') ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  // The package list answers two packages; every other read (the header's
  // feeds, the AI agent catalogue) answers empty, so no request leaves the
  // process.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).endsWith('/api/v1/packages')
        ? jsonResponse({
            data: [
              { manifest: { id: 'com.acme.crm', name: 'Acme CRM' }, writable: true },
              { manifest: { id: 'com.acme.hr', name: 'People' }, writable: true },
            ],
          })
        : jsonResponse({ data: [] }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the /studio landing mounts the command palette (objectui#11863, Q2)', () => {
  it('draws the header search trigger, desktop and compact', async () => {
    renderStudio();
    await screen.findByTestId('studio-front-door');

    expect(screen.getByTestId(DESKTOP)).toBeInTheDocument();
    expect(screen.getByTestId(MOBILE)).toBeInTheDocument();
    // Closed until asked.
    expect(screen.queryByTestId(OVERLAY)).not.toBeInTheDocument();
  });

  it('opens the palette from the trigger, and it lists the Studio packages', async () => {
    renderStudio();
    await screen.findByTestId('studio-front-door');

    fireEvent.click(screen.getByTestId(DESKTOP));
    expect(await screen.findByTestId(OVERLAY)).toBeInTheDocument();
    expect(locationNow()).toBe('/studio?palette=1');

    expect(await screen.findByText('«console.commandPalette.packages»')).toBeInTheDocument();
    expect(screen.getByText('Acme CRM')).toBeInTheDocument();
    expect(screen.getByText('People')).toBeInTheDocument();
  });

  it('opens the palette on Ctrl+K', async () => {
    renderStudio();
    await screen.findByTestId('studio-front-door');

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByTestId(OVERLAY)).toBeInTheDocument();
    expect(locationNow()).toBe('/studio?palette=1');
  });

  it("picking a package opens that package's pillar builder", async () => {
    renderStudio('/studio?palette=1');
    fireEvent.click(await screen.findByText('People'));

    expect(await screen.findByTestId('studio-pillar-builder')).toBeInTheDocument();
    expect(locationNow()).toBe('/studio/com.acme.hr/data');
  });
});
