# @object-ui/plugin-detail

## 18.1.0

### Patch Changes

- f669732: The inline-edit save bar shows an object-level rule's refusal as the rule's own message, without a field label (objectui#13292).
  
  The server names an object-level rule (a `script` rule, or one that lists no fields) with the `_record` sentinel. The bar used to print that sentinel as a field label, so the banner read `_record: …`. Now an entry that names `_record`, or names no field of the record, is shown alone in the banner and is not published as a per-field hint. Field-level entries are unchanged: they keep their label and their hint beside the input.
- 49a536d: The record header's highlights write the year on every date (objectui#13331).
  
  A current-year date dropped its year in the strip, so a contract record read "Start Date Sep 15, 2025 | End Date Sep 15" and a contract that ended this September looked like it ended next month. The strip now asks for the year, and both dates read alike. Dates inside the ±7-day window keep their relative phrase ("In 2 days").
  
  `formatDate` takes a new opt-in option, `alwaysShowYear`, which keeps the year on its default face; the `date` and `datetime` cell renderers take an `alwaysShowYear` prop that hands it on. Neither is on by default: grid cells and cards still drop the current year.
- 404ccae: Setup's metadata deletes and the related list's row delete now ask in the console's in-app confirm dialog and name what goes (objectui#13333).
  
  - The metadata editor's Reset overlay / Delete and Discard draft, the history timeline's Rollback, the Datasources page's Delete and a metadata type's `confirmText` action no longer use the browser's native `confirm()`. Each opens an in-app AlertDialog whose title names the item: by its type label and its own label for Reset / Delete (for example `Delete Object "Account"?`), with the machine `type/name` in the body; by label and name for a datasource; by action and item for a type action.
  - The related list's row Delete no longer asks "Are you sure you want to delete this record?". The sentence names the row by its record title, the same resolver the record header uses, so a grant row reads by its declared title (the grant and the user it belongs to). The `detail.deleteRowConfirmation` string now takes a `{{name}}` value in all ten locales.
- b93c9f6: After a save, delete or action, the record page and the list ask the platform's explain engine each record's edit and delete question once (objectui#13341).
  
  One write often reaches the console's data-change bus twice: once when the data source reports it, and again from the page or list that made it. When the second notice arrived while the fresh permission check was still waiting for its answer, the check was thrown away and sent again, so one Setup save could send `POST /api/v1/security/explain` two to six times. Now a notice that arrives while a record's fresh check is on its way joins that check. A check that was already on its way before the write is still discarded and asked again, and a change announced after the check has answered still asks again, so Edit and Delete still follow the record's state after the write.
  
  The list also stops asking again about rows whose answer is already on its way when its own re-read changes the rows on screen, and asks only about the rows nobody has asked about yet. A list whose rows go past the server's batch limit now sends its batches at once instead of one after another.
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

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- 4c127cd: The `record:related_list` registration no longer declares `columns` required, so
  the page compile accepts a related list that lists no columns of its own
  (objectui#11613).
  
  `@objectstack/spec`'s `record:related_list` row leaves `columns` optional, and the
  renderer agrees: a `dataSource` binding that names a view lands that view's
  columns on the node, and with neither the list derives its columns from the
  related object (its `highlightFields`, otherwise its listable fields). The
  registration still declared `required: true`, and the page compile reads the
  registration, so a node with no `columns` was refused with
  `missing-required-prop` and the save failed.
  
  **Clause-②: yes (widening)** — a `record:related_list` node that sets no `columns`
  now compiles and saves, whether a `dataSource` binding names a view (the list
  draws the view's columns) or not (the list draws columns derived from the related
  object, as it already did when such a node reached it). Authored `columns` still
  win over both. `objectName` and `relationshipField` are still required, as the
  spec row requires them. The published `columns` input now carries a description
  that says where the columns come from when it is absent.
- 76993f8: A field group's `visibleWhen` now gates its section on the record detail page, the same way it gates the section on the entry form (objectui#11630). Take an object whose `fieldGroups` entry declares `visibleWhen: "record.kind == 'pro'"`. The edit form hid the "Pro details" section on a `basic` row, but the detail page drew it on every row, header included. The detail page now draws it only where the predicate holds.
  
  **How it works.** The detail body now writes each field group as `@objectstack/spec`'s own reference form, `{ group: KEY }` (`RecordDetailsProps.sections[].group`). `record:details` resolves the reference against the object's `fieldGroups`: the group's members, label, icon, description and collapse state, and its `visibleWhen`. The predicate is evaluated per record with the form's own evaluator (`resolveFieldRuleState` from `@object-ui/core`, under `usePredicateScope`), and both spellings work as they do on the form: a bare CEL string or a `{ dialect: 'cel', source }` envelope.
  
  - Values bind under `record.`, so a bare identifier is unbound.
  - A declared field the row does not carry compares as `null`.
  - A relation binds as its stored id, even when the page's record arrived expanded.
  - `previous` binds the persisted row, as on the record's edit form.
  - A predicate that cannot be evaluated SHOWS the section and warns once, which is what the form does.
  
  A FALSE verdict removes the whole section, heading and members. This is display only: the record API serves those fields either way.
  
  **Clause-②: yes (output shape change).** BREAKING for code that reads the synthesized sections of a grouped object. The bump is still `minor`: under this repo's release model, objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.
  
  - `buildDefaultPageSchema`, `buildDefaultTabs`, `buildDefaultDetails` and `resolveDetailSections` (`@object-ui/plugin-detail`) change the `record:details` `properties.sections[]` they emit for an object with `fieldGroups`:
    - Each declared group becomes `{ group: KEY, columns }`. It used to be an enumerated copy of the group: `name`, `label`, `icon`, `description`, `collapsible`, `defaultCollapsed`, `columns`, and `fields` as rich `{ name, label, type, … }` descriptors.
    - The trailing ungrouped section keeps `columns` and lists `fields` as bare names.
    - The node now parses as `RecordDetailsProps`; the old one was refused at every field object. Pages Studio seeds from it (`createSeed`) change the same way. An explicit `sections` option is still returned unchanged.
  - `record:details` gates a `{ group }` reference with the group's `visibleWhen`. It does not read `visibleWhen` off an enumerated section, a key the spec refuses there.
  - The console's default record page (`RecordDetailView`, `@object-ui/app-shell`) writes `{ group: KEY, showBorder: true }` for each declared group. Its ungrouped primary and "More details" sections are unchanged.
  - The `record:details` registration's `sections` input description now says a `{ group }` reference inherits the group's `visibleWhen`, and that one written on a section itself is not read.
  - Unchanged: `deriveFieldGroupDetailSections` still returns the resolved, enumerated sections (what a reference renders as), with no `visibleWhen` on them. No type member, zod member, registered `inputs` entry, prop or i18n key is added.
  
  **Migration.**
  
  - FROM reading a group's heading or members off a synthesized section (`sections[i].label`, `sections[i].fields`) → TO `deriveFieldGroupDetailSections(def)`, which returns the resolved sections, or the group's own entry in `def.fieldGroups`.
  - FROM a stored page section copied from an older seed, `{ name: 'pro', label: 'Pro details', fields: [ … ] }` → TO `{ group: 'pro' }`, with `columns` / `showBorder` / `headerColor` kept if you set them. Only the reference form inherits the group's `visibleWhen`; an enumerated copy renders on every row, as before.
- 22b503c: Read-only boolean values, the boolean list face and the Home greeting's punctuation follow the language (objectui#11689).
  
  Under zh-CN a record showed its boolean values as "Yes" / "No", and the Home greeting joined a Chinese greeting to the person's name with an ASCII comma and closed it with an ASCII period.
  
  - **Booleans.** The read-only surfaces that draw a boolean as a word now read the existing `common.yes` / `common.no` keys: `BooleanField`'s readonly display, a `FormulaField` whose `returnType` is `boolean`, the lookup column's plain-text fallback, and the record-detail highlights chip. zh-CN shows the Chinese words; English is unchanged. Without an `I18nProvider` the words stay "Yes" / "No".
  - **The boolean list face.** `BooleanCellRenderer`, which every list surface draws, spelled its status badge ("Active — Off") and its completion indicator's accessible names ("Completed" / "Not completed") in English. All three now come from the language packs. The grid also handed that face the authored field label while its header printed the translated one, so the badge named the column in the authored language under a translated header. The face now receives the label the header prints.
  - **Greeting.** The comma before the name and the closing mark are two new keys, so zh-CN reads the full-width comma and full stop, Japanese its own marks and Arabic its own comma. English is unchanged, and the name keeps its own colour.
  
  **Widened public surface.**
  
  - `@object-ui/i18n`: five new keys in all ten language packs, so the exported `en` pack and the `TranslationKeys` type derived from it gain `home.greetingSeparator`, `home.greetingEnd`, `fields.boolean.offBadge`, `fields.boolean.completed` and `fields.boolean.notCompleted`.
  - `@object-ui/fields`: a new export, `useBooleanValueLabel()`, with its type `BooleanValueLabel`. It returns the current language's word for a boolean value, and `@object-ui/plugin-detail`'s highlights chip reads it.
- f34e877: The record page and related lists honour a deadline's `settledWhen` (objectui#11815). The details section, the highlights strip and each related-list row judge a declared deadline against their own record, so a done record's past due date reads neutral while an open one reads "Overdue Nd" in red. A related list asks for the fields the predicate reads when no column shows them. The deadline comes from the object field only: a `dueLike` written on a detail-view entry is ignored.
- 2312bd9: A page that declares `print` now prints as a document, and a record page bound to such a page offers a Print action (objectui#11958, the objectui half of the print-page ruling on objectstack#8346, M1, zero server).
  
  - **The print stylesheet.** `PageRenderer` mounts a stylesheet built from the page's `print` declaration, only for a page that declares it. Every rule sits inside `@media print`, so the page on screen is drawn as before. `paperSize` and `orientation` set `@page { size }` (A4 and portrait when omitted). `margins` set one `@page` margin per declared side, in millimetres. `pageNumbers` prints "page / pages" in the bottom-right margin. `repeatHeader` and `repeatFooter` repeat the page's own `header` and `footer` regions on every sheet. `repeatTableHeaders` (on when omitted) repeats a table's column headings on every sheet it runs onto. `avoidBreakInside` keeps each block of a region whole on one sheet when it fits. Only the print page reaches paper: the console chrome and the record view's own panels around the page are hidden, and the page runs onto as many sheets as it needs.
  - **The printable blocks print whole.** On a print page, `record:line_items` no longer cuts lines off at its row cap in silence: when the child object has more lines than the cap (500 unless `limit` is set), the panel draws the cap's lines and the shared row-ceiling note under them, naming both numbers when the server reports a total. A collapsible `record:details` section draws open, because a closed section never reaches paper. Off a print page both blocks behave as before.
  - **The record page's Print action.** When the record page bound to a record declares `print`, the record view shows a Print button that opens the browser's print preview of that page.
  - **New exports from `@object-ui/react`:** `PrintPageProvider`, `usePrintPage` and `PrintPageContext`. `usePrintPage()` returns the enclosing page's `print` declaration, or `null` outside a print page.
  - The source comments that described PDF export as declined now say where a printable document lives: a page that declares `print`.
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- c08c933: A `record:details` section heading can show how many values a field holds (objectui#12192).
  
  A section that declares `count: { field }` (`@objectstack/spec` 18, `RecordDetailsProps.sections[].count`) now has the `{{ count }}` hole in its heading filled with the number of values that field holds on the current record: `{ name: 'tagging', label: '{{ count }} tags', count: { field: 'tags' }, fields: ['tags'] }` reads `3 tags` when three tags are selected. The hole grammar is the spec's exported `SECTION_HEADING_COUNT_HOLE`.
  
  - An absent or empty value counts 0. A field the viewer may not read counts as absent.
  - The hole is filled after the heading is translated, so each locale of an inline label map and a translated `objects.OBJECT._sections.NAME.label` entry write the same `{{ count }}`.
  - `count` changes the heading only. Whether the section renders is unchanged: with `hideEmpty` on (the default), a section whose fields are all empty is still absent.
  - A section without `count` prints its heading exactly as written, including a literal `{{ count }}`.
  
  `RecordDetailsComponentProps.sections[]` in `@object-ui/types` now declares `count?: { field: string }`, so a typed section literal carrying it compiles.
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
- 82e5f53: `record:details`, `record:highlights` and `record:quick_actions` honour the per-element `dataSource` binding the spec already declares on every page component (objectui#12294). A product `app` page can now compose a record's surfaces from these blocks, with no record page around them:
  
  ```json
  {
    "type": "record:highlights",
    "properties": { "fields": ["name", "environment_type"] },
    "dataSource": {
      "object": "sys_environment",
      "filter": [{ "field": "environment_type", "operator": "equals", "value": "production" }],
      "limit": 1
    }
  }
  ```
  
  - **One record per block.** A record block shows the FIRST row of the bound set by the binding's `sort`, read as one row and under the caller's own identity; the server decides what the caller may read, exactly as on any other read. When no row matches, each block draws what it draws for a record that is not there: `record:details` its "record not found" state, `record:highlights` nothing, `record:quick_actions` its empty bar. A read the server refuses draws the same, so a record the caller may not read looks absent. A read that fails for any other reason is reported in the block's place, with the family's data-source error panel.
  - **`record:quick_actions` runs against the bound row.** The object's declared actions (`actionNames`) run with the bound row's id.
  - **The binding resolves as on every bound block.** A named `view`, the binding's `filter` (with `{current_user_id}`-style tokens), and its `sort` mean what they mean on a list block, and an unresolvable view or a refused filter draws the same configuration panel. Reference fields come back expanded, limited to the fields the caller may read, as on the record page.
  - **The bound record stays fresh.** It re-reads in place whenever a write to its object is announced — by the data source's mutation events or on the data-invalidation bus — so a save or an action elsewhere on the page refreshes it.
  - **The record page is unchanged.** A block with no `dataSource` reads the record page's record exactly as before. A bound block placed on a record page shows its bound record instead, as the spec says the binding does, and is kept out of that page's inline-edit session and highlight-field registry: it is read-only there, and it does not hide fields from the page record's details.
  - **The registrations declare the key.** The three blocks publish the injected `dataSource` input, so the page authoring diagnostics no longer report it as an unknown prop.
  - **`@object-ui/types`: the strict authoring face accepts the binding on the three blocks.** Each arm declares `dataSource` as the spec's `ElementDataSourceSchema`, by reference, as `record:line_items` does; the TypeScript authoring face follows. `objectui validate` refused it as an undeclared key before.
  - **`@object-ui/cli`: `objectui validate` warns on a record block whose binding has no `limit: 1`.** The document still validates; the warning names the block's path and asks the author to say which record the block shows. `record:related_list` is not warned about: its binding is the binding of its child rows.
  
  `record:related_list` is unchanged: its `dataSource` still binds the rows it lists.
- d81e460: `record:related_list` reads its parent record from `parentDataSource` (objectui#12294, ruling B on objectui#12296). The key is a member of the spec's `record:related_list` row and takes the object binding `dataSource` takes, so a product `app` page can list a record's children with no record page around the block:
  
  ```json
  {
    "type": "record:related_list",
    "properties": {
      "objectName": "sys_member",
      "relationshipField": "environment_id",
      "parentDataSource": {
        "object": "sys_environment",
        "filter": [{ "field": "environment_type", "operator": "equals", "value": "production" }],
        "limit": 1
      }
    }
  }
  ```
  
  - **The parent is read the way the other record blocks read their record.** The FIRST row of the binding by its `sort` is the parent, read as one row under the caller's own identity and re-read when a write to its object is announced. The list draws that record's children through `relationshipField`, and `relationshipValueField` is read on that row.
  - **No row is said out loud.** When no row matches, or the server refuses the read, the block draws a notice naming the object in its place, and no list: an empty list would read as "this record has no related records". A read that fails any other way draws the data-source error panel.
  - **Without the key, the parent is the record page's record, as before**, and a related list rendered on a record page draws the same markup it drew. With the key, the binding wins over the page record.
  - **`dataSource` keeps its meaning.** On this block it binds the CHILD rows the list draws, and it is never read as the parent.
  - **Authoring.** `RecordRelatedListComponentProps` declares `parentDataSource` as the spec's `ElementDataSource`, by reference, and the registration publishes it as an input, so the html tier no longer reports it as an unknown prop. `objectui validate` already accepted it in `properties`, where the spec row puts it, and refuses it written on the node; it now also warns on a parent binding without `limit: 1`, as it warns on the one-record blocks' bindings.
- 28ebfb5: A record page draws one provenance footer for its record, whatever the number of `record:details` nodes it carries (objectui#12307).
  
  Every `DetailView` mounted its own `RecordMetaFooter`, the one-line "Created … Updated …" summary, and a record page renders one `DetailView` per `record:details` node. A page with two nodes printed the same line twice, and a node whose sections were all hidden drew a block holding that line and nothing else (measured on objectstack-ai/cloud's environment page).
  
  - **`@object-ui/plugin-detail`.** A `record:details` node that reads the record page's record (it carries no `dataSource` binding) no longer draws a footer: the `DetailView` it mounts leaves the line to the page. So a node whose sections are all hidden now draws nothing. A standalone `DetailView` (the `detail-view` node, `RecordDetailDrawer`, `RecordDetailPanel`, a direct React caller) keeps its footer, and so does a BOUND `record:details`, which shows a record the page does not.
  - **`@object-ui/app-shell`.** `RecordDetailView` draws the record's `RecordMetaFooter` once, at the page foot, after the page tree and the panels it appends there, so the line no longer moves with the active tab. The Studio page preview draws it the same way under its sample record.
  
  Behaviour change for a host that mounts `RecordContextProvider` itself and renders `record:details` nodes in it: those nodes no longer draw the record's footer, so the host renders `RecordMetaFooter` (already exported from `@object-ui/plugin-detail`) once, with the record as `data` and the object definition as `objectSchema`, where its page ends.
  
  Nothing is added to either package entry: no export, prop, type member or schema key. The signal from `record:details` to its `DetailView` is a context internal to `@object-ui/plugin-detail`.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
- 023087f: The details grid passes a pointer field's `referenceDeletedWhen` to `resolveRecordPointer` (objectui#12489).
  
  `DetailSection` hands the rule the object field's `referenceDeletedWhen` beside `referenceVia`, and the sibling field's options translated exactly as the grid translates a `select` field's options. So the tombstone a pointer face draws reads as the option reads in its own cell, localized labels included. The predicate is evaluated in `@object-ui/fields`, not here. A field without the key draws as before.
  
  **Clause-②: yes (widening)**: the grid hands the pointer face one more state. No export, prop or type changes, and nothing narrows.
- f62b6ff: Resolve `@objectstack/*` `18.0.0-next.2` (objectui#12626).
  
  The console and the runner bundle `18.0.0-next.2`. `@object-ui/types` and `@object-ui/app-shell` now declare `@objectstack/spec` `^18.0.0-next.2`; the other packages keep `^18.0.0-next.1`, which already admits it.
  
  **The record dialog opens bounded on desktop for every object.** A create, edit or child record dialog on an object with many fields used to open as a 95vw task canvas. `@objectstack/spec` `18.0.0-next.2` derives a bounded modal for it on desktop and keeps the full-screen sheet on a phone, and the console now takes that answer directly.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates a page through the spec's own page checks, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.2` refuses. Each was accepted before:
  
  - On a `kind: 'full'` page, a region whose `name` the page's `template` does not place (with the default template: anything but `header`, `sidebar`, `main`, `aside` and `footer`), and a second region for a slot another region already fills. The renderer stacked such a region under `main` at full width. Rename it to a slot the template places, or choose the `dashboard` template, which lays every other region out as a grid cell.
  - `isDefault: true` on a page whose `type` is its page kind (`record`, `home` or `utility`) unless it is a `record` page bound to an `object`. Delete the key; an app's landing page is its first navigation item.
- 8df2608: `record:related_list` now draws the "View all" link its `showViewAll` key declares (objectui#12741, ENFORCE, the objectui half of objectstack-ai/objectstack#23941).
  
  The contract declares `showViewAll: z.boolean().default(true)`, "Show 'View All' link to see all related records". Nothing read the key, and no host passed `RelatedList` an `onViewAll`, so the default drew nothing. The renderer reads the key now:
  
  - **Absent or `true`**: the link draws when the host offers a destination (the new `RelatedRecordHandlers.onViewAll`) and the list has records. Clicking it opens the related object's records, filtered to this parent on the relationship the list already uses.
  - **`false`**: no link.
  - **An empty list, or no destination from the host**: no link.
  
  `RelatedList` used to draw its "View all" link only when the records ran past one page. It now draws whenever it is handed `onViewAll` and has records, because the spec states no truncation condition. This renderer is the only caller that passes `onViewAll`.
  
  ⚠️ Behaviour change: on a console record page, every related list with records now shows "View all", unless it declares `showViewAll: false`.
  
  Clause-② line, the same as the pull request's:
  Clause-②: yes
  `@object-ui/react`'s exported `RelatedRecordHandlers` gains one optional member, `onViewAll`. No input, key or accept set of this package changes.
- 26323c4: Resolve `@objectstack/*` `18.0.0-next.3` (objectui#12873).
  
  The console and the runner bundle `18.0.0-next.3`. Every package keeps its `@objectstack/*` range (`^18.0.0-next.1`, or `^18.0.0-next.2` for `@object-ui/types` and `@object-ui/components`), which already admits it, except `@object-ui/app-shell` (objectui#12943) and `@object-ui/plugin-detail` (objectui#12946), which declare `^18.0.0-next.3`.
  
  **An accept set that narrows with it.** `@object-ui/types` validates a `page:header` node's `properties` through the spec's own `page:header` row, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse `showStar`, which `18.0.0-next.3` retires: the follow star it switched on is not drawn by any renderer. It was accepted before. Delete the key.
  
  **A type that widens with it.** `SelectOptionBase`, and the field and form option types built on it, take the spec's select option by reference, so they now carry its optional `kind` (`'open' | 'won' | 'lost'`), the lifecycle category `18.0.0-next.3` adds. The spec takes it on a single-value `select` or `radio` field's options and requires it on every option of the field an object's `stageField` names.
- 8392f74: `record:path`: a stage derived from a picklist now takes its terminal from the option's declared lifecycle `kind` (objectstack#23809) — `won` is the forward terminus, `lost` sits in the separated group, `open` is a middle step — instead of guessing it from the value's spelling. The spelling heuristic stays the fallback for options that declare no kind (objectui#12907). Two published types gain an optional member: `deriveStages`' return type adds `terminal?: 'won' | 'lost'`, and `ObjectDefFieldLike.options[]` adds `kind?: SelectOptionKind`.
- c219165: Bound record blocks draw an authored empty state when their binding answers no row (objectui#12932, the renderer half of objectstack-ai/objectstack#24266).
  
  `record:details`, `record:highlights` and `record:quick_actions` take the spec's `emptyState` (`{ title, message, icon, link }`, the list view's own `EmptyStateSchema`). When the block carries a `dataSource` binding and the bound read answers no row, the block draws that empty state in its place. A read the server refuses as forbidden reads as no row, so the empty state is drawn for it too. The drawing is the one `object-grid` uses for its own `emptyState`: a Lucide `icon`, a `title` and a `message`, each a plain string or an inline locale map, and one `link` followed through the action runner. A `title` left out reads "Record not found".
  
  It is not drawn while the read is loading, in place of the error panel a failed read shows, when a bound row is there, or on a block with no `dataSource`. A block that declares no `emptyState` keeps its own placeholder: "Record not found" on `record:details`, nothing on `record:highlights`, and the empty bar on `record:quick_actions`.
  
  The three registrations publish the `emptyState` input.
  
  `@object-ui/types` declares `emptyState` on `RecordDetailsComponentProps` and `RecordHighlightsComponentProps`, by reference to the spec's `EmptyState` type, so a typed literal can author it.
  
  `@object-ui/plugin-detail` now requires `@objectstack/spec` `^18.0.0-next.5`, the first published release that declares the key.
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

- b61c116: fix(plugin-detail): `record:details` read mode shows a `textarea` value with its line breaks (objectui#11577)
  
  A multi-line `textarea` value, such as a note with a blank line in it, read as one line on the record page: the details body drew every `textarea` value with the grid's one-line cell, which folds line breaks into spaces and cuts a long value off with an ellipsis. The record form's read-only field and, since objectui#11562, the inline editor already kept the breaks.
  
  The details body now draws a `textarea` value with the fields package's own read display, the read-only branch of `TextAreaField`, which is the display the record form uses. Line breaks, blank lines and a trailing newline show as stored. A single-line value reads as the same line; a long one now wraps at the column width instead of ending in an ellipsis. Other field types, plain text included, render exactly as before, and grid cells keep their one-line display.
- f9f4a62: Console, record page and Studio copy from the 2026-10-05 cloud acceptance run (objectui#11659).
  
  **The cloud home's primary button reads "Open workspace" (zh 「进入工作区」), not "Open Production".** A new customer has exactly one environment, and "production" is control-plane vocabulary. The `cloud:onboarding-next` widget's ready-state button now resolves `cloudOnboarding.openWorkspace`, which replaces `cloudOnboarding.openProduction` in all ten language packs, and the hint under it (`cloudOnboarding.hintReady`) says "workspace" instead of "production environment". The button still navigates to the page's `openProductionUrl`; the page-metadata contract is unchanged. The same release then retires the `cloud:onboarding-next` widget and every `cloudOnboarding.*` key (objectui#12954), so neither the button nor those keys ship.
  
  **The create-workspace dialog asks for the name only.** `CreateWorkspaceDialog` no longer shows the "URL slug" field: the customer never sees the slug take effect at this step. The slug is still generated from the name, by the same rule as before, and sent with the create call; the owner can change it later in organization settings. Because the slug is no longer the user's to fix in the dialog, a slug collision (`ORGANIZATION_ALREADY_EXISTS` or `ORGANIZATION_SLUG_ALREADY_TAKEN`) is retried with a short random suffix, up to three attempts in all; any other refusal is shown as before. The `workspace.slugLabel` and `workspace.slugHint` pack keys are left in place, now unread.
  
  **The backup-password reminder no longer appears in the user's first session.** 「建议设置一个备用密码」 showed on the environment home right after a new user built their first app: the reminder was gated on a home-visit count (quiet on the first home mount, shown on the second), and coming back to home after building is the second mount inside the first sitting. It now stays quiet for 12 hours after the first home visit on the device, so it first shows on a later day's visit. The first-visit record (`os:recovery-pw-first-seen`) now holds a timestamp; a device that holds the old `'1'` flag starts the 12 hours over rather than reading it as long ago. When storage is unavailable it stays quiet. `RecoveryPasswordReminder` moves out of `HomePage.tsx` into its own module; it is not exported from the package entry, and its other conditions (dismissed, SSO-enforced, has a local password) are unchanged.
  
  **The record header's highlight row no longer cuts a phone number.** A drawer's highlight row read 「0574-876」 for the stored `0574-8765-4321`, with no ellipsis. The phone cell draws a dial icon, the number and a copy button in one `inline-flex` box, and the chip's single-line clip cannot put an ellipsis on such a box, so a 9rem chip cut the number mid-way. `HeaderHighlight` now gives a `phone` chip the wide basis that `email` and `url` already take, so a whole number shows; the full value stays in the chip's hover title. Other field types keep their chip width.
  
  **Studio's dashboard widgets list names each widget's kind in the designer's language.** The list read 「按客户状态统计数量 · bar」: beside each title, `DashboardDefaultInspector` printed the stored `type` id. It now prints the name the add-widget picker shows for that kind (`engine.widgetPicker.type.*`, zh 「柱状图」, en "Bar chart"), with the id on hover. A type the catalogue does not know still prints its id. The stored `type` is unchanged.
  
  **Studio's automation pillar copy is plain language in zh.** The list heading read 「自动化 · flow」 and the top bar 「默认 OFF · 审阅后再启用」: an internal metadata type and an English switch state inside Chinese copy. They now read 「自动化」 and 「默认停用 · 审阅后再启用」, matching the pillar's own 已启用 / 已停用, and the canvas hint 「可视化编排 · 点选节点配置」 reads 「点选画布上的节点即可配置」. The en heading drops the type too ("Automations"). Whether the pillar is offered on a given plan is not decided here.
- 7300fca: **The record header's highlight chips share the row's free width and truncate only when it runs out (objectui#11684).** A Product with SKU "QA Widget 1" read "QA Wid…" in the record drawer's highlight row, with most of the row empty. Every chip in `HeaderHighlight` was a fixed column: a 9rem basis (16rem for wide types and for a column being edited), no grow, and a 16rem / 24rem cap. A value wider than the chip was clipped, however much room the row had left.
  
  A chip's basis is now its floor, and the chips grow into the line's free width. Each chip is capped at its own content, so a chip that fits stops growing and the rest of the free width goes to the chips that still need it. Which chips share a line does not change, because line breaking still reads the floors. A short value keeps its 9rem column, and a sparse strip still packs left, because no chip is ever wider than what it shows. A value is cut with an ellipsis only once its line has no free width left. The whole value stays available as the hover title. A column being edited still takes the 16rem floor, and it can grow to its editor's natural width.
- 4590363: A record open no longer sends the same record read twice at once, and asks each explain question once, with concurrent callers sharing the request (objectui#11699).
  
  A record page open sent `GET /api/v1/data/OBJ/ID` twice at the same moment and `POST /api/v1/security/explain` four times: the `update` and the `delete` question, each asked twice. Both reads came from the details block, whose load effect runs again while its first read is still on the wire. Each question was asked by the page header and by the details block, which mounts while the header's answer is still pending. The record page's own `$expand` read of the record, which it sends again when the object definition changes identity, is not changed here.
  
  - **`ObjectStackAdapter.findOne` shares an in-flight read**, the way `find` already did. Calls for the same resource, id and params that arrive while a read is pending get that read's answer. The entry is dropped when the read settles, so a later call reads again: this is not a response cache. A failed read reaches every caller that shared it and is not remembered. A write through the adapter (`create`, `update`, `delete`, the bulk and batch writes) drops the pending `findOne` reads of the resource it wrote, so a record read asked after a save never gets an answer sent before it.
  - **The record-level edit and delete probe (`useRecordEditable`) shares an unanswered question.** Mounts asking the same question (same principal, object, record and operation) while it is pending wait on one request. A question whose record changes while it is pending is not shared, so the re-ask is a fresh request. No pending question is shared across a change of the signed-in principal.
  
  Nothing is added to either package entry: no export, prop, type member or language-pack key. `findOne` keeps its signature.
- 885a96f: Titles and links outside the object list page that name a list of an object's records read the object's plural label (objectui#11733).
  
  objectui#11696 titled the object list page and its breadcrumb with `useObjectLabel().objectPluralLabel`: the translated plural, else the declared `pluralLabel`, else the label. The other places that name the same kind of list now read it too:
  
  - **Related-list titles on the record page** (`RecordDetailView`): a section listing a child object's records is titled with the child's plural ("Tasks"). A child that points at the parent through more than one field is titled with its plural and that field's label ("Opportunities · Partner Project"); that title was built from the child's untranslated label before.
  - **`record:related_list` and `record:reference_rail` with no authored title** (`@object-ui/plugin-detail`): the list heading, each rail card, and the rail's "+ N empty (…)" line read the bundle's `objects.{name}.pluralLabel`, else the translated label, else the humanized object name. These blocks hold the related object's name only, so they read bundle keys, not a declared `pluralLabel`.
  - **The record form page's breadcrumb link** (`RecordFormPage`): the link to the object's list reads the plural; the "Create …" / "Edit …" title and the save toast keep the singular.
  - **Favorites and recent items**: the favorite saved by the object list page's star button is labelled with the plural, and a recent `object` entry is named with the plural (`useRecentItemLabel`).
  - **The record page's back link**: when the open list view has no label, the link back to the list reads the plural, both when a row or a link cell opens the record (`ObjectView`) and when a create lands on the new record's page.
  
  Unchanged: an unlabelled `object` navigation entry still inherits the singular (`useNavTargetLabel`, step 3 of the spec's navigation-label rule), and record-scoped text keeps the singular: the record page, the record drawer title, "New …", "Create …" / "Edit …", the delete confirmation and toasts, and the import wizard's object name.
- 72167a9: A related list's action-refusal notice is shown to the people who can fix the page, not to every viewer (objectui#11768).
  
  When a `record:related_list` names an action id in `actions` that the related object does not define, or one the list has nowhere to draw, the list draws no button for it and names it in a notice above the list (objectui#11163). That notice is an authoring fault, and `os validate` already refuses such an id at build time. It used to be drawn for whoever opened the record, so an end user read a configuration error they could neither fix nor act on.
  
  The notice is now drawn only:
  
  - for a viewer who holds the metadata-edit capability, `manage_metadata`, read the way the console's Studio entry points read it. A permission provider that never reports capabilities (a backend predating ADR-0066, the role-based provider, or no provider at all, as in the Studio designer) counts as holding it. A reported capability set without it, including an empty one, does not;
  - or in dev mode, meaning the build's `NODE_ENV` is not `production`.
  
  Everything else is unchanged for every viewer: the refused id still draws no button, the ids that resolve still render, and a list with no refused id renders exactly as before.
  
  Nothing is added to the package entry: no export, prop, type member or language-pack key.
- 455c646: A record action greyed out by its declared `disabled` predicate now says why (objectui#11811). It shows the reason "Not available for this record", and the same text is its accessible description (`aria-describedby`), so a screen reader announces it too. Before, the action carried no tooltip, no `title` and no description, so a user could not learn why it was off.
  
  Where it shows:
  
  - **The record page header** (`page:header`, `@object-ui/components`). On an inline action button, hovering it or focusing it from the keyboard opens a tooltip with the reason. On an action in the ⋯ overflow menu, the reason is a second line under the label. A tooltip there could not be reached from the keyboard, because the menu skips a disabled item and traps Tab.
  - **The `record:quick_actions` bar** (`@object-ui/plugin-detail`), for example a record page's section bar. Hovering or focusing the button opens the tooltip.
  - **The `DeclaredActionsBar`** (`@object-ui/app-shell`), which renders server-declared actions on the approvals surfaces. Hovering or focusing the button opens the tooltip.
  
  A natively disabled button receives no pointer or focus events, so the tooltip's trigger is a focusable wrapper around the button, the pattern Radix documents for a disabled trigger.
  
  What stays unchanged: a button greyed out only while its own action runs shows no reason. So do the header's Edit and Delete that the console injects, whose `disabled` the host computes (for example while the record is locked for approval), and a header action greyed out by a live inline-edit session.
  
  The reason is the same generic sentence for every action. An author-written reason beside the predicate would be a new key on the action spec, which is objectstack's to declare. It is not part of this change.
  
  **Clause-②: yes (widening).** `@object-ui/i18n` gains one language-pack key, `actions.notAvailableForRecord`, translated in all ten packs. No export, prop or type member is added, removed or changed.
- a368ccb: A pointer field draws the record it points at, the console reads an approval request's record page through the approvals routes, and the approval decision panel is built for the request page (objectui#12045, B1 of objectui#2763).
  
  - **The approval decision panel (`@object-ui/app-shell`, module-internal).** One panel that draws the request's decision progress (`DecisionProgressIndicator`) above the request's own declared decision actions (`DeclaredActionsBar` at `record_section`, decided through `ActionParamDialog`). It reads the bound request and takes no authorable props; outside a `sys_approval_request` record page it renders nothing. After a decision it invalidates the request record and its timeline instead of remounting. It is not registered as a component type yet: the type `record:approval_decision` is proposed to the spec on objectstack-ai/objectstack#22472, and its registration lands with the spec row.
  - **`referenceVia` pointer pairs (`@object-ui/fields`).** `resolveRecordPointer(field, row)` returns the record a `text` field declaring `referenceVia` points at on one row (`{ objectName, recordId }`, the new `RecordPointer` type), and `RECORD_POINTER_CARD_TYPE` is the registry key a resolved pair is drawn with. The package's default under that key draws the record id as text, as the field drew before.
  - **The record details grid draws the pair (`@object-ui/plugin-detail`).** A field declaring `referenceVia` is resolved from the row and drawn with the pointer face; with `@object-ui/app-shell` loaded that face is the record preview card, so `sys_approval_request.record_id` and the other pointer fields show the record they point at. A pair whose row leaves either half blank draws the stored text.
  - **The console's approval request page.** The console's record route for `sys_approval_request` mounts the record page over the routed approvals source, so the request carries the `viewer` block its declared actions gate on and the decision tally. The source now reads one request's `sys_approval_action` timeline from `GET /approvals/requests/:id/actions`, applying the read's `$orderby`, `$top` and `$skip` itself, dropping `$select` and `$expand`, and refusing any other parameter with `UNSUPPORTED_QUERY_PARAM`. On a request's own page the record view no longer asks for approvals opened on the request itself.
  
  No language-pack key is added, and `CellRendererProps` is unchanged.
  
  **Superseded in part (objectui#12072):** outside a `sys_approval_request` record page the panel now draws a short localized notice instead of nothing, so the sentence above saying it renders nothing there no longer holds when both changes release together.
  
  **Corrected and superseded in part (objectui#12045, the page-mount step):** the last sentence of the console bullet, that a request's own page no longer asks for approvals opened on the request itself, is an `@object-ui/app-shell` change (the record view's approvals read), not a console one. And the console no longer declares a record route of its own for `sys_approval_request`: every surface that opens a request reads it through the console's adapter with the request's record reads routed, so the console bullet's first sentence describes the route that change replaces, when both release together.
- e391f87: A record's History tab and activity feed name the user behind an activity row that carries `actor_id` and no `actor_name` (objectui#12067). On `@objectstack/*` 17.7.0 the audit writer fills only `actor_id`, so `record:history` showed every such entry as "Unknown user", and the `record:activity` block and the console record page's activity feed showed the change as made by "System". Their `sys_activity` reads now expand `actor_id`, which brings each user's record back with the page in the same request, and the entry shows that user's `name`. `actor_name`, when present, still wins: it is the name recorded when the action happened. A row with neither, or whose user the viewer may not read, keeps the existing fallback, and a raw user id is never shown as a name.
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
- 5f75cfa: In-place edit on the record page and a list's in-cell edit honour the caller's field write grant, and the owner field honours the transfer grant (objectui#12103).
  
  **What a caller saw.** A caller whose permission set marks a field `{ readable: true, editable: false }` was offered an editor for it in the record page's details body, in its highlights strip and in a list's grid cells, and Save answered 403 ("Field write denied"). The owner field was offered the same way to a caller without the transfer grant, and Save answered 403 ("requires the transfer grant"). Edit forms already refused both fields through `fieldWriteGate`.
  
  **What changed.**
  
  - **The map (`@object-ui/core`).** The `recordEdit` and `listInlineEdit` rows of `AFFORDANCE_GRANTS` gain `field: 'write'`, so the record page's in-place edit and a list's in-cell edit each ask every field the same update question an edit form asks, through `resolveFieldAffordance`. `FieldAffordance` therefore includes both rows.
  - **The details body and the highlights strip (`@object-ui/plugin-detail`).** `DetailSection` and `HeaderHighlight` ask that question of each field. A refused field shows no pencil, does not enter the edit session on double-click, and stays a read display in edit mode. The strip and the body share one session and one Save, so they answer alike.
  - **The grid (`@object-ui/plugin-grid`).** `ObjectGrid` marks a refused field's column not editable, so its cell keeps the read display while the rest of the row edits. Whether the grid is editable at all is still the object-level `listInlineEdit` verdict.
  - **The owner field (`@object-ui/permissions`).** The server refuses an update that writes the record's owner (the field the `@objectstack/spec` constant `SystemFieldName` names `OWNER_ID`) unless the caller holds `allowTransfer` or `modifyAllRecords`. `MePermissionsProvider`'s `checkField(object, owner, 'write')` now answers with that grant, read with the spec's `objectPermissionGrants`. The `write` question is the server's update rule for a field, so every surface that asks it (edit forms, in-place edit, in-cell edit) offers the owner field only to a caller who may transfer the record. `checkField(object, owner, 'create')` is unchanged, because on insert the server stamps an empty owner to the caller and accepts the caller's own id. `MePermissionsResponse` declares the `allowTransfer` bit the endpoint already serves, and `@object-ui/permissions` now depends on `@objectstack/spec` directly.
  
  **Unchanged.** With no permission provider mounted no field question is asked, so a standalone embed and the designer preview behave as before. The server still enforces every grant; this only stops the console from offering a write it would refuse.
  
  **Clause-②: yes (widening).** `AFFORDANCE_GRANTS.recordEdit` and `AFFORDANCE_GRANTS.listInlineEdit` gain a `field: 'write'` member, which widens the `FieldAffordance` type by those two rows. `MePermissionsResponse`'s object entry declares an optional `allowTransfer?: boolean`. `checkField`'s action union is unchanged; its `write` answer narrows for the owner field only. No export, prop or language-pack key is added or removed.
- 1d1cfe0: A record activity feed shows an object's `activityMilestones` rows of type `completed`, such as "Case resolved", instead of hiding them as completed tasks (objectui#12106).
  
  A milestone keeps the `type` its declaration names, so "Case resolved" declared with `type: 'completed'` arrived as a `completed` row. The feed mapped every `completed` row to a `task` item, and `showCompleted` is off by default, so the milestone was hidden on every record page that did not set it, including the default page.
  
  plugin-audit now stamps `metadata.kind: 'milestone'` on a row a milestone fired (objectstack#22771). The feed reads that marker. A `completed` row that carries it renders as a `system` item, the presentation every other author-typed milestone already gets, and shows whatever `showCompleted` says. A task's own "Task completed" milestone shows on that task's page for the same reason.
  
  A `completed` row without the marker is unchanged: it is a `task` item, hidden unless `showCompleted` is on. That covers rows from a runtime that does not stamp the marker yet, and rows an app inserts itself. `filterMode: 'tasks_only'` and `types: ['task']` still select tasks only, so they do not list a milestone. The `record:activity` block's own read and the console record page's feed both read rows through `activityRowToFeedItem`, so both change together. No export, prop or type changes.
- 5330038: Console rendering fixes from the HotCRM browser pass (objectui#12110):
  
  - **Grid:** a view column's authored `label` is the header. It used to lose to the field's translated label whenever the app bundle translated the field.
  - **Form:** a field `widget` that names no registered component falls back to the field type's renderer, as the spec's `widget` description says. A `rating` field declaring `widget: 'star_rating'` now draws the star widget instead of a text box. A built-in control name (`input`, `textarea`, …) and the native password and email inputs still render as before.
  - **Cells:** a `rating` value draws stars out of the field's `max` (5 by default) in list, detail and related-list cells, instead of a bare number.
  - **Reference rail:** a related row is named by its object's declared `nameField`, and the rail refetches in place when the record, a related object or everything is invalidated. A record action with `refreshAfter: true` therefore refreshes the rail too.
  - **Gantt:** the task list, the tooltip and the drag previews show a date's year when it is not the current year.
  - **Approvals drawer:** a `position:` approver shows the position's label, from the console's position registry, instead of a truncated id. The headline figure prefers the object's declared `currency` field and never shows a zero from a field matched only by its name.
  - **Public form:** a form with no title of its own is headed by its object's label, not the object's API name.
- a7d4920: The record page's discussion shows stored replies under their comment, and every comment offers the reply input where the caller may post one (objectui#12144).
  
  With threading on, which the default record page's discussion turns on, the timeline takes every reply out of the top-level list and shows a comment's replies only under a reply count above zero. The record page read each `sys_comment` row with its `parent_id` and never a reply count, so after a reload a stored reply was shown nowhere, and no comment read from the server offered the reply input: the first reply on a comment could not be posted from the page.
  
  - **`@object-ui/app-shell`:** the record page counts each comment's replies in the comments it read (the rows whose `parent_id` names it) and sets the feed item's `replyCount` from that count. `sys_comment` stores no reply count; its object definition says to count `parent_id` children at read time.
  - **`@object-ui/plugin-detail`:** `RecordActivityTimeline` offers the reply input on every comment row it is handed `onAddReply` for, including a comment with no replies yet, and on no row that is not a comment, because a reply is stored as a comment under a comment. A comment's reply list still shows only when its `replyCount` is above zero, so whether replies show never depends on whether the caller may post one. On the record page the input still needs the create grant on `sys_comment`, as before.
  
  Nothing is added to either package's entry: no export, prop, type member or language-pack key.
- e723f58: Screen readers hear the names of more controls in the viewer's language (objectui#12145).
  
  These controls carried an English `aria-label`, so under a non-English locale a screen reader announced their names in English: the docs portal's loading spinner, the record form page's breadcrumb, the `Spinner` status region, a data table's row menu button, the `pagination` renderer's previous and next links, the image crop preview, the percent slider, the record picker's grid, the AI composer's send and stop button and an attachment's remove button, the designer's undo and redo buttons, minimap, version history and back button, a dismissible record alert's close button, the bulk-action bar, and the mobile view switcher. Each name now comes from the language packs. English names are unchanged, with two small exceptions: the spinner now reads "Loading…", and the pagination links read "Previous page" and "Next page", the same words the data table pager uses. Sighted use is unchanged.
  
  Added: eight language-pack keys in all ten packs: `help.loadingDocumentation`, `common.breadcrumb`, `table.rowActions`, `fields.image.cropPreview`, `fields.percent.slider`, `designer.canvasMinimap`, `designer.versionHistory` and `grid.bulkActions`. Every other name reuses a key that already holds the same words. The exported `en` pack, and so `TranslationKeys`, gains these eight members. `PromptInputAttachment` (exported through `AIElements`) takes an optional `removeLabel` prop that names its remove button; without it the button keeps its English name.
- 466a219: The detail view's inline-edit field enrichment no longer copies `allow_create`, `lookup_columns` or `lookup_page_size` off the object schema. The lookup picker reads `allowCreate`, `lookupColumns` and `lookupPageSize` alone since objectui#12157, and those are still copied.
- 803f678: An inline edit of a date-only field on a record page saves the day the user picked, in every timezone (objectui#12206).
  
  The inline editor in the record highlights and the details body wrote a `date` field as local midnight converted to a UTC instant. The server keeps a date-only field's UTC calendar day, so every user east of UTC saved the day before: at UTC+8, picking 2026-10-16 sent `2026-10-15T16:00:00.000Z` and stored 2026-10-15. The editor now writes the picked day as the plain `YYYY-MM-DD`, as the Edit form already did.
  
  A `datetime` field edited inline is unchanged. No export, prop or type changes.
- 5c2982a: A record whose `approval_status` reads `pending` no longer opens locked when the approvals read answered and found no request (objectui#12220).
  
  A composition without the approvals service answers `GET /api/v1/approvals/requests?object=…&recordId=…` with `200 { "data": [] }` and enforces no lock: a `PATCH` to the record succeeds. The record page still showed "Locked for approval", disabled Edit and offered Recall, which had nothing to recall, because the page and the detail body's approval band fell back to the literal `approval_status` column whenever no pending request was found. Records that an app stamped `pending` with no request behind them stayed locked in the console.
  
  - **The rule:** when the approvals read answers, the lock follows the open request. No pending request means no approval band, no lock and no Recall. The `approval_status` column stands in only while no read has answered: the route is absent (404 or 501), the read has not landed yet, or the first read failed. A record with an open request is unchanged, including a `lockRecord: false` node, which stays editable.
  - **`@object-ui/react` adds** `resolveApprovalLock`, the one function the record page and the band both call, with its `ApprovalLockInput` and `ApprovalLockState` types. It also adds an optional `approvalReadAnswered` prop on `InlineEditProvider`, read back on `InlineEditContextValue`. A host sets it when its `locked` and `approvalPending` come from an approvals read that answered. Omitted, the band keeps the column fallback exactly as before.
  - **`@object-ui/app-shell`:** the record page sets `approvalReadAnswered` from its approvals read.
  - **`@object-ui/plugin-detail`:** the band decides through `resolveApprovalLock`.
  
  Nothing is removed or renamed.
- 0cd322d: A record activity feed shows a call, meeting or email logged on the record, instead of hiding it as a completed task (objectui#12228). On an object with no authored record page, a call logged with Log a Call now appears in the default page's feed.
  
  An action that logs an interaction writes the interaction as its own record (an event, a `sys_email` row) and then one `sys_activity` row of type `completed` that points at it through `source_object` / `source_id` (ADR-0052). The feed mapped every `completed` row to a `task` item, and `showCompleted` is off by default, so the default record page, whose `record:discussion` block carries no `feed`, hid every logged call, meeting and email.
  
  The feed's `showCompleted` filter now keeps a `task` item that carries that pointer: the same items the timeline already gives a **View source** link. `showCompleted` still hides a `completed` row with no pointer, such as a finished task, while it is off. A logged interaction stays a `task` item, so `types: ['task']` and `filterMode: 'tasks_only'` still list it, and a page that sets `showCompleted: true` renders exactly what it did before. The default record page is not changed and `showCompleted`'s default stays `false`.
  
  This narrows one sentence of the objectui#12106 entry, which said a `completed` row an app inserts itself stays hidden by default: one that points at its source record now shows. The `record:activity` block's own read and the console record page's feed both run the same filter, so both change together. No export, prop or type changes.
- 10aba37: A currency field's fixed currency, declared as `currencyConfig`, shows on the record quick-look panel and in related lists (objectui#12242).
  
  `@objectstack/spec`'s `FieldSchema` refuses a field-level `currency`, so `currencyConfig: { currencyMode: 'fixed', defaultCurrency }` is the only way a spec object can say an amount is in euros. The record page's sections already carried it to the cell. `RecordDetailPanel`'s field build and `RelatedList`'s cell bag copied `currency` and dropped `currencyConfig`, so on those two surfaces a fixed-EUR amount read in the tenant's currency, or as a bare number when the tenant has none.
  
  - FROM `currency` copied alone → TO `currency` and `currencyConfig` copied, so the cell resolves the currency the way every other currency cell does.
- 51c661e: The console's assistant button no longer covers the record page's inline-edit Save or an attachment's Download and Delete, and deleting an attachment asks first (objectui#12248).
  
  - **The assistant button steps aside.** It sits in the bottom-right corner of every page, and at common desktop widths the inline-edit bar's Save and, when the attachments panel is the page's last content, the last row's Delete land under it. A click there opened the assistant instead, and an inline save could be lost that way. The button is now hidden while one of those controls is under it, and it comes back as soon as the corner is free. The assistant stays reachable from the top bar and with Cmd/Ctrl+Shift+I. On a phone, where the button sits higher, nothing changes.
  - **`InlineEditSaveBar` marks its bar** with a `data-fab-yield` attribute, which a host's floating launcher can read. No prop or export is added.
  - **Attachment delete asks for confirmation** through the console's usual destructive confirm dialog, the one the record page's own Delete uses. The dialog names the file. Cancel deletes nothing.
  - **`@object-ui/i18n`:** one new key, `detail.deleteAttachmentConfirm`, in all ten language packs.
- 9782cb2: A `record:details` node with neither `sections` nor `fields` now draws the object's `highlightFields` (objectui#12433).
  
  `@objectstack/spec` declares this fallback on `RecordDetailsProps` ("omitting it falls back to the object's `highlightFields`"), and the block's own registry inputs said the same, but the renderer drew an empty body. objectstack's served `sys_approval_request_detail` page uses a bare `record:details` for its Details tab, so that tab was empty for every approver; it now shows the request's target record (`record_id`), the one highlight field the page's strip leaves to the body.
  
  - The fallback list is the object's `highlightFields`, in declared order. It takes the same path an authored `fields` list takes: `enforceFieldSecurity` and `redactFields` apply, and a field already shown by a mounted `record:highlights` strip or as the page title is not repeated.
  - It runs only when the node authors neither key. An authored `sections` or `fields`, an empty one included, is the body exactly as before.
  - A list the field-security fold empties stays empty; nothing is derived in its place.
  - An object that declares no `highlightFields` still renders an empty body, as before: the spec names no further fallback.
- 3e2394d: Studio's page-create seed and slotted page preview now build an object's default record page with the same detail sections the running app uses. On an object that declares no `fieldGroups`, both used to produce a bare `record:details`, which draws only the object's `highlightFields` (or nothing), while the running app drew every visible field split into a primary section and a collapsible "More details" section. The seed persists those sections as field names, the shape `@objectstack/spec` declares. Objects that declare `fieldGroups` are unchanged. `resolveDetailSections`' doc no longer claims a bare `record:details` falls back to a flat layout of every field.
- 3eb3ec1: The console's list toolbar no longer has a write into the shared view, and the data-source method that write used is retired (objectui#12504).
  
  **BREAKING:** `DataSource.updateViewConfig` is removed from `@object-ui/types`, and `ObjectStackAdapter.updateViewConfig` is removed from `@object-ui/data-objectstack`. The capability gate that only that method read goes with it: `ObjectStackAdapter.setSystemCapabilities`, the `systemCapabilities` option of the adapter constructor and of `createObjectStackAdapter`, `VIEW_CONFIG_CAPABILITY`, `ViewConfigPermissionDeniedError` and `isViewConfigPermissionDeniedError`. A class that implements `DataSource` and keeps an `updateViewConfig` method still compiles, but nothing calls the method any more; an object literal annotated as `DataSource` that carries it is refused as an unknown property. Code that calls `updateViewConfig` through a `DataSource` or an `ObjectStackAdapter`, or imports one of the gate names, no longer compiles. To change a view for everyone, save the view: `createView` / `updateView` on the data source, or the console's view editor, which writes through the runtime metadata seam.
  
  Since objectui#12418 and objectui#12474, the toolbar's sort, column layout, density and Hide Fields are each user's own list state, so the toolbar write had no caller. The view editor's explicit save is now the one write path to the shared view, and it is unchanged.
  
  Personalization rows that earlier consoles wrote into `/meta/view` stay readable: the overlay marker, `narrowPersonalizationOverlay` and `listViews()` exclusion still apply to them. Nothing new writes such a row.
  
  `@object-ui/i18n` drops `console.objectView.viewConfigPermissionDenied` from all ten packs. It was the toast the retired write raised when the gate refused it. The other packages change only in comments and tests that named the retired path.
- 518a8e3: The record page's highlight strip no longer cuts a value without saying so, and at phone width it uses one layout (objectui#12523).
  
  - **A cut value ends in an ellipsis.** The email, URL and phone cells drew their text inside an `inline-flex` anchor. A host that clips to one line, such as a highlight chip, cut that text mid-word with no ellipsis: the cell was one atomic inline box, and a browser clips the first atomic inline on a line instead of ellipsing it. The three cells now follow the single-line convention the other cells in `@object-ui/fields` use. The cell is bounded by its host, and the box that holds the text truncates with an ellipsis. In the highlight strip the whole value is still the clip box's `title`. A host wider than the value shows no change.
  - **A phone declared through `format` gets the phone width.** A `text` field with `format: 'phone'` (or `email` / `url`) drew the phone cell on the narrow 9rem chip, so the HotCRM lead's phone read "+1-555-0" at 1440. The strip now sizes a chip by the cell it draws, so that phone gets the same 16rem floor as a `phone` field. When the floors no longer fit one line, the strip wraps before it cuts a value.
  - **A wrapped line starts flush.** From `sm` up, the first chip of every line now hides its separator and left padding, not only the strip's first chip. A second line no longer reads as an indented list.
  - **One layout below `sm`.** Every chip is a full-width line with no separator. Two chips no longer sit side by side above a single-column list.
- 165f8ff: Record page History: an entry with no actor at all (neither a resolved name nor a user id — a seed backfill or a hook with no user in context) now reads "System" with a cog glyph instead of "Unknown user" with a "?" avatar. The label is the existing `detail.systemActor` key that `record:activity` already uses, so it is translated in all ten locale packs. "Unknown user" (and the `unknownUserText` override) stays for the one case that is unknown: a user id that resolved to no name. The `record:history` self-fetch now carries each row's actor id through to the timeline so it can tell the two apart.
- 6f5dc6b: Record details: Enter on a link inside a read-only details row that offers copy now opens the link, instead of copying the row's value (objectui#12569).
  
  - **The defect.** A read-only details row that offers copy is a focusable button: Enter or Space on it copies the field's value. Its key handler cancelled Enter and Space and copied the value whatever the key was pressed on, so Enter on a link drawn inside the row (a lookup's link to the referenced record, or the links in the record card an approval request's Details tab draws for its target) copied the row's value and did not open the link.
  - **Now.** The row copies only for Enter or Space pressed on the row itself. A key pressed on a link, a button or anything else focusable inside the row is left to that element: a link opens, and the row's own copy button still copies through its click. Both row layouts (the default row and the phone layout's row) follow the same rule.
  - **Unchanged.** A mouse click on the row, or on a link inside it, behaves as before; Enter and Space on the row itself still copy; Escape still does nothing; rows that offer in-place editing still have no copy handler.
  
  **Clause-②: no.** No export, prop, type member or i18n key is added or removed.
- 4be76e0: Record page sections: a collapsible section's header is now a real button named by the section title (objectui#12625). It carries `aria-expanded`, is reachable by Tab, and Enter or Space toggles it; a click anywhere on the header still toggles as before. The per-field copy-value icon button is named "Copy to clipboard". A non-collapsible section's header is unchanged.
- e219a3d: Opening a record page sends one approvals read and one record read (objectui#12701).
  
  - **Approvals.** Every section of a record page that shows its approval state (the lock band, the decision actions, the approvals panel or an authored `record:approvals` block) now shares one `GET /api/v1/approvals/requests?object=…&recordId=…` read. A section that mounts later, such as a tab opened after the page loaded, reads nothing and shows the same answer. In development, where the console runs under React StrictMode, a record open used to send this read three times. A decision, or a saved edit, still re-reads it for every section. Opening the record again reads it again.
  - **The record.** The `record:details` body no longer reads its record a second time while the page's own read is in flight. It waits for the page's record, which already carries every relation the page expands, and shows its loading state until it arrives. `DetailView` takes a new `recordFromHost` prop for this. Without the prop, `DetailView` still reads its record itself.
  
  Every section shows what it showed before.
- 263e9dd: A record details section on a print page prints every field it declares, with no "Show N empty fields" button on paper (objectui#12717).
  
  On screen, a section that has some empty fields hides them and offers a "Show N empty fields" toggle. That density rule is the renderer's own, not something the page declares, and on a page that declares `print` it put the toggle on paper while the empty fields stayed off it. On a print page the rule is now off: every declared field prints, an empty one as its placeholder dash, and there is no toggle. A section authored with `hideEmpty: true` whose fields are all empty still prints nothing, as it declares. Off a print page nothing changes.
- 360e27a: The derived highlight strip on a record page no longer picks a field from a field group that declares a `visibleWhen` (objectui#12720).
  
  When an object declares no `highlightFields`, the record page picks its header chips heuristically, and that pick never read `fieldGroups`. A member of a gated group could therefore become a chip with its value on a record where the details body hides the whole group. The heuristic now skips every member of a group whose `visibleWhen` the details body evaluates, on every record: it runs from object metadata with no record in hand, so it does not evaluate the predicate, and the details body stays the one place that does. Where the group is shown, its members are drawn in the body, once, as before. The record preview card's key fields come from the same heuristic and skip those members too. A declared `highlightFields` list is unchanged, including an entry inside a gated group.
  
  Clause-②: no
- 464ae62: A collapsible record details section on a print page prints its header as a plain heading, with no disclosure chevron and no clickable-header chrome (objectui#12732).
  
  On a page that declares `print`, a collapsible section already draws open, but its header still drew the screen control: a toggle button, a chevron, and the pointer and hover styling of a clickable header. On a print page the section now renders the way a non-collapsible section does: the title, the icon, the header colour and the description, with the content always shown. Off a print page the collapsible header is unchanged.
  
  Clause-②: no
- 6367bfe: A record on a print page no longer prints its approval band: no "Recall approval" button, no approval status badge and no approval tally on paper (objectui#12751).
  
  On a page that declares `print`, a record in approval put the screen's approval band on paper: the recall button, the "In approval · editable" or "Locked for approval" badge, and the "Approvals — 0 of 1" tally. The button is a control. The badge and the tally are the approval's live state, which differs by viewer and changes with each decision, the same reason a print page refuses `record:approvals` and `record:approval_decision`. On a print page the band is now not drawn, and the record's fields print as before. A printed record that should state its approval status prints the record's own status field through `record:details`. Off a print page the band is unchanged.
  
  Clause-②: no
- 020d178: An inline edit of a `datetime` field on the record page keeps its time (objectui#12759). The record details section and the header highlights edited `date` and `datetime` fields with the browser's native date input, a day-only control. A `datetime` showed no time there, and an edit of the day saved local midnight of that day, dropping the time the record held.
  
  - **The platform date picker.** Both types now edit with the picker the record form, the action dialogs, the grid's inline cell editor and the kanban required-fields dialog draw (objectui#12622, objectui#12642, objectui#12664). Its placeholder and digit order follow the console locale, not the machine's.
  - **A `datetime` keeps its time.** The picker shows the date and the time. A day picked in its calendar keeps the value's time, and typed text carries the time typed. The value written is an ISO instant, as before. A record at 14:30 moved to another day saves that day at 14:30.
  - **A `date` field still writes `YYYY-MM-DD`** (objectui#12206), unchanged.
  - **A stored day that does not exist** (`2026-02-30`) still shows an empty, invalid box with a notice naming the stored value, and nothing is written until a day is entered (objectui#10625).
  - **Typed text is read when the box loses focus or on Enter.** Pressing Save moves focus to the button first, so the typed value is saved.
  - `@object-ui/fields`: a code comment only, on where the picker is drawn.
  
  Clause-②: no. No type member, prop, export or language-pack key is added or removed.
- 1aa622a: A declared action `icon` is now drawn beside the label on the row's inline primary button, the row "⋮" menu item and the record-header quick action (`record:quick_actions`). The name resolves through the shared icon seam (`resolveIcon` from `@object-ui/components`); an unknown name draws the label alone, and an action with no `icon` renders exactly as before.
- 6e4f144: A record on a print page prints its own title field (objectui#12787). Off a print page, `record:details` hides the row that the page header's H1 already shows: the declared name field, the field a `titleFormat` resolves to, or the first title candidate that has a value. A print page refuses `page:header`, so nothing on paper showed the title, and a printed invoice had no invoice number. On a page that declares `print`, `record:details` now prints every field it declares, the title field included. Off a print page nothing changes.
- 15b1065: A related list on a custom app page draws and runs its authored actions when its parent record is bound through `parentDataSource` (objectui#12870).
  
  Before this change, the page offered related lists no action handlers. A `record:related_list` bound to its parent through `parentDataSource` drew its rows, but none of the toolbar or row actions authored in its `actions`, and nothing on the page said why.
  
  - **The page now serves the record page's executor.** The page mounts the record page's related-list bridge inside its own action runtime. A list that resolved its parent gets that bridge's toolbar and row executors, so its authored actions draw and run as they do on a record page. Its `record_related` row actions are placed too, because the list sits inside its bound parent record.
  - **Only the executors are served.** A page list that authors no `actions` is unchanged: it shows no New, Edit or Delete, no row click and no default actions. The record page's related lists are unchanged.
  - **Actions that cannot run are named.** When a list authors actions that no executor can run, it shows a notice next to the existing refusal notice and names each action. For example, a page list without `parentDataSource` has no parent record to run them against. The notice has the same audience as the refusal notice: dev builds, and viewers who can edit metadata.
  
  No export, prop, type member or language-pack key is added to either package entry.
- 1e6d83b: Data-bound blocks title their "data source could not be resolved" panel in the page's language (objectui#12920, the family of objectui#12910). The panel shows when a block's `dataSource.view` names a view its object does not have. Each block's title now reads `@object-ui/i18n` through `useObjectTranslation`, with the `en` pack's value as the inline default, so a page with no `I18nProvider` draws the same English it drew before.
  
  - **Plugin blocks.** `object-calendar`, `object-chart`, `object-metric`, `object-pivot`, `detail-view`, `record:related_list`, `object-form`, `embeddable-form`, `object-master-detail-form`, `record:line_items`, `object-gantt`, `object-grid`, `object-kanban`, `list-view`, `object-map` and `object-timeline` read one `element.KIND.sourceUnresolved` key per block kind. `object-metric` reads `element.number.sourceUnresolved`, the key `element:number` already reads for the same sentence. The three forms share `element.form.sourceUnresolved`. `record:related_list`'s panel for a failed `parentDataSource` read reads `element.relatedList.parentUnreadable` ("This related list’s parent record could not be read").
  - **`@object-ui/react` panel defaults.** `ElementDataSourceErrorPanel` with no `title` reads `element.component.sourceUnresolved`, and `NoDataSourcePanel` with no `title` reads `element.component.noDataSource`. A passed `title` still wins, an empty string included. Props and markup do not change.
  
  Clause-②: yes
  
  The new keys in `@object-ui/i18n` widen its exported `TranslationKeys`. No prop, input or export of these packages changes.
- 79cb8c0: `record:details` draws a boolean the viewer cannot edit as the locale's word for its value (`common.yes` / `common.no`) instead of a disabled checkbox that read as a setting refusing the click (objectui#12933). An editable boolean keeps its checkbox, and a value that is not a boolean still draws the shared "No value" affordance.
- 03f1d65: `@object-ui/plugin-detail` now declares `@objectstack/spec` `^18.0.0-next.3`, up from `^18.0.0-next.1` (objectui#12946).
  
  Clause-②: no
  
  Since objectui#12922 the published `dist/synth/buildDefaultPageSchema.d.ts` imports the type `SelectOptionKind` from `@objectstack/spec/data`. `18.0.0-next.3` is the first release that exports it; the `18.0.0-next.1` and `18.0.0-next.2` tarballs do not. The old range admitted both, so a consumer that resolved either got a type declaration that names an export its spec lacks. The range is the claim a package makes about what it works against, and it now admits only specs that carry the symbol.
  
  A consumer whose `@objectstack/spec` resolves to `18.0.0-next.1` or `18.0.0-next.2` moves it to `18.0.0-next.3` or later. An install that resolves the newest `next` is unaffected.
  
  This package is one of the two exceptions the `18.0.0-next.3` note names to its statement that every package keeps its `@objectstack/*` range; the other is `@object-ui/app-shell` (objectui#12943). No export, prop, key or schema of the package changes, and this change moves no other package's range.
- bcd9717: `record:quick_actions` maps an action's spec `variant` onto the `Button` vocabulary the way the record header and the row menu do: `danger` draws the destructive style and `primary` the default (filled) style, while `secondary`, `ghost` and `link` pass through. The block's own `variant` stays the fallback for an action that declares none (objectui#12986).
- 1d3da6c: `record:quick_actions` no longer shows its authoring placeholder ("record:quick_actions — no actions configured") to a viewer whose named actions are all withheld. A block that names actions but resolves to none (every action withheld by `requiredPermissions`, hidden by `visible`, at another location, or with no record to run against) now draws nothing, as the record header and the row menu do. A block that names no action keeps the placeholder on a design / preview surface (`PreviewModeProvider`) only and draws nothing in a runtime view. A refused action array still names the refusal on the surface.
- 0d97642: `record:quick_actions`: a refused declared action array (a mixed id/object array) no longer draws its "refused at index N (see console)" box in a runtime view. That box is developer copy, so it is drawn on a design / preview surface only, the same rule the block's "no actions configured" placeholder follows. The console error naming the offending index still fires in every view (objectui#13000).
- d0b9648: A record page that shows the same unfiltered related list both as a `record:reference_rail` card and in a `page:tabs` count badge now reads that list once on open, not twice. The rail claims its rows in `RelatedCountStore` while it renders; the badge's probe then asks for the card's rows with its count, and the card takes them. If the rail reads first, the badge joins that read. A badge with its own declared filter still sends its own probe. A rail alone on the page still reads only when it comes into view, and a refresh still reads the rail again.
  
  `RelatedCountStore`, exported from `@object-ui/components`, gains three members:
  
  - `RelatedCountStore.claimRows(objectName, relationshipField, parentId, limit)` declares that a card will list the first `limit` rows of that unfiltered related list, so a count probe of the same list fetches those rows with its count; it reads nothing itself.
  - `RelatedCountStore.fetchRows(finder, objectName, relationshipField, parentId, limit, fields?)` resolves to `{ total, rows }` for that list, taking rows a probe already holds for the claim (once only), joining a read in flight, or reading itself; it rejects when the read fails.
  - `RelatedCountStore.releaseRows(objectName, relationshipField, parentId)` withdraws the claim when the card unmounts or moves to a new scope, dropping any rows still held for it; held rows are also dropped when the child object is invalidated.
- 50ba1bb: A record page no longer asks `POST /api/v1/security/explain` for a verdict nothing on screen uses (objectui#13045).
  
  - **Record page header.** When the object's `userActions.edit` is the static `false`, the page does not ask the `update` verdict; `userActions.delete: false` likewise skips the `delete` verdict. Edit and Delete were already hidden by that `false`. A per-record predicate form, `true`, or an absent entry still asks, and Edit and Delete still follow the answer.
  - **`DetailView`.** The record-level verdicts are asked only for a button the host shows: the `update` verdict when `showEdit` is set, the `delete` verdict when `showDelete` is set. The console record page's `record:details` body shows neither, so it no longer asks. A standalone `DetailView` with `showEdit` / `showDelete` asks as before, and its buttons follow the verdict.
  
  On an object such as cloud's `sys_environment` (`userActions: { edit: false, delete: false }`), opening a record now sends no `security/explain` request. No export, prop or type member is added.
- fb85637: A field group whose `visibleWhen` cannot be evaluated is now hidden, header and members, on the form and on the record detail page (objectui#13055).
  
  `@objectstack/spec` declares `ObjectFieldGroupSchema.visibleWhen` fail-closed: "the whole group (header included) is shown only when TRUE, else hidden (fail-closed)". Until now both surfaces failed open. A group whose predicate had a parse error, named an unknown field or root, or failed to evaluate was drawn in full, with only a console warning.
  
  - **Form.** Every layout now hides the group: simple, tabbed, split, drawer, modal, and the console's form page. This holds whether the group comes from the object's `fieldGroups` fallback or from a `{ group }` section reference. Members of a group hidden this way behave as they do under a FALSE predicate: their values still submit and their client-side validation is skipped.
  - **Record detail page.** `record:details` hides the group's section.
  - **Diagnostic.** The one-time warning still fires, and now names the default taken: `safe default (false)` and "the group is hidden".
  - **What stays fail-open.** An authored form-view section's own `visibleWhen` still faults open, as `FormSectionSchema.visibleWhen` declares. So do a field's own `visibleWhen`, `readonlyWhen` and `requiredWhen` (ADR-0137 D3), and every other predicate slot. A well-formed predicate gates exactly as before.
  
  How the direction reaches the renderer: a form-view section's predicate and a field group's predicate arrive at the form renderer in the same slot, a `section-divider` row's (or a tab's) `visibleWhen`. So the direction travels with the predicate. `@object-ui/types` declares one runtime hand-off key, `visibleWhenFault?: 'hidden' | 'shown'`, on `ObjectFormSection`, `FormField` (`section-divider` rows only) and `FormFieldTab`, and mirrors it on the zod faces. `deriveFieldGroupSections` stamps `'hidden'` beside a group's predicate. Every layout carries it next to `visibleWhen`, and the form renderer reads it as the fault fallback. Absent means today's fail-open. It is not an authoring key: the spec's strict `FormSectionSchema` refuses it in authored metadata.
- 4c68855: `record:details` no longer draws a record pointer's type half as its own row (objectui#13102).
  
  An object can declare a polymorphic record pointer as a pair: the id half (for example `record_id`) names its sibling with `referenceVia` (for example `object_name`), and the sibling holds the target object's machine name. The Details body draws the id half as the record card, which names the target object by its label. The type half also drew as a row of its own, so the page showed the stored machine name next to the label that names the same object. This affected the record pages of objects such as `sys_record_share`, `sys_share_link`, `sys_audit_log` and the approval objects.
  
  The type half now leaves the body when its id half is drawn in the same body. The pair is read from the object's declared fields only, never from a field's name. A type half whose id half the body does not draw keeps its row. The record still carries the value, so the card still resolves the pair. An object that declares no pair draws exactly what it drew before.
  
  Nothing is added to the package entry: no export, prop or key.
- daeb77f: A new record page seeded in Studio is saved with the `default` layout template instead of `full-width`, and the page node's `template` member is typed by reference to the spec's (part of objectstack#23610).
  
  `@objectstack/spec` closes `PageSchema.template` to four layout names — `default`, `header-sidebar-main`, `three-column`, `dashboard` — and retires `full-width` by name, naming `default` as its replacement; the save path refuses a page that still carries it.
  
  - **`buildDefaultPageSchema` seeds `template: 'default'`.** Studio's "new record page" seed takes its template from this synthesis, so with the old value the first save of a new record page was refused. `full-width` and `default` were drawn by the same renderer component, which `default` still names, so a seeded page lays out exactly as before.
  - **`PageNodeSchema.template` is `SpecPage['template']`.** The member was re-declared as `string` over the spec's inherited one; once the spec closes the set, that widening is a TypeScript error (TS2430) on the interface. Against today's spec, whose member is still `string`, the type is unchanged.
  - **The zod mirror's `template` is the spec's member too.** `PageNodeSchema` in the zod face declared `template: z.string()`, which accepts every name; once the spec closes the set it measures wider than the TS face, so `full-width` would still pass `objectui validate`. It now takes the spec's own member (defaults stripped, as for every imported member), and against today's spec it accepts exactly what it accepted before.
  
  A page already stored with `full-width` keeps rendering because the platform rewrites it to `default` on read (the spec's conversion `page-template-full-width-to-default`). The renderer itself no longer recognises `full-width` (objectui#12476).
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

## 17.7.0

### Minor Changes

- 879ecac: feat(plugin-detail): row caps on `record:activity`, `record:history`, `record:chatter` and `record:discussion` admit only a positive integer number, and a refused one warns
  
  `@objectstack/spec` declares `limit` on `RecordActivityProps` (which is also
  `RecordChatterProps.feed`) and on `RecordHistoryProps` as
  `z.number().int().positive()`, and refuses a string, a boolean or an array
  outright. The renderers used to run `Number(value)` before their integer check,
  so they also read `'5'` as 5, `' 5 '` as 5, `'0x10'` as 16, `true` as 1 and `[7]`
  as 7: a second accepted set, wider than the contract (objectui#10145, ruled
  STOP).
  
  Both resolvers (`normalizeLimit`, shared by activity, chatter and discussion,
  and `normalizeHistoryLimit`) now admit only a value whose type is `number` and
  which is a positive integer. Every other authored value falls back to the
  block's default (20 for activity, chatter and discussion; 50 for history). The
  renderer then logs one `console.warn` that names the block and spells the raw
  value with its type (for example `declared limit: "5" (string)`). The warning
  also fires for the fractional, zero, negative, `NaN` and infinite values these
  blocks already refused silently. That matches the "always warn" ruling on
  objectui#10097 and the three objectui#9925 read points. An absent `limit` is not
  a refusal and stays silent.
  
  **Migration.** Stored metadata that spells a row cap as a string (for example
  `limit: '5'`, or `feed: { limit: '5' }` on a chatter or discussion block) now
  drops to the block's default and warns in the console, where it used to be read
  as 5. Write the number instead (`limit: 5`). Publishing such metadata was
  already refused by the spec, so this affects only bodies stored before that
  check, or written around it.
- 9cbe4db: An authored `detail-section` node now takes `hideEmpty`, and it reaches the section.
  
  `DetailSection` hides a section whose fields are all empty when
  `section.hideEmpty` is `true`, but the `detail-section` registration did not
  declare `hideEmpty` among its `inputs`, and the node adapter folds only declared
  names into the section it hands the component. So an author who wrote
  `hideEmpty` on the node was warned `unknown-prop "hideEmpty"` by the JSX-page
  compiler's validator — which judges an authored page against these same
  `inputs` — and an all-empty section still drew its heading and skeleton.
  
  The registration now declares `{ name: 'hideEmpty', type: 'boolean' }`, and the
  adapter folds it like the other declared inputs. On this node, `true` hides an
  all-empty section (no heading, no skeleton); omitted or `false`, the section
  keeps its heading and label skeleton — the behaviour an unauthored node already
  had, now stated in the input's description rather than changed. A non-boolean
  `hideEmpty` now draws `type-mismatch` instead of `unknown-prop`.
  
  The omitted default is the node's own. `record:details` still resolves an
  omitted `hideEmpty` to `true` on its own authored sections, which never pass
  through this node; `detail-view` sections, like this node, apply no default.
  What `true` and `false` mean is the same on all three.
  
  **Clause-②: yes** — the authoring surface of `detail-section` widens by one
  key, `hideEmpty`, which the renderer already honoured. No other key's verdict
  moves at this change: `name`, which the block neither declares nor reads, still
  draws `unknown-prop`. No exported symbol is added, removed, renamed or retyped — the
  package entry re-exports neither `DetailSectionNode` nor
  `DETAIL_SECTION_NODE_INPUTS`. The tag is outside the public block tier, so the
  generated `sdui.manifest.json` and `sdui-intrinsics.d.ts` never carried it and
  do not change.
  
  ⚠️ **Dated note, 2026-09-29 — `name` no longer draws `unknown-prop` on this node —
  objectui#11044.** Later in this same release, `name` becomes a `where-undeclared`
  base prop of the JSX-page compiler's validator: a base prop on every type that
  declares no input of that name. `detail-section` declares none, so an authored
  `name` on it now draws nothing, although the block still does not read it. The
  sentence above is kept as the reading of this change; the objectui#11044 entry
  states what ships.
- 37140f4: refactor(plugin-detail)!: retire the `related-list` node type key; the related-list block is `record:related_list` (objectui#10859, batch 8 phase 2b)
  
  **BREAKING (authoring):** the plugin no longer registers `related-list` (and with it `plugin-detail:related-list`). `objectui validate` refused a `related-list` node at `type`, nothing in this repository, its examples or objectstack authored it, and its declared `type` input collided with the node discriminator. A node authored `type: "related-list"` now renders the "Unknown component type" panel. `RelatedList` stays a named export.
  
  Migration:
  
  - `{ "type": "related-list", … }` → `{ "type": "record:related_list", "properties": { … } }`, the armed block this plugin registers, or mount `RelatedList` directly.
  
  **Clause-②: yes** — a registration leaves the runtime (narrowing), released as `minor` with this banner.
- 27ae632: A `record:path` whose stage labels are per-locale maps now shows the viewer's language instead of failing to render, and five label inputs on `object-metric`, `object-grid` and `record:related_list` now accept the per-locale map their renderers already resolve (objectui#10993, batch 2).
  
  **`record:path`, `stages[].label`.** `@objectstack/spec` types each stage's `label` as `I18nLabel`: a plain string or an inline per-locale map such as `{ en: 'Draft', 'zh-CN': '草稿' }`. `RecordPathRenderer` read it raw, as the stage's visible text and inside the stage's accessible name, so a map threw "Objects are not valid as a React child" and the node rendered `Component "record:path" failed to render` instead of the path. It now resolves each map with `pickLocalized` against the active UI language (`useObjectTranslation().language`) before the stages are translated, classified or drawn:
  
  - Both rows (desktop and mobile) paint the entry for the viewer's language, and each stage's accessible name carries the same text beside its state words, in one language.
  - A stage with no `terminal` is still classified from its label: a lost stage whose label is a map (for example `{ en: 'Closed Lost', 'zh-CN': '丢单' }`) still reads as lost.
  - A plain string renders exactly as authored. A picklist translation of the status field still outranks the authored label, as it did for a string.
  
  **The registry inputs.** These inputs declared `type: 'string'` only, while their renderers already resolve a per-locale map, so the manifest built from `ComponentRegistry.getPublicConfigs()` made `validateTree` report `type-mismatch` on a map the spec accepts. Each now declares both arms, `type: ['string', 'object']`, with a description that teaches the map:
  
  - `@object-ui/plugin-dashboard`: `object-metric`'s `label` (the tile heading), `description` (the sub-caption under the value) and `title` (the drill-down panel heading), resolved against the active UI language.
  - `@object-ui/plugin-grid`: `object-grid`'s `label` (the table caption, the export title and the record-detail overlay heading), resolved against the display locale: the workspace's regional default when one is configured, otherwise the active UI language. `view:grid` registers the same inputs, so its declared `label` carries the same two arms.
  - `@object-ui/plugin-detail`: `record:related_list`'s `title` (the list heading), resolved against the active UI language.
  
  A value that matches neither arm, such as a number, is still reported. No renderer changes for these five: each already resolved the map.
  
  **Clause-②: yes** — five published registry inputs widen from `'string'` to `['string', 'object']`, so `validateTree` accepts a locale map on them (and `view:grid`'s `label`, which shares `object-grid`'s inputs, declares the same arms). Nothing that was accepted before is refused now.
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
- f4ed238: `record:related_list` now renders the actions its `actions` key names (objectui#11163; ENFORCE ruling on objectstack#20665).
  
  The contract has declared `actions` ("Action IDs available for related records") on this block, and the registration has published it, but no renderer read it: a related list always drew the host's actions for its child object, whatever the page said. The key is read now, and it composes with the host like this:
  
  - **Absent** — unchanged. The host bridge's actions render as before: the child object's `list_toolbar` actions as header buttons and its `list_item` actions in each row's menu. No extra metadata request is made.
  - **Authored** — the authored list is what renders, in authored order. Each id is the `name` of an action on the related object's own `actions`, resolved through the same metadata lookup `record:quick_actions.actionNames` uses, and placed by that action's own `locations` (`list_toolbar` → header button, `list_item` → row menu). The host still runs it.
  - **`[]`** — no actions. The built-in New / Edit / Delete / View affordances are not action ids and are unaffected.
  - **Refused** — an id that names no action of the related object, one whose action declares neither `list_toolbar` nor `list_item`, and an array that is not all action ids are named in a `role="status"` notice on the list instead of being dropped. The entries that do resolve still render.
  
  ⚠️ Behaviour change for pages that already author `actions` on a related list: those lists used to ignore the key and now show exactly the named actions.
- 1263e40: fix(app-shell,plugin-detail): the record feed says "no permission" when its read is refused, instead of showing an empty list
  
  This widens two published surfaces: `@object-ui/plugin-detail` gains the export `isRefusedFeedRead`, and `@object-ui/react`'s `DiscussionContextValue` gains the optional members `activityDenied` and `commentsDenied` (as do `RecordActivityTimelineProps` and `RecordChatterPanelProps`).
  
  When the server refused a record's activity read (401, 403, or a permission
  envelope), the record page's discussion panel and the `record:activity` block
  rendered the empty state: "No comments yet" or "No activity recorded". A member
  who was not allowed to see the activity could not tell that apart from a record
  with no history. Every failed feed read ended in a catch that treated it as an
  empty answer.
  
  Each feed read now keeps its verdict. A refused read shows a localized
  no-permission state in place of the empty state: a lock and "You don't have
  permission to view activity on this record." When the other read did answer, its
  rows stay on screen and the notice above them names the half that was withheld.
  A refused `sys_comment` read shows "You don't have permission to view comments on
  this record." in the same way.
  
  - **What counts as refused** is one verdict, `isRefusedFeedRead`, exported from
    `@object-ui/plugin-detail`. Both surfaces use it. It is the `forbidden` and
    `unauthorized` kinds of the existing `classifyLoadError` read classifier, and
    it reads no status of its own.
  - **Unchanged:** a read that answers with zero rows, a 404 (`sys_activity` on a
    deployment without the audit plugin), and any other failure such as a 500 keep
    the empty state. The panel has no error state of its own.
  - **Not retried:** a refusal is recorded and shown; the read is not re-issued.
  - `DiscussionContext` (`@object-ui/react`) gains two optional members,
    `activityDenied` and `commentsDenied`, which the host that owns the fetch
    sets. `RecordActivityTimeline` and `RecordChatterPanel` take the same two
    optional props.
  - Two new `detail.*` strings, `activityAccessDenied` and `commentsAccessDenied`,
    are translated in all ten locale packs.
- 8bab157: fix: an action gated on `current_user.can(object, verb)` stays hidden until the permissions payload has loaded on every action `visible` surface, a `page:header` action gated through `disabled` stays disabled, and `record:quick_actions` can answer `current_user` at all
  
  An action whose `visible` asks `current_user.can(...)` has no answer until the signed-in
  user's permissions have loaded. On `action:group` (both display modes, and the group's own
  `visible`), `action:icon` and a related list's toolbar, that unanswerable gate used to
  SHOW the action, so a button meant for permission holders flashed up for everyone while
  the page loaded, and stayed up where the permissions never load (the `/forms/:name` route,
  a standalone embed). These renderers now treat a `visible` predicate that cannot be
  evaluated the way `action:button` and `action:menu` already did: the action is hidden and
  the console names it once. This is the rule for the key, not a special case for `can`: a
  `visible` that faults for any other reason (a misspelled root such as `nope.x == 1`) is
  hidden too, where it used to be shown.
  
  On `page:header`, a `disabled` predicate that cannot be evaluated now renders the button
  DISABLED instead of enabled, so `disabled: "!current_user.can('account', 'delete')"`
  shows a greyed-out button until the answer arrives. This also applies to a `disabled`
  predicate that faults for another reason. A header action's `visible` and `hidden`
  predicates keep their fail directions.
  
  `record:quick_actions` filters its actions against the action runner's context, which
  held the host's `user` but never `current_user`, so `current_user.can(...)` and every
  other `current_user.*` gate there hid the action for everyone, the users who hold the
  permission included. `useActionEngine` (`@object-ui/react`) now binds the signed-in user
  from the surrounding `ExpressionProvider` as `current_user`, so a quick action is shown
  to users who hold the permission and hidden from those who don't, and while the
  permissions are loading.
- a8b9889: A related list inside a record now places its child object's `record_related` actions on each row (objectui#11270; the renderer half of the enforce answer on objectstack-ai/objectstack#20937).
  
  The spec declares the action location `record_related` ("actions on a related list section inside a record"), and nothing in objectui read it, so an action placed only there rendered nowhere. Triage read the location as row placement, scoped to a parent record: `list_item` shows on the child's rows wherever the child is listed, and `record_related` shows on them only in a related list inside a parent record.
  
  - **The host bridge** (`RelatedRecordActionsBridge`, `@object-ui/app-shell`) puts the child object's `record_related` actions in each row's action menu beside its `list_item` actions, in the child's declared order, when a parent record is in scope. An action that declares both renders once. The child object's own list view still reads `list_item` only, so a `record_related`-only action does not appear there.
  - **The authored `actions` channel** on `record:related_list` (`@object-ui/plugin-detail`) accepts an id whose action declares `record_related` and places it in each row's menu. The refusal notice for an id that cannot be placed now names the three related-list locations: `list_toolbar`, `list_item` and `record_related`.
  - **The action designer's preview** (`@object-ui/app-shell`) draws a `record_related` action on the rows of a list, with the frame `list_item` uses. It used to draw it as a button in a section header, which is not where the console places it. `record_section` keeps its section-header frame.
  - `@object-ui/react`: the `RelatedRecordHandlers.rowActions` doc comment names both row locations. No code change.
  
  ⚠️ Behaviour change: a child action that declares `record_related` now shows on its related-list rows inside a record, where it used to show nowhere.
- d796c8d: Auto-derived related lists consume the field-level `relatedListFilter`
  declaration — the list query AND-composed, the tab badge counting the same set
  (objectui#4664).
  
  A `lookup` / `master_detail` field may now declare `relatedListFilter`, a
  canonical Query-DSL `FilterCondition` such as `{ status: { $ne: 'deleted' } }`
  (`@objectstack/spec` 17.1.0 — objectstack#8704 / PR #8955). Until now this repo
  accepted that key at every gate and consumed it nowhere: a record page's derived
  related lists answered wider than the metadata asked, and the driving scenario —
  soft-deleted child rows on auto-derived record pages — had no way to be
  expressed at all.
  
  ⚠️ **Dated note, 2026-09-29 — the pull request beside objectstack#8704 is objectstack's — objectui#11016.** The spec key's
  pull request is named above by a bare number, which in this repository resolves
  to an unrelated objectui pull request. It is objectstack-ai/objectstack#8955, the
  spec change that declared the field-level `relatedListFilter`. The text above is kept as the reading of this change.
  
  What ships:
  
  - `deriveRelatedLists` reads the key off the FK and carries it on the derived
    descriptor; `RecordDetailView` forwards it into the page synthesizer, which
    emits it onto the `record:related_list` node's **existing** `filter` key. That
    key already had a read site (objectstack#7118): `RelatedList` ANDs it with
    `{ [referenceField]: parentId }`. The declared filter is therefore an authored
    constraint that may only NARROW this parent's children — never a replacement,
    which would leak other parents' rows — and no second filter dialect appears
    for derived pages.
  - The **tab badge honours the same composed filter**. `page:tabs` reads the
    `filter` off the `record:related_list` node it is badging and the count store
    composes it with the parent scope through the same `mergeFilterNodes` sink the
    row query uses, so the badge and the rows send one `$filter`. Badge-count
    parity is normative in the spec key's own contract text; without this half the
    feature would ship the defect it exists to prevent — a badge saying 7 above a
    list showing 3.
  - Counts cache per (object, relationship, parent, **scope**), so a filtered and
    an unfiltered probe over the same relationship are separate entries rather
    than one wrong number.
  
  With no `relatedListFilter` declared, the synthesized node, the row query and
  the badge probe are byte-identical to before. Consumption only — this change
  adds no authoring UI for the filter.
- 6d63cd0: An auto-derived related list now orders its rows by the CHILD object's default list view
  `sort`, instead of falling to the server's primary-key order (objectui#5795). A task
  version's "check items" tab whose child object declares `sort: [{ field: 'seq_no' }]`
  renders 10/20/30/40; before this it rendered whatever order the ids happened to give —
  20/30/10/40 in the reported case — while the child object's own list page obeyed the
  declaration.
  
  **Declared as user-visible, deliberately, even though no key was added.** The contract
  question ("where does a derived related list's sort declaration live?") was ruled on
  objectstack#11345 (maintainer, 2026-08-23) as **direction 1**: inherit the child's list
  view sort, and add **no** new spec key — the field-level `relatedListSort` the issue also
  proposed was explicitly not approved. So there is nothing new to author, and
  `record:related_list.sort` was already declared, parsed and consumed; this fills it. What a
  host observes is nonetheless new: a derived related-list descriptor gains a populated
  `sort` where it had none, and the query it issues gains an `$orderby`. An app whose child
  objects declare a default list order will see those tabs re-order on upgrade — which is the
  point of the change, and is why this is not a patch.
  
  Nothing is inherited where nothing was declared: a child object with no default list-view
  sort produces the same descriptor, the same node and the same `$orderby`-free query as
  before.
  
  The two `sort` surfaces declare the same union and mean different things by its string arm
  — a `ListView` string is the legacy space-separated `'seq_no desc'`, while the related
  list's own reader takes `'field'` / `'-field'` — so the inherited value is normalized to
  the array arm once, at the derivation, through `@object-ui/core`'s
  `convertSortToQueryParams` (the repo's single definition of both authored dialects). An
  un-normalized inherit would have ordered by a field literally named `seq_no desc`.
  
  Known and unchanged: `$orderby` is only assembled while the related list is in windowed
  (server-paged) mode, so a declared *or* inherited sort still disappears while the built-in
  client text filter is active. That hole pre-dates this change and affects the authored prop
  identically; it is now pinned as a recorded fact in
  `plugin-detail/src/__tests__/RelatedList.sortDroppedOutsideWindowed.test.tsx` rather than
  fixed here.
- 4da5109: One `sys_activity` row → `FeedItem` constructor, and the console record page
  stops dropping author-extended activity types in silence (objectui#5896).
  
  **The defect.** `RecordDetailView`'s `sys_activity` merge read the shared type
  table (objectui#5878) and then built the `FeedItem` itself, ending in
  `if (!feedType) continue;`. That one `continue` collapsed two different
  situations: a type the table maps to `undefined` **on purpose** (`commented` /
  `mentioned` / `login` / `logout`), and a type the table has never heard of. The
  second is an **author-extended** value — `sys_activity.type` is
  author-extensible (objectstack `88b9d749a`, direction 4, ruled 2026-08-24), every
  column on that table is `readonly` so objectql never validates a write, and
  ADR-0052 §5b.2 forwards an author's `activityMilestones[].type` into it
  verbatim. So an activity that happened, was written and is queryable had no row
  on the console record page: no placeholder, no empty state, no console message.
  Stored, queryable, invisible — objectui#5840's failure mode reached by another
  route, and one objectui#5969 (PR #6112) had already removed from the block
  side, leaving the two surfaces disagreeing about the same row of the same table.
  
  **The fix is convergence, not a second decision.** `@object-ui/plugin-detail`
  now exports the whole reading — `activityRowToFeedItem`,
  `UNMAPPED_ACTIVITY_FEED_TYPE` and the `resetUnknownActivityTypeWarnings` test
  seam alongside `ACTIVITY_TYPE_TO_FEED_TYPE` — and `RecordDetailView` calls the
  constructor instead of paraphrasing it. Publishing the table alone had left the
  mirror one level up, and it had already drifted three ways: the silent drop, a
  timestamp fallback that could leave `createdAt` `undefined` where the helper
  yields `''`, and a second hand-written system-actor lookup.
  
  **Behaviour change on the console record page** (breaking in the objectui sense,
  shipped `minor` — objectui's `major` tracks `@objectstack`):
  
  - an unmapped `sys_activity.type` now **renders** through the generic
    `UNMAPPED_ACTIVITY_FEED_TYPE` (`'system'`) presentation instead of vanishing,
    and is announced once per distinct value on `console.warn` — a **missing
    decision**, not lost data: the row is visible, what it lacks is its own icon
    and colour. `FeedItemType` is a closed spec enum, so minting a kind for "we
    don't know" would be a platform change, not this surface's.
  - `createdAt` is always a string for a row with neither a usable `timestamp`
    nor a `created_at`.
  
  **Unchanged, deliberately:** the four exclusions still produce no row and no
  warning. They are decisions — comment content lives in `sys_comment`, and
  login/logout are account events rather than record activity — and a warning
  about a decision teaches authors to ignore the channel.
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
- 1e7fe0a: `record:details` section headings converge on the declared `label` slot; the
  `title` alias limb is gone (objectui#6190, maintainer ruling 2026-08-31 —
  option A, three producers plus the consumer in one change).
  
  **Breaking for anyone reading `deriveFieldGroupDetailSections`' output — the
  emitted key moves from `title` to `label`.** That function is public API
  (exported from `@object-ui/plugin-detail`), so this is an output-shape change,
  not an internal refactor. A caller that reads `section.title` off its return
  value reads `undefined` after this release and must read `section.label`.
  `BuildPageOptions.sections` and `ObjectDefLike.sections` declare the same move,
  so a caller passing `sections` into `buildDefaultPageSchema` supplies the
  heading as `label` too.
  
  **The retired authoring spelling is `title` on a `record:details` section.**
  `RecordDetailsRenderer` read `s.title ?? s.label` — a strict-priority second
  spelling of one slot, with byte-identical localization on both limbs, so a
  producer emitting both silently disagreed with itself and `title` won. It now
  reads `label` only. Nothing an author could publish is affected: `@objectstack/spec`
  REFUSES `title` inside a `sections[]` entry (`unrecognized_keys`, pinned by
  objectstack#11902), and `@object-ui/types` plus the authoring inspector have only
  ever declared `name` / `label` / `columns` / `fields`. The declared and authoring
  faces were already converged; only three runtime producers lagged, and all three
  move here:
  
  - `buildDefaultPageSchema`'s `deriveFieldGroupDetailSections` section literal;
  - `RecordDetailView`'s re-map of that output through the per-object i18n
    convention;
  - `RecordDetailView`'s auto-grouped "More details" section, authored in
    app-shell and unreachable from the synthesizer.
  
  **No rendered heading changes.** Every existing producer yields byte-identical
  headings, asserted by rendering rather than by inspection — including the
  "More details" bucket, which the earlier two-step scope would have degraded to
  the literal `details` in every shipped locale while every existing guard stayed
  green. A new pin (`RecordDetailView.sectionHeadingsRenderPath-6190.test.tsx`)
  walks the tree app-shell actually renders and closes that blind spot.
- 3777538: `isConcurrentUpdateError` no longer promises a `code` its runtime check
  knowingly accepts values without.
  
  The exported predicate matches on two limbs — `code === 'CONCURRENT_UPDATE'`
  (the wire shape) **or** `name === 'ConcurrentUpdateError'` (the deliberate
  cross-realm discriminator, for a host that bundles the adapter twice so
  `instanceof` fails). Its narrowed type declared `code: 'CONCURRENT_UPDATE'` as
  a **required** literal, so for exactly the case the second limb exists to serve
  the predicate handed the caller a property the value does not have. `code` is
  now declared optional (`code?: 'CONCURRENT_UPDATE'`), stating only what both
  limbs guarantee.
  
  **Type-level only; zero runtime change.** The two-limb check is byte-identical
  — it is deliberate and documented, and the diff touches nothing but the return
  type and the comment above it. There was no runtime symptom to fix: the only
  consumer (`InlineEditSaveBar`'s conflict builder) reads just the optional
  `currentVersion` / `currentRecord` fields.
  
  **Breaking for TypeScript consumers that read the narrowed `code`.** After
  narrowing, `err.code` is now `'CONCURRENT_UPDATE' | undefined` instead of
  `'CONCURRENT_UPDATE'`, so code that assigned it to a non-optional `string` will
  newly fail to compile. That failure is the point: on a name-only error the
  value was already `undefined` at runtime, and the old declaration was the
  reason the compiler could not say so. Guard the read (`err.code ===
  'CONCURRENT_UPDATE'` still narrows fine) or branch on the predicate itself
  rather than on the field.
  
  Pinned by `ConcurrentUpdateDialog.narrowedCode-6421.test.tsx`, which asserts
  the invariant by assignability — the value the runtime accepts through the
  `name` limb must be assignable to the type the predicate returns — alongside
  runtime coverage of both limbs, which `plugin-detail` had none of.
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
- 9409eb9: `RecordDetailDrawer` resolves a relationship target only from the two spellings
  a contract carries, dropping the two no contract declares (objectui#6837, first
  slice).
  
  The chain was `def.reference_to ?? def.reference ?? def.referenceTo ??
  def.target`; it is now `def.reference_to ?? def.reference`.
  
  **Accept-set move — a def carrying ONLY `referenceTo`, or ONLY `target`, stops
  resolving a target** and the field renders without one (the drawer already marks
  every reference-bearing field readonly, so nothing becomes editable that was
  not). Two things bound that:
  
  - Any def that entered through the ingestion choke point is unaffected.
    `normalizeSchemaReferenceKeys` reads `reference_to ?? reference ??
    referenceTo` and stamps both snake_case keys, so a `referenceTo`-only def
    arriving via `MetadataProvider` or `ObjectStackAdapter.getObjectSchema`
    already carries `reference_to` before the drawer sees it. Only a def that
    bypassed that door entirely is affected.
  - `target` was never read anywhere else in the stack — not by the normalizer,
    not by the spec. `@objectstack/spec`'s `FieldSchema` refuses both deleted
    spellings by name with `unrecognized_keys`, each carrying its own "did you
    mean `reference`" rename, and `referenceTo` is additionally stripped at the
    designer read door (`RETIRED_FIELD_KEYS`, objectui#6041 / #6519).
  
  A repo-wide structure-walk producer census found **0** emitters of `target` and
  **0** reaching this seam for `referenceTo`, measured in the cell the drawer
  reads (a value inside an object schema's `fields` container) against controls
  `reference` (92 hits / 36 files) and `reference_to` (52 / 36) hot in the same
  pass over the same cells.
  
  Pinned by `RecordDetailDrawer.referenceArms-6837.test.tsx`, which keeps the live
  arms green beside a named refusal per deleted key.
  
  ⚠️ **Dated note, 2026-09-30 — the choke point folds, and the drawer emits `reference` — objectui#11070.** "`normalizeSchemaReferenceKeys` ... stamps both snake_case keys" above held when this change landed. Later in this same release objectui#11070 (round 4) made that pass fold a legacy spelling onto `reference` without stamping `reference_to`, and the drawer's field list now carries the target as `reference`. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
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
- c4326fe: `detail-section`'s `headerColor` input is now the closed six-token vocabulary it
  has been contractually since objectui#6594, instead of a free-form `string`.
  
  **Breaking for authors, deliberately** (objectui's own breaking changes ship as
  `minor` — AGENTS.md 版本号策略). The registration declared
  `{ name: 'headerColor', type: 'string' }`, unchanged since before the vocabulary
  was ruled, while `DetailViewSection.headerColor` and its `@object-ui/types/zod`
  mirror are a six-member `z.enum` — `muted`, `muted/50`, `accent`, `primary/10`,
  `secondary/10`, `destructive/10` — matching `@objectstack/spec`'s strict
  `record:details` section schema (maintainer ruling A, 2026-08-26,
  objectstack#12126). The two ends disagreed about what an author may write: the
  registration said "any string", the validator said "one of six".
  
  `inputs` is not documentation. `detail-section` is outside `PUBLIC_BLOCKS`, so
  it never reaches `sdui.manifest.json` — but `PageRenderer` builds the JSX-page
  compiler's manifest from `getKnownTypes()` plus these same `inputs`, and
  `sdui-parser`'s `validateTree` judges an authored page against it. Before this
  change a value outside the six drew no diagnostic there at all; it now draws an
  `invalid-enum` **error** naming the prop and listing the legal tokens, so the
  refusal arrives while the page is being written rather than at parse time — or,
  for a value that happened to render under some host app's Tailwind build, never.
  
  Two things that did NOT change, and are pinned as such:
  
  - **The renderer's verbatim `bg-*` pass-through is untouched.** `headerColorClass`
    still hands a complete `bg-*` class through unmodified. It stays an
    **undeclared** affordance: ruling A refused to declare it, because whether such
    a class renders depends on the host app's Tailwind build. That is why the input
    declares exactly ONE arm — a `'string'` arm beside the enum would clear every
    value again and declare the pass-through by accident.
  - **`@object-ui/types` is unchanged.** It was already correct; the published enum
    is derived from `headerColorVocabulary` rather than hand-copied, so the
    one-to-one pin objectui#6594 established carries this surface too.
  
  Authors writing one of the six are unaffected. An author writing anything else
  was already being refused by the validator and is now told so at authoring time.
- eeb6c2f: ⚠️ **Partly superseded inside this same release — read the `hideEmpty`
  restoration entry for what ships.** What survives below: the direct-`fields`
  fallback body and the `detail-view` node keep an all-empty section's skeleton
  with zero app-side authoring, and the label-graveyard guard is untouched. What
  does not: on an AUTHORED `record:details` section the empty-section default is
  `hideEmpty` again, so an all-empty one hides unless the page writes
  `hideEmpty: false`.
  
  **Behaviour change.** `record:details` no longer forces `hideEmpty` on the
  sections it synthesizes, so a sparse record keeps its section skeleton instead
  of collapsing. Applications relying on the old auto-hide of *unauthored*
  sections will now see headings, field labels and empty-value placeholders where
  rows used to vanish. This is the loud-over-silent direction, ruled by the
  maintainer on 2026-08-31: an empty detail body is a platform concern, and a
  metadata application should not have to author its way out of one.
  
  `RecordDetailsRenderer` mapped every authored section with
  `hideEmpty: s.hideEmpty ?? true`. `DetailSection` already states the correct
  rule in its own heuristic — *"If a section is entirely empty (e.g., loading
  state, brand-new record), do NOT auto-hide — the labels themselves are useful
  as a structural skeleton"* — and the forced default overrode exactly the case
  that sentence reserves. On a hand-created record whole sections disappeared and
  the body collapsed to a couple of rows; seeded demo data hid it. Every
  application then had to hand-write `hideEmpty: false` per section to stop
  looking broken, which is per-app tax for a platform defect. The renderer now
  passes the authored value through untouched and lets the heuristic own the
  default.
  
  What changes, precisely:
  
  - an **all-empty** section renders its heading, every field label and one
    empty-value placeholder per field (it used to render nothing at all)
    — ⚠️ re-reversed for AUTHORED `record:details` sections later in this same
    release, where the restored `hideEmpty` owns this case and `false` is the
    spelling that keeps the skeleton;
  - a **small** partly-empty section — below `DetailSection`'s auto-hide
    threshold of 4 fields / 25% empty (3 / 20% on mobile) — now shows its empty
    rows;
  - a **large** mostly-empty section with at least one filled row still
    auto-hides, with the "Show N empty fields" toggle unchanged: the
    label-graveyard guard is intact and this is not a return to dense-by-default;
  - empty rows are now visible while inline-editing a section, so an unwritten
    field can be filled in place.
  
  What does **not** change: an authored `hideEmpty` keeps its exact former
  meaning. `hideEmpty: true` remains the explicit opt-in to hiding, and
  `hideEmpty: false` remains what it always was — "not `true`", not an override
  of the auto-hide heuristic (measured, and pinned as pre-existing).
  
  Reference-app hit inside this repo: the Studio metadata-admin page preview
  (`PagePreview`) binds a real sample record, so a `record:details` block over a
  sparse sample now previews the skeleton rather than a collapsed body. No
  application metadata needs editing — that is the point of the change.
  
  ⚠️ **Dated note, 2026-09-16 — the closing sentence above is a reading of
  2026-09-01 and no longer holds for an AUTHORED `record:details` section.**
  ⛔ Its text is kept, not rewritten: it was true of the tree this entry
  describes, and overwriting it would erase that. objectui#8603 (director seat
  batch #137 item 3, maintainer 2026-09-15) restored the `record:details` read of
  `hideEmpty`, shipped by PR objectui#9627 later in this same release. As of
  2026-09-16 an all-empty AUTHORED section hides again unless the page writes
  `hideEmpty: false` — so a page that wants the skeleton back does have
  application metadata to edit, and the preview sentence before it holds only for
  a block that authors no section. Where nothing is authored — the
  direct-`fields` fallback body and the `detail-view` node — the closing sentence
  still holds as of the same date. The `hideEmpty` restoration entry is the one
  that states what ships.
- 1f31d3a: **Retired: `DetailViewSection.hideEmpty`.** The `record:details` section key is
  gone from `@object-ui/types` and `RecordDetailsRenderer` no longer reads it.
  Emptiness on a detail section is now decided entirely by `DetailSection`'s
  auto-hide heuristic — hide empty rows only while the section still has at least
  one filled row, never on an all-empty section — with the reader's
  "Show N empty fields" toggle as the escape hatch.
  
  **Minor, not major, and deliberately so.** The key was never authorable on any
  validated page: `@objectstack/spec` `RecordDetailsProps` REFUSES it, returning
  `unrecognized_keys: ['hideEmpty']` on the `sections[]` element (measured on the
  installed 17.2.0, against a `columns: 2` control that parses and whose value
  survives). So a spec-compliant document could not carry the key, and a document
  that carried it anyway failed to parse before it ever reached the renderer.
  What this release removes is a *declaration* that invited authors — and code
  generators reading the published `.d.ts` — to write a key the platform refuses.
  That narrows a published type surface, which is what makes it a minor rather
  than a patch; it retires no capability anyone could exercise.
  
  One key had four contracts and three answers: `@object-ui/types` declared it,
  `RecordDetailsRenderer` honoured it, the `DetailViewSectionSchema` zod mirror
  omitted it, and the spec refused it. The maintainer converged the four on the
  spec's answer (2026-09-01) as it stood then. All four are pinned together in
  `record-details.hideEmptyRetired-7129.test.tsx`.
  
  ⚠️ **What that convergence settled on has since moved, inside this same
  release.** The premise was that the spec refuses the key — true of the 17.2.0
  pin this repo held, and already false upstream. `@objectstack/spec` 17.3.0
  declares the key with a description promising the behaviour this entry removed,
  so the maintainer ruled the protocol correct and restored the read. Net for a
  reader of THIS release: the key is declared upstream, honoured here, and
  `hideEmpty: false` works. The paragraphs above describe a step this release
  takes and then takes back; the restoration entry is the one that describes what
  ships.
  
  Going with it is the paradox the key carried: `DetailSection` tested
  `!section.hideEmpty`, so an authored `hideEmpty: false` was indistinguishable
  from an unauthored section and overrode nothing. There is no longer a lever to
  misread.
  
  **Supersedes one paragraph of the `record:details` empty-section changeset in
  this same release.** (⚠️ Written 2026-09-03 — the reason and the scope line in
  this paragraph were overtaken inside this same release. Read the dated note
  directly below before acting on either.) Its closing "What does not change: an
  authored `hideEmpty` keeps its exact former meaning" no longer holds — an
  authored `hideEmpty` of either polarity is now inert, and the release notes
  should read that way. Everything else in it stands: the unauthored default is
  unchanged, and so is the label-graveyard guard.
  
  ⚠️ **Dated note, 2026-09-16 — the paragraph above is a reading of 2026-09-03
  and two of its statements have been falsified since.** ⛔ Its text is kept, not
  rewritten: it was true of the tree that retired the key, and overwriting it
  would erase that. objectui#8603 (director seat batch #137 item 3, maintainer
  2026-09-15) restored the `record:details` read of `hideEmpty`, shipped by PR
  objectui#9627 later in this same release. What holds as of 2026-09-16: an
  authored `hideEmpty` is honoured rather than inert, and a `record:details`
  section that authors no `hideEmpty` hides again once all of its fields are
  empty. What still stands from that paragraph: the label-graveyard guard, and
  the skeleton the direct-`fields` fallback body and the `detail-view` node keep
  with zero app-side authoring. The closing sentence it supersedes does not come
  back either, for the opposite reason — as of 2026-09-16 `hideEmpty: false` is
  an override, which its "exact former meaning" never was. The `hideEmpty`
  restoration entry is the one that states what ships.
  
  **⚠️ Migration: none — superseded inside this same release. ⛔ Do NOT delete
  `hideEmpty` from your sections.** This entry originally told you to, because at
  the time the key was retired here and refused by `@objectstack/spec`. Both
  halves changed before this release shipped: the spec DECLARES
  `RecordDetailsProps.sections[].hideEmpty` from 17.3.0, and the
  `record:details` read is RESTORED later in this same release — see the
  `hideEmpty` restoration entry, which states the behaviour that actually ships.
  A section that authors `hideEmpty` keeps its meaning; `hideEmpty: false` is how
  an all-empty section keeps its heading and label skeleton.
  
  **Not affected**, despite the shared name: `record:reference_rail`'s own
  `hideEmpty` prop, which is a different surface and still live; and the
  `detail.hideEmptyFields` i18n label behind the toggle.
- 351eb31: Converge the lookup/user widget metadata on the spec's camelCase — one concept, one
  spelling (objectui#7155, maintainer ruling A′ of 2026-09-03, director decision batch #19).
  
  **BREAKING, deliberately, with no deprecation window.**
  
  Two published contracts declared OPPOSITE dialects for the same four lookup keys, and
  `@object-ui/fields`' read chains served both — snake FIRST, so the dialect the object
  contract *refuses* outranked the one it *declares*:
  
  | | `@objectstack/spec` `FieldSchema` (object metadata) | `@object-ui/types` `LookupFieldMetadata` (widget metadata) |
  |---|---|---|
  | camelCase | **declared** | compile error (`TS2561`) |
  | snake_case | refused (`unrecognized_keys`) | **declared** |
  
  `LookupFieldMetadata` and `UserFieldMetadata` now declare the spec spellings, and the
  snake members are **removed**:
  
  | before (removed) | after |
  |---|---|
  | `display_field` | `displayField` |
  | `description_field` | `descriptionField` |
  | `lookup_filters` | `lookupFilters` |
  | `id_field` | `idField` |
  
  **Migration.** Rename those four keys wherever you author lookup or user field metadata
  — `LookupFieldMetadata` / `UserFieldMetadata` objects, and any `DataSource.getObjectSchema`
  that returns them. The old spellings are no longer read: a def still carrying
  `display_field` falls back to the referenced record's generic name heuristic rather than
  the field you named.
  
  `idField` is kept as a **widget-contract** key. It carries objectstack#3508's machine-name
  hydration — committing a record field other than the id as the lookup's stored value —
  which is picker behaviour with no `FieldSchema` twin, and none owed.
  
  **Not renamed** (outside this ruling's four keys, still snake on the widget bag):
  `reference_to`, `title_format`, `lookup_columns`, `lookup_page_size`, `depends_on`,
  `allow_create`, `avatar_field`. `reference_to` in particular **stays** — the adapter's
  `normalizeSchemaReferenceKeys` choke point genuinely stamps it onto every def.
  
  Also moved with the rename: `content/docs/fields/lookup.mdx` and `user.mdx` (whose
  snippets CI compiles against the built `d.ts`), all seven in-repo producers, and the
  inline-edit enrichment allow-list in `@object-ui/plugin-detail`. `plugin-grid`'s
  `relationalMetaKeys.ts` drops the four `legacy-alias` verdicts and retires that verdict
  class; its gate is restated to assert the class no longer exists rather than passing
  vacuously.
  
  ⚠️ **Dated note, 2026-09-30 — `reference_to` did not stay — objectui#11070.** "`reference_to` in particular **stays**" above held when this change landed. Later in this same release objectui#11070 (round 4) retired it: the ingestion pass no longer stamps it, the widgets and read cells read `reference` only, and `LookupFieldMetadata` declares `reference`. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
- b652514: Mixed id/object action arrays are refused; use all ids or all objects
  (objectui#7182, maintainer ruling 2026-09-02, option C).
  
  An `actions` array on `page:header` or `record:quick_actions` (and the bar's
  spec-declared `actionNames`) is either **all action ids** or **all inline
  `ActionDef` objects**. A mixed `['convert', { … }]` array is now refused on both
  surfaces: none of its authored actions is rendered, and the console names the
  offending index (`… refused at index 1 — element 1 is an inline action object
  but element 0 is an action id …`). Before this change the two renderers
  disagreed on exactly that input — `page:header` normalised per element and drew
  both halves, `record:quick_actions` switched on the whole array and rendered
  nothing for the id — so one authored array meant two things depending on which
  surface drew it, and the mixed form is precisely what a half-migrated page under
  the objectstack#11592 ids ruling produces.
  
  **Breaking, deliberately, and narrowing.** `@objectstack/spec` has always
  declared `PageHeaderProps.actions` as `z.array(z.string())` — the spec already
  refuses an object element at validation, naming its index — and
  `RecordQuickActionsProps` declares `actionNames` (ids) only. What narrows is
  the renderers' undeclared tolerance: an all-object array still passes through
  (transition tolerance for the migration, retired on its own card once the last
  inline array is converted), a mixed one no longer does. **Migration:** convert
  each array whole — every element an id naming an action declared on the
  object — never one element at a time.
  
  New on `@object-ui/types`, beside `actionRendersAt`: the pure
  `resolveDeclaredActionIds(elements, registeredActions)`, with the
  `DeclaredActionsResolution` / `DeclaredActionsRefusal` result types (the shape
  classifier stays module-internal: called with no registry, the function already
  returns the registry-independent verdict a renderer needs before its lookup). Both
  renderers call it; the whole-array switch in `record-quick-actions.tsx` and the
  per-element normalisation in `containers.tsx` are gone. The rule is closed: a
  string is an id, a non-null non-array object is an inline definition, and any
  other element (`null`, a number, a nested array) is refused at its index too.
  An all-id array resolves by `name` in authored order, first registration
  winning on a duplicate name; ids that name nothing are reported back with their
  index for the caller to warn about once its lookup has settled.
  
  **Three further behaviour changes ride on the one rule, all on published
  packages:** on `page:header`, a padded id (`' convert '`) no longer resolves — it
  was previously trimmed before the lookup, and ids are now compared exactly as
  authored; on `page:header`, a blank `''` id is now reported by the unresolved-id
  warning instead of being silently skipped; on `record:quick_actions`, an all-id
  `actions` array with no object bound now renders nothing (the ordinary empty
  placeholder) instead of handing the bare strings to the action engine as action
  definitions.
- a338037: Fix: a `dependsOn` field is no longer permanently gated when it is edited inline
  on a record's detail page.
  
  A lookup declaring `dependsOn: ['region']` rendered a disabled trigger reading
  "Select region first" in inline edit — while the `region` it asked for was on
  screen, filled, in the same edit session. The field could never be filled
  there. A `select` or multi `select` field declaring `dependsOn` was withheld the
  same way, behind its "select the parent first" hint. Both the details body and
  the highlights strip were affected.
  
  The widgets in `@object-ui/fields` resolve the record they cascade on from one
  channel, the `dependentValues` prop their host passes; there is no context
  fallback (objectui#7206). `InlineFieldInput` — the one inline editor both
  record-page surfaces share — passed none. It now takes an optional
  `dependentValues` prop and forwards it to `LookupField` / `UserField`,
  `SelectField` and `FieldEditWidget`, and both of its call sites pass the record:
  `DetailSection` the record `DetailView` already merges with the inline draft,
  and `HeaderHighlight` the saved record overlaid with the same draft. The
  highlights strip now also reads each field's own value by that same overlay, so
  a draft entry that holds an emptied value shows as empty there, exactly as it
  does in the details body.
  
  The record is the STAGED one — the same answer the grid's inline editor gives
  (objectui#7188) and the form's live watched record: a parent edited in the same
  session re-scopes the child before anything is saved, and clearing the parent
  re-gates the child.
  
  ⚠️ Entering inline edit can now stage a cascade prune. With the record in hand,
  an option widget's existing cascade clear runs on this surface as it does on the
  form: a stored value the record's CURRENT parent no longer offers is dropped
  into the edit session's draft as soon as inline edit is entered, before the user
  touches that field. A single `select` or `radio` then shows empty; a multi
  `select` or `checkboxes` field keeps only its still-offered values. The next
  record-level Save carries the pruned draft entry with the user's own edits: a
  pruned multi `select` / `checkboxes` array is written, while a single `select` /
  `radio` pruned to `undefined` is dropped by a JSON transport, so its stored
  value survives Save and reappears on refresh. Cancel discards the draft.
  
  `InlineFieldInputProps` gains the optional `dependentValues` member, spelled and
  shaped like the widgets' own prop (`Record<string, unknown>`). A host that
  renders `InlineFieldInput` directly and wants `dependsOn` fields to cascade
  passes the record there; a host that omits it keeps today's gated behaviour.
- 0348bc9: **BREAKING:** `@object-ui/plugin-detail` no longer exports seven components that
  nothing registered and nothing mounted (objectui#7192, objectui#7175). This
  narrows the package's published surface. It is declared `minor`, not `major`,
  because this fixed release group follows the `@objectstack` major (AGENTS.md
  §9); the breaking change is stated here instead.
  
  Removed, with every type exported beside them:
  
  - `CommentInput`, with `CommentInputProps`
  - `DiffView`, with `DiffViewProps`, `DiffFieldType`, `DiffMode` and `DiffLine`
  - `InlineCreateRelated`, with `InlineCreateRelatedProps`,
    `RelatedFieldDefinition` and `RelatedRecordOption`
  - `MentionAutocomplete` and the helper `createMentionFromSuggestion`, with
    `MentionAutocompleteProps` and `MentionSuggestionItem`
  - `PointInTimeRestore`, with `PointInTimeRestoreProps` and `RevisionEntry`
  - `RecordNavigationEnhanced`, with `RecordNavigationEnhancedProps`
  - `RelationshipGraph`, with `RelationshipGraphProps` and `GraphNode`
  
  Why they went: none of the seven was passed to `ComponentRegistry.register`, so
  metadata had no type string to name any of them, and none was mounted anywhere
  in this repository. The downstream readings agree: `cloud` references none of
  the seven names (objectstack#14187), and `hotcrm` depends on no `@object-ui/*`
  package at all. The maintainer ruled to delete them; the ruling is relayed on
  objectui#7192.
  
  Not affected: `RichTextCommentInput` and its `MentionSuggestion` type (the
  composer `RecordActivityTimeline` mounts), `RecordComments` (`DetailView`
  mounts it) and `extractMentions` all stay exported.
  
  `@object-ui/i18n`: the `detail.*` keys that only these components read are
  removed from all ten locale packs, and the matching rows from
  `DETAIL_DEFAULT_TRANSLATIONS`:
  
  - `PointInTimeRestore`'s ten, added by objectui#7163: `revisionHistory`,
    `noRevisions`, `revisionFieldsChanged`, `revisionFieldsChangedOne`,
    `revisionPreview`, `revisionSnapshot`, `restoreConfirm`, `restoring`,
    `confirmRestore`, `restoreToPoint`
  - `emptyValue`, an older key whose last reader was `PointInTimeRestore`
  - `DiffView`'s five: `unifiedDiff`, `sideBySideDiff`, `noChanges`,
    `previousVersion`, `currentVersion`
  - `RecordNavigationEnhanced`'s six: `firstRecord`, `previousRecordKey`,
    `nextRecordKey`, `lastRecord`, `searchWhileNavigating`, `searchRecords`
  
  Keys these components shared with surfaces that stay (`detail.recordOf`,
  `detail.noRecords`, `detail.cancel`, `detail.activityEmptyValue`, the
  relative-time keys) are kept. A host that read one of the removed keys itself
  now gets the raw key back.
  
  Other entries in this same release describe work on `PointInTimeRestore` and
  `DiffView` (their translation and display-locale fixes). That work shipped in
  components this entry removes.
  
  **Migration:** there is no replacement. If you import one of these components,
  copy its source file (`packages/plugin-detail/src/`, the file named after the
  component) from a release tag that still ships it, for example
  `@object-ui/plugin-detail@17.5.0`, into your own code. If you need one of them
  back in the package, open an issue that says who uses it and where.
- b61d7d8: `resolveTitleField` delegates to the shared ADR-0079 ladder (objectui#7287).
  
  ADR-0079 collapsed ~6 divergent record-title resolvers onto one — `@object-ui/core`'s
  `record-title.ts`, whose header tells the "Untitled everywhere" story that produced it.
  `plugin-detail` grew one back. `resolveTitleField` now calls core's `resolveNameField`
  and nothing else, so the detail page, the list column and the lookup chip cannot
  disagree about which field titles an object.
  
  **Two rungs are gone.**
  
  `def.primaryField` — a `DetailViewSchema` key (`@object-ui/types` `views.ts`), read off
  an OBJECT def and ranked ABOVE the canonical `nameField` ADR-0079 Phase 2 made the
  pointer (AGENTS.md Commandment #0.1). No producer can put it there: `@objectstack/spec`'s
  object schema is a `strictObject` that answers `unrecognized_keys: ['primaryField']`,
  and `ObjectSchema.create()` throws — which is why objectstack#6326 deleted the identical
  read from two lint rules. A census across both repos found **zero** object payloads
  carrying it (the only writers are three test fixtures), and `primaryField` appears in
  **zero** files of the shipped `@objectstack/spec@17.2.0` dist against 68 for `nameField`.
  Same shape as the undeclared `objectDef.titleField` read objectui#6531 measured and
  #6557 removed. `DetailViewSchema.primaryField` is untouched and still honoured by
  `DetailView`'s own header — it is a view key, and on a view it is legitimate.
  
  The literal `['name','full_name','title','subject','display_name']` walk — a NAME match
  with no type check.
  
  **User-visible, deliberately.** Two shapes retitle:
  
  - An object with no conventional name field — `{ due_at: datetime, headline: text }` —
    resolved to `null` here while every other surface titled the record `headline`. The
    detail page now agrees, and the highlight strip stops repeating the H1 as its first
    chip (the objectui#2548 duplication, which until now only DECLARED titles were spared).
  - A field named `title` of a non-title-eligible type (e.g. a `select`) was chosen by
    name alone and is now correctly skipped, so the strip no longer hides a chip on
    account of a field the H1 never shows.
  
  **A third user-visible change, in the highlight strip's skip set.** It previously read
  `primaryField`, `nameField` and `displayNameField` separately and skipped EVERY declared
  one; it now skips the single field the shared ladder resolves. These differ on one input:
  an object declaring `nameField` and the deprecated `displayNameField` alias to DIFFERENT
  fields. The alias's field is no longer hidden from the strip — deliberately, because
  `getRecordDisplayName` reads the same ladder and renders the WINNER's value, so the loser
  is an ordinary field the H1 never shows and hiding it spent a strip slot for nothing.
  This also makes the heuristic branch agree with the declared branch, which has only ever
  filtered a single title field.
  
  `deriveHighlightFields` asks the retirement gate (objectui#4914) about the title field
  **before** skipping it: an object whose only retired-typed field is the one that titles
  it must still get its report, which skipping-first would have silenced.
  
  `ObjectDefLike.primaryField` stays DECLARED but is never read. The interface is
  re-exported from this package's index and this package is published, so removing the
  member would narrow a shipped `.d.ts` — a contract change owed its own card, not a rider
  on a behaviour fix.
- daf9d57: The last two consumer-side reads of `primaryField` off an OBJECT def are gone (objectui#7586).
  
  `primaryField` is a `DetailViewSchema` key (`@object-ui/types` `views.ts`) — a **view** key,
  which `DetailView.resolveDisplayTitle` reads off `schema` and is welcome to. Read off an
  **object** def it is undeclared: `@objectstack/spec`'s object schema is a `strictObject`
  answering `unrecognized_keys: ['primaryField']`, and `ObjectSchema.create()` throws.
  `primaryField` appears in **zero** files of the shipped `@objectstack/spec@17.2.0` dist,
  against 68 for the canonical `nameField`. objectstack#6326 removed the identical read from
  two lint rules; objectui#7287 / PR #7585 removed it from `resolveTitleField`. These two
  survived it — and three of this repo's own changelogs already called the probe *"not a spec
  property — always undefined"* while the code kept honouring it.
  
  **They are two different repairs, not one patch applied twice.**
  
  `@object-ui/components` — `PageHeaderRenderer`'s record-chip chain ranked
  `objectSchema.primaryField` directly under `schema.title` and **above** the unified ADR-0079
  resolver, on the surface that renders the **actual H1** of a synthesized record page. The
  rung is deleted, so the heading now comes from `titleFormat` → the ADR-0079 resolver
  (`nameField` → `displayNameField` → type-aware derivation) → the record-key walk, the same
  precedence `DetailView`'s own header uses.
  
  `@object-ui/plugin-detail` — `record:details`' dedupe ladder decides **which row the body
  grid hides**, so that the field already shown as the H1 is not repeated underneath it. That
  is a different question from "what is the title", and `primaryField` was its *first*
  candidate. The rung is deleted; the ladder is the literal display-name walk that mirrors the
  tail of the header chip's chain. Its docstring, which had described the chip as resolving
  "from objectSchema.primaryField", went stale when PR #7585 landed and now describes the chip
  as it is.
  
  **User-visible, deliberately.** A payload that carries the off-spec key anyway changes in two
  ways: the H1 of its record page stops being `primaryField`'s value, and a different row
  survives the detail grid. Nothing spec-legal can reach either path.
  
  `DetailViewSchema.primaryField` is untouched, and so is `ObjectDefLike.primaryField` in
  `buildDefaultPageSchema` — a deliberate declaration (not a read) that keeps an external
  caller's object literal type-checking.
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
- 8c8da45: `DetailViewSchema.related` is retired — author a `record:related_list` block
  (objectui#7997, ADR-0049 enforce-or-remove; maintainer ruling 2026-09-10).
  
  **Breaking, and graded `minor` by this repo's convention** — a `major` would drag
  the whole 39-package fixed group off `@objectstack`'s cadence. A `detail-view`
  node authoring `related` used to parse **green** and render a Related section; it
  now reds at that key on both faces, and the renderer draws nothing from it.
  
  **What retired is a DOOR, not the capability.** `record:related_list` is
  unchanged and is now the only **declared, protocol-governed** entry
  (`@objectstack/spec` `RecordRelatedListProps`); it has always rendered through
  the same `RelatedList` component the retired array fed, so nothing about the
  rendered result is lost. ⚠️ Not the only entry full stop — `plugin-detail`
  still registers a bare `related-list` node against the same component with
  untyped `columns`, and that registration is out of this card's scope and
  untouched.
  
  | before, on a `detail-view` node | after |
  | --- | --- |
  | `related: [{ title, type, api, columns: [{ accessorKey, header }] }]` | a `record:related_list` node: `{ objectName, relationshipField, title, columns: ['name', 'email'] }` |
  
  ⚠️ `columns` on the surviving entry is an array of **field-name strings**, which
  is what the protocol declares. The header is derived from the related object's
  field `label` and the cell from the field's type, so a label rename reaches the
  list for free — the hand-spelled `{ accessorKey, header }` form froze both.
  `relationshipField` names the field on the related object that points back at
  this record, and replaces the retired form's `api` endpoint.
  
  **Why it retired.** `@objectstack/spec` declares no `DetailView` schema at all —
  every `DetailView` occurrence in `packages/spec/src` is prose about this repo's
  own `RecordDetailView.tsx` — so this array mirrored no protocol schema and
  drifted freely: it declared `columns` as `TableColumn[]` while the renderer it
  fed also accepted bare field names, `{ field, label }` and legacy
  `{ name, label }` spellings. The axis that carried the ruling was measured **zero
  pull**: no application code authored the member, both internal producers of a
  `detail-view` node (`RecordDetailDrawer`, `renderers/record-details.tsx`)
  synthesize it without `related`, and the only in-tree authorings carrying real
  columns were two documents — both rewritten here.
  
  **A named refusal, not a deletion.** `BaseSchemaCore` ends `.passthrough()` and
  the TypeScript `BaseSchema` closes with an any-valued index signature, so a
  *dropped* member key is kept, not refused — deleting the declaration would have
  left the silent accept exactly as it was. The key stays declared and unwritable:
  `retirementTombstone()` on the Zod face, `?: never` on the TypeScript face, one
  guidance string feeding both the parse-time message and `.describe()`. A pin
  authors an undeclared sibling key through the same parse and watches it survive,
  so "a bare delete would not have refused it" is a reading rather than a claim.
  
  **What moved in `@object-ui/plugin-detail`.** `DetailView` no longer reads
  `schema.related`: the flat Related section, the `autoTabs` Related tab, its
  trigger and its count badge are gone, and `related` is off the `detail-view`
  registry's `inputs` and `defaultProps`. `RelatedList` itself, the
  `related-list` / `related_list` registrations and `record:related_list` are
  untouched.
  
  **Documentation.** `packages/plugin-detail/README.md` and
  `content/docs/api/schema-reference.md` stop teaching the retired array and gain a
  migration block each.
  
  ⚠️ The docs page had been teaching `{ name, label }` columns, and the two faces
  disagreed about that shape: the retired **TypeScript** declaration never
  admitted it (`TableColumn` requires `header` **and** `accessorKey`), while the
  retired **zod mirror** did — it spelled the member `z.array(z.any())` — so the
  JSON document that page taught parsed green and rendered. The page was wrong for
  a **typed** author and right for a **JSON** author, which is a sharper defect
  than a single wrong example: the two authoring faces of one member disagreed
  about what a column is. Retiring the member closes that split at the source, and
  the page now teaches `record:related_list`, whose `columns` is
  `z.array(z.string())` on both faces.
  
  ⚠️ **Dated note, 2026-10-02 — the bare `related-list` registration is retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2b) unregistered the `related-list` node
  key (and `plugin-detail:related-list`), so `record:related_list` is now the only node entry to
  `RelatedList`. The rest of this entry is kept as the reading of this change.
- cf1d29e: `ComponentInput.of` — the coarse kind of an input's MEMBERS, with readers on day one
  (objectui#8067).
  
  A registration's `type: 'array'` said a value was a list and stopped there, so a member
  that drifted from `@objectstack/spec` was invisible to every layer that reads a
  declaration. `page:header.actions` is the measured cost: the contract declares
  `z.array(z.string())` ("Action IDs"), the renderer read the members as `ActionDef`
  objects, and the repo-wide parity gate in
  `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts` stayed green for the
  whole life of the drift because both sides carried the key and neither could say what
  was inside it. What settled it was a maintainer ruling, not a test — and even after the
  fix, "these are ids" survived only as English in the registration's `description`.
  
  **What is new.** `ComponentInput` gains an optional `of`, carrying the same coarse-kind
  vocabulary as `type` one level down: the ELEMENTS of an `array`, or the VALUES of an
  `object` used as a map. One kind, or an array of them for a member contract that is a
  union, with `type`'s semantics — a member passes when any declared arm accepts it. The
  manifest serializer forwards it, so `sdui.manifest.json` now carries seven keys per
  input instead of six.
  
  **Three readers ship with it**, which was the bar this slot had to clear (objectui#5905
  is the precedent: five `ComponentInput` keys declared and read by nothing). The
  repo-wide parity gate compares every declared `of` against the member kind
  `ComponentPropsMap[type]` actually accepts and fails on one the contract refuses;
  `sdui-parser`'s `validateTree` reports a member that fits no declared kind, as a new
  `member-type-mismatch` diagnostic naming the offending positions; and the generated
  `sdui-intrinsics.d.ts` narrows the authoring type — `page:header`'s `actions` is
  `string[]` where it used to be `unknown[]`.
  
  **Fifteen keys now declare one**, across ten blocks, each DERIVED rather than chosen:
  every container key's member position was probed with one value of each coarse kind and
  a declaration written only where exactly one kind was accepted. A member contract that
  admits several kinds — `record:highlights.fields` takes a field name or an inline field
  object — is deliberately left undeclared and pinned with its reason, because picking one
  arm there is a narrowing this repo leaves un-gated and picking all of them would
  advertise shapes only a per-block pin can vouch for.
  
  **The ceiling is unchanged.** `of` is a KIND and never a value domain, so the maintainer
  ruling of 2026-08-17 quoted on `ComponentInput.type` — the coarse arm plus `description`
  is the publication face's expression ceiling, and spec is the sole judge of values —
  stands exactly as written. `of: 'object'` says the members are objects; which keys they
  carry is still `description`'s job and `os validate`'s.
  
  **Nothing published before this changes.** An input that declares no `of` validates,
  serializes and types byte-identically: `validateTree` checks no member, the serializer
  emits no key, and the codegen emits the same `unknown[]`.
- 37149ec: `record:details`' dedupe now asks the unified ADR-0079 resolver which row to hide
  (objectui#8175).
  
  The renderer drops from the body grid the one field whose value the page H1 is
  already showing, so a record page does not print `Contract No: HT-2026-001`
  directly under an H1 reading `HT-2026-001`. It picked that field with a six-entry
  literal walk — `name`, `full_name`, `title`, `subject`, `display_name`, `label` —
  which is the **tail** of the chain `PageHeaderRenderer` uses to draw the H1 a
  package away, with no equivalent of the ADR-0079 resolver rung that sits above it
  in that chain.
  
  **The user-visible defect.** For an object whose declared `nameField` names a
  field the literal walk does not know, *both halves of the dedupe were wrong at
  once*. On an object declaring `nameField: 'contract_no'`, for a record carrying
  both `contract_no` and an ordinary `name`:
  
  - the H1 showed `contract_no`'s value (correct — that half was already right);
  - the grid still showed the `contract_no` row, repeating the heading;
  - and the grid dropped the `name` row, a field the heading never showed.
  
  **The change.** The candidate list now leads with `resolveNameField` and
  `deriveTitleField` from `@object-ui/core` — the same ADR-0079 resolver
  `getRecordDisplayName` reads to produce the H1's *value*, and the one
  `resolveTitleField` in this package already delegates to. The literal walk stays
  as the tail, unchanged, for records whose object definition resolves nothing.
  
  **Breaking, deliberately — a different row can now be hidden.** This is a
  behaviour change for any object the resolver answers for and the literal walk did
  not, which includes objects with no name-ish field at all: there the resolver's
  type-aware derivation lands on the first title-eligible field by declaration
  order, and that field *is* what the page H1 shows, so the grid stops repeating it.
  Authors who want a field back can keep it out of the dedupe the way they always
  could — the ladder only ever hides a field whose value is non-empty on the record.
  
  The rung is spelled as **two** candidates rather than one `resolveNameField` call.
  That call returns a single answer and short-circuits: a declared pointer wins
  outright and the derivation never runs. This ladder is value-keyed, and so is the
  header's own chain — when the declared pointer is blank on a record,
  `getRecordDisplayName` keeps walking and lands on the derivation. Listing both
  rungs is what lets the same fall-through happen here.
  
  Two rungs of the header chain are deliberately **not** mirrored, because neither
  names a field and so neither has a row to hide: `page:header`'s own `schema.title`
  (which this package cannot see) and `objectSchema.titleFormat` (a render-only
  template the header ranks above the declared pointer).
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
- 9dcc545: `DetailSection` now has ONE definition of emptiness, and it **trims**
  (objectui#8376).
  
  The component decided "is this field empty?" three times — the row filter behind
  `emptyCount`, the reader's "Show N empty fields" toggle and the auto-hide
  heuristic; the branch that draws the muted em-dash `No value` affordance; and
  the one that offers click-to-copy — each with its own raw
  `null | undefined | ''` test. None of them trimmed, while `@object-ui/core`'s
  `recordDisplayValueAt` — the definition the record page's H1 uses, and since
  objectui#8350 the definition `record:details`' dedupe ladder uses — does. A
  whitespace-only field value was therefore FILLED here and EMPTY everywhere else
  in the same render path.
  
  **The user-visible defect, in three widening steps.**
  
  - The row painted a **visually blank cell**. The em-dash affordance exists
    precisely so a reader can tell "this field has nothing" from "this page failed
    to render"; a value of `'   '` took the cell-renderer path instead and printed
    the spaces.
  - It **escaped the counter**. `Show N empty fields` read one too low, and
    revealing the empty rows did not reveal this one — it had never been hidden,
    because it had never been counted.
  - ⭐ It could **arm auto-hide by itself**. `shouldAutoHideEmpty` requires only
    `filledCount > 0`, and the all-empty case is deliberately reserved so a sparse
    or brand-new record keeps its labels as a structural skeleton. A section whose
    ONLY non-null value was `'   '` had `filledCount === 1`: the skeleton was
    suppressed and **every genuinely empty row in that section** was hidden behind
    a toggle — on a page a reader would describe as blank.
  
  **The change.** All three reads now go through one function, and its scalar
  answer is `recordDisplayValueAt`'s rather than a fourth hand-written test. A row
  that says `No value` is the same row the counter counts and the same row that no
  longer offers to copy its spaces.
  
  **Scoped to strings, deliberately — and this is narrower than objectui#8350's
  move.** `recordDisplayValueAt` answers "does this resolve to a NAME", so an
  object value runs through the Salesforce-style display chain and is empty when
  that yields nothing. That is right for a title and wrong for a CELL: here an
  object value is handed to a type-aware cell renderer that knows how to draw it —
  `{ latitude, longitude }` as coordinates, `{ street, city, … }` as a formatted
  postal address, an option array as badges, anything else as JSON. None of those
  carries a name-ish key, so delegating that half would have replaced populated
  cells with `No value` and let auto-hide bury them. An object is a value on this
  surface, exactly as before.
  
  The only values whose rendering changes are strings that contain nothing but
  whitespace. `0`, `false`, `''`, `null`, `undefined` and every object value are
  classified exactly as they were.
- d7fecfb: The whole record page now shares ONE definition of emptiness, and it **trims**
  (objectui#8394).
  
  objectui#8350 gave `record:details`' dedupe ladder the page H1's authority;
  objectui#8376 converged `DetailSection`'s three spellings onto it. Four raw
  `null | undefined | ''` tests were left on the same page, none of them trimming.
  So for a whitespace-only value the H1 said "empty", the body grid said "empty",
  and the bands between and around them said "filled" and painted nothing — a
  contradiction visible in a single screenful.
  
  **What a reader saw, per band.**
  
  - **The highlight strip** (`HeaderHighlight`, ADR-0085) sits between the H1 and
    the body grid, and after objectui#8376 it was the last band on the page still
    calling a whitespace-only value FILLED: it painted a **blank chip** where the
    em-dash affordance belongs.
  - **The summary chips beside the H1** (`DetailView`) rendered a **blank Badge**.
    ⭐ And this surface decides emptiness **twice**: the auto-detection that picks
    which field becomes a chip asked the same raw question one rung earlier, so a
    whitespace-only `status` won the single status slot — and then the render
    dropped it, leaving **no status chip at all** where a genuinely filled `stage`
    would have shown one. Fixing only the render site would have turned a blank
    chip into a missing chip.
  - **The audit timeline** (`HistoryTimeline`) printed the spaces instead of the
    `—` it uses to mean "nothing".
  - **The record footer** (`RecordMetaFooter`) rendered a **blank actor**. ⭐ Here
    the fix is at the READ, not at the renderer: four consumers ask "is there an
    actor?" about one value — the presence gate, the `sameUser` suppression, the
    choice between the `Created by` and the "by"-less `Created` label, and the
    gate that actually mounts the renderer. Only the last reaches the renderer, so
    converging it alone would have removed the blank and left `Created by · 5m
    ago` standing over an actor that is not there — the dangling phrase that label
    branch exists to prevent. Normalized once at the read, all four agree.
  
  **The change.** `hasCellValue` — the predicate objectui#8376 measured into
  existence — moves out of `DetailSection.tsx` into a small shared module, and
  every band above reads it. Its scalar answer is `@object-ui/core`'s
  `recordDisplayValueAt`, the same authority the H1 uses, rather than a fifth
  hand-written test.
  
  **Objects are still values, deliberately.** `recordDisplayValueAt` answers "does
  this resolve to a NAME", so an object goes through the Salesforce-style display
  chain and is empty when that yields nothing. Right for a title, wrong for a
  cell: on these surfaces an object is handed to a type-aware renderer that knows
  how to draw it — `{ latitude, longitude }` as coordinates, an option array as
  badges, an expanded `{ id, name }` reference through the lookup renderer's own
  display chain, anything else as JSON. Delegating that half would have replaced
  populated chips, cells and actors with placeholders. This applies to the record
  footer too, which the filing card guessed might want the title predicate: it
  does not, because its renderer draws objects.
  
  The only values whose rendering changes are strings that contain nothing but
  whitespace. `0`, `false`, `''`, `null`, `undefined` and every object value are
  classified exactly as they were.
- c13d39e: `DetailSection`'s click-to-copy no longer writes `[object Object]` for object-valued
  cells (objectui#8395).
  
  The copy affordance built its payload with `String(value)`, and `String()` of an object
  is the literal text `[object Object]`. Because the affordance is offered for every
  non-empty value — objects included — a reader clicking the copy button, the row, or
  pressing Enter on an **address**, **geolocation**, **JSON**, **file/attachment**,
  **expanded lookup**, **repeater** or **image** cell silently got that placeholder on the
  clipboard, while the cell beside the button rendered the same value correctly. Nothing
  errored; it was noticed only on paste.
  
  Objects are now serialized with `JSON.stringify`, so those cells copy the stored value
  losslessly and parseably.
  
  **Non-objects are byte-identical.** A number still copies `16` (not the rendered
  `16.00`), a currency `1234.5` (not `1,234.50`), a percent `0.123` (not `12%`), a date
  `2026-03-04` (not `Mar 4`), and a select its stored `won` (not `Closed Won`). Copying
  the *rendered* text was measured and rejected: it is the worse contract for 9 of 17
  field types and loses data silently.
  
  **One payload moves without having been broken:** a multiselect stored as
  `['alpha','beta']` copied `alpha,beta` and now copies `["alpha","beta"]` — an array is
  an object. The new form is lossless where the old one was ambiguous for any value
  containing a comma.
  
  The JSON blob is a **defensible default, not a settled contract**. What an object cell
  *should* copy (a formatted postal address, `lat, lng`, a filename) is a per-kind product
  question tracked separately as objectui#8395's option B; the read site says so in place
  so the default is not mistaken for the answer. The `password` / `secret` branch of the
  same handler is untouched here — it is its own open card.
- 7cf6f38: `RelatedList`'s column pruning and its cell placeholder now share ONE definition
  of emptiness (objectui#8459).
  
  The component decided "is there anything to show here?" twice, with two
  different answers. `isValueEmpty` — the predicate behind `pruneEmpty`, which
  drops a column whose every cell is empty — counts `null`, `undefined`, a string
  that is empty **after trimming**, and an **empty array**. The placeholder branch
  of `makeCell`, which draws the muted em-dash for one cell, tested `null` and
  `undefined` alone.
  
  **The user-visible defect.** The two are not independent questions: `pruneEmpty`
  keeps a column when *some* cell is not empty, so a column the reader can see has
  been promised it holds something. When only one row in a column was blank, that
  column survived — and its blank row then painted a **visually blank cell**,
  which is exactly the UI the em-dash exists to prevent, drawn by the same
  function that draws `—` for `null` one branch above. Measured in a real grid: a
  `note` column holding `['   ', 'real note']` kept its header and printed three
  spaces into the first cell. A multi-select column holding `[[], ['a']]` did the
  same with nothing at all.
  
  **The change.** The cell branch now asks `isValueEmpty`, the one definition this
  component already had. Because the old test was a strict subset of it, no cell
  that drew the em-dash before stops drawing it: the values whose rendering
  changes are whitespace-only strings, empty strings and empty arrays, which now
  draw the placeholder instead of nothing.
  
  **Deliberately NOT delegated to `DetailSection`'s `hasCellValue`.** That
  function calls every non-null object a VALUE, and `typeof [] === 'object'` — so
  it reads an empty array as filled. This surface reads it as empty, and for a
  grid that is the right answer: the select renderer maps `[]` over zero options
  and paints nothing, so an all-empty-array column that is pruned today would
  instead have survived and rendered a column of blank cells. Delegating would
  have introduced the very defect being fixed. The two surfaces agree on every
  scalar (both trim) and on non-empty objects, which stay values so the type-aware
  renderers keep drawing coordinates, addresses and badges.
  
  `0` and `false` are values here exactly as before.
- 5cc8c28: **An empty array is no longer a cell value on the record page (objectui#8474).**
  
  `hasCellValue` — THE definition of emptiness for `record:details` (objectui#8376,
  widened to the package by objectui#8394, extracted to `emptiness.ts` by
  objectui#8457) — opened with
  `if (value !== null && typeof value === 'object') return true;`. `typeof []` is
  `'object'`, so an **empty array was a value** and nothing further was asked of
  it.
  
  The object half's reasoning is sound and stays: an object value is handed to a
  type-aware renderer that knows how to draw it. But every example it reasons
  about is a *populated* object, and for `[]` the renderer has nothing to draw —
  `SelectCellRenderer` tests `value == null || value === ''`, which `[]` passes,
  then maps it over zero entries. The result was the blank cell the em-dash exists
  to prevent, produced by the function that exists to prevent it, plus the full
  objectui#8376 triple: the row escaped `emptyCount`, `canCopy` offered to copy it,
  and because `shouldAutoHideEmpty` needs only `filledCount > 0` a section whose
  one non-null value was `[]` armed auto-hide by itself and buried every genuinely
  empty row around it.
  
  **The change.** One arm inside the object branch:
  `if (Array.isArray(value) && value.length === 0) return false;`. All five readers
  of the shared authority get the corrected answer — `DetailSection`'s affordance,
  `emptyCount` and `canCopy`; `HeaderHighlight`'s highlight strip; `DetailView`'s
  summary chips; `HistoryTimeline`'s diff placeholder; `RecordMetaFooter`'s actor
  test.
  
  **What did NOT move, and why it is a measurement.** `{}` is still a value: on
  `json`, `object` and `location` fields it draws the literal `{}` through
  `JsonCellRenderer`, so there is no blank cell to fix. The shape that would have
  swept it in — `Object.keys(value).length === 0` — is also true of a `Date`, a
  populated `Map`, a populated `Set` and a getter-backed class instance, which
  would be a false-empty on values that render.
  
  **Declared cost.** A `json`-family field holding `[]` previously rendered the
  literal two-character text `[]`; it now draws the `No value` placeholder. That is
  intended and pinned.
  
  `RelatedList.isValueEmpty` is untouched: it already drew this line, and the
  shared authority moved toward it — never the reverse.
- 40a7c53: `ObjectGrid` and `RelatedList` now draw the shared `EmptyValue` for a missing
  cell value instead of each spelling its own placeholder (objectui#8491,
  objectui#8475).
  
  **The accessibility defect.** Both components built a plain span holding a bare
  em-dash, classed `text-muted-foreground/50 text-xs italic`. The shared
  `EmptyValue` in `@object-ui/components` carries three things that span did not:
  a `data-slot` of `empty-value`, an `aria-label` resolved through the i18n label
  hook, and `select-none` / `no-underline` / `pointer-events-none`. So an empty
  cell had **no accessible name at all** — a screen reader heard a naked
  punctuation mark — while its renderer-supplied neighbour in the next column was
  announced as "No value". In `RelatedList` the two outcomes were reachable in the
  *same column*: an empty string took the hand-rolled branch, an unparseable
  `datetime` reached `DateTimeCellRenderer` and got the real one. Inside a link
  column the hand-rolled placeholder also inherited the link colour and was
  selectable, so a missing value looked clickable and could be copied.
  
  **A deliberate visual change, not a no-op.** The three grid cell sites and the
  related-list site drop `text-xs italic` and adopt the shared component's
  typography. That is the point: `ObjectGrid`'s no-renderer default branch already
  returned `EmptyValue`, so one table could show a 12px italic placeholder in one
  column and the shared upright one in the next. They are now byte-identical.
  
  **A fourth site, and a purely additive change there.** The grid's record-detail
  drawer had the same hand-rolled placeholder in a `text-sm` spelling, which the
  originating census missed. It adopts `EmptyValue` too, but keeps its rendered
  text and typography through `glyph` and `className` — the `grid.empty` string
  has exactly one call site in the workspace and dropping it would strand a
  translated value in ten locale packs. Its delta is the three affordances only.
  
  Filled cells are untouched in every path, including the grid's stacked card
  layout below 768px.
- 542718f: `record:details` honours `hideEmpty` on a section again — an all-empty section hides itself, `hideEmpty: false` keeps its heading and skeleton
  
  **User-visible.** A `record:details` section whose fields are ALL empty now renders nothing at all — no heading, no skeleton — unless the page writes `hideEmpty: false` on it, which keeps the heading and the label skeleton a brand-new record needs. That is the behaviour `@objectstack/spec` declares on `RecordDetailsProps.sections[]` and describes in the key's own `describe()` text, and this renderer had stopped delivering it.
  
  ⚠️ **The unauthored default moved — and read that against the RELEASE, not against `main`.** An all-empty authored section rendered its skeleton on `main` from 2026-09-01, which is after the previous release, so the two entries that produced that state are still pending and ship alongside this one. Net for a consumer upgrading: the key is declared upstream and honoured here, `hideEmpty: false` works for the first time, and the empty-section default for an AUTHORED `record:details` section is unchanged from the last published release. Pages that want the skeleton on an all-empty section write `hideEmpty: false` — a spelling that parses green on the strict section object since spec 17.3.0, which is precisely what it could not do when the read was retired.
  
  **Release-note reconciliation, done by correction rather than by rebuttal.** Two pending entries in this same release contradicted the above, and their prose has been corrected in place (frontmatter and declared packages untouched): `7129-retire-detailviewsection-hideempty.md`, whose migration step told authors to delete `hideEmpty` — an instruction a reader acts on, and one that would now delete the very spelling that keeps a skeleton — and `7064-empty-section-default.md`, whose "a sparse record keeps its section skeleton" holds for the fallback body and the `detail-view` node but no longer for an authored `record:details` section. Naming them from here instead would have left the migration step live in the same CHANGELOG.
  
  **What did NOT change.** The empty ROWS of a section that still has a filled row stay with `DetailSection`'s auto-hide heuristic and the reader's "Show N empty fields" toggle, which no authored value overrides in either polarity (objectui#7129 Q2-C, left standing by the ruling). Inline-edit mode renders an all-empty section either way, so its fields never become unreachable. `record:reference_rail`'s own component-level `hideEmpty` and the `detail.hideEmptyFields` toggle label are different keys and are untouched.
  
  **Why it moved twice.** objectui#7129 (maintainer 2026-09-01) retired the declaration and the read because `@objectstack/spec` REFUSED the key — true at the 17.2.0 pin this repo held. Upstream had already declared it (17.3.0, upstream objectstack#11289, maintainer ruling 2026-08-23 direction 1, taken from a measured symptom), so once the pin moved the contract promised an author a behaviour the renderer no longer had, and it parsed green at publish. objectui#8603 (director seat batch #137 item 3, maintainer 2026-09-15) ruled the protocol correct and restored the read; #7129's Q1-A is superseded for this key only.
  
  All four parties now agree — the spec declares it, `@object-ui/types` declares it, the `DetailViewSectionSchema` zod mirror carries it, and the renderer reads it — pinned together in `packages/plugin-detail/src/renderers/__tests__/record-details.hideEmptyRetired-7129.test.tsx`.
- 6479086: `record:details`, `record:highlights` and `record:related_list` declare the
  field-security triple — `enforceFieldSecurity`, `redactFields` and
  `requiredPermissions` — on their published types and registry inputs
  (objectui#8649).
  
  **This is a widening, and it is exactly the contract's.** `@objectstack/spec`
  17.5.0 declares all three keys on these three blocks (objectstack#18159), with
  the shapes `boolean`, `string[]` and `string[]`, each optional. The renderers
  already honoured all three, reading them through a cast, while the published
  surfaces said nothing about them. Both surfaces now accept what the
  contract accepts, and nothing past it:
  
  - **`@object-ui/types`** — `RecordDetailsComponentProps`,
    `RecordHighlightsComponentProps` and `RecordRelatedListComponentProps` gain
    `enforceFieldSecurity?: boolean`, `redactFields?: string[]` and
    `requiredPermissions?: string[]`. A document the contract accepts is no longer
    refused by `tsc` with `TS2353`; a wrong-typed value (a bare string for
    `requiredPermissions`, the string `'true'` for `enforceFieldSecurity`) is
    refused, as the contract refuses it.
  - **`@object-ui/plugin-detail`** — the three blocks' registry `inputs` publish
    the three keys, so `sdui.manifest.json`, `sdui-intrinsics.d.ts` and the parser's
    prop walk stop treating them as unknown. Each input carries the contract's type
    (`boolean`, or `array` of `string`) and this block's own `.describe()` text
    from the spec, verbatim.
  
  **No rendering, gating or masking behaviour moves.** The renderers read the
  three keys without the cast now, so the reads carry the declared types; the
  emitted JavaScript of all three renderers is byte-identical to before.
  `requiredPermissions` is still the ADR-0066 capability gate (all named
  capabilities held, or an insufficient-permissions notice takes the block's
  place; fails open when the client cannot resolve capabilities), and
  `redactFields` / `enforceFieldSecurity` are still presentation-only folds over
  the block's own field or column list — none of them is a data-access control.
  
  ⚠️ This supersedes one paragraph of another pending note in the same release,
  from this card's first half: it says these three keys are deliberately NOT
  declared and routed to the producer. That was true against `@objectstack/spec`
  17.4.0; the producer declared them in 17.5.0, and this entry is the result.
- 6df26f0: fix(plugin-detail): `record:related_list` field security now fails closed on a column it cannot name
  
  The block filters `columns` against the field-security allow-list built from
  `enforceFieldSecurity` / `redactFields`. Its else-branch KEPT any entry whose
  identity it could not resolve. That branch was the bypass: the block resolves a
  column through `columnIdentity`, which deliberately refuses the table library's
  own `accessorKey` (objectui#3104 — TanStack's column key is not ObjectStack
  metadata identity), while `RelatedList` renders a column as
  `accessorKey || columnIdentity(c)`. So a column authored `{ accessorKey: 'salary' }`
  was named by nobody in the filter, skipped both the FLS check and the redact
  list, and then painted its real values through the table's own key.
  
  An entry the security fold cannot check is now excluded rather than kept.
  
  **Behaviour change, deliberately narrowing.** On a related list that switches
  the filter on, a column whose identity resolves to none of `field` / `name` /
  `fieldName` / `key` is no longer handed down — including one authored purely in
  the `accessorKey` spelling, and including the case where the redacted or denied
  field is some other column entirely. Lists that set neither key are untouched:
  the fold does not run there and `columns` is still handed down by reference.
  The protocol-declared spelling for this key is a field-name string
  (`RecordRelatedListProps.columns`), which resolves and is unaffected.
  
  **What that moves on screen, measured by ablation on the current base.** Two of
  the three legs now have a second gate below this one: `RelatedList.filterFLS`
  refuses a declared field that field security denies, and since objectui#9090
  `RelatedList.filterRedacted` refuses a redacted one — both resolving the same
  `accessorKey || columnIdentity` pair this fold refuses, so both already stopped
  such a column from painting. The leg this repair still moves on its own is a key
  the permission evaluator has no opinion about, one the child object never
  declares: `checkField` default-allows it downstream, and the fold is the only
  thing that can refuse it.
- e77a003: `record:chatter.feed` / `record:discussion.feed` apply the filter members the
  protocol declares on them (objectui#8934).
  
  **Behaviour change on shipped pages.** Read the defaults section below before
  upgrading.
  
  **The gap.** `@objectstack/spec` declares `RecordChatterProps.feed:
  RecordActivityProps.optional()` (`component.zod.ts:1366`), bound to both
  `record:chatter` (`:2948`) and `record:discussion` (`:2962`). So `feed` is the
  full `record:activity` shape, `types` / `limit` / `showCompleted` /
  `unifiedTimeline` included. `RecordChatterRenderer` handed
  `DiscussionContext.items` to the panel raw, and `applyFeedConfig` — the pipeline
  those four members are applied by — had exactly one call site,
  `renderers/record-activity.tsx`. An author who wrote a spec-legal
  `feed: { types: ['comment'] }` therefore got no filtering, no diagnostic and no
  way to tell.
  
  **The fix.** `renderers/record-chatter.tsx` now runs `applyFeedConfig` before
  handing items to `RecordChatterPanel`, with `record-activity.tsx:219`'s call
  shape — not a second convention — and reads `limit` as the page window that
  "Load more" grows by, the same way. The registration description is unchanged
  in substance: it still says `feed` is the same shape as `record:activity`, and
  now names the spec symbol it delegates to.
  
  **Defaults come with the shape, and two of them are visible.** This applies to
  an **authored `record:chatter` / `record:discussion` block**, and to every
  synthesized default page (which emits `record:discussion`) — those are the
  surfaces that render through `RecordChatterRenderer`. At this change the panel
  the host auto-appends when a page omits a discussion block mounted
  `RecordChatterPanel` directly and did **not** run this pipeline, so it was
  unchanged and rendered a different feed from the authored block on the same
  record; that divergence was filed as objectui#8983 and has since been closed —
  the fallback now mounts this renderer with no schema, so both chatter surfaces
  run the one pipeline and render the same feed. On the surfaces this change
  reaches:
  
  - `showCompleted` defaults to `false`, so **completed activities (feed type
    `task`) are no longer rendered** unless the block authors
    `feed: { showCompleted: true }`. A panel that was showing them will stop.
  - an unauthored `limit` is `DEFAULT_ACTIVITY_LIMIT` (**20**), so a feed longer
    than twenty items now **pages**, with a "Load more" control, instead of
    rendering whole. Nothing is dropped — the window grows by `limit` per click.
  
  `unifiedTimeline` and `types` change nothing unless authored: both are absent-is-
  no-filter.
  
  **Not closed by this change**, and not claimed to be: `filterMode` and
  `enableMentions` are also members of the declared shape and were still unread on
  this path when this change landed — `RecordActivityTimeline` takes `filterMode`
  as a component prop rather than off `config`, and the chatter path's mentions
  come from the host context. Tracked as objectui#8968, and closed by it in this
  same release — see that entry. The host fallback panel described above was
  tracked as objectui#8983, since closed — see the note above it.
  
  Marked `minor` rather than `patch`: this repository never declares `major` (the
  fixed release group would drag every package off `@objectstack`'s cadence), and
  its own breaking-semantics changes are `minor` with the breakage spelled out in
  the notes — which is what the two bullets above are. The previous revision of
  this changeset said `patch`, correctly for a description-only edit; that is not
  what this is any more.
- 88561fd: `record:chatter` / `record:discussion` now read `feed.filterMode` and
  `feed.enableMentions` (objectui#8968).
  
  `@objectstack/spec` declares `RecordChatterProps.feed` as `RecordActivityProps`,
  bound to both block names, so every member of the activity shape is authorable
  inside `feed`. objectui#8934 made the four filter members live by running
  `applyFeedConfig` on this path; two members sit outside that pipeline and stayed
  unread. Both are wired now, with `record:activity`'s own reading rather than a
  second local one:
  
  - **`feed.filterMode`** seeds which slice the panel opens on, normalized through
    the same function `record:activity` uses (an unrecognised value opens on `all`
    rather than on a filter nothing matches). It seeds component STATE, so the
    dropdown stays usable instead of being frozen on the authored value.
  - **`feed.enableMentions`** gates the composer's @-autocomplete. `false`
    withholds the host discussion context's suggestion list, which is the
    behaviour the `record:activity` registration publishes for this key. The
    protocol's default is on, so an unauthored member keeps the affordance.
  
  **Behaviour change for existing schemas.** An authored `feed.filterMode` other
  than `all` now actually narrows the chatter feed, and an authored
  `feed.enableMentions: false` now actually removes the @-autocomplete. Both were
  accepted and discarded before. Schemas that authored neither key are unaffected.
  
  `filterMode` and `showFilterToggle` are independent: with the dropdown gated off,
  an authored `filterMode` becomes the author's fixed slice rather than becoming
  inert. The reasoning is in the renderer's docblock and pinned by
  `recordChatterFilterModeMentions-8968.test.tsx`.
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
- 9f5c017: fix(plugin-detail): `record:details` field security now fails closed on an entry it cannot name
  
  `filterList` filters `fields` and `sections[].fields` against the allow-list
  built from `enforceFieldSecurity` / `redactFields`. Its else-branch KEPT any
  entry whose identity it could not resolve, and its identity reader is
  `columnIdentity` alone — so every entry that is not a bare string, `{ field }`,
  `{ name }` or `{ fieldName }` escaped BOTH controls. A field-security control
  defaulting to *permit* on the one input it could not understand is the worst
  available default for a control; the entry is now excluded instead.
  
  This is the same one-arm repair objectui#8793 made on `record:related_list`'s
  fold, deliberately identical: one defect on two paths gets one shape.
  
  **Measured, and narrower than its sibling.** No record VALUE was reaching the
  screen through the kept entry. `RelatedList` resolves a column as
  `accessorKey || columnIdentity(c)`, a second read point that could name what
  the fold could not — that is what made objectui#8793 a data leak.
  `DetailSection` renders from `field.name` only, so the kept entry painted a
  labelless "no value" placeholder row and never a value. What is closed here is
  the fail-open default, not a measured exposure.
  
  **Behaviour change, deliberately narrowing.** On a detail block that switches
  the filter on, an entry resolving to none of `field` / `name` / `fieldName`
  stops rendering — including one authored purely in the table library's
  `accessorKey` spelling, and including the case where the redacted or denied
  field is some other entry entirely. What disappears is the placeholder row that
  entry already rendered, never a value. Blocks that set neither key are
  untouched: the fold does not run there and the list is handed down by
  reference. The spec-declared spelling for these keys is a field-name string,
  which resolves and is unaffected.
- 689953a: Keep the `{ dialect: 'cel', source }` predicate envelope intact through a node's
  config bag, so a CEL visibility gate authored the canonical way reaches the CEL
  engine instead of the legacy JS one (objectui#9100).
  
  **The defect.** `SchemaRenderer`'s per-value `properties` / `props` evaluation loops
  handed every bag value to `ExpressionEvaluator.evaluate`, whose first action is to
  unwrap any `{ source: string }` object down to its bare `source` — the unwrap that
  makes a `template` envelope interpolate. Applied to a `cel` predicate it was
  destructive: the envelope is the only thing that routes `evaluateCondition` to the
  canonical `@objectstack/formula` engine, and those loops run before the hoist, so
  both consumers — `SchemaRenderer`'s own visibility chain and the renderer's
  `toPredicateInput` → `useCondition` call one layer down — received a bare string and
  took the legacy JS path, where a CEL stdlib call such as `has()` is not a function.
  
  Both polarities then failed silently, in opposite directions. On the four SHOW legs
  (`visibleWhen` / `visible` / `visibleOn` / `visibility`) the fail-soft `true` is
  negated, so **a gate authored to hide something rendered it on every row** — measured
  in a real browser, where a duplicate-lead banner showed on 6 of 6 records whose field
  was `null`. On the two HIDE legs (`hidden` / `hiddenOn`) the same `true` is returned
  un-negated, so **the node vanished entirely**. Neither is distinguishable on screen
  from a predicate that said so on purpose.
  
  **Behaviour change, deliberately.** A `cel`-envelope predicate on any of those six
  keys, authored inside `properties` or `props`, now actually decides. Metadata that
  was relying — knowingly or not — on such a gate never biting will start seeing nodes
  hidden (SHOW legs) or shown (HIDE legs) as authored. Nothing else moves: a `template`
  or dialect-less envelope keeps the legacy `${…}` behaviour byte-for-byte, a
  non-predicate bag key keeps the flattening it has always had, and node-level
  predicate keys were never affected (they do not pass through these loops, which is
  why objectui#7530's pin stayed green throughout).
  
  **`record:alert` declaration.** Its `visible` input was registered as a bare
  `'string'` while `@objectstack/spec` 17.4.0 declares
  `boolean | string | { dialect, source }` for the same key and the renderer resolves
  all three. It is now declared `['boolean', 'string', 'object']`, in the same change
  that made the envelope arm actually reachable.
- 6d5db7b: Give a read-only `file` field a per-file view/download affordance (objectui#9161).
  
  A `file` field in read-only state produced no way to reach the file it holds. On the
  record-detail page a multi-value field rendered the bare text `1 file`, a single value
  rendered a bare filename, and the edit-state row rendered a filename beside a delete
  button — the reporter's DOM reading of the field block was one `<button>` (the delete
  icon) and zero anchors. Every other layer was healthy on the reporting card: the record
  read returned the expanded `{id, name, size, mimeType, url}`, the signing endpoint
  answered 200, fetching the signed URL answered 200 with a correct `content-disposition`,
  and a cross-owner read answered 200 too. A file that uploaded successfully simply could
  not be opened or downloaded from the product's own PC Console.
  
  **What changed.** All three read faces now render, per file, its name AND a
  keyboard-reachable view/download link:
  
  - `FileCellRenderer` — the renderer a record-detail page actually resolves for `file`
    (and for `video` / `audio`, which ride the same entry) — normalises through
    `readFileValues`, the treatment `ImageCellRenderer` already applies to the same spec
    family, so an expanded value, a string URL, a CDN link and an unexpanded bare
    `sys_file` id all resolve.
  - `FileField`'s `readonly` branch and its edit-state file rows draw the same affordance.
  
  **No new endpoint, permission model, authoring switch or translation key.** The URL was
  already in hand on every arm: `readFileValue` returns the expanded value's own `url`, or
  derives the stable `/api/v1/storage/files/:id` endpoint from a bare id — and that
  endpoint already 302-redirects to a freshly-signed short-lived URL per request. The link
  text is the file name, which is the anchor's accessible name, so nothing new had to be
  translated; a value carrying no name of its own still falls back to the existing
  `fields.file.fileFallback`.
  
  **Behaviour that moved, deliberately.**
  
  - A NON-EMPTY array no longer renders only its count. `2 files` becomes the two files.
    The count survives where it is the whole truth: an array that resolves to no
    renderable file still states `0 files` through the same i18n channel (objectui#8496 /
    objectui#8441), rather than drawing the em-dash.
  - A value that resolves to no URL renders as plain text, never as a dead anchor — the
    ruling objectui#8490 made for `email` / `url` / `phone`, applied to this family.
  - `file` / `video` / `audio` move into `CHIP_UNFIT_RENDERER_TYPES` in `plugin-detail`.
    The `summaryFields` chip beside the record H1 hosts text, not controls (objectui#8464),
    so it now draws those kinds through `coerceToSafeValue` instead of their cell renderer.
    The chip's TEXT is unchanged — `coerceToSafeValue` reads the same `name` the renderer
    reads — and the file stays reachable one band down, in the field's own cell.
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
- 345e24a: **BREAKING** — `RecordContextValue.dataSource` is the DataSource **adapter** it
  has always held, not a datasource id string.
  
  **FROM** `dataSource: 'ds_primary'` **TO** `dataSource: myAdapter` (any
  `DataSource` from `@object-ui/types`).
  
  ```ts
  // before — compiled, but no producer ever did this and no reader could use it
  const ctx: RecordContextValue = { objectName: 'account', recordId: 'r1', dataSource: 'ds_primary' };
  // after
  const ctx: RecordContextValue = { objectName: 'account', recordId: 'r1', dataSource: myAdapter };
  ```
  
  The member was declared `dataSource?: string` — "an optional datasource id;
  mirrors the page-level datasource override" — while the one production host
  that writes it (`@object-ui/app-shell`'s `RecordDetailView`) forwards an adapter
  OBJECT and every reader calls adapter methods on it. Measured on the base tree:
  of the provider sites in this repository that write the member, exactly one is
  non-test and it passes the adapter; the only in-repo writer of a string was a
  test fixture, which existed because the declaration invited it. So the id was
  never a contract anyone kept — it was a statement the code contradicted at every
  site, and the override it described has zero producers. Contract-first
  (Commandment #0.1): the declaration moves to what the code holds, and no second
  `dataSourceId` member is minted for a requirement nobody implements.
  
  What it bought: each reader paid for the wrong declaration with a cast at the
  point of use, and a cast deletes the compiler's answer to "does this adapter
  have the method I am about to call". All 11 record-context read sites are now
  cast-free, across `@object-ui/app-shell`, `@object-ui/components` and
  `@object-ui/plugin-detail`. The worked instance is objectui#8883's reference
  rail: it reaches `dataSource.getObjectSchema` — a REQUIRED member of
  `DataSource` — and now gets that guarantee from the compiler instead of from
  `(ctx as any)`.
  
  ⚠️ Nothing to migrate at runtime and no data change: every producer already
  passed the adapter, so no value moving through this member changes. A
  TypeScript consumer outside this repo that read the member as `string` is not
  observable from here and gets a compile error (TS2322) naming the key — which
  is why the FROM/TO is spelled out above. Re-widening to `string | DataSource`
  would not be a kindness: a union member without `getObjectSchema` cannot be read
  without narrowing, so it re-breaks every reader this change repaired. Both
  directions are pinned against the real compiler in
  `RecordContext.dataSourceType.pin.test.ts`.
  
  ⚠️ `SchemaRendererContextValue.dataSource` one context over is a **different**
  declaration (`any`) and is **not** touched here. Five `as any` reads in
  `@object-ui/fields` key off that context, not this one; they are unaffected by
  this change and are reported separately.
  
  objectui#9197.
- 7cbc724: Retire `icon` from the `record:highlights` `fields[]` entry, across all three layers that
  carried it (objectui#9280).
  
  **Breaking, deliberately.** `{ name: 'amount', icon: 'dollar-sign' }` on a
  `record:highlights` entry no longer type-checks. Nothing that worked stops working: the key
  was never authorable in the first place, and this change is what makes `tsc` say so.
  
  `@objectstack/spec` `RecordHighlightsProps.fields[]`'s object arm declares exactly
  `name`/`label`/`type`/`readonly` behind a `never` catchall — it is `$strict`, so an unlisted
  key is REFUSED, not stripped, and the refusal takes the WHOLE document with it. Re-measured
  on this branch against the installed pin (17.4.0) rather than inherited from the card, with
  three controls in the same pass so the instrument is not blind:
  
  ```
  fields[] object-arm keys : ["label","name","readonly","type"]   catchall: never ($strict)
  { fields: [{ name:'x', label:'L' }] }      GREEN                          <- CONTROL
  { fields: [{ name:'x', icon:'star' }] }    RED  invalid_union at fields.0
  { fields: [{ name:'x', zzzNonsense:1 }] }  RED  invalid_union at fields.0  <- CONTROL
  { fields: ['x'] }                          GREEN                          <- CONTROL
  ```
  
  A declared key parses green, so the arm is not refusing everything; an arbitrary key is
  refused with the SAME code as `icon`, so `icon` was not special-cased; the bare-string arm is
  untouched, so only the object arm moved.
  
  FROM → TO, per layer:
  
  - `packages/types/src/record-components.ts` — `RecordHighlightsComponentProps.fields[]`'s
    object arm: `{ name; label?; icon?; type?; readonly? }` → **`{ name; label?; type?; readonly? }`**.
    The key is **removed, not tombstoned**: the contract's arm is `$strict`, so the refusal an
    author needs already exists upstream and arrives named (`invalid_union` at the entry). A
    `?: never` tombstone buys nothing here — it is the remedy for a non-strict mirror that
    would otherwise strip in silence, which is not this arm.
  - `packages/plugin-detail/src/renderers/record-highlights.tsx` — the entry normalizer stops
    copying `icon: f?.icon` into the normalized entry. That read was **unreachable**, not
    merely unused: no author could feed it past the `$strict` arm, and `HeaderHighlight`
    renders no `.icon` on the far side either, so the copy had no consumer in either
    direction.
  - `packages/plugin-detail/src/index.tsx` — the registry manifest's `fields` input description
    sketched the entry as `{name,label?,icon?,type?,readonly?}` → **`{name,label?,type?,readonly?}`**.
    The `inputs` ARE the published contract (`gen-manifest.ts` serializes them into
    `sdui.manifest.json` and `sdui-intrinsics.d.ts`), so leaving the sketch standing would have
    gone on teaching AI and human authors a key that gets the whole document refused at publish.
  
  **Migration.** Nothing in this repository has to change. An in-repo census over every
  `record:highlights` region (109 regions, all tracked files) scores an entry-level `icon`
  **0**, against `readonly` **23** in the same pass over the same regions — the instrument was
  not blind. If you author `icon` on a highlight entry in your own metadata, delete it: it was
  already causing the publish to refuse the document whole. Whether a highlight chip *should*
  be able to carry an icon is a separate question this change does not answer — the route for
  that is an upstream `@objectstack/spec` widening, on its own card, ⛔ never a redeclaration
  here.
  
  ⚠️ `sections[].icon` on `RecordDetailsComponentProps` is a **different key on a different
  face** and is **unaffected**: the contract declares it and `DetailSection` genuinely draws
  it. Two keys sharing a word in one file are not the same key.
  
  Pinned in `packages/types/src/__tests__/record-highlights-fields-icon-9280.test.ts` across
  three instruments that do not see the same thing — a `tsc` `@ts-expect-error` leg with a
  `{name,label}` control that stays green, `safeParse` legs against the installed spec
  artifact, and a source-text read whose lit control is that very `sections[].icon` member, so
  an empty result on the highlights arm is a reading rather than a matcher that cannot match.
  `packages/plugin-detail/src/__tests__/recordHighlightsInputs.spec-parity.test.ts` gains the
  REVERSE direction it was missing: it already failed when a spec entry key went undocumented,
  and now also fails when the description advertises an entry key the spec refuses.
- 4a94c38: All three percent surfaces read `scale` for their fraction width, not
  `precision` (objectui#9295).
  
  `PercentCellRenderer` in `@object-ui/fields`, the `colType === 'percent'` arm of
  `formatSummaryLabel` in `@object-ui/plugin-grid`'s `useColumnSummary`, and the
  record summary chip's percent branch in `@object-ui/plugin-detail`'s
  `DetailView` each took `precision` and handed it to `Intl` as BOTH the minimum
  and the maximum fraction digits. `@objectstack/spec` declares the pair in its own words on both
  the field face and the column face: `precision` is the "Total digits" of a
  `decimal(p, s)` column and `scale` is its "Decimal places" — so a percent field
  was padded out to the column's TOTAL width. A `decimal(10, 2)` percent field
  rendered `25.0000000000%` in the cell, `Sum: 25.0000000000%` in the footer
  directly beneath it, and `25.0000000000%` again on the record summary chip. This
  is the identical defect objectui#2131 removed from the currency arm and
  objectui#2134 from the number arm, arriving one type later; in `useColumnSummary`
  the corrected percent arm now reads `scale`, as the currency arm beside it did
  when this change was made (objectui#10221 later moves that arm to the currency's
  own minor unit).
  
  The summary chip moves because objectui#9167 routed it onto the LIST CELL as its
  authority and its ruling turns on the two being byte-equal, so the member was
  always incidental there: following the cell is what KEEPS that ruling. Its pin
  asserts both halves and is what caught the chip being left behind.
  
  **Breaking, deliberately — filed as `minor` because this repo's fixed release
  group forbids `major`.** Percent rendering moves in two directions:
  
  - A percent field, column or summary chip declaring `scale` now honours it.
    Declaring `scale: 2` previously rendered `25%` and now renders `25.00%`.
  - A percent field, column or summary chip declaring `precision` no longer pads
    to it. Declaring `precision: 10` previously rendered `25.0000000000%` and now
    renders `25%`.
  
  **Migration.** Restate the intended fraction width as `scale`, which is the
  member the contract has always declared for it. Metadata carrying an accurate
  `decimal(p, s)` pair — both members, as a database column exposes them — needs no
  change and simply stops being padded.
  
  **Unchanged: a percent field that declares neither member.** An absent `scale`
  is still zero fraction digits, so this is invisible to metadata that declares
  nothing. That default is a decision rather
  than a leftover: the number cell renderer spells the same absence as
  `undefined` (minimum 0, maximum 20), and copying it here would print binary
  floating-point residue, because the percent path multiplies by 100 first and
  `Intl` renders from the shortest decimal representation of the resulting double
  — a stored `0.07` becomes `7.000000000000001` and `0.29` becomes
  `28.999999999999996`. The number arm can afford an unbounded maximum because it
  performs no arithmetic on the value.
  
  `CurrencyConfigSchema.precision` is untouched and must not be conflated with
  this: it is a different surface with the opposite convention and its own
  `scale` alias, and the spec says so at the field-face declaration.
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
- ba0b61a: fix(plugin-detail): `DetailView`'s header and the `record:details` H1 dedupe rank the declared `nameField` above `titleFormat`, the ADR-0079 order
  
  ⚠️ Behaviour change: which heading `DetailView` shows, and which row
  `record:details` hides. Declared `minor` under this repo's fixed-group
  versioning. Executes ruling C1 on objectui#9436, alongside the same change to
  `PageHeaderRenderer` in `@object-ui/components`.
  
  - **`DetailView` header.** `resolveDisplayTitle` used to try `titleFormat`
    right after the view-level `primaryField`, and before the object's declared
    pointer. The declared pointer (`nameField`, then its deprecated
    `displayNameField` alias) now sits between the two, so on an object
    declaring both, the heading is the pointer's value. `primaryField` still
    wins over everything. A pointer that is blank on the record still falls
    through to the template. A `primaryField` or pointer that the loaded
    permission policy denies the viewer falls through the same way, as if blank
    (objectui#10434).
  - **`record:details` H1 dedupe.** The body hides the one row the record page
    H1 already shows. It used to check the template first, which mirrored the
    header's old order. With the header moved, that would have printed the
    pointer's row directly under an identical H1. On a single-field template it
    would also have hidden a row the H1 no longer showed. The dedupe now reads
    the declared pointer first: when it holds a value the viewer may read
    (objectui#10434), that field's row is the one hidden and the template is not
    consulted. The template outcomes ruled on
    objectui#8351 are unchanged wherever the template really is the H1, which
    is when no pointer is declared or the pointer is blank on the record.
  
  **Upgrade effect.** It is the same set of objects as the header change: any
  object declaring both a `nameField` (or `displayNameField`) and a
  `titleFormat` that renders something else. Measured once, at objectstack
  `61609edf`, and not re-derived by any gate here, that reaches 16 ObjectStack
  platform objects. For 5 of them (`sys_approval_action`,
  `sys_approval_approver`, `sys_approval_request`, `sys_automation_run` and
  `sys_http_delivery`), `nameField: 'id'` makes the heading the raw record id.
  That is a known consequence of the ruled order. The fix belongs to those
  objects' metadata in ObjectStack: a formula field designated as `nameField`.
- 80a0ecd: An authored `detail-section` node now takes `icon`, and draws it.
  
  `DetailSection` draws `section.icon` before the title in both of its header
  branches, but the `detail-section` registration did not declare `icon` among
  its `inputs`, and the node adapter folds only declared names into the section
  it hands the component. So an author who wrote `icon` on the node was warned
  `unknown-prop "icon"` by the JSX-page compiler's validator — which judges an
  authored page against these same `inputs` — and the header drew no icon.
  
  The registration now declares `{ name: 'icon', type: 'string' }` (a Lucide icon
  name such as `map-pin`), and the adapter folds it like the other declared
  inputs. A non-string `icon` now draws `type-mismatch` instead of `unknown-prop`.
  
  **Clause-②: yes** — the authoring surface of `detail-section` widens by one
  key, `icon`, which the renderer already honoured. No other key's verdict moves at
  this change: `name`, which the block neither declares nor reads, still draws
  `unknown-prop`.
  No exported symbol is added, removed, renamed or retyped — the package entry
  re-exports neither `DetailSectionNode` nor `DETAIL_SECTION_NODE_INPUTS`. The
  tag is outside the public block tier, so the generated `sdui.manifest.json` and
  `sdui-intrinsics.d.ts` never carried it and do not change.
  
  ⚠️ **Dated note, 2026-09-29 — `name` no longer draws `unknown-prop` on this node —
  objectui#11044.** Later in this same release, `name` becomes a `where-undeclared`
  base prop of the JSX-page compiler's validator: a base prop on every type that
  declares no input of that name. `detail-section` declares none, so an authored
  `name` on it now draws nothing, although the block still does not read it. The
  sentence above is kept as the reading of this change; the objectui#11044 entry
  states what ships.
- 272a530: `record:*` blocks honour the `aria` bag the protocol declares on them, and
  `RecordComponentAriaProps.ariaLabel` states the contract's inline locale
  vocabulary instead of narrowing it to `string` (objectui#9556).
  
  ## What an author could write, and what happened to it
  
  `@objectstack/spec`'s props schema for `record:details`, `record:highlights`,
  `record:related_list`, `record:activity`, `record:chatter` and `record:path`
  each declares an `aria` bag, so a document carrying
  `aria: { ariaLabel: 'Account overview' }` on any of them **parses green at
  publish**. None of those six renderers put it anywhere a user could reach: five
  read the key not at all, and `record:path` read `(schema.aria as any)?.label` —
  the one spelling the shared ARIA shape REFUSES — so it discarded the spec-valid
  `ariaLabel` and honoured only a spelling no author can write without the
  contract rejecting the document. Zero of the six declared slots was live. That
  is the dead-read-point pair objectui#4663 repaired on `record:quick_actions`,
  still open on the rest of the family, and it lands on screen-reader users: the
  author wrote an accessible name, got a success receipt, and nobody heard it.
  
  Under the maintainer's standing principle — spec declaration over
  implementation over docs — an accepted-then-dropped key is an implementation
  gap, so the six renderers gain the read. ⛔ Nothing is narrowed on the consumer
  side, and ⛔ no declaration is retired here.
  
  ## The two declaration changes
  
  - **`@object-ui/types` — `RecordComponentAriaProps.ariaLabel` is now
    `string | I18nLabel`.** `AriaPropsSchema.ariaLabel` is
    `z.union([z.string(), InlineLocaleMapSchema])`, so the bare `string` was a
    narrowing: a map-valued name like `{ en: 'Deal stages', 'zh-CN': '阶段' }`
    parsed at publish and `tsc` refused it here. This is a fourth site of
    objectui#9092's Group A, missed there because it is reached through a shared
    interface rather than restated inline. **For a `.d.ts` consumer:** writing
    `aria.ariaLabel` gains the map arm and no existing write breaks; a consumer
    that *reads* the member into a `string` position now sees
    `string | I18nLabel | undefined` and is named by the compiler — which is the
    audit the widening exists to produce, and is why this is `minor` rather than
    `patch`. Every in-repo reader of the six interfaces lives in
    `@object-ui/plugin-detail`, and both packages type-check clean.
  - **`@object-ui/plugin-detail` — no new published symbol.** The shared read
    point (`renderers/recordComponentAria.ts`) is internal; it is not added to the
    package barrel, so `dist/index.d.ts` gains nothing. What changes is
    behaviour. `record:quick_actions`' own props interface keeps its `aria`
    member and is retyped from an inline `{ ariaLabel?, label? }` to the family's
    bag, which widens `ariaLabel` there the same way.
  
  ## Behaviour, stated exactly
  
  A block that is authored with no `aria` keeps **the same attributes with the
  same values** it has today: the five containers stay bare `div`s and gain
  nothing at all, `record:path`'s rails keep `role="list"` and their localized
  pack name, and `record:quick_actions` keeps `role="toolbar"` and its built-in
  "Quick actions". Every current default is passed to the shared read point as
  that block's `defaultRole` / `defaultLabel` rather than removed. (Stated as the
  attribute set and not as the bytes: on the two blocks that already emitted ARIA,
  the same pair now arrives through a spread, so their serialization ORDER can
  differ while the accessibility tree does not.)
  
  When an author *does* declare the bag, the container gains `aria-label`,
  `aria-describedby` and a role — **a role, and not only the attribute, because
  `aria-label` on a bare `div` reaches nobody**: a `div` is `generic` and browsers
  expose no accessible name on it. This family has already paid for that once, in
  `record:path`'s inert `aria-label="Alternative terminal stages"`. So the five
  containers fall back to `role="region"` when named, matching
  `@object-ui/plugin-list`'s live read point
  (`role={schema.aria?.role ?? 'region'}`), and an authored `aria.role` overrides
  every default. The new pin asserts through `getByRole(role, { name })` rather
  than through the attribute, so a fix a screen reader cannot hear would fail it.
  
  ⚠️ **On `record:activity` and `record:chatter` the authored name does not
  replace the panel's own.** Those blocks mount a panel that already renders a
  named `<section>`, so an authored name lands on the block's outer container and
  the panel keeps its inner one — two nested named regions. That is measured and
  pinned as the shipped behaviour, ⛔ not as the right answer; objectui#9556 asks
  whether the authored name should replace the panel's, and that would have to be
  plumbed into `RecordActivityTimeline` / `RecordChatterPanel`.
  
  ## What is deliberately NOT done
  
  - **The legacy `aria.label` alias gains no reader and loses none.** It is read
    on `record:path` and `record:quick_actions` — the two blocks whose renderers
    already read it — and ⛔ on no other block. The shared read point takes it as
    an OPT-IN (`legacyLabelFold`), so the five container blocks do not read it:
    no stored document was ever served by the alias on those five, so the
    back-compat rationale does not reach them, and AGENTS.md #0.1 refuses a
    consumer-side alias with no such document behind it. It remains declared on
    no authoring face, and the contract refuses it, so it cannot mask a new
    authoring mistake. Both directions are pinned. Whether to retire it on the
    two as well reverses objectui#4663's pinned decision and is left open on
    objectui#9556 rather than settled in passing.
  
    ⚠️ **Dated note, 2026-09-25: the alias has since been retired on those two
    blocks as well, by objectui#9945.** Later in this same release the
    maintainer ruled the question this bullet leaves open (ruling `5749677059`,
    letter A). The shared read point now reads `aria.ariaLabel` only, so
    `record:path` and `record:quick_actions` no longer read `aria.label` either:
    they announce their default names, and a served `aria.label` on them is
    reported with a `console.warn`. The bullet above is kept as the reading of
    this change. The objectui#9945 entry states what ships, and the migration
    (`aria.label` becomes `aria.ariaLabel`).
  - **No `aria` declaration is added for `record:quick_actions`.** The protocol
    declares none on `RecordQuickActionsProps` and refuses the bag there with a
    message naming objectui's renderer as the thing that moves first; mirroring it
    onto a published `@object-ui/types` face would declare a key the contract
    rejects.
  
  ⛔ No count, list or population in the text above is written down as a fact to be
  trusted: which blocks the contract declares `aria` on, which spellings the shared
  shape accepts, and whether `record:quick_actions` still refuses the bag are all
  re-derived from the installed `@objectstack/spec` artifact on every run by
  `renderers/__tests__/recordComponentAria-9556.test.tsx`, which goes red the day
  the protocol moves either boundary.
- 905913c: `RecordRelatedListRenderer`'s props type refuses a misspelled key again (objectui#9963).
  
  The renderer's own `schema` member was the `RecordRelatedListComponentProps` mirror
  intersected with `Record<string, any>`, and `RecordRelatedListRendererProps` carried
  `[k: string]: any` as well. An index signature admits any key at `any`, so a misspelled
  declared key — `schema.relationshipValueFeild` — type-checked at every read in the
  renderer, cast or not: the refusal the mirror declares stopped one type layer short of
  the reads it exists for.
  
  The type is now looser than the mirror in exactly the two places objectstack#6953 needs,
  and both are named members instead of an open index: `objectName` is optional (the
  `ElementDataSourceGate` wrapper binds it from the binding), and `dataSource` is admitted
  as that binding, typed with the gate's own `ElementDataSourceConfig` from
  `@object-ui/core`. The documented authoring shape
  `{ relationshipField, dataSource: { object, view } }` still type-checks. The host props
  are the ones the component reads — `schema`, `className`, `style`, `data-obj-id`,
  `data-obj-type`.
  
  **Breaking for TypeScript callers only**, declared `minor` per this repo's version
  policy: a typed call site that wrote a key outside that set — a typo, or one of the
  three keys the renderer reads through a cast (`requiredPermissions`,
  `enforceFieldSecurity`, `redactFields`), which no block the contract maps onto this tag
  declares — now fails to compile. The registry path is untouched: `SchemaRenderer`
  reaches this component through an untyped registry entry and forwards exactly what it
  did before, and the rendered output does not change.
- d06fba8: The console record page and the `record:activity` block read ONE `sys_activity`
  type table, so a scheduled meeting no longer appears on one and vanishes on the
  other.
  
  `RecordDetailView`'s `sys_activity` merge carried a hand-written copy of the
  table that `record:activity` exports as `ACTIVITY_TYPE_TO_FEED_TYPE`. Neither
  file imported the other and nothing compared them, so the two could drift
  silently — and they had. objectui#5840 added `scheduled` -> `event` to the
  exported table, because a shipped producer (HotCRM's `schedule_meeting`) writes
  that value and the row was being dropped before any filter ran. The copy here
  was left untouched, so the same row rendered on a hand-authored record page and
  was dropped on the console record page: same record, same row, two answers.
  
  `RecordDetailView` now imports the exported table, and the copy is gone. The
  table is re-exported from `@object-ui/plugin-detail`'s entry point, which is
  what makes a single reading possible at all — it was previously reachable only
  from inside the plugin. No module enters the eager closure: the module holding
  it was already pulled in by the renderer beside it.
  
  Adding an activity type is now one edit, in one place, that both surfaces see.
  A re-fork is caught rather than merely discouraged: the new pins spy on the
  shared object and inject a member into it at runtime, so a private copy holding
  today's members exactly — the failure this change removes — fails, where a
  value comparison would pass on the defect.
  
  Only the table converges. The row-to-`FeedItem` construction around it is still
  written twice, so an unmapped activity type is still dropped silently on the
  console surface where the block warns once; that mirror is filed separately.
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
- 0b12a33: `record:path` stops looking like a control it cannot be.
  
  The record page draws the object's lifecycle across the top from the
  `stageField` role, and it drew each stage as a filled, shadowed, equal-width
  pill — a segmented button group, sitting exactly where a CRM user reaches for
  the stage control. Nothing was behind it. Measured in a browser on a shipped
  build (HotCRM `crm_quote`, and this is generic record chrome, so every object
  that declares a `stageField` has it): the segments were `role="listitem"` with
  `cursor: auto` and `tabindex` null, no ancestor `button`/`tab`/`a`, and a full
  pointer sequence (pointerdown → mousedown → pointerup → mouseup → click) left
  the record's status untouched. Advancing a record needs the edit form or a bulk
  action. Users spent two or three clicks on the path before concluding it was
  decoration.
  
  There is no write path to connect it to, and this change does not open one:
  this renderer's only channel is `useRecordContext()`, whose value exposes
  `data` / `refresh` / `headerSystemActions` / `onToggleFavorite` and no
  record-field mutation. Editing runs through `record:details`'
  `<InlineEditProvider>` + `<InlineEditSaveBar>` (`dataSource.update(...,
  { ifMatch })`) or an action via `useActionEngine`; neither reaches this
  component.
  
  So the promise is withdrawn rather than honoured. Each stage now renders as a
  thin decorative rail segment with its label as plain text beneath it — the
  vocabulary app-shell's approval step readout already uses. Gone: the per-stage
  filled pill, the shadow, the ring, the bordered chip, the equal-width tap
  target. Kept exactly as they were: which stage is current (`aria-current="step"`
  and type weight), the travelled/untravelled distinction, the check on completed
  stages, and the separated `lost`-terminal group. The accessible semantics did
  not move — `role="list"` / `role="listitem"` with no tab stop was already
  correct for a readout, and it stays that way.
  
  Three DOM attributes carry the state that colour used to be the only carrier
  of, so the classification is assertable without reading CSS:
  `data-stage-state` (`completed` | `current` | `upcoming`),
  `data-stage-terminal` (`won` | `lost`), and `data-stage-rail` on the decorative
  indicator.
  
  **Not in this change:** click-to-advance. A stage control that writes
  `stageField` through the same permission/validation envelope an edit takes is a
  separate feature with its own appetite, and folding it in here was explicitly
  ruled out.
- ebce5a3: `object-grid` / `object-form` / `detail-view` resolve their data source the same way, and a block that resolves none says so
  
  The three object-bound blocks disagreed about how the data-source adapter reached
  them. `object-grid` and `object-form` were registered through wrappers that read
  it from `SchemaRendererProvider` context; `detail-view` was registered as the raw
  component, which reads a React `dataSource` prop. `SchemaRenderer` itself reads
  only context, so the two wirings were mutually exclusive: measured with correct
  keys in every cell, provider wiring gave the grid `find` 1 and the detail view
  `findOne` 0, and prop wiring gave exactly the reverse. Neither reported anything.
  
  All three now resolve the adapter through one rule — an explicit `dataSource`
  prop first, the provider context second. This is additive: `detail-view` keeps
  its prop form (and direct `<DetailView dataSource={…} />` callers are untouched),
  `object-form` gains a prop form it did not have, and `object-grid` no longer
  throws `useSchemaContext must be used within a SchemaRendererProvider` when a
  page has no provider.
  
  And the silence is over. A block in this family that resolves no adapter renders
  a **No data source resolved** panel naming the block, the object it was about to
  read, and the ancestor that injects the adapter — instead of a header-only grid,
  a field-less form card, or nothing at all. The check is opt-in per block, so a
  placement with inline rows, inline `customFields`, an inline record or an `api`
  endpoint is untouched.
  
  New from `@object-ui/react`: `useResolvedDataSource`, `NoDataSourcePanel`,
  `noDataSourceMessage`, and a `requiresDataSource` prop on `ElementDataSourceGate`.
- 7e50e84: fix(plugin-detail): `record:related_list` redaction now reaches the auto-derived columns
  
  Redacting **every** authored column used to switch redaction off. The block
  filtered its authored `columns` against `redactFields`, handed `RelatedList` the
  empty result, and `RelatedList` read an empty array as "no columns were
  authored" — falling through to auto-derivation, which the block's redaction list
  never reached. The redacted field came back, and the fallback could surface
  fields the author never listed at all.
  
  `RelatedList` now takes the list as a `redactFields` prop and applies it on every
  path that decides columns — the authored array, the `highlightFields` prominence
  set and the heuristic field walk — so one policy filters all three. An authored
  array emptied by redaction falls through to the derived set exactly as it already
  did, and that set is now filtered too.
  
  Field-level security is unchanged: it was, and remains, enforced independently on
  every path.
- 8a44390: `record:alert` binds the row through `usePredicateRecordContext`, so an
  author-declared `properties.visible` is actually consulted.
  
  `renderers/record-alert.tsx` was the last predicate face in the repo still
  handing `useCondition` a root-only `{ record }` bag. Every other row-scoped
  predicate — the four generic action renderers (objectui#4075) and app-shell's
  `DeclaredActionsBar` (objectui#4077) — binds the row through the shared
  `usePredicateRecordContext(record)` helper, which resolves the three spellings
  objectui#5330 ruled on: canonical `record.status`, the deprecated row-action
  shorthand `status`, and deprecated legacy `data.status`.
  
  Under the root-only bag only the canonical spelling worked, and the two others
  failed in **opposite** directions — both of them silently, because this call
  site is fail-soft:
  
  - **row-action shorthand** (`status == 'x'`) resolved nothing, so the evaluator
    threw. The legacy `${…}` path answers a throw with its own source text, a
    non-empty and therefore truthy string, so the verdict was **SHOWN on every
    row**. A banner the author had gated was permanently on screen.
  - **legacy `data.*`** (`data.status == 'x'`) did not throw at all. App-shell's
    ambient predicate scope (`providers/ExpressionProvider.tsx`) carries
    `data: {}`, so the predicate read that object instead of the row, compared
    `undefined`, and the verdict was a constant false — **never shown**.
  
  **Behaviour change, stated plainly:** a shipped `record:alert` whose `visible`
  was written in either deprecated spelling was inert and is now live. A banner
  that was permanently visible may begin to hide, and one that never appeared may
  begin to show — that is the point of the fix, but it is a verdict change rather
  than a no-op. Canonical `record.*` predicates are unaffected in verdict: they
  resolved before and resolve now, pinned on both polarities. An in-tree census
  found no `record:alert` `visible` predicate outside this package's own tests.
  
  A node-level `visibleWhen` is a separate gate one tier up in `SchemaRenderer`,
  with its own deliberate bindings (`data` is the data-source adapter there, not
  the row). This change does not touch it; the two still compose as AND.
  
  The renderer's header comment described the shared-scope behaviour it did not
  have. It now describes what the file does, including the fail-soft policy and
  the two-gate composition.
- 23705b7: **`ReferenceRailEntry` is now the spec's type, and the reference-rail `icon` key retires** (objectui#5494, maintainer ruling 2026-08-22).
  
  `ReferenceRailEntry` is owned by `@objectstack/spec` as of 17.1.0. The hand-written interface in `record-reference-rail.tsx` is replaced by a re-export of the spec's `ReferenceRailEntry` (derived from `ReferenceRailEntrySchema`, `$strict` over `{ objectName, relationshipField, title?, limit?, displayField? }`), and `buildDefaultPageSchema` no longer emits `icon` on the reference-rail entries it synthesizes.
  
  **Migration — if you write `icon` on `record:reference_rail` entries, remove it.** Be aware of what this does and does not change:
  
  - **Runtime validation does not move.** The spec's strict schema already refused `icon` at save — that refusal is unchanged. What was broken was objectui's declaration: the TS type advertised a key that could never be saved.
  - **Nothing ever rendered `icon`.** No render path in `RecordReferenceRailRenderer` has ever read the key (measured back to the file's first commit, and independently by the spec's `ui-reference-rail-unknown-keys-refused` migration entry). An authored `icon` that survived in unsaved/preview metadata was already a silent no-op — after this change the TS type says so instead of suggesting otherwise.
  - **The published TS surface narrows.** Code that imported `ReferenceRailEntry` from `@object-ui/plugin-detail` internals and set `icon` will now get a type error. That error is the contract speaking: remove the key.
  
  The reference-rail icon affordance is retired rather than proposed upstream: a stock scan of this repo, its examples and schema-catalog corpus, and the objectstack tree (examples, templates, docs) found no reachable authored usage of `icon` on reference-rail entries. Stored customer metadata is not reachable from this seat and was not scanned.
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

### Patch Changes

- cd2cb41: `record:history` refuses a row cap the contract rejects instead of repairing it
  (objectui#10005).
  
  `@objectstack/spec` declares this block's member a positive integer —
  `RecordHistoryProps.limit` is `z.number().int().positive().optional()`, described there
  as the `$top` of the self-fetch query with a renderer default of 50. Two values the
  contract refuses were nevertheless reaching the adapter:
  
  - an authored `limit: -5` came back as a **one-row** window. The old derivation ended in
    `|| 50`, which catches `0`, `NaN` and `''`, but a negative is truthy and survived it;
    the `Math.max(1, …)` at the wire then repaired it to `1` rather than refusing it.
  - an authored `limit: 2.5` was forwarded **untouched** as a fractional `$top`.
  
  Both now fall back to this block's own default of 50, silently, which is the answer its
  sibling `record:activity` already gives through `normalizeLimit`. Absent, `0`, `NaN` and
  a non-numeric string keep answering 50 exactly as before, a usable cap still passes
  through unchanged, and a numeric string still resolves. `record:history`'s default of 50
  and `record:activity`'s of 20 are unchanged and still differ deliberately.
  
  What an author sees change: a record page whose history block declared a negative or
  fractional cap showed one row (or an unpredictable window) and named no cause; it now
  shows the default 50.
- 28b0658: fix(plugin-detail): `record:quick_actions.requiredPermissions` is an ADR-0066 capability set, read fail-closed — it used to pass for every reader of the object
  
  The block-level gate is published as "Hide the whole bar unless the current
  user holds every named permission on this object". It evaluated each name
  through the permission context's OBJECT-ACTION path, whose second argument is
  the closed object-action enum — not the ADR-0066 system capability set the same
  word names on `action`, `app`, `field` and `bulkAction`.
  
  Under the stock `/me/permissions` provider that path maps eight verbs (`read`,
  `view`, `create`, `update`, `edit`, `delete`, `import`, `export`) and sends
  everything else to the object's `allowRead` bit. Measured on that provider with
  a REPORTED-empty capability set and `allowRead: true`: `crm.manage` and
  `manage_users` both answered `true` — **a declared permission gate that passed
  for every reader of the object, with no refusal, no warning and no log**. The
  same fallback swallowed five members of the enum itself (`manage`, `admin`,
  `share`, `configure`, `execute`), none of which is in that map either. Under
  the role-based `PermissionProvider` the identical declaration was instead
  refused for everyone when the object carried a permission config and allowed
  for everyone when it did not — one declaration, two providers, neither
  consulting the caller's capabilities.
  
  The bar now reads the capability path (`hasCapabilities` over the reported
  `systemPermissions`) and gates **fail-closed**: an unheld or unrecognised
  capability hides the whole bar. The object name is no longer part of the
  verdict — a system capability is not object-scoped, and the old
  `objectName`-present guard was a second silent fail-open that skipped the
  declared gate entirely on a bar rendered outside a record context.
  
  **Behaviour change, in both directions.** A deployment whose backend reports
  `systemPermissions` now hides a bar whose declared capabilities the user does
  not hold — which is what the key always said it did — and shows one whose
  capabilities the user holds even where the object's read bit is off. A provider
  that never REPORTS capabilities (`systemPermissions` absent: the role-based
  provider, a backend predating ADR-0066, or no provider mounted) still opens the
  gate; that is `hasCapabilities`'s own unreported-vs-empty doctrine, shared with
  every other capability gate in the tree, and this change does not move it. A
  REPORTED empty array is a real answer and gates strictly.
  
  `perms.can()` itself is untouched: no other caller moves, and the full
  before/after truth table of both stock providers is pinned as unchanged.
  
  **Correction, 2026-10-01 (objectui#10224).** The phrase "hides the whole bar"
  above is wrong about what the reader sees. When a declared capability is unheld or
  unrecognised, no action is drawn and an insufficient-permissions notice
  (`role="status"`) renders where the bar would be. That is what the contract's
  shared record-block `requiredPermissions` describe says: "this block does not
  render its content; wherever it would otherwise render, an
  insufficient-permissions notice takes its place". The `record:quick_actions`
  registration now publishes that describe verbatim, in place of "Hide the whole
  bar unless the user holds these permissions", and the contract wording quoted
  in the first paragraph is retired upstream (objectstack#18159). Everything
  else above stands: the capabilities the gate asks for, its fail-closed
  verdict, and the fail-open when capabilities are unreported.
- 588380d: `record:activity` refuses a NON-INTEGER row cap instead of flooring it
  (objectui#10096).
  
  `@objectstack/spec` declares this block's member a positive integer —
  `RecordActivityProps.limit` is `z.number().int().positive().default(20)`, described
  there as "Number of items to load per page" — so a fractional cap is a value the
  contract refuses. `normalizeLimit` nevertheless read `Math.floor(Number(value))` and
  then admitted anything finite and positive, so an authored `limit: 2.5` came back as
  **2**: a two-row feed the author never asked for, with no cause named anywhere.
  
  It now falls back to this block's default of 20, silently, which is the answer its
  sibling `record:history` gives through `normalizeHistoryLimit` (objectui#10093).
  `Number.isInteger` replaces `Number.isFinite` and nothing else, so `0`, a negative,
  `NaN`, both infinities, an absent value and a non-numeric string keep answering 20
  exactly as before; a usable cap still passes through unchanged and a numeric string
  still resolves (`'5'` is still `5`). What narrows is the admitted value set, not how a
  node's value is read. `record:activity`'s default of 20 and `record:history`'s of 50
  are unchanged and still differ deliberately.
  
  `record:chatter` and `record:discussion` resolve `feed.limit` through the same
  function — `RecordChatterProps.feed` is `RecordActivityProps`, the same declared
  member — so they get the same refusal.
  
  What an author sees change: a record page whose activity, chatter or discussion block
  declared a fractional cap showed a floored window (`2.5` → two rows) and named no
  cause; it now shows the block's default of 20.
  
  The `Math.max(1, Math.floor(pageSize) || …)` clamp inside `applyFeedConfig` is
  unchanged and settled as an internal clamp rather than the same defect: `pageSize` is
  not an authored member but the paging window, computed at both call sites as
  `limit * (extraPages + 1)` over an already-normalized limit, so every value reaching it
  is a positive integer on which all three of its arms are the identity.
- b06c3de: fix(plugin-detail): the record-grained write verdict is memoised PER PRINCIPAL
  (objectui#10107).
  
  `useRecordEditable` — the record-level gate behind the detail header's Edit / Delete
  CTAs, the drawer's, and (imported from here) the console record page's — asks the
  explain engine `POST /api/v1/security/explain` for the row verdict and memoises the
  answer so revisiting a record is free. The memo was keyed
  `object:recordId:operation`, with nothing about WHO the verdict was computed for, and
  it lives at module scope, so it outlives every unmount for the life of the tab.
  
  Signing out does not end that life. This repo already records that no sign-out call
  site reloads the page — that is exactly why `AuthProvider.signOut` purges the per-tab
  storage caches by hand (objectui#5198) — and this map was not among what it purged. So
  the next principal to sign in in the same tab was answered from the previous
  principal's verdicts, and answered SYNCHRONOUSLY as the hook's initial state, so no
  probe was sent and no later answer could correct it.
  
  Both fail directions were reachable, and both are now pinned:
  
  - a `false` computed for someone else hid Edit from a user who holds a record-level
    `edit` share, for the rest of the tab's life, while `PATCH` on that record
    succeeded — the report this card carries;
  - a `true` computed for a privileged principal offered Edit to one holding no grant,
    the UI inviting a write the server refuses. That direction is the worse one.
  
  The key now carries the acting principal (`usePermissions().userId`, the identity
  `/me/permissions` already publishes — the verdict itself still comes from the explain
  engine alone, so this adds no second source of permission truth), and the map is
  dropped whenever that principal changes, so no entry can span a sign-out. A key change
  with no cached answer also resets to the hook's fail-open default instead of leaving
  the previous key's verdict on screen across the round trip — the same posture the hook
  states for every other uncertainty (ADR-0124 D1: the server enforces, the client is
  courtesy).
  
  Unchanged: the fail-open contract on an unknown answer, the request shape, the probe's
  authenticated channel, and the memo itself within one principal.
- 0d379f5: fix(plugin-detail): a related list resolves `user` columns to names, like every other list
  
  A record-detail related list drew a `user` column as the stored `sys_user` id — the
  32-character opaque string — while the standalone list of the same object, same
  record, drew the person's name. The field is not off-spec: `user` is a
  reference-bearing type fixed to `sys_user` and a member of `@object-ui/core`'s
  `EXPANDABLE_FIELD_TYPES`. One renderer diverged.
  
  Two halves, both now reading the shared family instead of naming types locally.
  
  The auto-fetch asked for no `$expand` at all, so every reference column arrived as
  its bare foreign key. It now asks for the roots `buildExpandFields` derives — the
  same canonical projection an ordinary list sends — restricted to the authored
  columns when the caller named any, minus the parent relationship, which is removed
  from every column list this component draws. The roots are FLS-gated on the OUTPUT,
  the shape objectui#7215 / objectui#7230 ruled and `DetailView` already uses: asking
  the server to resolve a reference discloses more than the bare key does. A child
  object with no expandable column sends the byte-identical query it always sent.
  
  The batch label fallback — the path that serves rows a CALLER supplied, and a
  backend that does not honour `$expand` — tested `lookup`/`master_detail` in a
  private disjunction, two of the family's four members, so a primitive `user` id was
  never gathered and never resolved anywhere else either. It now asks the family. A
  `user` cell reads no `field.options`, so the resolved name reaches it as the record
  shape it documents; the name still comes from the one batch map in this file,
  resolved through the target object's declared `nameField` / `titleFormat`, so no
  second resolver exists.
  
  ⛔ Both halves are pinned on the RENDERED name, against a control that renders the
  same column printing the stored id when resolution is made impossible — an absence
  proves nothing until the presence has been seen on the same instrument. Identity
  pins spy on the `has` of the object core exports, so a member-identical private
  copy of the family fails where a membership check would pass on the defect.
- c2dabf0: fix(plugin-detail): `requiredPermissions` on `record:details`, `record:highlights` and `record:related_list` is an ADR-0066 capability set, read fail-closed — it used to pass for every reader of the object
  
  These three record blocks carried the same block-level gate objectui#10058
  repaired on `record:quick_actions`, byte for byte, and were untouched by it.
  Each evaluated every declared name through the permission context's
  OBJECT-ACTION path, whose second argument is the closed object-action enum —
  not the ADR-0066 system capability set the same word names on `action`, `app`,
  `field` and `bulkAction`.
  
  Under the stock `/me/permissions` provider that path maps eight verbs (`read`,
  `view`, `create`, `update`, `edit`, `delete`, `import`, `export`) and sends
  everything else to the object's `allowRead` bit. So a declared gate naming a
  capability nobody holds opened for every reader of the object, with no refusal,
  no warning and no log — and five members of the enum itself (`manage`, `admin`,
  `share`, `configure`, `execute`) were swallowed by the same tail, none of them
  being in that map either.
  
  All three now read `hasCapabilities` over the reported `systemPermissions` and
  gate fail-closed: an unheld or unrecognised capability hides the block. The
  object name leaves the verdict, because a system capability is not
  object-scoped — on `record:details` and `record:highlights` the old
  `&& objectName` conjunct was a second silent fail-open, skipping the declared
  gate entirely for a block rendered with no object name in its record context.
  
  Two calls deliberately do NOT move. `record:related_list`'s automatic
  child-object read gate still asks the object-action path about `read`, which is
  the question it means to ask, and `can()`'s own semantics are untouched
  everywhere else.
  
  ⚠️ Unchanged residual, shared with every other capability gate in the tree: a
  provider that never REPORTS capabilities (`systemPermissions` absent — the
  role-based `PermissionProvider`, or a backend predating ADR-0066) still opens
  these gates. That is `hasCapabilities`'s ruled unreported-vs-empty doctrine
  (objectui#4656) and this change does not move it. A REPORTED empty array is a
  real answer and gates strictly.
  
  **Correction, 2026-09-30 (objectui#8649).** "Hides the block" above is wrong
  about what the reader sees. When a declared capability is unheld or
  unrecognised, the block's content is withheld and an insufficient-permissions
  notice (`role="status"`) renders in its place, on all three blocks. That is
  what the contract's `requiredPermissions` describe on these blocks says: "this
  block does not render its content; wherever it would otherwise render, an
  insufficient-permissions notice takes its place". Everything else above stands:
  the capabilities the gate asks for, and its fail-closed verdict. The automatic
  child-object read gate of `record:related_list` is a different gate, and it
  does hide the section.
- 4ab4f1b: A date-only value now renders the calendar day it names, west of UTC, at four more places (objectui#10183).
  
  **Clause-②: yes** — `@object-ui/core` gains one export, `toDisplayDate(value)`: the parse step every date formatter in `utils/date-display.ts` already went through, now reachable by a caller that formats with its own `Intl` options or compares a value with today. Nothing else is added, removed, renamed or retyped, and `@object-ui/fields` does not re-export it.
  
  **What it was.** objectui#10110 repaired the shared date path: a date-only value such as `2026-08-01` is UTC midnight to the JavaScript engine, so reading it back in the viewer's zone lost a day west of UTC. The repair rebuilt such a value at local midnight inside the shared formatters, but four places never reached it. `data-table`'s default cell face parsed the string into a `Date` first, and the shared step leaves a `Date` alone. The record summary chip, the record History tab and the `date` cell's overdue colouring each parsed the value themselves. Measured in `America/Los_Angeles`: `2026-08-01` rendered `Jul 31` in a table cell, `2026年7月31日` on a zh-CN summary chip and `7/31/2026` in History, and a deadline falling today read `Today` in red.
  
  **What changed, in observable terms.**
  
  - A `data-table` cell with no cell renderer hands the string to `formatDate` / `formatDateTime`. This also covers a related list whose child object schema is unavailable, since its cells fall back to that face.
  - The summary chip and the History tab take their `Date` from `toDisplayDate`. Their faces are unchanged: the chip keeps `dateStyle: 'medium'`, History keeps the locale's default numeric date.
  - The `date` cell's overdue colouring compares the day `toDisplayDate` names, so a deadline falling today is no longer red west of UTC. The cell's text was already right, and its hover title is unchanged.
  - ⚠️ The summary chip's and History's `datetime` arms share that parse, so they follow the shared path's rule: the value's shape decides, never the field's type. An instant still converts into the viewer's zone. A date-only value stored on a `datetime` field now reads as local midnight of its day, as `formatDateTime` already rendered it; before, it read as the previous evening west of UTC and as a morning hour east of it.
  
  In UTC every face is byte-identical to before. East of UTC every date face and the overdue colouring are too; only that `datetime`-arm reading of a date-only value moves there.
- fa5fbd9: fix(plugin-detail,plugin-grid): the record-grained write verdict is forgotten when
  its record changes, and the row kebab's memo is per principal (objectui#10184).
  
  Two hooks ask the explain engine (`POST /api/v1/security/explain`) whether the acting
  user may update or delete a record, and memoise the answer at module scope so
  revisiting a record is free: `useRecordEditable` in `@object-ui/plugin-detail` (the
  detail header, the drawer and the console record page) and `useRecordCrudVerdicts` in
  `@object-ui/plugin-grid` (the list row's kebab).
  
  **Same principal, changed record.** objectui#10107 made the detail header's memo per
  principal, but a verdict cached for one principal was still served after the record
  changed under that same principal — ownership moved, a share granted or revoked — so
  the record's new owner re-opening it in the same tab was still told no, and a
  principal who had just lost access was still offered Edit. Both memos now listen to
  the data-invalidation bus the writers already announce on (`notifyDataChanged`, and
  every `DataSource` write through `useMutationInvalidationBridge`) and drop exactly
  what a change stales, by the bus's own matching rule: a record-scoped change drops
  that record's entries for both operations, an object-scoped change drops the
  object's, `'*'` drops everything. A mounted hook asks again in place — the list only
  for the rows that lost their answer — and an answer that was in flight when its
  record changed is not cached.
  
  **The row kebab, cross-principal.** `useRecordCrudVerdicts` carried the identical
  un-principalled memo objectui#10107 repaired in the detail header: keyed
  `object:recordId:operation`, it answered the next principal to sign in in the same
  tab from the previous one's verdicts, in both directions — a `false` hid the kebab's
  Edit from a user the server lets write the row, and a `true` offered it to one the
  server refuses. It now keys by the acting principal exactly as the detail header does
  and drops the map when the principal changes, so the two surfaces keep answering a
  record identically.
  
  What this does not make fresh, and says so at the site rather than implying it: a
  grant or revocation made in another tab, by another user or by the server itself is
  never announced in this tab, and a grant stored as a row of another object (a
  record-share row, a permission-set assignment) is announced against that object, not
  the record it grants — both land on the next page load. No lifetime constant was
  added to paper over that.
  
  Unchanged: the fail-open contract on an unknown answer (ADR-0124 D1 — the server
  enforces, the client is courtesy), the request shapes, the probes' authenticated
  channel, and the memo itself while nothing changes.
- 5f44cc6: fix(plugin-detail): a related list's row fetch drops a column the principal cannot read once the permission answer has loaded
  
  `RelatedList`'s auto-fetch sent no `$select`, so every field of every child row
  was requested and a field that field-level security denies was dropped only at
  the column layer, after its value had already crossed the wire. A list with
  authored `columns` now sends a `$select` built from the authored columns that
  pass the same redaction, parent-key and FLS gates the column layer applies (one
  shared spelling of each), plus `id`, the `$expand` roots, and, once the child
  schema has loaded, the fields its row predicates read (the child object's
  `userActions` Edit/Delete overrides, its actions and the host's row actions),
  plus the mobile card gallery's cover field when the child declares it and FLS
  allows it.
  FLS drops a denied column once the permission answer has loaded; a request sent
  before it can still carry that column, the same deferral `ObjectGrid` has. That
  is the projection shape `ListView` and `ObjectGrid` already send (objectui#6898,
  objectui#3501).
  
  Graded as defence in depth: ObjectStack's server already strips denied fields
  from every returned row (`FieldMasker`), so nothing leaked from that backend. The
  projection matters for a backend that does not strip.
  
  An authored list whose every column is denied now asks for `id` (plus predicate
  operands) rather than reading the emptied column list as "no restriction".
  
  Unchanged: a list that derives its columns, with no authored `columns` or with
  redaction emptying them, still sends no projection. Its columns come from
  `highlightFields` or the field walk, and both are chosen by the emptiness of the
  rows fetched, so they are not known before the fetch.
  
  Behaviour to know about on the authored path: on a backend that honours
  `$select`, rows now carry only the projected fields. A row action that reads a
  row field through something other than a `visible` / `disabled` predicate or
  `recordIdField`, such as a `defaultFromRow` parameter or a `{field}` token in its
  URL, only gets that field if the projection already carries it (a column, `id`,
  or another predicate's operand). `ListView` and `ObjectGrid` already behave this
  way.
  
  ⇒ Narrowed in this same release by objectui#10277: the harvest now also names
  the row key a `defaultFromRow` parameter seeds from and every bare-identifier
  `{field}` token in an action's `target`, through the same declared-field and FLS
  gates, so on all three surfaces those two no longer rely on the projection
  already carrying the field. (Noted here by the objectui#10277 seat, because this
  body publishes verbatim into the CHANGELOG and the paragraph above would
  otherwise describe a gap the same release closes.)
- fd6f5da: fix(plugin-detail): `record:quick_actions.requiredPermissions` publishes what the gate does — the contract's shared record-block describe, verbatim
  
  The `record:quick_actions` registration described `requiredPermissions` as "Hide
  the whole bar unless the user holds these permissions". The renderer does not
  hide the bar. It reads the ADR-0066 capability set, and when a declared
  capability is missing it draws an insufficient-permissions notice where the bar
  would be. When the client cannot resolve capabilities (no permission provider,
  or a backend that does not report `systemPermissions`) it renders the bar.
  
  `@objectstack/spec` 17.5.0 gives this key one describe, shared with
  `record:details`, `record:highlights` and `record:related_list`, and those three
  already publish it. The quick-actions input now publishes the same text. It is
  carried by `sdui.manifest.json`, and at runtime by
  `ComponentRegistry.getConfig('record:quick_actions').inputs`. No input name,
  type or shape changes, and no rendering or gating behaviour changes.
- cc4366d: fix(plugin-detail): `record:details` no longer prints a row directly under an H1 that shows the same value when a `titleFormat` collapses onto a field outside the fixed candidate list (objectui#10360)
  
  **What changed for a user.** On an object with no declared name pointer, the
  record page H1 is the rendered `titleFormat`. When a placeholder is blank the
  template collapses onto the one field that still has a value, so
  `"{contract_no} - {name}"` with a blank `name` renders `HT-2026-003`. The
  details grid used to keep the "Contract No" row, printing `HT-2026-003` again
  directly under the H1. That row is now hidden, as a collapsed template's row
  already was when the field was `name`, `title`, `subject` or another candidate.
  
  **What did not change.** The comparison is the one ruled on objectui#8351
  (option B): a row is hidden only when its value EQUALS the rendered title, never
  because a `titleFormat` exists. A composite title such as
  `HT-2026-013 - Acme Corporation` is no field's value and still hides no row. Two
  placeholders holding the same value render a composite too, so both rows stay.
  The candidate list (the ADR-0079 resolver rungs and six literal names) is still
  scanned first, and a candidate that matches still wins, so no row that was
  hidden before is hidden differently now. The declared-pointer branch
  (objectui#9436) still runs first and never consults the template.
  
  **How a field counts as rendered.** After the candidates, the dedupe compares
  the H1 against each record field whose value equals it and that the template
  actually rendered. "Actually rendered" is asked of `formatTitleTemplate` itself,
  by blanking that one field and rendering again, not of a second placeholder
  parser, so it agrees with the renderer on `{{…}}` placeholders, whitespace
  inside the braces and dotted lookup paths. A lookup whose display name happens
  to equal the H1, but whose dotted placeholder rendered nothing, keeps its row.
  At most one row is hidden.
- d999617: fix(plugin-detail,app-shell): a record's title no longer prints a field the viewer may not read (objectui#10434)
  
  `DetailView` hid the row of every field the loaded permission policy denies,
  but it built its header title from the record as served. On a backend that
  does not strip denied fields, a `titleFormat` token, a declared `nameField` or
  a view `primaryField` that the policy denies therefore printed in the heading
  while its row was hidden. The record page built its breadcrumb title the same
  way, and the favourite and the "Recently Accessed" entry carry that title.
  
  Both titles are now built from the record with the denied fields removed. The
  record id is always kept, so the `Record #` id floor still applies. A denied
  field is read exactly as an absent one, and the title falls through to its
  next source, the title ObjectStack's `FieldMasker` row already yields. No
  placeholder stands in for a withheld value. A template with a denied token
  renders what it renders when that field is empty.
  
  `record:details` hides the one body row that repeats the title, and it now
  makes that choice from the same row. With the block's own header
  (`showHeader: true`), the heading and that choice therefore read the same
  record, and a denied title field no longer leaves the fallen-through title's
  row printed directly under the heading. On the record page, `page:header`
  now builds its heading from the same gated row (objectui#10499). ⚠️ Under a
  `page:header` whose host hands it the record as served, the body now matches
  what a stripping backend renders. The heading can still print the denied value
  there, and the row hidden is then the one a stripping backend's heading would
  show.
  
  Before a permission policy loads, and with no permission provider mounted,
  nothing is removed and every title is unchanged.
  
  This is defence in depth: ObjectStack's `FieldMasker` already removes the
  fields a user may not read from the rows it serves, so on that backend no
  title changes.
- 9a5f998: `@object-ui/core` exports `withoutDeniedFields(record, policy, objectName, extraKeep?)`, the field-read rule for one record: the record as the viewer may read it on `objectName` (objectui#10594).
  
  Every field the loaded `policy` denies is removed, which leaves the row ObjectStack's `FieldMasker` already serves. `id`, `_id` and any key in `extraKeep` (a declared id field) are never judged. Before a policy loads, with no policy, with no object name, or for a value that is not an object, the record comes back as it is; when nothing is withheld the SAME object comes back. `policy` is structural (`isLoaded` and `checkField`), so `usePermissions()` from `@object-ui/permissions` satisfies it and `@object-ui/core` gains no dependency.
  
  The renderer's display surfaces that each carried a module-private copy of this rule now call the export, with no change in what they draw:
  
  - `@object-ui/fields`: the lookup cell's name and the user cell's name and avatar (the package entry), and the lookup editor's option label and search chip avatar (`LookupField`).
  - `@object-ui/react`: `useRecordSearch`'s hit label under `fieldReadPolicy`.
  - `@object-ui/app-shell`: the record page's title and the row its blocks read (`RecordDetailView`).
  - `@object-ui/plugin-detail`: `DetailView`'s header title and `record:details`' title dedupe. The package-internal `withoutDeniedFields` module is removed; it was never a package export.
- 8848ce4: The detail page's inline date editor no longer blanks a stored day that does not exist without saying so (objectui#10625). A `date` field holding `2026-02-30`, or a `datetime` field holding `2026-02-30T10:00:00Z`, used to open an empty date input with no marker and no notice. The inline editor now uses `@object-ui/fields`' `DateField` for `date` and `datetime` fields, so it behaves like the form editor: the control is empty, marked `aria-invalid`, and described by a notice that names the stored value. Nothing is written until the user picks a day. A real date opens and saves as before (the edit is re-emitted as a full ISO timestamp at local midnight).
- 9c78ebe: `RelatedList` sets `TableColumn.masked` on the columns it hands its table, so a `password` / `secret` column no longer copies, shows or sorts by its raw value (objectui#10657).
  
  The related list draws a `password` / `secret` cell as `••••••`, but it never set the flag
  the table reads. So the table handed the raw value out anyway: Ctrl+C / Cmd+C on the masked
  cell copied the credential, the cell's tooltip carried it, a click on its header sorted the
  list by it (the table's headers drive this list's own sort), and the column's width grew
  with it.
  
  The list now sets the flag on every column whose cell is drawn as a mask, from
  `isMaskedFieldType()` in `@object-ui/fields` over the column's authored `type` and the
  object's field type (a narrow-only union: a column authored as `text` over a `secret`
  field keeps the flag). It applies to authored columns, bare field names and the columns
  the list derives on its own.
  
  It fails closed. While the object definition is still loading, or after its read failed,
  the list cannot tell a masked column from any other, so it sets the flag on every column:
  in that window no cell copies or shows a tooltip, and no header sorts. Not covered: in the
  same window a field the object declares as `password` / `secret` is drawn as text,
  because the mask comes from that declaration.
  
  Also not covered: the list's own filter box (opt-in `filterable`) matches against every
  field of a row, and its sort buttons (`type: 'list'` with `sortable`) sort by any column,
  masked ones included.
  
  This is defence in depth. The real guard is still the server: ObjectStack's read mask
  replaces `secret` and `password` values with its mask before they reach the browser.
- 12809a5: The related list no longer draws a cell as text while its object definition is loading or after its read failed: it draws the mask instead (objectui#10657, the objectui#10706 class at this producer).
  
  The list draws a cell from the object's field type, never from a column's authored
  `type`. While the definition was in flight, and for good after its read failed, no column
  had a cell, so the table drew every value as text, a `password` / `secret` field
  included. objectui#10657's first change already set `TableColumn.masked` on every column
  in that window (no copy, tooltip or header sort), but the flag withholds; it does not
  draw.
  
  Now, in that window, every column without a `cell` of its own is drawn as the mask
  (`MaskedCellRenderer` from `@object-ui/fields`), and stays so when the read failed: fail
  closed, never back to text. A column whose `cell` the author supplied draws what that
  `cell` returns. Once the definition lands, each column draws from its declared type as
  before.
  
  The cost: while the definition is loading, and for good after a failed read, the list
  shows masks where it used to show values. The pending objectui#10657 related-list
  changeset says a `password` / `secret` field is still drawn as text in that window; that
  no longer holds once this change ships with it.
  
  This is defence in depth. The real guard is still the server: ObjectStack's read mask
  replaces `secret` and `password` values with its mask before they reach the browser.
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
- 93a5585: fix(plugin-detail): a `record:reference_rail` block shows the related rows of the record on screen, not an earlier record's answer that arrived late (objectui#10684)
  
  The reference rail applies its answers while it is mounted, whichever run
  started the read. When the record changed while a read for the previous record
  was in flight, that answer could arrive after the current record's answer and
  replace its rows. It could also settle first and clear the entry's skeleton
  while the current record's read was still in flight.
  
  An answer is applied now only while the record and entries it was read for are
  still the ones on screen, so a read for the previous record is dropped when it
  arrives. A re-render for the same record starts no new read, so the answer in
  flight still lands.
- 21eb61a: A related list reads its rows once per mount, after its child object's definition settles, so a multi-valued relationship's first query is already the `$contains` membership form (objectui#10690, auto-adjudicated B by triage).
  
  `RelatedList` loaded the child object's definition in an effect of its own, and its row fetch did not wait for it. The definition decides the relationship's arity, `$expand` and `$select`, so a child whose definition moved any of them was read twice per mount. For a multi-valued relationship the first query was the bare equality that `driver-sql` refuses with `400 INVALID_FILTER` (objectui#7299). The list now reads the definition through `useSettledSchema` from `@object-ui/react`, and its row fetch waits until that read settles, the gate `object-map` and `object-data-table` use (objectui#10664). An adapter with no `getObjectSchema`, or a definition read that fails, settles with no definition, so the list still loads its rows with the equality form. On the raw-URL fallback, a multi-valued relationship is now refused before any request is sent. Switching the list to another object queries with that object's definition, never the previous one's. A failed definition read is now reported by `useSettledSchema` on `console.error`, where the list used to warn on its own.
- 184cfe1: `RelatedList`'s own filter box and sort no longer read a masked column's raw value (objectui#10728).
  
  The related list draws a `password` / `secret` cell as `••••••` and, since objectui#10657,
  flags the column `masked` on the table it renders. The table obeys the flag in its own
  search and sort, but the list has a filter box and a sort of its own, and both still read
  the raw value:
  
  - The opt-in filter box (`filterable`) matched the term against every field of a row, so
    typing a substring of the credential kept its row.
  - The sort buttons of a `list` card (`sortable`) were offered on every column, and sorted
    the rows by a masked one.
  
  Both now read the same `masked` flag the list puts on its columns:
  
  - The filter box matches the term against the columns the list shows that are not masked.
  - A masked column gets no sort button. A sort by it is refused, including one the embedded
    table asks for (in a server-paged list that sort would be sent to the server as
    `$orderby`). In a list that sorts in the browser (one that is not server-paged), a sort
    set on a column before it was flagged also stops ordering the rows.
  - While the object definition is still loading, or after its read failed, every column is
    flagged, so in that window the filter box keeps no row and no sort button is offered.
  
  Narrowing, stated: the filter box used to match any field a row carries. It now matches
  only the columns the list shows, so a term that matches only a field no column shows no
  longer keeps a row. This is the rule the table's own search already follows.
  
  Columns without the flag filter and sort exactly as before.
  
  Not covered:
  
  - An authored `sort` (the list's `defaultSort`) that names a masked field is still sent to
    the server as `$orderby` on a server-paged list.
  - On a server-paged list, a sort the user set on a column before that column was flagged
    is still sent to the server as `$orderby` with each page the list fetches, until the
    user sorts by another column. The column is flagged after the sort only when the
    `columns` or the object of a list already on screen change (a direct React consumer of
    `RelatedList`); `record:related_list` sets both once per block, so it does not reach
    this.
  
  The pending objectui#10657 related-list changeset lists the filter box and the `list`
  card's sort buttons under "Also not covered". That entry no longer holds once this change
  ships with it.
  
  This is defence in depth. The real guard is still the server: ObjectStack's read mask
  replaces `secret` and `password` values with its mask before they reach the browser.
- 285e36b: fix(app-shell, plugin-detail): the unmapped activity type warnings no longer point at an objectstack issue that answers 404
  
  `@object-ui/app-shell` warns on the console, once per value, when a `sys_activity` row's
  `type` maps to no activity item type, and `@object-ui/plugin-detail`'s `[record:activity]`
  block does the same when it maps to no feed item type. Both messages said `sys_activity.type` is
  author-extensible with a pointer to an objectstack issue that answers 404 beside the
  ruling's date. A reader of a console warning has no repository to resolve a commit
  against, so the pointer is dropped rather than replaced: both now read "author-extensible
  (ruled 2026-08-24)" (objectui#10803).
  
  Nothing else in either message moves, and what renders, and when and how often each
  warning fires, are unchanged.
- ac15833: fix(app-shell, plugin-detail): a record comment whose write fails is never shown as sent (objectui#10899)
  
  The record page's discussion writers appended the new comment (or reply) to the
  panel first and then fired the `sys_comment` create, swallowing its rejection.
  On a tenant with no `sys_comment` the write answered 404 while the panel showed
  the comment and a bumped count, with no error — and the comment was gone after a
  reload.
  
  `RecordDetailView` now appends a comment or reply only after its write resolves.
  A failed write raises a localized error toast (`detail.commentFailed`, new in all
  ten packs) and rejects back to the composer. The composers — the activity
  timeline's comment box, the threaded reply input, and `RecordComments` — now
  treat a rejected `onAddComment` / `onAddReply` explicitly as "not written": they
  keep the draft for a retry instead of letting the rejection escape unhandled.
- b4075c0: Five label positions that `@objectstack/spec` types as `I18nLabel` now accept the per-locale map in `@object-ui/types` too, where they were typed `string` (objectui#10993, batch 4).
  
  **What it was.** `I18nLabel` is a plain string or an inline per-locale map such as `{ en: 'Overview', 'zh-CN': '概览' }`. At these five positions the spec accepts the map and the renderer resolves it to the viewer's language, but `@object-ui/types` declared `string`, so a TypeScript author who wrote the spec's map got a compile error, and for `object-grid`'s `title` the published zod validator (`safeValidateSchema`) refused the map with `invalid_type` as well.
  
  **What changed, in observable terms.**
  
  - `RecordDetailsComponentProps.sections[].label`, `RecordRelatedListComponentProps.title`, `RecordRelatedListComponentProps.add.label` and `RecordPathComponentProps.stages[].label` are typed `I18nLabel`, the spec's own type, so the map compiles. A number is still a type error.
  - `ObjectGridSchema.title`, the deprecated fallback for `label`, is `I18nLabel` on the TypeScript interface and in the zod mirror, which takes the spec's `I18nLabelSchema` by reference. The validator now accepts the map; a number, or a map entry that is not a string, is still refused at `title`. `label` still wins whenever it resolves to something.
  - An `object-view`'s `table` slot takes `ObjectGridSchema`'s keys, so `table.title` accepts the map on both faces too. `ObjectView` hands it to the grid it draws, which shows the entry for the display locale.
  - Rendering at these five positions does not change: each renderer already resolved the map. A plain string is accepted and rendered exactly as before.
  
  **`record:related_list`, `columns[].label` (`@object-ui/plugin-detail`).** Since `@objectstack/spec` 17.5.0 a related list's `columns` may be column objects (`{ field, label, … }`, the saved-view shape), and a column's `label` is an `I18nLabel` too. A string label became the column header, but a per-locale map drew a blank header. `record:related_list` now resolves the map against the active UI language before it draws the list, so the header shows the viewer's entry; a string label, and a plain field-name column, render exactly as before.
  
  **Clause-②: yes** — published `@object-ui/types` props types and one zod mirror member widen from `string` to the spec's `I18nLabel`, so the accepted set grows by the per-locale map at these positions. Nothing that was accepted before is refused now.
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
- 62d6f56: The Add reaction button renders only on a comment row of a record's discussion feed
  
  A reaction is stored on the comment (`sys_comment.reactions`). The same feed
  also shows activity rows read from `sys_activity`, such as a field change, a
  completed task or a system event, and `RecordActivityTimeline` rendered the Add
  reaction button on those rows too. Picking an emoji on an activity row handed
  the host the activity's id, and the record page sent a `sys_comment` update
  keyed by that activity id.
  
  `RecordActivityTimeline` now offers reactions only on a `comment` row, the one
  feed kind built from `sys_comment` rows. Any other row renders no Add reaction
  button, and reactions a host hands on such a row show as chips that cannot be
  clicked. A comment row keeps its Add reaction button and its clickable chips.
  
  The record page's reaction handler (`RecordDetailView` in app-shell) also
  refuses an id whose feed row is not a comment, without writing anything.
- 0ecaa7d: Nine blocks now render the accessible name an author declares in their nested `aria` bag (objectui#11083, batch 2).
  
  The spec declares an `aria` bag (`AriaPropsSchema`) on `element:text_input`, `element:record_picker`, `element:metadata_viewer`, `page:header`, `page:tabs`, `page:card` and `page:accordion`, and on the `feed` of `record:chatter` / `record:discussion`. None of these renderers read it, so `properties: { aria: { ariaLabel: 'Orders' } }` rendered no `aria-label` anywhere. Each one now reads the bag through `resolveInlineAriaProps` from `@object-ui/react`, the reader the other `element:*` blocks and the page root use, against the display locale (`useDisplayLocale()`). `ariaLabel` becomes `aria-label` (a locale map such as `{ en: 'Orders', 'zh-CN': '订单' }` gives the entry for the display locale), `ariaDescribedBy` becomes `aria-describedby`, and `role` becomes `role`.
  
  Where the attributes land:
  
  - `element:text_input`: on the input. Its description paragraph stays in `aria-describedby`, and an authored `ariaDescribedBy` is added after it.
  - `element:record_picker`: on the combobox trigger, which keeps its `combobox` role unless the author declares another.
  - `element:metadata_viewer`: on a new root `div` around the view. The block had no single root element before; with no `aria` declared the `div` carries no attribute.
  - `page:header`, `page:tabs`, `page:card`, `page:accordion`: on the block's root element (the `header`, and the `Tabs`, `Card` and `Accordion` roots).
  - The `feed` of `record:chatter` / `record:discussion`: on a new `div` around the embedded timeline, the way `record:activity` puts its own `aria` on the `div` around its timeline, with the same `record:*` defaults: no role while nothing is declared, and `region` to carry a declared name. The timeline keeps its heading as its own name. With no `feed.aria` declared the `div` carries no attribute.
  
  None of the blocks adds a default role of its own, and a block that declares no `aria` renders the same attributes as before; the metadata viewer and the chat feed gain one attribute-less wrapper `div`.
- b24f93a: A page now renders the accessible name an author declares in its `aria` bag, and the list view and the `record:*` blocks read the same bag through the one shared reader (objectui#11083).
  
  **The page root (a fix).** The spec's `PageSchema` declares `aria` as `AriaPropsSchema`, and `PageNodeSchema` mirrors it. The page renderer passed its wrapper only DOM attributes, so the `aria` object was dropped and `{ type: 'page', aria: { ariaLabel: 'Orders' } }` rendered no `aria-label` anywhere. The page's root element now carries:
  
  - `aria-label` from `ariaLabel`. A locale map (`{ en: 'Orders', 'zh-CN': '订单' }`) gives the entry for the display locale (`useDisplayLocale()`);
  - `aria-describedby` from `ariaDescribedBy`;
  - `role` from `role`.
  
  The page adds no default role, and a page that declares no `aria` renders the same DOM as before. The flat `ariaLabel` on the page node still reaches the root as before; when both spellings name the same attribute, the nested `aria` bag wins.
  
  **The list view and the `record:*` blocks (no visible change).** `ListView`'s list region and the `record:*` blocks' `useRecordAriaProps` used to map the nested bag themselves. Both now go through `resolveInlineAriaProps` from `@object-ui/react`, the reader the `element:*` blocks use, and keep only their own defaults: the list region's `region` role, and each block's default role, default name and the report of the refused `aria.label` spelling. One difference: an authored empty `role: ''` on a list view used to render an empty `role` attribute, and now falls back to `region`. The list view still reads `aria.live`, which objectui's `ListViewSchema` declares on top of the spec's bag.
- 3f61eef: A `record:path` block that sets `statusField` and leaves out `stages` now shows the status field's picklist as its stages, instead of the "record:path — no stages configured" placeholder (objectui#11106).
  
  `@objectstack/spec` makes `stages` optional on `record:path` and describes it as "Explicit stage definitions (if not using field metadata)". Until now only the synthesized default record page derived the stages from field metadata; a page an author built, for example in Studio with only the status field set, got the placeholder even though the object declared the picklist.
  
  - **Derived from the picklist.** When `stages` is absent, `RecordPathRenderer` reads the status field's options from the object definition the host already binds to the record context (`objectSchema`), through `deriveStages`, the same rule the default page uses. The record's current value is highlighted, and the labels take the app's picklist translations like authored stages do.
  - **Authored stages still win.** An explicit `stages` list renders as written, and an explicit empty list still shows the placeholder.
  - **A field without picklist options keeps the placeholder, which now names the field**, for example `record:path — no stages configured, and field "stage_note" has no picklist options to derive them from`. With no object definition bound, the placeholder keeps its plain wording.
- e420df3: fix(plugin-detail): a related list's `list_toolbar` action authored `visible: false` is hidden
  
  `RelatedToolbarButton` decided whether an action declared a `visible` gate by
  truthiness. A literal `visible: false`, the most explicit way an author can say
  "never show this", is falsy, so the gate was skipped and the header button
  rendered for everyone. It now asks the question with `hasDeclaredVisibilityGate`,
  the one definition the rest of the action family already uses (objectui#3812):
  
  - `visible: false` hides the button.
  - A blank predicate (`''`, or a whitespace-only string) is no gate, so the button
    shows. A whitespace-only `visible` used to hide the button; it now shows, as it
    does on every other action surface.
  - A CEL string is evaluated, as before.
  - A predicate that faults still hides the button and is reported once
    (objectui#11212), unchanged.
  
  The server still judges the action's permission when it runs; this is the
  presentation gate.
- 4a1adb7: The comment attachment count, the threaded-reply count and the reaction chip's accessible name read the right noun form in every language at every count (objectui#11445). Each passes `count` to one i18next count family instead of choosing between a `…Plural` / `…One` key on `=== 1`, which gave Russian `3 вложений` and Arabic `2 مرفقات`; they now read `3 вложения` and the Arabic dual. The relative timestamps (`detail.minutesAgo` and its two siblings) and the "Show N empty fields" toggle are count families too, so one empty field reads `Show 1 empty field`. The provider-less defaults table carries each family's `_one` / `_other` rows.
- f560ded: The record header's percent summary chip, text and bar, scales at the storage
  its field declares (`percentCellScale`, the spec's `percentScaleOf`: a fraction
  unless the field declares a `max` above 1). It no longer guesses the storage
  from the value (objectui#11475). `summaryChipPercentPoints(raw)` becomes
  `summaryChipPercentPoints(raw, percentScale)`. The related list's cell now
  carries the field's `max`. Without it, a whole-stored `50` (`max: 100`) would
  read `5000%` there once the cell reads the declaration.
- fc7db05: The README's Activity tab authors `record:activity`'s declared inputs in `properties` (`{ limit: 20, showCompleted: false }`) instead of a host feed in `items` (objectui#11515).
  
  `items` is the host's feed slot, which `@object-ui/types` refuses by name on the node (objectui#11321), so the example taught a key the node's declaration refuses. The note under the example now says where the block's feed comes from: a record host, such as the console's record page, or, in a bare `<DetailView>` like the example, the block's empty state ("No activity recorded"), which is what the tab draws there. No package source changes.
- b34cc14: `record:details` edit mode gives a `markdown` field an editor: a multi-line
  textarea (objectui#11541).
  
  Before, a markdown row on the record page showed no pencil, and with the
  section in edit mode it stayed a read-only cell with no editor at all. The
  detail hosts consult the fields package's shared inline-edit exclusion, and
  `markdown` is in it. A markdown field that no form names, such as a
  `description` that is on no form, therefore had no editing surface anywhere in
  the UI.
  
  The detail row now routes `markdown` to `TextAreaField`, the fields package's
  multi-line widget (the one a `textarea` field edits with in the record form),
  through the same detail-side carve-out the upload widgets use
  (`DETAIL_ROUTED_INLINE_TYPES`). The value is the markdown source, a plain
  string. The textarea hands it back exactly as typed, blank lines and trailing
  newline included, so a save writes back what was typed, byte for byte. It is a
  plain textarea, with no rendered preview.
  
  Unchanged: `html` and `richtext` still open no inline editor on the record
  page, and a data-grid cell still opens none for `markdown`, `html` or
  `richtext`.
- ab18797: `record:details` edit mode edits a `textarea` field in a multi-line textarea,
  so saving it keeps its line breaks (objectui#11562).
  
  Before, a `textarea` row on the record page edited in a one-line text input.
  The browser strips line breaks from the value such an input is given, so a
  stored note with blank lines or a trailing newline was shown flattened, and one
  keystroke made the flattened text the value the Save wrote. Nothing warned.
  
  The detail row now routes `textarea` to `TextAreaField`, the fields package's
  multi-line widget: the one a `textarea` field already edits with in the record
  form and in a data-grid cell, and the one a `markdown` row got in
  objectui#11541. It hands the text back exactly as typed, blank lines and
  trailing newline included. A single-line value saves the same as before.
  
  Unchanged: `text`, `email`, `phone` and `url` rows still edit in the one-line
  input, and a data-grid cell still edits `textarea` with the same widget it used
  before.
- f66072d: Inline `t(key, { defaultValue })` strings are now held to the one placeholder spelling a
  provider-less host can resolve, and five of them are pinned to the pack value for the first
  time (objectui#4905).
  
  `check:i18n-keys`' `default-value-drift` class pins an inline default byte-identical to its
  `en` row, and objectui#3512 holds `en` to the one spelling `createSafeTranslation`'s
  `fallbackT` interpolates — so most inline defaults were covered transitively. Re-measured
  on this tree, 66 of 1003 were not: three literal defaults on dynamic keys, and 63 written
  as a computed expression. A new `unresolvable-default-spelling` class in
  `scripts/check-i18n-call-site-keys.mjs` now judges the text every inline default carries —
  the folded sentence, or a template literal's static segments — so `{{ name }}`,
  `{{count, number}}`, `{{- name}}` and `$t(key)` are refused wherever they are written,
  rather than only inside a copy table.
  
  Four call sites gain a real pin because their default carries no placeholder at all: the
  record-form submit button now falls back to `Update`/`Create` (the pack's wording) instead
  of `Save`/`Create` via a nested `t('common.save')`, the context selector's package label
  and the approvals separator now state their literal. One more (`detail.showEmptyFields`)
  is behind a `createSafeTranslation` hook, whose fallback does interpolate, so it can safely
  say what the pack says.
  
  The other 61 are deliberately left computed, and the measurement behind that is the useful
  part: react-i18next's not-ready `t` returns `options.defaultValue` **verbatim, without
  interpolating it**. At a call site bound to a bare `useObjectTranslation()`, a default
  written as `` `Signed in as ${user.email}` `` is therefore the only form that renders
  correctly with no provider — rewriting it to `'Signed in as {{email}}'` would put literal
  braces in front of the user, which is the exact defect this family of cards exists to
  prevent. Those sites keep their template literals and are covered by the spelling class
  instead.
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
- 1117414: `@object-ui/plugin-detail` now declares `"@objectstack/spec": "^17.1.0"` rather than
  `^17.0.0`, which is the lowest published spec that carries the symbol its own build
  output re-exports.
  
  `dist/renderers/record-reference-rail.d.ts` reads
  `export type { ReferenceRailEntry } from '@objectstack/spec/ui'`, and
  `ReferenceRailEntry` first appears in `@objectstack/spec@17.1.0` — measured against the
  published tarballs, not the installed tree: the name is absent from 17.0.0's
  `dist/ui/index.d.mts` (425 exported names) and present in 17.1.0's (442). So the old
  range was a claim the package could not honour. Any consumer resolution that lands
  17.0.0 — a sibling pinning it exactly, an `overrides` entry, a mirror a minor behind —
  satisfied `^17.0.0` and got a dangling type re-export.
  
  Nothing a consumer installs today changes: normal resolution already picks the newest
  17.x, and `pnpm-lock.yaml` still resolves 17.2.0 on this edge after the bump. The change
  is to the declared floor only, which is why it is scored `patch` rather than `minor` —
  the same reasoning objectui#5753 used for the other direction on this dependency.
  
  The bump is one instance; the durable half is `scripts/check-spec-range-floors.mjs`, a
  gate that compares every published package's `dist` imports of `@objectstack/spec/*`
  against the export set of that package's own declared minimum. It runs on the publish
  path (`pnpm changeset:publish`) and nightly, and it names the symbol behind every range
  it asks for. No other package's floor is touched: the gate finds nothing else to justify
  one across the 19 packages that declare the spec in a consumer-facing field.
- 7c96c94: Four more private copies of the reference-bearing field family converge onto
  `@object-ui/core`'s `EXPANDABLE_FIELD_TYPES`, and the "fourth and last private copy" claim
  that `paramToField` still stated is corrected (objectui#5874, objectui#5875).
  
  Each copy diverged from the published family in BOTH directions, so this is a behaviour
  change on every face and not a refactor:
  
  - **`user` and `tree` are now treated as relations.** Both carry the same foreign-key
    storage as `lookup` and resolve through the same expand path (objectui#2032), and each
    face's own stated reason for special-casing `lookup` applied to them verbatim — so
    gaining them restores the rule each face already meant. A `user` / `tree` field is now
    read-only in the quick-look drawer (`RecordDetailDrawer`), where the drawer wires no
    relation picker and a plain text input let a user overwrite the relation with a
    free-form string; it gets the wide layout basis in the record header's highlights strip
    (`HeaderHighlight`), whose inline editor is a record picker; and a field-backed action
    param over one now inherits the picker config it needs (`resolveActionParams`).
  - **`master_detail` is now treated as a relation by `resolveActionParams` too** — it was
    the only face missing that member as well, so a field-backed `master_detail` action param
    inherited no `referenceTo` at all and degraded to the unexplained "paste a record id"
    text input that objectui#3405 exists to prevent.
  - **The undeclarable `reference` spelling is gone from the three field-type faces.**
    Measured against `@objectstack/spec`'s closed `FieldType` vocabulary with live controls
    (`lookup` / `master_detail` / `user` / `tree`) and dead ones (the retired `owner`, plus a
    nonsense spelling): `reference` is absent, so no spec-compliant object schema could
    declare a field that reached those branches. It sat exactly where `owner` sat before
    objectui#4814 retired it — dead weight that read as live capability.
  
  `resolveActionParams` keeps answering for `reference`, deliberately and by a different
  route: it is refused by the spec's `ActionParamSchema` too, but the dialog still accepts it
  from params already authored with it, and that acceptance belongs to the one alias table in
  `paramToField` rather than to a hand-copied membership test. This face now asks the shared
  family over the widget key that table produces — the same expression `paramToField`
  evaluates one step later, so the half that populates a param's picker config and the half
  that forwards it can no longer disagree.
  
  No face copies the set: each calls `.has()` on the object `@object-ui/core` exports, and
  each carries an identity pin (a spy on that `has`) so a member-identical private copy fails
  instead of quietly re-forking the table.
- 95f8704: `record:path` now announces each stage's state, not just its label (WCAG 2.2 SC 1.4.1)
  
  The lifecycle path distinguished travelled, upcoming and lost-terminal stages with
  colour plus a `✓`/`✗` glyph, and both glyphs are `aria-hidden` decoration.
  `aria-current="step"` marked the current stage and nothing else, so a screen-reader
  user heard a run of identically-announced items — and a rejected stage announced
  exactly like an ordinary stage the record had not reached yet.
  
  Each stage now carries an accessible name composing its (already picklist-localized)
  label with its state, from five new `detail.pathStage*` keys translated in all ten
  locale packs. The glyphs stay decorative and the readout's `role="listitem"` /
  `aria-current` semantics are unchanged.
  
  The name is composed into `aria-label` rather than visually-hidden text because
  `listitem` takes its name from the author only: text placed inside a stage computes
  to an empty accessible name, so the visually-hidden shape would have looked right in
  the markup and delivered nothing to the accessibility tree.
- e30ed15: Correct two retired lucide spellings on component-registration `icon` meta
  (objectui#5936, the behaviour-neutral slice).
  
  `ui:page` declared `icon: 'Layout'` and `record:alert` declared
  `icon: 'AlertTriangle'`. lucide retires a spelling by dropping it from the runtime
  `icons` record while keeping the deprecated named export, so both names still
  import and still type-check while resolving to nothing through any resolver that
  reads that record. They are now the live keys `panels-top-left` and
  `triangle-alert`.
  
  **Behaviour-neutral by identity, in every resolution world.** The retired export
  and the live record entry are the SAME OBJECT — measured against the installed
  lucide 1.31.0, not asserted: `Layout === icons['PanelsTopLeft']` and
  `AlertTriangle === icons['TriangleAlert']` are both true. So the repair cannot
  substitute one glyph for another; it can only turn a name that resolves to
  nothing into one that resolves to the glyph it always meant.
  
  - Through a record-reading resolver (`renderers/action/resolve-icon.ts`), the old
    spellings resolve to `null` and the new ones to that shared object.
  - Through the dynamic surface (`iconNames`, 2025 names, retired aliases included),
    both spellings already resolved, and to the same glyph.
  - The kebab spellings were chosen because they are the only ones live on BOTH
    surfaces: `PanelsTopLeft` and `TriangleAlert` are record keys but are absent
    from `iconNames`, which is kebab-case only.
  
  Nothing is retired and no gate is extended here. `check-lucide-icon-record-names.mjs`
  deliberately does not judge a registration's `icon` meta, and it stays that way —
  its verdict is unchanged by this diff (182 names judged, green, both before and
  after). Whether the registration `icon` meta itself should be retired is the open
  half of objectui#5936 and is a maintainer decision under ADR-0049.
- 8d3a529: `record:path` finishes localizing and de-colouring its accessible names — the two residues
  objectui#5916 named and deliberately left behind (objectui#5956, objectui#5957).
  
  **The list's own label was English on a localized surface, and the other one named nothing.**
  Both the desktop and the mobile `role="list"` row did
  `aria-label={schema.aria?.label || 'Record path'}`, so a zh/ja/ar session heard `Record path`
  for the list while every stage inside it announced in the session locale — one control
  speaking two languages at once. The fallback is now `detail.pathLabel`, translated in all ten
  packs; the `schema.aria.label` author override still wins ahead of it.
  
  The lost-terminal alt group was a different defect wearing the same clothes: its
  `aria-label="Alternative terminal stages"` sat on a bare `div`, which has the `generic` role,
  and browsers expose no accessible name on a generic element. That string reached nobody —
  inert, not merely untranslated — so translating it would have shipped copy to ten packs that
  no user can hear. It is removed rather than given a role that takes a name, on three
  measurements: nothing is lost (it was never announced), it would be redundant (every stage
  inside already announces `closed lost` in the session locale after objectui#5916, in the one
  place `role="list"` can carry it), and it would fork the two rows (the mobile row renders one
  flat list with no alt group, so a named group would make one control expose two structures by
  viewport).
  
  **An unreached goal terminus was distinguished by hue alone.** `railClass` paints it
  `bg-emerald-500/30` where a plain upcoming stage gets `bg-muted` — the renderer's own note
  calls this "a faint emerald so the goal is legible" — while both announced the identical
  `{{stage}}, upcoming`. Two stages ahead of the record painted differently and read the same:
  the WCAG 2.2 SC 1.4.1 class objectui#5916 closed, on the one distinction it left behind, and
  reachable without authors opting in because `classify()` finds `won` through the `WON_TOKENS`
  heuristic as well as an explicit `terminal: 'won'`. New key `detail.pathStageWonUpcoming`
  (`{{stage}}, goal stage, not reached`), translated in all ten packs.
  
  Scoped to the UNREACHED goal, which is a measurement of the stylesheet rather than a
  preference: a reached goal terminus paints `bg-primary` when current and `bg-emerald-500` when
  completed, byte-identical to any other current or completed stage. Naming it apart would hand
  a screen reader a distinction the screen does not make — the mirror image of the defect — so
  it is one new key, not a pair, and a test pins that decision so it cannot drift into a fourth
  state unnoticed.
  
  Both new keys also land in `DETAIL_DEFAULT_TRANSLATIONS`, which
  `defaults-maps-mirror-en-pack` compares against the `en` pack key by key, so neither can fork
  between a provider-mounted console and a provider-less embed. No existing `en` value changes,
  so no pack is asked to follow an edit.
- 63d54dd: `record:path` now derives ONE stage classification and hands it to both of its rows, so a
  stage can no longer paint and announce two different ways depending on viewport width
  (objectui#5998).
  
  The renderer draws a desktop row (`hidden sm:flex`) and a mobile row (`flex sm:hidden`) from
  the same `stages[]`, and each used to compute its own `terminal` from that array.
  `renderStage` passes the same `terminal` to `railClass` and — since objectui#5957 — to
  `stageAriaLabel`, so any disagreement surfaced in the colour and in the accessible name at
  once. The rows disagreed on two axes:
  
  Mid-path goal. `WON_TOKENS` matches `完成`, an ordinary word rather than a Salesforce-style
  `closed_won` value, so a path like `草稿 → 完成 → 已归档` classified index 1 as `won`.
  Desktop declined it, because only the last forward stage can be the goal terminus; mobile
  marked it `bg-emerald-500/30` and announced `goal stage, not reached`.
  
  The lost slice. Desktop renders `stages.slice(firstLostIdx)` as a visually separated alt
  group and hardcoded `terminal: 'lost'` on every member of that positionally-defined group,
  while mobile classified each stage on its own. A plain stage after a `lost` one
  (`草稿 → 失败 → 已归档`) therefore painted destructive and announced `closed lost` on
  desktop and plain on mobile; a `won`-classified stage in the same position drew `'lost'`
  from one row and `'won'` from the other.
  
  Both rows now index a single `stageTerminals` array: `lost` is a property of the stage
  itself, `won` is the goal terminus and so is the last forward stage or nothing, and the
  positional grouping is a layout concern that no longer overrides what a stage is. Behaviour
  is narrowed on both axes and never widened — no stage gains a `terminal` on either row that
  it did not already carry there, and a goal terminus that really is last keeps its faint
  emerald rail and its `goal stage, not reached` name on both rows.
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
- d3005f7: `DetailSection` now resolves `section.headerColor` through a lookup of complete
  Tailwind class literals instead of building `bg-` + the authored value as a
  template literal (objectui#6178).
  
  Tailwind v4 has no runtime — it builds the stylesheet by scanning source text
  for complete class tokens, and this workspace ships no `bg-*` safelist — so the
  old expression contributed nothing to the compiled CSS. Measured, not assumed:
  compiling `apps/console/src/index.css` with that expression deleted produced a
  byte-identical stylesheet (same sha256). An authored value styled the header
  only when some other source file happened to author the identical class
  literally, which is why both documented examples appeared to work: `bg-muted`
  occurs 691 times and `bg-primary/10` 63 times elsewhere in the workspace. That
  liveness was accidental and moved with unrelated edits in unrelated packages.
  
  The shape matches the sibling this repo already solved the same way —
  `useRowColor`'s `COLOR_TO_CLASS` in `@object-ui/plugin-grid`:
  
  - a lookup of literal, tint-only design-system classes: `muted`, `muted/50`,
    `accent`, `primary/10`, `secondary/10`, `destructive/10`. Both values the
    `@object-ui/types` mirror documents (`muted`, `primary/10`) are in it, so
    nothing that rendered before renders differently now;
  - a value that is already a complete `bg-*` class is passed through untouched.
    This is new — `headerColor: 'bg-muted'` previously produced the meaningless
    `bg-bg-muted`;
  - anything else contributes no class at all, instead of a fabricated one.
  
  Behaviour change to be aware of: an undocumented bare suffix outside the
  vocabulary (say `headerColor: 'blue-100'`) no longer reaches the DOM as
  `bg-blue-100`. It rendered before only where another file happened to author
  that exact class; write it as the complete class (`headerColor: 'bg-blue-100'`)
  to keep it, on the same terms as any `className` a schema carries. No value is
  rejected and the declared type is unchanged.
  
  `headerColor` remains undeclared on the strict `@objectstack/spec`
  `record:details` section schema, which refuses it today on the strength of this
  defect (objectstack#11661). Declaring it, and with which vocabulary, is a
  separate spec decision.
- 830ed58: The record page's approval band offers its **Recall** button to the approval's submitter
  only.
  
  Field report on `@objectstack/*@17.2.0`: user A submits a record into a 4-level approval;
  user B — not the submitter, read access, not an admin — opens the record and the band still
  lights a clickable recall button. The click cannot succeed. The recall endpoint authorizes
  on submitter identity and refuses everyone else, so the only outcome available to that
  button was a failure toast. Record state was never at risk; this was purely a
  writability-feedback mismatch, the same family as objectui#3794.
  
  The button's only gate was `dataSource.cancelPendingApproval` — "can this adapter recall at
  all" — which is a question about the DataSource, not about the viewer. Identity now joins
  it, threaded the way every other signal on that band already travels: the HOST resolves it
  and passes it through `InlineEditProvider`, so the renderer stays DataSource-agnostic and
  never re-derives who submitted what.
  
  - `@object-ui/react` — `InlineEditProvider` accepts `approvalIsSubmitter`, surfaced on
    `InlineEditContextValue`. Additive and optional; no existing prop changes.
  - `@object-ui/plugin-detail` — the band's recall button is withdrawn when that signal is a
    resolved `false`.
  - `@object-ui/app-shell` — `RecordDetailView` resolves the verdict from its existing
    approvals read and threads it.
  
  **The signal is tri-state, and the third state is the load-bearing one.** `true` offers
  recall, `false` withdraws it, and **`undefined` — a host that resolves no approval identity
  — renders exactly as it did before this release.** Omission preserving prior behaviour
  mirrors how `approvalPending` falls back to `locked`. Defaulting the unknown case to "hide"
  would have traded a cosmetic defect for a functional loss: every host whose band runs off
  the record's `approval_status` mirror alone would silently lose its submitter's only way to
  unlock their own record.
  
  **Withdrawn rather than disabled-with-reason.** The card offered either. For a
  non-submitter this control is never actionable on any pending record, so a permanently
  disabled button is standing clutter rather than a lesson; and the two sibling submitter
  levers already hide — the approvals panel's Remind button, and the declared
  `approval_recall` action's `visible` predicate. The band, its quorum tally and the
  approvals timeline still tell a non-submitter exactly what state the record is in. Only the
  lever they can never pull is gone.
  
  **This changes no permission.** Nothing about what the server allows moves, `canEdit` and
  the approval lock are untouched, and nothing downstream reads `approvalIsSubmitter` as an
  authorization verdict — the recall endpoint remains the sole authority, and it refused
  these callers before this change and refuses them after. There is deliberately **no admin
  carve-out** (the reporter ruled that case out, cf. objectstack#9464).
  
  The derivation itself is now one function, `isSubmitterOf` — server-resolved
  `viewer.is_submitter` first (framework#3310), an id comparison as the fallback for backends
  that predate it, joined with `??` so a server that resolved `false` is believed rather than
  re-litigated client-side. The approvals panel's Remind gate, which already carried that
  expression inline and whose behaviour is unchanged, now reads the same answer: two copies
  would have been two definitions of who submitted.
  
  The **untranslated refusal text** the reporter also saw ("No pending approval request found
  for this record", concatenated after a localized prefix) is a separate defect and is not
  addressed here; it is tracked on objectstack#11993.
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
- a439e16: `record:alert` stops re-reading a degenerate `properties` bag as its own character indices — the sixth and last member of the `readProps()` family joins the five objectui#6783 converged (objectui#6790).
  
  The renderer's config-bag reader spelled its fallback `(schema?.properties ?? {})`. `??` only replaces `null`/`undefined`, so a non-object `properties` (a string, an array) went into the object spread and came back out as indexed keys: for `properties: 'not-a-bag'` the bag held `{ '0': 'n', … '8': 'g' }` beside the node's own keys — nine keys nobody authored. The reader — now its own module, `renderers/record-alert.readProps.ts`, the way `@object-ui/components` keeps its reader — asks `isConfigBag`, exported from `@object-ui/react`'s package entry since objectui#6783, and a degenerate bag contributes no keys. The expression itself is unchanged: the node's own keys stay underneath (the legacy flat spelling still resolves) and a nested key still wins the contested one; there is no `props` alias leg here and none is added.
  
  **What this does not change, measured rather than predicted.** No rendered output moves. `record:alert` reads named keys off the bag (`title`, `body`, `severity`, `icon`, `action`, `dismissible`, `dismissKey`, `visible`) and never spreads it onto a DOM element, so the indices were computed and then dropped; a degenerate bag renders exactly as no bag at all, before and after. The census behind objectui#6708 found zero authored nodes carrying a degenerate config bag. What the guard buys is what objectui#6752 measured its own guard buys: the authored value's shape is not reinterpreted.
- 03380aa: Inline edit: a rejected save now says WHICH field the server refused, and why.
  
  Editing a record in place on a detail page and hitting Save used to surface the
  backend's own string when the write was refused — `VALIDATION_FAILED:
  Validation failed for crm_opportunity` — leaving the user to guess which of the
  fields they had just edited was the problem. The refusal has always been
  field-scoped (`@objectstack/objectql`'s validators throw `VALIDATION_FAILED`
  with `fields[]`, and both the REST layer and the runtime dispatcher pass those
  entries through intact); the inline surface was the last one still dropping
  them. `<InlineEditSaveBar>` now renders one reason per rejected field, named by
  that field's own label — the same treatment record forms have had since #3222.
  
  Attribution never guesses. It reads the envelope through
  `@object-ui/react`'s `extractFieldErrors`, the single in-repo normaliser the
  form surface already uses, and an entry with no usable `field` is dropped
  rather than pinned on whichever input is nearby. In the drawer's callback mode,
  where persistence loops `onFieldSave(field, value)` one key at a time, a
  rejection is attributed to the key that was in flight — a fact about the write,
  not an inference. Anything that is not field-scoped (a network failure, a
  permission denial) keeps the cleaned single-line message it had before.
  
  `@object-ui/react` gains one additive public API member to carry this, and it
  is the reason that package's entry is `minor` rather than `patch`:
  `InlineEditContextValue` now has **`fieldErrors`** — a nullable map of field
  machine name to the server's reason — alongside a **`setFieldErrors`** setter,
  the exact companions of the `error` / `setError` pair that interface already
  carried. Nothing is removed and nothing changes shape, so every existing host
  and consumer compiles and behaves as before; a host that never reads the new
  member sees no difference. It exists because the save bar and the field rows
  are SIBLINGS under `InlineEditProvider` in both persistence modes, so before
  this there was no channel between the component that receives a refusal and the
  components that render the fields it is about.
  
  Also recorded in code, per the maintainer's ruling on objectui#6868: **the
  server is the validation authority on the inline-edit surface.** That was
  previously an absence — `InlineFieldInput` runs no rules and takes no `error`
  prop — and it is now a decision, written into both modules' headers with a
  pointer to the ruling. No client-side rule evaluator was added, and none should
  be: the server is the only rule source, and this surface only presents it.
- 639114c: Reconcile the declared surface with `@objectstack/spec` 17.3.0 (objectui#7122).
  
  ⚠️ **`@object-ui/types` is graded `minor` for a breaking surface change.**
  The exported `ObjectSchemaClientExtensions` narrows from
  
  ```ts
  export interface ObjectSchemaClientExtensions { editMode?: 'modal' | 'page' }
  ```
  
  to
  
  ```ts
  export type ObjectSchemaClientExtensions = Record<never, never>;
  ```
  
  Two breaking consequences for a consumer that names the type directly. **(1)** It
  no longer declares `editMode`; the key is now carried by the spec's
  `ServiceObject`, so `ObjectSchemaMetadata` still has it, but code written against
  the extension type ALONE loses it. **(2)** `interface` → type alias also ends
  **declaration merging**: a consumer that reopened
  `declare module '@object-ui/types' { interface ObjectSchemaClientExtensions { … } }`
  to add its own client-side member no longer compiles, because an alias cannot be
  reopened. `minor` rather than `major` per `AGENTS.md`'s version-alignment rule —
  objectui's own breaking changes are graded `minor` with the semantics stated in
  the body, since any `major` in the fixed group would push all 39 packages off
  `@objectstack`'s major.
  
  **`ObjectSchema.editMode` is now the spec's.** 17.3.0 adopted the key (measured:
  the accept set went 42 → 43, gained set exactly `['editMode']`, lost set empty,
  declared as the same `'page' | 'modal'` union objectui carried). Its local copy
  is retired from `ObjectSchemaClientExtensions`, which is what that type's own pin
  prescribed for this event, leaving the client delta empty. Nothing is removed
  from the product: `editMode` stays authorable and stays typed on
  `ObjectSchemaMetadata`, carried by the spec's `ServiceObject` instead of by a
  local member — and a published, spec-validated object document may now carry it,
  which at 17.2.0 was refused by name.
  
  **`user:profile` is retired across all three sites.** 17.3.0 dropped it from
  `PageComponentType` (measured: the enum went 34 → 32 options, lost set exactly
  `['user:profile', 'element:form']`, gained set empty). objectui went on knowing
  it in three places, so all three moved together: the Studio palette exclusion
  ledger, `PROTOCOL_COMPONENTS` in `renderers/placeholders.tsx`, and the
  regenerated `known-schema-types.ts` the CLI checks schemas against. Nothing
  user-reachable went with it — neither type had a renderer, `user:profile` had
  only the dashed "Component Placeholder" scaffold, and the app shell's own
  profile affordance is a React slot, never this block type. A page schema still
  naming it now draws the loud "Unknown component type" panel rather than a silent
  grey box, which is this repo's standing treatment for a type outside the
  supported surface.
  
  **`record:details` sections document the eight keys 17.3.0 added.**
  `group`, `hideEmpty`, `collapsible`, `showBorder`, `defaultCollapsed`, `icon`,
  `description` and `headerColor` are now declared on a section entry (4 → 12
  members). Six of the eight are already honoured by `DetailSection`, so the
  `sections` input description now teaches all of them, and says plainly which two
  are not read here. Designer controls for them are a separate feature and are
  deliberately not added.
  
  **`@object-ui/types` raises its declared `@objectstack/spec` floor `^17.0.0` →
  `^17.3.0`, and this is the second half of its `minor`.** The package's emitted
  `dist/spec-report.d.ts` names `FilterCondition` from `@objectstack/spec`, which
  `17.0.0` does not export, so the old range was a claim the artifact did not
  support — `scripts/check-spec-range-floors.mjs` reports it as `[floor-too-low]`
  and names `^17.3.0` as the lowest version carrying every symbol the package
  references. Breaking for a consumer pinned below 17.3.0: it can no longer
  resolve this package. That is the range stating the truth rather than a new
  restriction — the artifact already required those symbols — and it is the
  remedy the gate itself prescribes ("Raise that package's range to the lowest
  version that exports the symbol… Do not add a tolerant re-declaration on this
  side: the range is the claim, and the claim is what is wrong", `111741454`).
  `@object-ui/core` and `@object-ui/data-objectstack` already declare `^17.2.0`
  and `@object-ui/plugin-detail` `^17.1.0`, so a floor above the family minimum is
  this repo's normal state, not an exception.
  
  ⚠️ **Measured on both sides, because it is bump-caused rather than pre-existing
  and the card that filed the `[floor-too-low]` finding recorded the opposite.** The gate is a scheduled / push-to-main
  workflow that cannot red a pull request, and `main` is green on it — the last
  eight runs, most recently at `c2e3cee2c`. On this branch's built tree it exits 1
  with CI's own `--cross-check` invocation, and exits 0 with this raise, judging
  278 (subpath, symbol) pairs across 19 published packages either way. Its blocking
  copy runs on the publish path, so leaving it would have surfaced as a cancelled
  release rather than as a red check. The correction is recorded in `639114c4d`, the commit that landed this entry.
- 854cba3: `ActivityTimeline`'s empty state speaks the session locale (objectui#7142).
  
  The title was a raw English JSX literal — `title="No activity recorded"`, not a
  `t()` call and not an inline `defaultValue` — so it never reached the pack
  system and stayed English in all ten locales. Measured before the fix by
  rendering `activities={[]}` under a zh `I18nProvider`: the card read
  `"Activity(0)No activity recorded"`, while its sibling `RecordActivityTimeline`
  rendered `"活动(0)全部动态暂无活动记录"` from the same packs.
  
  The call site now reads `detail.noActivity`, the key the sibling already uses.
  Reusing it rather than minting a second key is a measured decision: the `en`
  pack value for that key is `'No activity recorded'`, byte-identical to the
  literal it replaces, so both surfaces were already saying the same words in
  English and a new key would have forked one sentence across ten packs for no
  copy difference. No pack was edited — the key is already translated in all ten,
  verified by reading `detail.noActivity` out of each pack object.
  
  Both routes to the box are covered: an empty `activities` array, and a
  populated timeline filtered down to a type with no entries.
- d8ec8d6: `ActivityTimeline` speaks the session locale — the other 18 literals
  (objectui#7149).
  
  objectui#7142 gave this component its first `t()` call (the empty-state title)
  and filed the sweep that found the rest. Until now a zh activity tab read
  `"Activity(0)暂无活动记录"`: one translated string in a component that was
  otherwise entirely English.
  
  All 18 now resolve from the ten packs, in three groups:
  
  - **Relative timestamps and the card title** (`just now`, `{{count}}m/h/d ago`,
    `Activity`) — these render on *every* activity tab. All five were a pure
    lookup swap: the `en` pack value was already byte-identical to the literal,
    and the sibling `RecordActivityTimeline` already used the same keys.
  - **The `formatFieldChange` sentences** — assembled in code, so they needed new
    keys *with* interpolation holes rather than a lookup. Same reachability as the
    timestamps: they render for any entry whose optional `description` is absent.
    The quotes live inside each pack's value, so every locale punctuates its own
    way (de `„…“`, zh `“…”`, ja `「…」`, fr/ru `«…»`).
  - **The six filter chips and the chip group's accessible name** — reachable only
    through the published export, since no host in this repo passes `filterable`.
  
  Ten new `detail.*` keys across all ten packs (no inline `defaultValue` —
  objectui#3517), mirrored byte-for-byte into `DETAIL_DEFAULT_TRANSLATIONS` so a
  provider-less host still reads English rather than a raw key.
  
  One deliberate English copy change: the chip group's `aria-label` was
  `"Activity type filter"` and now resolves `detail.filterActivity`
  (`"Filter activity"`) — the key `RecordActivityTimeline` already uses for the
  accessible name of its own activity filter, so one control does not carry two
  names across two components.
  
  Also drops the unused `Filter` import (a pre-existing eslint warning).
- 866cd1d: `RecordComments` and `PointInTimeRestore` resolve their copy from the locale
  packs instead of hardcoded English (objectui#7163).
  
  Both files carried their own `formatTimestamp` whose relative-time branches
  returned English literals, so a zh/ja/ar session read `5m ago` next to
  otherwise translated chrome — the defect objectui#7142/#7149 fixed one file
  over in `ActivityTimeline`.
  
  - **`RecordComments`** was already wired to the packs (11 `t('detail.…')`
    references), so this is a pure lookup swap onto `detail.justNow` /
    `minutesAgo` / `hoursAgo` / `daysAgo` — keys already present in all ten packs,
    each `en` value byte-identical to the literal it replaces. **No new key, no
    copy change.**
  - **`PointInTimeRestore`** used no translation hook at all, so it is swept
    WHOLE rather than having only its timestamps converted: card title, empty
    state, field-count line, preview panel, snapshot heading, restore
    confirmation and all three buttons. Wiring one string into an otherwise
    untranslated component is what shipped objectui#7142's visibly half-done zh
    card; that is not repeated here.
  
  Ten new `detail.*` keys land in all ten packs and in
  `DETAIL_DEFAULT_TRANSLATIONS`: `revisionHistory`, `noRevisions`,
  `revisionFieldsChanged`, `revisionFieldsChangedOne`, `revisionPreview`,
  `revisionSnapshot`, `restoreConfirm`, `restoring`, `confirmRestore`,
  `restoreToPoint`. `detail.cancel`, `detail.activityEmptyValue` and
  `detail.emptyValue` are **reused**, not forked.
  
  The restore confirmation becomes one key with a `{{when}}` hole rather than a
  sentence assembled around a JSX expression, and the field-count line uses the
  repo's two-key plural convention selected by a static ternary over two literal
  keys — never `t(KEYS[n])`, which objectui#7149 measured as invisible to the
  i18n scanners.
  
  One deliberate copy change: the snapshot panel's null placeholder was an EN
  DASH (`–`, U+2013) written inline and now resolves `detail.emptyValue`, which
  is an EM DASH (`—`, U+2014) in all ten packs — the glyph the rest of the detail
  package already uses for an empty value.
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
- 63a8828: Record headers: give the title column a width floor so a wide action tail can no
  longer starve it.
  
  Two headers repeated the title/action width arbitration objectui#7244 fixed on
  `page:header`. Both were measured in Chromium at a 799px viewport with three
  labelled `record_header` actions, before and after:
  
  | header | before | after |
  | --- | --- | --- |
  | `DetailView` (`type: 'detail'`, the header that renders when the host supplies no `page:header`) | h1 6.17px of a 218px title | 218.39px, tail wrapped to its own line |
  | `PageHeader` (`@object-ui/layout`) | h1 170.59px of a 265px title | 751.00px, tail wrapped to its own line |
  
  `DetailView` gets the precedent's two utilities, both `sm:`-scoped so the
  sub-640px column layout is untouched: `sm:flex-wrap` on the row and
  `sm:min-w-64` on the title column. The floor is one step above the precedent's
  `sm:min-w-48` because this title column carries the 40px back button and a 12px
  gap inside it, so 256px is what leaves the h1 the same ~192px readable floor.
  
  `PageHeader`'s row already wrapped, so it needed only the floor — and that floor
  is unconditional rather than `sm:`-scoped, because this row has no
  breakpoint-scoped direction change and the squeeze measures worse just below
  `sm` (639px: h1 10.59px of a 212px title). `min-w-48` replaces `min-w-0` rather
  than joining it: an explicit min-width overrides a flex item's automatic
  min-content minimum exactly as `min-w-0` did, so long titles still ellipsise
  (measured at 799px: 751px rendered of a 1682px title, no horizontal overflow).
  
  Wide viewports are unchanged: at 1440px both headers keep the tail on the
  title's line with the title unclipped, before and after alike.
- dc0a60b: fix(plugin-detail): `record:related_list` can now bind to a multi-value relationship field
  
  `RelatedList` compiled its parent-relationship condition as bare equality
  regardless of the field's arity. When the relationship field is declared
  `multiple: true` — `Field.user({ multiple: true })` is the platform's own shape
  for "one record names N people" — the stored value is an array persisted as a
  JSON column, `=` compares that whole serialized value against a single id, and
  the driver refuses with `400 INVALID_FILTER` while prescribing `$contains`. The
  membership spelling was not reachable from the authoring surface at all: the
  parent filter is composed by the component from `relationshipField` alone, so
  the list could not be written correctly, only not written.
  
  The condition is now compiled to match the field's declared arity, read off the
  child object's schema the component already fetches: `multiple: true` becomes
  `{ [relationshipField]: { $contains: parentId } }`, everything else keeps `=`
  byte for byte. No authoring key was added — the author is naming a
  relationship, and its storage form is the renderer's business.
  
  The legacy raw-URL fallback (no `dataSource` adapter) cannot express membership
  at all: its `filter[<field>]=<value>` grammar carries no operator, and the
  repo's one operator contract for that spelling recognises only `gte`/`lte`/
  `gt`/`lt` and DROPS anything else — a hopeful `[contains]` suffix would arrive
  as no condition, i.e. an unscoped fetch of the whole child table. That path now
  refuses and says so, the same posture the sibling filter arm and the
  unscoped-fetch guard already take.
- 02fe257: fix(plugin-detail): `record:alert` resolves its CTA through the shared `resolveDeclaredActionIds` instead of a third hand-written lookup by name (objectui#7382)
  
  `record:alert`'s optional CTA (`action.actionName`) was looked up with its own
  `find` over the object's `actions` metadata. `page:header` and
  `record:quick_actions` already share `resolveDeclaredActionIds` from
  `@object-ui/types` for the same job (objectui#7182), so there were three
  copies of one lookup. The banner now calls that function with a one-element
  list, and with an empty list when no CTA is authored.
  
  What stays the same:
  
  - A known `actionName` renders the same button, backed by the definition the
    object registers. When two actions share a name, the first one registered
    still wins.
  - An unknown `actionName` still renders no button and logs nothing. Catching a
    misspelled name is left to authoring time, in objectstack's
    `action-name-undefined` lint (objectstack#20105).
  - With no `actionName`, the banner still makes no metadata read.
  
  What is guarded or changes:
  
  - An object authored at `actionName` renders no button. The shared function
    treats an array of objects as inline action definitions, but the banner
    reads only the action-id result. So an object in that slot is never handed
    to the action engine and never runs. The old lookup never matched an object
    either. The guard keeps the swap from turning that slot into a way to author
    an executable action.
  - If an object's `actions` metadata is not an array, the banner now renders
    without a button. The old lookup threw inside the banner's render instead.
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
- fe8f451: Fix `record-alert` with `severity: 'success'` rendering a database glyph instead of a
  check mark (objectui#7593).
  
  `SEVERITY_STYLES.success.icon` was the string `'CheckCircle2'`. That literal reaches
  `<LazyIcon name={…} />`, whose resolver degrades an unresolvable name to the `Database`
  icon — deliberately, because server-driven schemas reference icons from other
  libraries and it is better to degrade than to throw. The result was an emerald
  "success" banner with a database glyph in it, on every such alert, silently.
  
  The fix is the live spelling `'circle-check'`, and it is **substitution-free**: it was
  derived by identity rather than remembered. On `lucide-react@1.31.0`,
  `CheckCircle2 === icons.CircleCheck` is `true` — the same glyph object under two names
  — so the repair cannot change which glyph is drawn, only whether one is drawn at all.
  `CheckCircle2` remains a live named export, so static `import { CheckCircle2 }`
  call-sites are unaffected; it is dead only for NAME-BASED lookup, which is the route
  this constant takes.
  
  The load-bearing half is a new pin, because nothing could catch this in either
  direction. The icon gate does not judge dynamic-surface resolvers (its own verdict line
  says so), and the renderer's suite mocks `LazyIcon`, so its assertion could only echo
  the literal back — and it did, pinning the dead spelling. The pin consults the real
  resolver and asserts that every `SEVERITY_STYLES` icon RESOLVES, rather than that it is
  spelled any particular way, so it fails on the actual failure mode rather than
  restating the diff.
  
  The other three severities (`Info`, `AlertTriangle`, `AlertCircle`) are **not** changed
  and were never defective: two of them are absent from lucide's `icons` record but
  present on the dynamic surface (1767 keys vs 2025 names), which is the surface that
  decides here, so they resolve and render correctly today.
- 592402e: The README's Activity tab example names `record:activity`, a block this package
  registers, instead of `activity-timeline`, which nothing registers
  (objectui#8114).
  
  `README.md` ships in this package's `files`, so the example went out in every
  tarball. `DetailTabs` renders a tab's `content` through
  `<SchemaRenderer schema={toRenderableSchema(tab.content)} />`, which makes
  `content.type` an SDUI node position judged by the component registry — so a
  reader copying the tab got the registry's `Unknown component type` panel
  (OBJUI-001) where the timeline should be. Same shape as the `line-chart` widget
  in `plugin-dashboard/README.md` (objectui#7896's census; fixed by objectui#7951)
  and the fourth known instance.
  
  Which type replaces it was read off the registry rather than guessed, using the
  repository's own derivation — `deriveRegistryKeys()` from
  `scripts/check-doc-component-types.mjs`, the 649-key universe that gate judges
  against:
  
  | key | reading |
  |---|---|
  | `record:activity` | REGISTERED — `packages/plugin-detail/src/index.tsx:673` |
  | `activity-timeline` | absent |
  | `activity` (bare) | absent — the `skipFallback: true` half |
  | `related-list`, `detail-section`, `record:details` | REGISTERED (lit controls) |
  
  Two keys move, because naming the type alone would leave the block fed through a
  key it never reads:
  
  - **`type: 'record:activity'`**, namespace spelled out. The registration passes
    the bare name under `{ namespace: 'record', skipFallback: true }`, and
    `skipFallback` is what keeps the bare name unclaimed — `record:activity`
    resolves, `activity` does not. That `activity` is also the tab's own `key` is
    a coincidence of spelling, and the card that filed this read the key as
    evidence there was no such component type.
  - **`items`, not `data`.** `RecordActivityRenderer` takes its feed from `items`
    on the node, a mounted discussion context, or a self-fetch from `sys_activity`
    scoped off `useRecordContext`. The last two need a record host and a bare
    `<DetailView>` mounts neither, so the example's own intent — a caller handing
    over a feed it already owns — is the first source. `data` is read on no path.
  
  `activityData` is retyped from `Record<string, unknown>[]` to the exported
  `FeedItem`, which puts the block under `check:doc-snippets`. No package source
  and no runtime behaviour changes.
  
  **Still ungated, stated so this is not mistaken for coverage.**
  `check:doc-types` is the gate that judges `type` literals and it deliberately
  does not walk `packages/NAME/README.md` — that widening is objectui#7896's, and
  objectui#7896 is blocked by this card. Measured rather than assumed: with an
  unregistered type substituted back into this very block, `check:doc-snippets`
  and `check:doc-types` both still exit 0.
  
  ⚠️ **Dated note, 2026-10-02 — the Activity tab authors `properties`, not `items` — objectui#11515.**
  At this change the README's Activity tab handed `record:activity` a feed it
  already owned as `items: activityData`, typed `FeedItem[]`; now the tab authors
  the block's declared inputs in `properties` (`{ limit: 20, showCompleted: false }`),
  `activityData` and its `FeedItem` import are gone, and in a bare `<DetailView>`
  the tab draws the block's empty state, because `items` is the host's feed slot
  the node refuses by name (objectui#11321). The `items, not data` bullet above
  and the sentence on `activityData` no longer describe the README. The rest of this entry is kept as the reading of this change.
- e2feb13: `record:details`' dedupe no longer hides a field row when the page H1 is an
  interpolated `titleFormat` that names no single field (objectui#8351, maintainer
  ruling 2026-09-08, decision batch #82, option B).
  
  **What changed for a user.** On an object declaring a `titleFormat`, a record
  whose title renders as a composite — `"{contract_no} - {name}"` rendering
  `HT-2026-001 - Acme Corporation` — now shows **every** field in the details grid.
  Before, one row silently disappeared: the ladder asked "which single field is the
  H1 showing?", got the ADR-0079 declared pointer as an answer, and hid that row —
  while the H1 was showing a template that is not that field's value, and is not any
  field's value. Nothing errored; a field was simply absent.
  
  **What did not change.** The dedupe still removes a genuine duplicate. Three cases
  are distinguished, and the rendered title decides which:
  
  - the template renders a composite no field's value equals → nothing is hidden;
  - the template renders nothing on this record (no placeholder resolved) → the
    header has already walked past that rung onto the declared pointer, and the
    existing ladder hides that row exactly as before;
  - the template collapses onto one field's value — a blank placeholder dropped with
    its orphan separator, or a single-field format like `"{name}"` → that row *is*
    the duplicate and is still hidden.
  
  "Fully interpolates" is measured with the instruments already in the chain, not a
  new predicate: `formatTitleTemplate` (what `getRecordDisplayName` step 3 and
  `DetailView.resolveDisplayTitle` step 2 both call) renders the title, and
  `recordDisplayValueAt` — the same emptiness authority the rest of the ladder uses
  — answers whether that string is some candidate's value.
  
  **Deliberately out of scope**, both by the same ruling: `page:header`'s own
  `schema.title`, which this package cannot see at all; and the order in which
  `PageHeaderRenderer` ranks `titleFormat` against the ADR-0079 name pointer, which
  would move what the H1 *shows* on existing records and retire a currently-green
  pin — a maintainer question carrying its own card. This fix deliberately does not
  depend on which of those two rungs wins the header: it compares the rendered title
  against the candidates' values, which answers the dedupe under either order.
- e6ec217: A masked detail row no longer offers to copy its value (objectui#8440, maintainer
  ruling 2026-09-08, option A).
  
  `@object-ui/fields` renders `password` and `secret` cells as `••••••` — the cell
  deliberately refuses to show the value. `DetailSection` offered click-to-copy on that
  same row anyway and handed the **raw** credential to the clipboard: silently, with no
  error and no visible sign. A masked cell that copies in the clear is worse than an
  unmasked one, because the reader believes the value is protected.
  
  Rows whose field type is masked are now not copy-interactive at all: no row click, no
  Enter/Space, no hover copy button, in either the desktop or the mobile row layout. The
  alternative — copying the bullets — was considered and refused as a second silent wrong
  answer.
  
  The refusal is a separate gate, deliberately **not** spelled into `canCopy`: that name
  is one of the readers of the shared emptiness authority (`hasCellValue`), and a masked
  row is not an empty one. Emptiness classification, the "Show N empty fields" counter,
  the auto-hide heuristic and every ordinary row's clipboard payload are unchanged.
  
  Like the editability gates beside it, the new gate reads the view's authored `type` and
  the object schema's `type` separately and answers their **union**, so a presentation
  override can withdraw the affordance but never restore it on a credential column.
- fd9c50a: The record page's summary chips beside the H1 no longer render an object-valued
  field as the literal text `[object Object]`.
  
  `effectiveSummaryFields`' chip displayed `String(val)` with only currency, date,
  datetime, percent and the option families formatted, so an expanded lookup
  payload, a location or an address printed the placeholder next to the page
  title — and, because the chip's accessible name is built from that same string,
  in its accessible name too.
  
  An object value is now drawn by the field's own cell renderer, the way the
  highlights strip one band below already reads it: a lookup chip shows the
  referenced record's name, an address chip its formatted postal line, a location
  chip its coordinates. Fifteen field kinds whose renderer does not fit a pill —
  the option families (a badge inside a badge), `user` (an avatar), the image
  family (no text at all), and the kinds that draw a "No value" face for a value
  the page has just called filled — keep a text chip and take
  `@object-ui/fields`' shared value coercion instead.
  
  Values that already rendered are untouched, and the chip's emptiness
  classification is unchanged.
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
- 81a51db: `record:details` — implement the `sections[].group` reference form, stop one
  section taking its siblings down, and resolve enumerated field labels through
  the object's declared `label` (objectui#8497).
  
  **An authored `{ group: 'parties' }` used to blank the whole record page.**
  `@objectstack/spec` 17.3.0 declares the group-reference form in full
  (`RecordDetailsProps.sections[].group`, objectstack#13855, ADR-0085 §5), but
  this renderer read the key nowhere, and its own props description told authors
  so. That was not a no-op: a section carrying `group` carries no `fields`,
  `DetailView` mapped every section through `s.fields` unguarded, and `flatMap`
  kept the resulting `undefined` as an element whose `.name` the next line read.
  The throw arrived with `e99770841` (2026-05-01), months before the key it
  fires on was declared, so it was never a deliberate refusal — the declaration
  was right and the runtime had never honoured it. `group` is now resolved
  through `deriveFieldGroupDetailSections`, the same adapter the synthesized
  default record page uses, so the group-referenced body and an equivalent
  enumerated body render identically. A `group` naming no declared group renders
  nothing and says so on the console (`@objectstack/lint` reports it as
  `page-section-group-unknown`); it is no longer silent, and it no longer throws.
  
  **A malformed section now degrades to that section.** Two layers, because one
  is not enough: the field-collecting reads are tolerant of a section with no
  `fields` array (the crash above fired in a `useMemo` above the section loop,
  where no boundary could reach it), and each section is additionally wrapped in
  the per-section error boundary, so a section that throws while rendering shows
  the failure in its own place instead of replacing the whole component.
  
  **Enumerated field labels reach the object's declared `label`.** The ladder is
  `i18n bundle key -> the object's declared label -> the field name`. Rung 2 was
  missing, so an app with no translations configured showed raw snake_case field
  names on every detail page. An authored entry `label` still wins, and an app
  with a full bundle is unchanged.
- c300267: fix(plugin-detail): the record page's two hand-rolled empty placeholders become the shared `EmptyValue`
  
  `DetailSection` (the details body grid) and `HeaderHighlight` (the ADR-0085
  highlights strip) each spelled their own `<span>—</span>` for a missing value and
  resolved their own accessible name from `detail.noValue`. Both now render
  `@object-ui/components`' `EmptyValue`, which resolves exactly that key with the
  same `"No value"` English fallback through a provider-safe hook — so the
  accessible name is byte-identical in every locale, and the placeholder gains the
  shared `data-slot="empty-value"`, `no-underline` and `select-none` treatment.
  
  Two deliberate visual changes, decided per site:
  
  - Both retire their own `text-muted-foreground/60 text-sm` treatment and take the
    shared `text-muted-foreground/50`. That was not a neutral difference: a
    type-aware cell renderer already draws the same shared component at `/50` in
    the very next row or chip (an unparseable `datetime` is the reachable case), so
    one section could show two dashes in two greys.
  - `DetailSection` keeps its `title` hover affordance, and keeps it working: the
    shared component is `pointer-events-none`, on which a `title` never renders a
    tooltip, so that one site restores `pointer-events-auto`. `HeaderHighlight` has
    no `title` and takes the shared non-interactive default unchanged.
  
  `EmptyValue`'s docblock also stops calling its `glyph` default an "en-dash"; it
  is and always was U+2014, an em-dash. Comment only — no behaviour change in
  `@object-ui/components`.
- cc00c59: An authored `detail-section` node now renders. It used to draw an error banner.
  
  The registration declares eight FLAT inputs — `title`, `description`, `fields`,
  `collapsible`, `defaultCollapsed`, `columns`, `showBorder`, `headerColor` —
  while `DetailSection` declares a single `section` OBJECT prop and reads
  `section.*` only. `SchemaRenderer` spreads a node's non-metadata keys as React
  props, so an authored node arrived as `title` / `fields` / … and `section`
  arrived `undefined`.
  
  Not merely inert. `DetailSection`'s first statement is
  `React.useState(section.defaultCollapsed ?? false)`, so the render THREW and
  `SchemaErrorBoundary` put its orange banner on the page in place of the block —
  measured end to end through the real `SchemaRenderer` and the real registry:
  
  ```
  Component "detail-section" failed to render
  Cannot read properties of undefined (reading 'defaultCollapsed')
  ```
  
  The tag is now registered against a seam adapter that folds those eight
  declared inputs into the `section` object the component reads — the same shape
  of repair this package already uses for `field:permission-facet-link`
  (`withFieldCarrier`, objectui#3307).
  
  **The authoring surface did not move, deliberately.** The other available
  repair — re-declaring the eight as a nested `section` input — would have
  changed what authors may write, and the flat shape is both published and
  authored: a manifest built the way `PageRenderer` builds the JSX-page
  compiler's gives the flat eight ZERO diagnostics and REFUSES `section`
  (`unknown-prop`, plus `missing-required-prop "fields"`), this package's README
  documents a flat `detail-section` node inside `tabs[].content`, and
  objectui#6955's landed pin asserts that same flat surface. Folding at the seam
  invalidates none of them.
  
  `DetailSection` itself is byte-identical: every in-repo caller passes
  `section={…}` as a direct JSX child and is untouched.
  
  Superseded in this release by objectui#9529 and objectui#10485: the
  registration now declares ten flat inputs, not eight — the eight above plus
  `icon` (objectui#9529) and then `hideEmpty` (objectui#10485) — and the adapter
  folds all ten. The count of eight above describes the tree this entry was
  written against; the live list is `DETAIL_SECTION_NODE_INPUTS`, held against
  the registration in both directions by the fold-parity row of
  `detailSectionAuthoredNode-8626.test.tsx`.
- 541ce4e: `record:related_list` accepts `relationshipValueField`, and three record
  renderers stop erasing their own props annotation (objectui#8649).
  
  **`@object-ui/types` — `RecordRelatedListComponentProps` gains
  `relationshipValueField?: string`.** Nothing that worked stops working; a
  document that was already valid everywhere else stops being refused here.
  `@objectstack/spec` declares the key (`RecordRelatedListProps.relationshipValueField`,
  `z.string().default('id')`), `RecordRelatedListRenderer` has always read it, and
  `@object-ui/plugin-detail`'s registry has published it as an input since
  objectui#3808 — every layer declared it except this published TypeScript face:
  
  ```ts
  // before — TS2353, while the platform accepted the same document
  const props: RecordRelatedListComponentProps = {
    objectName: 'task', relationshipField: 'account', relationshipValueField: 'name',
  };
  // after — accepted, with the contract's own type
  ```
  
  This is an **alignment, not a widening**: the accept set of this face moves to
  the contract's and never past it. The pin that says so re-derives the contract
  side on every run rather than restating it
  (`packages/plugin-detail/src/renderers/__tests__/detailRendererUndeclaredKeys-8649.test.ts`).
  
  **`@object-ui/plugin-detail` — the annotation-erasing destructure default is
  gone from three renderers.** `record-details.tsx`, `record-highlights.tsx` and
  `record-related-list.tsx` each annotated `schema` correctly and then wrote
  `schema = {} as any`. A destructuring default's type joins the annotated
  property type at the binding, so `any` erased the annotation for *every* read
  site in the file — declared keys and undeclared ones alike read `any`. No
  published surface moves: the exported annotations were always correct.
  
  The repair made the compiler name a latent contract violation the `any` had
  hidden, and it is fixed here: `RecordRelatedListBody` passed a possibly-unbound
  `objectName` into `ResolveRelatedRecordActionsInput.objectName`, which is
  `string`. The call is now gated on the key being bound. **Output-identical**,
  both halves measured rather than assumed — `resolve` is pure and its only use of
  the key (`objects.find((o) => o?.name === objectName)`) finds nothing for
  `undefined` and returns `{}`, and the result is discarded on that path by the
  `if (!objectName)` placeholder return.
  
  **`record:reference_rail` declares the node-level `properties` envelope it
  reads, and the read now uses the declaration.** The renderer accepts a node
  either flattened (`schema.entries`) or enveloped (`schema.properties.entries`).
  The enveloped read went through an explicit `(schema as any)` cast — **not**
  through the schema type's `[k: string]: any`, which had nothing to do with it —
  so `entries` arrived as `any` on that path. Both halves are fixed here: the
  member is declared **and** the cast is removed, so the checker types the read
  `ReferenceRailEntry[]` (the trailing `as ReferenceRailEntry[]` assertion went
  with it — the declared type supplies it). `properties` is `@objectstack/spec`'s
  own node-level key (`PageComponentSchema.properties`, "Component props passed to
  the widget") with the standing `dataSource` and `className` have. Declaring it
  **narrows** an accept this face already granted through its index signature — it
  widens nothing, and `properties` itself stays open because the contract declares
  it as a record.
  
  ⚠️ Declaring a member is not enough on its own when the read site casts: a cast
  defeats the declaration while a membership instrument still reports the member
  as present. The pin now fails if the cast returns.
  
  ⚠️ **Three keys are deliberately NOT declared, and no runtime behaviour
  changes.** `enforceFieldSecurity`, `redactFields` and `requiredPermissions` are
  read by all three renderers and are **routed to the producer**, not declared
  here and not retired here. Measured on the installed contract over the block-tag
  map `ComponentPropsMap` — the authoring surface an author writes into — plus the
  node envelope every block shares, with controls in the same pass:
  
  ```
  enforceFieldSecurity · redactFields   declared by no block, and not on the node
  requiredPermissions                   declared by exactly one block,
                                        `record:quick_actions`, and by none of
                                        record:details / :highlights / :related_list
  aria · fields                         declared by many blocks          <- CONTROL
  zzqx_no_such_key                      declared by none                 <- CONTROL
  ```
  
  Declaring them here would make this repo accept what the platform refuses;
  retiring the reads would delete a redaction that works today on the raw-node
  path. Both keys stay honoured exactly as before, and the census above is a test,
  so it goes red the day the platform declares one of them.
  
  **Correction, 2026-09-30 (objectui#8649).** The paragraph above that begins
  "Three keys are deliberately NOT declared" is superseded, together with the
  census under it. `@objectstack/spec` 17.5.0 declares `enforceFieldSecurity`,
  `redactFields` and `requiredPermissions` on `record:details`,
  `record:highlights` and `record:related_list`, and PR objectui#11184 declares
  the same three keys on those blocks: on their `@object-ui/types` props
  interfaces, as their registry inputs, and at the renderers' read sites, which
  no longer cast. That pull request carries its own release note. The paragraph's
  behavioural statement still holds: no runtime behaviour changes, and all three
  keys are honoured exactly as before.
- ab77513: feat(fields): `isMaskedFieldType()` and `MASKED_FIELD_TYPES` answer "is this field type's cell drawn as a mask?"
  
  **New public API on `@object-ui/fields`:** `MASKED_FIELD_TYPES` (a `ReadonlySet<string>`,
  today `password` and `secret`) and `isMaskedFieldType(fieldType)`. They are the read-side
  twin of `INLINE_EXCLUDED_FIELD_TYPES` / `isInlineExcludedFieldType()`. Additive; nothing
  existing changes shape.
  
  Until now the fact lived only as two entries in `getCellRenderer`'s standard table, and
  nothing outside the package could ask it. So the detail page's copy refusal
  (objectui#8440) kept its own two-member list: a masked type added to the fields package
  would render masked and stay one click from the clipboard there.
  
  - The standard table's masked entries are now built from `MASKED_FIELD_TYPES`, so the
    set and the drawn mask are one fact.
  - `isMaskedFieldType()` reads the LIVE cell registry. A type registered with the mask
    (`registerFieldRenderer('api_token', getCellRenderer('password'))`) answers `true`. A
    shipped mask replaced at runtime with one of this package's own renderers answers
    `false`, since none of them is the mask; the cell then draws what that renderer draws
    (for `TextCellRenderer`, the value). A shipped mask
    replaced with a host component the package cannot inspect keeps the declared answer
    (`true`), on the side that withholds the value.
  - It matches raw spellings only, as `getCellRenderer` does: `field:password` renders in
    the clear and is not masked.
  
  `@object-ui/plugin-detail`: `isMaskedDetailFieldType` now asks `isMaskedFieldType()`
  instead of keeping its own list. It stays the narrow-only union of the view's and the
  object's type (objectui#3355). Behaviour changes only where the two used to disagree:
  a masked type registered at runtime now refuses the copy affordance, and a shipped mask
  that a host replaced with a package text renderer offers it again.
- 0b138da: The record page's summary chip names its field by its LABEL, like every other band
  of the page (objectui#8729).
  
  The chips beside the record H1 carry no visible label, so `<field>: <value>` is the
  whole of what a screen-reader user hears — and the name half was the raw stored
  column. A record whose `owner_ref` column is authored as "Account Owner" announced
  `owner_ref: Ada Lovelace`, so the one band that only a screen-reader user perceives
  was also the one band exposing the database spelling.
  
  Every sibling on the same page already resolves a label through one shared helper —
  `HeaderHighlight` calls `fieldLabel(objectName, field.name, field.label)` and
  `DetailSection` calls it with `field.label || field.name`. This chip now makes the
  same call, so the chip and the highlight strip one band below name the same field
  the same way, including under a translated session, where the resolver (not the
  authored string) decides.
  
  The chip is addressed by NAME (`summaryFields: ['owner_ref']`), so it resolves the
  label it hands that helper from this render's own field resolution: the author's
  view entry first, then the object schema, then the stored name as the floor — the
  same precedence `enrichDetailField` states and the same floor `DetailSection`
  spells. A field whose authored label already equals its stored name announces
  byte-for-byte as before.
  
  All three of the chip's name sites move together: the string branch's `aria-label`,
  the percent branch's `aria-label`, and the renderer-backed branch's visually-hidden
  prefix. The `data-summary-chip` attribute keeps the raw stored column — it is a
  machine handle for tests and automation, not a name for a reader.
- 16a1a51: fix(plugin-detail): `record:reference_rail` compiles its parent scope by relationship ARITY, and stops offering a link it cannot express
  
  The rail took an author-supplied `relationshipField` per entry and compiled it
  as bare equality TWICE, in two different grammars: the `$filter` it puts on the
  wire and the `filter[<field>]=<value>` URL its "View All" link points at. When
  the named field is `multiple: true` — `Field.user({ multiple: true })` is the
  platform's own shape — the stored value is an array, `=` asks whether that
  whole array IS one id, and the driver refuses with `400 INVALID_FILTER` while
  prescribing `$contains`. The rail was empty for a perfectly legal authoring
  choice, and for one the platform reaches with no authoring at all: a child
  object's `lookup` field is derived into a rail entry whatever its arity.
  
  The `$filter` half now goes through `composeParentScopeFilter` from
  `@object-ui/core` — the one compiler the related list's rows and its tab badge
  already share — so a multi-value relationship is queried by membership and
  everything else keeps `=` byte for byte. No authoring key was added: the author
  is naming a relationship, and its storage form is the renderer's business. The
  child object's field defs are resolved BEFORE the reads rather than after a
  refusal, because the rail dispatches its queries once per (record + entries)
  and has no second attempt to correct itself with. Resolution is best-effort,
  not a gate: an adapter that cannot serve metadata still reads rows, with the
  equality wire it has always sent.
  
  The link half is the COST. No URL spelling on this surface carries membership —
  the data surface recognises `gte`/`lte`/`gt`/`lt` and drops any other suffix,
  and the route the rail actually links to parses equality only — so a hopeful
  `[contains]` suffix would not narrow the destination at all and "View All"
  would open the entire child table dressed as this parent's related records.
  Rather than ship a rail whose rows and link disagree, the link is suppressed on
  a multi-value relationship and the reason is logged once. Single-value entries
  keep their link with a byte-identical href.
- 0601af1: Bind the host discussion fallback to the same feed pipeline the authored
  `record:discussion` / `record:chatter` block runs (objectui#8983).
  
  **User-visible.** A record page whose AUTHORED page schema omits a discussion
  block gets the host's bottom auto-append. That fallback used to mount
  `RecordChatterPanel` directly with raw rows, while the authored/synthesized
  block renders through `RecordChatterRenderer`, which since objectui#8934 runs
  `applyFeedConfig`. The two surfaces therefore rendered different feeds from the
  same rows: a completed activity appeared on the fallback and not on the block
  (the spec's `showCompleted` default is `false`), and a feed longer than the
  default page window rendered whole on the fallback and paged on the block.
  
  The fallback now mounts `RecordChatterRenderer` — the very component
  `ComponentRegistry` resolves both block names to — with no authored schema, so
  it reads the feed off the `DiscussionContext` the view already provides and runs
  the one pipeline. Concretely, on a record whose feed carries a completed
  activity, the auto-appended panel no longer lists it; on a record with more than
  twenty feed rows, the auto-appended panel now shows the newest twenty with a
  working "Load more" instead of the whole feed at once. Both are
  `record:activity`'s declared behaviour, which is what `@objectstack/spec` says
  the `feed` key is.
  
  Deliberately a binding rather than a copy: the fallback was not taught its own
  filter logic, so there is one implementation of the feed pipeline and not two
  kept in agreement by hand.
- c271413: fix(plugin-detail): coerce `record:details`' authored body width at the boundary
  
  `@objectstack/spec` declares `RecordDetailsProps.columns` as a string enum,
  while `DetailViewSchema.columns`, `DetailViewSection.columns`,
  `applyDetailAutoLayout`'s `columns` parameter and the `DetailViewField.span`
  written from it are all `number`. `RecordDetailsRenderer` passed the authored
  value straight through, so those declared-`number` slots carried the string at
  runtime — invisible to `tsc` because the synthesized node is annotated `any`.
  
  The renderer now translates the contract's spelling into the internal node's
  spelling at the one place they meet. No rendered class, grid width or
  responsive behaviour changes: the output is byte-identical across every
  authored width. The published `@object-ui/types` declarations are untouched —
  neither the protocol nor the internal type is widened to meet the other.
- 4784bb3: The `summaryFields` chip beside the record H1 reads the repo's percent authority
  instead of a drifted copy of it (objectui#9071).
  
  The chip scaled a stored `percent` by a rule of its own — a pass-through above 1,
  a scale-by-100 at or below it — while `percentDisplayValue` in `@object-ui/core`,
  the declared single source of truth that the list cell (`formatPercent` /
  `PercentCellRenderer`), the dashboard measure (`formatMeasure`) and the grid
  column summary all reach, uses the symmetric `value > -1 && value < 1`. The local
  predicate is deleted, not realigned.
  
  **Two values move, and only these two.** They are exactly where the two rules
  disagreed:
  
  - a stored `1` now reads `1%` beside a bar at 1%, where it read `100%` beside a
    full bar — one percentage point, the answer every other surface already gave;
  - a stored value at or below `-1` is passed through: a stored `-5` now reads
    `-5%` where it read `-500%`. The bar is unchanged for these inputs, since any
    negative clamps to an empty track either way.
  
  Everything inside the band the two rules always agreed on is byte-identical: a
  stored `0.25` still reads `25%`, `0.123` still reads `12.3%`, `12.3` still reads
  `12.3%`, `250` still reads `250%`, and the float-residue trim that keeps `0.07`
  reading `7%` rather than `7.000000000000001%` is unchanged.
  
  ⚠️ **Dated note, 2026-10-02 — the magnitude guess is retired in this same release — objectui#11475.**
  Later in this same release `percentDisplayValue` (`@object-ui/core`) stopped
  inferring a percentage's storage from the value: it takes the storage as a
  required argument, and every percent face passes the storage the field
  declares (`percentScaleOf` in `@objectstack/spec/data`: a fraction unless the
  field declares a `max` above 1). So the chip reads its field's storage: a stored `1` on a field that declares
  no `max` reads `100%` beside a bar at 100%, a stored `1` on a field declaring
  `max: 100` reads `1%`, and the rows above that read a value by its magnitude no
  longer describe the chip. The rest of this entry is kept as the reading of this change.
- 7d6439c: `DetailView`'s record header no longer sizes its title column to the record
  name below the `sm` breakpoint (objectui#9119).
  
  Below `sm` that header row is a **column** flex container, so the title
  column's width is its **cross** size — and `items-start` sizes a cross axis to
  fit-content. The column therefore took the h1's max-content width whatever the
  viewport was, the h1's `truncate` never fired because its containing block had
  been sized to the text, and the record page overflowed by the difference. The
  threshold was low: roughly 12.5px per character, so on a 375px phone any record
  name past about thirty characters was enough.
  
  None of the three utilities already on that element could have stopped it, which
  is why it survived two neighbouring fixes: `min-w-0` is a **floor, not a
  ceiling**; `flex-1` acts on the **main** axis, which in a column container is
  **height**; and `truncate` cannot fire inside a containing block that was sized
  to its own text. The repair is a definite cross size — `w-full sm:w-auto`, the
  same pair the action tail one level down already carries for the same reason.
  
  Measured in Chromium with a 98-character record title, before and after:
  
  | viewport | title column | h1 rect | ellipsis? | document overflow X |
  | --- | --- | --- | --- | --- |
  | 320px | 1045.59px -> **320px** | 997.59px -> **272px** | no -> **yes** | 726px -> **0px** |
  | 375px | 1045.59px -> **375px** | 997.59px -> **327px** | no -> **yes** | 671px -> **0px** |
  | 639px | 1045.59px -> **639px** | 997.59px -> **591px** | no -> **yes** | 407px -> **0px** |
  | 799px | 799px -> 799px | 747px -> 747px | yes -> yes | 0px -> 0px |
  
  `sm:w-auto` is what keeps that fourth row identical: at and above `sm` the row
  is a row again and the title/action arbitration objectui#7281 fixed is reached
  unchanged. It is the lit control for this change, and it did not move.
  
  What a user actually saw is a **clip, not a page scroll** — the half
  objectui#9119 filed as unmeasured. In the console the header renders inside
  `AppShell`'s content `main`, which `ConsoleLayout` styles `overflow-x-hidden`
  (computed: `overflow-x: hidden`, `overflow-y: auto`); at 375px that pane held
  1046px of header in 375px of width, so 671px of the title was clipped away with
  no scrollbar — and, because the h1's own `truncate` never fired, with no
  ellipsis either. The document itself never scrolled.
- e6040ef: The `summaryFields` chip beside the record H1 takes the percent CONVENTION from
  the same place it already takes the scaling (objectui#9167).
  
  `percentDisplayValue` in `@object-ui/core` states the rule in its own doc
  comment: a third surface that needs percent display takes BOTH halves from there
  — the scaling AND the convention — "or this promise breaks again in the same
  place". objectui#9071 moved this chip onto the scaling and deliberately stopped,
  so the chip went on appending a bare `%` to the full JavaScript number while the
  list cell (`formatPercent` through `PercentCellRenderer`) rounded to the field's
  declared precision — `0` by default — and rendered through the locale's own
  percent affix. One stored value, one field, two readings in two places.
  
  The chip's text is now `formatPercent(stored, precision, locale)` — the list
  cell's own call, with the field's declared precision resolved view-over-object
  and the session locale from `useDisplayLocale()`. Nothing rounds or appends a
  sign locally; that is the shape objectui#9071 deleted.
  
  **This changes what the chip prints, which is the point of the card.** Measured
  by driving both surfaces in the same run, on the same field, from the same
  stored value — every value that moves, moves onto the reading the list cell was
  already giving:
  
  | stored   | locale  | chip before | chip after  | list cell (unchanged) |
  |----------|---------|-------------|-------------|-----------------------|
  | `0.123`  | `en`    | `12.3%`     | `12%`       | `12%`                 |
  | `12.3`   | `en`    | `12.3%`     | `12%`       | `12%`                 |
  | `1.5`    | `en`    | `1.5%`      | `2%`        | `2%`                  |
  | `1.005`  | `en`    | `1.005%`    | `1%`        | `1%`                  |
  | `1234.5` | `en`    | `1234.5%`   | `1,235%`    | `1,235%`              |
  | `0.25`   | `de-DE` | `25%`       | `25 %`      | `25 %`                |
  | `1234.5` | `de-DE` | `1234.5%`   | `1.235 %`   | `1.235 %`             |
  | `0.25`   | `tr-TR` | `25%`       | `%25`       | `%25`                 |
  
  Values already spelled the same in both places do not move: `0.25`, `0`, `1`,
  `250`, `-5` in `en` read exactly as before. A field that declares
  `precision: 2` now reaches the chip as well — a stored `1234.5` reads
  `1,234.50%` in both places.
  
  The chip's BAR is untouched: it keeps drawing the unrounded magnitude, because
  the list cell's bar does too.
  
  ⚠️ **Dated note, 2026-10-02 — the magnitude guess is retired in this same release — objectui#11475.**
  Later in this same release `percentDisplayValue` (`@object-ui/core`) stopped
  inferring a percentage's storage from the value: it takes the storage as a
  required argument, and every percent face passes the storage the field
  declares (`percentScaleOf` in `@objectstack/spec/data`: a fraction unless the
  field declares a `max` above 1). So the chip scales at its field's declared storage, and a stored value in the
  table above reads as written only on a field whose storage matches the
  magnitude the old guess assumed for it. The rest of this entry is kept as the reading of this change.
- 3bc1bb4: Honour `showBorder` on `DetailSection`'s collapsible branch (objectui#9218).
  
  A section authored with both `collapsible: true` and `showBorder: false` kept its
  border and shadow. `DetailSection` ends in three returns and the key was read on
  exactly two of them: the flat branch and the non-collapsible `Card` branch. The
  collapsible branch wrapped a **bare** `<Card>` and never mentioned `showBorder`, so
  the declaration was structurally unreachable there. The collapsible `<Card>` now
  carries the same decision branch 2 already made — `border-none shadow-none` when
  `showBorder === false`.
  
  **Patch, and the level is measured rather than intuited.**
  
  - *Nothing stops rendering.* No node, prop, export or registration moved. The diff
    is one `className` on one existing `<Card>`.
  - *Nothing stops type-checking.* `showBorder` was already declared on all three of
    its surfaces — `DetailViewSection` in `@object-ui/types`, its Zod mirror, and the
    `detail-section` registration's `inputs` — and none of them is touched. This change
    makes the implementation catch up with a declaration that already shipped.
  - *What an author authored today changes visually, and only in the direction they
    asked for.* A node carrying `collapsible: true` + `showBorder: false` already
    passed `sdui-parser`'s `validateTree` clean and then drew a border anyway; it now
    draws none. The only behaviour that regresses is a border that was present because
    the key was being dropped, which is the defect itself — so this is not a breaking
    change and does not need a `**BREAKING**` carrier. A census of this repository
    found zero authored `detail-section` nodes under `examples/`, `apps/` or `content/`,
    so no in-repo page changes appearance.
  
  `className` deliberately stays on the outer `Collapsible` where it already was;
  relocating it is a different behaviour that objectui#9218 did not measure, and a
  drift guard now reds if a later change moves it.
- 697aabc: Format the detail summary chip's currency and date values in the DISPLAY locale
  (objectui#9453).
  
  The `summaryFields` chip beside the record H1 passed the literal `undefined` to
  `Intl` in four places — the currency branch, its unresolved-currency number
  fallback, and both date branches. `useDisplayLocale`'s own doc comment names
  that literal as the one thing a caller must not do: `undefined` means the
  MACHINE's locale, which is neither the tenant's configured regional default nor
  the active UI language. A German tenant therefore read a German date in the list
  and an en-US date beside the H1 of the record it opened, for one stored value,
  and on an unconfigured workspace the chip agreed with whatever locale the
  browser's host happened to have.
  
  All four now read `displayLocale`, the binding this same render already resolved
  for the percent branch (objectui#9167), so every family in the chip's format
  switch is on one channel.
  
  **Only the locale moved.** The chip's own deliberately compact face — its
  rounded currency and number, its medium date style and short time style — is
  unchanged, and the `en` readings are byte-identical before and after. Whether a
  KPI chip beside a title should instead read exactly like its list cell is an
  open question objectui#9453 recorded and did not answer.
- 462bafb: fix(plugin-detail): feed diagnostics name the block that carries the bad value
  
  `record:activity`, `record:chatter` and `record:discussion` share one feed
  pipeline, and its author diagnostics for an unrecognised `filterMode`, an
  unrecognised or non-array `types`, and a `types` kind nothing produces were
  hard-prefixed `[record:activity]` and warned once per offending VALUE. So a bad
  `feed.filterMode` or `feed.types` on a chatter or discussion block was reported
  under another block's name, and the same bad value on two block kinds on one
  page warned once in total: the second block's author was never told.
  
  Each of those warnings is now prefixed with the block it was authored on, and
  warns once per (block, value): the same bad value on two block kinds warns once
  under each name, and the same block with the same value still warns once
  however often it re-renders. The block name is a required argument of the
  shared pipeline, so no caller can inherit another block's name by default.
  Nothing that renders changes.
  
  The `sys_activity` row-type warning is unchanged: it reports a value in the
  data, not a member an author wrote on a block.
- d0f52e4: The related list's `list_toolbar` header now mirrors ADR-0066 D4
  `requiredPermissions` as a UI hide (objectui#9782).
  
  `@objectstack/spec` declares `requiredPermissions` as "enforced with 403 on the
  platform action route (script/flow/modal + MCP) and **mirrored as a UI hide**".
  `RelatedList` drew its header buttons from the set
  `RelatedRecordActionsBridge.deriveActions` hands it, and that bridge filters on
  `locations` alone — so the toolbar evaluated each action's `visible` CEL
  predicate and nothing else. An action declaring a capability the caller does not
  hold rendered anyway, one surface over from `EnvironmentListToolbar`, which
  hides it. This is the third and last carrier of that one declaration, after the
  data-table row menu (objectui#9623) and `DeclaredActionsBar` (objectui#9572).
  
  The shared `useCapabilityGate` is now applied **once** to the toolbar set, in
  the list's own body. Placement is the point rather than an afterthought: the
  hook resolves the held set from the nearest `ActionProvider` above its caller,
  and objectui#9572 measured what a gate on the wrong side of that provider does —
  it reads a different provider, or none at all, and fails open on every action
  forever with a green suite. Unlike `DeclaredActionsBar`, this component mounts
  no provider of its own, so the list body and the buttons it draws read the same
  one, the provider `RecordDetailView` seeds with the `user.systemPermissions` the
  action engine reads. The new suite supplies the held set through that provider
  alone, so moving the filter out of the component fails it.
  
  Nothing is enforced in the renderer and no request changes shape: the server
  remains the sole authority and still answers 403. Unknown capabilities fail
  **open** (an absent `systemPermissions` is not a denial), an empty held set
  means "holds nothing" and gates normally, and because the capability gate is
  ANDed in front of the existing fail-closed `visible` predicate the composition
  is monotone — it can only ever hide more than before, never expose something
  that was hidden.
- 33e1697: Every timestamp on the record page formats in the DISPLAY locale, not the
  machine's (objectui#9786).
  
  `useDisplayLocale`'s own doc comment names the one thing a caller must not do:
  reach past the hook and hand `Intl` the `undefined` it gets on an unconfigured
  workspace, because `undefined` means the MACHINE's locale — neither the
  tenant's configured regional default nor the active UI language. objectui#9453
  put the `summaryFields` chip on that hook. The timeline, history, diff and
  provenance surfaces in the same package were still passing nothing at all, so a
  German tenant read one stored instant one way in a list cell and another way on
  the record page it opened, and on an unconfigured workspace those surfaces
  agreed with whatever locale the host machine happened to have.
  
  Ten call sites across nine files now format with `useDisplayLocale()`:
  `ActivityTimeline`, `RecordComments`, `RecordActivityTimeline` and
  `ThreadedReplies` (each helper's past-a-week date tail), `PointInTimeRestore`
  (its past-a-day date-time tail), `ConcurrentUpdateDialog` (the racer's
  `updated_at`), `DiffView` (a `date` field's diff lines), `HistoryTimeline`
  (both its absolute face and its `Intl.RelativeTimeFormat` relative one) and
  `RecordMetaFooter` (the absolute date behind the hover tooltip).
  
  **Only the locale moved.** Every options bag — `dateStyle`, `timeStyle`, the
  relative-time `numeric: 'auto'` — is unchanged, and each surface's relative
  phrases still come from the same `detail.*` pack keys objectui#7162/#7163 wired
  up. Every helper takes the resolved tag as a parameter rather than becoming a
  hook. Seven of the nine have no choice — they run inside a `.map()` or a
  `useMemo`, where a hook cannot go, which is the same shape and the same reason
  the `t` beside them is threaded. `ConcurrentUpdateDialog` and
  `RecordMetaFooter` call theirs from a component body and could have read the
  hook directly; they thread it too, so the nine keep one shape.
  
  **One published prop changes its default, not its meaning.**
  `HistoryTimelineProps.locale` documented itself as defaulting to the browser's
  locale; it now defaults to `useDisplayLocale()` and is an override when stated.
  No call site in this repo passed it, which is why this site was
  invisible to the card's census: the census matched a call with **no argument**,
  and this one passed a variable that was `undefined` at runtime.
  
  **The count the card carried was 11 across 9 files; the repaired population is
  10 across 9.** Re-derived on the current tip with comments masked, the card's
  instrument returns 9 code sites plus 2 lines of `PointInTimeRestore`'s doc
  comment that spell `toLocaleDateString()` and `toLocaleString()` while
  explaining why that file's tail differs from its siblings'. Prose is not a call
  site. The tenth is the `HistoryTimeline` prop above, which that instrument
  cannot see at all.
  
  **Two instruments land with the repair, because the repair alone is what
  happened the last five times.** `detailTimestamps.displayLocale-9786.test.tsx`
  renders every surface whose face reaches the DOM under a declared `de-DE`
  session and a declared `en` one and requires the two readings to differ — an
  assertion the runner's own locale cannot satisfy, since before this change both
  legs came from the machine and were byte-identical whatever the machine was. It
  also patches the `Intl` constructors and `Date.prototype.toLocale*` and inspects
  the argument each call actually receives, which is the only way to catch a
  variable that resolves to `undefined`, and the only way to reach
  `RecordMetaFooter` — whose absolute face is a `TooltipContent` child that Radix
  keeps out of the DOM until the tooltip opens.
  A census pin reddens when a new bare, `undefined`- or hard-coded-tag call site
  is written; it masks comments before it counts, and when it landed it declared
  `InlineFieldInput`'s `en-CA` as an exemption with its reason — that call fed
  `<input type="date">`, whose value HTML defines as `YYYY-MM-DD`, so it was an ISO
  formatter and not a display locale. It landed scoped to this package and, under
  the ruling on this card, became the one repository-wide census in
  `@object-ui/i18n` (`machineLocaleCensus-9909.test.ts`, objectui#9909), which
  carried that exemption forward. objectui#10625 later removed the call:
  `InlineFieldInput`'s date editor now renders `@object-ui/fields`' `DateField`,
  and the exemption went with it.
  
  ⛔ Not repaired here: the same class outside this package. A mechanical scan of
  the whole repository's non-test sources — comments masked, the same matcher the
  census pin uses — returns sites across many other packages, and ⛔ none of them
  was read for intent, which the one that was shows to matter: `collaboration`'s
  single hit is a deliberate `catch` fallback for a tag `Intl` itself rejected,
  not this defect. The number is deliberately not written down here; re-derive it,
  and read each hit before pricing a sweep. This card's fence was
  `packages/plugin-detail`, and whether a repo-wide gate should exist was left
  undecided by the card that opened it.
- a017617: **`buildDefaultPageSchema`'s `showReferenceRail` docblock named a route ADR-0085 removed** (objectui#9816).
  
  The docblock told authors to switch the Reference Rail on "per object via `detail.showReferenceRail`". Nothing performs that read: this package's own CHANGELOG records the objectDef `detail.*` block — `showReferenceRail`, `hideReferenceRail` and `hideRelatedTab` among them — as no longer consulted. An author who followed the sentence declared a key that does nothing, with no warning, no degradation and no rail.
  
  The parenthetical now names the live route only — the option on the synth call — and says what a per-page rail is instead: an authored `record:reference_rail` node in an assigned Page schema. The rest of the docblock is untouched and still true: the rail is OFF by default, it fans out a collection query per related list, and it emits only when `related` has at least 2 entries.
  
  **No executable code changed.** The correction is published all the same: declaration emit carries the docblock onto `BuildPageOptions.showReferenceRail`, so this is the text an editor tooltip shows for the option.
  
  It is the third correction of the same claim — two README statements about this flag went with objectui#7998 — so it arrives with a pin rather than on its own. `packages/plugin-detail/src/__tests__/referenceRailRoute-9816.test.ts` reddens if a `detail.`-scoped rail key reappears anywhere in this package (comments included — a comment is the carrier that bit all three times), and separately if `options.showReferenceRail` stops being a read in code rather than a sentence about one.
- 741864f: fix(fields,plugin-detail,plugin-grid): every percent face reads its width through the spec's `resolveFieldScale`, so an undeclared percent renders the same everywhere
  
  A `percent` field that declares no `scale` used to render two widths for one
  stored value: the list cell, the record header's summary chip and the grid
  column-summary footer each spelled their own `?? 0`, while the `PercentField`
  edit widget kept its own `2` — so a stored `0.25` read `25%` in the list and
  `25.00%` in the widget.
  
  All four faces now ask `resolveFieldScale` from `@objectstack/spec/data`, the
  protocol's single answer for what an absent `scale` means per field type. An
  undeclared percent therefore reads the same width on every face, and a declared
  `scale` reads as declared everywhere, as before.
  
  What moves for users:
  
  - **`PercentField`** — an undeclared percent's readonly face shows the
    protocol's width (`25%`, not `25.00%`), and the input and slider step by that
    width too, as a declared `scale: 0` always has: whole percents. A stored
    fractional value still shows in full and saves untouched; typing an off-step
    value and pressing Enter while the box has focus is refused by the browser's
    own step validation, as it already was for a declared width.
  - **Grid column-summary footer, `number` columns** — a declared `scale` is now a
    fixed width (`Sum: 1.50`). With none declared the column has no fixed width,
    and a computed result is rounded to the widest decimal count among the values
    it was computed from, instead of this footer's own two (`avg`) or three
    decimals: an average of `1`, `2`, `2` reads `Avg: 2`, and a `min` over
    `1.2345` reads `1.2345`. Columns with no `type` are unchanged.
  - A malformed `scale` (a string from stored JSON) is treated as no declaration
    on every face.
  
  `@object-ui/fields`, `@object-ui/plugin-detail` and `@object-ui/plugin-grid`
  raise their `@objectstack/spec` floor to `^17.5.0`, the first release that
  exports `resolveFieldScale`.
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
- af4fb29: `record:path` and `record:quick_actions` no longer read the contract-refused
  `aria.label` spelling as an accessible name. A document that still carries it
  is reported instead (objectui#9945).
  
  ## What changes for a stored document
  
  `@objectstack/spec`'s shared ARIA shape refuses `aria.label` on parse. It is the
  alias entry that points at `aria.ariaLabel`, so nothing newly authored can carry
  it. Two blocks read it anyway, as back-compat for documents written before the
  contract closed: `record:path`, which read it and nothing else before
  objectui#9556, and `record:quick_actions`, where objectui#4663 put it behind
  `aria.ariaLabel`. The maintainer ruled that fold retired (ruling `5749677059`,
  letter A), under the standing rule that a deprecated alias retires at once
  unless a named external user needs a staged window.
  
  So on those two blocks:
  
  - `aria: { label: 'Deal stages' }` is **not read**. `record:path`'s rails
    announce their localized default name (the `detail.pathLabel` pack entry,
    "Record path" in English), and `record:quick_actions`' toolbar announces its
    built-in "Quick actions".
  - A served `aria.label` gets **one `console.warn`** when the block mounts. It
    names the block and the canonical spelling `aria.ariaLabel`. It fires from an
    effect, so re-renders do not repeat it. This is the channel the package
    already uses when the spec refuses a declaration and the block ignores it
    (the row-cap refusal).
  - `aria.ariaLabel` is unchanged. It still names the block, including when a
    document carries both spellings (the warning still fires for the refused one).
  
  **Migration:** rename `aria.label` to `aria.ariaLabel` on those two blocks.
  
  ## What does not change
  
  - The other `record:*` blocks that read the `aria` bag never read `aria.label`
    in a release, and still do not. They do not report it either.
  - No published symbol is added or removed. In `@object-ui/types`, only the
    docblock on `RecordComponentAriaProps` that described the fold is rewritten.
  
  ## A pending entry in this release says otherwise
  
  The objectui#9556 entry says the alias "gains no reader and loses none" and
  leaves this retirement open. That describes that change, not the release: this
  one retires the alias on the two blocks. That entry now carries a dated note
  saying so.
- 9a97800: `record:related_list` `add.picker.filter` is declared as the contract's rule array on
  the authoring face, not as `unknown` (objectui#9964).
  
  `RecordRelatedListComponentProps.add.picker.filter` mirrored
  `@objectstack/spec`'s `RecordRelatedListProps.add.picker.filter` — declared there as
  `z.array(ViewFilterRuleSchema).optional()`, "Restrict which records the picker
  offers" — as `unknown`. The only consumer of that key has typed it `ViewFilterRule[]`
  on purpose since objectui#3831: `RelatedList` hands the value to
  `RecordPickerDialog`'s `baseFilter` verbatim, and its own comment states why the
  tighter type is deliberate ("a looser type here is where a wrong shape would hide").
  
  So one key carried two declarations, with the looser one on the face an author — or
  an AI writing metadata — reads: `unknown` offers no shape guidance for a key whose
  consumer demands a specific shape. Nothing could report the divergence either,
  because `record-related-list.tsx` reached the block through four `(schema as any).add`
  reads; a cast unwraps the declaration at its own read site, so no compiler ever
  compared the two.
  
  **The mirror moved, and the consumer's guard stayed.** `@objectstack/spec` declares
  the array form, so the component agrees with the protocol and the mirror was the side
  that disagreed — the contract-first direction this repo's #0.1 requires. Tightening
  here narrows nothing an author could publish: the protocol's `strictObject` refuses
  every other shape at parse today, so this is a narrowing being undone rather than an
  authoring surface being narrowed. A TypeScript consumer that annotated a variable with
  this interface and assigned a non-array filter to it now fails to compile — the
  publish call it was heading for would have failed anyway.
  
  All four `(schema as any).add` reads are gone with it, so the declaration reaches the
  renderer: a wrong-shaped picker filter is now refused where it is written rather than
  carried to the dialog. The change is inert at runtime — `unknown` and
  `ViewFilterRule[]` are the same zero bytes — which is why the pin for it compiles
  snippets and reads diagnostics instead of rendering anything, and why the guard that
  kept the old cast ledgered is what went red when the cast was removed.
- 6358a2d: `record:activity`'s landmark is named after the heading it shows, not
  "Discussion" (objectui#9998).
  
  `RecordActivityTimeline` named its `<section>` landmark with a fixed
  `aria-label` (`detail.discussion`), while the visible heading inside it read
  `titleLabel ?? t('detail.activity')` followed by an `(N)` count. A
  `record:activity` block passes no `titleLabel`, so the region's accessible name
  was "Discussion" under a heading reading "Activity (N)". That breaks
  the repo's own rule from objectui#4118: a speech-input user says what they see,
  so the landmark's spoken name must be the heading. `record:chatter` passes
  `titleLabel={t('detail.discussion')}`, so it happened to agree.
  
  The section's `aria-label` now uses the same value as the heading's title. The
  component reads that value once and uses it for both, so the name and the
  visible words cannot drift apart:
  
  - `record:activity`'s landmark is named "Activity", in the session locale;
  - `record:chatter`'s landmark is still named "Discussion";
  - an authored `titleLabel` now names both the heading and the landmark.
  
  The `(N)` count stays in the visible heading and stays out of the landmark's
  name. It is live status that changes with the filter, not part of the panel's
  name.
  
  The timeline's section has contained this heading since the section was
  introduced. The objectui#4645 entry, which said it had no visible label, is
  corrected to match.
  
  No prop, export or locale key changed.
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
- 6c1b105: `record:activity` now says out loud when an unrecognised `filterMode` is folded onto `all`.
  
  `normalizeFilterMode` folds every value it does not recognise onto `'all'` — the widest of the four declared modes — so a near-miss like `comments-only` opened the panel on the unfiltered stream instead of the slice the author asked for, and said nothing. The fallback is kept (a dropdown handed a value with no matching item renders blank), but the fold now emits one deduped diagnostic naming the offending value and the declared modes. Nothing that renders changes.
- 2a79e84: fix(plugin-detail): the `percent` summary chip beside the record H1 stated one percentage in its text and drew another in its bar — a stored `0.123` read `0.123%` next to a bar filled to 12.3%. Both halves now scale the stored value by the same rule (the bar's existing one), so the chip states the percentage it draws. Values already in percentage points, such as `12.3` or `250`, render exactly as before.
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
- 17fbbaf: `record:activity` renders an author-extended `sys_activity.type` instead of dropping it
  
  **Behaviour change.** `activityRowToFeedItem` used to return `null` for any
  `sys_activity.type` outside `ACTIVITY_TYPE_TO_FEED_TYPE`: the row was stored,
  queryable and invisible, with only a console warning to say so. It now renders
  through a defined fallback presentation (`UNMAPPED_ACTIVITY_FEED_TYPE`, the
  generic `system` feed type), still announced once per distinct type.
  
  This follows the maintainer ruling of 2026-08-24 (objectstack `88b9d749a`),
  direction 4: `sys_activity.type` is **author-extensible**. Every field on
  `sys_activity` is `readonly: true` and objectql's `validateRecord` skips
  readonly fields on both write branches, and ADR-0052 §5b.2 forwards an author's
  `activityMilestones[].type` into the column verbatim — so a value the platform
  never declared is legitimate stored data, not a mistake, and dropping it
  reproduces the objectui#5840 failure for every author who writes one.
  
  The types this map deliberately excludes (`commented` / `mentioned` / `login` /
  `logout` → `undefined`) are unchanged: those are decisions, not gaps, and they
  still return `null` silently. `ACTIVITY_TYPE_TO_FEED_TYPE` itself is unchanged,
  so the copy `RecordDetailView` reads is unaffected.
  
  The pin that goes with it replaces the set-equality check objectui#5840 removed,
  and is deliberately two-directional: the map must cover every **built-in** type
  (superset — a new built-in turns it red), and an unknown type must reach the
  feed through the fallback (never dropped, never crashing). Set equality is not
  asserted in either spelling, and the docblock says so, because pinning to the
  closed declaration is what made #5840 drop stored rows.
- d8cf1cb: `record:activity` no longer discards scheduled activities. `sys_activity` rows with
  `type: "scheduled"` now map to the `event` feed kind instead of being dropped before any
  filter runs, so a not-yet-held meeting reaches the timeline and `types: ['event']` stops
  being a permanently empty tab. Held meetings are unchanged: `completed` still maps to
  `task` and still hides unless `showCompleted` is set, which is what keeps an upcoming
  meeting visible by default while a finished one is not.
  
  The unknown-type default is unchanged and deliberately so — a row whose type nothing maps
  is still dropped rather than bucketed into `system`, because rendering an unmeasured kind
  as something it is not would be new wrong data rather than recovered data. What changes is
  that the drop is no longer silent: an unmapped type now logs one `console.warn` naming it,
  once per type. Types the map knows and deliberately excludes (`commented`, `mentioned`,
  `login`, `logout`) stay silent, since those are decisions rather than gaps.
- 0d1e702: `record:activity` no longer widens when its `types` filter cannot be honoured. An
  unrecognised or empty kind list used to sanitise to `undefined`, which the filter
  pipeline reads as "no filter authored" — so three distinct authored intents collapsed
  into one rendering, and the widest one: a page that named the wrong kind was served
  every activity on the record, with no diagnostic anywhere at runtime. The principle now
  held is that a sanitiser may narrow an author's request or refuse it, but must never
  silently widen it; widening turns a typo into "show the user everything", which is the
  one outcome no author asked for, and it hides behind a plausible result — a populated
  timeline reads as working, an empty one gets investigated.
  
  **Behaviour change.** A page authoring `types: []`, or a `types` list whose every entry
  is unrecognised, now renders an EMPTY timeline where it previously rendered every kind.
  That is the fix rather than a regression, but a page relying on the old fallback will
  visibly change: `types: []` is honoured as "no kinds", and a list that keeps nothing
  filters to nothing. A mixed list keeps its recognised entries and drops the rest. Omitting
  `types` is unchanged and remains the only way to say "no filter". A `types` that is not a
  list at all (`types: 'comment'` — brackets dropped) is likewise refused rather than
  ignored, since a filter that cannot be read is not a request to remove the filter.
  
  Unrecognised entries are now named out loud: one `console.warn` listing them and the
  declared feed item types, deduped so one bad kind warns once however many times the feed
  re-renders, matching the unknown-activity-type diagnostic already in this file. A
  well-formed filter stays silent, `types: []` included — there is nothing to report about
  a request that was carried out exactly.
- b03ba3a: `record:activity` now says out loud when a `types` entry names a feed kind nothing produces.
  
  `FeedItemType` publishes thirteen kinds and ObjectUI produces five of them
  (`comment`, `field_change`, `task`, `event`, `system`). Authoring
  `types: ['approval']` parsed, typechecked, built, and rendered a permanently
  empty timeline with no diagnostic anywhere — a declared surface enforced by
  nothing, which reads to an author, or to an AI writing the metadata, as a
  working feature that simply has no data yet. The entry is still honoured exactly
  as authored and nothing that renders changes; what changes is that the emptiness
  is now diagnosable, on its own deduped channel beside the unrecognised-entry and
  unrecognised-`filterMode` warnings already in this block.
  
  The message keeps two populations apart, because reporting a decision as a
  defect is how a warning channel gets trained out of an author's attention:
  `record_create` / `record_delete` / `sharing` are named as **deliberately not
  adopted** — those rows map to `field_change` on purpose, since the record page
  and this block must agree what a `created` row is before either can move to the
  richer kind — while the remaining kinds are reported as having no producer, and
  the message stops there rather than calling that a gap. Whether somebody ruled
  against a kind and left no note is not recorded anywhere the renderer can read,
  and the wording says so instead of guessing.
  
  The producer census the diagnostic reads is derived from the producers
  themselves — the `sys_activity` map's range plus its unmapped fallback — so
  giving a kind a producer retires its warning in the same edit. The one producer
  that cannot be derived (`comment`, built from `sys_comment` rows by the console's
  record page, a package this one cannot import) is declared, and a new test
  re-runs the census over the whole repository so the declaration cannot go stale
  silently. The warning also names what it cannot see: a host that supplies the
  feed itself can produce kinds no census taken here bounds.
- 0068348: `record:alert`'s renderer-local `RecordAlertProps` CTA slot (`action.label`) is
  widened to `string | I18nLabel` in both copies (`properties.*` and the flat
  compat mirror) in `packages/plugin-detail/src/renderers/record-alert.tsx`.
  
  The renderer already resolves `action.label` through the same inline-locale-map
  `pickLocalized` call as `title` / `body` (`const ctaLabel =
  pickLocalized(props.action?.label, language)`), so a bare `string` declaration
  was narrower than the renderer's own runtime behavior — the same
  declaration-narrower-than-the-renderer contradiction objectui#4970 fixed for
  `title` / `body` one level up in the same interface (objectui#4998).
  
  Type-only: the block's published authoring surface still declares `action` as
  a bare `object` with the member shape in prose only
  (`plugin-detail/src/index.tsx`), so there is no manifest arm to align yet —
  that half stays parked on the `ComponentInput` member-shape question (PR
  #3795) and is out of scope here.
- 641543f: `record:alert`'s `visible` predicate no longer logs a spurious `record is not
  defined` evaluation-failure warning during the record-detail loading frame.
  
  The predicate is evaluated on every render (Rules of Hooks), including the
  frame before `useRecordContext().data` has loaded. In that frame `record` is
  unset, `usePredicateRecordContext` binds an empty context bag by design (no
  `record` key at all), and a bare/`${…}` predicate referencing `record.*`
  faulted with `record is not defined` — logged via `console.warn` on every
  page load, even the correct, working ones, because the SAME predicate
  resolved fine one frame later once `record` populated. The banner's own
  visibility was never wrong (it already hides unconditionally while unloaded);
  only the diagnostic was permanently misleading on the happy path.
  
  The predicate is now skipped while `record` hasn't loaded — the same
  condition the banner's own "hide while unloaded" early return already used —
  since its verdict in that frame was never consulted anyway. A predicate that
  is genuinely broken (bad field, bad syntax) still faults, and still logs, on
  every frame once `record` is populated (objectui#5776).
- 8033ad1: The built-in record-detail tab labels and the last two English landmark names now speak the session locale (objectui#4645).
  
  `buildDefaultPageSchema` synthesizes the record-detail tab strip with plain
  English tokens on the nodes (`Details`, `Related`, `Attachments`, `Activity`,
  `History`, `Approvals`), and three of its own comments said those tokens
  "localize through the tab strip's `KNOWN_LABEL_DICT`". That dict shipped
  exactly two arms — `zh-CN` and `zh-TW` — so the claim held for Chinese and
  silently failed for the eight other shipped packs: a ja-JP or es-ES record
  detail rendered `Details / Related / Attachments` inside otherwise fully
  localized chrome, measured in a real browser on `@objectstack/console` 17.0.0
  GA and re-measured red on current `main`.
  
  Every one of those strings was already in all ten packs (`detail.details`,
  `detail.related`, `detail.activity`, `detail.history`, `detail.attachments`,
  `detail.approvalsPanelTitle`); the strip simply never asked. It asks now,
  BEHIND the exact-locale dict, which stays first because `zh-TW` has no pack of
  its own — i18next resolves it to the Simplified `zh` resource, so the dict is
  the only source of the Traditional forms — and because it carries tokens
  (`Notes`, `Files`, `Tasks`, `Events`, object names) that no pack does. `en` and
  `zh` render byte-identically to before; the other eight locales change from the
  English token to their pack value. `page:accordion` reads the same lookup, so
  the two renderers cannot answer differently for one token.
  
  Alongside it, the two `aria-label`s that were English in *every* locale —
  `HeaderHighlight`'s `Record highlights` and `RecordActivityTimeline`'s
  `Discussion` — no longer read English. `HeaderHighlight`'s now routes through
  the bundle. Its section carries no visible label, so the `aria-label` is the
  landmark as far as assistive tech is concerned (the argument objectui#4024 made
  for the dialog `Close` label, and objectui#5956 made for `record:path`'s own
  container name). `RecordActivityTimeline`'s section always had a visible
  heading, so it no longer has a fixed `Discussion` name. Its landmark is named by
  that heading's title: `detail.activity`, or an authored `titleLabel` such as
  `record:chatter`'s `detail.discussion` (objectui#9998). `detail.activity`
  already existed in all ten packs; `detail.highlightsLabel` is the single new
  key, added to all ten and mirrored byte-identically into
  `DETAIL_DEFAULT_TRANSLATIONS`.
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
  - @object-ui/permissions@17.7.0

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
- 8b9dc62: `element:text.content` and `element:button.label` declare the inline translation
  map they already accept
  
  Two more instances of the contradiction objectui#3832 fixed the mechanism for,
  measured after that ruling had fixed its scope at five specimens and filed
  separately as objectui#4970. Both inputs' own `description` tells the author to
  write an inline translation map (`{ en, "zh-CN", … }`), both renderers resolve one
  through `pickLocalized`, and both spec props schemas accept one — while the
  declaration said `type: 'string'`, so the manifest gate reported
  `type-mismatch` on the exact shape the block had recommended. Both blocks are in
  `PUBLIC_BLOCKS`, so this reached authors through `sdui.manifest.json` and
  `sdui-intrinsics.d.ts` as well as the save gate.
  
  Each declaration is now `type: ['string', 'object']`, the union form
  objectui#3832 introduced, and the arms are the ones the contract accepts —
  re-measured on the `@objectstack/spec` 17.0.0 GA pin rather than carried over
  from the issue, which was written at the 17.0.0-rc.6 pin:
  `ComponentPropsMap['element:text'].content` and
  `ComponentPropsMap['element:button'].label` are both
  `string | Record< string, string >`, and both refuse a number, a boolean and an
  array. Those three refusals are the controls in the acceptance test, which is
  what keeps a widening distinguishable from a silenced check.
  
  Nothing else about the two blocks moves. A plain-string `content` / `label`
  validates exactly as before, values matching neither arm are still reported, and
  no other manifest entry changes shape — the public manifest now carries seven
  array-valued input types, the five from objectui#3832 plus these two, with the
  remaining 57 public blocks serializing byte for byte as they did.
  
  `record:alert`'s renderer-local prop type is corrected in the same pass
  (`plugin-detail`): its `title` / `body` were still typed `string` while the same
  file resolves both through `pickLocalized` and the block's published `inputs`
  have declared `['string', 'object']` since objectui#3832, so the two slots were
  narrower than both the renderer and the block's own published surface. The type
  is not exported, so no consumer was misled and no published surface changes. The
  CTA's `action.label` one level down is left alone on purpose (objectui#4998):
  `action` is published as a bare `object` whose member shape lives in prose, so
  there are no declared arms for it to be aligned against yet.
- 98eab36: Publish the five `@objectstack/spec` 17.0.0 keys the renderers already honoured, so
  authors can discover them
  
  `page:header.maxVisible`, `page:header.mobileMaxVisible`, `page:tabs.alwaysShowStrip`,
  `record:details.inlineEdit` and `record:details.showHeader` are declared by the spec and
  read by the renderers today, and none of them was in its block's published `inputs`. That
  is the direction nothing reports: `gen-manifest.ts` left all five out of
  `sdui.manifest.json` and `sdui-intrinsics.d.ts`, so they were in no designer panel and no
  generated type; `sdui-parser`'s prop walk reported `unknown-prop` on an author who wrote
  one anyway; and the renderer honoured it regardless. Measured on the console's own
  manifest before this change, all five drew
  
  ```
  unknown-prop: page:header has no prop "maxVisible"
  unknown-prop: page:header has no prop "mobileMaxVisible"
  unknown-prop: page:tabs has no prop "alwaysShowStrip"
  unknown-prop: record:details has no prop "inlineEdit"
  unknown-prop: record:details has no prop "showHeader"
  ```
  
  and now draw nothing. Same defect as `record:details.hideFields` in objectui#3808 and
  `readonly` in objectui#3407; it could not land until the GA pin moved (objectui#4636),
  because the pre-GA pin declared none of the five and publishing them would have failed the
  repo-wide parity gate's forward direction.
  
  Each entry carries a description, because for these keys the discoverability IS the fix.
  Two are worth reading before use:
  
  - `maxVisible` / `mobileMaxVisible` are positive integers — the contract rejects `0` and
    fractional values — and they do not govern every action: an action declaring
    `record_more` without `record_header`, and any action with `component: 'action:menu'`,
    is routed to the overflow menu regardless of the budget.
  - `inlineEdit` is an opt-OUT only. The value is combined with the object's own resolved
    editability (ADR-0103) and with the server's effective API operation set, so `false`
    always wins while `true` cannot open editing the platform refuses.
  
  **`page:tabs` also gains a read.** `alwaysShowStrip` was honoured only as
  `schema.properties.alwaysShowStrip`, while `inputs` publishes TOP-LEVEL keys — the shape
  the manifest whitelists, the generated types declare and the JSX-page compiler validates.
  Measured on a one-tab schema: the wrapped form showed the strip, the flat form did not, so
  publishing the key alone would have advertised a write the renderer throws away. The
  canonical top-level arm is read first now, with the `properties` arm kept for paths that
  reach the renderer without `SchemaRenderer`'s hoist — the same dual read `maxVisible` has
  always had. This can only ever ADD a strip to a one-tab page; multi-tab pages are
  unaffected, and `false` and non-boolean values both read as "not set".
  
  The five GA-pending entries that held this card's place in
  `registry-inputs-spec-parity.test.ts` are deleted, which is what the gate's own
  `carries no stale unpublished-key exemption` check demands once the keys are published.

### Patch Changes

- 7c297e3: Retire `permission_change`, `export`, and `restore` from the audit-log action filter (`AuditLogPage`'s `ACTION_OPTIONS`) and badge maps (`AuditLogPage` and `HistoryTimeline`'s `ACTION_VARIANT`). These three values never had a writer anywhere on the platform, so the filter always returned zero rows for them and the badges never rendered — a visible product defect (audit surface should be narrow-but-honest, not broad-but-lying). `import`, `login`, and `config_change` are kept: `import` has a real writer (`plugin-auth`'s `admin-import-users.ts`) and is still declared by the server enum and filtered by the `config_changes` list view; `login`/`config_change` gained real writers in objectstack#8144/#8145.
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
- 5607092: objectui#4029 — the repo root now lints `no-console` (`error`, allowing
  `warn`/`error`) so a stray module- or function-scope `console.log`/`info`/
  `debug` fails CI instead of shipping silently (as `console.log('Registering
  object-map...')` did in #7139, caught only by hand). Landing the rule meant
  individually judging every real hit outside the tooling exemptions
  (`scripts/**`, `**/examples/**`, test files, `packages/cli/src/**`,
  `packages/create-plugin/src/**`) — this changeset covers the published
  packages whose call sites changed:
  
  - `@object-ui/app-shell`: `ObjectDataPage`'s dropped-URL-filter message is a
    real diagnostic (data silently discarded), so it moves from `console.debug`
    to `console.warn` to match the house convention.
  - `@object-ui/plugin-detail`: `DetailView`'s Web Share API failure now reports
    via `console.error` (it is a real failure, not debug noise); a redundant
    "Link copied to clipboard" success log is removed.
  - `@object-ui/fields`: `MasterDetailField`'s `handleView` stub no longer logs
    the item it does nothing with.
  - `@object-ui/runner`: `App`'s loader-selection debug prints, `LayoutRenderer`'s
    unused click-handler stub log, and `MockDataSource`'s per-call narration
    (`find`/`create`/`getObjectSchema`) are removed — none diagnosed a problem,
    they only echoed the happy path.
  - `object-ui` (VS Code extension): the "extension is now active!" activation
    log is removed.
  
  No behavior changes beyond console output. `@object-ui/core` and
  `@object-ui/data-objectstack` also touch `no-console`-adjacent lines
  (`debugLog`/`debugTime`/`debugTimeEnd`, `createQuietHttpLogger`) but only to
  add `eslint-disable-next-line` documentation — those ARE the repo's
  deliberate debug/logger infrastructure, not leaked residue, so their own
  changeset carries empty frontmatter.
- 598c89a: The retired `owner` field-type spelling stops being blessed by the published contract, and inline edit refuses it the way the record form already does.
  
  objectui#4814 retired `owner` as a field type (ruling A′): it was a synonym for
  `user` with zero behavioral delta — both resolved to the same person-picker
  widget — and it was never a member of `@objectstack/spec`'s closed `FieldType`,
  so no object schema could ever declare it. `@object-ui/fields` now answers the
  spelling with a visible tombstone refusal plus a console prescription. That PR
  shrank the three public DOC unions; their CODE twins were left behind, so this
  package spent the interval telling an author "legal" for a word the renderer
  refuses.
  
  **`@object-ui/types` — the three published twins shrink (objectui#4914 items 1-3).**
  `ReportFieldSchema.type` (`zod/reports.zod.ts`) is a RUNTIME validator, so the
  contradiction was executable, not merely advisory: a report document authored
  with `type: 'owner'` validated green and then rendered a refusal. It now fails
  validation, with the issue on the `type` path. Its TS twin `ReportField['type']`
  and `UserFieldMetadata['type']` drop the member in the same batch, so published
  `.d.ts` autocomplete stops offering it. This is an accept-set SHRINK on a
  published validator and a narrowing of two published unions — patch-level
  because the spelling it removes has had no working renderer since #4814, but
  callers still passing `type: 'owner'` will now see a type error and a failed
  parse. The record-owner idiom survives verbatim as
  `{ type: 'user', name: 'owner' }`: the field NAME carries the ownership meaning,
  the type carries the widget.
  
  **`@object-ui/plugin-detail` — inline edit joins the tombstone (objectui#4914 item 5).**
  `InlineFieldInput` routes by a STORED field's actual type, so a record whose
  field is still typed `owner` was getting a working person picker inline while
  the record form showed the refusal — two edit surfaces disagreeing about one
  field, which is worse than either uniform outcome. A retired spelling now
  renders the same `RetiredFieldTombstone` the form does, reported once per
  spelling rather than once per row. The table is read live from
  `@object-ui/fields`, so a future retirement is covered the day it lands.
  
  Measured while implementing, and the reason the refusal is the load-bearing
  half: simply deleting `owner` from the inline routing table would have changed
  nothing an author could see. `hasFieldEditWidget('owner')` is still true — the
  fields package maps `owner: UserField` in `EDIT_WIDGETS` — so the type would
  have reached the same picker down the delegation road instead of the routing
  road. That residual face is outside this change's scope and is filed separately.
- 7dd93c0: `record:quick_actions` reads the toolbar's accessible name under the spelling the ARIA contract accepts, and stops advertising an action fallback it never had.
  
  Two producer-side defects in the same component (objectui#4663), found while
  objectstack#8744 measured this renderer's read points.
  
  **The `aria` read point was dead in both directions.** The toolbar read
  `schema.aria?.label` and nothing else — the ONE spelling `@objectstack/spec`'s
  `AriaPropsSchema` refuses. On that closed shape `label` is an ALIAS ENTRY: a
  rename prescription pointing at `ariaLabel`, there to produce a better rejection
  message, never accepted (measured: `safeParse({ label })` returns
  `unrecognized_keys` naming `label`, while `safeParse({ ariaLabel })` passes). So
  a spec-valid `aria: { ariaLabel: 'Account actions' }` reached the renderer and
  was read by nothing — the built-in "Quick actions" default won every time — and
  the spelling that did work was one no author can write without the contract
  rejecting the document. `SchemaRenderer`'s generic ARIA channel was no escape
  hatch either: it reads the FLAT `schema.ariaLabel` and injects `aria-label` as a
  component prop, which this renderer drops along with every other non-designer
  prop.
  
  The read is now `(aria.ariaLabel ?? aria.label) || 'Quick actions'`. The legacy
  leg is back-compat only, for documents stored before the contract closed;
  canonical wins when both are present. Both halves follow how the repo already
  handles this key: `normalizeListViewSchema`'s aria fold copies the legacy key
  across only when the canonical one is `undefined` (so a declared `ariaLabel: ''`
  shadows a stale `label`), and `ListView`'s own read point treats an empty string
  as no accessible name at all — which here resolves to the built-in default,
  since `role="toolbar"` needs a name.
  
  **The `actionNames` description promised a fallback that exists on no path.** It
  read "(else every action declared for the object at this location)". Measured:
  with no `actionNames` and no host-supplied `actions`, `namesToResolve` is empty,
  `needsLookup` is false, the object metadata is never queried, and the bar renders
  its dashed placeholder. The registry `inputs` are published — they are serialized
  into `sdui.manifest.json` and the JSX authoring types, and Studio teaches authors
  from them — so the promise reached tooling; objectstack#8744's dispatch prompt
  quoted it verbatim as a declared input. Per the triage ruling the sentence is
  what changes: implementing the fallback would be a behaviour expansion and needs
  its own card. No runtime behaviour changes with it, and a regression test now
  drives a LOADED metadata provider to prove the object's declared actions really
  are not pulled in (with a control proving the same wiring delivers them the
  moment a name asks).
- 229b17e: 修复相关列表(`RelatedList`)以 spec 规范拼写 `field` 声明的对象列只出表头、单元格全空的问题(objectui#5022)。
  
  `RelatedList` 的所有身份读点都经由 `columnIdentity` 规范优先解析,因此
  `{ field: 'status', label: 'Status' }` 能通过 FLS 过滤、外键过滤、空列裁剪与排序判定;而它喂给的
  `data-table` 只按 `col.accessorKey || col.name` 归一化访问键,从不读 `field`,于是每个单元格取的是
  `row[undefined]`,渲染成空值占位符 —— 与 objectui#3951 同形,只差一种拼写。
  
  现在 `normalizeColumn` 在把对象列交给表格前,把解析出的身份写回 `accessorKey`:
  词表解析留在 `RelatedList` 一侧,不并入表格适配器(`column-identity.ts` 有意画下的
  `TABLE_ADAPTER_COLUMN_KEY` 边界)。作者已显式声明的 `accessorKey` 不被覆盖,原有拼写一并保留,
  无法解析出身份的条目原样返回。legacy `name` 拼写、字符串列与显式 `accessorKey` 列行为不变。
  
  同一处身份现在同时供给单元格取数与表头排序 —— 此前 `field` 列的表头排序派发的是
  `undefined` 字段(被 `RelatedList` 丢弃),该列在取数与排序两个方向上同时失效。
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

## 17.5.0

### Patch Changes

- ceccdcf: Action confirm dialogs and success toasts now honour the bundle's translated
  `confirmText` / `successMessage`, not just `label` (objectui#4265).

  A TranslationBundle entry for an action carries three keys under one
  `_actions.<name>` node — `label`, `confirmText`, `successMessage` — and
  `useObjectLabel()` has always exposed a resolver for each. What had drifted was
  the call sites: `page:header` (authored record pages), `record:quick_actions`
  and the related-list row menu resolved the button `label` only and dispatched
  the authored `confirmText` / `successMessage` untouched. One bundle entry met
  two fates: the button rendered the translation, the confirm dialog rendered the
  authored English.

  All action-rendering surfaces now go through one resolver,
  `useActionTextLocalizer()` (new, exported from `@object-ui/react`), which
  applies the existing `actionLabel` / `actionConfirm` / `actionSuccess`
  resolvers over the three keys together. Fallback is unchanged: with no bundle
  entry — or an entry lacking a key — the authored text renders. A bundle cannot
  introduce a `confirmText` or `successMessage` the metadata never declared.

- 6d01319: Inline edit no longer offers a record picker for a spec-spelled `autonumber` field that carries a `reference_to`

  `TEXTUAL_REF_FALLBACK_TYPES` — the detail page's one definition of "machine-computed" — spelled the auto-number type `auto_number` only. `@objectstack/spec`, the designer and the metadata importer all spell it `autonumber`, and the set is matched by RAW spelling, so it carried half the type.

  The reader that had no gate in front of it is `InlineFieldInput`'s reference fallback, `!!field.reference_to && !TEXTUAL_REF_FALLBACK_TYPES.has(type)`, on exported public API. A field typed `autonumber` keeps a `reference_to` for relational metadata — which is the entire reason this set exists — so it took the lookup branch and rendered the RECORD PICKER: a searchable list of records offered as replacements for a machine-generated identity. The `auto_number` spelling of the identical field rendered the textual fallback, as intended. Both spellings are now members, matching how `plugin-form` carries both in each of its non-input sets.

  The editability half of the same report (objectui#4219) was already closed from another direction by #4228, whose shared exclusion resolves aliases before matching — a field typed `autonumber` offers no inline affordance in either host. The two gates are a union, so this fix also removes the union's dependence on which spelling the metadata happens to use: previously `autonumber` was held by the exclusion gate alone and `auto_number` by both, and losing either gate would have re-opened a different half of the defect depending on how the field was authored.

  Pins land with it: the reference fallback for `autonumber` (red before this change — the picker really did render), `auto_number` and a real `lookup` as controls in both directions, and set membership asserted directly so the union statement is checked rather than described.

- 63fe8fd: `record:related_list` and the detail synthesizer now declare two shapes they already accepted at runtime.

  `RecordRelatedListRenderer`'s `schema` prop made `objectName` required, which rejected the exact authoring shape the per-element `dataSource` binding exists to support (`{ relationshipField, dataSource: { object, view } }`) — the gate maps the binding onto `objectName` before the body reads it, so the key is supplied, not missing. It is optional on the wrapper's input now, and required everywhere else.

  `ObjectDefLike.fieldGroups` is derived from the spec's authorable field group instead of restating it. The hand-written list had drifted: it omitted `icon` and `description`, both of which the synthesizer passes through to detail section descriptors, so an object definition declaring the group icon the code honours did not type-check against it.

- 3e19fe7: i18n copy: one ellipsis glyph across the ten packs, `usted` in the es draft-preview empty state, and a pt sentence that stops contracting `de` onto its own hole

  Three locale-copy defects that no gate could see, because all three are _value_ defects on keys whose names, placeholders and key sets were already correct.

  **One ellipsis (objectui#3878).** `en` ended 33 values with three ASCII full stops (`Loading...`, `Ask anything...`) and 110 with the typographic ellipsis `…`, and the nine translation packs had copied `en` value by value — so a user could read both glyphs on one screen: `common.loading` beside `dashboard.loading`, `console.ai.askAnything` beside its own panel's siblings. All ten packs now spell it `…` (U+2026), per the maintainer-authorized consistency pass registered on objectstack#6015. 312 pack values changed: 34 in `en` (the 33 trailing plus the one mid-sentence `collaboration.commentPlaceholder`) and 278 across the nine. Eleven inline `defaultValue` call sites were re-synchronised with the new `en` text, which `scripts/check-i18n-call-site-keys.mjs` requires byte-for-byte.

  The convention is now pinned so the split cannot regrow: `packages/i18n/src/__tests__/ellipsis-glyph-3878.test.ts` fails, by key name, on any value in any of the ten packs that holds three ASCII full stops. It is deliberately wider than "a trailing `...` in `en`", because the census showed the narrow rule would have shipped with two holes in it — `collaboration.commentPlaceholder` puts the ellipsis mid-sentence, and `list.loading` had the packs wrong while `en` was already right, which no `en`-only rule can see.

  Fifteen module-local **no-provider fallback** entries were moved with the packs, across `useCollaborationTranslation`, `useFieldTranslation`, `useDetailTranslation`, `ObjectGrid`, `KanbanImpl`, `data-table` and `ConnectionStatus`. Those maps exist to render when no `LocalizationProvider` is mounted, and each one's own docblock requires it to stay byte-identical to the `en` pack — a requirement objectui#3440 already enforces mechanically for the collaboration map. Leaving them behind would have made the provider-less path disagree with the provider path on ten keys.

  **es `usted` (objectui#3875).** `preview.empty.notReadyDescription` said `Revisa la conversación` — the tú imperative — in a namespace that is otherwise 23:1 usted, and it renders _underneath the usted draft-preview banner at the same moment_, not before or after it. `Revisa` → `Revise`; nothing else in the sentence carries a register. The neighbouring `approvalsInbox` namespace is legitimately tú and was left alone.

  **pt contraction (objectui#3877).** `ConcurrentUpdateDialog` splits `detail.concurrentUpdateDescription` on `{{field}}` and renders a bolded label in the gap, and pt left a bare `de` in front of that gap. When the multi-field conflict branch passes the record label (`este registro`), Portuguese users read `de este registro` — a contraction error every native speaker sees, and one that no spelling of the leaf value could fix (`deste registro` renders `de deste registro`). The pt sentence is rewritten so the hole is preceded by the verb `afeta` instead of any preposition, which closes the whole class rather than trading `de` for an `em` or `a` that contract just as hard. pt only; `en` is unchanged.

  No behavior, no keys added or removed, no placeholder changed.

- 6314e87: Inline-editing an `address` on the record detail page now edits it as real sub-fields, instead of collapsing it to one text box reading `[Object]` and saving a string over the structured value.

  `InlineFieldInput`'s type switch routed the scalar and relational families to their dedicated widgets; every structured-object type matched nothing and fell through to the terminal raw text input at the end of the component. That fallback stringifies an object value through `coerceToSafeValue`, whose general-object case extracts `name || label || externalId || id || _id` and otherwise returns the literal `[Object]`. A stored address carries none of those keys, so the edit box read `[Object]`.

  The display half was cosmetic; the write half was not. The fallback is a plain input wired to `onChange(v)`, so whatever the user typed was emitted as a **string** that replaced the whole `{ street, city, state, postalCode, country }` object on save — and `[Object]` was what the user saw as the current value they were correcting, which makes typing over it the natural gesture. An ordinary double-click inline edit therefore destroyed the sub-field structure. This is the input path only: objectui#4037 fixed the display registry, and read mode (including the inline-edit read state before editing starts) already rendered a formatted address.

  `location` and `geolocation` are fixed with it. Both store objects too (`{ latitude, longitude }`), both reached the same terminal input, and both produced the identical `[Object]`-then-overwrite pair — one defect in three spellings, not three defects.

  No new editor was written and no consumer-side tolerance was added. All three route to the widgets the create/edit dialog already uses (`AddressField` / `LocationField` / `GeolocationField`, the form's own structured-value editors), so the two entry points cannot diverge on the value shape they write back, and `coerceToSafeValue` is left untouched — the routing is what stops an address from ever reaching it. `autoFocus` follows the numeric branches' convention and lands on each widget's first sub-input (street / the coordinate box / latitude).

  String-valued types are unchanged: `text`, `textarea`, `email`, `phone`, `url`, `color`, `code`, `time`, `qrcode` and the rest keep the terminal text input, where stringification is the identity and nothing is lost.

- 5e2e9fa: A `password` or `secret` field on the record detail page is no longer inline-editable: it renders no pencil / double-click affordance and produces no editor, on both the details body and the highlights strip.

  Both types are **masked on read** — `getCellRenderer` returns a fixed bullet run for either — so the value the row could hand an editor was never the credential. `InlineFieldInput` had no branch for either type, so both reached the terminal raw text input at the end of the component, and the row's payload value was seeded into a `type="text"` box: rendered in clear, selectable and copyable, in a control the user reads as holding their credential. Committing the row then wrote that placeholder back verbatim over the field. For `secret` the overwritten value is an opaque reference into an encrypted store (ADR-0100), so the write destroyed the pointer, not just the display. Nothing in the flow said so; the failure surfaced later, wherever that credential was used.

  The decision already existed one package over. `INLINE_EXCLUDED_FIELD_TYPES` in `@object-ui/fields` excludes both types with exactly this reasoning, and the grid honours it through `isInlineExcludedFieldType()`. The detail hosts gated on readonly / computed / system only and never consulted it, so the detail page reproduced the precise failure the set exists to prevent. Both hosts now consult that same alias-aware contract (`isInlineExcludedDetailFieldType`, a narrow-only union of the authored and the object type, matching the computed gate under objectui#3355) rather than growing a second hand-maintained list — so the rule cannot drift between the grid and the detail page again.

  Consulting the shared set closes the container family on the detail page with it: `object`, `composite`, `record`, `grid`, `repeater` and `vector` rode the same plain-text fallback with an object-shaped value, and are now excluded too. The spec spelling `autonumber` is likewise excluded, where the detail computed gate only knew the `auto_number` spelling. The heavy-editor family (`markdown`, `html`, `richtext`) loses its one-line text box on the detail page — those are authored in the record form, which has the real editors.

  The binary/attachment family is deliberately exempt and keeps its detail editor. It is in the shared set for a grid-cell reason — a cell cannot host an upload dropzone — while `InlineFieldInput` routes `image` / `avatar` / `signature` / `file` (and the `video` / `audio` spellings) to the same upload widgets the record form uses. That exemption is pinned against the routing it claims, so it cannot outlive it.

  Re-authoring a credential is unchanged and still belongs in the record form, which has the widget for it (`PasswordField`).

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

- e7663f2: fix(detail): inline edit no longer destroys array values or flattens types on the record page

  `InlineFieldInput`'s type switch ended in a raw text input, and every type it had
  no branch for landed there: the value was displayed through `coerceToSafeValue`
  and written back as whatever the user typed — a bare string.

  Two damage classes survived the earlier passes. Array-valued fields (`tags`,
  `checkboxes`, an options-less multi picklist) were offered for editing as
  `"a, b"` — `coerceToSafeValue` joins arrays — and saved back as that string, so
  the array was gone. Type-lossy scalars (`toggle`, `slider`, `progress`,
  `rating`, `radio`) round-tripped through `String()`, so a boolean column
  received `"true"`, a numeric one `"42"`, and `radio` accepted any free-typed
  value its option list never offered.

  Types the switch already routes keep their editors. Everything else that the
  fields package can edit inline now falls back to `FieldEditWidget` — the same
  control the form renders, `json` → the code editor included — and only genuinely
  string-valued types (`text`, `textarea`, `email`, `phone`, `url`) keep the plain
  input. A drift guard asserts every field type is exactly one of routed /
  excluded / delegated / benign, so a new type can no longer inherit the
  value-destroying default in silence.

  `@object-ui/fields`: the four fixed-option widgets no longer clear the stored
  value when the field declares no `options` at all. An empty offered set had two
  opposite causes — a list that cascaded to zero (clear) and a list that was never
  authored (nothing to decide) — and the second deleted the value on mount, which
  the grid's inline cell editor has always been able to trigger. `FieldEditWidget`
  also forwards `autoFocus` to the widget it renders.

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

- 456aac8: `@object-ui/plugin-detail` now declares `react-router-dom` as a peer dependency (`^6.0.0 || ^7.0.0`), the range its three siblings already use.

  It has been importing the router all along — `PermissionFacetLink.tsx` and `record-reference-rail.tsx` both take `Link` and `useParams` from it — while its manifest named it in no field at all. That resolved locally for a reason that does not travel: the workspace root declares `react-router-dom` in its own `devDependencies`, so a `node_modules/react-router-dom` symlink exists at the root of this repository and Node's upward directory walk reaches it from every package directory. A consumer's install has no such root, and this package's rollup config externalises every bare specifier, so the published `dist/index.js` carried an import of a package the manifest never asked for.

  Consumers already installing `@object-ui/app-shell`, `@object-ui/layout` or `@object-ui/plugin-designer` were unaffected — all three declare the same peer — so this closes the case of a consumer that pulls `plugin-detail` on its own.

  A new repository gate, `pnpm check:phantom-deps`, now asserts that every bare specifier a released package imports under `src/` is declared by that package rather than merely resolvable from it, so the next one of these fails on the pull request that introduces it (objectui#4394).

- 7d04b0e: `record:details` stops publishing a `layout` key the spec removed and the renderer never honoured

  `record:details` declared `layout: enum ['auto','custom']` with `defaultValue: 'auto'` and the description "auto uses the object highlightFields; custom uses explicit sections". None of that was ever implemented. The renderer's only `schema.layout` read tested `'inline'` | `'compact'` — two values the schema never permitted — so both legal values fell through the same ternary and the key selected nothing. `auto` and `custom` have behaved identically for as long as both have existed.

  Two directions were wrong with zero diagnostics: `layout: 'auto'` plus explicit `sections` still rendered the sections, and `layout: 'custom'` with no sections silently fell back to the flat body rather than reporting the missing groups. Because the input carried a `defaultValue`, this was not stale documentation — it was the manifest, the generated `sdui-intrinsics.d.ts` and the designer panel actively offering the key. An AI author writing `layout: 'custom'` believed it took effect.

  `@objectstack/spec` 17.0.0 removed the property (objectstack#6946, ADR-0087 D2); `17.0.0-rc.6` is pinned here, so the key is already rejected on parse with a named migration message pointing at `os migrate meta --from 16`. This release completes the objectui half of that retirement: the input declaration is gone, and so is the dead `inline`/`compact` branch — the synthesized layout is now the constant it always resolved to.

  Nothing that worked stops working. The body-source contract is unchanged and is now the only one declared: **`sections` renders the explicit groups; omitting it falls back to the flat body derived from the object's fields.** That is pinned in both directions, plus the empty-array boundary between them, in `recordDetailsBodySource.test.tsx`.

  One gate got sharper on the way through. The parity test's "declares no top-level input the spec does not accept" check read raw `.shape` keys — but an ADR-0087 D2 tombstone stays _in_ the shape as a `z.never()`, so a retired key still answers "is this declared?" with yes. That is precisely why this input survived the rc.6 pin bump with every derived gate green. The check now filters tombstoned members out, so it catches the next D2 retirement instead of waving it through.

- c32a8a1: `richtext` fields are placed like the long-form fields they are — four layout sets stopped spelling the type three ways the spec rejects

  `@objectstack/spec` spells the WYSIWYG type `richtext`, one word, and **rejects** `rich_text` and `rich-text`: both exist only as typo keys in the spec's own `suggestFieldType` table, so `FieldSchema` refuses a field declared with either. Four sets that place fields by matching the RAW type string carried nothing else — `SKIP_TYPES` in the related list spelled it `rich_text`, both `WIDE_FIELD_TYPES` and `SECONDARY_FIELD_TYPES` spelled it `rich-text` — so each set was inert for the only spelling a producer can emit, and every one of them named the type it was failing to handle.

  For a real `richtext` field that meant: it was auto-derived into a related-list column, it never spanned the full row in a multi-column detail section or form (unlike `markdown` and `html` sitting right beside it in the same sets), and it stayed in the dense primary section of the record page instead of dropping into "More details". All four move together — half of them would have left the detail page and the form disagreeing about the same field, which is worse than the uniform gap.

  The dead spellings are dropped rather than kept alongside the live one: the alias table is the single place aliases belong, and a set that carries both invites the next drift. The pins are derived from the spec's own `FieldType` vocabulary instead of enumerated, so a member that stops being a real type name fails by name — replacing an assertion that was green only because the set contained the string it asked about.

  `markdown` joins `richtext` and `html` in the related list's `SKIP_TYPES`, on a measurement rather than on the assumption that it renders raw. It does not: markdown and richtext both render through `MarkdownCellRenderer`, formatted and sanitized. The reason none of the three works in a table is that the formatted output is block-level — a heading, paragraphs, a list — inside a single-line truncating cell, so a document shows as one clipped heading with the rest invisible. `textarea` stays derived for the same reason read the other way: it renders as plain truncated text, which is a useful column. Author-declared columns are untouched — this set only filters the zero-config auto-derive walk.

- 3f5f87c: `SchemaRenderer` states its real contract — a typed, required `schema` and a deliberate forwarding surface

  `SchemaRenderer` is the renderer loop: every registered SDUI component is rendered through it. It handed `forwardRef` a props type of `{ schema: SchemaNode } & Record<string, any>`, which puts `string` into `keyof Props`, so `'ref' extends keyof Props` was always true, React's `PropsWithoutRef` took its `Omit` branch, and `Omit` over a type carrying a string index signature keeps only the index signature. Every declared prop was erased. Measured on the pre-fix source: `keyof ComponentProps<typeof SchemaRenderer>` was `string` and `ComponentProps<typeof SchemaRenderer>['schema']` was `any`, while the type argument went on declaring `SchemaNode`. The other half is the same defect seen from the call site — `<SchemaRenderer />` with no schema at all, `<SchemaRenderer schema={12345} />`, and an arbitrary misspelled prop each type-checked in silence. This is objectui#4422 / PR #4438's trap in the most central component in the repo, spelled `Record<string, any>` rather than `[key: string]: any`, which is why every previous sweep's grep and both shipped guards' detector reported the site as clean.

  Graded **minor, not major**, on objectui#4528's reasoning: the type argument has always DECLARED `schema`; the index signature erased it from the resolved type, and restoring what the declaration documents is a fix to the published contract rather than a contract break.

  **The forwarding surface is kept, deliberately.** This component forwards every prop it does not read to the component the schema names, resolved at runtime from a plugin-extensible registry — `packages/react/README.md` documents exactly that, and `@object-ui/components`' form renderer consumes the `onSubmit` it shows being forwarded. Closing that surface would state a false contract and would force every leaf plugin's props into this package. So the two halves are separated: the `forwardRef` type argument is the honest `SchemaRendererProps`, with no index signature for `PropsWithoutRef` to collapse, and the open surface is stated once in an explicit export annotation, which nothing routes through `Omit`. The published `.d.ts` shows the erasure disappearing: `ForwardRefExoticComponent<Omit<{ schema: SchemaNode } & Record<string, any>, "ref"> & RefAttributes<any>>` becomes `ForwardRefExoticComponent<SchemaRendererProps & Record<string, any> & RefAttributes<any>>`.

  `SchemaRendererProps.schema` is declared as `BaseSchema | string | null | undefined` — what this component actually handles. It previously declared `@object-ui/core`'s `SchemaNode` interface, which requires `type: string` and so contradicted the component's own early returns for strings and nullish, while every caller held `@object-ui/types`' wider union. The erasure hid that mismatch completely.

  **One declared behaviour change.** A non-object, non-string primitive schema now renders as its own text. It previously fell through to the shallow copy `{ ...schema }`, which spreads a primitive to an empty object, lost the `type` the renderer then looked up, and surfaced the red "Unknown component type: undefined" box — an accident of the spread rather than a decision. The declared props type excludes `number` / `boolean` so no author is invited to pass them; the runtime handling is defence-in-depth for untyped callers and stored metadata. Strings, `null`, `undefined`, `0` and `false` render exactly as before, and an object naming an unregistered type still gets the error box; all four are pinned.

  Latent defects the erasure had been hiding, each surfaced by the repo-wide type-check and fixed at its call site: `DashboardRenderer` cast its widget schema to `Record<string, any>`, dropping the `type` every branch of `getComponentSchema` sets; `DashboardGridLayout`'s equivalent now states its return type instead of inferring a union that admitted a shape with no `type`; and `ReportViewer` handed a section's `content` array to the renderer whole, so a multi-node section rendered the unknown-component box instead of its content — arrays are mapped rather than widened into the renderer's declared input.

  A repo-wide structural guard replaces the two per-package siblings' blocked direction: it judges every `forwardRef` in `packages/*/src` (219 sites) and its detector resolves `Record<string, …>` and `string`-keyed mapped types in addition to literal index signatures — the spelling the previous detector went blind on. It judges the type argument only, where an index signature is an accidental eraser, and never an export annotation, where one is a stated contract.

- 2fea4d2: `detail.showEmptyRelated` renders Russian and Arabic again — the "+N empty" button no longer falls through to English at the counts it takes most often

  This was the repo's only pre-existing i18next plural family, and all ten packs defined exactly two slots: `_one` and `_other`. i18next asks `Intl.PluralRules` for the one suffix a language needs for that number, and when the pack has no such slot it walks `fallbackLng` to `en`. Russian has four plural categories and Arabic six, so `ru` at counts 2-4 (`few`) and 5-20, 25-30, … (`many`), and `ar` at 0, 2, 3-10 and 11-99, resolved nothing locally and rendered the English string. The call site is the collapsed-empties button in the record detail's reference rail, whose count is the number of empty related lists — 2 to 4 are the most common values it ever takes, so a Russian user essentially always read English.

  The fix is a base key (no suffix) beside the two existing slots, in all ten packs. The base key is always in i18next's lookup chain, so every category a pack did not enumerate resolves to it, in that pack's own language — and, unlike adding `_few`/`_many` to `ru` alone, it keeps the ten packs' key sets identical, which full key parity requires. Same shape objectui#3546 slice six established for `perm.facet.*`. Where the base key is genuinely reachable it carries a count-invariant phrasing: `ru` uses the «Существительное: {{count}}» form the pack already writes 22 times, `ar` the «{{count}} مفرد(جمع)» marker it uses throughout. For `en`/`de`/`zh`/`ja`/`ko` the base key cannot be reached at all (their categories are covered by the two existing slots) and repeats `_other` for parity; `fr`/`es`/`pt` reach it only from a million up, where the plural form is already correct. No English copy moves.

  The provider-less path needed the same row for a different reason: `createSafeTranslation`'s fallback resolves `defaults[key]` literally and never appends a plural suffix, so the two suffixed rows in plugin-detail's defaults table were unreachable through it and that path answered with the raw key. It now carries the base key too.

  Parity across packs turned out to be necessary and not sufficient — ten identical key sets were green throughout, because the defect is one level below key names: the slot the language needs is not in the set. So the invariant "a plural family must carry a base key" is now asserted over all ten packs in `all-locales-key-parity.test.ts`, where it is pack-intrinsic and fails at PR time without needing a call site to exist. It went red on all ten packs before this change and names the family that is missing its base.

- dad805d: Six i18n keys no longer render as raw key strings on hosts with no `I18nProvider` (objectui#4396)

  `detail.saving`, `list.resetSortToDefault`, `appDesigner.widgetProperties`, `appDesigner.addWidget`, `appDesigner.modeEdit` and `common.delete` were read through `createSafeTranslation` without a row in their hook's defaults table and without an inline `defaultValue` at the call site — the only two fallbacks that path has. On a provider-less host (standalone embedding, the preview gallery, host apps that never mount a provider) `fallbackT` therefore returned the key itself, so users saw `detail.saving` in the inline-edit save button, `list.resetSortToDefault` on the sort popover's reset control, `appDesigner.widgetProperties` as the dashboard inspector heading, `appDesigner.addWidget` as its toolbar label, `appDesigner.modeEdit` as a button's accessible name, and `common.delete` on the designer's destructive confirm.

  Each key now has a row in its consumer hook's defaults table, byte-identical to the `en` pack value. No pack was edited, no key added, no call site changed.

- 35997ce: fix(plugin-detail): synthesize page components in the spec's `properties` carrier so Studio page-create can persist

  Creating a page in Studio never completed. The create path seeds a record
  page's `regions` from `buildDefaultPageSchema(objectDef)` and PUTs the result,
  and every node that synthesizer emitted carried its widget props at the TOP
  level of the component — `{ type: 'page:header', recordChrome: true }`,
  `{ type: 'page:tabs', items: [...] }`, and the same for `record:highlights`,
  `record:path`, `record:details`, `record:related_list`, `record:history` and
  `record:reference_rail`. ADR-0089 D3a closed `PageComponentSchema` with
  `.strict()`, so those keys are not stripped, they are a parse error
  (`Unrecognized key(s) on this view/page schema: 'recordChrome', 'actions'`).
  The server refused the body and no page row was ever stored.

  The props now go where the spec declares them — the node's `properties` bag,
  which is where `ComponentPropsMap` defines `page:header.recordChrome` and
  `page:tabs.items` in the first place. Nothing is dropped and nothing changes on
  screen: a header still defaults to record chrome ON, an author's
  `recordChrome: false` is still carried (and now actually persists), the tabs
  keep their items, and `SchemaRenderer` hoists `properties` back onto the node
  before dispatch, so every renderer receives exactly the props it did before.

  One code path does the wrapping for every node the synthesizer builds, so there
  is a single answer to "what may go in a page write". Slot overrides are
  untouched — a node handed in by a caller is still placed verbatim.

- b388950: fix(plugin-detail): the record detail header honors `userActions` predicates

  `userActions.delete` reached the record detail header in its **boolean** form
  but not in its **predicate** form. `userActions: { delete: false }` removed
  Delete from the row kebab, the selection bar and the detail header, because the
  host lowers the boolean into `schema.showDelete`. `userActions: { delete: {
visibleWhen: … } }` reached only the row kebab: the header ANDed
  `schema.showDelete ∧ objectAllowsDelete ∧ canDeleteRecord` and never evaluated
  the predicate, so an author upgrading from "nobody may delete this object" to
  "these records may not be deleted" silently lost the surface they were most
  likely to have tested on.

  The header now folds the per-record predicates in as a fourth conjunct,
  evaluated against the open record through the same helper family the row
  surfaces use — `userActionPredicates` from `@object-ui/core` for the parse (the
  import `RelatedList` already makes) and `useRowPredicate` from
  `@object-ui/react` for the evaluation:

  - `delete.visibleWhen` / `edit.visibleWhen` false → the header affordance is
    hidden (fails closed; `visibleWhen: false` counts as a declared gate).
  - `delete.disabledWhen` / `edit.disabledWhen` true → the header affordance
    renders disabled rather than disappearing, matching the row kebab.

  The existing permission and record-writability gates are unchanged, so a
  predicate that holds can never resurrect a button the user may not press. The
  boolean form stays the host's channel — a bare boolean yields no predicate.

- Updated dependencies [0e67b53]
- Updated dependencies [932cbcd]
- Updated dependencies [734d186]
- Updated dependencies [3fc2971]
- Updated dependencies [f7c6430]
- Updated dependencies [ae10a01]
- Updated dependencies [92876f0]
- Updated dependencies [828549a]
- Updated dependencies [e1ade8f]
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [5cc847c]
- Updated dependencies [fa21254]
- Updated dependencies [33c32bf]
- Updated dependencies [66fb4fa]
- Updated dependencies [6d641c9]
- Updated dependencies [45e1949]
- Updated dependencies [92250d6]
- Updated dependencies [58bebf6]
- Updated dependencies [405e808]
- Updated dependencies [c0f9a4b]
- Updated dependencies [ac853ce]
- Updated dependencies [fa51109]
- Updated dependencies [d46f9b8]
- Updated dependencies [2fea4d2]
- Updated dependencies [7f1cb33]
- Updated dependencies [2e3b0c0]
- Updated dependencies [78fa331]
- Updated dependencies [31ab1ac]
- Updated dependencies [0082db8]
- Updated dependencies [06915b0]
- Updated dependencies [ff84b05]
  - @object-ui/i18n@17.5.0

## 17.4.0

### Minor Changes

- ecae400: Retire the `capability-multiselect` field widget name, which existed only on the docs-site registration path and which nothing ever stamped (objectui#3308, ADR-0049 enforce-or-remove)

  `field:capability-multiselect` was registered by `registerFields()` and only there. That function's sole caller is the docs site, so the key never existed on the live path (`registerAllFields()`, run at module import, iterates `fieldWidgetMap` — which never listed it). A field authored with `widget: 'capability-multiselect'` therefore resolved to nothing in every real application, while the comment above the registration described it as usable from a record form: a code comment promising a capability that does not exist, which is the worst direction for a metadata renderer AI-authored apps read as authority.

  Nothing stamped the hint either. ADR-0056 P1 stamps `permission-facet-link` on all six `sys_permission_set` facets — `system_permissions` included — through the single `ObjectStackAdapter.getObjectSchema` choke point, and P2 put the capability editor in Studio. The widget name was a leftover from an intermediate iteration of that rollout.

  Removed, with a tombstone at each site:

  - `@object-ui/fields` — the `field:capability-multiselect` registration and the comment that advertised it. **Breaking in name only**: the key was unreachable outside the docs site, so no application could have resolved it. A field still carrying the hint now degrades to its declared `type` renderer, the defined behavior for an unregistered widget.
  - `@object-ui/plugin-detail` — `InlineFieldInput`'s `widget === 'capability-multiselect'` branch, the hint's last honoring surface. Leaving one consumer for a name no producer emits and no form resolves is the same declared-vs-enforced split, inverted. The sibling `permission-facet-link` branch is untouched and pinned.
  - `@object-ui/components` — the dead `capability-multiselect` entry in the form renderer's `DATA_SOURCE_FIELD_TYPES` set, which could never match a resolvable widget.
  - `@object-ui/plugin-form` — a comment naming `capability-multiselect` as the widget stamped onto `sys_permission_set.system_permissions`; it names `permission-facet-link` now, which is what is actually stamped.

  `CapabilityMultiSelectField` itself is **unchanged and still exported**: Studio's `PermissionMatrixEditor` imports and renders it directly, which is ADR-0056 P2's design. Only the widget name is retired — the component is not a registry field widget and its doc comment now says so.

  `registerFields()` is also **kept**, with its `@deprecated Use registerAllFields() instead` note corrected. The two are not interchangeable: it registers `createFieldRenderer(widget)`, which synthesizes the label, description and the local `value`/`onChange` state that lets a bare field node (`{ type: 'currency', label: 'Amount' }`) render standalone in the docs demos. Retiring it needs a decision about where that demo chrome goes; the note now records that instead of implying a drop-in replacement.

### Patch Changes

- f0a625a: `disabled: ''` no longer greys out the remaining five action surfaces (objectui#3849)

  objectui#3842 / PR #3851 fixed the "is a `disabled` gate DECLARED?" test on
  `action:button` and app-shell's `DeclaredActionsBar`. Five same-shaped sites were
  outside that PR's scope and stayed on `!= null`, so within one component the
  `visible` gate asked `hasDeclaredVisibilityGate` while the `disabled` gate on the
  next line asked `!= null` — two spellings of one question:

  - `@object-ui/components` — `action:icon`, `action:group`'s inline button
    (`InlineActionButton`) and dropdown item (`DropdownActionItem`), and
    `action:menu`'s item (`ActionMenuItem`).
  - `@object-ui/plugin-detail` — `record:quick_actions`' `QuickActionButton`.

  Why the missing `!== ''` half is a defect on this key and not on `visible`:
  `toPredicateInput('')` is `undefined` and `evaluateCondition(undefined)` is
  `true`. On `visible` that `true` means SHOW, so an over-broad "declared" test and
  a permissive empty predicate cancel out. On `disabled` it means DISABLE, so they
  compound — `disabled: ''` (an empty predicate: nothing declared) rendered a
  permanently greyed-out control, with nothing the author could write to un-grey
  it. Unlike #3842's approvals inbox, these five are the general action face
  (toolbars, dropdowns, record quick actions), so the reach is wider even though no
  single high-value host owns them.

  **Behaviour change surface, deliberately narrow.** Only `disabled: ''` changes —
  from disabled to clickable, which is what "no predicate" asked for. `disabled:
true` still disables, `disabled: false` and an absent `disabled` still do not, and
  no expression-valued `disabled` changes verdict. On the four sites that also carry
  the legacy non-spec `enabled` fallback, one consequence follows: an empty
  `disabled` now falls THROUGH to that leg instead of short-circuiting on the empty
  predicate, so an action spelling both (`disabled: ''` + `enabled: true`) becomes
  clickable. `record:quick_actions` has no `enabled` leg, so its chain is the single
  gate.

  Routing those legacy `enabled` legs through the same definition is
  behaviour-preserving by derivation rather than a fix: the leg is negated
  (`disabled = !isEnabled`), so an empty predicate's `true` already arrived as "not
  disabled" — the verdict "no gate declared" produces. #3842's four-shape derivation
  table is reproduced next to the new pins, together with the statement that no
  `enabled` case can go red by reverting that leg.

  `hasDeclaredVisibilityGate` keeps its historic name (the objectui#3842 ruling): the
  predicate is key-neutral, and one implementation behind two names is how a repo
  grows dialects. The three `@object-ui/components` sites import it relatively;
  `record:quick_actions` takes it from the package barrel, the cross-package route
  objectui#3835 opened. Every call site says so in a comment.

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

- 7b3e048: `record:highlights` publishes the `readonly` entry key, so an AI author can discover it from the manifest

  `readonly` on a `fields[]` entry has been enforced for a while — the renderer copies it
  through normalization and `HeaderHighlight`'s editability gate refuses inline editing on a
  chip carrying it (objectstack#5077) — and `@objectstack/spec` declares it on
  `RecordHighlightsField` (objectstack#5176 / PR #5607). The block's own published authoring
  surface never mentioned it: the `fields` input still spelled the entry shape
  `{name,label?,icon?,type?}`, and since the registry `inputs` are what
  `gen-manifest.ts` serializes into `sdui.manifest.json`, an author reading the manifest was
  told the key did not exist. The `fields` description now states the full entry shape and
  what `readonly` does, which is the discoverability the manifest is for.

  `readonly` is documented **inside** the `fields` description rather than declared as an
  input of its own, because that is where the contract puts it. The spec's
  `RecordHighlightsProps` has exactly three top-level keys (`fields`, `layout`, `aria`) and
  carries `readonly` per ENTRY. A top-level `{ name: 'readonly', type: 'boolean' }` input
  would publish a key the platform silently discards: the generated `sdui.manifest.json` and
  `sdui-intrinsics.d.ts` would advertise a `readonly` prop, the manifest gate validates
  top-level props only and would raise no diagnostic, `RecordHighlightsProps` is a plain
  `z.object` so the unknown key is stripped on parse without error, and the renderer — which
  reads `field.readonly` per entry — would never see it. An author who trusted that surface
  would be left with the machine-owned column still hand-editable and no diagnostic anywhere
  explaining why. `ComponentInput` is flat by design, so an array-of-objects input publishes
  its member keys in prose, as `record:path.stages` and `record:alert.action` already do.

  A new spec-parity test derives both directions from `@objectstack/spec` at runtime instead
  of restating today's key list: every key of `RecordHighlightsField`'s object arm must be
  named in the `fields` description, and the block must declare no top-level input that
  `RecordHighlightsProps` does not accept. Nothing previously cross-checked the registry
  `inputs` against the spec, so both drift directions were silent. No runtime behaviour
  changes.

- aca561a: Four spec keys the renderers already honoured are now discoverable from the published `inputs`

  `record:details.hideFields`, `record:related_list.relationshipValueField`,
  `record:related_list.add` and `element:text_input.defaultValue` were declared by
  `@objectstack/spec` and read by their renderers, while the registry `inputs` —
  the surface `gen-manifest.ts` serializes into `sdui.manifest.json` and
  `sdui-intrinsics.d.ts` — never mentioned them. Nothing anywhere reported the
  mismatch, and every layer that reads a manifest said the opposite of the
  runtime: the keys were in no designer panel and no generated `.d.ts`,
  `sdui-parser`'s prop walk returned `unknown-prop` for an author who wrote one,
  and the renderer honoured it regardless. That is objectui#3407's original
  complaint (`readonly` was enforced and honoured, the description just never said
  so) on four more keys.

  Each description is derived from what the renderer actually does, not from
  restating the spec's one-liner, because the two can differ and the published
  text is what an AI author reads:

  - `hideFields` documents bare field names only — the renderer tolerates
    `{name}` / `{field}` entries but the spec is `z.array(z.string())` and rejects
    them, so teaching that spelling would publish a dialect the contract refuses;
  - `relationshipValueField` publishes the renderer's `'id'` default and says that
    the resolved value drives the list filter, the Add-picker link value and the
    pre-filled create form together;
  - `add` publishes its member shape in prose (`ComponentInput` is flat and has no
    member-shape slot) with each default taken from the renderer — including
    `picker.labelField`, where the renderer defaults to `name` while the spec's
    own wording says "the object title field". It also names `picker.filter` as a
    KNOWN GAP rather than documenting it as a restriction: the spec declares it
    and nothing reads it, so an author would otherwise believe their picker is
    scoped when it offers every record (objectui#3831);
  - `defaultValue` distinguishes the two behaviours an author can get — seeding a
    bound page variable once while it is still empty, versus the native
    uncontrolled initial value with no variable bound.

  `element:text_input` is not in the public tier, so its gap was not in
  `sdui.manifest.json` at all — it was in the JSX-page compiler's prop whitelist,
  which `renderers/layout/page.tsx` builds from `getKnownTypes()` plus these same
  `inputs`, making the undeclared `defaultValue` a live `unknown-prop` warning.

  The repo-wide parity gate now runs in both directions over one covered set and
  one exemption discipline, so neither direction can be forgotten again the way
  the reverse half was after PR #3806. Nine spec keys stay deliberately
  unpublished, each with a written reason and a tracking issue: two the renderers
  do not read at all (objectui#3829), three retired upstream by ADR-0087
  tombstones, `page:tabs.type` (a carrier collision, objectstack#6776), two
  `targetVariable` declarative hints (objectui#3834), and
  `element:record_picker.filter` (objectui#3830).

- 6d762da: The five locale keys behind #3546's eight no-fallback `t()` call sites are now defined in all ten packs, so the built-in-view toasts, the activity-timeline source link, the wizard's required-field toast and the Gantt refresh button's accessible name are translated instead of falling back to English — or, on two surfaces, to the key itself (part of #3546).

  `scripts/check-i18n-call-site-keys.mjs` measured 258 keys that a `t()` call site asks for and no pack defines. These five were the subset with no working inline default: `console.objectView.cannotEditMetaView`, `console.objectView.cannotDeleteMetaView`, `detail.viewSource`, `gantt.toolbar.refresh` and `wizard.missingRequired`. Adding a `defaultValue` is deliberately not the fix — that mechanism is what kept all 258 invisible for months.

  **Two of the eight sites really did render the raw key**, and both go through a binding with nothing in front of i18next. `ObjectView.tsx` calls `useObjectTranslation()` directly, so five toasts read `console.objectView.cannotEditMetaView` / `cannotDeleteMetaView` on screen; the `|| 'Built-in views cannot be renamed.'` guards next to them were dead on every path, because i18next answers a miss with the key itself and a non-empty string never falls through `||`. Those four unreachable English strings are removed rather than repaired: one key served four call sites (rename / pin / set-as-default / configure), so the pack copy covers any change to a built-in view instead of naming one operation. `RecordActivityTimeline.tsx` fails the same way for a subtler reason — `useDetailTranslation` is `createSafeTranslation(..., 'detail.back')`, and because `detail.back` does resolve, the probe hands back i18next's `t` for every key and bypasses the defaults map wholesale, so `detail.viewSource` reached the user verbatim.

  **The other two sites were not rendering a raw key**, contrary to the issue's description, and are fixed here as the milder "English in all ten languages" class. `wizard.missingRequired` is its own hook's probe key, so the probe failed and `createSafeTranslation` correctly served its English default. `gantt.toolbar.refresh` goes through `useGanttTranslation`, which deliberately does not use `createSafeTranslation` and falls back per key — so the refresh button's `aria-label` was "Refresh", in English, never the key. Screen-reader users heard an English word rather than an identifier; a `zh` session now hears 刷新.

  Regression cover is provider-mounted on purpose: with no `I18nProvider` the defaults maps answer every one of these keys and the assertions pass while the console is broken, which is precisely the false-green the issue documents. For the two sites whose English output was already correct, `en` cannot discriminate before from after — the `zh` assertions are the ones that pin the fix.

- 4178d5a: `record:details` 的 `sections` 输入说明改为从 spec 形状派生的对象形,不再教已被退役的「Section IDs」

  `inputs` 不是文档,而是发布出去的编写契约:`gen-manifest.ts` 把它序列化进
  `sdui.manifest.json`(保存门 + parser 白名单)和 `sdui-intrinsics.d.ts`。而
  `record:details.sections` 的说明写的是 `Section IDs to show (required when layout
is "custom")` —— 那是 17.x 以前的形状。pin 版 `@objectstack/spec@17.0.0-rc.5` 的
  `RecordDetailsProps.sections` 是对象数组 `{ name?, label?, columns?, fields }`,
  objectstack#5611 把 `z.array(z.string())` 那条拼法**删掉**而不是 union 进来(既无
  producer 也无 consumer,一种形状而不是两套事实契约)。

  照旧说明写 `sections: ['contact_info', 'address']` 的作者,在四层之间拿不到任何
  诊断:`['a','b']` 对 manifest 门是合法 `array`(门只看顶层键名 + 粗类型),上游
  `validateComponentProps` 是 advisory 级,spec 只在真的走 parse 的路径上才拒,而
  `RecordDetailsRenderer` 对每个条目读 `s.name` / `s.label` / `s.fields` —— 字符串上
  三者全 `undefined`,该 section 一个字段都不渲染。`layout: 'custom'` 时 sections 是
  详情页正文的唯一来源,所以结果是一张没有报错的空白详情页。

  新说明逐键派生自 spec 各成员的 `.describe()` 与渲染器实读:`fields` 必填、按序渲染;
  `label` 是标题(省略即无标题、无边框);`name` 是 snake_case 稳定标识与 i18n 锚点
  (标题走 `objects.{object}._sections.{name}.label`);`columns`(1-4)是本 section 的
  字段栅格宽度,省略则由渲染器推导;并明确写出字符串条目不被接受。渲染器另外还认的
  `title` / `showBorder` / `hideEmpty` **故意不写进说明** —— spec 的 section 对象没有
  声明它们,parse 时会被静默剥掉,发布它们等于教作者写契约丢弃的键。

  同时新增 `recordDetailsInputs.spec-parity.test.ts`:两个方向的断言都在运行时从 spec
  schema 派生(每个 spec 成员键都能从说明里发现;本 block 不声明 spec 不接受的顶层
  input),所以下一次 spec 变形会先让测试红,而不是又一次静默张开。仅说明文本变化,无
  运行时行为改动。

- 54233b1: Record detail pages: a header ⟳ that refreshes the record, its related lists and its tab counts in place — no browser reload

  Concurrent-editing scenario from the shop floor (MES work orders): operator A sits on a record's detail page while operator B starts or reports the same order. A had no way to see the new state except F5, which throws away the open tab, the scroll position and any in-progress inline edit along with the stale data.

  The pipeline for this already existed — the objectui#2269 invalidation bus refetches every mounted reader in place, and `RecordContext.refresh` had been declared for it — but nothing produced that field and no UI reached for it. Three changes give it a trigger:

  - **`RecordDetailView` produces `RecordContext.refresh`**, publishing `notifyDataChanged({ objectName: '*' })`. The wildcard is deliberate: a user reaches for refresh because of a write made by SOMEONE ELSE, which this client never saw and therefore cannot attribute to particular objects. `'*'` marks everything mounted as stale, so the main record, every related child list and the tab-count badges all refetch — no remount, so tab / scroll / draft state survive. First phase covers the standalone record route; embedded hosts (list drawer, split-pane preview) keep their existing chrome unchanged.
  - **`page:header` renders the ⟳** at the far end of the header row when — and only when — the host provides `refresh`. It is page chrome rather than a header action, so its position is the same on every record page regardless of which business actions the object declares, and it can never be collapsed into the `⋯` overflow. Styled as that `⋯` trigger's twin so the row reads as one button family. Its accessible name and tooltip come from the existing `common.refresh` key, so the icon-only button is not English-only in the other nine locales. The icon spins for a short floor after a click, because the bus is fire-and-forget and a warm backend would otherwise finish before the click looked like it landed.
  - **`RelatedList` accepts the `'*'` wildcard** on the legacy `objectui:related-changed` event, matching what `dataChangeMatches` already does for the bus's own readers. This listener compared the payload's object name to its own, so a wildcard invalidation reached everything on the page except the related lists — a concrete foreign object name is still ignored.

  Hosts that provide no `refresh` render exactly as before.

- c2ecbae: 相关列表 Add 选择器兑现 `add.picker.filter`:作者限定的候选范围现在真的生效

  `record:related_list.add.picker.filter` 被 spec 声明为「Restrict which records the picker offers」,但渲染器从未读过它 —— 挂 `RecordPickerDialog` 时不传任何 filter,对话框照样提供 `picker.object` 的全部记录,选中即建链接行或改父,`os validate` / `os build` 全绿、运行时零诊断。作者写下「只允许指派 active 的岗位」「只允许挂未过期的许可」,得到的是完整候选列表。

  现在它按原样传给 `RecordPickerDialog` 的 `baseFilter` —— 不是 `lookupFilters`,后者会把条件渲染成用户可编辑的筛选栏行,等于把作者的硬性限制降级成建议。

  `baseFilter` 因此接受两种形状,按结构判别(`Array.isArray`):

  - **`QueryParams.$filter` 记录形式**(依赖型 lookup 链)保持原有的键覆盖语义逐字节不变 —— 级联父值必须**替换**同字段上过期的 `lookupFilters` 条目,而不是与之求交。
  - **spec 的 `ViewFilterRule[]`** 经 `mergeFilterNodes`(仓内唯一的 filter 下沉口)下沉,19 个 operator 全部无损到达服务端,包括记录形式没有 `$op` 可用的 `before` / `after` / `is_empty` / `is_not_empty`。此处**不新增**第二份 operator 词汇表。

  槽位类型同时从 `Record<string, any>` 收紧为 `unknown`:前者会接受规则数组(数组满足 `any` 的字符串索引),旧的对象展开再把它压成 `{"0": {...}}`,于是查询去过滤名为 `0` 的列 —— 类型全绿、查询错误、无任何诊断。

- acc34c5: `record:related_list`: an `add` without `add.picker` no longer takes the whole related list down.

  The Add-picker gate compared only `add` for truthiness and then read `add.picker.object` bare, so page metadata declaring `add` but omitting the (spec-required) `picker` threw during render and `SchemaRenderer` replaced the entire related list with a "Component failed to render" card whose message never mentioned `picker`. Both the Add button and the picker dialog now gate on the resolved `add.picker.object` — the list body renders as usual, only the unconfigured Add affordance is withheld, and a console hint names the missing key. Off-spec `add` still does nothing, so no lenient second dialect is introduced; producing-side validation of page metadata is tracked separately.

- c4768a7: `record:related_list` — the declared `filter` reaches the query, and the Add button answers to the same gate as its dialog

  - **`filter` is consumed** (objectstack#7118). The spec declares
    `RecordRelatedListProps.filter` ("additional filter criteria") and this repo
    published it as a registry input, but nothing read it: `RelatedList` built its
    query from `{ [relationshipField]: parentId }` alone, so an authored filter was
    accepted by every gate and silently dropped — the list answered with every child
    of the parent. It is now AND-combined with the parent condition (never
    substituted for it, so an additional criterion can only narrow), lowered through
    the repo's single filter sink so the spec's `[{ field, operator, value }]`
    vocabulary and a composed `dataSource` binding both work. With nothing authored
    the query is unchanged. As a consequence a saved view named through
    `dataSource: { object, view }` no longer contributes its columns/sort/limit while
    its filter is discarded — the list can no longer be wider than the view it names.
    On the legacy raw-URL fallback path, which cannot express an operator, a declared
    filter is refused with a console explanation instead of dropped.
  - **The Add button now requires `dataSource`** (objectui#3895), matching the picker
    dialog and the add callback. In hosts that supply no `RecordContext` — Studio
    designer previews, context-free embeds — the button rendered and did nothing at
    all when clicked; the affordance is now withheld where the capability behind it
    is absent.

- Updated dependencies [7864f03]
- Updated dependencies [f5f8744]
- Updated dependencies [69becd2]
- Updated dependencies [5e52495]
- Updated dependencies [b750823]
- Updated dependencies [ac2139c]
- Updated dependencies [b14ab3a]
- Updated dependencies [8c60819]
- Updated dependencies [e64a52e]
- Updated dependencies [844d17f]
- Updated dependencies [4dcd52a]
- Updated dependencies [42ae5c6]
- Updated dependencies [6d762da]
- Updated dependencies [f9faa7d]
- Updated dependencies [33526fd]
- Updated dependencies [32413ec]
  - @object-ui/i18n@17.4.0

## 17.3.0

### Minor Changes

- 5af2852: The record detail page now shows a read-gated approval panel (#3461). A record in approval used to expose NOTHING about the running approval to anyone but the current pending approver — `useRecordApprovals` was consumed solely to inject the header Approve/Reject buttons, while the pending-approver list, decision progress, and the `sys_approval_action` timeline existed only in the Approval Center's drawer, a `setup`-app surface that business roles can't navigate to (and whose backing object is tenant-wide, so granting read there is over-broad). The submitter couldn't tell whom to nudge; the record's own audit history was no help either, since the engine mirrors business fields as `runAs:'system'` and decisions never enter record history. The new surface is an **Approvals tab** on the record page — a peer of Details/Related (same promotion Attachments got in objectstack#4358), emitted by `buildDefaultTabs` only when the record actually has requests, with a request-count badge and the label localizing through the tab strip's KNOWN_LABEL_DICT (审批). The tab wraps the new `record:approvals` node (`RecordApprovalsPanel`), visible to EVERY viewer who can read the record: current flow/step with the enriched flow-steps strip, server-computed decision progress (quorum tally, per-group 会签 ticks), the waiting-on chips with server-resolved names and group labels (never raw ids), one chronological action timeline merged across all of the record's requests (a multi-level flow opens one request per node), decision comments and attachments, and an inline remind button for the submitter (`viewer.is_submitter`, with an id-match fallback for older backends) that POSTs the existing `/approvals/requests/:id/remind`. The host threads its live `useRecordApprovals` read through the node so the tab and the header decision buttons never disagree; on authored pages the `record:approvals` renderer self-fetches, and an authored page that omits the node gets a bottom-of-page fallback append so the approval story is never lost to a custom layout. Copy reuses the Approval Center's `approvalsInbox.*` keys so the two surfaces can't drift; `useRecordApprovals` now exposes the full `requests` array plus `listApprovalActions` / `remindApprovalRequest`, and its `ApprovalRequestLite` carries the display enrichment (`process_label`, `step_label`, `flow_steps`, `viewer`, `round`) the single-read endpoint already sent.

### Patch Changes

- 532cf8b: Deliver the required state to the control in the five renderers outside the object form that still painted it as an asterisk only (objectui#3299 — the same defect #3290/#3298 fixed in `form.tsx`).

  Each site converges on the reference shape (`EmbeddableForm.tsx`): the control carries `aria-required={required || undefined}` and the asterisk is `aria-hidden="true"`, so assistive tech announces required once, as a state — instead of hearing a bare "asterisk" folded into the accessible name, or nothing at all.

  - `@object-ui/app-shell` — `ActionParamDialog` (both the boolean row and the default branch, delivered through the real field widgets' `toDomProps` whitelist) and `CreateViewDialog` (display label, machine name, and every type-specific required-field selector).
  - `@object-ui/components` — the custom `ActionParamDialog` (all five typed branches, including the Radix select trigger) and `FieldContainer`, whose existing Slot injection (`id` / `aria-describedby` / `aria-invalid`) now also injects `aria-required`, covering every consumer in one place.
  - `@object-ui/plugin-detail` — `InlineCreateRelated`'s create-tab inputs.

  Deliberately NOT the native `required` attribute (#3290 ruling): each of these hosts runs its own validation, and native `required` would arm the browser's constraint-validation bubble beside it. The SDUI controls that already use native `required` (`renderers/form/{input,textarea,select,checkbox}.tsx`, `basic/text-input.tsx`) are unchanged — they don't have a second validator, so their channel is already correct.

- b71fc92: Localize the last untranslated console-chrome accessible names (objectstack#5430)

  Four icon-only controls still carried hardcoded English accessible names, so
  under a non-English session they were the only English left in the record
  chrome — and because the controls have no visible label, that literal _is_ the
  control to a screen reader and to the hover tooltip.

  - `page:header`'s `role="toolbar"` — now `detail.pageHeaderActions` (its `⋯`
    overflow trigger eight lines below was fixed in #5407; the toolbar was missed)
  - `ReactionPicker`'s `role="listbox"` popup — now `detail.emojiPicker`
  - `ReactionPicker`'s per-reaction chip, which built its name by concatenation
    with English pluralization baked in (`reaction${count !== 1 ? 's' : ''}`) —
    now `detail.reactionCount` / `detail.reactionCountOne`
  - `NavigationOverlay`'s drawer close and split-panel close — now `common.close`
    (the key the rest of the console already uses) and `common.closePanel`

  The pluralized label follows this repo's **two-key** convention
  (`detail.relatedRecords`/`relatedRecordOne`, `lookup.recordCount`/`recordCountOne`)
  rather than an i18next `_one`/`_other` pair: zh/ja/ko have no separate singular
  form, so those packs would legitimately omit the `_one` half and
  `all-locales-key-parity` would read that as a lost key.

  All five new keys are added to all ten locale packs.

- 3889ffb: Console chrome i18n gaps (objectstack#5407).

  - A dependency-gated lookup now names its controlling field by its **label**
    instead of its raw API name. The sentence was localized but the interpolated
    name was not, so every locale — English included — read `Select crm_account
first`. The form renderer passes a new `dependsOnLabels` widget prop (the
    lookup-side counterpart of `emptyHint`, which it already resolves to labels
    for the fixed-option widgets); a name the host does not cover still falls
    back to itself.
  - The page-header overflow trigger's `More actions` accessible name now reads
    `detail.moreActions`, the same key `action:menu`'s own overflow trigger uses,
    so the two cannot diverge per locale.
  - The activity-feed reaction button's `Add reaction` accessible name is now a
    bundle key (`detail.addReaction`, added to all ten packs).
  - The "check the highlighted fields" toast joins field names with a per-locale
    separator (`validation.formInvalidJoiner`) instead of a hardcoded `、`
    (U+3001) — right for zh/ja by accident, wrong in English and every Latin
    locale. Latin packs use `, `, CJK `、`, Arabic `، `.
  - The Spanish `validation.required` / `validation.unique` templates gained
    their own masculine head noun (`El campo {{field}} es obligatorio`) so the
    adjective agrees for feminine field labels too — `Cuenta es obligatorio` was
    ungrammatical.

- bbbde12: Behavior change — **an authored display `type` can NARROW inline editability, but never WIDEN it** (objectui#3355).

  Both detail-surface editability gates (`HeaderHighlight`, the `record:highlights` strip; `DetailSection`, the details body) used to resolve ONE effective type with display precedence — `viewFieldType || objectFieldType`. An authored non-computed `type` therefore ERASED the object's `formula` / `summary` / `rollup` / `auto_number` declaration from the gate's view, and a machine-owned column became inline-editable.

  The gate now reads the two types separately and takes their UNION: a field is non-editable if the authored entry type **or** the object field's type is computed. Renderer/editor selection keeps the old precedence, so nothing about the display changes — only who may write.

  What flips:

  - `{ name: 'supply_share', type: 'number' }` authored over an object field declared `rollup` (or `formula` / `summary` / `auto_number`) — a display override written to fix formatting — no longer offers a pencil / double-click editor. This is the shipped configuration behind objectstack-ai/objectstack#5077: a hook-maintained rollup was overwritten by hand from the header strip and stayed corrupted until an unrelated child-row touch re-fired it (downstream yinlianghui/hotcrm-heimao#61).
  - Narrowing is unchanged: an authored `type: 'formula'` still locks a plain object column.
  - Fields with no authored computed type over a plain object column stay editable, and the entry-level `readonly` declaration from objectui#3356 is still honored.

  The object schema is authoritative about what is machine-computed; a presentation override has no business granting write access. The rule now lives in ONE shared helper, `isComputedFieldType` in `fieldEnrichment.ts` — beside `enrichDetailField`, the module both hosts already share — with the computed-type set moved there too (still re-exported as `TEXTUAL_REF_FALLBACK_TYPES`), so the strip and the body cannot drift apart again.

- 5a24ad9: Localize `RecordDetailDrawer`'s drag-resize handle (objectstack#5733)

  `packages/plugin-detail/src/RecordDetailDrawer.tsx` carried a byte-identical twin
  of the literal objectstack#5506 removed from `NavigationOverlay`: a
  `role="separator"` drag handle on the drawer's left edge with a hardcoded
  `aria-label="Resize drawer"`. #5506's sweep fenced on `packages/components`, so
  this second copy survived it.

  The handle has no visible label, so that string IS the control as far as a
  screen reader is concerned — a zh/ja/de session got one English announcement in
  an otherwise localized drawer. It is not a dormant branch either: `resizable`
  defaults to `true`, and the drawer is what plugin-kanban / plugin-calendar /
  plugin-gantt open on row, card and event click.

  It now reads `t('common.resizeDrawer')` — deliberately the SAME key #5506 gave
  the other handle (already present in all ten locale packs) rather than a new
  `detail.resizeDrawer` twin, so one control rendered from two packages cannot end
  up with two translations that drift apart.

  `common.resizeDrawer` is also added to `DETAIL_DEFAULT_TRANSLATIONS`, the map
  `createSafeTranslation` falls back to when no `I18nProvider` is mounted. Without
  that entry the name would degrade to the raw key for every provider-less host —
  which is the regression the accompanying no-provider test pins.

- 23018cc: `record:highlights` now honours a `readonly: true` on an authored field entry, so a header chip for a platform-owned column no longer offers inline edit. `HeaderHighlight`'s editability gate already consulted `field.readonly`, but the renderer rebuilt each entry from a fixed `{name,label,icon,type}` list and dropped `readonly` one layer before that check, so the gate could never fire from authored metadata — a hook-maintained rollup or approval-written grade could be overwritten by hand from the detail-page header strip and stayed wrong until an unrelated write re-fired the computation. `readonly` is now a declared key on `HighlightField` and on the `RecordHighlightsComponentProps.fields[]` entry union, mirroring `DetailViewField.readonly` (objectstack#5077).
- 58a00f0: Give `InlineCreateRelated`'s card-header close button an accessible name (objectui#3411 — the neighbouring defect found while implementing #3381/PR #3410, in the same file and left outside that PR's scope fence as a different class).

  The button is icon-only: its sole child was a lucide `X`, with no text, `aria-label`, `aria-labelledby` or `title`. lucide-react excludes childless, a11y-prop-less icons from the accessibility tree (it defaults them to `aria-hidden="true"`), so the button had no name source at all and its computed accessible name was the empty string — a screen reader announced a nameless "button". Unlike the placeholder case in #3381 there was no browser-side fallback to soften it: the name was empty in every implementation. WCAG 4.1.2 / 2.4.6.

  The fix is `aria-label="Close"` on the button, plus an explicit `aria-hidden="true"` on the icon so the intent is local rather than inherited from the icon library's default. `aria-label` rather than #3381's visually hidden `<label>` because this control has no visible copy for a label to stay in step with — the drift that ruling guarded against cannot arise here — and it matches the shape the repo's other close buttons already use (shadcn's dialog/sheet, `DashboardEditor`).

  No props, spec or visible-copy change; the component's rendering is otherwise identical.

- 53811d1: Associate the label with its control at the two form surfaces where the two were never programmatically connected (objectui#3341 — found while implementing #3299/PR #3340, and deliberately left out of that PR's scope fence as a different class of defect).

  `aria-required` reaching the control (#3299) only fixes the required _state_; at these two sites the control's accessible _name_ was still wrong, because the label pointed at nothing:

  - `@object-ui/plugin-detail` — `InlineCreateRelated`'s create-tab fields rendered a `<label>` with no `htmlFor` beside an `<Input>` with no `id`, and the two were siblings rather than wrapper/child. The field label was unreachable for assistive tech, and clicking the label did not focus the input. The ids are namespaced with `React.useId`, because `field.name` alone is unique only within one instance and a detail page mounts one of these per related list.
  - `@object-ui/components` — the custom `ActionParamDialog`'s `select` branch rendered `<Label htmlFor={param.name}>` but never put the matching `id` on its Radix `SelectTrigger`, so the reference dangled. The textarea / number / date / text branches already set `id={param.name}`; select was the only one that did not.

  `SelectTrigger` renders a `<button role="combobox">`, and `button` is a labelable element, so the plain `htmlFor`/`id` pair is the correct association there — no `aria-labelledby` required. No spec change and no widget-props contract change.

- b17ce4c: Give `InlineCreateRelated`'s "Link Existing" search box a real accessible name (objectui#3381 — the neighbouring defect found while implementing #3341/PR #3380, and left out of that PR's scope fence as a different class).

  The box carried a `placeholder` and nothing else: no `<label>`, no `aria-label`, no `aria-labelledby`. Its accessible name therefore fell through to the placeholder, which is the last resort in HTML-AAM and fails in two ways — the name a browser derives from it is the one thing that disappears the moment the user types, and the fallback is not implemented uniformly (`dom-accessibility-api` has no placeholder step at all, so under test the control computed to the empty string while a browser would have said "Search Contact…").

  The fix is a visually hidden `<label htmlFor>` pointing at a `React.useId`-namespaced input id — the same shape #3341 left on the create tab, rather than an `aria-label`, so the accessible name stays a real label element instead of a detached string that can drift from the visible copy. The label text and the placeholder are now derived from one expression (the placeholder only adds the ellipsis), and the id uses a hyphenated `link-search` segment so it cannot collide with a create-tab field literally named `search`. The decorative magnifier is explicitly `aria-hidden` — lucide already defaults childless icons to that, but spelling it out keeps the intent local and independent of the icon library's defaults.

  No props, spec or rendered-copy change: the placeholder string is byte-identical to before.

- c7fba27: `field:permission-facet-link` now registers through `withFieldCarrier` — the
  repo's only raw `field:` registration bypassed the single-metadata-carrier seam
  (objectui#3233), so under the SDUI path (`SchemaRenderer` passes `schema`,
  never `field`) the widget read `field === undefined` and silently rendered an
  anonymous facet summary (`field?.name` empty, no facet branch selected). The
  form and inline-edit hosts were unaffected — they pass `field` directly, which
  the carrier forwards unchanged. Fixes objectui#3307.
- 12bf669: The record discussion panel now says "loading" while it is loading, instead of
  "No comments yet" (objectui#3209).

  FROM: opening any record page showed the discussion/chatter panel asserting
  `No comments yet` for the whole first leg of the page, then contradicting
  itself when the comments appeared. TO: the panel shows the loading row until
  the feed has actually answered, and only then commits to "this record has no
  comments".

  objectui#3205 gave `RecordActivityTimeline` the render branch that prefers a
  loading row over the empty copy, and `RecordChatterPanel` already forwarded
  `loading` to it in both positions — but on the chatter chain **nothing
  produced the signal**, so that branch could never fire. `record:activity`
  computes its own flag and was visibly fixed by #3205; chatter was not. The
  four wiring points are one chain and are all closed here, because any one of
  them left open still ships the empty copy to some user:

  - `RecordDetailView` — the host that OWNS the feed fetch — now derives a
    `feedLoading` flag from its two reads (`sys_comment` + `sys_activity`);
  - `<DiscussionContextProvider loading={feedLoading}>` publishes it (the field
    was already declared on `DiscussionContextValue`, and already read by
    `record:activity`);
  - the auto-appended `<RecordChatterPanel loading={feedLoading}>` — the panel
    authored pages get when they place no discussion slot — receives it
    directly;
  - the `record:chatter` / `record:discussion` renderer forwards
    `loading={discussion?.loading}`, so a hand-placed block is on the same
    chain as the synthesized one.

  The two reads run in parallel, so the flag closes over **both**: it clears on
  `Promise.allSettled`, and a REJECTED read counts as an answer. A deployment
  without the audit plugin 404s `sys_activity` and an object with
  `enable.feeds: false` 403s `sys_comment`; neither may pin the panel in a
  permanent spinner, which would be a worse bug than the one being fixed. The
  flag is keyed by `object:recordId` rather than being a plain boolean, so the
  first render of a record already reads as loading (no one-frame flash of the
  empty state) and navigating between records cannot show the previous record's
  settled answer.

  No tolerance was added at the consumer. The timeline still does not guess that
  "no items yet and just mounted" means loading — that guess is wrong the moment
  a record genuinely has no comments, and the signal belongs to whoever owns the
  fetch. Same shape as objectui#3165 / #3205: divergence converges at the
  producer.

- Updated dependencies [b71fc92]
- Updated dependencies [65516ba]
- Updated dependencies [94c5b7c]
- Updated dependencies [ca0fa8f]
- Updated dependencies [3889ffb]
- Updated dependencies [7e2406a]
- Updated dependencies [4eeb932]
- Updated dependencies [5c856ec]
- Updated dependencies [68b6a28]
- Updated dependencies [0554e88]
- Updated dependencies [28b2e65]
- Updated dependencies [825bbe3]
- Updated dependencies [6195841]
- Updated dependencies [5dd0127]
- Updated dependencies [a415684]
- Updated dependencies [5af2852]
- Updated dependencies [a6ec93d]
- Updated dependencies [c7ed4c3]
- Updated dependencies [2409e1d]
- Updated dependencies [789fe3e]
  - @object-ui/i18n@17.3.0

## 17.2.0

### Minor Changes

- a889e31: A record's approval band now shows the quorum / per-group tally the server already computes.

  The showcase's `showcase_committee_quorum` node declares `behavior: 'quorum'` with
  `minApprovals: 2` over three approvers, and even ships a pre-rendered
  `"Committee Sign-off (2 of 3)"` label; `showcase_expense_signoff` declares
  `per_group` (会签) with named manager / finance groups. On the business record
  the approval band rendered none of it — the lock badge, the recall button and
  the approve/reject actions were all correct, but a two-of-three committee step
  looked exactly like a one-approver step. An approver could not see whether their
  own click finalized the node or was one of three, which is the single fact a
  quorum node exists to express (objectstack#4478).

  Nothing was wrong on the wire, and nothing here papers over the server. The
  framework computes `decision_progress` — `{ behavior, got, need, groups? }`,
  derived from the node's own `node_config_json` snapshot, so the count a client
  shows is the count the engine will enforce. **It attaches that block in
  `getRequest` only**: `listRequests` deliberately skips it, because the
  `sys_approval_action` tally it costs is per row and a list read may return
  hundreds. The record header's `useRecordApprovals` reads
  `GET /approvals/requests?object=…&recordId=…` — the list route — so the
  enrichment was never in the payload it had. The hook now follows up with one
  single read for the ONE pending row and folds the result onto it; a failed or
  mismatched follow-up leaves the row exactly as the list sent it, so a display-only
  enrichment can never take the approval panel down and no tally is ever invented.

  `InlineEditProvider` carries the block through as `approvalProgress`, and the
  DetailView approval band renders it beside the existing badge: a labelled
  `role="progressbar"` with one tick per required approval for `quorum` /
  `unanimous`, and for `per_group` a chip per group marking which have signed
  (`finance 1/1` ✓, `manager 0/1`). Group names come from the flow author's own
  config, so they need no locale strings; the three new label keys are added to all
  ten packs. `first_response` nodes carry no `decision_progress` and are unchanged —
  one decision is the whole step there, and a "1 of 1" bar would be noise.

  Scored `minor` rather than `patch`: this is new observable rendering plus a new
  public `approvalProgress` prop / `ApprovalProgress` type on `@object-ui/react`,
  not a behavior correction inside an existing surface.

- 4a51e77: Stop declaring 14 symbols across ten packages under names `@objectstack/spec`
  owns (objectui#3161, objectstack#4115 batch 7 — the long tail, one or two
  entries per package). All ten packages leave the ledger, which drops from 17
  collisions across 11 packages to 3 across 1.

  **Renamed exports** — in every case the spec exports the same name for a
  _different_ thing, so the old name was a mis-description rather than a dialect:

  | package                    | was                                | now                                                  | what the spec's same-named export is                                                                                                       |
  | :------------------------- | :--------------------------------- | :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
  | `@object-ui/fields`        | `FieldWidgetProps`                 | `FieldWidgetComponentProps`                          | the DECLARED field-widget plugin props contract (a zod object; `field.type` is the `FieldType` enum, `readonly`/`required` carry defaults) |
  | `@object-ui/layout`        | `PageHeaderProps`                  | `PageHeaderComponentProps`                           | the authored `page:header` node — a zod schema of `title`, `subtitle`, an icon NAME, `breadcrumb`, `actions: string[]`                     |
  | `@object-ui/layout`        | `Page`                             | `PageNodeRenderer`                                   | the authored page metadata DOCUMENT (`name`, `label`, `type`, `regions`)                                                                   |
  | `@object-ui/plugin-detail` | `ObjectFieldLike`                  | `ObjectDefFieldLike`                                 | the i18n duck type `translateObject` walks (`help`/`description`, plus `[key: string]: any`)                                               |
  | `@object-ui/plugin-grid`   | `ColumnSummaryConfig`              | `ColumnSummarySetting`                               | the OBJECT form of `ListColumn.summary` **only** — the local one was the whole union, shorthand included                                   |
  | `@object-ui/plugin-grid`   | `isMultiValueField`                | `hasMultiValueShape`                                 | the spec's classifier, which requires a def with a `type`; the local one is called with `undefined`                                        |
  | `@object-ui/collaboration` | `RealtimeConfig`                   | `RealtimeSubscriptionConfig`                         | the app's realtime DECLARATION (`enabled`, `transport`, `subscriptions[]`)                                                                 |
  | `@object-ui/plugin-charts` | `ChartConfig`                      | `ChartContainerConfig`                               | the authored chart document (`type`, `xAxis`, `series`, `showLegend`, …)                                                                   |
  | `@object-ui/plugin-form`   | `FormSection` / `FormSectionProps` | `FormSectionContainer` / `FormSectionContainerProps` | the authored form-section metadata (`name`, `pane`, `visibleWhen`, `fields`)                                                               |
  | `@object-ui/providers`     | `Theme`                            | `ThemePreference`                                    | a whole theme DOCUMENT (`name`, `label`, `colors`, `typography`)                                                                           |
  | `@object-ui/runner`        | `App` (default export)             | `RunnerApp`                                          | the authored application metadata type **and** the `App.create()` builder                                                                  |
  | `@object-ui/sdui-parser`   | `ValidationResult`                 | `ManifestValidationResult`                           | plugin-manifest validation (`{ valid, errors?, warnings? }`), exported from both `kernel` and `contracts`                                  |

  `ManifestValidationResult` follows the `<what was validated>Validation<Error|Result>`
  convention registered on objectstack#4115 (`@object-ui/core` took
  `SchemaNodeValidationResult` in batch 4). `PageHeaderComponentProps` deliberately
  reuses the name `@object-ui/app-shell` already chose for its own header props in
  batch 3, so one concept does not acquire two dialect names one package apart.

  **Now derived from the spec instead of hand-written:**

  - `@object-ui/fields` — `isFileIdToken` is re-exported from
    `@objectstack/spec/data`. The local copy was character-for-character identical
    to the spec's function while its comment said it "mirrors" it, so every
    behaviour test passed and only reference identity could tell the two apart.
    The regex is a wire decision: widening it server-side while a copy here kept
    the old bound would make every new id read as "not a reference", and the
    widget would submit the legacy inline blob to a backend expecting a reference.
  - `@object-ui/plugin-detail` — `FeedFilterMode` is re-exported from
    `@objectstack/spec/data`, in a file that already imported the sibling
    `FeedItemType` from the spec.
  - `@object-ui/plugin-grid` — the eleven-member aggregation union is now the
    spec's `ColumnSummary` enum, so the total `Record<ColumnSummaryType, string>`
    label map turns a member the spec adds into a compile error instead of a
    blank footer cell. `ColumnSummarySetting` is `NonNullable<ListColumn['summary']>`,
    i.e. whatever forms the spec itself accepts. `hasMultiValueShape` delegates to
    the spec's `isMultiValueField` rather than re-deriving it from
    `MULTI_OPTION_TYPES` / `MULTI_CAPABLE_TYPES`.
  - `@object-ui/providers` — `ThemePreference` is the spec's `ThemeMode` union
    plus the one legacy `'system'` spelling this provider still honours for stored
    preferences, read off the schema's own `_zod` carrier so the package takes no
    zod dependency.

  `@objectstack/spec` moves from `devDependencies` to `dependencies` in
  `@object-ui/fields` (it re-exports a runtime function) and `@object-ui/providers`
  (its public `.d.ts` now references the spec).

  Scored `minor`, not `major`, per this repo's fixed-group rule — objectui's major
  tracks `@objectstack`, so breaking changes of our own ship as minor with the
  semantics spelled out above (see AGENTS.md §版本号策略). A `major` here would carry
  all 39 packages of the fixed group to `18.0.0` and off objectstack's 17.x line.

- dd06bcd: `record:activity` fetches a feed instead of rendering a permanently empty one (objectui#3165).

  The block published eleven inputs — `types`, `filterMode`, `showFilterToggle`,
  `limit`, `showCompleted`, `unifiedTimeline`, `showCommentInput`,
  `enableMentions`, `enableReactions`, `enableThreading`,
  `showSubscriptionToggle` — every one of them a filter or an affordance over a
  feed that could not have content on any path. `RecordActivityRenderer` called
  `useRecordContext()`, discarded the result and rendered
  `<RecordActivityTimeline items={[]}>` with the empty array hard-coded; the
  timeline takes `items` as a prop and never fetched; no host supplied any
  (`buildDefaultPageSchema` emits `{ type: 'record:activity' }` with no props at
  all). Declared, published to `sdui.manifest.json`, inert at runtime —
  objectstack#4413's shape, three blocks over.

  **The feed now has three sources, in precedence order.** `items` on the node
  (the convention `record:history` uses for `entries`); a mounted
  `DiscussionContext`, which the console's record page fills with the merged
  `sys_comment` + `sys_activity` feed and the write handlers; otherwise a
  **self-fetch** of `sys_activity` scoped to the bound record
  (`{ object_name, record_id }`, newest first, `limit` rows per page, "Load more"
  re-reading a wider window). The third path is what makes the block
  drop-anywhere — hand-authored inside a `page:tabs`, with no host feeding it —
  and it mirrors the read `record:history` already had. Rows map to feed items
  exactly as the console's record page maps them, so both surfaces agree about
  what a row is.

  **The read-side inputs now filter.** `types` is an allow-list over feed item
  types (unrecognised entries ignored; an all-typo list is treated as unset
  rather than emptying the feed). `limit` is a page size and caps the scoped
  read. `showCompleted` (spec default `false`) hides completed activities.
  `unifiedTimeline: false` un-mixes field changes from the comment stream — the
  panel becomes a discussion feed and field changes stay in `record:history`.
  `filterMode` seeds which slice the dropdown opens on and falls back to `all`
  on an unrecognised value instead of leaving a `<Select>` matching nothing.

  **The write-side switches are wired to the host's handlers.**
  `showCommentInput`, `enableThreading`, `enableReactions` and `enableMentions`
  read `onAddComment` / `onAddReply` / `onToggleReaction` /
  `mentionSuggestions` off `DiscussionContext` — the same standing
  `record:discussion` has. With no host mounted the feed stays read-only and no
  composer is rendered, rather than showing one that silently drops what you
  type.

  **`showSubscriptionToggle` is recorded as a known gap, not quietly left
  looking configurable.** The bell needs a `RecordSubscription` value and
  somewhere to persist it, and the platform has no record-subscription object to
  read or write one from. Its input description now says `NOT IMPLEMENTED` (that
  text ships to `sdui.manifest.json`, so an author meets it before writing the
  prop), the docs repeat it, and a test pins it inert so the note has to be
  deleted the day a backend for it lands.

  `apps/console`'s record-reach probe (objectui#3149 layer 3a) asserted the old
  behaviour from its `NO_RECORD_REACH` ledger in both directions; that entry is
  deleted, and the probe now reports `record:activity` as responding to the bound
  record.

### Patch Changes

- 6be575c: A fetching activity feed says "loading", not "No activity recorded" (objectui#3205).

  `RecordActivityTimeline` declared a `loading` prop and destructured it straight
  into `_loading`, so nothing in the component ever read it. For the whole
  duration of a feed fetch the panel therefore rendered the empty state — "No
  activity recorded" — and then contradicted itself when the rows landed. The
  empty copy is a factual claim about the record; it may only be made once the
  fetch that would fill the feed has settled.

  The timeline now branches on `loading` **before** the empty branch and renders a
  spinner row (`role="status"`, `aria-live="polite"`) while the feed is in flight.
  `collapseWhenEmpty` does not suppress it: that flag is about the empty state
  ("collapse when there are no items"), and mid-fetch it is not yet known whether
  there are items.

  The guard is `loading && filtered.length === 0`, not `loading` alone — a refresh
  or a "Load more" round-trip keeps the rows already on screen instead of blanking
  them (that button carries its own spinner).

  No prop or signature changed: the fix is that the declared prop is now read.
  `record:activity` has computed a live `loading` since objectui#3165 (true during
  its self-fetch) and `RecordChatterPanel` already forwarded it in both positions,
  so the whole chain now shows a loading state end to end.

- Updated dependencies [a889e31]
- Updated dependencies [4b470b9]
  - @object-ui/i18n@17.2.0

## 17.1.0

### Minor Changes

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

- bac266c: fix(detail): a related list has one sorting semantics instead of two — #3106

  A related list carried two. Its own sort-button row (opt-in via `sortable`) went
  out as a server `$orderby` over the whole child collection; the `data-table` it
  embeds took `sortable`'s default of `true` and sorted the rows it was holding —
  which, in windowed mode, is **one page**.

  Turning `sortable` on put both in the same card, with nothing saying they meant
  different things. Leaving it off — the default — was worse: the page-local sort
  was then the _only_ one the user could reach, and it looked exactly like the
  list being sorted.

  The table's column headers now drive this list's sort in both modes, so there is
  one order behind them:

  - **Windowed**: the header sort becomes the server `$orderby` and resets to page
    one, the same path the buttons took.
  - **Client mode**: this list keeps sorting in memory, where its key is the label
    resolved through its own id → name map (#3096) — a key the embedded table
    cannot see, so its sort was the worse of the two even when both were possible.

  The button row survives only where there are no headers to click: a `list`
  (`data-list`) related list, or a caller-supplied `schema` whose contents we
  cannot assume. `sortable`'s documentation now says that is what it controls.

  Relational columns keep #3096's rule, moved to the header: no sort affordance
  while the sort is a server `$orderby` (the key would be the stored foreign-key
  id while the cell shows a name), live in client mode where the key is the label.

### Patch Changes

- fc0272a: fix(actions): apply the ADR-0066 D4 capability gate on every action surface (framework#3923)

  An action declaring `requiredPermissions` is supposed to be one declaration with
  two enforcement surfaces: 403 on the server, hidden button in the UI. The UI half
  only ever ran inside `ActionEngine.getActionsForLocation` — and the surfaces
  `record_header`, `record_more`, `list_item` and `list_toolbar` actually render on
  do not go through the engine. They filter their own action lists. So a button
  declaring a capability nobody holds rendered, live and clickable, on the record
  header, in every grid row menu, and on the list toolbar. For a `type: 'api'`
  action pointed at a self-authored endpoint, nothing else was checking either: the
  platform's action route (which is where the 403 comes from) never sees that
  request.

  `page:header`, `action:bar` (business _and_ `systemActions`) and the grid's
  `RowActionMenu` now apply the same gate, via a shared `useCapabilityGate()` so
  the surfaces cannot drift apart. The rule is the engine's, unchanged: hide unless
  the caller holds **all** declared capabilities; an empty held set is "holds
  nothing" and gates; **unknown** — no action runtime, no resolved capabilities —
  fails OPEN, because the server is the authority and hiding a permitted user's
  button on missing client data is the worse failure.

  The record surface was also feeding the gate nothing to work with.
  `RecordDetailView` mounts its own `<ActionProvider>`, which shadows the shell's
  for every action on that page, and seeded it with identity only — no
  `systemPermissions`. Since unknown fails open, that alone un-gated every
  `record_header` / `record_more` / `record_section` action on the one page those
  locations exist on. It now forwards the caller's resolved capabilities (and only
  once they have actually resolved, so a standalone embed without a
  `PermissionProvider` keeps failing open rather than hiding everything).

  `useRecordEditable`'s record-level explain probe went out on a bare
  `fetch(..., { credentials: 'include' })`. A bearer-token session carries its
  credential in the `Authorization` header, not a cookie, so the probe came back
  401 on a perfectly valid admin session and the verdict silently failed open —
  the hook was inert in exactly the deployments it was written for. It now rides
  the host's authenticated fetch (`SchemaRendererProvider`'s `apiFetch`), falling
  back to the global one for standalone embeds.

- c785740: fix(detail): record Attachments become their own tab (with count badge) and their copy is translated — objectstack#4358

  Two defects on `enable.files: true` record detail pages:

  1. **Buried placement.** `RecordDetailView` appended `RecordAttachmentsPanel`
     AFTER the schema-rendered page tree, whose synthesized default embeds
     `record:discussion` as the last main component — so the panel always
     landed below an ever-growing feed timeline, undiscoverable without
     scrolling to the very bottom, with no metadata knob to move it.

     `buildDefaultTabs` now emits a peer **Attachments** tab (a new
     `record:attachments` node rendered by an app-shell registration wrapping
     the existing panel via RecordContext) between Related and
     Activity/History. `PageTabsRenderer` derives the tab's count badge from a
     `sys_attachment` probe scoped to `(parent_object, parent_id)`, riding the
     same RelatedCountStore cache/invalidation bus as related-list badges — so
     uploads and deletes update the badge live. A `hideAttachments` synthesizer
     option suppresses the tab; RecordDetailView keeps its legacy bottom append
     only as the fallback for authored pages without the node
     (`hasExplicitAttachments`).

  2. **Untranslated copy.** The panel's eleven `detail.*` keys (`attachments`,
     `uploadAttachment`, `loadingAttachments`, `noAttachments`,
     `downloadAttachment`, `deleteAttachment`, and the five
     `attachment*Denied/Required` friendly errors) existed only as inline
     English `defaultValue`s — no locale bundle carried them, so non-English
     consoles always showed English. All ten locales now define them; the tab
     label rides the existing well-known-label dictionary (→ 附件 etc.).

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

- 2baa13f: fix(record): register the record:\* blocks under one key, prefixed once

  Eleven blocks in plugin-detail were registered as
  `register('record:x', …, { namespace: 'record' })` — an already-prefixed name
  handed to a registry that prefixes it again. Each landed at
  `record:record:x`, and the key authors actually resolved, `record:x`, was the
  un-namespaced _fallback_ rather than the intended registration. The registry
  carried 23 keys for 12 components.

  Nothing failed, which is why it survived: `getPublicConfigs()` rewrites `type`
  to the curated tag, so the doubled name never reached the contract, the
  manifest, or the JSX surface. It was visible only when enumerating the registry
  directly — which is what objectui#3013's reverse check does.

  Registering the bare name is what makes `namespace` correct, and
  `skipFallback: true` is what keeps the fallback from claiming that bare name
  globally. Without it these would take over `details`, `path`, `history`,
  `alert` … as top-level tags; `alert` is the live case, owned by `ui:`. Every
  block stays reachable exactly as `record:<name>`, and 23 keys become 12.

  `record:line_items` needed no change — it was the one already registered this
  way, which is what made objectui#3006's near-miss possible in the first place.

  Two console assertions hold the shape: no key carries a doubled prefix, and no
  `record:*` block owns the bare spelling of its own name.

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

- Updated dependencies [1cf0de7]
- Updated dependencies [752e18f]
- Updated dependencies [c785740]
- Updated dependencies [d61efd1]
- Updated dependencies [9eb932b]
- Updated dependencies [3cb9646]
- Updated dependencies [d21794c]
- Updated dependencies [b5b97e2]
- Updated dependencies [2d5d594]
- Updated dependencies [f8a95e5]
  - @object-ui/i18n@17.1.0

## 17.0.0

### Minor Changes

- 952b978: fix(detail): the approval band honors the node's `lockRecord` instead of assuming every approval locks (#2902)

  A record detail page treated "a pending approval request exists" as "this
  record is locked". An approval node declares `lockRecord` (default `true`), and
  on `lockRecord: false` the server keeps accepting writes for the whole time
  that node waits — so the console was asserting a lock the backend did not
  enforce.

  The label was the smaller half of it. The same conflated signal fed `canEdit`,
  so the record-level inline-edit session was suppressed too: no pencils,
  `enter()` a no-op. On a single-approver step — a department head or plant
  manager, exactly the case `lockRecord: false` exists for, where the approver is
  meant to fill in the missing detail before deciding — the capability was
  unreachable from the UI. And a flow chaining nodes with different policies drew
  one identical band for "edit freely" and "the server will reject your save with
  `RECORD_LOCKED`", so the two states were indistinguishable until Save failed.

  Approval state is now two signals:

  - **`approvalPending`** — an approval is running. Drives the band and the recall
    button, both meaningful whether or not the record is editable.
  - **`locked`** — that approval also forbids edits, from the pending node's
    `lock_record` (framework#3814, read off the same `node_config_json` snapshot
    the server's record-lock hook reads).

  The band renders two states: amber lock + "Locked for approval", or sky clock +
  "In approval · editable", each with its own tooltip. Recall moved out of the
  locked branch — an editable pending approval is just as recallable. Inline
  editing stays live in the editable state.

  `InlineEditProvider` takes a new optional `approvalPending` prop, defaulting to
  `locked`, so a host that threads only `locked` renders exactly as before. The
  record's `approval_status` field remains the fallback for backends with no
  approvals API; it carries no node granularity, so it still reads as locked — as
  does a pending request from a backend too old to report the policy.

  New `detail.approvalPendingEditable` / `detail.approvalPendingTooltip` keys are
  translated in all ten locales.

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

### Patch Changes

- 7b21891: fix(action): honor the spec `disabled` predicate on every action-rendering surface (#1885 follow-through)

  The spec Action field is `disabled` (boolean | CEL — disabled when TRUE); the
  schema has no `enabled` key. #1885 wired it in `action:button` only. Browser
  dogfooding against the showcase found FIVE more surfaces where a spec-authored
  `disabled` silently did nothing:

  - **components** — the `action:group` leaves (inline + dropdown), `action:icon`
    and `action:menu` still read the legacy non-spec `enabled`. They now consume
    `disabled` as the primary control (evaluated in the same scope as `visible`),
    with `enabled` kept as a deprecated fallback.
  - **app-shell** — `DeclaredActionsBar` (server-declared action bar) read
    neither; it gains `disabled` (no legacy fallback: declared actions are
    spec-shaped and never carried `enabled`).
  - **plugin-detail** — `record:quick_actions` HAD a `disabled` implementation,
    but its `typeof === 'string'` split dropped the `{dialect:'cel', source}`
    envelope the server compiles authored CEL into (#2661 routes envelopes to the
    canonical formula engine), so the predicate never fired on real metadata. It
    now feeds `toPredicateInput`'s result to `useCondition` whole, like every
    other surface.

  Pinned by new `DropdownActionItem` tests (disabled-when-TRUE, false-stays-
  clickable, disabled-wins-over-enabled, boolean literal) and browser-verified
  end-to-end against the showcase `showcase_archive_task` specimen: greyed on an
  in-progress task, clickable on a done one (with `visible` hiding Mark Done on
  the same screen — the hide-vs-grey contrast).

- faad45e: fix(fields): render `image` fields consistently and add click-to-zoom (#2836)

  An `image` field rendered differently — and wrongly — on three surfaces:

  - **Edit form showed broken thumbnails.** A record read back its `image` value
    as a bare `sys_file` id (the reference form), but `readFileValue` returned an
    id with no URL — the comment assumed the read path expands it, which the
    edit-form data path does not. The result was `<img src="">`. `file-value` now
    derives the stable download URL (`/api/v1/storage/files/:id`, which
    302-redirects to a signed URL and works directly as `<img src>`) for a bare
    id or an id-only object, so every widget and cell renderer resolves one.
  - **Inline edit leaked the raw storage URL.** `InlineFieldInput` had no branch
    for file-backed types and fell through to a plain text input showing
    `/api/v1/storage/files/…`. It now renders the same upload widgets the form
    uses (`image`/`avatar`/`signature`/`file`/`video`/`audio`).
  - **Hard-coded English.** `ImageField`'s upload/crop/remove/alt strings now go
    through `t('fields.image.*')` (en + zh added).

  Also adds an `ImageLightbox` — click a read-only thumbnail (detail or list cell)
  to open a full-screen preview; multiple images get prev/next navigation, a
  position counter and arrow-key support, a single image just the image. In a
  grid cell the click is `stopPropagation`-guarded so enlarging doesn't also open
  the row.

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

## 16.1.0

### Minor Changes

- faebac3: Related lists paginate by default and fetch server-side windows (#2711).

  `record:related_list` now applies the spec default `limit` of 5 when a node
  doesn't declare one, so detail-page related lists render pages with
  Previous/Next controls instead of dumping every child row. On the auto-fetch
  path RelatedList requests one page at a time (`$top`/`$skip`), reads the
  collection size from `QueryResult.total` (`hasMore` fallback), sends user
  column sorts as a server `$orderby`, and seeds the initial order from the
  node's `sort` prop (new `defaultSort` prop on RelatedList). Caller-provided
  `data` keeps the historical client-side slicing. Behavior change: lists that
  previously rendered all rows now show 5 per page — declare a larger `limit`
  on the `record:related_list` node to widen the window.

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

- 53513a4: fix(plugin-detail): #2688 — record surfaces without a caller title no longer floor to `Record #<id>`, and the meta footer never prints a raw audit user id

  - `DetailView` header: after every declared-identity step misses and no
    `schema.title` was provided, probe name-ish record keys (`name`, `title`,
    `*_name`, …) before falling to the `Record #<id>` floor. Fixes records whose
    name lives in a field the type-aware derivation deliberately skips (e.g. an
    `autonumber` `name`) opened from surfaces like the gantt row drawer.
  - `RecordMetaFooter`: `created_by` / `updated_by` are always user references on
    ObjectStack — when the fetched schema omits the audit system fields, default
    the reference target to `sys_user` so the footer renders a resolved user name
    (or the muted placeholder) instead of the raw opaque id.

- f329ec5: chore(lint): clear the baseline lint errors in plugin-detail (objectui#2713 Wave 3)

  Wave 3 of the #2713 lint-gate restoration. `@object-ui/plugin-detail` was red at
  baseline on `main`; cleared every **error** (no behavior change; warnings out of
  scope). All nine are `react-hooks` errors — the record renderers called hooks
  after conditional early returns, which is a real fragility (React throws when the
  guard toggles between renders), so each is restructured so hooks run
  unconditionally while the rendered output stays identical:

  - **`record-reference-rail`** — hoisted `useState` above the empty-entries early
    return (no dependency on it).
  - **`record-related-list`** — moved the `!objectName` placeholder return below
    the four hooks (`usePermissions` / `useFieldPermissions` / `useRelatedRecordActions`
    / `useMemo`); those hooks are pure context/memo reads, safe with an empty
    object name. The object-level read gate ordering is unchanged (covered by
    `RecordRelatedListRenderer.readgate.test`).
  - **`record-quick-actions`** — moved the `requiredPermissions` gate below
    `useActionEngine` (a pure `useContext`/`useMemo` hook).
  - **`record-highlights`** — `useId` + `useRegisterHighlightFields` now run
    unconditionally; the permission gate is enforced after them. Because
    `useRegisterHighlightFields` has a register effect, it is passed `[]` when the
    gate denies — equivalent to not registering, so no body field is ever hidden
    for highlights that aren't rendered.
  - **`RelatedList`** `SectionIcon` (`react-hooks/static-components`) —
    `resolveIconComponent` is a stable registry lookup, not a component created
    during render → justified scoped disable.

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

- 3b2e4d9: fix(list): route remaining system-field groupings through the shared classifier

  Follow-up to the `owner_id` default-column fix: consolidate the display-oriented
  system-field exclusions onto the shared `isSystemManagedField` /
  `SYSTEM_MANAGED_FIELD_NAMES` (from `@object-ui/types`) so the framework-injected
  `owner_id` is treated consistently across the grid, record picker, and detail
  drawer.

  - `ObjectGrid` record-detail drawer: the business-fields vs. muted meta-section
    split now uses the shared classifier, so `owner_id` (and other injected system
    fields) land in the meta section instead of the business body.
  - `deriveLookupColumns` (record picker): drops its local name set for the shared
    classifier — now flag-aware (`field.system`), not just name-based.
  - `RecordDetailDrawer`: its default `systemFields` set is derived from the shared
    `SYSTEM_MANAGED_FIELD_NAMES`; the `systemFields` prop override is preserved.

  `deriveRelatedLists`' narrow "audit FK on every object" set and plugin-detail's
  inline-edit "never editable" set are intentionally left distinct — different
  semantics (the latter deliberately keeps `owner_id` editable).

- Updated dependencies [0318118]
- Updated dependencies [af1b0db]
- Updated dependencies [1100a8b]
- Updated dependencies [7abe4cd]
- Updated dependencies [ebe6494]
- Updated dependencies [f80aaf2]
- Updated dependencies [29c6040]
  - @object-ui/i18n@16.1.0

## 16.0.0

### Minor Changes

- 5534535: feat(grid): built-in row Edit/Delete honor per-record CEL predicates (#2614)

  The object's `userActions.edit` / `userActions.delete` now also accept an
  object form `{ enabled?, visibleWhen?, disabledWhen? }`. The predicates are
  evaluated per row on the canonical CEL engine (`useRowPredicate`, the same
  machinery custom row actions use): `visibleWhen` false → the built-in
  Edit/Delete item is not rendered for that row (fail-closed); `disabledWhen`
  true → rendered disabled (fail-soft). Wired through ObjectGrid's
  RowActionMenu and the data-table's row overflow menu (the related-list
  path), with the app-shell `crudAffordances` mirror kept in lockstep.
  Omitting the predicates (or using plain booleans) keeps today's behavior
  bit-for-bit; declared predicates evaluate only when a row's menu opens, so
  grid rendering cost is unchanged.

### Patch Changes

- 59d4fa9: fix(detail): show the "Locked for approval" band on request-tracked backends (objectui#2618)

  The DetailView approval-lock band keyed only off the record's own
  `approval_status` field, so it never rendered on backends that track the lock
  via an open approval request and never materialize that field — even though
  the lock was real (writes rejected with `RECORD_LOCKED`). The record-level
  `InlineEditContext` now carries the host's `locked`/`lockedReason` signal
  (the same dual-source `approvalLocked` that already gates `canEdit` in
  `RecordDetailView`), and the band renders from it while keeping `DetailView`
  DataSource-agnostic. Also backfills the approval-lock strings into the detail
  translation defaults so a bare DetailView shows the label, not the raw i18n key.

- 9d4a429: fix(form+detail): keep single-file children as inline grids; drop non-spec `attachment` handling

  Two follow-ups to the upload-in-grid work (objectui#2360):

  - **#2654** — Now that `file`/`image`/`avatar` fields render a compact upload
    cell in the line-item grid, a child object with a _single_ such field no
    longer flips the smart `inlineEdit` default to a per-row form. `resolveInlineMode`
    splits the old `FORM_ONLY_TYPES`: truly form-only types (textarea / richtext /
    html / markdown / json / location / address) still tip to `form` on their own,
    while file-family types only tip when several rich fields pile up
    (`RICH_FIELD_FORM_THRESHOLD`, default 2). An explicit `inlineEdit` always wins.

  - **#2655** — `attachment` is not a `@objectstack/spec` field type (the spec
    media types are file/image/avatar/video/audio), so the renderer no longer
    models it: removed from `fieldTypeToColumnType`, the inline-mode heuristic, and
    `RelatedList`'s auto-column `SKIP_TYPES`. Contract-first cleanup — the renderer
    stops fossilizing a phantom type (AGENTS.md #0.1).

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
  - @object-ui/permissions@16.0.0

## 15.0.0

### Patch Changes

- bb22788: Inline-edit field enrichment passes `min`/`max`/`step` through to the numeric
  editors (objectui#2572 live dogfood find). Both `DetailSection` and
  `HeaderHighlight` copy an explicit whitelist of objectSchema keys into the
  enriched field they hand `InlineFieldInput`; the numeric range/step
  constraints were missing from that list, so a currency field declaring
  `min: 0` rendered a number input with no range affordance. Adds a live e2e
  spec (`e2e/live/inline-edit-polish-2572.spec.ts`) driving the whole #2572
  polish set against the real showcase stack.
  - @object-ui/types@15.0.0
  - @object-ui/core@15.0.0
  - @object-ui/i18n@15.0.0
  - @object-ui/react@15.0.0
  - @object-ui/components@15.0.0
  - @object-ui/fields@15.0.0
  - @object-ui/permissions@15.0.0

## 14.1.0

### Minor Changes

- 471c5d3: feat(detail): editable record highlights on the shared inline-edit draft (objectui#2407 P2)

  The highlights strip is now editable in place and shares ONE draft + ONE atomic
  Save with the details body (building on the P1 `InlineEditContext` / `#2529`
  `InlineFieldInput`).

  - **`HeaderHighlight`** consumes `useInlineEdit()`: hovering a highlight shows a
    pencil and double-click enters the shared record edit session; each editable
    highlight renders the same `<InlineFieldInput>` the body uses (value =
    `draft[name] ?? data[name]`, write via `setField`). Computed
    (`formula`/`summary`/`rollup`/`auto_number`), `readonly`, and system fields
    expose no editor. Empty highlights are kept while editing so they can be
    filled. Compact-layout UX: an actively-edited column widens and renders the
    editor full-width (Salesforce-style expand-on-edit).
  - **`RecordDetailView`** (app-shell) hosts ONE `<InlineEditProvider>` (with the
    object-lifecycle `canEdit` gate) spanning both `record:highlights` and
    `record:details`, plus the single record-level `<InlineEditSaveBar>` — so a
    highlight edit and a body edit commit together in ONE
    `update(obj, id, draft, { ifMatch })`.
  - **`record:details`** drops its P1-local provider/save bar (it would otherwise
    split the draft from the highlights) and just consumes the shared context;
    **`record:highlights`** threads the DataSource through for lookup/user editors.

  Guardrails preserved: computed/readonly/system highlights non-editable; `canEdit`
  gate; OCC (`ifMatch` + `ConcurrentUpdateDialog`); only user-edited keys are sent.

- 579b24d: feat(fields+form+detail): file/image uploads in inline line-item grids (#2360)

  `Field.file` in a master-detail inline grid previously degraded to a plain text
  input (no `input[type=file]` on the page → no way to upload from the grid), and
  auto-derived subform / related-list columns silently dropped file fields.

  - **fields**: new `FileCell` — a compact upload control for grid cells (upload
    button + removable chips, image thumbnails), sharing the `UploadProvider`
    pipeline with the full-size `FileField` via an extracted `useFileUploads`
    hook. `GridField` supports `type: 'file'` columns (with `accept` /
    `multiple`), renders file names in list/readonly modes, and no longer falls
    back to a text `<Input>` for file columns.
  - **plugin-form**: `deriveColumns` / `hydrateColumns` no longer exclude
    `file`/`image`/`avatar` fields — they map to `file` columns and carry the
    field's `multiple` + `accept` (image fields default to `['image/*']`).
  - **plugin-detail**: auto-derived related-list columns no longer skip
    `file`/`image` fields — they render through the existing FileCellRenderer /
    ImageCellRenderer (file-name chip / thumbnail).

- 5b52624: feat(detail): record-level inline edit — shared `InlineEditContext` + one atomic Save (objectui#2407 P1)

  Lift the inline-edit session out of `DetailView`'s private state into a
  record-level, shared context so a record page's surfaces can share ONE draft and
  commit it in ONE atomic, cross-field-validated write (replacing the per-field
  save loop).

  - **`InlineEditContext` / `InlineEditProvider` / `useInlineEdit`** (@object-ui/react)
    — pure UI state (`editing`, `canEdit`, `draft`, `autoFocusField`, `saving`,
    `error` + `enter` / `setField` / `cancel` / `reset`). A _separate_ context from
    `RecordContext` (mirrors `HighlightFieldsContext`) so per-keystroke draft churn
    doesn't re-render other `record:*` consumers.
  - **`<InlineEditSaveBar>`** (@object-ui/plugin-detail) — the record-level sticky
    Save/Cancel bar. Commits the whole draft in ONE
    `dataSource.update(obj, id, draft, { ifMatch: data.updated_at })` → `refresh()`;
    a `409 CONCURRENT_UPDATE` reuses `<ConcurrentUpdateDialog>` (reload / overwrite).
    A callback mode (`onFieldSave`) preserves the drawer's per-field persistence
    contract with plugin-gantt/calendar/kanban.
  - **`DetailView`** now consumes `useInlineEdit()` instead of owning inline-edit
    state; its header/inline Save-Cancel bars and per-field batch-save are removed
    (the approval-lock badge stays). Rendered without a provider it is simply
    read-only.
  - **`record:details`** and **`RecordDetailDrawer`** each wrap their `DetailView`
    in an `<InlineEditProvider>` + `<InlineEditSaveBar>`. The object-lifecycle /
    permission gate flows through `canEdit`; computed / readonly / system fields
    and the OCC path are unchanged.

  Guardrails preserved: computed (`formula`/`summary`/`rollup`/`auto_number`) +
  `readonly` + system fields expose no editor; `canEdit` gate; OCC (`ifMatch` +
  `ConcurrentUpdateDialog`); the atomic partial update carries only user-edited
  keys (never computed/read-only). Editable highlights ride on top of this in P2.

### Patch Changes

- 2efa9fd: Detail-page UX follow-ups from the ADR-0085 PR4 real-backend browser pass (framework#2548):

  - **Highlight strip no longer repeats the record title.** A declared
    `highlightFields` list containing the title field rendered it as the first
    chip — truncated — directly under the identical page H1. `deriveHighlightFields`
    now resolves the title (`primaryField` / `nameField` / deprecated
    `displayNameField`, else the conventional display-field names) via the new
    exported `resolveTitleField` and filters it from declared lists before the
    4-chip cap, matching what the heuristic branch always did. app-shell's
    `RecordDetailView` synthParts (which pre-computes the list and bypasses the
    derivation) applies the same filter.
  - **Per-field currency reaches the renderers.** The spec channel
    (`currencyConfig.defaultCurrency`) was dropped by the highlight-strip and
    detail-section field enrichment, so a spec-authored currency field could
    never show its symbol ("25,000,000" instead of "$25,000,000");
    `resolveFieldCurrency` reads it second after the designer-only bare
    `currency` key.
  - **app-shell approvals fetches send the Bearer token.** The header badge
    poll, home-inbox count, and record-page approvals panel were cookie-only
    (new shared `bearerAuthHeaders()` util) — same split-origin failure mode as
    the console `approvalsApi` fix below.
  - **`fieldGroups[].icon` / `description` reach detail pages.** The shared
    derivation (ADR-0085 §5) already passed them through; the detail synth
    dropped them. Sections now carry both, and `DetailSection` renders a real
    Lucide icon for identifier-shaped names (emoji/text values keep the
    historical text rendering).
  - **Record meta footer stops dangling without an actor.** Seeded/system rows
    with `created_by: null` rendered "Created by · 10m ago"; the footer now
    falls back to actor-less labels ("Created / Updated"), with new i18n keys in
    all six locales (and the zh `createdBy`/`updatedBy` mistranslation fixed:
    创建人/更新人, not 创建于/更新于).
  - **Select badges ellipsize instead of clipping mid-glyph.** In bounded
    containers (highlight-strip columns, grid cells) an overlong option label
    used to be cut at the container edge ("Technolog…"); badges now shrink with
    an inner truncate and expose the full label as a hover title. The highlight
    strip's hover title also prefers the option label over the raw stored value.

  Console app (unversioned): `approvalsApi` now sends the stored Bearer token
  like every other console call — cookie-only auth silently lost the approvals
  surface on split-origin deployments where the SameSite cookie doesn't flow.

- f9a7907: refactor(plugin-detail): extract `<InlineFieldInput>` from `DetailSection`

  Lift the inline-edit input branch out of `DetailSection` into a standalone,
  reusable `<InlineFieldInput>` component (objectui#2407, step 0 — the
  behavior-preserving refactor that precedes the record-level `InlineEditContext`
  and editable-highlights work).

  Behavior is unchanged: `<InlineFieldInput>` renders the exact same type-aware
  editors the detail body handled inline — `SelectField`, `BooleanField`,
  `LookupField`, `UserField`, `CapabilityMultiSelectField`, the
  `permission-facet-link` read-only facet, and the plain number/date/text input
  (with ISO-date coercion and `$expand`-ed-reference safety so an object value
  never leaks `"[object Object]"`). `DetailSection` now delegates to it and keeps
  the field-editability gate (computed / `readonly` / system-field / object
  lifecycle) exactly as before. The `extractLookupId` helper and the
  `TEXTUAL_REF_FALLBACK_TYPES` set move alongside the component.

  This lets any record-level surface (the details body **and** the highlights
  strip) share one editor, shrinking the surface of the follow-up
  editable-highlights change. Covered by the existing `DetailSection` inline-edit
  suites plus a new `InlineFieldInput` parity test.

- 4afb251: Record-level inline edit polish (objectui#2572, follow-up to #2407) — the five
  rough edges from the live showcase verification pass:

  - **Expanded reference values pass through to the picker.** `InlineFieldInput`
    no longer collapses an `$expand`-ed record object to a bare id before
    handing it to `LookupField` / `UserField` — the picker resolves the display
    name it already carries instead of re-fetching the referenced record via
    `findOne` (or sticking on the placeholder when it can't). `LookupField`
    still hands its Level-2 pickers (PeoplePicker / RecordPickerDialog) bare
    ids, collapsed via the existing `normalizeId`.
  - **Approval-lock preflight.** The record page now re-reads the approval
    state whenever the record is invalidated (a save can _trigger_ an approval
    flow that locks the record), derives one `approvalLocked` signal
    (`approval_status` pending/in_approval OR an open pending request), gates
    the inline-edit session's `canEdit` with it — hiding the pencil affordances
    and no-op'ing `enter()` on a locked record — and drives the save bar's
    `locked`/`lockedHint` so users can't type into a draft that Save would
    reject with `RECORD_LOCKED`.
  - **Numeric field types edit with the real numeric widgets.** `number` /
    `currency` / `percent` route to `NumberField` / `CurrencyField` /
    `PercentField` (the same widgets the form uses) instead of a free-text
    input: numeric keyboard, symbol adornment, fraction↔percent display
    conversion, and numbers (not strings) into the draft. `NumberField` and
    `CurrencyField` now surface metadata `min`/`max` on the input, `NumberField`
    honors an explicit `step` and steps by 1 for `scale: 0` (previously fell
    back to `any`).
  - **Header Edit CTA stands down during an inline session.** The synthesized
    `sys_edit` action carries `disableDuringInlineEdit`, and the `page:header`
    renderer greys such actions out while `InlineEditContext.editing` — the
    classic form-edit surface can no longer be stacked on top of a live inline
    draft.
  - **Keyboard shortcuts for the shared edit session.** `InlineEditSaveBar`
    binds **Esc → cancel** (deferring to any open Radix layer — popover /
    select / dialog — which owns Escape for "close") and **Cmd/Ctrl+Enter →
    save**, both respecting `saving`/`locked`.

- 2712fc1: fix(fields+detail): resolve the pre-existing rules-of-hooks violations in the cell renderers

  - `CurrencyCellRenderer` / `EmailCellRenderer` / `PhoneCellRenderer` called
    hooks (`useLocalization`, `useFieldLabel`, `useState`) **after** their
    empty-value early return — a value flipping between null and set changed
    the hook count between renders (latent "Rendered more hooks than during
    the previous render" crash). Hooks now run unconditionally before the
    early return.
  - `useFieldLabel` wrapped `useObjectTranslation()` in try/catch; a throw
    after other hooks ran would desync hook order. The underlying hook is
    provider-safe (optional context + global i18n fallback), so the guard is
    removed.
  - `ReferenceCellRenderer` no longer constructs JSX inside try/catch (the
    try can't catch render errors anyway) — the display string is computed in
    the try, rendered outside.
  - `RecordMetaFooter`'s UserRef renders the registry cell renderer via
    `React.createElement` instead of a locally-assigned capitalized JSX tag
    (flagged as component-creation-during-render; the registry reference is
    stable).

  No behavior change intended; eslint react-hooks errors on these files drop
  to zero.

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

- Updated dependencies [82441e4]
- Updated dependencies [2efa9fd]
- Updated dependencies [e628d1f]
- Updated dependencies [23d65c3]
  - @object-ui/i18n@14.1.0

## 14.0.0

### Patch Changes

- eef832b: 修复记录抽屉绕过甘特图行级锁定的问题(#2436 第 5 项)。

  - `RecordDetailDrawer` 的编辑/删除能力现在由调用方是否传入 `onFieldSave` / `onDelete` 决定:两者都省略时抽屉严格只读(无内联编辑、无删除入口)。此前抽屉硬编码 `inlineEdit` 与 `showDelete: true`,并无条件向内层 DetailView 传包装函数,导致锁定记录仍可"编辑"(且改动静默丢失)。
  - `ObjectGantt` 对 `lockField` 锁定的行、以及全局 `readOnly` 的甘特图,不再向抽屉传入 `onFieldSave` / `onDelete`,与时间轴上禁止拖拽/调整的行为保持一致。

- 5971cc4: i18n: translate the Profile page, honor inline i18n label objects under bare
  base-language codes, and localize managed-by badges / record quick actions.

  - `pickLocalized` now upgrades a bare base language (`zh`) to any
    region-qualified key sharing the base (`zh-CN`) — runtime language is
    normalized to the base code while metadata authors write full BCP-47 tags,
    so inline `{ en, 'zh-CN', ... }` label objects previously fell back to
    English.
  - ProfilePage (`account:profile_card` / `/system/profile`): every hardcoded
    string — page title/subtitle, avatar Upload/Replace/Remove, Personal
    Information card, Change/Set Password card — now goes through
    `useObjectTranslation()` with `profile.*` keys (new namespace in all ten
    locale bundles); the lazy-load fallback reuses `common.loading`.
  - `ManagedByBadge` chips/tooltips (Config/System/Append-only/Identity) now
    resolve through new `managedByBadge.*` keys with `{{provider}}`
    interpolation.
  - `record:quick_actions` resolves action labels via the
    `objects.{object}._actions.{action}.label` convention plus `pickLocalized`,
    so object action buttons (Change Password, Enable 2FA, …) localize.
  - `record:details` / `record:related_list` / `record:alert` / `ObjectTree`
    pass inline label objects through `pickLocalized`.
  - Locale bundles: added `managedByBadge` namespace to all ten locales and
    backfilled `list.inlineEditShort` / `inlineEditLabel` /
    `recordEditingTitle` for ja/es/ko/de/fr/pt/ru/ar.

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
  - @object-ui/permissions@14.0.0

## 13.2.0

### Patch Changes

- 80901aa: Honor action `visible` (and `enabled`) predicates in three more action renderers.

  Following the data-table row-action fix, three sibling renderers still rendered schema-defined actions without evaluating their `visible` CEL predicate:

  - **`action:group` dropdown mode** (`@object-ui/components`) — dropdown items ignored `visible`/`enabled`, while the group's inline mode already honored them.
  - **Related-list `list_toolbar` header actions** (`@object-ui/plugin-detail`) — e.g. an organization's "Invite User" button ignored `visible`, even though the sibling row actions (fed by the same `deriveActions` bridge) already honored it via the data-table's `DataTableRowActionItem`.
  - **Grid bulk-action bar** (`@object-ui/plugin-grid`) — `bulkActionDefs.visible` was ignored entirely; the button is now hidden when the predicate is false (the `BulkActionDef.visible` doc comment is corrected from "disables" to "hides" to match).

  Each now evaluates `visible` (and, where applicable, `enabled`) via a hook-safe per-item component that mirrors `RowActionMenuItem` / `DataTableRowActionItem`, resolving `features`/`user` from the ambient `ExpressionProvider` scope. Rendering-layer only — no action definitions changed.

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

- Updated dependencies [53c40c2]
  - @object-ui/i18n@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/i18n@13.1.0

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
  - @object-ui/permissions@13.0.0

## 12.1.0

### Patch Changes

- 47e72b8: Fix a React #300 crash when drilling from a master record into a related child record.

  `DetailSection` placed its all-empty `return null` guard _before_ the virtual-scroll `useEffect`, so a section that rendered all-empty on one pass (effect skipped) and populated on the next (effect runs) changed its hook count between renders of the same reconciled fiber — React threw error #300 ("rendered more hooks than during the previous render"). This reliably tripped on the master-detail drill-in (e.g. Account → Project), showing an error boundary and bouncing the user away on refresh. The all-empty guard now runs after every hook, making the hook count invariant.

- Updated dependencies [6cbccf3]
- Updated dependencies [e1840bf]
  - @object-ui/i18n@12.1.0

## 12.0.0

### Minor Changes

- e36a9c7: Align the DetailView column density with the entry form (objectui#2578 "多列显示").

  - **Detail views now reach up to 4 columns, matching the form.** `inferDetailColumns` was hard-capped at 2 columns and the section column count was derived per-section, so a field-heavy record displayed 2 columns in detail but 4 in the edit form. It now uses the same density scale as the form's `inferColumns` (1 → 2 → 3 → 4 by field count) and `deriveFieldGroupDetailSections` derives the count from the object's _total_ field count and stamps it uniformly on every section — so view and edit read at the same width. The responsive grid classes and `getResponsiveSpanClass` ladder were extended through the 3- and 4-column breakpoints, and the effective column count is clamped to the number of visible fields so a lone field never sits at 1/N width.
  - **Long JSON values no longer spill into the neighbouring column.** `JsonCellRenderer` (used by `address`/`json`/`object`/`composite`/`record` fields) applied `truncate` to a bare inline `<span>`, where `overflow:hidden`/`text-overflow:ellipsis` never clip (there is no width box) and the accompanying `white-space:nowrap` also defeated the cell's `break-words`; a long name-keyed map or address JSON therefore overflowed into the adjacent GPS/color cell once the grid narrowed to multi-column. The renderer is now a `block max-w-full` element so `truncate` clamps to the cell width (full value still on hover), and the detail cell wrappers carry `min-w-0` so unbreakable values wrap instead of setting the track's min width.

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e36a9c7]
- Updated dependencies [e4de456]
- Updated dependencies [68e2d1c]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/fields@12.0.0
  - @object-ui/permissions@12.0.0
  - @object-ui/react@12.0.0
  - @object-ui/i18n@12.0.0

## 11.5.0

### Minor Changes

- 6fffd3d: Client-side data-invalidation bus — refresh data, don't rebuild UI (objectui#2269 P1).

  - `@object-ui/react` gains the bus: `notifyDataChanged({objectName, recordId?})`, `useDataInvalidation(objectName, recordId?)` (reader nonce), `subscribeDataChanges`, and `useMutationInvalidationBridge(dataSource)` which fans every dataSource write (`MutationEvent`) onto the bus. The bus also dispatches the legacy `objectui:related-changed` window event, so pre-bus listeners keep working.
  - The `key={refreshKey}` remount of `RecordDetailView` (AppContent) and the `key={actionRefreshKey}` remount of `DetailView` (RecordDetailView) are GONE: record data now refetches in place via the bus — scroll, collapsed sections, tabs and in-progress inline edits survive every save/action/undo. All nine action-success bumps became precisely-scoped `notifyDataChanged` calls; undo/redo use the operation's own `objectName`/`recordId`.
  - `RelatedCountStore` is wired to the bus (tab count badges refetch after any change to their object) and its `useSyncExternalStore` snapshot is now a monotonic version — previously it returned the same `Map` reference, so `emit()` never re-rendered subscribers and invalidations left badges stale; `useRelatedCountVersion()` is exported and drives the probe effect's re-fetch.
  - app-shell also gains the reserved URL-param registry (`urlParams.ts` — `form`/`formObject`/`formLink`/`tab`/`recordId`/`palette`/`shortcuts` constants replace scattered string literals) and AGENTS.md Commandment #8 (UI-state classification: state that must survive a data refresh may never live only in an uncontrolled component).

- 9255686: Record detail tabs are URL-addressable (`?tab=`) and survive subtree remounts (objectui#2257, ADR-0054 C3).

  - `buildDefaultTabs` emits STABLE semantic tab values (`details` / `related:<child>` / `related` / `activity` / `history`) instead of leaving the renderer to synthesize index-derived ones.
  - `PageTabsRenderer` honors `item.value`, a host-provided `schema.defaultTab` (validated against actual tabs) and `schema.onTabChange`; index fallback kept for authored schemas without values.
  - app-shell `RecordDetailView` restores the active tab from `?tab=` and writes it back with `replace` (tab switches never stack history), via the pure `withPageTabsUrlSync` page-tree injector (never mutates authored/memoized page schemas). Legacy `DetailView.autoTabs` wired to the same contract (`defaultTab`/`onTabChange`).
  - Fixes the tab strip resetting to Details after save-refresh remounts (`refreshKey`-style) and dev-StrictMode URL churn; enables `?tab=` deep links; invalid values fall back to Details.

### Patch Changes

- Updated dependencies [544d8eb]
- Updated dependencies [1072701]
  - @object-ui/i18n@11.5.0

## 11.4.0

### Minor Changes

- 144ab55: Consume the ADR-0085 object semantic roles from `@objectstack/spec@11.7.0`, retiring the per-surface hint dialects:

  - **Single-source fieldGroups derivation**: `plugin-form`'s `deriveFieldGroupSections` and `plugin-detail`'s `deriveFieldGroupDetailSections` are now thin adapters over the spec's `deriveFieldGroupLayout` (ADR-0085 §5) — forms, modals and detail pages render the SAME grouping from one implementation. The canonical `collapse: 'none' | 'expanded' | 'collapsed'` enum is honoured everywhere (deprecated `collapsible`/`collapsed` and `defaultExpanded` spellings still read for pre-11.7 metadata).
  - **`stageField` semantic role**: the detail stepper reads the top-level `stageField`; `stageField: false` now actually suppresses stage detection (previously the `false` handling was wired to the removed `detail.stageField` key, so spec-authored `false` fell through to the name heuristic).
  - **`highlightFields` rename**: default grid columns, card compact views, the detail highlight strip, child-record preview fields and interface-page default columns read the object's `highlightFields` (deprecated `compactLayout` spelling read as fallback for pre-11.7 metadata).
  - **Removed dead reads**: the never-spec-writable `objectDef.views.*` UI hints and the ADR-0085-removed `detail.*` block (`sections`, `sectionGroups`, `highlightFields`, `stageField`, `useFieldGroups`, `showReferenceRail`, `hideReferenceRail`, `hideRelatedTab`, `relatedLayout`) are no longer consulted. Per-page customization goes through an assigned Page schema (`record:reference_rail` remains available there as a renderer capability). `detail.renderViaSchema` survives only as the legacy-renderer kill-switch and is removed together with that path.

- 19f2533: Detail-page related lists: `relatedList: 'primary'` → own tab, multi-FK & self-referential related lists, unified picker columns (framework #2579).

  - **plugin-detail** (`buildDefaultTabs`): the default related-list layout is now
    the ADR-0085 prominence rule — lists whose FK declares `relatedList: 'primary'`
    each get their OWN tab; every other related list collapses into a single
    "Related" tab. With no primary lists this is byte-for-byte the previous stacked
    default, so it is opt-in per relationship. `relatedLayout: 'tabs' | 'stack'`
    remain app-level overrides (force all-own-tabs / all-stacked).
  - **app-shell** (`deriveRelatedLists`): emits one related list per eligible FK —
    a child referencing the parent through several relationships (e.g.
    `primary_account` + `partner_account`) now surfaces each, disambiguated by the
    FK label; includes self-referential relationships (hierarchies → a "child"
    list); and carries the `isPrimary` prominence flag through. `RecordDetailView`
    threads `isPrimary` into the synthesized page.
  - **fields** (`deriveLookupColumns`): the lookup-picker default columns now
    prefer the object's ADR-0085 `highlightFields` (then legacy `displayFields`,
    then the field walk) — the same "how to list this object" source the related
    list uses, so a picker and a related list of the same object agree with zero
    per-surface config.

  Pairs with the `@objectstack/spec` change that makes `relatedList` a tri-state
  (`boolean | 'primary'`) and `record:related_list` `columns` optional.

### Patch Changes

- 2edcaff: Drop the `compactLayout` fallback reads (6 sites: ObjectGrid default columns, deriveHighlightFields, RecordDetailView highlight strip + child preview, ObjectView ×2, InterfaceListPage). The deprecated spelling was retired from the spec by framework#2539 (framework#2536) — served metadata carries `highlightFields` only, so the fallbacks could never fire again; keeping them would teach the retired key to the next reader.
- 7782698: fix(components): page:header record title honours `nameField` via the unified ADR-0079 resolver

  The default console record detail page renders the synthesized `page:header`
  (`buildDefaultPageSchema`, renderViaSchema default-on), whose record-chip title
  chain probed `objSchema.primaryField` (not a spec property — always undefined),
  `titleFormat`, then hardcoded `name`/`full_name`/`title`/`subject`/
  `display_name`/`label` record keys. It never consulted the object's declared
  `nameField`/`displayNameField`, so an object titled by e.g. `subject` rendered
  `<ObjectLabel> <id-prefix>` as its H1 instead of the record's real name.

  `PageHeaderRenderer` now resolves through `getRecordDisplayName(objSchema, data,
{ deriveFromRecordKeys: false })` after the author overrides and before the
  legacy probes — mirroring `DetailView.resolveDisplayTitle` so both headers
  agree. `RecordDetailView`'s `primaryField` derivation and
  `buildDefaultPageSchema`'s highlight-strip dedup also honour
  `nameField`/`displayNameField`.

- Updated dependencies [9cd9be1]
- Updated dependencies [790558b]
  - @object-ui/i18n@11.4.0

## 11.3.0

### Minor Changes

- db5ebe4: Declare designer inputs for the `record:*` blocks (details, related_list,
  highlights, path) so they conform to the spec protocol (RecordDetailsProps /
  RecordRelatedListProps / RecordHighlightsProps / RecordPathProps in
  @objectstack/spec component.zod). They previously registered ZERO inputs — the
  visual designer could not configure them, and the spec↔frontend conformance
  check flagged 17 spec-only divergences. Now each block's inputs mirror its spec
  schema (columns/layout/sections/fields, etc.).

### Patch Changes

- Updated dependencies [d88c8ec]
  - @object-ui/i18n@11.3.0

## 11.2.0

### Minor Changes

- 32dbd6a: feat(detail): `relatedLayout: 'tabs'` — surface related tables as peer tabs via config

  Record detail pages can now show each related table as its own top-level tab
  instead of stacking them all inside a single **Related** tab — no custom page
  required. Set `detail.relatedLayout: 'tabs'` on the object; the synthesized
  record page then emits one tab per related list (label = the related list's
  `title`, falling back to its `objectName`, carrying its `icon`), slotted between
  the **Details** tab and **Activity** / **History**.

  - `buildDefaultPageSchema` (`@object-ui/plugin-detail`): new
    `BuildPageOptions.relatedLayout?: 'stack' | 'tabs'` threaded through
    `buildDefaultTabs` (the single choke point for the related-tab emission).
    `'tabs'` fans the related children out into peer tabs; `'stack'` (default)
    keeps the legacy single **Related** tab — **zero regression** when omitted.
    Still honours `hideRelatedTab` (no related tabs emitted) in both modes.
  - `RecordDetailView` (`@object-ui/app-shell`): reads
    `objectDef.detail.relatedLayout` per object and forwards it to the synth.

### Patch Changes

- @object-ui/i18n@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [6726a2b]
  - @object-ui/i18n@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/i18n@7.3.0

## 7.2.0

### Minor Changes

- d23db5c: feat(detail): related-list add-by-picker (generic m2m/junction) + a generic "Assigned Users" management UI on permission sets (assign ai_seat and any role with zero bespoke CRUD; server-side cap errors surface inline).

### Patch Changes

- Updated dependencies [8e7c1da]
  - @object-ui/i18n@7.2.0

## 7.1.0

### Patch Changes

- @object-ui/i18n@7.1.0

## 7.0.0

### Minor Changes

- a00e16d: feat: evaluate CEL `disabled` on action buttons + record-page Undo wiring

  - **components (page header)**: the `record_header` action toolbar now evaluates
    a CEL `disabled` predicate against the record (boolean was the only honoured
    form before), mirroring its existing `visible` evaluation. An action can now
    grey out conditionally (e.g. "Reassign" on a converted lead) instead of only
    hiding via `visible`.
  - **plugin-grid (row menu)**: `RowActionMenu` items likewise evaluate `disabled`
    (boolean or CEL against the row), and skip the click when disabled.
  - **components (action-button)**: forward `undoable` / `recordIdField` when
    executing, so undoable update actions keep their Undo affordance through the
    `action:button` path.
  - **app-shell (RecordDetailView)**: mount `useGlobalUndo` and wire the record
    action runtime's success toast to offer "Undo" for `undoable` actions
    (capturing the changed fields' prior values from the loaded record).
  - **plugin-detail (record:quick_actions)**: the widget's buttons now evaluate a
    CEL `disabled` and show a spinner + disable while running.

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

### Patch Changes

- 3cc38fe: perf(detail/header): lazy + dedupe related-list fan-out, coalesce header polls

  Opening a record detail fired ~50 concurrent `/api/v1` requests that
  head-of-line-blocked one another on a single control-plane container.

  - `RecordDetailView` no longer eager-preloads reverse-reference children
    when the reference rail renders them (that data was discarded while the
    rail re-fetched the same collections).
  - `record:reference_rail` now gates fetching on visibility
    (`IntersectionObserver`; the rail is `hidden xl:flex`), caps concurrency
    at 3, and fetches once per `(parentId + entries)` via a signature guard,
    applying results through a mounted ref.
  - `AppHeader` inbox/notification, approvals, and activity pollers gained
    in-flight guards so bootstrap effect re-runs coalesce to one request; the
    approvals poll now sends one request with all identities comma-joined
    instead of one per identity.

  Measured locally: opening an environment detail dropped from ~52 to ~17
  requests, related collections from ×3–5 each to ×1, approvals from ×9 to ≤3.

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

- 650bd1f: fix(forms/dashboard/related-list): four business-facing rendering fixes found while QA-ing a showcase workspace

  - **plugin-form / WizardForm**: a multi-step `object-form` with `formType: 'wizard'` posted an empty/partial body on submit, so the server rejected every required field. Two causes: (1) the footer Next/Create buttons bypassed the inner form and submitted the wizard's own (never-collected) `formData`; (2) the create-mode data-seeding effect re-ran on `dataSource`/`objectSchema` identity churn and reset `formData` to `{}` mid-wizard. Now the buttons submit the inner form natively (`<form id>` + `type="submit"`, which validates each step and collects values via `getValues()`), and the create seed is made idempotent.
  - **plugin-dashboard / DashboardRenderer**: chart widgets rendered as empty cards (recharts logged `width(-1) height(-1)`) because the positioned grid used `auto-rows-min`, collapsing any widget with no intrinsic height. The explicit-columns grid now uses `gridAutoRows: minmax(5rem, auto)` so spanned chart rows get a real height while tables can still grow.
  - **plugin-detail / RelatedList**: auto-derived related-list columns led with system audit fields (`created_at`, `updated_at`, …) for child objects without a name/title field, pushing business columns past the column cap. System audit fields are now sorted last.
  - **plugin-form / ObjectForm + WizardForm**: a successful create/update gave no feedback for metadata-only pages (which can't pass an `onSuccess` function). They now show a default `toast.success('Created'/'Saved')` when no `onSuccess` handler is supplied (guarded so a `submitHandler` host like MasterDetailForm never double-toasts).

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
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0
- @object-ui/fields@6.0.0
- @object-ui/permissions@6.0.0

## 5.4.2

## 5.4.1

## 5.4.0

## 5.3.2

## 5.3.1

## 5.3.0

## 5.2.1

## 5.2.0

### Minor Changes

- 7c441f5: End-to-end @-mention notifications.

  `@object-ui/plugin-detail` now exports `extractMentions(text, suggestions)`
  — a small utility that resolves `@<label>` tokens in a comment body to
  user ids, using the same suggestion list that drives the in-editor
  dropdown. Handles labels with spaces ("@QA Test"), CJK ("@王小明"),
  longest-match disambiguation ("Anna Lee" wins over "Anna"), and ignores
  unknown @-tokens. 9 unit tests.

  `@object-ui/app-shell` `RecordDetailView` now:

  1. Serializes the resolved mention ids into `sys_comment.mentions`
     (previously hard-coded `'[]'`, so servers had no idea who was being
     pinged).
  2. Fan-outs a `sys_notification` row per mentioned recipient
     (self-mentions are filtered as noise) with the canonical bell-inbox
     shape: `type: 'mention'`, `recipient_id`, `actor_name`, `title`,
     `body` preview (≤140 chars), `source_object`/`source_id`/
     `source_comment_id`, `is_read: false`, `created_at`.

  The notification write tolerates 404 silently, so deployments without
  a notification collection degrade to the previous behavior (mention
  text + highlight, no inbox row). Spec-compliant servers that emit
  notifications via their own sys_comment after-create hook can ignore
  the client-side write — the bell de-dupes by id at the polling layer.

- 70b5570: `record:path` now distinguishes won/lost terminal stages. Stages can opt
  in via the new `terminal: 'won' | 'lost'` property on each stage entry,
  and the renderer also falls back to a value/label heuristic (matches
  `closed_lost`, `lost`, `failed`, `cancelled`, `失败`, `流失`, `丢单`, etc.)
  so existing CRM-style picklists get the treatment without migration.

  - **Lost** stages render in a visually separated group with a left
    border, destructive (red) tint, pill shape, and `✗` glyph — mirroring
    the Salesforce / HubSpot alt-terminus pattern that signals "this
    breaks the forward path, not steps past it."
  - **Won** terminus (the last stage of the forward chevron) gets a subtle
    emerald wash + 🏆 glyph to read as "the goal," even before the record
    reaches it.
  - Mobile pill row distinguishes lost via color, since the layout doesn't
    have room to fork the row.

- 3216f8a: `buildDefaultPageSchema` now accepts a `slots.rightRail` override that
  contributes nodes to the aside (right-rail) region. The aside region is
  emitted whenever either the auto-detected reference rail OR
  `slots.rightRail` is non-empty (previously: only when 2+ related lists
  were declared). Slot contributions are appended after the canonical
  `record:reference_rail` so the "related summary" stays anchored at the
  top while plugins can drop activity feeds, workflow status cards,
  presence lists, etc. beneath it.

  No change for existing schemas — the aside region only renders if
  something opts in.

### Patch Changes

- a3cb88f: CRM UX polish batch:
  - Kanban columns: drop the per-column rainbow top stripe. Lane border + header divider are sufficient; cards are now the loudest thing on screen (Linear / HubSpot pattern).
  - Stage chevron (`record:path`): bump completed-stage contrast (emerald-800 text on emerald-500/15, was 700 on /10) and future-stage text from `foreground/70` to `foreground/85` for legibility.
  - i18n: add `notifications.emptyUnread`, `notifications.filterUnread`, `notifications.filterAll` (en + zh) so the InboxPopover Unread/All sub-filter renders in the active locale.
- 5425608: CRM UX polish pass — calmer enterprise look across detail + kanban.

  - **plugin-kanban**: column headers now use a 2px muted accent stripe with
    neutral foreground titles + a quiet grey count pill instead of full
    rainbow gradient + colored title + colored count. Pipeline boards
    (Opportunity, Case, Task, Lead) look like Salesforce/Linear instead of
    a toy. WIP-limit overflow remains destructive-red so urgency stays loud.
  - **plugin-detail (`record:reference_rail`)**: new `hideEmpty` prop
    (default true) collapses entries whose total === 0 into a single
    `+ N empty (Quotes · Products …)` chip at the bottom of the rail.
    Removes the 4–7 "No records" stack that dominated the aside.
  - **plugin-detail (`record:path`)**: completed stages now render with an
    emerald-tinted background + bold green check instead of low-contrast
    `bg-muted text-muted-foreground` (which read as "light grey on white"
    and was borderline unreadable).
  - **app-shell (`RecordDetailView`)**: record-not-found short-circuit.
    Previously a stale/missing recordId still rendered the page chrome
    (rail, discussion, breadcrumb with the raw id), making invalid links
    look like a partially broken page. Now renders a clean centered
    `Empty` state with database icon + i18n'd "Record not found" copy.
  - **i18n**: added `detail.showEmptyRelated_{one,other}` and
    `empty.recordNotFound{,Description}` keys (en + zh).

- 5633edd: feat(detail,grid): tab + selection motion polish

  **plugin-detail**

  - `DetailTabs` and the auto-tabs path in `DetailView` (5 inline
    `<TabsContent>` instances: details, related, activity, discussion,
    history) now fade in when their tab becomes active, eliminating
    the harsh flash when switching tabs.

  **plugin-grid**

  - `BulkActionBar` slides in from the bottom + fades in when a
    selection is made, instead of popping into existence.
  - The "N items selected" counter re-animates on every count change
    (re-keyed on the count value with a small `zoom-in-90`), so users
    see clear feedback as they tick/untick rows. `tabular-nums` keeps
    the number from jittering during the animation.

  All animations are wrapped in `motion-safe:` so prefers-reduced-motion
  users keep the original instant UI. No new deps.

  **Dialog / Sheet motion audit (informational, no code change)**

  Verified `packages/components/src/ui/{dialog,alert-dialog,sheet}.tsx`:
  Dialog + AlertDialog use a consistent `duration-200`. Sheet uses an
  asymmetric `open:500ms / close:300ms` — this is the intentional
  shadcn upstream default ("slower open feels purposeful"). No fixes
  needed; these primitives live in the no-touch zone anyway.

- e919433: Stop silently assuming USD when a currency field has no `currency`
  configured. For non-USD orgs (e.g. a CNY-based CRM seeded without an
  explicit currency) the cells now render as plain locale-formatted
  numbers (`150,000.00`) instead of `$150,000.00` — which was the #1
  "why is my RMB showing as dollars?" bug.

  Behavior change is opt-in via omission: when `currency` /
  `defaultCurrency` is set on the field/column, formatting is unchanged.

  Fixed call sites:

  - `@object-ui/fields`: `formatCurrency`, `formatCompactCurrency`, and
    `CurrencyCellRenderer` no longer default-param `'USD'`.
  - `@object-ui/i18n`: `formatCurrency()` falls back to `formatNumber`
    semantics when `currency` is omitted.
  - `@object-ui/plugin-grid`: column-summary formatter (`Sum: 5,000,000`
    instead of `Sum: $5,000,000.00`).
  - `@object-ui/plugin-detail`: header-highlight currency formatter.
  - `@object-ui/plugin-dashboard`: `ObjectMetricWidget` inferred
    currency now resolves to `undefined` (not `'USD'`) for un-tagged
    fields, so `MetricWidget`'s `isCurrency` heuristic falls through
    to plain number formatting.

## 5.1.1

## 5.1.0

### Minor Changes

- d1ec6a2: Fold inline-edit into the page-header overflow menu (HubSpot/Lightning
  pattern) and remove the orphan "Edit fields" toolbar row that previously
  floated between the tab strip and the first detail section.

  - `@object-ui/app-shell` `RecordDetailView`: injects a new `sys_inline_edit`
    system action that appears in the ⋯ overflow menu and dispatches a
    `objectui:record:inline-edit-toggle` window CustomEvent (filtered by
    recordId + objectName).
  - `@object-ui/plugin-detail` `DetailView`: listens for that event to
    toggle inline-edit mode; the in-page toolbar now renders only during
    active editing / save error / locked states, so the idle layout flows
    tabs → first section card with no orphan row.
  - `@object-ui/components` layout containers: extended `KNOWN_LABEL_DICT`
    with zh-CN + zh-TW translations for common CRM related-list labels
    (Quotes / Products / Contacts / Accounts / Leads / Opportunities /
    Cases / Campaigns / Approvals / Documents / Emails / Calls / Meetings
    / Open Tasks / Closed Tasks), so authored English labels auto-translate
    in `page:accordion` / `page:tabs` items.

- cf30cc2: Polish Lightning record detail page layout.

  - `record:details` sections now render with Card chrome by default when a `title` is present, restoring visual grouping that was missing on pages like the opportunity detail page.
  - Section labels can be translated via the `{ns}.objects.{objectName}._sections.{name}.label` convention. Author each section with a stable `name` (e.g. `info`, `forecast`) and the renderer picks up the locale-specific label automatically. Falls back to the literal `label` when no translation exists.
  - The `page:header` action toolbar now collapses into a `⋯` overflow menu when more than two actions are present. The first business action stays inline; secondary system actions (Edit / Share / Delete) move into the menu, with destructive styling applied to Delete.
  - Header action labels resolve via the `{ns}.objects.{objectName}._actions.{name}.label` convention.
  - Removed the meaningless field-count Badge from collapsible section headers (the `2` chip next to "Description"). Field-count metadata wasn't useful in the header and added visual noise.
  - Synth-path `sys_delete` now carries `variant: 'destructive'` so the overflow menu can color it appropriately.

- 32306e8: feat(plugin-detail): conflict-resolution dialog for OCC

  When inline record-detail edits race a concurrent writer, the bound
  DataSource now raises `ConcurrentUpdateError` (HTTP 409
  `CONCURRENT_UPDATE`). `RecordDetailsRenderer` catches it and opens a
  new `<ConcurrentUpdateDialog>` showing the user's pending value next
  to the server's current value, with three resolution paths:

  - **Reload latest** — discard the pending edit and refetch.
  - **Overwrite anyway** — retry against the server's freshest version
    (still OCC-checked, but acknowledges "I've seen the newer version").
  - **Cancel** — close the dialog and leave the form untouched.

  The renderer now forwards `record.updated_at` as `{ ifMatch }` to
  `dataSource.update()`, so the server can detect stale writes. The
  component is re-exported as `ConcurrentUpdateDialog` /
  `isConcurrentUpdateError` from `@object-ui/plugin-detail` for hosts
  that need to surface the same UX from custom save paths.

  End-to-end OCC requires `@objectstack/client@>=4.2.0` (now wired) and
  backend support in `@objectstack/rest@>=4.2.0`.

- 49b1760: Polish the ConcurrentUpdateDialog and add i18n.

  - Internationalise all dialog strings (title, body, button labels, "your edit" / "current value" headings, audit-trail line) through `useDetailTranslation`. Locale strings added to `@object-ui/i18n` for English and Chinese.
  - Replace the plain dialog header with an amber warning badge + `AlertTriangle` icon to communicate that this is a conflict, not a routine confirmation.
  - Visually differentiate the two value blocks: amber tint for the user's pending edit, sky tint for the server's current value. Both wrap long values cleanly.
  - Surface audit provenance for the racer's write (`updated_at`, plus `updated_by_name`/`updated_by_label` when supplied). Opaque ID-looking `updated_by` tokens are suppressed.
  - Re-prioritise the action buttons: **Reload latest** is now the primary/recommended action (autofocused), **Overwrite anyway** is rendered as a destructive-outline button so the dangerous path requires deliberate intent, and **Cancel** falls back to a ghost variant.

- 8fd863e: Platform highlight + list polish:
  - **deriveHighlightFields**: extended the preferred-field list (close_date, due_date, account, contact, …) and now skips fields whose declared type is not "highlight-friendly" (textarea, markdown, json, boolean, rich-text, etc.). Untyped legacy fields still pass through. Prevents long-form/structural fields from ending up in the highlight strip on objects with sparse metadata.
  - **ListView bulk-action labels**: bulk-action buttons now resolve their labels through `actionLabel(objectName, action, fallback)` so they pick up app-supplied translations under `_actions.<name>.label`, matching the detail-page page-header overflow menu. Falls back to the previous title-cased string when no resource is found.

### Patch Changes

- bd8447d: Three platform-wide detail polish items.

  **Tighter page rhythm**

  - Outer `PageRenderer` padding `p-4 md:p-6 lg:p-8` → `p-3 md:p-4 lg:p-6`
    and outer body wrap `space-y-8` → `space-y-6` so list / detail / home
    pages share the same edge rhythm. Cuts ~16px of edge slack on lg.

  **Highlights KPI treatment**

  - `HeaderHighlight` now renders numeric / currency / percent / decimal
    values as KPI numbers (`text-xl md:text-2xl font-semibold tabular-nums`)
    instead of the uniform `text-sm font-semibold`, so amount / probability
    / count fields read as headline stats — Salesforce-style key facts.

  **Discussion footer upgrade**

  - `RecordActivityTimeline` now uses `RichTextCommentInput` (bold / italic /
    list / code, `@`-mention autocomplete, preview toggle, Send) instead of
    a bare `<textarea>`.
  - `DiscussionContext` gains an optional `mentionSuggestions` array that
    hosts can wire (e.g. team member directory). Falls back to free-text
    `@mention` when omitted.
  - `RecordChatterPanel` threads `mentionSuggestions` through both inline
    and sidebar positions.

- fbd5052: Tighten record-detail visual rhythm. Section card titles were rendering at
  Shadcn's default `text-2xl` which dominated the page; the related-list
  accordion in flush mode dropped all per-item borders so the collapsed
  "Quotes / Products / Open Tasks" triggers stacked with zero visual
  separation.

  - `@object-ui/plugin-detail` `DetailSection`: override the `CardTitle`
    className to `text-base font-semibold tracking-tight`, slim down
    `CardHeader` padding (`py-3 px-4 sm:py-4 sm:px-6`) and `CardContent`
    vertical padding so titles + content read as a single tight block
    rather than a billboard. Demoted the section description from `text-sm
mt-1.5` to `text-xs mt-1` for the same reason.
  - `@object-ui/components` `PageAccordionRenderer`: in the default
    `flush` variant restore a subtle `border-b last:border-b-0` divider
    between accordion items so collapsed siblings get a separator, and
    style the trigger as `text-sm font-semibold tracking-tight
hover:no-underline` (Shadcn's hover-underline default looks busy on
    CRM-style related-list lists).

- d51a577: feat(platform): Discussion attachments + @mention directory + Reference Rail aside

  - **Discussion attachments** — `RichTextCommentInput` now accepts an `extraSlot`
    and a `canSubmitEmpty` flag so hosts can mount the existing
    `CommentAttachment` composer beneath the editor without forking the toolbar.
    `RecordActivityTimeline` plumbs the attachments through
    `DiscussionContext.onUploadAttachments` and submits attachment-only comments.
  - **@mention directory** — `DiscussionContext` gains a `mentionSuggestions`
    field; `RecordDetailView` populates it from the host `sys_user` collection so
    `@` autocomplete in the composer now resolves against real users.
  - **Reference Rail** — New `record:reference_rail` renderer + a dedicated
    `aside` region emitted by `buildDefaultPageSchema` whenever a record has
    ≥ 2 related lists. The rail surfaces a Salesforce/HubSpot-style snapshot
    of related collections (count badge + top 3 records) on `xl+` viewports.
  - **Layout** — `PageRenderer`'s structured-layout `<aside>` wrappers now honor
    `aside.className`, letting schemas attach responsive utilities like
    `hidden xl:flex` to the rail region.

- a49f300: feat(detail): per-object Reference Rail opt-out via `objectDef.detail.hideReferenceRail`

  The Record-detail Reference Rail (right-hand related-list summary cards)
  can now be suppressed on a per-object basis without authoring a full
  custom `Page`. Catalog-style objects (Product, Task) ship with the rail
  off by default; hub objects (Account, Opportunity, Contact, Case) keep it
  on.

  - `RecordDetailView` now reads `(objectDef as any)?.detail?.hideReferenceRail`
    and `…?.hideRelatedTab` and threads them to `buildDefaultPageSchema`.
  - The Reference Rail renderer also accepts entries authored as either a
    flat `entries` array or nested under `properties.entries`, so explicit
    `Page` authors can opt-in via the standard spec shape.
  - See `packages/plugin-detail/README.md` (Reference Rail decision matrix)
    for the rationale and per-object guidance.

- 1cb6e21: feat(plugin-detail): suppress Related tab when Reference Rail is auto-emitted

  When `buildDefaultPageSchema` decides to emit the Reference Rail (≥ 2
  related lists), the duplicate `Related` tab is now suppressed by
  default. The same data appeared in both places before, which is
  visually noisy and risks confusing users when one surface refreshes
  out-of-step with the other.

  Behavior matches HubSpot / Microsoft Dynamics: the rail is the single
  source of truth for related-list snapshots, and each rail card now
  exposes a `View all` link that deep-links into the child object's
  filtered list view. Authors can opt back into both surfaces via the
  new `hideRelatedTab: false` option.

  The change is gated on the same `≥ 2` heuristic that emits the rail,
  so single-related-list pages keep the inline Related tab (where the
  rail wouldn't have helped anyway).

- d548d6b: Unify empty-state visuals across timeline + registered `empty` renderer.
  - `RecordActivityTimeline` and `ActivityTimeline` now use `DataEmptyState`
    instead of a bare `<p>` so empty timelines match list/related-list visuals
    (muted icon badge + centered copy).
  - The `ui:empty` schema renderer now delegates to `DataEmptyState`, giving
    schema-driven empty regions the same chrome as ad-hoc consumers.

## 5.0.2

## 5.0.1

## 5.0.0

### Major Changes

- bb2ea48: **Phase O.0 — fix: related-list shows wrong records (critical data bug)**

  `RelatedList` previously called `dataSource.find(api)` with no filter
  when auto-fetching, so every Related tab dumped the entire target
  object table instead of the records that actually reference the
  current parent (e.g. an Account showed every Contact in the system,
  not only contacts of that account).

  Two coupled fixes:

  1. `RelatedList` now requires `parentId` + `referenceField` to auto-
     fetch. When both are present it calls `dataSource.find(api,
{ $filter: { [referenceField]: parentId } })`. When either is
     missing it renders the empty state and logs a developer warning —
     never silently fetches the whole object.
  2. `RelatedCountStore` was sending the probe query as `{ where, limit }`
     which most data-source adapters silently ignored (the codebase
     convention is `{ $filter, $top }`). The tab-count badges were
     therefore showing the global object count, not the parent-scoped
     count. Switched to `$filter` / `$top` to match.

  `record:related_list` renderer threads `ctx.recordId` through as
  `parentId`; no schema author changes required.

  **Breaking:** custom callers that depended on `RelatedList` fetching
  the entire object table when `referenceField` is omitted will need to
  either pass `data` explicitly or supply both `parentId` and
  `referenceField`. The previous behaviour was a bug, not a feature.

### Minor Changes

- 542cca9: feat(detail): buildDefaultPageSchema synthesizer (Track 3 Phase G slice 1)

  Pure-function synthesizer that emits a canonical Lightning-style Page
  schema (`page:header` → `record:highlights?` → `record:path?` →
  `page:tabs` → `record:discussion?`) from an object definition and
  optional overrides. Also exports helpers `detectStatusField`,
  `deriveStages`, `deriveHighlightFields`.

  This is the foundation for converging the default `<DetailView>`
  output with custom Lightning pages. Phase H will wire it into
  `RecordDetailView`'s non-assignedPage branch so the default detail
  page renders through the same `<SchemaRenderer>` pipeline as custom
  pages, inheriting all Phase D/E/F polish automatically.

  No runtime behaviour change in this slice — synthesizer is exported
  but not yet consumed.

- 8930b15: feat(detail): close the gap between Page-assigned and default record detail pages (Track 1)

  Custom Lightning-style record detail pages (assigned via `assignedPage` /
  `Page` schemas) used to feel meaningfully poorer than the auto-generated
  default detail view. They were missing cross-cutting affordances and
  shipped with English-only tab labels and heavy bordered section cards
  even when the host locale was Chinese. Track 1 closes the visible gap:

  - **app-shell `RecordDetailView`**: the `assignedPage` branch now wears
    the same chrome as the default branch — lifecycle managed-by badge
    and presence avatars in the top-right, `MetadataPanel` debug panel,
    `ActionConfirmDialog` / `ActionParamDialog`, and an auto-appended
    `RecordChatterPanel` at the bottom of the page. Authors opt out of
    the auto-discussion with `assignedPage.disableDiscussion = true`.
  - **plugin-detail `record:details`**: defaults to `inlineEdit: true` so
    fields are click-to-edit just like the default page, and synthesises
    sections with `showBorder: false` by default so a Lightning page
    doesn't double-wrap every block in a heavy Card.
  - **components `page:tabs` / `page:accordion`**: well-known English
    labels (Details / Related / Activity / History / Notes / Files /
    Tasks / Events / Attachments / Chatter / Discussion / Comments /
    Overview / Summary) auto-translate to Chinese (`zh-CN` / `zh-TW`)
    via a built-in dictionary keyed off `document.documentElement.lang`.
    Authors supplying explicit localised labels (string or
    `{ default, zh-CN, ... }`) are not affected.
  - **i18n provider**: applies the initial language to
    `document.documentElement.lang` on mount (i18next does not fire
    `languageChanged` for the bootstrap language), so locale-aware
    renderers downstream see the right value from the first render.

- 927187a: Phase N.1 + N.2: visual polish for record detail pages.

  **N.1 — System actions on full Lightning pages.** `PageHeaderRenderer`
  now merges `headerSystemActions` from `RecordContext` with authored
  actions (authored wins on name/id collision), so full custom pages
  (lead, opportunity, ...) once again show 编辑 / 分享 / 删除 alongside
  their authored actions. `sys_share` and `sys_delete` now use the
  `outline` variant instead of `destructive` to read better in
  multi-button clusters.

  **N.2 — Hide empty fields by default in synth detail pages.**
  `record:details` defaults `section.hideEmpty` to `true` so synthesized
  pages don't render label graveyards on first load. The "显示 N 个空字段"
  reveal toggle is preserved as the user-facing escape hatch. Authors can
  opt back into showing every field by setting `hideEmpty: false` on the
  section schema.

- bae8ba8: Phase N.3 + N.4 + N.6: record detail visual polish.

  **N.3 — Highlight strip packs left.** `HeaderHighlight` no longer
  stretches a 1-2 chip strip across the full page. Each cell is now
  `min-w-[8rem] max-w-[16rem]` and wraps via flexbox so sparse strips
  sit naturally at the left edge.

  **N.4 — De-duplicate highlight ↔ body.** `record:details` accepts a
  new `hideFields: string[]` prop. The synth pipeline auto-populates it
  with the highlight-strip field list so a field surfaced in
  `record:highlights` no longer appears a second time in the section
  grid below. Authors can also set it directly on the schema.

  **N.6 — Tab count badges only show when >0.** `page:tabs` suppresses
  the count pill when the count is exactly 0 (was rendering "0" as a
  muted badge on every empty Activity/History tab).

- 8435860: Phase N.4b: highlight↔body dedup now works for hand-authored Lightning
  pages too.

  Adds a small `HighlightFieldsContext` registry. `record:highlights`
  registers the field names it currently surfaces; `record:details` unions
  that live set into its `hideFieldNames` filter so a field shown in the
  highlight strip is never duplicated in the section grid below.

  Previously the dedup only fired for synth-generated pages (via the
  `hideFields` prop passed by `buildDefaultPageSchema`). Custom Lightning
  pages (e.g. opportunity) showed `所属客户` both in the strip and in the
  body. The registry-based approach covers both code paths uniformly with
  no schema author work required.

  The registry uses `useSyncExternalStore` so adding/removing highlights
  notifies consumers without triggering the provider value identity to
  change — avoiding the update-loop that a naive context implementation
  would cause.

  `RecordDetailView` mounts `<HighlightFieldsProvider>` once per record
  page so the two renderers share state.

- bece8ca: Phase N (continued): merge custom record_header actions into `page:header`
  instead of emitting a sibling `record:quick_actions` node. This fixes a
  visual collision on objects (contact, account, ...) that author custom
  record_header actions: previously the floating quick-actions bar
  (`-mt-12` overlay) collided with the system Edit/Share/Delete cluster
  already rendered by `page:header`. Now all action buttons live on a single
  header row.

  `buildDefaultHeader` accepts an optional `actions` array; `buildDefaultActions`
  remains exported as a sub-builder for authors who explicitly want the
  floating quick-action bar via a slot override.

- 77c1877: **Phase O.1 — Cap detail body grid at 2 columns for denser, more legible layout.**

  The auto-layout previously emitted **3 columns** for sections with 11+
  fields, which on typical desktop widths produced very sparse rows
  (label/value cells filled ~30% of each column, lots of whitespace).
  Capped the inferred maximum at 2 columns so paired fields read as
  cleanly-aligned label/value pairs.

  Authors who explicitly set `section.columns: 3` retain the 3-column
  layout — only the auto-inference default changed.

- b14fe09: Phase P.0 + P.5: tighten record-detail header chrome.

  - `RecordTitleChip` collapses the title row to a single baseline-aligned line — H1, eyebrow object label, copy-id, favorite star — instead of the previous two-row title + subtitle layout.
  - `record:details` extends the highlight-field dedup set to also exclude the title field resolved from `objectSchema.primaryField` (or the standard `name`/`full_name`/`title`/`subject`/`display_name`/`label` fallbacks). Removes the duplicate row that previously echoed the H1 (e.g. "客户名称: Acme Corporation") inside the field grid.

- 1911d34: **Phase P.1 — Collapse empty Related-list cards to header-only.**

  Previously each empty related list rendered a full Card with a 200px+
  "暂无相关记录" empty-state block (header + 32px icon + label +
  optional CTA). With 5-10 related objects mostly empty (common on
  fresh records), the Related tab became a wall of empty cards
  spanning 1500+ vertical pixels.

  Now: when a related list has zero records (and isn't loading), the
  CardContent is skipped entirely. The header row shows the title +
  `(0)` badge + an inline italic "暂无相关记录" hint + the `+ 新建`
  button (downgraded to ghost variant). A 200px empty card becomes a
  40px row.

  Lists with data are unchanged.

- ba98039: **Phase P.2 — Collapse CREATE event field-dump in History timeline.**

  CREATE events render every populated field as a `from: — → to: value`
  diff row. For a record with 20+ fields this turned the History tab
  into a wall of debug-looking `Field: — → value` lines.

  For `action === 'create'` we now render a single `▸ N fields
populated` disclosure that expands on click. The expanded view shows
  just `Field: value` (no useless `— →` arrow), since for a creation
  event the "from" is implicitly empty.

  UPDATE / DELETE events are unchanged — their field diffs are
  genuinely informative.

- 86c04f1: Phase Q: unify record-detail visual rhythm — one canvas, one box idiom.

  Audit revealed three competing chrome treatments fighting on the same
  page: the highlight strip was a filled Card, the discussion panel was
  another filled Card, the related-list cards used heavy borders — while
  the title chip, field grid, and history timeline were naked. The
  result was visually noisy ("有的下划线，有的有边框，有的没边框").

  This change commits to a single design language:

  - **Highlights** (`HeaderHighlight`): drop the `Card`/`CardContent`
    wrapper. Render as a borderless `<section>` of stat cells with a
    subtle `border-b` separator. The tab strip below now carries the
    only visible anchor in that vertical band.
  - **Discussion / activity feed** (`RecordActivityTimeline`): drop the
    `Card`/`CardHeader`/`CardContent` wrapper. Render as a borderless
    `<section>` with a top divider and a semantic `<header>` for the
    title. Right-side chatter panel still wraps with its own border so
    no chrome is lost in pinned mode.
  - **Related list** (`RelatedList`): keep the card grouping (each is a
    table of child records — earned chrome), but tone it down to
    `border-border/60 bg-transparent` so the boxes recede instead of
    competing with the rest of the canvas.

  Net effect: title / highlights / details / history sit on one
  continuous bg-background canvas separated by whitespace + hairline
  dividers; related lists are the one (subtle) boxed treatment, justified
  by their tabular content. No internal package APIs changed.

- 74962b0: feat(detail): record:discussion schema component + flush accordion variant

  - New `record:discussion` schema type lets authors place the record
    chatter feed anywhere in a custom Page schema. Wired through a
    shared `DiscussionContext` provider on the `assignedPage` branch
    of `RecordDetailView`; auto-append still applies when no explicit
    `record:discussion` / `record:chatter` node is present.
  - `page:accordion` gains a `variant` prop. Default `flush` strips the
    per-item border so accordion sections no longer double-wrap inner
    Card-bearing renderers (RelatedList, etc.). Authors who want the
    old visual pass `variant: 'card'`.
  - `translateLabel` now handles compound labels split by `&`, `and`,
    or `和` (e.g. `Notes & Attachments` → `备注与附件`).

- 8b850b5: feat(detail): record:path chevron stepper + record:highlights surface refresh (Phase E)

  - `record:path` now renders Salesforce Lightning-style chevron segments
    (clip-path arrows + overlap) with a primary glow on the current step
    and a check mark on completed steps. On mobile (`<sm`) it falls back
    to a horizontally-scrollable pill row that keeps the same semantics
    but never overflows the viewport.
  - `record:highlights` surface drops the dashed border in favour of a
    solid `bg-muted/40` card with a softer border, so the highlights
    strip reads as a continuous extension of the header chip above it
    rather than a separate framed widget.

- fa4c2cb: feat(detail): renderViaSchema opt-in routes default detail through SchemaRenderer (Track 3 Phase G slice 2)

  When `?renderViaSchema=1` is in the URL, or `objectDef.detail.renderViaSchema === true`,
  `RecordDetailView`'s no-assignedPage branch now synthesizes a canonical
  Page schema (`page:header` → `record:highlights` → `record:path` →
  `page:tabs(record:details)` → `record:discussion`) via
  `buildDefaultPageSchema(objectDef, { sections, highlightFields })` and
  renders it through the existing `<SchemaRenderer>` pipeline.

  This means every object without a custom assigned page can opt in to
  the same chrome (record-aware header chip, chevron path, flush
  accordion, discussion slot) that custom Lightning pages already enjoy.

  Changes:

  - `buildDefaultPageSchema` now emits `page:tabs.items` (correct shape
    for the renderer) rather than `tabs`.
  - `PageHeaderRenderer.resolvedTitle` honors `objectSchema.primaryField`
    before the legacy `name/title/display_name/label` fallbacks.
  - `RecordDetailView` rebuilds the synthesized schema with
    `detailSchema.sections` + `highlightFields` at render time so
    `record:details` inherits the same field layout the legacy
    `<DetailView>` would have produced.

  Flag is intentionally off by default — flipping the default is a
  separate explicit commit after empirical parity validation across
  multiple objects. Known gaps tracked for slice 3: titleFormat
  fallback for objects without `primaryField`, auto Activity / History
  tabs, header-action buttons.

- 7213027: feat(detail): slotted record pages (Track 3 Phase I)

  Introduce `kind: "slotted"` record pages that override one or more
  named slots while letting the default-page synthesizer fill in the
  rest. Authors no longer need to re-author the entire page just to
  customize the header or one tab.

  **Slot menu (v1):**

  - `header` — replaces `page:header`
  - `actions` — replaces the `record:quick_actions` action bar
  - `highlights` — replaces the chips + chevron path strip
  - `details` — replaces the Details tab body (other tabs stay synthesized)
  - `tabs` — replaces the entire `page:tabs` node (wins over `details`)
  - `discussion` — replaces the inline `record:discussion` footer

  Each slot is a full replacement at the slot boundary. To compose
  default + custom, call the corresponding `buildDefault*` sub-builder
  (now exported from `@object-ui/plugin-detail`):
  `buildDefaultHeader`, `buildDefaultActions`, `buildDefaultHighlights`,
  `buildDefaultDetails`, `buildDefaultTabs`, `buildDefaultDiscussion`.

  **Author shape:**

  ```ts
  {
    type: 'record',
    object: 'account',
    kind: 'slotted',
    slots: {
      header: { type: 'page:header', properties: { ... } },
    },
  }
  ```

  **API changes:**

  - `PageSchema` (in `@object-ui/types`): adds `kind?: 'full' | 'slotted'`
    (default `'full'`) and `slots?: PageSlotMap`.
  - `usePageAssignment` (in `@object-ui/react`): result now exposes a
    `slots` field populated when the matched page has `kind === 'slotted'`.
    Existing `page` field is unchanged for full pages.
  - `buildDefaultPageSchema` (in `@object-ui/plugin-detail`): accepts an
    `options.slots` map that overrides individual regions at synthesis time.

- 34b66bf: feat(detail): synthesize Related / Activity / History tabs + record:quick_actions header (Track 3 Phase G slice 4)

  - `buildDefaultPageSchema` now accepts `headerActions`, `related`,
    `showActivity`, and `history` options. When provided, the synthesizer
    emits a `record:quick_actions` node after `page:header` and appends
    the corresponding tabs to `page:tabs.items` in stable order
    (Details / Related / Activity / History).
  - New `record:history` renderer wraps the existing `HistoryTimeline`,
    reading `entries` / `loading` from the schema. Host owns fetching.
  - `RecordDetailView` forwards `detailSchema.actions[0].actions`,
    `detailSchema.related[]` (unwrapped to `{objectName,relationshipField}`),
    and `detailSchema.history` into the synthesizer call so the
    `renderViaSchema` path reaches parity with the monolithic DetailView
    tab strip and header action bar.
  - 6 new unit tests covering headerActions emit/skip, Related tab
    shape, Activity opt-in, History entries pass-through, and stable
    tab ordering.

  No behavior change for objects without the `renderViaSchema` opt-in.

### Patch Changes

- f16a762: feat(plugin-detail): cross-object detail-page convergence polish (Phase J)

  Two regression fixes surfaced by the Phase J browser canary across CRM
  record detail pages:

  1. **`record:path` now localizes stage labels.** The renderer threads
     `useSafeFieldLabel().translateOptions` against the record-context's
     `objectName` + the schema's `statusField`, so picklist labels match the
     active locale instead of leaking English (`New / Contacted / Qualified`)
     onto zh-CN pages. Falls back to the schema's authored labels when no
     i18n provider is mounted.
  2. **`deriveHighlightFields` skips system + primary fields.** Adds
     `organization_id`, `workspace_id`, `tenant_id`, `created_by`,
     `updated_by`, `deleted_by` to the skip set so the synthesized highlight
     strip stops leaking an orphan "CRM Test's Workspace" chip with no
     visible field label. Also skips the object's `primaryField` and common
     title-field candidates (`name`, `full_name`, `title`, `subject`,
     `display_name`) so the strip never duplicates the page H1.

  `ObjectDefLike` gains an optional `primaryField` declaration to drive the
  new skip behavior. No spec changes; the field is already part of the
  upstream object schema.

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
  - @object-ui/fields@5.0.0
  - @object-ui/core@5.0.0
  - @object-ui/permissions@5.0.0

## 4.8.0

### Minor Changes

- 06a4066: Mobile: render related sub-tables on record detail pages as a single-column
  gallery of cards (reusing the existing `object-gallery` renderer) instead of
  cramped multi-column tables. Non-first related sections start collapsed on
  mobile to keep the page scannable. Desktop behavior is unchanged. Touch
  targets on the section "+ 新建" button and header are enlarged on mobile.

## 4.7.0

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

### Minor Changes

- ab5e281: `record:highlights` renderer normalizes rich field items.

  `RecordHighlightsComponentProps.fields` is now `Array<string | { name, label?, icon?, type? }>`. The renderer normalizes both forms before passing to `HeaderHighlight`, so schemas can attach per-instance label/icon overrides without editing the underlying object metadata. FLS and `redactFields` still apply on the normalized list.

### Patch Changes

- d714e85: Lookup display-name resolution now falls back through a Salesforce-style chain
  when an `$expand`'d reference object lacks a top-level `name`/`label`/
  `display_name`/`title` field:

  1. Standard display fields (existing behaviour)
  2. `salutation first_name last_name` composite — handles person records that
     only carry first/last name parts
  3. `email` — last-resort identifier, beats the opaque id

  Applies to `LookupCellRenderer`, `PageHeader.subtitle` interpolation,
  `DetailView` page-mode `titleFormat`, and the shared `formatRecordTitle`
  utility. Concretely: a Contact reference with `first_name: Bob`, `last_name:
Lin` and no `name` field now renders as `Bob Lin` everywhere — instead of
  the email or [object Object] fallback.

## 4.4.0

### Patch Changes

- 67dabe1: feat(page-header): first-class `actions` property on page:header

  PageHeader now accepts an `actions: ActionDef[]` (or string[]) property
  and renders the toolbar inline in the header's right-aligned action slot.
  Removes the need for authors to declare a sibling `record:quick_actions`
  node and the `-mt-12` visual offset hack to pair the toolbar with the
  title. The hack still applies for legacy schemas using the sibling form
  (via location:'record_header'); the new in-header rendering opts out via
  an `inline: true` flag automatically set by PageHeader.

- e33d575: Support dotted paths (e.g. `{account.name}`) in object `titleFormat`. When a
  placeholder resolves to an expanded reference object, automatically extract
  its `name`/`label`/`display_name`/`title` so detail page titles render the
  related record's display name instead of falling through to the object label.

## 4.3.1

### Patch Changes

- 0d8eb98: feat(detail): Salesforce-style record header + section field grid

  - `page:header` now renders an icon chip (resolves Lucide names via
    `LazyIcon`) plus subtitle, so detail pages can show
    "Name / Company" without an extra component.
  - `record:details` normalises string field entries (`fields: ['email']`)
    into the `{name, label?}` shape expected by `DetailSection`, and maps
    section `label` → `title`. Schemas authored against `@objectstack/spec`
    now produce a real grouped field grid instead of an empty card.

- b0bc410: feat(detail): pair quick actions with header, suppress duplicate title chip
  - `record:quick_actions` placed at `record_header` now visually pairs
    with the surrounding `page:header` (Salesforce Lightning placement)
    instead of orphaning into its own row below the title.
  - `record:details` defaults to `showHeader: false` on the inner
    DetailView so embedded record pages no longer render a duplicate
    title chip + star/copy buttons under the page header. The legacy
    standalone DetailView screens are unaffected (showHeader defaults
    to true on that direct path).

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

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
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

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/react@2.0.0
  - @object-ui/components@2.0.0
