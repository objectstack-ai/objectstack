---
'@objectstack/service-automation': patch
---

Keep a resume's `status: 'stranded'` verdict when the bookkeeping after the repair journal throws.

`resumeInternal`'s catch arm journals the consumed suspension — the snapshot `restoreConsumedSuspension` puts back — and only then stamps `status: 'stranded'`. Two statements sat between them and could throw out of the whole arm: `recordLog`'s terminal run-summary line, and a store whose `recordTerminal` throws synchronously (the `void write.catch(...)` beneath that call only ever sees a returned promise's rejection). `failAncestors` follows them.

A throw in that window left the run genuinely repairable while the verdict never shipped, and every consumer derives repairability from the verdict — `plugin-approvals` computes its operator-facing `repairable` as `status === 'stranded'` — so the approvals decision door reported `repairable: false` about a run that `restoreConsumedSuspension` answers `restored: true` for. That is a false negative on a repair instruction: it tells an operator not to attempt a repair that works.

The window is now guarded. The bookkeeping may still fail — and says so loudly, at `error`, naming the run, what did not land, and the verb that repairs the strand — while the verdict still ships. Measured: with a store whose terminal write throws, `resume` now returns `{ success: false, status: 'stranded' }` instead of throwing, the door reports `repairable: true`, and the repair verb succeeds on that same run.

The guard opens **after** the journal, so only a run that demonstrably has a snapshot can reach the stamp: a throw from the journal itself still propagates, every exit above the consumption point still carries no status at all, and cascade-failed ancestors — which journal nothing — are untouched and still correctly non-repairable.

⚠️ `repairable` remains a point-in-time fact, and this change does not make it durable: the run in the case above has no terminal history row (that write is what failed), so the repair rides on the in-memory journal and a restart loses it. The verdict reports what an operator can do now, which is exactly what was being denied.
