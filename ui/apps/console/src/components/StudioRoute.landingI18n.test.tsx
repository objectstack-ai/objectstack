// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio front door's header speaks in keys, and no pack's language is
 * hardcoded into it.
 *
 * objectui#10043 keyed the old wordmark's tooltip, which had shipped as a raw
 * Chinese literal: user-visible text outside i18n entirely, which AGENTS.md
 * commandment #-1 names by category ("component labels, buttons, titles,
 * errors"). objectui#11863 (Q1) replaced that wordmark bar with the console's
 * own header, `AppHeader`'s `studio` variant, so the tooltip and its key
 * (`console.studio.backToHome`) are retired, and what this file pins now is the
 * header's fixed Studio crumb, read from `console.studio.title`, through the
 * REAL `studioRoutes` tree and the real `AppHeader`.
 *
 * ## Why `t` answers in no natural language here
 *
 * Same reason as `AppManagementPage.i18n.test.tsx`, and the same sentinel: a
 * mock that echoed `defaultValue` would let a component that never called `t`
 * at all pass every assertion, because a hardcoded literal and a correctly
 * keyed lookup are indistinguishable the moment the pack agrees with the
 * source. `t` therefore returns `«key»`, which is what a NON-English pack does
 * to this header in the only respect that matters: the source language
 * disappears.
 *
 * ## Two-sided, and the negative side carries its own control
 *
 * Naming the key is necessary and not sufficient — a stray Han literal could
 * sit beside a correctly keyed one. So a second assertion sweeps the rendered
 * landing for Han script. A script-class assertion is exactly the shape
 * AGENTS.md's i18n forensics rule warns can go permanently vacuous, so the
 * regex is pinned against a live positive built from a code point rather than
 * trusted: without that control, a broken `HAN` would report "no Chinese on
 * screen" forever, on a screen full of it.
 *
 * The Han sample is constructed with `String.fromCodePoint` rather than written
 * out, so this file's own bytes stay ASCII under the commandment it enforces.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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

// Barrel cost, measured in `StudioRoute.test.tsx`: an `importOriginal()` on
// `@object-ui/app-shell` transforms the whole graph on demand. Every name this
// file's graph reads is either overridden here or lives in `chrome/`, so pull
// that ONE submodule instead.
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

/**
 * A pack that speaks only in keys. `defaultValue` is dropped on purpose — it
 * is the call site's own English, and honouring it here would hand the test
 * back the very sentence it is trying to prove the header no longer hardcodes.
 */
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => `«${key}»`,
  }),
}));

import { studioRoutes } from './StudioRoute';

/** The key the header's fixed Studio crumb must ask the catalogue for. */
const CRUMB_KEY = 'console.studio.title';

/** The retired wordmark tooltip's key: nothing on the landing may ask for it. */
const RETIRED_KEY = 'console.studio.backToHome';

/**
 * Han script, the class the retired literal belonged to. `u` flag + a script
 * property class, never ASCII `\w` — AGENTS.md's i18n forensics rule.
 */
const HAN = /\p{Script=Han}/u;

/** Built, not written, so this file stays ASCII. U+4E2D is an ordinary Han ideograph. */
const HAN_SAMPLE = String.fromCodePoint(0x4e2d);

function renderStudioLanding() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <Routes>
        {studioRoutes}
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
        <Route path="/login" element={<div data-testid="login-page">login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Every attribute value on the page: `textContent` never sees one. */
function attributeValues(): string[] {
  return Array.from(document.body.querySelectorAll('*')).flatMap((el) =>
    Array.from(el.attributes).map((a) => a.value),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The real `AppHeader` reads its user-scoped feeds (the inbox, approvals) and
  // the AI agent catalogue on mount; each answers empty here, so no request
  // leaves the process.
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Han sweep is a live instrument', () => {
  it('matches Han script', () => {
    expect(HAN.test(HAN_SAMPLE)).toBe(true);
  });

  it('does not match the English the packs carry for the crumb', () => {
    expect(HAN.test('Studio')).toBe(false);
  });
});

describe('Studio landing header (objectui#11863, objectui#10043)', () => {
  it("draws the console header's fixed Studio crumb, asked of the catalogue", async () => {
    renderStudioLanding();

    expect(await screen.findByText(`«${CRUMB_KEY}»`)).toBeInTheDocument();
    // The front door itself rendered under it.
    expect(await screen.findByTestId('studio-front-door')).toBeInTheDocument();
  });

  it('asks nothing of the retired wordmark tooltip key, in text or in any attribute', async () => {
    renderStudioLanding();
    await screen.findByText(`«${CRUMB_KEY}»`);

    expect(document.body.textContent ?? '').not.toContain(RETIRED_KEY);
    const values = attributeValues();
    // CONTROL: the sweep reads attributes at all.
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((v) => v.includes(RETIRED_KEY))).toEqual([]);
  });

  it('links the brand to the declared landing, which is the launcher here', async () => {
    renderStudioLanding();
    await screen.findByText(`«${CRUMB_KEY}»`);

    expect(screen.getByTitle('ObjectOS').closest('a')).toHaveAttribute('href', '/home');
  });

  it('renders no Han script anywhere on the landing, attributes included', async () => {
    renderStudioLanding();
    await screen.findByTestId('studio-front-door');
    await screen.findByText(`«${CRUMB_KEY}»`);

    expect(HAN.test(document.body.textContent ?? '')).toBe(false);

    // `textContent` never sees an attribute, and the measured defect WAS an
    // attribute — so sweep every one of them separately.
    const values = attributeValues();
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((v) => HAN.test(v))).toEqual([]);
  });
});
