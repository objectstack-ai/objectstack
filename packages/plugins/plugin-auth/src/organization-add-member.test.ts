// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9941 — `POST /organization/add-member` is MOUNTED (better-auth declares
 * `addMember` server-only, with no HTTP path), admin-gated, and actually
 * clears the card's blocker: on a multi-org fixture an existing user with
 * zero memberships gets a `sys_member` row through this route and no longer
 * meets the "create a workspace" bootstrap condition.
 *
 * Two layers, deliberately:
 *
 *  1. The MOUNTED route on the plugin's real route registration, driven by
 *     REAL better-auth sessions over a real `AuthManager` + in-memory engine
 *     (the remove-member-permission-guard.test.ts harness) — so the ADR-0068
 *     gate pins (anon 401 / member 403 / org owner 403 / platform admin
 *     admitted) are pinned on the WIRING, not on a fake session shape, and
 *     the admitted path is proven to reach the real vendor `addMember`
 *     (the row lands in `sys_member` through the objectql adapter).
 *  2. The handler module alone, for the orderings that need a degraded
 *     deployment (organization plugin off → 501 before body validation).
 *
 * Every rejection asserts `code` AND `status` (ADR-0112) — a bare "it threw"
 * would pass against a handler that refuses everyone.
 *
 * The platform admin here is REAL: `sys_permission_set`(`admin_full_access`)
 * + an org-less `sys_user_permission_set` link — the exact rows the
 * customSession override derives `positions[]`/`isPlatformAdmin` from. No
 * `role = 'admin'` scalar is patched anywhere (re-synthesizing it is
 * permanently vetoed, maintainer ruling 2026-08-18).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { runOrganizationAddMember } from './organization-add-member.js';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const BASE_PATH = '/api/v1/auth';
const ORG_ACME = 'org_acme';
const ORG_BETA = 'org_beta';
const PASSWORD = 'S3cure!Passw0rd-9941';

/**
 * The in-memory `IDataEngine` double the other end-to-end auth-manager suites
 * use (copied from remove-member-permission-guard.test.ts), deliberately NO
 * more forgiving than the real engine: `delete`/`update` route through the
 * shared dispatch asserts, and `sys_member`'s declared
 * `{ organization_id, user_id }` UNIQUE index is ENFORCED — this suite's whole
 * point is which calls create membership rows, so a fake that tolerated a
 * duplicate would let a wrong write read as a right one.
 */
const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const assertMemberUnique = (name: string, row: any, ignoreId?: string) => {
    if (name !== 'sys_member') return;
    const clash = rows(name).some(
      (r) =>
        r.id !== ignoreId &&
        r.organization_id === row.organization_id &&
        r.user_id === row.user_id,
    );
    if (clash) {
      throw new Error(
        'insert into sys_member … UNIQUE constraint failed: ' +
          'sys_member.organization_id, sys_member.user_id',
      );
    }
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as any).getTime() === new Date(b as any).getTime()
      : a === b;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
      }
      return eq(actual, v);
    });
  const project = (row: any, fields?: string[]) => {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    const out: any = {};
    for (const f of ['id', ...fields]) if (f in row) out[f] = row[f];
    return out;
  };
  let seq = 0;
  return {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      assertMemberUnique(name, row);
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      const row = rows(name).find((r) => matches(r, q.where));
      return row ? project(row, q.fields) : null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      if (q.offset) out = out.slice(q.offset);
      if (q.limit) out = out.slice(0, q.limit);
      return out.map((r) => project(r, q.fields));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any, options?: any) {
      assertEngineUpdateDispatch(patch, options);
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      assertMemberUnique(name, { ...row, ...patch }, row.id);
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};

type MemoryEngine = ReturnType<typeof createMemoryEngine>;

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

