---
'@objectstack/spec': minor
'@objectstack/objectql': patch
---

feat(spec)!: retire the unserved Virtual ObjectQL request protocol from `data/data-engine.zod.ts`

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered data-engine-rpc-protocol-retired -->

**BREAKING** for TypeScript and JSON Schema consumers of one block that nothing ever served. `@objectstack/spec/data` published a serialized request protocol for a "Virtual Data Engine" in another process: `DataEngineRequestSchema` and its nine `method` arms, plus `DataEngineContractSchema`. No such engine existed and nothing parsed the protocol. A census found no importer or parser in this repo outside the defining module, and zero hits in hotcrm, objectui and docs.objectos.ai. As published it was also unsafe to implement: every arm admitted a caller-supplied `context` (`isSystem` included), and the `execute` arm carried a raw driver command. The whole block is retired (ADR-0049 enforce-or-remove, by the maintainer's ruling A).

| FROM | TO |
|:--|:--|
| `DataEngineFindRequestSchema`, `DataEngineFindOneRequestSchema`, `DataEngineCountRequestSchema`, `DataEngineAggregateRequestSchema` | in process, `IDataEngine.find` / `findOne` / `count` / `aggregate` with `EngineQueryOptions` / `EngineCountOptions` / `EngineAggregateOptions`; over the wire, the REST data routes (`/data/:object`, `POST /data/:object/query`) |
| `DataEngineInsertRequestSchema`, `DataEngineUpdateRequestSchema`, `DataEngineDeleteRequestSchema` | `IDataEngine.insert` / `update` / `delete` with `DataEngineInsertOptions` / `EngineUpdateOptions` / `EngineDeleteOptions`; over the wire, the REST data routes, and `POST {basePath}/batch` for a batch |
| `DataEngineVectorFindRequestSchema`, `DataEngineExecuteRequestSchema` | `IDataEngine.vectorFind?` / `execute?`, in process only |
| `DataEngineRequestSchema` and the types `DataEngineRequest`, `DataEngineRequestParsed`, `DataEngineExecuteRequest`, `DataEngineInsertRequest`, `DataEngineVectorFindRequest` | none: there is no serialized engine-call protocol; call `IDataEngine` in process, or a hook or action body's `ctx.api.object(name)` |
| `DataEngineContractSchema` | the `IDataEngine` interface (`@objectstack/spec/contracts`) |

The one-line fix: replace an import of any name above with the `IDataEngine` method or option type in the right-hand column. An import left behind is `TS2305` after upgrade.

The retirement kit:

- **`@objectstack/spec`**: the ten request schemas, `DataEngineContractSchema`, the five types and their private helpers (`RpcQueryOptionsSchema` and the `filter`-only fold) are deleted. The ten published defs `data/DataEngineRequest` and `data/DataEngine{Find,FindOne,Insert,Update,Delete,Count,Aggregate,Execute,VectorFind}Request` leave `json-schema/` and the reference docs, registered in `RETIRED_DEFS_BY_MAJOR[18]`, and the D3 entry `data-engine-rpc-protocol-retired` names the doors that exist. There is no `retiredKey()` tombstone and no conversion: no metadata source authors these shapes, and no parse remains for a prescription to reach. `IDataEngine`, every `*OptionsSchema`, `RPC_QUERY_ALIAS_SLOTS`, `foldQueryAliasSlots` and the query-transport schemas are unchanged. Runtime behaviour is unchanged.
- **`@objectstack/objectql`**: a comment that named `RpcQueryOptionsSchema` now names `QueryWithTransportSchema`. No behaviour changes.
