---
"@objectstack/metadata-protocol": patch
---

Adopting loose items into a base no longer moves an overlay of a packaged item, and the views it does move are served from the base at once

Clause-②: no

- `POST /api/v1/packages/ID/adopt-orphans` rebound every metadata row bound to no package into the base. That included a row that overlays an item a package ships, such as a list view edited and saved from the record list, or an edited copy of a package's view container. Once bound to the base, such a row stopped customising the packaged item. After a restart, an adopted overlay of a package's view container added views under its own name, and the package's own view was served again. An adopted overlay of one packaged view was listed twice under its name.
- ADR-0070 keeps an overlay of a packaged item bound to the item it customises, so the adoption now leaves such a row as it is stored. A row is skipped exactly when a save of it would be an overlay (`override-artifact`). An environment whose only rows bound to no package are such overlays now answers `reassignedCount: 0` and `success: false`.
- Each view row the adoption does rebind is now written through to the process registry with the binding it left. So `GET /api/v1/meta/view`, `GET /api/v1/meta/view?object=OBJECT` and the by-name read serve it from the base right away, not after the next restart.
- A view container's views are reconciled the way a publish reconciles them. What the row registered before the move counts as its own, so a later write of a row of that name bound to no package no longer removes the moved row's views.
- Unchanged: the request and the response shape (`success`, `reassignedCount`, `reassigned`, `targetPackageId`). Also unchanged: rows already bound to a package, organization-scoped rows, and rows of other types, which are rebound in storage only.
- There is no public export, signature or schema change.
