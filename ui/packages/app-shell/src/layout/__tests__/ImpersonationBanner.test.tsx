/**
 * objectui#4467 — the impersonation indicator and its exit.
 *
 * ## The harness, and why it is shaped this way
 *
 * These cases ride the REAL identity flow: `AuthProvider` resolves the session
 * from a client whose `getSession` answers **as a function of the token in
 * `TokenStorage`** — exactly what the server does — and the banner reads that
 * session out of the auth context. Nothing injects context state, and nothing
 * mocks `impersonatedBy` into a session the console could not otherwise reach.
 *
 * That shape makes the exit case a live check on the lane fix as well: the stop
 * call's response carries the restored administrator token in `set-auth-token`,
 * and only `createAuthenticatedFetch` adopting it (the #4467 repair) makes the
 * following `getSession` resolve the administrator. Revert the three-line
 * capture in `createAuthenticatedFetch.ts` and 'stop restores the administrator'
 * goes red here — the token stays the impersonated one, so the banner never
 * clears.
 *
 * ## What this harness CANNOT drive (stated, not faked)
 *
 * jsdom/happy-dom has no server, so the half of the mechanism that lives in
 * cookies is out of reach: the `admin_session` cookie `stop-impersonating`
 * resolves the administrator from, better-auth's server-side bearer plugin
 * OVERWRITING the request's session cookie with our bearer (the reason
 * impersonation was a no-op), and the signed-cookie round trip generally. Those
 * were measured live against a running stack on the card (issue #4467 and the
 * ruling update, comment 5273408139); what is pinned here is everything the
 * BROWSER owns — which token is sent, which token is adopted, which identity is
 * resolved, and what the console renders for it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, TokenStorage } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { I18nProvider } from '@object-ui/i18n';
import { ImpersonationBanner } from '../ImpersonationBanner';

const ADMIN_TOKEN = 'admin-token';
const IMPERSONATED_TOKEN = 'impersonated-token';

const ADMIN_SESSION = {
  user: { id: 'usr_admin', name: 'Dev Admin', email: 'admin@objectos.ai' },
  session: { token: ADMIN_TOKEN },
};
const IMPERSONATED_SESSION = {
  user: { id: 'usr_dave', name: 'RT8 Dave', email: 'rt8-dave@example.com' },
  session: { token: IMPERSONATED_TOKEN, impersonatedBy: 'usr_admin' },
};
// A SECOND impersonation, started after the first one ended — a new session
// with its own token, the way the server mints one per impersonate call.
const SECOND_IMPERSONATED_TOKEN = 'second-impersonated-token';
const SECOND_IMPERSONATED_SESSION = {
  user: { id: 'usr_erin', name: 'RT8 Erin', email: 'rt8-erin@example.com' },
  session: { token: SECOND_IMPERSONATED_TOKEN, impersonatedBy: 'usr_admin' },
};

/**
 * A client that resolves identity FROM THE STORED TOKEN, the way the server
 * does. Whatever rotates `TokenStorage` changes who the console is — which is
 * the whole mechanism under test.
 */
function tokenBoundClient(): AuthClient {
  return {
    getSession: vi.fn(async () => {
      const token = TokenStorage.get();
      if (token === IMPERSONATED_TOKEN) return IMPERSONATED_SESSION;
      if (token === SECOND_IMPERSONATED_TOKEN) return SECOND_IMPERSONATED_SESSION;
      if (token === ADMIN_TOKEN) return ADMIN_SESSION;
      return null;
    }),
    // The provider loads organizations once a user resolves; answer emptily so
    // the org effects are quiet. (Same one-seam doubling as AuthProvider.test.tsx.)
    listOrganizations: vi.fn(async () => []),
    getActiveOrganization: vi.fn(async () => null),
    getActiveMember: vi.fn(async () => null),
  } as unknown as AuthClient;
}

/** Stub `fetch` for the stop-impersonating call. */
function stubStopEndpoint(
  respond: (url: string) => Response,
): { urls: string[]; bearers: (string | null)[] } {
  const urls: string[] = [];
  const bearers: (string | null)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      urls.push(url);
      bearers.push(new Headers(init?.headers).get('Authorization'));
      return respond(url);
    }),
  );
  return { urls, bearers };
}

/**
 * Renders under the REAL locale packs (no `t` double), so the copy asserted
 * below is the copy the console ships and the `{{user}}` / `{{admin}}` holes
 * are filled by i18next rather than by the test.
 */
