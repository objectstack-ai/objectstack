---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix(objectql): a roll-up summary a disabled package adds by extension is recomputed when the package is enabled again

Clause-②: no — a stored summary column stays current across a disable; nothing a caller sends is refused
Metadata-protocol: none

- **Before.** While a package was disabled, the `summary` fields its `objectExtensions` add to another package's object were withheld from the roll-up index with the rest of the served fold. When the summary's child belongs to an enabled package, the child writes made during the disable landed and recomputed nothing, so after `PATCH /packages/:id/enable` the parent served the value the summary held at the disable, until the next write of one of its children.
- **Now.** Enabling a disabled package recomputes, on every parent row, the roll-ups it adds by extension, and writes a row only where its stored value differs. It runs on every enable door (`SchemaRegistry.onPackageEnabled`, new), and `PATCH /packages/:id/enable` (and an install's `enableOnInstall: true`) answers after it has settled. A row that cannot be recomputed is logged at `error` and the rest of the walk goes on; `ObjectQL.refreshSummariesEnabledBy(packageId)` (new) re-runs it.
