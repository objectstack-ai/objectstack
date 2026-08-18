---
"@objectstack/service-automation": patch
---

fix(service-automation): a triggered run carries the flow author's `successMessage` / `errorMessage` — `execute()` and both retry exits, symmetric with `resume()` (#9414)

`AutomationResult` declares `successMessage` / `errorMessage` as a general
terminal-result feature — *"Friendly terminal messages copied from the flow
definition (`flow.successMessage` / `flow.errorMessage`) … `successMessage` is
set on terminal success, `errorMessage` on failure."* One producer honoured it.
`resumeInternal` set both on its terminal returns; `execute()` set neither, on
either exit, and neither did `executeWithoutRetry` or `retryExecution`.

So a flow's own words reached a caller **only if the run happened to pause and
be resumed**. A flow dispatched straight through
`POST /api/v1/automation/:name/trigger` — or the legacy `trigger/:name` that
`client.automation.trigger()` calls — carried nothing, though the flow declared
the text and the contract said it was set. One declaration, two behaviours
decided by *route* rather than by authoring.

**The consumer was already there and already reading.** The trigger route
carries `errorMessage` into `error.details.errorMessage` (#9413), which is the
one place the console reads it from (objectui `flowResponse.ts`, #4899) — and on
the trigger path it was **always absent at the source**, so every non-screen flow
showed the raw node error instead of the sentence its author wrote.

Four terminal exits now produce the pair, which is every exit a triggered run can
leave through:

- `execute()` terminal success → `successMessage`; terminal failure →
  `errorMessage`, **beside** the raw `error` rather than instead of it (the
  transport folds `error` into the ADR-0112 message and carries the author's text
  in `details`).
- `executeWithoutRetry()` — both exits. `retryExecution` returns this result
  verbatim when a later attempt succeeds, so without it `successMessage` would
  depend on *which attempt* happened to work.
- `retryExecution()`'s **exhausted** exit, which is a different exit from
  `execute()`'s own failure return — a flow under `errorHandling.strategy:
  'retry'` never reaches that one. A repair stopping at `execute()` would have
  left the message missing for exactly the runs most likely to need it.

**Nothing else gained a message, deliberately.** The paused return is not
terminal; the skip exits (`condition_not_met`, `reentrancy_loop_guard`) return
`success: true` for a run that executed no node; the never-dispatched exits
(flow not found / disabled / no start node) have no lifecycle verdict at all and
must not acquire a second channel implying one. Those boundaries are pinned, not
just described.

No new keys and no contract edit — the pair was declared, documented and
consumed already; this is the production half catching up (ADR-0049
enforce-or-remove, restoration direction).
