---
"@objectstack/spec": minor
---

fix(spec): the react-tier `limit` describe states the guard `ElementDataSourceGate` implements, and the per-kind view `limit` is recorded as read by nobody (#19228)

Prose and pins only. ⛔ No `.default()` moves, ⛔ no precedence is picked: which of the
per-kind view `limit`, a view's `pagination.pageSize` and a component's flat `limit`
should win is the open half of #19228 and is not answered here.

## What the published text said, and what the consumer does

`ObjectKanbanPropsSchema.limit` told authors that a bound view's `pagination.pageSize`
「fills it only when unset」. Measured first-hand at the objectui pin this repo builds
against (`.objectui-sha` = `87af769e9`, read 2026-09-21T06:35Z), the branch is
`if (!fromView || !isUsableRowLimit(authored))`
(`react/src/element-data-source/ElementDataSourceGate.tsx:316-331`): the view's cap ALSO
lands when the key is set to a cap the contract refuses — zero, negative or fractional —
with `describeDisplacedRowLimit` telling the author. Unset is one arm of that guard, not
the whole of it. The view half is likewise not `pagination.pageSize` alone: `savedViewLimit`
reads `pagination.pageSize`, else that view's flat `limit`
(`core/src/data-scope/element-data-source.ts:237-241`).

The describe now states the guard as implemented. No accept set moves; the same documents
parse to the same values before and after.

## The per-kind view `limit` reaches no consumer

`git grep` over all 8,228 files tracked at that pin: `.kanban.limit` / `.gallery.limit` /
`.timeline.limit` → **0** read points, against **8** for the identically-shaped control
`.kanban.groupByField` / `.gallery.coverField` / `.timeline.scale`. `ListView`'s `baseProps`
carries no `limit` on any branch, and `ObjectTimeline` queries off the FLAT `limit` alone
(`ObjectTimeline.tsx:407`). Recorded on `rowLimitKey` in `view.zod.ts` and on the
`object-timeline` door — declared, defaulted to 100 on every parse, and dropped.

Authors of an `object-timeline` node: `timeline.limit` is accepted and has no effect today;
the flat `limit` beside it is the key the rail's query reads.
