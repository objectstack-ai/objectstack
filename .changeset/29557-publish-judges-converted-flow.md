---
'@objectstack/metadata-protocol': patch
'@objectstack/lint': patch
---

fix(metadata-protocol): both publish doors judge a stored flow draft in its D2-converted spelling, as the save door does

Clause-②: yes (widening)
Metadata-protocol: none

A flow draft stored in a legacy ADR-0087 D2 spelling that the automation engine registers (a `get_record` node's `config.filters`, for one) saved as a draft, because the save door judges a flow in its converted spelling and stores the body as written, but the per-item publish (`POST /meta/flow/:name/publish`) and the package publish (`publish-drafts`) then refused it with `422 INVALID_METADATA` (`expression-invalid`, `flow-region-shape-invalid`), because both judged the raw stored body. Both doors, and the draft read's publish verdict, now judge the stored draft through the save door's conversion seam, with the full conversion chain the engine replays when it registers a stored row, and promote it as stored: the active row is the draft's bytes. A draft the flow rules still refuse once converted is refused with the issues its current spelling gets.

The `flow-region-shape-invalid` explanation (`os explain`) now also names the server as a reader of the rule and the body it judges.
