---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): a 「⋯」 package menu in Studio's top bar, and Import on Setup → Packages

Clause-②: no
Metadata-protocol: none

With the Studio home gone, the whole-package actions of the Packages page's development view had no button anywhere. They are back, in two places:

- **Studio's top bar.** Beside the app or package name at the left end there is now a 「⋯」 menu (zh: 软件包操作) with six items: Edit package info (编辑软件包信息), Export (导出), Duplicate as a new package (复制为新软件包), Revert to last publish (还原到上次发布), Adopt loose items (收编散落项) and Manage in Setup… (在设置中管理…). Each opens the same dialog and sends the same request as the development view's button; the answer appears as a toast. Revert now asks for confirmation first. On a read-only installed package, Edit, Duplicate, Revert and Adopt are greyed with the reason on hover; Revert is also greyed while nothing has changed since the last publish. Manage in Setup… opens Setup → Packages with that package's detail open, where it is enabled, disabled or deleted. The menu is shown only to people who can author metadata (`manage_metadata`), and not in the organization-flows scope or the all-packages view, where no package is open. Publishing every draft is not in the menu: Studio's Changes / Publish already do that.
- **Setup → Packages.** Import now sits in the header beside New Package and works exactly as on the development view. A Setup → Packages address can open one package's detail directly by adding `&package=ID`.

The development view itself is unchanged.

New locale keys in the studio catalogue (en, zh): `engine.studio.packageMenu.trigger`, `.editInfo`, `.duplicate`, `.revert`, `.manageInSetup`, `.noChanges`, `.duplicateTitle`, `.duplicateDescription`, `.revertTitle`, `.revertDescription`.

Seventeen studio-catalogue rows that no screen read any more are removed: `engine.studio.menu.typeCount` and the app-worded `engine.studio.newApp.*` rows (`title`, `description`, `advancedHint`, `id`, `help.*`, `nsDerived`, `created`, `exists`, `failed`). None of them was in a published `@object-ui/i18n` release; `engine.studio.newApp.nameTaken` and `engine.studio.newApp.appFailed` are still used and stay.
