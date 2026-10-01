---
"@objectstack/console": minor
---

Console (objectui) refreshed to `e420df310f5b`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 87 releasing of 93 changesets added across 90 non-merge commits; omitted: 6 release-nothing changesets, 1 commit carrying no changeset (they ship no package code).

- **minor** — `flex`, `object-grid` and `object-chart` accept the node-level `responsiveStyles` that `@objectstack/spec`'s `PageComponentSchema` declares on every page component, and judge it a… (objectui `f3135a4d1`)
- **minor** — Setup › Packaged automation shows the platform's reason for a packaged flow the engine has not armed, verbatim and in muted text under the flow name (objectui#9217). (objectui `1cb3732ce`)
- **minor** — **BREAKING (scored `minor` per this repo's version-alignment convention)** — `ObjectKanbanSchema.onQuickAdd` is retired on `object-kanban` (objectui#11234). This completes ruling… (objectui `52aad5cef`)
- **minor** — fix: a row-menu action gated through `disabled` stays disabled until the permissions payload has loaded, in a grid and in a related list's table, and an `<ActionProvider>` answers… (objectui `18d1a0abd`)
- **minor** — `safeValidateSchema` — and so `objectui validate` — and `StrictAnyComponentSchema` judge a component nested in a page container's props bag (objectui#11223). (objectui `7d074baae`)
- **minor** — `reference` is now the only spelling ObjectUI writes or reads for a relational field's target object (objectui#11070, round 4, under the objectui#6837 ruling: 「objectui不是前端的项目吗？后端… (objectui `f61dab169`)
- **minor** — `record:related_list` now renders the actions its `actions` key names (objectui#11163; ENFORCE ruling on objectstack#20665). (objectui `f4ed2387e`)
- **minor** — feat(app-shell): the sidebar and `nav:menu` hide a `doc` entry the member may not read (objectui#10188) (objectui `d6a1a80d5`)
- **minor** — feat(console): the docs portal refuses a doc or book the member may not read, and opens a doc in the book that claims it (objectui#10188) (objectui `d6a1a80d5`)
- **minor** — feat(layout): a host can hide a `doc` navigation entry the member may not read (objectui#10188) (objectui `d6a1a80d5`)
- **minor** — Every ADR-0080 public-block arm accepts the node-level `responsiveStyles` that `@objectstack/spec`'s `PageComponentSchema` declares, and judges it as the spec does (objectui#10872… (objectui `54a78308a`)
- **minor** — fix(types,components,plugin-form,console,core): a faulted `visibleWhen` refuses the submit, naming the field and the rule; a blank field rule is refused; blank gates are diagnosed… (objectui `af9e9572c`)
- **minor** — `safeValidateSchema` — and so `objectui validate` — accepts one more registered node type: `object-timeline` (objectui#10859, batch 3). (objectui `ae0b9d390`)
- **minor** — feat(app-shell): the flow node inspector marks the config keys the installed spec refuses the node without (objectui#10948). (objectui `68c9ca721`)
- **minor** — **BREAKING** — The formula and summary field widgets read `@objectstack/spec`'s own spellings, `returnType` and `summaryOperations`, and the snake_case spellings they used to read are retired at… (objectui `615346d61`)
- **minor** — feat(app-shell): Studio has a Markdown editor for `doc` items, with a live preview and book placement (objectui#10188) (objectui `02fe8ca8a`)
- **minor** — Declare the `filter` and `sort` inputs on the `object-map`, `object-gantt`, `object-timeline` and `view:timeline` registrations (objectui#8220) — the html tier stops reporting `un… (objectui `233a1b318`)
- **minor** — fix: an action gated on `current_user.can(object, verb)` stays hidden until the permissions payload has loaded on every action `visible` surface, a `page:header` action gated thro… (objectui `8bab1571d`)
- **minor** — fix(fields): a currency grid column's width is its currency's minor unit, never an authored `scale`; a hydrated currency column's `scale` is reported (objectui#10783) (objectui `b32e7debc`)
- **minor** — **BREAKING** — `quickAdd` is retired on `object-kanban` (objectui#8285, ruling B of the director seat's decision batch #91: the board does not grow an inline record-creation write… (objectui `6f864cf62`)
- **minor** — feat(types): four zod mirrors declare members their TypeScript twins already declared, and `pagination` retires its `page` spelling (objectui#6152, round 3) (objectui `0c95d3d8d`)
- **minor** — The four `page:` containers take their child list in `properties.children`, the member their `@objectstack/spec` row declares, and refuse a node-level `children` by name: `page:ca… (objectui `dded788ad`)
- **minor** — fix(app-shell,plugin-detail): the record feed says "no permission" when its read is refused, instead of showing an empty list (objectui `1263e405d`)
- **minor** — `ObjectGrid` takes `onNavigate` as a component prop, and the list channel's navigation callback takes one closed mode token, `'view' | 'new_window'`. (objectui `c3df43a42`)
- **minor** — feat: a `doc` navigation entry (ADR-0046) validates and draws as a link into the docs portal (objectui `e6bc087a3`)
- **minor** — **BREAKING** — **The console reads a saved view by the spellings `@objectstack/spec` declares, and stops reading the keys nothing writes (objectui#11013).** This is the console end of the ruling… (objectui `3c13675e5`)
- **minor** — feat: an action's `visible` / `disabled` predicate can ask `current_user.can(object, verb)` — the caller's object permissions, from the payload the built-in Edit / Delete buttons… (objectui `9cebfca5a`)
- **minor** — A filter on a record page can now be scoped to the record the page shows (objectui#7297). Write `{record_id}` as a filter value, for example `{ "assignee": "{record_id}" }` on an… (objectui `cfc9b6db9`)
- **minor** — A page size with nothing declared is now the one `@objectstack/spec` declares for `pagination.pageSize`, on every surface that has a pager; a fetch that has no pager keeps its own… (objectui `de5d400bf`)
- **minor** — The four `action:*` blocks now publish the `@objectstack/spec` keys their renderers honour, and stop publishing what the spec refuses (objectui#11168, slice 1). Each key was decid… (objectui `3cc4fe567`)
- **minor** — **Breaking behaviour change — `object-tree` now honours only the `data` spelling its published row declares.** (objectui `846cec0ef`)
- **minor** — feat(types): the `object-form` zod mirror declares the members its TypeScript twin already declared (objectui#6152, round 1) (objectui `3a3db763b`)
- **minor** — `record:details`, `record:highlights` and `record:related_list` declare the field-security triple — `enforceFieldSecurity`, `redactFields` and `requiredPermissions` — on their pub… (objectui `647908686`)
- **minor** — The six public blocks that objectui#10872 batch 4 armed now refuse an authored `children`, and name the right remedy for a flat `body`: `action:button`, `action:icon`, `action:gro… (objectui `3f9d9263e`)
- **minor** — feat(types,layout,app-shell): a navigation entry with no `label` shows its target's current label, resolved at render time (objectui#9868) (objectui `a8198de22`)
- **minor** — `safeValidateSchema`, and so `objectui validate`, accepts the six ADR-0080 public blocks held back until `@objectstack/spec` carried a `ComponentPropsMap` row for each: `action:bu… (objectui `e978ed5ea`)
- **minor** — The strict authoring face accepts keys a registered renderer reads, which it used to refuse as undeclared (objectui#11070). Each key below is now declared on the TypeScript face a… (objectui `b0a05dda1`)
- **minor** — feat(cli): `objectui check` refuses a `${…}` on a text key its node never evaluates (objectui `33da643e9`)
- **minor** — objectui now resolves `@objectstack/*` 17.5.0 and `zod` 4.6.5, and follows every contract move that release makes (objectui#11073). `@objectstack/spec` 17.5.0 and `@objectstack/co… (objectui `81f849852`)
- **minor** — fix(plugin-gantt,core,plugin-timeline): both gantt surfaces read a date-only end inclusively through one core rule, and a drag writes the same day back (objectui#11141) (objectui `858eafb4f`)
- **patch** — fix(plugin-detail): a related list's `list_toolbar` action authored `visible: false` is hidden (objectui `e420df310`)
- **patch** — fix(console): the docs portal's book sidebar keeps a doc placed by its own `group` key from outside the book's package (objectui#11245) (objectui `f16c01e90`)
- **patch** — fix(app-shell): switching Studio to another flow, page or package no longer saves the previous item's unsaved edit into the one just opened (objectui `fc650380d`)
- **patch** — fix(app-shell): the Studio surface, its nav-item inspector and a new canvas entry inherit a label-less entry's label, the way the console does (objectui#11196) (objectui `02a22957c`)
- **patch** — fix(fields,plugin-detail,plugin-grid): every percent face reads its width through the spec's `resolveFieldScale`, so an undeclared percent renders the same everywhere (objectui `741864f7b`)
- **patch** — fix(app-shell): a flow screen select with no placeholder shows the locale's own "Select…" word (objectui#11220) (objectui `f523bd684`)
- **patch** — fix(plugin-list,plugin-grid): a grouped list view under a toolbar search groups on the server, and each group counts all its matching rows (objectui `d0ae5d025`)
- **patch** — fix(app-shell,plugin-designer): standard navigation entries are written with no `label`, never with a copy of their target's text (objectui#11201) (objectui `cb2f6fb5b`)
- **patch** — fix(app-shell,plugin-designer): the designer's nav surfaces name a nav entry with no `label` the way the console draws it (objectui#11196) (objectui `8741cb71a`)
- **patch** — fix(app-shell): Studio's draft autosave saves an edit made while a save is in flight, in every editor that uses it (objectui `395f4fa51`)
- **patch** — fix(components): a `kind:'react'` page no longer writes the host adapter under each block's `dataSource` (objectui `c021b3529`)
- **patch** — fix(components): an `action:menu` trigger stays disabled while its action runs, and a disabled `action:group` disables its buttons (objectui#11182) (objectui `2e3da72ad`)
- **patch** — fix(app-shell): the Studio flow screen preview draws a screen field's `options`, `placeholder` and `defaultValue` as the runtime dialog does (objectui `ed498ac91`)
- **patch** — fix(app-shell): the page designer stops offering the retired `page:header` breadcrumb toggle (objectui#11173) (objectui `52bf34824`)
- **patch** — fix(app-shell): the permission editor's row-level-security policy list draws each policy's label and description (objectui `f8334f877`)
- **patch** — fix(app-shell): Studio's nav autosave sends every nav edit it has shown — "Done" sends the edit, and a completing save clears only what it sent (objectui `0389650f3`)
- **patch** — fix(app-shell): the save warning has a sentence of its own for a formula field the server ignored (objectui `9419df198`)
- **patch** — fix(data-objectstack): the rule-entry filter form refuses an empty or non-string `icontains` comparand (objectui `0b8c63831`)
- **patch** — fix(app-shell): Studio prints an app's own locale-map label in the designer locale instead of `[object Object]` (objectui `39e625de2`)
- **patch** — feat(app-shell): the screen-flow dialog renders a screen field's declared bound, help text and lookup target (objectui `81778b955`)
- **patch** — fix(app-shell): Studio's Interfaces pillar closes nav editing when the package answers read-only, so no edit is taken on screen that its autosave will refuse (objectui `37d166280`)
- **patch** — fix(plugin-grid): a search reaches the grouped grid's header query and every group's row query, so the groups are the searched ones (objectui `7e4fa1bb2`)
- **patch** — Studio's Interfaces pillar no longer loses its nav rail when a nav item's label is a locale map (objectui#11158). (objectui `3ab51503b`)
- **patch** — fix(app-shell): the metadata form routes a condition builder to a member the served derivation marks as an erased string arm (objectui `32b131017`)
- **patch** — The ingestion choke point's diagnostic for a stored `id_field` now carries the reason `@objectstack/spec` publishes for that key (objectui#7650). (objectui `1e215c40b`)
- **patch** — `page:header` no longer draws an empty breadcrumb slot, and an authored `breadcrumb` is ignored (objectui#11166). (objectui `0ffc423b1`)
- **patch** — fix(app-shell): the report and dashboard-widget pickers show a dataset member's label and the dataset's description (objectui `cecd6a031`)
- **patch** — fix(app-shell): a shared `?sel=nav:ID` link survives the designer's mount and opens that nav item, without entering editing on a read-only package (objectui#11153) (objectui `957f69520`)
- **patch** — fix(fields,plugin-form,i18n): the line-items grid's required-cell text and the master-detail form's config hints read the locale packs (objectui `c2a8d23c6`)
- **patch** — fix(plugin-form,fields,i18n): the line-items panel, the grid field and the master-detail heading finish speaking the user's language (objectui `a8c550938`)
- **patch** — fix(app-shell): Studio's nav-item inspector shows a locale-map label and edits only the designer locale's entry (objectui `9a45088c4`)
- **patch** — An unlabelled undoable action's Undo and Redo toast names the object and carries no English verb (objectui#11080). (objectui `a782fa732`)
- **patch** — fix(fields): a multi-value select shows its placeholder while nothing is selected (objectui `3a0e7ab05`)
- **patch** — fix(app-shell): Studio's Interfaces pillar hands its page inspectors, canvas and source editor the package's real read-only flag (objectui `d71d972ae`)
- **patch** — fix(plugin-form): a master-detail child with authored inline columns derives its sort field and amount field, so line order persists and the total shows (objectui#11144) (objectui `263dcd77f`)
- **patch** — The console's global Undo and Redo toasts read the session's language (objectui#11080). (objectui `1d6a23d60`)
- **patch** — The `object-master-detail-form` registration's `fields` description no longer calls that key "the submitted set" (objectui#11114). (objectui `3fa193856`)
- **patch** — A `record:path` block that sets `statusField` and leaves out `stages` now shows the status field's picklist as its stages, instead of the "record:path — no stages configured" plac… (objectui `3f61eef1b`)
- **patch** — fix(app-shell): Studio's app designer canvas shows a locale-map nav label and renames only the current locale's entry (objectui#11128) (objectui `9babfa433`)
- **patch** — fix(app-shell): the flow designer stops warning on an edge guard that reads its source node's own outputs (objectui `f75e1f7e0`)
- **patch** — fix(plugin-form,fields,i18n): the record page's line-items panel and the line-items grid speak the user's language (objectui `385ebc5c6`)
- **patch** — fix(plugin-form): the master-detail form's Subtotal / Tax / Total show the amount's currency, not a hard-coded yen sign (objectui#11132) (objectui `1923d35d2`)
- **patch** — fix(core,app-shell): Undo of a lookup update restores the stored id, not the expanded record (objectui#11122) (objectui `bf43afafa`)
- **patch** — fix(plugin-timeline,types): a gantt-variant timeline draws a date-only end through the end of that day (objectui#11112) (objectui `c27b575ed`)
- **patch** — A hand-authored form field `{ type: 'select', multiple: true }` now renders the multi-value select and submits an array (objectui#11116). The form renderer's built-in `select` bra… (objectui `84b275c01`)
- **patch** — fix(app-shell): Studio's Automations pillar honours a read-only package on its Enabled switch, flow inspector and canvas (objectui `9fd6c2c6f`)
- **patch** — fix(app-shell,i18n): the designer's flow, federated-panel and field-stub chrome speak the user's language (objectui#10862, slice 4) (objectui `78abf3021`)

⚠️ 5 of these carry a breaking change: 5 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 1 commit in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared it, so it appears in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ docs: re-fence the plugins and core remainder of objectui#5867 as ts, 17 blocks across 8 pages (batch 6) (#11176) (objectui `340dc718f`)

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it (this console
     changeset, `sdui.manifest.json` + `scripts/sdui-manifest.record.json`, the re-recorded
     `packages/sdui-parser/objectui-lockstep.json`, the re-measured pin citations in
     `packages/spec/src`, and the `@objectstack/sdui-parser` port of objectui `6f864cf62`
     that the lockstep demands, which carries its own changeset and disposition). It adds,
     removes or renames no ObjectStack-authorable key: no Zod schema, no spec declaration and
     no stored `sys_metadata` shape moves in it, so `objectstack migrate meta` has nothing
     here to rewrite, and this body carries no FROM/TO prescription of its own.
     The pin-citation re-measure changes text only: source comments, one `.describe()`
     sentence (`FormField.span`) and the description text of six semantic migration
     entries, with the generated `migrations/registry.ts` and reference page that project
     them. It adds, removes or renames no key, and moves no default, enum member or export.
     The 5 declared-breaking entries listed above are objectui's OWN package surfaces, each
     already carrying its upstream record: `52aad5cef` (`@object-ui/types`,
     `@object-ui/plugin-kanban`), `615346d61` (`@object-ui/types`, `@object-ui/fields`),
     `6f864cf62` (`@object-ui/types`, `@object-ui/plugin-kanban`, `@object-ui/sdui-parser`),
     `3c13675e5` (`@object-ui/types`, `@object-ui/data-objectstack`, `@object-ui/app-shell`,
     `@object-ui/plugin-view`) and `846cec0ef` (`@object-ui/core`, `@object-ui/plugin-tree`).
     Where one of them mirrors an ObjectStack-authorable key, the ledger entry belongs to the
     `packages/spec` PR that lands the mirror, never to the pin bump: the one such key in this
     range, `object-kanban.quickAdd`, is already registered on this side as
     `page.component.object-kanban.quickAdd` (#17260).
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not
     a per-entry re-measurement of the 5 upstream declared-breaking entries.
-->

objectui range: `db11afd4967c...e420df310f5b`
