# Spec enum ↔ renderer coverage audit (#2901)

Audited against `@objectstack/spec@16.0.0-rc.0` and `objectui@cd09a7b90`.
**Re-validated against `17.0.0-rc.0`** — see the addendum at the end, which also
carries four corrections. Read it before acting on any row below.

Every row below was confirmed by reading the dispatch code. Nothing was exercised at
runtime, so symptoms are read off the code path, not observed. Rows the auditors could
not confirm are marked and kept separate rather than padded into the table.

---

## The premise moved

#2901 described `ChartTypeSchema` as a 7-value spec enum that `plugin-charts` had outgrown
with 13 renderer-local names. That is backwards. The spec enum has **19** values
(`ui/chart.zod.ts:18`). The 7-value list is an objectui fork —
`packages/types/src/zod/data-display.zod.ts:209` — re-exported from `@object-ui/types`
under **the same symbol name the spec uses**. Two packages export `ChartTypeSchema`; they
differ by twelve values.

That inversion is the audit's most useful result, because it generalises: the failure is
rarely "renderer forgot a name". It is usually "a second definition of the vocabulary
exists, and the renderer is faithful to the wrong one".

---

## Headline numbers

| | |
|---|---|
| Named enum exports in spec `ui/` | 30 |
| …with a real consumer outside `packages/types` | **11** |
| …named only in a `packages/types` deny-list or local fork | 14 |
| …with zero mentions anywhere in the repo | 5 |
| Confirmed Direction A gaps with a user-visible defect | **24** |
| …plus inert Direction A gaps (validates, changes nothing) | 11 |
| Surfaces carrying Direction B dialect | 10 |
| objectui forks shadowing a spec symbol name | 5 |
| Enum-value parity guards in the repo | **1** |

The middle number is the structural one: **19 of 30 UI vocabularies have nothing
mechanically tying them to the spec.** That measures *derivation*, not coverage —
`VisualizationTypeSchema` obviously has a renderer, it just restates the nine values
instead of importing them. Drift there is unpoliced by construction, which is why the
gaps below went unreported rather than why they exist.

---

## Triage by runtime symptom

The issue's step 3 asks for judgment, not a dump. The useful axis turned out to be **what
the user sees**, because it orders the work by how long a bug can survive undetected.

### Tier 1 — silently wrong output

The worst class, and one the original #2897 bug did *not* belong to. A blank cell is
detectable; a plausible wrong number is not.

| Finding | Location | What happens |
|---|---|---|
| Pivot aggregation falls back to **sum** | [PivotTable.tsx:114](../../packages/plugin-dashboard/src/PivotTable.tsx) | `count_distinct`, `array_agg`, `string_agg` each return a sum. Wrong total, no signal. |
| Report chart falls back to **bar** | [DatasetReportRenderer.tsx:370](../../packages/plugin-report/src/DatasetReportRenderer.tsx) | 10 of 19 chart types silently draw a bar chart. Wrong picture, no warning. |
| `selection.type: 'single'` renders **multi-select** | [ObjectGrid.tsx:1610](../../packages/plugin-grid/src/ObjectGrid.tsx) → [data-table.tsx:1284](../../packages/components/src/renderers/complex/data-table.tsx) | Per-row checkboxes *and* select-all. `single` is never distinguished from `multiple`. |
| Filter `type: 'select'` renders multi-check | [UserFilters.tsx:227](../../packages/plugin-list/src/UserFilters.tsx) | A single-choice filter accepts many values. |
| `addRecord.position: 'both'` collapses to `top` | [ListView.tsx:389](../../packages/plugin-list/src/ListView.tsx) | Binary ternary; the bottom button never renders. |
| `tabular` vs `summary` report resolved from data, not type | [DatasetReportRenderer.tsx:779](../../packages/plugin-report/src/DatasetReportRenderer.tsx) | A `tabular` report that declares `rows` renders grouped. |

### Tier 2 — silently absent

The #2897 shape. Validates, renders nothing, nobody knows it should be full.

