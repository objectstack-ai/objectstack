// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0069 D5 — a sign-in the IP allow-list refuses leaves one `login_failed`
// row in the compliance ledger (`ip-allow-list-refusal-audit.ts`), bounded so a
// scanner hammering the gate cannot flood the table.
//
// Two doors refuse a sign-in by address, and both are driven for real here:
//
//  - the DEPLOYMENT list, judged by the auth-route middleware AuthPlugin mounts
//    in front of better-auth (`registerAuthRoutes`), before any account is
//    resolved. The fixture mounts it on a real Hono app in front of a real
//    AuthManager, as `client-ip-allow-list-trust-rule.test.ts` does;
//  - an ORGANIZATION's own list, judged when better-auth creates the session
//    (`auth-manager-database-hooks.ts`, `SESSION_SCOPING_REFUSAL`), driven
//    through `AuthManager.handleRequest` with the transport peer.
//
// ADR-0112 is `code` AND `status`; every refusal assertion carries both.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import type { AuthSessionAuditEventInput } from './auth-session-audit';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-30924';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const EMAIL = 'member.30924@example.com';

/** Documentation ranges (RFC 5737): one allowed, two not. */
const RANGE = '203.0.113.0/24';
const INSIDE = '203.0.113.7';
const OUTSIDE = '198.51.100.9';
const OUTSIDE_2 = '198.51.100.10';

/** A recording audit sink, in the shape plugin-audit registers under `audit`. */
function recordingSink() {
  const events: AuthSessionAuditEventInput[] = [];
  return {
    events,
    recordAuthEvent: vi.fn(async (event: AuthSessionAuditEventInput) => {
      events.push(event);
    }),
  };
}

/** Let detached work (the gate's row is written off the response path) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

/** Status + the error code the body carries (ADR-0112 nests it under `error`). */
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

const REFUSED = { status: 403, code: 'IP_NOT_ALLOWED' };

