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
  description: 'Declarative sharing rule that auto-materialises sys_record_share grants',
  displayNameField: 'name',
  titleFormat: '{label}',
  compactLayout: ['name', 'object_name', 'recipient_type', 'recipient_id', 'access_level', 'active'],

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
      ['user', 'team', 'department', 'role', 'queue'],
      {
        label: 'Recipient Type',
        required: true,
        defaultValue: 'department',
        description: 'Kind of principal that receives access — expanded to user grants at evaluation time. `department` walks the parent_department_id tree; `team` is flat (better-auth).',
        group: 'Recipient',
      },
    ),

    recipient_id: Field.text({
      label: 'Recipient',
      required: true,
      maxLength: 200,
      description: 'department id / team id / role name / queue name / user id depending on recipient_type',
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
