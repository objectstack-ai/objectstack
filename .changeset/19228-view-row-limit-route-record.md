---
"@objectstack/spec": minor
---

fix(spec): state the row-cap guard `ElementDataSourceGate` implements, and record where the per-kind view `limit` actually lands (#19228)

Prose and pins only — zero accept-set movement, zero export movement. The same documents parse
to the same values before and after. ⛔ No `.default()` moves, ⛔ no precedence is picked: which
of the per-kind view `limit`, a view's `pagination.pageSize` and a component's flat `limit`
should win is the open half of #19228 and is not answered here.

⚠️ **Why `minor` when nothing behavioural moved.** `check-changeset-no-major`'s LEVEL axis
(#16055 / #16776) requires a PR that declares `Clause-②: yes` to grade at least one package
whose published source it moves `minor` or above, and this PR carries that declaration. The bump
is therefore the gate's floor, ⛔ not a description of a behaviour change: no key is added,
removed or renamed, no export moves, and every document that parsed before parses to the same
value after. Upgrading gains corrected published prose and nothing else.

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

## Where the per-kind view `limit` lands

The adapters spread a view's per-kind block FLAT onto the node they generate — `...restKanban`
(`plugin-list/src/ListView.tsx:2979`, `plugin-view/src/ObjectView.tsx:1638`; neither destructure
strips `limit`) and `...(viewOptions.timeline || {})` / `...(viewOptions.gallery || {})`
(`ObjectView.tsx:1725` / `:1697`). So a view's `kanban.limit` or `timeline.limit` — including the
100 the applied default materializes — becomes the flat `limit` that `ObjectKanban.tsx:553` and
`ObjectTimeline.tsx:279` read. The `$top` it would govern is not issued on either adapter route
today, because both hosts hand rows down as a React `data` prop and both children short-circuit
their own fetch; ⛔ that is a statement about the query, not about the key being unread.

**Gallery is the exception**, and only gallery: the block is spread flat by `ObjectView.tsx:1697`
and `ObjectGallery.tsx` contains no `limit` at all.

⚠️ For authors: `timeline.limit` inside an `object-timeline` node's `timeline` block reaches the
rail on one adapter route and not on the other. Write the flat `limit` beside it when you mean
the row cap.
