---
'@objectstack/spec': minor
---

feat(spec)!: eight list members of an `object-grid`, `object-kanban` or `object-calendar` page block take the shape the block reads instead of any value — the grid's `fields`, `selection`, `selectable`, `rowActions`, `bulkActions` and `batchActions`, the kanban's `columns` and the calendar's `calendar` (#21464)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-grid-kanban-calendar-list-members-typed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the rows: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **Eight members are typed.** `ComponentPropsMap['object-grid']`, `['object-kanban']` and `['object-calendar']` declared these members as `z.unknown()` (an array of it for the lists), although each renderer reads them with one shape. Any value passed, and an off-shape one was dropped or substituted with no report: an object entry in `fields` named no field; a `{ name }` entry in `bulkActions` was skipped; a kanban lane list mixing objects and strings drew a blank lane; a calendar block with no `startDateField` placed no event.
- **The list view's own members, by reference**, where a list view declares one: the grid's `selection` (`{ type }`, with `none`, `single` or `multiple`), `rowActions` and `bulkActions` (action-name strings), and the calendar's `calendar` (`{ startDateField, endDateField?, titleField?, colorField?, allDayField? }`). `batchActions`, the second spelling of `bulkActions` that the grid reads first, takes `bulkActions`'s def. Neither spelling is retired here.
- **The measured shape**, where no list view declares the member: the grid's `fields` (field-name strings), the grid's `selectable` (`true`, `false`, `'single'` or `'multiple'`), and the kanban's `columns` (all lanes `{ id, title, cards?, limit?, className?, collapsed? }`, or all bare value strings). A lane `id` and `title` are strings, a static card carries a string `id` and `title` beside its row's own values, and `limit` is a positive integer.
- **`ObjectGridProps`, `ObjectKanbanProps` and `ObjectCalendarProps`** (and their `…Parsed` twins) carry these types on the eight members instead of `unknown`.
- **The grid's `columns` is not narrowed** and still accepts any value. The list view's column entry is its by-reference shape, and the grid's draw path reads exactly that, but the grid's group headers also draw the labels from an authored column's `options` (the column whose `field` is the grouping field, ahead of the field's own options). The list view's column entry declares no `options`, so typing `columns` now would refuse a value the grid draws. It is held until that read is ruled.
- **The enumeration pin** loses eight lines and keeps the grid's `columns` as held for that ruling. One `z.unknown()` member is added and recorded: the rest of a static kanban card (its row's own values, beside the typed `id` and `title`).

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `object-grid` `fields: [{ field: 'name', width: 240 }]` | `fields: ['name']`, or the entry on `columns` |
| `object-grid` `selection: 'multiple'` | `selection: { type: 'multiple' }` |
| `object-grid` `selectable: 'none'` | `selectable: false`, or `selection: { type: 'none' }` |
| `object-grid` `bulkActions: [{ name: 'approve' }]` (also `batchActions`, `rowActions`) | `bulkActions: ['approve']`, or the full def on `bulkActionDefs` |
| `object-kanban` `columns: [{ id: 'done', title: 'Done' }, 'todo']` | one spelling per list: `columns: [{ id: 'done', title: 'Done' }, { id: 'todo', title: 'To Do' }]` |
| `object-kanban` a lane `color: 'red'` | `className: 'border-t-2 border-red-500'` |
| `object-kanban` a lane `{ id: 1, title: 'One' }` | `{ id: '1', title: 'One' }` |
| `object-calendar` `calendar: { dateField: 'kickoff', endField: 'wrapup' }` | `calendar: { startDateField: 'kickoff', endDateField: 'wrapup' }` |

The one-line fix: write each member as the list view declares it, or as the table above shows. No conversion is registered, because an off-shape value has no rewrite that both keeps what the block shows today and honours what the author wrote; the D3 entry `ui-object-grid-kanban-calendar-list-members-typed` carries that judgment.

## Who is affected, measured

A writer is a page-component node: an object literal naming the type, a literal annotated with the block's type, a `schema={{…}}` on the block's React component, a call into a local helper that builds the node, or a direct parse through the row. Each member's value is read through same-file constants, and the control is `objectName` on the same nodes.

- **objectstack** at `49161683fb`, over `examples/`, `packages/` (with `packages/apps/`), `content/`, `skills/` and `apps/`: 57 `object-grid`, 30 `object-kanban` and 5 `object-calendar` nodes (the control on 47 / 27 / 4 of them). The one authored value among the eight members is a kanban `columns` (lanes, in the protocol docs), and it parses. No node authors another of the eight.
- **objectui** at the `.objectui-sha` pin `89cad75d55`: 689 `object-grid`, 240 `object-kanban` and 160 `object-calendar` nodes (the control on 293 / 108 / 98). Across the eight members, 241 values are static, and 233 of them parse. Each of the 8 that do not is a test fixture whose value the renderer drops, skips or refuses: 2 object entries in `bulkActions` (the renderer skips them, and the tests assert the skip), 3 object entries in `fields` that copy the hand-off the list view makes to the grid at run time (not an authored page), a lane `color` (retired in the console; the test marks it an undeclared member), and 2 uses of the calendar's retired `dateField` / `endField` aliases (the test asserts their refusal). No refused value is one the renderer draws. 24 values are not static (helper parameters, `.map` results and the run-time hand-offs); none of them is an authored page. The grid's `columns` (310 static values) is held because 2 of them author a column `options` the grid draws in its group headers, a fixture written to pin that behaviour.
- **Deployed metadata** was not measured.
