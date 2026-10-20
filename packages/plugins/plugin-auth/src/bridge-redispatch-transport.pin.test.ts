// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24877] Every in-process bridge judges the request it re-dispatches by the
// platform's client-address trust rule (ADR-0069 D5/D7, `./client-address.ts`),
// on the same facts as the request it serves:
//
//   - forwarded headers (`FORWARDED_CLIENT_ADDRESS_HEADERS`) count only when the
//     deployment declares `server.trustProxy` (`AuthManagerOptions.trustProxy`);
//   - otherwise the address is the transport's peer (`IHttpRequest.remoteAddress`).
//
// `AuthManager.handleRequest` establishes that address from the request AND the
// transport it is handed. So a bridge hands over the transport of the request it
// serves, as the catch-all does (`transportOf(c)` in `auth-plugin.ts`), and a
// bridge whose helper builds the re-dispatched request carries the incoming
// request's forwarding headers onto it. One pin per bridge on each branch of the
// rule, each stating the rule for its route.
//
// What is read is the one channel the server's decision reaches the vendored
// library through: the platform-owned header `handleRequest` writes on every
// request it hands the library's handler (`client-address-vendor.ts`). Every
// request a bridge re-dispatches during one call is read, and the bridge's own
// inner route has to be among them, so a bridge that never reached the library
// cannot pass vacuously.
//
// The fixture is the D5/D7 suites' (`client-address-vendor-trust-rule.test.ts`):
// `AuthPlugin.registerAuthRoutes` mounted on a real Hono app in front of a real
// `AuthManager` on the installed better-auth, with the transport peer supplied
// the way `@hono/node-server` supplies it, as the Node request on
// `c.env.incoming`. Two deployments: one declaring no trusted proxy, one
// declaring `trustProxy`. Every request also carries the platform-owned header
// naming another address, set by the caller, and it may decide nothing on either
// branch. Nothing reaches the network: every re-dispatch below is answered by
// the vendor's own refusal before any discovery or DNS work.
//
// The library's handler is observed through a plain instance wrapper, not
// `vi.spyOn`: the imported `impersonation-bearer-rotation.test` registers
// `afterEach(restoreAllMocks)` in this file too, which would strip a spy after
// the first case.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { VENDOR_CLIENT_ADDRESS_HEADER } from './client-address-vendor';
import { SYS_SESSION_REVOKE_ID_PARAM } from './sys-session-revoke';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-24877';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const ADMIN_EMAIL = 'admin.24877@example.com';
const MEMBER_EMAIL = 'member.24877@example.com';

/** Documentation ranges (RFC 5737). No trusted proxy: the connection peer, and what the caller's headers claim. */
const PEER = '203.0.113.7';
const CLAIMED = '198.51.100.9';
/** A declared trusted proxy: the forwarded client address, and the proxy hop that is the connection peer. */
const FORWARDED_CLIENT = '192.0.2.44';
const PROXY_HOP = '10.0.0.2';

/** `@better-auth/sso` reserves this id, and refuses it before any discovery or endpoint validation. */
const RESERVED_PROVIDER_ID = 'credential';
const UNKNOWN_PROVIDER_ID = 'pin-24877-no-such-provider';

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as any;

/** One request the vendored library's handler was handed: its path, and the client address it carried. */
interface Handed {
  path: string;
  address: string | null;
}

interface Stage {
  app: Hono;
  adminBearer: string;
  memberBearer: string;
  /** A fresh session of the member's own: the revoke bridge's owner lane ends the one it names. */
  revokeTarget(): Promise<{ bearer: string; sessionId: string }>;
  /** Every request the library's handler was handed, in order. */
  handed: Handed[];
}

