// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_platform_setting_audit — the settings audit trail's GLOBAL rung
 * (ADR-0131 D7, ruling record 6257510973 · Q4 A).
 *
 * The same departure `sys_setting`'s global rung made for `sys_platform_setting`:
 * a write of a global-scope settings key is deployment-level, so its audit row
 * names no organization and lives here, in a table with no organization column.
 * Tenant and user rows stay in `sys_setting_audit`, each stamped with the
 * organization whose value changed.
 *
 * Same row shape as `sys_setting_audit`, so one reader reads either table the
 * same way; `scope` is always `global` here, and never `global` there.
 *
 * ## No organization column, governed by object permission
 *
 * `systemFields: { tenant: false }` — the one writer (`SettingsService`, through
 * the settings audit writer) attributes no row to an organization. With no
 * column there is no tenant wall, so who may read is object permission (D7):
 * the same platform-only capability `sys_platform_setting` requires. A manifest
 * whose keys sit at the global rung already requires it to read or write them
 * through the settings door, so the door, the setting and its trail agree.
 *
 * ## The 18.0 rows
 *
 * An 18.0 install wrote its global-rung audit rows into `sys_setting_audit`,
 * stamped with the Default Organization. The upgrade ceremony moves them here,
 * id for id, before the database is certified (18.x step 5b), and the v18 boot
 * guard refuses a database it has not certified — so the global rung's history
 * is this table alone.
 *
 * Append-only: the settings audit writer is the only writer, and the generic
 * data API offers reads only.
 *
 * @namespace sys
 */
export const SysPlatformSettingAudit = ObjectSchema.create({
  name: 'sys_platform_setting_audit',
  label: 'Platform Setting Audit Entry',
  pluralLabel: 'Platform Setting Audit',
  icon: 'history',
  isSystem: true,
  managedBy: 'engine-owned',
  // [ADR-0131 D7] Deployment-level: NO tenant column, and reads are platform-only.
  systemFields: { tenant: false },
  requiredPermissions: ['manage_platform_settings'],
  description: 'Append-only audit trail for SettingsService mutations of global-scope keys.',
  highlightFields: ['namespace', 'key', 'action', 'actor_id', 'created_at'],
  listViews: {
    recent: {
      type: 'grid',
      name: 'recent',
      label: 'Recent',
      columns: ['created_at', 'namespace', 'key', 'action', 'actor_id', 'source'],
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
      [{ label: 'Global', value: 'global' }],
      {
        label: 'Scope',
        required: true,
        defaultValue: 'global',
        description: 'Cascade layer the row was written to — always the global rung here.',
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

    reason: Field.text({
      label: 'Reason',
      description: 'Free-text justification provided by the actor (optional).',
    }),

    /**
     * Same formats as `sys_setting_audit.old_hash`: `sha256:` + hex SHA-256
     * of the canonical JSON for a non-secret value, the crypto provider's keyed
     * `hmac-sha256:` digest for a secret (never an unkeyed hash). Null when
     * previously unset, and null for a secret when no keyed digest is
     * available. Older rows may carry `fnv32:`; compare only same-prefix values.
     */
    old_hash: Field.text({
      label: 'Old Hash',
      readonly: true,
      maxLength: 128,
      description: 'Digest of the previous value, never the plaintext: sha256: hex for a plain value, the keyed hmac-sha256: digest for a secret. Null when previously unset, or for a secret with no keyed digest.',
    }),

    /** Same formats as `old_hash`. Null on `reset`, and for a secret with no keyed digest. */
    new_hash: Field.text({
      label: 'New Hash',
      readonly: true,
      maxLength: 128,
      description: 'Digest of the new value, never the plaintext: sha256: hex for a plain value, the keyed hmac-sha256: digest for a secret. Null on reset, or for a secret with no keyed digest.',
    }),

    encrypted: Field.boolean({
      label: 'Encrypted',
      defaultValue: false,
      description: 'True when the field carries secret material (rotation is interesting).',
    }),

    request_id: Field.text({
      label: 'Request ID',
      maxLength: 128,
      description: 'Correlates with sys_audit_log / tracing.',
    }),
  },

  indexes: [
    { fields: ['namespace', 'created_at'], unique: false },
    { fields: ['actor_id', 'created_at'], unique: false },
  ],

  enable: {
    trackHistory: false,
    // [ADR-0103] Engine-owned: appended by the settings service (SYSTEM_CTX),
    // never via the generic data API. Reads stay open for compliance review.
    apiMethods: ['get', 'list'],
  },
});
