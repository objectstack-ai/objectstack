// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineFlow } from '@objectstack/spec';

/**
 * #3508 dogfood: one node per RECORD-BACKED approver kind.
 *
 * The designer's Approvers → Value control used to query the metadata registry
 * (`GET /api/v1/meta/:type`) for every kind. `user` / `team` / `department` /
 * `position` are DATA rows in the platform's directory objects, not registry
 * entries, so candidates came back empty and the control degraded to a free-text
 * box — the author could only hand-type a userid. `APPROVER_VALUE_BINDINGS`
 * now publishes the data contract per kind (`xRef.sources`), and the designer
 * renders a real record lookup off it.
 *
 * This flow is the authoring specimen for that surface: every kind whose control
 * changed gets a node, so opening it in the flow designer exercises each one.
 * The existing approval flows in `./index.ts` already cover `position` heavily
 * (it is the kind showcase actually routes on) and `./dynamic-approval.flow.ts`
 * covers `org_membership_level` + `expression`; the kinds below are the ones no
 * other flow declares.
 *
 * ## Why `draft`
 *
 * Deliberate, not an oversight. The record-backed kinds point at rows a fresh
 * boot does not have: `sys_user` holds only the seeded admin, `sys_team` is
 * empty (the seeded `Team` rows are the DEMO `showcase_team` object), and both
 * unit membership (`sys_business_unit_member`) and position assignment
 * (`sys_user_position`) are runtime admin actions by design — see the seed
 * notes in `src/data/seed/index.ts`. An `active` flow over them would resolve
 * to nobody, which is precisely the silent dead slot #3508 exists to remove.
 * Shipping that as a demo would re-teach the bug. `draft` keeps it out of the
 * runtime while still loading in the designer, which is the surface under test.
 *
 * `queue` is absent on purpose: #3536 made it non-authorable
 * (`NON_AUTHORABLE_APPROVER_TYPES` → `xEnumDeprecated`) because the engine has
 * no queue branch, so the designer no longer offers it.
 */
export const ApproverBindingsFlow = defineFlow({
  name: 'showcase_approver_bindings',
  label: 'Approver Binding Specimens (#3508)',
  description:
    'Authoring specimen: one approval node per record-backed approver kind, so the designer '
    + 'renders each Value control. Draft on purpose — a fresh org has no rows for these kinds.',
  type: 'autolaunched',
  status: 'draft',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Field Zoo Updated',
      config: {
        objectName: 'showcase_field_zoo',
        triggerType: 'record-after-update',
      },
    },
    {
      id: 'by_user',
      type: 'approval',
      label: 'Named user',
      config: {
        // `sys_user` row id. The most portable-hostile choice there is — an id
        // does not survive an environment migration and dies with the person —
        // which is why the designer's Type dropdown lists it LAST.
        approvers: [{ type: 'user', value: '' }],
        behavior: 'first_response',
      },
    },
    {
      id: 'by_team',
      type: 'approval',
      label: 'Team members',
      config: {
        // `sys_team` row id; the engine expands it through `sys_team_member`.
        approvers: [{ type: 'team', value: '' }],
        behavior: 'first_response',
      },
    },
    {
      id: 'by_department',
      type: 'approval',
      label: 'Department members',
      config: {
        // `sys_business_unit` row id — NOT `sys_department`. The seeded org tree
        // (bu_acme / bu_field_ops / bu_west_coast / …) is what this picker lists.
        approvers: [{ type: 'department', value: '' }],
        behavior: 'first_response',
      },
    },
    {
      id: 'by_position',
      type: 'approval',
      label: 'Position holders',
      config: {
        // Commits the position's machine NAME, not its row id: the engine routes
        // on `sys_user_position.position`, and a machine name is what stays
        // valid across environments. `manager` is a showcase position.
        approvers: [{ type: 'position', value: 'manager' }],
        behavior: 'first_response',
      },
    },
    {
      id: 'by_manager',
      type: 'approval',
      label: "Submitter's manager",
      config: {
        // Resolved at run time from the submitter — there is no value to author,
        // so the designer disables the cell instead of offering a free-text box.
        approvers: [{ type: 'manager' }],
        behavior: 'first_response',
      },
    },
    {
      id: 'by_field',
      type: 'approval',
      label: 'User in a trigger field',
      config: {
        // Value is a FIELD NAME on the trigger object, not a record reference —
        // so this one keeps the object-field selector rather than a record
        // lookup. `f_user` is Field Zoo's single-value `sys_user` reference.
        approvers: [{ type: 'field', value: 'f_user' }],
        behavior: 'first_response',
      },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'by_user' },
    { id: 'e2', source: 'by_user', target: 'by_team', label: 'approve' },
    { id: 'e3', source: 'by_team', target: 'by_department', label: 'approve' },
    { id: 'e4', source: 'by_department', target: 'by_position', label: 'approve' },
    { id: 'e5', source: 'by_position', target: 'by_manager', label: 'approve' },
    { id: 'e6', source: 'by_manager', target: 'by_field', label: 'approve' },
    { id: 'e7', source: 'by_field', target: 'approved', label: 'approve' },
    { id: 'e8', source: 'by_user', target: 'rejected', label: 'reject' },
    { id: 'e9', source: 'by_team', target: 'rejected', label: 'reject' },
    { id: 'e10', source: 'by_department', target: 'rejected', label: 'reject' },
    { id: 'e11', source: 'by_position', target: 'rejected', label: 'reject' },
    { id: 'e12', source: 'by_manager', target: 'rejected', label: 'reject' },
    { id: 'e13', source: 'by_field', target: 'rejected', label: 'reject' },
  ],
});
