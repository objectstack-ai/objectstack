---
'@objectstack/spec': patch
---

liveness ledger: `translation`'s `_note` WALK BOUNDARY sentence excepts `settingsCommon` and states that group's own boundary

The header said "every group is a z.record keyed by target names — the drill sees each
record's VALUE shape one level". Measured on this commit straight off
`translationDataShape()`, ten of the eleven groups are `z.record`s and `settingsCommon` is a
plain strictObject: a fixed shape whose one member `sourceLabels` is itself a fixed
strictObject keyed by the ADR-0010 resolution layers (`env`, `global`, `tenant`, `user`,
`default`) — a closed set, with the retired spellings (`org`, `workspace`, `system`,
`fallback`, `environment`) rejected and pointed at the layer each meant. Nothing about it is
keyed by target names, so the universal was false for one group, and false in the direction
that matters: the sentence is the file's declaration of how far down its rows reach.

The sentence now excepts `settingsCommon` and states what the boundary is for it: the
walk's one level lands on the named member `sourceLabels` (exactly what
`check:liveness --undrilled` prints for `translation/settingsCommon`), the layer keys
beneath it sit below the boundary and are read as one unit by `resolveSettingsSourceLabel`
and objectui's `useSettingsLabel`, and the blanket verdict over them is the declared kind —
`translation/settingsCommon` is already a row of `undrilled-containers.baseline.json`, so
no new pinned artifact is added. The `datasets` row's "WALK BOUNDARY as for every other
group here" inherited the same universal by reference and now cites the record groups only.

Published data, prose only: `liveness/` is in this package's `files` array, so these
ledgers ship in the npm tarball. No `status` value moves, no schema changes and no gate
verdict changes. The header's summary-count sentence (#15775) is untouched.
