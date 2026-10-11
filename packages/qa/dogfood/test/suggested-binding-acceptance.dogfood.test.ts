// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0090 D5/D7, #22801 → A] The suggested-binding ACCEPTANCE on a real
// booted showcase: a package's `isDefault: true` permission set reaches every
// signed-in member only through one deployment-level acceptance by a
// `manage_metadata` holder, and the acceptance takes effect.
//
// The boot runs a VANILLA SecurityPlugin, so the showcase's own default set
// (`showcase_member_default`) is not the configured baseline: it is a package
// declaration the deployment has not decided yet — exactly what an installed
// marketplace package's default is.
//
// What only a boot can measure, and so what this file pins:
//
//   - a member's reads of the showcase's objects go 403 → 200 when a
//     `manage_metadata` holder accepts, and back to 403 when they revoke;
//   - a tenant administrator's accept is refused (#22621 → A);
//   - a set carrying a bit the `everyone` anchor forbids is refused loudly at
//     the accept (ADR-0090 D7), with ADR-0112's code and status;
//   - anti-vacuity: the `everyone` definition the resolver reads really
//     changes, it is still the security plugin's own declaration, and no
//     caller wrote it — the metadata door still refuses it and no stored
//     definition shadows it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { securityCatalogReaderOf } from '@objectstack/core';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM_CTX = { isSystem: true };
const SECURITY_PACKAGE = 'com.objectstack.plugin-security';
/** The showcase's `isDefault` set, and an object only it grants a member. */
const DEFAULT_SET = 'showcase_member_default';
const OBJECT = 'showcase_account';
/** A package default carrying a bit the `everyone` anchor forbids. */
const RISKY_SET = 'dogfood_risky_default';

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit, context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** The membership row the sign-up reconciler writes lands asynchronously. */
async function waitForMembership(ql: any, userId: string): Promise<any> {
  for (let i = 0; i < 40; i++) {
    const rows = await findRows(ql, 'sys_member', { user_id: userId }, 5);
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sys_member row appeared for ${userId}`);
}

describe('#22801 → A — the suggested-binding acceptance takes effect, on a booted showcase', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let memberToken: string;
  let tenantAdminToken: string;

  const everyone = async (): Promise<{ sets: string[]; packageId?: string }> => {
    const entry = await securityCatalogReaderOf(ql)?.resolve('position', 'everyone');
    return { sets: (entry?.definition.permissionSets as string[] | undefined) ?? [], packageId: entry?.packageId };
  };
  const memberRead = async () => (await stack.apiAs(memberToken, 'GET', `/data/${OBJECT}`)).status;
  const listed = async (token: string) => stack.apiAs(token, 'GET', '/security/suggested-bindings');
  const suggestionFor = async (set: string) => {
    const res = await listed(adminToken);
    expect(res.status, await res.clone().text()).toBe(200);
    const rows: any[] = (await res.json()).data.suggestions;
    const row = rows.find((r) => r.permission_set_name === set);
    expect(row, `no suggestion row for ${set}: ${JSON.stringify(rows)}`).toBeTruthy();
    return row;
  };

  beforeAll(async () => {
    stack = await bootShowcase({ security: new SecurityPlugin() });
    adminToken = await stack.signIn(); // the seeded platform administrator: holds `manage_metadata`
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    memberToken = await stack.signUp('member.22801@example.com', 'Member!Pass123', 'Member 22801');
    const [member] = await findRows(ql, 'sys_user', { email: 'member.22801@example.com' }, 1);
    await waitForMembership(ql, String(member.id));

    // A tenant administrator: the Default Organization's `admin` membership,
    // which grants the organization's administration and no `manage_metadata`.
    await stack.signUp('orgadmin.22801@example.com', 'OrgAdmin!Pass123', 'Org Admin 22801');
    const [orgAdmin] = await findRows(ql, 'sys_user', { email: 'orgadmin.22801@example.com' }, 1);
    const membership = await waitForMembership(ql, String(orgAdmin.id));
    await ql.update('sys_member', { id: membership.id, role: 'admin' }, { context: SYSTEM_CTX });
    tenantAdminToken = await stack.signIn('orgadmin.22801@example.com', 'OrgAdmin!Pass123');

    // A package default the anchor must refuse, declared under the showcase's
    // own package id through the registry's own seam.
    const packageId = (await suggestionFor(DEFAULT_SET)).package_id;
    ql.registry.registerItem(
      'permission',
      { name: RISKY_SET, label: 'Risky default', isDefault: true, objects: { [OBJECT]: { allowRead: true, viewAllRecords: true } } },
      'name',
      packageId,
    );
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('CONTROL: before any acceptance the set is a pending suggestion and a member is refused', async () => {
    expect((await suggestionFor(DEFAULT_SET)).status).toBe('pending');
    expect((await everyone()).sets).not.toContain(DEFAULT_SET);
    expect(await memberRead()).toBe(403);
  });

  it('a tenant administrator cannot list or accept — 403 PERMISSION_DENIED, nothing changes', async () => {
    const id = (await suggestionFor(DEFAULT_SET)).id;
    const list = await listed(tenantAdminToken);
    expect(list.status, await list.clone().text()).toBe(403);
    const res = await stack.apiAs(tenantAdminToken, 'POST', `/security/suggested-bindings/${id}/confirm`);
    const text = await res.clone().text();
    expect(res.status, text).toBe(403);
    expect(JSON.parse(text).error.code).toBe('PERMISSION_DENIED');
    expect((await suggestionFor(DEFAULT_SET)).status).toBe('pending');
    expect((await everyone()).sets).not.toContain(DEFAULT_SET);
  });

  it('a set carrying a bit the everyone anchor forbids is refused loudly at the accept (ADR-0090 D7)', async () => {
    const row = await suggestionFor(RISKY_SET);
    const res = await stack.apiAs(adminToken, 'POST', `/security/suggested-bindings/${row.id}/confirm`);
    const text = await res.clone().text();
    expect(res.status, text).toBe(403);
    expect(JSON.parse(text).error.code).toBe('PERMISSION_DENIED');
    expect((await suggestionFor(RISKY_SET)).status).toBe('pending');
    expect((await everyone()).sets).not.toContain(RISKY_SET);
  });

  it('a manage_metadata holder\'s accept takes effect: everyone carries the set and a member\'s read goes 403 → 200', async () => {
    const before = await everyone();
    const row = await suggestionFor(DEFAULT_SET);
    const res = await stack.apiAs(adminToken, 'POST', `/security/suggested-bindings/${row.id}/confirm`);
    const text = await res.clone().text();
    expect(res.status, text).toBe(200);
    const body = JSON.parse(text).data;
    expect(body.bindingCreated).toBe(true);
    expect(body.suggestion).toMatchObject({ status: 'confirmed' });

    // ANTI-VACUITY: the definition really changed …
    const after = await everyone();
    expect(after.sets).toEqual([...before.sets, DEFAULT_SET]);
    // … it is still the security plugin's own declaration …
    expect(after.packageId).toBe(SECURITY_PACKAGE);
    // … no stored definition shadows it, and the door still refuses a write.
    expect(await findRows(ql, 'sys_metadata', { type: 'position', name: 'everyone' }, 5)).toEqual([]);
    const put = await stack.apiAs(adminToken, 'PUT', '/meta/position/everyone', {
      name: 'everyone', label: 'Everyone', permissionSets: after.sets,
    });
    expect(put.status, await put.clone().text()).toBe(403);

    expect(await memberRead()).toBe(200);
  });

  it('revoking the acceptance re-derives everyone without the set, and the member is refused again', async () => {
    const row = await suggestionFor(DEFAULT_SET);
    const res = await stack.apiAs(adminToken, 'POST', `/security/suggested-bindings/${row.id}/dismiss`);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await everyone()).sets).not.toContain(DEFAULT_SET);
    expect(await memberRead()).toBe(403);
  });
});
