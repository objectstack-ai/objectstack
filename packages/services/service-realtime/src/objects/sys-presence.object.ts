// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { F } from '@objectstack/spec';

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
  // [ADR-0079] The record title is `display_title`, a text formula over the
  // same two columns `titleFormat` names. With no pointer declared, the
  // registry's designate-only pass stamped `nameField: 'id'` (the first
  // title-eligible field), so a renderer honouring ADR-0079's order (an
  // explicit `nameField` wins over `titleFormat`) drew the raw id as the record
  // page's H1. `titleFormat` stays for renderers that still read it first;
  // `sys-presence-display-title.test.ts` pins the pointer and the formula's
  // inputs.
  displayNameField: 'display_title',
  nameField: 'display_title', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{user_id} ({status})',
  highlightFields: ['user_id', 'status', 'last_seen'],

  fields: {
    id: Field.text({
      label: 'Presence ID',
      required: true,
      readonly: true,
    }),

    // [ADR-0079] The record title (`nameField` above). A formula is computed on
    // read and has no stored column. It reads only this row's own columns —
    // the user foreign key and the status token, never a field of the user
    // record. Both are required, so the expression needs no null guard.
    display_title: Field.formula({
      label: 'Title',
      returnType: 'text',
      expression: F`record.user_id + ' (' + record.status + ')'`,
      description: 'Record title: the user and their presence status (computed on read)',
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