/** POST through the real better-auth pipeline (sign-up, organization/list …). */
const viaManager = (manager: AuthManager, path: string, init: RequestInit, cookie?: string) =>
  manager.handleRequest(
    new Request(`${BASE}${BASE_PATH}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    }),
  );

const signUp = async (manager: AuthManager, engine: MemoryEngine, email: string) => {
  const res = await viaManager(manager, '/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, name: email }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  const user = (engine.tables.get('sys_user') ?? []).find((u) => u.email === email);
  expect(user, `sign-up did not create ${email}`).toBeDefined();
  return { cookie: cookieFrom(res), userId: String(user!.id), email };
};

const memberRows = (engine: MemoryEngine, userId: string) =>
  (engine.tables.get('sys_member') ?? []).filter((m) => m.user_id === userId);

/** The orgs a user's own session can see — the "create a workspace" signal. */
const orgListFor = async (manager: AuthManager, cookie: string): Promise<any[]> => {
  const res = await viaManager(manager, '/organization/list', { method: 'GET' }, cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as any[];
};

/** Fire the MOUNTED route, exactly as the sys_member action posts it. */
const fireAddMember = (app: Hono, body: unknown, cookie?: string) =>
  app.request(`${BASE}${BASE_PATH}/organization/add-member`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

describe('#9941 POST /organization/add-member — mounted, gated, and it clears the blocker (real multi-org fixture)', () => {
  let engine: MemoryEngine;
  let manager: AuthManager;
  let app: Hono;
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let orgOwner: { cookie: string; userId: string };
  let target: { cookie: string; userId: string };

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  afterAll(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  beforeAll(async () => {
    engine = createMemoryEngine();
    manager = new AuthManager({
      secret: SECRET,
      baseUrl: BASE,
      dataEngine: engine as any,
      plugins: { organization: true },
    } as any);

    // TWO organizations — a genuinely multi-org deployment, so nothing can
    // resolve a "sole organization" to auto-bind anyone to.
    await engine.insert('sys_organization', { id: ORG_ACME, name: 'Acme', slug: 'acme' });
    await engine.insert('sys_organization', { id: ORG_BETA, name: 'Beta', slug: 'beta' });

    admin = await signUp(manager, engine, 'platform.admin@example.com');
    member = await signUp(manager, engine, 'plain.member@example.com');
    orgOwner = await signUp(manager, engine, 'org.owner@example.com');
    target = await signUp(manager, engine, 'existing.user@example.com');

    // The REAL ADR-0068 platform-admin signal: admin_full_access held with
    // organization_id = null — the rows customSession derives positions[]
    // from. NOT the legacy role scalar.
    await engine.insert('sys_permission_set', { id: 'ps_admin', name: 'admin_full_access' });
    await engine.insert('sys_user_permission_set', {
      id: 'ups_admin',
      user_id: admin.userId,
      permission_set_id: 'ps_admin',
      organization_id: null,
    });

    // Org-scoped actors on Acme: a plain member and an org OWNER — the owner
    // is the seat #10009 is open about; here it must stay refused.
    await engine.insert('sys_member', {
      id: 'mem_plain',
      organization_id: ORG_ACME,
      user_id: member.userId,
      role: 'member',
      created_at: new Date(),
    });
    await engine.insert('sys_member', {
      id: 'mem_owner',
      organization_id: ORG_ACME,
      user_id: orgOwner.userId,
      role: 'owner',
      created_at: new Date(),
    });

    // The plugin's REAL route registration on a real Hono app (the
    // admin-sso-bridge-gate.test.ts harness), with the REAL AuthManager
    // behind it — gate, mount, and vendor call are all the shipped wiring.
    app = new Hono();
    const plugin = new AuthPlugin({ secret: SECRET });
    await plugin.init(mockCtx());
    (plugin as any).authManager = manager;
    (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, mockCtx());
  }, 120_000);

  const answer = async (res: Response) => {
    const body: any = await res.clone().json().catch(() => null);
    return { status: res.status, code: body?.error?.code ?? null, success: body?.success ?? null };
  };

  // ── The card's premise, kept measured ────────────────────────────────────
  it('premise: on multi-org, a fresh user has ZERO memberships and an empty org list (the "create a workspace" bootstrap condition)', async () => {
    expect(memberRows(engine, target.userId)).toHaveLength(0);
    expect(await orgListFor(manager, target.cookie)).toEqual([]);
  });

  // ── ADR-0068 gate pins, anonymous-first ordering ─────────────────────────
  it('anonymous → 401 UNAUTHENTICATED even with an invalid body (identity error before body validation), and nothing is written', async () => {
    const before = memberRows(engine, target.userId).length;
    const res = await fireAddMember(app, {}); // no userId, no role, no session
    expect(await answer(res)).toEqual({ status: 401, code: 'UNAUTHENTICATED', success: false });
    expect(memberRows(engine, target.userId)).toHaveLength(before);
  });

  it('a signed-in plain member → 403 PERMISSION_DENIED, and nothing is written', async () => {
    const res = await fireAddMember(
      app,
      { userId: target.userId, role: 'member', organizationId: ORG_ACME },
      member.cookie,
    );
    expect(await answer(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED', success: false });
    expect(memberRows(engine, target.userId)).toHaveLength(0);
  });

  it('an org OWNER is not a platform admin → 403 PERMISSION_DENIED (the admit set is platform-admin only)', async () => {
    const res = await fireAddMember(
      app,
      { userId: target.userId, role: 'member', organizationId: ORG_ACME },
      orgOwner.cookie,
    );
    expect(await answer(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED', success: false });
    expect(memberRows(engine, target.userId)).toHaveLength(0);
  });

  // ── The card's actual blocker, end to end ────────────────────────────────
  it('a platform admin attaches the zero-membership user: the vendor addMember runs, the sys_member row lands, and the bootstrap condition clears', async () => {
    const res = await fireAddMember(
      app,
      { userId: target.userId, role: 'member', organizationId: ORG_BETA },
      admin.cookie,
    );
    const body: any = await res.clone().json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    // The vendor's created member row is returned to the action's caller.
    expect(body.data?.member?.userId ?? body.data?.member?.user_id).toBe(target.userId);

    // The row is real — written through the objectql adapter by the REAL
    // vendor endpoint, not by any direct sys_member write in this repo.
    const rows = memberRows(engine, target.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(ORG_BETA);
    expect(rows[0].role).toBe('member');

    // …and the user no longer lands on "create a workspace": their own
    // session now sees the org.
    const orgs = await orgListFor(manager, target.cookie);
    expect(orgs.map((o: any) => o.id)).toEqual([ORG_BETA]);
  });

  // ── The vendor's own verdicts are forwarded, not re-adjudicated ──────────
  it("repeating the attach is refused by the VENDOR's pre-check: 400 USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION", async () => {
    // This is also the claim adopt-membership.ts documents — kept live here.
    const res = await fireAddMember(
      app,
      { userId: target.userId, role: 'member', organizationId: ORG_BETA },
      admin.cookie,
    );
    expect(await answer(res)).toEqual({
      status: 400,
      code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION',
      success: false,
    });
    expect(memberRows(engine, target.userId)).toHaveLength(1);
  });

  it('an unknown userId → the vendor 400 USER_NOT_FOUND', async () => {
    const res = await fireAddMember(
      app,
      { userId: 'usr_nobody', role: 'member', organizationId: ORG_ACME },
      admin.cookie,
    );
    expect(await answer(res)).toEqual({ status: 400, code: 'USER_NOT_FOUND', success: false });
  });

  it('omitted organizationId with no active organization on the admin session → the vendor 400 NO_ACTIVE_ORGANIZATION', async () => {
    // The admin holds no membership (platform admin ≠ org member) and never
    // set an active org, so the documented "defaults to the caller's active
    // org" fallback has nothing to fall back to — the vendor says so.
    const res = await fireAddMember(app, { userId: member.userId, role: 'member' }, admin.cookie);
    expect(await answer(res)).toEqual({ status: 400, code: 'NO_ACTIVE_ORGANIZATION', success: false });
  });

  // ── Body validation (after the gate — the admin seat sees these) ─────────
  it('missing userId → 400 INVALID_REQUEST; missing role → 400 INVALID_REQUEST', async () => {
    expect(await answer(await fireAddMember(app, { role: 'member' }, admin.cookie))).toEqual({
      status: 400,
      code: 'INVALID_REQUEST',
      success: false,
    });
    expect(
      await answer(await fireAddMember(app, { userId: member.userId }, admin.cookie)),
    ).toEqual({ status: 400, code: 'INVALID_REQUEST', success: false });
  });
});

describe('#9941 runOrganizationAddMember — capability ordering on a degraded deployment', () => {
  const post = (body: unknown) =>
    new Request(`${BASE}${BASE_PATH}/organization/add-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('organization plugin off → 501 NOT_IMPLEMENTED, even before body validation (capability error before body error)', async () => {
    // `getAuthApi` yields an api with NO addMember — the organization plugin
    // is not enabled. The body is ALSO invalid; the capability answer wins.
    const res = await runOrganizationAddMember({ getAuthApi: async () => ({}) }, post({}));
    expect(res.status).toBe(501);
    expect(res.body.error?.code).toBe('NOT_IMPLEMENTED');
  });

  it('forwards userId/role/organizationId (accepting snake_case spellings) and the request headers to the vendor', async () => {
    const addMember = vi.fn(async (_opts: { body: Record<string, unknown>; headers?: Headers }) => ({
      id: 'mem_new',
      userId: 'usr_1',
      organizationId: 'org_1',
      role: 'member',
    }));
    const req = post({ user_id: 'usr_1', role: ['member'], organization_id: 'org_1' });
    const res = await runOrganizationAddMember({ getAuthApi: async () => ({ addMember }) }, req);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(addMember).toHaveBeenCalledTimes(1);
    const call = addMember.mock.calls[0][0] as any;
    expect(call.body).toEqual({ userId: 'usr_1', role: ['member'], organizationId: 'org_1' });
    // Headers forwarded so an omitted organizationId can default to the
    // caller's ACTIVE org — the action metadata's documented behaviour.
    expect(call.headers).toBe(req.headers);
  });
});
