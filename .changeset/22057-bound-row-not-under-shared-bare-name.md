---
'@objectstack/metadata-protocol': patch
---

A by-name view read naming a package now serves that package's view when another package's stored row has the same name

Clause-②: no

- **What was wrong.** Two installed packages can ship a view of one name, and a stored `sys_metadata` view row can be bound to one of them. The registry hydration registered that row under the view's bare name. The registry answers the bare name ahead of every package's own entry, whichever package the read names. So `getMetaItem` naming the OTHER package found no row of its own and served this row's body at its registry step, under the other package's envelope. That is the read behind `GET /api/v1/meta/view/NAME?package=…`. Meanwhile the list's slot for that package served its own view. This was measured on an unscoped kernel after a save, and on either kernel after a cold boot, because `loadMetaFromDb` hydrates through the same door on every kernel.
- **What it does now.** A view row bound to one package is not registered under a name another package ships. This is the shape the view-container expansion registration already takes. The reads answer the row from the row itself: the read naming its own package, the read naming no package, and the list's slot for that package. The read naming the other package serves that package's own view and envelope. The delete's registry heal also stops re-registering a metadata-service view baseline bound to one package under such a name.
- **Scope: `view` only.** Every other type registers as before: a row bound to one package, of a name two packages ship, keeps the bare entry with its own body and its own package's envelope. A package-less view row, and a view row of a name that only its own package ships or that no package ships, also register as before. The environment-scoped kernel's answer after a save is unchanged, because it registers nothing on a save.
- ⛔ No public export, signature, schema or accept-set change. Nothing is accepted or refused differently. The built entry declarations gain one `private` member name on `ObjectStackProtocolImplementation`.
