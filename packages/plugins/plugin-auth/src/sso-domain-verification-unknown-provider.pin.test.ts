// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22463] With SSO domain verification ON, an unknown `providerId` is "not
 * found", never "turn the feature on".
 *
 * `@better-auth/sso` answers two different `404`s on its domain-verification
 * routes, neither with a `code`:
 *
 *   - feature OFF: the inner route is not mounted — `404`, empty body;
 *   - feature ON, unknown provider: `checkProviderAccess` —
 *     `404 {"message":"Provider not found"}`.
 *
 * The two bridges (`register-sso-provider.ts`) used to map every code-less
 * `404` to `400 DOMAIN_VERIFICATION_DISABLED` ("set OS_SSO_DOMAIN_VERIFICATION"),
 * so an admin who mistyped a provider id on an environment with the feature on
 * was told to turn on a feature that is on. The mounts now hand each bridge the
 * environment's own setting (`AuthManager.isSsoDomainVerificationEnabled()`):
 * off answers `DOMAIN_VERIFICATION_DISABLED` without asking the vendor, and on
 * reads a code-less `404` as the provider lookup missing.
 *
 * Pinned on the REAL stack: two real `AuthManager`s over the shared in-memory
 * engine (one with domain verification on, one with SSO on and domain
 * verification off), each behind the plugin's REAL route registration on a
 * real Hono app — the `in-process-session-renewal.pin.test.ts` harness. Each
 * admin is the legacy-`role` platform admin, so every request here clears
 * `gateAdmin` and the answer is the bridge's. Nothing reaches the network: no
 * request below gets as far as the vendor's DNS lookup.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { runRequestDomainVerification, runVerifyDomain } from './register-sso-provider';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-22463';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const UNKNOWN = 'pin-22463-no-such-provider';
/** The admin's own providers on the ON stack — one per door, so neither door's call changes the other's state. */
const OWN_FOR_REQUEST = 'pin-22463-own-request';
const OWN_FOR_VERIFY = 'pin-22463-own-verify';

const DOORS = [
  { label: 'POST /admin/sso/request-domain-verification', door: 'request-domain-verification', inner: '/sso/request-domain-verification' },
  { label: 'POST /admin/sso/verify-domain', door: 'verify-domain', inner: '/sso/verify-domain' },
] as const;

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

interface Stack {
  manager: AuthManager;
  app: Hono;
  bearer: string;
  /** Every request the mounts handed `AuthManager.handleRequest`, in order. */
  dispatched: Request[];
}

async function bootStack(ssoDomainVerification: boolean): Promise<Stack> {
  const engine = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { admin: true, sso: true, ssoDomainVerification },
  } as any);
  const email = `admin.22463.${ssoDomainVerification ? 'on' : 'off'}@example.com`;
  const direct = (path: string, body: unknown) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  await inviteForAudienceGate(manager, email);
  const signUp = await direct('/sign-up/email', { email, password: PASSWORD, name: 'Platform Admin' });
  expect(signUp.status, `sign-up: ${await signUp.clone().text()}`).toBe(200);
  const admin = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === email)!;
  // The legacy scalar `isPlatformAdminUser` accepts — `gateAdmin` admits.
  admin.role = 'admin';
  // Org-less and the admin's own: `checkProviderAccess` grants the registrar.
  for (const providerId of [OWN_FOR_REQUEST, OWN_FOR_VERIFY]) {
    await engine.insert('sys_sso_provider', {
      id: `ssop_${providerId}`,
      provider_id: providerId,
      issuer: 'https://idp.pin-22463.example.com',
      domain: 'pin-22463.example.com',
      user_id: String(admin.id),
      organization_id: null,
      domain_verified: false,
    });
  }

  const signIn = await direct('/sign-in/email', { email, password: PASSWORD });
  expect(signIn.status, `sign-in: ${await signIn.clone().text()}`).toBe(200);
  const bearer = String(signIn.headers.get('set-auth-token') ?? '');
  if (!bearer) throw new Error('pin sign-in emitted no set-auth-token');

  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  // A plain instance wrapper, not `vi.spyOn`: the imported
  // `impersonation-bearer-rotation.test` registers `afterEach(restoreAllMocks)`
  // in this file too, which would strip a spy after the first test and leave
  // every "vendor never asked" pin below passing on a dead counter. The
  // "asked once" pins are this counter's positive control.
  const dispatched: Request[] = [];
  const handle = manager.handleRequest.bind(manager);
  (manager as any).handleRequest = async (req: Request) => {
    dispatched.push(req);
    return handle(req);
  };
  return { manager, app, bearer, dispatched };
}

let on: Stack;
let off: Stack;

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  on = await bootStack(true);
  off = await bootStack(false);
});

afterAll(() => vi.restoreAllMocks());

