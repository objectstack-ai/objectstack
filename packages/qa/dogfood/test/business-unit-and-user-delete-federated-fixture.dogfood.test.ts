// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21918] With a federated object provisioned, an admin deletes a business
 * unit and a user through the platform's own doors, and each answers 200.
 *
 * ## What was broken
 *
 * Deleting a record runs the engine's referential cascade scan
 * (`ObjectQL.cascadeDeleteRelations`), which probes every registered `lookup`
 * that references the deleted object. The registry injects the platform's
 * anchors into a federated (ADR-0015 `external`) object too: the tenant anchor
 * `organization_id`, the ADR-0117 D1 anchor `owning_business_unit_id`, and the
 * owner and audit lookups `owner_id` / `created_by` / `updated_by`. None of them
 * exists on the remote table. #21910 taught the scan to skip the tenant anchor
 * alone, so on the showcase with its federated fixture:
 *
 *  - an admin's `DELETE /api/v1/data/sys_business_unit/:id` answered 400, the
 *    driver refusing `showcase_ext_customer.owning_business_unit_id`
 *    (`INVALID_FILTER`, no such column);
 *  - removing a user answered 500, the same refusal on
 *    `showcase_ext_customer.created_by`, raised inside better-auth.
 *
 * The scan now skips every column the registry injected into a federated
 * object and the object does not provision, read from the registry's own
 * provenance (`isFederatedUnprovisionedInjectedColumn`). A lookup the author
 * declares on a federated object is still probed, and its failure still
 * propagates. That half is pinned at the seam, in
 * `packages/objectql/src/engine-cascade-federated-tenant-anchor.test.ts`.
 *
 * ## The user-delete door
 *
 * The one HTTP door that deletes a user is better-auth's
 * `POST /api/v1/auth/admin/remove-user`, which `plugin-auth` mounts when the
 * better-auth admin plugin is on. `objectstack serve` turns that plugin on by
 * default (`OS_AUTH_ADMIN`); this harness constructs `AuthPlugin` with no
 * plugin options, so the route answers 404 here unless something turns it
 * on. `OS_SCIM_ENABLED` is the one switch the harness reads that does (SCIM
 * forces the admin plugin on, ADR-0134), the same knob
 * `admin-credential-lifecycle.dogfood.test.ts` uses. `DELETE /data/sys_user/:id`
 * is refused 405 by design (ADR-0092), and `/auth/delete-user` is unconfigured.
 *
 * The vendor route authorizes on the legacy `sys_user.role === 'admin'`
 * scalar, which ADR-0068 D2 stopped writing, so a platform admin is refused
 * 403 there by a recorded ruling. This file writes that scalar onto the admin
 * row, as `plugin-auth`'s `remove-user-atomicity.test.ts` does, because this
 * file's subject is the cascade the delete runs, not who may call the route.
 *
 * ## Premises, asserted on the same boot so a green delete cannot be vacuous
 *
 *  - the fixture IS provisioned: the federated object answers its seeded rows,
 *    so neither delete can pass through the probe's missing-table branch;
 *  - each anchor the deletes would have probed is the platform's injection,
 *    unprovisioned (`resolveInjectedColumnProvenance`);
 *  - the remote really lacks those columns: a system read filtered on each one
 *    is refused.
 *
 * The working directory is a temporary one. The showcase's external datasource
 * and its fixture both name a cwd-relative SQLite file, so this file's remote
 * database is its own, never one another file left in the package directory.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { resolveInjectedColumnProvenance } from '@objectstack/metadata-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The federated object the showcase ships, bound to the remote table `customers`. */
const FEDERATED = 'showcase_ext_customer';

const SYSTEM_CTX = { isSystem: true };

const MEMBER_EMAIL = 'remove.me.21918@example.com';

