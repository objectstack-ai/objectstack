---
"@objectstack/service-automation": patch
---

fix(service-automation): a `try_catch` with no `catch` region keeps the record of the writes its try region already made (#14184)

The returned-failure half of the engine's `childSteps` asymmetry. #13803 closed
the **throw** half — a dying `loop` brands its thrown error with the body steps
it completed and the engine's `catch` arm folds them into the run log — and
deliberately left the `if (!result.success)` branch alone, because at that
moment no executor returned `childSteps` on a failing result and a fold for
zero producers is speculative.

`try_catch` is the producer that makes it real. It does not throw: it catches
the try region's failure and RETURNS it, and on that return it withheld its
`childSteps` on purpose — correct while the engine spliced them only after a
successful result, and stale the moment the failing branch learned to fold. So
for a `try_catch` with **no** `catch` region, the try region's completed steps
were recorded nowhere: the run log kept no step for them, and the #4354 summary
folded over that log reported `acted: 0` for a region that had genuinely
written rows.

That is wrong in the one direction that causes harm. `acted: 0` on a failed run
reads as "nothing happened, safe to re-run", and for a non-idempotent region
(notifications, counters, external calls) that misread invites double-execution.

Two halves, mirroring #13803:

- `try_catch`'s no-`catch` failing return now carries `childSteps`.
- The engine folds `result.childSteps` in its `if (!result.success)` branch, in
  the same position the throw arm and the success path use — right behind the
  container's own step, ahead of any `fault` handler's steps.

**A record fix only; accept/reject is untouched and measured so.** `try_catch`
still returns failure with the same error text, still produces a `NODE_FAILURE`
step with the same message, still writes the same `$error`, still routes down
the same `fault` edge, and the run still ends `failed`. Those four were green
before this change and are green after it. The contained (with-`catch`) path,
the all-succeeding path and the failing-`catch` path are unchanged, and a try
region that fails before writing anything still reports `acted: 0` — there 0 is
the honest answer.

Every folded step carries a `parentNodeId`, so the ADR-0044 runaway guard, which
counts only top-level visits, does not see them. Nesting was measured for
double-folding: a container's sink already absorbs an inner container's steps,
so each step object still reaches the run log exactly once.
