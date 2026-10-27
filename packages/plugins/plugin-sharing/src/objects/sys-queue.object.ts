// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_queue — an organization's own ownership queue (ADR-0142 D1).
 *
 * A queue is a named set of people that records of any `ownership: 'user'`
 * object can sit in: a record SITS IN queue Q while its `owner_id` is empty and
 * its `queue` column names Q, and Q's members read, edit and claim it.
 *
 * Two sources, one namespace (ADR-0131 D6, regime C): a package declares
 * queues in its stack's `queues` (registry items, never copied into this
 * table); an organization authors its own here, with its members in
 * `sys_queue_member`. Every reference — the `queue` column, an assignment
 * rule's target, an approver, a sharing recipient — names a queue by `name`,
 * resolved registry-first. A row may not take a declared queue's name: the
 * ownership-queue service refuses that write.
 *
 * ⛔ Not the job queue. `sys_job_queue` and the `queue` kernel service are a
 * queue of WORK; this is a queue of PEOPLE.
 *
 * @namespace sys
 */
export const SysQueue = ObjectSchema.create({
  name: 'sys_queue',
  label: 'Queue',
  pluralLabel: 'Queues',
  icon: 'inbox',
  isSystem: true,
  managedBy: 'config',
  description: 'A named group of people that unassigned records can wait in until one of them takes the record.',
  displayNameField: 'name',
  nameField: 'name',
  titleFormat: '{label}',
  highlightFields: ['name', 'label'],

  listViews: {
    all_queues: {
      type: 'grid',
      name: 'all_queues',
      label: 'All',
      data: { provider: 'object', object: 'sys_queue' },
      columns: ['label', 'name', 'updated_at'],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    name: Field.text({
      label: 'Name',
      required: true,
      maxLength: 100,
      description:
        'Identifies the queue everywhere it is used — on records, in assignment rules, approvals and sharing ' +
        'rules. Lowercase letters, digits and underscores only.',
      group: 'Identity',
    }),

    label: Field.text({
      label: 'Display Label',
      required: true,
      maxLength: 200,
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),
  },

  indexes: [
    { fields: ['name'], unique: 'organization' },
  ],
});
