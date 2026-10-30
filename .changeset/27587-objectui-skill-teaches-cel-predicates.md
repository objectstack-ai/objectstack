---
'@objectstack/skills': patch
---

docs(skills): objectui teaches CEL for a bare-string predicate, with a FROM → TO list for the JavaScript spellings

Clause-②: no
Metadata-protocol: none

- **Before.** `skills/objectui` taught bare predicates in the legacy JavaScript grammar: `"hidden": "data.status === 'draft'"` in `rules/protocol.md`, `data.status === 'active'` and `data.status !== 'active'` in `guides/schema-expressions.md`, and an operator list (`===`, `!==`, `.includes()`, `.length`) that read as condition syntax. Since #27584 the console reads a bare string in a predicate key as CEL, as the spec defines it and the server reads it, so an agent following the skill wrote a gate that faulted and hid the node.
- **Now.** Every bare-predicate example is CEL. The guide says a bare condition string is CEL on `@objectstack/formula` and that the operator list is the `${…}` template grammar only, and it gives a FROM → TO list measured on the console's evaluator: `===` / `!==` → `==` / `!=`; `list.includes(x)` → `x in list`, `s.includes('x')` → `s.contains('x')`; `list.length` → `size(list)`; a `data.*` key the scope may lack → `has(data.x) && …`, because CEL faults on a missing key. The row-predicate bullet says only a `${…}` condition still reads on the legacy engine. Eval 2 in `evals/schema-expressions.json` hands over a JS-syntax predicate and expects the CEL rewrite.
- No schema, key or behaviour changes.
