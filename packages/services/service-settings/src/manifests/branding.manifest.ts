// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';

/** Branding — workspace identity (name, logo, theme). */
export const brandingSettingsManifest: SettingsManifest = {
  namespace: 'branding',
  version: 1,
  label: 'Branding',
  icon: 'Palette',
  description: 'Workspace name, logo, and accent colour.',
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  category: 'Workspace',
  order: 5,
  specifiers: [
    { type: 'group', id: 'identity', label: 'Identity', required: false },
    { type: 'text', key: 'workspace_name', label: 'Workspace name', required: true,
      default: 'ObjectStack', minLength: 1, maxLength: 60 },
    { type: 'email', key: 'support_email', label: 'Support email', required: false,
      description: 'Example: support@example.com' },

    { type: 'group', id: 'appearance', label: 'Appearance', required: false },
    { type: 'select', key: 'theme_mode', label: 'Default theme', required: false, default: 'system',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'Match system' },
      ],
    },
    { type: 'color', key: 'accent_color', label: 'Accent colour', required: false, default: '#6366f1' },
    { type: 'url', key: 'logo_url', label: 'Logo URL', required: false,
      description: 'Example: https://…/logo.svg' },
  ],
};
