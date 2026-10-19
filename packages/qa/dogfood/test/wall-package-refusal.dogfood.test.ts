// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D3 · #15204 W2] The walled catalog refusal at the PACKAGE doors, on
// a REAL booted stack.
//
// ADR-0131 D3: under `group` / `isolated` "tenant admins cannot create or edit
// catalog items; the operator defines the catalog for every tenant (managed
// packages, Studio)". A package that declares a position, a permission set or
// a capability is the operator's instrument.
//
// What this harness measured before the refusal, under both walled postures:
// organization A's owner, granted `manage_metadata` inside organization A only
// (rung `TENANT_ADMIN`, never the platform operator):
//   - re-installed an operator-installed package at a new version through
//     `POST /api/v1/marketplace/install-local`, adding `manage_users` to a
//     permission set organization B's member holds: `200`, and B's member
//     resolved `manage_users` next;
//   - uninstalled it through `DELETE /api/v1/marketplace/install-local/:id`:
//     `200`, the set left the catalog and B's member lost it;
//   - deleted, through `DELETE /api/v1/packages/:id`, a writable runtime
//     package the operator had saved a permission set into
//     (`PUT /meta/permission/:name?package=`): `200`, the same loss for B.
// `install-local` also registered A's own catalog-carrying package
// environment-wide.
//
// Pinned here, under each walled posture:
//   - an install whose incoming version declares a catalog item, an upgrade
//     where either version declares one, and an uninstall of a package whose
//     installed version declares one answer `403 FORBIDDEN`, and B's
//     resolution does not move;
//   - the `/packages` delete of a package holding stored catalog items answers
//     `403 PERMISSION_DENIED`, and B's resolution does not move;
//   - [ADR-0131 D12 items 7–8] A catalog-free package is refused to A the same
//     way (ruling A on #23231 stops special-casing the catalog);
//   - CONTROLS: the platform operator upgrades, uninstalls and deletes the
//     catalog-carrying ones.
// And under `single` (CONTROL): the same `manage_metadata` holder, who is not
// the platform operator, does all of it as before.
//
// The boot is `multiTenant: 'posture-only'`: a real, non-degraded walled
// posture. The refusal keys on the posture and the caller's rung, never on row
// isolation. The harness declares the seeded admin as `OS_PLATFORM_OWNER_EMAIL`,
// so that admin is the platform operator.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildShapedArtifact } from './build-shaped-artifact.js';

const SYS = { isSystem: true, positions: [], permissions: [] };
const INSTALL_LOCAL = '/marketplace/install-local';

