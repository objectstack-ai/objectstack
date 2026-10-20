---
"@objectstack/console": minor
---

Console (objectui) refreshed to `616df6598b42`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 30 releasing of 31 changesets added across 32 non-merge commits; omitted: 1 release-nothing changeset, 1 commit carrying no changeset (they ship no package code).

- **minor** — An action's param dialog keeps what the user typed when the server refuses the run (objectui#13161). (objectui `616df6598`)
- **minor** — **BREAKING** — The list view's Filter panel no longer narrows its field list to a per-view `filterableFields` whitelist (objectui#13118). `@objectstack/spec` 18 retires the list view's `filterab… (objectui `cbac9d7dd`)
- **minor** — Studio marks the settings the AI copilot drafted: a Draft chip and a Source line ("Added as a draft by the AI copilot 2 min ago") on a field or a list-view setting the copilot cha… (objectui `3bcf314e7`)
- **minor** — A list's `addRecord` Add button opens the create form on a console page and on the console's object list (objectui#13089). (objectui `d11174ad1`)
- **minor** — A navigation entry's API `dataSource` is read, and its `visible` sees the selected value as `data` (objectui#13029). (objectui `1b94d50aa`)
- **minor** — Studio's Changes drawer can now fill a new field's default into the records an object already holds, when you publish (objectui#12929). (objectui `6058bf8b7`)
- **minor** — A page `list-view` node now honours `requiredPermissions`, a key of the spec's list view row, and the registration publishes it (objectui#13074): the capabilities a viewer must al… (objectui `b0176214a`)
- **minor** — **BREAKING** — A navigation item's `visible` now takes `@objectstack/spec`'s `EvaluatedExpressionInputSchema` by reference, beside the boolean it already took (objectui#13075). (objectui `df7156808`)
- **minor** — A page predicate can ask the capability question: `current_user.hasCapability('NAME')` now answers in the console, from the same `/auth/me/permissions` answer the action gate read… (objectui `2493e85a3`)
- **patch** — Studio's create dialogs now bind each field label to its input (objectui#13128). The display-name and identifier labels in the shared create dialog had no `htmlFor`, and the input… (objectui `157694c7b`)
- **patch** — A refused package publish on the package sheet shows the reasons the server returned, under the count sentence (objectui#13160). (objectui `4c36eab58`)
- **patch** — A chart saved view keeps the view tabs on the console list page (objectui#13114). (objectui `91b658a75`)
- **patch** — The console's "This app can't be opened" screen, and its "Couldn't reach the server" and "App not available" siblings, now offer "Back to home" beside Retry — the same way out the… (objectui `5dbc6a579`)
- **patch** — The Import Wizard sends a saved mapping the format the mapping declares (objectui#13156). A mapping that declares `sourceFormat: 'csv'` is now imported with `format: 'csv'`, the r… (objectui `d05f33b2e`)
- **patch** — Studio's row-level security editor holds a policy until it has a name (objectui#13113). (objectui `427e59c9e`)
- **patch** — An ungrouped list view now asks for the object's declared `nameField` in its `$select`, so the bulk confirm step lists each record's name rather than `Record #ID` when no column s… (objectui `a57d80afe`)
- **patch** — The create form uses the object's `create` form view when it declares one (objectui#13099, ruling B′ on objectstack-ai/objectstack#24692). (objectui `ed2805768`)
- **patch** — The bulk-action confirm step names each affected record by the object's declared `nameField`, even when no column of the view shows it, and never by another text field (objectui#1… (objectui `4b6774649`)
- **patch** — The record page heading labels a select `nameField` (objectui#13103). When an object's declared `nameField` (or `displayNameField`) is a select field, the record page H1 now shows… (objectui `2d8a8b7dc`)
- **patch** — `record:details` no longer draws a record pointer's type half as its own row (objectui#13102). (objectui `4c6885580`)
- **patch** — Studio's copilot draft marks, the remainder (objectui#12725): (objectui `df943a2a1`)
- **patch** — An app's landing waits for the API reads of its navigation entries (objectui#13097). (objectui `d87e4f2ec`)
- **patch** — On a phone, the AI chat's pending-drafts bar shows its whole sentence (objectui#13088). (objectui `a26068b9e`)
- **patch** — Setup's metadata lists keep a row's controls in reach on a narrow screen, and say in words when the activation state cannot be read (objectui#13091). (objectui `633ef99a3`)
- **patch** — An object field whose `visibleWhen` names `current_user.hasCapability(NAME)` is now answered on the record form page and in the console's record-form modal (objectui#13083). (objectui `90518cdb8`)
- **patch** — Studio's RLS policy editor now asks `@objectstack/lint`'s RLS rule about every `USING` or `CHECK` clause that parses, not only about one the runtime cannot lower (objectui#13082).… (objectui `a487cedd6`)
- **patch** — One object-page open reads the published view list (`GET /meta/view`) once (objectui#13057). The adapter now stores the list its client read and answers `listViews` and `listViewO… (objectui `cd4623d06`)
- **patch** — On a phone, the AI chat's "Preview app" pill no longer covers the composer's input (objectui#13068). (objectui `282b138c0`)
- **patch** — The console no longer reads the whole object registry before the first paint on two more routes (objectui#13046). (objectui `b3007fd96`)
- **patch** — Studio names two more things by label where the served metadata carries one. In Explain access, each pipeline layer's "Contributed by" chips now show the position or permission se… (objectui `cc4ae3e14`)

⚠️ 2 of these carry a breaking change: 2 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 1 commit in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared it, so it appears in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ test(e2e/live): the eleven stale live specs, each brought back to the shipped showcase or retired (objectui#13104) (#13132) (objectui `0b36ffa8c`)

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, the re-recorded `scripts/sdui-manifest.record.json` and the regenerated
     `sdui.manifest.json`, and the re-recorded `packages/sdui-parser/objectui-lockstep.json`.
     It adds, removes or renames no ObjectStack-authorable key: no Zod shape, no spec
     declaration and no stored `sys_metadata` shape moves in it, so `objectstack migrate meta`
     has nothing here to rewrite, and this body carries no prescription of its own.
     The range carries two objectui changes their authors annotated breaking, and the digest
     marked both. Each is answered against this tree:
     - objectui `cbac9d7dd` (objectui#13118) removes objectui's last reader of the list
       view's `filterableFields`, and `@object-ui/types` declares `NamedListView.filterableFields`
       a `?: never` tombstone. The spec half is this tree's own, already landed: the key left
       `ListViewSchema` in 18.0 with its conversion `view-list-filterable-fields-removed`
       registered in `packages/spec/src/conversions/registry.ts`. This pin move is what lets
       the console build at `main` again; it adds no second retirement.
     - objectui `df7156808` (objectui#13075) types `NavigationItemSchema.visible` in
       `@object-ui/types` by reference to this tree's `EvaluatedExpressionInputSchema` and
       refuses a blank string there, and widens `@object-ui/layout`'s `VisibilityEvaluator`.
       This tree's spec already types a navigation entry's `visible` as
       `EvaluatedExpressionInputSchema` (`packages/spec/src/ui/app.zod.ts`), so the objectui
       side now agrees with it; nothing in this tree's contract moves.
     No package in this tree imports or depends on any `@object-ui/*` package, and
     `@objectstack/console` publishes objectui's built SPA and exports no objectui type. -->

objectui range: `12dc7b47c340...616df6598b42`
