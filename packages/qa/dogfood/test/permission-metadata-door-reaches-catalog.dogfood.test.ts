// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A permission set saved through the METADATA door is what the security catalog
// serves, on the real composition: a create, an edit and a delete each reach the
// by-name read the authorization resolver uses (ADR-0131 D3), and a grant naming
// the set is accepted exactly while the catalog holds it (ADR-0131 D4).
//
// ## Why this exists
//
// Until C3 stage 8 the `permission` mutation projector rode along on every save:
// it mirrored the body into a `sys_permission_set` row and, gated on that row
// write, echoed the body into the metadata service's in-memory registry. Stage
// 8 retires the row object and unwires the projector, so this pins the premise
// that ruling rested on — the metadata door's own registry write-through, and
// nothing the projector did, is what puts a saved set in the catalog. It holds
// with the projector wired and without it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { createSecurityCatalogReader } from '@objectstack/core';
import { bootShowcase } from './showcase-boot.js';

const SET = 'door_reach_auditor';
const SYS = { context: { isSystem: true } } as const;

describe('a metadata-door permission save reaches the security catalog (ADR-0131 D3/D4)', () => {
  let stack: VerifyStack;
  let admin: string;
  let reader: ReturnType<typeof createSecurityCatalogReader>;
  let ql: any;
  let userId: string;

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    await stack.signUp('door-reach@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    reader = createSecurityCatalogReader({ registry: ql.registry, metadata: stack.kernel.getService('metadata') });
    userId = (await ql.findOne('sys_user', { where: { email: 'door-reach@verify.test' }, ...SYS }))?.id;
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  const grant = (id: string) =>
    stack.apiAs(admin, 'POST', '/data/sys_user_permission_set', { id, user_id: userId, permission_set: SET });

  it('PRECONDITION: the name is held by nobody, so a grant naming it is refused', async () => {
    expect(userId).toBeTruthy();
    expect(await reader.resolve('permission', SET)).toBeUndefined();
    const refused = await grant('ups_door_before');
    expect(refused.status, await refused.clone().text()).toBe(400);
  });

  it('a create: the catalog serves the saved body, and a grant naming it is accepted', async () => {
    const saved = await stack.apiAs(admin, 'PUT', `/meta/permission/${SET}`, {
      name: SET, label: 'Door v1', objects: { sys_user: { allowRead: true } },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);

    const entry = await reader.resolve('permission', SET);
    expect(entry?.definition).toMatchObject({ name: SET, label: 'Door v1', objects: { sys_user: { allowRead: true } } });

    const accepted = await grant('ups_door_after');
    expect(accepted.status, await accepted.clone().text()).toBeLessThan(300);
  });

  it('an edit: the catalog serves the new body, not the one first saved', async () => {
    const saved = await stack.apiAs(admin, 'PUT', `/meta/permission/${SET}`, {
      name: SET, label: 'Door v2', objects: {},
    });
    expect(saved.status, await saved.clone().text()).toBe(200);

    const entry = await reader.resolve('permission', SET);
    expect(entry?.definition).toMatchObject({ name: SET, label: 'Door v2' });
    expect((entry?.definition as { objects?: Record<string, unknown> }).objects ?? {}).not.toHaveProperty('sys_user');
  });

  it('a delete: the catalog no longer serves the name', async () => {
    await ql.delete('sys_user_permission_set', { where: { id: 'ups_door_after' }, ...SYS });
    const deleted = await stack.apiAs(admin, 'DELETE', `/meta/permission/${SET}`);
    expect(deleted.status, await deleted.clone().text()).toBeLessThan(300);

    expect(await reader.resolve('permission', SET)).toBeUndefined();
    const refused = await grant('ups_door_gone');
    expect(refused.status, await refused.clone().text()).toBe(400);
  });
});
