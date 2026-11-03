---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a flow read's `_diagnostics` and the restore doors judge a stored flow in its D2-converted spelling, as the save and publish doors do

Clause-②: yes (widening)
Metadata-protocol: none

A flow stored in a legacy ADR-0087 D2 spelling that the automation engine registers (a `get_record` node's `config.filters`, for one) is accepted by the save door and both publish doors, but every read of it (`GET /meta/flow/:name`, the list read, the `?layers=true` read, the draft read and the diagnostics sweep) answered `_diagnostics: { valid: false }` naming the legacy key, and both restore doors (`rollbackMetaItem`, `revertCommit`) refused a history version in that spelling with `422 INVALID_METADATA`. The read's schema verdict and the restore doors' runtime rules now judge the row through the doors' conversion seam, with the chain the engine replays when it registers a stored row, and serve or restore the row as stored. A flow the rules still refuse once converted still reads `valid: false`, with the errors its current spelling gets, and a version refused once converted is still refused at restore.
