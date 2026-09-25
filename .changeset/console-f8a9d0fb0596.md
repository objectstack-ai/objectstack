---
"@objectstack/console": minor
---

Console (objectui) refreshed to `f8a9d0fb0596`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 86 releasing of 91 changesets added across 92 non-merge commits; omitted: 5 release-nothing changesets, 3 commits carrying no changeset (they ship no package code).

- **minor** — `aggregate()` reads the analytics answer in ONE spelling: `rows` on the `AnalyticsResult` that `client.analytics.query` resolves to (objectui#7028). The `{ success, data: { rows }… (objectui `512bc9049`)
- **minor** — **BREAKING** — Retire `carousel` from `AIRecommendationsSchema.layout` and from the `ai-recommendations` designer enum (objectui#10330, ADR-0049 enforce-or-remove). (objectui `f98eddf63`)
- **minor** — **BREAKING** — feat(types)!: `DetailViewFieldSchema.options` is the spec's authoring `SelectOptionSchema` (objectui#10296) (objectui `6096f20b3`)
- **minor** — Honour `filter` and the platform row ceiling on a tree's inline (`provider: 'value'`) data (objectui#9136) — the fourth surface of the objectui#8769 repair, after objectui#9061 po… (objectui `9c08dc6b2`)
- **minor** — feat(core): export `declaredNameField`, the one spelling of the ADR-0079 declared name pointer (objectui#9436) (objectui `ba0b61a60`)
- **minor** — fix(plugin-detail): `DetailView`'s header and the `record:details` H1 dedupe rank the declared `nameField` above `titleFormat`, the ADR-0079 order (objectui `ba0b61a60`)
- **minor** — fix(components): the record page H1 ranks the declared `nameField` above `titleFormat`, the ADR-0079 order (objectui `ba0b61a60`)
- **minor** — The grid summary footer and the dashboard metric tile take a currency amount's decimal places from the currency, never from `scale`, and the field designer no longer offers `Scale… (objectui `0651e7ab4`)
- **minor** — fix(react): a data object in a node's `properties` / `props` bag reaches the renderer whole, even when it carries a `source` field (objectui `2b5f509bf`)
- **minor** — `CalendarSchema.defaultValue` / `.value` cross the JSON/TS boundary once (objectui#10293, objectui#7759 ruling D1-(iii)). (objectui `8c10f4f71`)
- **minor** — fix(core): a dashboard `dateRange` that omits `defaultRange` now takes the spec's declared default preset (objectui#10339). (objectui `86982ace0`)
- **minor** — **BREAKING** — feat(types): `TooltipSchema.content` is text only, on both faces (objectui#10295) (objectui `90dac98fa`)
- **minor** — fix(auth,app-shell,console): a browser that changes hands no longer keeps the previous account's UI language (objectui `b57107d46`)
- **minor** — **BREAKING** — `UIEventHandler` and `EventableSchema` are RETIRED from `@object-ui/types`, and `APISchema` loses its `EventableSchema` arm (objectui#6497, ADR-0049 enforce-or-remo… (objectui `cb55718a9`)
- **minor** — **BREAKING** — `record:related_list`'s top-level `filter` is declared as the protocol's rule array on the authoring face, not as `any` (objectui#10199). (objectui `e3ea4f97b`)
- **minor** — On `tree` and `chart` list views, the toolbar's Filter control and the `UserFilters` chips now narrow the view, and on a `gantt` list view the toolbar's Search box now narrows the… (objectui `af243c1fd`)
- **minor** — Refuse the four remaining function-valued mirror keys by name (objectui#7759 group E, the objectui#6124 shape). (objectui `d05fe17f6`)
- **minor** — `ObjectView` opens a Cmd/Ctrl/middle-clicked row in a new browser tab (objectui#9806). (objectui `687353f4e`)
- **minor** — `CurrencyField` takes its fraction digits from the currency, never from the field-level `precision` (objectui#10276). (objectui `31938f01d`)
- **minor** — `object-form`: one rule for section divider rows on the default, modal and drawer layouts, and there a section's own settings apply whether or not it has a heading (objectui#9849… (objectui `8813335bd`)
- **minor** — `CommandItem` and `CommandGroup` are now named exports of `@object-ui/types` itself, not only of `@object-ui/types/form` (objectui#9526). They are the element types of `CommandSch… (objectui `3be720ef8`)
- **minor** — **BREAKING** — BREAKING (`@object-ui/types`, `@object-ui/plugin-chatbot`): the authoring `ChatToolInvocation.state` union sheds the AI SDK's three runtime-only approval states — `approval-reques… (objectui `b46c58f34`)
- **minor** — **BREAKING** — `RecordRelatedListRenderer`'s props type refuses a misspelled key again (objectui#9963). (objectui `905913c0e`)
- **minor** — Fix: a `dependsOn` field is no longer permanently gated when it is edited inline on a record's detail page. (objectui `a33803796`)
- **minor** — fix(core): the shared date path refuses a calendar day that does not exist, with the marker it already renders for an unparsable value (objectui `ad694ac3d`)
- **minor** — fix(plugin-kanban): a kanban lane matches records by its `id` only, never by its `title` (objectui `7a564e004`)
- **minor** — feat(plugin-detail): row caps on `record:activity`, `record:history`, `record:chatter` and `record:discussion` admit only a positive integer number, and a refused one warns (objectui `879ecac78`)
- **minor** — feat(types): `slider` and `tooltip` single-or-list keys follow their read sites (objectui#10280, objectui#7759 group B) (objectui `f3f4e4c9a`)
- **minor** — **BREAKING** — `NamedListView` (one entry of `ObjectViewSchema.listViews`) retires sixteen members on its TypeScript authoring face (objectui#7924). Each is now a `?: never` tombs… (objectui `aa083cd69`)
- **minor** — feat(types): `AppComponentSchema`, `DashboardComponentSchema` and `PageNodeSchema` take the spec by reference, like their zod mirrors (objectui `1bbaa163a`)
- **minor** — **BREAKING: the unimplemented async export-job path is removed from `@object-ui/types` and `@object-ui/components`** (objectui `8b1f06619`)
- **minor** — fix(sdui-parser,components,layout,types): containment is the declared `children` slot, not `isContainer` (objectui#9910) (objectui `5ea623eab`)
- **minor** — feat(react): an action's `params` values are templates, evaluated where `properties` are (objectui `95bf1287a`)
- **minor** — An action param that declares the spec's `carryOver` is shown read-only and submitted verbatim (objectui#6246) (objectui `06b82b8c3`)
- **minor** — A date-only value now renders the calendar day it names, west of UTC, at four more places (objectui#10183). (objectui `4ab4f1ba2`)
- **minor** — `ObjectTreeSchema.filter` is declared on both faces, in the shape objectui#9309 settled for `ObjectGallerySchema.filter`: `QueryParams['$filter']` by indexed access on the TS inte… (objectui `d16d0e977`)
- **minor** — `object-grid`'s `rowActions` now NARROWS the row kebab's generic Edit / Delete inside the `operations` ceiling — the second half of the ruling whose first half ("`operations` is t… (objectui `185079bdf`)
- **minor** — Dates and numbers across the console and the plugins format in the session's display locale instead of the machine's (objectui#9909). (objectui `a78cd378c`)
- **patch** — fix(fields): a lookup's candidate queries expand the reference columns they display (objectui `65f1e8dc6`)
- **patch** — fix(plugin-list): a list view whose every authored column is denied by field-level security still sends a `$select` (objectui `fb7f38bdf`)
- **patch** — fix(plugin-detail): feed diagnostics name the block that carries the bad value (objectui `462bafb9e`)
- **patch** — docs(types): the `WidgetInput` divergence docblock lists the serializer's key list with `of` (objectui#10337) (objectui `a5b08c9ce`)
- **patch** — fix(console): `FormPage`'s required `*` no longer lands in the control's accessible name (objectui `069ce12b4`)
- **patch** — fix(charts): a cartesian chart that declares no series at all now says so instead of drawing an empty frame (objectui#4695) (objectui `f82f85756`)
- **patch** — fix(plugin-list): gallery cards now pass a field's declared `scale` to the shared cell renderer, so a number or percent field declaring `scale` renders padded (`25.00%`) exactly a… (objectui `a883ec21a`)
- **patch** — Gantt: a row that is not an object is now refused instead of drawn as an empty, unlabelled row (objectui#7364). `items: [0]`, `items: ['x']`, `items: [true]` and `items: [[]]` use… (objectui `0b6b295a1`)
- **patch** — fix(plugin-form,plugin-list,plugin-view,react): read `SchemaRendererContext` as declared, not through a cast to `any` (objectui#7209) (objectui `3ed3eec08`)
- **patch** — fix(i18n): a translation bundle with no field label is recognised as a spec payload (objectui#10235) (objectui `dc666f70d`)
- **patch** — An `action:icon` now runs an action it receives with `autoTrigger` set, the same way `action:button` and `action:menu` do (objectui#10274). (objectui `cff4b7754`)
- **patch** — Two display-locale faces now follow the session's display locale (objectui#10232). (objectui `bb5d4eea7`)
- **patch** — fix(app-shell): the metadata form's machine-name chip is judged on the field's untranslated source label, so it shows alike in every locale (objectui#8231) (objectui `78b572f60`)
- **patch** — fix(fields): a failed image upload is reported in `ImageField`, not swallowed (objectui `1f8ef0a89`)
- **patch** — fix(plugin-charts): the legend swatch carries its series colour as a custom property (objectui `a9f34df28`)
- **patch** — Saving a view's config no longer turns the view read-only (objectui#10210). (objectui `baf98cde0`)
- **patch** — fix(plugin-view): a read-only view's menus no longer open empty or on a leading separator (objectui `b07de29d1`)
- **patch** — The two declared display-locale contracts now each name the caller they govern, and each points at the other (objectui#10098). This is documentation only: no module's behaviour mo… (objectui `8cedb0dba`)
- **patch** — **The stray-`groupBy` kanban refusal no longer tells an author their view "never came through the validated path".** (objectui `89bb77a11`)
- **patch** — The package dialog judges a version with the installed `@objectstack/spec`'s own `ManifestSchema` version field instead of a hand-copied regex, so it accepts exactly what the spec… (objectui `c84221daa`)
- **patch** — fix(app-shell): the Studio dataset-filter inspector stores a `between` range as the spec's `$between`, with both bounds required (objectui#10062) (objectui `856bf0f74`)
- **patch** — A flow launched from an action that ends with `outcome: 'refused'` without ever pausing at a screen now shows its refusal instead of reporting success (objectui#9973). (objectui `7616d8935`)
- **patch** — fix(plugin-dashboard): a field's `format` is read as a date pattern only on a `date` / `datetime` field (objectui `e2bd3e400`)
- **patch** — fix(plugin-designer): the Navigation Designer has an entry for the spec's `doc` navigation item type (objectui `1dbb9933c`)
- **patch** — A master-detail form's child grid no longer offers a cell the CALLER may read but not edit (objectui#10163). (objectui `6099dd870`)
- **patch** — **Behaviour change:** an action whose own declared `visible` gate hides it is no longer run by `autoTrigger`, and the refusal is reported instead of swallowed (objectui#4191). (objectui `978507b9a`)
- **patch** — fix(plugin-detail): a related list's row fetch drops a column the principal cannot read once the permission answer has loaded (objectui `5f44cc6f4`)
- **patch** — The published `ViewNavigationConfig` docblock no longer teaches the retired `navigation.view` key (objectui#9938). Its example of `mode` being optional on the authoring side used… (objectui `32bf2d6f6`)
- **patch** — feat(types): `SliderFieldMetadata` declares `step` (objectui `5f00ff491`)
- **patch** — `object-grid`'s `rowActions` now carries a describe, and the `ObjectGridSchema.operations` / `rowActions` docblocks state how the two keys combine: `operations` is the CEILING ove… (objectui `087981282`)
- **patch** — fix(plugin-form): `DrawerForm` no longer paints an editable form before the record it edits has loaded (objectui `88a4ef616`)
- **patch** — fix(plugin-kanban): `object-kanban` honours the binding's `dataSource.sort` (objectui `c9e073ac8`)
- **patch** — fix(plugin-detail,plugin-grid): the record-grained write verdict is forgotten when its record changes, and the row kebab's memo is per principal (objectui#10184). (objectui `fa5fbd9dc`)
- **patch** — fix(plugin-form): `customFields` merges on the drawer and modal arms too (objectui `142fdfd87`)
- **patch** — On a `gantt` list view, the toolbar's Filter control and the `UserFilters` chips now narrow the chart (objectui#10037). (objectui `0427036f5`)
- **patch** — fix(app-shell): the object page no longer re-issues the identical list query on re-renders that change nothing (objectui `5b6d177b2`)
- **patch** — `ui:menubar` now draws an item's authored `icon`, and walks submenus to any depth (objectui#6326). (objectui `d7de5348a`)
- **patch** — The `dateField` alias refusal that objectui#8355 adds to a calendar binding quotes only the first clause of the calendar refusal screen, "Calendar configuration required": the cla… (objectui `6f96fca95`)
- **patch** — `useRecordSearch` no longer keys its search effect on the identity of the caller-supplied `getDisplayName` option (objectui#10044). (objectui `0aacecc08`)
- **patch** — fix(fields): a declared `scale` above 100 no longer crashes the number cell or a grid's computed column (#10071) (objectui `0361d6bd4`)
- **patch** — `record:activity`'s landmark is named after the heading it shows, not "Discussion" (objectui#9998). (objectui `6358a2d59`)
- **patch** — `object-form`: a drawer section that declares `collapsed: true` can be opened again. The drawer now resolves `collapsed` / `collapsible` the way the default layout does (objectui#… (objectui `58d65c50d`)
- **patch** — fix(app-shell): the screen-flow runner draws the app's translated flow copy (objectui#5920) (objectui `5d895c13c`)
- **patch** — A `record:line_items` grid no longer offers a cell the CALLER may read but not edit (objectui#10163). (objectui `b809375ac`)
- **patch** — fix(mobile): `usePullToRefresh` arms on a host that mounts after the first render, and one pull has one owner (objectui#10105) (objectui `6ce001a35`)
- **patch** — A wizard no longer writes a record without a file whose upload was still running when the user pressed Next (objectui#10180). (objectui `a04b06db5`)
- **patch** — `ElementDataSourceGate` now reports a saved view's refused row cap on the renderer path (objectui#10015). (objectui `7b10befe6`)
- **patch** — Full-page search results now read correctly in Russian and Arabic at every count (objectui#10024). (objectui `a507334d2`)

⚠️ 9 of these carry a breaking change: 9 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 3 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ docs(changeset): the 9242 changeset says the stray-groupBy refusal covers the list-view route only (#10364) (objectui `f8a9d0fb0`)
- _(no changeset)_ docs(changeset): the manifest serializer forwards seven keys per input, not six (#10318) (objectui `c7ab34836`)
- _(no changeset)_ fix(ci): spec-main shape gate re-points the injected spec's declared dependencies (#10238) (objectui `f4f1f4552`)

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it (this console
     changeset, `sdui.manifest.json` + `scripts/sdui-manifest.record.json`, and the
     re-recorded and re-measured pin read-points the lockstep and pin-citation gates
     name). It adds, removes or renames no ObjectStack-authorable key: no Zod schema, no
     spec declaration and no stored `sys_metadata` shape moves in it, so
     `objectstack migrate meta` has nothing here to rewrite, and this body carries no
     FROM/TO prescription of its own.
     The 9 declared-breaking entries listed above are objectui's OWN package surfaces
     (`@object-ui/types`, `@object-ui/components`, `@object-ui/plugin-chatbot` and the
     designer enums), each already carrying its upstream record. Where one of them
     mirrors an ObjectStack-authorable key, the ledger entry belongs to the
     `packages/spec` PR that lands the mirror, never to the pin bump, whose diff
     contains no such key.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not
     a per-entry re-measurement of the 9 upstream declared-breaking entries.
-->

objectui range: `62597c588072...f8a9d0fb0596`
