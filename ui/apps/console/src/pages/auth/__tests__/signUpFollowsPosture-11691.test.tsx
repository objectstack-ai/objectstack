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
const SIGN_UP_LINK = { name: 'Sign up' } as const;
/** #25886 — an invitee's sign-up is the register-first prompt, not the small link. */
const INVITE_SIGN_UP = { name: builtInLocales.en.auth.login.invitationSignUpButton } as const;
const INVITATION = '/accept-invitation/inv_1';
const INVITE_QUERY = `?redirect=${encodeURIComponent(INVITATION)}`;
const SELF_REGISTRATION_CLOSED_TEXT = builtInLocales.en.auth.register.errors.selfRegistrationClosed;
/** objectstack#32021 — a deployment nobody has an account on leads with this. */
const FIRST_OWNER_LINK = { name: builtInLocales.en.auth.login.firstOwner.createButton } as const;

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
  signIns: number;
}
let wire: Wire;

/**
 * A signed-out visitor on a server with the given config and owner state.
 * `hasOwner: 'error'` is a probe the server fails (500). Every sign-in is
 * refused as a wrong password (objectstack#32021, the no-mail copy).
 */
function stubServer(config: AuthPublicConfig, hasOwner: boolean | 'error'): typeof fetch {
  wire = { bootstrapProbes: 0, signUps: [], signIns: 0 };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/bootstrap-status')) {
      wire.bootstrapProbes += 1;
      if (hasOwner === 'error') return new Response('{}', { status: 500 });
      return json({ hasOwner });
    }
    if (url.includes('/sign-in/email')) {
      wire.signIns += 1;
      return new Response(
        JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
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
function renderAt(
  path: string,
  config: AuthPublicConfig,
  { hasOwner = true }: { hasOwner?: boolean | 'error' } = {},
) {
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

  it('under invite_only, still offers sign-up to an invitation redirect, carrying the redirect', async () => {
    renderAt(`/login${INVITE_QUERY}`, configFor('invite_only'));
    await loginConfigApplied();

    // #25886 — greeted for the invitation, not as a returning user, with the
    // register-first prompt in place of the small link, never both.
    expect(
      screen.getByRole('heading', { name: builtInLocales.en.auth.login.invitationTitle }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: builtInLocales.en.auth.login.welcomeTitle }),
    ).toBeNull();
    expect(screen.getByRole('link', INVITE_SIGN_UP).getAttribute('href')).toBe(`/register${INVITE_QUERY}`);
    expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
    expect(wire.bootstrapProbes).toBe(0);
  });

  it('under invite_only on a deployment with no owner yet, still offers the first owner a sign-up', async () => {
    renderAt('/login', configFor('invite_only'), { hasOwner: false });
    await loginConfigApplied();
    await waitFor(() => expect(wire.bootstrapProbes).toBe(1));

    // objectstack#32021 — as the lead (the owner-account prompt), not the small link.
    expect((await screen.findByRole('link', FIRST_OWNER_LINK)).getAttribute('href')).toBe('/register');
    expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
  });

  it('under open and email_domain on a deployment with an owner, is unchanged', async () => {
    for (const posture of ['open', 'email_domain']) {
      renderAt('/login', configFor(posture));
      await loginConfigApplied();
      // objectstack#32021 — one probe, asking only whether an owner exists.
      await waitFor(() => expect(wire.bootstrapProbes).toBe(1));

      expect(screen.getByRole('link', SIGN_UP_LINK).getAttribute('href')).toBe('/register');
      expect(screen.queryByRole('link', FIRST_OWNER_LINK)).toBeNull();
      cleanup();
    }
  });

  it('for a server that sends no audiencePosture, lets disableSignUp alone decide', async () => {
    renderAt('/login', configFor(undefined));
    await loginConfigApplied();

    expect(screen.getByRole('link', SIGN_UP_LINK).getAttribute('href')).toBe('/register');
  });

  it('with disableSignUp: true, hides "Sign up" even from an invitation redirect', async () => {
    renderAt(`/login${INVITE_QUERY}`, configFor('invite_only', { enabled: true, disableSignUp: true }));
    await loginConfigApplied();

    expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
    // #25886 — still greeted for the invitation, but offered no registration.
    expect(
      screen.getByRole('heading', { name: builtInLocales.en.auth.login.invitationTitle }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', INVITE_SIGN_UP)).toBeNull();
  });
});

describe('LoginPage — an invitee without the link is told to open it (objectstack#27521 row 11)', () => {
  const HINT = builtInLocales.en.auth.login.invitationLinkHint;

  it('under invite_only on a deployment with an owner, says so in the card', async () => {
    renderAt('/login', configFor('invite_only'));
    await loginConfigApplied();
    expect(await screen.findByTestId('invitation-link-hint')).toHaveTextContent(HINT);
    expect(screen.getByTestId('login-card')).toContainElement(screen.getByTestId('invitation-link-hint'));
  });

  it('is not drawn where a sign-up is offered or for an invitation redirect', async () => {
    for (const [path, config, hasOwner] of [
      ['/login', configFor('open'), true],
      ['/login', configFor('invite_only'), false],
      [`/login${INVITE_QUERY}`, configFor('invite_only'), true],
    ] as const) {
      renderAt(path, config, { hasOwner });
      await loginConfigApplied();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.queryByTestId('invitation-link-hint'), `${path} owner=${hasOwner}`).toBeNull();
      cleanup();
    }
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
    await userEvent.click(screen.getByRole('link', INVITE_SIGN_UP));

    await userEvent.type(await screen.findByLabelText('Name'), 'Ada');
    // #25886 — the form asks for the invited address.
    expect(
      screen.getByRole('heading', { name: builtInLocales.en.auth.register.invitationTitle }),
    ).toBeInTheDocument();
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

  it('under open, renders the form as before', async () => {
    renderAt('/register', configFor('open'));

    expect(await screen.findByRole('button', { name: 'Create Account' })).toBeInTheDocument();
    expect(screen.queryByTestId('register-by-invitation')).toBeNull();
  });

  it('with disableSignUp: true, bounces an invitation redirect to /login as before', async () => {
    renderAt(`/register${INVITE_QUERY}`, configFor('invite_only', { enabled: true, disableSignUp: true }));

    await waitFor(() => expect(seen[seen.length - 1]).toBe(`/login${INVITE_QUERY}`));
    expect(screen.queryByRole('button', { name: 'Create Account' })).toBeNull();
    expect(screen.queryByTestId('register-by-invitation')).toBeNull();
  });
});

describe('a deployment nobody has an account on leads with creating the owner account (objectstack#32021)', () => {
  const en = builtInLocales.en.auth;

  it.each(['open', 'invite_only'])(
    'under %s, the first visit is set-up, not "Welcome back", with one way to the sign-up',
    async (posture) => {
      renderAt('/login', configFor(posture), { hasOwner: false });
      await loginConfigApplied();

      expect(await screen.findByRole('heading', { name: en.login.firstOwner.title })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: en.login.welcomeTitle })).toBeNull();
      expect(screen.getByTestId('first-owner-sign-up')).toHaveTextContent(en.login.firstOwner.signInDivider);
      expect(screen.getByRole('link', FIRST_OWNER_LINK).getAttribute('href')).toBe('/register');
      expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
      // Signing in to an existing account stays on the same card.
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.queryByTestId('invitation-link-hint')).toBeNull();
    },
  );

  it('the owner-account button reaches the register page, titled for the first owner', async () => {
    renderAt('/login', configFor('open'), { hasOwner: false });
    await loginConfigApplied();
    await userEvent.click(await screen.findByRole('link', FIRST_OWNER_LINK));

    expect(await screen.findByRole('heading', { name: en.register.firstOwner.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
    expect(seen[seen.length - 1]).toBe('/register');
  });

  it('CONTROL: a deployment with an owner still says "Welcome back" and keeps "Have an invitation?"', async () => {
    renderAt('/login', configFor('invite_only'));
    await loginConfigApplied();
    await waitFor(() => expect(wire.bootstrapProbes).toBe(1));

    expect(screen.getByRole('heading', { name: en.login.welcomeTitle })).toBeInTheDocument();
    expect(await screen.findByTestId('invitation-link-hint')).toHaveTextContent(en.login.invitationLinkHint);
    expect(screen.queryByRole('heading', { name: en.login.firstOwner.title })).toBeNull();
    expect(screen.queryByTestId('first-owner-sign-up')).toBeNull();
  });

  it('CONTROL: an open deployment with an owner says "Welcome back" with the small "Sign up"', async () => {
    renderAt('/login', configFor('open'));
    await loginConfigApplied();
    await waitFor(() => expect(wire.bootstrapProbes).toBe(1));

    expect(screen.getByRole('heading', { name: en.login.welcomeTitle })).toBeInTheDocument();
    expect(screen.getByRole('link', SIGN_UP_LINK).getAttribute('href')).toBe('/register');
    expect(screen.queryByTestId('first-owner-sign-up')).toBeNull();
  });

  it('a probe the server fails is not read as "nobody here": the page stays "Welcome back"', async () => {
    renderAt('/login', configFor('open'), { hasOwner: 'error' });
    await loginConfigApplied();
    await waitFor(() => expect(wire.bootstrapProbes).toBe(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByRole('heading', { name: en.login.welcomeTitle })).toBeInTheDocument();
    expect(screen.queryByTestId('first-owner-sign-up')).toBeNull();
  });

  it('an invitee on a deployment with no owner is greeted for the invitation, not as the owner', async () => {
    renderAt(`/login${INVITE_QUERY}`, configFor('open'), { hasOwner: false });
    await loginConfigApplied();

    expect(screen.getByRole('heading', { name: en.login.invitationTitle })).toBeInTheDocument();
    expect(screen.queryByTestId('first-owner-sign-up')).toBeNull();
    expect(wire.bootstrapProbes).toBe(0);
  });
});

describe('with no mail service, a wrong password points to the administrator (objectstack#32021)', () => {
  const errors = builtInLocales.en.auth.login.errors;

  async function signInRefused(config: AuthPublicConfig): Promise<string> {
    renderAt('/login', config);
    await loginConfigApplied();
    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await userEvent.click(screen.getByRole('button', { name: builtInLocales.en.auth.login.submitButton }));
    await waitFor(() => expect(wire.signIns).toBe(1));
    return (await screen.findByText(/Invalid email or password\./)).textContent ?? '';
  }

  const withMail = (emailDelivery: boolean | undefined): AuthPublicConfig => {
    const base = configFor('open');
    return {
      ...base,
      features: { ...base.features, ...(emailDelivery === undefined ? {} : { emailDelivery }) },
    };
  };

  it('the server says no mail is sent (features.emailDelivery: false): ask the administrator', async () => {
    const text = await signInRefused(withMail(false));
    expect(text).toBe(errors.invalidCredentialsNoMail);
    expect(text).not.toBe(errors.invalidCredentials);
  });

  it.each([true, undefined])(
    'CONTROL: emailDelivery %s keeps the reset hint',
    async (emailDelivery) => {
      const text = await signInRefused(withMail(emailDelivery));
      expect(text).toBe(errors.invalidCredentials);
    },
  );
});
