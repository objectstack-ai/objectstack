# @object-ui/plugin-view

## 18.1.0

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [5235d6d]
- Updated dependencies [7c405b7]
- Updated dependencies [0093b2c]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [56cf4d8]
- Updated dependencies [b911ebb]
- Updated dependencies [0d12e95]
- Updated dependencies [ff77cfc]
- Updated dependencies [49a536d]
- Updated dependencies [241cb78]
- Updated dependencies [404ccae]
- Updated dependencies [ec627ab]
- Updated dependencies [b93c9f6]
- Updated dependencies [d019aaa]
- Updated dependencies [0f4adc3]
- Updated dependencies [fa31856]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [d9aff15]
- Updated dependencies [4eeb174]
- Updated dependencies [afcf654]
- Updated dependencies [2c3dc72]
- Updated dependencies [2958f17]
- Updated dependencies [a78608f]
- Updated dependencies [1d178e0]
- Updated dependencies [2c4e5f5]
- Updated dependencies [6fb31dc]
- Updated dependencies [fbb4b23]
- Updated dependencies [c8f8b10]
- Updated dependencies [ad74e98]
  - @object-ui/types@18.1.0
  - @object-ui/plugin-grid@18.1.0
  - @object-ui/components@18.1.0
  - @object-ui/i18n@18.1.0
  - @object-ui/react@18.1.0
  - @object-ui/permissions@18.1.0
  - @object-ui/core@18.1.0
  - @object-ui/plugin-form@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- 9fc68aa: Screen readers can name and reach the controls of the view tab bar, the settings form, the sidebar menus, the table's selection column and the percent cell (objectui#11690). axe-core (wcag2a + wcag2aa) on an object list page and on a Setup settings page reported the faults below; each is fixed where it is produced and pinned by an axe run on that component.
  
  - **View tab bar (`ViewTabBar`).** The "+" add-view button is named, through the existing `view.addView` key, and its tooltip reads the same translated words instead of a hard-coded "Add View". Each view is now a `<button>`; the current one carries `aria-current="true"`. The views were `role="tab"` elements with no `tablist`, and the active view's actions button sat inside its tab, so it was a control inside a control. That button is now the view button's sibling, still named "View actions for …" and still one Tab stop away. Tab roles could not hold it: a tab's content is presentational and a tablist may contain only tabs. These views never had the tabs keyboard model (arrow keys, a tab panel) either. Every view stays its own Tab stop. When the bar is not reorderable, as the console renders it, Enter or Space switches to the focused view. With drag-to-reorder on, Enter or Space on a view starts a keyboard drag instead, as it did before this change, so a view is switched to by click. The rename box is now outside the view button and is named through `view.rename`. With drag-to-reorder on, the sortable attributes describe the view as a button. Breaking for anything that queried the bar by `role="tab"` or `aria-selected`: query `data-testid="view-tab-ID"` or `aria-current` instead.
  - **Settings form (`@object-ui/console`).** Each row's label is bound to its control, so text, number, password, textarea, JSON, colour, switch and select controls are named by it. Clicking a label now focuses or toggles its control. A radio group and a multiselect checkbox group are named by the row label too.
  - **Sidebar menus (`NavigationRenderer`).** With drag-to-reorder on (the desktop default), every row was wrapped in a `<div>` between the menu's `<ul>` and its `<li>`. The sortable node is now the row's own `<li>`. A separator and a nested group inside a menu are now list items too: the separator's item is hidden from assistive tech, and a top-level group is unchanged.
  - **Table selection column (`data-table`).** The select-all checkbox and each row's checkbox are named through the existing `table.selectAllRows` and `table.selectRow` keys.
  - **Percent cell (`PercentCellRenderer`).** The progress bar is named by the formatted value beside it (`aria-labelledby`), so the name is in the viewer's locale.
  
  No language-pack key, export or prop is added; every new name reads a key the packs already carried.
