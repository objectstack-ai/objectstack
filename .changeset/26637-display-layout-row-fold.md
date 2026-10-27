---
'@object-ui/plugin-list': patch
---

fix(plugin-list): the Display popover's Layout row folds its segments to icons when they would not fit

Clause-②: no
Metadata-protocol: none

On a list that offers four layouts, the Layout row of the Display popover read 「布局 | 表格 | 看板 | 日历 | 时间线」 and broke each label onto two lines: the popover is a fixed width and the row shares it with its title. In English the labels are longer still.

What changes:

- The row now measures the width its segments need with every label shown against the width it has, in whatever locale is rendering. When they would not fit, every segment but the selected one shows its icon only. The selected segment keeps its label.
- A folded segment keeps its accessible name and its tooltip (its `aria-label` and `title`), so it is still announced and still named on hover.
- The fold is measured, not a count or a breakpoint: two layouts keep their labels, and the same row unfolds wherever it fits again.
- Labels in the row no longer wrap, and the popover keeps its width.

What to do: nothing. Nothing a view or object declares changes.
