---
"@objectstack/spec": minor
---

fix(spec)!: `dashboard.widgets[].options.stageOrder` is refused on every widget type that does not read it (#17344, finding 1)

<!-- adr-0087: registered dashboard-widget-stage-order-non-funnel-refused -->

**BREAKING** — an accept-set narrowing on a published authoring surface. `options.stageOrder` was an ungated member of the widget `options` bag and parsed on every widget `type`; it is now refused at parse on every type except `funnel`. Shipped as `minor` under the repo's launch-window convention for accept-set narrowings. Stored metadata carrying `stageOrder` on a non-`funnel` widget now fails validation and must be re-authored — the hand-migration prescription is registered under protocol major 18 as `dashboard-widget-stage-order-non-funnel-refused`.

## What was wrong

The key never failed. It failed to *order*.

`options` is the open renderer-extras bag, so nothing closed over `stageOrder`: a `horizontal-bar` widget carrying an authored seven-stage contract lifecycle parsed, booted, and forwarded the array to the renderer — which never looked at it, and rendered alphabetically by display label instead.

Measured at this repo's `.objectui-sha` pin `53ded82b`: the forwarded `categoryOrder` prop has exactly **one** read in the charts plugin — `buildCategoryRank(categoryOrder)` at `AdvancedChartImpl.tsx:1514` — and it sits inside the `chartType === 'funnel'` guard opened at line 1473. The prop's only other occurrences in that file are its declaration (247) and its destructure (850). The producer has no gate either: `DatasetWidget.tsx:1468` builds the explicit order for **any** widget and forwards it whenever non-empty.

So the authored order was accepted by the metadata layer, carried all the way to the chart, and dropped there with nothing anywhere to say so. A chart rendered in an order the author did not ask for, and did not ask for it *visibly* — it just looked deliberate. That is ADR-0049's enforce-or-remove shape, and a doc sentence saying "only `funnel` reads this" is not enforcement: it is prose the author has to read first.

## What it does now

`DashboardWidgetSchema` carries an object-level check that refuses `stageOrder` unless the widget's `type` is `funnel`.

It has to be object-level: `stageOrder` lives inside `DashboardWidgetOptionsSchema` while the `type` that decides whether it means anything is that object's **sibling one level up**, so a per-field refinement on `stageOrder` cannot see it. The check is a named function chained on with `.superRefine(…)` — the idiom this file already uses for `GlobalFilterSchema`'s date-default rule, rather than a second shape invented for one key.

The refusal lands at `options.stageOrder` and names three things, because the defect was silence and a bare "unrecognized key" answers silence with a shrug: the key, the `type` this widget carries, and the one `type` that honours it — plus where ordering lives for everything else.

## FROM → TO

| you wrote | write instead |
| --- | --- |
| `{ type: 'horizontal-bar', options: { stageOrder: [...] } }` | `{ type: 'horizontal-bar', options: { sortBy: 'contract_count', sortOrder: 'desc' } }` |
| `{ type: 'funnel', options: { stageOrder: [...] } }` | unchanged — this is the one type that reads it |
| `{ options: { stageOrder: [...] } }` (no `type`) | `{ type: 'funnel', options: { stageOrder: [...] } }` if a funnel was meant |

⚠️ Deleting the key changes nothing about what renders — the widget was already ignoring it. `sortBy` / `sortOrder` are what change it, and unlike a category order they lower into the dataset query as `order: { <name>: 'asc' | 'desc' }` rather than re-sorting what it returned.

## What the gate does NOT cover

Stated so the change is not read as complete:

- ⚠️ **objectui's client-side authoring door.** This refusal is the **publish** door's, not the editor's. `@object-ui/types` builds its own `DashboardWidgetSchema` from `specFieldsExcept(SpecDashboardWidgetSchema.shape, …).extend({…}).strict()`, and a `.shape` spread carries the FIELDS while dropping every object-level check — measured here: `z.strictObject(DashboardWidgetSchema.shape)` accepts a `horizontal-bar` carrying `stageOrder` and reports zero checks, while `.extend({})` keeps the refusal. At the pinned `.objectui-sha` that package re-attaches none of this spec's exported checks, so until it imports and chains `checkDashboardWidgetStageOrder` the dashboard editor keeps accepting the key on a `bar`. That mirror also redeclares `type` as optional with no default, so a typeless widget would reach a re-attached check as `undefined` rather than as `metric`; the exported check defaults it itself for exactly that caller, so re-attaching is sufficient.
- **A widget whose `type` is outside `ChartTypeSchema`.** zod treats that `invalid_value` as aborting and skips object-level checks for the input, so `type: 'ziggurat'` plus a `stageOrder` reports the type refusal alone. The author fixes the type, re-parses, and meets this refusal then; the two are never seen together. Pinned.
- **A widget that declares no `type`.** `type` carries `.default('metric')` and zod applies defaults before object-level checks, so an omitted `type` is indistinguishable here from an authored `metric`. The verdict is right either way — `metric` reads the key no more than `horizontal-bar` does — and that one case carries an extra sentence pointing at the missing `type` rather than a wrong one.
- **The array's contents.** Still unconstrained `string | number | boolean` members, unmatched against the dimension's picklist. A `funnel` carrying a misspelled stage parses and renders that stage in the sentinel position; whether a stored value exists is a fact about the dataset, not about the widget.
- **Consumers that derive this schema with `.omit()` / `.pick()` / `.partial()`.** zod 4 throws on all three once an object carries a refinement, so this change converts those three from working to throwing. Latent rather than live — no consumer in either repo derives the widget schema that way today — and `.extend()` is unaffected.

## The siblings, measured and deliberately not touched

`stageOrder` was the only member of that bag with this shape. `dateGranularity`, `sortBy`, `sortOrder` and `limit` are read unconditionally at the top of `DatasetWidget` (lines 443–455, outside every type branch) and lower into the `DatasetSelection` the server compiles, so they act on every widget type.

## The other arm, deliberately not taken

The card offered either/or: gate the key, **or** teach the ordered marks (`bar` / `column` / `horizontal-bar` / `line` / `area`) to honour it. The second is a renderer change in `objectstack-ai/objectui` and not this repo's to make. The asymmetry also favours gating: a narrowing that is later relaxed costs an author nothing, while an accepted-and-inert key costs them a chart that silently says something they did not author.