async function findRows(ql: any, object: string, where: Record<string, unknown>, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit, context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

describe('[#21918] business-unit and user deletes with the showcase federated fixture provisioned', () => {
  let stack: VerifyStack;
  let ql: any;
  let token: string;
  let orgId: string;
  let prevCwd: string;
  let dir: string;
  let priorScim: string | undefined;

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-21918-'));
    process.chdir(dir);
    // The better-auth admin plugin, which mounts the remove-user door (see the header).
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    // Provision the remote tables, exactly as `os dev` does at boot (the
    // harness imports only the stack's default export, so `onEnable` never
    // runs on its own).
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootStack(showcaseStack, {
      orgContext: true,
      databaseFile: join(dir, 'showcase.db'),
    });
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const [org] = await findRows(ql, 'sys_organization', { slug: 'default' }, 1);
    expect(org, 'PREMISE: the bootstrap created the default organization').toBeTruthy();
    orgId = String(org.id);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('PREMISE: the fixture is provisioned, and its remote table refuses a filter on each injected anchor', async () => {
    const listed = await stack.apiAs(token, 'GET', `/data/${FEDERATED}`);
    expect(listed.status, await listed.clone().text()).toBe(200);
    const body: any = await listed.json();
    const rows: unknown[] = body?.records ?? body?.data ?? [];
    expect(rows.length, 'the remote customers table answers its seeded rows').toBeGreaterThan(0);

    const schema = ql.getSchema(FEDERATED);
    expect(schema?.external, `${FEDERATED} is federated`).toBeTruthy();
    for (const column of ['owning_business_unit_id', 'owner_id', 'created_by', 'updated_by']) {
      expect(resolveInjectedColumnProvenance(schema, column), column).toBe('injected-unprovisioned');
      // The read the cascade scan used to issue: SYSTEM identity, filtered on
      // the injected column. It is refused, so a scan that still probed this
      // object could not answer either delete below with 200.
      const refused: any = await findRows(ql, FEDERATED, { [column]: 'any_id' }, 1).then(
        () => null,
        (e: unknown) => e,
      );
      expect(refused, `the remote has no ${column} column`).not.toBeNull();
      expect(refused.code, column).toBe('INVALID_FILTER');
    }
  });

  it('an admin deletes a business unit: 200, the row is gone, and the federated rows are untouched', async () => {
    await ql.insert(
      'sys_business_unit',
      { id: 'bu_21918', name: 'Doomed Unit', kind: 'department', organization_id: orgId, active: true },
      { context: SYSTEM_CTX },
    );
    expect(await findRows(ql, 'sys_business_unit', { id: 'bu_21918' }, 1)).toHaveLength(1);
    const before = await findRows(ql, FEDERATED, {}, 500);

    const deleted = await stack.apiAs(token, 'DELETE', '/data/sys_business_unit/bu_21918');
    expect(deleted.status, await deleted.clone().text()).toBe(200);

    expect(await findRows(ql, 'sys_business_unit', { id: 'bu_21918' }, 1)).toHaveLength(0);
    expect((await findRows(ql, FEDERATED, {}, 500)).length).toBe(before.length);
  });

  it('an admin removes a user: 200, the row is gone, and the federated rows are untouched', async () => {
    await stack.signUp(MEMBER_EMAIL, 'Remove-Me-21918-Passw0rd!');
    const [member] = await findRows(ql, 'sys_user', { email: MEMBER_EMAIL }, 1);
    expect(member, 'PREMISE: the member signed up').toBeTruthy();
    const before = await findRows(ql, FEDERATED, {}, 500);

    // The vendor route's own authorization input (see the header), then a fresh session that carries it.
    const [admin] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    await ql.update('sys_user', { role: 'admin' }, { where: { id: admin.id }, context: SYSTEM_CTX });
    const adminToken = await stack.signIn();

    const removed = await stack.apiAs(adminToken, 'POST', '/auth/admin/remove-user', { userId: String(member.id) });
    expect(removed.status, await removed.clone().text()).toBe(200);

    expect(await findRows(ql, 'sys_user', { id: String(member.id) }, 1)).toHaveLength(0);
    expect((await findRows(ql, FEDERATED, {}, 500)).length).toBe(before.length);
  });
});
