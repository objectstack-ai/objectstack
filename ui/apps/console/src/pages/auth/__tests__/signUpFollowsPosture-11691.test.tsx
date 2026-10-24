/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11691 — the console offers a generic sign-up only where the server
 * would accept one.
 *
 * `/api/v1/auth/config` states the sign-up rule as two keys:
 * `emailPassword.disableSignUp` (the hard off switch) and
 * `features.audiencePosture` (who may self-register). The server does not
 * force the first from the second — under `invite_only` its sign-up route
 * still admits a pending invitee — so a page reading only `disableSignUp`
 * offered "Sign up" under the DEFAULT posture and refused the finished form
 * with `403 SELF_REGISTRATION_CLOSED`.
 *
 * Nothing in `@object-ui/auth` is replaced: a real `AuthProvider` over a real
 * `createAuthClient` runs against a stub server that answers `/config` the way
 * the server wraps it (`{ success, data }`), `/bootstrap-status` the way the
 * first-run probe reads it, and `/sign-up/email` by recording the body — so
 * "reaches a working registration" is read off the request the server would
 * receive, not off a mocked hook.
 *
 * The decision these pages call, `decideSignUpOffer`, lives in
 * `@object-ui/app-shell` since objectui#11705, which moved it there so the
 * package's exported default pages call the same rule. Its unit cases —
 * including the parity case against the spec's own posture predicate and
 * vocabulary — moved with it, unchanged, to
 * `packages/app-shell/src/console/auth/__tests__/signUpOffer-11691.test.ts`.
 * The console pages' rendered pins stay here, unchanged.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider, createAuthClient } from '@object-ui/auth';
import type { AuthPublicConfig } from '@object-ui/auth';
import type { AudiencePosture } from '@objectstack/spec/system';
import { LoginPage } from '../LoginPage';
import { RegisterPage } from '../RegisterPage';

const AUTH_URL = 'http://localhost/api/v1/auth';
const SIGN_UP_LINK = { name: 'Sign up' } as const;
const INVITATION = '/accept-invitation/inv_1';
const INVITE_QUERY = `?redirect=${encodeURIComponent(INVITATION)}`;
const SELF_REGISTRATION_CLOSED_TEXT = builtInLocales.en.auth.register.errors.selfRegistrationClosed;

/** The dev-seeded admin hint is set by the SAME config read as the sign-up offer. */
const DEV_SEED = { devSeedAdmin: { email: 'admin@objectos.ai', password: 'admin123' } };

type EmailPassword = NonNullable<AuthPublicConfig['emailPassword']>;
const OPEN_SIGN_UP: EmailPassword = { enabled: true, disableSignUp: false, requireEmailVerification: false };

/**
 * The config as the server sends it. `posture` is a plain string because the
 * cases include values OUTSIDE the spec vocabulary — what a newer server could
 * send — so the one cast below is the wire, not a shortcut.
 */
function configFor(
  posture: string | undefined,
  emailPassword: EmailPassword = OPEN_SIGN_UP,
): AuthPublicConfig & typeof DEV_SEED {
  return {
    ...DEV_SEED,
    emailPassword,
    features: posture === undefined ? {} : { audiencePosture: posture as AudiencePosture },
  };
}

interface Wire {
  bootstrapProbes: number;
  signUps: Array<Record<string, unknown>>;
}
let wire: Wire;

/** A signed-out visitor on a server with the given config and owner state. */
function stubServer(config: AuthPublicConfig, hasOwner: boolean): typeof fetch {
  wire = { bootstrapProbes: 0, signUps: [] };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/bootstrap-status')) {
      wire.bootstrapProbes += 1;
      return json({ hasOwner });
    }
    if (url.includes('/sign-up/email')) {
      wire.signUps.push(JSON.parse(String(init?.body)));
      return json({ user: { id: 'u_new', name: 'Ada', email: 'ada@example.com' }, token: null });
    }
    if (url.endsWith('/config')) return json({ success: true, data: config });
    return json(null);
  }) as typeof fetch;
}

const seen: string[] = [];
function Recorder() {
  const location = useLocation();
  seen.push(location.pathname + location.search);
  return null;
}

/**
 * Mount `/login` and `/register` as `App.tsx` routes them. The bootstrap
 * probe uses the global `fetch` (`useBootstrapStatus`, `@object-ui/app-shell`),
 * so the same stub answers it.
 */
