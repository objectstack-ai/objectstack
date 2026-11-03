---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(metadata-protocol)!: a package commit's revert plan and its revert address the committing package's own row, and a restore into a `.custom` pair's row is judged by the override write gate

Clause-②: no (narrowing) — the commit revert (`POST /api/v1/packages/:id/commits/:commitId/revert`) and the package rollback (`POST /api/v1/packages/:id/rollback`) no longer restore a stored version into a `<base>.custom` pair's row unless the version declares the override the pair's save requires, and no longer restore into another package's row of the name, or into a package-less row, when the committing package's own row was deleted since: they restore into the committing package's row, so a commit of an installed read-only package itself whose row is gone is refused by the close naming the pair. They restored into whichever row of the name the store returned first, or inserted a package-less row, before.

Metadata-protocol: none

Skills-docs: none needed — `skills/objectstack-platform/SKILL.md` places every customization of an installed base in its paired `.custom`, declaring `overrides`, and says a pair row is honoured only when declared; nothing it says becomes false.

<!-- adr-0087: not-required (already-registered packageless-overlay-write-closed) That entry, unreleased and shipping in the same release, already prescribes this change's TO for every customization of an installed package: write it into the base's paired `<base>.custom` with `PUT /api/v1/meta/<type>/<name>?package=<base>.custom` and the `overrides` declaration (its replacement), because the customization lives there (its reason, ADR-0146 D1, D2, D11). Its surface and reason now name the commit doors as further addresses of the rollback it closes (text only, no new id). No stored row is rewritten or moved, so `objectstack migrate meta` has nothing new to do. -->

**BREAKING** write narrowing at the commit doors (`@objectstack/metadata-protocol`), shipped as `patch` (`Metadata-protocol: none`). `@objectstack/spec` carries the text widening of the `packageless-overlay-write-closed` upgrade entry.

The plan a package publish records (`POST /api/v1/packages/:id/publish-drafts`, the commit's `existedBefore` and `prevVersion` per item) now reads the publishing package's own active row, and the revert removes or restores that row only. Before, both read any package's active row of the name: the first publish of a `<base>.custom` pair's declared override beside a row bound to the base (stored before the write naming the base was closed) was recorded as an edit of the base row's version, and its revert addressed the base row and was refused there instead of removing the pair's row. It now removes the pair's row, and the row bound to the base is served again.

A pair commit recorded before this change beside such a row still names the base row's version as the pair's pre-commit state. Its revert now restores into the pair's own row, so the restored body meets the override write gate exactly as the pair's per-item rollback does: the base row's body declares no override, so the item is refused per item (`403 NOT_OVERRIDABLE`, the save door's sentence) and the pair's declared row stays as it is.

### Migration: FROM → TO

FROM, undoing a pair commit recorded before this change beside a row bound to the installed package `com.acme.crm`:

```http
POST /api/v1/packages/com.acme.crm.custom/commits/cmt_123/revert
```

It answers `200` with `success: false`, and the item in `failed[]` with `code: NOT_OVERRIDABLE`; nothing is written. TO, write the version you want into the pair, declaring what it overrides, or remove the pair's row to serve what is under it:

```http
PUT /api/v1/meta/view/account_list?package=com.acme.crm.custom
{ "name": "account_list", "label": "My accounts", "overrides": { "package": "com.acme.crm", "basedOn": "1.4.0" } }

DELETE /api/v1/meta/view/account_list?package=com.acme.crm.custom
```

FROM, undoing a commit of `com.acme.crm` itself (recorded before the write naming it was closed) that edited a customization whose row was deleted since: the restore wrote a package-less row. It now restores into the row bound to `com.acme.crm`, which the close refuses (`NOT_OVERRIDABLE`, the rollback sentence naming the pair); TO, the same `PUT …?package=com.acme.crm.custom` with the `overrides` declaration.

- **Now refused, per item.** A restore into a `<base>.custom` pair's row of a version that does not declare the override the pair's save requires (the override write gate). A restore of a commit of a read-only package itself into its row bound to the package, now also when that row was deleted since (the close naming the pair). The commit's other items still revert, and `POST /api/v1/packages/<id>/rollback` reports each refused item in its `failed[]` and continues.
- **Now restored into the committing package's row.** A commit whose row was deleted since, of a writable package or of the pair (a declared version): the row is created again under that package, never as a package-less row.
- **Still open.** Every restore into a row the committing package holds that the gate admits (a writable package's in place, the pair's declared version in place), and every removal.
