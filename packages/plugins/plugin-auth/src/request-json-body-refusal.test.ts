// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A declared-JSON body that does not parse is REFUSED by this package's own
 * routes — `400 INVALID_REQUEST`, the code and message family the HTTP
 * transports answer for the same input — never read as `{}` (#24032).
 *
 * Every route here used to read its body as
 * `try { body = await request.json() } catch { body = {} }`, so a truncated
 * body was answered as if the client had sent none: `POST /admin/unlock-user`
 * with `{"userId": "usr_nobody"` (closing brace missing) answered
 * `400 "userId is required"` for a body that carried `userId`, and the one-click
 * `send-verification-email` resend mailed the CALLER's own address for a body
 * that named another one.
 *
 * Driven through the plugin's REAL route registration on a real Hono app (the
 * `admin-sso-bridge-gate.test.ts` harness), with the auth manager reduced to
 * the seams these routes read. One block per route family:
 *
 *   A. the inline mounts in `auth-plugin.ts` — toggle-disabled, unlock-user,
 *      sys-oauth-application/register;
 *   B. the identity import (`admin-import-users.ts`);
 *   C. the four `/admin/sso/*` bridges (`register-sso-provider.ts`);
 *   D. the self-service resend (`send-verification-email.ts`);
 *   E–I. the routes whose reader was a module-private `parseJson` that answered
 *      `{}` from its `catch` — ban/unban (`admin-ban-endpoints.ts`),
 *      set-user-manager, create-user/set-user-password
 *      (`admin-user-endpoints.ts`), organization/add-member — and
 *      `set-initial-password` (`parsed = {}`).
 *
 * Each refusal asserts the envelope, the code, the message's first sentence
 * (the message family IS this card's contract), that the message does not echo
 * the body, and that the route did nothing after the read. Each family also
 * pins its EMPTY-body answer — no body, a zero-byte body, a whitespace-only
 * body — as it is today, since an empty body is not this change.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { envelopeViolations } from '@objectstack/spec/api';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin.js';
// The import route loads this module with a dynamic `import()` on its first
// request, and that first load (`@objectstack/rest`'s import framework among
// it) measured 8.7s inside a 10s clocked test. Loaded here, it is paid during
// collection, and the route's own `import()` reads the module cache. The same
// holds for the three modules the E–I routes load on first request.
import './admin-import-users.js';
import './admin-user-endpoints.js';
import './admin-set-user-manager.js';
import './organization-add-member.js';

const BASE = '/api/v1/auth';
const ORIGIN = 'http://localhost:3000';
const SESSION_EMAIL = 'me@example.test';
const JSON_TYPE = { 'content-type': 'application/json' };

/** The first sentence of the transports' refusal (`plugin-hono-server`'s `request-body.ts`). */
const PARSE_REFUSAL = 'The request body could not be parsed as JSON (it was sent as application/json).';
const UNREADABLE_REFUSAL = 'The request body could not be read.';

/** Everything a route could DO after reading its body, recorded per request. */
const acts = {
  unlockUser: vi.fn(async (_id: string) => true),
  createOAuthClient: vi.fn(async (_input: unknown) => ({ client_id: 'cl_pin' })),
  engine: [] as string[],
  vendor: [] as string[],
  sent: [] as unknown[],
  /** better-auth server-api calls and auth-context reads (the E–I routes' next steps). */
  authApi: [] as string[],
};

const apiCall = (name: string) => vi.fn(async () => {
  acts.authApi.push(name);
  return {};
});

const engineOp = (op: string) => vi.fn(async (object: string) => {
  acts.engine.push(`${op} ${object}`);
  return op === 'find' ? [] : op === 'count' ? 0 : null;
});
const engine = {
  insert: engineOp('insert'),
  update: engineOp('update'),
  delete: engineOp('delete'),
  find: engineOp('find'),
  findOne: engineOp('findOne'),
  count: engineOp('count'),
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_TYPE });

/** better-auth's universal handler: a session for `/get-session`, a recorder for the resend. */
async function handleRequest(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  acts.vendor.push(path);
  if (path.endsWith('/get-session')) return json({ user: { email: SESSION_EMAIL }, session: {} });
  if (path.endsWith('/send-verification-email')) {
    acts.sent.push(await req.json());
    return json({ status: true });
  }
  return new Response(null, { status: 404 });
}

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as unknown as PluginContext;

let app: Hono;

