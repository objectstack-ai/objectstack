---
"@objectstack/console": minor
---

Console (objectui) refreshed to `b9814b334d8a`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 31 releasing of 35 changesets added across 36 non-merge commits; omitted: 4 release-nothing changesets, 4 commits carrying no changeset (they ship no package code).

- **minor** — Studio's first draft save after opening an item no longer replaces a draft that was saved elsewhere in the meantime (objectui#11773). (objectui `b9814b334`)
- **minor** — An empty list draws its declared link, and a list page's own empty state wins over its source view's (objectui#12270). (objectui `b434f5f47`)
- **minor** — A `record:details` section heading can show how many values a field holds (objectui#12192). (objectui `c08c9332a`)
- **minor** — The console and the runner bundles are built against `@objectstack/*` 18.0.0-next.0 (objectui#12030). In both, the `@objectstack/*` ranges are `devDependencies`, but each package… (objectui `c5406c201`)
- **minor** — The ten locale packs follow `@objectstack/spec` 18's platform capability set (objectui#12030): the key `capability.label.manage_org_presentation` is replaced by `capability.label.… (objectui `c5406c201`)
- **minor** — **BREAKING** — Depend on the `@objectstack/*` 18 prerelease line (objectui#12030). (objectui `c5406c201`)
- **minor** — A report the viewer may not read shows the no-access state, not the server's refusal (objectui#12330). (objectui `2b06a91e6`)
- **minor** — A flow action launched from a list toolbar now resolves the row selection by the same rule as a script action: `@object-ui/core`'s `resolveServerActionRecordId` (objectui#12331).… (objectui `2722d33c5`)
- **minor** — Console writes that landed in silence now say so, and controls disabled on a read-only package say why to every user, not only to a mouse (objectui#12303). (objectui `b64fda3f6`)
- **minor** — A record page draws one provenance footer for its record, whatever the number of `record:details` nodes it carries (objectui#12307). (objectui `28ebfb5f8`)
- **minor** — The marketplace package page offers the install modes a package permits, managed or an unmanaged copy, and reads what the install door answers (objectui#12288, the objectui stage… (objectui `cea429b98`)
- **minor** — Calendar quick-create no longer offers a dialog that cannot succeed. On an object with a required field it cannot fill, an empty-day click opens the full create form with the clic… (objectui `ee470719e`)
- **minor** — A grid's inline-edit save no longer overwrites a concurrent write without a word (objectui#12292). The grid's default row save and "Save All" now send each row's `updated_at` as `… (objectui `3092aca7a`)
- **minor** — The OAuth consent page names the requesting application by its registered name again, and never shows the raw `client_id` in the name's place (objectui#12301). (objectui `ca45c6d55`)
- **minor** — The strict authoring face accepts `dataSource` on `record:related_list` (objectui#12302). The block's renderer has honoured the spec's per-element binding since objectstack#6953:… (objectui `093d55bb6`)
- **minor** — `record:details`, `record:highlights` and `record:quick_actions` honour the per-element `dataSource` binding the spec already declares on every page component (objectui#12294). A… (objectui `82e5f5348`)
- **minor** — `AutoNumberFieldMetadata` declares `autonumberFormat`, typed by reference to `@objectstack/spec`'s `FieldSchema.autonumberFormat`, and keeps `format` as its shorthand (objectui#12… (objectui `fd4872f9e`)
- **minor** — **BREAKING** — `buildValidationRules` stops compiling a field-level `pattern` / `pattern_message` and `validate` (objectui#12242, maintainer ruling A). `@objectstack/spec`'s `FieldSchema` refuse… (objectui `5d3f437ab`)
- **minor** — **BREAKING** — The field metadata types stop declaring the keys a host writes at runtime and the field-level regex keys, and `geolocation` leaves the `FieldMetadata` union (objectui#12242, secon… (objectui `5d3f437ab`)
- **minor** — `@object-ui/fields` exports `fieldHelpText(field)`, the one read of the help line a field draws under its control (objectui#12213). (objectui `5b45c0d50`)
- **minor** — **BREAKING** — A dashboard or report route's breadcrumb no longer carries a 「Dashboards」 or 「Reports」 crumb (objectui#12273, applying the maintainer's ruling on objectstack-ai/cloud#2768, as obj… (objectui `9f282ef53`)
- **patch** — `data-table`: an inline edit made while a row save or Save All is in flight is no longer dropped when the save settles (objectui#12322). (objectui `72594f29e`)
- **patch** — A failed first `connect()` with `autoReconnect` now retries discovery and settles (objectui#12318). The retry used to call `connect()` from inside the attempt it was retrying. `co… (objectui `866763bda`)
- **patch** — Metadata admin detail pages no longer overprint their header on a narrow window (objectui#12306). (objectui `67ca3af91`)
- **patch** — An inline edit in a grid is no longer written to another record when the rows are re-read in a new order (objectui#12310). The table kept each pending edit under its row's positio… (objectui `a8051d654`)
- **patch** — Each app tile in Home's "Your apps" strip is now a link to the app, so an app can be opened in a new tab and its address can be copied (objectui#12305). (objectui `0ffa07605`)
- **patch** — The connection state follows the requests the console already makes, so the header chip now shows a mid-session outage (objectui#12295). (objectui `40cb13b2e`)
- **patch** — The console's Setup › Apps page reports what the server did with a write (objectui#12300). Before, a Delete and a Disable could report success for a write that changed nothing. (objectui `068a5407f`)
- **patch** — Saving a master-detail edit form no longer rewrites the position of lines the user did not touch (objectui#12286). (objectui `f0532d8a8`)
- **patch** — A dashboard header action of type `url`, or of no declared type, now goes through the action runner, like every other header action (objectui#12275). (objectui `74964ad68`)
- **patch** — A flow action whose flow runs straight through, with no screen, now closes with the flow's own `successMessage` when the action declares none (objectui#12274). (objectui `bfca2a2ce`)

⚠️ 4 of these carry a breaking change: 4 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 4 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ docs(ci): retire the four-shard leftovers in AGENTS.md section 9 and two comment sites (#12287) (objectui `157017967`)
- _(no changeset)_ docs(fields): the auto-number page teaches the spec's format tokens, with no quarter token and no hand-written renderer (objectui#12258) (#12280) (objectui `5595aabca`)
- _(no changeset)_ ci(spec-main-shape-gate): drop the merge_group trigger now the context is out of the required set (objectui#12252) (#12262) (objectui `a1a917a08`)
- _(no changeset)_ ci(type-check): the affected speed builds the packages the repo-root setup program imports (objectui#12272) (#12277) (objectui `48fb558d3`)

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, the re-recorded `scripts/sdui-manifest.record.json` and the regenerated
     `sdui.manifest.json`, the re-recorded `packages/sdui-parser/objectui-lockstep.json`,
     the re-measured pin citations in `packages/spec/src`, and the describe and ledger text
     this hop makes true (`EmptyStateSchema.link`, `interfaceConfig.emptyState`, the
     `record:details` section `count` and the `object-grid` `emptyState` member), which carry
     their own `@objectstack/spec` patch changeset. It adds, removes or renames no
     ObjectStack-authorable key: no Zod shape, no spec declaration and no stored
     `sys_metadata` shape moves in it, so `objectstack migrate meta` has nothing here to
     rewrite, and this body carries no FROM/TO prescription of its own.
     The range carries four declared-breaking objectui changes, each by its author's
     breaking annotation and none by a declared `major`, and the digest marked all four.
     Each is answered against this tree:
     (1) objectui#12030 (`c5406c201`): the `@object-ui/*` packages depend on the
     `@objectstack/*` 18 prerelease line. This tree is that line (`@objectstack/spec` and
     `@objectstack/client` are `18.0.0-next.0`, and the console build injects both), and no
     package or example here depends on any `@object-ui/*` package.
     (2) objectui#12242 (`5d3f437ab`), `@object-ui/fields`: `buildValidationRules` stops
     compiling a field-level `pattern` / `pattern_message` / `validate`. `@objectstack/spec`'s
     `FieldSchema` already refuses all three as unrecognized keys, and no example field
     authors any of them.
     (3) objectui#12242 (`5d3f437ab`), `@object-ui/types`: the field metadata types stop
     declaring host-written and field-level regex keys, and `geolocation` leaves the
     `FieldMetadata` union. No package or example here depends on `@object-ui/types`, and none
     declares `type: 'geolocation'`.
     (4) objectui#12273 (`9f282ef53`), `@object-ui/i18n`: the pack keys
     `console.breadcrumb.dashboards` and `console.breadcrumb.reports` are retired. Nothing in
     this tree reads either key.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not a
     per-entry re-measurement of the upstream declared-breaking entries.
-->

objectui range: `1fb1ced36243...b9814b334d8a`
