// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @proof: permission-set-projection
//
// ADR-0094 — `sys_permission_set` is a PURE PROJECTION of the metadata layer,
// proven on the real showcase stack. The record has no independent authority:
//
//   1. A data-door create/edit lands in the METADATA store (write-through) and
//      the record is re-derived by the AWAITED projector — consistent on the
//      very next read, no race.
//   2. A data-door edit of a DECLARED set becomes an enforced env overlay
//      (the layered effective body changes), closing the "Setup edit never
//      enforces" gap.
//   3. Deleting a runtime-only set retires its record; deleting an
//      artifact-backed set RESETS it to the declared body (the definition
//      ships with the app and cannot be removed from the environment).
//   4. [ADR-0094, direction 2026-07-14] An environment-door metadata save that
//      targets a package-owned set is a FIRST-CLASS overlay customization:
//      the record projects the effective body with its package provenance
//      preserved, and deleting the overlay resets to the shipped declaration.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('sys_permission_set pure projection (ADR-0094)', () => {
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
  const overlayBody = async (name: string) => {
    const layered = await protocol.getMetaItemLayered({ type: 'permission', name });
    return layered?.overlay ?? null;
  };

  // ── 1. Data-door create → metadata store + awaited projection ─────────────
  it('a data-door create lands in metadata and the record is projected before the response returns', async () => {
    const NAME = 'proj_probe_agent';
    const res = await stack.apiAs(adminToken, 'POST', '/data/sys_permission_set', {
      name: NAME,
      label: 'Projection Probe',
      object_permissions: JSON.stringify({ crm_lead: { allowRead: true } }),
      system_permissions: JSON.stringify(['probe.use']),
    });
    expect(res.status).toBeLessThan(300);

    // The record exists immediately (awaited projection — no poll/sleep) and is
    // env-owned, not forged package provenance.
    const row = await findSet(NAME);
    expect(row, 'record projected synchronously with the create').toBeTruthy();
    expect(row.managed_by).toBe('user');
    expect(JSON.parse(row.object_permissions)).toEqual({ crm_lead: { allowRead: true } });

    // …and the authoritative store is the metadata overlay, not the row.
    const overlay = await overlayBody(NAME);
    expect(overlay?.name, 'the definition lives in the metadata store').toBe(NAME);
    expect(overlay.systemPermissions).toEqual(['probe.use']);
  });

  it('a data-door edit updates metadata and the record follows in lock-step', async () => {
    const NAME = 'proj_probe_agent';
    const row = await findSet(NAME);
    const res = await stack.apiAs(adminToken, 'PATCH', `/data/sys_permission_set/${row.id}`, {
      system_permissions: JSON.stringify(['probe.use', 'probe.admin']),
    });
    expect(res.status).toBeLessThan(300);

    expect((await overlayBody(NAME)).systemPermissions).toEqual(['probe.use', 'probe.admin']);
    expect(JSON.parse((await findSet(NAME)).system_permissions)).toEqual(['probe.use', 'probe.admin']);
  });

  it('deleting a runtime-only set retires both the definition and the record', async () => {
    const NAME = 'proj_probe_agent';
    const row = await findSet(NAME);
    const res = await stack.apiAs(adminToken, 'DELETE', `/data/sys_permission_set/${row.id}`);
    expect(res.status).toBeLessThan(300);
    expect(await findSet(NAME), 'runtime-only record retired on delete').toBeFalsy();
    expect(await overlayBody(NAME), 'metadata overlay gone too').toBeFalsy();
  });

  // ── 2. Data-door edit of a DECLARED set becomes an enforced overlay ───────
  it('editing a declared set through the data door produces an enforced metadata overlay', async () => {
    // member_default is a platform-declared set (an artifact baseline exists).
    expect(await overlayBody('member_default'), 'no overlay before the edit').toBeFalsy();
    const md = await findSet('member_default');
    const res = await stack.apiAs(adminToken, 'PATCH', `/data/sys_permission_set/${md.id}`, {
      description: 'customized via Setup (ADR-0094)',
    });
    expect(res.status).toBeLessThan(300);

    // The edit is now an env overlay — the store the resolver reads, not a
    // record-only change that silently never enforces.
    const overlay = await overlayBody('member_default');
    expect(overlay, 'Setup edit of a declared set becomes an env overlay').toBeTruthy();
    expect(overlay.description).toBe('customized via Setup (ADR-0094)');
    expect((await findSet('member_default')).description).toBe('customized via Setup (ADR-0094)');
  });

  // ── 3. Delete of an artifact-backed set RESETS (does not remove) ──────────
  it('deleting a declared set through the data door resets it to the declared body, keeping the record', async () => {
    const before = await findSet('member_default');
    const res = await stack.apiAs(adminToken, 'DELETE', `/data/sys_permission_set/${before.id}`);
    expect(res.status).toBeLessThan(300);

    const after = await findSet('member_default');
    expect(after, 'a packaged/declared set cannot be removed from the environment').toBeTruthy();
    // Overlay is gone (reset) and the customized description is gone with it.
    expect(await overlayBody('member_default')).toBeFalsy();
    expect(after.description ?? null).not.toBe('customized via Setup (ADR-0094)');
  });

  // ── 4. Env overlay of a PACKAGE set is first-class (ADR-0094) ─────────────
  it('an environment-door metadata save on a package-owned set customizes it and projects immediately', async () => {
    const contributor = await findSet('showcase_contributor');
    expect(contributor?.managed_by, 'showcase_contributor is package-owned').toBe('package');
    const layeredBefore = await protocol.getMetaItemLayered({ type: 'permission', name: 'showcase_contributor' });
    const baseline = layeredBefore?.code ?? null;
    expect(baseline, 'the packaged declaration is the code layer').toBeTruthy();

    await protocol.saveMetaItem({
      type: 'permission',
      name: 'showcase_contributor',
      item: { ...baseline, label: 'Contributor (env customized)' },
    });

    // Awaited projection: the record already reflects the overlay, and the
    // package provenance is untouched.
    const after = await findSet('showcase_contributor');
    expect(after.label).toBe('Contributor (env customized)');
    expect(after.managed_by).toBe('package');
    expect(after.package_id).toBe(contributor.package_id);

    // Deleting the overlay resets the record to the shipped declaration.
    await protocol.deleteMetaItem({ type: 'permission', name: 'showcase_contributor' });
    const reset = await findSet('showcase_contributor');
    expect(reset.label).toBe(contributor.label);
    expect(reset.managed_by).toBe('package');
  });

  it('a brand-new environment set authored through the metadata door appears as a Setup record', async () => {
    const NAME = 'proj_env_authored';
    await protocol.saveMetaItem({
      type: 'permission',
      name: NAME,
      item: { name: NAME, label: 'Env Authored', objects: { crm_lead: { allowRead: true } }, systemPermissions: ['env.use'] },
    });
    // Studio-authored env sets now surface in Setup (the record is created by
    // the projector, not left invisible as before ADR-0094).
    const row = await findSet(NAME);
    expect(row, 'Studio-authored env set appears in Setup').toBeTruthy();
    expect(row.managed_by).toBe('user');
    expect(JSON.parse(row.object_permissions)).toEqual({ crm_lead: { allowRead: true } });
  });
});
