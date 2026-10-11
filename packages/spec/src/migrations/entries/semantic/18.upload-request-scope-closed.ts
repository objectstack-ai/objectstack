// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22470 — the upload requests' `scope` (presigned and chunked,
// api/storage.zod.ts) closed from an open string to the new `UploadScope` enum,
// the one list the `sys_file.scope` select is now built from, and the
// `service-storage` upload doors refuse any other value with
// `400 INVALID_REQUEST` naming the allowed values. Semantic only: no metadata
// type carries the upload request, so there is no authored source for a D2
// conversion to rewrite — what moves is caller code, and which scope a file
// belongs under is a judgement only the caller can make. Nothing stored moves:
// no upload naming another scope ever reached a stored file record.
export const entry: SemanticMigration = {
  id: 'upload-request-scope-closed',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span AND a table cell.
  surface:
    'the scope of an upload request, presigned or chunked (GetPresignedUrlRequest.scope and '
    + 'InitiateChunkedUploadRequest.scope) — an open string, now the UploadScope enum',
  replacement:
    'one of the upload scopes `user`, `tenant`, `private`, `temp` or `attachments` (`UploadScope`, '
    + 'exported from `@objectstack/spec/api`), or no scope for the default `user`',
  reason:
    'The upload requests declared scope an open string, while the stored file record only ever took '
    + 'the five values of the scope select of sys_file: any other value was refused by the data engine '
    + 'and answered 500 INTERNAL, with a message that sent the operator to restore the data engine. The '
    + 'request, the select and the upload doors now read one list. A literal outside it fails tsc, a '
    + 'parse of either request refuses it on the scope key, and both upload doors answer it with 400 '
    + 'INVALID_REQUEST naming the allowed values, before a file record, an upload URL or a backend '
    + 'upload exists. A scope is the lifecycle a file is filed under, not a free folder name, so a '
    + 'caller that sent one as a key prefix (avatars, logos, a record path) owes a choice no rewrite '
    + 'can make: `attachments` only for a file whose referrers are record attachment rows, since that '
    + 'scope is what orphan tombstoning reads; `temp` for a scratch file; otherwise `user` or `tenant`. '
    + 'No stored file record moves: no upload naming another scope ever succeeded.',
  acceptanceCriteria:
    'Every upload call names one of the five upload scopes or none, and is answered 200; a caller '
    + 'that passes a scope through types it as UploadScope and compiles. An upload naming any other '
    + 'scope is answered 400 INVALID_REQUEST naming the five, and creates no sys_file record.',
};
