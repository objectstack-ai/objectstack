// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * App Preference — backs the Settings page. A small "app config" object so the
 * showcase has a real settings surface: a record whose detail page is
 * inline-editable (theme, landing, notifications). One seeded singleton.
 */
export const Preference = ObjectSchema.create({
  name: 'showcase_preference',
  label: 'Setting',
  pluralLabel: 'Settings',
  icon: 'settings',
  description: 'Workspace preferences edited from the Settings page.',
  fields: {
    name: Field.text({ label: 'Name', required: true, searchable: true }),
    theme: Field.select({
      label: 'Theme',
      options: [
        { label: 'Light', value: 'light', default: true },
        { label: 'Dark', value: 'dark' },
        { label: 'Match system', value: 'auto' },
      ],
    }),
    default_landing: Field.select({
      label: 'Default landing page',
      options: [
        { label: 'My Work', value: 'my_work', default: true },
        { label: 'Delivery Operations', value: 'operations' },
        { label: 'Task Board', value: 'task_board' },
      ],
    }),
    email_digest: Field.select({
      label: 'Email digest',
      options: [
        { label: 'Daily', value: 'daily', default: true },
        { label: 'Weekly', value: 'weekly' },
        { label: 'Off', value: 'off' },
      ],
    }),
    items_per_page: Field.number({ label: 'Rows per page', min: 10, max: 200, defaultValue: 50 }),
    notifications_enabled: Field.boolean({ label: 'Enable notifications', defaultValue: true }),
    compact_density: Field.boolean({ label: 'Compact density', defaultValue: false }),
  },
});
