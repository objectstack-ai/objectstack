// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_comment — Threaded Record Comments
 *
 * Generic threaded discussion attached to any record via `thread_id`.
 * `thread_id` is conventionally formatted as `{object}:{record_id}`
 * (e.g. `sys_user:abc123`, `account:9001`) so a single index covers
 * "all comments on this record" lookups across every object.
 *
 * Distinct from `feed_item` (Salesforce-style Chatter timeline that
 * mixes comments with field changes / events / approvals). Use
 * `sys_comment` when you want a focused threaded discussion surface
 * without the heavier Chatter envelope.
 *
 * ## Removed fields (ADR-0049 enforce-or-remove, #4756)
 *
 * Two fields were modelled here with **zero** runtime consumers — nothing in
 * this repo, in `objectui`, or in `cloud` ever read or maintained them. Under
 * ADR-0049 a declared-but-unenforced key is removed rather than left to lie,
 * following the `sys_attachment.share_type` / `sys_attachment.visibility`
 * precedent (#2755: "attachment access is derived from the parent record").
 *
 * - **`visibility`** (`'public' | 'internal' | 'private'`) — never consulted by
 *   any gate: not `enforceFeedsCapability`, not the record-level gates added in
 *   #4630, not the REST layer, not objectui's discussion panel. A comment marked
 *   `private` was exactly as visible as a `public` one — a *security-looking*
 *   lever with no gate behind it (Prime Directive #10). **Prescription:** comment
 *   visibility is decided by the record-level permissions of the record
 *   `thread_id` names (#4630) — there is no per-row override. A designed
 *   external/portal distinction would have to be defined against the ADR-0095
 *   `EXTERNAL` rung (explicitly shared rows only) first, and can return as an
 *   enforced key with tests.
 * - **`reply_count`** — never incremented; `readonly: true` meant an author
 *   could not even set it by hand, so every row read `0` forever. **Prescription:**
 *   count `parent_id` children at read time. Deliberately NOT re-introduced as a
 *   hook-maintained roll-up: the predicate/bulk write-hook gaps tracked by
 *   #4770 / #4778 / #4779 are exactly where such a counter drifts (a bulk delete
 *   of replies would never decrement it), and a counter that drifts is worse
 *   than no counter — both the UI and an AI reading the record would trust it.
 *
 * Existing databases keep the two columns as unmanaged leftovers; there is no
 * migration (same disposition as #2755).
 *
 * ## Retired: `reactions` (maintainer ruling A on #22505, as amended; #22573)
 *
 * `reactions` stored every emoji reaction on the comment's own row as one JSON
 * map, so a member reacting to another member's comment had to update a row
 * the author-only edit rule reserves for its author, and two members reacting
 * at once overwrote each other. A reaction is now its reactor's own record,
 * `sys_comment_reaction` (comment, emoji, user), and the column retires with
 * NOTHING in its place on the comment row: no stored aggregate and no
 * computed-on-read block. A reader that shows reactions reads the
 * `sys_comment_reaction` rows of the comments on screen (`comment_id` `$in`
 * their ids) and groups them by emoji. The D3 record is the semantic entry
 * `sys-comment-reactions-column-retired`. An existing database keeps the
 * physical column and its values (schema sync is additive): the boot drift
 * report names it orphaned, and the data door neither returns nor accepts it
 * (`400 INVALID_FIELD` on a write that names it). The reactions stored in it
 * are carried over, because an upgrade keeps existing data (#23281):
 * `os migrate comment-reactions --apply` turns each stored reaction into the
 * reactor's own `sys_comment_reaction` row, and only once it has recorded a
 * verified run does `os migrate apply --allow-destructive` drop the column.
 *
 * ## Platform-written: `is_edited` / `edited_at` (maintainer ruling A on #23124)
 *
 * The two edit-mark fields were declared here with no platform writer: nothing
 * stamped them when an author changed a comment, so the one client that did
 * (the console's comment editor) was the only producer, an API or agent edit
 * left no mark, and any writer could clear or forge the mark at will. A
 * declared lifecycle field that the platform does not keep is the ADR-0049
 * shape this docblock already removed twice; this time the fields are kept and
 * ENFORCED instead, because readers measurably rely on the mark (the record
 * feed shows "edited" from `is_edited`):
 *
 * - **The stamp.** `installCommentAccessHooks` registers a `beforeUpdate`
 *   handler that sets `is_edited: true` and `edited_at` (server clock) when the
 *   update's `body` differs from the stored body — for every caller, as the
 *   engine's own `updated_at` stamp is. An update that does not name `body`, or
 *   names it unchanged (a `mentions`-only edit), is not an edit and stamps
 *   nothing. A predicate (`multi: true`) update is stamped per matched row; a
 *   batch whose rows disagree (some bodies change, some do not) is refused whole
 *   by the engine (`MULTI_UPDATE_HOOK_KEY_DIVERGENCE`), because one SET clause
 *   cannot carry a per-row mark.
 * - **Read-only at the data door.** Both fields declare `readonly: true`. On
 *   update the engine hides a non-system caller's value from the hooks and
 *   strips it afterwards (reported as `droppedFields`, logged at `warn`), so a
 *   client can neither clear nor forge the mark; the stamp's own write is kept.
 *   On create the engine leaves `sys_` objects to their own guards, so the
 *   create hook sets `is_edited: false` / `edited_at: null` over a client value:
 *   a new comment is not an edited one. ⛔ Not a refusal: the console released
 *   before this change still sends both fields on every edit, and refusing them
 *   would fail that edit; the value simply never lands. A `preserveAudit`
 *   (historical import) update keeps a supplied value, as it does for
 *   `updated_at`.
 *
 * ## Platform-written: the parent pair `object_name` / `record_id` (ADR-0139 E7)
 *
 * The record `thread_id` names, stamped as ADR-0052 §5's pointer pair so the
 * read gate can narrow comments with one `ReadableIds` leaf per parent object
 * instead of a bounded pre-scan (`comment-access-hooks.ts`,
 * `installCommentReadVisibility`). `thread_id` stays the authored key; the
 * pair is derived from it by one planner (`planCommentParentPair`):
 *
 * - **The stamp.** On create, every row is stamped from its `thread_id`, for
 *   every caller and over any value sent. On an update that names `thread_id`
 *   (the re-point the update gate authorizes as an insert into the new
 *   thread), the pair is re-stamped from it. A thread naming no record stamps
 *   `null` / `null`.
 * - **Read-only to authors.** Both declare `readonly: true`, and no writer's
 *   value lands: on create the stamp is assigned over it, and an update that
 *   names either column without a thread has the pair re-derived from the
 *   row's stored thread — for every caller, because under `preserveAudit` (a
 *   historical import) the engine's update-side strip keeps a readonly value.
 *   A multi-row update naming the pair without a thread is refused whole
 *   (`VALIDATION_ERROR` / 400) when its rows' threads name different records:
 *   one write cannot store each row's own pair.
 * - **Stored rows.** Rows written before the pair existed carry `null` until
 *   `os migrate comment-parent-pair --apply` stamps them; until then the read
 *   gate answers them with the bounded thread probe (fail closed), never a
 *   leaf.
 *
 * @namespace sys
 */
export const SysComment = ObjectSchema.create({
  name: 'sys_comment',
  label: 'Comment',
  pluralLabel: 'Comments',
  icon: 'message-square',
  isSystem: true,
  managedBy: 'platform',
  description: 'Threaded comments attached to records via thread_id',
  displayNameField: 'body',
  nameField: 'body', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{author_name}: {body}',
  highlightFields: ['created_at', 'author_name', 'body'],

  fields: {
    id: Field.text({
      label: 'Comment ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    // ── Thread ───────────────────────────────────────────────────
    thread_id: Field.text({
      label: 'Thread',
      required: true,
      searchable: true,
      maxLength: 255,
      description:
        'Thread identifier — conventionally `{object}:{record_id}` (e.g. `sys_user:abc123`)',
      group: 'Thread',
    }),

    // [ADR-0139 E7, ADR-0052 §5] The record the thread names, as the pointer
    // pair every other parent-derived stream keys on. Platform-written from
    // `thread_id` (see "Platform-written: the parent pair" above); never
    // authored.
    object_name: Field.text({
      label: 'Parent Object',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'The object of the record `thread_id` names — stamped by the platform, never written by authors',
      group: 'Thread',
    }),

    record_id: Field.text({
      label: 'Parent Record',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'The id of the record `thread_id` names — stamped by the platform, never written by authors',
      group: 'Thread',
    }),

    // The reply relationship is `parent_id` and nothing else — a reply count is
    // an aggregate over the children, computed at read time (#4756).
    parent_id: Field.lookup('sys_comment', {
      label: 'Parent Comment',
      required: false,
      description: 'Optional parent comment for nested replies',
      group: 'Thread',
    }),

    // ── Author ───────────────────────────────────────────────────
    author_id: Field.lookup('sys_user', {
      label: 'Author',
      required: true,
      searchable: true,
      group: 'Author',
    }),

    author_name: Field.text({
      label: 'Author Name',
      required: false,
      group: 'Author',
    }),

    author_avatar_url: Field.url({
      label: 'Author Avatar',
      required: false,
      group: 'Author',
    }),

    // ── Body ─────────────────────────────────────────────────────
    body: Field.textarea({
      label: 'Body',
      required: true,
      searchable: true,
      description: 'Comment text (Markdown supported)',
      group: 'Body',
    }),

    mentions: Field.textarea({
      label: 'Mentions',
      required: false,
      description: 'JSON array of the user ids @mentioned in the comment',
      group: 'Body',
    }),

    // No `reactions` field: an emoji reaction is its reactor's own
    // `sys_comment_reaction` row (#22566), and nothing about reactions is
    // stored or computed on the comment row (#22573).

    // ── Lifecycle ────────────────────────────────────────────────
    // Platform-written (#23124): the `beforeUpdate` stamp in
    // `comment-access-hooks.ts` sets both when the body changes; a client's
    // value never lands (see "Platform-written" above).
    is_edited: Field.boolean({
      label: 'Edited',
      defaultValue: false,
      readonly: true,
      group: 'Lifecycle',
    }),

    edited_at: Field.datetime({
      label: 'Edited At',
      required: false,
      readonly: true,
      group: 'Lifecycle',
    }),

    // No `visibility` field: who can see a comment is decided by the record
    // `thread_id` points at (#4630, #4756) — one rule, no second source.

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
    { fields: ['thread_id', 'created_at'] },
    // [ADR-0139 E7] The thread gate's leaf is one `record_id IN (…)` per
    // `object_name`, and its probe of unbackfilled rows is `object_name IS NULL`.
    { fields: ['object_name', 'record_id'] },
    { fields: ['parent_id'] },
    { fields: ['author_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    clone: false,
  },
});
