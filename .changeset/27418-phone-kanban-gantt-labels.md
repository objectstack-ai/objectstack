---
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-gantt': patch
---

fix(plugin-kanban, plugin-gantt): a phone kanban opens on its first column that holds a card, and a narrow gantt bar shows its title beside the bar

Clause-②: no
Metadata-protocol: none

- **Kanban.** At phone width the board shows one column at a time, so a pipeline whose first stages were empty opened on an empty column. On its first settled load the board now brings the first column that holds a card into view. The column order does not change, a board whose first column holds a card opens as before, and a column already in view is never scrolled to. The board never moves after the viewer touches, swipes, scrolls or types on it. Swimlane boards are unchanged.
- **Gantt.** A bar too narrow to show its title (a week or month bar on a phone, 18 to 63px wide) drew an ellipsis or nothing. It now draws the whole title beside its end. A bar with room keeps its title inside, cut with an ellipsis as before. This applies to task bars and summary bars; milestones and the PNG/PDF export are unchanged.
