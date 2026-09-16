---
'@objectstack/service-automation': patch
---

fix(service-automation): a delegating node rolls its COMPLETED child's contained failures into the run-level `failed` (#16314)

The services half of #15617's ruling (maintainer 「同意」 on option 1, decision batch #55). The spec half landed the slot: `ExecutionStepMetrics.failures`, declared as *"node executions that failed inside a child run this execution delegated to and went on from"*, folding into `nodes[].failures` and so into `FlowRunSummary.failed`. Until this, nothing populated it — the engine's fold could not see a child's losses, so a parent that delegated its rows reported `failed: 0` while its children lost them. `acted` had rolled up since #4354; the failure count had not, and the two paragraphs of the declaration disagreed for exactly that shape.

**What moves on the wire.** For a run whose `subflow` or `map` child COMPLETED while containing failures, the delegating node's `nodes[].failures` and the run-level `failed` grow by the child's own `failed` — and the summary line prints it. The measured target from #15617, driven on the real engine:

```
parent loop { subflow(child) }, one child failing per five rows
  before   status=completed selected=5 acted=4 skipped=0 failed=0
  after    status=completed selected=5 acted=4 skipped=0 failed=1
  children failed = [0, 0, 1, 0, 0]   (unchanged — the child keeps its own row)
```

**The boundary, unchanged and pinned as the control.** A child that **failed** rather than contained is the delegating step's own failure, counted once through `nodes[].failures` exactly as it always was: `call: {runs: 5, failures: 1}`, parent `failed = 1`, with nothing of the child's own `failed` riding up. That is the one place this rule parts from `acted`'s, which does carry a failed child's writes. Implementing the symmetric-looking version would count one loss twice, and the control test is red on it.

**A delegating node's `status` is unaffected.** `FlowRunNodeSummary.status` is declared judged on the node's OWN executions, so a `subflow` step that ran fine and rolled a child's losses up reads `success` with `failures > 0` — and on such a node `failures` may exceed `runs`, as the field declares. The fold takes the status verdict before it adds the roll-up.

Three producers, each measured rather than assumed: `subflow-node.ts` (synchronous child), `map-node.ts` (per-item children — it does **not** share `subflow`'s roll-up path and needed its own), and `AutomationEngine.creditChildRun` (a child that PAUSED, whose parent step was written at suspend time; both the child-resume up-bubble and the parent-resume down-delegation are completion paths, which is what puts them inside the declared rule).

`failed` keeps its convention: absent is "not tracked", never zero — an absent `metrics.failures` means the execution delegated nothing or the child tracked no count, and nothing writes a `0` that would claim a measurement.

PR #15609's narrowed wording — *"no node execution **of this run** failed"* — was true only while the paragraphs disagreed, and is widened back here in the summary-line comment and in `content/docs/automation/flows.mdx`: `failed=0` now reads *"nothing this run caused failed, subflows included"*.

No API moves: no new export, no new key on any published payload, and the node executors' `NodeExecutionResult.metrics` shape is the spec's already-published one.
