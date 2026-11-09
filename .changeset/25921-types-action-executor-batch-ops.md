---
'@object-ui/types': patch
---

refactor(types)!: delete `ActionExecutor` and the Batch Operations pair nothing reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/types#ActionExecutor, @object-ui/types#BatchOperationConfig, @object-ui/types#BatchOperationSummary) the retired operands are TypeScript-only shapes declared in `ui-action.ts`: a function type for an action executor and a batch-operation config and summary pair that no renderer, adapter or host reads; nothing in the workspace or in hotcrm imports any of them from the package entry, they have no zod twin, they are not arms of `AnySchema`, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these three types from `@object-ui/types`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected.

They are **gone from the package, not only from the entry**: `src/ui-action.ts` no longer declares them. They were types only, so the built JavaScript is unchanged. The "Transaction Support" block beside them stays (`TransactionIsolationLevel`, `TransactionConfig`, `TransactionResult`; `@object-ui/core`'s `TransactionManager` reads them).

What leaves, and what to write instead:

- FROM `ActionExecutor` TO no replacement in this package. Actions run through `@object-ui/core`'s `ActionRunner`, which registers `ActionRunnerHandler` functions; a host that typed its own executor declares that signature locally.
- FROM `BatchOperationConfig` TO no replacement. No renderer or runner read a batch-operation config; a host that kept one declares it locally.
- FROM `BatchOperationSummary` TO no replacement. Nothing produced this summary; a host that kept one declares it locally.
