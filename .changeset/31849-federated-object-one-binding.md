---
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-sharing': patch
'@objectstack/cli': patch
'@objectstack/service-analytics': patch
'@objectstack/trigger-schedule': patch
'@objectstack/metadata-protocol': patch
---

refactor: "is this object federated (ADR-0015 `external`)?" has one runtime binding, and it reads the spec predicate

Clause-②: no
Metadata-protocol: none

`@objectstack/core`'s `isFederatedObject` now returns `!platformProvisionsStorage(schema)` from `@objectstack/spec/data`, the one spelling of that question. `@objectstack/plugin-security` and `@objectstack/plugin-sharing` re-export core's binding from `federated-phantom-anchors.ts` instead of holding their own copies, so every existing import keeps resolving. The remaining hand-written copies of the `external` presence test now ask the same binding: the objectql search companion gate, `os migrate` (unmapped columns, the drift pass and the managed-drift coverage), the analytics federation gate (ADR-0062 D6), the schedule trigger's inert-scope bind line and the save door's datasource-binding read. Behaviour is unchanged on every object record and on `null`, `undefined`, arrays and primitives.