beforeAll(async () => {
  app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({
    secret: 'test-secret-at-least-32-chars-long!!',
    plugins: { oidcProvider: false },
  });
  await plugin.init(ctx);
  (plugin as unknown as { authManager: unknown }).authManager = {
    handleRequest,
    getApi: async () => ({
      getSession: async () => ({ user: { id: 'usr_platform_admin', email: SESSION_EMAIL, isPlatformAdmin: true } }),
      createOAuthClient: acts.createOAuthClient,
      // Present so the capability checks admit the E–I routes; recorded if called.
      createUser: apiCall('createUser'),
      banUser: apiCall('banUser'),
      addMember: apiCall('addMember'),
      setPassword: apiCall('setPassword'),
    }),
    getAuthContext: async () => {
      acts.authApi.push('getAuthContext');
      throw new Error('the auth context is not part of this harness');
    },
    getDataEngine: () => engine,
    unlockUser: acts.unlockUser,
    isSsoDomainVerificationEnabled: () => true,
    isPhoneNumberEnabled: () => false,
    isEmailServiceAvailable: () => false,
    isPhoneOtpDeliverable: () => false,
    getConsoleUrl: () => undefined,
    noteMustChangePasswordIssued: () => undefined,
  };
  (plugin as unknown as {
    registerAuthRoutes(server: unknown, ctx: PluginContext): void;
  }).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
});

beforeEach(() => {
  acts.unlockUser.mockClear();
  acts.createOAuthClient.mockClear();
  acts.engine.length = 0;
  acts.vendor.length = 0;
  acts.sent.length = 0;
  acts.authApi.length = 0;
});

const post = (path: string, init: { headers?: Record<string, string>; body?: BodyInit }) =>
  app.request(`${ORIGIN}${BASE}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, ...(init.headers ?? {}) },
    ...(init.body !== undefined ? { body: init.body } : {}),
  });

/** The three empty spellings a client sends: none at all, zero bytes, whitespace only. */
const EMPTY_BODIES: Array<[string, { headers?: Record<string, string>; body?: BodyInit }]> = [
  ['no body and no Content-Type', {}],
  ['a zero-byte body sent as application/json', { headers: { ...JSON_TYPE, 'content-length': '0' }, body: '' }],
  ['a whitespace-only body sent as application/json', { headers: JSON_TYPE, body: ' \n\t ' }],
];

async function expectParseRefusal(res: Response, notEchoed: string, first = PARSE_REFUSAL) {
  const body = (await res.json()) as { success: boolean; error: { code: string; message: string } };
  expect(res.status, JSON.stringify(body)).toBe(400);
  expect(envelopeViolations(body)).toEqual([]);
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('INVALID_REQUEST');
  expect(body.error.message.startsWith(first), body.error.message).toBe(true);
  expect(body.error.message).not.toContain(notEchoed);
}

async function expectAnswer(res: Response, status: number, code: string, message: string) {
  const body = (await res.json()) as { success: boolean; error?: { code: string; message: string } };
  expect(res.status, JSON.stringify(body)).toBe(status);
  expect(body.error?.code).toBe(code);
  expect(body.error?.message).toBe(message);
}

const nothingActed = () => {
  expect(acts.unlockUser).not.toHaveBeenCalled();
  expect(acts.createOAuthClient).not.toHaveBeenCalled();
  expect(acts.engine).toEqual([]);
  expect(acts.vendor).toEqual([]);
  expect(acts.sent).toEqual([]);
  expect(acts.authApi).toEqual([]);
};

// ── A. the inline mounts in auth-plugin.ts ─────────────────────────────────

const INLINE: Array<{ path: string; truncated: string; echo: string; empty: string }> = [
  {
    path: '/admin/unlock-user',
    truncated: '{"userId": "usr_nobody"',
    echo: 'usr_nobody',
    empty: 'userId is required',
  },
  {
    path: '/admin/oauth2/toggle-disabled',
    truncated: '{"client_id": "cl_pin_absent", "disabled": true',
    echo: 'cl_pin_absent',
    empty: 'client_id is required',
  },
  {
    path: '/sys-oauth-application/register',
    truncated: '{"name": "Pin App", "redirectURLs": "https://pin.example/cb"',
    echo: 'Pin App',
    empty: 'name is required',
  },
];

describe('A. the inline auth-plugin mounts refuse a declared-JSON body that does not parse', () => {
  for (const route of INLINE) {
    it(`${route.path}: a truncated body is 400 INVALID_REQUEST, and nothing after the read runs`, async () => {
      const res = await post(route.path, { headers: JSON_TYPE, body: route.truncated });
      await expectParseRefusal(res, route.echo);
      nothingActed();
    });

    it(`${route.path}: { not json — the same refusal`, async () => {
      await expectParseRefusal(await post(route.path, { headers: JSON_TYPE, body: '{ not json' }), 'not json');
      nothingActed();
    });

    for (const [label, init] of EMPTY_BODIES) {
      it(`${route.path}: CONTROL — ${label} keeps today's answer, 400 "${route.empty}"`, async () => {
        await expectAnswer(await post(route.path, init), 400, 'INVALID_REQUEST', route.empty);
        nothingActed();
      });
    }
  }

  it('/admin/unlock-user: a declared-JSON body that cannot be READ is refused, not read as no body', async () => {
    const stream = new ReadableStream({ start(controller) { controller.error(new Error('socket reset')); } });
    const res = await app.request(
      new Request(`${ORIGIN}${BASE}/admin/unlock-user`, {
        method: 'POST',
        headers: { origin: ORIGIN, ...JSON_TYPE },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    );
    await expectParseRefusal(res, 'socket reset', UNREADABLE_REFUSAL);
    nothingActed();
  });

  it('/admin/unlock-user: CONTROL — a well-formed body is read and acted on, as before', async () => {
    const res = await post('/admin/unlock-user', { headers: JSON_TYPE, body: '{"userId": "usr_nobody"}' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { userId: 'usr_nobody' } });
    expect(acts.unlockUser.mock.calls).toEqual([['usr_nobody']]);
  });

  it('/admin/unlock-user: CONTROL — these routes never read the Content-Type to PARSE: valid JSON sent as text/plain is read, as before', async () => {
    const res = await post('/admin/unlock-user', { headers: { 'content-type': 'text/plain' }, body: '{"userId": "usr_nobody"}' });
    expect(res.status).toBe(200);
    expect(acts.unlockUser.mock.calls).toEqual([['usr_nobody']]);
  });

  it('/admin/unlock-user: CONTROL — a body that does not declare JSON and does not parse is still no body', async () => {
    const res = await post('/admin/unlock-user', { headers: { 'content-type': 'text/plain' }, body: '{"userId": "usr_nobody"' });
    await expectAnswer(res, 400, 'INVALID_REQUEST', 'userId is required');
    nothingActed();
  });
});

