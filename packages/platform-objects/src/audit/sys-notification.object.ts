// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_notification — Per-User Inbox Notification
 *
 * Personal, unread-trackable notifications. Distinct from
 * `sys_activity` (per-record, append-only narrative) and
 * `sys_audit_log` (compliance-grade structured diff). Each row
 * targets exactly one user (`recipient_id`) and is the source of
 * truth for the header bell badge.
 *
 * Typical writers: comment mention, record assignment, lead-convert
 * completion, flow notifications. Typical readers: header bell,
 * notification center.
 *
 * @namespace sys
 */
export const SysNotification = ObjectSchema.create({
  name: 'sys_notification',
  label: 'Notification',
  pluralLabel: 'Notifications',
  icon: 'bell',
  isSystem: true,
  managedBy: 'system',
  description: 'Per-user notification inbox entries',
  displayNameField: 'title',
  titleFormat: '{title}',
  compactLayout: ['title', 'type', 'is_read', 'created_at'],

  fields: {
    id: Field.text({
      label: 'Notification ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    // ── Routing ──────────────────────────────────────────────────
    recipient_id: Field.lookup('sys_user', {
      label: 'Recipient',
      required: true,
      searchable: true,
      description: 'User the notification is delivered to',
      group: 'Routing',
    }),

    // ── Content ──────────────────────────────────────────────────
    type: Field.select(
      ['mention', 'assignment', 'comment_reply', 'lead_converted', 'task_due', 'system'],
      {
        label: 'Type',
        required: true,
        defaultValue: 'system',
        description: 'Notification category — drives icon + sort priority',
        group: 'Content',
      },
    ),

    title: Field.text({
      label: 'Title',
      required: true,
      maxLength: 255,
      searchable: true,
      group: 'Content',
    }),

    body: Field.textarea({
      label: 'Body',
      required: false,
      description: 'Optional secondary text (one-line summary)',
      group: 'Content',
    }),

    // ── Source linkage ───────────────────────────────────────────
    source_object: Field.text({
      label: 'Source Object',
      required: false,
      maxLength: 100,
      description: 'Object name of the related record (e.g. lead, opportunity)',
      group: 'Source',
    }),

    source_id: Field.text({
      label: 'Source Record',
      required: false,
      maxLength: 100,
      description: 'Record id within source_object',
      group: 'Source',
    }),

    url: Field.url({
      label: 'Deep Link',
      required: false,
      description: 'Optional URL to navigate to when clicked',
      group: 'Source',
    }),

    actor_id: Field.lookup('sys_user', {
      label: 'Actor',
      required: false,
      description: 'User who caused the notification (mentioner, assigner)',
      group: 'Source',
    }),

    actor_name: Field.text({
      label: 'Actor Name',
      required: false,
      group: 'Source',
    }),

    // ── Read state ───────────────────────────────────────────────
    is_read: Field.boolean({
      label: 'Read',
      defaultValue: false,
      description: 'True once recipient acknowledges',
      group: 'State',
    }),

    read_at: Field.datetime({
      label: 'Read At',
      required: false,
      group: 'State',
    }),

    // ── Lifecycle ────────────────────────────────────────────────
    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      required: false,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['recipient_id', 'is_read', 'created_at'] },
    { fields: ['recipient_id', 'created_at'] },
    { fields: ['source_object', 'source_id'] },
  ],
});
