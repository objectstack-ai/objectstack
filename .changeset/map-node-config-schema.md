---
"@objectstack/service-automation": patch
---

feat(automation): publish a configSchema for the `map` node (flow designer parity, #3304)

The `map` (sequential multi-instance) node shipped no `configSchema`, so the flow
designer fell back to its hardcoded field group online and to raw Advanced-JSON
where that wasn't present. Its descriptor now carries a structured `configSchema`
that mirrors the objectui hardcoded `map` field group field-for-field —
`collection` (marked `xExpression: 'template'`, an `interpolate()` `{items}`
template, same as `loop.collection`), `flowName` + `itemObject` as typed
references (`xRef`), and `iteratorVariable` / `outputVariable` as plain text — so
the online (schema-driven) and offline forms match.

`map` is the one previously-schemaless flow node whose fields are all scalars and
typed references, so it maps cleanly through objectui's `jsonSchemaToFlowFields`
with zero regression. The remaining schemaless nodes lean on editor kinds the
schema→fields adapter does not yet reproduce (`keyValue` maps, the decision
virtual `target` column, `wait`'s top-level block), and are deferred to #3304
until that adapter is extended. Additive and backward-compatible: no runtime
behavior change; an older designer that ignores the schema is unaffected.
