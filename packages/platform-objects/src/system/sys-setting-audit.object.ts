// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_setting_audit — Append-only audit trail for every settings mutation.
 *
 * Phase 3 of the settings roadmap. Each call to `SettingsService.set()`
 * (and any other mutation hook) writes a row here BEFORE returning to
 * the caller. The row records who, when, where (scope), and what
 * changed — but never the plaintext value of an encrypted field; only
 * a content digest is stored so an operator can verify "this is the
 * same value as last week" without exposing the secret.
 *
 * Why separate from `sys_audit_log`:
 *  - The generic audit log is a high-traffic firehose (every CRUD
 *    on every business object). Settings rows are low-traffic and
 *    operationally critical, so they deserve dedicated retention and
 *    indexing.
 *  - The schema here carries settings-specific fields (`scope`,
 *    `cascade_source`) that don't make sense on a generic row.
 *
 * Append-only contract: enforced at the application layer (the only
 * writer is SettingsService). Operators MUST NOT delete rows; instead
 * use lifecycle policies to archive cold rows to a separate bucket.
 *
 * @namespace sys
 */
export const SysSettingAudit = ObjectSchema.create({
  name: 'sys_setting_audit',
  label: 'Setting Audit Entry',
  pluralLabel: 'Setting Audit',
  icon: 'history',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Append-only audit trail for SettingsService mutations.',
  highlightFields: ['namespace', 'key', 'scope', 'action', 'actor_id', 'created_at'],
  listViews: {
    recent: {
      type: 'grid',
      name: 'recent',
      label: 'Recent',
      columns: ['created_at', 'namespace', 'key', 'scope', 'action', 'actor_id', 'source'],
      sort: [{ field: 'created_at', order: 'desc' }],
    },
  },

  fields: {
    id: Field.text({
      label: 'ID',
      readonly: true,
    }),

    created_at: Field.datetime({
      label: 'Created At',
      readonly: true,
      description: 'When the mutation was recorded.',
    }),

    namespace: Field.text({
      label: 'Namespace',
      required: true,
      maxLength: 128,
    }),

    key: Field.text({
      label: 'Key',
      required: true,
      maxLength: 128,
    }),

    scope: Field.select(
      [
        { label: 'Global', value: 'global' },
        { label: 'Tenant', value: 'tenant' },
        { label: 'User',   value: 'user' },
      ],
      {
        label: 'Scope',
        required: true,
        description: 'Cascade layer the row was written to.',
      },
    ),

    action: Field.select(
      [
        { label: 'Set',     value: 'set' },
        { label: 'Reset',   value: 'reset' },
        { label: 'Lock',    value: 'lock' },
        { label: 'Unlock',  value: 'unlock' },
        { label: 'Rotate',  value: 'rotate' },
      ],
      {
        label: 'Action',
        required: true,
        description: 'Mutation kind.',
      },
    ),

    actor_id: Field.lookup('sys_user', {
      label: 'Actor',
      description: 'User who performed the mutation; null for system jobs.',
    }),

    /**
     * Where the write originated. Lets operators distinguish admin UI
     * activity from migration jobs and bulk imports during incident
     * analysis.
     */
    source: Field.select(
      [
        { label: 'UI',         value: 'ui' },
        { label: 'API',        value: 'api' },
        { label: 'Migration',  value: 'migration' },
        { label: 'Import',     value: 'import' },
        { label: 'System',     value: 'system' },
      ],
      {
        label: 'Source',
        required: true,
        defaultValue: 'api',
        description: 'Mutation entry-point.',
      },
    ),

    /** Optional free-text reason (Phase 3+ change-management hook). */
    reason: Field.text({
      label: 'Reason',
      description: 'Free-text justification provided by the actor (optional).',
    }),

    /**
     * Content digest of the previous value. Never the plaintext —
     * lets operators detect duplicate writes without leaking secrets.
     * Format: hex SHA-256 of the canonicalised JSON, or null when
     * the previous value was unset.
     */
    old_hash: Field.text({
      label: 'Old Hash',
      readonly: true,
      maxLength: 128,
      description: 'SHA-256 of the previous value (canonicalised). Null when previously unset.',
    }),

    /** Content digest of the new value. Null on `reset`. */
    new_hash: Field.text({
      label: 'New Hash',
      readonly: true,
      maxLength: 128,
      description: 'SHA-256 of the new value (canonicalised). Null on reset.',
    }),

    /** True when the field is encrypted — flags secret rotation events. */
    encrypted: Field.boolean({
      label: 'Encrypted',
      defaultValue: false,
      description: 'True when the field carries secret material (rotation is interesting).',
    }),

    /** Request id from the originating HTTP/CLI invocation. */
    request_id: Field.text({
      label: 'Request ID',
      maxLength: 128,
      description: 'Correlates with sys_audit_log / tracing.',
    }),
  },

  indexes: [
    // Most common query: "what changed for namespace X in the last 7 days?"
    { fields: ['namespace', 'created_at'], unique: false },
    // Per-actor lookup for compliance reviews.
    { fields: ['actor_id', 'created_at'], unique: false },
  ],

  enable: {
    trackHistory: false,
    // [ADR-0103] Engine-owned: appended by the settings service (SYSTEM_CTX),
    // never via the generic data API. Reads stay open for compliance review.
    apiMethods: ['get', 'list'],
  },
});
