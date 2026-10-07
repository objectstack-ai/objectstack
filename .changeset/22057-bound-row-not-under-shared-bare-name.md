---
'@objectstack/metadata-protocol': patch
---

A by-name metadata read naming a package now serves that package's item when another package's stored row has the same name

Clause-②: no

- **What was wrong.** Two installed packages can ship an item of one name, and a stored `sys_metadata` row can be bound to one of them. The registry hydration registered that row under the item's bare name. The registry answers the bare name ahead of every package's own entry, whichever package the read names. So `getMetaItem` naming the OTHER package found no row of its own and served this row's body at its registry step, under the other package's envelope. That is the read behind `GET /api/v1/meta/TYPE/NAME?package=…`. Meanwhile the list's slot for that package served its own item. This was measured on an unscoped kernel after a save, and on either kernel after a cold boot, because `loadMetaFromDb` hydrates through the same door on every kernel.
- **What it does now.** A row bound to one package is not registered under a name another package ships. This is the shape the container-expansion registration already takes. The reads answer the row from the row itself: the read naming its own package, the read naming no package, and the list's slot for that package. The read naming the other package serves that package's own item and envelope. The delete's registry heal also stops re-registering a metadata-service baseline bound to one package under such a name.
- **Unchanged.** Three kinds of row still register under the bare name as before. A package-less stored row overlays every package's item of its name. A row of a name that only its own package ships, or that no package ships. A stored row the reads decline (a shipped flow name, or a code-defined datasource name). A registry read naming no package keeps its first-match best effort (ADR-0048 §3.3). The environment-scoped kernel's answer after a save is unchanged, because it registers nothing on a save.
- ⛔ No public export, signature, schema or accept-set change. Nothing is accepted or refused differently. The built entry declarations gain one `private` member name on `ObjectStackProtocolImplementation`.
