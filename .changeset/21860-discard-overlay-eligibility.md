---
'@objectstack/plugin-security': patch
---

Discard Overlay no longer deletes the stored definition of a permission set saved into a writable runtime package

Clause-②: no

The Discard Overlay action (`POST /api/v1/security/permission-sets/:id/discard-overlay`) is declared to refuse any set that is not package-declared, so that it can never destroy a set the environment authored. It decided that by asking whether any engine-registry item of the set's name carried a package id. The registry also holds the stored definition rows, and a metadata list read (`GET /api/v1/meta/permission`, which every Studio page load issues) stamps a stored row's package binding onto it. A set saved into a writable runtime package (`PUT /api/v1/meta/permission/:name?package=<id>`) therefore passed the check after the first list read: the action answered `200` and deleted the set's only `sys_metadata` row. It now asks the same classifier the packaged-permission-set lock's write doors ask, and refuses every set that classifier does not judge shipped by a code package (including when it cannot decide), with the action's existing `403 PERMISSION_DENIED`.

The drift diagnostics behind the record's `drift_status` / `drift_detail` (whose `overlay_shadow` detail names Discard Overlay as the remedy) read the package id the same way. They now judge the same population: only sets a code package ships.

Unchanged: a set a code package ships still has its overlay discarded and its record resynced to the shipped artifact, its drift is still reported as before, and no error code, route or field moves. The refusal's message now says the set is not shipped by any installed code package.
