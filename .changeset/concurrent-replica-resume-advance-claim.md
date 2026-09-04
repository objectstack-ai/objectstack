---
"@objectstack/service-automation": minor
---

fix(service-automation): make the resume advance a conditional claim on the suspended-run store, so two replicas cannot both advance one run (#14333)

`AutomationEngine.resumeInternal` guarded a duplicate resume with `this.resuming`,
an in-process `Set`. That is a complete guard for exactly one deployment shape: a
single process. Behind a load balancer, two decisions on one run arriving in the
same instant on two replicas each passed their **own** `resuming` check, both read
the same fresh row out of the shared store, both consumed it, and both traversed
forward — so every downstream side effect ran twice. #13617 closed the sequential
half of this family (a replica resuming from a snapshot it had gone stale on); it
deliberately did not close the concurrent one.

Measured before the fix on the two-engines-over-one-shared-store harness, at
`packages/services/service-automation/src/concurrent-replica-resume-race.test.ts`:
**25 of 25** raced runs advanced twice — one action fired twice and one approval
level opened twice per run — for both reachable shapes the report named (parallel /
any-of approvers, and duplicated automated approve calls). A single approver per
level deciding sequentially does **not** race, and is pinned as the negative
control.

`SuspendedRunStore` therefore gains `claimSuspension(runId, parkedAt)`: consume the
durable record **only** if it is still parked at the node the caller read (and, when
the caller has one, still carrying that correlation), atomically, answering
`'claimed'` / `'lost'` / `'unsupported'`. The winner advances; the loser is refused
`RESUME_IN_PROGRESS` — the existing code, because the remedy is identical to the
in-process refusal's and `plugin-approvals` already branches on it that way — and
runs nothing. The per-process `resuming` set stays as the cheap first gate; it is
not replaced, and the single-replica path is unchanged.

Both shipped stores implement it: `InMemorySuspendedRunStore` tests and removes
with no `await` between the two, and `ObjectStoreSuspendedRunStore` issues one
`DELETE … WHERE id = ? AND node_id = ?` through the data engine's documented
compare-and-set route (`multi: true` with a full `where`), reading the affected-row
count. ⛔ No platform-object schema change: `node_id` and `correlation` are columns
`sys_automation_run` already carried.

The member is **optional**, so no existing implementation is broken, and its absence
is a declared degradation rather than a silent one: an engine whose store cannot
express the condition says once, at `warn`, that resume idempotency is in-process
only and what that costs — the same posture `AutomationEngine.claim()` already takes
when no persisted flow-dispatch ledger is attached.
