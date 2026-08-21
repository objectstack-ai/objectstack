---
"@objectstack/plugin-email": patch
"@objectstack/plugin-security": patch
---

**Durability fix:** the two boot-time **summary** reports now reach a logger sink that has no `error` method, instead of printing nothing at all (#9748).

`SweepLogger.error` and `ProjectionLogger.error` are both declared **optional**, and both summaries were spelled `logger?.error?.(…)` — an optional call that emits **nothing** when the method is absent. #9657 repaired the six per-row reports of this shape; it could not see these two, because `check:durability-log-level` only judges a call inside a `catch`, and a summary sits after the loop. Against a `{ info, warn }` sink the result was that the repair made the split **worse**: the per-row detail arrived at `warn` while the count of failures vanished, so the detail and the total reported through different channels.

- `sweepStrandedOutbox()` — *"N stranded `sys_email` row(s) could NOT be delivered"*. Mail the platform **accepted** and never delivered, previously summarised to nobody.
- `reconcilePermissionSetProjection()` — *"N FAILED backfill(s)"*. Worse than a plain omission here: the `else` branch carrying the `info` "reconciled" line is skipped too, so such a sink heard **neither** — the reassuring half-truth this rule exists to remove, arrived at from the other side.

Both now reach for `error` and fall back to `warn`, never to silence — the same repair shape #9657 applied to the per-row lines. A sink that **does** have `error` is unaffected and still gets the summary at `error`; a downgraded level is a degradation of the channel, never of the message, so the consequence and the fix survive the fallback intact.

Also enforced from now on: `check:durability-log-level` grew a **summary limb** that judges a report keyed on the counter a durability-critical `catch` accumulated into, so this class cannot regress silently. The limb never second-guesses a chosen log **level** — it only checks that a call that reaches for `error` can actually print.
