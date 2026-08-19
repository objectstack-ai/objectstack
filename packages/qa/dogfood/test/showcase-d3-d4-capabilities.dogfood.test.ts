// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// SHOWCASE proof for the two new authz capabilities on the REAL showcase app:
//   • ADR-0058 D3 / #1887 — a COMPOUND sharing `condition` (`&&`) compiles to a
//     compound criteria_json and enforces (the AND matters; before #1887 it was
//     silently skipped).
//
//     [#9237] The compound rule moved from `showcase_project` to
//     `showcase_contact`, and the D3 proof got its missing half with it. On
//     `showcase_project` (OWD `public_read_write`) sharing has nothing to
//     widen, so every grant the rule reconciled was REFUSED
//     (`SHARING_NOT_ENABLED`, ADR-0111 D7) — this file could assert the
//     criteria compiled and matched, and never that anything was ENFORCED,
//     while its own header claimed both. `showcase_contact` is OWD `private`,
//     so the grant lands and the enforcement half is now measured rather than
//     implied.
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
/** The showcase's compound (ADR-0058 D3) sharing rule — re-homed by #9237. */
const RULE = 'share_key_account_qualified_contacts_with_managers';
const SYS = { context: { isSystem: true } } as const;

// Member set: invoice CRUD + an OWNER read/pre-image policy AND the D4 CHECK
// (post-image must keep owner == caller). Mirrors the showcase contributor's
// `invoice_owner_immutable` rule, exercised end-to-end over HTTP.
const memberSet = PermissionSetSchema.parse({
  name: 'showcase_d34_member',
  label: 'D3/D4 Member',
  objects: {
    showcase_contact: { allowRead: true },
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

    // Three contacts: only the `qualified` AND key-account ('Northwind') one
    // matches. The other two each satisfy exactly ONE clause, so the AND is
    // measured in both directions rather than one.
    await ql.insert('showcase_contact', { id: 'ct_q_key', name: 'Q-Key', email: 'q.key@d34.example', company: 'Northwind', stage: 'qualified' }, SYS);
    await ql.insert('showcase_contact', { id: 'ct_q_other', name: 'Q-Other', email: 'q.other@d34.example', company: 'Contoso', stage: 'qualified' }, SYS);
    await ql.insert('showcase_contact', { id: 'ct_new_key', name: 'New-Key', email: 'new.key@d34.example', company: 'Northwind', stage: 'new' }, SYS);

    // An invoice owned by the member (system insert sidesteps authoring rules).
    invId = idOf(await ql.insert('showcase_invoice', { name: 'INV-D34', account: acct, owner: MEMBER, status: 'draft' }, SYS));
  }, 90_000);

  afterAll(async () => { await stack?.stop(); });

  // ── ADR-0058 D3 / #1887 ────────────────────────────────────────────────────
  it('compound sharing condition is SEEDED as a compound criteria_json (not skipped)', async () => {
    const rule = await ql.findOne('sys_sharing_rule', { where: { name: RULE }, context: SYS.context });
    expect(rule, 'compound rule was seeded').toBeTruthy();
    expect(JSON.parse(rule.criteria_json)).toEqual({
      $and: [{ stage: 'qualified' }, { company: 'Northwind' }],
    });
  });

  it('the compound criteria_json matches ONLY the contact satisfying BOTH clauses', async () => {
    const rule = await ql.findOne('sys_sharing_rule', { where: { name: RULE }, context: SYS.context });
    const criteria = JSON.parse(rule.criteria_json);
    // Apply the SEEDED compound criteria to our three contacts: only qualified-AND-key passes.
    const hit = await ql.find('showcase_contact', {
      where: { $and: [criteria, { id: { $in: ['ct_q_key', 'ct_q_other', 'ct_new_key'] } }] },
      fields: ['id'], context: SYS.context,
    });
    expect((hit ?? []).map((r: any) => r.id).sort()).toEqual(['ct_q_key']);
    // The rule also evaluates end-to-end (matched count includes seed data).
    const rules: any = stack.kernel.getService('sharingRules');
    const res = await rules.evaluateRule(RULE, SYS.context);
    expect(res.matchedRecords, 'rule is evaluable + at least Q-Key matches').toBeGreaterThanOrEqual(1);
  });

  it('[#9237] the grant the rule reconciles is one the gates CONSULT — not refused as inert', async () => {
    // The half this proof could never carry on `showcase_project`. The verdict
    // is caller-independent (ADR-0111 D7) and computed from the OWD alone, so
    // it is asserted directly rather than inferred from a reconcile count that
    // an empty recipient expansion would leave silently at zero — which is
    // exactly how the sibling rule on `showcase_project` produced no boot WARN
    // while being just as dead.
    const sharing: any = await stack.kernel.getServiceAsync('sharing');
    const granted = await sharing.grant(
      { object: 'showcase_contact', recordId: 'ct_q_key', recipientType: 'user', recipientId: 'u_d34_probe', accessLevel: 'read' },
      { isSystem: true },
    );
    expect(granted, 'a share row on a private-OWD object is accepted').toBeTruthy();

    // The contrast that names the retired rules' defect, on the object they
    // used to sit on: same call, same caller, refused for the OWD alone. The
    // record id deliberately names no row — the D7 verdict is computed from
    // the OBJECT before any record is read, which is precisely why it is
    // caller- and record-independent. Both the code and the object are
    // asserted, so a refusal arriving for some other reason cannot pass.
    await expect(
      sharing.grant(
        { object: 'showcase_project', recordId: 'pj_absent', recipientType: 'user', recipientId: 'u_d34_probe', accessLevel: 'read' },
        { isSystem: true },
      ),
    ).rejects.toThrow(/SHARING_NOT_ENABLED: 'showcase_project' is not under record-sharing enforcement/);
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
