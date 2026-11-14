---
'@object-ui/plugin-grid': patch
---

fix: in a narrow host such as a record drawer, a list's inline primary row action folds into the row's "⋮" menu instead of letting the pinned Actions column cover the last data column

Clause-②: no — no export, prop or authored key changes; `@object-ui/plugin-grid` decides from layout alone whether to draw a row's inline button.
Metadata-protocol: none

The Actions column of an object grid is pinned to the right edge of the table's scroll box. A `variant: 'primary'` row action drew as an inline button beside the "⋮" trigger, which roughly doubled that column. In a record drawer's enlarged related list (622 px of content at the default drawer width), that extra width alone could tip a table whose data columns fit into one that overflowed, and the pinned column then sat over the last data column (Status, in the reported case) at rest.

The grid now draws inline row buttons only while the table fits its scroll box with them. When the table overflows with them, each row's primary action moves to the top of that row's "⋮" menu, so no action is dropped and the pinned column shrinks to the trigger. The buttons return once the box is as wide as the table was with them. On the full list page, where the table fits, nothing changes, and the phone card layout is untouched. A table that overflows even with the menu alone still scrolls sideways under the pinned "⋮" column, as any list that scrolls does today.
