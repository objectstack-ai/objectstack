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

import { createHash } from 'node:crypto';
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
  OAUTH_REFUSAL_REASON_PARAM,
  REFUSAL_MESSAGE_MAX_LENGTH,
} from './oauth-authorize-refusal';
import { answerOAuthClientName, OAUTH_CLIENT_NAME_NOT_FOUND, OAUTH_CLIENT_NAME_RATE_LIMIT } from './oauth-client-name';
import { InProcessCounterStore, type CounterStore } from './rate-limit-storage';
import { PLATFORM_IDP_PROVIDER_ID } from './implicit-account-linking';

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
  // `allow` admits every client; `admitted` admits the clients it names;
  // `answer`, when set, is what the gate answers for every client instead.
  const gate = { allow: false, admitted: new Set<string>(), calls: [] as GateCall[], answer: undefined as unknown };
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    oidcAuthorizeGate: (params: GateCall) => {
      gate.calls.push({ userId: params.userId, clientId: params.clientId });
      if (gate.answer !== undefined) return gate.answer;
      return gate.allow || gate.admitted.has(params.clientId);
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

  /** A form-encoded `POST /oauth2/authorize`; `body` may repeat a key by giving it an array. */
  const authorizeForm = (
    query: Record<string, string>,
    body: Record<string, string | readonly string[]>,
    headers: Record<string, string>,
  ) => {
    const url = new URL(`${ISSUER}/oauth2/authorize`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) for (const one of typeof v === 'string' ? [v] : v) form.append(k, one);
    return manager.handleRequest(
      new Request(url.toString(), {
        method: 'POST',
        headers: { origin: ORIGIN, ...headers, cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }),
    );
  };

  return { manager, engine, gate, userId, register, clientRow, authorize, authorizeForm, call, cookie };
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

/** The URL an authorize answer sends the caller to: a `302`'s `Location`, or a fetch caller's `{ redirect, url }`. */
async function nextUrl(res: Response): Promise<string> {
  const location = res.headers.get('location');
  if (location) return location;
  const body: any = await res.clone().json().catch(() => null);
  return typeof body?.url === 'string' ? body.url : '';
}

/** The authorization code an answer hands the client, or `null`. */
async function codeIn(res: Response): Promise<string | null> {
  const url = await nextUrl(res);
  return url.startsWith(ENV_CALLBACK) ? new URL(url).searchParams.get('code') : null;
}

/** The refusal's `403` envelope: code and status (ADR-0112), and no code handed out. */
async function expectRefusalEnvelope(res: Response): Promise<void> {
  const text = await res.clone().text();
  expect(res.status, text).toBe(403);
  const body: any = JSON.parse(text);
  expect(body.code ?? body.error?.code).toBe(ENV_ACCESS_DENIED_CODE);
  expect(res.headers.get('location')).toBeNull();
  expect(text).not.toContain('code=');
}

describe('the environment-access gate judges every client an /oauth2/authorize request names, from the query and the body', () => {
  /** A signed-in subject, a refused client that would skip consent, and (when asked) an admitted one. */
  const arrangeClients = async () => {
    const rig = await arrange();
    const refused = await rig.register(ENV_CALLBACK, 'web');
    const admitted = await rig.register(ENV_CALLBACK, 'web');
    rig.clientRow(refused).skip_consent = true;
    rig.clientRow(admitted).skip_consent = true;
    rig.gate.admitted.add(admitted);
    return { rig, refused, admitted };
  };

  it('a GET naming a refused client is refused', async () => {
    const { rig, refused } = await arrangeClients();

    const res = await rig.authorize(codeRequest(refused, ENV_CALLBACK), CONSOLE_FETCH);

    expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId: refused }]);
    await expectRefusalEnvelope(res);
  });

  it('a form-encoded POST naming a refused client in the body is refused', async () => {
    const { rig, refused } = await arrangeClients();

    const res = await rig.authorizeForm({}, codeRequest(refused, ENV_CALLBACK), CONSOLE_FETCH);

    expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId: refused }]);
    await expectRefusalEnvelope(res);
  });

  it('a form-encoded POST from a browser navigation is refused with the readable page, as a refused POST is answered today', async () => {
    const { rig, refused } = await arrangeClients();

    const res = await rig.authorizeForm({}, codeRequest(refused, ENV_CALLBACK), NAVIGATION);

    expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId: refused }]);
    expect(res.status).toBe(403);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const page = await readPage(res);
    expect(page.html).toContain(`data-refusal-code="${ENV_ACCESS_DENIED_CODE}"`);
    expect(page.html).not.toContain(ENV_CALLBACK);
  });

  it('a JSON POST is answered with the provider\'s own 415, and no code is handed out', async () => {
    const { rig, refused } = await arrangeClients();

    const res = await rig.manager.handleRequest(
      new Request(`${ISSUER}/oauth2/authorize`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: rig.cookie, ...CONSOLE_FETCH, 'content-type': 'application/json' },
        body: JSON.stringify(codeRequest(refused, ENV_CALLBACK)),
      }),
    );

    expect(res.status, await res.clone().text()).toBe(415);
    expect(await codeIn(res)).toBeNull();
  });

  const pairs: ReadonlyArray<[string, 'query' | 'body']> = [
    ['an admitted client in the query and a refused client in the body', 'body'],
    ['a refused client in the query and an admitted client in the body', 'query'],
  ];
  for (const [name, refusedIn] of pairs) {
    it(`a form-encoded POST naming ${name} is refused`, async () => {
      const { rig, refused, admitted } = await arrangeClients();
      const inQuery = refusedIn === 'query' ? refused : admitted;
      const inBody = refusedIn === 'body' ? refused : admitted;

      const res = await rig.authorizeForm({ client_id: inQuery }, codeRequest(inBody, ENV_CALLBACK), CONSOLE_FETCH);

      expect(rig.gate.calls).toContainEqual({ userId: rig.userId, clientId: refused });
      await expectRefusalEnvelope(res);
    });
  }

  for (const order of ['admitted first', 'refused first'] as const) {
    it(`a query naming client_id twice, one of them refused, is refused, each client judged by itself (${order})`, async () => {
      const { rig, refused, admitted } = await arrangeClients();
      const url = new URL(`${ISSUER}/oauth2/authorize`);
      const { client_id: _omit, ...params } = codeRequest(refused, ENV_CALLBACK);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      for (const one of order === 'admitted first' ? [admitted, refused] : [refused, admitted]) url.searchParams.append('client_id', one);

      const res = await rig.manager.handleRequest(
        new Request(url.toString(), { headers: { ...CONSOLE_FETCH, cookie: rig.cookie } }),
      );

      expect(rig.gate.calls).toContainEqual({ userId: rig.userId, clientId: refused });
      await expectRefusalEnvelope(res);
    });

    it(`a form body naming client_id twice is handed no code unless the gate judged and admitted the client (${order})`, async () => {
      const { rig, refused, admitted } = await arrangeClients();

      const res = await rig.authorizeForm(
        {},
        { ...codeRequest(refused, ENV_CALLBACK), client_id: order === 'admitted first' ? [admitted, refused] : [refused, admitted] },
        CONSOLE_FETCH,
      );

      expect(rig.gate.calls.length, 'the gate judged no client').toBeGreaterThan(0);
      if (await codeIn(res)) {
        expect(rig.gate.calls.every((c) => c.clientId === admitted), JSON.stringify(rig.gate.calls)).toBe(true);
      } else {
        await expectRefusalEnvelope(res);
      }
    });
  }

  it('a resume pass whose body names a client_id that is not a string is judged on that value, and refused when it is refused', async () => {
    const { rig, admitted } = await arrangeClients();
    const first = await rig.authorize(codeRequest(admitted, ENV_CALLBACK), NAVIGATION, 'anonymous');
    const location = first.headers.get('location') ?? '';
    rig.gate.calls.length = 0;

    const res = await rig.call('/sign-in/email', {
      body: { email: EMAIL, password: PASSWORD, oauth_query: location.slice(location.indexOf('?')), client_id: 12345 },
      headers: CONSOLE_FETCH,
    });

    expect(rig.gate.calls).toContainEqual({ userId: rig.userId, clientId: '12345' });
    await expectRefusalEnvelope(res);
  });

  it('a client named in both the query and the body is judged once', async () => {
    const { rig, refused } = await arrangeClients();

    const res = await rig.authorizeForm({ client_id: refused }, codeRequest(refused, ENV_CALLBACK), CONSOLE_FETCH);

    expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId: refused }]);
    await expectRefusalEnvelope(res);
  });

  it('control: an admitted subject\'s form-encoded POST is handed a code, every named client judged', async () => {
    const { rig, admitted } = await arrangeClients();

    const res = await rig.authorizeForm({ client_id: admitted }, codeRequest(admitted, ENV_CALLBACK), CONSOLE_FETCH);

    expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId: admitted }]);
    expect(await codeIn(res), await res.clone().text()).toBeTruthy();
  });

  it('control: a request that names no client anywhere is not judged', async () => {
    const { rig } = await arrangeClients();
    const { client_id: _omit, ...params } = codeRequest('unused', ENV_CALLBACK);

    const getRes = await rig.authorize(params, CONSOLE_FETCH);
    const postRes = await rig.authorizeForm({}, params, CONSOLE_FETCH);

    expect(rig.gate.calls).toHaveLength(0);
    expect(getRes.status).not.toBe(403);
    expect(postRes.status).not.toBe(403);
    expect(await codeIn(getRes)).toBeNull();
    expect(await codeIn(postRes)).toBeNull();
  });
});

