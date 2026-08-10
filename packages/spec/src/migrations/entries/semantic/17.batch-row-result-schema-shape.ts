// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'batch-row-result-schema-shape',
  surface:
    'api.batchOperationResult — the per-row `results` entries of BatchUpdateResponse '
    + '(`POST /data/:object/batch`, `/updateMany`, `/deleteMany`)',
  replacement:
    '`errors: ApiError[]` (was `error: string` — read `row.errors?.[0]?.message`, branch on '
    + '`row.errors?.[0]?.code`), `data` (was `record`), and `index` (new — the row\'s position '
    + 'in the request array)',
  reason:
    'The rows the three bulk-write endpoints emitted had drifted from the schema that '
    + 'declared them: `BatchOperationResultSchema`, the client SDK\'s exported '
    + '`BatchOperationResult` type and the reference docs all said `errors: ApiError[]` / '
    + '`data` / `index`, while the wire carried `error: string` / `record` and never sent '
    + '`index` at all. A TypeScript consumer written against the published type compiled, '
    + 'validated and read `undefined` at runtime — the declared-but-not-delivered shape this '
    + 'registry exists to close, on the response envelope (ADR-0119 D4 deferred the '
    + 'reconciliation off a bug fix; this is that tracked change, shipped in the 17 major '
    + 'window). The ADR-0119/#4620 rollback marking is structured in the same move: the '
    + '`ROLLED_BACK:` / `NOT_ATTEMPTED:` message-string prefixes become registered '
    + '`ApiError.code` values (message keeps the human-readable cause and causal row index), '
    + 'so "attempted and undone" vs "never ran" is machine-readable instead of a regex '
    + 'convention. A RESPONSE surface — nothing stored in stack metadata carries a batch '
    + 'row, so there is no source for the chain to rewrite; consumers of the legacy keys '
    + 'move their reads themselves. Off-contract readers only: the legacy keys were never '
    + 'in the schema or the SDK types, so a typed consumer needs no change. #4793.',
  acceptanceCriteria:
    'No consumer reads `row.error` or `row.record` on a batch result row; failures are read '
    + 'from `row.errors` (message via `errors[0].message`, rollback state via '
    + '`errors[0].code` — ROLLED_BACK / NOT_ATTEMPTED), records from `row.data`, and rows '
    + 'correlate to the request via `row.index`. Every row the three endpoints emit parses '
    + 'under `BatchOperationResultSchema` with those keys present.',
};
