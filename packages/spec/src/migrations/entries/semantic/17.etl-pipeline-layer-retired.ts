// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'etl-pipeline-layer-retired',
  surface:
    'automation.etlPipeline / automation.etlPipelineRun / automation.etlSource / '
    + 'automation.etlDestination / automation.etlTransformation (the whole L2 layer of '
    + 'automation/etl.zod.ts, its four enums and the `ETL` factory — 9 defs, 27 exported '
    + 'names)',
  replacement:
    '(removed — no protocol surface replaces it, deliberately. Layer by layer: '
    + 'connector-attached synchronisation is `ConnectorSchema.syncConfig` '
    + '(`integration/connector.zod.ts`), which IS parsed and executed; per-field value '
    + 'transformation on import is `shared/mapping.zod.ts`, whose `transform` is applied '
    + 'row by row by the REST import path and recorded key by key in '
    + '`packages/spec/liveness/mapping.json`; scheduling is `system/job.zod.ts`. What has '
    + 'NO replacement is multi-source, multi-stage movement with joins and aggregations — '
    + 'because it never had an implementation either. It returns through the ENFORCE route: '
    + 'the engine first, the vocabulary second)',
  reason:
    'The reading #4738 used to retire L1 `DataSyncConfig`, re-measured one layer up and '
    + 'identical: narrative-only. No engine ever parsed, scheduled or executed an '
    + '`ETLPipeline`. Measured on origin/main immediately before the removal: the only '
    + 'non-spec references in this repo are two fumadocs-generated documentation sources '
    + '(`apps/docs/.source/*.ts`), not executors; objectui has no reference at all; there '
    + 'is no `liveness/etl.json` or `pipeline.json`, so no ADR-0049 gate ever had a reading '
    + 'on it — while the same file family\'s EXECUTED half does have one '
    + '(`liveness/mapping.json`), which is the contrast that makes the absence meaningful '
    + 'rather than an oversight. The `etl` string in this registry was the one untested '
    + 'link the finding named, and it is not a loader path: it was the id of the #4962 '
    + 'retry-vocabulary entry, absorbed here. '
    + 'The layer was ADR-0078\'s asymmetry in its purest form — an author could write a '
    + 'complete ten-stage pipeline, get no error, and get no execution. It was also '
    + 'advertised: `packages/spec/docs/SYNC_ARCHITECTURE.md` named `ETLPipeline` as the '
    + 'recommended destination for authors displaced by the L1 retirement (#4738) and '
    + 'listed ten transformation types with copyable examples down to '
    + '`script | Custom JavaScript/Python`. That document is rewritten in the same change; '
    + 'a retirement whose own doc still recommends the retired layer is self-contradictory, '
    + 'and forwarding L1\'s authors to a second layer with no executor was the defect '
    + 'compounding rather than closing. '
    + '⚠️ `etl-retry-converged-onto-retry-policy` (#4962) is SUBSUMED here, the '
    + '#4657/#4834/#5055 way: both land in the unreleased protocol 17, so composed, a '
    + 'rename of `retry.maxAttempts` on a shape that does not survive the major has no '
    + 'observable effect — and keeping both would tell an upgrader to rewrite a key on a '
    + 'schema the same upgrade deletes. The `maxAttempts` `retiredKey()` tombstone goes '
    + 'with the shape that carried it, which is strictly stronger than the tombstone: there '
    + 'is no longer a `retry` block to author the key into. Route 3 — no carrier key, no '
    + 'parse site, so no D2 conversion and no tombstone; RETIRED_DEFS_BY_MAJOR plus this '
    + 'entry are the declaration. ADR-0049, ADR-0078, #6414.',
  acceptanceCriteria:
    'No source imports `ETLPipeline`, `ETLPipelineParsed`, `ETLPipelineSchema`, '
    + '`ETLPipelineRun(Schema)`, `ETLSource(Schema)`, `ETLDestination(Schema)`, '
    + '`ETLTransformation(Schema)`, `ETLEndpointType(Schema)`, '
    + '`ETLTransformationType(Schema)`, `ETLSyncMode(Schema)`, `ETLRunStatus(Schema)` or '
    + 'the `ETL` factory from `@objectstack/spec/automation`; `tsc` reports TS2724/TS2305 '
    + 'on any that survives. Every author who was pointed at L2 has been re-pointed by '
    + 'name: SYNC_ARCHITECTURE.md no longer lists an L2 row, no longer recommends '
    + '`ETLPipeline` as L1\'s destination and no longer advertises a transformation-type '
    + 'table. The surviving layers still parse unchanged — a connector declaring '
    + '`syncConfig` and an import declaring `mapping.transform` both behave exactly as they '
    + 'did in 16.x.',
};
