---
'@objectstack/trigger-schedule': patch
'@objectstack/spec': patch
---

A scheduled run no longer skips a screen whose field is named `schedule`, `jobId` or `flowName` (#19900).

The schedule trigger starts each run with three seeds of its own in `params` — `jobId`, `flowName` and `schedule` — and there is no caller behind the run. It stated nothing about that, so a `screen` node's headless verdict inferred who supplied each field from `params`, read those three seeds as the caller's answers, and continued past a screen whose field shared one of the names: the run completed with the trigger's value (for `schedule`, the cron descriptor) as the answer.

The trigger now sets `AutomationContext.callerParamKeys: []` — "the caller supplied nothing" — which the verdict reads instead of inferring. A screen in a scheduled flow pauses, whatever its fields are named. The three seeds stay in `params`; flows that read them are unaffected.

`@objectstack/spec`: the `callerParamKeys` TSDoc now names the schedule trigger as a producer that states the empty list, and no longer lists it among the producers that leave the key absent. No type changes.
