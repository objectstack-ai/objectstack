# @object-ui/plugin-gantt

## 18.1.0

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [5235d6d]
- Updated dependencies [8e649da]
- Updated dependencies [7c405b7]
- Updated dependencies [0093b2c]
- Updated dependencies [f669732]
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
  - @object-ui/plugin-detail@18.1.0
  - @object-ui/react@18.1.0
  - @object-ui/permissions@18.1.0
  - @object-ui/core@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
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

### Patch Changes

- c0862c1: The `object-gantt` `markers` input and the `object-timeline` `items` and `mapping` inputs open their descriptions with the `@objectstack/spec` 17.7.0 row's own describe text, which is true of these renderers (objectui#11168's rule, followed at objectui#11717). The renderer-specific sentences after it are unchanged.
- 7525045: More write affordances read the affordance-to-grant map, so a caller without the
  grant is no longer offered a write the server then refuses (objectui#12082, leg A
  of the write-census backlog). No row is added: each reuses the row of the same
  verb on the same object.
  
  - **The record overlay's inline edit** — the overlay the calendar, the kanban and
    the gantt open on a record (`RecordDetailPanel`) — reads the `recordEdit` row,
    the row the record page reads for the same in-place edit: the object's policy,
    the effective API operation set and the caller's update grant. A closed row
    opens no inline-edit session, as an absent `onFieldSave` already did. Each
    field still asks its own field question, as since objectui#12103.
  - **The gantt's in-chart writes** read `rowEdit` (a bar's drag, resize and
    progress, its title edited in place, and its dependency links) and `rowDelete`
    (a row's Delete). A closed row withholds the handler the chart draws the
    affordance from, the way `readOnly` and `lockField` already do.
  - **A grid's bulk field update** (a `bulkActionDefs` entry with `operation:
    'update'`) reads `rowEdit`, as its bulk delete reads `rowDelete`: a closed row
    removes the button from the selection bar, and with it the dialog, its undo
    and its retry. `custom` operations are unchanged.
  - **A master-detail form's line grids** read `relatedNew` (Add, the entry row
    and Duplicate) and `relatedRowDelete` (Remove) on the CHILD object, as a
    line-items panel does. Remove asks the delete grant on an edit form only: a
    create form's lines are drafts, and a removed one is never a server delete.
  - **A line-items panel** now hands its child object's schema to those two rows,
    so the child's own policy (`managedBy`, `userActions`) is read too.
  - **The AI build panel's spreadsheet import** (`ExcelImportBar`) reads the
    `listImport` row of the object it imports into, as the list page's Import
    does: without it, Import is disabled for that object.
  
  With no permission provider mounted every one of these reads open, as before.
- 5330038: Console rendering fixes from the HotCRM browser pass (objectui#12110):
  
  - **Grid:** a view column's authored `label` is the header. It used to lose to the field's translated label whenever the app bundle translated the field.
  - **Form:** a field `widget` that names no registered component falls back to the field type's renderer, as the spec's `widget` description says. A `rating` field declaring `widget: 'star_rating'` now draws the star widget instead of a text box. A built-in control name (`input`, `textarea`, …) and the native password and email inputs still render as before.
  - **Cells:** a `rating` value draws stars out of the field's `max` (5 by default) in list, detail and related-list cells, instead of a bare number.
  - **Reference rail:** a related row is named by its object's declared `nameField`, and the rail refetches in place when the record, a related object or everything is invalidated. A record action with `refreshAfter: true` therefore refreshes the rail too.
  - **Gantt:** the task list, the tooltip and the drag previews show a date's year when it is not the current year.
  - **Approvals drawer:** a `position:` approver shows the position's label, from the console's position registry, instead of a truncated id. The headline figure prefers the object's declared `currency` field and never shows a zero from a field matched only by its name.
  - **Public form:** a form with no title of its own is headed by its object's label, not the object's API name.
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
- Updated dependencies [055d350]
- Updated dependencies [7300fca]
- Updated dependencies [834c559]
- Updated dependencies [22b503c]
- Updated dependencies [9fc68aa]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [6be0f7a]
- Updated dependencies [db4cb6b]
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
- Updated dependencies [3035948]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [f34e877]
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
- Updated dependencies [29b9949]
- Updated dependencies [1d1cfe0]
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
- Updated dependencies [a7d4920]
- Updated dependencies [e723f58]
- Updated dependencies [82bb1d5]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
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
- Updated dependencies [803f678]
- Updated dependencies [923504f]
- Updated dependencies [5b45c0d]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [0cd322d]
- Updated dependencies [97e7d4e]
- Updated dependencies [5d3f437]
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
- Updated dependencies [9782cb2]
- Updated dependencies [3e2394d]
- Updated dependencies [d9d9d98]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [f8267df]
- Updated dependencies [023087f]
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
- Updated dependencies [4be76e0]
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
- Updated dependencies [8523e81]
- Updated dependencies [1e6d83b]
- Updated dependencies [1e6d83b]
- Updated dependencies [32b492b]
- Updated dependencies [6058bf8]
- Updated dependencies [c219165]
- Updated dependencies [79cb8c0]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [03f1d65]
- Updated dependencies [30083da]
- Updated dependencies [7f9cc37]
- Updated dependencies [b7fe09e]
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
  - @object-ui/plugin-detail@18.0.0
  - @object-ui/fields@18.0.0
  - @object-ui/permissions@18.0.0

## 17.7.0

### Minor Changes

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
- 8673402: feat(plugin-gantt): `object-gantt` publishes the eleven `@objectstack/spec` row keys its renderer honours (objectui#11168 slice 4)
  
  The `object-gantt` registration now declares `navigation`, `label`, `skipWeekends`, `holidays`, `persistLayout`, `viewName`, `markers`, `criticalPath`, `showBaselines`, `readOnly` and `mobileReadOnly`. Each is a member of the spec's `ComponentPropsMap['object-gantt']` row, and each was measured through the real `SchemaRenderer`, `ObjectGantt` and `GanttView` before it was declared (objectui#11111 decision 3 = B). All eleven are honoured, so the page validator no longer reports any of them as an unknown prop. Where the row's own describe is true of this renderer, the input's description starts with it word for word, followed by what the measurement added:
  
  - `navigation`: absent opens the task's record in a drawer; `drawer`, `modal` and `popover` open that overlay; `split` opens the record beside the chart; `page` and a block without `mode` open the record page in the same tab, and `new_window` in a new tab; `none` and `preventNavigation` open nothing; `openNewTab` outranks every mode except `none`; `size` sets the overlay width. The gantt derives the record-page address from the page it is on and does not use a record navigator the host publishes, so a host that publishes one changes nothing. On the object's own list or view route that address is the record page; on any other page, such as a custom page, `/OBJECT/record/ID` is appended to the current address. On inline rows that name no object, no mode opens anything.
  - `label`: a string, or an inline locale map resolved to the display locale, naming the exported PNG/PDF file after `gantt.exportFileName` and before the object's own label.
  - `skipWeekends` and `holidays` (members: `yyyy-mm-dd` strings): working-day auto-schedule math, and the day view folds those days out of its axis. A non-empty `holidays` turns the working calendar on by itself.
  - `persistLayout` and `viewName`: the `objectName:viewName` storage key; `persistLayout: false` removes the save-layout button and stores nothing.
  - `markers`, `criticalPath`, `showBaselines` and `readOnly`.
  - `mobileReadOnly`: on a chart narrower than 640px the chart's write paths are read-only unless `false`; the record drawer locks under `readOnly` alone, so a task's record still opens writable on a narrow chart.
  
  The `gantt` input's description no longer names `percentageField`, which nothing reads and the spec refuses by name. It now starts with the row's own describe and states the three required members.
  
  Nothing changes at render time: every key was already read. The README and the docs page say what each key does, including the record-page address above. The README no longer lists `{ provider: 'schema', schemaId }` as a source this chart reads: measured, a gantt carrying it queries `objectName` instead.
- 00f3eb5: `ObjectGanttSchema` declares the ten gantt keys `ObjectGantt` actually reads
  (objectui#5903, triage 2026-08-24). Every one is a real, working, documented
  feature — `readOnly`, `mobileReadOnly`, `markers`, `navigation`, `skipWeekends`,
  `holidays`, `criticalPath`, `showBaselines`, `persistLayout`, `viewName` — and
  none of them was discoverable from the published type, because all ten were read
  as `(schema as any).K`. The cast was the load-bearing part: it kept the read
  invisible to `tsc`, to the zod mirror and to the designer's registry `inputs`.
  
  Both halves move together. The TS declaration (`packages/types/src/objectql.ts`)
  and its zod mirror (`src/zod/objectql.zod.ts`) gain the same ten keys at the same
  requiredness — all optional — and no `KnownDrift` entry is added. `navigation` is
  taken from `@objectstack/spec`'s `NavigationConfigSchema` by reference rather than
  restated, matching `ObjectGridSchema.navigation`.
  
  ⚠️ **The JUSTIFICATION for that parity clause was retired (objectui#9743); the
  clause itself stands and did not move.** As first written it credited the
  `zod-mirror-parity` ratchet with a zero-drift reading for this pair — but at that
  time the ratchet measured three directions and was structurally blind to the
  MIRRORED-but-undeclared one (objectui#9711), so a zero from it recorded that it
  had not looked in that direction, not that nothing was there. objectui#9725
  landed the fourth direction, and it covers this pair BY NAME:
  `packages/types/src/__tests__/zod-mirror-parity.test.ts` registers
  `objectql.zod.ts#ObjectGanttSchema` in both its mirror map and its declaration
  map; `assertionMirroredUndeclaredMatchesLedger` requires every registered pair's
  mirrored-but-undeclared key set to equal that pair's `MirroredUndeclared` ledger
  entry — `never` for a pair the ledger does not name — and
  `assertionNoVacuousMirroredUndeclaredMeasurement` refuses a measurement that has
  degenerated to `any`. ⛔ Read this pair's verdict off that reconciliation, which
  re-derives it on every run, rather than off any figure written here; when this
  paragraph was authored, on 2026-09-18, it required no `MirroredUndeclared` entry
  for the pair.
  
  `ObjectGanttProps.schema` is retyped from `ObjectGridSchema` to
  `ObjectGanttSchema`. That is what makes the declaration load-bearing: the ten
  keys are not grid keys, so with the old prop type, dropping the casts would have
  left the reads landing on `BaseSchema`'s index signature — the same invisibility
  in different syntax. The grid-style `{ gantt: { … } }` block is unaffected;
  `getGanttConfig` reads it through that index signature exactly as before, and the
  registered renderer passes `schema: any`, so no runtime shape is turned away.
  
  Accept-set change, stated plainly: a **declared** key is now type-validated, so
  `readOnly: 'yes'` is refused where it used to parse green — the same narrowing
  objectui#5074 landed for `viewMode`. An **undeclared** key is still accepted:
  `BaseSchema` is `.passthrough()` and carries an index signature (objectui#5155's
  structural ceiling), so declaring these ten did not buy rejection of a
  misspelling. `packages/types/src/__tests__/gantt-declared-keys.test.ts` pins both
  halves so neither can be misread.
  
  The eleventh reported key, `label`, needed no declaration — `BaseSchema` already
  carries it — so only its cast was dropped.
- 75bd83d: `ObjectGanttSchema` declares the flattened `GanttConfig` face `ObjectGantt`
  actually reads (objectui#6051). `getGanttConfig` has two branches: when
  `startDateField` and `endDateField` are both present at the TOP level it builds
  its config from top-level keys and returns early; otherwise it reads the `gantt`
  block. Everything the first branch reads was undeclared — and unlike
  objectui#5903's ten, none of it was hidden behind a cast. `BaseSchema` carries
  `[key: string]: any` (objectui#5155's structural ceiling) and the helper's
  parameter was `ObjectGridSchema | any`, so `schema.colorField` type-checked as
  `any` with no syntax anywhere to grep for. That is also why the census here is an
  AST enumeration and not a compile-and-observe: an index signature absorbs every
  literal name, so annotating the parameter compiles clean while enforcing nothing.
  
  **27 keys join the declared surface, each additive and each with a live read
  site.** 24 flattened `GanttConfig` members — `colorField`, `borderColorField`,
  `dependenciesField`, `parentField`, `typeField`, `lockField`, `objectField`,
  `summaryExtent`, `defaultCollapsedDepth`, `tooltipFields`, `baselineStartField`,
  `baselineEndField`, `groupByField`, `resourceView`, `assigneeField`,
  `effortField`, `capacity`, `quickFilters`, `autoZoomToFilter`, `timeSegments`,
  `interactions`, `exportFileName`, `timeZone`, `dependencyTypes` — plus the three
  query keys the fetch path reads, `staticData`, `filter` and `sort`. Nothing is
  declared that the renderer does not consume.
  
  **`GanttConfig` itself gains nine members and is a published type**, exported by
  name from `packages/types/src/index.ts`: `lockField`, `objectField`,
  `summaryExtent`, `defaultCollapsedDepth`, `borderColorField`, `dependencyTypes`,
  `timeZone`, `exportFileName`, `interactions`. The entry file's diff is empty only
  because the export list already named the type — the widening happened at the
  declaration.
  
  **The 28th measured key, `gantt` (the block face), is deliberately NOT declared**
  — see the closing section.
  
  The 24 are DERIVED from `GanttConfig` rather than restated, so the flat spelling
  cannot fork from the block spelling, and the invariant is pinned in the type
  system: every key of `GanttConfig` must be declared at the node's top level.
  Making that derivation possible moved nine members — `lockField`, `objectField`,
  `summaryExtent`, `defaultCollapsedDepth`, `borderColorField`, `dependencyTypes`,
  `timeZone`, `exportFileName`, `interactions` — out of `plugin-gantt`'s
  package-private `GanttConfigEx` and into `@object-ui/types`' `GanttConfig`. They
  are a MOVE, not new vocabulary: the `gantt` block already honoured all nine, and
  a type private to the plugin could be referenced by neither authoring face.
  
  Both halves move together, as in objectui#5903: the TS declaration and its zod
  mirror gain the same 27 keys at the same requiredness (all optional), the
  spec-modelled ones taken from `GanttConfigSchema.shape` by reference, and no
  `KnownDrift` or `UnmirroredDeclared` entry is added. The mirror builds the flat
  face and the `gantt` block from one field map, so they are one schema expressed
  twice.
  
  ⚠️ **The JUSTIFICATION for that parity clause was retired (objectui#9743) — the
  same retirement objectui#5903's entry carries, for the same clause and the same
  reason; the clause itself stands and did not move.** As first written it credited
  the `zod-mirror-parity` ratchet with a zero-drift reading for this pair, at a time
  when that ratchet measured three directions and was structurally blind to the
  MIRRORED-but-undeclared one (objectui#9711), so a zero from it recorded that it
  had not looked in that direction. objectui#9725 landed the fourth direction, and
  it covers this pair BY NAME:
  `packages/types/src/__tests__/zod-mirror-parity.test.ts` registers
  `objectql.zod.ts#ObjectGanttSchema` in both its mirror map and its declaration
  map; `assertionMirroredUndeclaredMatchesLedger` reconciles every registered pair's
  mirrored-but-undeclared key set against that pair's `MirroredUndeclared` ledger
  entry — `never` for a pair the ledger does not name — and
  `assertionNoVacuousMirroredUndeclaredMeasurement` refuses a measurement that has
  degenerated to `any`. ⛔ Read this pair's verdict off that reconciliation, which
  re-derives it on every run, rather than off any figure written here; when this
  paragraph was authored, on 2026-09-18, it required no `MirroredUndeclared` entry
  for the pair.
  
  Accept-set change, stated plainly. All 27 keys are additive — every one is
  optional, and nothing previously legal loses its slot. What changes is that a
  **declared** key is now type-validated, so `capacity: 'one'` and
  `summaryExtent: 'parent'` are refused where they used to parse green. An
  **undeclared** key is still accepted — `BaseSchema` is `.passthrough()`, so this
  bought no rejection of misspellings. There is no narrowing anywhere in this
  change.
  
  **`gantt` is severed on purpose (objectui#6475), not overlooked.** It is the 28th
  key of the measured residue and a genuine read — `getGanttConfig`'s second branch
  honours it in full — but it is the one key whose declaration would NOT have been
  additive. It has no mirror entry today, so a block rides through `.passthrough()`
  unvalidated; declaring it as `GanttConfig` means it gets parsed against the spec's
  `GanttConfigSchema`, which REQUIRES `startDateField`, `endDateField` and
  `titleField`, and `ObjectGanttSchema` reaches the CLI's `validate` / `check`
  through `AnyComponentSchema`. A published CLI's refusal behaviour is decided on
  its own card, where reviewers can see what they are approving; objectui#6475
  carries the full measurement, including the case FOR enforcing it (the renderer
  already feeds that block to `GanttConfigSchema.safeParse` and warns, so enforcing
  restores declared = enforced rather than inventing a contract). Today's behaviour
  is pinned in the test file so the omission is a measured state, not a silent gap.
  `packages/types/src/__tests__/gantt-flat-config-declared-keys.test.ts` pins both
  halves so neither can be misread.
  
  Which face WINS is unchanged and was not decided here: the flat branch is checked
  first and returns early, so a node carrying both spellings still renders the flat
  one. (`plugin-map` had the opposite precedence ruled on in objectui#5018; no
  equivalent ruling exists for gantt.)
- d7acad6: **plugin-gantt: the `gantt` block now outranks the flat top-level spelling, and
  the losing face's keys are named instead of dropped.**
  
  `getGanttConfig` checked the flattened top-level spelling first and returned
  early, so a node carrying both spellings rendered the flat one and every key
  inside an authored `gantt` block was discarded with **no diagnostic** — not even
  the `GanttConfigSchema.safeParse` warning, which sat behind that early return.
  
  `plugin-map` had the identical two-faces shape ruled the other way (maintainer
  ruling on objectui#5018, 2026-08-17, landed in PR #5156): the block wins, with a
  dev-mode warning naming the ignored top-level keys. objectui#6469 inherits that
  ruling, so the two sibling view plugins now answer the same question the same
  way.
  
  What changes:
  
  - A node carrying **both** spellings now renders the **`gantt` block's** values.
    The block is taken **whole** — the flat keys are not merged into it.
  - In dev, `[ObjectGantt] … these top-level keys are IGNORED: …` names every
    shadowed flat key, once per distinct shadowing.
  - Nothing else moves. A node with only the flat spelling, or only a block, is
    read exactly as before.
  
  **Producer-safe:** `ObjectView` (`case 'gantt'`) and `ListView` (`case 'gantt'`)
  both flatten `options.gantt` onto top-level keys and emit **no** `gantt` key, so
  every gantt reached through either view layer still takes the flat branch, and
  the new warning cannot fire on that path. This is the same producer check the
  `plugin-map` flip pinned, re-run on today's `main`.
  
  This **supersedes** the precedence sentence in the objectui#6051 changeset
  (`.changeset/6051-gantt-flat-config-declared-keys.md`), which recorded the flat
  branch winning — accurate for that change, which deliberately did not touch
  precedence, and reversed by this one.
- e3d117a: `ObjectGantt` and `ObjectTree` resolve a relationship target only from the two
  spellings a contract carries, dropping the third one no contract declares
  (objectui#6837, second slice).
  
  - `ObjectGantt`'s quick-filter option fetch was
    `fd?.reference_to ?? fd?.reference ?? fd?.referenceTo`; it is now
    `fd?.reference_to ?? fd?.reference`.
  - `ObjectTree`'s `detectParentField` was
    `def?.reference || def?.reference_to || def?.referenceTo`; it is now
    `def?.reference || def?.reference_to`.
  
  **Accept-set move — a def carrying ONLY `referenceTo` stops resolving a target
  at these two seams.** Concretely: the gantt quick filter for that field falls
  back to the distinct values present in the loaded rows instead of fetching the
  referenced object's full domain, and the tree stops auto-detecting that field as
  its parent pointer, so records render as a flat forest unless `parentField` is
  configured explicitly. Nothing else changes; the two surviving arms are
  untouched.
  
  Two things bound that move:
  
  - Any def that entered through the ingestion choke point is unaffected.
    `normalizeSchemaReferenceKeys` reads `reference_to ?? reference ??
    referenceTo` and stamps both snake_case keys, so a `referenceTo`-only def
    arriving via `MetadataProvider` or `ObjectStackAdapter.getObjectSchema`
    already carries `reference_to` before either component sees it. Only a def
    that bypassed that door entirely is affected — and that door is not total:
    `getObjectSchema` is a required member of the published `DataSource`
    interface, and both components call it on the generic `dataSource`.
  - No contract declares the deleted spelling. `@objectstack/spec` 17.2.0's
    `FieldSchema` refuses `referenceTo` by name with `unrecognized_keys`, carrying
    its own "Did you mean `referenceTo` -> `reference`?" rename, and `referenceTo`
    is additionally a tombstone in `RETIRED_FIELD_KEY_TOMBSTONES` (objectui#6041)
    at all three strip sites, so the designer read door removes it before a draft
    round-trips.
  
  A repo-wide structure-walk producer census found **0** emitters of `referenceTo`
  reaching either seam, measured in the cell these components read (a value inside
  an object schema's `fields` container) against controls `reference` (92 hits / 36
  files) and `reference_to` (52 / 36) hot in the same pass over the same cells;
  the only two in-cell hits are negative fixtures of the retirement machinery,
  asserting the read door strips the key. Neither `plugin-gantt` nor `plugin-tree`
  emits `referenceTo` anywhere, while both packages' own fixtures are hot on the
  surviving spellings.
  
  Pinned by `ObjectGantt.referenceArms-6837.test.tsx` and
  `ObjectTree.referenceArms-6837.test.tsx`, which keep the live arms green beside a
  named refusal for the deleted key.
  
  ⚠️ **Dated note, 2026-09-30 — the choke point folds, it no longer stamps both keys — objectui#11070.** "`normalizeSchemaReferenceKeys` ... stamps both snake_case keys" above held when this change landed. Later in this same release objectui#11070 (round 4) made that pass fold a legacy spelling onto `reference` without stamping `reference_to`; a def that entered through it still carries `reference`, the one arm both components keep. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
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
- bf244f4: Size the gantt task list from its container, and give a row's dates ONE predicate
  (objectui#7204, objectui#7224; maintainer ruling 2026-09-02, option Y).
  
  **A row could show no dates at all.** Two gates decided whether a row's dates were
  painted, and they read two different widths. The Start/End columns were gated on the
  container-derived task-list width; the `8/26 → 9/2` sublabel under the title was gated
  by the component's own `@media (min-width: 640px) { .gantt-sm-hidden { display: none } }`
  rule, which reads the viewport. Between a 640px and a 1023px container both were shut,
  so the row's dates existed in the DOM twice and were painted zero times. The same hole
  opened at any width once the splitter was dragged under the threshold.
  
  The sublabel now renders on exactly the complement of the Start/End columns, both from
  the same container-derived width, and the media rule is gone. A row always carries its
  dates one way or the other.
  
  **And the task list no longer caps at 320px.** From a 1024px container up, the pane
  takes 3/8 of the container clamped to `[320, 560]` instead of a flat 320. At 1440 that
  is 540px, which leaves the title 287px with the Start/End columns still painted — a
  40-character title measures 262px in the row's font, so real-world task names stop
  truncating to about seven characters while several hundred pixels of chart sit empty.
  Measured in Chromium at a 1440px container: title 53px before, 287px after.
  
  The Start/End threshold moves from an estimated 280 to a derived **412** — 32 row
  padding + 160 for the two columns + 28 for the open-details slot + 32 of title
  furniture + 160 minimum title, each term traced to the markup that spends it. Below it
  the sublabel carries the dates. One consequence worth stating: between a 1024px and a
  1097px container the columns are now off and the dates ride the sublabel, which trades
  two 80px date cells for a title that grows from 67px to 291px.
  
  Not fixed here, and unchanged: a row's `depth * 14` indent is unbounded, so no single
  default keeps a deeply nested row legible.
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
- db3896c: `ObjectGantt` refreshes in place when its query really changes, instead of tearing the chart down to the loading placeholder (objectui#7237).
  
  Once the chart has painted, a change to its sort, filter, permissions, search or bound source re-runs the query with the chart still mounted, so it keeps its scroll position, its collapsed groups and any inline edit in progress. While the query runs, a thin indeterminate bar over the chart marks the rows on screen as the previous answer, and the rows are replaced when the new answer lands. It is the same `RefreshIndicator` that `ObjectGrid`, `ListView` and `ObjectChart` draw over their rows. The initial load still shows the loading placeholder.
  
  The bar also shows during the chart's other in-place re-reads: the toolbar refresh, the re-read after a drag, a dependency link, a delete or a field edit, and a re-read triggered by the data-invalidation bus. Those already kept the chart mounted, but the only sign of them was a disabled refresh button.
  
  A changed query that fails is still reported as an error, as it was before. Only a re-read of the same query keeps its last good rows when it fails.
  
  `@object-ui/i18n`: new key `gantt.aria.refreshing`, the bar's accessible name, in all ten locale packs.
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
- a1c00e3: Honour `filter`, `sort` and the platform row ceiling on a gantt's inline
  (`provider: 'value'`) data (objectui#8769).
  
  **The defect was fail-open.** `ObjectGantt`'s `reload` short-circuited the
  inline provider — it set the authored rows and returned BEFORE the adapter
  query, which is the one site that lowers `schema.filter` to `$filter`,
  `schema.sort` to `$orderby` and the objectui#7210 ceiling to `$top`. So an
  inline gantt that declared a `filter` drew **every** authored row, with no
  diagnostic. The key that was dropped is the key that NARROWS, which is why this
  matters: the chart answered a wider question than the author asked. ⛔ Nothing
  was exposed that was not already in the authored schema — this is a
  correctness defect, not a data-access one.
  
  Measured two-sided before the repair: the same five rows and the same
  `status = open` filter drew 3 rows through a fetching data source and 5 rows
  inline, with the same matcher on both sides.
  
  **What changed.** The inline branch is gone; `provider: 'value'` now goes
  through `resolveDataSource`'s `ValueDataSource` like every other provider,
  which already implements `$filter` / `$orderby` / `$skip` / `$top` / `$select`
  over its own array. No filter combinator was written for this change.
  
  **Behaviour you may notice.**
  
  - An authored `filter` / `sort` now narrows and orders inline rows. Both
    spellings reach it: `data: { provider: 'value', items }` and `staticData`.
  - The row ceiling now applies to inline rows: past 2,000 drawn rows the chart
    draws 2,000 and shows the footnote naming both numbers, as it already did for
    fetched rows. It is applied to the **filtered** set, so a large inline array
    that a `filter` cuts below the ceiling draws every matching row and stays
    quiet. Rows a host passes down through the `data` React prop are still never
    capped — those are not ours to cap.
  - Inline rows now reach the chart as the adapter's own deep copy rather than as
    the authored array's object identities. `ViewData.items` is serializable
    metadata, so every value the contract admits survives that copy unchanged;
    code comparing a row handed to `onTaskClick` against the authored array with
    `===` would need `id` equality instead.
  - An inline gantt's own write-backs (drag, dependency edit, inline edit,
    delete) now survive the reload that follows them, because the reload reads
    the adapter that took the write instead of re-reading the authored array over
    the top of it.
  - A filter comparand that `@object-ui/core`'s `convertFiltersToAST` refuses does
    **not** throw at render on this path: the inline matcher is local and never
    reaches that converter. The row is excluded and the reason is logged once.
- 093af32: Take the `@objectstack/*` line to 17.4.0 and follow every contract it moved
  (objectui#8772, with #7783 · #7663 · #8172 · #7845 · #8785).
  
  **Breaking on one authored key, deliberately.** A dashboard node's
  `refreshInterval` is now `refreshIntervalSeconds` — the value is unchanged
  (seconds), and the spec refuses the old spelling by name with a message naming
  the new one, so an existing document fails loudly at parse rather than silently
  losing its auto-refresh. `os migrate meta --from 17` lists the mechanical edits.
  The report component's own `refreshInterval` is a different key and is NOT
  affected. (Scored `minor`, not `major`: this repo's fixed group tracks the
  `@objectstack` major — AGENTS.md §版本号策略.)
  
  Also authored-surface changes, all following a published spec move rather than a
  local decision:
  
  - `element:record_picker`'s `filter` input is now the `ViewFilterRule` array
    form `[{ field, operator, value }, …]`. The MongoDB-style record form is
    refused by the contract (objectstack#14406 converged the last record-form
    `filter` in the map), so a JSX page writing the array form no longer draws a
    false `type-mismatch` and one writing the record form is told.
  - `object-kanban` now publishes `limit`, the row cap its renderer has always
    lowered to `$top`. The spec declares it as of objectstack#16503, so the key
    the docs teach is finally one the save gate stores.
  - `object-gantt`'s ten extension keys (`timeSegments`, `interactions`,
    `lockField`, …) are derived from the spec's `GanttConfigSchema` instead of
    being re-declared locally. Same accept set on the flat face; the nested
    `gantt` block narrows to the spec's, which now refuses an undeclared sub-key
    by name where its `.passthrough()` window used to admit one.
  - The console's preview-gallery samples — the worked examples an author copies —
    move with two spec changes of their own: a job's `timeout` is now `timeoutMs`
    (same unit-in-the-key-name ruling as the dashboard key above), and a flow's
    end node writes `outcome: 'completed'`, the enum having narrowed to
    `completed | refused`.
- adf5812: Four node type keys retire, and the kanban and gantt families converge on their
  `object-*` spellings: `kanban` (objectui#8802), `kanban-ui` and `kanban-enhanced`
  (objectui#8257), and `gantt` (objectui#8008). All four were ruled by the
  maintainer in one batch on 2026-09-09.
  
  **⛔ No stored document moves.** The strings `kanban` and `gantt` name two
  different things at two different layers, and only one of them is retiring:
  
  | layer | value | who writes it | retired? |
  | --- | --- | --- | --- |
  | stored `NamedListView.type` | `"kanban"`, `"gantt"` | `CreateViewDialog`, persisted per tenant | **no — untouched** |
  | node type key | `kanban`, `gantt` | hand-authored JSON | **yes** |
  
  `ObjectView`'s `switch (viewType)` maps a stored view type onto the node type it
  renders, and it already emitted `object-kanban` and `object-gantt` — as it does
  for all twelve stored view types. So every kanban and gantt view any user ever
  created through the console already renders through the surviving spelling.
  Nothing in a tenant database changes, and ⛔ nothing should be migrated there.
  
  **What each retirement was, measured.** Three of the four were
  registration-only: no schema face in `@object-ui/types` ever declared
  `kanban-ui`, `kanban-enhanced` or `gantt` as a component node type, so
  unregistering is the whole retirement. The bare `kanban` key was the exception —
  it had a declared arm on both faces (`KanbanSchema` in `complex.ts` and its Zod
  mirror), and a plain deletion there would have been the objectui#7664 failure:
  `BaseSchema` is `.passthrough()`, so a document naming a dropped key validates
  green and renders nothing. It therefore retires as a **named refusal**: the Zod
  union keeps an arm claiming the literal and answers a `{ "type": "kanban" }`
  document with a message naming `object-kanban` as the remedy, while the
  TypeScript half is the absence of the arm from `ComplexSchema` and of the key
  from `SchemaRegistry`, so `tsc` refuses it at the authoring site.
  
  **⭐ This closes objectui#8818's `objectFields` hole — for that ENTRY, not for
  the class.** `SchemaRenderer` strips a fixed enumerated metadata list and
  spreads the rest as React props; `objectFields` is not on that list, and
  `KanbanRenderer` — the component the `kanban-ui` key resolved to — declares
  `objectFields` as a real prop, so an authored value reached the predicate layer
  with no schema face judging it. With the registration gone, no authored node
  reaches that component through the registry. ⚠️ The **class** is still open: the
  hole returns the moment another registered renderer declares an `objectFields`
  prop. objectui#8818's option (a) — stripping at the `SchemaRenderer` boundary —
  is what would close the class.
  
  Superseded in this release by objectui#8818: option (a) landed, so the class
  is closed as well. `objectFields` is now on `SchemaRenderer`'s stripped-metadata
  list, and the legacy `props` alias bag drops it too, so an authored
  `objectFields` reaches no component prop on any type key. The paragraph above
  describes the tree this entry was written against.
  
  **⚠️ What the `kanban` arm took with it, stated because it is the cost of this
  change.** That arm was the only schema face that ever declared `columns`,
  `cardTitle`, `swimlaneField`, `grouping` and `navigation`, the only one that
  refused `allowCollapse` / `cardTemplates` / `columnWidths` / `titleField` /
  `draggable` / `onColumnAdd` / `onCardAdd` by name, and — through
  `columns: KanbanColumn[]` — the only one that judged a lane's `cards`
  (`240b80f31`).
  
  ⭐ **The sentence that stood here — «The surviving `ObjectKanbanSchema` face
  declares none of them» — is retired, and the two reasons it failed are DIFFERENT
  defects (objectui#9713).** It is replaced by a dated reading rather than silently
  overwritten, because half of it was true when written and erasing that would be a
  false record of its own:
  
  | key named just above | on `ObjectKanbanSchema` when this entry was written (`adf581278`, 2026-09-10) | on `main`, 2026-09-17 | what moved |
  | --- | --- | --- | --- |
  | `columns` | not declared | **declared** | objectui#8913 (PR objectui#8989), six hours after this entry was written |
  | `cardTitle` | not declared | **declared** | objectui#9606 (PR objectui#9709) |
  | `titleField` | **declared** | **declared** | nothing — the sentence was never true of this key |
  | `allowCollapse` | **declared**, a live `z.boolean().optional()` | **declared**, as a `retirementTombstone()` | objectui#8801 retired it; it was declared on this face throughout |
  | `swimlaneField`, `grouping`, `navigation`, `cardTemplates`, `columnWidths`, `draggable`, `onColumnAdd`, `onCardAdd`, and a lane's `cards` | not declared | not declared | nothing |
  
  ⇒ For `columns` and `cardTitle` the claim **ROTTED**: it was true on 2026-09-10 and
  was falsified afterwards by cards that had no reason to read this file. For
  `titleField` and `allowCollapse` it was **BORN FALSE**: those two are named above as
  keys the `kanban` arm refused BY NAME — which the surviving face indeed does not do
  — but the surviving face declared both of them the whole time, and «declares none of
  them» said otherwise. ⛔ Do not restate any of this in the present tense: a pending
  entry publishes verbatim into the CHANGELOG, and an undated present-tense claim
  about another file is the construction that failed here.
  
  ⛔ Nothing about an `object-kanban` document changes: it was never judged by the
  `kanban` arm, so all of those keys have always ridden `BaseSchema`'s index
  signature there. What is gone is the `kanban` document that had them. Declaring
  them on `ObjectKanbanSchema` would WIDEN a published accept set, which is a
  maintainer ruling and not part of this one; every one of these readings is
  pinned where it can be seen rather than left to be rediscovered.
  
  **Migrating.** Replace `"type": "kanban"` with `"type": "object-kanban"` and
  `"type": "gantt"` with `"type": "object-gantt"` in hand-authored documents. The
  `object-kanban` face requires `groupBy` and one of `bind` / `data` /
  `objectName`; a purely static board (lanes carrying their own cards, no record
  source) adds `"groupBy"` and `"data": []`. `kanban-ui` and `kanban-enhanced`
  have no authored documents anywhere in this repository to migrate.
  
  **⚠️ The namespaced spellings retire with the registrations — `view:kanban` and
  `view:gantt` are the same two keys.** `ComponentRegistry.register(type, C,
  { namespace })` stores BOTH `namespace:type` and a bare-`type` fallback, so
  every one of these keys had a namespaced twin that goes with it:
  
  | retired spelling | namespaced twin | author instead |
  | --- | --- | --- |
  | `kanban` | `view:kanban` | `object-kanban` |
  | `gantt` | `view:gantt` | `object-gantt` |
  | `kanban-ui` | `plugin-kanban:kanban-ui` | `object-kanban` |
  | `kanban-enhanced` | `plugin-kanban:kanban-enhanced` | `object-kanban` |
  
  Both spellings are pinned as gone, each against a firing control on the
  surviving key, in `plugin-kanban/src/__tests__/kanban-family-registry-keys-retired-8257.test.ts`
  and `plugin-gantt/src/__tests__/bare-gantt-node-key-retired-8008.test.ts`.
  
  **What an unmigrated `view:kanban` / `view:gantt` node now renders depends on
  the host.** In `apps/console` it renders the protocol **placeholder** panel, not
  the OBJUI-001 "Unknown component type" error: the console calls the opt-in
  `registerPlaceholders()` (`@object-ui/components`, `renderers/placeholders.tsx`)
  *after* its plugin registrations, `view:kanban` and `view:gantt` are both in
  that file's `PROTOCOL_COMPONENTS` list, and the placeholder only claims a key
  nothing else has taken — which, until this change, `@object-ui/plugin-kanban`
  and `@object-ui/plugin-gantt` had. In every other host, which does not call that
  bootstrap, the same node renders OBJUI-001.
  
  **⚠️ `objectui check` will NOT flag either namespaced spelling.** The CLI's
  `known-schema-types.ts` is generated from the repository's real registration
  calls, and the placeholder registration is a real one — so `view:kanban` and
  `view:gantt` are still on that list and still validate green, while the node
  renders a placeholder rather than a board. The bare `kanban` / `gantt` entries
  DID leave the generated list; only the namespaced pair survives, and only
  because of the placeholder. Grep your documents for the namespaced spellings
  directly; do not rely on `objectui check` to find them.
  
  `KanbanRenderer` is still exported from this package's entry point
  (`@object-ui/plugin-kanban`); only its registry key is gone. ⚠️ `KanbanEnhanced`
  is a different case, and the earlier draft of this note stated it wrongly: this
  package's `exports` map has exactly two entries — `.` and `./style.css` — and
  the barrel never re-exported the component, so
  `@object-ui/plugin-kanban/KanbanEnhanced` has never been a resolvable specifier
  for a consumer. At this change, with `kanban-enhanced` unregistered,
  `KanbanEnhanced.tsx` had zero non-test importers, and the file was deliberately
  left in place: deleting published-but-unreachable source is a further narrowing
  and needed its own maintainer ruling, which this change did not have.
  
  ⚠️ **Dated note, 2026-09-25 — that ruling came, and the file has since been
  deleted — objectui#8932.** Later in this same release
  `packages/plugin-kanban/src/KanbanEnhanced.tsx` was deleted, and with it the
  `dist/KanbanEnhanced.d.ts` typings this package shipped for it. The rest of this
  entry is kept as the reading of this change; the objectui#8932 entry states what
  ships.
  
  **⚠️ `@object-ui/sdui-parser`: `QUICK_ADD_HOST_TYPES` loses `kanban` with the
  registration.** The `inert-quick-add` diagnostic (objectui#8285) named the two
  tags `ObjectKanbanRenderer` answered to; one of them retires here, so the set is
  now `{ 'object-kanban' }`. ⛔ Nothing is silently dropped by that narrowing, and
  this is measured rather than argued: `checkKanbanQuickAdd` has exactly one call
  site — `validate.ts`'s per-prop walk — and that walk runs only in the branch
  where the manifest RESOLVED the tag. A tag no registration produces is answered
  one level up by `unknown-component`, an **error**, and its props are never
  walked, so on a manifest built from the live registry a `<kanban quickAdd>` node
  draws `error/unknown-component` and nothing else, against a firing control on
  `<object-kanban quickAdd>` that still draws `warning/inert-quick-add`. Keeping
  `kanban` in the set would have been reachable only through a hand-built manifest
  declaring a component of that name — which, after this retirement, is somebody
  else's component, and the message asserts things about `ObjectKanban` that would
  be false of it. This supersedes the `kanban` half of the objectui#8285 entry.
  
  **The diagnostic's remedy text moves from a tag to a component.** It used to end
  "render `<kanban-ui>` from a React host that passes `onQuickAdd`". That sentence
  is falsified by this change: `kanban-ui` is no longer a node type key, so a page
  written to the old advice draws `unknown-component`. It now names
  `KanbanRenderer` from `@object-ui/plugin-kanban` — still exported, still
  forwarding both halves by identity — which is the surviving way to get the pair.
  `content/docs/plugins/plugin-kanban.mdx` says the same thing the same way.
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
- 199d31b: **`viewMode` is now declared authoring surface on `ObjectGanttSchema`, and both
  gantt renderer branches honour it** (objectui#5074, maintainer ruling
  2026-08-19: declare-and-wire; the spec half landed first upstream).
  
  - `ObjectGanttSchema` (TS interface and zod mirror) declares `viewMode`,
    DERIVED from the pinned `@objectstack/spec` `GanttConfigSchema.viewMode`
    enum by reference, so the member list cannot drift. Deliberately no
    default: an omitted `viewMode` keeps letting a persisted layout
    (`persistLayoutKey`) seed the timeline granularity before the renderer's
    `'day'` fallback.
  - The timeline branch (`GanttView`) now receives an authored `viewMode`.
    Previously only the resource-workload branch (`resourceView` +
    `assigneeField`) honoured it, so `viewMode: 'month'` on an ordinary gantt
    view was silently ignored.
  - The `(schema as any).viewMode` cast in `ObjectGantt` is retired; both
    branches read the declared `ganttConfig.viewMode`, which also honours the
    key when authored inside the spec's `gantt` config block.
  - Accept-set note: `viewMode` is now a DECLARED key, so an off-enum value
    (e.g. `viewMode: 'hour'`) becomes a zod validation error where it
    previously passed through unvalidated. Values on the published spec enum
    are unaffected.

### Patch Changes

- 3759c56: Gantt, chart and grid views refresh in place after a write instead of being rebuilt (objectui#10035).
  
  `ObjectGrid`, `ObjectGantt` and `ObjectChart` query for themselves and read no refresh input, so both object-view layers could show them a write only by remounting them — which lost a gantt's scroll, collapsed groups and zoom, a chart's open drill-down, and a grid's selection, column state and in-progress edit. Each now refetches when the data-invalidation bus (`notifyDataChanged` / `useDataInvalidation` from `@object-ui/react`) reports a change to the object it reads:
  
  - `@object-ui/plugin-grid`: `ObjectGrid` re-reads its rows into the same table.
  - `@object-ui/plugin-gantt`: `ObjectGantt` re-reads silently and keeps the chart mounted, as its toolbar refresh does.
  - `@object-ui/plugin-charts`: `ObjectChart` re-runs its query on both binding shapes — an object-bound aggregate follows its `objectName`, a dataset-bound chart follows the dataset's base object as the `queryDataset` answer names it.
  - `@object-ui/plugin-view`: the object view keys every view on its identity alone, and declares on the bus its own saves and deletes and each `onMutation` write it hears.
  - `@object-ui/app-shell`: the object page keys its list and its chart view on identity alone, and declares on the bus the changes it learns of without a data-source write — server actions, flows, imports, realtime events and an explicit refresh.
  
  Rows a host hands these components (`data`, `bind`, inline values) are still the host's to refresh; only the components' own queries follow the bus.
- 75b0d0b: `ObjectGantt` no longer re-issues its record query because React threw a memo cache
  away (objectui#10036).
  
  The fetch seam carried two dependencies that AGENTS.md §5 commandment #10 bans — the
  ninth and tenth instances of the class ruled on objectui#8640. `reload`'s dependency
  list named `effectiveDataSource`, a `useMemo` result, and the mount effect named
  `reload`, a `useCallback` result. Both hooks are documented performance hints: React
  may discard the cache and recompute even when the dependency list compares equal, and
  the object that comes back is then a new one.
  
  That is not harmless here. `resolveDataSource` returns the context adapter UNCHANGED
  for `provider: 'object'`, but CONSTRUCTS a fresh `ApiDataSource` / `ValueDataSource`
  for `provider: 'api'` and `provider: 'value'` — so on those two providers a discard
  alone handed `reload` a brand-new adapter for a byte-identical authored config, rebuilt
  `reload`, and re-fired the mount effect: one redundant round trip per discard, on a
  view nobody had touched. A discarded `useCallback` moves `reload`'s identity whatever
  its own dependency list says, so the second half had to move with the first.
  
  The record fetch now READS the adapter through a ref and KEYS on the values that
  determine it: the authored config slice `resolveDataSource` actually reads, per
  provider arm, plus the host's `dataSource` and `apiFetch`. Every authored or host
  change that used to refetch still refetches — a changed `api` endpoint, changed
  `read`/`write` config, changed inline `items`, a swapped adapter, a swapped
  authenticated fetch, a changed object, filter or sort. What no longer refetches is a
  discard, and an inert key inside `data` that the resolved adapter never reads.
  
  The file already recorded half of this in the first person: `dataItems` came off that
  same dependency list because a discard «was enough to give `reload` a fresh identity
  and re-fire the mount effect below (objectui#6592)». One banned identity came off the
  line then; the other stayed on it until now.
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
- 2803fac: fix(plugin-gantt): a failed load no longer keeps `ObjectGantt` on its error screen after a later load succeeds
  
  `ObjectGantt` sets `error` when the current reload fails, and the render returns
  the error screen early whenever `error` is set. Nothing ever cleared it. After one
  failed load (a filter or sort change against a flaky backend, say), every later
  load that succeeded still wrote its rows, but the chart stayed on the error screen
  until the component remounted.
  
  The current reload now clears the error when it commits rows, whether it is a
  changed query or a silent re-read of the same one (a data-invalidation, say). Those
  rows answer the current query, so the earlier failure no longer describes the
  screen. A superseded reload's answer is discarded under the existing `isCurrent()`
  guard, and its clear is discarded with it, so it cannot remove an error the current
  reload reported.
  
  The error is deliberately not cleared when a reload starts, although `ObjectGrid`'s
  load clears there. A silent re-read can overtake a changed query and then fail
  without reporting it. Had the changed query cleared the error when it started, the
  chart would go back to an older query's rows with nothing to say they are stale.
  Until rows that answer the current query land, the error stays on screen. Before the
  first paint the loading placeholder still shows while a query is in flight.
- 9d89c6f: fix(plugin-gantt): a silent re-read that overtakes a changed query now reports that query's failure
  
  `ObjectGantt` re-reads in two modes. A changed query (a sort, filter or search
  change) reports a failure on the error screen. A silent re-read of the same query
  (a data-invalidation, the toolbar refresh, or the read-back after a drag, resize or
  inline edit) only logs a failure and keeps the last good rows, because those rows
  still answer that query.
  
  Only the newest re-read may commit, so a silent re-read that starts while a
  changed query is still in flight makes that query's run stale. The re-read reads
  the changed query too. When it failed, the chart kept the rows of the query before
  the change, with no error and no refreshing state. Those rows answer neither query
  the user asked for.
  
  A silent re-read that overtakes a changed query in flight now takes over that
  query's report: its failure shows the error screen, as the changed query's own
  failure would. The report passes on if another silent re-read overtakes it, and it
  is released when the current re-read settles. The same holds for a silent re-read
  that overtakes the initial load, which used to leave an empty chart with no error.
  A silent re-read with nothing pending still only logs a failure and keeps its rows.
  No prop or export changes.
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
- 1659f14: The gantt timeline now follows the display locale, not the UI language (objectui#10668).
  
  `GanttView` takes its date locale from `useDisplayLocale()` instead of the UI language. This covers the
  timeline's column and band headers, the toolbar's period label, the task list's start and end dates,
  a bar's hover card, and the dates shown while a bar is dragged. With an English UI and a `de-CH` display locale, a week column that used to read
  `3/2` now reads `2.3.`, the same locale `ObjectGantt`'s tooltips and `ResourceWorkload` already use in
  the same chart. With no display locale declared, the display locale falls back to the UI language, so
  the timeline renders as before. With no language at all, it used to fall through to the machine's
  locale; it now gets the display locale's own last resort.
- db0beb2: docs(plugin-gantt): authored `object-gantt` examples write their props in the `properties` bag (objectui#10859, batch 6)
  
  The README's authored `object-gantt` examples now write `{ "type": "object-gantt", "properties": { …, "gantt": { … } } }`, the spelling `@objectstack/spec`'s `ComponentPropsMap['object-gantt']` row declares and `objectui validate` now requires, with the field mapping in the bag's `gantt` block. The flat field-mapping keys are described as what they are, the handoff `ObjectView` and `ListView` write onto the node they compose. The examples that mount `ObjectGantt` directly keep the flat `schema` prop: a component mounted without `SchemaRenderer` receives the node as it reads it, and nothing hoists a bag there. Under `src/`, a new render pin holds that the bag draws what the flat spelling drew, and the catalog-plans pin reads the catalog entries' bag. No runtime change.
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
- e119f12: fix(plugin-gantt): a gantt move shifts a task's end by the calendar days it shifts the start, keeping each value's time of day across a DST change (objectui#10866, slice 6)
  
  On the day, week, month, quarter and year scales a drag snaps to whole days. The start moved by calendar days, but the end followed it by the elapsed milliseconds of the start's move, and a summary's group move carried every task beneath it by that same span. Across a DST change of the viewer's zone that span is a whole number of days plus or minus an hour. Under `America/Los_Angeles`, a `date` task from October 29th to October 31st moved three days wrote `end_date` `2026-11-02` where the drop reads November 3rd; a `datetime` end that crossed the change when its start did not moved its wall-clock time by an hour; a task under a moved summary could start on the day before the one it was dropped on. An edge drag past the other edge stopped 24 hours from it, which on a DST day is 23:00 of the day before, or 01:00.
  
  - **Move.** A drag now counts the calendar days its snapped start moved and moves the start and the end by that many days on the local calendar. Each keeps its hours, minutes, seconds and milliseconds, as objectui#11005 ruled for the calendar's month grid, so a `date` task keeps its length in days and a 10:00 start stays at 10:00. This deliberately changes the instant a drag writes into a `datetime` end across a DST change; what a `datetime` field stores and how it is read are unchanged.
  - **Edge drags.** The end handle already moved the end by calendar days, keeping its time of day. An edge dragged past the other edge now stops one calendar day from it.
  - **Group move.** Dragging a summary moves the summary and every unlocked task beneath it by the same calendar days, and the live preview draws what the drop writes.
  - **Unchanged.** In a zone without DST every day is 24 hours, so a drag writes what it wrote before. The shift-band scale (`timeSegments` in day view) moves by bands on an elapsed-time axis and is unchanged.
- f6ae5e2: fix(plugin-gantt): a zoned chart reads and writes a stored day as that day on a DST change (objectui#10866, slice 5)
  
  A gantt with a business `timeZone` draws every date through a shim that re-bases it into that zone, and hands every dropped date back through the shim's inverse. Since this card's first slice, earlier in this same release, `ObjectGantt` has handed a date-only day in as the shim's inverse of the day's local midnight, and read a dropped `date` field back through the shim. Each direction reads the two zones' offsets at the instant it is handed, so on a DST day of one zone and not the other the round trip missed by an hour. An `America/Los_Angeles` viewer of an `America/New_York` chart saw a stored `2026-03-08` drawn from 23:00 on March 7th, and a drop onto March 8th wrote `2026-03-07`; `2026-11-01` was drawn from 01:00. A `Europe/Berlin` viewer of the same chart saw `2026-03-29` drawn from 23:00 on March 28th, and a drop onto it wrote `2026-03-28`.
  
  - **plugin-gantt.** `ObjectGantt` now inverts the shim exactly for a day: it hands the view the instant the shim maps onto the day's local midnight, and writes the day of the display date the dropped instant was translated from. A stored day is drawn from its own midnight and a drop writes the day it was dropped on, on a DST change of the chart's zone or the viewer's too. Where the shim draws no instant at that midnight, as when the chart's zone changes its clocks at 00:00, the day is drawn from the first instant after it, on that day. A `datetime` value goes through the shim unchanged, and a chart with no `timeZone` is unchanged.
  - **types.** The `GanttConfig.timeZone` description said that near a DST change a day could be drawn, and a drop written, as the day before. It now says the day holds on a DST change too.
- 0e6e76b: fix(plugin-gantt, plugin-calendar): the `objectName` input description names the `dataSource.object` binding (objectui#11117)
  
  The designer-facing `objectName` input on `object-gantt` and `object-calendar` (and
  `view:calendar`, which shares the calendar's list) said the block's schema refuses a block that
  declares none of `data`, `staticData` and `objectName`. Since objectui#11117 the schema also
  accepts a block whose `dataSource.object` names the object, because the registration's
  `ElementDataSourceGate` lands that name on `objectName` before the renderer reads the node. The
  sentence now says so. No input's name, type, `required` flag or shape changed. (`object-map`'s
  input already names the binding: objectui#10859 batch 5 rewrote it.)
  
  The `plugin-gantt` and `plugin-kanban` READMEs carry the same correction.
- 858eafb: fix(plugin-gantt,core,plugin-timeline): both gantt surfaces read a date-only end inclusively through one core rule, and a drag writes the same day back (objectui#11141)
  
  **A widening: `@object-ui/core` gains two exports**, `toDisplayEndDate(value)` and `toInclusiveEndDay(end)`, on its published entry beside `toDisplayDate` (the same file, `utils/date-display.ts`, re-exported by `export *`). Nothing else in `@object-ui/core` is added, removed, renamed or retyped.
  
  - **A date-only end is inclusive on the object gantt too.** `ObjectGantt` read a stored end like a start, as the named day's local midnight, so every bar was drawn one day short and a successor starting the next day stood one day after its predecessor. The schema catalog's own plans drew that way. A task from `2024-01-01` to `2024-01-15` now runs through January 15th, and a successor starting `2024-01-16` begins exactly where it ends, as the timeline's gantt already drew it (objectui#11112). A task whose date-only start and end name the same day is now one day long, where it was a zero-length milestone. An end with a time part is still an instant, and the bar ends exactly there. Baseline ends read the same way.
  - **One rule, in `@object-ui/core`.** `toDisplayEndDate` reads an end: a date-only value becomes the start of the next day (a calendar day, so 23 or 25 hours across a DST change), and anything else is read as `toDisplayDate` reads it. `toInclusiveEndDay` is its exact inverse: it names the last day a span ending at an instant runs through. The timeline's gantt and `ObjectGantt` both read their ends through the first, so they cannot drift apart again. A day whose OWN midnight does not exist in the viewer's zone (`America/Santiago` on 2026-09-06, which starts at 01:00) now ends at the next day's midnight; the timeline used to end it at 01:00 of that next day. A day whose NEXT midnight does not exist (2026-09-05 there) still ends at the next day's first hour, as it did.
  - **A drag writes the day the bar runs through.** A dragged or resized bar whose end lands on a day's midnight writes the day before it into a date-only end field, so reading, dragging and writing a stored `2024-01-15` leaves `2024-01-15`. This also holds under a business `timeZone` whose clock skips a midnight. A `datetime` end still writes its instant.
  - **The view names that day.** `GanttView`'s End column, row date line, tooltip, drag preview and inline editor now name the last day a bar runs through, and the tooltip's day count includes it. Pressing Enter on an untouched row in the inline editor commits the end it started with. An end inside a day still names that day, and a zero-length task still names its own day. An embedder that passes `GanttView` a `Date` end directly now sees that end named as the last day the bar covers. A local-midnight end is named as the day before, which is where its bar already stopped.
  - With `autoZoomToFilter: false`, the pinned range ends on the last day any task runs through, and no longer adds an empty day column after it.
- c1763e5: fix(plugin-gantt): a number row in the gantt tooltip shows the field's declared decimals, and none when it declares none
  
  A tooltip row over a `number` field (and the `integer`, `float` and `decimal`
  spellings the tooltip groups with it) always read two decimals, whatever the field
  declared. A field declaring `scale: 3` read `1.50`, a field declaring `scale: 0` read
  `1.50`, and a `number` with no `scale` read `1.50` while the list cell for the same
  value read `1.5`. The row now reads the field's width through `resolveFieldScale`
  from `@objectstack/spec/data`, as the list cell does. A declared `scale` is that
  width. A field with no `scale` shows the value as stored (`1.5`, `12`, `7`), because
  the protocol gives these types no default width.
  
  Only the decimals change. The row still uses the display locale, and it still groups
  thousands as before.
- b149617: fix(plugin-gantt): a percent row in the gantt tooltip shows the field's declared decimals
  
  A tooltip row over a `percent` field declaring `scale: 2` read whole percents
  (`12%`) while the list cell for the same value read `12.34%`. The row now reads
  the field's width through `resolveFieldScale` from `@objectstack/spec/data`, as
  the list cell does. A percent that declares no `scale` is unchanged.
  
  `@object-ui/plugin-gantt` raises its `@objectstack/spec` floor to `^17.5.0`,
  the first release exporting `resolveFieldScale`.
- 31987bd: Three more reader sites stop riding `BaseSchema`'s index signature (objectui#11355 round 2, part of the preparation for objectui#8347's removal of that signature). None changes runtime behaviour.
  
  **`ActionBarSchema`, the `action:bar` node, is now exported by `@object-ui/types`.** It used to be declared in `@object-ui/components`' `renderers/action/action-bar.tsx`, which is not on that package's entry, so a host could not import it. It now lives in `@object-ui/types`' `ui-action.ts`, beside `UIActionSchema`: `actions` and `systemActions` are `UIActionSchema[]`, and `location` is `@objectstack/spec`'s `ActionLocation`. It declares no `[key: string]: any`, so a literal typed `ActionBarSchema` may write only its declared members, which are the keys the renderer reads. The renderer imports it from `@object-ui/types`, and its parameter annotation keeps its own index signature for the DOM pass-through (objectui#4422). `@object-ui/components` adds no export.
  
  **`ObjectChartSchema.isAnimationActive?: boolean` is declared on the TypeScript face.** Code sets it `false` for a render with no entrance animation: `DashboardRenderer` and `DashboardGridLayout` on the `object-chart` nodes they build, and `DatasetWidget` and `DatasetReportRenderer` on the nodes they hand the `chart` registration. `ChartRenderer` honours it. The zod mirror declares no member for it, so it is not an authoring key; `zod-mirror-parity.test.ts` files it as runtime-only.
  
  **Typed where they stand.**
  
  - `@object-ui/app-shell`: the list-toolbar `action:bar` nodes in `EnvironmentListToolbar`, `InterfaceListPage` and `ObjectView` are built as `ActionBarSchema` values before they reach `SchemaRenderer`.
  - `@object-ui/plugin-gantt`: `ObjectGantt`'s dev warning about flat gantt keys that a `gantt` block shadows reads those keys off `ObjectGanttSchema`, which declares every one, instead of through a `Record` conversion.
  
  **minor, not patch, for `@object-ui/types`.** `ActionBarSchema` is a new export, and `isAnimationActive` is a new member in the shipped `.d.ts`.
- 4a1adb7: The schedule-conflict and auto-schedule dialogs' task counts read the right noun form in every language at every count (objectui#11445): `gantt.conflict.body`, `gantt.autoScheduleDlg.body` and `gantt.autoScheduleDlg.skipped` are i18next count families, so German no longer reads `1 betroffene Vorgänge` and Russian reads `3 задачи`. The provider-less fallback reads a family's `_one` / `_other` row for a numeric `count`.
- f560ded: The gantt tooltip's `percent` row scales at the storage the field declares
  (`percentCellScale`, the spec's `percentScaleOf`), the answer the list cell
  reads. A fraction-stored `1` now reads `100%`, where the old magnitude guess
  read `1%` (objectui#11475).
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
- 9b61cf1: The package README stops documenting a `navigation` key the spec refuses, and the corrected example is now parsed by the schema that validates it.
  
  `README.md`'s record-navigation override read
  `{ mode: 'page', basePath: '/console/apps/.../campaign' }`. `basePath` is not a
  member of the spec's `NavigationConfig`, and nothing consumes it:
  `useNavigationOverlay` — where a gantt's `navigation` lands — builds no URL out
  of the config, and `ObjectGantt` calls the hook with no `onNavigate`, so a
  page-mode click falls through to the host's `onRowClick`. The destination route
  is owned by the host and was never authorable through this key, under any
  spelling.
  
  That made the snippet worse than inert. `NavigationConfigSchema` is a strict
  object with no passthrough, so the undeclared key did not fall away quietly — it
  rejected the **whole** config with `unrecognized_keys`, taking down the
  `mode: 'page'` the sentence was actually teaching. An author who copied the
  documented snippet got a rejected navigation config and no page navigation, which
  is the copy-the-snippet-get-rejected shape objectui#5057 / #5012 named on other
  keys.
  
  The example is corrected to `{ "navigation": { "mode": "page" } }` — the shape
  the sentence demonstrates — and the prose now says who owns the destination route
  and points at `@objectstack/spec`'s `NavigationConfigSchema` for the member list
  instead of restating it, matching the derivation `ObjectGanttSchema.navigation`'s
  doc comment (objectui#5903) adopted for the same concept.
  
  `view` is **not** substituted for `basePath`. It is a declared member, but it
  names a form view (the spec: *"Name of the form view to use for details"*) and is
  forwarded to `onNavigate` as the action argument — it is not a route, so putting
  it where `basePath` stood would have replaced an invented key with a wrong one.
  It is documented for what it does.
  
  No gate in this repo could have caught the original defect, and that is why the
  fix ships with a measurement rather than a re-reading: `check-doc-snippet-types`
  compiles `ts`/`tsx` fences and `check-doc-component-types` reads `type` literals,
  and both are structurally blind to a metadata key in a README — the former's own
  header records schema-key validity as "a different question … left unruled on
  purpose". `src/readme-navigation-example.test.ts` closes that hole for this
  example by EXTRACTING the fence from the README on every run and parsing it
  against `NavigationConfigSchema`, with a control asserting the same parse still
  rejects an undeclared key by name, so the green cannot come from a schema that
  accepts everything.
  
  `tsconfig.test.json` names `node` in `types` for that test to compile, and its
  comment — which had recorded that no test in this package touches a Node global
  — is corrected rather than left standing.
  
  **Dated note, 2026-10-01 (objectui#11168 slice 4).** Two sentences above describe a README that has since moved. objectui#7334 (same release) gave `ObjectGantt` its own `onNavigate`, so a `page` click no longer falls through to a host handler: the gantt navigates to the record-page address it derives from the page it is on, and no `navigation` member authors that address, `basePath` included. The README example is now the authored node, with `{ "mode": "page" }` inside its `properties` bag, and the prose says where that address leads. The rest of this entry is kept as the reading of this change.
- cbc8839: `ObjectGantt`'s export filename resolves a locale-map `label` instead of stringifying it
  (objectui#6052). A gantt authored as
  `{ "type": "object-gantt", "objectName": "task", "label": { "en": "Shift Plan", "zh-CN": "排班计划" } }`
  exported its PNG/PDF as `[object Object]-20260825-1030.png`.
  
  `BaseSchema.label` is `string | I18nLabel` since #4580's revised Q1-A ruling — `I18nLabel`
  being the spec's INLINE locale MAP — and the `exportFileName` chain handed that value
  straight to `String(...)`. It now goes through `resolveI18nLabel` from `@objectstack/spec/ui`,
  the producer's own resolver for that vocabulary, against the display locale the file already
  reads via `useDisplayLocale()`. A zh-CN audience gets `排班计划-<stamp>.png`, an en audience
  `Shift Plan-<stamp>.png`, and a plain-string label is unchanged.
  
  The next link in the same chain, `objectSchema?.label`, is deliberately left alone: that is
  the DATA object's label, declared `z.string().optional()` on the spec's `ObjectSchemaBase`,
  which is a `strictObject` — a locale map there is rejected by the producer rather than
  resolved by the consumer, and wrapping it would be accepting a second vocabulary at a read
  site. No filename sanitisation is added either; `GanttView` already strips
  filesystem-hostile characters downstream, and a resolved map entry goes through the same
  strip a plain string does.
- 45a9aeb: `ObjectGanttSchema.dependencyField` is now marked `@deprecated` on both published
  declaration faces, naming `dependenciesField` as the canonical spelling
  (objectui#6470). Nothing is removed and nothing is rejected that was accepted
  before.
  
  **What the two spellings were.** `ObjectGanttSchema` declares both, and
  `getGanttConfig`'s flat branch reads them with a `||`:
  `dependenciesField: schema.dependenciesField || schema.dependencyField`.
  `dependenciesField` is the spec's key (`@objectstack/spec`
  `GanttConfigSchema.dependenciesField`); the singular `dependencyField` has NO
  spec counterpart — zero occurrences across `packages/spec/src`, measured against
  a live positive control on the plural. Until objectui#6051 declared the plural,
  the singular was the ONLY dependencies spelling this interface carried, so for
  the whole time the alias existed the published type taught the non-spec key and
  hid the canonical one.
  
  **What was missing was the ranking, not the behaviour.** The two were declared as
  equals: nothing on either face said which one to author, so a reader — including
  an AI writing metadata, which is the reader this project optimises for — had a
  coin flip between a spec key and pre-spec vocabulary. The marker turns that coin
  flip into a fact the type itself carries, and the zod mirror's description makes
  it readable at runtime as well as in an editor.
  
  This adopts the idiom already ruled for this exact shape rather than inventing a
  second one: `KanbanConfig`'s pre-#2231 aliases (`groupField`, `cardFields`) carry
  `/** @deprecated legacy alias for the spec's X */` plus
  `.describe('Deprecated alias for X')`, and `dependencyField` now reads the same
  way.
  
  **⛔ Not a removal, deliberately.** Deleting the alias — or narrowing the
  renderer's `||` — would break every author who wrote the singular and narrow the
  accept set of a published surface. That is a maintainer decision on a future
  enforce-or-remove card once the deprecation has sat a release, and it is
  explicitly excluded here. Two pins hold the line in both directions:
  `packages/types/src/__tests__/gantt-dependency-field-deprecated-alias.test.ts`
  fails if the marker goes missing AND if the alias stops being declared or
  accepted, and `packages/plugin-gantt/src/ObjectGantt.dependencyAlias.test.tsx`
  fails if the `||` limb is dropped — the two spellings must keep resolving to the
  same config, with the canonical one winning when both carry a value.
  
  `packages/plugin-gantt/README.md`'s `ObjectGanttSchema` example authored the
  singular; it was the only in-repo site that did, and it now authors the plural
  with the alias named as legacy. No runtime code, fixture, example app or catalog
  schema authored it.
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
- 231d1b9: Gantt toolbar: the period label names the visible window, and the prev/next
  buttons step it (objectui#7203).
  
  The label formatted `timelineRange.start` — the memo spanning the whole dataset
  — so it named the first unit of the entire result set and could not change while
  the chart was scrolled, because it was not derived from scroll position at all.
  On a dataset running January to December it therefore read "January 2026" at
  every scroll position, four pixels above a band header correctly reading
  "Aug 2026". Measured on the demo fixture in Chromium at 1440x900: on first paint,
  after the chart auto-scrolls to Today, the label read `December 2025` over
  columns `28F 29S 30S 31M 1T 2W 3T` with the band beneath them reading `Aug 2026`.
  Two month labels four pixels apart, disagreeing — and the wrong one is the
  prominent one, so the chart reads as if the columns were mislabelled.
  
  The label now names the period at the left edge of the viewport, snapped to the
  same tier `headerGroups` bands the timeline by: a month under day and week view,
  a year under month and quarter view, a decade under year view, the shift-day
  under shift-segmented day view. The toolbar and the band header therefore agree
  by construction rather than by two derivations that can drift. Wording is
  unchanged for the month tier — the toolbar still spells the month out
  ("August 2026" beside the header's "Aug 2026").
  
  The `‹` / `›` buttons rendered an `aria-label` and an icon and carried no
  `onClick`. They now scroll the visible window one period backwards/forwards at
  that same tier, clamped to the ends of the timeline (ADR-0049 enforce-or-remove:
  wiring is the branch the label change makes available). They step the label's
  tier rather than one column, so a click always changes what the label says.
  
  The band header is untouched. It was already correct; it is the reference here.
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
- 92c65aa: `ObjectGantt` no longer blanks the chart when one reload supersedes another
  
  `reload()` already sequenced concurrent runs with `reloadSeqRef` and guarded every
  result write with `isCurrent()`, but its `finally` was unguarded — so a **superseded**
  reload still flipped `loading` / `refreshing` off. The stale run only had to finish
  first, which is the ordinary case whenever a second reload is issued while the first
  is still in flight: the placeholder was released, no rows had arrived, and the user
  saw an empty chart until the fresh response landed.
  
  The `finally` now clears the flags only when the run reaching it is still the current
  one. It clears **both** flags rather than only the one its own `silent` mode set:
  being current at that point means nothing is in flight any more, so clearing only its
  own mode would strand the other flag whenever the superseded run used the other mode
  — a silent toolbar refresh overtaken by a filter-change reload would have left the
  refresh button busy for the life of the component.
  
  This is the reload guard alone. Nothing about which queries are issued, how they are
  projected or how they page changes.
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
- 67d4ed9: `ObjectGantt` no longer treats an EMPTY host `data` array as the rows it was handed (objectui#7333).
  
  `ObjectGantt` read a host `data` prop at two places, and both accepted `[]`. The
  reload's short-circuit tested `data && Array.isArray(data)`, and an empty array
  is truthy, so the chart adopted it and returned before its own query. The gating
  flag tested `Array.isArray(data)` alone, so the same array also switched off the
  object-schema gate and the data-invalidation subscription of that query. A gantt
  whose `data` names its own source, for example `{ provider: 'api', read }`,
  therefore painted an EMPTY chart whenever a host handed it an array it had not
  filled yet.
  
  Both places now read one predicate. A host `data` array is adopted only when it
  has rows. An empty one reads as "no host rows yet": the chart queries its own
  source, exactly as it does with no host array at all, and adopts the host's rows
  when they arrive.
  
  Who can reach this: the registered `object-gantt` renderer still forwards no
  host prop, and `ObjectGanttProps` does not declare `data`, so only a caller that
  renders `ObjectGantt` directly and spreads `data` in was affected.
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
- 3ef0b51: fix(plugin-map, plugin-gantt): the registrations no longer declare `objectName` a required input
  
  Both renderers read their records from one of three keys (`data`, then
  `staticData`, then `objectName`), and the `object-map` / `object-gantt` zod schemas
  enforce "one of the three" through `requireRecordSource` (`77cb489b4`). The
  registrations' designer-facing `inputs` still said `objectName` was required, on
  `object-map`, `map` and `object-gantt`, so the html tier's validator reported a
  `missing-required-prop` error on a block authored on `staticData` or `data` that
  the schema accepts and the renderer draws.
  
  `objectName` is now declared without `required`, and its description states the
  rule: the record source is one of `data`, `staticData` and `objectName`, and the
  schema refuses a block that declares none of them. No one-of form was added to the
  input declaration; the zod refinement stays the place that enforces it. The
  renderers' read order is unchanged. The `@object-ui/plugin-gantt` README sentence
  that called `objectName` required is corrected (objectui#7470).
  
  **Correction, 2026-10-01 (objectui#11117).** The rule this entry describes gained an exception:
  the `object-map` and `object-gantt` schemas also accept a block that declares none of the three
  when its `dataSource.object` names the object, because the registration's `ElementDataSourceGate`
  lands that name on `objectName`. The `objectName` input description now says so.
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
- Updated dependencies [0361d6b]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [588380d]
- Updated dependencies [8cedb0d]
- Updated dependencies [162621b]
- Updated dependencies [b06c3de]
- Updated dependencies [0d379f5]
- Updated dependencies [4c6f549]
- Updated dependencies [80c5412]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [879ecac]
- Updated dependencies [c2dabf0]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e686f4d]
- Updated dependencies [212c451]
- Updated dependencies [a04b06d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [fa5fbd9]
- Updated dependencies [5f44cc6]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
- Updated dependencies [65f1e8d]
- Updated dependencies [fd6f5da]
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
- Updated dependencies [cc4366d]
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
- Updated dependencies [d999617]
- Updated dependencies [93a689d]
- Updated dependencies [4357a27]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [39bf246]
- Updated dependencies [8740e86]
- Updated dependencies [d22b37b]
- Updated dependencies [9cbe4db]
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
- Updated dependencies [8848ce4]
- Updated dependencies [f905090]
- Updated dependencies [3cd6c5e]
- Updated dependencies [5bb855d]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
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
- Updated dependencies [bf14b64]
- Updated dependencies [4345558]
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
- Updated dependencies [b32e7de]
- Updated dependencies [ff94a12]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [97672ba]
- Updated dependencies [c5ec15c]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [285e36b]
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
- Updated dependencies [3a0e7ab]
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
- Updated dependencies [4a1adb7]
- Updated dependencies [185b7a0]
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
- Updated dependencies [a439e16]
- Updated dependencies [67fc3b0]
- Updated dependencies [8579e34]
- Updated dependencies [d57db5d]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [9409eb9]
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
- Updated dependencies [c4326fe]
- Updated dependencies [4dfdcc3]
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [f08bcd9]
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
- Updated dependencies [e8e4c4d]
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
- Updated dependencies [554e647]
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
- Updated dependencies [e1c27e4]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [f52a9d7]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [592402e]
- Updated dependencies [ad852b6]
- Updated dependencies [6778809]
- Updated dependencies [3a3dd28]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [0758bd8]
- Updated dependencies [ee4d19f]
- Updated dependencies [37149ec]
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
- Updated dependencies [e2feb13]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [9dcc545]
- Updated dependencies [d7fecfb]
- Updated dependencies [c13d39e]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [309728c]
- Updated dependencies [c03d03b]
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
- Updated dependencies [639ca9d]
- Updated dependencies [2152962]
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
- Updated dependencies [cc00c59]
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
- Updated dependencies [0b138da]
- Updated dependencies [3ecc369]
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
- Updated dependencies [0eaed83]
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
- Updated dependencies [e05553c]
- Updated dependencies [697aabc]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
- Updated dependencies [f0f2046]
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
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [d0f52e4]
- Updated dependencies [e708426]
- Updated dependencies [33e1697]
- Updated dependencies [3b6d53b]
- Updated dependencies [e22fa12]
- Updated dependencies [1560d46]
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
- Updated dependencies [4d7d322]
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
- Updated dependencies [e4e9557]
- Updated dependencies [7a28e1e]
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
- Updated dependencies [b6e83be]
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
- Updated dependencies [4bb940b]
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
  - @object-ui/plugin-detail@17.7.0
  - @object-ui/react@17.7.0
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/i18n@17.7.0
  - @object-ui/components@17.7.0
  - @object-ui/fields@17.7.0
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
- 6098ecd: plugin-gantt README: the `onTaskUpdate` drag example no longer writes blank dates on a progress drag.
  
  `GanttViewProps.onTaskUpdate`'s second parameter is
  `Partial< Pick< GanttTask, 'title' | 'start' | 'end' | 'progress' > >`
  (`src/GanttView.tsx:345`), so the destructured `start` / `end` are
  `Date | undefined`. The README's "Drag-and-drop rescheduling" example destructured
  them and passed both straight to `save(...)`, under a comment asserting they are
  always real `Date` objects. Both layers of that assertion were wrong.
  
  The runtime half is the one that mattered. `onTaskUpdate` is the single exit for
  every edit path, and the progress grip commits changes with **no** dates at all —
  `commitTaskUpdates([{ task, changes: { progress: cur.value } }])`
  (`src/GanttView.tsx:1335`), forwarded verbatim by `onTaskUpdate(task, changes)`
  (`:1091`). A host that copied the example therefore called
  `save(task.id, { start: undefined, end: undefined })` on every progress drag,
  blanking the record's start and end dates. Drag is documented as opt-in via
  `onTaskUpdate` alone and progress drag needs no extra switch, so the path was
  reachable by default rather than a corner configuration.
  
  The example now guards with `if (!start || !end) return;` and its comment states
  the real shape — that only the keys an edit touched are present, and that the
  progress grip sends just `{ progress }`. Documentation only; no renderer behavior
  changed.
- bb3fab6: Docs only: `packages/plugin-gantt/README.md` no longer teaches two identifiers the
  package does not export, nor a task shape it does not produce (objectui#5012).
  Each README import was judged against the entry module's real export surface
  (35 names, read from the build product's `dist/index.d.ts`), and every corrected
  snippet was type-checked against that same build product:
  
  - **`ganttComponents`** — taught as a components map to iterate over for "manual
    registration" (`Object.entries(ganttComponents).forEach(...)`). It does not
    exist anywhere in the package, so the snippet was `Object.entries(undefined)`:
    a `TypeError` on the first line a reader copied. Registration is *only* the
    side effect of importing the entry point, which runs the two
    `ComponentRegistry.register(...)` calls in `src/index.tsx`. The section is
    replaced by what actually happens: the schema types those calls claim
    (`object-gantt` → `plugin-gantt:object-gantt`, `gantt` → `view:gantt`, both
    with a bare-`type` fallback), the package's real export surface, and — for the
    use case the old snippet was reaching for — registering the exported
    `ObjectGanttRenderer` under a key of your own.
  
  - **`GanttSchema`** — taught as the component schema type in the TypeScript
    section. Pure fiction: zero hits in this package and in `@object-ui/types`
    (a plain grep appears to find it only as a substring of `ObjectGanttSchema`;
    under a word boundary it has no hits at all). The authored type does exist
    under its real name, so the example is rewritten around it rather than
    dropped: `ObjectGanttSchema` from `@object-ui/types`, which is
    **record-driven** — `type: 'object-gantt'` plus an object name and the fields
    to read. It never carried the `tasks` array the old snippet assigned to it.
    No export was added to make the old name true.
  
  - **`GanttTask`** — the one real name of the three, and the reason the section
    still failed to compile. The documented shape had drifted from the exported
    type on three counts: the label field is `title`, not `name`; `start`/`end`
    are `Date` objects, not ISO strings; and `color` is a CSS color, not a
    Tailwind class. Both the "Task Structure" reference block and the typed
    example now match the exported declaration, and the reference block is pinned
    against it in both assignment directions so a future drift fails a check
    instead of compiling as an unrelated local interface.
  
  No code, types or runtime behaviour change — the diff is one README and this
  changeset. The correction reaches npm with the package's next publish, which is
  why it declares a patch: `README.md` is in the package's published `files`.
- 449ffe8: Fix the `GanttViewMode` JSDoc to name all five granularities (objectui#5132).
  
  The comment above `export type GanttViewMode` said "one column per day, week,
  month, or quarter" while the type itself, `VIEW_MODES`, `NOMINAL_DAYS`
  (`year: 365.25`), the column builder, the toolbar and the header-band logic
  have honored a fifth member, `'year'`, all along — `'year'` was fully live,
  just undocumented. Doc-only change, no behavior difference.
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

## 17.5.0

### Patch Changes

- ebb4e0e: The date formatter's last three en-US channels now follow the display locale
  (objectui#4272).

  objectui#4468 (PR #4512) pointed every date _renderer_ at `useDisplayLocale()`.
  Three channels were out of its reach because they are properties of the
  formatter's signature and of its callers rather than of any renderer, so a `zh`
  console still met English dates in three places:

  - **`formatDate`'s `'short'` branch** hardcoded
    `toLocaleDateString('en-US', { month: 'short' })`, so it rendered an English
    month even when the caller had threaded `options.locale` into that very call.
    Its only consumers are ObjectGrid's two mobile-card date cells, which threaded
    no locale — fixing either half alone moves nothing, so both land here.
  - **`formatDateTime` took no options parameter at all**, so no caller could
    localize it however hard it tried; it always handed `Intl` an `undefined` tag,
    which means the MACHINE's locale — neither of the repo's two locale channels.
    The parameter is optional and lands together with its consumers, plugin-gantt's
    four tooltip call sites.
  - **The lookup picker's MongoDB `$date` fallback** called a bare
    `toLocaleDateString()` with no tag.

  One resolver everywhere, as before: `useDisplayLocale()` (tenant regional
  default → active UI language → `'en'`). `Intl` accepts `'zh'` verbatim, so there
  is still no mapping table anywhere.

  English output is byte-identical at every touched site — `en` and `en-US` agree
  on all twelve short month names — and the `'short'` layout itself is unchanged:
  only the month token is localized, the compact `"Jan 15, '24"` shape around it
  is a deliberate fixed layout for narrow cards.

  `@object-ui/fields` is `minor` because `formatDateTime`'s new optional parameter
  is visible in the package's entry `.d.ts`; the plugin packages' own `.d.ts` files
  are byte-identical, so their change is module-local.

- 828549a: The gantt's conflict dialog shows the number of affected tasks again, not a literal `{2}`

  `gantt.conflict.body` was resolved at the render site with a literal string replace on **single** braces — `t('gantt.conflict.body').replace('{count}', String(n))` — while all ten locale packs spell the placeholder the i18next way, `{{count}}`. `"…{{count}}…".replace("{count}", "2")` consumes the inner seven characters and leaves the outer pair behind, so every user on every loaded pack read "自动重新排程 **{2}** 个受影响的任务？". The dialog now interpolates through i18next (`t('gantt.conflict.body', { count })`), the idiom `gantt.delete.body` already used.

  The two sibling keys three lines away in the same file, `gantt.autoScheduleDlg.body` and `.skipped`, were **not** broken — pack and call site both used single braces, and they rendered correctly. They are converted anyway, because that split is the whole mechanism: two write-confirmation dialogs in one component carried two different interpolation idioms, so `conflict.body` drifting to the i18next spelling in the packs (which is the correct spelling, and matches every other placeholder in the bundle) silently broke the render. Leaving the auto-schedule keys on the literal-replace idiom leaves the same trap armed for the next translator. All ten packs and the plugin's bundled English fallback table now agree on `{{count}}` for all three; only the braces moved, no translation was reworded.

  `gantt.quickFilter.resultSummary` stays deliberately single-brace — its `ObjectGantt` call site really does resolve `{shown}`/`{total}` with a literal replace, and that convention is pinned by its own parity test. It is now the only key in the gantt namespace on that idiom, and the comments at both spellings say so.

  Nothing caught this, and each gate was silent for its own reason: the cross-pack parity check compares en against each pack, and all eleven spellings agreed; the en-drift check compares a pack against its own history, and the packs were born matching. Both are **relative** comparisons, and the defect lived in the **absolute** relationship between a pack's spelling and the syntax the call site resolves. The existing render test asserted the dialog body contains `'1'` — which `{1}` satisfies. The new pin asserts the absolute form directly, under a real loaded pack, for every way a placeholder can survive to the screen.

- e1ade8f: An illegal gantt dependency link now says why it was refused, instead of doing nothing

  Dragging a dependency onto a target the gantt refuses — itself, a locked row, a group row, or one that would close a dependency cycle — produced no feedback of any kind: no toast, no dialog, no cursor change, no target outline, not even a console warning. The guard was right and completely invisible, so a user drawing a legitimate-looking dependency got a dead interaction and no way to learn the constraint. The rejection was silent in both places it could have shown: a refused bar never became the drop target, so it got no hover treatment at all, and the release handler only ran its body when a target _had_ been registered, so the drop itself was a no-op.

  Both halves are now wired, and both read the **same** verdict. `canReceiveLink`'s four-branch boolean became `classifyLinkTarget`, which returns which branch refused (or `null`), with the boolean derived from it. The hover affordance and the drop toast are two consumers of that one classification, so the reason a user is shown cannot drift from the reason the link was actually refused — there is no second classifier to disagree. The branch names are the leaves of the new `gantt.link.rejected.*` keys, so a branch added later without a message surfaces as a missing key rather than as a plausible-but-wrong sentence.

  During the drag, a refused bar under the pointer gets `cursor: not-allowed` and a destructive outline; on release it raises a toast naming the reason. Four messages, one per branch, in all ten packs. Both the cursor and the outline are driven from inline `style` rather than utility classes, matching the bar's existing read-only cursor three lines away and for the same reason recorded there: `cursor-not-allowed` and the ring alpha utilities are not emitted in the prebuilt components CSS, so a class would look correct in a DOM test and render nothing in a browser.

  Deliberately unchanged: a host veto through `onBeforeDependencyCreate` stays silent. That rejection carries a reason only the host knows, and the gantt has none to show — surfacing it means exposing a rejection-reason output on the public component, which is a separate contract rather than a rider on this one. The four built-in reasons are the gantt's own policy and are the only ones it can explain.

  One of the four, `group`, has no end-to-end path today: a `type: 'group'` row renders no bar, so the drag can never target it. The message is kept anyway — without it the branch would render a raw key on screen if it ever did fire — and the test pins the reachability fact, so it goes red the day group rows gain a bar. Filed as objectui#4209.

- db4ad6b: Gantt tooltip currency re-formats when the tenant currency resolves
  (objectui#4542).

  ObjectGantt's `tasks` memo builds every tooltip string eagerly inside its
  callback, and the `'currency'` case resolves its code down to the tenant
  default (`resolveFieldCurrency(def, tenantCurrency)`). `tenantCurrency` was
  not in the memo's dependency array, so the value was read but never watched.

  That default comes from `GET /api/v1/auth/me/localization`, which is cosmetic
  and non-blocking and therefore answers AFTER first paint. The context change
  re-rendered ObjectGantt, but with none of `data` / `ganttConfig` /
  `objectSchema` / `displayLocale` changed the memo handed back its cached task
  array — so a tooltip amount kept the pre-resolution rendering (a plain
  `1,234.50` instead of `€1,234.50`) until something unrelated invalidated the
  memo.

  This is the currency twin of objectui#4272, which added `displayLocale` to
  this same array for the same reason, and it is not covered by that dep: the
  producer writes currency and locale from one response, so a tenant that
  configures BOTH re-runs the memo through the locale channel — but a tenant
  that configures a currency and no locale (the common shape, since the tenant
  locale is frequently unset) leaves `displayLocale` untouched and the currency
  stale.

  Module-local: the fix is one dependency, the package's `.d.ts` files are
  byte-identical, and rendering is unchanged whenever the channel resolves
  before first paint or a field carries its own currency code.

- a908882: Gantt tooltip numbers and currency follow the display locale (objectui#4553).

  `formatFieldValue`, the tooltip value formatter inside ObjectGantt's `tasks`
  memo, had its four TEMPORAL call sites threaded with `useDisplayLocale()` by
  objectui#4272. The numeric cases beside them passed no locale, so they reached
  `new Intl.NumberFormat(undefined, …)` — the MACHINE's locale, which is neither
  of the repo's two locale channels.

  One tooltip therefore rendered two conventions. A German session read
  `5. Jan. 2024` on the date row and `1,234.50` on the amount row directly below
  it, where German groups with `.` and marks the decimal with `,`. Inverted
  separators do not read as an unstyled number; they read as a different number.
  The currency row was affected in the symbol's POSITION too — `1.234,50 EUR`
  rather than `EUR1,234.50` — while the currency CODE itself was already resolved
  correctly (objectui#4542 made the memo watch it); only the locale rendering that
  code was missing.

  `number` / `integer` / `float` / `decimal` and `currency` now pass the
  `displayLocale` already read at component level, using each formatter's existing
  locale parameter. No formatter signature changed and no memo dependency changed
  (`displayLocale` has been in that array since objectui#4272), so this is
  consumer-side threading only: the package's `.d.ts` files are byte-identical and
  English output is unchanged at every touched site.

  Known gap, tracked on objectui#4553: the `percent` row still does not follow the
  display locale. `formatPercent(value, precision)` takes no locale parameter —
  it is `${percentDisplayValue(value).toFixed(precision)}%`, so it builds no
  `Intl.NumberFormat` at all and renders in NO locale rather than the machine's
  (ASCII decimal mark, never grouped, identical on every machine). Closing that
  needs a `@object-ui/fields` signature change, which is outside this change's
  ruled surface, and is pinned by a test here so the gap cannot drift unnoticed.

- 0ca6096: A gantt task titled `A$&B` no longer prints `{{title}}` back into its own delete dialog — the two hand-rolled provider-less fallback interpolators are literal, like i18next

  objectui#3418 fixed the shared helper's fallback interpolator: `String.prototype.replace` became `split(needle).join(value)`, because `replace` and `replaceAll` both interpret `$&`, `` $` ``, `$'` and `$$` in the **replacement** string and i18next does not. Two hand-rolled copies of that interpolator never got the fix. Both are deliberate non-users of `createSafeTranslation` — each falls back per key so a host dictionary that covers the common keys but lags on newer ones still resolves what it has — so the shared fix had no path to reach them.

  The reachable one is gantt's. `gantt.delete.body` is `'"{{title}}" will be permanently removed. …'` and its call site interpolates the record's own title, which is user data:

  | task title | rendered before                                                       | rendered now                              |
  | ---------- | --------------------------------------------------------------------- | ----------------------------------------- |
  | `A$&B`     | `"A{{title}}B" will be permanently removed.`                          | `"A$&B" will be permanently removed.`     |
  | `` x$`y `` | `"x"y" will be permanently removed.`                                  | `` "x$`y" will be permanently removed. `` |
  | `p$$q`     | `"p$q" will be permanently removed.`                                  | `"p$$q" will be permanently removed.`     |
  | `u$'v`     | `"u" will be permanently removed. …v" will be permanently removed. …` | `"u$'v" will be permanently removed.`     |

  The first row is the ugly one: `$&` expands to the matched text, so the placeholder itself is printed back to the user inside the record's own name. Gantt's copy also carried the other half of the same defect — a bare string needle substitutes only the **first** occurrence, where i18next substitutes every one — and `split`/`join` fixes both at once.

  The import wizard's copy used a `g`-flagged `RegExp`, which covered the repeated-placeholder half but could not touch the `$`-pattern half: that harm lives in the replacement string, not the needle. Its values are authored metadata — field labels and type names spliced into `grid.import.missingRequiredHint` and `grid.import.legacyReferenceBlocked` — so a label containing `$&` corrupted the hint the same way. Retiring the `RegExp` also retires an unescaped needle, since the placeholder name went into the pattern uninterpolated; that was inert while every placeholder name is a bare identifier, and is now structurally impossible.

  This is the provider-less path only (standalone embedding, unit tests). With an `I18nProvider` mounted, i18next serves these keys and was already literal on both sides — which is exactly why the divergence was invisible. No pack, key or call site changed; the three `{{count}}` gantt keys take numbers and were never affected, and `gantt.quickFilter.resultSummary`'s deliberate single-brace idiom is resolved by its call site rather than this interpolator and is untouched.

- 36310dc: `formatPercent` groups its output and follows the display locale — the last
  tooltip/cell channel (objectui#4553).

  PR #4557 threaded the gantt tooltip's number and currency rows and measured that
  the percent row could not follow: `formatPercent(value, precision)` took no
  locale parameter, and its whole body was
  `${percentDisplayValue(value).toFixed(precision)}%`. It built no
  `Intl.NumberFormat` and never reached `formatDisplayNumber` — so unlike its
  siblings it did not render in the MACHINE's locale, it rendered in **no** locale:
  an ASCII decimal mark, never a grouping separator, byte-identical on every
  machine.

  **English output MOVES, and that is the fix.** Because the function never
  grouped, `1235%` was wrong in en-US too, not only in German. Grouping and locale
  therefore land together:

  |            | before  | after          |
  | ---------- | ------- | -------------- |
  | en, 1234.5 | `1235%` | `1,235%`       |
  | de, 1234.5 | `1235%` | `1.235\u00a0%` |
  | de, 80     | `80%`   | `80\u00a0%`    |

  Values below the grouping threshold are unchanged in English (`80%`, `12.5%`,
  `33.33%`), so the move is confined to four digits and up. German changes at every
  magnitude, because the no-break space before the sign is part of the locale's
  percent convention — which is what routing through `Intl` buys over appending a
  literal `%`.

  The scaling contract is untouched: `percentDisplayValue` still disambiguates a
  fraction-stored percent (`0.8` → 80%) from a whole one, so the list cell and the
  dashboard measure formatter still agree.

  Consumers are threaded in the same change, the parameter never landing
  speculatively:

  - **fields** — `PercentCellRenderer`, on BOTH of its paths. Its whole-percent
    branch (`progress` / `completion` fields, which store 0-100 and must skip the
    fraction scaling) was a second bare `toFixed` call; leaving it behind would
    have made one grid internally inconsistent, so both branches now share one
    locale-aware body and differ only in the scaling policy.
  - **plugin-gantt** — the tooltip percent row, completing objectui#4553's switch.
  - **plugin-grid** — the mobile card's percent cell, which sits in the same
    density row as a date cell objectui#4272 had already localized.
  - **plugin-dashboard** — `renderFieldValue`'s percent branch. It is a plain
    function rather than a component, so it takes the locale as an optional fourth
    parameter beside the `tenantCurrency` already threaded that way, and both of
    its callers pass it and declare it in their memo dependency arrays.

  Bumps follow each package's own `.d.ts` diff, measured in both directions.
  `@object-ui/fields` and `@object-ui/plugin-dashboard` are `minor` on the
  objectui#4272 / PR #4544 precedent — quoted from that changeset: "`@object-ui/fields`
  is `minor` because `formatDateTime`'s new optional parameter is visible in the
  package's entry `.d.ts`; the plugin packages' own `.d.ts` files are
  byte-identical, so their change is module-local." Here `formatPercent` and
  `renderFieldValue` each gain an entry-visible optional parameter, while
  plugin-gantt's and plugin-grid's `.d.ts` files are byte-identical and stay
  `patch`.

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

- 6d762da: The five locale keys behind #3546's eight no-fallback `t()` call sites are now defined in all ten packs, so the built-in-view toasts, the activity-timeline source link, the wizard's required-field toast and the Gantt refresh button's accessible name are translated instead of falling back to English — or, on two surfaces, to the key itself (part of #3546).

  `scripts/check-i18n-call-site-keys.mjs` measured 258 keys that a `t()` call site asks for and no pack defines. These five were the subset with no working inline default: `console.objectView.cannotEditMetaView`, `console.objectView.cannotDeleteMetaView`, `detail.viewSource`, `gantt.toolbar.refresh` and `wizard.missingRequired`. Adding a `defaultValue` is deliberately not the fix — that mechanism is what kept all 258 invisible for months.

  **Two of the eight sites really did render the raw key**, and both go through a binding with nothing in front of i18next. `ObjectView.tsx` calls `useObjectTranslation()` directly, so five toasts read `console.objectView.cannotEditMetaView` / `cannotDeleteMetaView` on screen; the `|| 'Built-in views cannot be renamed.'` guards next to them were dead on every path, because i18next answers a miss with the key itself and a non-empty string never falls through `||`. Those four unreachable English strings are removed rather than repaired: one key served four call sites (rename / pin / set-as-default / configure), so the pack copy covers any change to a built-in view instead of naming one operation. `RecordActivityTimeline.tsx` fails the same way for a subtler reason — `useDetailTranslation` is `createSafeTranslation(..., 'detail.back')`, and because `detail.back` does resolve, the probe hands back i18next's `t` for every key and bypasses the defaults map wholesale, so `detail.viewSource` reached the user verbatim.

  **The other two sites were not rendering a raw key**, contrary to the issue's description, and are fixed here as the milder "English in all ten languages" class. `wizard.missingRequired` is its own hook's probe key, so the probe failed and `createSafeTranslation` correctly served its English default. `gantt.toolbar.refresh` goes through `useGanttTranslation`, which deliberately does not use `createSafeTranslation` and falls back per key — so the refresh button's `aria-label` was "Refresh", in English, never the key. Screen-reader users heard an English word rather than an identifier; a `zh` session now hears 刷新.

  Regression cover is provider-mounted on purpose: with no `I18nProvider` the defaults maps answer every one of these keys and the assertions pass while the console is broken, which is precisely the false-green the issue documents. For the two sites whose English output was already correct, `en` cannot discriminate before from after — the `zh` assertions are the ones that pin the fix.

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

## 17.3.0

### Patch Changes

- 5c856ec: `ObjectGantt`'s quick-filter bar is now localized instead of pinned to Chinese. The four `QuickFilterBar` labels (`all`, `clear`, `empty`, `resultSummary`) were hardcoded as Chinese string literals at the `ObjectGantt` call site, so the bar read 全部 / 清除筛选 / 无可选项 / 显示 N / M 项任务 under an `en`, `ja`, `es` or `ar` session while the rest of the gantt toolbar localized correctly — a conspicuous mismatch, and a violation of the English-only-codebase rule. `QuickFilterBar` itself was never at fault: it is presentational and already falls back to English, so the host was the only thing pinning the copy.

  The four strings moved into a new `gantt.quickFilter` namespace, added to all ten built-in locale packs, and the call site now resolves them through the gantt package's existing `useGanttTranslation` — the same per-key hook every other gantt string already uses, so a host dictionary that lags on these keys still renders the bundled English default rather than a raw key. `gantt.quickFilter.resultSummary` deliberately keeps SINGLE-brace placeholders (`{shown}` / `{total}`): the call site substitutes them with a literal `.replace`, not i18next interpolation, matching `gantt.autoScheduleDlg.body` and the placeholder convention `all-locales-key-parity` already recognises. Anyone retranslating these packs must keep that spelling — a respell to `{{shown}}` would render the raw placeholder to the user.

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

- 803558e: feat(data): thread the host's authenticated fetch into `provider: 'api'` data sources (#2725)

  `provider: 'api'` view data sources went through a bare `globalThis.fetch`, so
  custom endpoints (gantt composite trees, report aggregates) carried only
  same-origin cookies while every native `/api/v1/*` request carried
  `Authorization: Bearer` — the moment cookie HMAC verification failed (dev
  restart rotating the fallback auth secret, cookie expiry/rotation in prod)
  those views 401'd while the rest of the app kept working.

  - **`@object-ui/react`** — `SchemaRendererProvider` accepts an optional
    `apiFetch`; nested providers inherit it from their parent so re-wrapped
    subtrees (react pages, preview surfaces) keep the host's authentication.
    `useViewData` defaults the api-provider adapter's fetch to the context
    `apiFetch` (explicit `adapterOptions.fetch` still wins).
  - **`@object-ui/auth`** — `createAuthenticatedFetch` gains a
    `sameOriginOnly` option: cross-origin URLs pass through to the bare fetch
    with no `Authorization` / `X-Tenant-ID` / `Accept-Language`, so metadata-
    supplied third-party URLs never see the platform token.
  - **`@object-ui/app-shell`** — the console wires
    `createAuthenticatedFetch({ sameOriginOnly: true })` (settle-signal wrapped)
    as `apiFetch` on the root `SchemaRendererProvider`.
  - **`@object-ui/plugin-gantt`** — `ObjectGantt` resolves its api-provider
    DataSource with the context `apiFetch`, covering reads and write-backs.

  Behaviour is unchanged for hosts that don't provide `apiFetch` (bare fetch +
  cookies, as before).

- 5606ca8: fix(plugin-gantt): align the task-list header with the row date columns

  Every data row reserves a trailing w-6 (+4px) slot for the 「→」 open-details
  button whenever `onTaskClick` is live, but the header row didn't — so the
  开始/结束 header labels sat 28px to the right of the date values they caption.
  The header now mirrors the slot under the same condition.

- 1100a8b: feat(plugin-gantt)!: remove the 移动端二维码 (mobile QR share) context-menu item

  The QR-share feature is removed outright: the context-menu item, the QR dialog,
  the `taskUrl` prop on `GanttView`, the URL wiring in `ObjectGantt`, the
  `gantt.menu.qrcode` / `gantt.qr.*` i18n keys (en/zh) and the `qrcode`
  dependency are all deleted. It baked one consumer's app-specific requirement
  (scan-to-open on mobile) into the generic gantt renderer, and what it encoded —
  the desktop console record URL — was not even the right target for that
  requirement. Apps that need scan-to-mobile flows should implement them
  app-side against their own mobile surface.

- 7a5750e: chore(lint): clear the baseline lint errors in plugin-gantt (objectui#2713 Wave 3)

  Wave 3 of the #2713 lint-gate restoration. `@object-ui/plugin-gantt` was red at
  baseline on `main`; cleared every **error** (no behavior change; warnings out of
  scope). 18 of the 21 were in the demo harness:

  - **`react-hooks/static-components` (demo, ×8)** — the `Swatch` legend cell was
    defined inside `ManufacturingLegend`; hoisted to module scope (purely
    props-driven, so nothing from render scope is captured).
  - **`react-hooks/rules-of-hooks` (demo, ×9)** — `App` had a `?quickfilter=1`
    early return before ~9 hooks; moved that route below all hooks so hook order
    is stable (the quick-filter branch renders `<QuickFilterDemo />` regardless).
  - **`react-hooks/purity` (demo, ×1)** — the demo render-timer necessarily reads
    `performance.now()` during render (paired with an effect that measures elapsed
    ms); justified scoped disable, demo-only.
  - **`object-ui/no-synthetic-event-trigger`** (`GanttView.interactions.test`) —
    the Escape-closes-menu test dispatched a raw `window` `KeyboardEvent`; switched
    to `fireEvent.keyDown(window, { key: 'Escape' })` (the pattern already used
    elsewhere in the same file). The window-level Escape listener behaves
    identically.
  - **`no-useless-assignment`** (`GanttView`, `ObjectGantt`) — dropped two dead
    initializers (`ok`, `options`) that their exhaustive `try`/`catch` and
    `if`/`else` branches overwrite before reading.

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

## 14.0.0

### Patch Changes

- a506e6d: ObjectGantt now supports the `api` data source for **both read and write-back**.
  Previously `provider: 'api'` logged "API provider not yet implemented" and rendered
  nothing, and every write-back (reschedule, dependency edit, delete, drawer
  inline-edit) was hard-wired to the context ObjectQL `dataSource` + `objectName`,
  so the api provider's `write` config was never used.

  All reads and writes now flow through a single adapter resolved by
  `resolveDataSource(schema.data, dataSource)`: `object` → context DataSource
  (unchanged), `api` → `ApiDataSource` (executes the `read`/`write` HttpRequest
  config), `value` → in-memory `ValueDataSource`. A pure-api view needs no
  `objectName` and no context `dataSource` prop. Object-backed views are behavior-
  preserving. Lookup/master_detail quick-filter option domains still resolve from
  the context object backend (they degrade to distinct in-row values when absent).

- 42b36c4: 新增逐任务预警描边(#2436 第 3 项):视图配置 `borderColorField` 指向
  记录上的预警颜色字段(常为服务端计算的超期/临期字段),该行条形在保留
  原有填充色的同时,以该颜色描边并加 2px 光晕——任务条、里程碑菱形、
  汇总条均生效。语义色名(red/orange/…)映射为调色板 hex,其余 CSS 颜色
  原样透传;空值不描边。开启关键路径高亮时,关键路径样式在其标记行上优先。
- 8a7d5af: 拖拽连线增加内建校验与宿主否决钩子(#2436 第 1、2 项)。落点为锁定行
  (`locked`)或分组行(`type: 'group'`)时,悬停不再高亮、松手不再创建;
  成环依赖(直接回边、跨层级传递回边)基于**全量任务集**检测并拒绝——不受
  折叠子树导致可见连线缺边的影响。新增 `onBeforeDependencyCreate(source,
target, type)` 钩子,在内建校验通过后调用,返回 `false` 可否决本次连线
  (即 DHTMLX `onBeforeLinkAdd` / Syncfusion `actionBegin` 惯例)。
  `wouldCreateDependencyCycle` 从 `scheduling` 导出并单测覆盖。
- eef832b: 修复记录抽屉绕过甘特图行级锁定的问题(#2436 第 5 项)。

  - `RecordDetailDrawer` 的编辑/删除能力现在由调用方是否传入 `onFieldSave` / `onDelete` 决定:两者都省略时抽屉严格只读(无内联编辑、无删除入口)。此前抽屉硬编码 `inlineEdit` 与 `showDelete: true`,并无条件向内层 DetailView 传包装函数,导致锁定记录仍可"编辑"(且改动静默丢失)。
  - `ObjectGantt` 对 `lockField` 锁定的行、以及全局 `readOnly` 的甘特图,不再向抽屉传入 `onFieldSave` / `onDelete`,与时间轴上禁止拖拽/调整的行为保持一致。

- 0b03b34: 快速筛选改为树感知(#2436 第 4 项):命中任务的**全部祖先链**一并保留。
  此前 `displayTasks` 是平铺过滤,项目/产品等分组行本身没有可筛字段值,
  一筛就被丢掉,命中的子任务成孤儿、树结构被打散。现在祖先随命中下级
  自动保留、无命中下级时照常剔除,多分支命中共享祖先不重复。
- 07b2cda: 甘特图写后回读 + 工具栏手动刷新按钮(#2436 第 6/7 项)。

  - 拖拽改期、依赖增删、抽屉内联编辑、删除记录成功后,静默重新读取数据源,让服务端重算的字段(父级汇总、预警颜色、工期重算)刷新到图上;此前乐观补丁只保留客户端写入的字段,派生字段一直陈旧直到整页刷新。静默刷新不闪 loading、不卸载 GanttView(保留滚动/折叠状态),并发请求按序号防乱序覆盖;失败时保留屏上最后一份好数据。
  - GanttView 工具栏新增手动刷新按钮(`onRefresh` / `refreshing` props),object 数据源自动接线;内联 value 数据无可回读来源,不显示按钮。

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

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/i18n@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0
- @object-ui/fields@13.1.0
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
  - @object-ui/plugin-detail@7.1.0
  - @object-ui/i18n@7.1.0

## 7.0.0

### Minor Changes

- 995c85d: Gantt feature parity, Phases 1–5: dependency links, real time scales, hierarchy, interaction polish, and virtualization.

  - **Dependency links** — `task.dependencies` renders as orthogonal arrows in an SVG overlay, with all four MS-Project link types (`fs`/`ss`/`ff`/`sf`) via the object form `{ id, type }`. Arrows follow bars live during drag/resize; hovering a bar highlights its links. `normalizeDependencies` (exported) accepts CSV strings, id arrays, and object arrays with id/type aliases. New dependencies can be created by dragging from a bar's link dot onto another bar (`onDependencyCreate`).
  - **Real time scales** — day/week/month/quarter modes with a two-row header (group row + unit row), weekend tinting, zoom in/out, and a jump-to-today button.
  - **Hierarchy** — `parent` builds a tree: collapsible summary rows with bracket-style summary bars aggregated from descendants, milestone diamonds, indent guides, and `aria-expanded`/`role="treeitem"` semantics. Dragging a summary bar moves its whole subtree by the same offset (live preview + one `onTaskUpdate` per task); the summary's displayed range rolls up from children, so moving a child past the parent's edge stretches the parent automatically.
  - **Interaction polish** — progress drag handle, hover tooltip, context menu (including delete), keyboard navigation/editing, inline title editing, and row drag-reorder (`onTaskReorder`).
  - **Scale** — virtualized rows _and_ columns (spacer-based windowing; only the visible window is in the DOM, verified: 5,000 tasks render in ~27 ms with 26 rows in the DOM), a fullscreen toggle, and custom timeline `markers` (`{ date, label?, color? }`).

  Colors that the prebuilt components stylesheet doesn't emit utilities for use theme CSS variables inline, so everything renders correctly in consuming apps.

- 053c948: feat(gantt): year scale, navigation, saved layout, and PDF export (follow-up to #1672)

  - **Year scale** — new `year` granularity (one column per year, with a "20XXs"
    decade group band above); ResourceWorkload follows the same column width/label.
  - **Navigation** — toolbar gains _This week_ / _This month_ jump buttons (beside
    the existing _Today_), scrolling the timeline to the current week/month start.
  - **Saved layout** — `persistLayoutKey` / `onLayoutChange` plus a "Save layout"
    button snapshot the current granularity + zoom + collapsed task columns to
    `localStorage` (`gantt-layout:<object>:<view>`) and restore on next load (an
    explicit `viewMode` prop still wins). `ObjectGantt` derives the key from the
    data object by default; `persistLayout: false` opts out.
  - **PDF export** — rasterizes the whole chart SVG to JPEG embedded in a
    zero-dependency single-page PDF (DCTDecode), alongside PNG export
    (`buildExportSvg` shared by both).

- 053c948: feat(gantt): configurable hover tooltip + live parent-stretch (follow-up to #1672)

  - **Configurable tooltip** — a view declares `tooltipFields` on its gantt config
    (field names, or `{ field, label }` to override the label); `ObjectGantt`
    resolves each against the record (select options → label, lookups → embedded
    record name, dates/numbers/currency/percent through the shared `@object-ui/
fields` formatters) and feeds `GanttView` a `task.fields` array that replaces
    the default hover detail.
  - **Live parent-stretch** — a summary bar's displayed range rolls up from its
    children live, so dragging a child past the parent's edge stretches the parent.
  - Also replaces six prebuilt-CSS utilities the components stylesheet never emits
    (connector dot `-right-2` was occluding the progress label, resize-handle
    width, progress-fill radius, grid z-index, `sm:` variants) with inline styles
    / a scoped media query so the chart renders correctly in consuming apps.

### Patch Changes

- 0ad72a6: fix: pass full gantt config to renderer, render multi-value lookups in gantt tooltips, persist `bodyExtra` on dataSource actions, and complete zh/en gantt labels

  Four platform gaps that the EHR app previously worked around with `node_modules` patches:

  - **app-shell / ObjectView** — the `config.gantt → renderer props` adapter was a hardcoded 6-field whitelist, so `parentField`/`typeField` (and `baseline*`, `groupByField`, `resourceView`, `tooltipFields`, `quickFilters`, …) never reached the renderer and the chart degraded to a flat list. It now spreads the full `viewDef.gantt` first, then applies the three required defaults last (mirroring the gallery branch).
  - **plugin-gantt / ObjectGantt** — the tooltip value formatter only handled single-object lookups, so a multi-value lookup (a populated `[{name},{name}]` array) fell through to `'—'`. It now maps each array element to its display value and joins them.
  - **app-shell / useConsoleActionRuntime** — `bodyExtra` was merged only on the absolute-HTTP path; the generic `dataSource.update` path ignored it, so a pure-confirmation action (no params array) left an empty payload and persisted nothing. `bodyExtra` is now merged last on that path too, matching the documented semantics.
  - **i18n** — added the gantt labels the 9.x renderer references but the bundles lacked: `toolbar.thisWeek/thisMonth/exportPdf/saveLayout`, `viewMode.year`, `menu.add*/removeDependency/noCandidates`, the `linkType.*` and `conflict.*` blocks, and `readOnly*` — in both `en` (canonical key source) and `zh`.

- bd8b054: fix(currency): resolve the tenant default currency across the long-tail renderers

  Phase 2b of the currency-resolution work (ADR-0053). The cell/field renderers
  already funnelled through `resolveFieldCurrency` + `useLocalization` (#1856),
  but the rest of the renderers still hard-coded `USD` or read only one of
  `currency`/`defaultCurrency`. They now share the same resolution chain — explicit
  field currency -> `currencyConfig.defaultCurrency` -> legacy `defaultCurrency` ->
  tenant `localization.currency` -> plain number:

  - `plugin-dashboard` `ObjectMetricWidget` (inferred currency), `ObjectDataTable`
    (symbol-format fallback).
  - `plugin-grid` `useColumnSummary` (footer agrees with the cells) and
    `ObjectGrid` (compact amount + name-inferred currency cells).
  - `plugin-detail` `DetailView` summary metrics.
  - `plugin-gantt` `ObjectGantt` currency tooltips.
  - `components` `element:number` (`format: 'currency'`) — tenant default instead
    of a baked-in `USD`, and renders with the tenant locale.

  `resolveFieldCurrency` now lives in `@object-ui/i18n` (co-located with
  `useLocalization`, which supplies the tenant default); `@object-ui/fields`
  re-exports it, so the existing import path is unchanged. No behavior change when
  no tenant currency is configured — a field that declares its own currency, or a
  deployment with no `localization.currency`, renders exactly as before.

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

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3
- @object-ui/fields@6.2.3
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

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1
- @object-ui/fields@6.2.1
- @object-ui/plugin-detail@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/fields@6.2.0
- @object-ui/plugin-detail@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/fields@6.1.0
  - @object-ui/plugin-detail@6.1.0
  - @object-ui/react@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4
- @object-ui/fields@6.0.4
- @object-ui/plugin-detail@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3
- @object-ui/fields@6.0.3
- @object-ui/plugin-detail@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2
- @object-ui/fields@6.0.2
- @object-ui/plugin-detail@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1
- @object-ui/fields@6.0.1
- @object-ui/plugin-detail@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0
- @object-ui/fields@6.0.0
- @object-ui/plugin-detail@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2
- @object-ui/fields@5.4.2
- @object-ui/plugin-detail@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1
- @object-ui/fields@5.4.1
- @object-ui/plugin-detail@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/fields@5.4.0
  - @object-ui/plugin-detail@5.4.0
  - @object-ui/react@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2
- @object-ui/fields@5.3.2
- @object-ui/plugin-detail@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1
- @object-ui/fields@5.3.1
- @object-ui/plugin-detail@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0
- @object-ui/fields@5.3.0
- @object-ui/plugin-detail@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1
- @object-ui/fields@5.2.1
- @object-ui/plugin-detail@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [b2d1704]
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
  - @object-ui/react@5.2.0
  - @object-ui/plugin-detail@5.2.0
  - @object-ui/fields@5.2.0
  - @object-ui/components@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/fields@5.1.1
  - @object-ui/plugin-detail@5.1.1
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
- Updated dependencies [32306e8]
- Updated dependencies [5b80cfd]
- Updated dependencies [49b1760]
- Updated dependencies [a49f300]
- Updated dependencies [8fd863e]
- Updated dependencies [1cb6e21]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/plugin-detail@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0
  - @object-ui/fields@5.1.0

## 5.0.2

### Patch Changes

- cab6a93: **plugin-grid:** column summary footer now formats values using the
  column's type metadata. Currency columns render `Sum: $1,760,000.00`
  instead of bare `Sum: 1,760,000`; percent columns honor `0–1` vs
  `0–100` value ranges; avg uses two fraction digits. `useColumnSummary`
  accepts an optional `fieldMetadata` map (typically `objectSchema.fields`)
  so per-field `type`, `currency`, `defaultCurrency`, `precision` are
  respected.

  **plugin-gantt:** added safe-fallback `useGanttTranslation` hook. All
  hardcoded toolbar `aria-label`s and the `Task Name` / `Start` / `End` /
  `Today` column-header strings now flow through `t('gantt.*')`. A new
  `gantt.*` section is exported from the en/zh/ja/ko/de/fr/es/pt/ru/ar
  locales.

  **app-shell:** `ReportView` no longer hardcodes the `Edit` button label
  or the `Loading report…` fallback — they now use `common.edit` and
  `common.loading`.

  **i18n:** added top-level `gantt` section (with English fallbacks in
  non-en/zh locales) and the `common.addToFavorites` /
  `common.removeFromFavorites` keys across all ten built-in locales so
  the `builtInLocales` parity tests pass.

  - @object-ui/components@5.0.2
  - @object-ui/fields@5.0.2
  - @object-ui/react@5.0.2
  - @object-ui/plugin-detail@5.0.2
  - @object-ui/types@5.0.2
  - @object-ui/core@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1
- @object-ui/fields@5.0.1
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
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/fields@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- Updated dependencies [06a4066]
  - @object-ui/plugin-detail@4.8.0
  - @object-ui/types@4.8.0
  - @object-ui/core@4.8.0
  - @object-ui/react@4.8.0
  - @object-ui/components@4.8.0
  - @object-ui/fields@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0
- @object-ui/fields@4.7.0
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
  - @object-ui/react@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
- Updated dependencies [d714e85]
- Updated dependencies [6b6afd1]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/plugin-detail@4.5.0
  - @object-ui/fields@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/core@4.5.0
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
  - @object-ui/react@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [6b683c8]
- Updated dependencies [0d8eb98]
- Updated dependencies [b0bc410]
  - @object-ui/components@4.3.1
  - @object-ui/plugin-detail@4.3.1
  - @object-ui/fields@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/components@4.3.0
  - @object-ui/fields@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/plugin-detail@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1
- @object-ui/fields@4.2.1
- @object-ui/plugin-detail@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/components@4.2.0
- @object-ui/fields@4.2.0
- @object-ui/react@4.2.0
- @object-ui/plugin-detail@4.2.0
- @object-ui/types@4.2.0
- @object-ui/core@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0
- @object-ui/fields@4.1.0
- @object-ui/plugin-detail@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12
- @object-ui/fields@4.0.12
- @object-ui/plugin-detail@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/components@4.0.11
- @object-ui/fields@4.0.11
- @object-ui/react@4.0.11
- @object-ui/plugin-detail@4.0.11
- @object-ui/types@4.0.11
- @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10
- @object-ui/fields@4.0.10
- @object-ui/plugin-detail@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9
- @object-ui/fields@4.0.9
- @object-ui/plugin-detail@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/components@4.0.8
- @object-ui/fields@4.0.8
- @object-ui/react@4.0.8
- @object-ui/plugin-detail@4.0.8
- @object-ui/types@4.0.8
- @object-ui/core@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/fields@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- Updated dependencies [89ae109]
- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/fields@4.0.6
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
  - @object-ui/fields@4.0.5
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
  - @object-ui/fields@4.0.4
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
  - @object-ui/fields@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1
- @object-ui/fields@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/fields@4.0.0
  - @object-ui/react@4.0.0

## 3.4.0

### Patch Changes

- a2d7023: End-user feature batch — forms, designer history, import/export, and PWA offline sync.

  **Forms (`@object-ui/fields`, `@object-ui/providers`)**

  - `FileField`: native `<input capture="environment">` camera capture for mobile devices, plus a uploading-progress indicator driven by `UploadProvider`.
  - `ImageField`: per-image inline crop/rotate via the lazy-loaded `ImageCropperDialog` (canvas-based, zero new deps).
  - New `UploadProvider` in `@object-ui/providers` with pluggable adapters for S3 and Azure Blob (plus the default object-URL adapter for local previews). XHR-based with progress, abort, and retry.
  - `LookupField`: `lookup.dependsOn: string | string[]` to chain dependent lookups (e.g. State depends on Country); the trigger is gated until parent values are present and the OData `$filter` is built automatically.

  **Container-aware widget widths (`@object-ui/components`)**

  - New `useResizeObserver(ref)` hook exposing `{ width, height }` of any element. SSR-safe; reads the initial size via `getBoundingClientRect`.
  - `plugin-gantt` and `plugin-kanban` now react to their container size instead of `window.innerWidth`, so they behave correctly inside split panels and dashboards.

  **Designer history (`@object-ui/plugin-designer`)**

  - `useUndoRedo` (and therefore `useDesignerHistory`) gains `persistKey` + `storage` options to round-trip the undo/redo stack through `sessionStorage`, plus a `clearPersisted()` cleanup helper. Drafts now survive accidental tab refreshes.
  - New `<HistoryPanel>` component renders the timeline visually with one-click jump-to-checkpoint via the new `jumpTo(index)` API.

  **Import wizard (`@object-ui/plugin-grid`)**

  - Saved column-mapping templates: name, save, re-apply, and delete via a new template bar in the mapping step. Persisted under `objectui:import-templates:${objectName}` (override via `templateStorageKey` / `templateStorage`).
  - Inline validation correction: cells with errors in the preview step are now editable; corrections feed straight into the import without requiring a re-upload, with green-bar status indicators for fixed rows.

  **PWA offline sync (`@object-ui/mobile`)**

  - New `MemoryOfflineQueue` / `IndexedDbOfflineQueue` (`createOfflineQueue()` picks the best backend) backed by IndexedDB.
  - `createOfflineDataSource(inner, { queue })` wraps any DataSource so mutations issued while offline (or that fail with a network-style error) are queued and replayed in order on reconnect. Includes `replay()`, `drop()`, `clear()`, `pending()`, an `onChange` notifier, and an opt-in `resolveConflict` hook for stale-write conflicts.
  - New `useOfflineSync(source)` hook exposes `{ isOnline, pending, isReplaying, replay, drop, clear }` and auto-replays on the browser's `online` event.
  - `getServiceWorkerSource(opts)` emits a customisable Service Worker that pre-caches the app shell, applies network-first to API requests, and broadcasts `REPLAY_QUEUE` to clients on Background Sync. `requestBackgroundSync(tag)` registers a one-shot sync from the page.

- e93fe35: Mobile UX round 3 — Gantt and Map

  **@object-ui/plugin-gantt**

  - Added a sticky vertical "Today" marker on the timeline plus a one-tap **Jump to Today** toolbar button so on-call users can re-orient the view instantly on small screens.
  - Added a **collapsible task list** (toolbar toggle + auto-collapse on the first narrow render) so the timeline area gets the full viewport on phones.
  - Added **pinch-to-zoom** touch gestures on the timeline; wired `columnWidthOverride` state so the existing zoom buttons also respond (previously a no-op).

  **@object-ui/plugin-map**

  - Added a **geolocate button** with the standard `navigator.geolocation.getCurrentPosition` permission flow, an inline error banner, a busy state, and a **user-location marker** (blue dot) the map flies to on success.
  - **Cluster tap-through**: tapping a cluster now flies the map in (zoom + 2, capped at 20) instead of just sitting there.
  - On mobile, the desktop popup is replaced by a **bottom-sheet record card** with safe-area padding and an explicit close button. Desktop continues to use the popup.

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/fields@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/react@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2
- @object-ui/fields@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/fields@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/react@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0
- @object-ui/fields@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0
- @object-ui/fields@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/react@3.1.5
- @object-ui/components@3.1.5
- @object-ui/fields@3.1.5
- @object-ui/types@3.1.5
- @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4
- @object-ui/fields@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3
- @object-ui/fields@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2
- @object-ui/fields@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/fields@3.1.1
  - @object-ui/react@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3
- @object-ui/fields@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2
- @object-ui/fields@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
  - @object-ui/fields@3.0.1
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
  - @object-ui/fields@3.0.0

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
