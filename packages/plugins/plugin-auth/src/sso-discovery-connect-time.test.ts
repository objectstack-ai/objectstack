// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SSO discovery connects only to addresses that are public at connect time —
 * see `sso-discovery-egress.ts` for the rule this file pins.
 *
 * A real `AuthManager` with the real `sso()` plugin over the in-memory engine,
 * driven through its HTTP surface, with the REAL SSO discovery guard
 * (`createSsoDiscoveryEgressGuard`: its policy and its own transport). Name
 * resolution is a double, and so is the platform's ordinary transport (the
 * global fetch), which resolves the name again when it connects, records the
 * address it connects to and answers the identity provider's document.
 *
 * The world these cases build: the identity provider's name answers a public
 * address to every check made before a read (the vendor's own, and the
 * registration's early one) and an internal address (loopback, cloud metadata,
 * private, the Azure host-platform endpoint) when the read connects.
 *
 *  - a registration, with and without the sign-out switch, is refused on the
 *    member naming the host, and nothing connects to the internal address;
 *  - an update turning the sign-out switch on is refused the same way;
 *  - a sign-in's callback reads (the token endpoint) are refused the same way;
 *  - CONTROL: a host whose address is public when the read connects registers,
 *    its document read over the guard's own connection;
 *  - CONTROL: an origin the deployment's configured trusted origins list is
 *    read as it always was.
 *
 * Then the scope itself: what the wrapper over the global fetch judges.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import dnsPromises from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEgressGuard, type EgressGuard, type EgressResolver } from '@objectstack/core/egress';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import {
  createSsoDiscoveryEgressGuard,
  declareSsoDiscoveryReads,
  runInSsoDiscoveryEgressScope,
} from './sso-discovery-egress';
// better-auth's first module load is paid at module load, not inside the first
// clocked case (AGENTS.md, Build & Test). `AuthManager` reaches these through a
// lazy `await import()`.
import 'better-auth';
import 'better-auth/plugins';
import '@better-auth/sso';

const SECRET = 'test-secret-at-least-32-chars-long-connect-time';
const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const FAILED = `${BASE}/sign-in-failed`;
const CLIENT_SECRET = 'client-secret';

/** An address no non-public range holds: what every check before a read is answered. */
const PUBLIC_ADDRESS = '93.184.215.14';

/** Each internal address a read may find at connect time, and the class the guard refuses it as. */
const INTERNAL: ReadonlyArray<readonly [address: string, denyClass: string]> = [
  ['127.0.0.1', 'loopback'],
  ['169.254.169.254', 'link-local'],
  ['10.0.0.5', 'private'],
  ['168.63.129.16', 'metadata'],
];

// ── The receiver: where a connection to 127.0.0.1 would land ───────────────

let receiver: Server;
let port: number;
const received: string[] = [];

beforeAll(async () => {
  receiver = createServer((req, res) => {
    received.push(`${req.headers.host} ${req.url}`);
    const host = String(req.headers.host);
    if (req.url === '/.well-known/openid-configuration') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(discoveryDocument(`http://${host}`)));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  port = (receiver.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
});

/** The identity provider whose name answers otherwise at connect time. */
const flipIssuer = () => `http://idp.flip-corp.example:${port}`;
const FLIP_HOST = 'idp.flip-corp.example';
/** The identity provider whose name answers the stand-in public host. */
const stableIssuer = () => `http://idp.stable-corp.example:${port}`;
const STABLE_HOST = 'idp.stable-corp.example';

function discoveryDocument(issuer: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    ...extra,
  };
}

// ── Name resolution and the ordinary transport ─────────────────────────────

/**
 * The checks' name resolution: `node:dns/promises` `lookup`, which the
 * vendor's own pre-read check calls, answers {@link PUBLIC_ADDRESS} for the
 * identity provider's names and ENOTFOUND for every other. Published to ES
 * importers, as `sso-discovery-companion-origins.test.ts` does.
 */
function stubCheckResolution(): () => void {
  const exportsObject = dnsPromises as unknown as { lookup: typeof dnsPromises.lookup };
  const original = exportsObject.lookup;
  exportsObject.lookup = (async (name: string) => {
    if (name === FLIP_HOST || name === STABLE_HOST) return [{ address: PUBLIC_ADDRESS, family: 4 }];
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: 'ENOTFOUND', hostname: name });
  }) as unknown as typeof dnsPromises.lookup;
  syncBuiltinESMExports();
  return () => {
    exportsObject.lookup = original;
    syncBuiltinESMExports();
  };
}

