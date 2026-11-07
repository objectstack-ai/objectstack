---
'@object-ui/types': patch
---

refactor(types)!: delete `SubqueryNode` and the filter builder configuration pair nothing reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/types#SubqueryNode, @object-ui/types#FilterBuilderConfig, @object-ui/types#FilterFieldConfig) the retired operands are TypeScript-only interfaces declared in `data-protocol.ts`: a query-AST subquery node and a filter builder configuration pair that no query builder, renderer, adapter or host constructs or reads; nothing in the workspace or in hotcrm imports any of them from the package entry, they have no zod twin, they are not arms of `AnySchema`, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these three types from `@object-ui/types`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected.

They are **gone from the package, not only from the entry**: `src/data-protocol.ts` no longer declares them. They were types only, so the built JavaScript is unchanged. The other query-AST node types (`SelectNode`, `OffsetNode`, `AggregateNode`, …), `DateRangeFilter` and `FilterBuilderDateRangePreset` stay exported unchanged.

What leaves, and what to write instead:

- FROM `SubqueryNode` TO no replacement in this package. Nothing built or read a subquery node; a host that kept one declares it locally on top of `QueryASTNode` and `SqlQueryAST`, which stay.
- FROM `FilterBuilderConfig` TO no replacement. No filter builder read this configuration; a host that kept one declares it locally.
- FROM `FilterFieldConfig` TO no replacement. It was only the `fields` item of `FilterBuilderConfig`; a host that kept one declares it locally (`AdvancedFilterOperator`, which typed its `operators`, stays).
