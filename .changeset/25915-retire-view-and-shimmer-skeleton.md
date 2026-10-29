---
'@object-ui/components': patch
---

refactor(components)!: retire the unused `ViewSkeleton` dispatcher and `ShimmerSkeleton`

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/components#ViewSkeleton, @object-ui/components#ViewSkeletonVariant, @object-ui/components#ViewSkeletonDispatchProps, @object-ui/components#ShimmerSkeleton, @object-ui/components#ShimmerSkeletonProps) the retired operands are React components and their prop types in a published ui package's entry that nothing in the workspace imported; no packages/spec schema, no registered node type, no ADR-0087 conversion surface and no stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports either component from `@object-ui/components`. Both were published from the package entry and had no importer anywhere in the workspace, so the Console and every `@object-ui/*` package are unaffected. The other skeletons in `view-skeleton.tsx` stay exported unchanged: `GridSkeleton`, `KanbanSkeleton`, `FormSkeleton`, `ListSkeleton`, `ChartSkeleton` and the `ViewSkeletonProps`, `GridSkeletonProps` and `KanbanSkeletonProps` types.

What leaves, and what to write instead:

- FROM `ViewSkeleton` TO the skeleton for the variant you passed: `variant: "grid"` is `GridSkeleton`, `"kanban"` is `KanbanSkeleton`, `"form"` is `FormSkeleton`, `"list"` is `ListSkeleton`, `"chart"` is `ChartSkeleton`, each taking the same remaining props.
- FROM `ViewSkeletonVariant` TO a local union of the variants you render, or no type at all once you call the skeleton components directly.
- FROM `ViewSkeletonDispatchProps` TO `GridSkeletonProps` or `KanbanSkeletonProps` (which carry `columns`; `KanbanSkeletonProps` carries `cardsPerColumn`), or `ViewSkeletonProps` for the others.
- FROM `ShimmerSkeleton` TO `Skeleton` from `@object-ui/components`, or a `div` carrying the `animate-shimmer` utility that `@object-ui/app-shell/styles.css` still declares.
- FROM `ShimmerSkeletonProps` TO `React.HTMLAttributes<HTMLDivElement>`, which it aliased.
