---
'@object-ui/plugin-kanban': patch
---

feat(plugin-kanban): the board dims the lanes a dragged card's `state_machine` closes and refuses a drop into one

Clause-②: yes
Metadata-protocol: none

A board grouped by a field that an error-severity `state_machine` validation governs (the showcase Task Board's `status`, for one) used to accept a card dragged onto any column. The server refused the invalid move and the board rolled it back with a toast, and nothing during the drag marked the columns the card could not enter.

- **While a card is dragged**, every lane its column's value may not move to is dimmed and draws no drop highlight (`aria-disabled`, `data-kanban-drop-blocked`), on the flat layout and in every swimlane row.
- **A drop into such a lane is refused on the client**, before the optimistic move and before any write: the card stays in its column. A cancelled drag puts the lanes back.
- **Which lanes close** is read through `stateMachineNextValues` from `@object-ui/core`, the same read the record form and the grid's inline editor use. Only a rule on the board's own `groupBy` field that the server enforces on update closes a lane (`severity` `error`, `active`, `events` covering `update`). An undeclared from-state and the Uncategorized lane stay open.
- `KanbanBoard` (the lazily loaded board both entry points render) takes a new optional prop, `canDropCard(fromColumnId, toColumnId)`. `ObjectKanban` derives it; `KanbanRenderer` passes none, so a host-mounted board is unchanged. The server still refuses an invalid move, and the mover's rollback stays. No new visible text.
