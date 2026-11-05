---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): an empty body table of the record page keeps its header (title, 0, New) with the empty sentence under it, instead of folding into one line that read the empty sentence before the table's title

Clause-②: no
Metadata-protocol: none

**Visible behaviour change on a released page.** The default record page draws a body table (a related list drawn full width in the details column, or the Details tab) beside its sibling sections. Because the tables share that container, the related-list empty fold took them for a Related tab stack: once one table had rows, an empty one left its place and reappeared as a single line after the last table, reading 「暂无相关记录 · 偏离 · ＋ 新建」 (no related records · Deviations · New). A body table now never folds. An empty one keeps the header row its non-empty siblings draw (title, count 0, ⤢, New), and the empty sentence moves out of that row to the table's place under it.

The fold of a record's Related tab, and the empty-panels line of the related column, are unchanged: only a list whose relationship is one of the page's body tables opts out.