function renderAt(path: string, config: AuthPublicConfig, { hasOwner = true } = {}) {
  const fetchFn = stubServer(config, hasOwner);
  vi.stubGlobal('fetch', fetchFn);
  window.history.replaceState({}, '', path);
  const client = createAuthClient({ baseURL: AUTH_URL, fetchFn });
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Recorder />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

/** Wait until the config read has been applied to the login page. */
async function loginConfigApplied() {
  await screen.findByTestId('dev-admin-hint');
  await screen.findByLabelText('Email');
}

beforeEach(() => {
  seen.length = 0;
  window.localStorage.clear();
  vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('LoginPage — the "Sign up" link follows the audience posture (objectui#11691)', () => {
  it('under invite_only on a deployment with an owner, offers no generic "Sign up"', async () => {
    renderAt('/login', configFor('invite_only'));
    await loginConfigApplied();
    await waitFor(() => expect(wire.bootstrapProbes).toBe(1));

    expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
  });

  it('under invite_only, still offers "Sign up" to an invitation redirect, carrying the redirect', async () => {
    renderAt(`/login${INVITE_QUERY}`, configFor('invite_only'));
    await loginConfigApplied();

    expect(screen.getByRole('link', SIGN_UP_LINK).getAttribute('href')).toBe(`/register${INVITE_QUERY}`);
    expect(wire.bootstrapProbes).toBe(0);
  });

  it('under invite_only on a deployment with no owner yet, keeps "Sign up" for the first owner', async () => {
    renderAt('/login', configFor('invite_only'), { hasOwner: false });
    await loginConfigApplied();
    await waitFor(() => expect(wire.bootstrapProbes).toBe(1));

    expect((await screen.findByRole('link', SIGN_UP_LINK)).getAttribute('href')).toBe('/register');
  });

  it('under open and email_domain, is unchanged and makes no bootstrap probe', async () => {
    for (const posture of ['open', 'email_domain']) {
      renderAt('/login', configFor(posture));
      await loginConfigApplied();

      expect(screen.getByRole('link', SIGN_UP_LINK).getAttribute('href')).toBe('/register');
      expect(wire.bootstrapProbes).toBe(0);
      cleanup();
    }
  });

  it('for a server that sends no audiencePosture, lets disableSignUp alone decide', async () => {
    renderAt('/login', configFor(undefined));
    await loginConfigApplied();

    expect(screen.getByRole('link', SIGN_UP_LINK).getAttribute('href')).toBe('/register');
    expect(wire.bootstrapProbes).toBe(0);
  });

  it('with disableSignUp: true, hides "Sign up" even from an invitation redirect', async () => {
    renderAt(`/login${INVITE_QUERY}`, configFor('invite_only', { enabled: true, disableSignUp: true }));
    await loginConfigApplied();

    expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
  });
});

describe('RegisterPage — explains invitation-only registration before the form (objectui#11691)', () => {
  it('under invite_only without an invitation, explains instead of rendering the form', async () => {
    renderAt('/register', configFor('invite_only'));

    const notice = await screen.findByTestId('register-by-invitation');
    expect(notice).toHaveTextContent(SELF_REGISTRATION_CLOSED_TEXT);
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create Account' })).toBeNull();
    expect(wire.signUps).toHaveLength(0);
  });

  it('an invitation redirect reaches a working registration under invite_only, from /login on', async () => {
    renderAt(`/login${INVITE_QUERY}`, configFor('invite_only'));
    await loginConfigApplied();
    await userEvent.click(screen.getByRole('link', SIGN_UP_LINK));

    await userEvent.type(await screen.findByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'hunter2hunter2');
    await userEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => expect(wire.signUps).toHaveLength(1));
    expect(wire.signUps[0]).toMatchObject({ name: 'Ada', email: 'ada@example.com' });
    expect(seen).toContain(`/register${INVITE_QUERY}`);
    expect(screen.queryByTestId('register-by-invitation')).toBeNull();
    expect(wire.bootstrapProbes).toBe(0);
  });

  it('under invite_only on a deployment with no owner yet, renders the form', async () => {
    renderAt('/register', configFor('invite_only'), { hasOwner: false });

    expect(await screen.findByRole('button', { name: 'Create Account' })).toBeInTheDocument();
    expect(screen.queryByTestId('register-by-invitation')).toBeNull();
    expect(wire.bootstrapProbes).toBe(1);
  });

  it('under open, renders the form as before and makes no bootstrap probe', async () => {
    renderAt('/register', configFor('open'));

    expect(await screen.findByRole('button', { name: 'Create Account' })).toBeInTheDocument();
    expect(wire.bootstrapProbes).toBe(0);
  });

  it('with disableSignUp: true, bounces an invitation redirect to /login as before', async () => {
    renderAt(`/register${INVITE_QUERY}`, configFor('invite_only', { enabled: true, disableSignUp: true }));

    await waitFor(() => expect(seen[seen.length - 1]).toBe(`/login${INVITE_QUERY}`));
    expect(screen.queryByRole('button', { name: 'Create Account' })).toBeNull();
    expect(screen.queryByTestId('register-by-invitation')).toBeNull();
  });
});
