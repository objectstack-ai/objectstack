---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a package commit's revert plan and its revert address the committing package's own row; a revert whose row was deleted asks the package-less close, as the per-item rollback does

Clause-②: no (narrowing) — the commit revert (`POST /api/v1/packages/:id/commits/:commitId/revert`) and the package rollback (`POST /api/v1/packages/:id/rollback`) no longer restore a stored version into the package-unbound row when the committing package's own row of the item is gone, on an item of the five overlay types one installed read-only package ships, where `os migrate packageless-overlays` would move such a row into the base's paired `<base>.custom`; they inserted that package-less row before. The per-item rollback on the same package-less address has refused it since `packageless-overlay-write-closed`.

Metadata-protocol: none

Skills-docs: none needed — `skills/objectstack-platform/SKILL.md` already says the package-less save, reset and rollback of a movable row are refused once movable (D11), and places every customization of an installed base in its paired `.custom`; nothing it says becomes false.

<!-- adr-0087: not-required (already-registered packageless-overlay-write-closed) That entry, unreleased and shipping in the same release, already prescribes this change's TO for every package-less write onto an item an installed read-only package ships: write it into the base's paired `<base>.custom` with `PUT /api/v1/meta/<type>/<name>?package=<base>.custom` and the `overrides` declaration (its replacement), because the customization lives there (its reason, ADR-0146 D1, D2, D11). This change closes the commit doors' restore into the package-less row, the one package-less write the per-item rollback already refuses and the commit revert still made, onto the same TO. No stored row is rewritten or moved, so `objectstack migrate meta` has nothing new to do. -->

**BREAKING** write narrowing at the commit doors (`@objectstack/metadata-protocol`), shipped as `patch` (`Metadata-protocol: none`).

The plan a package publish records (`POST /api/v1/packages/:id/publish-drafts`, the commit's `existedBefore` and `prevVersion` per item) now reads the publishing package's own active row, and the revert removes or restores that row only. Before, both read any package's active row of the name: the first publish of a `<base>.custom` pair's declared override beside a row bound to the base (stored before the write naming the base was closed) was recorded as an edit of the base row's version, and its revert addressed the base row, refused there instead of removing the pair's row. It now removes the pair's row, and the row bound to the base is served again. Commits recorded before this change keep the plan they recorded.

### Migration: FROM → TO

FROM, undoing a commit of the installed package `com.acme.crm` (recorded before the write naming it was closed) that edited a customization whose row was deleted since:

```http
POST /api/v1/packages/com.acme.crm/commits/cmt_123/revert
```

It now answers `200` with `success: false`, and the item in `failed[]` with `code: NOT_OVERRIDABLE` and the sentence the per-item rollback gives; nothing is written. TO, write the version you want back into the base's paired `.custom`, declaring what it overrides:

```http
PUT /api/v1/meta/view/account_list?package=com.acme.crm.custom
{ "name": "account_list", "label": "My accounts", "overrides": { "package": "com.acme.crm", "basedOn": "1.4.0" } }
```

- **Now refused, per item.** The restore of a commit item whose row in the committing package is gone, of a `view`, `dashboard`, `report`, `translation` or `email_template` one read-only package ships, where the package-less close applies (the row would be one `os migrate packageless-overlays` moves). The commit's other items still revert, and `POST /api/v1/packages/<id>/rollback` reports the item in its `failed[]` and continues.
- **Still open.** Every restore into a row the committing package holds (a writable package's in place, the pair's in place), every removal, and every package-less restore the close leaves open (a name no read-only package ships, or one several ship).