/** The guard's name resolution: each call for `hostname` answers the next of `answers` (the last repeats). */
function guardResolution(hostname: string, answers: readonly string[]): { resolve: EgressResolver; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    resolve: async (name) => {
      if (name !== hostname) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
      const address = answers[Math.min(asked.length, answers.length - 1)]!;
      asked.push(name);
      return [{ address }];
    },
  };
}

/**
 * The platform's ordinary transport, as the global fetch: a request to the
 * identity provider resolves its name again when it connects (`connectAddress`),
 * is recorded with that address, and is answered as the identity provider
 * answers. Every other request goes to the fetch underneath.
 */
function ordinaryTransport(connectAddress: string): { connected: Array<{ url: string; address: string }> } {
  const connected: Array<{ url: string; address: string }> = [];
  const underlying = globalThis.fetch;
  const transport = (async (input: unknown, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const url = new URL(href);
    if (url.hostname !== FLIP_HOST) return underlying(input as never, init);
    connected.push({ url: url.href, address: connectAddress });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(discoveryDocument(url.origin, { end_session_endpoint: `${url.origin}/logout` }));
    }
    if (url.pathname === '/token') return json({ access_token: 'at-opaque', token_type: 'Bearer', expires_in: 300, id_token: 'not-a-token' });
    if (url.pathname === '/jwks') return json({ keys: [] });
    return json({ sub: 'subject' });
  }) as typeof globalThis.fetch;
  vi.stubGlobal('fetch', transport);
  return { connected };
}

// ── The relying party ───────────────────────────────────────────────────────

interface Rp {
  manager: AuthManager;
  engine: ReturnType<typeof createMemoryEngine>;
  token: string;
  ctx: any;
}

async function makeRp(guard: EgressGuard, trustedOrigins: string[] = [BASE]): Promise<Rp> {
  const engine = createMemoryEngine();
  (engine as any).resolveSecretField = async () => CLIENT_SECRET;
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine,
    trustedOrigins,
    plugins: { sso: true },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    ssoDiscoveryEgress: guard,
  } as unknown as ConstructorParameters<typeof AuthManager>[0]);
  vi.spyOn(manager as any, 'isPlatformAdminUserId').mockResolvedValue(true);
  const ctx = await ((await manager.getAuthInstance()) as any).$context;
  const user = await ctx.adapter.create({
    model: 'user',
    data: { email: 'admin@acme.com', name: 'Admin', emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  });
  const token = (await ctx.internalAdapter.createSession(user.id)).token as string;
  return { manager, engine, token, ctx };
}

function post(rp: Rp, path: string, body: Record<string, unknown>): Promise<Response> {
  return rp.manager.handleRequest(
    new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, authorization: `Bearer ${rp.token}` },
      body: JSON.stringify(body),
    }),
  );
}

function registration(providerId: string, issuer: string, oidcConfig: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerId,
    issuer,
    domain: 'acme.com',
    oidcConfig: {
      clientId: 'client-id',
      clientSecret: CLIENT_SECRET,
      scopes: ['openid', 'email', 'profile'],
      mapping: { email: 'email', name: 'name' },
      ...oidcConfig,
    },
  };
}

function storedRows(rp: Rp): Array<Record<string, unknown>> {
  return (rp.engine.tables.get('sys_sso_provider') ?? []) as Array<Record<string, unknown>>;
}

/** The real guard over the resolution double; its refusals, with their class, recorded. */
async function realGuard(resolve: EgressResolver): Promise<{ guard: EgressGuard; refusals: Array<Record<string, unknown>> }> {
  const refusals: Array<Record<string, unknown>> = [];
  const guard = await createSsoDiscoveryEgressGuard({
    resolve,
    logger: { warn: (_msg, meta) => refusals.push(meta ?? {}) },
  });
  return { guard, refusals };
}