interface Engine {
  find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

/** The ADR-0112 envelope a refusal answered: `error.code`, the message and the HTTP status. */
async function envelopeOf(res: Response): Promise<{ status: number; code: unknown; message: string }> {
  const body = (await res.clone().json().catch(() => ({}))) as { error?: { code?: unknown; message?: unknown } };
  return { status: res.status, code: body?.error?.code, message: String(body?.error?.message ?? '') };
}

/** An install-local body for a tiny app stack, with the catalog items it declares. */
function packageBody(id: string, version: string, catalog: { permissions?: unknown[]; positions?: unknown[] } = {}) {
  const stackDef = {
    manifest: { id, name: id, version, type: 'app' },
    permissions: catalog.permissions ?? [],
    positions: catalog.positions ?? [],
  };
  const { artifact } = buildShapedArtifact(stackDef as unknown as Record<string, unknown>);
  return { manifest: { ...artifact, id, version } };
}

const set = (name: string, systemPermissions: string[]) => ({ name, label: name, objects: {}, systemPermissions });

const META_AUTHOR = 'w2_meta_author';
const OP_PKG = 'com.w2.operator';
const OP_SET = 'w2_operator_set';
const RT_PKG = 'com.w2.runtime';
const RT_SET = 'w2_runtime_set';

interface Harness {
  stack: VerifyStack;
  ql: Engine;
  operator: string;
  tokA: string;
  userA: string;
  userB: string;
  orgA?: string;
  orgB?: string;
}

/**
 * Boot, sign in the operator, A and B; under a wall each gets an organization.
 * The operator installs `OP_PKG` (carrying `OP_SET`), creates the writable
 * runtime package `RT_PKG` and saves `RT_SET` into it; B holds both sets; A
 * holds `manage_metadata` (inside org A under a wall).
 */
async function boot(posture: 'isolated' | 'group' | 'single'): Promise<Harness> {
  const walled = posture !== 'single';
  if (walled) process.env.OS_TENANCY_POSTURE = posture;
  else delete process.env.OS_TENANCY_POSTURE;
  const storageDir = mkdtempSync(join(tmpdir(), `w2-wall-package-${posture}-`));
  const stack = await bootStack(crmStack as never, {
    ...(walled ? { multiTenant: 'posture-only' as const } : {}),
    extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
  } as never);
  const ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;
  const operator = await stack.signIn();
  const tokA = await stack.signUp(`w2-a-${posture}@wall.test`);
  const tokB = await stack.signUp(`w2-b-${posture}@wall.test`);
  const h: Harness = { stack, ql, operator, tokA, userA: '', userB: '' };
  if (walled) {
    for (const [tok, slug] of [[tokA, `w2-a-${posture}`], [tokB, `w2-b-${posture}`]] as const) {
      const created = await stack.apiAs(tok, 'POST', '/auth/organization/create', { name: slug, slug });
      expect(created.status, await created.clone().text()).toBe(200);
      const id = ((await created.json()) as { id: string }).id;
      if (tok === tokA) h.orgA = id; else h.orgB = id;
      const active = await stack.apiAs(tok, 'POST', '/auth/organization/set-active', { organizationSlug: slug });
      expect(active.status, await active.clone().text()).toBe(200);
    }
  }
  const idOf = async (email: string) =>
    String((await ql.find('sys_user', { where: { email }, limit: 1, context: SYS }))[0]?.id);
  h.userA = await idOf(`w2-a-${posture}@wall.test`);
  h.userB = await idOf(`w2-b-${posture}@wall.test`);

  const saved = await stack.apiAs(operator, 'PUT', `/meta/permission/${META_AUTHOR}`, set(META_AUTHOR, ['manage_metadata']));
  expect(saved.status, await saved.clone().text()).toBe(200);
  const installed = await stack.apiAs(operator, 'POST', INSTALL_LOCAL, packageBody(OP_PKG, '1.0.0', { permissions: [set(OP_SET, [])] }));
  expect(installed.status, await installed.clone().text()).toBe(200);
  const created = await stack.apiAs(operator, 'POST', '/packages', { id: RT_PKG, name: 'w2 runtime', version: '1.0.0', type: 'app' });
  expect(created.status, await created.clone().text()).toBe(201);
  const authored = await stack.apiAs(operator, 'PUT', `/meta/permission/${RT_SET}?package=${RT_PKG}`, set(RT_SET, []));
  expect(authored.status, await authored.clone().text()).toBe(200);

  const grant = (user: string, permissionSet: string, org: string | undefined) =>
    ql.insert('sys_user_permission_set', { user_id: user, permission_set: permissionSet, ...(org ? { organization_id: org } : {}) },
      { context: { ...SYS, ...(org ? { tenantId: org } : {}) } });
  await grant(h.userA, META_AUTHOR, h.orgA);
  await grant(h.userB, OP_SET, h.orgB);
  await grant(h.userB, RT_SET, h.orgB);
  return h;
}

/**
 * [C8 stage 8b] The organization a `single` session is active in: the Default
 * Organization, which an organization-less system grant is now stamped with
 * (ADR-0131 D9). A precheck that resolves with no organization would read the
 * global arm only, which no fresh `single` install writes any more.
 */
const sessionOrgOf = async (h: Harness): Promise<string | undefined> =>
  (await (await h.stack.kernel.getServiceAsync<{ defaultOrgId(): Promise<string | null> }>('tenancy')).defaultOrgId()) ?? undefined;

const grantsOf = (h: Harness, user: string, org: string | undefined) =>
  resolveUserAuthzGrants(h.ql as never, user, org ? { tenantId: org } : {});

for (const posture of ['isolated', 'group'] as const) {
  describe(`[ADR-0131 D3 · #15204 W2] ${posture}: a catalog-carrying package is the platform operator's`, () => {
    let h: Harness;
    const previous = process.env.OS_TENANCY_POSTURE;
    const bGrants = () => grantsOf(h, h.userB, h.orgB);

    beforeAll(async () => { h = await boot(posture); }, 180_000);
    afterAll(async () => {
      await h?.stack?.stop?.();
      if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previous;
    });

    it('guard the guard: a real walled posture; A holds `manage_metadata` in org A and is not the platform operator; B holds both sets', async () => {
      const tenancy = await h.stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
      expect(tenancy.posture).toBe(posture);
      expect(tenancy.degraded).toBe(false);
      expect(h.orgA).toBeTruthy();
      expect(h.orgA).not.toBe(h.orgB);
      const a = await grantsOf(h, h.userA, h.orgA);
      expect(a.systemPermissions).toContain('manage_metadata');
      expect(a.posture).not.toBe('PLATFORM_ADMIN');
      const b = await bGrants();
      expect(b.permissions).toEqual(expect.arrayContaining([OP_SET, RT_SET]));
      expect(b.systemPermissions).not.toContain('manage_users');
    });

    it('install: A installing a package whose incoming version declares a permission set is refused 403 FORBIDDEN, naming the posture', async () => {
      const res = await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL,
        packageBody('com.w2.tenant', '1.0.0', { permissions: [set('w2_tenant_set', ['manage_users'])] }));
      const env = await envelopeOf(res);
      expect({ status: env.status, code: env.code }).toEqual({ status: 403, code: 'FORBIDDEN' });
      expect(env.message).toContain(`'${posture}'`);
      expect(env.message).toContain('ADR-0131 D3');
      const listed = await h.stack.apiAs(h.operator, 'GET', '/meta/permission/w2_tenant_set');
      expect(listed.status).toBe(404);
    });

    it('install: a position alone in the incoming version is refused the same way', async () => {
      const res = await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL,
        packageBody('com.w2.tenantpos', '1.0.0', { positions: [{ name: 'w2_tenant_pos', label: 'tenant pos' }] }));
      expect(await envelopeOf(res)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    });

    it('upgrade (the measured edge): A re-installing the operator\'s package with `manage_users` added is refused, and B does not gain it', async () => {
      const res = await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL,
        packageBody(OP_PKG, '1.1.0', { permissions: [set(OP_SET, ['manage_users'])] }));
      expect(await envelopeOf(res)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect((await bGrants()).systemPermissions).not.toContain('manage_users');
    });

    it('upgrade: a catalog-free incoming version over an installed catalog-carrying one is refused too, and B keeps the set', async () => {
      const res = await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL, packageBody(OP_PKG, '1.2.0'));
      expect(await envelopeOf(res)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect((await bGrants()).permissions).toContain(OP_SET);
    });

    it('uninstall (the measured edge): A uninstalling the operator\'s package is refused, and B keeps the set', async () => {
      const res = await h.stack.apiAs(h.tokA, 'DELETE', `${INSTALL_LOCAL}/${OP_PKG}`);
      expect(await envelopeOf(res)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect((await bGrants()).permissions).toContain(OP_SET);
    });

    it('/packages delete (the measured edge): A deleting a runtime package holding the operator\'s set is refused 403 PERMISSION_DENIED, and B keeps the set', async () => {
      const res = await h.stack.apiAs(h.tokA, 'DELETE', `/packages/${RT_PKG}`);
      const env = await envelopeOf(res);
      expect({ status: env.status, code: env.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect(env.message).toContain(`'${posture}'`);
      expect((await bGrants()).permissions).toContain(RT_SET);
      const still = await h.stack.apiAs(h.operator, 'GET', `/packages/${RT_PKG}`);
      expect(still.status).toBe(200);
    });

    it('[ADR-0131 D12 items 7–8] a catalog-free package is the platform operator\'s too: A\'s install, upgrade and uninstall answer 403 FORBIDDEN, and A\'s /packages delete 403 PERMISSION_DENIED; nothing moves', async () => {
      // Ruling A on #23231 stops special-casing the catalog: what was this
      // file's catalog-free CONTROL (A installs, upgrades, uninstalls and
      // deletes as before) is refused now, whatever the package carries.
      const installed = await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL, packageBody('com.w2.free', '1.0.0'));
      expect(await envelopeOf(installed)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
      const listedFree = await h.stack.apiAs(h.operator, 'GET', '/packages/com.w2.free');
      expect(listedFree.status).toBe(404);
      const opInstalled = await h.stack.apiAs(h.operator, 'POST', INSTALL_LOCAL, packageBody('com.w2.free2', '1.0.0'));
      expect(opInstalled.status, await opInstalled.clone().text()).toBe(200);
      const upgraded = await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL, packageBody('com.w2.free2', '1.1.0'));
      expect(await envelopeOf(upgraded)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
      const removed = await h.stack.apiAs(h.tokA, 'DELETE', `${INSTALL_LOCAL}/com.w2.free2`);
      expect(await envelopeOf(removed)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect((await h.stack.apiAs(h.operator, 'GET', '/packages/com.w2.free2')).status).toBe(200);
      const created = await h.stack.apiAs(h.operator, 'POST', '/packages', { id: 'com.w2.freert', name: 'free', version: '1.0.0', type: 'app' });
      expect(created.status, await created.clone().text()).toBe(201);
      const deleted = await h.stack.apiAs(h.tokA, 'DELETE', '/packages/com.w2.freert');
      expect(await envelopeOf(deleted)).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
      expect((await h.stack.apiAs(h.operator, 'GET', '/packages/com.w2.freert')).status).toBe(200);
    });

    it('CONTROL: the platform operator installs, upgrades and uninstalls a catalog-carrying package, and deletes one at /packages', async () => {
      // Its own packages, so this control reads the same whatever the refusal
      // pins above did to OP_PKG and RT_PKG.
      const pkg = 'com.w2.operator2';
      const opSet = 'w2_operator2_set';
      const installed = await h.stack.apiAs(h.operator, 'POST', INSTALL_LOCAL, packageBody(pkg, '1.0.0', { permissions: [set(opSet, [])] }));
      expect(installed.status, await installed.clone().text()).toBe(200);
      await h.ql.insert('sys_user_permission_set', { user_id: h.userB, permission_set: opSet, organization_id: h.orgB },
        { context: { ...SYS, tenantId: h.orgB } });
      const upgraded = await h.stack.apiAs(h.operator, 'POST', INSTALL_LOCAL,
        packageBody(pkg, '1.1.0', { permissions: [set(opSet, ['manage_users'])] }));
      expect(upgraded.status, await upgraded.clone().text()).toBe(200);
      expect((await bGrants()).systemPermissions).toContain('manage_users');
      const removed = await h.stack.apiAs(h.operator, 'DELETE', `${INSTALL_LOCAL}/${pkg}`);
      expect(removed.status, await removed.clone().text()).toBe(200);
      expect((await bGrants()).permissions).not.toContain(opSet);

      const rt = 'com.w2.runtime2';
      const created = await h.stack.apiAs(h.operator, 'POST', '/packages', { id: rt, name: 'w2 runtime 2', version: '1.0.0', type: 'app' });
      expect(created.status, await created.clone().text()).toBe(201);
      const authored = await h.stack.apiAs(h.operator, 'PUT', `/meta/permission/w2_runtime2_set?package=${rt}`, set('w2_runtime2_set', []));
      expect(authored.status, await authored.clone().text()).toBe(200);
      const deleted = await h.stack.apiAs(h.operator, 'DELETE', `/packages/${rt}`);
      expect(deleted.status, await deleted.clone().text()).toBe(200);
    });
  });
}

describe('[ADR-0131 D3 · #15204 W2] single (CONTROL): the refusal is inert', () => {
  let h: Harness;
  const previous = process.env.OS_TENANCY_POSTURE;

  beforeAll(async () => { h = await boot('single'); }, 180_000);
  afterAll(async () => {
    await h?.stack?.stop?.();
    if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = previous;
  });

  it('a `manage_metadata` holder below the operator installs, upgrades and uninstalls catalog-carrying packages, and deletes one at /packages', async () => {
    const a = await grantsOf(h, h.userA, await sessionOrgOf(h));
    expect(a.systemPermissions).toContain('manage_metadata');
    expect(a.posture).not.toBe('PLATFORM_ADMIN');
    const installed = await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL,
      packageBody('com.w2.tenant', '1.0.0', { permissions: [set('w2_tenant_set', [])] }));
    expect(installed.status, await installed.clone().text()).toBe(200);
    const upgraded = await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL,
      packageBody(OP_PKG, '1.1.0', { permissions: [set(OP_SET, ['manage_users'])] }));
    expect(upgraded.status, await upgraded.clone().text()).toBe(200);
    expect((await grantsOf(h, h.userB, await sessionOrgOf(h))).systemPermissions).toContain('manage_users');
    const removed = await h.stack.apiAs(h.tokA, 'DELETE', `${INSTALL_LOCAL}/${OP_PKG}`);
    expect(removed.status, await removed.clone().text()).toBe(200);
    const deleted = await h.stack.apiAs(h.tokA, 'DELETE', `/packages/${RT_PKG}`);
    expect(deleted.status, await deleted.clone().text()).toBe(200);
  });
});
