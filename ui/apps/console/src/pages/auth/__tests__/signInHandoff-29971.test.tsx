/**
 * The sign-in pages finish the mobile sign-in hand-off (#29971).
 *
 * The mobile shell opens `/login?redirect=` naming the hand-off route in the
 * system auth session; after sign-in the page must navigate to that API route,
 * which `withConsoleBase` used to turn into a Console route that does not
 * exist. One pin per rule of `../handoffRedirect`'s header:
 *
 *  1. the hand-off is navigated to unprefixed, and every other redirect keeps
 *     today's Console-route behaviour (CONTROL `/api/v1/data/x`, a lookalike,
 *     an absolute URL);
 *  2. a provider sign-in returns to this page, never to the hand-off;
 *  3. the hand-off comes before the organization steps;
 *  4. a session older than five minutes shows the form, and a sign-in on it
 *     forwards.
 *
 * The real `AuthProvider` runs over a mock client, so a sign-in reaches the
 * page the way it does in the browser: better-auth's sign-in answer carries no
 * session record, and the provider holds what the client hands back.
 *
 * The Console is mounted as the shipped embeddable build is (`<base
 * href="/_console/">`, `BASE_URL` `./`), so "outside the mount" and "a Console
 * route" are told apart by where the browser would land.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';
import { RegisterPage } from '../RegisterPage';

const HANDOFF =
  '/api/v1/auth/one-time-token/handoff?redirect_uri=ai.objectos.mobile%3A%2F%2Fauth%2Fcallback' +
  '&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';
const HANDOFF_PATH = '/api/v1/auth/one-time-token/handoff';

const USER = { id: 'u1', name: 'Ada', email: 'ada@example.com' };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

let baseEl: HTMLBaseElement | null = null;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  baseEl = document.createElement('base');
  baseEl.setAttribute('href', '/_console/');
  document.head.appendChild(baseEl);
  vi.stubEnv('BASE_URL', './');
  assign = vi.fn();
  vi.spyOn(window.location, 'assign').mockImplementation(assign as never);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  baseEl?.remove();
  baseEl = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

interface ClientOptions {
  /** What `get-session` answers on arrival: `null` = signed out. */
  arrival?: { createdAt?: Date } | null;
  config?: Record<string, unknown>;
  organizations?: Array<{ id: string; name: string; slug: string }>;
}

function createMockClient({ arrival = null, config = {}, organizations }: ClientOptions = {}) {
  const client = {
    getSession: vi.fn().mockResolvedValue(
      arrival ? { user: USER, session: { token: 'arrival-token', ...arrival } } : null,
    ),
    getConfig: vi.fn().mockResolvedValue(config),
    // better-auth's `/sign-in/email` answers `{ redirect, token, url, user }`:
    // the client hands back no session record (`session: undefined`).
    signIn: vi.fn().mockResolvedValue({ user: USER, session: undefined }),
    signUp: vi.fn().mockResolvedValue({ user: USER, session: undefined, requiresVerification: false }),
    signInWithProvider: vi.fn().mockResolvedValue(undefined),
    ...(organizations
      ? {
          listOrganizations: vi.fn().mockResolvedValue(organizations),
          getActiveOrganization: vi.fn().mockResolvedValue(null),
          setActiveOrganization: vi.fn().mockResolvedValue(undefined),
        }
      : {}),
  };
  return client as typeof client & AuthClient;
}

function renderPage(page: 'login' | 'register', client: AuthClient, redirect?: string, extraQuery = '') {
  const search = (redirect ? `?redirect=${encodeURIComponent(redirect)}` : '') + extraQuery;
  window.history.replaceState({}, '', `/_console/${page}${search}`);
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={[`/${page}${search}`]}>
        {page === 'login' ? <LoginPage /> : <RegisterPage />}
      </MemoryRouter>
    </AuthProvider>,
  );
}

