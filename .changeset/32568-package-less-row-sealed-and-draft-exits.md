---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a package-less row at a holder's exact address answers one thing on every read and in every hydration state: declined for a sealed type, refused with two holders for an overlay type (ADR-0150 D4, ADR-0126 Regime C)

Clause-②: no (narrowing) — reads that served now refuse: an overlay type's package-less draft of a name two packages hold, at either holder's strict draft read, preview and layered `draft` layer, goes from 200 to 409 naming every holder, and a sealed type's package-less draft from 200 to no draft at the address. The reads that refused and now serve a sealed type's holder's own item (its package-less registry copy at a holder's exact address, and its layered read, 409 → 200) drop a refusal the governing text denies, so they are no widening: ADR-0126 Regime C declines a sealed managed type's package-less row, and the epic ruling on this card (6817768147) reads it at the exact address as "With the row declined, `?package=X` names its holder explicitly and serves X's own shipped item, exactly as it would with no row stored." No export is added (the new helpers are module-internal).
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach no exact, draft or layered read of a package-less row of a name a package holds; the prescription ships in the refusal text and the FROM → TO below.

<!-- adr-0087: registered package-less-row-exact-address-by-type-class -->

**BREAKING** at the exact by-name read (`GET /meta/:type/:name?package=X`, the qualified path `GET /meta/:type/:ns/:name`), its strict draft read (`?state=draft`), its preview (`?preview=draft`), the layered read (`?layers=true`, its `draft` layer included) and the list scoped to a package with drafts previewed, on both transports and in process.

A package-less row is a `sys_metadata` row bound to no package, or its copy in the registry's bare slot after a hydration. The answer at a holder's exact address now depends on the type class, never on the read or on whether a hydration ran:

1. **An overlay type** (`email_template`, `dashboard`, `report`): the row is a holder's customization (ADR-0150 D4). With one holder it is served there. With two it is refused `409 RESOURCE_CONFLICT`, `ambiguous-in-closure`, naming every holder. The active read already did; now the strict draft read, the preview and the layered `draft` layer do too, and the list scoped to a holder no longer previews such a draft.
2. **A sealed managed type** (artifact-backed and no overlay channel: `action`, `agent`, `page`, `hook`, `job`, `queue`, `sharing_rule`, `assignment_rule`, …): the row customizes nothing, so it is declined (ADR-0126 Regime C) and the address serves its holder's own item, with one holder or two. The plain active read already declined the stored row. Now a registry copy of it is declined too (served `409` with two holders and the row with one), and so are the strict draft read (no draft at the address), the preview (the active item), the layered read (`overlay: null`, the holder's own as `effective`) and the layered `draft` layer (`null`). The bare read of a name two packages hold keeps its `409`. The `/actions/:object/NAME` route that names no package reads each refused holder's exact address for the holder that owns its object, so an environment action bound to an object neither holder binds is no longer found there through the first holder's address (it answered that item; it now answers no declaration).
3. **The read-side hydrator** (an unscoped list read, the boot load and the write-through) no longer looks up an envelope with no package. That lookup took the FIRST package holding the name, so a package-less row was laid into that holder's slot as its own item, and after one list read `?package=<first holder>` served the stored body. A package-less row now wears its one holder's envelope, or none with two holders. A sealed type's declined row is not registered at all.

No first-party composition has two packages holding one name with a package-less row, so no answer changes in this repository.

The fix:

- FROM `GET /meta/<type>/NAME?package=<holder>&state=draft` (or the preview, or `?layers=true`) refused for a package-less draft of an overlay type TO saving the customization under the one package it customizes, then deleting the package-less row.
- FROM a sealed type's package-less row that no read serves TO a declared override in the holder's paired `.custom` package (ADR-0146), then deleting the package-less row.
