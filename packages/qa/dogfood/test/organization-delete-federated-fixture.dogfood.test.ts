// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21910] An owner deletes an organization on a deployment with a federated
 * object provisioned, through better-auth's own endpoint, and gets 200.
 *
 * ## What was broken
 *
 * Deleting a record runs the engine's referential cascade scan
 * (`ObjectQL.cascadeDeleteRelations`): every registered `lookup` /
 * `master_detail` field that references the deleted object is probed for
 * dependents. The registry injects the platform's tenant anchor,
 * `organization_id` (a lookup to `sys_organization`), into a federated
 * (ADR-0015 `external`) object too, where it is registered and never
 * provisioned on the remote table. The scan read that injection as a real
 * reference and probed the showcase's remote `customers` table on
 * `organization_id`. The SQL driver refused the filter (`INVALID_FILTER`, no
 * such column), the probe's catch propagated it as #8895 rules for a missing
 * column, and every organization delete answered 500 once the showcase's
 * federated fixture existed. With no fixture the same delete answered 200,
 * because an unprovisioned child TABLE is the probe's one benign failure.
 *
 * The scan now skips a federated object's platform-injected tenant anchor,
 * the reading `buildDriverOptions` and the related-record read already apply.
 * Nothing else is skipped: an author-declared lookup on a federated object is
 * still probed, and its failure still propagates. That half is pinned at the
 * seam, in `packages/objectql/src/engine-cascade-federated-tenant-anchor.test.ts`.
 *
 * ## Premises, asserted on the same boot so a green delete cannot be vacuous
 *
 *  - the fixture IS provisioned: the federated object answers its seeded rows,
 *    so the delete cannot be passing through the missing-table branch;
 *  - the remote really lacks the column: a system read filtered on
 *    `organization_id`, the probe the scan used to run, is refused;
 *  - the field that probe named is the platform's injected anchor
 *    (`resolveInjectedColumnProvenance` answers `injected-unprovisioned`).
 *
 * Booted with `orgContext`, which asserts the admin is seated in the Default
 * Organization. The organization deleted is a SECOND one the admin owns, not
 * the Default Organization: under `single` the Default Organization owns every
 * row the deployment wrote, the showcase's seed included (ADR-0131 D3), so
 * deleting it runs those rows' own delete behaviour — a different question
 * from the federated anchor this file pins. The cascade scan probes every
 * reference to `sys_organization` on ANY organization's delete, so the
 * second organization reaches the same scan with nothing else attached.
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

async function findRows(ql: any, object: string, where: Record<string, unknown>, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit, context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

describe('[#21910] an organization delete with the showcase federated fixture provisioned', () => {
  let stack: VerifyStack;
  let ql: any;
  let token: string;
  let orgId: string;
  let prevCwd: string;
  let dir: string;

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-21910-'));
    process.chdir(dir);
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

    const [defaultOrg] = await findRows(ql, 'sys_organization', { slug: 'default' }, 1);
    expect(defaultOrg, 'PREMISE: the boot created the Default Organization').toBeTruthy();
    // The organization this file deletes: a second one, owned by the admin,
    // that no row of the deployment belongs to (see the header).
    const org = await ql.insert('sys_organization', { name: 'Org 21910', slug: 'org-21910' }, { context: SYSTEM_CTX });
    orgId = String(org.id);
    const [admin] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    await ql.insert('sys_member', { user_id: String(admin?.id), organization_id: orgId, role: 'owner' }, { context: SYSTEM_CTX });
    const seats = await findRows(ql, 'sys_member', { user_id: String(admin?.id), organization_id: orgId }, 5);
    expect(seats.map((m) => m.role), 'PREMISE: the admin owns the organization').toEqual(['owner']);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('PREMISE: the fixture is provisioned, and its remote table refuses a filter on the injected organization_id', async () => {
    const listed = await stack.apiAs(token, 'GET', `/data/${FEDERATED}`);
    expect(listed.status, await listed.clone().text()).toBe(200);
    const body: any = await listed.json();
    const rows: unknown[] = body?.records ?? body?.data ?? [];
    expect(rows.length, 'the remote customers table answers its seeded rows').toBeGreaterThan(0);

    const schema = ql.getSchema(FEDERATED);
    expect(schema?.external, `${FEDERATED} is federated`).toBeTruthy();
    expect(resolveInjectedColumnProvenance(schema, 'organization_id')).toBe('injected-unprovisioned');

    // The read the cascade scan used to issue: SYSTEM identity, filtered on
    // the injected column. It is refused, so a scan that still probed this
    // object could not answer the delete below with 200.
    const refused: any = await findRows(ql, FEDERATED, { organization_id: orgId }, 1).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refused, 'the remote has no organization_id column').not.toBeNull();
    expect(refused.code).toBe('INVALID_FILTER');
  });

  it('the owner deletes the organization: 200, the row is gone, and the federated rows are untouched', async () => {
    const before = await findRows(ql, FEDERATED, {}, 500);

    const deleted = await stack.apiAs(token, 'POST', '/auth/organization/delete', { organizationId: orgId });
    expect(deleted.status, await deleted.clone().text()).toBe(200);

    expect(await findRows(ql, 'sys_organization', { id: orgId }, 1)).toHaveLength(0);
    expect((await findRows(ql, FEDERATED, {}, 500)).length).toBe(before.length);
  });
});
