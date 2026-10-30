---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec): a kanban board can choose which lanes it draws, and in what order, `kanban.lanes`

Clause-②: yes (widening)
Metadata-protocol: added

A board grouped on a select field drew one lane per option, always, so a lane the view's own filter keeps empty (a task board that filters out completed tasks still drawing its Completed lane) could not be left off, and the lanes could not be put in any order but the options' own. `KanbanConfigSchema` (the list view's `kanban` block) gains one optional key:

- **`lanes: string[]`.** The lanes the board draws, in this order, as stored option values of the `groupByField` field (the option `value`, not its label). For example `lanes: ['not_started', 'in_progress', 'waiting']` on a task board grouped by `status`.
- **A choice of lanes, not a record filter.** A record whose value is not listed lands in the board's `Uncategorized` lane, as a record whose value matches no lane already does. To keep records off the board, filter the view.
- **Absent means one lane per option.** The key has no spec-side default, so a board stored before it existed parses to exactly the block it stored and draws the lanes it always did.
- **Refused at parse:** an empty list (omit the key instead), and an entry that is not shaped like a stored option value (a display label such as `'In Progress'`).
- **Refused against the object** (`@objectstack/lint`, so `os validate`, `os build` and the runtime publish gate): a lane that is not an option of the group field (`list-view-kanban-lane-unknown`, which names the nearest option), and a value listed twice (`list-view-kanban-lane-repeated`, at the second entry). A misspelled lane would otherwise draw a lane no card can land in while every card with the option it meant falls into `Uncategorized`. Judged against the group field's inline `options`; a field whose options come from a shared `picklist`, and a group field with no options (a boolean, a lookup), are not judged. `os explain list-view-kanban-lane-unknown` (and `-repeated`) carries the reasoning.

The Console renderer reads the key in a follow-up change; until then a board that declares it still draws one lane per option.
