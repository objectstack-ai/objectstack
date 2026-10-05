---
'@objectstack/plugin-security': patch
---

A permission set an organization owns, a clone of a packaged set, and a set saved into a writable runtime package are no longer locked as if a code package shipped them

Clause-②: no

The packaged-permission-set lock decides "is this set shipped by a code package?" from the engine registry. The registry also holds the stored definition rows, and a metadata list read (`GET /api/v1/meta/permission`, which every Studio page load issues) stamps a stored row's package binding onto it. A set saved into a writable runtime package (`PUT /api/v1/meta/permission/:name?package=<id>`) therefore looked code-shipped after the first list read, and every later edit of it answered `403 NOT_OVERRIDABLE` at both the metadata door and the data door. The lock now skips a stored row by its provenance (`_provenance: 'org'`, which every stored row carries), the same test the platform's code-artifact check applies, so those edits are accepted again.

The read had the matching defect. The security plugin keeps a marked in-memory copy of each stored definition for the permission evaluator, and the layered read (`GET /api/v1/meta/permission/:name/layers`) serves that copy as the item's `code` layer. The copy carried no provenance, so an org's own set, a clone and a runtime-package set all reported a `code` layer with no `provenance`, which the console's permission-matrix editor renders as "locked by a code package" while the server accepted the save. The copy now carries `_provenance: 'org'` exactly when the lock judges the set not code-shipped, so the layered read reports `provenance: 'org'` for those sets.

Unchanged: a set a code package ships is still refused at both doors with `403 NOT_OVERRIDABLE` and the same message naming the clone path, and its layered read still reports `provenance: 'package'`, its package id and `editable: false`. No error code, route or field moves.
