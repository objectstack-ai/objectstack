# @object-ui/plugin-list

## 18.1.0

### Minor Changes

- ff77cfc: On a cloud-managed environment (`features.cloudManaged: true` from `/auth/config`), the console says what the server already enforces. Setup → Users shows one line saying where people are invited (the organization, in the cloud) and marks a user who holds no permission set beyond the baseline as "Not authorized", read from their `sys_user_permission_set` and `sys_user_position` rows. The identity import entry is not offered, the organization members page shows a note instead of Invite member, and the recovery-password reminder does not show. With the flag absent or `false`, nothing changes.
  
  `AuthPublicConfig['features']` gains `cloudManaged`. `ObjectGrid` gains the `rowAdornment` host prop, a node drawn beside one row's title (the declared name field's cell, else the first shown column, and the card title in the card view), and `ListView` forwards its own `rowAdornment` to the grid.
  
  Clause-②: yes
  Metadata-protocol: none

### Patch Changes

- ad74e98: fix(plugin-list): the synthetic "All records" tab of a tabs-mode user-filter bar (`showAllRecords`) now reads its label from the new `list.userFilters.allRecords` i18n key, filled in every shipped locale (zh: 全部记录), instead of a hard-coded English string (objectui#13405). The tab's `__all__` id and behaviour are unchanged.
- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [5235d6d]
- Updated dependencies [8e649da]
- Updated dependencies [7c405b7]
- Updated dependencies [0093b2c]
- Updated dependencies [813c3d9]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [b911ebb]
- Updated dependencies [0d12e95]
- Updated dependencies [ff77cfc]
- Updated dependencies [49a536d]
- Updated dependencies [241cb78]
- Updated dependencies [404ccae]
- Updated dependencies [ec627ab]
- Updated dependencies [0f4adc3]
- Updated dependencies [fa31856]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [d9aff15]
- Updated dependencies [4eeb174]
- Updated dependencies [afcf654]
- Updated dependencies [2c3dc72]
- Updated dependencies [cee3bc5]
- Updated dependencies [2958f17]
- Updated dependencies [a78608f]
- Updated dependencies [1d178e0]
- Updated dependencies [2c4e5f5]
- Updated dependencies [6fb31dc]
- Updated dependencies [fbb4b23]
- Updated dependencies [f3044f7]
- Updated dependencies [c8f8b10]
- Updated dependencies [ad74e98]
  - @object-ui/types@18.1.0
  - @object-ui/components@18.1.0
  - @object-ui/fields@18.1.0
  - @object-ui/i18n@18.1.0
  - @object-ui/react@18.1.0
  - @object-ui/permissions@18.1.0
  - @object-ui/core@18.1.0
  - @object-ui/mobile@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- fd060f0: The `list-view` and `view:list` registrations no longer declare `objectName`
  required, so the page compile accepts a node whose `dataSource` binding names the
  object, and a list that names its object in neither place shows a hint instead of
  an empty list (objectui#11605).
  
  `list-view` has no spec row. The binding doc says a node bound by
  `dataSource.object` needs no `objectName` of its own, and the schema validator
  counts the binding as a `list-view` record source. The renderer agrees:
  `dataSource.object` lands on `objectName` before the list reads the node. The
  registrations still declared `required: true`, and the page compile reads them,
  so a bound list with no `objectName` of its own was refused with
  `missing-required-prop` and the save failed.
  
  **Clause-②: yes (widening)** — a `list-view` (or `view:list`) node that names its
  object through `dataSource.object` and sets no `objectName` now compiles and
  saves. A node that names its object in neither place also compiles now, and the
  list shows "No object named: set objectName or dataSource.object." where it used
  to draw the "Nothing here yet" empty state. A list with inline `data` shows no
  hint and renders as before. The published `objectName` input now carries a
  description that says the binding can supply it.
- 834c559: An empty list's copy no longer contradicts the page it sits on (objectui#11687).
  
  An identity list (an object managed by the authentication provider) said its records are "not added by hand here", even beside an "Invite User" or "Register OAuth Application" button on the same page. The console now asks whether the page offers a way to add a row: its New button, or a toolbar action the page draws, judged by the same placement, capability and `visible` gates the toolbar applies. When it does, the identity copy is not used and the list shows its own empty state instead. When the toolbar action is hidden (for example a multi-organization-only Invite User in a single-organization deployment), the identity copy stays. The Teams list keeps its own copy, which already names its Create Team button.
  
  A list view emptied by its own declared filter said "No records match your current filters or search." when no filter or search had been applied. That message is now said only when the user applied a filter or a search. A view emptied by its own filter alone keeps the "No matching records" title and reads "No records match this view’s filter.", through a new `list.viewFilterNoMatchesMessage` key in all ten language packs and in `LIST_DEFAULT_TRANSLATIONS`. A list with no filter at all still gets the first-run copy.
- f34e877: Gallery cards and the compact list honour a deadline's `settledWhen` (objectui#11815): a done record's past due date reads neutral, an open one's reads "Overdue Nd" in red. Gallery cards now also read the field's declared `dueLike`, so a declared deadline reads overdue there at all.
- 75bacf9: A console object list's toolbar grouping is now in the URL, beside its Filter panel conditions, search term and sort, so a grouped list can be shared as a link or bookmarked (objectui#11860).
  
  `ListView` (`@object-ui/plugin-list`) has a new optional prop, `onGroupingChange`. It fires when the user changes the grouping in either grouping editor: the toolbar's Group panel (adding, changing or removing a level, or Clear) and the compact toolbar's View settings popover. The value is the `@objectstack/spec` `GroupingConfig` (`{ fields: [{ field, order, collapsed }] }`), the shape `schema.grouping` takes, or `undefined` when the grouping is cleared. It does not fire when the list re-reads a changed `schema.grouping` from its host. A host that does not pass it behaves as before.
  
  The console object page (`@object-ui/app-shell`) writes that value into a fourth `uf_` query parameter, `uf__group`, as JSON, and opens a list grouped by it:
  
  - **A URL that carries a grouping opens the list grouped that way**, over the grouping the view declares. A URL without one opens the view's declared grouping.
  - **Malformed or out-of-date groupings are dropped.** This applies to a value that is not valid JSON, a grouping or level the spec's `GroupingConfigSchema` rejects, and a field the object no longer has or the user may not read. The list still opens, and the dropped entry is removed from the address bar.
  - Each change replaces the current history entry. Clearing the grouping removes the parameter; the spec has no empty grouping, so a link to a view that declares a grouping cannot carry "no grouping". Switching to another view opens it on its own grouping. Opening or closing the Group panel leaves the URL unchanged.
  
  The grouping is written to the URL only: it is not stored on the view or in the per-browser filter memory.
  
  Also fixed on the console object page: a link's `uf__sort` now sorts the list on a view that declares a sort of its own. Before, the view's declared sort overrode it, so the link's sort showed in the address bar while the list stayed in the view's order.
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- 5330afd: List views read an absent `userActions.editInline` as on, the v18 protocol default (objectui#12086, the consumer half of objectstack#22605). A list view is editable in place by default, under the permission gate that already exists, and `userActions: { editInline: false }` makes it read-only in place.
  
  **A list view that declares neither key.** The maintainer's v18 ruling flipped the spec's `ListViewSchema.userActions.editInline` from `.default(false)` to `.default(true)`. `ListView` (`@object-ui/plugin-list`) reads an absent `editInline` as on (`!== false`). A grid view that declares neither `userActions.editInline` nor `inlineEdit` offers the inline-edit toggle, on the wide toolbar and in the compact settings popover, and opens out of edit mode. The previous release offered it there too, reading an absent key as "defer to the host"; objectui#5144 read it off on unreleased `main` only, and its entry in this release states the default as on. The fold objectui#5144 added is unchanged.
  
  **Behaviour change: the ADR-0047 interface page (`@object-ui/app-shell`).** The page reads its config's `userActions.editInline` with the same default and hands it to `ListView` as the grid's edit mode, because the page wires no inline-edit toggle. A page that declares nothing now opens its grid editable in place; `editInline: false` keeps it read-only.
  
  **Unchanged.**
  
  - The permission gate. The toggle, the compact entry and the edit mode are offered only where the object is editable in place and the current principal holds `update` on it. A principal without the grant sees no toggle.
  - The `inlineEdit` fold (objectui#5144): `inlineEdit: true` reads on and opens the grid in edit mode, `inlineEdit: false` reads off, and an explicit `editInline` wins either way.
  - The console toggle stays session-only (objectui#5144, ruling E).
  
  **What to do.** A list whose records are read-only by nature (a log, an audit trail, a history, a roll-up) declares `userActions: { editInline: false }`. A view or overlay where an earlier console stored `inlineEdit: false` still reads off; declaring `userActions.editInline: true` brings the toggle back.
  
  Nothing is added to a package entry: no export, prop, type member or language-pack key. (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own behaviour changes ship as `minor` with the semantics stated here.)
- 5c0846e: A page `list-view` node is written in `@objectstack/spec`'s list view spelling, `data` and `type`, and a metadata page reads `properties.type` as the list kind (objectstack-ai/objectstack#22444, ruling C; objectui#12099).
  
  - The `list-view` and `view:list` registrations publish `data` (the spec's `ViewData`, `{ provider: 'object', object }` naming the object) and `type` (the list kind) in place of `objectName` and `viewType`, in their `inputs` and in `list-view`'s `defaultProps`. Neither input is required: a `dataSource` binding can name the object, and an absent kind is a grid unless a bound saved view supplies one.
  - On a metadata page, `{ "type": "list-view", "properties": { "data": { "provider": "object", "object": "deal" }, "type": "kanban", "kanban": { … } } }` now draws a kanban over `deal`. Before, the page renderer never copied `properties.type` onto the node (the node's own `type` is the registry key), so every such list drew a grid. The node's own `type` stays `list-view`. A kind the node states outranks a bound saved view's kind.
  - **Breaking for page nodes in the old spelling:** a page node's own `objectName` and `viewType` are no longer read. Each logs one console warning naming what to write instead, and a node that names its object only as `objectName` draws the "no object named" hint, which now names `data.object`. Converting stored page nodes is the platform's job (an ADR-0087 conversion in `@objectstack/spec`); the renderer does not read them back. `ListView`'s React props (`ListViewSchema`) are unchanged and still spell the two `objectName` and `viewType`.
- b434f5f: An empty list draws its declared link, and a list page's own empty state wins over its source view's (objectui#12270).
  
  `@objectstack/spec` 18 gives the empty state (`EmptyStateSchema`) one optional `link: { label, url }`, and a list page's `interfaceConfig` an `emptyState` of its own with that shape. Both parsed and neither was drawn:
  
  - a list view's empty state (`ListView`, on its `grid` and `gallery` visualizations) and the `object-grid` block's authored empty state now draw the link, beside the add-record action where the view offers one;
  - a list page's own `interfaceConfig.emptyState` now wins, whole, over the one its source view declares, on every visualization; the source view's is the fallback when the page declares none.
  
  The link is followed as a `type: 'url'` action through the action runner, so it opens what such an action opens: an in-app path in place, an `http(s)://` address as the runner opens an external target, and `mailto:` in place. The runner refuses anything else at the click and reports it. The link's `label` takes a string or an inline locale map.
  
  `@object-ui/components` exports `EmptyStateLink`, the one component every empty state draws the link with.
  
  **Clause-②: yes (widening)** — the renderers start honouring two keys the spec declares (`emptyState.link`, `interfaceConfig.emptyState`), so what they draw widens. No existing key changes.
- 524136e: The view-level `provider: 'api'` data source is no longer read anywhere in objectui (objectui#12325). `@objectstack/spec` retires it (objectstack#23082, ADR-0049): a view binds its object (`provider: 'object'`) or static rows (`provider: 'value'`), and a metadata-declared API call is the page element's `dataSource` binding.
  
  Breaking, declared as `minor` per the version-alignment rule:
  
  - **`resolveDataSource`** (`@object-ui/core`) has no `api` arm. A block that still says `provider: 'api'` is an unknown provider and gets an unknown provider's answer (the fallback DataSource, else `null`); no `ApiDataSource` is built from its `read` / `write`. `ResolveDataSourceOptions` loses `fetch` and `defaultHeaders`, which only that arm read.
  - **`ViewDataProvider`** (`@object-ui/core`) has no `api` arm: such a config resolves with `Unknown data provider: api`. `ViewDataConfig` and `ResolvedData.provider` drop `'api'`, and `DataFetcher.fetchUrl`, which only that arm called, is removed.
  - **`useViewData`** (`@object-ui/react`) no longer keys on or threads anything for an `api` block.
  - **`ObjectGantt`** reads no `api` block: its `read` URL is never requested, and the chart answers it like any unknown provider. `ObjectCalendar` and `ObjectMap` drop their `api` branches, which only warned "not yet implemented".
  - **`ListView`** no longer stands down for a gantt view with an `api` block: it fetches the bound object like any other list.
  
  Unchanged: `ApiDataSource` stays a class for code that constructs it from an `ApiDataSourceConfig`, so the console's approvals inbox reads exactly as before.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
- a2225f9: The console list page spends less of the screen on chrome (objectui#12423).
  
  - **Four controls on the list toolbar.** The bar now shows Filter, Sort, Display and Search. Display is the former "View settings" panel, opened by default on every list: a Layout row (the visualization switcher, when the list offers more than one), Group, Row color, Hide fields, Density, a Row numbers switch and an Edit inline switch, with Reset to view default, Refresh and Export in its footer. The Display button shows how many of these differ from the view's own settings, and Reset hands them all back. Each control still saves exactly what it saved before; Row numbers lasts for the session only and starts on. A view that sets `compactToolbar: false` keeps the old toolbar, one button per control.
  - **View tabs fit the width.** The view tab strip shows as many saved views as fit and folds the rest into the "N more" menu; `maxVisibleTabs` is now an optional cap on top of the width. A table view's tab is its name alone, other view types keep their icon, and the small filter, sort and default-view marks on tabs are gone. The current tab's menu still offers every action, and "Set as default" now shows which view is the default.
  - **Grid rows.** With selection on, the first cell of a row shows the row number and swaps to the checkbox on hover, on keyboard focus, on touch screens and on every row while any row is selected; the header keeps its select-all box. With row numbers off the cell is empty until hover. The row actions button appears on hover, on focus and on a selected row, and stays reachable by keyboard.
  - **One-row page header.** On desktop the list page header is a single row: icon, title, then the description, with the actions on the right. The favorite star is no longer in this header. Phones are unchanged.
  
  For integrators: `ObjectGrid` takes a `showRowNumbers` prop (on unless set to `false`); the `ViewTabBar` config's `showIndicators` is deprecated and draws nothing; the language packs gain `list.display`, `list.layout`, `list.rowNumbers` and `list.resetToViewDefault`, and drop `list.viewSettings`, `list.viewSettingsHint` and `list.recordEditingTitle`.
- d4bc81e: The console list page draws its saved-view tabs and the list's Filter, Sort, Display and Search controls on one row (objectui#12440).
  
  - **One row for tabs and tools.** From the `sm` breakpoint up, the view tab strip is no longer a bordered row of its own above the list: it sits at the left of the list toolbar, takes the width the four controls leave, and folds the views that do not fit into its "N more" menu. Its "+" add-view button comes with it. Below `sm` nothing changes: there is no tab strip, and the app bar's view switcher stays the phone's view control. A view the server refuses still shows the tabs on their own row, since no list (and so no toolbar) is drawn for it.
  
  For integrators: `ListView` takes a `toolbarLeading` React prop. A host node passed there renders first in the toolbar row's left group, before the user-filter chips, in a `min-w-0 flex-1` wrapper. It is a host prop, not a schema key. Without it the toolbar row is unchanged.
- c41ce3f: Setup draws one page header on every page: the `sys_*` record lists, the metadata-type pages, the settings pages and the component pages.
  
  - **One header, a Setup posture.** Inside the Setup app the console page header (`ConsolePageHeader`) puts the description on its own line under the title: a 32px icon tile, an 18px title with the page's kind chip after it, a 13px muted description, Refresh as an icon button and the primary action at the right. The title sits at the same place on every Setup page. Outside Setup the header keeps its one row. `ConsolePageHeader` takes three new optional props: `badge` (the kind chip after the title), `breadcrumb` (leading crumbs on the description line) and `refresh` (`{ onRefresh, label, busy? }`, drawn as one icon button before `actions`).
  - **Metadata-type pages under Setup** (Positions, Capabilities, Permission Sets and their siblings) drop the "All Metadata Types" breadcrumb and the Items / Filtered tiles. The count reads "18 items" in the description, the source select is a filter chip, the table takes the record list's row height and sentence-case headers, and the source column shows plain text with its explanation in a tooltip instead of a chip on every row. The same page outside Setup (the metadata directory, Studio's "Open in Setup" target) is unchanged.
  - **Record lists under Setup** open without the `#` row numbers. `ListView` takes a new host prop for this, `defaultRowNumbers` (default `true`); it is not a view key.
  - **Settings pages** keep their form and take the same header. "All settings" is now the first crumb of the header's description line instead of a button at the top of the form.
  - **Component pages** — Packages, Packaged automation, Approvals Inbox, Audit Log Browser and App Marketplace — draw their title row through the same header, with Refresh as its icon button.
- 8614705: A kanban under a list view puts every record of the view in its column, not the list's first page, and its cards carry the view's first columns (objectui#12619).
  
  Measured on HotCRM's 45 opportunities at Display › Layout › Kanban: the board drew 25 cards (the grid's Rows per page), the closed columns read 0, the footer read "Showing first 25 records. More data may be available.", and each card showed only the record's name.
  
  - **Each lane is its own query.** `ListView` no longer hands its board the rows it fetched for the grid. It hands it the view's query, and the board asks each lane for its first 50 records: the view's filter (toolbar filters and chips included) AND the lane value, in the view's sort, with the toolbar search. The lane's count in its header is the server's count from the same answer. A lane holding more shows **Load more** at its foot. One more query finds the records in no lane (a lane value that is none of the lanes, or empty) for the trailing Uncategorized lane. A refresh asks each lane again at the depth it was loaded to. Dragging a card between columns writes the lane value and asks for the required fields as before, and both lane counts follow the card.
  - **The list footer counts the view.** It shows the view's record count from the list's own query, with no "Showing first N records" line and no Rows per page picker on such a board.
  - **Which boards page their lanes.** A board whose lanes are known before the query (the lane field's options) and that draws no swimlanes. Any other board under a list view is handed the list's rows, as before. A standalone `object-kanban` keeps its one query, capped by `limit`.
  - **Cards carry the view's first columns.** With no `kanban.columns` of its own, a list view hands the board the view's next two columns past the card title, the lane field and the owner field, by field name. Before, a card drew no field lines from the view's columns. Below its name it showed at most a subtitle the board derives from the record where the record yields one (an amount and an account, say). On HotCRM's measured board it showed the name alone: that view's columns are `{ field }` entries, handed over whole, which the card read as field names and matched none. The kanban block's `columns` is the author's card list and is used whole.
  - **A card field is a line with its label.** Each card field now shows its label, muted, before its value. The label used to be a tooltip only. The card's reduced padding between its title and its first field line now holds at every breakpoint; from the `sm` breakpoint up it had widened back to the full padding.
  - **The owner's avatar.** When the object gives its records an owner (the spec's `ownership` model and `SystemFieldName.OWNER_ID`, read through `resolveInjectedSystemColumns`), each card shows the owner's avatar from the expanded owner record, as the viewer may read it.
  
  Public surface: `ObjectKanbanComponentProps` gains two optional host props, `lanePaging` (`{ search?, searchFields?, reloadKey? }`) and `ownerField`. Neither is an authoring key on the `object-kanban` node. `@object-ui/i18n` gains `kanban.loadMore` in every language pack.
- a8add5c: A list block in a page region narrower than half the page draws a compact list (objectui#12703).
  
  The page renderer measures each region against the page body and tells the region's blocks their posture: `compact` when the region is narrower than half the page (an `aside` or `sidebar` rail beside `main`), `full` otherwise. The measurement is the region's rendered width relative to the page, never the viewport, so the same `aside` is compact beside `main` and full once a narrow screen stacks it. Nothing is authored: `@objectstack/spec` declares no posture or `compact` key, and none is added.
  
  A `list-view` block in a compact region draws a header with its title and record count over two-line rows: the view's first visible column, with its second muted below. It draws no toolbar, no view tabs, no row-number column, no pager and no record-count bar. A click on a row opens the record the way a grid row does. A region half the page or wider, a region whose width is not known (server render, no `ResizeObserver`), and the object list page keep the full list unchanged. The compact list applies to a paged grid; a board, a calendar or a grouped grid keeps its own rendering.
  
  Published surface:
  
  - `@object-ui/components` exports `usePageRegionPosture()` and the type `PageRegionPosture` (`'compact' | 'full'`). The hook answers `null` outside a page region or before the width is known.
  - `@object-ui/plugin-list`'s `ListViewProps` gains the optional host prop `compact`. It is a React prop, never a schema key; absent, the list renders as before.
- 33ee9de: A `list-view` block drawn as a compact list in a narrow page region now shows a "View all" link under its rows (objectui#12703).
  
  - `@object-ui/react`: `RelatedRecordActionsValue` gains two optional members, `listHref(objectName, viewName?)` and `openList(objectName, viewName?)`. They address an object's list page, or one of its saved views, the way `recordHref` / `openRecord` address a record. A host that omits them is unchanged.
  - `@object-ui/app-shell`: a custom page supplies them. The routes are `/apps/APP/OBJECT/view/VIEW` for a block bound to a saved view (`dataSource.view`) and `/apps/APP/OBJECT` otherwise. The block's inline filter, columns and sort are never put in the URL.
  - `@object-ui/plugin-list`: the compact list draws the link only when the host answers a destination. It is a real anchor with in-app navigation on a plain click.
  - `@object-ui/i18n`: one new key, `list.viewAll`, in all ten packs.
- 1b88645: A list's user-filter chip no longer shows the raw field key while the object definition is loading (objectui#12890).
  
  A chip declared without a label (`userFilters.fields: [{ field: 'category' }]`) takes its name from the object definition. Until that definition arrived, the chip, its text-search placeholder, its person-picker search prompt and the deprecated toggle button all showed the machine key (`category`), which a zh-CN viewer then saw replaced by `分类`. While the definition is loading, these now show a skeleton (or no text) instead. Once it arrives the chip shows the field's translated label, as before. A chip with an authored `label` shows it throughout. If the loaded definition has no such field, the chip still falls back to the key.
  
  `UserFiltersProps` gains an optional `objectDefPending` flag, which `ListView` sets while it fetches the definition. A host that leaves it out gets the previous behaviour.
- b5153f4: The list toolbar's Display control compares hidden fields and density against the view's own value again (objectui#12949). On a console list, after a user hid a column (or changed the density) and reloaded, "Reset to view default" was disabled and the Display trigger counted nothing, although the list differed from the view. The console lays the user's stored choice over the view's value (objectui#12474), so the list compared that choice with itself. Now the reset is enabled whenever the user's hidden fields or density differ from the view's, the trigger count follows the same comparison, and pressing the reset writes the view's value back through the same doors the controls write through, so the user's stored preference follows, as Show all does.
  
  On a saved view that declares no `columns`, the view's own `hiddenFields` is never applied (objectui#12505), so the view hides nothing there: the reset returns to every drawn column.
  
  **Clause-②: yes (widening)**: the exported `ListViewProps` gains one optional member, `viewDefaults?: Pick<ListViewSchema, 'hiddenFields' | 'rowHeight'>`. A host that lays a user preference over those two schema keys passes the view's own values in it. When it is passed, its members are the whole baseline (an absent `hiddenFields` means the view hides nothing, an absent `rowHeight` means the default density). A host that does not pass it behaves exactly as before: `schema` is the view's own. No key is added to `ListViewSchema`, and no existing member changes type. `@object-ui/app-shell`'s object page passes it; its own exports do not change.
- a244a17: `list-view` publishes the keys of its `@objectstack/spec` row that the renderer honours on a page node (objectui#13047).
  
  The spec's `ComponentPropsMap` gained a `list-view` row in 18 (objectstack-ai/objectstack#22444): the list view's own `ListViewSchema`. The registration published six of its keys (`data`, `type`, `columns`, `filter`, `sort`, `options`). Every other key of the row was measured on a page node, authored in the node's `properties` and rendered through `SchemaRenderer` and this registration, and the 33 the renderer honours are now published in `inputs`, with the member shape the spec declares named in each description:
  
  - **The query:** `pagination`, `searchableFields`.
  - **Identity:** `label`, `description` (each a plain string or an inline locale map).
  - **The toolbar:** `userFilters`, `userActions`, `compactToolbar`, `appearance`, `exportOptions`, `allowPrinting`, `showRecordCount`, `emptyState`.
  - **The grid:** `hiddenFields`, `fieldOrder`, `rowHeight`, `resizable`, `selection`, `navigation`, `grouping`, `rowColor`, `conditionalFormatting`, `inlineEdit`, `rowActions`, `bulkActions`, `bulkActionDefs`.
  - **Each kind's own block:** `kanban`, `calendar`, `gantt`, `gallery`, `timeline`, `map`, `tree`, `chart`.
  
  `appearance.allowedVisualizations` narrows the kinds a view switcher offers, and a page node draws no switcher, so on a page it changes nothing; its description says so.
  
  Five keys of the row stay unpublished, because the renderer does not honour them on a page node: `name` and `requiredPermissions` are read by nothing there, `sharing` and `addRecord` each draw a button that does nothing there, and `filterableFields` is read as the Filter panel's field list, not as the quick-filter shorthand the row declares it to be.
  
  The `view:list` alias registers the same renderer and now publishes the same list. The descriptions of the six keys already published are filled in. Nothing changes at render time: no reader, export, prop or type member is added.
- b017621: A page `list-view` node now honours `requiredPermissions`, a key of the spec's list view row, and the registration publishes it (objectui#13074): the capabilities a viewer must all hold. A viewer missing one sees an insufficient-permissions notice in place of the list, the same notice the record blocks draw, and no records are queried. A provider that reports no capabilities still shows the list.
  
  `addRecord` and `sharing` stay unpublished. With `addRecord.enabled`, the Add button calls the `onCreate` a `RelatedRecordActionsContext` provider serves for the listed object, and is withheld, not drawn dead, where no provider serves one. `sharing`'s Share button has no action the spec declares.
- d11174a: A list's `addRecord` Add button opens the create form on a console page and on the console's object list (objectui#13089).
  
  - **Page `list-view` nodes.** The console's page host now serves the record-form create to a list that names no `relationshipField` and has no parent: a page `list-view` node. So `addRecord: { enabled: true }` draws its Add button, and a click opens the create form for the listed object. A related list whose parent did not resolve is still served nothing, so it draws no "+ New" that would open a child form linked to no parent. No Edit, Delete or row click is served to a list without a parent.
  - **`list-view.addRecord` is a published input** of the `list-view` and `list` registrations. `enabled` and `position` are read; `mode` and `formView` are not.
  - **The console's object list.** A saved view that declares `addRecord.enabled` used to draw an Add button whose click did nothing, also for a viewer who may not create. The button now opens the header New's create, and is withheld wherever that New is not offered or is greyed.
  - **`editMode: 'page'`.** A create linked to no parent, from the record-actions bridge, now opens an `editMode: 'page'` object's full-page create route, as the object list does, instead of the overlay.
  - **`ResolveRelatedRecordActionsInput`** (`@object-ui/react`) documents what an input without `relationshipField` asks for: an object-scoped list's handlers. No type or member changes.
- cbac9d7: The list view's Filter panel no longer narrows its field list to a per-view `filterableFields` whitelist (objectui#13118). `@objectstack/spec` 18 retires the list view's `filterableFields` (objectstack#24640, maintainer ruling C), and no per-view Filter-panel whitelist replaces it. The Filter panel offers every field the user may read, minus the fields the object marks `hidden: true`, which is what it already offered a view that declared no whitelist. A hidden field still appears when a condition the panel holds filters on it.
  
  - **`ListView`** (`@object-ui/plugin-list`) reads `filterableFields` nowhere. A stored view that still carries the key gets the same Filter-panel list as a view without it. The spec's conversion drops the key from stored and authored views, so no new source carries it.
  - **The relays** stop forwarding the key: the `object-view` delegation in `@object-ui/plugin-view` (from the named view, the host `views` entry and the node) and the object page in `@object-ui/app-shell` (from the active view). The `object-view` registration no longer publishes `filterableFields` as an input.
  - **`@object-ui/types`** declares `NamedListView.filterableFields` as a `?: never` tombstone, so a TypeScript author who writes the key on a named view is refused by name. `ObjectViewSchema.filterableFields` is deprecated and typed by reference to the list view's spec slot, the same slot its Zod mirror carries, so the `@objectstack/spec` pin bump that takes the retirement refuses it on both faces at once.
  
  BREAKING (`@object-ui/types`, `@object-ui/plugin-view`, `@object-ui/plugin-list`, `@object-ui/app-shell`), for a TypeScript caller or a view that passes `filterableFields`: the key no longer compiles on `NamedListView` (and on `ObjectViewSchema` from that pin bump on), and no renderer narrows the Filter panel to it. Delete the key. For a curated end-user filter bar, author `userFilters` on the list view, for example `userFilters: { element: 'dropdown', fields: [{ field: 'stage' }] }`. There is no replacement for a per-view Filter-panel whitelist: field-level read security decides which fields a user may filter on, and `hidden: true` on the object's field keeps a field out of the panel. (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  Clause-②: no (narrowing)
- 3c3115e: List views read `userActions.editInline` with the spec's default, on since objectstack-ai/objectstack#22605 (`editInline: z.boolean().default(true)`), and `editInline: false` is the opt-out. A view's `inlineEdit` folds into it, and the console's inline-edit toggle no longer writes to the view (objectui#5144).
  
  **The spec's default, read as declared.** The spec declares `userActions.editInline` with `.default(true)` (objectstack-ai/objectstack#22605): a list view is editable in place by default, under the permission gate, and `editInline: false` is the opt-out. The object-list toolbar used to read an absent `editInline` as "defer to the host", so every console grid offered the inline-edit toggle unless a view said `editInline: false`. The toolbar now reads it as the spec does. A grid view that declares neither `userActions.editInline` nor `inlineEdit` offers the inline-edit toggle, on the wide toolbar and in the compact settings popover, and opens out of edit mode. The flip of the default, and the interface page that reads it, are the objectui#12086 entry of this release.
  
  **The fold.** `normalizeListViewSchema` (`@object-ui/core`) now folds a boolean `inlineEdit` into `userActions.editInline`, the way it already folds the `show*` flags into the other toggles:
  
  - `inlineEdit: true` reads as `editInline: true`: the toggle is offered and the grid opens in edit mode;
  - `inlineEdit: false` reads as `editInline: false`: no toggle;
  - an explicit `userActions.editInline` wins over `inlineEdit`, in both directions;
  - a view with neither key reads on, the spec's default.
  
  `inlineEdit` stays on the folded view, because `ListView` opens the grid in edit mode from it. Nothing migrates stored views.
  
  **The console toggle is session-only (`@object-ui/app-shell`).** Both keys are the author's permission. The console's toolbar toggle used to store a user's edit mode in the view's `inlineEdit`; after the fold, switching it off would have taken the toggle away for good. It now writes nothing. The toggle switches edit mode for the session, and each load starts from the view's own `inlineEdit`. `ListView` still reports the toggle through `onInlineEditChange`.
  
  **A named view's `inlineEdit` keeps its precedence (`@object-ui/plugin-view`).** On a host's `renderListView`, `ObjectView` merges `userActions` from the node, the host's `views` entry and the active named view, the named view last. The named view's `userActions` now go through the same fold as the other two. So a named view's `inlineEdit` decides whether inline editing is offered ahead of a host entry's, as it already decided the edit mode.
  
  **What to do.** A list whose records are read-only by nature declares `userActions.editInline: false`. A view that declares `userActions.editInline: true` keeps the toggle offered whatever the user does with it. Two costs come with the session-only toggle:
  
  - the edit mode is not remembered across loads;
  - a view, or a personalization overlay, where the old toggle stored `inlineEdit: false` still reads off. That is existing data, and it is not migrated. Declaring `userActions.editInline: true` on the view brings the toggle back.
  
  Nothing is added to a package entry: no export, prop, type member or language-pack key.
- 0253416: feat(plugin-list)!: a chart list view binds only an ADR-0021 `dataset`; the legacy inline chart axes and their `name` / `value` floors are retired on every route (objectui#6152, round 15)
  
  Clause-②: no
  
  **Changed (breaking for a stored chart view that names no `dataset`).** Every door refuses the
  pre-ADR-0021 chart axes on a list view: `@objectstack/spec`'s chart block is a strict object of
  `chartType`, `dataset`, `dimensions` and `values`, and `@object-ui/types`, `objectui validate` and the
  platform's view write door judge by it, top-level and in the `options` bag. The renderers kept
  reading the axes, so a chart view stored before the doors closed still drew an inline aggregate, and
  a chart view that declared nothing was drawn from the invented fields `name` and `value`. They no
  longer do, on every route that did: `ListView`'s chart branch and its capability gate, the object
  page's chart view (`@object-ui/app-shell`) and `ObjectView`'s own views (`@object-ui/plugin-view`).
  
  | stored chart block (either nesting) | what renders now | write instead |
  | :--- | :--- | :--- |
  | `xAxisField` / `categoryField`, `yAxisFields` / `valueField`, `aggregation` (and, on the object page, `series` and `filter` on the block) | the chart's refusal: "Chart category axis required", in place of the chart; a view of another type no longer offers Chart in its view switcher | `chart: { dataset, values, dimensions }`, naming an ADR-0021 dataset of the object |
  | no binding at all on a view whose `viewType` is `chart` | the same refusal, where a chart grouped by `name` and counting `value` used to draw | the same dataset block |
  
  A dataset-bound chart renders as before. The refusal is `ObjectChart`'s own screen for an object-bound
  chart that names no category axis (objectui#8168); its remedy names that component's keys, not the
  list view's dataset block.
  
  **Not measured: production.** The census before this change (objectui#6152 round 13) found no writer
  and no stored row carrying these axes in any repository corpus a seat can reach, with positive
  controls; this repository's create-view dialog writes the dataset block. Stored view and page
  metadata in deployments was not measured. A row that carries the axes renders the refusal until it is
  re-saved with a dataset block.
  
  - `@object-ui/plugin-view`: an `ObjectView` kanban view no longer reads `kanban.conditionalFormatting`.
    The list view's kanban block does not declare it, and every door that judges the block refuses it
    by name; the view's own `conditionalFormatting` is the one place it is read. The development-only
    flat-key warning no longer names `dateField`, `groupBy`, `groupField`, `imageField` or
    `subtitleField`, which it told an author to move into a block that refuses them.
  - `@object-ui/app-shell`: the object page's development-only flat-key warning no longer names the
    twelve keys every per-kind block refuses (among them `groupField`, `imageField`, `cardFields`,
    `xAxisField`, `yAxisFields`, `aggregation` and `series`).
  - `@object-ui/plugin-charts`, `@object-ui/types`: comments only, where they said the list-view relays
    still read the legacy axes.
- 3fd8625: feat(plugin-list)!: the renderers stop reading the list-view keys every door refuses: the pre-#2231 aliases, `calendar.defaultView`, and the undeclared keys a per-kind block carries (objectui#6152, round 14)
  
  Clause-②: no
  
  **Changed (breaking for a stored view that carries a refused key).** Rounds 11 and 12 of
  objectui#6152 closed the doors: `@object-ui/types`, `objectui validate` and `@objectstack/spec`'s
  view write door refuse these keys on a list view's per-kind blocks, top-level and under the legacy
  `options` bag. The renderers kept reading them, so a view stored before the doors closed still
  rendered as written. They no longer read them, on every route that did: `normalizeListViewSchema`
  (`@object-ui/core`), which folded the four aliases onto their spec keys before anything else read
  the view, `ListView`, the object page's relay (`@object-ui/app-shell`), `ObjectView`'s own views
  (`@object-ui/plugin-view`) and `ObjectTimeline`. A stored view that carries one of these keys still renders, without what the key
  used to bind. Write the spec's key instead:
  
  | stored key (either nesting) | what renders now | write instead |
  | :--- | :--- | :--- |
  | `kanban.groupField` | lanes as for a view that names none: the object's declared lifecycle field (`status` on an `object-view` element's own views) | `kanban.groupByField` |
  | `kanban.cardFields` | cards show `kanban.columns`, or the view's own fields | `kanban.columns` |
  | `gallery.imageField` | no cover binding: `ObjectGallery` tries `image`, and the Gallery view is not offered | `gallery.coverField` |
  | `timeline.dateField`, and `calendar.dateField` read as a timeline axis | no timeline axis: the timeline's refusal names the keys to write, and the Timeline view is not offered | `timeline.startDateField` (or `calendar.startDateField`) |
  | `calendar.defaultView` | the calendar opens on its own default view | nothing on a list view: the initial mode is the `object-calendar` element's flat `defaultView` |
  | `kanban.swimlaneField` and any other undeclared kanban key | not drawn | nothing: the spec's kanban block has no swimlane |
  | `tree.titleField` | the tree labels by `name` | `tree.labelField` |
  | an undeclared key under `calendar`, `tree` or `gantt`, or anything under `options.grid` | not forwarded to the view | the block's declared key, or a top-level key of the view for a grid |
  
  The declared keys keep their route: `kanban.summarizeField`, `calendar.colorField` and
  `calendar.allDayField` are now read by name where the removed spreads used to carry them, and every
  `gantt` key the spec declares reaches the gantt through a typed table that `tsc` keeps total. A
  block key named like a node key (`objectName`, `filter`) can no longer override the node's own
  value. `ListView`'s projection collectors stop asking the server for the fields these keys named.
  
  **Not measured: production.** The census before this change (objectui#6152 round 13) found no
  writer and no stored row carrying these keys in any repository corpus a seat can reach, with
  positive controls; stored view and page metadata in deployments was not measured. A row that
  carries one of these keys renders as the table says until it is re-saved with the key on the
  right.
  
  Not in this change: the legacy chart axes (`chart.xAxisField`, `yAxisFields`, `categoryField`,
  `valueField`, `aggregation`), which `ListView` still reads until the next round on objectui#6152.
  
  - `@object-ui/core`: `normalizeListViewSchema` returns a view whose only legacy vocabulary is one of
    these nested aliases by reference, with the alias in place; it no longer removes it either.
  - `@object-ui/types`: the refusal messages of these keys no longer say a stored view still renders
    through the alias, and the kanban `groupBy` refusal no longer suggests the refused `groupField`.
  
  **Note added 2026-10-09 (objectui#6152 round 15):** the legacy chart axes are no longer read either.
  `ListView`, the object page and `ObjectView`'s own views read no `xAxisField`, `yAxisFields`,
  `categoryField`, `valueField` or `aggregation` on a chart block, so a chart view that names no
  `dataset` binds nothing and `ObjectChart` refuses it on screen; see
  `.changeset/6152-list-view-legacy-chart-retired.md`.
- c0c0a0d: The view switcher's views are typed as `@object-ui/core`'s `ListViewVisualization`, and this package no longer re-exports that union as `ViewType` (objectui#6349, batch 7). `@object-ui/types` publishes a different `ViewType`: the whole view-type vocabulary, which adds the `list` and `detail` categories to the nine visualizations the switcher draws. One exported name stood for two unions across the two packages.
  
  **Type change, breaking for some consumers.** `ViewType` is no longer exported from `@object-ui/plugin-list` (TS2305 on import). Import `ListViewVisualization` from `@object-ui/core` instead; it is the same nine-member union. The switcher's props keep their members, and `ListViewSwitcherProps['currentView']` names the same union (the props were renamed from `ViewSwitcherProps` in objectui#6349, batch 8).
  
  No runtime behaviour changes.
- d758f2f: The props of this package's view switcher are declared and exported as `ListViewSwitcherProps` instead of `ViewSwitcherProps` (objectui#6349, batch 8). `@object-ui/plugin-view` publishes a different `ViewSwitcherProps`: the props of its `view-switcher` renderer, which takes a `ViewSwitcherSchema` and host callbacks and is keyed on the whole `ViewType`. This package's switcher takes `currentView` and `availableViews`, keyed on `@object-ui/core`'s `ListViewVisualization`. One exported name stood for two props types across the two packages.
  
  **Type change, breaking for some consumers.** `ViewSwitcherProps` is no longer exported from `@object-ui/plugin-list`. Replace `import type { ViewSwitcherProps } from '@object-ui/plugin-list'` with `ListViewSwitcherProps`; the members (`currentView`, `availableViews`, `onViewChange`, `className`, `animated`) are unchanged. The compiler names the replacement (TS2724, "Did you mean 'ListViewSwitcherProps'?"). The `ViewSwitcher` and `ViewSwitcherDropdown` components keep their names.
  
  No runtime behaviour changes.

### Patch Changes

- 1e1f09e: The list filter builder starts on the view's first column, hides hidden fields, and offers one empty check where "empty" and "null" mean the same records (objectui#11810).
  
  - **Field list.** The list view's Filter panel no longer offers a field the object definition marks `hidden: true` (Organization, Owning Business Unit, the search index). Its fields follow the view's columns in the order the grid shows them, then the other business fields, then the system fields (created / modified / owner). A hidden field stays listed only when the view names it in `filterableFields`, or when a condition the panel already holds filters on it, so a restored filter still shows its field.
  - **"Add filter".** A new condition starts on the view's first visible column instead of the hidden Organization field.
  - **Empty checks.** On a column whose type cannot hold an empty value other than null (select, lookup, number, date and the other "null only" types of `@objectstack/spec`'s `expandEmptyOperator`), the operator list offers "Is empty" / "Is not empty" and no longer "Is null" / "Is not null": there they match the same records. Text columns and list-valued columns keep both pairs, and the operator list says how they differ ("Is empty" also matches blank text, or an empty list). A stored "Is null" condition on such a column still loads and shows as "Is null". Every `FilterBuilder` consumer gets this offer; what a row can hold (`operatorsForFieldType`) is unchanged.
  
  `@object-ui/i18n` gains two language-pack keys in all ten packs, `filterBuilder.emptyCheckHint.text` and `filterBuilder.emptyCheckHint.list`, which carry that hint. No export, prop or type member is added.
  
  `@object-ui/components` raises its `@objectstack/spec` floor from `^17.0.0` to `^17.5.0`, because its published entry now imports `expandEmptyOperator`, which the spec first exports in 17.5.0.
- bf376c5: A list view that shows a declared deadline but not the field its `settledWhen` reads now fetches that field, so a done record's past due date reads neutral instead of overdue (objectui#11815). A field the viewer may not read is still never requested; that deadline stays unsettled.
- 9844bbf: Grid inline edit marks a row modified only when a value really changed, draws one "Actions" column, and the "Edit inline" toggle reports its state (objectui#11816).
  
  - **A row is modified only by a real change.** The data table staged every committed cell edit, so clicking into a cell and out again showed "1 row modified · Cancel All · Save All (1)" for a row nobody had changed. An edit is now staged only when the value differs from the one the row loaded with. `null`, `undefined`, `''` and `[]` count as the same empty value, a number equals the decimal string that spells it (`5` and `'5'`), and a multi-value set equals the same set in another order. Staging the loaded value back removes the cell's edit, and the row is no longer counted as modified once none of its cells are.
  - **One "Actions" column.** With inline edit on, the trailing column that only holds a modified row's cancel and save buttons was headed "Actions" too, beside the grid's own row-menu column, and in larger type. When that column can only hold those buttons (the table is editable, has a save handler, and is given no row-menu handler), its header is now a pencil icon with the accessible name "Edit" (the existing `table.edit` key). A column that can hold a row menu keeps the "Actions" header, now in the same small muted type as the other column headers.
  - **The "Edit inline" toolbar toggle sets `aria-pressed`** to whether inline edit is on.
  
  No export, prop, type member or language-pack key is added.
- 2063f7a: Four plugin controls pick with the shared `Select`, the control the rest of the console picks with (objectui#11865, the plugins' single selects): `SharedViewLink`'s "Expires after", `ViewSettingsPopover`'s "Color by field", a `select` field of the kanban `InlineQuickAdd` form, and the grouped grid's "Rows per page".
  
  The four were browser-native selects, so they looked and behaved differently from the console's other dropdowns. They now use the shared Radix `Select`: the same trigger, dropdown and keyboard behaviour. The grouped grid's size picker is now drawn as the flat grid's pager draws its own.
  
  What they write is unchanged. Each option gives the same value as before: "Never" still generates a link with no expiry, "None" still clears the row-colour config, the quick-add placeholder still submits an empty string, and each page size still repaginates from page 1. Re-picking the current option writes nothing. The quick-add picker keeps the accessible name its label gave the native select and still takes the form's first focus. Its keys keep the form's contract: Enter on the closed picker still submits the form and Escape still cancels it; Space and the arrow keys open the list, and Enter or Escape inside the open list selects or closes it without submitting or cancelling the form.
  
  One display change: a value none of a picker's options carries now shows as itself. The native select showed its first option instead ("None" for a row-colour field, the placeholder for a quick-add value), which is not what the view or the form holds.
  
  **Clause-②: no.** No published face moves: the package entries export the same names, the four components take the same props, and no i18n key is added. What moves is the four controls' own markup, described above.
- 8f8f760: Three more controls pick with the shared `Select`, the control the rest of the console picks with (objectui#11865, the list view and the chatbot): `ListView`'s "Color by field" and its "Rows per page" selector (the fallback for views without a grid pager), and `ChatbotEnhanced`'s model picker.
  
  The three were browser-native selects, so they looked and behaved differently from the console's other dropdowns. They now use the shared Radix `Select`: the same trigger, dropdown and keyboard behaviour. "Color by field" now matches its twin in the compact toolbar's View settings popover, which made the same change earlier.
  
  What they write is unchanged. Each option gives the same value as before: "None" still clears the row-colour config, a field keeps the config's colours, each page size still reaches `onPageSizeChange` and refetches at that size, and each model still reaches `onModelChange` as its id. Re-picking the current option writes nothing. The model picker keeps its accessible name, the `model` label. A row-colour rule on a field the caller may not read still shows as "None" and is never offered.
  
  One display change: a value none of a picker's options carries now shows as itself. The native select showed its first option instead: "None" for a row-colour field outside the list's columns, the first size for a page size in force that is not one of the options (an undeclared size, for instance), and the first model for a selected model the environment no longer offers.
  
  **Clause-②: no.** No published face moves: the package entries export the same names, the two components take the same props, and no i18n key is added. What moves is the three controls' own markup, described above.
- 077d198: The list's Filter panel offers only the fields the user may read (objectui#11925). Its field list now asks the same field-level read check the list's columns already use, `checkField(objectName, field, 'read')` from the permission context, so a field the grid does not show to this user can no longer be chosen as a filter condition, and the two field lists cannot drift apart.
  
  - **Both sources pass the check.** The list is built from the object definition and, while that has no field map, from the view's declared columns. A field the user may not read is dropped from either.
  - **Nothing keeps an unreadable field listed.** Not the view's `filterableFields`, and not a condition the panel already holds.
  - **Nothing else changes.** While the permission answer has not loaded, the list is as before, the same way the column check defers. A user who may read every field sees the same list, in the same order. The `filterableFields` whitelist, the hidden-field rule and the ordering are unchanged, and so is the sort picker.
  
  **Clause-②: no** — no export, prop, type member or accepted input changes.
- e44f9bc: The list's Sort picker no longer offers a field the user may not read (objectui#11943). Choosing such a field sent a sort the server refuses, and the list went blank on "no access". The picker now asks the same field-level read check as the list's columns and its Filter panel, `checkField(objectName, field, 'read')` from the permission context. The Filter panel and the Sort picker share one predicate for it.
  
  - **A field the current sort already uses stays listed.** A stored or URL sort on an unreadable field still shows its row by name, so it can be removed. For now that field is also still offered in the picker's other rows. Listing it only as removable is a follow-up.
  - **Nothing else changes.** While the permission answer has not loaded, the list is as before, the same way the column check defers. A user who may read every field sees the same list, in the same order. A link field the user may not read no longer brings up the hint about link fields not being sortable. The Filter panel's list is unchanged.
  
  **Clause-②: no** — no export, prop, type member or accepted input changes.
- 4f4fc03: The list's Sort picker lists a field it keeps only for the current sort as removable, never as a new choice (objectui#11943).
  
  `SortBuilder`'s `fields` entries take an optional `disabled`. A disabled entry is drawn as an unavailable option in every row's dropdown and cannot be chosen by click or keyboard. A row whose field it already is still shows its label, and can be changed to another field or removed. "Add sort" seeds the first entry that is not disabled, and is disabled when every entry is. An entry without the flag behaves as before.
  
  `ListView` sets the flag on each field its Sort picker keeps only because the current sort names it: a field the user may not read, a field the platform refuses to order by, and a relational field listed as ordering by ID. Before this, a stored or URL sort on such a field left it choosable in the picker's other rows, and "Add sort" seeded it when it came first.
- 2312bd9: A page that declares `print` now prints as a document, and a record page bound to such a page offers a Print action (objectui#11958, the objectui half of the print-page ruling on objectstack#8346, M1, zero server).
  
  - **The print stylesheet.** `PageRenderer` mounts a stylesheet built from the page's `print` declaration, only for a page that declares it. Every rule sits inside `@media print`, so the page on screen is drawn as before. `paperSize` and `orientation` set `@page { size }` (A4 and portrait when omitted). `margins` set one `@page` margin per declared side, in millimetres. `pageNumbers` prints "page / pages" in the bottom-right margin. `repeatHeader` and `repeatFooter` repeat the page's own `header` and `footer` regions on every sheet. `repeatTableHeaders` (on when omitted) repeats a table's column headings on every sheet it runs onto. `avoidBreakInside` keeps each block of a region whole on one sheet when it fits. Only the print page reaches paper: the console chrome and the record view's own panels around the page are hidden, and the page runs onto as many sheets as it needs.
  - **The printable blocks print whole.** On a print page, `record:line_items` no longer cuts lines off at its row cap in silence: when the child object has more lines than the cap (500 unless `limit` is set), the panel draws the cap's lines and the shared row-ceiling note under them, naming both numbers when the server reports a total. A collapsible `record:details` section draws open, because a closed section never reaches paper. Off a print page both blocks behave as before.
  - **The record page's Print action.** When the record page bound to a record declares `print`, the record view shows a Print button that opens the browser's print preview of that page.
  - **New exports from `@object-ui/react`:** `PrintPageProvider`, `usePrintPage` and `PrintPageContext`. `usePrintPage()` returns the enclosing page's `print` declaration, or `null` outside a print page.
  - The source comments that described PDF export as declined now say where a printable document lives: a page that declares `print`.
- 164f02c: The list toolbar's hide-fields popover, Group editor and Row color select, and its user-filter chips, no longer offer a field the user may not read (objectui#11984). They now ask the same field-level read check as the list's columns, its Filter panel and its Sort picker. The compact toolbar's View settings popover offers the same three lists and asks it too.
  
  - **User-filter chips.** A chip on a field the user may not read is not shown, whether the author named the field or it was derived from the object definition: a value chosen on it is a filter the server refuses, and the list went blank. A chip whose field a selection already holds (the applied filter, or a selection the host restored) stays, so that filter can be cleared.
  - **Stored settings are kept.** A grouping level on such a field still shows, under the field's name, so it can be removed, and nothing offers that field as a new choice. A hidden-field entry or a row-color rule on such a field is not shown, counted or cleared in the editors, and stays as stored: "Show all" and every other edit keep it.
  - **Nothing else changes.** While the permission answer has not loaded, every list is as before, the same way the column check defers. A user who may read every field sees the same lists, in the same order.
  
  **Clause-②: no**: no export, prop, type member or accepted input changes.
- e616327: A quick-filter selection restored from the URL now applies when the list's dropdown chips come from the object definition (objectui#12001).
  
  `userFilters: { element: 'dropdown' }` with no `fields` fills its chips from the object definition, and that definition loads after the list mounts. The dropdown bar read the restored selection (`initialSelections`, which the console fills from `uf_*` URL params) only once, at mount, when it had no fields yet. So a shared link such as `?uf_status=open` opened the list unfiltered while the address bar still carried the filter.
  
  Now a field that appears after mount gets the same starting selection it would have had at mount: the author's default, then the restored value, converted to the option's value type, with a single-choice field kept to one value. The chip shows it and the query carries it. Each field gets this once, so a value the user picks or clears afterwards is not overwritten when the definition renders again. As with a restore at mount, the bar reports it through `onFilterChange` and does not call `onSelectionsChange`.
  
  A list with declared `fields` behaves as before. The `tabs` mode was measured and is not affected: its presets come from the view, not the definition. The deprecated `toggle` mode takes no restored selection in any list.
  
  No export, prop, type or language-pack key changes.
- 902fbe1: The list toolbar's field-list read check is rolled back to restore the console's first-load budget, and it re-lands with objectui#11984 after objectui#11939's reclaim.
- 16b9d44: A quick-filter value restored from the URL now gets its field's type once the object definition loads, when the field is declared without its type (objectui#12008).
  
  Values restored from the URL arrive as strings. The dropdown bar converts them to the option's value type: `'true'` to `true` for a boolean field, `'2'` to `2` for a numeric option. It did this once, at mount. A field declared without its type, such as `fields: [{ field: 'is_active' }]`, takes its type and options from the object definition, and that definition loads after the list mounts. So the bar converted the value before it knew the type. A shared link such as `?uf_is_active=true` then filtered on the string `"true"`, and the chip counted 1 with no box ticked.
  
  Now, the first time the definition changes a field's type or options, the bar converts that field's starting value once more: the restored value, or the author's default. The box is ticked and the query carries the typed value. A value the user has changed or cleared in the meantime is left as it is. A field declared with its type behaves as before. Nothing is emitted when the conversion changes nothing, so a select field with string options issues no extra query.
  
  The fix also lists every read the bar makes of the object definition and tests each one against a definition that loads late. The label, the i18n scope and the lookup picker already followed a late definition; the starting value's type was the only read that did not. The `tabs` mode and the deprecated `toggle` mode read nothing from the definition.
  
  No export, prop, type or language-pack key changes.
- 16c8810: A calendar view in a list draws every record of the days it shows, not the first 100 records of the object (objectui#12081 item 2).
  
  A list view's calendar used to draw the rows of the list's one unpaged fetch: the first 100 records of the object, with no date condition. A month holding more than 100 matching records was drawn from whichever 100 came first, and the rest never appeared. The only sign was the list's "Showing first 100 records" note. Measured on a contracts calendar with 122 records: up to 22 were never drawn.
  
  - **The list fetches the calendar's visible days.** The query selects the days on the calendar's start field, or, with an end field bound, every span that touches those days. It also selects the records with no start date, which the calendar counts as unscheduled. The view's own filter, the filter panel, the user filters and the search still narrow it.
  - **It walks the window in steps of the fetch batch.** Every request asks for at most 100 records, the same batch as before. The list keeps asking until the window is exhausted, so every record of the month is drawn. It stops at the platform's non-grid ceiling of 2,000 records. It then draws the first 2,000 and shows a note under the calendar naming both numbers, the note the standalone calendar already shows. The "Showing first 100 records" note no longer appears on a calendar.
  - **A declared page size no longer sizes a calendar's fetch.** On a calendar with a start date bound, every step is the fetch batch, whatever `pagination.pageSize` the view declares. A declared size still sizes the window of every other view, and of a calendar with no start date bound.
  - **The rows-per-page picker is no longer offered on such a calendar.** A page size changes nothing it draws. The other views that offer it keep it.
  - **Moving to another month fetches that month.** A move inside the window already fetched, such as switching to a week of the same month, fetches nothing. The calendar keeps drawing while the next window loads, and keeps the month it moved to.
  - **Unchanged:** the grid's paging and its requests, every other view's one fetch batch, and a calendar with no start date bound. A calendar rendered on its own, outside a list, still fetches as before.
  
  **Clause-②: yes (widening)** — `ObjectCalendarComponentProps` gains one optional member, `onVisibleRangeChange?: (range: { start: Date; end: Date }) => void`. `ObjectCalendar` calls it on mount and whenever navigation or a view change moves the days it draws. `start` is local midnight of the first day drawn and `end` local midnight of the day after the last. The `object-calendar` renderer forwards it from a host, like the other callbacks, only when the value is a function. Nothing else on either package entry changes: no export is added or removed, no existing member changes type, and no locale key is added.
- 023f00d: A create form asks its fields the create question, so a role that may create
  records but not edit them can fill and submit the form (objectui#12082). Every
  console affordance that offers a write now reads the grant it exercises from
  one map.
  
  **The defect.** A create form gated each field on `checkField(object, field,
  'write')`, whose fallback for a field the permission set does not mention is
  the object's `allowEdit`. Under a grant of `allowCreate: true, allowEdit: false`
  every field of the create form rendered disabled, the outbound filter stripped
  every field from the body, and the save posted an empty record that the server
  refused for its required fields — while the server accepts the same create.
  
  **The server's insert rule, which the create question follows.** The server's
  field-level write step refuses a write that names a field whose explicit
  field-level entry has `editable: false`; a field with no entry passes it, and
  object admission decides the operation (`allowCreate` for an insert,
  `allowEdit` for an update). So a create-form field now reads its explicit entry
  when there is one and the object's create grant when there is none. A field the
  permission set marks `editable: false` stays disabled and out of the body.
  
  **Clause-②: yes (widening)**
  
  - `@object-ui/core` exports the affordance-to-grant map: `AFFORDANCE_GRANTS`
    (one row per affordance: the CRUD-affordance bit it needs, the object grant it
    exercises and, for an affordance that offers fields, the field question it
    asks), `resolveAffordance` (managed-object policy ∧ the server's effective API
    operation set ∧ the caller's grant, with the row's `userActions` predicates
    surfaced only when all three allow it), `resolveFieldAffordance`,
    `formFieldsAffordance`, and their types (`ConsoleAffordance`,
    `FieldAffordance`, `AffordanceGrant`, `FieldAffordanceGrant`,
    `AffordanceGrantRow`, `AffordanceGrantPrincipal`, `FieldAffordancePrincipal`,
    `AffordanceSource`, `AffordanceVerdict`).
  - `@object-ui/permissions`: `checkField`'s action accepts `'create'` beside
    `'read'` and `'write'`. `MePermissionsProvider` answers it from the explicit
    field entry when there is one and from `allowCreate` otherwise; the
    role-based `PermissionProvider` answers it as it answers `'write'`.
  
  **Behaviour, by package.** With no permission provider mounted every grant
  still reads open, as before.
  
  - `@object-ui/plugin-form`: every `ObjectForm` layout's fields and outbound
    filter ask the question of the form's mode (create or edit). The form-wide
    lock, with its "You don't have permission to …" notice, also engages when the
    caller's object grant for the form's mode is denied, not only when the
    managed-object policy or the effective API operation set closes it. A
    create-mode `MasterDetailForm`'s line cells ask the create question of the
    child object, since every line there is a new record.
  - `@object-ui/app-shell`: the record page's Edit and Delete (and the record
    body's in-place editing) read the caller's update / delete grant; they read
    none before. The import wizard's write targets ask the create question, so a
    caller offered Import keeps every field the insert accepts. List New / Import,
    the related lists and the Attachments panel read the map with the verdicts
    they had.
  - `@object-ui/fields`: a lookup's "Create new" reads the create grant (and the
    managed-object policy and operation set) of the object the field references;
    it read no grant before.
  - `@object-ui/plugin-grid`: row Edit / Delete, in-place editing, the template
    download and the add-record row read the map; the add-record row now also
    honours the object's managed-object policy and effective `create` operation.
  - `@object-ui/plugin-detail`: `record:details` in-place editing reads the
    caller's update grant; the detail header's object gate adds the effective
    operation set.
  - `@object-ui/plugin-list` and `@object-ui/console`: bulk Delete, the
    inline-edit toggle and the profile page's language field read the map with
    the verdicts they had.
- e723f58: Screen readers hear the names of more controls in the viewer's language (objectui#12145).
  
  These controls carried an English `aria-label`, so under a non-English locale a screen reader announced their names in English: the docs portal's loading spinner, the record form page's breadcrumb, the `Spinner` status region, a data table's row menu button, the `pagination` renderer's previous and next links, the image crop preview, the percent slider, the record picker's grid, the AI composer's send and stop button and an attachment's remove button, the designer's undo and redo buttons, minimap, version history and back button, a dismissible record alert's close button, the bulk-action bar, and the mobile view switcher. Each name now comes from the language packs. English names are unchanged, with two small exceptions: the spinner now reads "Loading…", and the pagination links read "Previous page" and "Next page", the same words the data table pager uses. Sighted use is unchanged.
  
  Added: eight language-pack keys in all ten packs: `help.loadingDocumentation`, `common.breadcrumb`, `table.rowActions`, `fields.image.cropPreview`, `fields.percent.slider`, `designer.canvasMinimap`, `designer.versionHistory` and `grid.bulkActions`. Every other name reuses a key that already holds the same words. The exported `en` pack, and so `TranslationKeys`, gains these eight members. `PromptInputAttachment` (exported through `AIElements`) takes an optional `removeLabel` prop that names its remove button; without it the button keeps its English name.
- 5dd583f: A gallery card whose title field is a lookup now shows the referenced record's name, not `[object Object]` (objectui#12188).
  
  The card title printed the title field's value as plain text. A lookup value read through `$expand` is the related record, so the title read `[object Object]`. This showed on a record page's related list at phone width, which draws its rows as these cards titled by the first column: the organization page's Members tab showed `[object Object]` where the desktop grid showed the user's name. It also showed on any gallery view whose title field is a lookup. A lookup id that was not expanded printed as the raw id.
  
  - A title field of type `lookup`, `master_detail`, `tree` or `user` now renders through the same cell renderer the grid and the card's own detail rows use. An expanded record shows its name. A bare lookup id is looked up and shows the record's name, as it does in the grid.
  - The card's tooltip and its letter tile read an expanded record's display name instead of `[object Object]`.
  - A plain text title is unchanged. The title text is now read the way the record's display name is read everywhere else: surrounding spaces are trimmed, and a value that is blank after trimming or is a list of values is not used as the title. Those cards fall back to the record's display name, as a card with an empty title field already did.
  
  Nothing is added to the package entry: no export, prop or type member.
- f5b66bf: An empty gallery draws the same empty state as an empty grid, translated, instead of "No items to display" in English (objectui#12217).
  
  `ObjectGallery` used to draw one hard-coded English line, "No items to display", whenever it had no records, in every locale. It also ignored the view's authored `emptyState`, because `ListView` drew its empty state only for the `grid` visualization and handed an empty gallery the empty list.
  
  - **Under `ListView`** (an object list or an interface list page shown as a gallery), the gallery now draws the grid's empty state. That is the view's authored `emptyState` (`title` and `message` resolved against the display locale, its `icon`) when there is one, and otherwise the localized default copy: the first-run message, or the no-matches message when the user's search or filters or the view's own filter emptied the list. The add-record action appears as it does on the grid.
  - **Standalone** (an `object-gallery` node, or `ObjectView`'s own gallery path), the gallery draws the same component with what it knows. That is the localized first-run copy, or the view-filter message when its own `filter` emptied its own query. The `object-gallery` node declares no `emptyState`, and the standalone gallery has no add-record control.
  
  The copy uses the `list.*` keys the grid already used, so every language pack already carries it. Nothing is added to the package entry: no export, prop, type member or language-pack key.
- 3092aca: A grid's inline-edit save no longer overwrites a concurrent write without a word (objectui#12292). The grid's default row save and "Save All" now send each row's `updated_at` as `If-Match`, the way the record forms and the record page's inline edit already do. A stale grid edit is refused with `409` instead of landing with a `200`. The refusal opens the same conflict dialog the record page opens (`ConcurrentUpdateDialog`, offering Reload latest, Overwrite anyway or Cancel). After a save, the row's next save sends the token of the record the server answered with, so saving the same row twice does not conflict with your own first save.
  
  The rows now carry that token. An inline-editable grid, and a list view in inline-edit mode, add `updated_at` to the query's `$select` even when no column shows it. Before, the token was missing from every row unless a column displayed it, so there was nothing to send.
  
  "Save All" reports each row on its own. A row that is refused (a conflict you cancel, a validation error) stays pending and flagged, and the rows that saved are cleared, not reported as failed and not sent again. Nothing the server accepted is rolled back.
  
  **Type change, additive.** `DataTableSchema.onBatchSave` may now resolve with `{ failed: Array<{ rowIndex, error }> }`, naming the rows that did not persist by the `rowIndex` they were handed. The table keeps and flags exactly those rows. A handler that resolves with nothing or rejects is read exactly as before, so existing handlers need no change.
- a311b6a: A list view tinted by a field that is not one of its columns now colours its rows (objectui#12376).
  
  `ListView` builds each request's `$select` from its columns plus the fields its view bindings, grouping and row predicates read. It did not add the row colour's field (`rowColor.field`), so a list whose `rowColor` named a field that was not a column fetched rows without it, and no row was tinted, with no error. The field is now requested, through the same gate as the other added fields: a field the viewer may not read, or one the object does not declare, is not requested.
  
  Nothing is added to the package entry: no export, prop or type member.
- 7a5f4c1: Studio Data pillar layout (objectui#12450, epic objectui#12446).
  
  - **Seven flat tabs.** Records, Form, Validations, Hooks, Actions, API and Settings sit in one underline tab row when the content column is 1000px or wider. Below that, the last five fold back into "Advanced ▾", whose trigger keeps its own name whichever panel is open. A container query on the content column decides the fold, so it also responds when the field inspector opens beside the column.
  - **Object header buttons.** The object header gains an Object settings button, which opens the Settings panel, and a More button. Add field moves from the header row into the More menu. It is also still in the grid's "+" column header and in the form designer.
  - **Records toolbar and grid.** The Records tab drops the framed card and the body padding around the list, so the toolbar, grid and footer run flush with the column. Its toolbar is the list's wide form: Hide fields, Filter, Group and Sort as labelled buttons, then Refresh, Search and Add record. There is no density control.
  - **List search button name.** The list toolbar's icon-only Search button now has an `aria-label`, like Refresh. When a keyword is active, its accessible name is "Search: KEYWORD" instead of the bare keyword.
- 3821a3a: List toolbar: the Filter, Export and Add record buttons keep an accessible name when they render icon-only below the `sm` breakpoint (objectui#12500). Each carries an `aria-label` from the same i18n key as its visible label. With filters active, the Filter button's name carries the count through the new `list.filterActive` key ("Filter, {{count}} active"), added to all ten locale packs.
- 3eb3ec1: The console's list toolbar no longer has a write into the shared view, and the data-source method that write used is retired (objectui#12504).
  
  **BREAKING:** `DataSource.updateViewConfig` is removed from `@object-ui/types`, and `ObjectStackAdapter.updateViewConfig` is removed from `@object-ui/data-objectstack`. The capability gate that only that method read goes with it: `ObjectStackAdapter.setSystemCapabilities`, the `systemCapabilities` option of the adapter constructor and of `createObjectStackAdapter`, `VIEW_CONFIG_CAPABILITY`, `ViewConfigPermissionDeniedError` and `isViewConfigPermissionDeniedError`. A class that implements `DataSource` and keeps an `updateViewConfig` method still compiles, but nothing calls the method any more; an object literal annotated as `DataSource` that carries it is refused as an unknown property. Code that calls `updateViewConfig` through a `DataSource` or an `ObjectStackAdapter`, or imports one of the gate names, no longer compiles. To change a view for everyone, save the view: `createView` / `updateView` on the data source, or the console's view editor, which writes through the runtime metadata seam.
  
  Since objectui#12418 and objectui#12474, the toolbar's sort, column layout, density and Hide Fields are each user's own list state, so the toolbar write had no caller. The view editor's explicit save is now the one write path to the shared view, and it is unchanged.
  
  Personalization rows that earlier consoles wrote into `/meta/view` stay readable: the overlay marker, `narrowPersonalizationOverlay` and `listViews()` exclusion still apply to them. Nothing new writes such a row.
  
  `@object-ui/i18n` drops `console.objectView.viewConfigPermissionDenied` from all ten packs. It was the toast the retired write raised when the gate refused it. The other packages change only in comments and tests that named the retired path.
- 646caea: The object list's chrome sits on fewer rows (objectui#12528).
  
  - **The view description no longer takes a row above the toolbar**, so the toolbar sits at one height with or without one. The console's view tab strip draws it on the active tab: as the tab's tooltip and as the header of its ▾ menu. `ViewTabItem` gains an optional `description` (already resolved, already gated on `appearance.showDescription`; `false` still shows it nowhere). A `ListView` with no host tab strip (the console below `sm`, any other host) draws it as an info control at the start of its toolbar row.
  - **The sort popover's standing note about linked columns is an info control** beside the popover's title, the note as its tooltip, instead of a paragraph that took about half the popover on every open. One line (`list.sortRelationalPicked`, in every locale pack) says that a linked column sorts by the stored ID, only while the current sort names one.
  - **One footer row on an aggregated list.** `ObjectGrid` gains an `onColumnSummaryChange` host prop: when it is passed the grid draws no summary row of its own and reports, in column order, what that row would draw. `ListView` passes it and draws the summaries at the right of its record-count row, truncated with the full text as their tooltip.
  
  **Clause-②: yes (widening).** Two optional members widen published types: `ViewTabItem.description` in `@object-ui/plugin-view` and `ObjectGridComponentProps.onColumnSummaryChange` in `@object-ui/plugin-grid`. Both are host props on React components, never authored metadata.
- 79c1996: The list toolbar's Display menu now closes once a layout is chosen (segmented or dropdown switcher), returning focus to the Display button, as Escape already does; the panel's toggles (row numbers, inline edit, density, hidden fields) keep it open (objectui#12621).
- 0171c24: The list toolbar draws Filter, Sort and Display as 28 px icon buttons at every width, on every list that mounts it: app object lists, Setup lists and related lists (objectui#12695). Filter shows a funnel, Sort the up-and-down arrows, and Display the sliders, which Filter used to draw. None of the three shows a text label any more; each count badge stays beside its icon and is the only text in the tool cluster, so the cluster takes less room beside the view tabs.
  
  Each button keeps its accessible name and now carries a tooltip with it: "Filter" (or "Filter, N active" with filters applied), "Sort" and "Display". Sort gets a name of its own, since the label it was named by is gone. The popovers, the search button and the add button are unchanged, and Sort still hides below the `sm` breakpoint as before.
- 99a0d3b: A list view's `date-range` user-filter chip draws the platform date picker on both bounds, and names them in the console's language (objectui#12784). It used to draw two native date inputs, which take their placeholder and digit order from the machine's locale, labelled with the English literals "From" and "To".
  
  - **How it gets there, with no new dependency.** Each bound resolves the `field:date` widget from `ComponentRegistry` at render time, the seam the list Filter panel and `filter-ui` use since objectui#12743. `@object-ui/fields` registers the picker there behind its lazy loader. With no `field:date` widget registered, a bound keeps the native input.
  - **The labels.** The bounds reuse the language packs' existing `filterBuilder.rangeStart` / `filterBuilder.rangeEnd` keys, which all ten packs already carry.
  - **The value written is unchanged.** Each bound writes `YYYY-MM-DD`, and the chip writes `[]` when both bounds are empty, so the list query gets the same `>=` / `<=` conditions as before.
  - **A typed day is applied.** The picker reads its text on blur and on Enter. A pointer press outside the bound while it holds focus blurs it first, so the text is read before the chip's popover closes on that press. Escape discards.
  
  Clause-②: no — no prop, export, dependency or language-pack key is added or removed.
- 1e6d83b: Data-bound blocks title their "data source could not be resolved" panel in the page's language (objectui#12920, the family of objectui#12910). The panel shows when a block's `dataSource.view` names a view its object does not have. Each block's title now reads `@object-ui/i18n` through `useObjectTranslation`, with the `en` pack's value as the inline default, so a page with no `I18nProvider` draws the same English it drew before.
  
  - **Plugin blocks.** `object-calendar`, `object-chart`, `object-metric`, `object-pivot`, `detail-view`, `record:related_list`, `object-form`, `embeddable-form`, `object-master-detail-form`, `record:line_items`, `object-gantt`, `object-grid`, `object-kanban`, `list-view`, `object-map` and `object-timeline` read one `element.KIND.sourceUnresolved` key per block kind. `object-metric` reads `element.number.sourceUnresolved`, the key `element:number` already reads for the same sentence. The three forms share `element.form.sourceUnresolved`. `record:related_list`'s panel for a failed `parentDataSource` read reads `element.relatedList.parentUnreadable` ("This related list’s parent record could not be read").
  - **`@object-ui/react` panel defaults.** `ElementDataSourceErrorPanel` with no `title` reads `element.component.sourceUnresolved`, and `NoDataSourcePanel` with no `title` reads `element.component.noDataSource`. A passed `title` still wins, an empty string included. Props and markup do not change.
  
  Clause-②: yes
  
  The new keys in `@object-ui/i18n` widen its exported `TranslationKeys`. No prop, input or export of these packages changes.
- b7fe09e: The list's quick-search box and the record pickers' type-ahead are no longer offered on an object whose search resolves to no field, and a refused search shows the server's message (objectui#12966, the console half of objectstack#24284).
  
  objectstack now answers a non-blank `search` over such an object with `400 INVALID_FIELD` (`param: 'search'`) instead of every row. The common shape is a junction object: two lookups and a composed formula title, with no `searchableFields` declared.
  
  - **The list toolbar** decides with the spec's `resolveSearchFieldResolution`, over the object definition with `internal: true` fields left out and the object's own `searchableFields`, the inputs the engine uses. When the set is empty the search box is not drawn, and a term restored at mount is not applied. Until the definition is read the box is drawn, as before; the list is loading for that read anyway, since its data fetch waits on it. A list whose data source serves no definition keeps the box. A view's `searchableFields` does not make such an object searchable: the server refuses that override outside the object's set.
  - **`RecordPickerDialog` and `LookupField`'s inline dropdown** draw no search box on a target whose set is empty. They still list the records, and the dialog still pages them. An unknown target schema keeps the box.
  - **A refused search** on a list now shows the server's sentence, which names the object and the two remedies, in place of the generic "query was rejected" copy. The record pickers already showed the server's message.
  
  Nothing is added to either package entry: no export, prop or type member.
- fe11eb1: A list view draws a `referenceVia` pointer column's record when its columns do not show the type half (objectui#13036).
  
  A pointer column (objectui#12608) resolves its record from the row: it reads the sibling field the column's `referenceVia` names. A list's `$select` asked for the shown columns and its other harvested fields, but never for that sibling, so a list showing `record_id` without `object_name` drew the raw record id. Both projection builders now ask for the sibling of every shown pointer column: `ListView`'s own fetch and the fetch a grid makes for itself, grouped or not. A sibling the viewer may not read, or one the object does not declare, is not asked for; such a row keeps the stored text, as a row whose sibling is blank does.
  
  Nothing is added to the package entry: no export, prop or type member.
- a57d80a: An ungrouped list view now asks for the object's declared `nameField` in its `$select`, so the bulk confirm step lists each record's name rather than `Record #ID` when no column shows that field. The field is fetched, not drawn, and goes through the same known-field and field-permission gates as the list's other harvested fields.
- f22b980: A list view fetches a shown column's declared `dependsOn` siblings, so a faced column can read them off the row (objectui#13214).
  
  A faced column reads its siblings from the row it draws: the `recipient-picker` face names a stored id by the row's `recipient_type`. A list's `$select` asked for the shown columns and its other harvested fields, but never for those siblings, so a list showing `recipient_id` without `recipient_type` drew the raw user id. Both projection builders now ask for every sibling a shown column's field names in `dependsOn`: `ListView`'s own fetch and the fetch a grid makes for itself, grouped or not. A column authored `hidden: true` pulls nothing; a sibling the viewer may not read, or one the object does not declare, is not asked for. Nothing is added to the view's columns.
  
  Nothing is added to the package entry: no export, prop or type member.
- 5d77c09: feat(types)!: a list view's legacy `options` bag is the `@objectstack/spec` list overlay's bag by reference, `ListViewTimelineConfig` is the list view's own `timeline` block, and `ListViewGalleryConfig` is retired (objectui#6152, round 12)
  
  Clause-②: no
  
  **Narrowed (breaking), `@object-ui/types`.** `@objectstack/spec`'s authoring list view declares no
  `options` bag. Its one home is the flattened list overlay on the view write door
  (`VIEW_METADATA_MEMBERS.listOverlay`), where it is a strict object of the eight kinds that name a
  block, each judged by its own list-view block with every key optional. `ListViewSchema.options` was
  a record of `any` with three named refusals, so `ListViewSchema`, `AnyComponentSchema`,
  `safeValidateSchema` (`objectui validate`), `StrictAnyComponentSchema` and the TypeScript
  `ListViewSchema['options']` accepted what that door refuses. It is now that member's own bag, taken
  by reference, with this package's `kanban`, `calendar`, `gallery` and `timeline` blocks in it, so
  each named refusal gives the same message under `options.KIND` as under the top-level `KIND`. What is
  refused now, and what to write instead:
  
  - A key that is not one of the eight kinds is refused with the spec's own `unrecognized_keys` at
    `options`. `options.grid` gets the spec's guidance: a grid has no per-kind block, so its settings
    (`columns`, `sort`, `filter`, …) are top-level keys of the view. Remove it.
  - An undeclared key in any kind (for example `options.kanban.swimlaneField`,
    `options.timeline.descriptionField`, `options.tree.titleField`, `options.chart.xAxisField`) is
    refused with the spec's own `unrecognized_keys` at that kind. Before this change it was kept and
    never examined.
  - `options.kanban.groupField` is refused by name: write `groupByField`.
  - `options.kanban.cardFields` is refused by name: write `columns`.
  - `options.gallery.imageField` is refused by name: write `coverField`.
  - `options.timeline.dateField` is refused by name: write `startDateField`.
  - `options.calendar.defaultView` is refused by name: the initial view mode is a member of the
    `object-calendar` element (its flat `defaultView`), not of a list view's calendar block.
  - `options.chart`'s legacy axes (`xAxisField`, `yAxisFields`, `categoryField`, `valueField`,
    `aggregation`) are refused: write the dataset-bound block, `chart: { dataset, dimensions, values }`.
  - A value of the wrong type (for example `options.kanban: 42`, or a number where a field name
    belongs) is refused at its path.
  
  The three refusals already in place (`options.kanban.groupBy`, objectui#8365;
  `options.calendar.dateField` / `endField`, objectui#8355) keep their messages, and now report
  `invalid_type` at the key, as the top-level blocks do, where they reported `custom`. Each kind is
  `.partial()`, as the spec's bag is: the renderer reads the bag as a per-key underlay of the top-level
  block, so a required member is not asked of it.
  
  **Changed, `@object-ui/types`.** `ListViewTimelineConfig` is `NonNullable<ListViewSchema['timeline']>`:
  the spec's list-view slot, strict and `.partial()`, with the legacy `dateField` refused by name
  (write `startDateField`). It was the spec's `TimelineConfig` plus `dateField?: string` and a string
  index signature of `any`, so a block with any key compiled.
  
  **Retired, `@object-ui/types`.** The `ListViewGalleryConfig` type export is gone. Nothing in this
  repository used it, and the spec has no element of that shape. Write the spec's `GalleryConfig`,
  which this package re-exports.
  
  **`@object-ui/app-shell`.** The object page's relay writes the spec's spellings into the bag it hands
  `ListView`: `options.kanban.columns` where it wrote `cardFields`, no `options.gallery.imageField`
  beside `coverField`, and no `options.timeline.descriptionField`. What renders does not change: the
  board reads `columns` for its cards, the gallery reads `coverField` first, and nothing drew the
  timeline's nested `descriptionField`.
  
  **`@object-ui/plugin-list`.** `ListView`'s capability gate also reads `options.gallery.coverField`, so
  a bag binding its cover under the spec's key offers the Gallery view; it read only the legacy
  `imageField` there. The README's examples author the top-level per-kind blocks and a dataset-bound
  chart, and no longer show the bag.
  
  **`@object-ui/plugin-timeline`.** `ObjectTimeline`'s nested `schema.timeline` prop takes the new
  `ListViewTimelineConfig`.
  
  What did not move: the renderers' reads. `ListView` still merges each `options.KIND` under the
  top-level block and still reads the legacy spellings, so a view stored before these doors closed
  renders as before; only authored metadata meets the refusal.
  
  **Note added 2026-10-09 (objectui#6152 round 14):** the renderers' reads have moved. `ListView`
  still merges each `options.KIND` under the top-level block, but it reads each kind's declared keys
  only: the legacy spellings, `options.grid` and the undeclared keys a bag carries are no longer read,
  so a view stored with one of them renders without what that key used to bind; see
  `.changeset/6152-list-view-readers-retired.md`. The legacy chart axes (`options.chart.xAxisField`
  and the rest) are still read until the next round on objectui#6152.
  
  **Note added 2026-10-09 (objectui#6152 round 15):** the legacy chart axes are no longer read, in the
  bag or at the top level: a chart block that names no `dataset` binds nothing, and `ObjectChart`
  refuses it on screen; see `.changeset/6152-list-view-legacy-chart-retired.md`.
- 26b0bd2: `ListViewProps.onFilterChange` and `ListViewProps.initialFilters` now name the advanced-filter group by `@object-ui/components`' new name for it, `FilterBuilderRowGroup` (it was exported as `FilterGroup`; objectui#6349, batch 12). The type is the same. Nothing you pass or receive changes shape, and the package entry's exported names are unchanged.
  
  No runtime behaviour changes.
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [c096f03]
- Updated dependencies [d92b2a1]
- Updated dependencies [92f4e2b]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [e8c0b96]
- Updated dependencies [b92329c]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [c000398]
- Updated dependencies [73b5d77]
- Updated dependencies [7b17705]
- Updated dependencies [fc3c2cc]
- Updated dependencies [f9f4a62]
- Updated dependencies [848ba0e]
- Updated dependencies [57d82cb]
- Updated dependencies [de96f3d]
- Updated dependencies [9ca3cac]
- Updated dependencies [c910630]
- Updated dependencies [ce464d9]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [7a2c60b]
- Updated dependencies [055d350]
- Updated dependencies [834c559]
- Updated dependencies [22b503c]
- Updated dependencies [9fc68aa]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [6be0f7a]
- Updated dependencies [db4cb6b]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [ded4494]
- Updated dependencies [d172f63]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [3bf8894]
- Updated dependencies [e06365c]
- Updated dependencies [3035948]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [9844bbf]
- Updated dependencies [cef0eee]
- Updated dependencies [7ebff39]
- Updated dependencies [054fd84]
- Updated dependencies [5275d1f]
- Updated dependencies [7241a81]
- Updated dependencies [74add0c]
- Updated dependencies [aaba865]
- Updated dependencies [f1781be]
- Updated dependencies [5ab2f19]
- Updated dependencies [fbad078]
- Updated dependencies [45d5853]
- Updated dependencies [4f4fc03]
- Updated dependencies [2312bd9]
- Updated dependencies [6d5eb34]
- Updated dependencies [c5406c2]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [2571a3e]
- Updated dependencies [a368ccb]
- Updated dependencies [2a48bd4]
- Updated dependencies [8a55f0c]
- Updated dependencies [c7b30bd]
- Updated dependencies [20c6d35]
- Updated dependencies [417e245]
- Updated dependencies [69bca0a]
- Updated dependencies [023f00d]
- Updated dependencies [158c75d]
- Updated dependencies [7525045]
- Updated dependencies [5af42db]
- Updated dependencies [ce991bd]
- Updated dependencies [3c0f806]
- Updated dependencies [1071393]
- Updated dependencies [5f75cfa]
- Updated dependencies [29b9949]
- Updated dependencies [6757a93]
- Updated dependencies [b7cd5c8]
- Updated dependencies [5330038]
- Updated dependencies [2498a07]
- Updated dependencies [898bd2c]
- Updated dependencies [c9fc10b]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [e723f58]
- Updated dependencies [82bb1d5]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [54159d3]
- Updated dependencies [fa778e6]
- Updated dependencies [334f0cf]
- Updated dependencies [c08c933]
- Updated dependencies [92f979d]
- Updated dependencies [c4dd707]
- Updated dependencies [c4dd707]
- Updated dependencies [7578323]
- Updated dependencies [a491b64]
- Updated dependencies [38bb373]
- Updated dependencies [923504f]
- Updated dependencies [5b45c0d]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [97e7d4e]
- Updated dependencies [5d3f437]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [51c661e]
- Updated dependencies [7af0ab3]
- Updated dependencies [b434f5f]
- Updated dependencies [9f282ef]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [cea429b]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [068a540]
- Updated dependencies [ca45c6d]
- Updated dependencies [093d55b]
- Updated dependencies [b64fda3]
- Updated dependencies [a8051d6]
- Updated dependencies [72594f2]
- Updated dependencies [524136e]
- Updated dependencies [2b06a91]
- Updated dependencies [6f3299f]
- Updated dependencies [065a1cf]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [789cb16]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [37db09f]
- Updated dependencies [ff9df88]
- Updated dependencies [70e843f]
- Updated dependencies [caac3b2]
- Updated dependencies [a2225f9]
- Updated dependencies [5c4deb5]
- Updated dependencies [a8e5b73]
- Updated dependencies [d9d9d98]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [f8267df]
- Updated dependencies [023087f]
- Updated dependencies [9b82ced]
- Updated dependencies [3821a3a]
- Updated dependencies [3eb3ec1]
- Updated dependencies [92c2a69]
- Updated dependencies [518a8e3]
- Updated dependencies [646caea]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
- Updated dependencies [7d0c174]
- Updated dependencies [8ed7e5a]
- Updated dependencies [6c4d00d]
- Updated dependencies [db8ce2f]
- Updated dependencies [726d8c9]
- Updated dependencies [f0e760a]
- Updated dependencies [a5bb7ac]
- Updated dependencies [f78efdd]
- Updated dependencies [8a8bcf3]
- Updated dependencies [f74638c]
- Updated dependencies [278bc29]
- Updated dependencies [ef71a09]
- Updated dependencies [8614705]
- Updated dependencies [619e3f7]
- Updated dependencies [ca7a4c3]
- Updated dependencies [c9e6742]
- Updated dependencies [f62b6ff]
- Updated dependencies [608033b]
- Updated dependencies [c6b7d82]
- Updated dependencies [611566b]
- Updated dependencies [efa9cb4]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [9d857c9]
- Updated dependencies [670ea10]
- Updated dependencies [ff215d9]
- Updated dependencies [71243db]
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [a23e804]
- Updated dependencies [c7462e7]
- Updated dependencies [36e2f7b]
- Updated dependencies [ac59073]
- Updated dependencies [44cb469]
- Updated dependencies [e058d76]
- Updated dependencies [c999d4c]
- Updated dependencies [8df2608]
- Updated dependencies [5483297]
- Updated dependencies [ed43c79]
- Updated dependencies [260ef71]
- Updated dependencies [655e897]
- Updated dependencies [655e897]
- Updated dependencies [020d178]
- Updated dependencies [8d80845]
- Updated dependencies [69a408f]
- Updated dependencies [d2b21a1]
- Updated dependencies [5ff64ef]
- Updated dependencies [64acb7e]
- Updated dependencies [4ff5b6b]
- Updated dependencies [473e5a0]
- Updated dependencies [b279016]
- Updated dependencies [bb6c38c]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [2727527]
- Updated dependencies [3da39ae]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [2cfdc99]
- Updated dependencies [2cfdc99]
- Updated dependencies [8523e81]
- Updated dependencies [1e6d83b]
- Updated dependencies [1e6d83b]
- Updated dependencies [32b492b]
- Updated dependencies [6058bf8]
- Updated dependencies [c219165]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [7f9cc37]
- Updated dependencies [b7fe09e]
- Updated dependencies [025130c]
- Updated dependencies [76f91f8]
- Updated dependencies [ea34d9b]
- Updated dependencies [8aa8e3e]
- Updated dependencies [024b7b6]
- Updated dependencies [cb80001]
- Updated dependencies [909c64e]
- Updated dependencies [9e7e1a5]
- Updated dependencies [2493e85]
- Updated dependencies [d0b9648]
- Updated dependencies [46dbf32]
- Updated dependencies [a928aaa]
- Updated dependencies [47508f3]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [6f877f1]
- Updated dependencies [988aa9f]
- Updated dependencies [1ce0711]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
- Updated dependencies [2d8a8b7]
- Updated dependencies [cbac9d7]
- Updated dependencies [5129caa]
- Updated dependencies [9eb1479]
- Updated dependencies [74e37aa]
- Updated dependencies [961b69f]
- Updated dependencies [52907d7]
- Updated dependencies [f466b0a]
- Updated dependencies [673a71c]
- Updated dependencies [616df65]
- Updated dependencies [f48a4d5]
- Updated dependencies [58798ec]
- Updated dependencies [8803ca5]
- Updated dependencies [e70c21d]
- Updated dependencies [4b92c5a]
- Updated dependencies [06be396]
- Updated dependencies [3650d94]
- Updated dependencies [7c05f21]
- Updated dependencies [8cd4db4]
- Updated dependencies [daeb77f]
- Updated dependencies [eb4552e]
- Updated dependencies [3c3115e]
- Updated dependencies [55e90fd]
- Updated dependencies [9b75509]
- Updated dependencies [b13ea3c]
- Updated dependencies [d7e9e9a]
- Updated dependencies [cf62edf]
- Updated dependencies [0253416]
- Updated dependencies [5d77c09]
- Updated dependencies [3fd8625]
- Updated dependencies [1473757]
- Updated dependencies [d73d987]
- Updated dependencies [12ff256]
- Updated dependencies [35a2b59]
- Updated dependencies [26b0bd2]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [53ee2f8]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [0df67f2]
- Updated dependencies [f962cdc]
- Updated dependencies [b403bb3]
- Updated dependencies [8a25fee]
- Updated dependencies [4016370]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/components@18.0.0
  - @object-ui/core@18.0.0
  - @object-ui/i18n@18.0.0
  - @object-ui/react@18.0.0
  - @object-ui/fields@18.0.0
  - @object-ui/permissions@18.0.0
  - @object-ui/mobile@18.0.0

## 17.7.0

### Minor Changes

- 57a2bc2: Retire the undeclared timeline `metaFields` reads in both packages (objectui#10222).
  
  The spec's `TimelineConfigSchema` is a strict object that declares no `metaFields` member and
  refuses one, yet `ObjectTimeline` read it (through an `as any` cast) to pick the chip fields
  beside each title, and `ListView` read it three times: two field collectors put the listed
  fields into `$expand` / `$select`, and the status / priority auto-projection was skipped when
  the list was present. All four reads are deleted.
  
  **Behaviour change:** a stored interface-page view carrying `options.timeline.metaFields` falls
  back to the default card labels (the built-in `status` / `priority` chips, limited to the fields
  the object declares), and the fields that list named are no longer fetched for it. No such view
  has been found; the stored rows are not censused. A timeline without the key renders and fetches
  exactly what it did before, because `ListView` now projects `status` / `priority` for every
  timeline view.
  
  `cardFields` stays the reserved spelling if authored timeline chip fields are ever asked for;
  nothing is declared.
- ae98f1d: A `chart` list view bound to a semantic `dataset` takes its scope from the dataset:
  a view filter on it is now refused at authoring, and its toolbar no longer offers
  filter controls (objectui#10327).
  
  The dataset shape of the list view's chart builds a node with no filter: the chart
  queries the dataset through `queryDataset` with its dimensions and measures, and a
  dataset's fields need not be the list object's. So a view filter written on such a
  view was accepted and silently dropped, and the chart drew unfiltered totals that
  read as filtered ones. The toolbar Filter builder and the filter chips reached only
  the list's own fetch of the object's rows, never the chart.
  
  **New refusal (`@object-ui/types`).** `ListViewSchema` refuses `filter` — and the
  legacy `filters` alias — on a view with `viewType: 'chart'` whose chart block (`chart`,
  or the legacy `options.chart` bag when no `chart` is declared) names a `dataset`. The
  issue is a `custom` one at the written key, and its message ends with the remedy: a
  dataset chart's scope is written in the dataset. An empty filter array, a chart bound
  to the list object, and a view of another kind that only offers a switch to a dataset
  chart are all still accepted.
  
  **Toolbar (`@object-ui/plugin-list`).** While a dataset-bound chart is on screen, the
  Filter builder and the `userFilters` chips are not rendered. A chart bound to the list
  object keeps both, because its node carries the effective filter.
  
  What an author sees change: a dataset chart view that declared a `filter` now fails
  validation with the remedy above instead of drawing unfiltered numbers. Put the scope
  in the dataset. No example, app or doc in this repository declared such a view; the
  search is on the pull request.
- 974760a: fix(plugin-list): a map list view requests the fields its markers are drawn from
  
  `ListView` builds its `$select` projection from the authored columns plus each
  view kind's per-row bindings. Kanban, calendar, gallery, timeline and gantt each
  had an arm there; the map had none, and the candidate keys named none of its
  bindings. A map view whose columns omit the location field therefore asked for
  `id` plus those columns, and on a backend that honours `$select` every row
  arrived without coordinates: a map with no markers, and no error.
  
  The request shape changes: a map view now also requests the fields `ObjectMap`
  reads off each row — `locationField`, or the `latitudeField` + `longitudeField`
  pair, plus `titleField` and `descriptionField`. They are read through the same
  resolver the map render branch and the view switcher already use (the spec's
  view-level `map` block merged per key over the `options.map` bag), so a bag value
  the view-level block shadows is not requested. A coordinate or title binding that
  names a lookup is also expanded, as the map's own fetch already does; the
  description binding is requested but not expanded, because the marker popup
  renders it as text and cannot draw an expanded record there.
  
  Every one of these fields passes the same checks as the other view bindings: a
  field the current user may not read is never requested, and a name the object
  does not declare is never sent.
- d0c0c7f: The list view's live query sends "Is empty" / "Is not empty" as the spec's `isempty` / `isnotempty` instead of an equality to `null` (objectui#10813). `@objectstack/spec` 17.6.0 and later lower that pair to `$empty`; an earlier reader lowers it to `$null`, as it does the saved view's `is_empty`.
  
  `convertFilterGroupToAST` resolved the pair to `[FIELD, '=', null]` / `[FIELD, '!=', null]`, a null-only test, before `mapOperator` was consulted. The same rule saved into the view is persisted as `is_empty`, which `@objectstack/spec` 17.6.0 lowers to `$empty` (objectstack#20446): so one filter panel answered two record sets, depending on whether the view had been saved. The pair now takes the value-less path like `is_null`, and `mapOperator` gains `isempty` / `isnotempty` arms. The node is `[FIELD, 'isempty', null]`; the spec discards the third slot.
  
  **What moves.** Nothing is stored by this path. Against a 17.6.0 or later server, on a text-like column a row holding `''` is now "empty", and on a multi-value column a row holding `[]` is, matching the server's per-type answer for the saved view. On a `provider: 'value'` list a row with no key at all is now "empty" too: the equality to `null` did not select it there.
- 244d516: A grouped grid over a data source that declares no `queryGroupHeaders` now
  **refuses grouping** instead of grouping a page of rows (objectui#10881,
  maintainer ruling F). Grouping is a property of the query (ruling A on
  objectui#7189): a data source that cannot answer the group header query cannot
  group, so the grid names the member it is missing rather than drawing counts it
  cannot know.
  
  - **`@object-ui/plugin-grid`** — a grouped `object-grid` that fetches its own
    rows over such a source renders an error panel naming `queryGroupHeaders`
    and issues no row query. It used to fetch one window and group it in the
    browser, so every group count was a page slice and a group whose rows all
    fell past the window was missing. Rows handed in WHOLE — a
    `data: { provider: 'value', items }` block, or a `data` prop from a parent
    view that declares no larger `rowCount` — are still grouped in the browser,
    exactly. A host that hands rows in while declaring them one page of more
    (the external-pagination props: `manualPagination`, `onPageChange` and a
    `rowCount` above the rows it handed) is now refused as well, with a sentence
    of its own: grouping needs every record. It used to have that page grouped as
    if it were whole.
  - **`@object-ui/plugin-list`** — `ListView` makes the same refusal, with the
    same sentence, in place of a grouped grid over such a source, and fetches no
    window for it. It used to fetch one window and hand it to the grid as
    `data`, which the grid grouped as if the rows were whole. Rows handed to
    `ListView` in whole are still handed to the grid.
  - **`@object-ui/i18n`** — two new keys, `grid.grouping.needsHeaderQuery` and
    `grid.grouping.needsWholeRows`, in all ten locale packs.
  
  The `Partial` marker described by the pending
  `7189-grouped-grid-partial-disclosure` entry is retired everywhere before any
  release carried it: its three `grid.grouping.partial*` strings, `GroupRow`'s
  `partialLabel` / `partialTitle` props and the notice above the group list are
  gone.
  
  **Breaking semantics (declared `minor` per this repo's version policy):** a
  grouped grid that fetches its own rows over a data source without
  `queryGroupHeaders` — `ApiDataSource`, `ValueDataSource`, or a host adapter —
  grouped the page it fetched in the last release, and now renders an error panel
  instead. So does a grouped grid view in `ListView` over such a source. So does
  a grouped grid handed rows by a host that declares them one page of more
  (`manualPagination`, `onPageChange` and a `rowCount` above the rows handed),
  whatever its data source. To keep grouping, either:
  
  - implement `queryGroupHeaders` on the data source (the ObjectStack adapter
    does), and let the grid fetch its own rows, or
  - hand the rows in whole (`data: { provider: 'value', items }`, or a `data`
    prop with no `rowCount` above it).
  
  Not changed here: while a toolbar search is active, `ListView` over a data
  source that answers the header query still hands a grouped grid its window,
  whose group counts are the window's, because the header query carries no
  search (objectstack#20358).
- e176053: Consolidate the seven lucide icon-name resolvers into one seam (objectui#5935).
  
  Seven modules resolved authored icon names into lucide's runtime `icons` record, each
  with its own copy of the logic: **three different tokenisers** (`split('-')` on five of
  them, `split(/[-_\s]/)` on one, `split(/[-_\s]+/)` on one) and the `Home` -> `House`
  rename on only **four** of the seven. The same authored name therefore rendered on one
  surface and not another — the sidebar-vs-action-bar disagreement objectui#5633 opened
  with. There is now one resolver, `resolveIcon`, exported from `@object-ui/components`,
  and the other six call it.
  
  **The tokeniser is `split(/[-_\s]+/)` with `Home` -> `House` applied universally, and it
  was measured rather than chosen.** Its regression set is empty three independent ways:
  against the authored population, against a maximally-pessimistic every-authored-name x
  every-surface cross-product, and against a bound-free differential over 8,298 spellings
  derived from all 1,767 live record keys — each with a discrimination control that fired
  in the same run. `split('-')` was **not** adoptable: it regresses 4,748 name-surface
  pairs in that last reading, stripping two surfaces of every snake_case and
  space-separated spelling they resolve today.
  
  **What changes for you — all of it widening, none of it removal.** No name that resolved
  before stops resolving: no key of lucide's record contains `_`, whitespace or `-`
  (measured: 0 of 1,767), so whenever the old narrow tokeniser produced a live key the
  wider one produces the same key. Sixteen name-surface pairs start resolving where they
  rendered a fallback or nothing before:
  
  - `layout_dashboard` and `building_2` (and every other snake_case or space-separated
    spelling) now resolve on the shared resolver, `ui:icon`, `ListView`'s empty state,
    `TabBar` and `ViewSwitcher` — they previously resolved only on the action preview and
    the related list.
  - `home` / `Home` now resolves on `RelatedList`, `ListView` and `TabBar`, which carried
    no rename map. `Home` is not a live record key, so this could only ever be a widening.
  
  **What does NOT change: what each surface draws when a name does not resolve.** The seam
  answers `name -> component`, returning `null`, and decides nothing else (maintainer
  ruling 2026-09-03 on objectui#5935). Every call site keeps its own fallback, visibly, at
  the call site: `ui:icon` keeps its `SquareDashed` placeholder and its warning
  (objectui#5631, untouched), `RelatedList` and `ListView` keep their `Inbox` glyph,
  `ActionPreview` keeps its three-character name chip, and the shared resolver, `TabBar`
  and `ViewSwitcher` keep `null`. A two-valued `onUnresolvable` parameter was ruled on and
  then dropped once the tree was measured to have four such behaviours rather than two: a
  lookup function is the wrong place to publish a presentation decision.
  
  `resolveIcon` is newly exported from `@object-ui/components`, which is the only surface
  this adds. `scripts/check-lucide-icon-record-names.mjs` is simplified in the same change:
  its census goes from seven sites to one, and its normalisation stops being a
  widest-common approximation of three disagreeing resolvers — so the under-reporting that
  gate disclosed at objectui#5932 is closed rather than merely bounded.
- 4ca30d0: Two widget prop types anchor their `schema` to exported schema types that extend
  `BaseSchema`, instead of hand-rolled inline literals with no `BaseSchema` in
  their ancestry (objectui#6576, maintainer ruling 2026-08-31 option A; folds
  objectui#6914).
  
  - `@object-ui/types` exports `ObjectGallerySchema` (`type: 'object-gallery'`)
    and `ObjectDataTableSchema` (`type: 'object-data-table'`), each `extends
    BaseSchema`, beside the other `Object*Schema` declarations, with zod mirrors
    of the same names under `@object-ui/types/zod`. `ObjectDataTableSchema`
    declares the two keys the widget was reading behind casts — `drillDown`
    (`DrillDownConfig`, at this change) and `onRowClick` — which no declaration
    carried before.
  
    ⚠️ **Dated note, 2026-09-25 — `drillDown` now takes the table's own shape —
    objectui#10685.** `ObjectDataTableSchema.drillDown` is
    `ObjectDataTableDrillDownConfig`, on both faces: `filter`, `maxRows` and
    `report` are refused by name, and `target` is `'drawer'` or `'dialog'`. None of
    the four was ever read by this block. The rest of this entry is kept as the
    reading of this change.
  - `@object-ui/plugin-list`: the published `ObjectGalleryProps.schema` is
    `ObjectGallerySchema`. Its accept set WIDENS — every `BaseSchema` member is
    writable (`visibleWhen`, a real base member, was a compile error on the
    literal) — and NARROWS in one place: `type` is now required and pinned to
    `'object-gallery'`. `data` stays `Record<string, unknown>[]`.
  - `@object-ui/plugin-dashboard`: `ObjectDataTableProps.schema` (not exported
    from the plugin index) is `ObjectDataTableSchema`. The literal's own
    `[key: string]: any` is gone, so a wrong-typed base member (`visible: 42`) and
    a wrong-shaped `drillDown` are refused, and `type` is pinned to
    `'object-data-table'` instead of bare `string`.
  
  Unchanged on both, stated plainly: an UNKNOWN key still compiles, because
  `BaseSchema`'s index signature is inherited (objectui#5155, open). No runtime
  behaviour changes; the widgets render exactly as before.
- 045d20b: Relationship-target readers resolve a lookup's target from `reference` alone,
  dropping the `reference_to` fallback arm (objectui#6837, half 2).
  
  Maintainer ruling, 2026-08-31, 原文照录: 「objectui不是前端的项目吗?后端的元数据只要
  对,前端按协议执行就行了呀」. Protocol normalization belongs on the SERVER; the front
  end just executes the protocol. objectstack#13847 landed the server half — a
  `field-reference-to-alias` conversion rewrites stored `reference_to` to
  `reference` on the serve path and in `os migrate meta`.
  
  `reference` is the only target spelling `@objectstack/spec`'s `FieldSchema`
  declares. Measured on the installed 17.2.0: it refuses `reference_to`,
  `referenceTo` and `target` with `unrecognized_keys`, each carrying its own
  "Did you mean -> `reference`?" rename, while a nonsense key gets the same
  refusal with NO rename hint and `reference` parses clean.
  
  ## ⚠️ BREAKING for a hand-written schema that spells `reference_to` — read this
  
  **This is a behaviour change for BYO consumers, and it is being stated rather
  than shipped silently.** ObjectUI is usable without an ObjectStack backend
  (`examples/byo-backend-console`), and a hand-written TypeScript schema passes
  through no zod door, so nothing rejects the legacy spelling at authoring time.
  
  **The break surface is narrower than "all BYO consumers", and this is the
  measurement rather than a blanket claim.** Two ingestion choke points stamp both
  snake_case keys from whichever spelling arrived — `MetadataProvider`'s type
  cache for metadata type `object`, and `ObjectStackAdapter.getObjectSchema`. Any
  def that passed either one already carries `reference` and is **completely
  unaffected**. What is affected is exactly:
  
  - **A `DataSource` implementation other than `ObjectStackAdapter`.**
    `getObjectSchema` is a required member of the published `DataSource`
    interface, and the readers call it on the generic `dataSource` (through
    `useSettledSchema` and directly), so a host adapter's object schema reaches
    them raw. Every in-repo example of one is on this path:
    `ApiDataSource`, `ValueDataSource`, `packages/types/examples/rest-data-source.ts`,
    `examples/byo-backend-console/src/mockDataSource.ts`,
    `packages/runner/src/lib/mockDataSource.ts`,
    `apps/site/app/components/galleryDataSource.ts`,
    `apps/console/src/sdui-workbench-preview.tsx`,
    `packages/plugin-grid/demo/bulk-actions.tsx`.
  
  **Measured on this tree, none of those eight emits a relationship target at all** —
  `reference_to` and `reference` are both zero in each, and
  `examples/byo-backend-console` carries no lookup or master_detail field
  anywhere (its only `reference` hits are a vite triple-slash directive and a
  tsconfig `references` array). The single in-repo producer that WAS on this
  surface, `packages/plugin-gantt/demo/main.tsx`, is fixed here at the producer.
  
  ⇒ **If you author object metadata by hand and spell a lookup's target
  `reference_to`, rename that key to `reference`.** Symptom if you do not: the
  target silently fails to resolve, and the affected surface degrades rather than
  erroring — a related list is not derived, a gantt quick filter falls back to the
  distinct values in the loaded rows instead of the referenced object's full
  domain, a tree stops auto-detecting its parent pointer, a lookup cell shows a
  raw id, a chart's group-by labels stay unresolved.
  
  The ingestion choke point now emits a **dev-mode warning** when a def arrives
  carrying only `reference_to` or `referenceTo` and no `reference`. It names the
  object, the field and the offending key, and points at this ruling. Stamping is
  deliberately unchanged, so nothing that worked stops working. It is memoised
  once per **(object name, field name, spelling, target value)** — every segment
  of that key is pinned, in both directions, in
  `reference-keys.legacyWarning-6837.test.ts`.
  
  ⛔ **This warning does NOT cover the break described above, and it is worth being
  exact about that rather than letting it read as mitigation.** It lives in
  `normalizeFieldReferenceKeys`, reachable only through
  `normalizeSchemaReferenceKeys`, which has exactly two production call sites —
  `MetadataProvider` (metadata type `object`) and
  `ObjectStackAdapter.getObjectSchema`. Both of those also STAMP the def, so the
  warning fires precisely where the def still resolves and nothing is broken. A
  hand-written schema served through any OTHER `DataSource` — the break surface —
  reaches a reader raw: it never passes through this code and produces **no
  warning at all**. On that path the failure is exactly as silent as before.
  A reader-side or shared-resolver diagnostic, which would cover it, remains open
  on objectui#6837.
  
  ⚠️ **Dated note, 2026-09-29 — the call-site count above has since moved —
  objectui#7650.** "exactly two production call sites" above held when this change landed
  (`045d20ba8`). Later in this same release objectui#7650 (PR objectui#8868) added a call
  on `MetadataProvider`'s by-name object-schema serve path. Re-measured for objectui#10979
  on `main` at `2eaf5be27`, `normalizeSchemaReferenceKeys` had three production call sites:
  two in `MetadataProvider`, on its list path and on its by-name path, and one in
  `ObjectStackAdapter.getObjectSchema`.
  `.changeset/7650-metadata-item-reference-canonicalisation.md` (PR objectui#8868) states
  what ships; the text above is kept as the reading of this change.
  
  ## What did NOT change
  
  **Every key these readers EMIT is byte-identical**, and that was verified
  mechanically over the whole diff rather than asserted. Eleven of the sixteen
  sites write a target onto a bag whose own contract spells it `reference_to` (or
  camelCase `referenceTo`): the six whose read and write share a line —
  `RecordDetailDrawer`, `RelatedList`, `buildDefaultPageSchema`, `ListView`,
  `FilterConditionField`, `resolveActionParams` — plus five more that read on one
  line and emit on another, and so are just as much emitters: `RecordDetailView`,
  `RecordMetaFooter`, `ObjectGallery`, `fieldEnrichment` (all `reference_to`) and
  `UserFilters` (`referenceTo`). Only the right-hand read narrowed anywhere; the
  emitted key is what its target contract declares, and renaming it would be a
  separate change.
  
  **Three readers were deliberately left alone.** `LookupCellRenderer`
  (`fields/src/index.tsx`), `LookupField` and `UserField` read `FieldMetadata` —
  ObjectUI's OWN contract, whose `LookupFieldMetadata` declares `reference_to` and
  never declares `reference`. They are fed by the emitters above and by published
  example schemas (`examples/schema-catalog/src/schemas/fields-lookup/*.json`), so
  narrowing them would break in-repo producers, and `plugin-grid`'s
  `relationalMetaCopySet.derivation.test.ts` re-derives its read set from exactly
  those three sources — where `reference_to` is recorded with verdict
  `adapter-stamped`. `DetailViewFieldSchema` is likewise untouched.
  
  ⚠️ **Dated note, 2026-09-30 — the stamp, the three readers and the emitted key have since moved — objectui#11070.** Later in this same release objectui#11070 (round 4) retired `reference_to` inside ObjectUI as well. `normalizeFieldReferenceKeys` now FOLDS a legacy `reference_to` / `referenceTo` onto `reference` and no longer stamps `reference_to`, so "Stamping is deliberately unchanged" and "stamp both snake_case keys" above no longer describe what ships. `LookupCellRenderer`, `LookupField` and `UserField` read `reference` only; `LookupFieldMetadata`, `MasterDetailFieldMetadata` and `DetailViewField` (with `DetailViewFieldSchema`) declare `reference`; and the emitters listed under "What did NOT change" write `reference`. A hand-written schema served through a `DataSource` other than `ObjectStackAdapter` that spells only `reference_to` therefore also loses the lookup picker's target and the read cell's name. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
- bd0376d: Read `count` / `value` answers as the contract declares them at six more seams
  (objectui#6917, following objectui#5945 / #6726 / #6840 / #6839).
  
  **One precedence inversion, repaired without deleting the arm.**
  `@object-ui/fields`' lookup chip resolved fetch-on-demand rows with
  `result?.value || result?.data || []` — `value` AHEAD of `data`, the one rows
  member `QueryResult` (`@object-ui/types`) declares. A producer emitting both was
  resolved to the undeclared key. It now reads through `@object-ui/core`'s
  `extractRecords`, whose accepted set is identical (bare array, `data`, `value`)
  and whose order is the contract's. The `value` arm is **kept**: its own producer
  census measured eight live `find()` doubles emitting `{ value: [...] }` at this
  seam (3 plugin-kanban, 3 plugin-calendar, 2 plugin-grid), so deleting it would
  break them. Only the RANK was wrong.
  
  **Five dead arms deleted, each on its own measured zero.** Every module got its
  own census with the control sitting on the producer→consumer join, because
  objectui#6840's zero is seam-local and is not transferable — the same sweep read
  0 producers for `value` at one seam and 5 at another in a single pass.
  
  - `count` at the `DataSource.find()` seam — `plugin-detail`'s reference rail and
    `plugin-list`'s ListView. 0 of 592 `find()` producers emit `count`; controls
    `data` (312) and `total` (150) lit on the same pass. Both adapters'
    `normalizeQueryResult` already fold `count` into `total` below every consumer.
  - `value` at the `client.meta.getItems()` seam — `app-shell`'s help menu and the
    console's Public Forms and Flow Runs pages. **These three do not sit on the
    `DataSource.find()` seam at all**, so they were measured on their own join: 0
    of 28 `meta.getItems` producers emit `value`; control `items` (18) lit. The
    canonical readers of that envelope (`MetadataProvider.extractItems`,
    `MetadataService.getItems`) have never had a `value` arm either.
  
  No producer changes behaviour, because at these five sites there is no producer;
  what changes is that a non-conforming one is refused rather than silently
  absorbed (AGENTS.md #0.1).
  
  `QueryResult` is **not** widened to bless `count` or `value` — a published-type
  change and the maintainer's call, the floor objectui#6726, #6840 and #6839 all
  held. A producer that really speaks either belongs behind an adapter that folds
  it, which is what both adapters already do.
  
  One refusal pin per module, each keeping the live arms green beside the deleted
  one, and — where an inversion actually existed — a case feeding both members with
  different contents, the only input that can tell the two orders apart.
  
  Also repaired: two `plugin-grid` test doubles answered `{ value: [],
  '@odata.count': 0 }` while `ObjectGrid` reads `result.data` / `result.total`.
  Inert only while the arrays were empty; the first row put in one would have been
  silently dropped. Test-only.
- 2a7ac32: Calendar views no longer render on invented field names (objectui#7029; ruled on
  objectstack#13748, director batch #19, option A).
  
  A view that carried no `calendar:` block used to have a complete-looking calendar
  configuration synthesized for it. `ObjectCalendar` has always decided whether it
  has a usable configuration by asking whether a start-date binding is PRESENT, so
  the fabrication short-circuited its own refusal screen — "Calendar configuration
  required" — which existed all
  along and was simply unreachable. Measured on a leave-request object whose real
  fields are `start_date` / `end_date`: every record piled onto today's cell under
  titles resolved through the display-name chain. A plausible, fully wrong screen,
  with zero signal to the author.
  
  Three faces were fabricating, on two independent routes to the same renderer:
  
  - `app-shell/ObjectView` emitted `startDateField: 'due_date'` and
    `titleField: 'name'` into `options.calendar` for every object view;
  - `plugin-list/ListView`'s calendar branch floored the same two bindings at
    `'start_date'` / `'end_date'` one layer down;
  - `plugin-view/ObjectView.generateViewSchema` — the authored `object-view`
    element route, which bypasses `ListView` entirely — carried its own copy.
  
  All three now forward only what the author declared. This converges the calendar
  on the shape its siblings already had: `timelineViewOptions` (objectui#3129
  retired this very literal from the timeline axis), the kanban lane detector
  (ADR-0085, "never invents a field the object doesn't have"), and
  `defaultCalendarFromObject` (a binding, or nothing).
  
  **Behaviour change, loud over silent.** With no binding to forward, ADR-0047's
  capability gate stops offering the Calendar toggle to views that configured
  none, and a view forced onto the calendar renderer reaches the refusal screen
  instead of a wrong one. A view that happened to sit on an object carrying a real
  `due_date` field was rendering by luck; it now refuses until its `calendar:`
  block is written. Correctly configured calendars are unaffected — same fields,
  same render. The same deletion also stops the fabricated name from answering for
  the Timeline switcher, which accepts a calendar binding as a legitimate axis.
  
  The spec half — cross-field validation rejecting a half-written declaration at
  authoring time — is objectstack#13817. This half makes the runtime honest
  independent of which spec version the host pins.
- 5f4514f: Gantt views no longer render on invented date field names.
  
  The half PR #7062 fenced out and reported separately. A view that carried no
  `gantt:` block used to have a complete-looking date axis synthesized for it:
  all three faces floored `startDateField` at `'start_date'` and `endDateField`
  at `'end_date'` — field names no view had written and most objects do not
  carry.
  
  `ObjectGantt.getGanttConfig` takes its flat branch as soon as BOTH date props
  are present, so the fabricated pair short-circuited the renderer's own refusal
  screen — "Gantt configuration required. Please specify startDateField,
  endDateField, and titleField." — which existed all along and was simply
  unreachable from every route. The same fabrication answered ADR-0047's
  capability gate in `ListView.availableViews`, so the Gantt toggle was live on
  every object view in the product.
  
  ⚠️ The premise was MEASURED before anything was deleted, because #7029's
  mechanic is only correct where a refusal path exists and that had never been
  established for this renderer: on the unmodified tree, `ObjectGantt` REFUSES an
  absent binding — it does not render empty, and it does not throw.
  
  Three faces were fabricating, on two independent routes to the same renderer:
  
  - `app-shell/src/views/ObjectView.tsx` — the console object page. The inline
    branch becomes `ganttViewOptions`, the sibling of `calendarViewOptions` and
    `timelineViewOptions`: the declared block spread whole, title floored at
    `'name'`, no date field invented.
  - `plugin-list/src/ListView.tsx` — the render branch AND the capability gate.
  - `plugin-view/src/ObjectView.tsx` — `generateViewSchema`, the authored
    `object-view` element route, which bypasses `ListView` entirely.
  
  **What changes for an author.** A view that declared no gantt configuration is
  no longer offered the Gantt toggle, and one forced onto the renderer reaches
  the refusal screen instead of a plausible, fully wrong chart. A view that
  declared a binding is unaffected — the declared block is forwarded exactly as
  before, every spec key included.
  
  Also corrected: the objectui#3129 note at the top of `app-shell/ObjectView.tsx`
  certified the gantt branch below it as already using the safe two-rung shape.
  It did not. The note now states each sibling branch as measured, and says
  explicitly which fabrication REMAINS — the timeline `'created_at'` floor at the
  two plugin faces, which is routed to a ruling rather than settled
  per-face.
  
  Deliberately out of scope, and left in place: `progressField` / `dependenciesField`
  (not date axes, different absent-value semantics) and the timeline `'created_at'`
  posture conflict.
- 04a67b9: Retire the `'created_at'` timeline date-axis floors at both plugin faces
  (step ③ of the maintainer ruling 2026-09-01, 总监批 #28).
  
  **Breaking, deliberately.** A timeline view that declares **no** date axis anywhere no
  longer renders. `ListView`'s and `ObjectView`'s timeline branches used to hand
  `ObjectTimeline` a `startDateField` of `'created_at'` for such a view; both now forward
  a declared axis or no key at all, and the renderer shows its "declare a date axis"
  refusal instead.
  
  House posture, entered with the ruling: **日期轴永不虚构** — a date axis is never
  fabricated. This is the third and last step of a sequence the ruling ordered and forbade
  reordering: `ObjectTimeline` gained the refusal screen and lost its own internal
  `|| 'date'` floor first (objectui#7459), which by its own measurement changed nothing a
  user could see — precisely because these two faces still supplied a name. They are the
  supply.
  
  The floor was not a harmless default. `'created_at'` is a column nearly every object
  carries, so downstream it was indistinguishable from a real binding and could never
  resolve to nothing — while the `$select` projection is collected from the **declared**
  `timeline` / `options.timeline` blocks and never from this prop. An undeclared view was
  therefore given a timeline bound to a column the query had not requested, and every
  record bucketed into "No date": a screen that looks built, is wrong, and gives the
  author no signal. The ruling also explicitly replaced the written decision that stood on
  the deleted `ListView` line ("`created_at` stays the last resort for a view that
  declares no date axis anywhere") — it was a second, de-facto contract held at one face,
  on the very literal objectui#3129 had retired at the app-shell face.
  
  **Migration.** Declare the axis on the view: `timeline.startDateField` (spec-canonical),
  `timeline.dateField` (legacy alias), or a `calendar.startDateField` — objectui#3129
  established that a calendar binding is a legitimate timeline axis, and it still is. All
  three keep rendering exactly as before; only the *undeclared* case changes. A view that
  really did want records laid out by creation time says so in one key:
  `timeline: { startDateField: 'created_at' }`. The refusal names the accepted keys on
  screen, so an affected view reports its own fix.
  
  `titleField` is unaffected and keeps its `'name'` floor at both faces — it is not a date
  axis. So do gantt's `progressField` / `dependenciesField`, which the ruling scoped out
  for separate evaluation.
- 78ca238: `DataErrorState` accepts the icon props `DataEmptyState` already had, and `ListView`'s
  load-failure panel is now rendered by the error state instead of the empty state
  (objectui#7143; maintainer ruling 2026-09-01, director decision batch #27).
  
  `ListView` rendered its load FAILURE through `DataEmptyState` — the component named for
  the *empty* case — passing it a destructive icon, error copy and a retry action, while
  `DataErrorState`, in the same file and with the same layout, had no consumer anywhere in
  the repo. objectui#7132 closed the accessibility half of that collision (the panel now
  declares `role="alert"` over the empty state's `role="status"` default) and deliberately
  left the structural half alone: `DataErrorState` hardcoded its icon, so the swap was a
  props-surface question plus a visual change rather than a rename.
  
  **`@object-ui/components` — three additive optional props on `DataErrorState`**, mirrored
  from `DataEmptyState` in the same file rather than spelled a second way:
  
  - `icon?: React.ReactNode` — rendered above the title; falls back to the `AlertCircle`
    glyph the component has always drawn.
  - `showIcon?: boolean` (default `true`) — `false` omits the icon container entirely.
  - `iconWrapperClassName?: string` — REPLACES the wrapper's default class rather than
    merging with it, so `""` renders the icon raw. `DataEmptyState` resolves it with `??`
    against its own default and this does the same, against
    `flex size-10 items-center justify-center rounded-lg bg-destructive/10` — the destructive
    square `DataErrorState` already drew.
  
  Same names, same types, same default semantics as the empty state's; nothing existing on
  `DataErrorState` changed, and a call site that passes none of the three renders exactly
  what it rendered before. `illustration` and `action` were deliberately NOT mirrored — the
  ruling pins three props, and this component's retry affordance is already spelled
  `onRetry` / `retryLabel` (plus `children` for a call site that needs its own control).
  
  One non-prop addition rides along, called out rather than folded in: the icon wrapper now
  carries `data-slot="data-error-state-icon"`, mirroring the empty state's
  `data-empty-state-icon`. Without it the wrapper `iconWrapperClassName` governs has no
  name — untestable and unstylable — and migrating a call site off `DataEmptyState` would
  DROP that identifier rather than rename it.
  
  **`@object-ui/plugin-list` — the panel changes component identity, not pixels.** The call
  site passes the same custom icon through the new `icon` prop, the same
  `iconWrapperClassName="mb-3"`, the same title, and the same copy through `message` (the
  error state's spelling of `description`); its retry `<Button>` moves from `action` to
  `children`, which renders at the identical position. `role="alert"`, the
  `data-testid="list-error-state"` hook and `data-error-kind` are untouched. The whole
  rendered delta is two attributes:
  
  - the panel root's `data-slot` becomes `data-error-state` (was `data-empty-state`);
  - the icon wrapper's becomes `data-error-state-icon` (was `data-empty-state-icon`).
  
  Both are renames, not removals. Nothing in this repo styles or selects on either — no CSS
  rule and no test read them — so a stylesheet in a host app targeting
  `[data-slot="data-empty-state"]` to reach *this* panel is the only way to notice, and it
  should be reading `data-error-state` now. Every class on every node, and the glyphs
  themselves, are byte-identical: this is a visual no-op, deliberately, so the review the
  ruling asks for has a small thing to look at rather than a redesign.
- e2b3826: Grid grouping is now **server-side** (objectui#7189, maintainer ruling A): the
  set of groups and every number in a group header — the count and any per-group
  aggregation — come from the query, and the rows inside a group are paged by the
  server.
  
  Before, a grouped grid fetched one window and bucketed it in the browser, so
  both the group set and every header number were properties of the page. On a
  store of 186 records over five business units sized 86 / 61 / 31 / 7 / 1 with a
  100-row page it rendered **two** headers (86, 14) when the rows were stored
  contiguously and five page slices (31 / 31 / 30 / 7 / 1) when interleaved — and
  the records past the window were not on a second page, they were unreachable.
  The same store now renders five headers reading 86 / 61 / 31 / 7 / 1 in either
  order, and every record is reachable through its group's own pager.
  
  - **`@object-ui/types`** — `DataSource` gains an optional
    `queryGroupHeaders(resource, query)`: it answers the group header query
    `@objectstack/spec/ui`'s `compileListViewGroupQuery` compiles (an
    `EngineAggregateOptions`) with one header row per group. Presence is the
    capability; a source that cannot answer it leaves it undeclared.
  - **`@object-ui/data-objectstack`** — `ObjectStackAdapter.queryGroupHeaders`
    posts the compiled query verbatim to the existing `POST /data/:object/query`
    door and answers its `records`. It never degrades: a refusal throws, and a
    body without `records` is refused rather than read as "no groups".
  - **`@object-ui/plugin-grid`** — a grouped grid that fetches its own rows from a
    source declaring `queryGroupHeaders` asks for its headers (one compiled query
    per grouping level) and pages each **open** group's rows with the group's
    own compiled row query (`compileListViewGroupRowsQuery`: the view's filter AND
    the group key, `limit` / `offset` per group); a collapsed group costs no row
    query, `aggregations` are the header query's numbers, and a reference-typed
    grouping key is labelled from the referenced record. Such a grid's column
    sort is the server's, and it no longer shows the `Partial` marker: its counts
    are the query's own. Rows handed in whole are still grouped in the browser
    (exact), and a source with no header query still groups the page it fetched
    and still marks it partial.
  - **`@object-ui/plugin-list`** — `ListView` hands a grouped grid its own fetch,
    with the view's effective filter, when the data source can answer the header
    query, and draws no record-count bar over it. While a toolbar search is
    active it keeps hosting the rows as before: `$search` has no counterpart on
    the header query.
  
  **Breaking semantics (declared `minor` per this repo's version policy):**
  
  - A grouped grid over a capable source sends different requests: one header
    query per grouping level plus one row query per open group, instead of one
    window. A host that counted or mocked the single window sees the new shape.
  - `useGroupedData` takes an optional fifth argument (the server's header rows).
  - `GroupEntry` gains two REQUIRED members: `count` (the group's size — use it
    instead of `rows.length`, which is empty on a server-grouped grid) and
    `keyValues`. Code that only READS a `GroupEntry` is unaffected; code that
    CONSTRUCTS a `GroupEntry` literal no longer type-checks until it supplies
    both.
  - `AggregationResult.value` is `number | null`, `null` being what the server's
    aggregate answered over no values (rendered as a dash, never invented as 0).
  - `@object-ui/plugin-grid` and `@object-ui/data-objectstack` now require
    `@objectstack/spec` `^17.4.0`, the first release that ships the group-query
    compilers.
  
  This supersedes the last paragraph of the pending
  `7189-grouped-grid-partial-disclosure` changeset, which said server-side
  grouping was not built: it now is, and the `Partial` marker described there
  remains only for the data sources that cannot answer the header query.
  
  ⚠️ **Dated note, 2026-09-28 — a source with no header query now refuses
  grouping — objectui#10881.** Later in this same release two sentences above
  stopped describing the grid: that a source with no header query still groups
  the page it fetched and still marks it partial, and that the `Partial` marker
  remains for the data sources that cannot answer the header query. Maintainer
  ruling F retired both. Over such a source a grouped grid that fetches its own
  rows, and a `ListView` hosting a grouped grid, refuse grouping with an error
  naming `queryGroupHeaders`, and the marker is gone everywhere. Rows handed in
  whole are still grouped in the browser. The rest of this entry is kept as the
  reading of this change; the `10881-grouping-needs-header-query` entry states
  what ships.
- 4c2e1d7: Gantt views no longer hand the renderer invented `progress` / `dependencies`
  field names (objectui#7499).
  
  Flavour 3 of the card whose date-axis half landed as `5f4514f7b` — the half its 2026-09-01 ruling ordered carded
  separately and judged on its own terms, ⛔ explicitly forbidding the date-axis
  conclusion from being imported. Two faces floored the pair, and app-shell
  carries neither key (measured: `|| 'progress'` counts 0 there; the control that
  the zero is not a dead probe is that app-shell *does* floor `titleField` at
  `'name'`):
  
  - `plugin-list/src/ListView.tsx` — the `object-gantt` render branch.
  - `plugin-view/src/ObjectView.tsx` — `generateViewSchema`, the authored
    `object-view` element route, which bypasses `ListView` entirely.
  
  **The remedy is OMIT, not refuse — and the asymmetry against the date axis is
  exactly why the date-axis conclusion must not be imported.** A fabricated date
  axis has no legitimate twin: every bar lands on a column nobody declared, a
  whole-chart error, so refusal is right there. A fabricated `progress` /
  `dependencies` name yields a per-row `undefined`, which is indistinguishable
  from the legitimate and common case — most gantt rows have neither. Refusing
  would break that common case; fabricating manufactured a binding the author
  never wrote, whose failure was silent. Omission does neither.
  
  **What changes for an author.** A view that declares neither `progressField`
  nor `dependenciesField` now passes a config carrying neither key, instead of
  `'progress'` / `'dependencies'`. A view that declares one passes the author's
  value verbatim, exactly as before, through both the spec-canonical `gantt`
  block and the legacy `options.gantt` nesting.
  
  The only population whose behaviour actually changes is a schema carrying a
  column literally named `progress` or `dependencies` while NOT declaring the
  corresponding field key — those worked by accident, because the floor happened
  to match the column name. That population was measured across `examples/`,
  `content/docs/**`, the `packages/*/src` fixtures and all 528 JSON/YAML metadata
  files before anything was deleted: it is **empty**. The census and its
  blind-spot reading are in the PR.
  
  Nothing about the refusal screen moves: `ObjectGantt.getGanttConfig` gates on
  the two date fields alone, so deleting this pair cannot resurrect a config —
  `plugin-gantt/src/ObjectGantt.unconfiguredRefusal-7070.test.tsx` is the
  non-regression control and stays green.
  
  ⚠️ One consequence worth recording for objectui#6470, which is NOT touched
  here. `getGanttConfig`'s flat branch reads
  `schema.dependenciesField || schema.dependencyField`. While the floor was in
  place, `dependenciesField` was always truthy through these two faces, so the
  declared legacy singular alias `dependencyField` was unreachable via them —
  shadowed, not read. With the floor gone, a view that wrote `dependencyField`
  now resolves through the alias limb as its `@deprecated` contract already
  promises. No in-repo view declares it (measured: zero sites at either routed
  face), and the alias's own deprecation and retirement remain objectui#6470's
  question, deliberately left alone.
- d80447d: Stop inventing a gallery cover binding, and offer the view switcher only when it
  can switch (objectui#7547).
  
  **The object page no longer floors `gallery.imageField` at `'image'`.** It used
  to supply that key for every object view, declared or not. The screen damage was
  small — `ObjectGallery` collapses the cover area when no record yields a cover —
  but the key fed `ListView`'s ADR-0047 capability gate, which reads
  `options.gallery.imageField`, so **Gallery was offered on every object view that
  whitelisted it**, with nothing behind the toggle. `galleryViewOptions` now
  forwards the view's own declared block (both legacy cover spellings still
  cross-fill each other, and `titleField` keeps its `'name'` display floor) and
  emits no cover key when the view declared none. Same class and same route as
  objectui#7029 (calendar) and `5f4514f7b` (gantt dates).
  
  ⚠️ A view that whitelisted `gallery` without a `gallery:` block loses the Gallery
  toggle. That is the ADR-0047 rule working: it was only ever offered because this
  relay answered the gate on the author's behalf.
  
  **The visualization switcher is drawn for the resolved list, not the whitelist.**
  `showViewSwitcher` was computed from the LENGTH of
  `appearance.allowedVisualizations` — the whitelist BEFORE `ListView` intersects
  it with the capability gate — so a view whitelisting `['grid', 'timeline']` with
  no timeline block drew switcher chrome around a single Grid entry. The predicate
  now lives at the one site that holds both halves. Views whose whitelisted types
  all resolve are unaffected.
- 6712930: The two kanban adapters stop writing the retired `groupField` onto the
  `object-kanban` node they generate (objectui#7773). `groupBy` — the key the
  renderer actually reads — is unchanged and is now the only lane key emitted.
  
  **What was measured, on this branch's base (`a915064e`).** Both adapters emitted
  the key twice:
  
  ```
  packages/plugin-view/src/ObjectView.tsx:1362   groupField: groupBy,
  packages/plugin-list/src/ListView.tsx:2500     groupField: laneField,
  ```
  
  The `object-kanban` renderer never read it: `groupField` has ZERO hits anywhere
  under `packages/plugin-kanban/`, against a control of thirteen `schema.groupBy`
  read sites in `ObjectKanban.tsx` from the same query — so the zero is a reading,
  not a blind grep. The write was inert; the board grouped by `groupBy` and
  `groupField` rode along unread.
  
  **Why it is removed rather than tolerated.** objectui#7322 RETIRED
  `groupField` on this node on both published faces — `groupField?: never` on the
  TypeScript interface and a `retirementTombstone()` in the Zod mirror, which
  refuses an authored value BY NAME. So the adapters were producers emitting a
  node their own published contract rejects. That was harmless only because a
  generated node never reaches the mirror at runtime (`SchemaRenderer` runs the
  structural `validateSchema`, not `safeValidateSchema`) — but the CLI's
  `os check` / `os validate` DO run the mirror, so the identical node was already
  refused when authored by hand and admitted when generated. This closes that
  split.
  
  **What changes for a consumer.** Nothing on any documented path: the renderer's
  behaviour is byte-identical, because it never read the key. A host that
  registers its own `object-kanban` component and reads `props.schema.groupField`
  off the generated node now reads `undefined` — read `groupBy` instead, which
  carries the same value and always did. Graded `minor` rather than `patch` for
  exactly that narrowing, following the repo convention that objectui's own
  breaking changes ship as `minor` (AGENTS.md 版本号策略, mechanically enforced by
  `scripts/check-changeset-no-major.mjs`).
  
  **Who is NOT affected — the boundary is node-local.** Every VIEW-LEVEL
  `groupField` read is untouched and still live: it is a legacy alias of the
  spec's `groupByField` on the kanban *view config*, mapped by
  `normalize-list-view.ts`, and both adapters still resolve lanes through it
  (`ObjectView.tsx`'s `kanbanCfg.groupField ||`, `ListView.tsx`'s
  `groupByField || groupField`). Authoring `options.kanban.groupField` on a
  `list-view` or `object-view` keeps working exactly as documented in
  `packages/plugin-list/README.md`. `groupField` is dead only on the generated
  `object-kanban` NODE.
  
  The two tests that pinned the duplicate write are TURNED, not deleted — they now
  assert the key is absent, so restoring the write reddens them instead of being
  silently re-blessed by a missing assertion.
- edea22a: **BREAKING** — `SchemaRendererProvider`'s `dataSource` prop, and the context
  type every `useSchemaContext()` consumer reads back, are the published
  `DataSource` contract instead of `any`.
  
  **FROM** `dataSource={anything}` **TO** `dataSource={adapter}` — a `DataSource`
  from `@object-ui/types`, or `null` / `undefined` when the host has no adapter
  bound.
  
  ```ts
  // before — compiled, and failed at runtime on the first find()
  <SchemaRendererProvider dataSource={'not-an-adapter'}>
  // before — compiled, and no reader can do anything with it
  <SchemaRendererProvider dataSource={{}}>
  // after
  <SchemaRendererProvider dataSource={adapter}>       // a DataSource
  <SchemaRendererProvider dataSource={undefined}>     // "I have no adapter"
  ```
  
  Both sites are typed `DataSource | null | undefined` — the spelling
  `useSettledSchema` in this same package already used. The two absences are part
  of the contract, not a weakening of it: a Studio preview, a `kind:'react'` page
  rendered before the host's adapter connects, and a widget probe driving
  `apiFetch` alone all render with nothing bound, and every reader in the tree
  already guards for it. What the union refuses is everything that is not an
  adapter: a string, an empty object, a plain data bag, a partial adapter missing
  a required member.
  
  The measured cost, both halves, because the two `any`s have different blast
  radii (measured separately on `origin/main`, whole-repo type-check over the 33
  packages that depend on `@object-ui/react`):
  
  - the **context type** — the `any` that reaches every `useSchemaContext()`
    reader — reds **7 diagnostics at 7 sites in 4 packages**, all of them
    production code or a mocked module factory.
  - the **provider prop** — the injection points — reds **52 diagnostics at 27
    sites in 11 packages**, all but one of them test doubles.
  
  That ordering is the reverse of the prediction on the card: the context `any`
  was expected to be the expensive one because it infects the whole tree, and it
  is the cheap one, because every reader in the tree already guarded and none of
  them ever reached past `find` / `getObjectSchema`. The prop is the expensive
  one, because the injection points are overwhelmingly test doubles that were
  never complete adapters. The full accounting is on objectui#7912.
  
  Two runtime behaviours change, both in the "no adapter" direction and both
  strictly closer to what the surrounding code already intended:
  
  - `@object-ui/components`' `kind:'react'` page passed an empty object as its
    "no adapter yet" stand-in. An empty object is TRUTHY, so it walked past every
    `if (!dataSource)` guard written to catch exactly that state and failed later,
    at the call. It now passes the absent adapter itself, so the guard fires where
    it was meant to. The module-constant identity that stand-in existed for is
    preserved: `null` is a primitive, so the provider's memo is unaffected.
  - `@object-ui/plugin-calendar`, `@object-ui/plugin-gantt` and
    `@object-ui/plugin-kanban` collapse a `null` adapter from the context to
    `undefined` before handing it to their widget, whose prop declares the single
    spelling `dataSource?: DataSource`.
  
  Nothing else moves at runtime: no value flowing through this key changes, and
  no data path is touched. A TypeScript consumer outside this repo that handed
  this prop something other than an adapter now gets a compile error naming the
  key (TS2322 / TS2739 / TS2740), which is why the FROM/TO is spelled out above.
  
  Five `as any` reads of this context in `@object-ui/fields` are gone — they were
  redundant the moment the seam became honest — and `LookupField`'s local
  re-declaration of the imported context as a `Context` of `any`, which laundered
  its `dataSource` read while looking typed, is gone with them. Both directions of
  the contract are pinned against the real compiler in
  `SchemaRendererContext.dataSourceType.pin.test.ts`, and the card's planted
  documentation probe (a bare string in `packages/react/README.md`'s provider
  example) now fails `pnpm check:doc-snippets`, where it used to exit 0 with zero
  diagnostics.
  
  objectui#7912.
- fb82877: `ListViewProps.onSortChange` and `onFilterChange` are declared at the types they
  actually fire with, instead of `any`.
  
  Both were left `any` by the objectui#4528 sweep that named every other prop on
  this interface "at the type each one actually lands on". `dataSource?: any`
  carries its own written justification right there; these two carried none, which
  is what made this an oversight rather than a decision. The visible cost was that
  the package README's documented "With Callbacks" example compiled green on all
  four callbacks while only two of them were constrained by anything: assigning
  `view` or `search` to a `number` inside the block raised TS2322, and assigning
  `sort` or `filters` raised nothing at all.
  
  Each parameter was measured at the emit site rather than read off the
  declaration, and the two are asymmetric:
  
  - `onSortChange` now takes `SortItem[]`. Every emit in the component crosses one
    boundary, `emitSortChange`, and both of its legs carry that element type: the
    array handed in, and `filterPlatformSortableSort`'s return, which is generic in
    the element and so preserves whatever it is given. Normalized-vs-raw therefore
    does not move the type here, only whether platform-unsortable entries are still
    present.
  - `onFilterChange` now takes `FilterGroup`. Its one call site passes the toolbar
    `FilterBuilder`'s own `onChange` value straight through, beside a
    `setCurrentFilters` that is itself state of that type. It is deliberately NOT
    the filter AST `normalizeFilters` / `buildEffectiveFilter` speak — those run
    later on the query-building path and nothing they produce reaches this
    callback. A host receives the builder's group verbatim, which is what lets it
    round-trip back in through `initialFilters`.
  
  Both types were already exported from `@object-ui/components` and already
  imported by this file; nothing new is minted.
  
  Narrowing a callback parameter is contravariant, so the cost falls only on
  handlers that did something with the parameter that `any` alone allowed — a
  handler written `(sort: any) => ...` still compiles unchanged. The cost was
  measured across every in-repo consumer that passes either callback
  (`ObjectView`, in two places, and `InterfaceListPage`) plus every package that
  imports `ListView` at all (`@object-ui/app-shell`, `@object-ui/plugin-map`,
  `@object-ui/console`): all of them still type-check, and no handler needed
  touching. Out-of-repo hosts that destructure or index the parameter in ways only
  `any` permitted will now see a real error, which is the point.
- cb725e7: An unbound map now REFUSES; coordinates are never guessed (objectui#8169, maintainer
  ruling 2026-09-07, decision batch #67, option B).
  
  **Behaviour change, deliberately, with no staged window.** A map with no coordinate
  binding renders
  
  > Map configuration required — declare `map.locationField` or `map.latitudeField` + `map.longitudeField`
  
  in place of the map, instead of painting an empty one. The principle behind
  the 2026-09-01 date-axis ruling (date axes are never invented) and objectui#5953 (a marker title is never
  forged) now covers coordinates as well: bindings are never fabricated, and an unbound
  surface refuses.
  
  Three things moved together, because moving any one of them alone makes the tree worse:
  
  - `@object-ui/plugin-map` — `getMapConfig` loses its default branch, the one that
    returned the field names `latitude` / `longitude` / `location` / `description` when
    the author declared nothing, and `ObjectMap` gains the refusal state above. The
    refusal covers every branch, so a declared block that binds no coordinate field
    (`map: { titleField: 'name' }`) and a half pair (`latitudeField` with no
    `longitudeField`) refuse too — those used to render an empty map under the
    excluded-records notice.
  - `@object-ui/plugin-list` and `@object-ui/plugin-view` — the `locationField: … ||
    'location'` floor each flattener added on the way into the map is deleted. The
    flattened schema now carries exactly what the view declared.
  
  ⚠️ **Deleting the relay floors alone would have widened the guess, not closed it** —
  measured on the card. The floor forced `getMapConfig`'s flat branch, which returns
  `locationField` and no `latitudeField` / `longitudeField`, so dropping it on its own
  would have handed undeclared views the component's three-name default branch instead of
  one name, and records carrying real `latitude` / `longitude` columns would have *started*
  plotting on views that declared nothing.
  
  **Migration.** Declare the binding on any map view that relied on the old defaults:
  `map: { locationField: 'your_field' }`, or `map: { latitudeField, longitudeField }`. A
  record set carrying `latitude` / `longitude` (or `location`) columns no longer plots on a
  view that declared no map block — it shows the refusal, which names what to write.
  Interface pages are unaffected where the object actually has a location-typed field:
  `defaultMapFromObject` derives `locationField` from the object's own field list, which is
  a reading of declared metadata rather than a guess, and is unchanged.
- 31a0d05: Emit the spec-canonical kanban lane key from the object page, and teach the
  capability gate to recognize it (objectui#8193).
  
  `ObjectView` built the view-level kanban config it hands to `list-view` and wrote
  the deprecated alias `groupField` — never `groupByField`, the key
  `@objectstack/spec`'s `KanbanConfigSchema` actually declares — even though it
  already READ the canonical key first. Its sibling producer in the same package,
  `defaultKanbanFromObject` in `InterfaceListPage`, had migrated long before and
  left the reasoning next to itself ("that read-site now prefers the spec key, so
  one key is enough"); the twin was not carried along, so one producer surface
  spoke two vocabularies for one concept depending on which entry point you
  arrived through. `ObjectView` writes into `options.kanban`, which
  `normalizeListViewSchema`'s alias fold deliberately does not reach, so nothing
  corrected it downstream and the legacy spelling was what drove the lanes.
  
  The expression is now the exported `kanbanViewOptions`, the fifth member of the
  `timelineViewOptions` / `calendarViewOptions` / `ganttViewOptions` /
  `galleryViewOptions` family it had been the odd one out of.
  
  **`ListView`'s kanban capability gate changed with it, and had to.** The gate
  consulted the `options.kanban` bag for the LEGACY spelling only, so a producer
  writing the spec key into the bag was invisible to it while still rendering
  correctly — the render branch merges the bag and resolves
  `groupByField || groupField`, so the gate recognized strictly less than what
  renders. Measured before and after: a bag of `{groupBy, groupField}` offered
  Kanban and `{groupBy, groupByField}` did not, so shipping the producer change
  alone would have removed the Kanban toggle from every object view. The gate now
  reads both spellings out of the bag — the same one-question-two-sites repair
  objectui#5042 made for `map` and objectui#7544 for `chart`.
  
  **No alias READ was removed, and the alias is not retired.** Stored metadata
  still authors `groupField`, and every read site still resolves it; `ListView`
  already preferring the canonical key is precisely why the sibling producer could
  drop the alias write. What changed is only what this one face WRITES, plus one
  added rung on the gate.
  
  **Migration.** Nothing authored has to change. If you read
  `options.kanban.groupField` off the schema `ObjectView` produces, read
  `groupByField` (or both) instead — that bag now carries the spec spelling.
  
  The view-level `groupBy` in the same bag is untouched. It is not a spec key
  either — measured against the strict `KanbanConfigSchema`, which refuses it by
  name — but `ListView`'s projection collectors read it, so retiring it needs its
  own producer census and is filed as objectui#8213.
- 474797d: **BREAKING** — the calendar date aliases `dateField` and `endField` are retired
  at both faces (objectui#8355). They are now **declared refusals**: an authored
  value is rejected **by name**, at its own key path, pointed at `startDateField` /
  `endDateField`.
  
  **FROM** `calendar: { dateField, endField }` — accepted in silence, read by
  `ObjectCalendar`'s alias ladder — **TO** a by-name refusal at validation, with
  `startDateField` / `endDateField` as the only spellings that bind the axis.
  
  ```ts
  // before — parsed green, drew a calendar
  { type: 'list-view', objectName: 'task', calendar: { dateField: 'kickoff', endField: 'wrapup' } }
  // after  — refused at validation, naming the canonical keys
  { type: 'list-view', objectName: 'task', calendar: { startDateField: 'kickoff', endDateField: 'wrapup' } }
  ```
  
  **The refusal an author now meets**, verbatim from the arms' own messages (one
  string per arm feeds both the parse-time issue and the `.describe()` metadata):
  
  ```text
  Unrecognized key(s) on this calendar configuration: `dateField`. Did you mean
  `dateField` → `startDateField`? `dateField` and `endField` are the pre-#2231
  objectui spellings of the calendar date axis, retired at both faces by
  objectui#8355. `@objectstack/spec` spells the axis `startDateField` and
  `endDateField` only. ⚠️ This package accepted BOTH legacy spellings green until
  that retirement — they rode a `.passthrough()` straight through
  `safeValidateSchema` into `ListView`'s calendar branch, which flattened them onto
  the generated `object-calendar` node where the renderer's alias ladder read them.
  That ladder is gone, so the key is refused here instead of being kept and then
  ignored. Write `startDateField` for the event start. Kept rather than refused, an
  authored `dateField` binds nothing: the calendar falls through to "Calendar
  configuration required", a screen that names the canonical keys and never the key
  you wrote.
  ```
  
  ⚠️ **The consequence clause is per key, because the two spellings fail
  differently.** `endField` gets the same stem and this tail instead — measured on
  the renderer, not assumed:
  
  ```text
  …Write `endDateField` for the event end. Kept rather than refused, an authored
  `endField` fails even more quietly than its sibling: a calendar that also carries
  a start binding still DRAWS, and only the end of every event is silently dropped.
  ```
  
  On the flat node face the surface noun is `this object-calendar node`. ⚠️ **The
  element's own `calendar` container carries a different tail for `dateField`**,
  because it fails differently and was measured doing so: `getCalendarConfig` reads
  that container WHOLE, so a retired spelling there never reaches the refusal
  screen — the calendar mounts and simply places nothing, every record landing
  under "Unscheduled". `endField` keeps one clause, because it reads the same on
  both.
  
  ```text
  …Write `startDateField` for the event start. Kept rather than refused, an
  authored `dateField` fails without even reaching that refusal screen: this
  container is read WHOLE, so the calendar still mounts and simply places nothing —
  every record ends up under "Unscheduled" with no date to draw it on.
  ```
  
  **ADR-0087 disposition — D2 tombstone, no conversion entry and no migration
  prescription.** The keys stay DECLARED and unwritable rather than being deleted,
  which is the whole of the ruling: every calendar block here ends `.passthrough()`
  and `BaseSchema` does too, so a deleted key is not refused — it is KEPT
  unexamined and then ignored. Nothing in `@objectstack/spec` converts these two
  (the protocol never declared either: `CalendarConfigSchema` is a strict object of
  `startDateField` / `endDateField` / `titleField` / `colorField`, measured on the
  installed pin 17.4.0 with a nonsense-key control on the same call), so there is
  no ledger entry to register and no `objectstack migrate meta` step to ship. The
  channel that reaches an author is the validator, and it now names the key and the
  remedy on all five authoring surfaces this vocabulary has: a list view's
  `calendar` block and its legacy `options.calendar` twin, a named view's two
  nestings under `listViews`, the flat `object-calendar` node face, and that
  element's own `calendar` container. ⚠️ Stated as five surfaces rather than
  "every author" on purpose: a host that builds the node in TypeScript and hands it
  to `SchemaRenderer` never parses the mirror at all — `SchemaRenderer` runs the
  structural core validator, which is dev-only and names no key — so the compiler
  is that population's channel, not this one.
  
  ⚠️ **Dated note, 2026-09-28 — a named view's `options.calendar` nesting is no longer
  judged inside — objectui#7928.** Later in this same release `ObjectViewSchema.listViews`
  became the protocol's strict `ObjectListViewSchema` record, by reference, and that
  record refuses a named view's `options` bag whole (`unrecognized_keys` at
  `listViews.KEY`, naming `options`). So an alias written under
  `listViews.KEY.options.calendar` no longer draws an issue naming the key or the remedy.
  The named view's `calendar` block still does: the protocol refuses the alias there as an
  unrecognized key, and this entry's check adds the pointer at the key beside it. A stored
  body that `@object-ui/app-shell`'s `ViewPreview` relays has its `options.calendar` folded
  onto the `calendar` block first (`foldStoredListOptions`). The list view's two nestings
  and both `object-calendar` surfaces are unchanged; `calendar-date-alias-refusal-8355.test.ts`
  in `@object-ui/types` re-derives each surface. `.changeset/7928-listviews-by-reference-fold.md`
  (PR objectui#10821) states what ships; the text above is kept as the reading of this change.
  
  ⚠️ **Why this is `minor` and not `major`.** This repository forbids `major` in a
  changeset: the fixed release group's major tracks `@objectstack`'s, so any
  `major` here would push all of it off that cadence
  (`scripts/check-changeset-no-major.mjs` enforces it). objectui's own breaking
  changes ship as `minor` with the break spelled out, which is what this entry is.
  
  **What broke silently before, and why the two halves ship together.** An earlier
  attempt removed the renderer's alias ladder on its own. The producer kept
  spreading the authored block flat onto the generated `object-calendar` node, so
  the alias still arrived, nothing read it, and the author met a generic "Calendar
  configuration required" screen naming keys they had not written. A live authoring
  path stopped rendering with every gate green (recorded on objectui#8651). The
  refusal at the declaration is what turns that silence into a loud, by-name
  failure — so the ladder removal, the producer strip and the tombstones are one
  change and must stay one.
  
  **The four moving parts:**
  
  - `@object-ui/types` — `aliasKeyRefusal()` arms on the view-level `calendar`
    block, on the legacy `options.calendar` nesting (a check, since an open record
    declares no member — `custom` there, `invalid_type` at the declared slot), on
    the flat `object-calendar` node face, and on that element's own `calendar`
    container; plus a `.check()` on `ObjectViewSchema` for a named view's two
    nestings. `z.input` of each arm is `undefined`, so the TypeScript face carries
    `dateField?: never` / `endField?: never` and `tsc` refuses the key at the
    authoring site as well.
  - `@object-ui/plugin-calendar` — `getCalendarConfig` reads the declared
    spellings only; the `CalendarAliasRungs` cast target and both read sites are
    gone, and the config memo's dependency list loses the two entries with them.
  - `@object-ui/plugin-list` — the `calendar` branch destructures the two
    spellings out of the merged block and spreads only the remainder onto the node,
    exactly as the kanban branch strips its own stray `groupBy` (objectui#8365).
  - `@object-ui/plugin-view` — **the SECOND route**, and the reason this entry
    moved four packages rather than three. `generateViewSchema` runs when no host
    supplied `renderListView` — the authored `object-view` element — so a named
    view never passes through `ListView`. Its calendar branch spread the authored
    block raw, so removing the renderer's ladder turned a document that DREW into
    one that shows "Calendar configuration required" and nothing else. Measured end
    to end before the fix was written. It now strips the two spellings like its
    sibling, and the `ObjectViewSchema` check is what makes an authored alias loud
    there instead of mute.
  
  ⚠️ **`ObjectViewSchema.listViews` stays UNMIRRORED, and this entry does not
  change that.** That key waits on a maintainer decision about its VALUE TYPE —
  neither the spec's strict `ObjectListViewSchema` nor the local `NamedListView`
  can be the declared value without losing documented behaviour or enforcing 43
  unread members. A `.check()` decides none of it: it declares no value type, puts
  no key in the object's `shape`, requires no `columns`, and refuses neither an
  undeclared key nor the legacy `options` bag. It judges exactly the two spellings
  this entry retires, at the two nestings the producer merges — with pins on each
  of those non-effects.
  
  ⚠️ **Dated note, 2026-09-28 — `listViews` has since been mirrored — objectui#7928.** Later
  in this same release the maintainer's ruling A chose the value type this paragraph waits
  on: `ObjectViewSchema.listViews` is now `@objectstack/spec`'s own
  `ViewSchema.shape.listViews`, a record of the strict `ObjectListViewSchema`, by reference
  on both faces. It is in the object's `shape`, a named view needs `columns`, and the
  record refuses an undeclared key and the legacy `options` bag whole. The named-view check
  described here and in the `@object-ui/types` bullet above now reads the protocol's own
  refusal at `listViews.KEY.calendar` and adds the pointer at the key; it no longer walks
  the `options.calendar` nesting, so "a named view's two nestings" and "at the two nestings
  the producer merges" now hold for the `calendar` block only.
  `.changeset/7928-listviews-by-reference-fold.md` (PR objectui#10821) states what ships;
  the text above is kept as the reading of this change.
  
  ⛔ **Not a producer-side fold.** Normalising `dateField` to `startDateField` in
  `ListView` (option A) was put to the director seat and refused as the end state:
  it keeps a second spelling alive at the producer, which is the lenient alias
  AGENTS.md #0.1 names. The aliased view therefore produces **no** date binding,
  and the author is told why at the door instead.
  
  ⚠️ **Upstream's refusal suggests the wrong canonical key for `dateField`, and it
  is a typo-distance suggester rather than a declaration.** Re-derived by running
  the installed pin (`@objectstack/spec` 17.4.0), with controls in the same pass:
  `CalendarConfigSchema`'s `strictObject` options carry `surface` and `history` and
  no `aliases` entry, so the protocol declares nothing about either spelling. The
  "Did you mean `dateField` → `endDateField`?" an author meets is a fallback
  `findClosestMatches` Levenshtein suggestion budgeted `max(2, floor(len/3))`:
  `endDateField` is 3 edits from `dateField` and inside its budget of 3, while
  `startDateField` is 5 and outside it — and `endField`, budgeted 2, reaches
  nothing, which is why it and a nonsense control key both draw no suggestion at
  all. A one-character typo of the canonical key does resolve to `startDateField`,
  so the suggester is working as designed; it simply has no opinion to offer about
  a legacy alias.
  
  ⇒ **nothing upstream says `dateField` means the end of an event.** The hazard is
  author-facing rather than contractual: someone who copies that suggestion writes
  `endDateField` and binds the END of an event to the date they meant as the START,
  which every layer accepts. Every objectui read site folds this spelling onto the
  **start** — the retired ladder did, `normalizeListViewSchema`'s `timeline` fold
  does, `resolveTimelineDateBinding` documents it as "the pre-#2231 alias for
  `startDateField`", and this package has published "Deprecated alias for
  startDateField" for releases. So these arms name `startDateField` and a control
  pin holds that line. The remedy upstream needs is an explicit `aliases` (or
  `guidance`) entry for the two spellings so the suggester never answers for them;
  that is upstream's formatter, on upstream's card, and is not fixed here.
  
  ⛔ **The timeline alias is NOT retired by this change.** `timeline.dateField`
  stays a live, accepted alias with live consumers (`normalizeListViewSchema` folds
  it onto `startDateField`, `ObjectView` reads it, and app-shell pins that it still
  renders). The card's own boundaries put the map / gantt / timeline / kanban
  ladders on their own cards; a pin in `@object-ui/types` asserts the timeline
  spelling still parses green, so a later sweep has to say so rather than carrying
  it in silently.
  
  **Pinned** by `calendar-date-alias-refusal-8355.test.ts` (`@object-ui/types`, all
  five surfaces, the per-surface consequence split, the compile-time face, and the
  structural guard that `listViews` stays out of the object's `shape`),
  `ListView.calendarAliasRefused-8355.test.tsx` (`@object-ui/plugin-list`) and
  `ObjectView.calendarAliasRefused-8355.test.tsx` (`@object-ui/plugin-view`) — both
  reading the node their producer really emits through a spy registration, which is
  the only census that can see a key arriving through a spread — and the inverted
  ledger rows in `calendarUnionReads-8651.test.tsx` (`@object-ui/plugin-calendar`).
  
  ⚠️ **Dated note, 2026-09-28 — a named view now refuses `timeline.dateField`, and the
  shape guard is inverted — objectui#7928.** Later in this same release the protocol's
  strict named-view record refuses `timeline.dateField` on a named view as an unrecognized
  key; the `list-view` route still accepts it, and that route is the one the timeline pin
  reads. The structural guard in `calendar-date-alias-refusal-8355.test.ts` now asserts
  the opposite of "`listViews` stays out of the object's shape": `listViews` is a member
  of `ObjectViewSchema.shape`. `.changeset/7928-listviews-by-reference-fold.md` (PR
  objectui#10821) states what ships; the text above is kept as the reading of this change.
- 704e695: **A stray `groupBy` in a view's kanban config no longer overrides the lane, and on a `list-view` document is now refused by name.**
  
  `ListView`'s kanban branch destructured
  `columns`/`groupByField`/`groupField`/`cardFields`/`titleField` out of the merged
  kanban config and spread the **rest** *after* its own `groupBy: laneField`. A
  `groupBy` surviving in that bag therefore **overrode the lane the branch had just
  resolved**. Measured on a distinguishing fixture, not reasoned: with
  `options.kanban = { groupBy: 'LANE_FROM_STRAY_GROUPBY' }` against
  `kanban = { groupByField: 'LANE_FROM_CANONICAL' }`, the generated `object-kanban`
  node carried `groupBy: 'LANE_FROM_STRAY_GROUPBY'`. It read as latent only because
  the one producer that fed it wrote both spellings with the same value by
  construction; that producer was retired separately, and this closes the override
  itself.
  
  Two halves, per the maintainer's ruling (option B — a silent re-grouping was the
  fallback and was **not** taken):
  
  1. **The canonical lane wins.** `groupBy` joins the destructure, so the stray key
     can no longer reach the passthrough spread. A view that authored it now groups
     by whatever `groupByField` / `groupField` / the declared lifecycle field
     resolves.
  2. **The stray key is refused loudly, at the read door of the view.** This repo's
     `.passthrough()` `KanbanConfig` mirror (`@object-ui/types`) declares `groupBy`
     as a named alias refusal pointing at `groupByField`, in the same sentence
     shape `@objectstack/spec` already answers the sibling alias with — "Unrecognized
     key(s) on this kanban configuration: `groupBy`. Did you mean `groupBy` →
     `groupByField`?". The refusal lands on the `list-view` route: wherever
     `safeValidateSchema` validates a `list-view` document (objectui's own
     `objectui validate` runs it and prints the issue), and at the authoring site,
     where `tsc` refuses the declared `kanban.groupBy` (the inferred authoring face
     now carries `groupBy?: never`). The legacy `options.kanban` nesting — where the
     retired producer wrote, and so where stored views carry the key — takes the
     identical message through a check on that untyped bag. A named view's
     `listViews.KEY.kanban.groupBy` on an `object-view` document is not reached by
     this arm; objectui#10321 gives that route its own door, which refuses the key
     in either nesting with the same message.
  
  ⚠️ **Dated note, 2026-09-28 — a named view's `options.kanban` bag is refused whole —
  objectui#7928.** Later in this same release a named view became the protocol's strict
  `ObjectListViewSchema` record, by reference, which refuses its `options` bag by name
  (`unrecognized_keys` at `listViews.KEY`, naming `options`). So the objectui#10321 door no
  longer refuses the key "in either nesting with the same message": it still adds that
  message at `listViews.KEY.kanban.groupBy`, beside the protocol's own refusal of the key,
  and nothing reports `listViews.KEY.options.kanban.groupBy`. A stored body that
  `@object-ui/app-shell`'s `ViewPreview` relays has its `options.kanban` folded onto the
  `kanban` block first (`foldStoredListOptions`). The `list-view` route described above is
  unchanged, its `options.kanban` check included.
  `.changeset/7928-listviews-by-reference-fold.md` (PR objectui#10821) states what ships;
  the text above is kept as the reading of this change.
  
  **Breaking, in the sense worth stating explicitly** (shipped `minor`: this repo
  never declares `major`, and `.changeset/config.json` puts every package in one
  `fixed` group, so levels cannot be split). Two behaviours change for **stored
  data**, which is why this is not a patch:
  
  - a stored view authoring `kanban.groupBy` (either nesting) **re-points its lane**
    — it used to group by the stray key and now groups by the canonical binding, so
    its board may show different columns;
  - the same document, on the `list-view` route, now **fails validation** where it
    used to pass: any pipeline running `safeValidateSchema` over it (objectui's own
    `objectui validate` does) reports one issue naming the key and the replacement.
  
  Honouring `groupBy` as a declared alias was never an option here:
  `@objectstack/spec`'s `KanbanConfigSchema` is a strict object of
  `columns` / `groupByField` / `summarizeField` and refuses it by name — re-measured
  on the pinned 17.4.0 with both controls firing — so legalising it would be a spec
  change, not a renderer widening (AGENTS.md #0.1).
  
  `groupBy` on the generated `object-kanban` **node** is untouched: that is the live,
  canonical lane key `ObjectKanban` reads. Only the **view-level** kanban config
  spelling is refused. The `.passthrough()` itself is kept — an undeclared sibling
  key still rides through, which is pinned as a control.
- 3a9ab02: `list-view`: retire the legacy `title` alias from the export-filename read, and pin the
  `rowActionDefs` exemption at both of `ListView`'s read sites (objectui#8653, the
  objectui#8327 family's `plugin-list` card).
  
  **Two keys, two opposite exits — and the contract chose each one.**
  
  `title` — **retired.** `ListView` resolved its export filename through
  `schema.label || (schema as any).title`. `@objectstack/spec/ui`'s `ListViewSchema`
  refuses `title` **by name** (`unrecognized_keys: ['title']`) while
  `ObjectGridPropsSchema` **accepts** it; `packages/types` mirrors the platform contract
  rather than ruling over it, so declaring `title` on `ListViewSchema` would have made
  this repo accept what the platform save gate rejects. That asymmetry is also why
  objectui#6639 could take the *declare* branch for `ObjectGridSchema.title` one package
  over and this site could not. A parse-based census of `apps/ examples/ content/` and
  `packages/` found **zero** `list-view` nodes authoring `title`, so the retirement costs
  no author a filename. Over that same corpus the instrument reports **three**
  `object-grid` nodes carrying the key: **two authored** ones, both in
  `content/docs/api/schema-reference.md`, plus one that is not authored at all —
  `packages/plugin-view/src/ObjectView.tsx` composes `title: schema.table?.title` onto a
  grid node it builds, so it is a producer writing the key rather than an author
  declaring it. `ObjectGrid`'s own `title` reads are untouched — they remain declared,
  ruled and read.
  
  **Behaviour change, deliberate.** A list view authoring only `title` (no `label`) no
  longer contributes a view segment to the export filename; it exports as
  `<objectLabel|objectName>-<timestamp>.<ext>`. Migration: write `label`, which is the
  declared slot on both this repo's `ListViewSchema` and the platform's.
  
  **Bug fixed in the same expression.** The `as any` was laundering a second defect:
  `X || any` collapses the whole expression to `any`, so an inline locale-map `label`
  (`{ en: 'Quarterly Review', zh: '季度复盘' }` — the shape `BaseSchema.label` has
  published since objectui#4580's revised Q1) reached `sanitizeFileNameBase` **unresolved**
  and exported as `account-[object Object]-….csv`. The read now goes through the spec's
  own `resolveI18nLabel` against the display locale, the same resolver and argument order
  `ObjectGrid` already used at its twin site.
  
  `rowActionDefs` — **exempt, still read, and now pinned.** objectui#5091 ruled this
  producer-derived key NON-AUTHOR SURFACE for `object-grid` on 2026-08-19. The exemption
  extends to `ListView`: the platform refuses the key by name on **both** surfaces,
  `@object-ui/types` declares it on neither mirror, and the producer is the same one
  (`app-shell`'s `ObjectView` derives it from `objectDef.actions` filtered by
  `locations.includes('list_item')`; `plugin-view`'s composes the same key onto a
  `list-view` node). Both read sites now carry the ruling in a docblock, and a new pin
  asserts — at runtime, never by source grep — that the defs still reach the child
  `object-grid` node **and** that a field named only by a row action's `visible` CEL still
  reaches `$select`. Without that second half, deleting the read would have returned rows
  whose predicate operand was never selected: objectui#3501's fail-closed CEL fault
  arriving with a success receipt.
  
  No published type changed: neither key is declared on any face by this change.
- 502eb58: The row/card click props on the view components now declare the modifier
  payload they have always been invoked with (objectui#9357).
  
  `useNavigationOverlay`'s `handleClick` invokes the handler it is given with two
  arguments — the record, and an optional modifier payload (`metaKey` / `ctrlKey`
  / `button`) a host needs to implement Cmd/Ctrl/middle-click. objectui#9360 made
  the hook's own option say so. These components pass a host-supplied prop
  straight into that option, so the value a host writes against them is invoked
  with two arguments too — and every one of these props declared only the record.
  The payload was therefore invisible on the one line a host reads, exactly as it
  had been on the hook.
  
  Thirteen declarations across nine packages now name both parameters:
  
  - `ObjectGridComponentProps.onRowClick`
  - `ObjectKanbanComponentProps.onRowClick` (its sibling `onCardClick`, the other
    arm of the same fallback, already declared both)
  - `KanbanRendererProps.schema.onCardClick`
  - `ObjectCalendar`, `ObjectGantt`, `ObjectMap`, `ObjectTree`: `onRowClick`
  - `ObjectTimeline`: `onRowClick` and `onItemClick`, the two arms of one fallback
  - `ListView.onRowClick`
  - `ObjectGallery`: `onRowClick` and `onCardClick`, likewise two arms of one
  - `RelatedList.onRowClick`
  
  **Source-compatible, and with no refused class.** A one-parameter handler is
  still assignable to the widened signature, and a handler written against the
  widened signature was already assignable to the narrow one — its minimum
  argument count is still one. The second parameter is spelled `any` rather than
  `HandleClickModifiers`, which is the difference that matters for callers: the
  hook's own option names that interface and therefore refuses a handler whose
  second parameter is annotated narrower (objectui#9360 documents that class and
  the one-line remedy). These faces refuse nothing. A host that discovered the
  payload from the implementation and annotated it `React.MouseEvent` — which is
  what actually arrives — keeps compiling. `any` is also the spelling
  `ObjectKanbanSchema.onCardClick` already carries for this same payload
  (objectui#9341) and the one `BaseSchema`'s own `onClick` / `onChange` /
  `onSubmit` use, and it is forced on the published twins in `@object-ui/types`,
  which may not name a type that lives in a package depending on them.
  
  **Runtime behaviour is unchanged.** Nothing is newly called and nothing newly
  passes an argument; only the declarations move.
  
  Three declarations that share the name and the shape are deliberately NOT
  widened, because the value flowing through them is not invoked with the
  payload: `VirtualGrid.onRowClick`, whose second parameter is a row index;
  `ManageViewsDialog.onRowClick`, which receives a view id; and the `data-table`
  family (`DataTableSchema.onRowClick`, `ObjectDataTableSchema.onRowClick`),
  whose renderer invokes with one argument. Widening those would have declared a
  payload that never arrives.
- de5d400: A page size with nothing declared is now the one `@objectstack/spec` declares for
  `pagination.pageSize`, on every surface that has a pager; a fetch that has no
  pager keeps its own fetch batch, which does not follow it (objectui#9853).
  
  "Page size" now means one page, and only where there is a pager. The grid,
  the list and the board read the display default from the spec (`PaginationConfigSchema`)
  instead of keeping numbers of their own, so it is declared once, in the protocol.
  `@objectstack/spec` 17.5.0 declares **50**. The views that fetch one window and
  page nothing keep a fetch batch of their own, with the value they had, so no
  view loses records it could reach before.
  
  ⚠️ **Visible change where no page size is declared.** Measured on the renderer
  with `@objectstack/spec` 17.5.0. Declare `pagination: { pageSize: N }` (or, on a
  board, `limit`) to keep an old count:
  
  | surface (nothing declared) | before | after |
  |:--|--:|--:|
  | `object-grid` that fetches its own rows: rows per page, and the `$top` of each page fetch | 50 | 50 (unchanged) |
  | `object-grid` over inline `data`: rows per page | 10 | **50** |
  | grouped `object-grid`: groups per page | 10 | **50** |
  | grouped `object-grid` over a data source that groups on the server: rows per group page (`$top`) | 50 | 50 (unchanged) |
  | `list-view`, grid view (paged on the server): rows per page, and `$top` | 100 | **50** |
  | `list-view`, every view it does not page (kanban, calendar, gallery, timeline and the rest, and a grouped grid): the one fetch's `$top` | 100 | 100 (unchanged) |
  | `object-kanban` with no `limit`: the board's `$top` | 100 | 100 (unchanged) |
  
  What changed underneath:
  
  - **`@object-ui/plugin-grid`.** `ObjectGrid` falls back to the spec's display
    default on every page it shows, with no local number behind it: if a future
    spec stops declaring the default, the module throws at load instead of
    inventing one. The old "server window" constant is renamed
    `DEFAULT_FETCH_BATCH_SIZE` and keeps its value. Since grouping moved to the
    server, it is read only when the grid groups a window of rows in the browser
    because the server does not group it (a grouping key the principal may not
    read), and never as a page size. The grouped view's rows-per-page selector
    also lists the size in force when it is not one of its fixed steps.
  - **`@object-ui/plugin-list`.** `ListView` splits its undeclared fallback by
    whether the view pages. The grid view, which it pages on the server, falls
    back to the spec's display default. Every other view falls back to a fetch
    batch of 100, the value it had. A declared `pagination.pageSize` sizes the
    window on every view, as before. With no declared size, switching between the
    grid view and an unpaged view now changes the window, so the list fetches
    again: one request, whose `$top` is the fetch batch. That qualifies the
    objectui#10512 note in this same release, which says a switch into a dataset
    chart with no user filter set issues no new request: it still holds when a
    page size is declared. A refused page size still warns, and the warning names
    the fallback that view actually used.
  - **`@object-ui/plugin-kanban`.** The board's default `limit` is renamed from
    `DEFAULT_KANBAN_LIMIT` to `DEFAULT_KANBAN_FETCH_BATCH_SIZE` and stays 100. Its
    diagnostic for a refused `limit` now calls it the board's fetch batch.
  
  The display default follows the `@objectstack/spec` a host installs. A host
  that resolves an older spec gets that spec's default, on every surface alike.
  
  Released as `minor`, not `major`: this repository keeps its major aligned with
  `@objectstack/spec`, so the behaviour change is spelled out here instead.
- e2e8e68: **Behaviour change:** the spec's view-level `map` block on a list view is now read at
  runtime. `ListMapConfigSchema` (objectstack#9340) has been authorable and validated since
  the `@objectstack/spec` 17.1.0 pin — it flows into this repo's own `ListViewSchema` by
  reference — but nothing consumed it: `ListView`'s `case 'map'` forwarded only the legacy
  `schema.options.map` bag, so declaring `map: { titleField: 'title', locationField:
  'location' }` on a view changed nothing and marker titles fell back to the renderer's
  placeholder.
  
  The block now reaches `plugin-map` and drives every one of its seven reads — coordinate
  extraction, marker title and description, and the initial camera. Precedence follows the
  convention the sibling visualization blocks in the same file already set: the view-level
  block wins over `options.map`, per key, exactly as `kanban` / `calendar` / `gallery` /
  `timeline` / `gantt` each merge their spec config over the legacy bag. Both sources go
  through the existing objectui#5177 key whitelist, and the branch still emits the flat
  form, so `getMapConfig`'s objectui#5018 precedence rule ("neither flattener emits a `map`
  key at all") stays true.
  
  The visualization switcher had the same gap with a sharper consequence: the capability
  gate that decides which visualizations are offered also read `options.map` alone, so a
  view binding its coordinates in the spec block was filtered out of its own
  `appearance.allowedVisualizations` and fell back to `['grid']`. The gate now asks the same
  merged config the render seam forwards, so the two cannot disagree — including for a
  binding split across the two sources.
  
  `InterfaceListPage` (ADR-0047 interface pages) forwards the referenced view's `map` block
  for the same reason. It is passed alongside the auto-derived `options.map` rather than
  replacing it, so a partial authored block — `map: { titleField: 'title' }` — keeps the
  derived coordinate binding instead of dropping it.
  
  No defaults are introduced for `zoom` / `center`: an undeclared camera stays undeclared,
  so the fit-to-queried-records behaviour ruled in objectui#5000 is unchanged.
- ca39427: Derive `ViewType` from `@objectstack/spec` instead of re-declaring it
  
  `ViewType` and its zod face `ViewTypeSchema` were hand-written eleven-arm copies of
  the spec's list-view type vocabulary. `@objectstack/spec@17.3.0` added `page` and
  neither followed, so every structure keyed on them stayed total over the copy and
  compiled green while being incomplete — including the one whose doc comment promises
  that "a kind added to the union fails the build HERE". A spec-valid `type: 'page'`
  view was left unresolved and fell back to a grid with no error, no warning and no
  console line, while the published validator accepted it.
  
  Both faces now derive from `@objectstack/spec/ui` `ListView['type']`, and the
  renderer-side structures derive from that in turn:
  
  - `@object-ui/core` exports `ListViewVisualization` and `isListViewVisualization` —
    the visualizations `ListView` draws, which deliberately exclude `page` for the same
    reason the spec's own `VisualizationType` does (a `type: 'page'` view mounts a
    published page through `pageName` rather than drawing records).
  - A spec-valid but undrawable kind still falls back to a grid, but now warns once
    instead of degrading identically to a typo.
  
  Widened surfaces: `ViewType` / `ViewTypeSchema` gain `page`; `UnifiedViewType` gains
  `tree` (it had drifted); the `list-view` SDUI registry offers `chart` and `tree`,
  which the renderer has drawn for releases.
  
  ⚠️ Consumers holding an exhaustive `switch` or a total `Record<ViewType, …>` will
  now fail to compile until they account for `page`. That failure is the point of the
  change — it is the guarantee that was silently lost.
  
  ⚠️ **Dated note, 2026-09-29 — `page` left the vocabulary again in this same release — objectui#11073.**
  Later in this release this repository began resolving `@objectstack/spec` 17.5.0, which removed `type: 'page'` from the list-view vocabulary (ADR-0049 enforce-or-remove). Because `ViewType` and `ViewTypeSchema` are derived from the spec, as this change made them, they no longer carry `page`. A `type: 'page'` view is refused by name at parse rather than being "spec-valid", and the one-time "cannot draw" warning has no kind left to explain. The rest of this change stands: the vocabulary still follows the spec, now in the narrowing direction.
- 2d36552: Pins `@objectstack/spec`, `@objectstack/client`, `@objectstack/formula` and `@objectstack/lint` to `17.1.0`, and adapts the two consumer surfaces the new build moves.
  
  The pin itself is a lockfile refresh — every manifest already declared `^17.0.0`, which admits `17.1.0`, so no dependency range changed. All four move together: a split resolution is what produced the dual-version spec graph that reddened `check:spec-symbols` in this repo's history.
  
  **A `icontains` filter now reaches the driver as a filter.** `icontains` is a canonical `VIEW_FILTER_OPERATORS` member as of `17.1.0`, so an author can declare it on a `ViewFilterRule` and the spec validates it — but `@object-ui/data-objectstack`'s alias table had no row for it, and an unmapped operator is how this adapter shipped an unfiltered query before (objectstack#3948). It is an identity row like `contains`: `icontains` is itself a member of `VALID_AST_OPERATORS`, so the spelling the author writes is the spelling the AST takes, and no case-sensitivity is translated away. Declared rather than left to the table's `?? op` fall-through, on the rule its own parity test states — the AST gate accepting a spelling is not the driver compiling it into a `WHERE` clause.
  
  The same operator reaches the list view's own bridge: `@object-ui/plugin-list`'s `mapOperator` gains an explicit `icontains` arm. The emitted spelling is identical to the input, but the arm is written out rather than left to the `default` passthrough — `icontains` is its own member of `VALID_AST_OPERATORS`, so a raw passthrough is accepted *today*, and depending on that coincidence is what the bridge's own parity test records as how it once stopped discriminating.
  
  `@object-ui/core` adds `onSuccess` to its spec key inventory, so an author writing the key `17.1.0` now declares is no longer warned that it is unknown. That is a diagnostic statement only — the four declared action surfaces still drop the key before it reaches the runner, which is tracked separately.
  
  **A stored view filtering case-insensitively still shows that operator when it is reopened.** `@object-ui/plugin-view`'s canonical-to-builder table is keyed by `ViewFilterOperator`, so `17.1.0` adding `icontains` failed to compile rather than letting the operator reach the FilterBuilder as a raw spelling its dropdown cannot select. It maps to the builder's `containsCaseInsensitive` — the id that authors the spec's `$icontains` — and deliberately not to `contains`, which would quietly rewrite a case-insensitive filter into a case-sensitive one the next time the view was saved.
  
  **The page-editor palette keeps one entry per renderer.** `17.1.0` retires `element:filter` from `PageComponentType` and adds `record:discussion`, leaving the member count at 34 either side — so the swap is invisible to any count-based reading. The stale `element:filter` exclusion is dropped, and `record:discussion` is excluded because it is the *same renderer* as the already-offered `record:chatter`, not because it is unauthorable. Nothing the palette offers changes.
  
  **The console eager-closure ceiling is re-baselined, by maintainer ruling.** The release is roughly 930 KB larger uncompressed and nearly all of it lands in `vendor-objectstack-*.js`, which put the closure past a ceiling that was deliberately sized to catch a 89 KiB regression — the gate refused the bump, correctly. Raising it was escalated rather than taken locally, because gate-strength policy had been ruled the maintainer's; the ruling on objectui#5531 authorised the raise. `MAX_EAGER_CLOSURE_GZIP_BYTES` and the `BASELINE` it is derived from move together in one commit, keeping headroom at 2.00% and below the 91,136-byte regression size the gate must still catch. The gate's *sensitivity* is untouched: a repeat of that regression from the new baseline still fails. No behaviour ships from this file — it is CI policy, recorded here because the version it governs is the one this changeset publishes.

### Patch Changes

- 0427036: On a `gantt` list view, the toolbar's Filter control and the `UserFilters` chips now
  narrow the chart (objectui#10037).
  
  Both controls were offered on a gantt view and changed nothing the user could see.
  `ListView`'s own fetch applies the authored filter, the toolbar's filter group and the
  chips together, but the gantt chart does not draw those rows: it queries for itself —
  its registered renderer takes only the node's `schema` — and the node it was handed
  carried the authored `filter` alone.
  
  The gantt node now carries the same effective filter `ListView`'s own fetch sends, so the
  chart's query honours both controls. The value keeps its identity while its content is
  unchanged, so re-rendering the list does not re-query the chart. The row ceiling from
  objectui#7210 is untouched.
- af243c1: On `tree` and `chart` list views, the toolbar's Filter control and the `UserFilters`
  chips now narrow the view, and on a `gantt` list view the toolbar's Search box now
  narrows the chart (objectui#10250).
  
  These three views run their own query instead of drawing the rows `ListView` fetched.
  The tree and chart nodes carried only the authored `filter`, and the gantt node carried
  no search term, so each control changed `ListView`'s own fetch and nothing on screen.
  
  - The `tree` node and the object-bound `chart` node now carry the same effective filter
    `ListView`'s own fetch sends, as the `gantt` node has since objectui#10037. The value
    keeps its identity while its content is unchanged, so re-rendering the list does not
    re-query the view.
  - `ObjectGanttSchema` declares two optional keys, `search` and `searchableFields`.
    `ObjectGantt` sends `search` as `$search` and, only alongside a term,
    `searchableFields` as `$searchFields` — the pair a list's own query sends. A `gantt`
    list view writes both from its toolbar Search box and the view's `searchableFields`.
  
  Unchanged: the toolbar state still does not reach the query of a `chart` view bound to a
  semantic `dataset`, and the toolbar Search box still does not reach the `tree` or `chart`
  query. objectui#10326 stops offering that Search box on `tree` and `chart` views.
- fb7f38b: fix(plugin-list): a list view whose every authored column is denied by field-level security still sends a `$select`
  
  `ListView`'s `$select` builder drops the authored columns the principal cannot read. When that left no column, it returned no projection, so the request carried no `$select` key and asked the server for every field of the object, the denied ones included. An emptied column list was read as "no restriction", the reading objectui#7215 fixed on `$expand` (objectui#10275).
  
  The builder now asks whether the author declared any column, not whether any column survived the permission gate. An authored list that field-level security empties projects to `id` plus the fields the builder already adds through its FLS-gated routes (the platform columns every object carries excepted, as before): the `$expand` roots, the view bindings (kanban, calendar, gallery, timeline and gantt fields), the grid's grouping fields, and the operands of the row predicates (conditional formatting; the `visible` / `disabled` predicates and `recordIdField` of the row actions, the bulk actions and the object's declared actions; the object's `userActions` overrides). A denied operand is not added back. That is the shape `ObjectGrid` and `RelatedList` (objectui#10186) send.
  
  Graded as defence in depth: ObjectStack's server strips denied fields from every returned row (`FieldMasker`), so nothing leaked from that backend. The projection matters for a backend that does not strip.
  
  Unchanged: a list with no authored `columns` (absent or an empty array) still sends no projection, a partially-denied list projects its surviving columns as before, and nothing is filtered before the permission answer has loaded.
  
  Behaviour to know about: on a backend that honours `$select`, a list whose every column is denied now receives rows carrying only the projected fields, as a list with one readable column already did.
- 59636b3: On `tree` and `chart` list views, the toolbar no longer offers Search (objectui#10326).
  
  Both views draw what they query for themselves, and neither query carries a search
  term: the tree's own `find` sends its filter, its row ceiling and its expansions, and
  the chart's queries, aggregate or dataset, take no term at all. A term typed there
  changed `ListView`'s own fetch, behind the record count and the export, and nothing
  the view drew.
  
  - The Search control is not rendered while a `tree` or `chart` view is on screen,
    whatever the chart is bound to. An authored `userActions.search: true` does not bring
    it back on those views. Grid, kanban, calendar, gallery, timeline, map and gantt views
    keep it as before.
  - A term that is already set, whether the host restored it at mount through
    `initialSearchTerm` or the user typed it on another view before switching, is not
    applied to `ListView`'s own fetch or export while a `tree` or `chart` view is on
    screen. The term is kept rather than cleared: switching back to a view that offers
    Search applies it again, and `onSearchChange` is not called for the switch.
- 5e0af5a: `ListView` no longer strands a server-paginated grid on a page a write has emptied. When a refetch comes back with zero rows past page 1 and the server's `total` says the last page is lower, the pager steps back to that last page and fetches it, showing a loading state in between. Before, bulk-deleting every row of the last page (or a concurrent delete) left the list on that page with the first-run "no records yet" empty state, although earlier pages still had records. A write that leaves the current page non-empty keeps the page, and an object with no records still shows the first-run empty state on page 1.
- 6d1e77c: On a `chart` list view bound to a semantic `dataset`, a user filter that is already set
  no longer narrows `ListView`'s own fetch (objectui#10512).
  
  The toolbar withholds the Filter builder and the `userFilters` chips on such a view
  (objectui#10327), but a filter group the host restored at mount through
  `initialFilters`, or a group or chip set on another view before switching, was still
  applied to `ListView`'s own fetch of the object's rows. That fetch still runs on the
  chart and feeds the record-count bar, so the count was narrowed by a filter nothing on
  screen showed or could clear.
  
  - While a dataset-bound chart is on screen, `ListView`'s fetch and its export apply
    the view's own `filter` only; the toolbar's filter group and the chips are not sent.
  - The held state is kept rather than cleared: switching back to a view that offers the
    controls applies the same group again, and `onFilterChange` is not called for the
    switch.
  - A chart bound to the list object, and every other view, apply the toolbar's filter
    group and the chips as before. A switch into a dataset chart with no user filter set
    issues no new request.
- dddbc27: fix(plugin-list): list filters label a lookup's values by the `displayField` the object definition declares (objectui#10545)
  
  Once a list view's object definition loads, the filter builder's candidates and
  the toolbar's lookup filter read each lookup field's display field off that
  definition. They read `display_field`, then `reference_field`, and never
  `displayField`, the only one of the three `@objectstack/spec`'s `FieldSchema`
  declares. So a spec-compliant lookup's display field never reached the value
  picker, which fell back to its default, `name`.
  
  Both now read `displayField`, and only it. This is the same single spelling
  `@object-ui/plugin-grid` reads off a definition. `FieldSchema` refuses the other
  two: `display_field` with a rename to `displayField`, and `reference_field` with
  a pointer to `referenceVia`.
  
  Behaviour change: a field definition that carries only the refused
  `display_field` no longer sets the picker's display field, and neither does one
  that carries only `reference_field`. The picker falls back to `name`. A stored
  definition served through the ObjectStack adapter still works, because that
  adapter folds `display_field` onto `displayField` when the schema is loaded.
  A definition that reaches the list any other way, such as a host `DataSource`
  or an `objectDef` passed straight to `UserFilters`, needs `displayField`.
  
  The two readers also stop reading `id_field` as the lookup's id column.
  `FieldSchema` declares no id column for a lookup and refuses both `id_field` and
  `idField`, so the picker now always keys a lookup by `id`, its default. A
  definition that carried `id_field` used to make the picker match and emit that
  column's values instead.
  
  Also (objectui#10547): before a list view's object definition loads, the filter
  builder's candidates come from the view's declared `columns`, and that fallback
  no longer reads `options` off a list column. `ListColumnSchema` refuses the key
  with `unrecognized_keys`, so a spec-compliant view never carries it. A select
  field's options now reach the filter builder only from the object definition,
  once it loads, which is where they already came from after the load.
- 4a3d500: `list-view` re-reads its rows when the data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a change to the object it queries (objectui#10572). A write that bypasses the data source — a page action over raw HTTP, a flow, a server action — fires no `onMutation`, so a list on a page used to show it only when the whole page was remounted. The re-read keeps the list mounted; rows a host hands the list inline are still the host's to refresh.
- 9fbbb17: BREAKING (`@object-ui/components`): `RefreshIndicator`'s `ariaLabel` prop is now required and has no default. It used to default to the English literal "Refreshing", so the progress bar on every view that passed no name was announced in English to screen-reader users in every locale (objectui#10580). A `RefreshIndicator` rendered without `ariaLabel` now fails to type-check.
  
  (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  Migration: pass the bar's accessible name from your own translation layer, for example `ariaLabel={t('grid.refreshing')}`. The component renders the string you pass as the bar's `aria-label` and does not translate it.
  
  `ObjectGrid`, `ListView`, `ObjectChart` and `ObjectDataTable` now name their refresh bar in the active locale. The grid and the list read the `grid.refreshing` and `list.refreshing` keys their pull-to-refresh text already uses. The chart reads `chart.refreshing` and the dashboard data table reads `dashboard.refreshing`, both with no English literal behind them, so a host that renders either one with no i18next instance at all gets the key itself as the bar's name.
  
  `@object-ui/i18n`: new keys `chart.refreshing` and `dashboard.refreshing` in every built-in locale pack.
- 0c3f70a: A directly authored `object-grid` or `list-view` node resolves the spec's context tokens in its own filter (objectui#10607).
  
  `filter: [['owner', '=', '{current_user_id}']]` on an `object-grid` or `list-view` node authored
  straight into a page, not reached through `object-view`, went out on `$filter` as the literal
  token: neither package called `@object-ui/core`'s `resolveFilterPlaceholders`. Each now resolves
  the node's own filter once through that shared resolver, with the session scope the host provides
  through `useFilterScope` (the console shell mounts `FilterScopeProvider` from the signed-in user
  and the active organization). On `object-grid` that is `filter` and its deprecated alias
  `defaultFilters`: the resolved `filter` feeds the grid's query and its server-side export, and the
  resolved alias feeds the query when `filter` is absent. On
  `list-view` it is `filter`, and the resolved value feeds the list's query, the child view it
  renders, the self-querying views (gantt, tree, chart), the export and the empty-state copy.
  `object-view` has done this since objectui#10506; these two nodes, authored directly, had not.
  
  The relative-date macros (`{today}`, `{current_quarter_start}`, …) resolve in the same call, in
  the browser's local time, as on the other surfaces that call the resolver. Where they used to
  reach a backend that resolves them itself, as the ObjectStack server does in the tenant's
  configured `localization.timezone` (UTC by default), a browser whose local day differs from the
  server's day can now get a different day.
  
  A token the scope cannot resolve is left as written and the resolver warns once, which is the
  resolver's own rule, so the filter is never widened.
  
  The resolved value is held against its inputs: the authored filter, compared by structure, and the
  scope's three members (`currentUserId`, `currentOrgId`, `onUnresolved`), each compared on its own.
  A re-render that changes none of them does not refetch, including one that rebuilds an equal
  filter inline; a new signed-in user refetches with the new id. Date macros are therefore resolved
  once and held until the scope or the authored filter changes, and a refetch for another reason
  reuses the held value. `object-view` already hands these nodes a filter it has resolved
  (objectui#10506); resolving that value again changes nothing, because a resolved id or date no
  longer matches the placeholder pattern.
  
  On `object-grid`, the load effect now also refetches when the resolved `defaultFilters` changes (a
  new signed-in user, or an in-place edit of the alias). It read that alias without keying on it
  before.
- 02e6d36: Five more page blocks re-read when the data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a write to the object they read (objectui#10623). These blocks read neither `onMutation` nor the bus, so any write — through the data source or past it (a page action over raw HTTP, a flow, a server action) — showed only when something remounted them. Each fetch effect now names the `useDataInvalidation` nonce for its object; an unscoped change (`'*'`) matches too, and a change to another object does not.
  
  - `@object-ui/plugin-timeline`: `object-timeline` re-reads its rows; a canvas that already shows rows stays mounted while the re-read runs.
  - `@object-ui/plugin-list`: `object-gallery` re-reads its cards; collapsed groups stay collapsed.
  - `@object-ui/plugin-map`: `object-map` re-reads the markers it is showing without its loading placeholder, so the map stays mounted and the camera stays where the user left it. If that re-read fails, the last markers stay on the map and the failure is logged to the console, as `ObjectGantt`'s background refresh does. A changed query still shows the placeholder and re-fits the camera, even when a bus event arrives with it. Two older faults in the same fetch are fixed as well: a slow earlier answer can no longer overwrite a newer one, and a load that succeeds now takes the map off an earlier error screen.
  - `@object-ui/components`: `element:number` re-reads its aggregate and `element:repeater` its rows.
  
  Rows a host hands these blocks (`data`, `bind`, authored `items`, an inline `value` set) are still the host's to refresh; only the blocks' own queries follow the bus.
- 12809a5: `ListView` hands its grid the object's field types together with the rows, so the grid draws a `password` / `secret` column masked from its first paint (objectui#10657, which folded objectui#10706).
  
  `ListView` fetches the rows and hands them to `object-grid` as `data`, and those rows
  painted before the grid's own read of the object definition settled. In that window an
  untyped column over a `password` / `secret` field had no type: it drew the raw value, and
  since `object-grid` now withholds such a column instead, it would draw the mask for every
  untyped column until the read lands. `ListView` reads the object definition before it
  fetches the rows, so it now passes the definition's fields to the grid as `objectFields`
  with them, and the grid has no window at all. Only the grid view is handed it. When the
  definition could not be read, nothing is passed and the grid withholds on its own.
- f9c06ef: Every data node that sends its own authored `filter` into a query now resolves the spec's context tokens first (objectui#10666). With `filter: [['owner', '=', '{current_user_id}']]` these nodes used to send the literal token; they now send the signed-in user's id, and `{current_org_id}` resolves to the active organization:
  
  - `object-calendar`, `object-map` and `object-tree`, on both the object query and the inline (`provider: 'value'`) query;
  - `object-gantt`, `object-kanban` and `object-timeline`;
  - `record:related_list` and `record:line_items`, where the node's own filter is combined with the parent-record condition;
  - the `element:repeater`, `element:number` (both the `aggregate` filter and the `find` fallback) and `element:record_picker` page elements.
  
  `list-view`, `object-grid` and `object-gallery` already did this, and are unchanged.
  
  **New in `@object-ui/react`: `useResolvedFilter(filter, scope)`.** Pass it a node's authored filter and `useFilterScope()`. It resolves the filter through `@object-ui/core`'s shared `resolveFilterPlaceholders` and holds the result: re-rendering with an equal filter (even one rebuilt inline on every render) hands back the same value, so a fetch effect keyed on it does not run again, while a structurally different filter or a change of signed-in user or organization resolves again. A filter with no token to resolve is handed back as the value you passed in. The hold is the one `list-view` and `object-gallery` used privately; `plugin-list` now imports it from here, and no second copy remains in that package.
  
  What changes for an app:
  
  - A filter with no placeholders reaches the query as before, unchanged.
  - Nodes that re-queried whenever the host rebuilt an equal filter inline (`object-calendar`, `object-gantt`, `object-kanban`, `object-map`, `object-tree`) no longer issue those redundant queries.
  - Date macros such as `{today}` in these nodes' own filters are now resolved in the browser's local time, as they already are for `list-view`, `object-grid` and `object-view`. Before, they reached the server as literals, and the server resolved them in the tenant's time zone.
  
  `@object-ui/types`: the `filter` docblocks on `ObjectMapSchema`, `ObjectTreeSchema`, `ObjectGanttSchema`, `ObjectCalendarSchema`, `ObjectKanbanSchema`, `ObjectChartSchema` and `ObjectGallerySchema` (and the matching zod descriptions) no longer say the filter is forwarded verbatim; they say its context tokens are resolved first. No type changes.
- c610990: A directly authored `object-gallery` node now resolves the spec's context tokens in its own `filter` (objectui#10666). With `filter: [['owner', '=', '{current_user_id}']]` the gallery used to send the literal token on `$filter`; it now sends the signed-in user's id, and `{current_org_id}` resolves to the active organization. The filter goes through `@object-ui/core`'s shared `resolveFilterPlaceholders`, against the scope `FilterScopeProvider` supplies, the same call `list-view` and `object-grid` have made since objectui#10607. The resolved value is held and compared by structure, so re-rendering with an equal filter issues no extra query, and a change of signed-in user queries again. A filter without placeholders reaches the query unchanged. A gallery rendered as a `list-view` child was already handed a resolved filter, and nothing changes for it.
  
  Date macros such as `{today}` in a directly authored gallery's filter are now resolved in the browser's local time, as they already are for `list-view`, `object-grid` and `object-view`. Before this change they reached the server as literals, and the server resolved them in the tenant's time zone.
- be0ad00: `list-view` re-reads its rows when a `conditionalFormatting` rule, a row action def or a bulk action def adds a field its predicates read (objectui#10689).
  
  The list puts each predicate operand of those three into `$select`, but its fetch effect did not re-run when any of them changed. So a rule added to a mounted list never had its field fetched, and the rule never matched. The effect now keys on the operand names by content, so an equal value in a new array, or a change the query cannot see such as a rule's colour, does not re-read.
- 256b4c9: A filter refused as malformed (`INVALID_FILTER`) no longer throws out of render or out of a click
  handler at the sites that merge filters there. That holds whether this layer's filter converter
  refused it or, at the drill seam, the spec's own `parseFilterAST`. Each site now surfaces the
  refusal the way its siblings already do (objectui#10789). The filter stays **refused**: nothing
  that was refused is accepted, and no site falls back to "no filter".
  
  - **`ElementDataSourceGate` / `useElementDataSource`** (`@object-ui/react`): the gate's merge of
    the component's `filter` with the composed binding, and the merge of a saved view's filter
    with the binding's own, lowered through the throwing converter inside render. A refused
    filter from either now makes the binding `missing` with a new optional `filterRefusal` on the
    result (`error` carries its message). The gate then draws, in place of the block, the
    malformed-filter notice the wrapped blocks draw: `view.malformedFilter`, naming the refused
    operator or field. `element:record_picker`, which reads the same hook, shows its
    configuration-error panel with the refusal.
  - **`PeoplePicker` / `RecordPickerDialog`** (`@object-ui/fields`): the recents merge and the
    dialog's `mergedFilter` lower through `toFilterNodeSafely`; a refusal is shown in the picker's
    existing error state and no query runs without the filter.
  - **Drill-downs** (`ObjectChart`, `ObjectPivotTable`, `DatasetWidget`, `DatasetReportRenderer`):
    a widget or report filter refused at the drill seam made the drill click throw. The converter
    refuses some (a spec `$not`, say). The spec's `parseFilterAST` refuses others, such as a scalar
    on a list operator in either dialect: `[['stage', 'in', 'won']]` or `{ stage: { $in: 'won' } }`.
    The drill is now not opened or emitted (never with the scope dropped), and the refusal is logged
    with `console.warn`, naming the operator. `composeDrillFilter` (`@object-ui/core`) now throws
    one refusal type: the spec's `INVALID_FILTER` error is re-raised as a `FilterOperatorError` with
    its message and the same `INVALID_FILTER` / 400 envelope, and any other error passes through
    unchanged.
  - **`ListView` export** (`@object-ui/plugin-list`): the server export builds its filter inside
    its `try`, so a refusal is named in the export menu instead of escaping the click.
  - **`convertFiltersToAST`** (`@object-ui/core`): an `$or` member that is the TRUE identity no
    longer stops the members after it from being read. `{ $or: [{}, { a: {} }] }` is now refused
    like `{ $or: [{ a: {} }, {}] }` already was, instead of answering TRUE (every row); a TRUE
    disjunct beside members that lower still absorbs its `$or`.
- d0ae5d0: fix(plugin-list,plugin-grid): a grouped list view under a toolbar search groups on the server, and each group counts all its matching rows
  
  A grouped list view whose data source answers the group header query hands
  the grid its own fetch, so the groups and their counts come from the server.
  A toolbar search used to take that back: the list view fetched one page of
  searched rows and the grid grouped that page in the browser, so once the
  matches outnumbered the page a group's count was the page's slice of it, and
  a group whose matches all fell past the page was missing.
  
  The list view now hands the grid its toolbar term (the grid's `search` prop)
  and the view's `searchableFields`, and the grid sends them on the group header
  query and on every group's row query. A searched grouped list view shows only
  the groups that hold matching rows, each counting all its matches, and
  clearing the search restores the unsearched groups.
  
  `ObjectGrid` now reads a host's `search` whenever one is passed, not only
  under host-driven paging: the host then owns the term, and the grid's own
  queries carry it. Turning grouping back on no longer asks for, or briefly
  shows, the groups of the query the grid held when it last grouped (a cleared
  search, or an old filter or sort). `@object-ui/plugin-grid` now declares
  `@objectstack/spec` `^17.5.0`, the release whose group header query takes a
  search.
- ae582b7: A number field's authored `useGrouping` now decides whether its value renders with thousands
  separators (objectui#11026). This is the renderer half of `FieldSchema.useGrouping`, the
  digit-grouping hint `@objectstack/spec` declares on a field.
  
  **What an author now controls.** Write `useGrouping` on a `number` field:
  
  - `useGrouping: false` renders the value with no separators, whatever its `scale`: a
    `scale: 2` code field reads `12345.50`, not `12,345.50`.
  - `useGrouping: true` groups it, even at `scale: 0`: a scale-0 headcount reads `2,026`, not
    `2026`. An authored `true` reaches `Intl.NumberFormat` as `useGrouping: true`, which means
    "always". So in a locale that leaves a four-digit number alone by default (es-ES, pl-PL),
    `1234` renders `1.234` / `1 234`.
  - Leave it out and nothing changes: a declared `scale: 0` still reads as an ordinal and renders
    ungrouped (a year reads `2026`), and any other number is grouped the locale's way.
  
  Before this change nothing in the console read the key, so the only way to drop the separators
  was `scale: 0`, and there was no way to keep them on a scale-0 count.
  
  **Where it applies.** List and grid cells, record detail sections and highlights, the record
  quick-look panel, related-record tables and gallery cards. Each of these builds a cell's field
  from the object's field definition key by key, and each now copies `useGrouping` next to
  `scale`. Kanban cards and the grid's auto-generated columns hand the cell the whole field
  definition, so they follow it too. The form's number input and the dashboard's record table
  read neither `scale` nor `useGrouping` for grouping, and are unchanged.
  
  **API (additive).**
  
  - `@object-ui/core`: `DisplayNumberFormatOptions` gains `useGrouping?: boolean`, and
    `shouldGroupDisplayNumber` takes it as an optional third parameter. An authored boolean
    answers first; with it unset, the existing `scale`/`currency` rules decide as before.
    `@object-ui/i18n` re-exports both names, so the same options reach it too.
  - `@object-ui/types`: `NumberFieldMetadata` declares `useGrouping`, typed from the spec's
    `FieldSchema.useGrouping`.
- f61dab1: `reference` is now the only spelling ObjectUI writes or reads for a relational field's target object (objectui#11070, round 4, under the objectui#6837 ruling: 「objectui不是前端的项目吗？后端的元数据只要对，前端按协议执行就行了呀」).
  
  - **Types.** `LookupFieldMetadata`, `MasterDetailFieldMetadata` and `DetailViewField` (with its zod mirror `DetailViewFieldSchema`) declare `reference` and no longer declare `reference_to`. On the two field metadata types the member is typed by reference to `@objectstack/spec`'s `FieldSchema.reference`. `@object-ui/plugin-form`'s `FieldDefaultsSchemaLike` drops its `reference_to` member the same way.
  - **Readers.** `LookupField`, `UserField`, `LookupCellRenderer`, `UserCellRenderer`, the inline editor's reference fallback, the form's `current_user` seeding and the inline-subform parent lookup read `reference` alone.
  - **Emitters.** Every in-repo producer that builds a field definition or a widget `field` prop writes `reference`: the action-param dialog (`paramToField`), the bulk-action dialog, the record detail page, drawer, footer, related list and synthesised page, the gallery card, the form's section-field override and the flow designer's reference picker. The grid's and the dashboard's relational copy sets carry `reference` and no longer copy `reference_to`.
  - **Ingestion.** `normalizeFieldReferenceKeys` (behind `ObjectStackAdapter.getObjectSchema` and `MetadataProvider`) still folds a legacy `reference_to` / `referenceTo` onto `reference` when `reference` is absent, and still warns in dev. It no longer stamps `reference_to` onto every relational definition, and it still never drops or overwrites a key.
  
  `@objectstack/spec`'s `FieldSchema` refuses `reference_to` by name, and objectstack#13847 rewrites stored ones on the serve path and in `os migrate meta`, so a definition served by an ObjectStack backend is unaffected.
  
  ## ⚠️ BREAKING for a host that hands `reference_to` to the widgets directly
  
  The type change is a compile error for TypeScript that writes `reference_to` on `LookupFieldMetadata`, `MasterDetailFieldMetadata` or `DetailViewField`: rename it to `reference`.
  
  At runtime the break reaches exactly one kind of host: one that serves object definitions spelling the target only as `reference_to` through a `DataSource` other than `ObjectStackAdapter`, or that passes such a definition straight into `LookupField`, `UserField` or a cell renderer. Those definitions never pass the ingestion fold. Measured with an object-bound lookup field on `ObjectForm` and a lookup column on `ObjectGrid`, both fed by a hand-written `DataSource` whose `getObjectSchema` returns `{ type: 'lookup', reference_to: 'account' }`:
  
  - before this change, opening the picker queried `account` and the cell resolved the record's name;
  - after it, the picker has no object to query (no `find` call is made) and the cell shows the raw id beside the unresolved-reference marker.
  
  The same definition served through `ObjectStackAdapter.getObjectSchema` still works, before and after: the fold adds `reference`, the picker queries `account`, the cell resolves the name, and the dev warning names the field. **Fix:** spell the target `reference` in the definition your `DataSource` serves.
  
  ⚠️ **Dated note, 2026-09-30 — the break reaches more than the paragraph above states — objectui#11070.** Two corrections from the contract review of this change, appended rather than edited in; neither changes what ships.
  
  - "The break reaches exactly one kind of host" above is too narrow. Host code that read `reference_to` off a definition after ingestion — from `ObjectStackAdapter.getObjectSchema()` or `useMetadata().objects` — also loses that key, because the ingestion pass no longer stamps it (the **Ingestion** bullet above states the fact, and `reference_to` was never a declared member of those definitions). **Fix:** read `reference`.
  - The measured break above is a `lookup` field's. A `user` field handed a `reference_to`-only definition directly does not end at "no query": `UserField` falls back to `sys_user`, so its picker queries `sys_user` rather than the object `reference_to` named. **Fix:** spell the target `reference` there too.
  
  The text above is kept as the reading of this change.
- 81f8498: objectui now resolves `@objectstack/*` 17.5.0 and `zod` 4.6.5, and follows every contract move that release makes (objectui#11073). `@objectstack/spec` 17.5.0 and `@objectstack/core` 17.5.0 require `zod ^4.6.1`, so objectui's own `zod` resolves to the same 4.6.5: two zod minors do not type-check against each other.
  
  ⚠️ Breaking in places, marked `minor` under this repo's version-alignment rule (a `major` in the fixed group would move all of it off the `@objectstack` major). Every narrowing below is the spec's own, and already reaches any consumer that resolves `@objectstack/spec ^17.5`.
  
  - `@object-ui/types`: declares `@objectstack/spec ^17.5.0` and `zod ^4.6.1`. A named list view's `pageName` and `tabs` are retired, as the spec retired them: typed `never` and refused by name at parse. `DashboardWidgetSchema` attaches the spec's two new checks (`checkDashboardWidgetStageOrder`, `checkDashboardWidgetMetricMeasureArity`), so a widget the spec refuses is refused here too. Where a strict object is an arm of a plain union, its unknown-key refusal is terminal again (the spec's own mechanism, needed under zod 4.6): the union answers with every arm instead of the one that failed only on unknown keys. That changes the error shape, never the verdict (measured on every objectui union). Two by-name named-view checks that can no longer run are retired; the spec's refusal answers those documents.
  - `@object-ui/core`: declares `@objectstack/spec ^17.5.0`. `page` leaves the list-view kinds the normalizer knows, as the spec removed `type: 'page'`. `isRefusedTextComparand` and `textComparandRefusalReason` are re-exported from `@objectstack/spec/data`, whose copies are byte-identical. `SPEC_ACTION_KEYS` lists `execution`, which `ActionSchema` now declares.
  - `@object-ui/data-objectstack`: declares `@objectstack/spec ^17.5.0`, up from `^17.4.0`. Its bundle carries `@object-ui/core`'s filter converter, which now takes `isRefusedTextComparand` and `textComparandRefusalReason` from `@objectstack/spec/data`. `@objectstack/spec` 17.4.0 exports neither, so the old range admitted a spec under which the shipped module names exports that are not there (objectui#5793's floor gate). Nothing moves at runtime in this repository, because the lockfile already resolves 17.5.0. `patch`, as the floor raise of objectui#10864 was.
  - `@object-ui/fields`: the percent and number `scale` clamp is gone, at the sunset its own test named. The spec now refuses a `scale` above 100 at the declaration, so the width a formatter cannot render no longer arrives, and every face passes the declared width through as it did before the clamp.
  - `@object-ui/components`: two module-local prop interfaces of the action renderers are renamed (`ActionButtonRendererProps`, `ActionIconRendererProps`), because the spec now exports the old names for its authored props. Neither is reachable through the package's exports map; only the shipped per-file declarations change.
  - `@object-ui/plugin-list`: the README's view-type example no longer lists the retired `page` kind.
  - `@object-ui/app-shell`: the flow designer follows 17.5.0 (maintainer ruling on objectui#11088, decision 2). A new `wait` node is seeded `waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H' }`, because the spec now refuses a timer wait with no duration; the inspector shows the Duration at once and it can be changed. The decision form offers the spec's new `mode` (exclusive or inclusive), with no default declared because the spec applies none. The screen form's `mode` states `create` again, because the spec now applies that default. `minor` because the decision form gains a control.
  - `@object-ui/app-shell`: declares `@objectstack/spec ^17.5.0`, up from `^17.4.0`, and `zod ^4.6.1`, up from `^4.4.3`. The designer now states 17.5.0 behaviour. The screen form's declared `create` default equals a default the spec applies only since 17.5.0, and objectui#9109 requires the two to be equal, so a range that admitted 17.4.0 claimed more than the designer holds to. The resolved versions do not move.
  - `@object-ui/console`: the bundle inlines the 17.5.0 packages, so its client-side validation answers as the published 17.5.0 contract does. The flow preview sample's script nodes use the 17.5.0 script contract. The eager-closure budget is re-baselined for the release's growth, under the maintainer ruling on objectui#11088 (decision 1).
- b24f93a: A page now renders the accessible name an author declares in its `aria` bag, and the list view and the `record:*` blocks read the same bag through the one shared reader (objectui#11083).
  
  **The page root (a fix).** The spec's `PageSchema` declares `aria` as `AriaPropsSchema`, and `PageNodeSchema` mirrors it. The page renderer passed its wrapper only DOM attributes, so the `aria` object was dropped and `{ type: 'page', aria: { ariaLabel: 'Orders' } }` rendered no `aria-label` anywhere. The page's root element now carries:
  
  - `aria-label` from `ariaLabel`. A locale map (`{ en: 'Orders', 'zh-CN': '订单' }`) gives the entry for the display locale (`useDisplayLocale()`);
  - `aria-describedby` from `ariaDescribedBy`;
  - `role` from `role`.
  
  The page adds no default role, and a page that declares no `aria` renders the same DOM as before. The flat `ariaLabel` on the page node still reaches the root as before; when both spellings name the same attribute, the nested `aria` bag wins.
  
  **The list view and the `record:*` blocks (no visible change).** `ListView`'s list region and the `record:*` blocks' `useRecordAriaProps` used to map the nested bag themselves. Both now go through `resolveInlineAriaProps` from `@object-ui/react`, the reader the `element:*` blocks use, and keep only their own defaults: the list region's `region` role, and each block's default role, default name and the report of the refused `aria.label` spelling. One difference: an authored empty `role: ''` on a list view used to render an empty `role` attribute, and now falls back to `region`. The list view still reads `aria.live`, which objectui's `ListViewSchema` declares on top of the spec's bag.
- 6158e4c: An `object-grid` publishes `description` and `emptyState` now that `@objectstack/spec` 17.6.0
  declares them on its `object-grid` row, and `emptyState.title` / `.message` take an inline
  locale map on both the grid and the list view (objectui#11227).
  
  **`@object-ui/plugin-grid` (feature and fix).**
  
  - `description` and `emptyState` are in the grid's declared inputs, so the designer panel, the
    component manifest and the generated `sdui-intrinsics.d.ts` offer them, and the SDUI parser
    no longer reports an authored `emptyState` as `unknown-prop`. `description` declares both
    arms of the `I18nLabel` union, so a locale map on it is not a `type-mismatch`.
  - `emptyState.title` and `emptyState.message` are resolved against the display locale, as
    `label` and `description` are. Before, a locale map on either reached the empty-state
    component as an object, and the grid failed to render. A map with no usable entry keeps
    that member's default: the table's "No results found" heading, and no message line.
  - `keyboardNavigation`, the row's third 17.6.0 key, is not published. The spec marks it
    `[EXPERIMENTAL — not enforced]`, and nothing in the grid reads it yet.
  
  **`@object-ui/plugin-list` (fix).** A list view's authored `emptyState.title` and
  `emptyState.message` are resolved against the display locale. Before, a locale map on either
  was treated as absent, and the empty state drew the default copy in every locale. A plain
  string is drawn as before.
  
  **`@object-ui/types` (breaking for a reader of the text members, hence `minor`).**
  
  - `ObjectGridSchema.emptyState` is the spec's `EmptyState`, and the Zod twin takes the spec's
    `EmptyStateSchema` by reference. `title` and `message` are `string | I18nLabel`, `icon` stays
    a string, and an unknown member is still refused by name. A locale map on `title` or
    `message` now parses, and a value that is neither a string nor a map is refused at that
    member.
  - `NamedListView.emptyState` is `ListViewSchema['emptyState']`, the same spec type.
  - TypeScript code that reads `emptyState.title` or `.message` as a `string` no longer
    type-checks. Resolve the value first, for example with `resolveI18nLabel` from
    `@objectstack/spec/ui`.
  
  **Correction, 2026-10-03 (objectui#11068, the `keyboardNavigation` build).** The bullet above
  that says `keyboardNavigation` "is not published" and that "nothing in the grid reads it yet" is
  superseded. The grid honours the key, with arrow-key cell navigation that is on by default when
  the grid renders editable, and it is in the grid's declared inputs, so the designer panel, the
  component manifest and the generated `sdui-intrinsics.d.ts` offer it
  (`.changeset/11068-keyboard-navigation.md`).
- 4a1adb7: The list view's record-count bar reads the right noun form in every language at every count (objectui#11445): it passes `count` to the `list.recordCount` count family instead of choosing `list.recordCountOne` on `=== 1`, so Russian reads `2 записи` and Arabic uses its dual at 2. `LIST_DEFAULT_TRANSLATIONS` carries the family's `_one` / `_other` rows.
- f560ded: The gallery card's field bag now carries the field's `max`, the storage
  statement the percent cell reads through the spec's `percentScaleOf`
  (objectui#11475). Without it, a whole-stored `50` (`max: 100`) would read
  `5000%` on a card beside `50%` in the grid.
- 9801765: The selection bar's built-in **Delete** now honours `userActions.delete.visibleWhen`
  per selected record (objectui#4420). It used to read that key as a bare boolean — the
  object-level verdict only — so ticking a record the author's predicate excludes still
  offered the red Delete, and pressing it deleted the record the predicate was written to
  protect. The row kebab on the same screen hid its Delete correctly, so one declared key
  meant two different things on two surfaces.
  
  Ruled by the maintainer on 2026-08-17 (behaviour 1 of the card's three): **filter the
  operation and report the skipped**. The bar evaluates the predicate once per selected
  record, the delete runs over the allowed subset, and the excluded records are reported
  rather than silently dropped. The button itself is never hidden or disabled by the
  predicate — a mixed selection is not punished for one stray tick — and a selection where
  every row is excluded is a legible refusal rather than an unexplained absence.
  
  - `@object-ui/core` gains `partitionRowsByPredicate`, the set-shaped counterpart of
    `evalRowPredicate`: the fail-closed per-record fold a bulk gate needs, written once.
    A bulk gate evaluates N records in a loop, which is why it can never be a hook.
  - `@object-ui/plugin-grid`'s bulk bar routes an excluded selection through
    `BulkActionDialog`, whose existing `bulk-skipped-notice` slot reports the skipped
    count; a selection with nothing excluded keeps the consumer's own delete flow
    untouched. `resolveRowCrudAffordances` now also returns `objectDeletePredicates` —
    the bulk half of the same predicates, gated on the object verdict rather than on the
    row `onDelete` wiring. The dialog declines to run over zero records.
  - `@object-ui/plugin-list`'s non-grid bulk bar (kanban / calendar / gallery / …) filters
    the built-in `delete` to the eligible subset and states the skipped count inline.
  
  Custom bulk action ids are untouched: they route through the action runner carrying
  their own gates. This is a UI affordance — server enforcement was never the leak.
- 41b7ce3: **View configuration is explicitly org-wide, and its write path is now gated (objectstack#7494's
  ruling, maintainer 2026-08-12).** The `sort` / `hiddenFields` / `columnState` / `rowHeight` that a
  list toolbar persists were never per-user: they are one shared row on the view, so an ordinary user
  dragging a column or cycling density was re-styling that view for the entire organization. Nothing
  in the console said so, and nothing stopped it. A per-user scope stays parked (objectstack#7611,
  v18) and is deliberately not built here — which is precisely why the write has to be gated rather
  than narrowed: there is no second, private store for it to fall back to.
  
  `ObjectStackAdapter.updateViewConfig` now refuses when the session's **reported** ADR-0066 capability
  set does not contain `manage_metadata`, throwing the new `ViewConfigPermissionDeniedError`
  (`VIEW_CONFIG_PERMISSION_DENIED`, with `isViewConfigPermissionDeniedError` and the
  `VIEW_CONFIG_CAPABILITY` constant alongside it). The gate is the **first** statement in the method —
  before `connect()`, before the payload is assembled — so a refused call puts nothing on the wire.
  It is on the write rather than on the toolbar button on purpose: withholding the affordance would
  leave the method still accepting the call from anything else holding the adapter, whereas a gate on
  the write is inherited by every caller, present and future.
  
  `manage_metadata` is not a newly minted name. It is the capability this repo already treats as
  metadata-authoring authority — `HomePage`'s `AUTHORING_CAPABILITY`, the one the server itself
  refuses metadata writes without — and the gated write goes through `client.meta.saveItem`, the very
  same ADR-0005 metadata door, so this applies the authority the server is already applying instead of
  inventing a parallel one.
  
  **Unknown fails open, by doctrine.** A capability set that was never reported (a backend predating
  ADR-0066, or no permission provider mounted) is not a denial: the server enforces regardless, so a
  client-side refusal on missing data cannot protect anything and can only break a permitted user. A
  *reported* empty grant gates strictly. Hosts push the session's capabilities in with the new
  `setSystemCapabilities`; `ObjectView` wires it from `usePermissions()`.
  
  The refusal is also **said out loud**. `ObjectView`'s persist path previously swallowed every failure
  into `console.error`, which for a debounced toggle whose UI has already moved would have left the
  operator looking at a density they did not get; a denied write now raises a toast. And the "View
  settings" popover — where density and field visibility are actually changed — now states the scope
  before the operator acts: *"Grouping, color, density, and visible fields. Applies to everyone who
  uses this view."*, translated in all ten packs.
- 39f4309: Published typings from every `vite-plugin-dts` package now carry an explicit extension on
  every relative specifier, and a type error in the declaration build now fails the build
  instead of being printed and ignored (objectui#5439, objectui#5483).
  
  **Consumers on `moduleResolution: nodenext` or `node16` may see NEW type errors, and that
  is the fix working.** These packages re-export mostly through NAMED re-exports —
  `export { useObjectChat } from './useObjectChat'`. TypeScript could not follow the
  extensionless hop, but it still DECLARED the name, so the symbol resolved to a silent
  `any`. Nothing errored; consumers simply got no types. With the extension emitted, the
  symbol carries its real type, and any call site that was relying on the `any` now type
  checks for the first time. This is the mode that produced the 21 residual `TS7006` on
  `@object-ui/app-shell` reported against objectui#5365 — a type hole that opened quietly,
  unlike objectui#5365's own `export * from './ui'` packages where the same defect surfaced
  immediately as `TS2305: has no exported member`.
  
  410 extensionless relative specifiers across 19 packages were emitted before this change;
  the count is now 0 in all 22 packages that build typings through `vite-plugin-dts`.
  `@object-ui/fields` was already clean — its sources write explicit `.js` specifiers — and
  is wired so it stays that way.
  
  The second half changes no emitted output today: 22/22 packages built green unmodified, so
  making the declaration step's exit code honest turns nothing red. It changes what a FUTURE
  regression does — print and exit 0, versus fail the build.
- b4393e5: The last three sort-axis consumers read the platform's per-column sortability signal instead
  of re-deriving it from the field's type (objectui#6108, inheriting objectstack#10235 ruling A
  through objectui#5729's landed contract). ListView's toolbar sort picker and both of
  RelatedList's sort entry points — the embedded table's column headers and the `data-list`
  sort-button row — now go through `isPlatformSortableField`, the same spelling the grid header
  adopted; their `UNMATERIALIZED_FIELD_TYPES` / `isUnmaterializedFieldType` re-derivations are
  deleted.
  
  The re-derivation was not wrong about `formula`: the platform computes its own projection from
  the same `@objectstack/spec` storage fact, which is why the drift went unnoticed across two
  cards. It parts company on everything the projection encodes as ABSENCE — an unknown name, a
  dotted path a caller can put in a related list's `columns`, an unprovisioned audit column —
  where a type read finds no field definition, answers "sortable", and offers a control the
  runtime meets with `400 INVALID_SORT`. It parts company again on any refusal that carries no
  `reason: virtual-type`, and it cannot follow the platform in the other direction either: a
  field the platform now DOES order by stays withheld forever on its type alone.
  
  Two behaviours are deliberately unchanged. The relational carve-out stays separate from the
  signal — the projection answers `sortable: true` for a `lookup` because the platform can order
  by the stored foreign key, while the UI withholds because that order means nothing beside a
  column of names — so a relational column does not get its sort back. And ListView's picker
  still lists a field the CURRENT sort already names, which is the only way to remove a sort the
  server refuses outright; that exception now covers platform-refused fields, not just formulas.
  
  A deployment that served no `sortability` key at all is a different case from "nothing is
  sortable": that branch keeps the type read as a compatibility floor, so behaviour on a backend
  older than objectstack#10235 (or an inline/mock data source) is byte-identical to before.
- bd2f56a: `ListView`'s toolbar sort picker no longer persists a sort the platform refuses to order by.
  
  The picker keeps a platform-refused field listed while the CURRENT sort names it
  (#6108). That exception is deliberate and stays: it is the only way a user can
  REMOVE a sort the server answers `400 INVALID_SORT` for — withholding the option
  unconditionally renders a blank row nobody can delete, and drops the sort silently
  on the next edit.
  
  What was wrong is that the picker rendered and emitted from the same array. Editing
  anything ELSE in that popover — adding a second sort key, resetting to the view's
  default — re-emitted the whole array with the refused entry still in it, and the
  host's `onSortChange` turned that into `persistViewPatch({ sort })`: a
  personalization PUT storing a refused column, written by a user who never touched
  that row. A view stored before the sortability signal existed therefore kept
  re-persisting its refused `$orderby` indefinitely.
  
  Every `onSortChange` this component emits — the builder, the column-header sort and
  "reset to default" — now crosses one boundary that drops what the served projection
  refuses, while `currentSort` keeps the array whole. So what the picker LISTS and
  what it PERSISTS are separate: the refused entry stays visible and removable,
  removing it persists the removal, and no write carries it. This is the separation
  #5729 already made at the grid seam (`ObjectGrid`'s `manualSort` /
  `manualOnSortChange` pair); the picker was the second door onto the same stored
  view state.
  
  Only under a served sortability projection (objectstack#10235 ruling A). `undefined`
  means NO SIGNAL SERVED — an older deployment, an inline/mock data source — not
  "nothing is sortable", and that branch is byte-identical in behaviour to before.
- babe956: `list-view` stops spelling "the author declared no columns" as an explicit empty
  projection (objectui#6598).
  
  A production `kind:'html'` page carried `<list-view objectName="opportunity">`
  with no `columns` and rendered the row count, the filter/group/sort toolbar and
  the index column — and **not one data column**, with no diagnostic anywhere.
  `ObjectGrid` derives default columns for exactly that case ("Default columns
  priority (when schema doesn't specify columns)"), and it never ran: the
  derivation is gated on `schema.fields` being ABSENT, `ListView` sent
  `fields: []`, and an empty array is truthy. `normalizeColumns` had already read
  the empty `columns` as unauthored, so the two keys disagreed about the same fact
  and the stricter reading won.
  
  `ListView` now asks whether the AUTHOR declared a projection — `columns` present
  and non-empty, after the legacy `fields` fold — and hands the child grid nothing
  at all when they did not, so the grid's own defaults apply.
  
  ⚠️ The predicate reads the authored value and never what survived filtering, and
  that distinction is load-bearing: when the author DID declare columns and the
  field gate removed every one of them, the empty projection is still sent.
  `ObjectGrid` re-applies FLS on its derived column path only, never on the
  explicit-columns path, so falling through to the derivation there would put
  fields on screen that the author never asked for and the principal may not read.
  
  Measured single-variable on the html tier: a bare
  `<object-grid objectName="opportunity" />` renders the object's default columns;
  the same object behind `<list-view>` rendered none. Pinned at the handoff
  (`ListView.unauthoredColumnProjection-6598.test.tsx`) and end to end over the
  real grid on a real html-kind page
  (`htmlTierListViewDefaultColumns-6598.test.tsx`).
  
  This is one half of the reported symptom. Which columns the defaults resolve to
  still depends on who owns the fetch — with a host like `ListView` fetching, the
  grid takes its inline-data branch and derives from the row payload's keys rather
  than from the object schema's policy (hidden and readonly system-managed fields
  dropped, `highlightFields` honoured). That precedence sits in
  `packages/plugin-grid` and is filed separately.
- 3beef6d: The spec's `dataSource` element binding is now DECLARED by the blocks that read
  it, so the html tier stops reporting the one working saved-view spelling as
  `unknown-prop` (objectui#6678).
  
  `PageComponentSchema.dataSource` — `{ object, view, filter, sort, limit }` — is
  the one spelling that resolves a saved view for an object-bound block. It works,
  and it drew the identical `unknown-prop` warning as the two spellings that do
  nothing (`viewName`, `view`), because `validateTree` looks a prop up in the
  block's declared `inputs` and no registration declared this key. On the tier
  built to accept AI-authored pages, where the diagnostic IS the contract, the
  only signal pointed away from the key that works.
  
  Adopting the maintainer ruling of 2026-08-29 — option B **in the injection
  form**:
  
  - `ELEMENT_DATA_SOURCE_INPUT` is the single declaration, in `@object-ui/core`
    beside the binding's own semantics; `Registry.register` emits it for any
    registration whose renderer passed through the new `elementDataSourceBlock()`
    seam. One mechanism, one copy — not a hand-kept declaration per block, which is
    the shape that drifts and that a new block forgets. The seam lives in
    `@object-ui/core` and is re-exported by `@object-ui/react` beside
    `ElementDataSourceGate` for discoverability; call sites take the core import,
    because a registration runs at module scope and this repo's suites partially
    mock `@object-ui/react`.
  - Seventeen renderers, in thirteen files across twelve packages, reach the seam
    and now publish the key to the save gate, the parser whitelist, the generated
    JSX authoring types and the block list. The card named nine blocks; the tree
    also has `plugin-grid`, `plugin-timeline`, two further `plugin-form` blocks and
    `element:record_picker` — nothing was hand-listed, so the mechanism covered
    them. `element:record_picker` consumes the gate's HOOK and status panels rather
    than the wrapper tag (its object lives under `properties`), and was found by a
    render probe rather than by reading sources.
  - `dataSource` on a block that does NOT read it (`flex`, `card`) still reports
    `unknown-prop`. Adding the key to `sdui-parser`'s `BASE_PROPS` was refused for
    exactly this reason — that set mirrors `BaseSchema`, and silencing the key
    everywhere would make the diagnostic lie in the other direction.
  - New `check:element-data-source-declaration` fails any source that consumes the
    gate without reaching the seam, so a block added tomorrow cannot forget.
  
  Behaviour of the binding itself is unchanged — this is a declaration, not a
  resolution change. The saved view still resolves its columns, and an
  unresolvable `view` still fails loudly rather than widening to the object's full
  scope.
  
  The spec/registry parity gates (repo-wide and the `record:related_list` per-block
  pin) now derive their accepted set from the WHOLE node contract rather than from
  `ComponentPropsMap[type]` alone. `PageComponentSchema` accepts and keeps
  `dataSource` on a page-component node — it is a node-level key, a sibling of
  `type` and `className`, not a per-block prop — so the gates' previous complaint
  was measurably wrong. Derived from the spec, not exempted, and both still
  discriminate against an invented key.
- 06b8c42: Re-key three more renderer effects onto the primitives they actually read,
  instead of the memoised object identity that produced them (objectui#6697 —
  the three census members from objectui#6592 that sit outside its
  `getDataConfig(schema)` family):
  
  - `RelatedList`'s collection fetch now depends on `defaultSortKey` /
    `filterKey` (the `JSON.stringify`-derived content strings the two memos are
    already keyed on) rather than on `defaultSortSpec` / `listFilterNode`.
  - `page:tabs`' related-count probe now depends on a serialised `probeKey`
    rather than on the `probeTargets` `Map`.
  - `ListView`'s data fetch now depends on the `expandFields` memo's own INPUTS
    — `schema.columns`, the alternate views' binding blocks and
    `objectDef?.fields`, all props and state a discard cannot move — rather than
    on the `expandFields` array the memo returns.
  
  `useMemo` carries no semantic guarantee — React is permitted to discard a memo
  cache and recompute even when its dependency array compares equal to the
  previous render — and all three factories return a FRESH value on every call
  (`normalizeSortSpec`/`toFilterNode` build a new array / a freshly lowered AST,
  the probe factory builds a new `Map`, `buildExpandFields` returns a new array
  in every branch). So each effect re-ran on a discard alone, with nothing an
  author or a caller controls having changed: an extra `dataSource.find` for the
  related collection, an extra `dataSource.find` for the list window, and a
  redundant re-probe of every tab's count. Keying on the primitives makes a
  cache discard a no-op and returns `useMemo` to being a pure optimisation.
  
  Severity is low and the fix is deliberately narrow: the observable was a
  redundant round trip, never incorrect data, so only the re-run condition
  moves — each effect body still reads the memoised value, and a genuine change
  still refetches exactly as before.
  
  The three take two routes on purpose — key on the nearest DISCARD-IMMUNE
  thing. `RelatedList`'s memos are keyed on exactly one primitive each, and
  `page:tabs`' probe memo is keyed on another MEMO's output (`items`), which is
  not discard-immune, so both take a content string. `ListView`'s memo is keyed
  on props and state, so it names those directly: a value key over
  `expandFields` would NOT have been content-equivalent there — `buildExpandFields`
  collapses the collected set down to the relation roots, while the effect body
  also builds `$select` from `schema.columns` and the view bindings — and it
  would have defeated objectui#4567's live-dependency pin, which ruled that
  "ListView's by-identity dependency is correct for a real column change" and
  put the identity stabilisation at the PRODUCER.
  
  One correction to the census card's account, measured while pinning it: for
  `page:tabs` the redundant probe costs nothing on the wire.
  `RelatedCountStore.fetch` returns the cached count as its first act and dedupes
  concurrent probes, so the extra work is the effect re-running, not an extra
  request.
- 4dfdcc3: `ListView` reads `exportOptions.streaming` without a cast (objectui#6956). The
  two `as any` reads — the `exportableFormats` server-availability check and
  `handleExport`'s server-eligibility gate — and the `'pdf'` in the bare-array
  fold's cast are gone: the `ListViewSchema` type now carries `streaming` and not
  `'pdf'`, because `@object-ui/types`' zod mirror binds the spec's `exportOptions`
  field by reference. No behaviour change: the same formats are offered,
  `streaming: false` still forces the client-side path, and the bare-array fold
  (`resolvedExportOptions`, a stored `['csv', 'xlsx']` folded to `{ formats }`)
  STAYS — nothing on the render path parses and `ObjectView` forwards a stored
  value verbatim, so the spec's parse-time lift never runs before this renderer
  and the fold is load-bearing rather than legacy. A `'pdf'` stored before the
  retirement still arrives as data and is still dropped from the export menu with
  the existing one-time warning.
- d1842ab: `DataEmptyState` now declares `role="status"` by default, so an empty result is
  distinguishable from a failed one on every surface that renders it
  (objectui#7132).
  
  This is the convergence half of the two rulings that landed as objectui#7063 and
  objectui#7064, both resting on objectstack#13848: uniform behaviour belongs to
  the platform, and per-surface compensation is the per-app tax being ruled
  against. Those two fixed their own surfaces deliberately and locally; this card
  measured whether the shared primitive should carry the property. It did not.
  
  **Measured, not assumed.** All the surfaces were rendered and their empty boxes
  read directly:
  
  | surface | `role` before |
  |---|---|
  | `DataEmptyState` bare default | *none* |
  | `plugin-list` empty list | *none* |
  | `plugin-list` load-error panel | *none* |
  | `plugin-detail` activity timelines | *none* |
  | `ui:empty` schema renderer | *none* |
  | `plugin-dashboard` `WidgetEmptyState` (#7063) | `status`, typed at the call site |
  | `plugin-kanban` empty board | `status`, typed at the call site |
  
  The sibling states in the same file had always declared themselves —
  `DataLoadingState` is `role="status"`, `DataErrorState` is `role="alert"` — and
  the empty state alone declared nothing. So the surfaces were not legitimately
  differing: the ones that wanted the property had each hand-typed the same line,
  and the ones that had not yet done so were silently missing it. That is one
  platform default, copied by hand, at package level.
  
  **It is a default, not a fixed attribute** — `role` is spread from props, so a
  call site keeps the last word. That is what makes this inert for the two ruled
  surfaces: both already pass `role="status"` explicitly and receive the identical
  attribute with or without it. Neither surface's behaviour changes.
  
  **One real defect fell out of the measurement.** `plugin-list` renders its load
  FAILURE through `DataEmptyState`, borrowing it for layout — so a 403 saying "You
  don't have access" and a young object saying "Nothing here yet" were the same
  node shape, with no role on either. That panel now declares `role="alert"`,
  which both fixes the pre-existing indistinguishability and stops the new default
  from announcing an outage as a routine status.
  
  Metric/KPI widgets are untouched: their carve-out (`rows.length === 0 &&
  !isMetric`) gates whether an empty state is rendered *at all*, upstream of this
  component, so a KPI still reads `0` rather than "no data".
- a6d8b8d: Fix: a grid grouped by a field it does not also show as a column no longer collapses
  every row into one `(empty)` group (objectui#7179).
  
  `$select` was built from the view's `columns` and nothing else, so a view declaring
  `grouping: { fields: [{ field: 'business_unit' }] }` on a field absent from its columns
  never asked the server for that field. It was `undefined` on every row by the time
  grouping ran, and the grouping label builder — correctly, for a genuinely empty value —
  answered `(empty)` for all of them. The result was one collapsible group holding every
  record, with no error, no warning and no empty state: a grid that looked like it grouped
  and did not, reading as "these records have no value for this field".
  
  The grouping fields are now unioned into the projection, at both places it is built —
  `ObjectGrid` when it fetches for itself, and `ListView` when it fetches and hands the
  rows down. Lookup grouping fields are unioned into `$expand` as well: a `select` that
  fetches a bare foreign key without populating it buckets by raw id instead of by name,
  which is a different wrong answer rather than a fix.
  
  Authors do not need to mirror a grouping field in `columns` any more. That was never
  required by `@objectstack/spec` — `grouping` is a sibling of `columns`, not a subset of
  it — and the neighbouring view kinds (kanban, gantt, timeline) already unioned their
  `groupByField` with no column needed. Refusing the configuration at author time was
  considered and rejected: it would make the grid the odd one out and reject working
  intent that the schema explicitly allows.
  
  The union is guarded, and the guard is as load-bearing as the fix. A `grouping.fields[]`
  entry carries a bare string that has never been through column validation, and some
  backends answer an unknown `$select` key with an empty result set rather than ignoring
  it. Unioned unguarded, a grouping field naming something the object does not declare
  would have turned this bug into a strictly worse one — no rows at all, equally silently.
  Grouping fields are therefore intersected with the object's declared fields and passed
  through the same field-level-security gate as columns and predicate operands before they
  reach the query.
- f626808: fix(app-shell,plugin-list): a list view's own `description` now reaches the screen
  
  A `description` authored on a per-list-view entry (`listViews.<viewName>.description`)
  was validated, built and served correctly, then silently never rendered. Two
  independent cuts, both fixed here:
  
  - **app-shell** — `ObjectView`'s `renderListView` relay copied ~46 keys off the
    active view onto the schema it hands `ListView` (`label`, `sort`, `filter`,
    `hiddenFields`, `inlineEdit`, `color`, `allowExport`, …) but had no rung for
    `description`, so the renderer could only ever see the object-level list's
    description and a per-view one was unreachable. It is relayed now, with the
    same two-rung shape as `label`. This is *not* the object's own
    `objectDef.description`, which stays the page header's subtitle.
  - **plugin-list** — `ListView` rendered `typeof description === 'string' ? … : ''`,
    a type test rather than a resolution. `ListViewSchema.description` is
    `I18nLabel`, so an inline locale map (`{ en, 'zh-CN' }`) — metadata the spec
    entitles an author to write — rendered a blank strip in every locale. It now
    resolves through the same shared helper the sibling `label` uses, and the
    visibility guard reads the resolved text, so a map with no usable entry drops
    the strip instead of reserving empty space for it.
  
  `appearance.showDescription: false` still suppresses the description in both arms.
- 3ed3eec: fix(plugin-form,plugin-list,plugin-view,react): read `SchemaRendererContext` as declared, not through a cast to `any` (objectui#7209)
  
  Six reads of the renderer context erased its type. Five cast at the read —
  `useContext(SchemaRendererContext as React.Context<any>)` in the
  `embeddable-form` and `object-master-detail-form` bridges, in `ListViewBlock`
  and in `useResolvedDataSource`, and the same cast spelled with a bare
  `Context<any>` in `useElementDataSource` — and the `object-view` renderer's
  module re-declared the imported context as a `React.Context<any>`. Through
  that cast a read of a member the context does not declare compiled clean,
  which is how the phantom `ctx.formValues ?? ctx.data` channel retired by
  objectui#7206 went unnoticed. Each of these reads now sees `SchemaRendererContextType` as
  `@object-ui/react` declares it, so such a read is a compile error on the day it
  is written.
  
  No runtime behaviour changes. Removing the casts surfaced no read of an
  undeclared member; it surfaced two places where the declared `null` ("no
  adapter bound") met a prop that does not admit it:
  
  - `embeddable-form` handed that `null` to `EmbeddableForm`'s optional
    `dataSource`. It now collapses it to `undefined`, as
    `object-master-detail-form` already did; `EmbeddableForm` only ever tests the
    adapter for truthiness, so the two absences behave the same.
  - `object-view` / `view` hand it to `ObjectViewProps.dataSource`, which is
    declared required and stays so (objectui#7842). That one value now carries a
    narrow, commented assertion instead of the whole context being erased; the
    value passed is the same as before.
  
  The published signatures of `useResolvedDataSource` and `useElementDataSource`
  do not move.
- 5015fcf: A gantt list view no longer shows the record-count bar, because the bar describes a
  request that view does not draw (objectui#7210, half 1).
  
  `ListView` renders one record-count bar for every `viewType`: the row count, the
  "Showing first N records. More data may be available." warning that goes with its own
  `$top: pageSize` query, and a rows-per-page selector that re-issues that query. On grid,
  kanban, calendar, gallery, timeline and map the bar is accurate — those renderers draw
  the `data` `ListView` hands down.
  
  On `gantt` it is not. Measured, not inferred: the registered `object-gantt` renderer
  forwards no prop but `schema`, so the `data` prop never reaches the chart and
  `ObjectGantt` issues its own query — one that carries no `$top` at all. In a harness of
  18 rows with `pagination.pageSize: 6`, the chart drew all 18 while the bar under it read
  "6 records · Showing first 6 records. More data may be available." Because it is the
  only paging disclosure on the screen, a reader takes it as describing the chart; that
  reading already produced a wrong finding in an application repo, which cost a browser
  session to disprove. Authoring `pagination.pageSize` could not have fixed it either —
  the chart's request never carried a page size to begin with.
  
  Scoped to `gantt` alone. Every other surface keeps its bar unchanged, warning included;
  a kanban over the same result set still reports its page honestly.
  
  Not changed here, deliberately: the gantt's query still has no ceiling, and `ListView`
  still issues its own paged query for that view (its rows still drive the loading
  skeleton and load-error panel, `UserFilters`' option counts, and the client-side CSV /
  JSON export). Capping a non-grid view's fetch is an open maintainer decision — adding
  one would turn a complete schedule into a quietly truncated one — and this correction is
  right whichever way that lands.
- 67dadd6: FLS-gate the `$expand` projection at both build sites (objectui#7215).
  
  objectui#6898 closed field-level security on `$select`. `$expand` was left ungated at
  both projection sites — `ObjectGrid`'s own fetch and `ListView`'s `expandFields` memo —
  so a `lookup` / `master_detail` / `user` / `tree` field the current principal cannot
  read was still handed to the server for expansion. `$select` on a denied lookup asks for
  its bare foreign key; `$expand` on the same field asks the server to resolve it and
  return the related record, so the larger of the two disclosures was the ungated one.
  
  **Reproduced before it was fixed**, as failing tests at both sites, and the same leak
  reaches further on the `ListView` path: that builder's `$select` gate drops the denied
  column and then adds the expand roots back unconditionally, so the denied field walked
  back into `$select` as well. Gating the expansion closes both halves.
  
  **Grading, measured rather than assumed.** Against ObjectStack's own server this is
  defence-in-depth, exactly as objectui#6898 is: `plugin-security`'s
  `FieldMasker.maskRecord` deletes every unreadable key from each returned row, and
  objectql's expand path writes the resolved record back under that same key, so one
  statement removes the expanded object and the bare id alike; the expansion sub-read is
  itself gated (`__expandRead` takes the referenced object's full CRUD + RLS + FLS
  treatment). It is load-bearing for any backend that does not strip.
  
  **Nothing a permitted view did stops working.** The gate judges the OUTPUT of
  `buildExpandFields`, which is already a subset of the object's declared
  reference-bearing fields, so the "`checkField` answers false for an undeclared key"
  trap cannot be reached and derived / host-joined columns are untouched. An unanswered
  permission policy filters nothing. `buildExpandFields` itself is unchanged.
- ac257b3: FLS-gate the speculative half of `ListView`'s `$select` projection (objectui#7216).
  
  `ListView` builds `$select` from two populations and, until now, asked them different
  questions. The user-declared `columns` were passed through `perms.checkField(...)` by
  objectui#6898. Everything the builder adds ON TOP — the kanban / gantt / timeline /
  calendar / gallery field bindings, the timeline's auto-added `status` / `priority`
  badge fields, and the operands harvested from row-action and conditional-formatting
  predicates (objectui#3501) — went through `addSpeculative`, which intersected them
  against the object's declared fields and then added them unconditionally.
  
  The two gates it needed answer unrelated questions and neither substitutes for the
  other. The known-field gate keeps an **unknown** key out, because some backends answer
  an unknown `$select` key with an empty result set rather than ignoring it. The FLS gate
  keeps a **known but denied** key out, because sending it leaks the value at the server
  boundary even though the UI hides it. A field can be perfectly well-declared and still
  denied, and that was the case this path did not handle: a kanban grouped by a denied
  field, or a gantt bound to a denied date, still named it in the request.
  
  **Reproduced before it was fixed.** Eight of fourteen new pins fail on the unmodified
  tree, each reaching the denied field only through a view binding — a denied *column* has
  been dropped since objectui#6898, so a pin naming one would have proved nothing.
  
  The gate goes inside `addSpeculative` rather than at the five call sites, so every route
  into the speculative union is covered at once; gating call sites one at a time is how
  the asymmetry arose. It runs **after** the known-field intersection, the ordering
  objectui#7179 established: `checkField` answers false for an undeclared key, so asking
  it first would drop derived and computed bindings — and would be the reason they were
  dropped. The platform record columns (`created_at`, `owner_id`, the audit FKs) are
  carved out for the reason they already are elsewhere in this builder: every object
  carries them and none declares them, so no field policy mentions them and an FLS answer
  about them is always false. Without the carve-out a calendar bound to `created_at` would
  go blank for everybody.
  
  **Nothing a permitted view did stops working.** A permitted binding is still projected,
  an unanswered permission policy filters nothing, and the projection is rebuilt when the
  policy answers — pinned, because a gate that only runs before `/me/permissions` resolves
  is a dead gate that passes almost every test written for it.
  
  objectui#7179's `addGroupingField` wrapper is removed: its predicate was identical to
  the one now inside `addSpeculative`, and two spellings of one gate is the shape that
  lets them drift. That path keeps its behaviour and gains the FLS pin it never had.
- 2c878be: Honour a gantt view's authored `navigation` — forward it down the gantt
  view-schema path, and give the component a destination for the non-overlay
  modes (objectui#7334).
  
  **Leg 1, `@object-ui/plugin-list`.** `ObjectGantt` resolves
  `schema.navigation ?? { mode: 'drawer' }` and classifies four overlay modes
  (`drawer` / `modal` / `split` / `popover`). Nothing ever put `navigation` on the
  node it receives — `ListView`'s shared `baseProps` declares no such key and the
  `case 'gantt'` branch added only the data keys — so that fallback was the only
  branch ever taken. A gantt view authoring `navigation: { mode: 'page' }` (or
  `modal`, or `split`) opened a drawer instead, with no diagnostic. The key was
  already authorable and already read; this restores declared = enforced. No new
  authorable key is added.
  
  The key is forwarded on the `case 'gantt'` branch and deliberately **not** on
  the shared `baseProps`, because every other child view resolves this same
  question through the `onRowClick` that `baseProps` already carries:
  `ObjectGrid`, `ObjectGallery`, `ObjectKanban`, `ObjectMap`, `ObjectTimeline` and
  `ObjectTree` hand that callback to `useNavigationOverlay` unconditionally, and
  the hook gives an external `onRowClick` full priority over any `navigation` — so
  on `baseProps` the authored config would arrive there only to be outranked.
  `ObjectCalendar` is the one that would genuinely change behaviour: it mirrors
  gantt's `navIsOverlay ? undefined : onRowClick`, so an authored non-overlay mode
  would stop it suppressing the host handler. Gantt is the only branch where
  forwarding settles the question rather than splitting it, because its wrapper
  drops host props entirely (objectui#7210 / objectui#7222) and there is no
  `onRowClick` there to outrank anything.
  
  **Leg 2, `@object-ui/plugin-gantt`.** `ObjectGantt` now supplies its own
  `onNavigate`, so a click under an authored `page` or `new_window` actually
  reaches the record page. Leg 1 alone would have made `page` reachable and inert:
  `useNavigationOverlay`'s `page` branch calls `onNavigate` and returns with no
  fallback, this component supplied none, and its registration hands it no host
  `onRowClick` either — both carriers empty at once, turning an authored `page`
  from "a drawer opens, which is wrong" into "the click does nothing". The
  destination is the record-page href the component already computes for the
  drawer's full-page link, so the two cannot diverge; same-tab navigation uses the
  history plus `popstate` pair (matching `DashboardRenderer` and `PageHeader`),
  and `new_window` now opens the app-prefixed href rather than the hook's
  unprefixed fallback. No host prop is forwarded to the chart.
  
  A view that authors no `navigation` still gets **no** key and still opens its
  drawer, so the component's default is unchanged for every gantt in the product
  today; an authored `none` stays inert.
- 237e5b8: fix(plugin-list): stop re-issuing the identical records query on every visualization switch
  
  `ListView`'s fetch effect named `currentView` in its dependency list, so
  switching between Grid, Kanban, Calendar and the other visualizations re-ran it
  — but the query it builds never reads the current visualization. The only way a
  surface reaches the wire is the `$skip` of its window, and on page 1 that number
  is 0 for a flat grid and 0 for every other surface, so the re-issued request was
  byte-for-byte the one already on screen. A board reached through a view switch
  therefore cost two identical `GET /api/v1/data/<object>?top=…&select=…` round
  trips before its first paint.
  
  The effect is now keyed on the window itself (`fetchSkip`), and the two
  surface-shaped readings the fetch used to latch — the server total behind the
  grid's pager, and the row-cap banner's "…but the real total is known" half — are
  derived at render instead. Every re-fetch that changes the window is kept:
  turning the page still refetches, and leaving a paged grid from page 3 for a
  board that consumes the whole batch still refetches. What is gone is the
  round trip that changed nothing.
- d327b9c: FLS-gate the `$expand` projection at the seven remaining `buildExpandFields`
  call sites (objectui#7429).
  
  objectui#7215 / PR #7229 gated the two projection sites in its scope
  (`ObjectGrid`, `ListView`). objectui#7230 / PR #7428 gated four more
  (`ObjectCalendar`, `ObjectGantt`, `RecordDetailView`, `DetailView`). This
  closes the seven that were left: `ObjectKanban`, `ObjectTree`, `ObjectView`
  (the non-grid record-fetch effect), `ObjectMap`, `ObjectGallery`,
  `ObjectTimeline`, and the metadata-admin `PagePreview`'s record-binding fetch.
  
  **All seven pass no column list at all**, which makes every one of them the
  sharp shape: `buildExpandFields` reads an absent column list as "no column
  restriction" and falls back to **every declared relation on the object**,
  denied ones included. So each of these components asked the server to resolve
  the object's full relation set by default, not by configuration — the
  ordinary shape of each surface, not a corner of it.
  
  **`PagePreview` is the one site where the judged principal is not the page's
  eventual audience.** It calls the browser's own `fetch` with
  `credentials: 'include'` rather than `DataSource.find`, so it runs under
  whichever session is loading the Studio preview. Gating on that same session's
  `usePermissions()` is still the correct principal: it is exactly the request
  the browser is about to make, on its own credentials, regardless of who later
  opens the published page.
  
  **Reproduced before it was fixed**, as a failing test per site (and, for the
  two sites — `ObjectView`, `PagePreview` — where the gate was implemented
  before its test was run red, a reverse-verification: the gate was reverted,
  all four denial-and-set pins on each went red, and the two deferral/positive
  control pins stayed green, before the gate was restored).
  
  **Grading, measured rather than assumed** — the same reading objectui#6898,
  #7215 and #7230 recorded: against ObjectStack's own server this is
  defence-in-depth, not a live disclosure. `plugin-security`'s
  `FieldMasker.maskRecord` deletes every unreadable key from each returned row
  and objectql's expand path writes the resolved record back under that same
  key, so one statement removes the expanded object and the bare id alike; the
  expansion sub-read is itself gated (the referenced object's full CRUD + RLS +
  FLS treatment, objectstack#7626). It is load-bearing for any backend that does
  not strip, and the client-request side is real regardless.
  
  **Nothing a permitted view did stops working.** The gate judges each site's
  `buildExpandFields` OUTPUT, which contains only the object's declared
  reference-bearing fields, so the "`checkField` answers false for an
  undeclared key" trap cannot be reached. An unanswered permission policy
  filters nothing. `buildExpandFields` itself is unchanged.
  
  `@object-ui/permissions` is added to `dependencies` for `plugin-kanban`,
  `plugin-tree`, `plugin-map`, `plugin-timeline`, and `plugin-view` — the fifth
  one objectui#7429's own dependency count missed (it named four); `plugin-list`
  and `app-shell` already had it.
- c6198c2: **Breaking for authored metadata:** `ComponentInput.label`, `ComponentInput.defaultValue` and
  `ComponentInput.advanced` are RETIRED on both faces (objectui#7493 item ① and objectui#7781;
  maintainer ruling A of 2026-09-06, immediate, no deprecation window; ADR-0049 enforce-or-remove).
  They are the three keys the manifest serializer does not forward, and nothing read them on any
  publication or consumption path.
  
  No manifest ever published them, so no consumer could ever have read them. `sdui-parser`'s
  serializer (`packages/sdui-parser/src/index.ts`) forwards exactly seven keys per input — `name`,
  `type`, `of`, `required`, `enum`, `binding`, `description` — so a value authored under any of the three
  never reached `sdui.manifest.json`, the generated JSX `.d.ts`, or a diagnostic; its boundary type
  has no slot for them; the registry's data-source seam reads `name` only; and neither the designer
  nor the app-shell inspectors consult registry `inputs` at all. A structural census over every
  `inputs:` array in the repository (re-measured on this change's merge-base, `name` 951 and `type`
  951 as the controls) counted the writes: `label` 908, `defaultValue` 245, `advanced` 9 — written on
  nearly every registration, read by nothing.
  
  FROM → TO, per key — all three **TOMBSTONED, not removed**, because the route was measured on
  the built face before it was chosen: `ComponentInputSchema` is a non-strict `z.object`, and an
  undeclared key parses GREEN and is silently STRIPPED, so a deletion would have swallowed 1,162
  authored values in silence. The tombstone is what makes the refusal loud and by name.
  
  - `label?: string` → `label?: never` on the interface, `retirementTombstone()` on the Zod mirror.
    Migration: delete the key. An input is identified by its `name` on every path that reaches it;
    nothing ever rendered a label for it.
  - `defaultValue?: any` → `defaultValue?: never` / `retirementTombstone()`. Migration: delete the
    key. The renderer's own fallback read IS the default; tell the author about it in `description`,
    which IS published. (Tightening the type to `unknown` was ruled out: it closes no error class,
    since nothing reads the value.)
  - `advanced?: boolean` → `advanced?: never` / `retirementTombstone()`. Migration: delete the key.
    No designer surface ever hid an "advanced" input; there is nothing to write instead.
  
  The retirement kit: `?: never` on `ComponentInput` (`packages/types/src/base.ts`), so authoring one
  is a `tsc` error at the registration site; `retirementTombstone()` on `ComponentInputSchema`
  (`packages/types/src/zod/base.zod.ts`), so an authored value is REFUSED at parse time with
  `code: 'invalid_type'`, the key named in the issue `path`, and the migration note as the message
  (one string, both channels). Pinned in
  `packages/types/src/__tests__/component-input-retired-keys-7493.test.ts`, which also holds a
  tree-scoped absence census over every `inputs:` array under `packages/**` and `apps/**`.
  
  Accept-set change, stated plainly for reviewers: a document that sets any of the three keys on a
  `ComponentInput` used to parse GREEN (the value was then dropped by the serializer) and now parses
  RED. Every in-repo authoring site — 1,199 keys across 110 registration files, the three standalone
  `ComponentInput[]` arrays and the two named input arrays `tsc` found included — is deleted in the same change, as the ruling's split rule
  requires; the `WidgetRegistry` seam no longer copies the widget-manifest values onto the synthesized
  `ComponentInput` (they fed nothing), and the data-source declaration `ELEMENT_DATA_SOURCE_INPUT`
  drops its `label`. The patch entries on the other packages record exactly that: their registrations
  stop authoring inert keys, with no runtime or published-manifest change.
  
  The nine test files that read `defaultValue` off a registration were re-pinned against the
  renderer's ACTUAL default (its own fallback read, or the `defaultProps` it ships) instead of the
  declaration that went away; two assertions that only restated the shadow default were dropped with
  the reason on the line.
  
  The in-repo zero is what was measured. Whether anything OUTSIDE this repository writes these keys
  is not measurable from here (the objectui#5674 limit); converting such a write from a silent drop
  into a named refusal is exactly what the tombstones buy. `WidgetInput`'s own `label` /
  `defaultValue` / `advanced` (the widget-manifest face) stay declared and writable — nothing has
  ruled on that face; that it now has no reader either is recorded as objectui#7911.
- fee1da5: `ListView` no longer reads relational keys off a list column while the object
  definition is still loading (objectui#7531).
  
  Until the definition arrives, the filter and sort candidates are built from the
  view's declared `columns`. That fallback used to read `reference_to` /
  `reference`, `display_field` / `reference_field` and `id_field` off each
  column. `ListColumnSchema` declares none of them in either casing, so a
  spec-compliant producer can never put one there, and the read only kept a
  second, undeclared route alive (AGENTS.md 0.1). The candidate now carries what
  a column declares; its relational target (`referenceTo`, `displayField`,
  `idField`) comes from the object definition once it loads, as it already did.
  
  Nothing changes for a spec-compliant view. A column that carried one of these
  keys anyway now gets the same pre-load candidate as a column without it: the
  filter's lookup value picker waits for the definition instead of taking the
  column's word for the target.
- 245c7b7: The list view's capability gate now resolves `chart` (objectui#7544).
  
  A `grid` list view that declared a complete `chart:` block and whitelisted
  `appearance.allowedVisualizations: ['grid', 'chart']` was never offered the Chart
  toggle. `availableViews` builds the resolvable set from each visualization's binding
  and intersects it with the whitelist (ADR-0047, whitelist ∩ resolvable); seven
  visualizations had a capability check there — kanban, gallery, calendar, timeline,
  gantt, map, tree — and `chart` had none, so the author's own whitelist was filtered
  down to nothing and the view fell back to `['grid']`. `chart` entered the offered set
  only through the "always allow switching back to the schema's own viewType" leg, i.e.
  only when the view was already `viewType: 'chart'`.
  
  Both halves were spec-legal and authorable the whole time: `chart` is a
  `VisualizationTypeSchema` switcher target and `chart:` is a list-view key
  (`ListChartConfigSchema`). Only the gate never asked. This is `map`'s objectui#5042 one
  visualization over, and is fixed the same way.
  
  **What now resolves.** A chart block that binds to names the author wrote: the ADR-0021
  shape (`dataset` plus at least one measure in `values`), or the legacy inline shape (a
  declared category — `xAxisField` / `categoryField` — together with a declared measure —
  `yAxisFields[0]` / `valueField`), in the view-level `chart` block or the legacy
  `options.chart` bag. A block that declares no binding stays unoffered: reaching the
  renderer with nothing declared lands on the legacy branch's invented `'name'` /
  `'value'` floor, and the switcher must not offer a route into it. That floor itself is
  unchanged here (objectui#7547).
  
  The gate and the `case 'chart'` render branch now read ONE resolver
  (`resolveListChartBinding`) rather than two copies of the condition, so they cannot
  drift about what a usable chart block is. `schema.chart` also joins the memo's
  dependency array, so a block that arrives on a later render is seen.
- 5a211b2: `ObjectGallery` waits for the object definition instead of querying twice
  (objectui#7903).
  
  It sat outside the set objectui#6482 converged on the shared settled-schema gate
  — `ObjectKanban`, `ObjectView`, `ObjectCalendar` and `ObjectTree` were named
  there, `ObjectGantt` was ask 2 of objectui#7225 and `ObjectTimeline` was
  objectui#7895 — and nothing marked it a deliberate exclusion. It still held the
  object definition in a local `useState` fed by its own metadata effect, and
  listed that definition in the record-fetch effect's dependency array.
  
  **User-visible.** Every object-bound gallery load issued **two** `find` calls
  instead of one: the first before the definition landed, with `buildExpandFields`
  seeing no fields and therefore carrying no `$expand` at all, and a second one
  after. The first paint was therefore a grid of cards rendered from raw
  foreign-key ids. After this change the gallery paints once, from a query that
  already carries its expansion.
  
  Measured on the component with an instrumented renderer, one mount per hold,
  `getObjectSchema` held 0/1/2/3/4/5/6/7/8/9/10/15/25/50/100 ms, with
  `ObjectCalendar` as a positive control in the same run: before, 2 `find` calls
  with expand sets `[null, ['owner']]` at every hold, the issue order always
  `schema:issued, find(unexpanded), schema:settled, find(expanded)`, two distinct
  painted states, 3 late writes into the card grid after the first paint, and a
  first-paint time flat at 3-7 ms across the whole sweep; after, 1 `find` carrying
  `['owner']`, one painted state, 0 late writes, and a first paint that tracks the
  hold (9 ms at +3, 15 ms at +10, 35 ms at +25, 106 ms at +100). The control read
  1 `find` carrying `['owner']` and a hold-tracking first paint both before and
  after.
  
  The cost this component was paying is a **two**-step paint, not the three-step
  one `ObjectCalendar` and `ObjectTimeline` each measured: those make `loading` an
  unconditional early return, so their re-run drops back to a placeholder in
  between, while this component's early return is `loading && !items.length` — the
  raw ids were replaced in place. Measured here rather than inherited from the
  matching shape, which is objectui#6482's own per-component standard.
  
  The resolution half is now `useSettledSchema` from `@object-ui/react`, which
  settles on **every** exit — no source, no `getObjectSchema`, no object name, and
  a read that threw alike. That is what makes the gate safe: the replaced effect
  returned without settling on all four, which cost nothing while nothing waited on
  it and would have held a gated query open forever. Pinned by
  `ObjectGallery.fetchGate-7903.test.tsx`, including a gallery whose adapter
  exposes no `getObjectSchema` and one whose definition read rejects — both still
  query, unexpanded.
  
  Two departures, each judged for this component rather than copied. Like
  `ObjectTimeline` and unlike `ObjectCalendar` / `ObjectGantt`, the metadata read
  is **not** disabled for a gallery whose records were authored inline: this
  component reads the definition on every path, for cell semantics and for ADR-0079
  card titles, not only to expand a query. And the gate window now holds the
  loading placeholder rather than showing "No items to display", which the two
  siblings get from their initial `loading` state and this one did not.
- abc1b18: Add `isEmptyValue` to `@object-ui/core` — the weakest common claim about "is
  this value empty": `null`, `undefined`, the empty string, the empty array, and
  never a fifth member (objectui#8496, director seat, decision batch #86).
  
  Five surfaces had each grown their own copy of those four members, and
  objectui#8481 was the third rediscovery of the same hole. They now call the
  shared floor and state their own answer against it: `record:details`'
  `hasCellValue` and `RelatedList` extend it with a trim, `BooleanCellRenderer`
  with every non-boolean, the date cells with every falsy scalar; `JsonCellRenderer`
  declines its `[]` member out loud (the array literal is drawn on purpose) and
  `FileCellRenderer` states "0 files" instead.
  
  Two visible fixes come with it: a gallery card and a kanban card holding an
  empty array in a card field now OMIT that field, as they already did for `null`,
  instead of drawing a labelled "No value" em-dash for it.
- c10bc4c: fix(plugin-list): `convertFilterGroupToAST` folds the operator, so a canonical value-less row emits its node instead of being dropped (objectui#9359)
  
  NOT cosmetic, and not a new defect: a filter row carrying the spec's canonical
  operator spelling QUERIED WITH NO FILTER AT ALL and returned every record,
  while the filter panel showed the condition applied. Nothing errored and the
  result set looked plausible.
  
  `convertFilterGroupToAST` read the row's operator RAW, against
  `VALUELESS_FILTER_BUILDER_OPERATORS` — the FilterBuilder's six camelCase
  dropdown ids. The completeness test it falls through to
  (`isFilterValueComplete`) DOES fold, through the spec's
  `normalizeFilterOperator`, to decide arity. So the two halves of one predicate
  spoke different vocabularies: a row spelled `is_null` missed the value-less
  short-circuit, landed on `scalar`, had its `value: ''` read as an unfinished
  row, and was dropped. Measured through the real converter on one `text` column:
  
      isNull   (dropdown id)   ->  ["title","isnull",null]
      is_null  (canonical)     ->  []                        <- the defect
      equals + value "acme"    ->  ["title","=","acme"]      <- control, fires
  
  WHO REACHES THIS READER — measured, not assumed. Its one production caller is
  `buildEffectiveFilter`, and the argument it converts is the list toolbar's own
  FilterBuilder group: live in the session, or restored per browser by
  `writeListFilterState`. Both carry the dropdown's camelCase ids, so the
  canonical spelling has no measured producer into this reader today. A SAVED
  view does NOT arrive here — its stored `ViewFilterRule[]` travels
  `schema.filter` into the base-filter argument of that same call and is lowered
  by `@object-ui/core`'s `toFilterNode` / `viewFilterRuleToNode`, which already
  folds: `{ field: 'closed_at', operator: 'is_null', value: '' }` lowers to
  `["closed_at","is_null",""]`, accepted by `isFilterAST`. So what is repaired is
  not a live saved-view outage. It is a reader that contradicted its OWN declared
  contract — the comment above it states it accepts both the FilterBuilder
  vocabulary and the `@objectstack/spec` `ViewFilterRule` vocabulary, and it
  dropped a COMPLETE row of the second one, emitting no filter rather than an
  error. A reader that drops a complete row is a defect whether or not today's
  saved-view path happens to pre-fold.
  
  This is the same failure objectui#4744 repaired for the dropdown's own
  spellings, reached by the other vocabulary. Both raw reads in this function now
  fold, as do the two `isEmpty` / `isNotEmpty` arms that resolve to a null
  comparison ahead of `mapOperator` — leaving those on literal ids would have
  fixed `is_null` and left `is_empty` emitting a different node from its twin,
  which is this defect rather than a repair of it. All four canonical spellings
  now emit exactly what their camelCase twins emit.
  
  **The exported set is unchanged, deliberately.** It states a fact about what the
  BUILDER'S DROPDOWN draws, and `app-shell`'s `foldFilterGroupToSpecRules`
  documents its own value-less set as that set PLUS the canonical spellings only
  that layer sees. Widening the export would have made that layer's deliberate
  compensation redundant by side effect, in a file nobody is editing. The defect
  was a reader that forgot to normalize its input, so the reader is what was
  repaired — the same shape the sibling repair used at the builder's value-input
  gate (objectui#9302). No published type or export changes, and no stored
  operator is rewritten: converting is not migrating.
  
  Which operator vocabulary should WIN is a separate, still-open question and is
  not decided here. The `contains` / `icontains` boundary is untouched and pinned:
  the fold this reader routes through maps neither onto the other.
  
  Superseded in this release by objectui#9306: the list toolbar's FilterBuilder
  now emits the protocol's canonical ids, so the canonical spelling IS a measured
  producer into this reader, and `VALUELESS_FILTER_BUILDER_OPERATORS` holds
  `is_empty`, `is_not_empty`, `is_null`, `is_not_null`, `exists` and `notExists` —
  its membership changed in this release by that change, still one id per
  operator. A group restored per browser carries whatever ids it was written
  with, so a group written before objectui#9306 can still reach this reader in
  camelCase. This reader is unchanged and answers both spellings alike: over the
  former dropdown ids and the ids they became (the list reader's leg of
  objectui#9306's census), every pair emits the same node except
  `containsCaseInsensitive`, which the toolbar never offered and which the builder
  folds onto `icontains` before a row leaves it. The vocabulary
  question this entry calls open is answered: the dropdown speaks the protocol's
  ids, and camelCase is the deprecated alias form.
  
  **Correction, 2026-10-03 (objectui#10813).** The two `isEmpty` / `isNotEmpty` arms that
  "resolve to a null comparison ahead of `mapOperator`" are gone in this release. The empty pair
  now takes the same value-less path as `is_null`, and `mapOperator` emits the spec's `isempty` /
  `isnotempty`, which the spec lowers to `$empty`; every spelling of the pair still emits one node
  (`.changeset/10813-list-view-empty-operator.md`).
- c1006ed: `ListView`'s record-detail overlay heading resolves an inline locale map.
  
  `ListViewSchema.label` is an `I18nLabel` — a plain string **or** an inline locale
  map such as `{ en: 'Accounts', 'zh-CN': '客户' }`. The `detailTitle` computation
  handed the raw member into the interpolation options of
  `detail.recordDetailWithLabel`, so a map-valued label reached the interpolator as
  an object and the heading rendered `[object Object] Detail`. That value is
  `NavigationOverlay`'s `title` prop, which objectui#3426 established is the visible
  heading of the record-detail drawer / modal / split / popover — so the corruption
  was on user-visible chrome, in every locale, on both interpolators (the i18next
  one and the provider-less fallback that stringifies with `String`).
  
  No compiler run could have named the site: `createSafeTranslation`'s options bag
  is declared as a record of `unknown`, which accepts the map without a diagnostic.
  Nothing but an executed assertion holds it, which is why the repair ships with
  pins on both interpolator legs.
  
  The label is now resolved through `resolveI18nLabel` on the same `displayLocale`
  this component already uses for the view label and the nested `aria` bag —
  **before** the truthiness test rather than inside the branch, because
  `resolveI18nLabel` answers `undefined` for a map with no usable entry and `''`
  for an empty entry, and both have to fall through to the `objectName` branch the
  way a missing label always did. Every object is truthy, so a resolution placed
  inside the branch cannot do that.
  
  Output for a string-valued `label` is unchanged, byte for byte, in every locale
  and with no provider mounted.
- a883ec2: fix(plugin-list): gallery cards now pass a field's declared `scale` to the shared cell renderer, so a number or percent field declaring `scale` renders padded (`25.00%`) exactly as Grid and Detail do, instead of unpadded (`25%`). (objectui#9575)
- f5e2fcb: Refuse a page size the contract already refuses before it reaches any of
  `ListView`'s six consumers of the resolved value, instead of forwarding it to
  the wire (objectui#9897).
  
  One authored `pagination.pageSize` is resolved once in this view and then feeds
  six places: the `$top` window it fetches, the `$skip` step that turns the page,
  the has-more gate behind the "showing first N" cap, the page size handed down to
  the child grid, the record cap printed in that banner, and the rows-per-page
  control's own displayed value. The resolution was a bare `??` chain, and `??`
  rejects only `null` and `undefined` — so an authored `pageSize: 0` was not
  nullish and survived as a real page size into all six.
  
  What the surviving value actually did, measured in the real renderer over a
  twelve-row fixture rather than inferred from the sibling repair: `$top: 0` went
  out on the wire, the data source was asked for nothing, nothing came back, and
  the view drew its EMPTY STATE — the child grid never rendered at all, so there
  was no table, no record-count bar and no pager, and nothing on screen named the
  cause. A negative left the same way (`$top: -10`). A non-integer is worse than
  silent: `25.5` reached the wire, became the child grid's page size, and turning
  the page asked for a fractional `$skip`; at a size below the row count the
  refused number was printed to the reader as the record cap ("showing first 2.5
  records").
  
  All of it now goes through one resolver, mirroring the shape objectui#9853
  landed on `ObjectGrid` — one resolver at every entry is what keeps the answer
  single. A value the contract refuses is dropped, this view's own default is
  used, and one `console.warn` on the channel this component already uses for
  "you declared it, the renderer dropped it" names the member and the value. The
  warning is conditional: an absent key and a usable page size both stay silent.
  The runtime choice is covered as well, not only the authored one — an author can
  put a refused number in `pageSizeOptions`, and picking it used to overwrite a
  perfectly good authored size.
  
  Refusing these is not this renderer choosing a meaning. `@objectstack/spec`
  declares the view pagination member a positive integer and its own suite pins
  the refusals under the names `should reject zero pageSize` and `should reject
  negative pageSize`; the `limit` this package's `ElementDataSourceMapping` lowers
  `pagination.pageSize` into is declared positive as well.
  
  The fallback literal is now a named constant. Whether it belongs next to
  `ObjectGrid`'s own three defaults is **not** decided here — changing it changes
  what every list with no authored `pagination` fetches, which is a product
  decision rather than an execution seat's, and it is handed back as a question on
  the issue.
- 3a54c39: Deliver an authored map `style` on the list-view and object-view paths (objectui#9950).
  
  `ObjectMapConfigSchema` declares `style` ("MapLibre style URL/spec (overrides the
  public demo default)"), and both view flatteners dropped it before the renderer ever
  saw it. A view authoring `map: { style: 'https://…/style.json' }` parsed green, nothing
  refused it, nothing warned, and the map rendered on MapLibre's **public demo tiles**.
  
  Each flattener's key whitelist is now a TOTAL spelling table,
  `FLAT_MAP_CONFIG_SPELLING`, mapping every key `ObjectMapConfigSchema` declares to the
  name the internal flat form uses for it. Every entry is the identity except `style`,
  which is delivered as `mapStyle`.
  
  `mapStyle`, not `style`, because the top-level `style` key is `BaseSchema.style` —
  inline CSS, legal on every node. Collapsing the two namespaces onto one key is the
  defect objectui#5177 closed and this change deliberately keeps closed: the flatten
  still never writes a top-level `style`. `mapStyle` is a declared member of
  `ObjectMapSchema` and is the first spelling `getMapConfig` reads
  (`schema.mapStyle || schema.map?.style`), so the authored style now reaches the
  renderer without inventing an undeclared transport key.
  
  An undeclared key in the `map` block still never reaches the product — that half of
  objectui#5177 is unchanged and pinned in both packages' `mapFlatten` suites.
  
  **Why the anti-drift pins did not catch this.** Both sites already pinned their hand
  list against the declaration, and both pins were green. They compared the list against
  `Object.keys(ObjectMapConfigSchema.shape).filter((key) => key !== 'style')` — the
  comparison set had the same key subtracted from it that the whitelist was missing, so
  the pin agreed with the omission. Those pins now measure the relation "every declared
  key is delivered, under its flat spelling" against the declaration read whole, and each
  suite carries a control that feeds the pre-fix whitelist to the same assertion and
  shows it rejected. The spelling table is additionally a `Record` over every
  `keyof ObjectMapConfig`, so a key added to the declaration fails `tsc` until it is
  given a flat spelling.
  
  **Migration.** None. Views that never authored `map.style` are byte-identical in
  behaviour; views that did now render with the style they declared instead of the
  public demo tiles.
- 15236e0: `list-view` harvests row-action predicate fields from the OBJECT's `userActions` block only — a view's toolbar policy can no longer shadow it.
  
  `userActions` names two different blocks. On a **view** it is toolbar policy —
  the spec's `UserActionsConfigSchema` (`sort`, `search`, `filter`, `refresh`,
  `rowHeight`, `addRecordForm`, `editInline`, `buttons`), which rejects `edit` by
  name. On an **object** it is the CRUD-predicate block (`edit` / `delete` /
  `create` carrying `visibleWhen` / `disabledWhen`, objectui#2614) — and that is
  the only shape `listViewPredicates` can read, since its loop skips every
  non-object value.
  
  `ListView` read the key view-first when building the `$select` projection
  (`(schema as any).userActions ?? (objectDef as any)?.userActions`). A view
  carrying a perfectly legal toolbar block therefore shadowed the object's CRUD
  predicates, the harvest found none, and the predicate's operand left the
  projection. CEL then faults on the absent key, fails closed, and the row
  Edit/Delete button disappears for everyone with nothing pointing at the
  projection — objectui#3501's failure, reached with a success receipt at every
  step.
  
  This is the sibling of the `plugin-grid` read site fixed in objectui#5426, and
  it was the worse of the two: `app-shell`'s `ObjectView` builds the view-level
  `userActions` it hands down as an object literal of two spreads, so the left
  operand was `{}` at worst — never nullish. The `??` never fell through, and the
  object's CRUD predicates were never consumed at all on that path, whether or
  not an author wrote any toolbar policy.
  
  The harvest now reads the object block only. Both `userActions` read sites in
  `ListView.tsx` carry a comment naming the collision, and
  `__tests__/ListView.userActionsCollision.test.tsx` pins each clause of it: the
  two shapes, a producer that manufactures the view one, the harvest's blindness
  to it, and the projection that must keep the object's operand with a toolbar
  block — or an empty block — present on the view.
  
  Toolbar policy itself is untouched — it was never read through this path.
- ec9fdaa: `ListView` now resolves the nested `aria.ariaLabel` against the audience's locale
  instead of casting it to a string (objectui#5134).
  
  `@objectstack/spec`'s `AriaPropsSchema` types `ariaLabel` as `I18nLabel` — a plain
  string **or** an inline locale map (`{ en: 'Accounts', 'zh-CN': '客户' }`). The only
  read site in this repo spread it into the DOM as
  `{ 'aria-label': schema.aria.ariaLabel as string }`, and `as string` is a cast, not a
  conversion: a map-valued label reached the DOM as `aria-label="[object Object]"`, which
  a screen reader announces as the list view's accessible name — in every locale. The
  read now goes through the spec's own `resolveI18nLabel` (the resolver four other
  in-repo read sites already use) against `useDisplayLocale()`.
  
  ⚠️ **Dated note, 2026-09-29 — the read-site count above does not re-derive —
  objectui#10979.** "the resolver four other in-repo read sites already use" above does not
  hold even at this change's own base. On the commit this change landed on (`e40b8579bd`),
  ten non-test source files already imported `@objectstack/spec`'s `resolveI18nLabel` (each
  as `resolveInlineI18nLabel`) and called it on 17 lines. Re-measured on `main` at
  `2eaf5be27`, fourteen non-test files besides `ListView` imported it, calling it on 27
  lines. The text above is kept as the reading of this change.
  
  Reachability, stated plainly: the path is **live but unexercised**. `I18nLabel` was a
  plain `string` through `@objectstack/spec` 17.0.0-rc.5, so no stored map-valued label
  predates rc.6, and no measured author writes one today — but map values are legitimate
  and arrive via API/import, so an imported list view carrying
  `aria: { ariaLabel: { en: …, 'zh-CN': … } }` is spec-valid metadata that renders a wrong
  accessible name. This is the map form working as declared, not a defect users are
  currently hitting.
  
  Behaviour on the string arm is byte-identical, including `''` (falsy before and after,
  so no attribute). One edge changes for the better: a map that matches no locale used to
  render `aria-label="[object Object]"` (`{}` is truthy) and now omits the attribute — an
  unnamed region beats a garbage-named one.
  
  The **flat** `schema.ariaLabel` is deliberately untouched: it carries a different
  vocabulary (objectui's keyed `{ key, defaultValue?, params? }` ref, resolved by
  `SchemaRenderer`'s `resolveKeyedI18nLabel`), and neither resolver accepts the other's
  shape.
- d6613a2: Two comment corrections in `ListView.tsx` (objectui#4559, objectui#4966). No runtime
  behaviour changes and the emitted bundle is byte-identical; the published `.d.ts` does
  change, which is why this is a `patch` rather than an empty frontmatter.
  
  **objectui#4559 — the sort rationale stopped prescribing a formula field.** The comment
  block above the `sortFields` memo still called a formula field "the supported
  alternative (… which sorts like any text column)". Since objectui#4294 the
  `list.sortRelationalHint` string in this same file says the opposite ("Not a formula
  field: it is virtual, so no column is stored for it and the server refuses to sort by
  one"), the memo underneath filters formula out via `UNMATERIALIZED_FIELD_TYPES`, and the
  server answers such a sort with `400 INVALID_SORT` (objectstack#6994). The parenthetical
  now names the remedy the hint, the server's refusal and the README already share — a
  stored field that denormalizes the name onto this object, written when the source
  changes. This was the last copy of the retired advice in the repo.
  
  **objectui#4966 — `formatActionLabel`'s docblock now sits above `formatActionLabel`.**
  It had drifted two declarations up, so the exported `parseSortConfig` carried two
  stacked leading comments and the helper carried none. This one was not cosmetic: because
  `parseSortConfig` is exported, `vite-plugin-dts` copied the misattributed block into
  `dist/ListView.d.ts`, so every consumer's editor hover and TypeDoc introduced the sort
  parser with a sentence about action labels. Moving the block removes it from the `.d.ts`;
  `formatActionLabel` is module-private, so its now-correct docblock does not appear there.
  It also matters to `scripts/check-spec-symbol-derivation.mjs`, whose rule 2 reads the
  comment block *attached* to a declaration — a misattributed docblock is the mechanism by
  which a claim gets scored against the wrong symbol. This block carries no spec-alignment
  phrase, so nothing fired today.
  
  No tests accompany this change and none could: both edits are comment-only, and there is
  no runtime behaviour to pin. The `.d.ts` delta was measured with the package's real
  `vite build` before and after, not asserted.
- fb336df: Move `lucide-react` from `^1.31.0` to `^1.43.0` in every package that declares it, and
  repair what the jump breaks, so icons resolved from a STRING keep drawing a glyph.
  
  Measured once against the installed 1.43.0 artifact when this change was made; nothing in
  the repository re-derives these readings. Across the jump lucide removes no runtime export,
  no public type name and no `lucide-react/dynamic.mjs` name, and every name this repository
  imports from `lucide-react` resolves. Exactly one key leaves the runtime `icons` record:
  `Trash2`, retired in favour of `trash`.
  
  What a user sees change:
  
  - Icons the lazy icon seam draws (`resolveIcon`, objectui#9251) get their path data again.
    lucide 1.43.0 icon modules export their path data inside `__iconData` and no longer
    export `__iconNode`; the seam now reads both. Reading only `__iconNode` against 1.43.0
    leaves every such glyph an empty box, with nothing thrown or logged.
  - `DetailView`'s delete action and three schema-catalog examples spell their icon
    `trash`, not `trash-2`, so they keep resolving. The glyph is unchanged: 1.43.0's `trash`
    path data is byte-identical to the `trash-2` path data of 1.31.0 and 1.35.0. Anything
    that already authored `trash` now draws that same artwork, because lucide moved it under
    the `trash` name; a few other glyphs were also redrawn upstream.
  - Icons imported as COMPONENTS carry lucide 1.43.0's own classes: one class per declared
    alias (a spinner renders `class="lucide lucide-loader-circle lucide-loader-2 ..."`), and
    no longer the class lucide used to derive from the PascalCase key where that differs
    (`ArrowDown01` no longer carries `lucide-arrow-down01`). The canonical
    `lucide-<icon name>` class is still there, so a `.lucide-loader-circle` selector still
    matches.
  - Icons resolved from a STRING through the seam keep the classes they had: `lucide`, the
    canonical `lucide-<icon name>` class and the key-derived class. They do not carry
    lucide's per-alias classes. That is a maintainer ruling (objectui#8941, option C): the
    alias list lives only inside each lazily loaded icon module, and it was not moved into
    the eager name list. A selector that targets an alias class matches a component-imported
    icon and not a string-resolved one. This also dates the example in the objectui#9251
    entry: `trash-2` no longer resolves as a string, so no seam-drawn glyph carries
    `lucide-trash2 lucide-trash-2`; a digit-bearing name that still resolves, such as
    `arrow-down-0-1`, carries `lucide-arrow-down01 lucide-arrow-down-0-1`.
- 6c6cee7: A RETIRED field-type spelling is now refused — out loud, once — by every
  field-type predicate in the renderer, not just by the widget road
  (objectui#4914, maintainer ruling B of 2026-08-18).
  
  `@object-ui/fields` exports a single `isRetiredFieldType(t)` gate, and it runs
  ahead of six predicate faces that previously granted a retired spelling
  first-class treatment: the filter builder's operator buckets and its value
  control (`@object-ui/components`), the detail page's highlight-strip picker
  (`@object-ui/plugin-detail`), `normalizeFieldType` (`@object-ui/plugin-view`),
  the dashboard's `$expand` whitelist and `isLookupType`
  (`@object-ui/plugin-dashboard`), and the list toolbar's lookup-like filter
  control (`@object-ui/plugin-list`). Each one now fires the migration
  prescription on the console — once per spelling across all of them, never once
  per predicate — and then answers as it would for a spelling it does not
  recognise.
  
  This closes the whole CLASS rather than one word: the gate is quantified over
  `RETIRED_FIELD_TYPES`, so the next retirement covers all seven consumers on the
  day it lands. It is the shape objectui#4932 and objectui#4942 already
  established for the form and inline-edit roads.
  
  Measured before the change, and the reason the fix is a gate rather than a
  deletion: `owner` was not dead in these faces. `operatorsForFieldType('owner')`
  equalled the `user` bucket item for item, `computeLookupExpand` actively
  requested `$expand` for it, `isLookupType('owner')` was `true` alongside
  `reference`, and `normalizeFieldType('owner')` answered `'select'` exactly as
  `picklist` does. Deleting the members alone would have traded a visible
  contradiction for a SILENT degradation — a filter picker collapsing to a bare id
  box, `$expand` quietly stopping so cells show raw foreign-key ids — which is
  verbatim the failure mode `RETIRED_FIELD_TYPES`' own docblock exists to prevent.
  The gate keeps that fallback and adds the half that was missing: the author is
  told.
  
  The boundary question is answered on record: `owner` arriving through a
  backend-vocabulary normalizer is an authoring error to refuse loudly, not
  legitimate foreign input to tolerate. The open backend vocabulary those
  normalizers exist for is untouched — `reference`, `picklist`, `money`, `int`,
  `datetime_tz` and the rest are equally absent from the spec's closed `FieldType`
  and are equally unretired, so they classify exactly as before.
  
  `RETIRED_FIELD_TYPES`, `reportRetiredFieldType` and `resetRetiredFieldTypeReports`
  move to `@object-ui/core` and are re-exported from `@object-ui/fields`, so that
  package's published surface is unchanged apart from the newly ruled gate.
  `@object-ui/components` is a consumer of the gate and `@object-ui/fields`
  depends on it, so a single shared table could not live in `fields` — and a
  second copy would have meant a second dedupe set and two console lines for one
  spelling. No package gained a new dependency.
  
  A retired spelling never loses a stored value: `retypeFilterValue` is
  deliberately not gated, and the refused filter row stays operable rather than
  drawing a blank operator trigger.
- 42887e0: Repair five retired lucide icon spellings that reach a record-reading resolver, and pin
  the names against the runtime `icons` record so the next lucide bump goes red instead of
  silently blanking a glyph (objectui#5622).
  
  lucide retires a spelling by dropping it from its runtime `icons` record while KEEPING it
  as a deprecated named export. A retired name therefore still imports, still type-checks,
  and still renders wherever it is used as a COMPONENT — and resolves to `null` wherever it
  is used as a STRING, because every string lookup here reads that record. Nothing goes red
  either way. Measured against the installed `lucide-react@1.31.0` (1767 record entries) at
  implementation time.
  
  What a user sees change:
  
  - `DetailView`'s mobile Edit action (`icon: 'edit'` → `'square-pen'`) draws its icon
    again. Its items become an `action:bar` schema whose renderers resolve `icon` through
    `renderers/action/resolve-icon.ts`, so the touch-breakpoint edit affordance had been
    drawing a label with nothing beside it. `Edit === SquarePen`, so the glyph is unchanged.
  - The `ui:icon` renderer's own declared default (`'smile'` → `'face-slightly-smiling'`, in
    both the registration `icon` and the `name` input's `defaultValue`) resolves again: the
    designer palette entry's glyph was blank, and an `icon` dropped from that palette
    rendered nothing plus a `console.warn`. `Smile === FaceSlightlySmiling`, so the palette
    looks exactly as it did.
  - `plugin-list`'s `ViewSwitcher` moves `Grid` → `Grid3x3`, `BarChart3` → `ChartColumn`
    (both identical objects, no visual change) and `GanttChartSquare` → `ChartGantt`. The
    gantt one IS a glyph change: it matches the spelling the sibling `plugin-view` switcher
    landed in objectui#5586, so one view type no longer draws two different icons depending
    on which switcher is on screen.
  
  Four resolvability pins are added — in `plugin-detail`, `plugin-list`, `components` and
  alongside the `DeclaredActionsBar` fixtures. Each asserts `icons`-record MEMBERSHIP rather
  than resolvability, because every retired spelling repaired here is the SAME component
  object as its replacement (`Edit === SquarePen`, `Smile === FaceSlightlySmiling`,
  `Grid === Grid3x3`, `BarChart3 === ChartColumn`, `CheckCircle === CircleCheckBig`,
  `XCircle === CircleX` are all true): a pin that rendered the glyph, or reached for the
  export, would pass on the broken name. That is the blindness that let this ship.
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [a507334]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [afb2284]
- Updated dependencies [3ac2de8]
- Updated dependencies [0aacecc]
- Updated dependencies [63f4f92]
- Updated dependencies [777fca2]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [0361d6b]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [6ce001a]
- Updated dependencies [162621b]
- Updated dependencies [4c6f549]
- Updated dependencies [80c5412]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e686f4d]
- Updated dependencies [212c451]
- Updated dependencies [a04b06d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
- Updated dependencies [65f1e8d]
- Updated dependencies [1f8ef0a]
- Updated dependencies [bb5d4ee]
- Updated dependencies [dc666f7]
- Updated dependencies [3335767]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [cff4b77]
- Updated dependencies [31938f0]
- Updated dependencies [961ceaa]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [1dbb993]
- Updated dependencies [2b5f509]
- Updated dependencies [808f339]
- Updated dependencies [6cf5999]
- Updated dependencies [274e14a]
- Updated dependencies [8c10f4f]
- Updated dependencies [90dac98]
- Updated dependencies [6096f20]
- Updated dependencies [544aca2]
- Updated dependencies [ea02938]
- Updated dependencies [a14fb23]
- Updated dependencies [ae98f1d]
- Updated dependencies [f98eddf]
- Updated dependencies [ce6bd99]
- Updated dependencies [a5b08c9]
- Updated dependencies [86982ac]
- Updated dependencies [8c929e6]
- Updated dependencies [cdefa2a]
- Updated dependencies [2fc2a24]
- Updated dependencies [0961d5e]
- Updated dependencies [9d25b9b]
- Updated dependencies [6276478]
- Updated dependencies [5e67837]
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [09ab32b]
- Updated dependencies [8acc51b]
- Updated dependencies [ea9d17f]
- Updated dependencies [45362a3]
- Updated dependencies [2a943bf]
- Updated dependencies [111fa4c]
- Updated dependencies [93a689d]
- Updated dependencies [4357a27]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [39bf246]
- Updated dependencies [8740e86]
- Updated dependencies [d22b37b]
- Updated dependencies [8c0e550]
- Updated dependencies [fde4caf]
- Updated dependencies [caf0ed0]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [a7df45f]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [6516320]
- Updated dependencies [98b1a7c]
- Updated dependencies [e0f8202]
- Updated dependencies [ac2d6f1]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [1c5ee33]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [a9c5ea0]
- Updated dependencies [02e6d36]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [f905090]
- Updated dependencies [3cd6c5e]
- Updated dependencies [5bb855d]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [bf14b64]
- Updated dependencies [4345558]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [41ae65b]
- Updated dependencies [baac95a]
- Updated dependencies [13220af]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [b32e7de]
- Updated dependencies [ff94a12]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [97672ba]
- Updated dependencies [c5ec15c]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [d0c0c7f]
- Updated dependencies [30b11ad]
- Updated dependencies [4aebea0]
- Updated dependencies [f976774]
- Updated dependencies [3d6badf]
- Updated dependencies [25cb364]
- Updated dependencies [a60539b]
- Updated dependencies [de1b879]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [ad1785c]
- Updated dependencies [3b469c8]
- Updated dependencies [990a2d6]
- Updated dependencies [990a2d6]
- Updated dependencies [1c84036]
- Updated dependencies [1c84036]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [9e6619f]
- Updated dependencies [f6ae5e2]
- Updated dependencies [eb97ce6]
- Updated dependencies [7343376]
- Updated dependencies [b2683a2]
- Updated dependencies [dded788]
- Updated dependencies [b45d463]
- Updated dependencies [54a7830]
- Updated dependencies [f3135a4]
- Updated dependencies [b5696d3]
- Updated dependencies [3f9d926]
- Updated dependencies [e978ed5]
- Updated dependencies [6a7f24e]
- Updated dependencies [b3c96d6]
- Updated dependencies [8d0ca91]
- Updated dependencies [c30c8dd]
- Updated dependencies [244d516]
- Updated dependencies [deca847]
- Updated dependencies [ac15833]
- Updated dependencies [ac15833]
- Updated dependencies [e2dffc9]
- Updated dependencies [328abeb]
- Updated dependencies [dd0d78f]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [e227156]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [4b742f4]
- Updated dependencies [42687ba]
- Updated dependencies [6cd8f66]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [e327c89]
- Updated dependencies [2eaf5be]
- Updated dependencies [bf7ab35]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [63ab761]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [51c2949]
- Updated dependencies [a4b017e]
- Updated dependencies [8732846]
- Updated dependencies [559a2e2]
- Updated dependencies [db11afd]
- Updated dependencies [154075a]
- Updated dependencies [582edef]
- Updated dependencies [19f484f]
- Updated dependencies [0a78a20]
- Updated dependencies [615346d]
- Updated dependencies [75dcc81]
- Updated dependencies [55a12a8]
- Updated dependencies [edfcf5a]
- Updated dependencies [0a3e540]
- Updated dependencies [c021b35]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [54997ff]
- Updated dependencies [81f8498]
- Updated dependencies [a782fa7]
- Updated dependencies [1d6a23d]
- Updated dependencies [0645133]
- Updated dependencies [76e9df0]
- Updated dependencies [0ecaa7d]
- Updated dependencies [b24f93a]
- Updated dependencies [6158e4c]
- Updated dependencies [cff8641]
- Updated dependencies [c27b575]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [385ebc5]
- Updated dependencies [3a0e7ab]
- Updated dependencies [858eafb]
- Updated dependencies [a8c5509]
- Updated dependencies [c2a8d23]
- Updated dependencies [0ffc423]
- Updated dependencies [3cc4fe5]
- Updated dependencies [cd5b19a]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [2e3da72]
- Updated dependencies [1263e40]
- Updated dependencies [e6bc087]
- Updated dependencies [9419df1]
- Updated dependencies [8bab157]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [18d1a0a]
- Updated dependencies [7fed09d]
- Updated dependencies [c1763e5]
- Updated dependencies [58da8ae]
- Updated dependencies [a8b9889]
- Updated dependencies [138ad45]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [2124d04]
- Updated dependencies [be52115]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [5638529]
- Updated dependencies [d0fba91]
- Updated dependencies [c476be0]
- Updated dependencies [c82ff39]
- Updated dependencies [6c3da53]
- Updated dependencies [31987bd]
- Updated dependencies [3c3ce15]
- Updated dependencies [063119f]
- Updated dependencies [e100589]
- Updated dependencies [304f611]
- Updated dependencies [e46ee77]
- Updated dependencies [f9c8c4e]
- Updated dependencies [6e9c8d2]
- Updated dependencies [9547063]
- Updated dependencies [3f6efd6]
- Updated dependencies [52c95a1]
- Updated dependencies [55d18c6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [c4ab6d0]
- Updated dependencies [5988b6b]
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [6007dd4]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [185b7a0]
- Updated dependencies [50c73fe]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
- Updated dependencies [2b188fa]
- Updated dependencies [b654d4e]
- Updated dependencies [f68e0a0]
- Updated dependencies [aea682a]
- Updated dependencies [fcdc8ec]
- Updated dependencies [2d576e4]
- Updated dependencies [8366acc]
- Updated dependencies [95e58a3]
- Updated dependencies [9d7419b]
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [d0097af]
- Updated dependencies [432882b]
- Updated dependencies [64dae8e]
- Updated dependencies [b06e374]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [5ccc500]
- Updated dependencies [f3c2bb0]
- Updated dependencies [978507b]
- Updated dependencies [778138e]
- Updated dependencies [9801765]
- Updated dependencies [9cebfca]
- Updated dependencies [460575f]
- Updated dependencies [d796c8d]
- Updated dependencies [594704f]
- Updated dependencies [d3995fe]
- Updated dependencies [1b1d772]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [4172589]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [41b7ce3]
- Updated dependencies [ae476b8]
- Updated dependencies [39f4309]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [7cd3987]
- Updated dependencies [ee3b878]
- Updated dependencies [e304a4e]
- Updated dependencies [fda49e5]
- Updated dependencies [490d9a9]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [95f8704]
- Updated dependencies [f8cdbf2]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [e176053]
- Updated dependencies [e30ed15]
- Updated dependencies [90665e0]
- Updated dependencies [8d3a529]
- Updated dependencies [5ac2e2c]
- Updated dependencies [194fae1]
- Updated dependencies [7e19d03]
- Updated dependencies [b08b7eb]
- Updated dependencies [1e946c9]
- Updated dependencies [546ddf7]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [44d075b]
- Updated dependencies [40c479a]
- Updated dependencies [971d387]
- Updated dependencies [ee851c3]
- Updated dependencies [6414dfd]
- Updated dependencies [a8d5c71]
- Updated dependencies [905b21f]
- Updated dependencies [88e9109]
- Updated dependencies [2c45966]
- Updated dependencies [db3a600]
- Updated dependencies [3a3db76]
- Updated dependencies [0d723a3]
- Updated dependencies [0c95d3d]
- Updated dependencies [3e4fa2c]
- Updated dependencies [b5b928a]
- Updated dependencies [6fd2cf7]
- Updated dependencies [5fa06c4]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [129bcc5]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [06b82b8]
- Updated dependencies [8ec11e1]
- Updated dependencies [6f81384]
- Updated dependencies [22ba927]
- Updated dependencies [8631c32]
- Updated dependencies [f8c70f4]
- Updated dependencies [5d3a2d1]
- Updated dependencies [8f1d995]
- Updated dependencies [b362c1b]
- Updated dependencies [f9c34df]
- Updated dependencies [dddb942]
- Updated dependencies [00c665e]
- Updated dependencies [29754cf]
- Updated dependencies [d7de534]
- Updated dependencies [3c2b6f7]
- Updated dependencies [6e88630]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [5961030]
- Updated dependencies [f24de8b]
- Updated dependencies [c8ea8af]
- Updated dependencies [9602dc8]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [299102e]
- Updated dependencies [30c73cd]
- Updated dependencies [830ed58]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [c71e14d]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [748494b]
- Updated dependencies [5967be0]
- Updated dependencies [831be72]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [d0889e2]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [12402a9]
- Updated dependencies [aff3d7a]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [fff9645]
- Updated dependencies [9c3b7ce]
- Updated dependencies [2c1c967]
- Updated dependencies [9486ac6]
- Updated dependencies [9486ac6]
- Updated dependencies [4d5f9b4]
- Updated dependencies [d6ceb8d]
- Updated dependencies [dc4365c]
- Updated dependencies [e321d52]
- Updated dependencies [969ba84]
- Updated dependencies [98188c2]
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
- Updated dependencies [f46bd39]
- Updated dependencies [b98352a]
- Updated dependencies [b76ca67]
- Updated dependencies [45ac2cb]
- Updated dependencies [b97790a]
- Updated dependencies [dbd5194]
- Updated dependencies [7c9b044]
- Updated dependencies [e552c31]
- Updated dependencies [d47de51]
- Updated dependencies [3fe6463]
- Updated dependencies [b392674]
- Updated dependencies [4f3a1e2]
- Updated dependencies [31ab372]
- Updated dependencies [846889b]
- Updated dependencies [2acd8e1]
- Updated dependencies [7b90231]
- Updated dependencies [26896c6]
- Updated dependencies [67fc3b0]
- Updated dependencies [8579e34]
- Updated dependencies [d57db5d]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [c18d099]
- Updated dependencies [0caacca]
- Updated dependencies [adb2a86]
- Updated dependencies [03380aa]
- Updated dependencies [4562ea5]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [320374d]
- Updated dependencies [b0d308d]
- Updated dependencies [b458300]
- Updated dependencies [40f34b4]
- Updated dependencies [bd0376d]
- Updated dependencies [8063bcb]
- Updated dependencies [b74a859]
- Updated dependencies [d4493fd]
- Updated dependencies [240b80f]
- Updated dependencies [77cb489]
- Updated dependencies [bfaa158]
- Updated dependencies [777e5c6]
- Updated dependencies [0c386dd]
- Updated dependencies [39d69ad]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [f08bcd9]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [220c18d]
- Updated dependencies [00d3f09]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [3cab570]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [639114c]
- Updated dependencies [1490691]
- Updated dependencies [e8e4c4d]
- Updated dependencies [1f31d3a]
- Updated dependencies [d1842ab]
- Updated dependencies [78ca238]
- Updated dependencies [d8ec8d6]
- Updated dependencies [351eb31]
- Updated dependencies [866cd1d]
- Updated dependencies [20c04b2]
- Updated dependencies [01c9023]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [4b5bb95]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [8952395]
- Updated dependencies [e2b3826]
- Updated dependencies [0348bc9]
- Updated dependencies [e8c553b]
- Updated dependencies [2e32ed4]
- Updated dependencies [554e647]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [a4514e8]
- Updated dependencies [db3896c]
- Updated dependencies [b9f5ff1]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [4704aa4]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [554f2b6]
- Updated dependencies [72f55c9]
- Updated dependencies [26e06d7]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [3399704]
- Updated dependencies [71a4a53]
- Updated dependencies [7bf244b]
- Updated dependencies [f0bb9fa]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [caa0cd3]
- Updated dependencies [20cb8db]
- Updated dependencies [25c7d58]
- Updated dependencies [00d2fa6]
- Updated dependencies [77b2a18]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [c2f0f48]
- Updated dependencies [1237ae4]
- Updated dependencies [2f61238]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [9ae871d]
- Updated dependencies [efbd566]
- Updated dependencies [2a5bf45]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [daf9d57]
- Updated dependencies [23b9958]
- Updated dependencies [c15d7ec]
- Updated dependencies [5d0876c]
- Updated dependencies [f7ace0a]
- Updated dependencies [b041b9c]
- Updated dependencies [ce2aaef]
- Updated dependencies [544ecba]
- Updated dependencies [2ce2612]
- Updated dependencies [bc640ec]
- Updated dependencies [1e215c4]
- Updated dependencies [da6e191]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [aef97e5]
- Updated dependencies [2af1fa7]
- Updated dependencies [c14d3a0]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [c907a9c]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [91f9276]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [a915064]
- Updated dependencies [dcbf0b2]
- Updated dependencies [52cac38]
- Updated dependencies [93fea2e]
- Updated dependencies [1422a92]
- Updated dependencies [d05fe17]
- Updated dependencies [a480f79]
- Updated dependencies [f08d1a8]
- Updated dependencies [64a252d]
- Updated dependencies [786bc91]
- Updated dependencies [75fca96]
- Updated dependencies [7ca6ddd]
- Updated dependencies [f1cd290]
- Updated dependencies [5a41ce7]
- Updated dependencies [8d50bc2]
- Updated dependencies [604476d]
- Updated dependencies [d1bebb0]
- Updated dependencies [95bf128]
- Updated dependencies [335abea]
- Updated dependencies [edea22a]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [1cfdff8]
- Updated dependencies [e1c27e4]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [f52a9d7]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [6778809]
- Updated dependencies [3a3dd28]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [0758bd8]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [7ed9808]
- Updated dependencies [0ea7054]
- Updated dependencies [ac0e39a]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [a695f50]
- Updated dependencies [fc32921]
- Updated dependencies [4eaa835]
- Updated dependencies [8f9d87a]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [6e9a3d4]
- Updated dependencies [4a292d2]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [846cec0]
- Updated dependencies [91facae]
- Updated dependencies [b38014e]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [309728c]
- Updated dependencies [c03d03b]
- Updated dependencies [aa08d7e]
- Updated dependencies [3a43a15]
- Updated dependencies [868e825]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [639ca9d]
- Updated dependencies [2152962]
- Updated dependencies [abc1b18]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [512c84b]
- Updated dependencies [c300267]
- Updated dependencies [fb3a101]
- Updated dependencies [d4733f2]
- Updated dependencies [7c9145f]
- Updated dependencies [1570eac]
- Updated dependencies [f391ede]
- Updated dependencies [f5cfbbd]
- Updated dependencies [f5cfbbd]
- Updated dependencies [8b532cb]
- Updated dependencies [64c3cdd]
- Updated dependencies [4d65991]
- Updated dependencies [c42554e]
- Updated dependencies [3e71b26]
- Updated dependencies [b89583b]
- Updated dependencies [70c4523]
- Updated dependencies [555b4ec]
- Updated dependencies [64f1cf1]
- Updated dependencies [da5e4f6]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [0a174f3]
- Updated dependencies [676f677]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [88a629d]
- Updated dependencies [cdd2542]
- Updated dependencies [ab77513]
- Updated dependencies [55ba3ff]
- Updated dependencies [3ecc369]
- Updated dependencies [f1190b0]
- Updated dependencies [561abef]
- Updated dependencies [ef52001]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [0eaed83]
- Updated dependencies [e36acd4]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [152f0a7]
- Updated dependencies [8693b85]
- Updated dependencies [e82dad1]
- Updated dependencies [58b7b3d]
- Updated dependencies [84defab]
- Updated dependencies [681d3f1]
- Updated dependencies [969d4f2]
- Updated dependencies [f3bc481]
- Updated dependencies [b79aac2]
- Updated dependencies [93fc0e7]
- Updated dependencies [a4b723f]
- Updated dependencies [2b10ca0]
- Updated dependencies [7db4a81]
- Updated dependencies [19a0b0e]
- Updated dependencies [526fc11]
- Updated dependencies [f8e3e9a]
- Updated dependencies [b9d47ec]
- Updated dependencies [3b6bc69]
- Updated dependencies [6214db6]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [804831c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [689953a]
- Updated dependencies [30443fb]
- Updated dependencies [8d3dbb2]
- Updated dependencies [efc1c9c]
- Updated dependencies [da45e6b]
- Updated dependencies [7533465]
- Updated dependencies [835f0f3]
- Updated dependencies [6d5db7b]
- Updated dependencies [a9d97be]
- Updated dependencies [ed35b44]
- Updated dependencies [9ba7e9c]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [345e24a]
- Updated dependencies [20b507a]
- Updated dependencies [2e471dc]
- Updated dependencies [6748587]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [2bf34f7]
- Updated dependencies [15b33ae]
- Updated dependencies [7cbc724]
- Updated dependencies [4a94c38]
- Updated dependencies [7098eed]
- Updated dependencies [3df7c5c]
- Updated dependencies [fb91ac9]
- Updated dependencies [fb91ac9]
- Updated dependencies [641fb55]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [e05553c]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
- Updated dependencies [f0f2046]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [43c0d17]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [1779e8d]
- Updated dependencies [9aa2a57]
- Updated dependencies [f7fcc2c]
- Updated dependencies [f0f4d6c]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [2e97c8c]
- Updated dependencies [4a7ef0d]
- Updated dependencies [4598f6d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [44152c4]
- Updated dependencies [3939545]
- Updated dependencies [0ee6e31]
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [e22fa12]
- Updated dependencies [1560d46]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [741864f]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [4d7d322]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [ff0c384]
- Updated dependencies [af4fb29]
- Updated dependencies [c698a81]
- Updated dependencies [ff5ef1c]
- Updated dependencies [befd40c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [3c76801]
- Updated dependencies [60500cb]
- Updated dependencies [2fcefb9]
- Updated dependencies [77f846a]
- Updated dependencies [bc5870c]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [f760064]
- Updated dependencies [dd19463]
- Updated dependencies [6791717]
- Updated dependencies [8ea3bee]
- Updated dependencies [100547e]
- Updated dependencies [3a58149]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [2c8474c]
- Updated dependencies [6ce89da]
- Updated dependencies [0e05aac]
- Updated dependencies [ae61ad4]
- Updated dependencies [5aed9e4]
- Updated dependencies [83c77dc]
- Updated dependencies [3c9fca3]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [e719ebd]
- Updated dependencies [516583b]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [58be55e]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [fe76ece]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [7102b20]
- Updated dependencies [8ebd57f]
- Updated dependencies [968dc1e]
- Updated dependencies [9a1fb41]
- Updated dependencies [617707a]
- Updated dependencies [c40f3b8]
- Updated dependencies [58770f3]
- Updated dependencies [aefe428]
- Updated dependencies [485f096]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [b655a9d]
- Updated dependencies [a865c73]
- Updated dependencies [3e01cb5]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [6a576c9]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [fffa30d]
- Updated dependencies [e4e9557]
- Updated dependencies [7a28e1e]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
- Updated dependencies [4dc80d0]
- Updated dependencies [9d9040d]
- Updated dependencies [20e317c]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [9850c6e]
- Updated dependencies [de570cc]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [19cbf10]
- Updated dependencies [b6e83be]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [1e66879]
- Updated dependencies [c5200f0]
- Updated dependencies [af3861f]
- Updated dependencies [2609812]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [4f14ad7]
- Updated dependencies [258d264]
- Updated dependencies [cac64b3]
- Updated dependencies [4bb940b]
- Updated dependencies [8033ad1]
- Updated dependencies [fa140b8]
- Updated dependencies [71cba28]
- Updated dependencies [190fbd0]
- Updated dependencies [c00bf28]
- Updated dependencies [93127bd]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [fd8dace]
- Updated dependencies [72ffc34]
- Updated dependencies [a51fa0c]
- Updated dependencies [51f3d8d]
- Updated dependencies [bf28341]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [6c6cee7]
- Updated dependencies [42887e0]
- Updated dependencies [f1690d4]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [38a9568]
- Updated dependencies [f90b8fb]
- Updated dependencies [91783c4]
- Updated dependencies [982885d]
- Updated dependencies [dba7d84]
- Updated dependencies [ca39427]
- Updated dependencies [bd09957]
- Updated dependencies [5a07e67]
- Updated dependencies [2d36552]
- Updated dependencies [45d8288]
- Updated dependencies [b2437a7]
- Updated dependencies [f157423]
- Updated dependencies [7a90afd]
- Updated dependencies [eddc1dd]
- Updated dependencies [490f482]
- Updated dependencies [27308c5]
- Updated dependencies [8689166]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [9101be5]
- Updated dependencies [f53a8d0]
- Updated dependencies [30266cf]
- Updated dependencies [968dc1e]
- Updated dependencies [57f9b07]
- Updated dependencies [3c73d99]
- Updated dependencies [d91aed9]
- Updated dependencies [ed71d9e]
- Updated dependencies [7776fc2]
- Updated dependencies [e76634c]
- Updated dependencies [c86185e]
- Updated dependencies [fb96ecb]
- Updated dependencies [1170ed1]
- Updated dependencies [92814db]
- Updated dependencies [4d73b07]
  - @object-ui/react@17.7.0
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/i18n@17.7.0
  - @object-ui/components@17.7.0
  - @object-ui/fields@17.7.0
  - @object-ui/mobile@17.7.0
  - @object-ui/permissions@17.7.0

## 17.6.0

### Minor Changes

- 0a73b51: `ObjectView` and `ListView` now flatten a view's `map` block through a
  whitelist instead of spreading the whole (untyped) block to the top level.
  
  Both `case 'map'` flatteners used to build the `object-map` schema with
  `...(options.map || {})` — a raw spread of an untyped bag
  (`NamedListView.options?: Record<string, any>`), so any key an author wrote in
  the `map` block reached the top level unfiltered. `ObjectMap`'s own
  `FlatMapConfigKeys = Omit<ObjectMapConfig, 'style'>` declares `style` OUT of
  this flat form (`style` is also `BaseSchema.style`, inline CSS legal on every
  node), so the two disagreed about the same shape. `style` was the live
  specimen: `map: { style: '<url>' }` reached the top level as a CSS-shaped
  `style` key it was never supposed to carry.
  
  Behavior narrowing, stated because it changes what reaches the flattened
  schema: a `map` block key that is not one of `ObjectMapConfig`'s declared
  flat keys (`latitudeField` / `longitudeField` / `locationField` / `titleField`
  / `descriptionField` / `zoom` / `center`) — including `style` — no longer
  reaches the top level of the flattened `object-map` schema. This closes a gap
  rather than removing working behavior: the pinned strict spec view schemas
  accept no `map` block at all today, so no author-facing surface could reach
  this path, and `ObjectMap` already stopped reading a top-level `style` as a
  map style (a dev warning names the correct spelling instead).
  
  The whitelist is DERIVED from `ObjectMapConfigSchema` (`@object-ui/types/zod`)
  rather than hand-listed, so the flatteners and the declaration cannot drift
  apart again — a key added to (or removed from) the schema reaches both
  flatteners without a second edit. `ObjectMap`'s own `FLAT_MAP_CONFIG_KEYS` is
  derived from the same schema for the same reason.
- f1d4748: Remove the retired `striped` / `bordered` / `virtualScroll` list-view surface
  
  objectstack#7176 retired `list.striped`, `list.bordered` and `list.virtualScroll`
  from the spec after measuring every objectui reader as pass-through: each one
  copied the key onward and no renderer ever applied it. objectui stops declaring,
  typing and forwarding them.
  
  Off the chain: the `@objectstack/spec` list-view bridge in `@object-ui/react`,
  `ListView`'s child-view props in `@object-ui/plugin-list`, both `ObjectView`
  relays (`@object-ui/plugin-view` and `@object-ui/app-shell`), the `ObjectGridSchema`
  and `NamedListView` declarations in `@object-ui/types` (interface and zod),
  `ObjectGrid.component.yml` in `@object-ui/components`, and the page-block
  inspector's `striped` / `bordered` toggles in the metadata-admin designer.
  
  Behaviour is unchanged: nothing read these keys, so nothing rendered differently
  for them. Stored view metadata that still carries one keeps validating — the keys
  are simply no longer relayed. `ListViewSchema` continues to take the spec's
  list-view fields by reference, so the protocol's own retirement tombstones
  arrive with the next `@objectstack/spec` bump and reject the keys at the
  authoring boundary. Restoring any of the three as live surface requires an
  implementation card filed first, per the ruling.
- b1119ec: Project every declared `recordIdField`, and refuse an action that names no record
  
  objectstack#8018. An `api` action declaring `recordIdParam` identifies the record
  it acts on by a row field — `recordIdField`, default `id`. The grid built
  `$select` from the listView columns, `id` and the predicate refs only, so an
  action keyed on any other field asked the server for everything except the key
  naming its own record. The row arrived without it, and the injection was skipped
  silently: the request went out anyway, minus the parameter. A backend reading a
  missing selector as "match nothing" then answers success for having changed
  nothing, so a record-scoped mutation reports success and does nothing.
  
  Two independent repairs, both in this change:
  
  - **Projection.** `listViewPredicates` (`@object-ui/core`) now also harvests
    `recordIdField` from `rowActionDefs`, `bulkActionDefs` and the object's
    `actions`, spelled as a synthetic `record.<name>` so the one existing harvester
    handles it. Both projection builders — `ObjectGrid` and `ListView` — read that
    function, so both gain the key with no call-site change. The existing guards
    still apply: a name the object does not declare, or one that is not a bare
    identifier, is dropped rather than put in `$select`, because an unknown key
    there is not ignored by every backend.
  - **Loud failure.** New `resolveRecordIdParamSeed` (`@object-ui/core`) is the one
    definition of "can this row identify the record?". `useConsoleActionRuntime`'s
    api handler now refuses the dispatch — `{ success: false, error }`, before the
    request — when the row lacks the key, or holds `null` for it. The two refusals
    are worded differently because they point at different repairs: an absent key
    is a projection or read-visibility problem, a null value is a data one. Falsy
    real values (`0`, `''`, `false`) are values and still dispatch.
  
  The second half is what closes the class rather than the common case: a row can
  lack the key for reasons projection cannot fix — a server-side read mask that
  strips the field regardless of `$select`, a partial payload, a field the
  principal cannot read.
  
  Behaviour change worth noting: an action that previously dispatched an
  under-specified request now fails visibly instead. That is the point — the old
  path could not report the failure it was causing.

### Patch Changes

- 516663d: RecordAttachmentsPanel no longer offers a Retry for an api-disabled `sys_attachment` read.
  
  `OBJECT_API_DISABLED` (404, `enable.apiEnabled: false`) and its sibling
  `OBJECT_API_METHOD_NOT_ALLOWED` (405, the operation is absent from
  `enable.apiMethods`) are pure functions of the object's metadata — no user, no
  session, no request body — so every retry of every persona re-fetches the
  identical refusal. Before this change both landed in `RecordAttachmentsPanel`'s
  `unavailable` state and offered a Retry that was guaranteed to change nothing,
  the same wrong advice `ListView`'s error panel already stops giving for list
  reads.
  
  The panel gains a fifth status, `api-unavailable`: no Retry button, and honest
  copy ("The attachments list is not available on this object.", new
  `detail.attachmentsApiUnavailable` key in all ten locale packs) instead of
  "We couldn't load the attachments for this record." The pre-existing `denied`
  (authorization) and `unavailable` (network/5xx/expired-session) states and
  their affordances are unchanged.
  
  `ListView.classifyLoadError` — the classifier that already separated this case
  into its own `api-disabled` kind for list views — is lifted out of
  `packages/plugin-list/src/ListView.tsx`'s module scope into
  `@object-ui/react` (`classifyLoadError`, `LoadErrorKind`), so both surfaces
  consume one classification instead of `RecordAttachmentsPanel` re-deriving it.
  `ListView`'s own behavior is unchanged — it now imports the function it
  previously defined locally. The classifier delegates its api-disabled check to
  `isApiAccessDeniedError` (`@object-ui/data-objectstack`), removing a second,
  independently-maintained copy of the same code list.
- a1609a6: Console list filters: a `between` range is submitted only when both bounds are filled, and six operator labels stop rendering as raw i18n keys.
  
  Two defects in the list-view filter panel (objectstack#8815), both in the Console
  render layer, with no workaround available downstream.
  
  **A half-filled range no longer refuses the whole view.** Picking a date column
  and 「介于」 draws two inputs — that part landed in objectui#3958 — but typing
  only one bound produced `["2024-01-01", ""]`, and both write paths read "is this
  row filled in?" with one shape-blind predicate (`null` / `''` / empty array).
  An array of length 2 passed it, so the empty bound went to the server, which
  refuses the query outright (`400 INVALID_FILTER`): the list showed
  「该视图的查询被拒绝」 and the filters the user had already applied stopped
  applying too. The saved-view fold persisted the same half-range, so the refusal
  came back on every later read of that view, for every user of it.
  
  The spec cannot intercept this — `ViewFilterRuleSchema` accepts
  `["2024-01-01", ""]` because it counts the two slots rather than what is in
  them, while refusing a scalar or a one-element array. Authoring validation is
  therefore green on exactly the shape that fails at query time, which makes not
  emitting it the producer's job. `@object-ui/components` now exports
  `isFilterValueComplete(operator, value)` — arity-aware, so a `pair` row needs
  both bounds — and the two consumers that had each kept a copy of the old
  predicate (`plugin-list`'s `convertFilterGroupToAST`, `app-shell`'s
  `foldFilterGroupToSpecRules`) read it instead. A half-filled range is now
  dropped exactly as a half-typed `equals` row already was: no filter, rather than
  a filter the server will reject. Bounds of `0` and `false` stay real bounds.
  
  **Six operator labels are translated in all ten locale packs.**
  `startsWith`, `endsWith`, `isNull`, `isNotNull`, `exists` and `notExists` were
  missing from every pack, so i18next resolved them to the raw key and the dropdown
  showed `filterBuilder.operators.isNull` beside translated entries. The
  component's own defaults table could not cover it: that table serves only the
  no-provider path, and the Console mounts a provider. The report named four —
  a `date` column's bucket offers the four nullness operators; a `text` column
  showed all six.
  
  Because the label key is built dynamically (`t(\`filterBuilder.operators.${op}\`)`),
  no existing gate could see the gap: the call-site checker classifies a template
  key as `missing-prefix` and only asks whether the prefix resolves, and
  cross-pack parity is satisfied when all ten packs are missing a key together.
  A new parity test pins the packs against `FILTER_BUILDER_OPERATORS` in both
  directions, so an operator added to the dropdown now fails loudly until every
  pack labels it.
- c1ef923: Grid and related-list column headers no longer offer a sort on a `formula` column.
  
  A `formula` value is computed on read: no driver materialises a column for it, so
  a server `$orderby` naming one has nothing to order by. That sort never worked.
  Until objectstack#6994 the platform did not say so — the response carried the very
  values it had been asked to order by, out of order, under a `200`, with ascending
  and descending byte-identical on a real SQL driver — and it now answers
  `400 INVALID_SORT`. So the header was wrong before the platform's refusal and is
  wrong after it, for the same reason: it offers a sort that cannot be performed.
  
  `ObjectGrid` withheld the affordance only from reference-bearing columns
  (objectui#3096). Unmaterialized types are a SECOND reason a server sort is
  impossible, not a different mechanism, so it now reads both — and so do the two
  sort entry points of a related list (the embedded table's headers and the
  sort-button row a `data-list` card keeps), which each derived that rule
  separately.
  
  Client-side sorting is deliberately unchanged. There the rows are all in the
  browser and the formula value is the one the server hydrated on read, so ordering
  by what the cell shows is honest — the same split the relational carve-out makes.
  A sort DECLARED in view metadata is also unchanged: it still goes out and is still
  refused by name, because silently dropping an author's declaration would hide the
  authoring error instead of surfacing it (the toolbar's sort picker keeps such a
  field listed for exactly that reason — it is the only way to remove it).
  
  The membership — `formula` alone — moved out of a private set in `ListView` into
  `@object-ui/core` (`UNMATERIALIZED_FIELD_TYPES` / `isUnmaterializedFieldType`),
  bound to `@objectstack/spec`'s own storage predicate so the renderer cannot drift
  from what the drivers actually store. It is deliberately narrower than the spec's
  write contract `COMPUTED_VALUE_TYPES`: a `summary` and an `autonumber` each get a
  real maintained column and sort correctly, and withholding their headers would
  have broken two affordances that work.
- 616a2a5: The list filter builder no longer offers `Is set` / `Is not set`, which its query dialects cannot express.
  
  **User-visible before/after.** The operator dropdown in the list toolbar's
  filter popover — and in the Studio view/tab/page filter inspectors, the dataset
  inspector and the generic `filter` config field — loses two rows: **"Is set"**
  and **"Is not set"**. The sharing-rule criteria builder (`FilterConditionField`)
  keeps both, unchanged. `Is null` / `Is not null` and `Is empty` / `Is not empty`
  are untouched everywhere and remain the way to filter on a missing value from
  the list.
  
  Nothing that worked stops working. Every save path behind those two rows was
  already broken, in three different ways depending on the surface:
  
  - **Live grid** — `ListView.mapOperator` had no row for either id, so its
    `default:` arm returned the id verbatim and the query went out as
    `['name', 'exists', 'x']`. `exists` is not a member of the spec's
    `VALID_AST_OPERATORS`, so `isFilterAST()` rejects the shape: an unfiltered
    read or a 400, never the filter the user asked for.
  - **Save as view** — `foldFilterGroupToSpecRules` normalizes through the spec's
    `normalizeFilterOperator`, which does not know the pair, and
    `ViewFilterRuleSchema`'s enum then refuses the rule.
  - **Dataset inspector** — `groupToCondition` has no row either and drops the
    condition silently, so the filter simply never applied.
  
  **Why withheld rather than mapped.** Measured on `@objectstack/spec`
  17.0.0-rc.6: neither `VIEW_FILTER_OPERATORS` nor `VALID_AST_OPERATORS` contains
  an existence operator, under any spelling — both sets have zero members matching
  `/exist/`. Only the MongoDB-style `FieldOperatorsSchema` criteria carries
  `$exists`, and that is precisely the dialect `FilterConditionField` writes, so
  the pair moves behind the existing `OPT_IN_OPERATORS` gate and that widget opts
  in. Collapsing them onto `isNotNull` / `isNull` was rejected: the builder
  already draws those as their own rows, the round trip is lossy (a saved
  `exists` reads back as `isNotNull`), and the spec's own note records `$exists` =
  has-value as still unsettled across drivers — `driver-memory`'s live mingo path
  and `driver-mongodb` read key-presence.
  
  **The class is now closed by an assertion, not by discipline.** objectui's three
  existing operator-parity guards all sweep spec vocabulary → objectui; none asked
  whether an id the dropdown draws is an id the consumer can persist, which is the
  direction that broke. `plugin-list`'s new
  `list-offered-operator-expressible-parity.test.ts` forces the set the list
  toolbar offers to **equal** the set its two dialects can express, in both
  directions — so an unexpressible operator cannot be offered, and an operator
  that becomes expressible upstream cannot stay needlessly withheld.
- dfc6975: Related-list "+ New" now honours `userActions.create` predicates, and the grid
  toolbar's inline-edit affordance is gated on `update` permission (objectui#4646,
  objectui#4647).
  
  Two declared-but-unenforced gaps on the same toolbar surface.
  
  **#4646 — `createPredicates` had a producer and no consumer.**
  `@objectstack/spec@17.0.0` widened `userActions.create` to
  `z.union([z.boolean(), RowCrudActionOverrideSchema])`, so `resolveCrudAffordances`
  emits `createPredicates` — and nothing in objectui read them, against roughly
  fifteen consumption sites apiece for `editPredicates` / `deletePredicates`. The
  symptom: a parent record entering a frozen state correctly greyed its children's
  row Edit/Delete while the related list's "+ New" stayed fully live, so the user
  filled in the whole child form to earn a server 409. The related-list toolbar now
  evaluates `visibleWhen` / `disabledWhen` **once against the host parent record**,
  per the spec docblock's binding for this key, on top of the existing
  `o.create ∧ can(child, 'create')` check. `visibleWhen` hides "+ New" and fails
  CLOSED; `disabledWhen` greys it and fails SOFT — the same evaluator, fail
  directions and hidden-vs-disabled split the record header already uses for
  edit/delete (objectui#4419 / PR #4515). A bare-boolean `userActions.create` is
  untouched: with no predicates there is nothing to evaluate.
  
  **#4647 — the inline-edit toggle was the one ungated affordance on its toolbar.**
  It rendered on "grid view ∧ the host wired `onInlineEditChange` ∧ not the compact
  toolbar", and every host wires that callback unconditionally. New and Import are
  hidden for an account without the grant and the bulk-delete entry on the same
  toolbar ANDs `can(obj, 'delete')`, but a read-only principal could flip inline
  edit, modify cells and press "Save all" to earn a server 403. It is now gated on
  the object's resolved edit affordance ∧ `can(object, 'update')`, mirroring that
  bulk-delete gate. The gate is applied at all three sites that carry this
  affordance — the wide toolbar's toggle, the compact toolbar's settings-popover
  entry (which previously had no gate at all, not even the callback), and the
  `editable` mode handed to the grid, so a stored view carrying `inlineEdit: true`
  can no longer drop a read-only principal into editable cells with no toggle to
  press.
  
  `ListViewSchema.userActions.editInline` is also consumed now: an explicit `false`
  withholds the affordance wholesale, which authors previously could not do.
  
  **Behaviour change for read-only users, stated plainly.** Where the UI used to
  offer inline editing and let the server refuse it, it now declines to offer the
  entry point at all. No data access changes — the server gate was and remains the
  enforcement boundary; this only stops the UI walking users into round-trips
  guaranteed to fail. Accounts *with* the grant see no change, and hosts with no
  `PermissionProvider` mounted (standalone embeds, the Studio designer) keep
  today's behaviour, since `can()` answers `true` there by design.
  
  One deliberate non-change: the absent case of `userActions.editInline` defers to
  the host's existing `inlineEdit` channel rather than enforcing the spec's
  `.default(false)`. Enforcing that default would remove the toggle from every
  stored console list view in one release, since nothing folds a legacy key into
  `editInline` and no existing view declares it. This follows the rule the
  surrounding toolbar-flag block already states for itself — defaults chosen to
  match what the flags have always done. `InterfaceListPage`, the key's other
  consumer, reads the absent case as OFF, because the ADR-0047 interface page has
  no such host channel to defer to.
- 138ab04: Fix a list filter that silently applied nothing when the first thing you picked was **Is null** or **Is not null**.
  
  Adding a filter seeds the row with no value, and changing the operator keeps it that way — which is correct for an operator that takes no value, since the panel draws no input for one. The live grid read that row as unfinished and dropped it: the filter appeared in the panel, the query went out without it, and every record came back with no error to explain it. Only `Is empty` / `Is not empty` were exempt; the builder renders six operators value-less.
  
  Which operators are complete without a value now has a single owner — `VALUELESS_FILTER_BUILDER_OPERATORS`, exported from `@object-ui/components` beside the code that decides it. The live grid and the saved-view fold both read it instead of keeping their own lists, so the two halves of one interaction can no longer disagree about whether a row is finished.
- Updated dependencies [88085e3]
- Updated dependencies [69251bf]
- Updated dependencies [57e668f]
- Updated dependencies [516663d]
- Updated dependencies [41ac1b7]
- Updated dependencies [1eaf0a1]
- Updated dependencies [a09bc33]
- Updated dependencies [460c4d0]
- Updated dependencies [0ae27f7]
- Updated dependencies [2533ec5]
- Updated dependencies [78c0f9a]
- Updated dependencies [bbe8b86]
- Updated dependencies [8477be5]
- Updated dependencies [279fb13]
- Updated dependencies [2e82ab2]
- Updated dependencies [ad07b65]
- Updated dependencies [41f498b]
- Updated dependencies [ef0d150]
- Updated dependencies [f34226e]
- Updated dependencies [564b605]
- Updated dependencies [e1d4251]
- Updated dependencies [40d3a33]
- Updated dependencies [8b9dc62]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [65e88e6]
- Updated dependencies [a1609a6]
- Updated dependencies [53f23bc]
- Updated dependencies [c4533dc]
- Updated dependencies [be60815]
- Updated dependencies [37f6844]
- Updated dependencies [93de4f6]
- Updated dependencies [2b50261]
- Updated dependencies [384f30d]
- Updated dependencies [ac600e5]
- Updated dependencies [97fba31]
- Updated dependencies [232f61a]
- Updated dependencies [d374caf]
- Updated dependencies [5673576]
- Updated dependencies [c1ef923]
- Updated dependencies [911ceaa]
- Updated dependencies [98eab36]
- Updated dependencies [af5e292]
- Updated dependencies [3fbbea1]
- Updated dependencies [0bffb18]
- Updated dependencies [800f455]
- Updated dependencies [5458414]
- Updated dependencies [3241559]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [616a2a5]
- Updated dependencies [6c68b13]
- Updated dependencies [0046d8f]
- Updated dependencies [f1d4748]
- Updated dependencies [bea374e]
- Updated dependencies [b1119ec]
- Updated dependencies [5607092]
- Updated dependencies [9f23d2b]
- Updated dependencies [578e025]
- Updated dependencies [af025ee]
- Updated dependencies [d109a4d]
- Updated dependencies [598c89a]
- Updated dependencies [4a0bd17]
- Updated dependencies [b8b9af4]
- Updated dependencies [d8b9259]
- Updated dependencies [31676be]
- Updated dependencies [8c0d52e]
- Updated dependencies [aff10e2]
- Updated dependencies [70a774b]
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [7458a41]
- Updated dependencies [ad13d63]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [9c60144]
- Updated dependencies [e7747f1]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [ac2f332]
- Updated dependencies [a777058]
- Updated dependencies [75444e3]
- Updated dependencies [58b8346]
- Updated dependencies [2d0bd16]
- Updated dependencies [a9e17b4]
- Updated dependencies [b8ce7dc]
- Updated dependencies [dad51e5]
- Updated dependencies [1c9c342]
- Updated dependencies [787c738]
- Updated dependencies [8396656]
- Updated dependencies [dbbd38a]
- Updated dependencies [61556dc]
- Updated dependencies [8871c14]
- Updated dependencies [93fe362]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [144ef9b]
- Updated dependencies [138ab04]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
- Updated dependencies [21e4585]
  - @object-ui/types@17.6.0
  - @object-ui/fields@17.6.0
  - @object-ui/i18n@17.6.0
  - @object-ui/react@17.6.0
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0
  - @object-ui/permissions@17.6.0
  - @object-ui/mobile@17.6.0

## 17.5.0

### Minor Changes

- 7084f7d: `DashboardRenderer` and `ListView` serve the props they declare — the index signature stops erasing them

  Both components declared a full props interface and neither was enforced. A `[key: string]: any` on `DashboardRendererProps` and `ListViewProps` puts `string` into `keyof Props`, so `'ref' extends keyof Props` is always true and React's `PropsWithoutRef` takes its `Omit` branch — and `Omit` over a type carrying a string index signature keeps only the index signature. Every declared property was dropped from the resolved type, on both sides: the render function received `{ [x: string]: any }` (so even `schema` was `any` inside the component), and every JSX call site was unchecked. Measured on the pre-fix source, `keyof ComponentProps<typeof DashboardRenderer>` was `string | number` and `ComponentProps<typeof DashboardRenderer>['onWidgetClick']` was `any`, while the interface went on declaring `(widgetId: string | null) => void`. `ListView` measured identically for `onRowClick`. This is objectui#4422 / PR #4438's trap in the two packages that issue left unswept.

  Graded **minor, not major**: the interfaces have always DECLARED these props; the index signature erased them from the resolved type. Restoring what the interface documents is a FIX to the published contract, not a contract break — no documented capability is removed, and `any`-typed accidental passthrough was never the documented surface. Nothing in either package's README or docs endorses relying on it.

  The props each component genuinely reads but never declared are now declared by name, at the type each one lands on: `dataSource` on both, plus `onAddRecord` / `onBulkAction` / `onPageSizeChange` / `onEdit` / `onDelete` / `onBulkDelete` on `ListView`. `DashboardRenderer`'s DOM pass-through keys are derived from `toDomProps`' whitelist constant itself, so the declaration and the runtime filter cannot drift — the "declare it and forward it by name" direction `@object-ui/core`'s `dom-props` doctrine asks for, rather than reopening the spread.

  Type-only: the emitted JS for both packages is byte-identical before and after (verified by sha256 on `dist/index.js` and `dist/index.umd.cjs`), and both packages' runtime suites are untouched and green.

  Three latent defects the erasure had been hiding are fixed with it, each surfaced by the repo-wide type-check: `DashboardWithConfig` typed its widget-select handler `(widgetId: string)` while `DashboardRenderer` calls `onWidgetClick(null)` to deselect; `InterfaceListPage` built a list schema whose `viewType` was a bare `string`; and `StudioDesignSurface` forwarded a `refreshKey` prop that no component in the chain declares or reads, so it was silently dropped. Per-package structural guards now pin the shape in both packages, covering the public `forwardRef` that takes its props whole — the spelling objectui#4438's `schema`-destructuring scan could not see.

- fe52a04: `rowHeightToDensityMode` answers only for the five spec row heights — the coerce-to-`comfortable` fallback is gone

  Two surfaces narrow a list view's `rowHeight` onto the renderer's three-step
  density vocabulary, and since objectui#4352 they answered differently for the
  same off-spec input: `@object-ui/react`'s spec bridge declined to answer, while
  `@object-ui/core`'s `rowHeightToDensityMode` rehabilitated anything unknown into
  `comfortable`. One metadata-driven system, two answers for one input
  (objectui#4440).

  The strict answer wins, per AGENTS.md #0.1: a renderer-side rehabilitation of
  off-spec metadata is a second de-facto contract, and one strict contract beats N
  dialects — a bad `rowHeight` gets fixed at the producer, where the schema already
  rejects it. The five mappings themselves are untouched (`compact`/`short` →
  `compact`, `medium` → `comfortable`, `tall`/`extra_tall` → `spacious`), and the
  table keeps its `Record< RowHeight, … >` typing, so a row height added upstream
  still fails the build here.

  **Breaking semantics, deliberately graded `minor`** (this repo never publishes
  `major` — its major tracks `@objectstack`). Two things change:

  - **Published type.** `rowHeightToDensityMode` is exported from
    `@object-ui/core`, and its return widens from `DensityMode` to
    `DensityMode | undefined`. A host assigning the result straight into a
    `DensityMode` now has to say what an off-spec row height should mean to it.
  - **Rendered output, for input the spec already rejects.** `ListView` — the one
    in-repo caller — used to render an off-spec `rowHeight` one step looser than an
    ABSENT one (`comfortable`, 40px rows, vs `compact`, 32px). It now renders it
    exactly like an absent one, `compact`, which is also `ObjectGrid`'s own default.
    A sweep of this repo, the `objectstack` example apps and one downstream app
    found zero authored off-spec values, and the legacy `densityMode` alias cannot
    produce one (`DENSITY_MODE_TO_ROW_HEIGHT` is typed
    `Record< DensityMode, RowHeight >`).

  Also closed while retiring the branch: the lookup guarded membership with `in`,
  which walks the prototype chain, so `rowHeight: 'toString'` returned
  `Object.prototype.toString` — a function — from something typed `DensityMode`. It
  is an own-property check now.

### Patch Changes

- ae10a01: Console chrome reaches the bundle — the list switcher, the aggregate footer, the dialog a11y fallbacks and the whole Settings namespace screen stop being English on non-English consoles

  Six strings on the two screens a user looks at most were hardcoded English literals rather than bundle lookups, so they stayed English on every non-English console with nothing an app could author to change them. They are not object, field, view or action labels — no key in `TranslationData` reaches them — while the console's own bundle already ships zh-CN, ja-JP, es-ES, de, fr, pt, ru, ko and ar and translates hundreds of neighbouring strings. Omissions from an otherwise complete bundle, not a missing capability.

  **Two of the six needed no new keys at all, which is the more interesting half.** The list-view mode switcher named its nine visualizations from a private `VIEW_LABELS` table while `console.objectView.viewType*` — the same nine words — had been resolved through the bundle by the create-view picker for months; the switcher now reads those keys, so the picker's 「画廊」 and the switcher's 「画廊」 cannot drift apart in nine languages. The create/edit dialog's close button is the remainder of a fix that already landed: objectstack#5505 routed the `sr-only` close label through `common.close` for the two Shadcn-synced primitives, but `MobileDialogContent` is a hand-written wrapper outside that regeneration zone with its own close button, and it is exactly what `ModalForm` renders — so the dialog the report measured was the one place still announcing "Close" in English.

  The aggregate footer is the one the original report singled out: the **number** was already locale-formatted and the **prefix** was a hardcoded `Avg: ` / `Sum: `. All eleven aggregation kinds now take their prefix from `grid.summary.*`, and the label/value join is its own key rather than a `': '` baked into the renderer — the separator is translatable content, so zh sets a fullwidth colon and fr the French space-before-colon. The numbers are untouched. The form dialog's `sr-only` description fallback joins the packs too; it is clipped, not visible, so the only way an app could displace it was to author a `description` and thereby put a visible subtitle on every dialog.

  **The Settings namespace screen converts as one unit.** `SettingsView` routed zero framing copy through i18n — save/failure toasts, the env-lock and crypto refusals, the load-error card, the empty-route state, the navigation buttons, the unsaved-changes save bar — while its immediate sibling `SettingsHub`, in the same directory, resolved everything through `t('console.settingsHub.*')`. A zh-CN admin read correctly translated field labels sitting inside an English save bar, because `useSettingsLabel` translates a namespace's authored content but reaches none of the chrome around it. All of it now resolves through a `console.settingsView.*` namespace placed beside the hub's, including the crypto-refusal strings that objectui#4579 deliberately left in English rather than leave one translated string among a dozen literals.

  The save-bar counter was an English plural rule executing in every locale (`change` plus an `s` when the count exceeds one). It is now a real i18next plural family — base key plus `_one` and `_other` in all ten packs — not the `(s)` spelling translated nine ways. The base key is the load-bearing part: i18next asks `Intl.PluralRules` for the one suffix a language needs and, finding no such slot, falls back to English, so without it Russian would read English at counts 2-20 and Arabic at 2-99. Russian and Arabic take the "noun: {count}" form their packs already use for this exact reason, and the counter is verified rendering in-language at 1, 2 and 5.

  The Beta badge reuses the hub's existing key rather than minting a twin, and the refusal messages interpolate their subject through the bundle instead of concatenating a translated word onto an English prefix.

- bb58d1d: i18n: the two search placeholders become pack values, and four values the packs served in English get translated

  **objectui#4375** — `ListView` and `LookupField` built their search placeholder as
  `t(key) + '...'`, so the ellipsis was a literal concatenated in code: it stayed ASCII
  in all ten locales on screens where objectui#3878 had converged everything else on
  U+2026, and no pack could opt out of it (sharpest in `ar`, where a left-to-right run
  was appended to right-to-left text). Both now read `table.search`, which is already
  the repo's search-input placeholder key — `data-table`, `RecordPickerDialog` and
  `PeoplePicker` render it too — and is translated with the right ellipsis in all ten
  packs. No new keys.

  **objectui#4376** — `list.loading` served the English `Loading records…` in eight of
  the nine translation packs (`zh` alone had translated it); `designer.undo` and
  `designer.redo` were English in all nine; `appDesigner.snakeCaseHint` in `ko`, `pt`,
  `ru` and `ar`. All translated, reusing each pack's own established vocabulary. A new
  pin (`untranslated-identity-4376.test.ts`) fails on any value byte-identical to `en`
  inside a non-Latin pack unless the key is on an explicit 22-entry allowlist.

- bb68488: An inline per-locale label now renders its locale's string at the thirteen read sites the `@objectstack/spec` 17.0.0-rc.6 bump exposed

  rc.6 widened `I18nLabel` from `string` to `string | Record<string, string>`, so an author may write `label: { en: 'Owner', 'zh-CN': '负责人' }` anywhere the spec accepts a display label. PR #4169 repaired eight such sites; these thirteen were invisible to it because the five packages involved build through vite/rolldown, so `turbo run build` never type-checks their sources — only `turbo run type-check` does. All thirteen are now resolved through a shared resolver against a real locale, and `turbo run type-check` is 78/78 with zero errors.

  | package                       | what an author can now write and see                                                    |
  | ----------------------------- | --------------------------------------------------------------------------------------- |
  | `@object-ui/layout`           | `NavigationArea.label` — the sidebar area switcher's button and its tooltip             |
  | `@object-ui/plugin-list`      | `ViewTab.label` — the inline pill row, and the mobile dropdown's trigger and menu items |
  | `@object-ui/plugin-dashboard` | `DashboardWidget.title` — the widget card heading and its `title` attribute             |
  | `@object-ui/plugin-designer`  | `DashboardWidget.title` — the widget card and the preview tile                          |
  | `@object-ui/app-shell`        | `ActionParam.label` **and** each `ActionParam.options[].label`                          |

  **Patch, not minor, in every case: no public surface changes meaning.** Every entry above is a read site that previously could only be reached with a value the type system rejected, so no caller's working code changes behaviour. `@object-ui/app-shell` is the only package with an exported-type change and it is purely additive on the authoring side — `RawActionParam.label` and `RawActionParam.options[].label` widen to `I18nLabel` (they accept strictly more), `ResolveActionParamsContext` gains an optional `locale`, and the new `RawActionParamOption` names the authoring shape that was previously spelled with the resolved one. What `resolveActionParams` **emits** is unchanged: `ActionParamDef.label` and its options' labels are still plain `string`s.

  Two consequences worth knowing:

  - **The dashboard designer's title input is deliberately read-only for a map-valued title.** Resolving a per-locale map into a single-line input and writing `e.target.value` back would collapse every other locale on the first keystroke, so the write is guarded and an inline map survives an unrelated edit-and-save round trip untouched — the same conservative branch #4169 took for `DashboardWidgetInspector`. What Studio should actually offer for authoring a per-locale label is objectui#4163 part 2, which is unclaimed and pending design.
  - **`@object-ui/layout` resolves at the spec's `en` default, not the viewer's language.** That package carries no i18n dependency by design (its whole i18n story is injection), and `AppSchemaRendererProps` exposes no locale to thread. The choice and what would change it are documented at the call site.

- 297534b: Align 43 inline `defaultValue` strings with the `en` pack, and make the call-site gate enforce it (objectui#3810)

  `t(key, { defaultValue: 'English text' })` only renders that text when i18next
  **misses** the key. Where the key exists in `packages/i18n/src/locales/en.ts` the
  pack value always wins, so the inline string is dead code — and 43 of those dead
  strings said something different from the sentence users actually read.

  `scripts/check-i18n-call-site-keys.mjs` (objectui#3530) now compares the two
  whenever a call site carries a literal `defaultValue` for a key `en` defines, and
  fails on any byte of difference. It is a hard rule with **no baseline**: the
  repo-wide census measured 43 sites in 19 files out of 851 literal inline defaults,
  and all 43 are aligned here, so there is no debt for a ratchet to hold. A
  `defaultValue` on a key that is _not_ yet in `en` stays legal — that transition
  runs for months (objectui#3546) and belongs to the existing `missing-key` rule,
  which keeps reporting it alone.

  Every fix moved the CALL SITE to the pack's wording. `en.ts` is untouched: its
  values are what users read today, and changing one would oblige the same change in
  the nine other packs (`scripts/check-i18n-en-drift.mjs`, objectui#3650). Six of the
  43 differed only in an ellipsis (`...` against U+2026) — invisible in review, which
  is how they survived three i18n gates that are each blind to this class by
  construction.

  The visible effect is confined to hosts that render these components with **no**
  `I18nProvider` and no initialised i18next instance. There, react-i18next's
  not-ready `t` returns the `defaultValue`, so the inline string was the rendered
  one; it now matches what a provider-backed app has always shown. Inside the
  console — provider mounted — nothing users see changes. The clearest converging
  examples: the workspaces screen was written as "Organizations" at nine call sites
  while every user has been reading "Workspaces"; the forgot-password success line
  was written as "If an account exists, a reset link has been sent." while the pack
  asserts "We've sent a password reset link to {{email}}."

- f8595a0: A list emptied by the view's own filter says "no records match", instead of inviting you to create your first record

  `ListView`'s empty state distinguishes "filtered to empty" from "truly empty (first run)", but the view's own declared `filter` did not count toward that decision — only the search term, the user-filter conditions and the toolbar's live filter group did. A view that returns nothing _because it is filtered_ therefore rendered the first-run copy over an object full of records.

  That is a small string, and it cost real triage time. In objectui#4155 a stored overlay filter had emptied a list, and the screen said "no data yet / create your first record" — so the report read as data loss or a permission problem, and the investigation went to the data and permission layers rather than to the view layer where the defect was. The same misread is available without any bug at all: a perfectly healthy view declaring `status not_in [archived, deleted]` over an object whose rows are all archived told the user the object was empty.

  The base `filter` now counts as an active query, in both at-rest shapes (an array of conditions, and the Mongo-style object form). No new copy — this only routes to the `list.noMatches` / `list.noMatchesMessage` strings that already exist in all ten locales, so there are no new keys to translate. An author-supplied `emptyState.title` / `emptyState.message` still wins over both branches, unchanged.

- 33c32bf: List sort: the picker stops borrowing the filter whitelist, and a header click is no longer a one-way door out of the view's declared sort

  `filterableFields` was applied to the single field set both toolbar builders read, so a whitelist authored for _filtering_ silently became the _sort_ whitelist too. A view could declare a two-level default sort — `plan_start_date` then `name` — and get a sort panel that offered neither field and rendered both of its rows blank: the declared sort worked on load and could then be neither reproduced nor modified, and there was no way to express "sortable but not offered as a filter condition" short of widening the filter builder as collateral. The whitelist now narrows the filter builder alone, which is the contract it was written for; the sort picker starts from every field the view can name and applies its own sortability rules.

  Those rules are about what the sort can honestly reach, so a second one joins the existing relational exclusion: a `formula` field is withheld. It has no materialised column, so ordering by one is refused by the server outright (objectstack `UNMATERIALIZED_SORT_TYPES`) — and it matters here precisely because the base set widened, since a formula field previously reached the picker only if someone had whitelisted it. The exclusion is `formula` alone and deliberately not the spec's `COMPUTED_VALUE_TYPES`: `summary` and `autonumber` are computed too, each gets a real maintained column, and both order correctly. Either rule keeps its existing escape hatch — a field the current sort already uses stays listed, which for a formula field is the only way to remove the offending row.

  One consequence worth naming: the hint explaining the relational omission used to be gated by the same whitelist. A view whitelisting only `status` showed a near-empty sort picker and no word about why; the withheld relational field now reaches the rule that withholds it, so the explanation appears with it.

  The second half is the way back. One column-header click replaces the whole sort array, so a view shipping a multi-level default lost it for the rest of the session — the declared `sort` behaved as an initial value only, recoverable just by reloading the page. The sort panel gains a **Reset to view default** control that restores the declared array whole: multi-level, in declared order, not merely cleared. It reads the view's declared sort through the same resolver the initial render already uses, so there is one answer to "what did this view declare". It is disabled while the active sort already matches that default, and absent entirely for a view that declares no sort — there is no default to return to, and clearing the sort under that label would be a second, differently-named way to do what removing the rows already does. The header click's own semantics are unchanged: it still replaces the array, it just no longer does so irreversibly.

- 7ffd616: fix(plugin-list): ListView hands the child grid the query behind the window it passes down

  ListView owns the fetch on the external-pagination path — it holds the filter,
  the search term and the sort, and it is the side that calls `dataSource.find`.
  The grid it hands the window to has a cross-page "select all N matching"
  escalation that RE-ISSUES that query to collect the whole match set, and with
  nothing handed down it replayed its own never-written params ref and so asked the
  server for the entire object, feeding unmatched records to bulk delete.

  The params object is now hoisted out of the `find` call — one object, one query,
  no reconstruction that could drift from what was actually asked — recorded past
  the stale-request guard so it is always the query that produced the rows on
  screen, and forwarded as `findParams` in the same handoff block as `rowCount`,
  `page` and `onPageChange`. No public API of `ListView` changes.

- 37cd8e4: `list-view` now reads its `dataSource` binding through the shared `ElementDataSourceGate` instead of a private copy of the precedence table

  objectstack#5576 landed the per-element `dataSource` binding on `list-view` by
  writing the precedence table — binding keys override the component's, a `view` is
  only a baseline, `filter` AND-combines rather than replaces, an authored-but-empty
  `columns` counts as unauthored, the row cap lands on `pagination.pageSize`, and
  `viewType` is taken only when the component declared none — inline in
  `ListViewBlock`. objectstack#6953 then needed the same table for the other eight
  object-bound blocks and lifted it into `@object-ui/react`
  (`useElementDataSourceSchema` / `ElementDataSourceGate`), deliberately not
  touching `ListViewBlock`: refactoring already-merged code inside a wiring PR
  would have been an out-of-scope regression surface.

  That left one table with two implementations — `list-view` on the private copy,
  every other block on the shared one. Nothing was wrong for a user today; the risk
  is the next person to change the rules changing one side, which is how the spec's
  "_additional_ filter criteria" becomes two dialects and a per-element filter
  quietly starts replacing a saved view's instead of narrowing it.

  `ListViewBlock` now contributes only what is genuinely its own — the names of the
  keys `ListView` reads:

  ```ts
  const LIST_VIEW_DATA_SOURCE: ElementDataSourceMapping = {
    columns: true,
    filter: true,
    sort: true,
    limit: "pagination.pageSize",
    viewType: true,
  };
  ```

  and the ~45-line `useMemo` mapping block is deleted, along with the block's
  hand-rolled error and loading panels (the shared
  `ElementDataSourceErrorPanel` / `ElementDataSourceLoadingPanel` render with the
  `list-view` testId prefix, so `list-view-datasource-error` and
  `list-view-resolving-view` are unchanged down to the byte, and the error heading
  is passed through as `errorTitle`).

  **No behaviour changes in either direction**, and that is the acceptance
  criterion rather than a hoped-for outcome: objectstack#5576's entire suite passes
  untouched, with no assertion edited — had any single case needed adapting, the
  two implementations would have been proven to disagree, which is a defect to
  re-grade rather than a refactor detail to absorb. New pins cover the mapping
  table key by key at the block/gate seam, plus the shared loading panel, which
  neither implementation had ever asserted.

- e076fd5: Inline-edit toggle reads "Edit fields" without an I18nProvider, matching every locale pack

  `DETAIL_DEFAULT_TRANSLATIONS` said `Edit fields inline` where all ten packs say
  `Edit fields`, so `InlineEditSaveBar`'s toggle announced two different names for one
  control — the map's on provider-less hosts (standalone embeds, the preview gallery),
  the pack's in the console. The pack wins; the map row now mirrors it byte for byte.

  The three ungated defaults maps (`plugin-detail`, `plugin-list`, `plugin-designer`) are
  now compared key-by-key against the `en` pack by a new gate, generalizing the
  collaboration-only precedent from objectui#3440. `LIST_DEFAULT_TRANSLATIONS` and
  `DESIGNER_DEFAULT_TRANSLATIONS` are exported for it, as `DETAIL_DEFAULT_TRANSLATIONS`
  and `COLLAB_DEFAULT_TRANSLATIONS` already were.

- a84385b: `NavigationConfig.mode` is optional — the type now says what the hook does

  `@object-ui/react` published a `NavigationConfig` that required `mode`, in front of a `useNavigationOverlay` that has always defaulted it. The declaration took the spec's authored config, `Omit`ted `mode`, and re-added it as `NonNullable< … >`; 140 lines below, the hook read `navigation?.mode ?? 'page'`. The type was strictly stricter than the implementation it fronted, and `'page'` is meaningful behaviour rather than a placeholder.

  The spec never asked for that. `NavigationConfigSchema` declares `mode: NavigationModeSchema.default('page')`, and a `.default()` lands on the authoring side as `| undefined` — so `navigation: { view: 'summary_view' }` is legal authored metadata that lets the mode default. `@object-ui/types` already re-exported the spec's own `NavigationConfig` unchanged, which meant one monorepo shipped two published types of the same name that disagreed about whether `mode` could be omitted.

  The alias is now the spec's authored config verbatim, with no divergence of its own:

  ```ts
  export type NavigationConfig = SpecAuthoredInput<
    typeof NavigationConfigSchema
  >;
  ```

  The cost of the old spelling was paid by callers. `ListView` carried `schema.navigation as NavigationConfig | undefined` for no reason except to get a valid spec-shaped value past the declaration; that assertion is deleted here, not replaced. A type in front of an implementation must not be stricter than the implementation — when it is, every caller pays in casts, and a cast is exactly the renderer-side workaround that belongs back at the producer.

  **Nothing changes at runtime.** `navigation?.mode ?? 'page'` is untouched, and the default is now pinned as observable behaviour (`useNavigationOverlay.modeDefault.test.tsx`) rather than only as a comment — the explicit modes, the `preventNavigation` and `none` short-circuits, the `onRowClick` priority, and the Cmd/Ctrl/middle-click and `new_window` branches are all pinned alongside it.

  **Why minor rather than patch**, from the measured `.d.ts`. Optional-izing a property is looser for writers and narrower for readers, so the grade turns on which role the published surface actually plays. In this package `NavigationConfig` occurs only in input positions — `useNavigationOverlay`'s `navigation?:` option and `resolveOverlayWidth`'s parameter — and never in a return type; the package consumes these values and never hands one back. For consumers the change is therefore purely permissive: every call that compiled before still compiles, and spec-shaped configs that previously needed an assertion now compile without one. That gained input shape is a real capability rather than an internal repair, which is more than a patch describes. The reader-side narrowing is real but secondary: code that imports the bare type, annotates its own value with it and reads `.mode` now sees `NavigationMode | undefined`. The in-repo census found exactly one such importer — `ListView` — and it imported the type only to write the assertion this change removes.

- dad805d: Six i18n keys no longer render as raw key strings on hosts with no `I18nProvider` (objectui#4396)

  `detail.saving`, `list.resetSortToDefault`, `appDesigner.widgetProperties`, `appDesigner.addWidget`, `appDesigner.modeEdit` and `common.delete` were read through `createSafeTranslation` without a row in their hook's defaults table and without an inline `defaultValue` at the call site — the only two fallbacks that path has. On a provider-less host (standalone embedding, the preview gallery, host apps that never mount a provider) `fallbackT` therefore returned the key itself, so users saw `detail.saving` in the inline-edit save button, `list.resetSortToDefault` on the sort popover's reset control, `appDesigner.widgetProperties` as the dashboard inspector heading, `appDesigner.addWidget` as its toolbar label, `appDesigner.modeEdit` as a button's accessible name, and `common.delete` on the designer's destructive confirm.

  Each key now has a row in its consumer hook's defaults table, byte-identical to the `en` pack value. No pack was edited, no key added, no call site changed.

- 7f1cb33: List sort: the relational hint stops recommending a formula field, the one type the server refuses to sort by

  The Sort panel withholds columns that link to another record and explains why, and the last sentence of that explanation named the remedy: _add a formula field holding it_. A formula field is exactly what the platform will not order by. The server keeps `UNMATERIALIZED_SORT_TYPES = new Set(['formula'])` and, since objectstack#6994, a sort naming one is a hard `400 INVALID_SORT` — before that it degraded silently, returning every row with `asc` and `desc` byte-identical. So an author who read the hint, followed it, and built a formula field arrived at a refusal; and since #4243 withheld formula fields from this very picker, at a field the panel does not offer either. Two doors, opposite advice, for one problem.

  The remedy sentence now names a **stored, denormalised field — written when the source changes** — and rules the formula field out in as many words: it is virtual, no column is stored for it, and the server refuses to sort by one. That is deliberately the server's own vocabulary rather than a third phrasing of the same fact: objectstack#6924 and objectstack#6994 settled on one wording across the refusal doors so an author refused twice is not sent two different ways, and this is the UI door of that same set. The first half of the hint — why relation columns are withheld at all — is unchanged.

  All ten locale packs move together, as `check:i18n-drift` requires of any `en` edit. The same sentence also lives in `plugin-list`'s provider-less fallback table, which is what renders when the component is used outside an `I18nProvider`; it is updated to match `en` byte for byte, because a pack-only reword would have left the retired advice on exactly the surface this fixes.

- 2e3b0c0: fix(list): an `OBJECT_API_DISABLED` list request renders an honest cannot-work state instead of the empty state

  A list pointed at an object whose `enable` block withholds the API rendered its ordinary
  empty state, so _"this page cannot work, and never could"_ reached the user as _"you have no
  records"_ (objectui#4408). The reported instance — `Setup › Advanced › Signing Keys`, whose
  `sys_jwks` declares `enable.apiEnabled: false` — could not load for any persona and said so
  to nobody. That is also why the upstream defect objectstack#7544 survived review for its
  whole life: a merely unpopulated page invites nobody to click through.

  The masking had two halves, in two packages, and neither package could see the other:

  - **`@object-ui/data-objectstack`** (minor — see the grading note below) — `find()` degraded
    **every** 404 into `{ data: [], total: 0 }` and memoised the resource, so the denial arrived
    at the surface as a successful empty result, indistinguishable from a genuinely empty
    object. The two `enable`-block denials are now let through instead: `OBJECT_API_DISABLED`
    (404) and `OBJECT_API_METHOD_NOT_ALLOWED` (405). The memo skips them too — absorbing one
    would have pinned the object to "empty" for the rest of the session.
  - **`@object-ui/plugin-list`** — the load-error panel gained an `api-disabled` kind. The 405
    half was never swallowed, so it already reached this panel, but classified as `network`:
    _"check your connection and try again"_ for a condition no retry can change. It now says
    the object is not exposed through the API, that this is a setting on the object rather than
    a permission, and it offers **no Retry** button, because every retry re-fetches the
    identical refusal.

  Both denials are pure functions of the object's metadata — no user, no permission, no
  context — so neither is transient or per-user, which is exactly the case where a silent empty
  state is most misleading. Discrimination is on the ADR-0112 `code`, never the status: a
  missing collection, a missing record and a disabled object are all 404.

  **A genuinely empty object still renders the ordinary empty state**, and a backend without an
  optional collection still degrades to empty — pinned in both directions, at the adapter, at
  the view, and once end-to-end over a real adapter and a real `ListView`.

  Also closes a code-propagation gap on the same path: `find()`'s raw `$expand`/`$search`
  branch bypasses `@objectstack/client` and hand-rolled its own error, stamping only `status`.
  It now carries the ADR-0112 envelope (`code` + `httpStatus`), so a denial arriving on the
  branch a list takes whenever it expands a lookup or runs a search is no longer anonymous.

  New strings: `list.loadErrorApiDisabledTitle` / `list.loadErrorApiDisabledMessage`, in the
  `en` pack and mirrored in the list defaults map.

  ## Grading note — why `@object-ui/data-objectstack` is **minor** and not patch

  Two independent reasons, either of which is sufficient under this repo's precedent
  (objectui#4403 / #4177, and #4485's grading of `@object-ui/core`'s `toDomProps` lift):

  1. **The emitted `.d.ts` grows two NEW exports.** `isApiAccessDeniedError(error: unknown):
boolean` and `API_ACCESS_DENIED_CODES` (the readonly tuple
     `['OBJECT_API_DISABLED', 'OBJECT_API_METHOD_NOT_ALLOWED']`) are added to the package's
     public surface. Additive surface growth is minor.
  2. **Observable behaviour on a published API moves.** `ObjectStackDataSource.find()` now
     **REJECTS** for the two `enable`-block denial codes where it previously **RESOLVED** with
     `{ data: [], total: 0 }`. No signature changed and nothing was removed, but a caller that
     relied on those two codes arriving as a successful empty result now receives a rejected
     promise carrying `code` + `httpStatus`, and must handle it.

  Deliberately unchanged, and still resolving to an empty result exactly as before: a bare 404
  with no code, `OBJECT_NOT_FOUND` (still memoised) and `RECORD_NOT_FOUND`. The behaviour move
  is scoped to the two denial codes named above and to nothing else.

  Not major: this follows AGENTS.md's version-alignment rule — objectui's major tracks
  `@objectstack`'s, so this repo's own breaking semantics are declared as minor with the change
  described in the body, which is what this note is.

- 31ab1ac: fix(print): `window.print()` produces a usable page, and the Print buttons say what they do

  The list, report and dashboard Print controls were bare `window.print()` calls with no
  print stylesheet, so the browser printed the whole console — sidebar, top bar, chat rail,
  toasts — with the data table clipped to a single viewport. With no label to the contrary
  they were being accepted against "export to PDF" requirements, which they have never been.

  - `@object-ui/app-shell/styles.css` gains a shared `@media print` block: it hides the shell
    chrome, prints the active content area full-width, releases the viewport-height flex chain
    so long tables paginate instead of clipping, repeats table headers on every sheet, and
    neutralises dark mode (which otherwise prints white-on-white). One sheet serves list,
    report and dashboard.
  - The list and report Print buttons carry a tooltip and accessible name stating that they
    open the browser's own print dialog and are not a PDF export (new `common.printDialogHint`,
    translated in all ten locale packs).
  - The dashboard's `export_dashboard_pdf` action no longer toasts "Preparing PDF export…" —
    it names the print dialog it actually opens (`dashboardActions.pdfPreparing` is replaced by
    `dashboardActions.printDialogOpening`).

  No control was removed and no headless detection was added. A real print/PDF primitive
  remains out of scope (`objectstack-ai/objectstack#1301`, closed NOT_PLANNED).

- ff84b05: Stop the report config panel being titled "Title", and the view-settings colour section "Color"

  Two call sites asked for a key whose value was written for a different slot, so the rendered copy was wrong (objectui#4118, surfaced by objectui#3810's census).

  `ReportConfigPanel` used `report.editor.title` for both its heading and the accessible name of its `role="complementary"` landmark. That key is the label of the report's Title _field_ — `report.editor.titlePlaceholder` ('e.g. Pipeline by Quarter') sits directly under it in the pack. So the panel was headed "Title", and a screen reader announced a complementary region named "Title", which says nothing about what the region is. A new `report.editor.panelTitle` ('Edit report' — what the call site's own dead fallback said before objectui#3810 aligned it to the pack) now names the panel, in all ten locale packs.

  `ViewSettingsPopover`'s colour section used `list.color`. On the wide toolbar `ListView` already uses both keys correctly for the two slots of this one feature: the compact `Paintbrush` button is `list.color` ('Color') and the panel it opens is headed `list.rowColor` ('Row Color'). This popover is that same panel on the collapsed/`compactToolbar` surface, so it now takes `list.rowColor` — an existing key, no pack change.

  No `en` value of an existing key changed; `scripts/check-i18n-en-drift.mjs` reports 0 en values changed, 1 key added.

## 17.4.0

### Minor Changes

- bd863fe: fix(timeline): the timeline binds to the date axis the view actually declares (#3129)

  A view whose date axis is bound under `calendar` was **offered** the Timeline
  visualization and then bucketed every record into "No date" — while the calendar
  rendered the very same field correctly. Two read-sites disagreed about what
  counts as a timeline binding:

  - `ListView`'s capability gate accepted `options.calendar.startDateField` as a
    timeline-resolvable axis; the render branch never read calendar config at all,
    so it fell through to its `created_at` last resort.
  - `app-shell`'s object page emitted `startDateField: 'due_date'` into
    `options.timeline` for **every** object view, declared or not. Downstream that
    is indistinguishable from a real binding, and because it is always present it
    shadowed the fallback entirely.

  `ListView` now resolves the axis once — `resolveTimelineDateBinding`, consumed by
  the capability gate and the render branch alike, reading spec key before legacy
  alias and `timeline` before `calendar` in both nestings — and the object page
  forwards only what the view declared. A declared `timeline.startDateField` still
  wins wherever both appear, and a view that declares no date axis anywhere keeps
  the historical `created_at` fallback.

  Observable rendering change (records move out of "No date" into real date
  buckets), hence `minor`.

### Patch Changes

- e06810e: `PageComponentSchema.dataSource` is now consumed instead of discarded — a
  `list-view` page component can reference a **saved view by name** for the first
  time, and writing the binding no longer breaks the component
  (objectstack#5576).

  The spec declares a per-element data binding on every page component —
  `dataSource: { object, view?, filter?, sort?, limit? }` — and objectui read none
  of it. `ViewDataProvider.resolveElementDataSource` forwarded
  `filter`/`sort`/`limit` and dropped `view` entirely, and had no caller outside its
  own test; nothing mapped `object` onto the `objectName` a list actually reads. So
  "reference a saved view by name" was published, validated and inert, and every
  page that wanted a saved view's columns/filter/sort had to inline a second copy of
  them — the drift the binding exists to remove.

  Writing the binding also **broke** the block, for a reason unrelated to `view`:
  `SchemaRenderer` spread the schema's `dataSource` metadata onto the component as a
  React prop, and that is the prop name the host uses to inject the data-source
  ADAPTER. The plain `{ object, view }` object shadowed the adapter, so the first
  `dataSource.find(…)` threw `dataSource.find is not a function` and `list-view`
  rendered "Couldn't load records" — a spec-compliant component failing next to
  identical ones that omitted the binding.

  - `@object-ui/react` — `SchemaRenderer` no longer spreads `schema.dataSource` as a
    prop (it is metadata, like `visibleWhen`); renderers read it off `schema`. An
    explicit React `dataSource` prop is unaffected. New
    `useElementDataSource(schema, dataSource?)` hook resolves a binding, fetching
    the named saved view from the object definition's `listViews` and the metadata
    overlay's `listViews()`.
  - `@object-ui/core` — new `isElementDataSourceConfig` / `collectSavedViews` /
    `resolveSavedView` / `composeElementDataSource`, and `resolveElementDataSource`
    now honours `view` through an optional `DataFetcher.fetchViews`, reporting an
    unresolvable view as an error instead of silently returning every record.
    `resolveViewId` moved here from `@object-ui/app-shell` (re-exported there) so
    one matcher serves both the object page and a page component.
  - `@object-ui/plugin-list` — `list-view` maps the binding onto the props
    `ListView` reads. `dataSource.*` keys are authoritative, view-supplied values
    are a baseline the component's own keys override, and `filter` AND-combines at
    every level (the spec calls the binding's filter "additional criteria"), so a
    binding can narrow a saved view but never widen it. A `view` name that does not
    resolve renders a configuration error naming the object's actual views and
    issues no query — it never falls back to the object's default view, because that
    turns a typo into a silently wider answer.

- aeb8424: List row Edit/Delete, bulk delete and related-list CRUD now run the caller's own permission, not just the object's API exposure (objectui#4096)

  The row kebab's built-in Edit/Delete rendered for every account, including ones
  the server answers `403 PERMISSION_DENIED` on. Clicking Edit opened a fully
  prefilled dialog that could only fail on save; Delete — a destructive entry —
  sat one click away from users who could never perform it.

  The gate intersected the object's resolved CRUD affordance with the server's
  effective API operation set (`/me/permissions` `apiOperations`, objectui#3720),
  and nothing else. `apiOperations` is the object's **API exposure surface** —
  "which verbs does this object publish" — and the spec's own describe text says
  so. It is principal-independent: the report measured two accounts with opposite
  `allowEdit`, 30 shared objects, and **30/30 identical** `apiOperations`. A gate
  made only of object-scoped layers therefore fails OPEN for every unprivileged
  caller, which is why the same screen carried three different answers to "may
  this user write this object": the toolbar's New was correctly hidden
  (`affordances.create && can(obj, 'create')`), the record header's Edit/Delete
  were correctly hidden (per-record write probe), and the row kebab was not.

  Four surfaces now AND the principal's own verdict — `can(obj, 'update' |
'delete')`, i.e. `/me/permissions` `allowEdit` / `allowDelete`, the toolbar's
  source — on top of the layers they already had:

  - the grid row kebab's built-in Edit/Delete (`resolveRowCrudAffordances` gained
    `permissionUpdate` / `permissionDelete`, filled at the `ObjectGrid` call site);
  - the grid's bulk-delete bar, which rides the same object-level delete verdict,
    so the row gate and the more destructive bulk entry move together;
  - the non-grid (kanban / calendar / gallery) bulk bar `ListView` renders itself;
  - the related-list Create/Edit/Delete on a child object
    (`RelatedRecordActionsBridge`), which had the same object-only gate.

  **This is a tightening of the intersection, not a swap.** Every existing layer
  stays: the ADR-0103 lifecycle bucket, `userActions.edit` / `delete`, and
  `apiOperations`. A permission grant cannot re-open what any of them closed, and
  none of them survives a permission denial.

  Fail-open is preserved where it is the deliberate contract: `usePermissions()`
  with no `PermissionProvider` answers `can: () => true`, so standalone embeds and
  hosts that ship no permission source keep their Edit/Delete exactly as before.
  Under `MePermissionsProvider` the semantics are the toolbar's, unchanged and now
  shared: an authenticated principal whose object is absent from
  `/me/permissions.objects` resolves fail-closed (objectui#2926 ④), an anonymous
  session keeps the permissive default, and children never render while the
  permission set is loading. Per-key absence is still permissive — an object entry
  without `allowEdit` reads as allowed.

  Server-side enforcement was already hard (403, DB unchanged), so this closes a
  UI-affordance gap rather than an authorization hole.

- cb5e32d: `UserFilters` preset tab buttons no longer submit an enclosing form; all six buttons declare `type="button"`

  An HTML `<button>` defaults to `type="submit"` inside a `<form>`, so a preset
  filter tab (`filter-tab-*`, tabs mode) submitted the enclosing form on every
  click. The three buttons objectstack#6952 named now declare `type="button"`
  explicitly — the dropdown chip trigger (`filter-badge-*`), the overflow trigger
  (`user-filters-more`) and the preset tab — joining the session-tab buttons that
  objectstack#5236 already declared it on.

  Only one of the three was actually at risk, and the difference is measured
  rather than assumed. The chip and the overflow trigger are
  `PopoverTrigger asChild` children, and Radix's `PopoverTrigger` renders
  `Primitive.button type="button"`; its Slot merges that onto a child declaring no
  `type` of its own, so both already rendered as `button`. Reverting the change
  confirms it: those two keep reading `button`, the plain preset tab button reads
  `null`. For the two triggers this therefore moves a contract out of an upstream
  implementation detail and into local source — the same reasoning objectui#3344
  wrote onto the Combobox trigger — while the preset tab is a real fix.

  Dormant rather than live: the only mount point today is `ListView`'s toolbar,
  which is not inside a form, so no shipped screen submitted anything. The new
  tests pin every rendered `UserFilters` button, in both modes, so a future button
  cannot land at the submit default and an upstream Radix change surfaces in this
  package's tests instead of in a user's form.

  The in-file comment claiming "a Radix trigger keeps the HTML default of `submit`"
  is corrected in passing — it is the inaccuracy that propagated into
  objectstack#6952's premise.

- cf5be4e: `userFilters` tabs: the `allowAddTab` button now adds a tab instead of doing nothing (objectstack#5236)

  The affordance `allowAddTab` renders had hover styling and `title="Add filter tab"` but no `onClick`, and `TabFilters` took no add-tab callback at all — a control that looked fully clickable and did nothing, which disguises "not implemented" as "a bug where clicking does nothing". That mattered more once objectstack#5073 promoted `allowAddTab` into the spec's `UserFiltersSchema`: the key became discoverable through JSON Schema, the Studio SchemaForm and the reference docs, so an author writing `allowAddTab: true` gets a declaration the runtime did not honour.

  Clicking it now opens a small naming popover (the same Popover primitive the filter chips and the "More" overflow already use). Confirming a name adds a tab to the same bar as the presets, carrying a snapshot of the conditions applied at that moment, and selects it. Session tabs also carry a remove affordance; authored presets deliberately do not, since those are metadata. Removing the active session tab re-selects the author's default with the same precedence the initial mount uses, so the bar is never left with no active tab while the removed tab's conditions stay applied.

  The new tab is **session-scoped, held in component state** — no `sys_metadata` write, no API call, no web storage, per ADR-0047 ("an end user's filter choices are session-scoped and never become metadata"). `sessionStorage` was available and deliberately not used: `UserFilters` receives no object or view identity, so any storage key it could invent would be shared by every list in the browser tab, surfacing one list's ad-hoc tabs on another's bar. Persistence beyond the mount, if ever wanted, belongs to the host that already owns the session channel for filter selections (`onSelectionsChange` mirrored into `uf_*` URL params) and can key it by view. The synthetic tab id is reported through `onSelectionsChange` like any other tab switch, so a host mirroring it into the URL hands it back on the next mount, where the existing id check finds no such tab and falls back to the author's default.

  No public API change: `UserFiltersProps` is untouched, and `allowAddTab: false` / an omitted `allowAddTab` still render no affordance at all.

## 17.3.0

### Patch Changes

- 978705c: Gallery covers now resolve the `coverField` value through its **file value
  shape** instead of assuming the field value _is_ a URL string, so an
  ADR-0104-conforming `image` value renders a cover again (objectui#3317).

  Since ADR-0104 D3 wave 2 the stored value of a `file`/`image`/`avatar`/
  `video`/`audio` field is an opaque `sys_file` id, which the read path expands
  in place into `{ id, name, size, mimeType, url }`. `ObjectGallery` read the
  value twice — `hasAnyCover` tested `typeof value === 'string'`, and each card
  did `item[coverField] as string` — so against a spec-correct object value the
  cover area collapsed for the whole gallery, and the card underneath it built
  an `<img src="[object Object]">`. The only values that ever rendered were the
  inline `data:` URIs and external links ADR-0104 retired, which is why this
  stayed invisible.

  ## What changed

  - Both reads now share one `resolveCoverUrl`, so the "does anything have a
    cover?" predicate and the per-card render can no longer disagree — that
    disagreement is what collapsed the area for records that did have a cover.
  - Shape handling is delegated to `readFileValues` from `@object-ui/fields`,
    the platform's existing single arbiter of file value shapes, rather than
    re-derived in the gallery. It accepts the expanded `{ url }` object, a
    legacy bare URL string (still valid during the dual-mode window), and a
    still-bare `sys_file` id — which resolves to the stable
    `/api/v1/storage/files/:id` endpoint instead of reaching `<img src>` as a
    raw opaque token. A value carrying no resolvable URL yields no cover, which
    collapses the area rather than emitting a broken `src`.
  - A `multiple` file field's first entry is used as the cover.

  The sibling paths that thread `coverField`/`imageField` around
  (`ListView`, `app-shell/ObjectView`, `plugin-view/ObjectView`) pass the field
  **name**, not the value, and needed no change.

- d915c47: Relation fields (`lookup` / `master_detail` / `user` / `tree`) are now usable in action and conditional-formatting predicates: they bind as the stored foreign key on every surface, and the fields a predicate reads are included in the query projection (#3501).

  Before this, one predicate over one relation field had four different fates, decided by things its author does not control. `$expand` **replaces** the id in place with the whole related record, and a view expands exactly the relations it shows as COLUMNS — so `record.owner == "U1"` was **true** where the column was absent, **false** where it was displayed, and a **fault** where the field was neither displayed nor projected (a list's `$select` was built from its columns alone, and CEL treats an absent key as a fault, not as null). A fault is fail-CLOSED on the row kebab and the selection bar and fail-OPEN on the lenient paths, so the same authoring mistake hid the button from everyone on one surface and showed it to everyone on the next, with nothing on screen to point at either. The server, meanwhile, only ever sees the id — so client and server could not agree, which is the one thing ADR-0036 / ADR-0058 exist to guarantee.

  Two changes close it. `toPredicateRecord` (new, `@object-ui/core`) collapses expanded relation values back to their ids when a record is bound for evaluation — driven by the object's own field types, not by sniffing for an `id` key, so a `json` field that happens to carry one is untouched. It is threaded through `evalRowPredicate` / `resolveConditionalFormatting` (via a new `fields` option), `useRowPredicate`, `partitionBulkRows`, and both `page:header` evaluators, with the object schema supplied by `ObjectGrid` / `ListView` / `ObjectKanban` / the record context. Kanban card formatting is threaded the same way, so a rule cannot match on the grid view of a list and silently never match on its board. Display is unaffected — a detail-page title still renders the related record's name, and the schema-only `kanban-ui` entry point (which has no object schema to offer) keeps using the payload verbatim. `collectPredicateFieldRefs` / `listViewPredicates` (new) harvest the `record.x` / `data.x` references out of a view's conditional formatting, row-action defs, bulk-action defs, promoted object actions and `userActions` overrides, and add them to `$select` — intersected with the object's declared fields plus the platform columns every object carries (`isProjectableField`), because an unknown key is not ignored by every backend. No `$expand` is added: a predicate wants the foreign key, which is what an unexpanded relation already is.

- 6195841: Localize the record-detail overlay heading that `ListView` and `ObjectGrid`
  build themselves (objectui#3426)

  #3423 gave `NavigationOverlay`'s `resolvedTitle` an i18n default
  (`detail.recordDetail`), but two hosts never let that default run: they
  string-built an English heading in TypeScript and passed it as the `title`
  prop, so a zh/ja/de session got a fully localized drawer with one English
  heading on it.

  - `packages/plugin-list/src/ListView.tsx` — `` `${schema.label} Detail` ``
  - `packages/plugin-grid/src/ObjectGrid.tsx` — the same template, plus a bare
    `'Record Detail'` literal for the no-label case

  Both are user-reachable, not dead defaults. `list-view` / `object-grid` are
  public page blocks and `navigation` is an authorable key on their schema, so a
  page that authors `navigation: { mode: 'drawer' }` opens exactly this overlay
  on row click. (`app-shell`'s `ObjectView` does suppress it — it passes its own
  `onRowClick`, which takes priority inside `useNavigationOverlay`, and renders
  its own overlay — but that is one host overriding a public block, not proof the
  branch is unreachable.)

  ## What changed

  Both call sites now key their heading instead of concatenating it:

  - a new `detail.recordDetailWithLabel` (`'{{label}} Detail'`) carries the
    object label through interpolation, so a pack whose qualifier trails the noun
    (`de`) or that needs a possessive particle (`ja`/`zh`) can write its own
    arrangement rather than inherit English word order;
  - the no-label branch reuses `detail.recordDetail` — the very key the overlay
    itself defaults to — so one heading on one control cannot drift into two
    translations.

  The new key is added to all ten locale packs and to each plugin's English
  defaults map (`LIST_DEFAULT_TRANSLATIONS` / `GRID_DEFAULT_TRANSLATIONS`), which
  is what `createSafeTranslation` falls back to with no `I18nProvider` mounted.

  English output is byte-identical in every branch (`Contacts Detail` /
  `Contacts Detail` / `Record Detail`), with and without a provider — pinned by a
  provider-less test file per plugin, kept separate because `initReactI18next`
  registers its instance as a module global that outlives `cleanup()`.

- d7f350a: `UserFilters` no longer carries its own operator table when it lowers a `ViewTab.filter` preset into an ObjectQL AST node. The private `specOperatorToAst` was the second hand-kept operator map in this package and it had drifted: it lowered `not_in` — the spec's OWN canonical spelling — and the legacy `nin` to the spaced `'not in'`, a spelling that appears in no spec vocabulary. `isFilterAST` refuses it, so clicking such a tab produced an empty list plus `400 INVALID_FILTER`. Measured against a real backend (published `@objectstack/*@17.0.0-rc.2` + app-showcase, on `showcase_task`): `$filter=[["status","not in",["done"]]]` returned `400 INVALID_FILTER`, while `[["status","not_in",["done"]]]` returned `200` with the same 8 records as the `["status","!=","done"]` baseline.

  Lowering is now purely structural — all 19 `VIEW_FILTER_OPERATORS` are already members of the wire's `VALID_AST_OPERATORS`, so nothing needs translating — with the spec's own `normalizeFilterOperator` as the single exit for the legacy spellings stored metadata still carries (`gt`, `eq`, `nin`, `notEquals`, …). That is the same exit the write side (`viewFilterFold`) and the saved-view fold in `@object-ui/core` already use, so the directions cannot drift into two dialects. An operator the spec does not know is passed through verbatim, so a misspelling still earns a loud `400` rather than being coerced into a valid filter.

  `before` and `after` are now passed through rather than rewritten to `<` and `>`. That was the one judgement call, and it was settled by measurement rather than assumption: on the same live backend the word and the symbol return identical status and identical record ids, on a `date` field and on a `datetime` field, in both directions — so the rewrite was a no-op and dropping it is a pure fix. The remaining 18 canonical operators were measured the same way and are likewise unchanged in what the server answers; `not_in` is the only one whose answer changes, from `400` to the correct rows. Tab presets given in the legacy already-lowered `filters: triplet[]` shape are untouched, as before.

## 17.2.0

### Minor Changes

- c5ccbd5: Stop declaring 12 `@object-ui/data-objectstack` / `@object-ui/plugin-chatbot` /
  `@object-ui/plugin-list` symbols under names `@objectstack/spec` owns
  (objectui#3160, objectstack#4115 batch 6). All three packages leave the ledger.

  **Breaking for importers of `@object-ui/data-objectstack`** — four exported
  names changed, because the spec exports the same name for a _different_ thing:

  | was                   | now                         | what the spec's same-named export actually is                                            |
  | :-------------------- | :-------------------------- | :--------------------------------------------------------------------------------------- |
  | `CacheStats`          | `MetadataCacheStats`        | the platform `ICacheService` counters (`keyCount`, `memoryUsage`)                        |
  | `MetadataSaveOptions` | `MetadataClientSaveOptions` | options for writing a metadata item to a **file** (`format`, `path`, `indent`, `atomic`) |
  | `SecurityPolicy`      | `SecurityManagerPolicy`     | the package supply-chain policy (`autoScan`, licences, code signing, sandbox)            |
  | `ValidationError`     | `DataApiValidationError`    | a plain `{ field, message, code? }` entry in a validation report                         |

  Each pair is disjoint or nearly so — `MetadataSaveOptions` and `SecurityPolicy`
  share not one key with the spec type whose name they wore — so none of them was
  a dialect to reconcile; they were four unrelated concepts squatting on spec
  names. `DataApiValidationError` follows the `<what was validated>Validation<Error|Result>`
  convention registered on objectstack#4115 (`@object-ui/core` took
  `SchemaNodeValidationError` in batch 4). Its **runtime** `name` deliberately
  stays `'ValidationError'`: `normaliseClientError` and `@object-ui/react`'s
  error-message helper both sniff `err.name`, so that string is a wire contract,
  not a symbol.

  **Breaking for importers of `@object-ui/plugin-chatbot`** — `PendingActionRow`
  and `PendingActionStatus` are now re-exported from `@objectstack/spec/contracts`
  instead of hand-transcribed, which narrows them. The copies had drifted three
  ways, and each drift had **disabled a compile-time check** rather than merely
  differed from one:

  - `status: PendingActionStatus | string` — a union with `string` absorbs the
    literals, so that annotation carried no information at all;
  - `[key: string]: unknown` — the objectstack#4075 mechanism: an index signature
    makes every structural comparison against the spec answer "identical", however
    far the copy has drifted;
  - `created_at` / `updated_at`, which the service contract does not carry and no
    consumer in this repo reads.

  **Breaking for importers of `@object-ui/plugin-list`** — `ViewTab` is derived from the spec's `ViewTabSchema`
  — from its **input** side, because `pinned` / `isDefault` / `visible` carry
  `.default()`s and this component is handed authored metadata, not parsed output.
  That removes a renderer-side tolerance the copy carried: `visible` accepted
  `string | boolean` and the tab bar compared it against the literal `'false'`, a
  spelling no producer emits. `label` also stops being required (the spec makes it
  optional; `name` is the identifier) and `filter` stops being `any`.

  `ListView` and `UserFilters` keep their names as declared dialects: both are the
  React **renderers** of the spec types whose names they share, and each takes that
  spec type as a prop (`ListViewProps.schema`, `UserFiltersProps.config`) rather
  than restating its shape. `Tool` and `MessageContent` in `plugin-chatbot` are
  vendored Vercel AI Elements / Shadcn primitives — upstream's component API, not
  objectui's authored surface — so the guard now skips that directory the same way
  it already skips `components/src/ui/`, with a test that fails if any file there
  stops carrying its vendor banner.

  Scored `minor`, not `major`, per this repo's fixed-group rule — objectui's major
  tracks `@objectstack`, so breaking changes of our own ship as minor with the
  semantics spelled out above (see AGENTS.md §版本号策略). A `major` here would carry
  all 39 packages of the fixed group to `18.0.0` and off objectstack's 17.x line.

- 5cb75b3: fix(timeline,list): the timeline honours `timeline.dateField`, not just `timeline.startDateField` (#3129)

  `dateField` is the pre-#2231 alias for `startDateField`. `@object-ui/types`
  declares it on the nested config (`ListViewTimelineConfig`), and both
  `ObjectView` read-sites (app-shell and plugin-view) resolve it — but the two
  read-sites that actually drive the axis did not:

  - `ObjectTimeline` consulted the alias only on the FLAT prop (`schema.dateField`),
    never on the nested `schema.timeline`.
  - `ListView` resolved it out of `options.timeline` but not out of the
    spec-canonical `schema.timeline` — including in the capability gate, so such a
    view could fail to offer the Timeline option at all.

  So a view authored as `timeline: { dateField: 'start_date' }` — the spec nesting
  with the legacy key — fell through to the caller's default (`created_at` /
  `due_date`). That field is normally absent from the `$select` projection, so
  every record came back without it and the timeline rendered all of them under
  **No date** — while the configured date was sitting in the row untouched. That
  also explains why widening the view's projection changed nothing: the projection
  already carried the right field; the renderer was reading a different one.

  Both read-sites now resolve the alias in the same precedence position they
  already use for `options.timeline.dateField`. The spec key still wins wherever
  both appear. Observable rendering change (records move out of "No date" into
  real date buckets), hence `minor`.

### Patch Changes

- 335041c: Stop declaring 13 `@object-ui/core` symbols under names `@objectstack/spec` owns
  (objectui#3158, objectstack#4115 batch 4).

  **Breaking for importers of `@object-ui/core`** — seven exported names changed,
  because the spec exports the same name for a _different_ thing:

  | was                      | now                               | what the spec's same-named export actually is                                |
  | :----------------------- | :-------------------------------- | :--------------------------------------------------------------------------- |
  | `ChartSeries`            | `ChartSeriesBinding`              | the authored dataset-binding descriptor (a measure `name`, no `data`)        |
  | `ActionHandler`          | `ActionRunnerHandler`             | the SERVER-side objectql handler, `(ctx) => unknown`                         |
  | `PluginDefinition`       | `RegistryPluginDefinition`        | the platform PACKAGE manifest (`id`/`slug`/`staticPath`/install hooks)       |
  | `ValidationError`        | `SchemaNodeValidationError`       | plugin-manifest validation, keyed by `field`, no severity                    |
  | `ValidationResult`       | `SchemaNodeValidationResult`      | ditto, with both arrays optional                                             |
  | `defineView`             | `defineSystemView`                | the VIEW-DOCUMENT factory: parses a `ViewSchema`, returns a validated `View` |
  | `resolveCrudAffordances` | `resolveEffectiveCrudAffordances` | the object-level affordance matrix, with no notion of server API operations  |

  The other six keep their names and are now **imported from the spec** instead of
  re-declared: `StyleMap`, `ResponsiveStyles` (ADR-0065), `RowHeight`,
  `CONTEXT_TOKENS`, `CrudAffordances`, `RowCrudPredicates`.

  **The copies were live misdescriptions, not just duplicates.** Three said so in
  their own comments:

  - `CONTEXT_TOKENS` carried a note that the duplication was "temporary until the
    next coordinated release… because the installed `@objectstack/spec` predates
    that export". The installed spec (17.0.0-rc.0) exports it, and the copy was
    byte-identical — so it passed every value comparison and every behavioural
    test for the whole interval in which its stated reason was false.
  - `RowHeight` advertised itself as "the spec's `RowHeightSchema` vocabulary"
    while being a hand-written union. It happened to be correct; nothing would
    have caught the day it stopped being.
  - `managedBy.ts` described itself as a "UI-side mirror of the framework's
    `resolveCrudAffordances()`" and carried its own `DEFAULTS` table — a
    line-for-line copy of the spec's `CRUD_AFFORDANCE_DEFAULTS`, plus a copy of
    its override parser.

  `resolveEffectiveCrudAffordances` now **delegates** the bucket/`userActions` half
  to the spec's `resolveCrudAffordances()`, so the bucket table has exactly one
  definition on the platform. What stays objectui's is the part the spec has no
  notion of: intersecting that matrix with the server-resolved effective API
  operation set (#3391), so the UI never offers a button the server would 405 —
  and the name now says that instead of claiming to be the spec's function.

  Deriving `RowCrudPredicates` also **tightens** it: the local copy typed
  `visibleWhen`/`disabledWhen` as `unknown`, where the spec types them as
  `Expression | ExpressionInput`. That was imprecision, not a deliberate dialect.

- 5eaa861: `list-view` and `embeddable-form` get a data source on the registry path — their required `objectName` was binding to nothing (#3144).

  `SchemaRenderer` puts the data source on `SchemaRendererContext` and **never** injects it into
  component props. A component that reads `props.dataSource` therefore needs its registration to
  bridge the two. `object-form`, `object-kanban` and `object-calendar` each register a small
  renderer that does exactly that. These two did not:

  - `list-view` (and its `view:list` alias) registered the bare `ListView`, which reads
    `props.dataSource` — so its `getObjectSchema` effect returned immediately, nothing was ever
    fetched, and it rendered the `empty-state` "Nothing here".
  - `embeddable-form`'s renderer was `({ schema }) => <EmbeddableForm config={schema} />`, dropping
    the context entirely — so the read-only source it derives for its inner `ObjectForm` was never
    built, and its submit path (`if (dataSource) await dataSource.create(...)`) had nothing to call.

  Both declare `objectName` **required** in their registry `inputs`. A binding the protocol obliges
  an author to supply, that nothing on that path can consume, is objectstack#4413's shape one layer
  up — and the reason it went unnoticed is that the console never takes this path: it reaches
  ListView through `ObjectView`'s `renderListView` render-prop, which passes a data source itself.
  Broken on the registry/SDUI path, which is the path `sdui.manifest.json` describes and a
  `kind:'react'` page walks.

  Found by `apps/console/src/__tests__/public-block-binding-reach.test.tsx` (objectstack#4472), not
  by hand — that suite mounts every public block declaring an `objectName` under a recording
  `dataSource` and asserts the binding arrives. Its ledger carried these two as named debt; with the
  bridge in place the ledger's both-directions assertion **failed until the entries were deleted**,
  which is the mechanism working as designed. Only `record:related_list` remains, and legitimately
  (it needs a parent record id from `RecordContext` before it may fetch).

  An explicit `dataSource` prop still wins, so hosts passing their own are unaffected, and
  `ListViewRenderer` forwards refs so `ListViewHandle` still works through the registry.

## 17.1.0

### Minor Changes

- d21794c: fix(list,i18n): a 400 from the server no longer reads as "check your connection"

  `classifyLoadError` was written because a 403 rendered the same
  "check your connection and try again" panel as a genuine outage — its own doc
  comment says users "were told to debug their network when the server had
  (correctly) denied them access." It made that distinction for 401 and 403 and
  then sent **everything else**, including 4xx, to the network branch.

  A **400** is the server saying it understood the request and will never accept
  it. Retrying resends the identical bad request, so "check your connection and
  try again" is advice that cannot work — the same mistake the function exists to
  prevent, one status code over.

  This became reachable from ordinary stored metadata with
  objectstack-ai/objectstack#4121: a `$filter` array that is not a filter AST is
  now rejected at the protocol with `400 INVALID_FILTER`, where it previously
  reached a driver (and, for a lone `['and']`, silently returned every row). A
  view saved with such a filter now answers 400 on every load.

  Adds a fourth classification, `rejected`, for `status === 400` and for the
  server's 400-class codes (`INVALID_FILTER`, `UNSUPPORTED_QUERY_PARAM`,
  `INVALID_QUERY`). Its copy points at the filter rather than the network, and
  says who can fix it when the view is saved that way. 403/401 keep priority, so a
  permission denial can never read as a bad request — pinned by a test.

  The two new strings are added to **all ten locale packs**, not just `en`: the
  neighbouring panels are translated, and `fallbackLng: 'en'` would have rendered
  this one in English beside them. The full-parity gate
  (`all-locales-key-parity.test.ts`) caught the pack I missed.

  Verified: 5 new tests — numeric status, error code without a status, a status
  embedded in the message text, and the 403/401 ordering guard. Reverting the
  branch fails four of them. `plugin-list` + `i18n`: **403 tests across 29 files**,
  green.

- c4db402: refactor(views): ListView's `aria` and `sharing` are the spec sub-shapes (#2890 scope A step 5)

  Last rename batch in the ListView vocabulary migration.

  **`aria`** is now the spec's `AriaPropsSchema`: `label` → `ariaLabel`,
  `describedBy` → `ariaDescribedBy`, folded at the ListView boundary like every
  other legacy key. Two things fall out of adopting the spec shape:

  - `role` becomes authorable. The list region hardcoded `role="region"`; it now
    reads `aria.role` and falls back to `region`.
  - `aria.live` stays as a documented local extension — it has no spec
    counterpart, and dropping it would silently disable a shipped capability.
    Promote it rather than growing that extension.

  **`sharing`** is now the spec's `ViewSharingSchema` (`{ type, lockedBy }`),
  imported by reference — the local four-key object is gone. The legacy pair folds
  in: `visibility` collapses onto the two ownership kinds the spec models (only
  `private` is `personal`; `team` / `organization` / `public` are all
  `collaborative`), and a bare `enabled: true` maps to `personal`, which is the
  badge the user already saw (the old title fell back to `'private'`).

  _Visible change_: the share badge's tooltip shows the spec ownership type, so a
  view authored with `visibility: 'team'` reads "Sharing: collaborative" instead
  of "Sharing: team". The four-value audience has no spec home and nothing but
  that tooltip consumed it; keeping a second audience enum alive would re-open the
  fork this issue closes.

  Also fixes the **spec bridge**, which was doing the opposite of its job: given a
  spec-shaped `sharing`, `transformListView` _downgraded_ it — inventing a legacy
  `visibility` audience and an `enabled` flag that the renderer then had to fold
  back. Both sides speak `ViewSharing` now, so it passes through.

  `conditionalFormatting` and `exportOptions` are deliberately **not** folded.
  Both objectui shapes are supersets carrying capability the spec cannot express —
  the `{ field, operator, value }` rule form, and `maxRecords` / `includeHeaders`
  / `fileNamePrefix`. Folding them onto the narrower spec shapes would delete
  working features; they want promotion upstream, not a rename.

- 5319bf1: feat(views): the list toolbar speaks one vocabulary — `userActions` (#2890 scope A step 3)

  The seven bare `show*` toolbar flags fold into the spec's `userActions`, and the
  renderer reads nothing else. `showDescription` folds into
  `appearance.showDescription` at the same boundary.

  | legacy                                                    | canonical                                                 |
  | :-------------------------------------------------------- | :-------------------------------------------------------- |
  | `showSearch` / `showSort` / `showFilters` / `showDensity` | `userActions.search` / `.sort` / `.filter` / `.rowHeight` |
  | `showGroup` / `showHideFields` / `showColor`              | `userActions.group` / `.hideFields` / `.rowColor`         |
  | `showDescription`                                         | `appearance.showDescription`                              |

  **The last three are new keys, and they close a capability hole rather than just
  renaming one.** `@objectstack/spec`'s `UserActionsConfigSchema` documents itself
  as "which interactive actions are available to users in the view toolbar — each
  boolean toggles the corresponding toolbar element on/off", and already carries
  `rowHeight` (objectui's `showDensity` under its spec name). Grouping, column
  visibility and row coloring are the same kind of toggle: the spec models all
  three as _configuration_ (`grouping`, `hiddenFields`, `rowColor`) but has no
  "may the user change it" switch for any of them.

  The consequence was visible in the product. With no `userActions` key to read,
  the two list surfaces **hardcoded opposite policies**: `InterfaceListPage` (the
  author-curated interface page) pinned all three OFF, `ObjectDataPage` pinned two
  ON — and an interface-page author could not turn grouping back on for end users
  at all. Both surfaces now express their policy as `userActions` defaults, which
  an author can override.

  Until the keys land in `@objectstack/spec`, `@object-ui/types` carries them as a
  documented `.extend()` on `UserActionsConfigSchema` (the same shape
  `ListColumnSchema` uses while waiting on objectstack#3761); it collapses into a
  plain re-export once they do. Note the spec schema is not `.strict()`, so before
  this an author writing `userActions: { group: false }` had it **silently
  stripped** — valid on parse, no effect at render.

  Defaults are unchanged and deliberately asymmetric, matching what these flags
  have always done: `search` / `sort` / `filter` / `rowHeight` / `group` are on
  unless turned off; `hideFields` / `rowColor` are off unless turned on. Making
  them uniform would grow two buttons on every existing view, so it is left as its
  own product decision rather than smuggled into a vocabulary migration.

  Also drops a dead relay in app-shell's `ObjectView`, which forwarded
  `showDescription` onto the node although `ListView` has only ever read
  `appearance.showDescription`.

- 24e0e0a: feat(components,grid,list): a column-header sort orders the whole list, not the page you can see — #3106

  Clicking a column header under server pagination sorted **the current page**.
  The user saw "sorted by this column" and got "these fifty rows are in order;
  page 2 starts over". The sort was real — its scope was not the one the screen
  implied — and it had no way out of `data-table` at all: the sort lived in two
  `useState`s with no callback, so the layer that issues the request could not
  see it even in principle.

  `DataTable` gains `manualSorting` + a controlled `sort` + `onSortChange`. In
  that mode it sorts nothing, reports what a header click asks for, and renders
  `sort` as the indicator — keeping **no** sort state of its own, because a
  private copy beside a controlled prop is the shape the defect had.

  `ObjectGrid` turns that into a `$orderby` in both of its server modes (its own
  fetch, and a parent-driven one), and `ListView` lands it in `currentSort` — the
  same state the toolbar's sort builder writes. One sort, two controls: that is
  what makes "does a header sort outrank the saved view's sort?" a non-question
  rather than a precedence rule someone has to remember.

  Three details that are decisions, not incidentals:

  - **A header click replaces the order** instead of appending to it, so the
    column under the cursor is the one the list is sorted by. Multi-key orders
    still come from the sort builder, and the headers render them numbered.
  - **It cannot ask for "no sort".** In client mode the third click clears, and
    that is meaningful there — the rows return to the order they arrived in.
    Across a server-paged collection there is no such order (objectstack#4363), so
    a header offering it would hand the user a worse lie than the one being fixed.
    Clearing stays with the sort builder, which can restore the view's default.
  - **Relational columns render no sort affordance** under server sorting. A
    `lookup` column shows a related record's name while `$orderby` can only order
    by the stored id (objectstack#4256) — the same reason #3096 removed them from
    the toolbar's sort picker. Client-side sorting keys off the rendered label, so
    those headers stay live there.

  Client-side tables are untouched: same three-state cycle, same local sort.

### Patch Changes

- 95b7214: fix(list,grid,detail,tree,core): every column resolver reads one key (#3104 PR2)

  PR1 (#3119) put a canonicalizing fold at ListView's ingestion boundary. This
  converges the 22 read sites themselves onto `columnIdentity()` from
  `@object-ui/core`, so a surface that is NOT downstream of that fold resolves
  the same identity anyway.

  That distinction is the user-visible part. A standalone `object-grid` node —
  authored directly on a page, with no `list-view` above it — never passed
  through `normalizeListViewSchema`. Its `getSelectFields` read `c.field` alone
  while the `ensureId` probe one line above read `f?.name || f?.field`, so a
  legacy `{ name: 'account' }` column reached `$select` as a literal `undefined`
  hole: the server never returned the field and every cell in that column came
  back empty. Same for `ObjectTree`, `RelatedList` and the `record:details` /
  `record:related_list` renderers.

  Converged:

  | Surface                                  | Was                                            | Now                                 |
  | ---------------------------------------- | ---------------------------------------------- | ----------------------------------- |
  | `ListView` ×9 + its 2 request builders   | `name \|\| fieldName \|\| field` vs `f?.field` | `columnIdentity()`                  |
  | `RelatedList` ×8                         | `accessorKey \|\| field \|\| name`             | `accessorKey \|\| columnIdentity()` |
  | `ObjectGrid`                             | name-first probe vs `c.field` projection       | `columnIdentity()`                  |
  | `ObjectTree`                             | `name \|\| fieldName \|\| field \|\| key`      | `columnIdentity() \|\| key`         |
  | `buildExpandFields`                      | `field ?? name ?? fieldName`                   | `columnIdentity()`                  |
  | `record-details` / `record-related-list` | `field \|\| name (\|\| key)`                   | `columnIdentity() (\|\| key)`       |

  `accessorKey` keeps its precedence in `RelatedList` — it is TanStack Table's
  column key, not ObjectStack metadata identity, and only the `field || name`
  tail was converged. `key` stays a tail fallback in `ObjectTree` and
  `record-related-list` for the same reason: it is a generic entry key.

  Two incidental fixes that TypeScript surfaced once the resolver stopped
  returning `any`: ListView's filter-field options and its hide-fields popover
  both built entries keyed `undefined` for a column with no resolvable identity.
  Those entries could never match a column; they are now dropped.

  **Inventory re-triage.** PR1 recorded 24 family members. Two were mis-classified
  and are reclassified here rather than converged — reading what they actually
  feed shows they are not column reads at all:

  - `ViewPreview.tsx` adapts a ViewItem **form** section to what `object-form`
    selects by (`field` → `name`) — the #3090 two-layer join.
  - `SchemaForm.tsx` renders an arbitrary metadata **array** into a popover
    summary and guesses at a display key; the entries are validations, actions,
    or whatever the JSON schema declares.

  So the family was 22, and it is now **0**. The ratchet asserts that, asserts
  each converged surface actually routes through the shared reader (a surface
  that dropped identity resolution instead of converging it goes red), and pins
  `accessorKey`'s precedence in `RelatedList`.

- 9eb932b: fix(console): three real-user console failures — 403 blamed on the network, ⌘K search capped at 8 objects, nav gating fields inert

  1. **List error panel classifies the failure** (`plugin-list`, `i18n`): a 403/401 from the data source used to render the same "check your connection" copy as a genuine outage, sending users to debug their network while the server was correctly denying access. The panel now classifies by `httpStatus`/`status`/`statusCode`, the `PERMISSION_DENIED`/`UNAUTHORIZED` error codes, or an `HTTP <status>` message prefix, and renders dedicated permission-denied / sign-in-required copy (all nine locales).

  2. **⌘K / full-page search scope is no longer truncated** (`react`): `maxObjectsQueried` caps the per-object fanout fallback, not the search scope — it used to slice the candidate pool itself, so the `objects` whitelist sent to the platform's `/api/v1/search` only ever named the first 8 nav objects. Which sidebar group came first decided which records were findable; everything later in the nav was unsearchable no matter what the user typed.

  3. **Nav gating fields finally gate** (`app-shell`): `evaluateVisibility` only evaluated `${…}` template strings, so the `{ dialect: 'cel', source }` envelopes the spec normalizes every authored `visible` predicate into fell through to a blanket "visible" — a constant-false predicate still rendered for everyone. It now delegates to `ExpressionEvaluator.evaluateCondition`, which routes CEL envelopes to the canonical `@objectstack/formula` engine. And the sidebars' `requiredPermissions` check treats a bare name as an ADR-0066 system capability (union of the user's permission-set `systemPermissions` from `/me/permissions`) — the same subset rule the server applies to `AppSchema.requiredPermissions` — instead of misreading it as `can(<name>, 'read')`, which had degraded `requiredPermissions` into a hide-from-everyone switch (admins included). The `object:action` form and the legacy object-read fallback keep working.

- 7f0252e: fix(list,data-objectstack,types): exporting a searched list no longer downloads the unsearched superset

  The server-streamed export mirrored the view's `filter` and `sort`, and the
  code comment claimed that made the file match the screen:

  > Mirrors the active view's filter + sort so the exported file matches what the
  > user sees.

  It mirrored one half. There was no way to carry the term a user had typed into
  the search box — `ExportDownloadRequest` had no field for one — so exporting
  during a search produced **more rows than the list showed**, in a file that
  looks authoritative, with nothing indicating the difference. The client-side
  fallback was always correct (it serializes the already-searched `data`); only
  the server path was wrong, and it is the one that handles xlsx.

  Same family as a dropped filter (objectstack#3948, objectstack#4181): a
  plausible answer that is quietly broader than the one asked for.

  - `ExportDownloadRequest` gains `search` / `searchFields`.
  - `ObjectStackAdapter.exportDownload` sends them as `search=` / `searchFields=`,
    trimming the term and omitting both when it is blank (`searchFields` alone
    means nothing).
  - `ListView` passes the active `searchTerm` and the view's `searchableFields`,
    and both are now in the export callback's dependency array — a stale closure
    would export the wrong row set.

  Requires a server with objectstack#4230. Older servers ignore unknown query
  params on this route, so they keep today's behaviour rather than erroring.

  **Also: the filter merge is no longer written twice.** The three filter sources
  (view filter, filter-panel group, per-field user filters) were merged by
  verbatim copies in the data fetch and in the export — two copies that must
  agree, deciding respectively what the user _sees_ and what they _download_.
  Both now call `buildEffectiveFilter`. This is a pure extraction: the copies did
  agree, and the four parity tests added for it pass against the old code too.
  They exist to keep it that way — the adapter's duplicated filter-shape check
  had already drifted apart unnoticed (#3072).

- c4d7b20: fix(view,list,core): a view's filter no longer disappears, or arrives as a predicate on columns that don't exist

  Sweeping the other `$filter` producers after #3078 turned up two live defects in
  `ObjectView`, which fetches its own data for calendar / kanban / gallery /
  timeline (grid delegates to `ObjectGrid`).

  **1. An object filter was dropped, and only for non-grid views.**
  `table.defaultFilters` is declared `Record<string, any>`, and the merge tested
  `baseFilter.length > 0` — `undefined > 0` for an object. So the filter vanished
  and the view returned **every record**. `ObjectGrid` assigns the same value
  straight to `params.$filter`, so one view definition filtered correctly as a
  grid and returned everything as a calendar.

  **2. Rule objects were spread into the `and`, not wrapped.**
  `['and', ...baseFilter, ...userFilter]` is only correct when the source is an
  array of AST nodes. `activeView.filter` is a spec `ViewFilterRule[]`, so
  spreading put bare rule objects where the AST expects nodes:

  ```js
  isFilterAST([
    "and",
    { field: "stage", operator: "eq", value: "won" },
    ["owner", "=", "me"],
  ]);
  // false → 400 since objectstack#4121
  parseFilterAST(same);
  // {$and:[{field:'stage',operator:'eq',value:'won'}, {owner:'me'}]}
  ```

  That second line is a predicate over three columns named `field`, `operator`
  and `value` — which don't exist.

  > **Correction.** The first version of this note said the spread was "reachable
  > whenever a view with a filter meets a user filter value". That was wrong for
  > `ObjectView`: the branch required a non-empty user filter, and nothing ever
  > wrote the state it was built from, so it could never run. The shape is
  > genuinely broken — a live server answers it with a 400 — and the adapter-level
  > defence added alongside is still warranted for any producer that emits it, but
  > **this particular site was dead code, not a live defect.** Defect 1 above was
  > live: it sat on the always-taken path. The dead machinery behind the wrong
  > claim is removed in a follow-up.

  New in `@object-ui/core`: `toFilterNode` normalizes one source (rule array / AST
  / MongoDB object) and `mergeFilterNodes` combines sources as siblings under one
  `and`. `ObjectView` and `ListView.buildEffectiveFilter` both use them, so the
  three filter shapes are reconciled in one place instead of by hand at each
  renderer.

  `ObjectStackAdapter` also now translates a bare rule object sitting directly
  under a logical node — the chokepoint defence for any producer still emitting
  the spread shape. Only rule-_shaped_ objects are touched; a child with no
  `field` is a genuine MongoDB condition and passes through untouched.

  **Correcting a comment shipped in #3078.** `buildEffectiveFilter` documented the
  dropped-object case as unreachable, "nothing in this repo produces one for a
  list view". That was wrong: `ObjectView` passes `mergedFilters` straight into
  that schema's `filter`, and its last fallback is `table.defaultFilters`. The
  case is now handled rather than explained away.

  Verified with 19 tests across the four packages; reverting each source file
  fails the ones that cover it. Emitted filters are asserted against the spec's
  own `isFilterAST` / `parseFilterAST`, including an executable pin on what the
  old spread shape produced.

- 2d5d594: fix(list,detail): sorting a lookup column no longer orders by an invisible key — #3096

  A relational column (`lookup` / `master_detail` / `user` / `tree`) never holds
  the string its cell shows: it holds the `$expand`-ed record, or a raw foreign-key
  id whose label was resolved separately. Every sort path took that raw value as
  its key, so the column of names came back in an order with no relation to the
  names — sorting looked broken, with nothing saying the key was something else.

  The two halves are fixed differently, because they can order by different things:

  - **Client-side sorts** (grid column headers, any `data-table`, a non-windowed
    related list) now key off the label the cell renders, via the new
    `getSortValue` / `compareSortValues` in `@object-ui/core` — which resolves an
    expanded record through `getRecordDisplayName` (ADR-0079), so the sort key and
    the lookup cell agree on which field names a record. This replaces two broken
    comparators: `a[col] < b[col]` is always false between two objects (the
    comparator collapsed to a constant and permuted the rows), and
    `String(a[col])` is `"[object Object]"` (every row compared equal, so the sort
    silently did nothing).
  - **Server `$orderby` sorts** cannot be fixed here — the key is the stored id by
    construction, and `objectstack#4256` settled that no relation join is coming.
    So those entry points stop offering the illusion: the ListView toolbar sort
    picker withholds relational fields and explains why (pointing at a formula
    field as the supported way to sort by a related name), and a windowed related
    list renders no sort button for them.

  A relational field the view's CURRENT sort already uses stays listed, labelled
  `(by ID)`, so view metadata authored or saved with such a sort round-trips
  instead of rendering a blank row and losing the sort on the next edit.

## 17.0.0

### Minor Changes

- 2735de6: feat: render the server's effective API operation set (#3391 PR-4)

  The frontend now consumes the per-object **effective API operation set** the
  server resolves (from `/me/permissions` `apiOperations`, framework #3391) —
  never the raw `apiMethods` — so Import/Export/New/Edit/Delete buttons match what
  the server will actually admit, and a 405 import refusal shows a dedicated
  message instead of silently falling back.

  - **core** `resolveCrudAffordances(obj, effectiveApiOperations?)` — new optional
    second argument intersects each affordance bit with its API operation
    (create/import→create/import, edit→update, delete→delete, exportCsv→export).
    Omitting it (old backend / no effective set) leaves affordances unchanged.
  - **permissions** — `/me/permissions` response carries per-object
    `apiOperations`; `PermissionContextValue.getObjectApiOperations(object)`
    exposes it (undefined when absent → callers keep current behavior); `check()`
    maps `import→allowCreate`, `export→allowRead`.
  - **app-shell** `ObjectView` intersects its toolbar affordances with the object's
    effective operations (Import); the platform-admin identity-import bypass is
    unaffected.
  - **plugin-list** `ListView` / **plugin-grid** `ObjectGrid` gate the Export
    button (and export handler) on effective `export`; `plugin-grid` gains the
    `@object-ui/permissions` workspace dependency.
  - **plugin-grid** `ImportWizard` — a 405 / `OBJECT_API_METHOD_NOT_ALLOWED`
    import refusal is detected by a new `isImportNotAllowed` predicate at every
    catch site (async, sync, dry-run) and STOPS with a dedicated
    `grid.import.notAllowed` message (10 locales + fallback dict) — it never falls
    back to the sync/legacy path (which 405s too), distinct from the 404
    route-absent fallback.

  Backward-compatible: a missing effective set (unrestricted object, older
  backend, or no permission provider) preserves the current default-allow
  behavior everywhere.

- ba45145: feat: gate list row Edit/Delete and bulk delete on the server's effective operation set (#3720)

  The **fourth** surface #3391 left open. The three earlier rounds — the toolbar
  (objectui#2823), detail/form (#3546, objectui#2832 + #2876) and related lists
  (#3546) — all route through `resolveCrudAffordances`. The main list's **row
  CRUD** does not: it has its own resolver (`plugin-grid`'s
  `resolveRowCrudAffordances`), so none of those rounds ever reached it.

  Its gate was `operations ?? { update: !!onEdit, delete: !!onDelete }` — and
  `ObjectView` wires `onEdit`/`onDelete` unconditionally while view JSON rarely
  declares `operations`, so it was effectively always-on. A caller whose effective
  set carried neither `update` nor `delete` still got the row kebab's Edit/Delete
  **and** the bulk delete, the most destructive affordance on the list.

  - **plugin-grid** `resolveRowCrudAffordances` now takes `managedBy` and
    `effectiveApiOperations` and resolves the object verdict through the shared
    `resolveCrudAffordances` policy — so the row gate is the SAME decision the
    toolbar, record header, form and related lists make. It also returns
    `objectCanDelete`, the object-level delete verdict that bulk delete gates on
    (bulk rides `onBulkDelete`, a different callback from the row `onDelete`).
  - **plugin-grid** `ObjectGrid` threads its existing `effectiveApiOps` — until
    now fed only to Export — into the row gate, and applies the delete verdict to
    bulk delete: the implicit `['delete']`, an author-declared
    `bulkActions: ['delete']`, and any `bulkActionDefs` entry with
    `operation: 'delete'`. A declared bulk action is a _wiring_ declaration, not a
    permission grant. Custom action ids and non-delete operations pass through
    untouched.
  - **plugin-list** `ListView`'s own bulk bar (the non-grid views — kanban /
    calendar / gallery; the grid path delegates to `ObjectGrid`) drops its
    built-in `delete` under the same verdict.

  Also closes the ADR-0103 gap on this chain: `rowCrudAffordances` documented the
  bucket lock as "applied upstream via the view's `operations.*`", but the
  all-open default meant it never was — an engine-owned `system` / `append-only` /
  `better-auth` object leaked a generic row Edit/Delete that the engine rejects
  (`assertEngineOwnedWriteAllowed`). Running the shared policy applies it, and a
  `userActions` opt-in still re-opens it (e.g. `sys_user`'s `edit`).

  Same semantics as the earlier rounds: **intersection, never union** — a server
  grant cannot re-open what the bucket or `userActions` closed, and a
  `userActions` opt-in cannot survive a server denial. A missing effective set
  (unrestricted object, older backend, or no `PermissionProvider`) preserves the
  current behavior.

- cd09a7b: refactor(views): ListView reads the spec-canonical `columns`, with legacy `fields` folded in one normalizer (#2890 scope A step 1)

  `ListViewSchema` has been derived from `@objectstack/spec/ui` since #2231, but
  the renderer still spoke objectui's own vocabulary for the same concepts. First
  rename closed: **`fields` → `columns`**.

  Legacy acceptance does not disappear — stored view metadata in user databases
  carries `fields` — but it now lives in exactly one place instead of being
  re-implemented per read-site:

  - **New `normalizeListViewSchema` (`@object-ui/core`)** folds `fields` into
    `columns` (canonical wins when both are present) and drops the legacy key, so
    a read-site that was missed fails loudly instead of quietly taking the legacy
    path. It also absorbs the `viewType` renderability default ListView applied
    inline. Non-mutating, idempotent, and returns its input by reference when
    there is nothing to fold, so ListView's downstream memos keep a stable
    dependency identity.
  - **`ListView` normalizes once at the component boundary**, before anything
    reads the schema. This is what guarantees the fold runs: nothing on the render
    path parses view metadata through zod (the zod schemas serve the CLI
    validator, the VS Code extension and tests), so a `z.preprocess` on
    `ListViewSchema` — spec-side or local — would never execute.
  - **Producers emit `columns`**: `ObjectView`'s `renderListView` payload,
    `ObjectDataPage`, `InterfaceListPage` and the `list-view` registry defaults
    had been _downgrading_ already-canonical `columns` config back to `fields`.

  Two latent inconsistencies go away with it: the filter builder's
  objectDef-not-loaded fallback now resolves `ListColumn.field` (it read only
  `name`/`fieldName`, so object-form columns produced unnamed filter entries), and
  the column list no longer depends on which of the two keys a host happened to
  emit.

  `fields` stays declared on `ListViewSchema` and in the drift guard's sanctioned
  set — it is still valid input, and `@objectstack/spec`'s `react-blocks.ts`
  sanctions it as the React-tier `<ListView fields>` prop — but it is input-only.

- f1abf0e: fix(views): ListView reads the spec-canonical `filter`, so a view's base filter reaches every visualization (#2890 scope A step 4)

  Third rename in the ListView vocabulary migration: **`filters` → `filter`**. Unlike
  the first two this closes a live bug, because the fork was asymmetric.

  `ListView` was the **only** surface in the repo reading `filters`. Every child
  view — `ObjectGrid`, `ObjectGallery`, `ObjectKanban`, `ObjectCalendar`,
  `ObjectGantt`, `ObjectMap`, `ObjectTree`, `ObjectChart` — reads `filter`, and
  `ListView` handed them `filters`. Wherever a child fetches its own rows instead
  of receiving `ListView`'s, the view's base filter was silently dropped:

  - **a `chart` list view aggregated the whole object.** The chart branch built an
    `object-chart` node with `filters:`; `ObjectChart` reads `schema.filter` and
    never read `filters`, so a chart view with a base filter charted unfiltered
    totals.
  - the same applied to any of the other view components rendered standalone from
    a list-view-shaped config.

  Conversely, a **spec-authored** list view — one carrying `filter`, which is what
  the spec says and what `runtime-metadata-persistence` and "Save as view" already
  persist — rendered **unfiltered** in `ListView`, because nothing read that key.

  The fold is a key rename only. Both keys carry an ObjectQL FilterNode array
  everywhere in objectui; every consumer passes the value straight to `$filter`.
  (The spec types `filter` as `ViewFilterRule[]` — `{field, operator, value}`
  objects — so objectui's field is typed from the spec but used as something else.
  That mismatch is real and left alone here: converting formats inside a
  vocabulary fold would change what reaches the data source.)

  Also collapses a duplicated computation in `app-shell`'s `ObjectView`, which
  computed the same effective filter **twice** — once as `filter` for the child
  views, once as `filters` for `ListView` — with the two copies subtly different
  (only one fell back to `listSchema.filter`; only the other ran token
  substitution over the URL filters). There is now one computation, keeping both
  behaviors.

  `filters` stays declared on `ListViewSchema` and in the drift guard's sanctioned
  set — stored views carry it and it is still valid input — but it is input-only.

- f05b84e: refactor(views): ListView resolves density from the spec-canonical `rowHeight` (#2890 scope A step 2)

  Second rename in the ListView vocabulary migration: **`densityMode` → `rowHeight`**,
  folded in the same `normalizeListViewSchema` that step 1 introduced.

  Unlike `fields`/`columns` this is not a pure alias — the two vocabularies are
  different sizes. The spec has five row heights (`compact`/`short`/`medium`/
  `tall`/`extra_tall`); ListView's toolbar offers three densities
  (`compact`/`comfortable`/`spacious`). Both directions now live in one place as
  `DENSITY_MODE_TO_ROW_HEIGHT` / `ROW_HEIGHT_TO_DENSITY_MODE`, chosen so a fold
  followed by a read is a round trip (`spacious` → `tall` → `spacious`), with the
  narrowing collapse (`short` → `compact`, `extra_tall` → `spacious`) stated once
  instead of being re-derived per call site.

  Two behavior fixes fall out of it:

  - **Precedence is no longer inverted.** `ListView` read `densityMode` _first_, so
    a view carrying both keys rendered the legacy value — backwards from every
    other legacy/canonical pair in the schema. The canonical key now wins.
  - **The toolbar stops re-seeding the legacy key.** `ObjectView`'s
    `onDensityChange` persisted `densityMode` into stored view metadata on every
    density toggle, so the legacy vocabulary kept regrowing underneath the
    migration. It persists `rowHeight` now.

  `densityMode` stays declared on `ListViewSchema` and in the drift guard's
  sanctioned set — stored views carry it and it is still valid input — but it is
  input-only.

### Patch Changes

- ab46110: fix(list): show the real match total in the record-count status bar under server pagination

  The Airtable-style record-count bar read `data.length`, but under server-side
  pagination (#2212) `data` is only the current page window — so a 158-row result
  paginated 100/page reported "100 条记录" on page 1 and "58 条记录" on page 2,
  never the true total. There was no other place to see how many records the
  query matched.

  The bar now shows the server's grand total (`serverTotal`) when known, falling
  back to `data.length` when the whole result set is in memory (non-paginated,
  grouped and non-grid views are unchanged — `serverTotal` is null there, so the
  count is identical to before). Browser-verified against the showcase contacts
  list: the bar reads "158 条记录" and stays stable across pages, and switching to
  grouped/other views correctly resets to the loaded count.

- 7d46648: fix(hooks): stop calling translation hooks inside try/catch (objectui#2879)

  Eleven call sites wrapped a React hook in `try`/`catch` to make it
  "provider-safe". `useObjectTranslation` and `useObjectLabel` already are — they
  read context optionally and fall back to react-i18next's global instance, and
  never throw. The `catch` bought nothing and cost correctness: a throw _after_
  the hook ran desyncs hook order on the next render, because React matches hooks
  positionally. objectui#2595/#2596 fixed exactly this in `@object-ui/i18n`'s
  `createSafeTranslation`; nine plugin-local re-implementations kept their own
  copy of the bug, and two more (`ObjectTimeline`, `ObjectView`) were found by the
  new lint rule below — `ObjectView` had even suppressed
  `react-hooks/rules-of-hooks` inline to keep it.

  - Six exact re-implementations now delegate to `createSafeTranslation`:
    `plugin-detail`, `plugin-timeline`, `plugin-list`, `plugin-calendar`,
    `plugin-grid`'s `ObjectGrid`, `plugin-designer`.
  - `components`' `data-table` also delegates; `createSafeTranslation` now
    returns `language` alongside `t` so consumers that localize dates don't need
    a second hook call. Purely additive.
  - `plugin-gantt` and `plugin-grid`'s `ImportWizard` keep their local hooks —
    they fall back _per key_, which a single-probe factory cannot express and
    which their comments justify (a host dictionary that covers common keys but
    lags on newer ones). Only the `try`/`catch` is removed.
  - `ObjectTimeline` and `ObjectView` call the hook directly and probe the
    returned value, mirroring `useSafeFieldLabel`.

  Adds `object-ui/no-try-catch-around-hook` (error) so a twelfth copy fails CI.
  It only matches `use*` names, accepts member calls solely on `React` (so
  `vi.useRealTimers()` is not a hook), and resets its try-depth inside nested
  functions (so `renderHook(() => useThing())` inside a `try` is fine) — both
  false positives were real code in this repo and are pinned in the rule's tests.

  `eslint-rules/**/*.test.js` matched no vitest project glob, so the local
  plugin's specs had never run in CI. They are now included; all three pass.

  `ObjectTimeline`'s test mock of `@object-ui/react` omitted `useObjectLabel` —
  the removed `try`/`catch` had been silently absorbing that gap. The mock is now
  complete.

- 8aae006: fix(views): the five per-view-type configs speak the spec vocabulary (#2231 phase 3)

  `kanban`/`calendar`/`gantt`/`gallery`/`timeline` on `ListViewSchema` were the last
  hand-written forks left after #2882 — and the fork was not cosmetic: objectui named
  the same concepts differently from `@objectstack/spec/ui`, and several read-sites
  only understood one of the two dialects. Two of those gaps were live bugs.

  **Kanban lanes ignored the spec key.** `ListView` gated the Kanban tab on
  `groupByField || groupField` but rendered lanes off `groupField` alone. A config
  authored with the spec key — which is exactly what the product's own
  `CreateViewDialog` emits — offered the tab and then grouped by whatever
  `detectStatusField()` guessed. The spec's `columns` (the fields shown on each card)
  was also spread onto the board verbatim, where `columns` means _lanes_, so
  `ObjectKanban` built lanes with `undefined` id and title. `columns` now maps to
  `cardFields` and the vocabulary keys are stripped from the passthrough.

  **Timeline lost every spec key in app-shell.** `ObjectView`'s `timeline` branch was
  a three-key whitelist while its `gallery`/`gantt` siblings had already been fixed to
  spread-first, so a stored `timeline: { startDateField, endDateField, groupByField,
colorField, scale }` arrived with only `titleField` and an axis pinned to the
  `'due_date'` fallback.

  Also: `plugin-view`'s `ObjectView` now reads `gallery.coverField` and
  `timeline.startDateField` (it only understood the legacy aliases), and the dead
  `gallery.subtitleField` is removed — three producers computed it and `ObjectGallery`
  never read it.

  The schema side now derives from the spec configs (`.partial()`, since the product
  authors partial configs and spec marks `columns`/`titleField`/`startDateField`
  required). `gantt` needed no local schema at all. The pre-#2231 names
  (`groupField`, `cardFields`, `imageField`, `dateField`) remain accepted as deprecated
  aliases so stored views keep validating; the spec key wins wherever both appear.
  `calendar.defaultView` stays local — it has no spec counterpart.

- Updated dependencies [7b21891]
- Updated dependencies [0b3be01]
- Updated dependencies [3c4d935]
- Updated dependencies [4b1ed7d]
- Updated dependencies [4b60d2d]
- Updated dependencies [952b978]
- Updated dependencies [de5e40c]
- Updated dependencies [1a03af6]
- Updated dependencies [3e886eb]
- Updated dependencies [cfc675e]
- Updated dependencies [20df08c]
- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [af705b9]
- Updated dependencies [0502a7c]
- Updated dependencies [7b35e4b]
- Updated dependencies [8fb1295]
- Updated dependencies [e16ed2d]
- Updated dependencies [c6fd752]
- Updated dependencies [f9bbddb]
- Updated dependencies [dfd3705]
- Updated dependencies [c77108c]
- Updated dependencies [2735de6]
- Updated dependencies [697cda4]
- Updated dependencies [c19ac11]
- Updated dependencies [6dee2cb]
- Updated dependencies [e05f052]
- Updated dependencies [0502a7c]
- Updated dependencies [faad45e]
- Updated dependencies [09c6a17]
- Updated dependencies [c7cff19]
- Updated dependencies [ba73a02]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [9b4b952]
- Updated dependencies [341bfb5]
- Updated dependencies [2f947e4]
- Updated dependencies [7d46648]
- Updated dependencies [9b53d72]
- Updated dependencies [bb4aa25]
- Updated dependencies [75f1cdf]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [c6cfdf1]
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [263f885]
- Updated dependencies [dc334da]
  - @object-ui/components@17.0.0
  - @object-ui/i18n@17.0.0
  - @object-ui/fields@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/core@17.0.0
  - @object-ui/permissions@17.0.0
  - @object-ui/mobile@17.0.0

## 16.1.0

### Patch Changes

- ebe6494: chore(lint): clear the baseline lint errors in nine more packages (objectui#2713 Wave 2)

  Second wave of the #2713 lint-gate restoration (after #2730). These nine package
  lints were red at baseline on `main`, so their per-package `lint` gate could not
  catch new violations. Cleared every **error** (no behavior change; warnings out
  of scope):

  - **`react-hooks/rules-of-hooks`** (`i18n`, `plugin-grid`, `plugin-view`,
    `plugin-list`) — translation helpers (`useSafeFieldLabel`,
    `useRowActionTranslation`, `useViewLabel`, `useViewTabLabel`, `useMoreLabel`)
    wrapped a provider-safe hook (`useObjectTranslation`/`useObjectLabel`, which
    never throw) in try/catch; removed the wrapper (the same fix #2709 applied in
    fields). `plugin-kanban` `ObjectKanban` moved its `if (error)` early return
    below the `useCallback` so hooks run unconditionally. `collaboration`
    `__unsafe_usePresenceContext` keeps its deliberate danger-prefix name via a
    justified scoped disable.
  - **`react-hooks/static-components`** (`layout`, `plugin-list`, `plugin-report`)
    — dynamic-icon / registry lookups (`resolveIcon`, `useRegistryComponent`) are
    stable component references, not components created during render → scoped
    disable with justification. `plugin-charts` `TreemapCell` was a _genuine_
    inline component and is hoisted to module scope (it is purely props-driven).
  - **`no-irregular-whitespace`** (`plugin-grid` `ImportWizard`) — the literal
    U+FEFF BOM prepended to exported CSV/text blobs (so Excel detects UTF-8) is
    now written as the `﻿` escape: byte-identical at runtime, no literal
    irregular-whitespace character in source.
  - **`no-useless-assignment`** (`plugin-grid` `BulkActionDialog`) — dropped a
    dead `= null` initializer that the exhaustive `switch` (incl. `default`)
    overwrites before it is read.
  - **`no-unsafe-function-type`** (`plugin-view` `ViewTabBar`) — the dnd-kit
    render-prop `listeners` map is typed `Record<string, (...args: any[]) => void>`
    instead of bare `Function`.
  - **`no-require-imports`** (`plugin-kanban`, `plugin-view` tests) — hoisted
    `vi.mock` factories use an `async` factory with `await import('react')`.

## 16.0.0

### Patch Changes

- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [ca0f5f0]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0
  - @object-ui/i18n@16.0.0
  - @object-ui/fields@16.0.0
  - @object-ui/core@16.0.0
  - @object-ui/mobile@16.0.0
  - @object-ui/permissions@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/i18n@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0
- @object-ui/fields@15.0.0
- @object-ui/permissions@15.0.0
- @object-ui/mobile@15.0.0

## 14.1.0

### Minor Changes

- dea65f7: Unify the list-view conditional tier onto the canonical CEL engine (#1584).

  Conditional formatting (list / grid / kanban) and row-action `visible` /
  `disabled` predicates are now evaluated by `@objectstack/formula`'s
  `ExpressionEngine` — the same engine the server uses — instead of the legacy
  JS-dialect `ExpressionEvaluator`, matching how `@objectstack/spec` already types
  these surfaces (`ExpressionInputSchema` / CEL). The whole platform now speaks one
  expression dialect (framework ADR-0058).

  - `@object-ui/core`: new `evalRowPredicate` + `resolveConditionalFormatting`
    helpers (next to `evalFieldPredicate`). One implementation of all three
    formatting rule shapes; dialect routing (a `{ dialect: 'cel' }` envelope is
    always CEL; a bare string is CEL unless it carries legacy-only syntax
    (`${…}` / `===` / `?.` / `.includes()`), which routes to the old engine with a
    one-time deprecation warning); the native `{ field, operator, value }` form is
    translated to CEL.
  - `@object-ui/react`: new `useRowPredicate` hook (canonical CEL, ambient
    predicate scope merged).
  - Consumers converged: `ListView.evaluateConditionalFormatting` (thin wrapper,
    export kept), `ObjectGrid` row styling (inline copy removed), kanban card
    styles, and the grid / data-table row-action menus. `plugin-view`'s kanban
    branch now forwards top-level `conditionalFormatting` (previously dropped).
  - Row-action `visible` fails **closed** (broken predicate → hidden + warn);
    `disabled` fails soft. The CEL `in` operator (and list membership) now work in
    row predicates — the legacy engine could not parse them.
  - The legacy `FormField.condition: { field, equals/notEquals/in }` is retired to
    a CEL translation (back-compat preserved); `FieldDesigner` migrated to
    `visibleWhen`.

  Fully back-compat: existing conditional-formatting rules, row-action predicates,
  and form `condition` metadata keep working (translated / routed as needed).

- f0f10f5: feat(kanban): default lane field honours the ADR-0085 `stageField` role

  Kanban views without an explicit `groupByField`/`groupField` hard-coded their
  lane field to the literal `'status'` (in both app-shell's ObjectView options
  and plugin-list's ListView fallback) — ignoring the object's declared
  lifecycle and even inventing a field the object doesn't have. The default now
  resolves through the shared `stageField` detector:

  1. explicit view config (unchanged, always wins);
  2. the object's `stageField` semantic role;
  3. `stageField: false` → **no default lanes** (the status-shaped field is
     declared non-linear; the board renders its empty state until the view
     picks a lane field explicitly);
  4. else the shared name/type heuristic (status / stage / state / phase by
     name, then status/stage by type) — never a nonexistent field.

  `detectStatusField` moved from `@object-ui/plugin-detail` to
  `@object-ui/types` (new export, with the `StatusFieldSource` input type) so
  plugin-list and app-shell share the exact semantics; plugin-detail re-exports
  it unchanged.

  Also fixes ListView's pre-existing rules-of-hooks error while touching the
  file: `useListFieldLabel` wrapped `useObjectLabel()` in try/catch (hook-order
  desync risk; the hook is provider-safe) — same fix as objectui#2595's
  `useFieldLabel`.

  Behavior change is limited to kanban views with no explicit lane field on
  objects that either declare `stageField` (now honoured), declare
  `stageField: false` (now suppressed), or have no status-shaped field at all
  (previously grouped by a nonexistent `status` into one "undefined" lane; now
  an honest empty state). Objects with a real `status` field — the common case —
  are unchanged.

### Patch Changes

- 4b0aee6: Fix: a view declaring its `sort` in the `@objectstack/spec` bare-string
  top-level form (`sort: "name desc"` — `ListViewSchema.sort` is
  `string | Array<{field, order}>`) crashed ListView with
  "schema.sort.map is not a function". Found by the spec/renderer
  shape-mismatch audit that followed the dashboard filter-options crash.
  Sort parsing is now a single normalized `parseSortConfig` (exported) that
  accepts the bare string, legacy `"field desc"` array entries, and
  `{ field, order }` objects, and returns `[]` for malformed entries instead
  of throwing. The `@object-ui/types` declaration already carried the union —
  only the implementation missed the string branch.

## 14.0.0

### Patch Changes

- 05e56ca: 导出/导入模板的下载文件名与内容本地化。

  **导出文件名**:CSV/Excel/JSON 导出下载不再是 `<对象名>.<扩展名>`(如 `contracts.csv`),改为「对象显示名-视图名-时间戳.扩展名」(如 `任务-In Progress-20260714-153045.xlsx`);`exportOptions.fileNamePrefix` 配置仍优先(且作为完整前缀,不再追加视图名)。视图名与对象名重复时自动省略;`@object-ui/core` 新增 `buildExportFileName(ext, { prefix, label, objectName, viewLabel }, now?)` 与 `sanitizeFileNameBase(raw)`,ObjectGrid 与 ListView 的所有导出路径(服务端流式与前端兜底)统一走它。app-shell/plugin-view 的 ObjectView 现将当前视图的显示标签写进传给 ListView 的 schema(`label`),使导出文件名能区分同一对象的不同保存视图。

  **导入模板**:「下载模板」修复两处英文漏出——示例行的 select/多选取值改为优先取选项**显示标签**(如 `准备中`)而非 ASCII slug(`prepare`,服务端导入两者都接受);模板文件名本地化为 `{{object}}-导入模板.csv`(新增 i18n key `grid.import.templateFileName`,英文回退 `{{object}}-import-template.csv`)。

- b66d8ee: The list toolbar search button now shows the active keyword inline (mirroring
  the Sort button's count badge). Previously a search term restored from
  localStorage after navigating away and back kept filtering the list while the
  search popover stayed collapsed — the only cue was a slightly darker magnifier
  icon, so users couldn't tell a keyword filter was still active. The keyword is
  rendered (truncated at 8rem) next to the magnifier whenever a search is active,
  and clicking it opens the popover pre-filled for editing or clearing.
- Updated dependencies [443360a]
- Updated dependencies [c70bca7]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [a44e7b6]
- Updated dependencies [5971cc4]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/i18n@14.0.0
  - @object-ui/react@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/components@14.0.0
  - @object-ui/fields@14.0.0
  - @object-ui/mobile@14.0.0
  - @object-ui/permissions@14.0.0

## 13.2.0

## 13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [9e38270]
- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/i18n@13.0.0
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/fields@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0
  - @object-ui/mobile@13.0.0
  - @object-ui/permissions@13.0.0

## 12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e36a9c7]
- Updated dependencies [e4de456]
- Updated dependencies [68e2d1c]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/fields@12.0.0
  - @object-ui/mobile@12.0.0
  - @object-ui/permissions@12.0.0
  - @object-ui/react@12.0.0
  - @object-ui/i18n@12.0.0

## 11.5.0

## 11.4.0

## 11.3.0

## 11.2.0

## 11.1.0

## 7.3.0

## 7.2.0

## 7.1.0

## 7.0.0

### Minor Changes

- 053c948: feat: ADR-0047 — interface pages, visualization switcher, and Airtable-parity filters

  End-user interface/list pages reach full rendering and authoring parity:

  - **Spec tabs + visualization switcher** — `ObjectView` now forwards
    `viewDef.tabs` (stored/served but never rendered) and `viewDef.appearance`
    (`allowedVisualizations` whitelist), turning on the dormant `ViewSwitcher` when
    more than one type is whitelisted; effective options = author whitelist ∩
    capability-resolvable types (kanban needs `groupBy`, calendar a date field, …).
    `ListView` accepts the canonical `ViewFilterRule[]` tab-filter shape.
  - **User filters** — render only when `userFilters` is explicitly configured;
    selections (dropdown values + active tab) mirror into `uf_*` URL params and
    restore on load, so filtered lists survive reload and are shareable.
  - **Toolbar polish** — the visualization switcher becomes a compact right-side
    "Grid ▾" dropdown inside the tool cluster (no extra row); filter tabs and
    dropdown filters are mutually exclusive.
  - **Studio authoring** — a usable, schema-driven interface-page inspector
    (collapsible sections honoured, array-of-enum → multi-select, a None/Tabs/
    Dropdown `filter-mode` selector where None maps to ABSENCE of `userFilters`),
    and the Design/Preview tabs render the live list via `InterfaceListPage`
    (including a non-empty grid when the source view is hollow).

- 4eb9cb6: feat(plugin-tree): add a `tree` / tree-grid object view type

  Renders a self-referencing object as an indented, expand/collapse tree-grid —
  the right view for arbitrary-depth hierarchies (business unit / org chart,
  category trees, BOMs, nested comments) that fixed-depth grouping can't express.
  New `@object-ui/plugin-tree` package (`object-tree`/`tree`), `tree` added to the
  `ViewType` union, and dispatch wired through plugin-list `ListView` +
  app-shell `ObjectView` (the console path).

### Patch Changes

- 053c948: fix(plugin-list): gate speculative `$select` fields by the object's real schema

  A list view auto-includes view-binding fields (kanban `groupBy`, calendar/gantt/
  timeline dates, gallery image, timeline status/priority) in `$select` so
  alternate view modes render populated. These were added unconditionally on the
  assumption that "the projection ignores unknown names" — but some backends
  (notably the cloud multi-tenant runtime) reject an unknown `$select` column with
  an EMPTY result set, so a single phantom field zeroed the whole list (an AI-built
  `product` view requesting `status`/`due_date`/`image` showed "no data" though
  rows existed). The speculative additions now go through `addSpeculative()`, which
  keeps only fields present in the object schema; user-declared columns and expand
  roots are untouched.

- db8cd00: feat(app-shell): global settle signal (window.\_\_objectui) + region aria-busy (ADR-0054 Phase 3)

  Adds a single machine-readable "is the app idle?" predicate (ADR-0054 C5). The
  data layer wraps the adapter's `fetch` to count in-flight requests, mirrored onto
  `window.__objectui` with live `idle` / `pendingRequests` getters plus `whenIdle()`
  and `subscribe()`. New `useSettleSignal()` React hook and lower-level exports
  (`getPendingRequests`, `subscribeSettle`, `whenIdle`, `withSettleSignal`,
  `installSettleSignalGlobal`). The list view and record-picker results regions now
  set `aria-busy` while fetching and `data-state="loading|idle"` for region-level
  waiting. Lets an automated (AI) driver wait for settle instead of hardcoding
  timeouts.

- Updated dependencies [5976ba3]
- Updated dependencies [a00e16d]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [053c948]
- Updated dependencies [89e113c]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [77cc6bb]
- Updated dependencies [6c0c92c]
- Updated dependencies [97c6831]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [c09f44e]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [5332639]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [0ad72a6]
- Updated dependencies [bd398df]
- Updated dependencies [3fa23a7]
- Updated dependencies [18d0339]
- Updated dependencies [66ed3ad]
- Updated dependencies [c6445b6]
- Updated dependencies [80c133c]
- Updated dependencies [5e1b838]
- Updated dependencies [59b6bbb]
- Updated dependencies [d16566f]
- Updated dependencies [90acb7f]
- Updated dependencies [7913390]
- Updated dependencies [514f426]
- Updated dependencies [1394e34]
- Updated dependencies [e95cc25]
- Updated dependencies [abe8ebc]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [db8cd00]
- Updated dependencies [2f31406]
- Updated dependencies [18728c1]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/i18n@7.0.0
  - @object-ui/types@7.0.0
  - @object-ui/fields@7.0.0
  - @object-ui/mobile@7.0.0
  - @object-ui/permissions@7.0.0

## 6.2.3

## 6.2.2

## 6.2.1

## 6.2.0

## 6.1.0

## 6.0.4

## 6.0.3

## 6.0.2

## 6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/i18n@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0
- @object-ui/fields@6.0.0
- @object-ui/permissions@6.0.0
- @object-ui/mobile@6.0.0

## 5.4.2

## 5.4.1

## 5.4.0

## 5.3.2

## 5.3.1

## 5.3.0

## 5.2.1

## 5.2.0

### Minor Changes

- fe63b8c: Gallery cards now prefix numeric / currency / percent fields with their
  translated field label.

  The card layout in `ObjectGallery` previously dropped every label,
  relying on each cell renderer to be self-describing. That works for
  status badges, phone links, email links, and dates — but for bare
  numbers a row like `5,000,000 / 250` gives the user no clue whether
  those are revenue, headcount, pipeline value, or close-date.

  We now auto-prepend a small muted field label for the low-semantic
  renderer types (`number`, `currency`, `percent`, `integer`, `decimal`).
  Self-describing types are unchanged. The label is routed through the
  i18n field-label dictionary so authored objects with translated labels
  render consistently with the detail page.

### Patch Changes

- 87bc8ff: `DataEmptyState` (re-exported as `EmptyState`) is now the canonical
  platform primitive for "no records / no data" states. Two new props
  keep it flexible enough to absorb the hand-rolled variants that lived
  in `plugin-list`, `plugin-kanban`, and `plugin-dashboard`:

  - `showIcon?: boolean` — drops the icon container entirely. Used by the
    kanban board-level empty banner, which is a status banner rather than
    a true empty-state.
  - `iconWrapperClassName?: string` — overrides the default muted rounded
    square. Pass `""` to render the icon raw (used by `ListView`'s grid
    empty state, which uses a large standalone glyph).

  Adopters:

  - `plugin-list` (`ListView` grid empty-state) — preserves the existing
    large icon, title, message, add-record button and `data-testid`s,
    but delegates the structural markup to `DataEmptyState`.
  - `plugin-kanban` (board-level "all columns empty" banner) — keeps the
    dashed border + `role="status"` / `aria-live="polite"` semantics.
  - `plugin-dashboard` (`PivotTable` zero-rows branch) — keeps the
    custom 4-quad SVG icon and `pivot-empty-state` test id.

  No public-API change for consumers; the older inline markup is gone
  but the rendered output, translation keys, and test hooks are
  preserved.

- 50cdefd: Gallery cards no longer render a giant gradient letter placeholder when
  the configured `coverField` has no populated values anywhere in the
  dataset. Previously, simply declaring `gallery.coverField` would force
  the cover area on even when every record's image was null/empty, producing
  oversized 200×200 "C" / "A" letter blocks that dwarfed the actual card
  content (the Contact and Account card views in the CRM example were the
  most visible offenders).

  The configured-but-empty state now matches the unconfigured state:
  collapse the cover area, render a compact title-plus-fields card.
  When at least one record in the dataset has a cover image, the cover
  area still renders for all cards so heights stay consistent.

## 5.1.1

## 5.1.0

### Minor Changes

- 8fd863e: Platform highlight + list polish:
  - **deriveHighlightFields**: extended the preferred-field list (close_date, due_date, account, contact, …) and now skips fields whose declared type is not "highlight-friendly" (textarea, markdown, json, boolean, rich-text, etc.). Untyped legacy fields still pass through. Prevents long-form/structural fields from ending up in the highlight strip on objects with sparse metadata.
  - **ListView bulk-action labels**: bulk-action buttons now resolve their labels through `actionLabel(objectName, action, fallback)` so they pick up app-supplied translations under `_actions.<name>.label`, matching the detail-page page-header overflow menu. Falls back to the previous title-cased string when no resource is found.

## 5.0.2

## 5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [8930b15]
- Updated dependencies [95b6b21]
- Updated dependencies [ddb08a7]
- Updated dependencies [765d50f]
- Updated dependencies [927187a]
- Updated dependencies [bae8ba8]
- Updated dependencies [8435860]
- Updated dependencies [bb2ea48]
- Updated dependencies [b14fe09]
- Updated dependencies [a7bef6e]
- Updated dependencies [74962b0]
- Updated dependencies [3154334]
- Updated dependencies [fa4c2cb]
- Updated dependencies [7213027]
  - @object-ui/components@5.0.0
  - @object-ui/i18n@5.0.0
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/fields@5.0.0
  - @object-ui/core@5.0.0
  - @object-ui/mobile@5.0.0
  - @object-ui/permissions@5.0.0

## 4.8.0

### Minor Changes

- 3a17c8d: Mobile UI: aggressive chrome reduction to match real mobile-app conventions.

  Real mobile CRMs (Salesforce, HubSpot, Notion, Linear) keep one row of
  chrome on phones: title + 1 primary action, plus content. We were
  shipping ~5 rows of toolbars + chips + tabs above the data. This commit
  hides the desktop-only chrome at the `<sm` breakpoint:

  - **ListView**: TabBar (view switcher), UserFilters chip row, quick-filters
    chip row, Sort button, list-scoped Search popover, and the
    (newly-added) mobile-only ViewSettingsPopover gear are all hidden on
    phones. Only the **Filter** icon survives on mobile — paired with the
    global ⌘K top-bar search, that is the entire mobile control surface.
  - **Kanban**: previous commit replaced verbose swipe text with a dot
    indicator; that stands.
  - **ObjectView page header**: the Import (CSV upload) button is hidden
    on mobile — CSV import is a desktop workflow.

  Net effect on a 390px viewport: ListView toolbar collapses from
  ~10 controls (5 chips + 5 icons) to a single Filter icon next to the
  title; the body of the page is reachable without scrolling past 3 rows
  of chrome.

  Desktop and tablet behavior is unchanged.

- 51e274a: feat(app-shell,plugin-list): mobile Airtable-style topbar + filter chip row

  Refactor mobile object-view layout to match the Airtable Interface
  pattern:

  - **AppHeader**: the mobile topbar's static page label is now a
    view-switcher dropdown (`<viewName> ▾`). Tapping opens a list of
    available views with icons + active-state checkmark. Falls back to
    plain text when only one view exists, or when the current page has
    no view-switching surface (Home, Settings, …).
  - **ObjectView**: drops the standalone mobile `sm:hidden` view-select
    row that previously lived between the desktop tab bar and the
    content area. View switching is now exposed exclusively via the
    topbar dropdown on mobile, eliminating the duplicated `object name`
    vs `view name` rows.
  - **ListView**: un-hides the `UserFilters` chip row on mobile.
    Single-line, horizontally scrollable, matches the Airtable Interface
    filter chip strip.
  - New lightweight `MobileViewSwitcherContext` provides a
    page → header data channel (no zustand dependency added).

  Net effect on mobile (390×844):

  ```
  ☰ 客户卡片 ▾                🔍 🔔 M    ← topbar
  类型 ▾  行业 ▾  是否活跃 ▾  更多 3 ▾  ⛛  ← chip row
  [content cards]                          ← content
                                    (+)    ← FAB
  [Leads | Accounts | Contacts | …]        ← bottom nav
  ```

- faba0e3: Mobile UX cleanup:
  - `app-shell/AppHeader`: hide the platform-logo, app-switcher pill, and
    intermediate path separators on mobile when inside an app route. The
    sidebar already exposes those affordances; the topbar now reads
    `☰ + page title + Search + Inbox + Avatar`.
  - `plugin-list`: replace the hidden mobile TabBar with a new compact
    `TabBarSelect` dropdown (current view name + chevron → menu of every
    view). Phone users keep view-switching without burning a row on chip
    pills. Desktop continues to render the inline TabBar.

## 4.7.0

### Minor Changes

- 186fb2b: Mobile UI optimization: declutter list & kanban on small screens.
  - **ListView toolbar** now auto-collapses HideFields / Group / Color / Density into a single settings gear at `<sm` breakpoints, even when `compactToolbar` is not enabled. Desktop behavior unchanged.
  - **Kanban board** replaces the verbose "← Swipe to navigate →" caption with a compact dot indicator that tracks which column is currently snapped into view. Hidden when there is only one column.

## 4.6.0

### Patch Changes

- 8f490ad: test(perms): add field-level permission negative tests for DetailView
  and ListView. Mounts each consumer inside a `PermissionProvider` that
  denies read on a specific field and asserts the field never reaches
  the rendered DOM (sections, top-level fields, summary chips,
  constructed list columns). Closes the automated half of the Sprint 3-A
  "Known limitations" — backend enforcement is still required, but the
  client-side defence-in-depth is now regression-tested.

## 4.5.0

### Patch Changes

- 22fa558: Clean up pre-existing TypeScript errors in `plugin-list` and tighten i18n:
  - Switch grouping-editor labels to `t(key, { defaultValue })` option form so i18next's strict types accept the literal fallback.
  - Add the missing `list.addGroup` / `list.collapsedByDefault` / `list.removeGroup` keys to en + zh locale bundles.
  - Drop the dead `currentView === 'list'` branch in `ListView` (local `ViewType` union has `'grid'`, never `'list'`).
  - Widen `UserFilters.resolveFields` `translateOptions` parameter from a generic `<T>` to the concrete option shape so it matches the `useObjectLabel` hook's signature.

## 4.4.0

## 4.3.1

### Patch Changes

- 5f4ac6e: perf(plugin-list): avoid allocating a new schema object every render when the viewType default is unneeded. Stabilizes the downstream `viewComponentSchema` memo so the child SchemaRenderer no longer reconciles on unrelated parent re-renders.

## 4.3.0

## 4.2.1

## 4.2.0

## 4.1.0

## 4.0.12

## 4.0.11

## 4.0.10

## 4.0.9

## 4.0.8

## 4.0.7

## 4.0.6

## 4.0.5

### Patch Changes

- 1dc6061: fix(build): inline dynamic imports in library outputs

  Library `vite build --lib` outputs were emitting separate code-split chunks
  (`rolldown-runtime-*.js`, `LookupField-*.js`, etc.) when source files used
  `React.lazy()` / dynamic `import()`. When consumer apps re-bundled these
  multi-file dists, the library's per-chunk rolldown-runtime collided with the
  consumer's own runtime, causing "TypeError: i is not a function" at runtime
  when lazy components tried to register themselves (e.g. TextField in
  `@object-ui/fields` after 4.0.4).

  Adding `output.inlineDynamicImports: true` to all `@object-ui/*` library vite
  configs forces a single `dist/index.js` per package, which lets consumer
  bundlers handle the library as an opaque ESM module without identifier
  mismatches across chunks.

  Affected packages: components, fields, layout, plugin-aggrid, plugin-ai,
  plugin-calendar, plugin-charts, plugin-chatbot, plugin-dashboard,
  plugin-designer, plugin-detail, plugin-editor, plugin-form, plugin-gantt,
  plugin-grid, plugin-kanban, plugin-list, plugin-map, plugin-markdown,
  plugin-report, plugin-timeline, plugin-view, plugin-workflow.

## 4.0.4

### Patch Changes

- d2b6ece: fix: externalize all bare imports in library builds

  Library builds (vite lib mode) now externalize every non-relative import instead of bundling third-party CJS dependencies into the published dist. This avoids inlined `require("react")` / `require("react-dom")` calls that cause `Calling \`require\` for "react" in an environment that doesn't expose the \`require\` function` runtime errors when consumer apps re-bundle the published dist.

  Specifically fixes:

  - `@object-ui/plugin-dashboard` no longer inlines `react-grid-layout` (and its transitive `react-draggable` / `react-resizable` CJS bundles). `react-grid-layout` is now declared as a peer dependency so consumers install a single ESM-friendly copy.
  - `@object-ui/components`, `@object-ui/plugin-calendar`, `@object-ui/plugin-charts`, `@object-ui/plugin-designer` no longer inline `react-i18next` / `i18next` / `use-sync-external-store` CJS shims.
  - All plugin packages now use a unified `external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname)` rule, ensuring future additions of CJS deps are automatically externalized.

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/i18n@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1
- @object-ui/mobile@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/mobile@4.0.0
  - @object-ui/react@4.0.0
  - @object-ui/i18n@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/mobile@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/react@3.4.0
  - @object-ui/i18n@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/i18n@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2
- @object-ui/mobile@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/i18n@3.3.1
  - @object-ui/react@3.3.1
  - @object-ui/mobile@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/i18n@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0
- @object-ui/mobile@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/i18n@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0
- @object-ui/mobile@3.2.0

## 3.1.5

### Patch Changes

- Updated dependencies [cfe0596]
  - @object-ui/i18n@3.1.5
  - @object-ui/react@3.1.5
  - @object-ui/components@3.1.5
  - @object-ui/types@3.1.5
  - @object-ui/core@3.1.5
  - @object-ui/mobile@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/i18n@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4
- @object-ui/mobile@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/i18n@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3
- @object-ui/mobile@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/i18n@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2
- @object-ui/mobile@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/mobile@3.1.1
  - @object-ui/react@3.1.1
  - @object-ui/i18n@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3
- @object-ui/mobile@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2
- @object-ui/mobile@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
  - @object-ui/types@3.0.1
  - @object-ui/core@3.0.1
  - @object-ui/mobile@3.0.1

## 3.0.0

### Minor Changes

- 87979c3: Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer

### Patch Changes

- Updated dependencies [87979c3]
  - @object-ui/types@3.0.0
  - @object-ui/core@3.0.0
  - @object-ui/react@3.0.0
  - @object-ui/components@3.0.0
  - @object-ui/mobile@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/react@2.0.0
  - @object-ui/components@2.0.0

## 0.5.1

### Patch Changes

- Fixed ListView view preference persistence causing incorrect view rendering.
