---
'@object-ui/app-shell': patch
'@object-ui/react': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(app-shell): the publish sheet speaks in the console's language, and a load error the server answered shows its code and sentence

Clause-②: yes (widening)
Metadata-protocol: none

The Pending changes sheet now names an updated item's changed keys by the label the inspector gives them, in the console's language (a customized dashboard reads 「~ 显示名称」, not "~ Label"). It no longer lists the ADR-0146 override declaration (`overrides`) as a change. A new item is added whole, so it lists no key list and no 平台生成 group: it shows only the fields and flow nodes it brings, or "Publishing adds this item." An `object_extension` group reads as its translated name ("2 object extensions", 「对象扩展 2」). This widens the ten shipped packs by `preview.changes.detailNewItem` and the `preview.changes.typeCount.object_extension` count family.

When a read fails and the server answered, the list page, the record page, the app page and the related list now show the server's sentence and code, for example 404 `OBJECT_NOT_FOUND` with "Object '…' is not registered". "Check your connection and try again" is only shown when no answer came back. All four share one rule, `answeredLoadFailure`, newly exported from `@object-ui/react`.
