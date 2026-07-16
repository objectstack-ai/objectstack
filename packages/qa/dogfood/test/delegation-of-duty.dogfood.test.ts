// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0091 D3 — delegation of duty (职务代理), proven end-to-end against a real
// booted stack:
//
//   • the WRITE path: a non-admin holder of a `delegatable` position may POST a
//     time-boxed, reasoned delegation row over the HTTP API — the D12 gate's
//     self-service branch approves it, stamping `granted_by`; the same holder is
//     rejected when the delegation is malformed (no reason) or the position is
//     not delegatable.
//   • the RESOLUTION path: the delegate RESOLVES the delegated position while
//     inside the validity window and STOPS resolving it at `valid_until` — the
//     L1 resolution-time filter, on the real persisted row, via the real
//     `resolveAuthzContext`. "Access dies at valid_until" with no cleanup job.
//
// @proof: delegation-of-duty

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { resolveAuthzContext } from '@objectstack/core';

const SYS = { context: { isSystem: true } } as const;
const DELEGATOR = 'deleg-boss@verify.test';
const DELEGATE = 'deleg-standin@verify.test';
const DAY = 24 * 60 * 60 * 1000;

// The "may delegate my duties" population set: plain CRUD on the assignment
// table (the D12 gate is the real boundary, NOT this grant) and NO adminScope,
// so the writer is neither a tenant admin nor a delegated administrator — the
// self-service delegation branch is the ONLY path that can approve their write.
const delegMember = PermissionSetSchema.parse({
  name: 'deleg_member',
  label: 'Delegation Member',
  objects: {
    sys_user_position: { allowRead: true, allowCreate: true },
  },
});

describe('delegation of duty (ADR-0091 D3) — end to end', () => {
  let stack: VerifyStack;
  let ql: any;
  let delegatorToken: string;
  let delegatorId: string;
  let delegateId: string;
  const validUntil = new Date(Date.now() + 10 * DAY).toISOString();

  const idOf = async (email: string): Promise<string> => {
    const u = await ql.findOne('sys_user', { where: { email }, context: SYS.context });
    return String(u?.id ?? '');
  };
  const sessionFor = (userId: string) => async () => ({ user: { id: userId }, session: {} });

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, delegMember],
        fallbackPermissionSet: 'deleg_member',
      }),
    });
    await stack.signIn();
    delegatorToken = await stack.signUp(DELEGATOR);
    await stack.signUp(DELEGATE);
    ql = await stack.kernel.getServiceAsync('objectql');

    delegatorId = await idOf(DELEGATOR);
    delegateId = await idOf(DELEGATE);

    // A delegatable position + a non-delegatable one (system inserts sidestep
    // authoring rules). The delegator DIRECTLY holds the delegatable one.
    await ql.insert('sys_position', { id: 'pos_vac_appr', name: 'vacation_approver', label: 'Vacation Approver', delegatable: true, active: true }, SYS);
    await ql.insert('sys_position', { id: 'pos_locked', name: 'locked_duty', label: 'Locked Duty', delegatable: false, active: true }, SYS);
    await ql.insert('sys_user_position', { id: 'hold_boss', user_id: delegatorId, position: 'vacation_approver' }, SYS);
    await ql.insert('sys_user_position', { id: 'hold_boss_locked', user_id: delegatorId, position: 'locked_duty' }, SYS);
  }, 90_000);

  afterAll(async () => { await stack?.stop(); });

  // ── WRITE path (D12 self-service gate branch) ──────────────────────────────
  it('a direct holder delegates a delegatable position over the API; granted_by is stamped', async () => {
    const r = await stack.apiAs(delegatorToken, 'POST', '/data/sys_user_position', {
      user_id: delegateId, position: 'vacation_approver', delegated_from: delegatorId,
      valid_until: validUntil, reason: 'covering approvals during PTO',
    });
    expect(r.status, await r.text().catch(() => '')).toBeLessThan(300);
    const row = await ql.findOne('sys_user_position', { where: { user_id: delegateId, position: 'vacation_approver' }, context: SYS.context });
    expect(row, 'delegation row persisted').toBeTruthy();
    expect(row.granted_by, 'dual audit: writer stamped as granted_by').toBe(delegatorId);
    expect(row.delegated_from, 'authority source recorded').toBe(delegatorId);
  });

  it('a delegation with no reason is rejected (dual audit is mandatory)', async () => {
    const r = await stack.apiAs(delegatorToken, 'POST', '/data/sys_user_position', {
      user_id: delegateId, position: 'vacation_approver', delegated_from: delegatorId, valid_until: validUntil,
    });
    expect(r.status, 'missing reason → denied').toBeGreaterThanOrEqual(400);
  });

  it('a non-delegatable position cannot be self-delegated even by a direct holder', async () => {
    const r = await stack.apiAs(delegatorToken, 'POST', '/data/sys_user_position', {
      user_id: delegateId, position: 'locked_duty', delegated_from: delegatorId,
      valid_until: validUntil, reason: 'nope',
    });
    expect(r.status, 'position not delegatable → denied').toBeGreaterThanOrEqual(400);
  });

  // ── RESOLUTION path (L1 validity filter on the delegated grant) ────────────
  it('the delegate RESOLVES the delegated position while inside the window', async () => {
    const ctx = await resolveAuthzContext({
      ql, headers: {}, getSession: sessionFor(delegateId), nowMs: Date.now(),
    });
    expect(ctx.positions, 'delegate holds the delegated position during the window').toContain('vacation_approver');
  });

  it('the delegated position STOPS resolving at valid_until — access dies, no cleanup job', async () => {
    const afterExpiry = Date.parse(validUntil) + 1000;
    const ctx = await resolveAuthzContext({
      ql, headers: {}, getSession: sessionFor(delegateId), nowMs: afterExpiry,
    });
    expect(ctx.positions, 'the delegated grant is gone the instant its window closes').not.toContain('vacation_approver');
  });
});