| Finding | Location | What happens |
|---|---|---|
| **`element: 'toggle'` removes the entire filter bar** | [UserFilters.tsx:162](../../packages/plugin-list/src/UserFilters.tsx) | `default: return null`. See "the deprecation that broke the renderer" below — this one is worse than a gap. |
| 7 chart types draw an **empty plot** | [AdvancedChartImpl.tsx:343](../../packages/plugin-charts/src/AdvancedChartImpl.tsx) | Grid, axes, tooltip and legend all render; every series mark hits `return null`. Looks like an empty dataset. |
| 6 of 9 animation presets do nothing | [useAnimation.ts:64](../../packages/react/src/hooks/useAnimation.ts) | `PRESET_CLASSES` is keyed in **hyphens** (`'slide-up'`), the spec enum in **underscores** (`slide_up`); `rotate`/`flip` absent entirely. Lookup misses → `''` → no animation. |
| 3 of 6 easings emit **invalid CSS** | [useAnimation.ts:112](../../packages/react/src/hooks/useAnimation.ts) | Same split, but `EASING_MAP[easing] \|\| easing` falls through to the raw string. `animationTimingFunction: 'ease_in_out'` — browser drops it, devtools shows the attribute populated. |
| `mode: 'auto'` breaks theming | [ThemeProvider.tsx:38](../../packages/app-shell/src/chrome/ThemeProvider.tsx) + [providers/ThemeProvider.tsx:33](../../packages/providers/src/ThemeProvider.tsx) | Renderer branches on `"system"`; spec says `auto`. `root.classList.add('auto')` matches no Tailwind variant → light theme, OS preference no longer followed, no error. |
| Export **PDF** downloads nothing | [ObjectGrid.tsx:1258](../../packages/plugin-grid/src/ObjectGrid.tsx), [ListView.tsx:1611](../../packages/plugin-list/src/ListView.tsx) | Excluded from `serverEligible` and absent from the client fallback. Popover closes, no file. `xlsx` does the same whenever the server path is unavailable. |
| Timeline `scale` blanks the axis | [renderer.tsx:270](../../packages/plugin-timeline/src/renderer.tsx) | `hour`/`quarter`/`year` produce zero header columns. All six are ignored entirely on the default `vertical` variant. |
| All 6 toast positions discarded | [toaster.tsx:15](../../packages/components/src/renderers/feedback/toaster.tsx) | `<SonnerToaster />` with no props, `inputs: []`. |
| All 5 notification types collapse to toast | [NotificationContext.tsx:155](../../packages/react/src/context/NotificationContext.tsx) | `displayType` is stored on the item and never read. |
| `navigation.size` ignored off app-shell | [useNavigationOverlay.ts:27](../../packages/react/src/hooks/useNavigationOverlay.ts) | Hook declares `width`, no `size`. Every non-app-shell host silently uses the default width. |
| `date-range` / `text` filters are dead controls | [UserFilters.tsx:456](../../packages/plugin-list/src/UserFilters.tsx) | Chip renders; popover shows the literal "No options". |
| 4 gesture types become **tap** | [useSpecGesture.ts:49](../../packages/mobile/src/useSpecGesture.ts) | Hook never reads `config.type`; branches on sub-object presence. `pan`/`drag`/`rotate`/`double_tap` match nothing and keep the `'tap'` initializer. |
| Report `aggregate: 'unique'` → blank cell | [ReportViewer.tsx:102](../../packages/plugin-report/src/ReportViewer.tsx) | `default: return ''`. Textbook #2897. |
| 9 field types get a **plain text input** inline | [FieldEditWidget.tsx:54](../../packages/fields/src/FieldEditWidget.tsx) | In neither `EDIT_WIDGETS` nor `INLINE_EXCLUDED_FIELD_TYPES`. Includes `secret`, `json`, `composite`, `record`, `repeater` — see security note. |
| 5 accepted filter operators never offered | [filter-builder.tsx:58](../../packages/components/src/custom/filter-builder.tsx) | `$startsWith`, `$endsWith`, `$notContains`, `$null`, `$exists` are unreachable from the UI. |

### Tier 3 — loud failure

Bad, but visible. `SchemaRenderer` renders a red `role="alert"` panel naming the type
([SchemaRenderer.tsx:365](../../packages/react/src/SchemaRenderer.tsx)). This tier is
cheaper to triage precisely because it cannot hide.

