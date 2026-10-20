// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24877] Every in-process bridge judges the request it re-dispatches by the
// platform's client-address trust rule (ADR-0069 D5/D7, `./client-address.ts`):
//
//   - forwarded headers count only when the deployment declares
//     `server.trustProxy` (`AuthManagerOptions.trustProxy`);
//   - otherwise the address is the transport's peer (`IHttpRequest.remoteAddress`).
//
// `AuthManager.handleRequest` establishes that address from the request AND the
// transport it is handed, so a bridge has to hand over the transport of the
// request it serves, as the catch-all does (`transportOf(c)` in
// `auth-plugin.ts`). One pin per bridge, each stating the rule for its route.
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
// `c.env.incoming`. No trusted proxy is declared. Every request also carries
// forwarded headers and the platform-owned header naming another address, set
// by the caller: none of them may decide the address. Nothing reaches the
// network: every re-dispatch below is answered by the vendor's own refusal
// before any discovery or DNS work.
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

/** Documentation ranges (RFC 5737): the connection peer, and what the caller's headers claim. */
const PEER = '203.0.113.7';
const CLAIMED = '198.51.100.9';

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
  /** A session of the member's own, minted for the revoke bridge alone. */
  revokeBearer: string;
  revokeSessionId: string;
  /** Every request the library's handler was handed, in order. */
  handed: Handed[];
}

async function stage(): Promise<Stage> {
  const engine = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { admin: true, sso: true, ssoDomainVerification: true },
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
  const before = memberSessions().length;
  const revokeBearer = await bearerFor(MEMBER_EMAIL);
  const minted = memberSessions().slice(before);
  expect(minted, 'the revoke bridge’s own session').toHaveLength(1);
  const revokeSessionId = String(minted[0].id);

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

  return { app, adminBearer, memberBearer, revokeBearer, revokeSessionId, handed };
}

/** A bridge: its mount, the vendor route it re-dispatches to, and a request that gets that far. */
interface Bridge {
  route: string;
  inner: string;
  request: (s: Stage) => { bearer?: string; body: unknown };
}

const BRIDGES: Bridge[] = [
  // Gate-then-delegate: the request itself is handed on.
  {
    route: 'POST /admin/remove-user',
    inner: '/admin/remove-user',
    request: (s) => ({ bearer: s.adminBearer, body: { userId: 'usr_pin_24877_no_such_user' } }),
  },
  {
    route: 'POST /admin/has-permission',
    inner: '/admin/has-permission',
    // Anonymous: the delegate lane.
    request: () => ({ body: { permissions: { user: ['list'] } } }),
  },
  // Reshape-and-re-dispatch helpers (`register-sso-provider.ts`).
  {
    route: 'POST /admin/sso/register',
    inner: '/sso/register',
    request: (s) => ({
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
    request: (s) => ({
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
    request: (s) => ({ bearer: s.adminBearer, body: { providerId: UNKNOWN_PROVIDER_ID } }),
  },
  {
    route: 'POST /admin/sso/verify-domain',
    inner: '/sso/verify-domain',
    request: (s) => ({ bearer: s.adminBearer, body: { providerId: UNKNOWN_PROVIDER_ID } }),
  },
  // The one-click resend (`send-verification-email.ts`): a session read, then the send.
  {
    route: 'POST /send-verification-email',
    inner: '/send-verification-email',
    request: (s) => ({ bearer: s.memberBearer, body: {} }),
  },
  // The owner lane of the session revoke (`sys-session-revoke.ts`).
  {
    route: 'POST /sys-session/revoke',
    inner: '/revoke-session',
    request: (s) => ({ bearer: s.revokeBearer, body: { [SYS_SESSION_REVOKE_ID_PARAM]: s.revokeSessionId } }),
  },
];

let s: Stage;

beforeAll(async () => {
  s = await stage();
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Serve `route` (`METHOD /path`) from the connection peer, with the caller's headers naming another address. */
async function through(route: string, { bearer, body }: { bearer?: string; body?: unknown }): Promise<Handed[]> {
  const [method, path] = route.split(' ') as [string, string];
  s.handed.length = 0;
  const res = await s.app.request(
    `${ORIGIN}${BASE}${path}`,
    {
      method,
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        'x-forwarded-for': CLAIMED,
        'x-real-ip': CLAIMED,
        [VENDOR_CLIENT_ADDRESS_HEADER]: CLAIMED,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { incoming: { socket: { remoteAddress: PEER } } },
  );
  await res.arrayBuffer();
  return [...s.handed];
}

describe('[#24877] every in-process bridge judges what it re-dispatches on the connection peer when no trusted proxy is declared', () => {
  it('control — a request through the catch-all is judged on its connection peer', async () => {
    const handed = await through('GET /get-session', { bearer: s.memberBearer });
    expect(handed.map((h) => h.path)).toEqual([`${BASE}/get-session`]);
    expect(handed.map((h) => h.address)).toEqual([PEER]);
  });

  for (const bridge of BRIDGES) {
    it(`a request through ${bridge.route} is judged on its connection peer when no trusted proxy is declared`, async () => {
      const handed = await through(bridge.route, bridge.request(s));
      expect(handed.map((h) => h.path), 'the bridge re-dispatched to its vendor route').toContain(
        `${BASE}${bridge.inner}`,
      );
      expect(handed.map((h) => h.address)).toEqual(handed.map(() => PEER));
    });
  }
});
