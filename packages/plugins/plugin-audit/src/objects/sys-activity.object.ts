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

    /**
     * The activity kind — an OPEN, author-extensible vocabulary whose declared
     * options are the platform's BUILT-IN set. Maintainer ruling 2026-08-24 on
     * #11507 (direction 4 of the four that card framed), which the `description`
     * below carries into the contract; this comment carries the reasoning.
     *
     * ## Why the declaration used to lie
     *
     * A `select` over a fixed list normally means "anything else is
     * `invalid_option`". Here it never could:
     *
     *  1. Every field on this object is `readonly: true`, and `validateRecord`
     *     skips readonly fields on BOTH write branches
     *     (`objectql/src/validation/record-validator.ts`), so the option check
     *     never runs. An undeclared value is stored silently.
     *  2. ADR-0052 §5b.2 `activityMilestones[].type` is `z.string().optional()`
     *     in `object.zod.ts` and is forwarded verbatim by `audit-writers.ts`
     *     (`if (milestone.type) activityType = milestone.type`) — a shipped,
     *     documented, author-facing channel into this column.
     *  3. An app's own server-side action reaches the column directly
     *     (`ctx.api.object('sys_activity').insert({ type: … })`). No grep of
     *     THIS repository can see those; both measured sites live in
     *     objectstack-ai/hotcrm (#11424, read at 5eee1bd).
     *
     * So an author — most often an AI writing metadata — who read the option
     * list learned "another value will be rejected", which was false in three
     * independent ways. The ruling closes that by moving the declaration, not
     * the runtime: the options are the built-in set, author-contributed values
     * are legitimate, and ADR-0052 §5b.2 STAYS a write path (turning it into a
     * rejection path was direction 3, which was NOT ruled).
     *
     * ## What that binds
     *
     *  - Do not "fix" this by enforcing the enum on system-owned writes, and do
     *    not narrow `activityMilestones[].type`. Either is direction 3; re-open
     *    #11507 first.
     *  - Keep the built-in set declared and censused — open is not undeclared.
     *    The writer census lives in `sys-activity-type-vocabulary.test.ts`, and
     *    it inventories BUILT-IN values only; an author's value belongs to the
     *    app that writes it, not to this list.
     *  - Downstream, every CLOSED map over this vocabulary is now the bug: a
     *    consumer must render an unknown value, not drop the row. (objectui's
     *    feed-kind map is the known one; its pin is a card in that lane.)
     */
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
        'scheduled',
        'login',
        'logout',
        'system',
      ],
      {
        label: 'Type',
        description:
          'Activity kind. The declared options are the platform BUILT-IN set of an open '
          + 'vocabulary, not a closed enum: metadata authors may contribute their own values '
          + '(sanctioned channel: `activityMilestones[].type`, ADR-0052 §5b.2), and an '
          + 'undeclared value is stored verbatim rather than rejected. Consumers must render '
          + 'an unknown value instead of assuming this list is exhaustive (maintainer ruling '
          + '2026-08-24, #11507).',
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

    // [#11374 route A] The value is a record id of the object `object_name`
    // names — written by `audit-writers.ts` (`record_id: recordId`, the id of
    // the very row the mutation touched). The bound is derived by
    // referenced-column transitivity from the id itself, never guessed:
    // `driver-sql` creates every table's primary key as
    // `table.string('id').primary()` — knex's `varchar(255)`, which the driver
    // spells out as `DEFAULT_STRING_VARCHAR_CHARS = 255` and names in its own
    // error text as "built-in `id` (a varchar(255))". No id this column can
    // receive is wider than the column the id lives in.
    //
    // The seed path cannot widen it either: an unresolvable pointer is
    // "refused loudly, never stored verbatim" (`metadata-protocol`'s
    // seed-loader), so `referenceVia` resolves a natural key to a real record
    // id BEFORE it is stored — a raw external key never lands in this column.
    //
    // 255 rather than the 100 that `plugin-sharing` and `plugin-approvals`
    // chose for their own `record_id`: those narrow below what the id column
    // itself accepts, which is safe only for their own writers. 255 is the
    // transitive ceiling, so it refuses nothing that is storable today.
    // It is also <= the 768-character utf8mb4 key ceiling, so the
    // `(object_name, record_id)` index below is expressible on MySQL — which is
    // the whole point: unbounded, this column was emitted TEXT, MySQL refused
    // the index with `ER_BLOB_KEY_WITHOUT_LENGTH`, and the object landed
    // registered-but-broken with the ActivityPointer lookup the read path
    // assumes (ADR-0052 §5) silently absent.
    record_id: Field.text({
      label: 'Record ID',
      required: false,
      readonly: true,
      searchable: true,
      maxLength: 255,
      // [#11339] The id half of the ActivityPointer pair (ADR-0052 §5): a
      // record id of the object `object_name` names on the same row. Declaring
      // it makes the pair seedable — a packaged app's seed writes the target's
      // natural key and the loader resolves it through `object_name`, instead
      // of storing a literal that attaches to nothing.
      referenceVia: 'object_name',
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
      // [#11339] Second ActivityPointer pair — same seed-time resolution
      // through the sibling `source_object` column.
      referenceVia: 'source_object',
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
