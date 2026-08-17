---
"@objectstack/example-showcase": patch
---

Guard the showcase's authored action predicates against the sparse action face (#8990)

Every record-scoped `visible` / `disabled` predicate in `app-showcase` now carries the
`has()` guard the sparse action face requires, closing the remainder of #8990 in this
repo. A row action's predicate binds a LIST ROW carrying only the view's `$select`
projection, and CEL aborts with `No such key` on a column that row never projected —
fail-closed, so the button silently is not offered.

Measured against the running app's own payloads: 40 of the 53 predicates in
`predicate-matrix.action.ts` aborted on a default-list row before this change and 0 do
after, while every verdict on a record-detail binding is unchanged — the Full-vs-Minimal
contrast the fixture exists to demonstrate is preserved exactly.

The guard is minimal per predicate rather than blanket: `has()` alone where the read is
only compared by `==` / `!=` (CEL compares heterogeneously and answers `false` rather
than faulting), the full `has(x) && x != null` conjunction only where an operand can
fault — traversal, method call, ordering, arithmetic, `in`, or a bare `!`.

The teaching surfaces move with the code, since they quote it: `content/docs/ui/actions.mdx`
(whose `visible: '!record.done'` was the exact negation shape that faults on a NULL
column), `quick-start.mdx` and `build-with-claude-code.mdx`.
