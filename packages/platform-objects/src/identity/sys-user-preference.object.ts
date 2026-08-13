// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_user_preference — System User Preference Object
 *
 * Per-user key-value preferences for storing UI state, settings, and personalization.
 * Supports the User Preferences layer in the Config Resolution hierarchy
 * (Runtime > User Preferences > Tenant > Env).
 *
 * Common use cases:
 * - UI preferences: theme, locale, timezone, sidebar state
 * - Feature flags: plugin.ai.auto_save, plugin.dev.debug_mode
 * - User-specific settings: default_view, notifications_enabled
 *
 * @namespace sys
 */
export const SysUserPreference = ObjectSchema.create({
  name: 'sys_user_preference',
  label: 'User Preference',
  pluralLabel: 'User Preferences',
  icon: 'settings',
  isSystem: true,
  // [ADR-0103, #3355] Admin/user-writable DATA on a platform-defined schema:
  // preferences are per-user state authored from the user's own settings page
  // (RLS self-grant), never created by an admin — the list surface in Setup is a
  // support/diagnostic view only. The bucket default is full CRUD, so no
  // `userActions` block is needed; RLS remains the authz.
  managedBy: 'system-data',
  description: 'Per-user key-value preferences (theme, locale, etc.)',
  nameField: 'key', // [ADR-0079] canonical primary-title pointer (single-field titleFormat)
  titleFormat: '{key}',
  highlightFields: ['user_id', 'key'],

  listViews: {
    mine: {
      type: 'grid',
      name: 'mine',
      label: 'My Preferences',
      data: { provider: 'object', object: 'sys_user_preference' },
      columns: ['key', 'updated_at'],
      filter: [{ field: 'user_id', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'key', order: 'asc' }],
      pagination: { pageSize: 100 },
    },
    by_user: {
      type: 'grid',
      name: 'by_user',
      label: 'By User',
      data: { provider: 'object', object: 'sys_user_preference' },
      columns: ['user_id', 'key', 'updated_at'],
      sort: [{ field: 'user_id', order: 'asc' }, { field: 'key', order: 'asc' }],
      grouping: { fields: [{ field: 'user_id', order: 'asc', collapsed: true }] },
      pagination: { pageSize: 200 },
    },
    all_preferences: {
      type: 'grid',
      name: 'all_preferences',
      label: 'All',
      data: { provider: 'object', object: 'sys_user_preference' },
      columns: ['user_id', 'key', 'created_at', 'updated_at'],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    id: Field.text({
      label: 'Preference ID',
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

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      description: 'Owner user of this preference',
    }),

    key: Field.text({
      label: 'Key',
      required: true,
      maxLength: 255,
      description: 'Preference key (e.g., theme, locale, plugin.ai.auto_save)',
    }),

    value: Field.json({
      label: 'Value',
      description: 'Preference value (any JSON-serializable type)',
    }),
  },

  indexes: [
    // [ADR-0120 D1, #8323] `'organization'`, NOT bare `true`.
    //
    // A preference belongs to a (user, organization) pair, not to a user
    // globally: the same person in two organizations keeps two independent
    // `ui.recent` rows. Bare `true` on a DECLARED index is the positional
    // spelling of `'global'` — the listed columns verbatim (see
    // `normalizeDeclaredIndex`, which prepends the organization key part only
    // for the explicit spelling). It is NOT the field-level `true`, which has
    // meant per-organization since #3696; that divergence is "the #4986 trap"
    // named in `packages/lint/src/data-model-rules.ts`, and this declaration
    // was one of its two instances in the platform's own objects.
    //
    // Measured consequence of the bare spelling: a user belonging to two
    // organizations could never persist a key they already used in the first
    // one — the write was refused by an index whose colliding row they cannot
    // read, and `data-objectstack`'s `userState.save()` swallows the failure by
    // design, so the preference silently stopped persisting.
    { fields: ['user_id', 'key'], unique: 'organization' },
    { fields: ['user_id'], unique: false },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // No `apiMethods` — default-open (#3543 audit): the previous whitelist
    // named all six primitives, which is equivalent to no whitelist while NOT
    // tracking future primitives.
  },
});
