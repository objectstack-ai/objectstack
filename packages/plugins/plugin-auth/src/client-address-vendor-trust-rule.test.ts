// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The vendored auth library's OWN client-address source follows the
// platform's client-address trust rule (`./client-address.ts`), the rule the
// ADR-0069 D5 allow-list judges with and the D7 login audit stamps by:
//
//   - forwarded headers count only when the deployment declares
//     `server.trustProxy` (`AuthManagerOptions.trustProxy`);
//   - otherwise the address is the transport's peer (`IHttpRequest.remoteAddress`);
//   - neither available ⇒ the library is handed NO address.
//
// One pin per branch. Each reads, off one composition, the three things the
// library keys on a client address (`client-address-vendor.ts`): the session
// row's `ip_address`, the refused-sign-in audit fingerprint, and the key its
// per-address rate limiter consumes. The fixture is the D5/D7 suite's
// (`client-ip-allow-list-trust-rule.test.ts`): `AuthPlugin.registerAuthRoutes`
// mounted on a real Hono app in front of a real `AuthManager` on the installed
// better-auth, with the transport peer supplied the way `@hono/node-server`
// supplies it, as the Node request on `c.env.incoming`.
//
// Every request also carries the platform-owned header itself, set by the
// caller: in no branch may a caller's copy reach the library.
//
// ADR-0112 is `code` AND `status`; the refused sign-in asserts both, so a
// refusal from anywhere but the credential check cannot stand in for it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { VENDOR_CLIENT_ADDRESS_HEADER } from './client-address-vendor';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-24799';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const EMAIL = 'member.24799@example.com';

/** Documentation ranges (RFC 5737), and one private proxy hop. */
const CLIENT = '203.0.113.7';
const OTHER = '198.51.100.9';
const PROXY_HOP = '10.0.0.2';

