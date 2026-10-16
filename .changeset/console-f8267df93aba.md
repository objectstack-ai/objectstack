---
"@objectstack/console": minor
---

Console (objectui) refreshed to `f8267df93aba`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 46 releasing of 46 changesets added across 40 non-merge commits; omitted: 3 commits carrying no changeset (they ship no package code).

- **minor** — **BREAKING** — The page renderer no longer compiles a `kind: 'jsx'` page node as `html`. This completes the retirement of the page kind `jsx` that `@objectstack/spec` 18 made (objectstack-ai/obj… (objectui `f8267df93`)
- **minor** — The page schemas no longer import or attach `@objectstack/spec`'s page-parse judge of a view-data component's retired `api` binding, which objectstack#23784 removed from the spec… (objectui `15d8ca6da`)
- **minor** — Home: "Recently accessed" brings you back to the records and list views you opened, beside the activity feed (objectui#12604). (objectui `f0e760afe`)
- **minor** — The details grid passes a pointer field's `referenceDeletedWhen` to `resolveRecordPointer` (objectui#12489). (objectui `023087f63`)
- **minor** — The record details grid draws a platform-deleted pointer target as a tombstone in the declared option's label (objectui#12489). (objectui `023087f63`)
- **minor** — `resolveRecordPointer` reads `referenceDeletedWhen`, so a pointer pair can say the platform deleted its target (objectui#12489). (objectui `023087f63`)
- **minor** — The console top bar is 48 px (`h-12`) in every frame, the height both approved console artboards draw (objectui#12639). It was 56 px (`h-14`). (objectui `dcd104102`)
- **minor** — List grids show the record a pointer field names, and the Approvals Inbox says who else is waiting (objectui#12608). (objectui `f78efdd1e`)
- **minor** — Locale keys for the console home's "My work" section (objectui#12602), in all ten packs. (objectui `db8ce2f41`)
- **minor** — The console home's "Needs your attention" card becomes the "My work" section of the approved home artboard (objectui#12602), and the pending-drafts banner above the greeting moves… (objectui `db8ce2f41`)
- **minor** — Resolve `@objectstack/*` `18.0.0-next.2` (objectui#12626). (objectui `f62b6ff4e`)
- **minor** — A kanban under a list view puts every record of the view in its column, not the list's first page, and its cards carry the view's first columns (objectui#12619). (objectui `8614705c1`)
- **minor** — **BREAKING** — `page:header` no longer reads `showStar`, ahead of `@objectstack/spec` 18 retiring the key (objectstack#23650). (objectui `608033b82`)
- **minor** — The console home's top half follows the approved home artboard (objectui#12601): a search field in the top bar, a greeting with a one-line work summary, two compact builder chips,… (objectui `6c4d00da0`)
- **minor** — `DefaultLoginPage` passes the translated names of `LoginForm`'s new password reveal toggle, `auth.login.showPasswordText` and `auth.login.hidePasswordText` (objectui#12600). It ke… (objectui `8ed7e5a8f`)
- **minor** — `LoginForm` gains an optional `hideHeader` prop and a password reveal toggle, and the shared auth form styles take the console login artboard's sizes (objectui#12600). (objectui `8ed7e5a8f`)
- **minor** — The console's login page follows the approved "refined centred" artboard (objectui#12600). (objectui `8ed7e5a8f`)
- **minor** — New `auth.login` strings for the console login page, in all ten language packs (objectui#12600): `welcomeTitle`, `welcomeDescription`, `showPasswordText`, `hidePasswordText`, `foo… (objectui `8ed7e5a8f`)
- **minor** — Every wide centred dialog keeps a 1rem gutter on each side of the window from `sm` (640px) up, by one shared class (objectui#12603). (objectui `726d8c9fc`)
- **minor** — A grouped grid now draws one table with one sticky column header. Each group is a 36 px band row between the rows: a chevron, the group value and its count, in one cell that spans… (objectui `619e3f7a4`)
- **minor** — The Studio's Publish and Changes buttons no longer open the pending-changes sheet the same way. (objectui `92c2a6976`)
- **minor** — **A record dialog with no authored layout opens bounded, and draws two fields per row wherever no `columns` is declared** (objectui#12521). Three defaults of `ModalForm` change. N… (objectui `7b5e55893`)
- **minor** — **BREAKING** — The console's list toolbar no longer has a write into the shared view, and the data-source method that write used is retired (objectui#12504). (objectui `3eb3ec138`)
- **minor** — Studio's Add field asks for the label and type before it creates the field, and the field type picker also searches descriptions (objectui#12516). (objectui `1b3b5b102`)
- **patch** — Action-param and bulk-action dialogs draw `date` and `datetime` params with the platform date picker, the same face record forms draw since objectui#12622 (objectui#12642). (objectui `c6b7d8203`)
- **patch** — The cloud-connection panel's "Not connected" card no longer repeats the page subtitle (objectui#12655). (objectui `efa9cb4fa`)
- **patch** — Record page sections: a collapsible section's header is now a real button named by the section title (objectui#12625). It carries `aria-expanded`, is reachable by Tab, and Enter o… (objectui `4be76e030`)
- **patch** — Studio's permission-set editor no longer offers the two delegated-admin switches that `@objectstack/spec` 18 retired (objectui#12406, the objectui half of objectstack#23488). (objectui `a98a23c78`)
- **patch** — Inside an app, the product mark stays in the top bar as the way home, and the app menu gains Back to home, All apps and Settings (objectui#12605). (objectui `a5bb7ac2f`)
- **patch** — Setup › Packaged automation keeps a flow row to the table's height when the platform says why the flow is not armed (objectui#12609). (objectui `8a8bcf3dd`)
- **patch** — Record forms draw `date` and `datetime` fields with the platform date picker instead of the browser's native date input (objectui#12622). (objectui `ca7a4c316`)
- **patch** — The record header draws one primary action and the rest as secondary buttons (objectui#12617). (objectui `ef71a09f9`)
- **patch** — **`marketplace.installedAdditiveNote` is plain text in all ten packs** (objectui#12610). Each value dropped its leading `<strong>Note:</strong>` markup (in that pack's language);… (objectui `f74638c1b`)
- **patch** — **Installed Apps' kernel note is the tooltip of the Uninstall it qualifies** (objectui#12610). The "kernel API is additive only" note was a paragraph at the foot of the list, show… (objectui `f74638c1b`)
- **patch** — **A settings action row draws its label once, on the button** (objectui#12610). The settings renderer's `action_button` row printed the manifest's `label` as the row label and aga… (objectui `f74638c1b`)
- **patch** — Marketplace cards show the whole app name, and the id keeps its package name (objectui#12616). (objectui `07b063249`)
- **patch** — Studio at a narrow width keeps the words that matter readable (objectui#12611). (objectui `a8560b228`)
- **patch** — The list toolbar's Display menu now closes once a layout is chosen (segmented or dropdown switcher), returning focus to the Display button, as Escape already does; the panel's tog… (objectui `79c199692`)
- **patch** — The Studio's Automations rail orders its object groups the way the package's app presents its objects (objectui#12612). The groups used to follow the alphabet of the object labels… (objectui `0a41305b0`)
- **patch** — Metric tiles keep their title readable in narrow tiles. The title now owns the first line (up to two lines, with an ellipsis on the second), the value never wraps and steps down o… (objectui `63d00da3d`)
- **patch** — The pending-changes sheet no longer lists the package stamp as one of the author's own changes (objectui#12594). Expanding a new object draft showed `_packageId` under "Also chang… (objectui `33fbc861d`)
- **patch** — An `lg` or `xl` `ModalForm` dialog keeps a 1rem gutter on each side of the window from `sm` (640px) up (objectui#12593). (objectui `85e8961f2`)
- **patch** — A boolean cell's read-only checkbox is named by its field (objectui#12584). (objectui `7d0c174ba`)
- **patch** — Studio's way home leads back to the Studio landing, and the two links that leave for Setup say so (objectui#12513). (objectui `f5eec6383`)
- **patch** — **The console's New and Edit dialog on a field-heavy object opens bounded on desktop** (objectui#12521). For an object with twelve or more authorable fields, `@objectstack/spec`'s… (objectui `7b5e55893`)
- **patch** — Studio: the draft status chip sits in the same place in every pillar's item header (objectui#12524). "Unpublished draft" in Data, Automations and Interfaces, and Access's "saved a… (objectui `ae923ece2`)

⚠️ 3 of these carry a breaking change: 3 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 3 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ fix(live-e2e): the backend cold install writes overrides.vitest so npm 10 can install the published graph (objectui#12649) (#12674) (objectui `d66ceea5a`)
- _(no changeset)_ docs(skills): point two published member counts at their declarations instead of numbers (objectui#12588) (#12591) (objectui `8415d9f11`)
- _(no changeset)_ ci: delete the spec-main-shape-gate copy, the spec shape gate runs in objectstack (objectui#12352) (#12596) (objectui `c6a42be39`)

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, the re-recorded `scripts/sdui-manifest.record.json` and the regenerated
     `sdui.manifest.json`, and the re-recorded `packages/sdui-parser/objectui-lockstep.json`.
     It adds, removes or renames no ObjectStack-authorable key: no Zod shape, no spec
     declaration and no stored `sys_metadata` shape moves in it, so `objectstack migrate meta`
     has nothing here to rewrite, and this body carries no FROM/TO prescription of its own.
     The range carries three objectui changes their authors annotated breaking, and the
     digest marked all three. Each is answered against this tree:
     (1) objectui#12486 (`f8267df93`), `@object-ui/types`: `PageNodeSchema.kind` drops `jsx`
     and the page renderer stops compiling it as `html`. `@objectstack/spec` here already
     refuses page `kind: 'jsx'` at parse (`packages/spec/src/ui/page.zod.ts`), so no page
     this tree accepts reaches that arm.
     (2) objectui#12627 (`608033b82`), `@object-ui/components`: `page:header` stops reading
     `showStar`. `@objectstack/spec` here already retires the key; its conversion is the
     registered `page.component.page:header.showStar` entry in
     `packages/spec/src/conversions/registry.ts`.
     (3) objectui#12504 (`3eb3ec138`), `@object-ui/types` and `@object-ui/data-objectstack`:
     `DataSource.updateViewConfig` and its capability gate are removed. No package or example
     here depends on any `@object-ui/*` package; the name survives in this tree only in two
     test comments and one checklist step, none of which calls it.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not a
     per-entry re-measurement of the upstream declared-breaking entries.
-->

objectui range: `daeb77fc84dd...f8267df93aba`
