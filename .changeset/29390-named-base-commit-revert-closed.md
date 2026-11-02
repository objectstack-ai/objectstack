---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a commit revert or package rollback that would restore a row bound to an installed read-only package onto its view, dashboard, report, translation or email template is refused per item, naming the base's `.custom` pair

Clause-②: no (narrowing) — the commit revert (`POST /api/v1/packages/:id/commits/:commitId/revert`) and the package rollback (`POST /api/v1/packages/:id/rollback`) no longer restore a stored version into a row bound to an installed read-only package (`<base>`) itself, on an item of the five overlay types that package ships, where the customization can be written into the base's paired `<base>.custom` instead; they rewrote that row before. The per-item rollback of the same row has refused it since `named-base-overlay-write-closed`.

Metadata-protocol: none

Skills-docs: none needed — `skills/objectstack-platform/SKILL.md` places every customization of an installed base in its paired `.custom`, declaring `overrides`, and says nothing about reverting a commit recorded against the base itself; nothing it says becomes false.

<!-- adr-0087: not-required (already-registered packageless-overlay-write-closed) That entry, unreleased and shipping in the same release, already prescribes this change's TO for every customization of an installed package: write it into the base's paired `<base>.custom` with `PUT /api/v1/meta/<type>/<name>?package=<base>.custom` and the `overrides` declaration (its replacement), because the customization lives there (its reason, ADR-0146 D1, D2, D11). This change closes the commit doors' restore onto a row bound to the read-only base, the third write that still landed such a row after the save, publish and per-item rollback naming the base were closed, onto the same TO. No stored row is rewritten or moved, so `objectstack migrate meta` has nothing new to do. The entry names both meta-door addresses (the write naming no package, and the save, publish or rollback naming the read-only package, a rollback of a row bound to it included) but not yet the commit doors (`POST /api/v1/packages/<base>/commits/<commitId>/revert` and `POST /api/v1/packages/<base>/rollback`); that text widening is a `packages/spec` edit this change does not make, and it rides #29414. -->

**BREAKING** write narrowing at the commit doors (`@objectstack/metadata-protocol`), shipped as `patch` (`Metadata-protocol: none`).

### Migration: FROM → TO

FROM, undoing a commit that the installed package `com.acme.crm` recorded before the write naming it was closed (a customization published into the package itself), where the commit edited the customization:

```http
POST /api/v1/packages/com.acme.crm/commits/cmt_123/revert
```

It now answers `200` with `success: false`, and the item in `failed[]` with `code: NOT_OVERRIDABLE` and the sentence the per-item rollback gives; nothing is written. TO, write the version you want back into the base's paired `.custom`, declaring what it overrides (the pair's declared override is served over the row bound to the base):

```http
PUT /api/v1/meta/view/account_list?package=com.acme.crm.custom
{ "name": "account_list", "label": "My accounts", "overrides": { "package": "com.acme.crm", "basedOn": "1.4.0" } }
```

Or remove the row bound to the base (`DELETE /api/v1/meta/view/account_list?package=com.acme.crm`) to serve the package's own document again.

- **Now refused, per item.** The restore of a commit item into a row bound to the read-only base itself, of a `view`, `dashboard`, `report`, `translation` or `email_template` that the base ships, where the pair can be ensured (the base has a namespace and a SemVer version) and the override write gate admits the declared body into it. The commit's other items still revert, and the revert is still recorded. `POST /api/v1/packages/<base>/rollback` reports each refused item in its `failed[]` (`success: false`) and continues through the remaining commits.
- **Still open.** The revert of an item the commit created: it removes the row bound to the base, which writes nothing and is the one way to clear such a row (as a delete naming the base is). Every revert whose restore lands in a row of the pair, a writable package or no package, and every restore the pair could not take (a base whose pair cannot be ensured, a base with no version, an `email_template` locale the base does not ship).
