// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22443 (ADR-0049 enforce-or-remove) — `public` left `StorageScope`
// (`enumWithRetiredValues`, system/object-storage.zod.ts), and the
// `service-storage` upload doors refuse an upload naming that scope with
// `400 INVALID_REQUEST`. Semantic only: no metadata type carries either
// surface, so there is no authored source for a D2 conversion to rewrite —
// what moves is caller code and the intent behind it, which only the caller
// can judge.
export const entry: SemanticMigration = {
  id: 'storage-scope-public-retired',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span AND a table cell.
  surface:
    'the storage scope public — the scope of an upload request, presigned or chunked, and '
    + 'ObjectStorageConfig.scope (StorageScope)',
  replacement:
    'another scope, or none for the default (`user` on an upload, `global` on a storage '
    + "configuration), and `acl: 'public_read'` on the stored file record of each file that must "
    + 'be readable before sign-in (ADR-0104)',
  reason:
    'A storage scope never made a file publicly readable. The download doors judge a file by its '
    + '`acl`, the `attachments` scope and field ownership alone, so a file uploaded with scope public '
    + 'and the default acl was stored private and needs a signed-in caller, while its scope said '
    + 'otherwise. The value is retired rather than enforced: enforcing it would let any uploader make '
    + "a file anonymous at upload, and ADR-0104 keeps `acl: 'public_read'` the one opt-in for "
    + 'anonymous download. Whether a given file must be readable before sign-in is the caller\'s '
    + 'call, so no rewrite can make it: an upload that meant public needs its stored file record '
    + 'marked, and one that did not needs only another scope. The upload request itself carries no '
    + 'acl, and every upload is stored private. Files already stored with scope public are not '
    + 'touched and download exactly as before. ADR-0049',
  acceptanceCriteria:
    'No upload call names scope public and no ObjectStorageConfig declares it; each upload that did '
    + 'now names another scope or none and is answered 200. Each file that must render before '
    + "sign-in has acl 'public_read' on its stored file record, and fetching it with no session "
    + 'serves it; fetching any other uploaded file with no session is answered 401.',
};
