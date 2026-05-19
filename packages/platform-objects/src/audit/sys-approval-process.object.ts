// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_approval_process — Approval Process Definition (runtime row).
 *
 * Persists an {@link ApprovalProcess} configuration so administrators
 * can author and version approval flows from the UI without code
 * changes. The Zod schema for the JSON envelope lives at
 * `@objectstack/spec/automation/approval` — this row simply stores
 * a serialised copy alongside the lookup metadata the engine needs to
 * route incoming submissions.
 *
 * One row per `name`. The dispatcher (the `approvals` service) finds
 * the active process for an `(object_name, recordId)` pair by querying
 * `active=true` rows where `object_name` matches.
 *
 * @namespace sys
 */
export const SysApprovalProcess = ObjectSchema.create({
  name: 'sys_approval_process',
  label: 'Approval Process',
  pluralLabel: 'Approval Processes',
  icon: 'check-square',
  isSystem: true,
  managedBy: 'config',
  description: 'Persisted approval process definition (ApprovalProcess JSON)',
  displayNameField: 'name',
  titleFormat: '{label}',
  compactLayout: ['name', 'object_name', 'active', 'updated_at'],

  fields: {
    id: Field.text({ label: 'Process ID', required: true, readonly: true, group: 'System' }),

    name: Field.text({
      label: 'Name',
      required: true,
      maxLength: 100,
      description: 'Unique snake_case name — referenced by submitters and audit rows',
      group: 'Definition',
    }),

    label: Field.text({
      label: 'Display Label',
      required: true,
      maxLength: 200,
      group: 'Definition',
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 100,
      description: 'Short object name this process governs',
      group: 'Definition',
    }),

    description: Field.textarea({ label: 'Description', required: false, group: 'Definition' }),

    active: Field.boolean({
      label: 'Active',
      required: true,
      defaultValue: false,
      description: 'Only active processes are dispatched on submission',
      group: 'Definition',
    }),

    definition_json: Field.textarea({
      label: 'Definition',
      required: true,
      description: 'Serialised ApprovalProcess JSON (see @objectstack/spec/automation/approval)',
      group: 'Definition',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({ label: 'Updated At', required: false, group: 'System' }),
  },

  indexes: [
    { fields: ['name'], unique: true },
    { fields: ['object_name'] },
    { fields: ['active', 'object_name'] },
  ],
});
