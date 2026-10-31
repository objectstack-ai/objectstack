---
'@object-ui/core': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-view': patch
'@objectstack/spec': patch
---

feat(console): a kanban view's `kanban.lanes` now decides which lanes the board draws, and in what order

Clause-②: yes (widening)
Metadata-protocol: none

`kanban.lanes` (an ordered list of the group field's stored option values) was declared in the spec but the Console did not read it yet, so a board still drew one lane per option. A task board that filters out completed tasks kept an always-empty `Completed` lane, and an author could not reorder lanes.

- **The board draws the listed lanes, in the listed order.** Each lane is titled with its option's label, and a translated label still wins. A lane whose option is a `lost` lifecycle kind still starts collapsed. Without `lanes` the board is unchanged: one lane per option.
- **Nothing is hidden.** A record whose value is not listed lands in the board's `Uncategorized` lane, both when the board groups loaded records and when it pages each lane on its own. To keep records off the board, filter the view.
- **Both routes agree.** A list view and an `object-view` element hand the lanes to the board the same way.
- **`@object-ui/core`**: new `kanbanDeclaredLanes(lanes, options)`, which turns a list view's `kanban.lanes` into the `object-kanban` node's `columns`.
- **`@objectstack/spec`**: the liveness ledger records `kanban.lanes` as live.
