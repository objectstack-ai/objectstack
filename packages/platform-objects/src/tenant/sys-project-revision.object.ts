// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_project_revision — Per-Project Artifact Revision History
 *
 * One row per `objectstack publish`. Each row records a content-addressable
 * pointer to the compiled artifact stored in IStorageService (S3, local fs,
 * etc.) plus enough provenance to support rollback, audit, and "preview at
 * commit" UX in Studio.
 *
 * Lifecycle:
 *   - `is_current = true` for at most one row per project. Activating a
 *     historical revision flips the flag (atomic UPDATE in the cloud-
 *     artifact plugin's POST /activate handler).
 *   - Rows are immutable apart from `is_current` and `note`.
 *   - `storage_key` is content-addressable
 *     (`artifacts/<project_id>/<commit_id>.json` by default), so re-
 *     publishing identical content is a no-op upload.
 *
 * Lives in the control plane only.
 *
 * @namespace sys
 */
export const SysProjectRevision = ObjectSchema.create({
  name: 'sys_project_revision',
  label: 'Project Revision',
  pluralLabel: 'Project Revisions',
  icon: 'git-commit',
  isSystem: true,
  managedBy: 'config',
  description: 'Immutable history of compiled artifacts published per project.',
  titleFormat: '{commit_id}',
  compactLayout: ['commit_id', 'project_id', 'is_current', 'published_at'],

  fields: {
    id: Field.text({
      label: 'Revision ID',
      required: true,
      readonly: true,
      description: 'UUID of the revision row.',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      description: 'Row creation timestamp (= published_at by default).',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      description: 'Last update timestamp (only `is_current` / `note` mutate).',
    }),

    project_id: Field.lookup('sys_project', {
      label: 'Project',
      required: true,
      description: 'Foreign key to sys_project.',
    }),

    commit_id: Field.text({
      label: 'Commit ID',
      required: true,
      maxLength: 64,
      description:
        'Short content hash of the artifact (sha256 prefix of the canonical body). Unique per project.',
    }),

    checksum: Field.text({
      label: 'Checksum',
      required: false,
      maxLength: 128,
      description: 'Full sha256 hex digest of the artifact body.',
    }),

    storage_key: Field.text({
      label: 'Storage Key',
      required: true,
      maxLength: 512,
      description:
        'Key within IStorageService (e.g. artifacts/<project_id>/<commit_id>.json).',
    }),

    storage_adapter: Field.text({
      label: 'Storage Adapter',
      required: false,
      maxLength: 64,
      description:
        'Adapter id that wrote this artifact ("local-fs" | "file-storage:<service>"). Diagnostic only.',
    }),

    size_bytes: Field.number({
      label: 'Size (bytes)',
      required: false,
      description: 'Uncompressed size of the artifact body.',
    }),

    built_at: Field.datetime({
      label: 'Built At',
      required: false,
      description: 'Wall-clock time the artifact was produced by `objectstack compile`.',
    }),

    built_with: Field.textarea({
      label: 'Built With',
      required: false,
      description: 'JSON-serialized builder metadata copied from the artifact (cli version, engines).',
    }),

    published_by: Field.lookup('sys_user', {
      label: 'Published By',
      required: false,
      description: 'User who issued the publish call (when known).',
    }),

    published_at: Field.datetime({
      label: 'Published At',
      defaultValue: 'NOW()',
      required: false,
      description: 'When the row was created.',
    }),

    note: Field.text({
      label: 'Note',
      required: false,
      maxLength: 1024,
      description: 'Optional human note (release name / changelog blurb).',
    }),

    is_current: Field.boolean({
      label: 'Is Current',
      required: true,
      defaultValue: false,
      description:
        'Whether this revision is the active one for the project. At most one row per project carries `true`.',
    }),

    branch: Field.text({
      label: 'Branch',
      required: false,
      defaultValue: 'main',
      maxLength: 63,
      description:
        'Logical branch this revision belongs to (e.g. `main`, `staging`, `feature-billing`). ' +
        'Default `main`. Branch names are slugs `^[a-z0-9][a-z0-9._/-]{0,62}$` and must not look ' +
        'like a 12-hex commit prefix (would collide with preview URL parsing).',
    }),

    is_branch_head: Field.boolean({
      label: 'Is Branch Head',
      required: false,
      defaultValue: false,
      description:
        'Whether this revision is the latest published commit on its branch. At most one ' +
        'row per (project_id, branch) carries `true`. Used by branch-tracking preview URLs.',
    }),
  },

  indexes: [
    { fields: ['project_id', 'commit_id'], unique: true },
    { fields: ['project_id', 'is_current'] },
    { fields: ['project_id', 'published_at'] },
    { fields: ['project_id', 'branch', 'is_branch_head'] },
    { fields: ['project_id', 'branch', 'published_at'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update'],
    trash: false,
    mru: false,
  },
});
