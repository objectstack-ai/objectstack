---
"@objectstack/spec": patch
---

fix(spec): state the row-cap guard `ElementDataSourceGate` implements, and record where the per-kind view `limit` actually lands (#19228)

Prose and pins only — zero accept-set movement, zero export movement. The same documents parse
to the same values before and after. ⛔ No `.default()` moves, ⛔ no precedence is picked: which
of the per-kind view `limit`, a view's `pagination.pageSize` and a component's flat `limit`
should win is the open half of #19228 and is not answered here.

## What the published text said, and what the consumer does

`ObjectKanbanPropsSchema.limit` told authors that a bound view's `pagination.pageSize`
「fills it only when unset」. Measured first-hand at the objectui pin this repo builds against
(`.objectui-sha` = `87af769e9`), the branch is `if (!fromView || !isUsableRowLimit(authored))`
(`react/src/element-data-source/ElementDataSourceGate.tsx:316-331`): the view's cap ALSO lands
when the key is set to a cap the contract refuses — zero, negative or fractional — with
`describeDisplacedRowLimit` telling the author. Unset is one arm of that guard, not the whole of
it. The view half is likewise not `pagination.pageSize` alone: `savedViewLimit` reads
`pagination.pageSize`, else that view's flat `limit`
(`core/src/data-scope/element-data-source.ts:237-241`). The describe now states the guard as
implemented.

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