// ── B. the identity import (admin-import-users.ts) ─────────────────────────

describe('B. /admin/import-users refuses a declared-JSON body that does not parse', () => {
  it('a truncated body is 400 INVALID_REQUEST, and no row is read or written', async () => {
    const res = await post('/admin/import-users', {
      headers: JSON_TYPE,
      body: '{"format": "json", "rows": [{"email": "pin-import@example.test"}]',
    });
    await expectParseRefusal(res, 'pin-import@example.test');
    nothingActed();
  });

  for (const [label, init] of EMPTY_BODIES) {
    it(`CONTROL — ${label} keeps today's answer, 400 INVALID_REQUEST naming the payload formats`, async () => {
      const res = await post('/admin/import-users', init);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message.startsWith('Provide format:'), body.error.message).toBe(true);
      nothingActed();
    });
  }
});

// ── C. the four /admin/sso/* bridges (register-sso-provider.ts) ────────────

const BRIDGES: Array<{ path: string; truncated: string; empty: string }> = [
  {
    path: '/admin/sso/register',
    truncated:
      '{"providerId": "acme-pin", "issuer": "https://idp.acme.example", "domain": "acme.example", "clientId": "cid", "clientSecret": "csecret"',
    empty: 'Missing required field(s): providerId, issuer, domain, clientId, clientSecret',
  },
  {
    path: '/admin/sso/register-saml',
    truncated:
      '{"providerId": "acme-pin", "issuer": "https://idp.acme.example/entity", "domain": "acme.example", "entryPoint": "https://idp.acme.example/sso", "cert": "PROBE-CERT"',
    empty: 'Missing required field(s): providerId, issuer, domain, entryPoint, cert',
  },
  {
    path: '/admin/sso/request-domain-verification',
    truncated: '{"providerId": "acme-pin"',
    empty: 'Missing required field: providerId',
  },
  {
    path: '/admin/sso/verify-domain',
    truncated: '{"providerId": "acme-pin"',
    empty: 'Missing required field: providerId',
  },
];

describe('C. the /admin/sso/* bridges refuse a declared-JSON body that does not parse', () => {
  for (const bridge of BRIDGES) {
    it(`${bridge.path}: a truncated body is 400 INVALID_REQUEST, and the vendor is never called`, async () => {
      const res = await post(bridge.path, { headers: JSON_TYPE, body: bridge.truncated });
      await expectParseRefusal(res, 'acme-pin');
      nothingActed();
    });

    for (const [label, init] of EMPTY_BODIES) {
      it(`${bridge.path}: CONTROL — ${label} keeps today's answer, 400 "${bridge.empty}"`, async () => {
        await expectAnswer(await post(bridge.path, init), 400, 'INVALID_REQUEST', bridge.empty);
        nothingActed();
      });
    }
  }
});

// ── D. the self-service resend (send-verification-email.ts) ────────────────

