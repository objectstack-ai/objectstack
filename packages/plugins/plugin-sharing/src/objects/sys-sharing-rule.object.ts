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
  description: 'Grants a group of people access to the records that match a condition.',
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
      // Field `description`s on this object are ADMIN-FACING help text rendered
      // under each input in Setup — not notes for the next engineer. They must
      // not name tables, columns, enum values, ADRs or third-party libraries:
      // the reader is a tenant admin who sees only the labels in the dropdown
      // (objectstack#3821). Implementation detail belongs in the doc comments
      // above, where it already is.
      description: 'Identifies the rule. Lowercase letters, digits and underscores only.',
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
      description: 'The object whose records this rule shares.',
      group: 'Target',
    }),

    criteria_json: Field.textarea({
      label: 'Criteria',
      required: false,
      // Rendered as a visual criteria builder scoped to the selected object's
      // fields (dependsOn: object_name), storing the same JSON FilterCondition.
      // An "Edit as JSON" fallback keeps hand-authored / advanced filters
      // editable. Falls back to a textarea when the widget is unavailable.
      widget: 'filter-condition',
      dependsOn: ['object_name'],
      description: 'Which records to share. Leave empty to share every record of the object.',
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
        // The engine detail this used to spell out (which tree is walked, which
        // expansion is flat, the ADRs behind each) lives in the class doc above.
        description: 'Who receives access. Picking a team, business unit or position gives access to everyone in it. "Business unit and subordinates" also covers every unit below the one you pick.',
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
      description: 'The specific user, team, business unit or position that receives access.',
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
      description: 'Turn off to withdraw the access this rule granted, without deleting the rule.',
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
        'Where this rule came from: built into the platform, installed with an app, or created here in Setup.',
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
        'Set once you edit a rule that came with an app, so your changes are kept when the app is updated.',
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
