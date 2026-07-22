// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_presence — System Presence Object
 *
 * Tracks real-time user presence and activity across the platform.
 * Fields align with the PresenceStateSchema protocol definition
 * from `@objectstack/spec/api` (websocket.zod.ts).
 *
 * Owned by `service-realtime` as the canonical Presence domain object.
 *
 * @namespace sys
 * @see PresenceStateSchema in packages/spec/src/api/websocket.zod.ts
 */
export const SysPresence = ObjectSchema.create({
  name: 'sys_presence',
  label: 'Presence',
  pluralLabel: 'Presences',
  icon: 'wifi',
  isSystem: true,
  managedBy: 'append-only',
  description: 'Real-time user presence and activity tracking',
  titleFormat: '{user_id} ({status})',
  highlightFields: ['user_id', 'status', 'last_seen'],

  fields: {
    id: Field.text({
      label: 'Presence ID',
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
      searchable: true,
    }),

    session_id: Field.lookup('sys_session', {
      label: 'Session',
      required: true,
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      defaultValue: 'online',
      options: [
        { value: 'online', label: 'Online' },
        { value: 'away', label: 'Away' },
        { value: 'busy', label: 'Busy' },
        { value: 'offline', label: 'Offline' },
      ],
    }),

    last_seen: Field.datetime({
      label: 'Last Seen',
      required: true,
      defaultValue: 'NOW()',
    }),

    current_location: Field.text({
      label: 'Current Location',
      required: false,
      maxLength: 500,
    }),

    device: Field.select({
      label: 'Device',
      required: false,
      options: [
        { value: 'desktop', label: 'Desktop' },
        { value: 'mobile', label: 'Mobile' },
        { value: 'tablet', label: 'Tablet' },
        { value: 'other', label: 'Other' },
      ],
    }),

    custom_status: Field.text({
      label: 'Custom Status',
      required: false,
      maxLength: 255,
    }),

    metadata: Field.json({
      label: 'Metadata',
      required: false,
      description: 'Arbitrary JSON metadata associated with the presence state (matches PresenceStateSchema.metadata).',
    }),
  },

  indexes: [
    { fields: ['user_id'], unique: false },
    { fields: ['session_id'], unique: true },
    { fields: ['status'], unique: false },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // #3220 — sys_presence is `managedBy: 'append-only'` and is written only
    // over the realtime (websocket/in-memory) path, never through ObjectQL.
    // Advertising create/update/delete here (and update/delete on an
    // append-only object at that) was a latent hole: it left the generic
    // /data route open for a user-context write the bucket forbids. Reads
    // stay open for diagnostic list views.
    apiMethods: ['get', 'list'],
  },
});
