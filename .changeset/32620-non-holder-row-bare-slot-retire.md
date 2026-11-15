---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): after a deployment removes its customization of a name two packages ship, the deleted body is no longer served from the registry until the next reload

Clause-②: no
Metadata-protocol: none

The case: a stored row bound to an installed package that ships no item of the name (an App's customization, ADR-0146), on a name two packages ship, where the pair relation names no single base. After that row was deleted, the registry heal's baseline read was refused (two holders), and the heal stopped with an `error` line. For a `flow` or a `permission`, whose bound row sits in the name's bare registry slot, the removed row's entry stayed there. Until the next reload, a read naming the customizing package served the deleted body, and a read naming either holder was refused with that package as its candidate, although its row no longer existed.

The heal now retires that entry, as it already did for a package-less row (seat ruling 6812637203 Q2). Entry kept → retired, on the epic seat's ruling 6818436831. Retiring picks no holder and registers no baseline. Each holder's read answers its own item again, the read naming no package is the 409 naming both holders, and the list shows the two holders only. The retire verb still refuses a packaged artifact, so no holder's item can be removed.

The other package-scoped types already retired the bound row's own package slot. For them only the `error` line changes: it now says that slot was retired, where it said the entry was left as it was. A peer replica converging on a cluster signal that names no package still keeps the logged stop, because it cannot tell whose entry the bare slot holds.
