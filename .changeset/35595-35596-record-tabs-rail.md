---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
'@object-ui/plugin-detail': patch
---

feat(record-page): one tab per related list, and an Overview rail that sums up the other tabs

Clause-②: no
Metadata-protocol: none

The record page's tab row and its right column are redrawn (supersedes objectstack#28469):

- **Tabs.** Overview, then one tab per related list in its order, then Attachments, Approvals and Activity last. Every tab is there at first paint and none moves when the counts land. A list with no records keeps its place, greyed, with no number. The width is the row's only fold: the tabs that do not fit go into 「更多 N ▾」, whose items keep their counts. Approvals carries a dot while a request waits, not a count. A tab that merges several tables (only an explicit page can write one) carries no count.
- **Overview.** The stage path and the key fields sit across the whole width on Overview only; every other tab draws its block in full in their place.
- **Right rail.** On Overview, the right column sums up the other tabs, in this order: Approvals, Attachments, Recent activity, then 「其他相关」 with a card for each related list that has records. Each card has a title (which opens its tab), a grey count and at most three rows. A card with nothing to show is not drawn, and there is no 「还有 N 个空关联」 line. Nothing in the rail is editable. A rail with no cards folds away. A drawer draws no rail and no right-column switch. The rail's rows come from the page's one read: it reads nothing more.
- **No band at the foot.** A page drawn as written that places no approvals or attachments panel gets them as tabs of its first tab strip, not as bands under the page. The header's approval tag opens the Approvals tab.
- **One approval band.** A page drawn as written whose details are split into several `record:details` nodes draws the record's approval band once, on the first body that reaches it, recall included.

- **Reader arrangement leaves with the cards.** The related cards' ⠿ handle, ⌥↑ / ⌥↓ and 「隐藏」 are gone with the cards, so a reader can no longer reorder or hide a related list on the page. An order or hides already stored still apply, and 「恢复默认顺序」 / 「显示」 still undo them.
- **`?tab=related` is retired.** The single 「Related」 tab is gone, so a saved link carrying `?tab=related` opens Overview.

`@object-ui/plugin-detail` adds `ApprovalBandOnceScope`. `@object-ui/i18n` adds the 「更多 N」 trigger and the rail's labels in every pack. Nothing an app authors changes.
