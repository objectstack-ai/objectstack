// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0057 D6 (reconciles ADR-0056 D6 / #2077 demo) — a sharing rule whose
// recipient is `unit_and_subordinates` widens access DOWN the hierarchy: the
// unit's members AND every subordinate (descendant) unit's members gain access
// via the `sys_business_unit` tree (BFS). This is the honest re-homing of the
// broken `unit_and_subordinates` (sys_position.parent never existed) onto the
// working business-unit tree. Proven end-to-end: the rule materialises
// sys_record_share rows; a non-owner in the unit subtree can then read a
// private record.
//
// [#7807] The widening rule below used to be authored as `business_unit`, and
// it passed — because the runtime routed BOTH recipient kinds through the same
// subtree walk, so the narrow spelling silently over-granted. The maintainer
// ruled (2026-08-12) to narrow the runtime to the declaration, which makes the
// recipient kind load-bearing here rather than interchangeable: widening is
// `unit_and_subordinates`' own semantics. The second suite pins the other half
// end-to-end — a `business_unit` rule reaches the anchor unit and stops there —
// because a fix that narrowed BOTH kinds would satisfy the first suite's
// headline while destroying the distinction the spec draws.
//
// @proof: showcase-bu-hierarchy-sharing
//
// ADR-0056 D10 — the authz-conformance matrix rows this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976). Two
// rows on two assertions: the criteria rule MATERIALISING into sys_record_share
// (`sharing-rules`, here via the `business_unit` recipient), and the subordinate
// unit's member reading through the tree (`hierarchy-widening`).
// authz-row: sharing-rules
// authz-row: hierarchy-widening

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const OBJ = '/data/showcase_private_note';
const SYS = { isSystem: true } as const;