describe('the environment-access gate judges every pass that resumes an authorization', () => {
  /** The signed authorization request a provider redirect carries, as the Console posts it back. */
  const oauthQueryOf = (location: string): string => {
    expect(location.includes('?'), `expected a redirect carrying the signed request, got ${location}`).toBe(true);
    return location.slice(location.indexOf('?'));
  };

  /**
   * One resume pass: `prepare` runs with the gate admitting the client and
   * hands back the signed request; `resume` then runs with the gate as the
   * leg sets it.
   */
  interface ResumePass {
    readonly name: string;
    readonly skipConsent: boolean;
    readonly session: 'signed-in' | 'anonymous';
    resume(rig: Awaited<ReturnType<typeof arrange>>, oauthQuery: string): Promise<Response>;
  }

  const passes: readonly ResumePass[] = [
    {
      name: 'the sign-in that resumes an authorization',
      skipConsent: true,
      session: 'anonymous',
      resume: (rig, oauthQuery) =>
        rig.call('/sign-in/email', { body: { email: EMAIL, password: PASSWORD, oauth_query: oauthQuery }, headers: CONSOLE_FETCH }),
    },
    {
      name: 'POST /oauth2/consent',
      skipConsent: false,
      session: 'signed-in',
      resume: (rig, oauthQuery) =>
        rig.call('/oauth2/consent', { body: { accept: true, oauth_query: oauthQuery }, headers: { ...CONSOLE_FETCH, cookie: rig.cookie } }),
    },
    {
      name: 'POST /oauth2/continue',
      skipConsent: true,
      session: 'anonymous',
      resume: (rig, oauthQuery) =>
        rig.call('/oauth2/continue', { body: { postLogin: true, oauth_query: oauthQuery }, headers: { ...CONSOLE_FETCH, cookie: rig.cookie } }),
    },
  ];

  const prepare = async (pass: ResumePass) => {
    const rig = await arrange();
    const clientId = await rig.register(ENV_CALLBACK, 'web');
    rig.clientRow(clientId).skip_consent = pass.skipConsent;
    rig.gate.allow = true;
    const first = await rig.authorize(codeRequest(clientId, ENV_CALLBACK), NAVIGATION, pass.session);
    const oauthQuery = oauthQueryOf(first.headers.get('location') ?? '');
    rig.gate.calls.length = 0;
    return { rig, clientId, oauthQuery };
  };

  for (const pass of passes) {
    it(`${pass.name}: a denying gate refuses it`, async () => {
      const { rig, clientId, oauthQuery } = await prepare(pass);
      rig.gate.allow = false;

      const res = await pass.resume(rig, oauthQuery);

      expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId }]);
      await expectRefusalEnvelope(res);
    });

    it(`${pass.name}: control — an admitting gate is judged on it and the pass hands out a code`, async () => {
      const { rig, clientId, oauthQuery } = await prepare(pass);

      const res = await pass.resume(rig, oauthQuery);

      expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId }]);
      expect(await codeIn(res), await res.clone().text()).toBeTruthy();
    });
  }
});

