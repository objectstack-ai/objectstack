---
"@objectstack/console": minor
---

Console (objectui) refreshed to `53ded82bf7a4`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 23 releasing of 28 changesets added across 34 non-merge commits; omitted: 5 release-nothing changesets, 7 commits carrying no changeset (they ship no package code).

- **minor** — Array filters on analytics aggregates were posted un-lowered and refused by the runtime with 400; they are now lowered to the canonical `FilterCondition` before the wire. (objectui `53ded82bf`)
- **minor** — Retire `ChatbotSchema.displayMode` — and its copy on `ChatbotFloatingSchema` — as an ADR-0049 retirement tombstone, and remove the `chatbot-floating` registration's "Display Mode"… (objectui `3e377c931`)
- **minor** — `ChartDataSeriesSchema` (and its TS twin `ChartDataSeries`) now REFUSES `chartType` on a chart series BY NAME and points at `type` — the renderer-internal spelling the non-strict… (objectui `caf477fa8`)
- **minor** — `DataScopeManager` now **denies** a row when a row-level scope rule carries an operator its evaluator does not implement. It used to **admit** the row. (objectui `83c77dc30`)
- **minor** — One home for the `datetime` display convention (objectui#7443). (objectui `81a2eb1fb`)
- **minor** — **`BaseSchema.visible` / `.hidden` / `.disabled` now declare the CEL envelope object the renderer already evaluates, as one named wire type** (objectui#7530, maintainer ruling 202… (objectui `c354ce5db`)
- **minor** — **Breaking for authored metadata:** `MarkdownSchema.sanitize` and `MarkdownSchema.components` are RETIRED (objectui#6972, ADR-0049 enforce-or-remove). A `markdown` node that autho… (objectui `446d93d4e`)
- **minor** — One named, importable authoring-face type per `plugin-chatbot` registration: `ChatbotEnhancedSchema` and `ChatbotFloatingSchema` join `ChatbotSchema` (objectui#7655, under the obj… (objectui `4ce14f125`)
- **minor** — Six user-visible fixes across the maker surface, the assistant rail and the dataset captions. (objectui `64dae8e71`)
- **minor** — `DrillDownConfigSchema` is the zod mirror of `DrillDownConfig`, and both declarations that carry `drillDown` reference it — `ChartSchema` (`zod/data-display.zod.ts`) and `ObjectDa… (objectui `52c8cf741`)
- **minor** — `ObjectGallerySchema` and `ObjectDataTableSchema` are members of `ObjectQLComponentSchema` on both faces — the TS union in `objectql.ts` and the zod union in `zod/objectql.zod.ts`… (objectui `52c8cf741`)
- **minor** — `ChartDataSeriesSchema` (and its TS twin `ChartDataSeries`) declares the six series keys the renderer reads — `label`, `variant`, `opacity`, `dashArray`, `stack`, `yAxis` — which… (objectui `8fe8e5c16`)
- **minor** — `AlertDialogSchema` now declares the four keys the `alert-dialog` renderer actually reads (objectui#7104): `content` (the dialog body, `SchemaNode | SchemaNode[]` like every sibli… (objectui `8ad218d58`)
- **minor** — **BREAKING** — `SchemaRegistry['kanban']` stops describing a component it cannot name (objectui `bc640ec56`)
- **minor** — One authority per exported type name, batch 3 of objectui#6349: `ComboboxOption`, `NamedActionDef`, `OrgTranslate`. (objectui `6e8863093`)
- **minor** — **Removes two published exports.** Retire the `MobileResponsiveConfig` and `GestureConfig` types (objectui#7519, ADR-0049 enforce-or-remove). Both names are deleted from `@object-… (objectui `51eb51558`)
- **minor** — Retire `FloatingChatbotConfig.triggerIcon` (objectui#7654, ADR-0049 enforce-or-remove). (objectui `a3eb5d07a`)
- **minor** — One shared record-source ladder, five plugins delegate (objectui#7632). (objectui `ce2aaefe1`)
- **patch** — The published `@default` documentation on two `layout.ts` members now matches the value the renderer actually applies. `ContainerSchema.maxWidth` documented `'lg'` while `containe… (objectui `e546222b3`)
- **patch** — Declare `avatar` and `avatarFallback` on `ChatMessage`, on both faces (objectui#7295 — the residue of objectui#4424, whose `RuntimeOnlyMessageKeys` named only the three keys API m… (objectui `858cd72e3`)
- **patch** — `ClassNameStylePropsSchema` describes itself by its two keys (objectui#7578). (objectui `9587fc959`)
- **patch** — Declare `wrapperClass` on `CheckboxSchema`, on both faces (objectui#6938 — the residue of that card; its `context-menu` half landed with objectui#6939 group 1). (objectui `b74a8598d`)
- **patch** — The standalone runner renders `AppAction.items` from its declared type only, which makes `AppActionSchema.onClick`'s retirement message true again (objectui#6854, maintainer rulin… (objectui `adb2a86db`)

⚠️ 2 of these carry a breaking change: 2 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 7 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ fix(hooks): read the edited path from the key the routed tool carries (#7686) (objectui `565f2b6aa`)
- _(no changeset)_ fix(schema-catalog): drop the undeclared `variant` key from the dropdown-menu Delete item (#7717) (objectui `f96a781c8`)
- _(no changeset)_ fix(hooks): an escaped quote inside a double-quoted word does not close it (#7695) (objectui `6eebc54b6`)
- _(no changeset)_ docs(skills): correct six wrong shipped-API facts in the published objectui guides (#7677) (objectui `ab771d2dd`)
- _(no changeset)_ docs(skills): record ComponentInput's five ADR-0049 tombstones in the plugin guide (objectui#7636) (#7647) (objectui `09163884f`)
- _(no changeset)_ docs(agents): state the changeset gate's full population, not `src/` alone (#7640) (objectui `0b1e39d4a`)
- _(no changeset)_ docs(charts): rewrite the inline-series chart examples into the model the renderer implements (#7679) (objectui `d3f5256ce`)

<!-- adr-0087: TODO — the pin bump cannot answer this; a human must (objectstack#6494) -->

objectui range: `a472b07167a3...53ded82bf7a4`