/** The credential check's own refusal (ADR-0112 `code` + `status`). */
const CREDENTIAL_REFUSAL = { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' };

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

async function verdict(res: Response): Promise<{ status: number; code?: string }> {
  const text = await res.text();
  let code: string | undefined;
  try {
    const parsed = JSON.parse(text);
    code = parsed?.error?.code ?? parsed?.code;
  } catch {
    /* non-JSON body → no code */
  }
  return { status: res.status, code };
}

/** What the library keyed on one client address, per seam. */
interface Observed {
  /** `sys_session.ip_address` of the session the successful sign-in minted. */
  session: unknown;
  /** The `login_failed` audit event's address, for the refused sign-in. */
  refused: unknown;
  /** The address half of every rate-limit key consumed across both sign-ins. */
  limiterKeys: string[];
  /** ADR-0069 D7 `last_login_ip` after the successful sign-in. */
  lastLoginIp: unknown;
}

/** One deployment, served through the REAL mount chain. */
async function serve(deployment: { trustProxy?: boolean }) {
  const engine = createMemoryEngine();
  const events: Array<{ action: string; ipAddress?: string }> = [];
  const consumedKeys: string[] = [];
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    getAuditSink: () => ({
      recordAuthEvent: async (event: { action: string; ipAddress?: string }) => {
        events.push(event);
      },
    }),
    // The library's limiter is on by default only in production; switch it on
    // and record every key it consumes, admitting every request.
    rateLimit: { enabled: true },
    rateLimitStorage: {
      consume: async (key: string) => {
        consumedKeys.push(key);
        return { allowed: true, retryAfter: null };
      },
    },
    ...deployment,
  } as any);

  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  const app = new Hono();
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const signIn = (peer: string | undefined, headers: Record<string, string>, password: string) =>
    app.request(
      `${ORIGIN}${BASE}/sign-in/email`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
        body: JSON.stringify({ email: EMAIL, password }),
      },
      peer ? { incoming: { socket: { remoteAddress: peer } } } : {},
    );

  await inviteForAudienceGate(manager, EMAIL);
  const signUp = await manager.handleRequest(
    new Request(`${ORIGIN}${BASE}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Client Address Member' }),
    }),
  );
  expect(signUp.status, `sign-up: ${await signUp.clone().text()}`).toBe(200);

  /** A refused, then a successful, sign-in from `peer` carrying `headers`. */
  const observe = async (peer: string | undefined, headers: Record<string, string>): Promise<Observed> => {
    const sessionsBefore = (engine.tables.get('sys_session') ?? []).length;
    const eventsBefore = events.length;
    const keysBefore = consumedKeys.length;

    const refusedRes = await signIn(peer, headers, `${PASSWORD}-wrong`);
    expect(await verdict(refusedRes)).toEqual(CREDENTIAL_REFUSAL);
    const okRes = await signIn(peer, headers, PASSWORD);
    expect(okRes.status, await okRes.clone().text()).toBe(200);

    const minted = ((engine.tables.get('sys_session') ?? []) as any[]).slice(sessionsBefore);
    expect(minted, 'one session minted by the successful sign-in').toHaveLength(1);
    const refused = events.slice(eventsBefore).filter((e) => e.action === 'login_failed');
    expect(refused, 'one login_failed event for the refused sign-in').toHaveLength(1);
    const limiterKeys = consumedKeys.slice(keysBefore).map((key) => key.split('|')[0]!);
    expect(limiterKeys, 'the library limiter consumed a key for each sign-in').toHaveLength(2);
    const user = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === EMAIL);

    return {
      session: minted[0]?.ip_address,
      refused: refused[0]?.ipAddress,
      limiterKeys,
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

describe('the vendored auth library keys on the client address the server established, and no other', () => {
  it('behind a declared trusted proxy, it records and keys on the forwarded client address', async () => {
    const d = await serve({ trustProxy: true });

    const seen = await d.observe(PROXY_HOP, {
      'x-forwarded-for': `${CLIENT}, ${PROXY_HOP}`,
      [VENDOR_CLIENT_ADDRESS_HEADER]: OTHER,
    });

    expect(seen.session).toBe(CLIENT);
    expect(seen.refused).toBe(CLIENT);
    expect(seen.limiterKeys).toEqual([CLIENT, CLIENT]);
    // The same address the D7 login audit stamped.
    expect(seen.lastLoginIp).toBe(CLIENT);
  });

  it('without a declared trusted proxy, it records and keys on the connection peer, whatever the request headers say', async () => {
    const d = await serve({});

    const seen = await d.observe(CLIENT, {
      'x-forwarded-for': OTHER,
      'x-real-ip': OTHER,
      [VENDOR_CLIENT_ADDRESS_HEADER]: OTHER,
    });

    expect(seen.session).toBe(CLIENT);
    expect(seen.refused).toBe(CLIENT);
    expect(seen.limiterKeys).toEqual([CLIENT, CLIENT]);
    expect(seen.lastLoginIp).toBe(CLIENT);
  });

  it('when the server established no address, it is handed none, whatever the request headers say', async () => {
    // What the library answers when it is handed no address is its own,
    // environment-dependent behaviour (nothing in production, a loopback
    // placeholder in development and test) — so each deployment's answer to a
    // request carrying no header at all is the control, never a literal.
    for (const deployment of [{}, { trustProxy: true }]) {
      const d = await serve(deployment);
      const control = await d.observe(undefined, {});
      const seen = await d.observe(undefined, {
        ...(deployment.trustProxy ? {} : { 'x-forwarded-for': OTHER, 'x-real-ip': OTHER }),
        [VENDOR_CLIENT_ADDRESS_HEADER]: OTHER,
      });

      const label = deployment.trustProxy ? 'trusted proxy, nothing forwarded' : 'no trusted proxy';
      expect(seen.session, label).toEqual(control.session);
      expect(seen.refused, label).toEqual(control.refused);
      expect(seen.limiterKeys, label).toEqual(control.limiterKeys);
      expect([seen.session, seen.refused, ...seen.limiterKeys], label).not.toContain(OTHER);
      // …and the D7 login audit stamped none either.
      expect(seen.lastLoginIp, label).toBeUndefined();
    }
  });
});
