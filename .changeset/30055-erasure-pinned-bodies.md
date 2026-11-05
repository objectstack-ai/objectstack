---
'@objectstack/objectql': patch
---

refactor(objectql): the six `ObjectQL` methods the #4918 query-options erasure pin kept in `engine.ts` are typed and move into their facet modules; no behaviour or public declaration changes

Clause-②: no
Metadata-protocol: none

- The six internal reads in `seedAutonumber`, `referenceExists`, `resolveMasterDetailParent`, `resolveMasterDetailParents`, `inspectDanglingReferences` and `probeReferencingRows` no longer erase their query options to `any`: `tsc` now checks each one against `EngineQueryOptions`, and `engine.ts` leaves the erasure baseline with zero sites.
- A new fourth pass of the `engine.ts` codemod, `--members`, moves the six bodies the way the first pass moves a body, into the facet modules it already wrote, and proves the move by undoing it. `engine.ts` goes from 11,771 to 11,316 lines.
- Nothing to do on upgrade: the exported names, the public `.d.ts` declarations and what every method does are the same.
