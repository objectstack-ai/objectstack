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
 *   external/portal distinction would have to be defined against ADR-0090 D11's
 *   `externalSharingModel` first, and can return as an enforced key with tests.
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
      description: 'JSON array of @mention objects',
      group: 'Body',
    }),

    reactions: Field.textarea({
      label: 'Reactions',
      required: false,
      description: 'JSON array of emoji reaction objects',
      group: 'Body',
    }),

    // ── Lifecycle ────────────────────────────────────────────────
    is_edited: Field.boolean({
      label: 'Edited',
      defaultValue: false,
      group: 'Lifecycle',
    }),

    edited_at: Field.datetime({
      label: 'Edited At',
      required: false,
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
