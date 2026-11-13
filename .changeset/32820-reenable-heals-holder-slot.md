---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: enabling a second holder of an overlay name takes back the package-less row the read-side hydrator laid into the first holder's registry slot while the second was disabled (ADR-0150 D4)

Clause-②: no (narrowing) — a served answer that guessed a holder goes away: after the enable, a holder's registry item, its scoped list and its registry list answer the holder's own item where they answered the environment's package-less row as the holder's own. Nothing that was refused is now served, and no export is added (the heal is module-internal).
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach no registry read of a holder's item after a disable and enable; the prescription ships in the FROM → TO below.

<!-- adr-0087: registered package-less-overlay-row-holder-slot-on-reenable -->

**BREAKING** for a registry reader of a holder's item of an overlay-type name (`email_template`, `dashboard`, `report`) that another installed package also holds, when a package-less `sys_metadata` row of the name is stored: `getPackageScopedItem(type, name, holder)` (what a send-time read takes), the list scoped to the holder (`GET /meta/:type?package=<holder>`) and the registry list scoped to it.

While one of the two holders is disabled, the other is the one served holder (#32183), so the package-less row is its customization: the read-side hydrator (an unscoped list read, the boot load) lays the row into that holder's slot under its envelope. Enabling the disabled holder ran no hydration, so the slot kept the row, and until the next unscoped list read the holder's registry item and its scoped list answered the environment's row as the holder's own, and its registry list listed both. The protocol's exact read (`?package=<holder>`) already refused it `409` naming both holders.

The enable now builds the entry again, as the hydrator builds it for the holders served then: with two served, no holder's envelope, so each holder's slot answers its own item, as when the hydrator ran with both served. It runs inside the enable, so every enable door (`PATCH /packages/:id/enable`, an install's `enableOnInstall`) answers after it. An entry another write replaced after the hydration is that write's, and is not touched.

Not changed: the disabled period itself (the one served holder's slot serves the row, as #32183 rules), the exact reads, and a package installed after the hydration that ships the name (the slot keeps the row until the next unscoped hydration, as before: no registry notice reaches the protocol for a new holder).

No first-party composition has two packages holding one overlay name with a package-less row, so no answer changes in this repository.

The fix:

- FROM a package-less overlay row of a name two packages hold, read as one holder's own through the registry after a disable and enable, TO the declared override of that holder in its paired `.custom` package (`?package=<holder>.custom` with `overrides: { package: <holder>, basedOn }`), saved after deleting the package-less row (a package-less delete removes the one bound row there is, so after the save it would remove the override).
