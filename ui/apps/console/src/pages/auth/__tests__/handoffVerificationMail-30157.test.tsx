/**
 * A person who has to verify their email during the mobile sign-in hand-off
 * (#30157).
 *
 * Two defects on that road, one pin per hop:
 *
 *  - **The mail's link.** The sign-up and the "Resend" mail sent the hand-off
 *    `redirect` through `withConsoleBaseRootRelative`, so the link returned to
 *    `/_console/api/v1/auth/one-time-token/handoff?…`, a Console page that does
 *    not exist. It now returns to `/verify-email?handoff=verified`, which says
 *    the address is confirmed and to go back to the app (`../handoffRedirect`
 *    rule 6), and that landing is pinned too.
 *  - **The route's refusal time.** `handoff_refused_at` was dropped on the three
 *    hops through `/verify-email-prompt`: `/login`'s `EMAIL_NOT_VERIFIED`
 *    branch, `/register`'s verification-required branch, and "Back to login".
 *
 * CONTROL on every hop: beside any other `redirect` (an invitation), the link,
 * the `callbackURL` and the navigation are byte for byte what they were.
 *
 * The real `AuthProvider` runs over a mock client, so `callbackURL` is read off
 * the call the client would put on the wire. The Console is mounted as the
 * shipped embeddable build is (`<base href="/_console/">`, `BASE_URL` `./`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

const { LoginPage } = await import('../LoginPage');
const { RegisterPage } = await import('../RegisterPage');
const { VerifyEmailPromptPage } = await import('../VerifyEmailPromptPage');
const { VerifyEmailPage } = await import('../VerifyEmailPage');

const HANDOFF =
  '/api/v1/auth/one-time-token/handoff?redirect_uri=ai.objectos.mobile%3A%2F%2Fauth%2Fcallback' +
  '&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';
const INVITE = '/accept-invitation/inv_1';
const MARK = '&handoff_refused_at=1793620800000';
const EMAIL = 'ada@example.com';
const USER = { id: 'u1', name: 'Ada', email: EMAIL };

let baseEl: HTMLBaseElement | null = null;

beforeEach(() => {
  window.localStorage.clear();
  baseEl = document.createElement('base');
  baseEl.setAttribute('href', '/_console/');
  document.head.appendChild(baseEl);
  vi.stubEnv('BASE_URL', './');
  vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  baseEl?.remove();
  baseEl = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A signed-out visitor on a server that gates sign-in on email verification. */
function createMockClient() {
  const unverified = Object.assign(new Error('Email not verified'), { code: 'EMAIL_NOT_VERIFIED' });
  const client = {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({}),
    signIn: vi.fn().mockRejectedValue(unverified),
    signUp: vi.fn().mockResolvedValue({ user: USER, session: null, requiresVerification: true }),
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  };
  return client as typeof client & AuthClient;
}

/** Where the router is, for the navigations a page makes without leaving the document. */
function RouterLocation() {
  const location = useLocation();
  return <span data-testid="router-location">{`${location.pathname}${location.search}`}</span>;
}

const PAGES = {
  login: LoginPage,
  register: RegisterPage,
  'verify-email-prompt': VerifyEmailPromptPage,
  'verify-email': VerifyEmailPage,
} as const;

function renderPage(page: keyof typeof PAGES, client: AuthClient, search: string) {
  const Page = PAGES[page];
  window.history.replaceState({}, '', `/_console/${page}${search}`);
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={[`/${page}${search}`]}>
        <Page />
        <RouterLocation />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const withRedirect = (redirect: string) => `?redirect=${encodeURIComponent(redirect)}`;
const routerLocation = () => screen.getByTestId('router-location').textContent;

/** The prompt's query as `/login` and `/register` build it today: `email`, then `redirect`. */
const promptAt = (redirect: string) => {
  const sp = new URLSearchParams();
  sp.set('email', EMAIL);
  sp.set('redirect', redirect);
  return `/verify-email-prompt?${sp.toString()}`;
};

async function signInUnverified(client: ReturnType<typeof createMockClient>, redirect: string, mark: string) {
  renderPage('login', client, `${withRedirect(redirect)}${mark}`);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), EMAIL);
  await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
  await waitFor(() => expect(routerLocation()).toMatch(/^\/verify-email-prompt/));
}

async function signUpUnverified(client: ReturnType<typeof createMockClient>, redirect: string, mark: string) {
  renderPage('register', client, `${withRedirect(redirect)}${mark}`);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Name'), 'Ada');
  await user.type(screen.getByLabelText('Email'), EMAIL);
  await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
  await user.type(screen.getByLabelText('Confirm Password'), 'hunter2hunter2');
  await user.click(screen.getByRole('button', { name: 'Create Account' }));
  await waitFor(() => expect(routerLocation()).toMatch(/^\/verify-email-prompt/));
}

