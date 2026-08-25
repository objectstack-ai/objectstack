---
'@objectstack/objectql': patch
---

`ObjectQL.introspectDatasource()` declares its real return type — the spec's `IntrospectedSchema` (the new `IDataEngine.introspectDatasource?` contract member) — instead of an untyped `Promise<unknown>`, and the driver lookup inside it drops its `as any` now that `IDataDriver` declares `introspectSchema?`. Type-level only; runtime behaviour is byte-identical (#11493).
