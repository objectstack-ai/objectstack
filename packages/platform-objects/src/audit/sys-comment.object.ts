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
  titleFormat: '{author_name}: {body}',
  compactLayout: ['created_at', 'author_name', 'body'],

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

    parent_id: Field.lookup('sys_comment', {
      label: 'Parent Comment',
      required: false,
      description: 'Optional parent comment for nested replies',
      group: 'Thread',
    }),

    reply_count: Field.number({
      label: 'Reply Count',
      defaultValue: 0,
      readonly: true,
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

    visibility: Field.select(
      ['public', 'internal', 'private'],
      {
        label: 'Visibility',
        defaultValue: 'public',
        group: 'Lifecycle',
      },
    ),

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
    trash: true,
    mru: false,
    clone: false,
  },
});
