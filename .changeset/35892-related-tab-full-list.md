---
'@object-ui/core': patch
'@object-ui/i18n': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

feat(ui): a record page's related tab is the child object's full list

Clause-②: yes (widening) — a new export `ListConditionsBlock` (`@object-ui/plugin-list`, the condition row as a host element, not a registered node type) and its `ListConditionsHostProps`; a new slot `RelatedListConditionsSlotContext` and its `RelatedListConditionsProps` (`@object-ui/plugin-detail`), which the record page fills (`@object-ui/app-shell`); new exports `ConditionDiscardButton` and its type `ConditionDiscardButtonProps` (`@object-ui/plugin-list`) and `withHeaderSortPick` (`@object-ui/core`); new i18n keys in every `@object-ui/i18n` locale pack (`listConditions.chips.discard`, `listConditions.chips.discardHint`, `detail.relatedNoMatches`, `detail.deleteRowsTitle`, and the count family `detail.deleteRowsConfirmation` with its plural slots `_zero`, `_one`, `_two`, `_few`, `_many`, `_other` as each pack needs them); nothing removed or renamed
Metadata-protocol: none

On a record page, a related list opened as its own tab now works like the object's list page:

- The first row names the child list (its tile and title) on the left and keeps **+ Add** on the right. The **Open in list** button is gone.
- The second row is the list page's own condition row: **Sort** (several levels) and **Filter**, with no view switch, view settings or search. On a narrow tab or in the drawer their labels fold to icons.
- The table is the list page's grid: the column menu, cell editing as on the list page wherever the reader may edit the child object, row selection with the floating bulk bar (bulk delete asks once, deletes the selection in one batch call where the data source has one, and says how many rows went and how many did not), and the footer row, whose calculations cover every matching row, not just the loaded ones. A tab grouped by status draws no footer row.
- Rows load as the page scrolls instead of in pages.
- The tab title still counts every child; the footer counts the rows the filter keeps.
- What the reader changes (sort, filter, footer calculations) lasts while they stay on the record, for that reader only, across its tabs and between its page and its drawer, and is gone after a reload or on another record. **Discard** appears once something changed and puts the tab back; there is no Save. The list page's Discard and this one are one button.

Upgrade note: the header sort and the column widths and order that an earlier version remembered for a related tab in a reader's record-page preference (`sys_user_preference`) no longer apply: the tab opens in its declared order, and its column widths and order are now kept in the reader's browser, as the list page's are, so they start from the default once. Nothing stored is deleted. The default sort and columns of every related list are unchanged.

`@object-ui/core` adds `withHeaderSortPick`, the list page's rule for how a header sort joins an existing multi-level sort, now shared with the related tab. `@object-ui/app-shell`'s list Discard is drawn by `ConditionDiscardButton`; it looks and behaves as before.
