// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12035 — a caller without Studio access is told so, in their language.
 *
 * The `/studio` entry gate used to send a non-holder home with no word of why,
 * so a missing capability read exactly like a broken link. It now says, at the
 * URL that was opened, that Studio access is needed (`console.studio.accessRequired`),
 * with a way home that reuses the app refusal screen's label
 * (`empty.appAccessDeniedHome`). `StudioRoute.test.tsx` pins the decision and
 * where the way home leads; this file pins the LANGUAGE.
 *
 * ## Why every pack, and why the expected text is read from the pack
 *
 * The call site carries an English `defaultValue`, and a render with no language
 * instance answers with it — so an English assertion cannot tell a keyed lookup
 * from a hardcoded literal. Each case here installs the real catalogue for one
 * language (`createI18n`, the global instance the console's provider-less
 * readers resolve through) and expects THAT pack's value. A pack value is read
 * from the pack rather than written into this file, which keeps this file ASCII
 * under commandment #-1, and the control below proves the nine non-English
 * values are not the English sentence again, so a pass is a translation reached
 * through the key and not the default.
 *
 * ## Control: a holder enters Studio as today
 *
 * In a non-English language too: the refusal is drawn for a non-holder only.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

/** Auth facts. `AuthGuard` itself stays real. */
const auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } as unknown };

/** What `GET /auth/me/permissions` reports, swapped per test. */
let systemPermissions: string[] = [];

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
    jsonResponse({ authenticated: true, userId: 'u1', systemPermissions, objects: {}, fields: {} }),
}));

// `AuthGuard` reaches `useAuth` through the auth package's OWN module graph,
// not through its entry point — the same seam `StudioRoute.test.tsx` documents.
vi.mock('../../../../packages/auth/src/useAuth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => auth,
}));

// Barrel cost, measured in `StudioRoute.test.tsx`: pull the `chrome/`
// submodule instead of transforming the whole `@object-ui/app-shell` graph.
const builderLanding = vi.fn();
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
  BuilderLanding: () => {
    builderLanding();
    return <div data-testid="studio-front-door">pick a package</div>;
  },
  StudioDesignSurface: () => <div data-testid="studio-pillar-builder" />,
}));

import { STUDIO_ENTRY_CAPABILITY } from './studioEntry';
import { studioRoutes } from './StudioRoute';

type Language = keyof typeof builtInLocales;
const LANGUAGES = Object.keys(builtInLocales) as Language[];

/** The refusal's sentence, as one pack writes it. */
const sentenceIn = (lang: Language) => builtInLocales[lang].console.studio.accessRequired;
/** The refusal's way home, as one pack writes it (the app refusal screen's label). */
const wayHomeIn = (lang: Language) => builtInLocales[lang].empty.appAccessDeniedHome;

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
        <Route path="/login" element={<div data-testid="login-page">login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function inLanguage(language: Language) {
  createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
}

beforeEach(() => {
  systemPermissions = [];
  builderLanding.mockClear();
  // The landing mounts the real `AppHeader`, which reads its user-scoped feeds
  // on mount; each answers empty here, so no request leaves the process.
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the expectations are translations, not the English default', () => {
  it('every pack carries the sentence and the way home', () => {
    for (const lang of LANGUAGES) {
      expect(sentenceIn(lang), lang).toBeTruthy();
      expect(wayHomeIn(lang), lang).toBeTruthy();
    }
  });

  it.each(LANGUAGES.filter((lang) => lang !== 'en'))(
    '%s writes its own sentence, not the English one',
    (lang) => {
      expect(sentenceIn(lang)).not.toBe(sentenceIn('en'));
    },
  );
});

describe('/studio refused: the sentence arrives in the caller language (objectui#12035)', () => {
  it.each(LANGUAGES)('%s', async (lang) => {
    inLanguage(lang);
    renderStudio('/studio/hotcrm/data');

    expect(await screen.findByText(sentenceIn(lang))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: wayHomeIn(lang) })).toHaveAttribute('href', '/home');
    // Said in place: the URL the caller opened has not moved.
    expect(screen.getByTestId('pathname').textContent).toBe('/studio/hotcrm/data');
    expect(screen.queryByTestId('studio-pillar-builder')).not.toBeInTheDocument();
  });
});

describe('CONTROL: a caller with Studio access enters Studio as today', () => {
  it.each(['en', 'zh'] as const)('%s', async (lang) => {
    inLanguage(lang);
    systemPermissions = [STUDIO_ENTRY_CAPABILITY];
    renderStudio('/studio/');

    await waitFor(() => expect(screen.getByTestId('studio-front-door')).toBeInTheDocument());
    expect(builderLanding).toHaveBeenCalled();
    expect(screen.getByTestId('pathname').textContent).toBe('/studio/');
    expect(screen.queryByText(sentenceIn(lang))).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-access-required')).not.toBeInTheDocument();
  });
});
