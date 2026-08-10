// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'data-engine-batch-retired',
  surface: 'contracts.IDataEngine.batch / data.DataEngineBatchRequestSchema',
  replacement:
    '`IObjectQLEngine.transaction(cb)` for in-process multi-write atomicity; the metadata '
    + "protocol's `batchData` with `options.atomic: true` for a batch over one object; "
    + '`POST {basePath}/batch` on the wire',
  reason:
    '`batch?` was declared on `IDataEngine` for as long as that contract existed and was '
    + 'never implemented by any engine: `ObjectQL` has no `batch` method and there is no '
    + 'other engine in the tree. It also had no caller — `DataEngineRequest` was imported '
    + 'by exactly one file, the contract declaring the member. Its entire specification '
    + 'was a three-word doc comment ("Batch Operations (Transactional)"), which settles '
    + 'nothing about partial failure, ordering, cross-object references, rollback scope, '
    + 'or what `transaction: false` was supposed to mean — the questions a batch API '
    + 'exists to answer. Contrast its neighbours `getDefaultDriverName?` / '
    + '`getDriverByName?`, whose optionality is evidenced: each names its implementer and '
    + 'its probing caller. The tell that nobody ever designed against it is in the schema: '
    + '`DataEngineBatchRequestSchema.requests` nested the request union RECURSIVELY, so a '
    + 'batch could contain batches, with no statement anywhere about what that meant for '
    + 'ordering or rollback. The only test was a type pin — an ad-hoc object literal '
    + 'carrying a `batch` property, asserting the property was defined — which could not '
    + "fail while the declaration existed and would have passed unchanged for the "
    + "member's whole life with no engine implementing it. What it claimed is now covered "
    + 'by members that are real, so the removal deletes a false affordance rather than a '
    + 'capability: ADR-0119 D1 made `transaction` reachable through the contract and D4 '
    + "made `batchData`'s `atomic` honest, while the wire batch has always validated with "
    + '`CrossObjectBatchRequestSchema` / `BatchUpdateRequestSchema` from '
    + '`api/batch.zod.ts` — a different schema entirely, untouched here. TS/API surfaces '
    + 'only: an engine is CODE, never stack metadata, so there is no source for the chain '
    + 'to rewrite. Deliberately no schema tombstone either — nothing ever parsed '
    + '`DataEngineBatchRequestSchema`, so a `retiredKey()` prescription would have no one '
    + 'to reach; its three `authorable-surface.json` baseline lines and its '
    + '`json-schema.manifest.json` entry are dropped in the same change, deliberately. '
    + 'The enforced channel is tsc. ADR-0049 / ADR-0078, #4618.',
  acceptanceCriteria:
    'No code calls `engine.batch(...)` and no type references `DataEngineBatchRequest`; '
    + 'in-process multi-write atomicity goes through `IObjectQLEngine.transaction(cb)`, a '
    + 'batch over one object through `batchData` with `options.atomic: true`, and a '
    + 'cross-object batch over the wire through `POST {basePath}/batch`. Because no engine '
    + 'implemented the member, an implementation left behind still compiles and is simply '
    + 'never reached; a CALLER of it no longer type-checks — and there were none.',
};
