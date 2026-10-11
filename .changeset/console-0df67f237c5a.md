---
"@objectstack/console": minor
---

Console (objectui) refreshed to `0df67f237c5a`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 28 releasing of 29 changesets added across 21 non-merge commits; omitted: 1 release-nothing changeset, 1 commit carrying no changeset (they ship no package code).

- **minor** — The Setup catalog for positions and permission sets reads the registry. It is built from the metadata-admin list and editors in their environment scope, not from new pages (object… (objectui `0df67f237`)
- **minor** — A bulk action's field-backed param now renders its real control on the selection bar, and the confirm step names the picked record (objectui#12105). (objectui `29b994902`)
- **minor** — A create form says when the server will fill a field: "Set automatically when saved." under a field whose `defaultValue` the server resolves at insert, while the field is empty (o… (objectui `b7cd5c891`)
- **minor** — A calendar view in a list draws every record of the days it shows, not the first 100 records of the object (objectui#12081 item 2). (objectui `16c8810ac`)
- **minor** — In-place edit on the record page and a list's in-cell edit honour the caller's field write grant, and the owner field honours the transfer grant (objectui#12103). (objectui `5f75cfad1`)
- **minor** — List views read an absent `userActions.editInline` as on, the v18 protocol default (objectui#12086, the consumer half of objectstack#22605). A list view is editable in place by de… (objectui `5330afd1f`)
- **minor** — Five write affordances that read no grant at all now read the affordance-to-grant map, so a caller without the grant is no longer offered a write the server then refuses (objectui… (objectui `5af42dbbd`)
- **minor** — After a marketplace install into the environment the console is rendering, the package page waits until that environment serves the installed package's app, and only then refreshe… (objectui `3c0f8069e`)
- **minor** — `element:repeater` and `element:number` publish the node-level `dataSource` binding as their only query input (objectui#12085). `@objectstack/spec` retires the element layer's fla… (objectui `ce991bd70`)
- **minor** — A create form asks its fields the create question, so a role that may create records but not edit them can fill and submit the form (objectui#12082). Every console affordance that… (objectui `023f00d46`)
- **minor** — **BREAKING** — The row type of the `VersionHistory` timeline is declared as `VersionHistoryEntry` instead of `VersionEntry` (objectui#6349, batch 10). `@object-ui/collaboration` publishes an unr… (objectui `12ff25631`)
- **minor** — The props of this package's `ThemeProvider` are declared and exported as `ThemePreferenceProviderProps` instead of `ThemeProviderProps` (objectui#6349, batch 10). `@object-ui/reac… (objectui `12ff25631`)
- **minor** — `ConnectionState` is a new export: the lifecycle state of one client connection, `'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'` (objectui#6349, batch 10)… (objectui `12ff25631`)
- **minor** — The props of this package's minimal `AppShell` container are declared and exported as `MinimalAppShellProps` instead of `AppShellProps` (objectui#6349, batch 9). `@object-ui/layou… (objectui `1b2d0160f`)
- **minor** — The props of this package's view switcher are declared and exported as `ListViewSwitcherProps` instead of `ViewSwitcherProps` (objectui#6349, batch 8). `@object-ui/plugin-view` pu… (objectui `d758f2f20`)
- **patch** — **The console no longer offers an object to a caller who cannot read it** (objectui#12109). A navigation entry bound to an object (`type: 'object'`, by its `objectName`) is not dr… (objectui `5a65f7d57`)
- **patch** — An object timeline with a `groupByField` draws one group per value, headed by the value's display name (objectui#12104). (objectui `206505c34`)
- **patch** — An org install from the Marketplace catalog's "Your organization" strip, on a cloud-managed environment, now waits until the environment serves the installed package's app before… (objectui `a21ff9a95`)
- **patch** — The console asks for recent activity only when the signed-in user may read it, and a failed read no longer shows as "No recent activity" (objectui#12081, item 8). (objectui `029bdaf45`)
- **patch** — An app that serves the signed-in user no navigation now opens on an app-level empty state, not on the Studio home (objectui#12079). (objectui `417e24567`)
- **patch** — The record chatter stores each reaction as the member's own `sys_comment_reaction` record, and stops writing the whole `sys_comment.reactions` column (objectui#12078; ruling A, am… (objectui `de302c731`)
- **patch** — fix(console): a long flow screen or action parameter list keeps its Submit / Confirm on screen (objectui#12080) (objectui `4d0ff2331`)
- **patch** — `ConnectionState` is re-exported from `@object-ui/types` instead of being declared a second time here (objectui#6349, batch 10). `@object-ui/data-objectstack` declared the same fi… (objectui `12ff25631`)
- **patch** — `ConnectionState` is re-exported from `@object-ui/types` instead of being declared a second time here (objectui#6349, batch 10). `@object-ui/collaboration` declared the same five… (objectui `12ff25631`)
- **patch** — Doc comments only. `UserDataAdapter` now carries the contract notes `@object-ui/app-shell` kept on its own copy of the interface: implementations must be safe to call concurrently… (objectui `1b2d0160f`)
- **patch** — The props of the console's page header are declared as `ConsolePageHeaderProps` instead of `PageHeaderComponentProps` (objectui#6349, batch 8). `@object-ui/layout` publishes `Page… (objectui `d758f2f20`)
- **patch** — Doc comment only. The `PageHeaderComponentProps` comment no longer says `@object-ui/app-shell` shares the name: the console's header props are now `ConsolePageHeaderProps`, so thi… (objectui `d758f2f20`)
- **patch** — The props of the dashboard's read-only record drill drawer are declared as `DashboardRecordDetailDrawerProps` instead of `RecordDetailDrawerProps` (objectui#6349, batch 8). `@obje… (objectui `d758f2f20`)

⚠️ 1 of these carries a breaking change: 1 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 1 commit in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared it, so it appears in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ fix(scripts): an injected tree hashes apart from an installed one, so a local Spec Main Shape Gate reproduction cannot leave verdicts a sibling worktree replays (objectui#12114) (… (objectui `a194b4e37`)

Clause-②: yes (widening: the html-page save gate and `os validate` read the SDUI manifest this console ships, and at this pin `element:repeater` and `element:number` publish the node-level `dataSource` binding as their only query input. A page source with `<element:repeater dataSource={{ object: 'account' }} />` and no flat `object` was refused with `missing-required-prop` against the previous manifest and passes against this one; a flat `object` / `filter` / `sort` / `limit` still passes, now with a non-gating `unknown-prop` warning.)

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, the regenerated `sdui.manifest.json` and its record
     `scripts/sdui-manifest.record.json`, the re-recorded
     `packages/sdui-parser/objectui-lockstep.json` (its grammar region, diagnostic codes
     and containment predicate are unchanged across the range) and the re-measured pin
     citations in `packages/spec/src`, which carry their own `@objectstack/spec` patch
     changeset. It adds, removes or renames no ObjectStack-authorable key: no Zod schema,
     no spec declaration and no stored `sys_metadata` shape moves in it, so
     `objectstack migrate meta` has nothing here to rewrite, and this body carries no
     FROM/TO prescription of its own.
     The manifest is the one accept set that moves, and it moves in one direction. Its
     `element:repeater` row loses the `object` (required), `filter`, `sort` and `limit`
     inputs and its `element:number` row loses `object` and `filter` (objectui#12085,
     `ce991bd70`), the html tier's half of the retirement `@objectstack/spec` already
     carries with its own disposition (`element-flat-data-binding-retired`, #11509).
     Measured with `compile()` of `@objectstack/sdui-parser` against both manifests: a
     repeater bound through `dataSource` alone goes from `missing-required-prop` (error)
     to clean, and the flat keys go from clean to `unknown-prop` (warning, which the save
     gate does not refuse). Nothing that passed before is refused now.
     The range carries one declared-breaking objectui change, by its author's breaking
     annotation and not by a declared `major`: objectui#6349 batch 10 (`12ff25631`), the
     row type of `@object-ui/plugin-designer`'s `VersionHistory` timeline is declared as
     `VersionHistoryEntry` instead of `VersionEntry`. An objectui TypeScript type; no
     ObjectStack key. No commit subject in the range carries `!`. -->

objectui range: `20c6d351ad74...0df67f237c5a`