let undo: Array<() => void> = [];
beforeEach(() => {
  received.length = 0;
  undo.push(stubCheckResolution());
});
afterEach(() => {
  for (const step of undo.reverse()) step();
  undo = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SSO discovery connects only to addresses that are public at connect time', () => {
  it.each(INTERNAL)(
    'a registration whose discovery host answers %s when the read connects is refused on issuer, and nothing connects to it',
    async (address, denyClass) => {
      const transport = ordinaryTransport(address);
      const names = guardResolution(FLIP_HOST, [PUBLIC_ADDRESS, address]);
      const { guard, refusals } = await realGuard(names.resolve);
      const rp = await makeRp(guard);
      const res = await post(rp, '/sso/register', registration('flip-oidc', flipIssuer()));
      const text = await res.clone().text();
      expect(res.status, text).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'issuer' });
      expect(text).not.toContain(address);
      expect(transport.connected).toEqual([]);
      expect(received).toEqual([]);
      expect(refusals).toEqual([expect.objectContaining({ hostname: FLIP_HOST, denyClass, source: 'sso-discovery' })]);
      expect(storedRows(rp)).toEqual([]);
    },
  );

  it.each(INTERNAL)(
    'with the sign-out switch on, a registration whose discovery host answers %s when its first read connects is refused on issuer, and nothing connects to it',
    async (address, denyClass) => {
      const transport = ordinaryTransport(address);
      const names = guardResolution(FLIP_HOST, [PUBLIC_ADDRESS, address]);
      const { guard, refusals } = await realGuard(names.resolve);
      const rp = await makeRp(guard);
      const res = await post(rp, '/sso/register', { ...registration('flip-oidc', flipIssuer()), signOutOfIdp: true });
      const text = await res.clone().text();
      expect(res.status, text).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'issuer' });
      expect(text).not.toContain(address);
      expect(transport.connected).toEqual([]);
      expect(received).toEqual([]);
      expect(refusals).toEqual([expect.objectContaining({ hostname: FLIP_HOST, denyClass })]);
      expect(storedRows(rp)).toEqual([]);
    },
  );

  it('an update turning the sign-out switch on is refused when the discovery host answers an internal address as its read connects', async () => {
    const transport = ordinaryTransport('168.63.129.16');
    const names = guardResolution(FLIP_HOST, ['168.63.129.16']);
    const { guard, refusals } = await realGuard(names.resolve);
    const rp = await makeRp(guard);
    // Registered with its endpoints named and discovery skipped: that reads nothing.
    const issuer = flipIssuer();
    const registered = await post(
      rp,
      '/sso/register',
      registration('flip-oidc', issuer, {
        skipDiscovery: true,
        authorizationEndpoint: `${issuer}/authorize`,
        tokenEndpoint: `${issuer}/token`,
        jwksEndpoint: `${issuer}/jwks`,
      }),
    );
    expect(registered.status, await registered.clone().text()).toBe(200);
    expect(transport.connected).toEqual([]);
    const before = JSON.stringify(storedRows(rp));
    const res = await post(rp, '/sso/update-provider', { providerId: 'flip-oidc', issuer, signOutOfIdp: true });
    const text = await res.clone().text();
    expect(res.status, text).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'signOutOfIdp' });
    expect(text).not.toContain('168.63.129.16');
    expect(transport.connected).toEqual([]);
    expect(refusals).toEqual([expect.objectContaining({ hostname: FLIP_HOST, denyClass: 'metadata' })]);
    expect(JSON.stringify(storedRows(rp))).toBe(before);
  });

  it.each(INTERNAL)(
    'a sign-in whose token endpoint answers %s when the callback\'s read connects is refused, and nothing connects to it',
    async (address, denyClass) => {
      const transport = ordinaryTransport(address);
      const names = guardResolution(FLIP_HOST, [address]);
      const { guard, refusals } = await realGuard(names.resolve);
      const rp = await makeRp(guard);
      const issuer = flipIssuer();
      await rp.ctx.adapter.create({
        model: 'ssoProvider',
        data: {
          providerId: 'flip-oidc',
          issuer,
          domain: 'acme.com',
          oidcConfig: JSON.stringify({
            issuer,
            clientId: 'client-id',
            clientSecret: CLIENT_SECRET,
            authorizationEndpoint: `${issuer}/authorize`,
            tokenEndpoint: `${issuer}/token`,
            jwksEndpoint: `${issuer}/jwks`,
            pkce: true,
            scopes: ['openid', 'email', 'profile'],
            mapping: { id: 'sub', email: 'email', name: 'name' },
          }),
        },
      });
      const start = await rp.manager.handleRequest(
        new Request(`${AUTH}/sign-in/sso`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: BASE },
          body: JSON.stringify({ providerId: 'flip-oidc', callbackURL: `${BASE}/after`, errorCallbackURL: FAILED }),
        }),
      );
      const started: any = await start.clone().json();
      expect(start.status, JSON.stringify(started)).toBe(200);
      const state = new URL(started.url).searchParams.get('state')!;
      const cookie = (start.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
      const callback = await rp.manager.handleRequest(
        new Request(`${AUTH}/sso/callback/flip-oidc?code=idp-code&state=${encodeURIComponent(state)}`, { headers: { cookie } }),
      );
      expect(callback.status).toBe(302);
      const location = callback.headers.get('location') ?? '';
      expect(location).toContain('error=invalid_provider');
      expect(location).not.toContain(address);
      expect(transport.connected).toEqual([]);
      expect(received).toEqual([]);
      expect(refusals).toEqual([expect.objectContaining({ hostname: FLIP_HOST, denyClass })]);
    },
  );

  it('CONTROL: a host whose address is public when the read connects registers, its document read over the guard\'s own connection', async () => {
    const transport = ordinaryTransport('10.0.0.5');
    // The stand-in public host: 127.0.0.1, where the receiver serves the
    // identity provider; every other address is judged by the real policy.
    const { guard: real } = await realGuard(async () => [{ address: '127.0.0.1' }]);
    const guard = createEgressGuard({
      policy: {
        canConnect: (target, ctx) => (target.address === '127.0.0.1' ? { allow: true } : real.policy.canConnect(target, ctx)),
      },
      resolve: async (name) => {
        if (name !== STABLE_HOST) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
        return [{ address: '127.0.0.1' }];
      },
    });
    const rp = await makeRp(guard);
    const res = await post(rp, '/sso/register', registration('stable-oidc', stableIssuer()));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(received).toEqual([`${STABLE_HOST}:${port} /.well-known/openid-configuration`]);
    expect(transport.connected).toEqual([]);
    expect(storedRows(rp)).toHaveLength(1);
  });

  it('CONTROL: an origin the deployment\'s configured trusted origins list is read as it always was, whatever it answers at connect time', async () => {
    const transport = ordinaryTransport('10.0.0.5');
    const names = guardResolution(FLIP_HOST, [PUBLIC_ADDRESS, '10.0.0.5']);
    const { guard, refusals } = await realGuard(names.resolve);
    const rp = await makeRp(guard, [BASE, flipIssuer()]);
    const res = await post(rp, '/sso/register', { ...registration('flip-oidc', flipIssuer()), signOutOfIdp: true });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(transport.connected.map((c) => new URL(c.url).pathname)).toEqual([
      '/.well-known/openid-configuration',
      '/.well-known/openid-configuration',
    ]);
    expect(names.asked).toEqual([]);
    expect(refusals).toEqual([]);
  });
});

