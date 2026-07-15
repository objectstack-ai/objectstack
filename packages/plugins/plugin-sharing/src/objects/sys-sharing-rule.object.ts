// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_sharing_rule — Declarative record-sharing rule.
 *
 * Salesforce-style criteria-based sharing: "any record on object O that
 * matches criteria C is granted access level A to recipient R". Rules
 * are evaluated by `@objectstack/plugin-sharing` and materialise their
 * grants as rows in `sys_record_share` with `source='rule'` and
 * `source_id={rule.id}` so the evaluator can reconcile (delete + re-
 * insert) on rule updates without touching manual grants.
 *
 * Evaluation triggers:
 *   - `afterInsert` / `afterUpdate` on the target object (per-record,
 *     incremental — the hot path).
 *   - REST `POST /sharing/rules/:id/evaluate` (admin-initiated
 *     bulk reconcile — used after rule edits).
 *
 * Criteria are stored as JSON (a normal `FilterCondition`) so the
 * existing engine `find()` can do the matching natively. v1 supports
 * simple `{field, op, value}` style filters; CEL predicates are a
 * follow-up.
 *
 * @namespace sys
 */
export const SysSharingRule = ObjectSchema.create({
  name: 'sys_sharing_rule',
  label: 'Sharing Rule',
  pluralLabel: 'Sharing Rules',
  icon: 'shield-check',
  isSystem: true,
  managedBy: 'config',
  // Sharing rules can now be authored visually via the Studio criteria
  // builder (apps/studio/src/components/SharingCriteriaBuilder.tsx).
  // We still recommend `defineSharingRule({...})` for repo-controlled
  // baselines, but admins can safely create/edit/delete from the UI.
  userActions: { create: true, edit: true, delete: true, import: false },
  description: 'Declarative sharing rule that auto-materialises sys_record_share grants. Authored via defineSharingRule() in code or the Studio criteria builder.',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{label}',
  highlightFields: ['name', 'object_name', 'recipient_type', 'recipient_id', 'access_level', 'active'],

  listViews: {
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_sharing_rule' },
      columns: ['label', 'object_name', 'recipient_type', 'recipient_id', 'access_level', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: true }],
      sort: [{ field: 'object_name', order: 'asc' }, { field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    inactive: {
      type: 'grid',
      name: 'inactive',
      label: 'Inactive',
      data: { provider: 'object', object: 'sys_sharing_rule' },
      columns: ['label', 'object_name', 'recipient_type', 'recipient_id', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: false }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    by_object: {
      type: 'grid',
      name: 'by_object',
      label: 'By Object',
      data: { provider: 'object', object: 'sys_sharing_rule' },
      columns: ['object_name', 'label', 'recipient_type', 'access_level', 'active'],
      sort: [{ field: 'object_name', order: 'asc' }, { field: 'label', order: 'asc' }],
      grouping: { fields: [{ field: 'object_name', order: 'asc', collapsed: false }] },
      pagination: { pageSize: 100 },
    },
    all_rules: {
      type: 'grid',
      name: 'all_rules',
      label: 'All',
      data: { provider: 'object', object: 'sys_sharing_rule' },
      columns: ['label', 'object_name', 'recipient_type', 'recipient_id', 'access_level', 'active', 'updated_at'],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'Rule ID', required: true, readonly: true, group: 'System' }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
      description: 'Tenant that owns this rule; null = global',
    }),

    name: Field.text({
      label: 'Name',
      required: true,
      maxLength: 100,
      description: 'Unique snake_case rule name',
      group: 'Identity',
    }),

    label: Field.text({
      label: 'Display Label',
      required: true,
      maxLength: 200,
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 100,
      // Rendered as an object picker (choose a registered object by name)
      // instead of a free-text machine-name input. Falls back to a text input
      // when the `field:object-ref` widget is unavailable.
      widget: 'object-ref',
      description: 'Short object name (e.g. opportunity, account)',
      group: 'Target',
    }),

    criteria_json: Field.textarea({
      label: 'Criteria (FilterCondition JSON)',
      required: false,
      // Rendered as a visual criteria builder scoped to the selected object's
      // fields (dependsOn: object_name), storing the same JSON FilterCondition.
      // An "Edit as JSON" fallback keeps hand-authored / advanced filters
      // editable. Falls back to a textarea when the widget is unavailable.
      widget: 'filter-condition',
      dependsOn: ['object_name'],
      description: 'JSON FilterCondition matched against records of object_name. Empty = match all.',
      group: 'Target',
    }),

    recipient_type: Field.select(
      // `queue` was removed: it is declared-but-unenforced (the evaluator returns
      // no users for it), so offering it would author a silently-inert rule
      // (ADR-0078). The five values below are the ones the evaluator expands.
      ['user', 'team', 'business_unit', 'position', 'unit_and_subordinates'],
      {
        label: 'Recipient Type',
        required: true,
        defaultValue: 'business_unit',
        description: 'Kind of principal that receives access — expanded to user grants at evaluation time. `business_unit` walks the parent_business_unit_id tree; `team` is flat (better-auth); `position` expands the position\'s holders (positions are flat, ADR-0090 D3); `unit_and_subordinates` expands the named business unit PLUS every descendant unit\'s members via the sys_business_unit tree (ADR-0057 D5).',
        group: 'Recipient',
      },
    ),

    recipient_id: Field.text({
      label: 'Recipient',
      required: true,
      maxLength: 200,
      // Rendered as a record picker whose target object follows recipient_type
      // (dependsOn: recipient_type): sys_user / sys_team / sys_business_unit /
      // sys_position. Stores the value the evaluator matches on — a record id
      // for user/team/business_unit, the position NAME for `position`. Falls
      // back to a text input when the widget is unavailable.
      widget: 'recipient-picker',
      dependsOn: ['recipient_type'],
      description: 'business-unit id / team id / position name / user id depending on recipient_type',
      group: 'Recipient',
    }),

    access_level: Field.select(
      ['read', 'edit', 'full'],
      {
        label: 'Access Level',
        required: true,
        defaultValue: 'read',
        group: 'Recipient',
      },
    ),

    active: Field.boolean({
      label: 'Active',
      required: false,
      defaultValue: true,
      description: 'Only active rules participate in lifecycle evaluation',
      group: 'Lifecycle',
    }),

    // ── Provenance (#2909 P0 — record-authoritative seed-not-clobber) ──
    // Unified A4 (#2920) tri-state, shared verbatim with sys_position /
    // sys_capability / sys_permission_set. Both columns are `readonly`:
    // the engine strips them from non-system payloads (forge/clear-proof),
    // while the seeder and the provenance stamp hook write with isSystem.
    // NOTE deliberately NOT in SYSTEM_ROW_PROVENANCE (no write gate):
    // sharing rules are a first-class admin authoring/tuning surface —
    // admins may edit or deactivate package rules; the seeder simply stops
    // overwriting rows once `customized` is stamped (ADR-0094 addendum).
    managed_by: Field.select({
      label: 'Managed By',
      required: false,
      readonly: true,
      defaultValue: 'admin',
      description:
        'Record provenance (unified tri-state, A4 #2920): platform = framework built-in / ' +
        'package = app/package-declared (boot-seeded) / admin = tenant-created in Setup.',
      options: [
        { value: 'platform', label: 'Platform' },
        { value: 'package', label: 'Package' },
        { value: 'admin', label: 'Admin' },
      ],
      group: 'System',
    }),

    customized: Field.boolean({
      label: 'Customized',
      required: false,
      readonly: true,
      defaultValue: false,
      description:
        'Set when an admin edits a package-declared rule; boot seeding will no longer ' +
        'overwrite the row (deactivations survive redeploys). Meaningless on admin rows.',
      group: 'System',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      required: false,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['object_name', 'active'] },
    { fields: ['name'], unique: true },
    { fields: ['organization_id'] },
  ],
});
