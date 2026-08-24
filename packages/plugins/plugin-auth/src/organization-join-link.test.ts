// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11587 (epic #11586) — the universal org join link, V1.
 *
 * Two layers, the organization-add-member.test.ts pattern:
 *
 *  1. The MOUNTED routes on the plugin's real route registration, driven by
 *     REAL better-auth sessions over a real `AuthManager` + in-memory engine —
 *     so the authz matrix (anon / stranger / plain member / org admin / org
 *     owner) is pinned on the VENDOR's own invite-member permission family
 *     (`auth.api.hasPermission`, `invitation: create/cancel`), not on a fake
 *     session shape, and the admitted join is proven to reach the real vendor
 *     `addMember` (the `sys_member` row lands through the objectql adapter).
 *  2. The handler module alone with fake deps, for the pins a live fixture
 *     cannot express deterministically: the organization plugin being off
 *     (501 before body validation), the join delegating to `addMember` with
 *     ZERO direct `sys_member` writes, the already-a-member race collapsing
 *     to idempotent success, and the fixed-window rate limits.
 *
 * Every rejection asserts `code` AND `status` (ADR-0112) — a bare "it threw"
 * would pass against a handler that refuses everyone.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import {
  runAcceptJoinLink,
  runCreateJoinLink,
  runGetJoinLinkInfo,
  mintJoinToken,
  JOIN_LINK_INFO_RATE_LIMIT,
  JOIN_LINK_ACCEPT_RATE_LIMIT,
} from './organization-join-link.js';
import { InProcessCounterStore } from './rate-limit-storage.js';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const BASE_PATH = '/api/v1/auth';
const ORG_ACME = 'org_acme';
const ORG_BETA = 'org_beta';
const PASSWORD = 'S3cure!Passw0rd-11587';

/** The in-memory `IDataEngine` double the auth-manager e2e suites share. */
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
      if (v === null) return actual === null || actual === undefined;
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

/** Flip the REAL column better-auth reads the verified flag from. */
const markEmailVerified = (engine: MemoryEngine, userId: string) => {
  const row = (engine.tables.get('sys_user') ?? []).find((u) => String(u.id) === userId);
  expect(row, `no sys_user row for ${userId}`).toBeDefined();
  row!.email_verified = true;
};

const memberRows = (engine: MemoryEngine, userId: string) =>
  (engine.tables.get('sys_member') ?? []).filter((m) => m.user_id === userId);

const linkRows = (engine: MemoryEngine, organizationId: string) =>
  (engine.tables.get('sys_join_link') ?? []).filter((l) => l.organization_id === organizationId);

