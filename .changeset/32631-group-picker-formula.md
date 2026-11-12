---
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

fix(plugin-list): the list's Group editors no longer offer a formula field, and a refused personal grouping falls back to the list without it

Clause-②: yes (widening)
Metadata-protocol: none

The server refuses a group key that names a formula field (its value is computed on read, so no driver stores a column to group by). The list view's Group editors offered such a field anyway, and picking it turned the whole list into a load-error page that stayed there, because the Console keeps the reader's grouping in the URL.

- Neither Group editor (the toolbar's Group panel and the Display panel's Group section) offers a field the object declares virtual. The judgement is the spec's `isVirtualSearchField`, the predicate the server's aggregate door calls. Hide fields and Row color still list the field.
- A level of the reader's own grouping that names such a field (a URL grouping, an old link) is left out of the query. The list shows its rows grouped by the levels that remain, or ungrouped, with a notice above them and a "Remove from grouping" button that writes the grouping without that level.
- A grouping the view itself declares is queried as declared, so the server's refusal still shows as the error panel: that is a defect in the view's metadata, for its author to fix.

`@object-ui/i18n` gains two keys in every pack, `list.groupingUnstoredNotice` and `list.groupingUnstoredRemove`. The package entry exports `en` and `TranslationKeys = typeof en`, so the two keys widen that published surface; nothing is removed or renamed.
