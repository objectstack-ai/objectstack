/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11714 — a signed-in visitor on `DefaultRegisterPage` is moved on,
 * never left on an empty layout.
 *
 * The page asks `decideSignUpOffer` what to offer a visitor who has no account
 * yet. Under `invite_only` (the server's default) with no invitation redirect
 * the decision needs the bootstrap probe, and answers `pending` until the
 * probe does — and the probe is asked only for a signed-out visitor. So a
 * signed-in visitor got an empty `AuthPageLayout` that nothing ever changed,
 * and under `open` they got the sign-up form. The page offers nothing a
 * signed-in user can use: it now sends them where it sends a visitor after a
 * successful sign-up (`/`), as the console's own register page does, without
 * waiting for the config or the probe. `decideSignUpOffer` is unchanged; the
 * signed-out pins are `defaultPagesFollowPosture-11705.test.tsx` beside this
 * file, and the last case here is their control on this harness.
 *
 * Rendered as shipped: the exported page, `@object-ui/auth`'s real form, a real
 * `AuthProvider` over a real `createAuthClient`, and a real `I18nProvider`.
 * Only `fetch` is a stub: `/get-session` answers a signed-in session or none,
 * `/config` the way the server wraps it, `/bootstrap-status` the way the
 * probe reads it. The session answer can be HELD, so the config read lands
 * first — the order in which a page that offered before it knew who it was
 * talking to would flash the form. Visible text is read from the en locale
 * pack, not copied here.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider, createAuthClient } from '@object-ui/auth';
import type { AuthPublicConfig } from '@object-ui/auth';
import type { AudiencePosture } from '@objectstack/spec/system';
import { RegisterPage } from '../RegisterPage';

const AUTH_URL = 'http://localhost/api/v1/auth';
const en = builtInLocales.en;
const NOTICE = 'register-by-invitation';
const HOME = 'home';

type EmailPassword = NonNullable<AuthPublicConfig['emailPassword']>;
const OPEN_SIGN_UP: EmailPassword = { enabled: true, disableSignUp: false, requireEmailVerification: false };
const SIGN_UP_OFF: EmailPassword = { enabled: true, disableSignUp: true };

/** The config as the server sends it; `posture` is the wire value, hence the one cast. */
function configFor(posture: string, emailPassword: EmailPassword = OPEN_SIGN_UP): AuthPublicConfig {
  return { emailPassword, features: { audiencePosture: posture as AudiencePosture } };
}

const SIGNED_IN = {
  user: { id: 'u_1', name: 'Ada', email: 'ada@example.com' },
  session: { id: 's_1', userId: 'u_1', token: 'tok_1', expiresAt: '2099-01-01T00:00:00.000Z' },
};

interface Wire {
  configReads: number;
  bootstrapProbes: number;
  /** Resolves a held `/get-session`; a no-op when the session was not held. */
  releaseSession: () => void;
}
let wire: Wire;

function stubServer(
  config: AuthPublicConfig,
  { signedIn, holdSession = false }: { signedIn: boolean; holdSession?: boolean },
): typeof fetch {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  let release: () => void = () => {};
  const sessionAnswered = holdSession ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
  wire = { configReads: 0, bootstrapProbes: 0, releaseSession: () => release() };
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/get-session')) {
      await sessionAnswered;
      return json(signedIn ? SIGNED_IN : null);
    }
    if (url.endsWith('/bootstrap-status')) {
      wire.bootstrapProbes += 1;
      return json({ hasOwner: true });
    }
    if (url.endsWith('/config')) {
      wire.configReads += 1;
      return json({ success: true, data: config });
    }
    return json(null);
  }) as typeof fetch;
}

/** Every location the router showed, with how it got there. */
const seen: string[] = [];
function Recorder() {
  const location = useLocation();
  const how = useNavigationType();
  seen.push(`${how} ${location.pathname}${location.search}`);
  return null;
}
const stayedOnRegister = () => seen.length > 0 && seen.every((entry) => entry === 'POP /register');

/**
 * Everything the page ever OFFERED, read off the DOM as it was mounted rather
 * than off the settled tree: a form or notice rendered for one commit and then
 * replaced is still recorded.
 */
const offered: string[] = [];
let observer: MutationObserver | null = null;
function watchOffers() {
  const note = (el: Element) => {
    if (el.matches(`[data-testid="${NOTICE}"]`) || el.querySelector(`[data-testid="${NOTICE}"]`)) offered.push('notice');
    if (el.matches('form') || el.querySelector('form')) offered.push('form');
  };
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) for (const n of Array.from(m.addedNodes)) if (n instanceof Element) note(n);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** Mount the page as `examples/console-starter/src/App.tsx` routes it. */
function renderAt(path: string, config: AuthPublicConfig, server: { signedIn: boolean; holdSession?: boolean }) {
  const fetchFn = stubServer(config, server);
  vi.stubGlobal('fetch', fetchFn);
  const client = createAuthClient({ baseURL: AUTH_URL, fetchFn });
  watchOffers();
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Recorder />
          <Routes>
            <Route path="/login" element={<div data-testid="login" />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={<div data-testid={HOME} />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

/** Let pending fetches and the state updates they cause land. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** The settled state of a visitor the page moved on: `/`, and no auth page left. */
async function movedOnToHome() {
  expect(await screen.findByTestId(HOME)).toBeInTheDocument();
  expect(seen[seen.length - 1]).toBe('REPLACE /');
  expect(screen.queryByText(en.auth.layout.headline)).toBeNull();
}

beforeEach(() => {
  seen.length = 0;
  offered.length = 0;
  window.localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  observer?.disconnect();
  observer = null;
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DefaultRegisterPage — a signed-in visitor is moved on, never left on an empty layout (objectui#11714)', () => {
  it('under invite_only on a deployment with an owner, leaves /register for / without the probe', async () => {
    renderAt('/register', configFor('invite_only'), { signedIn: true });

    await movedOnToHome();
    await settle();
    expect(offered).toEqual([]);
    expect(wire.bootstrapProbes).toBe(0);
  });

  it('decides before it offers: with the config read first, never renders the form for a signed-in visitor under open', async () => {
    renderAt('/register', configFor('open'), { signedIn: true, holdSession: true });
    await settle();
    expect(wire.configReads).toBeGreaterThan(0);
    expect(stayedOnRegister()).toBe(true);
    expect(offered).toEqual([]);

    wire.releaseSession();
    await movedOnToHome();
    expect(offered).toEqual([]);
  });

  it('with disableSignUp: true, sends a signed-in visitor to /, not to /login', async () => {
    renderAt('/register', configFor('invite_only', SIGN_UP_OFF), { signedIn: true });

    await movedOnToHome();
    await settle();
    expect(seen.some((entry) => entry.endsWith('/login'))).toBe(false);
  });

  it('control: a signed-out visitor answered just as late stays, is told registration is by invitation, and is probed only once known', async () => {
    renderAt('/register', configFor('invite_only'), { signedIn: false, holdSession: true });
    await settle();
    expect(wire.configReads).toBeGreaterThan(0);
    expect(wire.bootstrapProbes).toBe(0);

    wire.releaseSession();
    expect(await screen.findByTestId(NOTICE)).toHaveTextContent(en.auth.register.errors.selfRegistrationClosed);
    await waitFor(() => expect(wire.bootstrapProbes).toBe(1));
    expect(stayedOnRegister()).toBe(true);
    expect(screen.queryByTestId(HOME)).toBeNull();
  });
});
