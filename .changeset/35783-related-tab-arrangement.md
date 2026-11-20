---
'@object-ui/i18n': patch
'@object-ui/plugin-detail': patch
---

feat(record-page): a related list's tab moves left or right and hides, and 「更多」 restores the default order

Clause-②: no
Metadata-protocol: none

A reader arranges the record page's related lists from their tabs again (the related cards that carried the ⠿ handle and 「隐藏」 left the page with objectstack#35595):

- **A related list's tab is its menu.** Open a list's tab and click it again (or press Enter, Space or ↓ on it): 「左移」 and 「右移」 move it one place among the related lists, and 「隐藏」 takes it off the row into 「更多」's hidden lists and returns to Overview. The open tab draws a ▾ to say so.
- **「更多」 restores the default.** While the order or the hidden set is not the default, 「更多」 ends with 「恢复默认顺序」: the default order with every list shown. It is in a drawer and an embedded pane too, which have no rail.
- **Fixed tabs.** Overview, Attachments, Approvals and Activity have no menu and never move.
- **One stored arrangement.** The tabs write the same per-reader, per-object arrangement the related cards wrote, so an order or hides already stored keep working, and the rail's 「已隐藏 N · 显示」 and 「恢复默认顺序」 still undo them.

`@object-ui/i18n` adds `detail.recordTabMoveBefore` / `detail.recordTabMoveAfter` (左移 / 右移) in every pack. `@object-ui/plugin-detail` removes the unused `RelatedCardStack` and `useRelatedArrangement` modules (not exported from the package). Nothing an app authors changes.
