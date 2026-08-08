---
'@objectstack/service-automation': patch
---

A failed trigger-fired flow run's `error` record now stays on one physical line: the `AutomationResult.error` envelope — which carries a failing node's / driver's text verbatim — moved from the log MESSAGE into the structured meta slot (`error` field), the same #6499/#6568 family shape, applied to the one same-class site that sweep left on the fired-run path. The message keeps its `Trigger-fired run of flow '…' failed` lead phrase and now also names the trigger type and the consequence; anything keyed on the old trailing `: [error text]` splice must read the structured `error` field instead.
