---
'@objectstack/platform-objects': patch
'@objectstack/cloud-connection': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): Setup gets one Packages entry, the package list's administration face; the Installed Apps entry retires

Clause-②: no
Metadata-protocol: none

The maintainer's ruling on objectstack#36834 amends ruling 甲 of #25098: Setup lists what is installed, with the administration actions only, and the marketplace-only "Installed Apps" entry merges into it.

- **Setup → Apps → Packages (`nav_packages`).** `@objectstack/platform-objects` contributes one entry to Setup's `group_apps`, gated on `manage_platform_settings` like Setup's other administration entries. It opens the console's `developer:packages` page with `params: { face: 'admin' }`, so the URL carries `?face=admin`. Its label is translated in every locale the Setup bundle carries.
- **The page's administration face.** With `?face=admin`, the Packages page lists every package of every source, with modules folded under their app. It shows the Name, Version, Status, Source and Update columns, plus a Source filter (All, Code, Marketplace, Authored) that writes `?source=`. Its only header action is New Package, and a package created there opens in Studio, on the address the Studio landing's package card opens. The detail sheet offers View info, Disable / Enable and Delete (keeping the choice to keep the data), plus "Open in Studio" on an authored package. Import, Edit, Publish, Revert, Export, Duplicate, Adopt loose items and the pending changes' Publish and Discard are not offered there. An unknown or repeated `face` value is refused by name. With no `face`, the page is unchanged: Studio's "All packages" link and each package card's Manage keep every action.
- **Installed Apps retires.** `MARKETPLACE_INSTALLED_UI_BUNDLE` (`@objectstack/cloud-connection`) no longer carries `nav_marketplace_installed`. The bundle stays exported under its id, with an empty `navigationContributions`, so a host that imports and registers it keeps working. The entry's labels are removed from the Setup translation bundle, and its id joins the dead-key tombstone. A bookmarked `/apps/setup/component/developer/packages?source=marketplace`, which the marketplace page's "Installed" button also opens, still shows the list filtered to marketplace installs, on the administration face.
