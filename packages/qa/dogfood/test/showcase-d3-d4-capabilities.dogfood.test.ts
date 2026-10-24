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
//     widen for the organization's staff, so every grant the rule reconciled
//     was REFUSED (`SHARING_NOT_ENABLED`, ADR-0111 D7; since #25549 a share
//     there is consulted for an `external` member alone) — this file could
//     assert the criteria compiled and matched, and never that anything was
//     ENFORCED, while its own header claimed both. `showcase_contact` is OWD
//     `private`, so the grant lands and the enforcement half is now measured
//     rather than implied.
//   • ADR-0058 D4 — an RLS `check` clause validates the write POST-IMAGE: a
//     contributor cannot reassign an invoice they own to a different owner.
//
// @proof: showcase-d3-d4-capabilities

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ISharingRuleService } from '@objectstack/spec/contracts';

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
  let pjId: string;
  let memberId: string;

  beforeAll(async () => {
    stack = await bootShowcase({
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

    // [#25549] A real project, and the member's user id: the D7 contrast on
    // `showcase_project` is judged against a record's organization and a recipient.
    pjId = idOf(await ql.insert('showcase_project', { name: 'D34 Project', account: acct, status: 'planned' }, SYS));
    memberId = String((await ql.findOne('sys_user', { where: { email: MEMBER }, context: SYS.context }))?.id ?? '');
  }, 90_000);

  afterAll(async () => { await stack?.stop(); });

  // ── ADR-0058 D3 / #1887 ────────────────────────────────────────────────────
  it('compound sharing condition is SERVED as a compound criteria (not skipped)', async () => {
    // [ADR-0131 D2] Read from the registry by the sharing-rule service — the
    // boot writes no sys_sharing_rule row for a declared rule.
    const rule = await stack.kernel.getService<ISharingRuleService>('sharingRules').getRule(RULE, SYS.context);
    expect(rule, 'compound rule is served').toBeTruthy();
    expect(rule?.criteria).toEqual({
      $and: [{ stage: 'qualified' }, { company: 'Northwind' }],
    });
  });

  it('the compound criteria matches ONLY the contact satisfying BOTH clauses', async () => {
    const rule = await stack.kernel.getService<ISharingRuleService>('sharingRules').getRule(RULE, SYS.context);
    const criteria = rule?.criteria;
    // Apply the SERVED compound criteria to our three contacts: only qualified-AND-key passes.
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
    // The half this proof could never carry on `showcase_project`. On a
    // private object the verdict is caller-independent (ADR-0111 D7) and
    // computed from the OWD alone, so
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
    // used to sit on: same call, same caller, refused. [#25549] On a public
    // object the D7 verdict is no longer the OWD's alone: the external OWD
    // floor consults a share there, so the verdict reads one fact about the
    // recipient — is it an `external` member of the RECORD's organization?
    // The retired rules' `position` recipients expand to that organization's
    // staff, so the probe is a real project and a staff member of its
    // organization (both preconditions asserted). Both the code and the reason
    // are asserted, so a refusal arriving for some other reason cannot pass —
    // a record the verdict cannot place answers "that organization could not
    // be resolved" instead.
    const pjOrg = (await ql.findOne('showcase_project', { where: { id: pjId }, fields: ['organization_id'], context: SYS.context }))?.organization_id;
    expect(pjOrg, 'fixture: the project carries an organization').toBeTruthy();
    const membership = await ql.findOne('sys_member', {
      where: { user_id: memberId, organization_id: pjOrg }, fields: ['role'], context: { ...SYS.context, tenantId: pjOrg },
    });
    expect(membership?.role, 'fixture: the member is staff of that organization, not external').toBe('member');
    await expect(
      sharing.grant(
        { object: 'showcase_project', recordId: pjId, recipientType: 'user', recipientId: memberId, accessLevel: 'read' },
        { isSystem: true },
      ),
    ).rejects.toThrow(
      /SHARING_NOT_ENABLED: 'showcase_project' has a public sharing model, so a share row on it is consulted only for an external member of the record's organization, and the recipient is not one/,
    );
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
