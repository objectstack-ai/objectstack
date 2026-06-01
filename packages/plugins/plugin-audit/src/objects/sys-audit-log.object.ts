// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_audit_log — System Audit Log Object
 *
 * Immutable audit trail for all significant platform events.
 * Records who did what, when, and the before/after state.
 *
 * Every field is `readonly: true` — audit logs are written only by
 * internal system hooks, never via UI forms. API exposes only `get` + `list`.
 *
 * @namespace sys
 */
export const SysAuditLog = ObjectSchema.create({
  name: 'sys_audit_log',
  label: 'Audit Log',
  pluralLabel: 'Audit Logs',
  icon: 'scroll-text',
  isSystem: true,
  managedBy: 'append-only',
  description: 'Immutable audit trail for platform events',
  displayNameField: 'action',
  titleFormat: '{action} · {object_name}',
  compactLayout: ['created_at', 'action', 'object_name', 'record_id', 'user_id'],

  listViews: {
    recent: {
      type: 'grid',
      name: 'recent',
      label: 'Recent',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'action', 'object_name', 'record_id', 'user_id'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
      emptyState: { title: 'No audit events', message: 'Activity will appear here as users interact with the platform.' },
    },
    writes_only: {
      type: 'grid',
      name: 'writes_only',
      label: 'Writes',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'action', 'object_name', 'record_id', 'user_id'],
      filter: [{ field: 'action', operator: 'in', value: ['create', 'update', 'delete', 'restore'] }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    auth_events: {
      type: 'grid',
      name: 'auth_events',
      label: 'Auth',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'action', 'user_id'],
      filter: [{ field: 'action', operator: 'in', value: ['login', 'logout', 'permission_change'] }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    config_changes: {
      type: 'grid',
      name: 'config_changes',
      label: 'Config',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'action', 'object_name', 'user_id'],
      filter: [{ field: 'action', operator: 'in', value: ['config_change', 'export', 'import'] }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    all_events: {
      type: 'grid',
      name: 'all_events',
      label: 'All',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'action', 'object_name', 'record_id', 'user_id'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    // ── Event ────────────────────────────────────────────────────
    created_at: Field.datetime({
      label: 'Timestamp',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'Event',
    }),

    action: Field.select(
      ['create', 'update', 'delete', 'restore', 'login', 'logout', 'permission_change', 'config_change', 'export', 'import'],
      {
        label: 'Action',
        required: true,
        readonly: true,
        searchable: true,
        description: 'Action type (snake_case)',
        group: 'Event',
      },
    ),

    user_id: Field.lookup('sys_user', {
      label: 'Actor',
      required: false,
      readonly: true,
      searchable: true,
      description: 'User who performed the action (null for system actions)',
      group: 'Event',
    }),

    // ── Target record ────────────────────────────────────────────
    object_name: Field.text({
      label: 'Object',
      required: false,
      readonly: true,
      searchable: true,
      maxLength: 255,
      description: 'Target object (e.g. sys_user, project_task)',
      group: 'Target',
    }),

    record_id: Field.text({
      label: 'Record ID',
      required: false,
      readonly: true,
      searchable: true,
      description: 'ID of the affected record',
      group: 'Target',
    }),

    // ── Change payload ───────────────────────────────────────────
    old_value: Field.textarea({
      label: 'Old Value',
      required: false,
      readonly: true,
      description: 'JSON-serialized previous state',
      group: 'Changes',
    }),

    new_value: Field.textarea({
      label: 'New Value',
      required: false,
      readonly: true,
      description: 'JSON-serialized new state',
      group: 'Changes',
    }),

    // ── Client fingerprint ───────────────────────────────────────
    ip_address: Field.text({
      label: 'IP Address',
      required: false,
      readonly: true,
      maxLength: 45,
      group: 'Client',
    }),

    user_agent: Field.textarea({
      label: 'User Agent',
      required: false,
      readonly: true,
      group: 'Client',
    }),

    // ── Context ──────────────────────────────────────────────────
    tenant_id: Field.lookup('sys_organization', {
      label: 'Tenant',
      required: false,
      readonly: true,
      description: 'Tenant context for multi-tenant isolation',
      group: 'Context',
    }),

    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      readonly: true,
      description: 'JSON-serialized additional context',
      group: 'Context',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Audit Log ID',
      required: true,
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['created_at'] },
    { fields: ['user_id'] },
    { fields: ['object_name', 'record_id'] },
    { fields: ['action'] },
    { fields: ['tenant_id'] },
  ],

  enable: {
    trackHistory: false, // Audit logs are themselves the audit trail
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list'], // Read-only — creation happens via internal system hooks only
    trash: false, // Never soft-delete audit logs
    mru: false,
    clone: false,
  },
});
