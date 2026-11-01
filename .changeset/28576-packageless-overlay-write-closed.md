---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': patch
'@objectstack/skills': patch
'@object-ui/app-shell': patch
---

fix(metadata-protocol)!: a write naming no package onto an installed package's view, dashboard, report, translation or email template is refused, naming the base's `.custom` pair and `os migrate packageless-overlays`

Clause-②: yes (narrowing) — the metadata save, publish, delete and rollback doors refuse a write that names no package onto an item of the five overlay types an installed read-only package ships, which they accepted before as a package-unbound Setup row. Nothing is widened.

Metadata-protocol: narrowed (the `allowEnvironmentOverlay` flag of `view`, `dashboard`, `report`, `translation` and `email_template` no longer opens a package-less write onto a packaged item; it stays the predicate the migration ceremony and the read of an unmigrated row use)

Skills-docs: updated here — `skills/objectstack-platform/SKILL.md`'s ADR-0146 paragraph said "a package-unbound Setup row still wins over the base's until D11"; it now says such a row from before D11 wins until migrated and that D11 refuses new ones. The same paragraph drops "the base's is unchanged" after the export sentence, which "replaces the base's document whole" already implies, to stay under the bundle's token ceiling.

<!-- adr-0087: registered packageless-overlay-write-closed -->

**BREAKING** write narrowing at the metadata doors (`@objectstack/metadata-protocol`), shipped as `minor` during the launch window.

**Run the ceremony before you upgrade.** On each deployment with Setup customizations of a package's items, run `os migrate packageless-overlays` (preview), then `os migrate packageless-overlays --apply`, on the release before this one (#28413 shipped the command). If you upgrade first, nothing breaks at the upgrade: every customization is still served as before. But each of them becomes read-only in Setup until the command moves it, because its package-less save, reset, publish and rollback are refused.

### Migration: FROM → TO

FROM, a customization of the installed package `com.acme.crm`'s view written with no package:

```http
PUT /api/v1/meta/view/account_list
{ "name": "account_list", "label": "My accounts" }
```

TO, the same customization written into the base's paired `.custom`, declaring what it overrides:

```http
PUT /api/v1/meta/view/account_list?package=com.acme.crm.custom
{ "name": "account_list", "label": "My accounts", "overrides": { "package": "com.acme.crm", "basedOn": "1.4.0" } }
```

To restore the package original, FROM `DELETE /api/v1/meta/view/account_list` TO `DELETE /api/v1/meta/view/account_list?package=com.acme.crm.custom`. `basedOn` is the base's installed `manifest.version`. The pair is created by `os migrate packageless-overlays --apply`, or by Studio's Customize.

- **Now refused.** A save (draft or publish mode), a publish, a delete of the active item, or a rollback whose restored row is package-less, with no `?package=` (or an empty one), of a `view`, `dashboard`, `report`, `translation` or `email_template` that an installed read-only package ships. Each answers `403 NOT_OVERRIDABLE`, writes nothing, and its message names the item, the shipping package, the pair (`?package=<base>.custom`), the `overrides` declaration and `os migrate packageless-overlays`. Setup's form save and reset show that message as sent. The refusal comes before every gate that reads a stored row, so it is the same with or without `overrides` in the body.
- **Still open.** Every write naming `?package=<base>.custom` (the pair's save, publish, delete and rollback, judged by the override write gate as before); a rollback of the pair's own declared row, which is judged as the pair's override; a write of a name no installed package ships (environment metadata); a write of a name whose only shipping packages have ids no `.custom` pair can be formed from (the ceremony lists those rows `no_pair` and cannot move them, so their write is not closed); and discarding a draft.
- **Unchanged.** A package-less row stored before this release is still served exactly as before, by every read. The ceremony still moves it: it writes into the pair, never package-less.
- **Studio.** The read-only item notice no longer links to the package-less Setup overlay (`@object-ui/app-shell`).
- **Removed with it.** #28413's interim allowance, by which a package-less save that landed on a moved row kept that row's `overrides` block, is gone: such a save is refused like any other.
