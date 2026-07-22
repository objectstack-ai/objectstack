// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_api_key — System API Key Object
 *
 * API keys for programmatic/machine access to the platform.
 *
 * Field `key` stores a hashed value and is marked hidden so it never
 * leaks into default list/form rendering; the raw token is only
 * returned once on creation via the auth plugin API.
 *
 * @namespace sys
 */
export const SysApiKey = ObjectSchema.create({
  name: 'sys_api_key',
  label: 'API Key',
  pluralLabel: 'API Keys',
  icon: 'key-round',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'API keys for programmatic access',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{name}',
  highlightFields: ['name', 'prefix', 'user_id', 'expires_at', 'revoked'],

  // Custom actions — sys_api_key is managed-by 'better-auth' but the
  // `revoked` boolean is a column we control via the data API. These row
  // actions use the generic PATCH /api/v1/sys_api_key/{id} endpoint with
  // `bodyExtra` to set the `revoked` flag explicitly.
  actions: [
    {
      name: 'revoke_api_key',
      label: 'Revoke API Key',
      icon: 'shield-off',
      variant: 'danger',
      mode: 'custom',
      locations: ['list_item'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_api_key/{id}',
      bodyExtra: { revoked: true },
      confirmText: 'Revoke this API key? Any clients using it will immediately lose access.',
      successMessage: 'API key revoked',
      refreshAfter: true,
    },
    {
      name: 'restore_api_key',
      label: 'Restore API Key',
      icon: 'shield-check',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_api_key/{id}',
      bodyExtra: { revoked: false },
      confirmText: 'Restore this revoked API key? Existing clients holding the key will regain access.',
      successMessage: 'API key restored',
      refreshAfter: true,
    },
  ],

  listViews: {
    mine: {
      type: 'grid',
      name: 'mine',
      label: 'My Keys',
      data: { provider: 'object', object: 'sys_api_key' },
      columns: ['name', 'prefix', 'expires_at', 'last_used_at', 'revoked'],
      filter: [
        { field: 'user_id', operator: 'equals', value: '{current_user_id}' },
      ],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_api_key' },
      columns: ['name', 'prefix', 'user_id', 'expires_at', 'last_used_at'],
      filter: [{ field: 'revoked', operator: 'equals', value: false }],
      sort: [{ field: 'last_used_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    revoked: {
      type: 'grid',
      name: 'revoked',
      label: 'Revoked',
      data: { provider: 'object', object: 'sys_api_key' },
      columns: ['name', 'prefix', 'user_id', 'expires_at', 'updated_at'],
      filter: [{ field: 'revoked', operator: 'equals', value: true }],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    all_keys: {
      type: 'grid',
      name: 'all_keys',
      label: 'All',
      data: { provider: 'object', object: 'sys_api_key' },
      columns: ['name', 'prefix', 'user_id', 'expires_at', 'last_used_at', 'revoked'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    // ── Identity ─────────────────────────────────────────────────
    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 255,
      description: 'Human-readable label for the API key',
      group: 'Identity',
    }),

    prefix: Field.text({
      label: 'Prefix',
      required: false,
      maxLength: 16,
      description: 'Visible prefix for identifying the key (e.g., "osk_")',
      group: 'Identity',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'Owner',
      required: true,
      description: 'User who owns this API key',
      group: 'Identity',
    }),

    // ── Access ───────────────────────────────────────────────────
    scopes: Field.textarea({
      label: 'Scopes',
      required: false,
      description: 'JSON array of permission scopes',
      group: 'Access',
    }),

    // ── Lifecycle ────────────────────────────────────────────────
    expires_at: Field.datetime({
      label: 'Expires At',
      required: false,
      group: 'Lifecycle',
    }),

    last_used_at: Field.datetime({
      label: 'Last Used At',
      required: false,
      readonly: true,
      description: 'Automatically updated on each API call',
      group: 'Lifecycle',
    }),

    revoked: Field.boolean({
      label: 'Revoked',
      defaultValue: false,
      group: 'Lifecycle',
    }),

    // ── Secret (hidden by default) ──────────────────────────────
    key: Field.text({
      label: 'Hashed Key',
      required: true,
      hidden: true,
      readonly: true,
      description: 'Hashed API key value — never exposed to clients',
      group: 'Secret',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'API Key ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['key'], unique: true },
    { fields: ['user_id'] },
    { fields: ['prefix'] },
    { fields: ['revoked'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // #1591 — reads only: writes are refused by the identity write guard
    // (ADR-0092 D2) and owned by better-auth. HTTP answers 405 before the 403.
    apiMethods: ['get', 'list'],
  },
});
