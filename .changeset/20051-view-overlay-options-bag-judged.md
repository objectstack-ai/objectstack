---
'@objectstack/spec': minor
---

fix(spec)!: a flattened list view overlay's legacy `options` bag is judged at the view write door, so an out-of-contract `options.KIND` key is refused by name exactly as the direct spelling is (#20051)

**BREAKING** accept-set narrowing on the `view` write door (`PUT /api/v1/meta/view/:name`, the Studio and MCP save). It ships as `minor` under the repo's launch-window convention for breaking changes. This is the door half of ruling A on objectui#10380 (maintainer 「其他同意」).

Clause-②: no

## What was wrong

The flattened list overlay member of `ViewMetadataSchema` re-opens its top level with `.strip()` so the console's round-trip keys survive. That strip also dropped a top-level `options` bag from the parse without looking inside it. `saveMetaItem` stores the request body, not the parse output, and objectui's interface page forwards a stored view's `options` into the list renderer, which merges `options.KIND` under the top-level `KIND` block. Measured on `origin/main` @ `8d1f7ab` through the real save: `timeline: { metaFields: [...] }` answered `422`, while the same key written as `options: { timeline: { metaFields: [...] } }` answered `200` and the row held it as sent.

## What it does now

- **The list overlay declares `options`.** Each `options.KIND` (`kanban`, `calendar`, `gantt`, `gallery`, `timeline`, `chart`, `map`, `tree`) is judged by that kind's own block schema: the same closed key set, the same per-key schemas and the same unknown-key message. The refusal names the key, with only the `options.` prefix added to the path. The kinds are derived from the list-view shape, not listed by hand.
- **Key by key.** The renderer reads the bag as a per-key underlay of the top-level block, so the block's required keys are not asked of it. `kanban: { groupByField, columns }` beside `options.kanban: { titleField }` stays legal, which is the population objectui pins.
- **The bag is closed.** A key that is not a kind (`options.foo`, `options.grid`) is refused by name at `options`. It is no longer dropped.
- **The form overlay pins `options` absent.** Without this, a column-less, type-less list body that the list overlay refused over its bag would be accepted by the form overlay and stored unjudged. The refusal says the bag belongs to a list view.

The legacy `options.map` bag that objectui pins (`locationField`, `titleField`) is still accepted, and it round-trips.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `options: { kanban: { groupField: 'stage' } }` | `kanban: { groupByField: 'stage', columns: [...] }`, or `options: { kanban: { groupByField: 'stage' } }` |
| `options: { calendar: { dateField: 'kickoff' } }` | `calendar: { startDateField: 'kickoff' }` |
| `options: { timeline: { metaFields: ['region'] } }` | delete `metaFields`: the timeline block has no such key |
| `options: { chart: { xAxisField, yAxisFields } }` | the dataset-bound block, `chart: { dataset, values, dimensions }` |
| `options: { foo: 1 }` | delete `foo`: the bag carries per-kind blocks only |
| `options: {...}` on a form overlay (`viewKind: 'form'`) | delete `options`: a form view has no per-kind blocks |

**The one-line fix:** read the refusal. It names the key and the block that refuses it; move the key to the top-level block's declared spelling, or delete it.

## Stored-row census (ruling item 3)

- **objectstack** @ `8d1f7ab` (examples, dogfood, fixtures, tests): zero view bodies carry a top-level `options` bag with a kind block. Authored views go through the strict authoring shape, which has always refused `options`.
- **objectui**, at the `.objectui-sha` pin `f8a9d0fb0` and at `main` `c3a26ccda`: 28 `options` bag literals, plus the finding's own probe body, judged against this change. 17 pass and 12 fail, and every failure is an out-of-contract key refused by name. None fails for a missing key.
  - **Bodies that model a stored or authored view** (a console-merged `listViews` entry or a named view): 8, of which 5 pass, the pinned `options.map` path among them. The 3 that fail: `options.kanban.groupField` in `plugin-view` `ObjectView.tsx`'s docblock example (write `groupByField`), `options.calendar.dateField` in `ObjectView.calendarAliasRefused-8355.test.tsx` (write `startDateField`; that test already pins the alias as refused on objectui's side), and the finding's `options.timeline.metaFields` (delete it).
  - **Renderer-level `ListView` props** (21), which never reach this door: 12 pass. The 9 that fail spell the legacy keys objectui's own refusal pins already retire (`groupField`, `groupBy`, `dateField`, `metaFields`, and the object-bound chart keys `xAxisField` / `yAxisFields` / `aggregation`).
- **Production `sys_metadata` rows: NOT MEASURED.** No deployment's store is reachable from the repository. A stored row that fails keeps being read and served exactly as stored. It is refused only on its next save, and the refusal names the key.

## Not in this change

Persisting the parse output instead of the request body (ruling item 2) is not in this change. This change leaves the save path's storage behaviour as it was: a body the door now accepts is stored as sent, so every stored `options` bag is one the door judged.

<!-- adr-0087: registered view-overlay-options-bag-judged -->
