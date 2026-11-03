---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the Studio landing gives a base's `.custom` pair no card of its own, and the pending-changes sheet says where a customization is saved

Clause-②: yes (widening)
Metadata-protocol: none

ADR-0146 D3 folds a base's `<base>.custom` pair under its base. The Studio landing now does the same: a pair whose base is listed draws no card under "My packages" (or with the read-only packages). The base's card keeps its "n customized" line, and that line still links into the pair. A pair whose base is not listed keeps its card. The pair's Export and Delete stay on Studio's Overview → Packages page, which lists every package.

When Studio reviews a read-only base's pair, the pending-changes sheet now says, under its title, "Saved to BASE's customizations" (zh: 保存到 BASE 的定制). `@object-ui/i18n` adds one key, `preview.changes.savedToCustomization`, in all ten locale packs. `DraftChangesPanel` takes an optional `customizationOf` prop, the base's label, and exports `savedToCustomizationText` so other surfaces can say the same sentence. Nothing is removed or narrowed.
