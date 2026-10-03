---
'@objectstack/metadata-protocol': minor
'@objectstack/runtime': patch
---

The in-process reader contexts refuse the stored-metadata-body family's EVALUATE shapes and serve what a write returns, the way the generic data door does (#21454).

Clause-②: yes

- **`@objectstack/metadata-protocol`** now exports the generic data door's four evaluate-refusal predicates — `storedMetadataBodyGroupingRefusal`, `storedMetadataBodyPredicateRefusal`, `storedMetadataHashEvaluateRefusal` and `storedMetadataSearchRefusal` — so the `@objectstack/runtime` reader-context seam refuses the same shapes through the door's own predicates rather than a second copy. Additive: nothing that imported the package before is changed.
- **`@objectstack/runtime`** extends the stored-metadata reader-context seam (`ctx.api.object(...)` for action and hook bodies, a handler's `ctx.api`, and `ctx.engine.find`): a filter, sort, grouping or search that would evaluate the stored body or content hash of `sys_metadata` / `sys_metadata_history` is refused with the door's `INVALID_FIELD` / 400 before the query runs (a `count` with such a predicate included); a default `$search` is narrowed to the door's served field set rather than refused; and the row a write verb returns is served projected and keyed. The engine's own action verb (`ScopedRepo.execute`) is unreachable from a served body and is left untouched.
