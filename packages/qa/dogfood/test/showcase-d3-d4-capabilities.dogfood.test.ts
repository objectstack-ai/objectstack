// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// SHOWCASE proof for the two new authz capabilities on the REAL showcase app:
//   • ADR-0058 D3 / #1887 — a COMPOUND sharing `condition` (`&&`) compiles to a
//     compound criteria_json and enforces (the AND matters; before #1887 it was
//     silently skipped).
//   • ADR-0058 D4 — an RLS `check` clause validates the write POST-IMAGE: a
//     contributor cannot reassign an invoice they own to a different owner.
//
// @proof: showcase-d3-d4-capabilities

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';

const MEMBER = 'd34-member@verify.test';
const SYS = { context: { isSystem: true } } as const;

// Member set: invoice CRUD + an OWNER read/pre-image policy AND the D4 CHECK
// (post-image must keep owner == caller). Mirrors the showcase contributor's
// `invoice_owner_immutable` rule, exercised end-to-end over HTTP.
const memberSet = PermissionSetSchema.parse({
  name: 'showcase_d34_member',
  label: 'D3/D4 Member',
  objects: {
    showcase_project: { allowRead: true },
    showcase_invoice: { allowRead: true, allowCreate: true, allowEdit: true },
  },
  rowLevelSecurity: [
    { name: 'inv_own_read', object: 'showcase_invoice', operation: 'select', using: 'owner == current_user.email' },
    { name: 'inv_own_write', object: 'showcase_invoice', operation: 'update', using: 'owner == current_user.email' },
    { name: 'inv_owner_check', object: 'showcase_invoice', operation: 'update', check: 'owner == current_user.email' },
  ],
});

describe('showcase: D3 compound sharing (#1887) + D4 RLS check', () => {
  let stack: VerifyStack;
  let ql: any;
  let token: string;
  let invId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, memberSet],
        fallbackPermissionSet: 'showcase_d34_member',
      }),
    });
    await stack.signIn();
    token = await stack.signUp(MEMBER);
    ql = await stack.kernel.getServiceAsync('objectql');

    const idOf = (r: any) => r?.id ?? r?.record?.id ?? r;
    const acct = idOf(await ql.insert('showcase_account', { name: 'D34 Co', status: 'prospect' }, SYS));

    // Three projects: only the at-risk (red) AND high-budget (>100k) one matches.
    await ql.insert('showcase_project', { id: 'pj_red_hi', name: 'Red-Hi', account: acct, status: 'planned', health: 'red', budget: 250000 }, SYS);
    await ql.insert('showcase_project', { id: 'pj_red_lo', name: 'Red-Lo', account: acct, status: 'planned', health: 'red', budget: 40000 }, SYS);
    await ql.insert('showcase_project', { id: 'pj_grn_hi', name: 'Grn-Hi', account: acct, status: 'planned', health: 'green', budget: 250000 }, SYS);

    // An invoice owned by the member (system insert sidesteps authoring rules).
    invId = idOf(await ql.insert('showcase_invoice', { name: 'INV-D34', account: acct, owner: MEMBER, status: 'draft' }, SYS));
  }, 90_000);

  afterAll(async () => { await stack?.stop(); });

  // ── ADR-0058 D3 / #1887 ────────────────────────────────────────────────────
  it('compound sharing condition is SEEDED as a compound criteria_json (not skipped)', async () => {
    const rule = await ql.findOne('sys_sharing_rule', { where: { name: 'share_high_value_red_projects_with_managers' }, context: SYS.context });
    expect(rule, 'compound rule was seeded').toBeTruthy();
    expect(JSON.parse(rule.criteria_json)).toEqual({
      $and: [{ health: 'red' }, { budget: { $gt: 100000 } }],
    });
  });

  it('the compound criteria_json matches ONLY the project satisfying BOTH clauses', async () => {
    const rule = await ql.findOne('sys_sharing_rule', { where: { name: 'share_high_value_red_projects_with_managers' }, context: SYS.context });
    const criteria = JSON.parse(rule.criteria_json);
    // Apply the SEEDED compound criteria to our three projects: only red-AND-high passes.
    const hit = await ql.find('showcase_project', {
      where: { $and: [criteria, { id: { $in: ['pj_red_hi', 'pj_red_lo', 'pj_grn_hi'] } }] },
      fields: ['id'], context: SYS.context,
    });
    expect((hit ?? []).map((r: any) => r.id).sort()).toEqual(['pj_red_hi']);
    // The rule also evaluates end-to-end (matched count includes seed data).
    const rules: any = stack.kernel.getService('sharingRules');
    const res = await rules.evaluateRule('share_high_value_red_projects_with_managers', SYS.context);
    expect(res.matchedRecords, 'rule is evaluable + at least Red-Hi matches').toBeGreaterThanOrEqual(1);
  });

  // ── ADR-0058 D4 ────────────────────────────────────────────────────────────
  it('RLS check ALLOWS an update that keeps the owner (post-image valid)', async () => {
    const r = await stack.apiAs(token, 'PATCH', `/data/showcase_invoice/${invId}`, { name: 'INV-D34-v2' });
    expect(r.status, 'owner unchanged → write allowed').toBeLessThan(300);
  });

  it('RLS check DENIES reassigning the invoice to a different owner (post-image invalid)', async () => {
    const r = await stack.apiAs(token, 'PATCH', `/data/showcase_invoice/${invId}`, { owner: 'someone-else@verify.test' });
    expect(r.status, 'owner reassignment → write denied (fail-closed)').toBeGreaterThanOrEqual(400);
  });
});
