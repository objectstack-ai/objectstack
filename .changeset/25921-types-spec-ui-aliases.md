---
'@object-ui/types': patch
---

refactor(types)!: drop seven `Spec`-prefixed spec/ui type aliases nothing reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/types#SpecDashboardHeader, @object-ui/types#SpecDashboardHeaderAction, @object-ui/types#SpecFormView, @object-ui/types#SpecListColumn, @object-ui/types#SpecPageComponent, @object-ui/types#SpecPageRegion, @object-ui/types#SpecPageVariable) the retired operands are type-only aliases of `@objectstack/spec/ui` types that no renderer, adapter or host reads; nothing in the workspace or in hotcrm imports any of them from the package entry, they are not arms of `AnySchema`, and the spec types they aliased stay exported by `@objectstack/spec/ui` under their own names, so no stored shape, registered node type or conversion surface changes and there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these seven types from `@object-ui/types`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected.

They were type-only re-exports, so the built JavaScript is unchanged; only the entry's `.d.ts` loses them. The other `Spec`-prefixed aliases of the same "v3.0.8 Spec UI Types" section stay, among them `SpecDashboard`, `SpecDashboardWidget`, `SpecGlobalFilter`, `SpecFormSection`, `SpecFormField`, `SpecListView`, `SpecPage` and `SpecPageType`.

What leaves, and what to write instead (each one the same type under its upstream name):

- FROM `SpecDashboardHeader` TO `DashboardHeader` from `@objectstack/spec/ui`.
- FROM `SpecDashboardHeaderAction` TO `DashboardHeaderAction` from `@objectstack/spec/ui`.
- FROM `SpecFormView` TO `FormView` from `@objectstack/spec/ui`.
- FROM `SpecListColumn` TO `ListColumn` from `@objectstack/spec/ui`.
- FROM `SpecPageComponent` TO `PageComponent` from `@objectstack/spec/ui`.
- FROM `SpecPageRegion` TO `PageRegion` from `@objectstack/spec/ui`.
- FROM `SpecPageVariable` TO `PageVariable` from `@objectstack/spec/ui`.

One-line fix: `import type { FormView } from '@objectstack/spec/ui'` in place of `import type { SpecFormView } from '@object-ui/types'`, and likewise for the other six.
