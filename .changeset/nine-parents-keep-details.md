---
'@objectstack/spec': minor
'@objectstack/objectql': minor
---

`FieldSchema` now rejects an authored `deleteBehavior: 'set_null'` on a `master_detail` field at parse time (#9689). The engine has always resolved every value except `restrict` on that type to `cascade`, so the declaration asked for the child rows to be kept and got them deleted — silently, at the moment the parent went away. The rejection names the outcome and both legal re-declarations (`restrict` refuses the parent delete while children exist — no data loss; `cascade`, or omitting the key, accepts the cascade deliberately; a `lookup` is the type to use when children must survive the parent).

Mechanism (the #7918 Option A shape): the property-level `.default('set_null')` moved off `deleteBehavior` into a post-check `.overwrite()`, so the schema can tell an authored `set_null` from a defaulted one. Parse output is byte-identical to before on every accepted input — a bare `master_detail` still materializes `deleteBehavior: 'set_null'` at its shape position, non-reference types still carry the default, and `set_null` on `lookup` stays legal. The inferred `Field` output type now declares `deleteBehavior` as optional (the same accepted cost as the currency `precision` relocation); a parsed field always carries it at runtime.

There is deliberately no automatic conversion (`field-master-detail-set-null-refused` in the migration registry): only the author knows whether they meant `restrict` (keep-my-children, as a refusal) or `cascade`. Stored rows carrying the refused combination keep loading and serving — registry validation is a diagnostic, not a gate — and are refused on their next authoring-path save.

`@objectstack/objectql`: the engine behavior is unchanged (an authored `set_null` on `master_detail` still cascades — the #9625 pin holds), but the coercion site now logs loudly (`error`, falling back to `warn`) when the combination reaches it via a raw registration or a pre-tightening stored row — the two populations parse-time rejection cannot catch.