describe('the SSO discovery scope judges only the reads it names', () => {
  /** A guard that answers every read itself, recording it. */
  function recordingGuard(): { guard: EgressGuard; sent: string[] } {
    const sent: string[] = [];
    return {
      sent,
      guard: {
        policy: { canConnect: () => ({ allow: true }) },
        ready: async () => undefined,
        describe: () => 'recording guard (tests)',
        judgeUrl: async () => ({ allow: true }),
        fetch: async (url) => {
          sent.push(url);
          return new Response('through the guard') as unknown as Response;
        },
      },
    };
  }

  function ordinaryFetch(): string[] {
    const sent: string[] = [];
    vi.stubGlobal('fetch', (async (input: unknown) => {
      sent.push(typeof input === 'string' ? input : (input as URL).href);
      return new Response('ordinary');
    }) as typeof globalThis.fetch);
    return sent;
  }

  it('until the request names its origins, every read is judged; then only reads of those, and never one the configured trust lists', async () => {
    const ordinary = ordinaryFetch();
    const { guard, sent } = recordingGuard();
    await runInSsoDiscoveryEgressScope(guard, async () => {
      await fetch('https://db.internal.example/v2/pipeline');
      declareSsoDiscoveryReads(['https://idp.acme.example/.well-known/openid-configuration', 'https://trusted.acme.example'], (url) =>
        url.startsWith('https://trusted.acme.example'),
      );
      await fetch('https://idp.acme.example/token', { method: 'POST', body: 'grant_type=authorization_code' });
      await fetch('https://db.internal.example/v2/pipeline');
      await fetch('https://trusted.acme.example/.well-known/openid-configuration');
      return undefined;
    });
    expect(sent).toEqual(['https://db.internal.example/v2/pipeline', 'https://idp.acme.example/token']);
    expect(ordinary).toEqual(['https://db.internal.example/v2/pipeline', 'https://trusted.acme.example/.well-known/openid-configuration']);
  });

  it('outside a scope, the global fetch is the fetch it was', async () => {
    const ordinary = ordinaryFetch();
    const { guard, sent } = recordingGuard();
    await runInSsoDiscoveryEgressScope(guard, async () => undefined, { targets: 'every' });
    await fetch('https://idp.acme.example/.well-known/openid-configuration');
    expect(sent).toEqual([]);
    expect(ordinary).toEqual(['https://idp.acme.example/.well-known/openid-configuration']);
  });
});