/** One deployment with an allow-list, served through the REAL mount chain. */
async function deployment(options: { sink?: ReturnType<typeof recordingSink> } = {}) {
  const engine = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    allowedIpRanges: [RANGE],
  } as any);
  const sink = options.sink;
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name === 'audit') return sink;
      return undefined;
    }),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  } as unknown as PluginContext & { logger: { warn: ReturnType<typeof vi.fn> } };
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  const app = new Hono();
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const send = (path: string, init: RequestInit, peer: string) =>
    app.request(`${ORIGIN}${BASE}${path}`, init, { incoming: { socket: { remoteAddress: peer } } });

  /** Create the fixture user directly (no mount), so only the sign-in crosses the gate. */
  const signUp = async () => {
    await inviteForAudienceGate(manager, EMAIL);
    const res = await manager.handleRequest(
      new Request(`${ORIGIN}${BASE}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Allow-list Member' }),
      }),
    );
    expect(res.status, `sign-up: ${await res.clone().text()}`).toBe(200);
    const user = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === EMAIL);
    return String(user.id);
  };

  const signIn = (peer: string, email = EMAIL, path = '/sign-in/email') =>
    send(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, 'user-agent': 'probe/30924' },
        body: JSON.stringify({ email, password: PASSWORD }),
      },
      peer,
    );

  return { ctx, manager, engine, signUp, signIn, send };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('[#30924] the deployment allow-list writes one login_failed row per refused sign-in', () => {
  it('an out-of-range sign-in of an existing account: one row naming the account, the address, the rule', async () => {
    const sink = recordingSink();
    const d = await deployment({ sink });
    const userId = await d.signUp();
    sink.events.length = 0;

    expect(await verdict(await d.signIn(OUTSIDE))).toEqual(REFUSED);
    await vi.waitFor(() => expect(sink.events).toHaveLength(1));
    await settle();

    expect(sink.events).toEqual([
      {
        action: 'login_failed',
        userId,
        ipAddress: OUTSIDE,
        userAgent: 'probe/30924',
        context: { endpoint: '/sign-in/email', reason: 'IP_NOT_ALLOWED', rule: 'ip_allow_list', attempts: 1 },
      },
    ]);
    // ⛔ Nothing the caller typed reaches the row: no password, no identifier.
    const written = JSON.stringify(sink.events);
    expect(written).not.toContain(PASSWORD);
    expect(written).not.toContain(EMAIL);
  });

  it('an identifier that names no account still writes the row, with no subject', async () => {
    const sink = recordingSink();
    const d = await deployment({ sink });

    expect(await verdict(await d.signIn(OUTSIDE, 'nobody.30924@example.com'))).toEqual(REFUSED);
    await vi.waitFor(() => expect(sink.events).toHaveLength(1));

    const [event] = sink.events;
    expect(event.action).toBe('login_failed');
    expect(event.userId).toBeUndefined();
    expect(event.ipAddress).toBe(OUTSIDE);
    expect(event.context).toEqual({
      endpoint: '/sign-in/email',
      reason: 'IP_NOT_ALLOWED',
      rule: 'ip_allow_list',
      attempts: 1,
    });
    expect(JSON.stringify(event)).not.toContain('nobody.30924');
  });

  it('every /sign-in/* endpoint is recorded; a refused session read or sign-out is not', async () => {
    const sink = recordingSink();
    const d = await deployment({ sink });

    expect(await verdict(await d.send('/get-session', { method: 'GET' }, OUTSIDE))).toEqual(REFUSED);
    expect(await verdict(await d.send('/sign-out', { method: 'POST' }, OUTSIDE))).toEqual(REFUSED);
    await settle();
    expect(sink.events).toEqual([]);

    expect(await verdict(await d.signIn(OUTSIDE_2, EMAIL, '/sign-in/magic-link'))).toEqual(REFUSED);
    await vi.waitFor(() => expect(sink.events).toHaveLength(1));
    expect(sink.events[0].context).toMatchObject({ endpoint: '/sign-in/magic-link', rule: 'ip_allow_list' });
  });

  it('an admitted sign-in writes no refusal row', async () => {
    const sink = recordingSink();
    const d = await deployment({ sink });
    await d.signUp();
    sink.events.length = 0;

    const res = await d.signIn(INSIDE);
    expect(res.status, await res.clone().text()).toBe(200);
    await settle();
    expect(sink.events.filter((e) => e.action === 'login_failed')).toEqual([]);
  });

  it('a flood from one address is bounded: rows at the 1st, 10th and 100th refusal only', async () => {
    const sink = recordingSink();
    const d = await deployment({ sink });

    for (let i = 0; i < 120; i += 1) {
      expect((await d.signIn(OUTSIDE, 'nobody.30924@example.com')).status).toBe(403);
    }
    await vi.waitFor(() => expect(sink.events).toHaveLength(3));
    await settle();
    expect(sink.events.map((e) => e.context?.attempts)).toEqual([1, 10, 100]);

    // Another address has its own count.
    expect((await d.signIn(OUTSIDE_2, 'nobody.30924@example.com')).status).toBe(403);
    await vi.waitFor(() => expect(sink.events).toHaveLength(4));
    expect(sink.events[3]).toMatchObject({ ipAddress: OUTSIDE_2, context: { attempts: 1 } });
  });

  it('the row does not change the answer: same status, code and body, and the response never waits on the account lookup', async () => {
    const without = await deployment();
    const plain = await without.signIn(OUTSIDE);
    const plainBody = await plain.text();

    const sink = recordingSink();
    const d = await deployment({ sink });
    await d.signUp();
    // The account lookup is slow: the answer must arrive before it settles.
    let settled = false;
    const lookup = vi.spyOn(d.manager, 'resolveRefusedSignInAccountId').mockImplementation(
      () => new Promise((resolve) => setTimeout(() => { settled = true; resolve(undefined); }, 150)),
    );
    const audited = await d.signIn(OUTSIDE);
    expect(settled, 'the refusal waited on the account lookup').toBe(false);
    expect(audited.status).toBe(plain.status);
    expect(await audited.text()).toBe(plainBody);
    expect(JSON.parse(plainBody)).toEqual({
      success: false,
      error: { code: 'IP_NOT_ALLOWED', message: 'Sign-in is not allowed from your network.' },
    });
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    expect(lookup).toHaveBeenCalledWith(EMAIL);
  });

  it('no audit plugin: the refusal is answered as before and nothing is read', async () => {
    const d = await deployment();
    const lookup = vi.spyOn(d.manager, 'resolveRefusedSignInAccountId');
    expect(await verdict(await d.signIn(OUTSIDE))).toEqual(REFUSED);
    await settle();
    expect(lookup).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// An organization's own list, judged when the session is created
// ───────────────────────────────────────────────────────────────────────────

const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';
const IN_A = '10.1.0.7';
const IN_B = '10.2.0.7';

const post = (manager: AuthManager, path: string, body: unknown, remoteAddress: string, cookie?: string) =>
  manager.handleRequest(
    new Request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'user-agent': 'probe/30924', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { remoteAddress },
  );

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

/** Alpha admits only 10.1.0.0/16, Beta only 10.2.0.0/16; Alice is a member of both, Alpha first. */
async function organizations() {
  const sink = recordingSink();
  const engine = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    getAuditSink: () => sink,
  } as any);
  vi.spyOn(manager as any, 'selfRegistrationSetResolvable').mockResolvedValue(true);
  const policies: Record<string, Record<string, unknown>> = {
    [ORG_A]: { allowed_ip_ranges: '10.1.0.0/16' },
    [ORG_B]: { allowed_ip_ranges: '10.2.0.0/16' },
  };
  manager.setOrganizationAccessPolicySource({
    read: async (id) => policies[id] ?? {},
    anyOrganizationRequiresMfa: async () => false,
  });
  const email = 'alice@alpha.test';
  const res = await post(manager, '/sign-up/email', { email, password: PASSWORD, name: email }, '127.0.0.1');
  expect(res.status, await res.clone().text()).toBe(200);
  const user = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
  await engine.insert('sys_organization', { id: ORG_A, name: 'Alpha', slug: 'alpha' });
  await engine.insert('sys_organization', { id: ORG_B, name: 'Beta', slug: 'beta' });
  engine.tables.set('sys_member', (engine.tables.get('sys_member') ?? []).filter((m: any) => m.user_id !== user.id));
  await engine.insert('sys_member', { user_id: user.id, organization_id: ORG_A, role: 'member', created_at: new Date(Date.now() - 60_000) });
  await engine.insert('sys_member', { user_id: user.id, organization_id: ORG_B, role: 'member', created_at: new Date() });
  sink.events.length = 0;
  const signIn = (remoteAddress: string) => post(manager, '/sign-in/email', { email, password: PASSWORD }, remoteAddress);
  return { sink, engine, manager, userId: String(user.id), signIn };
}

describe('[#30924] an organization\'s own list writes one login_failed row per refused sign-in', () => {
  it('a sign-in scoped to an organization from outside its list: one row naming the account, the organization, the address, the rule', async () => {
    // One row, not two: the password sign-in's own refusal row
    // (`signInFailureEventFor`) yields to the row the refusing door wrote.
    const { sink, userId, signIn } = await organizations();

    const res = await signIn(IN_B);
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe('IP_NOT_ALLOWED');

    expect(sink.events).toEqual([
      {
        action: 'login_failed',
        userId,
        organizationId: ORG_A,
        ipAddress: IN_B,
        userAgent: 'probe/30924',
        context: { endpoint: '/sign-in/email', reason: 'IP_NOT_ALLOWED', rule: 'ip_allow_list', attempts: 1 },
      },
    ]);
    expect(JSON.stringify(sink.events)).not.toContain(PASSWORD);
  });

  it('control: an admitted sign-in writes its login row and no refusal row', async () => {
    const { sink, signIn } = await organizations();
    expect((await signIn(IN_A)).status).toBe(200);
    expect(sink.events.map((e) => e.action)).toEqual(['login']);
  });

  it('a refused switch of the active organization is not a sign-in: no row', async () => {
    const { sink, manager, signIn } = await organizations();
    const signedIn = await signIn(IN_A);
    expect(signedIn.status).toBe(200);
    const cookie = cookieFrom(signedIn);
    sink.events.length = 0;

    const res = await post(manager, '/organization/set-active', { organizationId: ORG_B }, IN_A, cookie);
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe('IP_NOT_ALLOWED');
    expect(sink.events).toEqual([]);
  });

  it('repeated refusals from one address share the deployment gate\'s bound', async () => {
    const { sink, signIn } = await organizations();
    for (let i = 0; i < 12; i += 1) expect((await signIn(IN_B)).status).toBe(403);
    expect(sink.events.map((e) => e.context?.attempts)).toEqual([1, 10]);
  });
});
