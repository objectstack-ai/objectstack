---
'@objectstack/runtime': patch
---

fix(runtime): a flow name two packages hold is refused at `/api/v1/automation` with a remedy that works from there: the metadata door's `?package=` route, not the `?package=` this door does not read

Clause-②: no

A flow name that two or more packages hold is refused `409 RESOURCE_CONFLICT` by the `/automation` definition doors, because they save and delete without naming a package. The refusal is unchanged. Its remedy is not: the doors used to relay the metadata store's sentence, "on the REST door add ?package= with the package id", and `/automation` reads no `?package=`. A caller who followed it got the same `409` again.

The answer is still `409 RESOURCE_CONFLICT`. Its text now names a route that takes the package, and still states what was refused and which packages hold the name:

- **`PUT /api/v1/automation/NAME` and `POST /api/v1/automation`** name `PUT /api/v1/meta/flow/NAME?package=` with one of the listed packages and the flow definition as the body.
- **`DELETE /api/v1/automation/NAME`** names `DELETE /api/v1/meta/flow/NAME?package=`, which removes that package's row and keeps the others. That route is the REST server's `/meta` door, the one `os serve` mounts. A host that sends every request to the runtime dispatcher (the `@objectstack/hono` catch-all) serves no `DELETE` on `/meta` and answers it `405`.
- **`POST /api/v1/automation/SOURCE/clone`** onto such a name answers the clone door's own taken-name refusal: a clone takes a new machine name, and the refusal suggests one.

The door recognises this refusal by its envelope (`RESOURCE_CONFLICT` / 409), then reads the packages from the served flow list. When that list does not show the name held by two or more packages, the store's refusal is relayed as before.
