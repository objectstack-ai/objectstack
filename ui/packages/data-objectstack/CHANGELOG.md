# @object-ui/data-objectstack

## 18.1.0

### Minor Changes

- a14737b: Setup → Positions now says who holds each position and which permission sets it grants, and a click anywhere on a row opens the item (objectstack#25333).
  
  - **Two columns, both the server's.** The position list reads `GET /meta/position?include=grants`. **Holders** shows the served `_holderCount`, and **Permission sets** shows the served `_grantedPermissionSets` in the order the server sends them. The server computes both where the authorization resolver enforces them, and the console computes neither.
  - **The set a position grants by its name is shown, marked "(by name)".** That set shares the position's name, and the position-name fold grants it even though the definition does not list it (objectstack#24757). A tooltip says why it is there. Sets the definition lists carry no mark.
  - **A count nobody measured is "—", never 0.** That covers a count the server did not serve (`null`: no active organization, or a caller who may not read position assignments) and a server that predates `include=grants`.
  - **The whole row opens the item** on every Setup metadata list, as a record list's row does. The first cell keeps its link for the keyboard, screen readers and opening in a new tab. A click on a control in the row (the Active switch, Clone, a link) is still that control's. A modified click, a click that ends a text selection, and a click inside a dialog a row control opened do not open the row.
  - **`@object-ui/data-objectstack`**: `MetadataClient.list` / `listResponse` accept `include: 'grants'`, sent as the `include` query parameter.

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [49a536d]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [1d178e0]
- Updated dependencies [6fb31dc]
  - @object-ui/types@18.1.0
  - @object-ui/core@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- da35453: Objects with a picklist-bound field save again from the OWD overview, the Setup fields and objects pages, the metadata-admin embedded-item editor, and `MetadataService.saveFields` (objectui#11692).
  
  The runtime serves a field that names a shared picklist (`picklist: 'NAME'`) with the options it resolved from the list. The authoring door refuses `options` beside `picklist`, with `422 INVALID_METADATA` at `fields.FIELD.options`, and the refusal covers the whole object. objectui#10202 fixed the two designers that host the select-field editor. These writers also seed their save from a served object read, so they sent the resolved options back and were refused, whatever had been edited:
  
  - **Studio → Access → OWD overview.** Changing an object's sharing model and saving was refused.
  - **The Setup fields page** (`MetadataFieldsPage`). Editing any field of such an object was refused.
  - **The Setup objects page** (`MetadataObjectsPage`). Relabelling such an object was refused.
  - **The metadata-admin embedded-item editor** (`EmbeddedItemEditor`, opened from an object's fields, indexes or validations). Saving any item of such an object was refused.
  - **`MetadataService.saveFields`.** A field list built from the served object was refused.
  
  Each now leaves `options` out of every field that names a picklist, before the PUT. A field without `picklist` keeps its inline `options` unchanged, and no other key is touched.
  
  `dropServedPicklistOptions` is now exported from `@object-ui/data-objectstack`. It is the served-to-authored conversion these writers apply, and it moves here from `@object-ui/app-shell` (it was not exported there), because `@object-ui/plugin-designer` does not depend on `app-shell`. It is for code that builds an object PUT from a served read. `MetadataClient.save` does not apply it, and neither do `MetadataService.saveObject` and `MetadataService.saveMetadataItem`, which read nothing: a body that pairs `picklist` with `options` without a served read behind it is still refused by the server, with its prescription.
- b9814b3: Studio's first draft save after opening an item no longer replaces a draft that was saved elsewhere in the meantime (objectui#11773).
  
  Until now an editor's draft saves were pinned only from its second save on: the `/meta` draft read served no version, so two editors who each opened an item and saved it once overwrote each other's draft in silence. The `@objectstack/*` 18 draft read serves the version, and each editor's load now pins its first save to what it read:
  
  - an item with a pending draft is saved with `If-Match` and that draft's version;
  - an item with no pending draft is saved with `If-None-Match: *`, so a draft another editor created in the meantime is refused, not overwritten.
  
  The editors read the draft at the package their saves write to (`?package=`), since a read's version describes the row a save to the same address compares against. This covers the metadata editor, the permission matrix's package door, the Studio pillars (objects, flows, interfaces and app navigation), the list-view panel and the hooks panel.
  
  A create sends `If-None-Match: *`, so creating an item under a name that already holds a draft is refused instead of writing the new skeleton over it.
  
  In the conflict dialog, **Overwrite** now re-sends the draft pinned to the version the refusal names (`currentVersion`), so a save that lands while the dialog is open is refused and asked about again rather than overwritten. A server whose refusal names no `currentVersion` is overwritten unpinned, as before.
  
  `@object-ui/data-objectstack`: `MetadataClientSaveOptions` gains `ifNoneMatch?: '*'`, sent as `If-None-Match: *`. It never travels with `ifMatch`: `MetadataClient.save` throws before sending a request that sets both. The `ifMatch` docblock now names the token's real sources (the item read's `version`, a save receipt's `version`, a conflict's `currentVersion`) instead of "the `checksum` returned by the last read".
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- 6757a93: Show a write answer's advisory `warnings` to the user after save (objectui#12107).
  
  - `@object-ui/data-objectstack`: `WriteWarningEvent` gains an optional `warnings` member, typed by the spec's `ValidateDataIssue` (the element of `CreateDataResponseSchema` / `UpdateDataResponseSchema`'s `warnings`). A single-record `create` / `update` parses the answer's `warnings` through `ValidateDataIssueSchema` and emits the write-warning event when either `droppedFields` or `warnings` is non-empty; `droppedFields` stays required and is `[]` when the event exists only for warnings. An answer without the key emits nothing new, including from a runtime that predates it.
  - `@object-ui/app-shell`: the write-warning toast shows each distinct warning message as the server wrote it, in its own toast titled by the new `detail.writeWarningsTitle` key. The stripped-fields toast is unchanged.
  - `@object-ui/i18n`: adds `detail.writeWarningsTitle` to all ten packs.
- 43e1505: **A dashboard or a list view the server refuses you, opened by its URL, now says it was refused** (objectui#12112, the console half of objectstack#22611's ruling A).
  
  Since objectstack#22731 the server applies a dashboard's and a list view's `requiredPermissions`: its dashboard and view lists carry only what you may open, and a by-name read of one you may not answers `403 PERMISSION_DENIED`. The console read only the lists, so a refused dashboard's URL showed "Dashboard Not Found", and a refused list view's URL silently showed the object's default view instead.
  
  - **The dashboard page and the object's list page** ask a missed name by name. A `PERMISSION_DENIED` answer shows "You don't have access" with the server's own sentence, which names the item: `You do not have permission to open the 'NAME' dashboard.` (or `view`). Any other answer keeps today's face: "Dashboard Not Found", or the fall-back to the default view. Nothing is asked in draft preview, or by a host whose data source has no probe. The title reuses existing translations; no translation key is added.
  - **`@object-ui/data-objectstack`: `ObjectStackAdapter.probeMetaItemAccess(type, name)`**, and its result type `MetaItemAccess`. It is `probeAppAccess` for any type the by-name meta route gates per caller, and it also returns the refusal's `message` with a `denied` verdict. `probeAppAccess` now delegates to it and answers as before.
  - An object's own list view, served whole inside the object's metadata to a user who may edit the object, is still listed and opens. The server serves it to that user, and the console adds no rule of its own.
- dbc8c11: Studio's Automations rail and the open flow's Status pill read the automation engine's registration verdict, which the flow list now serves beside its items (`registrations`, `FlowRegistrationSchema` in `@objectstack/spec`). A flow the engine refused at boot reads "Refused by the engine", titled with the engine's message as sent, instead of "Unpublished draft" or "Enabled"; a flow the engine holds no registration for reads "Not running here". A registered flow, and a flow with no verdict, read as before, and the flow's stored `status` is never rewritten. `MetadataClient.listResponse` returns a list read with what the server serves beside the items; `list` is unchanged.
  
  **Clause-②: yes (widening).** `@object-ui/data-objectstack` gains one method, `MetadataClient.listResponse`, and one exported type, `MetadataListAnswer` (`items` plus the optional `registrations` of the spec's `GetMetaItemsResponse`). No export, prop or member is removed or changes type; `@object-ui/app-shell`'s exports are unchanged.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
- 919d5cd: "Publish all" publishes each language of a package-less email template by its own bundle member (objectui#12402, the publish half of objectui#12271).
  
  Since `@objectstack/spec` 18.0.0-next.1 each `GET /meta/_drafts` row carries `member` for a type whose identity is a pair (today only `email_template`, `(name, locale)`), and the by-name publish door reads it back as `?member=`. A publish that names no member promotes the canonical member's draft, so two languages of one template drafted outside a package were published as the canonical one twice.
  
  - **`MetadataClient.publishDraft(type, name, options?)`** takes an optional `{ member }` and sends `?member=` when it is set. Without one the parameter is omitted, never sent empty. This widens the method's accepted arguments; a two-argument call sends exactly the request it sent before.
  - **`usePublishAllDrafts`** (Home's "Publish all" and the draft-preview bar) keeps each draft row's `member` and passes it on the package-less path. Rows without a member send no selector.
  - **Unchanged:** package-bound drafts still publish through `publishPackageDrafts(packageId)`.
- 431cece: `MetadataDraftHeader`, the row type `MetadataClient.listDrafts()` declares, now declares `member` (objectui#12413).
  
  `@objectstack/spec` declares `ListDraftsResponseSchema.drafts[].member`, an optional string, and `GET /meta/_drafts` serves it on every draft of a type whose identity is a pair (today `email_template`, `(name, locale)`). The published row type had no `member`, so a reader had to cast the row to reach it.
  
  - **`@object-ui/data-objectstack`, additive widening.** `MetadataDraftHeader` is now derived from the spec row by `Pick` over `type`, `name`, `member`, `packageId`, `updatedAt` and `updatedBy`. The five keys it declared before keep their exact types; `member?: string` is the one key added. Nothing is removed or narrowed. `MetadataSaveAdvisoryEvent` gains an optional `member`, set by `publishDraft()` when the publish named one, so an advisory raised on one language's publish is attributed to that member. Every other door emits the event as before, without the key.
  - **`@object-ui/app-shell`, no behaviour change.** The publish-all hook reads each draft row's `member` through the declared type instead of an `any[]` cast. The URLs it sends are unchanged.
- caac3b2: A list's sort, column layout, Filter panel and tab order are now each user's own, and follow them to another browser (objectui#12418).
  
  **What changes for users.** Sorting a list, resizing or moving its columns, and dragging the tabs in Manage Views is now personal: it no longer changes the view for everyone. Before this change, a header sort or a column drag was saved into the shared view, and a Manage Views drag saved a new order onto every saved view, so one user's click re-sorted or reordered the list for every other user. Under a walled tenancy posture (`group` or `isolated`), where only the platform operator may write environment metadata, the same click ended in an error. The view's own sort, columns, filter and tab order stay the default for every user who has not changed them, and the view editor (the view settings panel and Studio) is still how an author changes them for everyone. Density and hidden fields are not part of this change: they are still saved to the view.
  
  - **Where it is kept.** One `sys_user_preference` row per user and object, key `ui.list.<object>`, holding `{ viewOrder, perView: { <view id>: { sort, filters, columnState } } }`. The console reads every such row in its one preference read at load (objectui#12187), so this adds no request. localStorage (`list-state:<user>:<object>`) is the write-through cache, and the only store when no preference backend is attached. The first read of an object with nothing cached takes that browser's older tab order (`viewOrder:<object>`) and Filter panel conditions (`list-filters:…`). The search term stays where it was.
  - **Opening a list.** A list now opens on the user's stored sort and Filter panel conditions, and the page waits until the preference read has answered (2.5 s at most) before drawing it. A link that carries list state still wins over the stored state, as before (objectui#11860).
  - **Resetting.** The Filter panel's "Clear all" clears the user's stored filters for the view. A new "Reset view" entry in the page header's ⋯ menu, beside the favorites entry, appears when the user has stored anything for the active view. It drops that view's sort, filters and column layout and opens the list as the view declares it. An administrator can delete a user's row under Setup → User Preferences.
  
  `@object-ui/data-objectstack` adds `createObjectStackUserPreferenceFamily` (with the `UserPreferenceFamily` and `ObjectStackUserPreferenceFamilyOptions` types and the `PREFERENCE_FAMILY_ROW_LIMIT` constant). It loads every row whose key starts with a prefix, through the same shared read as the per-key adapters. A read that includes a prefix asks for its keys or that prefix, with a `$top` of the key count plus 200 rows per prefix. When an answer fills that `$top`, a key whose row is missing from it reads its own row. `createObjectStackUserStateAdapter` keeps its signature and its behaviour.
  
  `@object-ui/i18n` adds `console.objectView.resetView` and `console.objectView.resetViewTitle` in all ten packs.
- 3eb3ec1: The console's list toolbar no longer has a write into the shared view, and the data-source method that write used is retired (objectui#12504).
  
  **BREAKING:** `DataSource.updateViewConfig` is removed from `@object-ui/types`, and `ObjectStackAdapter.updateViewConfig` is removed from `@object-ui/data-objectstack`. The capability gate that only that method read goes with it: `ObjectStackAdapter.setSystemCapabilities`, the `systemCapabilities` option of the adapter constructor and of `createObjectStackAdapter`, `VIEW_CONFIG_CAPABILITY`, `ViewConfigPermissionDeniedError` and `isViewConfigPermissionDeniedError`. A class that implements `DataSource` and keeps an `updateViewConfig` method still compiles, but nothing calls the method any more; an object literal annotated as `DataSource` that carries it is refused as an unknown property. Code that calls `updateViewConfig` through a `DataSource` or an `ObjectStackAdapter`, or imports one of the gate names, no longer compiles. To change a view for everyone, save the view: `createView` / `updateView` on the data source, or the console's view editor, which writes through the runtime metadata seam.
  
  Since objectui#12418 and objectui#12474, the toolbar's sort, column layout, density and Hide Fields are each user's own list state, so the toolbar write had no caller. The view editor's explicit save is now the one write path to the shared view, and it is unchanged.
  
  Personalization rows that earlier consoles wrote into `/meta/view` stay readable: the overlay marker, `narrowPersonalizationOverlay` and `listViews()` exclusion still apply to them. Nothing new writes such a row.
  
  `@object-ui/i18n` drops `console.objectView.viewConfigPermissionDenied` from all ten packs. It was the toast the retired write raised when the gate refused it. The other packages change only in comments and tests that named the retired path.
- 3bcf314: Studio marks the settings the AI copilot drafted: a Draft chip and a Source line ("Added as a draft by the AI copilot 2 min ago") on a field or a list-view setting the copilot changed, read from the platform's per-key draft provenance (objectui#12725, item 3; objectstack#24298 and #24395).
  
  - **`@object-ui/data-objectstack` reads and writes the provenance.** The strict draft read (`getDraft`) serves `draftChanges` beside `item`: one `{ path, by, actor, at }` per changed key path. New exports beside `extractDraftBody`: `readDraftChanges(resp)` (the envelope's entries, or `null` when the read recorded none, never `[]`), `governingDraftChange(changes, path)` (the entry that answers for a key: the longest prefix), `draftChangesUnder(changes, path)`, and the `DraftChange` type, derived from `@objectstack/spec`'s `GetMetaItemResponse`. `MetadataClientSaveOptions` gains `surface?: 'studio' | 'api'`, sent once as `?surface=`, derived from the spec's `MetadataAuthoringSurface` minus `copilot` (the HTTP doors refuse it). `MetadataDeleteOptions` no longer inherits it: the delete door reads no such parameter.
  - **Studio's own draft saves declare `surface: 'studio'`,** so a person's edit there is recorded as `studio`, not `api`.
  - **The marks.** The Data pillar's field properties show the chip and the Source line when the field's entry, or an entry under it, is the copilot's. An `object` leaf's list-view properties show the chip on each setting the copilot changed (card fields, title, click to open, group by, columns, filter, sort), mark the elements it added to an array setting by comparing the draft's array with the published one, and end with a Source line naming them. A `studio` or `api` entry draws nothing, and so does a draft whose read recorded no provenance. To compare arrays, the list-view panel reads the published layer beside a draft when, and only when, the draft carries a copilot entry.
  
  The new copy lives in the metadata-admin designer's own string tables (en and zh).
- 6058bf8: Studio's Changes drawer can now fill a new field's default into the records an object already holds, when you publish (objectui#12929).
  
  - **The choice.** In the drawer, under a field that a pending draft adds to an already-published object, an unchecked "Backfill default (N existing records)" choice appears when the field declares a literal `defaultValue`. N is the object's record count, read as you. If the count read gives no total, the choice shows no number. A field whose default is a runtime token (`NOW()`, `current_user`) or an expression, a field with no default, and the fields of an object that has never been published get no choice. The publish door refuses those with a 400, and there are no existing records to fill.
  - **The publish.** Publish all sends the checked fields as the protocol's opt-in `backfill` (objectstack#24253). The server writes each field's default into the existing records that have no value, as you, with permissions and record hooks applied. The publish toast then shows the rows the server says it wrote for each field. If a field stopped short, the toast is a warning that gives the server's reason, and the publish still stands. If nothing is checked, the publish request is `{}`, the same as before, and no existing record is written.
  - **`MetadataClient.publishPackageDrafts(packageId, options?)`** (`@object-ui/data-objectstack`) takes `options.backfill`, an array of `{ object, field }`. Its type is picked from `@objectstack/client`'s `packages.publishDrafts`. The method sends `backfill` only when it is given. The receipt is `backfillApplied` on the result. A call without options sends the `{}` body it always sent.
  - **New strings:** `preview.changes.backfillOption` (a count family) and `preview.changes.backfillOptionNoCount` in all ten `@object-ui/i18n` packs. The Studio table gains `engine.studio.backfillWritten` and `engine.studio.backfillStopped` (en and zh).
- 088e0f7: A record-form field can name one item of a metadata registry by its machine name: a `text` field that declares `widget: 'position-ref'` lists the position registry, and one that declares `widget: 'permission-ref'` lists the permission-set registry. It stores the name only (objectui#7611, ruling B2 on objectstack#22865). This is the mechanism the metadata forms' `ref-multi:permission` picker brought in (objectui#12126), now reachable from an ObjectQL object field. A grant table's name field (`sys_user_position`'s position, `sys_user_permission_set.permission_set`) can now offer the declared items instead of a box for a typed name.
  
  - **The widget (`@object-ui/fields`).** `field:position-ref` and `field:permission-ref`, one key per registry type, with the type in the key, as `object-ref` carries `object`. Like every `widget` value, the name is looked up as `field:<widget>`. Each item reads as its label beside its name, and a pick writes the name: no label, no id. A stored name the loaded registry does not list stays on screen as its own option, flagged *not found*. The four catalog arms follow the metadata forms' `ref:dataset` / `ref-multi:<type>` pickers. With no data source that can list a registry, the field is a text box for the typed name. While the list loads, the stored name sits in a disabled box. When the load fails, a notice names the failure and its cause, and the text box stays enabled. A loaded but empty registry gives the same text box. Neither key is a declarable field type: both are widget hints, like `object-ref`.
  - **The catalog (`@object-ui/types`, `@object-ui/data-objectstack`).** `DataSource` gains an optional `listMetadataItems(type)`, answering `{ name, label }` headers for one registry type. An empty array is authoritative ("this registry has no item of this type"), so a failed load must reject, never resolve `[]`. `ObjectStackAdapter` implements it over `GET /api/v1/meta/:type` (the client's `meta.getItems`). It rejects with the transport's error, and refuses an answer that carries no `items` list. It is uncached, so an item authored in Studio shows on the next form.
  - **Locale keys (`@object-ui/i18n`).** `fields.registryRef.loadFailed` and `fields.registryRef.notFound`, in all ten packs.
  - **Wiring.** The form renderer threads `dataSource` to both keys, as it does for the other widget-hint pickers (`@object-ui/components`). The inline-grid exclusion set and the action-param value-shape table list both keys as widget-hint-only (`@object-ui/fields`, `@object-ui/app-shell`). The CLI's generated `KNOWN_SCHEMA_TYPES` gains `field:position-ref` and `field:permission-ref` (`@object-ui/cli`). A comment in `@object-ui/core` stops counting the picker names.
  
  **Clause-②: yes (widening)**: one optional `DataSource` member, two registered `field:` keys (the `RegisteredFieldWidgetType` union and `FORM_FIELD_TYPES` gain two members), and two locale keys. Nothing narrows: a field without the hint renders exactly as before.
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

- 4590363: A record open no longer sends the same record read twice at once, and asks each explain question once, with concurrent callers sharing the request (objectui#11699).
  
  A record page open sent `GET /api/v1/data/OBJ/ID` twice at the same moment and `POST /api/v1/security/explain` four times: the `update` and the `delete` question, each asked twice. Both reads came from the details block, whose load effect runs again while its first read is still on the wire. Each question was asked by the page header and by the details block, which mounts while the header's answer is still pending. The record page's own `$expand` read of the record, which it sends again when the object definition changes identity, is not changed here.
  
  - **`ObjectStackAdapter.findOne` shares an in-flight read**, the way `find` already did. Calls for the same resource, id and params that arrive while a read is pending get that read's answer. The entry is dropped when the read settles, so a later call reads again: this is not a response cache. A failed read reaches every caller that shared it and is not remembered. A write through the adapter (`create`, `update`, `delete`, the bulk and batch writes) drops the pending `findOne` reads of the resource it wrote, so a record read asked after a save never gets an answer sent before it.
  - **The record-level edit and delete probe (`useRecordEditable`) shares an unanswered question.** Mounts asking the same question (same principal, object, record and operation) while it is pending wait on one request. A question whose record changes while it is pending is not shared, so the re-ask is a fresh request. No pending question is shared across a change of the signed-in principal.
  
  Nothing is added to either package entry: no export, prop, type member or language-pack key. `findOne` keeps its signature.
- 4a9fe31: Studio shows a refused save as a sentence the author can act on, with the technical detail behind a "Details" disclosure (objectui#11785).
  
  - **Studio's save strips.** The Data, Automations and Interfaces pages used to print the refusal verbatim: the write guard's developer prose, or the server's raw issue paths such as `nodes.2.config.title — …`. Each strip now shows one sentence that names the input the refusal is about, in the terms the editor shows. On the Data page that is the field's label. On the Automations page it is the step's label and the inspector input, so a refusal at `nodes.2.config.title` reads "Check Title on the step “Notify approver” — …". On the Interfaces page it is the navigation item and its input. A "Show me" button opens that field, step or navigation item. The raw text stays under a closed "Details" disclosure, unchanged. A path Studio cannot place on the open page keeps its line there, and the sentence says the draft was refused.
  - **A Picklist with no options.** Switching a field to Picklist before it has an option now says "Changes not saved: the field “Status” needs at least one option…", instead of the guard's message.
  - **The object write guard's message names no code.** `assertObjectMetadataWritable` no longer prints the door's class name, a package name or tracker ids. Its message is the same at every door, so the other surfaces that show it as their banner read the field, its type and the remedy. Its signature, error type and exports are unchanged.
  
  `formatMetadataError` is unchanged, so every other surface that calls it prints what it printed before. Nothing is added to either package entry: no export, prop, type member or language-pack key. The new sentences are rows in the metadata-admin designer's own string tables (en and zh).
- 6d8bf0c: Opening a Studio package no longer sends the same read several times at once (objectui#11797).
  
  Several readers mount together on Studio entry and each one used to send its own request for the same answer. A caller that arrives while an identical request is still pending now waits for that request instead of sending another:
  
  - **`@object-ui/app-shell`:** the package list (`GET /api/v1/packages`, read by the Studio package switcher, the read-only gate and the object-name namespace lookup) and the pending-drafts count (`GET /api/v1/meta/_drafts`, read by the Studio top bar and the chat bar).
  - **`@object-ui/data-objectstack`:** `MetadataClient.listTypes`, `list`, `listDrafts`, `get` and `getDraft`. Requests are shared between clients built on the same `fetch`, so the per-component clients the console creates share them too. Each caller, the first one included, still gets an answer object that no other caller holds.
  
  This is not a response cache. Once a request settles, the next call goes to the server again. A failed request is shared only by the callers already waiting, and the next call retries. A write the reader can see drops any read still pending, so a read made after the write never gets the answer of a request sent before it. For the metadata client that is any save, publish or reset through a client on the same `fetch`. For the app-shell reads it is a package duplicate, the `objectui:packages-changed` announcement and the publish refresh pulse.
  
  No exported function, method signature, option or type changes.
- 5dff027: Studio stops asking questions whose expected answer is an error, so the browser console no longer fills with red lines that hide real failures (objectui#11799).
  
  - **`MetadataClient.getDraft()` reads the drafts ledger first.** It reads `GET /meta/_drafts` through the client's shared read, and sends `GET /meta/:type/:name?state=draft` only when the ledger lists the name. An item with no draft no longer logs a 404. The method still resolves `null` when there is no draft and the draft envelope when there is one. A draft saved a moment ago is found, because a write drops the ledger read that was pending when it landed. A ledger the caller cannot read (403, 501, a network fault) counts as unknown, and the item read is sent as before.
  - **Studio reads an item's published baseline only when it uses it.** The Interfaces pillar's leaves and the Automations pillar's flows read `GET /meta/:type/:name/layers` only for an item with no pending draft, and the Interfaces pillar reads none for an app found only in the drafts ledger. An item that was never saved always has a draft, so it no longer logs a 404 for `/layers`. Opening a leaf or a flow now waits for the ledger before it reads the item, one round trip more than the parallel reads it replaces. The Data pillar still reads `/layers` for an object that was never published: that answer is how it tells it has no records table yet.
  - **The AI usage indicator asks nothing while AI is off.** It reads `GET /ai/usage` only while the agent catalog at its base lists an agent, the signal the console gates every AI entry point on. On an open-edition server, Studio's copilot dock no longer logs a 501 for it each time it mounts.
  
  No REST answer, export, prop or type member changes.
- d48071e: A console page load reads `sys_user_preference` once, not once per preference key (objectui#12187).
  
  - **The user-state adapters share one read per load.** `createObjectStackUserStateAdapter`'s `load()` now joins an open read for its data source, resource and user. Every load of that scope issued before the next microtask adds its key, the read is sent once, and each adapter takes its own row from the answer. The console's favorites, recent items and flow palette recents used to make three requests, one per key; they now make one, `user_id = USER and key in (the three keys)`, with `$top` set to the number of keys. The object's unique index on `(user_id, key)` bounds the answer to one row per key.
  - **A read that collects one key is unchanged.** It sends the same per-key query, `$top: 1`, as before.
  - **Nothing is kept past the request.** The read closes when it is sent. A later `load()`, such as a new adapter after a language or account switch, asks the server again. A different user or data source never joins another's read.
  - **Writes are unchanged.** `save()` still finds and writes its own row, and the stored rows and their shape are the same.
  
  No export, option or type changes.
- 40cb13b: The connection state follows the requests the console already makes, so the header chip now shows a mid-session outage (objectui#12295).
  
  Until now the adapter set its connection state only while making the first connection. Once that had succeeded, no failed request could change it, so a backend that stopped mid-session left stale rows on screen and the header chip hidden.
  
  - **A request with no HTTP answer** (refused, reset, unreachable) moves the state to `reconnecting`. Once the adapter's own retry window is spent, it moves to `error`. The window is the same `autoReconnect` / `maxReconnectAttempts` budget a failed first connection gets, counted in unanswered requests. The state stays there until a request is answered, and the header chip stays visible the whole time.
  - **The next answered request** moves it back to `connected`, and the chip hides again after its brief "Connected" flash.
  - **An answered HTTP error does not move it.** A 4xx or 5xx means the server is reachable. A request its caller aborted does not move it either.
  
  The adapter adds no timer, no heartbeat and no request of its own: the state changes when a request the host makes settles. Every request goes through the adapter's one fetch, including those made through `getClient()`, except `uploadFile` / `uploadFiles`: those two call the global `fetch`, so an upload's outcome does not move the state. The fetch hands its response or rejection to the caller unchanged. Nothing is added to the package entry: no export, option, type member or language-pack key.
- 068a540: The console's Setup › Apps page reports what the server did with a write (objectui#12300). Before, a Delete and a Disable could report success for a write that changed nothing.
  
  - **Delete.** When the reset door answers `reset: false` (there was no customization row to remove, so the app already is what its package ships), the page shows a neutral notice with the server's own sentence and never says "deleted". The row stays, because the server still serves it.
  - **Disable, Set as default and the bulk Enable / Disable.** A save of an app that a package owns now names that package (`?package=`, read off the served `_packageId`), so it lands on the row the server serves. A package-less app is saved with no scope, as before.
  - After every write, whatever it answered, the page re-reads the app list and shows the served state.
  
  `ObjectStackAdapter` forwards every argument of `getClient().meta.saveItem`. Its save-advisory wrapper used to pass on only `type`, `name` and `item`, so the SDK's options bag (`packageId`, `force`, `mode`, `ifMatch`) was dropped before it reached the wire, for every caller of the adapter's client.
  
  Two new `appManagement.toast` keys, `nothingToDelete` and `alreadyAtDefault`, ship in all ten language packs.
- 866763b: A failed first `connect()` with `autoReconnect` now retries discovery and settles (objectui#12318). The retry used to call `connect()` from inside the attempt it was retrying. `connect()` hands every caller the attempt in flight, so the retry waited on itself: one discovery read, a state stuck at `reconnecting`, and a promise that never settled. A console opened while its backend was down never finished starting, even after the backend came back.
  
  - **Each retry is a new discovery read**, after the existing backoff (`reconnectDelay` × 2^(n-1)), up to `maxReconnectAttempts` times.
  - **`connect()` settles.** It resolves once discovery answers, and the state ends `connected`. Once the retries are spent it rejects with the last attempt's `ConnectionError`, and the state ends `error`.
  - **Concurrent callers still share one attempt**, including a caller that arrives during the backoff.
  
  Nothing is added to the package entry: no export, option or type member. The state sequence of a failed attempt is unchanged: `error`, then `reconnecting` while retries remain.
- d12bc5f: A console reset, delete or draft discard names the package whose row it removes (objectui#12335, the consumer half of objectstack#23165).
  
  Since `@objectstack/rest` 18.0.0-next.1 the metadata delete door reads `?package=`. A delete that names no package addresses the one package that holds the item; when two or more packages hold it the door refuses `409 RESOURCE_CONFLICT`, deletes nothing, and names `?package=` as the remedy. The console could not send that remedy.
  
  - **`MetadataClient.reset()`** now sends `?package=` when `options.packageId` is set, beside `?state=draft` for a draft discard, with the spelling `save()` and `publish()` use. Without a binding the parameter is omitted, never sent empty. Its options type already declared `packageId` (inherited by `MetadataDeleteOptions`); `reset()` used to drop it. No exported type changes.
  - **The metadata editor** (`MetadataResourceEditPage`): Reset/Delete and "Discard draft" state the package the editor's save and publish already state, read from `?package=` on the editor URL (the `all` scope names none). An editor with no package sends none, and a refusal is shown on the page's error line in the server's words.
  - **The Objects page** (`MetadataObjectsPage`, `@object-ui/plugin-designer`): deleting an object states the package the listed row is served from (its `_packageId`). A row no package owns, including one served with the `sys_metadata` sentinel, sends none, and a refusal is shown in the page's error panel.
  - **Unchanged:** the runtime draft bar's Discard and the adapter's `deleteView` hold no package binding, so they keep the package-less delete. Their refusals already reach the caller: the draft bar shows the server's message in its error toast, and `deleteView` throws.
- cfbca7f: `deleteView` now shows the server's reason when the published half of a view delete is refused (objectui#12416).
  
  `ObjectStackAdapter.deleteView` deletes a view's draft home, then its published home. When the published delete failed, the adapter threw its own sentence ("… is NOT fully removed … retry the delete") and kept the server's error only on `cause`. `formatMetadataError(err)` reads the error's issues or its own message, so the console's Delete view toast showed the adapter's sentence and hid the server's reason. For the `409 RESOURCE_CONFLICT` a package-less delete of a view two packages hold gets since `@objectstack/rest` 18.0.0-next.1, that reason is the `?package=` remedy, and the toast told the user to retry a delete that cannot succeed.
  
  The thrown error's message is now the adapter's sentence followed, on the next line, by the server's reason as `formatMetadataError` renders it (its issue lines, or else the served message unchanged). The sentence still says the view is not fully removed and the published row still serves it. It says "retry the delete" only when the failure is not a 4xx refusal. `cause` and `outcome` are unchanged. A refusal of the draft half is thrown as served, as before.
- 35ef750: `aggregate()` no longer reads a served `null` measure as a missing one. The analytics answer's `null` (the max or min over rows whose field is all NULL) now reaches the caller as `null` from the single analytics request; only a measure key that is absent from the answer falls back to re-reading the rows through `find()`. This removes a second, row-reading request from every widget bound to such an aggregate.
- 65fe4c2: One page open asks the server for one object document once (objectui#13044). The metadata provider's by-name object read now goes through the adapter's `getObjectSchema`, so the page's object scope and the record form, `useSettledSchema` and the field widgets share one `GET /meta/object/NAME`. The published view list (`GET /meta/view`) is shared while a request is on the wire: the provider's eager view read, `listViews` and `listViewOverrides` join it instead of each sending its own, and nothing is stored, so a later read, a refresh or a view write still asks the server. An organization or session switch clears the adapter's metadata cache. Each reader still gets its own copy, in the shape it got before; the draft-preview path is unchanged.
- cd4623d: One object-page open reads the published view list (`GET /meta/view`) once (objectui#13057). The adapter now stores the list its client read and answers `listViews` and `listViewOverrides` from it, so the provider's eager view read serves the page's two readers. The client read itself still always asks the server. Every path that should see a fresh list drops it first: a refresh of the object page, every view write (through the adapter, its client, or the console's `MetadataClient`, whose view saves, publishes, resets, rollbacks and package publishes now drop it), and an organization or session switch. The package sheet's *Publish app* now announces the publish like every other publish path, so open views, forms and navigation re-read what went live. The draft-preview list read is unchanged and never fills the stored list.
- 12ff256: `ConnectionState` is re-exported from `@object-ui/types` instead of being declared a second time here (objectui#6349, batch 10). `@object-ui/collaboration` declared the same five states for `useRealtimeSubscription`, so both packages now publish the one declaration under the same name. The union is unchanged, and so are `getConnectionState()`, `ConnectionStateEvent` and every import of `ConnectionState` from this package.
  
  No runtime behaviour changes.
- 1b2d016: Doc comments only. `UserDataAdapter` now carries the contract notes `@object-ui/app-shell` kept on its own copy of the interface: implementations must be safe to call concurrently and should never throw, so the hosting provider can degrade to localStorage when the backend fails. `@object-ui/app-shell` now re-exports this declaration instead of declaring a second one (objectui#6349, batch 9). The type and its members are unchanged.
  
  No runtime behaviour changes.
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
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [aaba865]
- Updated dependencies [45d5853]
- Updated dependencies [2312bd9]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [2a48bd4]
- Updated dependencies [c7b30bd]
- Updated dependencies [69bca0a]
- Updated dependencies [023f00d]
- Updated dependencies [158c75d]
- Updated dependencies [7525045]
- Updated dependencies [5af42db]
- Updated dependencies [5f75cfa]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [334f0cf]
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
- Updated dependencies [260ef71]
- Updated dependencies [26323c4]
- Updated dependencies [c219165]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [025130c]
- Updated dependencies [8aa8e3e]
- Updated dependencies [2493e85]
- Updated dependencies [a928aaa]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [cbac9d7]
- Updated dependencies [616df65]
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
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [b403bb3]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/core@18.0.0

## 17.7.0

### Minor Changes

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
- 1563d3e: The object-metadata write guard now holds a `select` / `radio` field that has no option source.
  
  This is the objectui half of the maintainer's ruling A on objectstack#20827, which refuses a
  `select` / `radio` with neither `options` nor `picklist` at the `FieldSchema` door and has objectui
  stop sending one first. The rule lives in the existing door guard, so `MetadataClient.save`,
  `importObjectDraft` and `MetadataService` all apply it, for every writer behind them.
  
  BREAKING (behaviour, released as `minor` per this repository's version policy):
  `assertObjectMetadataWritable('object', …)`, and so `MetadataClient.save('object', …)`, now throws
  BEFORE issuing the request when a `select` or `radio` field carries neither a non-empty `options`
  list nor a `picklist` string. `options: []` counts as none, as the contract's own completeness rule
  reads it. Unlike the relationship rule, this refuses a document the installed server still accepts:
  the ruling orders the client first on purpose, and the door follows. The message names the field
  and asks for an option, a shared `picklist`, or a non-choice type. A field that names a `picklist`
  is never refused by this rule.
  
  The Studio data page and the metadata-admin object editor already surface the refusal in their
  error banner and send the next autosave once an option exists, including for an object that already
  stores such a field.
  
  New export: `CHOICE_TYPES_REQUIRING_OPTIONS`, derived by this package's pin from the installed
  `@objectstack/spec`'s `field/choice-without-options` completeness rule.
- d893290: `formatMetadataError` and `formatMetadataIssue` are exported from `@object-ui/data-objectstack`: the one reader of a failed metadata save (objectui#11302).
  
  A save the spec refuses answers `422 INVALID_METADATA` with a headline message (a count plus `path [code]` locators) and the author's prescription in structured issues, which `MetadataClient` puts on `MetadataError.issues`. `formatMetadataError(err)` lists those issues one field per line (`• fields.amount.type — Required`) and falls back to the error's message when there are none; `formatMetadataIssue(issue)` is that one-line grammar, for callers that format a list of failures. Render the result with a whitespace class that keeps newlines.
  
  The reader moved here from `@object-ui/app-shell`, where it was internal, so every surface that saves through `MetadataClient` can render a refusal the same way. Additive: nothing existing changed.
- 993f312: Parse a write-strip's `reason` against the spec enum at the boundary
  (objectui#4934).
  
  `notifyDroppedFields` filtered a create/update response's `droppedFields` on
  SHAPE alone — a hand-written `e is DroppedFieldsEvent` guard that checked
  `Array.isArray(fields)` and nothing else — so a `reason` outside
  `'readonly' | 'readonly_when' | 'primary_key'` reached every subscriber typed as
  though it were inside the union. A deployed client normally runs BEHIND the
  server it talks to, so a reason from the future is the expected skew direction,
  not a corrupt payload; the interior was typed to trust a union no one had
  checked, and nothing in the repo could say so. `notifyBatchDroppedFields` did
  the same through its `entry as DroppedFieldsEvent & { index?: number }` cast.
  
  Both paths now read `reason` against `DroppedFieldsEventSchema.shape.reason` —
  the enum the installed pin declares, derived rather than restated, so a pin bump
  that adds an arm widens the accept set on its own:
  
  - **Every entry is kept.** Dropping the unparsable ones would tell the user
    nothing about fields the server really did strip, which is exactly the silence
    objectui#3484 removed.
  - An unrecognized `reason` arrives on a named skew arm,
    `UnrecognizedDropReasonEvent`, carrying `UNRECOGNIZED_DROP_REASON` plus the
    wire value **verbatim** in `unrecognizedReason` — never coerced onto a known
    arm, because claiming `readonly` for a reason we cannot name is a false
    statement about the user's data.
  - `WriteWarningEvent['droppedFields']` is therefore the two-arm
    `DroppedFieldsNotice`. The spec type stays the canonical arm and is not
    widened to `string` (objectui#3160): the skew arm is not assignable to
    `DroppedFieldsEvent`, so a consumer branching on `reason` now hears about
    server skew from `tsc` instead of from a per-consumer discipline.
  
  Runtime wording is unchanged: the one reader, the app shell's write-warning
  toast, already answered an unrecognized reason with its cause-free line.
  
  **Blast radius — the compile error IS the intended signal, not a regression.** A
  consumer that branches exhaustively on `reason` — a parameter, a `Map` key or a
  `Record` annotated `DroppedFieldsEvent['reason']` — stops compiling against this
  release, with a `TS2345` at each such site. That error is the notification, and
  the only one: the skew arm is deliberately NOT assignable to the spec union, so
  `tsc` reports server skew at the one place the wire is read rather than leaving
  it to a per-consumer discipline. Do not cast it away. Widen the annotation to
  `DroppedFieldsNotice['reason']`, and where the two arms have to be told apart,
  narrow with `entry.reason === UNRECOGNIZED_DROP_REASON` and read the wire value
  verbatim from `unrecognizedReason`.
  
  Widen the LOOKUPS, not the table. A `Record` that must stay exhaustive over the
  SPEC arms keeps its `DroppedFieldsEvent['reason']` key: widening that one would
  trade away the guarantee that a newly pinned spec reason fails `type-check`
  unworded (objectui#3935).
  
  In this repo the entire blast radius is the app shell's write-warning toast —
  two type annotations, no runtime change. Its executable JavaScript is byte-identical
  and its wording tests pass unchanged, because the file was already written for
  this value: its own docstring says the runtime `reason` may sit outside the spec
  union and that the cause-free fallback is reachable, not dead. Only the parameter
  and the `Map` key had been left narrower than that documented contract.
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
- 94e2fa7: `MetadataClient.layered()` validates the ADR-0010 protection envelope against the
  producer's own schema at the boundary, instead of casting ten wire fields through
  unchecked (objectui#5676, triage adjudication 2026-08-22).
  
  The envelope arrived by ten `as` assertions over a raw `res.json()` body — no parse, no
  allowlist, no default. The consumer that reads it opens the metadata lock banner on
  `layered?.lock && layered.lock !== 'none'`, true for **any** non-`none` value, so a server
  sending a lock state this console had never heard of opened the amber box, drew the padlock
  and the border, and rendered an empty title. No fifth state ever had to be added to this
  repo for that to happen: a union types what this repo writes and constrains nothing about
  what a server sends.
  
  The boundary now runs `GetMetaItemLayeredResponseSchema.safeParse`. On the conforming path
  every value is the producer's schema output and the ten assertions are gone. `safeParse`
  and never `parse`: a metadata console that rejected every dialect it had not been compiled
  against would answer a newer server with a blank page, which is strictly worse than the
  wrong render being fixed. Values the schema rejects are still **forwarded** — dropping them
  would be that same refused rejection wearing different clothes — and are named in a new
  optional `MetadataLayered._unrecognized`, absent whenever everything parsed. This extends
  to the whole envelope the "pass through and label" treatment objectui#5672 chose for `lock`
  alone; the banner's existing unrecognised-token title is unchanged and needed no edit.
  
  The labelling is per field, which is the part that makes it a degrade rather than a subtler
  version of the same bug. Measured on the installed spec (17.2.0):
  `GetMetaItemLayeredResponseSchema.safeParse(body)` is all-or-nothing — one unknown `lock`
  returns `success: false` with `data` undefined — so the failure branch re-checks each key
  against that schema's own `shape[key]`, where only the offending field fails and the other
  six still arrive typed. Absence is never "unrecognised": the four resolved verdicts are
  required upstream on this path, so a pre-ADR-0010 backend takes the failure branch with
  nothing flagged and behaves exactly as before.
  
  One consequence of the same ruling, fixed alongside because it defeats it: a 200 answer
  whose body was a bare JSON string or number **rejected** the promise with a
  `TypeError: Cannot use 'in' operator`, from the envelope-detection guard's bare truthiness
  check. A malformed body must degrade, never throw.
- f07b976: `aggregate()`'s spec-shape branch now REFUSES an unlowered `where` instead of
  posting it (objectui#6825, maintainer ruling 2026-08-30 — option A).
  
  **Breaking for callers that were already broken, so read this if you call
  `aggregate()` with a `where`.** `aggregate()` has two branches. The analytics
  branch takes `filter` and lowers a rule-shaped array before the wire (#6302).
  The spec-shape branch — entered when `params` carries an array `groupBy`, an
  array `aggregations`, or ANY `where` key — takes `where` and posts it to
  `POST /data/:object/query` verbatim. It never lowered, and it still does not:
  it now says so.
  
  **What now throws that previously went through.** A `where` that is an ARRAY
  the spec's own `isFilterAST` gate rejects — an unlowered
  `[{ field, operator, value }, ...]` above all, plus the infix join dialect
  (`[condA, 'or', condB]`), a tuple whose operator is outside the AST vocabulary,
  `['and']` with nothing to join, and an element that is not a condition. The
  throw is an `UnloweredAggregateWhereError` (exported), carrying the same
  `code: 'INVALID_FILTER'` / `httpStatus: 400` pair as `MalformedFilterError`, so
  `isMalformedFilterError()` recognises it and a failed widget renders "this
  filter is malformed" rather than "check your connection".
  
  **This adds no new failure — it relocates one.** Every shape now refused is one
  the receiving engine already refused (`is not a filter`, 400 `INVALID_FILTER`,
  before the store is touched). What changed is WHERE you find out and whether you
  can act on it: previously the predicate was lost on the wire — or dropped
  outright, leaving a chart rendering confident, wrong numbers with no signal to
  its author. The refusal is now raised at the producer, names the value it
  received, names the shape expected and where the spec declares it, and says
  nothing was sent.
  
  **What an affected caller should send instead.** Lower the rules to a filter AST
  BEFORE calling `aggregate()`:
  
  ```diff
  - adapter.aggregate('opportunity', {
  -   groupBy: ['stage'], aggregations: [...],
  -   where: [{ field: 'stage', operator: 'equals', value: 'won' }],
  - })
  + adapter.aggregate('opportunity', {
  +   groupBy: ['stage'], aggregations: [...],
  +   where: ['stage', '=', 'won'],
  + })
  ```
  
  Or keep using the analytics branch, which lowers for you: pass the rules under
  `filter` with the legacy `field` / `function` / `groupBy` params.
  
  **Unchanged, deliberately.** The analytics branch still lowers `filter` exactly
  as #6302 left it. On the spec-shape branch a `FilterCondition` object
  (`{ stage: 'won' }` — what `QuerySchema.where` actually declares), an empty
  array (`[]` is "no filter", and the engine agrees), and every already-valid
  filter AST all reach `client.data.query` byte-unchanged.
- 503cd8b: `aggregate()`'s spec-shape branch now REFUSES the analytics branch's `filter` /
  `field` / `function` instead of dropping them (extending the
  maintainer ruling of 2026-08-30 on objectui#6825 — option A, refuse at the
  producer).
  
  **Breaking for callers that were already broken, so read this if you call
  `aggregate()` with an ARRAY `groupBy`.** The spec-shape branch — entered when
  `params` carries an array `groupBy`, an array `aggregations`, or any `where`
  key — builds its request from exactly four keys: `groupBy`, `aggregations`,
  `where`, `limit`. `filter`, `field` and `function` are the OTHER branch's
  parameters, and they were neither read, nor refused, nor warned about: they
  were simply absent from the body that went to `POST /data/:object/query`.
  
  **Why that was worse than the `where` half #6825 fixed.** `field` + `function`
  are the analytics branch's whole measure, and this branch takes a measure only
  out of `aggregations`. So the legacy shape `{ field, function, groupBy, filter }`
  whose `groupBy` happened to be an ARRAY produced a query carrying a `groupBy`
  and **no aggregations at all** — a grouping with no measure — with the author's
  filter gone as well. The chart rendered, the numbers were wrong, and there was
  nothing on screen or on the wire to look at.
  
  **What now throws that previously went through.** A spec-shape call carrying a
  non-nullish `filter`, `field` or `function` throws the new
  `AnalyticsKeysOnSpecShapeError`. It carries the `INVALID_FILTER` / 400 pair its
  siblings carry (so `isMalformedFilterError()` recognises it and a failed widget
  renders "this filter is malformed" rather than "check your connection"), plus
  `keys` — the offending key names — and `received`, what each one carried. The
  message names each key, says what its spec-shape equivalent is, states which
  `looksLikeSpecShape` disjunct put the call on this branch, and says outright
  when the resulting query would have had no measure. Nothing is sent to the
  server, so no unfiltered numbers come back.
  
  **What is deliberately NOT refused.** The legacy analytics shape (a STRING
  `groupBy`) is untouched and still lowers `filter` and still fuses
  `field` + `function` into its measure — the refusal lives inside the spec-shape
  branch only. A key that is present but nullish (`filter: undefined`) carries
  nothing to drop and passes, so params built by spreading possibly-absent
  authored values keep working. And keys outside those three (`orderBy`, a future
  spec key, any host extra) are not refused: the gate names three keys, and only
  those.
  
  **Migration.** Pick one shape per call. Spec-shape: `{ groupBy: GroupByNode[],
  aggregations: AggregationNode[], where?, limit? }`, with `where` already lowered.
  Analytics: `{ field, function, groupBy: string, filter? }`, which lowers `filter`
  for you. `AnalyticsKeysOnSpecShapeError` is exported from
  `@object-ui/data-objectstack`.
- ce986aa: Studio's "publish whole app" reports the runtime authoring gate's per-draft
  advisories (server half objectstack#9343).
  
  `POST /packages/:id/publish-drafts` began answering `advisories` on each
  `published[]` element when objectstack#9343 landed, but the author publishing a
  whole app was still told nothing: both client call sites bypassed the data-layer
  seam — a bare `fetch` in `usePublishAllDrafts` and the page-private `apiJson` in
  `PackagesPage`, whose declared response type held two counts and `failed[]`, with
  no `published[]` at all. The same button's own client-side capability lint was
  raising a toast the whole time, so a finding from the server was the one thing
  that could not reach the person pressing it.
  
  - `MetadataClient.publishPackageDrafts(packageId)` expresses the route and emits
    one advisory event per advised `published[]` element — each naming that
    element's own `type` / `name` — into the sink, event and renderer the save and
    single-item publish doors already use. Both call sites go through it.
  - The batch door reports `door: 'publish'` rather than a third discriminator
    value: every item the event names really was published, and the renderer's
    only door-dependent output is that verb. The per-item identity the author
    needs rides `type` / `name`, one event per item.
  - It renders only what the server sent where `PublishPackageDraftsResponseSchema`
    declares it. A half-shaped finding, an element that cannot name its item, and a
    top-level `advisories` the ruled shape does not put there all report nothing —
    pinned, alongside the presence, in `metadata-client.publishAdvisories.test.ts`,
    whose absence pin this flips.
  - `publishPackageDrafts` returns the batch body derived from the spec schema, so
    a caller reading `failed[]` / `publishedCount` reads a declared shape. Non-2xx
    raises the usual `MetadataError`; the 2xx batch verdict stays the caller's to
    judge, because `success: false` is not a refusal on this route.
- 512bc90: `aggregate()` reads the analytics answer in ONE spelling: `rows` on the `AnalyticsResult` that `client.analytics.query` resolves to (objectui#7028). The `{ success, data: { rows } }` envelope is no longer accepted at this site.
  
  `@objectstack/client` 17.3.0 converged `analytics.query` on `unwrapResponse` (objectstack#13079): the method resolves to the payload, and the caller reads `result.rows`. The maintainer's ruling on that card ordered this adapter's tolerant row ladder tightened in the same wave. The ladder read five spellings (a bare array, `rows`, `data` as an array, `data.data.rows` and `results`) and answered any other shape with `[]`, which a chart renders as "no data" and a KPI as a confident zero.
  
  What changes:
  
  - **Only `rows` is read.** Any other value now throws the new `AnalyticsResultShapeError` (`code: 'ANALYTICS_RESULT_SHAPE_INVALID'`, with `envelope: true` when the value is the pre-17.3.0 envelope). It is not answered by the client-side `find()` fallback, because analytics did answer: degrading would put plausible numbers from a different code path over a contract violation.
  - **Minimum version: `@objectstack/client` 17.3.0.** The dependency range moves from `^17.0.0` to `^17.3.0`, the first release that unwraps this method. A client older than that resolved `analytics.query` to the whole envelope, which this site no longer reads. The console's own `@objectstack/client` range moves with it, so the workspace declares one client floor.
  - **No server is dropped.** The envelope has only ever been a client-side question: every `@objectstack` 17.x server answers `POST /analytics/query` with the same `{ success, data }` envelope, and the client decides whether it is unwrapped. The server version is not the variable here.
  - The measure-missing fallback is unchanged: rows that come back without the requested measure are still re-aggregated client-side from a scoped `find()`.
  
  The objectui#7122 changeset recorded these branches as kept "rather than deleted" and left the compatibility question open. The objectstack#13079 ruling answers it, and this change removes them.
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
- 6a99bb2: `createObjectStackAdapter` declares the adapter it returns, not the shared `DataSource`
  interface (objectui#7323).
  
  The factory returned `new ObjectStackAdapter(config)` while declaring `DataSource<T>`.
  A wider value is assignable to a narrower annotation, so nothing ever failed to compile
  — the loss was entirely on the reading side. Measured against the shipped
  `dist/index.d.ts` with the doc-snippet gate's own compiler options, nine reads through
  `ReturnType<typeof createObjectStackAdapter>` failed with TS2339: `getClient`,
  `getCacheStats`, `invalidateCache`, `clearCache`, `getConnectionState`, `isConnected`,
  `onConnectionStateChange`, `onBatchProgress` and `setSystemCapabilities`. Eight of those
  nine reads are on this package's README API Reference list, and four whole README
  sections are built on them; the ninth measured read is the one the factory's own JSDoc
  links to (`[ADR-0066] See {@link ObjectStackAdapter.setSystemCapabilities}`). The README
  list is itself **nine** adapter-only members, not eight — `connect()` is adapter-only
  too and was documented all along; it simply was not one of the reads the card's
  reproduction measured. So the file's own doc comment pointed the reader at a method its
  declared return hid, and the two documented ways to obtain the same object — the factory
  and `new ObjectStackAdapter(…)` — handed back different type surfaces.
  
  **What the declared return now is: the whole class, not those nine reads.** The nine
  above are what the reproduction measured, not the size of this change. The factory's
  declared return is now `ObjectStackAdapter<T>` itself, so **every public member of the
  class** is part of what the factory promises. Against `DataSource` that is **20**
  members, not nine — `tsc`-computed as
  `Exclude<keyof ObjectStackAdapter<unknown>, keyof DataSource<unknown>>`: `clearCache`,
  `connect`, `getCacheStats`, `getCached`, `getClient`, `getConnectionState`,
  `getDiscovery`, `getItems`, `invalidateCache`, `invalidateViewKeys`, `isConnected`,
  `listImportMappings`, `onBatchProgress`, `onConnectionStateChange`, `onSaveAdvisory`,
  `onWriteWarning`, `probeAppAccess`, `queryDataset`, `setSystemCapabilities`,
  `updateDashboard`. The eleven past the documented nine were already in the shipped class
  type — none is `@internal` or `@deprecated`, `stripInternal` is not set, and all were
  already reachable through `new ObjectStackAdapter(…)` and through every
  `ObjectStackAdapter`-typed seam in `@object-ui/react` and `app-shell` — so what widens
  here is what the **factory declares**, not what the package ships. Two are escape-hatch
  shaped and worth knowing before building on them: `getCached(key)` is a raw cache read,
  and `getDiscovery()` reaches an internal property of the underlying `ObjectStackClient`.
  
  **Branch taken: A (widen the factory's declared return), and why.** The card offered
  three. B — moving caching, connection state and batch progress onto `DataSource` — was
  rejected because those are this adapter's concerns, not every data source's; every other
  `DataSource` implementation would then declare members it does not have. C — documenting
  a cast — teaches a cast around a declaration that is merely narrower than the value,
  which is the opposite of `declared = enforced`. A is one line and makes declared match
  shipped for every documented member at once.
  
  Two questions decided the shape and both were answered from the code before the diff.
  `ObjectStackAdapter` was **already** exported from the package's only entry
  (`src/index.ts`, tsup's single entry; the class is in the shipped `dist/index.d.ts`
  export list, two pin tests assert the exported spelling, and `apps/console` re-exports it
  by name) — so widening the return exports nothing by implication. And the narrow return
  was **not** a deliberate swappability guarantee: no comment, ADR or test pinned it, and
  the commit that added `autoReconnect` / `maxReconnectAttempts` / `reconnectDelay` to the
  factory's own config bag left the members that observe those features off the factory's
  declared return in the same change.
  
  **One caller shape breaks: a structural stand-in for the factory's return.** A
  hand-written object literal annotated `ReturnType<typeof createObjectStackAdapter>` no
  longer satisfies that type, because it is now a class with private members (TS2740) —
  annotate such a fake as `DataSource` instead, which is what it was standing in for.
  Nothing else moves: a wider return is assignable to the narrower annotation, so
  `const ds: DataSource = createObjectStackAdapter(…)` keeps compiling and keeps giving
  the narrow surface to anyone who wants it.
  
  The README's note saying the page could not yet teach the factory's shape is removed, and
  the four sections built on the adapter-only members (Metadata Caching, Connection State
  Monitoring, Batch Operation Progress, Troubleshooting → Cache Issues) now continue from
  Basic Setup's `createObjectStackAdapter(…)` call instead of declaring the class by hand.
  The docs-site page `content/docs/utilities/data-objectstack.mdx` is corrected the same
  way: its prose, its factory signature fragment and its "hold the class type to reach
  these" section described the old narrow return, and its Mutations and Troubleshooting
  examples told the reader to construct the class by hand to reach members the factory now
  declares. `src/adapterFactoryReturn.types.test.ts` pins the card's TS2339 reproduction
  inverted,
  with two controls: the adapter-only members stay absent from `DataSource` (fires on
  option B), and the widened return stays assignable to `DataSource` (swappability kept).
- a915064: `listImportMappings` no longer renders a refused door as "no mapping is registered"
  (objectui#7741).
  
  `ObjectStackAdapter.listImportMappings` degrades every failure to an empty list, and the
  import wizard hides its saved-mapping selector on an empty list. So "the server served
  zero mappings" and "the server refused, or broke" produced the identical UI on every
  deployment — the feature simply absent — with a `console.warn` as the only
  discriminator, in the browser console, with nothing pointing at it. That silence did not
  merely hide a fault: it produced a confident WRONG diagnosis in a careful reporter
  (objectstack#14026 was filed, routed and worked by two seats against a wizard that had
  been correct since `@object-ui/data-objectstack@17.1.0`).
  
  **The empty-list return is unchanged.** `listImportMappings` still answers
  `Promise<any[]>` and still never throws, on every arm including the loud ones — this is
  a channel added ALONGSIDE that contract, not a change to it.
  
  - **New: `ObjectStackAdapter.onMetadataReadWarning(cb)`** — a subscribe/unsubscribe
    channel, sibling in shape to `onWriteWarning` and `onSaveAdvisory`. It fires when a
    metadata read failed in a way that is NOT the supported "this deployment does not
    serve that kind" shape, carrying `MetadataReadWarningEvent`: which read it was, the
    object, whether the server `refused` this caller or the answer was `unreadable`, and
    the server's own ADR-0112 code, HTTP status and message.
  - **New: `classifyImportMappingsFailure(err)`** and `ImportMappingsFailureKind`, exported
    so a consumer can apply the same verdict. It reads the ERROR — the ADR-0112 `code`
    first, the status only where no code was declared — and never "is the result an empty
    array", which is what both conditions produce and so can never tell them apart.
  - **The older-server case stays quiet.** A deployment that does not serve the `mapping`
    kind (404/501 with no route, `ROUTE_NOT_FOUND`, `NOT_IMPLEMENTED`, or the metadata list
    door's 400 `INVALID_REQUEST`) still degrades to an empty list with no selector and no
    event. That is a real, supported deployment shape and it must not become a visible
    fault.
  - **The console now says so.** `AdapterProvider` subscribes to the new channel and
    renders a warning toast naming the object, the remedy and the server's own words, so a
    user without devtools open can tell "there are none" from "we could not find out".
    Three new `console.importMappings*` keys ship in all ten locale packs.
  
  This applies framework objectstack#13906 decision 1 option A — *a thing that could not be READ is
  not a thing that is ABSENT* — at this seam. It is an already-adopted discrimination, not
  a new principle.
- 53ded82: Array filters on analytics aggregates were posted un-lowered and refused by the runtime with 400; they are now lowered to the canonical `FilterCondition` before the wire.
  
  An `element:number` or an `object-metric` whose filter is authored as an array (`[{ field, operator, value }, ...]`, a comparison tuple, or an `and`/`or` group) reached `POST /analytics/query` as an array. That route parses the body with `AnalyticsQueryRequestSchema` first, and its `where` is a `FilterCondition`, so the widget answered `400 Invalid AnalyticsQuery body: where: ...` instead of its number — leaving the MongoDB-style record as the only authoring form that still worked.
  
  `aggregate()` now lowers the array through `parseFilterAST`, the single sink `@objectstack/spec` names for turning a `FilterArray` into a `FilterCondition`, so the posted `where` is the shape the wire declares. An empty array posts no `where` at all, a record-shaped filter is unchanged, and an array the sink cannot lower — an infix join such as `[condA, 'or', condB]` — is refused with this adapter's `INVALID_FILTER` / 400 error rather than posted or silently dropped into an unfiltered aggregate.
- 9662aca: Apply the object-metadata write invariant at the write DOORS instead of at the writers.
  
  objectui#7714 ruled that a half-filled relationship stays client-side and the PUT body never
  carries one without a non-empty `reference`, and implemented that ruling by naming the two
  writers it knew of. The identical defect was then reproduced on a third (fixed in `9073cf018`); a
  sweep found nine more. The doors — the three places in this repo that actually PUT `/meta/:type/:name` —
  now apply the invariant themselves, so every writer is covered without any list of writers
  existing anywhere, and a new door is caught by a gate that derives the door set from the
  tree rather than restating it.
  
  Behaviour change for consumers: `MetadataClient.save('object', …)` now throws BEFORE issuing
  the request when the body carries a relationship field with a missing, empty or whitespace-only
  `reference`. The same document is refused by the server with a 422 on `fields.NAME.reference`,
  so nothing that previously succeeded now fails — the refusal moves earlier, names the field,
  and leaves the draft in the client instead of wedging every later save of that object. Writes
  of every other metadata type are untouched.
  
  New export from `@object-ui/data-objectstack`: `assertObjectMetadataWritable`,
  `RELATIONSHIP_TYPES_REQUIRING_REFERENCE` and `OBJECT_METADATA_TYPE`.
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
- 2bf34f7: The console's "app not available" screen now says what it measured, and the by-name app
  probe stopped folding four answers into one (objectui#9262).
  
  **BREAKING for consumers of the published `AppAccessVerdict` type.** `probeAppAccess`
  widens by two members ruled by the maintainer: `granted | denied | unknown` becomes
  `granted | denied | not_found | unreachable | unknown`. A consumer that exhaustively
  switches on the verdict gains two cases. The meaning of `unknown` also narrows — it no
  longer means "an absent app, an unreachable server, or an adapter that cannot ask", it
  means only that nothing was asked (a host DataSource without this probe). Code that read
  `unknown` as a positive absence must move to `not_found`.
  
  **What users see.** The sentence `This app is not available yet — it may still be
  publishing. Try again in a moment.` is retired from all ten locale packs. It was asserted
  for seven distinct causes, only one of which is a publish, and it is the screen an author
  lands on after any of them — the same defect objectui#4252 split `denied` off this screen
  for. In its place: `This app can't be opened` for a measured absence, `Couldn't reach the
  server` for a probe that got no answer, the unchanged denial screen for a permission
  refusal, and a neutral `App not available` when nothing was measured. All but the denial
  keep the Retry button, because all but the denial can change on their own. A genuine
  post-publish lag reads as an absence, and the one forced metadata refresh that gives that
  lag its chance to resolve is unchanged.
  
  **Measured before the branches were written.** On a real server the by-name route answers
  `200` with the declared envelope MINUS its `item` for a name that does not exist — not the
  `404` this code assumed — so `probeAppAccess` returned `granted` for every typo, every
  never-created app and every unpublished draft. `granted` fell through to the same screen as
  `unknown`, which is why nothing showed. Absence is therefore read from the envelope as well
  as from the `404` code; a `not_found` branch keyed on the status alone would have been dead
  for the commonest case.
- b253c4e: The import wizard's "Download template" button now downloads the server's import template, an Excel workbook, instead of building a CSV of every field (objectui#9600).
  
  The old CSV listed every field the wizard was handed, including the system and read-only columns every object carries (created by, owner, and so on). The server strips those columns on import without an error, so a user who filled them in lost that data silently. The server's template (`GET /api/v1/data/:object/export?template=true`, objectstack 17.6.0) lists only the columns this caller can import. It marks required ones with `*`, adds dropdowns for select and boolean columns, and includes an instructions sheet.
  
  - **`@object-ui/types`: new optional `DataSource.downloadImportTemplate(resource)`**, resolving to the template file as a `Blob`. Additive. When a data source lacks it, no template is offered: there is no client-side fallback.
  - **`@object-ui/data-objectstack`: `ObjectStackAdapter.downloadImportTemplate(resource)`** sends `template=true` on the export route, on the same request path as `exportDownload`. When the client has a locale set (`getClient().setLocale`), the request carries it as `Accept-Language`, the way the import request does. The template's labels are written in the request's locale, and the import accepts a translated label only in its own request's locale, so the two requests must match.
  - **`@object-ui/plugin-grid`: `ImportWizard` offers the template** when its data source has `downloadImportTemplate` and the user can create records of the object (`usePermissions().can(object, 'create')`, the server's own gate). A 405 (object not open for import), a 403 (no create permission) and any other failure each show a message on the upload step, and no file is saved. The client-built CSV is deleted, with its helpers (`buildImportTemplateCsv`, `exampleForField`, `firstOptionValue`, `downloadTextFile`). The column mapping step is unchanged.
  - **`@object-ui/app-shell`**: the identity-import data source (`sys_user`) withholds `downloadImportTemplate`, because the server's template describes the generic import door, not the identity pipeline.
  - **`@object-ui/i18n`**: `grid.import.downloadTemplateHint` describes the Excel template in all ten packs, and `grid.import.templateDownloadFailed` and `grid.import.templateNotPermitted` are new.
- d5c1f52: `classifyAnalyticsFailure` now reads a 400 as a refusal of the query body we
  sent regardless of which ADR-0112 `code` it carries, so `aggregate()` no
  longer answers a rejected filter with client-side numbers from a different
  door (objectui#7755).
  
  Before this fix, only 400 `VALIDATION_FAILED` (and a code-less 400) threw
  `AnalyticsQueryRejectedError`. Any OTHER coded 400 — `service-analytics` ships
  its own 400 `INVALID_FILTER` on a filter shape it refuses — matched none of
  `classifyAnalyticsFailure`'s branches and fell through to `unknown`, which
  `aggregate()`'s catch has no arm for, so it silently degraded to
  `aggregateViaFind`: a re-read through `find()`'s `$filter` query-string
  contract, which accepts array shapes the analytics request body does not. A
  filter the analytics route refused could still be answered — with a
  plausible, wrong number, and no sign the request had a defect.
  
  The fix is a floor UNDER the existing code branches, not a replacement for
  them: `NOT_IMPLEMENTED` / `ROUTE_NOT_FOUND` still win `not-installed`,
  `VALIDATION_FAILED` / `UNAUTHENTICATED` / `CUBE_NOT_FOUND` still win their own
  outcomes first (objectui#5721). Only a 400 that none of those four already
  claimed now falls to the new floor instead of past it. An unmatched NON-400
  coded error (e.g. a coded 5xx) is unaffected and keeps degrading exactly as
  before — this fix is scoped to the 400 case only.
- b2065e7: Classify `/analytics/query` failures by their ADR-0112 `code` rather than their HTTP status, so a chart is no longer answered from a different code path behind the wrong explanation.
  
  `classifyAnalyticsFailure` tested `status === 404 || status === 501` before the code operands on the same line, so the status short-circuited every one of them: any 404 on this face was classified "the analytics capability is not installed" whatever code it carried, and `NOT_IMPLEMENTED` / `ROUTE_NOT_FOUND` were unreachable for the conditions they name. Three unrelated conditions answer 404 on this url, so the status cannot tell them apart — the `code` is the contract.
  
  Two conditions change behaviour:
  
  - **404 `CUBE_NOT_FOUND`** (a misspelled or unregistered cube — an authoring mistake) now **throws** the server's own error verbatim, keeping `code` and the producer's repair instructions. It previously warned "install `@objectstack/service-analytics`" and silently degraded to `find()` + client-side aggregation — which cannot answer it anyway, because the fallback re-reads the same name through `/data`, where an unregistered object is a 404 `OBJECT_NOT_FOUND`.
  - **401 `UNAUTHENTICATED`** (an anonymous or lapsed session) now **throws** `AnalyticsUnauthenticatedError` instead of degrading silently behind a `find()` that is about to be refused the same way.
  
  Unchanged: `NOT_IMPLEMENTED` / `ROUTE_NOT_FOUND` and code-less 404/501 answers still degrade loudly to the client-side fallback, 400 `VALIDATION_FAILED` still throws, and 5xx / network failures still degrade silently.
- b470e91: The metadata designer states its package on the publish step, not only on the save
  
  Studio's designer save→publish loop bound the draft to a software package on the
  save (`PUT ?mode=draft&package=<id>`) and then sealed it with a publish that named
  no package at all. objectstack `9e04c3e35` (shipped in `@objectstack/rest` 17.2.0) taught
  `POST /meta/:type/:name/publish` to accept `?package=<id>`, so the second call can now
  state the same binding the first one already states.
  
  - `MetadataClient.publish()` accepts `packageId` and sends `?package=<id>`, the same
    wire spelling and the same `encodeURIComponent` treatment `save()` gives it.
  - `MetadataResourceEditPage` reads the binding for BOTH steps from one derivation
    (`readActivePackageBinding`), so the two calls of one loop cannot drift apart. The
    `?package=all` "show everything" scope keeps folding to "no package".
  
  The parameter is **omitted**, never sent empty, when the designer holds no binding.
  Empty and absent are the same to the framework's normaliser today, but absent is the
  shape the save door already followed, and the framework's promotion path branches on
  the key being present downstream.
  
  What this buys is **reachability**, not speed: it lets `#9612`'s package-closure
  narrowing at the runtime publish gate fire on an HTTP-driven promotion at all. That
  narrowing has a second, independent gate this does not touch — objects carrying no
  `_packageId` provenance are kept unconditionally — so on a tenant-authored overlay
  corpus stating the package still narrows nothing.
  
  ⚠️ **Dated note, 2026-09-29 — the publish-gate narrowing is an objectstack card — objectui#11016.** The last paragraph
  names the package-closure narrowing by a bare number, which in this repository
  resolves to an unrelated objectui pull request. It is
  objectstack-ai/objectstack#9612, the runtime publish gate's rule snapshot. The text above is kept as the reading of this change.
- fffa30d: `listViews` no longer renders a refused metadata read as "this object has no saved views"
  (objectui#8151).
  
  `ObjectStackAdapter.listViews` degrades every failure to an empty list, and every consumer
  reads only the return. So "the server served zero saved views" and "the server refused, or
  broke" produced the identical UI — with a `console.warn` as the only discriminator, in the
  browser console, with nothing pointing at it. It is the same defect objectui#7741 removed
  from `listImportMappings` one method over, and the user-visible cost is the higher one: an
  empty `listViews` is an object's **view switcher**, so a user whose token lapsed
  mid-session could be shown an object that appears to have no saved views at all —
  including views they created themselves.
  
  **The empty-list return is unchanged.** `listViews` still answers `Promise<any[]>` and
  still never throws, on every arm including the loud ones — this is a channel added
  ALONGSIDE that contract, not a change to it. `listImportMappings` is likewise unchanged,
  down to its wording.
  
  - **`ObjectStackAdapter.listViews` now emits on `onMetadataReadWarning`** — the channel
    objectui#7741 added — when the read failed in a way that is not the supported "this host
    mounted no metadata door" shape. The event carries the object, whether the server
    `refused` this caller or the answer was `unreadable`, and the server's own ADR-0112
    code, HTTP status and message.
  - **New: `classifyViewsFailure(err)`.** A SEPARATE reading, deliberately not a second
    caller of `classifyImportMappingsFailure`: `view`'s quiet set is strictly smaller. The
    arm the mapping classifier is built around — 400 `INVALID_REQUEST`, the metadata list
    door's "this deployment carries no such kind" — is unreachable for `view`, which is in
    the platform's static spelling contract, so reading it as kind-absence would swallow a
    real refusal. On `view`, only a host with no `/meta` door at all stays quiet.
  - **`MetadataReadWarningEvent`'s `operation` and `kind` gain their second members**
    (`'listViews'` / `'view'`). This is the additive, reviewed widening the single-member
    unions were designed for, and it worked as designed: the consumer that renders these
    events had a `switch` naming one operation, so the widening turned "a views failure is
    toasted as an import-mapping failure" into a compile error rather than a runtime lie.
  - **New: `MetadataReadFailureKind`**, the neutral spelling of the three verdicts.
    `ImportMappingsFailureKind` is now an alias of it — identical members, so existing
    consumers are unaffected in both directions.
  - **The console says which list it was.** `metadataReadWarningToast` picks its title and
    its remedy by `operation`, so a failed view read reads *"Saved views for {{object}}
    could not be loaded … not because this object has no saved views"*. Three new
    `console.savedViews*` keys ship in all ten locale packs; the `console.importMappings*`
    copy is untouched.
  
  This applies framework objectstack#13906 decision 1 option A — *a thing that could not be READ is not
  a thing that is ABSENT* — at the second seam that needed it.
- 8e00bfd: **Breaking (published surface):** remove `options.actor` from `MetadataClient`'s
  `save`, `reset`, `publish` and `rollback`, and stop emitting the `X-Actor`
  request header.
  
  The server stopped honouring that header. objectstack#7941 ruled that the
  recorded actor is the identity the request was authorized as, and removed the
  header limb from the `/meta` write resolver — attribution cannot drift from
  authorization. The option therefore typed cleanly, sent a header, and could not
  influence the audit or history row it appeared to address: a false affordance
  that promised attribution and silently failed to deliver it.
  
  Three declarations go: `MetadataClientSaveOptions.actor` (inherited by
  `MetadataDeleteOptions` via `extends`, so it served both `save` and `reset`),
  and the inline `{ actor?: string }` on each of `publish` and `rollback`.
  `MetadataAuditEntry.actor` is unaffected — that is the server's read-back of
  who acted, and it remains the way to see attribution.
  
  Marked `minor` rather than `major` per this repo's version-alignment policy
  (the fixed group's major tracks `@objectstack`, and `major` in a changeset
  would drag all 39 packages off that cadence).
  
  No caller in this repo passed `actor`; the census found the only in-repo
  occurrence was the client's own unit test. Callers outside this repo that still
  pass it are unaffected at runtime beyond losing a header the server already
  ignored — the property is dropped rather than forwarded, pinned by
  `metadata-actor-retired-4834.pin.test.ts`.
- fd8dace: Studio surfaces the runtime authoring gate's advisory findings after a **publish**, not only after a save
  
  objectui#4133 / PR #4236 wired the gate's advisories to the save door and recorded, honestly, what that left unsurfaced: Studio's designer stages every edit as a `mode: 'draft'` save, drafts are never gated (the framework returns at its D1 early-return before a single rule runs), and the publish step that *is* gated returned no `advisories` field at all. So on the flow most tenants actually use, the author was told nothing at either door — for two different reasons, only one of which was objectui's.
  
  The second reason has expired. `PublishMetaItemResponseSchema` now declares the same optional, omitted-when-empty `advisories` key that `SaveMetaItemResponseSchema` has carried since #4717, and `publishMetaItem` populates it. Measured against the installed `@objectstack/spec` (17.2.0) rather than inferred from the version number: the key survives a `safeParse`, a half-shaped finding is rejected, and a clean publish omits the key entirely. That reading is now a test rather than a note, so a spec drift fails CI instead of silently re-muting the door.
  
  ⚠️ **Dated note, 2026-09-29 — the save response's advisories key came from an objectstack card — objectui#11016.** The
  paragraph above dates the save response's `advisories` key by a bare number,
  which in this repository resolves to an unrelated objectui item. It is
  objectstack-ai/objectstack#4717, the card that put the runtime authoring gate's
  advisory findings on the response. The text above is kept as the reading of this change.
  
  `MetadataClient.publish` and `MetadataClient.publishDraft` — the two methods over the single-item publish route `POST /meta/:type/:name/publish` — now report through the **same** sink, the same event and the same renderer the save door already used. No new UI shape: same warning tier, same 10s duration, same per-finding `rule` + `message` + `hint` formatting, findings still rendered verbatim as server prose. The wiring lands in the data layer rather than at the call sites, so `ResourceEditPage`'s Publish button and the runtime `RuntimeDraftBar` promotion (ObjectView / ReportView / DashboardView) are covered by one change, as are future ones.
  
  One thing had to differ, and it is the frame's verb. Save and Publish are two different buttons in this product, so a toast that says "Saved" after a Publish tells the author their change is still a draft — the opposite of what happened. `MetadataSaveAdvisoryEvent` therefore gains a required `door: 'save' | 'publish'` and the renderer picks `console.publishAdvisoryTitle` (added to all ten locale packs) accordingly. `door` exists because `mode` cannot answer this: a direct active save and a draft promotion both report `mode: 'publish'`, since both land the body in the active overlay. It is required rather than optional so a future third door cannot be wired without saying which one it is, and the renderer branches on it through an exhaustive switch with a `never` check, so adding a third member is a compile error rather than a silently wrong verb.
  
  **BREAKING for event constructors — `MetadataSaveAdvisoryEvent.door` is required.** Reading the event is unaffected: a listener that ignores `door` behaves exactly as before, and every other member is unchanged. Constructing one is a compile break — a door-less event literal that type-checked before now fails with TS2741, `Property 'door' is missing`. Measured on the emitted `dist/index.d.ts` of `@object-ui/data-objectstack` on both sides: that single required member is the entire non-comment delta of the package's published surface. **Migration:** add `door: 'save'` or `door: 'publish'` to the literal, whichever write it models — `'save'` for `PUT /meta/:type/:name`, `'publish'` for `POST /meta/:type/:name/publish`. Scored `minor` rather than `major` per the repo's version policy: objectui's major is pinned to `@objectstack`'s so that "same major means compatible" holds across the two repos, so objectui's own breaking changes ship as `minor` with the break named here (`scripts/check-changeset-no-major.mjs`). Every publishable package sits in one `fixed` group, so this entry carries the group.
  
  Unchanged, deliberately: the **batch** door. "Publish whole app" (`POST /packages/:id/publish-drafts`) discarded per-draft advisories server-side when this change was written — objectstack#9343, open and unruled at the time — and nothing here compensated for that from the client side. A test pinned the absence, so a later traversal of a batch-shaped `published[]` could not be added without turning it red.
  
  *Corrected before release (`ce986aafc`): both present-tense claims in the paragraph above went false after it was written — objectstack#9343 landed, the batch response now carries per-draft advisories, and `ce986aafc` routes that door through the same seam and flips the absence pin to a presence pin. The paragraph is kept in the past tense as the record of what this change did and did not do; this note is what the CHANGELOG publishes instead of a sentence that was true only while it sat here.*
- 2d36552: Pins `@objectstack/spec`, `@objectstack/client`, `@objectstack/formula` and `@objectstack/lint` to `17.1.0`, and adapts the two consumer surfaces the new build moves.
  
  The pin itself is a lockfile refresh — every manifest already declared `^17.0.0`, which admits `17.1.0`, so no dependency range changed. All four move together: a split resolution is what produced the dual-version spec graph that reddened `check:spec-symbols` in this repo's history.
  
  **A `icontains` filter now reaches the driver as a filter.** `icontains` is a canonical `VIEW_FILTER_OPERATORS` member as of `17.1.0`, so an author can declare it on a `ViewFilterRule` and the spec validates it — but `@object-ui/data-objectstack`'s alias table had no row for it, and an unmapped operator is how this adapter shipped an unfiltered query before (objectstack#3948). It is an identity row like `contains`: `icontains` is itself a member of `VALID_AST_OPERATORS`, so the spelling the author writes is the spelling the AST takes, and no case-sensitivity is translated away. Declared rather than left to the table's `?? op` fall-through, on the rule its own parity test states — the AST gate accepting a spelling is not the driver compiling it into a `WHERE` clause.
  
  The same operator reaches the list view's own bridge: `@object-ui/plugin-list`'s `mapOperator` gains an explicit `icontains` arm. The emitted spelling is identical to the input, but the arm is written out rather than left to the `default` passthrough — `icontains` is its own member of `VALID_AST_OPERATORS`, so a raw passthrough is accepted *today*, and depending on that coincidence is what the bridge's own parity test records as how it once stopped discriminating.
  
  `@object-ui/core` adds `onSuccess` to its spec key inventory, so an author writing the key `17.1.0` now declares is no longer warned that it is unknown. That is a diagnostic statement only — the four declared action surfaces still drop the key before it reaches the runner, which is tracked separately.
  
  **A stored view filtering case-insensitively still shows that operator when it is reopened.** `@object-ui/plugin-view`'s canonical-to-builder table is keyed by `ViewFilterOperator`, so `17.1.0` adding `icontains` failed to compile rather than letting the operator reach the FilterBuilder as a raw spelling its dropdown cannot select. It maps to the builder's `containsCaseInsensitive` — the id that authors the spec's `$icontains` — and deliberately not to `contains`, which would quietly rewrite a case-insensitive filter into a case-sensitive one the next time the view was saved.
  
  **The page-editor palette keeps one entry per renderer.** `17.1.0` retires `element:filter` from `PageComponentType` and adds `record:discussion`, leaving the member count at 34 either side — so the swap is invisible to any count-based reading. The stale `element:filter` exclusion is dropped, and `record:discussion` is excluded because it is the *same renderer* as the already-offered `record:chatter`, not because it is unauthorable. Nothing the palette offers changes.
  
  **The console eager-closure ceiling is re-baselined, by maintainer ruling.** The release is roughly 930 KB larger uncompressed and nearly all of it lands in `vendor-objectstack-*.js`, which put the closure past a ceiling that was deliberately sized to catch a 89 KiB regression — the gate refused the bump, correctly. Raising it was escalated rather than taken locally, because gate-strength policy had been ruled the maintainer's; the ruling on objectui#5531 authorised the raise. `MAX_EAGER_CLOSURE_GZIP_BYTES` and the `BASELINE` it is derived from move together in one commit, keeping headroom at 2.00% and below the 91,136-byte regression size the gate must still catch. The gate's *sensitivity* is untouched: a repeat of that regression from the new baseline still fails. No behaviour ships from this file — it is CI policy, recorded here because the version it governs is the one this changeset publishes.

### Patch Changes

- 9ec8ceb: Views that an earlier "Edit view config → Save" made read-only recover on read, and keep
  their edits (objectui#10210).
  
  A view row now counts as a personalization overlay only when it carries the `_isOverride`
  marker. The view list used to treat a flat row carrying `viewKind: 'list'` as an overlay
  too, a shape guess kept for toolbar rows written before the marker existed. A config save
  on a code-defined view stored exactly that shape, so the view dropped out of the saved
  views and its tab turned read-only, for good once the draft was published. With the guess
  retired, such a row reads back as the saved view it is: its tab is editable again and shows
  what the save stored. Nothing is rewritten at rest; the next read is enough.
  
  ⚠️ This exposes one class of row: overlay rows written before the marker
  (objectui#4227, closed 2026-08-15) and never touched since. They have the same shape, so
  they now also read as plain rows, and their frozen label, columns and filter copy covers
  the code definition again. No deployment is named as holding one.
- f812f37: fix(data-objectstack): the object-metadata write refusal no longer points at an issue that answers 404
  
  `assertObjectMetadataWritable` throws when an object-metadata write carries a relationship
  field with no usable target, and a host surfaces that message on screen or in a log. Its
  reason ended with two issue pointers, and one of them answers 404, so a reader who followed
  it found nothing. The message now cites only objectui#7714, the ruling the refusal enforces.
  
  Nothing else in the message moves: the door name it opens with, the field it names, the
  target state it describes and the advice it closes with are unchanged, and the guard refuses
  exactly the writes it refused before.
- ac15833: fix(data-objectstack, plugin-dashboard): a dataset tile the viewer may not read shows a localized "no access" state (objectui#10899)
  
  When the analytics read admission refused a dashboard dataset query — `403`
  with ADR-0112 `PERMISSION_DENIED` — `queryDataset` had no branch for that code,
  so it threw the generic `Dataset query failed: 403 Forbidden — [Analytics]
  Access denied: …` string, and `DatasetWidget` printed it verbatim in a red
  alert. The list view over the same object already says 「无权访问」.
  
  - `queryDataset` now throws a typed `AnalyticsForbiddenError` for that code,
    carrying `httpStatus: 403` and `code: 'PERMISSION_DENIED'` (plus the server's
    code and message for diagnostics). A code-less 403 — no ObjectStack route
    wrote it — keeps the generic error.
  - `DatasetWidget` classifies a failed query with the shared `classifyLoadError`
    and, for `forbidden`, renders a localized no-access state
    (`dashboard.widgetForbiddenTitle` / `dashboard.widgetForbiddenMessage`, new in
    all ten packs) instead of the exception text. Every other failure keeps the
    detailed alert.
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
- 5127378: `ObjectStackAdapter.aggregate()` lowers rule-shaped filter arrays before the
  analytics wire, reusing the lowering `find()` already runs (objectui#6302).
  
  `find()` has translated `[{ field, operator, value }, ...]` into the server's
  filter AST for as long as `convertQueryParams` has existed. The analytics path
  did not: `aggregate()` assigned `payload.where = params.filter` verbatim and
  posted it to `/analytics/query`.
  
  The two doors are not equally forgiving, so the gap had a user-visible end.
  `lowerAnalyticsWhere` in `@objectstack/service-analytics` — shared by both
  aggregation strategies — accepts AST tuples and throws on an array of rule
  objects. A stored `ViewFilterRule[]` that a LIST renders correctly therefore
  rendered `element:number` into its error state on every analytics-capable
  deployment, which is the default one because the CLI always loads analytics.
  
  An array filter now goes through the same `translateFilterArray` the `find()`
  path uses — one lowering, so the two paths cannot disagree about one stored
  filter. Rules spread into a logical node (`['and', ...rules, ...tuples]`, the
  commonest composite there is) are lowered at depth, as they already were on
  `find()`. Non-array filters are untouched: the MongoDB-style object this branch
  was written for is what `/analytics/query` already accepts, and translating it
  would be a semantic change this fix does not make. Already-AST arrays,
  record-shaped filters, and the no-filter case are byte-unchanged.
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
- 639114c: Reconcile `@object-ui/data-objectstack` with the `@objectstack/*` family at
  17.3.0 (objectui#7122).
  
  `@objectstack/client`, `core`, `formula` and `lint` each pin `@objectstack/spec`
  EXACTLY, so resolving the spec alone to 17.3.0 left the console bundling TWO
  copies of it. Moving the family with it in `pnpm-lock.yaml` collapses the
  duplicate; every declared range already admitted 17.3.0, so no manifest moved.
  
  The one source change the family bump forces is a type reconciliation, not a
  behaviour change. `client.analytics.query` resolved to `Promise<any>` at 17.2.0
  and resolves to `Promise<AnalyticsResult>` at 17.3.0, so the pre-envelope
  branches of `aggregate`'s row-shape fallback stopped type-checking. Those
  branches are read through a widened alias rather than deleted: the client's own
  docblock records the runtime change behind the narrower type ("BREAKING since
  objectstack#13079 — read `result.rows`, not `result.data.rows`"), and deleting
  them is a runtime compatibility decision about servers older than that, not a
  type repair. The alias restores exactly the compile-time latitude 17.2.0 gave
  the same expression and changes no runtime byte of it.
- f57ca75: fix(studio): one draft-envelope reader, and it strips the framework's read decorations
  
  `client.getDraft()` serves a DECORATED body — the draft branch stamps
  `_draft: true` and then `decorateMetadataItem` attaches `_diagnostics` for any
  type with a registered Zod schema. The spec names both READ-TIME decorations
  precisely because a served body "is NOT a valid input to the schema that
  produced it until these are removed" (`METADATA_READ_DECORATIONS`).
  
  objectui#7603 taught `ResourceEditPage` to strip them. It could only teach one
  site, because `extractDraftBody` existed **four times** — three verbatim copies
  plus a hand-rolled one in `ObjectHooksPanel` — and six more consumers unwrapped
  the envelope inline. Ten readers, one of which knew the rule.
  
  **The user-visible half.** The pending-changes sheet's per-entry diff compares
  the published body against the draft body key by key. Those two reads are
  decorated ASYMMETRICALLY — only the draft branch stamps `_draft` — so the sheet
  listed `_draft` under "Also changed:" on every entry that has a published
  counterpart, and `_diagnostics` alongside it whenever the two read-time verdicts
  differed. Framework-internal keys were being presented to the author as their
  own edits, on the screen where they decide whether to publish.
  
  **The rest.** Six sites merged a decorated body into a document they then wrote
  back through `save(..., { mode: 'draft' })` — the Studio app / page / object /
  flow surfaces, the package OWD panel, the object hooks panel, and the
  adapter's `updateView`. Today's server absorbs that (it strips read decorations
  on ingress, before its own schema gate), so nothing 400s; this is still a client
  emitting a body its own spec calls invalid, and the fix belongs at the producer.
  
  The cure is one function rather than ten strips: `extractDraftBody` is now
  exported from `@object-ui/data-objectstack`, beside the `getDraft` whose
  envelope it decodes. The key list is the spec's exported
  `stripReadDecorations` — never a second hand-maintained copy in this repo. The
  presence verdict still runs BEFORE the strip, so removing our own annotations
  can never turn a served draft into "nothing pending", and the ADR-0010
  protection envelope (`_lock`, `_provenance`, `_packageId`, `_packageVersion`)
  is deliberately untouched: those keys are declared by the closed schemas.
  
  No schema was loosened, and no gate was taught to tolerate `_diagnostics`.
- 0b8c638: fix(data-objectstack): the rule-entry filter form refuses an empty or non-string `icontains` comparand
  
  `@objectstack/spec`'s `FILTER_TEXT_CASES` declares two shapes REFUSED for the
  case-insensitive contains operator: an empty comparand, and one that is not a
  string. This adapter already refused both when a filter arrived as an object
  (`{ name: { $icontains: '' } }`), but a filter in the rule-entry form
  (`[{ field: 'name', operator: 'icontains', value: '' }]`) was lowered to
  `['name', 'icontains', '']` and sent. So the same condition was refused or sent
  depending on which form it was written in. An empty comparand matches every
  row, so the entry form returned the whole table where the author asked for a
  subset.
  
  The entry form now asks the spec's own `isRefusedTextComparand` after the
  operator alias fold, so a case variant such as `ICONTAINS`, or the operator
  given under the `op` key, is judged too. It throws `MalformedFilterError`
  (`INVALID_FILTER` / 400) carrying the spec's `textComparandRefusalReason`
  unchanged, before any request is sent, on `find()` (both routes) and on
  `aggregate()`, and for a rule nested under a logical node as well as at the top
  level. `convertFiltersToAST` and `ValueDataSource` read the same two functions,
  so all three now refuse the same set: an empty string and any non-string,
  including a missing `value`. A missing value used to go out as JSON `null`.
  
  `MalformedFilterError`'s public signature is unchanged: the refusal sentence is
  seated inside this module. Building its message no longer throws for an entry
  that carries a BigInt (such a value is shown as its literal, e.g. `3n`), and its
  text is otherwise the same as before. The README's "Rule-shaped arrays" section
  documents the refusal. The case-sensitive `contains` family is untouched: the
  table declares no such row for it.
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
- 269880a: Read the flat REST error envelope in `ObjectStackAdapter`, so a denial that names the
  missing grant stops arriving as a bare HTTP status word (objectui#9594).
  
  A console operator who clicked "export to CSV" without the `allowExport` grant was
  shown one word: `Forbidden`. The server had answered a full sentence — which object,
  which user, which axis — and the adapter threw it away.
  
  **Why it was thrown away.** `exportDownload` read its failure through a ladder that
  knew two envelope dialects: the ADR-0112 nested `error: { message }`, and the flat shape
  that carries a `message` key. The REST export gate writes a third one — flat, with the
  sentence in a bare string `error` and no `message` key anywhere — so every rung missed
  and the ladder fell through to `res.statusText`. The same ladder had been hand-copied at
  four sites in the module (`searchAll`, `rawFindWithPopulate`, `exportDownload`,
  `fetchObjectSchemaFresh`), and the two upload paths (`uploadFile`, `uploadFiles`) read a
  narrower version of it, so all six were blind to the same dialect.
  
  **The fix is one reader, not six patches.** A single internal `readErrorEnvelope` now
  holds the dialect knowledge and every one of those six sites routes through it. It is
  deliberately **not** exported from the package entry point — the published face of
  `@object-ui/data-objectstack` is unchanged by this release.
  
  **The rung order is load-bearing.** `message` is consulted before a string-valued
  `error`, because the REST 401 body is flat *and* carries both keys, with the code word in
  `error` and the sentence in `message`. Reading `error` first would make an
  unauthenticated response render the word `UNAUTHENTICATED` instead of its sentence. The
  401/403 pair is pinned as a control for exactly that inversion.
  
  **The machine code now reaches the caller too.** The four `res.ok` ladders attach the
  server's `code` to the thrown error (`EXPORT_NOT_PERMITTED`, `PERMISSION_DENIED`, …), so
  a surface has something to discriminate on and an operator has something to search for.
  `rawFindWithPopulate` already did this; the other three now match it rather than drifting
  from it. The code is read from `code` or a nested `error.code` and **never** promoted out
  of a string `error` — a sentence is not a code, and `@objectstack/core`'s own guidance
  names that chain as where an envelope regression hides. The upload paths keep their
  declared `UPLOAD_ERROR` code and their own fallback text; only the dialect reading is
  shared, because their envelope is genuinely a different shape.
  
  **Not a lenient fallback.** ADR-0112's 2026-07-30 amendment records the flat and the
  wrapped envelopes as the two live, sanctioned shapes, and D5 leaves the flat one's
  permanent position an open maintainer question. Every site routed through the reader calls
  a `/data` route, whose declared answer is the flat family, so reading it is conformance
  rather than tolerance. The server envelope is untouched — that belongs to the producer's
  ratchet card in the `objectstack` repo.
  
  **Blast radius.** Not one route: the REST package answers a wide family of these
  `{ code, error }` bodies, and `VALIDATION_ERROR` / `PERMISSION_DENIED` / `INVALID_FILTER`
  arriving as `Bad Request` / `Forbidden` is the same loss with a much wider audience than
  the export button. The affected-code count quoted on objectui#9594 is a reading taken
  against one published `@objectstack/rest` version by the scan that card records; nothing
  in this repo re-derives it, so it is not restated here as a live figure.
- b2e85a9: `ObjectStackAdapter.getApp` and `getPage` now address the `app` / `page` metadata
  types in the singular, matching the other twelve `client.meta.*` call sites in this
  file (objectui#4940).
  
  `getApp` (`getItem('apps', …)`) and `probeAppAccess` (`getItem('app', …)`) addressed
  the same metadata type sixty lines apart, and only `probeAppAccess`'s comment argued
  its singular spelling was deliberate — the plural site was silent. Both plural sites
  resolved today only because the server folds plural → singular
  (`RestServer.metaTypeSingular` via `PLURAL_TO_SINGULAR` from `@objectstack/spec/shared`,
  confirmed by reading both the mapping and the by-name route handler that calls it), so
  this is consistency restoration rather than a behavior change — nothing a user hits was
  broken, and nothing a user hits changes.
  
  `appAccessProbe.test.ts` (objectui#4252's local pin for this same spelling) is extended
  with two new cases asserting `getApp`/`getPage` pass the singular type to
  `client.meta.getItem`, so a future revert to the plural spelling fails a test instead of
  depending on the server-side fold staying in place.
- c7cd2b6: `ObjectStackAdapter.queryDataset` now maps a failed dataset query by the server's
  ADR-0112 error `code`, not by the HTTP status, so an unknown dataset and an
  unauthenticated session stop being reported as a missing analytics capability
  (objectui#5663).
  
  Two unrelated conditions answer **404** on `POST /api/v1/analytics/dataset/query`:
  the runtime dispatcher's `ROUTE_NOT_FOUND` when the route was never mounted, and
  the route's own `NOT_FOUND` when `body.datasetName` matches no saved dataset. The
  mapping tested `res.status === 501 || res.status === 404` and called all of it
  "the analytics capability is not installed", so every unknown dataset produced a
  banner telling the operator to install `@objectstack/service-analytics` and mount
  `AnalyticsServicePlugin`. Measured live on a prod tenant, that banner was shown on
  four HotCRM Executive Overview widgets while the analytics service was installed
  and answering — the real condition was an installed `app.objectstack.hotcrm` at
  1.3.0 whose datasets ship in 2.2.2, i.e. a package upgrade, the opposite corner of
  the system from the remedy the banner named.
  
  Three conditions now get three answers, each keyed on the code the framework
  declares for it:
  
  - `NOT_IMPLEMENTED` (501, route mounted with no analytics service) and
    `ROUTE_NOT_FOUND` (404, route not mounted) keep the existing
    `AnalyticsNotInstalledError` and its copy — one remedy, one message.
  - `NOT_FOUND` (404, unknown `datasetName`) throws the new
    `AnalyticsDatasetNotFoundError` (`ANALYTICS_DATASET_NOT_FOUND`), naming the
    dataset and pointing at the installed app's version rather than at the server.
  - `UNAUTHENTICATED` (401, `enforceAuth`) throws the new
    `AnalyticsUnauthenticatedError` (`ANALYTICS_UNAUTHENTICATED`), which says the
    request was refused before it ran and therefore says nothing about the
    capability.
  
  The banner also used to print the server's own message in a parenthetical while
  contradicting it in the headline — it quoted `Dataset "opportunity_metrics" not
  found.` under a headline claiming a missing capability. That is now structurally
  impossible rather than merely fixed: the headline is a pure function of `code` and
  the parenthetical is a verbatim quote of `message`, both read off the same
  response, and a test walks every branch asserting each message carries its own
  headline and none of the others'.
  
  Additive only. `AnalyticsNotInstalledError` keeps its `code`, its copy and its
  constructor signature (it gains an optional third `serverCode` argument and a
  `serverCode` field), so consumers matching `ANALYTICS_NOT_INSTALLED` — including
  the metadata-admin dataset preview — are unaffected. A 404 carrying a code this
  client does not recognise, such as the analytics cube gate's `CUBE_NOT_FOUND`, now
  keeps its server detail instead of being relabelled as a missing capability; a 404
  or 501 carrying no code at all is still read as the capability being absent, since
  the route's own `NOT_FOUND` always ships a code.
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
- 8d37efb: The metadata lock banner can no longer render an amber, padlocked box with no
  title, and the ADR-0010 §3.6 lock vocabulary is declared once instead of three
  times (objectui#5024).
  
  `MetadataLayered.lock` and `MetadataAuditEntry.lockState` each spelled the four
  states out by hand, 42 lines apart in one file, compared by no gate. They are now
  one exported `MetadataLockState` — derived from `GetMetaItemLayeredResponseSchema`'s
  `z.enum` in `@objectstack/spec`, which already owns this vocabulary, so the copies
  were restating a schema rather than filling a gap.
  
  The user-visible half is the banner. Its title was three independent `&&` branches
  with no fallback, while the switch that opens the banner is true for any non-`none`
  value — so a lock state outside the four opened the box and left the headline
  empty. That is reachable without a fifth state ever being added here:
  `MetadataClient.layered()` casts the wire value through unchecked, so a newer
  server reaches this banner as-is. Measured, not assumed — feeding `no-publish`
  through the page rendered the padlock, the border and an empty title. The title is
  now a keyed lookup with a loud fallback that names the unrecognised token, so a
  fifth state fails `type-check` here and, if one arrives from a server anyway, the
  operator reads a sentence instead of a blank box.
- 9118a31: Preserve the producer's `userMessage` marking when `normaliseClientError` re-wraps a refusal.
  
  `ApiErrorSchema.userMessage` (objectstack `79c46da90`) is the opt-in channel an application author
  sets at throw time to say "this text is for the end user", and the contract states it
  status-agnostic — any refusal status may carry it. Both of the shapes this adapter re-wraps
  into typed errors dropped the marking: a hook that refused a write with `VALIDATION_FAILED`
  or `CONCURRENT_UPDATE` and marked its own sentence had that sentence discarded at the
  adapter boundary, before any surface could render it. Nothing threw and the typed error was
  otherwise correct, so the only symptom was the user reading a generic string instead of the
  sentence their administrator wrote.
  
  The marking now rides both re-wraps, in the form the shared reader (`declaredUserMessage`)
  already looks for: on the details bag for `DataApiValidationError`, exactly the way `fields`
  already survives, and on a new readonly `userMessage` member for `ConcurrentUpdateError`,
  which has no details bag. Unmarked refusals are untouched — they carry no key and still read
  as `null`, so nothing a producer did not opt into can reach a user.
- 7b43319: **Fix:** `MetadataClient.publishDraft` no longer unwraps a `{ success, data }`
  envelope, so it and `MetadataClient.publish` hold ONE belief about the route
  they share.
  
  The two methods sit ~250 lines apart in `metadata-client.ts` and both POST
  `/api/v1/meta/:type/:name/publish`. `publishDraft` tolerated a dispatcher-shaped
  envelope and returned the inner object; `publish` returned the body as parsed.
  Nothing said which was right, and the card explicitly refused to settle it from
  `PublishMetaItemResponseSchema` alone — an inference from a declaration is not a
  measurement of the server.
  
  So the producer was read instead, in the framework checkout:
  
  - `POST /api/v1/meta/:type/:name/publish` has exactly ONE mount,
    `packages/rest/src/rest-server.ts`, whose handler ends
    `res.json(await p.publishMetaItem(publishRequest))` — the protocol object
    verbatim, no envelope branch on any arm. The ADR-0006 project-scoped base
    re-mounts that same handler.
  - The `{ success, data }` envelope has ONE producer, `HttpDispatcher.success()`,
    and it does not serve this route: no publish branch in `runtime`'s `/meta`
    domain (its three-segment arm is `/published`, GET only), no row in the
    dispatcher's route ledger, and a three-segment `/meta` path that is not
    `/published` terminates in a located `routeNotFound`. That holds for the
    dispatcher-only Hono adapter as much as for a full `rest` +
    `plugin-hono-server` boot, where the REST mount shadows the catch-all.
  - `packages/spec` declares the split in so many words:
    `PublishMetaItemResponseSchema` documents "the FULL body" of this route and
    records that the REST route hands the producer's object to `res.json()`
    verbatim, while the batch sibling `PublishPackageDraftsResponseSchema`
    documents a body answered "inside the dispatcher's `{ success, data }`
    envelope".
  
  The route never envelopes, so the tolerance was a dialect with no producer —
  Commandment #0.1's lenient fallback, and the kind that fails in the direction
  that hides the problem: a body arriving enveloped is one this door did not
  serve, and unwrapping it presents that as a successful promotion.
  
  **Behaviour delta, stated plainly.** Handed an enveloped body, `publishDraft`
  used to return the inner object and now returns the body as-is. Graded `patch`
  because that input is not one any measured configuration emits: on a conformant
  response — which has no `data` member at all — the removed branch was already a
  no-op, so `seedApplied`, `version` and `seq` read off both methods exactly as
  before. Sibling tolerances in the same file are untouched and still correct:
  `listDrafts` reads `data?.data?.drafts` because `GET /meta/_drafts` really is a
  dispatcher route, and `publishHealthFromResponse` unwraps because the batch
  publish door really is enveloped. The rule is per-route, not per-file.
- f75810e: Parse a `droppedFields` wire entry's `fields` elements and its `object` at the
  write-warning boundary instead of asserting them.
  
  The structural gate checked `Array.isArray(fields) && fields.length > 0` and then
  asserted the entry into a type declaring `fields: string[]` and a required
  `object: string` — reading neither. A response carrying `fields: [42]` reached
  `onWriteWarning` subscribers typed as a field name (the shell rendered it as the
  label `42`), and an entry that omitted `object` arrived claiming a string that was
  not there.
  
  Now the wire type declares only what the gate establishes, and the notice is
  parsed: non-string `fields` elements are refused, an entry naming no field at all
  is dropped as `fields: []` already was, and a missing or non-string `object` is
  healed from the object the write targeted. Warnings are never silenced for a
  field the server really did name. No published type changes — `WriteWarningEvent`
  and `DroppedFieldsNotice` keep their shapes, and a subscriber's `fields: string[]`
  is now true rather than asserted.
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [4ab4f1b]
- Updated dependencies [e3ea4f9]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [961ceaa]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
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
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [8acc51b]
- Updated dependencies [3261e64]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [4758b33]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [baac95a]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
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
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [3b469c8]
- Updated dependencies [990a2d6]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [9e6619f]
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
- Updated dependencies [328abeb]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [e227156]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [42687ba]
- Updated dependencies [6cd8f66]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [63ab761]
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
- Updated dependencies [a782fa7]
- Updated dependencies [76e9df0]
- Updated dependencies [6158e4c]
- Updated dependencies [c27b575]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [858eafb]
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
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [5638529]
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
- Updated dependencies [f560ded]
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
- Updated dependencies [64dae8e]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [f3c2bb0]
- Updated dependencies [9801765]
- Updated dependencies [9cebfca]
- Updated dependencies [460575f]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [ae476b8]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [fda49e5]
- Updated dependencies [490d9a9]
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
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [06b82b8]
- Updated dependencies [6f81384]
- Updated dependencies [8f1d995]
- Updated dependencies [dddb942]
- Updated dependencies [29754cf]
- Updated dependencies [3c2b6f7]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [5961030]
- Updated dependencies [c8ea8af]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [299102e]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [831be72]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [d0889e2]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [2c1c967]
- Updated dependencies [4d5f9b4]
- Updated dependencies [d6ceb8d]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [2acd8e1]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [adb2a86]
- Updated dependencies [3619792]
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
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [e2b3826]
- Updated dependencies [2e32ed4]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [554f2b6]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [25c7d58]
- Updated dependencies [00d2fa6]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [1237ae4]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [efbd566]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [5d0876c]
- Updated dependencies [b041b9c]
- Updated dependencies [ce2aaef]
- Updated dependencies [544ecba]
- Updated dependencies [bc640ec]
- Updated dependencies [1e215c4]
- Updated dependencies [da6e191]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [aef97e5]
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
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [0ea7054]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [fc32921]
- Updated dependencies [4eaa835]
- Updated dependencies [8f9d87a]
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
- Updated dependencies [846cec0]
- Updated dependencies [91facae]
- Updated dependencies [b38014e]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [3a43a15]
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
- Updated dependencies [fb3a101]
- Updated dependencies [d4733f2]
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
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [f1190b0]
- Updated dependencies [561abef]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [8693b85]
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
- Updated dependencies [3b6bc69]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [804831c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [30443fb]
- Updated dependencies [da45e6b]
- Updated dependencies [835f0f3]
- Updated dependencies [ed35b44]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [20b507a]
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
- Updated dependencies [f0f4d6c]
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
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [a8198de]
- Updated dependencies [05a49f2]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [af4fb29]
- Updated dependencies [ff5ef1c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [60500cb]
- Updated dependencies [2fcefb9]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [6791717]
- Updated dependencies [100547e]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [0e05aac]
- Updated dependencies [5aed9e4]
- Updated dependencies [83c77dc]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [e719ebd]
- Updated dependencies [516583b]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [8ebd57f]
- Updated dependencies [617707a]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [3e01cb5]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [fb336df]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [a691c0b]
- Updated dependencies [af3861f]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [258d264]
- Updated dependencies [c00bf28]
- Updated dependencies [93127bd]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [a51fa0c]
- Updated dependencies [51f3d8d]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [6c6cee7]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [91783c4]
- Updated dependencies [ca39427]
- Updated dependencies [2d36552]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [968dc1e]
- Updated dependencies [3c73d99]
- Updated dependencies [ed71d9e]
- Updated dependencies [7776fc2]
- Updated dependencies [e76634c]
- Updated dependencies [1170ed1]
- Updated dependencies [92814db]
- Updated dependencies [4d73b07]
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0

## 17.6.0

### Minor Changes

- a8411ad: data-objectstack: retire the four remaining `v3.0.0 Deep Integration` modules — `IntegrationManager`, `SecurityManager`, the studio canvas helpers (`createDefaultCanvasConfig` / `snapToGrid` / `calculateAutoLayout`), and the contract helpers (`validatePluginContract` / `generateContractManifest`) — for having zero code consumers outside this package
  
  `src/index.ts`'s `// v3.0.0 Deep Integration modules` banner introduced five
  modules. objectui#4152 / PR #4239 already retired the first,
  `CloudOperations`, for fabricating a plausible success against a client
  namespace that does not exist. This closes out the other four:
  `contracts.ts`, `integration.ts`, `security.ts`, `studio.ts`.
  
  **Not a repeat of #4152's urgency limb.** None of these four fabricated
  anything — `SecurityManager.generateCSPHeader()` really composes a header,
  `snapToGrid` really snaps, `validatePluginContract` really validates. What
  they shared with `CloudOperations` was the other limb: published surface of
  `@object-ui/data-objectstack` with a measured **zero** code consumers outside
  this package, across `packages/`, `apps/` and `examples/` (`.ts`/`.tsx`,
  excluding `node_modules`). The two apparent hits on re-measurement were
  homonyms, not consumers — `packages/plugin-designer/src/PageDesigner.tsx`
  declares its own local `snapToGrid` callback with no import from this
  package, and the `SecurityManager` hits outside this file are prose in
  `CHANGELOG.md`. Under the startup-focus principle a declared capability with
  no producer, no consumer and no business pull is retired, not kept on the
  chance it becomes useful.
  
  **Breaking, in FROM → TO form.** The following are no longer exported from
  `@object-ui/data-objectstack`:
  
  - `IntegrationManager` and its types (`IntegrationConfig`, `IntegrationTrigger`,
    `IntegrationProvider`, `SlackIntegrationConfig`, `EmailIntegrationConfig`,
    `WebhookIntegrationConfig`)
  - `SecurityManager` and its types (`SecurityManagerPolicy`, `CSPConfig`,
    `AuditLogConfig`, `AuditEventType`, `DataMaskingConfig`, `DataMaskingRule`,
    `AuditLogEntry`)
  - `createDefaultCanvasConfig`, `snapToGrid`, `calculateAutoLayout` and their
    types (`StudioCanvasConfig`, `StudioPropertyEditor`,
    `StudioThemeBuilderConfig`, `StudioColorPalette`, `StudioTypographyPreset`,
    `StudioShadowPreset`)
  - `validatePluginContract`, `generateContractManifest` and their types
    (`PluginContract`, `PluginExport`, `PluginAPIContract`,
    `ContractValidationResult`, `ContractValidationError`)
  
  It is a `minor` under this repo's version policy (objectui's own breaking
  changes never declare `major`). Nothing broke that was working: the only
  in-repo construction sites were this package's own `v3-compat.test.ts` (which
  exercised the modules directly) and `spec-symbol-batch6.test.ts` (which only
  guarded `SecurityManagerPolicy`'s name against colliding with the spec's
  unrelated `SecurityPolicy` — that guard is removed along with its subject).
  
  **No compile-compat stub was left**, for the same reason #4152 left none: with
  no consumer to keep compiling, a stub would be a second phantom surface
  guarding the first.
  
  **The banner and the compat-test title stop claiming a v3.** `index.ts`'s
  `// v3.0.0 Deep Integration modules` banner had nothing left under it once
  these four went, so it is removed rather than retitled.
  `v3-compat.test.ts` — titled "v3.0.0 compatibility tests for @objectstack
  dependencies" against a resolved `@objectstack` family of `17.0.0-rc.6` even
  before this change — is not an empty shell (one block, `PaginatedResult API`,
  never depended on any of the five retired modules), so it stays and is
  retitled instead of deleted.
  
  A negative pin
  (`src/v3-deep-integration-retired-4241.pin.test.ts`) replaces the retired
  `v3-compat.test.ts` cases and fails if any of the thirty retired names
  returns — reading both the runtime export list (which catches the seven
  class/function exports) and `index.ts`'s source text (the only instrument
  that can catch a returning `export type`).

### Patch Changes

- 1ef236e: `@object-ui/data-objectstack` stops publishing its `src/` tree
  
  The manifest's `files` array listed `src` alongside `dist`, so every published tarball carried all 43 source files — 38 of them `*.test.ts`. It had been that way since the package's first commit (`780a1b993`), never added for a consumer, and objectui#4006 recorded the same shape without acting on it: its scope was the `*.test.d.ts` half that the build program emitted into `dist`, and its own triage note graded this half as tarball weight rather than a break.
  
  Nothing in the published surface reached those files, which is why no consumer changes in either direction. Measured on a cleanly rebuilt `dist`, all four ways in are closed: the `exports` map has one entry (`.`) and every condition under it targets `dist`; `main` / `module` / `types` are `./dist/index.js`, `./dist/index.js`, `./dist/index.d.ts`; the repo and the docs teach only the root specifier, and no `@object-ui/data-objectstack/src/...` deep import exists anywhere (the `src` paths in sibling `vite.config.ts` / `vitest.config.mts` files are workspace aliases resolved through `path.resolve()` against the source tree, which no `files` array shapes); and the tarball holds no sourcemap that could point back at `src`, since `tsup.config.ts` sets `sourcemap: false` and its bundled `dts` writes no `.d.ts.map` — the built `dist` contains four files, zero `.map` among them, and zero occurrences of `sourceMappingURL` or `../src/`.
  
  `npm pack --dry-run` across the change, on the same `dist`:
  
  | | before | after |
  | --- | --- | --- |
  | entries | 51 | 8 |
  | unpacked | 1356830 B | 719876 B |
  | tarball | 393379 B | 222157 B |
  
  43 files leave, none arrives, and every surviving entry is byte-identical apart from the edited `package.json`: `dist/index.{js,cjs,d.ts,d.cts}`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`. The 43 are the 38 tests plus the five modules they cover (`index.ts`, `errors.ts`, `metadata-client.ts`, `userState.ts`, `cache/MetadataCache.ts`), whose published form remains the bundled `dist/index.js`.
- cf4f8a6: `MetadataClient.layered()` now reads the three-layer view from its declared path,
  `GET /meta/:type/:name/layers`, instead of flagging the ordinary item read.
  
  The consumer half of objectstack#5882 (ruled B by the maintainer; the server half
  landed in objectstack#6596 and shipped in `@objectstack/spec@17.0.0`). The layered
  projection — packaged baseline vs tenant overlay vs merged effective, which is
  what the Studio metadata editor's comparison tabs render — used to be reached by
  hanging a query flag on `GET /meta/:type/:name`. One route therefore answered two
  unrelated representations chosen by a query parameter, while `packages/spec`
  declared only the unflagged one: anything generating a client from the route
  table produced a parser that was simply wrong for the flagged call. The
  projection now has a path of its own and a response schema of its own
  (`GetMetaItemLayeredResponseSchema`).
  
  Same body, same envelope, so nothing in the editor changes shape: `code`,
  `overlay`, `overlayScope`, `effective`, the load-time `_diagnostics` and the full
  ADR-0010 protection envelope all still arrive on one round trip, and `?package=`
  (ADR-0048) is still threaded — the two entry points are served by ONE handler
  upstream precisely so the deprecation window's promise holds. The retired
  spelling still answers during that window, marked with RFC 9745 `Deprecation` and
  an RFC 8288 `Link: rel="successor-version"` pointing here, so this migration is
  safe against a lagging backend for as long as the window stays open, and it is
  what lets the maintainer close it.
  
  One behaviour delta rides along, and it is the server's design rather than a
  choice made here: the retired flag FELL THROUGH to the plain item read when the
  backend's protocol implementation had no layered support, answering the
  `{ type, name, item }` envelope. A dedicated path refuses to answer a different
  resource under this one's declared shape and returns 501 `NOT_IMPLEMENTED`, which
  surfaces as a failed read instead of a comparison view whose `code` and `overlay`
  are silently blank.
  
  The request is built in this package rather than delegated to
  `@objectstack/client` because the SDK expresses no layered read in either
  spelling — the framework's REST route ledger records the route as `server-only`,
  "consumed by objectui over plain HTTP", and whether the SDK should express it is
  an open upstream product call. The new path expectation is derived from the
  installed `@objectstack/spec` route table, and a ratchet keeps any shipped source
  file or skills guide from reaching the projection by query flag again.
- 3d053bb: The Studio's overlay-layer badge stops printing the producer's raw scope value
  
  objectui#4982. `MetadataLayered.overlayScope` was typed `string | null` under a comment naming its
  vocabulary as `organization | environment | package` — three spellings the producer has never
  emitted. The real vocabulary lives in `@objectstack/spec`'s `GetMetaItemLayeredResponseSchema`
  (`z.enum(['org', 'env']).nullable()`), and the framework's two assignment sites write `'org'` /
  `'env'`. Because the declared type was `string`, no compiler anywhere had an opinion, so the wrong
  comment was the only description of the field a reader had.
  
  `overlayScope` is now the spec union, derived by indexing the published response type rather than
  restated locally (a restatement is the fork `check:spec-symbol-derivation` rejects); the alias ships
  as `MetadataOverlayScope`.
  
  User-visible half: `LayeredDiff`'s overlay badge rendered that value straight to screen while the
  sibling artifact / none / merged badges all went through `translateConsoleValue`, and
  `CONSOLE_VALUE_ZH.layer` had no entry for either value the field can hold. One badge therefore had
  two languages depending on the data — a zh-CN admin opening any overlaid metadata item read `org` /
  `env`, while an un-overlaid one read 「已设」. The badge now translates like its three siblings, with
  「组织」/「环境」 added to the layer table. That table's overlay-scope half is keyed by the spec union,
  so a scope the spec adds later fails `type-check` until it has a label instead of quietly reaching a
  badge in English. `translateConsoleValue` remains zh-only for every group, as before — extending it
  to the other locale packs is a separate decision and not part of this change.
- d871f8e: A view personalization overlay no longer freezes the view it was laid over. `ObjectView`'s
  `persistViewPatch` sends `{ ...baseViewDef, ...patch }`, so a row written by a mere column
  drag or sort change stored the view's whole body — its effective `filter`, `columns`,
  `label`, `type`, `isDefault` — as of that moment, and the display merge
  (`{ ...source, ...override }`) then let that snapshot outrank the source view indefinitely:
  an admin edited a view's filter and everyone who had ever resized a column silently kept the
  old filter, with nothing reporting it.
  
  An overlay now contributes only the keys it owns — `rowHeight`, `sort`, `hiddenFields`,
  `columnState`, `inlineEdit` (`VIEW_OVERLAY_OWNED_KEYS`, new export from
  `@object-ui/data-objectstack` alongside `narrowPersonalizationOverlay`) — so a later change
  to the source view reaches every user, including those whose stored row still carries the
  old snapshot: rows written before this change stop shadowing the source on the next read,
  with no migration to run and nothing rewritten at rest. A genuine saved view's own body is
  untouched — it is classified by the same predicate `listViews()` already excludes overlay
  rows by, so a row cannot be an overlay for one reader and a saved view for the other
  (objectui#5233, ruled on objectstack#7494).
- a0b9e91: A system (code-defined) view's personalization overlay row no longer masquerades as a user-created saved view.
  
  Toggling density / sort / hidden columns / column widths / inline-edit on a code-defined view persists a row under the same `type='view'` metadata namespace a genuinely saved view lives in, keyed by the same id (`ObjectStackAdapter.updateViewConfig`). `listViews()` previously returned that row indistinguishably from a real saved view, so `ObjectView`'s `isSystem = !saved` check flipped to `false` and the tab gained Rename / Delete / Set-default / Pin against a view that lives in code — `handleDeleteView` would even call `dataSource.deleteView` on it.
  
  Two layers now keep the two kinds of rows apart:
  
  - **Write side**: `updateViewConfig` — the only production writer of personalization overlays — stamps an explicit `_isOverride: true` discriminant on every row it saves, UNLESS the write targets an already-saved view's own row (see below).
  - **Read side**: `listViews()` excludes any row carrying that marker, and (for rows already persisted before this fix shipped) a best-effort legacy shape: a flat body with a `viewKind` the platform can only have server-side-backfilled from a registry (code-defined) baseline — a genuine runtime-created saved view never has one.
  
  `listViewOverrides()` (the reader `ObjectView` uses to merge these settings back into the live view for display) is unchanged — it is supposed to keep seeing overlay rows.
  
  The overlay this stores is **org-wide shared view settings**, not a per-user preference (a true per-user scope is a parked platform-side v18 direction) — comments describing it as "personal" have been corrected to say so.
  
  **Follow-up fix (same card, post-review):** `updateViewConfig`'s ONE call site (`ObjectView`'s toolbar-driven toggle) fires for a toggle on EITHER a system view OR an already-saved view — a saved view whose own toolbar the user toggles writes to that same view's own row. Stamping the overlay marker unconditionally there would flag the user's own saved view as an overlay and make `listViews()` exclude it on the very next read, i.e. the saved view would vanish from the switcher the moment its density was adjusted. `updateViewConfig` gains an optional `opts.isSavedView` parameter (also added to the `DataSource` interface in `@object-ui/types`); `ObjectView` passes it from the same `isSavedViewId` classification its readonly gate and mutating handlers already use, and the marker is withheld when it's true.
- Updated dependencies [88085e3]
- Updated dependencies [2533ec5]
- Updated dependencies [bbe8b86]
- Updated dependencies [8477be5]
- Updated dependencies [279fb13]
- Updated dependencies [ad07b65]
- Updated dependencies [41f498b]
- Updated dependencies [e1d4251]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [ac600e5]
- Updated dependencies [c1ef923]
- Updated dependencies [af5e292]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [f1d4748]
- Updated dependencies [b1119ec]
- Updated dependencies [9f23d2b]
- Updated dependencies [578e025]
- Updated dependencies [af025ee]
- Updated dependencies [598c89a]
- Updated dependencies [b8b9af4]
- Updated dependencies [31676be]
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [58b8346]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
  - @object-ui/types@17.6.0
  - @object-ui/core@17.6.0

## 17.5.0

### Minor Changes

- 932cbcd: An app you are not allowed to open now says so, instead of reporting that it may still be publishing

  `GET /api/v1/meta/apps` is filtered per session server-side (`filterAppForUser`), so an app withheld by its `requiredPermissions` and an app that does not exist were byte-identical to the console: both simply absent from the list. With one fact and two conditions, `AppContent` rendered its only copy for an absent app — "This app is not available yet — it may still be publishing. Try again in a moment." — over a permanent authorization decision, under a Retry button that could never succeed.

  That is not a cosmetic complaint. On a downstream acceptance round one role hit this screen while another opened the same app fine, and because the copy names a transient deployment state the finding was filed as a suspected platform defect and carried through two test batches before a clean-baseline investigation found the account was missing a permission-set binding. The gate had been working exactly as designed; the message is what sent everyone to the wrong place.

  The maintainer ruling (2026-08-12) took the contract half first. objectstack#8013 made the BY-NAME route answer an explicit denial — `403` with the ADR-0112 catalog code `PERMISSION_DENIED` in the declared `{ success: false, error: { code, message } }` envelope — for an app that exists and whose `requiredPermissions` the session lacks, while the LIST route stays filtered exactly as before, with no `authorized: false` flag, so the enumeration surface is not widened past what a direct by-name probe already implies. Absence keeps answering `404 RESOURCE_NOT_FOUND`, and so do the two neighbouring refusals the same ruling deliberately left alone: an unpublished app (ADR-0045 §3 keeps it externally unobservable) and an app gated by an absent optional service (ADR-0057 D10 — nothing was denied to the caller).

  This is the console half. When a requested app is missing from the list and the existing post-publish readiness re-check still cannot find it, the console asks the by-name route which of the two it is, through a new `ObjectStackAdapter.probeAppAccess(name)`. On the measured code it renders a plain authorization message with a way back to the launcher; on anything else — an absent app, an unreachable server, a host that injected a DataSource without the probe — today's publishing copy renders byte for byte, retry button included.

  Two properties of that seam are load-bearing rather than incidental. It branches on the ADR-0112 **code**, never the status (objectui#4408): the two answers under test are both errors one status apart, and a status-reading implementation passes the happy path while going blind exactly where the defect lives. And only `denied` moves the copy: this bug exists because the console asserted a state it had not measured, so a probe that fails, times out or cannot be issued must leave the screen alone rather than guess in the other direction.

  `probeAppAccess` is deliberately separate from `getApp` rather than a flag on it: `getApp` degrades every failure to `null` — the very conflation being undone — and memoises in the adapter's metadata cache, where a verdict about the CALLER would outlive the session it described. New public API on the adapter (`probeAppAccess`, `isAppPermissionDeniedError`, `APP_PERMISSION_DENIED_CODE`, `AppAccessVerdict`), purely additive; nothing existing changed shape. Three new `empty.*` keys ship in all ten locale packs.

- 537a0d1: `deleteView` removes every home the view has — deleting a draft-only saved view no longer silently no-ops

  A view has two possible homes: the pending per-item **draft** (`DELETE /api/v1/meta/view/:name?state=draft`) and the **published** overlay (`DELETE /api/v1/meta/view/:name`). `deleteView` addressed only the second, unqualified. Deleting a view that existed only as a draft therefore fired the delete at the published overlay, the server answered `200 {"success":true,"reset":false,"message":"No view '…' found — nothing to delete."}`, the draft survived untouched, and the tab was still there after a reload — while the receipt reported `{ deleted: false }` and nothing surfaced the refusal to the user.

  That is not a corner case. ADR-0034's `persistRuntimeMetadata` (app-shell) stages **every** runtime edit as a draft, and a view created from the `+` tab lives ONLY as a draft until an explicit Publish — so both "a view you just made" and "a published view you have since edited" are routinely draft-carrying.

  **Why this is not the mechanical mirror of #4139.** `updateView` probes the draft first and writes back to whichever home the read resolved; that is right for an update in all cases. Copying it here would have been wrong in one: on a published+draft pair a draft-first-_only_ delete discards the draft and leaves the published row still serving the view. That is not Delete view, it is **Discard draft** — a deliberately different operation that already exists (`discardRuntimeDraft`, documented as "the published overlay is untouched"). The asymmetry has a clean statement: for an update, one home is the right home; for a delete, "remove this view" is satisfied only when _no home is left serving it_.

  So both homes are now deleted, **draft first**. The order is load-bearing on the failure path: a fault between the two calls leaves the published overlay intact, so the view is still served and the delete is cleanly retryable. The reverse order would strand a draft-only view — precisely the bug above.

  **Two blind calls, no probe.** Measured against the framework's `deleteMetaItem`: a missing home is reported as a **200** carrying `reset:false` (`"No pending draft for view/x."` / `"No view 'x' found — nothing to delete."`), never a 404. There is nothing for a probe to protect against, and `updateView`'s probe exists for a different reason — its read must resolve the row the merge writes back to — which has no counterpart for a delete.

  **One transport, one error contract.** Both halves now go through `MetadataClient.reset()`, the transport that can express the `?state=` qualifier and the one `updateView`'s draft half already uses. The published half previously went through `client.meta.deleteItem`; measured, that issues the byte-identical request (this adapter configures no environment scoping), so routing it here changes no addressing and collapses two error shapes into one `MetadataError`.

  The receipt is widened **additively**: `{ deleted }` gains optional `draft` and `published` outcomes (`removed`, plus the server's `reset` / `message`). `deleted` is true only when no home is left serving the view _and_ at least one actually held a row — a view that existed in neither home still answers `false`, unchanged. A failure of the published half after the draft was discarded now throws (matching `updateView`'s convention of surfacing a fault rather than degrading) carrying the partial state on the error's `outcome`: "draft gone, overlay left" is exactly what the old `{ deleted: boolean }` could not express, and it is never rounded up to `true`.

  Cache invalidation moves into a `finally`, so `invalidateViewKeys` fires exactly once per call on **every** outcome including the throw. After a half-failure the draft row really is gone, and objectui#4363's asymmetry decides it: an unnecessary invalidation costs one refetch, a missed one costs the cache's full 5-minute TTL of stale overrides.

  Minor rather than patch: this moves published behavior for existing callers and adds two exported types, the same grading objectui#4271's `get()` unwrap and objectui#4495's `find()` resolve→reject took. The `.d.ts` diff is additive only — `deleteView`'s return widens from an inline `{ deleted: boolean }` to the new `DeleteViewResult`, which still carries `deleted: boolean` — so no consumer needs a code edit to keep compiling. A repo-wide census found one call site (app-shell's `ObjectView` delete handler), which awaits the call and does not read the receipt.

- bec3e14: The `DataSource` contract carries `deleteView`'s per-home outcomes (#4564)

  #4479 / PR #4562 widened the ObjectStack adapter's `deleteView` to return
  `DeleteViewResult { deleted, draft?, published? }`, so a caller could finally tell a
  partial delete ("draft gone, published overlay left") from a complete one. The shared
  interface did not follow: `DataSource.deleteView?` still declared the narrow
  `Promise<{ deleted: boolean }>`.

  Nothing failed to compile, and that is exactly what made the gap invisible — a wider
  return is assignable to a narrower declaration, so the adapter satisfied the interface
  while every consumer reaching it **through** `DataSource` was handed a type with the
  per-home outcomes already discarded. The one real call site today (app-shell's
  `ObjectView` delete handler) awaits the call and reads nothing off the receipt, so the
  loss was latent rather than broken.

  `DeleteViewResult` and `ViewHomeDeleteOutcome` now live in `@object-ui/types`, beside
  the `DataSource` interface that returns them, and `deleteView?`'s declared return is
  `Promise<DeleteViewResult>`. The direction was forced: the dependency runs
  `@object-ui/data-objectstack` to `@object-ui/types` and never the other way, so the
  shapes could not be imported downward — moving them was the alternative to re-declaring
  a structural twin in `types`, which the one-resolver rule rejects because a copy is
  mutually assignable with the original for exactly as long as it takes to drift.

  `@object-ui/data-objectstack` re-exports both names unchanged, so every importer PR
  #4562 left pointing at it keeps compiling — and now resolves to the same declaration the
  shared contract speaks rather than a look-alike. A repo-wide census before the move
  found zero importers of either name outside the declaring file itself, PR #4562's own
  suite included, so the re-export is insurance rather than a load-bearing shim.

  `deleteView` stays **optional** on the interface and keeps both parameters; the growth is
  to the return type only, and `deleted` is untouched, so a consumer reading only `deleted`
  needs no edit.

  Grading, per this repository's version-alignment convention (the major tracks
  `@objectstack`, never an API-break count):

  - `@object-ui/types` — **minor**: entry-reachable growth. Two new exported interfaces
    plus a widened method return on `DataSource`, all reachable from the package entry.
  - `@object-ui/data-objectstack` — **minor**, measured rather than assumed. Its emitted
    `dist/index.d.ts` is **not** byte-identical after the swap: the two `interface` blocks
    leave the file and are replaced by a re-export from `@object-ui/types` (121.61 KB to
    120.25 KB). Both names remain in the public export list, so no importer breaks, but the
    declaration genuinely moved and the emitted types now depend on `@object-ui/types` for
    it — that is a minor, not a patch.

- 479cc7b: `MetadataClient.get()` returns the item body its docblock always promised — the field half of the permission matrix is alive again

  `GET /api/v1/meta/:type/:name` answers the spec-declared envelope `{ type, name, item, …protection fields }` — one shape, for published and draft reads alike, since objectstack#5563 collapsed the read to it. `get()` handed that envelope straight back to callers while its own docblock declared it returned "the unwrapped item content". Every consumer reading `obj.fields` therefore read `undefined`.

  The visible cost was the entire field-level half of the permission matrix: expanding any object in `/_console/apps/:app/metadata/permission/:set` reported "No fields registered for this object." with zero checkboxes, for every object, while the network showed that object's 21 fields arriving 200 OK. Reproduced against two objects on fresh loads, and proven not to be the read-only gate — a run with the editor fully writable (864 enabled checkboxes) still showed an empty field sub-table, which is exactly what a read resolving `undefined` predicts.

  That was one symptom of nine. A census of every `get()` call site found **zero** deliberate readers of the envelope and nine consumers reading the body directly, all of them broken the same way: the RLS CEL editor's field lint and autocomplete resolved an empty field set; the dataset inspectors and the preview field/catalog hooks came back empty; the report drill-down's fallback path read `def.object` off the envelope, found nothing and silently returned; the record-page seed synthesized a default layout from an envelope instead of an object; and the Field Designer read `raw.fields` for display and then wrote `{ ...raw, fields }` back — saving the envelope over the object body. None of it was caught, because the test doubles across the repo were written against the docblock: they answered a bare `{ fields }` body, so the suite exercised the documented contract while production ran the other one.

  The fix is at the producer, not the nine consumers. `get()` now unwraps the envelope once, at the client boundary — so every one of those call sites is repaired without being touched. Detection is by the PRESENCE of the three keys `GetMetaItemResponseSchema` declares (`type: string`, `name: string`, an `item` slot), never guessed from payload contents: a metadata document carrying its own `type` and `name` (a view is `{ name, type: 'grid', … }`) has no `item` and is left whole, and a document with an `item` property of its own but no envelope identity is likewise untouched. Key count is deliberately not part of the test, since a real envelope also spreads the ADR-0008 protection carriers. Anything that is not the envelope — an older server answering the bare document — passes through byte-for-byte, and 404 still reads as `null`.

  `getDraft()` is unchanged and keeps returning the envelope, which its docblock declares and roughly eleven call sites depend on by reading `.item`. That asymmetry is now real rather than aspirational: the two methods share one private transport, and differ only in whether they unwrap. `unwrapDraftBody` (app-shell) and `unwrapViewDraft` (this package) remain the shared helpers for taking a draft body out, and both were already tolerant of either shape, so the two seams that reach a draft through `get()` keep their exact semantics — including reading an empty draft as "nothing pending".

  Minor rather than patch: this moves published behavior for existing callers, the same grading `find()`'s resolve-to-reject change took. No signature changed — the `.d.ts` diff is documentation plus one private member — so nothing needs a code edit to keep compiling; a caller that had written its own `.item` compensator against the old behavior would need to drop it, and none exists in this repo.

- 2776b11: data-objectstack: retire the phantom `CloudOperations` surface — the class, its three `Cloud*` types, and the module that claimed to integrate a cloud namespace no client has ever shipped

  `src/cloud.ts` exported a `CloudOperations` class with four methods, all
  re-exported from the package entry, so this was published surface of
  `@object-ui/data-objectstack`. Every method optional-chained into
  `client.cloud?.…`, and no released `@objectstack/client` has ever exported a
  `cloud` namespace. Re-measured at `17.0.0-rc.6` before deleting: the module's
  export list is `ObjectStackClient`, `ScopedProjectClient`, `RealtimeAPI`,
  `QueryBuilder`, `FilterBuilder`, `createQuery`, `createFilter`, and a
  constructed client's `.cloud` is `undefined`. The nearest real namespaces on the
  instance — `projects` (which owns `/api/v1/cloud/environments`) and `packages`
  (which owns marketplace installs) — are not what these methods reached for.

  So every call resolved `undefined` and fell through to a literal:

  | method                | what it returned, always                                      |
  | :-------------------- | :------------------------------------------------------------ |
  | `deploy`              | `{ deploymentId: 'deploy-' + Date.now(), status: 'pending' }` |
  | `getDeploymentStatus` | `{ status: 'unknown' }`                                       |
  | `searchMarketplace`   | `[]`                                                          |
  | `installPlugin`       | `{ success: false }`                                          |

  The maintainer's 2026-08-11 ruling removed it rather than repairing it, and named
  the reason: `deploy()` did not degrade to an error, it **manufactured a
  plausible success**. A caller got a well-formed `deploymentId` for an operation
  that never left the process and then polled it forever against
  `{ status: 'unknown' }`. That is the most dangerous shape for an AI consumer,
  which builds downstream logic on the fake id instead of getting suspicious.
  Under the startup-focus principle a declared capability with no producer, no
  consumer and no business pull is retired, not stubbed.

  **Breaking, in FROM → TO form.** `CloudOperations`, `CloudDeploymentConfig`,
  `CloudHostingConfig` and `CloudMarketplaceEntry` are no longer exported from
  `@object-ui/data-objectstack`. It is a `minor` under this repo's version policy
  (objectui's own breaking changes never declare `major`). Nothing broke that was
  working: the only in-repo construction site was a test, and every method's
  observable behaviour was a fabricated constant.

  **No compile-compat stub was left.** The ruling allows one — throwing loud
  `NotImplemented` — only where a compile need is demonstrated. Measured across the
  whole repository, the sole importers were the package's own `index.ts`,
  `v3-compat.test.ts` (three cases asserting the fallback had the right _keys_,
  which is how the emptiness stayed green) and objectui#3720's vocabulary pin. No
  app, no other package, no doc. With no consumer to keep compiling, a stub would
  be a second phantom surface guarding the first.

  The false module header went with it — it read `Cloud namespace integration for
@objectstack/spec v3.0.0 / Replaces the legacy Hub namespace`, against a resolved
  spec of `17.0.0-rc.6` and schemas this package never consumed.

  **objectui#3720's pin retires with its subject.** `cloud-environment-vocabulary.pin.test.ts`
  pinned the doc comment on `CloudDeploymentConfig.environment` — the deliberate
  three-member deploy-target vocabulary and the `staging`-is-not-a-discovery-member
  trap. Every fact it held was a claim _about_ that comment, and its spec-side
  assertions existed only to keep those claims honest; with the type deleted they
  would pin `@objectstack/spec`'s enums on behalf of no local reader — the same
  phantom shape this change closes. #3720's conclusion is unaffected and now moot:
  it found no producer-side deploy-target type to converge onto because the
  producer did not exist, and this change removes the consumer that was waiting for
  it. Its pending empty changeset (`cloud-deploy-environment-vocabulary-3720.md`,
  never released) is removed too, since it announced a deliberate vocabulary on a
  type this same release deletes.

  A negative pin (`src/cloud-surface-retired-4152.pin.test.ts`) replaces the
  retired cases and fails if any of the four names returns — reading both the
  runtime export list (which catches the class) and `index.ts`'s source text
  (which is the only instrument that can catch a returning `export type`).

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

### Patch Changes

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

- c0f9a4b: Studio surfaces the runtime authoring gate's advisory findings instead of discarding them client-side

  The framework's runtime authoring gate produces two kinds of verdict on a metadata write. Errors become a 422 and the author sees them. Advisories ride a **200** — the save succeeded, the row persisted, the version bumped — and until objectstack#7435 the server dropped them into a deduped `console.warn` behind a process-level set. That landing put them on the wire as an optional `advisories[]` on the save response, emitted only when non-empty, and objectui was still throwing them away one layer further out: `MetadataClient.save` parsed the body, returned it as an opaque `T`, and every call site awaited it for its side effect and discarded the value.

  The measured case the fix is built on: a `nightly_purge` flow whose only defect is a `delete_record` node with `multi: true` and no filter yields `errors = 0 / advisories = 1`. The save returns 200, the flow goes live, and nothing anywhere tells the author it deletes every row. That matters most for exactly the authors Studio serves — a Studio tenant or an MCP/AI author has no `os lint` and no CLI config for `sys_metadata` overlay rows, so this gate is not the weakest of four doors, it is the only one.

  `MetadataClient` now carries an `onSaveAdvisory` sink, invoked after a save whose response carried a non-empty `advisories[]`, and the console wires it in `useMetadataClient` — the one hook every app-shell write path takes its client from, so a single wiring covers `ResourceEditPage`, `StudioDesignSurface`, `EmbeddedItemEditor`, `DatasourceResourcePage`, `ObjectHooksPanel` and any future call site rather than a toast copied into twenty of them. The finding shape is re-exported from `@objectstack/spec` (`RuntimeAuthoringIssue`) rather than restated, so it cannot fork from the 422 `issues[]` it deliberately shares a declaration with.

  The affordance is the warning tier and says "Saved" first. A successful save that reads as a failure is the specific defect this surface must not ship, so the toast acknowledges the write, lists `rule` + `message` + `hint` per finding with `where` as secondary context, and renders that text **verbatim** — `message` and `hint` are server prose composed by the gate's rules, not i18n keys. Only the frame around them is translated (`console.saveAdvisoryTitle`, ten packs). The sink is best-effort in both directions: a malformed finding is dropped rather than printed as blanks, and a throwing renderer cannot turn a save the server already committed into an error.

  **What this does not surface yet, and why.** Studio's designer saves as a **draft** on every edit, and drafts are never gated — the framework returns at its D1 early-return (`if (args.state !== 'active') return null`) before running a single rule, so a draft save produces no findings at all rather than producing some that get withheld. The publish step that promotes a draft to active _does_ run the gate, but the publish route returns no `advisories` field until objectstack#7294 lands. So a draft-then-publish flow renders nothing today, at both of its doors, for two different reasons; the active-mode save door renders findings now. That gap is pinned as a test rather than left for a reader to rediscover.

- 605b747: The second metadata client class surfaces the runtime authoring gate's advisories instead of discarding them

  objectui#4133 (PR #4236) put the gate's advisory findings — the ones that ride a **200**, where the save succeeded and the row persisted — in front of Studio authors, but it covered only one of the two client classes that write through `PUT /api/v1/meta/:type/:name`. The wiring lifts at `useMetadataClient`, which is where every app-shell path takes its `MetadataClient` from. `ObjectStackClient.meta.saveItem` — the SDK client hanging off `ObjectStackAdapter` — is a different class reaching the same door, and every one of its callers awaited the call and discarded the response, so an `advisories[]` the server attached was parsed off the wire and dropped one layer further out.

  Those callers all write in **active** mode, so this is not the draft case where the gate never runs: the gate does run for them, produces findings, and the author was told nothing. The list is `MetadataService` (five saves behind the Object Manager and Field Designer), `useNavigationSync`, plugin-designer's Create/EditAppPage, and the adapter's own `updateViewConfig` / view / `updateDashboard` paths.

  `ObjectStackAdapter` now carries an `onSaveAdvisory(listener)` subscription and emits on it after a metadata save whose 200 carried a non-empty `advisories[]`; `AdapterProvider` subscribes once and renders through the same `emitSaveAdvisories` the other client class already uses, so both doors produce one wording on the warning tier that says "Saved" first. The emitter is installed **once at the adapter/client seam** rather than at the call sites: every caller above reaches the save door through the adapter's own long-lived `ObjectStackClient`, so one interception covers all of them, plus any future one, without a toast copied into a dozen places — the same reasoning that put #4133's sink at one factory instead of twenty call sites.

  It is a sibling of the `onWriteWarning` channel (#3431/#3455) rather than a second payload pushed down it, which is what `MetadataSaveAdvisoryEvent` already said it was modelled on. `WriteWarningEvent` is a closed shape whose required `droppedFields` means "fields the write legally stripped", so carrying advisories on it would either force every existing subscriber to grow a branch or make the event lie about what happened. The seam's shape is reused; its event type is not. `readSaveAdvisories` is shared unchanged between the two clients — one reader, two call sites — which the response envelopes make possible: the spec puts `advisories` at the save body's top level, and the SDK returns that body verbatim (it strips its `{ success, data }` envelope only when a `data` key is present, and this body has none). That measurement is pinned by tests that drive a real SDK client through a fake `fetch` rather than stubbing the method under test.

- b42558a: Renaming a freshly-created view now persists — `updateView` reads and writes the same row, instead of reading the published overlay and losing the edit into a rejected partial write

  ADR-0034 stages every runtime-created view as a per-item **draft**: a view made from the `+` tab lives only in the draft row until an explicit Publish, and the UI reads it back through `?preview=draft`. `updateView` addressed neither half of that. Its read went to the published overlay (`client.meta.getItem`, no draft qualifier), which 404s for a draft-only view; a `catch {}` labelled "treat missing as create-equivalent" then substituted `current = {}`, so the read-merge-write cycle merged onto nothing. What went out was the fragment that merge produces — literally `{label, name, object}`, no `viewKind`, no `config` — which the server rejects as an invalid ViewItem (422). Nothing surfaced to the user, and the draft row still held the old label, so the rename simply did not happen. Create, pin and delete were unaffected: they never take this path.

  The read now probes the draft row first and, on a hit, merges onto that body and writes it straight back with `mode: 'draft'`. Whichever row the read resolved is the row the write updates, so the two halves agree by construction rather than by coincidence. Probing the draft **before** the published overlay is what makes it correct for a view that has both: writing the published row while a draft is pending would put the edit somewhere the draft shadows, and Publish would later overwrite it with the pre-edit body — losing the change a second time, further from the cause. A draft edit stays a draft, preserving ADR-0037's guarantee that nothing the preview shows goes live until Publish. Renaming a published view with no draft pending is unchanged, published read to published write.

  The silent catch is gone. A view that resolves in neither home now throws naming the view and the object (creating one is `createView`'s job — no caller of `updateView` relied on the create-equivalent behaviour), and a network, permission or server fault on either read propagates instead of degrading into the partial write that corrupted the row. This turns a class of failure that was previously invisible into an error the existing call sites already catch and surface.

  Set-default and reorder drive the same read-merge-write cycle with `{isDefault}` / `{sortOrder}` patches, so they were emitting the same partial write and are fixed by the same change.

- d2f6e6b: Publishing a view from the console no longer serves a five-minute-stale override map — every writer now routes through one invalidation seam

  `ObjectStackAdapter` caches two view-shaped reads: `getView` under `view:{object}:{name}` and `listViewOverrides` under `view-overrides:{object}`, with `MetadataCache`'s default 5-minute TTL. objectui#4363 made the adapter's own four write paths drop both. But the console's real create-a-view flow never calls any of them: `ObjectView.handleViewCreate` writes through the ADR-0034 metadata seam (`createRuntimeMetadata` → `metadataClient.save`), and Publish goes `RuntimeDraftBar` → `publishRuntimeMetadata` → `metadataClient.publish`. Two writers into the same `/meta/view/:name` rows; only one of them invalidated anything.

  Publish is the sharp end. A create lands an invisible per-item draft, and `listViewOverrides` enumerates published rows, so the map is still honest there. Publish promotes the row into exactly the world the map describes — and nothing dropped the key, so the object page kept applying its pre-publish snapshot for the rest of the TTL. It does not self-heal: `loadViewOverrides` treats a resolved map as authoritative and deliberately does not re-probe per view (objectui#3774, correct — re-probing reinstates the 404 flurry the batch read exists to remove), so the per-view `getView` fallback that would have masked a stale map is by design unreachable.

  The fix is one seam rather than a fifth copy of the key list. `ObjectStackAdapter.invalidateViewKeys(objectName, viewName)` is now the only place that knows which keys a view-row write drops; the adapter's four write paths call it instead of restating the pair, app-shell's ADR-0034 persistence module calls it for `view` saves, creates, publishes and discards, and `MetadataService.saveMetadataItem` calls it when the category is `view` (where it previously named `view:{name}`, which no reader has). Restatement is what this repo keeps paying for — objectui#3778 removed five copies of a key no reader populated, objectui#4363 fixed four copies that named half the live set, and objectui#4373 is the measured proof that a new writer forgets the list by default. A pin suite can only guard writers that exist; a seam makes the next one unable to forget.

  No cache key, no read path and no public signature changed. The adapter's eight existing invalidation pins pass unchanged, which is the evidence that routing four paths through a seam changed nothing observable; two new structural guards keep the key set from being restated again — one asserting each key template appears exactly twice in the adapter (its reader, and the seam), one asserting no app-shell file spells either.

- 85a3082: Every view write path now invalidates the override map — a created, renamed or deleted view is no longer shadowed by a five-minute-stale batch read

  `ObjectStackAdapter` caches two view-shaped reads: `getView` under `view:{object}:{viewId}`, and `listViewOverrides` under `view-overrides:{object}`. Four write paths touch view rows, and until now exactly one of them — `updateViewConfig` — invalidated the second key. `createView`, `updateView` and `deleteView` invalidated only the per-view key, so the batch override map kept answering from a snapshot taken up to `MetadataCache`'s default 5-minute TTL earlier.

  That gap does not heal itself. `loadViewOverrides` in app-shell's `ObjectView` treats a resolved map as authoritative and deliberately does not re-probe per view — that is objectui#3774's fix, and it is correct, since re-probing reinstates the 404 flurry the batch read exists to remove. So the per-view `getView` fallback that would have masked a stale map is by design unreachable, and the stale map is served in full. Meanwhile `listViews` is uncached and answers fresh, so the view switcher could list a view whose override body came from a map written minutes earlier: the sharpest shape is the rename/pin path (`updateView`), where a user edits a view, returns to the object, and is served the pre-edit override.

  All four paths now emit the same ordered pair — the per-view key, then the object's override map. The rule is uniform per method rather than per branch: `updateView`'s draft half invalidates both keys as its published half does, which is deliberate over-invalidation (both readers enumerate published rows, so a draft write stales neither) chosen because an unnecessary invalidation costs one refetch while a missed one costs the full TTL. `createView` names the per-view key too, because `saveItem` is an upsert and an explicit `spec.name` that already exists overwrites a published row a prior `getView` may hold.

  No signature, no cache key and no read path changed; the only difference is which keys each write drops. The pin suite added by objectui#4328 now asserts the full invalidation key set for all five call sites, with the sweep's two pins kept as untouched controls: `listViews` stays uncached, and no write path names the retired `views:{object}` key.

- Updated dependencies [ee66e2e]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [1f9b905]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [7e4f0e5]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [49ae9f4]
- Updated dependencies [2459a3e]
- Updated dependencies [d6aa172]
- Updated dependencies [fe52a04]
- Updated dependencies [bb68488]
- Updated dependencies [9461dd3]
- Updated dependencies [ab04728]
  - @object-ui/core@17.5.0
  - @object-ui/types@17.5.0

## 17.4.0

### Minor Changes

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

- 3765678: data-objectstack: pass the server's `drillRanges` date-bucket drill scope through `queryDataset` (restores date drill-through)

  `queryDataset` rebuilds its result by **hand-picking** keys off the REST payload,
  and `drillRanges` was never in the list — so the analytics service's date-range
  drill sidecar (framework#1752) was dropped by the only real adapter in this repo,
  while five consumer call sites were already reading it (`DatasetWidget.tsx:471`
  and `:593`, `DatasetReportRenderer.tsx:316`, `:431`, `:855`).

  The user-visible effect was not a degraded drill but a missing one. A
  `dateGranularity` dimension groups a **span** of records into one bucket, which
  equality filters cannot express, so `service-analytics` deliberately excludes
  date dimensions from `dimensionFields`/`drillRawRows` and sends a parallel
  half-open `[gte, lt)` range per row instead. For a chart or report grouped **only
  by time** that makes `drillRanges` the _only_ thing that can make
  `canDrill = !!object && (drillDims.length > 0 || !!drillRanges?.length)` true —
  with the key dropped, the entire drill entry point disappeared. A mixed
  date + non-date grouping kept its drill but built a filter with no time bound, so
  clicking June's bar opened every month (a superset).

  Neither side's tests could see it: the dashboard and report tests mock their own
  data source and feed `drillRanges` in directly, and the adapter's own suite never
  asserted the key. The new adapter-level tests therefore mock the **envelope the
  server actually sends** — bare (`res.json(result)`, no `{ success, data }`
  wrapper), carrying `sql`, and for a date-only grouping carrying `object` +
  `drillRanges` and _no_ `dimensionFields`/`drillRawRows` — then assert the key
  arrives verbatim and row-aligned, that the consumers' own `canDrill` predicate is
  true, and that `buildDatasetDrillFilter` (the shared builder both surfaces call)
  scopes the drilled list to the clicked bucket.

  The declared entry type is `@object-ui/core`'s `DatasetDrillRange` **by
  reference**, per the objectui#3613/#3752 discipline: it is the single in-repo
  declaration of this shape (what the filter builder accepts and what both
  renderers type their state with), and nothing in `@objectstack/spec` owns it yet,
  so restating `{ field, gte, lt }` locally would create a third dialect of it.

  `drillRawTotals` (the totals-row companion, framework#3214) is deliberately
  **not** added: it has zero consumers in this repo, so passing it through would
  add a declared-but-unexercised return key with no user-facing effect — it belongs
  in the change that lands a totals-row drill and can test it.

- d83f6b3: data-objectstack: type `queryDataset`'s result `fields[]` as the spec's `AnalyticsResult.fields[]` element instead of a hand-written copy

  The return-value half of the drift objectui#3613 fixed on the parameter side. The
  adapter hand-listed five keys for a result column
  (`name`/`type`/`label`/`format`/`currency`) and, like every restatement, stopped
  at the contract of the day it was written: it never grew **`percentScale`**,
  which `@objectstack/spec@17.0.0-rc.5` carries on
  `AnalyticsResult.fields[]` and documents as mandatory reading for renderers —
  "renderers that receive it must scale by it instead of guessing from the value"
  (objectui#3136).

  That omission was not cosmetic. `percentScale` is the server's answer to a
  question a `%` format string cannot express (is the stored number a 0–1 fraction,
  or already percentage points?), and objectui#3136 exists because guessing from
  the value's magnitude printed a ratio of exactly `1` as "1.0%". Three in-repo
  consumers read the field through their own local types
  (`DatasetResultField` in `@object-ui/core`), so nothing was red here — but any
  author reading columns through the adapter's **declared** return type got
  `Property 'percentScale' does not exist`, i.e. the declaration actively steered
  them back to the guess the spec bans.

  `fields` is now the spec type by reference, so there is nothing left to re-sync;
  the change is additive for existing consumers (one more optional key).
  `queryDataset.test.ts` pins structural identity with the spec element, pins
  `percentScale` as the `'fraction' | 'whole'` union rather than a widened
  `string`, keeps a negative pin against the five-key shape, and adds a runtime
  test that reads `percentScale` off a result column **through the declared type**.

  The rest of the envelope stays locally declared, deliberately. It is the REST
  envelope, not an `AnalyticsResult`: the route adds ADR-0021 D2 drill metadata
  (`object` / `dimensionFields` / `drillRawRows`) on top of the spec result, and
  this method rebuilds its own object from the payload without copying `sql` — so
  declaring the envelope as `AnalyticsResult & { … }` would advertise a key the
  adapter structurally cannot return. A pin records that too.

- 5f08c05: data-objectstack: type `queryDataset(selection)` as the spec's `DatasetSelection` instead of a hand-written copy

  The adapter restated the selection contract inline, field by field, and the copy
  had drifted three ways from the pinned `@objectstack/spec@17.0.0-rc.5`:

  - **`compareTo.dimension` was required.** It has been optional since
    objectstack#5011, _because the executor resolves it_: exactly one time
    dimension carrying a `dateRange` is the one shifted, and zero or several
    raises a loud error naming the candidates. Requiring it made the compiler
    demand from every typed caller precisely the consumer-side dimension guess
    that change forbids — trading a loud executor error for a silently wrong
    comparison window. No runtime path hit this yet (the dashboard's
    `DatasetWidget` passes `selection` as `unknown`), but a declaration is a live
    instruction to anyone calling this client from TypeScript.
  - **`timeDimensions` was widened to `unknown[]`**, erasing the very entry shape
    the executor's resolution reads (`{ dimension, granularity?, dateRange? }`),
    and **`runtimeFilter` to `Record<string, unknown>`**, erasing the
    `$and`/`$or`/`$not` vocabulary the server parses.
  - **`dateGranularity` was missing entirely** — the copy had simply stopped at
    whatever the contract looked like the day it was written, so a typed caller
    could not bucket a trend by month at all.

  The parameter is now the spec type by reference, so there is nothing left to
  re-sync. The fix is the removal of the dialect rather than a correction to it:
  restating a contract owned elsewhere creates a second de-facto dialect of it, and
  drift is then only a matter of time (AGENTS.md #0/#0.1). `queryDataset.test.ts`
  pins structural identity with `DatasetSelection` plus each of the three drifts
  individually, checked by this package's `tsc --noEmit`; a runtime test pins that
  a dimension-less `compareTo` reaches the server untouched, so the adapter can
  never start guessing on the executor's behalf.

  The response type is deliberately left alone — it is the REST envelope
  (`object` / `dimensionFields` / `drillRawRows`), not a restatement of
  `AnalyticsResult`.

- 41d6022: The console no longer reads `/meta/*` before it knows whether it has a session, and a failed request now says which request failed

  Opening a logged-out console painted ~30 red `HTTP request failed` lines before
  the login form was drawn. Two independent causes, fixed independently
  (objectui#4042).

  **1. Requests fired before the session was known.** `ConnectedShellInner` now
  withholds the metadata tree until `GET /auth/get-session` resolves, so
  `meta/object` / `meta/view` / `meta/app` are never issued blind. `useAuth()`
  outside an `AuthProvider` reports `isLoading: false`, so an embed with no auth
  provider is unaffected, and every protected route already sat behind an
  `AuthGuard` that resolves auth first — the signed-in data flow is unchanged.

  The console's landing route (`<Route path="/">`) was the actual entry point for
  the burst: it mounted `ConnectedShell` with no guard above it, so simply opening
  `/_console/` mounted the whole data layer as an anonymous visitor. It is now
  guarded, which also means an unauthenticated visitor reaches `/login` without a
  single doomed request. `examples/console-starter` had the same shape and got the
  same fix.

  **2. Two requests per type, per mount — not an unauthenticated artefact.**
  Consumers read metadata during the FIRST render (`useActionModal` reads
  `objects`, whose getter kicks `ensureType('object')` and `ensureType('view')`
  from the render phase), before any effect runs. `MetadataProvider`'s preview-mode
  effect then cleared the whole cache on mount, discarding those two entries while
  their requests were in flight; the next render found them `idle` and refetched
  both. The effect now skips its mount run — on mount the cache is empty and there
  was never anything to drop; it only ever meant something on a later
  `previewDrafts` change. That halved `meta/object` and `meta/view` on **every**
  mount, signed in included.

  A second duplicate only appeared once a read had failed: `entry.promise`
  collapses callers that arrive while a request is in flight, but callers arriving
  just after a failure each started a fresh attempt. A failed type now stays
  un-retried for ~1s, which collapses one mount's burst of callers into a single
  attempt. This is deliberately not the 5-minute `ttlMs` — later callers still
  retry on their own, and `refresh()` / `invalidate()` retry immediately and
  unconditionally, so no explicit recovery path changes.

  **3. `HTTP request failed` now identifies the request.** `@objectstack/client`
  reports every non-2xx as
  `logger.error("HTTP request failed", undefined, { method, url, status, error })`,
  and the console's logger forwarded that verbatim — so the identifying fields
  lived only in the third argument, and anything that flattens a console record to
  text rendered them `[object Object]` / `Object`. A screenful of failures could
  not tell you a single URL or status. The message string now carries them:

  ```text
  HTTP request failed: GET /api/v1/meta/object -> 401 [UNAUTHORIZED]
  ```

  The structured bag is still passed alongside for DevTools to expand — text for
  the flatteners, object for the inspectors, neither at the other's expense. The
  formatter is exported as `formatHttpFailureMessage`, and `createQuietHttpLogger`
  is now exported too so an app wiring its own `ObjectStackClient` gets the same
  identified failures.

  Nothing is newly silenced. The only demotion remains 404-on-an-optional-
  collection (`sys_presence`, `sys_activity`), which is an expected outcome of a
  request we still mean to make; a 401 that survives the session gate — a
  mid-session expiry, say — stays a visible, fully-identified error. The cure for
  doomed requests is not issuing them, never hiding them once issued.

- 7e2b7e9: Fix saved list-view preferences never reading back (density, column widths, sort, hidden columns, inline edit)

  `listViewOverrides` in the ObjectStack adapter enumerated `GET /api/v1/meta/{objectName}` — putting the object name in the metadata **type** slot — while `updateViewConfig` persists under `type='view'`. The two key spaces are disjoint, so the batch map came back empty for every object and every personalization a user saved on a list view was written to the server but never read back, showing up as "the setting didn't save".

  The read now enumerates `type='view'` once and narrows to the object client-side, through the same accessor `listViews()` uses over the same rows — the metadata index is name-only, so there is no server-side `?object=` filter to push it into.

  Second half: the batch read no longer swallows its own failures into an empty map. An empty map is an authoritative "this object has no overrides" and callers may still trust it and skip the per-view reads (the batch optimization is intact), but a transport failure now rejects, so the per-view `getView` fallback it was silently disabling becomes reachable again. `DataSource.listViewOverrides` documents both terms so other adapters implement the same contract.

- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [d229dfa]
- Updated dependencies [4bc6c23]
- Updated dependencies [c3b01a7]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [c2fd122]
- Updated dependencies [48132f7]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [e6fdbdc]
- Updated dependencies [6bb454a]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [c1e1e6b]
  - @object-ui/core@17.4.0
  - @object-ui/types@17.4.0

## 17.3.0

### Minor Changes

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

- Updated dependencies [18cd432]
- Updated dependencies [d915c47]
- Updated dependencies [5781fb1]
- Updated dependencies [9e9e9a9]
- Updated dependencies [23018cc]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [509104a]
- Updated dependencies [a4cff5b]
- Updated dependencies [f833d3a]
- Updated dependencies [2a9513d]
- Updated dependencies [d22ae31]
  - @object-ui/core@17.3.0
  - @object-ui/types@17.3.0

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

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [bca45cc]
- Updated dependencies [4bf612c]
- Updated dependencies [335041c]
- Updated dependencies [b414983]
- Updated dependencies [256f8cc]
- Updated dependencies [d9668a7]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [d3584c6]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [850033c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/core@17.2.0

## 17.1.0

### Minor Changes

- 9b773f9: fix(analytics): a missing analytics capability no longer renders as an empty KPI — objectstack#3891

  The framework retired its degraded in-kernel analytics fallback (objectstack#3891):
  it dropped the caller's RLS/tenant scope and ignored the contract filter, so it
  answered `200` with over-broad numbers. `@objectstack/service-analytics` is now
  the only implementation, and a deployment without it answers `404` on
  `/analytics/query` (objectstack#4019 stops mounting the routes) or `501` on
  `/analytics/dataset/query`.

  Three things were wrong on this side of that boundary:

  **① A KPI on such a deployment rendered a confident zero.** `aggregate()`'s
  `catch` promises a client-side fallback, and the fallback is correct — but the
  adapter never got there for the most likely failure. It now classifies the
  failure (`classifyAnalyticsFailure`) instead of treating every error alike:
  capability-absent (404/501) degrades to a client-side aggregate over a
  **server-scoped** `find()` — same rows, same filter, RLS still applied — and
  says so **once per adapter** in the console, naming the package to install,
  rather than once per widget or not at all.

  **② A rejected query was answered with plausible numbers.** The framework
  validates `/analytics/query` at the entry now (objectstack#4010), so a `400
VALIDATION_FAILED` means _this adapter_ sent an off-contract body. Degrading
  there would bury our own bug behind output from a different code path — the
  misdirection objectstack#3878 documented. It now throws
  `AnalyticsQueryRejectedError` and never falls back. Transient failures (5xx,
  network) degrade exactly as before.

  **③ The dataset preview blamed the author for a missing capability.**
  `queryDataset` mapped `501`/`404` to `Dataset query failed: 501 Not Implemented
— …`; it now throws the typed `AnalyticsNotInstalledError`
  (`code: 'ANALYTICS_NOT_INSTALLED'`) with a message a UI can render verbatim, and
  `DatasetPreview` shows it as a "analytics capability not installed" empty state
  instead of a red error banner. A real compile error (e.g. "relationship not
  declared in include") keeps its server detail and its banner.

  New exports from `@object-ui/data-objectstack`: `AnalyticsNotInstalledError`,
  `AnalyticsQueryRejectedError`, `isAnalyticsNotInstalledError`,
  `classifyAnalyticsFailure`.

- 1cf0de7: fix(detail): finish the approval-lock story, and warn on silently stripped fields (framework#3794)

  The Console reported record writability wrong in both directions during an
  approval, so a user had nothing to go on: what they _could_ edit said "locked",
  and what they _couldn't_ said "updated successfully".

  **The lock band told the truth; the Edit button did not.** objectui#2902 split
  the band into "in approval · editable" vs locked, but the header **Edit** CTA
  still keyed off nothing at all — on a genuinely locked record it stayed live, so
  the user opened the form, filled a screen, and got `RECORD_LOCKED` back on Save.
  It is now `disabled` on a locked record: visible-but-off, with the band beside it
  saying why. This is the LOCK, not the mere presence of an approval — a
  `lockRecord: false` node keeps Edit live, which is the point of that setting.

  **And the band could still re-lock itself.** `DetailView` OR-ed the record's own
  `approval_status` mirror into `isLocked` unconditionally. That mirror is written
  on submit by any flow configuring an `approvalStatusField`, _regardless of_
  `lockRecord` — so on a `lockRecord: false` node the host correctly resolved "not
  locked" from the request's `lock_record` while the mirror dragged the band back
  to "Locked for approval", with the pencils live and saves landing underneath it.
  The host is now authoritative whenever it threads `approvalPending`; the mirror
  is consulted only for bare/legacy `DetailView` hosts that thread nothing, where
  it still reads as locked (no node granularity — the safe direction).

  Recall's tooltip no longer promises to unlock a record the node never locked
  (`detail.cancelApprovalTooltipUnlocked`).

  **Silently stripped fields now surface on the record form's save path.** The
  adapter emitted a write-warning for `create`/`update` responses carrying
  `droppedFields`, but not for `batchTransaction` — which is how the record form
  saves a master-detail record, i.e. the one surface where a user actually edits a
  `readonlyWhen`-locked field. `batchTransaction` now emits one warning per event,
  resolving each back to its operation via the response's `index`.

  The toast itself was hardcoded English and called every strip "read-only". It is
  now localized (`detail.writeStripped*`, ten locales) and worded by reason:
  `readonly_when` says the field is not editable _in this record's current state_,
  which is what actually happened — the field is editable in other states and the
  form rendered it as an ordinary input, so "read-only" sent the user hunting for a
  permission problem that does not exist.

  **And it stopped crying wolf.** `createObjectStackUserStateAdapter` hand-stamped
  the server-managed `updated_at` on every recents/favorites write, which the
  server strips and reports — so the console popped "Some fields were not saved"
  about a field no user ever touched, on page loads, drowning the signal the toast
  exists for. It no longer sends the column; the server stamps it anyway.

- 0ded602: fix(form): a server rejection that names fields now marks those fields (objectstack#3896)

  The server has always said which field it rejected. `@objectstack/objectql`'s
  validators throw `VALIDATION_FAILED` with `fields[]` — one entry per offending
  field, each with a human `message` — and both the REST layer and the runtime
  dispatcher serve that as a 400 with the entries intact.

  Every form dropped them. The submit handler caught the rejection, ran the
  message through `extractWriteErrorMessage`, and showed **one undirected toast**:
  the user was told something was wrong but not _what_, on a surface that already
  knows how to mark an input — and already does exactly that for client-side
  validation. On a long form the offending field was often off-screen, so "创建"
  appeared to do nothing.

  **Now the two failures behave identically, because they share one
  implementation.** The per-field marking, the toast naming the fields, and the
  scroll-and-focus of the first offender (#2793) were extracted from the
  client-side invalid handler; the server path calls the same function. As far as
  the person filling in the form is concerned these are the same event — only the
  referee differs.

  Three layers, each of which was dropping the detail:

  - **`@object-ui/react`** — new `extractFieldErrors(err)` (exported alongside
    `extractWriteErrorMessage` / `isPermissionError`) normalises the three shapes
    the error can arrive in: a typed `ValidationError` from the ObjectStack
    adapter, the raw `@objectstack/client` error (whose `details` falls back to the
    whole response body, which is where `fields[]` lands), and a hand-rolled error
    carrying `fields` directly — the server duck-types that shape identically, so
    the client must not be pickier than the server. Entries with no usable `field`
    are **dropped rather than guessed at**: marking an innocent input is worse than
    the generic toast.
  - **`@object-ui/data-objectstack`** — `normaliseClientError` now maps a 400
    `VALIDATION_FAILED` onto the `ValidationError` class that has sat in
    `errors.ts` since the package was written, exported and **never once
    constructed**. Its `validationErrors: Array<{ field, message }>` shape was
    already exactly right. `create` also now normalises at all: only `update` did,
    so a rejected insert reached callers as the raw client error — and a create is
    the path that most often trips required-field validation.
  - **`@object-ui/components`** — the form renderer maps the entries onto
    `form.setError` and takes over the failure, **but only when every rejected
    field has a visible input to carry it**. If the server also rejected something
    the form does not render, it falls through to the banner, whose top-level
    message concatenates every field's reason — so the part the user cannot see
    inline is still said out loud instead of silently dropped.

  This also removes the need for the client-side predicate mirroring added in
  #2962: a form no longer has to guess what the server will reject in order to
  warn about it beforehand, and mirrored predicates drift.

  Non-field failures (403 / permission denials / anything without `fields[]`) take
  exactly the path they took before.

### Patch Changes

- 4952edf: fix(errors): error-code branches survive the framework's ADR-0112 rename — objectstack#3841

  Framework ADR-0112 renamed the whole `error.code` vocabulary from lowercase
  `snake_case` to `SCREAMING_SNAKE` (`destructive_change` → `DESTRUCTIVE_CHANGE`).
  Eleven places compared `err.code` against the old spelling with `===`, so against
  a swept server they simply stopped matching — and nothing threw. The affordance
  each branch guards just vanished and the user got the generic error toast instead:

  - the destructive-change confirm dialog (resource editor, permission matrix)
  - the "create a writable package first" hint
  - field-scoped validation issues on embedded item saves
  - the all-or-nothing publish summary naming the causal item
  - unknown-object tolerance in the app header and in record search
  - the marketplace's local-install messages for conflict / auth / unavailable
  - `isNotFoundError` in the data layer

  `RECORD_NOT_FOUND` had already been renamed a release earlier, so that branch was
  already dead before this fix.

  New `errorCodeIs` / `errorCodeIsAnyOf` in `@object-ui/types` compare
  case-insensitively, so the console keeps working against servers on either side
  of the rename — the console ships separately from the server it talks to. Every
  call site now passes the catalog (SCREAMING) spelling, and `error-code.ts` is the
  single file to delete once no supported server emits the old vocabulary.

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

- 7d35010: fix(data-objectstack): a view's own filter no longer disappears when the user adds one

  `ObjectStackAdapter` translated object-form filter entries
  (`[{ field, operator, value }, ...]`) only at the **top level** of a `$filter`.
  The moment a list has both a stored view filter and a user filter, it builds

  ```js
  [
    "and",
    [{ field: "stage", operator: "eq", value: "won" }],
    [["amount", ">", 1]],
  ];
  ```

  whose head is the string `and`, so the old check called the whole thing
  "already AST" and shipped the rules untranslated. Both server answers to that
  are wrong:

  ```js
  isFilterAST(above); // false — a bare rule object is not an AST child
  parseFilterAST(above); // { amount: { $gt: 1 } }   ← `stage = won` is GONE
  ```

  Since objectstack#4121 the `isFilterAST` gate turns it into a **400 and the
  list fails to load**. Before it — or anywhere `parseFilterAST` is reached
  without that gate — **the view's own condition is dropped without a word** and
  the list returns records the view exists to exclude.

  Translation is now recursive through `and`/`or` nodes and legacy flat child
  arrays, so the shape reaches the server as a valid AST
  (`{$and: [{stage: 'won'}, {amount: {$gt: 1}}]}`).

  Three related fixes in the same code:

  - **An untranslatable entry is now an error, not an omission.** Entries that
    failed to translate were dropped, and dropping one conjunct of an `and`
    returns a _superset_ of the rows asked for — dropping the last one sent no
    `filter=` at all, so the whole table came back. `find()` now throws
    `MalformedFilterError`, carrying `code: 'INVALID_FILTER'` / `httpStatus: 400`
    so a failed list renders "the filter is malformed" rather than "check your
    connection". A rule with a blank `field` passes `ViewFilterRuleSchema`
    (`z.string()` admits `''`), so this is reachable from real stored metadata.
    A _mixed_ array (`[{ field, operator, value }, ['amount', '>', 1]]`) now
    keeps both halves instead of dropping the tuple — that case was a lost
    condition, not a malformed one.
  - **The two `find()` routes can no longer disagree.** The "is this object
    form?" test existed twice — once in `translateFilterToAST`, once inline in
    `convertQueryParams` — and the copies had already drifted: the inline one
    omitted a `!== null` guard, so a `$filter` of `[null]` threw a `TypeError` on
    the plain route while the same value was handled on the `$expand` route. One
    definition now serves both.
  - **Dropped an unreachable `entry.name` fallback.** `objectFilterEntryToAST`
    read `entry.field ?? entry.name` while the shape check keyed on `field`
    alone, so the `name` half was dead from the commit that introduced it. The
    spec agrees it is not a real shape — `ViewFilterRuleSchema.field` is
    required, so such a rule cannot be saved as view metadata.

  Refs objectstack#3948, objectstack#4121, #2945

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

- a17ef09: fix(data-objectstack): a string `$orderby` reaches the server as a sort instead of a list of character indices — #3106

  `QueryParams['$orderby']` declares four shapes — `string`, `string[]`,
  `SortNode[]`, `Record<field, direction>`. Both of this adapter's `find()` routes
  (`convertQueryParams` for a plain read, `rawFindWithPopulate` for one carrying
  `$expand`/`$search`) carried their own copy of the fold that serializes it, and
  both copies handled the same three. The bare string fell through to the
  `Record` branch, where `Object.entries('name asc')` enumerates the string's
  character indices — so the request went out as `sort=0,1,2,3,4,5,6,7`.

  Since `objectstack#4226` the server refuses a sort it cannot read
  (`400 INVALID_SORT`) rather than dropping it silently, so this was not a
  degraded ordering but a list that failed to load outright — and `"${field}
${order}"` is exactly the shape `ObjectGrid` builds from its view metadata's
  `sort`, making every standalone grid with a configured sort a broken one.

  Both routes now share one exported `serializeOrderBy`, for the same reason the
  filter path already shares one: two copies of a fold can only agree by
  inspection, and these two did not.

- Updated dependencies [62311b6]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [95b7214]
- Updated dependencies [7d9734d]
- Updated dependencies [6ae818e]
- Updated dependencies [746dd00]
- Updated dependencies [aebfa4f]
- Updated dependencies [38ca8be]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [c4d7b20]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [02aef0c]
- Updated dependencies [6f29aa5]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [4874117]
- Updated dependencies [ad0183a]
- Updated dependencies [ce08d55]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
- Updated dependencies [2d5d594]
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
  - @object-ui/core@17.1.0
  - @object-ui/types@17.1.0

## 17.0.0

### Minor Changes

- d62fb1f: feat(app-shell): toast when a save silently dropped read-only fields (framework #3431/#3455)

  The framework now reports fields it LEGALLY stripped from a write (a non-system
  caller can't seed a `readonly` field, a `readonlyWhen` predicate locked it, …)
  via a `droppedFields` payload on the create/update response. Previously the
  console discarded it: a value the user typed into a locked field just vanished on
  save with a success toast and no explanation.

  - **data-objectstack:** `ObjectStackAdapter` now emits a `WriteWarningEvent`
    after a create/update whose response carried `droppedFields`, exposed through a
    new `onWriteWarning(cb)` subscription (mirrors the existing `onMutation` bus).
    Reads the field structurally, so an older client or a backend that never drops
    is a no-op. New exported types: `WriteWarningEvent`, `WriteWarningListener`,
    `DroppedFieldsEvent`.
  - **app-shell:** `AdapterProvider` subscribes and raises a `toast.warning`
    ("Some fields were not saved — the read-only field … could not be changed"),
    so the strip is visible instead of silent. The write itself still succeeded;
    status/behaviour are unchanged.

### Patch Changes

- 8ecf5a6: Command palette (⌘K) now surfaces record search hits from the platform's global
  search endpoint (`GET /api/v1/search`).

  Previously the palette only ran a per-object `find({ $search })` fanout (the
  metadata-driven ADR-0061 search), which misses records that only the global
  search index knows about — so typing a well-known record name returned no
  records even though `/api/v1/search` served them. `ObjectStackAdapter` now
  exposes a `searchAll(query, { limit, objects })` method that calls the unified
  endpoint, `useRecordSearch` prefers it when present (falling back to the fanout
  otherwise), and the palette renders the resulting record hits grouped by object.

- 6e8fd3c: fix(charts): a fieldless `count` aggregate keyed its value column `undefined`, so the chart plotted nothing (framework#3701)

  framework#3701 pinned down what an OBJECT-bound chart aggregate names its result
  columns — the raw field names it was given (`groupBy` for the category, `field`
  for the value; no `sum_`-style decoration, unlike a dataset measure), plus the
  literal `count` when a `count` omits `field`, which is the alias the engine
  projects `COUNT(*)` under. `os validate` now lints page sources against that
  convention, so the paths that build these rows have to honour it exactly.

  Three of the four did. The odd one out was `count` — the one function that may
  legitimately omit `field` — because every row builder read `params.field`
  directly:

  - `aggregateRecords` / `ObjectDataSource.aggregateClientSide` emitted
    `{ [groupBy]: key, [undefined]: value }`, i.e. a column literally named
    `undefined` that no axis binding could ever name;
  - the legacy analytics path was worse: it remapped the server's `count` measure
    onto `params.field` and **deleted** the original key, so the value the server
    did return was thrown away before the chart saw it.

  All of them now resolve the column through one helper (`aggregateValueKey`) so a
  fieldless count lands under `count`, matching the framework contract. The
  comparison-overlay column is derived from the same key (`count__comparison`
  instead of `undefined__comparison`), and `aggregate.field` is typed optional to
  match the spec's `ChartAggregateSchema`. Charts that name a field are unchanged.

- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [7b35e4b]
- Updated dependencies [e16ed2d]
- Updated dependencies [f9bbddb]
- Updated dependencies [dfd3705]
- Updated dependencies [2735de6]
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
  - @object-ui/core@17.0.0

## 16.1.0

### Minor Changes

- 8c1e415: feat(data-objectstack): gate the non-atomic batch fallback on the discovery `transactionalBatch` capability (#2693)

  `ObjectStackAdapter.batchTransaction` now negotiates atomic cross-object batch
  **declaratively** instead of only probing at runtime. At `connect()` the adapter
  reads `capabilities.transactionalBatch` from `GET /api/v1/discovery`
  (framework #3298 — `declared === enforced`; the server advertises `true` only
  when the `/batch` route is mounted _and_ the runtime engine can honour a
  transaction):

  - **Declared `true`** — the adapter TRUSTS server atomicity: it calls `/batch`
    and surfaces any failure (including `404`/`405`/`501`) as a real error. No
    runtime probe, no non-atomic client-side compensation.
  - **Declared `false`, or absent** (backend predates #3298) — the legacy path is
    unchanged: probe `/batch` and, on `404`/`405`/`501`, fall back to the
    non-atomic `emulateBatchTransaction`. Keeping this avoids regressing older
    backends from "saves, less safe" to "no save path" (#2679 compat constraint).

  Both the hierarchical wire shape (`{ transactionalBatch: { enabled: true } }`)
  and the flat form the client SDK normalizes to (`{ transactionalBatch: true }`)
  are accepted. `@object-ui/core`'s generic `emulateBatchTransaction` /
  `runBatchTransaction` are untouched and remain the fallback for adapters with no
  server-side transaction (`ValueDataSource`, `MockDataSource`, …).

  Docs: the adapter README and the data-source guide now document the capability
  table and the minimum-backend note — atomic cross-object saves are guaranteed
  only against backends advertising the capability (framework #3298 / #1604).

  Picks up #2679 acceptance item 4; unblocked by framework#3298 (merged).

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

- 0ea5036: refactor(data-objectstack): route `batchTransaction` through the client SDK only, drop the raw-fetch branch

  `@objectstack/client@^16` (framework #3271, the current ObjectUI dependency
  floor) ships `data.batchTransaction`, so `ObjectStackAdapter.batchTransaction`
  now calls the typed SDK method directly. The transitional hand-rolled
  `fetch('/api/v1/batch')` branch — a feature-detect shim kept while the SDK
  method was unreleased — is removed (#2694). Per AGENTS.md §7, adapter data
  always flows through `@objectstack/client`, never a raw `fetch`.

  No behavior change: the SDK still drives the server's atomic `POST /api/v1/batch`,
  one `MutationEvent` is emitted per committed op (no double-fire), and the adapter
  still degrades to the non-atomic `emulateBatchTransaction` when this backend lacks
  the endpoint (404/405) or its runtime can't do transactions (501). Every other
  status still surfaces to the caller.

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

- 29c6040: fix(app-shell): redo the record-list "Add View" create flow — empty-name 405, invisible drafts, canonical naming

  Rebuilds the record-list "Add View" / "Save as view" create path so a
  runtime-created view has one canonical identity and is actually verifiable
  before publish (supersedes #2754; fixes #2767).

  - **Unified identity (P1).** New `viewEnvelope(objectName, spec, { name, label })`
    seam in `runtime-metadata-persistence.ts` emits the canonical ViewItem
    (`{ name: '<object>.<key>', object, viewKind: 'list', label, config }` with
    `config.data = { provider: 'object', object }`), mirroring the Studio
    `anchors.ts:createBuildBody`. The **qualified** name is passed as BOTH the
    `PUT /meta/view/:name` URL segment and `body.name`, so the `sys_metadata`
    row key, the ViewTabBar tab id, and the body identity all agree and the
    draft → read → publish loop resolves. `ObjectView` and `ObjectDataPage` both
    call the single helper — the duplicated envelope block is gone (P6).
  - **Empty-name guards (405).** `MetadataClient.save()` and
    `createRuntimeMetadata()` throw a clear contextual error instead of emitting
    `PUT /meta/view/` (empty `:name`, server 405).
  - **Draft visibility (P2/P3/P4).** `DataSource.listViews(objectName, { previewDrafts })`:
    in draft-preview mode the `ObjectStackAdapter` makes a **single**
    `MetadataClient.withPreviewDrafts(true).list('view')` request and uses the
    server's already-overlaid list (draft wins by name, `_draft` tagged) —
    replacing, not appending, so a draft that edits a published view can't
    double-tab. No hand-rolled `fetch` of metadata routes at the adapter layer.
    After a create in normal mode the console navigates to the new view with
    `?preview=draft`, so the DraftPreviewBar is visible and Publish is one click.
  - **CJK-aware naming (P5).** `CreateViewDialog` gains an editable machine-name
    field, prefilled via `slugify(label)` for Latin labels and required (submit
    disabled) when slugify yields empty for non-Latin labels — no more silent
    random `task_grid_mrsyt56j` names. New `console.objectView.viewName*` keys
    (en/zh).

- Updated dependencies [1c8935a]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [2e7d7f0]
- Updated dependencies [94d4876]
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

## 16.0.0

### Patch Changes

- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
  - @object-ui/types@16.0.0
  - @object-ui/core@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0

## 14.1.0

### Patch Changes

- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f0f10f5]
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0

## 14.0.0

### Minor Changes

- 6a74160: Sharing-rule form: pick, don't type. Three new widget-hint field components make
  the generic object form render pickers where an admin previously had to type
  machine data (driven by the framework `widget` hints on `sys_sharing_rule`;
  generalizes the `capability-multiselect` pattern). All degrade to the underlying
  `type` renderer when a widget is unregistered.

  - **`object-ref`** — choose a registered object by name (searchable `Combobox`),
    backed by the new `DataSource.getObjects()` (`ObjectStackAdapter` lists code-
    and DB-defined objects via `/api/v1/meta/object`), falling back to a
    `sys_metadata` query. Stores the object's `name`.
  - **`filter-condition`** — a visual criteria builder (`FilterBuilder`) scoped to
    the fields of the object chosen in a sibling field (via `getObjectSchema`),
    round-tripping the stored **MongoDB-style** FilterCondition JSON. Criteria the
    builder can't represent (or invalid JSON) fall back to a raw-JSON editor, with
    an always-available "Edit as JSON" toggle — nothing is hidden or lost.
  - **`recipient-picker`** — a record picker whose target object follows a sibling
    `recipient_type` (`user`→sys_user, `team`→sys_team, `business_unit`/
    `unit_and_subordinates`→sys_business_unit, `position`→sys_position), storing the
    value the evaluator matches on (a record id, or the position **name**). Resets
    the stored id when the type changes.

  Wiring: the three keys join `DATA_SOURCE_FIELD_TYPES` (form.tsx) so the form
  threads `dataSource` + `dependentValues` to them, and `INLINE_EXCLUDED_FIELD_TYPES`
  (they're authored in the record form, not a grid cell). `DataSource.getObjects()`
  is optional on the interface; the ObjectStack adapter implements it.

### Patch Changes

- Updated dependencies [443360a]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/types@14.0.0

## 13.2.0

### Patch Changes

- e492b9d: Permission sets — pure separation of **design** (Studio) and **assignment**
  (Setup), per ADR-0056 / epic #2398. A `sys_permission_set` used to render its six
  authorization facets in Setup as raw `[Object]` / JSON textareas, and only
  objects+fields were editable in Studio; this reworks both surfaces.

  **Setup (assign + read-only):**

  - The six facets (`object_permissions`, `field_permissions`, `system_permissions`,
    `row_level_security`, `tab_permissions`, `admin_scope`) now render read-only on
    the `sys_permission_set` record page as a compact summary (counts, or capability
    chips) plus a **“Design in Studio →”** deep-link into the structured editor
    (`/apps/:appName/metadata/permission/:setName`, env scope). No `[Object]`, no
    JSON — in the record view, inline edit, and the create/edit form. Implemented as
    a `permission-facet-link` field widget stamped onto the six fields via the single
    `ObjectStackAdapter.getObjectSchema` choke point and honored by DetailSection +
    the record form.
  - User assignment (add/remove via `sys_user_permission_set`) is surfaced directly
    on the Setup record page.

  **Studio (design every facet):** the permission matrix editor gains structured
  editors for the facets that were JSON-only —

  - **System Capabilities**: a multi-select over the live `sys_capability` registry
    (scope-grouped, labelled chips).
  - **Row-Level Security**: per-policy rows (object · operation · enabled) with CEL
    USING/CHECK.
  - **Tab Visibility**: per-tab `visible | hidden | default_on | default_off`.
  - **Delegated Admin Scope**: business-unit + subtree, manage-assignments /
    -bindings / author-env-sets toggles, and an assignable-permission-sets allowlist.
    Assignment was moved out of the editor (it is now a Setup act) — the editor is
    purely a design surface.

  Storage/types are unchanged; editors read/write the draft’s existing parsed
  fields and tolerate legacy JSON strings on load. Note: env-scope metadata saves of
  these facets do not yet project onto the queryable `sys_permission_set` data
  record the Setup summary reads, so a fresh Studio edit isn’t reflected in Setup’s
  read-only view until the projection refreshes — tracked as a framework follow-up
  (enforcement reads the authoritative metadata).

  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [619097e]
  - @object-ui/types@13.0.0
  - @object-ui/core@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [c31874d]
  - @object-ui/types@12.1.0
  - @object-ui/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0

## 11.5.0

### Minor Changes

- 1072701: Import wizard: use registered server-side import mappings (framework #2611). When an object has `mapping` metadata artifacts targeting it, the wizard shows a "Saved mapping" selector; picking one hands rename + transforms + write semantics to the server (the artifact is authoritative), replaces the manual column table with a read-only summary of the mapping, and submits `mappingName` over source-header rows (mutually exclusive with the inline column rename). `ImportRequestOptions` gains `mappingName`; the objectstack adapter gains `listImportMappings(objectName)` (feature-detected — the selector simply doesn't appear when unsupported). New `grid.import.*` strings added across all locales.

### Patch Changes

- Updated dependencies [9255686]
- Updated dependencies [1072701]
  - @object-ui/types@11.5.0
  - @object-ui/core@11.5.0

## 11.4.0

### Patch Changes

- c0164ad: fix(studio): surface spec-validation failures on the field at save/publish

  When a Studio metadata draft failed spec validation, the designer got a single
  opaque banner (and, on a partial publish, a false "published!" toast) — the
  server was already returning field-anchored issues, but the client threw them
  away. Two problems, both fixed:

  - **`parseError` (data-objectstack)** read `String(body.error)`, which yields
    `"[object Object]"` for the dispatcher's object-shaped error, and ignored the
    validation `issues`. It now reads the message from either shape (string or
    `{ message }`) and exposes `MetadataError.issues`, accepting all live server
    shapes — top-level `body.issues` (REST server) and `error.details.issues`
    (HTTP dispatcher).

  - **Studio save/publish (app-shell)** now render those issues **field-anchored**.
    A new `formatMetadataError` helper turns a caught error into one line per
    offending field (`• fields.amount.type — Invalid option: …`); the save banners
    render it with `whitespace-pre-line`. `doPublish` no longer claims success when
    the response carries `data.failed[]` — it lists which drafts failed and why
    (the server returns 200 with the failures buried, so the UI used to swallow
    them). `formatPublishFailures` formats those per-draft.

  Verified end-to-end against a live backend: an invalid object draft returns 422
  with field-anchored issues, and the Studio banner shows
  `• fields.amount.type — Invalid option: expected one of "text"|…` instead of a
  generic message. Unit-tested: `parseError` on the dispatcher shape, and the
  `formatMetadataError` / `formatPublishFailures` helpers.

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [c38d107]
  - @object-ui/types@11.4.0
  - @object-ui/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d23d6eb]
  - @object-ui/core@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/core@11.2.0
  - @object-ui/types@11.2.0

## 11.1.0

### Patch Changes

- @object-ui/types@11.1.0
- @object-ui/core@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0
- @object-ui/core@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0
  - @object-ui/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0

## 7.0.0

### Minor Changes

- 30ee761: feat(studio): surface pending drafts on the package detail (ADR-0033)

  After an AI builds an app, its objects/views land as drafts bound to the app package — but Studio's active-only browsers hid them, so the package looked empty and there was no obvious way to find what to review/publish.

  - `MetadataClient.listDrafts({ packageId?, type? })` calls the new `GET /api/v1/meta/_drafts` endpoint, returning pending draft headers (with `packageId`).
  - The package detail sheet (PackagesPage) now shows a **Pending changes** section listing each drafted item, each linking to the existing per-item review/diff (`?review=1`) so the user can publish it. A just-built app package is no longer shown as empty.

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

- 5332639: feat(app-shell): render full object forms (incl. master-detail) in screen-flow wizard steps

  `FlowRunner` now renders an `object-form` screen step: when the paused screen
  carries `kind: 'object-form'`, it mounts the real `<ObjectForm>` for the named
  object (auto-routing to `MasterDetailForm` for inline child collections),
  prefilled from the step's `defaults`. The form persists itself (atomic
  master-detail batch), then resumes the run with the saved record id bound to the
  step's `idVariable`. `dataSource`/`objects` are threaded through all three
  `FlowRunner` mount points.

  Also fixes three pre-existing bugs this surfaced (each affects normal forms too):

  - **plugin-form**: `ObjectForm` now forwards `initialValues`/`initialData` when
    routing to `MasterDetailForm`, so prefilled header values are no longer
    dropped on master-detail create forms.
  - **fields**: `PercentField` treated values as `0–1` fractions (`value × 100`),
    so a `0–100` field (e.g. `probability` default `50`) rendered as `5000%` —
    exceeding `max=100`, which makes HTML5 constraint validation mark the field
    `:invalid` and silently block the whole form's submit. It now treats a field
    declaring `max > 1` as the `0–100` whole-number convention, matching the
    read-side formatter.
  - **data-objectstack**: `ObjectStackAdapter.batchTransaction` now sends
    `credentials: 'include'`, so master-detail batch saves authenticate under the
    console's cookie session (previously every batch save 401'd).

- d16566f: Atomic master-detail create via the cross-object transactional batch endpoint (ObjectStack #1604).

  When the server exposes the transactional batch endpoint, a NEW parent record and its child line items are now persisted in ONE server transaction — commit all or roll back all — instead of the previous client-orchestrated "create parent → create children → best-effort cleanup on failure" sequence.

  **`@object-ui/data-objectstack` — `ObjectStackAdapter.batchTransaction(operations)`**

  - New method posting `{ operations }` to `POST /api/v1/batch`. Operations run in one server transaction. A field value of `{ $ref: <earlier op index> }` resolves to that op's generated id, so a child can reference its parent created earlier in the same batch (master-detail FK). Throws `ObjectStackError('BATCH_ERROR')` on a non-2xx response.

  **`@object-ui/plugin-form`**

  - `MasterDetailForm` now detects `dataSource.batchTransaction` and, on a NEW parent, builds one atomic batch (parent at index 0, each child FK set to `{ $ref: 0 }`) via the new pure helper `buildMasterDetailBatch`. Client-side total rollups are merged into the parent payload before the batch. Edit mode and adapters without `batchTransaction` keep the existing client-orchestrated path.
  - `ObjectForm` gained a `submitHandler` hook: when supplied, the form validates and hands the collected values to the host instead of calling `dataSource.create` / `dataSource.update`. `MasterDetailForm` uses it to own the atomic parent+children write while the parent fields are still rendered by `ObjectForm`.

  **`@object-ui/types`**

  - `ObjectFormSchema.submitHandler?: (values) => any | Promise<any>` — typed override for host-owned persistence.

  Pairs with the framework-side ambient-transaction fix (ObjectQL `AsyncLocalStorage` transaction propagation) and the `/api/v1/batch` endpoint added in `@objectstack/rest`.

### Patch Changes

- b99d9bd: ADR-0048: package-scope the Studio metadata editor read. Two installed packages
  may ship metadata with the same `type`/`name`; the editor now resolves the right
  one instead of first-match.

  - `MetadataClient`: `layered()` and `getDraft()` accept `{ packageId }`, and
    `get()` emits the `package` query param (→ server prefer-local, `?package=`).
  - `ResourceListPage`: each item's edit link carries its owning package
    (`?package=<row._packageId>`), so even the unscoped "all" list disambiguates;
    falls back to the workspace suffix for runtime/overlay-only rows.
  - `ResourceEditPage`: reads `?package=` and scopes the layered + draft read to
    that package. (The route's `:appName` is the Studio app, not the edited item's
    owner, so the scope must come from the URL, not the active app.)

- a58c6b8: fix(datasource): exclude form-family views from `listViews()`

  `OBJECTSTACKDataSource.listViews(objectName)` feeds the object list-view
  switcher (`ObjectView` → `ViewTabBar`), but returned **every** view bound to
  the object — including form-family ones. With the backend now exposing each
  view as an independent **ViewItem** carrying a `viewKind` discriminant
  (ADR-0017, "Object has-many View"), a form view such as `crm_activity.default`
  (expanded from `formViews.default`) leaked in as a spurious switcher tab and,
  when opened, fell back to the default grid.

  `listViews()` now filters out `viewKind` `form`/`detail` items so only
  list-family views reach the switcher. Bare view specs without a `viewKind`
  (legacy artifacts and user-saved views) are still treated as list views.

- Updated dependencies [5976ba3]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [053c948]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [3870c20]
- Updated dependencies [b88c560]
- Updated dependencies [d16566f]
- Updated dependencies [1394e34]
- Updated dependencies [300d755]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3

## 6.2.2

### Patch Changes

- @object-ui/types@6.2.2
- @object-ui/core@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1

## 6.2.0

### Minor Changes

- ec8dcde: Add visual editing for object & field metadata in the Setup app.

  **`@object-ui/data-objectstack`** — new `MetadataClient` class. A thin,
  auth-friendly wrapper over the framework's `/api/v1/meta/*` REST
  endpoints (list / get / save / reset / history), with first-class
  support for `If-Match` (optimistic concurrency), `X-Actor` (audit
  attribution), environment-scoped paths
  (`/environments/:id/meta/*`), and 404-as-null semantics. Use
  `new MetadataClient({ baseUrl })` or `client.withEnvironment(id)` to
  target a specific environment.

  **`@object-ui/plugin-designer`** — two new route-ready pages that
  together close the "Data Model" management loop in the Setup app:

  - `MetadataObjectsPage` — lists every object schema (via
    `MetadataClient.list('object')`), renders the existing
    `ObjectManager`, and persists edits/deletes through PUT/DELETE on
    the metadata REST surface. Honours `allowRuntimeCreate` and
    surfaces server errors verbatim.
  - `MetadataFieldsPage` — for a single object, loads the parent
    schema, projects `fields` into the existing `FieldDesigner`, and
    on save merges the edited field map back into the object before
    issuing a single PUT. Preserves unknown per-field attributes so
    nothing the designer doesn't render is dropped.

  Both pages take either a pre-built `MetadataClient` or a
  `MetadataClientConfig`; neither imposes a routing convention on the
  host app — they can be mounted anywhere (e.g.
  `/apps/setup/_meta/object` and `/apps/setup/_meta/object/:name/fields`).

  These additions do not modify the underlying `ObjectManager` /
  `FieldDesigner` components, which remain pure controlled-input
  components usable in non-REST contexts.

### Patch Changes

- fe3c1d3: Metadata Admin engine — unified UI for all 27 metadata types.

  A generic, schema-driven admin shell that replaces the old per-type
  bespoke pages with a single registry-driven engine. Admins can now browse,
  create, override, diff, and roll back every registered metadata type from
  the Setup app → _All Metadata Types_.

  ### New: `@object-ui/app-shell` views/metadata-admin

  - **`MetadataDirectoryPage`** — auto-grouped tile directory by domain, with
    free-text search, domain chips, and a _Writable only_ filter.
  - **`MetadataResourceListPage` / `MetadataResourceEditPage` / `…CreatePage` / `…HistoryPage`** —
    generic CRUD shell. Uses the new `/meta/types` schema field to render
    SchemaForm; uses `?layers=code,overlay,effective` to power a 3-state diff
    tab; uses `/references` to warn before destructive deletes.
  - **`MetadataQuickFind`** — Cmd+Shift+M palette searching across types and
    items.
  - **`PermissionMatrixEditor`** — Salesforce-style matrix custom editor for
    `type=permission`. Objects × CRUD/VAMA/lifecycle columns with cascade
    rules (viewAllRecords ⟹ allowRead, etc.), expandable per-object field
    R/W subtable, bulk-set (R / CRUD / All / None), filter, _only granted_
    toggle, destructive-change confirmation, profile switch.
  - **`DesignerEditorWrapper`** — generic load–edit–save shell that hosts any
    bespoke designer (`ObjectViewConfigurator`, `DashboardEditor`,
    `PageCanvasEditor`, …). Handles dirty tracking, Save / Reset / Refresh /
    History buttons, and the read-only fallback when `allowOrgOverride` is
    false.
  - **`i18n.ts`** — bilingual (`en-US`, `zh-CN`) bundle for built-in type
    labels, domain labels, and engine UI strings, with `detectLocale()` and a
    `t(key)` helper.

  ### New routing variant

  - App nav now supports `{ type: 'component', componentRef, params? }` items.
    `AppContent` resolves them through the existing `ComponentRegistry`.
  - Built-in components registered: `metadata:directory`, `metadata:resource`,
    `metadata:object/edit` (FieldsPage), `metadata:permission/edit`
    (PermissionMatrixEditor), and lazy designer wrappers for view / dashboard
    / page.

  ### Plugin-designer

  - Lazy-exported `ObjectManager`, `FieldDesigner`, `ObjectViewConfigurator`,
    `DashboardEditor`, `PageCanvasEditor`, `MetadataObjectsPage`, and
    `MetadataFieldsPage` so the engine can mount them on demand.

  The temporary `/dev/meta` route is removed. Setup app navigation flows
  through the new component routes.

  - @object-ui/types@6.2.0
  - @object-ui/core@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/core@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1

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

- 9997cae: DataSource: add optional `bulkUpdate(resource, ids, patch)` for "same patch, many rows" interactions (Slack "mark all as read", Linear "archive selected"). The ObjectStack adapter routes to `POST /api/v1/data/:object/updateMany` so the client pays one HTTP/auth/RLS round-trip instead of N parallel PATCHes, eliminating mark-all-read jank on inboxes with 50+ unread.

  AppHeader's `markAllRead` now prefers `bulkUpdate`, with a transparent fallback to the per-id loop for adapters that don't implement the helper.

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [70b5570]
- Updated dependencies [d1442e3]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0

## 5.1.1

### Patch Changes

- @object-ui/types@5.1.1
- @object-ui/core@5.1.1

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
  - @object-ui/core@5.1.0

## 5.0.2

### Patch Changes

- @object-ui/types@5.0.2
- @object-ui/core@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1

## 5.0.0

### Minor Changes

- c7561a7: **Unify per-user UI state storage onto `sys_user_preference`.**

  `createObjectStackUserStateAdapter` previously wrote to a bespoke
  `user_app_state` object using `(user_id, kind, payload)` columns. That
  parallel KV table duplicated the canonical per-user preference store
  shipped by `@objectstack/plugin-auth`, and pulled UI traces (favorites,
  recent items, grid widths) out of the place users actually look for
  their settings.

  The adapter now defaults to:

  - `resource`: `sys_user_preference`
  - field shape: `(user_id, key, value)` instead of `(user_id, kind, payload)`
  - option name: **`key`** instead of `kind`

  `ConsoleShell` is updated to attach favorites/recent under the namespaced
  keys `ui.favorites` and `ui.recent`. Recommended convention for new
  adapters: keep machine-written UI traces under `ui.*` so they stay
  distinguishable from user-facing preferences (`theme`, `locale`, ...).

  **Migration**: callers passing `kind:` need to switch to `key:`. Callers
  relying on the old `user_app_state` table can pin
  `resource: 'user_app_state'` to keep the legacy behaviour, but no
  backend ships that schema and the new default works against any
  plugin-auth-enabled environment with zero extra setup.

### Patch Changes

- Updated dependencies [7213027]
  - @object-ui/types@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0

## 4.6.0

### Patch Changes

- @object-ui/types@4.6.0
- @object-ui/core@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
  - @object-ui/types@4.5.0
  - @object-ui/core@4.5.0

## 4.4.0

### Patch Changes

- @object-ui/types@4.4.0
- @object-ui/core@4.4.0

## 4.3.1

### Patch Changes

- @object-ui/types@4.3.1
- @object-ui/core@4.3.1

## 4.3.0

### Patch Changes

- @object-ui/types@4.3.0
- @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/types@4.2.0
- @object-ui/core@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/types@4.0.11
- @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/types@4.0.8
- @object-ui/core@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
  - @object-ui/core@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- @object-ui/types@4.0.6
- @object-ui/core@4.0.6

## 4.0.5

### Patch Changes

- @object-ui/types@4.0.5
- @object-ui/core@4.0.5

## 4.0.4

### Patch Changes

- @object-ui/types@4.0.4
- @object-ui/core@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/core@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/core@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2

## 3.3.1

### Patch Changes

- @object-ui/types@3.3.1
- @object-ui/core@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/types@3.1.5
- @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/core@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2

## 3.0.1

### Patch Changes

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

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/types@0.3.1
  - @object-ui/core@0.3.1
