---
'@objectstack/plugin-security': patch
---

A data-door edit of a permission set saved into a writable runtime package updates that set's stored definition instead of forking it

Clause-②: no

Setup saves a permission set through the data door (`PATCH /api/v1/data/sys_permission_set/:id`), which redirects the edit into the metadata store. A stored definition row is keyed by its package as well as its name, and the redirected save named no package. For a set saved into a writable runtime package (`PUT /api/v1/meta/permission/:name?package=<id>`), whose only stored row is bound to that package, the save therefore created a second, package-less row carrying the edit and left the package's row untouched: two active definitions for one name, with the package's copy no longer receiving the organization's edits. The save now goes into the package the edited row is bound to, read from that row through the metadata door's own item read, so the edit lands on the set's one row and the row stays in its package.

Unchanged: a set with no package binding still saves with none, and a set a code package ships is still refused with `403 NOT_OVERRIDABLE` before anything is read or written. The edit answers `200` as before; no error code, route or field moves.
