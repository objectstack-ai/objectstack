---
"@objectstack/console": minor
---

Console (objectui) refreshed to `20c6d351ad74`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 33 releasing of 33 changesets added across 24 non-merge commits; omitted: 1 commit carrying no changeset (they ship no package code).

- **minor** — The approval decision panel draws a short notice instead of nothing when it is placed anywhere other than an approval request's record page (objectui#12072). (objectui `20c6d351a`)
- **minor** — The per-group aggregation type that `useGroupedData` takes is declared and exported as `GroupAggregationConfig` instead of `AggregationConfig` (objectui#6349, batch 7). `@object-u… (objectui `c0c0a0d56`)
- **minor** — The view switcher's views are typed as `@object-ui/core`'s `ListViewVisualization`, and this package no longer re-exports that union as `ViewType` (objectui#6349, batch 7). `@obje… (objectui `c0c0a0d56`)
- **minor** — The console sidebar no longer lets a user drag the app's menu into a private order; the Pinned section is now the one place a user orders entries (objectui#12059). Arranging an ap… (objectui `8a55f0ccd`)
- **minor** — feat(types)!: `UnifiedViewConfig.chart` retires with a tombstone that names the spec's list chart block, and the three `object-chart` legacy-axis refusals stop calling those keys… (objectui `c7b30bd66`)
- **minor** — An `element:repeater` node may omit `properties.object` when its `dataSource.object` names the object. The zod arm `ElementRepeaterBlockSchema` now applies the same `object` waive… (objectui `2a48bd408`)
- **minor** — A pointer field draws the record it points at, the console reads an approval request's record page through the approvals routes, and the approval decision panel is built for the r… (objectui `a368ccb1a`)
- **minor** — feat(plugin-list)!: a chart list view binds only an ADR-0021 `dataset`; the legacy inline chart axes and their `name` / `value` floors are retired on every route (objectui#6152, r… (objectui `025341692`)
- **minor** — **BREAKING** — `createObjectStackUploadAdapter` no longer sends an upload's `path` as the storage scope (objectui#12055). (objectui `7282c6a51`)
- **minor** — **BREAKING** — The result type of `useConfirmDialog` is declared as `DesignerConfirmDialogState` instead of `ConfirmDialogState` (objectui#6349, batch 6). `@object-ui/app-shell` declares an unre… (objectui `1f1c4b526`)
- **minor** — feat(plugin-list)!: the renderers stop reading the list-view keys every door refuses: the pre-#2231 aliases, `calendar.defaultView`, and the undeclared keys a per-kind block carri… (objectui `3fd862510`)
- **minor** — **BREAKING** — `objectui validate` and `objectui check` judge a document through the strict authoring face (objectui#5250) (objectui `e4c0b5432`)
- **minor** — The runtime chat contracts have their own names, apart from `@object-ui/types`' authoring `ChatMessage` / `ChatToolInvocation` (objectui#6349, batch 5). The shape `<ChatbotEnhance… (objectui `b4e0787d5`)
- **minor** — `UndoRedoEntry`, `UndoRedoConfig` and `UndoRedoState` are retired from this package (objectui#6349, batch 5). Nothing in the repository read or wrote any of the three, `@objectsta… (objectui `b4e0787d5`)
- **minor** — A caller without Studio access who opens a Studio URL (`/studio`, a package's pillar builder, or the package-less scope) is told why (objectui#12035). The console's Studio entry g… (objectui `2571a3eb9`)
- **minor** — **BREAKING** — List views read `userActions.editInline` with the spec's default, off. A view's `inlineEdit` folds into it, and the console's inline-edit toggle no longer writes to the view (obje… (objectui `3c3115e38`)
- **minor** — The Studio landing (`/studio`) gets search (objectui#11863). It mounts the command palette, so its header shows the "Search ⌘K" trigger and `Ctrl+K` / `⌘K` opens the palette. Unti… (objectui `5275d1f37`)
- **minor** — **BREAKING** — The metadata-admin widget registry's labelling vocabulary (`WidgetLabelling`) and the dashboard widget inspector's `labelling` prop are typed against `@object-ui/core`'s `Registry… (objectui `d32869883`)
- **minor** — `ActionContext`, `ActionResult`, `UndoableOperation` and `ComponentMeta` are re-exported from `@object-ui/types` instead of declared a second time here (objectui#6349, batch 4), s… (objectui `d32869883`)
- **minor** — **BREAKING** — `FIELD_WIDGET_LABELLING` is typed against `@object-ui/core`'s `RegistryComponentMeta['labelling']` instead of `ComponentMeta['labelling']` (objectui#6349, batch 4). `@object-ui/co… (objectui `d32869883`)
- **minor** — `ActionContext` and `ActionResult` each have one declaration again, here, and `UndoableOperation` is published from this package (objectui#6349, batch 4). `@object-ui/core` used t… (objectui `d32869883`)
- **patch** — The board implementation types its `conditionalFormatting` rules as `@object-ui/types`' `KanbanConditionalFormattingRule` by that name, instead of through a module-local alias nam… (objectui `c0c0a0d56`)
- **patch** — A record's History tab and activity feed name the user behind an activity row that carries `actor_id` and no `actor_name` (objectui#12067). On `@objectstack/*` 17.7.0 the audit wr… (objectui `e391f8768`)
- **patch** — A gallery view handed to `ObjectView` now draws with the `coverFit`, `cardSize` and `visibleFields` its `gallery` block declares (objectui#12053). (objectui `acc432806`)
- **patch** — `ObjectChart` decides its missing-category-axis refusal before it fetches, so a chart that refuses reads nothing (objectui#12061). (objectui `d03b0227c`)
- **patch** — The page designer writes a repeater's query into its node-level `dataSource` binding, as it already does for `element:number` (objectui#12056, the repeater half of objectui#11880). (objectui `2a48bd408`)
- **patch** — The flow designer's structural-check finding type is declared as `FlowSimDiagnostic` instead of `Diagnostic` (objectui#6349, batch 6), because `@object-ui/sdui-parser` publishes `… (objectui `1f1c4b526`)
- **patch** — The `objectui doctor` check-result types are declared as `DoctorDiagnostic` and `DoctorDiagnosticLevel` instead of `Diagnostic` and `DiagnosticLevel` (objectui#6349, batch 6), bec… (objectui `1f1c4b526`)
- **patch** — Doc comments now name the runtime message type `ChatbotEnhancedMessage`, its name since objectui#6349 batch 5, instead of `ChatbotEnhanced.ChatMessage` (objectui#6349, batch 6). (objectui `1f1c4b526`)
- **patch** — Comments and test names only (objectui#5250). The `@object-ui/types` docblocks that called `safeValidateSchema`, the tolerant face, what `objectui validate` or `objectui check` ru… (objectui `55e90fd38`)
- **patch** — The record Attachments panel offers Upload and delete only to a caller whose `sys_attachment` grant allows them (objectui#12047). (objectui `9b6c19ef6`)
- **patch** — A console click on a declared `type: 'flow'` action now starts its flow through the action endpoint, `POST /api/v1/actions/:object/:action`, so the server-side gates that action d… (objectui `e97a0e2d1`)
- **patch** — Approval requests can now be read by the standard list and record views, and `ApiDataSource.findOne` now rejects a refused or failed read instead of reporting the record as missin… (objectui `d99b731f0`)

⚠️ 6 of these carry a breaking change: 6 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 1 commit in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared it, so it appears in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ docs(agents): an authored `events` bag is refused by `objectui validate` once PR objectui#11069 lands (objectui#5250) (#12050) (objectui `972e56659`)

<!-- adr-0087: TODO — the pin bump cannot answer this; a human must (objectstack#6494) -->

objectui range: `47b1f0bb7174...20c6d351ad74`
