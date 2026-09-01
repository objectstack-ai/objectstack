---
'@objectstack/service-automation': patch
---

fix(service-automation): a dying `loop` no longer discards the record of the writes it already made (#13803)

A `loop` that died mid-sweep reported `acted: 0` for a run that had genuinely
written rows. The engine splices a container's `childSteps` into the run log
only after a **successful** node result, and a `loop` whose body throws never
produces a result — the throw unwinds past the splice, taking the accumulated
body steps with the stack frame. A five-row sweep failing on the third row had
committed three flag writes and two notifies, and reported
`{ selected: 5, acted: 0 }` with no step record of any of them.

The direction is what made it a bug rather than a miscount. `acted: 0` on a
failed sweep reads as "nothing happened, safe to re-run", so for a
non-idempotent body — notifications, counters, external calls — the summary
invited double-execution of writes that had already landed. The run summary is
the platform's own honesty instrument (#4354); on this path it was wrong in the
one direction that causes harm.

A dying container now carries its completed body steps out on the thrown error
(a non-enumerable symbol brand, the same idiom #3863 uses to mark un-routable
guard refusals on this identical throw path), and the engine's catch path folds
them into the run log in the same position the success path splices
`childSteps` — behind the container's own step, ahead of any `fault` handler's.
The same five-row sweep now reports `acted: 5` and keeps `loop-body` steps for
iterations 0, 1 and 2, with the failure attributed to iteration 2.

**Record-only: failure propagation is untouched.** The error is rethrown with
its identity, message and guard-refusal marking intact, so which failures a
`fault` edge routes, what `$error` holds, what the run reports as its error and
the `EXECUTION_ERROR` code on the container's own step are all exactly what
they were. The alternative shape — having `loop` swallow the failure and return
`{ success: false }` — was rejected for precisely this reason: it would have
made a guard refusal raised inside a loop body routable by a `fault` edge on
the loop, the one-edge switch #3863 exists to prevent.

A sweep that fails before writing anything still reports `acted: 0`, because
there that is the honest answer; an all-succeeding sweep and the
`try_catch`-contained path are byte-identical to before.
