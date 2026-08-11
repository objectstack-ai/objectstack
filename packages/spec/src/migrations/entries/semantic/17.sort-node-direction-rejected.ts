// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'sort-node-direction-rejected',
  surface: 'data.query.orderBy[].direction (SortNode)',
  replacement:
    '`order` — `orderBy: [{ field: "updated_at", order: "desc" }]`. One word, same values '
    + '(`asc` / `desc`)',
  reason:
    '`SortNodeSchema` was a plain `z.object`, so zod\'s default `.strip` applied and a sort '
    + 'node spelling its direction `direction` lost the key silently. Measured on `main` '
    + 'before the change: `SortNodeSchema.parse({ field: "updated_at", direction: "desc" })` '
    + 'returned `{ field: "updated_at", order: "asc" }` — the key discarded and `order` '
    + 'falling back to its `asc` default, so the sort ran in the OPPOSITE direction and the '
    + 'request succeeded. Paired with `limit`, which is how a caller asks for "the latest N", '
    + 'that is not a reordered page but a DIFFERENT SET OF ROWS, returned under an ordinary '
    + '200 with nothing in the response to distinguish it from the answer that was asked for. '
    + '`direction` is not a typo: it is the live vocabulary of a neighbouring contract, '
    + '`IReportService.orderBy`, and `plugin-auth/objectql-adapter.ts` already translated '
    + 'between the two by hand — a translation known to be necessary and enforced nowhere, '
    + 'the ADR-0049 shape. Both doors closed in one change: `SortNodeSchema` is now a '
    + '`strictObject` carrying `aliases: { direction: "order" }`, and `normalizeSortNodes` '
    + 'in `metadata-protocol` refuses `{ field, direction }` with `400 INVALID_SORT`. The '
    + 'alias is deliberate rather than left to the edit-distance fallback, because no edit '
    + 'distance bridges `direction` → `order` and a bare "unrecognized key" would leave the '
    + 'caller exactly where the silent strip did. This is registered as a semantic entry '
    + 'rather than a mechanical conversion for one reason worth stating: the rewrite itself '
    + 'is trivially mechanical, but a stored `direction: "asc"` is ambiguous evidence — the '
    + 'author may have written it meaning ascending and been silently GIVEN ascending, so '
    + 'the visible behaviour never contradicted them, and only they can say whether the '
    + 'sort they have been reading was the sort they asked for. Registered by the #6350 stock '
    + 'reconciliation: the in-code alias tombstone shipped with #4721, but the ledger half '
    + 'never did, and a retirement needs both — the tombstone is the proof the removal was '
    + 'declared, the ledger entry is what `spec-changes.json`, the upgrade guide and '
    + '`os migrate meta` project to consumers. ADR-0049 / ADR-0087, #4721 (backfilled #6350).',
  acceptanceCriteria:
    'No authored `orderBy` entry — in metadata, in a saved view\'s `sort[]`, or in a REST / '
    + 'RPC request body — spells the key `direction`. The upgrade\'s own verify loop is that '
    + 'the failure is now LOUD: a stale `direction` raises a named parse error (or `400 '
    + 'INVALID_SORT` at ingress) quoting `order`, so a sweep is "fix until nothing raises" '
    + 'rather than a search. ⚠️ Check the RESULTS, not just the parse: every list, report and '
    + 'paged query that carried `direction: "desc"` has been silently serving ASCENDING order '
    + 'and, wherever it was paired with `limit`, a different set of rows. After the rename '
    + 'those pages change what they return — that is the defect being corrected, not a '
    + 'regression, and any downstream expectation baked against the old output has to be '
    + 're-read rather than restored.',
};
