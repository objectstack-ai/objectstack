// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// What a sign-in stores about its client, read off the session row it mints
// (Setup › Sessions prints these columns as plain text):
//
//   - `ip_address` is the address the server established for the request (the
//     client-address trust rule, `./client-address.ts`), in its RFC 5952 text
//     (`./client-address-canonical.ts`). The vendored auth library's own
//     reader stores a different text: every IPv6 address expanded and masked
//     to its /64 network, so a loopback session read
//     `0000:0000:0000:0000:0000:0000:0000:0000`.
//   - The refused sign-in's `login_failed` row and the ADR-0069 D7
//     `last_login_ip` carry that same text.
//   - (`last_activity_at` at creation needs ObjectQL's own `created_at` stamp,
//     which this engine double does not run: `session-first-activity.test.ts`.)
//
// The fixture is the client-address suites' (`client-address-vendor-trust-rule
// .test.ts`): `AuthPlugin.registerAuthRoutes` mounted on a real Hono app in
// front of a real `AuthManager` on the installed better-auth, the transport
// peer supplied the way `@hono/node-server` supplies it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-26638';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const EMAIL = 'member.26638@example.com';

const mockCtx = () =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as unknown as PluginContext;

interface Observed {
  /** The session row the successful sign-in minted. */
  session: Record<string, any>;
  /** The `login_failed` audit event's address, for the refused sign-in. */
  refused: unknown;
  /** The `login` audit event's address, for the successful sign-in. */
  login: unknown;
  /** ADR-0069 D7 `last_login_ip` after the successful sign-in. */
  lastLoginIp: unknown;
}

async function serve(deployment: { trustProxy?: boolean }) {
  const engine = createMemoryEngine();
  const events: Array<{ action: string; ipAddress?: string }> = [];
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    getAuditSink: () => ({
      recordAuthEvent: async (event: { action: string; ipAddress?: string }) => {
        events.push(event);
      },
    }),
    ...deployment,
  } as any);

  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  const app = new Hono();
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const signIn = (peer: string, headers: Record<string, string>, password: string) =>
    app.request(
      `${ORIGIN}${BASE}/sign-in/email`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
        body: JSON.stringify({ email: EMAIL, password }),
      },
      { incoming: { socket: { remoteAddress: peer } } },
    );

  await inviteForAudienceGate(manager, EMAIL);
  const signUp = await manager.handleRequest(
    new Request(`${ORIGIN}${BASE}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Session Capture Member' }),
    }),
  );
  expect(signUp.status, `sign-up: ${await signUp.clone().text()}`).toBe(200);

  /** A refused, then a successful, sign-in from `peer` carrying `headers`. */
  const observe = async (peer: string, headers: Record<string, string> = {}): Promise<Observed> => {
    const sessionsBefore = (engine.tables.get('sys_session') ?? []).length;
    const eventsBefore = events.length;

    const refusedRes = await signIn(peer, headers, `${PASSWORD}-wrong`);
    expect(refusedRes.status).toBe(401);
    const okRes = await signIn(peer, headers, PASSWORD);
    expect(okRes.status, await okRes.clone().text()).toBe(200);

    const minted = ((engine.tables.get('sys_session') ?? []) as any[]).slice(sessionsBefore);
    expect(minted, 'one session minted by the successful sign-in').toHaveLength(1);
    const seen = events.slice(eventsBefore);
    const refused = seen.filter((e) => e.action === 'login_failed');
    const login = seen.filter((e) => e.action === 'login');
    expect(refused, 'one login_failed event for the refused sign-in').toHaveLength(1);
    expect(login, 'one login event for the successful sign-in').toHaveLength(1);
    const user = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === EMAIL);

    return {
      session: minted[0],
      refused: refused[0]?.ipAddress,
      login: login[0]?.ipAddress,
      lastLoginIp: user?.last_login_ip,
    };
  };

  return { observe };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a sign-in stores its client address in RFC 5952 text, the same on every row', () => {
  it('a loopback IPv6 peer is stored as ::1, not as its expanded /64 network', async () => {
    const d = await serve({});

    const seen = await d.observe('::1');

    expect(seen.session.ip_address).toBe('::1');
    expect(seen.login).toBe('::1');
    expect(seen.refused).toBe('::1');
    expect(seen.lastLoginIp).toBe('::1');
  });

  it('a forwarded full-form IPv6 client address is stored compressed, on the session, both audit rows and last_login_ip', async () => {
    const d = await serve({ trustProxy: true });

    const seen = await d.observe('10.0.0.2', {
      'x-forwarded-for': '2001:0DB8:0000:0000:0000:0000:0000:0001, 10.0.0.2',
    });

    expect(seen.session.ip_address).toBe('2001:db8::1');
    expect(seen.login).toBe('2001:db8::1');
    expect(seen.refused).toBe('2001:db8::1');
    expect(seen.lastLoginIp).toBe('2001:db8::1');
  });

  it('an IPv4-mapped peer keeps the mixed notation of RFC 5952 §5', async () => {
    const d = await serve({});

    const seen = await d.observe('::ffff:203.0.113.7');

    expect(seen.session.ip_address).toBe('::ffff:203.0.113.7');
    expect(seen.refused).toBe('::ffff:203.0.113.7');
    expect(seen.lastLoginIp).toBe('::ffff:203.0.113.7');
  });

  it('an IPv4 peer is stored as it came', async () => {
    const d = await serve({});

    const seen = await d.observe('203.0.113.7');

    expect(seen.session.ip_address).toBe('203.0.113.7');
    expect(seen.refused).toBe('203.0.113.7');
    expect(seen.lastLoginIp).toBe('203.0.113.7');
  });
});
