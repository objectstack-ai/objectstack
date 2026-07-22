// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_setting — Generic K/V store backing the SettingsManifest contract
 *
 * Single physical table that holds *every* value for *every* settings
 * namespace declared by a `SettingsManifest`. Plugins MUST NOT define
 * per-namespace tables (e.g. `sys_mail_config`); they declare a manifest
 * and the value persists here.
 *
 * Row identity: (namespace, key, scope, user_id?).
 *
 * Resolution order (handled by `SettingsService.get`):
 *   1. process.env override                    (source='env',     locked=true)
 *   2. sys_setting WHERE scope='global'        (source='global')
 *   3. sys_setting WHERE scope='tenant'        (source='tenant')
 *   4. sys_setting WHERE scope='user'          (source='user')
 *   5. manifest specifier.default              (source='default')
 *
 * Encryption: rows with `encrypted=true` store ciphertext in `value_enc`
 * and leave `value` null. The plain value is never written to audit log
 * or history snapshots — only an `'<encrypted>'` placeholder + a digest.
 *
 * managedBy: 'engine-owned' — the admin grid in Setup is a diagnostic surface
 * only; all writes flow through `SettingsService.set()` so the resolver
 * stays the single source of truth.
 *
 * See ADR-0007 (Settings Manifest + K/V Store + Resolver).
 *
 * @namespace sys
 */
export const SysSetting = ObjectSchema.create({
  name: 'sys_setting',
  label: 'Setting',
  pluralLabel: 'Settings',
  icon: 'sliders',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Generic K/V store backing the SettingsManifest contract.',
  displayNameField: 'key',
  nameField: 'key', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{namespace}.{key}',
  highlightFields: ['namespace', 'key', 'scope', 'updated_at'],

  listViews: {
    by_namespace: {
      type: 'grid',
      name: 'by_namespace',
      label: 'By Namespace',
      data: { provider: 'object', object: 'sys_setting' },
      columns: ['namespace', 'key', 'scope', 'encrypted', 'updated_by', 'updated_at'],
      sort: [{ field: 'namespace', order: 'asc' }, { field: 'key', order: 'asc' }],
      grouping: { fields: [{ field: 'namespace', order: 'asc', collapsed: false }] },
      pagination: { pageSize: 200 },
    },
    tenant_only: {
      type: 'grid',
      name: 'tenant_only',
      label: 'Tenant',
      data: { provider: 'object', object: 'sys_setting' },
      columns: ['namespace', 'key', 'encrypted', 'updated_by', 'updated_at'],
      filter: [{ field: 'scope', operator: 'equals', value: 'tenant' }],
      sort: [{ field: 'namespace', order: 'asc' }, { field: 'key', order: 'asc' }],
      pagination: { pageSize: 200 },
    },
    user_only: {
      type: 'grid',
      name: 'user_only',
      label: 'User',
      data: { provider: 'object', object: 'sys_setting' },
      columns: ['user_id', 'namespace', 'key', 'updated_at'],
      filter: [{ field: 'scope', operator: 'equals', value: 'user' }],
      sort: [{ field: 'user_id', order: 'asc' }, { field: 'namespace', order: 'asc' }],
      pagination: { pageSize: 200 },
    },
    all_settings: {
      type: 'grid',
      name: 'all_settings',
      label: 'All',
      data: { provider: 'object', object: 'sys_setting' },
      columns: ['namespace', 'key', 'scope', 'user_id', 'encrypted', 'updated_at'],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    id: Field.text({
      label: 'Setting ID',
      required: true,
      readonly: true,
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    namespace: Field.text({
      label: 'Namespace',
      required: true,
      maxLength: 64,
      description: 'Manifest namespace (e.g. mail, branding, feature_flags).',
    }),

    key: Field.text({
      label: 'Key',
      required: true,
      maxLength: 128,
      description: 'Specifier key inside the namespace (snake_case).',
    }),

    scope: Field.select(
      [
        { label: 'Global', value: 'global' },
        { label: 'Tenant', value: 'tenant' },
        { label: 'User',   value: 'user' },
        { label: 'Runtime',value: 'runtime' },
      ],
      {
        label: 'Scope',
        required: true,
        defaultValue: 'tenant',
        description: 'Which layer of the config-resolution hierarchy this row belongs to.',
      },
    ),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      description: 'Owning user when scope=user; null otherwise.',
    }),

    value: Field.json({
      label: 'Value',
      description: 'JSON-encoded value. Null when encrypted=true (see value_enc).',
    }),

    encrypted: Field.boolean({
      label: 'Encrypted',
      defaultValue: false,
      description: 'When true, the value is stored encrypted-at-rest in value_enc; value column is null.',
    }),

    locked: Field.boolean({
      label: 'Locked',
      defaultValue: false,
      description:
        'When true, lower-scope rows cannot override this value; writes against lower scopes return 409. ' +
        'Used by platform administrators to pin a global value for all tenants (Phase 2 cascade).',
    }),

    locked_reason: Field.text({
      label: 'Lock Reason',
      description: 'Human-readable explanation surfaced in the UI tooltip when locked=true.',
    }),

    value_enc: Field.text({
      label: 'Encrypted Value',
      readonly: true,
      description: 'Ciphertext payload (KMS-wrapped). Set only when encrypted=true.',
    }),

    updated_by: Field.lookup('sys_user', {
      label: 'Updated By',
      readonly: true,
      description: 'Last actor who wrote this row via SettingsService.set().',
    }),
  },

  indexes: [
    // Primary lookup path: (namespace, key, scope, user_id?) is what
    // SettingsService.get hits on every resolve. The composite UNIQUE
    // covers both the row-identity constraint and the read path.
    { fields: ['namespace', 'key', 'scope', 'user_id'], unique: true },
    // Common range read: full namespace dump for SettingsService.getNamespace.
    { fields: ['namespace', 'scope'], unique: false },
    // Per-user listing on the user-prefs scope.
    { fields: ['user_id', 'namespace'], unique: false },
  ],

  enable: {
    // History on settings is opt-in per namespace (handled at service
    // layer when needed) to avoid bloating sys_history with churn from
    // feature flags and similar high-frequency toggles.
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // Direct data API exposed for the admin grid view, but writes from
    // the UI MUST go through /api/settings/:namespace so the resolver
    // and audit hooks fire. The grid is diagnostic-only.
    apiMethods: ['get', 'list'],
  },
});
