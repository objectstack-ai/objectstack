---
'@object-ui/plugin-tree': patch
---

fix(plugin-tree): the object tree's loading and empty placeholders speak the page's language

Clause-②: no
Metadata-protocol: none

`object-tree` drew its loading line and its empty line as the English literals `Loading…` and `No records`, so a zh-CN page showed English in the middle of a localized view. Both now read the bundle, `common.loading` and `common.noData`, the same keys the repeater and record-picker elements read for their own placeholders. A zh-CN page now reads 加载中… and 暂无数据, and English reads `Loading…` and `No data` (the empty line used to say `No records`). The `object-tree` contract declares no empty-text key, so there is no authored text to override these.
