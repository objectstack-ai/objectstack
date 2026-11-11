// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Personal Note — the canonical OWNER-PRIVATE object (ADR-0056, declarative OWD).
 *
 * It declares `sharingModel: 'private'` and nothing else: no hand-written RLS
 * policy, no owner predicate, no permission-set rule. The engine derives owner
 * scoping from the Org-Wide-Default baseline + the auto-stamped `owner_id` — a
 * user sees and edits only the notes they own.
 *
 * This is the declarative counterpart to the invoice's hand-written
 * `owner = current_user.email` escape-hatch (PR #2054): for plain "my records
 * are mine" ownership, an object declares ONE WORD and the platform enforces it.
 * The corresponding dogfood proof (`showcase-private-owd.dogfood.test.ts`) shows
 * two users each seeing only their own notes through the real HTTP stack.
 */
export const PrivateNote = ObjectSchema.create({
  name: 'showcase_private_note',
  label: 'Personal Note',
  pluralLabel: 'Personal Notes',
  icon: 'lock',
  description: 'A private journal entry visible only to its owner — declarative `private` OWD (ADR-0056).',

  // The entire access policy: owner-private. No RLS authored anywhere.
  sharingModel: 'private',

  fields: {
    title: Field.text({ label: 'Title', required: true, searchable: true, maxLength: 160, group: 'note' }),
    body: Field.text({ label: 'Body', maxLength: 2000, group: 'note' }),
    pinned: Field.boolean({ label: 'Pinned', defaultValue: false, group: 'note' }),
    // Owner anchor — auto-stamped to the creating user on insert; the `private`
    // OWD reads it to scope visibility. Authors declare the field; the engine
    // fills it (no manual assignment, no predicate).
    owner_id: Field.lookup('sys_user', { label: 'Owner', group: 'note' }),
  },

  // ADR-0085 §5: the form, detail and drawer layout is derived from these
  // groups, so each field is placed in a named section rather than left to the
  // untitled fallback, which the field-no-consumers rule credits to no one (#32168).
  fieldGroups: [
    { key: 'note', label: 'Note' },
  ],
});
