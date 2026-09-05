// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// TEMPORARY census probe for #15784 scope item 1 — NOT a shipped test.
// Registers a probe on the candidate seam and drives every enumerated
// membership-removal path, recording which reach it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYSTEM_CTX = { isSystem: true };
const PROBE_PKG = 'census.15784.probe';

type Firing = { event: string; id: unknown; user_id?: unknown; organization_id?: unknown };

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

async function waitForMembership(ql: any, userId: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const rows = await findRows(ql, 'sys_member', { user_id: userId }, 5);
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sys_member row appeared for ${userId}`);
}

describe('#15784 census probe: which membership-removal writers reach an engine hook on sys_member', () => {
  let stack: VerifyStack;
  let ql: any;
  let driver: any;
  let orgId: string;
  let partnerOrgId: string;
  let adminToken: string;
  let adminUserId: string;
  const fired: Firing[] = [];
  const report: string[] = [];

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    // The engine's own driver for sys_member — `getDriver` is TS-private, not
    // runtime-private, and this probe deliberately reaches BELOW the engine.
    driver = (ql as any).getDriver('sys_member');

    for (const event of ['beforeDelete', 'afterDelete', 'beforeUpdate', 'afterUpdate'] as const) {
      ql.registerHook(event, async (ctx: any) => {
        fired.push({
          event,
          id: ctx?.input?.id,
          user_id: ctx?.previous?.user_id,
          organization_id: ctx?.previous?.organization_id,
        });
      }, { object: 'sys_member', packageId: PROBE_PKG, priority: 500 });
    }

    const org = await ql.insert('sys_organization', { name: 'Default Organization', slug: 'default' }, { context: SYSTEM_CTX });
    orgId = String(org.id);
    const partner = await ql.insert('sys_organization', { name: 'Partner Organization', slug: 'partner' }, { context: SYSTEM_CTX });
    partnerOrgId = String(partner.id);

    const [adminUser] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    adminUserId = String(adminUser.id);
    const adminMembers = await findRows(ql, 'sys_member', { user_id: adminUserId }, 5);
    if (adminMembers.length > 0) {
      await ql.update('sys_member', { id: adminMembers[0].id, organization_id: orgId, role: 'owner' }, { context: SYSTEM_CTX });
    } else {
      await ql.insert('sys_member', { user_id: adminUserId, organization_id: orgId, role: 'owner' }, { context: SYSTEM_CTX });
    }
    await ql.insert('sys_member', { user_id: adminUserId, organization_id: partnerOrgId, role: 'owner' }, { context: SYSTEM_CTX });
  }, 240_000);

  afterAll(async () => {
    console.log('\n===== #15784 CENSUS PROBE REPORT =====');
    for (const l of report) console.log(l);
    console.log('===== END =====\n');
    await stack?.stop?.();
  });

  async function newMember(tag: string): Promise<{ userId: string; memberId: string }> {
    const email = `census.${tag}.15784@example.com`;
    await stack.signUp(email, 'Member!Pass123', `Census ${tag}`);
    const [u] = await findRows(ql, 'sys_user', { email }, 1);
    const m = await waitForMembership(ql, String(u.id));
    return { userId: String(u.id), memberId: String(m.id) };
  }

  function since(mark: number): Firing[] { return fired.slice(mark); }

  // ── PATH 0 — THE FIRING CONTROL ───────────────────────────────────────────
  it('CONTROL: a direct engine delete fires the probe (if this fails, nothing below is a reading)', async () => {
    const { memberId } = await newMember('control');
    const mark = fired.length;
    await ql.delete('sys_member', { where: { id: memberId }, context: SYSTEM_CTX });
    const seen = since(mark);
    report.push(`PATH 0  engine.delete (direct)                 -> ${seen.map((f) => f.event).join(',') || 'NOTHING'}`);
    expect(seen.some((f) => f.event === 'afterDelete')).toBe(true);
  }, 120_000);

  // ── PATH 1 — better-auth's own remove-member endpoint ─────────────────────
  it('better-auth POST /organization/remove-member', async () => {
    const { userId, memberId } = await newMember('removemember');
    await ql.update('sys_member', { id: memberId, organization_id: orgId }, { context: SYSTEM_CTX });
    const mark = fired.length;
    const res = await stack.apiAs(adminToken, 'POST', '/auth/organization/remove-member', {
      memberIdOrEmail: memberId,
      organizationId: orgId,
    });
    const body = await res.clone().text();
    const seen = since(mark);
    const gone = (await findRows(ql, 'sys_member', { id: memberId }, 1)).length === 0;
    report.push(`PATH 1  better-auth /organization/remove-member -> HTTP ${res.status}; row gone=${gone}; ${seen.map((f) => f.event).join(',') || 'NOTHING'}`);
    if (res.status !== 200) report.push(`        (body: ${body.slice(0, 200)})`);
    expect(userId).toBeTruthy();
  }, 120_000);

  // ── PATH 2 — a bulk / multi engine delete ────────────────────────────────
  it('engine multi delete (bulk operation)', async () => {
    const { memberId } = await newMember('bulk');
    await ql.update('sys_member', { id: memberId, organization_id: partnerOrgId }, { context: SYSTEM_CTX });
    const mark = fired.length;
    await ql.delete('sys_member', { where: { id: memberId }, multi: true, context: SYSTEM_CTX });
    const seen = since(mark);
    report.push(`PATH 2  engine.delete multi:true               -> ${seen.map((f) => f.event).join(',') || 'NOTHING'}`);
  }, 120_000);

  // ── PATH 3 — cascade from a sys_user delete ──────────────────────────────
  it('cascade: deleting the sys_user row takes its memberships', async () => {
    const { userId, memberId } = await newMember('cascade');
    // `sys_session.user_id` / `sys_account.user_id` are REQUIRED lookups that
    // default to `restrict`, so a signed-up user cannot be deleted while those
    // rows stand. Clear them first: this path measures the sys_member cascade.
    for (const child of ['sys_session', 'sys_account']) {
      for (const r of await findRows(ql, child, { user_id: userId }, 20)) {
        await ql.delete(child, { where: { id: r.id }, context: SYSTEM_CTX });
      }
    }
    const mark = fired.length;
    let err: string | undefined;
    try {
      await ql.delete('sys_user', { where: { id: userId }, context: SYSTEM_CTX });
    } catch (e: any) { err = e?.message ?? String(e); }
    const seen = since(mark);
    const gone = (await findRows(ql, 'sys_member', { id: memberId }, 1)).length === 0;
    report.push(`PATH 3  cascade via sys_user delete            -> row gone=${gone}; ${seen.map((f) => f.event).join(',') || 'NOTHING'}${err ? `; refused: ${err.slice(0, 120)}` : ''}`);
  }, 120_000);

  // ── PATH 4 — a RAW DRIVER delete (the cloud package-uninstall shape) ─────
  it('raw driver delete bypasses the engine entirely', async () => {
    const { memberId } = await newMember('rawdriver');
    const mark = fired.length;
    let err: string | undefined;
    try {
      await driver.delete('sys_member', memberId);
    } catch (e: any) { err = e?.message ?? String(e); }
    const seen = since(mark);
    const gone = (await findRows(ql, 'sys_member', { id: memberId }, 1)).length === 0;
    report.push(`PATH 4  driver.delete (raw, hooks bypassed)    -> row gone=${gone}; ${seen.map((f) => f.event).join(',') || 'NOTHING'}${err ? `; threw: ${err.slice(0, 120)}` : ''}`);
  }, 120_000);

  // ── PATH 5 — INVALIDATE: re-point organization_id ────────────────────────
  it('invalidate: the membership row is re-pointed at another organization', async () => {
    const { memberId } = await newMember('repoint');
    await ql.update('sys_member', { id: memberId, organization_id: orgId }, { context: SYSTEM_CTX });
    const mark = fired.length;
    await ql.update('sys_member', { id: memberId, organization_id: partnerOrgId }, { context: SYSTEM_CTX });
    const seen = since(mark);
    report.push(`PATH 5  engine.update re-point organization_id -> ${seen.map((f) => f.event).join(',') || 'NOTHING'}`);
  }, 120_000);
});
