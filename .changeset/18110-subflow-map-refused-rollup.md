---
"@objectstack/service-automation": minor
---

fix(service-automation): on the synchronous path, a child run that REFUSES stops its parent, in `subflow` and in `map` alike (#18110, #18555)

**Clause-②: yes (widening)** — `NodeExecutionResult` is barrel-exported from this package's single entry point, and it gains two new optional members. Nothing previously accepted is refused and nothing is retired, so this is a widening of the published executor contract, not a narrowing. Contract-review tier.

A child flow that runs to completion in one go and ends on an `end` node declaring `outcome: 'refused'` used to roll up to its parent as an ordinary success. `subflow-node.ts` branched only on `child.status === 'paused'` and `!child.success`; a refused child is neither (`{ success: true, status: 'refused' }` — *a refusal is a successful evaluation that says no*), so it fell through the success exit. The parent walked the node's out-edges, recorded `completed` and fired its **own** `successMessage` over the child's refusal — the author got the exact opposite of what they wrote, fail-open. `map-node.ts` had the identical branch set and the identical hole: a refusing row let every row after it through.

- **New on `NodeExecutionResult`: `refuse?: boolean` and `refusalMessage?: string`.** The executor-facing half of the unwinding protocol `suspend?: boolean` already uses. A node that sets `refuse` terminates its run as `refused` — a terminal status this package has published since #15788, so **no new status value** and nothing authorable changes.
- **`subflow` and `map` both set it** when their child run returns `status: 'refused'`. One channel, two call sites.
- **The child's `selected` / `acted` / `unmeasuredEffect` rollup (#4354) survives the refusal**, because the engine throws the refusal signal from the same position it throws the suspend signal: after the node's success step is pushed, after its `childSteps` are folded and after its output is written back. A child that refused really can have written rows before it said no.
- ⛔ **A refusal is still not a failure.** It does not consume retry budget, is not routable by a `fault` edge, and is not counted in `nodes[].failures`.
- **Region-boundary diagnostic, text only**: the message a structured region raises when a refusal tries to cross it now names whichever node carried the refusal, instead of asserting it was an `end` node — which, for a refusing `subflow`/`map` inside a region, sent the author looking for a node that was not in their region. Region **semantics** are unchanged.

**Scope — the RESUMED leg is not covered.** This fixes the path where the child run finishes inside the parent's own `engine.execute` call and its outcome is read from that return value. A child that durably PAUSES first — a nested `approval` / `screen` / `wait` — and only refuses when it is later resumed still reaches its parent through the resume machinery, which reads the child's outcome at different seams and does not consult `status: 'refused'` at any of them. Both of those seams pre-date this change and neither is a regression of it, but neither is closed by it either, and the resumed leg is the one a screen flow actually takes. A follow-up card covers it: #18714.

For third-party node executors this is additive: an executor that never sets `refuse` behaves exactly as before.
