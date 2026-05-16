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
 * Belongs to `@objectstack/service-storage` per the
 * "protocol + service ownership" pattern used by `service-feed`.
 */
export const SystemFile = ObjectSchema.create({
  name: 'sys_file',
  label: 'System File',
  pluralLabel: 'System Files',
  icon: 'file',
  description: 'Storage service file metadata (fileId ↔ key mapping)',
  titleFormat: '{name}',
  compactLayout: ['name', 'mime_type', 'size', 'status', 'created_at'],

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
  },
});