| Finding | Location | Missing |
|---|---|---|
| `PageComponentType` unregistered | Registry, [Registry.ts:288](../../packages/core/src/registry/Registry.ts) | 24 of 34 registered. Hard: `ai:chat_window`, `element:filter`, `element:form`. Soft (placeholder, and only in hosts calling `registerPlaceholders()`): `app:launcher`, `nav:menu`, `nav:breadcrumb`, `global:search`, `global:notifications`, `user:profile`, `ai:suggestion`. |
| Dashboard chart dispatch | [DashboardRenderer.tsx:131](../../packages/plugin-dashboard/src/DashboardRenderer.tsx) | `gauge`, `solid-gauge`, `kpi`, `bullet` |
| Editable dashboard grid | [DashboardGridLayout.tsx:173](../../packages/plugin-dashboard/src/DashboardGridLayout.tsx) | 8 types |

### Tier 4 — inert

Validates, type-checks, changes nothing. No user-visible harm *today*; each becomes a live
bug the moment someone wires the surface up.

`RecordHighlightsProps.layout` (never read) · `ElementMetadataViewerProps.mode` (never
read) · widget-level `actionType`/`actionUrl`/`actionIcon` (authored, round-tripped through
the config panel, never rendered) · `addRecord.mode` (read nowhere) · all four
`ui/offline.zod.ts` enums (restated in `useOffline.ts`, never branched on) ·
`DragHandleSchema`/`DropEffectSchema` (emitted as pass-through DOM attributes nothing
reads; every real drag site hardcodes `'move'`) · `DensityModeSchema` (spec marks it
`[EXPERIMENTAL — not enforced]`).

---

## The four findings that need a decision, not a patch

**1. The deprecation that broke the renderer instead of the name.**
`ui/view.zod.ts:315` says of `toggle`: *"Kept in the enum so existing configs keep
rendering; do not author new `toggle` filters."* [UserFilters.tsx:162](../../packages/plugin-list/src/UserFilters.tsx)
returns `null` for it — the whole filter bar vanishes. The component's own docstring at
`:122` advertises *"**toggle**: on/off toggle buttons per field"*. Three artifacts describe
one value; the only one that executes is the one that says nothing. Either the spec's
compatibility promise is false and should be withdrawn, or `toggle` needs a branch.

**2. `ai:chat_window` is offered by Studio and has no renderer.**
The page palette lists it with a label and icon ([block-types.ts:116](../../packages/app-shell/src/views/metadata-admin/previews/block-types.ts))
and gives it a config panel ([block-config.ts:352](../../packages/app-shell/src/views/metadata-admin/previews/block-config.ts)).
[placeholders.tsx:97](../../packages/components/src/renderers/placeholders.tsx) documents a
deliberate decision to *exclude* it so it produces "a loud Unknown component type". The
reasoning is sound; the palette was never told. An author drags a block Studio offers and
gets a red error box. Prune it from the palette, or ship the renderer.

**3. Two record-component vocabularies are fully disjoint.**
`RecordChatterProps.position` — spec `sidebar | inline | drawer` (default `sidebar`);
renderer [RecordChatterPanel.tsx:95](../../packages/plugin-detail/src/RecordChatterPanel.tsx)
tests `'right' | 'left'` and `'bottom'`. Zero overlap, so **authoring the spec's own default
value falls past every branch** — while omitting the prop works, because the renderer
defaults to `'right'`. `packages/types/src/record-components.ts:171` mirrors the *renderer*
dialect under a comment claiming alignment with the spec.
`RecordDetailsProps.layout` is worse: spec `auto | custom` selects a **field source**;
renderer `stacked | inline | compact` selects **label orientation**. Two different axes
wearing one key name — this probably needs two props, not a reconciled enum.

**4. `$ncontains` is a straight bug.**
[FilterConditionField.tsx:114](../../packages/fields/src/widgets/FilterConditionField.tsx)
emits `{ $ncontains: value }`. The token appears **zero times** in the entire spec, and
objectui's own [filter-converter.ts:126](../../packages/core/src/utils/filter-converter.ts)
throws `Unknown filter operator '$ncontains'` — naming the correct spelling
(`$notContains`) in the error message. The UI's "notContains" option is unreachable in
practice. No policy question here; fix the spelling.

