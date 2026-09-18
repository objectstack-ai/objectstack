---
"@objectstack/lint": minor
---

fix(lint)!: `list-view-field-unknown` walks the four field-naming keys that had no position row at all

Clause-②: no (narrowing)

**BREAKING** — an accept-set narrowing on the list-view authoring surface. Four declared, authorable field-naming keys had no row in `POSITIONS` in `validate-list-view-field-refs.ts`, so a misspelt field name at any of them cleared the schema door, was walked by nothing, and was dropped by the renderer. From this release each is judged, and two of the four gate `validate` and `build`, so a stack that built yesterday with one of those two misspelt does not build now. Shipped as `minor` under the repo's launch-window convention for accept-set narrowings.

<!-- adr-0087: not-required (no-migration-prescription) nothing is removed and nothing is renamed. Every spelling that parsed before still parses, no stored value has to be rewritten to a different one, and the correct name is whatever the bound object declares -- so there is no mapping for the ledger to carry and `objectstack migrate meta` has nothing to apply. -->

## The keys, and why the tier is not the same for all four

All four are `z.string().optional()` on their config schema, and the schema shape is deliberately not what tiers them — the tier is the consequence, read per key off its own `.describe()` and its renderer (measured in objectui `dda8f3815`).

| key | declared at | tier | what a misspelt name does |
|:--|:--|:--|:--|
| `calendar.allDayField` | `CalendarConfigSchema` | `warning` | `ObjectCalendar` maps each event with `allDay: allDayField ? Boolean(record[allDayField]) : !endDate`, so every row reads `undefined` and no event is banded — and the renderer's own no-end-date inference is switched off by the key's mere presence. Every event still renders, at its start time: one decoration dropped. |
| `gantt.borderColorField` | `GanttConfigSchema` | `warning` | `borderColorRaw = borderColorField ? record[borderColorField] : undefined` leaves `borderColor` undefined for every task. Every bar keeps its fill and renders without its alert outline — `colorField`'s case. |
| `gantt.lockField` | `GanttConfigSchema` | **`error`** | A declared WRITE GUARD that fails OPEN. `locked: lockField ? !!record[lockField] : undefined` reads `undefined` on every row, and the drawer's `recLocked` falls the same way, so every row the author froze becomes draggable, resizable, progress-draggable, link-able, inline-editable and deletable — and the drag persists. |
| `gantt.objectField` | `GanttConfigSchema` | **`error`** | `isSyntheticRow` is `!!objectField && !String(rec[objectField] ?? '').trim()`, so a name no record carries answers TRUE for every row. `onTaskClick` never calls `navigation.handleClick` and `renderRecordOverlay` returns null: no bar in the chart opens a drawer or a detail page. |

The two `error` rows are a consequence the rule's own severity note did not name and now does: a binding whose job is to RESTRICT or to ROUTE, where the miss is read as "no restriction" / "no route" on every row. Nothing is missing from the picture, which is exactly why it gates — it is the shape Prime Directive #10 names, a capability advertised in the metadata and not delivered by the runtime. Both are also worse DECLARED than omitted, because each renderer guards its behaviour on the key's mere presence.

## Measured, one list view carrying every walked position, one mutation at a time

| probe | before | after |
|:--|:--|:--|
| `calendar.allDayField` naming a field that does not exist | silent | `warning` at `views[0].list.calendar.allDayField` |
| `gantt.borderColorField` naming a field that does not exist | silent | `warning` at `views[0].list.gantt.borderColorField` |
| `gantt.lockField` naming a field that does not exist | silent | `error` at `views[0].list.gantt.lockField` |
| `gantt.objectField` naming a field that does not exist | silent | `error` at `views[0].list.gantt.objectField` |
| each of the four naming a REAL field | silent | silent |
| the other 53 walked-position probes | 53 reported, each at its severity | the same 53, each at its same severity |
| the clean fixture carrying all four bound to real fields | 0 findings | 0 findings |

Over this repository's own tree the finding count is **0 before and 0 after**: no example app, fixture or seed authors any of the four keys at all (`git grep` over every tracked file finds the spec declaration, its own schema tests and the generated reference docs, and nothing else), so nothing existing starts reporting.

## What an author does about a report

Nothing is renamed and nothing is removed — every spelling that was valid is still valid, and no stored value has to be rewritten to a different one. What changes is that a name which resolves to no field on the bound object is now reported instead of being dropped in silence.

There is no mapping to apply, and deliberately so: the correct spelling is whatever the bound object declares, which only that object knows. The remedy is always the same — name a field the object actually has, or drop the key — and the finding carries the object's own field list plus a "did you mean" suggestion, so the message itself names the spelling to write.

## Scope — what is deliberately NOT changed

- **No dotted verdict.** The four positions join `POSITIONS` and deliberately not `DOTTED_AXIS`: none of them reaches a query door this rule measured, so a dotted name at one of them is unjudged, exactly as every other renderer binding is. Pinned.
- **No other surface.** `listViews`, `recordTypes` and the other label/field-naming surfaces are untouched; widening to them is a measurement, not a corollary.
- **No new rule id, no message shape change, no severity change for any existing position.** `list-view-field-unknown` gains four more places it can be reported from.
