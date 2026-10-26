# @object-ui/core

## 18.1.0

### Minor Changes

- 8e90779: An action's `confirmText`, `successMessage` and `errorMessage` read the `template` envelope and fill `{{ }}` holes (objectui#13367).
  
  `@objectstack/spec` is making these three keys `template` slots (objectstack#24814), so a parsed action serves `{ dialect: 'template', source }` where it served a string. Before this change the success toast skipped the envelope and showed the default text, and the error toast showed the generic failure. `ActionRunner` now reads a string or the envelope for all three, and fills `{{ path }}` / `{{ path | formatter }}` holes with `@objectstack/formula`'s `templateEngine`, the engine the flow notifications render with:
  
  - `confirmText`: `record` (the record the action runs against, the clicked row on a list) and `params` (the action's static params);
  - `successMessage`: `result` (the payload `${result.*}` reads) and `record`;
  - `errorMessage`: no hole is filled; the text shows as written.
  
  A sentence with no `{{ }}` hole keeps today's `${…}` reading, so the platform's own `${result.email}`-style success sentences still work until the spec converts them. A sentence is read in one dialect only: a value filled into a `{{ }}` hole is never read again as `${…}`. An envelope with no text never reaches the dialog or a toast as an object; a `confirmText` envelope with no text still asks for confirmation.
  
  `useActionTextLocalizer` keeps the envelope: it used to read it as a per-locale map and hand the runner the word `template`. A bundle entry replaces the envelope's `source`. On a flow action the console reads the envelope too, so the action's own success copy still outranks the flow's (`flowSuccessCopy`). `@object-ui/core` exports the reader it uses: `ActionCopyTemplate`, `isActionCopyEnvelope`, `actionCopySource`, `hasTemplateHoles` and `fillTemplateHoles`.
  
  Clause-②: yes
  Metadata-protocol: none

### Patch Changes

- 49a536d: The record header's highlights write the year on every date (objectui#13331).
  
  A current-year date dropped its year in the strip, so a contract record read "Start Date Sep 15, 2025 | End Date Sep 15" and a contract that ended this September looked like it ended next month. The strip now asks for the year, and both dates read alike. Dates inside the ±7-day window keep their relative phrase ("In 2 days").
  
  `formatDate` takes a new opt-in option, `alwaysShowYear`, which keeps the year on its default face; the `date` and `datetime` cell renderers take an `alwaysShowYear` prop that hands it on. Neither is on by default: grid cells and cards still drop the current year.
- 7f60e9d: A single-record action launched with 0 or several rows selected is refused before any dialog opens, and the refusal is translated (objectui#13384).
  
  `ActionRunner` now asks the handler it will dispatch to for an early refusal (`ActionRunnerHandler`'s optional `refuseBeforeInput`) before the confirmation and the param dialog. The handlers `createServerActionHandler` builds answer it with the row-count check the dispatch already runs, so "select a row first" and "select exactly one row" are shown before the user fills anything in, and nothing is sent. With exactly one row the dialog behaves as before. A host that wraps the built handler in its own function keeps the early refusal only by forwarding `refuseBeforeInput`; the console's `createConsoleServerActionHandler` now forwards it, so on a list page (HotCRM's "Add to Campaign" on My Leads) the refusal toast shows and no dialog opens.
  
  Both refusals now carry a pack key (`actions.selectRowFirst`, `actions.selectExactlyOneRow`, defined in every shipped pack). `resolveServerActionRecordId` returns it as `errorKey` beside the English `error`, and the runner's early refusal goes through its translator by that key.
- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [f1a4b08]
- Updated dependencies [1d178e0]
- Updated dependencies [6fb31dc]
  - @object-ui/types@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- c4c506b: **Clause-②: yes (narrowing)**
  
  One declaration of the per-type NODE SLOTS — the keys other than `children` through which a renderer hands authored nodes back to `SchemaRenderer` — and three readers that walk it instead of stopping at `children` (objectui#11170, the follow-up PR #11126's Acceptance notes filed).
  
  New on `@object-ui/types`, beside `BaseSchema.children`: `NODE_SLOT_DECLARATIONS` (one row per renderer, under every registry spelling that resolves to it), `nodeSlotsFor(type)`, `nodeSlotPathSegments(path)` and `nodeSlotValues(node, path)`, with the types `NodeSlotDeclaration`, `NodeSlotRow`, `NodeSlotSegment` and `NodeSlotValue`. A position is spelled as a key path — `trigger`, `items[].content`, `regions[].components`, `items[]`, `report.sections[].content` — and the value at its end is one node or a list of nodes. The `page:*` rows are `@objectstack/spec`'s `pageComponentSlotPositions()` placed on the type whose renderer reads each position, pinned against that export in both directions; every other row is objectui's own, pinned against the live renderer. `body` stays retired as the generic child-list key (objectui#6771): it appears only on the four `page:*` types whose renderer still paints it for stored documents, marked `retired`.
  
  Accept sets that narrow, each reader FROM → TO:
  
  - `@object-ui/cli` — `objectui check`'s unevaluated-expression refusal (`findUnbindableTextExpressions`). FROM: the document root and every node its `children` hold. TO: those, and every node under a slot its type declares — so a `${…}` on `title` / `label` / `value` / `description` of a node under a dialog's `content`, a tab item's `content`, a page's `regions[].components`, a carousel item, a detail view's `tabs[].content` is now refused with the slot path (`items → 0 → content → value`). The false-refusal rows of PR #11126's ablation 2 stay green: a form's `fields[]`, a grid's `columns[]` and `{ "type": "multiple" }` are not slots. Measured over this repository's own JSON corpus and docs fences: no new finding.
  - `@object-ui/core` — `validateSchema`. FROM: `validateChildren` recursed through `children` only. TO: it also recurses through the declared slots, so an invalid node under one (a retired `crud` spelling under `dialog.content`, an `INVALID_SCHEMA` member) is reported with its own path, spelled as `schema.items[0].content`. Measured over the same corpus: no new finding.
  - `@object-ui/sdui-parser` — `validateTree`. FROM: the walk descended `children` alone, and a manifest entry carried no slot. TO: `ManifestComponent` gains `slots?: readonly string[]`, `manifestFromConfigs` gains `opts.slotsFor` (hand it `nodeSlotsFor`) and projects each entry's non-retired positions, and `validateTree` descends them — an unknown component, an unknown or mis-typed prop or an illegal enum under a slot now draws its diagnostic. A manifest built without the option serialises byte-identically and keeps the `children`-only reach. The `RETIRED_CHILD_LIST_KEY` refusals are unchanged.
  - `@object-ui/components` — the `kind:'html'` page's compile manifest (`getJsxManifest`) is built with `slotsFor`, so an html-tier page whose slot-held node fails validation now fails to compile the way one under `children` does. Narrowing: a page that compiled with an unknown tag under a `dialog`'s `content` no longer does.
  
  Docs: `content/docs/utilities/cli.mdx`'s "Component nodes only" rule, the gate's own docblock, `validateChildren`'s comment and the parser's header now say the walk follows `children` and the declared slots; the declaration's header is where the slot list is explained.
- 96fcf30: **Clause-②: yes (an export widens, and an accept set narrows)**
  
  A chart's value axis over a count now draws whole-number ticks (objectui#11681). Dashboard charts over a `count` measure ("Tasks by Status", "Projects by Health", "Invoices by Month") used to read 0.5, 0.8, 1.5 or 2.3 on their value axis. The dataset answer states each measure column's aggregate (`fields[].aggregate`, from `@objectstack/spec` 18). The chart now carries it to the axis, and an axis whose series all plot `count` or `count_distinct` sets `allowDecimals: false`. Any other measure on the axis keeps the previous ticks, so a sum over currency keeps its decimals. Every cartesian value axis is covered, including the horizontal-bar value axis that runs across the plot. Each side of a dual-axis chart decides for itself.
  
  - `@object-ui/core` (widens): `buildChartSeries` copies a result field's `aggregate` onto the series it derives. `ChartResultField` and `ChartSeriesBinding` gain an optional `aggregate`. `INTEGER_AGGREGATES` and `isIntegerAggregate` are new exports.
  - `@object-ui/plugin-dashboard`: the dataset widget keeps the aggregate on the series it builds. That includes the comparison overlay and the series a dimensionless chart transposes, which states an aggregate only when every measure shares it.
  - `@object-ui/plugin-charts` (widens): the `dataKey` arm of `ChartRendererProps.schema.series` and `NormalizedSeries` (carried by the exported `NormalizedChartSchema`) gain an optional `aggregate`, read by `normalizeSeries`. The accept set only widens: nothing that compiled before is refused. The member is renderer-internal.
  - `@object-ui/types` (narrows): `aggregate` on a chart series is refused by name. FROM: `ChartDataSeriesSchema` (and so `ChartSchema.series[]`) accepted `{ name, aggregate: 'count' }` and stripped the key. TO: it refuses that series with an `invalid_type` issue at `aggregate`, and `ChartDataSeries.aggregate` is typed `?: never`. The key is internal: declare the aggregate on the dataset measure instead.
- d50f724: Dates and times render in the time zone the server answers for the signed-in workspace (objectui#11693).
  
  `GET /api/v1/auth/me/localization` answers `timezone` beside `currency` and `locale`, and the console kept only the other two. It now carries all three, and every date and datetime face built on the shared date-display functions of `@object-ui/core` (field cells, grid and card dates, gantt tooltips, dataset measures, data-table cells) renders an instant in that zone. A date-only value still names the day it stores, whatever the zone. With no zone, every face renders in the viewer's own zone, as before.
  
  The zone is whatever the endpoint answers. A server that answers a zone for a workspace that configured none (objectstack's localization cascade answers `UTC` in that case) moves that workspace's datetimes into that zone.
  
  - **`@object-ui/core`**: `setDisplayTimeZone(timeZone)`, `getDisplayTimeZone()` and `subscribeDisplayTimeZone(listener)` declare and read the zone the date faces render instants in. An IANA name the runtime's `Intl` does not know clears it, with a console warning, instead of making every face throw.
  - **`@object-ui/i18n`**: `LocalizationValue` gains `timezone`. `LocalizationProvider` hands it to the date faces, and `useLocalization().timezone` reads back the zone they render in.
  - Renderers that format dates with their own `Intl` options rather than through the shared functions do not take the zone yet.
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
- f34e877: New `isDeadlineSettled(field, row, { scope, fields })` (objectui#11815). It answers whether a declared deadline is settled for one row: `true` only when the field declares `dueLike: true` and a `settledWhen` predicate that holds for the row, evaluated with `evalRowPredicate` (the row bound as `record`). A field that is not a declared deadline, a field with no `settledWhen`, and a predicate that fails to evaluate all answer `false`. Every view that draws a date cell beside a record uses it to set the cell's `deadlineSettled`.
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
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
- 158c75d: The record feed and a related list's Add existing and fallback remove read the
  affordance-to-grant map, so a caller without the grant is no longer offered a
  write the server then refuses (objectui#12082, leg B of the write-census
  backlog).
  
  - **Four rows join `AFFORDANCE_GRANTS`** (`@object-ui/core`, a published value,
    hence `minor`), each asked of the object the write goes to: `feedComment` (the
    create grant on `sys_comment`), `feedReactionAdd` and `feedReactionRemove`
    (the create and delete grants on `sys_comment_reaction`, the caller's own
    reaction row) and `feedReactionColumn` (the update grant on `sys_comment`,
    for a deployment that stores reactions in a column).
  - **The record feed** (`@object-ui/app-shell`'s record page) hands its comment
    composer, its reply input and its reaction control their handlers only where
    the row allows the write; the panel draws each from its handler, so a closed
    row withholds it. The platform's `everyone` baseline grants neither object;
    an application does, so a member whose sets do not was offered a composer
    whose post the server refused. On the reaction store, taking a reaction back
    asks the delete grant: without it the click writes nothing.
  - **A related list's Add existing** (`@object-ui/plugin-detail`) reads the row
    of the write it ends in: with a `linkField`, a link row of the list's own
    object (`relatedNew`, the create grant there); without one, a re-parent of the
    picked record (`relatedRowEdit`, the update grant on `add.picker.object`). A
    closed row withholds the button and its dialog.
  - **The `record:related_list` fallback remove** (an `add` config with no host
    delete) reads the list object's `relatedRowDelete` row with the object's
    registered schema. On a record page the host withholds its delete exactly when
    that row is closed, and the fallback used to put the delete back.
  
  With no permission provider mounted every one of these reads open, as before.
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
- 5f75cfa: In-place edit on the record page and a list's in-cell edit honour the caller's field write grant, and the owner field honours the transfer grant (objectui#12103).
  
  **What a caller saw.** A caller whose permission set marks a field `{ readable: true, editable: false }` was offered an editor for it in the record page's details body, in its highlights strip and in a list's grid cells, and Save answered 403 ("Field write denied"). The owner field was offered the same way to a caller without the transfer grant, and Save answered 403 ("requires the transfer grant"). Edit forms already refused both fields through `fieldWriteGate`.
  
  **What changed.**
  
  - **The map (`@object-ui/core`).** The `recordEdit` and `listInlineEdit` rows of `AFFORDANCE_GRANTS` gain `field: 'write'`, so the record page's in-place edit and a list's in-cell edit each ask every field the same update question an edit form asks, through `resolveFieldAffordance`. `FieldAffordance` therefore includes both rows.
  - **The details body and the highlights strip (`@object-ui/plugin-detail`).** `DetailSection` and `HeaderHighlight` ask that question of each field. A refused field shows no pencil, does not enter the edit session on double-click, and stays a read display in edit mode. The strip and the body share one session and one Save, so they answer alike.
  - **The grid (`@object-ui/plugin-grid`).** `ObjectGrid` marks a refused field's column not editable, so its cell keeps the read display while the rest of the row edits. Whether the grid is editable at all is still the object-level `listInlineEdit` verdict.
  - **The owner field (`@object-ui/permissions`).** The server refuses an update that writes the record's owner (the field the `@objectstack/spec` constant `SystemFieldName` names `OWNER_ID`) unless the caller holds `allowTransfer` or `modifyAllRecords`. `MePermissionsProvider`'s `checkField(object, owner, 'write')` now answers with that grant, read with the spec's `objectPermissionGrants`. The `write` question is the server's update rule for a field, so every surface that asks it (edit forms, in-place edit, in-cell edit) offers the owner field only to a caller who may transfer the record. `checkField(object, owner, 'create')` is unchanged, because on insert the server stamps an empty owner to the caller and accepts the caller's own id. `MePermissionsResponse` declares the `allowTransfer` bit the endpoint already serves, and `@object-ui/permissions` now depends on `@objectstack/spec` directly.
  
  **Unchanged.** With no permission provider mounted no field question is asked, so a standalone embed and the designer preview behave as before. The server still enforces every grant; this only stops the console from offering a write it would refuse.
  
  **Clause-②: yes (widening).** `AFFORDANCE_GRANTS.recordEdit` and `AFFORDANCE_GRANTS.listInlineEdit` gain a `field: 'write'` member, which widens the `FieldAffordance` type by those two rows. `MePermissionsResponse`'s object entry declares an optional `allowTransfer?: boolean`. `checkField`'s action union is unchanged; its `write` answer narrows for the owner field only. No export, prop or language-pack key is added or removed.
- 334f0cf: A `type: 'url'` action or an `element:button` whose target is `mailto:` now opens the mail client, where it used to fail at click (objectui#12191, the objectui half of ruling A+; the spec half is objectstack-ai/objectstack#23010).
  
  The spec accepts a `mailto:` url target, and app-shell's entitlement CTA already opened one. The action runner refused every scheme but `http(s)` and relative paths, so a mail button published cleanly and then answered "Invalid URL scheme" at click.
  
  - **One answer, two callers.** `@object-ui/core` exports `classifyNavigationTarget(url)` and its `NavigationTargetKind` type. It returns `'web'` (`http://`, `https://`), `'mail'` (`mailto:`), `'path'` (an in-app path, `/…` or `./…`) or `null` (refused). The action runner and app-shell's `resolveCtaHref` both read it, and neither keeps a scheme list of its own. Scheme names compare case-insensitively.
  - **`mailto:` navigates in place.** On a `type: 'url'` action, its `navigation` alias and `onSuccess.navigate`, a `mailto:` target sets `window.location.href`. It never opens a new tab, so `openIn` is not consulted. It never goes to the host's navigation handler either: the console's handler would open it in a new tab or route it as a path.
  - **The admitted set is closed.** `javascript:`, `data:`, `tel:` and every other scheme stay refused. A protocol-relative `//host` is now refused too; the runner used to hand it to the navigation handler as an in-app path. So are the two spellings a browser reads as `//host`: a backslash right after the first slash, and a target holding a tab, line feed or carriage return.
  - **The refusal names the set.** The runner's error now reads "Invalid URL scheme. Only http://, https://, mailto: and in-app relative paths (/path, ./path) are allowed." The `onSuccess.navigate` warning carries the same sentence.
  - **Upper-case schemes.** The runner now admits `HTTP://…` and `HTTPS://…` as external URLs and `MAILTO:…` as a mail target; it used to refuse them.
  - **app-shell.** `resolveCtaHref` answers as before for `http(s)` URLs, `mailto:` and relative paths, and now also passes a `MAILTO:` URL through as-is. A target the shared answer refuses still takes the control-plane-relative branch, as before.
- 7af0ab3: The author of a comment on a record page can now edit and delete it from the record feed (objectui#12268).
  
  `sys_comment` declares the generic Edit and Delete affordances (`managedBy: 'platform'`), and the platform lets an author update and delete their own comment, but the record feed only offered reactions and replies. Now the author's own comment and reply show Edit and Delete. Nobody else sees either control on it.
  
  - **Edit** opens the comment's text in place. Save stores the new text and marks the comment edited; the row then shows the new text with the usual "(edited)" mark. If the server refuses, an error appears, the editor keeps the draft, and the comment keeps its previous text. A comment stored as edited reads as edited.
  - **Delete** asks first, through the console's usual destructive confirm dialog. Cancel deletes nothing. If the server refuses, an error appears and the comment stays.
  - **Replies outlive their comment on screen.** A reply whose comment the feed does not hold, because that comment was deleted or lies before the loaded page, now shows as a row of its own instead of disappearing, so deleting a comment no longer hides anyone's replies to it.
  - Each control appears only with the matching permission on `sys_comment` (update for Edit, delete for Delete). The server's own rule still decides every write.
  
  Published surface, all additive:
  
  - `@object-ui/collaboration`: new export `isCommentAuthor(authorId, viewerId)`, the owner rule `CommentThread` gates Edit and Delete on. Two missing or empty ids no longer count as a match.
  - `@object-ui/types`: `FeedItem.authoredByViewer?: boolean`, set by the host that read the row.
  - `@object-ui/react`: `DiscussionContextValue.onEditComment` and `onDeleteComment`.
  - `@object-ui/plugin-detail`: `onEditComment` and `onDeleteComment` on `RecordActivityTimelineProps`, `RecordChatterPanelProps` and `ThreadedRepliesProps`. A reply now shows the "(edited)" mark too.
  - `@object-ui/core`: two rows in the affordance-to-grant map, `feedCommentEdit` and `feedCommentDelete`.
  - `@object-ui/i18n`: five new `detail.*` keys in all ten language packs (`editComment`, `deleteComment`, `deleteCommentConfirm`, `commentEditFailed`, `commentDeleteFailed`).
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
- 025130c: A row action's templates read the row as `record`, the way the record header's do (objectui#12967).
  
  The same action's `confirmText` with `${record.display_name}` read filled from a record header and as template source from a list row: the header binds `record` in the action runner's context, while a row surface (a grid row, a related-list row, `DeclaredActionsBar`, a page header, `action:button`'s update write) stashes the row under `params._rowRecord` and binds nothing. The runner now binds a dispatch's `_rowRecord` as `record` for that dispatch's templates, the row winning over a page-level `record`. A hole naming a field the record does not carry prints empty on both doors, as it always has on the header.
  
  The param dialog's `description` and each param's `helpText` are filled in the same scope, on both doors. Before, neither door filled them. The runner hands the param-collection handler an `interpolate` function; the console's two handlers apply it to the localized description (never to the admin-override notice, whose approver names are data) and pass it to `ActionParamDialog`, which applies it to the `helpText` the user reads, after an inline per-locale map is picked.
  
  A toast's `${result.*}` is unchanged. No action key is added.
  
  **Clause-②: yes (widening).** The exported `ParamCollectionHandler` type in `@object-ui/core` gains an optional third parameter, `interpolate?: (text: string) => string`. A handler that ignores it reads exactly as before. `ActionParamDialog`'s state type gains one optional member, `interpolate`; that type is not in `@object-ui/app-shell`'s barrel.
- 2493e85: A page predicate can ask the capability question: `current_user.hasCapability('NAME')` now answers in the console, from the same `/auth/me/permissions` answer the action gate reads (objectui#13006, the objectui half of objectstack#24414).
  
  - **`@object-ui/core`** carries the subject's held system capabilities to the formula engine the way it already carries the object-permission map for `current_user.can(object, verb)`. New `bindSubjectCapabilities` / `subjectCapabilitiesOf` sit beside `bindSubjectPermissions` / `subjectPermissionsOf`, under a symbol key (`SUBJECT_CAPABILITIES`), and `evalFieldPredicate` passes the list as `EvalContext.systemPermissions`. The list is not a CEL root and not a readable member of `current_user`.
  - **`@object-ui/app-shell`**'s `ExpressionProvider` binds that list from `usePermissions().systemPermissions` once the payload has loaded. Until then nothing is bound and the call faults, the same as `can()` does: it is never defaulted to `[]`. An empty list is a real answer and evaluates to `false`. The list is bound only together with the object-permission map from the same answer, so both change at the same time.
  - Actions' `visible`, the action capability gate (`requiredPermissions`) and every other existing gate are unchanged.
- 9f1dd79: A `type: 'form'` action placed at `record_related` and fired from a related-list row now opens the clicked row's edit form (`/forms/NAME?recordId=ROW_ID&recordObject=CHILD`), as it does from the child's own record page, instead of a blank create form (objectui#13063). The related-list bridge hands the row to the dispatch as its execution context (`record` + the child's `objectName`); `ActionRunner.execute` takes that per-call context as an optional second argument and leaves the runner's own context untouched.
  
  `@object-ui/core` widens one published method: `ActionRunner.execute(action, callContext?)`. `callContext` is optional, so every existing caller is unchanged.
- 616df65: An action's param dialog keeps what the user typed when the server refuses the run (objectui#13161).
  
  The console's param dialog resolved its values and closed on Confirm, before the action ran, so a refusal ("User already exists. Use another email.", an invalid redirect URL) landed on a dialog that no longer existed: only the error toast remained, and the user typed everything again. The dialog now stays open and busy until the run settles. A success closes it, and the runner toasts as before. A refusal leaves it open with every value as typed and the refusal shown above the buttons, so the user can fix the input and confirm again, or cancel. While the run is in flight, Confirm and Cancel are disabled and the dialog does not close. Cancel after a refusal closes the dialog and runs nothing more.
  
  The refusal is shown as the form's, never on a field: the run's result carries it as text only, and the dialog does not guess a field from the sentence. The runner still toasts it.
  
  The runner hands the param-collection handler a `run` function: called with the collected values, it dispatches the action and resolves with that run's result. A refused run gets its post-execution (error toast, `onFailure`) at once; a successful run's post-execution waits until the handler settles, so the dialog is closed before the success toast or a result dialog shows. A call made while a run is in flight returns that run and dispatches nothing new. A handler that never calls `run` keeps the old contract: one dispatch with the values it resolves. The console's two param handlers, `useConsoleActionRuntime`'s and `RecordDetailView`'s, forward it to `ActionParamDialog`. The type-level actions of a metadata type (`MetadataTypeActions`) run without the runner and keep the old close-on-Confirm behavior.
  
  **Clause-②: yes (widening).** The exported `ParamCollectionHandler` type in `@object-ui/core` gains an optional fourth parameter, `run?: (values: Record<string, any>) => Promise<ActionResult>`. A handler that ignores it reads exactly as before. `ActionParamDialog`'s state type gains one optional member, `run`; that type is not in `@object-ui/app-shell`'s barrel.
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
- d328698: `ActionContext`, `ActionResult`, `UndoableOperation` and `ComponentMeta` are re-exported from `@object-ui/types` instead of declared a second time here (objectui#6349, batch 4), so an import of any of these names from either package is the same type. The registry's own registration type gets its own name, `RegistryComponentMeta`.
  
  **Type changes, breaking for some consumers.**
  
  - **`ComponentMeta` from this package no longer carries the five registry-only keys** (`tier`, `namespace`, `skipFallback`, `labelling`, `deprecated`). It used to be this package's registration type, `@object-ui/types`' `ComponentMeta` plus those keys, published under the general name. That type is now `RegistryComponentMeta`, with the same members. `ComponentRegistry.register`, `registerLazy` and `getMeta` are typed with it, so a registration literal passed straight to them still compiles. Code that annotates a value as `ComponentMeta` from `@object-ui/core` and writes or reads one of the five keys must use `RegistryComponentMeta` instead (for example `RegistryComponentMeta['labelling']`).
  - `ActionContext`: the runner's copy typed `record` and `user` as `any`; the one declaration types both as `Record<string, any>`. A non-object `record` or `user` on a value typed `ActionContext` no longer type-checks, and under `strict` a read such as `context.record.id` now needs optional chaining (`context.record?.id`). `data`, `selectedRecords`, `pageVariables` and the index signature are unchanged.
  - `ActionResult` and `UndoableOperation` keep their members exactly; only their declaring package moves.
  
  No runtime behaviour changes.
- 78b07f4: The object-page special cases for the retired permission-set catalog object are removed (objectui#7611, after objectstack's ADR-0131 stage 8 retired `sys_position`, `sys_permission_set`, `sys_position_permission_set` and `sys_capability`). A permission set is edited on its Setup metadata page, which reads the registry; none of the removed code ran anywhere else.
  
  **Breaking (narrowing; scored `minor` per the fixed group's version policy).** Each removal below shrinks a published face:
  
  - **`@object-ui/core`: `recordDelete.confirmText`.** FROM `recordDelete.confirmText({ objectName, t }, record)` TO `recordDelete.confirmText({ t })`. A package-owned `sys_permission_set` row no longer gets the reset question or the "reset" toast: every record gets the delete question and the delete toast. Fix: drop `objectName` and the second argument.
  - **`@object-ui/i18n`: pack keys.** FROM `perm.facet.*` (`none`, `more`, `objects`, `fields`, `rls`, `tabs` with their plural slots, `adminScope`, `designInStudio`, `designInStudioHint`) and `objectActions.resetPackageSetConfirm` / `objectActions.resetPackageSetSuccess` in all ten packs TO absent. Fix: a consumer that still asks for one keeps its own copy (inline `defaultValue` or its own bundle).
  - **`@object-ui/plugin-detail`: the `field:permission-facet-link` registry key.** FROM a registered field widget (the read-only facet summary with a "Design in Studio" link, also special-cased in the detail section and inline edit) TO unregistered. A field still carrying `widget: 'permission-facet-link'` renders with its declared type, like any unregistered widget. Fix: drop the `widget` hint, or register an own widget under that key.
  - **`@object-ui/cli`: `objectui check`'s known schema types.** FROM `field:permission-facet-link` known TO unknown, so `objectui check` reports a node of that type. Fix: as above.
  
  **Behaviour changes, not narrowings:**
  
  - **`@object-ui/data-objectstack`:** `getObjectSchema` no longer stamps `widget: 'permission-facet-link'` onto the six `sys_permission_set` facet fields (that object is no longer served).
  - **`@object-ui/app-shell`:** the `sys_permission_set` record page no longer appends the assigned-users panel. The panel itself, `AssignedUsersSection`, stays on the permission-set metadata page.
  - **`@object-ui/app-shell`: a permission set created from the Setup catalog is created live.** "New" on the permission-set page used to save a draft, while the set's editor edits the live set and reads no draft: the editor opened an empty set without the label, its Save wrote the grants live, and the draft stayed pending, so publishing it from Home replaced the grants with the empty create body. Outside a package binding the create now writes live (with the same first-write pin); under `?package=` it stays a package draft.
  
  **Widenings:**
  
  - **`@object-ui/core`:** the data source `recordDelete.run` is injected with needs only `delete` (it no longer calls `findOne`).
  - **`@object-ui/app-shell`:** the metadata-resource registry entry gains an optional `createLive`, which a type sets when its edit page writes the live item.
  
  Internal, not reachable from a published entry: the `PermissionFacetLink` component (never exported from `@object-ui/plugin-detail`), `RecordPermissionAssignmentsRenderer` (never exported from `@object-ui/app-shell`), and `ObjectStackAdapter`'s private `applyFieldWidgetOverrides`.

### Patch Changes

- e6dcd85: An authored `view:calendar` or `view:timeline` node loads its plugin and renders the calendar or the timeline, and a console boot no longer logs the registry's race warning for those two keys (objectui#11680).
  
  The console declares both views as lazy stubs, then registers a protocol placeholder for each protocol key nothing renders yet. The placeholder registrar asked the registry about loaded components only, so it read the two stubbed keys as free and took them, and the registry cleared the stubs under them. Until some other node happened to load the calendar or the timeline chunk, an authored `view:calendar` or `view:timeline` drew the dashed "Component Placeholder" box instead of the view. `registerPlaceholders()` and the eager palette placeholders now skip a key a pending lazy stub holds (`ComponentRegistry.hasLazy`). The key stays with the plugin that declared it, and `SchemaRenderer` loads that plugin the first time the node renders. A protocol key that nothing declares still gets its placeholder.
  
  The registry's collision warnings now name a stub by the full type it declared. A stub found under its own namespaced key was named with its namespace written twice (`view:view:calendar`), and `register`, `registerLazy` and `unregister` compared ownership against that doubled spelling.
  
  **Clause-②: no.** No export is added or removed, and no accepted input changes. The placeholder registrar is not exported, and the field the registry now records on a lazy stub lives on a type the package does not export.
- c0862c1: The action key inventory lists `requiresMembershipReach`, the key `@objectstack/spec` 17.7.0 adds to `ActionSchema` (objectui#11717), so an action carrying it is no longer reported as having an unknown key. The spec's parse lowers it into `visible`; the action runner does not read it.
- d99b731: Approval requests can now be read by the standard list and record views, and `ApiDataSource.findOne` now rejects a refused or failed read instead of reporting the record as missing (objectui#12032, A1 of objectui#2763).
  
  - **`ApiDataSource.findOne` resolves `null` only on a 404.** Every other failure (a 403, a 5xx, a transport error) now rejects, the way `ObjectStackAdapter.findOne` does. Before, any failure resolved `null`, so a record page over a `provider: 'api'` source showed a refused or failed read as "Record not found". It now shows "no access", or "could not load" with Retry (the record page states from objectui#11902).
  - **A console data source for approval requests.** `apps/console/src/services/approvalRequestsDataSource.ts` routes reads of `sys_approval_request` to the approvals routes through `ApiDataSource`, and everything else to the console's own adapter. Each source serves one server-side scope: awaiting me, submitted by me, or all. Rows come back as the approvals service serves them, so `viewer` and (on a single read) `decision_progress` are fields a view can bind. On a list read, `$top`, `$skip` and `$search` become the route's `limit`, `offset` and `q`, and `$select` is dropped. Every other parameter, such as a filter, a sort or an expansion, is refused with an `UNSUPPORTED_QUERY_PARAM` error, so the list shows its error panel and never shows unfiltered rows. Nothing mounts the source yet; the approvals list and detail pages that will use it come later.
  
  Nothing is added to any package entry: no export, prop, type member or language-pack key.
  
  **Superseded in part (objectui#12045):** the console now mounts this source on the `sys_approval_request` record route, so the sentence above saying nothing mounts it no longer holds when both changes release together.
  
  **Superseded again (objectui#12045, the page-mount step):** the console no longer declares a record route of its own for `sys_approval_request`. On every surface that opens a request, the console-wide `ApprovalRecordReads` layer sends the request's single read to `GET /approvals/requests/:id` and one request's timeline to `GET /approvals/requests/:id/actions`; lists of requests, and every other read, stay on the console's adapter, the data API.
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
- d75f212: Published text no longer teaches the retired view-level `provider: 'api'` data source (objectui#12364). A view binds `provider: 'object'` or `provider: 'value'`; a metadata-declared API call is the page element's `dataSource` binding. Text only: no schema accepts or refuses anything new, and no renderer behaves differently.
  
  - **`@object-ui/types`:** the `object-tree` `data` description drops the `api` provider from the providers it names.
  - **`@object-ui/plugin-grid` / `@object-ui/plugin-map`:** the `data` input descriptions drop the `api` provider.
  - **`@object-ui/plugin-calendar` / `@object-ui/plugin-gantt` / `@object-ui/plugin-map`:** the error thrown when no `DataSource` is available now reads `DataSource required for the object provider` (was `DataSource required for object/api providers`). It fires in exactly the same conditions as before.
  - **`@object-ui/react` / `@object-ui/auth`:** the README and docblocks describe `SchemaRendererProvider`'s `apiFetch` as what it is now: the host's authenticated fetch the renderers use for their own reads of the host's API (chart metadata, dataset dimension labels, record-permission probes). It is not a channel for a view's data source.
  - **`@object-ui/app-shell`:** comment wording only in `ConsoleShell`, `useConsoleActionRuntime` and `ObjectView` (these comments ship in the built JS): no behaviour change.
  - **`@object-ui/core`:** docblock wording only on `normalizeListViewSchema` and `resolveRecordSourceObjectName` (these ship in `dist/*.d.ts` and the built JS): no behaviour change.
- 260ef71: Clause-②: no
  
  **A navigation no longer claims a success (objectui#12755).** A `type: 'url'` action, its `navigation` alias and a `type: 'form'` action only change the route, yet each raised the generic success toast ("Action completed successfully" / 「操作已成功完成」) after it navigated, so a button that merely opened a page read as a completed operation. `ActionRunner` now marks such a result `silent` (it keeps `success: true`), so it announces nothing unless the action declares its own `successMessage`, which still shows. Actions that write (api, script, field update, flow) keep their success toast.
- fb501bc: An `operation: 'update'` action no longer posts its declared `patch` as request `params` (objectui#12941). The platform action route applies the patch itself, from the action definition it resolves by name, so the request carries only the values collected for the action's declared `params`, plus the record id.
  
  Before, `ActionRunner` merged the `patch` keys into the `params` it handed the registered `script` dispatch, so every declarative-update button sent field values its action never declared as params. The route wrote the same values either way, but a route that refuses undeclared params (ADR-0104 D2, objectstack#24268) answered every such button with a 400. The runtime half of that refusal waits on this change.
  
  - **What a button writes is unchanged.** The route still writes the declared `patch` under the collected values, and a collected value of the same name still wins.
  - **Undo is unchanged.** An `undoable` update still captures the prior value of every field the route writes, the `patch` fields included, because the runner reads them off the action, not off the request.
  - **A custom `script` dispatch** registered on the runner is now handed an update action whose `params` hold the collected values alone. The action's `patch` is still on the definition it receives.
  
  No key is added, removed or renamed, and no accepted input changes.
- 61ed5ad: The Undo of an `operation: 'update'` action covers the `patch` of the declared action its `name` names, and no action renderer forwards a page action row's own `patch` (objectui#13022, following `@objectstack/spec` 18 retiring that row key, objectstack#24442).
  
  A page action row (`action:button`, `action:icon`, an `action:group` / `action:menu` member) with `operation: 'update'` runs the declared action its `name` names. The platform action route resolves that declaration by name and writes its `patch` under the collected params. The row's own `patch` reached no request since objectui#12941, and the runner read it only for the Undo snapshot, so the snapshot covered the wrong fields. A row with no `patch` of its own snapshotted the collected params alone, not the fields the route wrote.
  
  - **Undo restores the fields the route writes.** `ActionRunner` reads the `patch` of the declaration the action's `name` names from the `objectActions` its host publishes beside `objectName`, plus the collected params. A declaration with no `patch` keeps the params-only snapshot. A written field the row does not carry still offers no Undo.
  - **The console publishes the declarations.** `useConsoleActionRuntime` and the record page publish the object's `actions` as `objectActions` in the runner context, beside `objectFields`.
  - **A host that publishes none** is unchanged for an action it dispatches whole (a grid row, a declared-actions bar, a related-list row): the runner reads that def's own `patch`, which is the declaration's.
  - **`action:button`, `action:icon`, `action:group` and `action:menu` no longer forward `patch`.** The request body is unchanged: it carries the collected params alone, as since objectui#12941.
  
  The `patch` input `action:button` and `action:icon` publish is unchanged here. It follows the spec pin.
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
- 088e0f7: A record-form field can name one item of a metadata registry by its machine name: a `text` field that declares `widget: 'position-ref'` lists the position registry, and one that declares `widget: 'permission-ref'` lists the permission-set registry. It stores the name only (objectui#7611, ruling B2 on objectstack#22865). This is the mechanism the metadata forms' `ref-multi:permission` picker brought in (objectui#12126), now reachable from an ObjectQL object field. A grant table's name field (`sys_user_position`'s position, `sys_user_permission_set.permission_set`) can now offer the declared items instead of a box for a typed name.
  
  - **The widget (`@object-ui/fields`).** `field:position-ref` and `field:permission-ref`, one key per registry type, with the type in the key, as `object-ref` carries `object`. Like every `widget` value, the name is looked up as `field:<widget>`. Each item reads as its label beside its name, and a pick writes the name: no label, no id. A stored name the loaded registry does not list stays on screen as its own option, flagged *not found*. The four catalog arms follow the metadata forms' `ref:dataset` / `ref-multi:<type>` pickers. With no data source that can list a registry, the field is a text box for the typed name. While the list loads, the stored name sits in a disabled box. When the load fails, a notice names the failure and its cause, and the text box stays enabled. A loaded but empty registry gives the same text box. Neither key is a declarable field type: both are widget hints, like `object-ref`.
  - **The catalog (`@object-ui/types`, `@object-ui/data-objectstack`).** `DataSource` gains an optional `listMetadataItems(type)`, answering `{ name, label }` headers for one registry type. An empty array is authoritative ("this registry has no item of this type"), so a failed load must reject, never resolve `[]`. `ObjectStackAdapter` implements it over `GET /api/v1/meta/:type` (the client's `meta.getItems`). It rejects with the transport's error, and refuses an answer that carries no `items` list. It is uncached, so an item authored in Studio shows on the next form.
  - **Locale keys (`@object-ui/i18n`).** `fields.registryRef.loadFailed` and `fields.registryRef.notFound`, in all ten packs.
  - **Wiring.** The form renderer threads `dataSource` to both keys, as it does for the other widget-hint pickers (`@object-ui/components`). The inline-grid exclusion set and the action-param value-shape table list both keys as widget-hint-only (`@object-ui/fields`, `@object-ui/app-shell`). The CLI's generated `KNOWN_SCHEMA_TYPES` gains `field:position-ref` and `field:permission-ref` (`@object-ui/cli`). A comment in `@object-ui/core` stops counting the picker names.
  
  **Clause-②: yes (widening)**: one optional `DataSource` member, two registered `field:` keys (the `RegisteredFieldWidgetType` union and `FORM_FIELD_TYPES` gain two members), and two locale keys. Nothing narrows: a field without the hint renders exactly as before.
- 12dc7b4: Setup lists the sharing rules installed packages declare again, read-only, with Disable / Enable and Clone (objectui#12982).
  
  Since objectstack stage 9 a package's declared sharing rules are no longer `sys_sharing_rule` rows, so Setup's Sharing Rules page (that object's data view) stopped listing them while they still granted access. Following objectstack ADR-0131 D6 regime C (ruling A on objectstack#24378), the declared rules now have their own page, the environment scope of the `sharing_rule` registry type (`…/metadata/sharing_rule?scope=environment`), as permission sets and positions do. The `sys_sharing_rule` view stays the page for the rules an organization authors. No page fetches and merges both lists.
  
  - **Read-only, with provenance.** The list shows each rule's object, recipient, access level and declaring package. It offers no New, and a rule opens read-only. A link leads to the organization rules page, where New lives.
  - **Disable / Enable.** `sharing_rule` joins the Setup catalog types with an active switch: the state is the activation ledger's row, and the switch writes `POST /security/_activation/sharing_rule/:name`. A refusal, such as a walled tenant's, is shown in the server's words.
  - **Clone.** Offered only to a caller holding the create grant on `sys_sharing_rule`, read through the new `declarationClone` row of `AFFORDANCE_GRANTS` (`@object-ui/core`). The dialog pre-fills a new organization rule from the server's compiled projection of that rule (`GET /sharing/rules/:name`), under a name no declared rule holds, and writes it through the `sys_sharing_rule` data door. The server's `409 RESOURCE_CONFLICT` for a declared name is shown as sent. Once the copy exists, the dialog offers to switch the declared rule off. A rule already switched off, whose projection the server does not serve, continues in the pre-filled New form.
  
  Clause-②: no. Console UI over existing server doors; no spec key or registry key changes. `AFFORDANCE_GRANTS` gains one row, `declarationClone`.
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [2e818d0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [96fcf30]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [f34e877]
- Updated dependencies [aaba865]
- Updated dependencies [45d5853]
- Updated dependencies [2312bd9]
- Updated dependencies [c5406c2]
- Updated dependencies [2a48bd4]
- Updated dependencies [c7b30bd]
- Updated dependencies [69bca0a]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [c08c933]
- Updated dependencies [c4dd707]
- Updated dependencies [923504f]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [7af0ab3]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [093d55b]
- Updated dependencies [a8051d6]
- Updated dependencies [524136e]
- Updated dependencies [6f3299f]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [ff9df88]
- Updated dependencies [a2225f9]
- Updated dependencies [21f9577]
- Updated dependencies [3eb3ec1]
- Updated dependencies [619e3f7]
- Updated dependencies [f62b6ff]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [4839f5c]
- Updated dependencies [c999d4c]
- Updated dependencies [26323c4]
- Updated dependencies [c219165]
- Updated dependencies [30083da]
- Updated dependencies [8aa8e3e]
- Updated dependencies [a928aaa]
- Updated dependencies [1b94d50]
- Updated dependencies [fb85637]
- Updated dependencies [df71568]
- Updated dependencies [cbac9d7]
- Updated dependencies [daeb77f]
- Updated dependencies [eb4552e]
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
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [088e0f7]
- Updated dependencies [b403bb3]
  - @object-ui/types@18.0.0

## 17.7.0

### Minor Changes

- 97abedc: A `dataSource` binding's own `limit` that the contract refuses is now treated as **not
  authored**: the row cap falls through to the named saved view's usable cap, and only when
  that is absent too to the consumer's own default (objectui#10016).
  
  **Behaviour change.** `composeElementDataSource` resolved the cap as
  `config.limit ?? savedViewLimit(view)`. objectui#9928 put a positivity check on the view's
  operand only, so a binding `limit` of `0`, `-10`, `25.5` or a non-number went through
  unchecked:
  
  - through `ViewDataProvider.resolveElementDataSource` it reached `DataFetcher.fetchRecords`
    verbatim, and nothing said so;
  - through `ElementDataSourceGate` it was written over everything, a usable component cap
    included, and the consuming block then dropped it and drew its own default, so the read
    went wider than either the view or the component asked for.
  
  Both operands now pass the same check, and a refused cap from either is not authored. The
  chain is: a usable binding cap, else a usable view cap, else none. This is the rule
  objectui#10009 set one layer up (a value the contract refuses is not authored, so the other
  source wins), applied to the two operands of one resolver. On the renderer path the view's
  cap that takes the binding's place is a baseline like any other view-sourced value, so a
  usable component cap still wins over it. A usable binding `limit` still beats both, exactly
  as before.
  
  **Diagnostics.** `elementDataSourceRefusedLimitMessage` takes two optional trailing
  parameters, the binding and the operand (`'view'`, the default, or `'binding'`). The binding
  operand has its own sentence, naming the binding, so a binding refusal and a view refusal
  are told apart when both fire. `ViewDataProvider` and `ElementDataSourceGate` report it once
  per declaration on the existing `console.warn` channel; the gate reports it only for a block
  that reads a row cap. Called with three arguments the builder answers exactly as before.
  
  **Fixed with it.** `ViewDataProvider` reported a saved view's refused cap even when the
  binding's own usable `limit` was the cap actually used, and that warning's claim that the
  fetch falls back to a default was false. The view's refusal is now reported only when the
  binding's `limit` is absent or refused. The builder applies that condition itself, so both
  callers share one copy of it.
- ad694ac: fix(core): the shared date path refuses a calendar day that does not exist, with the marker it already renders for an unparsable value
  
  A date-only value naming a day its month does not have — `2026-02-30`, `2024-02-31`, `2025-02-29` — used to render as a real, different day on every date face: the engine's parse accepts a day of `01`-`31` for any month and rolls the surplus forward, so `2026-02-30` showed as `Mar 2`, with nothing to say the stored value was wrong. The filter builder already refused the same value at the authoring boundary, so the repo gave one concept two answers.
  
  - **New export `isRealCalendarDate(dateOnly)` from `@object-ui/core`.** It moved from `@object-ui/components`' filter builder, which now imports it — one implementation, shared by the authoring boundary and the display path. It answers `true` only for a `YYYY-MM-DD` string whose year, month and day exist. It now also reads a year below 100 as that year (it used to answer `false` for `0026-08-01`), so the filter builder keeps such a date instead of clearing it.
  - **`toDisplayDate` returns an Invalid Date for such a value**, so `formatDate` (every face: default, `short`, `relative`), `formatRelativeDate` and `formatDateTime` render `—`, and `formatDateTimeCompactParts` returns `null` — each function's existing answer for an unparsable value. A caller that reads `toDisplayDate` directly gets the same refusal and shows its own unparsable face: the History tab and the record summary chip now show the stored string instead of a rolled date.
  - **A dataset measure agrees with the list cell on the refusal.** A date-only measure value of `2024-02-30` renders `—`, the same as the `date` cell beside it. The measure takes that answer from the shared path and makes no judgement of its own.
  - **`@object-ui/fields`:** the `date` and `datetime` cells, the readonly `DateField` and a date-returning `FormulaField` show the shared "No value" placeholder for such a day, exactly as for an unparsable value, instead of a bare dash.
  
  This change covers date-only values only. (A value that carries a time, such as `2026-02-30T10:00:00Z`, is refused by the same path too — objectui#10301, a separate entry in this release.)
- c131d9e: feat(core): `object-tree` joins the curated public tier — the spec declared the block, the roster withheld it
  
  `@objectstack/spec` declares `object-tree` on `ComponentPropsMap`, and
  `@object-ui/plugin-tree` has registered the renderer all along. The curated
  `PUBLIC_BLOCKS` roster — the one face that decides the ADR-0080 public tier —
  carried no tree name, so `getPublicConfigs()` reported the block as outside the
  contract. The tier was NARROWER than the declaration.
  
  That absence reached everything downstream, and nothing downstream could repair
  it. `getPublicConfigs()` is the read both manifest producers serialize through
  `manifestFromConfigs` (`apps/console/dev/manifest-dump.tsx`, and the framework's
  node generator for its tracked `sdui.manifest.json`), so the published manifest
  and the generated JSX intrinsics could not carry a block the contract says
  exists — regenerating them was a no-op, and moving the objectui pin could not
  help while the pinned source had nothing to carry.
  
  **What moves for a user.** `object-tree` is now part of the AI-authoring
  vocabulary and of the generated manifest and intrinsics, and it joins the
  `kind:'react'` page scope as `ObjectTree` (that scope is built from the same
  public configs, minus declared containers; this block declares no containment).
  The renderer, its props and every existing schema are untouched: nothing that
  rendered before renders differently, and no key changes meaning.
  
  **What deliberately does not move.** The same module registers this renderer a
  second time under the bare `tree` alias, and that spelling stays out: the spec
  declares no such key, so curating it would widen the vocabulary past the
  declaration rather than pull the tier back to it, and two names for one block is
  ambiguity an authoring model cannot resolve — the ground `record:chatter` is
  held out on.
  
  The admission is a roster entry, not a `tier: 'public'` flag on the
  registration. Both routes reach `getPublicConfigs()`; the siblings
  (`object-grid`, `object-map`, `object-gantt`, …) all take the roster, no
  published registration in this repo declares the flag, and the roster's own
  header asks callers to prefer the list over scattered flags.
  
  ⚠️ **Dated note, 2026-10-02 — the `tree` alias is no longer registered at all — objectui#10859.**
  Later in this same release objectui#10859 batch 8 unregistered the bare `tree` alias outright
  (`objectui validate` refused it at `type`, and nothing authored it), so the "second time" the
  paragraph above describes is gone too. The rest of this entry is kept as the reading of this change.
- 7b395d8: **BREAKING** — three more record ids that the objectui#9511 ruling's enumeration left out are
  strings now (objectui#10078). `CommentSearchResult.recordId`, `RecordSubscription.recordId`
  and `DataSourceMutationEvent.id` narrow **FROM** `string | number` **TO** `string`. ⚠️ Other
  record ids in `@object-ui/types` still admit a number and are not touched here, among them
  `DetailViewSchema.recordNavigation` (`recordIds`, `onNavigate`), `FeedItem.sourceId`, and the
  `onNavigate` slots on `ObjectGridSchema`, `ObjectViewSchema` and `ListViewRuntimeProps`.
  
  ```ts
  // before — compiled
  const bell: RecordSubscription = { recordId: 42, subscribed: true };
  // after — refused by the compiler; write the id the protocol carries
  const bell: RecordSubscription = { recordId: '42', subscribed: true };
  ```
  
  **Why.** objectui#9511 (director batch #195 item 1, letter A) ruled that a record id is a
  string wherever **metadata** names one, and extended that, as 「the same principle」, to
  `CommentEntry.recordId` and `MentionNotification.recordId`. It did not name these three, which
  are runtime and API shapes rather than metadata. Carrying the rule to them is the `domain:spec`
  seat's inheritance decision, recorded in the claim on objectui#10078: they hold the same id and
  were left with the old spelling. `CommentSearchResult.recordId` is copied straight from
  `CommentEntry.recordId`, `RecordSubscription.recordId` names the record a notification bell is
  for, and `DataSourceMutationEvent.id` is the id the `update` / `delete` doors already take as a
  string.
  
  **What changes at runtime.** `ValueDataSource` and `ObjectStackAdapter` now emit
  `onMutation` events whose `id` is always a string. Both methods still accept a numeric id
  through their own wider parameter, and each converts it at its own boundary before emitting —
  the one place the rule says the conversion lives. An in-memory `value` source whose items
  carry numeric keys therefore announces `'42'`, not `42`. A subscriber that compared
  `event.id` against a number must compare against the string. The two in-repo subscribers
  that read `event.id` already pass it through `String(...)`, so they see no difference.
  
  **Packages that narrow without a source change.** `@object-ui/collaboration` (`useCommentSearch`
  returns `CommentSearchResult[]`) and `@object-ui/plugin-detail` (`SubscriptionToggleProps`
  carries a `RecordSubscription`) publish the narrower type through their own `.d.ts`.
  
  **What a host has to do.** Code that builds a `RecordSubscription`, reads
  `CommentSearchResult.recordId`, or implements `DataSource.onMutation` with numeric keys
  converts once, where the number enters (its own adapter or data boundary), and passes the
  string from there on. ⛔ Nothing converts silently on the reading side.
  
  **Disposition: ADR-0087 D7 — a published runtime TypeScript interface with no metadata
  surface is carried by the compiler and needs no ledger entry; ⛔ no conversion entry, ⛔ not
  a tombstone, ⛔ not an npm `major`.** None of the three has a zod mirror, none is authored into JSON, and no schema
  references them, so there is no parse-time door and nothing for a conversion table to
  rewrite: the compiler error at the numeric site is the delivery channel. The level is `minor`
  because objectui marks its own breaking changes `minor` with this banner (AGENTS.md, version
  alignment); `major` is refused outright because every publishable package sits in one `fixed`
  group pinned to the `@objectstack` major (`scripts/check-changeset-no-major.mjs`).
  
  **Pin.** `record-id-string-survivors-10078.test.ts` in `@object-ui/types` asserts all three
  members read `string` (not `any`), refuses a numeric literal at each, and keeps a
  source-text census of the three declarations with controls that prove the census can fire.
- 6cc910b: A field-backed action param reaches its record picker, and a param whose backing
  field cannot be read is refused instead of rendered as an empty text box.
  
  An action declaring a `params` entry backed by a `lookup` field rendered as a bare
  text input: no options, no typeahead, and no request for the referenced object on
  the wire at all, because no picker was ever built. With the param `required`, the
  action could not be launched from the UI — while the same field rendered a working
  picker on a record form in the same build, off the same metadata.
  
  `resolveActionParams()` resolves a field-backed param against the `objects` list
  its caller holds, and two of the console's own callers cannot hold the right one:
  `ConsoleShell`'s root action runtime — the provider that exists so a `type: 'flow'`
  `action:button` works outside the four object views — passes no objects at all, and
  `DeclaredActionsBar` passes exactly one (none when driven by an `actions` prop).
  With the owner object absent the param took the resolver's last-resort shape, and
  for a field-backed param that shape is `text`: it declares no inline `type`, so
  there is nothing else to fall back to. The object binding was never missing from
  the client — this seam never asked the metadata store for it.
  
  - `useConsoleActionRuntime` now resolves field-backed params against the caller's
    objects UNIONED with the console metadata store's, caller first (`withKnownObjects`),
    after awaiting the object type so "this field does not exist" is an answer rather
    than a boot race. A draft/preview overlay the caller carries still wins.
  - The degradation is no longer anonymous. `resolveActionParams()` stamps
    `unresolvedField: '<object>.<field>'` on a param whose backing field it could not
    find and says so in dev. This is the half that made the defect invisible for a
    whole version: by the time `paramToField()` sees such a param it IS a `text`
    param, so `paramDegradesWithoutTarget()` answered false, no "no reference target"
    warning fired, and even the "paste a record id" placeholder and help text did not
    apply.
  - `ActionParamDialog` refuses such a param: it renders an alert naming the
    `<object>.<field>` pair in place of the control, logs one line per dialog opening
    in every build, and disables Confirm so the action cannot be launched with a value
    the dialog had no contract to collect.
  
  New localized string `actionDialog.unresolvedParam` in all ten locale bundles. The
  `<object>.<field>` locator renders as its own node rather than an interpolation, so
  an identifier is never re-ordered by a translation.
- 061f5e8: fix(dashboard): a dashboard filter declaring `object` now resolves its translated labels; the axis-title half reaches no surface
  
  `@objectstack/spec` declares two dashboard surfaces translatable — a filter's `object` and an
  axis `title` — and the Console resolved neither, so an author could set a key the contract
  documents and nothing happened. They turned out to be **two defects, not one** — a key never
  read, and a value that bypassed a resolver already in the tree — and they were fixed
  separately. Only the first reaches an author in this release: see the note at the end.
  
  **1. `GlobalFilterSchema.object` was never read.** The spec's describe text for the key is
  "Object whose `fields.<object>.<field>` translation-bundle entry resolves this filter's field
  label and option labels". `resolveDashboardFilterDefs` names the keys it copies onto a
  `DashboardFilterDef` and this one was not among them, so the authored value could not reach a
  renderer even in principle: a dashboard filter declaring `object` and no `label`, viewed on a
  translated console, painted the RAW FIELD NAME and left its option labels in the authored
  English. The definition now carries `object` through, and `DashboardFilterBar` resolves the
  field label through `useSafeFieldLabel().fieldLabel` and the option labels through the same
  object's `translateOptions` — the convention resolver every list and form already calls, which
  is the "one resolver path" the key's own spec text asks for. No second resolver was written.
  Precedence follows that resolver's signature: the translator's bundle wins, the authored label
  is the fallback. A filter that names no `object` never reaches it and renders exactly as
  before.
  
  **2. `ChartAxisSchema.title` bypassed a resolver two modules downstream.** The key is
  `I18nLabel`, so an inline locale map parses, builds and validates — and `axisPresentation`
  collapsed it with `labelText`, a first-string-in-KEY-ORDER pick. Measured both ways round on
  one map: English to a `zh-CN` viewer and Chinese to an `en` viewer, decided by nothing but
  which key the author typed first. `normalizeChartSchema` already resolves an axis title
  through `pickLocalized` against the viewer's language, so the map only had to survive the
  lowering. The fix forwarded it verbatim through `forwardedI18nLabel` — the neighbour in the
  same module that already carries a chart's own `title` / `subtitle` / `description` for
  exactly this reason — and that lowering was then removed in the same release (the note at the
  end).
  
  This moves one entry of the objectui#4020 first-string-wins ledger. That ledger's
  justification is "a locale-unaware pick a caller can OVERRIDE", which holds for a series
  `label` — the report renderer outranks it with objectui#4020's three-level display name — and
  never held for an axis title, which is spread onto the chart schema and drawn. `seriesPresentation` keeps the pick and
  is still pinned.
  
  What an author sees change: a filter that opted in with `object` now shows its translated
  field and option labels instead of the raw field name and English options. Nothing that omits
  `object` renders differently, and point 2 changes nothing an author sees (below).
  
  ⚠️ Point 2 reaches no surface in this release, which also carries objectui#11315 and
  objectui#11372. `@objectstack/spec` 17.5.0 refuses `chartConfig.xAxis` / `yAxis` / `series` on
  a dashboard widget, and the dashboard's dataset widget no longer reads them (objectui#11315), so
  a dashboard draws no authored axis title at all, in any language. That widget was the only
  caller of `axisPresentation` and `mergeAuthoredPresentation`, and objectui#11372 removes both
  from `@object-ui/core` in the same release, so the fixed lowering never ships. The react
  `ObjectChart` tier, which still authors its own axes, never went through that lowering: it hands
  `xAxis` / `yAxis` to `normalizeChartSchema`, which resolves a locale-map axis title against the
  viewer's language since objectui#8943 (released alongside this, under its own changeset).
  `ObjectChart.axisTitleLocale-10132.test.tsx` in `@object-ui/plugin-charts` pins that surface at
  two languages.
- 4ab4f1b: A date-only value now renders the calendar day it names, west of UTC, at four more places (objectui#10183).
  
  **Clause-②: yes** — `@object-ui/core` gains one export, `toDisplayDate(value)`: the parse step every date formatter in `utils/date-display.ts` already went through, now reachable by a caller that formats with its own `Intl` options or compares a value with today. Nothing else is added, removed, renamed or retyped, and `@object-ui/fields` does not re-export it.
  
  **What it was.** objectui#10110 repaired the shared date path: a date-only value such as `2026-08-01` is UTC midnight to the JavaScript engine, so reading it back in the viewer's zone lost a day west of UTC. The repair rebuilt such a value at local midnight inside the shared formatters, but four places never reached it. `data-table`'s default cell face parsed the string into a `Date` first, and the shared step leaves a `Date` alone. The record summary chip, the record History tab and the `date` cell's overdue colouring each parsed the value themselves. Measured in `America/Los_Angeles`: `2026-08-01` rendered `Jul 31` in a table cell, `2026年7月31日` on a zh-CN summary chip and `7/31/2026` in History, and a deadline falling today read `Today` in red.
  
  **What changed, in observable terms.**
  
  - A `data-table` cell with no cell renderer hands the string to `formatDate` / `formatDateTime`. This also covers a related list whose child object schema is unavailable, since its cells fall back to that face.
  - The summary chip and the History tab take their `Date` from `toDisplayDate`. Their faces are unchanged: the chip keeps `dateStyle: 'medium'`, History keeps the locale's default numeric date.
  - The `date` cell's overdue colouring compares the day `toDisplayDate` names, so a deadline falling today is no longer red west of UTC. The cell's text was already right, and its hover title is unchanged.
  - ⚠️ The summary chip's and History's `datetime` arms share that parse, so they follow the shared path's rule: the value's shape decides, never the field's type. An instant still converts into the viewer's zone. A date-only value stored on a `datetime` field now reads as local midnight of its day, as `formatDateTime` already rendered it; before, it read as the previous evening west of UTC and as a morning hour east of it.
  
  In UTC every face is byte-identical to before. East of UTC every date face and the overdue colouring are too; only that `datetime`-arm reading of a date-only value moves there.
- 86982ac: fix(core): a dashboard `dateRange` that omits `defaultRange` now takes the spec's declared default preset (objectui#10339).
  
  `@objectstack/spec` declares `DashboardSchema.dateRange.defaultRange` with `.default('this_month')`, but
  `resolveDashboardFilterDefs` treated an omitted `defaultRange` as "no filter", so a dashboard authored as
  `dateRange: { field: 'created_at' }` rendered unfiltered while the platform's parse of the same document said
  `this_month`. The read site now applies the spec default, read from the spec's own `dateRange` schema rather
  than a copied string.
  
  **Behaviour note:** an authored `dateRange` with no `defaultRange` now opens filtered to `this_month`, matching
  the spec. An explicit `defaultRange` — `custom` included — is unchanged, and a dashboard with no `dateRange` at
  all still gets no built-in date filter.
- ff14e29: New export `recordDelete` — the one record-delete core that list hosts bind to, so a Delete behaves the same wherever it is offered (objectui#10383).
  
  `recordDelete.confirmText({ objectName, t }, record?)` returns the question to ask before deleting one record. `recordDelete.run(deps, request)` performs the delete and reports it: one record, or several deleted one call each and settled together, then a refresh and the success, failure or "N deleted, M failed" toast. `deps` carries the host's `objectName`, `label`, `t`, `toast`, `dataSource` and optional `onRefresh`, so `@object-ui/core` takes no i18n or toast dependency. `request` is the action runner's `delete` shape (`params.records`, or `params.recordId` with an optional `params.record`), and the result is what a runner `delete` handler returns: the toasts are the feedback, so no path returns an `error` except a request with no record id.
  
  ADR-0094 lives here: a `sys_permission_set` row whose `managed_by` is `'package'` is reset to its shipped baseline, not removed, so it is asked the reset question and gets the reset toast. The row passed in is read first, with a best-effort `findOne` when only the id is known.
  
  The console's object list (`@object-ui/app-shell` `useObjectActions`) and the registered `object-view` grid (`@object-ui/plugin-view`) both call it. The console's behaviour is unchanged: its handler code moved here with no behaviour change, including the returns that keep the runner from showing a second toast.
- 8acc51b: fix(core): Undo of an `undoable` update no longer writes `null` over a field the row did not carry
  
  An `undoable` update records the prior value of every field it writes, read off
  the row it ran on, so the success toast can offer Undo. On a list row projected
  by `$select` (`ListView`, `ObjectGrid`, `RelatedList`), a written field that no
  column shows was absent from the row. It was recorded as `null`, and Undo then
  wrote `null` over the value it existed to restore: close a task from a grid that
  shows only its name, press Undo, and its status became empty instead of `open`.
  
  Two changes:
  
  - The list harvest (`listViewPredicates`) now also names the fields an
    `undoable` action writes: its `patch` keys, the key each param's value is
    collected under (`name`, else `field`), and its `bodyExtra` keys. So a
    projected row carries them, through the same gates as every harvested name:
    a bare identifier, a field the object declares (or a platform column), and
    field-level security once the permission answer has loaded. `recordId` is
    not harvested; both writers strip it as the record's address.
  - The capture never records an absent field as `null`, in `ActionRunner`'s
    `operation: 'update'` path and in the console `api` handler's data-source
    branch alike. When the row does not carry every written field (for example a
    field the principal may write but not read), the action still runs, but it
    offers no Undo: the success toast has no Undo button, nothing is pushed onto
    the undo stack, and a console warning names the missing fields. A `null` the
    row does carry is a real empty value and is still restored as `null`.
  
  Behaviour to know about: on a backend that leaves null-valued fields out of a
  full record, an `undoable` update of such a field now offers no Undo instead of
  one that restores it to empty. Absent and empty cannot be told apart there, and
  no Undo is the side that cannot overwrite stored data.
- 9a5f998: `@object-ui/core` exports `withoutDeniedFields(record, policy, objectName, extraKeep?)`, the field-read rule for one record: the record as the viewer may read it on `objectName` (objectui#10594).
  
  Every field the loaded `policy` denies is removed, which leaves the row ObjectStack's `FieldMasker` already serves. `id`, `_id` and any key in `extraKeep` (a declared id field) are never judged. Before a policy loads, with no policy, with no object name, or for a value that is not an object, the record comes back as it is; when nothing is withheld the SAME object comes back. `policy` is structural (`isLoaded` and `checkField`), so `usePermissions()` from `@object-ui/permissions` satisfies it and `@object-ui/core` gains no dependency.
  
  The renderer's display surfaces that each carried a module-private copy of this rule now call the export, with no change in what they draw:
  
  - `@object-ui/fields`: the lookup cell's name and the user cell's name and avatar (the package entry), and the lookup editor's option label and search chip avatar (`LookupField`).
  - `@object-ui/react`: `useRecordSearch`'s hit label under `fieldReadPolicy`.
  - `@object-ui/app-shell`: the record page's title and the row its blocks read (`RecordDetailView`).
  - `@object-ui/plugin-detail`: `DetailView`'s header title and `record:details`' title dedupe. The package-internal `withoutDeniedFields` module is removed; it was never a package export.
- baac95a: feat(core,sdui-parser): the published manifest declares the html tier's registered intrinsic elements, marked `tier: 'html'` — `div` stays out
  
  A `kind:'html'` page may author the everyday HTML tags its renderer registers —
  the flow/inline set of `html-elements.tsx` (h1–h6, p, a, lists, emphasis,
  figure/img/hr/br, time, address, cite, q), `span`, `table`, `label` and the seven
  sectioning tags — and the console has rendered such pages all along. The
  published `sdui.manifest.json` never said so: it was the curated `PUBLIC_BLOCKS`
  vocabulary alone, so the objectstack CLI gate, which whitelists an html page's
  tags from that manifest, refused every plain HTML tag as `forbidden-tag` on
  pages the renderer accepts (200 ledgered findings over the three shipped showcase
  pages). The maintainer ruled A on objectstack#20112: the producer declares the
  set, exactly as the registry declares it, and `div` stays deprecated.
  
  **What moves for a consumer.** `ComponentRegistry.getPublicConfigs()` — the
  read both manifest producers serialise — now returns the curated tier AND the
  html tier's intrinsic elements, the latter from the new `HTML_TIER_INTRINSICS`
  roster (`@object-ui/core`) and each stamped `tier: 'html'` in the projection.
  `manifestFromConfigs` carries that one value into a new optional
  `ManifestComponent.tier` (`@object-ui/sdui-parser`), so the regenerated
  `sdui.manifest.json` grows by the roster (47 entries, each with its registered
  `inputs` and its child slot declared exactly where the registration renders a
  child list — the void tags `img` / `hr` / `br` declare none) and
  `sdui-intrinsics.d.ts` types them. A reader that whitelists tags by key — the
  objectstack gate — needs no change and accepts the tags. A reader that means the
  CURATED vocabulary filters on the stamp: `generateBlockList` now sections the
  html tier under its own count, and the `kind:'react'` JSX scope skips stamped
  entries (`@object-ui/components`, `react-page.tsx`), so no `P` / `A` / `Img`
  wrapper is injected into react pages — on that tier a lowercase `<p>` is React's
  own element.
  
  **What does not move.** `PUBLIC_BLOCKS` is unchanged and the two rosters are
  pinned disjoint; every curated manifest entry serialises byte-identically
  (`tier` is written as exactly `'html'` or omitted). `div` is not declared: the
  gate keeps refusing `<div>` on an html page, and `box` remains the JSON
  surface's replacement. `code` is not declared either — the bare `code` key is
  the `field:code` widget's namespace fallback, not an element renderer — nor is
  `kbd`; both are recorded, with reasons, in the console's exclusion ledger.
  No registration changes; `html-elements.tsx` is untouched.
  
  ⚠️ **Dated note, 2026-09-27 — `code` has since joined the roster — objectui#10756.** At this change the roster held 47 tags and `code` was undeclared because the bare key was the `field:code` widget's fallback; `html-elements.tsx` now registers `code` as a sanitised passthrough (`ui:code`), `@object-ui/fields` registers the widget with `skipFallback` so it keeps only `field:code`, and the manifest declares `code` with `tier: 'html'` — 48 html-tier entries. `div` and `kbd` are still out. The rest of this entry is kept as the reading of this change.
  
  The manifest the framework ships regenerates from objectui's built tree at the
  pin (its `gen-sdui-manifest-node.mjs`); its lockstep copy of `manifestFromConfigs`
  must take this port for the stamp to reach that file — until then the tags are
  declared there without the marker, which the gate treats identically.
- 29b45f6: feat(core,components): the html tier registers and declares `code` — `<code>inline</code>` on a `kind:'html'` page renders its text instead of the `field:code` editor
  
  `renderers/basic/html-elements.tsx` called `code` "registered elsewhere", but the
  only bare `code` registration was the `field:code` widget's namespace fallback: a
  code editor reading `value`, with no declared inputs and no child slot. The
  console's html-tier compile whitelists `ComponentRegistry.getKnownTypes()`, so
  `<code>inline</code>` on an html page compiled, resolved to the editor, and the
  authored text was dropped — while `pre`, `strong` and `em` rendered their
  children through the passthrough, and `span` through its own renderer. The
  published manifest (objectui#10735) left `code` undeclared for the same reason,
  so the objectstack gate refused the tag the renderer mis-drew.
  
  **What moves for a consumer.**
  
  - `@object-ui/components` — `code` joins the `TAGS` loop of `html-elements.tsx`:
    registered `ui:code`, sanitised like its siblings, declaring `className` and the
    `children` slot. An html author's `<code>` now renders a real `code` element with
    its text.
  - `@object-ui/fields` — **BREAKING (authoring): the bare `code` key no longer
    resolves to the code-editor widget.** `code` joins `FIELD_TYPES_SKIP_FALLBACK`,
    so the widget is registered `field:code` only. A node authored as bare
    `{ "type": "code", "value": … }` now renders the html tier's `code` element (it
    draws `children`, not `value`); in a registry without `@object-ui/components`
    the bare key resolves to nothing. Migration: `{ "type": "code" }` becomes
    `{ "type": "field:code" }`. Form fields of type `code` resolve through the
    `field:` namespace and render the same editor as before. Released as `minor`
    under objectui's version policy; a breaking change never declares `major`.
  - `@object-ui/core` — `code` joins `HTML_TIER_INTRINSICS`, so `getPublicConfigs()`
    projects it stamped `tier: 'html'` and the regenerated `sdui.manifest.json`
    grows by one entry (the html tier declares 48 tags where objectui#10735
    declared 47); `div` and `kbd` stay undeclared.
  - `@object-ui/types` — `HtmlElementSchema` (zod and TS) names `code`, keeping the
    JSON-surface declaration equal to the registration, as the objectui#8499 pin
    requires — so `AnyComponentSchema` (and `objectui validate`) now accepts
    `{ "type": "code" }`, which it refused before.
  - `@object-ui/cli` — `packages/cli/src/utils/known-schema-types.ts` regenerates
    from the registrations and gains `ui:code`, so `objectui validate` and
    `objectui check` recognise it as a known schema type (the objectui#9533 and
    objectui#6416 precedent).
  
  The `kind:'react'` scope skips stamped entries, so no `Code` wrapper is injected
  on react pages. The framework's tracked manifest regenerates at its next
  `.objectui-sha` bump (objectstack#20112's port list); nothing there changes here.
- 990a2d6: chore(core)!: the record-source `data` arm table drops `tree` and `view:tree` (objectui#10859, batch 8)
  
  **BREAKING (authoring):** `recordSourceDataArmForType('tree')` and `recordSourceDataArmForType('view:tree')` now answer `'undeclared'`, because `@object-ui/plugin-tree` no longer registers either key. The table names `object-tree` / `plugin-tree:object-tree` alone, which still answer `'view-data'`.
  
  Migration:
  
  - `tree` → `object-tree`; nothing else reads these rows.
  
  **Clause-②: yes**, released as `minor` with this banner.
- 328abeb: Four Console surfaces that read English under a zh-CN session now read the session's
  language (objectui#10900). English stays the default.
  
  - **The generic action success toast.** When an action declares no `successMessage`, the
    runner falls back to "Action completed successfully".
    That fallback now goes through a translator: `ActionRunner.setTranslator(translate)` is
    new in `@object-ui/core`, and `<ActionProvider>` and `useActionRunner` in
    `@object-ui/react` install the session's `t` on the runner they build. The pack key is
    `actions.completedSuccessfully`. An author's `successMessage` still reaches the toast
    untranslated, and a runner with no translator installed still toasts the English sentence.
  - **The social sign-in buttons on the login and sign-up pages.** `SocialSignInButtons`
    takes a new `buttonText` prop, a template whose `{provider}` is replaced with the
    provider's display name; unset, the buttons keep "Continue with {provider}" and
    "Sign up with {provider}". `LoginForm` and `RegisterForm` take a new `socialButton`
    label and pass it, with their existing `orText` label, to the buttons. `orText` was
    documented as the divider label but rendered nowhere; it now sets the divider under the
    buttons, and its documented default is corrected from "or" to "or continue with email",
    the text that divider has always shown. The console's login and sign-up pages and
    `@object-ui/app-shell`'s `DefaultLoginPage` / `DefaultRegisterPage` pass the new
    `auth.login.*` and `auth.register.*` `socialButton` / `orText` keys. The provider's display
    name is inserted as-is: the component's own label for the branded providers it knows,
    otherwise the name the server reports.
  - **Build Doctor.** The build conversation's Build Doctor button (its accessible name and
    both tooltips) and the title of the drawer it opens read `console.ai.buildDoctor`,
    `console.ai.buildDoctorTitle` and `console.ai.buildDoctorDisabledTitle`.
  - **Setup → marketplace.** On `system/marketplace` and the pages under it, the breadcrumb
    segment after System reads `console.breadcrumb.marketplace` instead of the humanized URL
    slug; other `system/*` segments are unchanged. The zh marketplace search placeholder
    reads 「按名称或标识搜索应用…」 instead of 「按名称或 manifest ID 搜索应用…」. The search
    itself is unchanged: it matches the display name, the identifier and the description.
  
  All ten locale packs carry the nine new keys; no existing `en` value changes.
  
  **Clause-②: yes** — besides the nine pack keys, the public surface widens by four optional
  members: `ActionRunner.setTranslator`, `SocialSignInButtonsProps.buttonText`,
  `LoginFormLabels.socialButton` and `RegisterFormLabels.socialButton`. Nothing is removed,
  renamed or narrowed, no accept set changes, and `@object-ui/react` exports nothing new.
- e227156: fix(core): `ActionDef` no longer declares `aria`, which `@objectstack/spec` 17.5.0 retired on an action
  
  `@objectstack/spec` 17.5.0 retired `action.aria` as a `retiredKey()` tombstone:
  authoring it is a parse rejection, because no action surface ever applied it.
  The accessible name an action gets is its `label`. To name the region that
  places the actions, use the `aria` block of the placing node.
  
  `ActionDef` (`@object-ui/core`) mirrored the key as `aria?: SpecActionInput['aria']`.
  After the 17.5.0 bump that type resolved to `undefined`, so the field mirrored
  nothing. It is removed, and so is its entry in the exported `ACTION_DEF_KEYS`
  inventory. `aria` stays in `SPEC_ACTION_KEYS`, because the spec still declares
  the tombstone, so the dev-mode unknown-key warning does not change for an action
  that still carries it.
  
  **Breaking, at the type level only.** Two names on the package root narrow:
  
  - the `ActionDef` interface loses its `aria` member;
  - the exported `ACTION_DEF_KEYS` constant loses its `'aria'` element, both in
    the runtime array and in its `as const` element union.
  
  Code that compiled before and does not now:
  
  - an explicit `aria: undefined` in an `ActionDef` object literal (an
    excess-property error);
  - a read of `.aria` on an `ActionDef`;
  - `'aria'` used as a `keyof ActionDef`, or as a `typeof ACTION_DEF_KEYS[number]`.
  
  Every other `aria` value in an `ActionDef` literal was already a compile error,
  because the member's type was `undefined`. The runtime accept set does not move:
  nothing validates an `ActionDef` at runtime, and `KNOWN_ACTION_KEYS` still holds
  `aria` through `SPEC_ACTION_KEYS`. Measured reach: this repository had no reader
  of an action's `aria`, and CI `Type Check`, which compiles every workspace
  consumer of `@object-ui/core`, is green with the member removed. The level is
  `minor`, which is how this repository ships its own breaking changes.
  
  The Studio action editor did not need a change: the served `action` schema from
  17.5.0 on does not carry `aria`, so its "More fields" form offers no `aria`
  control. A test in `@object-ui/app-shell` now pins that.
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
- 76e9df0: fix(app-shell,core): the record page's Undo captures only what the record carries, through core's one capture rule (objectui#11082)
  
  **Clause-②: yes** — `captureUpdateUndoData` becomes a named export of `@object-ui/core`, a new published symbol. Its answers do not change. No declared type or accepted key moves.
  
  - **`@object-ui/core` exports `captureUpdateUndoData(writtenFields, rowRecord)`.** It is the rule `ActionRunner` already used for an `undoable` update's Undo snapshot (objectui#10404): it answers each written field's stored value when the row carries every written field, and `undefined` when any one is missing, so the caller offers no Undo at all. A `null` the row carries is captured as `null`. "Carries" means an own key whose value is not `undefined`.
  - **The record page's own `api` handler calls it.** `RecordDetailView` read each written field's prior value off the loaded page record as `pageRecord[k] ?? null`. The page record is read with no column list, but the server removes every field the reader may not read, so an undoable action that writes such a field found it absent and captured `null`. Pressing Undo then wrote `null` over the stored value. Now that action offers no Undo button, logs a warning naming the missing fields, and still performs the write. A carried value, `null` included, is restored as before.
  - **The console runtime's `api` handler calls it too**, in place of its inline copy of the same rule. Its behaviour does not change.
  
  Pinned in `packages/app-shell/src/views/RecordDetailView.undoCapture-11082.test.tsx` and `packages/core/src/actions/__tests__/captureUpdateUndoData.export-11082.test.ts`.
- 6158e4c: `ValueDataSource` executes the empty pair `is_empty` / `is_not_empty` and the `$empty` operator, and `convertFiltersToAST` lowers `$empty` (objectui#11094).
  
  `@objectstack/spec` 17.6.0 admits `$empty` to `FILTER_OPERATORS` (objectstack#20446). It also stops folding `is_empty` / `isempty` onto `is_null`, and `is_not_empty` / `isnotempty` onto `is_not_null`, and lowers them to `$empty: true` / `$empty: false` instead (objectstack#20570). `ValueDataSource` canonicalises AST operators through the spec's `canonicalAstOperator` and had arms only for the null pair. So on 17.6.0 a stored `is_empty` or `is_not_empty` rule on a `provider: 'value'` source reached the refusal arm: it selected no row and logged one refusal per `find()`.
  
  **After.** `is_empty` and `$empty: true` select a row whose value is null, absent, `''` or `[]`. `is_not_empty` and `$empty: false` select exactly the other rows. The answer is the spec's own `isEmptyFilterValue`, called without a field declaration, because this adapter holds none. That is the by-value reading the spec gives a face with no declarations, the same call `@objectstack/formula`'s matcher makes. A `$empty` flag that is not `true` or `false` is refused like every other refusal in this adapter: the row is excluded and the reason is logged once.
  
  **What moves for a stored rule.** On 17.5.0 the empty pair was a null test here. A row whose value is `''` or `[]` is now selected by `is_empty` and no longer by `is_not_empty`. Rows holding a value, null or no key answer as before.
  
  `convertFiltersToAST` lowers `{ f: { $empty: true } }` to `['f', 'is_empty', true]` and `$empty: false` to `['f', 'is_not_empty', true]`, the inverse of the spec's `parseFilterAST`. A flag that is not a boolean throws a `FilterOperatorError` (`code: 'INVALID_FILTER'`, `httpStatus: 400`). Before this, the operator reached the unknown-operator throw. The unknown-operator message now lists `$empty` among the supported operators. `@object-ui/data-objectstack`'s `find()` lowers an object `$filter` through this function, so an object filter carrying `$empty` reaches the wire there instead of throwing.
- 858eafb: fix(plugin-gantt,core,plugin-timeline): both gantt surfaces read a date-only end inclusively through one core rule, and a drag writes the same day back (objectui#11141)
  
  **A widening: `@object-ui/core` gains two exports**, `toDisplayEndDate(value)` and `toInclusiveEndDay(end)`, on its published entry beside `toDisplayDate` (the same file, `utils/date-display.ts`, re-exported by `export *`). Nothing else in `@object-ui/core` is added, removed, renamed or retyped.
  
  - **A date-only end is inclusive on the object gantt too.** `ObjectGantt` read a stored end like a start, as the named day's local midnight, so every bar was drawn one day short and a successor starting the next day stood one day after its predecessor. The schema catalog's own plans drew that way. A task from `2024-01-01` to `2024-01-15` now runs through January 15th, and a successor starting `2024-01-16` begins exactly where it ends, as the timeline's gantt already drew it (objectui#11112). A task whose date-only start and end name the same day is now one day long, where it was a zero-length milestone. An end with a time part is still an instant, and the bar ends exactly there. Baseline ends read the same way.
  - **One rule, in `@object-ui/core`.** `toDisplayEndDate` reads an end: a date-only value becomes the start of the next day (a calendar day, so 23 or 25 hours across a DST change), and anything else is read as `toDisplayDate` reads it. `toInclusiveEndDay` is its exact inverse: it names the last day a span ending at an instant runs through. The timeline's gantt and `ObjectGantt` both read their ends through the first, so they cannot drift apart again. A day whose OWN midnight does not exist in the viewer's zone (`America/Santiago` on 2026-09-06, which starts at 01:00) now ends at the next day's midnight; the timeline used to end it at 01:00 of that next day. A day whose NEXT midnight does not exist (2026-09-05 there) still ends at the next day's first hour, as it did.
  - **A drag writes the day the bar runs through.** A dragged or resized bar whose end lands on a day's midnight writes the day before it into a date-only end field, so reading, dragging and writing a stored `2024-01-15` leaves `2024-01-15`. This also holds under a business `timeZone` whose clock skips a midnight. A `datetime` end still writes its instant.
  - **The view names that day.** `GanttView`'s End column, row date line, tooltip, drag preview and inline editor now name the last day a bar runs through, and the tooltip's day count includes it. Pressing Enter on an untouched row in the inline editor commits the end it started with. An end inside a day still names that day, and a zero-length task still names its own day. An embedder that passes `GanttView` a `Date` end directly now sees that end named as the last day the bar covers. A local-midnight end is named as the day before, which is where its bar already stopped.
  - With `autoZoomToFilter: false`, the pinned range ends on the last day any task runs through, and no longer adds an empty day column after it.
- 138ad45: feat(core): the `flex()` builder emits its props in the `properties` bag (objectui#11276)
  
  **BREAKING (output shape):** `flex()` now builds `{ type: 'flex', properties: { direction, justify, align, gap, children } }` instead of writing those keys on the node. That is the spelling `@object-ui/types`' authoring faces accept for an authored `flex` node, which now refuse the flat keys by name (objectui#11276, the maintainer's ruling A on objectui#11300); without this change, `objectui validate` would refuse what the builder builds. The base setters (`id`, `className`, `visible`, `disabled`, `testId`, `visibleOn`) still write on the node. Code that reads a built node's props reads them from `properties` (`flex().direction('col').build().properties.direction`); `build()` is typed `BaseSchema & { type: 'flex'; properties: FlexLayoutProps }`. Rendering is unchanged: `SchemaRenderer` hoists the bag onto the node before the `flex` renderer reads it.
- c476be0: The action success toast is composed from the action's `outcomeMessages`, then its `successMessage`, then the runner's default text. A `message` in the server's answer is no longer shown (objectui#11344).
  
  `@objectstack/spec` 17.6.0 declares `ActionSchema.outcomeMessages`, the success copy for each handler outcome. Its keys are the snake_case `outcome` values that a `type: 'api'` or `type: 'script'` handler returns in its success payload. This follows ruling A on objectstack-ai/cloud#2315: the server returns facts, and the console writes the sentence in the user's locale.
  
  - `@object-ui/core`: the `ActionRunner` success toast now picks its text in this order:
    1. the `outcomeMessages` entry named by the top-level `outcome` of the handler's answer;
    2. `successMessage`;
    3. the runner's default text, in the language of the translator set with `setTranslator`.
  
    Rungs 1 and 2 fill in `${result.*}` tokens from the handler's answer. That is the same scope `onSuccess.navigate` reads, and the values go in as text, not percent-encoded. **Behaviour change:** `result.data.message` used to take precedence over both. The runner no longer reads it at all. To show the server's sentence, write `${result.message}` as the copy. `ActionDef` now declares `outcomeMessages`.
  - `@object-ui/react`: `useActionTextLocalizer` resolves each `outcomeMessages` entry that a named action declares. It looks in `_actions.NAME.outcomeMessages.OUTCOME`, then `globalActions.NAME.outcomeMessages.OUTCOME`, then falls back to the authored text. On a named action, an inline `I18nLabel` map on an entry, or on `successMessage`, is collapsed to the active language first. `${result.*}` tokens pass through unchanged, and the runner fills them in after the action runs.
  - `@object-ui/i18n`: `useObjectLabel()` adds `actionOutcome(objectName, actionName, outcome, fallback)`, the resolver for that address.
  - `@object-ui/components`: `action:button`, `action:icon`, `action:group` and `action:menu` now forward `outcomeMessages` to the runner. Before, a registered action rendered through `action:bar` lost the map one hop before the toast. The `action:button` and `action:icon` registrations do not publish it as an input, because their own spec rows do not declare it at 17.6.0.
  - `@object-ui/types`: `UIActionSchema` declares `outcomeMessages`, derived from the spec.
  
  `@object-ui/core` and `@object-ui/types` raise their `@objectstack/spec` floor from `^17.5.0` to `^17.6.0`, because their published types now read `ActionSchema.outcomeMessages`, a member the spec first declares in 17.6.0.
- 063119f: A gate that is declared but cannot be evaluated is a fault, not "no gate" (objectui#11358)
  
  A `visible` / `hidden` / `disabled` / `enabled` / `condition` value that is present but carries
  no evaluable `source` — an `ast`-only envelope (`{ dialect: 'cel', ast }`), a number (`0`), an
  object with no `source` (`{}`), an array — used to be folded into "no gate" in silence. So a
  bulk action gated that way was offered on the selection bar and ran over every selected record,
  and the row menu and the toolbars showed it to everyone (ADR-0137 D4: a gate predicate that is
  blank or faulting is "diagnosed, never a silent `true`").
  
  It is now a declared gate that faults:
  
  - `toPredicateInput` keeps the state instead of folding it: it returns a frozen `cel` envelope
    with no `source` (a new member of `EvaluatorPredicateInput`), so `hasDeclaredPredicate` — and
    `@object-ui/components`' re-export `hasDeclaredVisibilityGate` — answers "declared".
    `null`, `undefined`, `''` and blank predicate text are still "not declared", as before.
  - `ExpressionEvaluator.evaluateCondition` treats it as a fault: a `throwOnError` caller gets a
    throw, any other caller gets the fail-soft `true` and one report with the `[unevaluable]`
    reason (or the caller's `onFault`). `evalFieldPredicate` tags the same reason instead of
    sending the value to the engine.
  - Each reader therefore answers with the fail direction its key already has for a predicate
    that cannot be evaluated: an action's `visible` is hidden on the toolbars, the row menu and
    the selection bar (where no selected record qualifies); a `disabled` is greyed out and
    `ActionRunner` refuses the action; `SchemaRenderer`'s `hidden` hides the node. A `condition`
    still lets the action run, a legacy `enabled` leaves the control enabled and an action
    param's `visible` still shows the param — the directions those keys take on any fault — now
    reported instead of silent.
  - The dev-mode schema validator still refuses these values on `visible` / `disabled`.
  
  Breaking for metadata that wrote such a value into a gate: the action it gated now hides (or
  greys out) where it used to show.
- f9c8c4e: BREAKING (`@object-ui/core`): `mergeAuthoredPresentation` and `axisPresentation` are no longer exported (objectui#11372).
  
  (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  Both lowered an authored chart config's `xAxis` / `yAxis` (spec `ChartAxis` objects) onto the chart schema a dataset-bound surface builds. Their one caller was the dashboard's dataset widget, which stopped reading `chartConfig.xAxis` / `yAxis` / `series` when `@objectstack/spec` 17.5.0 refused them on a dashboard widget (objectui#11315). Nothing else in this repository called them, and a published export with no consumer is not kept, so both are removed.
  
  What stays, unchanged: `mergeAuthoredSeries` (the series-presentation merge the report renderer calls), `seriesPresentation`, `chartConfigPresentation` and `chartTypeIgnoresCompareTo`. The react `ObjectChart` tier never used the removed pair: it hands its own `xAxis` / `yAxis` to `ChartRenderer`, whose `normalizeChartSchema` (`@object-ui/plugin-charts`) reads them off the chart schema directly.
  
  Migration: none inside this repository. An out-of-repo caller of either function stops compiling, and there is no replacement export, because no surface left lowers authored axis presentation. The effect on out-of-repo callers was not measured.
- 83e3f83: A node slot and `SchemaRenderer`'s `schema` prop take the union of the declared node types, `DeclaredNode` (objectui#11466).
  
  **BREAKING (TypeScript authoring face only), shipped as `minor` per this repository's version policy.** `SchemaNode` was `BaseSchema | string | number | boolean | null | undefined`, and the prop was `BaseSchema | AuthoringNode | string | null | undefined`. Both object members are now `DeclaredNode`, a new export of `@object-ui/types`: the discriminated union, keyed by the literal `type`, of
  
  - every component schema `AnySchema` declares, without its `BaseSchema` arm (whose `type` is `string`) and without `AppComponentSchema` (the app-level document, which `AppSchemaRenderer` reads structurally and `ComponentRegistry` never dispatches: as a node, `type: 'app'` is the stored page of that kind);
  - every spec-declared `AuthoringNode`;
  - every type an application declares in the new `CustomNodeRegistry` interface.
  
  There is no `type: string` arm and no index signature. What moves:
  
  - A node whose `type` no declaration names is refused, nested or at the prop: `{ type: 'card', children: [{ type: 'txt' }] }` no longer compiles. So is a value typed `BaseSchema`, which names no declared type.
  - An inline child is checked against its own type's arm wherever it is nested, so a misspelled key on a node type without an index signature (the `AuthoringNode`s, a closed `CustomNodeRegistry` entry) is refused at the slot. Node types that extend `BaseSchema` keep its index signature until objectui#8347 removes it.
  - A node's REQUIRED keys are required (a stored `home` page document needs its `label`, a `data-table` its `columns`), because no `BaseSchema` arm accepts the same literal structurally any more.
  - `app` and `list` are one arm each: `PageDocumentNode` admits every page kind but the interface-mode `list`, which `PageView` renders through `InterfaceListPage` and never hands to `SchemaRenderer`. Narrowing a `DeclaredNode` on `type === 'app'` gives `PageDocumentNode`, and on `'list'` gives `ListSchema`. `SchemaByType` reads `AnySchema` and does not move.
  - `@object-ui/core`'s schema builder takes `DeclaredNode` where it took `BaseSchema`: `.child()` / `.children()` on the grid and flex builders and the card builder's `.content()`.
  - `toRenderableSchema` (`@object-ui/react`) follows `SchemaNode` and the prop by reference.
  
  What does NOT move: every zod face (`AnyComponentSchema`, `SchemaNodeSchema`, the strict authoring face) and every runtime path. `zod/base.zod.ts` writes the node slot's zod type out through type aliases so the declared-node union can name the zod-derived `AuthoringNode`s without a circular reference; the schema objects are unchanged. `FlexBlockNode` is now an interface for the same reason, with the same members. `@object-ui/components`' `kind: 'html'` page crosses its runtime-parsed tree into `DeclaredNode` at one documented boundary, after `validateTree` reports no error; it renders exactly what it rendered.
  
  **Migration.** Annotate a node with its declared type, or with `DeclaredNode` where any node goes. Declare each type you register with `ComponentRegistry` in `CustomNodeRegistry`:
  
  ```ts
  import type { BaseSchema } from '@object-ui/types';
  
  interface MyWidgetSchema extends BaseSchema {
    type: 'my-widget';
    customProp?: string;
  }
  
  declare module '@object-ui/types' {
    interface CustomNodeRegistry {
      'my-widget': MyWidgetSchema;
    }
  }
  ```
  
  An entry joins the union under its KEY (the arm is the entry intersected with `{ type: KEY }`), so it never adds a `type: string` arm. A value built at runtime whose `type` the compiler cannot know is narrowed to a declared type, or crosses at one validated boundary, as the html-tier page does.
- 4abc0aa: The `gap` of a `stack`, a `flex` and a `grid` node is one of the steps its renderer maps.
  Any other number is refused at validation, with the set named (objectui#11474).
  
  | node | accepted `gap` steps | default |
  |---|---|---|
  | `stack` | 0, 1, 2, 3, 4, 5, 6, 8, 10 | 2 |
  | `flex` | 0, 1, 2, 3, 4, 5, 6, 7, 8 | 2 |
  | `grid` | 0, 1, 2, 3, 4, 5, 6, 8, 10, 12 | 4 |
  
  **Breaking for a `stack`, `flex` or `grid` that carries any other `gap` number.** The key
  was declared as any number, and the `flex` and `grid` descriptions advertised "Tailwind
  scale 0-8". But each renderer has one gap class per step and nothing for the rest:
  `{ "type": "stack", "gap": 7 }` and `{ "type": "flex", "properties": { "gap": 9 } }` parsed
  clean and rendered with no gap class at all, not even the default, because the default
  applies only when the key is absent. A `grid` built a gap class at runtime for such a
  number, and no compiled stylesheet defines a class built that way, so it rendered with no
  gap either.
  
  - `@object-ui/types`: `StackSchema.gap`, `FlexLayoutProps.gap` (which `FlexSchema` and the
    authored `flex` bag share) and `GridSchema.gap` are literal unions of the steps above on
    the TypeScript face, so `tsc` refuses any other number. The zod mirrors refuse one at the
    key (`invalid_value`, with the steps in the issue), with a message that lists the set. For
    `flex` that is `properties.gap`, and the flat spelling stays refused by name.
    `safeValidateSchema` (what `objectui validate` runs) and the strict authoring face both
    give that refusal. A `gap` that is not a number at all is now reported as `invalid_value`
    rather than `invalid_type`.
  - `@object-ui/components`: the `gap` input of the `stack`, `flex` and `grid` registrations
    changes from `type: 'number'` to a closed `enum` of the same steps, in the object form the
    `container` registration's `padding` already uses. In the SDUI manifest, `validateTree`
    now answers an unlisted number with `invalid-enum`. The renderers are unchanged: they do
    not round or clamp, and an absent key still renders the default step.
  - `@object-ui/core`: `GridBuilder.gap()` and `FlexBuilder.gap()` take the declared steps
    instead of any number.
  
  Migration: replace the number with the step you meant from that node's set. `0` means no
  gap.
- f560ded: **BREAKING: a percentage is scaled at the storage its field declares, never at a storage guessed from the value (objectui#11475)**
  
  `percentDisplayValue` (`@object-ui/core`) and `formatPercent`
  (`@object-ui/fields`) now take the storage as a required argument, the spec's
  `PercentScale` (`'fraction'` or `'whole'`):
  
  - FROM `percentDisplayValue(value)` TO `percentDisplayValue(value, percentScale)`.
  - FROM `formatPercent(value, precision, locale)` TO
    `formatPercent(value, percentScale, precision, locale)`.
  
  A value outside `'fraction' | 'whole'` throws a `TypeError` instead of falling
  to a branch silently.
  
  Why: the old body, `value > -1 && value < 1 ? value * 100 : value`, read neither
  the field nor its `max`. The read-only form reads the declaration, so one
  stored value read two percentages on two faces of the same record. A
  fraction-stored `1` (100%) read `100%` in the form and `1%` in the list cell. A
  whole-stored `0.5` (`max: 100`) read `0.5%` in the form and `50%` in the cell.
  
  What callers pass now:
  
  - A face holding a field reads the spec's `percentScaleOf`
    (`@objectstack/spec/data`): a `percent` field stores a fraction unless it
    declares a `max` above 1. `@object-ui/fields` adds `percentCellScale(field)`,
    the answer the percent cell reads, so every face that renders the cell's
    number for the same field reads it by reference. `PercentField` asks
    `percentScaleOf` itself instead of restating the rule, so there is one
    convention, not two equal copies.
  - A `progress` field is read as `'whole'`, and the reason is written at the
    call site. The spec's `percentScaleOf` gives no answer for `progress`, and
    its only editor, `SliderField`, stores the slider position on a `0`–`100`
    range. So a value strictly between 0 and 1 on a `progress` column now reads as
    a fraction of one percent, where the old guess multiplied it by 100.
  - A dataset measure keeps the server's `percentScale` annotation. A column the
    server does not annotate is, in the contract's words, "not a percentage". Its
    `%` pattern is then read the way numeral reads it, as a fraction. Before, it
    fell to the magnitude guess, so an unannotated `57` read `57%` and now reads
    `5700%`. Every first-party `%` measure is a ratio the server annotates, so
    none of them moves.
  
  ⚠️ The loss, stated: the legacy `ReportViewer` (`@object-ui/plugin-report`)
  draws a report column of `type: 'percent'` through the percent cell. That
  column is the report's own `ReportField`, which declares no `max`, and the
  viewer does not hydrate it from the bound object's field. So the column reads
  the spec's answer for a percent that declares nothing: a fraction. A legacy
  report over a whole-stored field now reads `50` as `5000%`. Measured at
  `6007dd4e4`: no producer in objectui or objectstack writes a `percent` column
  into a legacy report. The pre-9.0 spec bridge (`specReportToPresentation`)
  writes columns with no `type` at all, so its columns never reach the percent
  cell.
  
  Migration: pass the storage your value is in. With a field definition in hand,
  pass `percentCellScale(field)` from `@object-ui/fields` (or the spec's
  `percentScaleOf(field)` for a `percent` field). For a computed ratio, pass
  `'fraction'`. For a value already in percentage points, pass `'whole'`.
  
  `minor`, not `major`: a `major` in the fixed group would move the whole group
  off `@objectstack`'s major (AGENTS.md, version alignment). The breaking
  semantics are stated here instead of carried by the level.
- aea682a: The `columns` of a `grid` node is one of the counts its renderer maps, 1 to 12, as the bare
  number and at every breakpoint of the object form. Any other count is refused at validation,
  with the set named (objectui#11491).
  
  **Breaking for a `grid` that carries any other column count.** The key was declared as any
  number, at the bare number and at every breakpoint. But the renderer has one column class per
  count from 1 to 12 at each breakpoint and nothing for the rest, so such a count drew no column
  class where it was authored: `{ "type": "grid", "columns": 13 }` drew one column on a phone and
  two from `sm` up, and never its `md` count; `{ "columns": { "md": 13 } }` drew nothing at `md`;
  and `{ "columns": { "xs": 13 } }`, `"columns": 0` and `"columns": -1` drew two columns, a count
  nobody authored.
  
  - `@object-ui/types`: `GridSchema.columns` is the literal union of 1 to 12, or a partial
    breakpoint map of that union, on the TypeScript face, so `tsc` refuses any other count written
    as a literal (a computed `Record<string, number>` still assigns, as it did for keys since
    objectui#8505; the mirror judges its counts). The zod mirror refuses one at
    `columns` as an `invalid_union` whose message lists the set; its arms carry the set as
    `values`, at the breakpoint's own path for the object form. `safeValidateSchema` (what
    `objectui validate` runs) and the strict authoring face both give that refusal. An unknown
    breakpoint key is still reported on its own, as `unrecognized_keys`.
  - `@object-ui/components`: the `grid` registration's `columns`, `smColumns`, `mdColumns`,
    `lgColumns` and `xlColumns` inputs change from `type: 'number'` to a closed `enum` of the
    twelve counts, in the object form the `container` registration's `padding` uses. `columns`
    also publishes the breakpoint object the declaration takes, as an `object` arm whose members
    (`of`) are the same list. In the SDUI manifest, `validateTree` now answers `smColumns: 13` with
    `invalid-enum`, `columns: 13` with an error-level `type-mismatch` that lists the counts, and
    `columns: { md: 13 }` with `member-type-mismatch`. A breakpoint object of mapped counts, which
    drew a `type-mismatch` warning there, is now accepted, as both declaration faces already
    accepted it. The renderer no longer draws `grid-cols-2` for a base count it does not map:
    every count a validated document can carry is mapped, and an unmapped one that reaches it
    unvalidated draws no base column class, as at every other breakpoint. Nothing rounds or
    clamps.
  - `@object-ui/core`: `GridBuilder.columns()` takes the declared counts instead of any number.
  
  Migration: replace the count with the one you meant, from 1 to 12. For a grid with no columns
  at a breakpoint, leave that breakpoint out; for a single column, write `1`.
  
  ⚠️ **Dated note, 2026-10-02 — `grid` has no flat column inputs any more — objectui#11505.** At this change the `grid` registration published `smColumns`, `mdColumns`, `lgColumns` and `xlColumns` as closed enums of the twelve counts, and `validateTree` answered `smColumns: 13` with `invalid-enum`. Now the registration publishes `columns` as its only column input, the renderer no longer reads the four keys, both zod faces refuse them by name, and `validateTree` answers each with an `unknown-prop` warning. A per-breakpoint count is a member of the `columns` object, which this entry's closed set still governs. `.changeset/11505-grid-flat-columns-retired.md` states what ships. The rest of this entry is kept as the reading of this change.
- 64dae8e: Six user-visible fixes across the maker surface, the assistant rail and the
  dataset captions.
  
  **The maker's start chips now promise only what ADR-0112 v1 builds
  (cloud#1984).** Two of the five asked for automation the first version has no
  flows or actions for — the ticket chip said 「状态流转」, the inventory chip said
  「低库存预警」 — and the measured behaviour was not a refusal but a silent
  degrade: a status kanban and a low-stock view. The chip promised an alert and
  delivered a page. All five are reworded in all ten packs (and in the call-site
  `defaultValue` fallbacks, which are a second copy of the same strings) to ask
  for objects, fields, views, pages, dashboards and sample data, keeping each a
  real business scenario — the ticket chip now asks for a status field and a board
  grouped by it, the inventory chip for a view that filters below the reorder
  point. A note beside the keys says to revert when v2 re-adds flows.
  
  **Five newer AI tools get their step labels (objectui#7481).** A zh conversation
  read `✓ Get authoring rules 已完成` between 「读取元数据结构」 and 「列出对象」:
  `get_authoring_rules` (cloud#1837), plus `load_tools`, `open_record`,
  `test_flow` and `toggle_flow`, are registered by the cloud AI runtime but are
  newer than the pinned spec's tool registry, so they had no `chatbot.tool.*`
  entry in any pack and fell through to the English title-caser.
  
  **The assistant rail follows the thread when you send (objectui#7480).** The
  rail and the full-page maker are the same component; what differs is width. A
  reply that still ends on screen in the wide column runs two or three times
  taller in a ~360px rail, so `StickToBottom`'s lock is escaped by the time the
  user types and the new bubble, the tool steps and the streaming answer all land
  below the fold. Every send path now re-arms the lock — including the plan-card
  "Build it" and 确认修改 approvals, whose own code comments already named this
  miss. Message APPENDS deliberately do not, so a user reading back through the
  thread mid-answer is never yanked to the bottom.
  
  **Console toasts move off the assistant composer (objectui#7482).** 「客户更新
  成功」 sat on the ChatDock composer's send button and stayed there. One defect,
  two symptoms: `apps/console` pinned the toaster to `bottom-right` — an override
  that predates ADR-0057 P3a — so a toast both covered the button and, because
  sonner pauses a toast's dismiss timer while the pointer is inside the toaster
  region, never got to run its 4s timer with a pointer resting on the composer
  underneath. The override is gone; the console takes `ConsoleToaster`'s own
  documented top-right anchor, and the 4s success duration is now pinned.
  
  **Built-in aggregate captions follow the locale everywhere (objectui#7534).**
  objectui#7258 taught `buildChartSeries()` to resolve a server-minted default
  measure through the locale map, so a chart legend read `计数` while the table
  beneath it, the KPI caption, the pivot header and the dataset preview still
  printed the server's hard-coded English `Count`. `buildDatasetFieldHelpers()`
  takes the same optional `builtinAggregateLabels`, resolving through the one
  `resolveMeasureLabel` order, and the five call sites pass it. Omitting the
  argument reproduces the previous output byte for byte, and an author-declared
  measure still keeps its own label verbatim (objectui#4106).
  
  **The activity feed stops asking for an object the environment does not have
  (objectui#7476).** A tenant environment has no `sys_activity`, so every page
  load issued a request that 404'd. Everything downstream was already correct —
  the adapter memoizes the missing collection, its logger demotes the failure, the
  feed retires as an ANSWER and the panel renders its earned empty state — so what
  is left is the request itself, and `data-objectstack` states the rule for it:
  the cure for a doomed request is not issuing it. New `useObjectPresence` reads
  the object registry the shell loads for the nav anyway; only a registry that has
  ANSWERED and lists other objects without this one skips the read. Every
  uncertainty — no provider, empty registry, still loading, errored — reads as
  before, because a wrong skip would cost a real deployment its feed.
- 9cebfca: feat: an action's `visible` / `disabled` predicate can ask `current_user.can(object, verb)` — the caller's object permissions, from the payload the built-in Edit / Delete buttons are already gated by
  
  A custom action that replaces a built-in CRUD button — a logical delete that archives
  instead of deleting, say — can now carry the same gate the built-in button had:
  
  ```yaml
  visible: current_user.can('account', 'delete')
  ```
  
  It answers from the signed-in user's `/auth/me/permissions` payload once that payload
  has loaded, on the record header and the row menu alike. Until then it gives no answer:
  the predicate faults, and a surface that evaluates `visible` fail-closed does not render
  the action. The `user` / `ctx.user` / `os.user` aliases are the same call.
  
  This is client-side UI gating only. It decides whether the button is shown; the server
  still enforces object permissions on the request the action sends and answers 403 when
  they are not held.
  
  - `@object-ui/permissions`: the permission context carries `effectiveObjects`, the
    response's `objects` map verbatim (`undefined` when the provider holds no such
    response — the role-based `PermissionProvider`, or no provider at all).
  - `@object-ui/core`: `evalFieldPredicate` hands the acting subject's permissions to the
    CEL engine as `EvalContext.permissions`; `bindSubjectPermissions` /
    `subjectPermissionsOf` are the carrier. `@objectstack/formula` is now required at
    `^17.5.0`, the first release that answers `can`.
  - `@object-ui/app-shell`: `ExpressionProvider` binds the map into the predicate scope it
    publishes only while `usePermissions().isLoaded` is true, and the record-form field
    evaluators take the same input, so one predicate answers the same everywhere.
- 053fdc8: Console half of `ActionSchema.onSuccess` post-success navigation.
  
  `@objectstack/spec` declares `onSuccess` as a closed strict object
  `{ navigate: string, openIn: 'self' | 'newTab' }`, refine-scoped to `type: 'api'` and
  `type: 'script'` — the two action types whose success event carries a server response.
  Nothing in this renderer read it, so an action declaring the hop navigated nowhere: the
  block fell into `ActionRunner`'s older `ActionDef.onSuccess` chained-callback channel,
  was dispatched as an action, and failed inside `executeNavigation` with "No URL provided
  for navigation action" — a red toast and no jump. The motivating report is a clone action
  that leaves the user sitting on the record they cloned from.
  
  `ActionRunner.handlePostExecution` now performs the declared hop through
  `navigationHandler` — the same SPA seam every other navigator in that file uses, which
  the console wires to react-router's `navigate`, so `openIn: 'self'` is a real in-place
  route hop rather than a full-page load. `interpolateTarget` gains a `${result.*}` scope
  alongside `${param.*}` and `${ctx.*}`, resolved against the handler's own return value
  (the level `readActionPayload` reads, one below the action envelope) and supplied only by
  this call site, so a target interpolated before its request still has no `result` to
  name. `openIn` is read as the one member that changes the branch and no default is
  written here — the spec materialises `.default('self')`, so parse output always carries a
  resolved member — and the two `openIn` spellings stay apart: this reads
  `onSuccess.openIn` (`'self' | 'newTab'`), never the top-level `type: 'url'` switch
  (`'self' | 'new-tab'`), each of which spec refuses in the other's position.
  
  The console's server-action wrapper gains the matching handler-return half: a handler may
  now return `openIn: 'self'` next to its `redirectUrl` to ask for the same-tab jump, while
  a `redirectUrl` **without** `openIn` keeps its shipped new-tab behaviour unchanged. When
  an action declares an `onSuccess` block, the wrapper defers to the runner and only tidies
  its pre-opened tab, so one navigation happens rather than two.
  
  The pre-existing `ActionDef.onSuccess` chained-callback channel is unchanged. It is told
  apart by the spec's own declaration — a non-array object whose `navigate` is a string —
  and keeps running for every other shape.
- 490d9a9: Grid headers offer a sort click only on columns the PLATFORM says it will order by
  (objectui#5729 — the consumer leg of objectstack#10235, maintainer ruling A, 2026-08-23:
  the platform serves an explicit per-column sortability signal and the grid reads it,
  rather than re-deriving "virtual ⇒ unsortable" from field type).
  
  `GET /api/v1/meta/object/:name` now answers with a `sortability` projection on its
  ENVELOPE — `{ fields: { [name]: { sortable, reason?, caveat? } } }`, computed at serve
  time from the platform's own storage predicates, deliberately beside `item` rather than
  inside it so the key stays un-authorable. The signal was reaching the browser and being
  discarded one line before its only consumer: `ObjectStackAdapter.getObjectSchema` unwraps
  the envelope to `item`, so every UI reader saw a document with no signal on it. It now
  survives that unwrap, carried on the schema under a symbol key — invisible to
  `JSON.stringify`, to `Object.keys` and to a spread, so a schema handed back at a metadata
  write endpoint can never take it into a body the server parses strictly.
  
  `@object-ui/core` gains the one spelling of the consumer contract:
  `isPlatformSortableField(projection, name)` is `true` iff an entry EXISTS for the name and
  says `sortable: true`. Absence is a refusal — it is how the platform encodes an unknown
  name, a dotted path and an unprovisioned audit column, all three of which the runtime
  doors reject — so the `!== false` spelling every other optional flag in this repo uses
  would get exactly that family backwards. A projection that is absent ALTOGETHER is a
  different question with a different answer (`undefined`: no signal was served) and is
  typed apart from an empty one, so a deployment older than the upstream change keeps the
  behaviour it had rather than being told, falsely, that nothing on the object is sortable.
  
  Three things follow in the grid. The header click on a refused column ceases to exist, so
  neither the old silent-unordered result nor the `400 INVALID_SORT` that replaced it is
  reachable from it. A sort PERSISTED before the signal existed is filtered out of both what
  the grid renders and what it emits, so a restored personalization cannot ride back into
  the next `persistViewPatch({ sort })` — the half-fix where the affordance is gone and the
  PUT still fires. And the relational carve-out is untouched and deliberately not delegated
  to this signal: the platform answers `sortable: true` for a `lookup` (it has a stored
  foreign key and both runtime doors accept ordering by it), while the grid withholds that
  header for a different reason — a column of names ordered by an invisible id.
  
  Columns carrying `caveat: 'unprovisioned-anchor'` keep their click. The runtime accepts
  those sorts; refusing what the platform does not refuse would recreate declared-≠-enforced
  drift in mirror image.
- 2c3cd1b: BREAKING (`@object-ui/core`): `ActionRunner`'s legacy `ActionDef.onSuccess`
  chained-callback channel is retired — `onSuccess` now has exactly the meaning the
  contract declares (objectui#5934, maintainer ruling 2026-08-31).
  
  (The bump is `minor` by this repo's release model — objectui's major is pinned to
  the `@objectstack` family major, and its own breaking changes ship as `minor` with
  the break spelled out here, per `scripts/check-changeset-no-major.mjs`. This
  paragraph is that spelling-out: the break below is real and consumer-visible.)
  
  - **What breaks, by specifier**: `import type { ActionDef } from '@object-ui/core'` —
    `ActionDef['onSuccess']` was `ActionDef | ActionDef[]` (chained callbacks the runner
    dispatched through `executeChain` after a success). It is now derived from the pinned
    spec: `ActionSchema.onSuccess`'s closed strict `{ navigate: string, openIn?: 'self' |
    'newTab' }` block. Code that assigned a callback `ActionDef` (or an array of them) to
    `onSuccess` no longer compiles, and at runtime a callback-shaped value gets NO reading —
    no handler dispatch, no navigation, the action's own result untouched. `onFailure` is NOT
    changed: the spec declares no such key, so it keeps its one runner-native meaning.
  - **Why this is safe to take**: the channel was unreachable from validated metadata —
    `@objectstack/spec` (17.2.0 pin) strict-refuses a callback shape inside `onSuccess` at
    parse (`invalid_type` on `navigate` + `unrecognized_keys`), so no published/saved
    metadata could ever carry one — and a producer census with a positive control found zero
    producers outside the channel's own test pins. Migration for an out-of-repo consumer that
    drove the channel programmatically: put the follow-up actions in `chain` (the runner's
    declared chaining key, unchanged), or author the spec's `onSuccess` navigation block.
  - `@object-ui/types` (minor): `UIActionSchema` now declares `onSuccess`, derived from the
    spec's `ActionSchema.onSuccess` — the renderer view spells the key the four action
    surfaces forward, so the forwards type-check.
  - `@object-ui/components` (patch): the four action renderers forward `onSuccess` without
    the `as any` casts (no behavior change — same key, same value, now typed).
- 44d075b: `ComponentMeta` at the registry is now DERIVED from the one declaration in
  `@object-ui/types` instead of restating it, and `tags` / `description` reach the
  registration surface (objectui#6067).
  
  ## The convergence
  
  `packages/core/src/registry/Registry.ts` declared its own `ComponentMeta`: thirteen
  keys, of which nine were restated from `@object-ui/types`' `base.ts`, four were
  registry-only (`tier`, `namespace`, `skipFallback`, `labelling`), and `tags` /
  `description` were **absent** — although both are declared on the canonical type and on
  the `ComponentMetaSchema` zod mirror. Two of the three authorities agreed and the
  registration surface did not, so those two keys were unwritable at exactly the
  declaration most component registrations import. That is the same two-key delta
  objectui#5893 had just closed inside `@object-ui/types`, arriving a third time on a
  third declaration, and objectui#5671 had already made the identical move for the sibling
  type `ComponentInput` in this very file.
  
  It is now:
  
  ```ts
  export type RegistryComponentMetaExtras = {
    tier?: 'public' | 'internal';
    namespace?: string;
    skipFallback?: boolean;
    labelling?: 'control' | 'group' | 'display';
  };
  
  export type ComponentMeta = CanonicalComponentMeta & RegistryComponentMetaExtras;
  ```
  
  `RegistryComponentMetaExtras` is newly exported from `@object-ui/core`.
  
  **What changes for a consumer: `tags` and `description` become writable on the registry's
  `ComponentMeta`. Nothing narrows.** No key is removed, no key is renamed, and no key's
  type changes, so no existing registration stops compiling — verified by type-checking all
  37 workspace consumers of `@object-ui/core` (`pnpm --filter '...@object-ui/core'`), which
  is why this is a widening rather than the contract break a rename would have been. All
  four registry-only keys have live consumers, and they are still declared here.
  
  This is `minor` under this repository's policy that its own breaking changes never declare
  `major` (`scripts/check-changeset-no-major.mjs`); nothing here is breaking in any case.
  
  ## Converge rather than rename, and why the four keys did not move
  
  The alternative dispositions were to rename the type so the name stops claiming a mirror,
  or to move the four registry keys onto `@object-ui/types`' `ComponentMeta` and re-export
  it outright the way objectui#5671 handled `ComponentInput`.
  
  Renaming was rejected because it cannot be done without a break: `@object-ui/core` is
  published, `ComponentMeta` is exported from it, and dropping the name would break every
  external consumer — while keeping it as an alias would leave the mirror claim standing
  under a second spelling, which fixes nothing.
  
  Moving the four keys was rejected because `skipFallback` and `namespace` are registration
  mechanics — they describe how the registry keys an entry, not what a component is — and
  `@object-ui/types`' `ComponentMeta` is the general, plugin-facing, AI-facing type. The
  extension keeps them where they are read, under their own named type, while the eleven
  shared members exist in exactly one place and can no longer drift.
  
  ## Pinned by key set, not by assignability
  
  Every member of both shapes is optional, so `extends` is mutually **true** across the
  diverged pair — an assignability assertion is green on the defect and would not have
  caught it. Measured on the emitted `.d.ts` of both packages, before and after:
  
  | reading | before | after |
  |---|---|---|
  | `Core extends Canonical` | `true` | `true` |
  | `Canonical extends Core` | `true` | `true` |
  | `Exclude<keyof Canonical, keyof Core>` | `"tags" \| "description"` | `never` |
  | `Exclude<keyof Core, keyof Canonical>` | the four registry keys | the four registry keys |
  
  The new pin asserts the third row and names the fourth explicitly; the assignability pair
  is kept beside it, labelled, as the control that shows what it cannot see. A source-level
  assertion that the canonical members are not restated locally covers the remaining failure
  mode — a member-identical copy, which every `keyof` comparison stays green on and which is
  how the copy this replaces began.
- 06b82b8: An action param that declares the spec's `carryOver` is shown read-only and submitted verbatim (objectui#6246)
  
  `@objectstack/spec`'s `ActionParamSchema.carryOver` says a param's value is
  carried through the action dialog rather than collected: seeded from the row
  (`defaultFromRow: true` is required beside it), shown as a non-editable summary,
  and submitted unchanged. The console dropped the key: `resolveActionParam()`
  builds its output key by key and never copied it, so the dialog rendered every
  such param as an ordinary editable field. The permission-set Clone action
  declares it on its five JSON permission facets, so each of them — row-level
  security among them — was a prefilled JSON textarea, and a hand edit that was
  still valid JSON produced a clone granting more than its base.
  
  - `@object-ui/core`: `ActionParamDef` gains `carryOver?: boolean`.
  - `@object-ui/app-shell`: the resolver copies `carryOver` on all three of its
    branches; `ActionParamDialog` renders a declared carry-over as a collapsed
    read-only summary and builds no field widget for it at all; and
    `serializeParamValues` leaves a carry-over value untouched, even on an upload
    field. The action designer's dialog preview draws a carry-over param as the
    same read-only line instead of its field's input.
  - `@object-ui/i18n`: one new key, `actionDialog.carryOverHint`, in all ten packs.
  
  Params that do not declare the key render and submit exactly as before.
- 8f1d995: `ComponentConfig` now has one authority: `@object-ui/types` declares it, `@object-ui/core` re-exports it
  
  `@object-ui/types` and `@object-ui/core` each published a declaration of
  `ComponentConfig`, so an auto-import picked between two different types by
  alphabetical order. After the `ComponentMeta` convergence the remaining
  difference was genericity and the `component` slot: `@object-ui/types`' was
  non-generic with `component: any`, core's was `<T = any>` with
  `component: ComponentRenderer<T>`.
  
  `@object-ui/types`' declaration gains that type parameter, **defaulted**, so
  every existing spelling keeps its meaning exactly — bare `ComponentConfig` is
  `ComponentConfig<any>`, whose `component` is `any`, as before. `@object-ui/core`
  re-exports it instead of declaring its own.
  
  The registry-only keys (`tier`, `namespace`, `skipFallback`, `labelling`,
  `deprecated`) were not dropped: they moved to a named extension,
  `RegistryComponentConfig`, which is what `Registry.getConfig`,
  `getAllConfigs` and `getNamespaceComponents` return. Those return values are
  type-identical to what they returned before, so every read path is unchanged.
  
  **Breaking:** a consumer that imports `ComponentConfig` from `@object-ui/core`
  *and* touches one of those five registry-only keys through that annotation must
  switch the annotation to `RegistryComponentConfig` — the name `ComponentConfig`
  no longer carries them there. Filed `minor` rather than `major` per AGENTS.md's
  versioning policy: objectui's own breaking changes ship as `minor` with the break
  spelled out here, because the whole publishable set is one changeset `fixed` group
  pinned to `@objectstack`'s major.
- 7977ff9: Component deprecation is now DECLARED, not just warned about (objectui#6674).
  
  A deprecated component type used to be stated in exactly two places, neither of
  which a gate, a test or a type can consult: a `console.warn` string literal
  inside the renderer, and the word "(Deprecated)" inside a human-readable
  `label`. Both gates that touch component types ask a different question —
  whether the type RESOLVES — and a deprecated type resolves, which is how one
  could be authored 85 times across 27 shipped exemplars with every check green.
  
  - `@object-ui/core` gains `ComponentDeprecation` / `AuthoringSurface` and the
    `deprecated` key on the registration metadata, plus
    `ComponentRegistry.deprecationFor(type, surface)` to read it back. The
    declaration carries the SURFACES it applies to rather than being a boolean:
    `div` and `span` are deprecated on the JSON authoring surface and are at the
    same time permanent vocabulary of the `kind:'html'` tier, so a bare flag would
    be false for one of its two readers.
  - `@object-ui/components` marks `div` and `span` with the declaration their
    console notices already state. Nothing new is deprecated and no build starts
    failing: the catalog ratchet keeps the existing stock frozen, and draining it
    stays objectui#3965's worklist.
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
- 2acd8e1: **BREAKING (authoring surface): `body` is no longer a child-list key. Author `children`.**
  
  `BaseSchema` declared two spellings of one concept — `body` and `children` — and left the
  choice per component. **Thirteen** registrations read `body` and nothing else, so it was
  their ONLY door — the twelve the ruling enumerated plus `tooltip`, which it did not, and
  which is the count the committed instrument carries (`BODY_ONLY` plus
  `BODY_ONLY_UNRULED` in `scripts/body-dialect-census.mjs`). `div`, `card`, `page`,
  `button`, `aspect-ratio`, the seven sectioning tags and the safe-HTML tag factory read
  `children || body` and took either. The authoring tier only ever knew `children`, so
  an author writing the one spelling that resolved got `unknown-prop` — the same warning a
  typo draws, on the tier built to accept AI-authored pages, where the diagnostic **is** the
  contract (objectui#6771).
  
  Ruled 2026-09-01: one concept, one spelling, and the spelling is `children`.
  
  ## What changed
  
  - **Renderers.** `alert`, `badge`, `tooltip` and the `sidebar-*` family read `children`.
    Every `children || body` fallback drops its `body` arm **except the four `page:*`
    reads named below** — `div`, `card`, `button`, `aspect-ratio`, the sectioning tags,
    the safe-HTML tag factory behind ~36 tags, `page`'s flat content list, and
    `@object-ui/core`'s recursive `validateSchema`.
  - **Item-level `body` is a DIFFERENT key and is untouched.** At this change, `list`
    draws each entry as `item.content || renderChildren(item.body)` and `tabs` as
    `item.content || item.body`, both filed under the ITEM type rather than the node,
    and `tabs` still ships `body` inside its own `defaultProps`. ⛔ Neither is this
    spelling and neither is refused here: the node-level retirement does not reach a
    member of a declared `items` array. Retiring the item-level dialect is
    objectui#9590's card, and the two named above are recorded on it.
    ⚠️ **Dated note, 2026-09-25 — neither half of this bullet holds any longer — objectui#9590.**
    objectui#9941 respelled the `tabs` `defaultProps` items to `content`, and
    objectui#9590 retired both item-level reads: a `list` item and a `tabs` item draw
    `content` and nothing else, and both item faces now refuse `body` by name,
    pointing at `content`. The rest of this bullet is kept as the reading of this change.
  - **What still reads `body` at NODE level, and why.** Four renderer reads, all `page:*`: `page:card`
    (renderer and Studio canvas) and the three thin `page:section` / `page:footer` /
    `page:sidebar` containers. ⛔ Authoring the key is refused on them as it is
    everywhere else; only the READ survives, for documents already STORED under it.
    `@objectstack/spec` states the ground on `PageContainerProps` itself: «The renderers
    keep reading `body` as a back-compat fallback for stored documents; that fallback is
    objectui's to retire on its own schedule, and it is not a second authorable
    spelling.» ⚠️ What separates the two halves is a CONVERSION, not a ground: the spec's
    registry carries `page-card-body-to-children` (`toMajor: 17`, surface
    `page.component.page:card.body`, shipped `retiredFromLoadPath: true` in spec 17.0.0)
    and carries none for the other three — so a stored row under their key has no
    migration path at all. Nothing in this repository authors any of them, and the
    committed census over those keys is how to see that rather than take it on trust:
    `node scripts/body-dialect-census.mjs --keys page:section,page:footer,page:sidebar,page:card,card`.
    ⚠️ This sentence used to restate that table's answer instead of pointing at it, and
    the very commit that edited the sentence moved the figure — a count copied into prose
    is what AGENTS.md #9 forbids, so the instrument replaces the number. Read the table
    for three things: `card` + `body` is a control that FIRES on the head that ships (so
    a zero elsewhere is a reading, not a blind spot), every node still carrying `body`
    under these keys falls in the `test` bucket, and `page:section` is a LIT zero — 6
    nodes resolved, 0 `body`, 4 `children` — rather than a key nobody asked about.
    Retiring the THREE THIN reads is objectui#9916,
    which asks for the stored-corpus reading they turn on; `page:card`'s read is not
    that card's either — it is objectui's own, grounded by objectstack#5775 /
    ADR-0087 D2 rather than owned by it, and it ends when the stored rows have been
    replayed through the conversion that already shipped for it.
  - **The published type.** `BaseSchema.body` is `never` on the TypeScript face and an
    alias refusal naming `children` on the Zod mirror, as are the four per-component
    redeclarations (`CardSchema`, `AspectRatioSchema`, `PageNodeSchema`, `TooltipSchema`).
    ⚠️ Refused **by name**, not deleted: `BaseSchema` carries an index signature and the
    mirror ends `.passthrough()`, so a deleted member would be accepted silently and
    rendered by nothing — the exact silence this retirement ends.
  - **The VS Code extension (`object-ui`) changes behaviour, not just teaching.** Its
    preview no longer draws a `body`-spelled document — the node renders empty, the way
    the runtime renders it — and its validator now emits a warning naming `children` at
    the key's own position. That warning is skipped for node types that declare their
    own `body` input (`record:alert`), so a declared translation-map `body` is not
    reported as the retired spelling.
  - **Two new `@object-ui/sdui-parser` exports.** `RETIRED_CHILD_LIST_KEY` (the retired
    spelling, so a consumer names it once) and `checkRetiredBodyDialect` (the diagnostic
    the tier substitutes for `unknown-prop` on that key).
  - **The authoring tier.** `sdui-parser` answers an authored `body` with the replacement
    named, instead of the bare "has no prop" every typo gets — and a `body` child list
    under a non-container draws the same containment code the `children` spelling draws.
  - **Corpus and teaching, in the same change.** 114 authored nodes across the docs site,
    the schema catalog, five package READMEs and the VS Code extension's snippets, JSON
    schema, syntax map, hovers and completions. The platform does not refuse a spelling it
    still ships.
  
  ## Migrating
  
  Rename the key. `{ "type": "card", "body": [...] }` becomes
  `{ "type": "card", "children": [...] }`; both faces now name `children` in the refusal,
  and `pnpm census:body-dialect` reports where the dialect still lives in a tree.
  
  ⚠️ **Four renderer reads are deliberately untouched, all in the `page:*` namespace** —
  `page:card` and the three thin `page:section` / `page:footer` / `page:sidebar`
  containers. They are read-only back-compat paths for STORED documents, not a second
  authoring face: `@objectstack/spec`'s `PageContainerProps` says so itself — `children`
  is canonical, `body` is deliberately not declared, and «the renderers keep reading
  `body` as a back-compat fallback for stored documents; that fallback is objectui's to
  retire on its own schedule».
  
  ⛔ **Authoring `body` on them is still refused**, on both published faces and at the
  authoring tier, exactly as everywhere else. What survives is the READ.
  
  ⚠️ The two halves are not in the same state. `page:card` has a migration path — the
  spec's conversions registry carries `page-card-body-to-children` (`toMajor: 17`,
  surface `page.component.page:card.body`), which shipped with `retiredFromLoadPath: true`
  in spec 17.0.0. The other three have **no conversion at all**, so a stored row under
  their key has nowhere to be migrated to. ⇒ the two halves are tracked separately, and
  the pointer is not one card: retiring the three thin reads is objectui#9916, whose
  question is the stored corpus; retiring `page:card`'s read was **grounded by**
  objectstack#5775 / ADR-0087 D2, whose conversion has already shipped and whose
  remaining condition is replayed rows. ⚠️ Grounded by, not owned by — the distinction
  is the point. objectstack#5775 is CLOSED and its body is a props-declaration audit
  that carries no such step, so a reader sent there for the action finds none. The
  action is objectui's, on the spec's own terms quoted above: «that fallback is
  objectui's to retire on its own schedule.»
  
  **Non-rendering readers keep their arm on the same rule**, and none of them renders
  anything: while a renderer still reaches stored `body` content, a reader that must see
  the SAME content keeps its arm, or the renderer draws what the reader cannot find.
  Those are the two tab-subtree walkers in `renderers/layout/containers.tsx`,
  `app-shell`'s `pageSchemaIntrospect` (`CONTAINER_KEYS`) and `PageBlockInspector`
  (`STRUCTURAL_PROP_KEYS`, the inspector half of a stored `properties.body`), and the
  CLI's `OBJECTUI_STRUCTURAL_KEYS` — a file-IDENTIFICATION marker, where keeping `body` is
  what lets an old file still be recognised as an ObjectUI node and therefore refused,
  instead of silently not judged.
  
  ⚠️ **Dated note, 2026-10-02 — the `sidebar-*` parts are retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2d) unregistered the ten `sidebar-*` part keys. Of the
  family the **Renderers** line names, only `sidebar` remains, and it reads `children`. The rest of this entry is
  kept as the reading of this change.
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
- a2d2515: `extractRecords` reads a `find()` answer as `QueryResult` declares it: the
  `records` arm is gone (objectui#6839, following objectui#5945 / #6726 / #6840).
  
  `QueryResult` (`@object-ui/types`) declares exactly one rows member, `data`.
  This shared normaliser's ladder was `array -> records -> data -> value`, i.e.
  the undeclared spelling AHEAD of the contract's own member — the same
  precedence inversion objectui#5945 was filed about and objectui#6726 repaired by
  hand at seven other seams. The ladder is now `array -> data -> value`.
  
  `records` is the below-the-adapter spelling: `ObjectStackAdapter
  .normalizeQueryResult` and `ApiDataSource.normalizeQueryResult` (its
  `['data','items','results','records','value']` envelope loop) both CONSUME the
  server/SDK `records` envelope and return `data` before an answer reaches this
  helper, and every consumer calls it strictly above that fold. So no producer
  changes behaviour, because there is no producer; what changes is that a
  non-conforming one is refused instead of silently absorbed — and, being first,
  the arm used to outrank `data` when a producer emitted both.
  
  Reach, re-derived on this tree rather than taken from the card (which was
  measured six days before filing and is stale in three places): ten call sites in
  nine packages. Seven call `extractRecords` directly — `ObjectChart` (x2: the
  chart rows, and the group-by lookup label domain inside the exported
  `resolveGroupByLabels`), `ObjectDataTable`, `ObjectPivotTable`, `ObjectGantt`
  (the quick-filter option domain), `ObjectKanban`, `ObjectTimeline`. Four more
  reach it through `applyNonGridRowCeiling` (`@object-ui/react`), which is itself
  a published export and a sink in its own right: `ObjectCalendar`, `ObjectGantt`
  (its rows), `ObjectMap`, `ObjectTree`.
  
  Producer measurement, per consumer rather than once for all of them: no `find()`
  in any of those nine packages, nor in the apps and examples that mount them,
  emits a `records` envelope. CONTROL, so the zero is a reading rather than a
  miss — the same sweep finds `records` envelopes elsewhere: `ViewDataProvider`'s
  own `ResolvedData` (served by that module's own private reader of the same
  name), the raw Cloud HTTP payloads, the client-SDK doubles below
  `normalizeQueryResult`, the record-visibility batch route stubs, and one live
  `find()` double at `plugin-list`'s ObjectGallery — a consumer with its OWN
  unwrap ladder, which does not come through here and is untouched.
  
  The `value` arm STAYS. objectui#6840 removed `value` from `ObjectView`'s ladder
  on a measured zero at that seam and stated that its zero must not transfer here;
  it does not. Five `find()` doubles emit `{ value: [...] }` into this helper
  today (three in `plugin-kanban`, two in `plugin-calendar`), so the arm is live
  and its removal is a separate card with its own measurement.
  
  `QueryResult` is NOT widened to bless `records` — that is a published-type
  change and the maintainer's call, the same floor objectui#6726 and #6840
  respected.
  
  One refusal pin per module (`*.contractEnvelope-6839.*`), each keeping the live
  arms green alongside the deleted one, because live and dead is the whole
  distinction — plus a direct pin on the helper for the precedence question a
  per-module render pin cannot ask ("when BOTH keys are present, which wins").
- 3619792: Curate `box` in `PUBLIC_BLOCKS` Tier B, so `getPublicConfigs()` offers the neutral block container the catalog already teaches.
  
  `box` was minted as the JSON authoring surface's class-transparent replacement for the deprecated `div` and landed on every declaration face — the `BoxSchema` interface, its zod mirror, `SchemaRegistry`, the registration in `@object-ui/components`, a docs page and 27 catalog fixtures. The curated contract was the one face it missed, so the published `sdui.manifest.json` and `sdui-intrinsics.d.ts` (both generated from `getPublicConfigs()`) omitted a type the vocabulary teaches. Authoring `box` still validated — `page.tsx` builds the JSX-page compiler's manifest from the registry, not from this roster — but a model reading the curated vocabulary could not learn it.
  
  No spec entry was needed: `@objectstack/spec` describes no Tier B layout primitive, so `box` joins `flex` / `grid` / `stack` / `card` / `container` in a population the `registry-inputs-spec-parity` gate has never judged. Measured before the roster was touched, and pinned in `apps/console` over a population derived from the zod layout union rather than restated as a list, so the next minted layout container fails by absence instead of repeating this.
- 47547d0: Localize the server's built-in aggregate measure titles on dataset charts
  (objectui#7258 — consumer half of the objectstack#14492 contract; maintainer
  ruling B, 2026-09-02).
  
  A dataset-bound chart's aggregate axis / legend title read the analytics
  service's hard-coded English `Count` on a zh console whose category labels were
  already Chinese. The renderer was passing `fields[].label` through verbatim —
  correctly, for an author-declared measure (objectui#4106) — and had no way to
  tell the server's built-in default apart from an author's label.
  
  The wire now can: `AnalyticsResult.fields[]` gains an OPTIONAL structural
  discriminator, `builtinAggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max' |
  'count_distinct'`, populated only on the server-side built-in defaults
  (objectstack#14492). This change is the consumer side of that contract:
  
  - `@object-ui/core`: `buildChartSeries` now accepts `ChartMeasureField[]` —
    `ChartResultField` plus the optional `builtinAggregate` carrier
    (`BuiltinAggregateCarrier`), declared beside the renderer shape rather than
    on it because the spec this release is built against does not carry the key
    yet; new `BUILTIN_AGGREGATES` / `BuiltinAggregate` / `isBuiltinAggregate` /
    `resolveMeasureLabel`; `ChartSeriesOptions.builtinAggregateLabels` carries
    the locale strings in (core stays React-free and i18n-free — the same
    division as `nullCategoryLabel`). A field carrying a recognised
    discriminator resolves through that map; every other field keeps its wire
    `label` verbatim — never by matching the label's text or the field's name
    (the rejected option A).
  - `@object-ui/i18n`: `builtinAggregateLabels(tt)` resolves the six strings
    through the existing `report.aggregate.*` keys (zh already carried 计数 /
    求和 / 平均 / …; all ten packs are pinned to cover the vocabulary).
  - `plugin-charts` (`ObjectChart`), `plugin-dashboard` (`DatasetWidget`),
    `plugin-report` (`DatasetReportRenderer`): pass the resolved map to
    `buildChartSeries`.
  
  Before: 合作中 / 已流失 / 潜在 under an axis titled `Count`. After: the same
  chart titled `计数`; an `en` session still reads `Count`; an author-labelled
  measure (`Tasks`) and a measure literally named `count` without the
  discriminator are byte-for-byte unchanged. Until the upstream field is
  populated the wire carries no discriminator and every chart renders exactly as
  before.
- cfc9b6d: A filter on a record page can now be scoped to the record the page shows (objectui#7297). Write `{record_id}` as a filter value, for example `{ "assignee": "{record_id}" }` on an `element:number` counting tasks, and on a `type: 'record'` page it resolves to the id of the record in view: on one person's page the number is that person's count, and on the next person's page it is theirs. It works in a component's own `filter` and in its component-level `dataSource.filter`, on every data component that resolves its filter through `@object-ui/react`'s `useFilterScope()`. The token is declared by `@objectstack/spec` 17.5.0 (`RECORD_CONTEXT_TOKENS`, objectstack-ai/objectstack#20003).
  
  The id comes from the record page's mounted record context, never from a URL parameter or a page variable. `@object-ui/react`'s `useFilterScope()` adds it to the scope it returns (as the new optional `recordId` member of `@object-ui/core`'s `FilterTokenScope`) whenever a `RecordContextProvider` is mounted above the component; `FilterScopeProvider` is unchanged and still carries only the session values. The held filters in `useResolvedFilter`, `object-grid` and `object-view` resolve again when the record changes, so moving to another record queries again without a remount.
  
  Anywhere with no record in context (a list view, a dashboard, a report, or a page that is not a record page) `{record_id}` is refused by name: `resolveContextTokens` reports it through `onUnresolved` (a console warning by default), the way an unresolved `{current_user_id}` is reported, and leaves it as written. It never becomes `null` and its condition is never dropped, so a number can never silently count every record; the ObjectStack server refuses the leftover token by name (`FILTER_TOKEN_UNRESOLVED`). Like the session tokens, `{record_id}` only scopes what a component shows. It is not access control: which rows a user may read is still decided by the server's row-level security.
  
  **Correction, 2026-09-30 (objectui#8945).** The example in the first paragraph, `{ "assignee": "{record_id}" }`, is the retired MongoDB-style record form. `@objectstack/spec` 17.5.0 refuses it at an `element:number` `filter`, because that key takes an array and a record is refused by kind. Write the same condition as a `ViewFilterRule` array, which the spec accepts: `[{ "field": "assignee", "operator": "equals", "value": "{record_id}" }]`. A component-level `dataSource.filter` takes the same array. The `{record_id}` token itself, and the rest of this entry, are unaffected.
- 81a2eb1: One home for the `datetime` display convention (objectui#7443).
  
  `formatDateTime` gains a named `'compact'` style, selected through
  `options.style` — the dense grid face, `7/4/2024 7:00 am` in `en-US` — which
  `DateTimeCellRenderer` used to build from its own inlined `Intl` option bags.
  The cell now reads `field.format` (it destructured `value` only, so a
  `datetime` field could not reach the style vocabulary a `date` field has) and
  renders through the shared function, and `data-table`'s `formatCellValue`
  calls `formatDateTime` instead of a third, independently authored option bag.
  Every existing cell without an authored `format`, and every cell authoring
  `'compact'`, renders byte-identically; `'compact'` is today's face named and
  rehoused, not a new one. A `datetime` field that authors any OTHER non-empty
  `format` does change: the cell previously ignored `field` altogether and always
  painted the compact face, and now anything other than `'compact'` selects the
  verbose `formatDateTime` default — measured as `Jul 4, 2024, 07:00 AM` in
  `en-US` for the instant whose compact face is `7/4/2024 7:00 am`. An
  unrecognised value is neither rejected nor passed through; it silently lands on
  that verbose face. No `datetime` field in this repository authors a `format`, so
  no cell here moves — a consumer that authored one is the case this sentence is
  for. Note that `format` has no declared value vocabulary to check a value
  against: `@object-ui/types` types it `format?: string`, and `@objectstack/spec`
  carries one free-form `format?: string` on its shared field schema, described
  "Format string (e.g. email, phone)" and accepting any string. `'compact'` is
  therefore the only value with a defined `datetime` meaning, and every other
  value means "the verbose face" by fallthrough rather than by design.
  
  Additive, no signature change: `formatDateTime(value, options?)` is unchanged
  and `formatDateTime(v, { locale })` keeps meaning what it meant.
  `DateDisplayOptions` gains an optional `style` key (read by `formatDateTime`
  only; `formatDate` still takes its style positionally), and
  `formatDateTimeCompactParts` is a new export of `@object-ui/core`, re-exported
  by `@object-ui/fields`, returning the compact face as the two halves a grid
  cell paints separately. `@object-ui/components` changes no rendered output —
  the table's datetime cell is measured identical before and after in `en-US`,
  `zh` and `de-DE`.
- 00d2fa6: ListView: fold `data={{ provider: 'object', object }}` onto `objectName`, and read the
  author's view kind from `specType` / `type` (objectui#7477 — step 6 of #2890, released
  by the maintainer's ruling B on objectstack#14791, 2026-09-03).
  
  **What was broken.** A react page bound the way the published `react-blocks` contract
  recommends —
  
  ```jsx
  <ListView data={{ provider: 'object', object: 'crm_task' }} type="kanban" />
  ```
  
  — validated green against `@objectstack/spec` and then rendered an **empty grid** with no
  diagnostic. Both halves of that binding were inert in the renderer: `ListView` read
  `data.provider === 'object'` at zero sites (`'value'` and `'api'` are both live there, so
  the gap was real and not a dead instrument), and it read `specType` — the slot the react
  page tier parks an author's `type` in, because the SDUI envelope claims the `type` key
  (ADR-0078) — at zero sites, so an absent `viewType` forced the view to `grid`.
  
  **What changed.** `normalizeListViewSchema` (`@object-ui/core`) gains two folds. Per
  AGENTS.md #0.1 they live in the one documented normalizer — not as a seventh per-block
  copy of the six sibling `data.object` reads, and not as a renderer-side `??` dual-read.
  
  - `data: { provider: 'object', object }` → `objectName`. The `object` provider is a
    `strictObject` carrying exactly `{ provider, object }`, so `objectName` captures all of
    it. Two deliberate departures from the folds around it, both narrowing: an
    already-present `objectName` **wins** (the fold only fills a gap and can never re-point
    a binding that already resolves), and `data` is **not** deleted — it has four
    providers, `api`/`value` are read live, and the block is forwarded to child views whose
    own `getDataConfig` reads `data` before `objectName`.
  - the author's view kind is read from `specType`, then from a bare `type` when it names a
    kind ListView draws (the component discriminator `'list-view'` never does) — the same
    two legs, in the same order, as `normalizeChartSchema`'s chart-family read. An explicit
    `viewType` still wins; this only fills the gap that used to resolve to `grid`, and a
    kind ListView does not draw is left to that `grid` default rather than written through.
  
  **Accept behaviour widens.** Metadata that previously had no effect now binds a view: a
  list view carrying an `object` data source, or an author `type`, renders differently
  after this change than before. Nothing that renders today renders differently. No
  authored spelling is removed here — `objectName` / `viewType` remain accepted; their
  retirement is objectstack's, after this ships.
- 721d1e0: One declaration of which chart families ignore `compareTo` (objectui#7495).
  
  **New in `@object-ui/core`:** `chartTypeIgnoresCompareTo(chartType)`, exported from
  `chart-presentation`. It answers `true` for `pie`, `donut`, `funnel` and `scatter` and
  `false` for every other chart family, an unknown string, and `undefined` — the answers
  `@object-ui/plugin-charts`' ObjectChart already gave through its own local predicate.
  ObjectChart now reads the core predicate instead of keeping that list, so the inline chart
  path behaves exactly as before.
  
  **Behaviour change in `@object-ui/plugin-dashboard`:** a dataset chart widget whose chart
  family ignores `compareTo` no longer asks the executor for a comparison. That covers the
  widget types `pie`, `donut`, `funnel`, `pyramid` (renders as a funnel), `scatter` and
  `bubble` (renders as a scatter). The dashboard used to carry its own, narrower copy of the
  list (scatter only), and it gated only the overlay series, never the query: every one of
  these widgets still forwarded `compareTo`, still had its date window lowered into
  `timeDimensions`, and so made the executor run the comparison pass and attach
  `MEASURE__compare` columns. A pie, donut or funnel then appended an overlay series the
  renderer dropped; a scatter discarded the columns. Those widgets now send the same selection as the same
  widget without `compareTo`: one pass on the server instead of two, and nothing on screen
  changes for a widget whose filter carries one bounded date window. One case does change on
  screen, for the better: the dataset executor refuses a `compareTo` it has no single dated
  window to shift, and the widget showed that refusal in place of the chart — a compare-to
  pie, donut, funnel or scatter widget with no dated window now draws its chart, since no
  comparison is asked for.
  
  Unchanged: line / area / bar / horizontal-bar / combo chart widgets keep their comparison
  overlay, and metric, gauge, table and pivot widgets keep their comparison. The gate is the
  chart branch, not the widget type, so a `pie` widget with no dimensions — which renders as
  a metric tile and shows the comparison as a delta — keeps it too.
  
  Reachability at the time of the change: `compareTo` appears in no example app metadata in
  this repository; incidence in deployed tenant metadata is not measurable from here.
- 1237ae4: The non-grid row ceiling's mechanism moves to `@object-ui/core`, its probe row
  lives in one query helper, and its footnote takes the result and nothing else
  (objectui#7508, maintainer ruling A′ — follow-up to objectui#7210).
  
  **`@object-ui/core` — new exports**, beside the `extractRecords` they wrap:
  
  - `NON_GRID_ROW_CEILING` (moved from `@object-ui/react`, value unchanged);
  - `applyNonGridRowCeiling` and the type `NonGridCeilingResult` (moved from
    `@object-ui/react`, behaviour unchanged);
  - `nonGridRowCeilingQuery()` (new) — returns `{ $top }`, the ceiling plus ONE
    probe row. It is the only place that `+ 1` is written; spread it into the
    `find()` query.
  
  **`@object-ui/react`**:
  
  - still exports `NON_GRID_ROW_CEILING`, `applyNonGridRowCeiling` and the type
    `NonGridCeilingResult`, now re-exported from `@object-ui/core` — the same
    bindings, so no import of these three changes;
  - **removed**: `NON_GRID_ROW_CEILING_TOP`. Replace `$top: NON_GRID_ROW_CEILING_TOP`
    with `...nonGridRowCeilingQuery()` from `@object-ui/core`. This supersedes the
    export list in objectui#7210's entry, which names it;
  - **breaking prop change**: `NonGridRowCeilingNote` takes `result`
    (a `NonGridCeilingResult`) and no other prop. `drawn`, `total`, `truncated`
    and `className` are gone, with no deprecated path. Pass the object
    `applyNonGridRowCeiling` returned: the note prints `result.rows.length` and
    `result.total`, so a footnote whose numbers disagree with the rows drawn can
    no longer be written. It now carries `shrink-0` itself, which the gantt used
    to pass in through `className`.
  
  `ObjectCalendar`, `ObjectGantt`, `ObjectMap` and `ObjectTree` take the helpers
  from `@object-ui/core` and hand the note their result; what they fetch, draw and
  print is unchanged.
- feac439: Execute the declarative row-level `operation: 'update'` action (objectui#7551, the
  objectui half of objectstack#14092; consumes `@objectstack/spec` 17.3.0's
  `ActionSchema.operation` / `patch`).
  
  An action authored as `operation: 'update'` with a `patch` of static field values now
  runs. Before this change the two keys parsed, published, and read as honoured while no
  runner branch consulted them: the action reached the platform action route with its
  field values never merged into the request, so the route was asked to write nothing and
  answered success for having done so.
  
  **`operation` is read before `type`, and that order is the feature.** The spec
  materializes `type: 'script'` on an update action and refuses every other explicit
  spelling, so `ActionType` gained no member — which is exactly why `ActionRunner`'s
  dispatch table, a `Record<RunnableActionType, …>`, still compiles unchanged across the
  spec bump. The cost of that design is paid at dispatch: by the time `type` is consulted
  an update action is indistinguishable from any other script action. `ActionRunner`
  therefore branches on `operation` first, ahead of both the registered-handler lookup and
  the built-in table.
  
  **The write is performed by the platform action route, never client-side.** The runner
  composes `{ recordId, params }` and hands it to the registered `script` dispatch, which
  POSTs `/api/v1/actions/{object}/{action}` — the write runs as the caller, so the
  permission floor, the object's hooks and its validations all fire as for a user edit. A
  consumer with no such dispatch registered gets a loud refusal naming the remedy rather
  than a client-side `dataSource.update()`, and rather than the silent fall-through to
  `executeActionSchema` that reports on an action which never ran. A route refusal — a
  4xx/5xx, or the HTTP-200-with-`success:false` business rejection — surfaces with its own
  code and message instead of a green success toast.
  
  `patch` is merged **under** the collected `params`, per the spec's own wording, so a
  declared fixed value can be overridden by an input the user actually answered. With
  `undoable: true` the Undo affordance captures the prior values of exactly the fields the
  action wrote — a param-collected field included, since restoring only some of an edit
  while reporting a full undo is worse than offering none.
  
  The four declared action renderer surfaces (`action:button`, `action:icon`,
  `action:group`, `action:menu`) forward both keys; `check:action-forward-parity` is what
  enumerates them and what fails if one is missed. `element:button` is excluded by its
  inline `InlineActionSchema` contract, and the spread-based hosts carry the keys through
  by construction. The Studio action inspector authors the pair on a second axis beside
  `type`, mirroring the spec's refusal set: switching into an update action clears the
  keys it refuses, the type control pins to `script`, and `list_toolbar` placement is not
  offered (that bar's home for the same intent is a list view's `bulkActionDefs`).
- e62c44e: Re-home the breakpoint layout vocabulary and delete the two dead responsive
  implementations (objectui#7580, maintainer ruling 2026-09-04, option A).
  
  **Breaking, deliberately, in one direction only.** `@objectstack/spec` retired its whole
  `ui/responsive` vocabulary in objectstack#11027 — `ResponsiveConfigSchema`,
  `BreakpointName`, `BreakpointColumnMapSchema` and `BreakpointOrderMapSchema` — on the
  stated ground that the four types "had no other authorable carrier". That ground is
  measurably false on the renderer side: `responsive-grid` is a REGISTERED SDUI component
  whose authorable `columns` input is typed by `BreakpointColumnMap` and applied by
  `resolveColumnClasses` on the render path, and `BreakpointName` types four live readers in
  `@object-ui/mobile`. The tombstone's own return condition — the vocabulary "returns if and
  when a renderer implements it" — is already met here, so the two types a renderer reads
  are re-homed rather than retired.
  
  What survives, under the same names and the same members:
  
  - `BreakpointName` (`xs`…`2xl`) is now declared in `@object-ui/types` (`mobile.ts`) instead
    of re-exported from the spec. **No consumer change**: same name, same six members, same
    export sites on `@object-ui/types` and `@object-ui/mobile`. Only its provenance moved.
  - `BreakpointColumnMap` is now declared in `@object-ui/layout` (`ResponsiveGrid.tsx`),
    verbatim from the retired `$strict` schema: six optional column counts, no index
    signature. `responsive-grid`'s `columns` input and its resolver are unchanged.
  
  What is removed:
  
  - `BreakpointOrderMap` (`@object-ui/layout`) — retired with the key, not re-homed. It had
    no read point in the package; it was published only because the retired
    `ResponsiveConfigSchema` paired it with the column map, so an author configuring `order`
    needed the type. With the schema gone there is no order vocabulary for it to be the type
    of, and re-declaring it would be the declare-without-enforce shape ADR-0049 removes.
  - `useResponsiveConfig` (`@object-ui/mobile`), with its `SpecResponsiveConfig` and
    `ResolvedResponsiveState` exports, and `ResponsiveProtocol` (`@object-ui/core`), with
    `resolveResponsiveConfig` / `getVisibilityClasses` / `getColumnClasses` /
    `getOrderClasses` / `shouldHideAtBreakpoint`. Both read the retired
    `ResponsiveConfigSchema` and both were measured at zero callers (objectui#4773).
  - `SpecResponsiveConfig` / `SpecBreakpointName` (`@object-ui/types`) — dead re-exports once
    the two implementations above went, dropped rather than re-declared locally, the same
    disposition the retired i18n names in that file already carry.
  
  No behaviour is retired. The live per-breakpoint readers — `useBreakpoint`,
  `ResponsiveContainer`, `BREAKPOINTS` / `BREAKPOINT_ORDER` / `getCurrentBreakpoint`, and
  `responsive-grid` itself — are untouched.
  
  **Sequencing.** objectui's next `@objectstack/spec` pin bump must carry `Blocked-by:`
  objectui#7580: the retirement is merged upstream and unreleased, so this must land first.
  
  ⚠️ **Dated note, 2026-10-02 — the `responsive-grid` registration is retired — objectui#11441.**
  Later in this same release the maintainer's ruling on objectui#11441 (letter B) unregistered `responsive-grid` (and
  `layout:responsive-grid`). That ruling updates item 2 of this change's ruling: the vocabulary half stands, so
  `BreakpointName` and `BreakpointColumnMap` stay declared here, and `ResponsiveGrid` stays a React export whose
  `columns` prop `BreakpointColumnMap` types. The authorable breakpoint grid is the `grid` node with a breakpoint
  `columns` object, which `BreakpointName` keys. The rest of this entry is kept as the reading of this change.
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
- da6e191: Canonicalize the retired object-schema dialect once, at the ingestion choke point
  (objectui#7650).
  
  `normalizeSchemaReferenceKeys` now has two arms. The `reference` / `reference_to` pair
  is unchanged. The new arm folds any key a served field def carries that
  `@objectstack/spec`'s `FieldSchema` does **not** declare, but whose snake/camel twin it
  does — `display_field` onto `displayField`, `lookup_filters` onto `lookupFilters`, and so
  on.
  
  **The accepted set is MEASURED, not enumerated — and it grows with the linked spec**
  (corrected on objectui#8938; this paragraph previously read as though the keys the cards
  in this family happened to name were the whole of it). One spelling rule is applied to
  `FieldSchema`'s **entire** declared key set at run time, so the accepted set is a property
  of the installed `@objectstack/spec` and widens the moment the spec grows a camel key.
  Besides the four above, today's spec puts the gate keys `visible_when` / `readonly_when` /
  `required_when`, `default_value`, `required_permissions`, `masking_rule`, `track_history`,
  `delete_behavior`, `external_id`, `depends_on`, `lookup_page_size`, the `related_list*` and
  `inline_*` families, and the managed-by lock keys `_lock_reason` / `_lock_source` /
  `_lock_docs_url` / `_package_id` / `_package_version` inside it — and case / kebab variants
  of every one of them fold too. A stored legacy spelling of any of these is therefore
  **active** on the client where consumers previously ignored it.
  
  No count of that surface is written here on purpose: it is derived from the installed spec,
  and a number in this paragraph would be derived once and never again. The instrument that
  re-derives it on every run is the pin named `the width IS the spec's declared key set, not
  a list anyone typed`, beside the classes above as a live membership assertion.
  
  **Why this is needed at all.** The object-schema serve path never parses:
  `ObjectStackAdapter.getObjectSchema` fetches the document, applies two mutations and
  returns it, with no `ObjectSchema.parse` anywhere. `FieldSchema` strictness therefore
  gates the metadata **write** door only. A document stored before a key was tightened is
  served back verbatim, forever — it cannot be re-saved through the strict door, but nothing
  ever asks it to be. objectui#7155, #7166 and #7435 narrowed the consumer reads to the
  camelCase spelling on the strength of "no spec-compliant producer can emit this key",
  which is a claim about authoring, not about serving. This restores the other half, the
  same way objectui#6837 restored it for `reference_to`.
  
  **How the fold is derived.** By the spec's own alias-probe rule — lowercase, strip `_`,
  `-` and space — matched exactly against `FieldSchema`'s declared key set, read at runtime
  off `FieldSchema.shape`. Not a hand-written table: a table has to be edited every time the
  spec grows a camel key whose snake twin is still in stored documents, and the edit that
  does not happen is the bug.
  
  **What it deliberately does not do.** It never removes a key or a value — the legacy
  spelling stays on the document exactly as served, because dropping it would make a stored
  legacy document lose the value instead of arriving canonical. It never overwrites a
  canonical key the producer already set. It folds nothing onto a probe two declared keys
  share. And it does not "correct" anything: a key that probes onto no declared key is left
  alone, so a typo (`sortible`) stays a typo and `id_field` — which has no declared
  successor — stays as it is.
  
  **Not covered.** `id_field` and `title_format` are not folded — `id_field` has no declared
  successor and `title_format` is out of scope pending a separate maintainer ruling. Both land
  in the leave arm by the same rule, with no special case. What still waits on a
  `@objectstack/spec` release carrying the `FIELD_KEY_GUIDANCE.id_field` row is the
  **successor guidance** for `id_field`, which no published version carries; the leave arm
  itself is no longer silent (objectui#8938 — the diagnostic states what it measured against
  the linked spec rather than quoting a copy of contract prose).
- aef97e5: ⚠️ **BREAKING — `@object-ui/core` no longer exports `ValidationEngine`,
  `defaultValidationEngine`, `validate` or `validateFields` (objectui#7659).**
  
  Those four names were the whole public surface of `validation-engine.js`, a
  client-side field-rule engine with a snake_case rule vocabulary of its own
  (`min_length`, `max_length`, `email`, `url`, `phone`, `date_min`, `min_items`,
  `field_match`, `field_compare`, …). It was a second vocabulary for a job
  `buildValidationRules` already does, and no renderer in this repository ever
  consumed it: a `validateFields` call compiled, ran, and changed nothing about a
  form. It is retired under ADR-0049 enforce-or-remove (maintainer ruling A on
  objectui#7659), with no deprecation window, and the module is deleted.
  
  **Replacement:** client-side field validation is `buildValidationRules(field)`
  from `@object-ui/fields`. It compiles a field's metadata (`required`, length and
  value bounds, `pattern`, and the checks its type implies) into react-hook-form
  rules, which the object form renderers apply. There is no one-to-one port of an
  `AdvancedValidationSchema` object: a host that called `validate` or
  `validateFields` declares those constraints on the field metadata instead, or
  keeps its own check.
  
  Not affected: the deprecated object-level engine (`ObjectValidationEngine`,
  `defaultObjectValidationEngine`, `validateRecord`, #3110) and the schema-tree
  validator (`validateSchema`, `assertValidSchema`) stay exported. The rule and
  result types in `@object-ui/types` (`AdvancedValidationSchema`,
  `ValidationRuleType`, `ValidationContext`, …) keep their shapes; only the doc
  comment on `ValidationContext.locale` changed, because the engine it described
  is gone.
  
  ⚠️ **Dated note, 2026-09-27 — those types no longer keep their shapes: all
  eight (`AdvancedValidationSchema`, `AdvancedValidationRule`,
  `ValidationRuleType`, `ValidationFunction`, `AsyncValidationFunction`,
  `ValidationContext`, `AdvancedValidationResult`, `AdvancedValidationError`) are
  removed from `@object-ui/types` by a later change, on this same ruling —
  objectui#10719.**
  
  ⚠️ Out-of-repository consumers are NOT MEASURED. This package is published, and
  the zero-consumer reading behind the ruling covers this repository only; a host
  application that imports any of the four names stops compiling on upgrade.
- 93fea2e: **BREAKING:** `@object-ui/core` no longer exports `DataScopeManager` or the
  row-level filter vocabulary that came with it (objectui#7750). This narrows the
  package's published surface. It is declared `minor`, not `major`, because this
  fixed release group follows the `@objectstack` major (AGENTS.md §9); the
  breaking change is stated here instead.
  
  Removed, with no replacement and no deprecated alias:
  
  - `DataScopeManager`, the class
  - `defaultDataScopeManager`, its shared instance
  - `RowLevelFilter`, the type of one row-level rule
  - `DataScopeConfig`, the type `registerScopeWithConfig` took; nothing else in
    the package read it
  
  Why they went: `DataScopeManager` carried a third hand-written row-level
  security evaluator, beside `evaluateCondition` in `@object-ui/permissions` and
  the platform's own. The platform keeps one row-level security language: the CEL
  predicate a `RowLevelSecurityPolicySchema` policy declares in its `using`
  clause (`@objectstack/spec`), which the server lowers to an ObjectQL filter and
  which fails closed when it does not lower. Aligning this class's operator
  vocabulary with the spec's instead was considered and refused: on a permission
  boundary it would have turned refused operators into evaluated ones, three of
  them with silently different meanings. On this change's base, no code in this
  repository constructed a `DataScopeManager` or a `RowLevelFilter` outside the
  class's own tests and its documentation examples, and the downstream readings
  recorded on objectui#7750 found no consumer in `objectstack`, `hotcrm` or
  `cloud`. The maintainer ruled to retire it; the ruling is on objectui#7750.
  
  Not affected: the rest of `data-scope/` stays exported, `ViewDataProvider` and
  the element data-source helpers (`composeElementDataSource`,
  `resolveSavedView` and their types) included. The `DataScope` and `DataContext`
  interfaces in `@object-ui/types` are unchanged.
  
  Other entries in this same release describe work on `DataScopeManager`: the
  `@object-ui/core` entries for objectui#7378 (an unknown operator denies the
  row) and objectui#7751 (the own-member field read and the same-kind ordered
  comparison). That work shipped in a class this entry removes. The
  `@object-ui/permissions` entry for objectui#8044 says `evaluateCondition` now
  gives the same answer as `DataScopeManager` for a prototype-named field; the
  guard it describes stays in `@object-ui/permissions`, and after this release it
  is the only one of the two evaluators left.
  
  **Migration:** there is no replacement in `@object-ui/core`. Declare row-level
  security on the server, as a `RowLevelSecurityPolicySchema` policy whose
  `using` clause is a CEL predicate; the platform lowers it to an ObjectQL filter
  and enforces it fail-closed. If you used `DataScopeManager` only as a registry
  of named scopes, copy `packages/core/src/data-scope/DataScopeManager.ts` from a
  release tag that still ships it, for example `@object-ui/core@17.5.0`, into
  your own code.
- 335abea: **BREAKING** (declared `minor` — this repo pins its major to `@objectstack`, so a
  breaking change ships as a minor with this banner; AGENTS.md §版本号策略):
  `WidgetInput.label`, `WidgetInput.defaultValue` and `WidgetInput.advanced` are
  now ADR-0049 retirement tombstones (`?: never`). The published `.d.ts` member
  set of `@object-ui/types` changes: all three keys stay DECLARED and become
  UNWRITABLE, so TypeScript code that authors one on a widget-manifest input now
  fails to compile.
  
  The same three keys were retired on `ComponentInput` first (objectui#7493 /
  objectui#7781). `WidgetRegistry.load()` — the only consumer of a manifest's
  `inputs` in this repository — forwards `name`, `type`, `required`, `options`
  (as `enum`) and `description`, and never these three; the seam copy that used to
  carry them across went with that earlier retirement, leaving them declared and
  unread on their own face. Maintainer ruling A of 2026-09-15 (objectui#7911)
  carried the retirement to this second face, so the two input faces now agree.
  
  **What to write instead:** nothing. An input is identified by its `name` on
  every path that reaches it; `description` is the published place to tell an
  author anything about it, including what the renderer's own fallback default is.
  
  **The limit, stated because it is the whole cost of the change:** `WidgetInput`
  has no zod mirror, so unlike the `ComponentInput` retirement this one has no
  runtime face — it is a compile-time refusal and nothing else. A widget manifest
  that arrives as JSON is not parsed through this type by anything in this
  repository, so an author outside it who writes `label` gets what they got
  before: the key is ignored, silently. Widget manifests are authored outside this
  repository by design, and that population was never measured.
- 1bd79c8: A field-rule predicate the author **declared and left blank** is no longer silent, and the
  three fault directions in `resolveFieldRuleState` are now named and documented instead of
  being bare positional booleans (objectui#8069). **No fallback value moves.**
  
  **The blank hole.** `''` and `'   '` are authorable — `ExpressionWireSchema` is a bare
  `z.string()` with no `.min(1)`, and `resolveFieldRuleState`'s own guard is `!= null`, so a
  blank predicate passes both. `evalFieldPredicate` then returned the caller's fallback on its
  first line, *before* `warnPredicateFailure` or `onFault` could fire. That is a third state,
  not a spelling of either neighbour: the key is present (so it is not "the author wrote no
  rule") and nothing evaluates (so no engine fault is raised). The one state an author reaches
  by *starting* a rule and not finishing it was the one state that said nothing at all — which
  is exactly what objectui#4051 / objectstack#5149 ruled out for every other fault.
  
  Both spellings now report `[blank] the predicate is declared but empty — nothing to evaluate`
  through the same single reporting site as every other fault, on both channels (the built-in
  `console.warn` and the `onFault` passback, so the fault-probing callers that pass
  `warn: false` are not silenced either). **Every verdict is unchanged**, including the
  envelope spelling: `{ source: '' }` used to reach the engine and come back
  "AST-only evaluation not yet supported; persist `source`" and `{ source: '   ' }`
  "Unexpected token: EOF" — two misleading reasons for one author mistake, both already
  resolving to the same fallback this change keeps. Blankness is decided by
  `isBlankPredicateText` (`evaluator/declaredPredicate.ts`), the repo's one definition of that
  question since objectui#3960, now exported for this second consumer rather than copied.
  
  For this one fault class the once-per-predicate dedupe key joins the caller's **locator**: a
  blank predicate has no distinguishing text, so every blank rule in an app shares the key
  `""` and the first one would silence every other author's. Non-blank keys are unchanged.
  
  **The named directions.** `resolveFieldRuleState` passed `true` / `false` / `false` as bare
  third arguments and answered the adjacent "no rule declared" case with the *same* literal —
  so every permissive value was written twice, and the "the rule broke" answer was chosen by
  aligning it with the "the rule is absent" answer beside it. Six module-private constants now
  spell the two questions apart (`*_WHEN_FAULTED` / `*_WHEN_ABSENT`), with one docblock
  recording the direction, the fact that all three point the permissive way so a single
  mistyped column yields a form that shows more, locks less and demands less at once, and what
  the history does and does not record about why (objectui#1578 and ADR-0036 both carry a
  per-key "a fault is safe" rationale; no commit puts the case where all three faults arrive
  from one typo). `evalFieldPredicate`'s docblock gains the call-site policy table — five
  distinct fault policies share this one helper, two of which detect a fault by calling it
  twice with *opposite* fallbacks and therefore depend on `fallback` staying freely
  specifiable.
  
  Whether the direction belongs in the authored contract, and whether a loud-but-safe middle
  should exist, remain open on objectui#8069.
- af9e957: fix(types,components,plugin-form,console,core): a faulted `visibleWhen` refuses the submit, naming the field and the rule; a blank field rule is refused; blank gates are diagnosed (objectui#8069)
  
  ⚠️ **User-visible, and a narrowing.** A form whose field `visibleWhen` cannot be
  evaluated — a typo in a column name, a syntax error, an unbound root — used to
  render the field (fail-open) and submit as if the rule had said "show". It now
  still renders the field, and **refuses the submit** with a message that names
  the field and the rule (`form.visibleWhenFaulted`). This is ADR-0137 D2 as
  ruled for objectui#8069 (Q1 = B, one judge per rule): no server evaluates a
  field's `visibleWhen`, so its fail-open render direction (D3) was a silent grant
  — a field the working rule would have hidden, drawn, edited and written. The
  refusal applies on the record form renderer (`form.tsx`, every `ObjectForm`
  layout), the console's `/forms/:name` and `/f/:slug` page, and the wizard's
  cross-step gate at final submit.
  
  - `requiredWhen` / `readonlyWhen` are **unchanged on the client**: the server
    evaluates both and refuses a faulted one itself (ADR-0137 D2), and the form
    renderer shows that field-attributed refusal beside the input.
  - **Accepted residuals:** a `visibleWhen` reading `previous` cannot be
    evaluated on a CREATE form, so such a form is refused on every submit; and
    the wizard's cross-step gate binds no `previous` in either mode, so the same
    rule is refused at the final submit of an EDIT wizard too.
  - A **blank** field rule (`''`, whitespace, an envelope whose `source` is
    blank) is a fault, not "no rule" (ADR-0137 D2). A STORED blank `visibleWhen`
    is refused at submit on the same three paths; a stored blank `requiredWhen` /
    `readonlyWhen` is the server's to refuse.
  
  ⚠️ **Narrowing (`@object-ui/types`): `FormFieldSchema` refuses a blank field
  rule at parse.** `visibleWhen`, `readonlyWhen` and `requiredWhen` on a form
  field now refuse a predicate that is blank after trimming, with the spec's own
  sentence (`EVALUATED_EXPRESSION_SOURCE_REQUIRED`) — ADR-0137 D1, the same
  refusal `@objectstack/spec` makes on `FieldSchema`. The accepted SHAPE is
  unchanged (a string or `{ dialect?, source }`, `ExpressionWireSchema`'s own
  arms): only the blank value is taken out. A blank GATE — `BaseSchema`'s
  `visible` / `hidden` / `disabled`, a form field's view-level `visibleOn`, an
  option's `visibleWhen` — still parses and is still read as "no gate".
  
  **Added (`@object-ui/core`):** `resolveFieldRuleState` returns `faults` beside
  its three verdicts — the per-rule fault report the submit paths read, filled
  from the same evaluation — and its type, `FieldRuleFaults`, is exported.
  **Added (`@object-ui/i18n`):** the `form.visibleWhenFaulted` key in all ten
  packs.
  
  **Diagnosed, no verdict changed (ADR-0137 D4):** a blank CEL gate reaching
  `ExpressionEvaluator.evaluateCondition`, and a blank gate folded to "no gate" by
  `hasDeclaredPredicate`, now each report once through the same `[blank]` channel
  field-rule faults use. Both verdicts (objectui#3850 / #3960) are unchanged,
  `throwOnError` included.
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
- 846cec0: **Breaking behaviour change — `object-tree` now honours only the `data` spelling its published row declares.**
  
  Decision batch #83, maintainer verbatim 「8348 以协议为准」: a view block honours the `data` spelling its block's published row declares, and no other. `object-tree` was the one ladder block that ruling could not reach, because no published face declared a `data` row for it, so it honoured ANY truthy `data`. Ruling batch #136 item 3 (Q1-C) had the protocol gain the row, and `ComponentPropsMap['object-tree']` in the installed `@objectstack/spec` declares `data` as the `ViewData` union and `staticData` as an array. The ruling's 「协议没有的能力删」 clause did not fire — the row does declare `data` — so the tree keeps the object form and loses only the bare-array spelling.
  
  - `data: { provider: 'value', items: [...] }`, `{ provider: 'object', object }` and `{ provider: 'api', … }` — **unchanged**, still the tree's first record source.
  - `staticData: [...]` — **unchanged**; the same row declares it, and it is still the second rung.
  - ⚠️ `data: [...]` (a bare array) — **no longer a record source.** The ladder falls through to `staticData`, then `objectName`: such a tree queries its object instead, or draws `No records` when it names neither. In a development build `SchemaRenderer` says so once, naming the key and the spelling that works; in production it is quiet. This is the same outcome `object-map` and `object-gantt` already give for the same spelling. Stored documents authored that way stop drawing those rows — accepted by the ruling, with no transition window. Move inline rows to `staticData` or to `data: { provider: 'value', items }`.
  - The `data` **prop** a host hands down (`ListView`'s tree) is untouched.
  
  Two carriers had to close for this to be observable. `@object-ui/core`'s `recordSourceDataArmForType` now answers `'view-data'` for all four spellings the tree registers under (`object-tree`, `plugin-tree:object-tree`, `tree`, `view:tree`), so `SchemaRenderer` no longer spreads an authored `data` on a tree node as a React prop (objectui#9571). And `ObjectTree`'s own fetch effect no longer reads `schema.data` beside the host prop — that second reader bypassed the shared ladder, so an arm change alone would have removed nothing end to end.
  
  ⚠️ **Dated note, 2026-10-02 — two of the four spellings are retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 unregistered the bare `tree` alias, and with it
  `view:tree`; `recordSourceDataArmForType` answers `'view-data'` for `object-tree` and
  `plugin-tree:object-tree` only. The rest of this entry is kept as the reading of this change.
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
- b38014e: `record:details`' dedupe and the page H1 now share ONE definition of "this record
  has a value here" (objectui#8350).
  
  The renderer drops from the body grid the one field whose value the page H1 is
  already showing. objectui#8175 (PR #8349) made the two halves agree on **which
  field** — the ladder leads with the unified ADR-0079 resolver. They still
  disagreed on **what counts as a value**.
  
  **The user-visible defect.** The header half decides emptiness through
  `@object-ui/core`'s `recordDisplayValueAt`, which **trims**: a whitespace-only
  value is empty, so `getRecordDisplayName` walks on to the next rung. The ladder
  asked its own raw `undefined` / `null` / `''` question, which a whitespace-only
  value passes. So for a record whose title field held only spaces:
  
  - the H1 walked past that field and showed something else — say `Acme
    Corporation`, resolved one rung further down;
  - the grid hid the blank field's row anyway, concluding it was the duplicate;
  - and the row that really did repeat the heading, `Acme Corporation`, stayed.
  
  A field disappeared from the grid to deduplicate against a heading that never
  displayed it. The failure is silent: nothing errors, a row is simply absent.
  
  **The change.** The ladder now calls `recordDisplayValueAt` — the very function
  every value-keyed rung of `getRecordDisplayName` uses — instead of re-spelling
  the test. `@object-ui/core` exports it for that purpose; it was the module-private
  `valueAt`, unchanged in behaviour and renamed only to be a defensible public
  name. One authority, not two implementations that agree today.
  
  **Behaviour change, deliberately — this is wider than trimming.** Sharing the
  definition also imports the two other things it decides, and both bring the grid
  into line with the heading:
  
  - an expanded/embedded reference object is **empty** when its Salesforce-style
    display chain yields nothing, so a bare `{ id: 'u1' }` lookup payload no longer
    claims the dedupe (the raw test read any object as a value — and so would a
    bolted-on `.trim()`, which is why the fix is delegation rather than a trim);
  - non-strings are stringified, so `0` and `false` remain values, not blanks.
  
  In every case the new answer is the one the H1 was already giving.
  
  **New export.** `@object-ui/core` gains `recordDisplayValueAt(record, field)`.
  Additive: nothing imported the private `valueAt`, and `getRecordDisplayName`'s
  own answers are unchanged.
- f76f436: `ValueDataSource`'s object-dialect matcher executes the operators the spec declares and
  refuses the rest, instead of waving every unrecognised one through (objectui#8447).
  
  **Breaking, deliberately — this MOVES RESULTS.** `matchesFilter` ended its operator
  switch with `default: break`, which adds no constraint, so an unrecognised operator
  matched **every** row, silently. The asymmetry sat inside one `if` in `find()`: an
  array `$filter` goes to `matchesASTFilter`, which refuses an unknown node, excludes the
  row and logs it; an object `$filter` went to `matchesFilter`, which admitted it and
  included the row. Same file, opposite defaults, and nothing told an author which dialect
  their filter took.
  
  **Now executed** — one arm per member of the spec's `FILTER_OPERATORS`, **all sixteen**,
  each answering the same question its AST twin already answered: `$eq`, `$ne`, `$gt`,
  `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$between`, `$contains`, `$icontains`,
  `$notContains`, `$startsWith`, `$endsWith`, `$null`, `$exists`. Eight of those were
  already implemented; the other eight selected every row. `$eq` is the sharpest of them:
  `{ age: { $eq: 26 } }` selected everything while the plain `{ age: 26 }` beside it was
  correct all along. `$exists` is the exact inverse of `$null` — `$exists: true` is
  IS NOT NULL — which is the lowering `convertFiltersToAST` already performs, not a
  reading invented here.
  
  **The closed vocabulary matters more than any one arm.** Because nothing the spec
  declares is refused by name, the parity guard in the companion test can assert that the
  case table equals `FILTER_OPERATORS` *exactly* — so a future spec release that adds a
  `$` operator turns this file red instead of letting the new spelling reach the refusal
  arm unannounced. An operator parked on a refused list would have been a hole that guard
  could not see into.
  
  **Now refused** — excluded and logged once per distinct refusal per `find()`, in
  `matchesASTFilter`'s own idiom. Everything here is OUTSIDE the declared vocabulary:
  
  - `$like` / `$ilike`, declared by `StringOperatorSchema` but deliberately staged out of
    `FILTER_OPERATORS`; this matcher has no pattern engine.
  - `$regex` / `$options`, retired from the protocol — the refusal prints the spec's own
    `RETIRED_FILTER_OPERATORS` prescription verbatim, the way the driver-side refusal
    sites do.
  - Lowercase aliases (`$startswith`, `$notcontains`, `$notin`) and the off-spec
    `$ncontains`: the canonical `$` spellings are camelCase, and growing alias arms in the
    renderer would fossilise a second dialect.
  - A nested relation constraint (`{ profile: { verified: true } }`), refused by the key
    it could not read; this matcher does not descend into relations.
  - `$and` / `$or` / `$not`, which are combinators rather than field operators. `$and` and
    `$or` carry an array and were already excluding every row through the equality branch,
    silently — those rows do not move, only the silence does. `$not` carries an object, so
    it entered the operator branch, its inner field names were read as operator names and
    each hit `default: break`: it matched **every** row, and now matches none. Executing a
    group in this dialect is a feature with its own semantics to settle and is not part of
    this repair; the AST array `$filter`, which the sibling arm of `find()` already
    executes, is the door that works today.
  
  **Migration.** A filter that used any of the eight newly-executed operators was
  returning unfiltered data; it now returns the rows it names. A filter using a refused
  spelling now returns nothing and says why on the console — rewrite it in the canonical
  spelling the refusal prints, or express it as an AST array `$filter`.
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
- 4d65991: `convertFiltersToAST` follows `@objectstack/spec`'s `$`-dialect spellings and nothing
  else: the four lowercase aliases `$notin`, `$notcontains`, `$startswith` and `$endswith`
  are retired from `convertOperatorToAST`'s `operatorMap` (objectui#8568).
  
  **BREAKING for anyone spelling those four in lowercase, and there is no deprecation
  window.** A filter that carries one used to lower silently — `{ email: { $startswith:
  'a' } }` became `['email', 'startswith', 'a']` — and now throws a `FilterOperatorError`
  (`code: 'INVALID_FILTER'`, `httpStatus: 400`) at the call site. This repo forbids a
  `major`, so the break ships as a `minor` and is spelled out here instead. The repair is
  a key rename: `$notin` to `$nin`, `$notcontains` to `$notContains`, `$startswith` to
  `$startsWith`, `$endswith` to `$endsWith`. The operator itself is unchanged, the lowered
  node is unchanged, and no result set moves for a filter that was already spelled
  canonically.
  
  **Why the tolerance had to go.** `ValueDataSource` refuses these same four by design —
  objectui#8447 declined to grow alias arms there because they "would fossilise a second
  dialect" — so one authored filter had two fates depending on which data source was
  behind the view: rows through the ObjectStack adapter, nothing through the in-memory
  matcher. One dialect with two acceptance sets is the second de-facto contract AGENTS.md
  commandment 0.1 exists to refuse, and the decision had only ever reached one of the two
  files. `ValueDataSource` is untouched by this change; the converter is the side that
  moved.
  
  **The refusal names the canonical spelling for the alias you wrote** rather than
  printing the generic "unknown operator, here are the supported ones". With no
  deprecation window that message is the whole migration aid, so it is pinned as a
  property, not left as a nicety.
  
  **Measured before landing, and it bounds the blast radius from the inside.** The in-repo
  authored corpus (examples, docs, apps, e2e, fixtures) carries **zero** occurrences of the
  four aliases in operator-key position — every tree-wide hit is the map that defined them
  or something pointing at it — so no in-repo caller had to be repaired. That zero is
  consumer-local, not seam-wide (objectui#6839): stored view / list / sharing-rule
  criteria, producer-side metadata and published consumers of `@object-ui/core` are all
  invisible from here. What is measurable about that population is that it is already half
  broken: `kvToCondition`, the reader that loads stored `$`-criteria back into the filter
  builder, has arms for fifteen spellings and none of these four, so a stored lowercase
  criterion already failed to round-trip and dropped the admin into the raw-JSON editor.
  
  `packages/data-objectstack/README.md`'s operator tables follow the implementation, as
  does the reconciliation test that holds them to it.
- 0a174f3: fix(plugin-dashboard,core,plugin-charts): route a structured `aggregate.groupBy` on `object-metric` to the spec-shape wire
  
  An authored `aggregate.groupBy` is a union — a bare field name, or the
  structured date-bucketing node `{ field, dateGranularity?, alias? }` — and the
  two need different queries. The spec-shape
  `{ groupBy: GroupByNode[], aggregations, where }` reaches `engine.aggregate` and
  runs the server-side date-bucket engine; the legacy
  `{ field, function, groupBy, filter }` query reaches the cube/analytics wire,
  whose `dimensions` the contract declares as an array of dimension NAMES and
  which does not honour `dateGranularity` at all.
  
  `ObjectChart.runAggregate` has routed between the two since objectui#7946.
  `ObjectMetricWidget.computeOne` had no such branch: it forwarded the authored
  value straight through, so a metric widget carrying a structured node posted
  `dimensions: [{ field: 'closed_at', dateGranularity: 'month' }]` — an object
  where a name is declared. Nothing refused it and nothing reported it, so the
  author asked for one question and the platform answered another (objectui#8613).
  
  - The routing test and the payload are now one function,
    `objectAggregateSpecQuery` (with `isStructuredGroupBy`) in `@object-ui/core`.
    `ObjectChart.runAggregate` and `ObjectMetricWidget.computeOne` both call it,
    so the two renderers cannot post different wires for one authored shape. The
    measure alias is `chartMeasureKey`'s answer, i.e. what the chart's own
    `aggregateValueKey` already delegated to — the chart's posted payload is
    unchanged.
  - `ObjectMetricWidgetProps.aggregate.groupBy` said `string`. That was a claim
    about the author which nothing upstream backed: the value crosses two `any`
    seams on the way in, so the declaration refused the node at neither compile
    time nor runtime. It is now the contract's union, taken by reference through
    `ObjectChartSchema['aggregate']`.
  
  Unchanged, and pinned as controls: a plain string `groupBy` and an absent one
  (floored at the single `'_all'` bucket) still take the legacy query byte for
  byte, and an ARRAY `groupBy` still travels there too — it is not this union's
  object arm, and it must keep reaching the producer-side refusal `503cd8b89`
  landed in the adapter.
- 561abef: Refuse an empty or non-string `$icontains` / `icontains` comparand in `ValueDataSource`,
  and stop `FilterConditionField` emitting the shape (objectui#8748).
  
  **This moves the accept set of a published adapter**, in both filter dialects, which is
  why the two halves ship together.
  
  Measured before the change, over `@objectstack/spec`'s own `FILTER_TEXT_ROWS`:
  `{ name: { $icontains: '' } }` and `['name', 'icontains', '']` each returned **all nine
  rows with not one console line** — every value contains the empty substring, so the arm
  ran and constrained nothing. `{ name: { $icontains: 42 } }` was evaluated after a
  `String(42)` coercion nobody wrote. `FILTER_TEXT_CASES` (`@objectstack/spec/data`)
  carries both shapes as REJECTION rows (`code: 'INVALID_FILTER'`,
  `mustMention: ['$icontains']`), so this face was answering a published table's rows the
  wrong way, in the same widening class objectui#7349 and objectui#8447 already fixed here.
  
  **`@object-ui/core`.** The `icontains` and `$icontains` arms now check the comparand
  before folding: anything that is not a NON-EMPTY STRING excludes the row and drains one
  console refusal naming the operator and the field. That is this face's declared refusal
  shape (objectui#7349) — the row is excluded and logged, **not** thrown; the throwing
  envelope is the wire-side `@object-ui/data-objectstack`'s, whose job is deciding whether
  to send a query at all. The sibling positive operators (`$contains` / `$startsWith` /
  `$endsWith`) are deliberately **not** widened by analogy: the published table declares
  the refusal for `$icontains` and for no other operator, and that asymmetry is pinned.
  
  **`@object-ui/fields`.** `condToMongo` now drops a text-operator condition whose
  comparand is empty (`contains`, `containsCaseInsensitive`, `notContains`, `startsWith`,
  `endsWith`; `undefined` / `null` / `''`) instead of emitting it verbatim. This half is
  what makes the refusal safe rather than a regression: a builder row with the operator
  chosen and the value box still empty authored exactly the refused shape, so refusing it
  in the matcher alone would have flipped that list from "every row" to "no rows" — the one
  outcome `ValueDataSource`'s own `$exists` arm names as worse than the bug. The
  value-less operators (`isNull` / `exists` / `isEmpty` and their negations) read no
  comparand and are untouched, as is `equals ''`, which is a real predicate.
  
  **Migration.** An author who wrote an empty or numeric `$icontains` comparand was getting
  either every row or a coerced answer; they now get no rows and a console line naming the
  operator. Write a non-empty string comparand, or drop the condition.
  
  The producer half moves **stored criteria** as well, for the four sibling operators it
  covers: a builder row left on `contains ''` / `startsWith ''` / `endsWith ''` used to
  store `{ field: { $contains: '' } }` and friends — which the server evaluates as "the
  value is a string" — and `notContains ''` stored its complement, "the value is not a
  string". All four now store no fragment at all, so a rule whose only row was one of them
  saves as empty criteria and is refused on save (objectstack#3896) instead of quietly
  sharing by storage class. Rules already stored keep their fragment and keep evaluating as
  they did; only what the builder WRITES from now on changes.
  
  ⚠️ The builder ROW is unaffected by the drop: it is held as local state and stays on
  screen with its value box empty, so the five text operators stay reachable — the criteria
  is what the rows emit, not what they are.
  
  Superseded in this release by objectui#9306, for the `@object-ui/fields` half:
  the builder's operator ids are now the protocol's canonical spellings, so the
  text operators `condToMongo` drops on an empty comparand are `contains`,
  `icontains`, `not_contains`, `starts_with` and `ends_with` (the case-insensitive
  contains is `icontains` now, and no longer opt-in), and the value-less operators
  it leaves untouched are `is_null` / `exists` / `is_empty` and their negations
  `is_not_null` / `notExists` / `is_not_empty`. The drop itself, `equals ''`, and
  every emitted `$`-token (`$contains`, `$icontains`, `$notContains`,
  `$startsWith`, `$endsWith`) are unchanged — objectui#9306's census measured the
  same stored predicate for all 22 former ids and the ids they became.
- abf710d: Lower the TRUE-identity filter combinators to "no constraint" instead of handing the
  caller's own object back (objectui#8770).
  
  `convertFiltersToAST({ $and: [] })`, `{ $or: [{}] }` and `{ $and: [{}] }` returned the
  INPUT OBJECT unchanged. `lowerLogicalGroup` correctly answers `undefined` for a group
  that reduces to the TRUE identity — objectstack#5322 rules all three "every row", and a
  childless `['and']` would be `isFilterAST` FALSE — but when such a group was the only
  thing in the filter, that `undefined` fell through to the general tail
  (`if (conditions.length === 0) return filter`) and the group reappeared one level up, in
  the `$` dialect, in the slot the AST occupies. The same function already lowered the
  fourth identity, `{ $or: [] }`, correctly, so this was an internal inconsistency rather
  than an open question; the consumer half was settled by objectui#8513.
  
  **This widens what those three filters return, and that is the point.** Measured against
  `@objectstack/spec` 17.4.0 and `@objectstack/client` 17.4.0 before the change: the
  returned object is not sent as a filter and refused — `client.data.find()` tests the
  value with `isFilterAST` and its else branch spreads a plain object's entries as query
  parameters, so `{ $and: [] }` left as `?$and=` with **no `filter` parameter at all**, and
  the server answered `400 UNSUPPORTED_QUERY_PARAM` for the unknown `$`-prefixed
  parameter. A filter whose ruled answer is EVERY ROW was a **failed list**, not a narrowed
  one — so nothing could have been relying on it to scope data. On the sibling
  `$expand` / `$search` route the same object travelled as `filter={"$and":[]}`, which the
  server accepts as a `FilterCondition` and already answers with every row; the two routes
  disagreed about one filter and now agree.
  
  **`@object-ui/core`.** `convertFiltersToAST`'s declared return type gains `undefined`,
  which is what `toFilterNode`, `mergeFilterNodes` and `data-objectstack`'s
  `translateFilterToAST` already mean by "no filter, skip the slot". Every call site
  already acted on it. The fold is scoped to a filter whose EVERY key is such a group:
  the same tail also serves `{}`, an all-null filter and an empty operator map, and those
  keep the object they always returned — a null-valued key is this converter's own
  tolerance rather than a ruled identity, and the object it hands back reaches the server
  as a REAL `a IS NULL` predicate on the `$expand` route, so folding it in would return
  more rows on a path the ruling said nothing about.
  
  `{ $or: [] }` is untouched: FALSE is not "no constraint", the AST has no contradiction
  literal, and its `['$or', '=', []]` leaf answers FALSE at both consumers.
  
  **`@object-ui/data-objectstack`.** `convertQueryParams` skips the `filters` slot when the
  lowering answers `undefined`, the same answer the raw-GET route's
  `if (translated !== undefined)` already gave, so the two `find()` routes cannot disagree
  about one filter.
  
  **Migration.** A TypeScript caller that stored `convertFiltersToAST(...)` in a
  `FilterNode | Record<string, any>` slot must widen it with `| undefined` and skip the
  filter when it is absent — the same handling `toFilterNode` has always needed. At
  runtime, a filter that is nothing but TRUE-identity combinators now returns every row
  (what objectstack#5322 rules) instead of failing the request.
  
  ⚠️ **Dated note, 2026-09-27 — an empty operator map no longer keeps the object — objectui#9164.**
  Later in this same release `convertFiltersToAST` refuses an empty operator map that is all
  a filter says (`{ a: {} }`, `{ a: {}, b: undefined }`, `{ $and: [], a: {} }`) with a
  `FilterOperatorError` instead of returning the object, so the sentence above that it
  "keeps the object" no longer holds for it; an all-null filter had already moved to
  `undefined` with objectui#9020. Only `{}` still comes back as itself. The rest of this
  entry is kept as the reading of this change; the objectui#9164 entry states what an empty
  operator map now answers.
- 84defab: The ingestion choke point says out loud when it CANNOT fold a retired spelling
  (objectui#8938)
  
  Maintainer ruling item 3 on objectui#7650 asked the retired-dialect fold for "a loud
  diagnostic (not a silent drop) for a spelling the choke point cannot fold". What shipped
  warned about the spelling it CAN fold and said nothing about the three it cannot, which is
  the half that matters to a reader: a key that folds reaches every consumer, and a key that
  does not reaches none of them — the retirement cards in this family (objectui#7155, #7166,
  #7435) narrowed those consumers to the canonical spelling.
  
  `normalizeSchemaReferenceKeys` now names all three refusals, in dev only and memoised per
  (object, field, spelling, reason), the discipline the two existing warnings already use:
  
  - **no declared twin** — `FieldSchema` declares neither the key nor anything sharing its
    alias spelling, so there is nothing to fold onto (`id_field`, `title_format`, and a typo
    such as `sortible`). The message ⛔ never offers a near match: the refused alternative
    was the spec's `lintAuthoredRecordKeys`, whose Levenshtein fall-through answers "did you
    mean `sortable`?" for that input, and a serve path that suggests a correction is one
    revision away from applying it.
  - **ambiguous probe** — two or more declared keys share the alias spelling, so the fold
    refuses to choose. Unreachable against a spec with no collision; the pin that exercises
    it substitutes a colliding `FieldSchema`.
  - **occupied canonical** — the declared twin is on the def carrying a **different** value.
    The producer's value stands (this choke point never overwrites one) and the retired value
    is inert. Same value under both spellings is deliberately silent: that is the state the
    pass leaves behind on its own second run, and the adapter re-serves a cached schema.
  
  **Nothing about which keys fold changes.** The diagnostic fires only on the paths that
  already left the key alone, the leave arm stays lossless, and it is a no-op under
  `NODE_ENV=production`. Whether the fold's full width — lock and gate keys included — is
  the intended accept set is an open decision on objectui#7650, untouched here.
  
  Landed with the width pin objectui#8938 asked for, which drives every snake twin the
  linked `@objectstack/spec` implies through the public choke point, and with the correction
  to the objectui#7650 changeset that presented a handful of keys as the accepted set.
  
  **Correction, 2026-09-30 (objectui#7650).** Two sentences above claim more than holds. "A key
  that does not reaches none of them" is true only of the consumers narrowed to the canonical
  spelling: some reads of a retired spelling were kept on purpose, so a value the choke point
  leaves alone can still reach a reader — `resolveActionParam` in `@object-ui/app-shell` reads
  `id_field` and `title_format` (kept by objectui#7435), and `resolveGroupByLabels` in
  `@object-ui/plugin-charts` reads `id_field`. Likewise, "the retired value is inert" holds only
  for consumers of the declared spelling (`deriveColumns` in `@object-ui/plugin-form` reads
  `display_field`). The diagnostic line now claims only what holds for every refusal: a consumer
  that reads only the spellings `FieldSchema` declares will not see the value. No read changes,
  and nothing about which keys fold changes.
- 681d3f1: Compose an `ObjectChart` drill-down filter instead of spreading it, so the widget's own
  filter survives into the drilled query for BOTH arms of `ObjectChartSchema.filter`
  (objectui#8944).
  
  **The defect.** `ObjectChartSchema.filter` admits a spec `FilterArray`
  (`[['region','=','emea']]`) and the ObjectQL `$filter` object (`{ region: 'emea' }`),
  and both are read — both travel verbatim to `ds.aggregate` / `ds.find`. The drill seam
  composed them by spreading the widget's filter into an object literal, which is correct
  for the object arm and silent nonsense for the array arm: spreading an array yields
  index keys, so an authored `FilterArray` drilled as
  `{ '0': ['region','=','emea'], stage: 'won' }` — the widget's conditions replaced by a
  key the query layer ignores. Nothing errored; the drawer opened and looked right.
  
  **Direction of the failure.** The widget's filter is what narrows. Dropping it made the
  drilled list a **superset** — it showed records the chart itself was scoped to exclude.
  Not a security boundary, but the worse direction for a silent bug.
  
  **The composition rule, named rather than picked.** `widget.filter ∧ drill.filter`. The
  two are independent filter sources and a drill must satisfy both: the click context only
  says which bucket of the widget's scope was asked for, so it may narrow that scope and
  never widen it. This is not a new rule — it is the contract `mergeFilterNodes` already
  states ("combine filter sources under a single `and`, each as its OWN child"), the sink
  every other multi-source filter in this repo goes through. A new
  `composeDrillFilter` helper in `@object-ui/core` applies it at the drill seam and
  documents it, then lowers the result back to the `FilterCondition` object dialect with
  `parseFilterAST` — the spec's single lowering sink — because that is the dialect both
  drill sinks take.
  
  **Compatibility.** A lone surviving source lowers back to exactly the flat object the
  spread produced, so a chart with no filter of its own drills byte-identically to before.
  Only a genuinely composed pair gains the `$and`.
  
  `serializeDrillFilterParams` (the drill "Open in list" / `target: 'navigate'` URL writer)
  learns to flatten that `$and` into the flat `filter[...]` params its own read side already
  ANDs back together. Without that it took the `String(value)` path — `$and` holds an array —
  and emitted `filter[$and]=[object Object],[object Object]` while both real conditions
  vanished, which is the outcome that function's contract says it never produces.
- f3bc481: `object-grid` normalizes its `sort` before joining it into `$orderby` (objectui#8973).
  
  **The defect.** `ObjectGrid` lowers `schema.sort` with private code rather than the
  shared sink, and its array arm interpolated every key unconditionally:
  
  ```js
  params.$orderby = schemaSort.map((s) => `${s.field} ${s.order}`).join(', ');
  ```
  
  So an entry missing `field` or `order` reached the wire as the literal text
  `undefined`. The legacy `defaultSort` arm one `else` down had the identical defect on a
  single object, and was fixed with it at this change — leaving it would have kept the class
  open inside the same `if`/`else` chain.
  
  ⚠️ **Dated note, 2026-09-25 — that legacy arm has since been retired — objectui#5861.**
  Later in this same release `ObjectGrid` stopped reading `defaultSort` at all (an ADR-0049
  retirement tombstone), so the chain has two arms, header sort and `sort`. Everything else
  in this entry, including the table below, concerns `sort` and still holds.
  
  This is a wire failure, not a cosmetic one. `normalizeSortNodes` — the one normalizer
  every `@objectstack` server ingress funnels through — validates the direction token, so
  `$orderby: 'name undefined'` is answered `400 INVALID_QUERY`, while `'undefined desc'`
  becomes a well-formed sort on a column literally named `undefined`.
  
  **What changes on the wire.** Only inputs that were already broken:
  
  | authored `sort` | before | after |
  | --- | --- | --- |
  | `[{ field: 'name', order: 'desc' }]` | `"name desc"` | `"name desc"` (unchanged) |
  | `[{ field: 'name' }]` | `"name undefined"` | `"name asc"` |
  | `[{ field: 'name', order: 'desc' }, { field: 'status' }]` | `"name desc, status undefined"` | `"name desc, status asc"` |
  | `[]` | `""` | key omitted |
  | `['name desc']` | `"undefined undefined"` | key omitted |
  | `[{ order: 'desc' }]` | `"undefined desc"` | key omitted |
  
  **The wire SHAPE does not move.** The `"field order"` join string stays. Routing this
  arm through `convertSortToQueryParams` would send that sink's `{field: direction}` map
  instead — route B on objectui#8767, which the maintainer declined by name on 2026-09-10
  pending a card that measures the server contract and both readers.
  
  **New in `@object-ui/core`:** `normalizeSortEntries` (and its `NormalizedSortEntry`
  type) — the "which entries survive, and what does a missing `order` mean" decision,
  lifted out of `convertSortToQueryParams`, which is now a map projection of it. This is
  what lets a block sending a different wire shape share the one implementation of the
  rule instead of keeping a private copy that drifts. `convertSortToQueryParams`'s own
  behaviour is unchanged and pinned against literals captured from the previous
  implementation.
  
  **Two false docblock sentences corrected** (`@object-ui/types`' `ObjectGridSchema.sort`
  and this sink's own header). Both read "`order` is optional and means `'asc'`" — the
  first sitting two lines above a declaration that requires it. `SortConfig.order` is
  required on the interface, on the zod mirror, and on `@objectstack/spec`'s
  `SortItemSchema`, which refuses an entry without it. An author following that
  prescription wrote metadata the spec rejects. objectui#8767's contract review routed
  both sentences to this card by name; comments only, no behaviour.
- b79aac2: `convertFiltersToAST` accepts `$icontains`, the canonical case-insensitive `contains`
  the rest of the stack already spoke (objectui#8976).
  
  `$icontains` is a member of `@objectstack/spec`'s `FILTER_OPERATORS`, `ValueDataSource`
  executes it, `FilterConditionField` emits it for its "contains (ignore case)" builder
  row, and `packages/core/src/adapters/README.md` prescribes it as the repair when
  `$like` / `$ilike` / `$regex` are refused. `convertOperatorToAST` had no row for it, so
  the ObjectStack lowering path answered a `FilterOperatorError` (`code:
  'INVALID_FILTER'`, `httpStatus: 400`) with the generic unknown-operator paragraph — the
  one spelling this repo tells an author to write was the one spelling it rejected. An
  admin who picked "contains (ignore case)" in the filter builder authored criteria that
  the in-memory matcher honoured and the ObjectStack data source refused.
  
  `{ name: { $icontains: 'john' } }` now lowers to `['name', 'icontains', 'john']`. The
  value is an identity because `icontains` is itself a member of the spec's
  `VALID_AST_OPERATORS`: unlike `$startsWith` → `startswith` there is no case to squash,
  and the spelling the author writes is the spelling the AST carries. No existing filter
  changes shape — this is a refusal becoming an acceptance, so nothing that lowered
  before lowers differently now.
  
  Two smaller repairs ride along, both consequences of the same gap. The
  unknown-operator message now enumerates `$icontains` among the supported operators, and
  the `$regex` refusal now prescribes it by name for a case-insensitive substring —
  `@objectstack/spec`'s own `FILTER_TEXT_CASES` requires that refusal to mention
  `$icontains`, and it could not while the converter did not accept it.
  
  This is the opposite leg of objectui#8568, which retired four lowercase aliases the
  converter accepted and the matcher refused. There the converter was more tolerant than
  the contract; here it was less tolerant than it. The two needed different fixes: a
  single "make the two sides agree" change would have widened the matcher instead.
- 19a0b0e: `convertFiltersToAST` refuses the two `$icontains` comparand shapes the contract
  declares refused, instead of lowering them onto the wire (objectui#9001).
  
  `@objectstack/spec`'s `FILTER_TEXT_CASES` carries an empty `$icontains` comparand and a
  non-string one as REJECTION rows, each with `code: 'INVALID_FILTER'` and
  `mustMention: ['$icontains']`. `ValueDataSource` has answered both since objectui#8748
  (`refuseTextComparand`); this converter answered neither. Measured with both faces in
  one process, `{ name: { $icontains: '' } }` and `{ name: { $icontains: 42 } }` were
  refused by the in-memory matcher and lowered to `['name', 'icontains', '']` /
  `['name', 'icontains', 42]` by the ObjectStack path — one authored filter with two
  fates, decided by which data source happened to be behind the view. That is the
  acceptance-set split objectui#8568 and objectui#8976 each closed on the operator-KEY
  axis, here on the COMPARAND axis.
  
  Both shapes now raise the `FilterOperatorError` this file already uses for `$regex`,
  `$not`, the retired aliases and three other comparand shapes — `code: 'INVALID_FILTER'`,
  `httpStatus: 400`, which `classifyLoadError` renders as "this filter is malformed"
  rather than as a network fault. The refusal is a PORT of `refuseTextComparand`, not a
  second design: the discrimination and the message text are the sibling's, because
  `mustMention` makes the wording part of the contract rather than a stylistic choice, and
  a test drives both faces and pins the converter's message to contain the matcher's
  refusal verbatim so the mirror cannot drift in silence. What deliberately does not
  transfer is the DELIVERY: the matcher excludes-and-logs because it is deciding about one
  row, while this function is the producer deciding whether to send a query at all and has
  no row to exclude.
  
  **This narrows what the converter accepts, and that is the point.** A caller that hands
  it `{ field: { $icontains: '' } }` gets a refusal where it used to get a lowered node.
  Nothing was relying on the old answer to select rows: the empty comparand is a predicate
  that constrains nothing, so the node either widened a list to every row or — for the
  non-string comparand — asked the backend a question nobody wrote after a coercion nobody
  requested. `@object-ui/data-objectstack`'s `translateFilterToAST` delegates its object
  branch to this function, so its `$`-dialect route inherits the refusal without a source
  change of its own.
  
  **Migration.** A producer that can emit an operator row with an empty value box must drop
  the condition rather than send it — the same repair the refusal message prescribes.
  `FilterConditionField` already does this (objectui#8748 shipped the producer half). The
  sibling positive operators `$contains` / `$startsWith` / `$endsWith` are untouched: the
  table declares no such row for them, and widening by analogy is the published table's
  decision, not this converter's.
- 804831c: A render-time filter refusal now renders a named "this view's filter is malformed" state instead of throwing out of render (objectui#9050).
  
  `convertFiltersToAST` refuses eleven authored shapes with a `FilterOperatorError`, and
  `toFilterNode` delegates to it from four call sites that are not on the wire path:
  `RelatedList`, `LineItemsPanel` and `ObjectGrid` read it from a render-time `useMemo`
  (where a throw is a render error, with no `classifyLoadError` to turn it into "the
  filter is malformed"), and `ObjectGrid`'s deprecated `defaultFilters` leg reads it
  inside the load effect, which caught the refusal but reported it under "Error loading
  grid" over the converter's English paragraph.
  
  What changes:
  
  - `@object-ui/core` gains `toFilterNodeSafely`, whose result is a UNION — `{ ok: true,
    node }` or `{ ok: false, refusal }`. The refusal is deliberately NOT representable as
    `undefined`: `undefined` means "no filter", i.e. every row, which is the silently
    unconstrained query objectui#9001 closed. A caller must narrow before it can build a
    query.
  - `FilterOperatorError` now carries `operator` and `field` as data, and
    `filterRefusalSubject` picks the token a diagnostic names. The eleven messages
    deliberately share no idiom, so recovering that token by pattern would be a twelfth
    dialect. `operator` is the spelling the AUTHOR wrote, never a canonical form
    substituted for it; it is absent on exactly the two arms that judge a comparand
    written with no operator in it, where `field` is the only handle.
  - The three render-time readers keep the refusal as a value, send nothing, and render a
    state that names the operator. The subtree around them is unaffected — on the
    schema-rendered path a `SchemaErrorBoundary` already contained the throw, so what is
    new there is the DIAGNOSIS in place of a generic "Component failed to render"; mounted
    directly, which every one of these components supports through its package entry,
    there was no boundary at all and the throw reached the host.
  - `view.malformedFilter` is added to all ten locale packs and to the three affected
    `createSafeTranslation` tables.
  
  ⛔ Not changed: which shapes convert. The converter's accept set is byte-identical —
  this is a delivery change, not an acceptance one. Where the protocol's own parse accepts
  an input this layer refuses, that gap is the protocol's to close and is filed against
  `@objectstack/spec` rather than papered over here.
  
  ⚠️ **Dated note, 2026-09-27 — one more refusal carries no operator — objectui#9164.**
  Later in this same release `convertFiltersToAST` also refuses an empty operator map that
  is all a filter says (`{ a: {} }`). Its `FilterOperatorError` carries `field` and no
  `operator`, like the two comparand arms, so `filterRefusalSubject` names the field and
  the three render-time readers show the malformed-filter state for it. The counts above
  (eleven shapes, two arms without an operator) are this change's reading. The rest of this
  entry is kept as the reading of this change; the objectui#9164 entry states the new
  refusal.
- 835f0f3: Conjoin the widget filter into a dataset drill instead of SPREADING it
  (objectui#9137) — the third and last site of the mis-composition objectui#8944
  removed from `ObjectChart` and objectui#9024 removed from `ObjectPivotTable`.
  
  `buildDatasetDrillFilter` ended in `{ ...runtimeFilter, ...drillFilter }`.
  Spreading is correct only for the object-dialect arm, and this site's declared
  producer sends the other one: `DashboardWidgetSchema.filter` says so in as many
  words — "objectui passes an ObjectQL FilterNode array here, not the spec's
  `FilterCondition` envelope" — and `DatasetWidget`'s guard admits an array
  (`typeof [] === 'object'` is true and `Object.keys(['x']).length` is 1). So the
  arm the type's own docblock names as the one objectui sends reached the spread,
  where `[['region','=','emea']]` became the index key `{ '0': [...] }`.
  
  **Breaking, deliberately** — the level is `minor` because every package in this
  repo sits in one `fixed` group and `major` would drag the whole group off the
  `@objectstack` major it tracks. What changes for a caller: when a widget filter
  IS present, the composed drill filter is now `{ $and: [<widget>, <drill>] }`
  rather than one flat object, and a field named by BOTH sources now applies both
  conditions instead of letting the clicked bucket overwrite the widget's. That is
  the repair — a drill may narrow the widget's scope and may never widen it. The
  result is produced by `composeDrillFilter`, the seam objectui#8944 added, which
  routes both arms through this repo's single filter confluence `mergeFilterNodes`
  and lowers the answer back to the object dialect; no local composition is
  derived here. The `runtimeFilter` parameter widens from
  `Record<string, unknown>` to `unknown` so the arm the declaration names is
  admitted without a cast — a widening, so no call site has to change, and
  neither consumer's own type was touched.
  
  **Unchanged on purpose.** With no widget filter there is nothing to conjoin, so
  that leg still returns the drill filter verbatim, byte for byte. Routing it
  through the sink anyway was measured and rejected: a lone source of two or more
  conditions also lowers to `$and`, which would have re-shaped every
  multi-condition dataset drill — including paths pinned by objectui#9085,
  objectui#4056, objectstack#5473 and #1752 — for no change in the rows selected
  or the `filter[...]` params emitted.
  
  ⚠️ **Dated note, 2026-09-29 — the last pinned path in the list above is objectstack's — objectui#11016.** The list of
  pinned paths above ends with a bare number after objectstack#5473, which in this
  repository resolves to an unrelated objectui pull request. It is
  objectstack-ai/objectstack#1752, the card that made a time-bucketed date dimension
  drill by range rather than by equality. The text above is kept as the reading of this change.
  
  **The failure direction, corrected by measurement.** This was filed and graded
  as a silent fail-OPEN superset, on the premise that an index key is one "nothing
  reads as a condition". It is not: a bare array is not a legal equality comparand
  in this dialect (objectui#8530 / objectui#8514), so `convertFiltersToAST`
  THROWS, the in-memory matcher selects nothing, and `driver-sql` answers
  `400 INVALID_FILTER`. The drilled list was dead, not wide. Pinned as row sets in
  `dataset-drill-array-arm-9137.test.ts`.
- 729e851: `ValueDataSource` deep-clones its inline rows with `structuredClone` instead of
  `JSON.parse(JSON.stringify(...))` — in the constructor and in `getAll()`
  (objectui#9175, maintainer ruling A on objectui#9061).
  
  **Why the round-trip was wrong.** The clone exists for exactly one reason, stated
  in the comment above it: "Deep clone to prevent external mutation". That is an
  ALIASING barrier on a read-only query source. A JSON round-trip is an aliasing
  barrier too, but it is also a SERIALIZATION boundary — and nothing asked for one.
  So every row that reached `provider: 'value'` silently acquired a requirement the
  contract never states. `ViewData.items` is `z.array(z.unknown())` in
  `@objectstack/spec`, not an array of JSON, and objectui#6018 pinned the
  consequence in words: an inline value never has to be serializable at all. That
  guarantee became false the moment a renderer routed its inline rows through this
  adapter to honour `filter` / `sort` / the objectui#7210 row ceiling.
  
  **Behaviour that moves — measured, per shape.** Inline rows now reach the
  renderer as authored:
  
  | in `items` | before | now |
  | --- | --- | --- |
  | `Date` | ISO **string** | a `Date` |
  | key whose value is `undefined` | key **deleted** | key kept, value `undefined` |
  | `Map` / `Set` | `{}` | a `Map` / a `Set` |
  | `RegExp` | `{}` | a `RegExp` |
  | `NaN` / `Infinity` | `null` | `NaN` / `Infinity` |
  | `BigInt` | **threw** `TypeError` | the `BigInt` |
  | cyclic row graph | **threw** `TypeError` | the graph, cycle intact |
  | a function-valued key | key **deleted**, silently | **throws** `DataCloneError` |
  
  Two consequences worth naming because they are observable through the adapter's
  own API rather than only in the rows: `getObjectSchema` infers types with
  `typeof`, so a `Date` column now infers `'object'` where it inferred `'string'`,
  and a key whose value is `undefined` now appears in the inferred schema at all;
  and `$orderby` on a `Date` column now sorts chronologically rather than
  lexically over ISO text (the same order for ISO-8601, a different one for any
  other date rendering).
  
  **The last row of that table is the only narrowing, and it is deliberate.** A
  function in a row used to vanish without a word; it now fails loudly at
  construction. There is no `try`/`catch` fallback to the round-trip, because a
  fallback would restore precisely the silent flattening this replaces — the
  maintainer's ruling was to fix the clone, not to make it tolerant.
  
  **Migration.** Code that relied on reading a `Date` back as a string (for
  example `row.start.slice(0, 10)`, or `===` against an ISO literal) must read it
  as a `Date`. Code that relied on an `undefined`-valued key disappearing must test
  the value rather than `in` / `hasOwnProperty`. A row carrying a function must
  stop doing so — inline rows are data.
  
  Marked `minor` rather than `major` per this repo's version-alignment rule
  (objectui's major tracks `@objectstack`'s); the breaking semantics are the table
  above.
- 20b507a: A picklist option with a blank label now renders its `value` instead of a blank row.
  
  Adding a picklist option in App Builder and filling only the value box publishes
  `{ "value": "low", "label": "" }`, and the record form's select then offered three
  unclickable blank rows with nothing anywhere explaining why.
  
  **The producer was not the bug.** An empty label is a document the contract accepts —
  measured on `@objectstack/spec` 17.4.0, `SelectOptionSchema` accepts
  `{ value: 'low', label: '' }` and refuses `{ value: 'low' }` at `[label]` — so `''` is
  the only legal thing the designer can write for a cleared Label box, and it writes it
  deliberately (`f0f774b0d`, pinned). What the contract does not state is what a
  renderer should DISPLAY for a legal-but-blank label, and objectui had already answered
  that on half its read sites: all four option widgets fell back to the value on their
  read-only path (`opt?.label || v`) and rendered `{opt.label}` raw on their interactive
  path. The same option read `low` in a read-only form and blank in an editable one.
  
  `optionDisplayLabel` in `@object-ui/core` is now that decision written once —
  label, or the value when the label is blank or whitespace-only — and all eight read
  sites across `SelectField`, `MultiSelectField`, `RadioField` and `CheckboxesField` call
  it, so the two halves cannot drift apart again. Radio and checkbox rows gain real
  `<label for>` text with it, which is hit area and an accessible name, not just glyphs.
  
  Minor rather than patch on the stored-data test: every option already published with an
  empty label renders differently after this change, without the document moving. It also
  adds one public export to `@object-ui/core`.
  
  This is display only. Nothing is rewritten, no metadata is migrated, and whether the
  contract should refuse blank labels outright stays a `packages/spec` question.
- 72d6587: A record id is a `string` everywhere in the published types, as
  `@objectstack/spec` has always declared it. Three published declarations that
  admitted `number` no longer do.
  
  ⚠️ **BREAKING if your code hands a numeric primary key to any of these three:**
  
  - **`RecordContextValue.recordId`** (`@object-ui/react`) — the value
    `useRecordContext()` gives you is now a `string`, never a `number`.
  - **`DataSource.update`'s `id` parameter** (`@object-ui/types`) — a call that
    passes a `string | number` is now a type error. Adapters that *implement*
    `DataSource` are unaffected (see Migration).
  - **`TransactionOperation.id`** (`@object-ui/core`) — the operation record you
    hand to `TransactionManager.recordOperation()` must carry a `string` id. If
    you build that object from a numeric key, convert it where you build it. This
    type is exported from the package root, so this is a breaking change for
    `@object-ui/core` consumers in its own right, not just a knock-on.
  
  Ships as `minor` per the launch-window convention: objectui's
  `major` is a cross-repo pin to `@objectstack`'s so that "same major means
  compatible" holds across the two repos
  (`scripts/check-changeset-no-major.mjs`), and objectui's own breaking changes
  ship as `minor` with the break named where it lands — this entry is the channel
  that carries it.
  
  ## What changed
  
  - `RecordContextValue.recordId` (`@object-ui/react`) was
    `string | number | null | undefined`; it is now `string | null | undefined`.
  - `DataSource.update`'s `id` parameter (`@object-ui/types`) was
    `string | number`; it is now `string`.
  - `TransactionOperation.id` (`@object-ui/core`) was `string | number`; it is now
    `string`. Its sibling `BatchTransactionOperation.id` was already a `string`,
    so the two operation records finally agree.
  - `LineItemsPanel` (`@object-ui/plugin-form`) drops the type assertion
    objectui#9304 left on its parent id. That assertion was the only thing making
    the context declaration and `buildMasterDetailEditBatch(parentId: string)`
    meet; the declaration now does it, so the evidence is discharged.
  
  ## Why the protocol, and not a wider consumer type
  
  `@objectstack/spec` declares a record id as `z.string()` on every record door —
  get, update, delete and the batch operation. A consumer type may not be wider
  than the protocol: a declaration that admits `number` promises callers something
  the wire never carries, and the promise is kept only by an assertion at the far
  end, which is what this card was filed about.
  
  ## Internal consumers repaired at the same time (no public contract moves)
  
  Narrowing an interface **parameter** never reaches implementors — TypeScript
  compares method parameters bivariantly, so an adapter that still declares
  `id: string | number` keeps satisfying `DataSource`. It reaches **callers**. A
  full local type-check of every workspace type-check program found exactly six,
  in three packages, and each was red because a further declaration one layer in
  was itself wider than the protocol. All three are narrowed here, types only, with
  no runtime change and no coercion added at any call site:
  
  - `UserPreferenceRecord.id` and the `cachedRowId` it feeds
    (`@object-ui/data-objectstack`) are `string`. Module-local, not published —
    these rows are read back off the protocol, so the union was a claim the wire
    never makes.
  - `resolveRecordId`'s return type (`@object-ui/plugin-grid`) is
    `string | undefined`. Module-local, not published — it annotates `any`-typed
    row data, so the union was an assertion rather than a measurement.
  
  ## Migration — no `String(...)` at your call sites
  
  `RecordContextProvider` still **accepts** `string | number | null | undefined`
  and narrows it once, itself. A host that mounts a record with a numeric primary
  key therefore changes nothing: the conversion is paid at that injection
  boundary, typed, in one place. Consumers of `useRecordContext()` read a
  `string`.
  
  `DataSource` implementors are unaffected — TypeScript compares method parameters
  bivariantly, so an adapter that still declares `id: string | number` continues
  to satisfy the interface. What changes is the **caller** side: a call that passes
  a `string | number` to `dataSource.update` is now a type error. A backend whose
  primary keys are numeric maps them at its own adapter boundary rather than
  pushing the union through every caller.
  
  For `TransactionOperation`, the same rule applies one level up: build the
  operation record with a `string` id. If the id arrives from a numeric-keyed
  backend, convert it in your adapter — the one place that knows the backend's key
  type — rather than at each `recordOperation()` call. Nothing about this change
  alters what is sent over the wire; only the declarations moved.
- ba0b61a: feat(core): export `declaredNameField`, the one spelling of the ADR-0079 declared name pointer (objectui#9436)
  
  `declaredNameField(objectDef)` returns the object's declared record-title
  pointer exactly as `getRecordDisplayName` reads it at steps 1+2: the canonical
  `nameField`, then the deprecated `displayNameField` and `NAME_FIELD_KEY`
  aliases. It returns `undefined` when none is declared. It never derives, and
  that is the difference from `resolveNameField`, which falls back to the
  type-aware derivation.
  
  The function already existed privately in `record-title.ts` and its behaviour
  is unchanged. It is exported so that a caller which renders `titleFormat`
  itself can rank the declared pointer above the template and the derivation
  below it, without re-typing the `??` chain:
  
  ```ts
  import { declaredNameField, recordDisplayValueAt } from '@object-ui/core';
  
  const declaredTitle = recordDisplayValueAt(record, declaredNameField(objectDef));
  ```
  
  `PageHeaderRenderer` (`@object-ui/components`), `DetailView` and the
  `record:details` H1 dedupe (`@object-ui/plugin-detail`) read it this way in
  the same release.
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
- f0f4d6c: `SchemaRenderer` no longer spreads an authored `data` key as a React prop for blocks
  whose published `data` row is the `ViewData` OBJECT arm (objectui#9571, ruling
  objectui#8348 Q2-C, decision batch #136 item 3, maintainer 「同意」).
  
  **Behavioural, deliberately.** 「8348 以协议为准」 (batch #83) retired the bare-array
  `data` shorthand at the shared record-source ladder, but the key had a second carrier
  that the ruling did not reach and that outranked the first: `SchemaRenderer` spreads
  every non-metadata node key as a React prop, and `ObjectGrid` (`passedData`),
  `ObjectMap` (`dataProp`) and `ObjectGantt` each lift a `data` PROP with an
  unconditional `Array.isArray` ahead of the ladder. So an authored
  `data: [ …rows… ]` on `object-grid` / `object-map` / `object-gantt` still drew,
  end-to-end, after the ladder had refused it. AGENTS.md #0.1: one key, one honoured
  spelling — the tolerated second carrier is the defect.
  
  An authored `data` now reaches such a block only as `schema.data`, judged by the
  block's own row. In development the renderer says so, once per node: the ladder emits
  no runtime signal of its own, so without that warning the retirement would land as a
  page that quietly stopped drawing.
  
  **Unchanged, and refused on purpose.** The `data` PROP itself. Gating the prop on the
  arm (option B) was refused because that prop is how a host — `plugin-list`'s
  `ListView`, `ObjectView` — hands down rows it already fetched. A host rendering
  `<ObjectGrid data={rows} …/>` directly, or passing `data` through `SchemaRenderer`'s
  own props, still delivers those rows, and still outranks the authored key.
  
  Blocks on the ARRAY arm are untouched: `object-calendar`'s published row is
  `z.array(...)`, so its authored bare array is on-contract and keeps the prop seat.
  Every type the new reading does not list keeps today's behaviour verbatim.
  
  **Migration.** Author inline rows the declared way —
  `data: { provider: 'value', items: [...] }` — or keep using the deprecated
  `staticData: [...]` array, which is unchanged. Both were already the only spellings
  `os validate` and the save gate accepted.
  
  `@object-ui/core` gains one export, `recordSourceDataArmForType(type)`: which `data`
  arm a registered block type declares. It exists for the one consumer that cannot be
  handed the arm as a parameter — `SchemaRenderer`, which is generic over every
  registered type.
- 5eabe86: Drop a saved view's row cap that the contract refuses, at the LOWERING layer every
  repaired read point sits under — and say so on the one path that has no renderer to
  say it (objectui#9928).
  
  `savedViewLimit` admitted its carrier on `typeof … === 'number'` alone, so a saved
  view's `pagination.pageSize` (or its legacy flat `limit`) of `0`, `-10` or `25.5`
  lowered unchecked into the composed `limit`. Both ends of that journey are declared
  positive — the spec's element data source declares `limit` a positive integer, and a
  view's pagination declares `pageSize` a positive integer with a default — so the
  lowering layer in between was the one place that asked nothing.
  
  The two consumers of the composed key behave differently, and both were measured
  rather than inferred:
  
  - through a RENDERER, the refused value reached a block that has its own guard, so
    the block dropped it and drew its own default — the named view's cap went missing
    and the read went **wider** than the view asked for, in the one direction a named
    view exists to prevent;
  - through `ViewDataProvider.resolveElementDataSource`, which forwards this key
    straight to `DataFetcher.fetchRecords` with **no guard of its own**, `0`, `-10` and
    `25.5` reached the fetcher verbatim and nothing anywhere said so.
  
  The cap is now **dropped**, not clamped and not thrown. Clamping was refused because
  this layer has no default to clamp to — every consuming block owns its own default
  and `ViewDataProvider` owns none, so a number invented here would override a default
  the author never asked it to. Throwing was refused because the composer is pure and
  sits under every block that can be bound to a view.
  
  Dropping alone would have been silent, and worse than silent: the renderer that used
  to report the refused value now receives nothing and correctly says nothing, so the
  repair would have removed the only place the author was being told. New export
  `elementDataSourceRefusedLimitMessage` is the loud half — a pure builder, following
  the shape `elementDataSourceViewNotFoundMessage` already established in this module so
  that every caller reports the same defect the same way. `ViewDataProvider` reports it
  on the `console.warn` channel the repaired read points use; the value is fail-soft, so
  records still load.
  
  Unchanged: carrier precedence (a non-numeric `pagination.pageSize` still falls through
  to the flat `limit`), every other composed key, and the binding's own `limit`, which
  overrides a view cap exactly as before.
- 6791717: A dataset-bound chart authored with an inline-locale-map `title` / `subtitle` /
  `description` now draws its heading instead of drawing none (objectui#9038).
  
  `@objectstack/spec` types `ChartConfigSchema.title` / `.subtitle` / `.description` as
  `I18nLabel` — a plain string OR an inline locale map — so
  `{ "chartConfig": { "title": { "zh-CN": "定价", "en": "Pricing" } } }` is authored
  surface, not an accident. `chartConfigPresentation` lowered all three through a local
  limb that admitted only a plain string, so the map arm returned `undefined`, the
  `if (title)` guard skipped the assignment, and the key never reached the result. The
  chart then drew **no heading at all**, in every language, with no diagnostic.
  
  Note the shape of it, because it is not the sibling defect objectui#8943: the value was
  not resolved badly, it was not resolved at all. There was no heading to compare against a
  locale, so no locale-comparison check could see it, and an author who wrote spec-legal
  metadata saw a chart that looked as though it had simply been given no title.
  
  The three keys are now carried through **unresolved**, as the union the spec declares,
  and resolved where the viewer is known:
  
  - `normalizeChartSchema` (`@object-ui/plugin-charts`) already resolves exactly these
    three slots through `pickLocalized` against the language `ChartRenderer` reads from
    `useObjectTranslation()` (objectui#8943), and `ObjectChart` reads `schema.title`
    through the same resolver for its drill heading. Forwarding is what lets that
    resolver see the value; `pickLocalized` remains the one answer for the union.
  - Resolving inside `@object-ui/core` was measured and is unavailable, not merely
    undesirable: `pickLocalized` lives in `@object-ui/i18n`, which DEPENDS on this
    package. Declaring the reverse edge makes the build graph cyclic — `turbo run build
    --filter=@object-ui/core` refuses with `Cyclic dependency detected` — and that
    package's entry point is a React provider plus hooks, which this package does not
    admit.
  - No signature changed. `chartConfigPresentation(raw, fieldCategoryColors?)` takes the
    same two arguments, every existing caller compiles, and every key other than those
    three is byte-for-byte unchanged.
  - The admission test did not widen. A plain string, or a record carrying at least one
    usable string entry — the same "is there anything here" question the old truthiness
    guard asked, extended to the map arm. A number, a boolean, an array, `''`, `{}` and a
    record with no string value are all still refused rather than stringified, because
    broadening what the renderer accepts belongs in the spec and not in a renderer-side
    coercion (AGENTS.md #0.1).
  
  Two neighbouring cases stay unresolved on purpose and are now ledgered by name in the
  source: a series `label` and an axis `title` still take `labelText`'s first-string-wins
  pick (objectui#4020 — a locale-unaware choice a caller can override, which is a different
  question from an erasure); and `plugin-report`'s `DatasetReportChart` paints the report
  chart's own `h3` from a plain-string narrowing of `chart.title` of its own, so a
  locale-map title still draws no heading on that surface. `subtitle` and `description` do
  reach the chart there and are fixed by this change.
- d7573b3: `ComponentInput` is now declared once and re-exported, instead of restated in three
  places (objectui#4972).
  
  `@object-ui/core`'s `ComponentInput` (`registry/Registry.ts`) and `@object-ui/types`'
  plugin-scoped `ComponentInput` (`plugin-scope.ts`, published as `PluginComponentInput`)
  were structural copies of the interface in `@object-ui/types`' `base.ts`. Both are now
  re-exports of that one declaration, which is the disposition objectui#4580 ruled for the
  identical shape — *a structural copy would reproduce the defect the moment either side
  moved* — and the way `core/src/types/index.ts` already handles `SchemaNode`.
  
  Either side had already moved. `base.ts` declared thirteen keys; both copies declared
  nine, so `min` / `max` / `step` / `placeholder` were missing from **the copy every
  component registration actually imports**. Those four keys were unwritable at any real
  registration — a plain TypeScript error at the call site — while `ComponentInputSchema`
  (the zod schema) and `ComponentMeta.inputs` both accepted them. The publication face
  advertised four keys the authoring face rejected. Measured over the repository, no
  registration had tried to write one yet, so nothing a user hits was broken today; what
  changes is that the four keys become writable, and there is no longer a second
  declaration for the next widening to miss.
  
  `ComponentInput`'s arm vocabulary (`ComponentInputControlType`) was already a single
  declaration imported by all three sites (objectui#3832); this converges the rest of the
  interface.
  
  Measured, not assumed: `@object-ui/core`'s published entry `dist/index.d.ts` is
  byte-identical across the change (sha256 `f6494f80…`, both legs). That gauge is reported
  here only with its control — a probe that added a *required* key to `ComponentInput` left
  the same file byte-identical, because `dist/index.d.ts` is a 63-line barrel of
  `export *` lines that names `ComponentInput` zero times. The gauge that can actually fail
  is the emitted declaration file: `dist/registry/Registry.d.ts` changes, as does
  `@object-ui/types`' `dist/plugin-scope.d.ts`, and those two files are the *only* emitted
  declarations that change in either package.
  
  `WidgetInput`'s union-arm capability is deliberately untouched — a different gate path
  and a separate judgment.
- bf3edfe: `ComponentRendererProps` is now declared once and re-exported, instead of
  hand-declared a second time in `@object-ui/core` (objectui#4594).
  
  `@object-ui/core`'s `ComponentRendererProps` (`src/types/index.ts`) was a
  non-generic interface typing `schema` as `SchemaNode`, while
  `@object-ui/types`' declaration of the same name is generic —
  `ComponentRendererProps< TSchema extends BaseSchema = BaseSchema >` with
  `schema: TSchema`. Same name, both exported from their package entry, from two
  packages the same consumers import together: which declaration a call site got
  depended on which package it reached for, and the two disagree about whether a
  primitive node is admissible. Core's is now a re-export of types', which is the
  disposition objectui#4580 ruled for `SchemaNode` two lines above it in the same
  file, and objectui#4972 for `ComponentInput` — *a structural copy would
  reproduce the defect the moment either side moved*.
  
  **Published-surface effect, and the reason it is not neutral.** Resolved
  through the TypeScript checker from `core/dist/index.d.ts` over a clean rebuild
  of both legs, `ComponentRendererProps` as reached through `@object-ui/core`
  moves from non-generic with
  `schema: BaseSchema | string | number | boolean | null | undefined` to
  `ComponentRendererProps<TSchema>` with `schema: TSchema`, defaulting to
  `BaseSchema`. `schema` therefore **narrows** back to the object form — core's
  copy had silently widened when objectui#4608 made core's `SchemaNode` a
  re-export of types' union — and the type gains a parameter. **Nothing imported
  it**, on either side, re-verified repo-wide on the merged ref, so no call site
  can observe either move; the narrowing is recorded here because it is a change
  to a published type, not because a consumer is affected.
  
  A compile-time pin now holds the reconciliation from
  `@object-ui/react` — the only position that resolves both packages through
  `node_modules` — alongside the existing `SchemaNode` one. It is a test-only
  addition and emits nothing, so `@object-ui/react` takes no bump of its own.
- 5aed9e4: `DataScopeManager` now **denies** a row when a scope rule names something that is not the record's own data, and when an ordered comparison would only succeed by coercing one of its two sides. It used to **admit** those rows.
  
  Two fail-opens on a row-level permission boundary, both measured against the previous release's source, both the same silent direction as objectui#7378 — a result set that is too large, with no error and no console line, which looks exactly like a correctly configured permissive scope.
  
  **The field a rule names is now read as an own member of the record, or not read at all.** `{ field: 'constructor', operator: 'ne', value: anything }` returned the ENTIRE dataset: the name resolved on the prototype chain, `Function !== 'x'` is true, and every row passed the rule that existed to hide it. The read now has three cases instead of one. A name in the refused list (`__proto__`, `constructor`, `prototype`) denies. An own member is read as before. A name that is not an own member but still resolves on the record's prototype chain — `toString`, `valueOf`, `hasOwnProperty`, or a field inherited from an `Object.create` parent — denies, because the value exists but is not this record's data. A name that resolves nowhere is a genuinely absent field and still reads as `undefined`, so the ordinary "this row has no `status`" rules keep every verdict they have always had.
  
  That third case was deliberately stricter than `evaluateCondition` in `@object-ui/permissions` as that evaluator then stood, which this card was filed to converge with. Reading with `hasOwnProperty` alone — the sibling's shape at the time — collapses "inherited" into "absent", and absent ADMITS on a negative operator, so the sibling returned `true` for `{ field: 'toString', operator: 'neq' }` on every record (filed as objectui#8044, and fixed since by PR objectui#8669, which ported this three-case read into the sibling). Converging on the sibling's exact lines would have closed three spellings and left the class open, and would itself have widened one case: an inherited field value flips from denied to admitted under `ne`. Distinguishing inherited from absent closes the class and keeps the change a narrowing everywhere.
  
  **Ordered comparisons (`gt` / `gte` / `lt` / `lte`) now require both sides to be the same comparable kind.** `{ field: 'age', operator: 'gte', value: 0 }` admitted records whose `age` was `null`, `'10'`, `true`, `false`, `''` or `[]` — every one of them through a coercion to a number that the rule's author never wrote. Both sides must now be numbers, or both strings, or both `Date`s.
  
  Same KIND, not "both numbers". The sibling requires `typeof === 'number'` on both sides; copying that predicate would have denied every row for `{ field: 'created', operator: 'gte', value: '2023-01-01' }`, since ISO date strings, plain string ranges and `Date` objects all order correctly on this evaluator today and none of those comparisons coerces anything. The hazard is cross-kind comparison, so cross-kind is what is refused.
  
  **`contains` now requires its rule value to be a string** rather than calling `String()` on it, so `{ operator: 'contains', value: 1 }` no longer matches the record value `'10'`. Same unwritten coercion as the ordered arms; the sibling already refused it.
  
  **The narrowing, named plainly for anyone upgrading with rules already stored.** A legitimate rule loses rows in exactly three shapes. A numeric rule (`age gte 18`) over a dataset where numbers arrive as strings — from JSON, a CSV import, an unparsed form field — stops matching those records; `'20'` was admitted by coercion and is now denied, and the fix is to parse the field at the producer rather than to widen the rule. A rule reading a field that records inherit from a shared prototype rather than own stops matching. And a `contains` rule written with a non-string value stops matching. Measured over a 2772-case differential matrix of value kinds, operators and record shapes: 352 verdicts narrowed, **zero widened**, and zero change to the genuinely-absent-field family.
  
  Operator SPELLING is untouched, deliberately: `ne` / `nin` here versus `neq` / `not_in` in the sibling, and the sibling's `is_null` / `is_not_null` which this evaluator does not implement, remain exactly as they were. That divergence is objectui#7750's question.
  
  Graded `minor` because a release reader can observe the narrowing on stored data; no declared type changed and the set of inputs the evaluator accepts has not widened.
- 83c77dc: `DataScopeManager` now **denies** a row when a row-level scope rule carries an operator its evaluator does not implement. It used to **admit** the row.
  
  Behaviour change on a permission boundary, stated plainly. `evaluateFilter` implements nine operator spellings — `eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `in`, `nin`, `contains` — and its `default` arm returned `true`, so a stored `RowLevelFilter` carrying any other spelling passed every record the rule existed to hide, silently: no error, no console line, only a result set that was too large, which looks exactly like a correctly configured permissive scope. The arm now returns `false`, the answer `evaluateCondition` in `@object-ui/permissions` already gives from its own `default` arm. Because `applyFilters` ANDs a scope's rules, one unrecognised rule now denies every row in that scope.
  
  Who this reaches, measured on this release's base rather than assumed. The `RowLevelFilter['operator']` union is closed, so no TypeScript caller can write an unimplemented spelling, and no code in this repository constructs a `RowLevelFilter` outside the evaluator's own test. The path that changes is scope configuration read back from stored or hand-written JSON and handed to `setFilters` / `registerScopeWithConfig`, where the operator arrives as a plain string the type never checked. A deployment holding such a rule with a spelling outside the nine — including the spec's canonical `equals` / `not_equals` / `greater_than` / `starts_with` and the null-ness family `is_null` / `is_not_null`, none of which have an arm — sees fewer rows from that scope after upgrading, never more. Those spellings are not implemented here; they are refused instead of admitted. Whether to canonicalise them through the spec's `canonicalAstOperator` is left open on objectui#7378.
  
  Graded `minor` because a release reader can observe the narrowing on stored data; the declared type is unchanged and the set of spellings the evaluator accepts has not widened.
- e719ebd: `data-table` reads the declared `header`; the producers translate `label` into it.
  
  `TableColumn` declares `header: string` and does not declare `label`. The
  renderer's column normalization nonetheless read `header: col.header || col.label`,
  so the same key had one spelling the type admits and one only the runtime did.
  That alias is gone (objectui#5351), and the translation it used to perform happens
  once at each producer instead: metadata vocabulary in, adapter vocabulary out.
  
  **This narrows what `data-table` accepts, so read this if you author `data-table`
  nodes by hand.** A column spelled `{ label: 'Stage', accessorKey: 'stage' }` on a
  directly authored `data-table` now renders a **headerless** column over live
  cells. Spell it `header` — the key `TableColumn` has always declared. Columns
  reaching `data-table` through `object-data-table`, `object-grid` or a related
  list are unaffected: those producers resolve `header` for you from the spec's
  `ListColumnSchema.label`, so every spelling they accepted before they still
  accept.
  
  `@object-ui/core` gains `columnHeader()` alongside `columnIdentity()` — the reader
  producers use to cross that boundary. It is adapter-first (`header` wins over
  `label`), so an author who addressed the table directly is never overwritten.
  
  `object-data-table` also gains a fix from the same move: a column carrying a
  `label` used to render a **blank** header there even while the alias existed,
  because the widget's field-meta enrichment overwrote the authored `label` before
  the adapter ever saw it. `{ field: 'stage', label: 'Stage' }` now renders "Stage".
  
  The sibling `accessorKey: col.accessorKey || col.name` alias is **unchanged** here
  and still resolves. Retiring it is objectui#5120's remaining step, which is
  gated on two published skill guides that teach that spelling.
- fa429cf: The register-meta key `defaultChildren` is retired (objectui#5051).
  
  It was declared in four places, produced in eleven, and read in **none**. The designer's
  drop path builds a new node from its twin key only — `PageDesigner.tsx`,
  `props: paletteItem?.defaultProps ?? {}` — with no `children:` line, so a palette item
  that declared `defaultChildren` dropped an **empty** node and the declared children never
  materialised. Nothing rendered the wrong thing; an entire declaration surface was simply
  inert, which is the declared-but-unenforced shape ADR-0049 targets. Per the maintainer
  ruling of 2026-08-19, the key is removed rather than wired up; if designer
  default-children UX is ever product-wanted it returns as its own designed card.
  
  **If you author plugins against the published register-meta table, drop the key.** It is
  gone from `skills/objectui/guides/plugin-development.md`, which had been teaching it. A
  meta that still declares it stays *valid*: `ComponentMetaSchema` is a plain `z.object`,
  and measured on zod 4.4.3 that STRIPS unknown keys rather than rejecting them — so the
  key is silently dropped from the parse output instead of failing validation. TypeScript
  authors get the loud signal instead: all three `ComponentMeta` declarations
  (`@object-ui/types` `base.ts` and `plugin-scope.ts`, `@object-ui/core` `Registry.ts`) no
  longer offer it, so re-declaring it is now a compile error.
  
  **No runtime behaviour changes in either direction.** No code path read the key before
  this change, and the eleven producers that set it (`sidebar.tsx` x10, `span.tsx`) were
  feeding a reader that did not exist. Dropping a `span` or any of the ten sidebar types
  into the designer produces exactly the node it produced yesterday.
  
  Two suites keep it retired, one per package: `packages/types` pins the zod twin (the key
  is absent from the parse output, with a surviving sibling asserted present through the
  same parse as the control) plus the two TS twins with `@ts-expect-error`, and
  `packages/core` pins the registration surface the eleven producers were written against.
  Both are compile-time-enforced through each package's chained `tsconfig.test.json`.
- 8e74b27: fix(core): an empty-bucket drill filters on "this dimension is empty" instead of writing a spelling the converter drops
  
  `buildDatasetDrillFilter` wrote a bare `null` for a bucket whose dimension value
  is empty. `convertFiltersToAST` SKIPS a key whose value is `null` / `undefined`
  — its oldest pinned behaviour — so the constraint never reached the wire and
  drilling into the empty bucket answered with a SUPERSET: every row, silently,
  with nothing thrown and nothing logged. Measured on three shapes (two drill
  dimensions with one empty; one drill dimension plus a runtime filter; one drill
  dimension with no runtime filter), all three were wrong.
  
  The empty bucket now lowers to `{ [field]: { $null: true } }`, which the
  converter carries end to end as `[field, 'is_null', true]`. That spelling means
  "this dimension has no value" — the rows the aggregate actually counted into
  the bucket — where an equality test against `null` would have meant "this
  dimension holds the literal value null" and dropped every row whose field is
  absent. All three empty authorings (`''`, `null`, `undefined`) reach the one
  spelling; `null` is included because JSON cannot carry `undefined`, so a SQL
  NULL grouped value arrives over the wire as `null`.
  
  BREAKING for a direct consumer of the exported `buildDatasetDrillFilter`: the
  value written for an empty bucket changes shape. Marked `minor` per this repo's
  version-alignment rule, which reserves `major` for following `@objectstack`.
  
  The drill "escape hatch" (the host's `openRecordList`, which serializes a drill
  filter into `filter[...]` URL params) is unchanged and still returns a superset
  for the empty bucket: that URL dialect has no is-null operator, so it drops the
  new spelling exactly as it dropped the bare `null`, byte for byte. Closing that
  needs a URL-dialect operator on both the write and the read side.
- 617707a: `convertFiltersToAST` lowers the `$and` / `$or` combinators to real ObjectQL AST
  group nodes (objectui#6948).
  
  `FilterCondition` declares `$and` / `$or` / `$not`, and this repo's one lowering
  had no branch for any of them. `$and` / `$or` fell through to the
  simple-equality branch and became a leaf naming a field literally called `$and`
  / `$or`. That leaf reached the server intact — `parseFilterAST` reads
  `['$or', '=', [...]]` back as a real `$or`, so the wire condition was correct
  and is unchanged by this release — but it is a well-formed *comparison* node, so
  every AST evaluator in this repo read `$or` as a field name, found no such key
  on any record, and returned an EMPTY list with no error. Producers that reach
  this today include `mergeFilters` (dashboard scope broadcast, dataset report
  blocks), `FilterConditionField`, and `Field.relatedListFilter`.
  
  `minor` rather than `patch`: shipped results move. A list filtered by a
  combinator through any in-process data source went from zero rows to the rows
  the author asked for, and an unknown or refused operator *inside* a combinator
  branch — which used to travel to the wire unchecked inside the leaf's value slot
  — is now refused at the same door as every other operator.
  
  `$not` is refused with an accurate message instead of translated: the AST has no
  negation keyword (`FILTER_ARRAY_LOGIC_KEYWORDS` is `['and', 'or']`) and several
  operators it carries have no negated counterpart, so a rewrite would be silently
  partial. It threw before this change too, naming the author's own nested field
  as a bogus operator; the verdict is unchanged, only the diagnostic.
- 06973aa: Refuse an empty or non-string `icontains` comparand on the stored-view rule path, and give all three `@object-ui/core` faces one implementation of that refusal
  
  `@objectstack/spec`'s `FILTER_TEXT_CASES` declares two shapes refused for the case-insensitive contains operator — an empty comparand and a non-string one — each with `code: 'INVALID_FILTER'`. `ValueDataSource` has answered both since objectui#8748 and `convertFiltersToAST` since objectui#9001, but `viewFilterRuleToNode` (reached through the exported `toFilterNode`) lowered both onto the wire: a rule an author saved as `{ field, operator: 'icontains', value: '' }` became `['name','icontains','']`, which the in-memory matchers answer with zero rows while the published table states the wire answer is a predicate that constrains nothing. Same authored filter, two answers, chosen by which data source the view renders against.
  
  The refusal now throws `FilterOperatorError` (`INVALID_FILTER` / 400) from the lowering, naming the field and the operator spelling the view vocabulary actually uses. A valid comparand, the sibling positive operators (`contains` / `starts_with` / `ends_with`), objectui#8557's array-arity refusal and a rule carrying no comparand at all are all unchanged.
  
  The discrimination and the refusal text moved into one internal module that `ValueDataSource`, `convertFiltersToAST` and `viewFilterRuleToNode` all read, so the three faces cannot drift. Both already-shipped messages are byte-identical to what they were. No published export was added.
- 105f3c5: Retire `CRUDSchema` and the `type: 'crud'` node spelling (objectui#5373,
  maintainer ruling 2026-08-20, route 2) under ADR-0049 enforce-or-remove.
  
  `crud` had four declaration faces and no registered renderer, for the whole
  life of the key: the TS interface (`packages/types/src/crud.ts`), the zod
  mirror (`packages/types/src/zod/crud.zod.ts`), a dedicated branch in
  `validateSchema` that affirmatively PASSED it, and `CRUDBuilder` in
  `@object-ui/core`. A node spelling it painted the OBJUI-001 "Unknown component
  type" panel, and `content/docs/api/schema-reference.md` published it as
  reference material — so a reader (or an AI author) who copied the page got a
  red panel.
  
  Removed from `@object-ui/types`: the `CRUDSchema` interface and its zod
  mirror, the four shapes that existed only to type its keys — `CRUDOperation`,
  `CRUDFilter`, `CRUDToolbar`, `CRUDPagination` and their zod mirrors and
  `…SchemaType` aliases — and `CRUDSchema` as a member of `CRUDComponentSchema`,
  which is what took it off the node union `AnySchema`. `ActionSchema`,
  `DetailSchema` and `CRUDDialogSchema` are unchanged and remain the union's
  members.
  
  Removed from `@object-ui/core`: `CRUDBuilder` and the `crud()` factory.
  
  Authoring `crud` is now REFUSED BY NAME rather than passed or silently
  ignored. `validateSchema` returns an `error` with `code: 'RETIRED_TYPE'` on
  `schema.type` — at any depth, since it is what `validateChildren` recurses
  with — so `assertValidSchema` throws and `isValidSchema` answers `false`. The
  message names the migration: `object-grid` for the record table with its
  toolbar, filters, pagination and row/batch actions, `object-form` for the
  create/edit form, and `detail` for the record view. `api/schema-reference.md`
  is rewritten around those shapes.
  
  Note on blast radius: the repository itself contains zero authored `crud`
  nodes and zero registrations of the key (measured on the merge base against
  the doc gate's own 659-key registry derivation, which reads `register` and
  `registerLazy` alike). That is an IN-REPO zero, not an npm zero — a published
  consumer that imported the `CRUDSchema` type, called `crud()` / `CRUDBuilder`,
  or authored `type: 'crud'` will see a compile error or a validation error
  respectively. Both are the intended, loud replacement for a shape that has
  never rendered.
- 759606e: fix(related-list): the tab badge compiles its parent scope by relationship ARITY, like the rows
  
  A related list on a `multiple: true` relationship rendered its rows above a tab
  with no count at all. The row query has compiled the parent-relationship
  condition to match the field's arity since objectui#7299 (`$contains` for a
  multi-value relationship, `=` for a single-value one), but the badge's count
  probe carried a second compiler that always sent bare equality — which the
  driver refuses on an array-valued column, and the count store swallows the
  refusal without caching anything.
  
  Rather than teaching the second compiler the same rule, there is now one:
  `@object-ui/core` exports `composeParentScopeFilter` (and the
  `isMultiValueRelationship` verdict behind it), and both the row query and the
  badge probe call it. The arity verdict remains `@objectstack/spec/data`'s own
  `isMultiValueField`, so the renderer and the driver that executes the query
  still decide on the same rule.
  
  `RelatedCountStore.fetch` takes the child object's field defs as a new optional
  last argument; callers that cannot see metadata keep the previous equality
  wire, byte for byte. Single-value related lists are unchanged on both sides.
- a51fa0c: feat(core)!: bare-string `globalFilters[].options` is no longer lifted; use `{ value, label }` objects, the spec's form (objectui#4356).
  
  **Breaking — published runtime behaviour removed; the bump stays `minor` under this repository's version policy, with the break stated here.** `resolveDashboardFilterDefs` used to lift a bare-string member of a dashboard's `globalFilters[].options` — `'EMEA'` became `{ value: 'EMEA', label: 'EMEA' }` — and, since objectui PR #4601, logged a deprecation warning while doing so. That lift is gone. A member that is not a `{ value, label }` object (a string, a number, a boolean) now yields no option: a shorthand-only filter resolves with no `options`, and a mixed array keeps only its object members. The runtime reads the document exactly as `@objectstack/spec`'s `GlobalFilterSchema` does, which has always refused the shorthand at publish.
  
  **Why now.** Maintainer ruling on objectstack#7917 (2026-08-12, verbatim 「7917 ②」): the spec stays strict and the runtime lift retires. The retirement window closed on the 2026-09-02 ruling, verbatim 「objectstack#7917 不考虑现有数据」 — Phase 2 proceeds on release cadence alone, with no stored-dashboard survey and no migration entry. Phase 0 (objectui stopped teaching the form) and Phase 1 (the deprecation warning) shipped in PR #4601.
  
  **What a stored dashboard sees.** A `select` filter whose options were all bare strings renders with an empty option list. In development a single `console.warn` — once per offending filter per session, the same memo the deprecation warning used — names the filter, the dropped members and the rewrite; it no longer promises a lift. Rewrite each string `X` as `{ "value": "X", "label": "X" }`.
  
  `resetDashboardFilterWarnings()` stays exported: the warn-once memo it clears now guards the dropped-member warning instead of the deprecation warning.
- 83fe6e7: row predicates on runtime record surfaces resolve `record.*` only; the bare-field and `data.*` spellings are no longer bound
  
  Phase 2 of the row-predicate canon (objectui#5330, ruled 2026-08-20, option B;
  Phase 2 ruled 2026-09-02 and amended 2026-09-05). Until now a
  row predicate — `visible` / `disabled` / `enabled` on an action renderer, a row
  action, a `record:alert`, a `page:header` action, a conditional-formatting
  `condition` — bound the row three ways: canonical `record.status`, bare
  `status`, and `data.status`. The two non-canonical spellings are retired on
  every runtime record surface, in both evaluation tiers (`evalRowPredicate` /
  `partitionRowsByPredicate` in `@object-ui/core`; `usePredicateRecordContext` +
  `useCondition` in `@object-ui/react`) and for both dialects: a legacy
  `${data.x}` / `${x}` string on a row surface retires with the CEL spellings.
  
  **What a retired spelling does now: it faults, exactly as it already did on the
  server** (`buildScope({ record })` mounts exactly `['record']`, so `status` and
  `data` are unknown variables there), and each surface applies its EXISTING
  fault policy — no runtime detector, no "treat as absent" special case, no
  uniform override:
  
  - `evalRowPredicate` / `partitionRowsByPredicate` (row kebab, selection bar,
    `page:header` actions, conditional formatting): the caller's `fallback` —
    hidden / every row excluded / no style — reported once by the existing fault
    warning, which names the unknown variable (`Unknown variable: status`) and,
    on the fast route, carries the `record.` hint.
  - `useCondition` legs that opt into `throwOnError` (`action:button` and
    `action:menu` `visible`, `DeclaredActionsBar` `visible`): fail-closed —
    hidden on every row, reported once as `was hidden/disabled: its predicate
    threw — status is not defined`.
  - the non-throwing `useCondition` legs (`action:icon` / `action:group`
    `visible`, every `disabled` / `enabled`, `record:alert`): fail-soft — shown /
    greyed / enabled on every row, with the evaluator's own console line.
  - a host scope that carries its OWN `data` (app-shell's ambient `data: {}`) is
    left standing: `data.*` on a record surface then reads the host's object — a
    constant, silent `false` — which is what "no longer bound to the row" means.
  
  The Phase-1 deprecation warning is removed with the bindings:
  `warnNonCanonicalRowSpelling` and `resetRowPredicateCanonWarnings` are no
  longer exported from `@object-ui/core`. `detectNonCanonicalRowSpelling`,
  `ROW_PREDICATE_CANONICAL_ROOT` and the `NonCanonicalRowSpelling` type stay
  exported — the offline instrument for sweeping authored metadata.
  
  The layer rule is unchanged: `data` remains the canonical root on
  metadata-editing surfaces (ADR-0089 D3, `CANONICAL_ROOT_BY_LAYER`), and
  app-shell's metadata-admin `SchemaForm` / `predicate.ts` keep binding
  `{ data: row }` through their own evaluator.
  
  No stored-metadata survey, export or migration rewrite was run (the maintainer
  ruled the stored population out of scope, 「不考虑存量」); the Phase-1 warning
  period was the notice.
  
  Release note: Phase 1 (`d1ab06f0f` — the canon statement plus the warning) shipped
  in `@object-ui/core@17.6.0` (npm, 2026-08-24) although its changeset
  `.changeset/row-predicate-record-canon-5330.md` is still pending on `main`, so
  the next CHANGELOG section lists Phase 1 and this Phase 2 together: the warning
  it describes was live from 17.6.0 and is gone from this release on.
- d1ab06f: Row predicates declare a canon: `record.*`. The bare shorthand and `data.*` now
  warn once, and are unchanged otherwise.
  
  A row predicate (`visible` / `disabled` / `enabled` on an action renderer, a row
  scope, a `record:alert`) has bound the row three ways since objectui#4075 —
  `record.status`, bare `status`, and `data.status` — without any of them being
  declared the contract. The maintainer ruled that question on 2026-08-20
  (objectui#5330, option B), mirroring the objectstack#7917 option-② precedent for
  the identical renderer-tolerance shape: **the canon is `record.*`**, and the
  other two enter a deprecation window.
  
  The canon states the **server's** accept set, which was this card's first
  measurement and turns out to be strictly narrower than the renderer's. Measured
  against `@objectstack/formula@17.1.0`, the engine the server evaluates with:
  
  | spelling | server runtime | server authoring oracle |
  |---|---|---|
  | `record.status` | `{ ok: true, value: true }` | accepted |
  | bare `status` | `Unknown variable: status` | refused |
  | `data.status` | `Unknown variable: data` | **silently accepted** |
  
  `buildScope({ record })` mounts exactly `['record']` — `data` is never bound and
  the row's fields are never flattened to top level. The three-way binding is a
  client tolerance with no server counterpart, which is why the warning belongs on
  this side.
  
  `data.*` is the dangerous one, and the reason the warning exists. `data` is in
  `@objectstack/formula`'s `SCOPE_ROOTS`, so the server's bare-identifier oracle
  waves it through — that list is a deliberately generous "never faults" lint
  baseline, not the runtime accept set. A `data.*` row predicate therefore passes
  every authoring gate the platform has and then binds nothing at runtime: not an
  error, a constant `false`. A `visible` that is constantly false is a button that
  silently never appears — the objectui#4075 fail-closed signature.
  
  What ships:
  
  - `@object-ui/core` exports `detectNonCanonicalRowSpelling`,
    `warnNonCanonicalRowSpelling`, `resetRowPredicateCanonWarnings` and
    `ROW_PREDICATE_CANONICAL_ROOT` from a new `evaluator/rowPredicateCanon.ts`,
    which carries the canon statement and the measurement.
  - Both evaluation tiers report once, in dev: `evalRowPredicate` (core) and
    `useCondition` (react, for bags bound by `usePredicateRecordContext`).
  - Detection reuses the server's own oracles (`collectCelRootIdentifiers`,
    `firstUndeclaredReference`) rather than a regex, so no second dialect
    judgement is invented client-side.
  
  **No spelling is removed and no behaviour changes.** Every predicate that
  resolved before resolves now — the ruling defers removal behind a stored-metadata
  survey, and the warning is what makes that survey possible (ADR-0078: a
  tolerance nothing ever reports can never be retired).
  
  The deprecation is scoped to the **runtime record layer**. `data` remains the
  canonical root one layer over, in a metadata-editing form (ADR-0089 D3
  `CANONICAL_ROOT_BY_LAYER`), and the detector stands down there.
- 91783c4: Three more secret-field spellings no longer render a secret in clear text on the form's unregistered-widget branch.
  
  Measured on `main` at `f2e11ae6f`, the real `form` renderer on the built-in path
  (no `registerAllFields()`), before and after objectui#5322's fix:
  
  ```
  type            registry hit   rendered type
  ui:password     true           text
  secret          false          text
  field:secret    false          text
  ```
  
  Two halves, per the maintainer ruling of 2026-08-20:
  
  - **`@object-ui/core` — an unresolvable namespaced widget id is now an authoring
    ERROR.** A form field's widget id (`widget`, else `type`) may name the
    `field:` namespace or a bare name; any other namespace resolves no field
    widget (objectui#5254) and used to degrade silently to a plain text box.
    `validateSchema` now reports `UNRESOLVABLE_FIELD_WIDGET_NAMESPACE` and
    `assertValidSchema` throws. Behaviour change: a schema that previously
    validated with e.g. `type: 'ui:password'` is now invalid — inventing a
    plausible-looking widget id fails loudly instead of rendering clear text.
    `field:` ids stay valid whether or not the widget is registered, since
    registration is a runtime fact an authoring-time validator cannot see.
  - **`@object-ui/components` — the known secret types cover the remaining
    spellings.** Bare `secret` and `ui:password` render the native masked input,
    and `field:secret` is refused outright like `field:password`. Existing authors
    need no migration.
  
  `ui:password` **is** registered — as an SDUI node renderer for a top-level
  `{ type: 'email' }`-style node — so an author who checked whether it resolved
  got a yes and still got a clear-text box on the field path. No producer emits
  any of the three; all are reachable only through a hand-authored standalone
  form schema, which is exactly the surface where the author is the producer and
  no normalizer sits in between.
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
- e76634c: `ValueDataSource` reads the two comparand shapes it used to compare by reference.
  
  **An ARRAY comparand is refused rather than compared by reference**
  (objectui#8514). `{ tags: ['a', 'b'] }` took the simple-equality branch and
  `!==` compares references, so it excluded every row including the deep-equal
  one — silently. It is now excluded with a logged reason naming `$in`, in both
  dialects and on the `$`-operator positions too. The equality positions move no
  rows (a reference comparison already excluded everything); the negations do:
  `$ne` / `!=` against an array was always true, so it had been selecting EVERY
  row in silence.
  
  The repair is a refusal rather than a deep-equality reading because the spec
  declines to rule on an array outside `$in` / `$nin` / `$between`, and the two
  in-memory matchers nearest this one both refuse it — inventing a reading here
  would be a second de-facto contract the wire does not honour. Every producer in
  this repo already spells a multi-value comparand `{ $in: [...] }`.
  
  **A `{ $field }` comparand is now resolved** (objectui#8515). The spec declares
  it, `@objectstack/formula` emits it, and both platform evaluation paths execute
  it; this adapter compared the reference object, so such a filter answered with
  no rows and no diagnostic. It is now dereferenced against the record on the six
  scalar comparisons it is declared for, in both dialects. A reference in a list
  position, one carrying an `addDays` offset, a dotted path, and a non-string
  `$field` are refused with the reason — an `addDays` silently dropped would
  return wrong rows rather than none.
- 92814db: `ValueDataSource`'s text operators answer the case question the wire answers: `contains` is case-SENSITIVE, `icontains` is its ASCII-folding twin (objectui#7379)
  
  The in-memory matcher lower-cased BOTH sides of `contains`, `not_contains`, `starts_with`, `ends_with` and — since the `icontains` arm was stacked onto the `contains` one — `icontains` too. So `contains` executed `icontains`, the two spellings named a single predicate, and a `provider: 'value'` list filtered with `contains` returned strictly more rows than the same filter run against a real driver. Nothing errored; the list was just longer, and both answers looked plausible.
  
  `$contains` is contractually case-sensitive (objectstack#4706 Q2 = A) and `$icontains` is the case-insensitive member, folding **ASCII only** (Q1 = A, because three of the five backends are SQLite underneath and its `lower()` folds ASCII only). All five drivers — `driver-sql`, `driver-sqlite-wasm`, `driver-turso`, `driver-mongodb`, `driver-memory` — plus objectql's `having` matcher import `FILTER_TEXT_CASES` from `@objectstack/spec/data` and answer its case rows. This adapter was the last face that did not.
  
  What changed:
  
  - `contains`, `not_contains`, `starts_with`, `ends_with` compare exactly. There is no `i` twin for the last three — `VALID_AST_OPERATORS` has `icontains` and nothing else with an `i` prefix — so case-sensitive is the only reading available to them, and it is the one `not_contains` needs so that no row can fail an operator *and* its negation.
  - `icontains` now uses the spec's own `asciiCaseInsensitiveContains`, so `CAFÉ` no longer matches `café`. `String.prototype.toLowerCase()`, which this arm used, is the full Unicode fold — a promise the SQL family cannot keep.
  - The `$`-dialect matcher follows: `$contains` compares exactly, and `$icontains` gains an arm. It had none, and an unrecognised `$` operator in that switch adds no constraint at all, so a `$icontains` filter used to select every row.
  
  **Behaviour change.** Metadata that relied on the lenient matching gets fewer rows and no error. A filter that means "match regardless of case" should be authored as `icontains` (AST/view dialect) or `$icontains` (`$` dialect); both now execute, and both fold ASCII case on either side.

### Patch Changes

- 8cedb0d: The two declared display-locale contracts now each name the caller they govern,
  and each points at the other (objectui#10098). This is documentation only: no
  module's behaviour moves.
  
  - `DisplayNumberFormatOptions.locale` (`@object-ui/core`): leaving the tag
    `undefined` means the runtime default, and that rule is written for a non-React
    display caller with no tag in hand. For that caller the viewer's own environment
    is the honest locale for a user-facing display. A malformed tag lands in the
    same place through `formatDisplayNumber`'s retry.
  - `useDisplayLocale` (`@object-ui/i18n`): its concrete `'en'` last resort, kept for
    determinism, is the rule for a React renderer whose provider chain yields no tag
    at all, not a rule for every caller without a tag.
  - `formatNumberInDisplayLocale` (`@object-ui/plugin-report`): the note on its
    malformed-tag retry no longer calls the dropped-tag retry behind
    `formatDisplayNumber` a wrong answer. Each retry follows its own package's
    declared contract.
  
  Read alone, either docblock used to look like a rule for every caller, and each
  contradicted the other. The new wording reaches each package's published type
  declarations, which is why this is declared as a patch rather than left
  undeclared.
- 961ceaa: fix(core): a list's `$select` now carries the field a row action's `defaultFromRow` param seeds from and the `{field}` tokens of its `target`
  
  `listViewPredicates` is the harvest `ListView`, `ObjectGrid` and `RelatedList`'s
  authored path use to decide which fields a projected row must carry. It read an
  action's `visible` / `disabled` predicates and its `recordIdField`, but not two
  other row keys an action reads. On a backend that honours `$select`, a field
  named only there was absent from the row, and nothing said so:
  
  - a param with `defaultFromRow: true` bound to a field no column shows opened
    the console's param dialog blank, because the param is seeded only when the
    row has the key;
  - a `{field}` token in an `api` action's `target` was filled with an empty
    string by the console's `api` handler.
  
  For each action on the view's row, bulk and object action lists, the harvest now
  also names:
  
  - the row key a `defaultFromRow` param seeds from: its `field` when it declares
    one, its `name` otherwise. That is the precedence the param seeding reads, so
    a `teamId` param bound to `field: 'team_id'` asks for `team_id`;
  - every `{field}` token in `target` whose content is a bare identifier, the
    grammar the console's `api` handler fills from the row. A dotted path, an
    expression and the runner's `${param.X}` / `${ctx.X}` tokens are not filled
    from the row that way, and are not harvested.
  
  A param key that is not a bare identifier is dropped, as a `recordIdField` is.
  Every harvested name still passes each consumer's existing gates before it
  reaches `$select`: the check against the object's declared fields and the
  platform columns every record carries, and field-level security on a declared
  field once the permission answer has loaded.
- 544aca2: fix(core,fields): a date-time written on a calendar day that does not exist is refused, not rolled into another day
  
  `2026-02-30T10:00:00Z` names a day February does not have. The engine parses it anyway and rolls the surplus forward, so it rendered as `Mar 2, 2026, 10:00 AM`: a real day nobody wrote, with nothing to say the stored value was wrong. objectui#10026 made the shared date path refuse such a day on a date-only value; this extends the same refusal to a value that carries a time.
  
  - **`toDisplayDate` returns an Invalid Date for an ISO date-time whose leading `YYYY-MM-DD` is not a real calendar day** (the `isRealCalendarDate` judgement). The day is read from the stored string as written, so a real day written with an offset — `2026-02-28T23:30:00-05:00`, which is March 1st in UTC — is not refused, and a real date-time renders exactly as before. `formatDateTime`, `formatDate` and `formatRelativeDate` render `—` for such a value, `formatDateTimeCompactParts` returns `null`, and a dataset measure over it renders the same `—`: each function's existing answer for an unparsable value.
  - **`@object-ui/fields`:** the `datetime` and `date` cells, the readonly `date` widget and a date-returning `FormulaField` show the shared "No value" placeholder for such a value, and the readonly `datetime` widget shows `—`, exactly as each does for an unparsable value.
  - **The sub-grid (`GridField` / `LineItemsField`) `date` and `datetime` columns read the shared parse step instead of building their own `Date`.** A value that step refuses shows the stored string, this surface's existing face for a value it cannot parse: an impossible day in either column (`2026-02-30`, which the `date` column still rolled into March after objectui#10026), and an out-of-range month (`2026-13-45`, which the `date` column rendered as `Feb 14, 2027`). A `date` value with a year below 100 (`0026-08-01`) now renders that year, as the `date` cell does, instead of 1926.
- 64563a9: **BREAKING (node type key):** `@object-ui/plugin-map` no longer registers the bare
  `map` node type key, and its namespaced twin `view:map` goes with it. A node
  authored `"type": "map"` no longer resolves a renderer. Write
  `"type": "object-map"` — the one spelling the plugin serves (objectui#10393,
  executing the objectui#8008 family ruling of 2026-09-09 that retired the bare
  `gantt` and `kanban` keys).
  
  **Why.** The registry mounted a `map` node while the published declaration refused
  it: `ObjectMapSchema.type` is the literal `'object-map'` and `AnyComponentSchema`
  has no `map` arm, so `safeValidateSchema` answered a `map` node with
  `invalid_union` while the html tier accepted it. Two faces, opposite verdicts.
  No schema face ever declared `map` as a component node type, so there is no arm
  to turn into a named refusal: unregistering is the whole retirement, exactly as
  it was for `gantt`. After it, the html tier (`validateTree` over the live
  registry) reports a `map` node as `unknown-component`, matching the Zod face.
  
  **⛔ No stored document moves.** The string `map` names two different things at
  two different layers, and only one of them is retiring:
  
  | layer | value | who writes it | retired? |
  | --- | --- | --- | --- |
  | stored `NamedListView.type` / `defaultViewType` | `"map"` | `CreateViewDialog`, persisted per tenant | **no — untouched** |
  | node type key | `map`, `view:map` | hand-authored JSON | **yes** |
  
  `ObjectView` and `ListView` map a stored `map` view onto the node type they
  render, and both already emit `object-map`, so every map view created through
  the console keeps rendering. Nothing in a tenant database changes, and ⛔ nothing
  should be migrated there.
  
  **What moved with it.**
  
  - `@object-ui/console` drops its lazy `map` / `view:map` registration stub; the
    lazy `object-map` stub is unchanged.
  - `@object-ui/core`: `recordSourceDataArmForType` no longer lists the `map` and
    `view:map` rows, since no block is registered under either key.
  - `@object-ui/cli`: the generated known-type list that `objectui check` reads no
    longer contains bare `map`, so the check now reports `map` as an unknown
    schema type in a file it recognises. ⚠️ `view:map` stays on
    that list, because the opt-in protocol placeholder (`registerPlaceholders()`
    in `@object-ui/components`) registers it — in the console a `view:map` node
    renders that placeholder panel, not a map, and `objectui check` does not report
    it as an unknown schema type in a file it recognises. A bare
    `{ "type": "view:map" }` with no structural key is listed in `check`'s advisory
    did-not-validate list instead, because `view:map` is on the known-type list and
    `AnyComponentSchema` has no arm for it; that line does not say the node renders
    a placeholder. Search documents for `view:map` directly.
  
  ⚠️ **Dated note, 2026-09-25 — `objectui check` flags `map` only in a file it
  recognises — objectui#10606.** This entry first said, unscoped, that the check now
  flags bare `map`. `check` checks the `type` of each file it recognises, and a file
  whose root carries an ObjectUI structural key (`children`, `className`, `body`, …)
  is recognised by that key alone. A file with none of those keys is parsed against
  the schema and recognised only if it validates; one that does not validate is
  listed by name when its root `type` is on that known-type list, and is otherwise
  counted as skipped. `map` is no longer on it, so `{ "type": "map" }` is
  counted as skipped ("no ObjectUI recogniser admitted") and gets no unknown-type
  line, while `{ "type": "map", "className": "h-64" }` gets one. `check` exits
  non-zero on unreadable JSON only; the verdict is `objectui validate`'s: it refuses
  `{ "type": "map" }` at `type` (`invalid_union`) and exits non-zero.
  
  The `@object-ui/plugin-map` README now describes one registered type, and its
  sentence claiming a bare array under `data` reaches the in-memory adapter is
  corrected: a bare array under `data` is not a record source on the map
  (objectui#8348), so inline rows belong under `staticData`. The same false claim
  is corrected on the two docs pages that carried it, `plugins/plugin-map.mdx`
  and `fields/location.mdx`.
  
  **One pending entry in this same release is superseded in part.** The
  objectui#10392 / #10394 entry (`10392-registration-record-source-inputs.md`)
  says `object-map`, `map` and `object-gantt` gained `data` / `staticData`
  inputs. It now reads as of its own change and carries a dated note naming this
  card: `map` declares nothing after this retirement, while `object-map` and
  `object-gantt` keep both inputs.
- 3261e64: One `titleFormat` interpolator for the record title (objectui#10447, objectui#10446).
  
  `@object-ui/core`: `formatTitleTemplate` now judges a placeholder empty the way `recordDisplayValueAt` does: trim, then empty. A whitespace-only value used to count as resolved, so `{contract_no} - {name}` with a blank `name` rendered `HT-2026-003 -` in `formatTitleTemplate` and in `getRecordDisplayName`'s `titleFormat` rung, and so on every surface backed by that resolver. It now renders `HT-2026-003`. Both functions run one shared implementation of the rule, so a resolved placeholder renders the same trimmed display string `recordDisplayValueAt` returns. The exported signatures are unchanged.
  
  `@object-ui/components`: the record page H1 (`page:header`) renders its `titleFormat` rung through core's `formatTitleTemplate`, the function `getRecordDisplayName` and `record:details`' H1 dedupe already use, instead of its own interpolation and separator cleanup. Visible changes on that rung:
  
  - An expanded lookup token renders its display name: `{account} - {deal_no}` reads `Acme - Q3-042` where the H1 used to drop the lookup and read `Q3-042`, so `record:details` no longer prints the row it wrongly treated as distinct from the heading.
  - A comma left by an empty placeholder is stripped: `{deal_no}, {code}` with no `code` reads `Q3-042`, not `Q3-042,`.
  - A template none of whose placeholders resolves no longer shows its literal text (`Session — {user_id}` with no user used to read `Session`); the H1 walks on to the next rung, as `getRecordDisplayName` does.
  - A select token still reads as its translated option label: the label is applied to a copy of the record before core renders it.
  
  The rungs' order is unchanged. `page:header`'s own `title` and `subtitle` templates keep their existing interpolation.
  
  This supersedes how two earlier changesets, still pending in the same release, describe the `titleFormat` rung; each now carries a dated note naming this card. objectui#9436 (the declared pointer outranks `titleFormat` in `page:header`) said the template kept the header's own interpolation. objectui#9174 (`interpolate()`'s no-token fast path) listed the record-title `titleFormat` among `interpolate()`'s callers. Both describe the header as it was at their change; from this release the rung renders through `formatTitleTemplate`.
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
- 4758b33: `@object-ui/core` now exports the native date/time control adapters `toDateInputValue`, `toDateTimeInputValue`, `fromDateTimeInputValue` and `isImpossibleStoredDay` (objectui#10625). They moved down from `@object-ui/fields` unchanged, next to `isRealCalendarDate`, so the data table in `@object-ui/components` can use the same set instead of private copies. Their behaviour is unchanged: a stored day that does not exist (such as `2026-02-30`) is never rolled to a real one.
- 39b8d51: feat(components): `div` is deprecated on the html tier too — a `kind:'html'` page that authors `<div>` is refused at compile time, and the error names `box`
  
  Executes the maintainer's ruling A on objectstack#20112 ("`div` stays
  deprecated") in the renderer. Until now the published manifest left `div` out of
  the html tier, so `os validate` refused a `<div>` page as `forbidden-tag`, while
  the console compiled and rendered the same page. `div`'s registration declared
  the deprecation for the JSON surface only, and its renderer exempted nodes the
  html parser emitted (objectui#4000).
  
  **What moves for a consumer.**
  
  - **BREAKING (authoring): a `kind:'html'` (or legacy `kind:'jsx'`) page that
    authors `<div>` or `<ui:div>` no longer renders.** The html compile fails, and
    like every compile error this fails the whole page: the console shows the
    "HTML page failed to compile" panel. Each refusal is the parser's
    `forbidden-tag` sentence, followed by the declared replacement guidance, which
    names `box`. Migration: retype `<div>` to `<box>`. `box` renders the same
    element with the same `className` and no layout of its own.
  - `div`'s registration now declares `deprecated.surfaces: ['json', 'html']`, so
    `ComponentRegistry.deprecationFor('div', 'html')` answers the declaration
    (with the unchanged `replacement`) instead of `undefined`. The html compile
    derives what it refuses from `deprecationFor(type, 'html')`, the registration's
    declaration, rather than from a list of tag names.
  - The `div` renderer no longer exempts nodes carrying html-tier provenance, and
    its dev-build notice now says it applies to JSON-authored nodes and html pages
    alike. The migration bullets are unchanged.
  - `span` is unchanged: it is still deprecated on the JSON surface only, and it
    still compiles on html pages.
  
  Semver: `minor`, not `major`, per this repository's version-alignment rule. The
  breaking semantics are stated above.
  
  **Published declaration text (prose only, no behaviour change).**
  
  - `@object-ui/core`: the emitted `dist/registry/Registry.d.ts` carries the
    rewritten `ComponentDeprecation` and `deprecationFor` docblocks, where `span` is
    now the worked example of a json-only deprecation and `div` is stated to name
    both surfaces. `dist/registry/html-tier-intrinsics.d.ts` carries the rewritten
    `HTML_TIER_INTRINSICS` docblock: its `div` bullet and the sentence describing the
    console's html-tier whitelist.
  - `@object-ui/sdui-parser`: the emitted `dist/provenance.d.ts` carries the
    rewritten file-header sentence, where `span` is now the example of a tag that
    stays html-tier vocabulary.
- 17b323e: fix(core): `ValueDataSource.find` reads a spec `ViewFilterRule[]` `filter`, so an inline-data map, tree, calendar or gantt renders the rows the one filter form the spec accepts selects
  
  The spec's converged `filter` doors accept ONLY the rule array
  `[{ field, operator, value }, …]` (objectui#6206 B). `ValueDataSource.find` picked a
  matcher on the SHAPE of `$filter` — an object to the `$`-dialect matcher, an array
  to the AST matcher — and a rule OBJECT is none of the AST shapes, so every row was
  refused with one `console.warn` ("is not a shape the matcher reads"). The four
  blocks whose rows can be inline (`object-map`, `object-tree`, `object-calendar`,
  `object-gantt`, the last through `resolveDataSource`) hand `schema.filter` to this
  adapter unlowered, so a spec-conformant page with inline rows rendered an EMPTY
  component while `os validate` was green.
  
  The array arm now lowers through the repo's ONE sink, `toFilterNode`
  (`toFilterNodeSafely`) — the same function the grid, the list and every other
  lowering caller already use — before it matches, so the spec's vocabulary
  (`equals`, `greater_than`, the aliases the spec folds, a valueless `is_null`) selects
  rows in memory exactly as it does on the wire. No second lowering and no second
  operator table were added; the `$`-dialect arm is untouched.
  
  The matcher is NOT relaxed. An empty rule array is still "no filter" (as on the
  object-bound arm). A genuinely unreadable node, an operator the vocabulary does not
  know, and a rule the lowering itself refuses (an ARRAY on a single-valued operator,
  an empty `icontains` comparand) still exclude every row and log ONCE, with the same
  sentence tail — the lowering's refusal is delivered the way this adapter delivers
  every refusal, excluded and logged, never thrown.
  
  `QueryParams.$filter` (`@object-ui/types`) already declared the array form legal for
  every DataSource and named the wire adapter's `translateFilterToAST` as the accept
  set; this adapter was the one face in the family that did not read the rule array,
  so `resolveDataSource` handed back an adapter whose `find` read fewer filter shapes
  on `provider: 'value'` than on `provider: 'object'`. That gap is what closed.
- 33e58d8: `convertFiltersToAST` now refuses an EMPTY operator map BESIDE a key that lowers —
  `{ status: 'a', created: {} }` — with a `FilterOperatorError` (`INVALID_FILTER` / 400)
  whose subject is the field, instead of silently dropping it (objectui#10788).
  
  **Before.** `{ created: {} }` names a field and no operator, so the operator loop ran zero
  times and pushed no condition for it. objectui#9164 refused that map in the general tail,
  but the tail was reached only when NOTHING produced a condition. Beside a key that lowers,
  the sibling's condition carried the filter and the field vanished:
  `{ status: 'a', created: {} }` lowered to `['status', '=', 'a']`, and both `find()` routes
  of `@object-ui/data-objectstack` sent a request byte-identical to `{ status: 'a' }`. The
  result was WIDER than the author wrote, with nothing thrown. `@objectstack/spec` records
  `{ field: {} }` as REJECTED in every position (objectstack#5240, on
  `FilterConditionSchema`).
  
  **After.** The empty operator map is refused in the operator-map arm, where it is met, like
  this function's bare-array and exotic-comparand refusals. One throw site now answers it
  alone (objectui#9164) and beside other keys, so the two cases cannot drift apart. The
  message names the field and the fix: choose an operator (`$eq`, `$in`, `$null`, …) or
  remove the key. A `$and` / `$or` member is converted by the same function, so
  `{ $and: [{ status: 'a', created: {} }] }` is refused too.
  
  **What an author sees.** The same as for this function's other refusals. A list or view
  that loads through `buildEffectiveFilter` / `ObjectView` fails its load with the
  `INVALID_FILTER` envelope. `ObjectGrid`, `RelatedList` and `LineItemsPanel` read
  `toFilterNodeSafely` and render the "this view's filter is malformed" state naming the
  field. `@object-ui/data-objectstack`'s `find()` rejects with the envelope and sends no
  request.
  
  **Unchanged.** `{ status: 'a' }` still lowers to `['status', '=', 'a']`. A real operator
  beside the key (`{ status: 'a', created: { $gte: d } }`) still lowers. A `null` /
  `undefined` value is still skipped, not refused. `{}` still returns `{}`.
  
  **Migration.** A stored filter carrying `{ field: {} }` beside other keys used to return
  more rows than it said. It is now a named refusal. Give the field an operator, or delete
  the key.
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
- 30b11ad: `ValueDataSource.find` now refuses an object `$filter` that carries an EMPTY operator
  map — `{ created: {} }`, alone, beside other keys, or inside a `$and` / `$or` member —
  instead of silently dropping that field's constraint (objectui#10817).
  
  **Before.** The object-dialect matcher read `{ created: {} }` as an operator map with
  zero operators, so the field added no constraint. `{ status: 'a', created: {} }`
  answered the same rows as `{ status: 'a' }`, and `{ created: {} }` answered every row,
  with no console line. The ObjectStack path refuses the same filter: `@objectstack/spec`
  ruled `{ field: {} }` REJECTED wherever it appears (objectstack#5240, recorded on
  `FilterConditionSchema`), and `convertFiltersToAST` refuses it alone (objectui#9164) and
  beside a key that lowers (objectui#10788).
  
  **After.** Before any row is matched, the object arm walks the filter's field entries
  and the members of `$and` / `$or`. A field whose condition is an object with no own
  keys is handed to `toFilterNodeSafely` on its own, so the converter alone decides what
  an empty operator map is, in its own wording. If the converter refuses it, the whole
  filter answers no rows (`data: []`, `total: 0`) and the converter's reason is logged
  once — the envelope the array arm already uses for a rule its lowering refuses
  (objectui#10767). `find` still never rejects. `{ $or: [{ status: 'b' }, { status: 'a',
  created: {} }] }` answers no rows, not the `'b'` rows.
  
  **Also refused, by the same routing.** Any other object with no own keys that is not a
  plain object or a `Date` — a `RegExp`, `Map`, `Set`, `URL` or a class instance with no
  own fields — has no own keys either. The converter refuses it as an exotic comparand
  (objectui#8567), so this face now refuses it too, with the converter's wording, instead
  of dropping the constraint: `{ status: 'a', created: /x/ }` used to answer the same rows as `{ status: 'a' }`.
  
  **Unchanged.** `{ status: 'a' }`, a real operator beside the key, the `{}` whole filter
  and a `null` condition answer as before. A `Date` comparand is not refused: the
  converter lowers it, so it reaches the matcher exactly as before, where its constraint
  still vanishes (objectui#10829). Every other refusal
  on this face — an operator the matcher does not implement, an array comparand, `$not` —
  is still excluded per node with its own sentence; when the same filter also carries a
  condition the walk refuses, only that refusal is logged — `{ status: ['a'], created: {} }`
  logs `created`'s refusal, where the converter names `status`.
  
  **Clause-②: no** — the value face now refuses, in its own exclude-and-log envelope, a
  shape objectstack#5240 ruled refused, and comparands the spec's
  `ACCEPTED_FILTER_COMPARAND_TYPES` rules out (objectui#8567); on this face both only
  ever dropped a constraint. No declared surface moves and no export is added.
  
  **Migration.** A filter carrying `{ field: {} }` returned more rows than it said. It is
  now a named refusal. Give the field an operator, or delete the key.
  
  ⚠️ **Dated note, 2026-09-27 — a `Date` condition now matches the rows holding that instant — objectui#10829.** Later in this same release a `Date` condition in an object `$filter` is read as implicit equality, and two `Date`s compare their instant in both arms, so `{ status: 'a', created: someDate }` answers the status-`'a'` rows whose `created` is a `Date` of that instant, the same rows as its lowered array, rather than the rows of `{ status: 'a' }`. "where its constraint still vanishes (objectui#10829)" above is this change's reading, not the release's. The rest of this entry is kept as the reading of this change; the objectui#10829 entry states what that input now answers.
- 3d6badf: `ValueDataSource.find` now answers a `Date` equality or membership test with the rows
  holding that instant as a `Date`, in both filter dialects (objectui#10829). The object
  dialect used to drop an implicit `Date` equality, and every explicit equality or
  membership test compared a `Date` by identity.
  
  **Before — the object dialect.** The object-dialect matcher sent every object condition
  that is not an array to its operator branch. A `Date` has no own keys, so the operator
  loop ran zero times and the field added no constraint: `{ status: 'a', created: someDate }`
  answered the same rows as `{ status: 'a' }`, and `{ created: someDate }` answered every
  row, with no console line. `convertFiltersToAST` lowers the same filter to
  `['created', '=', someDate]` (objectui#8555), because `@objectstack/spec`'s
  `ACCEPTED_FILTER_COMPARAND_TYPES` includes `Date`.
  
  **Before — both dialects.** Every equality and membership position compared with `===`,
  and membership with `includes`, so a `Date` was compared by identity. The adapter clones
  the rows it is constructed with, so none of those rows held the comparand's instance:
  over them `['created', '=', someDate]`, `{ created: { $eq: someDate } }` and
  `$in: [someDate]` matched nothing, not even the row holding that exact instant, while
  `$gte` and `$lte` both matched it, and `!=`, `$ne` and `$nin` selected every one of
  them. Only a row written through `create` or `update`, which copy the record shallowly,
  could hold the caller's own instance and match it by identity.
  
  **After.** A condition the spec's `isAcceptedFilterComparand` accepts takes the
  object dialect's implicit-equality branch, the predicate the converter lowers a `Date`
  through; today a `Date` is its only object-typed member. One equality helper serves
  implicit equality, `$eq` / `$ne` / `$in` / `$nin` and the AST `=` / `!=` / `in` / `nin`:
  when the stored value and the comparand are both `Date` instances it compares
  `getTime()`, and an invalid `Date` equals nothing. So an object filter answers what its
  lowered array answers, and `=`, `$gte` and `$lte` agree on one instant.
  
  **Unchanged.** A `Date` comparand is not coerced to another storage form: a row holding
  the same instant as an ISO string or as epoch milliseconds does not equal it.
  `@objectstack/spec`'s `FILTER_COMPARAND_TYPE_CASES` declines to assert a `Date` row set,
  because what it matches "legitimately differs per storage form (ADR-0053)". `$gt` /
  `$gte` / `$lt` / `$lte` / `$between` compare a `Date` by its number, as before. Every
  other comparand keeps `===`. The one value where membership moves is the number `NaN`:
  `includes` found a stored `NaN` in `[NaN]` and `===` does not, so `$in: [NaN]` and
  `['x', 'in', [NaN]]` no longer match a stored `NaN`, and `$nin` / `nin` now keep that
  row, agreeing with `{ x: NaN }` and `$eq`, which never matched it.
  
  **Clause-②: no** — the value face stops dropping a `Date` constraint that
  `@objectstack/spec`'s `ACCEPTED_FILTER_COMPARAND_TYPES` accepts and the converter lowers
  to equality; no declared surface moves and no export is added.
- 6650259: fix(plugin-calendar): a day event moved across a DST change writes the days it was dropped on (objectui#10866, slice 4)
  
  - **plugin-calendar.** At this change the month grid moved each date of an event by the milliseconds between two local midnights, the grabbed cell's and the drop cell's, and a date-only value is read at local midnight of its day. So when a DST change lay between one of an event's dates and where it landed, but not between the two cells (or the other way round), that date came back an hour off local midnight; at 23:00 of the day before, the write took the day before. Under `America/Los_Angeles` a span of `date` fields moved across November 1st or March 8th could be written a day short at its start or its end. A move of an event whose start, and end when it has one, are both stored calendar days now writes each `date` field as its stored day moved by the whole days the grid moved it. Every other write is unchanged: a `datetime` field still writes the instant the grid hands back, and at this change the grid's own arithmetic does not change.
  
    ⚠️ **Dated note, 2026-09-29 — the month grid now moves by calendar days — objectui#11005.** Later in this same release the month grid moves a value by the calendar days between the grabbed cell and the drop cell and keeps its time of day, for a move and for a drag of a span's end, so a 10:00 `datetime` stays at 10:00 across a DST change. A `date` value read at local midnight of its day then comes back at local midnight of the day it was dropped on, so the repair described above is removed and a moved `date` field is written as that local day, which is the same day the repair wrote. The rest of this entry is kept as the reading of this change; the objectui#11005 entry states what ships.
  - **plugin-gantt, types.** The business `timeZone` prose (`GanttConfig.timeZone`, `GanttViewProps.timeZone` and `makeTzShift`) said persisted data stays real instants. A `date` field under a zoned chart has been written as a calendar day since this card's first slice; at this change the prose says so, and says that near a DST change of the chart's zone or the viewer's the shim can place a day's midnight an hour early, onto the day before. Documentation only.
  
    ⚠️ **Dated note, 2026-09-29 — a zoned chart reads and writes a day exactly on a DST change — objectui#10866, slice 5.** Later in this same release `ObjectGantt` inverts the shim exactly for a date-only day, so a stored day is drawn from its own midnight and a drop writes the day it was dropped on, on a DST change of the chart's zone or the viewer's too. The `GanttConfig.timeZone` and `GanttViewProps.timeZone` prose no longer says a day can land on the day before, and `makeTzShift`'s says a day does not take the shim's round trip. The rest of this entry is kept as the reading of this change; the slice-5 entry states what ships.
  - **core.** The `DATEADD` / `DATEDIFF` / `DATEFORMAT` docblock names how a mixed `DATEDIFF`, one day and one instant, reads each argument when it counts months or years. Comment only.
- 9e6619f: fix(plugin-timeline,core): the timeline's gantt axis draws a stored date-only day on that day in every viewer zone, and the formula date functions do their day arithmetic on the UTC calendar, as the server does (objectui#10866, slice 3)
  
  - **Timeline, gantt variant.** Every date string the gantt branch reads now goes through `toDisplayDate` from `@object-ui/core`, the step its bar tooltip already takes: in the axis headers, the extent computed from the rows, the bar positions, the validity check and the check that the start is not after the end. A date-only value is local midnight of the day it names, and a value with a time part keeps its instant, which the axis places at its local hour in the viewer's day. A number or a `Date` is an instant and is read as before. West of UTC the headers no longer read the day before: a day axis over October 5th to 7th reads Oct 5, Oct 6, Oct 7, and the schema catalog's `gantt-style-timeline.json` reads Jan 2024 to Apr 2024, where it read Dec 2023, Jan 2024, Mar 2024, Apr 2024 in Los Angeles. So the axis now agrees with the bar tooltip. The computed extent is printed as the viewer's calendar day. An empty plan's one-day axis is the viewer's today, where it was the UTC day. A bar date naming a day its month does not have, such as `2026-02-30`, is now refused by the render-time "not a valid date" message, where it was rolled into March and drawn there. `generateTimeScaleHeaders`, which the package exports, reads a date-only `minDate` / `maxDate` the same way.
  - **Formula date functions.** `DATEADD`, `DATEDIFF` and `DATEFORMAT` in `@object-ui/core` now do a calendar day's arithmetic on the UTC calendar. A date-only value naming a day its month has is read as UTC midnight of that day, as before, and is now moved and read with UTC setters and getters, so what the three answer for a day no longer depends on the viewer's zone. `DATEADD` hands such a day moved by days, months or years back as `YYYY-MM-DD`, where it gave an instant string. Its months clamp to the target month's last day, as the server's `addMonths` does: `DATEADD('2026-01-31', 1, 'month')` is `2026-02-28`, where it was `2026-03-03T00:00:00.000Z` in every zone, and a year from February 29th is February 28th. West of UTC, `DATEFORMAT('2026-09-01', 'YYYY-MM-DD')` no longer prints `2026-08-31`, `DATEDIFF` in months or years counts between the stored days rather than the days before them (`DATEDIFF('2026-08-31', '2026-09-01', 'month')` read 0), and a day added across a DST change no longer lands an hour off midnight. A value with a time part is unchanged: it is still moved and read in the viewer's zone and comes back as an instant, so `DATEFORMAT` still prints an instant's clock in the viewer's zone. So is a date-only value naming a day its month does not have, which the engine rolls forward as before. `TODAY()` is unchanged.
- b2683a2: fix(core): `normalizeListViewSchema`'s density fold tests an own key, not `in` (objectui#10868)
  
  The fold turned a legacy `densityMode` into `rowHeight` when the value was `in`
  `DENSITY_MODE_TO_ROW_HEIGHT`, and `in` walks the prototype chain. So
  `densityMode: 'toString'` came back with `rowHeight` set to
  `Object.prototype.toString`, a function, and the key was dropped. The fold now
  uses the same own-key test that `rowHeightToDensityMode` uses in the read
  direction. An inherited key such as `'toString'` or `'constructor'` is now
  treated like any other unrecognized density, such as `'cozy'`: nothing is
  folded, `rowHeight` stays unset, and `densityMode` is kept. The three densities
  `compact`, `comfortable` and `spacious` fold exactly as before.
  
  Such a value reaches the fold only on a render path that does not validate.
  `@object-ui/types`' zod schemas already refuse it: the `list-view` node declares
  `densityMode` as a three-value enum, and a named view refuses `densityMode` by
  name.
  
  docs(types): `NamedListView`'s docblock no longer says the type is used in
  `ObjectViewSchema.listViews`. Since objectui#7928 that member has been the
  protocol's `ObjectListViewSchema`, by reference. The docblock now says what the
  type is: exported, and the type of no member of the contract. The type itself is
  unchanged.
- 6cd8f66: The console strings objectui#10900 left English under zh-CN now read the session's language (objectui#10969).
  
  - **The action runner's other own text.** `ActionRunner` asks the translator installed through `setTranslator` (objectui#10900) for three more strings it writes itself: the error toast when the error that reached it carries no readable message (`actions.failed`), a parallel chain's error when no failed action reported one (`actions.parallelFailed`), and the label of an undoable success toast's Undo button (`actions.undo`). An author's `errorMessage` / `successMessage` and an action's own error stay untranslated. With no translator the text stays English.
  - **The Undo label now arrives from the runner.** For an undoable result the runner hands the toast handler `undo: { label }` where it used to hand `undo: {}`; `ToastHandler`'s type is unchanged (`label` was already optional). A handler that renders `options.undo.label` shows the translated label; one that ignores it keeps its own.
  - **The console app's `system/*` breadcrumbs.** In `AppHeader`, the segment after `System` for `settings`, `apps`, `profile`, `approvals`, `ai-approvals` and `audit-log` reads `console.breadcrumb.*` (as `marketplace` has since objectui#10900). In English, `ai-approvals` now reads `AI Approvals` instead of the humanized slug `Ai Approvals`; the other five read as before. A segment the header does not know keeps its humanized slug.
  - **The Build Doctor drawer's body.** Its description, loading and not-found states, summary line, verdict, and each section's title and hint read `console.ai.buildDoctorDrawer.*`. The report's own data (tool, artifact and status names, timeline text) stays verbatim.
  - **"manifest ID" leaves the marketplace search placeholder in every pack.** `en` now reads `Search apps by name or app ID…`, and the eight packs that translated the jargon literally follow. zh already read 「按名称或标识搜索应用…」 and is unchanged.
  
  The new keys are in all ten packs.
- 63ab761: Citations of objectstack cards now name their repository (objectui#11016).
  
  A bare `#N` in this repository resolves to an objectui item. Where the sentence
  meant an objectstack card, a reader who followed the number landed on an
  unrelated objectui card or pull request, and nothing flagged it: both
  repositories answer for the number, so an earlier sweep that looked for dead
  numbers could not see this class.
  
  Two of those citations are runtime text, and they now name the card they mean:
  
  - `@object-ui/core`: the dev warning for an action that still carries the
    retired `execute` key (`RETIRED_ACTION_KEYS.execute`) points at
    objectstack-ai/objectstack#3855, the card that retired the alias. The rest of
    the message, including "rename the key to `target`", is unchanged.
  - `@object-ui/app-shell`: the Studio skill form's help text for
    `triggerConditions` points at objectstack-ai/objectstack#1878 and
    objectstack-ai/objectstack#1895.
  
  The other sites are code comments and doc comments in the non-test sources,
  requalified the same way: a bare number whose sentence meant
  an objectstack card now reads `objectstack-ai/objectstack#N`. Numbers that mean
  an objectui card stay bare. Where a comment quotes objectstack's own text, the
  quote keeps its words and the card name sits in square brackets, the editorial
  mark for a substituted word.
  
  Pending entries in this release that carry such a number get a dated note
  naming the card, and their frontmatter is unchanged.
  
  Nothing else moves: no key, accept set, refusal decision or code path.
- a782fa7: An unlabelled undoable action's Undo and Redo toast names the object and carries no English verb (objectui#11080).
  
  - **The description no longer starts with a verb.** An `undoable` update whose action declared no `label` (or an empty one) described its operation as `Undo ` followed by the object's API name. The three places that build the operation now write the object identifier each already holds: `ActionRunner`, the console runtime's `api` handler and `RecordDetailView`'s `api` handler. An authored `label` still wins, byte for byte.
  - **Why the verb goes.** The console's global Ctrl+Z / Ctrl+Shift+Z toasts already say Undo or Redo themselves, from the pack keys `actions.undoneOperation` and `actions.redoneOperation`. The fallback's own `Undo ` doubled that verb on the undo toast, and was wrong on the redo toast: under zh-CN they read 「撤销：Undo task」 and 「重做：Undo task」, and now read 「撤销：task」 and 「重做：task」. English reads `Undo: task` and `Redo: task`.
  - **What does not change.** `UndoableOperation` is byte-identical, there is no new key, and `@object-ui/core` gains no text and no translator contract. The object is named by its API name in all three producers, not by its label.
  - **No migration.** A stack restored from `objectui:undo-history` keeps the description it was saved with.
  
  The fallback is reached only by an undoable action with an empty or missing `label`: `@objectstack/spec` requires an action to declare one, so in practice that is a code-built `ActionDef` or an authored empty label.
- bf43afa: fix(core,app-shell): Undo of a lookup update restores the stored id, not the expanded record (objectui#11122)
  
  **Clause-②: no** — no authorable key, schema or prop moves. `captureUpdateUndoData` gains a required third argument, the written object's field definitions; the function's export is still unreleased (it ships with the pending objectui#11082 changeset), so no published version carries the two-argument form. `ActionContext` declares no new member: the runner reads `objectFields` through the interface's existing open index signature, the way it already reads `objectName`.
  
  - **A relation's Undo value is the id it stores.** Surfaces read rows with `$expand` on the relations they show, and the server puts the related record where the id was. The Undo snapshot copied that record, so Undo wrote `{ id: 'a1', name: 'Acme' }` into a lookup that stores `'a1'`: refused under a strict value-shape posture, stored as corruption under the lenient one. `captureUpdateUndoData(writtenFields, rowRecord, fields)` now captures a field the object declares relational (`lookup`, `master_detail`, `user`, `tree`) as its id, and a `multiple` one as its array of ids. It uses `toPredicateRecord`, the rule that already binds a fetched record to its stored ids for predicates, so the two cannot disagree about which fields are relations.
  - **Read from the field definitions, never from the value's shape.** A `json` field holding an object with an `id` is captured, and restored, exactly as the record carries it. Called with `undefined` for `fields`, nothing is treated as a relation.
  - **All three writers pass the definitions.** The console runtime's `api` handler looks up the written object in its `objects` and then in the console's metadata store. The record page passes its object's fields. `ActionRunner`'s `operation: 'update'` reads `objectFields` from the action context, where the console runtime and the record page now publish their object's field definitions beside `objectName`; it uses them only for that object.
  
  Pinned in `packages/core/src/actions/__tests__/captureUpdateUndoData.relations-11122.test.ts`, `packages/app-shell/src/views/RecordDetailView.undoLookupId-11122.test.tsx` and `packages/app-shell/src/hooks/__tests__/useConsoleActionRuntime.undoLookupId-11122.test.tsx`.
- 58da8ae: A blank gate predicate is diagnosed on the three paths that still drew it in
  silence, and objectui's two gate mirrors whose protocol key refuses a blank now
  refuse it too (objectui#11262, ADR-0137 D4 and D1). **No drawn verdict moves:** a
  blank gate is still "no gate".
  
  **Diagnosed, verdict unchanged (`@object-ui/core`, `@object-ui/plugin-form`).**
  ADR-0137 D4 says a blank gate predicate is "diagnosed, never a silent `true`".
  objectui#8069 diagnosed the `{ dialect: 'cel' }` route; three paths stayed silent,
  and each now reports through that same guard (`evalFieldPredicate`'s `[blank]`
  report, deduped per blank text and locator):
  
  - `ExpressionEvaluator.evaluateCondition`'s legacy path: a bare `''`, a
    whitespace-only string, and an envelope without `dialect` whose `source` is
    blank. These are the values `SchemaRenderer`'s visibility legs pass through
    raw. The answer is still `true` in every mode, `throwOnError` included. A
    caller that passes `onFault` receives the `[blank]` reason there; every other
    caller gets the built-in warning. A blank on either route lands on one dedupe
    key, so `''` and `{ dialect: 'cel', source: '' }` print one line.
  - `evalRowPredicate`: a bare blank string returned the caller's fallback before
    anything could say so. It now takes the route its blank-envelope twin already
    took, with the same fallback and the same report (labelled on the
    `warnOnError` route).
  - `sectionFields`' `attachVisibility` (every sectioned `object-form` arm): a
    blank view-level predicate is still dropped, so the field draws with no gate,
    and the drop is reported, naming the field. A runtime field that already
    carries its own blank `visibleOn` keeps it. The form renderer reports that one
    when it evaluates it.
  
  **Refused at authoring (`@object-ui/types`, minor, a narrowing).** The protocol
  declares an option's `visibleWhen` and a form view field's `visibleWhen` /
  `visibleOn` as `EvaluatedExpressionInputSchema`, which refuses a blank predicate
  (since `@objectstack/spec` 17.5.0). objectui's `SelectOptionSchema.visibleWhen`
  and `FormFieldSchema.visibleOn` override those keys to keep objectui's wire, and
  they still accepted `''`, whitespace and a blank envelope `source`. Both now
  refuse them at the key, with the protocol's own sentence, through the check the
  field-rule triad already carries. The accepted shape is unchanged: the same wire
  options, by reference, and the parsed value is the authored one.
  
  `BaseSchema`'s `visible` / `hidden` / `disabled` have no protocol counterpart,
  so a blank there still parses and is only diagnosed.
- 5638529: Docblock only, no behavior change: `partitionRowsByPredicate` now names its callers and says who decides
  "is a gate declared?" (objectui#11322).
  
  The shared partitioner keeps its opening test exactly as it was (`null`, `undefined` or `''` admits
  every record). Its docblock used to call that test "blank string", which it never was: whitespace-only
  text and an envelope whose `source` is blank are evaluated there and exclude every record. That is the
  answer its built-in Delete `userActions.delete.visibleWhen` callers get. The bulk-action fold asks the
  action family's `hasDeclaredVisibilityGate` before calling it, so a blank bulk `visible` reaches it as
  `undefined`. `hasDeclaredPredicate`'s docblock names that new consumer and the field-rule tests that stay
  outside the family.
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
- ae476b8: Pin that `normalizeListViewSchema`'s output is AUTHORABLE, and retire the stale
  "pending promotion" note on the legacy toolbar-flag fold (objectui#5435).
  
  objectui#5435 was filed against `@objectstack/spec@17.0.0`, where the fold turned
  the legacy `showGroup` / `showHideFields` / `showColor` flags into
  `userActions.group` / `.hideFields` / `.rowColor` — three keys
  `UserActionsConfigSchema` did not declare, so the fold's own output was refused BY
  NAME by the schema a stored view is validated against.
  
  The maintainer ruled Option A (2026-08-22) and the fix landed **upstream**, not here:
  the spec adopted all three, and its declaring docblock names this card by number.
  This repo resolves `@objectstack/spec@17.4.0`, so the gap is closed in objectui's
  actual installed behaviour, not merely in the protocol's source. Measured, with a
  firing control that reddens on a genuinely undeclared key — the original defect was
  that nothing ever asserted the fold's output was authorable.
  
  ⛔ The three toggles are NOT retired. `ListView` honours them and the protocol now
  declares them, so tombstoning them here would leave objectui narrower than the
  protocol.
  
  No behaviour changes. The published bytes that move are one corrected docblock in
  `dist/utils/normalize-list-view.js`, which is why this is a `patch` and not a
  no-release changeset: the comment told future readers (human and AI) that the
  promotion was still pending upstream, which is now false. Graded `patch` rather than
  `minor` because no API is added, removed or reshaped.
- 546ddf7: A node-gate visibility predicate that FAULTS now says so in a production build, once per
  distinct predicate source (objectui#6038, maintainer ruling 2026-08-25, option B: "the
  silence is no longer an accepted property"). Observability only — no verdict moves.
  
  `SchemaRenderer`'s visibility chain is fail-open: a predicate that cannot be evaluated
  resolves to the same answer as one that said yes, so a gate that stops biting looks
  exactly like a gate the author got right. The diagnostic that names it (objectui#5454 /
  objectui#5687) sat behind a `__DEV__` short-circuit, because the only fault-detection
  channel available was `throwOnError`, and on the CEL branch `evaluateCelCondition`
  implements that by evaluating **twice** — too expensive to ship for every predicate of
  every node.
  
  **What production actually printed before, measured per dialect on the built evaluator**
  — the card's premise held for one dialect of three, and the other two failed in opposite
  directions:
  
  | dialect | production console, before |
  |---|---|
  | bare string | **nothing** |
  | `{ dialect: 'cel' }` envelope | one generic line, deduped per source |
  | `${…}` template | one generic line **per evaluation**, never deduped |
  
  So the dialect objectstack#11254 measured a live gate breaking on was the silent one,
  while the template dialect was the console flood the ruling's rate-limit clause exists to
  prevent.
  
  **The fix reports the fault the evaluator already detected, at the same number of engine
  calls.** `EvaluationOptions.onFault` is a new passback on `@object-ui/core`'s
  `ExpressionEvaluator`: every fault site is already inside a `catch`, or already holds the
  canonical engine's failure reason, so nothing is evaluated twice. It mirrors, one layer
  up, the seam `FieldPredicateDiagnostic` already documents (`warn: false` plus a reason
  passback), and supplying it transfers reporting to the caller so one fault stays one
  line. Pinned: the CEL branch performs the same number of record reads with the passback
  as without it, and strictly fewer than the `throwOnError` probe.
  
  `SchemaRenderer` passes it in production and reports through the **same** reporter the dev
  branch uses — same message, same severity, same dedupe `Set`, same key. Development and
  production now print the identical line for the identical fault; the `__DEV__` gate no
  longer decides *whether* a fault is reported, only *how* it is detected.
  
  `page:tabs` item-level `visibleWhen` (`@object-ui/components`) is covered by the same
  reporter and the same rate limit. It swallowed the identical fault under a different
  helper, and it was the worse of the two: the node gate at least reported in development,
  while a faulting item predicate was silent in *both* builds on a gate whose false verdict
  removes an entire tab, header and panel.
  
  **Rate limit:** deduped per (node type, gate key, predicate source) — never per render and
  never per node instance. A two-hundred-row list of one broken predicate is one line; a
  second distinct predicate source still gets its own line. Both halves are pinned, because
  a test that asserts only "a warning was emitted" is equally green on an implementation
  that emitted fifty, and one that asserts only "exactly one" is equally green on an
  implementation that suppresses everything.
  
  **Not changed by this card, deliberately:** the fail-open semantics themselves; the
  objectui#5687 adapter-only `data.*` report, which stays development-only under its own
  2026-08-22 ruling (that path is not a fault — the predicate evaluated perfectly, against
  the wrong object); and the `features` root on `/forms/:name`, which objectui#6262 settled
  by refusing it in form-view predicates rather than wiring it.
  
  `reportUnresolvableVisibilityPredicate`, `formatUnresolvableVisibilityMessage`,
  `UNRESOLVABLE_VISIBILITY_PREFIX` and `__resetVisibilityPredicateWarnings` are now exported
  from `@object-ui/react` so every surface that evaluates a node `visibleWhen` shares one
  reporter and one rate limit — a second copy would mean a second dedupe `Set`, and one
  authored predicate would be entitled to one line per package instead of one line.
- a26b9e4: `packages/core/src/adapters/README.md` now documents the adapters that are actually in that
  directory, and the ObjectStack material it carried moved to the package that owns the behaviour
  (objectui#6213). Both files ship to consumers — `@object-ui/core` publishes its `src/`, and a
  README rides every tarball — so this was published documentation describing the wrong package.
  
  The page had been left behind when the ObjectStack adapter moved out to
  `@object-ui/data-objectstack`: its headings, feature list, filter-operator table and
  query-parameter table were all about that adapter, and its one-entry "Available Adapters" list
  told a reader Object UI has exactly one adapter and that it comes from `@object-ui/core`.
  `ApiDataSource`, `ValueDataSource`, `resolveDataSource`, `runBatchTransaction` and
  `emulateBatchTransaction` — the five exports that directory really ships — were named nowhere.
  
  - **`@object-ui/core`**: the page now opens with what the directory holds, gives each export a
    usage snippet and a `provider` mapping, and points at `@object-ui/data-objectstack` for the
    ObjectStack adapter. `## Creating Custom Adapters` is unchanged — it is the one section that was
    always about this directory.
  - **`@object-ui/data-objectstack`**: gains a `## Query Translation` section carrying the
    filter-operator and query-parameter mapping tables, the AST conversion example and the sorting
    example. That material existed **only** in the `core` copy — this package's README documented
    query translation as a single feature bullet — so it is ported, not dropped.
  
  No runtime behaviour changes; the duplicate copy of one package's documentation living under
  another package is what goes away.
- 3c2b6f7: Two deprecation warnings pointed at `MIGRATION_GUIDE.md`, a file deleted from the
  repository in `8c5d20455` (objectui#6342).
  
  `Registry.register()`'s missing-namespace warning now points at the live docs page
  that documents namespaced registration
  (`/docs/guide/plugin-development#namespaced-registration`) instead of the deleted
  guide. At this change, `ValidationEngine`'s function-based-condition warning drops
  its `See:` line entirely: the deleted guide covered component namespaces and lazy
  field registration and never documented conditions at all, so that pointer was
  misdirected as well as dead, and the warning already carries the complete
  before/after migration inline.
  
  ⚠️ **Dated note, 2026-09-25 — `ValidationEngine`, and with it the warning described
  above, is removed from `@object-ui/core` by a later change; in a release that carries
  both entries, only the `Registry.register()` warning ships — objectui#7659.**
  
  Both are console messages shipped to application developers, so neither can use
  the immutable `git show <sha>^:<path>` provenance form objectui#6275 used for a
  docblock — a reader of the npm package has no repository to run it against.
- 5961030: `@object-ui/core` and `@object-ui/data-objectstack` now declare
  `"@objectstack/spec": "^17.2.0"` rather than `^17.0.0`, which is the lowest published
  spec that carries every symbol each package's own build output references
  (objectui#6361).
  
  `packages/core/dist/utils/column-sortability.d.ts` references
  `FIELD_SORTABLE_UNPROVISIONED_ANCHOR`, `FIELD_UNSORTABLE_VIRTUAL_TYPE`,
  `FieldSortability` and `ObjectSortability` from `@objectstack/spec/api`, and
  `packages/data-objectstack/dist/index.js` references the first two — none of which
  `@objectstack/spec@17.0.0` exports. Measured against the published tarballs rather than
  the installed tree, by `scripts/check-spec-range-floors.mjs`: six `floor-too-low`
  findings across the two packages, and `^17.2.0` is that gate's own computed answer for
  both. So the old range was a claim neither package could honour: any consumer
  resolution that lands 17.0.0 — a sibling pinning it exactly, an `overrides` entry, a
  mirror two minors behind — satisfied `^17.0.0` and got a dangling reference.
  
  Nothing a consumer installs today changes: normal resolution already picks the newest
  17.x, and `pnpm-lock.yaml` still resolves `17.2.0` on both edges after the bump — only
  the recorded `specifier:` moves. No source and no behaviour changes, which is why this
  is scored `patch`, on the reasoning `111741454` used for the same remediation on
  `@object-ui/plugin-detail`.
  
  The bump is release-blocking rather than cosmetic. `check:spec-floors` is deliberately
  not a `pull_request` job, so every PR stayed green while its blocking copy on the
  publish path — `pnpm changeset:publish` runs it before a single tarball reaches npm —
  would have cancelled the next release.
- 299102e: `ExpressionEvaluator.evaluate` now reports a faulting `${…}` at most **once per authored
  source** instead of once per evaluation (objectui#6444). It is the hottest of the three
  predicate paths in this area — `SchemaRenderer` calls it for every `properties.*` value,
  every `props.*` value and `content`, for every node, on every render — so a single broken
  `${…}` prop in a 200-row list wrote 200 console lines per render, and 200 more on the next
  one. Measured on the built evaluator before the fix: three identical faulting
  `evaluateCondition` calls produced 3 lines where the `{ dialect: 'cel' }` envelope produced
  1; the 200-row list produced 200. After: 1 in every case.
  
  This is the one-per-source rate limit both sibling reporters already carry
  (`warnPredicateFailure` in `fieldRules.ts`, `visibilityDiagnostic.ts` in `@object-ui/react`),
  not a third mechanism. The dedupe key is the predicate's **authoring** identity — the fault
  site plus the source text, never the scope it ran against — which is both the siblings'
  precedent and the defect itself: the 200-row flood is one authored source evaluated against
  200 distinct scopes, so a scope-sensitive key would emit all 200 lines again.
  
  Nothing else moves. The two message texts are unchanged, a distinct broken source still gets
  its own line, `EvaluationOptions.onFault` still fires on every fault (objectui#6038's passback
  contract, so a caller doing its own warn-once bookkeeping keeps control of it), `throwOnError`
  still throws on every evaluation, and no symbol is added to the published surface.
- 831be72: Dev-mode `validateSchema` no longer reports every expression-valued `visible` / `disabled`
  gate as an invalid schema (objectui#6505). `BASE_SCHEMA_RULES` declared both keys
  `typeof value === 'boolean'`, so the exact authoring form the docs teach —
  `{ "type": "button", "disabled": "${record.stage == 'closed'}" }` — printed
  `disabled must be a boolean` and its host element got `data-obj-schema-invalid`, the cue
  apps are told to hang a red outline off.
  
  **The accept set widens to what the protocol already declares and the runtime already
  accepts, not beyond it.** `AGENTS.md` §4 declares both keys as expressions, `SchemaRenderer`
  evaluates them through `hasDeclaredPredicate` + `evaluateCondition`, `@objectstack/spec`
  normalizes every authored predicate into a `{ dialect, source }` envelope, and the
  objectui#3862 / objectui#3955 rulings are entirely about which expression spellings count
  as declared. This table was the one place in the repo that disagreed, so this restores
  declared = enforced rather than changing a contract.
  
  **The rule still bites, and that half is pinned separately.** The two keys stay in
  `BASE_SCHEMA_RULES`: a number, `null`, `{}`, an array, `''`, whitespace-only predicate text
  and the empty / blank-`source` envelope (objectui#3960) are all still reported at their own
  path with `INVALID_TYPE`. Every one of those was reported before this change too — the
  accept set is a strict superset of the old one, so nothing that validated stops validating
  and nothing refused becomes accepted. The message now names both halves of the accept set
  instead of only the half that did not change.
  
  The verdict is delegated to `hasDeclaredPredicate` (`evaluator/declaredPredicate.ts`), the
  repo's single definition of "is a predicate gate declared on this value?"
  (objectui#3850's ruling), rather than answered a second time in the validator — a
  hand-rolled twin that agrees today and drifts tomorrow is the defect class this rule was
  already an instance of. `packages/core/src/validation/__tests__/predicate-valued-gate-rules.test.ts`
  pins the delegation behaviourally: the rule's verdict must equal
  `boolean || hasDeclaredPredicate(value)` across every probe in the file.
  
  The explicit boolean arm is kept even though `hasDeclaredPredicate` already subsumes it, so
  the superset relationship is provable locally: a future narrowing on the declaredness side
  cannot silently start reporting `disabled: false` — the most explicit gate an author can
  write — as an invalid schema.
  
  The zod `safeValidateSchema` surface (`@object-ui/types/zod`, objectui#6318) is a different
  validator and is untouched.
- d0889e2: Resolve a relationship target from `reference` only — the spec spelling
  (objectui#6528).
  
  `resolveReferenceTo` (dataset designer) and its sibling
  `resolveRelationshipTarget` (`chart-series.ts`) each read a relationship field's
  target through a four-spelling tolerant chain — `reference ?? reference_to ??
  referenceTo ?? reference_to_object`. Measured against every producer that can
  reach them, three of the four are unfounded, so the chain is narrowed to
  `reference` in BOTH places in one pass (they must not diverge — a fix leaving
  them disagreeing recreates the defect one file over).
  
  The census, with `reference` itself as the positive control every zero is
  measured against:
  
  | spelling | `ObjectSchema.safeParse` (spec 17.2.0) | producers on the object-metadata surface |
  |---|---|---|
  | `reference` | ACCEPTED | live — both designer writers emit it; 445 of 565 lookup/master_detail defs in the framework tree |
  | `reference_to` | REFUSED BY NAME | 0 (live only on ObjectUI's own view/field schema — a different contract) |
  | `referenceTo` | REFUSED BY NAME | 0 (producers retired by objectui#6041; stripped by the read door since objectui#6519) |
  | `reference_to_object` | REFUSED (not even an alias) | 0 anywhere in either tree, outside the chain and its own test |
  
  Behaviour change, and it is deliberate: `chart-series.ts` reads
  `GET /meta/object/:name` directly, with no read door stripping retired keys, so
  a stored pre-objectui#6041 row spelling the target `referenceTo` no longer
  resolves there. The walk is best-effort by construction — no entry is yielded
  and the caller keeps the raw value — so such a row degrades visibly instead of
  being silently absorbed. Per AGENTS.md #0.1 that row is a producer-side defect,
  and a lenient consumer is where it would have stayed hidden. `reference` was
  already head of the old chain, so any document carrying both is unaffected.
  
  The string / array / `{ object }` carriers are untouched: the carrier is a
  separate axis from the spelling and narrowing it needs its own census.
  
  ⚠️ **Dated note, 2026-09-30 — `reference_to` is no longer live on ObjectUI's own view/field schema — objectui#11070.** The table's `reference_to` row said the spelling was "live only on ObjectUI's own view/field schema". Later in this same release objectui#11070 (round 4) moved that schema (`DetailViewField` / `DetailViewFieldSchema`) and the field metadata types to `reference`. The narrowing this change made is unaffected. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
- 4d5f9b4: Resolve a relationship target from a `reference` STRING only — the carrier axis
  (objectui#6648).
  
  objectui#6528 narrowed both relationship-target resolvers to the single spec
  SPELLING `reference` and left the CARRIER — the shape the value may take —
  explicitly for its own census. That census is done, and it says the same thing:
  `resolveReferenceTo` (dataset designer) and its sibling
  `resolveRelationshipTarget` (`chart-series.ts`) each accepted three carriers on
  the canonical key, two of which `FieldSchema` never declared. Both are removed
  in BOTH files in one pass (they must not diverge — a fix leaving them
  disagreeing recreates the defect one file over).
  
  The measurement, with the bare string as the positive control every zero is
  measured against:
  
  | carrier | `ObjectSchema.safeParse` (spec 17.2.0) | producers at the field-def key position |
  |---|---|---|
  | `reference: 'crm_account'` | ACCEPTED | live — 587 across both trees |
  | `reference: ['crm_account']` | REFUSED — `expected string, received array` | 0 |
  | `reference: { object: 'crm_account' }` | REFUSED — `expected string, received object` | 0 |
  
  The census walked STRUCTURE, not text: JSON/YAML parsed and walked, TS/TSX read
  through the TypeScript compiler API, each hit recorded with its ancestor
  property chain and its enclosing object's sibling keys so a FIELD DEF is
  separated from the other tiers that also spell `reference` (a form field
  literally named `reference`, its translation entries, a JSON-Schema property
  descriptor, a liveness-ledger row). Every dynamic initializer at the field-def
  position resolved to a string-typed source, and every `reference` TYPE
  declaration in either tree declares `string`. The detector is not blind to the
  shape it hunted — it DID report array and `{ object }` carriers, and every one
  was a test asserting this very tolerance plus one framework lint fixture whose
  own rule already reads string-only.
  
  The array branch was also a silent PRODUCT decision: handed a multi-target
  value it returned element zero and DISCARDED the rest. Nothing declares such a
  value. Polymorphic lookup is an open, unbuilt gap in the spec's own audit report
  ("Current `reference` only supports a single target", Tier 3), and the
  platform's one polymorphic reference (ADR-0018 `xRef`) is a STRING with a
  sibling discriminator, never a list. A multi-target lookup, if it lands, lands
  as a declared spec shape — not as a carrier a consumer guesses at.
  
  Behaviour change, and it is deliberate: a field def whose `reference` is not a
  non-empty string now resolves to `undefined` in both helpers. Such a document is
  already refused by `ObjectSchema`, so per AGENTS.md #0.1 it is a producer-side
  defect, and a lenient consumer is exactly where it would have stayed hidden. The
  two unit assertions that pinned the tolerant reads are converted to refusal
  pins, so re-widening the carrier turns red.
- 9e37d9b: `binding` on a component input is framework-set, not author-declared: `@object-ui/types` gains `InjectedComponentInput`, the `'field'` binding arm is retired from `@object-ui/sdui-parser`'s `RegistryConfigLike`, and the `as ComponentMeta` cast at the injection seam in `@object-ui/core` is gone (maintainer ruling of 2026-09-07, director decision batch #69; ADR-0049 enforce-or-remove).
  
  **What was measured.** `binding` was published — the manifest serializer forwards it — and read — `validateTree` records a binding site for it — while `ComponentInput`, the authoring type every registration writes against, did not declare it. The one writer in the tree, `ELEMENT_DATA_SOURCE_INPUT`, therefore carried a hand-written inline type and reached a registration's `inputs` through `as ComponentMeta` in `Registry.register`. Declared narrower than enforced, on a published type — and `ComponentInput`'s own docblock listed `binding` among the forwarded per-input keys.
  
  **The ruling** answered the product question the card asked — may an ordinary registration declare a binding input? — with no. So:
  
  - **`@object-ui/types`** exports `InjectedComponentInput`, an `interface … extends ComponentInput` with the required marker `binding: 'object'`. `ComponentInput` itself does not change: no member is added, and authoring `binding` on a registration stays an excess-property `tsc` error — now on purpose and documented at the interface. The two tombstone docblocks that listed `binding` as a forwarded key now say it is forwarded from the framework's injected input, not authored.
  - **`@object-ui/core`** types `ELEMENT_DATA_SOURCE_INPUT` as `InjectedComponentInput` and splices it through a typed local; the cast is gone. Runtime behaviour is unchanged — the same key, `type`, `binding` and `description` reach the manifest, and `validateTree` still records the binding site.
  - **`@object-ui/sdui-parser`** narrows `RegistryConfigLike.inputs[].binding` from `'object' | 'field'` to `'object'`. The `'field'` arm had zero writers — every `binding:` literal in `packages/`, `apps/` and `examples/` is `'object'`, 7 of 7 at this change's merge-base — and nothing on either side of the manifest resolved a field binding. **Breaking, deliberately:** a config that feeds `manifestFromConfigs` a `binding: 'field'` input is now a type error instead of a manifest entry the server would never resolve. `ManifestInput.binding`, the manifest reader's vocabulary, is not narrowed by this change.
  
  If a real need for author-declared bindings is ever measured, it is filed as a widening of `ComponentInput` with the vocabulary decided then — not by putting the cast back.
- 48c19bd: Render a dataset measure over a date field as a date (objectui#7178, maintainer
  ruling 2026-09-02, director summon #8 — option A).
  
  `formatMeasure` opened with `if (typeof v !== 'number') return String(v)`,
  placed **before** `format` was ever read. So a `min` / `max` measure over a date
  or datetime field printed its stored value verbatim — a 24-character ISO string
  in the KPI tile's `text-2xl font-semibold`, wrapping to two lines — and the
  `format` that `DatasetMeasureSchema` accepts was unreachable for those values.
  A date-shaped value now routes to the date display path before that
  short-circuit, so all four dataset-bound surfaces are served at once: the metric
  tile, chart values, dataset table cells, and the metadata-admin dataset preview.
  
  `min` / `max` over a date stays a legal measure; nothing in `@objectstack/spec`
  narrows. `PivotTable` takes a `number` outright and is unchanged.
  
  **No second date formatter was written.** `formatDate`, `formatDateTime`,
  `formatRelativeDate` and `DateDisplayOptions` MOVED from `@object-ui/fields`'
  barrel down into `@object-ui/core` (`utils/date-display.ts`), which is the same
  remedy objectui#4576 applied to `formatDisplayNumber` and for the same reason:
  `core` is the React-free engine and could not import from a React package, so
  the alternative was a parallel date convention in `dataset-format.ts` — exactly
  the drift that once had a list cell rendering `1.234,5 %` beside a dashboard
  measure's `1.234,5%`. `@object-ui/fields` re-exports all four names unchanged,
  so no consumer's import path or behaviour changes, and a reference-identity test
  pins that the cell renderer and the measure formatter call the same function.
  
  **What `format` can say for a date measure, measured rather than assumed.** The
  shared date path takes a named STYLE, not a date pattern: `'short'` and
  `'relative'` are honoured — the same words `DateCellRenderer` honours from
  `field.format` — while a pattern such as `'YYYY-MM-DD'` renders the locale
  default. That limit is unchanged by this release (`plugin-dashboard`'s
  `recordFields` already routed a date-shaped `format` into the same style slot)
  and is now pinned by a test instead of being silent.
  
  **Numeric measures are byte-identical.** 33,696 argument forms
  (value × format × currency × percentScale × locale) were compared against a
  verbatim copy of the pre-fix function: the only values that moved were the four
  ISO-shaped, parseable ones. Numbers, numeric strings (`'1751612400000'`,
  `'2026'`), the nullish em dash, arbitrary prose and non-strings all render
  exactly as before.
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
- 19f1639: A synthesized default list view now always leads with the object's name field
  (objectui#7245).
  
  **The defect.** An object that declares no list view gets its default grid columns
  synthesized from `highlightFields`, taken verbatim. But `highlightFields` is ADR-0085's
  *"most important fields"* role, not a column list — and its first consumer, the
  detail-page highlight strip, **deliberately removes the title field**, because the page
  H1 directly above it already shows one. So metadata that is entirely correct routinely
  omits the record's name from `highlightFields`. The showcase `showcase_account` declares
  `nameField: "name"` and `highlightFields: ["status", "industry", "annual_revenue"]`, and
  its default `所有记录` grid rendered 14 rows whose columns were `#` / Lifecycle / Industry
  / Annual Revenue / actions — no name column, and no way to tell one account from another.
  
  A list has no H1 to lean on, so the same declaration needs the opposite treatment here.
  This is not a new convention: `deriveLookupColumns` in `@object-ui/fields` already leads
  its record-picker columns with the display field and filters it out of the declared list.
  The list faces now agree with it.
  
  **What changed.** `@object-ui/core` gains two exports on the ADR-0079 title ladder:
  
  - `resolveNameField(objectDef)` — *which field* titles an object: the declared
    `nameField` (then its deprecated `displayNameField` / `NAME_FIELD_KEY` aliases), else
    the type-aware derivation. The name-space twin of `getRecordDisplayName`, which answers
    what that field *says* on one record. Both now read one spelling of the declared
    pointer, so they cannot drift into naming different fields.
  - `leadWithNameField(objectDef, columns)` — moves that field to the front of a
    **synthesized** column list.
  
  All three faces that synthesize default list columns call it: `ObjectView`
  (`defaultListColumnsFromObject`), `InterfaceListPage` (`defaultColumnsFromObject`) and
  `ObjectGrid`'s own derivation. The name field is **moved**, not merely appended, so an
  author who lists it third still gets it first — "the column that identifies the row"
  means first. On the two capped faces the lead is applied *before* the 5 / 6-column slice,
  so an object declaring its name field late no longer loses it off the end.
  
  **Scope, deliberately narrow.** Author-declared column lists are untouched — a view or
  grid that declares `columns` / `fields` said what it wants, and reordering it would be
  renderer-side second-guessing of metadata. Three cases also decline to lead: a name field
  the object carries no field def for (never fabricate a column), one marked
  `hidden: true` (the author said don't show it), and a *derived* pick that lands on a
  system-managed column — `deriveTitleField` filters by type only, and leading a default
  list with a raw id is the regression objectui#2702 / #2777 fixed. A *declared*
  `nameField` pointing at a system field still leads: `sys_migration` really does point at
  `id`, and an explicit designation is not a heuristic misfire.
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
- 1e215c4: The ingestion choke point's diagnostic for a stored `id_field` now carries the reason
  `@objectstack/spec` publishes for that key (objectui#7650).
  
  `FieldSchema` declares no successor for `id_field`, so `normalizeSchemaReferenceKeys`
  leaves the key exactly as served and, in dev, says it cannot canonicalize it (the
  `no-declared-twin` diagnostic). That line now also carries `FIELD_KEY_GUIDANCE.id_field.why`,
  read from the installed `@objectstack/spec/data`: the spec's own sentence on why the key has
  no successor and what to author instead. objectui keeps no copy of that sentence, and the
  read has no fallback: on a spec without the row, the dev-mode diagnostic throws instead of
  printing less. Production never reads the row.
  
  Nothing else moves. `id_field` is still never folded and no `idField` is read; a typo such as
  `sortible` still gets no suggestion; no accepted document, published type or served value
  changes. No floor raise: `@object-ui/core` already declares `@objectstack/spec ^17.5.0`, and
  17.5.0 is the first published release carrying the row (17.4.0 has none).
  
  The line's closing clause is corrected for every refusal: it said the value "reaches no reader",
  which is false where a retired spelling is still read on purpose (`resolveActionParam` reads
  `id_field`), and it now says that a consumer reading only the spellings `FieldSchema` declares
  will not see the value.
- 52cac38: `formatDate` reads `options.style` (objectui#7745).
  
  `DateDisplayOptions` is the one bag `formatDate` / `formatRelativeDate` /
  `formatDateTime` share. `style` was added to it for `formatDateTime`'s `'compact'`
  grid face (objectui#7443, PR #7621) and only `formatDateTime` read it, so on
  `formatDate` the key was inert — and inert beside a POSITIONAL parameter of the same
  name. `formatDate(v, undefined, { style: 'short', locale: 'en-US' })` rendered
  `Jul 4, 2024`, the default face, with no diagnostic; it now renders `Jul 4, '24`.
  This is the additive half of the maintainer's long-run ruling on objectui#7443:
  both functions accepting `options.style`.
  
  **The precedence is pinned: the positional argument wins.** `options.style` is
  consulted only when the positional slot is `undefined` (`??`, not `||`, so `''`
  still counts as given). That is the only direction that is purely additive — it
  fires exactly on the input that is a silent no-op today, so no call that renders a
  face today renders a different one after. The reverse would let a key aimed at a
  SIBLING function outrank an argument written for this call: the bag is shared, and
  carrying `{ style: 'compact', locale }` built for `formatDateTime` into
  `formatDate(v, 'short', bag)` must not cost that call its short face.
  
  **What changes for you.** Only `formatDate(value, undefined, { style: 'short' | 'relative' })` —
  a call that silently rendered the default face before. Every call that passes the
  style positionally, and every `formatDateTime` / `formatRelativeDate` call, renders
  byte-identically to before.
  
  `formatRelativeDate` still does NOT read `style`; the ruling names `formatDate`
  only. Its out-of-window fallback to `formatDate` strips the key so that the new read
  cannot leak in through the delegation — which also keeps
  `formatRelativeDate(v, { style: 'relative' })` from recursing.
- fc32921: Fix a dashboard chart widget with a FIELDLESS `count` aggregate plotting nothing
  (objectui#8266).
  
  A widget bound to an object with `aggregate: { function: 'count', groupBy: 'status' }`
  and no `field` — the normal way to author "how many records per status" — rendered an
  empty chart. No error, no empty state: a plot frame with the category ticks drawn and
  not one mark in it, which reads exactly like "this object has no rows yet".
  
  **Cause.** The two dashboard relays (`DashboardGridLayout`, `DashboardRenderer`) each
  built the series binding as `aggregate?.field || (options.yField || 'value')`, which for
  a fieldless count resolves to `'value'`. The rows an object-bound fieldless count
  returns are keyed `'count'` — the alias the engine projects `COUNT(*)` under, pinned
  since framework#3701. A `dataKey` naming a column no row carries plots nothing, and
  neither of the renderer's two guards fires on it: the rows DO carry the category key,
  and the series array is not empty.
  
  **Fix.** `chartMeasureKey` is a new `@object-ui/core` export delegating to
  `chartAggregateValueKey` in `@objectstack/spec/ui` — the contract's own derivation of
  "the value column an object-bound aggregate produces". Both relays now consult it, and
  the row-projection side (`aggregateValueKey` in `@object-ui/plugin-charts`) is routed
  through the same function, so the two halves of the question cannot drift again.
  
  **What moves on screen.** A chart that was blank now draws. Charts that already drew are
  unaffected: a field-bearing aggregate resolves to its raw field under both the old and
  the new reading, and a chart with no `aggregate` at all keeps the author's `yField`.
  One authored key changes meaning: a `yField` written on an object-bound chart that
  ALSO declares an aggregate no longer wins over the aggregate's own column — it named a
  record column that a grouped aggregate never returns, so it plotted nothing before.
  
  **Not fixed here, and out of scope.** The same widget with no `options.xField` is
  refused by the category-axis guard naming `name`, a key the author never wrote (they
  wrote `aggregate.groupBy`). That is the category half of the same relay gap and is
  filed separately.
- 8f9d87a: Fix a dashboard chart widget that declares its category as `aggregate.groupBy` being
  refused for lacking a `name` column (objectui#8269).
  
  A widget bound to an object with `aggregate: { function: 'count', groupBy: 'status' }`
  and no `options.xField` rendered a refusal instead of a chart:
  
  > This chart cannot plot its category axis: no row has a `name` field.
  
  The author wrote `groupBy: 'status'`. Nothing on screen said `groupBy` was the key that
  had been ignored, and `name` appeared nowhere in their metadata — so the diagnostic sent
  them to debug the wrong layer.
  
  **Cause.** The two dashboard relays (`DashboardGridLayout`, `DashboardRenderer`) each
  floored the category binding on a literal — `options.xField || 'name'` — and handed it to
  the `object-chart` node without ever consulting the aggregate that decides it. An
  object-bound aggregate returns one row per group keyed by the raw `groupBy` field, so no
  row carried `name` and the category-axis guard (framework#4033) fired correctly on a
  binding that was already wrong when it arrived.
  
  **Fix.** `chartCategoryKey` is a new `@object-ui/core` export delegating to
  `chartAggregateCategoryKey` in `@objectstack/spec/ui` — the contract's own derivation of
  "the category column an object-bound aggregate produces", and the published sibling of the
  `chartAggregateValueKey` that objectui#8266 adopted for the measure axis. Both relays now
  consult it for the object-provider branch.
  
  **What moves on screen.** A widget that rendered a refusal now draws. Measured through
  `ChartRenderer` at 480x320 over the rows a fieldless count returns
  (`[{status:'open',count:2},{status:'paid',count:5}]`): the composed binding went from
  `xAxisKey: 'name'` — a `missing-category-key` refusal, 0 marks — to `xAxisKey: 'status'`,
  1 series and 2 marks with the category ticks drawn.
  
  **Unaffected.** A chart with no `aggregate` at all keeps the author's `xField` (its rows
  are raw records, so that key is the right one), an UNGROUPED aggregate keeps it too (it
  returns a single row with no category column), and the authored-literal-rows branch — the
  `chart` node composed after the object-provider check fails — keeps its floor unchanged.
  One authored key changes meaning, exactly as objectui#8266's `yField` did: an `xField`
  written on an object-bound chart that ALSO declares a `groupBy` no longer wins over the
  aggregate's own column — it named a record column a grouped aggregate never returns, so it
  produced the same refusal before.
- 317dbce: `validateSchema` takes `unknown` instead of `any`, and narrows the value before it reads a
  key off it (objectui#8416). The published declaration moves by exactly one token —
  `validateSchema(schema: any, path?: string)` becomes `validateSchema(schema: unknown,
  path?: string)` — and no call site has to move with it: every value is assignable to
  `unknown`, the function is not generic, and its return type is the concrete
  `SchemaNodeValidationResult`, which names no parameter type. Nothing outside the package
  needed a cast or an edit.
  
  **The half that is not a type annotation: `validateSchema(null)` no longer throws.**
  `validateSchema` calls four rules unconditionally and only one of them — `validateBaseSchema`
  — ever checked that it had an object. `validateFormSchema` read `schema.type` and
  `validateChildren` read `schema.children` regardless, so `validateSchema(null)` and
  `validateSchema(undefined)` threw `TypeError: Cannot read properties of null (reading
  'type')` instead of returning the `INVALID_SCHEMA` result the function's own contract
  promises; `isValidSchema(null)` threw instead of answering the `false` its docblock
  documents, and `assertValidSchema(null)` threw that `TypeError` in place of its own
  `Schema validation failed:` refusal. The single guard now runs once, in `validateSchema`,
  before any rule reads a key. The same one-level-down defect is closed with it: a `null`
  entry inside a form's `fields` array threw the same `TypeError` and is now reported as
  `MISSING_FIELD_NAME`.
  
  **No verdict that already existed changes.** The guard's accept set is the one it replaces,
  spelled the same way (`!value && typeof value !== 'object'` refuses `null`, `undefined` and
  every primitive; arrays and plain objects pass), so an array node keeps its
  `MISSING_REQUIRED`, a primitive keeps its single `INVALID_SCHEMA`, `null` holes inside
  `children` are still skipped, and no new error `code` is emitted. A 29-case accept-set
  matrix was diffed before and after: every difference is a value that used to THROW and now
  returns a result. The one exception is a corner JSON cannot express — a *named function* as
  a `fields` entry used to satisfy `field.name` through `Function.prototype.name` and now
  reports `MISSING_FIELD_NAME`; function values on this mirror are already refused
  (objectui#6124).
- ce45a03: `ValueDataSource`: a stored value that is not a string now satisfies `not_contains`
  / `$notContains` instead of failing the operator and its negation both.
  
  Both arms were written as `typeof value === 'string' && !value.includes(target)` — a
  type test standing in for the predicate. A row whose column held the number `5`
  failed `contains '5'` (correct: a number cannot contain a substring) and also failed
  `not_contains '5'` (wrong: for that same reason it does not contain it), so the row
  appeared in **no** filter answer, and the opposite filter — the one thing a user has
  to debug a missing row with — was silent too. Measured on a mixed fixture,
  `not_contains '5'` returned 1 of 8 rows where it now returns 7.
  
  The arms are now the exact complement of `contains` / `$contains`. The positive text
  operators are unchanged and keep their type gate: that is the other half of
  objectstack#14079 (maintainer ruling 2026-09-05, option A) — a non-string never
  satisfies a positive text operator and always satisfies `$notContains`, so
  complementarity holds on every face.
- fb3a101: `ValueDataSource`'s object-dialect matcher executes `$and` and `$or`
  (objectui#8513). A `provider: 'value'` list with a grouped filter returned
  **zero rows**; it now returns the rows the platform's own conformance table says
  it should.
  
  **What moved.** `{ $or: [ … ] }` and `{ $and: [ … ] }` were refused by the
  object-dialect matcher — the row excluded, the reason logged since
  objectui#8447, and before that excluded in silence. They are now evaluated, and
  they nest and AND with their sibling keys the way a `FilterCondition` says they
  do. Refusing them made this adapter the one face answering "no rows" to a shape
  `@objectstack/spec` declares, this repo's own `convertFiltersToAST` lowers, and
  all five platform backends execute. **No accept set is widened**: no new
  operator, no new key, nothing admitted that `FilterConditionSchema` does not
  already declare.
  
  **The empty-group identities** follow objectstack#5322 (merged as
  objectstack#5365) — `{ $and: [] }` matches every row, `{ $or: [] }` matches
  none, a `{}` branch is a TRUE disjunct that absorbs its `$or` and drops out of an
  `$and`. They are not written as special cases: `every` and `some` already answer
  that way for an empty array. Pinned against the spec's published cross-backend
  `FILTER_LOGIC_CASES` table rather than a local fixture — 27 of its 29 cases pass,
  up from 10.
  
  **Why this is a fix and not a feature on the reachable path.**
  `convertFiltersToAST` returns the ORIGINAL object when a filter lowers to no
  conditions, and the TRUE identities are exactly that case — so `toFilterNode`
  hands `{ $and: [] }` and `{ $or: [{}] }` back unlowered and every consumer on
  that chain drops them straight onto `$filter`. Those two filters mean "every
  row" and answered "no rows".
  
  **`$not` is unchanged and still refused**, deliberately. Its NULL-safe semantics
  are ruled (objectstack#5146), but this repo's `convertFiltersToAST` throws for it
  on an AST-shaped narrowing — `FILTER_ARRAY_LOGIC_KEYWORDS` is `['and', 'or']`,
  and rewriting the negation inward is silently partial because `startswith` /
  `endswith` / `between` / `icontains` have no negated counterpart. Whether that
  narrowing should stand now that upstream has ruled is a separate question. The
  refusal now carries its own message naming `$not` rather than falling through to
  the generic combinator arm, so the three combinators stay three distinct cases —
  they failed in **opposite** directions before objectui#8447 and a fix must not
  flatten them.
  
  ⚠️ **Dated note, 2026-09-27 — a zero-key condition refuses the whole filter, a `{}` branch's `$or` included — objectui#10817.** Later in this same release an object `$filter` whose field entries or `$and` / `$or` members carry a condition that is an object with no own keys (`{ created: {} }`, or a non-`Date` exotic comparand) is refused before any row is matched, so `{ $or: [{}, { created: {} }] }` answers no rows rather than every row. "a `{}` branch is a TRUE disjunct that absorbs its `$or`" above is this change's reading for such a filter, not the release's. The rest of this entry is kept as the reading of this change; the objectui#10817 entry states what that input now answers.
- f391ede: `convertFiltersToAST` now refuses a bare ARRAY in comparand position —
  `{ tags: ['a', 'b'] }` — with a `FilterOperatorError` (`INVALID_FILTER` / 400)
  that names the field, prints the comparand and prescribes the spelling that
  works, instead of lowering it to `['tags', '=', ['a', 'b']]` (objectui#8530).
  
  That node was never answerable: the ObjectQL filter AST has no array-equality,
  so `@objectstack/driver-sql` refused it with `400 INVALID_FILTER` from the wire
  and every in-memory matcher (`@objectstack/formula`, `ValueDataSource` since
  objectui#8514) excluded every row. The author found out two layers away, as a
  failed list or an empty one. The refusal now lands at lowering time, where the
  field and the offending value are still in hand — the same treatment this file
  already gives `$regex` and `$not`, the two other shapes it cannot lower.
  
  It is deliberately NOT read as membership. `{ tags: [...] }` and
  `{ tags: { $in: [...] } }` are different statements and the second is already
  spellable; rewriting one into the other would guess at intent and silently
  change which rows a stored view returns — the lenient second contract
  objectui#8514 was resolved against on this same data shape one layer down. The
  error message says so, and names `$in` / `$nin` / `$between` as the spellings to
  use. `$in` / `$nin` / `$between` members, `$and` / `$or` groups and stored
  `ViewFilterRule` values (`in` / `between`) are legitimately arrays and keep
  lowering exactly as before.
  
  Every producer in this repository already spells a multi-value comparand
  `{ $in: [...] }` (measured across the `$filter` literals and record builders
  under `packages/*/src` and `apps/*/src`), so no shipped surface changes
  behaviour; only a hand-authored `{ field: [...] }` now fails at the producer
  instead of the consumer. No ruled contract ever answered that shape — the spec
  leaves an array outside `$in` / `$nin` / `$between` unruled, `driver-sql` and the
  in-memory matchers refuse it, and only a document store's native array-equality
  happened to read it — so nothing a backend was promised is taken away.
- f5cfbbd: `convertFiltersToAST` now lowers a `Date` comparand instead of silently dropping
  the field it sits on (objectui#8555).
  
  The operator-object arm opened on `typeof value === 'object' &&
  !Array.isArray(value)`, and a `Date` passes both tests. `Object.entries` of a
  Date is `[]`, so the operator loop body never ran and NO condition was pushed:
  `{ status: 'a', created: someDate }` lowered to `['status', '=', 'a']`. Nothing
  threw and nothing warned — the result set simply got WIDER than the author asked
  for, which is the one failure direction this file exists to avoid. The defect
  also depended on the field's siblings: with the Date alone, `conditions` ended
  empty and the original object came back untouched, so it only became visible
  once a second field was present.
  
  It is LOWERED, not refused, and `@objectstack/spec` is what decides that —
  the opposite answer to objectui#8514, which was a refusal precisely because the
  spec declined to rule on that shape. Here it rules twice over (measured against
  spec 17.3.0): `ACCEPTED_FILTER_COMPARAND_TYPES` is
  `['string','number','bigint','boolean','null','Date']`, and
  `$gt` / `$gte` / `$lt` / `$lte` / `$between` declare `z.ZodDate` in comparand
  position.
  
  The AST leaf carries the `Date` INSTANCE. The wire form is deliberately not this
  adapter's question to answer: `parseFilterAST(['created', '=', d])` hands back
  `{ created: d }` with the Date intact, and the operator arm has always emitted
  `{ created: { $gte: d } }` as `['created', '>=', d]` — so converting to an ISO
  string or an epoch here would make the shorthand and the operator form emit two
  different comparand types for one author intent. The gate is the spec's own
  `isAcceptedFilterComparand` rather than a local `instanceof Date`, the same
  reason this file already routes operators through the spec's
  `normalizeFilterOperator` instead of a second map.
  
  Operator objects are untouched: `{ age: { $gt: 26 } }`, `$in` / `$nin` /
  `$between` members, `$null` / `$exists`, the `$regex` / `$not` / bare-array
  refusals, and an empty `{}` operator object (still the TRUE identity, still
  constraining nothing) all behave exactly as before.
  
  ⚠️ **Dated note, 2026-09-27 — an empty operator object ALONE is now refused — objectui#9164.**
  Later in this same release an empty operator map that is all a filter says
  (`{ created: {} }`) is refused with a `FilterOperatorError` rather than returned as the
  object. Beside a key that lowers it still constrains nothing, which is what "still the
  TRUE identity" above describes. The rest of this entry is kept as the reading of this
  change; the objectui#9164 entry states what that input now answers.
  
  ⚠️ **Dated note, 2026-09-27 — an empty operator object BESIDE a key is now refused too — objectui#10788.**
  Later in this same release an empty operator map beside a key that lowers
  (`{ status: 'a', created: {} }`) is refused with a `FilterOperatorError` naming the field
  instead of constraining nothing, because `@objectstack/spec` records `{ field: {} }` as
  REJECTED (objectstack#5240). So "still the TRUE identity, still constraining nothing" above
  is this change's reading, and "Beside a key that lowers it still constrains nothing" is the
  objectui#9164 note's reading; neither is the release's. The rest of this entry is kept as
  the reading of this change; the objectui#10788 entry states what that input now answers.
- f5cfbbd: `viewFilterRuleToNode` now refuses an ARRAY on a single-value operator instead
  of passing it through verbatim (objectui#8557).
  
  A stored view rule never had its `value` inspected, so
  `{ field: 'tags', operator: 'equals', value: ['a'] }` lowered to
  `['tags', 'equals', ['a']]` — and the spec's own doors accept that node unjudged
  (`isFilterAST` is `true`, `parseFilterAST` hands back `{ tags: ['a'] }`, measured
  against spec 17.3.0). The refusal therefore arrived two layers away, as
  `@objectstack/driver-sql`'s `400 INVALID_FILTER` or as an empty list from an
  in-memory matcher, with nothing to attribute it to. It is the same
  array-in-a-scalar-slot shape objectui#8530 refused in `convertFiltersToAST`'s
  object arm, which deliberately did not reach this door — so a hand-authored
  `{ tags: ['a'] }` failed fast with a message naming `$in` while the same mistake
  saved into a view stayed silent. That asymmetry is closed.
  
  The guard keys on the operator's ARITY, never on `Array.isArray(value)`: `in`,
  `not_in` and `between` legitimately carry arrays through this same function and
  are untouched. The arity comes from the spec's own
  `VIEW_FILTER_LIST_VALUE_OPERATORS` and `VIEW_FILTER_PAIR_VALUE_OPERATORS` rather
  than a local list — the docblock on the first of them names a hard-coded
  `["in", "notIn"]` as the mistake it exists to prevent — and the check runs after
  `normalizeFilterOperator`, so an alias is judged by what it means (`nin` is
  `not_in`, and keeps its array). Two classes are deliberately left alone: an
  operator the spec does not know is still passed through verbatim, because the
  misspelling is already the loud failure and refusing here would report the wrong
  problem; and the valueless operators (`is_null`, `is_empty`, …) are not refused,
  because the spec discards their value anyway
  (`parseFilterAST(['tags', 'is_null', ['a']])` is `{ tags: { $null: true } }`), so
  a stray array there cannot select the wrong rows. A pin holds the four arity
  classes to an exact partition of `VIEW_FILTER_OPERATORS`, so a new spec operator
  reddens rather than silently inheriting a verdict.
  
  The refusal is a `FilterOperatorError` (`INVALID_FILTER` / 400), which means a
  saved view with one bad rule now fails at render rather than returning a
  narrower result. That is not a new blast radius: both sinks already catch this
  error class from this same file — `plugin-list`'s `buildEffectiveFilter` and
  `plugin-view`'s `ObjectView` each call it inside their load `try` — and
  `classifyLoadError` reads the code and status, so what a user sees is the
  "filter is malformed" panel rather than a network fault or a crashed page. The
  alternatives are both silent: dropping the rule widens the result set, and
  rewriting `equals` into `in` changes what the saved view means.
- 64c3cdd: `convertFiltersToAST` now refuses a non-Date EXOTIC object in comparand position
  — `{ name: /abc/ }`, a `Set`, a `Map`, a `URL`, any class instance — with a
  `FilterOperatorError` (`INVALID_FILTER` / 400) that names the field and the
  value, instead of silently dropping the condition (objectui#8567).
  
  This is the other half of the hole objectui#8555 closed. The operator-object arm
  iterates `Object.entries(value)`, and `Object.entries` of a `RegExp`, a `Set`, a
  `Map` or a `URL` is `[]` — so the loop body never ran and NO condition was pushed
  for the field: `{ status: 'a', created: /abc/ }` lowered to
  `['status', '=', 'a']`. Nothing threw and nothing warned; the result set simply
  got WIDER than the author asked for, which is the one failure direction this file
  exists to avoid. As with the Date half, it depended on the field's siblings —
  with the exotic value alone, `conditions` ended empty and the original object came
  back untouched, so the defect was invisible until a second field appeared.
  
  It is REFUSED, not lowered, and `@objectstack/spec` is what decides that — the
  opposite answer to objectui#8555 for the opposite reason. Measured against spec
  17.3.0: `isAcceptedFilterComparand(/x/)` is `false`, and
  `normalizeFilterComparandTypes({ created: /x/ })` answers `INVALID_FILTER` / 400
  — *"Filter comparand at where.created is a RegExp instance ({}), which no driver
  can compare."* Lowering the value would only move that refusal downstream, so the
  answer the wire would give two layers later is given at lowering time, where the
  field name and the offending value are both still in hand. The message states the
  accepted types in the spec's own words (`ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE`)
  rather than repeating a second list, and prescribes `$contains` / `$startsWith` /
  `$endsWith` for a text match, `$in` for a membership test and `$gte` with a `Date`
  for a date bound.
  
  The gate is the value's PROTOTYPE, not `Object.keys(value).length === 0`: zero own
  entries is exactly what `{}` and `/x/` have in common, and they need opposite
  answers. An empty operator object stays the TRUE identity and constrains nothing;
  a null-prototype bag and a cross-realm plain object are still read as operator
  maps; `Date` comparands still lower (objectui#8555); operator objects, `$in` /
  `$nin` / `$between` members, `$null` / `$exists`, `$and` / `$or` groups and the
  `$regex` / `$not` / bare-array refusals are all exactly as they were.
  
  ⚠️ **Dated note, 2026-09-27 — an empty operator object ALONE is now refused — objectui#9164.**
  Later in this same release an empty operator map that is all a filter says
  (`{ created: {} }`) is refused with a `FilterOperatorError` rather than returned as the
  object. Beside a key that lowers it still constrains nothing — the case this entry's
  control pins — and it is still never read as an exotic comparand. The rest of this entry
  is kept as the reading of this change; the objectui#9164 entry states what that input now
  answers.
  
  ⚠️ **Dated note, 2026-09-27 — an empty operator object BESIDE a key is now refused too — objectui#10788.**
  Later in this same release an empty operator map beside a key that lowers
  (`{ status: 'a', created: {} }`) is refused with a `FilterOperatorError` naming the field
  instead of constraining nothing, because `@objectstack/spec` records `{ field: {} }` as
  REJECTED (objectstack#5240). It is still never read as an exotic comparand: the refusal is
  the empty-operator-map one, not this entry's. "An empty operator object stays the TRUE
  identity and constrains nothing" above is this change's reading, and "Beside a key that
  lowers it still constrains nothing" is the objectui#9164 note's reading; neither is the
  release's. The rest of this entry is kept as the reading of this change; the objectui#10788
  entry states what that input now answers.
- d1865d2: A `dependsOn` declared on a field-backed **lookup action param** now gates, **ungates**
  and filters the picker (objectui#8672, maintainer ruling — director decision batch #115,
  2026-09-11, arm A "wire it").
  
  **What was broken.** `ActionParamDialog` threaded its live record (`dependentValues`) to
  the option widgets only — `select` / `multiselect` / `radio` / `checkboxes`. A `lookup`
  param is in none of those, so `LookupField` fell through to the `SchemaRendererContext`
  tail that is unconditionally `{}` (nothing can populate a member the type does not
  declare), `dependenciesMissing` could never clear, and the trigger rendered **disabled
  forever** — prompting for the very field the user had just filled. There was no error at
  author time, at type-check or at runtime: the failure looked like a broken picker rather
  than a key that did nothing here.
  
  Independently, the one route the repo's own `RESOLVED_ONLY_PARAM_KEYS.dependsOn` message
  points authors to ("make the param field-backed to pick it up") read the **snake**
  spelling `field.depends_on`, which `@objectstack/spec`'s `FieldSchema` refuses by name,
  while the camel `dependsOn` it declares was never read. The two spellings were disjoint,
  so no spec-valid document could reach the feature at all.
  
  **What changed.**
  
  - `ActionParamDialog` now supplies its live `values` to the reference-bearing pickers as
    well as to the option widgets. That is the dialog's whole record: unlike the grid
    (`ctx.pendingRow ?? ctx.row`) it is not scoped to a row — its params *are* the record,
    which is the same record its option widgets have resolved against since objectui#3765.
  - `resolveActionParams` reads the declared `field.dependsOn` and no longer reads
    `field.depends_on`. Unlike its five sibling lookup keys the snake leg is removed rather
    than demoted, because there is no producer to protect: no document that parses can
    carry a spelling `FieldSchema` rejects by name.
  
  Nothing about the cascade itself is new. `LookupField` has always turned `dependsOn` into
  a hard `$filter` shared by the quick-select popover, the Level-2 table picker and
  PeoplePicker; this supplies the one input no host could otherwise deliver.
  
  **Unchanged on purpose.** `ActionParamSchema` still refuses `dependsOn` written *inline*
  on a param — the honoured route is the field-backed one. `CASCADE_OPTION_WIDGET_TYPES`
  gains no member: it is shared verbatim with the object form's cascade-clear loop and with
  `plugin-grid`'s `BulkActionDialog`, and it means "this widget's offered *option set* is
  re-resolved", which a lookup has none of. The dialog ORs a second family beside it
  instead — the shape the object form has shipped all along. The bulk action dialog is
  untouched and still carries the original gap.
- c372b29: The `dataSource.view` not-found panel no longer asserts that an object has no saved
  views when nobody found out (objectui#8900).
  
  `elementDataSourceViewNotFoundMessage` ended its empty-list branch with "This object has
  no saved views." — a statement about the OBJECT, derived from a count that is equally
  zero in two different worlds. `ObjectStackAdapter.listViews` degrades every failure
  (refused, offline, malformed) to `[]` on the RESOLVED path — deliberate, shipped, and
  kept — while `useElementDataSource`'s own discrimination only catches a REJECTION, a
  shape that contract never produces. So a `view` read that never successfully happened
  arrived at the renderer indistinguishable from a genuine absence, and the config-error
  panel stated as fact something nobody had established. A host that composes
  `@object-ui/react` + `@object-ui/plugin-list` without `app-shell`'s `AdapterProvider`
  subscribes to no warning channel at all and sees only that sentence.
  
  The empty branch now reads **"No saved views are known for this object. It may have
  none, or they could not be read."** — the strongest claim that is true in BOTH worlds,
  applying framework objectstack#13906 decision 1 option A (*a thing that could not be
  READ is not a thing that is ABSENT*) at the one place the two worlds are structurally
  indistinguishable.
  
  Unchanged: the non-empty branch (`Known views: …`), the adapter's degrade-to-`[]`
  contract, and the refusal to fall back to an unfiltered query for the object. Saying
  more than this needs the failure FACT plumbed through from the adapter, which is
  objectui#8151's surface and not this change.
- 969d4f2: docs(core): the `ElementDataSourceConfig.filter` note now separates what an author may write from what a renderer may still receive (objectui#8945)
  
  The note said "three shapes legitimately reach a renderer here" — a MongoDB-style
  record, an ObjectQL AST tuple array and a spec `ViewFilterRule` array — and typed
  `filter` as `unknown` "rather than the spec's `FilterCondition`". Since the spec's
  `filter` doors converged on the rule array (objectui#6206; migration
  `element-data-source-and-object-block-filter-rule-array`), that sentence mixes two
  populations the convergence split apart:
  
  - **What an author may write** is the `ViewFilterRule` array alone,
    `[{ field, operator, value }, …]`. `ElementDataSourceSchema` refuses the record
    form by kind and refuses an AST tuple array because each member must be a rule
    object.
  - **What a renderer may still receive** is all three. The D2 conversion
    `page-component-filter-record-to-rule-array` rewrites a stored `filter` only
    where the rule array spells it losslessly (a flat record, an operator object
    whose operators the rule vocabulary spells, several such keys, or a
    single-level AST tuple array), on every ObjectStack stored-row read and under
    `os migrate meta --stored`. It leaves exactly as stored a filter carrying
    `$and` / `$or` / `$not`, any filter with a part that has no lossless rule
    spelling (a `null` value, `$null` / `$exists` or an AST `like`, an array or
    object comparand in equality position, an AST `and` / `or` group), and every
    filter of a component whose rows are inline. This renderer is backend-agnostic
    and replays no conversion itself; only ObjectStack's own data-at-rest seams do.
    So all three shapes may still arrive, and `mergeFilterNodes` still lowers each
    of them.
  
  The note now states both, names the spec's type as `ViewFilterRule[]` rather than
  `FilterCondition`, and keeps `filter` typed `unknown` for the reason it always
  had: this interface carries stored values, and narrowing it would only move the
  cast. The module's example binding writes `"filter": [ … ]` instead of the record
  form it used to show.
  
  Comments only. No type, export, runtime behaviour or accepted set changes.
- f8e3e9a: Raise `@object-ui/core`'s declared `@objectstack/spec` floor from `^17.2.0` to
  `^17.3.0` (objectui#9012) — the old range admitted a spec that refuses this
  package's own output.
  
  `normalizeListViewSchema` folds objectui's legacy toolbar flags onto the
  `userActions` keys `group` / `hideFields` / `rowColor`, which the protocol
  adopted in 17.3.0 (objectui#5435). `@objectstack/spec` was declared in
  `dependencies` — consumer-facing — as `^17.2.0`, so any resolution landing on
  17.0.0 / 17.1.0 / 17.2.0 satisfied the declared range and got a normalizer whose
  output is refused **by name** at the view save gate.
  
  Measured against the published artifacts rather than the workspace copy: each
  published 17.x was installed into its own isolated consumer project and the
  fold's real output parsed against that install's own `./ui` entry.
  
      17.0.0 / 17.1.0 / 17.2.0   REFUSED  refused-keys=[group, hideFields, rowColor]
      17.3.0 / 17.4.0            ACCEPTED
  
  An undeclared firing-control key was refused by all five versions, so the
  contrast is about those three keys and not about the harness. 17.3.0 is the
  FIRST published version that accepts — verified across the entire published 17.x
  stable line (17.0.0, 17.1.0, 17.2.0, 17.3.0, 17.4.0), not by taking the first
  version that happened to work.
  
  A second, independent key family lands on the same floor: `ListViewSchema` gained
  `pageName` in 17.3.0, and the `page` view fixture this package already pins is
  refused by 17.0.0 / 17.1.0 / 17.2.0 (`refused-keys=[pageName]` plus an
  `invalid_value` on `type`) and accepted from 17.3.0.
  
  No runtime behaviour changes: on the 17.4.0 every install resolves today, this is
  the same normalizer. What changes is the declared contract — the range no longer
  claims to work against specs that refuse its output.
  
  `scripts/check-spec-range-floors.mjs` was green before and after, and would be
  green at any floor here: its criterion is symbol PRESENCE, and
  `UserActionsConfigSchema` is exported by every version above. The floor is held
  instead by `normalize-list-view.declaredSpecFloor-9012.test.ts`, which carries
  firing controls proving its comparator can redden.
- 3b6bc69: The retired-`sort` refusal no longer prescribes metadata the spec rejects (objectui#9031).
  
  `convertSortToQueryParams` refuses the retired string `sort` clause out loud, and the
  diagnostic it prints is the text an author reads at the moment they are ALREADY being
  corrected. It ended by telling them "`order` is optional and means `'asc'`". It is not
  optional: `SortConfig.order` is required on the interface, on its zod counterpart, and on
  `@objectstack/spec`'s `SortItemSchema`, which refuses an entry without it. An author who
  followed the correction verbatim was refused a second time — at publish, by a different
  door, with no hint that the advice itself was wrong.
  
  The repair is not "delete the sentence". A missing `order` genuinely IS read as ascending
  by this renderer — a real runtime tolerance, documented as `normalizeSortEntries`' rule
  since objectui#8973, and true because types are erased and an entry that arrives without
  `order` still has to mean something. The message now keeps BOTH truths and stops stating
  the runtime tolerance as an authoring permission: it asks for both keys on every entry,
  names the three faces that require `order`, and says the tolerance is a runtime reading
  rather than permission to omit the key.
  
  **Wording only — no behaviour moved.** The same inputs are refused, on the same
  `console.error` channel, returning the same `undefined`; the array arm lowers unchanged.
  Pinned by reading the ACTUAL emitted message and feeding the entry it prescribes back
  through `SortItemSchema` from the installed `@objectstack/spec`, so the pin fails if
  somebody shortens the example the diagnostic quotes rather than only if somebody edits
  prose.
- da45e6b: Fix the filter-token near-miss suggestion lookup reading `Object.prototype` (objectui#9129).
  
  `resolveContextTokens` looked a near-miss spelling up in the spec's suggestion map with a
  plain bracket index. Two lower-cased spellings, `{constructor}` and `{__proto__}`, are
  inherited `Object.prototype` member names, so the lookup resolved to
  `Object.prototype.constructor` / `Object.prototype.__proto__` instead of `undefined`, and
  the console warning asserted a "suggestion" that was actually native-code / object text —
  not a real token, not spellable, and not anything an author could act on.
  
  This is **not** prototype pollution: the index was always a read, never an assignment, and
  the resolved filter value is passed through untouched either way — no filter is ever
  widened or narrowed and no record is ever mis-matched by it. The only observable effect was
  a confusing string inside a `console.warn` call.
  
  The fix builds the lookup over a null-prototype copy of the suggestion map instead of
  special-casing the two names, so the whole class of collisions is closed (any inherited
  member, present or future), not just today's two spellings.
- ed35b44: `convertFiltersToAST` now refuses an EMPTY operator map that is all a filter says —
  `{ a: {} }`, `{ a: {}, b: undefined }`, `{ $and: [], a: {} }` — with a
  `FilterOperatorError` (`INVALID_FILTER` / 400) whose subject is the field, instead of
  handing the caller's own object back (objectui#9164).
  
  **Before.** `{ a: {} }` names a field and no operator. The converter entered the key,
  the operator loop ran zero times, and with no condition produced the general tail
  returned the CALLER'S ORIGINAL OBJECT — the one input still doing so after
  objectui#8770, objectui#9020 and objectui#9030. `@object-ui/data-objectstack`'s `find()`
  then sent two different wrong requests for it: `?a=[object Object]` with no `filter`
  parameter on the plain route, and `filter={"a":{}}` on the `$expand` / `$search` route —
  a shape `@objectstack/spec` rules REJECTED (objectstack#5240, recorded on
  `FilterConditionSchema`).
  
  **After.** The filter is refused where the field name is still in hand. The message
  names the field and the fix: choose an operator (`$eq`, `$in`, `$null`, …) or remove the
  key. It is not folded to "no filter", which would silently drop a filter the author
  wrote, and not lowered, because the spec accepts no form of it. `FilterOperatorError`
  carries `field` and no `operator`, so `filterRefusalSubject` names the field.
  
  **What an author sees.** The same as for this function's other refusals. A list or view
  that loads through `buildEffectiveFilter` / `ObjectView` fails its load with the
  `INVALID_FILTER` envelope, which `classifyLoadError` reports as a malformed filter.
  `ObjectGrid`, `RelatedList` and `LineItemsPanel` read `toFilterNodeSafely` and render the
  "this view's filter is malformed" state naming the field. `@object-ui/data-objectstack`'s
  `find()` and export reject with the envelope instead of sending either wrong request.
  
  **Also changed, by the same tail.** A combinator child that is an empty operator map is
  refused too. `{ $or: [{ a: {} }, { b: 2 }] }` used to lower to "no filter" (every row),
  because the child came back as its own object and `lowerLogicalGroup` read that as a TRUE
  disjunct. `{ $and: [{ a: {} }] }` dropped its only conjunct the same way.
  
  **Unchanged.** `{}` still returns `{}`, and `toFilterNode` still answers `undefined` for
  it. A filter that lowers (`{ a: 'x' }`) still lowers. An empty operator map BESIDE a key
  that lowers is still dropped — `{ status: 'a', created: {} }` lowers to
  `['status', '=', 'a']`. That boundary is pinned by objectui#8555 and objectui#8567, and
  this change does not move it. The TRUE-identity fold (objectui#8770 / objectui#9030) and
  the all-skipped fold (objectui#9020) are unchanged.
  
  **Migration.** A stored filter carrying `{ field: {} }` with nothing else to say was a
  wrong request before this change. It is now a named refusal. Give the field an operator,
  or delete the key.
  
  ⚠️ **Dated note, 2026-09-27 — the beside-a-key boundary is now refused too — objectui#10788.**
  Later in this same release an empty operator map BESIDE a key that lowers
  (`{ status: 'a', created: {} }`) is refused as well, with the same `FilterOperatorError`
  naming the field, instead of being dropped. The refusal moved from the general tail into
  the operator-map arm, so one throw site answers both cases. The "Unchanged" paragraph's
  sentences about that boundary is this change's reading, not the release's. The rest of this
  entry is kept as the reading of this change; the objectui#10788 entry states what that input
  now answers.
- 43c0d17: Accept an inline per-locale label on an action's `resultDialog`, and resolve it
  against the display language.
  
  `@object-ui/core`'s `ResultDialogSpec` claimed in its own docblock to mirror
  `Action.resultDialog` in `@objectstack/spec` and did not: `title`,
  `description`, `acknowledge` and each `fields[].label` were hand-written
  `string` where the contract declares every one of them `I18nLabel` — a plain
  string **or** an inline per-locale map, both authorized by that type's docblock
  and neither deprecated. This repo therefore refused what the platform accepts,
  which is the `check:spec-symbols` rule-2 failure class (an alignment CLAIM with
  a hand copy behind it), one package over from where that gate matches by name.
  
  **The consequence was measured, not inferred.** The map arm reached
  `ActionResultDialog`'s JSX as a React child and React refuses an object there,
  so the dialog did not mis-render — it threw and failed to render at all, on an
  action that had **already succeeded**. That dialog is the only place a one-shot
  reveal is ever shown (a TOTP secret, a freshly minted OAuth `client_secret`,
  regenerated backup codes), so the value was gone. The rendering test in
  `packages/app-shell` reproduces the throw: it is red on the unfixed tree with
  `Objects are not valid as a React child (found: object with keys {en, zh-CN})`.
  
  The four members now DERIVE from the contract type instead of restating it, so
  the mirror cannot drift again without `tsc` saying so, and the dialog resolves
  each through `resolveI18nLabel` from `@objectstack/spec/ui` — the producer's own
  resolver for the inline form — against `useObjectTranslation().language`, the
  same display locale every other inline-`I18nLabel` caller in `app-shell`
  resolves against. A plain-string label is unaffected: the resolver returns it
  unchanged, and the existing fallback chain still answers for an absent label or
  a map with no usable entry.
  
  Both action renderers drop the write-side narrowing assertion objectui#8648 had
  to leave behind, so the whole `resultDialog` forward is compiler-checked again
  with nothing asserted between it and `ActionDef`. The ledger leg that pinned
  that workaround is converted rather than deleted outright: the `as any` negative
  it carried is not a workaround and still guards a write-side cast that the
  read-side matcher walks straight past.
- 4a7ef0d: The `ObjectGanttSchema` and `ObjectCalendarSchema` record-source text now names
  the function their renderers actually call (objectui#9618).
  
  Their zod `.describe` strings and TS docs said the `data` → `staticData` →
  `objectName` ladder is resolved by `getDataConfig`. Neither renderer has had a
  function by that name since the ladder moved into `@object-ui/core`'s shared
  `resolveRecordSourceConfig` (`ce2aaefe1`), so the text now names that
  function. The ladder order is unchanged, and so is every accepted document.
  The `ObjectMapSchema` text still says `getDataConfig`, which is true:
  `ObjectMap.tsx` keeps a local wrapper by that name that delegates to the shared
  ladder. The `resolveRecordSourceConfig` docblock in `@object-ui/core` now says
  that the text it quotes is the map faces' text.
- 276d174: `Registry.registerLazy` now reports a bare-name collision, and `Registry.register`'s existing report is no longer blind to the other table.
  
  Clause-②: no — this adds no exported symbol, no key on a published payload, and relaxes no accept set. Which registrations the registry ACCEPTS is unchanged, and so is what `skipFallback` does; only what the registry SAYS changes.
  
  The registry has two doors onto one bare key: `register` writes `components`, `registerLazy` writes `lazyEntries`. `registerLazy` took the same `namespace && !skipFallback` fallback branch with no collision check at all, and `register`'s check read only its own table — so a contest that spans the two tables was reported by neither. Replaying this repository's own 425 declared registration claims against a real registry emitted zero collision warnings in every order, including for the one genuinely contested bare key.
  
  Both doors now consult both tables and key on the declared full type, so a contest is reported whichever order the declarations arrive in. The ordinary stub-then-real lifecycle stays silent: a stub and the registration that satisfies it name one full type, and so do the bare keys this repository stubs twice from two files with different loader closures.
  
  The two doors give different advice on purpose. `registerLazy` names `skipFallback: true`, which settles it there. `register` did not, because it cleared the bare stub whether or not the fallback was taken, so that opt-out would have left the bare key resolving to nothing — until objectui#9839, in this same release, moved that clear inside the fallback branch, after which declining the bare key leaves it with its owner and both doors prescribe the opt-out, which also supersedes the sentence this paragraph opens with.
- 2982ed9: `Registry.register` with `skipFallback: true` no longer deletes another declaration's bare-name lazy stub, so an authored node under the bare name keeps rendering instead of resolving to nothing.
  
  Clause-②: no — no exported symbol is added, no key on a published payload moves, and no accept set is relaxed. Which registrations the registry ACCEPTS is unchanged; what changes is which bare key survives a registration that declined to take it.
  
  The user-visible symptom: a plugin declared lazily under a bare name — `registerLazy('dashboard', …, { namespace: 'plugin-dashboard' })` — and a second package registering the same base type under its own namespace *with the opt-out set*, `{ namespace: 'view', skipFallback: true }`. The opt-out exists precisely so the second registration does not take the bare key off the first. It did not take it; it deleted it anyway. The bare stub-clearing lines sat OUTSIDE the `namespace && !skipFallback` branch, so the branch that claims the bare key was skipped while the delete below it ran unconditionally. An authored `dashboard` node then resolved to nobody at all: the stub that would have loaded the chunk was gone, and the registration that removed it had declined to replace it. The registry reported no collision, because from its point of view no one was contesting anything.
  
  The clearing now sits inside that branch, under the same predicate that takes the key: a registration clears the bare stub when — and only when — it claims the bare key. A registration with no namespace still clears it, because its full type IS the bare key. The ordinary stub-then-real lifecycle is untouched: a registration that satisfies its own stub still clears both keys.
  
  `unregister` carried the identical unguarded pair and is repaired with it. Its docblock promised «the bare-name fallback (when the fallback still points at this registration), plus any matching lazy stub», and «matching» is ruled here from the code's own behaviour rather than from the phrase: the components half of that same sentence is already ownership-scoped and will not drop bare `dashboard` while it resolves to `plugin-dashboard:dashboard`. Reading the stub half as unconditional makes the same call, on the same bare key, with the same owner, decide the opposite way purely because the owner happens to be sitting in the other table at that instant — and which table it is sitting in is the "has the chunk loaded yet" race this class is about. The stub therefore gets the same ownership test. The bare form, `unregister(type)` with no namespace, stays unconditional on both tables: that is the force form teardown sites pair with the namespaced call.
  
  The eager door's cross-table collision warning changed with it, and had to. It used to talk the author OUT of `skipFallback: true` — correct while the delete ran either way, since the opt-out then left the bare key resolving to nothing. Now the opt-out settles that contest exactly as it does on the lazy door, so both doors prescribe it. The pending `registerLazy` cross-table collision entry in this same release gave the old reason in its closing paragraph; that one sentence is corrected in place here, so the two entries do not publish contradicting accounts of what the opt-out does.
- 05a49f2: `normalize-list-view`'s two view-kind tables now derive their partition from the undrawable table's own keys instead of a hard-coded list of kinds, so one spelling is total against both the `@objectstack/spec` this repository resolves today and one built from objectstack `main`.
  
  `UNDRAWABLE_VIEW_KINDS` was annotated `Record<Exclude<ViewType, ListViewVisualization>, string | null>`, and `ListViewVisualization` subtracted the literal `'list' | 'detail' | 'page'`. An annotated object literal is exact in BOTH directions, so when objectstack retired the list-view kind `page` from the spec (objectstack#17063, ADR-0049 enforce-or-remove) the table's `page:` row became an excess property against the narrower union — a TS2353 whose only repair under that annotation is DELETING the row, which this repository cannot do while it resolves a published spec that still accepts `type: 'page'` views.
  
  The table now carries `satisfies Record<string, string | null>` — the value constraint without the exactness — and the undrawable union is `Extract<ViewType, keyof typeof UNDRAWABLE_VIEW_KINDS>`, so a row for a kind the spec has retired goes inert at type level while staying live at runtime, which is what an author who can still write a `page` view against the resolved spec needs. `ListViewVisualization` subtracts that derived union instead of a literal list; its members are unchanged under either spec, and so is every runtime answer this module gives.
  
  The guarantee the tables carry is unchanged and still mechanical, it just lands in one place instead of two: a kind the spec ADDS is classed by neither table, so it stays inside `ListViewVisualization`, and the total `Record<ListViewVisualization, true>` on `LIST_VIEW_KINDS` fails the build until the new kind is classed as drawable there or explained in the undrawable table. A MISSPELLED key in the undrawable table fails the same way, because the kind it was meant to class is not extracted either.
  
  Compiled both ways rather than argued. With the published pin `@objectstack/spec@17.4.0` installed, `turbo run type-check --filter=@object-ui/core` exits 0 before and after this change. With a spec built from objectstack `main` injected in its place, the same command reported the TS2353 in `normalize-list-view.ts` before and does not report it after; the diagnostics that remain on that leg come from other files, are reproduced against the pristine source, and are not this change's.
  
  `normalize-list-view.undrawableBothLegs-9880.test.ts` pins all of it over a SIMULATED vocabulary, because any single run installs only one spec: the retirement direction, the addition direction, and the old spelling's TS2353 kept as a firing control.
- a78cd37: Dates and numbers across the console and the plugins format in the session's
  display locale instead of the machine's (objectui#9909).
  
  Every one of these faces handed `Intl` — directly, or through a formatter called
  without one — either no locale tag or an explicit `undefined`, which is not "the
  user's locale": it is the locale of the machine the browser runs on, which is
  neither of this repository's two locale channels.
  A German or Spanish session therefore read, beside a translated label, a date or
  an amount grouped and decimal-marked the machine's way — and an amount with
  inverted separators does not read as unformatted, it reads as a different
  number. They now go through `useDisplayLocale()` (tenant regional default, then
  the active UI language, then `'en'`), and a plain helper takes that tag from its
  caller. The surfaces:
  
  - **`@object-ui/fields`** — `GridField`'s numeric and currency cells (list mode
    and computed columns) and both total cells. The same cell helper's date branch
    already used the display locale, so a single grid row read two conventions at
    once.
  - **`@object-ui/plugin-charts`** — ISO-date x-axis ticks, compact y-axis ticks,
    the single-value face, spec `format` strings and the tooltip value.
  - **`@object-ui/app-shell`** — the organization invitations, members and
    accept-invitation dates; marketplace version dates; the AI conversation row's
    older-than-a-week date and its tooltip; the build-debug token count; the
    record approvals timeline; and the metadata-admin audit, history, external
    datasource snapshot, schema-browser row estimate, flow-run start and job
    next-fire faces. The audit, history and flow-run panels format these in the
    DISPLAY locale, not in the `locale` prop they take for their UI strings
    (`AuditPanel` defaults that prop to `'en-US'`; `HistoryPanel` and
    `FlowRunsPanel` leave it optional).
  - **`@object-ui/console`** — the approvals inbox's timestamp tooltips, amounts
    and payload summary; the audit log's timestamp column; the flow runs table and
    its run detail.
  - **`@object-ui/components`** — the export dialog's record counts and the debug
    panel's event times.
  - **`@object-ui/plugin-form`** — the analytics submission count, the
    master-detail subtotal / tax / total stack and the edit-conflict dialog's
    "their save" time.
  - **`@object-ui/plugin-chatbot`** — the approvals inbox's past-30-days date and
    the times stamped on local-mode chat messages (the user's and the
    auto-response).
  - **`@object-ui/plugin-dashboard`** — the record-count badge, and the currency
    and date-format branches of `renderFieldValue`, which was handed the display
    locale and spent it only on its percent branch.
  - **`@object-ui/plugin-grid`** — the record-detail panel's inferred currency
    value and the mobile card's amount line, siblings of date cells already on the
    display locale.
  - **`@object-ui/plugin-designer`** — `VersionHistory`'s version times.
  
  A host that mounts one of the components that newly read the display locale with
  NO `I18nProvider` now gets react-i18next's once-per-module `NO_I18NEXT_INSTANCE`
  notice in the console on the first such mount; the faces still render, in the
  channel's `'en'` last resort, and mounting an `I18nProvider` (as the console
  does) avoids the notice.
  
  **Additive API** (nothing that compiled before stops compiling):
  
  - `@object-ui/types`: `ValidationContext` gains an optional `locale`. At this
    change, the `@object-ui/core` validation engine prints the `date_min` /
    `date_max` bound in it; omitted, `Intl` follows the runtime default, as
    `formatDisplayNumber` already declares for a caller with no locale in hand.
  
    ⚠️ **Dated note, 2026-09-25 — that engine (`ValidationEngine`) is removed from
    `@object-ui/core` by a later change; `ValidationContext.locale` stays declared in
    `@object-ui/types`, and at that change nothing in `@object-ui/core` reads it —
    objectui#7659.**
  
    ⚠️ **Dated note, 2026-09-27 — `ValidationContext` itself is removed from
    `@object-ui/types` by a later change, with the rest of the Phase 3.5
    validation types it belonged to, so the `locale` member this entry adds no
    longer exists — objectui#10719.**
  - `@object-ui/plugin-report`: `exportReport`, `exportAsHTML` and `exportAsPDF`
    take a trailing optional `locale` for the exported file's "Generated:" time,
    and `LiveExportOptions` gains an optional `locale` that `exportWithLiveData`
    forwards. Omitted, the time uses the display channel's own last resort
    (`'en'`), never the machine's locale. `ReportViewer` passes the session's
    display locale. The locale is deliberately NOT a `ReportExportConfig` member:
    that type is authored report metadata, and a display locale belongs to the
    session.
  
  **One census, repository-wide.** `plugin-detail`'s machine-locale census pin
  (objectui#9786) is now a single test, `machineLocaleCensus-9909.test.ts` in
  `@object-ui/i18n`, covering every workspace package whose manifest depends on
  `@object-ui/i18n`. It refuses any call site that passes nothing, `undefined`,
  the `'default'` pseudo-tag (a subtag no locale data answers, so `Intl` resolves
  it to the machine's locale) or a hard-coded tag, unless the site is declared
  with its reason — for example the `catch` fallback for a tag `Intl` itself
  rejected, or an ISO formatter feeding `<input type="date">`. Each declared site
  is counted exactly, so deleting one without its entry is refused too. The
  per-package pin it replaces is deleted. The runtime tripwire that observes the
  argument each locale-taking call (`Intl` constructors, `Date` and `Number`
  `toLocale*`) actually receives moved into the private `@object-ui/test-support`
  package, and every surface above is pinned with it: the same data under two
  declared locales must render differently, NO locale-taking call may receive the
  machine's locale (nothing, `undefined` or `'default'`), and the surface's own
  calls must receive the declared tag. A call carrying another declared tag, such
  as the `'en'` of the session's UI language, is tolerated by design: only the
  machine's locale is the defect.
- ff5ef1c: fix(core): refuse a retired string `sort` ENTRY out loud instead of dropping it in silence
  
  `convertSortToQueryParams` / `normalizeSortEntries` already refused the retired scalar
  clause (`sort: 'name asc'`) with a prescription naming the array form. The same clause one
  container deeper — `sort: ['name asc']` — fell through the array arm's skip, returned
  `undefined`, and printed nothing, so an authored row order disappeared with no trace in the
  console while its neighbouring spelling got a full correction.
  
  A string entry is now named by its own `console.error`, deduped per spelling like its scalar
  sibling. The message carries the worked array-of-objects example, says `order` is required at
  publish, and keeps the ascending default stated as a runtime tolerance rather than as
  permission to omit the key.
  
  ⛔ No input starts being accepted: `['name asc']` still contributes no ordering, per
  objectui#8221 (one `sort` spelling, the array, everywhere). Mixed arrays are unaffected —
  `[{ field: 'a', order: 'asc' }, 'b desc']` still orders by `a`, and the message says so
  instead of claiming the query lost its ordering. The `field`-less object entry keeps its
  declared silence.
- 81c0bc4: The dev-mode unknown-key warning stops stating a fact that was retired, and
  sends the author to the file that actually declares the interface
  (objectui#5642).
  
  Both halves of the message's tail had outlived the change they described. It
  told the author the key was warned about rather than rejected because
  `ActionDef` "still carries `[key: string]: any`" — objectstack#4075 step 3
  deleted that index signature, and `actionKeys.pin.test.ts` pins the deletion in
  the opposite direction (`{ ActionDef: false, ActionContext: true }`), while
  `actionDef-closed-surface.test.ts` pins that `tsc` now rejects exactly such a
  key at the construction site. And it prescribed promoting the key to an explicit
  field on `ActionDef` "(packages/core/src/actions/actionKeys.ts)" — that file
  holds the INVENTORY (`ACTION_DEF_KEYS`); the interface is in `ActionRunner.ts`.
  The wrong pointer had teeth: an author who followed it edited the inventory
  alone, which is precisely the half-change the pin test reddens on, since it
  re-derives the inventory from the interface's AST.
  
  The tail now carries the reason the module's own header already gives for why
  this warning survived step 3 — the two mechanisms cover disjoint populations.
  `tsc` sees action literals authored in code; the warning sees actions that
  arrive as data, from stored rows that are rehydrated unparsed and that no
  compiler ever looked at (objectstack#3903). The prescription names
  `ActionRunner.ts` for the field and `ACTION_DEF_KEYS` as the same-commit second
  edit, saying why.
  
  No behaviour change: the classification logic, the key inventory and its
  derivation are untouched, and the warning fires on exactly the same actions as
  before. Two comments in the same file and two in the pin test that described the
  pre-step-3 world were refreshed in the same pass, and the message text is now
  pinned — the printed interface path is resolved off the message and read, so a
  move or rename reddens by name instead of shipping a second dead prescription.
- 60500cb: An all-skipped filter now says "no constraint" instead of handing back the caller's
  object (objectui#9020).
  
  `convertFiltersToAST` skips a key whose value is `null` / `undefined`. That is
  long-standing, pinned, and **unchanged**: `{ a: null, s: 1 }` still lowers to
  `['s', '=', 1]`. What changed is the answer when the skip leaves nothing behind.
  The general tail used to return the CALLER'S ORIGINAL OBJECT, and that object
  meant two different things on the two `find()` routes of
  `@object-ui/data-objectstack` — measured against `@objectstack/spec` 17.4.0 and
  `@objectstack/client` 17.4.0:
  
  ```
  plain  route   GET /data/acct                        ->  EVERY row
  expand route   GET /data/acct?populate=…&filter={"a":null}  ->  the a = null rows
  ```
  
  The plain route hands the value to `client.data.find`, whose non-AST branch
  spreads a plain object's entries as query parameters and SKIPS the null ones, so
  nothing at all was appended. The `$expand` / `$search` route JSON-serialises the
  same object into `filter=`, and `{ a: null }` is a well-formed `FilterCondition`
  the spec accepts (`null` is in `ACCEPTED_FILTER_COMPARAND_TYPES`), so it arrived
  as a real predicate. One authored filter, two row sets, and the deciding input
  was whether the query happened to want a lookup expanded — which is also why it
  was self-inconsistent within one route: the key meant "no constraint" the moment
  any sibling produced a condition and meant a predicate when it was alone.
  
  The tie is broken by what the function already says about the key rather than by
  inventing a meaning for it: the loop's `continue` is the ruling, so carrying it
  to the wire is `undefined`. `toFilterNode` and `mergeFilterNodes` inherit that,
  so such a filter is now skipped rather than landing in AST child position, where
  `isFilterAST` refused it and the whole list answered 400.
  
  An author who MEANT the predicate spells it `{ a: { $null: true } }` ->
  `['a', 'is_null', true]`, on both routes, as before.
  
  Same ANSWER as objectui#8770's TRUE-identity fold, deliberately not the same
  state: they are two counts and two guards, so a filter that MIXES the kinds
  (`{ $and: [], a: null }`) still returns the object — objectui#9030's open
  question, untouched here.
- 516583b: fix(core): a date-only value renders the calendar day it names, in every viewer timezone
  
  `formatDate` / `formatRelativeDate` / `formatDateTime` parsed every string value
  with `new Date(value)`. ECMAScript reads the two ISO shapes in two different
  zones — a date-only form is UTC, a date-time form without an offset is local —
  so `2026-08-01` became UTC midnight and was then read back through this module's
  LOCAL getters. West of UTC that is the previous calendar day: a `date` field
  storing `2026-08-01` rendered `7月31日` for a UTC-7 viewer while the stored
  value, the API response and a UTC+8 viewer all said August 1st. The relative
  branch shifted with it, one day per day (`2026-08-31` read `4天前` on the 3rd).
  
  A date-only value names a calendar day and carries no instant, so there is no
  conversion to perform: it is now rebuilt at LOCAL midnight of the day it names,
  and every getter downstream reports that day in every zone. Nothing adds or
  subtracts hours — an offset that cancelled the shift would be wrong again at a
  DST boundary and wrong in the other direction east of UTC, where the old parse
  already landed on the right day. A value carrying a time is untouched: it HAS an
  instant, and rendering an instant in the viewer's zone is what a `datetime` is
  for. What the path accepts is unchanged by this fix. (A well-shaped impossible
  day such as `2026-02-30`, which the engine rolls into March, is now refused by
  the same path — objectui#10026, a separate entry in this release.)
  
  Every caller that hands these functions the wire string moves with the fix —
  the `date` cell and its readonly field face, `ObjectGrid`'s date columns and
  mobile cards, `ObjectGantt`'s tooltips, `FormulaField`, lookup column display,
  and dataset date measures.
- 8ebd57f: Both `evaluateExpression` references in the `ExpressionEvaluator.registerFunction`
  JSDoc are now qualified, so each resolves to the entity it means (objectui#5580).
  
  `ExpressionEvaluator.ts` declares two things spelled `evaluateExpression`: the method
  on `ExpressionEvaluator` (bare expression, throws) and the module-level export
  (context bag, fail-soft, delegating to `evaluate`). The `registerFunction` block
  referred to both under the one spelling, four lines apart.
  
  The prose link was not merely ambiguous, it was bound wrong. Measured with
  `checker.getSymbolAtLocation` on the pre-fix source, `{@link evaluateExpression}`
  resolved to the module-level `FunctionDeclaration` — the fail-soft one — inside the
  sentence that calls it *"the throwing sibling"*. The neighbouring `{@link evaluate}`
  binds to the method, but only because no module-level `evaluate` exists to outrank
  it, so the rule "an unqualified link resolves to the enclosing class's member" does
  not hold here. The link is now `{@link ExpressionEvaluator.evaluateExpression}`,
  which the checker resolves to the `MethodDeclaration`.
  
  The `@example`'s final line is the module-level export — its second parameter is a
  context bag and the `${...}` wrapper only resolves on the `evaluate` path — but it sat
  two lines below calls that establish `evaluator.` as the receiver, and a `.d.ts` hover
  carries no import to disambiguate. It now names the module-level export and shows the
  import it needs.
  
  This is prose only: the diff is confined to a block comment and no declaration moves.
  It is scored `patch` rather than the empty-frontmatter form because the block is
  emitted into what npm ships — measured, this edit moves both
  `dist/evaluator/ExpressionEvaluator.d.ts` and `dist/evaluator/ExpressionEvaluator.js`
  (this package builds with a bare `tsc`, which preserves comments in the JS emit), and
  the ten changed lines in that JS are all comment lines.
  
  `registerFunction-jsdoc-links.test.ts` pins the binding against the checker rather
  than asserting it in prose, since a `{@link}` that binds to the wrong entity is
  indistinguishable in source from one that binds right.
- 7138bc1: The dev-mode unknown-key warning stops flagging `overrideNotice`, the console's
  privileged-override safety copy (objectui#5611).
  
  `ActionRunner.execute` classifies the object it was HANDED, and a console host
  hands it a DISPATCH, not a stored metadata row. `DeclaredActionsBar` composes
  `overrideNotice` on that dispatch and two param-collection handlers read it —
  yet the key inventory only mirrored AUTHORED surfaces, so the runner reported a
  key two files read as one "no reader recognizes", and prescribed promoting it to
  an explicit field on `ActionDef`. That prescription is the one shape the
  2026-08-22 maintainer ruling forbids for this key, so acting on the diagnostic
  walked an author into a rejected design. A false warning on the product's own
  privileged path — the branch that finalises an approval over approvers who have
  not acted — is how a dev console gets muted.
  
  Adds an exported `HOST_DISPATCH_ACTION_KEYS` (sole member `overrideNotice`) to
  `actions/actionKeys.ts` and unions it into `KNOWN_ACTION_KEYS`, which is the
  fourth input to that set and the first one that is not an authored-surface
  mirror. Measured before and after on the exact dispatch the bar composes: the
  warning went from one call naming `overrideNotice` to none, `KNOWN_ACTION_KEYS`
  grew by exactly one member, and an action carrying a real typo alongside it
  still warns — naming `targt` only.
  
  The authored surface does not move. `overrideNotice` is still NOT declared on
  `ActionDef` and still NOT in `ACTION_DEF_KEYS`; writing it in an action literal
  remains a compile error, and the AST-derived pin over the interface is unchanged.
  Membership in `KNOWN_ACTION_KEYS` widens what the WARNING tolerates, never what
  an author may write — `actionKeys.pin.test.ts` now pins both halves, including
  the new list's exact contents so a second member cannot arrive quietly.
- cef27e2: The value-fallback label prettifier `humanizeLabel` has one implementation instead of two byte-identical copies.
  
  `humanizeLabel` turns a stored value into a display string when nothing else
  resolves it — an option with no declared label, an object name, a chart axis
  member. It existed twice, byte for byte: once in `@object-ui/fields` (read by
  `plugin-grid`, `plugin-gantt`, `plugin-detail` and by that package's own
  renderers) and once as a deliberate local copy in `plugin-charts`'
  `ObjectChart.tsx`, whose comment said it was there "to avoid a dependency on
  `@object-ui/fields`".
  
  Two copies of one convention is a live hazard rather than tidiness: one
  dashboard can hold a chart and a grid over the same stored value, so a change
  landing on one copy alone would put that value on screen under two spellings at
  once. The single implementation now lives in `@object-ui/core` — the shared
  ancestor both packages already depend on, so the dependency the copy existed to
  avoid is still avoided and no new edge is created, and core takes no React
  (objectui#4389: core-canonical logic, plugins consume). Both former sites
  re-export it, so `import { humanizeLabel } from '@object-ui/fields'` keeps
  working unchanged.
  
  **Nothing rendered changes.** The surviving implementation is byte-identical to
  both deleted copies, and each former call site is pinned by identity against the
  core function — not by a copied output table that someone would have to remember
  to edit in two places.
  
  The core module also writes down, for the first time, why this convention stays
  distinct from `humanizeFieldKey` (the KEY fallback, in `@object-ui/plugin-dashboard`),
  which additionally splits camelCase:
  
  ```
  input                humanizeFieldKey     humanizeLabel
  needs_analysis       Needs Analysis       Needs Analysis
  NeedsAnalysis        Needs Analysis       NeedsAnalysis        <- differ
  unitPrice            Unit Price           UnitPrice            <- differ
  BestCase             Best Case            BestCase             <- differ
  lost-to-competitor   Lost-To-Competitor   Lost To Competitor   <- differ
  ```
  
  A field KEY is authored in the codebase and carries a machine spelling, so
  splitting camelCase recovers words its author meant. A stored VALUE is arbitrary
  tenant data, where a mid-token capital is not reliably a word boundary and
  splitting it rewrites what the tenant wrote (`McDonald` to `Mc Donald`). The two
  conventions also do not nest — on the last row each leaves alone the separator
  the other rewrites. Whether they should ever converge is a separate decision
  that would move rendered output in four packages at once; it is deliberately not
  made here.
- 50798f3: The TRUE-identity fold now counts only the keys the loop PROCESSED, so a filter
  that mixes an identity group with a skipped key folds too (objectui#9030).
  
  `convertFiltersToAST` folds a filter that is nothing but TRUE-identity
  combinators to `undefined` (objectui#8770), and folds a filter whose every key
  the loop SKIPPED for a `null` / `undefined` value to `undefined` too
  (objectui#9020). Each fold compared its own count with
  `Object.keys(filter).length`.
  
  But the loop's first statement skips the null/undefined keys without
  incrementing anything the identity fold counts, while that denominator counted
  them anyway. So a filter carrying one identity group beside one skipped key read
  `1 === 2`, the fold declined, and the caller's original object came back — even
  though each of its keys, taken alone, folds:
  
  ```
  { $and: [] }                ->  undefined         folded
  { b: undefined }            ->  undefined         folded
  { $and: [], b: undefined }  ->  { $and: [], … }   did NOT fold
  ```
  
  Behaviour decided by a sibling, read the other way round: adding an always-TRUE
  `$and: []` to a filter that folded could stop it folding.
  
  What that cost, measured on both `find()` routes of `@object-ui/data-objectstack`
  rather than assumed. The plain route hands a non-AST object to
  `client.data.find`, whose else-branch spreads its entries as query parameters, so
  `{ $and: [], b: undefined }` left as `?$and=` with no `filter` parameter at all —
  the `400 UNSUPPORTED_QUERY_PARAM` objectui#8770 exists to end. The
  `$expand` / `$search` route JSON-serialises the same object into `filter=`, where
  `{ $and: [], a: null }` arrived carrying a real `a IS NULL` predicate the
  converter had already decided contributes nothing. One authored filter, two row
  sets, and neither matched the converter's own answer for either key alone.
  
  The denominator is now the count of keys the loop actually processed — every key
  minus the ones its own first statement skipped. Both skipped spellings come
  along, because the loop skips them with one statement and objectui#9020 already
  ruled what that skip means when it is all that is left.
  
  **Unchanged, and pinned as controls in the same run:** the null/undefined skip
  itself (`{ a: null, s: 1 }` still lowers to `['s', '=', 1]`); the FALSE identity
  `{ $or: [] }`, which still selects no row; an identity group beside a key that
  does lower (`{ $and: [], a: 'x' }` still lowers to `['a', '=', 'x']`); a plain
  filter's AST; and the object tail, which still serves `{}`, an empty operator map
  `{ a: {} }`, and an empty operator map beside a skipped key — a key the loop
  ENTERED and that produced no condition is neither an identity group nor a skipped
  key, so no arm claims it. The two counts stay apart; only one denominator moved.
  
  This supersedes one sentence in objectui#9020's own entry above, which named
  `{ $and: [], a: null }` as still returning the object and objectui#9030 as the
  open question about it.
  
  ⚠️ **Dated note, 2026-09-27 — an empty operator map no longer reaches the object tail — objectui#10788.**
  Later in this same release an empty operator map is refused with a
  `FilterOperatorError` naming the field instead of reaching the object tail: all
  a filter says or beside a skipped key since objectui#9164, and beside a key that
  lowers since objectui#10788. So the object tail now serves `{}` only, and "an
  empty operator map `{ a: {} }`, and an empty operator map beside a skipped key"
  above is this change's reading, not the release's. The rest of this entry is
  kept as the reading of this change; the objectui#9164 and objectui#10788 entries
  state what those inputs now answer.
- 42df928: A dataset measure over a `datetime` field now honours `measure.format`, like one over a `date` field already did (objectui#8352).
  
  `formatMeasureDate` routes a date-shaped measure value down one of two arms. The
  date arm threaded `format` into `formatDate`'s style parameter; the datetime arm
  called `formatDateTime(v, { locale })` and dropped `format` on the floor. That was
  structural rather than a threading slip — `formatDateTime(value, options?)` has no
  style parameter — so `format: 'relative'` on a `Field.datetime` measure could not be
  honoured even in principle, and rendered the absolute face with no error, no warning
  and no fallback. Measured on a real browser boot against the showcase app in both
  `zh-CN` and `en-US`: `min(created_at)` five days old read `2026年9月1日 00:00` with
  and without `format: 'relative'`, while `min(due_date)` — a `date` field, same page
  load, same tile — moved from `9月8日` to `后天`.
  
  The datetime arm now selects a formatter instead of threading one, so both arms
  honour the same two words and nothing else:
  
  - `'relative'` resolves through `formatRelativeDate`, the same function the date arm
    reaches, so the same calendar day reads the same phrase for either field type. The
    ±7-day window and its fallback belong to that function and are inherited here, not
    re-decided at the call site. ⚠️ **Beyond ±7 days both arms render an absolute face,
    and on the datetime arm that face changed:** it is now the DATE face (`Oct 19`)
    where before this fix it was the DATETIME face (`Oct 19, 2026, 09:30 AM`) — the
    time of day is gone. `formatRelativeDate`'s out-of-window branch calls
    `formatDate(date, undefined, …)`, which renders through `toLocaleDateString` and
    has no time component to add. That is the intended shape rather than a rough edge:
    `'relative'` is day-granular by construction — it shows no time inside the window
    either — so its degraded form is a day face on both arms, and any other fallback
    would make the two arms unequal again, which is the defect this release fixes. Note
    what the delta is and is not: before this fix the datetime arm ignored `format`
    outright, so nothing was taken away from a working feature — the arm started
    honouring a request whose granularity is days. It reaches only a measure whose
    author actually wrote `format: 'relative'`; an unstyled datetime measure, or one
    asking for any other style, renders exactly as it did.
  - `'short'` resolves to the dense narrow-card face of the value's own type —
    `formatDateTime`'s `'compact'` for a datetime, which keeps the time of day and is
    byte-identical to what every `datetime` grid cell already paints.
  - every other string, `'compact'` and date patterns such as `'YYYY-MM-DD'` included,
    falls to that arm's default face, exactly as before.
  
  No published signature moved. Threading `format` into `formatDateTime`'s
  `options.style` key would have honoured `'compact'` — the one word the date arm does
  *not* honour — while still ignoring both words it does, so the call site maps the
  vocabulary explicitly and a test pins that it does.
  
  The docblocks on `formatMeasure` and `formatMeasureDate` are now qualified per arm.
  The previous wording ("`format: 'short'` and `format: 'relative'` are honoured") was
  true of the date arm and read as though it covered both; a triage pass took it as
  evidence the defect was already fixed and downgraded the card, which a driven browser
  run then refuted. The arms agree now, but the undifferentiated sentence is not coming
  back — it is what hid the disagreement.
- af3861f: `normalizeListViewSchema` now folds the four per-view-type config aliases phase 3
  carried over — `kanban.groupField` → `groupByField`, `kanban.cardFields` →
  `columns`, `gallery.imageField` → `coverField`, `timeline.dateField` →
  `startDateField` (objectui#2890).
  
  These are the pre-#2231 objectui spellings, kept declared alongside the spec keys
  so stored view metadata would keep validating. They now fold at the same
  component boundary as the A1–A5 vocabulary folds, in the same one-directional
  shape: the canonical key wins when a config carries both, and the legacy key is
  removed from the result so a missed read-site fails loudly instead of quietly
  taking the legacy path.
  
  One rendering behaviour changes, and it is a correction of the same inverted
  precedence the `densityMode` fold fixed: `ListView`'s kanban adapter resolves the
  card field list as `cardFields || columns` — legacy over canonical — so a kanban
  config carrying **both** rendered the legacy `cardFields` value and silently
  ignored the spec-canonical `columns`. After the fold the authored `columns` is
  what reaches it. Configs carrying only one of the two are unaffected, and every
  other reader of these four keys was already canonical-first.
  
  `calendar.defaultView` is deliberately **not** folded: it aliases nothing and has
  no spec counterpart, so it wants promotion upstream rather than a rename.
- 1f4e029: docs(parent-scope): state the driver's real arity rule, and the arity-dependent parent scope in the shipped README (objectui#8937)
  
  Two published texts that objectui#8886 left behind, both measured false on `origin/main`:
  
  - **`packages/plugin-detail/README.md` (it is in `files[]`, so it ships).** It said the
    node's `filter` is AND-combined with `{ [relationshipField]: parentId }`, full stop.
    Since objectui#7299 the parent condition is compiled to match the relationship field's
    arity, so a multi-valued relationship gets
    `{ [relationshipField]: { $contains: parentId } }` instead. The paragraph now states
    both spellings and names the arbiter (`@objectstack/spec/data`'s `isMultiValueField`).
  - **The claim that the SQL driver decides arity on that same predicate.** It does not:
    `driver-sql` gates the equality family on its own storage question, which reads
    `multiple` as truthy on ANY type. The two rules therefore disagree for a type outside
    `MULTI_CAPABLE_TYPES` carrying `multiple: true`. objectui#9184 moved the arity compiler
    into `@object-ui/core`'s `parent-scope` seam and carried the claim with it, so the
    correction is recorded there — the seam now states the driver's measured rule, records
    the divergence as a divergence, and points at the upstream card that owns which of the
    two rules is right (objectstack#17469). `RelatedList.tsx`'s pointer comment and the
    objectui#7299 test header carried the same sentence and are corrected to match.
  
  No predicate moved and no wire changed — this release carries corrected published text
  only. All three claims are pinned by re-derivation rather than transcription, in
  `relatedListParentScopeResidue-8937.test.ts`.
- c00bf28: `getRecordDisplayName`: stop consulting the undeclared object-level
  `titleField`, restoring `nameField` as the top of the object ladder
  
  Step 0 of the unified record-title resolver read
  `options?.titleField ?? objectDef?.titleField`. The second leg ranked an
  object-level `titleField` above `nameField` — the pointer ADR-0079 Phase 2 made
  canonical — and above the deprecated `displayNameField` alias and the legacy
  `titleFormat` template.
  
  `@objectstack/spec`'s object schema does not declare that key, and it is not
  merely undeclared: the schema is a `strictObject`, so
  `ObjectSchema.safeParse({ …, titleField: 'x' })` fails with `unrecognized_keys`
  — the same code a nonsense key gets — while `nameField`, `displayNameField` and
  `titleFormat` all parse and survive. A producer census across both repos found
  nothing that puts the key on an object-shaped payload: not the metadata, not any
  `getObjectSchema` implementation (the ObjectStack adapter stamps only reference
  keys and field-widget hints), not the lookup-chip path, not the
  search-candidate path, and not the platform's own server-side resolver
  (`@objectstack/objectql#titleFieldOf` reads `nameField` → `displayNameField`).
  Reading a key no producer can ship is a consumer-side alias — the shape
  Commandment #0.1 bans — and it inverted the governed-authority default on top of
  that.
  
  No authoring surface changes and no view loses its author-chosen title field:
  `titleField` remains a real, declared VIEW key (`ui/CalendarConfig`,
  `ui/GalleryConfig`, `ui/GanttConfig`, `ui/ListMapConfig`,
  `ui/ObjectKanbanProps`, `ui/TimelineConfig`), views hand it in as
  `options.titleField`, and that half of step 0 still wins over everything.
  The behaviour change is confined to an object payload that carried a key the
  contract rejects: it now resolves through the declared ladder instead.
- f2158ec: `ExpressionEvaluator.registerFunction` now documents the case-fold it has always
  performed: the name is stored — and must be called — in UPPER CASE
  (objectui#5363).
  
  `registerFunction('formatCurrency', fn)` registers `FORMATCURRENCY`, because the
  method delegates to `FormulaFunctions.register`, which stores under
  `name.toUpperCase()`. That fold is correct for the spreadsheet-style built-in
  vocabulary (`SUM`, `IF`, `UPPER`) and is unchanged here — but nothing declared
  it on the public method, and two things keep it from being self-evident at the
  call site. The registry API stays case-insensitive, so `getFormulas().has()` and
  `.get()` both answer to the original spelling and never reveal the fold; only
  expressions see the stored key, because the evaluation scope is built from
  `FormulaFunctions.toObject()`, a plain object whose identifiers are matched
  case-sensitively. And a wrong-case call site does not raise: `evaluate()`
  catches, warns, and returns `defaultValue ?? expression`, so the template
  renders its own `${...}` source as literal text on screen rather than erroring.
  
  Behavior is untouched — this is the declaration catching up with what the code
  enforces. It ships as a patch rather than as an empty changeset because the
  JSDoc is emitted into the published `dist/evaluator/ExpressionEvaluator.d.ts`,
  so it is what consumers see on hover.
  
  `ExpressionEvaluator.test.ts` gains three cases pinning the half that was
  uncovered — that the given spelling does *not* resolve in an expression, that
  the failure renders the raw template source instead of throwing, and that the
  registry API stays case-insensitive underneath — so making registration
  case-preserving fails a test instead of silently invalidating the new JSDoc.
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
- ed71d9e: Withdraw the entry-surface justification on core's `SchemaNode` re-export, and put
  the gauge that can actually fail in its place (objectui#5673).
  
  `packages/core/src/types/index.ts` carried, as the justification for the #4580
  re-export convergence, *core's own entry surface is unchanged (`dist/index.d.ts` is
  byte-identical across the change — measured, both rounds)*. The reading was real and
  it certified nothing. `core/dist/index.d.ts` is emitted from a barrel that only
  FORWARDS the symbol, and forwarding never restates a shape — not `export *`, and not
  the `export type { … }` line that names this one. Only the module that DECLARES the
  symbol can move, so that file is byte-identical under any change to a re-exported
  declaration's shape, and it could not have failed for the change class it was quoted
  against.
  
  Measured for this change rather than argued. One optional key was injected into
  `BaseSchema` — the shape `SchemaNode` publishes — both packages were rebuilt from a
  cleared `dist/` and a cleared `tsconfig.tsbuildinfo`, then the probe was dropped and
  both rebuilt again:
  
  | emitted file | base | with probe | probe dropped |
  |---|---|---|---|
  | `@object-ui/types` `dist/base.d.ts` — declares the shape | `31b5a01d…` | `8487500e…` **moved** | `31b5a01d…` |
  | `@object-ui/core` `dist/types/index.d.ts` — forwards it | `0e64c8c6…` | `0e64c8c6…` | `0e64c8c6…` |
  | `@object-ui/core` `dist/index.d.ts` — entry barrel, names it | `5cca207a…` | `5cca207a…` | `5cca207a…` |
  
  The corrected block states that calibration as a recipe with its failure mode, so the
  next reader inherits a gauge that can be checked instead of a sentence that cannot.
  The `ComponentRendererProps` block below it already reached the right verdict, but
  gave a narrower reason for it — that core's entry is an `export *` barrel — which is
  not the mechanism, and is wrong for a symbol the barrel names on its
  `export type { … }` line; it now states the forwarding rule.
  
  Documentation only, in a published declaration file: these docblocks sit on export
  specifiers, so `core/dist/types/index.d.ts` carries them into the tarball, while
  `core/dist/index.d.ts` does not move for them either — the same insensitivity,
  demonstrated once more on this very change. No type moves and no runtime behaviour
  changes.
- 7776fc2: fix(core): `ValueDataSource` applies the filters it is given instead of returning every row
  
  `matchesASTFilter` recognised only two node shapes — a logical `and` / `or` head
  and a three-element comparison — and answered `true` for everything else. Three
  consequences, all silent: a legacy flat implicit-AND array (`[[…], […]]`) applied
  no filter at all, at top level and as a nested child of `and` / `or` alike; the
  null-ness operators had no arm, so `is_null` / `is_not_null` selected every row;
  and 16 of the spec's 20 canonical view operators — `equals`, `greater_than`,
  `starts_with` among them, the spellings `toFilterNode` lowers a stored view's
  rules into — fell through the same way.
  
  The matcher now canonicalises operators through the spec's own
  `canonicalAstOperator` and reads all four shapes `FilterArraySchema` declares, so
  an in-memory `provider: 'value'` list applies the same filter the wire would. An
  operator or shape it cannot execute now excludes the row and logs once per
  `find()`, rather than passing every row with no signal anywhere.
- Updated dependencies [b46c58f]
- Updated dependencies [6f96fca]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e3ea4f9]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [8c10f4f]
- Updated dependencies [90dac98]
- Updated dependencies [6096f20]
- Updated dependencies [ea02938]
- Updated dependencies [a14fb23]
- Updated dependencies [ae98f1d]
- Updated dependencies [f98eddf]
- Updated dependencies [ce6bd99]
- Updated dependencies [a5b08c9]
- Updated dependencies [9b28151]
- Updated dependencies [1a5003f]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [29b45f6]
- Updated dependencies [b956e69]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [4aebea0]
- Updated dependencies [f976774]
- Updated dependencies [25cb364]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [3b469c8]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [f6ae5e2]
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
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [42687ba]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
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
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [81f8498]
- Updated dependencies [c27b575]
- Updated dependencies [0e6e76b]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [e6bc087]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [58da8ae]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [c476be0]
- Updated dependencies [c82ff39]
- Updated dependencies [6c3da53]
- Updated dependencies [31987bd]
- Updated dependencies [3c3ce15]
- Updated dependencies [e100589]
- Updated dependencies [304f611]
- Updated dependencies [e46ee77]
- Updated dependencies [6e9c8d2]
- Updated dependencies [9547063]
- Updated dependencies [3f6efd6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [5988b6b]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [2b188fa]
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
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [f3c2bb0]
- Updated dependencies [460575f]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [fda49e5]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [90665e0]
- Updated dependencies [7e19d03]
- Updated dependencies [1e946c9]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
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
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [6f81384]
- Updated dependencies [8f1d995]
- Updated dependencies [dddb942]
- Updated dependencies [29754cf]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [c8ea8af]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [2c1c967]
- Updated dependencies [d6ceb8d]
- Updated dependencies [2acd8e1]
- Updated dependencies [adb2a86]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
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
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [1f31d3a]
- Updated dependencies [351eb31]
- Updated dependencies [20c04b2]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [e2b3826]
- Updated dependencies [2e32ed4]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [554f2b6]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [caa0cd3]
- Updated dependencies [25c7d58]
- Updated dependencies [c6198c2]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [efbd566]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [5d0876c]
- Updated dependencies [544ecba]
- Updated dependencies [bc640ec]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [2af1fa7]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [dcbf0b2]
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
- Updated dependencies [335abea]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [af9e957]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [4eaa835]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [3a43a15]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [512c84b]
- Updated dependencies [d4733f2]
- Updated dependencies [8b532cb]
- Updated dependencies [c42554e]
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [f1190b0]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [8693b85]
- Updated dependencies [58b7b3d]
- Updated dependencies [681d3f1]
- Updated dependencies [f3bc481]
- Updated dependencies [93fc0e7]
- Updated dependencies [a4b723f]
- Updated dependencies [2b10ca0]
- Updated dependencies [7db4a81]
- Updated dependencies [526fc11]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [30443fb]
- Updated dependencies [96919a4]
- Updated dependencies [2e471dc]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [7cbc724]
- Updated dependencies [fb91ac9]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [ac716ff]
- Updated dependencies [f0f3cd5]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [1779e8d]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [a8198de]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [af4fb29]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [2fcefb9]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [100547e]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [0e05aac]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [8b446f5]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [3e01cb5]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [fb336df]
- Updated dependencies [0fce2ef]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [a691c0b]
- Updated dependencies [515f171]
- Updated dependencies [258d264]
- Updated dependencies [93127bd]
- Updated dependencies [51f3d8d]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [ca39427]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [968dc1e]
- Updated dependencies [3c73d99]
- Updated dependencies [1170ed1]
- Updated dependencies [4d73b07]
  - @object-ui/types@17.7.0

## 17.6.0

### Minor Changes

- 279fb13: `ComponentInput.type` can declare a UNION, so a block stops warning about legal
  writes its own description recommends
  
  A registration's `type` was one coarse control kind, while a good number of spec
  keys accept more than one shape. A declaration therefore had to pick an arm, and
  the repo's own manifest gate then reported `type-mismatch` on the other arm's
  legal values. Four of the five measured cases were the loud shape: the input's
  `description` teaches the author to write an inline translation map
  (`{ en, "zh-CN", … }`) while the same input's `type: 'string'` made
  `sdui-parser`'s `checkType` warn about exactly that map — one platform authority
  contradicting itself on the write it had just recommended. Because these land at
  warning severity the page still compiled and rendered; the cost is that noise on
  correct authoring trains authors, AI authors included, to dismiss the
  `unknown-prop` and `type-mismatch` reports that are real.
  
  `type` now accepts an ARRAY of coarse kinds as well as a single one (maintainer
  ruling on objectui#3832, direction (a)), and a value passes the coarse check when
  ANY declared arm accepts it. Both declaration sites in `@object-ui/types` move
  together with the registry's own copy in `@object-ui/core`, and
  `ComponentInputSchema` enforces the same widening — a non-empty array of
  DISTINCT kinds, so an empty arm list or a repeated arm is refused at authoring
  time rather than normalized behind the author's back.
  
  Five declarations now spell their real contract, and the `type-mismatch` warning
  on each of these legal writes is gone:
  
  - `page:header.title`, `page:header.subtitle`, `page:card.title` —
    string **or** inline translation map (the spec's union, measured against
    `ComponentPropsMap` at the pinned rc.6; the renderers resolve both through
    `pickLocalized`);
  - `record:alert.title`, `record:alert.body` — the same two shapes, justified
    against the RENDERER since the pinned spec carries no `record:alert` props
    schema;
  - `element:text_input.defaultValue` — `string | number`, the spec's union,
    which had been narrowed to `'string'` with the number arm named only in prose.
  
  **Backward compatible, and measured as such.** The single-kind form stays valid
  and is still the canonical spelling for a one-arm key: it validates identically
  (the diagnostics for one arm, `invalid-enum` and its `error` severity included,
  are byte-identical), and `manifestFromConfigs` collapses a one-element array back
  to the bare string, so every entry already in a published `sdui.manifest.json`
  serializes unchanged and arrays appear only where a union was really declared.
  The JSX authoring surface follows in the same step — `generateDts` emits a
  TypeScript union for a union input, so the `.d.ts` an author type-checks against
  accepts exactly what the gate accepts.
  
  A union widens what is legal; it does not switch the check off. A value matching
  NO declared arm is still reported, a multi-arm mismatch reports at its strictest
  arm's severity (`error` when an `enum` arm is present, so an enum's closed list
  does not become dismissible by having a second arm added next to it), and arms
  are meant to match the contract rather than relax the gate:
  `element:text_input.defaultValue` deliberately gains no `object` arm because the
  spec rejects a map there, and `element:record_picker.emptyText` keeps its single
  `'string'` arm because that renderer drops the map form (objectui#4163) — an arm
  the renderer never honours would advertise a shape that cannot reach the screen.
- e1d4251: Action param `visible`: one dialect answer, and a fault that is fail-open and LOUD
  
  `ActionParamDialog`'s `filterVisibleParams` was the last predicate face never
  converted to the canonical entry. It evaluated each param's `visible` on a bare
  `ExpressionEvaluator` inside `try { … } catch { return true }`, and that produced
  two defects at once (objectui#4640, measured on `main`):
  
  - **Silence.** Three of the four fault shapes emitted nothing at all — an
    unparseable source, an unbound identifier and a faulting legacy predicate all
    resolved without a word, so a broken `visible` was indistinguishable from an
    absent one. The standing 2026-08-06 ruling on objectui#4051 /
    objectstack#5149 names silence as the one option that is not available.
  - **The fail DIRECTION was decided by the predicate's dialect, not by the
    surface.** A bare string ran the legacy JS evaluator (lenient → falsy → param
    silently DROPPED); a `{ dialect, source }` envelope ran CEL (fault → param
    silently KEPT). One `visible` key, two opposite outcomes, chosen by whether
    the authored text happened to contain `${…}` / `===` — the objectui#3314
    shape. Both halves hurt: a dropped param means the dialog never collects a
    value the server requires and the action fails at submit with nothing pointing
    at the predicate; a kept one offers a field the backend rejects.
  
  `filterVisibleParams` now routes through `evalRowPredicate`. A param whose
  `visible` cannot be evaluated is **shown**, and reported once, with the action
  and the param named and the predicate quoted. Fail-open is the ruled direction
  for this surface: an extra offered field is rejected by the server with a
  message, while a silently hidden required param is undiagnosable. (Row surfaces
  keep failing closed — there the harm runs the other way.) Boolean and blank
  predicates are answered before the evaluator, so `visible: false` hides the
  param and an empty predicate is not reported as broken.
  
  **Behaviour change worth knowing before you upgrade.** On the canonical CEL
  engine an ABSENT key is a runtime fault, not a falsy read. A param gated on
  `features.phoneNumber == true` in a deployment whose scope carries no
  `phoneNumber` key at all now takes the fail-open branch: the param is SHOWN,
  with a warning naming it, where it used to be hidden. The conservative outcome
  is still available, in the spelling that is portable to the server's own engine:
  
  ```
  has(features.phoneNumber) && features.phoneNumber == true
  ```
  
  Deployments that DECLARE the flag (`features: { phoneNumber: false }`) are
  unaffected — that is a genuine verdict on both engines, and it did not move.
  
  `@object-ui/core` gains the two evaluator changes this needed:
  
  - `evalRowPredicate` accepts **`rowless`** — "this surface has no row of its
    own", so nothing is bound over the host scope and a `record` / `data` the
    scope carries survives instead of being shadowed by an empty row. Row surfaces
    are untouched: without the option the row is still the subject (objectui#3796).
  - A faulting **`{ dialect, source }` envelope now reports its own source**.
    It used to print the literal `"(expression)"`, and because the warn-once key
    is (label, predicate), the first faulting envelope under a label silenced
    every other one. The envelope is what `@objectstack/spec` normalizes every
    authored predicate into, so this was the likeliest shape in served metadata
    and the least diagnosable one.
- 167ec42: `ComponentMeta.labelling` grows a third value: `'control' | 'group' | 'display'`
  (objectui#4857, ruled jointly with objectui#4871 as the single repo-wide vocabulary for
  "how does a host learn what a widget will render"). `'display'` declares a widget whose
  whole surface is a pure display in EVERY state — no focusable control, nothing a
  `<label for>` could ever reach.
  
  The form renderer answers the declaration with the objectui#4788 host container (field
  id + `aria-labelledby` + `aria-describedby` + `role="group"`) in the editable state too;
  the `readonly === true` arm keeps its exact #4788 semantics for undeclared widgets. The
  display-only four (`formula` / `summary` / `auto_number` / `vector`) declare `'display'`
  — on the real object-form path they arrive `disabled`, never `readonly` (a deliberate
  distinction this change does not touch), so their visible labels pointed `for` at an id
  no element carried and their help text had zero consumers in every editable form.
  
  `grid` was re-measured before being classified: its only bare-config focusable is the
  auxiliary "Add line" button (routing `for` there would have label clicks insert rows),
  and every realistic config is a table of per-cell inputs — a composite. It declares
  `labelling: 'group'` and its root container now consumes the host id, name and
  description, exactly like `address` / `checkboxes`.
  
  Companion registry gate: `FIELD_WIDGET_LABELLING` (exported) is a `Record` keyed by the
  field-widget map's own literal key union, so registering a widget without deciding its
  labelling is a compile error rather than a silent fall-through to the dangling-`for`
  path, and the declaration test asserts the registered meta agrees with it key by key.
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
- af025ee: Draw a null second-dimension group instead of carrying its measure invisibly
  
  objectui#4673. `buildChartSeries`' pivot branch kept the pre-objectui#4466
  answer on the SECOND dimension: it bucketed groups by `String(row[groupKey] ??
  '')` behind a `gId !== ''` gate, so a group whose second dimension is `null`,
  `undefined` or `''` never joined the series list — while the line below the
  gate still wrote its measure into the emitted row under the `''` key. The
  number was in the data and bound to no mark, which is #4466's harm verbatim one
  dimension over: the chart understated its own data without saying so.
  
  Measured on the card's repro — `GROUP BY status, priority` over a Backlog with
  5 hours at High priority and 40 hours at no priority — the transform emitted
  `{status: 'Backlog', High: 5, '': 40}` with a single `High` series, and the
  renderer drew exactly ONE bar. The 40 hours were present in the row, scaled for
  on the y-axis, and painted on nothing.
  
  Two such groups were worse than unbound: `null` and `''` both key `''`, so the
  later group silently overwrote the earlier one's measure and one of the two
  numbers did not survive the transform at all.
  
  **A known-empty group now draws; an unprojected key still refuses.** That split
  is the doctrine the first dimension already used (objectui#4466 versus
  `hasNoCategoryKey`, framework#4033), and it now answers the same way on both
  dimensions. Concretely, a row that does not carry the group key at all gets no
  bucket and contributes no column, where it previously wrote its measure under
  `''`.
  
  `null` and `''` are two different groups with two series, following
  objectui#4508's ruling on the first dimension.
  
  **The series key is collision-safe, not merely unlikely to collide.** Unlike an
  axis bucket's private map key, a series key is a column of the emitted row and
  the `dataKey` a renderer binds to, so it has to be unique within that row. A
  group keys its column by its own display label — leaving an ordinary pivot's
  rows, series, legend, tooltip and drill title exactly as they were — unless
  that label cannot name it: shared with another group (a stored value spelling
  the null bucket's label), reserved by the row itself (the x-axis column, the
  identity carrier), or equal to some group's identity. Those key by identity
  instead, which no other group has. Because no surviving label is any group's
  identity, the two key spaces cannot meet.
  
  Drill-through follows the same assignment: a clicked series key resolves back
  to the group IDENTITY it names, and rows are matched on that. The previous
  `String(r[gDim] ?? '')` comparison was the display-string matching
  objectui#4508 removed on the x-axis — it spelled a null group and an
  empty-string group alike, so the empty-string group's segment resolved to the
  null group's records rather than its own.
  
  No renderer change was needed: the null group's series carries the same
  `nullCategoryLabel` the renderers already pass for the first dimension.
- 9ce096f: Give a chart bucket an identity distinct from its display label
  
  objectui#4508. `buildChartSeries` used the bucket's DISPLAY string as the
  bucket's own key, so two pairs of genuinely different groups were conflated —
  and the segment click that drills a bar back to its records inherited both
  conflations. The maintainer ruling (2026-08-14) approved the sentinel-identity
  direction, aligning the chart branch with the distinct-bucket-id form the pivot
  TABLE (`buildPivot`) already uses over the same dataset rows.
  
  Two collisions, one cause:
  
  - **A null group and an empty-string group drew ONE bar.** The pivot branch
    keyed buckets by `String(xRaw ?? '')`, which spells `null` and `''`
    identically. The bar took its label from whichever row created the bucket, and
    the other group's segment then resolved to no row at all — a visible bar whose
    click did nothing.
  - **A record whose stored value spells the bucket label stole the null bucket's
    drill.** A row storing the literal text `(None)` (or any localized
    `chart.nullCategory` — `(未指定)` and the other nine packs) kept its own
    bucket, so two bars carried the same axis text and BOTH resolved to the first.
    That one is a wrong drill, not a dead one: clicking the null bucket's bar
    opened the drawer on another group's records.
  
  What changed:
  
  - **`chartBucketId`** (`@object-ui/core`) is the bucket identity — the SAME
    encoder `buildPivot` keys its buckets with (`pivotBucketId` over
    `pivotDimensionValue`), so the two surfaces stop answering one question two
    ways. The pivot branch now buckets by it, which is what makes null and `''`
    two groups again.
  - **`CHART_BUCKET_ID_KEY`** carries that identity on an emitted row, written
    exactly where two DISTINCT buckets paint the same axis text — the complete set
    of cases where the display string cannot name what was clicked. An ordinary
    chart's rows are returned untouched (by identity), so no renderer-internal key
    reaches an authoring surface.
  - **`findChartSeriesRow`** takes that identity back as `options.bucketId` and
    treats it as authoritative. The renderers forward it: the drill event gains
    `categoryId` (`ChartSegmentClickEvent`, now declared once in
    `@object-ui/core` instead of inline in three packages), `AdvancedChartImpl`
    reads it off the clicked row on the cartesian, pie and funnel paths, and
    `DatasetWidget.handleChartDrill` hands it to the lookup.
  
  Behaviour change worth noting: an empty-string category no longer resolves to a
  null-valued row. That tolerance was justified as the drill layer's own spelling
  of "no group value", but no producer of this lookup's `category` writes it,
  while `''` IS the axis text a genuine empty-string group paints — so the
  tolerance was giving that group's bar a different group's records. A host that
  forwards no `categoryId` keeps its existing drill unchanged.
- e05db88: A clicked cartesian mark names its own series, and the drill title reads its label
  
  objectui#4672, objectui#4682.
  
  **The dead pivoted drill.** objectui#4680 fixed what a cartesian click could
  read out of recharts 3's `MouseHandlerDataParam`, and measured the wall it could
  not get past: a chart-level click is an AXIS interaction, and recharts
  dispatches those with `activeDataKey` hard-coded `undefined`, because the shared
  cursor spans every series at that tick. A pivoted dataset chart — 2 dimensions,
  1 measure, the shape ADR-0021 introduced — needs the series to resolve its drill
  row, so every segment of every such dashboard chart stayed a dead click. The
  series was left unresolved rather than guessed, and the card carried the rest.
  
  The answer is the mark itself. This renderer draws the `Bar` / `Line` / `Area`,
  so an item-level `onClick` closes over the very `dataKey` it was rendered with —
  the series is statically known, not inferred from tooltip state.
  
  Both handlers fire for one gesture (measured: item first, chart second, sharing
  one `nativeEvent` object), so the item handler does not emit. It RECORDS its
  series, stamped with that gesture, and the chart-level handler composes the one
  event. That is the double-fire answer and the additive property together:
  
  - **one click, one drill event**, because there is one emit site — not a second
    event suppressed after the fact;
  - **a click that lands on no mark is untouched**: it records nothing and falls
    through to the objectui#4680 axis answer exactly as shipped — category, bucket
    identity, and the series only where one series is plotted. Empty plot area
    stays category-only, and "drill the whole category" was rejected as a
    different product question. Nothing that resolved before stops resolving; a
    line's `dot={false}` stroke simply GAINS the exact series where it is hit;
  - pairing on the shared DOM event rather than on a flag means a record left by
    one gesture can never be adopted by a later click.
  
  The clicked key is forwarded exactly as rendered, `''` included: the
  empty-string second-dimension group draws its own bar since objectui#4673, and
  `''` is falsy, so a truthiness test on the way out would send no series at all
  and leave that bar's drill standing on the reader's coercion instead of on what
  was clicked.
  
  **The opaque drill title.** `ChartSegmentClickEvent` gains `seriesLabel`, and
  `DatasetWidget`'s drill drawer titles itself from `seriesLabel ?? series`.
  `ev.series` stays the LOOKUP key — `findChartSeriesRow` resolves it through the
  same assignment `buildChartSeries` made — and only the title reads the label.
  
  The two strings are equal for every ordinary group, which is why reading the key
  as a title went unnoticed. They part company when a group's label cannot name
  it: the null bucket beside a record whose stored value literally spells
  `(None)`, which is objectui#4508's collision on the series axis, reachable since
  objectui#4673. Both groups then key by `chartBucketId`, and the drawer opened on
  the right records under the title `Backlog / [null]`. An internal id where a
  label belongs reads as broken DATA rather than as a broken title.
  
  Neither string can do the other's job, which is why this is a second field
  rather than a change to the first: the label is not resolvable (it is exactly
  what the colliding groups share) and the key is not showable. `seriesLabel` is
  optional and absent wherever a renderer resolved no label, so every other
  chart's title is byte-identical.
- d2ce342: Retire the structured `confirm` object on actions (objectui#4314, maintainer ruling
  2026-08-17, ADR-0049 enforce-or-remove). `confirmText` is now the one confirm
  spelling — the only one the translation bundle can address
  (`{ns}.objects.{obj}._actions.{name}.confirmText`), matching `@objectstack/spec`'s
  action surface.
  
  Breaking semantics (flagged `minor` per this repo's version-alignment policy):
  
  - `@object-ui/types`: `ActionSchema.confirm` is a `?: never` tombstone — authoring
    it is now a tsc error, and the Zod twin rejects any authored value at parse time
    (it previously accepted the object). The backwards `@deprecated` note that
    steered authors from `confirmText` INTO the structured arm is gone.
  - `@object-ui/core`: `ActionRunner` no longer reads `confirm.message` (which used
    to outrank `confirmText`, untranslated). `ActionDef.confirm` carries the same
    `never` tombstone. The `ConfirmationHandler` signature is unchanged, but the
    runner now invokes it without the `options` argument.
  - `@object-ui/plugin-grid`: `resolveBulkActions` no longer falls back to
    `confirm.message` when promoting an object action — spec metadata can never
    deliver that key.
  
  Nothing in the repo, the example apps, or the schema catalog authored the
  structured form (verified on the issue); a dialog authored that way silently lost
  localization. Reopen condition recorded on objectui#4314: real demand returns the
  arm WITH bundle keys designed in.

### Patch Changes

- 2533ec5: The bulk-action dialog's "this widget needs a DataSource" rule now derives from the shared reference-field family instead of a fourth private copy.
  
  `packages/plugin-grid/src/components/bulkParamToField.ts` held its own
  `DATA_SOURCE_WIDGET_TYPES` — the fourth hand-maintained answer to one question
  ("which widget has to query records, so it must be handed a DataSource and a
  `reference_to`"), and the only one whose member set matched none of the other
  three: `lookup` / `master_detail` / `user`, against `@object-ui/core`'s
  `EXPANDABLE_FIELD_TYPES` (which also holds `tree`) and the object form's rule
  (which adds three widget-hint pickers). Nothing anywhere could detect the drift;
  the same shape objectui#4770 and objectui#4790 each closed on another surface.
  
  It now reads core's set through one predicate, so all three consumers of the rule
  — the label prefetch / option source (`isLookupishParam`), the `dataSource` prop
  the dialog threads into the widget (`fieldNeedsDataSource`), and the
  `reference_to` / `display_field` branch of `bulkParamToField` — cannot drift apart
  from each other or from the form again.
  
  No behaviour change on any reachable path, which is why this is a patch. The one
  member the two tables differed on, `tree`, can never be a widget key on this
  surface: it is absent from the fields widget map and `mapFieldTypeToFormType`
  sends it to `field:lookup`, so a `tree` param arrives at the rule as `lookup`
  (pinned). The divergence in the other direction is deliberately preserved: the
  form additionally wires `object-ref` / `filter-condition` / `recipient-picker`,
  widget hints no object schema can declare and no bulk param produces — absorbing
  them would change which widgets receive a DataSource here, which is a behaviour
  change and not a convergence.
  
  The pin is an identity pin, not a membership one: it spies on the `has` of the
  Set object core exports, so a member-identical private copy fails it. A
  value-equality assertion would have passed against exactly the defect this
  change removes.
- bbe8b86: The allow-list of option widgets that are fed the live record is now one exported constant, `CASCADE_OPTION_WIDGET_TYPES`, instead of three private copies.
  
  `select` / `multiselect` / `radio` / `checkboxes` are the widgets whose OFFERED
  option set is re-resolved against a record (per-option `visibleWhen`, plus the
  `dependsOn` gate), so they are the widgets a surface must thread its live record
  to. Three surfaces feed that one evaluator — the object form, the single-record
  action dialog and the bulk action dialog — and until now each carried its own
  private `new Set([...])` of the same four keys, with a comment in each asking the
  next person to change all three together. Nothing could have reported them
  drifting: every copy passed its own behavioural tests, and a divergence would
  have shown up only as one surface silently disagreeing with another about what
  "the record" is.
  
  The set now lives in `@object-ui/core`, next to `resolveCascadingOptions` — the
  evaluator that reads that record — because core is the one package all three
  surfaces already depend on, and it is re-exported from `@object-ui/fields` next
  to `resolveFormWidgetType`, whose output is the vocabulary the keys are written
  in. Both are the same object, pinned by test; each consumer keeps its own
  normalization (`normalizeFieldType` in the form, `resolveFormWidgetType` in the
  dialogs), which agree on these four members.
  
  No behaviour changes: the members are identical on all three surfaces, and the
  existing pins for each surface still assert the same records reaching the same
  widgets. The rationale that was repeated in the three copies — including the
  note that the widget-hint picker family (`filter-condition`, `recipient-picker`,
  the lookup family) reads a different sibling key off the same channel and is
  deliberately NOT in this set — is now stated once, in the constant's own
  documentation. Whether the action and bulk dialogs should ever feed those
  pickers stays an open question (objectui#4771), unchanged by this convergence.
- 8477be5: `cloneAsOverride()` now returns `DeepMutable<T>`, so a Tenant/User override draft type-checks as the mutable value it has always been.
  
  `cloneAsOverride<T>(view: T): T` handed the input type straight back. Cloning a
  `SystemView<S>` — which is `DeepReadonly<S>` plus the marker symbol — therefore
  returned something still typed deep-readonly, even though the implementation has
  always produced a plain mutable object (`structuredClone`, or a JSON round-trip
  fallback) and deliberately drops the marker. The declaration was simply wrong
  about its own value, and the documented override flow was the thing that broke:
  
  ```ts
  const draft = cloneAsOverride(userListView)
  draft.columns.push({ name: 'name' })   // TS2339 before this change
  ```
  
  That is `packages/core/README.md`'s override example, and it failed to compile
  against the built types — measured by the doc-snippet compile gate, which reads
  `dist/*.d.ts` rather than source. The neighbouring line one block up,
  `userListView.columns.push(...) // ❌ TypeError (strict mode)`, is the opposite
  demonstration and correctly still fails; only the draft line changes colour.
  
  The fix adds `DeepMutable<T>`, the inverse of the `DeepReadonly<T>` that
  `SystemView` is built from, and returns it. Per the maintainer's 2026-08-19
  ruling (option A on objectui#5257), the alternatives were rejected by name:
  teaching a cast in the README is the lenient-consumer pattern the contract rules
  out, and declaring the block a documentation fragment hides a real signature
  defect behind the fragment marker.
  
  Why this is a patch and not a break: the return type relaxes TOWARD what the
  runtime already does, never away from it. A caller gains permission to mutate;
  nobody loses one. `DeepMutable<S>` stays assignable everywhere `DeepReadonly<S>`
  or `SystemView<S>` was expected, so a caller who fed a draft back into a
  deep-readonly position still compiles — both directions are pinned as type-level
  cases in `freeze-schema.types.test.ts`. A repo-wide sweep found no call site at
  all outside the README, so nothing in this workspace needed changing.
  
  Two limits of `DeepMutable`, stated rather than discovered later. It is
  symmetric with `DeepReadonly` arm for arm, which means it inherits the same
  tuple behaviour: a tuple widens to an array, exactly as `DeepReadonly` widens it
  in the other direction. And it does not remove the `SYSTEM_VIEW_MARKER` key —
  the clone never carries the symbol at runtime, but the key is declared optional,
  so keeping it states "may be absent", which is true. Excluding it would require
  a non-homomorphic mapped type that drops the `?` modifier from every other
  property and turns optional keys required — a strictly worse type traded for
  removing a key that already reads as optional.
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
- 41f498b: Fix `packages/core/README.md`'s Component Registry example, which taught
  `new ComponentRegistry()` against an exported singleton **instance**, not a
  class — the built `packages/core/dist/registry/Registry.d.ts` declares
  `export declare const ComponentRegistry: Registry<any>`, so the snippet did
  not compile (`TS2351: This expression is not constructable`, measured by the
  objectui#5138 doc-snippet type gate). A reader who copied it got a compile
  error; if `new ComponentRegistry()` had compiled it would have produced a
  second, empty registry nothing renders from, the more expensive half of the
  mistake.
  
  The snippet now calls `ComponentRegistry.register(...)` /
  `ComponentRegistry.get(...)` directly on the singleton, with one line stating
  it is the process-level shared instance `SchemaRenderer` resolves every
  `type` against — the same wording `packages/components/README.md` was given
  in objectui#5160, kept consistent across both READMEs. Readers who want their
  own isolated registry still have `Registry` itself, separately exported as a
  real class.
  
  `scripts/check-doc-snippet-types.mjs`'s `UNGATED_DOCS` entry for
  `packages/core/README.md` is updated to match: `TS2351x1` is dropped from its
  reason text now that the diagnostic is gone. The entry is not deleted — the
  document's remaining `TS2339x2` pair (a different, pre-existing defect) is
  out of scope for this change; it's tracked as objectui#5257.
- ac600e5: A `user` field in a form now receives `dataSource` / `dependentValues` / `dependsOnLabels`, like every other reference field.
  
  The form renderer decided which registered widget gets those three props from a
  module-private `DATA_SOURCE_FIELD_TYPES` set, while `@object-ui/core` kept
  `EXPANDABLE_FIELD_TYPES` for the same underlying fact — a field whose stored
  value is a foreign key into another object. The core side's TSDoc claimed to
  mirror the form's set, and it did for 15 days: the form's copy then gained
  `capability-multiselect` (objectui#2403) and the three widget-hint pickers
  `object-ref` / `filter-condition` / `recipient-picker` (objectui#2421) on the
  same day, after which the two sets were not in a subset relation in either
  direction — `user` only in core, the picker names only in the form — with
  nothing able to report it.
  
  The form now derives its rule instead of restating it: the reference half is
  core's set, the form-specific half is the three picker names, which are widget
  hints and can never be a declarable field `type`. Adding a member to
  `EXPANDABLE_FIELD_TYPES` therefore also grants it the form's data-source wiring;
  that coupling is intended and is now written down on both sides.
  
  The user-visible half is `user`. It previously received none of the three props.
  `dataSource` and `dependentValues` each have a `SchemaRendererContext` fallback
  inside the widget, so the person picker limped along wherever a provider
  happened to supply one; `dependsOnLabels` has no fallback, so a
  dependency-gated user picker interpolated the raw API name into its
  "select ... first" hint in every locale — the leak objectstack#5407 closed for
  lookups and left open here. The widget contract's own `dataSource` doc has
  always named `user` among the types the form renderer injects for.
  
  No change to what is expanded, projected or rendered anywhere else: the core
  set's members are untouched.
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
- af5e292: Emit explicit file extensions on relative import specifiers, so the published
  entries can be imported by Node's own ESM resolver.
  
  `@object-ui/react`'s built entry re-exported through extensionless relative
  specifiers (`export * from './SchemaRenderer'`). Node does not extension-search
  relative specifiers, so `import('@object-ui/react')` under plain Node — an SSR
  host, or any consumer without a bundler — failed with `ERR_MODULE_NOT_FOUND`.
  Bundled consumers were never affected and are unchanged by this.
  
  `@object-ui/types`, `@object-ui/core` and `@object-ui/i18n` carried the same
  emission; `@object-ui/react`'s entry stayed unloadable until they were fixed
  too, because evaluation crosses into them. No exported API changed.
- 9f23d2b: The object list's Import button now honours `userActions.import`'s CEL predicates.
  
  `@objectstack/spec@17.0.0` widened BOTH toolbar-scope keys, not just `create`:
  `userActions.create` and `userActions.import` are typed identically
  (`z.union([z.boolean(), RowCrudActionOverrideSchema])`) and
  `resolveCrudAffordances` emits a predicate envelope for each, with the docblock
  binding them in one breath ("`importPredicates` — same binding as
  `createPredicates`"). objectui#4646 gave the `create` half a consumer and left
  the `import` half declared-and-inert: `importPredicates` had zero readers in
  objectui. An author could write `userActions.import.visibleWhen`, have the spec
  accept it and the resolver parse it, and watch the object-list toolbar offer the
  CSV import wizard unconditionally.
  
  The toolbar now evaluates them, mirroring the related list's create half:
  `visibleWhen` fails CLOSED (an unevaluable predicate hides the entry and warns
  once), `disabledWhen` fails SOFT (an unevaluable one leaves the button enabled),
  and the declared-ness rules are the family's — `?? true` for `visibleWhen` so
  `visibleWhen: false` hides rather than reading as "ungated", `!= null` for
  `disabledWhen` so an empty predicate reads as "no condition". The layer sits on
  TOP of the object-level verdict: a predicate can narrow what the `managedBy`
  bucket, the server's effective API operations and the principal's grant already
  allow, never re-open what they closed.
  
  Per the spec's binding, a toolbar predicate evaluates once per toolbar against
  the record of the scope the toolbar sits in — and a standalone object list has
  no record in scope. Predicates over the host scope (`os.user.*`, `features.*`)
  are the meaningful shape there; one reading `record.*` has nothing to bind and
  hides the entry, which is the fail-closed rule the spec spells out for exactly
  this surface.
  
  `UserActionsOverride.import` widens from `boolean` to the same union as
  `create`, deliberately in this same change: objectui#4646 kept it narrow on
  purpose because widening a type ahead of its consumer re-declares the
  inert-metadata defect one key over. Type and consumer travel together.
- 31676be: `buildChartSeries`' pivot branch preserves key ABSENCE, so a never-projected first dimension still reaches the framework#4033 placeholder.
  
  `hasNoCategoryKey` (plugin-charts' `AdvancedChartImpl`) exists to catch one
  shape: a dimension a dataset query GROUPED BY but never PROJECTED, so no row
  carries the category key. Rather than draw an axis with no marks, the renderer
  names the missing key. Its whole signal is `key in row`, asked of the rows it is
  handed — which for a dataset-bound chart are `buildChartSeries`' output.
  
  The pivot branch wrote `[xKey]` onto every bucket it created, so `key in row`
  was unconditionally true downstream and the guard could not fire for a
  2-dimension/1-measure chart no matter what the query returned. Every row
  collapsed into one unnamed bucket drawing a blank tick — the exact silent shape
  the placeholder was introduced to eliminate. The defence was dead precisely
  where the defect it guards against lands. The single-dimension branch was never
  affected: it passes rows through, so key-absent rows stay key-absent.
  
  An emitted bucket now carries the axis key exactly when some row of it did.
  That is `hasNoCategoryKey`'s own `rows.some(key in row)` lifted through the
  pivot's aggregation, so the guard reads the same fact before and after.
  
  The route rests on a measurement of how a dataset query actually reports an
  unprojected dimension in a 2-dimension grouping: it OMITS the key. The ObjectQL
  strategy writes a dimension key only when the engine returned that column, the
  native-SQL strategy returns driver rows carrying only the selected columns, JSON
  cannot transport `undefined`, and `ObjectStackAdapter.queryDataset` passes rows
  through by reference. An explicit `null` means the opposite — the column WAS
  projected and its value is null — and that case is untouched: it still renders
  under the `(None)` bucket label (objectui#4466 / objectui#4497). Where one
  bucket collects both (an absent value and a stored `null` share the `[null]`
  identity), the bucket keeps its label and draws, because refusing there would
  tell an author their query never projected a dimension that it did.
  
  No change to any chart whose first dimension projected: ordinary, null-valued
  and empty-string categories all emit byte-identical rows, key order included.
- 5ffcc14: fix(plugin-report): forward the chart chrome and series presentation `ReportChartSchema` declares (objectui#4877)
  
  A report's embedded chart forwarded exactly six keys to the registered chart
  component — `chartType`, `data`, `height`, `isAnimationActive`, `series`,
  `xAxisKey`. Everything else `ReportChartSchema` declares as authorable never
  left the report renderer, so it was inert metadata: the author writes it, the
  schema accepts it, nothing reads it.
  
  `showLegend` was the sharpest case because dropping it does not merely ignore
  the author, it INVERTS them: `AdvancedChartImpl` computes
  `legendVisible = showLegend !== false`, so an absent value means the legend is
  on and an explicit `showLegend: false` still drew one.
  
  Now lowered, under objectui#4229's ruled data/presentation split:
  
  - chrome — `showLegend`, `showDataLabels`, `colors` (both the positional-palette
    array and the per-category record), `subtitle`, `description`, `annotations`,
    `interaction`, `height`;
  - per-series presentation — `color`, `stack`, `type`, `yAxis`, `dashArray`,
    `opacity`, `variant`, matched by `series[].name` so series MEMBERSHIP stays
    with the dataset.
  
  `title` is deliberately not forwarded: the report renderer paints it as its own
  heading above the plot, and forwarding it would draw a second one inside the
  chart's frame. `aria` is not lowered either — nothing on this path reads it
  (`AdvancedChartImpl` has no `aria` prop, and this renderer hands the component a
  schema directly rather than through `SchemaRenderer`'s flat ARIA injection), so
  forwarding it would move declared-but-unread one layer down.
  
  The two helpers (`chartConfigPresentation`, `mergeAuthoredPresentation`) moved
  from `plugin-dashboard`'s `DatasetWidget` to `@object-ui/core` beside
  `buildChartSeries`, the derivation they merge onto, so both surfaces lower one
  vocabulary once instead of keeping a second copy (the duplication objectui#4389
  filed as a defect). `@object-ui/core` additionally exports `mergeAuthoredSeries`
  — the series merge alone — for a surface whose axes are bare dimension/measure
  NAME strings rather than spec `ChartAxis` objects, which is what a report chart
  declares. `DatasetWidget` re-exports both names, so its public surface and its
  rendering are unchanged.
- d971e51: A create form no longer deadlocks on a `requiredWhen` field that also declares a runtime `defaultValue`.
  
  `#4069` ruled that in **create** mode a field whose `defaultValue` is a runtime
  instruction the server resolves per insert (`NOW()` / `current_user`, or a CEL
  Expression envelope) is producer-owned: the control is deliberately left empty
  and the key is omitted from the payload, because `ObjectQL.applyFieldDefaults`
  resolves the declaration only for a field that arrives absent or null. That was
  implemented on the STATIC `required` flag.
  
  The conditional spelling was not covered. `requiredWhen` is resolved one layer
  downstream, in the form renderer, against the live record — so a predicate
  resolving TRUE on a create form put the requirement straight back: the control
  was still empty by design, the submit was refused, and the user had nothing
  sensible to type.
  
  Both spellings now behave identically on a producer-owned field. A
  `requiredWhen` predicate is a claim about the value at rest in a given state,
  and `NOW()` / `current_user` resolve at insert regardless of state, so the
  producer's guarantee covers the conditional claim by the same argument that
  covers the unconditional one. An author who really means "the user must supply
  this in this state" has a natural spelling for it: do not declare the default.
  
  The suppression lands in the single evaluator both layers read,
  `resolveFieldRuleState` — the same verdict that draws the required marker and
  the one the submit-time check consults — so a field can never lose its asterisk
  while still refusing the write. The classifier that answers "is this value the
  producer's to supply" moved down to `@object-ui/core`
  (`isRuntimeDefault` / `isServerOwnedValue`, re-exported from
  `@object-ui/plugin-form`) so the renderer, the wizard's cross-step gate and the
  create-form field builders all read one implementation rather than three.
  
  **Edit mode is unchanged.** Defaults do not re-apply to an existing record, so
  on a persisted row the token was already resolved at insert and blanking the
  column is a real removal: `requiredWhen` enforces there exactly as authored.
  Fields with no declared default, and fields whose default is a static literal
  (which IS seeded into the control), are also unaffected in both modes.
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
- Updated dependencies [88085e3]
- Updated dependencies [279fb13]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [af5e292]
- Updated dependencies [7f96b10]
- Updated dependencies [f1d4748]
- Updated dependencies [578e025]
- Updated dependencies [598c89a]
- Updated dependencies [b8b9af4]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [58b8346]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
  - @object-ui/types@17.6.0

## 17.5.0

### Minor Changes

- ee66e2e: Close `ActionDef` — delete the `[key: string]: any` index signature and converge `visible` / `disabled` on the spec's unified shape.

  `ActionDef` accepted any key of any type, so a typo (`targt`) and a retired spec
  key (`execute`) both type-checked and the runner then silently bound no handler
  — the objectstack#2169 "Mark Done does nothing" shape. Step 1
  (objectstack#4075) made that audible with a dev-mode warning; step 2 promoted
  the 18 spec-owned keys to real fields. This is **step 3**, executing the
  maintainer's 2026-08-06 ruling now that its upstream half shipped in
  `@objectstack/spec` 17.0.0-rc.6 (objectstack#5970).

  - **`visible` and `disabled` now have ONE shape, derived from the spec** —
    `boolean | string(CEL) | { dialect, source }`. The ruling was "统一形状,spec
    采纳": boolean is the degenerate literal verdict, the string is CEL shorthand,
    the envelope is the full form. `visible` loses its hand-written `| boolean`
    (the spec adopted that arm, so restating it locally would be a second
    contract), and `disabled` gains the envelope arm it never had — it was
    `string | boolean`, which is why the envelope the spec emits could only be
    read through a cast.
  - **The index signature is gone.** `tsc` now rejects an unknown or retired key
    at any site that authors an action literal in code.
  - **Five keys the deletion surfaced, promoted to real fields.** `to`,
    `external`, `newTab`, `replace` — the `navigation` alias's own spelling, ruled
    legitimate by step 1 and listed in `NAVIGATION_ALIAS_KEYS` ever since, but
    declared only as data; and `description`, which every action renderer forwards
    (`check:action-forward-parity` requires it) and the param-collection dialog
    reads for its subtitle (objectui#4192). These were the only two `TS2353`s the
    deletion produced across the whole workspace.
  - **`ActionContext` keeps its index signature**, deliberately. It is a runtime
    data bag whose keys are genuinely open; `ActionDef` is a declared metadata
    contract. That asymmetry is the point, and it is now pinned in both
    directions.

  **Breaking edge, deliberate — same class as step 2's, one step further.** An
  `ActionDef` literal carrying a key this interface does not declare is now a
  compile error where it previously compiled and did nothing at runtime. That
  includes the retired `execute` (rename it to `target`; `os migrate meta --from
16` rewrites it) and plain typos. Values that were only ever absorbed silently
  are the ones that stop compiling, so the failure moves to where it can be fixed
  rather than appearing as a button that does nothing.

  **What did NOT retire with the index signature**, contrary to step 1's
  expectation: the dev-mode `warnOnUnknownActionKeys` shim and `executeScript`'s
  `execute` rename prescription both stay. `tsc` only ever sees actions authored
  as TypeScript, while stored `sys_metadata` rows are rehydrated UNPARSED
  (objectstack#3903) — which is the population `execute: 'markDone'` actually
  lives in. The two mechanisms cover disjoint populations; retiring the runtime
  half would have re-opened the gap it was written for.

- 3fc2971: A null-keyed group renders as an explicit bucket instead of silently vanishing from a chart (objectui#4466)

  `buildChartSeries`' single-dimension branch passed rows through verbatim, so a row whose category VALUE is `null` reached recharts with a null category and drew no mark. The visible outcome was not an empty chart but a quietly wrong one: rows `[{user_id: null, event_count: 51}, {user_id: 'Dev Admin', event_count: 2}]` drew exactly ONE bar — the dominant group, 51 of 53 events, dropped while the y-axis scale still accommodated it, so the chart understated its own data and the axis proved the data had been there. With every group null it drew axes, gridlines and an axis title with zero marks and no empty state, which is the shipped first-boot state of the built-in System Overview board's "Events by User" (every seeded `sys_audit_log` row is written with `user_id = NULL`).

  The mapping lives in the shared series layer, so dashboard widgets and standalone `ObjectChart` get one answer rather than a per-chart patch in the recharts wrapper. It resolves the two-answers disagreement the card names as well: an empty result set keeps the designed empty state, a non-empty result always draws bars — the null bucket included.

  `@object-ui/core` gains `NULL_CATEGORY_LABEL` and `ChartSeriesOptions`; `buildChartSeries` and `findChartSeriesRow` each take an optional trailing `options`. Both additive — every existing call site compiles and behaves identically, and a result with no null category is still returned by array identity. The two helpers are a pair on purpose: the caller matches a clicked segment against rows that still carry the raw `null`, so `findChartSeriesRow` reads the bucket label back to that row and the newly-visible bar keeps its drill-through instead of resolving to `-1`.

  The label goes through the i18n channel (`chart.nullCategory`, en `(None)` / zh `(未指定)`, all ten packs), passed down by the renderer: `@object-ui/core` is React-free and cannot read the locale bundle, so it takes the resolved string the same way `dimensionOptionTranslator` takes a resolver. Its English constant is the floor for a provider-less host, not the mechanism.

  `hasNoCategoryKey` (framework#4033) is untouched and now documented against this: a row that does not carry the category key AT ALL is a different defect — a dimension grouped by but never projected — and keeps its explanatory placeholder. The bucket deliberately never ADDS the key to such a row, which is what keeps that guard's signal alive. Key absent → the placeholder; key present with a null value → the bucket.

- dde7283: `chatbot` and `chatbot-enhanced` now pass only whitelisted DOM props to their host element (objectui#4431)

  Both registrations destructured `schema` and `className` and forwarded everything else. `SchemaRenderer` hands a registered component the authored node's own keys, the contents of its `props` container, the ARIA it resolved and the host's trailing props — so all of it became attributes on the chat root `div`, because React passes unknown lowercase attributes through in silence and stringifies object values. Measured through the real SDUI path with a data-source adapter attached: **14 non-DOM attributes on each widget**, including `datasource="[object Object]"` (the injected adapter, which only appears on a deployment that really loads data) and a camelCase `arialabel` sitting next to the resolved `aria-label`, so the element carried each ARIA value twice under two spellings — one of them meaningless to assistive technology.

  Both are now consume-or-whitelist: configuration is read off `schema` as before, the evaluated `disabled` verdict is consumed by name, and only `toDomProps`' output reaches the element. The resolved `aria-label` / `aria-describedby`, `role`, `id`, `tabIndex` and the `data-*` family still arrive — dropping them would have been an accessibility regression dressed as a leak fix, so the pin asserts the delivered set exactly, not just the absent one. `chatbot-floating` is untouched: its content mounts through a portal and its root never spread.

  `@object-ui/core` gains the shared executor this migration needs (`utils/dom-props.ts`): `toDomProps` for the SDUI widget contract, plus `pickDomProps` — the mechanism — for a package whose own contract declares a different key set. That is the objectui#4409 dependency direction: plugin packages declare `@object-ui/core` and must not grow a dependency on `@object-ui/fields` to reach a whitelist.

  `@object-ui/fields` keeps its own key list and its compile-time bindings, and now executes them through core's mechanism. Its behaviour is unchanged and its exported `DomProps<P>` is the same structural type. The two lists differ for measured reasons and no longer can drift silently: `name` and `disabled` are legal only on form controls, which is what every field widget renders and what `FieldWidgetComponentProps` declares, while `role` is resolved by `SchemaRenderer` for every SDUI node and is not part of the field contract. A new assertion binds every shared key in both directions, with `role` named as the single deliberate exception.

- f279deb: fix(core): bare-string filter options — docs/examples stop teaching it, the runtime lift warns (objectui#4356)

  `globalFilters[].options` had two de-facto contracts. `@objectstack/spec`'s `GlobalFilterSchema` accepts only `{ value, label }` pairs, while `normalizeFilterOptions` also lifted a bare-string shorthand (`options: ['EMEA', 'APAC']`) — so a dashboard authored that way rendered correctly in objectui and was refused the moment it reached the platform's validation. That is the "one strict contract beats N dialects" divergence AGENTS.md #0.1 names, with the renderer's tolerance hiding the producer's bug instead of surfacing it.

  Maintainer ruling of 2026-08-12 on objectstack#7917, verbatim 「7917 ②」: **the spec stays strict; the runtime lift retires behind a deprecation window sized by a stored-dashboard survey.** This is Phases 0 and 1 of that window, shipped together. Phase 2 (removing the lift) is scheduled on objectstack#7917 and is deliberately not here.

  **Phase 1 — the lift now says so out loud.** `normalizeFilterOptions` still lifts a bare string, unchanged and mechanically lossless (`'EMEA'` becomes `{ value: 'EMEA', label: 'EMEA' }`), because stored dashboards carry the shorthand and dropping it silently would turn a rendering filter into an empty one. It now also logs a deprecation warning naming the offending filter, quoting the offending values, and printing the canonical replacement. The warning fires **once per offending filter per session** — `resolveDashboardFilterDefs` runs on every dashboard render, and a warning that floods the console is a warning that gets muted — and it is dev-mode only, matching the `warnOnDeprecatedObjectParams` convention in `actions/actionKeys.ts`. It does not fire for canonical object options, and a mixed array names only its bare members, since partial migrations happen. A silent lift can never be retired, because nothing would ever show that the last shorthand document is gone (ADR-0078).

  **Phase 0 — objectui stopped teaching the form.** The stored-dashboard survey on objectstack#7917 found the shorthand's source: objectui's own docs and its schema-catalog corpus — which the catalog's `package.json` declares an AI RAG/few-shot retrieval source — still authored it, so the stored population was still growing. All seven non-test occurrences are corrected to the pair form: `content/docs/guide/dashboard-filters.md` (a code block **and** a prose passage that presented the shorthand as an equal alternative), `content/docs/plugins/plugin-dashboard.mdx`, `packages/plugin-dashboard/README.md`, and the three `examples/schema-catalog` `filtered-dashboard*.json` entries. Warning authors while the docs still taught the form would have been a contradiction users report as a bug.

  **Guardrail.** The schema catalog previously asserted only that its entries were structurally well-formed and rendered without throwing — which is exactly how a spec-invalid example got in. Every `globalFilters[]` entry in every `plugin-dashboard` catalog example is now parsed with the real `@objectstack/spec` `GlobalFilterSchema`, with a non-vacuity control so a broken sweep cannot read as green.

  New export: `resetDashboardFilterWarnings()`, the warn-once memo reset, matching `resetActionKeyWarnings`. Graded `minor` for that additive export — measured, the emitted `.d.ts` gains exactly one declaration and narrows nothing.

- eb7f586: Dashboard dataset measures follow the display locale (objectui#4566).

  `formatMeasure` and `formatDimensionValue` in `@object-ui/core` formatted every
  value with a bare `undefined` locale tag at all three of their `Intl` sites.
  `undefined` is not "the user's locale", it is the MACHINE's — neither of the
  repo's two locale channels. A German session read a dashboard KPI as `1,234.5`
  next to a grid cell rendering the same number as `1.234,5`, and inverted
  separators read as a different number, not as an unstyled one.

  Both functions take the display locale as a new OPTIONAL LAST parameter, and
  `DatasetWidget` threads `useDisplayLocale()` into every site it formats through:
  the KPI, the grouped table's measure and dimension cells, and the cross-tab's
  header labels and cells.

  **English output does not move**, and that is the discriminator against the
  sibling fix. These sites already went through `Intl` with default grouping, so
  the only thing that changes is WHOSE locale is used:

  |                   | before      | after                 |
  | ----------------- | ----------- | --------------------- |
  | en, 1234.5 `0.0`  | `1,234.5`   | `1,234.5` (unchanged) |
  | de, 1234.5 `0.0`  | `1,234.5`   | `1.234,5`             |
  | de, 1234.5 EUR    | `€1,234.50` | `1.234,50 €`          |
  | de, 0.6083 `0.0%` | `60.8%`     | `60,8%`               |

  Contrast objectui#4553, where `formatPercent` had never grouped at all and
  moving en `1235%` → `1,235%` WAS the fix.

  Omitting the new argument reproduces the previous output byte for byte, so
  callers that do not thread a locale yet are unaffected.

  Two behaviours are deliberately preserved rather than "improved" alongside the
  locale fix, both measured:

  - **Integers stay verbatim.** The integer branch renders no separator and no
    decimal mark, so a locale has nothing to change there — and routing it through
    `Intl` WOULD change it (a locale with its own numbering system re-digits it,
    and `1e21` expands to 22 digits).
  - **The percent sign stays a literal suffix.** `Intl`'s `style: 'percent'`
    re-scales by 100, and that round trip loses precision at the top of the range
    (en `100,000,000,000,000,000,000,000%` becomes
    `99,999,999,999,999,990,000,000%`). The consequence — a German list cell
    writing `1.234,5 %` with a no-break space where a dashboard measure writes
    `1.234,5%` — is filed separately rather than smuggled in behind a locale fix.

  `@object-ui/core` is `minor` because two of its ENTRY exports gained an optional
  parameter (measured in the built `.d.ts`). `@object-ui/plugin-dashboard` is
  `patch`: its published declarations are unchanged — `buildPivot`'s new optional
  parameter is internal, as that function is not on the package's `exports`
  surface.

- e901131: `DatasetResultField` is now `@objectstack/spec`'s `AnalyticsResult.fields[]` element itself, not a hand-written restatement of it

  `packages/core/src/utils/dataset-format.ts` declared its own six-key interface for the analytics result column, under a doc comment describing the server's contract. The key set happened to match the spec today, so nothing was broken — but it was the last surviving member of the derive-don't-restate family (#3613 / #3753 on the parameter side, #3752 on the adapter return side), and it was the member with no compile-time tripwire: three surfaces (`plugin-dashboard`'s `DatasetWidget`, `plugin-report`'s `DatasetReportRenderer`, app-shell's `DatasetPreview`) consume this name AS the real column type, so the next spec column key would simply never appear here and no build would complain. It is now `AnalyticsResult['fields'][number]`, so it cannot lag the contract again.

  **Consumer-visible type tightening (the reason this is a minor, not a patch).** The restatement had relaxed `type` to optional; the contract requires it. Anything that assigned a column literal without `type` — or a bare `{ name, label?, format? }` — to `DatasetResultField` will now fail to compile, and the fix is to supply the `type` the server always sends. Nothing in this repo needed changing: every value of this type originates in `ObjectStackAdapter.queryDataset`, which already declares the spec element, and no consumer reads `.type` at all, so the widening had bought no caller anything while advertising a `string | undefined` the wire never produces. Marked `minor` per the repo's bump policy, which reserves `major` for following `@objectstack/spec` across a major.

  The exported name is unchanged and the `PercentScale` re-export from this module is untouched, so existing import paths keep working. `packages/core/tsconfig.typetests.json` (chained off the package's `type-check`) compiles the new parity test, so the pins are checked by CI rather than merely written down — including a negative pin that goes red if the hand-written interface is ever restored, and the `ChartResultField` superset relationship the module's comment claims.

- d9d3463: Retire four zero-consumer declared surfaces (dead-surface sweep batch 3, #4328). Each was
  measured as declared-but-never-read at the branch point, and each is removed rather than
  left as an authoring surface whose values nothing acts on.

  Breaking for anyone who typed against the removed declarations, marked `minor` per this
  repository's version-alignment convention (the major tracks `@objectstack`, never an
  API-break count):

  - `@object-ui/core` no longer exports `mergeViewsIntoObjects`. It was a second copy left
    behind by the move of that step to the provider layer, and it had drifted: it ignored a
    view container's default `list` and keyed views by the authored bare key instead of the
    composer's `<object>.<key>` identity. The live implementation — `MetadataProvider`'s, in
    `@object-ui/app-shell` — is unchanged and remains the only one. (#3775)
  - `@object-ui/types`' `RoleDefinition` no longer declares `permissions`. A role's grants
    live in `ObjectPermissionConfig.roles`, keyed by object; that is the only home any
    consumer reads (`resolveRoles` walks `inherits` and matches on `name`). The removed
    field was _required_, so five fixtures across three packages had been declaring an empty
    array for a value nothing would ever look at. Role-attached grants are now a compile
    error rather than silently ignored data. (#4288)
  - `@object-ui/react`'s `RecordContextValue` no longer declares `loading` / `error`. Both
    had zero producers and zero consumers — no host passed them, no `record:*` renderer read
    them — and only the provider's memo dependency list still named them. Record-level
    loading and error state stays where it is actually expressed: each renderer's own data
    source. (#3773)

  No behaviour change, no request-count change:

  - `@object-ui/data-objectstack` drops five `metadataCache.invalidate('views:<object>')`
    calls across `updateViewConfig` / `createView` / `updateView` / `deleteView`. No read
    path has ever populated that key — `listViews` fetches directly, uncached — so all five
    were permanent no-ops. The invalidations of the keys that do have readers
    (`view:<object>:<viewId>` for `getView`, `view-overrides:<object>` for
    `listViewOverrides`) are untouched and now pinned. (#3778)

- 38ab505: Retire the `global_nav` Studio designer surfaces, and track the `@objectstack` family at `17.0.0-rc.6` (objectstack#7100 / objectstack#6888).

  ## The retirement

  `global_nav` was an `ACTION_LOCATIONS` member no running-app surface ever rendered. The console's ⌘K palette (`app-shell/src/chrome/CommandPalette.tsx`) builds its groups from nav items, objects, dashboards, pages, reports, recent items, record search and theme; it holds no reference to `global_nav`, to `actionRendersAt`, or to any action-metadata source. An action declaring `locations: ['global_nav']` therefore never reached a user.

  The Studio designer previewed it anyway — a mock frame reading `⌘K · Command palette` with the author's button inside it. That is the sharp edge the maintainer's 2026-08-09 ruling on objectstack#6888 named: an authoring tool promising a surface the product does not have teaches authors, and every AI copying this corpus, to declare dead metadata. `@objectstack/spec` `17.0.0-rc.6` retired the member (7 members → 6) with a named rejection message; this release removes the designer surfaces that outlived it.

  - `metadata-admin/previews/ActionPreview.tsx` — the mock command-palette placement frame is gone. The metadata strip above it still ECHOES whatever `locations` the draft declares, deliberately: reporting what a (possibly stale) draft says is honest, whereas the frame CLAIMED the platform renders it.
  - `metadata-admin/inspectors/ActionDefaultInspector.tsx` — the `global_nav` entry is gone from `LOCATION_LABELS`. That map is typed `Record< ActionLocation, string >`, so the retirement reached it as a compile error rather than as a silently stale dropdown — the mechanism objectui#3017 installed, firing as designed.
  - `metadata-admin/previews/block-config.ts` — the `record:quick_actions` location dropdown no longer offers it, and both locale tables drop the now-orphaned `…option.location.global_nav` key.
  - `@object-ui/components`' `action:bar` doc comment is aligned. The component's published enum is `[...ACTION_LOCATIONS]`, so it followed the retirement on its own; only the prose was stale.

  `@object-ui/core`'s `ActionEngine.getActionsForLocation` is **unchanged and still answers a literal string match**. Narrowing it to the six live members would put a second rejection point beside the schema's — the tolerant-consumer shape the strict-contract rule forbids, inverted. Enforcement stays where it belongs: the parameter type is now six-membered so no type-correct caller can spell the retired value, and `ActionLocationSchema` rejects it by name at authoring and publish time.

  ## The dependency move

  All 37 `@objectstack/*` declarations across 30 `package.json` files move from `^17.0.0-rc.5` to `^17.0.0-rc.6`, and `pnpm-lock.yaml` resolves one copy of each family package at rc.6. The siblings move with `spec` because `client` / `formula` / `lint` pin it **exactly** — leaving them behind would keep two copies of the spec in the tree, the split brain objectui#3560 called out.

  Bumping the pin and repairing the fallout cannot be split: at rc.5 the `Record< ActionLocation, string >` above is missing a key, at rc.6 it has an excess one.

  ## Breaking, in FROM → TO form

  - **`@object-ui/types`' `Theme` now binds the spec's `Theme`, not `ThemeInput`.** rc.6 retired every `…Input` alias and moved the bare name onto the `z.input` side (`X` = `z.input`, `XParsed` = `z.infer`). The runtime shape and this package's exported name are unchanged — `Theme` was, and still is, the AUTHORING shape where `mode` is optional. Re-pointing at `ThemeParsed` would have been the silent swap.
  - **`SpecReport` / `SpecReportChart` re-point to `ReportParsed` / `ReportChartParsed`, and `SpecReportInput` / `SpecReportChartInput` to `Report` / `ReportChart`.** Same rename, same rule: each local alias keeps the SIDE it had at rc.5.
  - **`@object-ui/types` no longer re-exports `I18nObject`, `LocaleConfig`, `PluralRule`, `DateFormat` or `NumberFormat`** — all five were retired by rc.6. They were dead re-exports here: nothing in this repo imported them from `@object-ui/types` (`@object-ui/i18n`'s formatter vocabulary in `utils/spec-formatters.ts` is locally declared and never bound the spec symbols). `I18nLabel` survives and is unchanged as a name.
  - **`I18nLabel` itself widened from `string` to `string | Record< string, string >`** — rc.6 folded the retired `I18nObject`'s per-locale map into it and ships `resolveI18nLabel(label, locale)` as the shared resolver. Every read in this repo that lands in a text slot now goes through that resolver, so an inline map renders its locale instead of `[object Object]`. Reads the compiler cannot see are audited separately in objectui#4163.
  - **`@object-ui/types`' `GlobalFilterSchema` derives via `.safeExtend`, not `.extend`.** rc.6's `GlobalFilterSchema` carries a refinement and zod 4 refuses `.extend()` on a refined object outright, which threw at module load. `.safeExtend` is zod's prescribed replacement and KEEPS the refinement, so the spec's cross-field rule now also runs on this package's dialect — which is the intended behaviour, since the pinned divergences widen individual fields and were never meant to switch off a whole-object rule.

- 92250d6: One home for the number-display policy — and a percent stops meaning two different things between a list cell and a dashboard measure

  `formatDisplayNumber`, `shouldGroupDisplayNumber` and `DisplayNumberFormatOptions` move from `@object-ui/i18n` into `@object-ui/core`. `@object-ui/i18n` re-exports all three under the same names, so every existing import path keeps working unchanged and both spellings resolve to the same function object; nothing published was removed.

  The move is what fixes the bug. `@object-ui/core`'s `formatMeasure` needed exactly this policy and could not import it — `core` is the React-free engine and is a runtime dependency of React-free consumers (the `object-ui` VS Code extension, `@object-ui/data-objectstack`), while `i18n` depends on `i18next`/`react-i18next` and peer-depends on React. So `formatMeasure` carried a parallel `Intl` implementation, recorded at both ends as deliberate duplication, and the two drifted in the one place a hand-built string and `Intl` disagree. A German session read `1.234,5 %` from a list cell and `1.234,5%` from a dashboard measure showing the same number. The function is pure, so the boundary was never a property of the code — only of where the code sat; moving it down removes the obstacle instead of working around it. `core` imports nothing from `i18n`, so the new edge adds no cycle.

  **Behaviour change — a measure's percent sign now follows the locale.** `formatMeasure` appended a literal `%` in every locale; it now renders the locale's own percent convention, the same one the list-cell `formatPercent` has used since the fix to its own machine-locale defect. Measured to change output in de, fr, es, ru, sv, cs, fi (a no-break space appears before the sign), tr (the sign moves to the FRONT: `%1.234,5`) and ar (its own percent sign plus U+061C). English, Japanese and Chinese are byte-identical — their convention is a bare trailing sign — which is why this was invisible in an English session.

  **No numeral moves, in any locale, at any magnitude.** The obvious route to the locale's convention is `Intl`'s `style: 'percent'`, but that style expects a fraction, so a value already in percentage points would have to be divided by 100 for `Intl` to multiply it straight back — and that round trip is lossy. Measured, it moves 27,581 of 1,200,013 ordinary-magnitude en-US forms at rounding ties (`0.175` at two decimals becomes `0.17%` instead of `0.18%`), plus `MAX_SAFE_INTEGER` and everything from 1e23 up, where `100,000,000,000,000,000,000,000%` becomes `99,999,999,999,999,990,000,000%`. The percentage points are formatted directly instead, through a new `style: 'percentPoints'` on `DisplayNumberFormatOptions`; that route was measured to produce a byte-identical percent affix to `style: 'percent'` across all 171 locale tags tested while moving none of those 1,200,013 forms. Callers holding a fraction keep using `style: 'percent'`, whose behaviour is unchanged — naming the two cases apart is what stops the next caller from reaching for the lossy one.

  `@object-ui/i18n`'s entry declaration is byte-identical, but the declaration it points at now lives in `@object-ui/core` and the package gains that dependency, so it takes the same minor bump rather than a patch.

- c1d939f: One `SchemaNode`, and one label vocabulary — the union wins, and labels resolve where the locale lives

  Two packages published a type called `SchemaNode` and they were not the same type. `@object-ui/core` hand-declared `interface SchemaNode { type: string; … [key: string]: any }`; `@object-ui/types` exported `type SchemaNode = BaseSchema | string | number | boolean | null | undefined`, whose own doc comment names `'Plain string'` a valid node. Both were exported under one name from packages the same consumers import together, so which declaration a call site got depended on which package it happened to import from — #4548's canary measured 19 of 35 errors as exactly that collision. Core's declaration is now a re-export of types', so there is one declaration left to disagree with. Core's entry surface is unchanged: `dist/index.d.ts` is byte-identical across the change.

  Reconciling it exposed a real defect rather than a mechanical narrowing, which is why the first attempt was withdrawn instead of forced. The spec bridges write `spec.label` — the spec's `I18nLabel`, an INLINE locale map like `{ en: 'Owner', 'zh-CN': '负责人' }` — into `node.label`, and `BaseSchema.label` declared `string`. Under core's old index signature that assignment was invisibly `any`; under one honest `SchemaNode` it is a type error. `BaseSchema.label` and `.description` therefore now accept `string | I18nLabel`, and the two bridge assignments compile with their expressions untouched.

  Resolution happens at READ time, in the renderer, against the display locale — not at the bridge. Resolving at the bridge was measured unimplementable: it is a plain class method that cannot call a hook, `BridgeContext` declares no locale, and `updateContext()` has zero callers, so a bridge-resolved label would freeze one audience's language into the node tree with no re-translation channel. React's own invalidation re-translates for free at the read site.

  The widening turned every blind `schema.label`-as-string read into a named compiler error, and that inventory is the audit: it named four sites repo-wide, all one class — the label reaching a React child position, where a map does not render as `[object Object]` but THROWS `Objects are not valid as a React child`, failing the whole subtree. Three are `@object-ui/components` renderers (`filter-builder`, `sidebar-group`, `dropdown-menu`), which now resolve with the spec's own `resolveI18nLabel` against `useDisplayLocale()`. The fourth is `plugin-dashboard`'s `DashboardGridLayout` heading, which resolves with `pickLocalized` against the active UI language — matching the widget-title resolution already in that same component rather than putting two resolvers and two disagreeing locale channels in one render; the two resolvers are limb-for-limb twins with a parity test pinning them.

  One interface now carries both label vocabularies two properties apart — `label`/`description` are the spec's INLINE map, `ariaLabel` is the KEYED bundle reference — and each accepts the other's shape vacuously. That confusability is objectui#4167's known hazard, inherent to the spec's `I18nLabel` design; both shapes are named with cross-referenced doc comments stating which resolver owns which slot, and a pin asserts the two unions do not collapse into each other.

  Finally, the spec bridges declare their return type as `BaseSchema` instead of the union. Both bridges end in a single `return node` on an object literal, so the union described nothing real while forcing a narrowing at every read — 272 mechanical errors across five suites in the first round. That change is a type annotation only; the emitted JavaScript is byte-identical.

- 2459a3e: Retire `ActionEngine`'s event-mapping API (objectui#3368). `ActionEngine.addMapping()`,
  `ActionEngine.dispatch()`, the private `mappings` registry behind them, and the exported
  `ActionMapping` interface are removed under enforce-or-remove: all four were public surface
  of `@object-ui/core` with zero production callers. Nothing in the repo ever registered a
  mapping, so `dispatch()` had no reachable caller either, and every call site was in the
  engine's own test file.

  Breaking for anyone who typed against or called the removed declarations, marked `minor`
  per this repository's version-alignment convention (the major tracks `@objectstack`, never
  an API-break count). Actions are still entered by name (`executeAction`), by location
  (`getActionsForLocation`), by shortcut (`handleShortcut`) and in bulk (`executeBulk`) —
  only the event-keyed entry point is gone, and no runtime behaviour changes because no
  runtime path reached it.

  The three ways the retired condition gate had drifted from the `visible` contract that
  `getActionsForLocation` implements die with the path rather than being fixed on it: it
  entered on a raw truthy check (`condition: false` dispatched anyway), typed `condition` as
  `string` only (a `{ dialect: 'cel', source }` envelope could not reach the canonical
  `@objectstack/formula` engine), and evaluated without `throwOnError` (a throwing predicate
  failed OPEN, the opposite of `visible`'s fail-closed posture). Aligning the contract of an
  API nobody calls would only have widened behaviour nobody uses.

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

- bb68488: Stop declaring 14 symbols under names `@objectstack/spec` owns at `17.0.0-rc.6`
  (objectui#4167, objectstack#4115).

  The rc.6 bump published nine names this repo already declared locally, on top of
  four that predate it — `check:spec-symbols` reported all thirteen at once, and a
  fourteenth (`GlobalFilterSchema`) appeared during the bump itself. Each was
  triaged on its own rather than blanket-renamed, because the right answer differs
  per symbol: five bind to the spec, three are renamed because the spec's
  same-named export means something else, five arrive by derivation, and one is a
  declared dialect with a written reason.

  **Breaking for importers of `@object-ui/react`, `@object-ui/app-shell` and
  `@object-ui/types`** — three exported names changed, because the spec exports the
  same name for a _different_ thing:

  | package               | was                | now                            | what the spec's same-named export actually is                                                                                                          |
  | :-------------------- | :----------------- | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `react` / `app-shell` | `MetadataState`    | `MetadataCacheState`           | a metadata item's LIFECYCLE state — `'draft' \| 'active' \| 'deprecated' \| 'archived'` (`MetadataStateSchema`, `@objectstack/spec/system`)            |
  | `react` / `app-shell` | `resolveI18nLabel` | `resolveKeyedI18nLabel`        | a resolver for the INLINE per-locale map (`{ en: 'Owner', 'zh-CN': '负责人' }`) against a BCP-47 locale                                                |
  | `types`               | `DateRangePreset`  | `FilterBuilderDateRangePreset` | the thirteen HISTORICAL dashboard filter-bar presets; this one is the filter-builder set, which adds eight FUTURE windows the dashboard schema rejects |

  `resolveI18nLabel` is the one where the collision had already started costing
  something. rc.6 widened `I18nLabel` from `string` to
  `string | Record< string, string >`, so the same authored value now reaches
  either resolver — and each answers wrongly, silently, for the other's input: the
  keyed one returns `undefined` for `{ en: 'Owner' }` (no `key`, no
  `defaultValue`), and the spec's reads `key` / `defaultValue` / `params` as locale
  tags. The rc.6 bump PR met this and aliased the spec's import as
  `resolveInlineI18nLabel` in five files, with hand-written comments at two of
  them. That is a review convention, which is what objectstack#4115 exists to
  replace with a rule — so `Keyed` is now the counterpart of that `Inline`, and the
  name says which vocabulary it resolves at every call site.

  **Eleven keep their names and are now imported or derived from the spec** instead
  of re-declared: `DATE_RANGE_PRESETS`, `NavigationMode`, `AddressValue`,
  `BreakpointColumnMap`, `BreakpointOrderMap`, `KanbanConfig`, `CalendarConfig`,
  `GanttConfig`, plus the three renamed above at their new names.

  **Four of the copies were losing information, not just duplicating it.**

  - **`GanttConfig` declared six keys and called itself canonical; rc.6's
    `GanttConfigSchema` declares seventeen.** The eleven it never mentioned —
    `parentField`, `typeField`, `baselineStartField`, `baselineEndField`,
    `groupByField`, `resourceView`, `assigneeField`, `effortField`, `capacity`,
    `quickFilters`, `autoZoomToFilter` — are all read by
    `plugin-gantt/src/ObjectGantt.tsx`, through a local `GanttConfigEx`
    intersection that existed only because this type did not carry them. It now
    derives from the spec, with `timeSegments` (shift segmentation) as the one
    genuinely local extension; the schema is `$loose` upstream, so that key is
    legal metadata rather than a second dialect.
  - **`GanttConfig.tooltipFields` carried the comment "not part of the upstream
    GanttConfigSchema".** It is, as of rc.6, so the key now arrives from the spec.
  - **`AddressValue` declared five of the spec's seven parts** — `countryCode` and
    `formatted` were missing, under a comment already claiming to be "the part
    names of `AddressSchema`". The widget still renders five inputs; binding the
    type stops it from asserting the platform cannot store the other two, and makes
    the `{ ...address }` write-through say so.
  - **`DATE_RANGE_PRESETS` was `Object.keys(PRESET_RANGES)`,** a third copy of a
    vocabulary the spec extracted in objectstack#4614 precisely to collapse — its
    own doc comment names this module as one of the three. It is now the spec's
    array by reference, and the local date-macro bounds table is pinned complete
    against it with `satisfies`, so a preset the schema gains without bounds here
    is a compile error rather than a filter that validates clean and then selects
    nothing.

  `NavigationMode` was one hop from the spec already (`NavigationConfig['mode']`);
  it is bound directly, with a both-directions type pin that it stays the same type
  as the config's own `mode`. `KanbanConfig` / `CalendarConfig` /
  `BreakpointColumnMap` / `BreakpointOrderMap` were exact hand copies of `$strict`
  schemas and are now re-exports — "still exact" is the argument for binding them,
  since a copy with nothing to protect can only drift.

  `GlobalFilterSchema` is the one ALLOW entry. It is the same spread-composition
  dialect as `SelectOptionSchema` next to it, and it collided only because rc.6's
  new refinement forced `.extend()` to be respelled as a `.shape` spread — which
  moved a derivation the guard could see into an object literal it deliberately
  does not descend into. The dialect is unchanged and its three divergences are
  pinned; which side moves on the refinement itself is objectui#4165.

  `@objectstack/spec` moves from `devDependencies` to `dependencies` in
  `@object-ui/layout`: its public type surface now references the spec.

### Patch Changes

- ee26e65: Analytics: the dimension label net's fetch-and-memo glue is written once, not once per surface

  PR #4388 (objectui#4330) put the same React glue on two surfaces — the dashboard's `DatasetWidget` and plugin-report's dataset block. The resolution RULES were never duplicated (both call the same `@object-ui/core` helpers), but the wiring around them was: read the object schema through the host's authenticated `apiFetch`, keep the fetched metadata locale-free in state, derive the label maps in a render memo. Two copies meant two statements of the same two bug fixes, which is a drift surface rather than a defect — nothing a user could hit today, filed as objectui#4389 so it was retired deliberately.

  It is now split along the layer that can actually hold each half. `@object-ui/core` gains the React-free parts — `loadDimensionFieldMeta` (the base-object read composed with the dimension walk), `deriveDimensionLabelMaps` (the locale-applying derivation) and `dimensionOptionTranslator` (binding the bundle resolver to the object that OWNS a terminal field, which for a dotted path is the relationship target). `@object-ui/react` gains `useDatasetDimensionLabels` / `useDatasetDimensionMeta`, the React wiring that cannot live in core, beside the `useViewData` / `useElementDataSource` / `useDiscovery` hooks that already read `SchemaRendererContext` the same way. Both plugins consume it; the dashboard keeps its chart-only per-category colour and category-order derivation layered locally, since a table renders no palette.

  The card originally proposed `@object-ui/core` as the whole glue's home. That home was disproven by measurement and retired in the card's PM RULING #2: `SchemaRendererContext` is defined in `@object-ui/react`, which depends on core, so core importing it back is a cycle — and core is React-free by declaration, by content, and by the topology in AGENTS.md. objectui#3367 had already ruled this direction for the same family (core-canonical logic, react re-exports).

  Behaviour is unchanged by construction: same read count, same best-effort fallback, same memoization boundary. The two bug fixes are now stated once and pinned at the shared hook — the read rides the host's authenticated `apiFetch` (objectui#4121, pinned by asserting that a new channel re-issues the read, i.e. that it really is in the effect's deps), and the fetched metadata stays locale-free (objectui#4030 / PR #4324, pinned by switching language at runtime and asserting the labels flip with no second metadata read). All 39 assertions PR #4388 landed across both surfaces pass unchanged, and their files are byte-identical to before.

- 5900ac5: Analytics surfaces now run resolved select-option labels through the locale bundle — the chart legend and the related list on one page stop disagreeing

  A dashboard widget grouped by a `select` field rendered the option's authored English label while the related list beside it rendered the translation. The decisive evidence in objectui#4030 is the stored value `orion`: the chart read `Orion Engineered Carbons`, a string with no resemblance to the value and matching the object's `label` byte for byte. So the analytics path had already RESOLVED the option label — it simply never ran the result through the i18n bundle before display. (`domestic → Domestic` differs from its value by case alone, which is why the first diagnosis, "the report groups by stored value", was wrong.)

  There is exactly one resolution channel and this change reuses it rather than adding a chart-side dialect: `fieldOptionLabel` from `useObjectLabel`, i.e. `{ns}.fieldOptions.<object>.<field>.<value>` — the convention `@objectstack/spec` names objectui as the reader of, and the one list, form, kanban and record-picker surfaces already translate select options through. The bundle is applied ONCE, at the output of the label net that landed in objectui#4053/#4263, on the shared option list every consumer reads: chart axis and legend, the table/pivot cells of a dotted dimension, that table's CSV export, per-category colours and the declared category order. `@object-ui/core` gains `localizeFieldOptions` (the pure mirror of `translateOptions`), an optional translator on `buildDimensionLabelMap`, and `resolveDimensionFieldMeta` — the same single relationship walk `resolveDimensionFieldOptions` performs, now keeping the object that OWNS the terminal field, because for `crm_account.industry` the bundle key is `crm_account`, not the dataset's base object.

  Two properties the fix is shaped around. The rows reach this net keyed either way — by stored value when the server did not resolve the dimension, by the English label when it did (ADR-0021) — and the reported screen is the second case, so the map answers to both keys and lands on the same translated display. And identity is untouched: `relabelDimensions` still rewrites display only, so a drilled chart segment clicked as `欧励隆` filters by `orion`, bucket ids and pivot totals keep their raw keys, and an option with no bundle entry (or an `en` console) renders exactly the authored label it renders today.

  The per-locale work moved from the metadata fetch into the render, so switching language now re-labels in place instead of waiting for a refetch.

  Not covered, and unchanged here: a LOCAL select dimension on a table/pivot, whose label the server resolves and whose client-side net is deliberately off (objectui#4263), and a dashboard global filter's own field label, which has no object name in its metadata to key a bundle lookup with — tracked on objectui#4030.

- aca27fa: The multi-dimension pivot branch buckets a null first-dimension value instead of dropping its bar (objectui#4497)

  `buildChartSeries`' pivot branch (2+ dimensions, single measure) bucketed rows by `String(xRaw ?? '')` but wrote the RAW value into the emitted row, so a null first-dimension value produced `{status: null, Low: 3}` and reached recharts with a null category — which draws no mark. Measured at the DOM: a two-group pivot drew ONE bar, and an all-null pivot drew axes and gridlines with zero bar rectangles and no empty state. That is the same mechanism objectui#4466 fixed one branch below, on the branch that card deliberately left pinned as-is until the pivot's own bucketing had been measured.

  The pivot now maps a null/undefined first-dimension VALUE to the same bucket label the single-dimension branch uses — `ChartSeriesOptions.nullCategoryLabel`, defaulting to `NULL_CATEGORY_LABEL`. One doctrine, one predicate, two call sites; no new export, and every existing call site compiles and behaves identically.

  The bucket KEY is untouched, which is what keeps this a display fix: `String(xRaw ?? '')` still decides which rows share a bar, so every existing grouping is byte-identical and only the label the bucket carries changes. Rows that lack the category key entirely are still not bucketed — that shape is a dimension grouped by but never projected (framework#4033), a different defect with a different answer.

  Drill-through needed no change, which was measured rather than assumed: the pivot's emitted rows are AGGREGATED, so they are not index-aligned with `drillRawRows` and the one production caller (`DatasetWidget.handleChartDrill`) already drills by SEARCHING the raw rows through `findChartSeriesRow`. Those raw rows still carry their null, and objectui#4466's label-matching covers the multi-dimension arm as well as the single-dimension one, so the newly-visible bar resolves to the right record. Pinned at both levels so a regression in either half surfaces as the dead click it would be.

- 613b167: A dataset dimension on a dotted relationship path now renders its option labels instead of the raw stored enum

  A `DatasetDimension` whose `field` is a relationship path (`crm_account.industry`) got no select-option resolution at all: the chart plotted `education`, `finance`, `manufacturing` — the database column, unresolved — while the **same underlying field** reached as a **local** dimension rendered `Education`, `Finance`, `Manufacturing` beside it on the same dashboard. Nothing errored, so the widget just quietly showed database enum values to end users; on a non-English deployment those are words that appear nowhere else in the UI, since every form and list shows the translated label.

  The label lookup read options as `baseObject.fields[<path>]`, which only ever matches the local spelling. For a dotted path the options live on the **related** object, so the lookup missed and the renderer fell through to the stored value.

  The object-resolution step of that one lookup now walks the path: each segment before the last must be a declared relationship (`lookup` / `master_detail`, target read from `reference` / `reference_to` / `referenceTo` / `reference_to_object`), and the terminal field's options are read off the object that actually owns it. This is the same lookup for both spellings rather than a dotted-path variant beside it — a single-segment path never enters the walk and resolves exactly as before, so the local and joined paths cannot drift apart. Multi-hop paths (`crm_account.owner.department`) resolve too, which is the shape the dataset designer already emits.

  Hops ride the caller's existing `GET /meta/object/:name` channel — the same authenticated read that fetched the base object — so no new fetch layer is introduced, and objects are fetched once per resolution even when several dimensions share a prefix. Every failure stays best-effort: a segment that is not a relationship, a target that cannot be loaded, or a terminal field with no options yields no mapping and the raw value survives, exactly as it does today.

  Applies to both surfaces that carried this lookup: dashboard dataset widgets (`DatasetWidget`) and the chart view's dataset path (`ObjectChart`).

  Scope: this ends at "the label is in hand". Whether that label then passes through the i18n bundle is a separate gap tracked upstream as objectstack#5076.

- abb0f81: A dashboard date filter's default has one spelling again — the bare preset name — and the `{ preset }` object becomes a documented legacy alias with a retirement window

  `@objectstack/spec` 17.0.0-rc.6 added a cross-field refinement to `GlobalFilterSchema` holding a `type: 'date'` filter's `defaultValue` to three spellings: a preset NAME (`last_7_days`), an ISO date (`2026-01-15`), or a date-macro token (`{today}`). objectui's derived schema had widened `defaultValue` to `z.any()` and did not carry the refinement, so it accepted `{ preset: 'last_7_days' }` — metadata the platform refuses. That is the tolerant-consumer shape where the designer goes green and the save fails server-side, and it is now closed: the refinement is adopted, the widening is retired, and the object form is refused with the spec's own message.

  Per the maintainer ruling on objectui#4165, the spec stays strict and the bare preset name is the single canonical spelling. `{ preset }` is handled as an ADR-0089 legacy alias rather than by a permanently tolerant schema: `liftLegacyGlobalFilterDefault` / `liftLegacyDashboardFilterDefaults` (new exports on `@object-ui/types`) convert it to the bare name, `@object-ui/core`'s `resolveDashboardFilterDefs` applies the lift when it reads a stored dashboard, and the console's dashboard designer applies it as the document enters the editable draft so the next save persists the canonical spelling. The retirement window is recorded at the read site: the alias may be removed in `@object-ui/types` 18.0.0, and every lift warns on the console so a surviving legacy document is visible rather than silently tolerated.

  No stored dashboard has to change for this release. The lift means a document carrying the object form keeps loading and rendering exactly as before — measured, not assumed: a legacy declaration already resolved correctly, because `{ preset }` also happens to be the runtime value shape objectui's own date filters use, and that coincidence is why the object form went unnoticed for so long. What changes is that the declaration is now canonicalized on read and rewritten on save, so the two spellings converge instead of accreting.

  The other two divergences in this schema — the bare-string `options` shorthand and the optional `optionsFrom.labelField` — are unaffected. Carrying the spec's refinement while keeping them needed a new composition: a refined object schema in zod 4 rejects `.extend()` and `.omit()` outright and types every `.safeExtend()` override as `never`, so objectui's schema now spreads the spec's shape and re-attaches the spec's object-level rules by delegating to the spec schema itself. Nothing restates the spec's grammar, and a refinement the spec adds later flows in with no change here.

- 7e4f0e5: fix(dashboard,i18n): KPI cards and dashboard filters resolve authored labels instead of dropping them (#4032)

  A `type: 'metric'` dashboard widget rendered raw English while every other widget
  type on the same dashboard rendered the translation, and dashboard filter chips
  rendered `[object Object]` or the raw stored value. Both come from the same
  cause: authored labels reaching a render site that could not read the
  vocabulary `@objectstack/spec` actually admits.

  - **KPI cards rejoin the widget translation channel.** The self-contained
    `metric` branch built its own label from the raw `widget.title`, so the
    `{ns}.dashboards.{dash}.widgets.{id}.title` value the renderer had already
    resolved was computed and thrown away. It now reads that channel like every
    other widget header.
  - **The three private `resolveLabel` copies** (`DashboardRenderer`,
    `MetricWidget`, `MetricCard`) are gone. Each read the retired
    `{ key, defaultValue }` key-reference form and ended `defaultValue || key`, so
    handed the inline per-locale map the spec admits today they returned nothing —
    a KPI card with a map title rendered the literal string `metric`. All three
    now use `pickLocalized`, the resolver already used for this vocabulary
    elsewhere in the package.
  - **Dashboard filter labels and static option labels resolve per locale.**
    `DashboardFilterDef.label` widens to `string | I18nLabel`, the filter bar
    resolves before rendering (fixing `[object Object]: All` in the trigger, and
    in `aria-label` / `placeholder`), and the `def.label || def.name` gate now
    tests the RESOLVED string — an object is always truthy, so it never reached
    the fallback before.
  - **Option labels are no longer discarded.** `normalizeFilterOptions` coerced a
    map label to the raw stored value in every locale, English included, so
    `{ value: 'domestic', label: { en: 'Domestic', … } }` displayed as `domestic`.
    The pair shape is still normalized; the label vocabulary is preserved for the
    render side to resolve.
  - **`DashboardComponentSchema.globalFilters` is bound to the spec's
    `GlobalFilter`** instead of restated by hand. The restatement was both too
    narrow (`label?: string`, which is what made these read sites invisible to
    `tsc`) and too wide (it declared a bare-string option shorthand the spec
    rejects at publish).

  Plain-string labels are unaffected and render byte-identically.

- 49ae9f4: Pivot buckets encode an empty dimension value as JSON `null`, so it no longer collides with a row whose value is literally the placeholder character

  objectstack#5473 / objectstack#5665 replaced the pivot's delimiter-joined ids
  with `JSON.stringify`, because every delimiter that had been tried — an empty
  string, a plain space, a control character — assumed the data would not contain
  it, and each assumption failed on ordinary data. This closes the last place the
  same assumption survived: the ids were JSON, but the VALUES fed into them were
  spelled `String(row[d] ?? '∅')`, so an absent dimension value became the
  ordinary string `"∅"` and shared a bucket with a row whose value literally is
  that character (U+2205). One bucket, later row overwriting the earlier one — the
  cell showed a different row's measure, the overwritten row was unreachable, and
  drill-through followed the same wrong index into the wrong records, all without
  an error. The trigger requires that character to appear as a dimension value, so
  this is the assumption being removed rather than a defect users hit today.

  An empty value now encodes as JSON `null`, which `JSON.stringify` renders as a
  bare `null` that no string can spell. The normalization lives in
  `@object-ui/core` as `pivotDimensionValue` (absent ⇒ `null`, everything else ⇒
  its string form) rather than at each call site, because a placeholder spelled by
  a caller is a placeholder that can collide again — which is exactly how this one
  survived the previous fix. `pivotBucketId` accepts `Array<string | null>`
  accordingly; that is a widening, so existing callers passing `string[]` are
  unaffected.

  Both renderers' bucket keys move together, which the fix requires: a bucket id
  and the subtotal map keyed by it are built from the same expression, so changing
  one alone would split the headers while the subtotal map still merged, landing
  every column subtotal under the wrong header. In `plugin-dashboard`'s
  `DatasetWidget` that is the row bucket id, the column bucket id, the cell key,
  and both the `rowTotalById` and `colTotalById` lookups; in `plugin-report`'s
  `DatasetReportRenderer` the single `bucketId` helper already feeds all five.

  The dashboard's column bucket id also stops being a bare string and becomes a
  one-element tuple through the same shared encoder. It was the one id in the
  family still built by hand, on the reasoning that a single value needs no
  boundary — true of the boundary, false of everything else the encoder does, and
  it is why the across axis kept carrying this collision after the row ids were
  fixed.

  No display change: these placeholders only ever entered ids, never labels. An
  unset dimension still renders through `formatDimensionValue` exactly as before,
  and data containing neither an absent value nor that character buckets
  identically — the ids are opaque lookup keys, never parsed back into a value,
  never shown, never persisted.

- d6aa172: Retire `params.newTab` on a url action — `openIn: 'new-tab'` is the sanctioned spelling

  `ActionRunner`'s navigator read a legacy `params.newTab` escape hatch below `openIn` and above the external-URL heuristic. That read is removed, executing the objectstack#6828 maintainer ruling of 2026-08-10, whose contract half shipped in objectstack PR #7375: the url-side readings of an object-form `params` are retired, not renamed.

  Nothing that ever validated can regress. `params` is declared as `z.array(ActionParamSchema)`, so an object-form `params` has always failed the props parse — the fallback could only fire on a stack the spec refuses. The removal also closes a collision hazard: a params dialog declaring a field named `newTab` had the user's own collected input silently steering navigation.

  `openIn: 'self' | 'new-tab'`, the legacy `navigate.newTab` modifier on the `navigation` shape, and the external/relative default are all unchanged.

- 9461dd3: Form actions no longer carry a record id across an object boundary (#4292).

  `ActionRunner.executeForm` forwarded `/forms/:name?recordId=<id>` unconditionally,
  and that URL says nothing about which object the id belongs to — so the form route
  resolved it against the FormView's own target object. When an action fired from a
  record of a DIFFERENT object and ids collide across objects (per-table integer
  keys), the form silently prefilled and, since the route learned to honour the param,
  `PATCH`ed a same-id record of the wrong object.

  - **Producer**: the id is forwarded only when the firing context record's object
    (`context.objectName`) matches the target view's object; on a mismatch no id is
    forwarded, preserving create semantics. When it IS forwarded, the object travels
    with it as `?recordObject=`.
  - **Consumer**: `/forms/:name` refuses — no record read, no write — when
    `recordObject` disagrees with the FormView's object. A URL without the param
    behaves exactly as before, so existing deep links are unaffected.

- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [92876f0]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [1f9b905]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [7e4f0e5]
- Updated dependencies [c1d939f]
- Updated dependencies [bb68488]
- Updated dependencies [ab04728]
  - @object-ui/types@17.5.0

## 17.4.0

### Minor Changes

- c3b01a7: Give composite and grouped field widgets a real accessible name: the form renderer now associates its label by IDREF for widgets that declare `labelling: 'group'`, instead of emitting a `<label for>` that nothing labelable answers (objectui#3961).

  Six widgets rendered a visible group label that named **nothing** in the accessibility tree. Measured in a real form, one field per row, reading each label's `for` against the DOM:

  ```
  address      for=…-form-item -> MISSING            byLabelText=0   role+name=0
  geolocation  for=…-form-item -> MISSING            byLabelText=0   role+name=0
  checkboxes   for=…-form-item -> div                byLabelText=0   role+name=0
  radio        for=…-form-item -> div[radiogroup]    byLabelText=0   role+name=0
  rating       for=…-form-item -> div                byLabelText=0   role+name=0
  file         for=…-form-item -> div[role=button]   byLabelText=0   role+name=0
  ```

  Two shapes, one outcome. `address` / `geolocation` spread the host's id onto their first sub-input and then replaced it with that input's own unique id (objectui#3343, correct in itself), so the `for` named an id no element carried — clicking "Shipping Address" did nothing and the group label was absent from the accessibility tree entirely. `checkboxes` / `radio` / `rating` / `file` kept the id, but on a `div`: a `<label for>` on a non-labelable element is inert HTML — `HTMLLabelElement.control` is `null`, so it activates nothing and contributes no name. A screen reader heard "Street Address", "City", "Alpha", "Beta" — never which group they belonged to.

  The fix is the WAI-ARIA group pattern, driven by a DECLARATION rather than by the host guessing at widget DOM:

  - `@object-ui/core` — `ComponentMeta` gains `labelling?: 'control' | 'group'`. Additive and optional; absent means `'control'`, which is every existing component's behaviour.
  - `@object-ui/components` — the form renderer reads it. For a `'group'` field the `<FormLabel>` publishes an `id` and drops its `for`, and the widget receives `aria-labelledby`. The single-control path is unchanged down to the attribute: no id on the label, no `aria-labelledby` key on the widget, so no field acquires a second naming channel. `ui/form.tsx` is untouched (Shadcn no-touch) — both halves travel as ordinary props, since `<FormLabel>` spreads props after its own `htmlFor`.
  - `@object-ui/fields` — the six audited widgets declare `labelling: 'group'`. `address` / `geolocation` move the host id (and only the id) from their first sub-input to the group container; `checkboxes` / `rating` answer a host-supplied `aria-labelledby` with `role="group"`; `radio` keeps Radix's more specific `radiogroup`; `file` takes the name on its dropzone with no invented group layer, because it has exactly one control that merely happens not to be labelable.

  No new key in the widget props contract: `aria-*` is already declared on it and forwarded by `toDomProps`, the same channel `aria-required` (objectui#3290) travels.

  Deliberately unchanged: sub-labels keep naming their own inputs (`aria-labelledby` overrides `<label for>`, so putting the group name on the first sub-input would have replaced "Street Address" with the field name — the concatenated-name outcome this issue rejected), `aria-describedby` stays on the first focusable sub-input where focus can reach it (objectui#3318), the sub-input ids of objectui#3343 do not move, and standalone rendering — the inline grid editor, a bare SDUI node, where nobody hands down an id and there is no host label to point at — emits no role and no IDREF at all.

  A widget that does not declare itself keeps the old `for`, which the label-association tests report as an association resolving to a non-labelable element. Silence was the failure mode being fixed; the default path stays loud.

- 48132f7: Track the `@objectstack` family at `17.0.0-rc.5` (objectui#3560).

  The pin moves from `^17.0.0-rc.2` to `^17.0.0-rc.5` across all 37 declarations in
  30 `package.json` files, and the sibling `@objectstack/*` packages (`client` /
  `formula` / `lint`) move with it — they pin `@objectstack/spec` **exactly**, so
  leaving them behind would keep a second copy of the spec in the tree and have
  `@objectstack/lint` validating against schemas that still accept the keys rc.3–rc.5
  retire. `pnpm-lock.yaml` now resolves one copy of each of the six family packages
  (`spec` / `client` / `core` / `formula` / `lint` / `sdui-parser`), all at rc.5.

  Bumping the pin and repairing the fallout cannot be split: the pin alone reddens
  CI, and the code alone targets a shape that is not in effect yet.

  ## A live bug this upgrade fixes

  **`ObjectStackDataSource.delete()` never emitted its mutation event, and resolved
  `undefined` instead of a boolean.** `@objectstack/client`'s `DeleteDataResult`
  declared a key called `deleted` — a key no schema has ever declared and no server
  path has ever returned on `DELETE /data/:object/:id`. So `result.deleted`
  compiled and read `undefined` at runtime: the guard never fired, a successful
  delete notified no subscriber, and every consumer's cache stayed stale.
  objectstack#5638 corrected the interface to the schema's `success`; following the
  rename is what restores both behaviours. Nothing in this repo had to change shape
  for it — the code was already asking the right question of the wrong key.

  ## Breaking, in FROM → TO form

  - **The five `@objectstack/spec/ui` interaction-config modules are gone** —
    touch / dnd / keyboard / animation / offline, 32 defs and 64 exports
    (objectstack#4988, PR objectstack#5321). None of them had an authoring door: no
    metadata document could ever carry one of these blocks, so a stack that parsed
    before the retirement parses byte-for-byte the same after it. `@object-ui/types`
    drops the 32 `export type` re-exports. The vocabulary each one's only real
    consumer needs is now declared by that consumer, which is the remedy the spec's
    own retirement ledger prescribes ("declare that union locally — it is your
    client's policy, not the platform's"):

    - `@object-ui/react`'s `useOffline` owns `OfflineStrategy`, `ConflictResolution`,
      `PersistStorageType`, `EvictionPolicyType`, `OfflineConfig`,
      `OfflineCacheConfig`, `OfflineSyncConfig`;
    - `@object-ui/core`'s `DndProtocol` / `KeyboardProtocol` own `DndConfig`,
      `DragItem`, `DropZone`, `DragConstraint`, `DragHandle`, `DropEffect`,
      `KeyboardNavigationConfig`, `KeyboardShortcut`, `FocusManagement`,
      `FocusTrapConfig`;
    - `@object-ui/types`' `mobile` module owns `SpecGestureConfig`,
      `SwipeGestureConfig`, `PinchGestureConfig`, `LongPressGestureConfig`,
      `TouchTargetConfig`, `TouchInteraction` (plus a new `SPEC_GESTURE_TYPES`
      runtime tuple), so `@object-ui/mobile`'s import paths are unchanged.

    Every shape is moved verbatim — same keys, same members, same optionality — so
    no hook or bridge changes behaviour. Consumers importing these names from
    `@object-ui/types` must import them from the owning package instead. Note the
    spec's _surviving_ `ConnectorConflictResolution` (`/integration`, connector sync)
    and `ConflictResolutionStrategy` (`/api`, route merge policy) are **different
    concepts** — do not re-point at them.

  - **`@object-ui/types` no longer re-exports `NotificationAction` or `EmbedConfig`**
    (objectstack#5015, PR objectstack#5300). Both were published `ui` vocabulary with
    no authoring door; no notification action was ever parsed from metadata and no
    iframe route ever read an embed config. The presentation enums
    (`NotificationType` / `NotificationSeverity` / `NotificationPosition`) and
    `SharingConfig` **survive** and are untouched — public form sharing still gates
    the anonymous endpoints on `allowAnonymous` + `publicLink`.
    `@object-ui/core`'s `SharingProtocol` keeps `resolveEmbedConfig` /
    `generateEmbedCode` against a locally declared `EmbedConfig`, so its surface is
    unchanged.
  - **`ThemeEngine` stops emitting nine retired CSS variable groups**
    (objectstack#5021 option 2, PR objectstack#5289). `theme.animation`,
    `theme.zIndex` and five typography groups (`fontSize` / `fontWeight` /
    `lineHeight` / `letterSpacing`, plus `fontFamily.heading` / `fontFamily.mono`)
    are tombstones the schema now rejects by name, so `--duration-*`, `--timing-*`,
    `--z-*`, `--font-size-*`, `--font-weight-*`, `--line-height-*`,
    `--letter-spacing-*`, `--font-heading` and `--font-mono` had become structurally
    dead code — no author could produce the input that reached them.
    `generateAnimationVars` and `generateZIndexVars` are removed from
    `@object-ui/core`, and `@object-ui/types` drops `Animation` / `ZIndex` /
    `AnimationSchema` / `ZIndexSchema`. **`theme.customVars` is the declared — and
    since #5021 the only — door**: each entry is emitted verbatim as
    `--<key>: <value>`, so a `--z-modal` or a `--duration-fast` goes there now.
    LIVE emission is untouched byte for byte: `colors`, `borderRadius`, `shadows`,
    `typography.fontFamily.base` (→ `--font-sans`) and `customVars`.
  - **`@object-ui/types`' `HttpMethodSchema` now binds the spec's
    `HttpMethodSubsetSchema`, and `HttpMethod` binds `HttpMethodSubset`**
    (objectstack#5832, PR objectstack#5976 — objectui#3499). The spec renamed its
    5-value UI subset because `schemaNameFromExportKey` strips the `Schema` suffix,
    so the 5-value and 7-value enums both published as `shared/HttpMethod` and the
    later write won — the emitted JSON Schema and reference page described only one
    of them. **The runtime domain is unchanged and this repo's exported names are
    unchanged**; this follows the rename without touching cross-package semantics.
    Deliberately NOT re-pointed at the spec's bare `HttpMethod`: that is the 7-value
    enum, and widening to it would let `method: 'HEAD'` compile and then throw in
    `HttpRequestSchema.parse()`.
  - **`dashboard.widgets[].actionUrl` / `actionType` / `actionIcon` / `aria` are
    refused, not stripped** (objectstack#5010, ADR-0049 enforce-or-remove). A
    dashboard widget has no action button and never had one — every action the
    dashboard dispatches comes from `header.actions[]` — and no renderer ever applied
    the widget `aria`, so it promised accessibility compliance it did not deliver.
    A stale dashboard now gets a named error telling it where the affordance moved,
    instead of silently losing it. Run `os migrate meta --from 16` to rewrite.

### Patch Changes

- 6719877: `condition: false` now actually prevents the action from executing (objectui#3872)

  `ActionRunner.execute` — the engine's public execution entry, shared by every
  action surface — gated conditional execution on `if (action.condition)`, i.e. on
  the raw value's TRUTHINESS. Truthiness cannot answer the question the gate needs
  answered ("did the author declare a condition?"), and on this key it answered in
  the over-permissive direction: `condition: false` fell on `if (false)`, so the
  whole block was skipped, `evaluateCondition` was never consulted, and the action
  executed. Measured with a call-counting handler:

  - `condition: false` — handler ran: **true**, result `{ success: true }`
  - `condition: { dialect: 'cel', source: 'false' }` — handler ran: false, result `{ success: false, error: 'Action condition not met' }`

  Two spellings of the same statement, opposite outcomes. `false` is the most
  explicit "never execute this" metadata can carry — and what a template that
  switches an action off emits — so the direction matters: the action really ran,
  possibly writing. This is the over-permission half of the objectui#3492 family
  (the `disabled` gate one line below is objectui#3848, whose defect pointed the
  other way).

  The gate now asks whether a `condition` gate is DECLARED before evaluating.
  "Nothing to evaluate" is read from core's single predicate normalizer
  (`toPredicateInput`, which maps `''`, `null`, an empty-`source` envelope and
  non-predicate values to `undefined`), plus the whitespace-only string, which the
  normalizer wraps rather than collapses — objectui#3850's ruling on the scope of
  "empty predicate", the same one the `disabled` gate already applies. Once the
  door asks the right question the verdict needs no boolean branch of its own:
  `evaluateCondition` returns a boolean argument verbatim.

  **Behaviour change surface, deliberately one-directional and one row wide.**
  Exactly one shape changes verdict — a declared boolean `false`, from executing to
  refused (`{ success: false, error: 'Action condition not met' }`, the message the
  key already used). Everything else is byte-identical: `condition: true`, an
  absent `condition`, and truthy expressions/envelopes still execute; falsy
  expressions, falsy CEL envelopes and falsy `${…}` templates are still refused,
  as before; the three empty predicates (`''`, whitespace-only, an empty-`source`
  envelope) still execute, now because nothing was declared rather than because
  `if ('')` happened to be falsy; and non-predicate junk (`0`, `{}`) still
  executes — a value that is not a predicate must not decide an action's fate,
  which is the fail-open posture this module already committed to for `disabled`.
  So this change can only start refusing execution, never start allowing it — the
  mirror image of objectui#3848's fix.

  `ActionDef.condition` is widened to `string | boolean` to match what the gate now
  honours (and the `disabled` key beside it). This is not a lenient consumer
  alias: the boolean was always accepted at runtime through the interface's index
  signature, it was simply ignored.

  The value handed to the evaluator is deliberately left RAW rather than normalized
  first, for the same reason as objectui#3848 with the sign flipped:
  `toPredicateInput` wraps unconditionally, so an already-templated `'${x}'`
  becomes `'${${x}}'`, fails to parse, returns verbatim and coerces to a constant
  `true` — on `disabled` that blocks everything, on `condition` it would EXECUTE
  everything. That normalizer defect is objectui#3871; a tripwire next to the new
  pins goes red the day it is fixed.

- 56ff091: An empty `disabled` predicate no longer refuses to run the action (objectui#3848)

  `ActionRunner.execute` — the engine's public execution entry, shared by every
  action surface — gated on `action.disabled != null && action.disabled !== false`
  and handed the value straight to `evaluateCondition`. That function documents one
  default for "there is no condition here": return `true`, meaning
  _visible/enabled_. On `disabled`, `true` means BLOCKED. So every empty predicate
  was read as "disabled": the handler was never invoked and the caller got
  `{ success: false, error: 'Action is disabled' }` — a state the metadata never
  declared. Measured with a call-counting handler:

  - `disabled: ''` — handler ran: false
  - `disabled: '   '` (whitespace only) — handler ran: false
  - `disabled: { dialect: 'cel', source: '' }` (the empty envelope `objectstack build` can emit) — handler ran: false

  After objectui#3842 / objectui#3849 fixed the renderer halves, this was live
  user-visible behaviour: the button became clickable and clicking it returned
  `Action is disabled` — the renderer and the execution entry disagreeing about one
  predicate value, the shape objectui#3314 already paid for once.

  The gate now asks whether a `disabled` gate is DECLARED — whether there is a
  condition to reach a verdict on — before evaluating. "Nothing to evaluate" is
  read from core's single predicate normalizer (`toPredicateInput`, which maps
  `''`, `null`, an empty-`source` envelope and non-predicate values to
  `undefined`), plus the whitespace-only string, which the normalizer wraps rather
  than collapses and which `evaluateCondition` itself calls "no condition"
  (`evalRowPredicate` applies the same blank-source rule).

  **Behaviour change surface, deliberately one-directional.** Only values with
  nothing to evaluate change, and only from blocked to allowed: `''`,
  whitespace-only, an empty-`source` envelope, and non-predicate junk (`0`, `{}`,
  which previously coerced to "disabled"). `disabled: true`, a truthy expression
  and a truthy CEL envelope still block; `disabled: false` and an absent `disabled`
  still run; no expression- or envelope-valued predicate changes verdict. The
  existing `catch { isDisabled = false }` fail-open posture is untouched, and this
  change can only stop blocking things, never start.

  The value handed to the evaluator is deliberately left RAW rather than normalized
  first. `evaluateCondition(toPredicateInput(x))` is not interchangeable with
  `evaluateCondition(x)` for a string that is already a `${…}` template:
  `toPredicateInput` assumes a bare expression and wraps unconditionally, so
  `'${x}'` becomes `'${${x}}'`, fails to parse, returns verbatim, and coerces to a
  constant `true` — a template-spelled predicate evaluated that way is ALWAYS
  "disabled", whatever it says. That normalizer defect is filed as objectui#3871
  (it is live at the action renderers and `ActionEngine`, while `SchemaRenderer` and
  `page:header` evaluate the raw value and pin the correct verdict); a tripwire next
  to the new pins goes red the day it is fixed. Two rows therefore still differ
  between the execution and renderer paths, each recorded with its owning issue:
  the empty envelope (objectui#3850 owns the renderer half's scope ruling) and the
  `${…}` spelling (objectui#3871).

- 4bc6c23: Converge dashboard widget `compareTo` on the executor's `{ kind, dimension? }` contract, and make the dataset path actually render a comparison

  `CompareToConfig` was a three-branch union (`'previousPeriod' | 'previousYear' | { offset }`). `@objectstack/spec` collapsed it to the shape the analytics executor already implements — `DatasetCompareTo`, a plain strict object `{ kind: 'previousPeriod' | 'previousYear'; dimension?: string }` (objectstack#5011) — so this renderer now reads that one shape:

  - `shiftFilterByCompareTo` / `compareToTrendLabelKey` dispatch on `compareTo.kind`. The `{ offset }` duration shift is gone: `{ offset: '1y' }` is `kind: 'previousYear'`, while `'7d'` / `'1M'` have no faithful target and are restated by the author on the widget's own `filter` plus `kind: 'previousPeriod'`. No trend label key is retired — the offset arm resolved to `vsPreviousPeriod`, which survives as the `previousPeriod` fallback.
  - `DatasetWidget` no longer discards part of `compareTo`. It used to forward only the object form because the two string forms had no meaning downstream; with one shape there is nothing to discard, and a stale string is now invalid metadata rejected where it is authored rather than silently reinterpreted here.
  - **The comparison now actually runs on the dataset path.** A widget states its window in its own `filter` (a date macro, or the dashboard date-range filter merged in), but the executor shifts a `timeDimensions` entry carrying a `dateRange` — so a dataset widget asking for a comparison got "compareTo needs a dated window to shift" and rendered none. When (and only when) a comparison is requested, the resolved filter's bounded date windows are lowered into `selection.timeDimensions[].dateRange` and moved out of `runtimeFilter` (a copy left behind would intersect the shifted window with the current one and empty every comparison column). Which dimension gets shifted stays the executor's decision: every window found is lowered under the name the author wrote, and zero or two candidates surfaces the executor's own error, listing them.
  - The `<measure>__compare` columns that come back are now shown: a delta + window label on KPI widgets, a comparison column on tables, and a `variant: 'comparison'` overlay series on charts — the same treatment and the same `dashboard.trend.*` labels the inline object-provider widgets already use.

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

- ab3ad4f: An empty predicate is no longer a declared gate anywhere (objectui#3850, objectui#3862)

  "Is a gate DECLARED on this key — is there a condition to reach a verdict on?" was
  answered three times in this repo, with three different scopes, and the widest
  answers sat on `disabled`, where the mistake is not benign:

  - `hasDeclaredVisibilityGate` (the action face) asked `!= null && !== ''`, so every
    OBJECT counted — including `{ dialect: 'cel', source: '' }`. That envelope is not
    a hand-written curiosity: `@objectstack/spec`'s `ExpressionInputSchema` normalizes
    every authored predicate into one, so "the author left the predicate empty"
    compiles to exactly it. The verdict path normalized the same value back to
    `undefined`, and `evaluateCondition(undefined)` answers `true` — "no condition, so
    visible/enabled". On `visible` that `true` means SHOW, so the two mistakes
    cancelled; on `disabled` it means GREY, so they compounded: a button disabled
    forever that no author asked to disable (objectui#3850, the residue objectui#3842
    left behind).
  - `SchemaRenderer` asked `disabled !== undefined` inline, one notch wider again, so
    `disabled: null` greyed out too — on the GENERIC rendering path, since that block
    runs for every node type, and not as an internal flag either: `_disabled` is
    forwarded to the component as a real `disabled` prop (objectui#3862).
  - `ActionRunner`'s execution gates asked "does this normalize to something
    evaluable?" — the scope that turned out to be right (objectui#3848 / objectui#3872).

  There is now ONE definition, `hasDeclaredPredicate`, exported from
  `@object-ui/core` (`evaluator/declaredPredicate.ts`, beside the `toPredicateInput`
  normalizer it is derived from): a gate is declared when normalization still leaves a
  condition to evaluate. `''`, a whitespace-only string, an empty-`source` envelope
  and any non-predicate value (`0`, `{}`) are NOT declared; `false` IS (a verdict is
  not a missing gate — objectui#3812). `hasDeclaredVisibilityGate` keeps its name as a
  re-export of it, so the five member-action renderer call sites, `DeclaredActionsBar`
  and `record-quick-actions` are unchanged and inherit the scope;
  `SchemaRenderer`'s `disabled` / `disabledOn` chain and `ActionRunner`'s two gates
  read the same function. No consumer got a local "and also check for empty" test —
  that fourth dialect is what objectui#3842 / objectui#3849 spent two PRs merging away.

  Measured behaviour change, `action:button` and the generic path, before → after:

  | value                                                     | `visible`      | `disabled` | `enabled` | `SchemaRenderer` `disabled` prop |
  | --------------------------------------------------------- | -------------- | ---------- | --------- | -------------------------------- |
  | `''`                                                      | shown → shown  | on → on    | on → on   | forwarded → absent               |
  | `null`                                                    | shown → shown  | on → on    | on → on   | forwarded → absent               |
  | `{ dialect: 'cel', source: '' }`                          | shown → shown  | GREY → on  | on → on   | forwarded → absent               |
  | `{ source: '' }`                                          | shown → shown  | GREY → on  | on → on   | forwarded → absent               |
  | `'   '` (whitespace)                                      | HIDDEN → shown | on → on    | GREY → on | forwarded → absent               |
  | `0` / `{}` (not predicates)                               | shown → shown  | GREY → on  | on → on   | forwarded → absent               |
  | `true` / `false` / bare CEL / `${…}` / non-empty envelope | unchanged      | unchanged  | unchanged | unchanged                        |

  Every row moves toward "there is no gate here", never away from it, and no value
  that HAS a verdict changes it — the verdict is still read from the raw value, only
  the gate in front of it narrowed. Two rows are behaviour changes rather than the
  equivalence the ruling expected, and are pinned as such: the whitespace string moves
  on `visible` / `enabled` (it used to normalize to `'${   }'`, which evaluates falsy,
  so a predicate that says nothing HID the action from everyone), and non-predicate
  junk stops greying controls out (fail-open, the posture `ActionRunner` already
  committed to).

  One blank spelling is knowingly still outside the scope: an envelope whose `source`
  is blank but not EMPTY (`{ dialect: 'cel', source: '   ' }`) — the normalizer folds a
  `source` of `''` and does not trim, so the string spelling of a blank predicate is
  trimmed and the envelope spelling is not, and `disabled` still greys out for that one
  value. The ruling enumerated three empty spellings; this is a fourth, measured and
  filed as objectui#3960 rather than widened in here.

  One chain is deliberately untouched: `SchemaRenderer`'s `visible` / `visibleWhen` /
  `visibleOn` / `visibility` / `hidden` / `hiddenOn` legs keep `!== undefined`, because
  narrowing them would change ALIAS PRECEDENCE, not just emptiness. The `hidden` legs
  are not negated and therefore carry this same defect with the polarity that makes the
  node vanish — measured, out of this ruling's scope, filed as objectui#3955.

- c2fd122: fix(actions): forward `bodyShape` end-to-end so a declared body wrap is honoured

  Sibling of the `bodyExtra` fix, same failure shape one key over. `bodyShape` is
  the spec's body-WRAPPING declaration for a `type: 'api'` action — `'flat'` (the
  default) or `{ wrap: key }` to nest the collected params under `key`, the shape
  better-auth's `organization/update` needs. The console `apiHandler` read it
  unconditionally while **no** action renderer forwarded it, so an author who
  declared `bodyShape: { wrap: 'data' }` on an `action:button` / `:group` / `:icon`
  / `:menu` action got a FLAT body on the wire: the endpoint received the params at
  the top level, and the declaration read as honoured because it parsed and
  published.

  The four declared-action renderers now forward the key, and `ActionSchema`
  declares it (typed by derivation from the spec, so the union cannot drift).
  `ActionRunner.executeAPI` — the fallback path taken when no host registered an
  `api` handler — now reads it too, closing a second asymmetry in which the same
  action changed body shape depending on which host executed it. The wrap covers
  the collected params only; `bodyExtra` and other top-level keys stay flat, which
  is the spec's own wording for the key and what both console read-sites already
  did.

  `element:button` deliberately does **not** forward it: its whitelist mirrors
  spec's `InlineActionSchema` pick list field for field, and that pick list does
  not include `bodyShape` — it is not inline vocabulary.

- 1d723e3: fix(core): stop re-wrapping an already-`${…}` predicate, so action-face `visible` / `disabled` finally honour it (objectui#3871)

  `toPredicateInput` — the one normalizer every action surface and the action
  engine share — wrapped **every** string as `${string}`, assuming a bare
  expression. But `${…}` is a spelling this repo documents for a predicate
  (AGENTS.md §4) and one the normalizer's own output type lists as valid, so an
  already-normalized value was wrapped a second time: `'${x}'` became `'${${x}}'`,
  which cannot match the evaluator's single-template fast path and does not parse.
  The author's expression then decided nothing, and which constant came back
  depended on the caller's error policy:

  - **fail-soft** legs (every `disabled` / `enabled` leg; `visible` on
    `action:icon`, `action:group` and the related-list toolbar) got the unparsed
    string back, so `Boolean(…)` was a constant `true`: `disabled: '${…}'` greyed
    the action out permanently, `visible: '${…}'` showed one the author had gated
    away, and `enabled: '${…}'` never disabled anything.
  - **fail-closed** legs (`throwOnError: true` — `visible` on `action:button`,
    `action:bar`, `action:menu`, `DeclaredActionsBar`, and
    `ActionEngine.getActionsForLocation`) got a **throw**, which each site turns
    into "hidden": an action gated with a template predicate was invisible even
    while its gate held, and the fail-closed warning blamed the author's
    expression.

  A string that already carries `${` is now returned untouched (the same guard
  covers the envelope branch, where an unwrapped `source` reaches the identical
  wrap), which makes the normalizer idempotent. Every affected surface goes from a
  constant verdict to the predicate's real one — converging the action face with
  `SchemaRenderer` and `page:header`, which read the raw value and have always
  been right about this spelling (objectui#3314's shape). Bare expressions and
  `{ dialect: 'cel' }` envelopes are untouched.

  `ActionRunner`'s two execution gates already read the raw value and are
  unchanged; the objectui#3871 tripwires they carried have been replaced by pins
  of the now-converged behaviour.

  Whether `${…}` should be _authorable_ on an action predicate at all is a
  separate, spec-side question (`@objectstack/spec`'s `PredicateInput` models a
  bare string and a dialect envelope): if it is to be rejected, that belongs in
  publish-time validation, not in a consumer that silently invents a verdict.

- 0109f54: Blank predicates and non-predicate values are no longer gates, at the last three entries that still judged them (objectui#3955, objectui#3957, objectui#3960)

  objectui#3850 sank "is a predicate gate DECLARED here?" into one definition,
  `@object-ui/core`'s `hasDeclaredPredicate`. Three places were left out of that
  ruling's placement clause, each with the same shape of defect: the evaluator's
  single default for "there is nothing here to evaluate" is `true`, meaning
  _visible/enabled_, and wherever a too-wide "declared" test hands it an empty
  predicate on an INVERTED key, that `true` turns a control off for a value the
  metadata never used to say anything.

  **`SchemaRenderer`'s `hidden` / `hiddenOn` legs (objectui#3955)** asked
  `!== undefined` and did NOT negate the verdict, so an empty predicate meant HIDE
  and the node disappeared — on the generic rendering path, since that block runs
  for every schema type. Harder to diagnose than the `disabled` twin objectui#3862
  fixed: a greyed-out control is still on screen, while a node that never rendered
  is indistinguishable from metadata that meant to hide it. Both legs now read the
  shared definition.

  **The "blank" criterion now covers the envelope spelling (objectui#3960).** The
  definition trimmed a whitespace-only STRING and not an envelope's whitespace-only
  `source`, because `toPredicateInput` folds a `source` of `''` and does not trim.
  So `{ dialect: 'cel', source: '   ' }` was a declared gate whose verdict came from
  core's own CEL entry calling that exact value "no predicate" (`if (!source.trim())
return true`) — `disabled` greyed out forever and `ActionRunner.execute` answered
  `{ success: false, error: 'Action is disabled' }` with the handler never invoked.
  Blankness is now decided once for both spellings, at the definition. The
  NORMALIZER's contract is deliberately unchanged: "what shape does the evaluator
  accept" is not the same question as "is there a condition", and moving the trim
  there would have flipped verdicts for every
  `useCondition(toPredicateInput(…))` call site, including container-level `visible`
  reads that never asked this question at all.

  **`ActionEngine.getActionsForLocation`'s `visible` filter (objectui#3957)** was the
  last consumer answering the question with a range of its own — three empty
  spellings folded by hand, everything else coerced with `Boolean(raw)`. It now reads
  the shared definition and the coercion branch is gone, so one value no longer gets
  two answers depending on whether an action was surfaced by the engine or rendered
  standalone (the invariant objectui#3314 established). Its fail-CLOSED posture on a
  predicate that THROWS is untouched (`throwOnError: true` + `warnHiddenPredicate`):
  "the predicate faulted" and "there is no predicate" are different facts.

  Behaviour changes, before → after. Observation-class: each needs an author to write
  an empty/blank predicate or a non-predicate value, and there is no known user path
  today.

  | value                                                       | `ActionEngine` `visible` | `SchemaRenderer` `hidden` | `disabled` (action face + generic path) | `ActionRunner.execute` `disabled` |
  | ----------------------------------------------------------- | ------------------------ | ------------------------- | --------------------------------------- | --------------------------------- |
  | `''` / `null`                                               | shown → shown            | HIDDEN → rendered         | unchanged                               | unchanged                         |
  | `'   '` (blank text)                                        | HIDDEN → shown           | HIDDEN → rendered         | unchanged                               | unchanged                         |
  | `0` / `NaN`                                                 | HIDDEN → shown           | HIDDEN → rendered         | unchanged                               | unchanged                         |
  | `{}` / `[]`                                                 | shown → shown            | HIDDEN → rendered         | unchanged                               | unchanged                         |
  | `{ dialect: 'cel', source: '' }`                            | shown → shown            | HIDDEN → rendered         | unchanged                               | unchanged                         |
  | `{ dialect: 'cel', source: '   ' }`                         | shown → shown            | HIDDEN → rendered         | GREY → on                               | refused → runs                    |
  | `{ source: '   ' }` (no dialect)                            | HIDDEN → shown           | HIDDEN → rendered         | GREY → on                               | refused → runs                    |
  | `true` / `false` / bare CEL / `${…}` / a non-blank envelope | unchanged                | unchanged                 | unchanged                               | unchanged                         |

  Every row moves toward "there is no gate here", never away from it, and no value
  that HAS a verdict changes it — a declared `false` is still a verdict, not a
  missing gate (objectui#3812), and blankness is `trim()`, not "short": `{ dialect:
'cel', source: ' x ' }` is a predicate. One alias precedence changes with the
  `hidden` legs and is pinned rather than claimed as an equivalence: an undeclared
  `hidden` no longer short-circuits the chain, so a declared `hiddenOn` is finally
  consulted.

  `SchemaRenderer`'s four `visible*` legs keep `!== undefined` deliberately, as
  objectui#3850 ruled: their `true` is negated, so an empty predicate already lands
  on "shown", and narrowing them would change alias precedence rather than fix
  anything.

- 7e5bb5d: fix(actions): forward `bodyExtra` end-to-end through the action chain

  An action's static request body (`bodyExtra`) was dropped one hop before the
  `ActionRunner`: every action renderer forwards an explicit whitelist of keys, and
  none of them listed `bodyExtra`. Since `@objectstack/spec` 17 made it the only way
  a `type: 'api'` action can carry a payload (`params` keeps its single meaning as
  the parameter definition array), and the ADR-0087
  `inline-action-api-params-to-body-extra` conversion rewrites older object-form
  `params` pages onto it at load, a previously-working published page validated,
  published and then POSTed an empty body.

  `element:button`, `action:button`, `action:group`, `action:icon` and `action:menu`
  now forward the key; `ActionRunner.executeAPI` merges it into the request body
  **last** (so a constant always overrides a same-named user param, matching the
  console `apiHandler`); `ActionSchema` declares it; and a non-array `params` on a
  `type: 'api'` action keeps working for one version window with a dev-mode
  deprecation warning naming `bodyExtra`.

- fbc23e0: Action params that inherit a field's options now keep the keys that field declared

  A field-backed action param (`{ field: 'tier' }`) had its inherited option list
  rebuilt entry by entry as `{ label, value }`, which silently dropped every other
  key the field's options declared — most consequentially the per-option
  `visibleWhen` predicate (ADR-0058). A select field whose options narrow by
  predicate in an object form therefore offered the FULL list in an action dialog,
  including the entries the predicate exists to hide, with no diagnostic on either
  side; `color` / `icon` / `disabled` were lost the same way. Options authored
  inline on the param were never affected — they always passed through verbatim,
  which is the asymmetry this restores.

  The resolver now preserves each inherited entry and only does its two real jobs:
  expanding bare strings into label/value pairs and translating the label through
  `fieldOptionLabel`. The option widgets already filter on `visibleWhen`, so a
  role-gated option (`'admin' in current_user.positions`) inherited by a dialog
  param now narrows the offered set and clears a seeded value the predicate hides.

  `ActionParamDef.options` (`@object-ui/core`) and the resolver's `RawActionParam`
  are widened to match: `ActionParamOption` names the two keys the param layer
  reads and carries the rest of a field's option vocabulary through.

- 6bb454a: `evalRowPredicate`: the fail-closed report now names the engine's failure reason, and the ROW always wins over host scope (objectui#3792, objectui#3796)

  Two defects in one function, `packages/core/src/evaluator/listConditional.ts`,
  shared by every surface that gates on a row predicate: the row kebab, the bulk
  selection bar, kanban conditional formatting, and — since objectui#3521 — the
  record page header.

  **The safest path said the least (objectui#3792).** `evalRowPredicate` has two
  diagnostic routes, and their information content was inverted. The single-eval
  fast route lets the canonical helper warn, so it prints the engine's own reason
  (`Reason: [runtime] No such key: owner_id`). The `warnOnError: true` route — the
  fail-CLOSED one, taken by every caller that makes a button disappear — runs
  `evalFieldPredicate` twice with `{ warn: false }` to tell a fault from a genuine
  `false`, and that silence discarded the reason along with the duplicate warning.
  So the more decisively a surface hid a control, the less it said about why: the
  console line named the predicate but not the defect, and `No such key: owner_id`
  or `no such overload: string == null` is usually the whole answer.

  `FieldPredicateDiagnostic` gains an optional `onFault(reason)` passback:
  `evalFieldPredicate` hands out the engine's verbatim text (kind tag, message and
  source excerpt — the exact string it prints after `Reason:`) even when its own
  warning is suppressed. It fires per fault, deliberately independent of the
  once-per-predicate warning dedupe, so a caller doing its own warn-once
  bookkeeping keeps control of it; the verdict is unaffected, and callers that pass
  nothing are unchanged. `evalRowPredicate` threads that reason into its labelled
  warning, and the legacy-dialect route does the same with the message its engine
  throws (`Reason: [legacy] …`), so both dialect paths report a fault the same way.
  Warn-once semantics are unchanged — the reason is deliberately not part of the
  dedupe key.

  **Wording: not a list function, and not for a long time.** The same message
  called every caller a "**list** conditional predicate". A hidden button on a
  record page header reporting "a list conditional predicate" sends its author to
  the list view to look for a control that was never there. Both messages this
  module emits (evaluation failure and the legacy-dialect deprecation) now read
  "conditional predicate".

  **The row is the subject — on both dialect paths (objectui#3796).** The scope
  merge pinned `data` after the host-scope spread but not `record`, leaving
  `record` to each engine's own binding — and the two engines disagreed. The legacy
  evaluator re-pinned `record` to the row (row won); the CEL engine takes its
  `extra` bag over its `record` binding, so a host scope carrying a `record` key
  won there instead. One function, one predicate text, two subjects — selected by
  whether the string happens to contain `===` or `${…}`, the dialect-routing
  markers, which no author picks deliberately. `record` is now pinned after the
  spread exactly as `data` is, which fixes both paths at the merge site rather than
  relying on either engine's precedence.

  No host injects a `record` key today — `ExpressionProvider` binds
  `current_user` / `user` / `ctx` / `os` / `app` / `data` / `features` — so nothing
  observable changes for existing apps; this closes the edge before a host adds one
  (`ctx.record` already exists, which is exactly how it would arrive). A row FIELD
  named `record` is likewise no longer able to become the row root; it stays
  addressable as `data.record`.

  Shipped as a patch: no new exported symbol, one optional field added to an
  already-exported options interface, and no existing call signature changed.

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

- Updated dependencies [d229dfa]
- Updated dependencies [c2fd122]
- Updated dependencies [48132f7]
- Updated dependencies [7e5bb5d]
- Updated dependencies [e6fdbdc]
- Updated dependencies [7e2b7e9]
- Updated dependencies [c1e1e6b]
  - @object-ui/types@17.4.0

## 17.3.0

### Minor Changes

- 5781fb1: `@object-ui/core` now ships the server-action dispatcher factory —
  `createServerActionHandler({ fetch, baseUrl, resolveObject, ... })` — so any
  consumer of the runner (standalone renderers, SDUI hosts, embedded usage) can
  run `action.body` script actions by registering the produced handler, instead
  of dead-ending on the built-in `executeScript`'s "must be executed server-side"
  error with no supported way to make it run (objectui#2904, the follow-up
  objectui#2896 deferred).

  The factory is deliberately opinion-free about the three things core has no
  business deciding — auth (`fetch` is an injected authenticated wrapper), origin
  (`baseUrl` string or thunk; no bundler env convention), and fallback object
  scope (`resolveObject`) — and owns everything protocol-shaped, once:

  - name-based action identity (ADR-0110 D1 — `target` is a binding expression,
    never an identity);
  - the record-id resolution dance, also exported as
    `resolveServerActionRecordId` (`_rowRecord`, `recordIdField`, toolbar
    selection fallback with its single/zero-select guards, aggregate
    `_selectedIds` bypass), replaceable wholesale via `resolveRecordId` for
    hosts with their own policy (record pages);
  - a re-entrancy guard per action+record;
  - the `/actions` response-envelope rule: `interpretActionResponse`,
    `readActionPayload` and `actionErrorDetail` moved from `@object-ui/app-shell`
    internals into core and are now public exports.

  `@object-ui/app-shell`'s two hand-rolled copies of this POST —
  `useConsoleActionRuntime.serverActionHandler` and `RecordDetailView`'s — are
  collapsed into one console wrapper (`createConsoleServerActionHandler`) that
  layers the browser-only choreography (popup pre-open dance, zero-roundtrip
  `newTabUrl` fast path, `redirectUrl` convention) over the core factory. The
  copies had already drifted twice (objectstack#3913 — envelope; framework#3935 —
  identity, fixed in one copy only): RecordDetailView now also dispatches by
  declarative `name` instead of `target || name`, and no longer leaks the
  client-side `_rowRecord` stash to the server.

- f833d3a: Retire `validation` from the action-param contract — it was declared on both
  halves, read by neither, and rejected outright by the server (objectui#3201).

  FROM: `validation?: string` was declared on the AUTHORING type
  (`@object-ui/types`' `ActionParam`) and on the RESOLVED type (`@object-ui/core`'s
  `ActionParamDef`). TO: it is declared on neither.

  **Breaking for anyone who declared it — but it never did anything.** This is
  marked `minor`, not `major`, per the repo's version-alignment policy (objectui's
  major tracks `@objectstack`'s, so objectui's own breaking changes ship as `minor`
  with the breaking semantics spelled out here).

  **Migration: delete it.** If you authored `validation: '...'` on an action param,
  it never took effect, and publishing that metadata to the server is a hard parse
  failure — so any metadata that reached production either never carried the key or
  never parsed. Removing it changes no runtime behaviour; it only moves the error
  from "silent no-op, then rejected at publish" to a `tsc` error at the keystroke.

  Why it could not work as authored:

  - `ActionParamSchema` in `@objectstack/spec/ui` is `.strict()` and does not list
    `validation`, so an authored key is a PARSE REJECTION on the server:
    `Unrecognized key(s) on this action param: \`validation\``. Meanwhile `tsc`
    against the public type accepted it — the type vouched for a key the platform
    itself refuses.
  - Nothing read it on the resolved side either: it was never a key of
    `resolveActionParams()`'s `RawActionParam`, the runtime field metadata a
    field-backed param inherits from carries no `validation` to source one from,
    and `paramToField()` never mapped it — so it could not reach the field widgets,
    whose rules `buildValidationRules()` builds from `required` / `minLength` /
    `maxLength` / `pattern`.

  Removed rather than implemented, on ADR-0049 enforce-or-remove. Giving it meaning
  would mean first deciding what an "expression" is here (CEL? a formula? a regex?)
  and adding it to `@objectstack/spec`, which is where such a capability has to
  start — not accreted renderer-side around a key the contract does not have.

  This also retires the last named exception in objectui#3174's drift guard
  (`packages/types/src/__tests__/page-nav-misc-spec-parity.test.ts`), which carried
  `validation` as the one key `ActionParam` added on top of the spec's set. The
  rule it pins — **the authoring type declares exactly the spec's authorable
  keys** — is now literal: the guard asserts the local-only key set is empty, so
  any future addition fails the build instead of being waved through.

- d22ae31: Track `@objectstack/spec` 17.0.0-rc.2 (objectui#3235, #3208, #3287, #3264).

  The pin moves from `^17.0.0-rc.1` to `^17.0.0-rc.2` across the workspace, and
  the sibling `@objectstack/*` packages (`client` / `core` / `formula` / `lint`)
  move with it — they pin `@objectstack/spec` **exactly**, so leaving them behind
  kept a second copy of the spec in the tree and would have had `@objectstack/lint`
  validating against rc.1 schemas that still accept keys rc.2 retires.

  Breaking semantics, in FROM → TO form:

  - **`app.homePageId` is retired — an app's landing page is now its first
    navigation item.** An app that pinned a landing page with `homePageId` will
    open on the first reachable navigation entry (by `order`) instead; the root
    landing still follows `isDefault`. To restore a specific landing page, reorder
    `navigation` so the intended entry comes first. Stored metadata is migrated by
    `os migrate meta --from 16`. The key is a hard error now, not a stripped one:
    the spec ships a tombstone that names the migration.
    Upstream retired it because of its SHAPE, not its usage — it was an ID
    cross-reference with no referential integrity, so a `homePageId` that pointed
    at nothing silently fell back to the first navigation item anyway
    (objectstack#4667, premise corrected in #4709). If the capability returns, it
    returns as a flag on the navigation item itself, which cannot dangle.
  - **`@object-ui/types`' `HttpMethod` now resolves to the spec's
    `HttpMethodType`.** Shape is verbatim identical — the same 5-value UI subset —
    and `@object-ui/types` still exports it as `HttpMethod`, so no consumer
    changes. The spec renamed its `./ui` export because `HttpMethod` named two
    different types depending on the import path (`./shared` / `./api` carry a
    7-value enum including `HEAD` / `OPTIONS`); objectui deliberately keeps the
    5-value one (objectstack#4691).
  - **`AppContextSelector.includeAll` / `placement` are gone.** Neither ever did
    anything in this renderer: context selectors are mandatory-scope, so no "All"
    row was ever rendered, and `placement: 'topbar'` put nothing in the topbar.
    Both carried schema defaults, which is why the liveness lint structurally
    could not flag them — removal was the only channel that reaches an author
    (framework#4509).
  - **`NavigationArea.visible` / `order` / `requiredPermissions` are gone.** An
    area is a layout grouping, not an access boundary. Gating moved down to the
    navigation ITEM, where `visible` and `requiredPermissions` are unchanged and
    still enforced. `AppSchemaRenderer`'s area switcher no longer hides an area, so
    an area whose items are all gated away renders as visible-but-empty rather
    than disappearing.
  - **`@object-ui/core` no longer exports `NotificationProtocol`**
    (`resolveNotificationConfig`, `specNotificationToToast`, `mapSeverityToVariant`,
    `mapPosition`, `ToastNotification`). It bridged `@objectstack/spec/ui`'s
    `Notification` / `NotificationConfig`, which objectstack#4610 deleted with no
    successor. Use `resolveNotificationConfig` from `@object-ui/react`
    (`NotificationContext`), which owns the live `NotificationSystemConfig` and is
    what every notification surface already read. Note that the spec's _other_
    `Notification` — `@objectstack/spec/api` — is the REST inbox row, a different
    contract, and is deliberately NOT aliased in as a replacement.
  - **The `email_template` client-side validator now uses
    `EmailTemplateDefinitionSchema`.** It was pointing at the removed
    `EmailTemplateSchema`, so authored templates were being checked against the
    wrong contract: the live one is keyed `name` + `locale` (not `id`) and splits
    the body into `bodyHtml` / `bodyText` (not `body` + `bodyType`)
    (objectstack#4616 / #4807).

  Fixes that are not breaking, but were only found because rc.2 stopped being
  lenient — each had been passing vacuously:

  - **`view` drafts are actually validated now.** The client validator named the
    aggregated container schema while this admin authors first-class `ViewItem`s,
    and the container used to strip `viewKind` / `config` in silence — so no view
    draft ever had one of its own keys checked. It now validates each shape
    against its own schema (objectui#3312).
  - **The console's worked examples were wrong**, and being stripped rather than
    refused: `view.list.object` (the container root already declares it),
    `job.concurrency` / `job.timeoutMs` (no such keys; the spelling is `timeout`,
    already in ms), `email_template.from` / `.to` (a template is not a send —
    the sender override is `fromOverride`, an object), and
    `datasource.capabilities` / `.healthCheck` (objectstack#4583 removed the
    former; the latter was never a datasource key). These are the drafts an
    author — or a model generating metadata — copies.
  - Action key inventory re-derived: `ActionSchema` gained the package-lock
    envelope (`_lock*` / `_package*` / `_provenance`), so a packaged action no
    longer reports them as unknown keys.
  - The schema-diff panel labels the new `default_mismatch` finding.
  - Test fixtures pinning the retired `managedBy: 'system'` bucket now use
    `engine-owned`. Protocol 17 split that value (objectstack#3355), so it
    resolved to the default-writable fallback and a batch of "stays locked"
    assertions had quietly stopped asserting anything.

### Patch Changes

- 18cd432: `ActionEngine.getActionsForLocation` now evaluates a `{ dialect: 'cel', source }` action `visible` predicate on the canonical `@objectstack/formula` engine instead of the legacy JS evaluator. The method used to unwrap the envelope into a `${source}` string before calling `evaluateCondition`, which only routes to the CEL engine while its argument is still an envelope — so the engine silently demoted every CEL predicate to the legacy path while every action renderer (`action-button`, `action-menu`, `action-bar`, … via `toPredicateInput`) ran the same predicate on CEL (#2661). Because `ExpressionInputSchema` normalizes even a bare authored string into a CEL envelope, that was the common case, and the two engines disagree: `null < null` faults in CEL (fail-closed hide) but is `false` in JS, and CEL-only builtins such as `today()` do not exist on the JS path at all — so one `visible:` predicate could hide a button in the renderer while the engine kept it (or the reverse). Normalization now goes through a shared `toPredicateInput` helper exported from `@object-ui/core`, pinned to the renderer-side twin by a parity suite. Bare strings, non-`cel` dialects, empty `source`, and boolean predicates all behave exactly as before (#3314).
- d915c47: Relation fields (`lookup` / `master_detail` / `user` / `tree`) are now usable in action and conditional-formatting predicates: they bind as the stored foreign key on every surface, and the fields a predicate reads are included in the query projection (#3501).

  Before this, one predicate over one relation field had four different fates, decided by things its author does not control. `$expand` **replaces** the id in place with the whole related record, and a view expands exactly the relations it shows as COLUMNS — so `record.owner == "U1"` was **true** where the column was absent, **false** where it was displayed, and a **fault** where the field was neither displayed nor projected (a list's `$select` was built from its columns alone, and CEL treats an absent key as a fault, not as null). A fault is fail-CLOSED on the row kebab and the selection bar and fail-OPEN on the lenient paths, so the same authoring mistake hid the button from everyone on one surface and showed it to everyone on the next, with nothing on screen to point at either. The server, meanwhile, only ever sees the id — so client and server could not agree, which is the one thing ADR-0036 / ADR-0058 exist to guarantee.

  Two changes close it. `toPredicateRecord` (new, `@object-ui/core`) collapses expanded relation values back to their ids when a record is bound for evaluation — driven by the object's own field types, not by sniffing for an `id` key, so a `json` field that happens to carry one is untouched. It is threaded through `evalRowPredicate` / `resolveConditionalFormatting` (via a new `fields` option), `useRowPredicate`, `partitionBulkRows`, and both `page:header` evaluators, with the object schema supplied by `ObjectGrid` / `ListView` / `ObjectKanban` / the record context. Kanban card formatting is threaded the same way, so a rule cannot match on the grid view of a list and silently never match on its board. Display is unaffected — a detail-page title still renders the related record's name, and the schema-only `kanban-ui` entry point (which has no object schema to offer) keeps using the payload verbatim. `collectPredicateFieldRefs` / `listViewPredicates` (new) harvest the `record.x` / `data.x` references out of a view's conditional formatting, row-action defs, bulk-action defs, promoted object actions and `userActions` overrides, and add them to `$select` — intersected with the object's declared fields plus the platform columns every object carries (`isProjectableField`), because an unknown key is not ignored by every backend. No `$expand` is added: a predicate wants the foreign key, which is what an unexpanded relation already is.

- 509104a: Fix matrix report cells showing another bucket's numbers when dimension values run together.

  The cross-tab in `DatasetReportRenderer` built its bucket ids by joining dimension values with the EMPTY string, so adjacent values had no boundary at all: `"x"` + `"yz"` and `"xy"` + `"z"` were the same bucket on both axes, and the later row silently overwrote the earlier one. Its cell key then joined the two bucket ids with a plain space, while dimension values contain spaces constantly ("New York", "In Progress"), so `"New"` × `"York Q1"` and `"New York"` × `"Q1"` also met in one key. A merged bucket showed a different row's measure, the overwritten row's value was unreachable, the per-row and per-column subtotals matched the wrong header, and drill-through followed the same wrong index into another record's list — none of it with an error.

  Bucket ids and cell keys are now encoded with `JSON.stringify`, which carries the boundary in its own quoting rather than in a character the data is assumed never to contain. All four lookups in the renderer (row headers, column headers, row subtotals, column subtotals) share the one encoder, so they agree by construction.

  The encoders moved to `@object-ui/core` as `pivotBucketId` / `pivotCellKey` and are now shared with the dashboard `DatasetWidget`, which carried the same defect and fixed it separately: two packages each hand-rolling the same key is why one fix left the other broken. The dashboard keeps its existing exports and behaviour.

- a4cff5b: Conditional-rule predicates that fail to evaluate are no longer silent
  (objectstack#5149, appeal 2). `evalFieldPredicate` — the canonical funnel for
  `visibleWhen` / `readonlyWhen` / `requiredWhen`, view-level `visibleOn`, legacy
  `condition`, per-option `visibleWhen`, screen-field predicates and list
  conditional formatting — now logs **one `console.warn` per predicate text**
  when evaluation fails (parse error, unbound identifier, engine fault), carrying
  the predicate source, the engine's failure reason, and the field/rule locator
  the call site provides. Renderer call sites thread that locator
  (`visibleWhen of field 'amount'`), so a broken predicate identifies itself in
  the browser console instead of being indistinguishable from an absent one.

  Verdicts are unchanged: evaluation still fails open to the caller's safe
  default (flipping that default is objectstack#5149 appeal 1, tracked
  separately). Fault-probing callers (`evalRowPredicate`'s fail-closed path,
  `ExpressionEvaluator`'s `throwOnError`) opt out via the new
  `diagnostic.warn: false` and keep their own single diagnostic, so no broken
  predicate ever warns twice.

- 2a9513d: `toFilterNode` now lowers a spec `ViewFilterRule[]` into ObjectQL AST nodes instead of returning the array verbatim, so a saved view's stored filter reaches `$filter` as something the server accepts. It previously did not: `ListViewSchema.filter` / `ViewTab.filter` are declared `z.array(ViewFilterRuleSchema)`, and the whole read path — `ObjectView` → `ListViewSchema.filter` → `buildEffectiveFilter` → `mergeFilterNodes` → `toFilterNode` — carried those rule objects untouched into the query. `isFilterAST` is `false` for an array of objects, so the data API answered `400 INVALID_FILTER` and the list rendered no rows at all. Measured against a real backend on the showcase's shipped `showcase_task.in_progress` view: `$filter=[{"field":"status","operator":"equals","value":"in_progress"}]` returned `400`, while the lowered `[["status","equals","in_progress"]]` returned its 2 rows. Every saved view carrying a filter was affected, on both producers that share this sink — `plugin-list`'s `buildEffectiveFilter` (the grid and its export) and `plugin-view`'s `ObjectView` (calendar / kanban / gallery / timeline).

  Operators are canonicalised through the spec's own `normalizeFilterOperator`, the same exit the write side (`viewFilterFold`) uses, so the two directions cannot drift into two dialects; no second operator table is introduced. An operator the spec does not know is passed through verbatim so the server still refuses it loudly rather than having a misspelling coerced into a valid filter. AST nodes and MongoDB-style object filters are unaffected, mixed arrays (a view's rules concatenated with `?filter[<field>]=<value>` URL triples) fold element-wise with the triples untouched, and a rule with a blank `field` is deliberately left unlowered — `["", op, value]` passes `isFilterAST` and returns an empty list, whereas the unlowered rule keeps the loud `400`.

- Updated dependencies [d915c47]
- Updated dependencies [9e9e9a9]
- Updated dependencies [23018cc]
- Updated dependencies [f44d872]
- Updated dependencies [f833d3a]
- Updated dependencies [d22ae31]
  - @object-ui/types@17.3.0

## 17.2.0

### Minor Changes

- bca45cc: Declare the 18 spec-owned action keys `ActionDef` had been absorbing silently.

  `ActionDef` ends with `[key: string]: any`, so it accepted any key of any type —
  a typo (`targt`) and a retired spec key (`execute`) both type-checked, then the
  runner silently bound no handler (the #2169 "Mark Done does nothing" shape).
  Step 1 (objectstack#4075) made that audible with a dev-mode warning. This is
  step 2: the keys the warning identified as legitimate are now real fields.

  - **18 keys promoted to explicit optional fields** — `ai`, `aria`, `bodyExtra`,
    `bodyShape`, `bulkEnabled`, `component`, `icon`, `locations`, `mode`,
    `objectName`, `order`, `recordIdField`, `recordIdParam`, `requiredPermissions`,
    `requiresFeature`, `shortcut`, `variant`, `visible`. Every type is **derived**
    from `@objectstack/spec`'s `ActionInput` (`SpecActionInput['locations']`, …),
    never hand-copied: a hand-written duplicate of a spec shape is a second
    contract that drifts, which is the failure this issue is about. Wrong-typed
    values are now compile errors — `order: 'first'`, `variant: 'chartreuse'`,
    `locations: ['nope']` — where before they were absorbed silently.
  - **Derived from `z.input`, not `z.infer`.** `ActionSchema` is a `ZodPipe` whose
    transform narrows `visible` from `string | { dialect, source }` to the
    envelope alone. This runner consumes authored/stored rows, which are
    rehydrated unparsed, so it sees the input shape; deriving from the inferred
    `Action` would have rejected the raw-string predicate `ActionEngine`
    explicitly supports.
  - **Three `as any` casts deleted** in `ActionEngine` — `visible` and
    `requiredPermissions` at the location filter, `locations` at registration.
    They existed only because the fields were undeclared.
  - **Four objectui-dialect keys marked `@deprecated`** with the spec spelling to
    use instead — `actionType` (→ `type`), `api` and `endpoint` (→ `target`;
    `executeAPI` already resolves `api || endpoint || target`), and `navigate`
    (→ flat `target` / `openIn`). Only these four: the remaining dialect keys are
    runner mechanics (chaining, toasts, post-execution reload/close) with no spec
    counterpart, and pointing them at a spelling that does not exist would be
    worse than leaving them declared.

  **Breaking edge, deliberate.** `shortcut` and `bulkEnabled` were retired by
  `@objectstack/spec` 17 as `retiredKey()` tombstones (`z.never()`), so authoring
  either is already a hard parse rejection. Deriving their types rather than
  hand-writing them turns that runtime rejection into a **compile error**: code
  that assigned `shortcut: 'ctrl+k'` to an `ActionDef` compiled before and does
  not now. Such metadata was already refused by the platform — this only moves the
  failure to where it can be fixed. A host may still pass either explicitly via
  `ActionEngine.registerAction(action, { shortcut, bulkEnabled })`; only authored
  metadata stopped carrying them. `bulkEnabled`'s replacement is the list view's
  `bulkActions` / `bulkActionDefs`; `shortcut` has none.

  The index signature **stays** — removing it is step 3, and the inverted pin
  asserting it is still present remains the issue's own completion check.

- 4bf612c: Aggregate single-call mode for bulk actions: `execution: 'aggregate'` (objectui#3139).

  A `bulkActionDefs` entry with `operation: 'custom'` used to have exactly one
  dispatch shape: one action-runner call per selected record (`_rowRecord`
  attached). "Select N rows → ONE call that receives every selected id" — the
  zip-of-QR-codes / merged-PDF / batch-print shape — could not be expressed, so
  downstream projects fell back to per-row `window.open` storms or gave up.

  `BulkActionDef` now carries `execution?: 'perRecord' | 'aggregate'` (default
  `'perRecord'`, existing views untouched). An aggregate def dispatches its
  action exactly once for the whole selection with `params._selectedIds:
string[]` injected and the full records published as
  `context.selectedRecords`. The authored form usually just names a declared
  object action — `{ name, operation: 'custom', execution: 'aggregate' }` —
  and `resolveBulkActions` attaches the declaration. Results are
  all-or-nothing: a failure is attributed to every id with the real error and
  per-row Retry is hidden (re-running the action is the retry; a total failure
  keeps the selection). `batchSize` does not apply; `maxRecords` still gates.

  The executor rides the existing `executeBulkBatch` bulk-first decision tree —
  the aggregate call is its `bulkCall`, and the per-row "fallback" only
  re-throws the captured error for attribution, never fans out N dispatches
  against an endpoint written for one `_selectedIds` call.

  Also: url/api target interpolation now exposes `${ctx.selection.ids}` (comma
  -joined) and `${ctx.selection.count}` from the grid's checkbox selection, so
  a plain `list_toolbar` action can carry the selection without bulk plumbing;
  the console's server-action handler recognizes `_selectedIds` and skips the
  single-record multi-select guard for aggregate dispatches.

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

- b414983: fix(dashboard): a date globalFilter's preset-name default becomes a range, not an equality

  Setup → System Overview rendered EVERY KPI tile as 0 while its period selector
  read "All time" (objectstack#4475). Every request was `200 OK`, the widgets
  rendered normally, and nothing in the UI signalled a failure — zeros read as
  "nothing has happened yet" rather than as an error, which is why this survived
  to an RC.

  Both symptoms are one missing normalization. `resolveDashboardFilterDefs` lifts
  the built-in `dateRange` declaration's preset NAME to `{ preset }`, but passed a
  `globalFilters` entry's `defaultValue` through raw. `@objectstack/spec`'s
  `GlobalFilterSchema.defaultValue` is `string | number | boolean`, so a bare
  preset name is the ONLY spelling an author can write — and nothing ever mapped
  it. System Overview declares
  `{ field: 'created_at', type: 'date', defaultValue: 'last_7_days' }`, so:

  - `buildFilterCondition` fell through to its "a bare string date means equality
    on that day" branch and the widget sent
    `runtimeFilter: { created_at: 'last_7_days' }`. The backend compiled
    `SELECT COUNT(*) AS "user_count" FROM "sys_user" WHERE created_at = $1`
    — verified against a live server, byte-for-byte the SQL in the issue. The
    actual `sys_user` count is 4; that equality matches no row.
  - `DateRangeFilter` derives its selected item from `value.preset` / `.from` /
    `.to`, all `undefined` on a bare string, so the control fell through to its
    ALL sentinel and displayed "All time" while sending that equality. The tiles
    therefore looked deliberately unfiltered and merely empty.

  `normalizeDateDefault` now applies the same lift the sibling `dateRange`
  declaration already receives, for `date`/`dateRange` filters whose default names
  a preset this module actually knows. This is not consumer-side leniency: it is
  one normalization function completing the same conversion for the sibling
  declaration, and the spec admits no other spelling for an author to fix at the
  producer. A genuine ISO date string still means equality on that day (the
  documented behaviour), and numbers, booleans and unrecognised strings are left
  exactly as declared.

  No backend change is needed: given a real range the dataset path already lowers
  it correctly (`WHERE (created_at >= $1 AND created_at < $2)` → 4). The
  framework's dashboard metadata needs none either — it is spec-compliant as
  written, and editing it would only hide the defect.

  Levelled `minor` rather than `patch` because the change is visible in rendered
  dashboards rather than internal: any dashboard declaring a date-typed
  `globalFilters` default now emits a different query shape, its numbers change
  (from 0 to real values), and its filter control's displayed label changes with
  them. Anything asserting on the previously-emitted condition will see it move.

  Known residual, filed separately rather than widened into here: a `date` filter
  whose value is neither a known preset nor a parseable ISO date still degrades
  silently to an equality that matches nothing, producing the same
  healthy-looking zero. Preset names are covered by this change; a misspelled
  custom value is not.

- 256f8cc: fix(dashboard): an unrecognised date filter value is skipped and named, not compared

  The residual the preset-name fix (objectui#3150 / objectstack#4475) left behind,
  and the more deceptive half of it: a `date`/`dateRange` filter value that is
  neither a known preset name nor a parseable date used to fall through to the
  "a bare string date means equality on that day" branch. A misspelled default —
  `defaultValue: 'last_7_dayz'` — therefore reached the widget query as
  `runtimeFilter: { created_at: 'last_7_dayz' }`, which the backend faithfully
  compiled to `WHERE created_at = $1`. `200 OK`, widget renders, count is 0 —
  indistinguishable from "this range genuinely has no data". No 4xx, no console
  warning, no UI signal. objectstack#4475 took a full RC cycle to catch for
  exactly this reason: **0 looks like a legitimate answer**.

  `buildFilterCondition` now holds a date value to three spellings, and only
  three:

  1. a known preset name → range bounds (unchanged, objectui#3150);
  2. an ISO date (`2026-01-15`, `2026-01-15T08:30:00Z`) or a date-macro token
     (`{today}`, `{7_days_ago}`) → equality on that day (the documented
     behaviour, unchanged);
  3. **anything else → the filter is skipped and `console.warn` names the filter,
     the offending value, and the accepted spellings.**

  The `{ preset: '<unknown>' }` object form gets the same voice. It already
  dropped the filter — silently — because the preset lookup missed and no
  `from`/`to` remained; that drop is now announced. When explicit bounds ride
  along with an unknown preset the bounds are still honoured, and the warning says
  which of the two won.

  Rule 3 is deliberately the same strictness `buildWidgetScopedFilter` already
  applies to a _default binding on a field the object does not have_ — skip and
  warn, with the same rationale spelled out there: never emit a query the backend
  can only empty-match. Field _names_ had that guard; field _values_ did not.

  The macro-token check asks `resolveDateMacros` itself whether it recognises the
  string, rather than restating its token grammar in a second place. One
  vocabulary, no dialect to drift — and a token that resolver does not know
  (`{last_7_dayz}`) is precisely the typo this guard exists to catch.

  Levelled `minor`, matching objectui#3150, because the emitted query shape
  changes: a dashboard carrying a misspelled date value stops sending a
  never-matching equality and instead sends no constraint for that filter (its
  numbers go from 0 to unfiltered) while the console says why. Anything asserting
  on the previously-emitted equality will see it disappear.

  Note the direction of the relaxation is chosen, not incidental: skipping widens
  the result set, so the number visibly changes and the warning explains it —
  whereas the old behaviour narrowed it to zero, which is the one outcome an
  author cannot tell from a correct answer. Author-time rejection (validating
  `GlobalFilterSchema.defaultValue` at publish, in `@objectstack/spec`) is the
  stricter complement and belongs on the platform side; it is filed separately.

- d3584c6: Bring the whole `@objectstack` family to `17.0.0-rc.1`, so the dependency graph resolves a
  single copy of `@objectstack/spec`.

  #3178 bumped **only** `@objectstack/spec` to `17.0.0-rc.1`. The rest of the family —
  `client`, `core`, `formula`, `lint` (and `sdui-parser`, reached through `lint`) — stayed on
  `17.0.0-rc.0`, and each of them depends on spec at an **exact** version rather than a
  caret:

  ```
  @objectstack/client@17.0.0-rc.0  -> spec "17.0.0-rc.0"
  @objectstack/core@17.0.0-rc.0    -> spec "17.0.0-rc.0"
  @objectstack/formula@17.0.0-rc.0 -> spec "17.0.0-rc.0"
  @objectstack/lint@17.0.0-rc.0    -> spec "17.0.0-rc.0"
  ```

  So `main` carried **two** spec copies: objectui's own code read `17.0.0-rc.1` while every
  `@objectstack/*` package read `17.0.0-rc.0` from its own nested `node_modules`. That breaks
  the single-contract invariant this repo's guards are built on, and it breaks them
  _silently_ — the affected checks depend on identity, not on version strings:

  - `spec-subschema-parity.test.ts` distinguishes a genuine re-export from a fork by
    **reference identity** of the zod schema object. Two spec copies make every schema a
    distinct object, so a real re-export starts reading as a fork (or a fork slips through,
    depending on which copy each side resolved).
  - `scripts/check-spec-symbol-derivation.mjs` and `spec-symbol-parity.test.ts` use
    `createRequire` to resolve spec's `.d.ts` and run it through the TS checker. With two
    copies installed, _which_ declaration file the checker sees is a function of resolution
    order rather than of intent.

  The declared ranges were already `^17.0.0-rc.0`, which technically admits rc.1 — the pin
  lived in the lockfile. Raising the remaining ranges to `^17.0.0-rc.1` makes the floor
  explicit and forbids a future install from silently sliding back onto a family member that
  drags rc.0 along with it. The rc.1 family members pin spec at `17.0.0-rc.1` exactly, so the
  graph now converges on one copy by construction, not by luck.

  No product behaviour changes here. `check:spec-symbols` reconciliation was already
  completed by #3178 and stays green under the unified graph; this changeset is `minor`
  per the repo's fixed-group version policy.

- 444457c: feat!: follow the framework's `managedBy: 'system'` → `'system-data'` retirement (objectstack#3355)

  **FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** The framework
  retired the residual `system` bucket in protocol 17; this is the UI half of that
  change, landing with it so the closed `ManagedByBucket` union stays a mirror
  rather than a fork.

  ADR-0103 split the overloaded `system` bucket additively in v16 — the
  engine-owned objects moved to the explicit `engine-owned`, the admin/user-writable
  ones stayed on `system` — which left that value named after the half that had
  already moved out. `system-data` names what it actually holds: the SCHEMA is the
  platform's, the DATA is the admin's or the user's.

  **The derivation this deletes is the point.** Because v16's `system` doubled as
  both the engine-owned default and the writable set, three UI surfaces had to
  RECOVER the distinction from `userActions` at render time:

  - `isSystemWritable()` probed `userActions` for any opted-in write. It is now
    `managedBy === 'system-data'` — the bucket answers directly.
  - `ManagedByBadge` derived a synthetic `'system-writable'` variant key. The
    variant map is now 1:1 with the bucket union, so a new bucket is a compile
    error to miss instead of a silent fallthrough. The `systemWritable` /
    `system` i18n keys are **unchanged**, so no locale bundle moves.
  - `resolveManagedByEmptyState()` asked the resolved `create` affordance whether a
    `system` list should read "entries appear automatically" or show the New
    button. `system-data` now falls through to the generic empty state by
    definition; `engine-owned` keeps the automatic-entries copy.

  **Breaking (UI API):** `ManagedByBadge`'s `userActions` prop and the exported
  `ManagedByUserActions` interface are **removed**. The bucket alone selects the
  variant now, so the prop had become metadata nothing read — the exact defect the
  framework change exists to remove; shipping it as an accepted-but-ignored prop
  would have reproduced it one layer up. Drop the prop from call sites; no other
  change is needed.

  `MANAGED_BY_BUCKETS` and `ManagedByBucket` no longer contain `'system'`.

- 850033c: Stop offering the retired `action.shortcut` / `action.bulkEnabled` keys.

  `@objectstack/spec` 17 retired both as `retiredKey()` tombstones: authoring
  either one is a hard PARSE REJECTION, so a draft carrying it cannot be saved
  at all. The designer still offered controls for both — a "Bulk — apply to
  multiple selected rows" checkbox and a "Shortcut" text field — which meant the
  Studio action inspector let an author build a draft the platform would then
  refuse, with the rejection arriving later and nowhere near the checkbox.

  - **Action inspector**: both controls removed. The keys stay hidden from the
    fallback form (the server's live schema still advertises them, so dropping
    them from the hidden list would put the inputs straight back) — now under a
    `RETIRED_FIELDS` list that says why, so nobody "restores the missing
    control". `bulkEnabled`'s replacement is the list view's `bulkActions` /
    `bulkActionDefs`; `shortcut` has none.
  - **Action preview**: the `shortcut` and `bulk` pills are gone — they could
    only ever render for metadata the platform now refuses.
  - **`ActionEngine.registerActions`**: no longer harvests the two retired keys
    from authored metadata, which made two dead registration options look
    load-bearing. Both are still accepted on the single-action
    `registerAction(action, options)` overload, where a HOST passes them
    explicitly.

- 009e25d: Report / chart / query symbols stop wearing `@objectstack/spec`'s names
  (objectui#3155, objectstack#4115).

  **Breaking for TypeScript imports** — six exported names change. Each was a
  different concept than the spec export it collided with, so an author reading
  the objectui declaration as "the spec's" was reading a false claim:

  | was                 | now                      | why they were never the same thing                                                                                                                               |
  | :------------------ | :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `ChartSeries`       | `ChartDataSeries`        | ours is a display name plus literal `data: number[]`; the spec's is a dataset-bound series descriptor (`type`/`stack`/`yAxis`/`variant`) with no data at all     |
  | `ChartSeriesSchema` | `ChartDataSeriesSchema`  | zod twin of the above                                                                                                                                            |
  | `QueryAST`          | `SqlQueryAST`            | ours is a compiled SQL syntax tree (`select`/`from`/`join`/`group_by`); the spec's is the ObjectQL request descriptor (`object`/`fields`/`where`/`expand`)       |
  | `QuerySchema`       | `DriverQueryConfig`      | ours is the high-level config `QueryASTBuilder` compiles; the spec exports that name as a zod schema value                                                       |
  | `DriverInterface`   | `SqlDriverInterface`     | ours is objectui's SQL-oriented client abstraction (`query(sql, params)`); the spec's is the platform runtime driver contract                                    |
  | `DatasourceSchema`  | `DatasourceRegistration` | ours is the in-memory record `DatasourceManager` holds — its `driver` is a live instance; the spec's is the authored metadata document, where `driver` is a name |

  Three more are now DERIVED from the spec instead of hand-restated, which fixes
  live silent-stripping defects, since a `z.object()` drops unknown keys:

  - **`DashboardWidgetSchema`** declared 10 of the spec's 22 keys, so
    `objectui validate` deleted the other 12 without a word — `chartConfig`,
    `colorVariant`, `filter`, `responsive`, `aria`,
    `actionUrl`/`actionType`/`actionIcon`, `compareTo`, `suppressWarnings` and the
    `requiresObject` / `requiresService` capability gates the dashboard renderer
    honours at runtime. The TS interface had declared most of them all along, so a
    widget could type-check and still lose half its configuration on validation.
    Pinned divergences kept: `id` stays optional, `type` stays widened for the
    objectui-only `list` / `custom` families, and the legacy `component` envelope
    stays.
  - **`GlobalFilterSchema`** took `scope` as a free-form string (any typo
    validated); it now uses the spec's `widget | dashboard` vocabulary. The three
    objectui widenings that back a real runtime normalizer are kept and pinned:
    the bare-string `options` shorthand, the normalized `{ preset }` date default,
    and an optional `optionsFrom.labelField`.
  - **`AppContextSelectorSchema`** was a full restatement; spec keys and their
    defaults now flow in by reference, with `label` widened for objectui's i18n
    label envelope — which `AppContextSelectors` already renders.

  `ListViewSchema`'s zod node now names the spec in its own initializer rather
  than one hop away through a local const, so its long-standing derivation is
  visible where it is declared.

  Drift guard: `packages/types/src/__tests__/report-chart-query-spec-parity.test.ts`.

- 726b89c: `@object-ui/types` stops declaring sixteen symbols under names `@objectstack/spec` owns (objectui#3156, objectstack#4115).

  Seven are now **derived** from the spec, nine are **renamed** to the local
  dialect they always were. Both halves remove the same hazard: a local
  declaration under a spec export's name reads as the spec's own definition to
  the next reader, so a copy that is merely _correct today_ is a planted premise
  tomorrow.

  **Derived** — the spec now supplies the keys, by reference:

  | symbol                   | derivation                                                                        |
  | :----------------------- | :-------------------------------------------------------------------------------- |
  | `ActionParam`            | `z.input<typeof ActionParamSchema>`, `type` widened to the local legacy spellings |
  | `CreateExportJobRequest` | `Omit<CreateExportJobInput, 'object'>` (`object` is the method argument)          |
  | `CreateExportJobResult`  | re-export from `@objectstack/spec/contracts`                                      |
  | `ImportRowResult`        | re-export from `@objectstack/spec/api`                                            |
  | `NavigationArea`         | spec keys, with `navigation` / `visible` pinned locally                           |
  | `NavigationAreaSchema`   | `specFieldsExcept(NavigationAreaSchema.shape, …)`                                 |
  | `Theme`                  | re-export of the spec's `ThemeInput` (the authoring shape)                        |
  | `ExportJobFormat`        | re-export of the spec's `ExportFormat`                                            |

  Four of these close real gaps rather than tidy names. `ActionParam` never
  declared `reference` — the key `resolveActionParams()` actually reads for an
  inline lookup target — nor `defaultFromRow`, which the metadata designer's own
  inspector writes; it also narrowed `visible` to a bare string although the
  resolver has always accepted the `{ dialect, source }` envelope too.
  `CreateExportJobResult.createdAt` and `ImportRowResult.action` were optional
  here and required by the server, leaving every consumer a branch that could
  never run. And `NavigationArea`'s `id` now carries the spec's own length rule
  instead of accepting any string.

  **Renamed** — same word, different concept:

  | was                | now                      | why                                                                                                                            |
  | :----------------- | :----------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
  | `FileMetadata`     | `UploadedFileMetadata`   | field-VALUE payload (`url`, `original_name`), not the storage file record                                                      |
  | `GestureType`      | `TouchGestureType`       | direction-fused (`swipe-left`), not the spec's type+direction pair                                                             |
  | `GestureConfig`    | `TouchGestureConfig`     | gesture→`action` binding, not per-gesture tuning                                                                               |
  | `OfflineConfig`    | `PWAOfflineConfig`       | service-worker route caching, not the offline data/sync model                                                                  |
  | `PageRegion`       | `PageNodeRegion`         | region of the renderer page NODE, holding `SchemaNode`s                                                                        |
  | `PageRegionSchema` | `PageNodeRegionSchema`   | zod twin of the above                                                                                                          |
  | `ResponsiveConfig` | `MobileResponsiveConfig` | mobile box config, not the spec's SDUI grid contract                                                                           |
  | `WidgetManifest`   | `RuntimeWidgetManifest`  | SDUI component manifest, not the field-widget plugin manifest                                                                  |
  | `WidgetSource`     | `RuntimeWidgetSource`    | `module`/`inline`/`registry` loader union — and its `inline` carries a resolved component where the spec's carries source code |

  **Migration**: the old names are gone, not deprecated — an alias would preserve
  exactly the ambiguity being removed. Import the new name; nothing about the
  shapes changed. `@object-ui/types` already re-exports the spec's own
  `SpecResponsiveConfig`, and `@object-ui/react`'s `useOffline` config remains the
  spec-shaped `OfflineConfig`, so both concepts stay reachable under
  distinguishable names.

  Each rename carries a bidirectional tripwire
  (`packages/types/src/__tests__/page-nav-misc-spec-parity.test.ts`): it fails if
  the spec ever claims the new name, and also if the spec retires the old one —
  at which point the natural name can be taken back rather than the workaround
  outliving its reason.

### Patch Changes

- d9668a7: Honor the server's declared percent scale, so a ratio of exactly 1 renders as 100.0% (#3136)

  A dataset measure declared `format: '0.0%'` rendered every ratio below 1
  correctly and got the single most consequential one wrong: a rate of exactly
  `1` printed as **`1.0%`**. On an SLA / pass-rate dashboard that turns
  "everything met the SLA" into "1% met the SLA", on both surfaces the issue
  names — the KPI card and the dataset-bound table (they share `formatMeasure`).

  The cause was never a bad multiplier; it was a missing fact. `formatMeasure`
  scaled by magnitude — `percentDisplayValue` multiplies by 100 only strictly
  inside `(-1, 1)` — because the column arrived with a `%` format string and
  nothing saying what scale its numbers were on. That guess is undecidable at
  exactly 1, which is both a full-compliance ratio ("100%") and one percentage
  point ("1%"), and it resolved to the reading almost nobody means.

  The server now answers the question instead (framework: `percentScaleOf` +
  `AnalyticsResult.fields[].percentScale`, the sibling of the ADR-0053 currency
  chain): a `derived: { op: 'ratio' }` measure is a `fraction` by definition, and
  a measure over a `percent` field inherits that field's scale. `formatMeasure`
  takes the declared scale as a fourth argument and, when present, scales by it —
  `fraction` ×100, `whole` verbatim — instead of inspecting the value. Every
  dataset-bound call site passes the column's `percentScale`: the dashboard
  metric/table/pivot cells, the report renderer's cells, totals and KPI, and the
  dataset preview.

  `percentDisplayValue` is untouched and still the fallback for a column that
  arrives without the annotation (an older server, or a non-dataset percent cell
  in a list view), so nothing that renders correctly today changes.

- a8ad6c0: A required boolean must be savable in its UNCHECKED state — `false` and `0` are values.

  Reported against an AI-built task tracker whose 任务 object has a required
  `是否完成` boolean: the create form showed the switch OFF, answered "是否完成不能
  为空", and saved instantly once the switch was turned ON. The app could only ever
  create ALREADY-DONE tasks — the one state the control shows by default was the
  one value it refused to save (cloud#972).

  Two defects stacked, and either alone is enough to break it:

  **The `required` verdict read truthiness, not presence.** `@objectstack/spec`
  FieldSchema.required (ADR-0113) is "an insert must provide a NON-NULL value",
  and objectql's record validator implements exactly that. react-hook-form's
  built-in rule instead fails whenever `isBoolean(value) && !value` — its
  accept-the-terms checkbox heritage — silently redefining every required boolean
  as "must be TRUE", including a select whose chosen option value is `false`. It
  also disagreed the other way, letting a whitespace-only string through for the
  server to reject with a 400. The form renderer no longer hands RHF its own
  `required`: the check is now a `validate` entry keyed `required` (so the error
  still surfaces as `type: 'required'`, which the conditional-required cleanup
  keys on) backed by a new shared `isMissingForRequired` in `@object-ui/core`, a
  deliberate mirror of objectql `record-validator.isMissing` — `undefined`,
  `null`, blank-after-trim string, empty array. Deleting the inherited rule also
  stops a `required` that rode in on `validation` from outliving a `requiredWhen`
  that resolved to FALSE.

  **A boolean field held `undefined` while displaying "off".** A two-state control
  has no third state, but a field with no entry in `defaultValues` rendered an OFF
  switch backed by nothing: the create payload omitted the column (it lands null,
  which reads as unchecked but isn't) and the presence check above would still
  refuse it. The form renderer now folds `false` into `defaultValues` for every
  boolean-widget field the caller left unset — in `defaultValues` itself, not
  per-Controller, because that object is also the dirty-check baseline and what
  the defaults-reset window replays. Every surface gets it, including the
  modal/drawer create dialogs that start from a bare `{}`. An authored default
  (or a loaded record, `null` included) still wins.

  `WizardForm`'s cross-step gate had its own copy of the empty-value predicate; it
  now imports the shared one so it cannot drift from the per-field verdict. And
  the field-demo renderer read `schema.defaultValue || schema.value`, throwing
  away an authored default of `false` / `0` / `''` — same falsy-as-empty class,
  now `??`.

  Verified end to end on a local stack against the exact metadata shape
  `apply_blueprint` materializes (`{ type: 'boolean', required: true }`, no
  default): a 是否完成 = 否 task with 工时 = 0 now creates and persists as
  `{ hours: 0, is_done: false }`, turning the switch on still stores `true`, and a
  blank required text is still refused.

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [4bf612c]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [444457c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0

## 17.1.0

### Minor Changes

- 62311b6: feat(core): inventory `ActionDef`'s keys and warn on the ones nothing reads — objectstack#4075 step 1

  `ActionDef` ends with `[key: string]: any`, so it accepts any key of any type.
  Deleting `ActionDef.execute` produced **zero** compile errors even though the
  field had just been removed (objectui#2990), and stale metadata still authoring
  `execute: 'markDone'` type-checks today. The same deletion against
  `@object-ui/types`' `ActionSchema` — which has no index signature — correctly
  produced `TS2353` at the authoring site. One of the two readers can catch a
  retired key; the other is structurally incapable, which is how a typo (`targt`)
  and a tombstoned key both reach a runner that then silently does nothing.

  This is the non-breaking first step of the staged narrowing: it makes the key set
  **visible** and warns on anything outside it, without changing a single type.

  New exports from `@object-ui/core`:

  - `ACTION_DEF_KEYS`, `SPEC_ACTION_KEYS`, `NAVIGATION_ALIAS_KEYS`,
    `RETIRED_ACTION_KEYS`, `KNOWN_ACTION_KEYS` — the inventory.
  - `classifyActionKeys(action)` — splits an action's own keys into `unknown` and
    `retired`.
  - `warnOnUnknownActionKeys(action)` — dev-mode only, warn-once. Called by
    `ActionRunner.execute`, so no consumer wiring is needed.

  A retired key gets a louder, more specific warning than an unknown one: an
  unknown key is probably a typo, a retired key is metadata that used to work.
  `execute` is not simply gone from the spec — it is a live **tombstone**, still
  present in `ActionSchema` so the parser can reject it by name with the rename
  prescription.

  Nothing is rejected and no types changed, so existing metadata behaves exactly as
  before. Promoting the legitimate keys to explicit optional fields, then removing
  the index signature so `tsc` catches both typos and retired keys, are steps 2 and
  3 of objectstack#4075.

- 9e7349e: **`target` is the only action handler slot — the `execute` alias is gone from the renderer (framework#3856).**

  `ActionRunner.executeScript` read `action.target || action.execute`. That fallback
  is unreachable against `@objectstack/spec` 17: `execute` is now a tombstoned key
  (framework#3855) that the parser **rejects** with the rename prescription, so no
  parsed action can carry it and the `||` could only ever yield `target`. Verified
  against 17.0.0-rc.0 — an action declaring `execute` fails `ActionSchema.safeParse`,
  and a `target` action's parsed output has no `execute` key at all.

  Deleted rather than left as harmless residue: two handler slots is what let one
  action run one script server-side and a different one client-side (framework#3713,
  where this renderer preferred the alias while the spec transform preferred
  `target`). A dead slot still reads as a live contract to the next maintainer.

  `execute` is also **removed from the types**, which is the part that had never
  landed. framework#3856 predicted a compile error here; there wasn't one, because
  neither reader was typed against the spec's `z.infer`:

  - `@object-ui/types` `ActionSchema` hand-declared `execute?: string`. Removed, so
    `execute: '…'` now fails `tsc` at the authoring site (TS2353).
  - `@object-ui/core` `ActionDef` hand-declared it too. Removed — but `ActionDef`
    carries a `[key: string]: any` index signature, so stale hand-authored metadata
    that never passed through the parser still compiles. For that path
    `executeScript` now returns the rename prescription instead of a bare
    "No script provided", matching the spec tombstone's rule that removing an
    authorable key must be audible: silently binding no handler is the
    "Mark Done does nothing" shape (framework#2169).

  The four action renderers (`action:button`, `action:icon`, `action:menu`,
  `action:group`) no longer forward `execute` into the runner, and Studio's
  `ActionPreview` no longer falls back to it — previewing an alias-only draft as
  "bound" contradicted the parse that rejects it on save.

  Requires `@objectstack/spec` 17. Metadata still on the alias is rewritten by
  `os migrate meta --from 16`.

- 6ae818e: feat(core): one column identity per column — `field` stamped at ingestion (#3104)

  A column's field identity was resolved twice, with two different precedences
  over the same `schema.columns` array, and the two halves disagreed:

  - **request path** — `ListView`'s `$expand` and `$select` builders, and
    `ObjectGrid.getSelectFields`, read `f?.field` and only `f?.field`.
  - **render path** — the FLS gate, the hidden-field filter, `fieldOrder`, both
    export branches and the hide-fields popover read
    `f.name || f.fieldName || f.field` — name FIRST.

  So `{ field: 'account', name: 'account_name' }` fetched `account` while the
  renderer keyed off `account_name`, and `{ name: 'account' }` rendered a column
  the request dropped entirely — neither `$select` nor `$expand` carried it. That
  is the mechanism behind the "relation column shows a bare id / column is empty
  / sort does nothing / export is missing a column" defect class.

  Per AGENTS.md #0.1 the fix is not another `?? name` at the read sites. Legacy
  acceptance moves to the one boundary that already folds this view's vocabulary,
  `normalizeListViewSchema`, which now also canonicalizes each column's identity.

  New in `@object-ui/core`:

  - `columnIdentity(entry)` — the single reader. Resolves `field` → `name` →
    `fieldName`, canonical-first, so it agrees with `buildExpandFields` instead
    of racing it. Handles bare-string columns.
  - `normalizeColumnIdentity(entry)` / `normalizeColumnIdentities(columns)` — the
    fold. Stamps `field`; a legacy key that is **already present** is mirrored
    onto the same identity so name-first readers resolve what the request asked
    for; a legacy key that is **absent is never invented**, and an
    already-canonical column is returned by reference.
  - `hasConflictingColumnIdentity(entry)` — true when a column's keys disagree.
  - `CANONICAL_COLUMN_IDENTITY_KEY`, `LEGACY_COLUMN_IDENTITY_KEYS`,
    `TABLE_ADAPTER_COLUMN_KEY`.

  The fold **mirrors** rather than deleting the legacy key, unlike the other
  folds in `normalizeListViewSchema`. Deleting would work inside this repo (every
  name-first read falls through to `field`), but `columns` entries cross the
  package boundary into host renderers and dropping `name` from under them is a
  breaking change with no inventory. Deletion is a later call, once the in-repo
  consumers read `columnIdentity()`.

  Behaviour is unchanged for any column carrying a single identity key — every
  read site resolves the same string it did before. The entries whose resolution
  moves are exactly the ones where two sites already disagreed.

  `accessorKey` is deliberately untouched: it is TanStack Table's own column key
  (`TableColumn.accessorKey`), not ObjectStack metadata identity, and folding
  across that boundary would fossilize the merge.

- 746dd00: feat(sdui): curate the page:\*, element:\* and action:\* families into the public contract

  The AI-authoring vocabulary and the Studio page designer disagreed by thirteen
  blocks: `PUBLIC_BLOCKS` carried one `page:` tag and one `element:` tag while
  the designer palette — and @objectstack/spec's page schema — offered the whole
  families. A block a human can drag in Studio was invisible to a model writing
  the same page, which is the objectui#3006 state at 10× the scale.

  Fifteen tags join the contract (36 → 42 → **57**), every one shipping a
  renderer with declared inputs (objectui#3065):

  - `page:` — tabs, card, accordion, section, footer, sidebar
  - `element:` — text, number, button, definition-list, repeater
  - `action:` — button, group, menu, icon

  Five stay out, each with its reason recorded and guarded: `action:bar`
  (`record:quick_actions` covers the record action strip; the spec blesses the
  other four), `element:image` (duplicates the curated `image` — one spelling
  per concept), and `element:record_picker` / `element:text_input` /
  `element:metadata_viewer` (mirroring the Studio palette's own exclusions, so
  the two vocabularies stay out for the same reasons rather than by
  coincidence).

  The console's reverse-coverage guard now sweeps all four semantic namespaces
  instead of `record:` alone — checking only the namespace you just fixed is
  exactly how the last 22 doubled keys went unnoticed (objectui#3037). A new
  prop-less allowlist (`element:divider`, `page:section`, `page:footer`,
  `page:sidebar`) keeps "declares no inputs" a pinned decision in both
  directions: those four must stay at zero, everything else curated must declare
  a surface.

- 38ca8be: refactor(fields): `requiredWhen` is the only required-predicate slot — drop the retired `conditionalRequired` alias

  `@objectstack/spec` 17 (objectstack#3855) **retired** `Field.conditionalRequired`,
  the long-deprecated alias of `requiredWhen`. ObjectUI carried a back-compat read
  for it in seven places; all of them are removed.

  The removal is safe because the spec did not merely _stop emitting_ the key — it
  made authoring it **fail loudly**. `retiredKey()` declares the key as
  `z.never()`, so:

  - `z.input` types it as `never` — writing it is a `tsc` error at the authoring site;
  - the parse **rejects** it (verified against `17.0.0-rc.0`), at both `FieldSchema`
    and `ObjectSchema`, with the prescription as the message:

    > `conditionalRequired` was removed in @objectstack/spec 17 (#3855) — use
    > `requiredWhen`. Rename the key; the value (a CEL predicate) is unchanged.
    > Run `os migrate meta --from 16` to rewrite it automatically.

  So spec-parsed metadata cannot carry the key — an object declaring it fails to
  load rather than loading with the rule silently dropped. Keeping a renderer-side
  `requiredWhen ?? conditionalRequired` would have re-created exactly the second
  de-facto contract the tombstone exists to prevent: the key would have kept
  working in the UI while being rejected everywhere else, hiding the producer's bug
  (AGENTS.md #0.1). "Backend-agnostic" (#1) does not argue for keeping it either —
  `conditionalRequired` is an ObjectStack-spec-ism, so the only producers that ever
  emit it are ObjectStack producers on ≤16, and the spec ships them a converter.

  Removed from:

  | package                  | site                                                                                                      |
  | :----------------------- | :-------------------------------------------------------------------------------------------------------- |
  | `@object-ui/types`       | the `conditionalRequired?:` member on `FormField`                                                         |
  | `@object-ui/core`        | the `??` fallback + rules-param member in `resolveFieldRuleState`                                         |
  | `@object-ui/components`  | three pass-throughs in the form renderer                                                                  |
  | `@object-ui/plugin-form` | `ObjectForm`, `ModalForm`, `sectionFields`, `deriveMasterDetail` (×2)                                     |
  | `@object-ui/app-shell`   | the field inspector's legacy read/auto-migrate, and the key's entry in `clientValidation`'s CEL lint list |

  **Studio authors lose nothing.** The object designer's draft validation parses
  against the spec's own `ObjectSchema`, so a draft carrying the key now surfaces
  the tombstone's rename prescription under the same `fields.<name>.conditionalRequired`
  path the CEL lint used to report — a better message than the inspector's silent
  auto-migration, and one the server agrees with. That behavior is pinned by a test.

  **Migrating:** rename the key to `requiredWhen` (the CEL value is unchanged), or
  run `os migrate meta --from 16`.

- 02aef0c: fix(sdui): a `kind:'html'` page can use lazily-registered blocks, and recovers when one registers late

  objectui#2953 had a twin one tier over, unreported. The whitelist a
  `kind:'html'` page's source compiles against was built from `getAllTypes()` +
  `getConfig()` — both loaded-only — so any block registered via `registerLazy()`
  was rejected as _"not an allowed component"_.

  The blast radius is worse than the react tier's. There, a missing block cost one
  identifier; here a compile diagnostic fails the **whole page**, so a single
  `<object-kanban>` replaced the entire page with `HTML page failed to compile (2)`.
  And it never recovered: `layoutElement` was memoised on `[schema, pageType]` with
  no registry signal, so the cached error panel outlived the plugin actually
  landing — permanently broken for the session.

  `ComponentRegistry` gains three lazy-aware reads:

  - `getKnownTypes()` — loaded registrations **plus** pending lazy stubs, deduped.
    The set a whitelist or manifest should be built from. `getAllTypes()` keeps its
    loaded-only meaning ("what can render right now") and now says so.
  - `getMeta(type, namespace?)` — metadata from the loaded registration, else from
    a pending stub. `getConfig()` stays loaded-only, since callers read
    `.component` off it.
  - `getVersion()` — monotonic counter of changes to the known set, bumped on
    register / unregister / registerLazy. A cache key that a type _count_ cannot
    substitute for: one registration plus one unregistration leaves the count
    untouched while the set changed.

  `getJsxManifest()` builds from those, and `PageRenderer` subscribes to the
  registry so a page that could not compile retries when the registry grows.

  A stub carries no `inputs` yet, so its props surface as `unknown-prop` warnings
  rather than errors — the page compiles and renders, and the inner
  `SchemaRenderer` triggers the loader and swaps in the real block. Authoring-time
  prop validation is unaffected: `sdui.manifest.json` is generated with every
  plugin eagerly loaded, and asserts as much.

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

- f59f2c1: refactor(actions): `navigation` becomes a named alias of the spec's `url`, sharing one navigator (#2944)

  The last open item of #2944: `ActionRunner` dispatched a seventh action type,
  `navigation`, that `@objectstack/spec`'s `ActionType` does not contain. The issue
  asked for a decision — promote it upstream or delete the case. Neither, as stated.

  - **Promoting it is wrong.** The spec already has `url` for "go to a location",
    with `openIn` for the new-tab/same-tab choice. A seventh type would put a
    second spec name on one operation, which is the exact failure the #2901 audit
    is named after: _a second definition of the vocabulary exists, and the renderer
    is faithful to the wrong one_.
  - **Deleting it is worse, because it is silent.** `{ type: 'navigation', to: … }`
    is authored today (`element:button` CTAs). Without the case the action falls
    through to `executeActionSchema`, which returns `{ success: true }` — a green
    toast that navigates nowhere. That is #2960's trap.

  So it stays, but stops being dialect. `ObjectUiLocalActionType` /
  `OBJECTUI_LOCAL_ACTION_TYPES` in `@object-ui/types` declare it as objectui's own
  alias of `url` — the same treatment #2985 gave `PageVisualizationAlias` — and the
  runner routes both names through one navigator.

  **The alias had already drifted, which is the point.** `executeNavigation` was
  quietly the weaker of the two implementations: no `${param.X}` / `${ctx.X}`
  interpolation, `openIn` ignored, and no `/api/…` full-page short-circuit (the
  redirect-dance case `url` exists to handle). An author who wrote
  `{ type: 'navigation', to: '/x?p=${param.p}' }` shipped the literal `${param.p}`,
  while the identical `url` action resolved it. Both names now behave identically;
  `url` in turn gains `replace` pass-through, the one modifier only the alias had.

  Additive only. `replace` is omitted from the `NavigationHandler` options object
  when unset, so hosts see the option shape they already saw.

  The new guard is structural rather than another assertion. The runner's built-in
  dispatch is a table typed `Record<RunnableActionType, …>` instead of a `switch`,
  so an `ActionType` the spec **adds** stops compiling until an executor exists for
  it — the Tier-2 "validates at save, renders nothing at run time" failure (#2942)
  becomes a build error for actions. `spec-derived-unions.test.ts` additionally
  asserts `navigation` is _absent_ from the spec enum, so the day it is adopted
  upstream, the test fails and names the alias to retire.

- ce08d55: chore(deps): upgrade `@objectstack/*` to 17.0.0-rc.0, and let the spec take back what it now owns

  `spec` / `client` / `formula` / `lint` move from `^16.x` to `^17.0.0-rc.0`. Two
  groups of v17 changes reach this repo, and they pull in opposite directions —
  the spec pruned surface objectui re-exported, and adopted surface objectui had
  been carrying locally.

  **The spec pruned dead Theme config (objectstack#3494), so the re-exports went
  with it.** `ThemeSchema` dropped `spacing`, `breakpoints`, `logo`, `density`,
  `wcagContrast`, `rtl`, `touchTarget` and `keyboardNavigation` — authorable but
  never enforced, so authoring them was already a silent no-op. `@object-ui/types`
  re-exported those sub-schemas _by reference_ (issue #2231), so they could not
  survive the prune without becoming hand-written mirrors — exactly the second
  de-facto contract AGENTS.md #0.1 forbids. Removed from the public surface:

  - Types: `Spacing`, `Breakpoints`, `DensityMode`, `WcagContrastLevel`,
    `ThemeLogo`, and the deprecated `SpacingScale` alias
  - Schemas: `SpacingSchema`, `SpacingScaleSchema`, `BreakpointsSchema`,
    `ThemeLogoSchema`, and the `SpacingSchemaType` / `BreakpointsSchemaType` helpers
  - `Theme.spacing`, `Theme.breakpoints` and `Theme.logo`

  `mergeThemes` no longer merges the three dropped keys. `generateThemeVars` is
  unaffected — it never emitted them, which is why the liveness audit called them
  dead. The one real consumer was `ThemeProvider`, which set the favicon from
  `theme.logo.favicon`; that path is gone, because v17 strips the key at parse and
  it could never arrive again. The live favicon is unaffected: it comes from
  operator branding (`getFaviconUrl()`), applied in the console's `index.html`,
  `main.tsx`, and on route change.

  Nothing else read the pruned types. In particular the list-density feature is
  untouched — `useDensityMode` and `rowHeightToDensityMode` use `@object-ui/core`'s
  own local `DensityMode`, which never came from the spec.

  **The spec adopted objectui's ListColumn extensions (objectui#2231), so the
  extension collapsed.** `ListColumnSchema` used to `.extend()` the spec with two
  fields, each carrying a note to promote it upstream rather than grow the
  extension; v17 did exactly that. `summary` is now the spec's
  `union([ColumnSummarySchema, ColumnSummaryConfigSchema])` — the same enum ∪
  `{ type, field }` form `useColumnSummary` reads — and `prefix` is the spec's
  `ColumnPrefixSchema`. `ListColumnSchema` is now a plain by-reference re-export.
  One behavior change rides along: `prefix.type` defaults to `'text'` on parse
  instead of staying `undefined`, so the cell renderer always gets a value.

  **Node 22 is now the floor.** Every `@objectstack` package declares
  `engines.node: ">=22.0.0"` (objectstack#3825; Node 20 reached EOL 2026-04-30).
  This repo claimed `>=20` and ran CI on Node 20.x, so it promised — and validated
  — a runtime its own core dependency does not support. `engines.node` is now
  `>=22`, CI runs Node 22.x, and the CI/deployment docs say so.

  The major stays 17: per AGENTS.md the major tracks `@objectstack`'s major, which
  is also 17, and that convention deliberately outranks semver purity — so the
  removals above ship as a minor rather than desyncing the two.

- 390c071: feat(record): declare inputs for the seven configurable record:\* blocks, and curate six

  Seven `record:*` blocks shipped with renderers that read props but declared no
  `inputs`. That combination is the worst of both: the renderer honours
  `limit`, `severity`, `location` …, while every authoring surface — the designer
  panel, the AI vocabulary, the generated manifest — reports the block takes no
  configuration. objectui#3013 recorded them as deliberately uncurated for
  exactly that reason.

  The declarations mirror what each renderer actually reads:

  | block                                  | inputs                                                                       |
  | -------------------------------------- | ---------------------------------------------------------------------------- |
  | `record:activity`                      | 11 — from `RecordActivityComponentProps`                                     |
  | `record:chatter` / `record:discussion` | 5 — from `RecordChatterComponentProps`                                       |
  | `record:alert`                         | 8 — severity, title, body, visible, icon, action, dismissible, dismissKey    |
  | `record:quick_actions`                 | 7 — actionNames, requiredPermissions, location, align, inline, variant, size |
  | `record:history`                       | 3 — limit, emptyText, unknownUserText                                        |
  | `record:reference_rail`                | 1 — hideEmpty                                                                |

  `inputs` describe what an AUTHOR writes, which is a subset of what the renderer
  reads. `entries`, `loading` and resolved `actions` are injected by the host
  shell off RecordContext; declaring them would invite a model to hand-write the
  data the page is supposed to fetch. `aria` is omitted for the reason it is
  omitted on `record:details` — an accessibility escape hatch, not a layout
  choice. `location` takes its enum from the spec's `ACTION_LOCATIONS` rather
  than restating it, per objectui#3019.

  Six of the seven are now in `PUBLIC_BLOCKS`: configurable and absent from the
  contract is the state objectui#3006 was about. The contract goes 36 → 42 tags,
  all resolving.

  `record:chatter` stays out — it is the same renderer as `record:discussion`
  under a Salesforce-familiar name, kept for schemas already in the wild. Two
  spellings of one block is ambiguity an authoring model cannot resolve, so the
  vocabulary carries the spec's name. A test compares the two input lists, so the
  day they diverge the exclusion stops being justified and fails.

  A companion assertion requires every curated `record:*` tag to declare inputs.
  A curated tag with none reads as "takes no configuration" when the renderer in
  fact reads props — the same gap objectui#3006 opened, pointed the other way.

- 912496d: feat(types,core): the `*Validation` rule types derive from spec 17, and the engine agrees with the server — objectstack#4115

  The five spec-named rule variants in `data-protocol.ts` were hand-written
  interfaces, each labelled `(ObjectStack Spec v2.0.1)` while the installed spec
  was `17.0.0-rc.0`. Nothing bound them to the spec, so fifteen majors of drift
  accumulated with `tsc` silent throughout and the comment still vouching for it.
  They are now `z.input` derivations of `ScriptValidationSchema` /
  `StateMachineValidationSchema` / `CrossFieldValidationSchema` /
  `ConditionalValidationSchema` / `FormatValidationSchema`, and canonicity is
  carried by that binding plus a parity gate rather than by a comment (#3017).

  `z.input`, not `z.infer`, because objectui consumes **authored** metadata as it
  arrives over `/meta` — before the spec applies its defaults and canonicalizes
  expressions. That is the shape actually in the JSON.

  **Breaking, in the shape of the rule types** (minor per this repo's version
  policy — see AGENTS.md §9):

  |                                   | was                                         | is                                                      |
  | --------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
  | `ConditionalValidation`           | `condition` + `rules[]`                     | `when` + `then` / `otherwise`                           |
  | `FormatValidation`                | `pattern` + `flags`, 8 named formats        | `regex`, the 4 formats the server implements            |
  | `Script`/`CrossField` `condition` | `string`                                    | `string \| { dialect, source }`                         |
  | `StateMachineValidation`          | —                                           | gains `initialStates` (objectstack#3165)                |
  | `BaseValidation`                  | no `priority`, `events` included `'delete'` | gains `priority`; `'delete'` retired (objectstack#3184) |

  `UniquenessValidation` / `AsyncValidation` / `RangeValidation` are now
  `@deprecated`. They have no spec counterpart — the spec removed the first two
  deliberately (uniqueness → a unique index, since SELECT-then-INSERT is racy;
  async → the form layer) — and the spec's `ValidationRuleSchema` rejects all
  three, so no rule in those shapes can ride in `ObjectSchema.validations`.

  **`ObjectValidationEngine` now agrees with `objectql`'s rule-validator.** It is a
  client PRE-CHECK of rules the server enforces, so every disagreement cost the
  user something real. Fixed:

  - **Polarity was inverted.** The server violates a rule when the predicate is
    TRUE; the engine violated it when the predicate was FALSE. Every
    spec-authored `script` / `cross_field` rule produced the opposite verdict.
  - **Envelope conditions were a silent no-op.** `{ dialect, source }` reached
    `expression.trim()`, threw, was caught, and read as "passes".
  - **`conditional` was a silent no-op**, reading `rule.condition` / `rule.rules`
    where the spec says `when` / `then`; `otherwise` was never evaluated at all.
  - **`format` produced FALSE REJECTIONS** — it read `rule.pattern`, and
    `undefined.test(...)` threw into a catch that reported a violation, blocking
    writes the server accepts.
  - **An absent `active` disabled the rule** and an absent `events` threw; both
    arrive absent from `/meta` because the spec defaults them at parse time.
  - `priority` now orders execution; `initialStates` is enforced on insert;
    `format`/`state_machine` only fire when the write touches the field; a broken
    predicate or an uncompilable `regex` fails OPEN with a warning; and a rule type
    the engine cannot evaluate (the spec's `json_schema`) warns instead of
    reporting the record as valid.

  The default `SimpleExpressionEvaluator` is not CEL and never was; it now binds
  both the spec's `record.x` scope and objectui's historical bare `x`, and
  documents that richer predicates need a CEL-backed evaluator. `validateRecord`'s
  `event` parameter no longer accepts `'delete'`.

  Gates: `packages/types/src/__tests__/validation-rule-spec-parity.test.ts` (key
  sets, wire shapes, the pinned `then`/`otherwise` divergence with an inverted pin
  that fails when objectstack#4171 is fixed upstream) and the rewritten engine
  suite. objectstack#4115's ledger drops 120 → 115.

### Patch Changes

- b41f401: **Authoring types are input types (framework#4074 steps 2–3): `ActionParam` takes the spec's declaration forms, `ListViewSchema` stops promising parse-output defaults, and `FormField.dependsOn` matches its runtime reader.**

  Three public types said something different from what the platform accepts. All
  three divergences were found by making `packages/types`' tests compile (#3009)
  and then resolving the declared `p1-spec-alignment.test.ts` debt site-by-site
  instead of papering over it.

  **`ActionParam` is now the authoring shape, aligned with the spec's input.**
  `name` / `label` / `type` become optional and `field` / `objectOverride` appear:
  the spec's primary way to declare a param — a bare field reference that inherits
  label/type/validation/options from an object field — was unrepresentable while
  all three were required. The _resolved_ shape the dialog consumes (after
  app-shell's `resolveActionParams()` inlines the reference) remains
  `@object-ui/core`'s `ActionParamDef`, with all three required. Authoring and
  resolved are different types on purpose. `label` and option labels take the
  spec's `I18nLabel` by import — which the new compile-time guard promptly
  revealed to be aliased to plain `string` in the current spec (the per-locale
  record is the separate `I18nObject`), so this is not a behavioural widening
  today; importing the alias means objectui tracks any future widening
  automatically.

  **Breaking:** code destructuring `param.name` / `param.label` / `param.type` as
  guaranteed must now handle the field-backed form (or consume the resolved
  `ActionParamDef` instead, which is what dialog-side code should be doing).

  **`ListViewInferred` is `z.input`, not `z.infer`.** The spec sub-schemas that
  flow into the list-view surface (`userActions`, `tabs` → `ViewTab`, `sharing`)
  carry `.default()`s, so the inferred output type made fields like
  `userActions.refresh` or a tab's `pinned`/`visible` _required_ — but nothing on
  the render path ever runs `.parse()`: `normalizeListViewSchema` deliberately
  applies no defaults ("an absent flag stays absent", its own suite). The output
  type therefore rejected valid authored metadata (`userActions: { sort: true }`)
  while promising renderers defaults that never arrive. Typing the surface as
  input matches both the author and the runtime object. Code that _trusted_ those
  phantom defaults now gets an optionality error — which is a latent bug surfacing,
  not a regression: the value really could be absent.

  **`FormField.dependsOn` is `DependsOnInput`.** The runtime reader
  (`resolveCascadingOptions`) has always accepted a bare name, a list of names, or
  lookup-parameter entries `{ field, param }` — its parameter type says so. The
  public property said `string`, so array-authored metadata type-errored while
  working, and the form renderer read the key through `(f as any).dependsOn` to
  get past its own type. The shape now lives in `@object-ui/types` (single source
  of truth next to `FormField`), `@object-ui/core` imports and re-exports it, and
  the two `as any` reads in the components form renderer are typed.

  **The `p1-spec-alignment.test.ts` exclusion is gone.** Its 14 errors resolved:
  the two "sharing in ObjectUI format" tests and the legacy-ARIA-spelling fixture
  are deleted/rewritten — those dialects are _normalizer input_, folded by
  `normalizeListViewSchema` and asserted branch-by-branch in core's
  `normalize-list-view.test.ts`, the seam where the fold actually runs; asserting
  them on the canonical type only ever "passed" because nothing compiled the file.
  One fixture claimed a shape no surface ever admitted (an ObjectQL triplet as a
  spec `ViewTab.filter`) and was corrected to the rule-object form. Every test
  file in `@object-ui/types` is now compiled, with no exclusions.

  Discrimination-checked: reverting `ListViewInferred` to `z.infer`, `dependsOn`
  to `string`, or `ActionParam.name` to required each produces the expected
  compile error in the now-compiled test files (`TS2739` / `TS2322` / `TS2741`);
  restored, all projects are clean.

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

- 7d9734d: feat(core): say which column identity key won, out loud (#3104 PR3)

  Closes the battle opened in #3104. PR1 (#3119) put the canonicalizing fold at
  ingestion; PR2 (#3122) converged all 22 read sites onto `columnIdentity()`.
  This is the audible half.

  A column carrying two identity keys that **disagree** — `{ field: 'account',
name: 'account_name' }` — now logs a one-time dev-mode warning naming which key
  won and what to change:

  ```
  [ObjectUI] Column carries two identities: `field: 'account'` and
  `name: 'account_name'`. `field` wins — it is the only key `ListColumnSchema`
  declares — and `name` has been rewritten to match, so the rendered column and
  the requested field agree. Fix the producer: drop `name` and author `field`
  only. (objectui#3104)
  ```

  The fold making the two halves agree is what stops the bug, but silently
  rewriting `name` to match `field` also hides that the producer is emitting a
  contradiction. The renderer recovering is not the same as the metadata being
  right, so the recovery says so.

  Deliberately narrow:

  - **Only contradictions.** A legacy-only column (`{ name: 'stage' }`) is legacy,
    not conflicting — it is stamped without noise.
  - **Warn once per (identity, conflicting spelling).** Columns are re-normalized
    on every render; a warning that floods the console is a warning that gets
    muted. Keyed by the pair rather than the identity alone, so a column carrying
    two different stale spellings reports both — the author needs to fix every
    producer, not just the first one seen.
  - **Silent under `NODE_ENV=production`**, and the fold still runs there.

  `resetColumnIdentityWarnings()` is exported for tests.

  **No lint rule, and that is a measured decision.** #3104 asked for
  `no-restricted-syntax` on `.field ?? .name` to be evaluated on its
  false-positive rate first. With the family at zero, all 12 remaining scanner
  hits are legitimate — a syntactic rule cannot tell a two-layer join from a dual
  read, because the distinction is what the keys mean in that layer, not how the
  expression is spelled. Adopting it would mean 12 inline disables on correct
  code, which trains the next author to reach for the disable. The ratchet carries
  a `verdict` and a `why` per site instead, so a new hit gets triaged rather than
  silenced. The evaluation is written into the ratchet's header.

  **Ledger item resolved with no change needed.** #3104 flagged `ListColumn` for
  disposition under objectstack#4115 (spec-named symbols must be imports, not
  declarations). `ListColumnSchema` is already a by-reference re-export of
  `@objectstack/spec/ui`, and `spec-subschema-parity.test.ts` already pins it by
  reference identity — the only check that distinguishes a re-export from a
  faithful fork. Already compliant; nothing to do.

- aebfa4f: chore(core): deprecate `ObjectValidationEngine` — rule enforcement stays single-implementation on the server (#3110)

  `ObjectValidationEngine` / `defaultObjectValidationEngine` / `validateRecord` are
  now `@deprecated`. **Nothing is removed and no behaviour changes** — existing
  callers keep working exactly as they did after #3103.

  **Why.** Object-level validation rules are _enforcement_, and enforcement is
  single-implementation on the server (`objectql`'s rule-validator). objectui
  already draws that line for the predicates it _does_ evaluate client-side:
  `evaluator/fieldRules.ts` handles the presentation predicates (`visibleWhen` /
  `readonlyWhen` / `requiredWhen`) by delegating to the canonical
  `ExpressionEngine`, "rather than re-implementing a parallel evaluator"
  (ADR-0036). This engine was that parallel evaluator, on the enforcement side.

  #3103 converged its semantics onto the server rule-for-rule, with eight
  mutation-tested gates — and still left a known divergence: the server carries
  ADR-0113's legacy-violation exemption (reject only when the merged state violates
  _and_ this write makes it worse), which this engine does not implement. Editing
  an unrelated field on a legacy row would be blocked here and accepted there. One
  careful pass still left a gap, which is the argument: mirroring cross-repo
  behaviour is structurally unreliable, not unreliable-this-time.

  **What to use instead.** Let the write fail and render the server's rejection —
  it is already structured (`field` / `code` / `message`, plus a label since
  objectstack#3957). For pre-submit feedback, the answer is a validate-only
  (dry-run) write on the server: identical UX, zero parity risk, and it covers the
  two rule kinds a client can never check — `unique` (needs the database) and
  `json_schema` (ajv lives server-side).

  **The decision is a mechanism, not a comment.** What #3103 removed was a doc
  comment claiming spec canonicity that had been false for fifteen majors;
  shipping its successor as another comment would repeat the mistake one level up.
  `validation-engine-stays-unwired.test.ts` scans `packages/*/src` and fails if a
  production module starts referencing the engine, naming the file and the issue to
  reverse first. Barrels still re-export it — publishing a deprecated API is not
  wiring — and host applications are free to keep importing it.

  The five spec-derived rule TYPES in `@object-ui/types` are unaffected: they are
  the anchor for objectstack#4115's ledger and are independent of whether objectui
  ships an engine.

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

- 6f29aa5: fix(grid): a legacy string row action runs instead of green-toasting a no-op — objectui#2960

  A list view declaring `rowActions: ['convert_lead']` rendered a menu item that
  performed **zero network requests** and reported success. Where the object also
  declared the same action with `locations: ['list_item']`, the row menu showed a
  working entry and a dead duplicate of it side by side.

  **The name never became an action.** `ObjectGrid` dispatched the legacy form as
  `{ type: <action name>, params: { record } }` — the action _name_ landing in the
  runner's `type` slot, never resolved against the object's action defs. It
  matches no built-in type and (absent a handler registered under that exact name)
  no handler either, so it fell through to `ActionRunner.executeActionSchema`,
  which returned `{success: true, reload: true, close: true}` for a schema with
  nothing in it. `handlePostExecution` then fired the green "Action completed
  successfully" toast.

  Two changes, either of which would have surfaced the bug:

  **① `ObjectGrid` resolves legacy names against `objectDef.actions`.** A name
  that matches a declared action is promoted to that def and dispatched through
  the same path as a `list_item` action — so it actually runs, and it picks up the
  def's label, `visible`/`disabled` predicates, param dialog and capability gate,
  none of which the string form could carry. A name that matches an action already
  rendered as a def is dropped, which is what removes the dead twin. Names that
  resolve to nothing are still dispatched by name, since a consumer may have
  registered a runner handler under exactly that name.

  **② `ActionRunner`'s empty-schema fallthrough fails loudly.** It no longer
  reports success for an action it never ran: a dispatch with no registered
  handler and no `api`/`endpoint`/`navigate`/`redirect`/`onClick` returns a
  failure naming the action. Schema-only shapes that _do_ declare something — a
  bare `redirect`, an explicit `reload`/`close` — run exactly as before.

- ad0183a: fix(data-objectstack,core): an object filter no longer depends on whether the query expands a lookup

  #3072 single-sourced the ARRAY branch of the adapter's two `find()` routes. The
  object branch was left as it was: `convertQueryParams` converted a MongoDB-style
  filter to AST while `translateFilterToAST` returned it verbatim — so the same
  `$filter` went out in two formats, decided by whether the query happened to
  expand a lookup.

  Measured across 21 operator shapes, **four diverged**. Most of the gap turned
  out to be harmless — `{$and: […]}` survives the plain route as a
  `['$and','=',[…]]` comparison that `parseFilterAST` reads back as a real `$and`,
  and `$exists` vs `$null` is a difference the server treats identically. Two were
  not harmless:

  - **The unknown-operator guard only ran on one route.** `convertFiltersToAST`
    throws on an unrecognised operator, with a comment saying it does so "to avoid
    silent failure" — but the expanded route never called it, so a typo'd operator
    threw on a plain read and shipped silently whenever a lookup was expanded.
  - **`$regex` was silently rewritten to `contains`.** `$regex: 'a.c'` matches
    "abc"; `contains 'a.c'` matches only those three literal characters. That is a
    _different question_, not a weaker version of the same one, and neither result
    looks wrong on screen. The rewrite sat behind a `console.warn`, which is not
    an error channel in a deployed app — and the function's own unknown-operator
    message never listed `$regex` among the supported set. The spec has no
    `$regex` (`FILTER_OPERATORS`, `data/filter.zod.ts`), so there is nothing to
    translate it into: it is now refused, the same treatment the neighbouring
    unknown operator already got. Nothing in the repo depended on the conversion.

  Both refusals now throw `FilterOperatorError`, carrying `code: 'INVALID_FILTER'`
  / `httpStatus: 400`. The pre-existing unknown-operator throw was a bare `Error`,
  which `classifyLoadError` classifies as a network fault — so a malformed filter
  told the user to check their connection (#3066), the one thing it definitely
  was not.

- aa1240a: fix(sdui): lazily-registered public blocks reach a `kind:'react'` page's scope, and ReactRunner keeps the errors it catches

  Two defects in the trusted `kind:'react'` page tier.

  **objectui#2953 — the contract skipped lazy blocks.** `getPublicConfigs()`
  resolved every curated `PUBLIC_BLOCKS` tag through `getConfig()`, which reads
  loaded registrations only, so a block registered with `registerLazy()` was
  absent from the contract until its plugin chunk happened to be imported. In
  `apps/console` that silently dropped `object-kanban`, `object-calendar`,
  `object-gantt`, `object-timeline`, `object-map` and `markdown` from every react
  page's scope — writing `<ObjectKanban/>` threw `ReferenceError` even though the
  tag is a first-class contract member, and whether it threw depended on load
  order. `getPublicConfigs()` now resolves pending lazy stubs too, returning them
  with `lazy: true` and no `component` (new `PublicComponentConfig` type); the
  injected wrapper renders through `SchemaRenderer`, which triggers the loader and
  shows its placeholder. `getConfig()` stays loaded-only by design.

  **objectui#2954 — ReactRunner discarded its own error state.**
  `getDerivedStateFromProps` re-transpiled and re-evaluated the page source on
  every render and unconditionally set `error: null`. React runs it before the
  re-render that follows `getDerivedStateFromError`, so the boundary threw away
  the error it had just caught, rebuilt an identical throwing element, and the
  throw escaped past its own `fallback` to the renderer's generic panel; `onError`
  was gated on state that had already been cleared and never fired for a
  compile-time error at all; and each compile minted a fresh page function — a new
  element type — that remounted the subtree and wiped the page's `useState`. The
  transpile+eval is now memoised on `(code, scope)`, errors persist until the
  inputs actually change, and `onError` reports each error exactly once.

- d10f526: fix(sdui): the curated contract lists `record:line_items`, the tag that actually resolves

  `PUBLIC_BLOCKS` carried `line_items` — the bare tag. `@object-ui/plugin-form`
  registers the block as `record:line_items` with `skipFallback: true`, which
  exists precisely so the bare name is _not_ claimed, so that key never existed
  and the curated entry could never resolve. Its four siblings in the list are all
  `record:`-prefixed, and plugin-form's own comment says "Register
  record:line_items"; the bare spelling was a slip.

  The effect was a block that has shipped all along — a full renderer, a label,
  five declared `inputs` — being absent from the public contract, from the JSX
  type surface, from the generated manifest, and from every `kind:'react'` page's
  scope. It read as an unimplemented aspirational entry, which is how it was
  recorded when objectui#2979 added the contract-coverage guard.

  With the tag corrected the contract has no gaps left: all 36 curated tags
  resolve in the console, `record:line_items` among them with its full `inputs`.
  The guard's known-unimplemented list is now empty and stays asserted, so the
  next entry that cannot resolve surfaces instead of being explained away.

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

- 7f23cd0: fix(form): a numeric/boolean select option survives selection with its type intact — #3090

  `SelectOptionSchema.value` has accepted `string | number | boolean` for as
  long as it has existed, but the Radix controls underneath speak strings:
  picking `{ value: 2 }` silently submitted `"2"` — a wrong-typed write into a
  number field that nothing on the client ever reported. (Display half-worked:
  a numeric default matched its numeric item; only SELECTION morphed the type.)

  The renderers now stringify on the way into the control and map the selection
  back to the AUTHORED option value on the way out (`matchOptionValue`), across
  the in-form select, the standalone `type: 'select'` component, and the
  standalone `type: 'radio-group'` component. The TS types stop lying to match:
  `SelectOption.value` / `RadioOption.value` and the corresponding
  `value`/`defaultValue`/`onChange` channels widen to what the zod schemas
  always accepted — a call site treating `option.value` as `string` is now a
  compile error pointing at a real latent crash, not a false comfort.

  The ripple the widening named, handled at each boundary: `@object-ui/core`'s
  `OptionLike.value` widens (the option engines compare by identity, so values
  flow opaquely; the option-lint's CEL-literal domain stringifies at its
  boundary), and the multi-value field widgets (checkboxes / multiselect /
  radio) stringify at theirs — multi-value fields store string arrays.

  Round-trip pinned by real Radix interactions in jsdom: the in-form select
  submits `2` (number), the standalone select hands its handler `false`
  (boolean).

- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [38ca8be]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [4874117]
- Updated dependencies [ce08d55]
- Updated dependencies [2374a49]
- Updated dependencies [ea7f477]
- Updated dependencies [7f23cd0]
- Updated dependencies [24e0e0a]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [9867281]
  - @object-ui/types@17.1.0

## 17.0.0

### Minor Changes

- f9bbddb: feat: gate detail/form edit & delete on the server's effective operation set (#3546)

  PR-4 (#3391) wired the **list/toolbar** surface (ObjectView Import, ListView /
  ObjectGrid Export) to the server-resolved effective API operation set
  (`/me/permissions` `apiOperations`, intersected via
  `resolveCrudAffordances(obj, effectiveApiOperations?)`). The **detail / form**
  surfaces still gated edit/delete on the bucket + `userActions` alone. This
  extends the same intersection to them, so the record page and its forms never
  offer an operation the server would 405.

  - **core** `isObjectInlineEditable(obj, effectiveApiOperations?)` gains the same
    optional second argument as `resolveCrudAffordances` — inline-edit is now
    additionally ANDed with the server allowing `update`.
  - **app-shell** `RecordDetailView` threads the object's effective operations into
    the synthesized Edit/Delete header actions and the record-body inline-edit
    gate (`canEdit`); `RelatedRecordActionsBridge` intersects each **child**
    object's Create/Edit/Delete handlers with that child's own effective set.
  - **plugin-detail** `record:details` ANDs its inline-edit affordance with the
    object's effective `update`.
  - **plugin-form** `ObjectForm`'s blanket managed-object field lock also engages
    when the server denies `update` (edit mode) / `create` (create mode).

  Backward-compatible: a missing effective set (unrestricted object, older
  backend, or no `PermissionProvider`) leaves the resolved affordance untouched —
  the bucket/`userActions` decision wins, exactly as today. Layers on top of the
  existing per-object `check('edit')` / `check('delete')` permission gates
  (intersection, never union).

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

- 7b35e4b: fix(dashboard,charts): resolve `{current_user_id}` in widget filters (framework #3574)

  A dashboard widget filtered on `{current_user_id}` rendered `0`. The token
  reached SQL as a literal, matched no row, and nothing was logged on the client
  or the server — a silent zero that reads as "you have no work" rather than
  "this filter did not resolve". The same token in a list-view filter resolved
  correctly, so a user-scoped list and a user-scoped widget over the same data
  disagreed.

  There was no shared resolver. Three ad-hoc implementations had grown up
  independently — `ObjectView` for list views, `ObjectDataPage` for URL filter
  triples, `NavigationRenderer` for hrefs — and each understood only the filter
  shape its own surface used. `ObjectView`'s opened with
  `if (!Array.isArray(filter)) return filter`, so it could not have been reused
  by dashboard widgets even in principle: widget filters are MongoDB-style
  objects. Widgets therefore got no resolution at all — `DatasetWidget` called
  `resolveDateMacros` and nothing else, which is why `{today}` worked in a widget
  and `{current_user_id}` silently did not.

  - **`@object-ui/core`** — new `utils/filter-tokens.ts` with
    `resolveContextTokens` and `resolveFilterPlaceholders`. The latter expands
    _every_ placeholder vocabulary in one call and is what surfaces should use;
    resolving only some of them is the whole defect. The walk handles arrays and
    plain objects uniformly, so one resolver covers both platform filter shapes.
  - **`@object-ui/react`** — new `FilterScopeProvider` / `useFilterScope`. The
    renderer packages deliberately do not depend on `@object-ui/auth`, so the
    shell supplies the session values. This is a separate context from
    `PredicateScopeContext`, which is the expression evaluation scope and carries
    no organization.
  - **`@object-ui/plugin-dashboard` / `@object-ui/plugin-charts`** — all six
    widgets that previously resolved date macros only now resolve both
    vocabularies: `DatasetWidget`, `ObjectMetricWidget`, `ObjectDataTable`,
    `ObjectPivotTable`, and `ObjectChart` (dataset-bound and inline paths). The
    chart's `compareTo` comparison filter gets the session pass too — otherwise
    the overlay series silently ignored the owner clause the primary series
    honoured.
  - **`@object-ui/app-shell`** — `ObjectView`'s local `substituteFilterTokens`
    and `ObjectDataPage`'s inline `=== '{current_user_id}'` ternary now delegate
    to the shared resolver, so both also gain `{current_org_id}` and date macros.
    Two of the three ad-hoc implementations are gone rather than joined by a
    fourth.

  An unresolvable token is left intact rather than dropped: leaving it yields an
  empty result, whereas dropping the clause would _widen_ the result set and show
  a signed-out viewer everyone's data. It is no longer silent — the resolver
  warns, naming the token, and suggests the intended spelling for known
  near-misses (`{current_user}`, `{user_id}`, `{organization_id}`). Authoring-time
  enforcement lands separately as `filter-token-unknown` in `@objectstack/lint`.

- e16ed2d: fix(dashboard,charts): send widget `dateGranularity`/`sortBy`/`limit` to the query, and give funnels a real stage order (framework#3588)

  `DatasetWidget` never read `widget.options`. Four keys an author writes there
  change the query the server compiles, so a widget declaring
  `options: { dateGranularity: 'month' }` grouped by the raw timestamp and drew
  one bar per record, and `sortBy`/`sortOrder` produced no ordering at all.

  - `DatasetWidget` lowers `options.dateGranularity`, `options.sortBy` +
    `options.sortOrder`, and `options.limit` into the `DatasetSelection` it posts.
    A `sortBy` naming something the widget does not project is dropped rather than
    sent, so a stale sort key left by an edit degrades to "unordered" instead of
    failing the widget against the server's stricter validation. These keys also
    join the refetch signature, so editing one in the designer refetches instead
    of re-rendering the previous grid.
  - Funnel stages follow a **declared order**. `AdvancedChartImpl` sorted funnel
    segments by value descending, unconditionally — which overrode any server
    ordering and rendered a sales pipeline as a tidy narrowing shape whatever the
    stages' real sequence, hiding the very anomaly (a bulge at Proposal) the chart
    exists to show. It now honours a `categoryOrder`, which `DatasetWidget`
    derives from the dimension field's picklist option order — the pipeline order
    an author already declared on the object — or from an explicit
    `options.stageOrder`. With no declared order the value-descending default is
    unchanged, and a category missing from the order is kept (after the declared
    ones), never dropped.
  - New `@object-ui/core` helpers `buildCategoryOrder` / `buildCategoryRank`,
    keyed by both the stored value and the display label like the existing
    `buildOptionColorMap`, so ordering works whether or not the server resolved
    the dimension's labels.

  Requires the framework-side fix in objectstack#3588 for the selection keys to
  take effect server-side.

- 53642d4: fix(core,fields): a string `$orderby` is a clause, not a character array — and localize the sharing-rule widgets (objectstack#3821)

  **The recipient picker listed nothing, ever.** `QueryParams['$orderby']` was
  typed as `Record | string[] | SortObject[]`, so `queryParamsToRecord` sent any
  non-array value through `Object.entries`. Handed the clause string `'name asc'`
  — which callers do build by hand — it walked the string index by index and
  emitted `$orderby=0 n,1 a,2 m,3 e,4 ,5 a,6 s,7 c`. The server sorted by columns
  that don't exist and every row was filtered out, so
  `sys_sharing_rule.recipient_id` rendered "No matches" for every recipient type
  and no sharing rule could be created from the Console. `ObjectGrid` builds the
  same shape from a schema-level `sort` in three places, so grids with a string
  sort silently showed an empty table.

  A string `$orderby` is now passed through verbatim (the server's OData
  normalizer has always parsed `'name asc'`), and the type admits `string`.
  `RecipientPickerField` additionally switched to the structured
  `{ name: 'asc' }` form so it can't regress this way against any data source.

  **The three sharing-rule authoring widgets never had translations.**
  `ObjectRefField`, `RecipientPickerField` and `FilterConditionField` hardcoded
  their English copy — a Chinese Console showed "Select an object", "Select a
  user", "Search…", "No matches", "Edit as JSON". They now go through
  `useFieldTranslation` like every other widget, with keys added under `fields.*`
  in all ten locales.

  The recipient placeholder was the interesting one: it read
  `` `Select a ${recipientType.replace(/_/g,' ')}` ``, interpolating the enum
  value into an English sentence — a shape no locale can translate. It is now a
  per-type key (`fields.recipient.selectUser`, `…selectBusinessUnit`, …), so
  "选择业务单元" and "Select a business unit" no longer have to share a structure.

  **Editing a rule silently dropped its recipient.** The picker resets the stored
  id when `recipient_type` changes, because an id valid for a user is meaningless
  for a team. It treated the edit form's `'' → 'user'` hydration as such a change:
  opening any saved rule blanked the recipient, and saving persisted the blank.
  Only a non-empty predecessor now counts as a type switch.

  **Building a filter submitted the surrounding form.** None of `FilterBuilder`'s
  controls declared `type="button"`, and a bare `<button>` inside a `<form>`
  defaults to `type="submit"`. Adding, removing or clearing a condition therefore
  submitted the sharing-rule dialog — firing validation mid-edit, and on an
  already-valid form saving the record before the admin was done.

  **A rejected write showed the user raw server diagnostics.** The form rendered
  `error.message` verbatim, so a sharing / RLS denial reached the dialog and the
  toast as `FORBIDDEN: insufficient privileges to update showcase_private_note
pi-TgoJ4_DM55Fqz` — untranslated, and leaking the object's machine name and the
  record id to whoever hit it. Permission failures now render localized copy
  (`form.noPermissionToSave`, added in all ten locales), with the server text kept
  on the console for debugging; other failures still show the server's message,
  which is the useful part, and fall back to `form.submitFailed` when there is
  none — replacing the previously hardcoded English "An error occurred during
  submission".

  **The detail header offered "Edit" on records the user may only read.** Object
  permissions can't express "this one record is read-only" — a read-only sharing
  grant sits inside an object the user may otherwise edit — so the header showed
  the primary Edit CTA, opened the form, and let the user retype a field before
  the server rejected the save. `DetailView` now gates Edit / Delete on the
  object-level check AND on the explain engine's record-grained verdict
  (`POST /api/v1/security/explain` with a `recordId`, ADR-0090 D6 / ADR-0095 C2 —
  the same pipeline the enforcement middleware runs, so button and server cannot
  disagree). Explaining oneself needs no special permission. The probe is one
  cached request per record, skipped entirely when the object-level check already
  says no, and **fails open** on every uncertainty — an unanswered hint must never
  be the reason a permitted user cannot act; the server stays the authority
  (ADR-0057 D10).

  **A long option rendered straight past the combobox border.** `Combobox`'s
  trigger pinned itself to the component's `w-[200px]` default while the fields
  around it ran the full form column, and the selected label was a bare text child
  of a flex button — flex items need `truncate` AND `min-w-0` to clip, and it had
  neither. So "成员 (showcase_project_membership)" in the object picker overflowed
  the control and collided with the field beside it. The label now truncates, the
  trigger can shrink, the dropdown matches the trigger's width instead of a
  hardcoded 200px (a widened combobox used to clip its own options), and the two
  sharing-rule pickers ask for `w-full` so they line up with every other input.

  Hardens `evaluatePermission` while there: a role config carrying only
  `fieldPermissions` (no `actions`) made `check()` throw a TypeError that
  propagated out of the render. A permission check must not be able to crash a
  view.

  Browser-verified against the framework showcase Console in Chinese: object /
  criteria / recipient copy is fully localized, the recipient dropdown lists real
  users, business units and positions, a saved rule reopens with its recipient and
  criteria intact, editing the filter no longer submits, and a rule created
  end-to-end stores a real record id rather than free text. The criteria authored
  in the builder is honored by the evaluator: `{"pinned":true}` on an owner-private
  object granted the recipient exactly the matching records and nothing else.

- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [dfd3705]
- Updated dependencies [6dee2cb]
- Updated dependencies [c7cff19]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [d147a13]
  - @object-ui/types@17.0.0

## 16.1.0

### Minor Changes

- 1c8935a: feat(app-shell): render ActionParamDialog params through the shared form field-widget renderer (ADR-0059, #2700)

  `ActionParamDialog` no longer hand-rolls a per-type ternary chain (select /
  lookup / textarea / number / boolean, everything else → text input). Every
  declared action param now renders through the same `fieldWidgetMap` the object
  form uses, so a param of ANY form-supported field type — `file`, `image`,
  `richtext`, `markdown`, `color`, `address`, `code`, `date`, … — gets its real
  widget, lazily loaded behind `Suspense`. Subsumes the single `file` branch ask
  in #2698: `type: 'file'` params render the real `FileField` upload control via
  the ambient `UploadProvider`, honoring `multiple`/`accept`/`maxSize`.

  - `@object-ui/fields`: new exports `resolveFormWidgetType(type)` (widget-key
    resolution incl. spec aliases, text fallback) and `getLazyFieldWidget(type)`
    (per-type-cached `React.lazy` over the form's own widget loaders).
  - `@object-ui/core`: `ActionParamDef` gains `accept`/`maxSize`; `multiple` is
    now general widget config (was lookup-only).
  - `@object-ui/app-shell`: new pure `paramToField()` adapter (param → field
    shape) with a drift test pinning param support ⊇ form support (`FORM_FIELD_TYPES`),
    mirroring the FieldEditWidget parity guard; `resolveActionParams()` inherits
    `multiple`/`accept`/`maxSize` from the referenced field for every type.
    `required` validation, `visible` CEL gating, helpText, error styling, and
    value shapes for previously-supported types are unchanged.

- 2e7d7f0: feat(evaluator): route `{ dialect: 'cel' }` component/action predicates to the canonical CEL engine (#2661)

  Component and action `visible` / `disabled` / `hidden` predicates were evaluated
  by the home-grown JS `ExpressionEvaluator`, while field rules
  (`visibleWhen`/`readonlyWhen`/`requiredWhen`, via `fieldRules.ts`) and row/list
  conditionals (via `evalRowPredicate`) already delegate to the canonical
  `@objectstack/formula` engine. That split meant a `{ dialect: 'cel' }` predicate
  in a renderer/action surface was executed as **JavaScript** — CEL-only forms
  (`x in list`, `has()`, typed `==`, the `today()`/`daysFromNow()` catalog) behaved
  differently from, or faulted against, the server's enforcement.

  This converges the remaining tier onto the same engine:

  - **`@object-ui/core`** — `ExpressionEvaluator.evaluateCondition` now detects a
    `{ dialect: 'cel', source }` envelope and evaluates it on `@objectstack/formula`
    (via `evalFieldPredicate`), binding the `record` namespace plus the whole
    context bag as top-level scope (`record.*`, `features.*`, `user.*`, `app.*`).
    Fail-soft to visible/enabled to match the legacy default; `throwOnError`
    callers still fail closed on a _faulting_ predicate (a genuine `false` never
    throws). This fixes every `SchemaRenderer` visibility/disabled read at once.
  - **`@object-ui/react`** — `toPredicateInput` preserves a CEL envelope instead of
    collapsing it to a `${source}` string, and `useCondition` accepts and forwards
    the envelope (keyed on a stable `(dialect, source)` so it doesn't re-evaluate
    each render). Action buttons (`action-icon`/`group`/`bar`/`button`) therefore
    evaluate CEL `visible`/`enabled`/`disabled` on the canonical engine.

  **Back-compat:** bare strings and `${…}` templates stay on the legacy JS path
  (deprecation window); only an explicit `{ dialect: 'cel' }` envelope is rerouted.
  `{ dialect: 'template' }` is unaffected.

  Together with the `^15.1.1` alignment (#2662), a renderer CEL predicate now
  reaches the identical verdict as the server — including the framework's
  `dateField == today()` equality fix (objectstack-ai/objectstack#3205) once it
  lands in a published 15.x. The broader home-grown-vs-canonical divergence
  motivation is #2661.

- 31b77d4: **Add the explicit `engine-owned` lifecycle bucket (tracks framework ADR-0103 addendum / #3343).** The framework split the overloaded `managedBy: 'system'` bucket by promoting the engine-owned case to its own enum value; this mirrors it in the UI type + runtime + badge.

  - **`@object-ui/types`** — `ManagedByBucket` union and `MANAGED_BY_BUCKETS` gain `'engine-owned'` (canonical order: `platform, config, system, engine-owned, append-only, better-auth`). The union stays closed, so every consumer that missed the new value is a compile error.
  - **`@object-ui/core`** — `resolveCrudAffordances` gains the `engine-owned` default row (identical all-locked matrix as `system`/`append-only`), so `isObjectInlineEditable` / the grid + form gates treat it as read-only automatically.
  - **`@object-ui/app-shell`** — the `ManagedByBadge` renders `engine-owned` with the same read-only "System-managed" copy as a locked `system` object (reuses the existing `managedByBadge.system` i18n key — zero translation churn; the distinction is at the schema level, not the user-facing string), and `resolveManagedByEmptyState` reuses the `system` engine-owned empty state.

  Behaviour-preserving: `engine-owned` resolves to the same locked affordances `system` did by default, so nothing about how a locked object renders changes — the value just makes the schema self-documenting. New unit coverage for the bucket in `resolveCrudAffordances` / `isObjectInlineEditable` / `MANAGED_BY_BUCKETS` / the empty-state helper.

- 62b9ab5: feat(data): unify master-detail saves behind `DataSource.batchTransaction`, isolate the non-atomic fallback in the adapter (#2679)

  Master-detail saves (`MasterDetailForm`, `LineItemsPanel`) now always persist
  through `dataSource.batchTransaction(operations)` — one ordered cross-object
  operation list, with `{ $ref: <op index> }` linking a child to a parent created
  in the same batch. The form no longer contains any client-side orchestration or
  best-effort compensation-delete; that atomicity anti-pattern is gone from the UI
  layer (framework #1604 / framework ADR-0034 item 4).

  - **`@object-ui/types`** — `batchTransaction?` is now a first-class (optional)
    method on the `DataSource` contract, typed via `BatchTransactionOperation` /
    `BatchRef`. Replaces the previous `(dataSource as any).batchTransaction`
    method-sniffing.
  - **`@object-ui/core`** — new `emulateBatchTransaction(dataSource, operations)`
    (sequential writes, `$ref` resolution, best-effort reverse-order compensation)
    and `runBatchTransaction(dataSource, operations)` (prefers the adapter's method,
    emulates otherwise). `ApiDataSource` / `ValueDataSource` implement
    `batchTransaction` via the emulation.
  - **`@object-ui/data-objectstack`** — `ObjectStackAdapter.batchTransaction` uses
    the server's atomic `POST /api/v1/batch`, prefers the typed
    `client.data.batchTransaction` SDK method when the installed client exposes it,
    and degrades to the client-side emulation ONLY when the endpoint is missing
    (404/405) or the runtime can't do transactions (501). Real errors (400/401/403/
    409/500) still surface. This is the isolated, tested home of the non-atomic
    fallback.
  - **`@object-ui/plugin-form`** — removed `applyDetail` / `createMany` /
    `ApplyDetailResult` from `masterDetailTx.ts`; `MasterDetailForm` and
    `LineItemsPanel` build ops and call `runBatchTransaction`. `LineItemsPanel`
    saves are now atomic on a capable backend, with the rollup folded into the same
    batch.

  No behavior change on a current ObjectStack backend (it has `/api/v1/batch`);
  older/limited backends keep a working — now clearly non-atomic — save path.

- 1629313: feat(fields): RadioField per-option `visibleWhen` cascading + `dependsOn` gating; single-source the option resolver

  Brings `RadioField` to parity with `SelectField` / `MultiSelectField` for ADR-0058
  cascading & role-gated options, and collapses the three copies of the
  gate-then-filter logic onto one shared resolver.

  - **`@object-ui/core`**: new pure `resolveCascadingOptions(rawOptions, record, dependsOn, scope)`
    → `{ options, gated, dependsOnFields }` — the single source of truth for
    `dependsOn` gating + per-option `visibleWhen` filtering.
  - **`@object-ui/fields`**: `RadioField` now narrows its offered radios against
    the live record + `current_user`, gates behind a "select the parent first"
    hint while a `dependsOn` field is empty, and clears a value no longer offered
    (scalar cascade clear). The `useCascadingOptions` hook is refactored to a thin
    React wrapper over `resolveCascadingOptions`.
  - **`@object-ui/components`**: the form renderer's inline option pre-filter and
    cross-field cascade-clear effect now call `resolveCascadingOptions` instead of
    re-deriving gating/filtering, so they can't drift from the widgets (no
    behavior change).
  - Tests: `RadioField.cascade.test.tsx` mirrors the select cascade tests; core
    gains `resolveCascadingOptions` unit coverage.

- 2331ac9: feat(report): drill a date-bucket cell into its time range, not a superset (#1752)

  Clicking a report/dashboard cell grouped by a `dateGranularity` date dimension
  ("2026-Q2") used to drill into a **superset** — the date dimension was skipped,
  so the record list spanned every time bucket. It now scopes to the clicked
  bucket's half-open range, consuming the framework's new `drillRanges` sidecar.

  - **`@object-ui/core`** — `buildDatasetDrillFilter` accepts the per-row
    `drillRanges` and emits an ObjectQL range operator object
    (`{ [field]: { $gte, $lt } }`) alongside the equality dims.
  - **`@object-ui/plugin-report` / `@object-ui/plugin-dashboard`** — the report
    renderer and dashboard widget forward `drillRanges`, and a **date-only**
    report (no equality drill dim) is now drillable via the range alone.
  - **`@object-ui/app-shell`** — the "Open in list →" escape hatch
    (`useOpenRecordList`) now targets the ADR-0055 **bare data surface**
    (`/:object/data`, "the URL is the view" — no baked-in view filter to
    over-narrow the drill) and serializes a range to the
    `filter[field][gte|lt]` operator contract. `ObjectDataPage` parses those
    operators (equality shorthand unchanged), renders a range as a single chip,
    and removes both bounds together. A new `drillUrlFilters` module owns the
    write/read serialization so both sides can't drift (round-trip tested).

  Companion to the framework analytics change (objectstack-ai/objectstack#3256).

### Patch Changes

- 8b8b744: chore(deps): align `@objectstack/formula` / `lint` / `client` to `^15.1.1`

  These three were still pinned to `^14.6.0` while `@objectstack/spec` was already
  `^15.1.1` — a version skew from the v15 upgrade (formula/lint/client publish in
  lockstep with spec, and their own 15.0.0 entries are pure dependency bumps, so
  this is alignment, not a behavioral migration).

  Practical effect: the client-side field-rule evaluation
  (`visibleWhen`/`readonlyWhen`/`requiredWhen` via `fieldRules.ts`, which delegates
  to `@objectstack/formula`'s `ExpressionEngine`) now tracks the 15.x engine — and
  will pick up the framework's `dateField == today()` equality fix
  (objectstack-ai/objectstack#3205) automatically at the next 15.x release via the
  caret range. Renderer/action `visible`/`disabled` predicates are unaffected (they
  use the home-grown JS evaluator — tracked separately in #2661).

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

- 6d4fbe6: **Consolidate the `managedBy` lifecycle-bucket logic into one shared source of truth (follows framework ADR-0103).** The bucket taxonomy was hand-mirrored in several places — `crudAffordances.ts`, `ManagedByBadge.tsx` (its own `Bucket` union + `isWriteOptedIn` + the writable-system derivation), and `plugin-detail`'s `record-details.tsx` (`NON_EDITABLE_BUCKETS`, duplicated because it can't depend on app-shell) — a drift risk, and the object-schema `managedBy` type was open-ended (`(string & {})`) so unknown buckets slipped through and silently defaulted to fully-editable.

  - **`@object-ui/types`** now owns the closed `ManagedByBucket` union (+ `MANAGED_BY_BUCKETS`), and `ObjectSchema.managedBy` is tightened from `'platform' | 'better-auth' | (string & {})` to that union — unknown buckets are now a type error at authoring time.
  - **`@object-ui/core`** now owns the React-free runtime logic — `resolveCrudAffordances`, `isWriteOptedIn`, `isSystemWritable`, `isObjectInlineEditable` — reachable by every UI package including `plugin-detail` (which could not import app-shell).
  - **`app-shell/utils/crudAffordances.ts`** is now a thin re-export of `@object-ui/core` (existing imports keep working); `ManagedByBadge` consumes the shared `isSystemWritable`; `plugin-detail` `record-details.tsx` replaces its hand-mirrored `NON_EDITABLE_BUCKETS` with `isObjectInlineEditable`.

  Behavior-preserving — all existing affordance/edit-gate tests stay green; the shared module adds direct unit coverage (including the previously-untested `isSystemWritable` derivation). Translated copy (badge variants, empty-state messages) stays in app-shell.

- 0a3710b: **Finish the `managedBy` / `userActions` de-dup — one parser for the override shape (completes objectui#2712, framework#3343).** #2712 consolidated the bucket _union_ + affordance _set_ mirrors but left four surfaces still parsing the `userActions.{create,edit,delete}` override shape by hand. They now all route through the shared `@object-ui/core` policy, so no package re-implements the boolean / #2614-object-form parse locally.

  - **`@object-ui/core`** promotes the internal `normalizeOverride` to the exported **`normalizeUserAction(v, base)`** (the one parser) and adds **`userActionPredicates(v)`** for per-record CEL predicate extraction.
  - **`app-shell/utils/managedByEmptyState.ts`** — the writable-`system` create check and its local `EmptyStateUserActions` interface are replaced by `resolveCrudAffordances({ managedBy, userActions }).create`.
  - **`plugin-grid/rowCrudAffordances.ts`** — the local `isOptedOut` / `predicatesOf` helpers (and duplicated `RowCrudUserAction` / `RowCrudPredicates` types) fold into `normalizeUserAction`; the historical type names stay re-exported for compat.
  - **`plugin-detail/RelatedList.tsx`** — its inline `predicatesOf` fold into `userActionPredicates`.
  - **`plugin-form/ObjectForm.tsx`** — the hand-rolled `managedBy !== 'platform'` blanket lock + `userActions` unlock is replaced by the resolved affordance for the current mode (`edit` / `create`), the **same** `resolveCrudAffordances` contract the detail (`isObjectInlineEditable`) and grid surfaces use.

  Behavior-preserving for `platform` / `system` / `append-only` / `better-auth`, with one deliberate alignment: an admin-editable **`config`**-bucket object (e.g. `sys_webhook`, `sys_permission_set`) is now editable in `ObjectForm` — it was previously over-locked as "non-`platform`", while detail/grid already treated it as editable (`config` resolves `edit: true`). New unit coverage for the shared parser and the config / create-mode form gate; all existing affordance/edit-gate tests stay green.

- eee4ded: feat(fields): render `select` + `multiple` through the multi-value chip picker; restore fields/core lint gates

  - **Multi-value select** — a `select` field/param declared `multiple: true`
    now renders the multi-value chip picker (the `multiselect` widget) and stores
    a `string[]`, instead of collapsing to a single-value dropdown that could
    hold only one value. The delegation lives inside `SelectField`, so the object
    form, the inline grid editor, and the app-shell `ActionParamDialog` all
    inherit it from the one `select` widget with no per-surface drift. Single
    selects keep the cascading dropdown (multi + per-option `visibleWhen`
    cascading is not a combination in use today).
  - **`autonumber` mapping is unchanged** here; this change is orthogonal.
  - **Lint gates restored** — fixed the pre-existing baseline lint errors that
    had left the `@object-ui/fields` and `@object-ui/core` package lints red (so
    the gate could not catch new violations): `react-hooks/rules-of-hooks` in
    `ImageField` / `TextAreaField` / `index.tsx` (hooks hoisted above early
    returns; the `useFieldTranslate` hook no longer wrapped in try/catch), plus
    `no-useless-assignment` / `no-useless-escape` / `no-control-regex` /
    `prefer-const` / `preserve-caught-error` in the core evaluator and utils. No
    behavior change from the lint fixes.

- Updated dependencies [7cf4051]
- Updated dependencies [94d4876]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [62b9ab5]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [199fa83]
  - @object-ui/types@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
  - @object-ui/types@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0

## 14.1.0

### Minor Changes

- 0890fa7: feat(core): build-time guardrail for cascading select option predicates (#1583)

  `@object-ui/core` now exports `lintOptionPredicates(fields)` — a static,
  conservative validator for the per-option `visibleWhen` CEL predicates that
  drive cascading / role-gated `select` options (#2284). An option predicate fails
  _closed_ — a wrong one makes its option silently never appear — so this catches
  the class of bug runtime fail-open can't surface:

  - `syntax` — invalid CEL, delegated to `@objectstack/formula`'s
    `validateExpression` (no schema hint, so a legitimate `current_user.roles`
    reference is never mistaken for an error);
  - `unknown-field` — a `record.<name>` reference to a field the form never
    declares (a sibling typo);
  - `option-literal-not-in-domain` — a literal compared against an _enum_ sibling
    that is outside its declared option values, e.g. `record.country == 'chna'`
    when `country` is `cn`/`us` (the AI-authoring typo #2284 called out).

  It only flags what it can statically prove — non-`record.` roots
  (`current_user.*`), open-domain fields, and unrecognized shapes are left alone,
  so there are no false positives. The schema catalog runs it over every shipped
  example. Design recorded in ADR-0058.

- 5523fc4: Dashboard-level filters — the three #2578 item-5 enhancements (framework#2501):

  - **react**: nested `PageVariablesProvider`s now MERGE instead of shadowing
    wholesale. A filtered dashboard embedded in a Page with its own `variables`
    keeps the outer page variables readable inside widget subtrees (`page.*`);
    an inner definition shadows only the SAME name; writes route to the scope
    that defines the variable (writing an outer-defined name from inside the
    nested subtree updates the outer provider); `resetVariables` stays local.
    Names defined nowhere still write locally, exactly as before.
  - **core**: `buildWidgetScopedFilter` accepts an optional `knownFields` set —
    a DEFAULT binding whose target field is not on the widget's object is
    skipped with a console warning instead of emitting a query the backend
    empty-matches. Explicit `filterBindings` strings are always honoured (a
    typo surfaces as a visibly empty widget, never a silently dropped filter).
    Omitting `knownFields` preserves the previous unchecked behaviour.
  - **plugin-dashboard**: `DashboardRenderer` feeds `knownFields` from
    `dataSource.getObjectSchema` for inline `object` widgets (best-effort —
    unchecked while metadata loads or when the source can't describe objects).
    `optionsFrom` dynamic filter options now resolve DISTINCT values
    server-side via a dataset GROUP BY (`queryDataset` with an inline draft)
    when the data source supports it, falling back to the previous client-side
    top-200 dedupe otherwise.

- 887062c: feat(dashboard): dashboard-level filters (date / region) driving multiple charts (framework#2501)

  A dashboard's `dateRange` + `globalFilters` declarations are now wired end to
  end: the filter values live as dashboard-level variables (the page variables
  primitive, so they're also readable as `page.<name>` in widget expressions),
  a filter bar renders above the widgets, and at render time the dashboard
  broadcasts the active values into every bound widget's inline query —
  `AND`-merged with the widget's own `filter`. Charts stay inline and
  self-contained; each widget maps a filter to **its own** field.

  - **`@object-ui/types`** — `globalFilters[].name` (stable filter/variable key,
    defaults to `field`) and `DashboardWidgetSchema.filterBindings`
    (`Record<string, string | false>`: per-widget field override / `false`
    opt-out). Zod mirrors included. **Pending paired `@objectstack/spec`
    alignment (framework#2501)** — same precedent as `dataset` /
    `categoryGranularity`.
  - **`@object-ui/core`** — new pure `dashboard-filters` module
    (`resolveDashboardFilterDefs`, `dashboardFilterVariableDefs`,
    `buildFilterCondition`, `buildWidgetScopedFilter`); `mergeFilters` lifted
    from plugin-report (re-exported there unchanged). Date presets emit
    date-macro tokens (`{30_days_ago}` …) so widgets resolve them at query time
    like hand-authored filters.
  - **`@object-ui/plugin-dashboard`** — `DashboardFilterBar` (date presets +
    custom range calendar, select with static `options` or `optionsFrom`,
    text/number inputs, reset); `DashboardRenderer` mounts a
    `PageVariablesProvider` when filters are declared and merges the
    widget-scoped condition into inline widgets' `filter` and dataset widgets'
    `runtimeFilter`. Dashboards without filters render exactly as before.

  Binding precedence: explicit `filterBindings` string/`false` → legacy
  `targetWidgets` allow-list → the filter's own `field` (dateRange defaults to
  `created_at`). Static-data widgets are not filtered.

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

- 2ded18c: Fix: a dashboard filter declaring its static `options` in the
  `@objectstack/spec` object form (`options: [{ value, label }]` — the shape
  the spec validates and what framework-authored dashboards ship) crashed the
  whole dashboard with "Objects are not valid as a React child". Caught driving
  the showcase Revenue Pulse dashboard in a real browser.

  `resolveDashboardFilterDefs` now normalizes both the spec object form and the
  bare-string shorthand (`options: ['EMEA']`) to `{ value, label }` pairs —
  `DashboardFilterDef.options` is typed accordingly — and the filter bar's
  select renders labels (the trigger now shows the selected option's label, not
  its raw value). `@object-ui/types` aligns the `GlobalFilterSchema.options`
  shape with the spec union.

- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [887062c]
- Updated dependencies [9e2d58f]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f0f10f5]
  - @object-ui/types@14.1.0

## 14.0.0

### Patch Changes

- 443360a: Action params support a `visible` CEL predicate — the param dialog omits a param
  when it evaluates false, against the same scope as action `visible` (features /
  user / app / data). Fixes the create-user form offering a **Phone Number** field
  the default backend rejects ("Phone numbers require the phoneNumber auth plugin"):
  paired with the framework gating that param on `features.phoneNumber`, the form
  now follows the plugin — no phone field unless the opt-in phoneNumber auth plugin
  is loaded. `filterVisibleParams` is exported + unit-tested (feature-off hides,
  feature-on shows, malformed predicate fails open).
- 05e56ca: 导出/导入模板的下载文件名与内容本地化。

  **导出文件名**:CSV/Excel/JSON 导出下载不再是 `<对象名>.<扩展名>`(如 `contracts.csv`),改为「对象显示名-视图名-时间戳.扩展名」(如 `任务-In Progress-20260714-153045.xlsx`);`exportOptions.fileNamePrefix` 配置仍优先(且作为完整前缀,不再追加视图名)。视图名与对象名重复时自动省略;`@object-ui/core` 新增 `buildExportFileName(ext, { prefix, label, objectName, viewLabel }, now?)` 与 `sanitizeFileNameBase(raw)`,ObjectGrid 与 ListView 的所有导出路径(服务端流式与前端兜底)统一走它。app-shell/plugin-view 的 ObjectView 现将当前视图的显示标签写进传给 ListView 的 schema(`label`),使导出文件名能区分同一对象的不同保存视图。

  **导入模板**:「下载模板」修复两处英文漏出——示例行的 select/多选取值改为优先取选项**显示标签**(如 `准备中`)而非 ASCII slug(`prepare`,服务端导入两者都接受);模板文件名本地化为 `{{object}}-导入模板.csv`(新增 i18n key `grid.import.templateFileName`,英文回退 `{{object}}-import-template.csv`)。

- Updated dependencies [86c69c3]
- Updated dependencies [6a74160]
  - @object-ui/types@14.0.0

## 13.2.0

### Patch Changes

- @object-ui/types@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [619097e]
  - @object-ui/types@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [c31874d]
  - @object-ui/types@12.1.0

## 12.0.0

### Minor Changes

- 226fde9: Cascading & role-gated `select` options (#2284).

  `select` options now accept a per-option `visibleWhen` CEL predicate — the option
  is offered only when it evaluates TRUE against the live record **plus
  `current_user`** (same engine/env as a field-level `visibleWhen`). Combined with a
  field-level `dependsOn`, this drives dependent selects (country → province → city)
  and role/context gating with no bespoke matrix — the same primitives dependent
  lookups (#2215) already use.

  - `@object-ui/core` exposes `resolveVisibleOptions` / `isOptionGroupGated` /
    `resolveDependsOnFields` / `isValueStillOffered` (evaluator), reusing the
    canonical `evalFieldPredicate`.
  - The form renderer narrows a dependent select's option list, gates the control
    with a "Select {parent} first" hint while a `dependsOn` field is empty, and
    clears a now-invalid value when the parent changes.
  - The standalone `SelectField` widget applies the same resolution via
    `dependentValues` + the global predicate scope.

  Client-side hiding is UX, not authorization: gate authorization-sensitive option
  values on the server too. Aligns with `@objectstack/spec` `SelectOption.visibleWhen`.

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [9255686]
- Updated dependencies [1072701]
  - @object-ui/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [c38d107]
  - @object-ui/types@11.4.0

## 11.3.0

### Minor Changes

- d23d6eb: Three-tier AI page authoring: `kind:'html'` and a trusted `kind:'react'` tier.

  - **`@object-ui/react-runtime`** (new) — the trusted runtime-React tier for
    `kind:'react'` pages (vendored react-runner: Sucrase transpile + scope-eval,
    no sandbox). Renders real JSX/TSX (any HTML + JS + hooks/useState/map/onClick)
    in the main React tree with an injected scope (React, the public data blocks,
    page data) and a built-in error boundary.
  - **`@object-ui/core`** — new runtime capability gate (`enableCapability` /
    `disableCapability` / `isCapabilityEnabled`, `CAP_REACT_PAGES`). `react-pages`
    defaults **ON** (the platform trusts reviewed, draft-gated authors); a
    deployment turns it OFF server-side (the runtime injects the disable global
    when `OS_DISABLE_REACT_PAGES` is set). Never controlled from authored metadata.
  - **`@object-ui/components`** — PageRenderer now routes `kind:'react'`
    (capability-gated, lazy-loads the runtime) and renders `kind:'html'` (the
    former `kind:'jsx'`, still accepted as a deprecated alias). The `html` tier
    now resolves the full safe native HTML tag set (h1–h6, p, a, ul/ol/li, img,
    blockquote, pre, strong/em, …) so authored HTML lives up to its name.

### Patch Changes

- @object-ui/types@11.3.0

## 11.2.0

### Minor Changes

- 9e7a986: ADR-0080: AI-authored UI pages. New `@object-ui/sdui-parser` compiles a constrained JSX/HTML+Tailwind source into the SchemaNode tree (parse, never execute) with whitelist sanitization, manifest validation, and `.d.ts` codegen for the JSX type surface. `PageRenderer` renders `kind:'jsx'` pages; `ComponentRegistry` gains `tier` + `getPublicConfigs()` (capability vs contract).
- 1311749: ADR-0080 M5: curated PUBLIC block contract (capability ≠ contract). Adds `PUBLIC_BLOCKS` — the single, reviewable list of ~36 object-aware + layout/content blocks that form the AI/contract surface (Salesforce-App-Builder-shaped). `getPublicConfigs()` now returns the curated set (plus any `tier:'public'` opt-in), keyed by bare tag and deduped across the registry's dual-key registrations. The full ~244 registered types remain a rendering capability.

### Patch Changes

- @object-ui/types@11.2.0

## 11.1.0

### Patch Changes

- @object-ui/types@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0

## 7.1.0

### Patch Changes

- 08c47da: feat(dashboard): dataset chart widgets paint select/lookup dimensions in their option colors

  A dashboard `DatasetWidget` chart grouped by a select/lookup dimension (e.g.
  project `health`) painted its categories from the generic `--chart-1..5`
  palette — the same gap the chart view (`object-chart`) had before #1932. It now
  resolves the dimension field's option colors (using the dataset's base `object`

  - dimension→field map the query already returns) and threads them to the
    renderer as a per-category `categoryColors` map, so health green/red/yellow
    paints semantically.

  The value/label→color resolution is extracted into a shared `buildOptionColorMap`
  (`@object-ui/core`) now used by both `DatasetWidget` and `ObjectChart`.

- Updated dependencies [677f7ed]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0

## 7.0.0

### Minor Changes

- f7f325d: feat: action progress state + Undo affordance

  - **core**: `ActionResult.undo` (an `UndoableOperation`) and `ActionDef.undoable`.
    On success the `ActionRunner` pushes the operation onto the global UndoManager
    and the success toast carries an "Undo" affordance (`ToastHandler` gains an
    `undo` option).
  - **app-shell**: the console action runtime mounts `useGlobalUndo` (Ctrl+Z /
    Ctrl+Shift+Z) and renders the toast's "Undo" button; its `apiHandler` resolves
    the row id from the list row record and, for `undoable` actions, captures the
    changed fields' prior values so the update can be reverted.
  - **plugin-detail**: record-header quick-action buttons show a spinner + disable
    while the action runs (a visible progress state for slow/flow actions).

- c12986e: Add resultDialog + target interpolation for one-shot action reveals

  Some platform actions return values the user MUST copy now because the
  server will not surface them again — 2FA TOTP URI + backup codes, freshly
  minted OAuth client_secret, regenerated recovery codes. Previously these
  had to ship as bespoke pages in `apps/account` because actions only
  emitted a fire-and-forget toast.

  **`@object-ui/core` — ActionRunner**

  - New `ActionDef.resultDialog: ResultDialogSpec` field. When set on a
    successful action, the runner suppresses the `successMessage` toast and
    awaits the registered `ResultDialogHandler` instead. Missing handler is
    non-fatal (logs a warning); rejected handler is treated as acknowledged.
  - New `setResultDialogHandler(handler)` setter.
  - New types: `ResultDialogSpec`, `ResultDialogFieldSpec`,
    `ResultDialogHandler`.
  - `executeUrl` and `executeAPI` now run `${param.X}` and `${ctx.X}`
    interpolation against `target` before fetching / navigating. Values are
    `encodeURIComponent`'d, missing keys resolve to empty string. `ctx`
    exposes `origin`, `user`, `org`, `recordId` by default; consumers can
    inject more via `context.ctx`.

  **`@object-ui/react`**

  - `ActionProvider` and `useActionRunner` both gained an `onResultDialog`
    option that wires straight through to the runner.

  **`@object-ui/app-shell`**

  - New `ActionResultDialog` component — promise-based, blocks click-outside
    and Escape (the user MUST click acknowledge), renders five field
    formats: `qrcode` (client-side via the `qrcode` package — never sent
    off-device, so 2FA URIs stay secret), `code-list`, `secret`, `text`,
    `json`. Falls back to `json` when a value's shape doesn't match its
    declared format.
  - `ObjectView` and `RecordDetailView` install the handler and mount the
    dialog automatically, so any action with `resultDialog` declared in
    metadata now works without code changes.
  - New dependency: `qrcode@^1.5.x` for client-side QR rendering.

  Pairs with the framework-side `Action.resultDialog` schema added in
  `@objectstack/spec` and the `sys_two_factor` / `sys_oauth_application` /
  `sys_account` updates in `@objectstack/platform-objects`.

- 053c948: feat(app-shell): zero-roundtrip `newTabUrl` fast path for `opensInNewTab` actions

  Actions that declare `newTabUrl` (a path template with a `{recordId}` placeholder
  whose target endpoint performs all auth/authz itself) now drive the pre-opened
  popup straight to that URL on click, skipping the action POST entirely — applied
  to both server-action paths (list rows via `useConsoleActionRuntime`, record
  header via `RecordDetailView`). The popup paints the existing spinner page until
  the (possibly slow) endpoint commits its redirect; the URL is resolved absolute
  because `about:blank` gives a bare-relative href no reliable base. The
  popup-blocked toast fallback is unchanged. Removes one full round trip of
  white-screen latency from every such Open click.

- ddbe4a2: B2 step 3: client-side field-level conditional rules (`visibleWhen` / `readonlyWhen` / `requiredWhen`). The form renderer now evaluates these CEL predicates reactively against the live record and gates each field's visibility, read-only state, and required-ness accordingly. Evaluation delegates to the canonical `@objectstack/formula` `ExpressionEngine` — the _same_ dialect the server enforces (`requiredWhen` in the rule-validator, `readonlyWhen` in `stripReadonlyWhenFields`) — so the UX and the persisted verdict always agree. New core helpers `evalFieldPredicate` / `resolveFieldRuleState` (zero-React, fail-open). `FormField` gains `visibleWhen` / `readonlyWhen` / `requiredWhen` (+ deprecated `conditionalRequired` alias), and `ObjectForm` carries them through from object metadata.
- d54346c: feat: action/flow completion messaging

  - **core**: `ActionResult.silent` — a handler sets it when the action only
    HANDED OFF to a follow-up UI (rather than completing), so `ActionRunner`
    skips the automatic success toast. Fixes the misleading "Action completed
    successfully" toast that fired the moment a `flow` action opened its wizard.
  - **app-shell**: both flow handlers now return `silent: true` when the flow
    pauses at a screen (the wizard only opened — it hasn't completed). `FlowRunner`
    renders the flow's declared `successMessage` / `errorMessage` (from the
    terminal `AutomationResult`) instead of a generic "Done" / the raw error.

- 2270239: feat: scoped style-object rendering (ADR-0065)

  A metadata node may carry `responsiveStyles` (per-breakpoint CSS-property maps);
  `SchemaRenderer` compiles it to **id-scoped CSS** injected as a `<style>` tag and
  appends a scope class to the node. Build-independent (arbitrary values + design
  tokens pass through verbatim — no Tailwind JIT), collision-free (per-node scope,
  unlayered so it beats base utilities), responsive-correct (model breakpoint maps
  → generated `@media`, never `md:` variant classes). Adds `compileScopedStyles`/
  `scopeClassFor`/`hasResponsiveStyles` to `@object-ui/core` and an SDUI design-token
  palette (`--space-*`, `--surface`, `--brand`, …) to the theme. Mirrors Builder.io.

### Patch Changes

- 5976ba3: fix(core): evaluate bare CEL predicates in `evaluateCondition`

  `ExpressionEvaluator.evaluateCondition` delegated to `evaluate`, which only
  processes `${...}` templates and returns any other string verbatim. A bare
  predicate such as `record.status == "converted"` (the shape `objectstack build`
  emits for `disabled`/`visible`/`condition`) was therefore returned as a
  non-empty string and coerced to `true` — so every bare-expression predicate was
  silently always-truthy.

  The most visible symptom: a param-collecting `api` action invoked from the
  record header (e.g. CRM "Reassign Lead") was treated as permanently `disabled`,
  so `ActionRunner.execute` bailed before opening the param dialog. The renderer
  (`page:header`) was unaffected because it evaluates via `evaluateExpression`
  directly.

  `evaluateCondition` now treats a non-`${}` condition as a single expression
  (via `evaluateExpression`), keeps the `${...}` template path, and preserves the
  "empty/undefined ⇒ visible/enabled" and "unparseable ⇒ default visible/enabled"
  fallbacks. Also hardens `ActionRunner`'s `disabled` gate to evaluate the
  boolean/string/envelope form rather than treating any object as truthy, and
  unifies the grid row-action predicate scope so `record.*` and bare-field
  predicates resolve identically on every surface.

- eaccefd: fix(actions): warn when an action is hidden by a throwing `visible` predicate

  `ActionEngine.getActionsForLocation` is fail-closed: a `visible` predicate that
  throws hides the action. The most common cause is an authoring bug — a BARE
  field reference (`done` instead of `record.done`), which is undeclared in the
  `{ record, recordId, objectName, user }` eval scope. Hiding it silently made
  that bug invisible (a long debugging hunt). The catch now emits a one-time
  `console.warn` naming the action + predicate + error, with the `record.<field>`
  tip. Deduped per predicate so re-renders don't spam.

- 71d7ce0: fix(actions): handle `type: 'form'` in ActionRunner

  A `form` action had no `case` in `ActionRunner`'s execution switch, so it fell
  through to `executeActionSchema` and silently no-opped — clicking a Log-Time /
  "open form" action did nothing. Add `executeForm`, which opens the FormView as a
  routed page (`/forms/:name`, per the action spec) via the navigation handler,
  forwarding the current record id as `?recordId=` for hosts that support it.
  Covered by ActionRunner unit tests.

- 2d47e94: B2 follow-ups (A): field conditional rules in inline grids + submit-time enforcement.

  - **Grids**: a line-item column's `readonlyWhen` / `requiredWhen` CEL rule is now honored per row — `deriveMasterDetail` carries the props onto the `GridColumn` and `GridField` evaluates them against each row via `resolveFieldRuleState` (a `readonlyWhen`-TRUE cell locks; a `requiredWhen`-TRUE empty cell flags inline-invalid). Rules are row-scoped (`record.*`); the core helpers gained an optional `scope` (and `GridField` a `contextRecord` prop) so a future header-driven lock can bind `parent.*` — that wiring is deferred (it needs the master-detail header's re-renders isolated).
  - **Submit enforcement**: `requiredWhen` already drove react-hook-form's `required` rule, so submit is blocked with a field error when the predicate is TRUE and the value is empty. Added a reactive cleanup so a stale _required_ error clears when the predicate flips FALSE (and all errors clear when a field is hidden by `visibleWhen`).

- c3749eb: feat(dashboard): dataset chart widgets drill through to records

  Dataset-bound **chart** widgets (bar/line/pie/area/donut/funnel/…) are now
  click-drillable, matching table/pivot. Clicking a segment maps it back to its
  dataset row and opens the same governed drill drawer (raw group keys preserved),
  so a chart-only dashboard is no longer an exploration dead-end. This closes the
  "object-backed chart drills but dataset chart doesn't" inconsistency and aligns
  with mainstream BI (click a chart → see records).

  - `@object-ui/core`: `findChartSeriesRow` — inverse of `buildChartSeries`,
    maps a clicked `{category, series}` back to the source dataset row index
    (matches both dims when a 2nd dimension is pivoted into series).
  - `ObjectChart`: optional `onSegmentClick` lets a host own the chart click
    (and suppress the widget's own object-drill).
  - `DatasetWidget`: lifts the drill machinery to cover both table/pivot and
    chart, and wires the chart's segment click to the precise dataset drill.

- 1394e34: feat(chart): visualise the second dataset dimension as grouped series

  A dataset chart with two dimensions (e.g. `['status','priority']`) previously
  only rendered the first dimension — the second was invisible (repeated x-axis
  labels, no grouping). New shared `buildChartSeries` helper (`@object-ui/core`)
  pivots the second dimension into one series per value; `ObjectChart`
  (plugin-charts) and `DatasetWidget` (plugin-dashboard) both use it, so
  multi-dimension charts render consistently as grouped/coloured bars.

  Refs objectstack-ai/objectui#1759, objectstack-ai/objectstack#1890

- 7c239fd: Add `ComponentRegistry.unregister(type, namespace?)` — the inverse of
  `register()`. Clears the namespaced key and the bare-name fallback (when it
  still resolves to that registration) plus any matching lazy stub, and notifies
  subscribers only when something was removed. Lets callers (and tests) restore
  prior registry state cleanly.
- 8d1195d: Fix `type: 'url'` actions so they actually reach the backend in split-origin dev setups, and so reveal-once result dialogs render.

  - `ActionRunner.executeUrl`: when context provides `apiBase`, relative `/api/...`, `/_auth/...`, and `/_account/...` URLs are now promoted to absolute (`${apiBase}${path}`) before navigation. Same-origin API paths (with or without `apiBase`) trigger a full-page `window.location.href` rather than React-Router push — this is required for server-side OAuth redirect dances (e.g. better-auth `/sign-in/social`) that React Router would otherwise swallow into the SPA's fallback route.
  - `ActionRunner.buildInterpolationContext`: surfaces `ctx.apiBase` for action targets that want to template it explicitly.
  - `ObjectView`: passes `apiBase: import.meta.env.VITE_SERVER_URL` into the toolbar `ActionProvider` context so the above resolves.
  - `action-button` and `action-menu` renderers now forward `resultDialog` when invoking the runner. Previously this field was silently dropped by an explicit whitelist, breaking every "show once, then hide" flow (2FA QR/backup codes, OAuth client_secret, regenerated tokens).

- Updated dependencies [ddbe4a2]
- Updated dependencies [9049bbe]
- Updated dependencies [cb2fdb1]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [3870c20]
- Updated dependencies [b88c560]
- Updated dependencies [d16566f]
- Updated dependencies [300d755]
- Updated dependencies [4eb9cb6]
- Updated dependencies [858ad94]
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3

## 6.2.2

### Patch Changes

- @object-ui/types@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/types@6.2.0

## 6.1.0

### Minor Changes

- 991b62d: Add `compareTo` field to dashboard widgets for period-over-period
  comparison. Supports `'previousPeriod'`, `'previousYear'`, and
  `{ offset: '7d' | '4w' | '1M' | '1y' }`.

  - **Metric / gauge widgets** now compute a delta percentage when `compareTo`
    is set and surface it as a derived `trend` (auto-labelled via
    `dashboard.trend.vsLast*` i18n keys sniffed from the filter macros).
  - **Chart widgets** (line / area / bar / horizontal-bar / scatter / combo)
    overlay a muted comparison-period series (dashed line, lower fill opacity).
    Pie / donut / funnel ignore `compareTo`.
  - New core utilities: `shiftFilterByCompareTo`, `compareToTrendLabelKey`,
    `computeMetricDelta`, and `CompareToConfig` type.
  - `ChartSeries` now accepts `variant: 'comparison'`, `dashArray`, and
    `opacity` overrides for visual treatment.

  See `packages/plugin-dashboard/SKILL.md` for usage examples.

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/types@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1

## 5.2.0

### Minor Changes

- de0c5e6: Add `DataSource.bulkDelete(resource, ids)` as the symmetric counterpart
  to `bulkUpdate`. Implemented in `data-objectstack` via the client's
  `deleteMany` primitive with a per-id fallback that emulates
  `continueOnError` semantics for older clients.

  Extract the bulk-vs-per-row decision into a reusable
  `executeBulkBatch(input, ops)` helper in `@object-ui/core`:

  - Single decision tree shared by both update and delete fast paths.
  - Bulk success → no per-row pass.
  - Bulk partial-count → aggregate batch error.
  - Bulk throw → per-row fallback so users still get id-level error detail.

  `useBulkExecutor` in plugin-grid now uses the helper for both `update`
  and `delete` batches, cutting "delete 500 selected rows" from 500 HTTP
  requests down to ~3.

### Patch Changes

- d1442e3: test(core): comprehensive security + correctness tests for SafeExpressionParser

  Add a ~50-case suite covering literals, operators, ternary, property
  access, calls/arrows, and a full security section (blocks
  `constructor` / `__proto__` / `prototype` / `__defineGetter__` /
  `__defineSetter__`, denies `eval` / `Function` / `window` / `process`,
  rejects assignment syntax). No production code changes.

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [70b5570]
  - @object-ui/types@5.2.0

## 5.1.1

### Patch Changes

- @object-ui/types@5.1.1

## 5.1.0

### Minor Changes

- 5b80cfd: feat: Optimistic Concurrency Control (OCC) on DataSource writes

  `DataSource.update()` and `DataSource.delete()` now accept an optional fourth /
  third argument `opts?: { ifMatch?: string }`. When supplied, adapters forward
  the token to the backend; servers that implement OCC (e.g. ObjectStack
  `>=4.2.0`) compare it against the record's current `updated_at` and reject
  with `409 CONCURRENT_UPDATE` on mismatch, preventing silent overwrites in
  multi-user editing scenarios.

  **`@object-ui/data-objectstack`**

  - Exports `ConcurrentUpdateError` (carries `currentVersion` and
    `currentRecord`) and `isConcurrentUpdateError()` type guard.
  - `update()` / `delete()` accept `opts.ifMatch` and forward it via the
    `@objectstack/client` data API (header: `If-Match`). Requires
    `@objectstack/client@>=4.1.2` for the header to reach the server;
    older clients silently drop the option and fall back to today's
    "last writer wins" behaviour.
  - Adapter-level error handling maps a 409 with `code === 'CONCURRENT_UPDATE'`
    into a typed `ConcurrentUpdateError` so callers can detect and recover
    from conflicts without parsing the wire format.

  **`@object-ui/core`**

  - `ApiDataSource.update()` and `.delete()` accept `opts.ifMatch` and emit
    the `If-Match` HTTP header.

  UI consumers (Detail view, inline cell-edit) will be wired in a follow-up
  patch to capture `updated_at` at load time, pass it as `ifMatch` on save,
  and present a Reload / Overwrite / Cancel dialog on conflict.

### Patch Changes

- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
  - @object-ui/types@5.1.0

## 5.0.2

### Patch Changes

- @object-ui/types@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [7213027]
  - @object-ui/types@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0

## 4.6.0

### Patch Changes

- @object-ui/types@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
  - @object-ui/types@4.5.0

## 4.4.0

### Patch Changes

- @object-ui/types@4.4.0

## 4.3.1

### Patch Changes

- @object-ui/types@4.3.1

## 4.3.0

### Patch Changes

- @object-ui/types@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/types@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/types@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/types@4.0.8

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

  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- @object-ui/types@4.0.6

## 4.0.5

### Patch Changes

- @object-ui/types@4.0.5

## 4.0.4

### Patch Changes

- @object-ui/types@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/types@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2

## 3.3.1

### Patch Changes

- @object-ui/types@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/types@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2

## 3.0.1

### Patch Changes

- @object-ui/types@3.0.1

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

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/types@0.3.1

## 0.3.0

### Minor Changes

- Unified version across all packages to 0.3.0 for consistent versioning

## 0.2.2

### Patch Changes

- New plugin-object and ObjectQL SDK updates

  **Added:**

  - New Plugin: @object-ui/plugin-object - ObjectQL plugin for automatic table and form generation
    - ObjectTable: Auto-generates tables from ObjectQL object schemas
    - ObjectForm: Auto-generates forms from ObjectQL object schemas with create/edit/view modes
    - Full TypeScript support with comprehensive type definitions
  - Type Definitions: Added ObjectTableSchema and ObjectFormSchema to @object-ui/types
  - ObjectQL Integration: Enhanced ObjectQLDataSource with getObjectSchema() method using MetadataApiClient

  **Changed:**

  - Updated @objectql/sdk from ^1.8.3 to ^1.9.1
  - Updated @objectql/types from ^1.8.3 to ^1.9.1

- Updated dependencies
  - @object-ui/types@0.3.0

## 0.2.1

### Patch Changes

- Patch release: Add automated changeset workflow and CI/CD improvements

  This release includes infrastructure improvements:

  - Added changeset-based version management
  - Enhanced CI/CD workflows with GitHub Actions
  - Improved documentation for contributing and releasing

- Updated dependencies
  - @object-ui/types@0.2.1
