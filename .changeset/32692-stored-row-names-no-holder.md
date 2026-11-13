---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a stored row bound to a package that holds no item of its name is no longer laid into the first-registered holder's registry slot when two or more packages hold the name, and a customization pair's row takes the envelope of the holder it customizes, not the first holder's (ADR-0150 D4)

Clause-②: no (narrowing) — two served answers that guessed a holder go away: a registry reader of a holder's item stops answering another package's stored row as the holder's own. Nothing that was refused is now served, and no export is added (both rules are module-internal).
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach no stored row bound to a package that holds none of its name; the prescription ships in the FROM → TO below.

<!-- adr-0087: registered stored-row-of-a-non-holder-under-two-holders -->

**BREAKING** for a registry reader of a holder's item of a package-scoped type (every type ADR-0150 addresses by `(package, name)` except `flow` and the row-served types `dashboard`, `report`, `email_template`, `page`, `app`, `dataset`, `doc`, `book`, `mapping`) whose name two or more installed packages hold: `getPackageScopedItem(type, name, holder)`, the list scoped to the holder (`GET /meta/:type?package=<holder>`) and the registry list scoped to it.

The read-side hydrator (the boot load, an unscoped list read, the write-through of a save) builds a registry entry from each stored `sys_metadata` row. It looked up the envelope of the row's package with a lookup that, when the package holds no composite slot of the name, answered the FIRST package that registered it. So:

- a row bound to a package that holds no item of the name (a package installed for an older release, or a row saved under the wrong `?package=`) took the first-registered holder's slot under that holder's envelope, and that holder's registry item answered the row as its own. Which holder depended on registration order.
- a row bound to a customization pair (`<holder>.custom`, ADR-0146) of the second holder took the first holder's envelope the same way, so the first holder answered the second holder's override.

Now the first is declined, as a package-less row of such a name is (#32568): it lands in no holder's slot, and the boot prints `metadata_stored_row_names_no_holder` once per row naming the row, its package and the holders (the boot census `metadata_sealed_overlay_unserved` names it instead for a sealed type). The second takes the envelope of the holder its binding names (`overlayRowBinding`, the rule the exact read and every overlay-slot reader already follow): the holder it customizes, or none when the binding names none.

Not changed: a name one package holds (the row is still that holder's customization); a row bound to a package that holds the name itself, including a bundle addition's own member; the row-served types listed above, whose reads answer such a row from the row; `flow` (its rows register as tenant rows); the exact reads, which already refused these rows. Two rows bound to two different holders still leave the last one read in the name's one bare slot: that is the registry's one-slot-per-name storage, carried by the per-package overlay slot card on the ADR-0150 epic line.

No first-party composition has two packages holding one name with such a row, so no answer changes in this repository.

The fix:

- FROM a stored row bound to a package that holds no item of a name two packages hold, read as one holder's own through the registry, TO the declared override of the holder it customizes, in that holder's paired `.custom` package (`?package=<holder>.custom` with `overrides: { package: <holder>, basedOn }`), saved after deleting the stray row (`DELETE /api/v1/meta/<type>/<name>?package=<stray package>`); or only the delete, when the row customizes nothing.
- FROM a pair row of one holder read as another holder's item TO nothing: the row is now read as the item of the holder it customizes. A pair row that names no holder (`overrides.package` absent, and the pair customizes several holders) is served by none, as the exact read already answers; declare `overrides.package` to keep it.
