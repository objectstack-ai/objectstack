---
'@objectstack/spec': patch
---

docs(spec): the `notify` node's `sourceObject`, `sourceId` and `actionUrl` descriptions now state the click-through default the runtime already applies

Clause-②: no
Metadata-protocol: none

A `notify` node that writes none of `sourceObject`, `sourceId` and `actionUrl` links to the run's trigger record when the run has one (a record change other than a delete, a time-relative sweep's row, an action started on a record). The `NotifyConfigSchema` descriptions, and the reference page generated from them, said only that the pair takes effect together. They now also say that an explicit pair or an `actionUrl` is kept as written, that a half-written pair is still dropped rather than defaulted, and that a run with no trigger record links nowhere. No key, shape, default or refinement changes.
