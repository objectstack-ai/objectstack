# @object-ui/plugin-calendar

## 18.1.0

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [5235d6d]
- Updated dependencies [7c405b7]
- Updated dependencies [0093b2c]
- Updated dependencies [f669732]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [b911ebb]
- Updated dependencies [0d12e95]
- Updated dependencies [ff77cfc]
- Updated dependencies [49a536d]
- Updated dependencies [241cb78]
- Updated dependencies [404ccae]
- Updated dependencies [ec627ab]
- Updated dependencies [b93c9f6]
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
  - @object-ui/components@18.1.0
  - @object-ui/i18n@18.1.0
  - @object-ui/plugin-detail@18.1.0
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

- 9ca3cac: The calendar and the timeline start the week on the first day of the week of the user's locale (objectui#11675), instead of a fixed Sunday (calendar) and a fixed Monday (timeline). Under `en-US` both start on Sunday; under `en-GB` or `zh-CN` both start on Monday; under `ar-EG` both start on Saturday. There is no separate week-start setting: the first day comes from the locale the dates are already formatted with.
  
  - **`@object-ui/i18n` exports `firstDayOfWeek(locale)` and its `WeekdayIndex` type.** It returns the first day of the week for a BCP-47 tag, numbered as `Date.prototype.getDay` numbers weekdays (0 is Sunday), which is also what react-day-picker's `weekStartsOn` takes. It reads the engine's `Intl.Locale` week info (`getWeekInfo()`, else the `weekInfo` accessor), including a `-u-fw-` keyword on the tag. Where the engine has neither, it reads CLDR's first-day table by the tag's region, or the region CLDR's likely subtags give it (`en` reads `US`, `zh` reads `CN`), and a region the table does not list reads Monday, CLDR's world default. A malformed tag throws the same `RangeError` that formatting a date with it would.
  - **The calendar's weeks start on the locale's first day.** `CalendarView` (and `object-calendar` through it) reads the first day from its `locale` prop, else the display locale, and the month grid's rows, its weekday heads, the week view's columns, the header's week range, the day a span that wraps into a new row shows its title on, and the header's date popover all start there. The popover used to take date-fns's own week start for the tag, which is not CLDR's for every tag (date-fns reads `es-MX` as `es`, a Monday start, where CLDR starts Mexico's week on Sunday) and which read Sunday until the date-fns locale had loaded.
  - **The object timeline's "This week" and "Next week" start on the display locale's first day.** The bucket bounds are also stepped on the local calendar now, so across a DST change the day after it is "Tomorrow" again, and the first day of next week no longer falls into "This week".
  
  A host that relied on the calendar always starting on Sunday, or on the timeline's week always starting on Monday, now sees the locale's first day. The gantt variant's `week` axis is unchanged: it still counts plan weeks from the axis's first day.
- 16c8810: A calendar view in a list draws every record of the days it shows, not the first 100 records of the object (objectui#12081 item 2).
  
  A list view's calendar used to draw the rows of the list's one unpaged fetch: the first 100 records of the object, with no date condition. A month holding more than 100 matching records was drawn from whichever 100 came first, and the rest never appeared. The only sign was the list's "Showing first 100 records" note. Measured on a contracts calendar with 122 records: up to 22 were never drawn.
  
  - **The list fetches the calendar's visible days.** The query selects the days on the calendar's start field, or, with an end field bound, every span that touches those days. It also selects the records with no start date, which the calendar counts as unscheduled. The view's own filter, the filter panel, the user filters and the search still narrow it.
  - **It walks the window in steps of the fetch batch.** Every request asks for at most 100 records, the same batch as before. The list keeps asking until the window is exhausted, so every record of the month is drawn. It stops at the platform's non-grid ceiling of 2,000 records. It then draws the first 2,000 and shows a note under the calendar naming both numbers, the note the standalone calendar already shows. The "Showing first 100 records" note no longer appears on a calendar.
  - **A declared page size no longer sizes a calendar's fetch.** On a calendar with a start date bound, every step is the fetch batch, whatever `pagination.pageSize` the view declares. A declared size still sizes the window of every other view, and of a calendar with no start date bound.
  - **The rows-per-page picker is no longer offered on such a calendar.** A page size changes nothing it draws. The other views that offer it keep it.
  - **Moving to another month fetches that month.** A move inside the window already fetched, such as switching to a week of the same month, fetches nothing. The calendar keeps drawing while the next window loads, and keeps the month it moved to.
  - **Unchanged:** the grid's paging and its requests, every other view's one fetch batch, and a calendar with no start date bound. A calendar rendered on its own, outside a list, still fetches as before.
  
  **Clause-②: yes (widening)** — `ObjectCalendarComponentProps` gains one optional member, `onVisibleRangeChange?: (range: { start: Date; end: Date }) => void`. `ObjectCalendar` calls it on mount and whenever navigation or a view change moves the days it draws. `start` is local midnight of the first day drawn and `end` local midnight of the day after the last. The `object-calendar` renderer forwards it from a host, like the other callbacks, only when the value is a function. Nothing else on either package entry changes: no export is added or removed, no existing member changes type, and no locale key is added.
- ee47071: Calendar quick-create no longer offers a dialog that cannot succeed. On an object with a required field it cannot fill, an empty-day click opens the full create form with the clicked day already set (objectui#12291).
  
  The quick-create dialog asks for a title only. Its write fills the date fields and, for the other required fields, a declared default, a select's first option, `false` for a boolean or `0` for a number. A required field outside that set, such as the required `project` lookup on the stock `showcase_task`, was left empty, and the create was refused with 400 "Project is required" while the dialog offered no Project input.
  
  - **`@object-ui/plugin-calendar`.** Before the dialog is offered, the calendar checks the object's required fields against what its write can fill. The check and the write read one statement of that set. A required field the server fills on insert (declared `readonly` or `system`, or an `autonumber`) does not count. Where every required field can be filled, the dialog is unchanged. Where one cannot, the empty-day click, or a range drag in the week and day grids, calls the declared `onEdit` prop with a new record (no `id`) that carries the date values the dialog would have written. The host then opens its full create form with them. `ListView` already passes its `onEdit` down to the calendar, and in the console that is the handler that opens the record form. With no `onEdit`, the gesture offers nothing on such an object. A caller-supplied `onDateClick` still takes precedence, and the `calendarQuickCreate` permission row still gates both paths. The dialog gets no lookup picker, and no lookup value is guessed.
  - **`@object-ui/app-shell`.** The console's record-form handler already treated a record with no id as a new one. It now opens the create form pre-filled with the values such a record carries. The record-form overlay gets them as its initial values, carried in the state of the history entry that opens it, so Back and a refresh keep them. A page-mode object (`editMode: 'page'`) gets them as the query-string prefill its create page already reads. `onEdit(null)` (the list's New) and a record with an id behave as before.
  
  No export, prop or type member is added, and no language-pack key or URL parameter. `ObjectCalendarComponentProps.onEdit` was already declared and forwarded; the calendar did not call it until now.
- f62b6ff: Resolve `@objectstack/*` `18.0.0-next.2` (objectui#12626).
  
  The console and the runner bundle `18.0.0-next.2`. `@object-ui/types` and `@object-ui/app-shell` now declare `@objectstack/spec` `^18.0.0-next.2`; the other packages keep `^18.0.0-next.1`, which already admits it.
  
  **The record dialog opens bounded on desktop for every object.** A create, edit or child record dialog on an object with many fields used to open as a 95vw task canvas. `@objectstack/spec` `18.0.0-next.2` derives a bounded modal for it on desktop and keeps the full-screen sheet on a phone, and the console now takes that answer directly.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates a page through the spec's own page checks, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.2` refuses. Each was accepted before:
  
  - On a `kind: 'full'` page, a region whose `name` the page's `template` does not place (with the default template: anything but `header`, `sidebar`, `main`, `aside` and `footer`), and a second region for a slot another region already fills. The renderer stacked such a region under `main` at full width. Rename it to a slot the template places, or choose the `dashboard` template, which lays every other region out as a grid cell.
  - `isDefault: true` on a page whose `type` is its page kind (`record`, `home` or `utility`) unless it is a `record` page bound to an `object`. Delete the key; an app's landing page is its first navigation item.
- 26323c4: Resolve `@objectstack/*` `18.0.0-next.3` (objectui#12873).
  
  The console and the runner bundle `18.0.0-next.3`. Every package keeps its `@objectstack/*` range (`^18.0.0-next.1`, or `^18.0.0-next.2` for `@object-ui/types` and `@object-ui/components`), which already admits it, except `@object-ui/app-shell` (objectui#12943) and `@object-ui/plugin-detail` (objectui#12946), which declare `^18.0.0-next.3`.
  
  **An accept set that narrows with it.** `@object-ui/types` validates a `page:header` node's `properties` through the spec's own `page:header` row, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse `showStar`, which `18.0.0-next.3` retires: the follow star it switched on is not drawn by any renderer. It was accepted before. Delete the key.
  
  **A type that widens with it.** `SelectOptionBase`, and the field and form option types built on it, take the spec's select option by reference, so they now carry its optional `kind` (`'open' | 'won' | 'lost'`), the lifecycle category `18.0.0-next.3` adds. The spec takes it on a single-value `select` or `radio` field's options and requires it on every option of the field an object's `stageField` names.

### Patch Changes

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
- 524136e: The view-level `provider: 'api'` data source is no longer read anywhere in objectui (objectui#12325). `@objectstack/spec` retires it (objectstack#23082, ADR-0049): a view binds its object (`provider: 'object'`) or static rows (`provider: 'value'`), and a metadata-declared API call is the page element's `dataSource` binding.
  
  Breaking, declared as `minor` per the version-alignment rule:
  
  - **`resolveDataSource`** (`@object-ui/core`) has no `api` arm. A block that still says `provider: 'api'` is an unknown provider and gets an unknown provider's answer (the fallback DataSource, else `null`); no `ApiDataSource` is built from its `read` / `write`. `ResolveDataSourceOptions` loses `fetch` and `defaultHeaders`, which only that arm read.
  - **`ViewDataProvider`** (`@object-ui/core`) has no `api` arm: such a config resolves with `Unknown data provider: api`. `ViewDataConfig` and `ResolvedData.provider` drop `'api'`, and `DataFetcher.fetchUrl`, which only that arm called, is removed.
  - **`useViewData`** (`@object-ui/react`) no longer keys on or threads anything for an `api` block.
  - **`ObjectGantt`** reads no `api` block: its `read` URL is never requested, and the chart answers it like any unknown provider. `ObjectCalendar` and `ObjectMap` drop their `api` branches, which only warned "not yet implemented".
  - **`ListView`** no longer stands down for a gantt view with an `api` block: it fetches the bound object like any other list.
  
  Unchanged: `ApiDataSource` stays a class for code that constructs it from an `ApiDataSourceConfig`, so the console's approvals inbox reads exactly as before.
- d75f212: Published text no longer teaches the retired view-level `provider: 'api'` data source (objectui#12364). A view binds `provider: 'object'` or `provider: 'value'`; a metadata-declared API call is the page element's `dataSource` binding. Text only: no schema accepts or refuses anything new, and no renderer behaves differently.
  
  - **`@object-ui/types`:** the `object-tree` `data` description drops the `api` provider from the providers it names.
  - **`@object-ui/plugin-grid` / `@object-ui/plugin-map`:** the `data` input descriptions drop the `api` provider.
  - **`@object-ui/plugin-calendar` / `@object-ui/plugin-gantt` / `@object-ui/plugin-map`:** the error thrown when no `DataSource` is available now reads `DataSource required for the object provider` (was `DataSource required for object/api providers`). It fires in exactly the same conditions as before.
  - **`@object-ui/react` / `@object-ui/auth`:** the README and docblocks describe `SchemaRendererProvider`'s `apiFetch` as what it is now: the host's authenticated fetch the renderers use for their own reads of the host's API (chart metadata, dataset dimension labels, record-permission probes). It is not a channel for a view's data source.
  - **`@object-ui/app-shell`:** comment wording only in `ConsoleShell`, `useConsoleActionRuntime` and `ObjectView` (these comments ship in the built JS): no behaviour change.
  - **`@object-ui/core`:** docblock wording only on `normalizeListViewSchema` and `resolveRecordSourceObjectName` (these ship in `dist/*.d.ts` and the built JS): no behaviour change.
- 1e6d83b: Data-bound blocks title their "data source could not be resolved" panel in the page's language (objectui#12920, the family of objectui#12910). The panel shows when a block's `dataSource.view` names a view its object does not have. Each block's title now reads `@object-ui/i18n` through `useObjectTranslation`, with the `en` pack's value as the inline default, so a page with no `I18nProvider` draws the same English it drew before.
  
  - **Plugin blocks.** `object-calendar`, `object-chart`, `object-metric`, `object-pivot`, `detail-view`, `record:related_list`, `object-form`, `embeddable-form`, `object-master-detail-form`, `record:line_items`, `object-gantt`, `object-grid`, `object-kanban`, `list-view`, `object-map` and `object-timeline` read one `element.KIND.sourceUnresolved` key per block kind. `object-metric` reads `element.number.sourceUnresolved`, the key `element:number` already reads for the same sentence. The three forms share `element.form.sourceUnresolved`. `record:related_list`'s panel for a failed `parentDataSource` read reads `element.relatedList.parentUnreadable` ("This related list’s parent record could not be read").
  - **`@object-ui/react` panel defaults.** `ElementDataSourceErrorPanel` with no `title` reads `element.component.sourceUnresolved`, and `NoDataSourcePanel` with no `title` reads `element.component.noDataSource`. A passed `title` still wins, an empty string included. Props and markup do not change.
  
  Clause-②: yes
  
  The new keys in `@object-ui/i18n` widen its exported `TranslationKeys`. No prop, input or export of these packages changes.
- 3cec090: The calendar header's date title no longer clips at phone widths (objectui#13149). At 390px the day view's title was cut by the container edge ("Tuesday, October 20, 2") with no ellipsis. The title and its button can now shrink and truncate with an ellipsis, the button's tooltip holds the full date, and below the `sm` breakpoint the header shows a short form of the same locale-aware format ("Tue, Oct 20" in the day view, "Oct 18 - Oct 24" in the week view, "Oct 2026" in the month view). From `sm` up the full title is unchanged.
  
  Nothing is added to the package entry: no export, prop, type member or language-pack key.
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
- Updated dependencies [b61c116]
- Updated dependencies [e8c0b96]
- Updated dependencies [b92329c]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [4c127cd]
- Updated dependencies [9dfaca6]
- Updated dependencies [76993f8]
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
- Updated dependencies [7300fca]
- Updated dependencies [834c559]
- Updated dependencies [22b503c]
- Updated dependencies [9fc68aa]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [6be0f7a]
- Updated dependencies [4590363]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [ded4494]
- Updated dependencies [d172f63]
- Updated dependencies [885a96f]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [3bf8894]
- Updated dependencies [72167a9]
- Updated dependencies [e06365c]
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
- Updated dependencies [e391f87]
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
- Updated dependencies [1d1cfe0]
- Updated dependencies [6757a93]
- Updated dependencies [b7cd5c8]
- Updated dependencies [5330038]
- Updated dependencies [c9fc10b]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [a7d4920]
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
- Updated dependencies [38bb373]
- Updated dependencies [803f678]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [0cd322d]
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
- Updated dependencies [28ebfb5]
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
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [37db09f]
- Updated dependencies [ff9df88]
- Updated dependencies [70e843f]
- Updated dependencies [caac3b2]
- Updated dependencies [a2225f9]
- Updated dependencies [5c4deb5]
- Updated dependencies [a8e5b73]
- Updated dependencies [9782cb2]
- Updated dependencies [3e2394d]
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
- Updated dependencies [165f8ff]
- Updated dependencies [646caea]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
- Updated dependencies [6f5dc6b]
- Updated dependencies [8ed7e5a]
- Updated dependencies [6c4d00d]
- Updated dependencies [db8ce2f]
- Updated dependencies [726d8c9]
- Updated dependencies [f0e760a]
- Updated dependencies [a5bb7ac]
- Updated dependencies [f78efdd]
- Updated dependencies [8a8bcf3]
- Updated dependencies [f74638c]
- Updated dependencies [ef71a09]
- Updated dependencies [8614705]
- Updated dependencies [619e3f7]
- Updated dependencies [ca7a4c3]
- Updated dependencies [c9e6742]
- Updated dependencies [4be76e0]
- Updated dependencies [f62b6ff]
- Updated dependencies [608033b]
- Updated dependencies [611566b]
- Updated dependencies [efa9cb4]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [9d857c9]
- Updated dependencies [670ea10]
- Updated dependencies [ff215d9]
- Updated dependencies [71243db]
- Updated dependencies [e219a3d]
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [a23e804]
- Updated dependencies [c7462e7]
- Updated dependencies [36e2f7b]
- Updated dependencies [263e9dd]
- Updated dependencies [360e27a]
- Updated dependencies [ac59073]
- Updated dependencies [44cb469]
- Updated dependencies [e058d76]
- Updated dependencies [464ae62]
- Updated dependencies [c999d4c]
- Updated dependencies [8df2608]
- Updated dependencies [8df2608]
- Updated dependencies [5483297]
- Updated dependencies [ed43c79]
- Updated dependencies [6367bfe]
- Updated dependencies [260ef71]
- Updated dependencies [655e897]
- Updated dependencies [655e897]
- Updated dependencies [020d178]
- Updated dependencies [8d80845]
- Updated dependencies [69a408f]
- Updated dependencies [1aa622a]
- Updated dependencies [d2b21a1]
- Updated dependencies [6e4f144]
- Updated dependencies [5ff64ef]
- Updated dependencies [64acb7e]
- Updated dependencies [4ff5b6b]
- Updated dependencies [473e5a0]
- Updated dependencies [b279016]
- Updated dependencies [bb6c38c]
- Updated dependencies [15b1065]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [2727527]
- Updated dependencies [3da39ae]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [8392f74]
- Updated dependencies [2cfdc99]
- Updated dependencies [2cfdc99]
- Updated dependencies [1e6d83b]
- Updated dependencies [1e6d83b]
- Updated dependencies [6058bf8]
- Updated dependencies [c219165]
- Updated dependencies [79cb8c0]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [03f1d65]
- Updated dependencies [30083da]
- Updated dependencies [7f9cc37]
- Updated dependencies [025130c]
- Updated dependencies [76f91f8]
- Updated dependencies [ea34d9b]
- Updated dependencies [8aa8e3e]
- Updated dependencies [024b7b6]
- Updated dependencies [cb80001]
- Updated dependencies [bcd9717]
- Updated dependencies [909c64e]
- Updated dependencies [9e7e1a5]
- Updated dependencies [1d3da6c]
- Updated dependencies [0d97642]
- Updated dependencies [2493e85]
- Updated dependencies [d0b9648]
- Updated dependencies [46dbf32]
- Updated dependencies [a928aaa]
- Updated dependencies [47508f3]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [6f877f1]
- Updated dependencies [988aa9f]
- Updated dependencies [50ba1bb]
- Updated dependencies [1ce0711]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
- Updated dependencies [4c68855]
- Updated dependencies [2d8a8b7]
- Updated dependencies [cbac9d7]
- Updated dependencies [9eb1479]
- Updated dependencies [74e37aa]
- Updated dependencies [961b69f]
- Updated dependencies [52907d7]
- Updated dependencies [f466b0a]
- Updated dependencies [673a71c]
- Updated dependencies [616df65]
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
- Updated dependencies [26b0bd2]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
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
  - @object-ui/i18n@18.0.0
  - @object-ui/react@18.0.0
  - @object-ui/plugin-detail@18.0.0
  - @object-ui/permissions@18.0.0
  - @object-ui/mobile@18.0.0

## 17.7.0

### Minor Changes

- 2124d04: A standalone `object-calendar` honours `navigation: { mode: 'page' }`, and a `navigation` block written without `mode`, by opening the record page (objectui#11293).
  
  An event click under either spelling used to open nothing on a calendar no parent view navigates for, and the `navigation` input description of the `object-calendar` and `calendar` registrations warned about it. The shared `useNavigationOverlay` now hands that click to the record navigator the host publishes, and the console publishes one on its custom pages, record pages and list views. The description drops the warning and says where `page` goes: through the host's record navigator, and nowhere under a host that publishes none. An overlay mode still keeps the click from a parent view's handlers, and any other mode still hands it to them.
- 7c3df8f: A non-grid view's fetch now carries a platform row ceiling, and crossing it is
  never silent (objectui#7210, maintainer ruling a′, 2026-09-02).
  
  Before this, `ObjectGantt`, `ObjectCalendar`, `ObjectMap` and `ObjectTree` each
  issued a `find` with **no `$top` at all**, so the request returned the entire
  filtered result set. At the 186 rows the card was filed from that is invisible;
  on an object with 100k scheduled rows it is the whole table into the browser,
  and nothing an author could write — `pagination.pageSize` included — could
  bound a request that never carried a cap to begin with.
  
  **What changed.** Those four fetches now ask for `NON_GRID_ROW_CEILING_TOP`
  rows, draw at most `NON_GRID_ROW_CEILING` of them, and when the result set was
  larger they render a footnote naming both numbers, verbatim as it renders:
  *"Showing the first 2000 of 41234 records. Narrow the filter."* Below the
  ceiling nothing changes: the full set draws and no footnote appears.
  
  The four view packages take a **minor**, not a patch: a result set above the
  ceiling is no longer drawn in full, which is a behaviour break whatever the
  fixed group does to the released version number.
  
  **The ceiling is a platform constant, not an authorable key** — `2000`, exported
  from `@object-ui/react` as `NON_GRID_ROW_CEILING`. An authored `limit` or
  `dataSource: { limit }` still does not reach these queries, by the same ruling;
  three alternatives were rejected with it (a documentation note only — still the
  whole table; truncating at `pageSize` — silent, and a complete schedule capped
  at one page; an authorable `maxRows` — a new permanent key every author sets).
  
  **Why 2,000.** One constant for all four, so the binding view sets it. Measured
  in this repo's jsdom lane: gantt, calendar and map hold their DOM flat as rows
  grow (virtualised task list; four events per day cell; auto-clustering above
  100 markers), while `ObjectTree` flattens every expanded node into the document
  at a linear **5.2 DOM elements per record** with no virtualisation. 2,000 rows
  is where the worst of the four lands at ~10,400 elements — an order of
  magnitude above Lighthouse's "excessive DOM size" warning, and still ~10x the
  real application result set this card came from.
  
  New exports on `@object-ui/react`: `NON_GRID_ROW_CEILING`,
  `NON_GRID_ROW_CEILING_TOP`, `applyNonGridRowCeiling`, `NonGridRowCeilingNote`
  and the type `NonGridCeilingResult`. Two new `common.*` i18n keys carry the
  footnote copy in all ten packs.
- b041b9c: `@object-ui/core` publishes `resolveRecordSourceObjectName`, the ONE reader for "which
  object is this block bound to".
  
  Six view plugins each spelled that resolution locally — `ObjectCalendar` twice,
  `ObjectGantt`, `ObjectTree` twice, `ObjectMap`, `ObjectGrid` — and had drifted: three
  wrote `?? schema.objectName`, one `|| ''`, one `: undefined`, one an `'object' in
  dataConfig` test. They now delegate to one function that states the published
  record-source ladder `77cb489b4` declared (`data`, then `staticData`, then `objectName`) once.
  
  **No behaviour changes.** Each site's pre-collapse expression is transcribed verbatim
  into `record-source.behaviourNeutrality-7627.test.ts` and asserted equal to its
  post-collapse spelling across the whole contract-valid input matrix — both bindings
  present, data only, `objectName` only, empty `objectName`, empty `data.object`, the
  `api` / `value` / `staticData` / array-shorthand providers, and nothing bound.
  
  **Two questions stay two questions.** `normalizeListViewSchema`'s gap-fill (#7477,
  ruling B, landed as `00d2fa682`) is untouched and is NOT re-pointed at the new reader: it answers
  how `objectName` gets POPULATED when absent, where an already-present `objectName` wins.
  The new reader answers which object a block RESOLVES, where the `data` block wins — the
  order declared on both published faces in `@object-ui/types` and pinned by
  `objectql-record-source-refinement-6939.test.ts`. Merging them would silently override
  one standing ruling or the other.
  
  **`ObjectGantt`'s `persistLayoutKey` is deliberately excluded** and keeps its inverted
  order, with an in-place comment saying why: its receiver is a localStorage key
  (`gantt-layout:KEY:filters`), not a record source, so re-pointing it would orphan every
  saved layout and filter-chip set of a view carrying both bindings. Two more sites the
  finding listed are not object-name readers at all and were struck: `ObjectGantt`'s
  refresh-handler predicate (`object` OR `api`) and `plugin-dashboard`'s `isObjectProvider`
  type-guard over a widget's `data`.
  
  `useSettledSchema`'s doc comment stops prescribing the hand-written ladder at all four
  lines that taught it, so the copies cannot re-seed from the hook that replaced them.
- 7ef3867: Retire the `filter.calendar` configuration spelling on `object-calendar` (objectui#7711).
  
  **Breaking, deliberately.** `getCalendarConfig` no longer probes `schema.filter` for a
  `calendar` key. A calendar whose configuration was written as
  `filter: { calendar: { startDateField: … } }` no longer resolves a configuration at all
  and now renders the component's existing "Calendar configuration required" refusal
  screen. Write the configuration under
  the declared `calendar` container instead — the read for it already existed, directly
  below the retired arm.
  
  `filter` is the query filter and nothing else. `@objectstack/spec`'s
  `ComponentPropsMap['object-calendar']` declares `calendar` as the configuration
  container and `filter` as the base query filter, and admits no `filter.calendar`
  spelling; the renderer nevertheless read the config out of the filter FIRST, and the
  comment on the canonical read below called *that* one the "backward compatibility"
  branch — the contract inverted in a source comment. The arm and the comment are both
  gone. No compatibility rung and no deprecation window, per AGENTS.md #0.1: a tolerant
  fallback fossilizes the wrong convention into a second de-facto contract.
  
  **The bug this closes is not only the retired spelling.** One authored key was being
  read twice with two incompatible meanings. `filter: { calendar: 'team' }` — a
  legitimate condition on a field literally named `calendar` — was returned as the
  `CalendarConfig` while the same object still went to `$filter` on the wire. `'team'` is
  truthy, so the refusal screen did not fire either: `startDateField` destructured off a
  string is `undefined`, every record fell into "unscheduled", and the grid rendered empty
  while the author's declared `calendar` block sat unread. Such a filter now reaches
  `$filter` untouched and the declared container is what configures the calendar.
  
  The calendar twin of the `filter.map` retirement in objectui#4034, with one measured
  difference: there is no `Array.prototype.calendar`, so `'calendar' in schema.filter` was
  never true for an array-shaped filter the way `'map' in schema.filter` was true for
  every one of them. Only an object-shaped filter with an own `calendar` key ever reached
  the retired arm, and the calendar answers the loss of a configuration with a named
  refusal on screen rather than the map's silent fallback to default field names — so this
  retirement carries no dev-time diagnostic rider.
  
  **Migration.** A census of this repo found **zero** authored `filter: { calendar: … }`
  sites (both the object-literal and JSON spellings, with positive controls and a planted
  fixture proving the search fires).
  
  Also in this change: the `calendarConfig` memo's dependency list drops `schema.filter`,
  which the function no longer reads, and gains the three flat keys it does read but the
  list never named — `startDateField`, `endDateField` and `allDayField`. Dropping `filter`
  removed an accidental co-trigger that used to pick those up whenever a filter changed
  alongside them.
- 0ead1f6: Declare the `filter` input on every `object-kanban` / `object-calendar`
  registration (objectui#7712) — the html tier stops reporting `unknown-prop` on a
  key the spec declares and both renderers read.
  
  `ObjectKanban.tsx` sends the authored key to the query as `$filter: schema.filter`
  and `ObjectCalendar.tsx` does the same, and `@objectstack/spec`'s
  `ComponentPropsMap` declares `filter` on both blocks (measured: `safeParse`
  accepts it, and refuses an undeclared key by name on the same call). But none of
  the four registrations that publish those two renderers listed `filter` in
  `inputs`, and `sdui-parser`'s `validateTree` reports `unknown-prop` for every key
  no `inputs` entry claims. So an author writing the one spelling that WORKS was
  told it was unknown — objectui#6678's shape, where a correct write draws the same
  diagnostic as a write that does nothing. That is worse than an inert key: it
  actively punishes the correct behaviour, and the honest response to it is to
  delete working metadata.
  
  ADR-0049 enforce-or-remove resolves toward **declare**, not remove: the key has
  live readers on both ends, so the registrations were the side that was wrong. The
  declaration is `type: 'array'` on all four, matching the `filter` that
  `object-grid`'s `GRID_QUERY_INPUTS` and `object-metric` already publish, and it is
  writable as one shape only because objectui#7711 landed first and retired the
  object-shaped `filter.calendar` spelling — `filter` is the query filter and
  nothing else.
  
  Declared per key against the spec rather than derived from the
  `ElementDataSourceMapping` sitting beside these registrations, even though that
  mapping already asserts `filter` is a live query key. Measured, that derivation
  would be wrong: the kanban mapping also carries `limit`, and the spec's strict
  `ComponentPropsMap['object-kanban']` **rejects** `limit` by name, so emitting it
  would publish a key the save gate refuses.
  
  ⚠️ Note for whoever meets this class next: `check:react-blocks-declaration-parity`
  runs manifest → spec, one direction. A key the SPEC declares and the manifest
  omits is structurally outside what that ratchet measures, so fixing these four
  registrations does **not** make the next omission loud. Making that ratchet
  bidirectional is its own card.
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
- f84760f: `object-calendar` now READS the `allDayField` it already resolved (objectui#8026).
  
  **The defect.** `getCalendarConfig` put `allDayField` into the `CalendarConfig` it
  returns, and the memo that builds that config named the key among its dependencies —
  but the events pass destructured four keys and computed the flag as `!endDate`. An
  author who wrote `calendar: { allDayField: 'is_all_day' }` therefore got the flag
  derived from whether the record happened to carry an end date, and a record with a
  real end date that IS flagged all-day rendered as an ordinary timed event, with no
  diagnostic. The value was arriving: `ListView`'s `collectViewFields` already collects
  this field into the fetch, and `ObjectView`'s `calendarViewOptions` forwards the
  authored `calendar` block verbatim.
  
  **No default field name — the deliberate divergence from `calendar-view`.** The
  sibling `calendar-view` renderer spells `schema.allDayField || 'allDay'`.
  `object-calendar` does **not** take that default, and an unauthored `allDayField`
  changes nothing: the existing `!endDate` inference stands, so every calendar that
  never declared the key renders exactly as before. The sibling's five field-name
  defaults describe the canonical authored EVENT shape a `calendar-view` node carries
  in its `data`; `object-calendar` draws ObjectQL records of a business object, where
  nothing makes `allDay` a field name — and this renderer honours none of those five
  defaults, refusing rather than guessing when `startDateField` is absent
  (objectui#7029). Importing one of the five would put the last fabricated field
  binding back into the renderer whose refusal screen exists to refuse guessing.
  
  **Behaviour change, scoped.** Only calendars that DID author `allDayField` change,
  and they change in the direction the declaration asked for. Where the key is
  declared it is now the whole answer: a record whose flag is absent or false is not
  all-day, because letting the inference run behind a declared key would silently
  overrule the author.
  
  **Not spec surface.** `@objectstack/spec`'s `CalendarConfigSchema` is a strict object
  of four keys and refuses `allDayField` by name — the same way it refuses objectui's
  own sanctioned `defaultView`. The key rides objectui's deliberate `.passthrough()` on
  the `CalendarConfig` mirror in `@object-ui/types`, whose comment names it: "the
  renderers grow config knobs ahead of the protocol (calendar's `allDayField`, for
  one), and stripping them here would silently disable a shipped capability." Nothing
  in this change widens any accept set.
  
  **Correction, 2026-10-01 (objectui#8831).** The "Not spec surface" paragraph above is false against `@objectstack/spec` 17.5.0, which this same release installs. That release's `CalendarConfigSchema` declares five keys, `allDayField` among them, and accepts it. It still refuses `defaultView`. The key no longer rides the `.passthrough()` of the `CalendarConfig` mirror in `@object-ui/types`: that mirror derives from the spec schema, so `allDayField` is now a declared member of it. objectui#11073's bump to 17.5.0 made the paragraph false, not this entry and not objectui#8831. The paragraphs about the renderer still hold: `object-calendar` takes no default field name for `allDayField`, and a declared one is the whole answer.
- 35e6366: Declare the `sort` input on both `object-calendar` registrations
  (objectui#8171) — the html tier stops reporting `unknown-prop` on a key the spec
  declares and `ObjectCalendar` already reads.
  
  objectui#7712's defect, one key over. `ObjectCalendar.tsx` lowers the authored
  key onto its own query as `$orderby: convertSortToQueryParams(schema.sort)`, and
  `@objectstack/spec`'s `ComponentPropsMap['object-calendar']` declares `sort`
  (measured on 17.2.0: `safeParse({ objectName, sort })` returns `success: true`,
  while the same strict schema on the same call refuses `bogusProp` by name — that
  control is what makes the acceptance a verdict). But neither of the two
  registrations that publish this renderer — `plugin-calendar:object-calendar` and
  `view:calendar` — listed `sort` in `inputs`, and `sdui-parser`'s `validateTree`
  reports `unknown-prop` for every key no `inputs` entry claims. So an author
  writing the one spelling that WORKS was told it was unknown — objectui#6678's
  shape, where a correct write draws the same diagnostic as a write that does
  nothing.
  
  ADR-0049 enforce-or-remove resolves toward **declare**, not remove: the key has
  live readers on both ends, so the registrations were the side that was wrong.
  Declared `type: 'array'`, matching the `filter` entry objectui#7712 put beside
  it and the `sort` that `object-grid`'s `GRID_QUERY_INPUTS` publishes — measured,
  that arm is the repo-wide convention for this key, all seven existing `sort`
  declarations write it.
  
  ⛔ Not derived from the `ElementDataSourceMapping` sitting six lines above,
  which already asserts `sort: true`. That structure maps query keys for
  `ElementDataSourceGate`; it is not an authoring declaration, and objectui#7712
  measured why a mechanical derivation would be wrong — kanban's mapping also
  carries `limit`, which the spec refuses by name.
  
  ⚠️ Carried forward from objectui#7712, because it stays true here:
  `check:react-blocks-declaration-parity` runs manifest → spec, one direction. A
  key the SPEC declares and the manifest omits is structurally outside what that
  ratchet measures, so declaring this key does **not** make the next omission
  loud. Making that ratchet bidirectional is objectui#8176.
  
  Rider carried by the same change, because objectui#8212 landed first: the
  console's `registry-inputs-spec-parity` ledger is updated in step with the
  declaration — the `object-calendar.sort` unpublished-key exemption is deleted
  (its cover expires the moment the key is declared), the shrink-only objectui#8176
  backlog ceiling drops 16 to 15, and `sort` gets a `MEMBER_PINS` entry rather than
  a member-pin exemption. `MEMBER_PIN_EXEMPTION_CEILING` is untouched by this
  change; it read 62 at the commit that wrote this paragraph (`35e63669d6`,
  2026-09-07), and that reading is dated on purpose — see the closing note.
  
  ⚠️ That member pin is deliberately NOT the identity-forwarding shape the two
  `filter` pins use. `ObjectCalendar.tsx` writes
  `$orderby: convertSortToQueryParams(schema.sort)`, which builds a new
  `field -> direction` map, so this key is lowered rather than passed through and
  `toBe` on `$orderby` is false about it. The pin asserts what is READ inside a
  member instead — `field`, `order`, an omitted `order` meaning ascending, and a
  member with no usable `field` dropped rather than invented.
  
  No version bump is declared for `@object-ui/console`: its only edit here is that
  test file's ledger data, which publishes nothing.
  
  ⚠️ Closing note, written while this declaration was still pending
  (objectui#9781) — why the `MEMBER_PIN_EXEMPTION_CEILING` reading above is DATED
  rather than corrected. The sentence was authored as
  "`MEMBER_PIN_EXEMPTION_CEILING` is untouched at 62", and both of its halves
  were true at `35e63669d6`: this change did not touch that constant, and 62 was
  its value there. "Is untouched" is a closed statement about THIS change and
  cannot rot, so it is kept as written. "At 62" is an absolute reading of a
  SHARED constant, which somebody ELSE's change falsifies — objectui#8071 slice 1
  (`240c605939`, 2026-09-09) lowered it 62 -> 58, and later slices of that issue
  moved it again while this declaration sat pending.
  
  ⛔ The reading is deliberately NOT restated at whatever that constant reads
  today: today's number is true today and false again at the next slice, so
  writing it would be this same defect authored a second time. ⇒ The rule this
  repair carries, and the line between this paragraph and every sibling changeset
  in the family: state your OWN change's bounded transition ("lowers 62 to 58",
  "follows 31 to 28 in the same change", "drops 37 to 33") or state that you did
  not touch the constant, and ⛔ never state what its value currently is. The
  first is a finished fact about something the author controlled; the second is a
  live claim about a world the author does not.
- 0ea7054: Remove 37 runtime dependencies that no file in the declaring package consumes, and gate
  the direction so the next one cannot land (objectui#8198).
  
  `check:phantom-deps` judges imports that are not declared; nothing judged the reverse,
  so a declaration could outlive its last consumer indefinitely. That is what happened to
  `recharts` in `@object-ui/components` after objectui#7397 deleted its only importer — it
  was removed by hand on objectui#7625, and nothing would have reported the next one. The
  new `pnpm check:unused-deps` asks the reverse question over `dependencies` and
  `optionalDependencies` of every released package.
  
  **Potentially breaking, for consumers relying on hoisting.** Nothing these packages ship
  changes: their Vite `external` predicates are path-based and never read `dependencies`,
  so no built artifact moves. What changes is the install graph — a project that imports
  one of the removed packages while depending only on the ObjectUI package that used to
  drag it in will no longer resolve it. Declare it directly; that is the correct
  dependency edge in either case. The removals, by package:
  
  - `@object-ui/plugin-designer`: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@object-ui/fields`
  - `@object-ui/plugin-chatbot`: `react-markdown`, `react-syntax-highlighter`, `remark-gfm` (and the orphaned `@types/react-syntax-highlighter`)
  - `@object-ui/plugin-report`: `@object-ui/plugin-grid`, `clsx`, `react-i18next`, `tailwind-merge`
  - `@object-ui/plugin-map`: `@objectstack/spec`, `lucide-react`, `zod`
  - `@object-ui/runner`: `class-variance-authority`, `clsx`, `tailwind-merge`
  - `@object-ui/core`: `lodash`, `zod`
  - `@object-ui/layout`: `clsx`, `tailwind-merge`, and `react-dom` — which it pinned at an exact version in `dependencies` while also declaring it as a peer range, i.e. a library hard-depending on the renderer it asks its host to supply
  - `@object-ui/plugin-dashboard`: `clsx`, `tailwind-merge`, and the same `react-dom` defect
  - `@object-ui/plugin-ai`: `@object-ui/react`, `clsx`, `tailwind-merge`
  - `@object-ui/fields`: `clsx`, `tailwind-merge`
  - `@object-ui/console`: `@object-ui/react-runtime`, `sucrase`
  - `@object-ui/auth`: `@object-ui/types`
  - `@object-ui/plugin-calendar`: `@object-ui/fields`
  - `@object-ui/plugin-editor`, `@object-ui/plugin-markdown`: `@object-ui/react`
  - `@object-ui/react`: `react-hook-form`
  
  Every one was verified by a whole-package grep before removal — the name appeared nowhere
  under the package but its own manifest and CHANGELOG — and the whole workspace builds,
  type-checks and tests green afterwards.
- 91facae: **Breaking behaviour change — a view block now honours only the `data` spelling its published row declares.**
  
  Maintainer ruling, decision batch #83 (2026-09-08), verbatim 「8348 以协议为准」: the contract decides. What `os validate` and the save gate refuse under `data`, the renderer refuses too. The shared record-source ladder (`resolveRecordSourceConfig` in `@object-ui/core`) now takes the arm the calling block's row declares, and rung 1 applies only on that arm.
  
  ⚠️ **`object-calendar` documents authored against the tolerated spelling stop rendering those rows.** The ladder falls past `data` to `staticData`, then to `objectName` — so such a calendar queries its object instead, or draws nothing when it names neither. This is accepted, with no transition window and no staged deprecation (the standing 2026-08-27 posture).
  
  **Per block — what the published row says, and what actually moves:**
  
  - **`object-calendar`** — row: `ComponentPropsMap['object-calendar'].data` is `z.array(z.unknown())` ("Pre-fetched records — skips the internal fetch"). A record-source **config object** under `data` — `{ provider: 'value', items }`, `{ provider: 'object', object }`, `{ provider: 'api', … }` — is no longer honoured, and this is a real end-to-end change: that object had exactly one carrier into the block, so an authored calendar written that way now queries its object (or draws nothing) instead of drawing the authored rows. There is no longer an api-provider branch to reach here. An **array** under `data` is unchanged, as are `staticData` and `objectName`.
  - **`object-grid`** — row: the `ViewData` union, whose own description says "the bare-array shortcut is refused". `getDataConfig`'s `Array.isArray(schema.data)` head is removed, so the array is no longer a record source at the ladder. ⛔ Measured: this is **not** an end-to-end change for a node rendered through `SchemaRenderer`. An authored `data` array also arrives on the **props channel** (`SchemaRenderer` spreads node keys as props; `ObjectGrid`'s `passedData` lifts an array at higher priority), so such a grid still drew its rows when this landed. The removal took the second read, not the last one; objectui#9571 closed the props carrier afterwards.
  - **`object-map`** — no `ComponentPropsMap` row existed when this landed; the governing row was this repo's own `ObjectMapSchema.data`, `ViewDataSchema.optional()` (the protocol row has since been published, and is the `ViewData` union too). Its array-shorthand head is removed on the same terms, with the same measured caveat at the time: through `SchemaRenderer` the props channel still drew an authored array, until objectui#9571. `data: { provider: 'value', items }` and `staticData` are unchanged.
  - **`object-gantt`** — no `ComponentPropsMap` row when this landed; the governing row was `ObjectGanttSchema.data`, `ViewDataSchema.optional()` (the protocol row has since been published, and is the `ViewData` union too). A bare array under `data` is no longer a record source. Nothing observable moves: this block never lifted one, the array carried no `provider` and matched no fetch branch, and its renderer forwards no host props.
  - **`object-tree`** — **unchanged by this change.** When it landed, no published face declared a `data` row for this block: not `ComponentPropsMap`, not `ObjectTreeSchema` (which declares `objectName` required and no `data`), not its registration `inputs`. Neither arm of the ruling reached it, so its rung 1 kept its previous behaviour and the block was reported rather than guessed at. Once the protocol published `ComponentPropsMap['object-tree']`, the tree moved to the `ViewData` arm too — see the separate `object-tree` entry for objectui#8348.
  
  The `data` **prop** — the pre-fetched rows a host such as `ObjectView` or `ListView` passes down — is a different carrier and is untouched on every block. That it is also reachable from an authored node key, because `SchemaRenderer` spreads node keys as props, is what limits the grid and map halves above; it is reported on objectui#8348 rather than changed here.
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
- d79f525: `navigation` is declared on the `object-kanban` and `object-calendar` blocks, by reference to `@objectstack/spec` (objectui#8652). This is the objectui half of the maintainer ruling on that card: the spec declares the key on both element entries from 17.5.0, and objectui now mirrors it.
  
  - `@object-ui/types`: `ObjectKanbanSchema.navigation` and `ObjectCalendarSchema.navigation` are declared on both published faces with the spec's `NavigationConfig` type — the same type the grid, view, gantt and map schemas use. Until now the key was admitted and never examined: `navigation: { mode: 'not-a-mode' }` passed both faces while the spec refused it. It is now refused at `navigation.mode`, and a member the spec does not declare inside the block is refused too. A parse adds no default to the block, so a board or calendar without the key still opens a record in a drawer.
  - `@object-ui/plugin-kanban`: the `object-kanban` registration publishes `navigation` in its `inputs`, so the designer offers it.
  - `@object-ui/plugin-calendar`: the `object-calendar` and `calendar` registrations publish `navigation` in their `inputs`, and `ObjectCalendar` reads the key without a cast.
  
  What a click does with each member is unchanged. `page`, and a block written without `mode` (which resolves to `page`), open the record page through the record navigator the host publishes (objectui#11293); under a host that publishes none, such as an embedded renderer, they still open nothing. The published input descriptions say so.
- a984600: Honour `filter`, `sort` and the platform row ceiling on a calendar's and a map's
  inline (`provider: 'value'`) data (objectui#9061) — the port of objectui#8769's
  repair off `ObjectGantt`.
  
  **The defect was fail-open.** Both renderers' fetch effect short-circuited the
  inline provider: it set the authored rows and returned BEFORE the adapter query,
  which is the one site in each file that lowers `schema.filter` to `$filter`,
  `schema.sort` to `$orderby` and the objectui#7210 ceiling to `$top`. So an
  inline calendar or map that declared a `filter` drew **every** authored row, with
  no diagnostic. The key that was dropped is the key that NARROWS, which is why
  this matters: the view answered a wider question than the author asked. Nothing
  was exposed that was not already in the authored schema — this is a correctness
  defect, not a data-access one.
  
  **What changed.** Each renderer resolves a `ValueDataSource` for the inline
  provider and issues the same query the `object` arm issues. The `api` arm is
  untouched, and no dependency array moves. `ValueDataSource` already implements
  `$filter` / `$orderby` / `$skip` / `$top` / `$select` over its own array, so no
  filter combinator was written for this change.
  
  **Behaviour you may notice.**
  
  - An authored `filter` / `sort` now narrows and orders inline rows. Every
    spelling reaches it: `data: { provider: 'value', items }` and `staticData` on
    both renderers, plus the map's bare-array `data` shorthand.
  - The row ceiling now applies to inline rows: past 2,000 drawn rows the view
    draws 2,000 and shows the footnote naming both numbers, as it already did for
    fetched rows. It is applied to the **filtered** set, so a large inline array
    that a `filter` cuts below the ceiling draws every matching row and stays
    quiet. Rows a host passes down through the `data` React prop are still never
    capped — those are not ours to cap.
  - Inline rows now reach the view as the adapter's own deep copy rather than as
    the authored array's object identities. Code comparing a row handed to
    `onEventClick` / `onMarkerClick` against the authored array with `===` needs
    `id` equality instead.
  - That copy is a JSON round-trip, so inline rows must be JSON-serializable.
    A record graph carrying a back-reference, or a `BigInt` id, now renders an
    error panel instead of the view. `ObjectGantt` has refused the same input
    since before objectui#8769; `ObjectMap` did not, and pinned that it need not
    (objectui#6018). ⚠️ That pin is left RED and untouched in this change — see
    the pull request body.
- 7098eed: One record-overlay shell: all five list-type renderers honour all four overlay
  `navigation.mode` values (objectui#9299, director seat decision batch #128 item
  1, 2026-09-13).
  
  `ObjectGantt`, `ObjectKanban` and `ObjectCalendar` rendered one drawer for every
  authored mode — `modal`, `split` and `popover` silently WERE the drawer, with no
  diagnostic. `RecordDetailDrawer`'s payload is extracted into the new
  `RecordDetailPanel` (shell-free by construction) and mounted through the shared
  `NavigationOverlay`, which is what `ObjectGrid` and `ObjectTree` already used.
  
  User-visible on published surfaces:
  
  - **`modal` / `split` / `popover` now do what they say** on the gantt, the
    kanban and the calendar.
  - **`split` renders.** Each renderer passes its own view as `mainContent`, so
    the board / calendar / chart / tree / grid sits beside the record panel.
    Authored `split` used to render NOTHING on `ObjectTree` — and, measured while
    fixing this, on `ObjectGrid` too.
  - **`popover` is anchored to the element the user clicked** — row, node, bar,
    card, event — instead of degrading to a centred dialog. It was honoured on no
    surface before.
  - **Drawer chrome converges** on the shared shell's header (breadcrumb title,
    close, optional expand) for the three renderers that brought their own.
  - **Drawer widths carry over, they are not reset.** The two drag-resize
    implementations become one: a width persisted under the retired
    `objectui.drawerWidth.OBJECT` is read once, written forward to
    `ov:drawer-width:OBJECT` and removed. One key per object across every view
    type. The default width is unchanged at every viewport (objectui#6584); an
    authored width below `min(60vw, 880px)` now widens to it, which is the shell's
    long-standing policy on grid and tree.
  - **Richer record body on grid and tree** — typed widgets, declared labels,
    honoured `hidden` — wherever the object declares its fields. With nothing
    declared those two renderers keep their own value-inference reading, which is
    what preserves the locale-aware date fallback (objectui#4541), the localized
    empty placeholder (objectui#8491) and the `format` hint (objectui#8920); the
    overlay shell is the shared one on that path too.
  
  New published API: `RecordDetailPanel`, `buildRecordDetailFields`,
  `RECORD_OVERLAY_DEFAULT_WIDTH` (`@object-ui/plugin-detail`);
  `useOverlayAnchor`, `recordOverlayWidthStorageKey`,
  `legacyRecordDrawerWidthKey` and the `popoverAnchorRef` / `legacyStorageKey`
  props on `NavigationOverlay` (`@object-ui/components`). `RecordDetailDrawer`
  keeps its props and is now a thin wrapper over the shared shell. ⛔ No spec
  change.
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
- ab856ed: **`resolveRecordSourceConfig`'s `data` parameter now follows the arm it is already told, instead of contradicting it.**
  
  The shared record-source ladder in `@object-ui/core` takes a REQUIRED `dataArm` argument precisely because blocks declare `data` differently — its own docblock says there is no repo-wide default, "because the answer differs per block and a default is how the second de-facto contract got in" (ruling objectui#8348, decision batch #83, 「8348 以协议为准」). Its parameter nevertheless declared a flat `data?: ViewData` — a discriminated union over four strict OBJECT arms, with no array member — while its rung-1 predicate `authoredDataIsOnTheDeclaredArm` takes `unknown` and admits an ARRAY on the `'array'` arm. The declaration contradicted the contract the same function documents and implements.
  
  The `data` member is now `AuthoredRecordSourceData<Arm>`, a new exported conditional type keyed on the arm:
  
  - `'view-data'` → `ViewData`. **Unchanged** — this is what the flat declaration said, and it was right for the three blocks on this arm (`object-grid`, `object-map`, `object-gantt`).
  - `'array'` → `unknown[]`, the shape `ComponentPropsMap['object-calendar'].data` declares (`z.array(z.unknown()).optional()`, "Pre-fetched records").
  - `'undeclared'` → `unknown`, since no published face declares a `data` row for such a block and rung 1 keeps its pre-8348 verbatim behaviour there.
  
  ⚠️ **Type-level only — no runtime accept set moves.** Nothing in the ladder's body changed: `authoredDataIsOnTheDeclaredArm` still takes `unknown` and still decides rung 1 on the value's KIND, so every resolved config — including the off-arm ones that fall through to `staticData` and then `objectName` — is what it was. The emitted JavaScript of both packages is unchanged by this card.
  
  ⚠️ **One compile-time refusal is new**, and it is the half that keeps this from being a mere widening: a caller that declares a `ViewData` provider block under `data` while passing `'array'` no longer type-checks. That document was already refused at runtime by objectui#8348, and by `os validate` and the save gate before that; only the signature still accepted it. A caller that holds the arm as a `RecordSourceDataArm` variable rather than a literal is unaffected — the conditional type distributes to `unknown` there, which a set of literal-armed overloads would not have done.
  
  `@object-ui/plugin-calendar` loses the cast that stood in for the missing declaration: `ObjectCalendar`'s ladder call passed `data: schema.data as ViewData | undefined`, in a comment reporting an upstream defect in `@object-ui/core`. The three members are still passed one by one — they are what the ladder documents itself as reading — but the member is now `data: schema.data`, and `packages/plugin-calendar` type-checks green without the assertion.
  
  Two stale docblock passages in `record-source.ts` and `record-source-config.behaviourNeutrality-7632.test.ts` explained `ObjectCalendar`'s retired `'data' in schema` guard by the props union `ObjectGridSchema | CalendarSchema`, which objectui#8651 retired — `ObjectCalendarComponentProps.schema` is the published `ObjectCalendarSchema` today. Both now say that the clause is history rather than a reading anyone can re-derive from `main`.
- 51e144e: fix(plugin-calendar): type `ObjectCalendar` at the published `object-calendar` schema, and declare the `calendar` container
  
  `ObjectCalendarComponentProps.schema` was the union `ObjectGridSchema | CalendarSchema` — a grid's schema, plus a plugin-local interface absent from this package's barrel. Neither arm is the schema of the element this renderer is registered as. Measured with the TypeScript checker: of the fifteen keys the renderer reads off the node, seven were undeclared on that union and had to be read through a cast, while five more resolved only through `ObjectGridSchema`'s index signature and were therefore typed `any` — admitted, never examined. `ObjectCalendarSchema` already declared eleven of the fifteen.
  
  - `ObjectCalendarComponentProps.schema` is now `ObjectCalendarSchema`. **Breaking for a React host that passed an `object-grid` node or a `type: 'calendar'` literal to `ObjectCalendar`** — neither was ever a node this renderer is registered for. `ObjectCalendarProps`, the deprecated alias, follows it.
  - `ObjectCalendarSchema.calendar` is declared on both published faces. The spec declares the KEY; it does **not** declare its shape — `ComponentPropsMap['object-calendar'].calendar` is `z.unknown().optional()` and accepts anything at that position — so the member list is objectui's own: the four `CalendarConfigSchema` names plus objectui's `allDayField`, which is what the renderer reads out of the block. The container keeps `.passthrough()`, so no KEY that parsed before is refused — an unexamined key inside the block still parses, and so do `calendar.dateField` and `calendar.defaultView`. What is new is VALUE validation: `calendar: 42` and `calendar: { startDateField: 42 }` are refused where both were admitted unexamined.
  - `@object-ui/types` now exports the type `ObjectCalendarBlockConfig`, so that published member has a name an importer can write.
  - ⚠️ The `dateField` / `endField` alias rungs in `getCalendarConfig` are **kept**, and routed to the producer. An earlier revision of this change retired them on a census that was false: `ListView` flattens an authored `calendar` block onto the node it emits, and `resolveTimelineDateBinding` in that same file documents `dateField` as the pre-#2231 alias for `startDateField` and honours it — so a view authored that way renders today and would have drawn "Calendar configuration required". (objectui's own `ListViewSchema` also accepts `calendar.dateField`, but only weakly: that block is `.passthrough()` and admits nonsense too, so the load-bearing half is the producer and the read site, not the accept.) No behaviour changes for either spelling. The alias question already has a carrier — objectui#8355, open and undecided — and the producer-side remedy belongs in `ListView`'s calendar branch.
  
  **Correction, 2026-10-01 (objectui#8831).** Two statements in this entry are false against the tree this release ships, for two different reasons.
  
  - "the four `CalendarConfigSchema` names plus objectui's `allDayField`": `@objectstack/spec` 17.5.0, which this same release installs, declares all five on `CalendarConfigSchema`, so the container's members are the spec's five. objectui#11073's bump made this false, not this entry and not objectui#8831. What the same bullet says about the spec at this position still holds on 17.5.0: `ComponentPropsMap['object-calendar'].calendar` declares the key but not its shape, and accepts `calendar: 42`.
  - "and so do `calendar.dateField`", and the ⚠️ bullet's "The `dateField` / `endField` alias rungs in `getCalendarConfig` are **kept**": objectui#8355 retired both rungs in this same release. `getCalendarConfig` no longer reads either spelling, and the container refuses `calendar.dateField` and `calendar.endField` by name (see objectui#8355's own entry). objectui#8355 made these false, not objectui#11073 and not objectui#8831. An unexamined key and `calendar.defaultView` still parse inside the block, and the value validation this entry adds (`calendar: 42` and `calendar: { startDateField: 42 }` are refused) still holds.

### Patch Changes

- afb2284: `ObjectCalendar`'s user-visible copy now reaches the locale packs. The component
  was already i18n-aware — it imports and calls both translation hooks — and a set
  of English sentences sat beside those calls as literals, so a non-English session
  read a half-translated calendar: the unscheduled label and the two write-failure
  toasts in its own language, and the loading screen, the error screen, the refusal
  screen, the pull-to-refresh affordance, the whole quick-create dialog and the
  record overlay's fallback title in English (objectui#10031).
  
  Every one of those now reads a key. Two of them reuse keys the packs already
  carried (`common.cancel`, `common.create`), one reuses `calendar.newEvent`, and
  twelve are new under `calendar.`.
  
  **The hook is chosen per site by one criterion, which the file already stated for
  its existing call:** `useSafeTranslate`'s `tt(key, fallback)` passes no options to
  i18next and therefore cannot fill a hole, so the two sentences that carry one —
  the error prefix and the quick-create date line — read their key through
  `useObjectTranslation`'s `t()` with an inline default, and every hole-free string
  uses `tt()`.
  
  **⚠️ A key added to `en` is not an `en`-only change in this repo**, and that is
  worth stating because the cheap route looks available: the English fallback does
  carry the English text at the call site, but the key-set invariant is a
  pack-vs-pack one — every pack defines every `en` key — so it is answered by the
  locale packs, not by the call site. All ten packs therefore carry the twelve new
  keys, with real translations rather than the English value. The instrument that
  says so is `all-locales-key-parity.test.ts`; `pnpm check:i18n-drift` prints which
  of the two owns an addition.
  
  **One rendered English string moved**: the loading placeholder's three ASCII full
  stops became the typographic ellipsis, because its sentence is now a pack value
  and `ellipsis-glyph-3878.test.ts` holds every pack value to U+2026. The refusal
  screen's copy is byte-identical to what it rendered before, which is what keeps
  the five suites that pin it green.
- 875ee61: fix(plugin-calendar, plugin-map, plugin-gantt): the registrations' `inputs` agree with the record-source rule
  
  All three blocks read their records from one of `data`, `staticData` and
  `objectName` (in that order), and their `@object-ui/types` zod schemas enforce
  "one of the three" through `requireRecordSource`. The designer-facing `inputs`
  on the registrations disagreed with that rule in two ways:
  
  - `object-calendar` and `calendar` still declared `objectName` as required, so
    the html tier's validator reported a `missing-required-prop` error on a
    calendar authored on `staticData` or `data`, which the schema accepts and the
    renderer draws. `objectName` is now declared without `required`, and its
    description states the rule, as objectui#7470 did for map and gantt
    (objectui#10392).
  - `object-map`, `map` and `object-gantt` did not declare `data` or
    `staticData`, so the validator reported a block authored on either as an
    unknown prop. At this change both were declared on all three, on the schema's
    own arms: `data` is a `{ provider, … }` data-source configuration (an object,
    so a bare array there draws a type diagnostic, matching the schema), and
    `staticData` is an array of records. Each description says what the renderer
    does with the key, including that the map does not implement the `api`
    provider (objectui#10394).
  
    ⚠️ **Dated note, 2026-09-25 — the bare `map` registration has since been
    retired — objectui#10393.** Later in this same release `@object-ui/plugin-map`
    stopped registering the bare `map` key (and its namespaced twin `view:map`),
    so `map` declares nothing: a node authored `"type": "map"` resolves no
    renderer, and the html tier reports it as `unknown-component`. The
    `object-map` and `object-gantt` registrations keep both inputs exactly as
    described above. The rest of this entry is kept as the reading of this
    change; the objectui#10393 entry states what ships.
  
  The renderers' read order and the zod schemas are unchanged. The
  `@object-ui/plugin-gantt` README sentence that listed the registration's inputs
  is updated.
  
  **Correction, 2026-10-01 (objectui#11117).** "One of the three" now has an exception on all
  three blocks: a block that declares none of them is accepted when its `dataSource.object` names
  the object, because the registration's `ElementDataSourceGate` lands that name on `objectName`.
  The `objectName` input description now says so.
- e5f4343: Four more date faces now follow the display locale, not the UI language (objectui#10442).
  
  Each one takes its locale from `useDisplayLocale()` instead of the UI language. With an English UI and
  a `de-CH` display locale, a date that used to read `3/4/2020` now reads `4.3.2020`. With no display
  locale declared, the display locale falls back to the UI language, so these dates render as before.
  
  - `data-table` (`@object-ui/components`): the ISO date and datetime cells.
  - The record page's History tab (`@object-ui/app-shell`): the `date` and `datetime` values in each
    field diff.
  - `ResourceWorkload` (`@object-ui/plugin-gantt`): the column labels and the cell tooltips. With no
    language at all it used to fall through to the machine's locale; it now gets the display locale's
    own last resort.
  - `CalendarView` (`@object-ui/plugin-calendar`): the default locale for the header, the weekday
    columns and the day cells. An explicit `locale` prop still wins over the display locale.
- 4a3d500: `object-calendar` re-reads its events when the data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a change to the object it queries (objectui#10572). A write that bypasses the data source — a page action over raw HTTP, a flow, a server action — fires no `onMutation`, so a calendar on a page used to show it only when the whole page was remounted. Inline and external events are still the host's to refresh.
- d435e96: fix(plugin-calendar): a failed load no longer keeps `ObjectCalendar` on its error screen after a later load succeeds (objectui#10663)
  
  `ObjectCalendar` set `error` when its fetch failed, and the render returns the
  error screen early whenever `error` is set. Nothing ever cleared it. Every later
  load that succeeded still wrote its events, but the calendar stayed on the error
  screen until it remounted. Since objectui#10572 the calendar re-reads on every
  data-invalidation event, so one failed background re-read was enough.
  
  The current run of the fetch now clears the error when it commits rows, on each
  of its commit branches: those rows answer the current query, so the earlier
  failure no longer describes the screen. This is the rule objectui#10578 set for
  `ObjectGantt`. The clear sits inside the run's existing `isMounted` guard, so a
  superseded run cannot clear the current run's error. The error is not cleared
  when a run starts; it stays until rows land.
  
  Rows a parent hands over through `data` clear it too, beside the row-ceiling
  reset that already sits there for the same reason: those rows are not the query
  that failed.
  
  A failed background re-read is still reported: the calendar has no silent mode,
  so it shows the error screen rather than keeping the last good events, and the
  next re-read that succeeds takes the screen back.
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
- 1659f14: The calendar's quick-create dialog now formats its date with the same locale as the month grid (objectui#10668).
  
  `ObjectCalendar`'s quick-create dialog used its `locale` prop as is. When no host passed one, that was
  `undefined`, so the dialog's date and time followed the machine's locale while the grid beside it
  followed the display locale. The dialog now uses the grid's rule: an explicit `locale` prop still wins,
  and otherwise the dialog reads `useDisplayLocale()`. With an English UI and a `de-CH` display locale,
  clicking 18 March now opens a dialog reading `On 18. März 2020`.
- 13220af: fix(plugin-calendar): `CalendarView`'s header date popover reads the same locale as its grids (objectui#10747)
  
  `CalendarView` formats its header and its month, week and day grids with one
  locale: an explicit `locale` (an `object-calendar` node's authored `locale`
  arrives this way), else the display locale. The header's date popover mounted
  `Calendar` with no locale, so it read the display locale even when the grids
  read another one. Under an `en-US` display locale with `locale: 'de-CH'`, the
  header read `März 2020` and the popover under it read `March 2020` over
  `Su Mo Tu …`.
  
  The popover now passes its grids' locale to `Calendar` as `localeTag`, so both
  faces read `März 2020`, and the popover's week starts on Monday. With no
  `locale`, both read the display locale, as before. This package takes no
  date-fns dependency: the tag is resolved inside `@object-ui/components`.
- c5ec15c: fix: every `Calendar` picker opens on its selected date's month, not today's (objectui#10799)
  
  react-day-picker opens on `month`, else `defaultMonth`, else today, and
  `selected` does not move it. Five `Calendar` mounts passed `selected` only, so
  a value outside the current month opened the picker on today's month: with
  the calendar on 4 March 2020 and today in September 2026, the header of
  `CalendarView` read `March 2020` while the popover under it opened on
  `September 2026`, with no selected day in view.
  
  Each mount now passes its first selected day as `defaultMonth`:
  
  - `CalendarView`'s header date popover (`@object-ui/plugin-calendar`) opens on
    the date the header names, and follows Previous / Next between opens;
  - `ui:calendar` opens on its day in `single` mode, on the first valid listed
    day in `multiple` mode (an entry that is not a date is skipped) and on `from`
    in `range` mode. It reads that month once, when it mounts: a value that
    changes afterwards does not move the month it shows;
  - the form date picker (`date-picker`) and `DatePicker` open on their value;
  - the dashboard date filter's custom-range calendar
    (`@object-ui/plugin-dashboard`) opens on the range's `from`.
  
  With no value, each still opens on today. react-day-picker throws on an
  invalid `defaultMonth`, so a day that names no instant is not passed as one: an
  unparseable `ui:calendar` day, a range `from` that does not parse, and an
  invalid `Date` a host hands `CalendarView` each open on today, as before. The
  two date pickers are unchanged in this respect: an invalid value already fails
  in their trigger's label, before any calendar mounts. The `Calendar` primitive
  itself is unchanged.
- 6650259: fix(plugin-calendar): a day event moved across a DST change writes the days it was dropped on (objectui#10866, slice 4)
  
  - **plugin-calendar.** At this change the month grid moved each date of an event by the milliseconds between two local midnights, the grabbed cell's and the drop cell's, and a date-only value is read at local midnight of its day. So when a DST change lay between one of an event's dates and where it landed, but not between the two cells (or the other way round), that date came back an hour off local midnight; at 23:00 of the day before, the write took the day before. Under `America/Los_Angeles` a span of `date` fields moved across November 1st or March 8th could be written a day short at its start or its end. A move of an event whose start, and end when it has one, are both stored calendar days now writes each `date` field as its stored day moved by the whole days the grid moved it. Every other write is unchanged: a `datetime` field still writes the instant the grid hands back, and at this change the grid's own arithmetic does not change.
  
    ⚠️ **Dated note, 2026-09-29 — the month grid now moves by calendar days — objectui#11005.** Later in this same release the month grid moves a value by the calendar days between the grabbed cell and the drop cell and keeps its time of day, for a move and for a drag of a span's end, so a 10:00 `datetime` stays at 10:00 across a DST change. A `date` value read at local midnight of its day then comes back at local midnight of the day it was dropped on, so the repair described above is removed and a moved `date` field is written as that local day, which is the same day the repair wrote. The rest of this entry is kept as the reading of this change; the objectui#11005 entry states what ships.
  - **plugin-gantt, types.** The business `timeZone` prose (`GanttConfig.timeZone`, `GanttViewProps.timeZone` and `makeTzShift`) said persisted data stays real instants. A `date` field under a zoned chart has been written as a calendar day since this card's first slice; at this change the prose says so, and says that near a DST change of the chart's zone or the viewer's the shim can place a day's midnight an hour early, onto the day before. Documentation only.
  
    ⚠️ **Dated note, 2026-09-29 — a zoned chart reads and writes a day exactly on a DST change — objectui#10866, slice 5.** Later in this same release `ObjectGantt` inverts the shim exactly for a date-only day, so a stored day is drawn from its own midnight and a drop writes the day it was dropped on, on a DST change of the chart's zone or the viewer's too. The `GanttConfig.timeZone` and `GanttViewProps.timeZone` prose no longer says a day can land on the day before, and `makeTzShift`'s says a day does not take the shim's round trip. The rest of this entry is kept as the reading of this change; the slice-5 entry states what ships.
  - **core.** The `DATEADD` / `DATEDIFF` / `DATEFORMAT` docblock names how a mixed `DATEDIFF`, one day and one instant, reads each argument when it counts months or years. Comment only.
- 4f8b7f8: fix(plugin-calendar,plugin-gantt): a stored date-only day shows on that day in every viewer zone, and a `date` field is written back as a calendar day (objectui#10866, slice 1)
  
  The calendar and the gantt read a record's `YYYY-MM-DD` value with the engine's own `Date` parse, which reads it as UTC midnight. West of UTC a task due on the 5th therefore showed on the 4th, in both views. Moving it then wrote `toISOString()` into the field: a UTC instant stored in a `Field.date`.
  
  - **Reads.** Every date-only read in the two plugins now goes through `toDisplayDate` from `@object-ui/core`, which reads the value at local midnight of the day it names. In the calendar these are the object calendar's event start and end, and the `calendar-view` node's events and its authored `currentDate`. In the gantt they are the task start, end and baselines, a marker authored as a day, and the day typed into the inline editor. A value with a time keeps its instant.
  - **Writes.** A calendar drop, a calendar quick-create and a gantt drag now write a field declared `date` as the local calendar day, `yyyy-MM-dd`. A `datetime` field keeps its instant. When no object schema is available to say which type a field is, the stored value's own shape decides, which is the same split the read makes; a calendar quick-create has no stored value, so there it still writes the instant.
  - **Gantt `timeZone`.** A chart with a business `timeZone` re-bases every instant into that zone. A date-only day is not re-based: its bar and its marker stand on that day of the chart's calendar for every viewer, and a drop writes the day of the chart's calendar that the bar was dropped on.
  - **Gantt working calendar.** `skipWeekends` / `holidays` now count the chart's own calendar days (local midnight, the same keys the day columns already folded by) rather than UTC days. The UTC floor put a rescheduled successor on the previous day in every zone except UTC once date-only values read as local days. `@object-ui/types` updates the `holidays` description to match.
  
  The timeline, charts, formula date functions and i18n helpers are later slices of objectui#10866.
- f9b6dfe: fix(plugin-calendar): a month-grid move keeps the wall-clock time across a DST change (objectui#11005)
  
  The month grid moved an event by the milliseconds between the grabbed cell's local midnight and the drop cell's. Across a DST change that span is 23 or 25 hours. Under `America/Los_Angeles`, a 10:00 event moved onto or off November 1st or March 8th landed at 09:00 or 11:00. A span starting at local midnight, grabbed on a later day and moved, started at 23:00 of the day before the one it was dropped on. The calendar's own month-view quick-create writes such local-midnight instants.
  
  - **Move.** The grid now counts the calendar days between the grabbed cell and the drop cell and moves the start and the end by that many days on the local calendar. Each keeps its hours, minutes, seconds and milliseconds, so a 10:00 event stays at 10:00 on the day it is dropped on, whatever DST change lies between. This deliberately changes the instant a drag writes into a `datetime` field; what a `datetime` field stores and how it is read are unchanged. In a zone without DST every day is 24 hours, so a move writes what it wrote before.
  - **Drag of a span's end.** The right-edge handle moves the end by calendar days the same way. It already kept the end's hours, minutes and seconds; it now keeps its milliseconds too.
  - **`date` fields.** A `date` value is read at local midnight of its day, so it now comes back at local midnight of the day it was dropped on, and `ObjectCalendar` writes that local day. The `ObjectCalendar` repair from objectui#10866, which moved a day event's stored day by the whole days the grid moved it, is removed: every day move it pinned writes the same day without it.
  - The week and day views are unchanged. Their time grid places a moved event at its snapped time on the drop day's own clock, not by a day delta.
- 2a1779f: fix(plugin-calendar): a week or day view move keeps the event's own length and grab point (objectui#11037)
  
  The week and day views draw an event that crosses midnight as one piece per day, clipped at midnight, and a short event as a piece at least 15 minutes tall. A move took its length and its grab offset from the grabbed piece. So a 22:00 to 02:00 event dragged by its first piece to 10:00 was handed to `onEventDrop` as 10:00 to 12:00, and `ObjectCalendar`'s default drop handler writes what it is handed. Grabbed by its second piece, the event's start went where its midnight had been grabbed. A 5-minute event came back 15 minutes long.
  
  - **Length.** A move now keeps the event's own `end - start`, as elapsed time, so a `datetime` event keeps its real length. On the night a DST change falls in, the wall clock shows that length an hour longer or shorter: a 4-hour event placed at 22:00 on the night the clocks fall back reads 22:00 to 01:00.
  - **Grab point.** The grabbed point's offset is measured from the event's own start, so the point under the pointer stays under the pointer. A 22:00 to 02:00 event grabbed at its own 00:00 and dropped at 10:00 is written 08:00 to 12:00.
  - **Crossing midnight.** An event that crosses midnight is placed where it is dropped, so it can stay overnight; before, it was held to end by midnight of the drop day. An event drawn wholly inside one day is still held inside the drop day, as before.
  - The drag preview is labelled with the whole event's times and drawn over the part of it that falls on the drop day.
  - An event with no end is still handed an end one hour after its new start. All-day and date-only events sit in the all-day row, which has no drag, so nothing about them changes. The month grid and the resize handles are unchanged.
- 3e71a98: fix(plugin-calendar): a week or day resize of an overnight event keeps its other edge (objectui#11060)
  
  The week and day views draw an event that crosses midnight as one piece per
  day, clipped at midnight, and a short event as a piece at least 15 minutes
  tall. The top resize handle sits on the event's first piece and the bottom
  handle on its last. A resize rebuilt both edges on the grabbed piece's day,
  the untouched one from that piece's clipped bound. So a 22:00 to 02:00 event
  resized by its top handle to 21:00 was written 21:00 to 00:00, losing the two
  hours past midnight, and resized by its bottom handle to 03:00 was written
  00:00 to 03:00, its start moved to midnight. A press and release on the top
  handle without moving cut the end to midnight too, and a 5-minute event resized
  by its top handle came back ending 15 minutes after its old start.
  
  The top handle now changes only the start and the bottom handle only the end.
  The other edge is the event's own instant, handed to `onEventDrop` unchanged.
  The dragged edge is placed as before, at the pointer's row on the grabbed
  piece's day, snapped, and held one slot away from the kept edge wherever that
  edge falls. The preview while dragging is labelled with the whole event's
  times. A same-day event resizes exactly as before.
- 0e6e76b: fix(plugin-gantt, plugin-calendar): the `objectName` input description names the `dataSource.object` binding (objectui#11117)
  
  The designer-facing `objectName` input on `object-gantt` and `object-calendar` (and
  `view:calendar`, which shares the calendar's list) said the block's schema refuses a block that
  declares none of `data`, `staticData` and `objectName`. Since objectui#11117 the schema also
  accepts a block whose `dataSource.object` names the object, because the registration's
  `ElementDataSourceGate` lands that name on `objectName` before the renderer reads the node. The
  sentence now says so. No input's name, type, `required` flag or shape changed. (`object-map`'s
  input already names the binding: objectui#10859 batch 5 rewrote it.)
  
  The `plugin-gantt` and `plugin-kanban` READMEs carry the same correction.
- 6cd5ae3: The `object-calendar` / `calendar` `navigation` input description said `openNewTab: true` "outranks the mode". That does not hold for `none`: `useNavigationOverlay` checks `mode === 'none'` before `openNewTab`, so `{ mode: 'none', openNewTab: true }` opens nothing. The description in `src/index.tsx` now says `openNewTab` outranks every mode except `none` (objectui#11168 slice 5, from objectui#8652).
  
  `src/__tests__/calendarNavigationMembers-8652.test.tsx` pins both halves: `openNewTab` beside each overlay mode opens a new tab and no overlay, and beside `none` it opens nothing. Behaviour is unchanged.
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
- 3e853c9: Let a producer-marked refusal reach the drag-write surfaces (objectui#5902).
  
  The kanban card-move toast, the calendar drag-to-reschedule toast and the OCC
  conflict dialog each substituted a generic string for a refusal the producer had
  marked as user-facing (`userMessage`), so a user was told "Save failed" where the
  application author had written a sentence addressed to them. All three now read
  the marking through the shared `declaredUserMessage` reader, which covers both
  places the adapter boundary parks it — the typed member on
  `ConcurrentUpdateError` and the details bag on `DataApiValidationError`.
  
  Nothing unmarked changes: the reader answers `null` for it, so every existing
  generic substitution — including the localized "not authorized" message that
  keeps raw server diagnostics away from end users — still governs unmarked
  refusals exactly as before.
  
  The two toasts substitute; the conflict dialog augments. Its description also
  explains what the destructive "Overwrite" button does, which is affordance copy
  that surface owns rather than a refusal message, so the marking leads and that
  paragraph stays.
- 7975f2d: A standalone `object-calendar` bound to an object now queries WITH its `$expand`, so
  lookup / master_detail / user / tree fields render the related record instead of a raw
  foreign-key id (objectui#6453).
  
  `ObjectCalendar`'s fetch effect built its expand set from a ref assigned in the render body
  (`objectSchemaRef.current = objectSchema`) and left `objectSchema` out of its dependency
  list. That bought the effect exactly one run per mount and paid for it with the expansion,
  permanently: on that one run the ref was still `null`, `buildExpandFields` saw no fields,
  the query went out with no `$expand` at all, and nothing re-ran the effect when the schema
  landed. Only the standalone calendar reached this path — one hosted by `ObjectView` or
  `ListView` receives its rows as `data`, which objectui#6419 already covers.
  
  The ref is replaced by a settled-and-keyed resolution (`{ key, def } | null`) that GATES the
  record query, the third member of the family after objectui#6271 (`ObjectKanban`) and
  objectui#6419 (`ObjectView`). Measured on this component rather than inherited: gated, the
  calendar issues one query carrying `$expand` in every latency profile; the alternative of
  adding `objectSchema` to the dependency list issued two, and when the schema read was the
  slower of the two it painted raw ids, reverted to the "Loading calendar..." placeholder,
  then swapped — a three-step paint the correct rows do not arrive any later than.
  
  The gate is on the schema read having SETTLED, never on a truthy schema: an adapter that
  exposes no `getObjectSchema`, and a read that throws, both settle with nothing and the
  calendar still queries (unexpanded) rather than waiting forever. An inline `value` data set
  is deliberately not gated — it issues no metadata read, so there would be no resolution to
  wait for.
- f9653ae: Re-key the load-bearing fetch effects in `ObjectMap`, `ObjectCalendar` and
  `ObjectGantt` onto the primitive fields they actually read off `dataConfig`
  (`provider` / `object` / `items`) instead of the whole memoised `dataConfig`
  object (objectui#6592, the deferred half of objectui#6270/PR #6591).
  `ObjectTree` is a census member too but is deferred out of this change — see
  the PR body — because its own fetch effects are the surface of PR #6696
  (objectui#6481), open at the same time.
  
  `useMemo` carries no semantic guarantee — React is permitted to discard a
  memo cache and recompute even when its dependency array compares equal to
  the previous render, and the local `getDataConfig(schema)` helper each of
  these renderers carries builds a fresh `{ provider, object }` /
  `{ provider, items }` wrapper object on every call. So a fetch effect keyed
  on `dataConfig` itself was correct only for as long as that identity
  happened to survive a discard: a recompute alone (no author or caller
  action) was enough to re-run the effect and issue an extra
  `dataSource.find` / `dataSource.getObjectSchema` call. Keying the effects
  on the primitives instead makes a cache discard a no-op, restoring
  `useMemo` to a pure optimisation.
  
  `ObjectGantt`'s `effectiveDataSource` memo deliberately keeps `dataConfig`
  as a dependency (`resolveDataSource` needs the whole provider-shaped
  value — the `api` provider's `read`/`write` request config cannot be
  flattened to a fixed primitive list the way `object`/`value` can), so its
  `reload()` fetch is decoupled from the redundant direct `dataConfig`
  dependency but not from `effectiveDataSource`'s own; for the `object`/`value`
  providers `resolveDataSource` returns its `fallback`/a fresh
  `ValueDataSource` respectively rather than reading further into the config,
  which is enough for the two fetch effects to observe no extra call under a
  recomputed-but-equivalent `dataConfig` in the common case.
  
  No behaviour change for a schema whose `useMemo` caches survive normally;
  the effects are unaffected by React discarding one.
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
- 6411def: FLS-gate the `$expand` projection at the five remaining build sites (objectui#7230).
  
  objectui#7215 / PR #7229 gated `$expand` at the two projection sites in its scope
  (`ObjectGrid`, `ListView`). The helper is reached from more places than that. This
  closes the five that were left: `ObjectCalendar`, `ObjectGantt`, `RecordDetailView`,
  `DetailView`, and `ObjectDataTable` (which builds its own whitelist in
  `computeLookupExpand` rather than calling `buildExpandFields`).
  
  **Three of them pass no column list at all**, which makes them the sharp ones:
  `buildExpandFields` reads an absent column list as "no column restriction" and falls
  back to **every declared relation on the object**, denied ones included. So a standalone
  calendar, a gantt, and every record page in the console asked the server to resolve the
  object's full relation set by default rather than by configuration.
  
  **`DetailView` was input-gated, and that is the defect rather than the fix.** Its column
  list is already FLS-filtered field by field, which is exactly the route PR #7229 measured
  as unsound: an emptied column list reads as "no column restriction", so a detail view
  whose authored fields are all denied had its `$expand` **widened** from the relations it
  asked for to every relation the object declares. The principal who may read least was
  asking for the most.
  
  **Reproduced before it was fixed**, as a failing test per site.
  
  **Grading, measured rather than assumed.** Against ObjectStack's own server this is
  defence-in-depth, exactly as objectui#6898 and #7215 are: `plugin-security`'s
  `FieldMasker.maskRecord` deletes every unreadable key from each returned row and
  objectql's expand path writes the resolved record back under that same key, so one
  statement removes the expanded object and the bare id alike; the expansion sub-read is
  itself gated (`__expandRead` takes the referenced object's full CRUD + RLS + FLS
  treatment). It is load-bearing for any backend that does not strip, and the
  client-request side is real regardless.
  
  **Nothing a permitted view did stops working.** The gate judges each helper's OUTPUT,
  which contains only the object's declared reference-bearing fields, so the "`checkField`
  answers false for an undeclared key" trap cannot be reached and derived / host-joined
  columns are untouched. An unanswered permission policy filters nothing. Neither
  `buildExpandFields` nor `computeLookupExpand` is changed.
- e75f4c9: `colorField` now means the same thing in the gantt, the calendar and the timeline
  (objectui#7243).
  
  **The inversion this fixes.** `gantt.colorField` is documented as "field that drives the
  bar color", and the renderer passed the stored value straight into the bar's
  `backgroundColor`. Pointing the key at a select field therefore emitted
  `backgroundColor: "open"` — not a colour, so the browser dropped the declaration and
  every bar rendered identically. OMITTING the key was strictly better: the absent-key
  branch derived a real colour per status. Declaring the documented key was worse than not
  declaring it, with no error, warning or console message either way.
  
  The same key also meant three different things across the three lenses: the timeline
  resolved the field's authored option `color`, the calendar hashed the raw value onto a
  fixed palette, and the gantt emitted the raw value. An author colouring three views by
  one field got three unrelated results, one of which was no colour at all.
  
  **The ladder.** `@object-ui/core` gains `createFieldColorResolver` — the timeline's
  resolver, lifted so all three call it:
  
  1. the field's own option `color` for the record's value;
  2. else the value itself when it already IS a colour literal (`#rgb`, `#rrggbb`,
     `#rrggbbaa`, `rgb(...)`, `hsl(...)`);
  3. else each renderer's own last rung, which is deliberately NOT shared — the gantt
     derives a semantic-token hex (a bar must be painted), the calendar keeps its
     theme-aware 8-stop hash (a soft tint, not a solid fill), the timeline draws its
     default marker.
  
  **What changes for authors.** A gantt or calendar whose `colorField` points at a select
  field with authored option colours now paints those colours. A gantt value that is
  neither an option colour nor a colour literal now derives a colour instead of emitting
  an invalid CSS value — including a palette NAME (`red`), which now resolves to that
  palette's hex, the behaviour the key's own contract has always promised ("hex or
  semantic name") and the one `borderColorField` already had. `gantt.borderColorField`
  takes rung 1 as well, so an authored option colour reaches the alert stroke; it keeps
  today's behaviour otherwise and deliberately gains no derivation rung, since the stroke
  is opt-in and deriving one for every record would draw an alert on records that have
  none.
  
  Calendars whose `colorField` points at a plain categorical field are unchanged: that
  value still reaches `CalendarView`'s deterministic hash exactly as before. The timeline
  is unchanged apart from accepting the 8-digit `#rrggbbaa` hex spelling the calendar
  already accepted.
- b8fc1e2: fix(plugin-calendar): the all-day lane header reads the same string with or without an I18nProvider
  
  `CalendarView`'s `DEFAULT_TRANSLATIONS` table — the `defaults` map behind its
  `createSafeTranslation` factory — spelled `calendar.allDay` as `all-day`, while
  all ten locale packs carry the key and `en` spells it `All Day`. Since
  `createSafeTranslation` serves that table only when no `I18nProvider` is
  mounted, the same lane header rendered `all-day` in a standalone embed and
  `All Day` inside the console. The table now matches the pack, so both paths
  render one string.
  
  The table entry was the only one of the seven that disagreed with its `en`
  value, and the packs predate it by three months — the drift was an oversight,
  not a compact spelling chosen for the 56px gutter (both strings are seven
  characters wide).
  
  Also removes the dead `t('calendar.allDay') === 'calendar.allDay'` ternary that
  guarded the lane header: the factory's provider-less arm returns `defaults[key]`
  before it could ever return the bare key, and with a provider the merged
  resources always carry `calendar.allDay`, so its lowercase branch was
  unreachable from either side.
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
- ce2aaef: One shared record-source ladder, five plugins delegate.
  
  `@object-ui/core` publishes `resolveRecordSourceConfig(schema)` — the ONE implementation
  of the ruled three-rung record source ladder: `data` first, then `staticData` wrapped as
  `{ provider: 'value', items }`, then `objectName` folded to `{ provider: 'object' }`, and
  `null` when nothing is bound. It is the PRODUCER whose output the reader
  `resolveRecordSourceObjectName` (`b041b9c0c`) consumes, and it now sits beside it in the same module.
  
  That ladder is published contract on both faces — `packages/types/src/objectql.ts` and its
  zod mirror both ship `.describe()` strings naming `getDataConfig`'s order (`77cb489b4`,
  maintainer ruling 2026-09-02), pinned by `objectql-record-source-refinement-6939.test.ts` —
  and it was hand-copied into five plugin components with no gate holding them together. A
  change to the ruled order had five edit sites and nothing that noticed a missed one; that
  is the AGENTS.md #0.1 drift class.
  
  **No behaviour changes.** `ObjectCalendar`, `ObjectGantt` and `ObjectTree` now call the
  shared reader directly. `ObjectGrid` and `ObjectMap` keep their own bare-array `data`
  shorthand as a documented head above the shared call and are otherwise unchanged.
  `record-source-config.behaviourNeutrality-7632.test.ts` transcribes all five pre-collapse
  bodies verbatim and asserts the post-collapse spelling agrees with each across the whole
  input matrix, so a later edit to the shared reader that moves any site turns red.
  
  **Two divergences were measured rather than assumed, and both are preserved.**
  
  `ObjectCalendar`'s `'data' in schema && schema.data` guards existed because its parameter was
  at that time the union `ObjectGridSchema | CalendarSchema`, whose `CalendarSchema` arm declared
  neither key. (objectui#8651 has since re-pointed that parameter at the published
  `ObjectCalendarSchema`, so the union is gone; the CONCLUSION below — that the guard had no
  runtime effect and removing it is behaviour-neutral — is unaffected.)
  That is a TypeScript narrowing device with no runtime effect — an absent property reads
  `undefined`, falsy either way — so the guard could never change which rung is taken. The
  shared reader's optional-property parameter accepts the union directly, and the
  equivalence is pinned on a fixture that really lacks both keys rather than argued.
  
  `ObjectGrid` and `ObjectMap` normalize a bare-array `data` to `{ provider: 'value', items }`;
  `ObjectCalendar`, `ObjectGantt` and `ObjectTree` do not, and return the array verbatim. That
  is a real divergence on off-contract input — `ViewData` is a discriminated union over object
  variants, so an array under `data` cannot be published. It is NOT unified here: the shared
  rung stays contract-strict and the two sites keep the head locally, the same way `b041b9c0c`
  left the off-contract `{ provider: 'object' }` tails at their sites. Both sides of the fork are
  pinned, so neither folding the head in nor deleting it as redundant can happen silently.
  
  `ObjectTree`'s copy took `schema: any`; it now goes through the shared reader's typed
  parameter. Types are erased at runtime, so nothing it resolves moves.
- 2ce2612: A record-page URL now names the object the clicked rows actually came from, in
  `ObjectTree` and `ObjectCalendar`.
  
  `useNavigationOverlay` builds `/{objectName}/record/{id}` out of whatever it is handed,
  and both components handed it the bare top-level `schema.objectName` while resolving
  their own rows through the ruled record-source ladder (`data`, then
  `staticData`, then `objectName`). `77cb489b4` published `objectName` as that ladder's
  THIRD RUNG and not as a parallel "page object" concept, so a block has exactly one
  record source — and a row fetched through `data.object` whose click built
  `/{schema.objectName}/record/{id}` named a record that the URL's own object does not
  contain.
  
  Two shapes change, both toward the object the rows came from:
  
  - a block carrying **both** bindings navigated to the top-level key and now navigates to
    `data.object`;
  - a **data-only** block had no name to build a URL from at all, so the hook took its
    `/{id}` leg — an unrouted path that paints a blank page — and now builds the routed
    record URL.
  
  `ObjectCalendar` is where the divergence was plainest: on one click it resolved the
  detail drawer through the ladder and the navigation URL through the top-level key. The
  URL now reuses the very `schemaObjectName` that already keys the calendar's record query
  and its `$expand` derivation, so query, drawer and URL agree by construction.
  
  **Nothing else moves.** Both converted sites keep a site-local `?? schema.objectName`
  tail for the off-contract `data: { provider: 'object' }` that carries no `object`
  (`ViewDataSchema` declares it required) — the same tail `ObjectTree`'s `headerObjectName`
  already carries, and the same conservatism `b041b9c0c` applied when it published the
  shared reader. `useNavigationOverlay`'s own signature is unchanged: it still takes an
  `objectName`, and only what callers hand it has changed.
  
  The hook's `@example` stops prescribing `objectName: schema.objectName`. That prose is
  why there were copies to convert at all — component authors copied the divergence out of
  the documentation, correctly, as written — so it now points at
  `resolveRecordSourceObjectName` and says explicitly that a caller with no data config
  has nothing above rung three and should keep passing `schema.objectName`.
  
  `ObjectKanban` is deliberately **not** converted: it has no data config, no
  `getDataConfig`, and its `data` is a raw row array rather than a `ViewData` binding, so
  `schema.objectName` already IS its record source and its board, drawer and URL already
  agree.
- 5e5d6b2: `ObjectCalendar`'s refusal screen now states a remedy an author can act on, on every
  door it is reachable from (objectui#8170).
  
  It used to read "Calendar configuration required. Please specify startDateField and
  titleField." The first clause was right and is unchanged. The second was wrong twice:
  
  **It demanded an optional key.** `@objectstack/spec`'s `CalendarConfigSchema` is a
  strict object whose ONE required key is `startDateField`. Re-measured on the installed
  17.4.0, three legs via `CalendarConfigSchema.safeParse` from `@objectstack/spec/ui`:
  `{}` and `{ titleField: 't' }` both fail `invalid_type` at `startDateField`, and
  `{ startDateField: 'd' }` parses clean. The spec's own note on that schema names this
  renderer as the reason — `resolveTitle` takes an explicit `titleField` when present and
  otherwise resolves through the ADR-0079 record display-name chain, so the screen was
  asking for a key the component neither needs nor reads.
  
  **It named keys without saying where they go, which is unactionable on an interface
  page.** That surface's `interfaceConfig` has no calendar slot at all — it reads
  `columns`, `sort`, `filterBy`, `userFilters`, `appearance`, `addRecord`, `userActions`,
  `showRecordCount`, `source`, `sourceView`, `buttons` and `recordAction`, and no calendar
  key — so the only lever there is `sourceView`, which the screen never mentioned. The
  refusal was honest about the binding and dishonest about the remedy.
  
  The new copy names the one required key, says the title resolves without `titleField`,
  points at the view's `calendar` block as the place both doors read the binding from, and
  states the interface page's indirection outright.
  
  **Why the wording is door-COMPLETE rather than door-AWARE.** Two producers emit an
  `object-calendar` node — the calendar branches of `plugin-list`'s `ListView` and
  `plugin-view`'s `ObjectView` — and app-shell reaches the first from both its `ObjectView`
  (object-view door) and `InterfaceListPage` (interface-page door). Every one of them hands
  the component the same shared `baseProps` bag plus whichever declared binding keys exist:
  nothing on the node names the door. A door-aware screen therefore needs a newly declared
  prop threaded through four packages, and inferring the door from whether the object
  carries a date field only correlates with it — `InterfaceListPage`'s deriver runs solely
  when `calendar` is whitelisted in `appearance.allowedVisualizations` — which is the
  "the gate and the seam must answer one question" failure this repo has recorded on `map`,
  `chart` and `kanban` already.
  
  The first clause is unchanged on purpose: five suites pin this screen with
  `/Calendar configuration required/i`, and `@object-ui/types`' calendar alias tombstones
  assert on the same phrase. Only the clause that was wrong moves. The new second clause is
  pinned in `ObjectCalendar.refusalRemedy-8170.test.tsx`, together with the runtime control
  that makes its claim checkable: a calendar with a date binding and no `titleField` renders
  real record titles.
- 2d80456: `object-kanban` / `view:kanban` and `object-calendar` / `view:calendar` now DECLARE seven
  spec-carried keys their renderers already honoured, so the html tier stops reporting working
  metadata as `unknown-prop` (objectui#8201, the backlog objectui#8176 exposed).
  
  Board: `groupBy`, `cardTitle`, `titleField`, `swimlaneField`, `coverImageField`.
  Calendar: `defaultView` (the spec's three-member enum) and `locale`.
  
  No renderer behaviour changes — every one of these keys was already read and already acted on;
  what changes is that authoring tools can now discover them and the save gate agrees with the
  validator. Both tags of each block now spread ONE shared `inputs` list, so the two published
  surfaces cannot drift apart by hand-copy.
- 289d146: `object-calendar` / `view:calendar` now DECLARE the last three spec-carried keys the renderer
  already honoured — `data`, `staticData` and `loading` — so the html tier stops reporting working
  metadata as `unknown-prop`. Each declared description names the POSITION the key is honoured at:
  `data` replaces the calendar's own query, `staticData` is read below `data` and above `objectName`,
  and `loading` is honoured only alongside an array `data` (objectui#8314, slice 2b of
  objectui#8201). Every `object-calendar` key the spec declares is now discoverable.
- 5058336: `object-calendar` is taught with its `calendar` block, not with flat field-name keys (objectstack-ai/objectui#8831).
  
  `@objectstack/spec` refuses `startDateField`, `endDateField`, `titleField`, `colorField` and `allDayField` written flat on an `object-calendar` node, and its diagnostic prescribes `calendar: { startDateField, endDateField, titleField, colorField, allDayField }`. Since 17.5.0 the spec's `CalendarConfigSchema` declares all five, `allDayField` included. objectui's published faces still taught the flat spelling as something to write, so an author who followed them was refused at publish.
  
  - `@object-ui/plugin-calendar`: both `object-calendar` examples in the README write the five keys inside `calendar`, and the README says what the flat spelling is: the runtime handoff `ObjectView` and `ListView` emit, which `getCalendarConfig` reads only when the node has no `calendar` block. The five-key sentence for `calendar-view` stays and now says it is about that element: `CalendarViewSchema` has no `calendar` block, so the flat keys are its only spelling.
  - `@object-ui/types`: the `.describe()` text and the TypeScript docblocks of `ObjectCalendarSchema`'s five flat members call them the read-only handoff and point at `calendar.KEY`. The `calendar` member's text calls the block the authored spelling. The `allDayField` member of the `calendar` block no longer calls the key objectui-local, because 17.5.0 declares it.
  
  Descriptions and documentation only. No accept set moves: the flat members stay declared on both faces, with the same types, because the renderer still reads them.
- 708f271: fix(plugin-calendar): the month gridcell's accessible name follows the resolved locale
  
  `MonthView`'s day gridcell built its `aria-label` with
  `toLocaleDateString("default", …)` — the literal `"default"` means the *machine's*
  locale — while the weekday column headers one row above were already formatted with
  the component's resolved `locale`. A screen-reader user on a non-`en` session
  therefore heard the column headers in their own language and every date in whatever
  locale the runtime happened to be set to.
  
  Both branches of that label (with events and without) now use the same resolved
  `locale` the headers use. No locale pack, key or translation is involved — this is
  which tag the `Intl` call is handed.
- 76ae729: `README.md`'s "Schema API / CalendarView" block described a `CalendarViewSchema`
  that does not exist. Measured against the interface itself
  (`packages/types/src/complex.ts`) and its zod mirror: `events` — the schema's
  only required key besides `type` — was published as `events?`, so a reader
  following the README omits it and TypeScript rejects the node; `defaultDate` was
  `string` where the schema says `string | Date`; and `onDateClick` was listed as a
  schema key when it is a `CalendarViewProps` **component** prop, sending readers
  to a different package's surface for a key `calendar-view` does not have (the
  schema's key is `onDateChange`). The block also listed 6 of the schema's 13 keys
  with nothing saying it was a summary (objectui#5045).
  
  The block now carries the requiredness the schema declares, names itself a
  partial summary of `CalendarViewSchema`, and adds the author-facing
  `defaultView` / `view` / `views` / `editable` / `date`. It also states plainly
  what the registered `calendar-view` renderer actually reads — it builds events
  from the node's `data` array and drops an authored `events` key (objectui#4433) —
  so the corrected requiredness does not itself become a new wrong instruction.
  
  This is a documentation fix to a file `plugin-calendar` publishes to npm, which
  is why it carries a version: the npm landing page only picks up the correction
  on a release. No behaviour, export, type, or `dist` byte changes. The pin test
  added alongside it publishes nothing.
- bc5870c: fix(plugin-calendar): a record with no date is no longer placed on today
  
  `ObjectCalendar` mapped a record whose declared `startDateField` carried no
  value to `new Date()` — the current moment — so it rendered on today's cell as
  an ordinary event, indistinguishable from a real one. The `isNaN` guard six
  lines below could not catch it by construction: a no-argument `new Date()` is
  always valid, so the absent-value case became a well-formed lie *before* the
  check that would have caught it.
  
  The fabricating arm is deleted. Such records now leave the grid entirely and
  appear in a collapsed "Unscheduled (N)" area below the calendar — a visible
  count and an expandable list, with no invented date and no scheduling UI. The
  `isNaN` filter keeps its original job for values that are present but
  unparseable: absent and malformed stay two distinguishable outcomes.
  `allDay: !endDate` now applies only to records that have a start, so a record
  with no dates at all is unscheduled rather than silently all-day; a record with
  a start and no end still renders all-day exactly as before.
  
  Adds `calendar.unscheduled` to all ten locale packs.
- f47d94c: `@object-ui/plugin-calendar` now exports the `CalendarView` component's runtime event
  type as **`CalendarViewEvent`**, and keeps `CalendarEvent` as a **`@deprecated` alias**
  of it. **Non-breaking:** the alias is a working re-export denoting the same type, so
  code importing `CalendarEvent` from this package keeps compiling unchanged — nothing is
  removed and no behaviour changes.
  
  Why: `@object-ui/types` exports its own `CalendarEvent`, the AUTHORING event
  (`id: string`, `start` / `end` accept ISO strings with `end` required, plus
  `description`), while this package's was the runtime event (`id: string | number`,
  `start: Date`, `end?: Date`). Neither is assignable to the other, and IDE auto-import
  chose between the two identical names essentially at random — the wrong pick surfaced as
  a remote `TS2322` about `Date` rather than as a wrong import, which is how this package's
  own README example stayed uncompilable through an earlier import-path fix. The authoring
  type keeps the canonical `CalendarEvent` name; the runtime type gets the self-describing
  one (objectui#5044, following the `ObjectCalendarProps` -> `ObjectCalendarComponentProps`
  rename in objectui#4650).
  
  Write `CalendarViewEvent` in new code.
- 065bba7: `CalendarViewSchema` (TS interface and zod mirror) converges on the registered
  `calendar-view` renderer's measured read set (objectui#5667, maintainer ruling
  option A — the renderer is authoritative).
  
  **Breaking for consumers of the published type** (deliberate; per-repo policy
  breaking changes ship as `minor` — the fixed group's `major` tracks
  `@objectstack`):
  
  - Nine inert keys are retired: `events` (the interface's only required key,
    which the renderer deliberately drops — objectui#4433), `defaultView`,
    `defaultDate`, `date`, `views`, `editable`, `onEventCreate`,
    `onEventUpdate`, `onDateChange`. None had a read site on the authored-node
    path and no measured app authors them (ADR-0049 enforce-or-remove).
  - The type now declares what the renderer actually reads: `data`, `titleField`,
    `startDateField`, `endDateField`, `allDayField`, `colorField`, `view`,
    `currentDate`, `allowCreate`, `className`, plus the two host-only function
    hatches it forwards (`onEventClick`, `onViewChange`).
  - Practical radius, measured: `BaseSchema` carries an index signature and the
    zod `BaseSchema` is `.passthrough()`, so nodes still authoring retired keys
    neither fail to compile nor get rejected at validation — they are simply no
    longer declared, documented, or type-checked. The material accept change is
    that zod no longer **requires** `events`: a `{ "type": "calendar-view" }`
    node without it now validates (previously the one key validation demanded
    was the one key guaranteed to do nothing).
  
  Runtime renderer behaviour is unchanged. `@object-ui/plugin-calendar`'s README
  and `content/docs/api/schema-reference.md` are repaired to the converged
  surface in the same change, so no copy of the old contradiction survives.
- f760064: Localize every accessible name `CalendarView` authors itself.
  
  The component hard-coded the accessible names of its own landmarks and controls
  in English, so no locale pack could reach them. A screen-reader user on a
  translated console heard "Calendar" and "Calendar grid" — the only names those
  two landmarks have — plus the toolbar buttons and both resize grips, in English,
  while every sighted string beside them was translated.
  
  All of them now resolve through the `createSafeTranslation` hook the component
  already used for its visible copy, and the keys land in all ten locale packs
  under `calendar.a11y`. Two of the repaired strings were English frames wrapped
  around already-localized data (the current-date button and the day gridcell's
  event count); those are now pack-owned sentences whose translations can put the
  date and the count where each language's grammar wants them, and the gridcell's
  count is a plural family with a base key so the categories a pack does not
  enumerate resolve in its own language rather than falling through to English.
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
- Updated dependencies [cd2cb41]
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [a507334]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [afb2284]
- Updated dependencies [3ac2de8]
- Updated dependencies [0aacecc]
- Updated dependencies [28b0658]
- Updated dependencies [63f4f92]
- Updated dependencies [777fca2]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [588380d]
- Updated dependencies [8cedb0d]
- Updated dependencies [6ce001a]
- Updated dependencies [162621b]
- Updated dependencies [b06c3de]
- Updated dependencies [0d379f5]
- Updated dependencies [4c6f549]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [879ecac]
- Updated dependencies [c2dabf0]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e686f4d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [fa5fbd9]
- Updated dependencies [5f44cc6]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
- Updated dependencies [fd6f5da]
- Updated dependencies [bb5d4ee]
- Updated dependencies [dc666f7]
- Updated dependencies [3335767]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
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
- Updated dependencies [cc4366d]
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
- Updated dependencies [45362a3]
- Updated dependencies [2a943bf]
- Updated dependencies [d999617]
- Updated dependencies [93a689d]
- Updated dependencies [4357a27]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [8740e86]
- Updated dependencies [d22b37b]
- Updated dependencies [9cbe4db]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [ac2d6f1]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [02e6d36]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [8848ce4]
- Updated dependencies [f905090]
- Updated dependencies [9c78ebe]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [93a5585]
- Updated dependencies [5ad3b88]
- Updated dependencies [21eb61a]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [41ae65b]
- Updated dependencies [184cfe1]
- Updated dependencies [baac95a]
- Updated dependencies [13220af]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [c5ec15c]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [285e36b]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
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
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [4b742f4]
- Updated dependencies [42687ba]
- Updated dependencies [6cd8f66]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [27ae632]
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
- Updated dependencies [62d6f56]
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
- Updated dependencies [3f61eef]
- Updated dependencies [c27b575]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [385ebc5]
- Updated dependencies [858eafb]
- Updated dependencies [a8c5509]
- Updated dependencies [c2a8d23]
- Updated dependencies [f4ed238]
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
- Updated dependencies [e420df3]
- Updated dependencies [7fed09d]
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
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [b34cc14]
- Updated dependencies [ab18797]
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
- Updated dependencies [f66072d]
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
- Updated dependencies [1117414]
- Updated dependencies [6d63cd0]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [7c96c94]
- Updated dependencies [4da5109]
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
- Updated dependencies [63d54dd]
- Updated dependencies [7e19d03]
- Updated dependencies [b08b7eb]
- Updated dependencies [1e946c9]
- Updated dependencies [546ddf7]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [44d075b]
- Updated dependencies [40c479a]
- Updated dependencies [b4393e5]
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
- Updated dependencies [d3005f7]
- Updated dependencies [1e7fe0a]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [06b82b8]
- Updated dependencies [8ec11e1]
- Updated dependencies [6f81384]
- Updated dependencies [22ba927]
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
- Updated dependencies [3777538]
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
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
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
- Updated dependencies [a439e16]
- Updated dependencies [67fc3b0]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [9409eb9]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [c18d099]
- Updated dependencies [adb2a86]
- Updated dependencies [03380aa]
- Updated dependencies [4562ea5]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [320374d]
- Updated dependencies [b0d308d]
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
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [c4326fe]
- Updated dependencies [4dfdcc3]
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [220c18d]
- Updated dependencies [eeb6c2f]
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
- Updated dependencies [854cba3]
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
- Updated dependencies [a338037]
- Updated dependencies [0348bc9]
- Updated dependencies [e8c553b]
- Updated dependencies [2e32ed4]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [a4514e8]
- Updated dependencies [6411def]
- Updated dependencies [db3896c]
- Updated dependencies [b9f5ff1]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [4704aa4]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [63a8828]
- Updated dependencies [b61d7d8]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [dc0a60b]
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
- Updated dependencies [02fe257]
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
- Updated dependencies [fe8f451]
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
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [592402e]
- Updated dependencies [ad852b6]
- Updated dependencies [6778809]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [0758bd8]
- Updated dependencies [ee4d19f]
- Updated dependencies [37149ec]
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
- Updated dependencies [e2feb13]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [9dcc545]
- Updated dependencies [d7fecfb]
- Updated dependencies [c13d39e]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [309728c]
- Updated dependencies [e6ec217]
- Updated dependencies [aa08d7e]
- Updated dependencies [3a43a15]
- Updated dependencies [868e825]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [7cf6f38]
- Updated dependencies [fd9c50a]
- Updated dependencies [421544b]
- Updated dependencies [5cc8c28]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [40a7c53]
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
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [0a174f3]
- Updated dependencies [cc00c59]
- Updated dependencies [676f677]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [ab77513]
- Updated dependencies [55ba3ff]
- Updated dependencies [0b138da]
- Updated dependencies [f1190b0]
- Updated dependencies [561abef]
- Updated dependencies [ef52001]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [6df26f0]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [e36acd4]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [16a1a51]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [152f0a7]
- Updated dependencies [8693b85]
- Updated dependencies [e82dad1]
- Updated dependencies [58b7b3d]
- Updated dependencies [e77a003]
- Updated dependencies [84defab]
- Updated dependencies [681d3f1]
- Updated dependencies [969d4f2]
- Updated dependencies [88561fd]
- Updated dependencies [f3bc481]
- Updated dependencies [b79aac2]
- Updated dependencies [93fc0e7]
- Updated dependencies [0601af1]
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
- Updated dependencies [9f5c017]
- Updated dependencies [c271413]
- Updated dependencies [279e48e]
- Updated dependencies [4784bb3]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [689953a]
- Updated dependencies [30443fb]
- Updated dependencies [8d3dbb2]
- Updated dependencies [efc1c9c]
- Updated dependencies [7d6439c]
- Updated dependencies [da45e6b]
- Updated dependencies [7533465]
- Updated dependencies [835f0f3]
- Updated dependencies [6d5db7b]
- Updated dependencies [a9d97be]
- Updated dependencies [ed35b44]
- Updated dependencies [e6040ef]
- Updated dependencies [9ba7e9c]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [345e24a]
- Updated dependencies [3bc1bb4]
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
- Updated dependencies [502eb58]
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
- Updated dependencies [ba0b61a]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [697aabc]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [80a0ecd]
- Updated dependencies [43c0d17]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [462bafb]
- Updated dependencies [1779e8d]
- Updated dependencies [f7fcc2c]
- Updated dependencies [f0f4d6c]
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
- Updated dependencies [0ee6e31]
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [d0f52e4]
- Updated dependencies [e708426]
- Updated dependencies [33e1697]
- Updated dependencies [3b6d53b]
- Updated dependencies [a017617]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [741864f]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [dc49246]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [ff0c384]
- Updated dependencies [af4fb29]
- Updated dependencies [c698a81]
- Updated dependencies [ff5ef1c]
- Updated dependencies [befd40c]
- Updated dependencies [905913c]
- Updated dependencies [9a97800]
- Updated dependencies [6358a2d]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [3c76801]
- Updated dependencies [d06fba8]
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
- Updated dependencies [b655a9d]
- Updated dependencies [3e01cb5]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [6a576c9]
- Updated dependencies [0b12a33]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [fffa30d]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
- Updated dependencies [6c1b105]
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
- Updated dependencies [7e50e84]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [1e66879]
- Updated dependencies [c5200f0]
- Updated dependencies [af3861f]
- Updated dependencies [2a79e84]
- Updated dependencies [2609812]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [4f14ad7]
- Updated dependencies [258d264]
- Updated dependencies [cac64b3]
- Updated dependencies [17fbbaf]
- Updated dependencies [d8cf1cb]
- Updated dependencies [0d1e702]
- Updated dependencies [b03ba3a]
- Updated dependencies [0068348]
- Updated dependencies [641543f]
- Updated dependencies [8a44390]
- Updated dependencies [8033ad1]
- Updated dependencies [fa140b8]
- Updated dependencies [71cba28]
- Updated dependencies [190fbd0]
- Updated dependencies [c00bf28]
- Updated dependencies [23705b7]
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
  - @object-ui/plugin-detail@17.7.0
  - @object-ui/react@17.7.0
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/i18n@17.7.0
  - @object-ui/components@17.7.0
  - @object-ui/mobile@17.7.0
  - @object-ui/permissions@17.7.0

## 17.6.0

### Patch Changes

- 5edc0c5: `object-gantt` / `object-map` / `object-calendar` no longer drop a sort entry that omits `order`.
  
  The three blocks each inlined a byte-identical private copy of the `sort` →
  `$orderby` conversion. That copy required BOTH `field` and `order` on an array
  entry and silently skipped any entry missing one, so a stored view sorting by
  `[{ field: 'amount' }]` reached the wire with no ordering at all — the authored
  sort key was lost, not applied. The same copy already treated the STRING
  spelling `"amount"` as ascending, so this was an inconsistency between two
  spellings of one thing rather than deliberate strictness.
  
  All three now import the shared `convertSortToQueryParams` sink from
  `@object-ui/core` (introduced by objectstack#7137, already used by
  `object-timeline` and `record:line_items`), and the private copies are gone —
  the sink is the repo's only definition. Two behavior changes come with it, both
  of which make the blocks more faithful to what is already declared rather than
  more tolerant:
  
  - An array entry that omits `order` now orders ASCENDING instead of vanishing.
    That is what `QueryParams.$orderby`'s own member shape
    (`{ field: string; order?: 'asc' | 'desc' }`) says, and what
    `@object-ui/data-objectstack`'s `serializeOrderBy` already did with a missing
    direction.
  - When nothing orderable was authored, the query now carries no `$orderby` at
    all instead of an empty object. `{}` is truthy and meant "no ordering" only by
    accident of the adapter's serializer.
  
  Reachability, so the size of this is not overstated: `SortConfig.order` and
  `ElementDataSourceSort.order` are REQUIRED in objectui's own types, so a typed
  caller could never author the dropped shape. The affected surface is untyped
  stored view metadata (`ElementSavedView` is a loose record by design) — which is
  exactly where an order-less entry can arrive today.
- 1cd46bd: Correct the published "works with the `api` data provider" claim for plugin-calendar,
  which `ObjectCalendar` does not implement. `data.provider: 'api'` reaches
  `console.warn('API provider not yet implemented for ObjectCalendar')`
  (`ObjectCalendar.tsx:294-296`), sets the record set to empty and renders a calendar
  with no events; `endpoint` and `method` have no read point anywhere in
  `packages/plugin-calendar/src`, and the package never resolves an `ApiDataSource`.
  
  Four publication sites corrected:
  
  - `packages/plugin-calendar/src/ObjectCalendar.tsx:22` (file-header JSDoc): "Works
    with object/api/value data providers" → "Works with object/value data providers".
  - `content/docs/plugins/plugin-calendar.mdx:178` (Features list): "Works seamlessly
    with object/api/value data providers" → "Works seamlessly with object/value data
    providers".
  - `content/docs/plugins/index.md:168` (Calendar Plugin section): "Works with
    object/api/value providers" → "Works with object/value providers".
  - `content/docs/plugins/plugin-calendar.mdx` "API Provider" section: the
    copy-pasteable `provider: 'api'` + `endpoint` + `method` recipe is replaced by a
    statement of the real behaviour, matching the merged plugin-map wording.
  
  The identical sentence published for **plugin-gantt** is left untouched: there
  `provider: 'api'` is genuinely implemented (`ObjectGantt.tsx:442-445` resolves a real
  `ApiDataSource` through `resolveDataSource`, and `:1155` / `:1495` route write-backs
  through it), so the gantt claim is true and this is a shared sentence, not a shared
  defect.
  
  Implementing the `api` provider for calendar is capability expansion and is explicitly
  out of scope here, the same line objectui#5163 drew for plugin-map. No runtime
  behaviour changes: a source comment and docs prose only.
- e7c5a80: `plugin-calendar`'s README no longer documents imports the package does not export.
  
  Three defects in `packages/plugin-calendar/README.md`, all of which made a
  copy-pasted snippet fail to compile. Checked by taking the package's real export
  name set off `src/index.tsx` through the TypeScript compiler API and cross-checking
  every import statement in the README against it — including multi-line import
  blocks, which a single-line grep cannot see.
  
  1. **Fabricated (deleted).** A "Manual Registration" section taught
     `import { calendarComponents } from '@object-ui/plugin-calendar'` followed by
     `Object.entries(calendarComponents).forEach(register)`. There is no
     `calendarComponents` export and never was — the identifier does not occur
     anywhere in `src/`. Copying it gave `undefined`, and `Object.entries(undefined)`
     throws a `TypeError`, so the section could not run at all. Registration in this
     package is purely a side effect of importing the entry point, so there is no
     components map to iterate. The fabricated section is replaced by what the
     side-effect import actually claims (the three registered schema types and their
     namespaced keys) and by the package's real export surface — `ObjectCalendar`,
     `CalendarView`, `ObjectCalendarRenderer` plus the component prop types. Hosts
     that want their own registry key are shown the honest way to get one:
     registering the exported `ObjectCalendarRenderer` under it.
  
  2. **Wrong import path (path corrected).** `CalendarViewSchema` was imported from
     `@object-ui/plugin-calendar`. The type is real but belongs to `@object-ui/types`;
     this package imports it and does not re-export it, so the documented import was
     a "no exported member" error. The path now points at `@object-ui/types`.
  
  3. **Name collision (import re-pointed).** Correcting (2) alone still left the
     snippet uncompilable: the same example imported `CalendarEvent` from
     `@object-ui/plugin-calendar`, which is a real export but a *different* type —
     the `CalendarView` component's runtime shape (`id: string | number`,
     `start: Date`), not the authored JSON shape (`id: string`, `start: string | Date`)
     that `CalendarViewSchema.events` requires and that the README's own "Calendar
     Event Structure" section documents. The example's ISO-string values therefore did
     not typecheck, and the plugin's event type was not assignable to the schema's.
     Both authored types now come from `@object-ui/types`, and the two same-named
     types are documented side by side so the next reader does not re-pick the wrong one.
  
  No exports were added to make the README true — the docs were moved to the code,
  not the reverse.
- 2165d88: Rename four component-props types off the names `@objectstack/spec` starts owning in
  17.0.0, keeping the old spellings as deprecated aliases. No behaviour changes and no
  importer breaks.
  
  `@objectstack/spec/ui` exports `ObjectCalendarProps`, `ObjectFormProps`, `ObjectGridProps`
  and `ObjectKanbanProps` from 17.0.0, where each is the AUTHORED props document of the
  matching element — a serialisable authoring surface (`z.input< typeof
  ObjectGridPropsSchema >`). The same-named interfaces here are the RENDERERS' props: a live
  `dataSource`, records pre-fetched by a parent, and the host callbacks. Two different things
  under one word, so the local ones are renamed rather than derived, following the split this
  repo already made for `PageHeaderProps` -> `PageHeaderComponentProps` and the
  `Record*ComponentProps` family in `@object-ui/types`:
  
  | package | new name | old name |
  |---|---|---|
  | `@object-ui/plugin-calendar` | `ObjectCalendarComponentProps` | `ObjectCalendarProps` |
  | `@object-ui/plugin-form` | `ObjectFormComponentProps` | `ObjectFormProps` |
  | `@object-ui/plugin-grid` | `ObjectGridComponentProps` | `ObjectGridProps` |
  | `@object-ui/plugin-kanban` | `ObjectKanbanComponentProps` | `ObjectKanbanProps` |
  
  Every old name is still exported from its package barrel as a `@deprecated` alias denoting
  the SAME type, pinned per package by `spec-symbol-4650.test.ts`, so existing imports keep
  compiling. New code should use the `ComponentProps` spelling.
  
  `@object-ui/app-shell` carries no API change: its `SECRET_MASK` — the ADR-0100 credential
  read mask, which 17.0.0 moves into `@objectstack/spec/data` — is renamed to
  `OBJECTUI_SECRET_MASK` at its declaration in `views/metadata-admin/widgets.tsx`. That
  constant is package-internal and is not re-exported from the barrel, so nothing published
  changes; the rename exists so the local copy cannot be read as the spec's own definition
  while this repo is still pinned below the release that exports it.
- Updated dependencies [88085e3]
- Updated dependencies [69251bf]
- Updated dependencies [57e668f]
- Updated dependencies [516663d]
- Updated dependencies [41ac1b7]
- Updated dependencies [1eaf0a1]
- Updated dependencies [7c297e3]
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
- Updated dependencies [31676be]
- Updated dependencies [8c0d52e]
- Updated dependencies [aff10e2]
- Updated dependencies [70a774b]
- Updated dependencies [7dd93c0]
- Updated dependencies [229b17e]
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
  - @object-ui/plugin-detail@17.6.0
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0
  - @object-ui/mobile@17.6.0

## 17.5.0

### Minor Changes

- 515328f: `calendar-view` has no declared-but-inert inputs left: `allowCreate` works, `colorMapping` is retired (objectui#4454, objectui#4493)

  Two of this widget's registry inputs were declared and read by nobody — the one
  state ADR-0049's enforce-or-remove framing says must not persist. Measurement
  answered them in opposite directions.

  **`allowCreate` is enforced.** The handler it would gate was already built in the
  renderer — `handleAddClick`, dispatching `{ type: 'create', payload: {} }` on the
  widget's own `onAction` channel — and simply never passed. `CalendarView` renders
  its **New event** button behind `onAddClick`, so on the SDUI path that button
  never existed and the handler was unreachable: both halves of one feature were
  present and had never been introduced to each other. An authored
  `allowCreate: true` now supplies the handler to `onAddClick`, and clicking the
  button dispatches the create action.

  The wiring goes through the declared `onAddClick` hatch rather than around it via
  a second prop. That key is already one of the renderer's function-typed host
  hatches (objectui#4453), so a React host could switch the affordance on today and
  that path is untouched — a host handler still replaces the action dispatch rather
  than running alongside it, the same precedence `onEventClick` keeps. An authored
  `onAddClick` string is still dropped, so turning the affordance on cannot
  reintroduce that card's uncaught handler crash.

  Only the boolean `true` turns it on. Absent, `false`, and the off-type spellings
  JSON invites (`'true'`, `1`, an object) all resolve to the absent-key answer, which
  on this prop is literally what makes the button not render. Every node that never
  authored the key renders exactly as before.

  **`colorMapping` is removed.** It had no read site anywhere: the renderer's event
  mapping takes the colour straight off the record (`color: record[colorField]`),
  and `CalendarView` resolves a colour from `event.color`. An author who wrote the
  documented `colorMapping: { meeting: 'blue' }` got no mapping, no warning and no
  error — the raw field value was used as the colour, which for a picklist value
  like `meeting` is not a colour at all. It is retired rather than implemented
  because no measured app authors it, and a capability with no pull behind it is not
  worth building. The `content/docs/plugins/plugin-calendar.mdx` schema-API line
  documenting it is removed in the same change.

  Retiring it is not a behaviour change — the key never had a read site to lose. It
  becomes an ordinary unknown authored key, dropped at the renderer boundary like
  any other.

  **Grade.** Minor, not patch: measured both ways against the emitted bundle, the
  published registry surface moves — `calendar-view`'s `inputs` array loses a member
  (`colorMapping`: 1 emitted declaration before, 0 after), so the authorable
  vocabulary this widget publishes narrows by one key, and a second declared input
  starts producing a user-visible affordance. The emitted `.d.ts` is byte-identical
  either way; the vocabulary lives in the runtime registry metadata, not in the type
  surface.

### Patch Changes

- 395e154: authored ISO `currentDate` reaches the calendar as a `Date`; unparseable input falls back to the default instead of crashing

  `plugin-calendar:calendar-view` declares the input `{ name: 'currentDate', type: 'string', description: 'ISO date string for initial calendar date' }`, while `CalendarViewProps.currentDate` is a `Date`. Nothing converted between the two: the authored string rode the renderer's trailing `{...props}` spread into `useState`'s initial `selectedDate`, and the header's `selectedDate.toLocaleDateString(…)` threw `selectedDate.toLocaleDateString is not a function` — the error boundary instead of the calendar. Writing the one spelling the input documents was the one spelling that could not work, and there was no correct authored value at all, since `type: 'string'` cannot express a `Date`.

  The renderer now owes the conversion, at its own boundary. `currentDate` is destructured out of the incoming props so the spread can no longer carry the raw value (the consumed-key pattern from the `events` collision fix), parsed once per authored value, and passed to `CalendarView` as the `Date` its prop type declares. Off-spec input — an unparseable string, or any non-string that is not already a `Date` — gets the same answer as an absent key: the component's own default date. An `Invalid Date` is never manufactured and handed on; it does not throw, it renders the literal text "Invalid Date" into the header and the date picker, which is a silent wrong answer where the default is a usable calendar.

  A `Date` instance passes through untouched, so a React host handing the widget its real declared prop type is unaffected.

- c5756ff: `calendar-view` consumes or declares every prop it forwards — an authored `onEventClick` can no longer crash a click

  `calendar-view`'s renderer ended in `<CalendarView … {...props} />`, where `props` was everything `SchemaRenderer` hands a registered widget: the node's authored keys, the contents of its `props` container, the injected runtime props, and a host's trailing props. That is an unbounded set spread onto a component whose props are a closed list, and the worst collision on it was `onEventClick`: an authored `onEventClick: 'NOT-A-FUNCTION'` rendered a perfectly normal calendar and then threw `onEventClick is not a function` on the first click. React does not route event-handler errors to `SchemaErrorBoundary`, so it surfaced as an uncaught window error — the calendar kept looking fine while its click handling was dead. Both authoring channels reached it, the node's own key and a `props: { onEventClick }` container.

  The forward set is now exactly `CalendarViewProps`, each key resolved to the type that prop declares; nothing else reaches the component. Declared registry inputs are consumed (`view` narrowed to its declared enum, `currentDate` parsed, `className` forwarded, the field-name inputs read off the schema); `CalendarView`'s callbacks are a declared, function-typed host escape hatch — a host-passed function is forwarded exactly as before, and a non-function value, which is all an SDUI author writing JSON can produce, is dropped, the same answer as an absent key; every other key is dropped.

  Fixed with it, from the same boundary: an authored `onAction` string killed the same click through the renderer's own action channel; an authored `onDateClick` / `onNavigate` / `onViewChange` / `onEventDrop` / `onTimeRangeSelect` / `onAddClick` string killed its own gesture the same way; an authored `locale` that `Intl` rejects (`en_US`, the underscore spelling) took the whole render down to the error boundary with `RangeError: Incorrect locale information provided`; and an off-enum `view` (`agenda`) rendered a header with no calendar under it at all, where it now falls back to the component's `month` default.

  No capability is removed and no authorable surface is added: every host path that worked keeps working, including the handler precedence the old spread produced (a host handler replaces the `onAction` dispatch rather than running alongside it). The package's emitted `.d.ts` is unchanged.

- 49b9de6: fix(plugin-calendar): authoring `events` on a `calendar-view` node no longer takes the calendar down

  `calendar-view`'s renderer computed a `CalendarEvent[]` from `schema.data`, passed it
  as `events={…}`, then spread the remaining props **after** it. `SchemaRenderer`
  forwards a node's `events` key as a plain prop, so a node authoring `events` — the
  ordinary SDUI action metadata, legal on any node — landed its `{ onClick: [...] }`
  object on the `events` array prop: `CalendarView` iterated it and threw
  `events is not iterable`, and a spec-legal node rendered an error card instead of its
  calendar.

  The authored key is now destructured out before the spread, so the computed array
  always wins. This also closes the quiet half of the same collision: an authored
  `events` **array** never threw — it silently replaced the calendar's contents with
  itself.

  No capability is removed. Nothing in the renderer layer consumes a node's `events`
  key (the action path is `properties.action` through `ActionRunner`), and the
  component's own `onAction` channel is unaffected.

- 3e579d6: `object-calendar` / `view:calendar`: the renderer now consumes or declares every prop it forwards, instead of spreading the authored node into `ObjectCalendar`

  One shared renderer serves both registrations, and it ended in a raw spread of everything `SchemaRenderer` hands a widget — the node's authored keys, its `props` container, the injected runtime props and a host's trailing props — onto a component whose props are a closed list. `ObjectCalendarProps` declares eight callbacks and a `locale`, so an authored value under any of those names landed on the declared prop, and an SDUI author writing JSON can never produce a function:

  - an authored `onDateClick` string threw `onDateClick is not a function` on an empty day-cell click, and an authored `onNavigate` string threw on **Next period** — both as _uncaught_ window errors, because React does not route event-handler errors to `SchemaErrorBoundary`, so the calendar kept looking fine while that gesture was dead;
  - an authored `locale: 'en_US'` (the underscore spelling a producer writes by accident) threw `RangeError: Incorrect locale information provided` out of render and took the whole calendar to the error boundary.

  The forward set is now exactly `ObjectCalendarProps`, each key resolved to the type that prop declares: the callback family is a declared, function-typed host escape hatch, `locale` is accepted only when `Intl.getCanonicalLocales` takes it, `data`/`loading` keep the parent pre-fetch path at their declared types, and everything else — including the open tail of authored keys — is dropped.

  Host-passed functions are unaffected: a React host's handlers, and `ListView`'s `onRowClick`, still reach the component exactly as before.

- Updated dependencies [0e67b53]
- Updated dependencies [ceccdcf]
- Updated dependencies [d6e5124]
- Updated dependencies [debad27]
- Updated dependencies [dc2aa3e]
- Updated dependencies [ee66e2e]
- Updated dependencies [e2e6360]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [932cbcd]
- Updated dependencies [734d186]
- Updated dependencies [f650253]
- Updated dependencies [6d01319]
- Updated dependencies [3d9769a]
- Updated dependencies [8f85f8b]
- Updated dependencies [d0c3b26]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [f7c6430]
- Updated dependencies [4dadf0d]
- Updated dependencies [ae10a01]
- Updated dependencies [0f21348]
- Updated dependencies [d2e2caf]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [4b70d28]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [ebb4e0e]
- Updated dependencies [3a9021e]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [b4d3c22]
- Updated dependencies [1f9b905]
- Updated dependencies [8f60d73]
- Updated dependencies [cb13400]
- Updated dependencies [828549a]
- Updated dependencies [e1ade8f]
- Updated dependencies [bc64bfe]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [63fe8fd]
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [433ff9f]
- Updated dependencies [5cc847c]
- Updated dependencies [6314e87]
- Updated dependencies [5e2e9fa]
- Updated dependencies [297534b]
- Updated dependencies [e7663f2]
- Updated dependencies [fa21254]
- Updated dependencies [33c32bf]
- Updated dependencies [66fb4fa]
- Updated dependencies [b953a97]
- Updated dependencies [e076fd5]
- Updated dependencies [d7f3e30]
- Updated dependencies [6d641c9]
- Updated dependencies [7e4f0e5]
- Updated dependencies [c911544]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [58bebf6]
- Updated dependencies [36310dc]
- Updated dependencies [52d878a]
- Updated dependencies [456aac8]
- Updated dependencies [405e808]
- Updated dependencies [49ae9f4]
- Updated dependencies [a3ae404]
- Updated dependencies [7d04b0e]
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
- Updated dependencies [dad805d]
- Updated dependencies [7f1cb33]
- Updated dependencies [f148a64]
- Updated dependencies [bb68488]
- Updated dependencies [2e3b0c0]
- Updated dependencies [35997ce]
- Updated dependencies [9461dd3]
- Updated dependencies [78fa331]
- Updated dependencies [47f551b]
- Updated dependencies [31ab1ac]
- Updated dependencies [0082db8]
- Updated dependencies [ab04728]
- Updated dependencies [b388950]
- Updated dependencies [5bf09fd]
- Updated dependencies [06915b0]
- Updated dependencies [ff84b05]
  - @object-ui/i18n@17.5.0
  - @object-ui/react@17.5.0
  - @object-ui/components@17.5.0
  - @object-ui/plugin-detail@17.5.0
  - @object-ui/core@17.5.0
  - @object-ui/fields@17.5.0
  - @object-ui/types@17.5.0
  - @object-ui/mobile@17.5.0

## 17.4.0

### Patch Changes

- 5bfaabd: `PageComponentSchema.dataSource` now reaches every object-bound block, not just
  `list-view` — and `element:record_picker` stops discarding `view`
  (objectstack#6953).

  objectstack#5576 wired the spec's per-element data binding
  (`dataSource: { object, view?, filter?, sort?, limit? }`) to `list-view` and left
  the same declaration inert on every other page component. Two gaps remained, and
  both were silent:

  - **`element:record_picker` read four of the five keys and dropped `view`.** So
    `dataSource: { object: 'account', view: 'hot' }` — the spec's own example —
    built a picker over EVERY account instead of the rows the saved view selects.
    Nothing threw and nothing rendered an error; the option list was simply wider
    than what was authored, which also means a user could select a record the page
    said was out of scope.
  - **`object-grid` / `object-form` / `object-kanban` / `object-calendar` /
    `object-chart` / `object-metric` / `record:related_list` read none of it.**
    Each gates its fetch on its own `objectName`, and nothing mapped
    `dataSource.object` onto it, so a page written the way the spec documents
    rendered an empty grid / a field-less form / a board with no cards / an empty
    month / an empty chart / a static metric number — with no request and no
    diagnostic anywhere. Spec-valid metadata rendering nothing is the
    objectstack#4413 shape.

  Composition follows objectstack#5576's landed semantics unchanged on every block:
  a named saved view supplies the baseline, a key written on the component itself
  overrides it, an explicit binding key overrides both, `filter` AND-combines
  ("additional filter criteria" — a binding can narrow a view, never widen it), and
  a `view` name that does not resolve renders a configuration error instead of
  degrading to the object's full scope.

  - `@object-ui/react` — new `useElementDataSourceSchema(schema, mapping, dataSource?)`
    and `ElementDataSourceGate` apply a resolved binding to the schema keys a given
    block reads, plus `ElementDataSourceErrorPanel` / `ElementDataSourceLoadingPanel`
    for the two non-final states. One precedence table for all blocks rather than
    one copy per block — that copy is how "additional filter criteria" would have
    become two dialects.
  - A mapping names **only** keys its block genuinely reads. A composed value
    written onto a key the block ignores would be accepted and dropped, which is
    the defect being removed, one layer deeper — so a kanban's swimlane `columns`
    never receive a view's field list, and a block with no row cap leaves `limit`
    unmapped. The per-block coverage table, including two residual gaps that are
    named rather than papered over, is in `content/docs/guide/data-source.md`.

  No behaviour changes for a block that carries no `dataSource`: the binding-free
  path returns the schema by reference, so nothing remounts and nothing refetches.

- Updated dependencies [794c497]
- Updated dependencies [993336f]
- Updated dependencies [f0a625a]
- Updated dependencies [b5980f4]
- Updated dependencies [8aad9fd]
- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [0186cdc]
- Updated dependencies [7864f03]
- Updated dependencies [ea41a59]
- Updated dependencies [0cbdca8]
- Updated dependencies [d229dfa]
- Updated dependencies [ecae400]
- Updated dependencies [4bc6c23]
- Updated dependencies [d3e738a]
- Updated dependencies [c3b01a7]
- Updated dependencies [f5f8744]
- Updated dependencies [7ed3360]
- Updated dependencies [69becd2]
- Updated dependencies [5e52495]
- Updated dependencies [0fa5e4d]
- Updated dependencies [b750823]
- Updated dependencies [5bfaabd]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [65bb513]
- Updated dependencies [c97a45e]
- Updated dependencies [b19162d]
- Updated dependencies [c2fd122]
- Updated dependencies [1bd6faa]
- Updated dependencies [ac2139c]
- Updated dependencies [b14ab3a]
- Updated dependencies [e24d767]
- Updated dependencies [7b3e048]
- Updated dependencies [8c60819]
- Updated dependencies [aca561a]
- Updated dependencies [e64a52e]
- Updated dependencies [844d17f]
- Updated dependencies [d8a0be4]
- Updated dependencies [48132f7]
- Updated dependencies [4dcd52a]
- Updated dependencies [42ae5c6]
- Updated dependencies [0ef9dfd]
- Updated dependencies [f4b97c8]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [6d762da]
- Updated dependencies [e6fdbdc]
- Updated dependencies [4178d5a]
- Updated dependencies [54233b1]
- Updated dependencies [c2ecbae]
- Updated dependencies [acc34c5]
- Updated dependencies [c4768a7]
- Updated dependencies [f9faa7d]
- Updated dependencies [97b63d7]
- Updated dependencies [6bb454a]
- Updated dependencies [11c1e71]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [33526fd]
- Updated dependencies [32413ec]
- Updated dependencies [c1e1e6b]
  - @object-ui/components@17.4.0
  - @object-ui/plugin-detail@17.4.0
  - @object-ui/react@17.4.0
  - @object-ui/core@17.4.0
  - @object-ui/fields@17.4.0
  - @object-ui/i18n@17.4.0
  - @object-ui/types@17.4.0
  - @object-ui/mobile@17.4.0

## 17.3.0

### Patch Changes

- Updated dependencies [18cd432]
- Updated dependencies [b7165ce]
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
- Updated dependencies [bbbde12]
- Updated dependencies [5a24ad9]
- Updated dependencies [9e9e9a9]
- Updated dependencies [19b8c9b]
- Updated dependencies [56409c2]
- Updated dependencies [042e09d]
- Updated dependencies [7d08c3f]
- Updated dependencies [9cbcbf4]
- Updated dependencies [85c4c9c]
- Updated dependencies [fd54c3e]
- Updated dependencies [4eeb932]
- Updated dependencies [6fe485b]
- Updated dependencies [5c856ec]
- Updated dependencies [23018cc]
- Updated dependencies [58a00f0]
- Updated dependencies [53811d1]
- Updated dependencies [b17ce4c]
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
- Updated dependencies [c7fba27]
- Updated dependencies [a415684]
- Updated dependencies [a4cff5b]
- Updated dependencies [175bd79]
- Updated dependencies [5af2852]
- Updated dependencies [12bf669]
- Updated dependencies [34d9169]
- Updated dependencies [5881a2c]
- Updated dependencies [9bc3709]
- Updated dependencies [f833d3a]
- Updated dependencies [30ae33a]
- Updated dependencies [a6ec93d]
- Updated dependencies [2a9513d]
- Updated dependencies [49f7449]
- Updated dependencies [71be406]
- Updated dependencies [d22ae31]
- Updated dependencies [c7ed4c3]
- Updated dependencies [2409e1d]
- Updated dependencies [789fe3e]
- Updated dependencies [f789c3b]
- Updated dependencies [a321fa4]
- Updated dependencies [8d8094a]
  - @object-ui/core@17.3.0
  - @object-ui/fields@17.3.0
  - @object-ui/components@17.3.0
  - @object-ui/plugin-detail@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/i18n@17.3.0
  - @object-ui/react@17.3.0
  - @object-ui/mobile@17.3.0

## 17.2.0

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [bca45cc]
- Updated dependencies [6be575c]
- Updated dependencies [a889e31]
- Updated dependencies [09d30a4]
- Updated dependencies [4bf612c]
- Updated dependencies [335041c]
- Updated dependencies [b414983]
- Updated dependencies [256f8cc]
- Updated dependencies [d9668a7]
- Updated dependencies [4b470b9]
- Updated dependencies [785b8a5]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [4a51e77]
- Updated dependencies [f6e8d78]
- Updated dependencies [ea96284]
- Updated dependencies [d3584c6]
- Updated dependencies [dd06bcd]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [850033c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/components@17.2.0
  - @object-ui/core@17.2.0
  - @object-ui/plugin-detail@17.2.0
  - @object-ui/react@17.2.0
  - @object-ui/i18n@17.2.0
  - @object-ui/fields@17.2.0
  - @object-ui/mobile@17.2.0

## 17.1.0

### Patch Changes

- Updated dependencies [62311b6]
- Updated dependencies [fc0272a]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [1cf0de7]
- Updated dependencies [752e18f]
- Updated dependencies [c785740]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
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
- Updated dependencies [aecc934]
- Updated dependencies [5b084eb]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
- Updated dependencies [2baa13f]
- Updated dependencies [bac266c]
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
- Updated dependencies [9867281]
  - @object-ui/core@17.1.0
  - @object-ui/components@17.1.0
  - @object-ui/plugin-detail@17.1.0
  - @object-ui/react@17.1.0
  - @object-ui/types@17.1.0
  - @object-ui/i18n@17.1.0
  - @object-ui/fields@17.1.0
  - @object-ui/mobile@17.1.0

## 17.0.0

### Patch Changes

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
  - @object-ui/plugin-detail@17.0.0
  - @object-ui/i18n@17.0.0
  - @object-ui/fields@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/core@17.0.0
  - @object-ui/mobile@17.0.0

## 16.1.0

### Patch Changes

- 549c67d: chore(lint): clear the mechanical baseline lint errors so these packages' lint gates protect them again

  Extends the fields/core cleanup from #2709 (objectui#2713). These eight package
  lints were red at baseline on `main`, so their per-package `lint` gate could not
  catch new violations of the same class. Cleared every **error** (no behavior
  change; warnings are out of scope):

  - **`no-useless-catch`** (`data-objectstack`) — unwrapped five try/catch blocks
    whose `catch` only re-threw; errors still propagate identically.
  - **`preserve-caught-error`** (`cli`, `data-objectstack`, `react`) — the caught
    error's message is inlined into the thrown `Error`; a scoped disable with a
    justifying comment carries each one, because these packages target ES2020
    whose lib types the 1-arg `Error` constructor only (so `{ cause }` won't
    compile) — same reasoning as the core case in #2709.
  - **`prefer-const`** (`plugin-calendar`, `plugin-map`) — `let`→`const` for
    never-reassigned bindings.
  - **`no-empty-object-type`** (`plugin-designer`) — empty extend-only interfaces
    → equivalent `type` aliases.
  - **`no-useless-assignment`** (`react`) — dropped a dead initializer that both
    branches overwrite before it is read.
  - **`no-require-imports`** (`plugin-calendar`, `plugin-timeline` tests) —
    hoisted `vi.mock` factories now use an `async` factory with
    `await import('react')` instead of `require('react')`.
  - **stale `eslint-disable` directive** (`plugin-markdown`) — removed a
    `react/no-danger` disable whose plugin is not loaded in the flat config (an
    unknown-rule reference that ESLint v10 reports as an error); the rationale is
    kept as a plain comment.

- Updated dependencies [0318118]
- Updated dependencies [1c8935a]
- Updated dependencies [af1b0db]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [803558e]
- Updated dependencies [aefcf39]
- Updated dependencies [2e7d7f0]
- Updated dependencies [ef14f69]
- Updated dependencies [94d4876]
- Updated dependencies [53513a4]
- Updated dependencies [1100a8b]
- Updated dependencies [7abe4cd]
- Updated dependencies [69fa5d1]
- Updated dependencies [f329ec5]
- Updated dependencies [549c67d]
- Updated dependencies [ebe6494]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [0a3710b]
- Updated dependencies [f80aaf2]
- Updated dependencies [62b9ab5]
- Updated dependencies [14cb729]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [2331ac9]
- Updated dependencies [199fa83]
- Updated dependencies [eee4ded]
- Updated dependencies [3b2e4d9]
  - @object-ui/fields@16.1.0
  - @object-ui/i18n@16.1.0
  - @object-ui/core@16.1.0
  - @object-ui/types@16.1.0
  - @object-ui/react@16.1.0
  - @object-ui/plugin-detail@16.1.0
  - @object-ui/components@16.1.0
  - @object-ui/mobile@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [9d4a429]
- Updated dependencies [b4ef588]
- Updated dependencies [ca0f5f0]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/plugin-detail@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0
  - @object-ui/i18n@16.0.0
  - @object-ui/fields@16.0.0
  - @object-ui/core@16.0.0
  - @object-ui/mobile@16.0.0

## 15.0.0

### Patch Changes

- Updated dependencies [bb22788]
  - @object-ui/plugin-detail@15.0.0
  - @object-ui/types@15.0.0
  - @object-ui/core@15.0.0
  - @object-ui/i18n@15.0.0
  - @object-ui/react@15.0.0
  - @object-ui/components@15.0.0
  - @object-ui/fields@15.0.0
  - @object-ui/mobile@15.0.0

## 14.1.0

### Patch Changes

- Updated dependencies [82441e4]
- Updated dependencies [2efa9fd]
- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [471c5d3]
- Updated dependencies [579b24d]
- Updated dependencies [2b30583]
- Updated dependencies [23d65c3]
- Updated dependencies [055e1d2]
- Updated dependencies [f9a7907]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [f30ff68]
- Updated dependencies [073e7aa]
- Updated dependencies [3e8bf07]
- Updated dependencies [6c0135c]
- Updated dependencies [5b52624]
- Updated dependencies [4afb251]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f94905d]
- Updated dependencies [2712fc1]
- Updated dependencies [f0f10f5]
  - @object-ui/i18n@14.1.0
  - @object-ui/plugin-detail@14.1.0
  - @object-ui/fields@14.1.0
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/components@14.1.0
  - @object-ui/mobile@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [443360a]
- Updated dependencies [c70bca7]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [a44e7b6]
- Updated dependencies [eef832b]
- Updated dependencies [5971cc4]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/i18n@14.0.0
  - @object-ui/react@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/components@14.0.0
  - @object-ui/plugin-detail@14.0.0
  - @object-ui/fields@14.0.0
  - @object-ui/mobile@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [80901aa]
- Updated dependencies [53c40c2]
- Updated dependencies [e492b9d]
  - @object-ui/components@13.2.0
  - @object-ui/plugin-detail@13.2.0
  - @object-ui/i18n@13.2.0
  - @object-ui/fields@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0
  - @object-ui/mobile@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/i18n@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0
- @object-ui/fields@13.1.0
- @object-ui/mobile@13.1.0
- @object-ui/plugin-detail@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [9e38270]
- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/i18n@13.0.0
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/fields@13.0.0
  - @object-ui/plugin-detail@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0
  - @object-ui/mobile@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [47e72b8]
- Updated dependencies [6cbccf3]
- Updated dependencies [e1840bf]
- Updated dependencies [c31874d]
  - @object-ui/plugin-detail@12.1.0
  - @object-ui/components@12.1.0
  - @object-ui/fields@12.1.0
  - @object-ui/i18n@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0
  - @object-ui/mobile@12.1.0

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
  - @object-ui/plugin-detail@12.0.0
  - @object-ui/mobile@12.0.0
  - @object-ui/react@12.0.0
  - @object-ui/i18n@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [544d8eb]
- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
  - @object-ui/i18n@11.5.0
  - @object-ui/react@11.5.0
  - @object-ui/plugin-detail@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/fields@11.5.0
  - @object-ui/core@11.5.0
  - @object-ui/mobile@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [144ab55]
- Updated dependencies [1948c5b]
- Updated dependencies [bce581a]
- Updated dependencies [2edcaff]
- Updated dependencies [9cd9be1]
- Updated dependencies [5160832]
- Updated dependencies [69d6b94]
- Updated dependencies [c38d107]
- Updated dependencies [243a9ba]
- Updated dependencies [289be5b]
- Updated dependencies [7782698]
- Updated dependencies [19f2533]
- Updated dependencies [790558b]
- Updated dependencies [09e1b26]
- Updated dependencies [e84d64d]
  - @object-ui/types@11.4.0
  - @object-ui/plugin-detail@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/fields@11.4.0
  - @object-ui/i18n@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/mobile@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [db5ebe4]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/i18n@11.3.0
  - @object-ui/plugin-detail@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/fields@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0
  - @object-ui/mobile@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [32dbd6a]
- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/plugin-detail@11.2.0
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/fields@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0
  - @object-ui/i18n@11.2.0
  - @object-ui/mobile@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [6726a2b]
  - @object-ui/i18n@11.1.0
  - @object-ui/components@11.1.0
  - @object-ui/fields@11.1.0
  - @object-ui/plugin-detail@11.1.0
  - @object-ui/react@11.1.0
  - @object-ui/types@11.1.0
  - @object-ui/core@11.1.0
  - @object-ui/mobile@11.1.0

## 7.3.0

### Patch Changes

- Updated dependencies [788dbf9]
  - @object-ui/fields@7.3.0
  - @object-ui/plugin-detail@7.3.0
  - @object-ui/types@7.3.0
  - @object-ui/core@7.3.0
  - @object-ui/i18n@7.3.0
  - @object-ui/react@7.3.0
  - @object-ui/components@7.3.0
  - @object-ui/mobile@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [8e7c1da]
- Updated dependencies [d23db5c]
  - @object-ui/i18n@7.2.0
  - @object-ui/types@7.2.0
  - @object-ui/plugin-detail@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/fields@7.2.0
  - @object-ui/react@7.2.0
  - @object-ui/core@7.2.0
  - @object-ui/mobile@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0
  - @object-ui/react@7.1.0
  - @object-ui/components@7.1.0
  - @object-ui/fields@7.1.0
  - @object-ui/mobile@7.1.0
  - @object-ui/plugin-detail@7.1.0
  - @object-ui/i18n@7.1.0

## 7.0.0

### Patch Changes

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
- Updated dependencies [3cc38fe]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [db8cd00]
- Updated dependencies [650bd1f]
- Updated dependencies [2f31406]
- Updated dependencies [18728c1]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/plugin-detail@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/i18n@7.0.0
  - @object-ui/types@7.0.0
  - @object-ui/fields@7.0.0
  - @object-ui/mobile@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/i18n@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3
- @object-ui/fields@6.2.3
- @object-ui/mobile@6.2.3
- @object-ui/plugin-detail@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/fields@6.2.2
  - @object-ui/plugin-detail@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2
  - @object-ui/i18n@6.2.2
  - @object-ui/mobile@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/i18n@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1
- @object-ui/fields@6.2.1
- @object-ui/mobile@6.2.1
- @object-ui/plugin-detail@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/fields@6.2.0
- @object-ui/plugin-detail@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0
- @object-ui/i18n@6.2.0
- @object-ui/mobile@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/fields@6.1.0
  - @object-ui/plugin-detail@6.1.0
  - @object-ui/react@6.1.0
  - @object-ui/mobile@6.1.0
  - @object-ui/i18n@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/i18n@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4
- @object-ui/fields@6.0.4
- @object-ui/mobile@6.0.4
- @object-ui/plugin-detail@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/i18n@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3
- @object-ui/fields@6.0.3
- @object-ui/mobile@6.0.3
- @object-ui/plugin-detail@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/i18n@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2
- @object-ui/fields@6.0.2
- @object-ui/mobile@6.0.2
- @object-ui/plugin-detail@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/i18n@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1
- @object-ui/fields@6.0.1
- @object-ui/mobile@6.0.1
- @object-ui/plugin-detail@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/i18n@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0
- @object-ui/fields@6.0.0
- @object-ui/mobile@6.0.0
- @object-ui/plugin-detail@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/i18n@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2
- @object-ui/fields@5.4.2
- @object-ui/mobile@5.4.2
- @object-ui/plugin-detail@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/i18n@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1
- @object-ui/fields@5.4.1
- @object-ui/mobile@5.4.1
- @object-ui/plugin-detail@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/fields@5.4.0
  - @object-ui/mobile@5.4.0
  - @object-ui/plugin-detail@5.4.0
  - @object-ui/react@5.4.0
  - @object-ui/i18n@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/i18n@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2
- @object-ui/fields@5.3.2
- @object-ui/mobile@5.3.2
- @object-ui/plugin-detail@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/i18n@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1
- @object-ui/fields@5.3.1
- @object-ui/mobile@5.3.1
- @object-ui/plugin-detail@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/i18n@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0
- @object-ui/fields@5.3.0
- @object-ui/mobile@5.3.0
- @object-ui/plugin-detail@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/i18n@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1
- @object-ui/fields@5.2.1
- @object-ui/mobile@5.2.1
- @object-ui/plugin-detail@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [321294c]
- Updated dependencies [b2d1704]
- Updated dependencies [0a644f0]
- Updated dependencies [a3cb88f]
- Updated dependencies [5425608]
- Updated dependencies [6c3f018]
- Updated dependencies [d912a60]
- Updated dependencies [5633edd]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [7c441f5]
- Updated dependencies [e919433]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [d9c3bae]
- Updated dependencies [3216f8a]
- Updated dependencies [d1442e3]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/i18n@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/plugin-detail@5.2.0
  - @object-ui/fields@5.2.0
  - @object-ui/components@5.2.0
  - @object-ui/mobile@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/fields@5.1.1
  - @object-ui/plugin-detail@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/i18n@5.1.1
  - @object-ui/react@5.1.1
  - @object-ui/mobile@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [1976691]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [32306e8]
- Updated dependencies [5b80cfd]
- Updated dependencies [49b1760]
- Updated dependencies [a49f300]
- Updated dependencies [c0b236f]
- Updated dependencies [8fd863e]
- Updated dependencies [1cb6e21]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/plugin-detail@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/i18n@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0
  - @object-ui/fields@5.1.0
  - @object-ui/mobile@5.1.0

## 5.0.2

### Patch Changes

- Updated dependencies [cab6a93]
  - @object-ui/i18n@5.0.2
  - @object-ui/components@5.0.2
  - @object-ui/fields@5.0.2
  - @object-ui/react@5.0.2
  - @object-ui/plugin-detail@5.0.2
  - @object-ui/types@5.0.2
  - @object-ui/core@5.0.2
  - @object-ui/mobile@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/i18n@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1
- @object-ui/fields@5.0.1
- @object-ui/mobile@5.0.1
- @object-ui/plugin-detail@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [542cca9]
- Updated dependencies [8930b15]
- Updated dependencies [95b6b21]
- Updated dependencies [ddb08a7]
- Updated dependencies [f16a762]
- Updated dependencies [765d50f]
- Updated dependencies [927187a]
- Updated dependencies [bae8ba8]
- Updated dependencies [8435860]
- Updated dependencies [bece8ca]
- Updated dependencies [bb2ea48]
- Updated dependencies [77c1877]
- Updated dependencies [b14fe09]
- Updated dependencies [1911d34]
- Updated dependencies [ba98039]
- Updated dependencies [a7bef6e]
- Updated dependencies [86c04f1]
- Updated dependencies [74962b0]
- Updated dependencies [8b850b5]
- Updated dependencies [3154334]
- Updated dependencies [fa4c2cb]
- Updated dependencies [7213027]
- Updated dependencies [34b66bf]
  - @object-ui/plugin-detail@5.0.0
  - @object-ui/components@5.0.0
  - @object-ui/i18n@5.0.0
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/fields@5.0.0
  - @object-ui/core@5.0.0
  - @object-ui/mobile@5.0.0

## 4.8.0

### Patch Changes

- Updated dependencies [06a4066]
  - @object-ui/plugin-detail@4.8.0
  - @object-ui/types@4.8.0
  - @object-ui/core@4.8.0
  - @object-ui/i18n@4.8.0
  - @object-ui/react@4.8.0
  - @object-ui/components@4.8.0
  - @object-ui/fields@4.8.0
  - @object-ui/mobile@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/i18n@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0
- @object-ui/fields@4.7.0
- @object-ui/mobile@4.7.0
- @object-ui/plugin-detail@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [8f490ad]
- Updated dependencies [3ee436d]
  - @object-ui/plugin-detail@4.6.0
  - @object-ui/components@4.6.0
  - @object-ui/fields@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/i18n@4.6.0
  - @object-ui/react@4.6.0
  - @object-ui/mobile@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
- Updated dependencies [d714e85]
- Updated dependencies [6b6afd1]
- Updated dependencies [22fa558]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/plugin-detail@4.5.0
  - @object-ui/fields@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/i18n@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/mobile@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [63eb66d]
- Updated dependencies [67dabe1]
- Updated dependencies [2bd45af]
- Updated dependencies [e33d575]
  - @object-ui/fields@4.4.0
  - @object-ui/plugin-detail@4.4.0
  - @object-ui/components@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/i18n@4.4.0
  - @object-ui/react@4.4.0
  - @object-ui/mobile@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [5f4ac6e]
- Updated dependencies [6b683c8]
- Updated dependencies [0d8eb98]
- Updated dependencies [b0bc410]
  - @object-ui/i18n@4.3.1
  - @object-ui/components@4.3.1
  - @object-ui/plugin-detail@4.3.1
  - @object-ui/fields@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1
  - @object-ui/mobile@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [f196cf4]
- Updated dependencies [ee1cc96]
- Updated dependencies [0b032be]
- Updated dependencies [115d36a]
- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/i18n@4.3.0
  - @object-ui/components@4.3.0
  - @object-ui/fields@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/plugin-detail@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0
  - @object-ui/mobile@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/i18n@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1
- @object-ui/fields@4.2.1
- @object-ui/mobile@4.2.1
- @object-ui/plugin-detail@4.2.1

## 4.2.0

### Patch Changes

- Updated dependencies [eb738bd]
- Updated dependencies [650392e]
- Updated dependencies [84b4bf1]
  - @object-ui/i18n@4.2.0
  - @object-ui/components@4.2.0
  - @object-ui/fields@4.2.0
  - @object-ui/react@4.2.0
  - @object-ui/plugin-detail@4.2.0
  - @object-ui/types@4.2.0
  - @object-ui/core@4.2.0
  - @object-ui/mobile@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/i18n@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0
- @object-ui/fields@4.1.0
- @object-ui/mobile@4.1.0
- @object-ui/plugin-detail@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/i18n@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12
- @object-ui/fields@4.0.12
- @object-ui/mobile@4.0.12
- @object-ui/plugin-detail@4.0.12

## 4.0.11

### Patch Changes

- Updated dependencies [1909bc3]
  - @object-ui/i18n@4.0.11
  - @object-ui/components@4.0.11
  - @object-ui/fields@4.0.11
  - @object-ui/react@4.0.11
  - @object-ui/plugin-detail@4.0.11
  - @object-ui/types@4.0.11
  - @object-ui/core@4.0.11
  - @object-ui/mobile@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/i18n@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10
- @object-ui/fields@4.0.10
- @object-ui/mobile@4.0.10
- @object-ui/plugin-detail@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/i18n@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9
- @object-ui/fields@4.0.9
- @object-ui/mobile@4.0.9
- @object-ui/plugin-detail@4.0.9

## 4.0.8

### Patch Changes

- Updated dependencies [3d58eaa]
  - @object-ui/i18n@4.0.8
  - @object-ui/components@4.0.8
  - @object-ui/fields@4.0.8
  - @object-ui/react@4.0.8
  - @object-ui/plugin-detail@4.0.8
  - @object-ui/types@4.0.8
  - @object-ui/core@4.0.8
  - @object-ui/mobile@4.0.8

## 4.0.7

### Patch Changes

- 7c9b85c: Fix compatibility with the framework's normalized Expression envelope format.

  `@objectstack/spec` now emits predicate (`visible` / `enabled`) and template
  (`titleFormat`) fields as `{ dialect, source }` envelopes instead of bare
  strings. The previous implementation assumed strings and crashed the record
  detail view (`TypeError: titleFormat.replace is not a function`) and printed
  `Failed to evaluate expression: ${[object Object]}` for every action visibility
  predicate.

  - `@object-ui/core`: `ExpressionEvaluator.evaluate` / `evaluateCondition` now
    unwrap Expression envelopes transparently.
  - `@object-ui/react`: new `toPredicateInput()` helper to safely normalize
    `boolean | string | Expression` predicate inputs into the `${expr}` form
    expected by `useCondition`.
  - `@object-ui/components`: `action-bar`, `action-button`, `action-group`,
    `action-icon`, `action-menu` renderers use `toPredicateInput()` instead of
    template-literal interpolation that produced `${[object Object]}`.
  - `@object-ui/plugin-detail`, `@object-ui/plugin-kanban`,
    `@object-ui/plugin-calendar`, `@object-ui/app-shell`,
    `@object-ui/console`: title-format helpers accept both legacy strings and
    the new `{ source }` envelope.

  All changes are backward-compatible — legacy bare strings continue to work.

- Updated dependencies [7c9b85c]
- Updated dependencies [fd15918]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/i18n@4.0.7
  - @object-ui/fields@4.0.7
  - @object-ui/types@4.0.7
  - @object-ui/mobile@4.0.7

## 4.0.6

### Patch Changes

- Updated dependencies [89ae109]
- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/fields@4.0.6
  - @object-ui/components@4.0.6
  - @object-ui/types@4.0.6
  - @object-ui/core@4.0.6
  - @object-ui/i18n@4.0.6
  - @object-ui/react@4.0.6
  - @object-ui/mobile@4.0.6

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
  - @object-ui/fields@4.0.5
  - @object-ui/types@4.0.5
  - @object-ui/core@4.0.5
  - @object-ui/i18n@4.0.5
  - @object-ui/react@4.0.5
  - @object-ui/mobile@4.0.5

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
  - @object-ui/fields@4.0.4
  - @object-ui/types@4.0.4
  - @object-ui/core@4.0.4
  - @object-ui/i18n@4.0.4
  - @object-ui/react@4.0.4
  - @object-ui/mobile@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/core@4.0.3
  - @object-ui/i18n@4.0.3
  - @object-ui/react@4.0.3
  - @object-ui/components@4.0.3
  - @object-ui/fields@4.0.3
  - @object-ui/mobile@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/i18n@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1
- @object-ui/fields@4.0.1
- @object-ui/mobile@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/fields@4.0.0
  - @object-ui/mobile@4.0.0
  - @object-ui/react@4.0.0
  - @object-ui/i18n@4.0.0

## 3.4.0

### Patch Changes

- b2be122: fix(mobile): round 2 — kanban readability, calendar default view, timeline dot clipping

  **Kanban**

  - Remove `font-mono` from card titles, descriptions, column headers, and empty-state labels — CRM cards no longer render in a monospace font.
  - Constrain column body height (`max-h-full min-h-0` + `h-full` on the layout root) so `ScrollArea` activates and cards don't bleed past the viewport bottom.
  - Opportunistically derive `description` (e.g. `$60K · Acme Corp · @owner`) and up to two `badges` (priority/severity/industry/rating) in `ObjectKanban` when the schema/source omits them, giving mobile cards more context at a glance.

  **Calendar**

  - `ObjectCalendar` previously hardcoded `view={schema.defaultView ?? 'month'}`, making the view-selector dropdown a no-op. Wire the `view` state through to the `<Calendar>` prop so user selection is respected.
  - On mobile (viewport < 768 px) coerce `day` defaults to `month` via a synchronous lazy initialiser and a resize/orientation effect — avoids the useless 24-hour empty-hour grid for date-only events.

  **Timeline**

  - Add `ml-3` to the `<Timeline>` `<ol>` so the `absolute -left-3` marker dots are no longer clipped at the scroll-container edge.

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/fields@3.4.0
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
- @object-ui/fields@3.3.2
- @object-ui/mobile@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/fields@3.3.1
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
- @object-ui/fields@3.3.0
- @object-ui/mobile@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/i18n@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0
- @object-ui/fields@3.2.0
- @object-ui/mobile@3.2.0

## 3.1.5

### Patch Changes

- Updated dependencies [cfe0596]
  - @object-ui/i18n@3.1.5
  - @object-ui/react@3.1.5
  - @object-ui/components@3.1.5
  - @object-ui/fields@3.1.5
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
- @object-ui/fields@3.1.4
- @object-ui/mobile@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/i18n@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3
- @object-ui/fields@3.1.3
- @object-ui/mobile@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/i18n@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2
- @object-ui/fields@3.1.2
- @object-ui/mobile@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/fields@3.1.1
  - @object-ui/mobile@3.1.1
  - @object-ui/react@3.1.1
  - @object-ui/i18n@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3
- @object-ui/fields@3.0.3
- @object-ui/mobile@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2
- @object-ui/fields@3.0.2
- @object-ui/mobile@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
  - @object-ui/fields@3.0.1
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
  - @object-ui/fields@3.0.0
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
  - @object-ui/fields@2.0.0

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/types@0.3.1
  - @object-ui/core@0.3.1
  - @object-ui/react@0.3.1
  - @object-ui/components@0.3.1
  - @object-ui/fields@0.3.1
