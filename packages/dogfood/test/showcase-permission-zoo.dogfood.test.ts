// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0090 permission-model zoo — runtime guard for the showcase's security
// metadata, in the spirit of `showcase_field_zoo` (#2005) and the semantic
// zoo: the showcase declares the FULL authoring surface (positions,
// CRUD/FLS/RLS sets, org-depth, VAMA, system permissions, everyone/guest
// capability, adminScope, a seeded sys_business_unit tree, BU-subtree
// sharing), and this test proves the SERVED runtime enforces it — not just
// stores it. Each block names the ADR-0090 decision it guards.
//
// @proof: showcase-permission-zoo

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { isSystem: true } as const;

describe('showcase: ADR-0090 permission-model zoo', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let ownerTok: string, plainTok: string, auditorTok: string, delegateTok: string;
  let ownerId: string, plainId: string, auditorId: string, delegateId: string, targetId: string;
  let noteId: string;

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    adminTok = await stack.signIn();
    ownerTok = await stack.signUp('zoo-owner@verify.test');
    plainTok = await stack.signUp('zoo-plain@verify.test');
    auditorTok = await stack.signUp('zoo-auditor@verify.test');
    delegateTok = await stack.signUp('zoo-delegate@verify.test');
    await stack.signUp('zoo-target@verify.test');

    ql = await stack.kernel.getServiceAsync('objectql');
    ownerId = await uid('zoo-owner@verify.test');
    plainId = await uid('zoo-plain@verify.test');
    auditorId = await uid('zoo-auditor@verify.test');
    delegateId = await uid('zoo-delegate@verify.test');
    targetId = await uid('zoo-target@verify.test');

    // Grant the zoo sets directly (system plumbing — the delegated-admin and
    // anchor gates are exercised through REAL authed requests below).
    const grant = async (userId: string, setName: string) => {
      const ps = await ql.findOne('sys_permission_set', { where: { name: setName }, context: SYS });
      expect(ps?.id, `permission set ${setName} seeded`).toBeTruthy();
      await ql.insert(
        'sys_user_permission_set',
        { user_id: userId, permission_set_id: ps.id },
        { context: SYS },
      );
    };
    await grant(auditorId, 'showcase_auditor');
    await grant(delegateId, 'showcase_field_ops_delegate');

    // Membership: the assignment target sits INSIDE the delegate's subtree
    // (West Coast ⊂ Field Operations); the delegate too.
    await ql.insert('sys_business_unit_member', { business_unit_id: 'bu_west_coast', user_id: targetId }, { context: SYS });
    await ql.insert('sys_business_unit_member', { business_unit_id: 'bu_field_ops', user_id: delegateId }, { context: SYS });

    // A private record owned by zoo-owner — the probe for OWD/VAMA.
    const created = await stack.apiAs(ownerTok, 'POST', '/data/showcase_private_note', {
      title: 'Zoo probe note',
    });
    expect(created.status, 'owner creates a private note').toBeLessThan(300);
    const body: any = await created.json();
    noteId = body?.id ?? body?.record?.id;
    if (!noteId) {
      noteId = (await ql.findOne('showcase_private_note', { where: { title: 'Zoo probe note' }, context: SYS }))?.id;
    }
    expect(noteId, 'probe note id resolved').toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  // ── The app seed can plant the platform org tree ─────────────────────────
  it('seeds the sys_business_unit tree with explicit ids and parent links', async () => {
    const units = await ql.find('sys_business_unit', { where: {}, context: SYS });
    const byId = new Map((units ?? []).map((u: any) => [u.id, u]));
    expect(byId.get('bu_acme'), 'root unit seeded').toBeTruthy();
    expect((byId.get('bu_field_ops') as any)?.parent_business_unit_id).toBe('bu_acme');
    expect((byId.get('bu_west_coast') as any)?.parent_business_unit_id).toBe('bu_field_ops');
    expect((byId.get('bu_hq_finance') as any)?.parent_business_unit_id).toBe('bu_acme');
  });

  // ── ADR-0090 D12: adminScope lands on the stored set ─────────────────────
  it('persists the delegated-admin scope (adminScope → admin_scope JSON)', async () => {
    const row = await ql.findOne('sys_permission_set', { where: { name: 'showcase_field_ops_delegate' }, context: SYS });
    expect(row, 'delegate set seeded').toBeTruthy();
    const scope = JSON.parse(row.admin_scope || 'null');
    expect(scope?.businessUnit).toBe('Field Operations');
    expect(scope?.manageAssignments).toBe(true);
    expect(scope?.manageBindings).toBe(false);
    expect(scope?.assignablePermissionSets).toContain('showcase_contributor');
  });

  // ── OWD private baseline vs VAMA bypass ───────────────────────────────────
  it('a plain member cannot read someone else’s private note (OWD private, D1)', async () => {
    const r = await stack.apiAs(plainTok, 'GET', `/data/showcase_private_note/${noteId}`);
    expect(r.status, 'private baseline hides the row').not.toBe(200);
  });

  it('an auditor reads it via viewAllRecords (VAMA bypass)', async () => {
    const r = await stack.apiAs(auditorTok, 'GET', `/data/showcase_private_note/${noteId}`);
    expect(r.status, 'view-all bypasses the private baseline').toBe(200);
  });

  it('the auditor still cannot WRITE it (read-only compliance set)', async () => {
    const r = await stack.apiAs(auditorTok, 'PATCH', `/data/showcase_private_note/${noteId}`, {
      title: 'defaced',
    });
    expect(r.status, 'no write bit anywhere on the auditor set').not.toBe(200);
  });

  // ── ADR-0090 D6: the explain engine attributes the VAMA grant ────────────
  it('explain() reports the vama_bypass layer with the auditor set as contributor', async () => {
    const security: any = stack.kernel.getService('security');
    expect(security?.explain, 'security service exposes explain()').toBeTruthy();
    const decision = await security.explain(
      { object: 'showcase_private_note', operation: 'read', userId: auditorId },
      { isSystem: true },
    );
    expect(decision?.allowed).toBe(true);
    const vama = (decision?.layers ?? []).find((l: any) => l.layer === 'vama_bypass');
    expect(vama, 'vama_bypass layer present').toBeTruthy();
    const names = (vama?.contributors ?? []).map((c: any) => c.name);
    expect(names, 'the granting set is attributed').toContain('showcase_auditor');
  });

  // ── ADR-0090 D12: the delegated-admin gate, positive and negative ────────
  it('a delegate assigns an allowlisted position inside their subtree', async () => {
    // Bind contributor → showcase_contributor first (admin action; the
    // delegate has manageBindings: false and must NOT be able to do this).
    const pos = await ql.findOne('sys_position', { where: { name: 'contributor' }, context: SYS });
    const ps = await ql.findOne('sys_permission_set', { where: { name: 'showcase_contributor' }, context: SYS });
    expect(pos?.id && ps?.id, 'contributor position + set seeded').toBeTruthy();
    const bind = await stack.apiAs(adminTok, 'POST', '/data/sys_position_permission_set', {
      position_id: pos.id,
      permission_set_id: ps.id,
    });
    expect(bind.status, 'tenant admin binds set to position').toBeLessThan(300);

    const assign = await stack.apiAs(delegateTok, 'POST', '/data/sys_user_position', {
      user_id: targetId,
      position: 'contributor',
      business_unit_id: 'bu_west_coast',
    });
    expect(assign.status, 'in-subtree, allowlisted assignment passes').toBeLessThan(300);
    const row = await ql.findOne('sys_user_position', {
      where: { user_id: targetId, position: 'contributor' },
      context: SYS,
    });
    expect(row, 'assignment persisted').toBeTruthy();
    expect(row.granted_by, 'granted_by audit stamp applied').toBeTruthy();
  });

  it('the same delegate is refused OUTSIDE their subtree (no lateral reach)', async () => {
    const r = await stack.apiAs(delegateTok, 'POST', '/data/sys_user_position', {
      user_id: targetId,
      position: 'contributor',
      business_unit_id: 'bu_hq_finance',
    });
    expect(r.status, 'HQ Finance is outside the Field Operations subtree').not.toBeLessThan(300);
  });

  it('the delegate cannot hand out a set OFF the allowlist (no self-escalation)', async () => {
    // showcase_auditor is not in assignablePermissionSets — direct grant refused.
    const ps = await ql.findOne('sys_permission_set', { where: { name: 'showcase_auditor' }, context: SYS });
    const r = await stack.apiAs(delegateTok, 'POST', '/data/sys_user_permission_set', {
      user_id: delegateId,
      permission_set_id: ps.id,
    });
    expect(r.status, 'granting an un-allowlisted set (to ANYONE, incl. self) is refused').not.toBeLessThan(300);
  });

  it('the delegate cannot re-compose positions (manageBindings: false)', async () => {
    const pos = await ql.findOne('sys_position', { where: { name: 'contributor' }, context: SYS });
    const ps = await ql.findOne('sys_permission_set', { where: { name: 'showcase_manager' }, context: SYS });
    const r = await stack.apiAs(delegateTok, 'POST', '/data/sys_position_permission_set', {
      position_id: pos.id,
      permission_set_id: ps.id,
    });
    expect(r.status, 'binding writes need manageBindings').not.toBeLessThan(300);
  });

  // ── ADR-0090 D5/D9: the audience-anchor binding gate ─────────────────────
  it('binding a high-privilege set to an anchor is rejected even for the admin', async () => {
    const everyone = await ql.findOne('sys_position', { where: { name: 'everyone' }, context: SYS });
    expect(everyone, 'built-in everyone position seeded').toBeTruthy();
    const auditor = await ql.findOne('sys_permission_set', { where: { name: 'showcase_auditor' }, context: SYS });
    const r = await stack.apiAs(adminTok, 'POST', '/data/sys_position_permission_set', {
      position_id: everyone.id,
      permission_set_id: auditor.id,
    });
    expect(r.status, 'viewAllRecords on the everyone anchor is lint-tier blocked at runtime').not.toBeLessThan(300);
  });

  it('binding the guest-safe set to the guest anchor is accepted', async () => {
    const guest = await ql.findOne('sys_position', { where: { name: 'guest' }, context: SYS });
    expect(guest, 'built-in guest position seeded').toBeTruthy();
    const ps = await ql.findOne('sys_permission_set', { where: { name: 'showcase_guest_portal' }, context: SYS });
    const r = await stack.apiAs(adminTok, 'POST', '/data/sys_position_permission_set', {
      position_id: guest.id,
      permission_set_id: ps.id,
    });
    expect(r.status, 'read-only + create-intake set passes the guest tier').toBeLessThan(300);
  });
});
