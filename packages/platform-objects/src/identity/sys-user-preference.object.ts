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
  managedBy: 'platform',
  description: 'Per-user key-value preferences (theme, locale, etc.)',
  titleFormat: '{key}',
  compactLayout: ['user_id', 'key'],

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
    { fields: ['user_id', 'key'], unique: true },
    { fields: ['user_id'], unique: false },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: false,
    mru: false,
  },
});
