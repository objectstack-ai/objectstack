// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_metadata_commit — Package-scoped commit log (ADR-0067)
 *
 * One row per authoring TURN (AI apply or Studio batch) that promoted a group
 * of metadata changes together. A commit GROUPS the per-item events already
 * recorded in `sys_metadata_history` (by their `event_seq` range) into the unit
 * a user actually reasons about — "the change my last instruction made" — and
 * is the handle for `revertCommit` / `rollbackToPackageCommit`.
 *
 * Append-only, like `sys_metadata_history`: a revert is recorded as a NEW commit
 * (`operation = 'revert'`, `parent_commit_id` = the reverted commit), never an
 * in-place mutation. History therefore never loses the record of what happened.
 *
 * The `items` payload captures, per artifact, exactly what `revertCommit` needs
 * to undo the commit losslessly: whether the artifact EXISTED before this commit
 * (`existedBefore`) and, if so, the lineage `version` it should be restored to
 * (`prevVersion`). A created-by-this-commit artifact reverts by soft-removal;
 * a modified one reverts by `restoreVersion(prevVersion)`.
 */
export const SysMetadataCommitObject = ObjectSchema.create({
  name: 'sys_metadata_commit',
  label: 'Metadata Commit',
  pluralLabel: 'Metadata Commits',
  icon: 'git-commit',
  isSystem: true,
  managedBy: 'system',
  description: 'Package-scoped commit log grouping a turn’s metadata changes (ADR-0067).',

  fields: {
    /** Primary Key — the commit id. */
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
      maxLength: 64,
    }),

    /** The app/package this commit belongs to (the unit a user reverts). */
    package_id: Field.text({
      label: 'Package',
      required: false,
      searchable: true,
      readonly: true,
      maxLength: 255,
    }),

    /** apply = a turn promoted changes; revert = this commit undid another. */
    operation: Field.select(['apply', 'revert'], {
      label: 'Operation',
      required: true,
      readonly: true,
    }),

    /** Human-readable summary — for AI turns, the user's prompt. */
    message: Field.textarea({
      label: 'Message',
      required: false,
      readonly: true,
      description: 'Change summary; for AI turns, the user instruction that produced it.',
    }),

    /** Producing actor (user id, or an AI principal like "ai:claude"). */
    actor: Field.text({
      label: 'Actor',
      required: false,
      readonly: true,
      maxLength: 255,
    }),

    /** AI model that authored the turn (absent for human/CLI commits). */
    ai_model: Field.text({
      label: 'AI Model',
      required: false,
      readonly: true,
      maxLength: 100,
    }),

    /** For a revert commit, the id of the commit it reverted. */
    parent_commit_id: Field.text({
      label: 'Parent Commit',
      required: false,
      readonly: true,
      maxLength: 64,
    }),

    /** First `sys_metadata_history.event_seq` covered by this commit. */
    event_seq_start: Field.number({
      label: 'Event Seq Start',
      required: false,
      readonly: true,
    }),

    /** Last `sys_metadata_history.event_seq` covered by this commit. */
    event_seq_end: Field.number({
      label: 'Event Seq End',
      required: false,
      readonly: true,
    }),

    /**
     * JSON array of the artifacts this commit touched, with the data
     * `revertCommit` needs: [{ type, name, existedBefore, prevVersion }].
     */
    items: Field.textarea({
      label: 'Items',
      required: false,
      readonly: true,
      description: 'JSON: [{ type, name, existedBefore, prevVersion }] — the revert plan.',
    }),

    /** Number of artifacts in `items` (denormalized for list views). */
    item_count: Field.number({
      label: 'Item Count',
      required: false,
      readonly: true,
    }),

    /** Organization ID for multi-tenant isolation. */
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      readonly: true,
      description: 'Organization for multi-tenant isolation.',
    }),

    /** When the commit was recorded. */
    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      readonly: true,
    }),
  },

  indexes: [
    // List a package's history newest-first (the timeline read pattern).
    { fields: ['organization_id', 'package_id', 'created_at'] },
    // Org-wide commit replay / audit.
    { fields: ['organization_id', 'created_at'] },
    { fields: ['parent_commit_id'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
    trash: false,
  },
});
