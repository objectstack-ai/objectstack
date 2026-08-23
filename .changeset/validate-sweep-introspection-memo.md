---
'@objectstack/service-datasource': patch
'@objectstack/spec': patch
---

`validateAll`/`validateDatasource` now read each datasource's live schema once per sweep instead of once per federated object: the sweep threads a per-call introspection memo through the validation body, so M objects on one datasource cost one remote introspection round-trip (a rejected read is shared the same way — one connection attempt, M failure rows). The memo lives and dies inside a single call, so a long-lived service never serves a stale schema to a later sweep, and direct `validateObject` calls still read live every time. The `IExternalDatasourceService.validateAll` docstring, which promised "parallelised per datasource" while the implementation parallelised per object, now states the actual behaviour.
