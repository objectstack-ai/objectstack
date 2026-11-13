---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(metadata-protocol)!: a stored row bound to a package that holds no item of its name is no longer laid into the first-registered holder's registry slot when two or more packages hold the name, and a customization pair's row of such a name takes the envelope of the holder it customizes, not the first holder's (ADR-0150 D4)

Clause-②: no (narrowing) — served answers that guessed a holder go away: a registry reader of a holder's item stops answering another package's stored row as the holder's own. Nothing that was refused is now served, and no export of either package's entry point is added (`SchemaRegistry#overlayRowBinding` gains an optional `includeDisabledPackages`).
Metadata-protocol: none
Skills-docs: none — `skills/**` and `content/docs/**` teach no stored row bound to a package that holds none of its name, and no pair row of a two-holder name; the prescription ships in the FROM → TO below.

<!-- adr-0087: registered stored-row-of-a-non-holder-under-two-holders -->

**BREAKING** for a registry reader of a holder's item of a package-scoped type whose name two or more installed packages hold: `getPackageScopedItem(type, name, holder)` (what a dispatcher takes, such as the declared-webhook dispatch), the list scoped to the holder (`GET /meta/:type?package=<holder>`), the registry list, and the holder's exact read (`GET /meta/:type/:name?package=<holder>`) on a kernel with no metadata service. The types are every type ADR-0150 addresses by `(package, name)` except `flow`, `permission` and the row-served types (`dashboard`, `report`, `email_template`, `page`, `app`, `dataset`, `doc`, `book`, `mapping`): `action`, `hook`, `job`, `webhook`, `connector`, `sharing_rule`, `queue`, `assignment_rule`, `analytics_cube`, `picklist`, `api`, `tool`, `skill`, `agent`.

The read-side hydrator (the boot load, an unscoped list read, the write-through of a save) builds a registry entry from each stored `sys_metadata` row. It looked up the envelope of the row's package with a lookup that, when that package holds no item of the name, answers the package registered FIRST. So, with two holders:

- a row bound to a package that holds no item of the name (a package installed for an older release, or a row saved under the wrong `?package=`) took the first-registered holder's slot under that holder's envelope, and that holder answered the row as its own: a different holder in each registration order;
- a row bound to a customization pair (ADR-0146) took the first holder's envelope the same way, so the first holder answered the second holder's override.

Now:

- the first is declined, as a package-less row of such a name is (#32568): it lands in no holder's slot, and the boot census `metadata_sealed_overlay_unserved` names it (every type listed above is sealed once a package ships the name, ADR-0131 D6);
- a pair row takes the envelope of the holder its binding names (`overlayRowBinding`, the rule the exact read and every overlay-slot reader follow), judged over every holder, a disabled one included, so a disable never moves it (ADR-0150 D3);
- a pair row whose binding names no holder (a shared App pair's row that declares no `overrides.package`, or a row declaring a package the pair does not customize) is declined, as the exact read at the pair's address already refuses it `409` naming the holders.

Not changed: a name one package holds (every row keeps its reading); a row bound to a package that holds the name itself; `permission` (a stored fork of a permission set keeps its own ruling's disposition, as the boot census already exempts it); the row-served types (their reads answer such a row from the row, as before); `flow` (its rows register as tenant rows).

Carried, not fixed here (registry-wide, with the per-package overlay slot on the ADR-0150 epic line): two rows bound to two different holders still leave the last one read in the name's one bare slot; a copy registered while one package held the name (or none) is not taken back when a second holder installs, so until a restart the next unscoped hydration can still lay it into the first holder's slot.

No first-party composition has two packages holding one name with such a row, so no answer changes in this repository.

The fix:

- FROM a stored row bound to a package that holds no item of a name two packages hold, read as one holder's own through the registry, TO nothing for the types above but its removal (`DELETE /api/v1/meta/<type>/<name>?package=<stray package>`): each is sealed, so no stored customization of a shipped item of these types is served (ADR-0131 D6). For an `action`, the one listed type ADR-0146 admits a declared override for, save the change as the declared override of the holder it customizes, in that holder's paired `.custom` package (`?package=<holder>.custom` with `overrides: { package: <holder>, basedOn }`), then delete the stray row.
- FROM a pair row of one holder read as another holder's item TO nothing: the row is now read as the item of the holder it customizes. A pair row that names no holder is now served by none; declare `overrides.package` to name the holder it customizes.
