// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'data-engine-rpc-protocol-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the Virtual ObjectQL request protocol in data/data-engine.zod.ts, retired whole: '
    + 'DataEngineRequestSchema and its nine arms (DataEngineFindRequestSchema, '
    + 'DataEngineFindOneRequestSchema, DataEngineInsertRequestSchema, DataEngineUpdateRequestSchema, '
    + 'DataEngineDeleteRequestSchema, DataEngineCountRequestSchema, DataEngineAggregateRequestSchema, '
    + 'DataEngineExecuteRequestSchema, DataEngineVectorFindRequestSchema), DataEngineContractSchema, '
    + 'the types DataEngineRequest, DataEngineRequestParsed, DataEngineExecuteRequest, '
    + 'DataEngineInsertRequest and DataEngineVectorFindRequest, and the ten published defs '
    + 'data/DataEngineRequest and data/DataEngine{Find,FindOne,Insert,Update,Delete,Count,Aggregate,'
    + 'Execute,VectorFind}Request',
  replacement:
    'call the engine through the doors that exist. In process, call `IDataEngine` '
    + '(`@objectstack/spec/contracts`) with the `Engine*OptionsSchema` option bags, which stay; a '
    + 'hook or action body uses `ctx.api.object(name).find(...)` and its siblings. Over the wire, '
    + 'use the REST data routes (`/data/:object`, `POST /data/:object/query`) or the metadata '
    + 'protocol behind them, and `POST {basePath}/batch` (`CrossObjectBatchRequestSchema` / '
    + '`BatchUpdateRequestSchema`) for a batch. `DataEngineContractSchema` has no replacement '
    + 'schema: the engine contract is the `IDataEngine` interface, which the compiler holds every '
    + 'engine to',
  reason:
    'ADR-0049 enforce-or-remove, by the maintainer\'s ruling A on the decision card for this '
    + 'protocol (2026-10-28): retire it rather than keep it as a planned contract. The block '
    + 'described a serialized engine call for a "Virtual Data Engine" in another process (HTTP, '
    + 'a message queue or a plugin boundary). No such engine existed and nothing parsed the '
    + 'protocol: a census on objectstack `1287b2fa` found no importer or parser outside '
    + '`packages/spec/src/data/` (generated ledgers, reference docs and changelogs aside), and '
    + 'hotcrm `353dace`, objectui `b2c0ade` and docs.objectos.ai `cab35fd` returned zero hits '
    + 'against controls of 311, 2095 and 74 files importing `@objectstack/spec`. The one real '
    + 'boundary engine calls cross, the QuickJS hook and action sandbox, speaks '
    + '`ctx.api.object(name)` and parses no request schema. As published the protocol was also '
    + 'unsafe to implement: every arm admitted a caller-supplied `context` (`isSystem` included) '
    + 'and the `execute` arm carried a raw driver command, so enforcing it would first have '
    + 'meant narrowing it and building a second data door beside REST, batch, MCP and the '
    + 'sandbox. `DataEngineContractSchema` restated the engine methods as `z.function()` '
    + 'members, emitted no JSON Schema, and had drifted from `IDataEngine` (no trailing read '
    + 'options, no `vectorFind`, no `execute`). Why D3 semantic and not a D2 conversion: no '
    + 'metadata source authors these shapes, so a conversion has no seam that runs, and with '
    + 'no parse to reach there is no shape a `retiredKey()` tombstone could sit on (the '
    + '`data-engine-batch-retired` precedent, ADR-0119 D3). Third-party npm consumers are '
    + 'UNMEASURED.',
  acceptanceCriteria:
    'No code imports DataEngineRequestSchema, any of its nine arm schemas, '
    + 'DataEngineContractSchema or the types DataEngineRequest, DataEngineRequestParsed, '
    + 'DataEngineExecuteRequest, DataEngineInsertRequest or DataEngineVectorFindRequest from '
    + '@objectstack/spec or @objectstack/spec/data: every such import is TS2305 after upgrade. '
    + 'No tool reads `json-schema/data/DataEngine*Request.json` from the package: the ten defs '
    + 'are absent from `json-schema.manifest/data.json`, the api-surface / declaration-map / '
    + 'export-origins shards and the generated reference docs. `IDataEngine`, every '
    + '`*OptionsSchema`, `RPC_QUERY_ALIAS_SLOTS` and the query-transport schemas are '
    + 'unaffected. ⚠️ Runtime behaviour is deliberately UNCHANGED and must be verified as such: '
    + 'nothing ever parsed these shapes, so removing them removes no behaviour.',
};
