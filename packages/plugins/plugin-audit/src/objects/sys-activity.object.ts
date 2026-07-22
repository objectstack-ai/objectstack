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
  // ADR-0057: the highest-frequency telemetry table on the platform (the
  // 260 MB dev.db regression was ~50% this table). 14 day-shards once the
  // Rotator lands; the same 14d window is age-reaped until then.
  lifecycle: {
    class: 'telemetry',
    retention: { maxAge: '14d' },
    storage: { strategy: 'rotation', shards: 14, unit: 'day' },
    reclaim: true,
  },
  description: 'Recent activity stream entries (lightweight, denormalized)',
  displayNameField: 'summary',
  nameField: 'summary', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{type} · {summary}',
  highlightFields: ['timestamp', 'type', 'actor_name', 'summary'],

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

    // ── Source pointer (ADR-0052 §5 — ActivityPointer model) ─────────
    // `object_name`/`record_id` say WHICH record this activity belongs to (the
    // "regarding" record, e.g. the contact). `source_object`/`source_id` point
    // to the RICH ENTITY this activity was derived from — the email row in
    // `sys_email`, the call/meeting in a task object, the `sys_comment` — so the
    // timeline can drill from a one-line summary to the full record. This is the
    // queryable, structured equivalent of cramming an id into `metadata`
    // (cf. Dataverse ActivityPointer → Email/PhoneCall/Appointment subtypes,
    // Salesforce ActivityTimeline → EmailMessage/Task/Event). Optional: most
    // CRUD activities have no distinct source (the record IS the source).
    source_object: Field.text({
      label: 'Source Object',
      required: false,
      readonly: true,
      searchable: true,
      maxLength: 255,
      description: 'Object name of the rich source entity this activity was derived from (e.g. "sys_email"). Null when the activity is about the target record itself.',
      group: 'Target',
    }),

    source_id: Field.text({
      label: 'Source ID',
      required: false,
      readonly: true,
      searchable: true,
      maxLength: 255,
      description: 'Record id of the rich source entity (paired with source_object) — lets the timeline drill to the full email/call/meeting record.',
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
    clone: false,
  },
});
