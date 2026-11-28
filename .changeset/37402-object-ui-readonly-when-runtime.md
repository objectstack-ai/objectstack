---
'@objectstack/runtime': patch
---

feat(runtime): MCP `describe_object` reports an object's whole-record hand lock (`uiReadonlyWhen`)

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

The HTTP transport's `describe_object` answer carries the object's `uiReadonlyWhen` predicate text at its top level where the object authors one, so an agent acting for a person knows the record cannot be edited by hand and reaches for an action. Never folded into any field's `readonly`: an agent's write still sets every field, judged by the validations.