async function stage(deployment: { trustProxy?: boolean }): Promise<Stage> {
  const engine = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { admin: true, sso: true, ssoDomainVerification: true },
    ...deployment,
  } as any);

  const direct = (path: string, body: unknown) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify(body),
      }),
    );

  for (const [email, name] of [
    [ADMIN_EMAIL, 'Platform Admin'],
    [MEMBER_EMAIL, 'Plain Member'],
  ]) {
    await inviteForAudienceGate(manager, email);
    const res = await direct('/sign-up/email', { email, password: PASSWORD, name });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
  }
  const users = (engine.tables.get('sys_user') ?? []) as any[];
  // The legacy scalar `isPlatformAdminUser` accepts — `gateAdmin` admits.
  users.find((r) => r.email === ADMIN_EMAIL)!.role = 'admin';
  const memberId = String(users.find((r) => r.email === MEMBER_EMAIL)!.id);

  const bearerFor = async (email: string) => {
    const res = await direct('/sign-in/email', { email, password: PASSWORD });
    const token = res.headers.get('set-auth-token');
    expect(token, `sign-in ${email}: ${await res.clone().text()}`).toBeTruthy();
    return token!;
  };
  const adminBearer = await bearerFor(ADMIN_EMAIL);
  const memberBearer = await bearerFor(MEMBER_EMAIL);
  const memberSessions = () =>
    ((engine.tables.get('sys_session') ?? []) as any[]).filter((r) => String(r.user_id) === memberId);
  const revokeTarget = async () => {
    const before = memberSessions().length;
    const bearer = await bearerFor(MEMBER_EMAIL);
    const minted = memberSessions().slice(before);
    expect(minted, 'the revoke bridge’s own session').toHaveLength(1);
    return { bearer, sessionId: String(minted[0].id) };
  };

  const auth = await (manager as any).getOrCreateAuth();
  const handler = auth.handler;
  const handed: Handed[] = [];
  auth.handler = async (request: Request) => {
    handed.push({ path: new URL(request.url).pathname, address: request.headers.get(VENDOR_CLIENT_ADDRESS_HEADER) });
    return handler(request);
  };

  // The REAL route registration — raw mounts ahead of the catch-all.
  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  return { app, adminBearer, memberBearer, revokeTarget, handed };
}

/** A bridge: its mount, the vendor route it re-dispatches to, and a request that gets that far. */
interface Bridge {
  route: string;
  inner: string;
  request: (s: Stage) => Promise<{ bearer?: string; body: unknown }>;
}

const BRIDGES: Bridge[] = [
  // Gate-then-delegate: the request itself is handed on.
  {
    route: 'POST /admin/remove-user',
    inner: '/admin/remove-user',
    request: async (s) => ({ bearer: s.adminBearer, body: { userId: 'usr_pin_24877_no_such_user' } }),
  },
  {
    route: 'POST /admin/has-permission',
    inner: '/admin/has-permission',
    // Anonymous: the delegate lane.
    request: async () => ({ body: { permissions: { user: ['list'] } } }),
  },
  // Reshape-and-re-dispatch helpers (`register-sso-provider.ts`).
  {
    route: 'POST /admin/sso/register',
    inner: '/sso/register',
    request: async (s) => ({
      bearer: s.adminBearer,
      body: {
        providerId: RESERVED_PROVIDER_ID,
        issuer: 'https://idp.pin-24877.example.com',
        domain: 'pin-24877.example.com',
        clientId: 'pin-24877-client',
        clientSecret: 'pin-24877-secret',
      },
    }),
  },
  {
    route: 'POST /admin/sso/register-saml',
    inner: '/sso/register',
    request: async (s) => ({
      bearer: s.adminBearer,
      body: {
        providerId: RESERVED_PROVIDER_ID,
        issuer: 'https://idp.pin-24877.example.com',
        domain: 'pin-24877.example.com',
        entryPoint: 'https://idp.pin-24877.example.com/sso',
        cert: 'pin-24877-cert',
      },
    }),
  },
  {
    route: 'POST /admin/sso/request-domain-verification',
    inner: '/sso/request-domain-verification',
    request: async (s) => ({ bearer: s.adminBearer, body: { providerId: UNKNOWN_PROVIDER_ID } }),
  },
  {
    route: 'POST /admin/sso/verify-domain',
    inner: '/sso/verify-domain',
    request: async (s) => ({ bearer: s.adminBearer, body: { providerId: UNKNOWN_PROVIDER_ID } }),
  },
  // The one-click resend (`send-verification-email.ts`): a session read, then the send.
  {
    route: 'POST /send-verification-email',
    inner: '/send-verification-email',
    request: async (s) => ({ bearer: s.memberBearer, body: {} }),
  },
  // The owner lane of the session revoke (`sys-session-revoke.ts`).
  {
    route: 'POST /sys-session/revoke',
    inner: '/revoke-session',
    request: async (s) => {
      const target = await s.revokeTarget();
      return { bearer: target.bearer, body: { [SYS_SESSION_REVOKE_ID_PARAM]: target.sessionId } };
    },
  },
];

