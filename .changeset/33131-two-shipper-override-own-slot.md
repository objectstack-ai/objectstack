---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: when two packages ship one name and one declares its `.custom` override, each package's address, list entry and registry slot serve that package's own item, for an action, the six sealed types and the env-wide list of every type (ADR-0150 D4)

Clause-②: no (narrowing) — two answers that served one package's row under another package go away: the first-registered package's action slot (env-wide list, execution view, registry item) no longer serves the second package's override in place of its own shipped action, and the env-wide list of every type no longer lists a second package's override a second time under the first package. Nothing that was refused is now served under a package it does not customize; the second package's declared override of a page, app, dataset, doc, book or mapping is now served at its own address, as ADR-0150 D4 binds each override to the package it names. No export is added.
Metadata-protocol: semantic
Skills-docs: none — `skills/**` (the platform skill's customization paragraph) teaches the declared override served at its base's address for every overridable type, with no holder order; that sentence was false only for the second-registered of two namespaces shipping one name, and is now true for both, so no taught sentence moves.

<!-- adr-0087: registered two-shipper-declared-override-own-slot -->

**BREAKING** for a reader of a name two installed packages ship, one with a declared `.custom` override: the env-wide list (`GET /meta/TYPE` naming no package), the execution view (`getMetaItemsForExecution`) and the registry's item of an action at the first-registered package (`getPackageScopedItem`, with one package overridden). An entry stamped with one package that carried the other package's override is no longer served. Nothing in the workspace reads those entries.

Two packages of two namespaces, alpha and beta, ship one name; only one declares an override in its own `.custom` pair.

- **An action** (the wrong body ran). The read-side hydrator registered the pair's override row under the bare name wearing the envelope the artifact lookup answers for the pair's id, which ships nothing, so it fell to the first-registered package. Alpha first and only beta overridden, the env-wide list and the execution view read `alpha:OVR-B` beside `beta:OVR-B`: alpha's slot ran beta's override. Beta first and only alpha overridden, `beta:OVR-A` beside `alpha:OVR-A`. The row now wears the envelope of the holder it customizes, by the one pair-row rule `pairRowEnvelopeHolder` (it landed with #32692 while this change was in review, so this change pins that face and adds no second rule for it), and the lists read exactly `beta:OVR-B` and `alpha:SHIPPED-alpha` (or the mirror), each address and each package's registry item agreeing, with either package disabled in turn.
- **A page, app, dataset, doc, book or mapping** (the override did nothing). The reads judged the declaration against the name's first-registered package alone, so the second package's override was declined at its own address (plain and layered: its shipped item served), even with the first package disabled, and the boot report `metadata_sealed_overlay_unserved` told the admin to delete it. Now it is judged against every package that ships the name, as a flow's and an action's already are, and the report names it no longer. A stranger's row declaring a holder stays unserved and named.
- **The env-wide list of every type** (dashboard, report and email template too). For a name two packages ship, it listed the pair's slot of a declared override beside the overridden package's own entry, stamped with the first-registered package: `alpha:EDITED-beta` beside `beta:EDITED-beta`. The pair's slot is now dropped for every type, as it already was for a flow and an action; a bundle's row only at a member its declared base ships (a pair's added locale is kept).

With **both** packages' overrides declared, every read face (the lists, the execution view, each address, plain and layered) serves each package's own override in either registration and save order. The registry's own package-scoped item of an action keeps one bare slot per name: it serves the override published last, and the other package's registry item answers that package's own shipped action, never the other package's override (on `main` it could). That face is pinned as it stands and carried on the card; its fix is the registry's slot model.

The read naming no package is pinned too: with both packages enabled it refuses `409` for every type but `doc`; with one disabled it serves the enabled package's own item, its declared override when it has one (on `main`, the second-registered package's override of a sealed type was declined there).

Unchanged, pinned as CONTROLs: one package ships the name, with or without its declared override; two packages ship it and neither is overridden.

The fix for a reader: read each package's item by its package (`?package=ID`), or from its own entry of the env-wide list.
