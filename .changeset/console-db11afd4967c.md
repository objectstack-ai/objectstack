---
"@objectstack/console": minor
---

Console (objectui) refreshed to `db11afd4967c`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 89 releasing of 99 changesets added across 113 non-merge commits; omitted: 10 release-nothing changesets, 20 commits carrying no changeset (they ship no package code).

- **minor** — An `object-grid` now honours `description` and `emptyState`, and four keys it declared but never read are retired (objectui#11068). (objectui `db11afd49`)
- **minor** — fix(app-shell,core): the record page's Undo captures only what the record carries, through core's one capture rule (objectui#11082) (objectui `76e9df06c`)
- **minor** — The generated JSX types let a declared input win with its type for every base prop, so `sdui-intrinsics.d.ts` compiles as generated (objectui#11075). (objectui `4d377ed65`)
- **minor** — A `record:path` whose stage labels are per-locale maps now shows the viewer's language instead of failing to render, and five label inputs on `object-metric`, `object-grid` and `r… (objectui `27ae63279`)
- **minor** — fix(plugin-form): `object-form`'s `modalCloseButton: false` hides the modal's close button (objectui `559a2e207`)
- **minor** — A number field's authored `useGrouping` now decides whether its value renders with thousands separators (objectui#11026). This is the renderer half of `FieldSchema.useGrouping`, t… (objectui `ae582b70a`)
- **minor** — `element:text`, `element:button`, `element:image` and `element:number` now render the accessible name an author declares in their `aria` prop (objectui#11051). (objectui `a4b017eda`)
- **minor** — An `object-view`'s `table` now hands the grid it draws every grid key it types, and stops typing the grid keys that had nothing to act on there (objectui#10976). (objectui `24a0f146e`)
- **minor** — The base-prop list is declared once, and the renderer's `visibleWhen`, `hiddenOn` and `testId` join it (objectui#11044). (objectui `c80236ec8`)
- **minor** — fix(app-shell): the exported sign-in page says why a sign-in is refused, in the reader's language (objectui#11058) (objectui `827550193`)
- **minor** — An `object-form` whose `title`, `description`, `submitText`, `cancelText`, `nextText`, `prevText` or `successMessage` is a per-locale map now shows the viewer's language instead o… (objectui `9b85600b0`)
- **minor** — fix(app-shell): the exported register page says why a sign-up is refused, in the reader's language (objectui#11030) (objectui `180a34a47`)
- **minor** — **BREAKING** — feat(core)!: bare-string `globalFilters[].options` is no longer lifted; use `{ value, label }` objects, the spec's form (objectui#4356). (objectui `a51fa0cca`)
- **minor** — The strict authoring face accepts a correctly authored `metric-card` in a dashboard's widget slot (objectui#11022). This widens a published accept set; nothing that parsed before… (objectui `0eb9f36ac`)
- **minor** — **BREAKING (shipped as `minor` — see below):** nineteen ADR-0080 public-block arms and the dashboard widget slot's `metric-card` node now refuse an authored `children` by name. No… (objectui `f6fb83f0c`)
- **minor** — New SDUI widget `cloud:plan-status`: a "Current plan" badge for one plan card on the Cloud pricing page, shown when that card's plan is the organization's plan (objectui#10919). (objectui `24d3e6562`)
- **minor** — **Narrowing — `ObjectView`'s props are the declared `ConsoleObjectViewProps`, not `any`.** (objectui `ad0310fb5`)
- **minor** — **BREAKING (shipped as `minor` — see below):** thirteen node types now refuse both content channels by name. Each one's renderer reads neither `body` nor `children`, so an authore… (objectui `2049b03df`)
- **minor** — feat(types): `ObjectMapConfigSchema` is `.strict()`, so `objectui validate` refuses an undeclared key in an `object-map` node's `map` block (objectui#5157) (objectui `d6d8fb9d7`)
- **minor** — A master-detail form whose `title`, `submitText` or `cancelText` is a per-locale map now shows the viewer's language instead of crashing or toasting "[object Object] saved" (objec… (objectui `8aa68b159`)
- **minor** — feat(components): a `kind: 'react'` page's author scope injects `useDataInvalidation` (objectui `deca847a8`)
- **minor** — **BREAKING** — A spec-shape conditional-formatting rule's `condition` and a bulk action's `visible` now declare the named view's own expression slots, read by reference from `@objectstack/spec`… (objectui `d570eaa59`)
- **minor** — **BREAKING** — `drillDown` is retired on the bare `pivot` node: author `object-pivot` to drill (objectui#10932) (objectui `cc4e47638`)
- **minor** — The console's assistant dock binds its build conversation to the app you are in (objectui#10926). (objectui `fe563943b`)
- **minor** — Four Console surfaces that read English under a zh-CN session now read the session's language (objectui#10900). English stays the default. (objectui `328abeb55`)
- **minor** — `safeValidateSchema` — and so `objectui validate` — accepts `element:number`, the ADR-0080 public block held back from batch 1, in both of the binding forms `@objectstack/spec` ac… (objectui `b45d463a9`)
- **minor** — `element:number` reads its object from the node-level `dataSource` binding, as the spec declares it (objectui#10909). (objectui `dd0d78f74`)
- **minor** — `safeValidateSchema` — and so `objectui validate` — accepts three more registered node types: `pivot`, `object-metric` and `object-master-detail-form` (objectui#10859, batch 2). (objectui `3b469c8ea`)
- **minor** — **BREAKING (shipped as `minor` — see below):** the `input` node type now refuses both content channels by name. Its renderer reads neither `body` nor `children`, so an authored ch… (objectui `7e8b3c033`)
- **patch** — fix(console,plugin-form,i18n): the public form page and the master-detail form chrome speak the user's language (objectui `54997fffa`)
- **patch** — fix(app-shell): Studio's app preview resolves a locale-map app, nav-item and group label (objectui#11100) (objectui `8a5ae3d63`)
- **patch** — Nine blocks now render the accessible name an author declares in their nested `aria` bag (objectui#11083, batch 2). (objectui `0ecaa7dbb`)
- **patch** — The dashboard's refresh button now speaks the session language (objectui#11097). `DashboardRenderer` and `DashboardGridLayout` hard-coded "Refresh All", "Refreshing…" and the acce… (objectui `cff8641e2`)
- **patch** — Grouped grid lists whose columns are objects load their rows again, instead of showing INVALID_FIELD in every group (objectui#11105). (objectui `3100bef65`)
- **patch** — An `object-grid` whose deprecated `title` is a per-locale map now shows the viewer's language in the table caption and the export file name, instead of failing to render (objectui… (objectui `0bc5c5a01`)
- **patch** — A page now renders the accessible name an author declares in its `aria` bag, and the list view and the `record:*` blocks read the same bag through the one shared reader (objectui#… (objectui `b24f93a72`)
- **patch** — fix(plugin-timeline): a gantt-variant timeline draws its headers and bars on one continuous axis, so each bar lines up under its header (objectui#11079) (objectui `2fb0f9ab8`)
- **patch** — fix(react): one Ctrl+Z undoes one record write, and Ctrl+Z inside a text field is the field's own undo (objectui#11081) (objectui `06451334b`)
- **patch** — feat(app-shell): Studio's app, permission and view previews show the authored area descriptions, RLS policy labels and view label (objectui `5b2ea1757`)
- **patch** — The console now honours a dashboard's authored `refreshIntervalSeconds` (objectui#11062). `DashboardView` used to render `DashboardRenderer` with no `onRefresh`, and the renderer'… (objectui `88fbd793d`)
- **patch** — fix(app-shell): Studio's flow start node stops offering 「Platform event」, a trigger no engine routes (objectui `17fc68873`)
- **patch** — fix(plugin-calendar): a week or day resize of an overnight event keeps its other edge (objectui#11060) (objectui `3e71a9825`)
- **patch** — feat(app-shell): the flow designer shows a connector action's description and offers its output references (objectui `a5841be35`)
- **patch** — The console's undo confirmation toast reads the session's language (objectui#11056). (objectui `873284657`)
- **patch** — fix(plugin-gantt): a gantt move shifts a task's end by the calendar days it shifts the start, keeping each value's time of day across a DST change (objectui#10866, slice 6) (objectui `e119f120c`)
- **patch** — fix(app-shell): a record page's delete asks through the console's own confirm dialog (objectui#11001) (objectui `981389ba3`)
- **patch** — The form family's own feedback chrome now reads the locale packs (objectui#11039). The default success toast, the thank-you heading, the loading line, the load-failure heading and… (objectui `51c294958`)
- **patch** — fix(app-shell): Studio's flow start node writes the `api` trigger the engine routes, and can set its secret (objectui `b31591b4a`)
- **patch** — fix(plugin-gantt): a zoned chart reads and writes a stored day as that day on a DST change (objectui#10866, slice 5) (objectui `f6ae5e22d`)
- **patch** — fix(plugin-dashboard): the auto-refresh interval reads its handler through a ref, not a memoised identity (objectui `6466a09df`)
- **patch** — `objectui check` prints the key and path a file was refused for, and no longer ends with 「✓ All checks passed」 over files it never validated (objectui#11007). (objectui `37a19d4e0`)
- **patch** — fix(plugin-calendar): a week or day view move keeps the event's own length and grab point (objectui#11037) (objectui `2a1779f96`)
- **patch** — The console strings objectui#10900 left English under zh-CN now read the session's language (objectui#10969). (objectui `6cd8f66e8`)
- **patch** — fix(plugin-view): `ObjectView` fetches only for views that draw the rows, and a re-read keeps them on screen (objectui `30f912a0d`)
- **patch** — The Add reaction button renders only on a comment row of a record's discussion feed (objectui `62d6f56bb`)
- **patch** — A record form whose fields are all locked because the user may not create (or edit) records of its object now says so (objectui#11000). The ADR-0092 D4 lock disables every field w… (objectui `bf7ab35ce`)
- **patch** — Citations of objectstack cards now name their repository (objectui#11016). (objectui `63ab76112`)
- **patch** — A `matrix` report that declares `columns` now draws its declared `chart` below the cross-tab (objectui#10964). `ReportSchema` has always accepted a matrix report carrying both `co… (objectui `49f76725a`)
- **patch** — `validateTree` no longer calls a declared `bind` or `hidden` unknown (objectui#11008). (objectui `99878d8e3`)
- **patch** — `WizardForm`'s own chrome now reads the locale packs (objectui#10999). The default Cancel, Back, Next, Submitting, Create and Update labels, the "Step x of y" counter, the step in… (objectui `2eaf5be27`)
- **patch** — fix(plugin-calendar): a month-grid move keeps the wall-clock time across a DST change (objectui#11005) (objectui `f9b6dfe5a`)
- **patch** — With a `page` record surface and no `onNavigate` handler, `ObjectView`'s New button, a row click and Edit now open the record form on the drawer (objectui#11015). (objectui `3ad61001b`)
- **patch** — A reaction click on a record page's discussion keeps every other user's stored reaction (objectui `4e5cb61a9`)
- **patch** — `record:alert`: a `body` written directly on the node, rather than inside `properties`, is now refused with a pointer to `properties.body`, where the banner's message text lives (… (objectui `b3c96d6bc`)
- **patch** — fix(console): a sign-up refused by the server's audience gate reads in the session's language (objectui#10998) (objectui `e327c8998`)
- **patch** — fix(app-shell): a page action refreshes a custom page's data in place instead of remounting the page (objectui#10519) (objectui `a33cf7e92`)
- **patch** — Correct the last four published "no error, no warning" clauses that the parser tier contradicts (objectui#10981, closing the family of objectui#10928 and objectui#10959). (objectui `797a30f48`)
- **patch** — fix(app-shell): a failed reaction write takes the reaction back and says so, instead of staying shown as applied (objectui#10899) (objectui `e2dffc9d1`)
- **patch** — Under a `split` or `popover` navigation, `ObjectView`'s New button now opens a create form (objectui#10975). (objectui `e9ca14ca9`)
- **patch** — fix(plugin-calendar): a day event moved across a DST change writes the days it was dropped on (objectui#10866, slice 4) (objectui `665025908`)
- **patch** — `DashboardGridLayout` and `DashboardRenderer` now share one auto-refresh timer (objectui#8820). (objectui `1f5a6445c`)
- **patch** — fix(components): an `element:number` that asks for an aggregate and names no object says so instead of painting a silent dash (objectui `4b742f41d`)
- **patch** — The metadata form's code editor reads and writes an expression slot through the ADR-0089 envelope (objectui#10963). (objectui `79a935c87`)
- **patch** — fix(app-shell, plugin-detail): the unmapped activity type warnings no longer point at an objectstack issue that answers 404 (objectui `285e36bd1`)
- **patch** — Correct a false clause in the `header-bar` refusal messages and in nine `body?: never` docblocks (objectui#10959). (objectui `42687baf2`)
- **patch** — A named view's `navigation`, `fieldOrder` and `inlineEdit` now reach the registered `object-view` renderer's grid (objectui#10885, member 4). (objectui `4d22e3351`)
- **patch** — fix(plugin-timeline,core): the timeline's gantt axis draws a stored date-only day on that day in every viewer zone, and the formula date functions do their day arithmetic on the U… (objectui `9e6619ffa`)
- **patch** — fix(plugin-chatbot): the confirm-changes card's actions wait until no turn is in flight (objectui `be66b5621`)
- **patch** — Correct a false clause in the content-channel refusal messages (objectui#10928). (objectui `95a7c8d38`)
- **patch** — fix(plugin-chatbot): the proposed-plan card's actions wait until no turn is in flight (objectui `7d82957b1`)
- **patch** — fix(app-shell): console actions supply the spec-declared `${ctx.org.*}` scope (objectui#10918) (objectui `06a96e948`)
- **patch** — The registered `object-view` renderer reads a named grid view's own grid members off the named view (objectui#10885). (objectui `b73e15bf7`)
- **patch** — fix(plugin-designer): editing an app keeps its stored navigation (objectui#10894) (objectui `44b67dabd`)
- **patch** — fix(app-shell): the assistant FAB is hidden while the chat dock is open (objectui#10899) (objectui `ac15833eb`)
- **patch** — fix(plugin-chatbot): a reloaded multi-step build no longer shows an empty 「执行过程」 block under every step (objectui#10899) (objectui `ac15833eb`)
- **patch** — fix(data-objectstack, plugin-dashboard): a dataset tile the viewer may not read shows a localized "no access" state (objectui#10899) (objectui `ac15833eb`)
- **patch** — fix(app-shell, plugin-detail): a record comment whose write fails is never shown as sent (objectui#10899) (objectui `ac15833eb`)
- **patch** — fix(app-shell): the marketplace offers an "update" only for a HIGHER version (objectui#10899) (objectui `ac15833eb`)
- **patch** — fix(app-shell): the Studio edit/design affordances follow the server's authoring capability (objectui#10899) (objectui `ac15833eb`)

⚠️ 6 of these carry a breaking change: 6 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 20 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ docs(plugin-gantt): the drag's time-of-day sentence names the shift-band exception (objectui#10866) (#11110) (objectui `d1e683fa1`)
- _(no changeset)_ fix(ci): the Test aggregator re-reads a present shard the jobs API answered with no conclusion (objectui#10931) (#11108) (objectui `80c2d5e61`)
- _(no changeset)_ docs(changeset): date-note nine pending entries whose repository count moved (objectui#10979) (#11046) (objectui `480de81fd`)
- _(no changeset)_ docs(changeset): date-note three pending entries on the pivot node's drillDown that PR #10972 made false (objectui#10974) (#11045) (objectui `338482fe7`)
- _(no changeset)_ fix(ci): re-pin the console eager-closure baseline and ceiling on main's own reading (objectui#10996) (#11018) (objectui `6c57c779e`)
- _(no changeset)_ fix(scripts): parse a `json` doc fence strictly with parseJsonFence (objectui#10943) (#10985) (objectui `f667c1df9`)
- _(no changeset)_ docs(agents): split the ruleset bullet, and date the governed guard's enrolment as a required context (objectui#9520) (#10984) (objectui `a097316a2`)
- _(no changeset)_ docs(contributing): a repository count in a changeset is a reading at a named commit (#10978) (objectui `a2de9e943`)
- _(no changeset)_ docs(changeset): date the spec-symbol gate's export filter in the #6286 release note (objectui#9528) (#10970) (objectui `7a9db9148`)
- _(no changeset)_ docs(agents): a force-push is governed by the landing repo's AGENTS.md (objectui#9666) (#10958) (objectui `4dc491a12`)
- _(no changeset)_ fix(scripts): walk both sides of a pipe in the strict-face measurement twin (objectui#10076) (#10966) (objectui `c32890016`)
- _(no changeset)_ docs(adr): ADR-0057 Amendment A2 — the dock binds its build thread to the current app (objectui#10926) (#10947) (objectui `1345e182d`)
- _(no changeset)_ fix(scripts): correct the RETIRED_FIELD_TYPES `excluded` sentence that dropping the line refutes (objectui#10070) (#10961) (objectui `b120b6607`)
- _(no changeset)_ fix(ci): label PRs touching the published docs tree `documentation` (objectui#10012) (#10960) (objectui `97dabdc5b`)
- _(no changeset)_ docs(changeset): date the three named-view census entries that PR objectui#10884 made false (objectui#10885, member 3) (#10955) (objectui `462c85868`)
- _(no changeset)_ docs(changeset): the read-rate banner and its hook are not exported from the package entry (objectui#10913) (#10954) (objectui `a4fb7082a`)
- _(no changeset)_ docs(skills): testing.md Pattern 5 publishes `userRole` through the scope channel the renderer reads (objectui#9380) (#10941) (objectui `7e1a8d098`)
- _(no changeset)_ fix(scripts): the polarity census pins stop asserting what the live `.changeset/` holds, so the post-version tree validates (objectui#10010) (#10933) (objectui `a93ba8792`)
- _(no changeset)_ fix(console): drop the two optimizeDeps.include entries the dev server cannot resolve (objectui#10865) (#10938) (objectui `51401e63c`)
- _(no changeset)_ docs(agents): port objectstack's model-free commit-trailer rule into the multi-agent section (objectui#9441) (#10922) (objectui `af2221d45`)

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it (this console
     changeset, `sdui.manifest.json` + `scripts/sdui-manifest.record.json`, the re-recorded
     `packages/sdui-parser/objectui-lockstep.json`, and the re-measured pin citations in
     `packages/spec/src`). It adds, removes or renames no ObjectStack-authorable key: no Zod
     schema, no spec declaration and no stored `sys_metadata` shape moves in it, so
     `objectstack migrate meta` has nothing here to rewrite, and this body carries no
     FROM/TO prescription of its own.
     The pin-citation re-measure changes text only: source comments, one `.describe()`
     sentence (`FormField.span`) and the description text of six semantic migration
     entries, with the generated `migrations/registry.ts` and reference page that project
     them. It adds, removes or renames no key, and moves no default, enum member or export.
     The 6 declared-breaking entries listed above are objectui's OWN package surfaces
     (`@object-ui/types`, `@object-ui/core` and `@object-ui/plugin-dashboard`), each already
     carrying its upstream record. Where one of them mirrors an ObjectStack-authorable key,
     the ledger entry belongs to the `packages/spec` PR that lands the mirror, never to the
     pin bump, whose diff contains no such key.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not
     a per-entry re-measurement of the 6 upstream declared-breaking entries.
-->

objectui range: `dd3f7e1be356...db11afd4967c`
