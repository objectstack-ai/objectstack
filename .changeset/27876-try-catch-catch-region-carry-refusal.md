---
'@objectstack/service-automation': patch
---

fix(service-automation): a refusal met inside a `try_catch` catch region reaches the flow's caller as the structured refusal

Clause-②: no
Metadata-protocol: none

A `try_catch` whose catch region itself fails now carries the refusal that region met (a permission, a validation rule, a duplicate, an app hook's declared refusal) on the run's result as `innerRefusal` (`{ code, message }`) and the producer-marked `userMessage`, the same way a `try_catch` with no catch region already does. Before, the caller got only the node chain as text (`try_catch 'ID': catch region failed — …`), so a runner had no business message to show.

The refusal carried is the catch region's own, never the try region's refusal that it handled. A catch region that failed with no refusal carries neither member, even when the try region was refused, and the `error` text is unchanged.
