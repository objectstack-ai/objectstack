// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

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

    scope: Field.select({
      label: 'Scope',
      options: [
        { label: 'User', value: 'user' },
        { label: 'Tenant', value: 'tenant' },
        { label: 'Public', value: 'public' },
        { label: 'Private', value: 'private' },
        { label: 'Temp', value: 'temp' },
        // Files uploaded through the generic Attachments surface (#2727).
        // Their only legitimate referrers are sys_attachment join rows, so
        // this scope is the discriminator for orphan tombstoning (#2755) —
        // field-attachment scopes above are never tombstoned.
        { label: 'Attachments', value: 'attachments' },
      ],
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