**Security-adjacent, flagged separately:** `secret` is in neither `EDIT_WIDGETS` nor
`INLINE_EXCLUDED_FIELD_TYPES`, so grid inline edit falls back to a plain text input.
`password` *is* excluded, two lines away. Per `data/field.zod.ts:19` a `secret` is
encrypted-at-rest and fail-closed (ADR-0100). This almost certainly belongs next to
`password`. `json`/`composite`/`record`/`repeater` have the same gap, where the risk is
value corruption rather than disclosure.

---

## Direction B — renderer-local dialect

| Name | Location | Call |
|---|---|---|
| `navigation` action type | [ActionRunner.ts](../../packages/core/src/actions/ActionRunner.ts) | ~~Promote~~ — **resolved as a declared alias instead.** See the correction below. |
| `combo` chart type | [normalizeChartSchema.ts](../../packages/plugin-charts/src/normalizeChartSchema.ts) | ~~Promote or delete~~ — **derived from the series instead.** See Correction 4; the spec models it as `ChartSeries.type`. |
| `system` theme mode | ThemeProvider ×2 | Delete — the spec name is `auto`, and `react/ThemeContext.tsx` already gets it right. |
| `scale-fade` preset | [useAnimation.ts:71](../../packages/react/src/hooks/useAnimation.ts) | Delete with the hyphen/underscore fix. |
| `modal` notification type | [NotificationContext.tsx:23](../../packages/react/src/context/NotificationContext.tsx) | Inert — nothing reads `displayType`. |
| `before` / `after` filter ops | [view-config-utils.ts:59](../../packages/plugin-view/src/config/view-config-utils.ts) | Persisted **verbatim** into saved view metadata; in no spec vocabulary. `ListView.tsx:75` lowers the same tokens to `<`/`>`. Two contradictory translations of one token in one repo. |
| `'not in'` (with a space) | [ListView.tsx:74](../../packages/plugin-list/src/ListView.tsx) | Escapes as a literal operator when the value isn't an array. |
| `$ncontains` | see above | Bug, not dialect. |
| `right`/`left`/`bottom`, `stacked`/`inline`/`compact` | `plugin-detail` | See decision 3. |
| `status`, `owner`, `geolocation`, `object`, `grid` field types | `packages/fields` | Triage individually. |

---

## Systemic causes

**Nine disagreeing filter-operator vocabularies in the spec itself.** `FieldOperatorsSchema`
(15, `$`-camelCase) is what the data layer accepts. Alongside it: `VALID_AST_OPERATORS` (25
spellings, infix + snake_case + squashed), `FilterOperator` (`api/websocket.zod.ts`, bare
camelCase, adds `regex`), `ODataFilterOperatorSchema`, a GraphQL set, `lookupFilters[].operator`
(9), plus ad-hoc subsets in `ai/skill.zod.ts`, `ui/app.zod.ts`, `system/metrics.zod.ts`.
And `ViewFilterRuleSchema.operator` (`ui/view.zod.ts:71`) is `z.string()` — no enum at all,
while its own `@example` uses `operator: 'this_quarter'`, which no renderer implements. The
renderers then add a third register (`greaterOrEqual`, `isNotEmpty`) appearing nowhere in
the spec. No renderer can be correct against nine vocabularies; this needs consolidation
upstream before the UI side is worth fixing.

**Two spec vocabularies for chart type.** `ChartTypeSchema` (19) and
`ListChartConfigSchema.chartType` (`ui/view.zod.ts:360`, 5) reach the same `chartType` prop
of the same component. A list view cannot author `donut`, `funnel`, `treemap`, `sankey`,
`radar` or `horizontal-bar` even though the renderer draws all six. If the narrowing is
intentional it should be derived — `ChartTypeSchema.extract([...])` — not retyped.

**`ActionType` (6) vs `WidgetActionTypeSchema` (5).** They differ only by `form`, and
dashboard header actions funnel into the same `ActionRunner` that implements `form`. The
narrower enum rejects at validation what the shared dispatcher executes. One of the two is
wrong.

