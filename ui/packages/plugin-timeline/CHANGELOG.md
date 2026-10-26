# @object-ui/plugin-timeline

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
- c910630: The timeline's unused "Overdue" bucket label is removed: `timeline.bucket.overdue` is gone from all ten language packs and from the timeline's built-in English defaults (objectui#11676).
  
  Nothing has read the key since a past date on a timeline went under "Earlier". No timeline heads a group "Overdue": a date is overdue only when it is a due date and the record is still open, and a timeline declares neither fact. Overdue records are still marked where record state lives: the date cell's due treatment, the gantt's alert colour and conditional formatting.
  
  **Narrowed public surface (`@object-ui/i18n`).** The exported `en` pack and the `TranslationKeys` type derived from it lose one member, `timeline.bucket.overdue`. Code that reads `en.timeline.bucket.overdue`, or passes that key to `t()` expecting a translation, has to drop it. This is released as `minor` under objectui's version policy, which keeps the major aligned with `@objectstack`. The date cell's "Overdue 3d" phrase is a different key, `fields.relativeDate.overdue`, and stays in every pack.
- ce464d9: An object-bound timeline no longer heads every past date "Overdue": a day before today goes under a neutral "Earlier" bucket, translated in every language (objectui#11676).
  
  Without a `groupByField`, `ObjectTimeline` groups its entries into date buckets, and every day before today went under "Overdue", whatever the date meant. The showcase's Activity Timeline, bound to `created_at`, put all ten tasks under "Overdue", the two Done ones included. A creation date cannot be overdue, and a closed record cannot be either.
  
  "Overdue" needs two facts: that the date is a due date, and that the record is still open. Nothing the timeline reads declares either one. The timeline configuration (`startDateField`, `endDateField`, `titleField`, `groupByField`, `colorField`, `scale`) names no due-date role, and no field option marks a closed state. So a past day is now "Earlier", and the timeline does not guess either fact from a field name or a status value. Today, Tomorrow, This week, Next week, Later and No date are unchanged.
  
  **Widened public surface (`@object-ui/i18n`).** One new key in all ten language packs, `timeline.bucket.earlier`, so the exported `en` pack and the `TranslationKeys` type derived from it gain one member. The timeline no longer reads `timeline.bucket.overdue`, and this release also removes that key from every pack (the "Overdue" bucket label retirement entry). No component prop or exported type changes.
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
- b403bb3: **`BaseSchema` no longer declares `[key: string]: any`** (objectui#8347, executing the objectui#7927 ruling: the TypeScript face is a contract). Every node type extends `BaseSchema`, so a node literal annotated with its node type now refuses a key that no declaration names, a misspelled key included, where it used to type it `any`. The correct spelling compiles as before.
  
  **Clause-②: yes (narrowing)**, shipped as `minor` per this repository's version policy. The removal narrows the TypeScript authoring face of every node type; the `visibleWhen` change below widens both faces to the envelope the spec's own parse writes.
  
  - **What does not move.** The zod faces keep their accept sets for every key but `visibleWhen`: the tolerant mirror is still `.passthrough()`, so `safeValidateSchema` keeps an undeclared key, and the derived strict face refuses it as before. `ComponentRendererProps`, the renderer props type, keeps its own index signature. Nothing a renderer draws changes.
  - **The bound.** TypeScript runs its excess-property check only on a fresh object literal. A value that reached its annotation through a variable of a wider type is not re-checked.
  - **`PartialSchema<T>` works as written.** With the signature gone, `keyof T` is the literal member union again, so the alias keeps `T`'s declared members, optional, with `type` required. While the signature stood it declared `type` alone (objectui#6397).
  - **`BaseSchema.visibleWhen` is the spec's `EvaluatedExpressionInput`**, by reference: a predicate string, or the `{ dialect, source }` envelope. The zod twin takes `EvaluatedExpressionInputSchema`'s verdict without its transform, so a string parses to itself. A dialect-less envelope, an unknown dialect and a blank predicate are refused, as the spec refuses them. Both faces read `string` before, which refused the envelope a spec parse writes into this key.
  - **`@object-ui/plugin-kanban`.** `ObjectKanban` reads the `sort` the element data-source gate writes through a read type private to the package. `ObjectKanbanSchema` still declares no `sort` (objectui#8174). Nothing drawn changes.
  - **`@object-ui/plugin-timeline`.** `TimelineRenderSchema`, the `schema` prop type of the exported `TimelineRenderer`, gains one optional member: the `onItemClick` slot `ObjectTimeline` composes. That is a one-member optional widening of an exported prop type. `TimelineSchema`, the authoring face, still declares no `onItemClick`. Nothing drawn changes.
  
  **Migration.** Where a literal stops compiling, the key is misspelled (fix it) or not declared on that node type (declare it on the type that reads it, by reference to the `@objectstack/spec` row, or remove it). Do not cast past the error. `props`, the legacy alias of `properties`, is not declared on the TypeScript face; the renderer still reads it, so write `properties`.

### Patch Changes

- c0862c1: The `object-gantt` `markers` input and the `object-timeline` `items` and `mapping` inputs open their descriptions with the `@objectstack/spec` 17.7.0 row's own describe text, which is true of these renderers (objectui#11168's rule, followed at objectui#11717). The renderer-specific sentences after it are unchanged.
- 206505c: An object timeline with a `groupByField` draws one group per value, headed by the value's display name (objectui#12104).
  
  - **A lookup groups by the referenced record's name.** The timeline's own query expands every declared relation, so a lookup value arrives as the related record, and the group header used to read "[object Object]" for every row: a timeline grouped by an owner or an account drew one group. The group key now reads the field's display value through the same resolver the entry title and description use. A select field still groups by its option's label. An empty value groups under "Unassigned", and when no row has a display value the timeline keeps its date buckets. A lookup that arrives unexpanded groups under its id, which is what the title shows for it too.
  - **A key's rows are gathered into one group.** Entries are sorted by start date, and a group used to end wherever the next entry had another value, so a field whose values alternate in date order (a channel, say) drew the same header many times. Each value now heads exactly one group. Groups appear in the order of their earliest entry, and entries stay in date order inside each group, so a timeline whose values were already contiguous renders as before.
  
  Unchanged: a timeline with no `groupByField` (its date buckets), the horizontal timeline, which draws no groups and keeps its date order, and the group key of a multi-valued field (a multiselect, tags, or a lookup with `multiple`), which reads as before. Nothing is added to the package entry: no export, prop or language-pack key.
- 1e6d83b: Data-bound blocks title their "data source could not be resolved" panel in the page's language (objectui#12920, the family of objectui#12910). The panel shows when a block's `dataSource.view` names a view its object does not have. Each block's title now reads `@object-ui/i18n` through `useObjectTranslation`, with the `en` pack's value as the inline default, so a page with no `I18nProvider` draws the same English it drew before.
  
  - **Plugin blocks.** `object-calendar`, `object-chart`, `object-metric`, `object-pivot`, `detail-view`, `record:related_list`, `object-form`, `embeddable-form`, `object-master-detail-form`, `record:line_items`, `object-gantt`, `object-grid`, `object-kanban`, `list-view`, `object-map` and `object-timeline` read one `element.KIND.sourceUnresolved` key per block kind. `object-metric` reads `element.number.sourceUnresolved`, the key `element:number` already reads for the same sentence. The three forms share `element.form.sourceUnresolved`. `record:related_list`'s panel for a failed `parentDataSource` read reads `element.relatedList.parentUnreadable` ("This related list’s parent record could not be read").
  - **`@object-ui/react` panel defaults.** `ElementDataSourceErrorPanel` with no `title` reads `element.component.sourceUnresolved`, and `NoDataSourcePanel` with no `title` reads `element.component.noDataSource`. A passed `title` still wins, an empty string included. Props and markup do not change.
  
  Clause-②: yes
  
  The new keys in `@object-ui/i18n` widen its exported `TranslationKeys`. No prop, input or export of these packages changes.
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
- Updated dependencies [ded4494]
- Updated dependencies [d172f63]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [3bf8894]
- Updated dependencies [e06365c]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
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
- Updated dependencies [6757a93]
- Updated dependencies [b7cd5c8]
- Updated dependencies [5330038]
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
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [97e7d4e]
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
- Updated dependencies [9b82ced]
- Updated dependencies [3821a3a]
- Updated dependencies [3eb3ec1]
- Updated dependencies [92c2a69]
- Updated dependencies [646caea]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
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
- Updated dependencies [1e6d83b]
- Updated dependencies [1e6d83b]
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
- Updated dependencies [988aa9f]
- Updated dependencies [1ce0711]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
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
- 6cd5ae3: `object-timeline` and `view:timeline` publish the ten `@objectstack/spec` 17.5.0 row keys their renderer honours, and `objectName` is no longer required (objectui#11168 slice 5, under objectui#11111 decision 3 = B).
  
  - Both registrations in `src/index.tsx` now share one list, `OBJECT_TIMELINE_INPUTS`, which adds `timeline`, `limit`, `data`, `items`, `dateFormat`, `rowLabel`, `minDate`, `maxDate`, `descriptionField` and `mapping`. The page validator (`validateTree` in `@object-ui/sdui-parser`) reported each as `unknown-prop` while `ObjectTimeline` read it. It now accepts them.
  - `objectName` drops `required: true`. A timeline drawn from `items`, `data` or a `bind` path issues no query, and the validator raised `missing-required-prop`, an error, on such a timeline, though the spec row declares `objectName` optional. Entry-click navigation still reads it, and the `objectName` and `navigation` descriptions say so: on a timeline that names no `objectName`, `page` opens nothing and `new_window` / `openNewTab: true` open a tab at a slash and the entry's `id` alone, not the record page (`src/__tests__/timelineNavigationMembers-8654.test.tsx`).
  - Two values the spec row refuses are now reported where they were not: a `dateFormat` outside `short` / `long` / `iso` is an `invalid-enum` error (it was an `unknown-prop` warning), and a `data` that is not an array is a `type-mismatch` warning (it drew nothing).
  - Each new description says what the renderer does with the key, as measured through `SchemaRenderer` in `src/__tests__/objectTimelineInputs-11168.test.tsx`. Where the spec row's own describe is true of the renderer, the description starts with it word for word.
  - The `sort` description no longer opens with "Entry order". `ObjectTimeline` draws entries composed from records by their start date, so the key orders the query, not the rail.
  - The JSDoc on `ObjectTimelineProps`'s `navigation` member states the mechanism as measured: an absent key takes `useNavigationOverlay`'s no-config branch, which calls only an `onNavigate` the timeline never passes, so it never reaches the host's record navigator. A block written without `mode` takes the `page` branch instead.
  
  No renderer code changes, so nothing changes at render time. The README and the docs page describe the record source order and each key.
- e4559d1: `TimelineSchema` now declares the presentational keys the timeline renderer actually reads
  (objectui#6170, maintainer ruling 2026-08-25 — the same family rule adopted on
  objectui#6172: the exported type aligns to the measured authored + read set).
  
  Before this, `TimelineSchema` declared `events` (required), `orientation` and `position`,
  and nothing else. `TimelineRenderer` is annotated `schema: TimelineSchema` and reads nine
  keys off that node — `variant`, `items`, `dateFormat`, `onItemClick`, `minDate`, `maxDate`,
  `rowLabel`, `scale`, `timeScale` — and **none** of the three that were declared. The docs
  property table and the registration's own designer `inputs` had agreed with the renderer
  all along; only the exported type disagreed. It was invisible to `tsc` because `BaseSchema`
  carries `[key: string]: any`, so every undeclared key resolved as `any` and the annotation
  constrained nothing.
  
  The most visible casualty was the docs page's own TypeScript example, which did not
  compile: `Property 'events' is missing in type '{ type: "timeline"; variant: string; items:
  … }' but required in type 'TimelineSchema'`. The page taught an authoring form its own
  published type refused.
  
  **Declared now** (TS interface and the `@object-ui/types/zod` mirror together): `variant`,
  `items`, `dateFormat`, `scale`, `timeScale`, `rowLabel`, `minDate`, `maxDate`. `onItemClick`
  is deliberately left undeclared — it is a runtime slot `ObjectTimeline` installs, and this
  package keeps callback-shaped keys off the authored surface.
  
  **`scale` is the canonical axis key.** It is `@objectstack/spec`'s `ui/TimelineConfig.json`
  spelling and the one `resolveTimelineScale` reads first (`scale ?? timeScale`). The designer
  now offers it, with all six buckets: `hour` / `quarter` / `year` have rendered correctly
  since objectui#2942 but were offered by neither the designer (which listed three) nor the
  exported type (which listed none), so they were authorable and undiscoverable. `timeScale`
  stays as a deprecated alias so stored JSON keeps working; retiring it is routed separately.
  
  **`events` is now optional.** It was required, which is why the documented authoring form
  did not type-check. That widening is the only non-additive change here — strictly more
  programs compile and strictly more input parses than before. `events`, `orientation` and
  `position` remain declared and remain read by nothing; a timeline authored with `events`
  still renders an empty rail. Their removal is a breaking narrowing of a published type and
  is routed through ADR-0049 enforce-or-remove as its own change, not smuggled into this one.
  
  Accept-set note for consumers: keys that previously resolved as `any` are now typed, so a
  value the renderer never implemented — `variant: 'diagonal'`, `dateFormat: 'medieval'`,
  `scale: 'fortnight'` — is a type error and a Zod rejection where it used to pass silently.
  Nothing that renders today stops rendering. `BaseSchema`'s index signature is untouched, so
  an undeclared key is still accepted by both halves (objectui#5155 / objectui#6269 own that
  ceiling).
- 9d86e1d: Retire the `timeScale` alias on the timeline node — `scale` is the only axis spelling
  (objectui#6355, maintainer ruling 2026-08-27).
  
  **BREAKING for authored metadata.** `timeScale` was this renderer's pre-spec spelling of the
  Gantt axis bucket. `scale` is canonical — it is `@objectstack/spec` `ui/TimelineConfig.json`'s
  axis key and the key the renderer preferred (objectui#6170 ruling, 2026-08-25: `timeScale`
  goes the alias-retirement route, not a silent second spelling). objectui#6355's ruling
  retires it immediately, with no phased window, while the project is at startup stage.
  
  **What breaks, and how you will find out.** A timeline document that spells `timeScale` is
  now **refused**, loudly, at the authoring boundary:
  
  - `TimelineSchema.timeScale` is declared `?: never` — writing it is a type error;
  - the Zod twin declares `z.never().optional()` — parsing a document that carries the key
    fails with `invalid_type` / `expected: never` on the `timeScale` path.
  
  The fix is a rename: `timeScale` → `scale`. The accepted values are unchanged (`hour`,
  `day`, `week`, `month`, `quarter`, `year`), so no value needs rewriting.
  
  **Why a tombstone rather than deleting the key.** `BaseSchema` is `.passthrough()` on the
  Zod side and carries `[key: string]: any` on the TS side, so an *undeclared* key is accepted
  unvalidated by both halves. Deleting `timeScale` outright would have let the retired spelling
  parse green and type-check green while the renderer no longer read it — the Gantt axis would
  silently fall back to the `month` default, the chart would change bucket, and nothing would
  error. That is the silent axis breakage objectui#2942 closed, running in the other direction,
  and it is the specific outcome this retirement is shaped to prevent. Keeping the key declared
  as `never` on both halves is what makes the removal audible. Absent stays valid on both, so a
  document that never wrote the alias is untouched.
  
  Also in this change:
  
  - `resolveTimelineScale` drops the `?? schema.timeScale` fallback read; its parameter narrows
    to `{ scale?: unknown }`.
  - The designer drops its deprecated `timeScale` input. The `scale` input already offers all
    six buckets.
  - `ObjectTimeline` now emits the resolved axis under `scale` when it composes the schema it
    hands to the renderer. It previously wrote the alias, which would have made **every**
    object-bound Gantt fall through to the `month` default the moment the fallback read went —
    silently, since that is a composed schema no author ever sees. Writing `scale` after the
    spread also restores the precedence the surrounding code intends: a `timelineConfig.scale`
    now actually beats a flat `schema.scale`, where under the alias the resolver's
    `scale ?? timeScale` ordering let the flat key win.
  - The two in-repo authors are migrated in the same change: the schema-catalog
    `gantt-style-timeline.json` fixture and the registration's own `examples.gantt` block.
  - Docs drop the `timeScale` row and gain a retirement callout;
    `packages/components/.../TIMELINE.md`'s Gantt table now documents `scale` with the full
    six-value vocabulary it has accepted since objectui#2942 (its row still claimed three).
  
  Version note: `minor`, not `major`, per AGENTS.md §版本号策略 — objectui's major tracks the
  `@objectstack` major and all publishable packages share one `fixed` group, so a breaking
  narrowing is declared `minor` with the break spelled out here.
- 3a5817f: feat(types)!: a timeline item is a declared feed item or gantt row, judged against the shape `variant` selects
  
  `TimelineSchema.items` declared an object whose keys were all open, on both the
  TypeScript type and the zod mirror. An item written `{ title, date }` therefore
  type-checked and validated, and its `date` was dropped without a word — a feed
  item's date is `time`. A gantt row on a vertical timeline, or a timeline item on
  a gantt timeline, validated too and drew an empty entry with no diagnostic. And
  the strict authoring schema refused every real timeline item, the schema
  catalog's own included, because an item that declares no keys closes to nothing.
  
  The item is now declared (objectui#6356, maintainer ruling Q1 = A, Q2 = C):
  
  - **Timeline item** (`variant` `vertical`, the default, or `horizontal`) — new
    exported type `TimelineFeedItem`: `time`, `title`, `description`, `variant`,
    `icon`, `content`, `className`. `title` is **required**.
  - **Gantt row** (`variant: 'gantt'`) — new exported types `TimelineGanttItem`
    (`label`, **required**, and optional `items`) and `TimelineGanttItemBar`
    (`title`, `startDate`, `endDate`, `variant`, all optional; a bar date is a
    string, a finite number or a `Date`).
  - Item and bar `variant` is one of `default`, `success`, `warning`, `danger`,
    `info` — new exported type `TimelineItemVariant`.
  - The zod faces gain `TimelineFeedItemSchema`, `TimelineGanttItemSchema` and
    `TimelineGanttItemBarSchema` on `@object-ui/types/zod`.
  
  **Breaking, for authors (minor per this repository's version policy):**
  
  - `TimelineSchema` validation now judges every item against the shape its
    `variant` selects. A gantt row on a vertical or horizontal timeline, or a
    timeline item on a gantt timeline, is refused, naming the missing `title` or
    `label` and each key that belongs to the other shape. A timeline item with no
    `title`, or a gantt row with no `label`, is refused.
  - An item or bar `variant` outside the five is refused, and so is a bar date
    that is not a string, a finite number or a `Date`.
  - In TypeScript, an item literal carrying a key neither shape declares (for
    example `date`, or `meta`) is an excess-property error. TypeScript cannot see
    the parent's `variant`, so a gantt row on a feed timeline still type-checks;
    validation is where that is refused.
  - In TypeScript, an element of `TimelineSchema.items` is now the union
    `TimelineFeedItem | TimelineGanttItem`, where it was an object with `unknown`
    keys. Reading a key that only one shape declares needs the element narrowed
    first — for example `'label' in item`.
  - `color`, `group`, `meta`, `startDate` and `endDate` on a timeline item are
    **not** authorable. `ObjectTimeline` composes them onto the items it maps from
    records and the renderer still draws them; they are typed inside
    `@object-ui/plugin-timeline` only, and the strict authoring schema refuses
    them by name.
  
  This supersedes two statements elsewhere in these release notes: the
  objectui#7164 and objectui#7365 entries say a row's and a bar's own keys stay
  undeclared and open and that feed timelines are untouched. Their refusals still
  hold, at the same paths — a non-object item at `items[i]`, a non-array row
  `items` at `items[i].items`, a non-object bar at `items[i].items[j]` — and on
  the tolerant `TimelineSchema` a bar still accepts keys it does not declare (the
  strict authoring schema refuses them by name), but the keys above are now
  declared, and feed timelines are judged too.
  
  `TimelineSchema` stays a zod object: its `.shape`, its place in
  `DataDisplaySchema` and the `timeScale` / `body` / `children` refusals are
  unchanged. Deriving from it with `.extend()` over an existing key now throws in
  zod 4 (the node carries a refinement); use `.safeExtend()`, which keeps it.
  
  `@object-ui/plugin-timeline` (**breaking at compile time, shipped as a
  `minor`**): `TimelineRenderer` is a public export, and its `schema` prop is now
  typed as the renderer's own input — the two declared item shapes above, plus the
  item keys `ObjectTimeline` composes (`color`, `group`, `meta`, `startDate`,
  `endDate`, `_data`, and any string as a composed item's `variant`) — rather than
  as the authored `TimelineSchema` of before, whose items accepted any key. So an
  object literal passed to the prop whose item carries a key neither shape
  declares is now an excess-property error (TS2353), exactly as it is against
  `TimelineSchema`: `schema={{ type: 'timeline', items: [{ title: 'T', date: 'x' }] }}`
  type-checked before and does not now. Fix it at the item — a feed item's date is
  `time`. What still type-checks against the prop: any value typed
  `TimelineSchema`, an `items` array that is not written as a fresh literal (for
  example an array of string-keyed records held in a variable), items that are
  empty objects, and the composed keys above.
- 20cb8db: `ObjectTimeline` refuses an undeclared date axis instead of inventing one
  (objectui#7459).
  
  Steps ① and ② of the three-step sequence the maintainer ruled on 2026-09-01
  (总监批 #28). House posture, on record with that ruling:
  日期轴永不虚构 — a date axis is never fabricated.
  
  `ObjectTimeline` resolved its date axis through five declared bindings and then
  closed the chain with a sixth rung that was a bare literal field name nobody
  has ever declared. A name therefore ALWAYS resolved: for a view that declared
  no axis, every record read a key its object does not carry, every event landed
  in the "No date" bucket, and the screen read as a timeline that had been built
  and simply had nothing in it.
  
  Two changes, shipped together because neither is observable alone:
  
  - **The renderer now refuses.** An object-bound timeline with no declared date
    axis renders a diagnostic naming every binding it accepts —
    `timeline.startDateField`, `timeline.dateField`, `mapping.date`, and the two
    deprecated flat spellings — instead of a chart. The twin of `ObjectGantt`'s
    "Gantt configuration required" screen, in the shape `5f4514f7b` settled.
  - **The invented sixth rung is gone**, which is the only thing that makes the
    refusal reachable. Added while the floor stood, it would have been dead code;
    retired without the refusal, it would have produced exactly the silent
    "No date" outcome the ruling rejects.
  
  **What changes for an author.** A view that declares a date axis is completely
  unaffected — all five declared spellings resolve exactly as before, and a
  timeline authored from literal `items` is never refused, since its items carry
  their own dates and no field name is read for them. A view that declared no
  axis anywhere, and was rendering an empty-looking timeline, now says so.
  
  ⚠️ Both premises were RE-MEASURED on the current tree before anything was
  edited, rather than taken from the card: the renderer had no absent-axis
  refusal (against a live control term that fires in the same file), and the
  floor was still present and still spelled as reported. The pairing itself is
  pinned — the refusal cases go red the moment the floor returns, including one
  whose records carry a column that happens to be named `date`, where a returned
  floor renders a convincing timeline rather than an empty one.
  
  Refusal is distinguished from "renders an empty timeline" by asserting the
  canvas is ABSENT, not merely event-free. The component's success surface is now
  named (`data-testid="timeline-canvas"`) so that distinction can be measured;
  every other terminal state of the component already named itself.
  
  Step ③ of the ruling — the `'created_at'` floors on the two plugin faces —
  stays for a later change (it landed as `04a67b9dc`) and is deliberately NOT in this change.
- 233a1b3: Declare the `filter` and `sort` inputs on the `object-map`, `object-gantt`,
  `object-timeline` and `view:timeline` registrations (objectui#8220) — the html
  tier stops reporting `unknown-prop` on two keys the spec declares and all three
  renderers read.
  
  objectui#7712's and objectui#8171's defect, three blocks over. `ObjectMap`,
  `ObjectGantt` and `ObjectTimeline` each lower the authored keys onto their own
  query — `$filter` (the authored `filter`, its context tokens resolved first) and
  `$orderby: convertSortToQueryParams(schema.sort)` — but none of the four
  registrations publishing those renderers listed either key in `inputs`, and
  `sdui-parser`'s `validateTree` reports `unknown-prop` for every key no `inputs`
  entry claims. An author writing the spelling that works was told it was unknown.
  
  Unlike the kanban and calendar cases, these three blocks had no spec row when the
  defect was filed, so declaring the keys then would have published an authoring
  surface no contract backed. That order is now met on the installed package:
  `@objectstack/spec` 17.5.0 maps `object-map`, `object-gantt` and `object-timeline`
  in `ComponentPropsMap`, each row declaring `filter` as the `ViewFilterRule` array
  and `sort` as the `SortItem` array. ADR-0049 enforce-or-remove therefore resolves
  toward **declare**: both keys have live readers on both ends.
  
  Both keys are declared `type: 'array'`. For `filter` that is the rule-array arm
  `[{ field, operator, value }, ...]` and nothing else: the spec refuses the
  MongoDB-style record form at all three doors, and with the key declared as an
  array the html tier now refuses it too, as a `type-mismatch`, instead of passing
  it as an unknown key. `sort` takes `[{ field, order }]`.
  
  `view:timeline` declares the same pair as `object-timeline`: it is the same
  renderer under a second tag, the `view:calendar` precedent. The map's and the
  gantt's bare `view:` twins are already retired (objectui#10393, objectui#8008),
  so four registrations carry the declaration, not six.
  
  Pinned per plugin in `__tests__/queryKeysDeclared-8220.test.tsx`: the real
  validator over a manifest built from the live registry, with an undeclared-key
  control; the installed spec row's verdict on the same values; and a mount through
  `SchemaRenderer` showing the rule array reach `$filter` and the sort items reach
  `$orderby` on every tag.
  
  Not changed here: the console's `registry-inputs-spec-parity` ledger. It does not
  load these three plugins yet and books the blocks as unjudged, owed to
  objectui#11168, so this change moves none of its rows.
  
  **Note, 2026-10-02 (objectui#11168 slice 5, shipping in this same release).**
  The last paragraph above says the console's `registry-inputs-spec-parity` gate
  does not load these three plugins yet and books the blocks as unjudged. That no
  longer holds for the release: objectui#11168 loaded all three in this same
  release (`object-map` in slice 3, `object-gantt` in slice 4, `object-timeline`
  in slice 5), so the gate judges each registration in both directions, and its
  unjudged-block ledger books none of them. This change itself still moved none
  of those rows.
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
- 95bd23c: `navigation` is declared on the `object-timeline` block, by reference to `@objectstack/spec` (objectui#8654). This is the timeline arm of the objectui#8652 maintainer ruling: the spec declares the key on the `object-timeline` element from 17.5.0, for the block standalone, and objectui now mirrors it.
  
  - `ObjectTimelineProps['schema']` declares `navigation` with the spec's `NavigationConfig` type (`ViewNavigationConfig`), the type the grid, kanban and calendar schemas use. `ObjectTimeline` reads the key without a cast. `TimelineSchema` in `@object-ui/types` is unchanged: it describes the presentational rail, which does not read the key.
  - The `object-timeline` and `view:timeline` registrations publish `navigation` in their `inputs`, so the designer offers it.
  - An authored `{ "type": "object-timeline", "properties": { … } }` document was already judged by the spec row: a bad `mode` is refused at `properties.navigation.mode`, and a member the spec does not declare inside the block is refused. That is unchanged and now pinned.
  
  What a click does with each member is unchanged. `drawer`, `modal` and `popover` open the entry's record in that overlay, and `new_window` or `openNewTab: true` opens the record page in a new tab. Three things open nothing on a timeline that no parent view navigates for: an absent key, `page` (also what a block without `mode` resolves to), and `split`. The published input description says so.
  
  **Note, 2026-10-01 (objectui#11168 slice 3, shipping in this same release).**
  The last paragraph above says `page`, and a block without `mode`, open nothing
  on a timeline that no parent view navigates for, and that the published input
  description says so. objectui#11293 changed that in this same release: a
  `page` click with no `onNavigate` now goes to the record navigator the host
  publishes, which the console publishes on its custom pages, record pages and
  list views. Under such a host `page` and a block without `mode` open the record
  page. They open nothing only under a host that publishes none, such as an
  embedded renderer. The input description now says so (objectui#11168). An
  absent key and `split` still open nothing.
  
  **Note, 2026-10-02 (objectui#11168 slice 5, shipping in this same release).**
  `objectName` is no longer required on `object-timeline` / `view:timeline`: a
  timeline drawn from `items`, `data` or a `bind` path names none. On such a
  timeline there is no record page. `page`, and a block without `mode`, open
  nothing even under a host that publishes its record navigator, and
  `new_window` or `openNewTab: true` open a tab at a slash and the entry's `id`
  alone, not the record page. So "opens the record page in a new tab" above, and
  "they open nothing only under a host that publishes none" in the earlier note,
  hold for a timeline that names its `objectName`. The input description says
  so.
- a9d97be: Close the numeric-falsy `SchemaNode` slot class: a slot may no longer guard itself
  (objectui#9162, triage ruling 2026-09-12).
  
  **What leaked.** `{schema.footer && <CardFooter>…</CardFooter>}` does not evaluate to
  `false` when the slot is falsy — it evaluates to the **slot**, and React renders
  numbers. A node slot's published zod face carries a `z.number()` arm
  (`nodeUnionOptions`, `packages/types/src/zod/base.zod.ts`), so `footer: 0` is **legal
  authored input**, and it painted a stray `0` into the DOM. `NaN` painted three
  characters. The `&&` also short-circuits, so `renderChildren`'s own
  `if (!children) return null` first leg was never reached — which is why the
  objectui#8908 bridge repair could not cover any of these sites.
  
  **Why a class fix and not N instance fixes.** This class was patched one instance at a
  time three times — objectui#8331 (`DataTableSchema.emptyAction`), objectui#9033
  (`header-bar`'s `rightContent`), and then objectui#9162's census found eleven more,
  because objectui#9033's grep was keyed on the spelling of the **right** operand while
  the trap depends only on the **left** one. Nineteen guards across eight files are
  repaired here, and the construct that permits them is now refused mechanically.
  
  **The one spelling, and the gate.** `renderChildren(slot)` is the guard for a bare
  slot; the new `renderNodeSlot(slot, render)` is the guard for a slot wrapped in chrome
  that must disappear with it. Both route through one exported predicate,
  `isEmptyNodeSlot`. The new lint rule `object-ui/no-bare-node-slot-guard` refuses the
  `&&` spelling, deriving its slot set per file from the file's own text — an expression
  is a node slot there if that file hands it to `renderChildren`, `renderNodeSlot`,
  `toRenderableSchema` or `<SchemaRenderer schema={…}>`. A twelfth slot is rendered
  through one of those, so it is covered the moment it is written, with no list to keep
  up to date.
  
  **Why `minor`.** Two reasons, and neither is a contract break.
  
  1. `@object-ui/components` gains public API: `renderNodeSlot` and `isEmptyNodeSlot` are
     new exports. A new export is a `minor` on its own.
  2. Published renderers change what they emit for two authored inputs. A node slot
     authored `0` / `-0` / `NaN` stops painting that character — that is the defect, and
     no author asked for it. A node slot authored `[]` no longer renders its empty chrome
     (an empty `CardHeader` / `CardContent` / `CardFooter` / `DialogFooter` /
     `SheetFooter` / `DrawerFooter` / `TableFooter`, or `plugin-detail`'s wrapping
     `div`); the chrome now appears and disappears with its content. Measured across
     `examples/`, `content/` and `apps/`: **zero** authored node slots carry a numeric
     value, and the single authored `"children": []` is on `div`, which never had the
     `&&` guard and is unaffected.
  
  ⛔ Deliberately **not** marked `**BREAKING**`: no authored input stops being accepted,
  no export is removed, no key stops being read, and objectui#7105 is respected — the
  declarations are untouched and node slots still relax the renderer. An author who
  genuinely wants the character `0` writes `"0"` or a `text` node, both unchanged.
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

### Patch Changes

- aa38e19: A timeline no longer crashes when its `titleField` or `descriptionField` names a lookup.
  
  `ObjectTimeline` copied the raw `titleField` and `descriptionField` values onto each
  item, and the renderer puts both in JSX. A lookup is a field like any other, and
  `ObjectTimeline`'s own object fetch expands every declared relation, so a
  lookup-typed title or description arrived as `{ id, name }`. React then threw
  `Objects are not valid as a React child` as soon as the rows landed, and the whole
  timeline failed to render.
  
  The item mapping now derives the title and the description once, as display
  strings, through `@object-ui/core`'s `recordDisplayValueAt`, the resolver
  `ObjectMap` uses for the same two slots:
  
  - an expanded lookup shows its display name;
  - a plain string, a number or a bare id shows as before;
  - a boolean shows as its string, where the old truthiness gate dropped `false` and
    drew an empty line for `true`;
  - a `0` shows inside its title or description line, where it used to be painted as
    a bare character beside it;
  - an empty or whitespace-only value, or an expanded record with no display name,
    shows no line, and surrounding whitespace is trimmed.
  
  No schema or spec key changes. `ObjectTimeline.lookupDisplay-10530.test.tsx` pins
  each case above.
- 02e6d36: Five more page blocks re-read when the data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a write to the object they read (objectui#10623). These blocks read neither `onMutation` nor the bus, so any write — through the data source or past it (a page action over raw HTTP, a flow, a server action) — showed only when something remounted them. Each fetch effect now names the `useDataInvalidation` nonce for its object; an unscoped change (`'*'`) matches too, and a change to another object does not.
  
  - `@object-ui/plugin-timeline`: `object-timeline` re-reads its rows; a canvas that already shows rows stays mounted while the re-read runs.
  - `@object-ui/plugin-list`: `object-gallery` re-reads its cards; collapsed groups stay collapsed.
  - `@object-ui/plugin-map`: `object-map` re-reads the markers it is showing without its loading placeholder, so the map stays mounted and the camera stays where the user left it. If that re-read fails, the last markers stay on the map and the failure is logged to the console, as `ObjectGantt`'s background refresh does. A changed query still shows the placeholder and re-fits the camera, even when a bus event arrives with it. Two older faults in the same fetch are fixed as well: a slow earlier answer can no longer overwrite a newer one, and a load that succeeds now takes the map off an earlier error screen.
  - `@object-ui/components`: `element:number` re-reads its aggregate and `element:repeater` its rows.
  
  Rows a host hands these blocks (`data`, `bind`, authored `items`, an inline `value` set) are still the host's to refresh; only the blocks' own queries follow the bus.
- d435e96: fix(plugin-timeline): a failed load no longer keeps `ObjectTimeline` on its error screen after a later load succeeds (objectui#10663)
  
  `ObjectTimeline` set `error` when its fetch failed, and the render returns the
  error screen early whenever `error` is set. Nothing ever cleared it. Every later
  load that succeeded still wrote its rows, but the timeline stayed on the error
  screen until it remounted. Since objectui#10623 the timeline re-reads on every
  data-invalidation event, so one failed background re-read was enough.
  
  The current run of the fetch now clears the error when it commits rows: those
  rows answer the current query, so the earlier failure no longer describes the
  screen. This is the rule objectui#10578 set for `ObjectGantt`. The error is not
  cleared when a run starts; it stays until rows land.
  
  Only the current run writes the error at all. A run that a newer one has
  superseded can no longer clear the current run's error, or put the error screen
  over the current run's rows.
  
  A failed background re-read is still reported: the timeline has no silent mode,
  so it shows the error screen rather than keeping the last good rows, and the
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
- 93a5585: fix(plugin-timeline): an `object-timeline` block shows the rows of its current query, not an earlier answer that arrived late (objectui#10684)
  
  `ObjectTimeline` numbers the runs of its fetch, but only its `error` writes read
  that number (objectui#10663). The rows and the loading flag were written by every
  run. When the query changed while a read was in flight (a new filter, sort or
  object, or a data-invalidation re-read), the earlier answer could arrive after
  the current one and replace the current rows. An earlier read that settled first
  also cleared the loading skeleton while the current read was still in flight.
  
  Only the current run writes the rows and clears the loading flag now. An answer
  from a superseded run is dropped when it arrives. The current run still clears
  the loading flag on every exit, including a failed read.
- e239161: docs(plugin-timeline): the README's "Schema-Driven Usage" example is now a document the validator accepts
  
  The example spelled its node `component: 'timeline'`. Every node in the protocol
  is keyed by `type`, so `safeValidateSchema` — the call `objectui validate` makes —
  refused the document exactly as a reader would copy it (`invalid_union` at
  `type`), and rendering it painted the registry's "Unknown component type" panel
  instead of a timeline. The README ships in this package's tarball, so the wrong
  spelling was on the npm landing page (objectui#10824).
  
  The node is now `type: 'timeline'`. The rest of the example already fits the item
  element objectui#6356 declared — a feed item with `time`, `title`, `description`
  and `variant` — so nothing else in it moves.
  
  A new pin extracts that block from the README on every run and feeds it to
  `safeValidateSchema` and to the strict authoring face, so the example cannot drift
  from the schema again without a test going red. No source or behaviour change.
- 200ceef: A `plugin-timeline:timeline` node no longer writes its own schema onto the
  page as HTML attributes (objectui#10841).
  
  `TimelineRenderer` collected every prop it did not name and spread them onto
  the root element of each variant. Created through `SchemaRenderer`, that bag
  holds every node key left after `SchemaRenderer` strips its metadata keys, so
  the rendered timeline carried `items="[object Object]"`, `variant="vertical"`,
  `dateformat="long"` and, on a gantt, `scale` / `rowlabel` / `mindate` /
  `maxdate`. React also logged an unknown-prop warning for each camelCase key.
  The renderer reads all of those keys off `schema`, so nothing it draws
  changes.
  
  The root now takes the same route as the converged renderers in
  `@object-ui/components`: the bag goes through `toDomProps`, the SDUI widget
  contract's DOM pass-through in `@object-ui/core`, and `style` is forwarded by
  name. That keeps the `data-obj-id` / `data-obj-type` locator, the
  `data-testid` an authored `testId` promises, the resolved `aria-*` / `role`,
  `id`, `tabIndex`, and the host event handlers that contract forwards
  (`dom-props.ts` declares the full set).
  
  Dropped, and no longer on the root:
  
  - every authored schema key;
  - the `disabled` attribute a disabled node used to put on the `ol` / `div`
    root, where it had no effect;
  - `name` / `label`, which `BaseSchema` declares but which have no effect on an
    `ol` / `div`;
  - an authored `title`, which the timeline node does not declare. It is a
    global HTML attribute, so dropping it removes the native tooltip it used to
    put on the root.
  
  `ObjectTimeline` hands `TimelineRenderer` its schema alone, so the object-bound
  timeline is unchanged. The prop type is unchanged.
- 9e6619f: fix(plugin-timeline,core): the timeline's gantt axis draws a stored date-only day on that day in every viewer zone, and the formula date functions do their day arithmetic on the UTC calendar, as the server does (objectui#10866, slice 3)
  
  - **Timeline, gantt variant.** Every date string the gantt branch reads now goes through `toDisplayDate` from `@object-ui/core`, the step its bar tooltip already takes: in the axis headers, the extent computed from the rows, the bar positions, the validity check and the check that the start is not after the end. A date-only value is local midnight of the day it names, and a value with a time part keeps its instant, which the axis places at its local hour in the viewer's day. A number or a `Date` is an instant and is read as before. West of UTC the headers no longer read the day before: a day axis over October 5th to 7th reads Oct 5, Oct 6, Oct 7, and the schema catalog's `gantt-style-timeline.json` reads Jan 2024 to Apr 2024, where it read Dec 2023, Jan 2024, Mar 2024, Apr 2024 in Los Angeles. So the axis now agrees with the bar tooltip. The computed extent is printed as the viewer's calendar day. An empty plan's one-day axis is the viewer's today, where it was the UTC day. A bar date naming a day its month does not have, such as `2026-02-30`, is now refused by the render-time "not a valid date" message, where it was rolled into March and drawn there. `generateTimeScaleHeaders`, which the package exports, reads a date-only `minDate` / `maxDate` the same way.
  - **Formula date functions.** `DATEADD`, `DATEDIFF` and `DATEFORMAT` in `@object-ui/core` now do a calendar day's arithmetic on the UTC calendar. A date-only value naming a day its month has is read as UTC midnight of that day, as before, and is now moved and read with UTC setters and getters, so what the three answer for a day no longer depends on the viewer's zone. `DATEADD` hands such a day moved by days, months or years back as `YYYY-MM-DD`, where it gave an instant string. Its months clamp to the target month's last day, as the server's `addMonths` does: `DATEADD('2026-01-31', 1, 'month')` is `2026-02-28`, where it was `2026-03-03T00:00:00.000Z` in every zone, and a year from February 29th is February 28th. West of UTC, `DATEFORMAT('2026-09-01', 'YYYY-MM-DD')` no longer prints `2026-08-31`, `DATEDIFF` in months or years counts between the stored days rather than the days before them (`DATEDIFF('2026-08-31', '2026-09-01', 'month')` read 0), and a day added across a DST change no longer lands an hour off midnight. A value with a time part is unchanged: it is still moved and read in the viewer's zone and comes back as an instant, so `DATEFORMAT` still prints an instant's clock in the viewer's zone. So is a date-only value naming a day its month does not have, which the engine rolls forward as before. `TODAY()` is unchanged.
- eb97ce6: fix(plugin-timeline,plugin-charts,i18n): a stored date-only day reads as that day in every viewer zone on the timeline, on a chart's date axis and in the published date helpers (objectui#10866, slice 2)
  
  These readers parsed a `YYYY-MM-DD` value with the engine's own `Date` parse, which reads it as UTC midnight, so every viewer west of UTC saw the day before. Each now reads the value through `toDisplayDate` from `@object-ui/core`, which rebuilds a date-only value at local midnight of the day it names. A value with a time part keeps its instant.
  
  - **Timeline.** The object timeline's date bucket, its sort and the item date the renderer prints read the value that way. West of UTC an item due today no longer sits under "Overdue", one due tomorrow no longer sits under "Today", and the `short` and `long` item faces print the stored day. The `iso` face prints a date-only value's day from local getters, and an instant's UTC day as before. A day its month does not have, such as `2026-02-30`, is no longer rolled into March: the item sits under "No date", sorts with the dateless items, and its `short` and `long` faces are the ones an unparsable value already had. An unparsable value now sorts with the dateless items too, and the `iso` face prints such a value as written where it used to throw. The gantt variant's axis headers, extent and bar positions are not changed here, so west of UTC its bar tooltip, which prints through the same item-date function, now names the stored day while the axis above it still reads the day before, until a later slice of objectui#10866.
  - **Charts.** A date-only category on the x axis reads `Sep 1` for `2026-09-01`, and `Sep 2026` on a month-grained axis, in every zone. When the display locale is a tag `Intl` refuses, the tick still prints the stored day: it reads the local-midnight value with local getters, because its `toISOString()` would name the day before east of UTC. An instant's fallback keeps its UTC day. A date-only category naming a day its month does not have falls back to the raw category, the face any other non-date category gets, instead of the rolled day.
  - **i18n helpers.** `formatDate`, `formatDateTime`, `formatRelativeTime` and `formatDateSpec` read a date-only string as the day it names: `formatDateTime` shows midnight of that day, and `formatRelativeTime` counts to the start of it. `formatDateSpec` applies its `timeZone` to an instant only, and formats a date-only value in the local zone, where the shared step's local midnight reads back as its day; a `timeZone` west of UTC no longer turns `2026-09-01` into August 31st for every viewer. All four return a day its month does not have as the raw string. `formatRelativeTime` now returns an unparsable value as its string, the face the other three already gave one, where it used to throw a `RangeError`.
- 2fb0f9a: fix(plugin-timeline): a gantt-variant timeline draws its headers and bars on one continuous axis, so each bar lines up under its header (objectui#11079)
  
  - **Bars now sit under their headers.** The header row was one equal-width column per unit from the first date to the last date inclusive, while the bars were measured on the span from the first date to the last date, one unit shorter. So every bar after the first sat off its column: on a day axis over October 5th to 7th, the bar starting on the 6th was drawn halfway across the chart under a column that starts at one third. Both are now drawn on one axis, from the start of the first unit to the end of the last. A bar that starts on a day, a month or a quarter begins exactly where that unit's header begins.
  - **Each header is as wide as its unit is long.** Hour, day and week columns are equal. A month column is as wide as its days, so February is narrower than January, and a quarter or a year is as wide as its days. Across a daylight-saving change a day column is 23 or 25 hours wide, as the day is.
  - **Each unit starts on its boundary.** A month axis from January 15th to April 10th now has an April column, and one from January 31st no longer skips February. `generateTimeScaleHeaders`, which the package exports, returns these labels.
  - A task that starts and ends at the same instant is a zero-width bar at that instant, as it already was on any plan with two distinct dates. A plan whose only dates were one such day used to draw that bar across the whole chart.
- c27b575: fix(plugin-timeline,types): a gantt-variant timeline draws a date-only end through the end of that day (objectui#11112)
  
  - **A date-only `endDate` is inclusive.** A bar authored `2024-01-01` to `2024-01-31` now fills January and ends exactly where the February column begins. It used to end at the start of January 31st, one day short of its column. A bar that starts and ends on the same day is now one day wide, where it was zero wide. An end with a time part, or given as a number or a `Date`, is still an instant, and the bar ends exactly there, so a task that starts and ends at the same instant is still a zero-width bar at that instant.
  - **The computed axis reaches the end of every bar.** On an `hour` axis, the axis a gantt computes from its bars now runs through the last day of a date-only end, and to the hour of an instant end. It used to stop after the first hour of the last day, so those bars ran off the chart. A `minDate` / `maxDate` the author pins is still exactly the author's range, and the other scales gain no column.
  - The bar tooltip still prints the end as authored.
  - `TimelineGanttItemBar.endDate` in `@object-ui/types` now documents the inclusive reading, on both the TypeScript type and its zod description. What it accepts is unchanged.
- 858eafb: fix(plugin-gantt,core,plugin-timeline): both gantt surfaces read a date-only end inclusively through one core rule, and a drag writes the same day back (objectui#11141)
  
  **A widening: `@object-ui/core` gains two exports**, `toDisplayEndDate(value)` and `toInclusiveEndDay(end)`, on its published entry beside `toDisplayDate` (the same file, `utils/date-display.ts`, re-exported by `export *`). Nothing else in `@object-ui/core` is added, removed, renamed or retyped.
  
  - **A date-only end is inclusive on the object gantt too.** `ObjectGantt` read a stored end like a start, as the named day's local midnight, so every bar was drawn one day short and a successor starting the next day stood one day after its predecessor. The schema catalog's own plans drew that way. A task from `2024-01-01` to `2024-01-15` now runs through January 15th, and a successor starting `2024-01-16` begins exactly where it ends, as the timeline's gantt already drew it (objectui#11112). A task whose date-only start and end name the same day is now one day long, where it was a zero-length milestone. An end with a time part is still an instant, and the bar ends exactly there. Baseline ends read the same way.
  - **One rule, in `@object-ui/core`.** `toDisplayEndDate` reads an end: a date-only value becomes the start of the next day (a calendar day, so 23 or 25 hours across a DST change), and anything else is read as `toDisplayDate` reads it. `toInclusiveEndDay` is its exact inverse: it names the last day a span ending at an instant runs through. The timeline's gantt and `ObjectGantt` both read their ends through the first, so they cannot drift apart again. A day whose OWN midnight does not exist in the viewer's zone (`America/Santiago` on 2026-09-06, which starts at 01:00) now ends at the next day's midnight; the timeline used to end it at 01:00 of that next day. A day whose NEXT midnight does not exist (2026-09-05 there) still ends at the next day's first hour, as it did.
  - **A drag writes the day the bar runs through.** A dragged or resized bar whose end lands on a day's midnight writes the day before it into a date-only end field, so reading, dragging and writing a stored `2024-01-15` leaves `2024-01-15`. This also holds under a business `timeZone` whose clock skips a midnight. A `datetime` end still writes its instant.
  - **The view names that day.** `GanttView`'s End column, row date line, tooltip, drag preview and inline editor now name the last day a bar runs through, and the tooltip's day count includes it. Pressing Enter on an untouched row in the inline editor commits the end it started with. An end inside a day still names that day, and a zero-length task still names its own day. An embedder that passes `GanttView` a `Date` end directly now sees that end named as the last day the bar covers. A local-midnight end is named as the day before, which is where its bar already stopped.
  - With `autoZoomToFilter: false`, the pinned range ends on the last day any task runs through, and no longer adds an empty day column after it.
- 20d23be: The `object-timeline` / `view:timeline` `navigation` input description had three wording errors, and all three are corrected (objectui#11168 slice 3, from the contract record on objectui#8654 and the one on PR #11335).
  
  - The reason `split` opens nothing (the timeline hands the split shell no main panel) was attached to `page` and `none` as well. It now applies to `split` alone.
  - The description said `openNewTab: true` "outranks the mode". That does not hold for `none`, which is checked first, as `preventNavigation` is. The description now says `openNewTab` outranks every mode except `none`.
  - The description said `page`, and a block without `mode`, open nothing on a timeline no parent view navigates for. Since objectui#11293 they open the record page through the record navigator the host publishes (the console publishes one on its custom pages, record pages and list views), and they open nothing only under a host that publishes none. The description now says so. An absent key still opens nothing.
  
  The README and the docs page's navigation table and callout are corrected the same way. Behaviour is unchanged.
  
  **Note, 2026-10-02 (objectui#11168 slice 5, shipping in this same release).**
  "They open nothing only under a host that publishes none" above holds for a
  timeline that names its `objectName`. Slice 5 made `objectName` optional, and
  on a timeline that names none, `page` and a block without `mode` open nothing
  under any host, while `new_window` and `openNewTab: true` open a tab at a slash
  and the entry's `id` alone, not the record page. The description now says both.
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
- d813e8b: The bare `timeline` component key is now owned by DECLARATION rather than by
  module-evaluation order (objectui#6353).
  
  `packages/plugin-timeline` registers the same short name twice —
  `plugin-timeline:timeline` (`src/renderer.tsx`, the presentational renderer) and
  `view:timeline` (`src/index.tsx`, the object-bound `ObjectTimelineRenderer`). Neither
  passed `skipFallback`, so under `Registry.register` both also claimed the **bare**
  `timeline` key and the last module to evaluate won it. `src/index.tsx` re-exports
  `./renderer` (line 300) before its own `import` (line 307), so the presentational one
  registered first and the object-bound one overwrote it.
  
  The resolved outcome was the intended one and **does not change here**: `type:
  'timeline'` still renders `ObjectTimelineRenderer`, which delegates inward to the
  presentational renderer. What changes is that it is now decided rather than inherited.
  Reordering those two lines would previously have handed `type: 'timeline'` to the
  presentational renderer, which reads none of the object-bound keys (`object`, `filter`,
  `sort`, `limit`) — an authored timeline would have stopped fetching, with no error and
  no failing test. The registry's own collision guard names this remedy in its warning
  text; this applies it.
  
  `src/renderer.tsx` now registers with `skipFallback: true`, so only `view:timeline`
  claims the bare key, in any evaluation order. The presentational renderer stays
  reachable under its explicit `plugin-timeline:timeline` key, which is the lookup a
  presentational host already uses — no consumer-visible resolution changes.
  
  `src/__tests__/timeline-bare-key-ownership.test.ts` is the half that outlives the fix:
  it fails if the declaration is dropped, if a third registration starts claiming the bare
  key, or if resolution becomes order-dependent again. It reads both registrations' real
  declared metadata back out of the registry and replays them into a fresh `Registry` in
  **both** orders, so order-independence is a property under test rather than a property
  of the file the test happens to import.
- f7ea89b: An object-bound timeline with `variant: 'gantt'` refuses loudly instead of
  throwing (objectui#6655).
  
  The two timeline item shapes are not interchangeable, and this path crossed
  them. `ObjectTimeline` maps each record to a flat FEED item — one per record,
  no nested `items` — while the renderer's gantt branch reads a gantt ROW
  (`row.items[].startDate`). Every `row.items` was therefore `undefined`,
  `calculateDateRange` reduced an empty list, `Math.min()` over it was `Infinity`,
  and `new Date(Infinity).toISOString()` threw `RangeError: Invalid time value`
  mid-render. There was no guard and no diagnostic — the component simply threw.
  
  Per the maintainer ruling of 2026-08-29, the object-bound path now rejects
  `variant: 'gantt'` with an author-facing diagnostic naming the limitation
  (object-bound timelines render the feed variants; gantt needs literal rows, each
  carrying its own nested items). Composing real gantt rows from records was
  considered and NOT adopted; that capability stays open and unruled.
  
  The refusal keys on whether the items were AUTHORED, not on the variant alone,
  so a literal gantt is untouched — including the bare `timeline` key that this
  component answers, which is what the in-repo catalog fixture
  `plugin-timeline/gantt-style-timeline.json` uses. The feed variants
  (`vertical` / `horizontal`) and the presentational `TimelineRenderer` are
  unchanged.
  
  Side effect the ruling asked for: the gantt-only axis this path composes
  (`timeline.scale ?? scale`) is no longer silently inert on the gantt variant —
  an author who set it is now told why it has no effect, rather than getting a
  crash.
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
- 15b1776: A gantt timeline with an EMPTY literal `items` array renders a zero-row grid instead of
  throwing (objectui#6750).
  
  `calculateDateRange` reduced the empty list with no guard: `allDates` is `[]`, `Math.min()`
  over no arguments is `Infinity`, and `new Date(Infinity).toISOString()` throws `RangeError:
  Invalid time value` during render. Both entry points crashed identically — `TimelineRenderer`
  given `{ variant: 'gantt', items: [] }`, and `ObjectTimeline` given the same schema (an
  authored empty array is truthy, so it passes straight through as authored items).
  
  An empty gantt is the **ordinary empty state of a valid schema**, not a malformed document.
  Any author or generator that builds `items` from a collection emits `items: []` the moment
  the collection is empty — a filtered project list with no matches, a fresh workspace, a plan
  whose rows are yet to be added.
  
  The fix covers the whole gantt branch in one pass rather than the one `throw`, because
  patching only the crash site moves it two stops down the same branch:
  
  - `calculateDateRange` returns a one-day sentinel range anchored on today when the rows carry
    no dates at all. The span is one day — the smallest coherent range — because how much time
    an empty gantt should show is a question about what an empty gantt should look like, which
    this change deliberately does not answer.
  - `generateTimeScaleHeaders` needed no change, and that is a measured verdict rather than an
    assumption: a degenerate `min === max` range is not inverted, so the loop runs once and
    every scale emits exactly one bucket. The empty gantt therefore gets a real one-column axis,
    not a header row with zero cells.
  - `calculateBarDimensions` gains a `totalDuration === 0` guard. A zero-width axis — every task
    starting and ending on the same day, or an author pinning `minDate === maxDate` — divided
    `0 / 0` into `NaN`, and the bar was handed `left: NaN%; width: NaN%`. That is not a crash
    and not a visible error: the CSSOM rejects both declarations, so React left the element with
    no `style` attribute at all and the bar rendered unpositioned and zero-width. On a zero-width
    axis every task covers the whole of it by definition, so the guard returns `{ start: 0,
    width: 100 }`.
  
  An author-pinned `minDate` / `maxDate` is untouched by the sentinel: the gantt branch resolves
  `schema.minDate || dateRange.minDate`, so a pinned range with `items: []` renders exactly that
  range with no rows in it — most likely what the author wanted, and free.
  
  **No product judgment about what an empty gantt should look like.** "Do not crash" is a
  correctness floor; whether the empty case should become the repo's standard empty-state panel
  instead of a zero-row grid is a separate, still-open question, and substituting one here would
  have been taking a decision that was left open on purpose. objectui#6655's object-bound gantt
  refusal is also untouched and stays keyed on whether items were authored, which is precisely
  why it does not fire on this case.
- 4f3a1e2: fix(plugin-timeline): refuse an unusable gantt date range with a diagnostic that names the offending value
  
  A gantt whose date range cannot be used now renders a `role="alert"` diagnostic
  naming the value that made it unusable, instead of crashing or drawing a chart
  that is confidently wrong. Two input classes, which failed in opposite
  directions:
  
  - A date that does not parse threw `RangeError: Invalid time value` mid-render —
    the same crash site objectui#6750 guarded for the empty list, on a different
    input. This covers a malformed value (`startDate: 'not-a-date'`), an absent
    one, and an unparseable `minDate` / `maxDate` pinned on the schema.
  - An inverted pinned range (`minDate` after `maxDate`) drew a bar at
    `left: 157.9%; width: -4.3%` under a header row with zero cells, with no
    error and no diagnostic.
  
  Valid gantts, the empty-list sentinel from objectui#6750 and the degenerate
  `minDate === maxDate` axis are unchanged.
- e661d63: fix(plugin-timeline): refuse a `null` gantt date instead of drawing it at the epoch
  
  `new Date(null).getTime()` is `0`, not `NaN` — the Unix epoch, not an invalid
  date — so a `null` `startDate` / `endDate` passed the objectui#6759 parse guard
  and reached the arithmetic as `1970-01-01`. One row item with `endDate: null`
  drew a 649-column axis spanning 1970 to 2024 and a bar at
  `left: 100%; width: -100%`, with no error and no diagnostic; a `null`
  `startDate`, or both null, drew a bar with entirely plausible geometry on an
  axis anchored in 1970 — a chart a reader would believe.
  
  A `null` row date now renders the same `role="alert"` diagnostic objectui#6759
  established, naming the authored path and spelling the value as `null`. This is
  consistency with that card rather than a new policy: it already refuses the same
  absence spelled `undefined` (an omitted `endDate`), and which of the two a
  document carries is decided by the record mapping upstream, not by the author.
  
  Unchanged: a `minDate` / `maxDate` pinned as `null` is falsy, so the caller
  discards it and the rows' own range still renders; numeric timestamps and `Date`
  instances still render; objectui#6750's empty-list sentinel and every valid
  gantt are untouched.
- 85f6a60: Gantt dates are now judged by TYPE: a `string`, a finite `number`, or a `Date`
  — anything else is refused (objectui#6781, maintainer ruling 2026-08-30).
  
  **This is a reject-direction change. Metadata that renders a chart today can
  stop rendering one.** `new Date(x)` runs ToPrimitive on anything, so values that
  are not dates at all used to become instants silently. These now produce the
  same loud diagnostic #6759 and #6770 already use — an alert naming the authored
  path and the offending value — instead of a chart:
  
  | authored gantt date — a row item's `startDate` / `endDate`, or a **truthy** `minDate` / `maxDate` pin | before | after |
  | --- | --- | --- |
  | `false` | a 649-column axis starting Jan 1970, bar `width: -100%`, no warning | refused, named |
  | `true` | the same 1970 axis | refused, named |
  | `['2024-01-01']` | drew a normal-looking chart | refused, named |
  | `[0]` | drew a chart dated to the **year 2000** | refused, named |
  | `{ toString() { return '2024-01-01' } }` | drew a normal-looking chart | refused, named |
  | a `bigint` or a `symbol` | threw an uncaught `TypeError` mid-render | refused, named |
  
  **Falsy pins are not affected, and never were.** A `minDate` / `maxDate` of
  `false`, `0` or `''` is discarded by the renderer's existing truthy-only `||`
  before anything judges it: such a pin never produced a 1970 axis and it is not
  refused now — the chart simply uses the range computed from the rows, exactly as
  it did before. The before/after readings above are row-date readings.
  
  **If your gantt stops drawing after this upgrade, the diagnostic names the exact
  authored path** (e.g. `items[0].items[0].endDate`). Fix it at the producer: emit
  a date string (`'2024-01-01'`), a millisecond timestamp (`1704067200000`), or a
  `Date`. A boolean or an object arriving in a date field means an upstream
  mapping picked the wrong column — the chart was drawing 1970 from it before, and
  that render was never right.
  
  **`0` keeps working, deliberately.** It is a legitimate epoch timestamp — under
  a millisecond encoding an author who writes `0` means 1970-01-01 — so it is
  accepted and renders exactly as it did before. `NaN` and `Infinity` are refused,
  as they already were.
  
  Unchanged for everyone else: valid string / numeric / `Date` dates draw the same
  axis and the same bar geometry, an empty gantt keeps its one-bucket sentinel,
  and `null` / absent dates keep the identical diagnostic they got before.
- 7fc5c3c: Spell a refused gantt date by a RULE, not by `String`
  
  `spellGanttDateValue` fills the `{{value}}` hole of the unusable-gantt-date
  alert, whose job is to name the value the author wrote. Its `String(value)`
  fallback was written when nothing but `[object Object]`-shaped values could
  reach it; `85f6a6097`'s type rule routes the whole non-date type space
  through it, and it failed three ways — measured on `b458300ca`:
  
  - it **VANISHES**: `endDate: []` rendered "endDate is , which is not a valid
    date", the value gone from its own sentence;
  - it **LIES**: `['2024-01-01']` read as `2024-01-01` and `[0]` / `0n` as `0` —
    a text that IS a valid date, and a number that IS an accepted one (`0` is a
    kept gantt date), so the author was told a correct-looking value was invalid
    with no hint the wrapper was at fault;
  - it **THROWS**: `{ toString() { throw } }`, a throwing `Symbol.toStringTag`
    getter and `Object.create(null)` each crashed the render outright. #6759 built
    this helper "total by construction" and `85f6a6097` made that load-bearing, but the
    type gate only stopped `new Date` from throwing — `String(value)` handed
    control to author code one line later, so the crash class moved into the
    speller instead of going away.
  
  The rule now recorded on the helper:
  
      Spell the value when the LANGUAGE owns its spelling.
      Name its TYPE when producing text would run AUTHOR code.
  
  Every primitive keeps a spelling fixed by the grammar, so it is spelled as the
  author typed it — including `bigint`, which gains its `n` (`0n`, no longer the
  accepted `0`). A `Date` uses `Date.prototype.toString.call`, byte-identical to
  `String` but not hijackable by a subclass. Everything else is named:
  `an array`, `a function`, `an object`, chosen with `Array.isArray` and `typeof`,
  which read no author-controlled property.
  
  `JSON.stringify` is refuted, not overlooked: it throws on a `bigint` and on a
  cycle, which would put the crash class straight back. A bounded rendering is
  refused on the same ground — even an element count is not total, because
  `Array.isArray` is true of a Proxy whose `length` trap throws.
  
  Which values are refused is unchanged (that is objectui#6781's ruling), the
  `undefined` / `null` / quoted-string spellings pinned by #6759 and #6770 do not
  move, the shared inverted-range diagnostic reads identically, and no new i18n
  key is added — the article rides in the existing `{{value}}` hole.
- c17446a: Gantt date type gate: judge the `[[DateValue]]` slot, not the prototype chain
  (objectui#7027).
  
  `isGanttDateType` asked `value instanceof Date`, which answers "does this
  inherit from `Date.prototype`?" and not "is this a `Date`?". An object that
  inherits the prototype without owning the internal slot passed the gate,
  reached `new Date(value)`, ran ToPrimitive, and threw
  `TypeError: Method Date.prototype.toString called on incompatible receiver` —
  uncaught, mid-render, so the author got a blank screen where #6781's named
  diagnostic belongs. Three spellings crashed on `main`, measured:
  `Object.create(Date.prototype)`, that impostor behind a `Proxy` that throws on
  every get, and a `Proxy` with a throwing `getPrototypeOf` trap (`instanceof` is
  not total on its own terms either).
  
  Both sites now ask a total brand test that invokes the builtin
  `Date.prototype.getTime` with `.call`: it reads the receiver's `[[DateValue]]`
  slot and nothing else, so no author getter runs, no `Symbol.toStringTag` is
  consulted, and no proxy trap fires. The two brand tests the finding suggested
  were measured and rejected — `Object.prototype.toString.call` performs
  `Get(O, @@toStringTag)` unconditionally, and `Number.isFinite(value.getTime())`
  calls the author's `getTime`, which would refuse a real `Date` subclass by
  dying on it. Both are pinned as red rows.
  
  No change to which values are accepted: #6781's accept set
  (`string | finite number | Date`) is untouched, `new Date(NaN)` still passes
  the type gate and is still refused by the parse check with its `Invalid Date`
  spelling, and every newly-refused value is one no authored document can carry
  (ObjectUI metadata is JSON, which cannot spell a prototype).
- 20c04b2: A gantt timeline whose rows are malformed now refuses to draw, naming the row,
  instead of crashing the render (objectui#7164, maintainer ruling A+).
  
  `TimelineRenderer`'s gantt branch used to read the authored rows twice — once
  defensively in `findUnusableGanttDate`, once bare in `calculateDateRange` — and
  every input in the gap threw a `TypeError` mid-render from ordinary JSON:
  `items: [null]`, a row whose `items` is `5` / `true` / `{}` / an array-like
  object, or `items` itself not an array. The three readers (the date scan, the
  range computation and the render loop) now consume ONE verdict from
  `classifyGanttRows`, and a malformed shape renders the existing `role="alert"`
  refusal through a new diagnostic key,
  `timeline.gantt.unusableRange.malformedRow` — "items[0] is null, which is not
  a row shape" — never the `malformedDate` copy, which named the wrong fault.
  The key lands in `en` and the nine sibling locale packs.
  
  `@object-ui/types` (minor — the accept set narrows): `TimelineSchema.items` no
  longer declares `z.array(z.any())`. Every element must be an object, and a
  gantt row's own `items`, when present, must be an array, so `validate` refuses
  `items: [null]` and `items: [{ items: 5 }]` at authoring time — before they
  reach a renderer. Feed items (`vertical` / `horizontal`) carry no `items` key
  and parse exactly as before; every in-repo `type: 'timeline'` fixture parses
  green on both sides of the change. Rows with no bars (`items: []`, a row
  without `items`) stay the ordinary empty state and still draw.
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
- 0b6b295: Gantt: a row that is not an object is now refused instead of drawn as an empty,
  unlabelled row (objectui#7364). `items: [0]`, `items: ['x']`, `items: [true]`
  and `items: [[]]` used to render a blank row with no word to the author, while
  `validate` already refused every one of them at authoring time. The renderer now
  agrees with `validate`: the chart shows the existing
  `timeline.gantt.unusableRange.malformedRow` diagnostic, naming the row's path
  and value (for example `items[0] is 0, which is not a row shape`). No new i18n
  key and no locale pack change. Well-formed object rows, a row with no `items`
  key and a row whose `items` is `null` draw exactly as before.
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
- 37043cf: `ObjectTimeline` waits for the object definition instead of querying twice
  (objectui#7895).
  
  It was the last member of the set objectui#6482 converged on the shared
  settled-schema gate — `ObjectKanban`, `ObjectView`, `ObjectCalendar` and
  `ObjectTree` were named there, `ObjectGantt` was ask 2 of objectui#7225 — and
  nothing marked it a deliberate exclusion. It still held the object definition in
  a local `useState` fed by its own metadata effect, and listed that definition in
  the record-fetch effect's dependency array.
  
  **User-visible.** Every object-bound timeline load issued **two** `find` calls
  instead of one: the first before the definition landed, with `buildExpandFields`
  seeing no fields and therefore carrying no `$expand` at all, and a second one
  after. Whenever the metadata read is the slower of the two — the common case on
  a cold metadata cache — the second call is not merely a wasted round trip but a
  **three-step paint**: raw foreign-key ids, back to the loading skeleton (the
  effect's re-run calls `setLoading(true)` and `loading` is an early return), then
  the expanded rows. After this change the timeline paints once, from a query that
  already carries its expansion.
  
  Measured on the component with an instrumented renderer, one mount per hold,
  `getObjectSchema` held 0/1/2/3/4/5/6/7/8/9/10/15/25/50/100 ms, with
  `ObjectCalendar` and `ObjectGantt` as positive controls in the same run: before,
  2 `find` calls with expand sets `[null, ['owner']]`, 1 paint at the readiness
  predicate and 3 late writes after it at every hold from +3 ms up; after, 1 `find`
  carrying `['owner']`, 1 paint, 0 late writes, and a first-paint time that tracks
  the hold (8 ms at +3, 30 ms at +25, 105 ms at +100) where before it was a flat
  3-7 ms at every hold. Both controls read 1 paint / 0 late writes before and
  after.
  
  The resolution half is now `useSettledSchema` from `@object-ui/react`, which
  settles on **every** exit — no source, no `getObjectSchema`, no object name, and
  a read that threw alike. That is what makes the gate safe: the replaced effect
  returned without settling on all four, which cost nothing while nothing waited on
  it and would have held a gated query open forever. Pinned by
  `ObjectTimeline.fetchGate-7895.test.tsx`, including a timeline whose adapter
  exposes no `getObjectSchema` and one whose definition read rejects — both still
  query, unexpanded.
  
  Unlike the two sibling conversions, the metadata read is **not** disabled for a
  timeline whose items were authored inline: this component also reads the
  definition's fields for option colours and field labels on that path, where no
  record query is issued at all.
- dc49246: Refuse a row cap the contract already refuses before it reaches `$top`, at the
  three read points that still forwarded one — `object-kanban`, `object-timeline`
  and each `record:reference_rail` entry (objectui#9925).
  
  Each of these blocks spelled its row cap as a bare `?? DEFAULT`. `??` rejects
  only `null` and `undefined`, so a value the contract refuses was not nullish and
  survived as a real fetch window: it reached the adapter as `$top: 0`, the block
  asked the server for nothing, and the empty board / empty rail / empty card
  named no cause. A negative went out the same way, and a non-integer became a
  fractional window.
  
  All three now go through one resolver per site, mirroring the shape objectui#9853
  landed on `ObjectGrid` and objectui#9897 repeated on `ListView` — one resolver at
  every entry is what keeps the answer single. A refused value is dropped, the
  site's own default is used, and one `console.warn` names the block, the object
  and the value. The warning is conditional and deduped: an absent `limit` and a
  usable one both stay silent, and one declaration warns once rather than once per
  render.
  
  This closes BOTH entrances into these blocks, which is why the repair is at the
  read point. Each block reads one key, and two authoring shapes fill it: a
  `dataSource` binding lowers a named view's `pagination.pageSize` into it, and a
  block with no binding at all carries the authored `limit` straight through. A
  repair at the lowering layer would close only the first.
  
  Refusing these is not a renderer choosing a meaning. `@objectstack/spec` declares
  every one of these members a positive integer — `object-kanban`'s `limit`, the
  element data source `limit` a binding lowers into `object-timeline`'s, and the
  rail entry's own `limit` on `ReferenceRailEntrySchema`.
  
  ⛔ No fallback literal changed. Each site keeps the default it already
  documented; the rail's was spelled inline twice and is now one named constant so
  its two read points cannot drift.
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
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [6ce001a]
- Updated dependencies [162621b]
- Updated dependencies [4c6f549]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e686f4d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
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
- Updated dependencies [93a689d]
- Updated dependencies [4357a27]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [8740e86]
- Updated dependencies [d22b37b]
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
- Updated dependencies [f905090]
- Updated dependencies [9c78ebe]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [41ae65b]
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
- Updated dependencies [67fc3b0]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
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
- Updated dependencies [aa08d7e]
- Updated dependencies [3a43a15]
- Updated dependencies [868e825]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
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
- Updated dependencies [676f677]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [55ba3ff]
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
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
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
- Updated dependencies [b655a9d]
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
  - @object-ui/mobile@17.7.0
  - @object-ui/permissions@17.7.0

## 17.6.0

### Patch Changes

- Updated dependencies [88085e3]
- Updated dependencies [69251bf]
- Updated dependencies [57e668f]
- Updated dependencies [516663d]
- Updated dependencies [41ac1b7]
- Updated dependencies [1eaf0a1]
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
- Updated dependencies [5458414]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [616a2a5]
- Updated dependencies [0046d8f]
- Updated dependencies [f1d4748]
- Updated dependencies [bea374e]
- Updated dependencies [b1119ec]
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
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [7458a41]
- Updated dependencies [ad13d63]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [9c60144]
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
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0
  - @object-ui/mobile@17.6.0

## 17.5.0

### Minor Changes

- 01c9188: fix(plugin-timeline): dates follow the active locale instead of a hardcoded en-US

  A `zh` console rendered a fully Chinese timeline widget whose axis read
  `Aug 11` / `Sep 2026` and whose item dates read `August 11, 2026`
  (objectui#4513). `renderer.tsx` handed `Intl` a literal `'en-US'` at four sites
  — the hour, day and month gantt headers, and the `long` item date — so nothing
  a user or a tenant configured could reach them.

  A fifth site was the same defect spelled as an omission: the `short` item date
  called `toLocaleDateString()` with no tag at all, which means the _machine's_
  locale. It agreed with the other four only by the accident of an en-US runner,
  and rendered a third locale on anyone else's machine.

  All five now resolve through `useDisplayLocale()` from `@object-ui/i18n`
  (tenant regional default → active UI language → `en`) — the one channel every
  field, number and currency renderer already uses, converged there in
  objectui#4468. The locale is read once in `TimelineRenderer` and threaded into
  the two module-level date helpers, which cannot host a hook themselves.

  English output is byte-identical at all five sites: `'en'` and the retired
  `'en-US'` produce the same forms, and `generateTimeScaleHeaders` gained an
  optional trailing `locale` parameter that defaults to `'en'`, so existing
  three-argument callers are unaffected. The locale-free header vocabularies
  (`Week n`, `Qn YYYY`, `YYYY`) and all non-date rendering are untouched.

- 0082db8: The timeline's gantt bucket labels and its row-label default speak the session language

  objectui#4513 routed every `Intl` call in the timeline renderer through `useDisplayLocale()`, so a Chinese session renders `2026年8月` on the month axis and `2026年8月11日` on item dates. Three sibling strings in the same renderer never went through `Intl` at all and stayed English on that same Chinese axis: the `week` header (`Week 1`), the `quarter` header (`Q3 2026`), and the gantt row-label column default (`Items`). The half-fixed state was the visible one — a Chinese date axis with English bucket labels beside it.

  They are a translation concern rather than a locale-resolver one, and that distinction is the fix: a locale TAG formats a date, only a TRANSLATION spells a word. All three now resolve through the package's existing channel — `useTimelineTranslation` / `TIMELINE_DEFAULT_TRANSLATIONS`, the `createSafeTranslation` factory `ObjectTimeline` already uses for `timeline.bucket.*` — under three new keys carried by all ten locale packs: `timeline.scale.week`, `timeline.scale.quarter`, `timeline.gantt.rowLabel`.

  The week number and the quarter/year ride the channel's own `{{hole}}` parameters rather than being concatenated, because the word order belongs to the translation: Chinese puts the year first (`2026年第3季度`), which no `Q${q} ${year}` template can produce at all. Only the row-label DEFAULT moved — an author who writes `rowLabel` still supplies their own string, and the `year` scale stays a bare `String(getFullYear())` with no vocabulary in it to translate.

  English output is byte-identical to the retired literals: the `en` pack values are the same two templates the code used to interpolate by hand. `generateTimeScaleHeaders` is a pure exported function and cannot host a hook, so the translate fn is threaded in as an optional fifth parameter on the seam #4513 opened for `locale`, defaulting to the package's own defaults table — the same lookup the channel serves with no `I18nProvider` mounted. Existing three- and four-argument call sites are unaffected.

  One consequence is worth stating because it looks like a bug and is not: dates and vocabulary resolve through different channels on purpose. `useDisplayLocale()` puts the tenant's regional default first (how this organization writes dates), while `t` follows the UI language (what this user reads). A tenant configured `en` whose user reads Chinese chrome therefore sees `Aug 2026` beside `第 1 周` — the same split `timeline.bucket.*` has always had.

### Patch Changes

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
- Updated dependencies [d0c3b26]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [f7c6430]
- Updated dependencies [4dadf0d]
- Updated dependencies [ae10a01]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [4b70d28]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
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
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [5cc847c]
- Updated dependencies [fa21254]
- Updated dependencies [33c32bf]
- Updated dependencies [66fb4fa]
- Updated dependencies [b953a97]
- Updated dependencies [d7f3e30]
- Updated dependencies [6d641c9]
- Updated dependencies [7e4f0e5]
- Updated dependencies [c911544]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [58bebf6]
- Updated dependencies [405e808]
- Updated dependencies [49ae9f4]
- Updated dependencies [a3ae404]
- Updated dependencies [bfdf3d4]
- Updated dependencies [bb68488]
- Updated dependencies [c0f9a4b]
- Updated dependencies [b1e42d0]
- Updated dependencies [2459a3e]
- Updated dependencies [ac853ce]
- Updated dependencies [fa51109]
- Updated dependencies [d6aa172]
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
  - @object-ui/mobile@17.5.0

## 17.4.0

### Patch Changes

- 022002a: `PageComponentSchema.dataSource` now reaches the remaining object-bound public
  blocks: `object-gantt` / `object-timeline` / `object-map` / `object-pivot` /
  `object-master-detail-form` / `embeddable-form` / `record:line_items`
  (objectstack#7121).

  objectstack#6953 wired the spec's per-element data binding
  (`dataSource: { object, view?, filter?, sort?, limit? }`) to the eight blocks it
  named and left the same declaration inert on these seven. Each gates its fetch on
  its own object key and nothing mapped `dataSource.object` onto it, so a page
  written the way the spec documents rendered an empty gantt / an empty timeline
  rail / a map with no markers / an empty cross-tab / a field-less form — with no
  request and no diagnostic anywhere. Spec-valid metadata rendering nothing is the
  objectstack#4413 shape.

  Composition follows objectstack#5576's landed semantics unchanged, through the
  shared `ElementDataSourceGate` (no change to it or to the resolution layer): a
  named saved view supplies the baseline, a key written on the component itself
  overrides it, an explicit binding key overrides both, `filter` AND-combines
  ("additional filter criteria" — a binding can narrow a view, never widen it), and
  a `view` name that does not resolve renders a configuration error on every one of
  these blocks instead of degrading to the object's full scope.

  Each block maps **only** the keys it genuinely reads, which for this batch means
  several keys stay deliberately unmapped rather than being parked somewhere
  plausible:

  - `object-gantt` and `object-map` take `object` / `filter` / `sort`; neither has a
    row cap or a field-list read site.
  - `object-pivot` takes `object` / `filter`; a cross-tab orders itself by its own
    row/column grouping and cannot be computed over a truncated page.
  - `object-timeline` takes `object` only — its fetch is
    `find(objectName, { options: { $top: 100 } })`, with no filter/sort read site
    at all, so a named view is error-checked and then contributes nothing.
  - `embeddable-form` and `object-master-detail-form` take `object` only (the
    parent object, in the master-detail case); a form that writes one record has no
    collection query for `filter` / `sort` / `limit` to narrow.
  - `record:line_items` takes `object` onto **`childObject`** — the collection it
    actually lists — and nothing else: its query is the parent FK plus a fixed
    `$top: 500`, and its `columns` are editable `GridColumn` objects rather than a
    field-name projection a view could supply.

  The per-block coverage table, including every residual gap named above, is in
  `content/docs/guide/data-source.md`.

  No behaviour change for a block that carries no `dataSource`: the binding-free
  path returns the schema by reference, so nothing remounts and nothing refetches.

- 523be48: `object-timeline` and `record:line_items` now apply the filter / sort / row cap they are given, so a named `dataSource.view` narrows them instead of contributing nothing

  These were the two residual gaps in objectstack#7121's per-block coverage table
  (objectstack#7137). Both blocks are object-bound lists, both accepted the spec's
  per-element `dataSource` binding, and neither had a read site for `filter` or
  `sort` anywhere in its fetch:

  - `object-timeline`'s entire query was
    `find(objectName, { options: { $top: 100 } })`.
  - `record:line_items`' was the parent FK plus a fixed `$top: 500`.

  So `dataSource: { object, view: 'hot' }` resolved the view — a typo still reported
  a configuration error, it never degraded into an unfiltered query — and then
  dropped everything the view said. The rendered rows could be **wider than the view
  they named**, silently, which is exactly the class of mistake AI-authored metadata
  hides best: the page looks like it works. objectstack#7121 deliberately left the
  keys unmapped and recorded the gap rather than writing composed values onto schema
  keys nobody read; this closes it at the fetch instead.

  What each block now reads:

  - **`object-timeline`** — `$filter: schema.filter`,
    `$orderby: convertSortToQueryParams(schema.sort)`, and
    `$top: schema.limit ?? 100`, matching the form `object-gantt` / `object-map` /
    `object-calendar` already use. Its registry mapping gains
    `filter` / `sort` / `limit`; `columns` stays unmapped, because a timeline
    projects the fields its `timeline` config names.
  - **`record:line_items`** — the composed filter is **AND-combined** with the parent
    relationship condition through `mergeFilterNodes`, never substituted for it, the
    same way `record:related_list` composes its own since objectstack#7118: a
    line-items panel is always scoped to the record it sits on, so an _additional_
    criterion can only narrow this parent's children and can never surface another
    parent's rows. `sort` becomes the load order and `limit` the row cap (default
    500). `columns` stays unmapped — here they are `GridColumn[]` driving an editable
    grid, not a field-name projection, so a view's column list would be the wrong
    _shape_ rather than merely a wider answer.

  **Behaviour change worth knowing about:** the timeline's default window is now a
  real cap. `{ options: { $top: 100 } }` nested the limit under a key that is not a
  `QueryParams` field and that no adapter in this repo reads (`convertQueryParams`
  maps `params.$top`), so the intended window never reached the wire and a timeline
  over a large object fetched whatever the server chose to return. It is now sent as
  `$top`, and authorable via `limit` or a view's `pagination.pageSize`.

  `@object-ui/core` gains `convertSortToQueryParams`, the sort→`$orderby` lowering
  the three sibling blocks each inline privately. It is shared rather than copied
  twice more, and is slightly more faithful to the declared contract than those
  copies: a sort entry that omits `order` means ascending instead of being dropped
  (the string spelling `"amount"` already meant ascending in the same copies), and
  nothing orderable yields `undefined` rather than a truthy empty `{}`. Migrating
  the three existing copies onto it is objectstack#7148 and is not done here.

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
- Updated dependencies [c2fd122]
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
- Updated dependencies [6bb454a]
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
  - @object-ui/mobile@17.4.0

## 17.3.0

### Patch Changes

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
  - @object-ui/i18n@17.3.0
  - @object-ui/react@17.3.0
  - @object-ui/mobile@17.3.0

## 17.2.0

### Minor Changes

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
- Updated dependencies [5b084eb]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
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
  - @object-ui/react@17.1.0
  - @object-ui/types@17.1.0
  - @object-ui/i18n@17.1.0
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
- Updated dependencies [09c6a17]
- Updated dependencies [c7cff19]
- Updated dependencies [ba73a02]
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
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [263f885]
- Updated dependencies [dc334da]
  - @object-ui/components@17.0.0
  - @object-ui/i18n@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/core@17.0.0
  - @object-ui/mobile@17.0.0

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

- Updated dependencies [1c8935a]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [803558e]
- Updated dependencies [2e7d7f0]
- Updated dependencies [ef14f69]
- Updated dependencies [94d4876]
- Updated dependencies [69fa5d1]
- Updated dependencies [549c67d]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [0a3710b]
- Updated dependencies [62b9ab5]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [2331ac9]
- Updated dependencies [199fa83]
- Updated dependencies [eee4ded]
  - @object-ui/core@16.1.0
  - @object-ui/types@16.1.0
  - @object-ui/react@16.1.0
  - @object-ui/components@16.1.0
  - @object-ui/mobile@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0
  - @object-ui/core@16.0.0
  - @object-ui/mobile@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0
- @object-ui/mobile@15.0.0

## 14.1.0

### Patch Changes

- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
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
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/components@14.1.0
  - @object-ui/mobile@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [443360a]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [a44e7b6]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/react@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/components@14.0.0
  - @object-ui/mobile@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [80901aa]
- Updated dependencies [e492b9d]
  - @object-ui/components@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0
  - @object-ui/mobile@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0
- @object-ui/mobile@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0
  - @object-ui/mobile@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [6cbccf3]
- Updated dependencies [c31874d]
  - @object-ui/components@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0
  - @object-ui/mobile@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/mobile@12.0.0
  - @object-ui/react@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
  - @object-ui/react@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/core@11.5.0
  - @object-ui/mobile@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [bce581a]
- Updated dependencies [c38d107]
- Updated dependencies [7782698]
- Updated dependencies [e84d64d]
  - @object-ui/types@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/mobile@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0
  - @object-ui/mobile@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0
  - @object-ui/mobile@11.2.0

## 11.1.0

### Patch Changes

- @object-ui/components@11.1.0
- @object-ui/react@11.1.0
- @object-ui/types@11.1.0
- @object-ui/core@11.1.0
- @object-ui/mobile@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0
- @object-ui/core@7.3.0
- @object-ui/react@7.3.0
- @object-ui/components@7.3.0
- @object-ui/mobile@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
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
  - @object-ui/mobile@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [5976ba3]
- Updated dependencies [a00e16d]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [053c948]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [6c0c92c]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [d16566f]
- Updated dependencies [90acb7f]
- Updated dependencies [7913390]
- Updated dependencies [1394e34]
- Updated dependencies [e95cc25]
- Updated dependencies [abe8ebc]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/types@7.0.0
  - @object-ui/mobile@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3
- @object-ui/mobile@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2
  - @object-ui/mobile@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1
- @object-ui/mobile@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0
- @object-ui/mobile@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/react@6.1.0
  - @object-ui/mobile@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4
- @object-ui/mobile@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3
- @object-ui/mobile@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2
- @object-ui/mobile@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1
- @object-ui/mobile@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0
- @object-ui/mobile@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2
- @object-ui/mobile@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1
- @object-ui/mobile@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/mobile@5.4.0
  - @object-ui/react@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2
- @object-ui/mobile@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1
- @object-ui/mobile@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0
- @object-ui/mobile@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1
- @object-ui/mobile@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [b2d1704]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [d1442e3]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/components@5.2.0
  - @object-ui/mobile@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/react@5.1.1
  - @object-ui/mobile@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0
  - @object-ui/mobile@5.1.0

## 5.0.2

### Patch Changes

- @object-ui/components@5.0.2
- @object-ui/react@5.0.2
- @object-ui/types@5.0.2
- @object-ui/core@5.0.2
- @object-ui/mobile@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1
- @object-ui/mobile@5.0.1

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
  - @object-ui/core@5.0.0
  - @object-ui/mobile@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0
- @object-ui/mobile@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0
- @object-ui/mobile@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [3ee436d]
  - @object-ui/components@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/react@4.6.0
  - @object-ui/mobile@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
- Updated dependencies [6b6afd1]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/mobile@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [2bd45af]
  - @object-ui/components@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/react@4.4.0
  - @object-ui/mobile@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [6b683c8]
  - @object-ui/components@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1
  - @object-ui/mobile@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/components@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0
  - @object-ui/mobile@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1
- @object-ui/mobile@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/components@4.2.0
- @object-ui/react@4.2.0
- @object-ui/types@4.2.0
- @object-ui/core@4.2.0
- @object-ui/mobile@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0
- @object-ui/mobile@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12
- @object-ui/mobile@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/components@4.0.11
- @object-ui/react@4.0.11
- @object-ui/types@4.0.11
- @object-ui/core@4.0.11
- @object-ui/mobile@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10
- @object-ui/mobile@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9
- @object-ui/mobile@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/components@4.0.8
- @object-ui/react@4.0.8
- @object-ui/types@4.0.8
- @object-ui/core@4.0.8
- @object-ui/mobile@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/types@4.0.7
  - @object-ui/mobile@4.0.7

## 4.0.6

### Patch Changes

- 1b6dc64: fix: complete Tailwind v3→v4 migration cleanup

  - Rename deprecated `flex-shrink-0` → `shrink-0` and `flex-grow-N` →
    `grow-N` (Tailwind v4 dropped the long-form aliases). Affects
    data-table, fields/index, FileField, ChatbotEnhanced,
    FloatingChatbotPanel, ProcessDesigner, HistoryPanel, KanbanEnhanced,
    KanbanImpl, plugin-timeline index, FlowDesigner, LayoutRenderer.
  - Replace `theme(spacing.4)` inside arbitrary-value `[calc(...)]` with
    literal `1rem` in sidebar.tsx — `theme()` is deprecated in v4.
  - Remove obsolete v3-escape CSS overrides from index.css and
    sidebar-fixes.css. The component source now uses native v4 stacked
    data variants (`group-data-[state=collapsed]:group-data-[collapsible=icon]:w-(--sidebar-width-icon)`)
    which Tailwind v4 emits correctly without the manual overrides.
    Only the bespoke `.sidebar-menu-button-icon-mode*` rules are kept.

- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/components@4.0.6
  - @object-ui/types@4.0.6
  - @object-ui/core@4.0.6
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
  - @object-ui/types@4.0.5
  - @object-ui/core@4.0.5
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
  - @object-ui/types@4.0.4
  - @object-ui/core@4.0.4
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
  - @object-ui/react@4.0.3
  - @object-ui/components@4.0.3
  - @object-ui/mobile@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
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
  - @object-ui/mobile@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/react@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2
- @object-ui/mobile@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/react@3.3.1
  - @object-ui/mobile@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0
- @object-ui/mobile@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0
- @object-ui/mobile@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/react@3.1.5
- @object-ui/components@3.1.5
- @object-ui/types@3.1.5
- @object-ui/core@3.1.5
- @object-ui/mobile@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4
- @object-ui/mobile@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3
- @object-ui/mobile@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
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

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/types@0.3.1
  - @object-ui/core@0.3.1
  - @object-ui/react@0.3.1
  - @object-ui/components@0.3.1
