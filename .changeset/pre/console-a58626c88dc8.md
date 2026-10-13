---
"@objectstack/console": minor
---

Console (objectui) refreshed to `a58626c88dc8`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 36 releasing of 36 changesets added across 36 non-merge commits.

- **minor** — The timeline's unused "Overdue" bucket label is removed: `timeline.bucket.overdue` is gone from all ten language packs and from the timeline's built-in English defaults (objectui#… (objectui `c910630cf`)
- **minor** — **BREAKING** — Inside a dashboard widget's legacy `component` envelope, a `metric-card` is now judged by the slot's component arm alone, so every key that arm refuses is refused there too, with… (objectui `89cc738da`)
- **minor** — **BREAKING** — "Recently Accessed" shows each item's own label, in the current language, and a visit that does not change the list no longer writes the `ui.recent` preference (objectui#11678). (objectui `48c82c9d5`)
- **minor** — The calendar and the timeline start the week on the first day of the week of the user's locale (objectui#11675), instead of a fixed Sunday (calendar) and a fixed Monday (timeline)… (objectui `9ca3cacbe`)
- **minor** — The console's settings pages resolve icons through the shared `getLazyIcon` helper and no longer log `[lucide-react]: Name in Lucide DynamicIcon not found` (objectui#11679). (objectui `abd374bb2`)
- **minor** — `DefaultLoginPage` and `DefaultRegisterPage` offer a generic sign-up only where the server would accept one (objectui#11705). Under the default `invite_only` audience posture the… (objectui `7e2d5b0ee`)
- **minor** — Objects with a picklist-bound field save again from the OWD overview, the Setup fields and objects pages, the metadata-admin embedded-item editor, and `MetadataService.saveFields`… (objectui `da3545375`)
- **minor** — The keyboard-shortcuts dialog (`?`) lists only shortcuts that do something (objectui#11674). (objectui `de96f3d0c`)
- **minor** — **BREAKING** — A `metric-card` placed in a dashboard's widget slot refuses `label` by name and points at `title`, the key its heading is drawn from (objectui#4425). (objectui `eb4552e71`)
- **minor** — The console's login and register pages offer a generic sign-up only where the server would accept one (objectui#11691). `/api/v1/auth/config` states the sign-up rule as two keys,… (objectui `daa7caff4`)
- **minor** — An object-bound timeline no longer heads every past date "Overdue": a day before today goes under a neutral "Earlier" bucket, translated in every language (objectui#11676). (objectui `ce464d958`)
- **minor** — Studio reads shared picklists: a select field can use one, an object with a picklist-bound field saves again, and the picklist page is read-only (objectui#10202, the objectui half… (objectui `c3623eb11`)
- **minor** — The AI chat's tool-approval card and its "Open in Builder" handoff card are translated in every language (objectui#11667). (objectui `57d82cb34`)
- **minor** — The chat launchers show a marker while a proposed plan awaits the user's approval (objectui#11666, item 6 of objectui#2458). A user who closed the chat with a blueprint still wait… (objectui `848ba0e12`)
- **minor** — Five fixes on the AI build surface, from the 2026-10-05 cloud acceptance run (objectui#11658). (objectui `fc3c2cc1c`)
- **minor** — `action:group` and `action:menu` no longer read a member's `properties.params` (objectui#11638). A container member's `properties.params` no longer reaches the action runner. (objectui `73b5d7764`)
- **minor** — `LoginForm` shows its "Don't have an account? Sign up" row only when the caller passes `registerUrl` (objectui#11634). The prop used to default to `'/register'`, so a caller that… (objectui `f1a177c41`)
- **minor** — A field group's `visibleWhen` now gates its section on the record detail page, the same way it gates the section on the entry form (objectui#11630). Take an object whose `fieldGro… (objectui `76993f8ef`)
- **patch** — fix(plugin-tree): tree cells draw the same field faces as list cells, so a boolean no longer shows as `true` (objectui#11686) (objectui `a58626c88`)
- **patch** — **The record header's highlight chips share the row's free width and truncate only when it runs out (objectui#11684).** A Product with SKU "QA Widget 1" read "QA Wid…" in the reco… (objectui `7300fcafe`)
- **patch** — An authored `view:calendar` or `view:timeline` node loads its plugin and renders the calendar or the timeline, and a console boot no longer logs the registry's race warning for th… (objectui `e6dcd85cc`)
- **patch** — The approvals inbox's request drawer shows its record summary the way the record page shows the record (objectui#11677). (objectui `3409fe89e`)
- **patch** — The flow designer saves a screen field's `Min` and `Max` as numbers (objectui#11664). (objectui `5ba255538`)
- **patch** — The metric cards no longer write authored keys they do not read onto the page (objectui#4425). Rendered through `SchemaRenderer`, which is how every dashboard draws its KPI tiles… (objectui `a600924f2`)
- **patch** — Console, record page and Studio copy from the 2026-10-05 cloud acceptance run (objectui#11659). (objectui `f9f4a62d5`)
- **patch** — The flow designer's SLA escalation switch on an approval node no longer writes a refused `escalation: { enabled: false }` block, and switching it off keeps the values the author e… (objectui `9f3ed7bca`)
- **patch** — Cancelling a background import shows the rows the server already committed, with Undo (objectui#11650). `ImportWizard`'s Cancel used to show "Import cancelled · 0 imported" withou… (objectui `846f98251`)
- **patch** — Drag-to-reorder works on a grouped sidebar menu, within each level (objectui#11626). `NavigationRenderer` had a sortable path only in its group-free arm. Every stock app's menu is… (objectui `b88937b65`)
- **patch** — The `object-kanban` board totals the view's `summarizeField` in each column header (objectui#11629). (objectui `f4370f426`)
- **patch** — On an object that declares no list view, a grid toolbar change no longer sends a save the door refuses (objectui#11643). Such an object opens on the "All Records" tab the console… (objectui `43671468d`)
- **patch** — The console's `/verify-email?token=…` page verifies the address again (objectui#11633). It used to send the token as `POST /api/v1/auth/verify-email` with a JSON body. better-auth… (objectui `8057a8b14`)
- **patch** — On a runtime with no marketplace that still mounts install-local (an offline boot, `OS_CLOUD_URL=off`), a local install's Details page now offers its local menu: re-seed sample da… (objectui `0baf86f1b`)
- **patch** — A dataset-bound dashboard widget names its comparison window from `compareTo.kind` (objectui#11632). `previousPeriod` reads "vs previous period" and `previousYear` reads "vs last… (objectui `e398a54f0`)
- **patch** — Two grid toolbar changes to one view in one session now both survive a reload (objectui#11642). Before, the second change overwrote the first: changing density and then sorting by… (objectui `531b26c8f`)
- **patch** — A lookup whose `dependsOn` names a parent field drops its selection when that parent changes or is cleared (objectui#11631). (objectui `c00039842`)
- **patch** — A grid toolbar change on a served view is stored where the save door keeps it, so it survives a reload (objectui#11625). This covers density, a column-header sort and the hide-fie… (objectui `59917c4b2`)

⚠️ 3 of these carry a breaking change: 3 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, the regenerated `sdui.manifest.json` and its record
     `scripts/sdui-manifest.record.json`, the re-recorded
     `packages/sdui-parser/objectui-lockstep.json` (objectui's `packages/sdui-parser/src` is
     byte-identical across the range) and the re-measured pin citations in `packages/spec/src`,
     which carry their own `@objectstack/spec` patch changeset. It adds, removes or renames no
     ObjectStack-authorable key: no Zod schema, no spec declaration and no stored
     `sys_metadata` shape moves in it, so `objectstack migrate meta` has nothing here to
     rewrite, and this body carries no FROM/TO prescription of its own.
     The range carries three declared-breaking objectui changes, each by its author's
     breaking annotation and none by a declared `major`. Each is objectui's own package
     surface, with its upstream record, and each is answered here:
     (1) objectui#4425 (`eb4552e71`) and (2) objectui#11709 (`89cc738da`): objectui's
     `@object-ui/types` faces refuse `label` on a `metric-card` in an objectui `dashboard`
     node's `widgets[]` slot, and judge a `metric-card` inside a widget's legacy `component`
     envelope by the slot's component arm alone. `metric-card` is objectui's own node type:
     it is neither a member of `@objectstack/spec`'s `PageComponentType` nor a
     `ComponentPropsMap` row, the ObjectStack dashboard widget's `type` vocabulary is the
     chart types (`metric`, `kpi` and the rest), no example or package source in this
     repository authors a `metric-card` node, and the regenerated `sdui.manifest.json`
     carries no `metric-card` entry.
     (3) objectui#11678 (`48c82c9d5`): `@object-ui/app-shell`'s `RecentItem` becomes a
     union, and `addRecentItem` stops taking a label for an object, dashboard, page or
     report entry. No code in this repository imports `@object-ui/app-shell`, and the only
     code here that names the `ui.recent` preference is the SQL driver's tests, which store
     that row as an opaque value. Lists stored in the old shape are read by identity
     upstream, so no stored row has to change.
     Where an entry mirrors an ObjectStack key, the ledger entry belongs to the
     `packages/spec` PR that lands it, never to the pin bump.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not a
     per-entry re-measurement of the upstream declared-breaking entries.
-->

objectui range: `0abd4f9f8769...a58626c88dc8`
