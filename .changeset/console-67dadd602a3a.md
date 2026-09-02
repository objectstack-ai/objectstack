---
"@objectstack/console": minor
---

Console (objectui) refreshed to `67dadd602a3a`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 16 releasing of 24 changesets added across 24 non-merge commits; omitted: 8 release-nothing changesets (they ship no package code).

- **minor** — A grouped grid now says, where the group counts are, that it grouped a **page** (objectui#7189). (objectui `8952395b4`)
- **minor** — **Breaking for authored metadata:** `DataTableSchema.toolbar` is RETIRED (objectui#6881, maintainer ruling 2026-08-31). A `data-table` node that authors `toolbar` no longer valida… (objectui `3561bd2ca`)
- **minor** — Retire `ChartDataSeries.data`, and correct `ChartSchema.categories`' prose to the read it has always had (objectui#6896, ADR-0049 enforce-or-remove; maintainer ruling 2026-08-31). (objectui `b0d308da9`)
- **minor** — **BREAKING** — Retire the form-view section `className` / `gridClassName` reads (objectstack#13626, maintainer ruling 2026-09-01, director decision batch C). (objectui `9c7490268`)
- **minor** — `page:header` resolves its `actions` as declared ACTION IDS (objectui#6252, implementing the objectstack#11592 ruling — maintainer, 2026-08-25, on recommendation B). (objectui `8ec11e14f`)
- **patch** — FLS-gate the `$expand` projection at both build sites (objectui#7215). (objectui `67dadd602`)
- **patch** — Gantt toolbar: the period label names the visible window, and the prev/next buttons step it (objectui#7203). (objectui `231d1b93c`)
- **patch** — fix(app-shell,plugin-list): a list view's own `description` now reaches the screen (objectui `f626808d4`)
- **patch** — A gantt list view no longer shows the record-count bar, because the bar describes a request that view does not draw (objectui#7210, half 1). (objectui `5015fcf52`)
- **patch** — Fix: a grid grouped by a field it does not also show as a column no longer collapses every row into one `(empty)` group (objectui#7179). (objectui `a6d8b8d44`)
- **patch** — Stop shipping `dist/__tests__/numberInputBrowserReadings.d.ts` in the published tarball (objectui#6943). `packages/fields/tsconfig.json` now excludes the tooling DIRECTORIES (`__t… (objectui `39d69ad53`)
- **patch** — Scatter now says when it cannot place a row, instead of drawing an empty axis. (objectui `93bbc2055`)
- **patch** — Fix: a `dependsOn` lookup column is no longer permanently uneditable in an editable `ObjectGrid`. (objectui `84ffdbcbb`)
- **patch** — `ObjectGrid` no longer copies `descriptionField`, `lookupColumns` or `lookupFilters` onto a relational column's `fieldMeta` (objectui#7166). No behaviour change — all three still… (objectui `a276480b7`)
- **patch** — `RecordComments` and `PointInTimeRestore` resolve their copy from the locale packs instead of hardcoded English (objectui#7163). (objectui `866cd1d3f`)
- **patch** — Pie, donut, funnel and treemap now say when rows carry no magnitude they can draw. (objectui `5eddeeb68`)

⚠️ 2 of these carry a breaking change: 2 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

<!-- adr-0087: not-required (no-migration-prescription) Both declared-breaking entries in this range are retirements inside objectui's OWN npm packages, judged one at a time against their upstream changesets rather than as a batch. objectui `3561bd2ca` (objectui#6881) retires `DataTableSchema.toolbar` in `@object-ui/types` — a key on the SDUI `data-table` component node that the `data-table` renderer never read (declared on both published faces, mounted by nothing), now refused at parse time with a remediation. `@objectstack/spec` declares no `data-table` node schema at all (re-measured at this HEAD: zero hits for `data-table` / `DataTable` across `packages/spec/src/**/*.zod.ts`), so the key was never an ObjectStack-authorable metadata key and no stored `sys_metadata` row can carry it. objectui `9c7490268` (objectstack#13626, maintainer ruling 2026-09-01) stops `@object-ui/plugin-form` reading `className` / `gridClassName` off a form-view SECTION through `as any` casts. Those two keys sit on the SDUI-only side of the authorable boundary by this repo's own decision: `packages/spec/src/ui/component.zod.ts` deliberately does not declare `className` on props bags, `gridClassName` has zero hits anywhere under `packages/spec/src` (re-measured at this HEAD), and the authorable-surface ledger carries no entry for either — so the change is a RENDERER ceasing to consume keys the spec never admitted, in the direction the boundary already pointed; the upstream census found zero authored uses across the objectstack, objectui and hotcrm corpora. Neither is reachable through `@objectstack/console` in any case, re-measured against `packages/console/package.json` at this HEAD: it publishes a frozen prebuilt SPA whose `files` list is `["dist", "README.md", "CHANGELOG.md"]` and whose sole `exports` entry is `./package.json`, so it forwards no `@object-ui/*` module entry point and re-exports none of these types. This diff is `.objectui-sha` plus this changeset and nothing else — no `packages/spec` schema, authorable metadata key or protocol surface changes in it — so there is no stored-metadata rewrite for `objectstack migrate meta` to prescribe and therefore no ADR-0087 ledger entry to write or to name from THIS bump. This bump adds no ledger entry and claims none. -->

objectui range: `d8ec8d6d4f01...67dadd602a3a`
