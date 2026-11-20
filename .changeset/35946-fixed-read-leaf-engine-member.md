---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/service-analytics': patch
---

feat: the analytics plugin asks the engine which share-grant scopes its native SQL path may compile (ADR-0155 D4)

Clause-②: yes
Metadata-protocol: none

- **New optional contract member** (`@objectstack/spec`). `IObjectQLEngine.fixedReadLeafClassOf(leaf)` answers which of ADR-0155 D4's two classes a `SharedRecordIds` leaf falls in on an engine: `'other-datasource'` (the leaf's object is bound to another datasource than `sys_record_share`) or `'registration-by-name'` (a middleware or a `beforeFind` / `afterFind` hook is registered for `sys_record_share` by name), with what names it. It answers `undefined` when neither class applies. The answer type is the new `EngineFixedReadLeafClass`. The member is optional: a caller probes `typeof engine.fixedReadLeafClassOf === 'function'` and treats an engine without it as one that cannot say.
- **The engine implements it** (`@objectstack/objectql`). `ObjectQL.fixedReadLeafClassOf` returns the seam's own recognition, `fixedReadLeafClassOfEngine(engine, leaf)`. It reads only datasource bindings, middlewares and hooks. It calls no driver and logs nothing.
- **The analytics plugin wires it** (`@objectstack/service-analytics`). `AnalyticsServicePlugin` now fills `AnalyticsServiceConfig.fixedReadLeafClassOf` from the `"data"` engine on each call. When the engine answers neither class, the native SQL path compiles a read scope that carries the leaf. When the engine names a class, or the engine has no such member, the query goes to the ObjectQL engine path, as before. An engine without the member is reported once at `warn`. Neither class is restated in analytics.

Nothing a metadata author writes changes. On a host that runs `ObjectQLPlugin`'s engine as `"data"`, a sharing-scoped analytics query outside both classes keeps the native SQL path once the producer starts writing the leaf (ADR-0155 step 6).
