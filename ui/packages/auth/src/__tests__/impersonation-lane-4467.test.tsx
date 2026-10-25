/**
 * objectui#4467 — the two credential lanes and the rotation they must both honor.
 *
 * ## What this file pins, and why it is the PRIMARY pin
 *
 * The console injects the same localStorage bearer from two places:
 *
 *   auth lane — `createBearerFetch` inside `createAuthClient`, used by
 *               sign-in / get-session / the auth endpoints;
 *   data lane — `createAuthenticatedFetch`, used by the adapter, by
 *               the renderers' `apiFetch`, and by EVERY metadata
 *               `type: 'api'` action (`useConsoleActionRuntime`'s `apiHandler`).
 *
 * Only the auth lane read the `set-auth-token` response header better-auth's
 * bearer plugin uses to hand back a ROTATED session token. The data lane
 * dropped it on the floor — so any endpoint that rotates the session while
 * being called through the data lane left the browser still holding, and still
 * sending, the OLD token.
 *
 * Impersonation is that endpoint. `POST /auth/admin/impersonate-user` runs as a
 * metadata action → data lane → the impersonated session token arrives in
 * `set-auth-token` and is discarded, while the server-side bearer plugin keeps
 * overwriting the impersonation COOKIE with the admin bearer we keep sending.
 * Every subsequent request resolves to the admin: impersonation was not merely
 * invisible in the console, it was a complete NO-OP (issue #4467, ruling update
 * comment 5273408139).
 *
 * So the pin is lane-level, not impersonation-level: a data-lane response that
 * declares a rotation must rotate `TokenStorage`, exactly as the auth lane
 * already does. There is no impersonation-specific logic in either lane — the
 * server declares a rotation, the client honors it, whatever endpoint rotated.
 *
 * A test that mocked a session carrying `impersonatedBy` and asserted on a
 * banner would have been a phantom pin: production could not reach that state
 * at all, because the token that produces it was being thrown away here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createAuthenticatedFetch } from '../createAuthenticatedFetch';
import { TokenStorage, createAuthClient } from '../createAuthClient';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import type { AuthClient } from '../types';

const API_URL = 'http://localhost/api/v1/auth/admin/impersonate-user';

/**
 * Stub the global fetch with a response carrying the given headers — the shape
 * better-auth's bearer plugin answers with when it issues a session token.
 */
