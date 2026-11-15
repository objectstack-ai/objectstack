---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: the read naming no package withholds a customization pair's row of a name every holder of which is disabled (ADR-0150 D3, #32814)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill and no doc teaches what the read naming no package answers at a member only a customization pair stores (`skills/**` and `content/docs/**` grepped for disabled packages: the hits are action and component `disabled` predicates, package lifecycle references and a release page); `content/docs/deployment/marketplace-handbook.mdx` already says a disabled module is hidden.

<!-- adr-0087: registered disabled-holder-pair-row-bare-read-withheld -->

**BREAKING** answer narrowing at the `/meta` item read that names no package: at a member only a customization pair (an App's `PACKAGE.custom`) stores, for a name every installed package holding it has disabled, the read answers the holder's withheld item (404 `RESOURCE_NOT_FOUND` on the doors), where it served the pair's row. It is the answer the same read gives with no row stored, and the answer the pair's own address (`?package=PACKAGE.custom`) already gave.

The read judged the name's holders (`disabledOnlyHolderOf`) only when it reached nothing. It now also judges them when it reaches a row stamped with a customization pair (`pairsOf`) of a package that holds the name. A pair row is bound over the holders it is a pair of and is never a holder of its own, so it is withheld with them.

**Every moved answer, before → after.** Both save orders (row before and after the disable), with and without the boot's hydration of the row into the registry, for a module of an App and for the App itself as the holder. First-party count 0: no first-party app disables a package at boot.

- Bare `GET /meta/:type/:name?member=MEMBER`: 200 with the pair's row → 404 `RESOURCE_NOT_FOUND`.
- Bare `GET /meta/:type/:name/layers?member=MEMBER`: 200 with the pair's row as the effective layer → 404 `RESOURCE_NOT_FOUND` (the layered chain asks the plain read whether a disable withheld the item).
- The execution face (`getMetaItemForExecution`) of the same name and member: the pair's row → no item.

**Not moved.** Re-enabling a holder serves the pair's row again. Two modules of the App holding the name with one of them enabled: the pair's row is the enabled module's customization and is served as before, in either registration order. A row stored under a holder of the name, a package-less row, a row of a package that is no holder's pair, and every read naming a package are judged as before. The list reads (`getMetaItems`, `getMetaItemsForExecution`) are not changed here.
