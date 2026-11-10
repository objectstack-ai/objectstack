// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D7] `POST /api/v1/auth/service-account/register` on the WIRE: a
 * licence refusal thrown on the identity write keeps its status and its code.
 *
 * The plugin's REAL route registration on a real Hono app, with a REAL
 * `AuthManager` behind it: the caller is read off a real better-auth session
 * (an organization administrator, the organization active), and the
 * membership goes through the REAL vendor `addMember` and its objectql
 * adapter. The engine is the package's shared in-memory double
 * (`impersonation-bearer-rotation.test.ts`); a licence plugin's middleware is
 * stood in for by refusing its `insert` on the object named, which is where
 * cloud's AI-seat cap throws (`statusCode` 402, code `ai_seat_limit_reached`).
 *
 * What the wire layer adds over the door's own suite
 * (`service-account-doors.test.ts`, a real ObjectQL engine and its hooks):
 *
 *  - the route renders the door's answer, status and body, unchanged;
 *  - the membership stage is measured through better-auth itself: the
 *    adapter's throw reaches the door as the engine threw it (no `body`, its
 *    `statusCode` and `code` intact), so the declared refusal is read there.
 *
 * The double runs no transaction, so the membership stage's rollback is the
 * door suite's pin (a real `transaction()`), not this one's.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const BASE_PATH = '/api/v1/auth';
const ORG = 'org_acme';
const PASSWORD = 'S3cure!Passw0rd-32127';

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

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

/** The jar after a response: its cookies replace the same-named ones held. */
const mergeCookies = (held: string, fresh: string): string => {
  const jar = new Map<string, string>();
  for (const pair of [...held.split('; '), ...fresh.split('; ')].filter(Boolean)) jar.set(pair.split('=')[0], pair);
  return [...jar.values()].join('; ');
};

/** What cloud's AI-seat cap throws on the write it refuses. */
const seatCap = () =>
  // adr0112-ok: a downstream licence plugin's own spelling, thrown as that producer throws it; the door demotes it to declaredCode
  Object.assign(new Error('AI-seat cap reached: 5 of 5 seats are in use.'), { statusCode: 402, code: 'ai_seat_limit_reached' });

describe('[ADR-0151 D7] POST /service-account/register answers a declared licence refusal with its status and code', () => {
  let engine: ReturnType<typeof createMemoryEngine>;
  let app: Hono;
  let cookie: string;
  /** The object whose insert the stand-in licence middleware refuses, or none. */
  let refuseInsertOn: 'sys_user' | 'sys_member' | undefined;

  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  afterAll(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  beforeAll(async () => {
    engine = createMemoryEngine();
    const insert = engine.insert.bind(engine);
    (engine as any).insert = async (object: string, data: any) => {
      if (object === refuseInsertOn) throw seatCap();
      return insert(object, data);
    };
    const manager = new AuthManager({
      secret: SECRET,
      baseUrl: BASE,
      dataEngine: engine as any,
      plugins: { organization: true },
    } as any);

    await engine.insert('sys_organization', { id: ORG, name: 'Acme', slug: 'acme' });
    const email = 'org.admin@example.com';
    const invitationId = await inviteForAudienceGate(engine, email);
    const signUp = await manager.handleRequest(new Request(`${BASE}${BASE_PATH}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Org Admin', invitationId }),
    }));
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    cookie = cookieFrom(signUp);
    const admin = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
    await engine.insert('sys_member', { id: 'mem_admin', organization_id: ORG, user_id: admin.id, role: 'admin', created_at: new Date() });

    const setActive = await manager.handleRequest(new Request(`${BASE}${BASE_PATH}/organization/set-active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, cookie },
      body: JSON.stringify({ organizationId: ORG }),
    }));
    expect(setActive.status, await setActive.clone().text()).toBe(200);
    cookie = mergeCookies(cookie, cookieFrom(setActive));

    app = new Hono();
    const plugin = new AuthPlugin({ secret: SECRET });
    await plugin.init(mockCtx());
    (plugin as any).authManager = manager;
    (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, mockCtx());
  }, 120_000);

  const register = () =>
    app.request(`${BASE}${BASE_PATH}/service-account/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, cookie },
      body: JSON.stringify({ name: 'Invoice bot' }),
    });
  const agents = () => (engine.tables.get('sys_user') ?? []).filter((u: any) => u.principal_kind === 'agent');

  it('control: with no refusal, the administrator registers an account (201)', async () => {
    refuseInsertOn = undefined;
    const res = await register();
    expect(res.status, await res.clone().text()).toBe(201);
    expect(agents()).toHaveLength(1);
    engine.tables.set('sys_user', (engine.tables.get('sys_user') ?? []).filter((u: any) => u.principal_kind !== 'agent'));
    engine.tables.set('sys_member', (engine.tables.get('sys_member') ?? []).filter((m: any) => m.id === 'mem_admin'));
  });

  it('a 402 refused on the sys_user insert: 402, ai_seat_limit_reached, and no sys_user or sys_member row', async () => {
    refuseInsertOn = 'sys_user';
    const members = (engine.tables.get('sys_member') ?? []).length;
    const res = await register();
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: 'VALIDATION_ERROR', declaredCode: 'ai_seat_limit_reached', message: 'AI-seat cap reached: 5 of 5 seats are in use.' },
    });
    expect(agents()).toEqual([]);
    expect((engine.tables.get('sys_member') ?? []).length).toBe(members);
  });

  it('a 402 refused on the sys_member insert, through the real vendor addMember: 402 and ai_seat_limit_reached', async () => {
    refuseInsertOn = 'sys_member';
    const res = await register();
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR', declaredCode: 'ai_seat_limit_reached' } });
    expect(body.error.message).toMatch(/could not be added to the organization.*AI-seat cap reached/);
  });
});
