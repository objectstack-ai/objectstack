---
---

docs(driver-sql): record why `applyFilterCondition` keeps its `logicalOp` parameter

Comment-only; no behavior change, and this changeset releases nothing.

#3776 made `logicalOp === 'or'` unreachable. All four call sites now pass
`'and'` — the sole external caller plus the `$and`/`$or`/`$not` arms — because
every key inside one filter object AND-s at every depth, and the `orWhere` that
OR-s `$or`'s branches is applied to each branch's own sub-builder rather than
handed down as `logicalOp`. Handing it down was the #3774 miscompile that
widened every `$or` filter.

That leaves ~15 `logicalOp === 'or'` ternaries that nothing in the repo can
reach. They are kept deliberately: `applyFilterCondition` is `protected`, so it
is subclass API (`SqliteWasmDriver` here, `TursoDriver` downstream), and the
flag is the seam an override needs to attach a condition into an OR group.
Removing it would be source-breaking for any subclass that overrides the
four-parameter signature, which in this repo's lockstep versioning costs a
whole-stack major — a steep price for deleting a flag that changes no behavior.

The method-level TSDoc now states both halves, so the arms read as unreachable
*by design* instead of as dead code inviting a "fix" that makes a branch
propagate `'or'` again. `sql-driver-or-filter.test.ts` (19 cases) pins the
semantics that made the flag dead.
