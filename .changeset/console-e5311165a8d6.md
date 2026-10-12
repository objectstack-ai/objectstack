---
"@objectstack/console": minor
---

Console (objectui) refreshed to `e5311165a8d6`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 21 releasing of 23 changesets added across 24 non-merge commits; omitted: 2 release-nothing changesets, 1 commit carrying no changeset (they ship no package code).

- **minor** — **BREAKING** — Studio and the metadata admin read a metadata type's overlay flag under its new name, `allowEnvironmentOverlay`, and the read-only banners name `OS_METADATA_WRITABLE` (objectui#12… (objectui `e5311165a`)
- **minor** — The marketplace package page's **Update** button opens an update dialog, and a package README's raw HTML is no longer printed as text (objectui#12146). (objectui `82bb1d584`)
- **minor** — **BREAKING** — A form field declares `step` and `className` on both faces, so the strict authoring face stops telling authors to remove two keys that work. A built-in form branch now joins an en… (objectui `d2500d8be`)
- **minor** — "Clone to customize" on a packaged permission set calls the server's clone door (objectui#7611, objectstack ADR-0126 §7.1). (objectui `6d5879fe9`)
- **minor** — **A dashboard or a list view the server refuses you, opened by its URL, now says it was refused** (objectui#12112, the console half of objectstack#22611's ruling A). (objectui `43e150518`)
- **minor** — Setup's "Assigned users" on a permission set writes a new grant by the set's name alone (objectui#7611, after objectstack#22863, ADR-0131 stage 6b-2-pre). (objectui `faf4ce952`)
- **minor** — **BREAKING** — A form field declares `avatarField`, the record field each candidate of the search picker draws its avatar from, on both faces, so the strict authoring face stops telling authors… (objectui `c0c2f792b`)
- **minor** — A `position` decision output lists the position registry and commits position names (objectui#7611, objectstack ADR-0131 D3/D4). (objectui `8cc7158b4`)
- **minor** — The capability select lists the capability registry, and the permission-set editor's provenance badge reads the layered envelope (objectui#7611, objectstack ADR-0131 D3/D7). (objectui `53ee2f854`)
- **minor** — **BREAKING** — A form field declares the rest of the field metadata its widget reads off the `fields[]` entry, on both faces, so the strict authoring face stops telling authors to remove keys th… (objectui `0665c3be7`)
- **minor** — Screen readers hear the names of more controls in the viewer's language (objectui#12145). (objectui `e723f58ee`)
- **minor** — The suggested-bindings panel shows each suggestion's real state and can revoke an acceptance (objectui#7611, after objectstack#22854). (objectui `f962cdc09`)
- **minor** — The record feed and a related list's Add existing and fallback remove read the affordance-to-grant map, so a caller without the grant is no longer offered a write the server then… (objectui `158c75d90`)
- **minor** — A paged table's first, previous, next and last page buttons have accessible names (objectui#12124). (objectui `dc6d28e86`)
- **patch** — The Studio app's root now opens the app's first navigation entry, like every other app's root, and `StudioHomePage`, Studio's old metadata overview, is retired (objectui#12113). (objectui `ed12d48ec`)
- **patch** — A form field's own `defaultValue` is no longer drawn in its control, so the form never shows a value it does not save (objectui#12155). (objectui `f3d540814`)
- **patch** — A grouped grid's own first, previous, next and last page buttons have accessible names (objectui#12143). (objectui `2381c07f3`)
- **patch** — Console rendering fixes from the HotCRM browser pass (objectui#12110): (objectui `5330038f4`)
- **patch** — The record page's discussion shows stored replies under their comment, and every comment offers the reply input where the caller may post one (objectui#12144). (objectui `a7d492011`)
- **patch** — A record activity feed shows an object's `activityMilestones` rows of type `completed`, such as "Case resolved", instead of hiding them as completed tasks (objectui#12106). (objectui `1d1cfe0c1`)
- **patch** — A record-source refusal (`RECORD_SOURCE_REQUIRED`, raised by every arm that requires a record source) now reports the same path every time (objectui#5250). (objectui `9b7550999`)

⚠️ 4 of these carry a breaking change: 4 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 1 commit in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared it, so it appears in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ feat(scripts): the JSON-fence gate reads the published READMEs (objectui#12131, phase 2) (#12139) (objectui `ce9811c96`)

<!-- adr-0087: not-required (no-migration-prescription)
     This console changeset moves `.objectui-sha` and the artefacts that travel with it: the
     re-recorded `scripts/sdui-manifest.record.json` and the regenerated `sdui.manifest.json`
     (107 components; one input description changed, the record activity feed's
     `showCompleted` (objectui#12106), and no component, input, type or required flag moved),
     the re-recorded `packages/sdui-parser/objectui-lockstep.json` (its grammar region,
     diagnostic codes and containment predicate are unchanged across the range) and the
     re-measured pin citations in `packages/spec/src`, which carry their own
     `@objectstack/spec` patch changeset. It adds, removes or renames no ObjectStack-authorable
     key of its own. The one ObjectStack rename this pin follows,
     `MetadataTypeRegistryEntry.allowOrgOverride` to `allowEnvironmentOverlay` and the
     `GET /meta/types` field with it, is this same diff's: its FROM/TO prescription and its
     `registered metadata-type-registry-allow-org-override-renamed` disposition live in
     `.changeset/22340-registry-allow-environment-overlay.md`, so this body carries no FROM/TO
     prescription of its own.
     The range carries four declared-breaking objectui changes, each by its author's breaking
     annotation and none by a declared `major`. Each is answered here:
     (1) objectui#12141 (`e5311165a`): `@object-ui/app-shell`'s `RichMetadataTypeEntry` and
     `resolveResourceConfig` read `allowEnvironmentOverlay` in place of `allowOrgOverride`,
     with no dual read. It is the console half of this diff's own rename and reads the one
     name this diff's `GET /meta/types` writes, on both of its arms; it is why this pin and
     that rename land together.
     (2) objectui#12130 (`d2500d8be`): objectui's form-field type declares `step` as the
     spec's number and `className` as a string, so its tolerant face refuses `step: 'any'`.
     objectui's own authoring face; `@objectstack/spec` declares and moves nothing here.
     (3) objectui#12130 (`c0c2f792b`): objectui's form-field type declares `avatarField`, and
     its tolerant face refuses a non-string value. objectui's own face; no ObjectStack key.
     (4) objectui#12130 (`0665c3be7`): objectui's form-field type declares the field-metadata
     keys its widgets read off a `fields[]` entry, by reference to `@objectstack/spec`'s
     `FieldSchema` members, with value checks on its tolerant face. objectui's own face; the
     spec members it references do not move.
     No commit subject in the range carries `!`. Scope of the claim, stated rather than
     implied: it is a claim about THIS diff, not a per-entry re-measurement of the upstream
     declared-breaking entries. -->

objectui range: `4997995022f8...e5311165a8d6`
