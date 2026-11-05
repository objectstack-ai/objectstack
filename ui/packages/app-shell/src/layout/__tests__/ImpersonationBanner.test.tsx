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

import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { AuthProvider, TokenStorage, createAuthenticatedFetch } from '@object-ui/auth';
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

const STOP_PATH = '/api/v1/auth/admin/stop-impersonating';

/** The administrator's `sys_user` row, read by the banner to name them. */
const ADMIN_READ_PATH = '/api/v1/data/sys_user/usr_admin';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * The data route's answer for the administrator's row: the spec's
 * `GetDataResponse` body, unwrapped, as a live server answers it.
 */
function adminRow(fields: Record<string, unknown>): Response {
  return jsonResponse({ object: 'sys_user', id: 'usr_admin', record: { id: 'usr_admin', ...fields } });
}

/** Stub `fetch` for the stop-impersonating call and the administrator read. */
function stubStopEndpoint(
  respond: (url: string) => Response | Promise<Response>,
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

/**
 * Issues the banner's own administrator read — same URL, same authenticated
 * lane — at the one moment the teardown order decides: when `cleanup()`
 * unmounts the tree. That is where the banner's read lands when its effect is
 * still pending as the test body returns (cleanup's act-flush runs it), which
 * is timing and cannot be held open on purpose; this lands one there every time.
 */
function LateAdministratorRead() {
  useEffect(
    () => () => {
      void createAuthenticatedFetch()(ADMIN_READ_PATH, { method: 'GET' }).catch(() => {});
    },
    [],
  );
  return null;
}

describe('ImpersonationBanner (#4467)', () => {
  beforeEach(() => {
    TokenStorage.clear();
  });

  afterEach(() => {
    // Unmount BEFORE restoring the real `fetch` (objectui#7439). Vitest runs
    // this hook before the root setup's RTL cleanup() and the network-escape
    // guard, so unstubbing first left the tree mounted with the real global
    // back: the banner's `sys_user` read, when its effect was still pending as
    // the body returned, then went out to localhost:3000 during that cleanup.
    // Pinned by 'a read that lands AFTER the test body …' below.
    cleanup();
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
    const seen = stubStopEndpoint((url) =>
      url.endsWith(ADMIN_READ_PATH) ? adminRow({ name: 'Dev Admin', email: 'admin@objectos.ai' }) : new Response('{}'),
    );
    renderBanner();

    const banner = await screen.findByTestId('impersonation-banner');
    // The impersonated user — whose name every write is recorded under.
    expect(banner.textContent).toMatch(/RT8 Dave/);
    // The administrator who started it, by name: the session carries only the id.
    const startedBy = await screen.findByTestId('impersonation-started-by');
    expect(startedBy.textContent).toBe('Started by administrator Dev Admin.');
    expect(banner.textContent).not.toMatch(/usr_admin/);
    // The read went out as the session the console holds: the impersonated user's.
    const read = seen.urls.findIndex((u) => u.endsWith(ADMIN_READ_PATH));
    expect(read).toBeGreaterThanOrEqual(0);
    expect(seen.bearers[read]).toBe(`Bearer ${IMPERSONATED_TOKEN}`);
    // And an exit.
    expect(screen.getByTestId('impersonation-stop')).toBeTruthy();
  });

  it('names the administrator by email when their row carries no name', async () => {
    TokenStorage.set(IMPERSONATED_TOKEN);
    stubStopEndpoint((url) =>
      url.endsWith(ADMIN_READ_PATH) ? adminRow({ name: '', email: 'admin@objectos.ai' }) : new Response('{}'),
    );
    renderBanner();

    const startedBy = await screen.findByTestId('impersonation-started-by');
    expect(startedBy.textContent).toBe('Started by administrator admin@objectos.ai.');
  });

  it.each([
    // What a user outside the administrator's organization gets: the row scope
    // hides the row, and the route answers it as missing.
    ['outside the reader\'s row scope', () => jsonResponse({ error: 'Record usr_admin not found in sys_user', code: 'RECORD_NOT_FOUND', object: 'sys_user' }, 404)],
    ['refused', () => jsonResponse({ error: 'Permission denied', code: 'PERMISSION_DENIED' }, 403)],
    ['answered off the GetDataResponse shape', () => jsonResponse({ success: true, data: { name: 'Dev Admin' } })],
    ['answered without a name or email', () => adminRow({})],
    ['a network failure', () => {
      throw new TypeError('Failed to fetch');
    }],
  ])('says "an administrator", never the id, when the read is %s', async (_case, answer) => {
    TokenStorage.set(IMPERSONATED_TOKEN);
    stubStopEndpoint((url) => (url.endsWith(ADMIN_READ_PATH) ? answer() : new Response('{}')));
    renderBanner();

    const startedBy = await screen.findByTestId('impersonation-started-by');
    expect(startedBy.textContent).toBe('Started by an administrator.');
    expect(screen.getByTestId('impersonation-banner').textContent).not.toMatch(/usr_admin/);
  });

  it('shows no administrator at all while the read is still out', async () => {
    TokenStorage.set(IMPERSONATED_TOKEN);
    stubStopEndpoint((url) => {
      if (url.endsWith(ADMIN_READ_PATH)) return new Promise<Response>(() => {});
      return new Response('{}');
    });
    renderBanner();

    const banner = await screen.findByTestId('impersonation-banner');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('impersonation-started-by')).toBeNull();
    expect(banner.textContent).not.toMatch(/usr_admin/);
  });

  it('stop: calls the endpoint, adopts the restored token, refreshes identity, banner goes', async () => {
    TokenStorage.set(IMPERSONATED_TOKEN);
    const seen = stubStopEndpoint((url) =>
      // The server hands the ADMINISTRATOR's session back the same way it
      // handed the impersonated one out: a rotation on the stop's response
      // header, and on no other route.
      url.endsWith(STOP_PATH)
        ? new Response('{}', { status: 200, headers: { 'set-auth-token': ADMIN_TOKEN } })
        : new Response('{}'),
    );
    renderBanner();

    await screen.findByTestId('impersonation-banner');
    await userEvent.click(screen.getByTestId('impersonation-stop'));

    await waitFor(() => expect(screen.queryByTestId('impersonation-banner')).toBeNull());
    expect(seen.urls.some((u) => u.endsWith(STOP_PATH))).toBe(true);
    // The request went out AS the impersonated user (that is the session we
    // hold); the administrator is restored from the `admin_session` cookie.
    expect(seen.bearers[seen.urls.findIndex((u) => u.endsWith(STOP_PATH))]).toBe(`Bearer ${IMPERSONATED_TOKEN}`);
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
    stubStopEndpoint((url) =>
      url.endsWith(STOP_PATH)
        ? new Response('{}', { status: 200, headers: { 'set-auth-token': ADMIN_TOKEN } })
        : new Response('{}'),
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

  it('a read that lands AFTER the test body still reaches the double, never the network', async () => {
    TokenStorage.set(IMPERSONATED_TOKEN);
    const seen = stubStopEndpoint((url) =>
      url.endsWith(ADMIN_READ_PATH) ? adminRow({ name: 'Dev Admin' }) : new Response('{}'),
    );
    renderBanner();
    await screen.findByTestId('impersonation-started-by');
    const reads = () => seen.urls.filter((u) => u.endsWith(ADMIN_READ_PATH)).length;
    const readsInBody = reads();
    render(<LateAdministratorRead />);

    // Runs after every afterEach, the network-escape guard's included. With
    // the teardown unstubbing before cleanup(), the late read went to the real
    // socket instead: this count stays put and the guard reds the test.
    onTestFinished(() => {
      expect(reads()).toBe(readsInBody + 1);
    });
  });
});
