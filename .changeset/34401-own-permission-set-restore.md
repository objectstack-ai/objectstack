---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a package's rollback, commit revert or package rollback of its own permission set is no longer refused because a package of another namespace ships a set of that name

Clause-②: yes (widening) — a rollback, a commit revert or a package rollback of a package's own permission set N, refused 403 `NOT_OVERRIDABLE` ("provided by a managed package and is sealed") while a package of another namespace ships N, now restores; a delete of that set answers "Deleted permission 'N' (package=P) — it no longer exists." in place of "Customization overlay deleted (package=P) — permission/N reset to artifact default.", with `reset: true` as before; nothing the doors accepted is refused
Metadata-protocol: none

A permission set is `(package, name)` (ADR-0150 D2/D9). The save door, the draft publish and the publish undo already judge a write of a package's own set `N` by the package it is addressed to. The per-item rollback (`POST /api/v1/meta/:type/:name/rollback`), the commit revert (`POST /packages/:id/commits/:commitId/revert`) and the package rollback (`POST /packages/:id/rollback`, which reverts commit by commit) still judged the name alone: when package `crm` shipped `N`, package `hr` of another namespace could not restore an earlier version of its own `N`. The rollback answered 403 `NOT_OVERRIDABLE`, and a revert listed `N` in `failed[]`.

Those restores now read the same verdict as the save. A restore into `hr`'s own `N` is a runtime write to `hr`, so the earlier version is restored and `hr`'s grants confer it. Every package that ships the name is judged, so the answer is the same in every registration order. A restore into a row bound to no package, to the shipper, to the shipper's customization pair or to a package that shares the shipper's set of the name is refused exactly as before.

A delete of `hr`'s own `N` already succeeded, but its receipt said an overlay was deleted and `N` was reset to its artifact default. `hr` ships no `N`, so the receipt now says the set was deleted and no longer exists. A delete naming `hr` when `hr` holds no `N` answers "nothing to delete" in place of "already at artifact default". The receipts for a customization of a shipped set are unchanged.

Nothing to migrate.
