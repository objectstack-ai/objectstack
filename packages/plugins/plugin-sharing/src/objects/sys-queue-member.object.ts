// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_queue_member — one member specification of an organization's queue
 * (ADR-0142 D1/D2).
 *
 * A row names a set of people the way a sharing rule's recipient does — a
 * user, a team, a position, one business unit, or a unit and every unit below
 * it — and the ownership-queue service expands the union of a queue's rows,
 * de-duplicated and ordered by user id, in the queue's organization. The
 * members of a DECLARED queue are positions only, named in its declaration; an
 * organization adds users, teams and units to a declared queue here too, under
 * the declared queue's name.
 *
 * `field` and `queue` are not member kinds: a field names people per record,
 * and a queue does not contain queues.
 *
 * @namespace sys
 */
export const SysQueueMember = ObjectSchema.create({
  name: 'sys_queue_member',
  label: 'Queue Member',
  pluralLabel: 'Queue Members',
  icon: 'users',
  isSystem: true,
  managedBy: 'config',
  description: 'Who belongs to a queue: a user, a team, a position or a business unit.',
  displayNameField: 'queue',
  nameField: 'queue',
  titleFormat: '{queue}',
  highlightFields: ['queue', 'recipient_type', 'recipient_id'],

  listViews: {
    by_queue: {
      type: 'grid',
      name: 'by_queue',
      label: 'By Queue',
      data: { provider: 'object', object: 'sys_queue_member' },
      columns: ['queue', 'recipient_type', 'recipient_id', 'updated_at'],
      sort: [{ field: 'queue', order: 'asc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    queue: Field.text({
      label: 'Queue',
      required: true,
      maxLength: 100,
      description: 'The name of the queue this member belongs to.',
      group: 'Queue',
    }),

    recipient_type: Field.select({
      options: [
        { value: 'user', label: 'User' },
        { value: 'team', label: 'Team' },
        { value: 'position', label: 'Position' },
        { value: 'business_unit', label: 'Business unit' },
        { value: 'unit_and_subordinates', label: 'Business unit and subordinates' },
      ],
      label: 'Member Type',
      required: true,
      defaultValue: 'position',
      description:
        'What kind of member this is. A team, position or business unit makes everyone in it a member. ' +
        '"Business unit and subordinates" also covers every unit below the one you pick.',
      group: 'Member',
    }),

    recipient_id: Field.text({
      label: 'Member',
      required: true,
      maxLength: 200,
      widget: 'recipient-picker',
      dependsOn: ['recipient_type'],
      description: 'The specific user, team, position or business unit.',
      group: 'Member',
    }),
  },

  indexes: [
    { fields: ['queue'] },
    { fields: ['recipient_type', 'recipient_id'] },
    { fields: ['queue', 'recipient_type', 'recipient_id'], unique: 'organization' },
  ],
});