describe("a refused /oauth2/authorize carries the host's reason when the gate answers a refusal object", () => {
  /** The cloud control plane's answer for a signed-in account that is not a member of the organization. */
  const NOT_MEMBER = {
    allowed: false,
    reason: 'not_member',
    message: 'You are not a member of Acme Corp. Ask an administrator of Acme Corp to invite you.',
  } as const;

  type Rig = Awaited<ReturnType<typeof arrange>>;
  type Door = 'envelope' | 'redirect' | 'page';

  /** The same refused request, delivered through one door. */
  const refuse = async (rig: Rig, door: Door): Promise<Response> => {
    const clientId = await rig.register(ENV_CALLBACK, 'web');
    const res = door === 'envelope'
      ? await rig.authorize(codeRequest(clientId, ENV_CALLBACK), CONSOLE_FETCH)
      : door === 'redirect'
        ? await rig.authorize(codeRequest(clientId, ENV_CALLBACK), NAVIGATION)
        : await rig.authorize(codeRequest(clientId, 'https://attacker.example/cb'), NAVIGATION);
    expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId }]);
    return res;
  };

  /** Every byte a door answers with: status, the headers a refusal sets, and the body (or the redirect target). */
  const bytesOf = async (res: Response) => ({
    status: res.status,
    contentType: res.headers.get('content-type'),
    location: res.headers.get('location'),
    body: await res.text(),
  });

  describe('CONTROL: a boolean gate answers byte for byte as before', () => {
    // The literals below were read off this suite at the merge base, before
    // the gate could answer anything but a boolean; they hold there and here.
    const PAGE_SHA256_AT_MERGE_BASE = '60b2309f3a19756c308cd06e4277a3c1c22595c738ed42f15f26c93c1a410c70';
    const PAGE_SENTENCE = `<p data-refusal-code="${ENV_ACCESS_DENIED_CODE}">You are signed in as <strong>${EMAIL}</strong>, and this account does not have access to this environment.</p>`;

    it('the envelope', async () => {
      const rig = await arrange();
      const res = await bytesOf(await refuse(rig, 'envelope'));
      expect(res.status).toBe(403);
      expect(res.location).toBeNull();
      expect(JSON.parse(res.body)).toEqual({ code: ENV_ACCESS_DENIED_CODE, message: ENV_ACCESS_DENIED_MESSAGE });
    });

    it('the redirect', async () => {
      const rig = await arrange();
      const res = await bytesOf(await refuse(rig, 'redirect'));
      expect(res.status).toBe(302);
      expect(res.body).toBe('');
      const location = new URL(res.location ?? '');
      expect(`${location.origin}${location.pathname}`).toBe(ENV_CALLBACK);
      expect([...location.searchParams]).toEqual([
        ['error', OAUTH_ACCESS_DENIED_ERROR],
        ['error_description', ENV_ACCESS_DENIED_MESSAGE],
        ['state', STATE],
        ['iss', ISSUER],
      ]);
    });

    it('the page', async () => {
      const rig = await arrange();
      const res = await bytesOf(await refuse(rig, 'page'));
      expect(res.status).toBe(403);
      expect(res.contentType).toBe('text/html; charset=utf-8');
      expect(res.body).toContain(PAGE_SENTENCE);
      expect(createHash('sha256').update(res.body).digest('hex')).toBe(PAGE_SHA256_AT_MERGE_BASE);
    });

  });

  it('a refusal object whose reason and sentence are both refused answers the same bytes as `false`, on every door', async () => {
    for (const door of ['envelope', 'redirect', 'page'] as const) {
      const boolean = await arrange();
      const object = await arrange();
      object.gate.answer = { allowed: false, reason: 'Not-A-Code', message: '<b>no</b>' };
      expect(await bytesOf(await refuse(object, door)), door).toEqual(await bytesOf(await refuse(boolean, door)));
    }
  });

  it('the envelope keeps code ENV_ACCESS_DENIED and gains the reason; the message is the host\'s sentence', async () => {
    const rig = await arrange();
    rig.gate.answer = NOT_MEMBER;

    const res = await refuse(rig, 'envelope');

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: ENV_ACCESS_DENIED_CODE, message: NOT_MEMBER.message, reason: 'not_member' });
  });

  it('the redirect keeps error=access_denied, sends the host\'s sentence as error_description and the reason as its own parameter', async () => {
    const rig = await arrange();
    rig.gate.answer = NOT_MEMBER;

    const res = await refuse(rig, 'redirect');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(ENV_CALLBACK);
    expect([...location.searchParams]).toEqual([
      ['error', OAUTH_ACCESS_DENIED_ERROR],
      ['error_description', NOT_MEMBER.message],
      [OAUTH_REFUSAL_REASON_PARAM, 'not_member'],
      ['state', STATE],
      ['iss', ISSUER],
    ]);
    expect(location.searchParams.has('code')).toBe(false);
  });

  it('the page shows the host\'s sentence, escaped, beside the signed-in account', async () => {
    const rig = await arrange();
    rig.gate.answer = { ...NOT_MEMBER, message: 'You are not a member of "Smith & Sons". Ask them to invite you.' };

    const res = await refuse(rig, 'page');

    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain(
      `<p data-refusal-code="${ENV_ACCESS_DENIED_CODE}">You are signed in as <strong>${EMAIL}</strong>. You are not a member of &#34;Smith &#38; Sons&#34;. Ask them to invite you.</p>`,
    );
    expect(html).not.toContain('does not have access to this environment.</p>');
  });

  const refusedReasons: ReadonlyArray<[string, unknown]> = [
    ['upper case', 'NOT_MEMBER'],
    ['a digit', 'not_member2'],
    ['a hyphen', 'not-member'],
    ['markup', '<script>'],
    ['a URL fragment', 'x&error=other'],
    ['longer than 40', 'a'.repeat(41)],
    ['empty', ''],
    ['not a string', 7],
  ];
  for (const [name, reason] of refusedReasons) {
    it(`a reason outside [a-z_]{1,40} (${name}) is dropped on every door; the refusal and the host's sentence stand`, async () => {
      const envelope = await arrange();
      envelope.gate.answer = { ...NOT_MEMBER, reason };
      const body: any = await (await refuse(envelope, 'envelope')).json();
      expect(body).toEqual({ code: ENV_ACCESS_DENIED_CODE, message: NOT_MEMBER.message });

      const redirect = await arrange();
      redirect.gate.answer = { ...NOT_MEMBER, reason };
      const location = new URL((await refuse(redirect, 'redirect')).headers.get('location') ?? '');
      expect(location.searchParams.get('error')).toBe(OAUTH_ACCESS_DENIED_ERROR);
      expect(location.searchParams.has(OAUTH_REFUSAL_REASON_PARAM)).toBe(false);
      expect(location.searchParams.get('error_description')).toBe(NOT_MEMBER.message);
    });
  }

  it('a reason of exactly 40 characters travels', async () => {
    const rig = await arrange();
    rig.gate.answer = { ...NOT_MEMBER, reason: 'a'.repeat(40) };
    const location = new URL((await refuse(rig, 'redirect')).headers.get('location') ?? '');
    expect(location.searchParams.get(OAUTH_REFUSAL_REASON_PARAM)).toBe('a'.repeat(40));
  });

  const refusedMessages: ReadonlyArray<[string, unknown]> = [
    ['markup', 'You are not a member of <b>Acme</b>.'],
    ['a control character', 'Line one.\nLine two.'],
    ['longer than the bound', 'x'.repeat(REFUSAL_MESSAGE_MAX_LENGTH + 1)],
    ['blank', '   '],
    ['not a string', { text: 'no' }],
  ];
  for (const [name, message] of refusedMessages) {
    it(`a sentence that is not plain text within the bound (${name}) is replaced by the fixed sentence; the reason still travels`, async () => {
      const envelope = await arrange();
      envelope.gate.answer = { ...NOT_MEMBER, message };
      expect(await (await refuse(envelope, 'envelope')).json()).toEqual({
        code: ENV_ACCESS_DENIED_CODE,
        message: ENV_ACCESS_DENIED_MESSAGE,
        reason: 'not_member',
      });

      const page = await arrange();
      page.gate.answer = { ...NOT_MEMBER, message };
      const html = await (await refuse(page, 'page')).text();
      expect(html).toContain('this account does not have access to this environment.</p>');
      if (typeof message === 'string' && message.includes('<b>')) expect(html).not.toContain('<b>Acme</b>');
    });
  }

  it('a plain sentence outside the RFC 6749 error_description character set reaches the envelope and the page, and the redirect sends the fixed sentence', async () => {
    const message = 'Vous n’êtes pas membre de Société Générale.';

    const envelope = await arrange();
    envelope.gate.answer = { ...NOT_MEMBER, message };
    expect((await (await refuse(envelope, 'envelope')).json()).message).toBe(message);

    const redirect = await arrange();
    redirect.gate.answer = { ...NOT_MEMBER, message };
    const location = new URL((await refuse(redirect, 'redirect')).headers.get('location') ?? '');
    expect(location.searchParams.get('error_description')).toBe(ENV_ACCESS_DENIED_MESSAGE);
    expect(location.searchParams.get(OAUTH_REFUSAL_REASON_PARAM)).toBe('not_member');

    const page = await arrange();
    page.gate.answer = { ...NOT_MEMBER, message };
    expect(await (await refuse(page, 'page')).text()).toContain('Société Générale.');
  });

  it('nothing changes who is admitted: an object that does not say allowed: false admits, as any truthy answer always has', async () => {
    const rig = await arrange();
    const clientId = await rig.register(ENV_CALLBACK, 'web');
    rig.clientRow(clientId).skip_consent = true;
    rig.gate.answer = { allowed: true, reason: 'not_member', message: 'ignored' };

    const res = await rig.authorize(codeRequest(clientId, ENV_CALLBACK), NAVIGATION);

    expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId }]);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.has('error')).toBe(false);
  });

  it('a refusal object refuses on a resume pass too, with the reason on the envelope', async () => {
    const rig = await arrange();
    const clientId = await rig.register(ENV_CALLBACK, 'web');
    rig.clientRow(clientId).skip_consent = true;
    rig.gate.allow = true;
    const first = await rig.authorize(codeRequest(clientId, ENV_CALLBACK), NAVIGATION, 'anonymous');
    const location = first.headers.get('location') ?? '';
    rig.gate.calls.length = 0;
    rig.gate.answer = NOT_MEMBER;

    const res = await rig.call('/sign-in/email', {
      body: { email: EMAIL, password: PASSWORD, oauth_query: location.slice(location.indexOf('?')) },
      headers: CONSOLE_FETCH,
    });

    expect(rig.gate.calls).toEqual([{ userId: rig.userId, clientId }]);
    await expectRefusalEnvelope(res);
    expect((await res.json()).reason).toBe('not_member');
  });
});

