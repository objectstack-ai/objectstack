// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_comment_reaction — one emoji reaction, the reactor's own record.
 *
 * One row is one (comment, emoji, user). The row belongs to the user who
 * reacted, so the platform's ordinary own-record rule is the whole write rule:
 * a member adds a reaction by creating their row and removes it by deleting
 * that row, on anyone's comment, and nobody else's row is ever written. The
 * author-only update floor on `sys_comment` is not touched, and two members
 * reacting at once write two rows, so there is no shared column to overwrite.
 * Maintainer ruling A, amended, on #22505 (director record 6091550406); the
 * delegated judgment 6091621568 keeps NO aggregate on the comment row: a reader
 * does one batched `find` here with `comment_id` `$in` the comments it shows
 * and groups the rows itself.
 *
 * ## Who may do what, and where each rule lives
 *
 * - **Read** — a reaction is readable exactly when its comment is.
 *   `installCommentReadVisibility` (`comment-access-hooks.ts`) narrows every
 *   read of this object to the rows whose `comment_id` the CALLER can read,
 *   asked as one caller-scoped read of `sys_comment` — so the comment's own
 *   grant, row scope and thread gate decide, and no second copy of the
 *   comment's readability rule exists.
 * - **Create** — `installCommentAccessHooks` refuses a reaction on a comment
 *   the caller cannot read (the same evaluator the read gate asks) and stamps
 *   `user_id` from the session; a client-supplied value never wins.
 * - **Delete** — the platform's own-record floor (`owner_only_deletes`,
 *   `created_by == current_user.id`, plugin-security), which this object meets
 *   like any other: the engine stamps `created_by` with the reactor, the
 *   object declares no `sharingModel` that would yield the floor, and no
 *   alternate match relieves it. So a member deletes their own reaction and
 *   not another member's.
 * - **Update** — not offered. `apiMethods` lists no `update` and
 *   `userActions` hides the edit affordance: a reaction is not edited, it is
 *   deleted and made again.
 * - **Bulk** — offered, and it adds no path around the rules above. The batch
 *   doors admit a child operation only when it is itself allowed (`bulk ∧
 *   derived(child)`), so `updateMany` stays refused. `createMany` is ONE engine
 *   insert of the rows, and the engine runs `beforeInsert` per row, so every
 *   row meets the create gate. `deleteMany` is one by-id delete per id, so every
 *   row meets the own-record floor.
 *
 * ## Why `comment_id` is an id column and not a lookup
 *
 * The same reason `sys_comment.thread_id` and `sys_attachment`'s parent pair
 * are id columns: referential behaviour on delete would run as the CALLER. A
 * `cascade` lookup makes deleting a comment delete every reaction on it under
 * the comment author's own authority, which the own-record floor refuses as
 * soon as another member has reacted — so an author could no longer delete
 * their own comment. A `set_null` lookup on a required key escalates to
 * `restrict`, which refuses the same delete outright. As an id column, a
 * deleted comment's reactions stay behind and are read by nobody: the read
 * gate keeps only rows whose comment the caller can read, and a comment that
 * no longer exists is read by no one.
 *
 * ## Uniqueness
 *
 * `(comment_id, emoji, user_id)` is one row, held by a declared unique index —
 * the platform's existing answer. A second identical reaction is refused by
 * the store and reaches the data door as `409 UNIQUE_VIOLATION`; it is not
 * silently absorbed.
 *
 * @namespace sys
 */
export const SysCommentReaction = ObjectSchema.create({
  name: 'sys_comment_reaction',
  label: 'Comment Reaction',
  pluralLabel: 'Comment Reactions',
  icon: 'smile-plus',
  isSystem: true,
  managedBy: 'platform',
  description: 'An emoji reaction to a comment, owned by the user who reacted',
  displayNameField: 'emoji',
  nameField: 'emoji', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)

  fields: {
    id: Field.text({
      label: 'Reaction ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    // ── Reaction ─────────────────────────────────────────────────
    // The id of the reacted comment. 255 is the width of the physical `id`
    // column it holds a value of, the bound `sys_activity.record_id` carries.
    comment_id: Field.text({
      label: 'Comment',
      required: true,
      maxLength: 255,
      description: 'The id of the sys_comment this reaction is on. The reaction is readable exactly when that comment is.',
      group: 'Reaction',
    }),

    emoji: Field.text({
      label: 'Emoji',
      required: true,
      maxLength: 64,
      description: 'The emoji, as the character sequence the client renders (for example 👍)',
      group: 'Reaction',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      description: 'The user who reacted. Stamped from the session on create; a client-supplied value is replaced.',
      group: 'Reaction',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    // [ADR-0120 D1] Scope spelled explicitly: one row per (comment, emoji,
    // user) within the organization the comment lives in. Its leading column
    // also serves the reader's one batched `comment_id` `$in` read.
    { fields: ['comment_id', 'emoji', 'user_id'], unique: 'organization' },
  ],

  // A reaction is made and removed, never edited, and never loaded from a file.
  userActions: { edit: false, import: false },

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'delete', 'bulk'],
    // Not a record anyone discusses, and its CRUD is not a timeline event.
    feeds: false,
    activities: false,
    clone: false,
  },
});
