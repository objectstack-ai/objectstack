---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): customize a read-only package's view, dashboard or report into its `<base>.custom` pair, with an override badge and "Restore package original"

Clause-②: no
Metadata-protocol: none

An installed package is read-only in Studio, so until now its views, dashboards and reports could only be looked at there. Studio now customizes them into the base's paired customization package (`<base>.custom`, ADR-0146 D2 and D3), as a declared override of the base's item.

- **Customize.** The item header of a view, dashboard or report on a read-only base, and of an object leaf's list view, offers Customize. Pressing it only unlocks the item's editors. Nothing is written until an edit is saved.
- **The first saved edit.** It calls `POST /api/v1/packages/:id/ensure-customization` once for that item, with no prompt and no body. It then saves the draft into the package the answer names (`201` when the door created the pair, `200` when it was there). The draft is the item as Studio holds it, without its `_` keys, with `overrides: { package, basedOn }`. `basedOn` is the base's `manifest.version` as the package list serves it. ⛔ The pair's id for a write is the door's answer, never a `.custom` spelled in the browser. The first save is pinned to "no draft there" (`If-None-Match: *`), so a draft someone else left in the pair is asked about, never overwritten. A base whose listed manifest states no version gets a disabled Customize that says so. Nothing is guessed.
- **Walled callers.** Under a `group` or `isolated` posture, an admin who is not the platform operator sees Customize disabled, with the reason. This is read from the two facts the server publishes (`features.tenancyPosture`, `user.isPlatformAdmin`). A door that refuses anyway is shown as the server sent it.
- **Pending and Publish.** On a read-only base with a pair, the pending count, the changes panel and Publish act on the pair's drafts. A refusal at the publish door is shown as it is sent. A read-only base with no pair keeps the read-only Publish, as before.
- **Badge.** The header says the item overrides the base (for example "Overrides HotCRM", with the version in its title). It is read from the declaration the server serves: the pair's draft, else the layered read's overlay. It is never computed.
- **Restore package original.** The item's ⋯ menu offers it on an item customized into the pair. After a confirmation, it deletes the pair's draft of the item, then its row (`DELETE /meta/:type/:name?package=<pair>`). The base's item reads back.
- **The read-only mark** no longer links a view, dashboard or report to Setup's overlay page.
- **Unchanged.** A writable package is edited in place, as before. A new view ("Add view") on a read-only base stays unavailable. The item tools (history, source) stay read-only on the base.
- **New strings.** `@object-ui/i18n`'s studio namespace gains twelve `engine.studio.customize.*` keys in `en` and `zh`. The other languages fall back to `en`, as the whole namespace does.
