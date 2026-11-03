---
'@object-ui/plugin-detail': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
---

fix(plugin-detail): a record page's body table that is wider than the details column says so — its first column stays pinned and ⤢ is offered as 「All columns」

Clause-②: no
Metadata-protocol: none

A body table of the default record page (a related list drawn in the details column) keeps its place in that column, as ADR-0085's role-based layout puts it. When its columns are wider than the column, it now makes the overflow obvious:

- **The first column stays pinned** while the table scrolls sideways, so a scrolled row is still identifiable (the table's existing `frozenColumns: 1`, set only while the table overflows).
- **⤢ is offered in words.** The enlarge control in the card header, icon-only before, shows a visible 「All columns」 label (`detail.relatedCardAllColumns`, all ten locales) while the table overflows. It opens the same enlarged tab as before, where every column fits.
- **The right-edge shadow** while columns remain to the right is the table's own and unchanged; it clears when the table is scrolled to its end.

A body table that fits shows none of these: no pinned column and the icon-only ⤢.

`@object-ui/components`: a `data-table` header label carries its full text as a `title`, so a header the ellipsis cuts can be read on hover, and the table's scroll box carries a `data-table-scroll-box` marker a host can read the overflow from.
