---
"@objectstack/spec": minor
"@objectstack/objectql": patch
"@objectstack/core": patch
"@objectstack/runtime": patch
"@objectstack/metadata-protocol": patch
"@objectstack/platform-objects": patch
"@objectstack/plugin-auth": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/plugin-security": patch
---

feat(spec,objectql): `IObjectQLEngine` — the `objectql` slot's contract exists, the class `implements` it, and the seven consumer-local stand-ins are deleted (#4251 B3)

ObjectQL registers one instance under two names, and the ledger can finally say
what each name means: `data` stays `IDataEngine` (the data plane), `objectql`
now resolves to **`IObjectQLEngine`** — the full engine: schema access
(`getSchema` / `getObject` / `registry`), actions (`registerAction` /
`removeActionsByPackage` / `executeAction`), the hook/middleware seams
(`registerHook` / `unregisterHooksByPackage` / `registerFunction` /
`registerMiddleware` / `bindHooks`), the first-wins default runners and hook
metrics, boot wiring (`registerDriver` / `setDatasourceMapping` /
`registerApp`), and the ops probes (`checkDriversHealth` /
`wasDatastoreCreatedFromEmpty` / `invalidateDataMigrationFlags`). The ledger
test pins the new relation: `objectql` strictly widens `data`, deliberately no
longer equal.

**Why now, and why `implements` is the point.** The honest state for two
batches was recorded on `DomainHandlerContext.getObjectQL`: ObjectQL is wider
than `IDataEngine`, the wider part had no contract, and typing it `IDataEngine`
would be "the more comfortable-looking lie". The interim discipline — each
consumer declares the narrow slice it uses — produced seven local surfaces
(`AppEngineSurface`, `EngineRegistrySurface`, `EngineExtensionSurface`,
`SecurityEngineSurface`, `FreshDatastoreEngine`, the dispatcher's inline
`checkDriversHealth` slice, the `getObjectQL: any` itself). Each was honest and
each was an UNCHECKED claim: `getService<Surface>('objectql')` is an assertion,
so an engine rename would have broken every consumer at runtime with zero
compile errors. `ObjectQL implements IObjectQLEngine` converts all of them into
one compiler-verified claim. All seven stand-ins are deleted; consumers import
the one declaration. `getObjectQL` is typed `Promise<IObjectQLEngine | null>`
end to end, closing the oldest documented `any` in the dispatcher.

**Evidence bar unchanged.** Every declared member has a cross-package consumer
reaching it through the slot; engine members without one (e.g. `triggerHooks`,
cross-package only in tests) stay off until a caller appears. The registry view
(`EngineSchemaRegistryView`) declares exactly the eight members consumers use.

**`_registry` never leaves the engine package now.** plugin-security's
declared-metadata readers (`readDeclared`, permission-set projection, suggested
audience bindings) reached ObjectQL's private `_registry` field through `any` —
the same private reach `/me/apps` had in B2, five more times. All migrated to
the public `registry` getter the contract declares, test doubles included.

**`IMetadataService` gains `subscribe?` / `loadMany?`** — implemented by
`MetadataManager` beside `watch` all along, reached through the slot only via
`any` by ObjectQLPlugin's metadata bridge (the re-sync keeping runtime-authored
hooks/actions live). With them declared, the bridge's six `metadata` lookups
and metadata-protocol's `objectql` lookup carry contract types, and both files
leave the grandfather list entirely: baseline **167 → 159 sites, 36 → 34
files**.
