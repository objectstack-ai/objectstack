---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the customizations read lists a moved edit under the package that serves it

Clause-②: no — what the customizations list holds for a moved edit; no accept set changes
Metadata-protocol: none

When a later version of an App moves an item from one of its packages to another (an ADR-0130 D4 suite split, or its rollback), the tenant's edit of the item is served at the package that ships it now. `GET /packages/:id/customizations` (`listServedOverrides`) now lists that edit there too, and only there.

- **Before.** The list took a pair override's package from its declaration, the owner at the time of the edit. After a flat → composed split the edit was listed under the App, which no longer ships the item, and not under the module that serves it; after a rollback it was listed under neither.
- **Now.** The list picks each item's row through the served reads' own candidates and predicates (`servedOverlayRowCandidates`, `holdsServedOverlayCandidate`, `isMovedOverrideRowOf`), so a package lists exactly the pair override its address serves. Same App is read only from the install record (`appOf` over the installed manifests), never from an id prefix; a row of another App's pair, or a declaration naming another App, is never listed.
- **Unchanged.** An edit whose owner still ships the item is listed as before. The list stays the pair's rows: a row bound to a package of the App itself (saved before ADR-0146 D11) is listed under no package, before or after a move. The upgrade plan's override advice reads this list, so it follows the same rule. The item lock already reads every stored row of the item whichever package it is bound to, so it answers for a moved edit what it answers for an edit saved at the new owner; that is pinned, not changed.
- **Nothing is written.** The read moves and rewrites no row.
