---
"@objectstack/service-automation": patch
---

fix(automation): evaluate a record-change flow's start condition on the re-entrant dispatch its own write causes — the loop-breaker goes back to being a backstop (#8689)

A `record-after-update` flow whose start condition, **as authored, is false on the
flow's own write-back**, was still re-dispatched for the same record. Nothing ran
away — the engine's last-resort re-entrancy breaker caught it every time — but the
breaker was the *only* thing working, and its own WARN said so: *"Its start
condition did not suppress the re-fire."*

**Which of the two candidate mechanisms — measured, not assumed.** The report named
two readings that need different repairs: the re-entrant dispatch *skips* condition
evaluation, or evaluation *runs but aborts* and the abort is counted as a fire.
Measured on a real booted kernel (ObjectQL + automation + record-change trigger on
better-sqlite3), a flow guarded on `record.status != "escalated"` whose data node
writes `status = "escalated"`:

```
dispatches for the record ........ 2   (the re-fire really happened)
start-condition evaluations ...... 1   (the FIRST dispatch only)
evaluations that threw ........... 0
loop-breaker WARNs for that id ... 1
```

Two dispatches, one evaluation, zero throws: the first reading is the true one, and
the second is falsified for this path. `AutomationEngine.execute()` checked the
re-entrancy breaker **before** the start-condition gate and returned there, so on the
one dispatch where an author's re-fire guard is load-bearing, the guard was never
consulted at all.

**The fix is the ordering, not a stronger breaker.** The gate now runs first; the
breaker check moved below it. The re-entrant dispatch already carries the post-write
row, so the condition evaluates `false` and the flow is suppressed with
`condition_not_met` — by the guard its author wrote. Measured after the change on the
same harness: 2 dispatches, **2** evaluations (the second returning `false` against
`status = "escalated"`), **0** breaker WARNs, and the flow still fires and applies its
write exactly as before.

The breaker is **unchanged in strength**, deliberately — making it catch more while
leaving evaluation broken would have been the wrong direction. A condition that is
genuinely true on re-entry (the 2026-07-06 shape: a `boolean` persists as integer `1`
on SQLite/libsql, and CEL `1 != true` is true, so `is_escalated != true` never trips)
still lands on the breaker, at the same depth, with the same WARN and the same skip
envelope. What changed is that reaching it now *means* something — the condition was
evaluated and returned true — so the WARN states that as fact instead of inferring it.

Two consequences worth naming for anyone reading logs or run history:

- flows whose re-fire guard was already correct stop producing the breaker WARN
  entirely, and their re-entrant dispatch is now recorded as `condition_not_met`
  rather than `reentrancy_loop_guard`;
- a run skipped by its condition, and a re-entrant dispatch refused by the breaker,
  no longer release the re-entrancy key — only the run that took it does. Releasing a
  key it never owned would have disarmed the breaker for the run still on the stack,
  which is exactly the runaway the breaker exists to stop.

The regression pins assert the reporter's own three-legged probe design together —
the flow actually fired, no breaker WARN carries that record's id, and the start
condition was **evaluated** at the re-fire against the post-write row and returned a
verdict rather than throwing. Asserting only "the flow terminated" would be vacuous
here: the breaker already made that true.
