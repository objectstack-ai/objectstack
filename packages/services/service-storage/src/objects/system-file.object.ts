// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { UploadScopeSchema, type UploadScope } from '@objectstack/spec/api';

/**
 * Display labels of the `scope` select, one per upload scope.
 *
 * The VALUES are not listed here: the select reads them off
 * `UploadScopeSchema`, the one upload-scope list `@objectstack/spec` declares
 * for the upload requests and the upload doors too (#22470), so the store, the
 * request and the doors cannot drift apart. `Record<UploadScope, …>` makes a
 * member added to that enum without a label here a compile error.
 */
const UPLOAD_SCOPE_LABELS: Record<UploadScope, string> = {
  user: 'User',
  tenant: 'Tenant',
  private: 'Private',
  temp: 'Temp',
  // Files uploaded through the generic Attachments surface (#2727).
  // Their only legitimate referrers are sys_attachment join rows, so
  // this scope is the discriminator for orphan tombstoning (#2755) —
  // field-attachment scopes above are never tombstoned.
  attachments: 'Attachments',
};

/**
 * System File Object
 *
 * Persisted metadata for files stored via the Storage Service.
 *
 * The Storage Service contract addresses files by `key` (path inside the
 * configured backend). The REST protocol (see `packages/spec/src/api/storage.zod.ts`)
 * exposes an opaque `fileId` so that:
 *
 *   1. Client code never needs to know — or be able to spoof — backend keys.
 *   2. Files can be moved between buckets / storage tiers without breaking links.
 *   3. Lifecycle status (uploading → committed → deleted) can be tracked.
 *
 * Belongs to `@objectstack/service-storage` per the platform's
 * "protocol + service ownership" pattern.
 */
export const SystemFile = ObjectSchema.create({
  name: 'sys_file',
  label: 'System File',
  pluralLabel: 'System Files',
  icon: 'file',
  description: 'Storage service file metadata (fileId ↔ key mapping)',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (single-field titleFormat)
  titleFormat: '{name}',
  highlightFields: ['name', 'mime_type', 'size', 'status', 'created_at'],

  fields: {
    id: Field.text({
      label: 'File ID',
      required: true,
      readonly: true,
    }),

    key: Field.text({
      label: 'Storage Key',
      required: true,
      searchable: true,
    }),

    name: Field.text({
      label: 'File Name',
      required: true,
      searchable: true,
    }),

    mime_type: Field.text({
      label: 'MIME Type',
    }),

    size: Field.number({
      label: 'Size (bytes)',
    }),

    // A logical key prefix and a lifecycle discriminator — never an access
    // grant: the download doors judge `acl`, the attachments scope and field
    // ownership alone. `public` is retired (#22443, ruling B): it promised a
    // public file and stored a private one. A deployment's stored `public` rows
    // are rewritten to `user` by `backfill-sys-file-public-scope.ts`, the
    // operator step that must run before a copy of such a row can succeed.
    // Anonymous download is `acl: 'public_read'` and nothing else.
    //
    // The options are `UploadScopeSchema`'s values, in its order, each with
    // its label above — the list the upload requests and doors read (#22470).
    scope: Field.select({
      label: 'Scope',
      options: UploadScopeSchema.options.map((value) => ({ label: UPLOAD_SCOPE_LABELS[value], value })),
    }),

    bucket: Field.text({
      label: 'Bucket',
    }),

    acl: Field.select({
      label: 'ACL',
      options: [
        { label: 'Private', value: 'private' },
        { label: 'Public Read', value: 'public_read' },
      ],
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Pending Upload', value: 'pending' },
        { label: 'Committed', value: 'committed' },
        { label: 'Deleted', value: 'deleted' },
      ],
    }),

    etag: Field.text({
      label: 'ETag',
    }),

    owner_id: Field.text({
      label: 'Owner ID',
      description: 'User who uploaded the file (authorship, not the field-reference owner)',
    }),

    // ── Field-reference ownership (ADR-0104 D3 wave 2) ──────────────
    // A `file`/`image`/`avatar`/`video`/`audio` FIELD value references a file
    // by opaque id. Unlike the attachments surface — where one file is
    // deliberately SHARED across many `sys_attachment` join rows — a field
    // reference is EXCLUSIVE: at most one (object, record, field) slot owns a
    // given file. Writing an already-owned id into a second slot copies the
    // bytes into a fresh `sys_file` rather than sharing the row.
    //
    // Exclusivity is what makes the lifecycle safe to reason about: release is
    // an OBSERVED transition ("my one owner let go"), never an inferred absence
    // ("I counted and found nobody"), and a file's read authorization derives
    // from exactly one parent record instead of the union of every referrer's.
    // See ADR-0104 §"D3 wave 2 — ownership model".
    //
    // NULL on: freshly uploaded but not yet claimed by a record write, and on
    // every attachments-surface file (those are governed by sys_attachment).
    ref_object: Field.text({
      label: 'Referencing Object',
      maxLength: 128,
      description: 'Short object name of the record whose field owns this file',
      group: 'Field Reference',
    }),

    ref_id: Field.text({
      label: 'Referencing Record',
      maxLength: 64,
      description: 'Primary key of the record whose field owns this file',
      group: 'Field Reference',
    }),

    ref_field: Field.text({
      label: 'Referencing Field',
      maxLength: 128,
      description: 'Field name on the owning record that holds this file id',
      group: 'Field Reference',
    }),

    metadata: Field.text({
      label: 'Metadata (JSON)',
    }),

    created_at: Field.datetime({
      label: 'Created At',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
    }),

    deleted_at: Field.datetime({
      label: 'Deleted At',
      description:
        'Tombstone timestamp — set when the last sys_attachment reference to an attachments-scope file is removed; the lifecycle TTL reaps the row (and its storage bytes, via the sys_file reap guard) after the grace window. NULL for live rows.',
    }),
  },

  indexes: [
    // "which file does this record's field own" / "release everything this
    // record owned" — the release path is a single keyed write against this
    // index, so a delete never has to re-read the record's field values.
    { fields: ['ref_object', 'ref_id'] },
  ],

  // ADR-0057 (#2755): sys_file rows are mostly permanent business truth, but
  // two terminal states are garbage that would otherwise grow forever:
  //   - tombstoned attachment orphans (status='deleted', deleted_at set by
  //     the attachment lifecycle hooks when the last join row is removed)
  //   - never-completed presigned/chunked uploads (status='pending')
  // Committed rows carry neither trigger (NULL deleted_at, status≠pending),
  // so they are immortal. Byte reclaim + sweep-time re-verification happen in
  // the reap guard registered by StorageServicePlugin. A kernel that loads
  // ObjectQL without this plugin reaps matching rows without byte cleanup —
  // harmless there, since only this plugin's hooks ever write the triggers.
  lifecycle: {
    class: 'transient',
    ttl: { field: 'deleted_at', expireAfter: '30d' },
    retention: { maxAge: '7d', onlyWhen: { status: 'pending' } },
  },
});
