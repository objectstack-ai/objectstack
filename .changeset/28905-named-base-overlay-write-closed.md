---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a save, publish or rollback naming an installed read-only package itself onto its view, dashboard, report, translation or email template is refused, naming the base's `.custom` pair

Clause-②: yes (narrowing) — the metadata save (draft and active), publish (per item and `publish-drafts`) and rollback doors refuse a write that names an installed read-only package (`?package=<base>`) onto an item of the five overlay types that package ships, where its customization can be written into the base's paired `<base>.custom` instead (the pair can be ensured, the base records a version, and the override write gate admits the declared body there); they accepted it before as an undeclared row bound to the base. A delete naming the base stays open.

Metadata-protocol: narrowed (the `allowEnvironmentOverlay` flag of `view`, `dashboard`, `report`, `translation` and `email_template` no longer opens a write naming the read-only base itself onto an item it ships; the customization is the pair's declared override, as ADR-0146 D1 states)

Skills-docs: none needed — `skills/objectstack-platform/SKILL.md`'s ADR-0146 paragraph already places every customization of an installed base in its paired `.custom`, declaring `overrides`, and names `?package=<base>` only as a read that serves it; nothing it says becomes false.

<!-- adr-0087: not-required (already-registered packageless-overlay-write-closed) That entry, unreleased and shipping in the same release, already prescribes this change's TO for every customization of an installed package: write it into the base's paired `<base>.custom` with `PUT /api/v1/meta/<type>/<name>?package=<base>.custom` and the `overrides` declaration (its replacement), because the customization lives there (its reason, ADR-0146 D1, D2, D11). This change closes the second address that bypassed the pair, the read-only base's own, onto the same TO. No stored row is rewritten or moved: rows bound to the base stay served, so `objectstack migrate meta` has nothing new to do. The entry's surface names the package-less write only; widening its text is a `packages/spec` edit this change does not make. -->

**BREAKING** write narrowing at the metadata doors (`@objectstack/metadata-protocol`), shipped as `minor` during the launch window.

### Migration: FROM → TO

FROM, a customization of the installed package `com.acme.crm`'s view written naming the package itself:

```http
PUT /api/v1/meta/view/account_list?package=com.acme.crm
{ "name": "account_list", "label": "My accounts" }
```

TO, the same customization written into the base's paired `.custom`, declaring what it overrides (as for a write naming no package since `packageless-overlay-write-closed`):

```http
PUT /api/v1/meta/view/account_list?package=com.acme.crm.custom
{ "name": "account_list", "label": "My accounts", "overrides": { "package": "com.acme.crm", "basedOn": "1.4.0" } }
```

A draft is saved and published there too (`?mode=draft`, then the publish naming `com.acme.crm.custom`). To restore a version of a row bound to the base, save that version's body into the pair, declaring it. `basedOn` is the base's installed `manifest.version`. The pair is created by Studio's Customize, or by `os migrate packageless-overlays --apply`.

- **Now refused.** An authoring save (draft or publish mode) or a per-item publish naming `?package=<base>`, `POST /api/v1/packages/<base>/publish-drafts` holding such a draft (the batch is all-or-nothing, so none of its drafts is published), and a rollback of a row bound to the base, of a `view`, `dashboard`, `report`, `translation` or `email_template` that the installed read-only package `<base>` ships, where the pair can be ensured (the base has a namespace and a SemVer version) and the override write gate admits the declared body into it. Each answers `403 NOT_OVERRIDABLE`, writes nothing, and its message names the item, the base, the pair (`?package=<base>.custom`) and the `overrides` declaration — the fix the package-less refusal names, in the same words.
- **Still open.** A delete naming `?package=<base>`, and its draft discard: removing a row bound to the base is the one way to clear one stored before this release (`os migrate packageless-overlays` moves package-less rows only, so it never lists one). Every write naming the pair, a writable package or no package (the package-less close is unchanged). A body carrying `overrides` keeps the override write gate's refusal (only the pair declares one); a name the base does not ship keeps ADR-0070 D1's `422 WRITABLE_PACKAGE_REQUIRED`. And every write the pair could not take: a base whose pair cannot be ensured, a base with no version, and an `email_template` locale the base does not ship. The server's own rewrites of a stored row (`migrate-stored`, package duplication) are not authoring writes and are unchanged.
- **Unchanged.** A row bound to the base stored before this release is still served at the base's address and by the read naming no package, until the pair declares the override (the pair's declared override is served over it) or a delete naming the base removes it.
- **`os migrate organization-ownership --apply`.** Its carry of an organization's public-form withdrawal onto a view a read-only package ships saved that view naming the package; that save is now refused, so the ceremony stops with a blocker quoting this refusal. Save the withdrawal (`sharing.enabled: false`) into the pair as above, then re-run.
