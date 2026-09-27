---
"@objectstack/spec": patch
---

fix(spec): state the row-cap guard `ElementDataSourceGate` implements (#19228)

Prose and pins only — zero accept-set movement, zero export movement. The same documents parse
to the same values before and after. ⛔ No `.default()` moves.

## What the published text said, and what an author can actually reach

`ObjectKanbanPropsSchema.limit` tells authors that a bound view's `pagination.pageSize` fills it
「only when unset」. Measured first-hand at the objectui pin this repo builds against
(`.objectui-sha` = `87af769e9`), that sentence is exactly right for this face, and the describe
now says WHY rather than leaving it to look narrower than the mechanism.

The gate's branch is `if (!fromView || !isUsableRowLimit(authored))`
(`react/src/element-data-source/ElementDataSourceGate.tsx:316-331`), and `isUsableRowLimit` is
`typeof v === 'number' && Number.isInteger(v) && v > 0` (`:192-194`). Every cap this key ACCEPTS
is one that predicate already calls usable — the accept set is a subset of the usable set — so
across the whole accept set the guard has exactly two outcomes and 「set but not usable」 is
empty. The extra arm, a cap displaced and reported because it is zero, negative or fractional,
is reachable only for a node this contract refuses, so it is recorded in the docblock rather
than in an author-facing sentence.

The view half is `pagination.pageSize` ALONE on this face. `savedViewLimit` does fall back to a
flat `view.limit` (`core/src/data-scope/element-data-source.ts:237-241`), but that names a
saved-view RECORD as the adapter's `listViews()` returns it — a third face, not an authored view
document. Measured on this tree: `ListViewSchema` REFUSES a flat `limit` with
`unrecognized_keys: ["limit"]`, the verdict a bogus key gets, while the same minimal document
parses with `pagination.pageSize: 50`. No view document
declares a flat `limit` and none carries a tombstone for one.