**Five objectui forks shadowing spec symbol names.** Each re-exports under the spec's own
name, so an importer cannot tell which they got.

| Fork | Spec | Drift |
|---|---|---|
| `types/src/zod/data-display.zod.ts:209` `ChartTypeSchema` | 19 | **7** |
| `types/src/zod/layout.zod.ts:258` `PageTypeSchema` | 5 | 4 — missing `list` |
| `types/src/layout.ts:432` `PageType` (TS) | 5 | **10** — adds the five visualizations the spec explicitly repudiates |
| `types/src/reports.ts:337` `ReportType` | 4 | 3 — missing `joined` |
| `types/src/ui-action.ts:72` `ActionType` | 6 | 5 — missing `form`, under a comment claiming it is canonical |

The `PageType` trio is one package holding three disagreeing definitions of one vocabulary,
drifting in **both** directions at once. All five are currently **inert** — no renderer
parses with them — so these are latent, not live. They are also already-settled policy
violations rather than open questions: #2231 established "re-export by reference; a
faithful copy is still a fork", and
[spec-subschema-parity.test.ts](../../packages/types/src/__tests__/spec-subschema-parity.test.ts)
pins reference identity for the schemas it covers. These five simply aren't covered.

**Dead spec-bridge code.** `packages/core/src/protocols/` — `DndProtocol`,
`NotificationProtocol`, `ResponsiveProtocol` — has **zero importers** outside itself. It
contains complete and correct mappings for notification severity, notification position and
breakpoints. Every one is dead. Separately, `types/src/data-protocol.ts:478`
(`AdvancedFilterOperator`, ~30 invented operators), `types/src/designer.ts:692`
(`DesignerFieldType`), and `types/src/complex.ts:228` (`FilterOperator`) have zero consumers
— a parallel spec nobody reads.

**Field-type knowledge is duplicated five ways.** No single field-widget registry exists:
form/edit dispatch, cell/display dispatch, inline-edit widgets, the Studio palette and the
Studio form-preview stub are five independent hand-written tables with different coverage,
plus `EXPANDABLE_FIELD_TYPES`, `NUMERIC_FIELD_TYPES`, `IMAGE_FIELD_TYPES`,
`NON_EDITABLE_FIELD_TYPES`, `OPTION_FIELD_TYPES` and `normalizeFieldType`. This is direct
support for the objectui#2731 position that value-shape belongs in the spec keyed by
`FieldType`.

---

## Why the existing guards can't see any of this