let untrusted: Stage;
let trusted: Stage;

beforeAll(async () => {
  untrusted = await stage({});
  trusted = await stage({ trustProxy: true });
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Serve `route` (`METHOD /path`) on stage `s` from connection peer `peer`, with
 * the caller's `forwarding` headers and the platform-owned header naming
 * another address; answer with every request the library's handler was handed.
 */
async function through(
  s: Stage,
  route: string,
  peer: string,
  forwarding: Record<string, string>,
  { bearer, body }: { bearer?: string; body?: unknown },
): Promise<Handed[]> {
  const [method, path] = route.split(' ') as [string, string];
  s.handed.length = 0;
  const res = await s.app.request(
    `${ORIGIN}${BASE}${path}`,
    {
      method,
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        ...forwarding,
        [VENDOR_CLIENT_ADDRESS_HEADER]: CLAIMED,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { incoming: { socket: { remoteAddress: peer } } },
  );
  await res.arrayBuffer();
  return [...s.handed];
}

/** What a caller sends with no trusted proxy declared: forwarding headers naming another address. */
const CLAIMED_FORWARDING: Record<string, string> = { 'x-forwarded-for': CLAIMED, 'x-real-ip': CLAIMED };
/** What a declared trusted proxy forwards, in each of the two spellings the rule reads. */
const PROXY_FORWARDING: Record<string, string>[] = [
  { 'x-forwarded-for': `${FORWARDED_CLIENT}, ${PROXY_HOP}` },
  { 'x-real-ip': FORWARDED_CLIENT },
];

describe('[#24877] every in-process bridge judges what it re-dispatches on the connection peer when no trusted proxy is declared', () => {
  it('control — a request through the catch-all is judged on its connection peer', async () => {
    const handed = await through(untrusted, 'GET /get-session', PEER, CLAIMED_FORWARDING, {
      bearer: untrusted.memberBearer,
    });
    expect(handed.map((h) => h.path)).toEqual([`${BASE}/get-session`]);
    expect(handed.map((h) => h.address)).toEqual([PEER]);
  });

  for (const bridge of BRIDGES) {
    it(`a request through ${bridge.route} is judged on its connection peer when no trusted proxy is declared`, async () => {
      const handed = await through(untrusted, bridge.route, PEER, CLAIMED_FORWARDING, await bridge.request(untrusted));
      expect(handed.map((h) => h.path), 'the bridge re-dispatched to its vendor route').toContain(
        `${BASE}${bridge.inner}`,
      );
      expect(handed.map((h) => h.address)).toEqual(handed.map(() => PEER));
    });
  }
});

describe('[#24877] every in-process bridge judges what it re-dispatches on the forwarded client address when a trusted proxy is declared', () => {
  it('control — a request through the catch-all is judged on the forwarded client address', async () => {
    for (const forwarding of PROXY_FORWARDING) {
      const handed = await through(trusted, 'GET /get-session', PROXY_HOP, forwarding, {
        bearer: trusted.memberBearer,
      });
      expect(handed.map((h) => h.path), JSON.stringify(forwarding)).toEqual([`${BASE}/get-session`]);
      expect(handed.map((h) => h.address), JSON.stringify(forwarding)).toEqual([FORWARDED_CLIENT]);
    }
  });

  for (const bridge of BRIDGES) {
    it(`a request through ${bridge.route} is judged on the forwarded client address when a trusted proxy is declared`, async () => {
      for (const forwarding of PROXY_FORWARDING) {
        const handed = await through(trusted, bridge.route, PROXY_HOP, forwarding, await bridge.request(trusted));
        expect(handed.map((h) => h.path), `the bridge re-dispatched to its vendor route (${JSON.stringify(forwarding)})`).toContain(
          `${BASE}${bridge.inner}`,
        );
        expect(handed.map((h) => h.address), JSON.stringify(forwarding)).toEqual(handed.map(() => FORWARDED_CLIENT));
      }
    });
  }
});
