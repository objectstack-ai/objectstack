// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_approval_approver — Pending-approver index (issue #1745).
 *
 * One row per (request, approver identity) while the request is **pending**.
 * `sys_approval_request.pending_approvers` stays the human-readable source of
 * truth (a CSV column), but CSV substring matching can neither be indexed nor
 * pushed into an engine query — which made "my pending" a post-filter in
 * memory and broke pagination beyond the scan window.
 *
 * This table is that CSV, normalized: the service mirrors every change to
 * `pending_approvers` here (open / decide / recall / send-back / reassign /
 * escalate), and clears the rows when the request leaves `pending`. So the
 * table only ever holds the live work queue — its size tracks the number of
 * open approvals, not the append-only request history.
 *
 * `approver` holds one identity literal exactly as it appears in the CSV:
 * a user id, an email, or a `role:<name>` / `team:<name>` style literal.
 * Equality (or `$in`) on this column is the indexed replacement for the old
 * per-row substring match.
 *
 * @namespace sys
 */
export const SysApprovalApprover = ObjectSchema.create({
  name: 'sys_approval_approver',
  label: 'Approval Approver',
  pluralLabel: 'Approval Approvers',
  icon: 'users',
  isSystem: true,
  managedBy: 'system',
  description: 'Normalized pending-approver rows for indexed inbox queries',
  displayNameField: 'id',
  titleFormat: '{approver} · {request_id}',
  compactLayout: ['request_id', 'approver', 'created_at'],

  fields: {
    id: Field.text({ label: 'Row ID', required: true, readonly: true, group: 'System' }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
      description: 'Tenant that owns this row (mirrors the parent request)',
    }),

    request_id: Field.lookup('sys_approval_request', {
      label: 'Request',
      required: true,
      group: 'Target',
    }),

    approver: Field.text({
      label: 'Approver',
      required: true,
      maxLength: 255,
      description: 'One pending-approver identity: user id, email, or role:/team: literal',
      group: 'Target',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    // "My pending" inbox: equality on the identity literal, scoped by tenant.
    { fields: ['approver', 'organization_id'] },
    // Sync path: rewrite all rows of one request on each approver-set change.
    { fields: ['request_id'] },
  ],
});
