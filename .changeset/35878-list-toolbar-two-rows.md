---
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

feat(list): the list page's toolbar is two rows: 「Object / View ▾ · View settings … Search · New · ⋮」 and a resident condition row

Clause-②: yes (widening)
Metadata-protocol: none

The console's object list drew three rows above the table: the object's name with ⋮ More and New, the view bar with Filter N, Sort N, Options and search, and a condition row that appeared only once a sort or filter was set. It now draws two:

- The view bar starts with the object's icon and name, 「/」 and the view switcher, then 「View settings」. Its right end is the search, the page's toolbar actions, New, and ⋮ More last at the right edge. While rows are selected the right end shows what the selection offers, and ⋮ More keeps its place and its icon (⋮, also in the selection face).
- The Filter N and Sort N buttons are gone from the bar. The condition row is always there: with nothing set it shows dashed 「Sort」 and 「Filter」 buttons; a sort of any number of levels is one chip, 「Sorted by X」 with 「+N」 for the further levels, which opens the sort panel; each filter is its own chip with ×, followed by 「+」. The row's right end is 「Personalized」 and 「Reset」 while the list differs from its view. The table no longer moves down when the first condition is set.
- 「Options」 is renamed 「View settings」 and sits beside the view name. Its first level shows the content itself: the view's name, the shown columns (drag to reorder, the eye to hide) and 「+ Add column」, then Layout, Group, Row height and Row color where offered, and Save, Restore defaults and export in its footer. The More level and its inline edit switch, and Refresh, are gone.
- As the list narrows, 「View settings」 folds to its icon first, then the word 「Personalized」 goes, then 「Reset」 folds to its icon. The condition row stays one line and scrolls sideways.

For hosts of `ListView`: two optional host props, `toolbarTrailing(tools)` (the bar's right end, given the list's search) and `conditionRowEnd` (the condition row's right end, drawn in place of the row's own Reset). A host that passes neither gets the search alone at the bar's end and the row's own Reset.
