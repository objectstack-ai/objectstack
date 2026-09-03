---
"@objectstack/service-automation": patch
---

fix(automation): a `try_catch` whose `catch` region itself fails now keeps the step record of both regions

`try_catch` returns a failure from three sites. #13803 taught the engine to fold
a dying container's carried steps off the THROW channel, #14184 taught its
returned-failure branch (`if (!result.success)`) to do the same, and #14184 also
taught the first producer — a `try_catch` with no `catch` region — to supply
them. The second producer was left unfolded: when a `catch` region is present
and the handler itself fails, the return dropped `childSteps` entirely.

That is the same defect one path over, and the worst of the three for an
operator, because TWO regions ran. The try region may have written rows before
it failed; the handler may have written more before IT failed; the run log kept
a step for neither, so the run summary folded over that log reported `acted: 0`
over writes that had genuinely landed. `acted: 0` on a failed run reads as
"nothing happened, safe to re-run", which for a non-idempotent region invites
double-execution.

Closing it needed the half that was genuinely missing rather than the available
one: the failed try attempts were already in scope, but the catch region ran
without a `partialSteps` sink, so when the handler threw, the handler's own
completed steps unwound with the stack. The catch region now receives the same
sink the try region already had (`runRegion`'s fifth argument), and the failing
return carries `[...failedTryAttempts, ...catchAttempts]` — failed try attempts
first, because they happened first, which is the ordering the successful-catch
return has always used. `runRegion`'s existing tagger supplies `regionKind:
'try'` / `'catch'` and `parentNodeId` on its failure path as well as its
success path, so the two halves stay distinguishable in the log.

Additive to the RECORD only. This return already reported failure with the same
error text, already produced a `NODE_FAILURE` step, already set `$error` and was
already routable by a `fault` edge; none of that moves, and neither does the
successful-catch path or the retry/throw semantics. No engine change was needed
— the fold that reads these steps has been in place since #14184.
