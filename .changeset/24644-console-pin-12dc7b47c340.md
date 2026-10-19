---
"@objectstack/console": minor
---

Console (objectui) refreshed to `12dc7b47c340`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 28 releasing of 28 changesets added across 32 non-merge commits; omitted: 4 commits carrying no changeset (they ship no package code).

- **minor** — Setup lists the sharing rules installed packages declare again, read-only, with Disable / Enable and Clone (objectui#12982). (objectui `12dc7b47c`)
- **minor** — `list-view` publishes the keys of its `@objectstack/spec` row that the renderer honours on a page node (objectui#13047). (objectui `a244a172a`)
- **minor** — **BREAKING** — An import undo that leaves rows unreverted now says so in the Import Wizard (objectui#13015). (objectui `a928aaa61`)
- **minor** — A `type: 'form'` action placed at `record_related` and fired from a related-list row now opens the clicked row's edit form (`/forms/NAME?recordId=ROW_ID&recordObject=CHILD`), as i… (objectui `9f1dd79fe`)
- **minor** — A field group whose `visibleWhen` cannot be evaluated is now hidden, header and members, on the form and on the record detail page (objectui#13055). (objectui `fb85637e1`)
- **minor** — The AI build chat's pending-drafts bar no longer covers the composer's input (objectui#12978). (objectui `51269f0fd`)
- **minor** — Bound record blocks draw an authored empty state when their binding answers no row (objectui#12932, the renderer half of objectstack-ai/objectstack#24266). (objectui `c2191654a`)
- **minor** — Publish `optionListDefault` (and its parameter type `OptionListFieldLike`) from the package entry: the reading of an option list's `default: true` that create forms seed from (obj… (objectui `b9e188762`)
- **minor** — Build `@objectstack/*` from objectstack `main` `f4755a68a7` (objectui#12971). (objectui `8aa8e3e1e`)
- **minor** — Two Cloud SDUI widgets are retired: `cloud:onboarding-next`, the Welcome page's next-step block, and `cloud:plan-status`, the pricing page's current-plan marker (objectui#12954).… (objectui `30083da91`)
- **minor** — Every app now has a report index at `/apps/APP/reports` (objectui#13020). It lists the reports the app's package ships, by their localized labels, each linking to its `report/NAME… (objectui `47508f3bb`)
- **minor** — A record page that shows the same unfiltered related list both as a `record:reference_rail` card and in a `page:tabs` count badge now reads that list once on open, not twice. The… (objectui `d0b9648ef`)
- **patch** — Studio's RLS policy editor now gives a predicate the runtime cannot lower the server's verdict: an error that holds Save and autosave (objectui#13061). A `USING` or `CHECK` clause… (objectui `2a75c83b2`)
- **patch** — A master-detail edit form now applies its line rules to the header record however late that record loads (objectui#13062). (objectui `bc98626ed`)
- **patch** — A deep link to an object read by name always leaves the "Opening your console…" splash (objectui#13052). (objectui `1ce071187`)
- **patch** — A kanban card move is announced to screen readers when its write answers, not when the card is dropped (objectui#13054). (objectui `083e80735`)
- **patch** — An `app` page that declares a `record` binding now reads that row, and its components' `visibleWhen` predicates read it as `record` (objectui#12931, the renderer half of objectsta… (objectui `a23a33d6f`)
- **patch** — One page open asks the server for one object document once (objectui#13044). The metadata provider's by-name object read now goes through the adapter's `getObjectSchema`, so the p… (objectui `65fe4c285`)
- **patch** — A record page no longer asks `POST /api/v1/security/explain` for a verdict nothing on screen uses (objectui#13045). (objectui `50ba1bb0a`)
- **patch** — Charts and dataset widgets read their object's metadata through the data source, so the widgets of one dashboard ask for one object's metadata once (objectui#13039). (objectui `988aa9fa1`)
- **patch** — The Undo of an `operation: 'update'` action covers the `patch` of the declared action its `name` names, and no action renderer forwards a page action row's own `patch` (objectui#1… (objectui `61ed5ada6`)
- **patch** — A list view draws a `referenceVia` pointer column's record when its columns do not show the type half (objectui#13036). (objectui `fe11eb12e`)
- **patch** — A record link in an assistant answer opens that record inside the console (objectui#13037). (objectui `633b8f18f`)
- **patch** — The chat's step line no longer shows the agent's tool-loading step, and no longer counts it (objectui#13038). (objectui `912bfd4a6`)
- **patch** — An assistant answer reads well in the narrow assistant panel (objectui#13032). Headings inside a chat answer render at chat size (15–16px, bold, set apart by weight and spacing in… (objectui `6f877f1df`)
- **patch** — The console's pending-approvals read now asks for one page of requests and takes the count from the route's `total` (objectui#13027). (objectui `d14ba9636`)
- **patch** — A record page of a `trackHistory` object reads its audit history when the History tab is shown (objectui#13010). (objectui `acefe6fa6`)
- **patch** — A record page reads its timeline, comments, user list and foot-of-page attachments when they are shown, not on every open (objectui#13010, part 2). (objectui `29c19cc1a`)

⚠️ 1 of these carries a breaking change: 1 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 4 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ fix(ci): read transient jobs-API failures, re-run attempts and stale shards without false reds in the aggregate Test gate (objectui#13064) (#13077) (objectui `90a4fc49b`)
- _(no changeset)_ tooling(pin): keep one pinned @objectstack build per machine and copy it into each new checkout (objectui#12972) (#13035) (objectui `f9401e6af`)
- _(no changeset)_ tooling(pin): commit the pin's packed manifests so a lockfile-only resolution needs no build (objectui#13008) (#13031) (objectui `b014f5eea`)
- _(no changeset)_ tooling: publish computes each @objectstack/* floor from .objectstack-sha (objectui#12958) (#13024) (objectui `4484a1104`)

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, the re-recorded `scripts/sdui-manifest.record.json` and the regenerated
     `sdui.manifest.json`, and the re-recorded `packages/sdui-parser/objectui-lockstep.json`.
     It adds, removes or renames no ObjectStack-authorable key: no Zod shape, no spec
     declaration and no stored `sys_metadata` shape moves in it, so `objectstack migrate meta`
     has nothing here to rewrite, and this body carries no FROM/TO prescription of its own.
     The range carries one objectui change its author annotated breaking, and the digest
     marked it. It is answered against this tree: objectui `a928aaa61` (objectui#13015)
     makes `failures` a required member of `@object-ui/types`' `ImportJobUndoResult`, so a
     custom objectui `DataSource`'s `undoImportJob` answer must carry it, and widens
     `@object-ui/i18n`'s `TranslationKeys` with the `grid.import.undoPartial` family. No
     package in this tree imports or depends on any `@object-ui/*` package, and
     `@objectstack/console` publishes objectui's built SPA and exports no objectui type. The
     route side of that shape is this tree's own: `UndoImportJobResponseSchema` already
     requires `failures`, and `client.data.undoImportJob` already returns it. -->

objectui range: `4016370af3c9...12dc7b47c340`
