// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Sharing rules — the WIDENING layer of the ADR-0090 permission model.
 *
 * Each object's OWD (`sharingModel`) is the record-visibility baseline;
 * sharing only ever WIDENS it (and RLS only ever narrows). A criteria rule's
 * CEL `condition` is compiled to a runtime filter at seed time and
 * materializes `sys_record_share` grants for the resolved recipients
 * (ADR-0058 D3). Recipients here exercise both enforced recipient kinds:
 * `position` (flat holder expansion) and `unit_and_subordinates`
 * (business-unit SUBTREE expansion — the unit named by `value` plus every
 * descendant unit's members, ADR-0057 D5 / ADR-0090 D3).
 *
 * ## Where a rule may live (ADR-0111 D7 / ADR-0049), and why two were retired
 *
 * "Sharing only ever WIDENS" has a consequence that is easy to author past:
 * on an object whose OWD is already the widest one, there is nothing left to
 * widen, so a `sys_record_share` row on it is never consulted by any gate.
 * `SharingService.inertGrantReason` states that as a verdict and
 * `assertNotInertGrant` REFUSES the write — which is why a rule anchored on
 * such an object does not merely under-deliver, it fails its boot backfill:
 *
 *   WARN SharingServicePlugin: boot rule backfill failed for rule
 *     {"rule":"…","error":"SHARING_NOT_ENABLED: '…' is not under
 *      record-sharing enforcement (public sharing model or no 'owner_id'
 *      field); a share row on it would never be consulted"}
 *
 * `showcase_project` and `showcase_task` are `sharingModel:
 * 'public_read_write'` by DELIBERATE declaration — each carries an explicit
 * ADR-0090 D1 grandfather stamp, and that OWD is load-bearing well beyond the
 * security demo (it is what lets a `showcase_contributor` PATCH a project row
 * it did not create, the write floor pinned by
 * `owd-public-read-write-write-floor.dogfood.test.ts`). So no sharing rule can
 * ever take effect there, and ADR-0049's enforce-or-remove leaves exactly one
 * honest move: remove.
 *
 * Retired here, therefore, and NOT re-homed onto another public object:
 *
 *   • `share_red_projects_with_execs` — criteria rule on `showcase_project`.
 *   • `share_open_tasks_with_manager` — criteria rule on `showcase_task`.
 *     This one was ITSELF a repair: it replaced the owner-based
 *     `share_contributor_tasks_with_manager`, which `type: 'owner'` made
 *     silently skipped at seed time (ADR-0078: nothing on the authoring
 *     surface may be silently inert). That repair moved the inertness instead
 *     of removing it — the replacement validated, seeded, and then failed its
 *     backfill on every boot. The lesson is written down rather than repeated:
 *     a sharing-rule demonstration belongs on an object under record-sharing
 *     ENFORCEMENT, and `inert-wirings.test.ts` §6 now fails the build if a
 *     future rule lands on a public one again.
 *
 * The capabilities those two carried — a `position` recipient, and a COMPOUND
 * CEL condition (ADR-0058 D3) — are not dropped: both live on
 * `KeyAccountQualifiedContactRule` below, on an object where the grant is real.
 */

import { defineSharingRule } from '@objectstack/spec/security';

/**
 * Business-unit SUBTREE recipient (`unit_and_subordinates`): new inquiries are
 * shared for triage with everyone in the Field Operations unit — AND every
 * descendant unit (West Coast, East Coast) via the `sys_business_unit` tree.
 * `value` is the business-unit row id (`bu_field_ops`, seeded with an explicit
 * id in src/data/seed/ precisely so this rule can reference it statically).
 * Inquiries are OWD `private`, so WITHOUT this rule a non-owner member sees
 * none; the rule + the member baseline's `allowRead` is what lets Field Ops
 * staff read incoming leads.
 */
export const NewInquiryFieldOpsRule = defineSharingRule({
  type: 'criteria',
  name: 'share_new_inquiries_with_field_ops',
  label: 'New Inquiries → Field Operations (BU subtree)',
  description:
    'Share incoming (status=new) inquiries with the Field Operations business-unit subtree for triage.',
  object: 'showcase_inquiry',
  condition: "record.status == 'new'",
  accessLevel: 'read',
  sharedWith: { type: 'unit_and_subordinates', value: 'bu_field_ops' },
  active: true,
});

/**
 * [ADR-0058 D3 / closes #1887] criteria-based with a COMPOUND CEL condition,
 * and the showcase's `position`-recipient demonstration.
 *
 * Before #1887 a multi-clause `&&` condition was silently skipped (the sharing
 * rule was decorative metadata); now it compiles to a compound `criteria_json`
 * and enforces. The AND matters, and the seed data demonstrates it in BOTH
 * directions rather than one: of the seeded contacts, three are `qualified`
 * (only one of them at Northwind) and many are at Northwind (none of those
 * others `qualified`) — so a row satisfying either clause alone is NOT shared,
 * and exactly the row satisfying both is.
 *
 * ## Why this object and this recipient
 *
 * `showcase_contact` is OWD `private`, so the grant is one the read gate
 * actually consults (ADR-0111 D7), and the `showcase_manager` permission set
 * grants `showcase_contact.allowRead` — the object-level bit a share row still
 * needs before any record-level widening can be observed. Both halves are
 * pinned by `inert-wirings.test.ts` §6, which is the guard that would have
 * caught the two rules retired above at authoring time.
 */
export const KeyAccountQualifiedContactRule = defineSharingRule({
  type: 'criteria',
  name: 'share_key_account_qualified_contacts_with_managers',
  label: 'Key-Account Qualified Contacts → Managers',
  description:
    'Share qualified contacts at the key account with managers (compound condition, ADR-0058 D3).',
  object: 'showcase_contact',
  condition: "record.stage == 'qualified' && record.company == 'Northwind'",
  accessLevel: 'read',
  sharedWith: { type: 'position', value: 'manager' },
  active: true,
});

export const allSharingRules = [
  NewInquiryFieldOpsRule,
  KeyAccountQualifiedContactRule,
];
