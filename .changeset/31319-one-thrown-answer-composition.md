---
'@objectstack/types': patch
'@objectstack/runtime': patch
---

refactor(runtime): the dispatcher answers a thrown value through the one composition the `/actions` door reads

Clause-②: no (fold onto one composition, no wire change)
Metadata-protocol: none

`HttpDispatcher.errorFromThrown` (`@objectstack/runtime`), the exit every dispatcher domain answers a thrown value through, composed its answer term by term beside the `/api/v1/actions` door's reader (`actionsDoorAnswerOf`, `@objectstack/types`): the resolver's closed `code`, the engine duplicate's wire spelling and context, the demoted `declaredCode`, the declared `userMessage`, and the 5xx leak withhold. The two agreed, and nothing tied them. Both now build their answer from one function, so a change to it moves every door that answers a throw this way.

**New export (`@objectstack/types`): `thrownAnswerOf(err, fallbackStatus)` and its `ThrownAnswer` type**, the runtime dispatcher's answer to a thrown value at a fallback status: `status`, `code`, `message`, and `declaredCode`, `userMessage`, `details` when present. `actionsDoorAnswerOf`'s declared-status and rejection arms return it with the door's operator lines.

No response changes: the dispatcher's existing envelope pins pass unedited.
