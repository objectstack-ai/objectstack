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
  managedBy: 'engine-owned',
  description: 'Package-scoped commit log grouping a turn’s metadata changes (ADR-0067).',

  fields: {
    /**
     * Primary Key — the commit id.
     *
     * ⛔ No `maxLength`: the platform emits this column itself (`varchar(255)`),
     * so a declared bound is discarded and the SQL driver says so on every boot
     * (#12015). The clean shape is the one every other system object already
     * carries after #12131 — declare the honoured half only.
     */
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
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

    /** When the commit was recorded. */
    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      readonly: true,
    }),
  },

  // [ADR-0131 D6/D7, C7b] Tenant-less, like the overlays it records: the
  // declared organization column is retired (ADR-0087 semantic entry
  // 18.sys-metadata-commit-organization-column-retired), and `systemFields.tenant: false`
  // keeps the engine from injecting one back. The v18 ceremony
  // (`os migrate organization-ownership --apply`) drops the physical column.
  systemFields: { tenant: false },
  // [ADR-0131 D7, the #22107 precedent] With no organization column there is
  // no tenant wall, and a walled deployment's `organization_admin` holds a
  // `'*'` grant — so without an object-level gate the generic data door would
  // serve every organization's rows of this table (package commit ranges and their items). D7 governs it by
  // object permission: `studio.access`, platform-scoped (no tenant
  // administrator holds it by role) and admitted by every `/meta` door that
  // serves this table (`/meta/:type/:name/history` and `/audit` admit it among
  // `studio.access` / `setup.access` / `manage_metadata`; `/packages/:id/commits`
  // among `studio.access` / `setup.access`). `requiredPermissions` is an
  // AND-gate, so it names one capability all three doors admit — and not
  // `setup.access`, which organization admins DO hold (plugin-security's
  // `PLATFORM_ADMIN_ONLY_CAPABILITIES` excludes it on purpose). Platform code
  // reads under the system context, which the gate does not stop.
  requiredPermissions: ['studio.access'],

  indexes: [
    // List a package's history newest-first (the timeline read pattern).
    { fields: ['package_id', 'created_at'] },
    // Environment-wide commit replay / audit.
    { fields: ['created_at'] },
    { fields: ['parent_commit_id'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
  },
});