describe('the sign-in page reads the client name only for the client its signed request names', () => {
  type Rig = Awaited<ReturnType<typeof arrange>>;

  /** The signed authorization request the provider puts on the sign-in URL, for a signed-out browser. */
  const signedRequestFor = async (rig: Rig, clientId: string): Promise<string> => {
    const res = await rig.authorize(codeRequest(clientId, ENV_CALLBACK), NAVIGATION, 'anonymous');
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith(`${ORIGIN}/_console/login?`), location).toBe(true);
    return location.slice(location.indexOf('?') + 1);
  };

  /** One window counter per rig, as the plugin keeps one per process. */
  const counters = new WeakMap<Rig, CounterStore>();
  const read = (rig: Rig, queries: Record<string, string[]>, clientAddress = '203.0.113.7') => {
    if (!counters.has(rig)) counters.set(rig, new InProcessCounterStore());
    return answerOAuthClientName(
      { queries, clientAddress },
      {
        getAuthContext: () => rig.manager.getAuthContext(),
        getDataEngine: () => rig.manager.getDataEngine() as any,
        counterStore: async () => counters.get(rig)!,
      },
    );
  };

  /** A client registered with every public field set, so an answer that carried more would show it. */
  const registerNamed = async (rig: Rig, name: string): Promise<string> => {
    const res = await rig.call('/oauth2/register', {
      body: {
        client_name: name,
        client_uri: 'https://app.example',
        logo_uri: 'https://app.example/logo.png',
        contacts: ['owner@app.example'],
        tos_uri: 'https://app.example/tos',
        policy_uri: 'https://app.example/policy',
        redirect_uris: [ENV_CALLBACK],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'web',
      },
    });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(201);
    return String(body.client_id);
  };

  it('the client the signed request names is served its name, and nothing else of the client', async () => {
    const rig = await arrange();
    const clientId = await registerNamed(rig, 'Acme Corp');
    const oauthQuery = await signedRequestFor(rig, clientId);

    const answer = await read(rig, { client_id: [clientId], oauth_query: [oauthQuery] });

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ success: true, data: { client_name: 'Acme Corp' } });
    expect(answer.headers['Cache-Control']).toBe('no-store');
  });

  it('a client_id that is not the one the signed request names is refused, and its name is never read', async () => {
    const rig = await arrange();
    const signedFor = await registerNamed(rig, 'Acme Corp');
    const other = await registerNamed(rig, 'Other Org');
    const oauthQuery = await signedRequestFor(rig, signedFor);

    const answer = await read(rig, { client_id: [other], oauth_query: [oauthQuery] });

    expect(answer.status).toBe(404);
    expect(answer.body).toEqual(OAUTH_CLIENT_NAME_NOT_FOUND);
    expect(JSON.stringify(answer.body)).not.toContain('Other Org');
  });

  it("is rate-limited per client address: the window's reads answer, the next is refused, another address still answers", async () => {
    const rig = await arrange();
    const clientId = await registerNamed(rig, 'Acme Corp');
    const oauthQuery = await signedRequestFor(rig, clientId);
    const queries = { client_id: [clientId], oauth_query: [oauthQuery] };

    for (let i = 0; i < OAUTH_CLIENT_NAME_RATE_LIMIT.max; i++) {
      expect((await read(rig, queries, '198.51.100.1')).status).toBe(200);
    }
    const tripped: any = await read(rig, queries, '198.51.100.1');
    expect(tripped.status).toBe(429);
    expect(tripped.body).toEqual({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: expect.any(String) } });
    expect(tripped.headers['Cache-Control']).toBe('no-store');
    const retryAfter = Number(tripped.headers['Retry-After']);
    expect(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= OAUTH_CLIENT_NAME_RATE_LIMIT.window).toBe(true);

    const other: any = await read(rig, queries, '198.51.100.2');
    expect(other.status).toBe(200);
    expect(other.body).toEqual({ success: true, data: { client_name: 'Acme Corp' } });
  });

  const sameRefusal: ReadonlyArray<[string, (rig: Rig, clientId: string, oauthQuery: string) => Record<string, string[]>]> = [
    ['an unknown client (the row is gone)', (rig, clientId, oauthQuery) => {
      const rows = rig.engine.tables.get('sys_oauth_application') as any[];
      rows.splice(rows.indexOf(rig.clientRow(clientId)), 1);
      return { client_id: [clientId], oauth_query: [oauthQuery] };
    }],
    ['a disabled client', (rig, clientId, oauthQuery) => {
      rig.clientRow(clientId).disabled = true;
      return { client_id: [clientId], oauth_query: [oauthQuery] };
    }],
    ['a signed request whose client_id was changed after signing', (_rig, clientId, oauthQuery) => {
      const tampered = new URLSearchParams(oauthQuery);
      tampered.set('client_id', `${clientId}x`);
      return { client_id: [`${clientId}x`], oauth_query: [tampered.toString()] };
    }],
    ['a signed request that has expired', (_rig, clientId, oauthQuery) => {
      const expired = new URLSearchParams(oauthQuery);
      expired.set('exp', '1');
      return { client_id: [clientId], oauth_query: [expired.toString()] };
    }],
  ];
  for (const [name, mutate] of sameRefusal) {
    it(`${name} gets the same refusal as a mismatch`, async () => {
      const rig = await arrange();
      const clientId = await registerNamed(rig, 'Acme Corp');
      const oauthQuery = await signedRequestFor(rig, clientId);

      const answer = await read(rig, mutate(rig, clientId, oauthQuery));

      expect(answer.status).toBe(404);
      expect(answer.body).toEqual(OAUTH_CLIENT_NAME_NOT_FOUND);
    });
  }

  it('a malformed request answers 400: a parameter outside the closed set, a repeated one, a missing one', async () => {
    const rig = await arrange();
    const clientId = await registerNamed(rig, 'Acme Corp');
    const oauthQuery = await signedRequestFor(rig, clientId);

    const malformed: ReadonlyArray<Record<string, string[]>> = [
      { client_id: [clientId], oauth_query: [oauthQuery], scope: ['openid'] },
      { client_id: [clientId, clientId], oauth_query: [oauthQuery] },
      { oauth_query: [oauthQuery] },
      { client_id: [clientId] },
    ];
    for (const queries of malformed) {
      const answer: any = await read(rig, queries);
      expect(answer.status, JSON.stringify(Object.keys(queries))).toBe(400);
      expect(answer.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe("the environment's callback carries the host's refusal reason on to the sign-in page", () => {
  const IDP = 'https://idp.example.test';
  const KEPT = '/_console/login?redirect=%2Fapps%2Fcrm&direct=returned';
  const OTHER_IDP = 'acme-idp';

  const idpProvider = (providerId: string) => ({
    providerId,
    clientId: `${providerId}-client`,
    clientSecret: `${providerId}-secret`,
    authorizationUrl: `${IDP}/${providerId}/authorize`,
    tokenUrl: `${IDP}/${providerId}/token`,
    userInfoUrl: `${IDP}/${providerId}/userinfo`,
    pkce: false,
  });

  /** An environment that signs in through the platform identity provider. */
  const environment = () =>
    new AuthManager({
      secret: SECRET,
      baseUrl: ORIGIN,
      dataEngine: createMemoryEngine(),
      oidcProviders: [idpProvider(PLATFORM_IDP_PROVIDER_ID), idpProvider(OTHER_IDP)],
      directSignIn: { provider: PLATFORM_IDP_PROVIDER_ID },
    } as any);

  const cookieList = (res: Response): string[] =>
    (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']).map((c) => c.split(';')[0]!).filter(Boolean);

  /** A sign-in started at the environment: the state the identity provider must hand back, and its cookies. */
  const begin = async (env: AuthManager, providerId: string) => {
    if (providerId === PLATFORM_IDP_PROVIDER_ID) {
      const res = await env.startDirectSignIn(
        new Request(`${ORIGIN}/api/v1/auth/sign-in/direct?callbackURL=${encodeURIComponent(KEPT)}`),
      );
      expect(res.status).toBe(302);
      return { state: new URL(res.headers.get('location')!).searchParams.get('state')!, cookies: cookieList(res) };
    }
    const res = await env.handleRequest(
      new Request(`${ORIGIN}/api/v1/auth/sign-in/social`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, callbackURL: KEPT, disableRedirect: true }),
      }),
    );
    const body: any = await res.clone().json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    return { state: new URL(body.url).searchParams.get('state')!, cookies: cookieList(res) };
  };

  /** The identity provider's refusal arriving at the environment's callback; answers where the browser goes next. */
  const landOn = async (providerId: string, refusal: Record<string, string>) => {
    const env = environment();
    const begun = await begin(env, providerId);
    const query = new URLSearchParams({ ...refusal, state: begun.state });
    const res = await env.handleRequest(
      new Request(`${ORIGIN}/api/v1/auth/callback/${providerId}?${query}`, { headers: { cookie: begun.cookies.join('; ') } }),
    );
    expect(res.status).toBe(302);
    return new URL(res.headers.get('location') ?? '');
  };

  /** The refusal the provider sends back, read off a real refused authorize. */
  const providerRefusal = async (answer: unknown): Promise<Record<string, string>> => {
    const rig = await arrange();
    rig.gate.answer = answer;
    const clientId = await rig.register(ENV_CALLBACK, 'web');
    const res = await rig.authorize(codeRequest(clientId, ENV_CALLBACK), NAVIGATION);
    const params = Object.fromEntries(new URL(res.headers.get('location') ?? '').searchParams);
    delete params.state;
    delete params.iss;
    return params;
  };

  const NOT_MEMBER = { allowed: false, reason: 'not_member', message: 'You are not a member of Acme Corp.' } as const;

  it('a refusal with a reason lands on the sign-in page with error, error_description and the reason', async () => {
    const landed = await landOn(PLATFORM_IDP_PROVIDER_ID, await providerRefusal(NOT_MEMBER));

    expect(`${landed.pathname}`).toBe('/_console/login');
    expect(landed.searchParams.get('redirect')).toBe('/apps/crm');
    expect(landed.searchParams.get('error')).toBe(OAUTH_ACCESS_DENIED_ERROR);
    expect(landed.searchParams.get('error_description')).toBe(NOT_MEMBER.message);
    expect(landed.searchParams.getAll(OAUTH_REFUSAL_REASON_PARAM)).toEqual(['not_member']);
  });

  it('control: a boolean refusal lands exactly as before, with no reason', async () => {
    const landed = await landOn(PLATFORM_IDP_PROVIDER_ID, await providerRefusal(false));

    expect(landed.searchParams.get('error')).toBe(OAUTH_ACCESS_DENIED_ERROR);
    expect(landed.searchParams.get('error_description')).toBe(ENV_ACCESS_DENIED_MESSAGE);
    expect(landed.searchParams.has(OAUTH_REFUSAL_REASON_PARAM)).toBe(false);
  });

  const notCarried: ReadonlyArray<[string, string, Record<string, string>]> = [
    ['a reason outside [a-z_]{1,40}', PLATFORM_IDP_PROVIDER_ID, { error: 'access_denied', [OAUTH_REFUSAL_REASON_PARAM]: 'NOT_MEMBER' }],
    ['a reason beside an error other than access_denied', PLATFORM_IDP_PROVIDER_ID, { error: 'server_error', [OAUTH_REFUSAL_REASON_PARAM]: 'not_member' }],
    ['a reason from an identity provider that is not the platform one', OTHER_IDP, { error: 'access_denied', [OAUTH_REFUSAL_REASON_PARAM]: 'not_member' }],
  ];
  for (const [name, providerId, refusal] of notCarried) {
    it(`${name} is not carried`, async () => {
      const landed = await landOn(providerId, refusal);
      expect(landed.searchParams.get('error')).toBe(refusal.error);
      expect(landed.searchParams.has(OAUTH_REFUSAL_REASON_PARAM)).toBe(false);
    });
  }

  it('two reasons on the callback are not carried', async () => {
    const env = environment();
    const begun = await begin(env, PLATFORM_IDP_PROVIDER_ID);
    const query = `error=access_denied&${OAUTH_REFUSAL_REASON_PARAM}=not_member&${OAUTH_REFUSAL_REASON_PARAM}=invitation_pending&state=${encodeURIComponent(begun.state)}`;
    const res = await env.handleRequest(
      new Request(`${ORIGIN}/api/v1/auth/callback/${PLATFORM_IDP_PROVIDER_ID}?${query}`, { headers: { cookie: begun.cookies.join('; ') } }),
    );
    const landed = new URL(res.headers.get('location') ?? '');
    expect(landed.searchParams.get('error')).toBe(OAUTH_ACCESS_DENIED_ERROR);
    expect(landed.searchParams.has(OAUTH_REFUSAL_REASON_PARAM)).toBe(false);
  });
});
