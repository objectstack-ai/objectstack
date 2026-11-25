---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@objectstack/platform-objects': patch
---

feat(studio): Studio no longer has a home page; opening Studio takes you to the package you were last in, or to the package list

Clause-②: no
Metadata-protocol: none

The package-card page Studio used to open on is gone. Studio is opened from an app or from Setup → Packages, and everything that page offered has another place:

- **Opening Studio** takes you to the package you were last in, if it is still installed. Otherwise an administrator lands on Setup → Packages, and a developer who cannot open that Setup page lands on the All metadata area. The 应用构建 entry of the Studio app goes to the same place.
- **New package.** 「New blank app」 (formerly 「New in Studio」) on Home, on the AI-unavailable screen and in the 「Add app」 menu opens Setup → Packages with the New Package dialog already open. After the package is created you land in Studio on it. An old bookmark to Studio's new-package page goes there too, or to the All metadata area for a developer who cannot open Setup → Packages. Creating a package and its app in one step comes with a later change; for now this creates the package only.
- **What this environment changed on an installed app.** The "n customized, m switched off" line and the "Customizations in this environment" panel are now in the app's detail in Setup → Packages, with a 「Customize in Studio」 link. The count now includes tab, field-group and action-layout arrangements, so an app whose only change is a tab arrangement shows as customized. The list across all installed apps at once is now shown one app at a time.
- **The 「Add app」 menu** no longer offers 「Build with AI」, and neither do the buttons on the "No applications yet" screen. 「New blank app」 is now always offered wherever apps can be built, whether or not the AI build assistant is available, so the menu is never empty for someone who may add an app; a menu with nothing to offer is not shown. Home's own 「Build with AI」 button is unchanged.
- **Organization flows and the environment catalog** are in Studio's left menu.
- **A package Studio cannot find** offers a way to Setup → Packages, or to the All metadata area for a developer who cannot open that page. A retired Setup page whose address names no package opens Setup → Packages.

The Packages page's developer view (import, publish, revert, adopt loose items) still opens at its address; its menu entry comes with a later change.
