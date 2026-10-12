// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D3 · #15204 W3] The walled catalog refusal at the remaining
// `/packages` write doors, on a REAL booted stack.
//
// What this harness measured before the refusal, under both walled postures
// (6117740670): organization A's owner holds `manage_metadata` inside
// organization A only (rung `TENANT_ADMIN`). The operator authored a permission
// set in a writable runtime package and published it; organization B's member
// holds that set. Then A:
//   - `POST /packages/:id/publish-drafts` published the operator's pending
//     draft adding `manage_users`: `200`, and B's member gained `manage_users`;
//   - `POST /packages/:id/rollback` and `POST /packages/:id/commits/:c/revert`
//     undid the operator's published change: `200`, and B's member lost it;
//   - `POST /packages/:id/duplicate` copied the set, under the same name, into
//     A's own package, and `GET /meta` then served A's copy;
//   - `POST /packages/:id/revert` discarded the operator's pending draft;
//   - `POST /packages/:id/adopt-orphans` moved the environment's catalog rows
//     into A's package.
//
// Pinned here, under each walled posture: every one of those answers
// `403 PERMISSION_DENIED`, nothing moves, and B's resolution stays. The commit
// revert is judged by the commit's own items, whatever package the URL names.
// CONTROLS: A runs every one of these doors on its own catalog-free package as
// before, and the platform operator runs them on the catalog-carrying one.
// And under `single` (CONTROL): the same `manage_metadata` holder runs them on
// the operator's package as before.
//
// The boot is `multiTenant: 'posture-only'`: a real, non-degraded walled
// posture. The harness declares the seeded admin as `OS_PLATFORM_OWNER_EMAIL`,
// so that admin is the platform operator.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { isSystem: true, positions: [], permissions: [] };

