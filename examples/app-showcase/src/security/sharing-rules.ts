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
 */

import { defineSharingRule } from '@objectstack/spec/security';

/** criteria-based: red-health projects are shared up to executives. */
export const RedProjectSharingRule = defineSharingRule({
  type: 'criteria',
  name: 'share_red_projects_with_execs',
  label: 'Red Projects → Executives',
  description: 'Automatically share at-risk (red health) projects with executives.',
  object: 'showcase_project',
  condition: "record.health == 'red'",
  accessLevel: 'read',
  sharedWith: { type: 'position', value: 'exec' },
  active: true,
});

/**
 * [ADR-0058 D3 / closes #1887] criteria-based with a COMPOUND CEL condition.
 * Before #1887 a multi-clause `&&` condition was silently skipped (the sharing
 * rule was decorative metadata); now it compiles to a compound `criteria_json`
 * and enforces. Shares only projects that are BOTH at-risk (red) AND high-budget
 * with managers — the AND matters: a red but low-budget project is NOT shared.
 */
export const HighValueRedProjectRule = defineSharingRule({
  type: 'criteria',
  name: 'share_high_value_red_projects_with_managers',
  label: 'High-Value Red Projects → Managers',
  description:
    'Share at-risk (red health) projects over the budget threshold with managers (compound condition, ADR-0058 D3).',
  object: 'showcase_project',
  condition: "record.health == 'red' && record.budget > 100000",
  accessLevel: 'read',
  sharedWith: { type: 'position', value: 'manager' },
  active: true,
});

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
 * owner-based: a contributor's tasks are shared read-only with managers.
 *
 * [experimental — not enforced] Owner-type rules depend on live position
 * membership and have no static `criteria_json` equivalent, so the seed
 * bootstrap SKIPS them (logged) rather than seeding a permissive match-all
 * (ADR-0049: nothing silently over-shares). Kept here to demonstrate the
 * authoring shape; managers actually reach contributor tasks via the
 * criteria rules above and their depth grants.
 */
export const ContributorTaskSharingRule = defineSharingRule({
  type: 'owner',
  name: 'share_contributor_tasks_with_manager',
  label: 'Contributor Tasks → Manager',
  description: "Share each contributor's tasks with managers for oversight.",
  object: 'showcase_task',
  ownedBy: { type: 'position', value: 'contributor' },
  accessLevel: 'read',
  sharedWith: { type: 'position', value: 'manager' },
  active: true,
});

export const allSharingRules = [
  RedProjectSharingRule,
  HighValueRedProjectRule,
  NewInquiryFieldOpsRule,
  ContributorTaskSharingRule,
];
