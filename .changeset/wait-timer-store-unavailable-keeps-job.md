---
"@objectstack/service-automation": patch
---

fix(automation): a wait node's timer wake-up no longer disarms itself when the store outage means it never woke the run (#5529)

A timer `wait` arms one job to wake its run. That job used to disarm itself in an
unconditional `finally` — and `AutomationEngine.resume()` reports failure by
**returning** a code rather than throwing, so "this shot consumed the pause" and
"this shot missed" were indistinguishable to that `finally`. Both were cancelled.

On `STORE_UNAVAILABLE` that was a durability hole. The durable suspended-run
store being unreadable does **not** mean the run is gone (#4420 draws exactly
that line): the pause was never consumed, the run is still parked at its wait
node, and its row is still there — but the one job that was ever going to wake it
had just retired itself. Nothing then woke that run until the next process start,
where `rearmSuspendedWaitTimers` picks it up as overdue. A store that wobbled for
the one moment the deadline landed, plus no restart, meant a run parked forever.

The one-shot now settles on the resume's return code:

- **`STORE_UNAVAILABLE`** — the job stays armed, and the degradation is reported
  at `error` (this path was previously silent — the result was discarded without
  even a `warn`). The line names the job, the run, and both remedies.
- **everything else** — cancelled exactly as before: success consumed the pause,
  `RESUME_IN_PROGRESS` means a concurrent resume is consuming it, a machine-state
  failure means there is no pause left to serve, and a thrown error is not a
  store outage.

Keeping the job armed is **not** self-healing, and the log line says so rather
than implying a retry: a `once` schedule is a single `setTimeout`, so it never
re-fires on its own. What survival buys is the two things `cancel` destroys — the
`sys_job` row stays `active` with its deadline (true, here: the run really is
still waiting) instead of flipping to `active: false` and reading as "this
wake-up is done", and the registration stays in the job service, so
`trigger('flow-wait:<runId>:<nodeId>')` re-fires that wake-up once the store is
back **without a restart**. After a cancel, `trigger` reports the job as not
found and a restart is the only path left.

Both sites that arm this job — the wait node's own arming path and the cold-boot
re-arm — now share one handler, so they cannot drift, the same reason the job's
name is a single declaration. This is separate from the `onSuspensionReleased`
teardown added in #5512 and does not replace it: that one fires when the **run**
leaves the node, this one when the **job** has had its single shot.

No authoring surface changes; no flow needs editing.
