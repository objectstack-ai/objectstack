// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.cascading-options` (#26573): its api clauses
// at the REST data door of the booted showcase, as shipped.
//
//   acceptance[2], negative[1] — BOTH sides of the role gate on
//     `showcase_cascade.tier`, whose `restricted` option carries
//     `visibleWhen: 'org_admin' in current_user.positions`: a member holding
//     org_admin stores and re-reads tier 'restricted'; a plain member's direct
//     POST is refused invalid_option and nothing is stored. The seeded admin
//     is the org OWNER (org_owner, which does not imply org_admin), so the
//     admin persona here is a signed-up member whose membership is graded
//     `admin` — what accepting an admin invitation leaves (the grade
//     `org-admin-affordance-reach.dogfood.test.ts` measures the same way).
//   acceptance[4] — a legal cascade selection (cn / zj) re-reads verbatim.
//
// The picker narrowing (acceptance[0]) and the contact picker's re-query
// (acceptance[3]) stay browser legs; acceptance[1] is pinned by the objectui
// live spec's server case.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } } as const;
const CASCADE = 'showcase_cascade';

type Answer = { status: number; json: any };

describe('records-forms.cascading-options — the role-gated option and persistence over REST', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok = '';
  let orgAdminTok = '';
  let memberTok = '';

  const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

  /** The sign-up reconciler's membership row lands after the sign-up transaction. */
  const membershipOf = async (email: string) => {
    const [user] = await ql.find('sys_user', { where: { email }, limit: 1 }, SYS);
    for (let i = 0; i < 40; i++) {
      const [row] = await ql.find('sys_member', { where: { user_id: user.id }, limit: 1 }, SYS);
      if (row) return row;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`no sys_member row appeared for ${email}`);
  };
  const positionsOf = async (token: string): Promise<string[]> => (await stack.contextFor(token)).positions ?? [];

  beforeAll(async () => {
    stack = await bootShowcase();
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    orgAdminTok = await stack.signUp('cro-admin@verify.test', 'Cro!Pass12345', 'Cascade org admin');
    const grade = await membershipOf('cro-admin@verify.test');
    await ql.update('sys_member', { id: grade.id, role: 'admin' }, SYS);
    memberTok = await stack.signUp('cro-member@verify.test', 'Cro!Pass12345', 'Cascade member');
    await membershipOf('cro-member@verify.test');

    // The personas are what the clause says they are, read off the resolved context.
    expect(await positionsOf(orgAdminTok)).toContain('org_admin');
    expect(await positionsOf(memberTok)).not.toContain('org_admin');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[2]: a member holding org_admin stores tier restricted, and it re-reads', async () => {
    const name = uniq('cro-restricted');
    const created = await call(orgAdminTok, 'POST', `/data/${CASCADE}`, { name, tier: 'restricted' });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const [row] = await stack.rows(CASCADE, { name });
    expect(row?.tier).toBe('restricted');
  });

  it('acceptance[2], negative[1]: a plain member\'s direct tier restricted POST is refused invalid_option, and nothing is stored', async () => {
    const name = uniq('cro-denied');
    const denied = await call(memberTok, 'POST', `/data/${CASCADE}`, { name, tier: 'restricted' });
    expect(denied.status, JSON.stringify(denied.json)).toBe(400);
    expect(denied.json.code).toBe('VALIDATION_FAILED');
    expect((denied.json.fields ?? []).map((f: any) => [f.field, f.code])).toEqual([['tier', 'invalid_option']]);
    expect(await stack.rows(CASCADE, { name })).toHaveLength(0);
    // Control: the same member stores the ungated option.
    const standard = await call(memberTok, 'POST', `/data/${CASCADE}`, { name: uniq('cro-standard'), tier: 'standard' });
    expect(standard.status, JSON.stringify(standard.json)).toBe(201);
  });

  it('acceptance[4]: a legal cascade selection re-reads verbatim', async () => {
    const name = uniq('cro-legal');
    const created = await call(adminTok, 'POST', `/data/${CASCADE}`, { name, country: 'cn', province: 'zj' });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const [row] = await stack.rows(CASCADE, { name });
    const read = await call(adminTok, 'GET', `/data/${CASCADE}/${row.id}`);
    expect(read.status).toBe(200);
    expect(read.json.record ?? read.json).toMatchObject({ name, country: 'cn', province: 'zj' });
  });
});
