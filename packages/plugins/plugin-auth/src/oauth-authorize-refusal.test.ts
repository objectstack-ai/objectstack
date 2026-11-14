// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The answer a refused `/oauth2/authorize` gives, by who is asking
 * (`oauth-authorize-refusal.ts`), read off a REAL `AuthManager`: real
 * better-auth carrying the real `@better-auth/oauth-provider`, the real global
 * before-hook and its ADR-0069 D5.1 environment-access gate, over the
 * in-memory engine the package's other suites share. Clients are registered
 * through the provider's own `/oauth2/register`, so every `redirect_uri` the
 * assertions follow or refuse is one the provider itself stored.
 *
 * Each refusal leg also asserts the gate RAN with the caller as its subject,
 * so "refused" can never be read off a request that was never judged, and no
 * leg can be green because the provider minted nothing for some other reason:
 * the allowing control mints a code on the very same request.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import {
  ENV_ACCESS_DENIED_CODE,
  ENV_ACCESS_DENIED_MESSAGE,
  OAUTH_ACCESS_DENIED_ERROR,
  OAUTH_END_SESSION_PATH,
} from './oauth-authorize-refusal';

const SECRET = 'test-secret-at-least-32-chars-long-authorize-refusal';
const PASSWORD = 'S3cure!Passw0rd-authorize-refusal';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const ISSUER = `${ORIGIN}${BASE}`;
const EMAIL = 'jack@authorize-refusal.example.com';

/** An environment's sign-in callback, as the platform registers it. */
const ENV_CALLBACK = 'https://env.example.com/api/v1/auth/callback/objectstack-cloud';
const LOOPBACK_CALLBACK = 'http://127.0.0.1:56789/callback';
// RFC 7636 Appendix B challenge.
const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
/** A `state` with every character a query string has to carry escaped. */
const STATE = 'st&x=1 /?#é';

