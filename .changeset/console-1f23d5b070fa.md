---
"@objectstack/console": major
---

Console (objectui) refreshed to `1f23d5b070fa`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 76 releasing of 80 changesets added across 83 non-merge commits; omitted: 4 release-nothing changesets, 3 commits carrying no changeset (they ship no package code).

- **major** — **BREAKING** — objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@ob… (objectui `6f3299fe7`)
- **minor** — The bell's Activity tab and the console home's activity card now read business activity only: the shared activity feed filters `sys_activity` by `object_name` to the objects the u… (objectui `1f23d5b07`)
- **minor** — The approval decision panel (`record:approval_decision`) shows what was submitted (objectui#12483): the request's declared amount and a summary of its record snapshot. The amount… (objectui `521817ce9`)
- **minor** — Studio's Access pillar shows an open permission set as an item header and five tabs (objectui#12456, epic objectui#12446 decision C). (objectui `78e9fb2e9`)
- **minor** — Console top bar inside an app: from the `lg` breakpoint up, the search trigger is the bar's middle zone, centered between the left group and the utility cluster (objectui#12472). (objectui `1c3b0699a`)
- **minor** — The approval decision panel (`record:approval_decision`) names who a pending request waits on (objectui#12482, folding objectui#12077). Each pending approver is one chip under "Wa… (objectui `bcf4df0ff`)
- **minor** — The Studio's Automations pillar takes the redesign's layout (objectui#12454, epic objectui#12446). (objectui `8146afe88`)
- **minor** — The console list page's header no longer draws a copy of an action that the selection bar already carries (objectui#12462). (objectui `d35cfbf3b`)
- **minor** — The console list page draws its saved-view tabs and the list's Filter, Sort, Display and Search controls on one row (objectui#12440). (objectui `d4bc81eab`)
- **minor** — **BREAKING** — The page kind `jsx` is retired from the page node, following `@objectstack/spec` 18 (objectstack-ai/objectstack#23638), which refuses it at parse and names `html` as its replaceme… (objectui `21f957744`)
- **minor** — Studio Data pillar layout (objectui#12450, epic objectui#12446). (objectui `7a5f4c19a`)
- **minor** — Console list page: the table scrolls inside the page on desktop, and a right-edge shadow says more columns follow (objectui#12463). (objectui `c950345ab`)
- **minor** — A list's sort, column layout, Filter panel and tab order are now each user's own, and follow them to another browser (objectui#12418). (objectui `caac3b24e`)
- **minor** — **BREAKING** — Console top bar inside an app: the app pill and its PREVIEW chip are the left group, an object route draws no breadcrumb, and 「Edit app」 is an icon button at every width (objectui… (objectui `d9d9d9868`)
- **minor** — Studio design surface: Access is the fourth segment of the pillar nav, which now reads Data · Automations · Interfaces · Access (objectui#12452, epic objectui#12446 decision A). T… (objectui `d25585cff`)
- **minor** — The record header's favorite star draws only where the host wires a toggle, and the console record page no longer draws one (objectui#12427). (objectui `5c4deb56a`)
- **minor** — The console shell's sidebar trigger now lives in the app bar's left slot at every width (objectui#12429). Inside an app it is the bar's leftmost control: on a phone it opens the n… (objectui `e869e4127`)
- **minor** — Studio design surface: one layout skeleton for the four pillars (objectui#12459, epic objectui#12446). The shell header is a 48px three-column grid — the package drawn as an app c… (objectui `cf430cd10`)
- **minor** — Console sidebar: one Favorites section at the top, and one ⋯ menu on every entry (objectui#12427). (objectui `a8e5b7364`)
- **minor** — The console list page spends less of the screen on chrome (objectui#12423). (objectui `a2225f913`)
- **minor** — `MetadataDraftHeader`, the row type `MetadataClient.listDrafts()` declares, now declares `member` (objectui#12413). (objectui `431cece41`)
- **minor** — **BREAKING** — `createObjectStackUploadAdapter`'s `scope` option is typed from the spec's upload-scope vocabulary (objectui#12055). (objectui `24804dcc6`)
- **minor** — "Publish all" publishes each language of a package-less email template by its own bundle member (objectui#12402, the publish half of objectui#12271). (objectui `919d5cd3a`)
- **minor** — `record:related_list` reads its parent record from `parentDataSource` (objectui#12294, ruling B on objectui#12296). The key is a member of the spec's `record:related_list` row and… (objectui `d81e46043`)
- **minor** — Studio's Automations rail and the open flow's Status pill read the automation engine's registration verdict, which the flow list now serves beside its items (`registrations`, `Flo… (objectui `dbc8c1169`)
- **minor** — Studio's flow designer and Debug run stop offering and emulating the single-brace `{var}` dialect, which `@objectstack/spec` 18 deletes (objectui#12329, ADR-0032 Decision 3). (objectui `52a5d81f8`)
- **minor** — **Clause-②: yes (an export widens, and an accept set narrows)** (objectui `96fcf305a`)
- **minor** — `RecordDetailsComponentProps.sections[]` declares `hideEmpty` (objectui#12348). (objectui `1c72d7768`)
- **minor** — Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370). (objectui `ff9df8840`)
- **minor** — `objectui validate` accepts `record:approvals` and `record:attachments` (objectui#12363). `@objectstack/spec` 18 declares both page blocks, `@object-ui/app-shell` renders both, an… (objectui `2b4d3f133`)
- **minor** — Studio stops inserting or prescribing the single-brace `{var}` token in the rest of the flow value slots `@objectstack/spec` 18 refuses it in (objectui#12372, ADR-0032 Decisions 2… (objectui `d78e70b87`)
- **minor** — The screen-flow runner reads the three `flows` translation keys `@objectstack/spec` added for a flow's option labels and its own toasts (objectui#12075, the console half of object… (objectui `42d8e8db6`)
- **minor** — Studio stops writing the single-brace `{var}` token in the flow fields `@objectstack/spec` 18 refuses it in (objectui#12101, ADR-0032 Decisions 2 and 3). (objectui `0a19a683f`)
- **minor** — **Studio no longer offers `externalSharingModel`** (objectui#12353). `@objectstack/spec` retires the key on the v18 line (objectstack#23268, ruling A): it has no runtime reader, a… (objectui `2d8450e46`)
- **minor** — The page block `record:approval_decision` renders (objectui#12342). `@objectstack/spec` 18 declares it, and until now a page naming it passed the spec and drew nothing, because no… (objectui `52d61943c`)
- **minor** — A user whose administrator forced a password change gets the change-password overlay instead of raw `403` responses (objectui#12365). (objectui `37db09f13`)
- **minor** — `element:repeater` reads its query from the node-level `dataSource` binding alone (objectui#12345). `@objectstack/spec` 18 retired the row's flat `object`, `filter`, `sort` and `l… (objectui `23bf8596e`)
- **minor** — **BREAKING** — The view-level `provider: 'api'` data source is no longer read anywhere in objectui (objectui#12325). `@objectstack/spec` retires it (objectstack#23082, ADR-0049): a view binds it… (objectui `524136ea7`)
- **minor** — `NamedListView` declares `requiredPermissions`, the list view's audience key from `@objectstack/spec` 18 (objectui#12341, the objectui half of objectstack#22611 ruling A). (objectui `f2b17c640`)
- **minor** — A page that declares `print` now prints as a document, and a record page bound to such a page offers a Print action (objectui#11958, the objectui half of the print-page ruling on… (objectui `2312bd9a6`)
- **minor** — A file the reader may not open now renders a restricted state instead of a generic file chip (objectui#12339). (objectui `065a1cfbf`)
- **minor** — Studio writes the flow spellings `@objectstack/spec` 18 accepts (objectui#11824, ADR-0032 §3). (objectui `cfb294739`)
- **patch** — A `?tab=` deep link on a metadata item page now opens the sheet it names, and the URL keeps `tab` afterwards (objectui#12496). (objectui `9c2785b6a`)
- **patch** — The AI build page no longer reads `?handoffPrompt=` from the URL, so a link can no longer send a message to the build agent on the signed-in user's behalf; the in-app "Open in Bui… (objectui `b51242899`)
- **patch** — Studio flow checker: in a CEL slot (an edge or node `condition`, a decision branch `expression`, a CEL value) the roots the flow engine binds on every run, `previous`, `vars` and… (objectui `2bacbf08b`)
- **patch** — A list's density and hidden fields are now each user's own, like its sort and column layout, and follow them to another browser (objectui#12474). (objectui `0656b0e3c`)
- **patch** — A `markdown`, `html` or `richtext` cell keeps the grid's one-line row (objectui#12480). The grid's one-line clamp bounded inline content only, so a long rich-content value (a mult… (objectui `c3de0bc73`)
- **patch** — Studio Data pillar, Form tab: one compact toolbar row and card-style sections and fields (objectui#12451). (objectui `68c9b4008`)
- **patch** — Setup catalog editors show History and Audit only to a caller the authoring-trail doors admit (objectui#12475). objectstack#23546 narrows `GET /meta/:type/:name/history`, `/audit`… (objectui `720f6d475`)
- **patch** — Studio's page-create seed and slotted page preview now build an object's default record page with the same detail sections the running app uses. On an object that declares no `fie… (objectui `3e2394d76`)
- **patch** — A browser tab left hidden for 10 minutes stops polling the console's shared feeds, so a forgotten tab no longer keeps a scale-to-zero backend awake (objectui#12439). (objectui `27411ead4`)
- **patch** — A `record:details` node with neither `sections` nor `fields` now draws the object's `highlightFields` (objectui#12433). (objectui `9782cb226`)
- **patch** — An app opens on the first navigation entry the member is shown, not the first entry the server serves (objectui#12426). (objectui `6fcb2ced5`)
- **patch** — An approval request reads the same way on every console surface that opens it, and the Timeline tab of its served page shows its count (objectui#12045, the page-mount step of B1 i… (objectui `bedf41c1c`)
- **patch** — `usePageAssignment` opens an object's default record page: among the record pages served for the object, the one declared `isDefault: true` is returned, and declaration order deci… (objectui `92f979deb`)
- **patch** — A refused "Rename view" now says why (objectui#12417). The object page's view tabs showed only the translated "Rename failed" title for any refusal, and the server's reason reache… (objectui `63079f4a0`)
- **patch** — `deleteView` now shows the server's reason when the published half of a view delete is refused (objectui#12416). (objectui `cfbca7f5b`)
- **patch** — Studio names a draft-only item by its label, with the machine name as secondary text (objectui#11862, the remainder after objectui#11906). (objectui `7c13d3052`)
- **patch** — A refused "Delete view" now says why (objectui#12398). The object page's view tabs showed only the translated "Delete failed" title for any refusal, and the server's reason reache… (objectui `4b0a087a6`)
- **patch** — Setup › Apps: deleting an app names the package whose row it removes (objectui#12397, the consumer half of objectstack#23293). (objectui `5c94723b6`)
- **patch** — The developer Public Forms page lists a form as published exactly when the server's anonymous form routes serve it (objectui#11545). (objectui `6a09fdd0a`)
- **patch** — A grid that fetches its own rows and is tinted by a field that is not one of its columns now colours its rows (objectui#12393). (objectui `2fc31ea94`)
- **patch** — Flow designer: the analysis passes stop modelling the retired single-brace dialect (objectui#12390). A node rename now rewrites only CEL and `{{ }}` holes, so a literal `{x.y}` in… (objectui `4b496cddc`)
- **patch** — Studio stops conflating two members of one bundle. The pending-changes sheet reads each draft's `member` off `GET /meta/_drafts` (objectstack#23073) and lists two languages of one… (objectui `0ddc78888`)
- **patch** — A console reset, delete or draft discard names the package whose row it removes (objectui#12335, the consumer half of objectstack#23165). (objectui `d12bc5fe9`)
- **patch** — **Import Wizard preview: with *Keep unknown option values* ticked, an unknown option value on a writable field is no longer marked** (objectui#11970). The server now keeps such a… (objectui `3f20d5aa2`)
- **patch** — A grid row coloured by `rowColor` now reads in the dark theme, and its colour covers the whole row (objectui#12375). (objectui `70e843fa4`)
- **patch** — Studio keeps a `controlled_by_parent` object savable on `@objectstack/spec` 18 (objectui#12326, the objectui half of objectstack#23100). (objectui `28fb2a001`)
- **patch** — A list view tinted by a field that is not one of its columns now colours its rows (objectui#12376). (objectui `a311b6a9e`)
- **patch** — A comment edit on the record feed sends only the new text and its mentions (objectui#12314, the objectui half of ruling A on objectstack-ai/objectstack#23124). The console used to… (objectui `aafaf9c10`)
- **patch** — Published text no longer teaches the retired view-level `provider: 'api'` data source (objectui#12364). A view binds `provider: 'object'` or `provider: 'value'`; a metadata-declar… (objectui `d75f21285`)
- **patch** — fix(fields): a text-valued formula is drawn as text, not in a monospace code font (objectui#12357) (objectui `789cb166c`)
- **patch** — A New form now saves the owner the user picks (objectui#12359). When the form's layout shows Owner, the user could pick a user and see that user's chip. The create request still c… (objectui `fc211e817`)
- **patch** — fix(plugin-grid): a list column's inline locale-map `label` now heads the column (objectui#12358) (objectui `1040a0a13`)
- **patch** — A bulk action's confirm step now lists the affected records by their display title (the object's `nameField`, through the shared ADR-0079 resolver) instead of raw ids, for objects… (objectui `df05784ae`)
- **patch** — Studio holds a Notify step whose Title is blank, the way it already holds a missing one (objectui#12343, the objectui half of `@objectstack/spec` 18 refusing a blank Notify title). (objectui `ccd7e94a8`)

⚠️ 5 of these carry a breaking change: 1 by a declared `major` level, 4 by the author's own breaking annotation in the changeset body. Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 3 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ docs(design): Studio design-surface reference artboards for the layout redesign (epic #12446) (#12458) (objectui `cfafe052b`)
- _(no changeset)_ ci(release): correct the clear step's pre-mode comment for Changesets 3 (#12434) (objectui `6843f7599`)
- _(no changeset)_ ci(test): widen the test matrix from 12 to 16 legs, and move every pin of the width (objectui#12384) (#12399) (objectui `140916c5c`)

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, the re-recorded `scripts/sdui-manifest.record.json` and the regenerated
     `sdui.manifest.json`, and the re-recorded `packages/sdui-parser/objectui-lockstep.json`.
     It adds, removes or renames no ObjectStack-authorable key: no Zod shape, no spec
     declaration and no stored `sys_metadata` shape moves in it, so `objectstack migrate meta`
     has nothing here to rewrite, and this body carries no FROM/TO prescription of its own.
     The range carries five declared-breaking objectui changes, one by a declared `major`
     and four by their authors' breaking annotation, and the digest marked all five.
     Each is answered against this tree:
     (1) objectui#12334 (`6f3299fe7`), the declared `major`: every `@object-ui/*` package
     moves to major 18 to track the `@objectstack/*` 18 line. This tree is that line, in
     Changesets pre mode on `next` (`.changeset/pre.json`), and `@objectstack/console` is
     `18.0.0-next.1`; no package or example here depends on any `@object-ui/*` package.
     (2) objectui#12464 (`21f957744`), `@object-ui/types`: `PageNodeSchema.kind` drops `jsx`.
     `@objectstack/spec` here already refuses page `kind: 'jsx'` at parse
     (`packages/spec/src/ui/page.zod.ts`), and no example authors it.
     (3) objectui#12461 (`d9d9d9868`), `@object-ui/i18n`: the pack key `topbar.switchObject`
     is removed. Nothing in this tree reads it.
     (4) objectui#12055 (`24804dcc6`), `@object-ui/providers`: the upload adapter's `scope`
     option narrows to the spec's upload-scope vocabulary, TypeScript only. No package or
     example here depends on `@object-ui/providers`.
     (5) objectui#12325 (`524136ea7`), `@object-ui/core` and siblings: the view-level
     `provider: 'api'` readers are retired. `@objectstack/spec` here already refuses
     `view.data.provider: 'api'` (`packages/spec/src/ui/view.zod.ts`), and no example
     authors it.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not a
     per-entry re-measurement of the upstream declared-breaking entries.
-->

objectui range: `b9814b334d8a...1f23d5b070fa`
