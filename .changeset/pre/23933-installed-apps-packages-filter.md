---
'@objectstack/cloud-connection': minor
'@objectstack/platform-objects': patch
---

feat(cloud-connection)!: Setup's "Installed Apps" entry opens Setup › Packages filtered to marketplace installs, and the separate Installed Apps page is no longer shipped

Clause-②: no (narrowing)

<!-- adr-0087: not-required (runtime-export-retired @objectstack/cloud-connection#MARKETPLACE_INSTALLED_UI_BUNDLE.pages) The retired operand is a member of a published runtime export of `@objectstack/cloud-connection`, and its break reaches a TypeScript consumer through the compiler at their own call site. The page it carried was plugin-registered in-memory metadata, registered by `MarketplaceInstallLocalPlugin` at `kernel:ready`, never a stored row. No spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. -->

- `MARKETPLACE_INSTALLED_UI_BUNDLE.pages` -> delete (the bundle carries no page; its entry is read from `navigationContributions`)

Setup › Packages is now the one list of what is installed: every row says where the package came from (Source: code, marketplace or authored), and the rows whose Source is marketplace carry the actions the Installed Apps page had, Details and Uninstall.

- **What changes.** The "Installed Apps" entry in Setup's Apps group, which the install-local plugin (`MarketplaceInstallLocalPlugin`) contributes, now opens Packages with the Source filter set to marketplace. Its label and icon are unchanged. In `MARKETPLACE_INSTALLED_UI_BUNDLE` the entry `nav_marketplace_installed` is a `component` entry on `developer:packages` with `params: { source: 'marketplace' }`, which the console opens as `/apps/setup/component/developer/packages?source=marketplace`.
- **What is no longer shipped.** The bundle no longer carries the `marketplace_installed` page, so `GET /api/v1/meta/page` stops listing it and `MARKETPLACE_INSTALLED_UI_BUNDLE` has no `pages` key. In the console that page only redirected to the filtered Packages list. The `pages.marketplace_installed` entries leave the Setup translation bundle in `@objectstack/platform-objects` (en, zh-CN, ja-JP, es-ES). The Setup nav label `nav_marketplace_installed` keeps its translations.
- **Unchanged.** The entry still appears only when the install-local plugin is mounted, so a runtime without it shows no Installed Apps entry. "Browse Marketplace" and its route are not touched. The marketplace's own package page still carries Update and the sample-data Re-seed / Purge menu, and Details on a Packages row opens it.

What to do. Nothing in a normal deployment. If you linked to the `marketplace_installed` page directly, link to Setup › Packages with `?source=marketplace` instead.
