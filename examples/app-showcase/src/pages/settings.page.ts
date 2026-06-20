// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * Settings — every enterprise app needs one. A record page over the singleton
 * showcase_preference record; record:details is inline-editable (click a value
 * to change it), so this is a working preferences surface grouped into
 * Appearance / Notifications sections.
 */
export const SettingsPage: Page = {
  name: 'showcase_settings',
  label: 'Setting',
  type: 'record',
  object: 'showcase_preference',
  kind: 'full',
  template: 'default',
  isDefault: true,
  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        {
          type: 'record:details',
          properties: {
            sections: [
              { label: 'Appearance', columns: 2, fields: ['theme', 'compact_density', 'default_landing', 'items_per_page'] },
              { label: 'Notifications', columns: 2, fields: ['notifications_enabled', 'email_digest'] },
            ],
          },
        },
      ],
    },
  ],
};
