---
'@object-ui/types': minor
---

The blindness pin, quoted from the PRE-REPAIR text of
`.changeset/8802-8257-8008-kanban-gantt-family-retirement.md` at `adf581278` --
the site that motivated objectui#9727 and the site its own instrument missed.

**What the `kanban` arm took with it, stated because it is the cost of this
change.** That arm was the only schema face that ever declared `columns`,
`cardTitle`, `swimlaneField`, `grouping` and `navigation`, the only one that
refused `allowCollapse` / `cardTemplates` / `columnWidths` / `titleField` /
`draggable` / `onColumnAdd` / `onCardAdd` by name, and -- through
`columns: KanbanColumn[]` -- the only one that judged a lane's `cards`
(objectui#6939). The surviving `ObjectKanbanSchema` face declares none of them.
