---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
'@objectstack/platform-objects': patch
---

feat(studio): remove the Studio home page; `/studio` opens the last package or the package list, and an installed app's customizations show in Setup → Packages

Clause-②: no
Metadata-protocol: none

The package-card page at bare `/studio` is gone. Studio is opened from an app or from Setup → Packages. Every entry that page carried now has another home:

- **`/studio`** opens the package you were last in, provided the package list still has it. Otherwise it opens Setup → Packages (`/apps/setup/component/developer/packages?face=admin`). A user who may enter Studio but not that Setup page goes to Studio's "All metadata" area across packages (`/studio/~all/metadata`) instead. The 「应用构建」 (`studio:builder`) entry of the `@objectstack/studio` app goes to the same place.
- **New package.** Home's and the `/ai` screen's 「New in Studio」 and the 「Add app」 menu open Setup → Packages with New Package already open (`?new=package`). After the package is created you land in Studio on it. An old `/studio?new=package` bookmark goes there too. Creating the package and its app in one step is the subject of a separate card; for now this flow creates the package only.
- **What this environment changed on an installed app.** The home page showed "n customized, m switched off" and a "Customizations in this environment" panel. Both are now in the app's detail in Setup → Packages, together with a 「在 Studio 中定制」 / "Customize in Studio" link. The count now includes tab, field-group and action-layout arrangements, so an app whose only change is a tab arrangement shows as customized.
- **Organization flows and the environment catalog** are in Studio's left menu.
- **A package Studio cannot find**, and a retired Setup page whose URL names no package, now go to Setup → Packages.

The Packages page's development view (import, publish, revert, adopt loose items) is still at its address. Its menu entry is added by a separate card.

`@object-ui/app-shell` is private. It no longer exports `BuilderLanding`, and it now exports `StudioEntryRedirect` and `SETUP_PACKAGES_PATH`. The `engine.studio.landing.*` strings are removed from `@object-ui/i18n`, except the three duplicate-form strings the Packages page still uses. The `engine.packages.customizations.*` strings are added. `@objectstack/platform-objects` changes a code comment only.