function stubFetch(headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push(url);
    return new Response('{}', { status: 200, headers });
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

describe('set-auth-token rotation — lane symmetry (#4467)', () => {
  beforeEach(() => {
    TokenStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TokenStorage.clear();
  });

  it('DATA lane adopts a rotated set-auth-token (the #4467 defect)', async () => {
    TokenStorage.set('admin-token');
    stubFetch({ 'set-auth-token': 'impersonated-token' });

    await createAuthenticatedFetch()(API_URL, { method: 'POST' });

    expect(TokenStorage.get()).toBe('impersonated-token');
  });

  it('AUTH lane adopts a rotated set-auth-token (unchanged — the half that always worked)', async () => {
    TokenStorage.set('admin-token');
    const fetchFn = vi.fn(async () =>
      new Response('[]', { status: 200, headers: { 'set-auth-token': 'impersonated-token' } }),
    ) as unknown as typeof fetch;

    // `hasLocalPassword()` is the thinnest real call through `createBearerFetch`
    // (a bare GET /list-accounts) — it exercises the auth lane's capture without
    // going through better-auth's own client machinery.
    const client = createAuthClient({ baseURL: 'http://localhost/api/v1/auth', fetchFn });
    await client.hasLocalPassword();

    expect(TokenStorage.get()).toBe('impersonated-token');
  });

  it('leaves the stored token alone on a data-lane response WITHOUT the header', async () => {
    TokenStorage.set('admin-token');
    stubFetch();

    await createAuthenticatedFetch()('http://localhost/api/v1/meta/object/account');

    expect(TokenStorage.get()).toBe('admin-token');
  });

  it('adopts the rotation on a cross-origin-suppressed lane only when the request was made', async () => {
    // `sameOriginOnly` short-circuits to the bare global fetch BEFORE any header
    // work, so a third-party host can neither see our bearer nor rotate it.
    TokenStorage.set('admin-token');
    stubFetch({ 'set-auth-token': 'attacker-token' });

    await createAuthenticatedFetch({ sameOriginOnly: true })('https://third-party.example/api/v1/x');

    expect(TokenStorage.get()).toBe('admin-token');
  });
});

describe('TokenStorage rotation notifications (#4467)', () => {
  beforeEach(() => {
    TokenStorage.clear();
  });

  afterEach(() => {
    TokenStorage.clear();
  });

  it('does NOT notify on the FIRST store — sign-in owns its own identity update', () => {
    const seen = vi.fn();
    const unsubscribe = TokenStorage.subscribeRotation(seen);
    try {
      TokenStorage.set('fresh-sign-in-token');
      expect(seen).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('notifies when a token already in hand is REPLACED by a different one', () => {
    TokenStorage.set('admin-token');
    const seen = vi.fn();
    const unsubscribe = TokenStorage.subscribeRotation(seen);
    try {
      TokenStorage.set('impersonated-token');
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('does not notify when the same token is re-stored (get-session keeping storage in sync)', () => {
    TokenStorage.set('admin-token');
    const seen = vi.fn();
    const unsubscribe = TokenStorage.subscribeRotation(seen);
    try {
      TokenStorage.set('admin-token');
      expect(seen).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('does not notify on clear() — sign-out owns its own identity update', () => {
    TokenStorage.set('admin-token');
    const seen = vi.fn();
    const unsubscribe = TokenStorage.subscribeRotation(seen);
    try {
      TokenStorage.clear();
      expect(seen).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('stops notifying after unsubscribe', () => {
    TokenStorage.set('admin-token');
    const seen = vi.fn();
    TokenStorage.subscribeRotation(seen)();
    TokenStorage.set('impersonated-token');
    expect(seen).not.toHaveBeenCalled();
  });
});

/**
 * The half the card actually reported: STARTING impersonation.
 *
 * Nothing on that path can call a refresh. `POST /auth/admin/impersonate-user`
 * is an ordinary metadata `type: 'api'` action — the console's action runtime
 * executes it exactly like "approve this record", and cannot know that this one
 * endpoint changed who the user is without hard-coding the endpoint into a
 * generic runtime. The ROTATION is the signal, and it is the server's own
 * declaration rather than our guess about a URL.
 */
describe('identity follows an ownerless rotation (#4467)', () => {
  const ADMIN_TOKEN = 'admin-token';
  const IMPERSONATED_TOKEN = 'impersonated-token';

  /** Resolves identity from the stored token, the way the server does. */
  function tokenBoundClient(): AuthClient {
    return {
      getSession: vi.fn(async () => {
        const token = TokenStorage.get();
        if (token === IMPERSONATED_TOKEN) {
          return {
            user: { id: 'usr_dave', name: 'RT8 Dave', email: 'rt8-dave@example.com' },
            session: { token: IMPERSONATED_TOKEN, impersonatedBy: 'usr_admin' },
          };
        }
        if (token === ADMIN_TOKEN) {
          return {
            user: { id: 'usr_admin', name: 'Dev Admin', email: 'admin@objectos.ai' },
            session: { token: ADMIN_TOKEN },
          };
        }
        return null;
      }),
      listOrganizations: vi.fn(async () => []),
      getActiveOrganization: vi.fn(async () => null),
      getActiveMember: vi.fn(async () => null),
    } as unknown as AuthClient;
  }

  function Identity() {
    const { user, session } = useAuth();
    return (
      <div>
        <span data-testid="who">{user?.name ?? 'none'}</span>
        <span data-testid="impersonated-by">{session?.impersonatedBy ?? 'none'}</span>
      </div>
    );
  }

  beforeEach(() => {
    TokenStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TokenStorage.clear();
  });

  it('a DATA-lane rotation re-resolves the console identity (impersonation takes effect)', async () => {
    TokenStorage.set(ADMIN_TOKEN);
    render(
      <AuthProvider authUrl="/api/v1/auth" client={tokenBoundClient()}>
        <Identity />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('Dev Admin'));
    expect(screen.getByTestId('impersonated-by').textContent).toBe('none');

    // What the console really does: a generic api action POSTs the impersonate
    // endpoint through the data lane. Nobody on this path knows it is auth.
    stubFetch({ 'set-auth-token': IMPERSONATED_TOKEN });
    await createAuthenticatedFetch()(API_URL, { method: 'POST' });

    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('RT8 Dave'));
    expect(screen.getByTestId('impersonated-by').textContent).toBe('usr_admin');
  });

  it('leaves identity alone when the same token is re-stored', async () => {
    TokenStorage.set(ADMIN_TOKEN);
    const client = tokenBoundClient();
    render(
      <AuthProvider authUrl="/api/v1/auth" client={client}>
        <Identity />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('Dev Admin'));
    const callsAfterBoot = (client.getSession as ReturnType<typeof vi.fn>).mock.calls.length;

    // A response that hands back the token we already hold — what an ordinary
    // authenticated request looks like. No rotation, so no re-resolution.
    stubFetch({ 'set-auth-token': ADMIN_TOKEN });
    await createAuthenticatedFetch()('http://localhost/api/v1/meta/object/account');
    await new Promise((r) => setTimeout(r, 0));

    expect((client.getSession as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterBoot);
    expect(screen.getByTestId('who').textContent).toBe('Dev Admin');
  });
});
