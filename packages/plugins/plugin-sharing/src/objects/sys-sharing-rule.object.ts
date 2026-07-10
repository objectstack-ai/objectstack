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
      description: 'Short object name (e.g. opportunity, account)',
      group: 'Target',
    }),

    criteria_json: Field.textarea({
      label: 'Criteria (FilterCondition JSON)',
      required: false,
      description: 'JSON FilterCondition matched against records of object_name. Empty = match all.',
      group: 'Target',
    }),

    recipient_type: Field.select(
      ['user', 'team', 'business_unit', 'position', 'unit_and_subordinates', 'queue'],
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
      description: 'business-unit id / team id / position name / queue name / user id depending on recipient_type',
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
