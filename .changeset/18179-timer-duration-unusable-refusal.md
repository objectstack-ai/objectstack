---
'@objectstack/service-automation': patch
---

fix(automation): a `wait` node whose `timerDuration` yields no wait is refused loudly instead of parking the run forever (#18179)

#17928 closed the **absent** `waitEventConfig` block: the contract now requires
the block, and requires a non-blank `timerDuration` under `eventType: 'timer'`.
Neither half can evaluate the string. `timerDuration` is `z.string()`, so
`'not-a-duration'`, `'1 hour'`, `'P'`, `'PT0S'`, `'0'` and `'-5'` are all
documents that SAVE — and `parseIsoDuration` answers `undefined` for every one
of them, exactly as it did for the absent key.

Measured through a real `engine.execute()` run with a job service **answering**,
not read off the source:

```
FROM  waitEventConfig: { eventType: 'timer', timerDuration: 'not-a-duration' }
      -> FlowNodeSchema.safeParse(...)  // succeeds — the document saves
      -> { success: true, suspend: true }            // run status: paused, forever
         scheduled jobs: []       <- with a job service ANSWERING
         variables:      no `pause.waitUntil`        <- cold boot cannot re-arm it
         log lines:      0 at any level              <- warn, error, info, debug

TO    -> { success: false, errorClass: 'guard', error: "wait 'pause': timerDuration
           \"not-a-duration\" is not a usable wait — …" }   // run status: failed
         one `warn` naming the node, the offending value and the remedy
```

The state the old path left behind was **un-refused, un-armed, un-persisted and
un-logged, while reporting success**: neither the arming branch (guarded on the
deadline) nor the "no job service" fallback (guarded on the service) could run,
so control fell straight through to the suspending return. The comment there
pointed at recovery via a later boot's re-arm pass "when the deadline was
persisted" — and no deadline had been persisted.

**The remedy the refusal prints.** Write an ISO-8601 duration
(`timerDuration: 'PT1H'`, `'P3D'`, `'PT90M'`) or a QUOTED positive millisecond
count (`'60000'`), then re-publish the flow. For a pause with no deadline,
declare an `eventType` that names its resumer instead (`'signal'` / `'webhook'`
/ `'manual'` / `'condition'`).

Zero and negative are the same verdict and deliberately not a separate one:
`'PT0S'` is not a short wait, it is a deadline already past, and it parks just
as permanently as an unparseable string.

⚠️ Behaviour this deliberately changes: a stored flow carrying one of these
values used to reach `paused` and report success. It now fails the run at that
node. Nothing that parsed stops parsing — no authorable key is removed, renamed
or narrowed — and the refusal is `guard`-class, so a `fault` edge cannot route
the metadata defect into a handler that reports success.
