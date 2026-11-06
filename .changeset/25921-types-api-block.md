---
'@object-ui/types': patch
---

refactor(types)!: delete the api-types module and its eight names nothing reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/types#HTTPMethod, @object-ui/types#APIRequest, @object-ui/types#APIConfig, @object-ui/types#DataFetchConfig, @object-ui/types#DataFetchableSchema, @object-ui/types#ExpressionContext, @object-ui/types#ExpressionNodeSchema, @object-ui/types#APISchema) the retired operands are TypeScript-only interfaces and unions for a data-fetching and expression-node dialect that no renderer, adapter or host reads; nothing in the workspace or in hotcrm imports any of them from the package entry, they have no zod twin, they are not arms of `AnySchema`, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these eight types from `@object-ui/types`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected.

They are **gone from the package, not only from the entry**: the whole `api-types.ts` module (the entry's "API and Events" block) is deleted. The objectui#6497 tombstone for `UIEventHandler` and `EventableSchema` it carried now stands in the entry where the block was; those two stay retired.

What leaves, and what to write instead:

- FROM `HTTPMethod`, `APIRequest`, `APIConfig`, `DataFetchConfig`, `DataFetchableSchema`, `APISchema` TO no replacement in this package. A component reads data through this package's `DataSource` interface; a host that kept its own request shape declares it locally.
- FROM `ExpressionContext`, `ExpressionNodeSchema` TO no replacement in this package. Expressions are `${…}` strings evaluated by `@object-ui/core`'s `ExpressionEvaluator` against its own `ExpressionContext` class.