const fire = (
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
  headers?: Record<string, string>,
) =>
  app.request(`${BASE}${BASE_PATH}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(headers ?? {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const answer = async (res: Response) => {
  const body: any = await res.clone().json().catch(() => null);
  return { status: res.status, code: body?.error?.code ?? null, success: body?.success ?? null };
};

describe('#11587 join link — mounted routes on a real multi-org fixture', () => {
  let engine: MemoryEngine;
  let manager: AuthManager;
  let app: Hono;
  let owner: { cookie: string; userId: string };
  let orgAdmin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let stranger: { cookie: string; userId: string };
  let joiner: { cookie: string; userId: string };
  let joinerBeta: { cookie: string; userId: string };
  let unverified: { cookie: string; userId: string };

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

    await engine.insert('sys_organization', { id: ORG_ACME, name: 'Acme', slug: 'acme' });
    await engine.insert('sys_organization', { id: ORG_BETA, name: 'Beta', slug: 'beta' });

    owner = await signUp(manager, engine, 'org.owner@example.com');
    orgAdmin = await signUp(manager, engine, 'org.admin@example.com');
    member = await signUp(manager, engine, 'plain.member@example.com');
    stranger = await signUp(manager, engine, 'stranger@example.com');
    joiner = await signUp(manager, engine, 'joiner@example.com');
    joinerBeta = await signUp(manager, engine, 'joiner.beta@example.com');
    unverified = await signUp(manager, engine, 'unverified@example.com');

    // The joiners arrive email-VERIFIED (the ruled posture demands it);
    // `unverified` deliberately stays as sign-up left them.
    markEmailVerified(engine, joiner.userId);
    markEmailVerified(engine, joinerBeta.userId);

    // Org-scoped actors on Acme: owner / admin / plain member. The owner also
    // owns Beta (for the max-uses lifecycle, kept apart from Acme's).
    await engine.insert('sys_member', {
      id: 'mem_owner',
      organization_id: ORG_ACME,
      user_id: owner.userId,
      role: 'owner',
      created_at: new Date(),
    });
    await engine.insert('sys_member', {
      id: 'mem_admin',
      organization_id: ORG_ACME,
      user_id: orgAdmin.userId,
      role: 'admin',
      created_at: new Date(),
    });
    await engine.insert('sys_member', {
      id: 'mem_plain',
      organization_id: ORG_ACME,
      user_id: member.userId,
      role: 'member',
      created_at: new Date(),
    });
    await engine.insert('sys_member', {
      id: 'mem_owner_beta',
      organization_id: ORG_BETA,
      user_id: owner.userId,
      role: 'owner',
      created_at: new Date(),
    });

    app = new Hono();
    const plugin = new AuthPlugin({ secret: SECRET });
    await plugin.init(mockCtx());
    (plugin as any).authManager = manager;
    (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, mockCtx());
  }, 120_000);

  // ── authz matrix on create (the vendor's invite-member family) ────────────
  it('anonymous create → 401 UNAUTHENTICATED, and no link row is written', async () => {
    const res = await fire(app, 'POST', '/organization/create-join-link', { organizationId: ORG_ACME });
    expect(await answer(res)).toEqual({ status: 401, code: 'UNAUTHENTICATED', success: false });
    expect(linkRows(engine, ORG_ACME)).toHaveLength(0);
  });

  it('a signed-in NON-member (stranger) → 403 PERMISSION_DENIED', async () => {
    const res = await fire(app, 'POST', '/organization/create-join-link', { organizationId: ORG_ACME }, stranger.cookie);
    expect(await answer(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED', success: false });
    expect(linkRows(engine, ORG_ACME)).toHaveLength(0);
  });

  it('a plain member → 403 PERMISSION_DENIED (minting a standing invitation is owner/admin only)', async () => {
    const res = await fire(app, 'POST', '/organization/create-join-link', { organizationId: ORG_ACME }, member.cookie);
    expect(await answer(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED', success: false });
  });

  it('an org ADMIN mints the link: 200, URL-safe ≥128-bit token, default +7d expiry, use_count 0', async () => {
    const res = await fire(app, 'POST', '/organization/create-join-link', { organizationId: ORG_ACME }, orgAdmin.cookie);
    const body: any = await res.clone().json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    const link = body.data.link;
    expect(link.organizationId).toBe(ORG_ACME);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(link.useCount).toBe(0);
    expect(link.maxUses).toBeNull();
    const days = (new Date(link.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7.01);
    expect(linkRows(engine, ORG_ACME)).toHaveLength(1);
  });

  it('the org OWNER is admitted too — and gets 409 JOIN_LINK_EXISTS while a live link stands (one active link per org)', async () => {
    const res = await fire(app, 'POST', '/organization/create-join-link', { organizationId: ORG_ACME }, owner.cookie);
    expect(await answer(res)).toEqual({ status: 409, code: 'JOIN_LINK_EXISTS', success: false });
    expect(linkRows(engine, ORG_ACME)).toHaveLength(1);
  });

  // ── get-join-link (the console "copy link anytime" read) ──────────────────
  it('get-join-link: admin reads the live link back; a plain member is refused; an unknown query param is a located 400', async () => {
    const okRes = await fire(app, 'GET', `/organization/get-join-link?organizationId=${ORG_ACME}`, undefined, orgAdmin.cookie);
    const okBody: any = await okRes.clone().json();
    expect(okRes.status).toBe(200);
    expect(okBody.data.link.token).toBe(linkRows(engine, ORG_ACME)[0].token);

    const deniedRes = await fire(app, 'GET', `/organization/get-join-link?organizationId=${ORG_ACME}`, undefined, member.cookie);
    expect(await answer(deniedRes)).toEqual({ status: 403, code: 'PERMISSION_DENIED', success: false });

    const badRes = await fire(app, 'GET', `/organization/get-join-link?organizationId=${ORG_ACME}&limit=5`, undefined, orgAdmin.cookie);
    const badBody: any = await badRes.clone().json();
    expect(badRes.status).toBe(400);
    expect(badBody.error.code).toBe('VALIDATION_ERROR');
    expect(badBody.error.message).toContain('"limit"');
    expect(badBody.error.message).toContain('organizationId');
  });

  // ── token info (unauthenticated landing-page probe) ───────────────────────
  it('info on a live token → org display name + validity ONLY; info on an unknown token → bare 404 JOIN_LINK_INVALID naming nothing', async () => {
    const token = linkRows(engine, ORG_ACME)[0].token;
    const res = await fire(app, 'GET', `/organization/get-join-link-info?token=${token}`);
    const body: any = await res.clone().json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ status: 'valid', organization: { name: 'Acme' } });

    const missRes = await fire(app, 'GET', `/organization/get-join-link-info?token=${mintJoinToken()}`);
    const missBody: any = await missRes.clone().json();
    expect(missRes.status).toBe(404);
    expect(missBody.error.code).toBe('JOIN_LINK_INVALID');
    expect(JSON.stringify(missBody)).not.toContain('Acme');
    expect(JSON.stringify(missBody)).not.toContain(ORG_ACME);
  });

  // ── the join itself ────────────────────────────────────────────────────────
  it('anonymous accept → 401 UNAUTHENTICATED even with a valid token', async () => {
    const token = linkRows(engine, ORG_ACME)[0].token;
    const res = await fire(app, 'POST', '/organization/accept-join-link', { token });
    expect(await answer(res)).toEqual({ status: 401, code: 'UNAUTHENTICATED', success: false });
  });

  it('a session WITHOUT a verified email → 401 EMAIL_NOT_VERIFIED, and no membership is written', async () => {
    const token = linkRows(engine, ORG_ACME)[0].token;
    const res = await fire(app, 'POST', '/organization/accept-join-link', { token }, unverified.cookie);
    expect(await answer(res)).toEqual({ status: 401, code: 'EMAIL_NOT_VERIFIED', success: false });
    expect(memberRows(engine, unverified.userId)).toHaveLength(0);
  });

  it('a verified user joins: membership lands through the REAL vendor addMember, role pinned member, use_count increments', async () => {
    const token = linkRows(engine, ORG_ACME)[0].token;
    const res = await fire(app, 'POST', '/organization/accept-join-link', { token }, joiner.cookie);
    const body: any = await res.clone().json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.alreadyMember).toBe(false);
    expect(body.data.organization).toEqual({ id: ORG_ACME, name: 'Acme' });

    const rows = memberRows(engine, joiner.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(ORG_ACME);
    expect(rows[0].role).toBe('member');
    expect(linkRows(engine, ORG_ACME)[0].use_count).toBe(1);
  });

  it('re-joining is idempotent: 200 alreadyMember, still ONE membership row, use_count unchanged', async () => {
    const token = linkRows(engine, ORG_ACME)[0].token;
    const res = await fire(app, 'POST', '/organization/accept-join-link', { token }, joiner.cookie);
    const body: any = await res.clone().json();
    expect(res.status).toBe(200);
    expect(body.data.alreadyMember).toBe(true);
    expect(memberRows(engine, joiner.userId)).toHaveLength(1);
    expect(linkRows(engine, ORG_ACME)[0].use_count).toBe(1);
  });

  // ── rotation / revocation lifecycle ────────────────────────────────────────
  it('rotate: the old token dies (410 JOIN_LINK_REVOKED / info says revoked), a new live link replaces it', async () => {
    const oldToken = linkRows(engine, ORG_ACME)[0].token;
    const res = await fire(app, 'POST', '/organization/rotate-join-link', { organizationId: ORG_ACME }, orgAdmin.cookie);
    const body: any = await res.clone().json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.rotated).toBe(true);
    const newToken = body.data.link.token;
    expect(newToken).not.toBe(oldToken);

    const oldAccept = await fire(app, 'POST', '/organization/accept-join-link', { token: oldToken }, joinerBeta.cookie);
    expect(await answer(oldAccept)).toEqual({ status: 410, code: 'JOIN_LINK_REVOKED', success: false });

    const oldInfo = await fire(app, 'GET', `/organization/get-join-link-info?token=${oldToken}`);
    expect(((await oldInfo.clone().json()) as any).data).toEqual({ status: 'revoked', organization: { name: 'Acme' } });

    const live = linkRows(engine, ORG_ACME).filter((l) => !l.revoked_at);
    expect(live).toHaveLength(1);
    expect(live[0].token).toBe(newToken);
  });

  it('revoke by a plain member → 403; revoke by the owner → 200; revoke again → 404 RESOURCE_NOT_FOUND', async () => {
    const denied = await fire(app, 'POST', '/organization/revoke-join-link', { organizationId: ORG_ACME }, member.cookie);
    expect(await answer(denied)).toEqual({ status: 403, code: 'PERMISSION_DENIED', success: false });

    const revoked = await fire(app, 'POST', '/organization/revoke-join-link', { organizationId: ORG_ACME }, owner.cookie);
    expect(revoked.status).toBe(200);
    expect(linkRows(engine, ORG_ACME).filter((l) => !l.revoked_at)).toHaveLength(0);

    const again = await fire(app, 'POST', '/organization/revoke-join-link', { organizationId: ORG_ACME }, owner.cookie);
    expect(await answer(again)).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND', success: false });
  });

  // ── expiry and exhaustion (Beta, kept apart from Acme's lifecycle) ────────
  it('an expired link answers 410 JOIN_LINK_EXPIRED on accept and status=expired on info', async () => {
    const expired = await engine.insert('sys_join_link', {
      id: 'jlnk_expired',
      organization_id: ORG_BETA,
      token: mintJoinToken(),
      expires_at: new Date(Date.now() - 60_000),
      revoked_at: null,
      max_uses: null,
      use_count: 0,
    });
    const acceptRes = await fire(app, 'POST', '/organization/accept-join-link', { token: expired.token }, joinerBeta.cookie);
    expect(await answer(acceptRes)).toEqual({ status: 410, code: 'JOIN_LINK_EXPIRED', success: false });
    expect(memberRows(engine, joinerBeta.userId)).toHaveLength(0);

    const infoRes = await fire(app, 'GET', `/organization/get-join-link-info?token=${expired.token}`);
    expect(((await infoRes.clone().json()) as any).data).toEqual({ status: 'expired', organization: { name: 'Beta' } });
  });

  it('maxUses: the last use consumes the link — the next verified user gets 410 JOIN_LINK_EXHAUSTED', async () => {
    const createRes = await fire(
      app, 'POST', '/organization/create-join-link',
      { organizationId: ORG_BETA, maxUses: 1 },
      owner.cookie,
    );
    const created: any = await createRes.clone().json();
    expect(createRes.status, JSON.stringify(created)).toBe(200);
    expect(created.data.link.maxUses).toBe(1);
    const token = created.data.link.token;

    const first = await fire(app, 'POST', '/organization/accept-join-link', { token }, joinerBeta.cookie);
    expect(first.status, JSON.stringify(await first.clone().json())).toBe(200);
    expect(memberRows(engine, joinerBeta.userId)).toHaveLength(1);

    const second = await fire(app, 'POST', '/organization/accept-join-link', { token }, joiner.cookie);
    expect(await answer(second)).toEqual({ status: 410, code: 'JOIN_LINK_EXHAUSTED', success: false });
    expect(memberRows(engine, joiner.userId)).toHaveLength(1); // still only the Acme row

    const infoRes = await fire(app, 'GET', `/organization/get-join-link-info?token=${token}`);
    expect(((await infoRes.clone().json()) as any).data).toEqual({ status: 'exhausted', organization: { name: 'Beta' } });
  });

  it('a bounded knob out of range is a located 400 VALIDATION_ERROR', async () => {
    const res = await fire(
      app, 'POST', '/organization/create-join-link',
      { organizationId: ORG_BETA, expiresInDays: 0 },
      owner.cookie,
    );
    const body: any = await res.clone().json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('expiresInDays');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — the handler module alone, for pins the live fixture cannot
// express deterministically.
// ─────────────────────────────────────────────────────────────────────────────

describe('#11587 join link — handler-level pins (fake deps)', () => {
  const VERIFIED_SESSION = {
    user: { id: 'usr_1', email: 'v@example.com', emailVerified: true },
    session: { activeOrganizationId: 'org_x' },
  };

  const liveLinkRow = (over: Record<string, unknown> = {}) => ({
    id: 'jlnk_1',
    organization_id: 'org_x',
    token: 'tok_live',
    expires_at: new Date(Date.now() + 86_400_000),
    revoked_at: null,
    max_uses: null,
    use_count: 0,
    ...over,
  });

  /** Engine fake that RECORDS every write, per table. */
  const recordingEngine = (seed: { joinLinks?: any[]; members?: any[]; orgs?: any[] } = {}) => {
    const writes: Array<{ op: string; object: string; data: any }> = [];
    const joinLinks = seed.joinLinks ?? [liveLinkRow()];
    const members = seed.members ?? [];
    const orgs = seed.orgs ?? [{ id: 'org_x', name: 'Xorg' }];
    return {
      writes,
      async find(object: string, q: any) {
        const all = object === 'sys_join_link' ? joinLinks : object === 'sys_member' ? members : orgs;
        return all.filter((r: any) =>
          Object.entries(q.where ?? {}).every(([k, v]) => (v === null ? r[k] == null : r[k] === v)),
        );
      },
      async insert(object: string, data: any) {
        writes.push({ op: 'insert', object, data });
        return { id: 'new', ...data };
      },
      async update(object: string, patch: any) {
        writes.push({ op: 'update', object, data: patch });
        return patch;
      },
    };
  };

  const passthroughStore = () => new InProcessCounterStore();

  const request = (body?: unknown, url = 'http://x/api/v1/auth/organization/accept-join-link') =>
    new Request(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('organization plugin off → 501 NOT_IMPLEMENTED after the identity answer, before any body validation', async () => {
    const engine = recordingEngine();
    const deps = {
      getAuthApi: async () => ({ getSession: async () => VERIFIED_SESSION }), // no addMember / hasPermission
      getDataEngine: () => engine as any,
      getCounterStore: async () => passthroughStore(),
    };
    const res = await runCreateJoinLink(deps as any, request({})); // empty body on purpose
    expect(res.status).toBe(501);
    expect((res.body as any).error.code).toBe('NOT_IMPLEMENTED');

    const anon = await runCreateJoinLink(
      { ...deps, getAuthApi: async () => ({ getSession: async () => null }) } as any,
      request({}),
    );
    expect(anon.status).toBe(401);
    expect((anon.body as any).error.code).toBe('UNAUTHENTICATED');
  });

  it('the join goes through addMember and NOTHING writes sys_member directly', async () => {
    const engine = recordingEngine();
    const addMember = vi.fn(async (opts: any) => ({ id: 'mem_new', userId: opts.body.userId }));
    const deps = {
      getAuthApi: async () => ({
        getSession: async () => VERIFIED_SESSION,
        hasPermission: async () => ({ success: true }),
        addMember,
      }),
      getDataEngine: () => engine as any,
      getCounterStore: async () => passthroughStore(),
    };
    const res = await runAcceptJoinLink(deps as any, request({ token: 'tok_live' }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // The governed path: exactly one vendor call, role PINNED to member,
    // organization explicit — and zero direct sys_member writes from us.
    expect(addMember).toHaveBeenCalledTimes(1);
    expect(addMember).toHaveBeenCalledWith({
      body: { userId: 'usr_1', role: 'member', organizationId: 'org_x' },
    });
    expect(engine.writes.filter((w) => w.object === 'sys_member')).toHaveLength(0);
    // The only write is the use_count bump on the link row.
    expect(engine.writes).toEqual([
      { op: 'update', object: 'sys_join_link', data: { id: 'jlnk_1', use_count: 1 } },
    ]);
  });

  it('the vendor already-a-member refusal collapses to idempotent success (the concurrent-join race)', async () => {
    const engine = recordingEngine();
    const deps = {
      getAuthApi: async () => ({
        getSession: async () => VERIFIED_SESSION,
        hasPermission: async () => ({ success: true }),
        addMember: async () => {
          const err: any = new Error('already');
          err.body = { code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION' };
          err.statusCode = 400;
          throw err;
        },
      }),
      getDataEngine: () => engine as any,
      getCounterStore: async () => passthroughStore(),
    };
    const res = await runAcceptJoinLink(deps as any, request({ token: 'tok_live' }));
    expect(res.status).toBe(200);
    expect((res.body as any).data.alreadyMember).toBe(true);
    // No use_count bump for a join that did not add anyone.
    expect(engine.writes).toEqual([]);
  });

  it(`info rate limit: request ${JOIN_LINK_INFO_RATE_LIMIT + 1} in one window → 429 RATE_LIMIT_EXCEEDED`, async () => {
    const store = passthroughStore();
    const engine = recordingEngine();
    const deps = {
      getAuthApi: async () => ({ getSession: async () => null }),
      getDataEngine: () => engine as any,
      getCounterStore: async () => store,
    };
    const url = 'http://x/api/v1/auth/organization/get-join-link-info?token=tok_live';
    let last: any;
    for (let i = 0; i < JOIN_LINK_INFO_RATE_LIMIT; i += 1) {
      last = await runGetJoinLinkInfo(deps as any, request(undefined, url));
      expect(last.status, `probe ${i + 1} inside the budget`).toBe(200);
    }
    const over = await runGetJoinLinkInfo(deps as any, request(undefined, url));
    expect(over.status).toBe(429);
    expect((over.body as any).error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it(`accept rate limit: attempt ${JOIN_LINK_ACCEPT_RATE_LIMIT + 1} in one window → 429, keyed per caller`, async () => {
    const store = passthroughStore();
    const engine = recordingEngine({ members: [{ organization_id: 'org_x', user_id: 'usr_1', id: 'm1' }] });
    const deps = {
      getAuthApi: async () => ({
        getSession: async () => VERIFIED_SESSION,
        hasPermission: async () => ({ success: true }),
        addMember: async () => ({}),
      }),
      getDataEngine: () => engine as any,
      getCounterStore: async () => store,
    };
    for (let i = 0; i < JOIN_LINK_ACCEPT_RATE_LIMIT; i += 1) {
      const res = await runAcceptJoinLink(deps as any, request({ token: 'tok_live' }));
      expect(res.status, `attempt ${i + 1} inside the budget`).toBe(200);
    }
    const over = await runAcceptJoinLink(deps as any, request({ token: 'tok_live' }));
    expect(over.status).toBe(429);
    expect((over.body as any).error.code).toBe('RATE_LIMIT_EXCEEDED');

    // A DIFFERENT caller is not starved by usr_1's window.
    const other = await runAcceptJoinLink(
      {
        ...deps,
        getAuthApi: async () => ({
          getSession: async () => ({ user: { id: 'usr_2', emailVerified: true }, session: {} }),
          hasPermission: async () => ({ success: true }),
          addMember: async () => ({ id: 'mem_2' }),
        }),
      } as any,
      request({ token: 'tok_live' }),
    );
    expect(other.status, JSON.stringify(other.body)).toBe(200);
  });
});
