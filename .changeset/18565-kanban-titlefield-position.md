---
"@objectstack/lint": minor
---

fix(lint): `list-view-field-unknown` walks `kanban.titleField` — the one item-titled face the position table never listed (#18565)

Clause-②: no

`POSITIONS` in `validate-list-view-field-refs.ts` declares, per view face, which field-reference keys are walked and at what level, and `kanban` was the only item-titled face with no `titleField` row. From #16894 the key is authorable on `KanbanConfigSchema`, so from that release a misspelt field name cleared the schema door, was walked by nothing, and the board fell back to the ADR-0079 record display name — a title the author did not ask for, on a board that renders correctly, with no gate reporting the miss. The byte-identical typo one block away on `calendar` or `timeline` was reported.

Measured on this branch, one list view carrying every walked position, one mutation at a time:

| probe | before | after |
|:--|:--|:--|
| `kanban.titleField` naming a field that does not exist | silent | `warning` `list-view-field-unknown` at `views[0].list.kanban.titleField` |
| `kanban.titleField` naming a real field | silent | silent |
| the other 51 walked positions | 51 reported, 1 silent (this one) | the same 51, each at its same severity |

Over the repo's own example apps (`app-crm`, `app-todo`, `app-multi-package`, `app-showcase`) the findings count is **0 before and 0 after**: five kanban blocks are authored there and none carries `titleField`, so nothing existing starts reporting. Injecting `titleField: 'zz_no_such_field'` into those same boards flips 0 → 1 warning in `app-crm` and `app-showcase`.

**`warning`, the level `calendar` takes — not the level of the two siblings that spell the key required.** `KanbanConfigSchema` declares `titleField` OPTIONAL (#16894 copied `CalendarConfigSchema` for this exact key and names `TimelineConfigSchema` / `GanttConfigSchema`, the two that spell it required, as the siblings it deliberately does not copy), and the board resolves an unresolvable name through the ADR-0079 display-name chain: measured in objectui `dda8f3815`, `resolveKanbanTitleField` returns the written name, the card reads `rec[titleField]`, finds nothing and falls to `getRecordDisplayName`. Every card still renders — the warning tier's own case in this rule's module note ("the renderer drops one decoration and renders the rest: an optional colour / title / tooltip / cover binding"), where `kanban.groupByField` is the error tier's, collapsing every card into one uncolumned lane.

No rule id, no severity and no message shape changes for any other position; `list-view-field-unknown` gains one more place it can be reported from.
