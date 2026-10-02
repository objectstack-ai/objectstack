---
"@objectstack/console": minor
---

Console (objectui) refreshed to `89cad75d5570`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 74 releasing of 88 changesets added across 64 non-merge commits; omitted: 14 release-nothing changesets, 6 commits carrying no changeset (they ship no package code).

- **minor** — **BREAKING** — chore(console)!: drop the lazy `tree` registration stub (objectui#10859, batch 8) (objectui `990a2d616`)
- **minor** — **BREAKING** — chore(cli)!: the generated known-types list drops the thirty node type keys objectui#10859 batch 8 retired (objectui `990a2d616`)
- **minor** — **BREAKING** — chore(core)!: the record-source `data` arm table drops `tree` and `view:tree` (objectui#10859, batch 8) (objectui `990a2d616`)
- **minor** — **BREAKING** — refactor(fields)!: the 28 field widgets that still registered a bare node-type fallback register `field:<type>` only (objectui#10859, batch 8) (objectui `990a2d616`)
- **minor** — **BREAKING** — refactor(plugin-tree)!: retire the bare `tree` node type key; `object-tree` is the one spelling (objectui#10859, batch 8) (objectui `990a2d616`)
- **minor** — **BREAKING** — refactor(plugin-view)!: retire the bare `view` node type key; `object-view` is the one spelling (objectui#10859, batch 8) (objectui `990a2d616`)
- **minor** — Three more reader sites stop riding `BaseSchema`'s index signature (objectui#11355 round 2, part of the preparation for objectui#8347's removal of that signature). None changes ru… (objectui `31987bd50`)
- **minor** — **BREAKING** — feat(types): the six `@object-ui/plugin-designer` node types validate; `ProcessDesignerSchema.variables` and `ReportDesignerSchema.parameters` leave the TypeScript face (objectui#… (objectui `063832222`)
- **minor** — **BREAKING** — BREAKING (`@object-ui/core`): `mergeAuthoredPresentation` and `axisPresentation` are no longer exported (objectui#11372). (objectui `f9c8c4e45`)
- **minor** — **BREAKING** — A `page` node refuses `maxWidth` and `padding` by name, and the layout guide teaches the controls that work: `pageType` for the page's width, a `container` for a narrower column o… (objectui `a1a44d621`)
- **minor** — `object-timeline` and `view:timeline` publish the ten `@objectstack/spec` 17.5.0 row keys their renderer honours, and `objectName` is no longer required (objectui#11168 slice 5, u… (objectui `6cd5ae3ea`)
- **minor** — The console build now writes `dist/sdui.manifest.json`, the SDUI component manifest of the Console it built (objectui#11403). (objectui `f88a900e7`)
- **minor** — A bind-only `list` is accepted: `ListSchema.items` is optional on both faces, and the zod face requires at least one of `bind` / `items` (objectui#11405). (objectui `9547063da`)
- **minor** — **BREAKING** — feat(core): the `flex()` builder emits its props in the `properties` bag (objectui#11276) (objectui `138ad4554`)
- **minor** — **BREAKING** — feat(types): an authored `flex` takes its props in the spec's `properties` bag; the flat spelling is refused by name (objectui#11276) (objectui `138ad4554`)
- **minor** — **BREAKING** — feat(types): an authored `object-grid` takes its props in the spec's `properties` bag; the flat spelling is refused by name (objectui#11276) (objectui `6aa029b63`)
- **minor** — **BREAKING** — objectui's app document refuses `mobileNavMode` by name, the answer the platform already gives (objectui#11363). (objectui `e100589f3`)
- **minor** — fix: the widget width / height editors write a whole four-number `layout` (objectui#11388) (objectui `6e9c8d27e`)
- **minor** — **BREAKING** — A gate that is declared but cannot be evaluated is a fault, not "no gate" (objectui#11358) (objectui `063119f2b`)
- **minor** — A public block's prop written directly on the node, instead of inside its `properties` bag, is refused by name on both faces, with a message naming `properties.KEY` (objectui#1087… (objectui `b5696d344`)
- **minor** — Five label positions that `@objectstack/spec` types as `I18nLabel` now accept the per-locale map in `@object-ui/types` too, where they were typed `string` (objectui#10993, batch 4… (objectui `b4075c088`)
- **minor** — feat(plugin-gantt): `object-gantt` publishes the eleven `@objectstack/spec` row keys its renderer honours (objectui#11168 slice 4) (objectui `8673402a3`)
- **minor** — The strict authoring face accepts the `layout` that the editable dashboard grid's Save Layout writes onto a `metric-card` in a dashboard's widget slot (objectui#11070, round 11).… (objectui `0a78a20c8`)
- **minor** — The spec's page blocks, the `element:text_input` / `element:record_picker` rows and a stored page document under its page kind have a TypeScript authoring type, and `SchemaRendere… (objectui `304f61137`)
- **minor** — Small reader sites stop riding `BaseSchema`'s index signature (objectui#11355, part of the preparation for objectui#8347's removal of that signature). Each key was measured on its… (objectui `3c3ce15a7`)
- **minor** — Declare `pageSize` on `ObjectDataTableSchema`, on both faces (objectui#11348). (objectui `6c3da53ae`)
- **minor** — A form field of `type: 'grid'` declares the grid widget's field-level keys (objectui#11070, round 10). (objectui `edfcf5a5e`)
- **minor** — The grid field's `sort_field` is declared, and a master-detail detail's sort field is derived only (objectui#11070, round 9). (objectui `0a3e5409f`)
- **minor** — `formatMetadataError` and `formatMetadataIssue` are exported from `@object-ui/data-objectstack`: the one reader of a failed metadata save (objectui#11302). (objectui `d89329033`)
- **minor** — `object-map` publishes the three keys its `@objectstack/spec` 17.5.0 row declares and its registration left out: `mapStyle`, `navigation` and `enableClustering` (objectui#11168 sl… (objectui `20d23befe`)
- **minor** — `object-tree` publishes the keys its `@objectstack/spec` 17.5.0 row declares and its renderer honours (objectui#11168 slice 3, objectui#11111 decision 3 = B). Each key was measure… (objectui `20d23befe`)
- **minor** — `ObjectTreeSchema` mirrors the `object-tree` row of `@objectstack/spec` 17.5.0 (objectui#11168 slice 3). The change applies to both faces, TypeScript and zod. (objectui `20d23befe`)
- **minor** — `UIActionSchema.size` takes the `action:button` row's vocabulary by reference (objectui#11168 slice 3). Before this, the type was `'sm' | 'md' | 'lg'`. That made `size: 'default'`… (objectui `20d23befe`)
- **minor** — Eight renderers stop riding `BaseSchema`'s index signature for node keys their types did not declare (objectui#11347, the `@object-ui/components` preparation for objectui#8347's r… (objectui `c82ff391f`)
- **minor** — **BREAKING (rendering):** a dataset-bound dashboard widget no longer reads `chartConfig.series`, `chartConfig.xAxis` or `chartConfig.yAxis` (objectui#11315). (objectui `1a88ce22f`)
- **minor** — **BREAKING (authoring, TypeScript only):** on a dashboard widget, `chartConfig.type`, `chartConfig.xAxis`, `chartConfig.yAxis` and `chartConfig.series` are now compile errors, the… (objectui `1a88ce22f`)
- **minor** — The grid field reads each field-level key under the one spelling `GridFieldMetadata` declares (objectui#11070, round 8). (objectui `55a12a8e1`)
- **minor** — A region-tagged language code reaches the built-in catalogue of its base language (objectui#11326) (objectui `d0fba91aa`)
- **minor** — The grid field's `columns` is `@objectstack/spec`'s inline grid column list, by reference, and `object-chart` declares the per-element `dataSource` binding like the other gate-wra… (objectui `75dcc81c3`)
- **minor** — A custom page publishes the console's record navigator to the blocks placed on it (objectui#11293). (objectui `2124d0411`)
- **minor** — A standalone `object-calendar` honours `navigation: { mode: 'page' }`, and a `navigation` block written without `mode`, by opening the record page (objectui#11293). (objectui `2124d0411`)
- **minor** — A standalone `object-kanban` honours `navigation: { mode: 'page' }`, and a `navigation` block written without `mode`, by opening the record page (objectui#11293). (objectui `2124d0411`)
- **minor** — `useNavigationOverlay` hands an authored `page` click with no `onNavigate` to the record navigator the host publishes (objectui#11293). (objectui `2124d0411`)
- **patch** — fix(fields): a read-only number field shows its value the way its table cell does (objectui#11431) (objectui `52c95a166`)
- **patch** — fix(i18n): every count plural family carries every plural form its language uses (objectui#11432) (objectui `55d18c649`)
- **patch** — fix(plugin-dashboard): a dimensioned `pie` / `donut` / `funnel` / `treemap` / `sankey` widget with several measures now says which measures it drops (objectui#11417) (objectui `175df47ef`)
- **patch** — `AiUsageIndicator` renders the reset line for the rolling 5-hour pace window, `resetKind: 'fiveHour'` (objectui#11415, consumer of cloud#2059 / cloud#2574). (objectui `c681b9ff2`)
- **patch** — The `object-calendar` / `calendar` `navigation` input description said `openNewTab: true` "outranks the mode". That does not hold for `none`: `useNavigationOverlay` checks `mode =… (objectui `6cd5ae3ea`)
- **patch** — The `object-kanban` `navigation` input description said `openNewTab: true` "outranks the mode". That does not hold for `none`: `useNavigationOverlay` checks `mode === 'none'` befo… (objectui `6cd5ae3ea`)
- **patch** — fix(plugin-dashboard): a dimensionless `column` / `horizontal-bar` draws every measure; the dropped-measure warning speaks whenever the widget's own branch leaves a declared measu… (objectui `db0e9d3a0`)
- **patch** — fix(plugin-designer): the dashboard editor's type picker no longer turns a multi-measure widget into a type the widget door refuses (objectui#8894) (objectui `db0e9d3a0`)
- **patch** — A host feed slot written on a `record:activity` or `record:history` node is refused by name: `items` and `entries`, and the `loading` flag paired with each (objectui#11321). (objectui `e0a9c6760`)
- **patch** — fix(plugin-gantt): a number row in the gantt tooltip shows the field's declared decimals, and none when it declares none (objectui `c1763e50c`)
- **patch** — fix(fields): the number cell ignores a malformed `scale` instead of flooring it or crashing (objectui `c1763e50c`)
- **patch** — The dataset designer no longer writes `field: ''` for a row whose Field box is blank (objectui#11402). (objectui `0858267e4`)
- **patch** — fix(layout): the mobile tab bar draws its tabs in the sidebar's order, and shows an entry's badge (objectui `7728c67c8`)
- **patch** — docs(plugin-grid): authored `object-grid` examples write their props in the `properties` bag (objectui#11276) (objectui `6aa029b63`)
- **patch** — fix(app-shell): a refused metadata save shows the server's message and field path on every transport (objectui `d59f11c0d`)
- **patch** — fix(layout): the mobile tab bar draws only the entries its sidebar draws (objectui `5ad9f5dc8`)
- **patch** — fix(app-shell): a published html page that gains a plugin component can be published again from the Studio (objectui `3ae919307`)
- **patch** — fix(app-shell): a datasource created as External or Validate only, or switched to either from Managed, now saves without a credential (objectui#11368) (objectui `8001068b9`)
- **patch** — The Studio surfaces import `formatMetadataError` from `@object-ui/data-objectstack`, where the reader now lives (objectui#11302). What they show is unchanged; the publish-failure… (objectui `d89329033`)
- **patch** — `MetadataFieldsPage` shows the per-field prescription when the spec refuses a save, not only the refusal headline (objectui#11302). (objectui `d89329033`)
- **patch** — `object-map` reads `mapStyle` before `map.style`, as `@objectstack/spec`'s `object-map` row says in `mapStyle`'s own description ("Read before `map.style`"). This is objectui#1116… (objectui `20d23befe`)
- **patch** — The page-block inspector labelled the `object-form` `columns` field "Columns (grid layout)" in English and 「列数（网格布局）」 in Chinese. That pointed at the `grid` form layout, which obj… (objectui `20d23befe`)
- **patch** — The `object-timeline` / `view:timeline` `navigation` input description had three wording errors, and all three are corrected (objectui#11168 slice 3, from the contract record on o… (objectui `20d23befe`)
- **patch** — The README's "View tabs" section listed `form.layout` as `vertical | horizontal | inline | grid`. It now lists `vertical | horizontal`, the two values the form layout keeps after… (objectui `20d23befe`)
- **patch** — fix(plugin-gantt): a percent row in the gantt tooltip shows the field's declared decimals (objectui `b149617e6`)
- **patch** — fix(plugin-dashboard): the `object-metric` tile shows a percent or number aggregate at the field's declared width (objectui `b149617e6`)
- **patch** — fix(plugin-grid): the mobile card's percent value shows the field's declared decimals (objectui `b149617e6`)
- **patch** — fix(layout): the mobile tab bar opens the same page as the sidebar (objectui#11211) (objectui `c18a0754b`)
- **patch** — A bulk action whose `visible` is blank now shows on the grid's selection bar and runs over every selected record, as it already does on the row menu and the toolbars of the same g… (objectui `5638529e6`)
- **patch** — Docblock only: `BulkActionDef.visible` now says what the grid's selection bar does with an `ast`-only envelope (objectui#11322). (objectui `5638529e6`)
- **patch** — Docblock only, no behavior change: `partitionRowsByPredicate` now names its callers and says who decides "is a gate declared?" (objectui#11322). (objectui `5638529e6`)

⚠️ 16 of these carry a breaking change: 16 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 6 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ docs(fields): the number page and catalog teach `scale` for the decimal width (objectui#11413) (#11429) (objectui `01f99e31e`)
- _(no changeset)_ docs(fields): the percent page and catalog teach `scale` for the decimal width (objectui#11255) (#11411) (objectui `549aaa831`)
- _(no changeset)_ docs(skills): the page-builder guide authors object-grid and object-gantt in the properties bag (objectui#10859; objectui#11276 rider) (#11404) (objectui `64c173d70`)
- _(no changeset)_ docs(skills): the mobile guide teaches mobileNavMode where it is read, not on the app schema (objectui#11363) (#11397) (objectui `abca9867e`)
- _(no changeset)_ fix(site): move next 16.3.3 to 16.3.6 for GHSA-vcvr-r3jv-pc5j (critical) (#11361) (objectui `ad58cc159`)
- _(no changeset)_ docs(guide): slotted-pages header example keeps only PageHeaderProps keys; pin it (objectui#11165) (#11339) (objectui `743181a48`)

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, `sdui.manifest.json` + `scripts/sdui-manifest.record.json`, the re-recorded
     `packages/sdui-parser/objectui-lockstep.json` and the re-measured pin citations in
     `packages/spec/src`, which carry their own `@objectstack/spec` patch changeset. It adds,
     removes or renames no ObjectStack-authorable key: no Zod schema, no spec declaration and
     no stored `sys_metadata` shape moves in it, so `objectstack migrate meta` has nothing here
     to rewrite, and this body carries no FROM/TO prescription of its own.
     The 16 declared-breaking entries listed above are objectui's OWN package surfaces, each
     already carrying its upstream record: `990a2d616` (six entries: objectui retires its bare
     `tree` / `view` node-type keys, the lazy `tree` stub, the bare field-widget fallbacks and
     the matching known-types and record-source rows), `063832222` (objectui's
     `@object-ui/plugin-designer` TypeScript face), `f9c8c4e45` (two `@object-ui/core` exports),
     `063119f2b` (objectui's gate evaluator), `138ad4554` and `6aa029b63` (objectui's validator
     for `flex` and `object-grid` refuses the flat spelling and reads the `properties` bag, the
     shape `@objectstack/spec`'s `ComponentPropsMap` rows already declare), `a1a44d621`
     (objectui's `page` node refuses `maxWidth` / `padding`, which no ObjectStack page shape
     declares), `e100589f3` (objectui's app document refuses `mobileNavMode`, which the
     ObjectStack app shape already does not declare), and `1a88ce22f` (two entries: a dashboard
     widget's `chartConfig.type` / `xAxis` / `yAxis` / `series`, which mirror ObjectStack keys
     already retired and tombstoned on this side in `ui/dashboard.zod.ts`). Where an entry
     mirrors an ObjectStack key, the ledger entry belongs to the `packages/spec` PR that lands
     the retirement, never to the pin bump.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not a
     per-entry re-measurement of the 16 upstream declared-breaking entries.
-->

objectui range: `31971ff1e28f...89cad75d5570`
