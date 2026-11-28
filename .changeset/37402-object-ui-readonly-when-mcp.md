---
'@objectstack/mcp': patch
---

feat(mcp): `describe_object` reports an object's whole-record hand lock (`uiReadonlyWhen`), and its description says how to read it

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

The stdio transport and the `objectstack://objects/{name}` resource answer the object's `uiReadonlyWhen` predicate text at the top level where authored, the twin of the HTTP transport. The tool description names it: while it holds, a person cannot edit any field at the console except one that lists its own `uiReadonlyWhen` (one listing `uiReadonly: true` is locked anyway); an agent's write may still set every field, judged by the validations.
