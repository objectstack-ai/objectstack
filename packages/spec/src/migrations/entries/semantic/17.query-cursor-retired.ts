// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'query-cursor-retired',
  surface: 'data.query.cursor',
  replacement:
    'a `where` predicate on the sort key — `where: { created_at: { $gt: last.created_at } }` '
    + 'with the matching `orderBy` (the documented manual-keyset pattern)',
  reason:
    'The `cursor` key promised keyset pagination and no driver implemented it: the cursor '
    + 'was accepted and ignored, so every page came back identical — a caller looping '
    + '"until hasMore is false" never terminates. Worse than inert, it had a shipped public '
    + 'producer (`QueryBuilder.cursor()`, removed with the key). The caller-built '
    + '`Record<string, unknown>` shape also leaks sort/storage detail and squats on the '
    + 'reserved REST parameter set; a first-class cursor, if ever designed, will be a '
    + 'response-minted opaque token — a different API, so keeping this one preserved a '
    + 'wrong design rather than a roadmap. A REQUEST surface, never stored; nothing to '
    + 'rewrite. ADR-0049 / ADR-0078, #4286.',
  acceptanceCriteria:
    'No caller sends `cursor` and no SDK call site uses `QueryBuilder.cursor()`; deep '
    + 'pagination expresses the keyset as a `where` predicate on the sort key. A query '
    + 'still carrying `cursor` fails to parse with the removal prescription, and authoring '
    + 'it is a `tsc` error.',
};
