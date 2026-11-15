---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the by-name read of an action grafts a package's artifact envelope only onto the item that package holds at its own `(object, name)`, so the environment's own action on another object is served as the environment's (#33456)

Clause-②: no
Metadata-protocol: none

ADR-0150 D4 keys an action by `(package, object, name)`. The by-name read (`getMetaItem`, `getMetaItemForExecution`) looked the served item's artifact envelope up by name alone, so beside ONE package that binds an action name to one object, the environment's own package-less action of that name bound to another object (or object-less) was served carrying that package's `_packageId`, `_packageVersion` and `_provenance: 'package'`.

What moves, with ALPHA and BETA two packages and `approve` the action name:

- ALPHA binds `approve` to `account`, the environment's own row binds it to `contact` (or BETA binds it to `contact` alone and the row binds it to `account`): `GET /api/v1/meta/action/approve` on `RestServer` and the runtime dispatcher, `getMetaItemForExecution`, and the declaration `/actions/contact/approve` (`/actions/account/approve` in the second shape) judges, serve the environment's item with no package envelope, FROM the holder's `_packageId` and `_provenance: 'package'`. The route's `packageId` stays unset and the environment's handler runs, as before.
- The same with the row object-less beside ALPHA on `account`, or bound to `account` beside ALPHA object-less: no package envelope, FROM ALPHA's.

Not changed: a package-less row on the object a package binds the name to (that package's customization, still under its envelope); a name two packages hold on one object (refused, naming both); a name one package holds with no package-less row; a read naming a package (`?package=`), which keeps that package's own item and envelope; every type other than `action`; stored rows (no migration).
