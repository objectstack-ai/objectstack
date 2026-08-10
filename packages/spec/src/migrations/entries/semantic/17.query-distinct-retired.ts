// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'query-distinct-retired',
  surface: 'data.query.distinct',
  replacement:
    '`groupBy` for unique combinations; the `count_distinct` aggregation for deduplicated '
    + "counts; the SQL/memory drivers' `distinct(object, field)` door for one column's values",
  reason:
    'The `distinct` flag promised SELECT DISTINCT and no driver ever rendered it — but it '
    + 'was MIS-WIRED rather than merely dead (the harsher ADR-0078 class): the REST list '
    + 'path treated a distinct query as not countable and silently degraded '
    + '`total`/`hasMore` to a page-local estimate, so the caller got duplicate rows AND '
    + 'worse pagination metadata, and a side effect that "confirmed" the flag was doing '
    + 'something. It had a shipped public producer (`QueryBuilder.distinct()`, removed with '
    + 'the key). The count suppression is deleted in the same change — `total` is truthful '
    + 'for those queries again. A REQUEST surface, never stored; nothing to rewrite. '
    + 'ADR-0049 / ADR-0078, #4286.',
  acceptanceCriteria:
    'No caller sends `distinct` and no SDK call site uses `QueryBuilder.distinct()`; '
    + 'deduplication goes through `groupBy` / `count_distinct` / the drivers\' `distinct()` '
    + 'door. A query still carrying the key fails to parse with the removal prescription, '
    + 'and the REST list response reports a real `total` for queries that used to send it.',
};
