---
"@objectstack/console": minor
---

Console (objectui) refreshed to `6314e87f2d49`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 27 releasing of 30 changesets added across 43 non-merge commits; omitted: 3 release-nothing changesets, 14 commits carrying no changeset (they ship no package code).

- **minor** — **BREAKING** — Retire the `global_nav` Studio designer surfaces, and track the `@objectstack` family at `17.0.0-rc.6` (objectstack#7100 / objectstack#6888). (objectui `38ab5054f`)
- **minor** — One fullscreen long-text editor, hoisted to the package both render paths may import (objectui `cb1340058`)
- **minor** — i18n: retire the orphaned `report.editor.*` namespace — 105 of its 106 keys, in all ten locale packs (~1050 translated strings) (objectui `fa511094a`)
- **minor** — `/accept-invitation/:invitationId` is one route, one component, one namespace — the console now renders the invitation page that actually shows you the invitation (objectui `0e67b53ff`)
- **patch** — Inline-editing an `address` on the record detail page now edits it as real sub-fields, instead of collapsing it to one text box reading `[Object]` and saving a string over the str… (objectui `6314e87f2`)
- **patch** — An image field's declared `maxSize` is enforced before the upload starts, not after it finishes (objectui `433ff9fd3`)
- **patch** — A `Field.address` value now reads as a formatted postal address on the record detail page, instead of stringified JSON. (objectui `e2e6360c2`)
- **patch** — Renaming a freshly-created view now persists — `updateView` reads and writes the same row, instead of reading the published overlay and losing the edit into a rejected partial wri… (objectui `b42558a4c`)
- **patch** — Using a list's filter panel no longer overwrites the view's source-declared `filter` for everyone (objectui `f8595a054`)
- **patch** — A list emptied by the view's own filter says "no records match", instead of inviting you to create your first record (objectui `f8595a054`)
- **patch** — An illegal gantt dependency link now says why it was refused, instead of doing nothing (objectui `e1ade8f03`)
- **patch** — The gantt's conflict dialog shows the number of affected tasks again, not a literal `{2}` (objectui `828549a9a`)
- **patch** — An action rendered in the overflow menu, as an icon or inside a group now reaches the runner carrying the same authored keys as the same action rendered inline — `action:menu`, `a… (objectui `d6e5124a3`)
- **patch** — A rejected Kanban drag rolls the card back on both data ownerships, not just when the board owns its own records (objectui `2c8ad7cdb`)
- **patch** — ObjectGrid's bulk-bar **Clear** now unticks the row checkboxes, instead of only removing the toolbar (objectui `51ab34e34`)
- **patch** — Conditional required (`requiredWhen`) now decides at SUBMIT time too — the star and the validator can no longer disagree (objectui `b1e42d09b`)
- **patch** — fix(app-shell): the top-bar bell polls the inbox on every console surface, not only inside an app (#4110) (objectui `7b0783232`)
- **patch** — An `autoTrigger` action that spills past `action:bar`'s `maxVisible` now still runs — `action:menu` consumes the flag instead of dropping it. (objectui `debad2796`)
- **patch** — The first-run setup wizard no longer drops a brand-new owner outside the console (objectui `1f34b3825`)
- **patch** — The AI build conversation no longer blanks itself the moment the preview opens (objectui `e16fd9597`)
- **patch** — `features.passkeys` and `features.magicLink` are documented as reserved, so enabling them no longer implies a login-page entry point that does not exist (objectui `564252cd8`)
- **patch** — `/setup` is a real address again — the console gets a stable deep link into platform administration instead of bouncing you back to home (objectui `b3f665b49`)
- **patch** — `?runAction=create_environment` is no longer consumed when the environments toolbar has no create action to run it on. (objectui `bf2fd3d1f`)
- **patch** — The build-history panel tells an operator a 503 means "the commit store could not be reached — retry", instead of `commits HTTP 503` (objectui `f7c6430ec`)
- **patch** — Stop the report config panel being titled "Title", and the view-settings colour section "Color" (objectui `ff84b0523`)
- **patch** — Fail when a `t()` call site's arguments are not the holes its `en` value has, and delete the three that were inert (objectui `5f40de7d4`)
- **patch** — `DatasetWidget`'s option-color / dimension-label probe now rides the host's authenticated fetch (`SchemaRendererContext.apiFetch`) instead of the bare global `fetch`. (objectui `ee7a68d2d`)

⚠️ 1 of these carries a breaking change: 1 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 14 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ fix(editor,markdown): complete the vite alias tables so the per-package test task resolves (#4218) (objectui `a9a67ec5b`)
- _(no changeset)_ ci(turbo): derive the `lint` and `build` inputs guards from each package's real program (#4184, #4185) (#4200) (objectui `a5b1b8917`)
- _(no changeset)_ ci(turbo): derive the test inputs guard from each package's Vitest config program (#4178) (#4188) (objectui `2b9428338`)
- _(no changeset)_ ci(turbo): derive the type-check inputs guard from each package's tsc program (#3514) (#4176) (objectui `eb5f8cea0`)
- _(no changeset)_ docs(ci): pin the 'can never be required, structurally' bullet to the YAML it quotes (#4170) (#4175) (objectui `c27c8981f`)
- _(no changeset)_ ci(shadcn): close the three declared alarm-channel gaps (#3586) (#4174) (objectui `e63853173`)
- _(no changeset)_ docs(links): scan the app READMEs and the rest of the repo root (#4148) (#4173) (objectui `da8109300`)
- _(no changeset)_ chore(site): ignore the AGENTS.md/CLAUDE.md that `next dev` mints, and turn the minting off (#4172) (objectui `0ead48368`)
- _(no changeset)_ docs(ci): stop the Merge Queue section keeping its own copy of the subscriber list (#4154) (#4171) (objectui `6eb40b8d7`)
- _(no changeset)_ docs: repair QUICK_REFERENCE's dead commands and layout claims, and pin them (#4149) (#4159) (objectui `521a37bd0`)
- _(no changeset)_ docs(ci): drop the fourth hand-copy of the object-ui ratchet list, and gate the page (#3782) (#4153) (objectui `492223d9a`)
- _(no changeset)_ docs: repair and pin QUICK_REFERENCE's Current Release block, drop the console README's hand-written versions (#4143) (#4150) (objectui `43b2e4565`)
- _(no changeset)_ docs: drop the hardcoded package versions from the utilities pages and correct the data-objectstack README install line (#4125, #4130) (#4144) (objectui `d86d372ad`)
- _(no changeset)_ docs(console-starter): correct the 'Without a backend' root-route paragraph (#4102) (#4142) (objectui `148ade326`)

<!-- adr-0087: not-required (already-registered action-global-nav-location-removed) The one breaking entry in this range is objectui#4169, which drops the Studio designer surfaces for the `global_nav` action location. The spec-side retirement of that enum value landed in this repo with objectstack#7100 / #6888 and is already on the ledger as the conversion `action-global-nav-location-removed` (packages/spec/src/conversions/registry.ts) plus its protocol-17 semantic entry; this pin bump ships the console catching up to that decision and changes no spec surface of its own, so it registers nothing new. -->

objectui range: `92c0b1f403f7...6314e87f2d49`
