---
'@object-ui/plugin-list': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
---

feat(plugin-list): a list block on a page caps its rows and ends with a "View all N" link; a tabbed list block caps each tab and badges each tab with its count

Clause-②: yes
Metadata-protocol: none

A `list-view` block in a page region half the page or wider used to draw the whole object list: every row of its query, the toolbar, the `#` column, every column of the view and a horizontal scrollbar. It now draws a capped list:

- **The rows.** At most `dataSource.limit` of them, the key every page element's data binding already declares, and 5 when the block states none. The cap is the query's own window (`$top`), so a capped block never fetches the rest.
- **The columns.** The view's first four visible columns, in a table fixed to the block's width; the rest are dropped, not scrolled. A view that declares no columns draws the object's `highlightFields` led by its name field, else each record's display name.
- **No object-list chrome.** No toolbar, view tabs, row-number column, pager or record-count bar. A click on a row opens the record, as a grid row does.
- **The link.** Under the rows, 「View all N →」 (`list.viewAllCount`, new in all ten language packs) opens the object list on the block's bound view, the same destination the compact list's "View all" link opens.

A region narrower than half the page keeps the compact list, and a list outside any page region (the object list page, a block with no page around it) keeps the full list.

`page:tabs` now badges a tab holding `list-view` blocks with the number of records those blocks' own queries matched, summed with the `record:related_list` counts it already derives. Such a tab is mounted while inactive, hidden, so the badge is there before the tab is opened; a tab with an authored `count` keeps mounting on open only. Nothing an author writes changes. The published surface widens in three places, which is what `Clause-②: yes` declares: the i18n key `list.viewAllCount` in all ten packs; `usePageTabCountReporter`, a new export of `@object-ui/components`, the count channel a `page:tabs` panel opens to the blocks inside it; and `ListView`'s two new optional host props that use it, `capped` and `onTotalChange`.