describe('D. /send-verification-email refuses a declared-JSON body that does not parse', () => {
  it('a truncated body naming another address is 400 INVALID_REQUEST, and nothing is looked up or sent', async () => {
    const res = await post('/send-verification-email', {
      headers: { ...JSON_TYPE, cookie: 'better-auth.session_token=pin' },
      body: '{"email": "other@example.test"',
    });
    await expectParseRefusal(res, 'other@example.test');
    nothingActed();
  });

  for (const [label, init] of EMPTY_BODIES) {
    it(`CONTROL — ${label} is still the one-click resend to the caller's own address`, async () => {
      const res = await post('/send-verification-email', {
        ...init,
        headers: { ...(init.headers ?? {}), cookie: 'better-auth.session_token=pin' },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: true });
      expect(acts.sent).toEqual([{ email: SESSION_EMAIL }]);
    });
  }
});

// ── E–I. the second spelling: a reader that answered `{}` from its `catch` ─

interface SecondSpellingRoute {
  path: string;
  truncated: string;
  echo: string;
  empty: string;
  /** The empty body's code, where it is not `INVALID_REQUEST` (#28289: Create User's field-level refusal). */
  emptyCode?: string;
  /** The empty body's `error.fields`, where the refusal is field-level. */
  emptyFields?: unknown[];
  /** `admin-set-user-manager.ts` discriminates its refusals by `error.details.reason`. */
  reason?: string;
}

const SECOND_SPELLING: Array<{ reader: string; routes: SecondSpellingRoute[] }> = [
  {
    reader: 'E. admin-ban-endpoints.ts parseJson',
    routes: [
      { path: '/admin/ban-user', truncated: '{"userId": "usr_pin_target", "banReason": "spam"', echo: 'usr_pin_target', empty: 'userId is required' },
      { path: '/admin/unban-user', truncated: '{"userId": "usr_pin_target"', echo: 'usr_pin_target', empty: 'userId is required' },
    ],
  },
  {
    reader: 'F. admin-set-user-manager.ts parseJson',
    routes: [
      {
        path: '/admin/set-user-manager',
        truncated: '{"userId": "usr_pin_target", "managerId": "usr_pin_boss"',
        echo: 'usr_pin_target',
        empty: 'userId is required',
        reason: 'invalid_body',
      },
    ],
  },
  {
    reader: 'G. admin-user-endpoints.ts parseJson',
    routes: [
      { path: '/admin/create-user', truncated: '{"email": "pin-new@example.test", "name": "Pin New"', echo: 'pin-new@example.test', empty: 'Email is required',
        emptyCode: 'VALIDATION_FAILED', emptyFields: [{ field: 'email', code: 'required', message: 'Email is required' }] },
      { path: '/admin/set-user-password', truncated: '{"userId": "usr_pin_target", "newPassword": "Pin-Passw0rd!"', echo: 'usr_pin_target', empty: 'userId is required' },
    ],
  },
  {
    reader: 'H. organization-add-member.ts parseJson',
    routes: [
      { path: '/organization/add-member', truncated: '{"userId": "usr_pin_target", "role": "member", "organizationId": "org_pin"', echo: 'usr_pin_target', empty: 'userId is required' },
    ],
  },
  {
    reader: 'I. set-initial-password.ts (parsed = {})',
    routes: [
      { path: '/set-initial-password', truncated: '{"newPassword": "Pin-Passw0rd!"', echo: 'Pin-Passw0rd!', empty: 'newPassword is required' },
    ],
  },
];

for (const { reader, routes } of SECOND_SPELLING) {
  describe(`${reader} refuses a declared-JSON body that does not parse`, () => {
    for (const route of routes) {
      it(`${route.path}: a truncated body is 400 INVALID_REQUEST, and nothing after the read runs`, async () => {
        const res = await post(route.path, { headers: JSON_TYPE, body: route.truncated });
        if (route.reason) {
          const peek = (await res.clone().json()) as { error?: { details?: { reason?: string } } };
          expect(peek.error?.details?.reason).toBe(route.reason);
        }
        await expectParseRefusal(res, route.echo);
        nothingActed();
      });

      for (const [label, init] of EMPTY_BODIES) {
        it(`${route.path}: CONTROL — ${label} keeps today's answer, 400 "${route.empty}"`, async () => {
          const res = await post(route.path, init);
          if (route.reason) {
            const peek = (await res.clone().json()) as { error?: { details?: { reason?: string } } };
            expect(peek.error?.details?.reason).toBe(route.reason);
          }
          if (route.emptyFields) {
            const peek = (await res.clone().json()) as { error?: { fields?: unknown[] } };
            expect(peek.error?.fields).toEqual(route.emptyFields);
          }
          await expectAnswer(res, 400, route.emptyCode ?? 'INVALID_REQUEST', route.empty);
          nothingActed();
        });
      }
    }
  });
}