- 17acfbb: A record delete confirmation now names what it deletes and confirms with a destructive "Delete" button (objectui#11695).
  
  Deleting a row from an object list, a selection of rows, or a record from its own page opened a dialog titled "Confirm Action" with a "Continue" button in the primary style, and nothing in it said which record was about to go. The dialog now:
  
  - titles one record by the object label and the record's display name, for example `Delete Product "QA Widget 0"?`. The name comes from the same resolver the record header and lookups use, so an object's declared `nameField` is honoured;
  - titles a selection by its size and the object label, for example `Delete 3 Product records?`;
  - labels its confirm button "Delete" and paints it in the destructive button style.
  
  The body is unchanged: the plain delete question, the batch question, or, for a package-owned permission set, the reset question from ADR-0094. The record page's Delete now asks that same question, so a package-owned permission set deleted from its own page also gets the reset question instead of the plain one.
  
  The three dialogs (the console list's row and bulk Delete, the record page's Delete, and the registered `object-view`'s grid Delete) take this copy from one place:
  
  - `@object-ui/core`: `recordDelete.confirmCopy(deps, target)` returns `{ title, message, confirmText }` for one record (`{ record }`) or a batch (`{ count }`). The `ConfirmationHandler` options gain `destructive?: boolean`.
  - `@object-ui/app-shell`: `ActionConfirmDialog` paints the confirm button destructive when `options.destructive` is set. `useObjectActions` accepts `objectDef` and returns `deleteRecords(records)` for a confirmed batch delete. `deleteRecord` now asks through `onConfirm` with the full copy before the delete runs, rather than through the action runner's one-argument confirm. The console list passes its translated object label, so the delete toasts read the same label the page header shows.
  - `@object-ui/i18n`: new keys in all ten packs: `objectActions.deleteConfirmTitle`, the `objectActions.bulkDeleteConfirmTitle` count family, and `objectActions.deleteConfirmButton`.
  
  Other confirmations are unchanged. They keep the `actionConfirm.*` title and "Continue" button and the primary style.
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
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
- 646caea: The object list's chrome sits on fewer rows (objectui#12528).
  
  - **The view description no longer takes a row above the toolbar**, so the toolbar sits at one height with or without one. The console's view tab strip draws it on the active tab: as the tab's tooltip and as the header of its ▾ menu. `ViewTabItem` gains an optional `description` (already resolved, already gated on `appearance.showDescription`; `false` still shows it nowhere). A `ListView` with no host tab strip (the console below `sm`, any other host) draws it as an info control at the start of its toolbar row.
  - **The sort popover's standing note about linked columns is an info control** beside the popover's title, the note as its tooltip, instead of a paragraph that took about half the popover on every open. One line (`list.sortRelationalPicked`, in every locale pack) says that a linked column sorts by the stored ID, only while the current sort names one.
  - **One footer row on an aggregated list.** `ObjectGrid` gains an `onColumnSummaryChange` host prop: when it is passed the grid draws no summary row of its own and reports, in column order, what that row would draw. `ListView` passes it and draws the summaries at the right of its record-count row, truncated with the full text as their tooltip.
  
  **Clause-②: yes (widening).** Two optional members widen published types: `ViewTabItem.description` in `@object-ui/plugin-view` and `ObjectGridComponentProps.onColumnSummaryChange` in `@object-ui/plugin-grid`. Both are host props on React components, never authored metadata.
- cbac9d7: The list view's Filter panel no longer narrows its field list to a per-view `filterableFields` whitelist (objectui#13118). `@objectstack/spec` 18 retires the list view's `filterableFields` (objectstack#24640, maintainer ruling C), and no per-view Filter-panel whitelist replaces it. The Filter panel offers every field the user may read, minus the fields the object marks `hidden: true`, which is what it already offered a view that declared no whitelist. A hidden field still appears when a condition the panel holds filters on it.
  
  - **`ListView`** (`@object-ui/plugin-list`) reads `filterableFields` nowhere. A stored view that still carries the key gets the same Filter-panel list as a view without it. The spec's conversion drops the key from stored and authored views, so no new source carries it.
  - **The relays** stop forwarding the key: the `object-view` delegation in `@object-ui/plugin-view` (from the named view, the host `views` entry and the node) and the object page in `@object-ui/app-shell` (from the active view). The `object-view` registration no longer publishes `filterableFields` as an input.
  - **`@object-ui/types`** declares `NamedListView.filterableFields` as a `?: never` tombstone, so a TypeScript author who writes the key on a named view is refused by name. `ObjectViewSchema.filterableFields` is deprecated and typed by reference to the list view's spec slot, the same slot its Zod mirror carries, so the `@objectstack/spec` pin bump that takes the retirement refuses it on both faces at once.
  
  BREAKING (`@object-ui/types`, `@object-ui/plugin-view`, `@object-ui/plugin-list`, `@object-ui/app-shell`), for a TypeScript caller or a view that passes `filterableFields`: the key no longer compiles on `NamedListView` (and on `ObjectViewSchema` from that pin bump on), and no renderer narrows the Filter panel to it. Delete the key. For a curated end-user filter bar, author `userFilters` on the list view, for example `userFilters: { element: 'dropdown', fields: [{ field: 'stage' }] }`. There is no replacement for a per-view Filter-panel whitelist: field-level read security decides which fields a user may filter on, and `hidden: true` on the object's field keeps a field out of the panel. (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  Clause-②: no (narrowing)
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

### Patch Changes

- 282f252: The record drawer of an object view opens as a right-hand panel on a desktop, and stays a bottom sheet on a phone (objectui#11775).
  
  An object view whose record surface is the drawer (an authored `layout: 'drawer'` or `navigation: { mode: 'drawer' }`, a light object on a desktop, or a page with nowhere to route) opened its create, edit and view form in vaul's `Drawer` with `direction: 'right'`. vaul applies the direction to the slide and the drag gesture only, and the shipped `DrawerContent` styles itself as a bottom sheet whatever the direction, so on a desktop the form drew as a sheet pinned to the bottom-left of the window, at most 672px wide, with a drag handle.
  
  - **Desktop:** the form opens in the right-hand `Sheet`, full height and anchored to the right edge, the panel the console's record drawer (`NavigationOverlay` in drawer mode) already opens a record in. It keeps the width it had: the full window up to 672px.
  - **Phone (below 768px):** the form stays on vaul's bottom sheet, which now slides up and is dragged down to close, the direction it is drawn in, and spans the screen at every phone width.
  
  `DrawerContent` itself is unchanged, so every other bottom sheet draws as before.
- 2063f7a: Four plugin controls pick with the shared `Select`, the control the rest of the console picks with (objectui#11865, the plugins' single selects): `SharedViewLink`'s "Expires after", `ViewSettingsPopover`'s "Color by field", a `select` field of the kanban `InlineQuickAdd` form, and the grouped grid's "Rows per page".
  
  The four were browser-native selects, so they looked and behaved differently from the console's other dropdowns. They now use the shared Radix `Select`: the same trigger, dropdown and keyboard behaviour. The grouped grid's size picker is now drawn as the flat grid's pager draws its own.
  
  What they write is unchanged. Each option gives the same value as before: "Never" still generates a link with no expiry, "None" still clears the row-colour config, the quick-add placeholder still submits an empty string, and each page size still repaginates from page 1. Re-picking the current option writes nothing. The quick-add picker keeps the accessible name its label gave the native select and still takes the form's first focus. Its keys keep the form's contract: Enter on the closed picker still submits the form and Escape still cancels it; Space and the arrow keys open the list, and Enter or Escape inside the open list selects or closes it without submitting or cancelling the form.
  
  One display change: a value none of a picker's options carries now shows as itself. The native select showed its first option instead ("None" for a row-colour field, the placeholder for a quick-add value), which is not what the view or the form holds.
  
  **Clause-②: no.** No published face moves: the package entries export the same names, the four components take the same props, and no i18n key is added. What moves is the four controls' own markup, described above.
- 5bc55c0: An `object-view` grid now exports the filter it shows, and returns to page 1 when that filter changes (objectui#11880, item 5).
  
  `ObjectView` hands the grid it draws one filter slot, `filter`, carrying the whole chain: the active named view's filter, else `table.filter` unless it lowers to nothing (absent, `[]` or `{}`), else the deprecated `table.defaultFilters` (a rung retired in 18, see objectui#12030: `ObjectView` no longer reads it). It no longer writes `defaultFilters` on that grid node, which `@objectstack/spec` retires on `object-grid` (objectstack#11509).
  
  Two user-visible corrections, both on an `object-view` rendered by the registered renderer (a page node, the Studio's stored-view preview; a host that supplies `renderListView` already behaved this way):
  
  - **The export carries the view's filter.** A named view's filter and an authored `table.defaultFilters` narrowed the rows on screen, but the server-streamed export (CSV, XLSX, JSON) was handed no filter and downloaded every record of the object. It now downloads the rows the view shows, as it already did for `table.filter`.
  - **Changing the filter returns the grid to page 1.** When a named view's filter or `table.defaultFilters` changed while the grid stayed mounted, the next query kept the old page index, which could ask for a page the new result does not have. It now returns to page 1, as `table.filter` already did (for a named view's filter only in 18, where `ObjectView` no longer reads `table.defaultFilters`, see objectui#12030).
  
  What did not change: which filter applies (each rung and each pair sends the same query and draws the same rows; in 18 the `table.defaultFilters` rung is retired, see objectui#12030), and a refused filter still draws the grid's malformed-filter panel and queries nothing. Nothing is added to or removed from any published type, schema or export.
- acc4328: A gallery view handed to `ObjectView` now draws with the `coverFit`, `cardSize` and `visibleFields` its `gallery` block declares (objectui#12053).
  
  `ObjectView` builds the `object-gallery` node for a gallery view, whether the view comes from the host `views` prop or from a named `listViews` entry. It built a flat node that carried the cover field and the title field only, while `ObjectGallery` reads `coverFit`, `cardSize` and `visibleFields` from the node's nested `gallery` block. So `coverFit: 'contain'` drew covers cropped, `cardSize` was ignored and cards showed none of their `visibleFields`.
  
  The node now carries the block nested, the shape `ListView` already hands `ObjectGallery`. It holds the five keys the spec's gallery block declares (`coverField`, `coverFit`, `cardSize`, `titleField`, `visibleFields`), each copied by name. A key the spec does not declare is not carried. The node no longer carries the flat `imageField` and `titleField`, because `ObjectGallery` reads the nested values first. A gallery view with no `titleField` still titles its cards by `name`.
  
  Nothing is added to the package entry: no export, prop, type member or language-pack key.
- 5af42db: Five write affordances that read no grant at all now read the affordance-to-grant
  map, so a caller without the grant is no longer offered a write the server then
  refuses (objectui#12082, the card's remainder).
  
  - **`object-view`'s New** (the toolbar button of the SDUI `object-view` node)
    reads the `listNew` row, as the console's list pages already did: the
    object's policy, the effective API operation set and the caller's create
    grant, on top of the node's `showCreate` / `operations.create` toggles.
  - **The calendar's quick-create** (an empty-day click, or a time-range drag in
    the week / day grid) reads the new `calendarQuickCreate` row, and
    **drag-to-reschedule** reads the new `calendarReschedule` row. A closed row
    withholds the handler the calendar grid draws the affordance from: no dialog
    on a day click, no range drag, no draggable event. A host-supplied
    `onDateClick` / `onEventDrop` is handed through unchanged.
  - **The kanban card move** reads the new `kanbanCardMove` row. A closed row
    draws the cards as not movable and hands the board no mover, so no drop
    reaches the write.
  - **A line-items panel's add and remove** (`record:line_items`) read the
    `relatedNew` and `relatedRowDelete` rows on the CHILD object, the same rows a
    related list reads for the same two writes. Add covers the Add button, the
    entry row and Duplicate; remove covers the per-row Remove.
  
  With no permission provider mounted every one of them reads open, as before.
  
  **Clause-②: yes (widening).** `AFFORDANCE_GRANTS`, exported from
  `@object-ui/core`, gains three rows: `calendarQuickCreate` (create),
  `calendarReschedule` (update) and `kanbanCardMove` (update), and with them the
  `ConsoleAffordance` union that `resolveAffordance` accepts. Nothing is removed or
  renamed. The other four packages change behaviour only.
- 9231820: The console list page's saved-view tabs show as many tabs as the toolbar row has room for again, instead of folding to one tab and "N more" (objectui#12518).
  
  Inside the list toolbar's leading slot the view tab bar was as wide as the tabs it was drawing, so the strip measured its own content and its width fit kept its previous answer: once one tab had been drawn, one tab was all that fit, and resizing the window did not bring the others back. The bar now takes its container's width (`w-full` on its root), so the number of tabs follows the space the row leaves. A bar in a block container, such as the row of its own a refused view draws, already had that width and is unchanged.
- ed43c79: List filters on `date` and `datetime` fields draw the platform date picker, the face record forms, action dialogs and grid cells already draw (objectui#12743). The native input took its placeholder and digit order from the machine's locale, not the console's.
  
  - **Where it applies.** `FilterBuilder`'s value editor for a `date` / `datetime` row, both bounds of a `between` row included (the console list toolbar's Filter panel renders it), and `filter-ui`'s `date` and `date-range` filters. `time` rows keep the native input.
  - **How it gets there, with no new dependency.** Both resolve the `field:date` / `field:datetime` widget from `ComponentRegistry` at render time, the way the form renderer resolves `field:<type>`. `@object-ui/fields` registers the picker there behind its lazy loader, so `@object-ui/components` still does not import `@object-ui/fields`, `@object-ui/plugin-view` gains no dependency, and the picker stays in its own chunk. A host that does not load `@object-ui/fields` keeps the native input.
  - **The value written is unchanged.** A `date` row writes `YYYY-MM-DD`; a `datetime` row writes the zoneless local `YYYY-MM-DDTHH:mm` the native `datetime-local` input wrote; `filter-ui` writes `YYYY-MM-DD`.
  - **A typed day is applied.** The picker reads its text on blur and on Enter. A pointer press outside the editor while it holds focus blurs it first, so the text is read before a popover or drawer that hosts the filter closes on that press. Escape discards.
  - **No public surface changes.** No type member, prop, export, dependency or language-pack key is added or removed.
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
- b13ea3c: feat(types)!: `ObjectGridSchema.defaultFilters` and the flat `ObjectGanttSchema` / `ObjectMapSchema` `filter` follow their `@objectstack/spec` rows (objectui#6152, round 10)
  
  Clause-②: yes
  
  `@objectstack/spec` typed `ComponentPropsMap['object-grid'].defaultFilters` as the same
  `ViewFilterRule` array as `filter`, `[{ field, operator, value }, ...]`, from 17.6.0 until 18
  retired it (see objectui#12030): the legacy fallback `ObjectGrid` read only when `filter` was
  absent, refusing the MongoDB-style record, a bare string and the AST tuple array. The `object-gantt` and `object-map` rows type `filter` the same
  way. `@object-ui/types` now takes each row's own member by reference, on the TypeScript interface
  and on the zod mirror, with no alias window.
  
  **Widened.** `ObjectGridSchema.defaultFilters` was `Record<string, any>` and
  `z.record(z.string(), z.any())`, so the zod mirror REFUSED the rule array the row declares. The
  flat grid mirror is the source of an `object-view`'s `table` slot, so
  `table: { defaultFilters: [{ field: 'status', operator: 'equals', value: 'open' }] }` parsed
  there through 17.x, on the tolerant and the strict face and through `safeValidateSchema`; retired
  in 18, see objectui#12030: the row's tombstone refuses `defaultFilters` by name, so every value,
  the rule array included, is refused there now.
  
  **Narrowed (breaking).**
  
  - The record form of `defaultFilters` is refused: on the interface (a compile error, in an
    `object-view`'s `table` too) and on the zod mirror, at `defaultFilters` (`table.defaultFilters`
    in an `object-view`), with the protocol's own message, which computed the rule array from the
    record's keys through 17.x (since 18, see objectui#12030, it is the retired-key message, which
    names `filter`). Respell
    `defaultFilters: { status: 'open' }` as
    `filter: [{ field: 'status', operator: 'equals', value: 'open' }]`; the rule-array
    `defaultFilters` spelling this entry first offered is retired in 18 too.
  - `ObjectGanttSchema.filter` and `ObjectMapSchema.filter` were `any[]` and `z.array(z.any())`, so
    `filter: [['status', '=', 'open']]` type-checked and parsed. Both are the row's rule array now;
    respell the tuple as `[{ field: 'status', operator: 'equals', value: 'open' }]`. These two flat
    types describe the node as the renderers read it: an authored `object-gantt` / `object-map`
    node's `properties` bag is the row itself, which refused the tuple array already.
  
  What did not move: the renderers' reads. `ObjectGrid` lowered `defaultFilters` through the same
  `toFilterNode` sink as `filter`, so a rule array there sent the same `$filter` and drew the same
  rows as the same array written as `filter` (retired in 18, see objectui#12030: `ObjectGrid` and
  `ObjectView` no longer read `defaultFilters`, so a view that still carries it renders unfiltered);
  the sink still lowers a record or an AST that reaches `filter` at runtime, and `ObjectGantt` / `ObjectMap` still forward an AST a host composes. The
  `@object-ui/core`, `@object-ui/plugin-grid` and `@object-ui/plugin-view` entries are comment
  repairs to sentences that called the key `Record<string, any>`. `@object-ui/plugin-grid`,
  `@object-ui/plugin-view` and `@object-ui/plugin-map` also carry typed test fixtures re-spelled to
  the rule array, and `@object-ui/plugin-grid` a pin of the above through the real renderer (since
  18 it pins that `defaultFilters` is not read).
- d7e9e9a: feat(types)!: `object-grid` `operations` and the `object-grid` / `object-kanban` / `object-calendar` `filter` follow the `@objectstack/spec` 17.7.0 rows (objectui#6152, round 8)
  
  Clause-②: no
  
  **Narrowed (breaking).** `@objectstack/spec` 17.7.0 types `object-grid`'s `operations` as the
  strict `{ create?, update?, delete?, export? }` block, refusing `read` and `import` by name, and
  the `filter` of `object-grid`, `object-kanban` and `object-calendar` as the `ViewFilterRule` array
  `[{ field, operator, value }, ...]`, refusing the MongoDB-style record and the AST tuple array.
  `@object-ui/types` now says the same, with no alias window:
  
  - `ObjectGridSchema.operations` takes the row's block by reference. `read` and `import` are
    `?: never` on the interface and refused by name at their own path on the flat zod
    `ObjectGridSchema`: no `object-grid` code reads either. The flat mirror is the source of an
    `object-view`'s `table` slot, so `table.operations.read` / `.import` are refused there too, and
    the `read` refusal names the view-level spelling, `navigation: { mode: 'none' }` or the view's
    own `operations: { read: false }`.
  - `ObjectGridSchema.filter`, `ObjectKanbanSchema.filter` and `ObjectCalendarSchema.filter` take
    their row's own member by reference, on the interface and on the zod mirror. They were `any[]`
    and `z.array(z.any())`, so `filter: [['status', '=', 'open']]` type-checked and parsed. It is now
    refused, on an authored `object-kanban` / `object-calendar` node and in an `object-view`'s
    `table` slot; respell it `filter: [{ field: 'status', operator: 'equals', value: 'open' }]`.
  
  What did not move: an `object-view`'s own `operations.read` (the protocol has no `object-view`
  row, and `ObjectView` reads it as its row-click gate), and the renderers' reads. `ObjectGrid`
  still lowers an AST array, and the board and the calendar still hand whatever `filter` reaches
  the node to `$filter`, because hosts compose that form at runtime.
  
  - `@object-ui/plugin-view`: the grid node `ObjectView` composes no longer carries the view's
    `read` toggle in its `operations` block; the view keeps reading it.
  - `@object-ui/plugin-grid`, `@object-ui/plugin-kanban`, `@object-ui/plugin-calendar`: the
    registrations' `filter` inputs describe the `ViewFilterRule` array, and the grid's `operations`
    input names the four toggles.
  - `@object-ui/console`: the registry parity pins' prose stops calling these rows `z.unknown()`.
- 26b0bd2: `toFilterGroup` now declares its return type by `@object-ui/components`' new name for the FilterBuilder's group, `FilterBuilderRowGroup` (it was exported as `FilterGroup`; objectui#6349, batch 12). The type is the same. The function keeps its name, and what it returns is unchanged.
  
  No runtime behaviour changes.
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [15f6702]
- Updated dependencies [c096f03]
- Updated dependencies [d92b2a1]
- Updated dependencies [3f0b0cd]
- Updated dependencies [92f4e2b]
- Updated dependencies [b10c68e]
- Updated dependencies [902ebab]
- Updated dependencies [bdc9049]
- Updated dependencies [e8c0b96]
- Updated dependencies [d768c31]
- Updated dependencies [b92329c]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [c000398]
- Updated dependencies [73b5d77]
- Updated dependencies [7b17705]
- Updated dependencies [846f982]
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
- Updated dependencies [834c559]
- Updated dependencies [22b503c]
- Updated dependencies [9fc68aa]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [6be0f7a]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
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
- Updated dependencies [8aebc6f]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [bfca7ec]
- Updated dependencies [5e446ab]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [9844bbf]
- Updated dependencies [0aa8c0c]
- Updated dependencies [cef0eee]
- Updated dependencies [7ebff39]
- Updated dependencies [054fd84]
- Updated dependencies [5275d1f]
- Updated dependencies [7241a81]
- Updated dependencies [2063f7a]
- Updated dependencies [74add0c]
- Updated dependencies [aaba865]
- Updated dependencies [9fc6ad7]
- Updated dependencies [f1781be]
- Updated dependencies [fbad078]
- Updated dependencies [ccddd11]
- Updated dependencies [45d5853]
- Updated dependencies [4f4fc03]
- Updated dependencies [2312bd9]
- Updated dependencies [3f20d5a]
- Updated dependencies [6d5eb34]
- Updated dependencies [c5406c2]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [2571a3e]
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
- Updated dependencies [c9fc10b]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [2381c07]
- Updated dependencies [e723f58]
- Updated dependencies [82bb1d5]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
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
- Updated dependencies [38bb373]
- Updated dependencies [6c437b0]
- Updated dependencies [923504f]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [97e7d4e]
- Updated dependencies [10aba37]
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
- Updated dependencies [df05784]
- Updated dependencies [6f3299f]
- Updated dependencies [065a1cf]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [1040a0a]
- Updated dependencies [fc211e8]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [37db09f]
- Updated dependencies [ff9df88]
- Updated dependencies [70e843f]
- Updated dependencies [2fc31ea]
- Updated dependencies [caac3b2]
- Updated dependencies [a2225f9]
- Updated dependencies [5c4deb5]
- Updated dependencies [a8e5b73]
- Updated dependencies [d9d9d98]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [c3de0bc]
- Updated dependencies [f8267df]
- Updated dependencies [9b82ced]
- Updated dependencies [3821a3a]
- Updated dependencies [3eb3ec1]
- Updated dependencies [92c2a69]
- Updated dependencies [7b5e558]
- Updated dependencies [646caea]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
- Updated dependencies [0081cdc]
- Updated dependencies [96fa4b9]
- Updated dependencies [85e8961]
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
- Updated dependencies [611566b]
- Updated dependencies [611566b]
- Updated dependencies [efa9cb4]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [9d857c9]
- Updated dependencies [670ea10]
- Updated dependencies [ff215d9]
- Updated dependencies [3e2c763]
- Updated dependencies [71243db]
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [a23e804]
- Updated dependencies [c7462e7]
- Updated dependencies [36e2f7b]
- Updated dependencies [684f22e]
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
- Updated dependencies [8d80845]
- Updated dependencies [69a408f]
- Updated dependencies [1aa622a]
- Updated dependencies [d2b21a1]
- Updated dependencies [5ff64ef]
- Updated dependencies [64acb7e]
- Updated dependencies [4ff5b6b]
- Updated dependencies [473e5a0]
- Updated dependencies [b279016]
- Updated dependencies [54e79f9]
- Updated dependencies [bb6c38c]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [2727527]
- Updated dependencies [3da39ae]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [2cfdc99]
- Updated dependencies [2cfdc99]
- Updated dependencies [1e6d83b]
- Updated dependencies [1e6d83b]
- Updated dependencies [32b492b]
- Updated dependencies [6058bf8]
- Updated dependencies [c219165]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [7f9cc37]
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
- Updated dependencies [fe11eb1]
- Updated dependencies [988aa9f]
- Updated dependencies [b9e1887]
- Updated dependencies [1ce0711]
- Updated dependencies [fb85637]
- Updated dependencies [bc98626]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
- Updated dependencies [2d8a8b7]
- Updated dependencies [4b67746]
- Updated dependencies [cbac9d7]
- Updated dependencies [9840695]
- Updated dependencies [9eb1479]
- Updated dependencies [74e37aa]
- Updated dependencies [aaa1296]
- Updated dependencies [f0300be]
- Updated dependencies [961b69f]
- Updated dependencies [52907d7]
- Updated dependencies [f466b0a]
- Updated dependencies [5a8d40f]
- Updated dependencies [d05f33b]
- Updated dependencies [673a71c]
- Updated dependencies [616df65]
- Updated dependencies [58798ec]
- Updated dependencies [8803ca5]
- Updated dependencies [e70c21d]
- Updated dependencies [f22b980]
- Updated dependencies [ab4e4d7]
- Updated dependencies [4b92c5a]
- Updated dependencies [06be396]
- Updated dependencies [3650d94]
- Updated dependencies [7c05f21]
- Updated dependencies [84b4326]
- Updated dependencies [a29f615]
- Updated dependencies [ff128e3]
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
- Updated dependencies [26b0bd2]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [c0c0a0d]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [f962cdc]
- Updated dependencies [b403bb3]
- Updated dependencies [8a25fee]
- Updated dependencies [4016370]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/components@18.0.0
  - @object-ui/core@18.0.0
  - @object-ui/plugin-form@18.0.0
  - @object-ui/i18n@18.0.0
  - @object-ui/react@18.0.0
  - @object-ui/plugin-grid@18.0.0
  - @object-ui/permissions@18.0.0

## 17.7.0

### Minor Changes

- ff14e29: The grid's row Delete and bulk Delete now delete the record when `ObjectView` renders the grid itself — the registered `object-view` renderer, with no host list view (objectui#10383).
  
  `ObjectGrid` hands the clicked row, or the selection, to its `onDelete` / `onBulkDelete` consumer and leaves the delete to it. `ObjectView`'s two handlers ignored the record and only refreshed, so a Delete the grid offers by default asked no question, called `dataSource.delete` zero times, and the row was still there after the refresh.
  
  They now bind to the same record-delete core as the console's own object list (`recordDelete` from `@object-ui/core`), so the two paths behave the same:
  
  - a row Delete asks "Are you sure you want to delete this record?". A package-owned permission set (a `sys_permission_set` row whose `managed_by` is `'package'`) is asked the reset question instead, because deleting it resets it to its shipped baseline rather than removing it. A bulk Delete asks once for the whole selection ("Delete N selected records? This cannot be undone.");
  - Continue calls `dataSource.delete(objectName, id)` for each record, then refreshes the grid, so the deleted rows are gone. Cancel deletes nothing;
  - the outcome is reported with the console's toasts: "LABEL deleted successfully" (or the reset message for a package-owned permission set) / "Deleted N LABEL records", or "Failed to delete LABEL" (with the error message, and no refresh) / "N deleted, M failed".
  
  The confirm dialog is `ObjectView`'s own, in the console's dialog shape. Its texts reuse translation keys the console already resolves, so they read the same in every shipped language. Whether Delete is offered at all is unchanged. It is still the grid's own verdict, the same one the console list uses: `operations.delete`, the principal's delete grant, the object's lifecycle and `userActions`, its API operations and the per-record verdict.
- 37140f4: refactor(plugin-view)!: retire the `shared-view-link` node type key (objectui#10859, batch 8 phase 2b)
  
  **BREAKING (authoring):** the plugin no longer registers `shared-view-link` (and with it `view:shared-view-link`). `objectui validate` refused a `shared-view-link` node at `type`, and nothing in this repository, its examples or objectstack authored it. A node authored `type: "shared-view-link"` now renders the "Unknown component type" panel. `SharedViewLink` stays a named export.
  
  Migration:
  
  - `{ "type": "shared-view-link", "objectName": …, "viewId": … }` → mount `SharedViewLink` directly with the same props.
  
  **Clause-②: yes** — a registration leaves the runtime (narrowing), released as `minor` with this banner.
- 990a2d6: refactor(plugin-view)!: retire the bare `view` node type key; `object-view` is the one spelling (objectui#10859, batch 8)
  
  **BREAKING (authoring):** the plugin no longer registers `view` (and with it `plugin-view:view`), an alias of the `object-view` renderer that declared no inputs. `objectui validate` refused a `view` node at `type` while it accepts `object-view`, and nothing in this repository authored the alias. A node authored `type: "view"` now renders the "Unknown component type" panel. The README's and the plugin page's registration tables lost the row.
  
  Migration:
  
  - `{ "type": "view", … }` → `{ "type": "object-view", … }`, with the same keys.
  
  The `view` METADATA namespace (saved views, `client.meta.getItems('view')`) is a different layer and is unchanged.
  
  **Clause-②: yes** — a registration leaves the runtime (narrowing), released as `minor` with this banner.
- 53dc89d: **Breaking (shipped as `minor` per AGENTS.md §版本号策略).** `ObjectViewProps.views[].sort`
  now spells its direction key **`order`**. The retired spelling is **`direction`** — named
  here so that a host still writing it can find this entry by searching the old key
  (objectui#5293).
  
  ```diff
    <ObjectView
      views={[{
        id: 'recent', label: 'Recent', type: 'grid',
  -     sort: [{ field: 'created_at', direction: 'desc' }],
  +     sort: [{ field: 'created_at', order: 'desc' }],
      }]}
    />
  ```
  
  **Nothing that worked stops working on this surface, because on the `views` prop
  `direction` never worked.** All three consumers of the resolved `activeView.sort` read
  `order`: the non-grid fetch lowers it through the shared sink `convertSortToQueryParams`,
  whose `entry.order === 'desc'` is false for a missing key; the grid path forwards it to
  `ObjectGridSchema.sort`, where `ObjectGrid` builds the wire string `` `${s.field} ${s.order}` ``
  — literally `"created_at undefined"` — and `parseSchemaSort` reads a missing `order` as
  ascending, so the column header even drew an ascending arrow; `mergedSort` hands the same
  value to the delegated list view.
  
  So a host writing the exact shape the prop declared got an **ascending** list with no
  failure signal anywhere: the declaration said the value was well-formed, and the direction
  was dropped at three independent readers rather than rejected at one. This rename does not
  take away a feature — it converts a silent wrong answer into a loud type error at the one
  place that can still be fixed cheaply.
  
  **Scope — at this change one other published export still accepted `direction`, and this
  release did not retire it.** `toSortItems` (`packages/plugin-view/src/config/view-config-utils.ts`,
  re-exported from the package root and listed in the README) folded
  `s.order || s.direction || 'asc'`. It serves a different surface — the studio
  inspector-draft that feeds `SortBuilder` — and it is not reachable from the `views` prop,
  so it neither affected nor was affected by this rename: dormant (nothing in this repo
  called it outside a test), and removing it would be a separate break on a separate public
  export, tracked as objectui#6011. It was not a partial retirement of this one.
  
  ⚠️ **That second export has since been retired too — objectui#6011.** `toSortItems` now
  reads `order`, and only `order`: a draft entry still spelled `{ field, direction }` takes
  the `'asc'` default instead of the direction it asked for. So the migration search
  described above no longer finds a live `direction` read on this package's published sort
  path.
  
  `order` is the spelling every other sort surface already uses (`SortConfig`,
  `NamedListView.sort`, `ObjectGridSchema.sort` (and, at this change, `.defaultSort` —
  since retired, objectui#5861), and the shared `QuerySortEntry` sink), so the prop now has
  one spelling repo-wide and declared equals enforced.
  
  ⛔ Deliberately **not** a tolerant dual-read (`direction ?? order`): that is the tolerance
  layer objectui#4869 ruled against, and admitting the old key as an alias would rebuild the
  drift this change removes. `SortUI` is untouched — it legitimately owns `direction` on its
  own `SortUISchema` and converts at its boundaries.
- 0cba1b7: Retire `object-grid`'s `defaultSort` and `object-view`'s `table.defaultSort`
  (objectui#5861 — ADR-0049 enforce-or-remove, the "C half" of the 2026-08-22
  ruling on objectui#4869).
  
  **BREAKING for the legacy spelling, deliberately.** `defaultSort` was the
  single-entry `{ field, order }` spelling of `sort`. `@objectstack/spec` 17.3.0
  turned `ObjectGridProps.defaultSort` into a retired-key tombstone, so the
  protocol already refuses an authored value by name; the renderers were the last
  place that still honoured it. Every read goes in this one change, so no path
  honours the key while another ignores it:
  
  - `@object-ui/plugin-grid` — `ObjectGrid` no longer lowers `defaultSort` into
    `$orderby` and no longer falls back to it for the header sort arrows. The
    registered `sort` input's description no longer advertises it as a fallback.
  - `@object-ui/plugin-view` — `ObjectView` no longer forwards `table.defaultSort`
    to the grid, no longer lowers it on the non-grid fetch (calendar / kanban /
    gallery / timeline / gantt / map), and no longer wraps it into the sort
    handed to a host's `renderListView`.
  - `@object-ui/types` — the published faces narrow to match:
    `ObjectGridSchema.defaultSort` is now `?: never` (a TypeScript author who
    writes it gets a compile error), and the `ObjectGridSchema` zod mirror refuses
    it by name with a migration message. `ObjectViewSchema.table` inherits the
    `never` member. A tombstone rather than a deletion: `BaseSchema`'s index
    signature and `.passthrough()` would otherwise absorb the key silently.
  
  A document that still carries `defaultSort` renders **unsorted** — it is not
  re-routed into `sort`. Migrate by renaming the key and wrapping the value:
  `defaultSort: { field: 'name', order: 'asc' }` becomes
  `sort: [{ field: 'name', order: 'asc' }]`. `sort` already outranked
  `defaultSort` wherever both were written, so documents that carry both keep
  their current ordering.
  
  This supersedes the `defaultSort` handling described by five earlier
  changesets still pending in the same release, each of which now carries a dated
  note naming this card: objectui#4869 (the non-grid lowering, and "both
  spellings of the pair keep working"), objectui#6235 (the delegated-slot wrap),
  objectui#8973 (the normalized grid arm), objectui#4082 (the grid's legacy
  `defaultSort` leg, graded as needing no change) and objectui#5293 (which cites
  `ObjectGridSchema.defaultSort` as a live `order` spelling). Those describe how
  the legacy key was honoured; from this release it is not read at all.
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
- c5fbe0b: **Breaking (shipped as `minor` per AGENTS.md §版本号策略).** The published `toSortItems`
  export now reads its sort direction from **`order`** only. The retired spelling is
  **`direction`** — named here so that a host still writing it can find this entry by
  searching the old key (objectui#6011).
  
  ```diff
    import { toSortItems } from '@object-ui/plugin-view';
  
  - toSortItems([{ field: 'created_at', direction: 'desc' }]);
  + toSortItems([{ field: 'created_at', order: 'desc' }]);
  ```
  
  **What changed, exactly.** `toSortItems` folded `s.order || s.direction || 'asc'`: two
  spellings for one key, silently preferring the canonical one. It now folds
  `s.order || 'asc'`. Everything else about the helper is unchanged — `id` is still
  preserved when present and minted with `crypto.randomUUID()` otherwise, `field` still
  defaults to `''`, and a non-array draft still yields `[]`.
  
  **The failure mode if you do not migrate is silent.** A draft entry spelled
  `{ field: 'created_at', direction: 'desc' }` used to produce
  `{ field: 'created_at', order: 'desc' }`; it now produces
  `{ field: 'created_at', order: 'asc' }` — the documented default for an entry that names
  no direction. Nothing throws and nothing warns: the `SortBuilder` row renders, and it
  renders **ascending**. If you have a studio inspector draft, a persisted view body, or any
  other producer that still writes `direction`, grep for the key and re-spell it to `order`.
  
  **Why the tolerant read went rather than staying.** objectui#4869 ruled that a spelling the
  sink does not recognise gets ruled into the contract or rejected at the producer, never
  absorbed by a tolerance layer. objectui#5293 retired the same word on
  `ObjectViewProps.views[].sort` and shipped it as a `minor`; this entry finishes the job on
  the sort family's public surface, so `order` is now the one spelling repo-wide and declared
  equals enforced. The scope note in the objectui#5293 entry — that this export was *not*
  retired by that change — described that release's scope correctly and is superseded here.
  
  `SortUI` is untouched. Its own file-local `toSortItems` is a different symbol, and
  `direction` is the key `SortUISchema` legitimately declares.
- b97790a: Seven more `find()` readers now read exactly what `QueryResult` declares — the
  `records` arm is removed from each (objectui#6726, following objectui#5945).
  
  `QueryResult` (`@object-ui/types`) declares exactly one rows member — `data` —
  alongside `total`, `page`, `pageSize`, `hasMore`, `cursor` and `metadata`.
  `records` is not a member of it. It is the spelling the server envelope and the
  client SDK use, which `ObjectStackAdapter.normalizeQueryResult` maps to `data`
  before returning — a *below*-the-adapter spelling that had leaked into
  above-the-adapter consumers. objectui#5945 removed it from two app-shell
  readers; these are the seven the same producer sweep turned up and that card did
  not name:
  
  | module | what it does |
  | --- | --- |
  | `components/src/hooks/related-count-store.ts` | related-list tab badge count |
  | `components/src/renderers/basic/data-list.tsx` | `element:repeater` rows |
  | `components/src/renderers/basic/elements.tsx` | `element:number` client-side aggregate |
  | `components/src/renderers/basic/record-picker.tsx` | `element:record_picker` options |
  | `plugin-detail/src/renderers/record-activity.tsx` | `record:activity` self-fetch |
  | `plugin-detail/src/renderers/record-history.tsx` | `record:history` self-fetch |
  | `plugin-view/src/ObjectView.tsx` | non-grid (kanban / calendar / gallery / timeline) fetch |
  
  **One of them was actively wrong, six were dead.** `related-count-store.ts`
  read `records` *ahead of* `data` — the precedence inversion objectui#5945 was
  filed about — so a `find()` answer carrying both would have been counted from
  the key the contract does not declare. The other six read `data` first, so their
  `records` arm could never be reached by a conforming producer. A dead tolerant
  arm is not harmless: it is where a non-conforming producer keeps working
  unrejected, and hardens into a second de-facto contract nobody is checking
  (AGENTS.md #0.1).
  
  **What stops being accepted.** A `find()` answer shaped `{ records: [...] }`
  now reads as **no rows** at these seams instead of silently resolving. Every
  call site degrades rather than throws: the tab badge counts 0, the repeater and
  the picker render their empty state, `element:number` reports 0, the activity
  and history feeds render empty, and the non-grid views paint no rows.
  
  **Nothing produces that shape at this seam today**, which is why this is a
  removal rather than a migration. Measured repo-wide over every tracked file:
  `ObjectStackAdapter.normalizeQueryResult` CONSUMES the server/SDK `records`
  envelope and returns `{ data, total, page, pageSize, hasMore }`; every other
  `find()` implementation in the repo (`ApiDataSource`, `ValueDataSource`, the
  runner and example mocks, the `@object-ui/types` REST example) returns `data`
  or a bare array. The `records` producers that DO exist are on other seams and
  are untouched: `ViewDataProvider`'s own `ResolvedData` interface, which declares
  `records` legitimately; the raw Cloud HTTP payloads `marketplaceApi.ts` and
  `packagedActions.ts` read; and the client-SDK doubles that sit *below*
  `normalizeQueryResult`.
  
  **The bare-array arm is kept** wherever it existed, because it is live: fakes at
  these seams answer with a plain array. Each module carries its own pin —
  `*.contractEnvelope-6726.*` — asserting the contract read, the live arms, and
  the refusal of `records`, so the live and the dead shapes cannot drift into each
  other.
  
  `QueryResult` is **not** widened to bless `records`; that would be a
  published-type change and a maintainer decision.
- c18d099: Read `find()` answers as `QueryResult` declares them on two more seams: the
  related-count badge store no longer reads `count`, and `ObjectView`'s non-grid
  unwrap no longer reads `value` (objectui#6840, following objectui#6726).
  
  `QueryResult` (`@object-ui/types`) declares exactly one rows member, `data`, and
  exactly one count member, `total`. objectui#6726 removed the `records` arm from
  seven consumers after measuring that nothing produces it at the
  `DataSource.find()` seam, and deliberately left two arms reading *other*
  undeclared keys standing in the same expressions — because it had measured
  `records` and not them. Its own pin says so in as many words. This is the
  measurement it deferred.
  
  - `related-count-store.ts` dropped `typeof res?.count === 'number' ? res.count`,
    which was tried second and *ahead of the contract's `data`* — the same
    precedence inversion objectui#5945/#6726 were filed about, on the key those
    cards did not measure. The store already asks the server for the count with
    `$count: true` and reads it back as `total`, which is a declared member.
  - `ObjectView.tsx` dropped the ladder's last branch,
    `Array.isArray((results as any).value)`. Unlike the store's arm this was a
    pure fallback, not an inversion — `data` was already read first.
  
  Both keys are the raw-payload spellings that `ObjectStackAdapter.normalizeQueryResult`
  and `ApiDataSource.normalizeQueryResult` already fold into `total` / `data`
  *below* this seam, so nothing above it emits them. A producer sweep over every
  `find()` definition body in the repo (452 bodies / 331 files, bracket-scanned so
  a body cannot leak into sibling properties) found `count` emitted **0** times,
  against controls `total` (85 hits / 75 files) and `data` (135 hits / 103 files)
  drawn from the same cells. Narrowed to the 25 bodies reachable by `ObjectView`,
  `value` is emitted **0** times against the same controls (6 and 6).
  
  No producer changes behaviour, because there is no producer; what changes is
  that a non-conforming one is now refused instead of silently absorbed — which
  is the point (AGENTS.md #0.1). Each module gets its own refusal pin
  (`*.contractEnvelope-6840.*`), and the pins keep the live arms green alongside
  the deleted ones, because live and dead is the whole distinction.
  
  Deliberately not done: `QueryResult` is **not** widened to bless `count` or
  `value`. That is a published-type change and the maintainer's call, the same
  floor objectui#6726 respected.
  
  The `value` reading here is **seam-local** and does not transfer: at
  `extractRecords` (`@object-ui/core`, objectui#6839) the same key is still LIVE —
  five test doubles in plugin-calendar / plugin-kanban emit it today.
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
- 66e8b2a: **BREAKING** — `NamedListView.densityMode` is retired on the TypeScript authoring face
  (objectui#7924, director-seat ruling **A′**). It is now a `?: never` tombstone: a
  TypeScript author who writes it gets a compile error at that key, and its docblock names
  top-level `rowHeight` as the key to write instead. The protocol names row density
  `rowHeight`; `densityMode` was objectui's legacy spelling of it. ⚠️ Not
  `userActions.rowHeight`, which is the boolean toggle for the toolbar's density control.
  
  ```ts
  // before
  const dense: NamedListView = { label: 'Dense', densityMode: 'compact' };
  // after
  const dense: NamedListView = { label: 'Dense', rowHeight: 'compact' };
  ```
  
  This supersedes the earlier objectui#7924 entry in this release that listed `densityMode`
  as retained because it was read. Its only reader outside the runtime fold was the relay
  that carried it by name, and both relays now read the density through the fold.
  
  **Both relays of a named view read the density through `normalizeListViewSchema`.** The
  `renderListView` composition in `@object-ui/plugin-view`'s `ObjectView` and the Console
  object page (`@object-ui/app-shell`) each hand the active view to the fold and relay its
  `rowHeight`; neither names `densityMode` any more. A stored view carrying
  `densityMode: 'compact'` renders the same density as before. ⚠️ A third-party host that
  passes `renderListView` and read `schema.densityMode` off its argument now receives the
  same density as `schema.rowHeight` (mapped through `DENSITY_MODE_TO_ROW_HEIGHT`) and no
  `densityMode` key.
  
  `allowExport` stays declared on `NamedListView`; its docblock now names both relays that
  carry it. The `@object-ui/react` `useDensityMode` JSDoc example reads and persists
  `rowHeight` (through `rowHeightToDensityMode` / `DENSITY_MODE_TO_ROW_HEIGHT`) instead of
  `densityMode`; that is a documentation fix with no behaviour change.
  
  ⚠️ **Dated note, 2026-09-30 — `allowExport` has since been retired too — objectui#11013.**
  Later in this same release both relays stopped reading `allowExport` off a view, and
  `NamedListView.allowExport` became a `?: never` tombstone. So "`allowExport` stays
  declared" above no longer holds. `.changeset/11013-view-row-declared-spellings.md`
  states what ships; the text above is kept as the reading of this change.
  
  **ADR-0087 disposition:** `densityMode` is a **D2** conversion. Stored documents are
  accepted and converted at load by the existing runtime fold (`normalizeListViewSchema`
  maps it onto `rowHeight`), and the TypeScript face refuses the old spelling at authoring
  time.
- b93e245: **`ObjectViewSchema.listViews` is the protocol's named-view record, by reference**
  (objectui#7928: maintainer ruling A, then the director ruling on `options`).
  
  ⚠️ **Breaking for authored metadata** (labelled `minor` under this repo's
  version-alignment policy). A named view on an `object-view` node is now judged by
  `@objectstack/spec`'s strict `ObjectListViewSchema`:
  
  - the zod mirror declares `listViews` as the spec's own `ViewSchema.shape.listViews`,
    crossed through the import boundary so no protocol default is written into the
    parsed document;
  - the TypeScript face is `Record<string, z.input<typeof ObjectListViewSchema>>`.
  
  So a named view needs `columns`, takes `filter` as `{ field, operator, value }`
  rules, and puts each view kind's config in the top-level block of that kind
  (`kanban`, `calendar`, …). A key the protocol does not declare there is refused
  `unrecognized_keys` by name. That includes the objectui#8365 stray
  `kanban.groupBy`, which a named view used to accept while a `list-view` document
  refused it. The docs have taught this shape since objectui#8255, and `ObjectView`
  has honoured it since objectui#8254.
  
  **`options` on a named view is refused, and no longer read.** The legacy per-kind
  bag (`options.kanban`, `options.calendar`, …) is not a member of the protocol's
  authoring shape. `plugin-view`'s `ObjectView` stopped reading it off a named view.
  The host `views` entry keeps its own rung, so nothing changes there. A STORED list
  body may still carry the bag, because the protocol declares it on that wire. The
  one door that relays a stored body into `listViews`, `app-shell`'s `ViewPreview`,
  now folds each `options.KIND` onto the top-level `KIND` block before it builds the
  node. Where both spell a key, the top-level value wins, the same per-key merge
  `ObjectView` used to apply. A saved view that carried the bag therefore previews
  exactly as before. Migrate an authored `options: { kanban: { groupByField } }` to
  `kanban: { groupByField, columns }`.
  
  The named-view alias pointers from objectui#8355 and objectui#10321 still reach
  a named view. The protocol now refuses `calendar.dateField` / `calendar.endField`
  and `kanban.groupBy` itself (`unrecognized_keys`, naming the key). The two checks
  on the `object-view` door add this repository's pointer at the key:
  `Did you mean dateField → startDateField?`, `endField → endDateField`, or
  `groupBy → groupByField`. Without them, only the protocol's near-miss hint would
  answer, and for `dateField` that hint says `endDateField`. The legacy
  `options.calendar` / `options.kanban` nesting is refused whole (`options` by
  name) rather than judged inside.
  
  **Keys the protocol's blocks do not declare are refused on a named view.** The
  by-reference record judges each view-kind block with the protocol's strict block,
  so a renderer-ahead knob or legacy alias inside one is an authoring error now.
  Measured on 17.4.0: `kanban.titleField` / `groupField` / `swimlaneField` /
  `conditionalFormatting`, `gallery.imageField`, `timeline.dateField` / `endField`,
  `calendar.allDayField` / `defaultView` and `map.style`. `ObjectView` still reads
  them off a named view that reaches it unvalidated, so a stored body keeps
  rendering. Use the canonical key where one exists (`groupByField`, `coverField`,
  `startDateField`, `grouping` for swimlanes).
  
  **Superseded statements in this release.** Pending entries for objectui#7779,
  objectui#8355 and objectui#10321 say `ObjectViewSchema.listViews` stays
  unmirrored, and the objectui#8355, #8365, #9242 and #10321 entries say the
  named-view doors judge the `options` nesting. This entry supersedes both: the key
  is mirrored by reference, and the `options` bag is refused whole.
  
  `NamedListView` is exported, and this entry does not change it (objectui#7924's
  own entry in this release retires its `densityMode`). It no longer types
  `ObjectViewSchema.listViews` or `ObjectView`'s named-view config. Its retirement
  or narrowing follows objectui#7924's ruling A′ and the ruling on `allowExport`,
  not this entry.
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
- 3e98e13: Export the host `tree` view config as `TreeViewConfig` (objectui#8253, director
  decision batch #78, 2026-09-07, maintainer 「同意」 on option (a)).
  
  **What was wrong.** `tree` is a host-composition-only view type — ruled deliberate on
  objectui#5321, it is a member of neither `ObjectViewSchema.defaultViewType` nor
  `NamedListView.type`, so the branch runs only when a host passes a `views` prop. On
  that path a per-view `tree` block is read at four sites, and its only description
  anywhere was a module-local, non-exported `interface TreeConfig` inside
  `plugin-tree/src/ObjectTree.tsx`. The live host is the console: it stores view records
  and passes them as `views`, and its create-view dialog offers `tree`. So a real
  consumer wrote this block with no type to write it against, and a misspelled
  `parentFeild` was admitted by the views entry's `[key: string]: any`, stored, read by
  nobody and reported by nothing. Declared ≠ enforced on a surface a non-author
  re-writes.
  
  **The grades, and why.**
  
  - `@object-ui/types` — **minor**: one new name, `TreeViewConfig`, becomes reachable
    from the package entry. Nothing existing is renamed, retyped or removed, and no
    value's validation changes anywhere in this package.
  - `@object-ui/plugin-view` — **minor**: `ObjectViewProps.views[n].tree` is now
    declared `TreeViewConfig` where it previously resolved to `any` through the entry's
    index signature. On a face that already admitted every spelling a declaration
    **cannot widen — it can only narrow**, and this one does: a host composing the entry
    as an object literal now gets `parentFeild` reported as an excess property instead
    of silently dropped. The index signature itself is untouched, so every other
    undeclared key a host puts on the entry still type-checks exactly as before.
  - `@object-ui/plugin-tree` — **patch**: the module-local interface becomes an import
    of the exported one and the resolver's own type is `Pick`ed off it. No runtime
    behaviour changes, and no key is added to or removed from what the renderer reads.
  
  **`titleField` was declared, not deleted — and that was a measurement.** The ruling put
  this key to a test: declare it if the console writes it, else remove the read. The
  console's create-view dialog does **not** offer it (its `tree` slot collects
  `parentField` alone), but the console's own host composition reads it by name, so do
  the `ListView` and `ObjectView` tree branches, and that rung is pinned as live behaviour
  by objectui#6557 ("the tree's second view-declared rung … still answers"). Deleting that
  read would have reversed a recorded ruling and reddened that pin, so this change declared
  the key at all four read sites instead. `labelField` remains canonical and wins wherever
  both are present.
  
  ⚠️ **Superseded — the declaration has since been removed.** objectui#8841 (PR
  objectui#9052) settled it against the protocol rather than against the reads:
  `@objectstack/spec@17.4.0`'s `TreeConfigSchema` is a `strictObject` and refuses
  `titleField` on `ListView.tree` by name, so declaring it here published a key an author
  following `@object-ui/types` was refused for at publish. `TreeViewConfig` is now derived
  from that protocol block and no longer carries the key, and `plugin-tree`'s
  `?? schema.titleField` rung — which read the flattened NODE, not this block — went with
  it. ⛔ What did NOT go is the view-declared read objectui#6557 pins: the
  `labelField || titleField` dual-reads in `plugin-view`, `plugin-list` and the console
  survive as undeclared tolerance, so stored view records keep resolving and that pin is
  still green. Read this entry for why the key was declared and objectui#8841's for why the
  declaration could not stand; the migration is to write `tree.labelField`.
  
  **Migration.** None required. Hosts that already compose a `tree` block keep working;
  hosts that annotate one against `TreeViewConfig` start getting a compile error for a
  misspelled key instead of a view that silently ignores it.
  
  ⛔ This does not make `tree` an authorable view type. objectui#5321 is untouched: the
  block is host config, written by a host and never by a document author, and the
  authored node remains the flat `ObjectTreeSchema`.
  
  **Note, 2026-10-01 (objectui#11168 slice 3, shipping in this same release).**
  The last sentence above calls the authored node "the flat `ObjectTreeSchema`".
  `@objectstack/spec` 17.5.0 gave `object-tree` an element row whose `tree` block
  carries `parentField`, `labelField`, `fields` and `defaultExpandedDepth`, and
  `ObjectTreeSchema` now declares that block by reference, so an authored tree
  writes those keys under `tree` rather than flat on the node. The flat spellings
  `ObjectTreeSchema` still carries are the form a host composes. What this entry
  says about the host `tree` view config, `TreeViewConfig` and objectui#5321 is
  unchanged.
- 5226263: **`ObjectView` honours a spec-shaped named list view** (objectui#8254, the
  renderer half objectui#7928's option A requires — decision batch #70,
  2026-09-07 — before `ObjectViewSchema.listViews` is mirrored by reference onto
  `ObjectListViewSchema`).
  
  The protocol declares a named view's `columns` as `string[] | ListColumn[]`;
  the local `NamedListView` declares only `string[]`. Two of the three routes out
  of `ObjectView` end in a NAME slot — `ObjectGridSchema.fields`, and the `fields`
  of the node `generateViewSchema` emits — whose consumers index each record by
  every entry. The named-view segment reached both of them raw, so a named view
  carrying the `ListColumn[]` half arrived as a non-empty field list naming
  nothing: `ObjectKanban` skips its `highlightFields` fallback whenever that list
  is non-empty, so the result rendered worse than an empty one. That is the same
  boundary failure objectui#5269 answered for `table.columns`, and it is answered
  the same way — `viewColumnFieldNames`, the presence-preserving twin of the fold
  already applied to `table.columns`, using `columnIdentity`, this repo's single
  converged reader for "which field does this column entry name".
  
  The union slots on the same branches — `ObjectGridSchema.columns` and the
  delegated `list-view` `columns` — keep taking the authored value raw, because
  their declared shape holds it and narrowing there would drop a column's own
  `label`. One value, two slots, each given the shape it declares.
  
  **Behaviour that moves, spelled out.** A `string[]` named view is byte-identical
  before and after. A named view whose `columns` entries resolve to no field
  identity at all now reaches those two name slots as `[]` instead of as a
  non-empty list of nameless entries — the fix, and the only visible change for
  metadata that is not spec-shaped. Precedence does not move: an authored empty
  `columns` still stops the `||` chain where it stopped before, deliberately
  unlike the `table.columns` fold, whose fall-through to the deprecated
  `table.fields` alias is a precedence decision belonging to that chain alone.
  
  `filter` (spec rule objects, not the local tuple dialect), `sort`, `label` and
  `data` needed no renderer change; they are pinned anyway, because "already
  works" is the claim that rots without an instrument. The stale `as any` on the
  named-view config's `label` read is gone with them — the protocol makes `label`
  optional, and the read already degrades to the host's label without it.
  
  **Conversion note for the mirror that follows.** `ObjectListViewSchema` is
  strict and requires `columns`; the local dialect requires `label` and accepts
  neither. When objectui#7928 lands the by-reference mirror, every authored named
  view in this repo that omits `columns`, or writes the tuple filter dialect
  (`[[field, op, value]]`) instead of rule objects, or carries a local-only key
  (`options`, `showSearch`, `densityMode`, `color`, …) becomes an authoring
  error rather than a silently-dropped key. The population was counted on
  objectui#8254 across `apps/`, `examples/` and `content/` — a historical reading
  taken on that card, not a live count and not re-derived here; re-run the census
  described there before acting on it. The refusals concentrate in the
  documentation examples, so the mirror needs a docs pass shipped with it.
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
- dfe3fa4: **A stray `groupBy` in `viewOptions.kanban` no longer overrides the lane `generateViewSchema` resolved — the second route.**
  
  `plugin-view`'s `generateViewSchema` kanban branch destructured
  `columns`/`groupByField`/`groupField`/`titleField`/`conditionalFormatting` out of
  `viewOptions.kanban` and spread the **rest** *after* its own `groupBy`. A
  `groupBy` surviving in that bag therefore **overrode the lane the branch had just
  resolved** from the canonical `groupByField`, and nothing said so — the board
  simply grouped by the wrong field.
  
  This is the **second route**, not a repeat of objectui#8365. `generateViewSchema`
  runs precisely when no host supplied `renderListView` — the authored
  `object-view` element — so it never passes through `ListView`, and PR
  objectui#9236's destructure fix does not reach it. The same distinction the
  `calendar` branch records for objectui#7029.
  
  **BREAKING** (shipped as `minor`: all 41 packages sit in one `fixed` group, so
  `major` is unavailable and would drag the group off `@objectstack`'s major —
  AGENTS.md "版本号策略"). A **stored view that carries `kanban.groupBy` will now
  render a different lane than it did before**: the canonical `groupByField` wins,
  or — with no declared key at all — this branch's floor. That re-pointing is the
  ruled intent, not a side effect, but it is a real change to what an existing
  board displays and is stated here for that reason.
  
  The reach of the contract half was measured rather than assumed. PR
  objectui#9236 landed it on the **`list-view`** route — the view-level
  `KanbanConfig` mirror declares `groupBy` as a named alias refusal pointing at
  `groupByField`, so a `list-view` document carrying the key, under `kanban` or
  under the legacy `options.kanban` bag, is refused by `safeValidateSchema`. A
  named view's `listViews.KEY.kanban.groupBy`, the route this change repairs, is
  not reached by that arm; it gets its own door separately (objectui#10321), which
  refuses the key in either nesting with the same message. `tsc` refuses the
  declared `kanban.groupBy` at the authoring site on both routes (a named view's
  `kanban` is typed as the `list-view`'s), but not the key inside the untyped
  `options.kanban` bag on either. A door reaches neither a document already in
  storage nor one that never passes through a validator, so what this change
  repairs is a pure **behaviour** gap, on any document that reaches this branch
  carrying the key.
  
  ⚠️ **Dated note, 2026-09-28 — the named-view route's two faces have since changed —
  objectui#7928.** Later in this same release a named view became the protocol's strict
  `ObjectListViewSchema` record, by reference, on both faces. On the zod face the
  objectui#10321 door adds its message at `listViews.KEY.kanban.groupBy` only: the record
  refuses the `options` bag whole (`options` by name), so "refuses the key in either
  nesting with the same message" no longer holds. On the TypeScript face a named view's
  `kanban` is typed as the protocol's kanban block, not the `list-view`'s: `tsc` still
  refuses `kanban.groupBy` there, as an excess property on an object literal rather than a
  `never` member, and it now refuses the `options` bag itself. The `list-view` route is
  unchanged on both faces. `.changeset/7928-listviews-by-reference-fold.md` (PR
  objectui#10821) states what ships; the text above is kept as the reading of this change.
  
  Maintainer ruling of 2026-09-12 (decision batch #117 item 5, verbatim
  「8365 同意」) — option B. Option A (strip the key and silently re-group) was not
  taken. This card applies that ruling to the second route; it re-opens nothing.
  
  **One measured difference from the `ListView` twin, and it is not cosmetic.**
  This branch floors the lane at the **literal** `'status'`
  (`groupByField || groupField || 'status'`), where `ListView` floors at
  `detectStatusField(objectDef)`. So with the stray key alone, this route answers
  `'status'` — measured on this tree, including against an object that declares no
  `status` field — where the twin would answer `undefined`. The twin's assertion
  for that arm was therefore **measured here rather than copied**, and both rows
  are pinned so that "aligning" the two routes by swapping in the detector reddens
  instead of passing quietly.
  
  Level justified by measurement, not intuition:
  
  - **Nothing stops rendering** — no crash, no new refusal at runtime; the board
    keeps rendering, with a different (correct) lane.
  - **Nothing stops type-checking** — the type face (`groupBy?: never` on the
    inferred authoring surface) already landed with PR objectui#9236.
  - **What an author can author is unchanged by this change** — it touches no
    schema: a `list-view` document carrying the key is refused, and a named view
    carrying it is refused by the door objectui#10321 adds separately. For a
    document that carries the key anyway, it is this branch, which now drops the
    key, that keeps the lane canonical.
  
  Untouched, deliberately: the contract half (both routes' doors live in
  `@object-ui/types`), the **live** legacy alias `kanban.groupField`, `groupBy`
  on the generated `object-kanban` node (the canonical lane key `ObjectKanban`
  reads), and
  `ListView` itself. The `restKanban` passthrough is kept — an undeclared sibling
  key still rides through onto the node, pinned as a control.
- 641fb55: The `FilterBuilder` dropdown speaks the protocol's operator ids (objectui#9306).
  
  `defaultOperators` now emits the twenty members of `@objectstack/spec`'s
  `VIEW_FILTER_OPERATORS`, spelled as the spec spells them (`not_equals`,
  `greater_than_or_equal`, `is_null`, `icontains`, …), plus the two opt-in
  existence ids `exists` / `notExists`, which the protocol has no member for and
  which stay unfolded (objectui#9559 ruling B). The camelCase ids the dropdown used
  to emit (`notEquals`, `greaterOrEqual`, `isNull`, …) are the spec's deprecated
  alias form (objectui#7993); `containsCaseInsensitive` is the one former id the
  spec's alias table has no row for, and the builder reads it itself (below).
  
  **Stored filters keep loading.** The builder folds a stored spelling at its read
  boundary, through the spec's `normalizeFilterOperator` plus one local row the
  spec's alias table lacks (`containsCaseInsensitive` → `icontains`,
  objectstack-ai/objectstack#20092), and the author's next edit writes the
  canonical id back. Opening a stored filter writes nothing. No row changes the
  predicate it stores: the sharing-rule criteria, the dataset filter, the saved-view
  fold, the live grid and the override recovery pass were each measured over all
  22 former ids against the ids they became, and store the same predicate. The only
  cells that differ are `icontains` on the three consumers that never offered the
  case-insensitive contains (dataset filter, saved-view fold, live grid), where
  the old id produced no storable filter at all and the new one does.
  
  **Breaking, stated here because the group never takes a `major`:**
  
  - `@object-ui/components`: the published `FilterBuilderOperator` type NARROWS
    from the camelCase union to the spec's `ViewFilterOperator` plus `'exists' |
    'notExists'` — a `'greaterOrEqual'` literal typed against it no longer
    compiles. `FILTER_BUILDER_OPERATORS` and `VALUELESS_FILTER_BUILDER_OPERATORS`
    hold the canonical ids, and a host's `onChange` receives them. New export:
    `normalizeFilterBuilderOperator`, the builder's read-side fold.
  - `@object-ui/components`: `icontains` ("Contains (ignore case)") is no longer
    opt-in. Its old reason — only the Mongo criteria dialect could carry a
    case-insensitive contains — stopped being true when `VIEW_FILTER_OPERATORS`
    gained `icontains` (spec 17.1.0), and `OPT_IN_OPERATORS`' own docblock recorded
    deleting the entry as the planned outcome. It is offered on the text bucket to
    every consumer; `contains` and `icontains` stay two operators (objectui#7379).
  - `@object-ui/i18n`: the `filterBuilder.operators.*` keys are re-keyed to the
    canonical ids in all ten packs (`filterBuilder.operators.is_null`, …); every
    translated value is unchanged. A host that overrides one of these keys must
    re-key its override.
  - `@object-ui/fields`: `FILTER_CONDITION_EXTRA_OPERATORS` is `['exists',
    'notExists']` — the case-insensitive contains needs no grant any more.
    `FilterConditionField` still writes `$icontains` for it, and its builder rows
    (`kvToCondition`) carry the canonical ids.
  - `@object-ui/plugin-view`: `toFilterGroup` emits the canonical ids.
  
  Also in `@object-ui/app-shell`: the dataset inspector's bridge maps `icontains`
  to `$icontains`; the drill-down "is null" chip reads the re-keyed label; and the
  view-override recovery pass folds a row's operator before its value-less check,
  so a stored `{ operator: 'isEmpty', value: '' }` row is kept rather than dropped
  as unfinished.
- f0f3cd5: Forward the row-click modifier payload through the three hops that were dropping it
  (objectui#9462), so Cmd/Ctrl/middle-click on a row reaches a host handler.
  
  `useNavigationOverlay`'s `handleClick` has always invoked the handler it is given with
  two arguments — the record, and the modifier payload (`metaKey` / `ctrlKey` / `button`)
  a host needs to answer "open this record in a new tab". objectui#9360 made the hook's
  option declare that payload and objectui#9460 made the component props on the path
  declare it. Three hops in the middle received it and passed one argument on, so a host
  wiring a modifier-click handler to `ObjectGrid`, `ListView` or `plugin-view`'s
  `ObjectView` always read `undefined` as the second argument and the click silently
  degraded to an ordinary navigation.
  
  **What changed.** `data-table`'s renderer now forwards the DOM event from both of its
  call sites — the row's own click handler and the hover "open record" button, whose
  handler had already bound the event as `e` for `stopPropagation` and still did not pass
  it on. `plugin-view`'s `ObjectView` forwards it from `handleRowClick` to the component's
  own `onRowClick` prop. The payload's contents are unchanged: this is a forward, not a
  redefinition.
  
  **Declarations widened with the hops, and only those.** `DataTableSchema.onRowClick`
  (`@object-ui/types`) and `ObjectViewProps.onRowClick` — plus the `onRowClick` that
  `ObjectView` hands a host's `renderListView` — now declare
  `(record, event?)`. `ObjectViewProps` is exported from `@object-ui/plugin-view`'s entry,
  so this moves a published declaration. Source-compatible in both directions: a
  one-parameter handler still satisfies the widened prop, and the second parameter is
  spelled `any`, so a handler that annotated it `React.MouseEvent` is not refused
  contravariantly.
  
  **Not in this change.** `ObjectDataTableSchema.onRowClick` (`@object-ui/types`) feeds
  the same `data-table` channel and therefore now receives the payload too. Its
  declaration was widened separately, by objectui#9799, rather than here.
- 87af769: **BREAKING** — a record id is a **string** wherever metadata names one, and on the last
  `DataSource` door (objectui#9511). An authored `recordId: 42` / `resourceId: 42` no longer
  validates.
  
  **FROM** `string | number` **TO** `string`, on both published faces of three authorable keys
  and on `DataSource.findOne`:
  
  ```jsonc
  // before — accepted
  { "type": "detail", "resourceId": 42 }
  // after — refused at parse, with the repair named in the message
  { "type": "detail", "resourceId": "42" }
  ```
  
  **What an author sees, in business terms.** If you write a record id as a bare number today,
  your metadata stops validating the moment you upgrade, and the error tells you what to write:
  quote it. `42` becomes `'42'`. ⛔ **Nothing converts for you, in either direction** — that is
  deliberate, not an omission. The platform is not guessing whether your `42` meant the string
  `'42'` or something else; a host whose primary keys are numeric does the conversion once, at
  its own adapter boundary, so every author, every caller and every adapter downstream sees one
  shape. The wire traffic for such a host was already `'42'` on `update` (objectui#9333) and on
  `delete` / `bulkUpdate` / `bulkDelete` (objectui#9712); this change makes `findOne` agree
  instead of being the one door that disagreed.
  
  **The three authorable keys, each on BOTH faces.** `ObjectFormSchema.recordId`
  (`objectql.ts` + `zod/objectql.zod.ts`), `DetailViewSchema.resourceId` (`views.ts` +
  `zod/views.zod.ts`) and `DetailSchema.resourceId` (`crud.ts` + `zod/crud.zod.ts`). ⚠️ The
  `crud` pair is **`DetailSchema`**, not `DetailViewSchema`, and it reaches the same renderer —
  not by symbol but by data flow: `plugin-detail` registers the `'detail'` node type onto
  `DetailView`. A read that follows TypeScript symbols alone finds two keys and is incomplete.
  
  ⭐ **The declaration alone would not have been enough, and this is the reusable part.** A
  TypeScript declaration does not run at parse time. The hand-written zod mirror is the only
  face in this repository that can refuse an authored number, so narrowing the declaration
  without the mirror would have shipped `declared !== enforced` on a published surface — and
  `zod-mirror-parity.test.ts` would have stayed GREEN through it, because that instrument
  asserts a mirror accepts everything its declaration declares and a mirror left WIDER passes.
  Both faces moved together for that reason.
  
  **Disposition: an ADR-0087 D2 narrowing that ships `minor` with this banner, ⛔ not a
  tombstone and ⛔ not an npm `major`.** The key stays declared and writable; only its accept
  set narrows, so there is no `never` member and no `retirementTombstone()`. Pre-GA, a
  metadata-facing break ships `minor` carrying the `**BREAKING**` banner and its ADR-0087
  disposition — the level is not the carrier of breaking-ness during the window, the banner and
  this line are (ADR-0087, amended 2026-09-13). `major` is refused outright here anyway: all
  publishable packages sit in one `fixed` group pinned to the `@objectstack` major
  (AGENTS.md §版本号策略, enforced by `scripts/check-changeset-no-major.mjs`).
  
  ⚠️ **No live conversion entry ships with this.** A D2 conversion table lives in
  `@objectstack/spec`, and these three keys are objectui's own vocabulary rather than spec keys,
  so there is no table here to add a row to; the repair is also lossless and mechanical in a way
  a table would not improve (`42` to `'42'`). An author is given the prescription at the point
  of refusal instead. Recorded rather than left silent, because ADR-0087's post-GA ladder does
  require a live entry and this is the pre-GA spelling of the same obligation.
  
  **The accept set moved in exactly ONE direction, measured — 45 documents across the three
  mirrors, parsed on this branch and on the merge base:**
  
  | reading | count |
  | --- | --: |
  | GREEN to RED | **9** — the three keys x integer / negative / float, and nothing else |
  | **RED to GREEN** | **0** |
  | verdict unchanged | 36 |
  | refusals carrying the prescription | **9 / 9** |
  
  Controls on the same instrument and corpus: **lit** — `title: 42` / `objectName: 42`, keys
  that were string-only before this change, still refuse with `invalid_type`; a wrong `type`
  literal still refuses; **green** — the key absent, `'42'`, `'rec_1'` and `''` all still parse;
  **red-both (21 rows)** — object, array, boolean and `null` at the same key were refused before
  and are refused now, which is the half of the corpus that shows nothing was loosened while the
  number arm was removed.
  
  **Delivery surface — where the refusal does and does not arrive.** PARSE-TIME on the mirror
  (`@object-ui/types/zod`, so `objectui validate` and any consumer calling `safeParse`) and
  COMPILE-TIME on the declaration (`tsc`). ⚠️ As with every other key on these mirrors, the
  runtime render path does not parse through them, so a rendered document is not where this
  arrives.
  
  ⚠️ **Dated note, 2026-09-25 — `objectui check` does not deliver this refusal —
  objectui#10524.** This entry first listed `objectui check` on the parse-time side. `check` is
  an advisory sweep: it never parses against the schema a file whose root carries a structural key (`children`,
  `className`, `body`, …), it lists a file with none of those keys by name when the file does
  not validate, and it exits non-zero on unreadable JSON only. The refusal is
  `objectui validate`'s.
  
  **Consequential narrowings, all compiler-forced by the door above.** `DrawerForm`,
  `ModalForm`, `SplitForm`, `TabbedForm` and `WizardForm` each declare their own `recordId` and
  hand it straight to `findOne`; `ObjectForm` builds all five from the authorable
  `ObjectFormSchema`, so they move together or the refusal simply relocates onto the hand-off
  site. Two more fell out of the same narrowing and are named because they are NOT obvious:
  
  - `@object-ui/plugin-grid` — `BulkActionDialogProps.dataSource` hand-restates `findOne`. It
    declares it as a **property**, not a method, so it is checked contravariantly where the
    interface's own method declarations are bivariant. ⇒ this is the one shape in the tree where
    narrowing the protocol reddens a consumer rather than passing it by, and that file's own
    comment had already predicted it.
  - `@object-ui/plugin-view` — `ObjectView.buildFormSchema` asserted an untyped record bag's id
    as `string | number | undefined`. The assertion now states the protocol. ⛔ Deliberately not
    `String(...)`: a reader-side coercion is the option the ruling refused.
  
  **Ruling.** Director batch #195 item 1, letter **A**, maintainer 「同意」 2026-09-20, standing
  on batch #136 item 5 letter **B**. **B** (leave the fifth door wide and document the asymmetry
  as deliberate) and **C** (convert at each reader) were both refused — C by name, because eight
  conversion sites contradict the rule's own aim that the conversion live in one typed place.
  
  **Pins.** `data-source-id-surface-9511.test.ts` gains the `findOne` rows it previously and
  deliberately withheld, plus an absence row so the retired "this door is held open" prose
  cannot return. `authorable-record-id-string-9511.test.ts` is new and pins the parse half —
  the refusal, its prescription, the string spellings, and both control directions.
  
  ⚠️ **The ruling's execution note asks for the `KnownDrift` / mirror-parity ledger rows to
  shrink in the same change; that is an instruction over an EMPTY SET.** Measured in
  `zod-mirror-parity.test.ts`: `resourceId` appears **0** times and `recordId` **1**, and that
  one hit is prose about an `onNavigate` signature rather than a ledger row. There is nothing to
  shrink, and it is said here so the next reader does not go looking for rows that never existed.
- 687353f: `ObjectView` opens a Cmd/Ctrl/middle-clicked row in a new browser tab (objectui#9806).
  
  Before this change, a Cmd-click, Ctrl-click or middle-click on an `ObjectView` row did
  exactly what a plain click did. The row-click hook has a modifier branch, but it returns
  early on any `onRowClick` it is given, and `ObjectView` always gives it one: its own
  `handleRowClick`. That branch never ran for this component.
  
  **What changed.** When no host `onRowClick` is supplied, `ObjectView` now reads the
  modifier payload itself and opens the record as a full page in a new browser tab. This
  matches what a bare `ObjectGrid` already does. The tab opens at the URL that
  `navigation.mode: 'new_window'` already uses, so the component has one new-tab URL.
  
  **What did not change.**
  
  - If a host supplies `onRowClick`, the host gets the click and its modifier payload and
    makes the whole decision, as before. The hook's early return is unchanged.
  - An inert row stays inert. A modifier click does nothing under `navigation.mode: 'none'`
    or `preventNavigation`, and it does nothing under `operations.read: false` when no
    navigation config is set. A modifier changes where a record opens. It never changes
    whether the record opens.
  - `schema.onNavigate` is never called with `'new_window'`. Its declared second parameter is
    still `'view' | 'edit'`.
- 0e2ddd4: **`NamedListView` declares the 17 members the protocol declares on the same
  surface, and each one now has a read point** (objectui#8980, director-seat
  class-one adjudication of 2026-09-13, under the maintainer's standing principle
  that the objectstack protocol is the source of truth and objectui catches up to
  it rather than the other way round).
  
  `appearance` `calendar` `chart` `data` `fieldOrder` `gallery` `gantt` `grouping`
  `kanban` `map` `name` `pageName` `rowColor` `tabs` `timeline` `tree`
  `userActions` — all seventeen were declared by `ObjectListViewSchema`
  (`@objectstack/spec/ui`), the declared value type of both `ViewSchema.listViews`
  and `ObjectSchema.listViews`, and by none of them by `@object-ui/types`. An
  author writing the shape the protocol teaches got a view that rendered as though
  nothing had been configured, with no diagnostic anywhere.
  
  **Types are taken from the protocol, not restated.** Sixteen index this
  package's own spec-derived `list-view` node type (`ListViewSchema`), whose
  members arrive from `SpecListViewSchema.shape` by reference — the derivation
  `NamedListView.userFilters` already used, and the one that keeps a named view
  and the `list-view` node it is relayed into the same type for every key that
  crosses. `name` indexes the protocol's own published authored type (`ListView`,
  `@objectstack/spec/ui`) directly, because on the node that spelling resolves
  through `BaseSchema.name` — the component-name slot, a different contract
  wearing the same word.
  
  **What an author can now do that silently did nothing before:**
  
  | key | reaches |
  | --- | --- |
  | `kanban` `calendar` `gallery` `timeline` `gantt` `map` | the renderer `ObjectView` dispatches to for that `type` — `ObjectKanban`, `ObjectCalendar`, `ObjectGallery`, `ObjectTimeline`, `ObjectGantt`, `ObjectMap` — at the protocol's own top level. The legacy `options.<kind>` nesting keeps working; a canonical block wins key-by-key over it, so a partially declared block does not blank its legacy neighbour |
  | `chart` `tree` | the same dispatch, on the one route objectui#5321 leaves open to a named view (it declares no `type`, a host `views` entry selects the kind) |
  | `grouping` `rowColor` | `ObjectGrid` on the authored grid path, and `ListView` through the host delegation |
  | `fieldOrder` `appearance` `userActions` | `ListView` through the host delegation. `fieldOrder` is the live third key of the protocol's `columns` × `hiddenFields` × `fieldOrder` composition (objectstack#15184 ruling B) |
  | `data` | `ListView` — and the `as any` cast the renderer used to reach this key through is gone, which answers objectui#7928's open half |
  | `name` | the named-view tab strip, between `label` and the record key |
  
  **Two members are declared and NOT read, and that is the ruled outcome rather
  than an oversight** — the ruling requires a member with no renderer behaviour to
  be reported with its measurement, never silently dropped from the type.
  `tabs` on the list shape is the `ViewTabSchema[]` multi-tab definition list (not
  `userFilters.tabs`, which the protocol omits from an object view as page-only),
  and objectui's tab bar for an object is the host-owned saved-view switcher
  (ADR-0053). `pageName` configures the protocol's `type: 'page'` branch, and
  `page` is not a member of `NamedListView['type']`. Both measurements are reported
  on objectui#8980.
  
  **Compatibility.** Every addition is an optional member, and every read is a new
  rung whose source could not be authored before this change — so on existing
  documents the renderer produces the same nodes it produced before, proven by an
  absence-control case beside each fix. The 19 legacy spellings `NamedListView`
  declares beyond the protocol are objectui#7924's remedy and are untouched.
  
  ⚠️ **Dated note, 2026-09-29 — two members named above were retired in this same release — objectui#11073.**
  Later in this release this repository began resolving `@objectstack/spec` 17.5.0, which retired `pageName` and the list view's `tabs` (and the `type: 'page'` branch `pageName` configured) under ADR-0049 enforce-or-remove. Following the same standing principle this change cites, `NamedListView` no longer declares either as a member. Both are tombstones, typed `never` and refused by name at parse. So the table of seventeen above is fifteen live members plus those two, and "declared and NOT read" no longer describes `tabs` or `pageName`: neither is accepted.
- 4ef29f0: Remove the inert `showRefresh` designer input from the `object-view` registration (objectui#5567).
  
  The `object-view` designer no longer offers a "Show Refresh Button" toggle, and the registration no longer defaults `showRefresh: true`. The key was declared, documented, and defaulted, but `ObjectView` never read it — an author who wrote `showRefresh: false` on an `object-view` node always got a no-op. **Behaviour is unchanged for every existing app**, because nothing ever consumed the key.
  
  Migration: nothing to do. If you wrote `showRefresh` on an `object-view` node, the key simply disappears from the designer's property panel; it never controlled anything. The live refresh channel is `userActions.refresh` (rendered by the list toolbar in `@object-ui/plugin-list`), which is unaffected. `showRefresh` on other surfaces (e.g. `CRUDToolbar`) is also unaffected.
  
  `@object-ui/app-shell` only drops its two producer writes of the dead key (the app `ObjectView` wrapper and the metadata-admin `ViewPreview`) — no user-visible change.
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

- 8e49a99: A save, delete or other write no longer rebuilds the object view it happened in — the view refetches its rows in place and keeps its component state (objectui#10035).
  
  Both `ObjectView` layers carried their refresh counter in a React `key`, so every write remounted the whole view and reset everything held in it: a calendar jumped back to the current month and its default mode, the object page's list lost its scroll position and the visualization picked in its own switcher. The counter now reaches the rendered view as a data signal instead:
  
  - `@object-ui/app-shell`: the object page hands its refresh counter to `ListView` as `refreshTrigger`, the input `ListView`'s fetch already follows, and keys the list on the object and view alone.
  - `@object-ui/plugin-view`: kanban, calendar, gallery, timeline, map and tree views keep their instance across a write and receive the refetched rows.
  
  Views whose renderer fetches for itself — gantt and chart views in both layers, any object-page list whose visualization whitelist offers gantt or chart, and the standalone grid `plugin-view` renders when no host list view is supplied — refresh in place too, through the data-invalidation bus; see the `plugin-grid` / `plugin-gantt` / `plugin-charts` note for objectui#10035 in this release.
- 3759c56: Gantt, chart and grid views refresh in place after a write instead of being rebuilt (objectui#10035).
  
  `ObjectGrid`, `ObjectGantt` and `ObjectChart` query for themselves and read no refresh input, so both object-view layers could show them a write only by remounting them — which lost a gantt's scroll, collapsed groups and zoom, a chart's open drill-down, and a grid's selection, column state and in-progress edit. Each now refetches when the data-invalidation bus (`notifyDataChanged` / `useDataInvalidation` from `@object-ui/react`) reports a change to the object it reads:
  
  - `@object-ui/plugin-grid`: `ObjectGrid` re-reads its rows into the same table.
  - `@object-ui/plugin-gantt`: `ObjectGantt` re-reads silently and keeps the chart mounted, as its toolbar refresh does.
  - `@object-ui/plugin-charts`: `ObjectChart` re-runs its query on both binding shapes — an object-bound aggregate follows its `objectName`, a dataset-bound chart follows the dataset's base object as the `queryDataset` answer names it.
  - `@object-ui/plugin-view`: the object view keys every view on its identity alone, and declares on the bus its own saves and deletes and each `onMutation` write it hears.
  - `@object-ui/app-shell`: the object page keys its list and its chart view on identity alone, and declares on the bus the changes it learns of without a data-source write — server actions, flows, imports, realtime events and an explicit refresh.
  
  Rows a host hands these components (`data`, `bind`, inline values) are still the host's to refresh; only the components' own queries follow the bus.
- b07de29: fix(plugin-view): a read-only view's menus no longer open empty or on a leading separator
  
  `ManageViewsDialog`'s row `…` trigger rendered whenever a callback was wired, while
  every entry under it was also gated on the view being editable. On a read-only row
  with the console's props (no `onDuplicate`), the trigger opened an empty 180px strip of
  popover. `ViewTabBar`'s tab dropdown and context menu drew each separator on its own
  condition, so a read-only tab's menu opened on a separator above "Manage all views…";
  a read-only tab with no `onManageViews` opened an empty dropdown and an empty context
  menu.
  
  Each menu now resolves its entries once. The trigger renders only when at least one
  entry renders, and a separator is drawn only between two groups that both rendered.
  Editable views keep every entry they had. `ManageViewsDialog` no longer offers Rename
  (menu entry or double-click) when the host wires no `onRename`, since committing it
  would call nothing.
- 6c2f3c5: `ObjectView` resolves the spec's context tokens in the filters it hands on (objectui#10506).
  
  A per-user named list view, `{ field: 'owner', operator: 'equals', value: '{current_user_id}' }`,
  reached the query with the literal token on the registered `object-view` node: this component
  had no read of `@object-ui/core`'s `resolveFilterPlaceholders`, while the app-shell host resolved
  the same view.
  
  The three authored filter segments (the active view's filter, `table.filter`,
  `table.defaultFilters`) are now resolved once through that shared resolver, with the session
  scope the host provides through `useFilterScope` (the console shell mounts `FilterScopeProvider`
  from the signed-in user and the active organization). All three paths a filter leaves this
  component by read the resolved segments: the query a non-grid view issues, the `object-grid`
  schema handed to `ObjectGrid`, and the `list-view` schema handed to a host's `renderListView`.
  The relative-date macros (`{today}`, `{current_quarter_start}`, …) resolve in the same call, in
  the browser's local time, as they already did on the surfaces that call the resolver: the
  app-shell host, `ObjectChart` and the dashboard widgets. (A directly authored `object-grid` or
  `list-view` node calls it too, since objectui#10607.) Where they used to reach a backend that resolves them
  itself, as the ObjectStack server does in the tenant's configured `localization.timezone` (UTC by
  default), a browser whose local day differs from the server's day can now get a different day.
  
  A token the scope cannot resolve is left as written and the resolver warns once, which is the
  resolver's own rule, so the filter is never widened. With no `FilterScopeProvider` mounted, what a
  literal `{current_user_id}` then selects depends on the backend: the ObjectStack server resolves
  it for a signed-in request and refuses the request otherwise (the REST face answers 401 at its
  auth gate before the filter is read, and where a guest context reaches the engine the resolver
  answers 400), and a backend with no resolver of its own matches no record.
  
  The resolved value is held against its inputs: the raw segments, compared by structure, and the
  scope's three members (`currentUserId`, `currentOrgId`, `onUnresolved`), each compared on its own.
  `ObjectGrid` and `ListView` key their fetch on the filter's identity, so a host that re-renders
  without changing anything does not trigger a refetch. Date macros are resolved once and held until
  the user, the organization or a segment changes, so `{now}` and `{today}` do not produce a new
  value on every render of this component: that governs the query a non-grid view issues, the grid,
  and a `renderListView` host that queries with the filter it is handed. The console's app-shell
  host is not such a host: its `renderListView` resolves the active view's own filter itself
  (`viewDef.filter ?? listSchema.filter`, with no filter segment in the schema it gives this
  component; the active view's filter still reaches this component through the `views` prop), so
  its date macros and its `'current-user'` fallback for a signed-out user are unchanged. A host that resolves the handed value again, as the app-shell's fallback would, changes
  nothing: a resolved id or date no longer matches the placeholder pattern. With no user in scope,
  this component's pass warns; the app-shell's own pass substitutes `'current-user'` silently, as
  before, so the console's query is unchanged and the one difference is that warning.
  
  `@object-ui/core`'s two placeholder walks (`resolveContextTokens` and `resolveDateMacros`, both behind
  `resolveFilterPlaceholders`) now return a non-plain object as the same instance instead of rebuilding
  it from its own keys, so a `Date` comparand, which the spec admits, no longer comes back as `{}`;
  plain and null-prototype objects are still walked. A non-plain object is a leaf whatever it is: a
  class instance with own keys carrying a token is also returned as the same instance, no longer
  copied and resolved. The contract review of this change found no in-repo caller that passes one.
- 3d17a97: `filter-ui`, `sort-ui` and `view-switcher` no longer crash when an authored
  document sets their event-name key (`onChange`, or `onViewChange` on the
  switcher).
  
  These keys hold the NAME of a `CustomEvent` dispatched on `window`
  (objectui#6124). `SchemaRenderer` also passes these keys through to the component
  as React props, so the authored string reached the component's callback prop
  of the same name. The component called that prop, so the first interaction
  threw `TypeError: onChange is not a function` (or `onViewChange`) and the event
  was never dispatched. This form rendered through `SchemaRenderer` crashed:
  
  ```json
  { "type": "sort-ui", "fields": [{ "field": "name" }], "onChange": "myapp:sort-changed" }
  ```
  
  The three controls now call the prop only when it is a function, and dispatch
  the event named on the schema. The listener below receives `e.detail.sort`
  (`e.detail.values` for `filter-ui`, `e.detail.view` for `view-switcher`):
  
  ```js
  window.addEventListener('myapp:sort-changed', (e) => e.detail.sort);
  ```
  
  A React host that passes a function through `SchemaRenderer` is unaffected.
  Its function is called first with the new value. The authored event, if one is
  named, is then dispatched as before.
- 7afc81d: The object view's own read for a non-grid view (calendar, kanban and the other views it fetches for) re-reads when `table.sort` changes (objectui#10664).
  
  That read falls back to `table.sort` for its `$orderby` when neither the named view nor the active view declares a sort, but a change to `table.sort` alone did not re-run it, so the view kept the old order. It now keys the read on that sort's content, so an equal sort in a new array does not re-read.
- 35d68c4: `ObjectView`'s host delegation reads the rest of a named view's protocol members off the named view (objectui#10758).
  
  A host that composes `ObjectView` with both `listViews` and its own `renderListView` receives a `list-view` node for the active view. Twenty-three members the protocol declares on a named view (`ObjectListViewSchema`) never came off the named view on that node: the delegation took them from the host `views` entry or the object-view node only, so a named view authoring one of them was accepted and rendered with some other value. This is bucket ① of the objectui#7924 ruling.
  
  Each of them is now read off the active named view first, then the host `views` entry, then the node where that rung already read it:
  
  - list chrome: `description`, `compactToolbar`, `allowPrinting`, `showRecordCount`, `sharing`, `aria`, `emptyState`;
  - record actions: `addRecord`, `inlineEdit`, `rowActions`, `bulkActions`, `bulkActionDefs`, `exportOptions`;
  - grid presentation: `rowHeight`, `pagination`, `selection`, `resizable`, `hiddenFields`, `conditionalFormatting`;
  - search, filter and navigation: `searchableFields`, `filterableFields`, `userFilters`, `navigation`.
  
  `description`, `exportOptions` and `bulkActionDefs` had no rung before and are read off the two views only, never off the node, so the objectui#5097 host-composition exemption keeps its 27 names. A named view's `rowHeight` is read as itself; the host `views` entry still goes through the density fold.
  
  What moves for a host: where the active named view and the host `views` entry both carry one of these members, the named view's value now wins. A named view that carries none of them hands down exactly what it did before. The registered `object-view` renderer passes no `renderListView`, so an authored node is unaffected.
- b73e15b: The registered `object-view` renderer reads a named grid view's own grid members off the named view (objectui#10885).
  
  `object-view` is registered without a `renderListView`, so an authored node, and the Studio's view preview (which renders a stored view through `SchemaRenderer`), draws a grid view as the `object-grid` node `ObjectView` builds for `ObjectGrid`. That node read `columns`, `filter`, `sort`, `grouping` and `rowColor` off the active named view and nothing else, so a stored or authored grid view's `rowHeight`, `pagination` and the rest were accepted and not shown.
  
  It now also reads, off the active named view first, ten members the protocol declares under the same name on both a named view and `object-grid` and that `ObjectGrid` reads: `pagination`, `selection`, `rowHeight`, `resizable`, `searchableFields`, `conditionalFormatting`, `rowActions`, `bulkActions`, `bulkActionDefs` and `exportOptions`. `pagination` and `selection` still fall back to the node's `table` when the named view omits them; at this change the others have no node fallback on this path, as before. Three other members declared on both, `label`, `data` and `navigation`, are still not read off the named view on this path.
  
  A named view's `hiddenFields` is applied the way the protocol composes it: the hidden fields are removed from the column projection the grid receives. Only a declared projection is narrowed; with no `columns` anywhere the grid still derives its own.
  
  What moves: only a grid view that authors one of these members. A named view that carries none of them renders exactly as before, and the host `renderListView` delegation is unchanged.
  
  `Clause-②: no` — no declared type, accepted key or published export moves. A renderer starts honouring members the spec already declares on a named view and the grid already reads.
  
  ⚠️ **Dated note, 2026-09-28 — `navigation` has since been read off the named view — objectui#10885.** Later in this same release, the row click on this path follows the active named view's `navigation`, which replaces the node's `navigation` as a whole, and so do the surface and width of the forms it opens. The host `renderListView` delegation's row click follows it too, because both paths hand down the same click handler. A host `onRowClick` passed to `ObjectView` still wins on both paths. The same change applies a named view's `fieldOrder` to the projected columns, after `hiddenFields`, and hands the grid its `inlineEdit`, which `ObjectGrid` still gates on the object's inline-edit grant. `label` and `data` are not handed to the grid on this path, by ruling: `label` is already the tab's text, and `data` waits on objectui#10971. The rest of this entry is kept as the reading of this change; the objectui#10885 member 4 entry states what the path reads now.
  
  ⚠️ **Dated note, 2026-09-29 — every one of these members now falls back to `table` — objectui#10976.** Later in this same release the node's `table` is the fallback of each of the ten members above, and of `inlineEdit` as `table.editable`, on this path; the named view still wins where it declares the member. The other grid keys the `table` slot relays reach the grid on this path too, `label` among them: a `label` written on `table` is now the grid's caption and export view label on this path, which supersedes, for `table.label`, the 2026-09-28 note's sentence that `label` is not handed to the grid; the named view's `label` is still not read, and `table.data` is withheld by the slot and refused by name. The rest of this entry is kept as the reading of this change; the objectui#10976 entry states what ships.
- 4d22e33: A named view's `navigation`, `fieldOrder` and `inlineEdit` now reach the registered `object-view` renderer's grid (objectui#10885, member 4).
  
  `object-view` is registered without a `renderListView`, so an authored node, and the Studio's view preview, draws a grid named view as the `object-grid` node `ObjectView` builds for `ObjectGrid`. That path now reads three more members off the active named view:
  
  - `navigation` replaces the node's `navigation` as a whole while the named view is active. Everything `ObjectView` derives from it follows: the row click, the surface the record, create and edit forms open on, and that surface's width. Under a named `split` or `popover`, as under the node's own, the New button opens no form, because those two surfaces open only beside a selected record. The host `renderListView` delegation's row click follows it too: both paths hand down the same click handler, and until now that handler read the node's `navigation` only, so a named view's `navigation` was overruled there as well. A host `onRowClick` passed to `ObjectView` still wins on both paths.
  - `fieldOrder` orders the projected columns, after `hiddenFields` has removed its fields, the same way `ListView` orders them on the delegation. Columns `fieldOrder` does not name keep their order after the named ones. A name the projection does not carry orders nothing, and with no projection nothing is added.
  - `inlineEdit` is handed to the grid as `editable`. `ObjectGrid` still turns in-cell editing on only where the object grants inline edit and the user may update the record.
  
  At this change `label` and `data`, also declared on both a named view and `object-grid`, are not handed to the grid on this path, by ruling. The named view's `label` is already the tab's text, and handing it to the grid would paint a second caption the delegation never paints. `data` is held back because `ListView` and `ObjectGrid` pick different objects when `data.object` differs from the node's `objectName` (objectui#10971).
  
  What moves: only a named view that authors one of these three members. The objectui#5097 host-composition relay is unchanged.
  
  `Clause-②: no` — no declared type, accepted key or published export moves. A renderer starts honouring members the spec already declares on a named view.
  
  ⚠️ **Dated note, 2026-09-28 — the New button now opens a create form under `split` and `popover` — objectui#10975.**
  Later in this same release, under a `split` or `popover` navigation, the node's own or the active named view's, the New button's create form opens on the surface the node uses with no `navigation`: the modal for `layout: 'modal'`, the drawer otherwise. A record opened to view or edit still opens beside the list. The sentence above that says the New button opens no form is kept as the reading of this change; the objectui#10975 entry states what ships.
  
  ⚠️ **Dated note, 2026-09-29 — a `label` written on `table` now reaches the grid on this path — objectui#10976.**
  Later in this same release the registered renderer hands the grid on this path a `label` written on the node's `table`, and the grid draws it as its caption and uses it as its export view label, as it already did with `table.title`; the host `renderListView` delegation does not take it. The named view's `label` is still not read on this path. `data` is not handed to the grid on this path either way: the `table` slot withholds `data` and the validator refuses `table.data` by name, and the named view's `data` still waits on objectui#10971. The sentence above about `label` and `data` is kept as the reading of this change; the objectui#10976 entry states what ships.
- 9f0c84a: fix(plugin-view): an `object-view` in a non-grid view re-reads its rows on the data-invalidation bus
  
  For the non-grid views (kanban, calendar, gallery, timeline, map, gantt),
  `ObjectView` fetches the rows itself and hands them to the inner view as
  `data`, which switches off that view's own bus reader. A gantt handed zero rows
  is the one exception: it still queries for itself and keeps its own bus reader
  beside this one (objectui#7333), so both re-read, and both answers are correct.
  `ObjectView`'s fetch now names the `useDataInvalidation` nonce for
  `schema.objectName`, so a write declared on the bus (`notifyDataChanged`, as a
  page action over raw HTTP does), or an unscoped `'*'`, re-reads the rows in
  place: the inner view is not remounted. A change to another object does not
  re-read. Before, such a write reached these views only when their host
  remounted them, and `PageView` is about to stop doing that (objectui#10519).
  
  The subscription follows the rows the view draws: a host `renderListView` (its
  `ListView` reads the bus itself) and the grid (`ObjectGrid` does too) do not
  subscribe here, and neither does a view with no object or no data source. Nor
  do the host-only `tree` and `chart` views: their renderers query for themselves
  and read the bus themselves, so a re-read here would only add reads beside
  theirs.
  
  **Clause-②: no** — no exported symbol, prop or authored key is added, removed,
  renamed or retyped, and no accept set moves. What changes is when an existing
  read runs.
- e9ca14c: Under a `split` or `popover` navigation, `ObjectView`'s New button now opens a create form (objectui#10975).
  
  Both surfaces draw a form only beside a selected record, and New clears the selected record, so until now the button did nothing under either mode. That held for the node's own `navigation` and, since objectui#10885, for the active named view's. The create form now opens on the surface the node uses with no `navigation`: the modal for `layout: 'modal'`, the drawer otherwise. A `layout: 'page'` node with an `onNavigate` handler still hands New to the router, as before. A record opened to view or edit still opens beside the list under `split`, and in the popover under `popover`.
  
  `Clause-②: no` — no declared type, accepted key or published export moves.
- 24a0f14: An `object-view`'s `table` now hands the grid it draws every grid key it types, and stops
  typing the grid keys that had nothing to act on there (objectui#10976).
  
  **What was wrong.** `ObjectViewSchema.table` declared every `ObjectGridSchema` member except
  `type` and `objectName`, while the grid node `ObjectView` builds copied a fixed handful of
  them. So `table: { editable: true }`, and `frozenColumns`, `rowHeight`, `rowActions` and the
  rest, type-checked, passed the validator, and did nothing.
  
  **`@object-ui/plugin-view` (fix).** The registered `object-view` renderer now relays these
  `table` keys to its grid as written, each one a key `ObjectGrid` reads: `editable`,
  `singleClickEdit`, `frozenColumns`, `rowHeight`, `resizable`, `reorderableColumns`,
  `searchableFields`, `showSearch`, `showPagination`, `showColumnTypeIcons`,
  `conditionalFormatting`, `rowActions`, `bulkActions`, `bulkActionDefs`, `exportOptions`,
  `grouping`, `aggregations`, `rowColor` and `label`. A key is copied only when you write it, so
  a view that writes none of them renders as before. Where the active named view declares the
  same member, the named view still wins and `table` is the fallback. `ObjectGrid` still gates
  `editable` on the object's inline-edit grant. A host that supplies `renderListView` still takes
  only `columns`, `fields`, `filter` and `sort` from `table`.
  
  **`@object-ui/types` (breaking for a writer of a withheld key, hence `minor`).** The `table`
  slot no longer declares the grid keys the view's grid does not honour:
  
  - no read in `ObjectGrid`: `showFilters`, `keyboardNavigation`, `rowSpecActions`,
    `bulkSpecActions`, `name`, `placeholder` (the last four retired from `object-grid` itself by
    objectui#11068);
  - not handed on by the view: `emptyState`, `description` (`ObjectGrid` honours both on an
    `object-grid` node since objectui#11068; write them there);
  - owned by the view: `data`, `staticData`, `bind` (the view lists its own `objectName`),
    `navigation`, `onNavigate` (write them on the `object-view` node), `id`;
  - node-level keys, which no renderer applies to a grid the view draws as a component: `style`,
    `testId`, `ariaLabel`, `hidden`, `hiddenOn`, `visible`, `visibleOn`, `visibleWhen`,
    `disabled`, `disabledOn`;
  - legacy aliases of a relayed key: `batchActions` (write `bulkActions`) and `resizableColumns`
    (write `resizable`).
  
  **Who breaks.** TypeScript code that writes one of those keys inside an `object-view`'s
  `table` now fails to compile (excess property), and a document that carries one fails
  `safeValidateSchema` / `objectui validate` with a message that names the key and says why it
  reached nothing. None of them ever reached the grid, so no rendered view changes. Remove the key,
  or move `navigation` / `onNavigate` / `description` to the `object-view` node. No example,
  doc or builder in this repository writes one.
  
  The slot's key list and the withheld set are pinned against drift by
  `packages/types/src/__tests__/object-view-slot-key-lists.test.ts`, which also requires the
  validator to refuse every withheld key by name, so the two faces refuse the same keys.
  
  **Correction, 2026-10-03 (objectui#11068).** `keyboardNavigation` moved from the first group to
  the second: `ObjectGrid` honours it on an `object-grid` node since objectui#11068's build, and
  the view still does not hand it on, so the slot still refuses it, now with that reason
  (`.changeset/11068-keyboard-navigation.md`).
- 30f912a: fix(plugin-view): `ObjectView` fetches only for views that draw the rows, and a re-read keeps them on screen
  
  `ObjectView` fetches the rows for its non-grid views itself and hands them to the
  inner view as `data`. Two things were wrong with that fetch.
  
  - **It ran for views that never draw the rows.** The gate was a deny-list (`grid`,
    `tree`, `chart`), so every other view type was read on mount and re-read on every
    data-invalidation event. That included `gantt`, whose registered renderer hands
    its chart the schema alone and queries for itself, and every view type with no
    renderer case (`page`, `list`, `detail`), which falls through to the grid. The
    gate is now an allow-list of the view types whose renderer draws the rows:
    `kanban`, `calendar`, `gallery`, `timeline` and `map`. The others keep reading
    and refreshing through their own query, as they already did, without a second
    request beside it. A tree no longer runs its own query twice when the view's
    rows arrive.
  - **A re-read flashed the loading placeholder.** Every run set `loading`, bus
    re-reads included, and a calendar handed rows swaps them for "Loading calendar…"
    while that is true, so each bus event flashed the calendar. A run that issues the
    same request as the rows on screen answer is now a re-read: the rows stay until
    the new ones arrive. The first load for a request still shows the placeholder, and
    a failed re-read is still logged the way a failed first load is.
- 9b85600: An `object-form` whose `title`, `description`, `submitText`, `cancelText`, `nextText`, `prevText` or `successMessage` is a per-locale map now shows the viewer's language instead of failing to render (objectui#10993).
  
  **What it was.** `@objectstack/spec` types these seven members of `object-form` as `I18nLabel`: a plain string or an inline per-locale map such as `{ en: 'Save order', 'zh-CN': '保存订单' }`. `ObjectForm` handed all seven raw to the presentation its `formType` picked, and every presentation that displays one renders it as a React child. A map therefore threw "Objects are not valid as a React child", and the node rendered `Component "form" failed to render` instead of a form.
  
  **What changed, in observable terms.**
  
  - `ObjectForm` resolves the seven with `pickLocalized` against the active UI language (`useObjectTranslation().language`), once, before it picks a presentation. So the simple, tabbed, split and wizard forms, the drawer and modal presentations, and the master-detail route all receive the entry for the viewer's language, with the fallback chain `pickLocalized` applies.
  - A plain string renders exactly as authored. With nothing authored, every presentation shows the default label it showed before.
  - A map with no string entry resolves to nothing, so the presentation's default label shows.
  - `object-view`'s `form` slot takes `ObjectFormSchema`'s keys, so its `form.title` and `form.description` are `I18nLabel` too. `ObjectView` draws its own drawer and modal header around the form, and it now resolves both the same way, against the same UI language, where it used to read them raw.
  - The `object-form` registration declares both arms for the seven keys, `type: ['string', 'object']`, with descriptions that teach the per-locale map. The manifest built from `ComponentRegistry.getPublicConfigs()` therefore no longer makes `validateTree` report `type-mismatch` on a locale map for these keys. A value that matches neither arm, such as a number, is still reported.
  
  **Types.** In `@object-ui/types`, `ObjectFormSchema.title`, `.description`, `.submitText`, `.cancelText`, `.nextText`, `.prevText` and `.successMessage` widen from `string` to `I18nLabel`, matching the spec row. The zod mirror's `title`, `description`, `submitText`, `cancelText` and `successMessage` widen from `z.string()` to the spec's `I18nLabelSchema`, by reference, so `safeValidateSchema` accepts a locale map on them; a number is still refused at the member. `nextText` and `prevText` stay unmirrored, as before. Code that writes these members compiles unchanged. Code that reads one of them off an `ObjectFormSchema` and uses it as a `string` no longer compiles: resolve it first, for example with `pickLocalized` from `@object-ui/i18n`.
  
  **Clause-②: yes** — seven members of the exported `ObjectFormSchema` type, and five members of its zod mirror, widen from a string to `I18nLabel`, and the registration's `inputs` for the seven keys widen from `'string'` to `['string', 'object']`. Nothing that was accepted before is refused now.
  
  **Correction, 2026-09-30 (objectui#6152).** The **Types** paragraph above says `nextText` and `prevText` stay unmirrored. That was true when this change was written, and it no longer is: objectui#6152 (PR #11125) mirrors both, by the same reference to the spec's `I18nLabelSchema`, so `safeValidateSchema` now judges them as it judges the other five: a locale map is accepted, and a number is refused at the member.
- 3c13675: **The console reads a saved view by the spellings `@objectstack/spec` declares, and stops reading the keys nothing writes (objectui#11013).** This is the console end of the ruling on objectstack#20051: the spec now declares the keys the console writes onto a stored view and reads back (`VIEW_CONSOLE_ROUND_TRIP_KEYS`), and the console reads a stored view under those spellings.
  
  **A saved view keeps its switcher state across a reload.** A view saved as a record (the "+" tab's create, or "Edit view config → Save") used to come back from `listViews()` with only its configuration, name, label and default flag. It now also comes back with its pin (`isPinned`), its position among saved views (`sortOrder`), its switcher group (`visibility`), its column layout (`columnState`) and its bound `object`. Visible effect: a saved view you dragged to a new position keeps that position after a reload, including in a browser that never saw the drag. The carried keys are read off the spec's record, not hand-listed.
  
  **Keys a saved view no longer steers.** No console surface writes any of these onto a view, no view in this repository authors one, and the spec's view schema refuses each by name. A stored view that still carries one now behaves as if it did not:
  
  | key on the stored view | what changes for the user |
  | --- | --- |
  | `allowExport` | A view carrying `allowExport: false` no longer hides the list's export control or drops its `exportOptions`. Whether a list offers export is the page's setting (the `list-view` / `object-view` node's `allowExport`); which formats it offers is the view's `exportOptions.formats`. |
  | `wrapHeaders` | Column-header wrapping follows the page's setting, not the view's. |
  | `editRecordsInline` | On the object page this was read as a second spelling of `inlineEdit`. A view carrying only it no longer turns inline editing on; write `inlineEdit`. |
  | `clickIntoRecordDetails`, `addRecordViaForm`, `addDeleteRecordsInline`, `collapseAllByDefault`, `fieldTextColor`, `prefixField` | Relayed into the list, which drew nothing from them. No visible change. |
  
  The same keys authored on the `object-view` node itself are unchanged: that node's own values still reach the list.
  
  **The toolbar policy is read as `userActions`.** The `object-view` node the object page builds, and `@object-ui/plugin-view`'s own kanban / calendar / gallery / timeline / gantt / map route (a host that renders the `object-view` node without `renderListView`), read a view's search, sort and filter toggles from `userActions.search`, `.sort` and `.filter`, where they used to read the bare `showSearch`, `showSort` and `showFilters` flags. On that plugin route, a view that declared `userActions: { search: false }` now hides the search control; the object page's list already honoured it. A stored view that still carries a bare flag keeps its answer: `normalizeListViewSchema` folds it onto `userActions`.
  
  **A stored view is bound and identified by its declared keys only.** A view row is matched to its object by `object` (or its configuration's `data.object`), and no longer by `objectName`; it is identified by `name`, and no longer by a top-level `id` or `_id`. This holds in the view switcher (`listViews()` / `listViewOverrides()`), in Studio's view picker for `interfaceConfig.sourceView`, and in Studio's view preview. Every console write stamps both `object` and `name`, and the metadata door refuses a view record or overlay row bound by `objectName` alone, so a row the console wrote is unaffected. The console also no longer stamps an undeclared `objectName` onto the rows it reads, which a saved view's toolbar save used to write back into the stored row.
  
  **BREAKING (TypeScript only) — `NamedListView.allowExport` is retired.** It is now a `?: never` tombstone, like the seventeen members objectui#7924 retired: a TypeScript author who writes it gets a compile error there. Ruling A on objectui#7924 had kept it declared only because both relays read it off a view, and those reads are gone.
- 3ad6100: With a `page` record surface and no `onNavigate` handler, `ObjectView`'s New button, a row click and Edit now open the record form on the drawer (objectui#11015).
  
  With no authored `layout`, the record surface is derived: `page` on a mobile viewport and on an object with at least `RECORD_SURFACE_PAGE_THRESHOLD` authorable fields. A page hands the record to `onNavigate`, and the registered `object-view` renderer has none, because a JSON schema cannot carry a function. New, a row click and Edit therefore opened nothing there. They now open on the drawer, the surface a page already took for New under a `split` or `popover` navigation (objectui#10975). An explicit `layout: 'page'` without `onNavigate` takes the same fallback. A `page` with an `onNavigate` handler still hands create, edit and view to the router, as before. The README and the plugin-view docs page now also say that under a `drawer` or `modal` navigation, the create form opens on that navigation's surface.
  
  `Clause-②: no` — no declared type, accepted key or published export moves.
- 20d23be: The README's "View tabs" section listed `form.layout` as `vertical | horizontal | inline | grid`. It now lists `vertical | horizontal`, the two values the form layout keeps after objectui#7759 Group C (objectui#11168 slice 3). The docs page carries the same line. Only the README text changes; the package's code is untouched.
- 4a1adb7: The object view's provider-less defaults table carries the `_one` / `_other` rows of the two count families it serves, `console.objectView.bulkDeleteConfirm` and `objectActions.bulkDeleteSuccess` (objectui#11445), so a host with no `I18nProvider` reads `Delete 1 selected record?` at one record.
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
- 9caa7d4: At this change `ObjectView` wrapped `table.defaultSort` before handing it to a delegated
  list view, so a view whose only ordering was the deprecated key actually sorted
  (objectui#6235).
  
  ⚠️ **Dated note, 2026-09-25 — this wrap has since been retired — objectui#5861.** Later in
  this same release `table.defaultSort` became an ADR-0049 retirement tombstone and
  `mergedSort` lost the branch this entry changed: it now ends at `table.sort`, so a
  `table.defaultSort` alone hands the delegated slot no sort at all and the view renders
  unsorted. The rest of this entry is kept as the reading of this change; the objectui#5861
  entry states what ships and the migration (`sort: [{ field, order }]`).
  
  `ObjectGridSchema.defaultSort` is declared a SINGLE `{ field, order }` object — the zod
  mirror agrees (`z.object({ field, order })`, not a union) — while the `list-view` node's
  `sort` slot is declared `string | SortConfig[]`, imported by reference from the spec's own
  `ListViewSchema`. `mergedSort`'s last branch forwarded the bare object into that slot
  unwrapped. The three branches ahead of it all produce an array or a string, so this was the
  one shape the slot never declared.
  
  Nothing crashed and nothing warned: every reader of that slot drops an unparseable sort
  silently. `ListView.parseSortConfig` and `ObjectGrid.parseSchemaSort` both open
  `typeof sort === 'string' ? [sort] : Array.isArray(sort) ? sort : []`, so a bare object
  yields `[]`; the shared sink `convertSortToQueryParams` returns `undefined` for it. Both
  in-tree hosts feed the slot straight into `ListView` (`app-shell`'s `fullSchema` and
  Studio's `renderStudioGridList`), so the symptom was an unsorted list with no error —
  while the SAME metadata sorted correctly as a grid, because `ObjectGrid` performs this
  lowering for the same pair.
  
  The wrap was verbatim the one the non-grid fetch path in this same file then applied
  (`|| (schema.table?.defaultSort ? [schema.table.defaultSort] : undefined)`), so at this
  change all three consumers agreed and no fourth dialect was introduced. The shared sink is deliberately
  NOT widened to accept a bare `{ field, order }`: that is the widening the maintainer ruling
  of 2026-08-22 rejected on the merits, because the same slot legitimately carries
  `$orderby`'s own `Record<field, direction>` map, in which `{ field: 'desc' }` is a legal
  ordering by a column literally named `field`.
  
  Precedence was unchanged — a named view's sort still outranked `table.sort`, which still
  outranked `table.defaultSort`. Only the final branch changed shape.
  
  One behaviour note for hosts writing off-schema metadata: an ARRAY in `table.defaultSort`
  was previously forwarded verbatim by this path alone and is now lowered like every other
  resolver in the repo, which leaves it unreadable rather than rescuing it. That input is
  already refused by the zod mirror and already behaves this way on the fetch path and in
  `ObjectGrid`; the canonical slot for an array is `table.sort`.
- e929c56: `ObjectView`'s non-grid fetch now carries `$expand` (objectui#6419). The effect built its
  expand set from `objectSchemaRef.current` — a ref assigned in the render body, deliberately
  kept out of the effect's dependency list so the effect would run exactly once per mount. On
  that one run the ref was still `null`, so `buildExpandFields` saw no fields and the query
  went out as `{ $top: 100 }` with no `$expand` at all; because the effect never re-ran on the
  schema's arrival, it never went out with one either.
  
  `ObjectView` hands the rows it fetches to the child view as `data={data}`, which suppresses
  that child's own fetch. So every lookup / master_detail / user / tree field in the six
  non-grid views it hosts — kanban, calendar, gallery, timeline, gantt, map — rendered from
  raw foreign-key ids: blank on the kanban (its `resolveDisplay` suppresses opaque ids) and
  potentially the raw id on the other five.
  
  The object schema and the fact that its read has SETTLED are now one piece of state, keyed
  by object name, and the record query waits on it — the shape `ObjectKanban` adopted in
  objectui#6271. The gate is on the read having settled, **not** on a truthy schema: a view
  whose adapter exposes no `getObjectSchema`, or whose read threw, still queries (unexpanded)
  rather than waiting forever, and switching objects closes the gate in the same commit rather
  than sending the previous object's expand set.
  
  The trade was measured on this effect rather than inherited, because it has five more
  dependencies than the board's. With an instrumented adapter (schema and `find` both 30ms)
  across four host regimes: before, one query with no `$expand` and one raw delivery to the
  child; with `objectSchema` merely added to the dependency list, two queries and two
  deliveries — `raw` then `expanded`, a visible two-step paint, because here the raw rows
  settle into state *before* the re-run's cleanup rather than being discarded as they were on
  the board; gated, one query carrying `$expand` the first time and a single expanded
  delivery, with correct rows landing at the same wall clock as the dependency version.
- 6a7893d: `ObjectView`'s non-grid fetch no longer re-queries once per parent render when the host
  passes an inline `views` array (objectui#6460).
  
  The effect that fetches rows for the six non-grid view types (kanban, calendar, gallery,
  timeline, gantt, map) listed `activeView` — an **element of the `views` prop array** — among
  its dependencies. A host writing `views={[{ id: 'cal', type: 'calendar', label: … }]}`, which
  is how this component's own docs write it, produces a fresh element object on every one of
  its own renders, so the dependency changed identity every render and a new `find()` went out
  each time. Measured with an instrumented adapter and three parent re-renders: **4 queries
  where a hoisted array gives 1**. Because `ObjectView` hands its rows to the child view as
  `data={data}`, each extra query also re-delivered a fresh row array downstream — the
  "duplicate events in child views like the calendar" hazard, from the re-run direction.
  
  The effect now depends on the **values it reads** — the active view's `filter` and `sort`,
  plus its `id` — held at a steady reference while they are structurally unchanged, instead of
  on the view object's identity. Asking hosts to hoist the array was considered and rejected:
  that is a contract change on every caller of a published component, and it leaves the defect
  live for every host that does not comply.
  
  Nothing about precedence moves: a named `listViews` config's `filter`/`sort` still outrank
  the view's, which still outrank `table.filter`/`table.sort` and their deprecated aliases.
  Changing a view's filter, changing its sort, and switching the active view all still
  re-fetch. The comparison never serializes, so it stays correct for filter and sort values
  that have no faithful stringification — a `Date`, a function, a `Map`, `NaN`, or plain
  key-order instability — and every case it cannot model resolves to "changed", which costs a
  redundant query rather than withholding a needed one.
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
- 34ea56d: Relay a per-view `rowColor` through the two object-view hosts (objectui#7218).
  
  `rowColor` is a declared member of `ListViewSchema` — imported by reference from
  `@objectstack/spec`, shape `{ field, colors? }` — and `ListView` reads it to
  seed its `rowColorConfig` state, which colours whole rows from the named field's
  value. Neither object-view host relayed it: `app-shell`'s
  `ObjectView.renderListView` builds its list schema by spreading the host's and
  then relaying 47 named keys off the active view, and `plugin-view`'s
  `ObjectView` assembles 46 inside its `object-view HOST-COMPOSITION SURFACE`
  fence. `rowColor` had a rung in neither.
  
  So an authored per-view row colour was unreachable on the object route:
  authored, validated, built and served correctly, then dropped at the relay.
  Nothing errored and every authoring gate passed — the only symptom was that the
  rows were not coloured, which an author cannot notice short of diffing the DOM.
  Same "declared and inert" shape objectui#7199 fixed for `description`.
  
  **This is a relay, not a new surface.** The interface route
  (`InterfaceListPage.tsx`) has shipped `rowColor: view.rowColor` next to
  `grouping` and `pagination` since ADR-0047, into a schema typed
  `ListViewSchema`, with no fence of any kind — so the key was already
  author-reachable and already had a delivery path; two of three hosts simply did
  not use it. The legacy shorthand for the same feature (bare `color`) already had
  a rung in both literals; only the spec-canonical spelling was missing.
  
  **No published surface moves.** Both rungs are view-sourced only, and neither
  adds a cast read off the object-view node — that would have added a 28th name to
  the objectui#5097 HOST-COMPOSITION exemption whose count the 2026-08-18 ruling
  fixed at 27, which is a ruling and not a refactor. `grouping` is the in-fence
  precedent for a view-only rung.
  
  ⚠️ Not `userActions.rowColor`, a boolean permission toggle sharing this name at
  a different nesting level ("may the user open the colour panel" versus "what the
  colours are"). That key is untouched, and the new pins hold the two apart.
- 7c3df8f: The settled-schema convergence, and the gantt's duplicate query gated
  (objectui#7225, maintainer ruling B, 2026-09-02).
  
  `useSettledSchema` was extracted and published in PR #6690 with exactly **one**
  non-test adopter (`ObjectTree`, the component that had an actual defect —
  objectui#6481's unkeyed latch). `ObjectKanban`, `plugin-view/ObjectView` and
  `ObjectCalendar` kept their own hand copies of the same shape, so a published
  export was owed compatibility forever **and** the duplication it was named for
  stayed. All three now call the hook.
  
  The migration is a pure deduplication with no behaviour delta — the hook was
  extracted *from* these three shapes, so each becomes a one-line call.
  `ObjectCalendar`, which objectui#6482 named as the obstacle, fits via the
  recipe the hook's own doc comment prescribes for it by name: pass the data
  source as `undefined` for a render that must not read metadata
  (`hasInlineData ? undefined : dataSource`), so "inline value data set" is
  expressed as "there is no source to read from" rather than as a second enable
  flag. GATE PLACEMENT stays local in all three, which is what #6482 ruled and
  what made the calendar's obstacle a non-obstacle: it was about the gate half.
  
  **One observable change:** `ObjectKanban`'s rejected definition read now logs
  on `console.error` with a `[useSettledSchema]` prefix instead of
  `console.warn`. Its test spy moves with it, and now asserts on the channel
  rather than merely silencing it.
  
  **The gantt's duplicate query is gated** (ask 2 of the card; #6482's
  undischarged half). `ObjectGantt` listed `objectSchema` in `reload`'s
  dependency list, so every load issued two unbounded queries — the first with no
  `$expand` at all. Measured on this component across three latency profiles, the
  cost is not the mild "round trip bought and thrown away": when the metadata
  read is the slower of the two, which is the common case on a cold
  `MetadataCache`, the user sees the full three-step paint — raw foreign-key ids,
  back to the loading placeholder, then the expanded rows. It now issues one
  query, already expanded.
  
  Gating the gantt required its schema resolution to settle on EVERY exit
  (objectui#7232): the hand-rolled effect returned without settling on
  `!effectiveDataSource`, on `!resource` and in its `catch` — harmless while
  nothing waited on it, and a chart that never loads once something does.
  `useSettledSchema` settles on all three by construction, which is what makes
  the gate safe; both exits are pinned.
  
  ⛔ Gating is not capping. The row ceiling on these fetches is objectui#7210's
  separate ruling, in its own commit on the same branch.
- cfc9b6d: A filter on a record page can now be scoped to the record the page shows (objectui#7297). Write `{record_id}` as a filter value, for example `{ "assignee": "{record_id}" }` on an `element:number` counting tasks, and on a `type: 'record'` page it resolves to the id of the record in view: on one person's page the number is that person's count, and on the next person's page it is theirs. It works in a component's own `filter` and in its component-level `dataSource.filter`, on every data component that resolves its filter through `@object-ui/react`'s `useFilterScope()`. The token is declared by `@objectstack/spec` 17.5.0 (`RECORD_CONTEXT_TOKENS`, objectstack-ai/objectstack#20003).
  
  The id comes from the record page's mounted record context, never from a URL parameter or a page variable. `@object-ui/react`'s `useFilterScope()` adds it to the scope it returns (as the new optional `recordId` member of `@object-ui/core`'s `FilterTokenScope`) whenever a `RecordContextProvider` is mounted above the component; `FilterScopeProvider` is unchanged and still carries only the session values. The held filters in `useResolvedFilter`, `object-grid` and `object-view` resolve again when the record changes, so moving to another record queries again without a remount.
  
  Anywhere with no record in context (a list view, a dashboard, a report, or a page that is not a record page) `{record_id}` is refused by name: `resolveContextTokens` reports it through `onUnresolved` (a console warning by default), the way an unresolved `{current_user_id}` is reported, and leaves it as written. It never becomes `null` and its condition is never dropped, so a number can never silently count every record; the ObjectStack server refuses the leftover token by name (`FILTER_TOKEN_UNRESOLVED`). Like the session tokens, `{record_id}` only scopes what a component shows. It is not access control: which rows a user may read is still decided by the server's row-level security.
  
  **Correction, 2026-09-30 (objectui#8945).** The example in the first paragraph, `{ "assignee": "{record_id}" }`, is the retired MongoDB-style record form. `@objectstack/spec` 17.5.0 refuses it at an `element:number` `filter`, because that key takes an array and a record is refused by kind. Write the same condition as a `ViewFilterRule` array, which the spec accepts: `[{ "field": "assignee", "operator": "equals", "value": "{record_id}" }]`. A component-level `dataSource.filter` takes the same array. The `{record_id}` token itself, and the rest of this entry, are unaffected.
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
- 9a853f2: Retire the legacy string `sort` clause: one spelling, the array
  (objectui#8221) — `convertSortToQueryParams` now REFUSES `"name desc"` with a
  diagnostic naming `[{ field: 'name', order: 'desc' }]`, instead of lowering it.
  
  **BREAKING for `@object-ui/core` consumers — scored `minor`, not `major`, per
  AGENTS.md 版本号策略** (every package is in one fixed group, so a `major` here
  would carry all 39 off the `@objectstack` major this repo is pinned to). The
  breaking semantics are stated below rather than encoded in the version.
  
  Director ruling, decision batch #77 (2026-09-07), option B. Three faces
  disagreed about one key: `@object-ui/core` implemented the string clause
  on purpose (`sort-query.ts`, docblock and all), `content/docs/plugins/plugin-map.mdx`
  taught it as `sort?: string | SortConfig[]`, and the html tier answered
  `type-mismatch` for it because all seven `sort` registrations publish
  `type: 'array'` alone — while `@objectstack/spec` refuses the string outright on
  `element-record-picker`. Option A (per-block string arms) was rejected by name:
  it would make one key mean different things on different blocks.
  
  **What moves.** `convertSortToQueryParams(sort)` narrows from
  `string | QuerySortEntry[]` to `QuerySortEntry[]`, and the three declarations
  that published a string arm narrow with it — `ObjectGridSchema.sort`,
  `ObjectMapSchema.sort` and `ObjectGanttSchema.sort`, in the TypeScript face AND
  in the zod mirror, together, because a narrowing that left `z.string()` in the
  mirror is the declared-vs-enforced split this change exists to close. The local
  `sort` declarations on `LineItemsPanel`, `ObjectTimeline` and
  `deriveRelatedLists`'s ListView input narrow the same way.
  
  **What a string does now.** Types are erased, so the signature stops a string
  only at compile time; authored JSON and stored `sys_metadata` rows still reach
  the sink carrying `"name desc"`. Such a value is REFUSED — the query carries no
  `$orderby` — and `console.error` names the array form, quotes what arrived and
  states the consequence, once per spelling. A silent `undefined` was the one
  outcome the ruling ruled out.
  
  **Measured consequences you may see.** A related list that inherited its child
  object's default list-view sort in the legacy spelling stops inheriting it (the
  console says so). `@objectstack/spec@17.3.0` still ACCEPTS the string on
  `ListViewSchema.sort` and on `RecordRelatedListProps.sort`, so such metadata is
  still spec-legal today; the spec-side pull-back is its own card. Two surfaces
  are deliberately untouched, because they are a DIFFERENT string dialect that
  never reaches this sink: `record:related_list`'s `'field'` / `'-field'` form,
  normalized by `RelatedList.normalizeSortSpec`, and `ListView.parseSortConfig`,
  which reads the platform view record the spec still blesses.
  
  Docs teach the array only: `content/docs/plugins/plugin-map.mdx`,
  `content/docs/plugins/plugin-view.mdx` and `packages/plugin-view/README.md`.
- 2f6b2bf: Derive `TreeViewConfig` from `@objectstack/spec` and drop `titleField`, the key the
  protocol refuses on `ListView.tree` (objectui#8841).
  
  **What was wrong.** `@object-ui/types` published `TreeViewConfig` as a hand-written
  interface — a copy of the protocol's `ListView.tree` block under a second name — and the
  copy declared a fifth key, `titleField`. `@objectstack/spec@17.4.0` refuses that key
  there by name: `TreeConfigSchema` is a `strictObject` since spec objectstack#15469 closed the
  `.passthrough()` window 17.3.0 left open. So this package's published face accepted what
  the contract rejects, and an author who followed `@object-ui/types` was refused at
  publish with `Unrecognized key(s) on this tree configuration: 'titleField'`. The copy was
  invisible to `scripts/check-spec-symbol-derivation.mjs`, which matches spec symbols BY
  NAME — a hand copy renamed away from the spec's symbol has nothing for its rule 1 to
  match (objectui#4592's recorded blind spot).
  
  **The grades, and why.**
  
  - `@object-ui/types` — **minor**. `TreeViewConfig` is now
    `NonNullable<ListView['tree']>` from `@objectstack/spec/ui`, and `titleField` is
    removed from a **published** exported type. That is breaking for a producer that
    annotates a `tree` block carrying the key; per this repo's version-alignment policy
    (AGENTS.md — objectui's major tracks `@objectstack`'s) objectui's own breaking changes
    ship as `minor` with the breaking semantics stated here. The precedent is the same
    shape: `Remove the retired striped / bordered / virtualScroll list-view surface`
    (`@object-ui/types` 17.6.0, minor) propagated a spec-side retirement into this package
    the same way.
  - `@object-ui/plugin-tree` — **minor**. `getTreeConfig`'s `labelField` chain loses its
    third rung, `?? schema.titleField`. That rung read the flattened **node**, never the
    block, and `titleField` is declared on neither face — not on `ObjectTreeSchema` (the TS
    interface or its zod mirror) and not on the protocol's `ListView.tree`. It is a runtime
    behaviour change, graded like one. The README's claim that this block is "the single
    declaration of that shape" is corrected in the same stroke: the protocol owns it, and
    this package publishes it derived.
  - `@object-ui/plugin-view` — **patch**. `ObjectViewProps.views[n].tree` still resolves to
    `TreeViewConfig`; what it admits narrows with the type. Type-only, no runtime change.
  - `@object-ui/app-shell` — **patch**. The console's `tree` composition keeps both rungs;
    only the second one's annotation changes (see below). No runtime change.
  
  **The tolerant reads are kept, and deliberately left undeclared.** Three
  `labelField || titleField` dual-reads survive — `plugin-view`'s and `plugin-list`'s
  `'tree'` branches and the console's own composition in `app-shell` — so a view record
  that already stores `tree.titleField` keeps resolving exactly as before, and
  objectui#6557's pin on that rung stays green. They read through `any` now; the console's
  canonical rung stays annotated `TreeViewConfig` while its legacy rung is not, because
  casting it to a type that no longer carries the key cannot compile and re-declaring the
  key locally would fossilise a renderer-side alias into a second contract — the AGENTS.md
  #0.1 defect this change undoes. Retiring those three reads is a follow-up.
  
  **Migration.** A host that writes `tree.titleField` should write `tree.labelField`, which
  is the protocol's spelling and already wins wherever both are present. Nothing that
  renders today stops rendering; what changes is that the key is now reported at compile
  time by the same face that will refuse it at publish, instead of only at publish.
- fb91ac9: feat(components)!: `FilterBuilderCondition` and `FilterGroup` derive from `@object-ui/types` — `operator` narrows to `FilterBuilderOperator`, the group `id` becomes optional (objectui#9306)
  
  ⚠️ Breaking at compile time, marked `minor` under this repo's version-alignment
  rule. Nothing the component renders or emits changes.
  
  `@object-ui/components` declared its own `FilterBuilderCondition` and
  `FilterGroup` beside the ones `@object-ui/types` declares: the same two names,
  twice, with nothing tying them together. The maintainer's ruling on objectui#9306
  makes the `@object-ui/types` declarations the one name authority, which settles
  objectui#6349's two parked name-authority rows. The component now derives both
  and restates only its named extensions:
  
  - `FilterBuilderCondition` takes `id` and `field` from the authority and
    restates `operator` and `value`. `operator` is `FilterBuilderOperator` (the
    protocol's operator ids plus the opt-in `exists` / `notExists`, exported by
    that name) instead of `string`, so a row carrying an id no dropdown entry can
    hold no longer type-checks. `value` keeps the component's own required
    scalar-or-list union rather than the authority's `value?: any`, so the
    exported value helpers keep their typing.
  - `FilterGroup` takes `id` and `logic` from the authority and restates
    `conditions` as the component's rows. So `id` is now OPTIONAL, as the
    authority declares it. That matches what the builder does: `onChange` hands
    back the group the host passed, so an id-less group comes back id-less, and
    only the builder's own empty group carries `id: 'root'`. `conditions` is flat,
    as the authority now is (nested sub-groups are retired there, see the
    `@object-ui/types` changeset).
  
  **Who is affected:** TypeScript code that builds a `FilterGroup` or
  `FilterBuilderCondition` from `@object-ui/components` with an operator typed
  `string`, or that reads a group's `id` as a guaranteed `string`. Narrow the
  operator to `FilterBuilderOperator` (its members are the protocol's canonical
  ids), and handle an absent group `id`.
  
  `@object-ui/plugin-view`: `toFilterGroup` returns the narrowed `FilterGroup`.
  A stored spelling it cannot map is still carried through verbatim (so the row
  stays visible), and its type is asserted at that one boundary; the function's
  output is unchanged.
  
  Pinned in `packages/components/src/__tests__/filter-builder-name-authority-9306.test.tsx`.
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
- cad512f: A host-composed `tree` view is now labelled with the tree icon in `ObjectView`'s
  view switcher instead of the grid one, and the `tree` / `chart` view types are
  recorded as host-composition-only surfaces (objectui#5321).
  
  `viewSwitcherSchema`'s `iconMap` carried an entry for every view type except
  `tree`, so a tree view fell through to the `|| 'table'` fallback and was drawn
  with the grid glyph. objectui#2916 fixed exactly this once, for `chart`, by
  adding a single key — nothing recorded that the map had to be COMPLETE, so the
  next missing member went unnoticed. The map is now typed
  `Record<ViewType, string>`, which is how `ViewSwitcher`'s own
  `DEFAULT_VIEW_ICONS` (the consumer of these strings) has always been declared:
  a future `ViewType` member fails `type-check` rather than silently rendering as
  a grid. The `tree` value is `'list-tree'`, the same `ListTree` glyph
  `DEFAULT_VIEW_ICONS` already names for this view type, and the runtime fallback
  stays for host props that carry an unrecognised type. Reached in practice by
  the console, whose `CreateViewDialog` offers `tree` among the view types a user
  can create.
  
  No authoring surface changes. `generateViewSchema` renders eight view types
  while `ObjectViewSchema.defaultViewType` and `NamedListView.type` admit six of
  them, so `tree` and `chart` are selectable only through the component's `views`
  prop. The maintainer ruled on 2026-08-20 that both stay recorded as
  host-composition-only rather than being added to those unions, following the
  objectui#5097 precedent; the record now lives beside that one, with the branch
  set derived from a source fence, the authored unions pinned at the type level,
  and host reachability measured.
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
- cfc2c7a: **Bug fix:** a non-grid `object-view` (calendar / kanban / gallery / timeline)
  whose sort came from the deprecated `table.defaultSort` no longer comes back
  empty. `ObjectGridSchema.defaultSort` is declared a single `{ field, order }`
  object, and `ObjectView`'s own fetch handed it to `$orderby` verbatim — where
  the ObjectStack adapter reads it as an `$orderby` map and folds it with
  `Object.entries`, so the request went out sorting by two columns literally
  named `field` and `order`. The server answers `400 INVALID_SORT`, `ObjectView`
  swallows the error, and the view rendered with no records — while the *same*
  metadata sorted correctly as a grid, because `ObjectGrid` lowers that pair
  before using it (objectui#4869, maintainer ruling 2026-08-22).
  
  At this change `ObjectView` performed the same legacy-to-canonical lowering
  `ObjectGrid` then did (`sort ?? (defaultSort ? [defaultSort] : undefined)`) and
  routed the whole chain — named view sort, `views` prop sort, `table.sort`,
  `table.defaultSort` — through the shared `convertSortToQueryParams` sink. This
  was the last object-bound read site sending an authored sort to `$orderby`
  unlowered; every other block (gantt, map, calendar, timeline,
  `record:line_items`) already did, so an adapter that implements `find` itself
  now receives one normalized `Record<field, direction>` from all of them instead
  of two different dialects.
  
  Precedence was unchanged, and at this change both spellings of the pair kept
  working. The shared sink was deliberately **not** widened to accept a bare
  `{ field, order }`: its input slot also legitimately carries `$orderby`'s own
  map, in which `{ field: 'desc' }` is a valid ordering by a column named `field`,
  so widening it would make one shared function guess.
  
  ⚠️ **Dated note, 2026-09-25 — the legacy half of that pair has since been
  retired — objectui#5861.** Later in this same release `table.defaultSort` became
  an ADR-0049 retirement tombstone: `ObjectView` no longer lowers or forwards it on
  any path and `ObjectGrid` no longer reads it, so a view whose only sort is
  `table.defaultSort` now renders **unsorted** (no longer empty, and no longer
  sorted). The paragraphs above are kept as the reading of this change. What still
  ships from it is the canonical chain — named view sort, `views` prop sort,
  `table.sort` — reaching the shared sink; the objectui#5861 entry states the
  migration (`sort: [{ field, order }]`).
  
  Two visible shape changes on the wire, both semantically identical to before: a
  string `table.sort` such as `'name desc'` now serializes as `-name` rather than
  riding through as `name desc`, and a `SortConfig[]` arrives as a map rather than
  as an array.
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
- 6b348d2: `ViewSwitcher` draws an icon for `chart` and `gantt` views again, and both
  icon maps in the package now name only spellings lucide still resolves
  (objectui#5586).
  
  `ViewSwitcher.resolveIcon` turns an icon NAME into a component by looking it up
  in lucide's runtime `icons` record. lucide retires a spelling by dropping it
  from that record while KEEPING it as a deprecated named export, so a retired
  name still imports, still type-checks and still renders as a component — and
  silently resolves to nothing as a string. `ObjectView` composes the switcher
  from names, and two of them had been retired on lucide-react 1.31.0:
  `chart: 'bar-chart-3'` and `gantt: 'gantt-chart'`. Both view types rendered as a
  label with no icon at all while every sibling type had one, and nothing went red
  because no lucide symbol appears in that map for the compiler to check. Measured
  against the installed package: `BarChart3` and `GanttChart` are absent from
  `icons`, while `ChartColumn` and `ChartGantt` are present.
  
  - `ObjectView`'s `iconMap`: `bar-chart-3` → `chart-column`,
    `gantt-chart` → `chart-gantt`.
  - `ViewSwitcher`'s `DEFAULT_VIEW_ICONS`: the adjacent entries that named
    deprecated aliases move to the names the record carries —
    `BarChart3` → `ChartColumn`, `GanttChartSquare` → `ChartGantt`,
    `Grid` → `Grid3x3`. `ChartColumn`/`Grid3x3` are the same components the
    aliases already pointed at, so those two glyphs are unchanged; the `gantt`
    default picks up the plain gantt glyph, which is what `iconMap` now supplies
    for that view type.
  
  The regression pin widens from `tree` alone to EVERY name both maps supply: a
  pin scoped to the two names that broke would not have caught this and would not
  catch the next lucide bump.
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [a507334]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [afb2284]
- Updated dependencies [3759c56]
- Updated dependencies [3ac2de8]
- Updated dependencies [0aacecc]
- Updated dependencies [63f4f92]
- Updated dependencies [777fca2]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [142fdfd]
- Updated dependencies [7b395d8]
- Updated dependencies [185079b]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [162621b]
- Updated dependencies [e026e15]
- Updated dependencies [4c6f549]
- Updated dependencies [80c5412]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [b809375]
- Updated dependencies [6099dd8]
- Updated dependencies [e686f4d]
- Updated dependencies [a04b06d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [fa5fbd9]
- Updated dependencies [88a4ef6]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
- Updated dependencies [0651e7a]
- Updated dependencies [bb5d4ee]
- Updated dependencies [dc666f7]
- Updated dependencies [3335767]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [d5cb261]
- Updated dependencies [cff4b77]
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
- Updated dependencies [cdefa2a]
- Updated dependencies [c3025ea]
- Updated dependencies [0961d5e]
- Updated dependencies [6276478]
- Updated dependencies [5e67837]
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [09ab32b]
- Updated dependencies [8acc51b]
- Updated dependencies [ea9d17f]
- Updated dependencies [cc139d8]
- Updated dependencies [45362a3]
- Updated dependencies [2a943bf]
- Updated dependencies [93a689d]
- Updated dependencies [4357a27]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [8740e86]
- Updated dependencies [6ea68e6]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [cc07476]
- Updated dependencies [f99f9cd]
- Updated dependencies [ac2d6f1]
- Updated dependencies [4a3d500]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [0c3f70a]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [41dcbd5]
- Updated dependencies [02e6d36]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [5c61e52]
- Updated dependencies [f905090]
- Updated dependencies [9c78ebe]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [1ea21c4]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [ee6f6c6]
- Updated dependencies [b526480]
- Updated dependencies [5ad3b88]
- Updated dependencies [be0ad00]
- Updated dependencies [f9d772b]
- Updated dependencies [bf14b64]
- Updated dependencies [4345558]
- Updated dependencies [704e05b]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [cf00ea8]
- Updated dependencies [41ae65b]
- Updated dependencies [baac95a]
- Updated dependencies [0896838]
- Updated dependencies [13220af]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [b32e7de]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [c5ec15c]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [ed76b1b]
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
- Updated dependencies [e3782d2]
- Updated dependencies [990a2d6]
- Updated dependencies [37140f4]
- Updated dependencies [37140f4]
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
- Updated dependencies [8aa68b1]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [4b742f4]
- Updated dependencies [42687ba]
- Updated dependencies [6cd8f66]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [27ae632]
- Updated dependencies [0bc5c5a]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [e327c89]
- Updated dependencies [2eaf5be]
- Updated dependencies [bf7ab35]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [63ab761]
- Updated dependencies [7e4fa1b]
- Updated dependencies [d0ae5d0]
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
- Updated dependencies [3100bef]
- Updated dependencies [c27b575]
- Updated dependencies [3fa1938]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [385ebc5]
- Updated dependencies [1923d35]
- Updated dependencies [858eafb]
- Updated dependencies [263dcd7]
- Updated dependencies [a8c5509]
- Updated dependencies [c2a8d23]
- Updated dependencies [0ffc423]
- Updated dependencies [3cc4fe5]
- Updated dependencies [cd5b19a]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
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
- Updated dependencies [b149617]
- Updated dependencies [58da8ae]
- Updated dependencies [a8b9889]
- Updated dependencies [138ad45]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [6aa029b]
- Updated dependencies [2124d04]
- Updated dependencies [be52115]
- Updated dependencies [be52115]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
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
- Updated dependencies [55d18c6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [c4ab6d0]
- Updated dependencies [5988b6b]
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [50c73fe]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
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
- Updated dependencies [072b7e8]
- Updated dependencies [b0bf413]
- Updated dependencies [dbd1081]
- Updated dependencies [2f54dca]
- Updated dependencies [d0097af]
- Updated dependencies [9c74902]
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
- Updated dependencies [062943f]
- Updated dependencies [636b236]
- Updated dependencies [4172589]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [41b7ce3]
- Updated dependencies [ae476b8]
- Updated dependencies [67a87d9]
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
- Updated dependencies [3e853c9]
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
- Updated dependencies [17ccec9]
- Updated dependencies [90665e0]
- Updated dependencies [8d3a529]
- Updated dependencies [5ac2e2c]
- Updated dependencies [194fae1]
- Updated dependencies [7e19d03]
- Updated dependencies [beccf1c]
- Updated dependencies [b08b7eb]
- Updated dependencies [1e946c9]
- Updated dependencies [546ddf7]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [7a72422]
- Updated dependencies [44d075b]
- Updated dependencies [40c479a]
- Updated dependencies [5173a5e]
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
- Updated dependencies [c9a7252]
- Updated dependencies [5f19b92]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [e0b289d]
- Updated dependencies [46f0bb4]
- Updated dependencies [2da6441]
- Updated dependencies [3b9c774]
- Updated dependencies [06b82b8]
- Updated dependencies [8ec11e1]
- Updated dependencies [6f81384]
- Updated dependencies [22ba927]
- Updated dependencies [f8c70f4]
- Updated dependencies [5d3a2d1]
- Updated dependencies [c38162d]
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
- Updated dependencies [1c19722]
- Updated dependencies [5961030]
- Updated dependencies [faa863d]
- Updated dependencies [fd814d6]
- Updated dependencies [f24de8b]
- Updated dependencies [c8ea8af]
- Updated dependencies [9602dc8]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [299102e]
- Updated dependencies [30c73cd]
- Updated dependencies [c4987fb]
- Updated dependencies [f55d666]
- Updated dependencies [f241a4d]
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
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [4ac3769]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
- Updated dependencies [19f3637]
- Updated dependencies [9bd08fe]
- Updated dependencies [45ac2cb]
- Updated dependencies [b97790a]
- Updated dependencies [dbd5194]
- Updated dependencies [7c9b044]
- Updated dependencies [d47de51]
- Updated dependencies [3fe6463]
- Updated dependencies [b392674]
- Updated dependencies [4f3a1e2]
- Updated dependencies [31ab372]
- Updated dependencies [846889b]
- Updated dependencies [2acd8e1]
- Updated dependencies [26896c6]
- Updated dependencies [67fc3b0]
- Updated dependencies [fab4802]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [c18d099]
- Updated dependencies [adb2a86]
- Updated dependencies [03380aa]
- Updated dependencies [f9984c0]
- Updated dependencies [9700dd9]
- Updated dependencies [4562ea5]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [320374d]
- Updated dependencies [b0d308d]
- Updated dependencies [1349400]
- Updated dependencies [40f34b4]
- Updated dependencies [8063bcb]
- Updated dependencies [b74a859]
- Updated dependencies [d4493fd]
- Updated dependencies [240b80f]
- Updated dependencies [77cb489]
- Updated dependencies [bfaa158]
- Updated dependencies [777e5c6]
- Updated dependencies [0c386dd]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
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
- Updated dependencies [1f31d3a]
- Updated dependencies [d1842ab]
- Updated dependencies [78ca238]
- Updated dependencies [d8ec8d6]
- Updated dependencies [351eb31]
- Updated dependencies [866cd1d]
- Updated dependencies [20c04b2]
- Updated dependencies [84ffdbc]
- Updated dependencies [a276480]
- Updated dependencies [01c9023]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [4b5bb95]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [8952395]
- Updated dependencies [e2b3826]
- Updated dependencies [0348bc9]
- Updated dependencies [e8c553b]
- Updated dependencies [2e32ed4]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [67dadd6]
- Updated dependencies [e21308e]
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
- Updated dependencies [2d3fe73]
- Updated dependencies [ed27d7c]
- Updated dependencies [7dedec6]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [0809f8a]
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
- Updated dependencies [e1c27e4]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [6778809]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [0758bd8]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [0ea7054]
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
- Updated dependencies [40a7c53]
- Updated dependencies [abc1b18]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [270f282]
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
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [0a174f3]
- Updated dependencies [676f677]
- Updated dependencies [6fda1a9]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [c5c0e2a]
- Updated dependencies [55ba3ff]
- Updated dependencies [baf3776]
- Updated dependencies [c489260]
- Updated dependencies [f1190b0]
- Updated dependencies [8fda009]
- Updated dependencies [fd9bf26]
- Updated dependencies [561abef]
- Updated dependencies [ef52001]
- Updated dependencies [b8a0068]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [c5faf06]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [e36acd4]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [60e1f80]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [152f0a7]
- Updated dependencies [8693b85]
- Updated dependencies [bbf068d]
- Updated dependencies [e82dad1]
- Updated dependencies [58b7b3d]
- Updated dependencies [84defab]
- Updated dependencies [681d3f1]
- Updated dependencies [969d4f2]
- Updated dependencies [358aff8]
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
- Updated dependencies [7ec600d]
- Updated dependencies [7cbc724]
- Updated dependencies [4a94c38]
- Updated dependencies [7098eed]
- Updated dependencies [3df7c5c]
- Updated dependencies [fb91ac9]
- Updated dependencies [fb91ac9]
- Updated dependencies [641fb55]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [03370ce]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [502eb58]
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
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
- Updated dependencies [f7fcc2c]
- Updated dependencies [f0f4d6c]
- Updated dependencies [6df9141]
- Updated dependencies [3e4f632]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [4598f6d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [44152c4]
- Updated dependencies [3939545]
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [20b5e36]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [63bf47d]
- Updated dependencies [5a311a3]
- Updated dependencies [99c4eb8]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [276d174]
- Updated dependencies [19d1f24]
- Updated dependencies [8f37c4e]
- Updated dependencies [62597c5]
- Updated dependencies [2982ed9]
- Updated dependencies [741864f]
- Updated dependencies [58d65c5]
- Updated dependencies [8813335]
- Updated dependencies [509f8ed]
- Updated dependencies [de5d400]
- Updated dependencies [31d34cb]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [76f1543]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [9f7e846]
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
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [fe76ece]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [7102b20]
- Updated dependencies [8ebd57f]
- Updated dependencies [617707a]
- Updated dependencies [c40f3b8]
- Updated dependencies [58770f3]
- Updated dependencies [aefe428]
- Updated dependencies [485f096]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [9e22085]
- Updated dependencies [b655a9d]
- Updated dependencies [8e67cc4]
- Updated dependencies [c574dfb]
- Updated dependencies [02f48b6]
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
- Updated dependencies [c269ed9]
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [fffa30d]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
- Updated dependencies [4dc80d0]
- Updated dependencies [9d9040d]
- Updated dependencies [20e317c]
- Updated dependencies [425762e]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [584eeca]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [9850c6e]
- Updated dependencies [de570cc]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [19cbf10]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [1e66879]
- Updated dependencies [c5200f0]
- Updated dependencies [af3861f]
- Updated dependencies [2609812]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [83ec618]
- Updated dependencies [4f14ad7]
- Updated dependencies [258d264]
- Updated dependencies [4d963a2]
- Updated dependencies [cac64b3]
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
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [591bf27]
- Updated dependencies [38a9568]
- Updated dependencies [f90b8fb]
- Updated dependencies [91783c4]
- Updated dependencies [982885d]
- Updated dependencies [dba7d84]
- Updated dependencies [ca39427]
- Updated dependencies [43ca9d5]
- Updated dependencies [bd09957]
- Updated dependencies [5a07e67]
- Updated dependencies [2d36552]
- Updated dependencies [45d8288]
- Updated dependencies [b2437a7]
- Updated dependencies [f157423]
- Updated dependencies [7a90afd]
- Updated dependencies [ba306e3]
- Updated dependencies [eddc1dd]
- Updated dependencies [490f482]
- Updated dependencies [27308c5]
- Updated dependencies [8689166]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [26a2238]
- Updated dependencies [9101be5]
- Updated dependencies [f53a8d0]
- Updated dependencies [5d79faf]
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
  - @object-ui/plugin-grid@17.7.0
  - @object-ui/plugin-form@17.7.0
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
- d006ce1: `object-view`: a top-level `conditionalFormatting` no longer reaches the kanban view.
  
  `ObjectView.generateViewSchema`'s kanban branch resolved its rule list from a
  three-link chain: `options.kanban.conditionalFormatting`, then the active view's
  own rule, then `(schema as any).conditionalFormatting` read straight off the
  `object-view` node. The first two links are declared surface. The third was not:
  `ObjectViewSchema` has no such member, the `object-view` registry registration
  does not publish it in `inputs`, and `BaseSchema`'s index signature keeps tsc
  silent — yet it was honoured, because that branch runs exactly when no host
  supplies `renderListView`, which is the path the registered renderer takes.
  
  That one key was the sole counter-example to the objectui#5097 exemption, whose
  stated basis is that its 27 keys are reachable only through the host-supplied
  delegation. Maintainer ruling of 2026-08-19 on objectui#5248 (verbatim
  「全部接受」): Option 2, gated on a liveness check, with Option 1 (declare the key
  on `ObjectViewSchema` and in the registry `inputs`) pre-ruled for the case where
  the check found real authored usage. The check came back empty — no authored
  document in either repo puts `conditionalFormatting` on an `object-view` node
  (objectui docs carry it only on `object-grid`, the authoring skill only on
  `list-view`; objectstack authors no `object-view` node at all) — so the read was
  dropped rather than the key declared.
  
  Behavior change, stated because it is one: an `object-view` node that carried a
  top-level `conditionalFormatting` and rendered a kanban view now renders that
  kanban unformatted. Author the rules where they are declared — under
  `options.kanban.conditionalFormatting`, or on the view — and both keep working
  with the same precedence as before.
  
  Not narrowed: the host `renderListView` delegation still reads the key off the
  `object-view` node and forwards it to the host's list renderer. It remains
  host-composition surface under objectui#5097; only the author-reachable path
  closed. Both halves are pinned in
  `packages/plugin-view/src/__tests__/ObjectView.kanbanConditionalFormatting.test.tsx`,
  and `objectViewHostSurface.test.tsx` now asserts that ZERO exempt keys are read
  outside the host-composition fence.

### Patch Changes

- ad07b65: Four packages stop publishing tooling material in their `dist/`
  
  Each of these packages spelled its build exclusions as `*.test.*`, while this repo's tooling convention is a directory one — `__tests__` / `__mocks__` / `__benchmarks__`, exactly as `TOOLING_FILE` in `scripts/check-phantom-dependencies.mjs` spells it. Any tooling file whose *name* is not `*.test.*` therefore stayed in the emit program and shipped in the tarball. This is the same shape and the same cause as objectui#4006, which fixed `@object-ui/fields` and `@object-ui/plugin-editor` by the filename criterion and so did not reach these four.
  
  Measured by building each package from a cleared `dist/` on both sides of the change. Nine files disappear, none appears, and every surviving file is untouched — the totals move by exactly the count removed:
  
  | package | `dist/` files | removed |
  | --- | --- | --- |
  | `@object-ui/core` | 176 to 174 | `dist/__benchmarks__/core.bench.js`, `core.bench.d.ts` |
  | `@object-ui/plugin-designer` | 70 to 66 | `dist/__tests__/__mocks__/plugin-form.d.ts`, `plugin-grid.d.ts`, and both `.d.ts.map` |
  | `@object-ui/plugin-grid` | 62 to 60 | `dist/__tests__/explainDouble.d.ts` and its `.d.ts.map` |
  | `@object-ui/plugin-view` | 13 to 12 | `dist/__tests__/explainDouble.d.ts` |
  
  Only `@object-ui/core`'s had runtime weight. The other eight are declarations nothing resolves, but `core.bench.js` is a real emitted module whose first import is `import { bench, describe } from 'vitest'` — a runtime import of a package a consumer never installs, since `vitest` is a devDependency of `@object-ui/core` and devDependencies are not installed transitively. Nothing resolves it today either (it is not in the `exports` map), so no consumer breaks in either direction; this is the tarball shedding files nothing reached.
  
  No type coverage leaves with the emit. The three plugins' helper and mock files are already program inputs of the `tsconfig.test.json` that each package's `type-check` chains, reached through the imports in the suites beside them — `tsc --listFiles` names all four files on both sides of the change. `core.bench.ts` had no such edge, since nothing imports a benchmark, so it is now named explicitly in `packages/core/tsconfig.test.json`. That move was deliberate rather than forced: `scripts/check-type-check-coverage.mjs` enumerates `*.test.ts(x)` only, so a benchmark that no program reads is invisible to it, and dropping the coverage silently would have been the "coverage that was right by accident" objectui#4006 recorded. Verified by appending a provably-false annotation to the benchmark, which turns `tsc -p packages/core/tsconfig.test.json` red at exit 2.
- 20bc99f: `ObjectView` forwards the canonical `table` keys — `pagination` / `selection` / `filter` / `sort` now take effect, and the deprecated spellings keep working as aliases.
  
  `ObjectViewSchema.table` is documented as inheriting from `ObjectGridSchema`,
  but `ObjectView` does not spread it: it forwards a hand-written whitelist of
  keys, and that whitelist carried only the **deprecated** half of four pairs.
  `pageSize`, `selectable`, `defaultFilters` and `defaultSort` were forwarded;
  their canonical successors `pagination`, `selection`, `filter` and `sort` had
  **no read point at all** in the file.
  
  So an author who wrote the shape the type recommends — `table: { pagination:
  { pageSize: 25 } }`, having read `@deprecated Use pagination.pageSize instead`
  on the key they were avoiding — got a view that compiled, read correctly, and
  did nothing. There was no failure signal at any layer: the key is declared on
  `ObjectGridSchema`, `ObjectGrid` already reads it, and only this forwarding hop
  dropped it. That silent success is the defect being closed.
  
  All four canonical keys are now forwarded at every site that forwarded their
  deprecated counterpart: the grid schema, the non-grid data fetch
  (kanban / gallery / calendar / timeline / gantt / map), and the delegated
  `renderListView` schema. When an author writes both spellings the **canonical
  key wins** — it is read first in the chains `ObjectView` resolves itself, and on
  the grid path both slots are forwarded so `ObjectGrid`'s existing canonical-first
  resolution decides, keeping the two layers in agreement.
  
  Nothing that worked before changes. The deprecated spellings are still read and
  are still the value used when they are the only one written; no canonical value
  is synthesised from a deprecated one, so `ObjectGrid`'s `pagination`-keyed
  behaviour is untouched for views that only ever wrote `pageSize`. The two
  precedence segments ahead of `table` — a named `listViews` entry, then the
  active view — are untouched, and a named view still outranks a `table` default.
  
  Declaration-surface note: `table` remains `Partial< Omit< ObjectGridSchema, … > >`,
  which the `BaseSchema` index signature collapses to zero declared members, so
  editor completion still offers no keys and a misspelling is still accepted
  silently. That half is deferred to the structural track and is not addressed
  here.
- e22b9d7: `ObjectView` sends a named view's `sort` to the grid slot that can hold it — the declared sort now reaches both the header indicator and `$orderby`.
  
  A named view's sort is an **array**: `NamedListView.sort` is
  `Array< { field, order } >`, and the `views` prop declares an array too.
  `ObjectView` forwarded the resolved view sort into `gridSchema.defaultSort`,
  which `ObjectGridSchema` declares as a **single** `{ field, order }`. The
  arity mismatch had no compile-time witness — `ObjectViewSchema.table`
  collapses to a bare index signature — and both of `ObjectGrid`'s readers then
  failed, in different ways:
  
  - **The header drew nothing.** `parseSchemaSort(schemaSort ?? (schema.defaultSort
    ? [schema.defaultSort] : undefined))` re-wraps an already-array `defaultSort`
    into `[[{ field, order }]]`. Each entry must be a string or an object with a
    string `field`; a nested array is neither, so the entry was skipped and the
    parse returned `[]`. A view that arrived sorted `name desc` looked unsorted,
    and the first click on that column asked for `asc` on a list already `desc`.
  - **The fetch sent nonsense.** `` `${(schema.defaultSort as any).field} ${(schema
    .defaultSort as any).order}` `` reads two absent keys off an array, so the
    request carried the literal string `"undefined undefined"` as `$orderby`.
    `serializeOrderBy` passes a non-empty string through untouched, so that
    reached the server verbatim.
  
  The two view precedence segments (`listViews` entry, then the active `views`
  entry) now ride the **canonical** `sort` slot, declared `string | SortConfig[]`
  — the arity a view actually carries, and the only one of the pair that can
  express a multi-key sort at all. The legacy `defaultSort` slot keeps carrying
  the `table` segment alone and is read exactly as before.
  
  **Precedence is unchanged.** `ObjectGrid` resolves `sort ?? defaultSort`, so a
  view sort still outranks both `table.sort` and `table.defaultSort`, and a
  `table.sort` still outranks a `table.defaultSort` — the same order the non-grid
  fetch and the delegated `renderListView` schema already express. A view that
  supplies no sort forwards exactly what it forwarded before.
  
  This is also the shape the shared sort sink accepts (`convertSortToQueryParams`
  takes `string | SortConfig[]`), so the fix converges on the normalized dialect
  rather than adding another spelling for the sort-sink convergence work to fold
  in later.
- 2426608: `ObjectView` now forwards the canonical `table.columns` on the non-grid paths, not only on the grid one.
  
  `ObjectViewSchema.table` inherits from `ObjectGridSchema`, where `columns` is the
  canonical spelling and `fields` carries `@deprecated Use columns instead`. Only
  one of the file's three field-list read points consulted `table.columns` — the
  grid one. `generateViewSchema`'s shared `baseProps` and the delegated
  `renderListView` schema both read `table.fields` alone, so an author who wrote
  `table: { columns: [...] }` on a non-grid view got an empty field list from a
  schema that compiled and read correctly. Same silent-success shape as
  objectui#5102, different mechanism: not a whitelist that knows only legacy
  spellings, but one that disagreed with itself between two rendering paths.
  
  Both sites now read the canonical key first and keep the deprecated one as a
  working alias, exactly as objectui#5102 settled it for its four pairs. Nothing
  is translated or reshaped on the way through, and precedence is unchanged: a
  named view's `columns`, then the active view's, then the `table` segment.
  
  Where this is observable, measured rather than assumed: `object-kanban` (the
  card fields) and `object-tree` (its flat columns) consume the shared
  `baseProps` field list, and the delegated `list-view` consumes `columns`.
  `object-gallery`, `object-calendar`, `object-timeline`, `object-gantt` and
  `object-map` read no field list off their schema at all, so the forwarded value
  is inert there — before this change and after it.
  
  One shape question the forwarding raised, answered at the boundary:
  `table.columns` is `string[] | ListColumn[]`, and the non-grid slot is a
  names slot (`ObjectKanban` indexes the record by each entry). The object form
  is therefore resolved to field names there with `columnIdentity` — the same
  fold `ObjectGrid` applies to this very value — so one authored `table.columns`
  resolves identically on both paths, and a `ListColumn[]` cannot arrive as a
  non-empty card field list naming nothing (which would suppress ObjectKanban's
  `highlightFields` fallback and render emptier than the bug being fixed). The
  delegated `list-view` slot declares the same union and keeps the value raw, so
  an author's per-column `label` / `width` still reach the list renderer.
- 99d5659: The plugin-view documentation-site page now teaches the keys `ObjectView`
  actually reads, so a copied example renders instead of coming up empty.
  
  `content/docs/plugins/plugin-view.mdx` carried the same fictional key surface
  the README did before it was rewritten: the object name was spelled `object`
  (the real key is `objectName`, the only required one besides `type`), the page
  was organised around a `viewMode` trichotomy that does not exist, and
  `fields` / `mode` / `recordId` / `fieldConfig` / `nestedFields` / `tabs` /
  `filters` / `searchable` / `enableDelete` went with it. None of those is a
  declared member of `ObjectViewSchema`, and none is read anywhere in
  `packages/plugin-view/src`. Because `type: 'object-view'` is genuinely
  registered, a copied example still resolved to a renderer — it just never
  received an `objectName`, and the component's data effects are all guarded on
  it, so the reader got a silent empty view rather than an error.
  
  The Schema API section and every example after it were rewritten against the
  declared surface, with each key measured against the renderer's read points
  before being written: `defaultViewType` (plus `listViews` / `defaultListView`)
  for the list type, `layout` and its drawer/modal/page record surface in place of
  the separate "form view" and "detail view" narratives, `table` and `form` for
  grid and form configuration, `operations` booleans and `onNavigate` in place of
  the `onCreate` / `onUpdate` / `onDelete` callbacks that were never part of this
  contract, and the `show*` toolbar toggles. The examples are now typed
  `ObjectViewSchema` blocks rather than untyped JSON, which makes a missing
  `objectName` a compile error in all fourteen of them — the page previously had
  no assertion at all, since `ObjectViewSchema` inherits an index signature from
  `BaseSchema` that accepts any undeclared key.
  
  Three structural facts are stated outright: `dataSource` is a required prop of
  `ObjectViewProps` and not a schema key; create, edit and read are internal
  states of one record surface rather than authored modes; and `ObjectView`
  forwards a fixed list of keys out of `table` and `form` rather than passing
  those objects through, so the page names exactly which ones — including that
  page size on this path is `table.pageSize`, not `table.pagination`.
  
  The TypeScript Support snippet's `import type { ObjectViewSchema }` also moves
  from `@object-ui/plugin-view`, which does not export it, to `@object-ui/types`,
  where it is declared. Copying the old line produced a TS2305.
- 405d54e: The plugin-view README now documents the keys `ObjectView` actually reads, so a
  copied example renders instead of coming up empty.
  
  Every untyped schema literal in the README was written against a key vocabulary
  `ObjectViewSchema` does not declare and `ObjectView` does not read. The object
  name was spelled `object` — the real key is `objectName`, and it is the only
  required key besides `type` — so a copied example left the component with no
  object to query. Three "view modes" were organized around a `viewMode` key that
  exists nowhere, and `fields`, `mode`, `recordId`, `fieldConfig`, `nestedFields`,
  `tabs`, `searchable`, `sortable`, `filters` and `enableDelete` were documented
  the same way. None of it failed loudly: `ObjectViewSchema` extends a base schema
  carrying a `[key: string]: any` index signature, so excess-property checking is
  defeated on this type, and the blocks carried no type annotation to trip even
  the one assertion that does bite.
  
  The thirteen affected blocks are rewritten against the declared surface, each
  one measured against the renderer before being written: `defaultViewType` (plus
  `listViews` / `defaultListView`) for the list type, `layout` with its
  drawer/modal/page record surface for what the README called form and detail
  views, `table` and `form` for grid and form configuration, `operations`
  booleans and `onNavigate` in place of the `onCreate` / `onUpdate` / `onDelete` /
  `onSubmit` callbacks that were never part of this contract, and the `show*`
  toolbar toggles. Examples now carry `ObjectViewSchema` annotations, which makes
  a missing `objectName` a compile error in all fifteen of them.
  
  Three structural facts are stated outright rather than left to be inferred:
  `dataSource` is a required prop of `ObjectViewProps` and not a schema key, so
  putting it in the schema does nothing; create/edit/read are internal states of
  one record surface rather than authored modes, which is why `ObjectViewSchema`
  omits `mode` from its `form` block; and `ObjectView` forwards a fixed list of
  keys out of `table` and `form` rather than passing those objects through, so the
  README now names exactly which ones — including that page size is `table.pageSize`
  on this path, the spelling the component forwards.
  
  The `ViewSwitcher`, `FilterUI` and `SortUI` sections are untouched: their keys
  were checked against the registered `inputs` and already matched.
- d2cf8fd: docs: README 按真实导出面重写虚构的 `viewComponents` 手动注册,并把 `ObjectViewSchema` 的导入路径改到 `@object-ui/types`
  
  `### Manual Registration` 教的 `viewComponents` 在本包(以至全仓)零命中,照抄第一行就是
  `Object.entries(undefined)` 抛 TypeError;替换为三节真话:七个 `ComponentRegistry.register`
  调用认领的 schema 类型键表、本包 39 个真实导出名、以及把导出组件挂到自定义键的写法。
  
  `ObjectViewSchema` 是真类型,但声明在 `@object-ui/types`,本包只 import 不 re-export,按
  README 原路径导入是 TS2305;改导入路径(未新增任何导出或 re-export),示例键面随之对齐真身
  (`objectName` 必填、`defaultViewType`、`table.columns`)。
  
  无代码/类型/运行时改动。声明 patch 是因为 `README.md` 在包的 `files` 里,随下次发布到 npm。
- Updated dependencies [88085e3]
- Updated dependencies [69251bf]
- Updated dependencies [57e668f]
- Updated dependencies [516663d]
- Updated dependencies [41ac1b7]
- Updated dependencies [1eaf0a1]
- Updated dependencies [feb6b16]
- Updated dependencies [460c4d0]
- Updated dependencies [0ae27f7]
- Updated dependencies [9aecabe]
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
- Updated dependencies [9b20dea]
- Updated dependencies [469b604]
- Updated dependencies [8b9dc62]
- Updated dependencies [d7be3bd]
- Updated dependencies [a954b48]
- Updated dependencies [bda9b12]
- Updated dependencies [e354dd0]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
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
- Updated dependencies [f68018d]
- Updated dependencies [d374caf]
- Updated dependencies [5673576]
- Updated dependencies [c1ef923]
- Updated dependencies [911ceaa]
- Updated dependencies [98eab36]
- Updated dependencies [375efb4]
- Updated dependencies [af5e292]
- Updated dependencies [3fbbea1]
- Updated dependencies [3e0214c]
- Updated dependencies [800f455]
- Updated dependencies [dbbd38a]
- Updated dependencies [27c9cbd]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [616a2a5]
- Updated dependencies [0046d8f]
- Updated dependencies [3b03704]
- Updated dependencies [f1d4748]
- Updated dependencies [bea374e]
- Updated dependencies [b1119ec]
- Updated dependencies [9f23d2b]
- Updated dependencies [b4089be]
- Updated dependencies [578e025]
- Updated dependencies [b4bccc7]
- Updated dependencies [af025ee]
- Updated dependencies [d109a4d]
- Updated dependencies [598c89a]
- Updated dependencies [4a0bd17]
- Updated dependencies [b8b9af4]
- Updated dependencies [31676be]
- Updated dependencies [958d757]
- Updated dependencies [8c0d52e]
- Updated dependencies [bfb64ee]
- Updated dependencies [e09f9e8]
- Updated dependencies [03e5f97]
- Updated dependencies [ae804ec]
- Updated dependencies [b29488f]
- Updated dependencies [9fbb9b5]
- Updated dependencies [90517e1]
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
- Updated dependencies [2165d88]
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
  - @object-ui/i18n@17.6.0
  - @object-ui/react@17.6.0
  - @object-ui/plugin-grid@17.6.0
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0
  - @object-ui/plugin-form@17.6.0

## 17.5.0

### Patch Changes

- d0c3b26: Every plain `<button>` now declares its `type`. HTML defaults an untyped button to
  `type="submit"`, so any of these buttons would submit the form it was composed into
  instead of running its own handler — a real risk for renderers (`drawer`, `tree-view`,
  `navigation-overlay`) whose placement inside a form is a JSON metadata decision. 114
  sites were converted to `type="button"`; no site was a genuine submit button, and the
  DOM is otherwise unchanged.

  The defect class is now closed mechanically by a new `object-ui/button-has-type` ESLint
  rule (error), so the next untyped button fails CI at write time rather than being found
  by a fourth audit round (objectui#4045, closing the objectui#3344 family).

- 3f5f87c: `SchemaRenderer` states its real contract — a typed, required `schema` and a deliberate forwarding surface

  `SchemaRenderer` is the renderer loop: every registered SDUI component is rendered through it. It handed `forwardRef` a props type of `{ schema: SchemaNode } & Record<string, any>`, which puts `string` into `keyof Props`, so `'ref' extends keyof Props` was always true, React's `PropsWithoutRef` took its `Omit` branch, and `Omit` over a type carrying a string index signature keeps only the index signature. Every declared prop was erased. Measured on the pre-fix source: `keyof ComponentProps<typeof SchemaRenderer>` was `string` and `ComponentProps<typeof SchemaRenderer>['schema']` was `any`, while the type argument went on declaring `SchemaNode`. The other half is the same defect seen from the call site — `<SchemaRenderer />` with no schema at all, `<SchemaRenderer schema={12345} />`, and an arbitrary misspelled prop each type-checked in silence. This is objectui#4422 / PR #4438's trap in the most central component in the repo, spelled `Record<string, any>` rather than `[key: string]: any`, which is why every previous sweep's grep and both shipped guards' detector reported the site as clean.

  Graded **minor, not major**, on objectui#4528's reasoning: the type argument has always DECLARED `schema`; the index signature erased it from the resolved type, and restoring what the declaration documents is a fix to the published contract rather than a contract break.

  **The forwarding surface is kept, deliberately.** This component forwards every prop it does not read to the component the schema names, resolved at runtime from a plugin-extensible registry — `packages/react/README.md` documents exactly that, and `@object-ui/components`' form renderer consumes the `onSubmit` it shows being forwarded. Closing that surface would state a false contract and would force every leaf plugin's props into this package. So the two halves are separated: the `forwardRef` type argument is the honest `SchemaRendererProps`, with no index signature for `PropsWithoutRef` to collapse, and the open surface is stated once in an explicit export annotation, which nothing routes through `Omit`. The published `.d.ts` shows the erasure disappearing: `ForwardRefExoticComponent<Omit<{ schema: SchemaNode } & Record<string, any>, "ref"> & RefAttributes<any>>` becomes `ForwardRefExoticComponent<SchemaRendererProps & Record<string, any> & RefAttributes<any>>`.

  `SchemaRendererProps.schema` is declared as `BaseSchema | string | null | undefined` — what this component actually handles. It previously declared `@object-ui/core`'s `SchemaNode` interface, which requires `type: string` and so contradicted the component's own early returns for strings and nullish, while every caller held `@object-ui/types`' wider union. The erasure hid that mismatch completely.

  **One declared behaviour change.** A non-object, non-string primitive schema now renders as its own text. It previously fell through to the shallow copy `{ ...schema }`, which spreads a primitive to an empty object, lost the `type` the renderer then looked up, and surfaced the red "Unknown component type: undefined" box — an accident of the spread rather than a decision. The declared props type excludes `number` / `boolean` so no author is invited to pass them; the runtime handling is defence-in-depth for untyped callers and stored metadata. Strings, `null`, `undefined`, `0` and `false` render exactly as before, and an object naming an unregistered type still gets the error box; all four are pinned.

  Latent defects the erasure had been hiding, each surfaced by the repo-wide type-check and fixed at its call site: `DashboardRenderer` cast its widget schema to `Record<string, any>`, dropping the `type` every branch of `getComponentSchema` sets; `DashboardGridLayout`'s equivalent now states its return type instead of inferring a union that admitted a shape with no `type`; and `ReportViewer` handed a section's `content` array to the renderer whole, so a multi-node section rendered the unknown-component box instead of its content — arrays are mapped rather than widened into the renderer's declared input.

  A repo-wide structural guard replaces the two per-package siblings' blocked direction: it judges every `forwardRef` in `packages/*/src` (219 sites) and its detector resolves `Record<string, …>` and `string`-keyed mapped types in addition to literal index signatures — the spelling the previous detector went blind on. It judges the type argument only, where an index signature is an accidental eraser, and never an export annotation, where one is a stated contract.

- Updated dependencies [0e67b53]
- Updated dependencies [ceccdcf]
- Updated dependencies [d6e5124]
- Updated dependencies [debad27]
- Updated dependencies [dc2aa3e]
- Updated dependencies [ee66e2e]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [932cbcd]
- Updated dependencies [734d186]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [8f85f8b]
- Updated dependencies [7ffd616]
- Updated dependencies [d0c3b26]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [f7c6430]
- Updated dependencies [4dadf0d]
- Updated dependencies [ae10a01]
- Updated dependencies [77d6f28]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [4b70d28]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [ebb4e0e]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [b4d3c22]
- Updated dependencies [1f9b905]
- Updated dependencies [cb13400]
- Updated dependencies [828549a]
- Updated dependencies [e1ade8f]
- Updated dependencies [bc64bfe]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [51ab34e]
- Updated dependencies [24bb2de]
- Updated dependencies [0ca6096]
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [5cc847c]
- Updated dependencies [fa21254]
- Updated dependencies [f565418]
- Updated dependencies [33c32bf]
- Updated dependencies [66fb4fa]
- Updated dependencies [b953a97]
- Updated dependencies [d7f3e30]
- Updated dependencies [6d641c9]
- Updated dependencies [7e4f0e5]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [51ac39f]
- Updated dependencies [5e514c4]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [58bebf6]
- Updated dependencies [36310dc]
- Updated dependencies [405e808]
- Updated dependencies [49ae9f4]
- Updated dependencies [a3ae404]
- Updated dependencies [4270c11]
- Updated dependencies [bfdf3d4]
- Updated dependencies [bb68488]
- Updated dependencies [c0f9a4b]
- Updated dependencies [b1e42d0]
- Updated dependencies [2459a3e]
- Updated dependencies [ac853ce]
- Updated dependencies [fa51109]
- Updated dependencies [d6aa172]
- Updated dependencies [c32a8a1]
- Updated dependencies [fe52a04]
- Updated dependencies [d46f9b8]
- Updated dependencies [3f5f87c]
- Updated dependencies [2fea4d2]
- Updated dependencies [f5e1143]
- Updated dependencies [7f1cb33]
- Updated dependencies [f148a64]
- Updated dependencies [bb68488]
- Updated dependencies [2e3b0c0]
- Updated dependencies [9461dd3]
- Updated dependencies [78fa331]
- Updated dependencies [47f551b]
- Updated dependencies [31ab1ac]
- Updated dependencies [0082db8]
- Updated dependencies [ab04728]
- Updated dependencies [5bf09fd]
- Updated dependencies [06915b0]
- Updated dependencies [ff84b05]
  - @object-ui/i18n@17.5.0
  - @object-ui/react@17.5.0
  - @object-ui/components@17.5.0
  - @object-ui/core@17.5.0
  - @object-ui/types@17.5.0
  - @object-ui/plugin-grid@17.5.0
  - @object-ui/plugin-form@17.5.0

## 17.4.0

### Patch Changes

- Updated dependencies [794c497]
- Updated dependencies [993336f]
- Updated dependencies [f0a625a]
- Updated dependencies [b5980f4]
- Updated dependencies [8aad9fd]
- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [7864f03]
- Updated dependencies [0cbdca8]
- Updated dependencies [d229dfa]
- Updated dependencies [18c42c6]
- Updated dependencies [ecae400]
- Updated dependencies [4bc6c23]
- Updated dependencies [d3e738a]
- Updated dependencies [c3b01a7]
- Updated dependencies [f5f8744]
- Updated dependencies [8497579]
- Updated dependencies [f0c9a90]
- Updated dependencies [7ed3360]
- Updated dependencies [69becd2]
- Updated dependencies [5e52495]
- Updated dependencies [0fa5e4d]
- Updated dependencies [b750823]
- Updated dependencies [5bfaabd]
- Updated dependencies [022002a]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [c2fd122]
- Updated dependencies [1bd6faa]
- Updated dependencies [9154d9e]
- Updated dependencies [ac2139c]
- Updated dependencies [b14ab3a]
- Updated dependencies [e24d767]
- Updated dependencies [8c60819]
- Updated dependencies [aca561a]
- Updated dependencies [e64a52e]
- Updated dependencies [844d17f]
- Updated dependencies [48132f7]
- Updated dependencies [4dcd52a]
- Updated dependencies [42ae5c6]
- Updated dependencies [0ef9dfd]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [6d762da]
- Updated dependencies [e6fdbdc]
- Updated dependencies [54233b1]
- Updated dependencies [f9faa7d]
- Updated dependencies [97b63d7]
- Updated dependencies [14c59c0]
- Updated dependencies [aeb8424]
- Updated dependencies [6bb454a]
- Updated dependencies [1a33b1a]
- Updated dependencies [11c1e71]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [33526fd]
- Updated dependencies [32413ec]
- Updated dependencies [c1e1e6b]
  - @object-ui/components@17.4.0
  - @object-ui/react@17.4.0
  - @object-ui/core@17.4.0
  - @object-ui/i18n@17.4.0
  - @object-ui/types@17.4.0
  - @object-ui/plugin-grid@17.4.0
  - @object-ui/plugin-form@17.4.0

## 17.3.0

### Patch Changes

- 28b2e65: Localize the create / edit / view form title `ObjectView` builds itself
  (objectui#3462)

  The same family as #3426 / PR #3457 and #3459 / PR #3464, one call site further
  in. `ObjectView.getFormTitle()` string-built its three verbs in TypeScript:

      case 'create': return `Create ${objectLabel}`;
      case 'edit':   return `Edit ${objectLabel}`;
      case 'view':   return `View ${objectLabel}`;

  so a Chinese session whose object is labelled 联系人 read a drawer headed
  **"View 联系人"** — an English verb glued onto a localized label. All three
  consumers are visible chrome: `renderDrawerForm`'s `DrawerTitle`,
  `renderModalForm`'s `DialogTitle`, and the `title` prop handed to
  `NavigationOverlay` in the `popover` branch (a host-supplied `title` displaces
  the overlay's own `resolvedTitle` default, so it is what the user sees).

  The bar to reach it is lower than #3459's split panel: `ObjectViewSchema.layout`
  already defaults to `'drawer'`, and `navigation` is a declared authorable input
  on the registered `object-view` block whose `mode` union carries `drawer`,
  `modal` and `popover`. A row click under any of them sets `formMode: 'view'` and
  opens the container. `app-shell`'s wrapper pinning `layout: 'page'` is one host
  overriding a registered block, not proof the branch is dead.

  ## What changed

  The three verb branches resolve `form.createTitle` / `form.editTitle` /
  `form.viewTitle`.

  **No new key family was minted.** `form.createTitle` (`'Create {{object}}'`) and
  `form.editTitle` (`'Edit {{object}}'`) already ship in all ten packs and are
  already how `app-shell` heads the PAGE-mode record form
  (`RecordFormPage.tsx`, `AppContent.tsx`). The drawer / modal / popover titles are
  the same heading on a different surface, so they resolve the same keys — a
  parallel per-plugin family would have guaranteed the two spellings drift, which
  is what the sibling issues were about. Only the third verb had no sibling:
  `form.viewTitle` is added to all ten packs, following each pack's existing
  arrangement for its create/edit twins rather than a translated-verb-plus-label
  concatenation (de puts the verb last, ja/zh use particles and no space).

  `VIEW_DEFAULT_TRANSLATIONS` in `ObjectView.tsx` gains the three English entries,
  which is what `createSafeTranslation` falls back to with no `I18nProvider`
  mounted.

  Two branches stay literal on purpose and are pinned by tests: `schema.form.title`
  (the author wrote a title, so the author's title wins, in every locale) and the
  `default` branch (bare object label, no verb to translate).

  ## Visible English change

  None. Every branch is byte-identical in English — `Create Contacts`,
  `Edit Contacts`, `View Contacts` — with and without a provider, so e2e specs and
  host tests that address this chrome by its English name keep addressing it. The
  provider-less path has its own test file, kept separate because
  `initReactI18next` registers its instance as a module global that outlives
  `cleanup()`.

  The toolbar's create BUTTON keeps resolving `console.objectView.new`
  ("New" / 新建) and was deliberately not reused for the heading: a button verb and
  a title are different contexts, and folding them together is how the next drift
  of this shape would start.

- aa36e60: Localize the record-detail headings that `ObjectKanban`, `ObjectTree` and
  `ObjectView` build themselves (objectui#3459)

  #3426 / PR #3457 keyed `ListView` and `ObjectGrid`; a repo-wide grep found the
  same pattern in three more hosts, each string-building an English heading in
  TypeScript so the surrounding drawer/panel was fully localized with one English
  phrase on top of it.

  - `packages/plugin-kanban/src/ObjectKanban.tsx` — the object-derived heading of
    the card-detail drawer
  - `packages/plugin-tree/src/ObjectTree.tsx` — the bare literal
    `"Record Details"` handed to `NavigationOverlay`
  - `packages/plugin-view/src/ObjectView.tsx` — `` `${objectLabel} Detail` `` on
    the `mode: 'split'` panel

  All three are user-reachable, each verified by a test that drives the real
  interaction (render the block, click a card/row, read the heading), not by
  inspection:

  - `object-kanban` is a public page block whose `navigation` config DEFAULTS to
    `{ mode: 'drawer' }`, so a board needs no authoring at all to open this
    drawer on card click;
  - `object-tree` needs `navigation: { mode: 'drawer' }` authored explicitly, and
    every row's click is wired to `navigation.handleClick`;
  - `object-view` declares `navigation` as an authorable input and maps
    `mode: 'split'` onto the branch that renders this heading.

  ## What changed

  Each call site now keys its heading through the existing `detail.*` pair —
  `detail.recordDetailWithLabel` (`'{{label}} Detail'`) where an object label is
  available, `detail.recordDetail` where none is. No new locale keys: both
  already ship in all ten packs from #3457, and reusing them keeps one heading on
  one control instead of minting per-plugin twins that drift.

  Each plugin gains its own English defaults map, which is what
  `createSafeTranslation` falls back to with no `I18nProvider` mounted;
  `@object-ui/plugin-tree` gains a dependency on `@object-ui/i18n` for it.

  ## Visible English change

  One, deliberate: the tree overlay's heading goes from the plural
  `Record Details` to the singular `Record Detail` — the spelling the whole
  `detail.*` family, including `NavigationOverlay`'s own default, already uses.
  The maintainer ruled on normalizing the stray plurals rather than minting a
  plural key; a repo-wide grep confirmed no `e2e/` spec and no unit test
  addressed the old string.

  Every other branch is byte-identical in English (`Contacts Detail`,
  `Support cases Detail`, `Contacts Detail`), with and without a provider —
  pinned by a provider-less test file per plugin, kept separate because
  `initReactI18next` registers its instance as a module global that outlives
  `cleanup()`.

  The kanban's other former plural (`'Card Details'`) is NOT a visible change: it
  sat on a branch that fires only when the board has no `objectName`, while the
  drawer consuming it returns `null` on that very condition. It is keyed anyway
  so the literal cannot leak if that guard ever relaxes, and it deliberately has
  no test — an assertion there would pass because nothing renders.

- Updated dependencies [18cd432]
- Updated dependencies [532cf8b]
- Updated dependencies [680080a]
- Updated dependencies [a7651e6]
- Updated dependencies [d915c47]
- Updated dependencies [b71fc92]
- Updated dependencies [65516ba]
- Updated dependencies [94c5b7c]
- Updated dependencies [ca0fa8f]
- Updated dependencies [34595eb]
- Updated dependencies [3889ffb]
- Updated dependencies [5781fb1]
- Updated dependencies [7e2406a]
- Updated dependencies [9e9e9a9]
- Updated dependencies [56409c2]
- Updated dependencies [042e09d]
- Updated dependencies [9cbcbf4]
- Updated dependencies [85c4c9c]
- Updated dependencies [fd54c3e]
- Updated dependencies [4eeb932]
- Updated dependencies [5c856ec]
- Updated dependencies [23018cc]
- Updated dependencies [53811d1]
- Updated dependencies [68b6a28]
- Updated dependencies [0554e88]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [28b2e65]
- Updated dependencies [509104a]
- Updated dependencies [825bbe3]
- Updated dependencies [6195841]
- Updated dependencies [5dd0127]
- Updated dependencies [06632e9]
- Updated dependencies [a415684]
- Updated dependencies [a4cff5b]
- Updated dependencies [175bd79]
- Updated dependencies [5af2852]
- Updated dependencies [f833d3a]
- Updated dependencies [30ae33a]
- Updated dependencies [a6ec93d]
- Updated dependencies [2a9513d]
- Updated dependencies [71be406]
- Updated dependencies [d22ae31]
- Updated dependencies [c7ed4c3]
- Updated dependencies [2409e1d]
- Updated dependencies [789fe3e]
- Updated dependencies [8d8094a]
  - @object-ui/core@17.3.0
  - @object-ui/components@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/plugin-grid@17.3.0
  - @object-ui/i18n@17.3.0
  - @object-ui/react@17.3.0
  - @object-ui/plugin-form@17.3.0

## 17.2.0

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [bca45cc]
- Updated dependencies [a889e31]
- Updated dependencies [09d30a4]
- Updated dependencies [4bf612c]
- Updated dependencies [335041c]
- Updated dependencies [b414983]
- Updated dependencies [256f8cc]
- Updated dependencies [d9668a7]
- Updated dependencies [4b470b9]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [5eaa861]
- Updated dependencies [4a51e77]
- Updated dependencies [f6e8d78]
- Updated dependencies [ea96284]
- Updated dependencies [d3584c6]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [850033c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/components@17.2.0
  - @object-ui/core@17.2.0
  - @object-ui/react@17.2.0
  - @object-ui/i18n@17.2.0
  - @object-ui/plugin-grid@17.2.0
  - @object-ui/plugin-form@17.2.0

## 17.1.0

### Minor Changes

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

### Patch Changes

- 4545380: fix(view): the spec→FilterBuilder map follows the four operators #2942 added

  `CANONICAL_TO_BUILDER` mapped `starts_with`, `ends_with`, `is_null` and
  `is_not_null` to `null`, with a comment asserting the FilterBuilder had no such
  operator. #2942 gave it `startsWith`, `endsWith`, `isNull` and `isNotNull` —
  and this table did not follow, so a stored view carrying any of the four still
  reached the builder as a raw spelling it could by then have rendered, and the
  comment claiming otherwise was simply false.

  All four now map. `is_null`/`is_not_null` go to `isNull`/`isNotNull` and **not**
  to `isEmpty`/`isNotEmpty`: the builder draws both pairs, and folding the NULL
  predicate onto the empty-string one would silently rewrite the author's operator
  the next time the view was saved.

  **The guard could not have caught this, and now can.** The parity test asserted
  the unmapped set equalled a hand-kept list of gaps — which stays true when the
  _builder_ gains an operator, because neither side of that comparison moves. The
  new assertion is derived instead: `starts_with` and `startsWith` fold to the same
  key, so an unmapped canonical operator whose folded name matches a folded builder
  id is an omission by definition. Verified by reverting the four mappings, which
  reproduces the drift as four named failures.

  The unmapped set is now empty — all 19 canonical `VIEW_FILTER_OPERATORS` members
  translate.

  Refs #2945, #2942, #2989

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

- bebaebd: refactor(view): remove ObjectView's filter/sort bar, which was never connected

  `ObjectView` carried its own filter and sort bar: `filterValues` / `sortConfig`
  state, a `filter-ui` schema and a `sort-ui` schema, ~80 lines of field
  introspection to build them. None of it was wired. No setter was ever called and
  neither schema was ever rendered — both states sat at their initial empty value
  for the component's entire life.

  Removed rather than wired, because the real filter and sort UI belongs to the
  renderer this component delegates to. `showFilters`, `showSort` and
  `filterableFields` are forwarded downstream and `ListView` implements them for
  real. Connecting the local copy would have produced a _second_ filter bar
  competing with that one.

  The dead state was not inert, though — it left a branch in every merge path that
  could never run, and those branches read as live code:

  - The fetch path merged `baseFilter` with a `userFilter` that was always `[]`.
  - `mergedFilters` (what the `renderListView` slot receives, used by the Studio
    design surface) opened with a branch that **replaced** the view's filter with
    the user's instead of combining them — which would have been a real bug had
    the state ever been written.

  Two "defects" reported against these branches during #3081 were unreachable for
  exactly this reason; that changeset carries the correction. Keeping code that
  looks live and cannot run is what made the misreading possible twice, which is
  the argument for deleting it rather than leaving it for the next reader.

  No behaviour change: every removed branch was unreachable, and the surviving
  paths are pinned by new tests covering both what the component queries with and
  what it hands the delegated renderer.

- 80edbd4: fix(view,components): the spec→FilterBuilder operator table covers the whole view vocabulary, and the dead write direction is gone

  `view-config-utils`' `SPEC_TO_BUILDER_OP` resolved **10 of the spec's 19
  canonical `VIEW_FILTER_OPERATORS`**. The nine it missed —
  `not_equals`, `starts_with`, `ends_with`, `greater_than`, `less_than`,
  `greater_than_or_equal`, `less_than_or_equal`, `is_null`, `is_not_null` — all
  appear in stored view metadata (they are canonical; `ViewFilterRuleSchema`
  validates against exactly this list), and each reached the FilterBuilder as a
  raw spelling its operator dropdown cannot select.

  Same defect and same cause as #2974, one table over: spellings were enumerated
  by hand. That table is now derived from the spec's own canonical list and
  `VIEW_FILTER_OPERATOR_ALIASES`, matched case- and separator-insensitively, so
  `not_in` / `notIn` / `'not in'` / `NOT_IN` are one entry rather than four
  chances to miss one.

  Four canonical operators have no FilterBuilder equivalent —
  `starts_with`/`ends_with` (absent from its vocabulary) and `is_null`/
  `is_not_null` (distinct from the `is_empty`/`is_not_empty` it does have). They
  are recorded as explicit `null`s and asserted, and deliberately left unmapped:
  folding them onto a near-equivalent would silently rewrite the author's
  operator on the next save, whereas an unmapped operator surfaces as a condition
  row the author must complete.

  Also retired `BUILDER_TO_SPEC_OP` and `toSpecFilter` — the write direction,
  dead since the legacy `buildViewConfigSchema` engine was replaced by the
  studio's spec-driven inspector (no caller anywhere in the repo, and not part of
  `@object-ui/plugin-view`'s public exports). It was objectui's last emitter of
  `'not in'` with a space, plus `before`/`after`, as _filter-AST_ operators —
  spellings that reached the server outside `VALID_AST_OPERATORS` and were dropped
  without an error (objectstack-ai/objectstack#3948).

  `@object-ui/components` now exports `FILTER_BUILDER_OPERATORS` (and the
  `FilterBuilderOperator` type), derived from the operators the FilterBuilder
  actually renders, so tables mapping onto that vocabulary can assert against it
  instead of restating it.

  Refs objectstack-ai/objectui#2945, #2901.

- e4c2783: fix(view): the chart view gets a label and an icon in the view switcher — objectui#2916

  `ViewSwitcher`'s two exhaustive `Record<ViewType, …>` maps — `DEFAULT_VIEW_LABELS`
  and `DEFAULT_VIEW_ICONS` — were each missing the `chart` key. `chart` is a member
  of `ViewType` and `plugin-charts` is a registered view, so a chart tab rendered
  with no icon and with its raw type key `chart` as the label, while every sibling
  view showed a glyph and a capitalized name.

  Both maps now carry `chart`, using the same `BarChart3` glyph and `'Chart'` label
  that `plugin-list`'s switcher, `app-shell`'s `ObjectView`/`CreateViewDialog`, and
  the `console.objectView.viewTypeChart` translation already agree on — so the
  switcher no longer disagrees with the rest of the UI. An explicit per-view
  `label`/`icon` still overrides the default, unchanged.

  Why the compiler did not catch it: `@object-ui/plugin-view` had no `type-check`
  script, so `Record<ViewType, …>` — the exhaustiveness guard that exists precisely
  to make a missing member a compile error — was never evaluated by CI. The package
  now type-checks both its sources and its tests, and its `DEBT` entry in
  `scripts/check-type-check-coverage.mjs` is deleted. Compiling the tests for the
  first time also surfaced three unused destructured spy parameters, and the
  package's one remaining reported error (a `dnd-kit` `SyntheticListenerMap`
  mismatch in `ViewTabBar`) is fixed by typing the listener bag as `dnd-kit`'s own
  exported `DraggableSyntheticListeners` rather than a hand-written structural fork.

  Refs objectui#2911, objectui#2915.

- Updated dependencies [62311b6]
- Updated dependencies [fc0272a]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [1cf0de7]
- Updated dependencies [752e18f]
- Updated dependencies [c785740]
- Updated dependencies [b41f401]
- Updated dependencies [5340879]
- Updated dependencies [19e9fa0]
- Updated dependencies [a149e90]
- Updated dependencies [d61efd1]
- Updated dependencies [95b7214]
- Updated dependencies [7d9734d]
- Updated dependencies [6ae818e]
- Updated dependencies [9eb932b]
- Updated dependencies [746dd00]
- Updated dependencies [aebfa4f]
- Updated dependencies [38ca8be]
- Updated dependencies [3cb9646]
- Updated dependencies [68ef584]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [c4d7b20]
- Updated dependencies [c769d3d]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [aeb0bd2]
- Updated dependencies [c735bf7]
- Updated dependencies [02aef0c]
- Updated dependencies [6f29aa5]
- Updated dependencies [d21794c]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [9a04d25]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [07de839]
- Updated dependencies [2a40b5e]
- Updated dependencies [df613fa]
- Updated dependencies [4874117]
- Updated dependencies [ad0183a]
- Updated dependencies [ce08d55]
- Updated dependencies [eb4b740]
- Updated dependencies [5b084eb]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
- Updated dependencies [e339d60]
- Updated dependencies [2d5d594]
- Updated dependencies [ea7f477]
- Updated dependencies [379728f]
- Updated dependencies [7f23cd0]
- Updated dependencies [0ded602]
- Updated dependencies [24e0e0a]
- Updated dependencies [f8a95e5]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [80edbd4]
- Updated dependencies [c0d0bc8]
- Updated dependencies [9867281]
  - @object-ui/core@17.1.0
  - @object-ui/components@17.1.0
  - @object-ui/plugin-grid@17.1.0
  - @object-ui/react@17.1.0
  - @object-ui/types@17.1.0
  - @object-ui/i18n@17.1.0
  - @object-ui/plugin-form@17.1.0

## 17.0.0

### Minor Changes

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

### Patch Changes

- 6dee2cb: feat(form): consume spec-aligned FormView buttons/defaults in ObjectForm

  The authored `@objectstack/spec` FormViewSchema carries structured
  `buttons.{submit,cancel,reset}.{show,label}` and `defaults`, but the form
  renderer only read the flat renderer-invented `showSubmit`/`submitText`/
  `showCancel`/`cancelText`/`showReset`/`initialValues`. That left the two spec
  keys parsed-but-inert (ADR-0078) and stuck at `experimental` in the spec
  liveness ledger.

  `ObjectForm` now folds the structured shape down onto those flat props inside
  its existing normalization pass, so every entry path (ObjectView
  drawer/modal/page, RecordFormPage) honors it. An explicitly-set flat key still
  wins, so metadata authored against the deprecated flat keys is unchanged.
  `ObjectView` and `RecordFormPage` forward `buttons`/`defaults` from the spec
  form view. `ObjectFormSchema` gains the optional `buttons`/`defaults` fields.

  Refs objectstack-ai/objectstack#1894, objectstack-ai/objectstack#2998.

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
- Updated dependencies [c19ac11]
- Updated dependencies [6dee2cb]
- Updated dependencies [e05f052]
- Updated dependencies [0502a7c]
- Updated dependencies [faad45e]
- Updated dependencies [553443e]
- Updated dependencies [09c6a17]
- Updated dependencies [c7cff19]
- Updated dependencies [df6697f]
- Updated dependencies [ba73a02]
- Updated dependencies [ba45145]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [9b4b952]
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
- Updated dependencies [dc7a798]
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [263f885]
- Updated dependencies [dc334da]
  - @object-ui/components@17.0.0
  - @object-ui/i18n@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/plugin-grid@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/core@17.0.0
  - @object-ui/plugin-form@17.0.0

## 16.1.0

### Patch Changes

- 7cf4051: chore(deps): align every `@objectstack/*` dependency to `^16.0.0-rc.0`

  Bumps `@objectstack/spec` / `client` / `formula` / `lint` from `^15.1.1` to the
  `16.0.0-rc.0` pre-release across the workspace (root + `apps/console` +
  `apps/site` + all consuming packages). ObjectUI's own packages are already on
  major 16, so this closes the 15↔16 skew between ObjectUI and the `@objectstack`
  contract libraries (which publish in lockstep with `spec`).

  This is a dependency alignment, not a behavioral migration: the full workspace
  build (43/43) and the `@objectstack`-consuming package test suites
  (`core` / `app-shell` / `data-objectstack` / `plugin-form` / `types`) are green
  against `16.0.0-rc.0` with no source changes required.

  Practical effect: `@objectstack/client@16.0.0-rc.0` now ships
  `data.batchTransaction` (framework #3271), so `ObjectStackAdapter`'s feature
  detect (`typeof client.data.batchTransaction === 'function'`) routes
  master-detail cross-object saves through the typed SDK method instead of the
  raw `fetch('/api/v1/batch')` fallback — realizing the "verify SDK path" half of
  #2694. The raw-fetch branch stays as a defensive fallback (removal tracked in
  #2694).

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

- Updated dependencies [0318118]
- Updated dependencies [1c8935a]
- Updated dependencies [af1b0db]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [803558e]
- Updated dependencies [2e7d7f0]
- Updated dependencies [ef14f69]
- Updated dependencies [94d4876]
- Updated dependencies [1100a8b]
- Updated dependencies [7abe4cd]
- Updated dependencies [69fa5d1]
- Updated dependencies [549c67d]
- Updated dependencies [ebe6494]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [0a3710b]
- Updated dependencies [f80aaf2]
- Updated dependencies [62b9ab5]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [2331ac9]
- Updated dependencies [199fa83]
- Updated dependencies [eee4ded]
- Updated dependencies [3b2e4d9]
  - @object-ui/i18n@16.1.0
  - @object-ui/core@16.1.0
  - @object-ui/types@16.1.0
  - @object-ui/react@16.1.0
  - @object-ui/plugin-form@16.1.0
  - @object-ui/components@16.1.0
  - @object-ui/plugin-grid@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [80977d0]
- Updated dependencies [9d4a429]
- Updated dependencies [b4ef588]
- Updated dependencies [ca0f5f0]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0
  - @object-ui/plugin-grid@16.0.0
  - @object-ui/plugin-form@16.0.0
  - @object-ui/i18n@16.0.0
  - @object-ui/core@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/i18n@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0
- @object-ui/plugin-form@15.0.0
- @object-ui/plugin-grid@15.0.0

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

### Patch Changes

- Updated dependencies [82441e4]
- Updated dependencies [2efa9fd]
- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [579b24d]
- Updated dependencies [23d65c3]
- Updated dependencies [06d5ec6]
- Updated dependencies [055e1d2]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [f30ff68]
- Updated dependencies [073e7aa]
- Updated dependencies [6c0135c]
- Updated dependencies [5b52624]
- Updated dependencies [4afb251]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f94905d]
- Updated dependencies [f0f10f5]
  - @object-ui/i18n@14.1.0
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/plugin-form@14.1.0
  - @object-ui/plugin-grid@14.1.0
  - @object-ui/components@14.1.0

## 14.0.0

### Patch Changes

- 05e56ca: 导出/导入模板的下载文件名与内容本地化。

  **导出文件名**:CSV/Excel/JSON 导出下载不再是 `<对象名>.<扩展名>`(如 `contracts.csv`),改为「对象显示名-视图名-时间戳.扩展名」(如 `任务-In Progress-20260714-153045.xlsx`);`exportOptions.fileNamePrefix` 配置仍优先(且作为完整前缀,不再追加视图名)。视图名与对象名重复时自动省略;`@object-ui/core` 新增 `buildExportFileName(ext, { prefix, label, objectName, viewLabel }, now?)` 与 `sanitizeFileNameBase(raw)`,ObjectGrid 与 ListView 的所有导出路径(服务端流式与前端兜底)统一走它。app-shell/plugin-view 的 ObjectView 现将当前视图的显示标签写进传给 ListView 的 schema(`label`),使导出文件名能区分同一对象的不同保存视图。

  **导入模板**:「下载模板」修复两处英文漏出——示例行的 select/多选取值改为优先取选项**显示标签**(如 `准备中`)而非 ASCII slug(`prepare`,服务端导入两者都接受);模板文件名本地化为 `{{object}}-导入模板.csv`(新增 i18n key `grid.import.templateFileName`,英文回退 `{{object}}-import-template.csv`)。

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
  - @object-ui/plugin-grid@14.0.0
  - @object-ui/components@14.0.0
  - @object-ui/plugin-form@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [80901aa]
- Updated dependencies [53c40c2]
- Updated dependencies [e492b9d]
- Updated dependencies [5da9905]
  - @object-ui/components@13.2.0
  - @object-ui/plugin-grid@13.2.0
  - @object-ui/i18n@13.2.0
  - @object-ui/plugin-form@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/i18n@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0
- @object-ui/plugin-form@13.1.0
- @object-ui/plugin-grid@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [9e38270]
- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/i18n@13.0.0
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/plugin-form@13.0.0
  - @object-ui/plugin-grid@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [6cbccf3]
- Updated dependencies [e1840bf]
- Updated dependencies [c31874d]
- Updated dependencies [195121a]
  - @object-ui/components@12.1.0
  - @object-ui/i18n@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/plugin-form@12.1.0
  - @object-ui/plugin-grid@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0

## 12.0.0

### Patch Changes

- 77a0953: Consolidate the record-surface mirror onto `@objectstack/spec/data` (objectui#2269 debt paydown).

  `plugin-view/src/recordSurface.ts` re-exports `deriveRecordSurface` / `deriveRecordFlowSurface` / `countAuthorableFields` / `RECORD_SURFACE_PAGE_THRESHOLD` + types from `@objectstack/spec/data` instead of carrying a hand-kept copy — the local mirror only existed because objectui pinned a spec (`^11.7`) predating those exports, and the pin is now `^12.2`. The objectui-local overlay-size helpers (`deriveOverlaySize` / `overlayWidthFor` / `OverlaySize`, a renderer width concern the protocol doesn't own) stay local but reuse spec's `countAuthorableFields`. `RecordSurface` widens to spec's `'page' | 'modal' | 'drawer'` (the heuristic still only emits page/drawer); `resolvePostCreateTarget`'s `surface` param accepts the wider type and treats `'modal'` like a drawer. Behavior is unchanged (mirror unit tests pass verbatim against the re-exported functions); console production build resolves the subpath import.

- 68e2d1c: Studio UX audit fixes (objectui#2285) — browser walkthrough of the Studio design surface surfaced one rendering bug and several dead-space/discoverability issues; all fixed and re-verified end to end:

  - **Bug — mobile card view showed `[object Object]` for lookup fields.** `ObjectGrid`'s narrow-viewport card layout dumped raw field values through `String(value)` instead of reusing the type-aware cell renderer the desktop table already used; a lookup's expanded object (`{ id, name }`) rendered as the literal string. Now routed through the shared `coerceToSafeValue` helper (newly exported from `@object-ui/fields`, alongside `pickRecordDisplayName`) and a hoisted `renderRecordDetail`, matching the desktop path.
  - **Studio has no responsive/mobile layout.** Below the mobile breakpoint, each pillar's rail (Objects / Flows / Nav tree / Permission sets) now collapses into a toggleable overlay drawer instead of permanently squeezing the canvas into ~190px, and the top pillar-tab bar scrolls horizontally instead of clipping Automations/Interfaces/Access off-screen.
  - **Records tab / Automations canvas had a dead space band.** `ObjectView`'s built-in "+ New" toolbar row (a separate, mostly-empty flex row above the grid) is now folded into the grid's own toolbar via a new optional `onAddRecord` passthrough on `renderListView`; the Automations canvas container now sizes to the pillar's full height instead of its own intrinsic content height.
  - **Automations "fit view" never actually zoomed in.** `fitToView`'s zoom calculation was hard-capped at 100%, so small (2-4 node) flows stayed stranded in a corner of a mostly-blank canvas even after fitting. Removed the artificial cap (now bounded only by the existing `MAX_ZOOM`) and auto-fit once on mount so opening a flow starts appropriately zoomed instead of a fixed 100%/pan-0,0 default.
  - **Validations tab didn't default-select the first rule**, unlike the Access pillar's Permission Set list — now consistent.
  - **HTML/React "source" pages left the Properties panel permanently empty** (no selectable block exists for raw JSX/HTML pages). It now shows a contextual message pointing at the source editor instead of the generic "click a block" empty state.
  - **Permission matrix column headers (C/R/U/D/Tr/Re/Pu/VA/MA) had no visible legend** — added one above the matrix (the header cells' native tooltips stay as-is).
  - **App Builder landing page** widened and given the same icon-badge treatment as Home's app cards, with a 3-column grid on wide screens instead of a narrow fixed-width column stranded in the corner of the viewport.

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
- Updated dependencies [68e2d1c]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/plugin-form@12.0.0
  - @object-ui/plugin-grid@12.0.0
  - @object-ui/react@12.0.0
  - @object-ui/i18n@12.0.0

## 11.5.0

### Minor Changes

- 6c1ad9e: Record task flows open as derived overlays with lossless return (framework#2604, extends framework#2578).

  - **Create/Edit never route** — the global record form is URL-driven (`?form=new` / `?form=<id>`): browser Back closes the overlay with the origin (list scroll/filters, detail state) intact; field-heavy objects derive a full-screen modal (`modalSize:'full'`) via the new `deriveRecordFlowSurface` mirror in plugin-view, light ones keep the auto-sized modal. `editMode:'page'` opt-in unchanged.
  - **Save invariant** — _edit never moves you_ (origin refetches in place); _create lands on the new record's detail_ on its derived surface (drawer over the still-intact list for light objects, detail route for heavy), with `replace:true` so Back skips the transient form entry.
  - **Subtable child create/edit = overlay over the parent detail, never a route** — related-list New/Edit push `?form=…&formObject=<child>&formLink=<fk>:<parentId>`; the one global overlay pre-links the parent (refresh-safe), sizes to the CHILD object, and on save stays on the parent while only the child's related lists refetch. ModalForm now forwards `initialValues` into its master-detail (subforms) branch so pre-links survive for children with inline line items.

### Patch Changes

- 70c4a3f: Studio package-create dogfood follow-ups (framework#2615 — P2 wizard + P3 polish):

  - **Package-id wizard feedback.** The three package wizards (switcher create,
    landing create, landing duplicate) share a new `PackageIdInput`: illegal
    characters are still normalized away, but no longer silently — a notice
    says what was removed — a reverse-domain format hint shows while the id
    doesn't parse, and a CJK-only name that yields no id suggestion is told to
    type one manually instead of leaving the id box mysteriously empty.
  - **Records-grid duplicate "Actions" column.** A field literally named
    `actions` is now dropped from the Studio grid's data columns, so it no
    longer collides with the always-pinned row-actions column (it stays
    editable in the form designer).
  - **Record-create verb consistency.** The `ObjectView` toolbar create button
    resolved a hardcoded English "Create"; it now uses the same
    `console.objectView.new` ("New" / 新建) key as the runtime object pages so
    Studio and the running app agree.
  - **Branded cold-load splash.** The console's pre-auth loading gate rendered a
    bare "Loading…"; it now shows the branded, boot-safe `LoadingScreen`.
  - **Picklist option editor.** Value/label inputs and CJK option labels no
    longer truncate — the six controls that shared one cramped row are split
    into a two-row layout so the inputs get the full panel width.
  - **Draft-save confirmation.** The Data pillar's "Save draft" now shows a
    success toast and a "last saved HH:MM" indicator, matching the App and
    Automations pillars.

- Updated dependencies [544d8eb]
- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
- Updated dependencies [ec9c8ee]
- Updated dependencies [6c1ad9e]
  - @object-ui/i18n@11.5.0
  - @object-ui/react@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/plugin-form@11.5.0
  - @object-ui/plugin-grid@11.5.0
  - @object-ui/core@11.5.0

## 11.4.0

### Minor Changes

- 8bf6295: feat: adaptive record surface + semantic field span + responsive columns (framework#2578)

  Field-heavy objects (all metadata is AI-authored) now present themselves without
  any authored presentation config:

  - **Adaptive surface** — a record's create/edit/detail opens as a full page when
    the object is field-heavy, or a drawer when it is light. Derived from field
    count (`deriveRecordSurface`), not authored; mobile always pages. Wired into the
    app-shell ObjectView detail navigation (an authored view/object `navigation`
    still wins).
  - **Semantic field span** — `FormField.span` (`auto`/`full`) is a width primitive
    decoupled from the (per-surface derived) column count; legacy `colSpan` is
    clamped so it never overflows. `ObjectForm` now honours per-section `columns`
    and carries `span`/`colSpan` from section defs — fixes the bug where
    `type:'simple'` ignored `section.columns` and grouped fields rendered single
    column.
  - **Responsive columns** — `inferColumns` scales the column CAP with field count
    (≤3→1, ≤8→2, ≤15→3, 16+→4); the ACTUAL column count follows the form's real
    width via CSS container queries, so the same form goes 1→2→3→4 columns as a
    drawer widens or becomes a page.
  - **Runtime overlay width** — `NavigationConfig.size` bucket is resolved to a
    viewport-clamped width at runtime (`overlayWidthFor`); a pixel width is never
    authored (the author cannot know the client viewport).

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [144ab55]
- Updated dependencies [1948c5b]
- Updated dependencies [3e42680]
- Updated dependencies [bce581a]
- Updated dependencies [2edcaff]
- Updated dependencies [9cd9be1]
- Updated dependencies [c38d107]
- Updated dependencies [7782698]
- Updated dependencies [1e9145d]
- Updated dependencies [e84d64d]
  - @object-ui/plugin-form@11.4.0
  - @object-ui/types@11.4.0
  - @object-ui/plugin-grid@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [c55a52a]
- Updated dependencies [2e3e058]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/plugin-grid@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/plugin-form@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/plugin-form@11.2.0
  - @object-ui/plugin-grid@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0

## 11.1.0

### Patch Changes

- @object-ui/components@11.1.0
- @object-ui/plugin-form@11.1.0
- @object-ui/plugin-grid@11.1.0
- @object-ui/react@11.1.0
- @object-ui/types@11.1.0
- @object-ui/core@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/plugin-form@7.3.0
- @object-ui/plugin-grid@7.3.0
- @object-ui/types@7.3.0
- @object-ui/core@7.3.0
- @object-ui/react@7.3.0
- @object-ui/components@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [0caea33]
- Updated dependencies [4aa8b84]
- Updated dependencies [d23db5c]
  - @object-ui/plugin-grid@7.2.0
  - @object-ui/plugin-form@7.2.0
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/react@7.2.0
  - @object-ui/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [aae8791]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0
  - @object-ui/react@7.1.0
  - @object-ui/plugin-form@7.1.0
  - @object-ui/components@7.1.0
  - @object-ui/plugin-grid@7.1.0

## 7.0.0

### Minor Changes

- 4eb9cb6: feat(plugin-tree): add a `tree` / tree-grid object view type

  Renders a self-referencing object as an indented, expand/collapse tree-grid —
  the right view for arbitrary-depth hierarchies (business unit / org chart,
  category trees, BOMs, nested comments) that fixed-depth grouping can't express.
  New `@object-ui/plugin-tree` package (`object-tree`/`tree`), `tree` added to the
  `ViewType` union, and dispatch wired through plugin-list `ListView` +
  app-shell `ObjectView` (the console path).

- 7b71cd8: Unify the runtime ObjectView "view editor" onto the studio's spec-driven inspector. The right-rail view editor now hosts the same `ViewVariantInspector` the metadata studio uses (config fields sourced straight from `@objectstack/spec`) instead of the legacy `buildViewConfigSchema` engine, so runtime and studio share one view-editing surface. A new `view-config-adapter` bridges the runtime's flat view shape and the studio's ViewItem draft, keeping the `sys_view` persistence path untouched; field pickers read from the in-memory object definition (no extra network fetch). The legacy `buildViewConfigSchema` engine and its exports are retired; `ConfigPanelRenderer` is retained for the dashboard/report config panels.

### Patch Changes

- 9bef806: feat(view): pass form-view `subforms` through to ObjectForm

  `ObjectView`'s form schema now forwards `form.subforms` to `ObjectForm`, so a
  form view that declares inline child collections renders as a master-detail
  form (parent fields + child grids, atomic save) in ObjectView's own
  create/edit form — no bespoke page. Pairs with `@objectstack/spec`
  `FormViewSchema.subforms` and ObjectForm's existing `subforms` rendering.

- Updated dependencies [5976ba3]
- Updated dependencies [a00e16d]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [053c948]
- Updated dependencies [053c948]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [6c0c92c]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [f6044fa]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [5332639]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [80c133c]
- Updated dependencies [d16566f]
- Updated dependencies [69510df]
- Updated dependencies [b148daf]
- Updated dependencies [90acb7f]
- Updated dependencies [7913390]
- Updated dependencies [514f426]
- Updated dependencies [586a027]
- Updated dependencies [00f8d2d]
- Updated dependencies [9aac2b8]
- Updated dependencies [1394e34]
- Updated dependencies [e95cc25]
- Updated dependencies [abe8ebc]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [650bd1f]
- Updated dependencies [18728c1]
- Updated dependencies [8426db7]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/plugin-grid@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/types@7.0.0
  - @object-ui/plugin-form@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3
- @object-ui/plugin-form@6.2.3
- @object-ui/plugin-grid@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/plugin-form@6.2.2
  - @object-ui/plugin-grid@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1
- @object-ui/plugin-form@6.2.1
- @object-ui/plugin-grid@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/plugin-form@6.2.0
- @object-ui/plugin-grid@6.2.0
- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/plugin-form@6.1.0
  - @object-ui/plugin-grid@6.1.0
  - @object-ui/react@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4
- @object-ui/plugin-form@6.0.4
- @object-ui/plugin-grid@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3
- @object-ui/plugin-form@6.0.3
- @object-ui/plugin-grid@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2
- @object-ui/plugin-form@6.0.2
- @object-ui/plugin-grid@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1
- @object-ui/plugin-form@6.0.1
- @object-ui/plugin-grid@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0
- @object-ui/plugin-form@6.0.0
- @object-ui/plugin-grid@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2
- @object-ui/plugin-form@5.4.2
- @object-ui/plugin-grid@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1
- @object-ui/plugin-form@5.4.1
- @object-ui/plugin-grid@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/plugin-form@5.4.0
  - @object-ui/plugin-grid@5.4.0
  - @object-ui/react@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2
- @object-ui/plugin-form@5.3.2
- @object-ui/plugin-grid@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1
- @object-ui/plugin-form@5.3.1
- @object-ui/plugin-grid@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0
- @object-ui/plugin-form@5.3.0
- @object-ui/plugin-grid@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1
- @object-ui/plugin-form@5.2.1
- @object-ui/plugin-grid@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [e3160a5]
- Updated dependencies [9997cae]
- Updated dependencies [b2d1704]
- Updated dependencies [5633edd]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [e919433]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [d1442e3]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/plugin-grid@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/components@5.2.0
  - @object-ui/plugin-form@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/plugin-form@5.1.1
  - @object-ui/plugin-grid@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/react@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [c0b236f]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0
  - @object-ui/plugin-form@5.1.0
  - @object-ui/plugin-grid@5.1.0

## 5.0.2

### Patch Changes

- Updated dependencies [cab6a93]
- Updated dependencies [a311e22]
  - @object-ui/plugin-grid@5.0.2
  - @object-ui/plugin-form@5.0.2
  - @object-ui/components@5.0.2
  - @object-ui/react@5.0.2
  - @object-ui/types@5.0.2
  - @object-ui/core@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1
- @object-ui/plugin-form@5.0.1
- @object-ui/plugin-grid@5.0.1

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
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/plugin-form@5.0.0
  - @object-ui/plugin-grid@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0
- @object-ui/plugin-form@4.8.0
- @object-ui/plugin-grid@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0
- @object-ui/plugin-form@4.7.0
- @object-ui/plugin-grid@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [9aacced]
- Updated dependencies [9661d86]
- Updated dependencies [3ee436d]
  - @object-ui/plugin-grid@4.6.0
  - @object-ui/components@4.6.0
  - @object-ui/plugin-form@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/react@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [6b6afd1]
- Updated dependencies [ab5e281]
- Updated dependencies [6b6afd1]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/plugin-form@4.5.0
  - @object-ui/types@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/plugin-grid@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [2bd45af]
  - @object-ui/components@4.4.0
  - @object-ui/plugin-form@4.4.0
  - @object-ui/plugin-grid@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/react@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [6b683c8]
  - @object-ui/components@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/plugin-form@4.3.1
  - @object-ui/plugin-grid@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/components@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/plugin-form@4.3.0
  - @object-ui/plugin-grid@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1
- @object-ui/plugin-form@4.2.1
- @object-ui/plugin-grid@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/components@4.2.0
- @object-ui/react@4.2.0
- @object-ui/plugin-form@4.2.0
- @object-ui/plugin-grid@4.2.0
- @object-ui/types@4.2.0
- @object-ui/core@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0
- @object-ui/plugin-form@4.1.0
- @object-ui/plugin-grid@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12
- @object-ui/plugin-form@4.0.12
- @object-ui/plugin-grid@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/components@4.0.11
- @object-ui/react@4.0.11
- @object-ui/plugin-form@4.0.11
- @object-ui/plugin-grid@4.0.11
- @object-ui/types@4.0.11
- @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10
- @object-ui/plugin-form@4.0.10
- @object-ui/plugin-grid@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9
- @object-ui/plugin-form@4.0.9
- @object-ui/plugin-grid@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/components@4.0.8
- @object-ui/react@4.0.8
- @object-ui/plugin-form@4.0.8
- @object-ui/plugin-grid@4.0.8
- @object-ui/types@4.0.8
- @object-ui/core@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
- Updated dependencies [fd15918]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/plugin-grid@4.0.7
  - @object-ui/plugin-form@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- Updated dependencies [89ae109]
- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/plugin-grid@4.0.6
  - @object-ui/plugin-form@4.0.6
  - @object-ui/components@4.0.6
  - @object-ui/types@4.0.6
  - @object-ui/core@4.0.6
  - @object-ui/react@4.0.6

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

- Updated dependencies [1dc6061]
  - @object-ui/components@4.0.5
  - @object-ui/plugin-form@4.0.5
  - @object-ui/plugin-grid@4.0.5
  - @object-ui/types@4.0.5
  - @object-ui/core@4.0.5
  - @object-ui/react@4.0.5

## 4.0.4

### Patch Changes

- d2b6ece: fix: externalize all bare imports in library builds

  Library builds (vite lib mode) now externalize every non-relative import instead of bundling third-party CJS dependencies into the published dist. This avoids inlined `require("react")` / `require("react-dom")` calls that cause `Calling \`require\` for "react" in an environment that doesn't expose the \`require\` function` runtime errors when consumer apps re-bundle the published dist.

  Specifically fixes:

  - `@object-ui/plugin-dashboard` no longer inlines `react-grid-layout` (and its transitive `react-draggable` / `react-resizable` CJS bundles). `react-grid-layout` is now declared as a peer dependency so consumers install a single ESM-friendly copy.
  - `@object-ui/components`, `@object-ui/plugin-calendar`, `@object-ui/plugin-charts`, `@object-ui/plugin-designer` no longer inline `react-i18next` / `i18next` / `use-sync-external-store` CJS shims.
  - All plugin packages now use a unified `external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname)` rule, ensuring future additions of CJS deps are automatically externalized.

- Updated dependencies [d2b6ece]
  - @object-ui/components@4.0.4
  - @object-ui/plugin-form@4.0.4
  - @object-ui/plugin-grid@4.0.4
  - @object-ui/types@4.0.4
  - @object-ui/core@4.0.4
  - @object-ui/react@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/core@4.0.3
  - @object-ui/react@4.0.3
  - @object-ui/components@4.0.3
  - @object-ui/plugin-form@4.0.3
  - @object-ui/plugin-grid@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1
- @object-ui/plugin-form@4.0.1
- @object-ui/plugin-grid@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/plugin-form@4.0.0
  - @object-ui/plugin-grid@4.0.0
  - @object-ui/react@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/plugin-grid@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/plugin-form@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/react@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2
- @object-ui/plugin-form@3.3.2
- @object-ui/plugin-grid@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/plugin-form@3.3.1
  - @object-ui/plugin-grid@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/react@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0
- @object-ui/plugin-form@3.3.0
- @object-ui/plugin-grid@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0
- @object-ui/plugin-form@3.2.0
- @object-ui/plugin-grid@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/react@3.1.5
- @object-ui/components@3.1.5
- @object-ui/plugin-form@3.1.5
- @object-ui/plugin-grid@3.1.5
- @object-ui/types@3.1.5
- @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4
- @object-ui/plugin-form@3.1.4
- @object-ui/plugin-grid@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3
- @object-ui/plugin-form@3.1.3
- @object-ui/plugin-grid@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2
- @object-ui/plugin-form@3.1.2
- @object-ui/plugin-grid@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/plugin-form@3.1.1
  - @object-ui/plugin-grid@3.1.1
  - @object-ui/react@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3
- @object-ui/plugin-form@3.0.3
- @object-ui/plugin-grid@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2
- @object-ui/plugin-form@3.0.2
- @object-ui/plugin-grid@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
  - @object-ui/plugin-form@3.0.1
  - @object-ui/plugin-grid@3.0.1
  - @object-ui/types@3.0.1
  - @object-ui/core@3.0.1

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
  - @object-ui/plugin-form@3.0.0
  - @object-ui/plugin-grid@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/react@2.0.0
  - @object-ui/components@2.0.0
  - @object-ui/plugin-form@2.0.0
  - @object-ui/plugin-grid@2.0.0

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/types@0.3.1
  - @object-ui/core@0.3.1
  - @object-ui/react@0.3.1
  - @object-ui/components@0.3.1
  - @object-ui/plugin-grid@0.3.1
  - @object-ui/plugin-form@0.3.1