function renderBanner() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <AuthProvider authUrl="/api/v1/auth" client={tokenBoundClient()}>
        <ImpersonationBanner />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('ImpersonationBanner (#4467)', () => {
  beforeEach(() => {
    TokenStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TokenStorage.clear();
  });

  it('renders NOTHING for an ordinary session', async () => {
    TokenStorage.set(ADMIN_TOKEN);
    const { container } = renderBanner();

    // Wait for the session to resolve, so this is "resolved and still absent"
    // rather than "not rendered yet".
    await waitFor(() => expect(TokenStorage.get()).toBe(ADMIN_TOKEN));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByTestId('impersonation-banner')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('names BOTH parties while the session is impersonated', async () => {
    TokenStorage.set(IMPERSONATED_TOKEN);
    renderBanner();

    const banner = await screen.findByTestId('impersonation-banner');
    // The impersonated user — whose name every write is recorded under.
    expect(banner.textContent).toMatch(/RT8 Dave/);
    // The administrator who started it, as the session reports them.
    expect(banner.textContent).toMatch(/usr_admin/);
    // And an exit.
    expect(screen.getByTestId('impersonation-stop')).toBeTruthy();
  });

  it('stop: calls the endpoint, adopts the restored token, refreshes identity, banner goes', async () => {
    TokenStorage.set(IMPERSONATED_TOKEN);
    const seen = stubStopEndpoint(() =>
      // The server hands the ADMINISTRATOR's session back the same way it
      // handed the impersonated one out: a rotation on the response header.
      new Response('{}', { status: 200, headers: { 'set-auth-token': ADMIN_TOKEN } }),
    );
    renderBanner();

    await screen.findByTestId('impersonation-banner');
    await userEvent.click(screen.getByTestId('impersonation-stop'));

    await waitFor(() => expect(screen.queryByTestId('impersonation-banner')).toBeNull());
    expect(seen.urls.some((u) => u.endsWith('/api/v1/auth/admin/stop-impersonating'))).toBe(true);
    // The request went out AS the impersonated user (that is the session we
    // hold); the administrator is restored from the `admin_session` cookie.
    expect(seen.bearers[0]).toBe(`Bearer ${IMPERSONATED_TOKEN}`);
    // The rotation was adopted — this is the lane fix doing the work.
    expect(TokenStorage.get()).toBe(ADMIN_TOKEN);
  });

  it('stop REJECTED: says so loudly and keeps the banner up', async () => {
    TokenStorage.set(IMPERSONATED_TOKEN);
    stubStopEndpoint(() =>
      new Response(JSON.stringify({ message: 'admin session not found' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    renderBanner();

    await screen.findByTestId('impersonation-banner');
    await userEvent.click(screen.getByTestId('impersonation-stop'));

    const error = await screen.findByTestId('impersonation-stop-error');
    expect(error.textContent).toMatch(/admin session not found/);
    // Still impersonating — the indicator must not disappear on a failed exit.
    expect(screen.getByTestId('impersonation-banner')).toBeTruthy();
    expect(TokenStorage.get()).toBe(IMPERSONATED_TOKEN);
  });

  it('stop ACCEPTED but nothing restored (cookie-blocked deployment): still fails loudly', async () => {
    TokenStorage.set(IMPERSONATED_TOKEN);
    // 200 with no rotation: the endpoint answered, the administrator was never
    // restored — the shape a deployment that cannot carry `admin_session`
    // produces. Appearing to succeed here would be worse than the original bug.
    stubStopEndpoint(() => new Response('{}', { status: 200 }));
    renderBanner();

    await screen.findByTestId('impersonation-banner');
    await userEvent.click(screen.getByTestId('impersonation-stop'));

    const stranded = await screen.findByTestId('impersonation-not-restored');
    expect(stranded.textContent).toMatch(/RT8 Dave/);
    expect(screen.getByTestId('impersonation-banner')).toBeTruthy();
  });

  it('a LATER impersonation, after a stop that worked, is not reported as a failed stop', async () => {
    TokenStorage.set(IMPERSONATED_TOKEN);
    stubStopEndpoint(() =>
      new Response('{}', { status: 200, headers: { 'set-auth-token': ADMIN_TOKEN } }),
    );
    renderBanner();

    await screen.findByTestId('impersonation-banner');
    await userEvent.click(screen.getByTestId('impersonation-stop'));
    await waitFor(() => expect(screen.queryByTestId('impersonation-banner')).toBeNull());

    // The administrator, still on the same page, impersonates someone else:
    // the impersonate action's response rotates the token, and the provider
    // re-resolves identity from it. No reload in between, so the banner that
    // ran the first stop is the one that renders the second impersonation.
    TokenStorage.set(SECOND_IMPERSONATED_TOKEN);

    const banner = await screen.findByTestId('impersonation-banner');
    expect(banner.textContent).toMatch(/RT8 Erin/);
    // Nobody pressed Stop on THIS impersonation, so nothing may say it failed.
    expect(screen.queryByTestId('impersonation-not-restored')).toBeNull();
    expect(screen.queryByTestId('impersonation-stop-error')).toBeNull();
  });
});
