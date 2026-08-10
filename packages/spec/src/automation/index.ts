// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.


export * from './flow.zod';
export * from './region-slots';
export * from './control-flow.zod';
export * from './io-node-config.zod';
export * from './builtin-node-config.zod';
export * from './schemaless-node-config.zod';
export * from './flow-function.zod';
export { flowForm } from './flow.form';
export * from './execution.zod';
export * from './webhook.zod';
export * from './approval.zod';
// `etl.zod.ts` (L2 "ETL Pipeline": ETLPipeline, ETLPipelineRun, their
// source/destination/transformation vocabulary, the ETLEndpointType /
// ETLTransformationType / ETLSyncMode / ETLRunStatus enums and the `ETL`
// factory) was removed here (#6414, ADR-0049 enforce-or-remove, protocol 17).
// The reading is the one #4738 used to retire L1 one layer up, re-measured on
// L2 and identical: narrative-only. No engine ever parsed, scheduled or ran an
// ETLPipeline; the schema had zero importers across objectstack, objectui and
// cloud outside spec's own tests, no `liveness/` ledger row (the neighbouring
// `mapping.json` exists precisely because import mapping's `transform` IS
// executed row by row), and no def reachable from a metadata-type root.
// Layer-by-layer, that leaves ONE surviving sync layer rather than a gap:
// connector-attached sync is `ConnectorSchema.syncConfig`
// (integration/connector.zod.ts), the live parse path. Per-field value
// transformation at import is `shared/mapping.zod.ts`. Multi-source, multi-stage
// movement has no protocol surface at all now — deliberately, because it had no
// executor: it returns through the ENFORCE route, engine first, vocabulary
// second. `packages/spec/docs/SYNC_ARCHITECTURE.md` was rewritten in the same
// change; a doc that still recommended L2 as L1's destination would have made
// the retirement self-contradictory.
// `trigger-registry.zod` was removed here (#4499). Despite the filename it
// contained no trigger registry — all 630 lines were a third declaration of
// the connector vocabulary (ConnectorSchema, Authentication*, Operation*,
// ConnectorInstance…), self-contained and read by nothing: the automation
// engine registers connectors against `integration/connector.zod.ts`
// (ADR-0097), and the stack `connectors:` collection parses
// DeclarativeConnectorEntrySchema. One capability, one contract
// (Prime Directive #12); the #4480 template cluster fell the same way.
export * from './time-relative-trigger.zod';
// `sync.zod.ts` (L1 "Simple Sync": DataSyncConfig, its ConflictResolution enum
// and the Sync factory) was removed here (#4738, ledger #4535 C13+C15). The L1
// layer was narrative-only — zero importers across objectstack / cloud /
// objectui, no engine ever parsed or executed a DataSyncConfig, and the def was
// unreachable from the metadata-type roots (#4650 gate). Connector-attached
// sync config is `ConnectorSchema.syncConfig` (integration/connector.zod.ts,
// the live parse path). ⚠️ This note used to send readers on to `etl.zod.ts`
// for multi-step transformation; L2 was retired for the same narrative-only
// reason at #6414, so that pointer is gone rather than re-aimed — there is no
// third layer to forward to. The bare
// `ConflictResolution` name went to `@objectstack/spec/ui` (offline sync) at
// #4738 — and left the package entirely at #4988, which retired
// `ui/offline.zod.ts` under ADR-0049. The connector vocabulary keeps its
// `ConnectorConflictResolution` name; a freed word is not a reason to rename
// back, and no domain may re-adopt the bare one (pinned in
// `sync-retirement.test.ts`).
export * from './state-machine.zod';
export * from './node-executor.zod';
export * from './flow-node-expression-paths';
export * from './bpmn-interop.zod';
export * from './bpmn-mapping';
