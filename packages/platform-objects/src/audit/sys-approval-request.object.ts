// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_approval_request — Live approval instance.
 *
 * Created when a user invokes `IApprovalService.submit(...)` and
 * advanced as approvers act on each step. The row's lifecycle:
 *
 *   `pending` → (per-step approvals) → `approved` | `rejected`
 *   `pending` → recalled by submitter → `recalled`
 *
 * `current_step` / `current_step_index` mirror the index into the
 * process's `steps[]` array so the engine can resume after a restart
 * without re-deriving state from the audit log.
 *
 * `payload_json` captures a snapshot of the target record at submission
 * time — used by the email/feed actions so they can render before the
 * record is locked or changed.
 *
 * @namespace sys
 */
export const SysApprovalRequest = ObjectSchema.create({
  name: 'sys_approval_request',
  label: 'Approval Request',
  pluralLabel: 'Approval Requests',
  icon: 'inbox',
  isSystem: true,
  managedBy: 'system',
  description: 'Live approval instance tracked per submission',
  displayNameField: 'id',
  titleFormat: '{process_name} · {record_id}',
  compactLayout: ['process_name', 'object_name', 'record_id', 'status', 'current_step', 'submitter_id', 'updated_at'],

  fields: {
    id: Field.text({ label: 'Request ID', required: true, readonly: true, group: 'System' }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
      description: 'Tenant that owns this approval request (propagated from submitter context)',
    }),

    process_name: Field.text({
      label: 'Process',
      required: true,
      maxLength: 100,
      description: 'sys_approval_process.name this request was opened against',
      group: 'Target',
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 100,
      group: 'Target',
    }),

    record_id: Field.text({
      label: 'Record ID',
      required: true,
      maxLength: 100,
      group: 'Target',
    }),

    submitter_id: Field.lookup('sys_user', {
      label: 'Submitter',
      required: false,
      group: 'Target',
    }),

    submitter_comment: Field.textarea({
      label: 'Submitter Comment',
      required: false,
      group: 'Target',
    }),

    status: Field.select(
      ['pending', 'approved', 'rejected', 'recalled'],
      {
        label: 'Status',
        required: true,
        defaultValue: 'pending',
        description: 'Lifecycle state of the request',
        group: 'State',
      },
    ),

    current_step: Field.text({
      label: 'Current Step',
      required: false,
      maxLength: 100,
      description: 'Machine name of the step awaiting approval',
      group: 'State',
    }),

    current_step_index: Field.number({
      label: 'Current Step Index',
      required: false,
      defaultValue: 0,
      group: 'State',
    }),

    pending_approvers: Field.textarea({
      label: 'Pending Approvers',
      required: false,
      description: 'Comma-separated user ids who can act on the current step',
      group: 'State',
    }),

    payload_json: Field.textarea({
      label: 'Snapshot',
      required: false,
      description: 'Record snapshot at submission time',
      group: 'State',
    }),

    completed_at: Field.datetime({
      label: 'Completed At',
      required: false,
      group: 'State',
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
    // Look up "is there a pending request for this record?" — common
    // guard on submit and on edit-while-locked checks.
    { fields: ['object_name', 'record_id'] },
    { fields: ['status', 'object_name'] },
    // "My approvals" inbox — pending_approvers is a CSV string so this
    // index only helps with status pre-filtering; the engine does a
    // post-filter substring match per row.
    { fields: ['status', 'updated_at'] },
    { fields: ['submitter_id', 'status'] },
  ],
});
