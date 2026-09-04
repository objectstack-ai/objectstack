---
"@objectstack/spec": minor
---

feat(spec)!: `ExecutionStepLog.iteration` is single-valued — the enclosing loop iteration — and the parallel branch index moves to a new optional `branch` key (#14414)

<!-- adr-0087: registered execution-step-iteration-single-valued -->

**BREAKING** for any consumer that read `iteration` as the parallel branch index
on a `regionKind: 'parallel-branch'` step record: that number now means the
enclosing `loop`'s iteration, and the branch index lives on `branch`. Shipped as
`minor` under the repo's launch-window convention for breaking changes; the
hand-migration prescription is registered under protocol major 18. Maintainer
ruling 2026-09-03 on #14414 (director decision batch #15, verbatim 「同意」):
option A.

`ExecutionStepLogSchema.iteration` was declared as "zero-based loop iteration
OR parallel branch index of the enclosing region" — one field, two meanings,
told apart only by reading `regionKind` first. For `loop { body: [ parallel {
branches } ] }` the engine tagged each branch step with the branch index and no
step of that branch with the loop iteration, so a per-row failure inside a
branch was attributable to a branch, never to the row. The sibling `try_catch`
rule (a try/catch region has no index of its own, so it carries the loop
iteration) had deliberately left `parallel` open, because a parallel region
DOES have an index of its own.

**What changes on the record shape** (`packages/spec/src/automation/execution.zod.ts`):

- `iteration` — single-valued: the zero-based iteration of the enclosing
  `loop`, carried through any nesting (`try` / `catch` already carried it;
  `parallel-branch` now does too). The try/catch sentence is unchanged.
- `branch` — **new**, optional, `integer >= 0`: the zero-based index of the
  enclosing `parallel` branch, present only on a step inside a parallel
  branch. A branch step of a parallel node inside a loop body carries both.
- `regionKind` — unchanged vocabulary; its describe now points the
  `parallel-branch` index at `branch`.

**What does NOT change in this PR:** the engine tagger in
`@objectstack/service-automation` still writes the innermost region only —
today it writes the branch index into `iteration` on `parallel-branch` steps
and never writes `branch`. The tagger change is a follow-on card in the same
lane, blocked by this one (three-surface rule: spec first, no engine-only patch
in between). A step record written by an engine that predates that follow-on
therefore carries no `branch` key, and its `iteration` under `parallel-branch`
still holds the legacy branch index.

## FROM → TO

```ts
// before — one key, two meanings; the loop iteration of a branch step is lost
const step = { regionKind: 'parallel-branch', iteration: 1 }; // 1 = branch index
const branchIndex = step.regionKind === 'parallel-branch' ? step.iteration : undefined;

// after — one meaning per key; a branch step inside a loop body carries both
const step = { regionKind: 'parallel-branch', iteration: 3, branch: 1 };
const branchIndex = step.branch;   // 1 — the branch
const rowIteration = step.iteration; // 3 — the enclosing loop's row
```

Fix: where a consumer groups or labels `parallel-branch` steps by `iteration`
(the objectui `FlowRunsPanel` grouping key is the one measured reader), read
`branch` for the branch index and keep `iteration` for the row. Reads of
`iteration` on `loop-body`, `try` and `catch` steps need no change.
