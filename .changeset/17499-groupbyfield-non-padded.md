---
"@objectstack/spec": minor
---

fix(spec)!: `groupByField` refuses a padded field name on kanban, gantt and timeline instead of handing the renderer a lookup that always misses (#17499)

**BREAKING** — an accept-set narrowing on three published authoring keys. `KanbanConfigSchema.groupByField` (**required**), `GanttConfigSchema.groupByField` and `TimelineConfigSchema.groupByField` were bare `z.string()`, so `' stage'` was valid authored metadata; all three are now refused at parse. Shipped as `minor` under the repo's launch-window convention for accept-set narrowings, the same as the sibling axis in #17360. Stored metadata carrying a padded `groupByField` now fails validation and must be re-authored — the hand-migration prescription is registered under protocol major 18 as `ui-list-view-groupbyfield-padded-refused`.

## What was wrong

The padded name never failed anywhere. It failed to *group*.

These three keys name a field the consumer looks up on **every row, by that name**. Measured in objectui at `dda8f3815`: the kanban board resolves its lane as `laneField = groupByField || groupField || detectStatusField(objectDef)` and buckets cards by `card[laneField]`; `ObjectGantt`'s `groupByAccessor` splits the name on `.` and walks the backing record (`resolvePath(task.data, field)`); the timeline groups its rows the same way. The server answers under the unpadded name, so a padded spelling reads `undefined` on every row and the board collapses into one `Uncategorized` lane — the gantt and the timeline into one ungrouped bucket — holding every record.

That is a silent wrong answer that reads as a true statement about the data: a user looking at one giant lane cannot tell it apart from a dataset where the field genuinely is empty. Nothing weaker than a parse refusal is honest about it.

`packages/lint`'s `validate-list-view-field-refs` already calls this consequence out for `kanban.groupByField` (*"collapses every card into the uncolumned bucket"*), and grades that position `error` — but that rule only runs where an app is validated against its object definitions. The producer accepted the value regardless, which is the hole this closes.

## What it does now

Each of the three carries the **non-padded** pattern — no leading and no trailing whitespace — and the refusal is addressed to the offending key (`kanban.groupByField`, `gantt.groupByField`, `timeline.groupByField`), names the offending spelling verbatim so the whitespace an author cannot see in an editor is visible in the message, and carries the name to write instead.

⛔ **Not a `.trim()`.** A trimming schema makes `' stage'` and `'stage'` silently equivalent, which is the consumer-tolerance direction AGENTS.md #0.1 refuses: the padded spelling is a mistake the author should be told about, not a dialect the producer quietly normalises away. On the **required** kanban key this is sharper than on the sibling axis — an author cannot withdraw the value by omitting the key, so a normalising producer would be the author's only feedback channel and it would say nothing.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `kanban: { groupByField: ' stage' }` | `kanban: { groupByField: 'stage' }` |
| `gantt: { groupByField: 'owner ' }` | `gantt: { groupByField: 'owner' }` |
| `timeline: { groupByField: 'team\n' }` | `timeline: { groupByField: 'team' }` |

The remedy is always the same: write the field name exactly as the object declares it and the server answers under. If a board has been silently showing one `Uncategorized` lane, re-authoring the name is also the fix for that.

## Scope — what is deliberately NOT narrowed

- **The empty string is unchanged.** It still parses, exactly as before, on all three keys. This narrowing exists for the **silent** case; widening the pattern to catch `''` would be a second, undeclared narrowing riding on this one.
- **This is not the snake_case machine-name grammar.** `packages/spec` spells `/^[a-z_][a-z0-9_]*$/` inline for object, field and tool **names**, and these keys deliberately do not take it: a `groupByField` holds a field **reference**, and a dotted relationship path (`owner.name`) is an in-tree spelling of one — `packages/lint`'s `validate-list-view-field-refs.test.ts` carries `kanban: { groupByField: 'owner.name' }` in a case asserting no findings.
- **The sibling axis `grouping.fields[].field`** already landed this rule in #17360 / PR #17498; this change reuses that pattern rather than declaring a second one.

## Who is affected, measured

Every `groupByField` spelling in this repo parses unchanged. Harvested across every `.ts` / `.tsx` / `.mdx` / `.json` / `.mjs` outside `node_modules`: **14 distinct literals, zero of them padded** (`'warning'` / `'error'` are severity-map values in `packages/lint` and `'<select_or_status_field>'` is prose inside a completeness hint, so neither is an authored name). Nothing in the tree reddens, and no fixture had to be rewritten to keep it green.

Outside the repo, only metadata that was already grouping wrongly is affected: a padded `groupByField` has never produced a correct board, gantt or timeline on any renderer.

Clause-②: no (narrowing) — no key is added, removed or renamed, no exported symbol moves (`check:api-surface` clean with no regeneration), and no registry row is added. The accept set narrows back to what the key's description already claimed.

<!-- adr-0087: registered ui-list-view-groupbyfield-padded-refused -->
