// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Team Announcement — the canonical PUBLIC-READ object (ADR-0056 OWD).
 *
 * Declares `sharingModel: 'public_read'`: every member can READ every announcement,
 * but only the OWNER may edit or delete it (the engine derives "everyone reads,
 * owner writes" from the OWD baseline + the auto-stamped `owner_id`). No RLS
 * policy is authored. This is the sibling of `showcase_private_note`
 * (`sharingModel: 'private'`, owner-only read): together the two objects
 * demonstrate the OWD read-visibility axis — `private` hides others' rows,
 * `read` shows them but still protects writes.
 */
export const Announcement = ObjectSchema.create({
  name: 'showcase_announcement',
  label: 'Announcement',
  pluralLabel: 'Announcements',
  icon: 'megaphone',
  description: 'A team announcement everyone can read but only its owner can edit — `read` OWD (ADR-0056).',

  // Everyone reads; owner writes. Canonical OWD name (ADR-0056 D1); `read` is
  // the legacy alias. No RLS authored.
  sharingModel: 'public_read',

  fields: {
    title: Field.text({ label: 'Title', required: true, searchable: true, maxLength: 160 }),
    body: Field.text({ label: 'Body', maxLength: 2000 }),
    owner_id: Field.lookup('sys_user', { label: 'Owner' }),
  },
});