/** What a browser's address bar or a `location.assign` sends. */
const NAVIGATION = {
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'cross-site',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
} as const;
/** What the Console's post-sign-in `followOauthAuthorize` sends. */
const CONSOLE_FETCH = { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', accept: 'application/json' } as const;

const ENV_KEYS = ['OS_MCP_SERVER_ENABLED', 'OS_OIDC_PROVIDER_ENABLED', 'OS_OIDC_DCR_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

interface GateCall {
  readonly userId: string;
  readonly clientId: string;
}

const arrange = async () => {
  const engine = createMemoryEngine();
  const gate = { allow: false, calls: [] as GateCall[] };
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    oidcAuthorizeGate: (params: GateCall) => {
      gate.calls.push({ userId: params.userId, clientId: params.clientId });
      return gate.allow;
    },
  } as any);

  const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    manager.handleRequest(
      new Request(`${ISSUER}${path}`, {
        method: init.method ?? 'POST',
        headers: {
          origin: ORIGIN,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...init.headers,
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  const invitationId = await inviteForAudienceGate(manager, EMAIL);
  const signUp = await call('/sign-up/email', { body: { email: EMAIL, password: PASSWORD, name: 'Jack', invitationId } });
  expect(signUp.status, `sign-up: ${await signUp.clone().text()}`).toBe(200);
  const signIn = await call('/sign-in/email', { body: { email: EMAIL, password: PASSWORD } });
  expect(signIn.status, `sign-in: ${await signIn.clone().text()}`).toBe(200);
  const cookie = cookieFrom(signIn);
  const userId = String(((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === EMAIL)?.id);

  /** A client registered through the provider's own `/oauth2/register`. */
  const register = async (redirectUri: string, applicationType: 'web' | 'native'): Promise<string> => {
    const res = await call('/oauth2/register', {
      body: {
        client_name: 'Environment',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: applicationType,
      },
    });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(201);
    return String(body.client_id);
  };

  const clientRow = (clientId: string) =>
    ((engine.tables.get('sys_oauth_application') ?? []) as any[]).find((r) => r.client_id === clientId);

  const authorize = (
    params: Record<string, string>,
    headers: Record<string, string>,
    session: 'signed-in' | 'anonymous' = 'signed-in',
  ) => {
    const url = new URL(`${ISSUER}/oauth2/authorize`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return manager.handleRequest(
      new Request(url.toString(), {
        method: 'GET',
        headers: { ...headers, ...(session === 'signed-in' ? { cookie } : {}) },
      }),
    );
  };

  return { manager, gate, userId, register, clientRow, authorize, call, cookie };
};

const codeRequest = (clientId: string, redirectUri: string): Record<string, string> => ({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  scope: 'openid profile email',
  state: STATE,
  code_challenge: PKCE_CHALLENGE,
  code_challenge_method: 'S256',
});

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OS_MCP_SERVER_ENABLED = 'true';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

/** The refusal page's two actions and its sentence, read off the HTML. */
async function readPage(res: Response) {
  const html = await res.text();
  const href = (action: string) => html.match(new RegExp(`data-action="${action}" href="([^"]*)"`))?.[1];
  return { html, switchAccount: href('switch-account'), backToConsole: href('back-to-console') };
}

describe('a refused /oauth2/authorize — a browser navigation with a registered redirect_uri goes back to the client', () => {
  it('302 to the registered redirect_uri with error=access_denied, error_description, the original state and iss; no code', async () => {
    const rig = await arrange();
    const clientId = await rig.register(ENV_CALLBACK, 'web');

    const res = await rig.authorize(codeRequest(clientId, ENV_CALLBACK), NAVIGATION);

    expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId }]);
    expect(res.status, await res.clone().text()).toBe(302);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const location = new URL(res.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(ENV_CALLBACK);
    expect(location.searchParams.get('error')).toBe(OAUTH_ACCESS_DENIED_ERROR);
    expect(location.searchParams.get('error_description')).toBe(ENV_ACCESS_DENIED_MESSAGE);
    expect(location.searchParams.get('state')).toBe(STATE);
    expect(location.searchParams.get('iss')).toBe(ISSUER);
    expect(location.searchParams.has('code')).toBe(false);
  });

  it('control: the same request with an allowing gate is handed a code at the same redirect_uri', async () => {
    const rig = await arrange();
    const clientId = await rig.register(ENV_CALLBACK, 'web');
    // A dynamically registered client asks for consent; skipping it, as the
    // platform's own environment clients do, makes the allow pass mint a code.
    rig.clientRow(clientId).skip_consent = true;
    rig.gate.allow = true;

    const res = await rig.authorize(codeRequest(clientId, ENV_CALLBACK), NAVIGATION);

    expect(rig.gate.calls).toHaveLength(1);
    expect(res.status, await res.clone().text()).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(ENV_CALLBACK);
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.has('error')).toBe(false);
  });
});

describe('a refused /oauth2/authorize — a browser navigation with no registered redirect_uri gets a readable page', () => {
  const cases: ReadonlyArray<{ name: string; redirect: (rig: Awaited<ReturnType<typeof arrange>>) => Promise<{ clientId: string; params: Record<string, string> }> }> = [
    {
      name: 'a redirect_uri the client never registered is never followed',
      redirect: async (rig) => {
        const clientId = await rig.register(ENV_CALLBACK, 'web');
        return { clientId, params: codeRequest(clientId, 'https://attacker.example/cb') };
      },
    },
    {
      name: 'a loopback redirect_uri on another port (accepted by the provider) is not followed either: exact registrations only',
      redirect: async (rig) => {
        const clientId = await rig.register(LOOPBACK_CALLBACK, 'native');
        return { clientId, params: codeRequest(clientId, 'http://127.0.0.1:40000/callback') };
      },
    },
    {
      name: 'a disabled client is never followed',
      redirect: async (rig) => {
        const clientId = await rig.register(ENV_CALLBACK, 'web');
        rig.clientRow(clientId).disabled = true;
        return { clientId, params: codeRequest(clientId, ENV_CALLBACK) };
      },
    },
    {
      name: 'a request with no redirect_uri',
      redirect: async (rig) => {
        const clientId = await rig.register(ENV_CALLBACK, 'web');
        const { redirect_uri: _omit, ...params } = codeRequest(clientId, ENV_CALLBACK);
        return { clientId, params };
      },
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const rig = await arrange();
      const { clientId, params } = await c.redirect(rig);

      const res = await rig.authorize(params, NAVIGATION);

      expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId }]);
      expect(res.status).toBe(403);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      const page = await readPage(res);
      expect(page.html).toContain(`data-refusal-code="${ENV_ACCESS_DENIED_CODE}"`);
      expect(page.html).toContain(`You are signed in as <strong>${EMAIL}</strong>`);
      expect(page.html).not.toContain('attacker.example');
      expect(page.switchAccount).toBe(`${ISSUER}${OAUTH_END_SESSION_PATH}`);
      expect(page.backToConsole).toBe(`${ORIGIN}/_console/`);
    });
  }

  it('"switch account" opens the provider\'s own sign-out confirmation for the signed-in account', async () => {
    const rig = await arrange();
    const clientId = await rig.register(ENV_CALLBACK, 'web');
    const page = await readPage(await rig.authorize(codeRequest(clientId, 'https://attacker.example/cb'), NAVIGATION));

    const res = await rig.manager.handleRequest(
      new Request(page.switchAccount!, { headers: { ...NAVIGATION, cookie: rig.cookie } }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Confirm logout');
  });
});

describe('a refused /oauth2/authorize — every other caller keeps the 403 envelope', () => {
  const callers: ReadonlyArray<[string, Record<string, string>]> = [
    ["the Console's post-sign-in fetch (Accept: application/json)", CONSOLE_FETCH],
    ['an API client asking for JSON with no Fetch Metadata', { accept: 'application/json' }],
    ['a bare client that accepts anything', { accept: '*/*' }],
  ];

  for (const [name, headers] of callers) {
    it(name, async () => {
      const rig = await arrange();
      const clientId = await rig.register(ENV_CALLBACK, 'web');

      const res = await rig.authorize(codeRequest(clientId, ENV_CALLBACK), headers);

      expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId }]);
      expect(res.status).toBe(403);
      expect(res.headers.get('location')).toBeNull();
      const body: any = await res.json();
      expect(body.code ?? body.error?.code).toBe(ENV_ACCESS_DENIED_CODE);
      expect(body.message ?? body.error?.message).toBe(ENV_ACCESS_DENIED_MESSAGE);
    });
  }
});

describe('a /oauth2/authorize with no signed-in subject is not judged', () => {
  it('an anonymous browser navigation falls through to the provider\'s sign-in redirect, and the gate never runs', async () => {
    const rig = await arrange();
    const clientId = await rig.register(ENV_CALLBACK, 'web');

    const res = await rig.authorize(codeRequest(clientId, ENV_CALLBACK), NAVIGATION, 'anonymous');

    expect(rig.gate.calls).toHaveLength(0);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith(`${ORIGIN}/_console/login?`), location).toBe(true);
    expect(new URL(location).searchParams.has('error')).toBe(false);
  });
});