describe('the verification mail returns a hand-off sign-up to "go back to the app"', () => {
  it('/register: the sign-up mail', async () => {
    const client = createMockClient();
    await signUpUnverified(client, HANDOFF, MARK);
    expect(client.signUp.mock.calls[0][0].callbackURL).toBe('/_console/verify-email?handoff=verified');
  });

  it('/verify-email-prompt: the resent mail', async () => {
    const client = createMockClient();
    renderPage('verify-email-prompt', client, `?email=${encodeURIComponent(EMAIL)}&redirect=${encodeURIComponent(HANDOFF)}`);
    await userEvent.click(await screen.findByRole('button', { name: /Resend verification email/ }));
    await waitFor(() => expect(client.sendVerificationEmail).toHaveBeenCalledTimes(1));
    expect(client.sendVerificationEmail.mock.calls[0]).toEqual([EMAIL, '/_console/verify-email?handoff=verified']);
  });

  it('CONTROL: an invitation redirect keeps today\'s callbackURL on both mails', async () => {
    const client = createMockClient();
    await signUpUnverified(client, INVITE, MARK);
    expect(client.signUp.mock.calls[0][0].callbackURL).toBe('/_console/accept-invitation/inv_1');
    cleanup();
    renderPage('verify-email-prompt', client, `?email=${encodeURIComponent(EMAIL)}&redirect=${encodeURIComponent(INVITE)}`);
    await userEvent.click(await screen.findByRole('button', { name: /Resend verification email/ }));
    await waitFor(() => expect(client.sendVerificationEmail).toHaveBeenCalledTimes(1));
    expect(client.sendVerificationEmail.mock.calls[0]).toEqual([EMAIL, '/_console/accept-invitation/inv_1']);
  });
});

describe('the route\'s refusal time survives the hops through /verify-email-prompt', () => {
  it('/login: EMAIL_NOT_VERIFIED carries it to the prompt', async () => {
    await signInUnverified(createMockClient(), HANDOFF, MARK);
    expect(routerLocation()).toBe(`${promptAt(HANDOFF)}${MARK}`);
  });

  it('/register: verification required carries it to the prompt', async () => {
    await signUpUnverified(createMockClient(), HANDOFF, MARK);
    expect(routerLocation()).toBe(`${promptAt(HANDOFF)}${MARK}`);
  });

  it('/verify-email-prompt: "Back to login" carries it', async () => {
    renderPage('verify-email-prompt', createMockClient(), `?redirect=${encodeURIComponent(HANDOFF)}${MARK}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Back to login' }));
    await waitFor(() => expect(routerLocation()).toBe(`/login${withRedirect(HANDOFF)}${MARK}`));
  });

  it('CONTROL: beside an invitation redirect, mark or no mark, every hop is what it was', async () => {
    await signInUnverified(createMockClient(), INVITE, MARK);
    expect(routerLocation()).toBe(promptAt(INVITE));
    cleanup();
    await signUpUnverified(createMockClient(), INVITE, MARK);
    expect(routerLocation()).toBe(promptAt(INVITE));
    cleanup();
    renderPage('verify-email-prompt', createMockClient(), `?redirect=${encodeURIComponent(INVITE)}${MARK}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Back to login' }));
    await waitFor(() => expect(routerLocation()).toBe(`/login${withRedirect(INVITE)}`));
  });

  it('CONTROL: beside a hand-off redirect with no mark on the page, every hop is what it was', async () => {
    await signInUnverified(createMockClient(), HANDOFF, '');
    expect(routerLocation()).toBe(promptAt(HANDOFF));
    cleanup();
    renderPage('verify-email-prompt', createMockClient(), withRedirect(HANDOFF));
    await userEvent.click(await screen.findByRole('button', { name: 'Back to login' }));
    await waitFor(() => expect(routerLocation()).toBe(`/login${withRedirect(HANDOFF)}`));
  });
});

describe('/verify-email?handoff=verified — where the mail\'s link lands', () => {
  it('says the address is confirmed and offers no Console sign-in', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPage('verify-email', createMockClient(), '?handoff=verified');
    await waitFor(() => expect(document.querySelector('[data-landing="handoff"]')).not.toBeNull());
    expect(screen.queryByRole('link', { name: 'Go to sign in' })).toBeNull();
    // The server verified already: the page spends no token of its own.
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/verify-email'))).toBe(false);
  });

  it('shows the failure when the server appended its error', async () => {
    renderPage('verify-email', createMockClient(), '?handoff=verified&error=INVALID_TOKEN');
    expect(await screen.findByText('Verification failed')).toBeTruthy();
    expect(document.querySelector('[data-landing="handoff"]')).toBeNull();
  });

  it('CONTROL: with no token and no landing mark, the page still reports the missing token', async () => {
    renderPage('verify-email', createMockClient(), '');
    expect(await screen.findByText('Verification failed')).toBeTruthy();
    expect(document.querySelector('[data-landing="handoff"]')).toBeNull();
  });
});