/** The single full-page navigation the page performed. */
async function exitTarget(): Promise<string> {
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(assign).toHaveBeenCalledTimes(1);
  return assign.mock.calls[0][0] as string;
}

/** Where that navigation lands, per the browser's own resolution. */
const lands = (target: string) => new URL(target, document.baseURI).pathname;

async function signInOnTheForm() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), USER.email);
  await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
}

describe('LoginPage — rule 1: the hand-off route, and nothing wider', () => {
  it('navigates to the hand-off unprefixed, outside the Console mount', async () => {
    renderPage('login', createMockClient({ arrival: { createdAt: minutesAgo(1) } }), HANDOFF);
    const target = await exitTarget();
    expect(target).toBe(HANDOFF);
    expect(lands(target)).toBe(HANDOFF_PATH);
  });

  it('CONTROL: /api/v1/data/x stays a Console route, as it is today', async () => {
    renderPage('login', createMockClient({ arrival: { createdAt: minutesAgo(1) } }), '/api/v1/data/x');
    expect(lands(await exitTarget())).toBe('/_console/api/v1/data/x');
  });

  it('a lookalike path stays a Console route', async () => {
    renderPage(
      'login',
      createMockClient({ arrival: { createdAt: minutesAgo(1) } }),
      `${HANDOFF_PATH}X?redirect_uri=x`,
    );
    expect(lands(await exitTarget())).toBe(`/_console${HANDOFF_PATH}X`);
  });

  it('an absolute URL naming the hand-off is not followed', async () => {
    renderPage(
      'login',
      createMockClient({ arrival: { createdAt: minutesAgo(1) } }),
      `https://evil.example${HANDOFF}`,
    );
    const target = await exitTarget();
    expect(lands(target)).toBe('/_console/');
    expect(target).not.toContain('evil.example');
  });
});

