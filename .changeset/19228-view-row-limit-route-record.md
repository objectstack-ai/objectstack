---
"@objectstack/spec": patch
---

fix(spec): state the row-cap guard `ElementDataSourceGate` implements, and record where the per-kind view `limit` actually lands (#19228)

Prose and pins only — zero accept-set movement, zero export movement. The same documents parse
to the same values before and after. ⛔ No `.default()` moves, ⛔ no precedence is picked: which
of the per-kind view `limit`, a view's `pagination.pageSize` and a component's flat `limit`
should win is the open half of #19228 and is not answered here.

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
parses with `pagination.pageSize: 50` and with a per-kind `kanban.limit: 50`. No view document
declares a flat `limit` and none carries a tombstone for one.

## Where the per-kind VIEW `limit` lands

⚠️ Two different keys are easy to confuse here, so each statement names its face. The **view
face** is a `ListViewSchema` document's `kanban` / `gallery` / `timeline` block — that is where
this key lives. The **element face** is a page component node's own flat `limit`, declared in
`component.zod.ts`, and that is the key every renderer actually reads. An adapter turns the
first into the second.

The adapters spread a view's per-kind block FLAT onto the node they generate — `...restKanban`
(`plugin-list/src/ListView.tsx:2979`, `plugin-view/src/ObjectView.tsx:1638`; neither destructure
strips `limit`) and `...(viewOptions.gallery || {})` / `...(viewOptions.timeline || {})`
(`ObjectView.tsx:1697` / `:1725`). So a view's `kanban.limit` — including the 100 the applied
default materializes — becomes the node's flat `limit`, which `ObjectKanban.tsx:553` reads. A
view's `timeline.limit` is route-dependent: `plugin-view` flattens it and `ObjectTimeline.tsx:279`
reads it, while `plugin-list` forwards the block nested, where nothing does. A view's
`gallery.limit` is flattened too and read by nobody — `ObjectGallery.tsx` contains no `limit` at
all.

Where it is read, the `$top` it would govern is still not issued on either adapter route today,
because both hosts hand rows down as a React `data` prop and both children short-circuit their
own fetch; ⛔ that is a statement about the query, not about the key being unread.

⚠️ For authors of an `object-timeline` NODE: a `limit` written inside that node's own `timeline`
block is read by no renderer on any route — the rail is capped by the flat `limit` beside it,
which is also the only one a bound `dataSource` lowers into. Write the flat one.
