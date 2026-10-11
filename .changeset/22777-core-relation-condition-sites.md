---
'@objectstack/core': minor
'@objectstack/metadata-protocol': patch
---

feat(core): export `relationConditionSites`, the one walk that finds a filter's nested-relation conditions and each one's target object (#22777)

`relationConditionSites(fields, filter)` returns every `{ <lookup>: { <field of the related object>: … } }` condition a filter holds, at the top level and under `$and` / `$or` / `$not`, with the reference field, the target object (resolved by the spec's `referenceTargetOf`) and the condition. An id comparand, an operator bag and a non-reference field are not conditions.

It moved unchanged from `@objectstack/metadata-protocol`, where it was module-private, so that the MCP stdio data bridge (`@objectstack/mcp`) and the generic data door ask each condition's target its exposure over the same sites. `@objectstack/metadata-protocol` now imports it; its behaviour does not change.