describe('showcase: business-unit hierarchy sharing rule (ADR-0057 D6 / #2077)', () => {
  let stack: VerifyStack;
  let ql: any;
  let ownerTok: string, mgrTok: string, contribTok: string, outsiderTok: string;
  let noteId: string;
  /** [#7807] The note shared with the narrow `business_unit` recipient. */
  let exactNoteId: string;

  beforeAll(async () => {
    // [#5491] The platform baseline no longer ships a `'*'` object grant, so a
    // grant-less sign-up can no longer create the private note this fixture
    // shares. Boot the showcase the way the CLI does — under its OWN declared
    // default profile, which grants `showcase_private_note` create/read/edit.
    stack = await bootStack(showcaseStack, { security: showcaseAppDefaultSecurity() });
    await stack.signIn();
    ownerTok = await stack.signUp('bu-owner@verify.test');
    mgrTok = await stack.signUp('bu-mgr@verify.test');       // parent BU
    contribTok = await stack.signUp('bu-contrib@verify.test'); // child BU
    outsiderTok = await stack.signUp('bu-outsider@verify.test'); // no BU

    ql = await stack.kernel.getServiceAsync('objectql');
    const sys = (o: string, d: any) => ql.insert(o, d, { context: SYS });
    const uid = async (e: string) => (await ql.findOne('sys_user', { where: { email: e }, context: SYS }))?.id;
    const mgrId = await uid('bu-mgr@verify.test');
    const contribId = await uid('bu-contrib@verify.test');

    let org = await ql.findOne('sys_organization', { where: {}, context: SYS }).catch(() => null);
    const orgId = org?.id ?? 'org_bu';
    if (!org) await sys('sys_organization', { id: orgId, name: 'BU Org', slug: 'bu_org' }).catch(() => {});

    // parent ⊃ child
    await sys('sys_business_unit', { id: 'bu_h_parent', name: 'Region', kind: 'division', organization_id: orgId, active: true });
    await sys('sys_business_unit', { id: 'bu_h_child', name: 'Team', kind: 'department', parent_business_unit_id: 'bu_h_parent', organization_id: orgId, active: true });
    await sys('sys_business_unit_member', { id: 'bm_mgr', business_unit_id: 'bu_h_parent', user_id: mgrId });
    await sys('sys_business_unit_member', { id: 'bm_contrib', business_unit_id: 'bu_h_child', user_id: contribId });

    // owner creates a PRIVATE note — only the owner can see it by default.
    const c = await stack.apiAs(ownerTok, 'POST', OBJ, { title: 'BU-shared note' });
    expect(c.status, 'owner creates note').toBeLessThan(300);
    noteId = (await c.json())?.id ?? (await c.json())?.record?.id;
    if (!noteId) {
      const row = await ql.findOne('showcase_private_note', { where: { title: 'BU-shared note' }, context: SYS });
      noteId = row?.id;
    }

    // Define a sharing rule: share the BU-shared note with the PARENT business
    // unit AND, via the tree, its descendants. Recipient =
    // `unit_and_subordinates` — the kind whose declared semantics IS the
    // subtree (#7807). The criteria is not optional — a rule without one would
    // share every record of the object, which defineRule now rejects (#3896).
    const rules: any = stack.kernel.getService('sharingRules');
    await rules.defineRule({
      name: 'share_notes_with_region',
      label: 'Notes → Region (BU subtree)',
      object: 'showcase_private_note',
      criteria: { title: 'BU-shared note' },
      recipientType: 'unit_and_subordinates',
      recipientId: 'bu_h_parent',
      accessLevel: 'read',
      active: true,
    }, SYS);
    // Materialise grants for existing records.
    await rules.evaluateRule('share_notes_with_region', SYS);

    // [#7807] The narrow half, on the SAME tree and the SAME members: a second
    // note shared with `business_unit` anchored at the SAME parent unit. A
    // separate record is required — sharing both notes through one rule pair
    // would let the subtree rule's grants answer for the narrow one.
    const c2 = await stack.apiAs(ownerTok, 'POST', OBJ, { title: 'BU-exact note' });
    expect(c2.status, 'owner creates the exact-width note').toBeLessThan(300);
    exactNoteId = (await c2.json())?.id ?? (await c2.json())?.record?.id;
    if (!exactNoteId) {
      const row = await ql.findOne('showcase_private_note', { where: { title: 'BU-exact note' }, context: SYS });
      exactNoteId = row?.id;
    }
    await rules.defineRule({
      name: 'share_notes_with_region_exact',
      label: 'Notes → Region (exactly that unit)',
      object: 'showcase_private_note',
      criteria: { title: 'BU-exact note' },
      recipientType: 'business_unit',
      recipientId: 'bu_h_parent',
      accessLevel: 'read',
      active: true,
    }, SYS);
    await rules.evaluateRule('share_notes_with_region_exact', SYS);
  }, 90_000);

  afterAll(async () => { await stack?.stop(); });

  it('materialises sys_record_share rows for the BU subtree', async () => {
    const shares = await ql.find('sys_record_share', {
      where: { object_name: 'showcase_private_note', record_id: noteId, source: 'rule' },
      context: SYS,
    });
    const recipients = (shares ?? []).map((s: any) => s.recipient_id);
    const mgrId = (await ql.findOne('sys_user', { where: { email: 'bu-mgr@verify.test' }, context: SYS }))?.id;
    const contribId = (await ql.findOne('sys_user', { where: { email: 'bu-contrib@verify.test' }, context: SYS }))?.id;
    expect(recipients, 'parent-BU member granted').toContain(mgrId);
    expect(recipients, 'child-BU (subordinate) member granted via hierarchy').toContain(contribId);
  });

  it('a manager in the unit can READ the owner\'s private note', async () => {
    const r = await stack.apiAs(mgrTok, 'GET', `${OBJ}/${noteId}`);
    expect(r.status, 'manager reads via BU share').toBe(200);
  });

  it('a contributor in a SUBORDINATE unit can READ it too (hierarchy widening)', async () => {
    const r = await stack.apiAs(contribTok, 'GET', `${OBJ}/${noteId}`);
    expect(r.status, 'subordinate-unit member reads via hierarchy widening').toBe(200);
  });

  it('an outsider (no business unit) is NOT granted access', async () => {
    const r = await stack.apiAs(outsiderTok, 'GET', `${OBJ}/${noteId}`);
    expect(r.status, 'outsider stays denied').not.toBe(200);
  });

  // ── [#7807] the narrow half of the pair ────────────────────────────────
  //
  // Same tree, same members, same booted stack — only the recipient KIND
  // differs. Before #7807 every assertion in this block failed: the
  // `business_unit` rule walked the subtree exactly like the one above.

  it('materialises grants for the anchor unit ONLY (no subtree)', async () => {
    const shares = await ql.find('sys_record_share', {
      where: { object_name: 'showcase_private_note', record_id: exactNoteId, source: 'rule' },
      context: SYS,
    });
    const recipients = (shares ?? []).map((s: any) => s.recipient_id);
    const mgrId = (await ql.findOne('sys_user', { where: { email: 'bu-mgr@verify.test' }, context: SYS }))?.id;
    const contribId = (await ql.findOne('sys_user', { where: { email: 'bu-contrib@verify.test' }, context: SYS }))?.id;
    expect(recipients, 'anchor-unit member granted').toContain(mgrId);
    expect(recipients, 'subordinate-unit member NOT granted — business_unit is exactly one unit')
      .not.toContain(contribId);
  });

  it('a manager in the anchor unit can READ the exact-width note', async () => {
    const r = await stack.apiAs(mgrTok, 'GET', `${OBJ}/${exactNoteId}`);
    expect(r.status, 'anchor-unit member reads via the narrow BU share').toBe(200);
  });

  it('a contributor in a SUBORDINATE unit is DENIED the exact-width note', async () => {
    const r = await stack.apiAs(contribTok, 'GET', `${OBJ}/${exactNoteId}`);
    expect(r.status, 'subordinate-unit member denied — no subtree widening on business_unit')
      .not.toBe(200);
  });
});
