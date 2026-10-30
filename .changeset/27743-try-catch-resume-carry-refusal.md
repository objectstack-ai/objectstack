---
'@objectstack/service-automation': patch
---

fix(service-automation): a refusal met inside a `try_catch` with no catch region, or by a `subflow` child that pauses and fails on resume, reaches the flow's caller as the structured refusal

Clause-②: no
Metadata-protocol: none

A flow whose data node met a refusal (a permission, a validation rule, a duplicate, an app hook's declared refusal) reports it on the run's result as `innerRefusal` (`{ code, message }`) and the producer-marked `userMessage`, and `map` and `subflow` carry it across themselves. Two more paths built a new failure and lost both members, so the caller got only the node chain as text:

- A `try_catch` with no catch region. It now carries the refusal its last failed attempt met, so a retry ladder reports the last attempt's refusal, never an earlier one's.
- A `subflow` child that paused (a screen, an approval, a wait) and then met a refusal on resume, when the caller resumed the parent's run id. The parent's failure now carries the child's refusal, through nested subflows too.

Resuming the child's own run id (the leg a `map` item takes) already carried it, and is now pinned. A failure that met no refusal carries no member, as before, and the `error` text is unchanged.