describe('LoginPage — rule 2: by script from this page, never as a provider callbackURL', () => {
  it('a provider sign-in returns to this sign-in page, which still carries the hand-off', async () => {
    const client = createMockClient({
      config: { socialProviders: [{ id: 'google', name: 'Google', enabled: true, type: 'social' }] },
    });
    renderPage('login', client, HANDOFF);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(client.signInWithProvider).toHaveBeenCalledTimes(1));
    const [, options] = client.signInWithProvider.mock.calls[0] as [string, { callbackURL: string; errorCallbackURL: string }];
    for (const url of [options.callbackURL, options.errorCallbackURL]) {
      const callback = new URL(url);
      expect(callback.pathname).toBe('/_console/login');
      expect(callback.searchParams.get('redirect')).toBe(HANDOFF);
    }
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('LoginPage — rule 3: before the organization steps', () => {
  it('several organizations and none active: the hand-off, not the /organizations picker', async () => {
    const client = createMockClient({
      arrival: { createdAt: minutesAgo(1) },
      organizations: [
        { id: 'org_1', name: 'One', slug: 'one' },
        { id: 'org_2', name: 'Two', slug: 'two' },
      ],
    });
    renderPage('login', client, HANDOFF);
    expect(await exitTarget()).toBe(HANDOFF);
  });

  it('a single organization and none active: no wait for it to become active', async () => {
    const client = createMockClient({
      arrival: { createdAt: minutesAgo(1) },
      organizations: [{ id: 'org_1', name: 'One', slug: 'one' }],
    });
    // Activating the organization never answers: a page that waited on it
    // (the provider's own activation or the page's switchOrganization) would
    // never navigate.
    client.setActiveOrganization.mockImplementation(() => new Promise(() => {}));
    renderPage('login', client, HANDOFF);
    expect(await exitTarget()).toBe(HANDOFF);
  });
});

describe('LoginPage — rule 4: a session older than five minutes', () => {
  it('shows the sign-in form instead of forwarding', async () => {
    renderPage('login', createMockClient({ arrival: { createdAt: minutesAgo(6) } }), HANDOFF);
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('a sign-in on that form makes a new session and forwards to the hand-off', async () => {
    const client = createMockClient({ arrival: { createdAt: minutesAgo(6) } });
    renderPage('login', client, HANDOFF);
    await signInOnTheForm();

    expect(client.signIn).toHaveBeenCalledWith({ email: USER.email, password: 'hunter2hunter2' });
    expect(await exitTarget()).toBe(HANDOFF);
  });

  it('a session found on arrival without createdAt is held to the form too', async () => {
    renderPage('login', createMockClient({ arrival: {} }), HANDOFF);
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('a visitor who arrives signed out is forwarded once signed in', async () => {
    const client = createMockClient();
    renderPage('login', client, HANDOFF);
    await signInOnTheForm();
    expect(await exitTarget()).toBe(HANDOFF);
  });

  it('CONTROL: the window applies only to the hand-off; an old session on an ordinary redirect forwards', async () => {
    renderPage('login', createMockClient({ arrival: { createdAt: minutesAgo(60) } }), '/settings');
    expect(lands(await exitTarget())).toBe('/_console/settings');
  });
});

describe('LoginPage — rule 5: the route said when it refused', () => {
  const refusedAt = (msFromNow: number) => `&handoff_refused_at=${Date.now() + msFromNow}`;

  it('holds the form for a session not created after the refusal, though this device reads it as young', async () => {
    renderPage('login', createMockClient({ arrival: { createdAt: minutesAgo(1) } }), HANDOFF, refusedAt(0));
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('a sign-in on that form forwards to the hand-off', async () => {
    renderPage('login', createMockClient({ arrival: { createdAt: minutesAgo(1) } }), HANDOFF, refusedAt(0));
    await signInOnTheForm();
    expect(await exitTarget()).toBe(HANDOFF);
  });

  it('a session created after it forwards, though this device reads it as too old: a provider returned to this URL', async () => {
    renderPage('login', createMockClient({ arrival: { createdAt: minutesAgo(10) } }), HANDOFF, refusedAt(-20 * 60_000));
    expect(await exitTarget()).toBe(HANDOFF);
  });

  it('CONTROL: a value that is not digits is ignored, and the five-minute check decides', async () => {
    renderPage('login', createMockClient({ arrival: { createdAt: minutesAgo(1) } }), HANDOFF, '&handoff_refused_at=soon');
    expect(await exitTarget()).toBe(HANDOFF);
  });

  it('CONTROL: signed out on arrival, a sign-in forwards as it always did', async () => {
    renderPage('login', createMockClient(), HANDOFF, refusedAt(0));
    await signInOnTheForm();
    expect(await exitTarget()).toBe(HANDOFF);
  });
});

describe('RegisterPage — the same hand-off after a sign-up', () => {
  it('navigates to the hand-off unprefixed for a fresh session', async () => {
    renderPage('register', createMockClient({ arrival: { createdAt: minutesAgo(1) } }), HANDOFF);
    const target = await exitTarget();
    expect(target).toBe(HANDOFF);
    expect(lands(target)).toBe(HANDOFF_PATH);
  });

  it('CONTROL: /api/v1/data/x stays a Console route', async () => {
    renderPage('register', createMockClient({ arrival: { createdAt: minutesAgo(1) } }), '/api/v1/data/x');
    expect(lands(await exitTarget())).toBe('/_console/api/v1/data/x');
  });

  it('a session older than five minutes shows the sign-up form, and a sign-up on it forwards', async () => {
    const client = createMockClient({ arrival: { createdAt: minutesAgo(6) } });
    renderPage('register', client, HANDOFF);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), USER.name);
    expect(assign).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Email'), USER.email);
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await user.type(screen.getByLabelText('Confirm Password'), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => expect(client.signUp).toHaveBeenCalledTimes(1));
    expect(await exitTarget()).toBe(HANDOFF);
  });
});