const adminRequest = (stack: Stack, door: string, providerId: string, credential = true) =>
  new Request(`${ORIGIN}${BASE}/admin/sso/${door}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(credential ? { authorization: `Bearer ${stack.bearer}` } : {}),
    },
    body: JSON.stringify({ providerId }),
  });

/** Fire at the mounted route; answer with the status, the envelope and the vendor calls it made. */
async function fire(stack: Stack, door: (typeof DOORS)[number], providerId: string, credential = true) {
  stack.dispatched.length = 0;
  const res = await stack.app.request(adminRequest(stack, door.door, providerId, credential));
  const json: any = await res.json();
  const vendorCalls = stack.dispatched.filter((r) => new URL(r.url).pathname === `${BASE}${door.inner}`).length;
  return { status: res.status, json, vendorCalls };
}

describe('[#22463] precondition — the two stacks and the vendor’s two code-less 404s', () => {
  it('the flag the mounts read agrees with each stack’s configuration', () => {
    expect(on.manager.isSsoDomainVerificationEnabled()).toBe(true);
    expect(off.manager.isSsoDomainVerificationEnabled()).toBe(false);
  });

  for (const door of DOORS) {
    it(`${door.inner}: ON answers an unknown provider 404 with no code; OFF answers 404, empty — the two shapes the bridge must tell apart`, async () => {
      const ask = (stack: Stack) =>
        stack.manager.handleRequest(
          new Request(`${ORIGIN}${BASE}${door.inner}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: `Bearer ${stack.bearer}` },
            body: JSON.stringify({ providerId: UNKNOWN }),
          }),
        );
      const onRes = await ask(on);
      const onText = await onRes.text();
      expect(onRes.status, onText).toBe(404);
      expect(onText ? JSON.parse(onText).code : undefined, onText).toBeUndefined();

      const offRes = await ask(off);
      expect(offRes.status).toBe(404);
      expect(await offRes.text()).toBe('');
    });
  }
});

describe('[#22463] the card’s pin — ON, an unknown provider is not found, on both doors', () => {
  for (const door of DOORS) {
    it(`${door.label}: 404 RESOURCE_NOT_FOUND naming the provider, after asking the vendor`, async () => {
      const { status, json, vendorCalls } = await fire(on, door, UNKNOWN);
      expect(status, JSON.stringify(json)).toBe(404);
      expect(json.success).toBe(false);
      expect(json.error?.code, JSON.stringify(json)).toBe('RESOURCE_NOT_FOUND');
      expect(json.error?.message).toContain(`"${UNKNOWN}"`);
      expect(json.error?.message).not.toContain('OS_SSO_DOMAIN_VERIFICATION');
      expect(vendorCalls).toBe(1);
    });
  }
});

describe('[#22463] control — OFF, both doors keep DOMAIN_VERIFICATION_DISABLED without asking the vendor', () => {
  for (const door of DOORS) {
    it(`${door.label}: 400 DOMAIN_VERIFICATION_DISABLED, vendor never asked`, async () => {
      const { status, json, vendorCalls } = await fire(off, door, UNKNOWN);
      expect(status, JSON.stringify(json)).toBe(400);
      expect(json.error?.code, JSON.stringify(json)).toBe('DOMAIN_VERIFICATION_DISABLED');
      expect(json.error?.message).toContain('OS_SSO_DOMAIN_VERIFICATION');
      expect(vendorCalls).toBe(0);
    });
  }
});

describe('[#22463] ON, an existing provider still reaches the vendor’s own answer', () => {
  it('POST /admin/sso/request-domain-verification: the vendor’s 201 becomes the ready-to-paste DNS record', async () => {
    const { status, json, vendorCalls } = await fire(on, DOORS[0], OWN_FOR_REQUEST);
    expect(status, JSON.stringify(json)).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data?.token, JSON.stringify(json)).toMatch(/^\S+$/);
    expect(json.data?.dnsRecordValue).toBe(`_better-auth-token-${OWN_FOR_REQUEST}=${json.data?.token}`);
    expect(vendorCalls).toBe(1);
  });

  it('POST /admin/sso/verify-domain: the vendor’s coded 404 NO_PENDING_VERIFICATION passes through, not RESOURCE_NOT_FOUND', async () => {
    // The load-bearing direction: a 404 that CARRIES a code is the vendor's
    // diagnosis. Reading every ON 404 as "not found" would answer
    // RESOURCE_NOT_FOUND here and hide the next step from the admin.
    const { status, json, vendorCalls } = await fire(on, DOORS[1], OWN_FOR_VERIFY);
    expect(status, JSON.stringify(json)).toBe(404);
    expect(json.error?.code, JSON.stringify(json)).toBe('NO_PENDING_VERIFICATION');
    expect(json.error?.message).toContain('Request Domain Verification');
    expect(vendorCalls).toBe(1);
  });
});

describe('[#22463] the gate still answers first, whatever the flag', () => {
  for (const stack of ['on', 'off'] as const) {
    for (const door of DOORS) {
      it(`${door.label}, ${stack.toUpperCase()}: anonymous → 401 UNAUTHENTICATED, vendor never asked`, async () => {
        const { status, json, vendorCalls } = await fire(stack === 'on' ? on : off, door, UNKNOWN, false);
        expect(status, JSON.stringify(json)).toBe(401);
        expect(json.error?.code).toBe('UNAUTHENTICATED');
        expect(vendorCalls).toBe(0);
      });
    }
  }
});

describe('[#22463] a bridge handed no flag keeps the earlier mapping (the exported helpers’ other callers)', () => {
  const BRIDGES = [
    { label: 'runRequestDomainVerification', run: runRequestDomainVerification, door: 'request-domain-verification' },
    { label: 'runVerifyDomain', run: runVerifyDomain, door: 'verify-domain' },
  ] as const;
  for (const bridge of BRIDGES) {
    it(`${bridge.label}, real ON stack, unknown provider, no flag → 400 DOMAIN_VERIFICATION_DISABLED, as before`, async () => {
      const res = await bridge.run((req) => on.manager.handleRequest(req), adminRequest(on, bridge.door, UNKNOWN));
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.code).toBe('DOMAIN_VERIFICATION_DISABLED');
    });
  }
});
