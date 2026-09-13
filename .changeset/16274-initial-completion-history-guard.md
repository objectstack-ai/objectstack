---
"@objectstack/service-automation": patch
---

A run whose nodes all succeeded is no longer answered `failed` — or, under `errorHandling.strategy: 'retry'`, RE-EXECUTED — because its terminal run-history write threw (#16274)

`AutomationEngine.execute()` and `executeWithoutRetry()` each called `recordLog({ status: 'completed' })` from inside the `try` whose `catch` exists for **node** failures, so a throw out of a history write on a run that had already finished successfully was handled as though a node had thrown. This is the initial-execution half of the pattern fixed on the resume path in 17.4.0; that fix deliberately scoped these two sites out.

**The consequence was measured, and it is a double run, not just a mislabelled one.** `execute()`'s node-failure arm ends at the retry strategy branch, which hands the false `failed` result to the retry loop; the loop reads `result.success` and therefore re-enters `executeWithoutRetry()` — the whole flow, every node, again. Driven with `maxRetries: 2`: a flow whose node always succeeded ran it **three** times and wrote three `failed` rows, unattended, inside one `execute()` call, with the node's side effects repeated each time. Controls on the same instrument: the identical flow on healthy sinks runs the node once, and a genuine node failure runs it three times (retry working correctly).

**What can throw there is a host surface, not in-repo code** — which is why it could not be reproduced from inside the package and why the package owed the fix:

- the run-summary line `logger.info(line, meta)`, on by default (`runSummaryLog: 'info'`) and calling a **host-injected** `Logger`. This one needs no store at all.
- `store.recordTerminal(record)` throwing **synchronously**, before it returns a promise — the `void write.catch(...)` beneath that call only ever sees a returned promise's rejection. Both stores shipped in this package are `async` methods and cannot do it, but `SuspendedRunStore` is an exported interface whose `recordTerminal` is optional, so a host store is unconstrained. (A store returning a non-thenable escapes identically: `write.catch` is then itself a synchronous `TypeError`.)

On that second variant the old code did not even answer `failed`: the node-failure arm's own `recordLog({ status: 'failed' })` threw again out of the same store and escaped `execute()` entirely — a rejected promise where `AutomationResult` is declared.

What changes:

- **Each completion-path history write is guarded at its own call site**, restoring the invariant that call's own documentation states: a history write must never block or break the run that produced it. The caller is told the truth — `success: true`, no `status`, the flow's `successMessage`, and a `summary` recomputed by the same pure function `recordLog` runs first — the node runs exactly once, and one `completed` row is recorded rather than `1 + maxRetries` `failed` ones.
- **The swallowed failure is reported once per run at `error`**, with the consequence and the fix in the first line: the run completed, its terminal history row never landed, nothing retries it, and the run must not be re-run. The thrown text rides the structured slot.

⛔ No `catch` arm's meaning is widened: a genuine node failure still reaches the node-failure arm, is still recorded `failed`, still carries the node's own text, and is still retried the full `1 + maxRetries` times.
