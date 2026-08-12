// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * System Upload Session Object
 *
 * Persisted state for in-flight chunked / multipart uploads.
 *
 * Tracks upload progress so that interrupted uploads can be resumed via
 * `POST /api/v1/storage/upload/chunked/:uploadId/progress`. Sessions are
 * cleaned up by the storage service on `complete` / `abort` / TTL expiry.
 */
export const SystemUploadSession = ObjectSchema.create({
  name: 'sys_upload_session',
  label: 'System Upload Session',
  pluralLabel: 'System Upload Sessions',
  icon: 'upload-cloud',
  description: 'Resumable multipart upload sessions tracked by service-storage',
  nameField: 'filename', // [ADR-0079] canonical primary-title pointer (single-field titleFormat)
  titleFormat: '{filename}',
  highlightFields: ['filename', 'status', 'uploaded_chunks', 'total_chunks', 'expires_at'],

  fields: {
    id: Field.text({
      label: 'Upload Session ID',
      required: true,
      readonly: true,
    }),

    file_id: Field.text({
      label: 'File ID',
      required: true,
    }),

    key: Field.text({
      label: 'Storage Key',
      required: true,
    }),

    filename: Field.text({
      label: 'Filename',
      required: true,
    }),

    mime_type: Field.text({
      label: 'MIME Type',
    }),

    total_size: Field.number({
      label: 'Total Size (bytes)',
      required: true,
    }),

    chunk_size: Field.number({
      label: 'Chunk Size (bytes)',
      required: true,
    }),

    total_chunks: Field.number({
      label: 'Total Chunks',
      required: true,
    }),

    uploaded_chunks: Field.number({
      label: 'Uploaded Chunks',
    }),

    uploaded_size: Field.number({
      label: 'Uploaded Size (bytes)',
    }),

    parts: Field.text({
      label: 'Uploaded Parts (JSON)',
    }),

    resume_token: Field.text({
      label: 'Resume Token',
    }),

    backend_upload_id: Field.text({
      label: 'Backend Upload ID',
    }),

    scope: Field.text({
      label: 'Scope',
    }),

    bucket: Field.text({
      label: 'Bucket',
    }),

    metadata: Field.text({
      label: 'Metadata (JSON)',
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'In Progress', value: 'in_progress' },
        { label: 'Completing', value: 'completing' },
        { label: 'Completed', value: 'completed' },
        { label: 'Failed', value: 'failed' },
        { label: 'Expired', value: 'expired' },
      ],
    }),

    started_at: Field.datetime({
      label: 'Started At',
    }),

    expires_at: Field.datetime({
      label: 'Expires At',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
    }),
  },

  // ADR-0057 (#2970 item 4): an upload session is ephemeral state, never
  // business truth — completed, failed, expired, and abandoned in-progress
  // sessions would otherwise accumulate forever (the sys_file reaper in
  // #2755 covers files, not sessions). The TTL reaps any row 1d past its own
  // `expires_at` (abandoned in-progress sessions included); the retention
  // backstop reaps terminal-status rows by age even if `expires_at` was
  // never set.
  //
  // Every status this clause names is one the service actually writes (#7667):
  // `completed` on a finished assembly, `failed` when the backend completion
  // throws, `expired` when a route is handed a session past its own
  // `expires_at` — all three in `storage-routes.ts`. Until #7667 the last two
  // had NO producer, so this rule reaped on two states the system could never
  // enter and `completed` was the only member doing any work. Adding a member
  // here without a writer re-opens exactly that hole (ADR-0049).
  //
  // NOTE: this reaps the session ROW only — a reap guard that
  // aborts the backend multipart upload for partial S3 sessions is a filed
  // follow-up (row reap is the declared scope of this item).
  lifecycle: {
    class: 'transient',
    ttl: { field: 'expires_at', expireAfter: '1d' },
    retention: { maxAge: '7d', onlyWhen: { status: { $in: ['completed', 'failed', 'expired'] } } },
  },
});
