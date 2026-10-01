---
"@objectstack/console": minor
---

Console (objectui) refreshed to `31971ff1e28f`. This pin carries objectui#11353 (objectui `31971ff1e`): the console bundles one zod instance again, so the Studio's spec-derived forms render their fields — the New Package dialog creates a package and the dashboard and report inspectors show the spec schema. The previous pin shipped objectui's zod 4.4.3 beside the injected spec's 4.6.1. That commit carries no objectui changeset, so it is listed under "declared nowhere" below. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 56 releasing of 58 changesets added across 44 non-merge commits; omitted: 2 release-nothing changesets, 3 commits carrying no changeset (they ship no package code).

- **minor** — `FormulaFieldMetadata` declares `@objectstack/spec`'s `expression` in place of `formula`, and three readers of a lookup's display pointer read the spec's `displayField` alone (obj… (objectui `19f484f54`)
- **minor** — **BREAKING** — feat(types): an authored `object-gantt` takes its props in the spec's `properties` bag; the flat spelling is refused by name (objectui#10859, batch 6) (objectui `db0beb2aa`)
- **minor** — `object-form.layout` publishes only `vertical` and `horizontal`. This is objectui#11168 slice 3 and delivers objectui#7759 group C. `@objectstack/spec` 17.5.0 retired `inline` and… (objectui `17dc16793`)
- **minor** — The form layout mirrors state the two values the spec and the renderers honour. This is objectui#11168 slice 3 and delivers objectui#7759 group C. (objectui `17dc16793`)
- **minor** — **BREAKING** — feat(layout): a navigation label written as an inline locale map renders in the viewer's locale; three inert resolver props retire (objectui#11299) (objectui `770cc5ba4`)
- **minor** — fix(types): a navigation entry's `label` accepts an inline locale map, as the spec does (objectui#11299) (objectui `770cc5ba4`)
- **minor** — **BREAKING** — feat(types): an authored `object-chart` takes its props in the `properties` bag; the flat spelling is refused by name (objectui#11276) (objectui `5262f7dd3`)
- **minor** — `navigation` is declared on the `object-timeline` block, by reference to `@objectstack/spec` (objectui#8654). This is the timeline arm of the objectui#8652 maintainer ruling: the… (objectui `95bd23c90`)
- **minor** — feat(types): a node bound through `dataSource.object` needs no `objectName` on the validator (objectui#11117) (objectui `0e6e76bc4`)
- **minor** — feat(types)!: retire `data-table`'s `selectionStyle` and `chatbot`'s `floatingConfig` on both faces, and stop teaching `data-table`'s inline-edit flags as authored keys (objectui#… (objectui `b5b928ab0`)
- **minor** — fix(components): a related list's row menu shows an action whose `visible` is blank, as its toolbar does (objectui `be5211522`)
- **minor** — **Breaking (types only):** the `ActionGroup` interface is removed from `@object-ui/types` (objectui#11168, slice 2). Nothing in this repository imported it. (objectui `cd5b19a7e`)
- **minor** — `element:definition-list`, `element:repeater` and `action:button` publish their inputs as the `@objectstack/spec` 17.5.0 rows declare them and as their renderers read them (object… (objectui `cd5b19a7e`)
- **minor** — **BREAKING (authoring, TypeScript only):** `chartConfig.aria` on a dashboard widget is now a compile error, the same verdict the validator already gives (objectui#4044). (objectui `f3c2bb0f9`)
- **minor** — **BREAKING** — feat(types): an authored `object-map` takes its props in the spec's `properties` bag; the flat spelling is refused by name (objectui#10859, batch 5) (objectui `997ce38cb`)
- **minor** — The text-family field types and every length reader use `@objectstack/spec`'s own `minLength` / `maxLength`, and the snake_case `min_length` / `max_length` are retired at once, wi… (objectui `dd5ff190e`)
- **minor** — `element:text` takes the nine `variant` values `ui:text` publishes (`h1`-`h6`, `body`, `caption`, `overline`) and renders each one the way `ui:text` does (objectui#7450). (objectui `caa0cd392`)
- **minor** — **BREAKING** — `showFilters` is retired on `object-grid` (objectui#11068). (objectui `582edef1c`)
- **minor** — fix(plugin-dashboard): a served dashboard draws its own title, description and sub-caption, not the packaged catalog's (objectui#11295) (objectui `b28bde8a4`)
- **minor** — `navigation` is declared on the `object-kanban` and `object-calendar` blocks, by reference to `@objectstack/spec` (objectui#8652). This is the objectui half of the maintainer ruli… (objectui `d79f525d9`)
- **minor** — **BREAKING** — The object-metadata write guard now holds a `select` / `radio` field that has no option source. (objectui `1563d3e10`)
- **minor** — **BREAKING** — The Field Designer's drawer no longer offers `select` as a field type for a new field, or as a type to change an existing non-choice field into. (objectui `1563d3e10`)
- **minor** — A related list inside a record now places its child object's `record_related` actions on each row (objectui#11270; the renderer half of the enforce answer on objectstack-ai/object… (objectui `a8b988933`)
- **minor** — **BREAKING** — feat(types): an authored `object-form` takes its props in the spec's `properties` bag; the flat spelling is refused by name (objectui#10859, batch 4) (objectui `e3782d26e`)
- **minor** — **BREAKING (authoring):** `assignedProfiles` on a `page` node is now refused on both published faces (objectui#9409). (objectui `02f1813f8`)
- **minor** — `JoinedReportBlock` is now the spec's own type, derived from the installed `@objectstack/spec` instead of hand-written (objectui#10940). It is `JoinedReportBlock` from `@objectsta… (objectui `92970c4d6`)
- **minor** — **BREAKING** — fix(core): `ActionDef` no longer declares `aria`, which `@objectstack/spec` 17.5.0 retired on an action (objectui `e2271568f`)
- **minor** — feat(types): four declared keys nothing honoured are retired on both faces, and two chatbot keys gain their zod mirror (objectui#6152, round 4) (objectui `3e4fa2cfb`)
- **minor** — A blank gate predicate is diagnosed on the three paths that still drew it in silence, and objectui's two gate mirrors whose protocol key refuses a blank now refuse it too (objectu… (objectui `58da8aeca`)
- **patch** — fix(plugin-detail): `record:quick_actions.requiredPermissions` publishes what the gate does — the contract's shared record-block describe, verbatim (objectui `fd6f5da44`)
- **patch** — perf(console): the first screen no longer downloads the spec entries only the metadata designers' validation uses (objectui `993f27e60`)
- **patch** — docs(plugin-gantt): authored `object-gantt` examples write their props in the `properties` bag (objectui#10859, batch 6) (objectui `db0beb2aa`)
- **patch** — The page-block inspector no longer offers `Inline` and `Grid` for an `object-form`'s `layout` (objectui#11168 slice 3, objectui#7759 group C). `@objectstack/spec` 17.5.0 refuses b… (objectui `17dc16793`)
- **patch** — fix(app-shell): a Studio pillar whose draft load is cancelled no longer leaves its canvas on "Loading…" (objectui#11331) (objectui `bef9f204a`)
- **patch** — fix(app-shell): a navigation label written as an inline locale map shows in the viewer's language across the console (objectui#11299) (objectui `770cc5ba4`)
- **patch** — chore(plugin-designer): follow `@object-ui/layout`'s and `@object-ui/types`' navigation label changes (objectui#11299) (objectui `770cc5ba4`)
- **patch** — fix(runner): the sidebar no longer reads the app's retired `version` key (objectui `47e3ce008`)
- **patch** — fix(plugin-gantt, plugin-calendar): the `objectName` input description names the `dataSource.object` binding (objectui#11117) (objectui `0e6e76bc4`)
- **patch** — fix(plugin-grid): a grid row shows an action whose `visible` is blank, as the action's toolbars do (objectui `be5211522`)
- **patch** — `object-calendar` is taught with its `calendar` block, not with flat field-name keys (objectstack-ai/objectui#8831). (objectui `50583364a`)
- **patch** — docs(plugin-map): authored `object-map` examples write their props in the `properties` bag, and the `objectName` input names the `dataSource` binding (objectui#10859, batch 5) (objectui `997ce38cb`)
- **patch** — Message text only: the refusal an `element:text` node draws for an authored `body` or `children` describes what the block renders in the converged `variant` vocabulary, the headin… (objectui `caa0cd392`)
- **patch** — The Studio page-block inspector's `element:text` **Variant** select offers the nine values `ui:text` publishes (Heading 1 to Heading 6, Body, Caption, Overline) in place of Headin… (objectui `caa0cd392`)
- **patch** — The `page` preview sample authors its "Quick links" section heading as `variant: 'h3'`, replacing the pre-convergence spelling `subheading` that the ruling retires (objectui#7450)… (objectui `caa0cd392`)
- **patch** — fix(app-shell): Studio's Automations rail stops telling a flow with a declared trigger that it has "no trigger" (objectui `9cfe9977f`)
- **patch** — fix(app-shell): a served dashboard and a served list view are named as served, on the dashboard page, the view tab and the breadcrumb (objectui#11295) (objectui `b28bde8a4`)
- **patch** — fix(layout): a present navigation label renders as written, with no exception, and an inline locale-map label renders its text (objectui#11201) (objectui `1ccb5ba7d`)
- **patch** — fix(app-shell): a Studio pillar never saves one item's document into another while the second is loading, after a package switch, or after visiting a non-editable leaf (objectui `5f2d9676c`)
- **patch** — docs(plugin-form): the README's authored `object-form` examples write their props in the `properties` bag (objectui#10859, batch 4) (objectui `e3782d26e`)
- **patch** — The flow designer's edge `condition` type now mirrors the server's edge slot, the spec's `EvaluatedExpressionInput` (objectui#8946). (objectui `48401689f`)
- **patch** — docs(core): the `ElementDataSourceConfig.filter` note now separates what an author may write from what a renderer may still receive (objectui#8945) (objectui `969d4f291`)
- **patch** — fix(app-shell): the generic metadata editor renders a stored `view`, and a string-array repeater edits strings (objectui `1b30c0fe0`)
- **patch** — `object-grid` re-reads its rows when an input its query reads changes: a `conditionalFormatting` rule, a row or bulk action def, or the view's `searchableFields` (objectui#10689). (objectui `be0ad007b`)
- **patch** — `list-view` re-reads its rows when a `conditionalFormatting` rule, a row action def or a bulk action def adds a field its predicates read (objectui#10689). (objectui `be0ad007b`)
- **patch** — fix(app-shell,components,console): the three remaining select placeholders show the locale's own "Select…" word (objectui#11252) (objectui `7fed09d07`)
- **patch** — fix(plugin-dashboard): a dimensionless table renders a row of every measure, and a dimensionless chart one mark per measure (objectui `b4333ab8a`)

⚠️ 12 of these carry a breaking change: 12 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 3 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ fix(console): an injected spec shares the console's one zod instance (objectui#11327) (#11353) (objectui `31971ff1e`)
- _(no changeset)_ ci(half-state-patrol): call objectstack's composite action pinned to a sha, with the no-anchor opt-in (objectui#11174) (#11332) (objectui `2c274e3a8`)
- _(no changeset)_ docs: layout.md names the object-grid object with objectName, and flex.mdx teaches the four direction values (objectui#11298) (#11314) (objectui `0c6f9bbd7`)

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, `sdui.manifest.json` + `scripts/sdui-manifest.record.json`, the re-recorded
     `packages/sdui-parser/objectui-lockstep.json` (no port owed: both parser copies agree on
     all 25 codes at the new pin), and the re-measured pin citations in `packages/spec/src`,
     which carry their own `@objectstack/spec` patch changeset. It adds, removes or renames no
     ObjectStack-authorable key: no Zod schema, no spec declaration and no stored
     `sys_metadata` shape moves in it, so `objectstack migrate meta` has nothing here to
     rewrite, and this body carries no FROM/TO prescription of its own.
     The 12 declared-breaking entries listed above are objectui's OWN package surfaces, each
     already carrying its upstream record: `db0beb2aa`, `e3782d26e`, `997ce38cb` and
     `5262f7dd3` (objectui's validator for `object-gantt`, `object-form`, `object-map` and
     `object-chart` refuses the flat spelling and reads the `properties` bag, the shape
     `@objectstack/spec`'s `ComponentPropsMap` rows already declare), `770cc5ba4` (objectui's
     navigation resolver props), `cd5b19a7e` (objectui's `ActionGroup` TypeScript interface),
     `582edef1c` (objectui's own `object-grid` `showFilters`, which no ObjectStack shape ever
     declared), `1563d3e10` (objectui's Studio field designer and metadata write guard), and
     three that mirror an ObjectStack-authorable key already retired and registered on this
     side: `f3c2bb0f9` (`ui/ChartConfig:aria`), `02f1813f8` (`ui/Page:assignedProfiles`) and
     `e2271568f` (`ui/Action:aria`). Where an entry mirrors an ObjectStack key, the ledger
     entry belongs to the `packages/spec` PR that lands the retirement, never to the pin bump.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not a
     per-entry re-measurement of the 12 upstream declared-breaking entries.
-->

objectui range: `e420df310f5b...31971ff1e28f`
