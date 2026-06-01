// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_activity — Lightweight Activity Stream
 *
 * Append-only "recent activity" feed shown on dashboards / overview
 * pages. Distinct from `sys_audit_log` (compliance-grade, structured
 * before/after diffs) and `feed_item` (record-scoped Chatter timeline
 * with comments/reactions/threads). Activity entries are denormalized
 * snapshots optimized for chronological "what happened lately" reads.
 *
 * Typical write sources: data triggers, plugin events, UI actions.
 * Typical readers: Studio dashboard, mobile inbox, notification jobs.
 *
 * @namespace sys
 */
export const SysActivity = ObjectSchema.create({
  name: 'sys_activity',
  label: 'Activity',
  pluralLabel: 'Activities',
  icon: 'activity',
  isSystem: true,
  managedBy: 'append-only',
  description: 'Recent activity stream entries (lightweight, denormalized)',
  displayNameField: 'summary',
  titleFormat: '{type} · {summary}',
  compactLayout: ['timestamp', 'type', 'actor_name', 'summary'],

  fields: {
    id: Field.text({
      label: 'Activity ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    timestamp: Field.datetime({
      label: 'Timestamp',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'Event',
    }),

    type: Field.select(
      [
        'created',
        'updated',
        'deleted',
        'commented',
        'mentioned',
        'shared',
        'assigned',
        'completed',
        'login',
        'logout',
        'system',
      ],
      {
        label: 'Type',
        required: true,
        readonly: true,
        searchable: true,
        group: 'Event',
      },
    ),

    summary: Field.text({
      label: 'Summary',
      required: true,
      readonly: true,
      maxLength: 500,
      searchable: true,
      description: 'Human-readable one-line summary',
      group: 'Event',
    }),

    // ── Actor ───────────────────────────────────────────────────
    actor_id: Field.lookup('sys_user', {
      label: 'Actor',
      required: false,
      readonly: true,
      searchable: true,
      group: 'Actor',
    }),

    actor_name: Field.text({
      label: 'Actor Name',
      required: false,
      readonly: true,
      group: 'Actor',
    }),

    actor_avatar_url: Field.url({
      label: 'Actor Avatar',
      required: false,
      readonly: true,
      group: 'Actor',
    }),

    // ── Target ───────────────────────────────────────────────────
    object_name: Field.text({
      label: 'Object',
      required: false,
      readonly: true,
      searchable: true,
      maxLength: 255,
      description: 'Target object short name (e.g. account, sys_user)',
      group: 'Target',
    }),

    record_id: Field.text({
      label: 'Record ID',
      required: false,
      readonly: true,
      searchable: true,
      group: 'Target',
    }),

    record_label: Field.text({
      label: 'Record Label',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'Display label of the target record at write time',
      group: 'Target',
    }),

    url: Field.url({
      label: 'URL',
      required: false,
      readonly: true,
      description: 'Optional deep-link to the activity target',
      group: 'Target',
    }),

    // ── Context ──────────────────────────────────────────────────
    environment_id: Field.lookup('sys_environment', {
      label: 'Environment',
      required: false,
      readonly: true,
      searchable: true,
      description: 'Environment context (multi-environment deployments)',
      group: 'Context',
    }),

    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      readonly: true,
      description: 'JSON-serialized additional context',
      group: 'Context',
    }),
  },

  indexes: [
    { fields: ['timestamp'] },
    { fields: ['actor_id'] },
    { fields: ['object_name', 'record_id'] },
    { fields: ['type'] },
    { fields: ['environment_id'] },
  ],

  enable: {
    trackHistory: false,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
    trash: false,
    mru: false,
    clone: false,
  },
});