The repo has a mature drift-guard doctrine for schema **shape** (#2231 — three tests in
`packages/types`) and exactly **one** guard for enum-value **renderer coverage**
([summary-spec-parity.test.ts](../../packages/plugin-grid/src/__tests__/summary-spec-parity.test.ts),
from #2897). These catch different failures and the first kind is blind to the second:
`list-view-spec-parity.test.ts` asserts field *keys*, not enum *values*, so none of the
drift above trips it.

Two guards that look like coverage tests but aren't:

- `packages/fields/src/field-type-coverage.test.ts:19` hard-codes its own expected field
  list instead of importing `FieldType`, so it can only regress-test what someone
  remembered to type. It lists `autonumber` under form widgets but not cell renderers —
  which is exactly why the display-map gap survived.
- `block-config.test.ts:26` asserts palette *exclusions* by hand rather than deriving
  inclusion from `PageComponentType`, so it locks the drift in instead of detecting it.

The #2897 template ports without new machinery: `.options` reads cleanly through the
`lazySchema` wrapper on every enum tested. One prerequisite — of the 13 packages that would
need a guard, **6 cannot import the spec today**: `plugin-list`, `plugin-charts`,
`plugin-dashboard`, `plugin-report`, `components`, `mobile` all lack the
`@objectstack/spec` devDependency.

---

## Suggested sequencing

1. **`$ncontains`** and **`secret` inline edit** — bugs with no design question. Ship now.
2. **Consolidate the spec-side vocabularies** (filter operators, the two chart-type enums,
   `ActionType`/`WidgetActionTypeSchema`) while spec 16 is still RC. After GA, retiring a
   name is breaking. No renderer fix is durable until this lands.
3. **Retire the five forks** under the #2231 doctrine — mechanical, and they are inert
   today, so it is cheap.
4. **Tier 1** — silently wrong output, ordered by blast radius.
5. **Tier 2**, then guard each pair as it is fixed.
6. **Tier 4 / dead code** — decide enforce-or-remove, the doctrine already applied to
   `PageTypeSchema` at `ui/page.zod.ts:180` and not at all to prop-level enums.

Coverage gaps and dialect have different owners; the spec-side consolidation in step 2 is
upstream of most of the rest.

---

# Addendum — re-validated against spec 17.0.0-rc.0

The audit above was run against `16.0.0-rc.0`. objectui has since moved to
`17.0.0-rc.0` (#2950), so every finding was re-extracted and re-diffed. **The
enum-value findings all still hold** — but three things need correcting, and one
of them reverses an attribution.

## The 16 → 17 delta is not an enum delta

Of the 30 named enum exports in spec `ui/`, **zero changed values**. The only
movement:

| Change | Enum |
|---|---|
| Removed | `DensityModeSchema`, `WcagContrastLevelSchema` |
| Added | `ChartAggregateFunctionSchema` (`count sum avg min max`) |

The two removals resolve a Tier 4 row upstream — `DensityModeSchema` was listed
above as inert with the spec marking it `[EXPERIMENTAL — not enforced]`, and
enforce-or-remove has now been applied to it. The addition is a **fourth**
aggregation vocabulary, alongside `AggregationFunction` (8),
`AggregationFunctionEnum` (10, orphan), and the report columns' `unique`.

## Correction 1 — `before`/`after` are spec vocabulary, not renderer dialect

The Direction B table lists `before`/`after` as objectui-local dialect
"persisted verbatim, in no spec vocabulary". **That is wrong.** They are
canonical members of `VIEW_FILTER_OPERATORS` (`ui/view.zod.ts:90`).

The real defect is worse than dialect: the spec's **view-authoring** vocabulary
and its **query-layer AST** vocabulary disagree on **8 of 19** members —
`equals`, `not_equals`, `greater_than`, `less_than`,
`greater_than_or_equal`, `less_than_or_equal`, `before`, `after` are all absent
from `VALID_AST_OPERATORS` (`data/filter.zod.ts:352`), which gates
`isFilterAST()`.

Six were masked only because objectui's adapter happened to translate them. The
two it missed reached the wire verbatim, failed the gate, were passed through
**unconverted**, and then skipped entirely by `driver-sql applyFilters` — no
WHERE clause, no error, **every row returned**. A stored single-condition
"date before X" view came back unfiltered.

Fixed client-side in #2974, which also pins both translation tables to the spec
vocabularies in both directions. Server-side hardening: objectstack#3948.

## Correction 2 — narrowing is not cheap, and "while RC" was never the reason

The sequencing above says to consolidate spec vocabularies "while spec 16 is
still RC". Both halves are wrong. There is no version window (objectui is
already on 17), and RC status is not what makes narrowing risky.

What makes it risky is that **narrowing is loud for new authoring and silent for
everything already stored**: `defineStack` throws and `saveMeta` returns 422, but
the metadata *read* path neither drops nor errors, and objectui's render path
does not zod-validate view metadata at all. A narrowing lands green in CI, green
in `os build`, and degrades quietly against existing rows.

Compounding it, `saveMeta` persists the authored body **verbatim**
(`protocol.ts:4481`), so `ViewFilterRuleSchema`'s
`z.preprocess(normalizeFilterOperator, …)` normalizes for the validity check and
then discards the result — every legacy alias is still being written today, not
merely historical.

Revised guidance, tracked in #2945: additions are free; removals need a data
migration and are blocked on objectstack#3948.

## Correction 3 — one silent-drop is a *worse* failure than any row above

The audit's Tier 1 / Tier 2 split assumed the two possible outcomes were "wrong
output" and "no output". There is a third, found only when the filter path was
traced end to end: a filter that is **not applied at all**, returning a superset.
On a list whose only narrowing is that filter, the user sees rows they had asked
to exclude. It is not a permission bypass — row-scoping `$and`-composes as a
separate arm and survives — but it ranks with Tier 1, not Tier 2.

## Correction 4 — "promote it upstream" was the wrong call twice (`navigation`, `combo`)

Direction B told the reader to promote the `navigation` action type into the spec,
on the grounds that it is "a real capability the spec doesn't name". The capability
is real; the framing was not. The spec already names it — `type: 'url'`, with
`openIn` for the new-tab choice — so promoting `navigation` would have put a second
spec name on one operation. That is the failure this audit exists to describe,
committed one level up.

The row *also* under-read the cost of the stated alternative. Deleting the case
does not surface an error: the action falls through to `executeActionSchema`, which
returns `{ success: true }`, so the user gets a success toast and no navigation —
#2960's trap, reached by way of a cleanup.

What was missing from the row is that the alias had **already drifted**, which is
the ordinary outcome of two implementations of one concept. `executeNavigation` did
no `${param.X}` interpolation, ignored `openIn`, and skipped the `/api/…`
full-page short-circuit — so `{ type: 'navigation', to: '/x?p=${param.p}' }`
shipped the literal `${param.p}` while the identical `url` action resolved it.

Resolved by declaring it (`ObjectUiLocalActionType`) and routing both names
through one navigator — the same treatment #2985 gave the page-visualization names.
Generalizing: a "renderer-local dialect" row needs a third option next to promote
and delete — **alias to the spec name it duplicates** — and picking between the
three starts with asking whether the spec really lacks the concept or just spells
it differently.

**`combo` is the same mistake, and the check is one grep.** The row above told the
reader to promote or delete it. `ChartSeriesSchema.type` already exists, and its
field comment reads *"Series type override (combo charts)"* — the spec models a
combo chart per-series, exactly as it models stacking with `ChartSeries.stack`
rather than a `stacked-bar` family. `combo` is therefore derived from the series,
not authored (`effectiveChartFamily`).

Reading the row as written would also have missed what was actually broken. Two
live silent failures sat on the path a spec author takes:

1. the per-series override was parsed and carried and then **dropped** — only the
   `chartType === 'combo'` branch read `series[].chartType`, so `type: 'bar'` with
   a `type: 'line'` series drew a bar; and
2. a spec-shape `series` **rendered nothing at all** — `series` is the one binding
   both shapes spell alike, so `ChartRenderer`'s "internal props win" rule let the
   author's `[{ name }]` shadow the normalized `[{ dataKey }]`.

Neither is visible from an enum-coverage angle, which is worth noting about this
audit's method: **a dialect row can be the least interesting thing wrong at that
line.** The `combo` row asked whether a name belonged in the spec; the answer was
that the spec's own name for it had never worked.

## Status of the items above

| Item | Status |
|---|---|
| `$ncontains`; `secret` inline edit | Fixed — #2940 |
| `before`/`after`, `'not in'`, + 8 legacy spellings | Fixed — #2974 |
| `DensityModeSchema` inert | Resolved upstream (removed in spec 17) |
| Packages lacking the `@objectstack/spec` devDep | **6** — `plugin-list` and `data-objectstack` gained it in #2974; `plugin-charts`, `plugin-dashboard`, `plugin-report`, `components`, `mobile` and `fields` remain. (The body above says 6 because it counted a 13-package "needs a guard" list that omitted `fields`; adding `fields` and removing the two now fixed leaves 6 either way.) |
| The five shadowing forks | Fixed — #2985 (closes #2944) |
| `navigation` action type | Resolved as a declared alias, not promoted — #2994, see Correction 4 |
| `combo` chart type | Derived from `ChartSeries.type`, not promoted — see Correction 4. Uncovered two silent render bugs on the spec-shape path. |
| Everything else | Open — #2941 (Tier 1), #2942 (Tier 2), #2943 (Tier 3), #2945 (vocabularies) |

One method note for anyone repeating this: the original run read a checkout that
was behind `origin/main`, which produced a spurious "objectui resolves two spec
versions simultaneously" finding. It was a stale-lockfile artifact, not a defect.
Fetch before extracting.
