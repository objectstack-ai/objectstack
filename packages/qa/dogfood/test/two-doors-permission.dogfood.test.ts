// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0086 P2 — "two doors" separation for permission sets, proven on the real
// showcase stack (which declares `showcase_contributor` as a package set):
//
//  块1 — the PACKAGE door: a permission set authored as a `permission` metadata
//        draft under a package and then PUBLISHED is materialized into
//        `sys_permission_set` with `managed_by:'package'` + the owning
//        `package_id` (publish-time, not just at boot). A draft alone
//        materializes nothing — only publish makes it live.
//
//  块2 — the ADMIN door (evolved by ADR-0094, direction 2026-07-14): a
//        data-plane edit of a package-managed row is TRANSLATED into an
//        env-scope metadata OVERLAY (the standard ADR-0005 customization) —
//        the record projects the effective body while the package keeps
//        owning the row, and "delete" resets to the shipped declaration.
//        Forging package provenance through the admin door stays refused.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('two-doors permission separation (ADR-0086 P2)', () => {
  let stack: VerifyStack;
  let ql: any;
  let protocol: any;
  let adminToken: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    protocol = await stack.kernel.getServiceAsync('protocol');
  }, 60_000);
  afterAll(async () => { await stack?.stop(); });

  const findSet = async (name: string) =>
    (await ql.find('sys_permission_set', { where: { name } }, { context: { isSystem: true } }))?.[0];

  // ── 块1 — package door: draft → publish → materialize ────────────────────
  it('块1: publishing a package permission draft materializes a package-managed row', async () => {
    // An unregistered authoring-workspace id is a WRITABLE base (isWritablePackage),
    // standing in for the package the studio package door edits.
    const PKG = 'com.example.twodoors_ws';
    const NAME = 'twodoors_pkgset';

    await protocol.saveMetaItem({
      type: 'permission',
      name: NAME,
      mode: 'draft',
      packageId: PKG,
      item: {
        name: NAME,
        label: 'Two Doors Set',
        objects: { crm_lead: { allowRead: true, allowCreate: true } },
      },
    });

    // Draft only — enforcement/admin-surface must NOT see it yet.
    expect(await findSet(NAME), 'a draft must not materialize a data row').toBeFalsy();

    const pub = await protocol.publishMetaItem({ type: 'permission', name: NAME });
    expect(pub.materializeApplied, 'publish surfaces the materialize result').toBeTruthy();
    expect(pub.materializeApplied.success).toBe(true);

    const row = await findSet(NAME);
    expect(row, 'published set is now a real record').toBeTruthy();
    expect(row.managed_by).toBe('package');
    expect(row.package_id).toBe(PKG);
    expect(JSON.parse(row.object_permissions || '{}')).toEqual({
      crm_lead: { allowRead: true, allowCreate: true },
    });
  });

  // ── 块2 — admin door: package rows customize via overlay (ADR-0094) ───────
  it('块2: an admin edit of a package-managed set becomes an env OVERLAY; provenance is preserved', async () => {
    const contributor = await findSet('showcase_contributor');
    expect(contributor?.managed_by, 'showcase_contributor is package-owned').toBe('package');

    const res = await stack.apiAs(adminToken, 'PATCH', `/data/sys_permission_set/${contributor.id}`, {
      label: 'Contributor (customized)',
    });
    expect(res.status).toBeLessThan(300);

    // The customization landed as a metadata overlay of the packaged definition…
    const layered = await protocol.getMetaItemLayered({ type: 'permission', name: 'showcase_contributor' });
    expect(layered?.overlay, 'edit persisted as an env-scope overlay').toBeTruthy();
    expect(layered.overlay.label).toBe('Contributor (customized)');
    // …the record projects the effective body, and the package still owns it.
    const after = await findSet('showcase_contributor');
    expect(after.label).toBe('Contributor (customized)');
    expect(after.managed_by).toBe('package');
    expect(after.package_id).toBe(contributor.package_id);
  });

  it('块2: "deleting" the customized package set removes the overlay and RESETS to the shipped declaration', async () => {
    const before = await findSet('showcase_contributor');
    const res = await stack.apiAs(adminToken, 'DELETE', `/data/sys_permission_set/${before.id}`);
    expect(res.status).toBeLessThan(300);

    const after = await findSet('showcase_contributor');
    expect(after, 'a packaged definition is never removed by the env door').toBeTruthy();
    expect(after.label, 'label reset to the shipped declaration').not.toBe('Contributor (customized)');
    expect(after.managed_by).toBe('package');
    const layered = await protocol.getMetaItemLayered({ type: 'permission', name: 'showcase_contributor' });
    expect(layered?.overlay, 'overlay gone after the reset').toBeFalsy();
  });

  it('块2: the admin door CAN still edit an env-authored set (isolates the gate to package rows)', async () => {
    const memberDefault = await findSet('member_default');
    expect(memberDefault?.managed_by ?? null, 'member_default is env-owned').not.toBe('package');

    const res = await stack.apiAs(adminToken, 'PATCH', `/data/sys_permission_set/${memberDefault.id}`, {
      description: 'edited through the admin door',
    });
    expect(res.status).toBeLessThan(300);

    const after = await findSet('member_default');
    expect(after.description).toBe('edited through the admin door');
  });

  it('块2: the admin door cannot forge package provenance on insert', async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/data/sys_permission_set', {
      name: 'forged_pkg_set',
      label: 'Forged',
      managed_by: 'package',
      package_id: 'com.example.twodoors_ws',
    });
    expect(res.status).toBe(403);
    expect(await findSet('forged_pkg_set'), 'the forged row must not exist').toBeFalsy();
  });
});
