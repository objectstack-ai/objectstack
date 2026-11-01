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
 * The `sys_file` columns the storage service owns: where the bytes live
 * (`key`), what the backend was told they are (`mime_type`, `size`, `etag`) and
 * how far the upload got (`status`). A file field refuses a file whose upload
 * never completed by reading `status`, and judges `accept` / `maxSize` by
 * reading `mime_type` / `size`, so a caller who could write them could make a
 * file with no bytes read as uploaded, or one the field forbids read as
 * allowed.
 *
 * Each is declared `readonly` below, so on an UPDATE the engine's static
 * readonly strip takes a non-system caller's value back out (the PATCH answers
 * as before and the column keeps what the service wrote). On an INSERT the
 * engine leaves a `sys_` object's columns to the object's own guard, and that
 * guard reads this list: `installSysFileStorageOwnedColumnsGuard`
 * (`sys-file-storage-owned-columns.ts`). Only the service's own writes, all
 * under the system context, move these columns: the upload doors through
 * `StorageMetadataStore`, the claim, release and copy of a file field, and the
 * attachment tombstone.
 *
 * `key` and `status` are also declared `required`, but the engine does not
 * enforce that on an INSERT: its record validator checks a `readonly` field
 * for shape only. Their presence is the storage writers' invariant, not the
 * engine's: every writer above sets both (a presigned or chunked upload starts
 * `pending` with its `key`, `/upload/complete` commits it, and a field copy
 * writes a fresh `key` and `committed`). A non-system create, the one write
 * that does not come from those writers, has its `key` dropped and starts
 * `pending`, so no file field can claim it. The declaration stays as it is.
 */
export const SYS_FILE_STORAGE_OWNED_COLUMNS = ['key', 'mime_type', 'size', 'status', 'etag'] as const;

/**
 * The `sys_file` columns the file-reference lifecycle owns: which record and
 * field hold the file (`ref_object`, `ref_id`, `ref_field`) and which record
 * last let it go (`released_ref_object`, `released_ref_id`), ADR-0104 D3
 * wave 2.
 *
 * They take the same form as {@link SYS_FILE_STORAGE_OWNED_COLUMNS}: each is
 * `readonly` below, so the engine takes a non-system caller's value back out
 * of an UPDATE, and the same create-side guard
 * (`installSysFileStorageOwnedColumnsGuard`) drops them from a non-system
 * INSERT. Neither refuses the write. Only the lifecycle moves them, under the
 * system context: a file field's claim, release and copy
 * (`file-reference-lifecycle.ts`, `field-file-service.ts`) and the operator
 * backfill of file references.
 */
export const SYS_FILE_REFERENCE_COLUMNS = [
  'ref_object',
  'ref_id',
  'ref_field',
  'released_ref_object',
  'released_ref_id',
] as const;

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

    // Storage-owned (SYS_FILE_STORAGE_OWNED_COLUMNS).
    key: Field.text({
      label: 'Storage Key',
      required: true,
      searchable: true,
      readonly: true,
    }),

    name: Field.text({
      label: 'File Name',
      required: true,
      searchable: true,
    }),

    // Storage-owned (SYS_FILE_STORAGE_OWNED_COLUMNS).
    mime_type: Field.text({
      label: 'MIME Type',
      readonly: true,
    }),

    // Storage-owned (SYS_FILE_STORAGE_OWNED_COLUMNS).
    size: Field.number({
      label: 'Size (bytes)',
      readonly: true,
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

    // Storage-owned (SYS_FILE_STORAGE_OWNED_COLUMNS).
    status: Field.select({
      label: 'Status',
      required: true,
      readonly: true,
      options: [
        { label: 'Pending Upload', value: 'pending' },
        { label: 'Committed', value: 'committed' },
        { label: 'Deleted', value: 'deleted' },
      ],
    }),

    // Storage-owned (SYS_FILE_STORAGE_OWNED_COLUMNS).
    etag: Field.text({
      label: 'ETag',
      readonly: true,
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
    //
    // Lifecycle-owned (SYS_FILE_REFERENCE_COLUMNS), as are the two released_*
    // columns below.
    ref_object: Field.text({
      label: 'Referencing Object',
      maxLength: 128,
      description: 'Short object name of the record whose field owns this file',
      group: 'Field Reference',
      readonly: true,
    }),

    ref_id: Field.text({
      label: 'Referencing Record',
      maxLength: 64,
      description: 'Primary key of the record whose field owns this file',
      group: 'Field Reference',
      readonly: true,
    }),

    ref_field: Field.text({
      label: 'Referencing Field',
      maxLength: 128,
      description: 'Field name on the owning record that holds this file id',
      group: 'Field Reference',
      readonly: true,
    }),

    // [#26046] The record whose field last owned this file, kept when that
    // record lets it go (the ownership columns above are cleared then). A file
    // a record let go is read by that record's rule until a writer who may
    // read it claims it again, or it is collected — never by the weaker rule
    // of a file no record ever held. Cleared by the next claim. NULL on every
    // file no record has let go. Never a holder: the reap guard reads the
    // ownership columns above, not these.
    released_ref_object: Field.text({
      label: 'Released From Object',
      maxLength: 128,
      description: 'Short object name of the record that last owned this file, after it let the file go',
      group: 'Field Reference',
      readonly: true,
    }),

    released_ref_id: Field.text({
      label: 'Released From Record',
      maxLength: 64,
      description: 'Primary key of the record that last owned this file, after it let the file go',
      group: 'Field Reference',
      readonly: true,
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
