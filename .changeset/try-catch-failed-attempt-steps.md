---
"@objectstack/service-automation": minor
---

feat(service-automation): a caught `try_catch` failure now records what failed, how many attempts ran, and which node threw (#7546)

A caught failure used to leave **no forensic trace**. The whole run log was:

```
[ start, guarded_push (try_catch, success), record_failure (catch) ]
```

Nothing carried `regionKind: 'try'`. Nothing carried `status: 'failure'`. The
container's own step read `success`. From the log alone a caught failure was
indistinguishable from a clean run that happened to also touch the catch path —
the only evidence a failure had occurred was the catch region's side effects,
which is nothing at all when the catch is a bare notification, and worse than
nothing when the catch's own write is the thing you are trying to explain. An
operator (or an agent) reading such a log was not merely under-informed: the
most natural reading was that the try region had never run, which points at
"fix" work on a region that was behaving exactly as designed.

The steps were never missing for a structural reason. A failing node pushes its
own `failure` step into the region's step array *before* it throws, and the
`childSteps` splice that folds region steps into the parent log has existed
since #1479 and works for every region kind that succeeds. The failed attempt's
array was simply dropped on the floor as the region unwound.

**What changes.** `runRegion()` now hands a failed region's partial steps to the
caller through an opt-in sink before the throw propagates, tagged exactly as a
successful region's are, and `try_catch` accumulates every failed attempt across
the retry ladder and folds them into `childSteps` **ahead of** the steps of
whichever region finally succeeded. So a caught failure's log now contains, in
execution order, each failed try attempt (the throwing node's `failure` step
with its error, plus whatever the attempt got through before it) followed by the
catch handler's steps. The same applies to a ladder that recovers on a retry:
the attempts it burned are recorded rather than erased.

Where a retry policy is declared, those steps also carry `retryAttempt` — the
zero-based attempt index — so the number of attempts is a **count** in the log
rather than something inferred from elapsed wall time. `retryAttempt` is not new
vocabulary: it has been declared on the spec's `ExecutionStepLogSchema` since
that schema was written, with exactly this meaning, and had no producer anywhere
in the engine until now.

**What does not change.** The retry and throw semantics of `try_catch` are
untouched: the same number of attempts, the same fall-through to the catch
region, the same node-level outcome. A container that recovers still reports
`success` — giving it a distinct status such as `recovered` was considered as
part of this decision and deliberately not adopted, because the container's
contract is "the error was handled" and the forensic detail belongs in the step
log underneath it, which is what this change delivers.

**Log volume.** A try region that retries N times now emits up to N times its
body's steps, and a retry ladder nested in a loop multiplies. Durable run
history is unaffected in shape: `compactStepLogForHistory` already caps
persisted steps and already prioritises failures and their container chains, so
the extra records land inside the existing budget rather than growing it.

Run summaries need no special case and get more accurate. A try node that failed
twice before succeeding folds to `runs: 3, failures: 2` — all three numbers
true, and the same "worst outcome wins, `runs`/`failures` carry the nuance" rule
a loop body has always folded under. Records written by an attempt that then
threw now reach the run's `selected`/`acted` totals instead of vanishing, which
is what those counters are for.
