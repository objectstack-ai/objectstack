/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11705 — `DefaultLoginPage` and `DefaultRegisterPage`, the auth
 * pages this package publishes for hosts (`examples/console-starter` mounts
 * them at `/login` and `/register`), offer a generic sign-up only where the
 * server would accept one.
 *
 * `/api/v1/auth/config` states the sign-up rule as two keys:
 * `emailPassword.disableSignUp` (the hard off switch) and
 * `features.audiencePosture` (who may self-register). Under the default
 * `invite_only` posture the server keeps `disableSignUp: false` so a pending
 * invitee can still register, and refuses anyone else with
 * `403 SELF_REGISTRATION_CLOSED`. These pages read `disableSignUp` alone, so
 * they offered "Sign up" — and the full form — to every visitor under the
 * default posture. objectui#11691 fixed the console's own pages; this card
 * moved that decision (`../signUpOffer`) into this package and the default
 * pages now call it. Its unit cases are `signUpOffer-11691.test.ts` beside
 * this file; the console pages' rendered pins stay in
 * `apps/console/src/pages/auth/__tests__/signUpFollowsPosture-11691.test.tsx`.
 *
 * Rendered as shipped: the exported pages, `@object-ui/auth`'s real forms, a
 * real `AuthProvider` over a real `createAuthClient`, and a real
 * `I18nProvider`. Only `fetch` is a stub, answering `/config` the way the
 * server wraps it (`{ success, data }`), `/bootstrap-status` the way the
 * first-run probe reads it, and `/sign-up/email` by recording the body — so
 * "reaches a working registration" is read off the request the server would
 * receive, not off a mocked hook. Visible text is read from the en locale
 * pack, not copied here.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
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
const en = builtInLocales.en.auth;
const SIGN_UP_LINK = { name: en.login.signUpText } as const;
const CREATE_ACCOUNT = { name: en.register.submitButton } as const;
const INVITATION = '/accept-invitation/inv_1';
const INVITE_QUERY = `?redirect=${encodeURIComponent(INVITATION)}`;

type EmailPassword = NonNullable<AuthPublicConfig['emailPassword']>;
const OPEN_SIGN_UP: EmailPassword = { enabled: true, disableSignUp: false, requireEmailVerification: false };
const SIGN_UP_OFF: EmailPassword = { enabled: true, disableSignUp: true };

/**
 * The config as the server sends it. `posture` is a plain string because the
 * server's wire value is what is being modelled, so the one cast below is the
 * wire, not a shortcut.
 */
function configFor(posture: string | undefined, emailPassword: EmailPassword = OPEN_SIGN_UP): AuthPublicConfig {
  return {
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
 * Mount the default pages as `examples/console-starter/src/App.tsx` routes
 * them. The bootstrap probe uses the global `fetch` (`../bootstrapStatus`),
 * so the same stub answers it.
 */
function renderAt(path: string, config: AuthPublicConfig, { hasOwner = true } = {}) {
  const fetchFn = stubServer(config, hasOwner);
  vi.stubGlobal('fetch', fetchFn);
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

/**
 * Wait until the config read has been applied to the login page. `LoginForm`
 * shows its email field only once ITS read of the same cached `/config`
 * promise settles, which is after the page's own `.then` on that promise has
 * stored the config — so the field's presence means the page has decided.
 */
async function loginConfigApplied() {
  await screen.findByLabelText(en.login.emailLabel);
}

/** Let an answered probe's state update land before a negative assertion. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  seen.length = 0;
  window.localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DefaultLoginPage — the "Sign up" link follows the audience posture (objectui#11705)', () => {
  it('under invite_only on a deployment with an owner, offers no generic "Sign up"', async () => {
    renderAt('/login', configFor('invite_only'));
    await loginConfigApplied();
    await waitFor(() => expect(wire.bootstrapProbes).toBe(1));
    await settle();

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
    renderAt(`/login${INVITE_QUERY}`, configFor('invite_only', SIGN_UP_OFF));
    await loginConfigApplied();

    expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
    expect(wire.bootstrapProbes).toBe(0);
  });
});

describe('DefaultRegisterPage — explains invitation-only registration before the form (objectui#11705)', () => {
  it('under invite_only without an invitation, explains instead of rendering the form', async () => {
    renderAt('/register', configFor('invite_only'));

    const notice = await screen.findByTestId('register-by-invitation');
    expect(notice).toHaveTextContent(en.register.errors.selfRegistrationClosed);
    expect(screen.getByRole('link', { name: en.register.signInText }).getAttribute('href')).toBe('/login');
    expect(screen.queryByLabelText(en.register.emailLabel)).toBeNull();
    expect(screen.queryByRole('button', CREATE_ACCOUNT)).toBeNull();
    expect(wire.bootstrapProbes).toBe(1);
    expect(wire.signUps).toHaveLength(0);
  });

  it('an invitation redirect reaches a working registration under invite_only, from /login on', async () => {
    renderAt(`/login${INVITE_QUERY}`, configFor('invite_only'));
    await loginConfigApplied();
    await userEvent.click(screen.getByRole('link', SIGN_UP_LINK));

    await userEvent.type(await screen.findByLabelText(en.register.nameLabel), 'Ada');
    await userEvent.type(screen.getByLabelText(en.register.emailLabel), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(en.register.passwordLabel), 'hunter2hunter2');
    await userEvent.type(screen.getByLabelText(en.register.confirmPasswordLabel), 'hunter2hunter2');
    expect(screen.getByRole('link', { name: en.register.signInText }).getAttribute('href')).toBe(
      `/login${INVITE_QUERY}`,
    );
    await userEvent.click(screen.getByRole('button', CREATE_ACCOUNT));

    await waitFor(() => expect(wire.signUps).toHaveLength(1));
    expect(wire.signUps[0]).toMatchObject({ name: 'Ada', email: 'ada@example.com' });
    expect(seen).toContain(`/register${INVITE_QUERY}`);
    expect(screen.queryByTestId('register-by-invitation')).toBeNull();
    expect(wire.bootstrapProbes).toBe(0);
  });

  it('under invite_only on a deployment with no owner yet, renders the form', async () => {
    renderAt('/register', configFor('invite_only'), { hasOwner: false });

    expect(await screen.findByRole('button', CREATE_ACCOUNT)).toBeInTheDocument();
    expect(screen.queryByTestId('register-by-invitation')).toBeNull();
    expect(wire.bootstrapProbes).toBe(1);
  });

  it('under open, renders the form as before and makes no bootstrap probe', async () => {
    renderAt('/register', configFor('open'));

    expect(await screen.findByRole('button', CREATE_ACCOUNT)).toBeInTheDocument();
    expect(wire.bootstrapProbes).toBe(0);
  });

  it('with disableSignUp: true, bounces an invitation redirect to /login, keeping the redirect', async () => {
    renderAt(`/register${INVITE_QUERY}`, configFor('invite_only', SIGN_UP_OFF));

    await waitFor(() => expect(seen[seen.length - 1]).toBe(`/login${INVITE_QUERY}`));
    expect(screen.queryByRole('button', CREATE_ACCOUNT)).toBeNull();
    expect(screen.queryByTestId('register-by-invitation')).toBeNull();
  });
});