interface Engine {
  find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

/** The ADR-0112 envelope a refusal answered: `error.code`, the message and the HTTP status. */
async function envelopeOf(res: Response): Promise<{ status: number; code: unknown; message: string }> {
  const body = (await res.clone().json().catch(() => ({}))) as { error?: { code?: unknown; message?: unknown } };
  return { status: res.status, code: body?.error?.code, message: String(body?.error?.message ?? '') };
}

const set = (name: string, systemPermissions: string[]) => ({ name, label: name, objects: {}, systemPermissions });
const dashboard = (name: string, label: string) => ({ name, label, columns: 12, widgets: [] });

const META_AUTHOR = 'w3_meta_author';
const OP_PKG = 'com.w3.operator';
const OP_SET = 'w3_operator_set';
const ENV_SET = 'w3_env_set';

interface Harness {
  stack: VerifyStack;
  ql: Engine;
  operator: string;
  tokA: string;
  userA: string;
  userB: string;
  orgA?: string;
  orgB?: string;
  /** The operator's first publish of `OP_SET` (systemPermissions []). */
  c1: string;
  /** The operator's second publish of `OP_SET` (adds `manage_users`). */
  c2: string;
}

async function call(stack: VerifyStack, token: string, method: string, path: string, body?: unknown) {
  return stack.apiAs(token, method, path, body);
}

/** The commit ids of a package, newest first. */
async function commitIds(stack: VerifyStack, token: string, pkg: string): Promise<string[]> {
  const res = await call(stack, token, 'GET', `/packages/${pkg}/commits`);
  expect(res.status, await res.clone().text()).toBe(200);
  const json = (await res.json()) as { data?: { commits?: Array<{ id: string }> } };
  return (json.data?.commits ?? []).map((c) => c.id);
}

/**
 * Boot, sign in the operator, A and B; under a wall each gets an organization.
 * The operator creates `OP_PKG`, publishes `OP_SET` twice (c1 with no
 * capability, c2 adding `manage_users`) and leaves a third draft pending
 * (adding `manage_metadata`); B holds `OP_SET`, so B resolves `manage_users`.
 * The operator also saves `ENV_SET` with no package (an orphan). A holds
 * `manage_metadata` (inside org A under a wall).
 */
async function boot(posture: 'isolated' | 'group' | 'single'): Promise<Harness> {
  const walled = posture !== 'single';
  if (walled) process.env.OS_TENANCY_POSTURE = posture;
  else delete process.env.OS_TENANCY_POSTURE;
  const stack = await bootStack(crmStack as never, walled ? { multiTenant: 'posture-only' } : {});
  const ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;
  const operator = await stack.signIn();
  const tokA = await stack.signUp(`w3-a-${posture}@wall.test`);
  const tokB = await stack.signUp(`w3-b-${posture}@wall.test`);
  const h: Harness = { stack, ql, operator, tokA, userA: '', userB: '', c1: '', c2: '' };
  if (walled) {
    for (const [tok, slug] of [[tokA, `w3-a-${posture}`], [tokB, `w3-b-${posture}`]] as const) {
      const created = await call(stack, tok, 'POST', '/auth/organization/create', { name: slug, slug });
      expect(created.status, await created.clone().text()).toBe(200);
      const id = ((await created.json()) as { id: string }).id;
      if (tok === tokA) h.orgA = id; else h.orgB = id;
      const active = await call(stack, tok, 'POST', '/auth/organization/set-active', { organizationSlug: slug });
      expect(active.status, await active.clone().text()).toBe(200);
    }
  }
  const idOf = async (email: string) =>
    String((await ql.find('sys_user', { where: { email }, limit: 1, context: SYS }))[0]?.id);
  h.userA = await idOf(`w3-a-${posture}@wall.test`);
  h.userB = await idOf(`w3-b-${posture}@wall.test`);

  const ok = async (res: Response, status = 200) => expect(res.status, await res.clone().text()).toBe(status);
  await ok(await call(stack, operator, 'POST', '/packages', { id: OP_PKG, name: 'w3 operator', version: '1.0.0', type: 'app' }), 201);
  // META_AUTHOR lives in the operator's package, so the orphan adoption below
  // reads ENV_SET alone as the environment's catalog orphan this file adds.
  await ok(await call(stack, operator, 'PUT', `/meta/permission/${META_AUTHOR}?package=${OP_PKG}`, set(META_AUTHOR, ['manage_metadata'])));
  await ok(await call(stack, operator, 'PUT', `/meta/permission/${OP_SET}?package=${OP_PKG}&mode=draft`, set(OP_SET, [])));
  await ok(await call(stack, operator, 'POST', `/packages/${OP_PKG}/publish-drafts`, {}));
  h.c1 = (await commitIds(stack, operator, OP_PKG))[0]!;
  await ok(await call(stack, operator, 'PUT', `/meta/permission/${OP_SET}?package=${OP_PKG}&mode=draft`, set(OP_SET, ['manage_users'])));
  await ok(await call(stack, operator, 'POST', `/packages/${OP_PKG}/publish-drafts`, {}));
  h.c2 = (await commitIds(stack, operator, OP_PKG))[0]!;
  await ok(await call(stack, operator, 'PUT', `/meta/permission/${OP_SET}?package=${OP_PKG}&mode=draft`, set(OP_SET, ['manage_users', 'manage_metadata'])));
  await ok(await call(stack, operator, 'PUT', `/meta/permission/${ENV_SET}`, set(ENV_SET, [])));

  const grant = (user: string, permissionSet: string, org: string | undefined) =>
    ql.insert('sys_user_permission_set', { user_id: user, permission_set: permissionSet, ...(org ? { organization_id: org } : {}) },
      { context: { ...SYS, ...(org ? { tenantId: org } : {}) } });
  await grant(h.userA, META_AUTHOR, h.orgA);
  await grant(h.userB, OP_SET, h.orgB);
  return h;
}

const grantsOf = (h: Harness, user: string, org: string | undefined) =>
  resolveUserAuthzGrants(h.ql as never, user, org ? { tenantId: org } : {});

const rowsOf = (h: Harness, where: Record<string, unknown>) => h.ql.find('sys_metadata', { where, context: SYS });

for (const posture of ['isolated', 'group'] as const) {
  describe(`[ADR-0131 D3 · #15204 W3] ${posture}: the /packages write doors refuse a tenant the operator's catalog items`, () => {
    let h: Harness;
    const previous = process.env.OS_TENANCY_POSTURE;
    const bGrants = () => grantsOf(h, h.userB, h.orgB);
    const refused = async (res: Response) => {
      const env = await envelopeOf(res);
      expect({ status: env.status, code: env.code }, env.message).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect(env.message).toContain(`'${posture}'`);
      expect(env.message).toContain('ADR-0131 D3');
    };

    beforeAll(async () => { h = await boot(posture); }, 180_000);
    afterAll(async () => {
      await h?.stack?.stop?.();
      if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previous;
    });

    it('guard the guard: a real walled posture; A holds `manage_metadata` in org A, below the operator; B resolves `manage_users` through the operator\'s set, with a draft pending', async () => {
      const tenancy = await h.stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
      expect(tenancy.posture).toBe(posture);
      expect(tenancy.degraded).toBe(false);
      const a = await grantsOf(h, h.userA, h.orgA);
      expect(a.systemPermissions).toContain('manage_metadata');
      expect(a.posture).not.toBe('PLATFORM_ADMIN');
      const b = await bGrants();
      expect(b.permissions).toContain(OP_SET);
      expect(b.systemPermissions).toContain('manage_users');
      expect(b.systemPermissions).not.toContain('manage_metadata');
      expect(h.c1).not.toBe(h.c2);
      expect(await rowsOf(h, { package_id: OP_PKG, type: 'permission', name: OP_SET, state: 'draft' })).toHaveLength(1);
    });

    it('publish-drafts: A publishing the operator\'s pending catalog draft is refused, and B does not gain `manage_metadata`', async () => {
      await refused(await call(h.stack, h.tokA, 'POST', `/packages/${OP_PKG}/publish-drafts`, {}));
      expect((await bGrants()).systemPermissions).not.toContain('manage_metadata');
      expect(await rowsOf(h, { package_id: OP_PKG, type: 'permission', name: OP_SET, state: 'draft' })).toHaveLength(1);
    });

    it('revert: A discarding the operator\'s pending catalog draft is refused, and the draft stays', async () => {
      await refused(await call(h.stack, h.tokA, 'POST', `/packages/${OP_PKG}/revert`, {}));
      expect(await rowsOf(h, { package_id: OP_PKG, type: 'permission', name: OP_SET, state: 'draft' })).toHaveLength(1);
    });

    it('rollback: A rolling the operator\'s package back past a catalog commit is refused, and B keeps `manage_users`', async () => {
      await refused(await call(h.stack, h.tokA, 'POST', `/packages/${OP_PKG}/rollback`, { commitId: h.c1 }));
      expect((await bGrants()).systemPermissions).toContain('manage_users');
    });

    it('commits/:commitId/revert: A reverting the operator\'s catalog commit is refused, and B keeps `manage_users`', async () => {
      await refused(await call(h.stack, h.tokA, 'POST', `/packages/${OP_PKG}/commits/${h.c2}/revert`, {}));
      expect((await bGrants()).systemPermissions).toContain('manage_users');
    });

    it('commits/:commitId/revert: the commit is judged by its own items, whatever package the URL names', async () => {
      const own = await call(h.stack, h.tokA, 'POST', '/packages', { id: 'com.w3.a.url', name: 'url', version: '1.0.0', type: 'app' });
      expect(own.status, await own.clone().text()).toBe(201);
      await refused(await call(h.stack, h.tokA, 'POST', `/packages/com.w3.a.url/commits/${h.c2}/revert`, {}));
      expect((await bGrants()).systemPermissions).toContain('manage_users');
    });

    it('duplicate: A copying the operator\'s catalog-carrying package is refused, and nothing is copied', async () => {
      await refused(await call(h.stack, h.tokA, 'POST', `/packages/${OP_PKG}/duplicate`, { targetPackageId: 'com.w3.dup' }));
      expect(await rowsOf(h, { package_id: 'com.w3.dup' })).toHaveLength(0);
    });

    it('adopt-orphans: A adopting the environment\'s catalog orphans into its own package is refused, and the orphan stays unbound', async () => {
      const own = await call(h.stack, h.tokA, 'POST', '/packages', { id: 'com.w3.a.adopt', name: 'adopt', version: '1.0.0', type: 'app' });
      expect(own.status, await own.clone().text()).toBe(201);
      await refused(await call(h.stack, h.tokA, 'POST', '/packages/com.w3.a.adopt/adopt-orphans', {}));
      const env = await rowsOf(h, { type: 'permission', name: ENV_SET });
      expect(env.map((r) => r.package_id ?? null)).not.toContain('com.w3.a.adopt');
    });

    it('CONTROL: A runs every one of these doors on its own catalog-free package as before', async () => {
      const pkg = 'com.w3.a.free';
      const dash = 'w3_free_dash';
      const ok = async (res: Response) => expect(res.status, await res.clone().text()).toBe(200);
      expect((await call(h.stack, h.tokA, 'POST', '/packages', { id: pkg, name: 'free', version: '1.0.0', type: 'app' })).status).toBe(201);
      await ok(await call(h.stack, h.tokA, 'PUT', `/meta/dashboard/${dash}?package=${pkg}&mode=draft`, dashboard(dash, 'v1')));
      await ok(await call(h.stack, h.tokA, 'POST', `/packages/${pkg}/publish-drafts`, {}));
      const first = (await commitIds(h.stack, h.tokA, pkg))[0]!;
      await ok(await call(h.stack, h.tokA, 'PUT', `/meta/dashboard/${dash}?package=${pkg}&mode=draft`, dashboard(dash, 'v2')));
      await ok(await call(h.stack, h.tokA, 'POST', `/packages/${pkg}/publish-drafts`, {}));
      const second = (await commitIds(h.stack, h.tokA, pkg))[0]!;
      await ok(await call(h.stack, h.tokA, 'POST', `/packages/${pkg}/commits/${second}/revert`, {}));
      await ok(await call(h.stack, h.tokA, 'POST', `/packages/${pkg}/rollback`, { commitId: first }));
      await ok(await call(h.stack, h.tokA, 'PUT', `/meta/dashboard/${dash}?package=${pkg}&mode=draft`, dashboard(dash, 'v3')));
      await ok(await call(h.stack, h.tokA, 'POST', `/packages/${pkg}/revert`, {}));
      await ok(await call(h.stack, h.tokA, 'POST', `/packages/${pkg}/duplicate`, { targetPackageId: 'com.w3.a.free.copy' }));
    });

    it('CONTROL: the platform operator runs every one of these doors on its catalog-carrying package', async () => {
      const ok = async (res: Response) => expect(res.status, await res.clone().text()).toBe(200);
      await ok(await call(h.stack, h.operator, 'POST', `/packages/${OP_PKG}/duplicate`, { targetPackageId: 'com.w3.op.copy' }));
      await ok(await call(h.stack, h.operator, 'POST', `/packages/${OP_PKG}/revert`, {}));
      await ok(await call(h.stack, h.operator, 'POST', `/packages/${OP_PKG}/commits/${h.c2}/revert`, {}));
      expect((await bGrants()).systemPermissions).not.toContain('manage_users');
      await ok(await call(h.stack, h.operator, 'PUT', `/meta/permission/${OP_SET}?package=${OP_PKG}&mode=draft`, set(OP_SET, ['manage_users'])));
      await ok(await call(h.stack, h.operator, 'POST', `/packages/${OP_PKG}/publish-drafts`, {}));
      expect((await bGrants()).systemPermissions).toContain('manage_users');
      await ok(await call(h.stack, h.operator, 'POST', `/packages/${OP_PKG}/rollback`, { commitId: h.c1 }));
      expect((await bGrants()).systemPermissions).not.toContain('manage_users');
      const own = await call(h.stack, h.operator, 'POST', '/packages', { id: 'com.w3.op.oporphans', name: 'adopt', version: '1.0.0', type: 'app' });
      expect(own.status, await own.clone().text()).toBe(201);
      await ok(await call(h.stack, h.operator, 'POST', '/packages/com.w3.op.oporphans/adopt-orphans', {}));
    });
  });
}

describe('[ADR-0131 D3 · #15204 W3] single (CONTROL): the refusal is inert', () => {
  let h: Harness;
  const previous = process.env.OS_TENANCY_POSTURE;

  beforeAll(async () => { h = await boot('single'); }, 180_000);
  afterAll(async () => {
    await h?.stack?.stop?.();
    if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = previous;
  });

  it('a `manage_metadata` holder below the operator runs every one of these doors on the operator\'s package as before', async () => {
    const a = await grantsOf(h, h.userA, undefined);
    expect(a.systemPermissions).toContain('manage_metadata');
    expect(a.posture).not.toBe('PLATFORM_ADMIN');
    const ok = async (res: Response) => expect(res.status, await res.clone().text()).toBe(200);
    await ok(await call(h.stack, h.tokA, 'POST', `/packages/${OP_PKG}/duplicate`, { targetPackageId: 'com.w3.dup' }));
    await ok(await call(h.stack, h.tokA, 'POST', `/packages/${OP_PKG}/publish-drafts`, {}));
    await ok(await call(h.stack, h.tokA, 'POST', `/packages/${OP_PKG}/rollback`, { commitId: h.c1 }));
    await ok(await call(h.stack, h.tokA, 'POST', `/packages/${OP_PKG}/commits/${h.c1}/revert`, {}));
    await ok(await call(h.stack, h.tokA, 'POST', `/packages/${OP_PKG}/revert`, {}));
    expect((await call(h.stack, h.tokA, 'POST', '/packages', { id: 'com.w3.a.adopt', name: 'adopt', version: '1.0.0', type: 'app' })).status).toBe(201);
    await ok(await call(h.stack, h.tokA, 'POST', '/packages/com.w3.a.adopt/adopt-orphans', {}));
  });
});
