---
'@objectstack/spec': minor
---

feat(spec): `ExecutionStepMetrics` gains an optional `failures` slot, and `FlowRunSummary.failed` is declared as the fold INCLUDING what a delegating node rolled up from its child — the rule `acted` already follows (maintainer ruling 2026-09-06 on #15617, spec half)

Additive. Nothing an author writes is renamed, retired or narrowed; no accept
set shrinks. One optional key is declared on a runtime-produced schema and the
prose of a published contract is reconciled with itself.

**What was wrong.** `FlowRunSummary` said two things about `failed`. Its
header paragraph declared that a `subflow` node rolls its child run's totals
up into the parent — "this summary answers *what did this run cause*" — while
the field itself declared `failed = Σ nodes[].failures`, a fold over the
parent's own node executions. For a parent that delegates its rows to a
`subflow` (or a `map` item) those give different answers, and the engine could
only satisfy the second one: `ExecutionStepMetrics` carried `selected` /
`acted` / `unmeasuredEffect` and no failure slot, so a child's contained
failures had no path into the parent's fold. Measured on the real engine by
the services seat (#15617): parent `loop { subflow(child) }` → parent
`failed=0` while the five child summaries carried `failed=[0,0,0,0,1]` —
`acted` rolled up, `failed` did not.

**What this declares.**

- `ExecutionStepMetrics.failures` (optional, integer ≥ 0): node executions
  that failed inside a child run this execution delegated to and went on from
  — a `subflow` child or a `map` item whose run COMPLETED while containing
  failures, i.e. the child's `summary.failed`, rolled up. It folds into the
  delegating node's `nodes[].failures` and so into the run-level `failed`, by
  exactly the path the child's writes take into `acted`. Absent means the
  step delegated nothing or its child tracked no count — not zero.
- It is NOT the step's own outcome. A step that failed is `status: 'failure'`
  and counts once through `nodes[].failures`, as before; a child that FAILED
  rather than contained is precisely that step failure — its own `failed`
  stays on the child's run row and nothing rides up, so one failure is never
  counted twice. The control the card measured (a failing child → parent
  `failed=1`) keeps counting exactly as today.
- `FlowRunSummary.failed` is declared, at the field, as the fold of
  `nodes[].failures` INCLUDING what a delegating node rolled up; the
  `FlowRunNodeSummary.failures` describe names the roll-up path, and its
  `status` describe states that a delegating node whose child contained
  failures reads `success` beside `failures > 0` — status is judged on the
  node's own executions.

**What this does not do yet.** This is the contract half of a two-lane
landing (contract first). No producer populates `failures` in this release:
`subflow-node.ts` and the `map` node roll the child's contained failures into
the slot in the services half, #16314, and only then does a parent's
`failed` start counting them. Until that lands, every `ExecutionStepMetrics`
the engine emits is byte-identical to today's, `failed` is numerically what it
was, and the flow-run reference page keeps the narrowed wording PR #15609
shipped ("node executions **of this run**") on purpose — it is widened when
both halves are in.

**Consumers.** A reader of `ExecutionStepMetrics` sees one more optional
number and nothing else changes shape; a consumer that already sums
`nodes[].failures` to cross-check `failed` keeps agreeing with it, because the
fold is unchanged — the roll-up enters the per-node array, not beside it.
