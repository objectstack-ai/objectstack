---
'@objectstack/service-automation': patch
---

`AutomationEngine.resume(runId)` called with no signal object is now held to the suspended `screen` node's declared field contract exactly like a signal-carrying resume: a run paused on a screen with an unconditional `required` field is refused with `INVALID_SCREEN_INPUT` and stays paused, instead of proceeding with that variable unbound. The bare `if (!signal) return null` early return in `refuseInvalidScreenInput` is gone — an absent signal is an empty submission, the same shape the HTTP resume route has always assembled for an empty body — and the engine's own continuations (subflow output mapping, `map` item handoff) remain exempt only through the existing engine-built-signal mechanism. Pauses that declare no input contract are unaffected: `wait` and `approval` nodes, message-only and object-form screens, and screens whose fields are all optional or hidden resume without a signal exactly as before.
