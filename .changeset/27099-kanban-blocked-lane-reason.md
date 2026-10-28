---
'@object-ui/plugin-kanban': patch
'@object-ui/i18n': patch
---

fix(plugin-kanban): a lane that refuses the dragged card now says why

Clause-②: no
Metadata-protocol: none

While a card is dragged, a lane the board's drop gate closes was dimmed and `aria-disabled` with nothing saying why. It now carries the reason as its `title` (a pointer user's tooltip) and as the text its `aria-describedby` names (assistive tech). An open lane carries neither, and the reason leaves with the drag. The swimlane layout's cells carry it the same way.

- **`object-kanban`.** The reason is the `message` of each blocking `state_machine` rule on the grouped field that refuses the move, the sentence the server's refusal of the same move carries. A rule the gate ignores (warning-only, inactive, insert-only, or silent on the card's value) is never named; several closing rules join their messages.
- **Hosts of the board.** `KanbanBoardProps` gains an optional `dropBlockedReason(fromColumnId, toColumnId)` beside `canDropCard`. A host that answers nothing, or passes no function, gets the new `kanban.dropBlocked` sentence ("A card in To Do cannot be moved to Done.") with the two column titles, in all ten language packs.
