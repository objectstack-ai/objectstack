---
'@objectstack/metadata-protocol': patch
'@objectstack/cli': patch
---

fix(metadata-protocol, cli)!: a package-less item of a name two packages hold is refused at both exact addresses for every narrowed type, and the layered read judges its exact address (ADR-0150 D4)

Clause-②: yes (narrowing) — `@objectstack/metadata-protocol` exports `judgesPackageLessRows` (a widened public surface), and reads that served now refuse: `?package=X` of an `action` whose environment item is package-less and whose name two packages hold, and `?layers=true&package=X` of a package-less stored row of a name two packages hold, go from 200 to 409 naming every holder.
Metadata-protocol: none
Skills-docs: none — `skills/**` and `content/docs/**` teach no exact or layered read of a package-less item of a name two packages hold; the prescription ships in the refusal text and the FROM → TO below.

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is whether an exact or layered by-name read answers or refuses, and the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** accept-set narrowing at the exact by-name read (`GET /meta/:type/:name?package=X`, the qualified path `GET /meta/:type/:ns/:name`) and the layered read (`?layers=true`), on both transports and in process.

A package-less item (the environment's item, or a `sys_metadata` row bound to no package) is the customization of one holder (ADR-0150 D4). With two holders it cannot say which. Since #31699 each holder's exact address refused it, but only for the types whose by-name readers consult `(package, name)`. A type whose one-holder rule had narrowed to the namespace without that wiring kept serving it at both addresses. `action` is that type today (#31697).

1. `?package=X` of an `action` name two packages hold, when the environment's item of that name is package-less (registered with no package, or a stored row hydrated into the registry), answered `200` with that item at both holders' addresses. It is now `409 RESOURCE_CONFLICT`, `ambiguous-in-closure`, naming every holder. One holder is served as before, and so is an item bound to one holder.
2. `?layers=true&package=X` judges its code layer and its stored row as the plain read judges what it serves there. A package-less stored row of a name two packages hold was reported as the overlay of each holder's address. It is now the same `409`. This holds for every type the exact read judges (`email_template`, `agent`, `action`, …).
3. The rule follows the narrowing: every type in `NAMESPACE_SCOPED_BARE_NAME_TYPES` (`@objectstack/core`) is judged from the change that narrows it, whether or not its readers are wired yet (`judgesPackageLessRows`, exported).
4. `os migrate stored-references` lists the package-less rows of those types too, so the rows refused above are named with every candidate.

A stored package-less row of an action a package ships, while it is only stored (not hydrated into the registry), is still declined at each holder's plain exact read (ADR-0126 Regime C), so the plain read keeps serving the holder's own action there. Once such a row is hydrated into the registry it is the environment's item of item 1 above, and refused there.

No first-party composition has two packages holding one action name, so no answer changes in this repository.

The fix:

- FROM `GET /meta/action/NAME?package=<holder>` (or `?layers=true`) refused for a package-less item TO saving the customization under the one package it customizes, then deleting the package-less row. `os migrate stored-references` lists each such row with its candidates.
