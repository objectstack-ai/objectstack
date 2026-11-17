---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): Setup › Installed Apps shows which apps have a newer version, links to their upgrade, and folds module packages under their app

Clause-②: yes (widening — locale keys only)
Metadata-protocol: none

Setup › Installed Apps (the Packages page opened with `?source=marketplace`) is now the administrator's view of installed apps:

- **Update available.** When the marketplace lists an app at a higher version than the one installed, the app's line shows the marketplace's own "Update available → vX" badge, decided by the same rule the marketplace pages use. The badge links to the app's marketplace page, where the upgrade runs unchanged. The page also says how many apps have a newer version. An app that is up to date, or that the catalog does not list, has no badge.
- **Catalog unavailable.** When the catalog cannot be read, or the runtime has no marketplace, the list is drawn as before with one line saying the update information cannot be read. It is never drawn as "up to date".
- **One line per app.** A module package (`type: 'module'`) that declares its app in `manifest.dependencies` is folded under that app's line and shown on demand. The tie is the one the server's disable door already reads. No new key is involved.
- **Administrator columns.** The columns are Name, Version, Status, Source and Update. The package id and the Scope badge stay on Studio's Packages.
- **Developer doors stay in Studio.** Import, New Package, the platform packages switch and the Source chip's "Show all" are not drawn on this view. Studio › Overview › Packages, the same page without `source`, keeps all of them.

The badge's words stay in the lazy `marketplace` namespace, which this view now loads. The console's eager language pack does not grow. Nine new strings are added to the lazy `studio` namespace, in English and Chinese.
