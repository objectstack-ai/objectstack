# @object-ui/fields

## 18.1.0

### Patch Changes

- 8701f1e: The record page heading draws a `nameField` that declares a widget with a read face of its own through that face, the one the field's list column draws (objectui#13216). A record share (`nameField: 'recipient_id'`, which declares `widget: 'recipient-picker'` and `dependsOn: ['recipient_type']`) now heads its page with the recipient's name instead of the user id it stores. Every other heading is unchanged: a plain text or select `nameField`, a `titleFormat`, an explicit `title`, an object with no `nameField`, a widget with no read face of its own, a widget whose key has no face registered under it (it draws the stored text), and a host that does not load `@object-ui/fields`.
  
  `@object-ui/components` adds a field-face seam on its entry: `setFieldReadFaceResolver(resolver)` installs the resolver, `resolveFieldReadFace(field)` asks it, and the types `FieldReadFace`, `FieldReadFaceProps` and `FieldReadFaceResolver` describe them. `@object-ui/fields` fills it when it loads, with the same `getCellRenderer(resolveCellRendererType(field))` lookup the grid's cells make, so a host has nothing to wire. `RecordTitleChip` gains an optional `titleNode` prop, drawn inside its heading in place of the `title` text; `title` stays a required string.
- 8e649da: A row action's `defaultFromRow` param backed by a relation is seeded with the related record's id again, not the whole record (objectui#13271).
  
  Related lists read their rows with the relations they show expanded, so a `lookup`, `master_detail`, `user` or `tree` value arrives as the related record. The param seed copied that record verbatim, and the action sent it where the endpoint expects the id. Setup → Teams → Remove from Team answered 400 "User is not a member of the organization" for every member.
  
  The seed now uses the row's stored form, by the same field-type rule the predicate and Undo paths use: a field the row's object declares relational becomes its id, and a `multiple` one becomes the array of ids. Every other field, including a `json` value that has an `id` key, is seeded exactly as before. The dialog still shows the related record's name. Nothing is added to the package entry.
- 813c3d9: A password or secret input now tells the browser what it is for (objectui#13295).
  
  The password widget's editable input carries an `autocomplete` token. A field or action parameter whose name reads as the user's existing password (a word `current`, `old` or `existing` in the name, as in `current_password` or `oldPassword`) gets `current-password`; every other password or secret gets `new-password`. Before, the input had no token, so a browser treated each one as a sign-in field: it offered the saved site password for an API key or a new password, and its password manager could not tell the old password from the new one in a change-password dialog. The masked input and its show/hide toggle are unchanged.
- 49a536d: The record header's highlights write the year on every date (objectui#13331).
  
  A current-year date dropped its year in the strip, so a contract record read "Start Date Sep 15, 2025 | End Date Sep 15" and a contract that ended this September looked like it ended next month. The strip now asks for the year, and both dates read alike. Dates inside the ±7-day window keep their relative phrase ("In 2 days").
  
  `formatDate` takes a new opt-in option, `alwaysShowYear`, which keeps the year on its default face; the `date` and `datetime` cell renderers take an `alwaysShowYear` prop that hands it on. Neither is on by default: grid cells and cards still drop the current year.
- ec627ab: A lookup / master-detail / tree value whose referenced record the viewer's own read answers "not found" for (a 404, which is what the server answers for a record this viewer may not read) now reads "Restricted record", translated, with a lock icon, no record id and no link, in grids and on the record page (objectui#13335). It used to print the raw id beside a question mark. No additional read is made: the label comes from the same lookup read the cell already performed, so it reveals nothing the id did not. A reference that is still loading, whose read failed, or that is empty renders as before, and a readable reference still shows its name as a link. New key: `detail.restrictedLookupReference` in all ten locale packs.
- cee3bc5: A boolean renders the same whatever its name (objectui#13412). `BooleanCellRenderer` drew a red destructive "LABEL — Off" badge for `false` when the field was named `active`, `is_active`, `enabled`, `is_enabled`, `verified` or `is_verified`, so a plain `Field.boolean` named `verified` read as an error on every new record, in lists and on the record page. Those names now draw the same unchecked checkbox as any other boolean, named by the field's label, and `true` still draws the checked box. The completion indicator for `completed`, `is_completed`, `done` and `is_done` is unchanged.
- f3044f7: `html` and `richtext` values are now sanitized with `rehype-sanitize`, the sanitizer the `markdown` pipeline already used, instead of a hand-written pattern filter.
  
  A stored value is parsed with the browser's HTML parser, filtered against one allow-list of elements, attributes and URL protocols, and rendered as React elements. Both display pipelines share that allow-list. Headings, paragraphs, emphasis, lists, quotes, code, tables, links and images keep their formatting. Event-handler attributes, `style`, script-bearing URLs, embedded frames and objects, and SVG and MathML content are dropped. A link whose URL is refused now renders without an `href`, where it used to point at `#`. Stored `id` and `name` values are prefixed with `user-content-`.
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
  - @object-ui/providers@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- 2abec3a: The `grid` field's eight field-level keys are camelCase now, and their snake_case spellings are retired and refused by name on every face (objectui#11610).
  
  BREAKING (`@object-ui/types`, `@object-ui/fields`): a `grid` field's metadata, and a `form` `fields[]` entry of `type: 'grid'`, must spell these keys in camelCase. (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  - FROM `min_rows` → TO `minRows`
  - FROM `max_rows` → TO `maxRows`
  - FROM `allow_add` → TO `allowAdd`
  - FROM `allow_delete` → TO `allowDelete`
  - FROM `allow_reorder` → TO `allowReorder`
  - FROM `total_field` → TO `totalField`
  - FROM `add_label` → TO `addLabel`
  - FROM `sort_field` → TO `sortField`
  
  Why: `@objectstack/spec`'s runtime form field declares config keys in camelCase only, so it could not declare these keys as they were written (objectstack-ai/objectstack#21704, fork 2, ruled B). There is no alias window and no dual read: no reader reads the snake_case spellings any more, and no stored producer outside this repository's own fixtures, which move with this change, was found to write them.
  
  **Migration.** Rename each key; its value stays the same. `totalField` keeps its meaning: the CHILD column summed into the grid's footer, which is the value a spec `amountField` carries. It is not the parent field the spec's own `totalField` names on a master-detail subform.
  
  What each face does with a snake_case key now:
  
  - **TypeScript.** `GridFieldMetadata` and `FormField` declare each as a `never` member, so an authored value no longer compiles. The camelCase members carry the value types the snake_case members had, and `FormField` still takes each one by reference to `GridFieldMetadata`.
  - **zod (`@object-ui/types/zod`).** NARROWS on the tolerant face (`safeValidateSchema`, which `objectui validate` runs) and on the strict authoring face: a form field entry carrying a snake_case key used to parse with the value kept, and is now refused with one `invalid_type` issue at that key. The message leads with ``Did you mean `min_rows` → `minRows`?`` (each key names its own replacement). WIDENS on both faces: the camelCase keys parse, judged by the same value types.
  - **The `grid` widget (`@object-ui/fields`).** `GridField` reads the camelCase keys only. A field whose metadata still carries a snake_case key is drawn as an inline alert naming each retired key beside its replacement (`role="alert"`, `data-testid="grid-field-retired-keys"`) instead of the grid, and the same text goes to `console.error` once. Nothing is thrown, so the rest of the form still draws, and the rows are not changed.
  
  New export from `@object-ui/types`: `GRID_FIELD_RETIRED_KEYS`, the snake_case to camelCase map that the zod refusals and the widget both read, with its key type `GridFieldRetiredKey`.
  
  `@object-ui/plugin-form`'s master-detail and line-items adapters now hand the grid the camelCase keys, typed against `GridFieldMetadata` instead of cast through `any`. What they draw does not change.
  
  **Clause-②: yes (narrowing)**: the camelCase spellings widen each face, and the snake_case spellings narrow it.
- 22b503c: Read-only boolean values, the boolean list face and the Home greeting's punctuation follow the language (objectui#11689).
  
  Under zh-CN a record showed its boolean values as "Yes" / "No", and the Home greeting joined a Chinese greeting to the person's name with an ASCII comma and closed it with an ASCII period.
  
  - **Booleans.** The read-only surfaces that draw a boolean as a word now read the existing `common.yes` / `common.no` keys: `BooleanField`'s readonly display, a `FormulaField` whose `returnType` is `boolean`, the lookup column's plain-text fallback, and the record-detail highlights chip. zh-CN shows the Chinese words; English is unchanged. Without an `I18nProvider` the words stay "Yes" / "No".
  - **The boolean list face.** `BooleanCellRenderer`, which every list surface draws, spelled its status badge ("Active — Off") and its completion indicator's accessible names ("Completed" / "Not completed") in English. All three now come from the language packs. The grid also handed that face the authored field label while its header printed the translated one, so the badge named the column in the authored language under a translated header. The face now receives the label the header prints.
  - **Greeting.** The comma before the name and the closing mark are two new keys, so zh-CN reads the full-width comma and full stop, Japanese its own marks and Arabic its own comma. English is unchanged, and the name keeps its own colour.
  
  **Widened public surface.**
  
  - `@object-ui/i18n`: five new keys in all ten language packs, so the exported `en` pack and the `TranslationKeys` type derived from it gain `home.greetingSeparator`, `home.greetingEnd`, `fields.boolean.offBadge`, `fields.boolean.completed` and `fields.boolean.notCompleted`.
  - `@object-ui/fields`: a new export, `useBooleanValueLabel()`, with its type `BooleanValueLabel`. It returns the current language's word for a boolean value, and `@object-ui/plugin-detail`'s highlights chip reads it.
- 9fc68aa: Screen readers can name and reach the controls of the view tab bar, the settings form, the sidebar menus, the table's selection column and the percent cell (objectui#11690). axe-core (wcag2a + wcag2aa) on an object list page and on a Setup settings page reported the faults below; each is fixed where it is produced and pinned by an axe run on that component.
  
  - **View tab bar (`ViewTabBar`).** The "+" add-view button is named, through the existing `view.addView` key, and its tooltip reads the same translated words instead of a hard-coded "Add View". Each view is now a `<button>`; the current one carries `aria-current="true"`. The views were `role="tab"` elements with no `tablist`, and the active view's actions button sat inside its tab, so it was a control inside a control. That button is now the view button's sibling, still named "View actions for …" and still one Tab stop away. Tab roles could not hold it: a tab's content is presentational and a tablist may contain only tabs. These views never had the tabs keyboard model (arrow keys, a tab panel) either. Every view stays its own Tab stop. When the bar is not reorderable, as the console renders it, Enter or Space switches to the focused view. With drag-to-reorder on, Enter or Space on a view starts a keyboard drag instead, as it did before this change, so a view is switched to by click. The rename box is now outside the view button and is named through `view.rename`. With drag-to-reorder on, the sortable attributes describe the view as a button. Breaking for anything that queried the bar by `role="tab"` or `aria-selected`: query `data-testid="view-tab-ID"` or `aria-current` instead.
  - **Settings form (`@object-ui/console`).** Each row's label is bound to its control, so text, number, password, textarea, JSON, colour, switch and select controls are named by it. Clicking a label now focuses or toggles its control. A radio group and a multiselect checkbox group are named by the row label too.
  - **Sidebar menus (`NavigationRenderer`).** With drag-to-reorder on (the desktop default), every row was wrapped in a `<div>` between the menu's `<ul>` and its `<li>`. The sortable node is now the row's own `<li>`. A separator and a nested group inside a menu are now list items too: the separator's item is hidden from assistive tech, and a top-level group is unchanged.
  - **Table selection column (`data-table`).** The select-all checkbox and each row's checkbox are named through the existing `table.selectAllRows` and `table.selectRow` keys.
  - **Percent cell (`PercentCellRenderer`).** The progress bar is named by the formatted value beside it (`aria-labelledby`), so the name is in the viewer's locale.
  
  No language-pack key, export or prop is added; every new name reads a key the packs already carried.
- f34e877: A date reads overdue only when its field declares it a deadline, and never once the deadline is settled for the record (objectui#11815).
  
  - **Declared only.** The `date` and `datetime` cells paint the "Overdue Nd" wording and the red colour only for a field that declares `dueLike: true`. The field-name convention that used to turn the affordance on by itself (`due_date`, `deadline`, `expires_at`, `sla_at`, …) is retired: an undeclared date in the past now reads as any past date does, for example "6 days ago". To keep the affordance on such a field, declare `dueLike: true` on it.
  - **Settled.** `CellRendererProps` gains an optional `deadlineSettled` boolean. While it is `true`, both cells paint no overdue wording and no red, and read the neutral relative phrase instead. Absent or `false` changes nothing. The host computes it with `isDeadlineSettled` from `@object-ui/core`.
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- a368ccb: A pointer field draws the record it points at, the console reads an approval request's record page through the approvals routes, and the approval decision panel is built for the request page (objectui#12045, B1 of objectui#2763).
  
  - **The approval decision panel (`@object-ui/app-shell`, module-internal).** One panel that draws the request's decision progress (`DecisionProgressIndicator`) above the request's own declared decision actions (`DeclaredActionsBar` at `record_section`, decided through `ActionParamDialog`). It reads the bound request and takes no authorable props; outside a `sys_approval_request` record page it renders nothing. After a decision it invalidates the request record and its timeline instead of remounting. It is not registered as a component type yet: the type `record:approval_decision` is proposed to the spec on objectstack-ai/objectstack#22472, and its registration lands with the spec row.
  - **`referenceVia` pointer pairs (`@object-ui/fields`).** `resolveRecordPointer(field, row)` returns the record a `text` field declaring `referenceVia` points at on one row (`{ objectName, recordId }`, the new `RecordPointer` type), and `RECORD_POINTER_CARD_TYPE` is the registry key a resolved pair is drawn with. The package's default under that key draws the record id as text, as the field drew before.
  - **The record details grid draws the pair (`@object-ui/plugin-detail`).** A field declaring `referenceVia` is resolved from the row and drawn with the pointer face; with `@object-ui/app-shell` loaded that face is the record preview card, so `sys_approval_request.record_id` and the other pointer fields show the record they point at. A pair whose row leaves either half blank draws the stored text.
  - **The console's approval request page.** The console's record route for `sys_approval_request` mounts the record page over the routed approvals source, so the request carries the `viewer` block its declared actions gate on and the decision tally. The source now reads one request's `sys_approval_action` timeline from `GET /approvals/requests/:id/actions`, applying the read's `$orderby`, `$top` and `$skip` itself, dropping `$select` and `$expand`, and refusing any other parameter with `UNSUPPORTED_QUERY_PARAM`. On a request's own page the record view no longer asks for approvals opened on the request itself.
  
  No language-pack key is added, and `CellRendererProps` is unchanged.
  
  **Superseded in part (objectui#12072):** outside a `sys_approval_request` record page the panel now draws a short localized notice instead of nothing, so the sentence above saying it renders nothing there no longer holds when both changes release together.
  
  **Corrected and superseded in part (objectui#12045, the page-mount step):** the last sentence of the console bullet, that a request's own page no longer asks for approvals opened on the request itself, is an `@object-ui/app-shell` change (the record view's approvals read), not a console one. And the console no longer declares a record route of its own for `sys_approval_request`: every surface that opens a request reads it through the console's adapter with the request's record reads routed, so the console bullet's first sentence describes the route that change replaces, when both release together.
- 29b9949: A bulk action's field-backed param now renders its real control on the selection bar, and the confirm step names the picked record (objectui#12105).
  
  A list view's `bulkActions: ['add_to_campaign']` runs the object's own action over the selected records. When that action declares a field-backed param, `{ field: 'crm_campaign', objectOverride: 'crm_campaign_member' }`, the selection bar's dialog drew a plain text box for it, and the confirm step listed the raw record id. The record page drew the record picker for the same action, because only its dialog looked the field up.
  
  - **One resolver for both dialogs.** The function that resolves an action param against the object's field definitions (`resolveActionParam` / `resolveActionParams`) moves, unchanged, from `@object-ui/app-shell` into `@object-ui/fields`, the one package both dialogs depend on. The record dialog and the bulk dialog both call it. A field-backed param on the selection bar now gets its field's type, label (translated), options, default and picker target, as it does on the record page. A lookup param renders the record picker, and the confirm step shows the record's label.
  - **When it resolves.** The grid resolves a promoted action's params when the dialog opens, after it has loaded the session's object metadata, so a param whose owning object (`objectOverride`) has not loaded yet is waited for.
  - **A missing field is refused, not drawn as a text box.** A field-backed param whose field is not in the object metadata is shown as a refusal naming `object.field`, and the run is blocked, as the record dialog already does. The copy is the existing `actionDialog.unresolvedParam` string.
  - **Inline params are unchanged.** A param declared with its own `name` and `type` keeps the same widget, label, help text, default and `reference` target.
  
  New `@object-ui/fields` exports: `resolveActionParam`, `resolveActionParams`, `resolveParamWidgetType`, `withKnownObjects`, `RESOLVED_ONLY_PARAM_KEYS`, and the types `RawActionParam`, `RawActionParamOption` and `ResolveActionParamsContext`. Before this change these were internal to `@object-ui/app-shell` and were not exported from it. No other export, prop, context member or language-pack key is added.
  
  Not covered yet: on the selection bar, a resolved lookup param uses only its field's picker target, display field and `dependsOn`. The field's other picker settings (`lookupFilters`, `lookupColumns`, `descriptionField` and the rest) do not reach the bulk dialog yet.
- 466a219: The `lookup` widget reads `@objectstack/spec`'s `allowCreate`, `lookupColumns` and `lookupPageSize` alone. Their snake_case twins are retired, with no alias (objectui#12157).
  
  - FROM `allow_create` → TO `allowCreate`
  - FROM `lookup_columns` → TO `lookupColumns`
  - FROM `lookup_page_size` → TO `lookupPageSize`
  
  `LookupField` used to read each snake spelling FIRST, ahead of the key `FieldSchema` declares. That made a second spelling of three keys the spec refuses in snake_case. `resolveActionParams` retires its `lookup_columns` / `lookup_page_size` legs in the same change, so a field-backed lookup action param reads `lookupColumns` / `lookupPageSize` off the resolved field and nothing else.
  
  A definition served through `ObjectStackAdapter.getObjectSchema`, or stored by the console's `MetadataProvider`, loses nothing. The ingestion fold (`normalizeSchemaReferenceKeys`, objectui#7650) stamps a stored snake spelling onto its declared key before the widget or the resolver reads it. Measured in `LookupField.snakeLegsRetired-12157.test.tsx` and `resolveActionParams.remainingLookupLegs-7435.test.ts`: a def that spells only the snake keys, run through that fold, draws the declared picker columns and page size and opts out of quick-create, exactly as the camelCase def does.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  A def that reaches the widget or the resolver WITHOUT the fold, and spells only a snake key, loses that setting. That covers a field def handed to `LookupField` directly (a hand-authored `form` field entry is one), a `DataSource` other than `ObjectStackAdapter`, and `resolveActionParams` given a host's own, unfolded `objects`. Measured on such a def, in the same two pins:
  
  - **`lookup_columns` / `lookup_page_size`.** The browse-all picker draws the columns derived from the referenced object, on the default page of 10, exactly as for a def that sets neither key.
  - **`allow_create: false` on a user-facing reference.** The quick-select offers "Create new" again, which is the widget's default for such a reference. It used to be suppressed.
  - **The action-param resolver.** The resolved param carries no `lookupColumns` / `lookupPageSize`.
  
  **Fix:** spell the key in camelCase (the value stays the same), or serve the definition through `ObjectStackAdapter` / `MetadataProvider`. (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  **Clause-②: yes (narrowing)**: three accepted spellings are retired from the widget and the resolver.
- 923504f: A field-backed action param's help line reads the field's `inlineHelpText`, through the one read the record form uses, and no longer reads a field's `help` (objectui#12213).
  
  When an action param backed by a field (`{ field: 'x' }`) declares no `helpText` of its own, `resolveActionParam` gives it the field's help text. It read `help`, then `description`, and never `@objectstack/spec`'s `FieldSchema.inlineHelpText`, the key Studio writes.
  
  - FROM `param.helpText ?? field.help ?? field.description` → TO `param.helpText ?? fieldHelpText(field)`, which reads `field.inlineHelpText || field.description`
  
  The param's own `helpText` still wins. An empty string on the field reads as absent, as it does on the record form, so the next key is used.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  Translated field help on a field-backed param needs an objectstack server on `@objectstack/spec` 17.7.0 or later (objectstack-ai/objectstack `bab76850c`, objectstack-ai/objectstack#21956). `FieldSchema` refuses `help` as an authoring key, and its one producer was a server on spec 17.6.0 or earlier, whose translator put a field's translated description on the served field's `help` key. 17.7.0 serves that text on `description`, which is read. Against an older server, the param's help line shows the field's `description` as the server stores it, untranslated, and a field whose only help is a served `help` key lends none. Fix: run the server on spec 17.7.0 or later, within the same major. (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
- 5b45c0d: `@object-ui/fields` exports `fieldHelpText(field)`, the one read of the help line a field draws under its control (objectui#12213).
  
  It reads `@objectstack/spec`'s `inlineHelpText`, then `description`, an empty string reading as absent, and never `help`. The record form (`@object-ui/plugin-form`, for `ObjectForm`'s field builder and `fromObjectSchema`) and `resolveActionParam` both call it, so the order has one home. It used to be a package-internal function of `@object-ui/plugin-form`, which `resolveActionParam` cannot import, so the resolver restated the order by hand. Its parameter is typed as `BaseFieldMetadata`'s `inlineHelpText` and `description` members (`@object-ui/types`); a typed literal that also carries `help` does not compile.
  
  **Clause-②: yes**: one export joins this package's public surface, `fieldHelpText`, and the read it carries accepts a field's `inlineHelpText` and `description` only.
- 5d3f437: `buildValidationRules` stops compiling a field-level `pattern` / `pattern_message` and `validate` (objectui#12242, maintainer ruling A). `@objectstack/spec`'s `FieldSchema` refuses all three keys by name, so no published object carries them, and `@object-ui/types` retires them as `never` tombstones.
  
  - FROM: a field metadata object carrying `pattern` (a string or a `RegExp`) produced a `pattern` rule, with `pattern_message` as its message, and one carrying `validate` produced a `validate` rule (on a `location` field, beside the stored-value check).
  - TO: neither is read. A `location` field's rule is the stored-value check alone. An `email` or `url` field still gets its own format rule, and `minLength` / `maxLength` / `min` / `max` / `required` are unchanged.
  
  A regex check on an object is its `format` validation rule, `{ type: 'format', name, field, regex, message }`, which the server runs on every write that touches the field and refuses with the rule's `message`. No client pre-check of that rule is added.
  
  `mobile_fullscreen` is typed for `TextAreaField` and `RichTextField` on a package-local hand-off, since the field metadata types no longer declare it, and `LookupField` reads `idField` / `picker` / `subtitle` through `FormField`'s declaration of them. Both are type-only: the widgets read the same keys as before.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  A host that hand-writes field metadata in code with `pattern` or `validate` loses that client-side check on the form: the value is submitted, and only a `format` rule on the object refuses it, on the server. Declare the check on the object. (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
- 065a1cf: A file the reader may not open now renders a restricted state instead of a generic file chip (objectui#12339).
  
  When a reader may read a record but not a file's `sys_file` metadata, the platform sends the file field's value as `{ id, metadataRefused: true }` (`FileRefusedValueSchema` in `@objectstack/spec/data`, spec `18.0.0-next.0`). `readFileValue` used to read it as an ordinary file named `File`. It now recognises the marker by the spec's closed schema and flags the view.
  
  - **Public type widening:** `FileValueView` gains an optional `metadataRefused?: true`. It is set only for the refused marker, so existing consumers are unaffected.
  - **What users see:** the `file` grid cell, the read-only `FileField` list and its edit rows, `FileCell`, `ImageField`, the `image` / `avatar` grid cell and `AvatarField` show a lock and a translated "Restricted file" label. They never attempt a thumbnail, because no MIME type was served. Where the renderer offers an open link, it still points to the id-derived download endpoint, which decides access on its own and may answer `403 FILE_DOWNLOAD_DENIED`. Normal file values render as before.
  - **Submitting:** when an editable `FileField`, `FileCell` or `ImageField` re-submits the field's other values (append, remove, crop), it sends the marker back as its bare id, never as the marker object.
  - **i18n:** two new keys, `fields.file.restricted` and `fields.file.restrictedHint`, in all ten locales.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
- 023087f: `resolveRecordPointer` reads `referenceDeletedWhen`, so a pointer pair can say the platform deleted its target (objectui#12489).
  
  `@objectstack/spec`'s `FieldSchema.referenceDeletedWhen: { field, value }` sits beside `referenceVia` and names a sibling `select` field and one of its options. On a row whose sibling holds that option, the platform has asserted that the record the pointer names was deleted. `resolveRecordPointer(field, row, optionsOf)` now evaluates that predicate in the same call that resolves the pair. When it holds, the pair comes back with `deletedLabel`, the declared option's label taken from `optionsOf(field)`, the option list the call site draws `select` cells with. With no `optionsOf`, or no option with that value, the pair comes back as before. The spec refuses an undeclared option at parse, and the raw option value is never used as the text.
  
  The default face under `RECORD_POINTER_CARD_TYPE` draws `deletedLabel` in place of the record id. A field without `referenceDeletedWhen`, or a row whose sibling holds anything else, draws exactly as before.
  
  **Clause-②: yes (widening)**: the exported `RecordPointer` type gains the optional `deletedLabel`, `resolveRecordPointer`'s field parameter gains the optional `referenceDeletedWhen`, and the function gains an optional third parameter, `optionsOf`. Nothing narrows: every existing argument and return shape still type-checks and resolves as before. No new export.
- 278bc29: A list names what an `object-ref` or `recipient-picker` field references, instead of printing its api name (objectui#12613). The Sharing Rules list read `crm_account` and `sales_manager` where the edit form reads "Account" and "Sales Manager".
  
  - **The declared `widget` picks the read cell (`@object-ui/fields`).** `resolveCellRendererType` now promotes a textual field declaring `widget: 'object-ref'` or `widget: 'recipient-picker'` to a cell key of that name, the same second step a `format` hint takes. Both keys are registered with the stored text as their default face, as `RECORD_POINTER_CARD_TYPE` is. A widget with no read cell of its own (`filter-condition`, `position-ref`, …) still draws as its `type`, and nothing is keyed on an object or field name.
  - **`CellRendererProps` gains one optional member, `dependentValues`**: the row's values, the cell-side counterpart of the edit widget's `dependentValues`. `ObjectGrid` (`@object-ui/plugin-grid`) passes the row, and the widget hint, on every column path. A call site that passes nothing draws the stored text exactly as before.
  - **The edit widgets' kind table and spellings are published** so a host face names a value as the widgets do: `RECIPIENT_RECORD_KINDS`, `RECIPIENT_REGISTRY_KINDS`, `FIELD_RECIPIENT_TYPE`, `recipientCandidateLabel` and `objectRefOptionLabel`, plus the shared `UnresolvedReferenceMark` drawing. `ObjectRefField` and `RecipientPickerField` read through them and list and store exactly what they did.
  - **The console's faces (`@object-ui/app-shell`)** register under the two keys and load lazily, on the first cell that draws one, so a page without such a column pays nothing on load. `object-ref` draws the object's icon and label from the console's metadata store (the same object list the picker offers), the label translated through the app bundle like every other object label, with the picker's `Label (name)` spelling as its tooltip. `recipient-picker` draws the label of the user, team, business unit, position or user column the stored value names: record recipients by their exact id, one `$in` query per kind for the whole page, with the fields the viewer may not read left out of the label; positions from the metadata store; the `field` kind from the shared object's schema.
  - **A value nothing names** (a deleted record, a renamed object, a read the viewer is refused) draws as the raw stored value, muted, with the shared unresolved-reference mark. It is never blank.
  
  Stored values do not change.
- 35a2b59: The result type of this package's `toDomProps` is declared and exported as `FieldDomProps` instead of `DomProps` (objectui#6349, batch 11). `@object-ui/core` publishes a different `DomProps`: its general DOM pass-through type, whose default key set forwards `role`, where this package's forwards `name` and `disabled` instead. One exported name stood for two key sets across the two packages, and core keeps it. `FieldDomProps` is not `FieldWidgetDomProps`: that one is the field widget contract's DOM block, the keys a widget may receive; `FieldDomProps` is the generic result of `toDomProps` for whatever props it is handed.
  
  **Type change, breaking for some consumers.** `DomProps` is no longer exported from `@object-ui/fields`. Replace `import type { DomProps } from '@object-ui/fields'` with `FieldDomProps`; it takes the same one type argument and is the same type. The old import fails to compile with TS2724 ("has no exported member named 'DomProps'"). That error's "Did you mean" names the `toDomProps` function, not the replacement; using the function's name as a type fails too (TS2749), so write `FieldDomProps`. The `toDomProps` function keeps its name, and what it forwards is unchanged.
  
  No runtime behaviour changes.
- d328698: `FIELD_WIDGET_LABELLING` is typed against `@object-ui/core`'s `RegistryComponentMeta['labelling']` instead of `ComponentMeta['labelling']` (objectui#6349, batch 4). `@object-ui/core`'s `ComponentMeta` is now the general component metadata and no longer carries `labelling`; the registration type that does is `RegistryComponentMeta`.
  
  **Breaking-change note.** Nothing breaks for a consumer of this package: the export's value type still resolves to the same `'control' | 'group' | 'display'` vocabulary, and no runtime behaviour changes. The breaking half of this rename is `@object-ui/core`'s, recorded in its changeset.
- 53ee2f8: The capability select lists the capability registry, and the permission-set editor's provenance badge reads the layered envelope (objectui#7611, objectstack ADR-0131 D3/D7).
  
  - **`CapabilityMultiSelectField` lists the registry.** Its options are the `capability` items of the console metadata store (`GET /api/v1/meta/capability`): the platform's curated capabilities beside every capability a package declares. They are read through `MetadataCtx` `ensureType`, the reader the sharing-rule recipient picker uses for positions. It no longer asks a data source for `sys_capability` rows. Nothing writes such a row any more, so on a fresh database the picker offered only the capabilities the set already granted, and none could be added. No second list is merged in. A granted name the registry does not serve is still shown, selected, under "Other". The props are unchanged; the `dataSource` prop is no longer read. Without a metadata store mounted, the picker offers only the set's own selections and loads nothing. On a framework from before objectstack#22669, the registry serves the package-declared capabilities only, so the platform's curated ones are offered only where the set already grants them.
  - **The provenance badge.** In the permission-set editor, a set a code package ships now reads "Package" beside its read-only lock. It read "Custom" in the Setup catalog, because the registry serves no `managedBy` and that scope passes no `packageId`. The badge now also reads the layered envelope's verdict that the lock reads. A set authored in the environment, an organization-authored set and a published organization set still read "Custom".
  - **The Capabilities page.** `…/metadata/capability?scope=environment` lists the capability registry read-only, with no create affordance and no active switch, because the type offers no runtime write channel and a capability has no activation. Nothing about that page changes here; `SETUP_CATALOG_TYPES` keeps `capability` out of the switch on purpose, and its documentation now says why.
- 088e0f7: A record-form field can name one item of a metadata registry by its machine name: a `text` field that declares `widget: 'position-ref'` lists the position registry, and one that declares `widget: 'permission-ref'` lists the permission-set registry. It stores the name only (objectui#7611, ruling B2 on objectstack#22865). This is the mechanism the metadata forms' `ref-multi:permission` picker brought in (objectui#12126), now reachable from an ObjectQL object field. A grant table's name field (`sys_user_position`'s position, `sys_user_permission_set.permission_set`) can now offer the declared items instead of a box for a typed name.
  
  - **The widget (`@object-ui/fields`).** `field:position-ref` and `field:permission-ref`, one key per registry type, with the type in the key, as `object-ref` carries `object`. Like every `widget` value, the name is looked up as `field:<widget>`. Each item reads as its label beside its name, and a pick writes the name: no label, no id. A stored name the loaded registry does not list stays on screen as its own option, flagged *not found*. The four catalog arms follow the metadata forms' `ref:dataset` / `ref-multi:<type>` pickers. With no data source that can list a registry, the field is a text box for the typed name. While the list loads, the stored name sits in a disabled box. When the load fails, a notice names the failure and its cause, and the text box stays enabled. A loaded but empty registry gives the same text box. Neither key is a declarable field type: both are widget hints, like `object-ref`.
  - **The catalog (`@object-ui/types`, `@object-ui/data-objectstack`).** `DataSource` gains an optional `listMetadataItems(type)`, answering `{ name, label }` headers for one registry type. An empty array is authoritative ("this registry has no item of this type"), so a failed load must reject, never resolve `[]`. `ObjectStackAdapter` implements it over `GET /api/v1/meta/:type` (the client's `meta.getItems`). It rejects with the transport's error, and refuses an answer that carries no `items` list. It is uncached, so an item authored in Studio shows on the next form.
  - **Locale keys (`@object-ui/i18n`).** `fields.registryRef.loadFailed` and `fields.registryRef.notFound`, in all ten packs.
  - **Wiring.** The form renderer threads `dataSource` to both keys, as it does for the other widget-hint pickers (`@object-ui/components`). The inline-grid exclusion set and the action-param value-shape table list both keys as widget-hint-only (`@object-ui/fields`, `@object-ui/app-shell`). The CLI's generated `KNOWN_SCHEMA_TYPES` gains `field:position-ref` and `field:permission-ref` (`@object-ui/cli`). A comment in `@object-ui/core` stops counting the picker names.
  
  **Clause-②: yes (widening)**: one optional `DataSource` member, two registered `field:` keys (the `RegisteredFieldWidgetType` union and `FORM_FIELD_TYPES` gain two members), and two locale keys. Nothing narrows: a field without the hint renders exactly as before.
- 0df67f2: The Setup catalog for positions and permission sets reads the registry. It is built from the metadata-admin list and editors in their environment scope, not from new pages (objectui#7611, objectstack ADR-0131 D3/D7).
  
  - **The environment scope (`?scope=environment`).** `…/metadata/position` and `…/metadata/permission` with this parameter list every item the registry serves for the type, including the platform's own sets. Without it, the list shows one project package's items, as Studio does. Every link the pages emit keeps the scope: the item links, the create link and the editor's breadcrumb. `ENVIRONMENT_SCOPE_QUERY` is exported for hosts that route their own URLs onto it.
  - **Gated for Setup.** A caller without `manage_metadata` gets no create affordance on the list and a read-only editor, and the page says why. Under `single`, the reason is that the platform administrator defines these items and the caller's organization assigns them. Under a wall, it is that the operator defines them for every organization. The generic editor and the permission-set editor now apply this caller gate wherever they render. The metadata door refuses that caller's save anyway; this states the refusal before the click.
  - **The active switch.** The catalog list has an active column and an active/inactive filter. Both show the activation ledger's state (`sys_metadata_activation`), which is what the authorization resolver reads; an item with no ledger row is active. The switch writes through the ledger's door, `POST /api/v1/security/_activation/:type/:name` with `{ enabled }`, so switching a set or a position off takes it away from its holders, and switching it on gives it back. It reads and writes no catalog row, so the catalog row's own `active` column is neither shown nor changed. The door's refusals are shown in the server's own words. The audience anchors `everyone` and `guest`, which the door refuses to switch, show a disabled switch and the reason. The door is objectstack's ADR-0131 stage 2c.
  - **Holders.** In the environment scope, the permission-set editor shows who holds the set under its definition, and the position editor shows who holds the position. A set's holders are read by name: grants come from the `permission_set` column, and the positions that distribute the set come from the registry's position definitions (`permissionSets`). They are no longer read from `sys_position_permission_set` or `sys_position` rows, so on a framework from before objectstack's ADR-0131 stage 1, where positions declare no `permissionSets`, a set lists no holders through a position. A position is assigned by its name.
  - **The sharing-rule recipient picker lists the `position` registry** through the console's metadata store. It no longer reads `sys_position` rows. Without a metadata store mounted, the `position` kind falls back to the plain text input.
  - **The console's `system/roles`, `system/positions` and `system/permissions`** now go to the catalog list, not to the object pages.

### Patch Changes

- 055d350: Two cells now draw the right text (objectui#11683).
  
  - **Formula cell (`FormulaCellRenderer`).** A numeric result is drawn by `NumberCellRenderer`, so it is grouped in the viewer's locale and set in the number cell's tabular figures, no longer printed raw in monospace: a formula with no `returnType` holding `200000` reads `200,000` in en-US and zh-CN. A result counts as numeric when the field declares `returnType: 'number'`, or when it declares no `returnType` and the value is a JS number. A declared `scale` sets the width, as on a number field. A string of digits from a formula with no `returnType` stays text, and any other declared `returnType` is drawn as before. `summary` fields use this renderer, so a numeric roll-up is formatted the same way. No type is inferred from the formula's expression or its inputs: the spec's `returnType` has no currency value, so a formula over currency fields reads as a plain number.
  - **Datetime cell (`DateTimeCellRenderer`).** On the compact face, the default, the date and the time are separated by a space in the text, not by a margin alone. Copied text, screen readers and `textContent` get `10/6/2026 1:42 am` (en-US) and `2026/10/6 上午1:42` (zh-CN) where they got the two halves run together. The text is now exactly what `formatDateTime(value, { style: 'compact' })` returns. The time keeps its muted colour; its margin narrows from `ml-2` to `ml-1` beside the space.
  
  No export, prop or language-pack key is added.
- db4cb6b: A `composite` or `record` field value reads as labelled sub-values, not as its stored JSON (objectui#11697). On the record page, and in every grid cell that draws from the same cell-renderer table, a composite value such as `{"width":10,"height":20}` showed as raw JSON in a monospace face. It now reads `Width 10 · Height 20`. A record value reads one labelled group per entry name, so `{ primary: { name: "A", score: 9 }, backup: { name: "B", score: 7 } }` reads `Primary (Name A · Score 9) · Backup (Name B · Score 7)`. A record entry that is not a sub-object reads as a pair.
  
  - **Labels** are the humanized key. The field metadata has no sub-field declaration to read one from: `@objectstack/spec`'s field schema declares none for these types and refuses `fields` / `subFields` as unrecognized keys.
  - **Sub-values.** A number is formatted as the number cell formats a field with no declared `scale`, and a boolean reads as Yes / No in the reader's language. A string reads as itself and an unset sub-value as the shared "No value" dash. An object or array nested inside a sub-value stays compact JSON.
  - **One line.** The value is one truncated line in the grid, on the record page and in the summary chip, with the full text in its `title`. It is a description list, so a screen reader reads term and value pairs.
  - **Unchanged.** An empty value, `[]`, `{}` and a non-object value read exactly as the JSON cell reads them, and a string holding JSON is never parsed. `json` and `object` keep the JSON cell. The record page's copy button still copies the stored JSON.
  
  Nothing is added to the package entry: no export, prop, type member or language-pack key. The new renderer is module-local and is reached through `getCellRenderer('composite')` and `getCellRenderer('record')`.
- c0862c1: The capability picker labels `view_all_audit_log`, the platform capability `@objectstack/spec` 17.7.0 adds to `PLATFORM_CAPABILITIES` (objectui#11717). Without the label it showed the registry's English text in every locale. All ten locale packs carry the label.
- 4c0de52: A formula reads the same in a read-only form and in a table cell (objectui#11748).
  
  The read-only form face (`FormulaField`) and the table cell (`FormulaCellRenderer`) formatted a formula's value separately, so one stored value read two ways. The form printed a number raw or with two fixed decimals, in monospace (`200000`, `200000.00`), where the cell read `200,000`. The cell printed a declared boolean or date raw (`true`, `2026-07-04`), where the form read `Yes` and `Jul 4`.
  
  Both faces now use one rule. The type is the field's declared `returnType`. With no `returnType`, a JS number is a number and any other value is text. No type is inferred from the expression. Each type is drawn the way the matching field type draws it:
  
  - **number**: formatted in the viewer's locale, at the width a declared `scale` gives, as on a number field. `200000` reads `200,000` in en-US and zh-CN in both faces; two fixed decimals are no longer added.
  - **boolean**: the language's Yes / No word in both faces (`是` / `否` in zh-CN). The cell no longer prints `true`. Only a JS boolean counts, as on a boolean field. A non-boolean value draws the empty-value mark, where the form used to read `Yes` for the string `'false'`.
  - **date**: the date field's read-only face, `formatDate`'s default (`Jul 4`, or `Jul 4, 2020` outside the current year), in both faces. The cell does not use the date cell's relative face (`Today`, `2 days ago`), because the form has no relative face to match. An unparsable value draws the empty-value mark.
  - **text**: the value in monospace, as before. The form now prints it the way the cell does: an empty string or empty list draws the empty-value mark, where the form drew a blank, and an expanded record reads its name, where the form printed `[object Object]`.
  
  objectui#11683 changed the cell for numbers only and left a declared boolean or date as it was. This change converts both.
  
  No export, prop or language-pack key is added. The `returnType` doc comments in `@object-ui/types`, on `FormulaFieldMetadata` and on the form field, now describe this rule for both faces in place of the retired two-decimal face.
- a80fef7: A summary (roll-up) field reads the same in a read-only form and in a table cell (objectui#11752).
  
  The read-only form face (`SummaryField`) formatted the value by the roll-up's aggregation function: a `count` as it arrived, a `sum` / `avg` / `min` / `max` at two fixed decimals. The table cell, which `summary` shares with `formula`, draws a number as the number cell does. So one stored value read two ways: a `sum` over `15750.5` read `15750.50` in the form and `15,750.5` in the cell, and a `count` of `12000` read `12000` and `12,000`.
  
  The form face now reads the value the way the cell does, whatever the function:
  
  - **number**: formatted as a number field formats it, in the viewer's display locale. With no `scale` on the field the value keeps its own precision, so `15750.5` reads `15,750.5` and a `count` of `12000` reads `12,000` in en-US and zh-CN, in both faces. A count stays whole. A `scale` on the field fixes the width in both faces (`scale: 2` reads `15,750.50`). Two fixed decimals are no longer added, so an average reads at its own precision unless the field declares a `scale`.
  - **empty**: an empty string or empty list draws the empty-value mark, as in the cell, where the form drew a blank. A stored `0` (a `count` or `sum` over no child rows) reads `0`, where the form read `0.00`.
  - **anything else**: the value as text, as the cell prints it.
  
  No export, prop or language-pack key is added. The `summaryOperations` doc comments in `@object-ui/types`, on `SummaryFieldMetadata` and on the form field, now describe this rule in place of the retired per-function face.
- 3035948: fix: the package sheet and the record create form no longer log React warnings (objectui#11804)
  
  The package sheet's "Pending changes" header was a paragraph holding the draft-count badge, and the badge renders a block element. A block inside a paragraph is invalid HTML, so every time a package with pending drafts opened the sheet, from the console's metadata admin or from Studio's *Package info & settings*, React logged a DOM-nesting error. The header is now a block container with the same classes, and it looks the same.
  
  A select field the create form did not seed opened as an uncontrolled dropdown, and the user's first pick switched it to controlled, so React logged "Select is changing from uncontrolled to controlled". The select widget now renders a controlled dropdown from its first render for every host that hands it an `onChange`: an unset value shows the placeholder exactly as before. What a form saves is unchanged. A picked value is saved as before, and an untouched select still sends no value. A select node rendered with no `onChange` stays uncontrolled, so it still shows the user's pick.
- 5ab2f19: The record picker (`RecordPickerDialog`) is laid out from the design system's own primitives (objectui#11903). It is the dialog behind a multi-select lookup's "Browse all records", a related list's Add and a role's Assign user.
  
  - **Spacing.** The dialog keeps the standard spacing between its title, search, table and footer. The title no longer sits on the search box.
  - **Search.** The search box is the standard input with a leading icon: one border at rest, one focus ring.
  - **Selection.** In multi-select mode every row starts with a checkbox that shows whether it is picked, and the header checkbox picks or clears every row on the page. A row click, the arrow keys and Enter / Space toggle a row as before.
  - **Width.** The dialog is as wide as its columns need: a three-column picker is no longer stretched to the full large-screen width, which stays the ceiling for wide pickers.
  - **Footer.** The record count, the page controls, the selected count and the Cancel / Confirm buttons sit on one footer bar.
  - **Confirm.** Confirm is disabled while nothing is picked.
  - **No links in rows.** Email, URL, phone, file and reference values show as text inside the picker, so a click on a row always picks it instead of opening a mail client or another record.
  
  The console's dev-only preview gallery shows the picker in multi-select mode over three columns (`?only=record_picker`). Nothing is added to the package entry: no export, prop, type member or language-pack key.
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
- 5330038: Console rendering fixes from the HotCRM browser pass (objectui#12110):
  
  - **Grid:** a view column's authored `label` is the header. It used to lose to the field's translated label whenever the app bundle translated the field.
  - **Form:** a field `widget` that names no registered component falls back to the field type's renderer, as the spec's `widget` description says. A `rating` field declaring `widget: 'star_rating'` now draws the star widget instead of a text box. A built-in control name (`input`, `textarea`, …) and the native password and email inputs still render as before.
  - **Cells:** a `rating` value draws stars out of the field's `max` (5 by default) in list, detail and related-list cells, instead of a bare number.
  - **Reference rail:** a related row is named by its object's declared `nameField`, and the rail refetches in place when the record, a related object or everything is invalidated. A record action with `refreshAfter: true` therefore refreshes the rail too.
  - **Gantt:** the task list, the tooltip and the drag previews show a date's year when it is not the current year.
  - **Approvals drawer:** a `position:` approver shows the position's label, from the console's position registry, instead of a truncated id. The headline figure prefers the object's declared `currency` field and never shows a zero from a field matched only by its name.
  - **Public form:** a form with no title of its own is headed by its object's label, not the object's API name.
- 2498a07: A rich-text field no longer draws hint lines above its editor (objectui#12110, ruled B). The `markdown`, `html` and `richtext` editors used to show "Format: markdown" (or "Format: html") and "Rich text editor (basic)" above the textarea, on every form. An anonymous visitor on a public form read them as editor chrome. Both lines are gone everywhere: on public forms, on internal forms, and in the fullscreen dialog. The field's own `placeholder` and help text are unchanged and remain the place for authored guidance.
  
  Nothing is added to or removed from the package entry: no export, prop, type member or language-pack key changes. The two catalogue keys the lines used, `fields.richText.format` and `fields.richText.basicEditorHint`, stay in every language pack; nothing reads them now.
- 898bd2c: A formula field declared `returnType: 'currency'` renders as money, in a list cell, a form and a record detail (objectui#12111).
  
  `@objectstack/spec` 18 adds `currency` to `FieldSchema.returnType`: the formula's result is an amount of money, in the currency the formula's own `currencyConfig` declares, as a currency field declares it. Both formula faces drew such a value as plain text (`3456`). Now each one hands the formula's definition to the currency field's own face: `FormulaCellRenderer` to `CurrencyCellRenderer`, and `FormulaField`'s read-only face to `CurrencyField`'s. So a formula reads exactly what a currency field with the same `currencyConfig` reads. A `fixed` config shows its own currency (`CN¥3,456.00`). With no `currencyConfig`, or a `dynamic` one, the amount shows in the tenant's default currency.
  
  A formula declared `number`, `text`, `boolean` or `date`, or declaring no `returnType`, renders as before. Nothing is added to the package entry.
- e723f58: Screen readers hear the names of more controls in the viewer's language (objectui#12145).
  
  These controls carried an English `aria-label`, so under a non-English locale a screen reader announced their names in English: the docs portal's loading spinner, the record form page's breadcrumb, the `Spinner` status region, a data table's row menu button, the `pagination` renderer's previous and next links, the image crop preview, the percent slider, the record picker's grid, the AI composer's send and stop button and an attachment's remove button, the designer's undo and redo buttons, minimap, version history and back button, a dismissible record alert's close button, the bulk-action bar, and the mobile view switcher. Each name now comes from the language packs. English names are unchanged, with two small exceptions: the spinner now reads "Loading…", and the pagination links read "Previous page" and "Next page", the same words the data table pager uses. Sighted use is unchanged.
  
  Added: eight language-pack keys in all ten packs: `help.loadingDocumentation`, `common.breadcrumb`, `table.rowActions`, `fields.image.cropPreview`, `fields.percent.slider`, `designer.canvasMinimap`, `designer.versionHistory` and `grid.bulkActions`. Every other name reuses a key that already holds the same words. The exported `en` pack, and so `TranslationKeys`, gains these eight members. `PromptInputAttachment` (exported through `AIElements`) takes an optional `removeLabel` prop that names its remove button; without it the button keeps its English name.
- a491b64: The `position-ref` grant picker no longer offers the `everyone` and `guest` audience anchors (objectui#12200). Every authenticated or anonymous principal holds an anchor implicitly (ADR-0090 D5/D9), and the server refuses a `sys_user_position` row that names one, so a pick of either was refused on save. The picker leaves out exactly the spec's `AUDIENCE_ANCHOR_POSITIONS`, read from `@objectstack/spec`, so an anchor the spec adds is left out too. A registry that lists nothing but anchors gives the typed-name box, as an empty one does. A row that already stores an anchor still shows it, by its label beside its name, as its own option, unflagged. `permission-ref` is unchanged: a permission set named like an anchor is listed as before.
- f0532d8: Saving a master-detail edit form no longer rewrites the position of lines the
  user did not touch (objectui#12286).
  
  The edit form read each collection's lines with no sort, so its line grid drew
  them in whatever order the server returned, and the grid stamped every line's
  index into the child's sort field (`position`, `sort_order`, …) on any change.
  Editing one cell of one line therefore saved a new position onto its untouched
  siblings, swapping their stored order and bumping their `updated_at`.
  
  - `MasterDetailForm` now reads the lines ascending by the child's derived sort
    field, the record id breaking ties, so the grid opens in stored order.
  - The line grid (`field:grid` with a `sortField`) renumbers only when a row is
    added, removed, duplicated or moved. A cell edit leaves every row's position
    as it was, so lines whose stored positions are tied, empty or gapped are not
    renumbered by an edit either.
  
  Editing one line's field now sends exactly one update, and moving a line sends
  only the lines whose position changed. The `GridFieldMetadata.sortField`
  description says when the grid stamps the field.
- 789cb16: fix(fields): a text-valued formula is drawn as text, not in a monospace code font (objectui#12357)
  
  The formula cell now draws a text result through `TextCellRenderer`, and the read-only form face (`FormulaField`) draws it with `TextField`'s read-only classes, whether the formula declares `returnType: 'text'` or declares no `returnType` at all. Both faces used to print every result that was not a number, boolean or date in monospace, so a formula yielding a person's name read as code beside the text columns around it.
- 518a8e3: The record page's highlight strip no longer cuts a value without saying so, and at phone width it uses one layout (objectui#12523).
  
  - **A cut value ends in an ellipsis.** The email, URL and phone cells drew their text inside an `inline-flex` anchor. A host that clips to one line, such as a highlight chip, cut that text mid-word with no ellipsis: the cell was one atomic inline box, and a browser clips the first atomic inline on a line instead of ellipsing it. The three cells now follow the single-line convention the other cells in `@object-ui/fields` use. The cell is bounded by its host, and the box that holds the text truncates with an ellipsis. In the highlight strip the whole value is still the clip box's `title`. A host wider than the value shows no change.
  - **A phone declared through `format` gets the phone width.** A `text` field with `format: 'phone'` (or `email` / `url`) drew the phone cell on the narrow 9rem chip, so the HotCRM lead's phone read "+1-555-0" at 1440. The strip now sizes a chip by the cell it draws, so that phone gets the same 16rem floor as a `phone` field. When the floors no longer fit one line, the strip wraps before it cuts a value.
  - **A wrapped line starts flush.** From `sm` up, the first chip of every line now hides its separator and left padding, not only the strip's first chip. A second line no longer reads as an indented list.
  - **One layout below `sm`.** Every chip is a full-width line with no separator. Two chips no longer sit side by side above a single-column list.
- 7d0c174: A boolean cell's read-only checkbox is named by its field (objectui#12584).
  
  The boolean cell renderer draws a plain checkbox for every boolean column outside the completion and status names. It had no accessible name, so a screen reader announced each cell of the Studio Records grid and the runtime list grid as a bare "checkbox, not checked", with nothing to say which field it was. The checkbox is now named by the field's label, or by its humanized name when the field declares no label, the same words the status field's "Off" badge prints. The name carries no state word: the checkbox role announces checked or not checked itself.
  
  The humanized-name fallback now reads the field name as authored, for the checkbox and the "Off" badge alike. It read the lower-cased name before, so an unlabelled `IsPreferred` read `Ispreferred`. A spec-legal field name is lowercase snake_case already, so for every such field the words are unchanged.
  
  Nothing else moves: no visual change, no new language-pack key, and no export, prop or type member.
- 726d8c9: Every wide centred dialog keeps a 1rem gutter on each side of the window from `sm` (640px) up, by one shared class (objectui#12603).
  
  `@object-ui/components` adds one export, `DIALOG_VIEWPORT_GUTTER` (`sm:w-[calc(100%-2rem)]`): the gutter `ModalForm` introduced for its `lg` and `xl` sizes (objectui#12593), promoted so every wide dialog reads the same value. A dialog that raises its cap with `sm:max-w-2xl` or wider writes this constant beside the cap.
  
  Dialogs that ran edge to edge between `sm` and their max width and now keep the gutter:
  
  - the action modal's `lg` and `xl` sizes (`xl` is what a `type: 'modal'` action with a page target and no size opens at);
  - the action parameter dialog with a long parameter list, the flow runner's object-form or long screen step, and the CEL test-run dialog;
  - the full-screen text editor dialog, the image lightbox and the import wizard.
  
  The record picker reads the same class under every width rung; it kept a `95vw` margin of its own before, so between `sm` and its cap it is now the window less 2rem instead. `ModalForm` reads the shared export instead of its private copy, with no change in output.
  
  Unchanged: sheets, the phone sheet below `sm`, the `full` size (`95vw`), and every dialog's width on a window wider than its max width plus 2rem.
- f78efdd: List grids show the record a pointer field names, and the Approvals Inbox says who else is waiting (objectui#12608).
  
  - **Record names in place of record ids.** A `text` field that declares `referenceVia` holds the id of a record whose object the sibling column names on the same row, as `record_id` does on Approval Requests (`referenceVia: 'object_name'`) or `source_id` on activities. In a list grid such a column now shows the target object's icon and the record's name, linking to the record. The record id moves to the tooltip. The grid reads the records of one page with one request per target object, not one per row.
  - **Unavailable records say so.** When the record cannot be read (deleted, or outside what the viewer may read), the cell shows the object's label followed by "record unavailable", with the id in the tooltip, instead of the bare id.
  - **The empty Approvals Inbox names who else is waiting.** When nothing is waiting on the viewer but other requests are pending, the empty state adds one muted line: "N requests are waiting on other approvers · Browse all requests". The number comes from one count request and counts only requests the viewer can see; when it cannot be read, the line is not shown.
  
  New language-pack keys, in every shipped language: `grid.recordUnavailable` and the `approvalsInbox.waitingOnOthers` plural family.
- ca7a4c3: Record forms draw `date` and `datetime` fields with the platform date picker instead of the browser's native date input (objectui#12622).
  
  The picker is a text box in the display locale's format (`10/16/2026` in English, `2026/10/16` in Chinese), with a calendar popover, keyboard entry, a clear button, and Today / Tomorrow shortcuts. The native input took its placeholder and digit order from the machine, so an English console could show a Chinese machine's placeholder.
  
  - **The value written is unchanged.** A `date` field writes `YYYY-MM-DD` and a `datetime` field writes an ISO instant, as the native inputs did. Clearing writes an empty value, as before. Typed text that names no date is not written: the box is marked invalid and a notice names the expected format.
  - **Where it applies.** The form registration of `field:date` / `field:datetime` (what `registerField` / `registerAllFields` register) takes the picker, and so does `getLazyFieldWidget` (the action-param and bulk-action dialogs, objectui#12642). The inline editors draw it too (objectui#12664, objectui#12759). A form without `@object-ui/fields` registered keeps the native input. The read-only face is unchanged.
  - **New language-pack keys** in all ten packs: `fields.datePicker.today`, `tomorrow`, `clear`, `openCalendar` and `invalid`.
- c6b7d82: Action-param and bulk-action dialogs draw `date` and `datetime` params with the platform date picker, the same face record forms draw since objectui#12622 (objectui#12642).
  
  The native input took its placeholder and digit order from the machine's locale, not the console's. Now one field type has one face in forms and dialogs.
  
  - **Where it applies.** Everything that resolves a field widget through `getLazyFieldWidget` or `registerField` / `registerAllFields`: the record form, `ActionParamDialog`, the grid's `BulkActionDialog`, and the console's form page. The inline editors draw it too (objectui#12664, objectui#12759). The list filters keep the native input.
  - **The value written is unchanged.** A `date` param writes `YYYY-MM-DD` and a `datetime` param writes an ISO instant, as the native inputs did.
  - **The Action designer's preview** draws a date-picker shape for `date` / `datetime` params, matching the dialog.
  - **No public surface changes.** No type, prop, export or language-pack key is added or removed (Clause-②: no). `getLazyFieldWidget('date' | 'datetime')` returns another component with the same props.
- d66d7e8: The grid's inline cell editor and the kanban required-fields dialog draw `date` and `datetime` fields with the platform date picker, the face record forms and the action dialogs already draw (objectui#12664). The native input took its placeholder and digit order from the machine's locale, not the console's.
  
  - **Where it applies.** Everything that renders `FieldEditWidget`: the grid's inline cell editor and the kanban required-fields dialog. The record details inline editor delegates `date` / `datetime` to `FieldEditWidget` too since objectui#12759. The list filters are objectui#12743.
  - **A typed day is no longer lost in a grid cell.** The picker reads its text when its control loses focus. The data table now blurs the focused control inside an injected cell editor before Enter or a click outside commits, and it commits the last value the editor staged. Before, a typed day was dropped on both. Escape still discards. Editors that stage on every keystroke behave as before.
  - **The value written is unchanged.** A `date` field writes `YYYY-MM-DD` and a `datetime` field writes an ISO instant, as the native inputs did.
  - **The picker stays lazy.** `FieldEditWidget` loads it through the same `import()` the form uses, so it stays in its own chunk, and shows a placeholder with no input while it loads.
  - **No public surface changes.** No type member, prop, export or language-pack key is added or removed. The `renderCellEditor` context keeps its seven members; its documentation now states the blur-before-commit behaviour.
- 020d178: An inline edit of a `datetime` field on the record page keeps its time (objectui#12759). The record details section and the header highlights edited `date` and `datetime` fields with the browser's native date input, a day-only control. A `datetime` showed no time there, and an edit of the day saved local midnight of that day, dropping the time the record held.
  
  - **The platform date picker.** Both types now edit with the picker the record form, the action dialogs, the grid's inline cell editor and the kanban required-fields dialog draw (objectui#12622, objectui#12642, objectui#12664). Its placeholder and digit order follow the console locale, not the machine's.
  - **A `datetime` keeps its time.** The picker shows the date and the time. A day picked in its calendar keeps the value's time, and typed text carries the time typed. The value written is an ISO instant, as before. A record at 14:30 moved to another day saves that day at 14:30.
  - **A `date` field still writes `YYYY-MM-DD`** (objectui#12206), unchanged.
  - **A stored day that does not exist** (`2026-02-30`) still shows an empty, invalid box with a notice naming the stored value, and nothing is written until a day is entered (objectui#10625).
  - **Typed text is read when the box loses focus or on Enter.** Pressing Save moves focus to the button first, so the typed value is saved.
  - `@object-ui/fields`: a code comment only, on where the picker is drawn.
  
  Clause-②: no. No type member, prop, export or language-pack key is added or removed.
- 8523e81: A read-only `GridField` table shows a select cell's option label and a number or currency cell in the session's locale (objectui#12915).
  
  The read-only table (a read-only record page, a print page, a read-only master-detail grid) sent only file and date / datetime / time cells through the grid's display formatter and printed every other cell as its stored value: a status read `open` instead of `Open`, and an amount read `98765.25` instead of `98.765,25 €` in a `de-DE` session. Every cell except a lookup now goes through the same formatter the list-mode and computed cells already use, so the read-only and editable views of one row read alike. Since objectui#12854 a `record:line_items` column listed by `name` takes its select, number or currency type from the child field, so a read-only invoice's line items reach exactly these cells.
  
  Lookup cells still render through `LookupField`, and file and date cells are unchanged.
  
  Clause-②: no
- 32b492b: Line-item grids read a boolean column's options and a file cell's text in the session language (objectui#12924). Under a zh-CN session, a master-detail or `record:line_items` grid showed English in two places: the two options of a column derived from a `boolean` or `toggle` child field (`Yes` / `No`, in the editable picker and in the per-row form's list), and a file cell's text (`N files` for a cell holding several files, `File` for a file with no name). Both now come from the language packs, and English reads as before.
  
  - **Boolean options.** The labels are the session's word for each value, from `useBooleanValueLabel` (`@object-ui/fields`), which reads `common.yes` / `common.no`, the keys read-only booleans already use. The stored values are unchanged: `'true'` and `'false'`. `MasterDetailForm` and `LineItemsPanel` call the hook and pass it to the derive functions. Both re-label the options when the session's words change, so a catalogue that lands after the child schema, or a language switch, reaches them without re-reading the lines.
  - **File text.** `GridField` reads the count from `detail.fileCount`, the plural family the file cell renderer already uses, so each language gets its own plural forms (Russian `few` / `many`, for example). The name of a nameless file comes from `fields.file.fileFallback`. The per-row form's list cell and the read-only table both show these words.
  
  No language-pack key is added.
  
  BREAKING (`@object-ui/plugin-form`), for a caller of the exported `deriveDetail` or `deriveColumns`: both now require `booleanLabel`, a function that names a boolean value in the session language. Pass `useBooleanValueLabel()` from `@object-ui/fields`: `deriveDetail(childObject, childSchema, parentObjectName, { booleanLabel })`, and `deriveColumns(childSchema, { booleanLabel })`. There is no default, because an English default would label the options in English for a session in any other language. (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  Clause-②: no (narrowing)
- b7fe09e: The list's quick-search box and the record pickers' type-ahead are no longer offered on an object whose search resolves to no field, and a refused search shows the server's message (objectui#12966, the console half of objectstack#24284).
  
  objectstack now answers a non-blank `search` over such an object with `400 INVALID_FIELD` (`param: 'search'`) instead of every row. The common shape is a junction object: two lookups and a composed formula title, with no `searchableFields` declared.
  
  - **The list toolbar** decides with the spec's `resolveSearchFieldResolution`, over the object definition with `internal: true` fields left out and the object's own `searchableFields`, the inputs the engine uses. When the set is empty the search box is not drawn, and a term restored at mount is not applied. Until the definition is read the box is drawn, as before; the list is loading for that read anyway, since its data fetch waits on it. A list whose data source serves no definition keeps the box. A view's `searchableFields` does not make such an object searchable: the server refuses that override outside the object's set.
  - **`RecordPickerDialog` and `LookupField`'s inline dropdown** draw no search box on a target whose set is empty. They still list the records, and the dialog still pages them. An unknown target schema keeps the box.
  - **A refused search** on a list now shows the server's sentence, which names the object and the two remedies, in place of the generic "query was rejected" copy. The record pickers already showed the server's message.
  
  Nothing is added to either package entry: no export, prop or type member.
- 5129caa: Lookup quick-picker: the preview line under each option no longer cuts a badge to its first letter (objectui#13123). A column drawn as a badge (a `select`, `status`, `radio`, `multiselect` and the other types the select renderer draws) keeps its whole label. Other columns still truncate their value, but never below their label. A column the line cannot hold is left out whole, together with the columns after it, instead of being squeezed. For example, a showcase Account option on a narrow field used to read "Lifecycle: A. · Industry: Tec... · Annual Revenue: $96,00..." and now reads "Lifecycle: Active · Industry: Technology"; a wider field adds the revenue column back, truncated if it must be.
- f48a4d5: A lookup's quick-picker takes the choice after a search, and a single-select lookup's trigger shows the picked record (objectui#13162).
  
  - **Enter after a search sets the value.** The quick-picker had no active row until an arrow key moved to one, and the row an arrow key chose was dropped when the debounced search answer replaced the list. Typing a term and pressing Enter therefore set nothing, which a required field then refused ("Manager is required"). Once the rows on screen answer the typed term, the first one is now the active row (announced through `aria-activedescendant`), and Enter takes it. While the answer is still pending, no row is made active, so Enter cannot take a row the typed term did not ask for. A click on a row is unchanged: it always set the value.
  - **The trigger shows the picked record.** A full-size single-select lookup drew its value as a chip above a trigger that went on reading "Select…", so a field holding a value read as one still asking for it. The trigger now reads the record's label (the whole label on hover when it is cut short), as the compact grid-cell editor already did, and a search-first (people) field also draws the avatar the chip used to draw. The chip's clear control moves beside the trigger, with the same accessible name ("Remove …") and the same rule: a disabled field offers none. A multi-select lookup keeps its chips and its "N selected" trigger. The placeholder now reads muted in both sizes, so an empty field and a filled one look different.
  
  Nothing is added to the package entry: no export, prop, type member or language-pack key. The query kernel the pickers share (`useRecordQuery`, which the package entry does not export) now reports the search term its records answer, which is how the quick-picker tells the two states apart.
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
- Updated dependencies [7282c6a]
- Updated dependencies [24804dc]
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
  - @object-ui/providers@18.0.0

## 17.7.0

### Minor Changes

- e686f4d: A record form can no longer be saved while an upload is still in flight (objectui#10166).
  
  A `file` / `image` value only becomes its fileId once the presigned upload settles. Until
  now a record form had no notion of upload state at all, so a Save pressed during that
  window wrote the record WITHOUT the attachment — and reported success. The user picked the
  file, saw it listed and saved; there was no error, no warning, and the record looked saved.
  Whoever noticed did so later, looking at a record that should have a file and does not.
  
  `onUploadingChange` (ADR-0059) already carried the signal, and had exactly one consumer,
  `ActionParamDialog`. It could not have a second: that prop is per-widget, and a record form
  hands a `fields` array to the `form` node renderer and never touches a widget, so there is
  no point in the chain where it can attach a callback — and its upload controls can sit
  inside a section, a tab or a line-items subform.
  
  `@object-ui/fields` therefore publishes the AGGREGATION beside the prop: `useUploadingScope`
  (the host's "is anything below me uploading") and `UploadingScopeProvider`.
  `useUploadingSignal` — also exported now, for widgets authored outside this repo — feeds
  both sinks from the one call it already made, so the per-widget prop and the scope cannot
  disagree, and a host that mounts no provider is unaffected. A widget that unmounts
  mid-upload releases its slot, so a collapsing section cannot wedge Save shut.
  
  Nesting CHAINS rather than shadows: an inner scope gates its own Save AND reports itself to
  the scope above. The direction is forced by `MasterDetailForm`, whose Save persists parent
  and children in one batch while its rows are edited by nested `ObjectForm`s — a gate that
  saw only the parent's uploads would refuse nothing while a child's attachment was in flight
  and would still read as coverage.
  
  Every submit owner in `@object-ui/plugin-form` is gated: `ObjectForm`, `ModalForm`,
  `DrawerForm`, `SplitForm`, `TabbedForm`, `WizardForm`, `MasterDetailForm`, and
  `EmbeddableForm` through the `ObjectForm` it hosts. While an upload is in flight each
  refuses the submit (which is also the keyboard-submit guard), labels Save "Uploading…", and
  renders the reason as a sentence — `form.uploadInFlight`, new in all ten locale packs. The
  hosts that own their Save button — `ModalForm`, `DrawerForm`, `MasterDetailForm`, and
  `WizardForm`'s final step — disable it as well; the flat `ObjectForm`, `SplitForm` and
  `TabbedForm` paths submit through the `form` node renderer in `@object-ui/components`, which
  exposes no per-button disable, so there the refusal plus the label and the notice are what
  the user meets.
  
  `WizardForm` is gated on its FINAL commit only. Moving between steps writes nothing, so
  `Next` is deliberately untouched — but note that leaving a step unmounts its widgets, so an
  upload in flight is released by the unmount and its value never reaches the record. That
  loss predates this change and is not addressed by it.
- 31938f0: `CurrencyField` takes its fraction digits from the currency, never from the
  field-level `precision` (objectui#10276).
  
  `@objectstack/spec` declares a field's `precision` as "Total digits
  (non-negative integer)" — the `p` of a `decimal(p, s)` column, so a
  DECIMAL(18,2) amount is `precision: 18, scale: 2`. The currency edit widget
  passed that count to `Intl` as the number of decimal places, so a currency
  field declaring `precision: 18` rendered eighteen decimal places, offered a
  `step` of `0.000000000000000001` and rounded typed input to eighteen places on
  blur. The currency cell renderer does not read `precision` and is unaffected.
  
  The widget's one width is now the resolved currency's own ISO 4217 minor-unit
  count — two decimals for USD or CNY, none for JPY, three for KWD — and it drives
  the read-only display, the input's `step` and the blur rounding alike. A field
  with no resolvable currency keeps two decimals. The widget does not read `scale`
  for the width either (it never did), in line with the ruling on
  objectstack-ai/objectstack#19629 that takes `scale` off the `currency` type.
  
  **Behaviour change** for currency fields that declare `precision`: the declared
  value no longer sets the decimal places shown, the `step`, or the blur rounding.
  Where it differed from the currency's own digit count (or from two decimals on a
  field with no currency), the output moves: `precision: 2` on a JPY field used to
  show `¥1,234.50` and now shows `¥1,235`; `precision: 0` on a USD field used to
  show `$1,235` and now shows `$1,234.50`. This reverses the "an explicitly
  authored `precision` still wins" rule objectui#4361 published, under the
  maintainer ruling recorded on objectstack-ai/objectstack#19910 that a
  currency's decimal places are the currency's, not a setting. Fields that declare
  no `precision`, or one equal to the currency's own digit count, render exactly
  as before.
  
  **Migration.** Nothing to restate: a currency field's decimal places follow its
  currency. Keep `precision` only as the total digit count of the stored decimal.
- 274e14a: fix(fields,components): a single select or radio emptied by a cascade clear is now saved — as `null`
  
  When a controlling field changes and a single select or radio no longer offers
  its current value, the cascade clear empties it. It emptied it to `undefined`,
  and the JSON transport omits an own `undefined` key (`@objectstack/client`'s
  `data.update` sends `body: JSON.stringify(data)`). So the user saw the field
  emptied, pressed Save, and the stored value survived and came back on refresh —
  on the record page's inline edit (reachable since objectui#7190) and in forms
  alike. The multi-value clear beside it wrote a real `[]` and was saved; the two
  disagreed.
  
  Both clears that can empty a scalar now write `null`, the write contract's
  "clear the stored value" (an absent key means "leave it unchanged"):
  
  - `SelectField` and `RadioField` (`@object-ui/fields`) emit `onChange(null)`.
    This covers every host that renders them: inline edit, `ObjectForm` and the
    other form variants.
  - The form renderer's own cascade clear (`@object-ui/components`) sets `null`.
    It runs independently of the widgets and is the only clear for a field no
    option widget renders: a field `visibleWhen` keeps unmounted, or the built-in
    `select` branch. The clear-on-hide effect in the same file already wrote
    `null` for the same reason.
  
  `SelectField` also renders a `null` value as "nothing chosen": it shows the
  placeholder, as an empty string does. Before this change a raw `null` painted a
  blank trigger.
  
  A multi-value clear still writes its array. A select nobody touched is still not
  staged: no invented `null` reaches a save, so a server default is not
  suppressed. Required validation, the master-detail dirty diff and the create
  form's default omission already treat `null` and `undefined` as the same blank,
  so none of them changes.
- 2fc2a24: The line-item grid (`GridField` / `LineItemsField`) no longer gives a currency
  cell a default of two decimal places or a default `¥` symbol. A currency column
  without a `scale` now uses its currency's own decimal places (objectui#10355).
  
  A computed `currency` column (for example `amount = quantity * unit_price`) was
  rounded to the column's `scale` before the value was written back into the row,
  and to two decimals when the column had no `scale`. That default gave every
  currency two decimals: a yen amount was stored with cents yen does not have
  (JPY 3 × 1234.5 stored `3703.5`), and a dinar amount lost its third digit
  (KWD 3 × 1.2345 stored `3.7`). The display fell back to a literal `¥` whatever
  the currency was.
  
  The grid now resolves its currency through `resolveFieldCurrency`. That is the
  tenant default, since a grid column declares no field-level currency key. A
  currency column's decimal places are:
  
  - its authored `scale`, when it has one. The stored value already used it, and
    the display now does too. The spec's `InlineGridColumnSchema.scale` declares
    it for a computed numeric or currency result;
  - otherwise that currency's ISO 4217 minor unit, which replaces only the old
    default of two: whole yen for JPY, two places for USD, three for KWD;
  - otherwise none. With neither a `scale` nor a resolved currency, the computed
    value is stored as computed, not at an invented two places.
  
  The same places decide the stored value of a computed currency cell and how a
  currency cell is shown, both the computed cell and the list form-factor. The
  cell shows the resolved currency, and the editable currency cell shows that
  currency's own symbol. With no currency resolved there is no symbol. An
  authored `prefix` still replaces the symbol. An authored `scale` above the
  engine's limit of 100 is clamped and reported on the display too, as it
  already was for the stored value (objectui#10071).
  
  `computeRow` takes the tenant currency as a new optional third argument. Called
  without it, a currency column with no `scale` is stored unrounded.
  
  **Behaviour change** for grids with currency columns and no `scale`: a computed
  cell is stored and shown at the currency's minor unit instead of two places, in
  line with the ruling on objectstack-ai/objectstack#19910 that a currency's
  decimal places are the currency's. A USD tenant's grid used to read `¥1,234.57`
  and now reads `$1,234.57`. Columns with an authored `scale`, and `number`
  columns, round as before.
  
  ⚠️ **Dated note, 2026-09-29 — one sentence above was made false in this same release — objectui#11073.**
  The sentence saying an authored currency `scale` above 100 "is clamped and reported on the display too" no longer holds. Later in this release this repository began resolving `@objectstack/spec` 17.5.0, which refuses a `scale` above 100 at the declaration, and the objectui#10071 clamp that sentence relied on was retired with it. The display now uses the authored width as it is, as the stored value does. Everything else above is unchanged.
  
  ⚠️ **Dated note, 2026-09-30 — a currency column's `scale` is no longer read, reversed in this same release — objectui#10783.**
  The first item of the list above ("its authored `scale`, when it has one") and the sentence saying columns with an authored `scale` round as before no longer hold for a `currency` column, and neither does the 2026-09-29 note just above, which is about that same authored width. Later in this release the grid stopped reading `scale` on a currency column: `@objectstack/spec` 17.5.0 refuses it on a column that declares `type: 'currency'`, and the currency's ISO 4217 minor unit now decides the stored and the shown width whatever `scale` the column carries. A `scale` on a `number` column is unchanged. Everything else above is unchanged.
- 8c0e550: fix(fields)!: the record picker's display column labels a record the way the lookup dropdown does, and `RecordPickerDialog`'s `titleFormat` prop is replaced by `objectSchema`
  
  ⚠️ Breaking change (marked `minor` under this repo's version policy): the
  published `RecordPickerDialog` component's `titleFormat` prop is removed. Pass
  `objectSchema`, the referenced object's schema, instead. Tracked as
  objectui#10486, the picker half of the lookup branch of ruling C1 on
  objectui#9436 (the field's own `displayField`, then the object's `nameField`,
  then the deprecated `titleFormat`).
  
  - **Before.** The browse-all picker's display column rendered a bare
    `titleFormat` string through its own single-brace renderer, above the
    referenced object's `nameField` and above the lookup's declared
    `displayField`. A double-brace template kept its outer braces. With no
    template the column never read `nameField`: it showed the record's `name`
    value, or nothing when the object has no `name` field. The dropdown option
    for the same record showed the `nameField` value.
  - **After.** When `objectSchema` is given, the display column renders
    `@object-ui/core`'s `getRecordDisplayName(objectSchema, row, { titleField })`,
    the call the dropdown's option label and the lookup cell renderer make: the
    declared `displayField`, then `nameField` (and its deprecated aliases), then
    `titleFormat`, then type-aware derivation. The row is the one the dropdown
    labels from: relations collapsed to ids and fields the loaded policy denies
    removed. The resolver's `Untitled` / `Record #id` floor is not used as a
    title; such a record keeps its column's own value.
  - **`displayField` is the declared value.** Pass the lookup's declared display
    field, or leave it out when the field declares none. The display column is
    still keyed on `'name'` when it is omitted, but only a declared value ranks
    above the object's declarations.
  - **The column moves for `nameField`-only objects too.** It now shows the
    `nameField` value where it used to show the `name` value or a blank cell.
  - Without `objectSchema` the display column renders its own value, as before.
    `LookupField` passes the schema and the declared display field; no other
    caller in this repository passed `titleFormat`.
  
  This change also corrects two pending changesets that described the picker
  before it: the objectui#10343 one now says the picker's display column follows
  the dropdown's resolver, and the objectui#6874 one names the current
  `objectSchema={refObjectSchema}` pass, whose conclusion stands.
- 12809a5: `MaskedCellRenderer`, the mask a `password` / `secret` cell draws, is now exported, so a table that cannot type a column yet draws it WITHHELD instead of as text (objectui#10657, which folded objectui#10706).
  
  **New export `MaskedCellRenderer`.** It is the component the standard `password` and
  `secret` cells already resolve to: `••••••` for a value that is set, the empty-value mark
  for one that is not. Its `field` prop is optional, because it reads only whether a value
  is present. It is the shipped mask, not whatever is registered for `password` at the
  time, so a host override of a masked type does not change what a withheld cell draws.
  
  `object-grid`, the related list and `object-data-table` use it for a column whose type is
  not known yet: while the object's field types are loading, or after their read failed,
  they draw such a column as this mask rather than as its value.
  
  `registerFieldRenderer('api_token', MaskedCellRenderer)` now masks a type the same way
  the `getCellRenderer('password')` form does, and `isMaskedFieldType('api_token')` answers
  `true` for it. Nothing that already resolves changes.
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
- b32e7de: fix(fields): a currency grid column's width is its currency's minor unit, never an authored `scale`; a hydrated currency column's `scale` is reported (objectui#10783)
  
  The line-item grid (`GridField` / `LineItemsField`) no longer reads `scale` on a
  `currency` column. The currency's ISO 4217 minor unit decides both the width a
  computed amount is stored at and the places the cell shows: whole yen for JPY,
  two places for USD, three for KWD, whatever `scale` the column carries.
  `@objectstack/spec` 17.5.0 refuses `scale` on an inline grid column that
  declares `type: 'currency'` (ruling B on objectstack-ai/objectstack#19629,
  ruling 乙 on objectstack-ai/objectstack#19910), and the grid now matches it.
  `scale` on a `number` column is unchanged.
  
  A column that declares no `type` and takes `currency` from its child field, such
  as `inlineColumns: [{ name: 'amount', scale: 2 }]` over a currency `amount`
  field, still passes the spec, which cannot see the child field's type. The
  master-detail form's column hydration now reports such a `scale` on the console,
  once per column, naming the column and the child object, instead of leaving it
  unread in silence. It reports a declared currency column that carries `scale`
  too, because a form view's `subforms[].columns` is not judged by the spec. The
  column still renders, at its currency's minor unit; delete the key.
  
  **Behaviour change** for a currency column with an authored `scale`: a computed
  amount is stored and shown at the currency's minor unit instead of at that
  `scale`. A JPY tenant's column with `scale: 2` used to show `¥1,234.57` and now
  shows `¥1,235`.
- ff94a12: fix(fields): an avatar pick uploads through the `UploadProvider` and submits its `sys_file` id, or is refused by name — never stored as a `data:` URL
  
  **BREAKING (`@object-ui/fields`), graded `minor` by this repo's release model** (AGENTS.md: objectui's major follows the `@objectstack` family major, so its own breaking changes ship as `minor` with the breaking semantics stated here, never `major`), the grade objectui#7699 gave the same change to the file and image widgets:
  
  - **Who breaks.** A host that renders `AvatarField` under an upload adapter whose result carries no id-shaped `meta.fileId`. That includes the object-URL default: `useUpload()` falls back to it when no `UploadProvider` is mounted, and `UploadProvider` uses it when given no `adapter`. It also includes any S3- or Azure-style adapter, `createS3Adapter` and `createAzureBlobAdapter` among them, because neither mints a `sys_file` row. Such a host used to get a `data:` URL in `onChange` for every accepted pick.
  - **What they see now.** The pick is refused with the translated "did not complete" row `FileField` and `ImageField` render for the same pick, and the field is not changed.
  - **What to do.** Mount an `UploadProvider` whose adapter returns the `sys_file` id in `meta.fileId`. `createObjectStackUploadAdapter`, the ObjectStack presigned flow, does. A host on another backend returns its own file id there (word characters and `-`, 1 to 64 long, as `isFileIdToken` requires) and has its read path return `{ id, name, url }`, because a bare id otherwise renders from ObjectStack's `/api/v1/storage/files/:id`.
  
  `Clause-②: yes (narrowing)` — `AvatarField`, a public export of `@object-ui/fields` and the registered `avatar` widget, now refuses a pick whose upload adapter surfaces no id-shaped `meta.fileId` where it used to hand every accepted pick to `onChange` as a `data:` URL; its props type is unchanged and no accept set widens.
  
  `avatar` is a member of the file-reference family, so its stored value has been the bare `sys_file` id since spec `17.0.0`. `AvatarField` read the picked file with `FileReader.readAsDataURL` and stored the resulting `data:` URL instead: the whole image inlined into the record row, as a value the engine's record validator refuses (`invalid_type`) whenever `mediaStrictEffective` answers true and otherwise admits only warn-first. It answers true when the deployment's `adr-0104-file-references` flag is recorded (by `os migrate files-to-references --apply`, or at creation for a datastore born empty) or when `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1` forces strict; `OS_ALLOW_LAX_MEDIA_VALUES=1` wins over both and keeps it lenient.
  
  The pick now goes through `useUpload()` and `fileValueForSubmit`, the path the file and image widgets use: the id reaches `onChange`, and the preview shows the upload's own URL until the next read expands the value. While the upload runs, the button shows the uploading state and the widget reports it through `onUploadingChange` and the ambient uploading scope, as the file and image widgets do, so the record forms' upload gate, `FormPage` (`/f/:slug`, `/forms/:name`) and `ActionParamDialog` hold their submit until it settles. Reading is unchanged for a legacy `data:` or http(s) URL already on a record, which still renders as itself, and a bare id now renders from the storage endpoint instead of as a relative `src`.
- d0c0c7f: `FilterConditionField` writes "Is empty" / "Is not empty" as the spec's one 「is empty」 operator, `{ FIELD: { $empty: true } }` / `{ FIELD: { $empty: false } }` (objectui#10813).
  
  The widget behind sharing-rule `criteria_json`, `relatedListFilter` and `summaryOperations.filter` used to write its own meaning of 「is empty」: `{ $or: [{ FIELD: { $in: [''] } }, { FIELD: { $null: true } }] }` and its complement `{ FIELD: { $nin: [''], $null: false } }`, i.e. "no value OR `''`" on every field type. The `''` member reached a number or date column as `IN ('')`, and a multi-value column (stored as JSON by the SQL driver) as an `$in` that driver refuses. `@objectstack/spec` 17.6.0 admits `$empty` to `FILTER_OPERATORS` (objectstack#20446), and its meaning is the field's DECLARED row of the spec's per-type table (ruling B on objectstack#20311): null or `''` on a text-like field, null or `[]` on a multi-value field, null alone on every other type. Every evaluator expands it itself (`expandEmptyOperator`), so the widget now writes the same token on every column type and keeps no copy of the table.
  
  The `@objectstack/spec` dependency floor rises from `^17.5.0` to `^17.6.0`, because this package now writes `$empty`, which `@objectstack/spec` 17.5.0 declares staged and refuses.
  
  `kvToCondition` reads `$empty` back as the pair, with a boolean flag only: any other flag stays the raw criteria it is, as every evaluator refuses it.
  
  **What moves for a stored rule.** Reading alone rewrites nothing: a criteria saved in either earlier shape (the objectui#10790 `$or` entry and `$nin` + `$null` pair, or the older `$in: [null, '']` / `$nin: [null, '']`) still opens as the same "Is empty" / "Is not empty" row, and an un-edited rule keeps its stored bytes and keeps matching as before. The next time the criteria is edited, those rows are written as `$empty`, which re-scopes the rule:
  
  - text-like column: no change (both mean null or `''`);
  - every other single-valued column (number, boolean, date, datetime, time, select, a single lookup): a row holding `''` is no longer "empty" and becomes "not empty". Since objectstack#20308 the write door stores a cleared number, boolean, date, datetime or time as null, so on those types only a value written before it can hold `''`; a select or lookup can still hold one, and the spec's ruled table does not count it as empty;
  - multi-value column (multiselect, checkboxes, tags, or a `multiple: true` select, lookup or user): a row holding `[]` becomes "empty" and leaves "is not empty". On the SQL driver the earlier shape was refused outright, so a rule there starts running;
  - the `$in: [null, '']` shapes were refused by every objectstack filter face, so a rule still in them starts running.
  
  Measured on the installed 17.6.0 by-value readers (`@objectstack/formula`'s `matchesFilterCondition` and `ValueDataSource`) over null, an absent key, `''`, `[]` and set values: the `$or` entry and `$empty: true` disagree only on `[]`. Readable stores (this repository, objectstack, hotcrm and cloud) hold no criteria in either earlier shape.
- 990a2d6: refactor(fields)!: the 28 field widgets that still registered a bare node-type fallback register `field:<type>` only (objectui#10859, batch 8)
  
  **BREAKING (authoring):** `registerAllFields()` no longer registers the bare keys `auto_number`, `boolean`, `checkboxes`, `color`, `currency`, `date`, `datetime`, `file`, `formula`, `geolocation`, `location`, `lookup`, `master_detail`, `multiselect`, `number`, `object`, `percent`, `phone`, `qrcode`, `radio`, `rating`, `richtext`, `signature`, `summary`, `tags`, `url`, `user` and `vector`. Every field widget is registered under its `field:<type>` key alone — the key a form resolves, and the only one it ever resolved (ruling B of objectui#5254). Each of these bare keys was a node `type` that `objectui validate` refused at `type`, and nothing in this repository authored one as a node: every catalog entry and doc example writes these values as a FIELD type inside `fields[]` / `columns[]`, which is unaffected. A node authored with one of them now renders the "Unknown component type" panel, and `objectui check` reports the type as unknown.
  
  Migration, one line per retired spelling:
  
  - `{ "type": "auto_number" }` as a node → a field `{ "name": "…", "type": "auto_number" }` in a form's `fields[]` (rendered by `field:auto_number`).
  - `{ "type": "boolean" }` as a node → a field `{ "name": "…", "type": "boolean" }` in a form's `fields[]` (rendered by `field:boolean`).
  - `{ "type": "checkboxes" }` as a node → a field `{ "name": "…", "type": "checkboxes" }` in a form's `fields[]` (rendered by `field:checkboxes`).
  - `{ "type": "color" }` as a node → a field `{ "name": "…", "type": "color" }` in a form's `fields[]` (rendered by `field:color`).
  - `{ "type": "currency" }` as a node → a field `{ "name": "…", "type": "currency" }` in a form's `fields[]` (rendered by `field:currency`).
  - `{ "type": "date" }` as a node → a field `{ "name": "…", "type": "date" }` in a form's `fields[]` (rendered by `field:date`).
  - `{ "type": "datetime" }` as a node → a field `{ "name": "…", "type": "datetime" }` in a form's `fields[]` (rendered by `field:datetime`).
  - `{ "type": "file" }` as a node → a field `{ "name": "…", "type": "file" }` in a form's `fields[]` (rendered by `field:file`).
  - `{ "type": "formula" }` as a node → a field `{ "name": "…", "type": "formula" }` in a form's `fields[]` (rendered by `field:formula`).
  - `{ "type": "geolocation" }` as a node → a field `{ "name": "…", "type": "geolocation" }` in a form's `fields[]` (rendered by `field:geolocation`).
  - `{ "type": "location" }` as a node → a field `{ "name": "…", "type": "location" }` in a form's `fields[]` (rendered by `field:location`).
  - `{ "type": "lookup" }` as a node → a field `{ "name": "…", "type": "lookup" }` in a form's `fields[]` (rendered by `field:lookup`).
  - `{ "type": "master_detail" }` as a node → a field `{ "name": "…", "type": "master_detail" }` in a form's `fields[]` (rendered by `field:master_detail`).
  - `{ "type": "multiselect" }` as a node → a field `{ "name": "…", "type": "multiselect" }` in a form's `fields[]` (rendered by `field:multiselect`).
  - `{ "type": "number" }` as a node → a field `{ "name": "…", "type": "number" }` in a form's `fields[]` (rendered by `field:number`).
  - `{ "type": "object" }` as a node → a field `{ "name": "…", "type": "object" }` in a form's `fields[]` (rendered by `field:object`).
  - `{ "type": "percent" }` as a node → a field `{ "name": "…", "type": "percent" }` in a form's `fields[]` (rendered by `field:percent`).
  - `{ "type": "phone" }` as a node → a field `{ "name": "…", "type": "phone" }` in a form's `fields[]` (rendered by `field:phone`).
  - `{ "type": "qrcode" }` as a node → a field `{ "name": "…", "type": "qrcode" }` in a form's `fields[]` (rendered by `field:qrcode`).
  - `{ "type": "radio" }` as a node → a field `{ "name": "…", "type": "radio" }` in a form's `fields[]` (rendered by `field:radio`).
  - `{ "type": "rating" }` as a node → a field `{ "name": "…", "type": "rating" }` in a form's `fields[]` (rendered by `field:rating`).
  - `{ "type": "richtext" }` as a node → a field `{ "name": "…", "type": "richtext" }` in a form's `fields[]` (rendered by `field:richtext`).
  - `{ "type": "signature" }` as a node → a field `{ "name": "…", "type": "signature" }` in a form's `fields[]` (rendered by `field:signature`).
  - `{ "type": "summary" }` as a node → a field `{ "name": "…", "type": "summary" }` in a form's `fields[]` (rendered by `field:summary`).
  - `{ "type": "tags" }` as a node → a field `{ "name": "…", "type": "tags" }` in a form's `fields[]` (rendered by `field:tags`).
  - `{ "type": "url" }` as a node → a field `{ "name": "…", "type": "url" }` in a form's `fields[]` (rendered by `field:url`).
  - `{ "type": "user" }` as a node → a field `{ "name": "…", "type": "user" }` in a form's `fields[]` (rendered by `field:user`).
  - `{ "type": "vector" }` as a node → a field `{ "name": "…", "type": "vector" }` in a form's `fields[]` (rendered by `field:vector`).
  
  A host that rendered a field widget outside a form addresses it as `field:<type>`, or uses `getLazyFieldWidget(<type>)`, which never went through the bare key.
  
  **Clause-②: yes** — a registration leaves the runtime (narrowing), released as `minor` under the objectui narrowing rule, with this banner.
- 615346d: The formula and summary field widgets read `@objectstack/spec`'s own spellings, `returnType` and `summaryOperations`, and the snake_case spellings they used to read are retired at once (objectui#11070).
  
  **Visible change.** Object metadata carries the spec spellings: the platform's example apps write `returnType` on a formula field and `summaryOperations: { object, field, function }` on a roll-up, and the metadata admin stamps `returnType` from the inferred formula type. The widgets read only `return_type` and `summary_type`, so on an object-bound form a formula or summary field rendered without its type formatting: a number formula showed `3` instead of `3.00`, a boolean formula `true` instead of `Yes`, a date formula the raw `2026-07-04` instead of the shared date face, and a `sum` roll-up `15750.5` instead of `15750.50`. They now format by what the definition declares.
  
  - **`@object-ui/fields`:** `FormulaField` reads `returnType` (`number` to two decimals, `boolean` as Yes/No, `date` through the shared date face, anything else as text). `SummaryField` reads `summaryOperations.function` (`count` as it arrives, `sum` / `avg` / `min` / `max` to two decimals). Neither reads a snake_case spelling any more. `FormulaField` also no longer formats a `currency` return type, which the spec does not list.
  - **`@object-ui/types`, the form-field face:** `FormField` and its zod mirror `FormFieldSchema` declare `returnType` and `summaryOperations`, each the spec's `FieldSchema` member by reference, with the spec's own value rules. The strict authoring face (`StrictAnyComponentSchema`) accepts them on a hand-authored form's field, and judges them: a `returnType` of `datetime`, a `summaryOperations` with no `function`, a `function` of `first`, or an unknown member inside `summaryOperations` is refused on both faces. The tolerant face (`AnyComponentSchema`) used to strip both keys from a form field unjudged, so those values were accepted silently before this change: that half is a narrowing.
  - **`@object-ui/types`, the field metadata types:** `FormulaFieldMetadata.returnType` replaces `return_type`; `SummaryFieldMetadata.summaryOperations` replaces `summary_object`, `summary_field`, `summary_type` and `summary_filter`; `PasswordFieldMetadata.minLength` / `maxLength` replace `min_length` / `max_length`. Each is the spec member by reference.
  
  **Breaking, priced as minor under the fixed group's version policy.** A literal annotated as `FormulaFieldMetadata`, `SummaryFieldMetadata` or `PasswordFieldMetadata` that still writes a retired member no longer compiles (an excess-property error naming the key), and at runtime a formula or summary field that carries only `return_type` or `summary_type` renders its value unformatted. `@objectstack/spec`'s `FieldSchema` refuses every retired spelling by name, so no spec-compliant producer writes them. The fix is the spec spelling: `returnType`, and `summaryOperations: { object, field, function }` (with `filter` for the former `summary_filter`).
  
  **Not in this change.** `LookupFieldMetadata.reference_to` and the lookup readers' `reference_to` read stay: in-repo producers still write `reference_to` onto the field definitions those readers are handed, so retiring the spelling is a separate decision on objectui#11070. The strict face keeps refusing `return_type`, `summary_type`, `summary_object` and `summary_field` on a hand-authored form's field, as before.
  
  ⚠️ **Dated note, 2026-09-30 — the `reference_to` decision was taken in this same release — objectui#11070.** "Not in this change" above is still true of this change. Round 4 of objectui#11070, later in this same release, retired `LookupFieldMetadata.reference_to` and the lookup readers' `reference_to` read, and moved the in-repo producers to `reference`. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
- 75dcc81: The grid field's `columns` is `@objectstack/spec`'s inline grid column list, by reference, and `object-chart` declares the per-element `dataSource` binding like the other gate-wrapped blocks (objectui#11070, round 7).
  
  - **Grid columns (`@object-ui/types`).** `GridFieldMetadata.columns` and the form-field face's `FormField.columns` (TypeScript and the zod mirror `FormFieldSchema`) are `FieldSchema.inlineColumns` by reference: an array of the spec's strict, `name`-keyed inline grid column (`InlineGridColumn`), which the spec declares as the mirror of the `grid` widget's column. The key stays `columns`: a `grid` field is objectui's own field type, and the spec spells the same list `inlineColumns` on a `master_detail` field.
  - **`GridColumnDefinition` is retired (`@object-ui/types`).** Nothing read it, and it was not the shape the widget read: it required a free-form `type` and declared `defaultValue` and `validate`, which no reader consumed. Use `InlineGridColumn` from `@objectstack/spec/data`, or `NonNullable<GridFieldMetadata['columns']>[number]`.
  - **`GridColumn` (`@object-ui/fields`)** is `InlineGridColumn` by reference instead of a hand-written copy. `GridField` already read each column by exactly the spec's keys (twenty, with no second spelling), so nothing changes at render time.
  - **`object-chart` · `dataSource` (`@object-ui/types`).** `ObjectChartSchema` (TypeScript and the zod mirror) and the authored arm `ObjectChartBlockSchema` declare `dataSource` as the spec's `ElementDataSourceSchema`, by reference, at node level beside the `properties` bag, as `ObjectFormBlockSchema` and `ObjectMapBlockSchema` do. The registration is gate-wrapped, so `ElementDataSourceGate` reads the binding off the node and lands its `object` on `objectName`; the react-page wrapper no longer writes the host adapter under that key (objectui#11070, round 2).
  
  **Clause-②: yes (narrowing).** The strict face's accept set widens: a grid field's `columns` and an `object-chart` node's `dataSource` binding used to be refused by name there and now parse. The tolerant face narrows, because both keys are now judged by their declared type on both faces:
  
  - a grid column the spec refuses is refused: the retired `field` spelling, a `title`, a per-column `defaultValue`, a `type` outside the nine cell controls (`text`, `number`, `currency`, `date`, `datetime`, `time`, `select`, `lookup`, `file`), or a `scale` on a column declaring `type: 'currency'`. `FormFieldSchema` strips an undeclared key, so before this change such a column list was dropped from the parsed field in silence;
  - an `object-chart` node whose `dataSource` is not a binding is refused, `null` or an adapter object included. The authored arm is `.passthrough()`, so before this change that value was kept unjudged.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  - **TypeScript.** `import type { GridColumnDefinition } from '@object-ui/types'` no longer resolves. A grid column literal typed `GridFieldMetadata['columns']`, `FormField['columns']` or `GridColumn` that carries a key the spec column does not declare, or a `type` outside the nine, is a compile error. A `readonlyWhen` / `requiredWhen` written as an object must name its `dialect`, as the spec's expression envelope does. An `ObjectChartSchema` literal whose `dataSource` holds an adapter is a compile error; pass the adapter as the component's `dataSource` prop, or through `SchemaRendererProvider`.
  - **Validation.** The documents above that the tolerant face (`safeValidateSchema`, and so `objectui validate`) accepted are refused. Fix: write the spec's column keys (`name`, `label`, `type`, …), or drop a key the column does not have; write a binding (`{ "object": "…" }`) or no `dataSource` on an `object-chart` node.
  
  Rendering does not change: `GridField` reads the same keys as before, and `ElementDataSourceGate` ignores a value that is not a binding.
- 55a12a8: The grid field reads each field-level key under the one spelling `GridFieldMetadata` declares (objectui#11070, round 8).
  
  `GridFieldMetadata` declared `allow_reorder` and the docs taught it, while `GridField` read `reorderable`, so `allow_reorder: false` still drew a drag handle on every row. The widget also read its footer total under three spellings, and read four keys that no face declared. Each key now has one spelling, and that spelling is declared and read:
  
  - **Reorder (`@object-ui/fields`).** `GridField` reads `allow_reorder`. `allow_reorder: false` removes the drag handles. The undeclared `reorderable` is no longer read; this round's census found no writer of it in either repository.
  - **Total (`@object-ui/types`, `@object-ui/fields`).** `GridFieldMetadata` declares `total_field`, the one spelling the grid reads. It names the CHILD column summed into the footer, which is the spec's `amountField` (`inlineAmountField` on a `master_detail` field, `subforms[].amountField` on a form view). It is not the spec's `totalField`, the parent field a master-detail save writes the sum to. The `amount_field` and `amountField` reads beside it are retired: the same census found nothing writing either into the grid's config.
  - **`add_label` (`@object-ui/types`).** Declared. `MasterDetailForm` writes it from a detail's `addLabel`, and it labels the grid's Add button.
  - **`allow_duplicate` and `show_line_numbers` (`@object-ui/fields`)** are retired under ADR-0049. No face declared either, and the census found no producer of either. The behaviour their defaults gave stays: each row offers a duplicate action whenever rows can be added, and the line-number column always shows.
  - **`sort_field` is unchanged.** `MasterDetailForm` still writes it from a detail's `sortField`, which is derived from the child object when not authored. The spec declares no inline sort-field key, so it stays read and undeclared, named in one place in `GridField`.
  - **`record:line_items` total (`@object-ui/plugin-form`).** The panel shows its grid's footer total whenever `amountField` names the column to sum, the way `MasterDetailForm` already did. It used to show it only when `totalField` was also set.
  
  `GridField` now types its config reads as `GridFieldMetadata`, so a read of a key the type does not declare fails to compile.
  
  **Clause-②: yes (narrowing).** The published `GridFieldMetadata` face widens by two optional members, `total_field` and `add_label`. What the grid honours narrows: five keys it used to read are no longer read.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  - **Rendering.** A grid field written with `reorderable`, `amount_field`, `amountField`, `allow_duplicate` or `show_line_numbers` renders as if that key were absent. Fix: write `allow_reorder: false` to turn off drag reordering, and `total_field` to name the summed column. To turn off the duplicate action, turn off adding with `allow_add: false`; there is no switch for the line-number column.
  - **Behaviour.** `allow_reorder: false` now removes the drag handles; before, it was ignored. A `record:line_items` panel with `amountField` and no `totalField` now shows the footer total of that column.
  - **TypeScript.** A `GridFieldMetadata` literal carrying any of the five retired keys was already a compile error, and still is.
  
  **Note, 2026-10-01 (objectui#11070 round 9, shipping in this same release).**
  The `sort_field` bullet above no longer holds. `GridFieldMetadata` now declares
  `sort_field`, so `GridField` reads no undeclared key, and a detail's `sortField`
  is no longer authored: `MasterDetailDetailConfig` has no such member, and
  `MasterDetailForm` hands the grid the sort field it derives from the child
  object. See `11070-grid-sort-field-round9`.
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
- dd5ff19: The text-family field types and every length reader use `@objectstack/spec`'s own `minLength` / `maxLength`, and the snake_case `min_length` / `max_length` are retired at once, with no alias (objectui#11070, the text-family round). Two switches nothing read, `auto_compute` and `auto_update`, are retired too.
  
  - **Types.** `TextFieldMetadata` and `TextareaFieldMetadata` declare `minLength` and `maxLength`; `MarkdownFieldMetadata`, `HtmlFieldMetadata`, `RichtextFieldMetadata`, `EmailFieldMetadata` and `UrlFieldMetadata` declare `maxLength`. Each is `FieldSchema`'s member by reference, and each replaces the snake_case member the type declared before. `FormulaFieldMetadata.auto_compute` and `SummaryFieldMetadata.auto_update` are removed: nothing in ObjectUI read either.
  - **Readers.** The form renderer's built-in `input`, `textarea` and fallback branches, the form's validation rules (`buildValidationRules`), `TextAreaField`, `RichTextField`, `EmbeddableForm`'s default long-text cap and `ObjectForm`'s length forwarding read `maxLength` / `minLength` alone. The built-in branches no longer strip a `max_length` key off the element: nothing reads it, so it is treated like any other undeclared key.
  - **Dashboard.** `ObjectDataTable` and `RecordDetailDrawer` no longer copy a lookup's `display_field` onto their internal cell meta. The lookup cell has read the display pointer as `displayField` since objectui#7155, so nothing changes on screen.
  
  `FieldSchema` refuses `min_length`, `max_length`, `auto_compute` and `auto_update` by name, so no spec-compliant producer writes them. A definition served through `ObjectStackAdapter.getObjectSchema` or `MetadataProvider` is unaffected even if it was stored with a snake_case length: the ingestion pass folds `max_length` / `min_length` onto `maxLength` / `minLength` before any reader sees it. Measured with an object-bound `textarea` field declaring `max_length: 111` on `ObjectForm`, served through `ObjectStackAdapter`: the editor has `maxlength="111"` and a `0/111` counter before and after this change.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  The type change is a compile error for TypeScript that writes `min_length`, `max_length`, `auto_compute` or `auto_update` on one of these types (an excess-property error naming the key). Rename the first two to `minLength` / `maxLength`, and delete the other two.
  
  At runtime, a length spelled only `max_length` or `min_length` now applies nowhere the ingestion fold does not run first. Measured before and after this change:
  
  - **A hand-authored `form` document handed straight to the renderer.** A built-in `input` field with `max_length: 5` and a `textarea` field with `max_length: 7` rendered `maxlength="5"` and `maxlength="7"`. They now render no `maxlength`, and the element carries `max_length` as an inert attribute, as it would any key the renderer does not read. The same fields spelled `maxLength` render identically before and after.
  - **An object definition served to `ObjectForm` by a `DataSource` other than `ObjectStackAdapter`.** A `textarea` field with `max_length: 111` had `maxlength="111"` and a `0/111` counter; it now has neither. The same field spelled `maxLength` is unchanged.
  - **Submit-time validation.** `buildValidationRules` on a field carrying only `max_length: 9` / `min_length: 2` produced `maxLength` and `minLength` rules; it now produces no rules.
  - **`EmbeddableForm`.** A custom `textarea` field carrying `max_length: 40` used to opt out of the default cap and got no `maxLength`; it now gets the 5000-character long-text default.
  
  **Fix:** spell the bounds `maxLength` / `minLength`.
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
- 8631c32: **BREAKING (stored data): `LocationField` reads and writes the spec's `{ lat, lng }`**
  
  FROM — the widget read `value.latitude` / `value.longitude`, each behind `|| 0`, and emitted
  `{ latitude, longitude } | null`.
  
  TO — it reads and writes `LocationValue` from `@objectstack/spec/data`
  (`{ lat, lng, altitude?, accuracy? }`), re-exported here rather than re-declared, and reads
  nothing else. A pair is read only when BOTH `lat` and `lng` are finite numbers.
  
  **The behaviour change, stated plainly:** a `type: 'location'` record stored in the retired
  `{ latitude, longitude }` spelling — including one this widget itself wrote before this
  release — now renders **EMPTY in the edit surface**, where it used to render its
  coordinates. It keeps rendering correctly in detail views, list cells and on the map, which
  read `lat`/`lng` first. Re-saving the record through this widget, or fixing the value at the
  data layer, restores it. There is deliberately **no compatibility fallback**: the maintainer
  ruled the bare flip (2026-08-28, objectui#6272 option A1) explicitly over a dated read-side
  shim, choosing zero dialect over softening this cost.
  
  Marked `minor` per AGENTS.md §版本号策略 (this repo never publishes `major` outside an
  `@objectstack` major sync); the break is real and is stated here.
  
  **Why the widget was the side that moved**
  
  `@objectstack/spec@17.2.0` exports `LocationValue = { lat, lng, altitude?, accuracy? }` as
  the canonical stored shape and deprecates `LocationCoordinates` (`{ latitude, longitude }`).
  Measured through the contract itself, `valueSchemaFor({ type: 'location' })` **rejects**
  `{ latitude, longitude }` with `invalid_type` at `[lat]` and `[lng]`, and **accepts**
  `{ lat, lng }`. So this widget was the one `location` surface producing a shape the
  platform's own validator refuses, and `LocationCellRenderer` / `ObjectMap` reading
  `lat`/`lng` first is correct by contract, not tolerance.
  
  The user-visible defect it fixes: a spec-canonical `{ lat, lng }` record rendered **`0, 0`**
  in the edit box — not an error state but a valid coordinate in the Gulf of Guinea — while
  the same record rendered correctly one panel away. The `|| 0` defaults are gone with the
  rename, so a half-stored pair (`{ lat }` alone) no longer invents the coordinate it is
  missing; it reads as unset. A stored `{ lat: 0, lng: 0 }` still renders `0, 0`, because that
  is now the only way those digits can appear.
  
  `GeolocationField` is **not** part of this change: `geolocation` is not a member of the
  spec's closed `FieldType` union and its value schema accepts both spellings, so it keeps its
  own `{ latitude, longitude }` shape.
- e552c31: fields: validate a STORED `location` value on an edit form (objectui#6744)
  
  `buildValidationRules` is the producer of the host-side `error` prop that every
  field widget's published objectui#3222 slot reads, and it had no branch for
  `location`. So a coordinate that was **already in the record** and violated the
  spec's range was never validated on an edit form: the control rendered it,
  nothing marked it invalid, and submitting re-wrote it unchanged.
  
  It now compiles a `validate.location` entry that adjudicates a present value
  against `valueSchemaFor(field, 'stored')` — the platform's own value-shape
  contract (ADR-0104 D1), the same schema the engine's record validator checks a
  stored `location` against. An out-of-range stored value now marks the control
  invalid, renders the spec's own complaint, and blocks the write; a legal value
  is untouched.
  
  ⛔ The bounds are not restated in objectui. A hand-copied range would be a second
  contract free to drift from the spec (AGENTS.md #0.1), so the schema is asked and
  the message is built from its issues — the same discipline `LocationField`'s own
  range refusal already follows.
  
  Deliberately unchanged:
  
  - **Input-time refusal (objectui#6714/#6716) is still the widget's.** A refusal
    means `onChange` never fires, so the typed text never becomes a form value and
    this rule is handed `undefined`. The two do not overlap.
  - **Absence is `required`'s business.** The spec's schema refuses `null` and
    `undefined` outright because it describes a *present* value, so the rule asks
    core's `isMissingForRequired` — the repo's single presence contract — rather
    than inventing a second definition of "empty". A create form with an untouched
    location field is unaffected.
  - **A field-authored `validate` keeps running**, composed under its own key
    rather than replaced.
  - **Scope is `location` only.** Whether other field types have the same
    stored-value gap is a separate question and was not surveyed here.
- 7b90231: A `type="number"` field no longer displays one value and stores another in
  silence (objectui#6780).
  
  `NumberField`, `CurrencyField`, `PercentField` and `GeolocationField` now
  announce when the browser reports `validity.badInput` — it is holding text it
  cannot read. The control is marked `aria-invalid="true"` and draws
  `Not saved: the text in this box is not a number. Enter a plain decimal
  (example: …).`, reusing the refusal shape objectui#6716 introduced for
  `LocationField`.
  
  Measured in Chromium 141.0.7390.37 (Playwright 1.62.1), typing `1e` into an
  empty number box leaves it **visibly displaying `1e`** while `.value` reads the
  empty string. Before this change the widget emitted `null`, `aria-invalid`
  stayed `"false"`, and nothing was said — on a money field. Nine keyboard
  reachable states behave that way (`1e`, `1e-`, `1e+`, `5e`, `-`, `.`, `+`, `-.`,
  `e`), and none of the six values a real browser actually emits trips the guard.
  
  Both a change arm and a **blur** arm are wired. Pasting `1e` into an empty box
  never moves `.value` off `''`, so React's input-value tracking suppresses the
  change event entirely and blur is the only arm that sees it. `PercentField`,
  `NumberField` and `GeolocationField` had no `onBlur` before; the new one
  composes any handler a host supplied rather than replacing it.
  
  The guard ANNOUNCES; it deliberately does not refuse. Refusing would leave the
  React `value` prop unchanged, and React's `updateInput` writes it back over the
  raw text — wiping the very entry the message points at.
  
  ⚠️ **Filtering truncation stays silent, and cannot be made otherwise.** Pasting
  `1.2.3` into a currency field stores `1.23`; `0x10` stores `10`. The browser
  discards those characters as they arrive, before any widget code runs, so no
  widget-side guard can refuse them — only abandoning `type="number"` could, which
  would reverse objectui#2572's deliberate `min`/`max`/`step` and mobile numeric
  keyboard affordances. This asymmetry is documented for users in
  `content/docs/guide/fields.md` and on the currency, percent and number field
  pages, because a control that warns about `1e` while silently truncating `1.2.3`
  teaches people that no warning means the value is right.
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
- 0caacca: `GeolocationField` emits `null` for a cleared coordinate, not `undefined` (objectui#6848).
  
  Emptying a latitude or longitude box now emits `{ …, latitude: null }` where it previously
  emitted `{ …, latitude: undefined }`. `CurrencyField`, `PercentField` and `NumberField` all
  already emitted `null` for the identical user action, and `LocationField` emits `null` too —
  this composite was the only widget of the class that did not.
  
  **Why `undefined` was the wrong sentinel.** It cannot survive serialization: `JSON.stringify`
  drops an `undefined`-valued key outright, so the moment the emission left memory it stopped
  saying "the user cleared this" and started saying nothing at all. `null` says it explicitly and
  keeps saying it on the wire.
  
  **Scope — what this is NOT.** The card was filed on the reasoning that the dropped key reaches
  a PATCH-shaped update as an ABSENT key, which conventionally means "leave this field alone",
  so a cleared coordinate would silently fail to persist. That was measured before this fix was
  chosen, and the second half does not hold for this widget: the dropped key is nested one level
  below the key the write path merges on. The request body still carries the composite's own key
  (`{ <field>: { longitude: … } }`), a `location` value is stored as a single JSON column, and
  nothing on the path deep-merges — so the whole value is replaced and the cleared coordinate
  does not come back. No silent data loss was found, and none is fixed here. What is fixed is
  the emission: a widget that could not express "cleared" in a form that survives serialization,
  in a class whose other members could.
  
  **`GeolocationValue` widened** — `latitude`, `longitude` and `accuracy` are now
  `number | null | undefined`. `undefined` stays admissible, because an untouched coordinate is
  genuinely absent; `null` is now admissible because a cleared one is explicitly empty. Code that
  reads these coordinates with a falsy or `== null` test is unaffected. Code that distinguishes
  `=== undefined` specifically will now see `null` after a user clears a box.
  
  A legitimate `0` coordinate (the equator, the prime meridian) is unaffected and is now pinned:
  the emptiness test reads the raw input string, and `'0'` is not an empty string.
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
- f08bcd9: `FieldEditWidget` now delivers the NON-DOM half of the contract it declares.
  
  objectui#7009 made the factory forward its declared DOM pass-through block. The rest of
  `FieldWidgetComponentProps` was still dropped: `error`, `onUploadingChange`, and the whole
  "Host plumbing" block (`dataSource`, `dependentValues`, `dependsOn`, `dependsOnLabels`,
  `emptyHint`, `onSelectRecord`, `onCreateNew`). A host could pass any of them with no type
  error and the widget never received it — the "declared but not delivered" class this
  package treats as first-class.
  
  `error` was the live one. `InlineFieldInput` has passed `error` into this factory since
  PR #7109 and the factory dropped it, so an inline-edit control that had failed validation
  never reported `aria-invalid`: a sighted user saw the red hint, a screen-reader user was
  told nothing. The kanban `RequiredFieldsDialog` had the same hole from the other side — it
  computes the validation state and could not hand it over — and now passes `error`, so its
  controls are marked. Delivering `error` buys the a11y MARKING only; the message text stays
  with the host, per the objectui#3222 contract.
  
  The keys travel through a new sibling executor, `toHostProps` (exported alongside
  `toDomProps`), never through the DOM whitelist — none of them is DOM-legal, and routing a
  `dataSource` adapter there is the `[object Object]` leak that whitelist exists to stop.
  Three compile-time assertions make the two executors partition the contract, so a future
  declared key cannot go undelivered silently.
  
  `dataSource` precedence is stated rather than left to emerge: a host's explicit
  `dataSource` prop WINS over `SchemaRendererContext`. That is the order `LookupField`
  already implements; the factory is a conduit and resolves nothing. A host that passes no
  `dataSource` keeps reading the context exactly as before, so no in-repo host changes
  behaviour.
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
- 7cdd2b9: **Removed `depends_on` from field metadata. Rename it to `dependsOn`.**
  
  FROM `depends_on` → TO `dependsOn`, on field-metadata documents. Nothing is
  renamed for you and there is no transition period: metadata that still spells the
  key the old way no longer gates a dependent lookup and no longer scopes its
  candidate query. It is silently inert, not an error.
  
  `depends_on` was objectui's own snake_case twin of `@objectstack/spec`'s
  field-level `dependsOn`. It was never a spec key — the object contract's
  `FieldSchema` refuses it BY NAME, so a producer that authored it produced a
  document the publish door rejects — and it is retired here under ADR-0049
  enforce-or-remove (maintainer ruling A on objectui#6153, 2026-09-02;
  objectui#7357). `dependsOn`, declared on `BaseFieldMetadata` since objectui#6153,
  is now the only spelling, and it is the one every reader widget already used.
  
  What changed, concretely:
  
  - `@object-ui/types` — `BaseFieldMetadata.depends_on?: string[]` is gone. Every
    field-metadata face that inherited it (`LookupFieldMetadata`,
    `SelectFieldMetadata`, …) loses it too. An annotated metadata literal carrying
    `depends_on` is now an excess-property error, which is the intended signal.
  - `@object-ui/fields` — `LookupField` read
    `cascadeMeta?.depends_on ?? cascadeMeta?.dependsOn`; it now reads `dependsOn`
    only. This is the behaviour half: hosts that hand the widget an UNTYPED bag
    (`as any`, a JSON metadata document off the wire) were unaffected by the type
    removal alone and are affected by this. The option widgets (`SelectField`,
    `MultiSelectField`, `RadioField`, `CheckboxesField`) never had a snake arm, so
    nothing changes for them.
  - `@object-ui/app-shell` — `paramToField()` emitted `depends_on` onto the field
    bag it hands the action-param dialog's widgets. It now emits `dependsOn`. This
    was the one in-repo framework producer of the retired spelling, and the emit
    has to move with the reader: a lookup param declaring the cascade key renders a
    gated picker there, and without this half that gate would have silently
    disappeared, leaving an unfiltered picker. (Precisely, and no larger: that
    dialog supplies dependent values only to the option widgets, so the lookup's
    gate in it never lifts on its own — a pre-existing limitation this change
    neither introduces nor fixes. What moved is a permanent gate, not a working
    cascade.)
  - `@object-ui/plugin-grid` — the relational-metadata ledger drops its
    `depends_on` row, because the reader it recorded no longer exists.
  - `@object-ui/components` — comment only, no behaviour.
  
  ⚠️ Hand-written objectui host applications outside this repository cannot be
  measured from here. If yours authors `depends_on` on field metadata, rename it to
  `dependsOn`; the shapes are identical (`['country']`, or
  `[{ field: 'account', param: 'account_id' }]`).
  
  Unrelated and untouched: `AdvancedValidationRule.depends_on` (cross-field
  validation dependencies, a different concept), the object-schema documents the
  metadata designer and `resolveActionParams` read (their snake legs read STORED
  pre-strict documents — objectui#7642's census verdict), and plugin-gantt's
  `dependenciesField: 'depends_on'`, which names a record data field, not this key.
  
  ⚠️ **Dated note, 2026-09-27 — `AdvancedValidationRule` is removed from
  `@object-ui/types` by a later change, so its `depends_on` no longer exists —
  objectui#10719.**
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
- 23b9958: `RecipientPickerField` gains a picker mode for the `field` sharing recipient
  (objectui#7613; maintainer ruling objectstack#14103, executor objectstack#15072).
  
  `sys_sharing_rule.recipient_type` carries a sixth value, `field` — the
  record-relative recipient. The recipients are whoever a user-valued column of the
  SHARED object names on each matched record, so `recipient_id` stores a field
  NAME (`assignees`, `owner_manager`) and not a record id. The widget's
  `TYPE_TO_OBJECT` table had no entry for that kind, so it fell through to the
  plain text input documented for unknown types: functional (the stored value was
  already the right one), but the admin had to know and type the machine name of
  the column by hand, with no list to choose from and nothing saying whether the
  name existed.
  
  When `recipient_type` is `field`, the widget now reads the shared object from
  the sibling `object_name` field — the same dependency the `filter-condition`
  widget already reads — loads that object's schema through
  `dataSource.getObjectSchema`, and offers its **user-valued** columns, storing the
  column's name.
  
  **The offered set is exactly the set the evaluator honours**, and that agreement
  is the point of the change rather than a detail of it. The sharing evaluator
  reads a column as users when it is the `user` type, or a `lookup` /
  `master_detail` whose `reference` is `sys_user`; anything else it treats as
  "grants nobody" and warns about once per rule. A picker offering a wider set
  would let an admin save a rule that looks configured and authorises nobody —
  worse than a hand-typed name, because it has a credible appearance. `hidden` is
  deliberately not filtered (the evaluator honours a hidden user column), and
  `reference_to` is deliberately not read (the protocol refuses that spelling by
  name, and so does the evaluator).
  
  Three things the mode says out loud rather than leaving to be inferred: it asks
  for the shared object before offering anything when `object_name` is still
  unset; an object with no user columns says so instead of rendering a
  search-flavoured "No matches"; and a stored name that is not on the offered list
  — a column deleted or retyped since the rule was saved — stays visible and is
  marked, because the evaluator grants nobody for it and a control that merely
  looked empty would hide a rule that still names it.
  
  Unknown recipient types keep degrading to the plain text input, and so does
  `field` itself when the data source cannot enumerate an object's columns: a
  hand-typed name is worse than a list, and better than a list that can never
  fill.
  
  Three copy keys are added across all ten locale packs
  (`fields.recipient.selectField`, `noUserFields`, `fieldNotUserTyped`). The
  "select an object first" gate deliberately reuses the criteria builder's
  existing sentence rather than adding a twin: it is the same sentence in the same
  role on the same form, gating on the same sibling field.
- c907a9c: fix(fields): a file or image upload that surfaces no `sys_file` id is refused by name, never submitted as an inline blob
  
  **BREAKING (`@object-ui/fields`), graded `minor` by this repo's release model** (AGENTS.md: objectui's major follows the `@objectstack` family major, so its own breaking changes ship as `minor` with the breaking semantics stated here, never `major`):
  
  - **Who breaks.** Two kinds of host. The first calls `fileValueForSubmit` itself. The second mounts an upload adapter whose result carries no id-shaped `meta.fileId`. That includes the object-URL default: `useUpload()` falls back to it when no `UploadProvider` is mounted, and `UploadProvider` uses it when given no `adapter`. It also includes any S3- or Azure-style adapter, `createS3Adapter` and `createAzureBlobAdapter` among them, because neither mints a `sys_file` row. This includes every host on a non-ObjectStack backend (the README's any-backend `DataSource` path) that stored the inline `UploadedFileMetadata` object: no adapter there mints a `sys_file` id.
  - **What they see now.** `fileValueForSubmit` throws `UploadIncompleteError` (`code` `UPLOAD_INCOMPLETE`, `fileName` naming the pick) where it used to return the inline object, and its return type is `string`. In `FileField`, `FileCell` and `ImageField` the pick is refused with the translated "did not complete" row, and the field is not changed.
  - **What to do.** Mount an `UploadProvider` whose adapter returns the `sys_file` id in `meta.fileId`. `createObjectStackUploadAdapter`, the ObjectStack presigned flow, does. A custom adapter has to register the file with the platform and return that id. A host that calls `fileValueForSubmit` directly catches `UploadIncompleteError` (or checks `code === 'UPLOAD_INCOMPLETE'`) where it used to accept an object. Such a host returns its own file id in `meta.fileId` (word characters and `-`, 1 to 64 long, as `isFileIdToken` requires) and has its read path return `{ id, name, url }`, because a bare id otherwise renders from ObjectStack's `/api/v1/storage/files/:id`.
  
  `Clause-②: yes (narrowing)` — `fileValueForSubmit`, a public export of `@object-ui/fields`, narrows its return type to `string` and throws where it used to return an object; `UploadIncompleteError` is a new public export. No field-value accept set widens.
  
  `fileValueForSubmit` used to fall back to the legacy inline `{ name, original_name, size, mime_type, url }` object when the upload adapter surfaced no `meta.fileId`. That was the file and image widgets' one path to the pre-D3 inline file object: the backend's stored contract has been the bare `sys_file` id since spec `17.0.0`, so the fallback turned a successful-looking upload into a save the engine refused (`invalid_type`) on every deployment that has verified its file-as-reference migration, and into a warned-about legacy value on the rest. ADR-0104's 2026-09-05 addendum fixes the physical column to the bare id as well.
  
  The fallback is retired. `FileField`, `FileCell` and both upload paths of `ImageField` now submit the id the adapter minted, or refuse the pick with the translated `fields.file.uploadIncomplete` message ("did not complete") in the same error row a transport failure lands in — the field is not changed and no new blob reaches `onChange`. This includes the object-URL default `useUpload()` falls open to when no `UploadProvider` is mounted, and any S3/Azure-style adapter that mints no `sys_file` row. Reading is unchanged: a legacy blob already on a record still renders, and on a `multiple` field it is passed through untouched beside a new id.
  
  `@object-ui/i18n` gains the `fields.file.uploadIncomplete` key in every locale pack.
  
  `@object-ui/providers`'s `UploadProvider.tsx` JSDoc for the object-URL default now states it persists nothing and returns no id.
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
- 7ed9808: One home for the `date` display convention in the readonly field widgets
  (objectui#8194).
  
  Four readonly `date` faces in `@object-ui/fields` called
  `toLocaleDateString(locale)` with **no options bag at all** — `Intl`'s numeric
  default — so they never implemented the year-dropping decision the shared
  `formatDate` documents and every `date` CELL already follows. They now call
  `formatDate` (default style):
  
  - the readonly `DateField` (the form / detail face, and what `FieldEditWidget`
    renders in the grid and detail inline editors),
  - the sub-grid `GridField`'s readonly `date` column,
  - a `FormulaField` declaring `return_type: 'date'`,
  - the lookup picker's plain-text `$date` fallback (`lookupColumnDisplay`),
    which sits in the same function as the descriptor path that already rendered
    through `formatDate`.
  
  ⚠️ **Dated note, 2026-09-30 — the formula key above has since been renamed —
  objectui#11070.** "A `FormulaField` declaring `return_type: 'date'`" above held when this
  change landed. Later in this same release objectui#11070 (round 3) moved `FormulaField` to
  `@objectstack/spec`'s `returnType` and retired the `return_type` read, so the face described
  here is reached by a formula declaring `returnType: 'date'`.
  `.changeset/11070-field-metadata-spec-spellings.md` states what ships; the text above is
  kept as the reading of this change.
  
  **Visible change**: every one of those faces changes shape in every locale, in
  every year — not only the year token. In `en-US` a date renders `Jul 4` this
  year and `Jul 4, 2024` for a past year, where it used to render `7/4/2026` and
  `7/4/2024`; in `de` `4. Juli` / `4. Juli 2024` for `4.7.2026` / `4.7.2024`; in
  `zh` and `ja` `7月4日` / `2024年7月4日` for `2026/7/4` / `2024/7/4`; in `ar`
  `4 يوليو` / `4 يوليو 2024`. Each now matches the `date` cell beside it. This is
  a larger move than the sibling change in `@object-ui/components`
  (`c15d7eca6`), whose former face already asked for a short month and so only
  lost its year token — these four passed no bag whatsoever.
  
  A value the formatter cannot parse now reads `—` at three of the four sites
  instead of the literal `Invalid Date`. The sub-grid keeps showing the raw
  stored string for an unreadable value, unchanged (objectui#3569).
  
  Untouched: the `datetime` readonly faces (`DateTimeField`, the sub-grid's
  `datetime`/`time` branch). They are the same omission one type over, but their
  home is `formatDateTime`, whose named faces are a separate display-convention
  question; they are recorded on their own card rather than picked here.
  
  A surface that genuinely wants the year on every row is an explicit `format`
  style honoured by both paths, not a second option bag — the `c15d7eca6` /
  objectui#7443 / objectui#4576 lesson, one surface over.
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
- ac0e39a: One home for the `datetime` display convention in the readonly field widgets,
  one face per register (objectui#8209, maintainer ruling batch #142 item 2).
  
  The two readonly `datetime` faces in `@object-ui/fields` composed a bare
  `toLocaleDateString(locale)` + `toLocaleTimeString(locale)` pair joined by a
  space — no options bag on either half — so neither went through
  `formatDateTime`, which objectui#7443 declared the single home for this
  convention. They carried seconds that no `datetime` CELL has ever shown. Both
  now call `formatDateTime`, each on the face of its display register:
  
  - the readonly `DateTimeField` (the form / detail face, and what
    `FieldEditWidget` renders in the grid and detail inline editors) takes the
    **verbose default** face, the one every non-cell caller already gets;
  - the sub-grid `GridField`'s readonly `datetime` column takes **`'compact'`**,
    the face the sibling `datetime` cell renders.
  
  **Visible change**, measured in five locales for one instant (July 4, 07:00
  local):
  
  | locale | before, both sites | after, readonly widget | after, sub-grid cell |
  | --- | --- | --- | --- |
  | en | `7/4/2026 7:00:00 AM` | `Jul 4, 2026, 07:00 AM` | `7/4/2026 7:00 am` |
  | de | `4.7.2026 07:00:00` | `4. Juli 2026, 07:00` | `4.7.2026 7:00 am` |
  | zh | `2026/7/4 07:00:00` | `2026年7月4日 07:00` | `2026/7/4 上午7:00` |
  | ja | `2026/7/4 7:00:00` | `2026年7月4日 07:00` | `2026/7/4 午前7:00` |
  | ar | `4/7/2026 7:00:00 ص` | `4 يوليو 2026، 07:00 ص` | `4/7/2026 7:00 ص` |
  
  (The `ar` rows carry U+200F marks around the date separators; they are omitted
  here so the table stays readable.)
  
  **The year is not dropped.** The year-drop is `formatDate`'s date-only cell
  rule (`c15d7eca6`); the verbose default face carries the year in every year,
  and nothing here extends the drop to `datetime`.
  
  **No new authorable key.** The sub-grid selects `'compact'` as a literal rather
  than reading an authored style: the column shape this widget renders from
  (`GridColumn`, mirroring the published `GridColumnDefinition`) declares no
  `format` key, so there is no existing vocabulary to reuse, and declaring one
  was refused. The accepted authoring set is unchanged by this release.
  
  A value the formatter cannot parse now reads `—` at the readonly widget instead
  of the literal `Invalid Date Invalid Date`. The sub-grid keeps showing the raw
  stored string for an unreadable value, unchanged (objectui#3569).
  
  With this, objectui#7443's "`datetime` has one home" holds for all six bare
  no-bag sites objectui#8194 enumerated.
  
  ⚠️ **Dated note, 2026-10-01 — `GridColumn` is the spec's inline grid column — objectui#11070.** "(`GridColumn`, mirroring the published `GridColumnDefinition`)" above held when this change landed. Later in this same release objectui#11070 (round 7) retired `GridColumnDefinition` and made `GridColumn` `@objectstack/spec`'s `InlineGridColumn` by reference. That shape declares no `format` key either, so the reasoning above is unchanged. `.changeset/11070-grid-columns-chart-binding-round7.md` states what ships; the text above is kept as the reading of this change.
- c03d03b: An authored `max_length` on a rich-content field is now VISIBLE, not only enforced at
  submit (objectui#8438).
  
  **The defect.** `markdown`, `html` and `richtext` are three registry keys served by ONE
  widget, `RichTextField`. That widget read `maxLength` / `max_length` nowhere, while
  `buildValidationRules` — which has no field-type gate — compiled the same key into a
  react-hook-form rule for every field. So a cap authored on any of the three was enforced
  when the form was submitted and invisible before then: no native stop, no character
  counter, nothing named in `aria-describedby`. The person was told the limit only after
  writing the text, which is the worst of the three possible orderings.
  
  **The fix, and where it is NOT.** The card was filed as "`richtext` is missing from
  `ObjectForm`'s maxLength guard and `EmbeddableForm`'s `DEFAULT_MAX_LENGTH`". Re-measured,
  neither list could have carried the cap:
  
  - `ObjectForm`'s guard writes `formField.maxLength`, but a registered widget's metadata
    carrier is `formField.field` — a different object. Ablating that assignment entirely
    changed no rendered attribute, for any of the four types it names. It is left in place
    (it is live for the other form-field producer) with the measurement recorded at the site.
  - `EmbeddableForm`'s `DEFAULT_MAX_LENGTH` did deliver 5000 for `markdown` and `html`, and
    `RichTextField` then dropped it unread.
  
  ⇒ The cap was lost for **all three** rich-content keys, not for `richtext` alone.
  `RichTextField` now dual-reads `maxLength ?? max_length` off its metadata carrier — the
  same read `TextAreaField` has carried since framework#1878 §3 — and forwards it to the
  native stop, the `CharacterCount` counter and the `aria-describedby` wiring, on both the
  inline surface and the fullscreen dialog.
  
  **What changes for you.** A `markdown`, `html` or `richtext` field that already declares
  `max_length` (or the spec-canonical `maxLength`) now shows a counter and stops typing at
  the cap, where before it silently accepted the overflow and failed on submit. A field with
  no authored cap is unchanged. In `EmbeddableForm`, a public form's `richtext` field is now
  capped at the 5000-character long-text default like its two siblings, instead of accepting
  unbounded input.
  
  **New export.** `@object-ui/fields` publishes `RICH_TEXT_FIELD_TYPES` (and the
  `RichTextFieldType` union), the key set of the widget's display table, so consumers stop
  hand-writing the list. `EmbeddableForm`'s cap table is derived from it. This answers the
  list question objectui#4831 raised and its fix declined to remove — the root cause behind
  objectui#4250, objectui#4831 and this card: a hand-written list that stops at two of one
  widget's three registry keys can no longer omit the third, because it no longer names one.
  
  ⚠️ **Dated note, 2026-09-30 — the widget reads `maxLength` alone — objectui#11070.** Later in this same release objectui#11070 (its text-family round) retired the snake_case `max_length`: `RichTextField` reads `maxLength` only, not `maxLength ?? max_length`, and `MarkdownFieldMetadata`, `HtmlFieldMetadata` and `RichtextFieldMetadata` declare `maxLength` in its place. So "a field that already declares `max_length` … now shows a counter" above holds for `maxLength` only; a ceiling that reaches the widget spelled `max_length` gets no stop and no counter. `.changeset/11070-text-family-round5.md` states what ships; the text above is kept as the reading of this change.
- 639ca9d: An empty array is no longer a cell value in the shared read renderers (objectui#8481).
  
  Three renderers in `@object-ui/fields` open a multi-value container and map their
  entries into it. Their opening guards tested only `null` / `undefined` / `''`, so `[]`
  passed and each mapped over zero entries — the renderer's entire output was a
  **childless container**: no glyph, no `aria-label`, a visually blank cell.
  
  | field types | renderer | output for `[]` before |
  |---|---|---|
  | `select`, `status`, `multiselect`, `radio`, `checkboxes`, `tags` | `SelectCellRenderer` | a flex-wrap DIV with no children |
  | `lookup`, `master_detail`, `tree` | `LookupCellRenderer` | a flex-wrap DIV with no children |
  | `user` | `UserCellRenderer` | an avatar-stack DIV with no children |
  
  All ten types now render the shared `EmptyValue` affordance — the muted em-dash with a
  `No value` accessible name — exactly as they already did for `null`.
  
  **Why this is user-visible on multiple surfaces.** `@object-ui/plugin-detail` already
  carried two private upstream pre-checks against this (objectui#8474's `hasCellValue`
  and `RelatedList`'s `isValueEmpty` from objectui#8459), so the record page was already
  protected. Every consumer that does not pre-check reached the renderer directly:
  `ObjectGrid` (both the desktop table and the sub-768px card layout), `ObjectGallery`
  and `ObjectKanban` were each verified by rendering to paint the blank cell before this
  change and the affordance after it.
  
  **Deliberately narrow.** This is not a package-wide emptiness predicate and the helper
  is not exported. Measured by rendering every registered field type against `[]`, these
  renderers hold at least seven different private answers to "is this empty", and several
  of the disagreements are intentional: `JsonCellRenderer` draws the two-character array
  literal (measured and kept by objectui#8474) and `FileCellRenderer` states `0 files`.
  Neither moves, and both are pinned as the declared boundary of this change. `{}` is
  untouched everywhere — the test is `Array.isArray`, so an object cannot reach it.
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
- 55ba3ff: A `lookup` reference that resolved to nothing now gets **one** answer instead of
  two opposite ones (objectui#8695), carrying objectui#8434's ruling to the second
  renderer that had the same defect.
  
  `LookupCellRenderer` split a single epistemic state — *a reference this screen
  did not resolve* — by the **shape of the string**. `isLikelyOpaqueId` sent
  opaque-looking ids to a muted `—` and sent everything else to confident bare
  text. Measured with `reference_to: 'sys_user'`, `'Ada Lovelace'` rendered
  `<span class="block max-w-full truncate" title="Ada Lovelace">Ada Lovelace</span>`
  — **byte-identical** to what a `text` cell prints for the same string — while
  `'01HQZX9K2M4N6P8R'` rendered a muted `—`. So the name-shaped case stated a
  confident fact the screen did not have (a dirty row read exactly like a clean
  one), and the opaque case destroyed the raw id, which objectui#8434's triage
  named as "the only clue for diagnosing existing dirty rows". Two opposite
  failures, one state.
  
  Both now render the affordance objectui#8434 settled on: the raw value kept
  **visible**, beside a muted marker glyph and a stated sentence, keyed as
  `detail.unresolvedLookupReference` in all ten locale packs. `master_detail` and
  `tree` route through the same renderer and get the same answer, as does the
  multi-value chip shape — including the `+N` overflow chip's `title`, which now
  lists the values it hides instead of a row of dashes.
  
  **The sentence is epistemic, not ontological, and it is a sibling of the `user`
  one rather than the same key.** At least six causes reach this arm and the
  renderer distinguishes none of them: never fetched, in flight, the resolver
  threw, the resolver answered with no record, it answered with a record no
  display field could name, and — for array entries after the first — never asked.
  `useLookupName` returns `string | undefined`, dropping the `pending`/`err`/`ok`
  discriminator its own cache holds. Several of those also cover a record the
  viewer may simply not be allowed to read, and "cannot read" versus "does not
  exist" is a boundary this renderer cannot see across. So it states only what is
  true of all of them: this screen did not resolve it. The `user` pack value ends
  "was not resolved to a user", which is false on a lookup pointing at any other
  object, hence a separate key.
  
  **Why `minor` and not `patch`.** The test this lane applies is whether EXISTING
  STORED DATA renders differently, and here some of it is not broken data.
  `LookupCellRenderer` auto-resolves only the FIRST primitive of an array
  (`primaryPrimitiveId`, and `resolveLabel` returns a name only when
  `val === primaryPrimitiveId`) — a documented cheapness policy, not a defect. So
  on a multi-value `lookup` holding perfectly clean ids, entries 2..n were never
  asked and now wear the unresolved marker where they previously printed a bare
  id or a dash. That is a visible change to a working screen over correct data,
  which is the line between the two levels; the name-shaped and opaque-shaped
  single-value cases would each have been `patch` on their own, since both were
  already wrong. `@object-ui/i18n` is `minor` for the ordinary reason: a key is
  ADDED — `detail.unresolvedLookupReference`, across all ten packs (the `user`
  sentence `detail.unresolvedReference` already shipped with objectui#8434).
  
  **Nothing else moves.** A reference resolved by an expanded record, by the
  author's `options`, or by the fetch-on-demand resolver renders exactly as before,
  unmarked; an empty cell keeps `EmptyValue`; the affordance sits inside
  `ReferencedRecordLink`, so an unresolved reference is still navigable
  (objectui#4336). Display only — no query, sort, export or save path reads a cell
  renderer's output. `isLikelyOpaqueId` stays exported (removing it would be a
  breaking change) but no longer decides how anything is drawn.
- 3ecc369: Two frozen cell-renderer censuses now read the registry instead of a literal (objectui#8734)
  
  `@object-ui/fields` gains `listCellRendererTypes()` — every field type
  `getCellRenderer` resolves to a renderer **of its own**, as opposed to the
  `TextCellRenderer` fallback every other spelling lands on. It is the read-side
  twin of `FORM_FIELD_TYPES`, and it is a **function** rather than a frozen
  constant because `registerFieldRenderer` is published: the cell registry can
  grow after the module is evaluated, so a constant would be a snapshot taken at
  import time.
  
  **What it repairs.** Two censuses declared in prose that they measure "every
  type `getCellRenderer` resolves to a renderer of its own" and enforced that with
  a hard-coded population size — `cellRenderers.objectLiteral-8596` in this
  package and `summaryChip.badgeFitCensus-8464` in `@object-ui/plugin-detail`.
  Registering one more cell renderer left both of them green: the new type is
  simply absent from the table, so every row still passes. The summary chip made
  that worse in one direction only, because `chipTakesCellRenderer` admits any
  type not named in `CHIP_UNFIT_RENDERER_TYPES` — so an unmeasured type was drawn
  with its own renderer, which is the case the census exists to rule on. Both
  censuses now reconcile their table against the live reading and fail by NAME.
  
  **No behaviour changes.** `getCellRenderer` still rebuilds its standard table on
  every call — the table literal moved into a builder function that returns a new
  object, so the per-call component identity `cellRenderers.countLabelI18n-8441`
  pins is byte-for-byte what it was. The chip's permissive default is unchanged:
  inverting it would silently downgrade a legitimately-fitting new type, which is
  a product decision about the chip and not part of this repair.
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
- e05553c: Take the percent cell's magnitude from the value, never from the column's name
  (objectui#9452).
  
  `PercentCellRenderer` branched on `field.name` before it looked at the value: a
  `/progress|completion/` test decided that such a column already held percentage
  POINTS, so it skipped `percentDisplayValue` — the declared single source of
  truth for percent display scaling — on both halves of the cell. A stored `0.5`
  therefore rendered `50%` in the record-header summary chip and `1%` in the list
  cell, the same record showing two magnitudes in two places. The pattern was
  unanchored and tested against the whole lowercased name, so it also matched on
  substring: a column merely mentioning progress took the whole-percent path on
  the strength of a word inside its name.
  
  Both consumers of that branch are fixed together, because the number was only
  half of it. The mini progress bar's fill took its magnitude from the same
  predicate, and its non-matching arm was a LOCAL restatement of
  `percentDisplayValue`'s own expression rather than a call to it — so one cell
  carried two spellings of one rule plus a name test, and pre-fix a
  `progress`-named column storing `0.5` drew a bar 0.5% wide beside the text
  `1%`. The number now goes through `formatPercent` and the bar through
  `percentDisplayValue`, which is the one rule the summary chip, `formatMeasure`,
  the metric tile and the grid column summary already read.
  
  **What decided it.** The question the filing card left open — whether such a
  column stores a fraction or points — was settled by measurement rather than by
  taste. Every first-party value below `1` in a `progress` / `completion`-named
  percent column is fraction-intent: the schema catalog's own percent sample
  stores `0.753` in a field named `progress`, and the inline editor is pinned on
  a `completion` field whose stored `0.5` must show `50`. The percent EDIT widget
  never consulted the name at all — it detects the whole-percent convention from
  a declared `max` above `1` — so the editor and the cell disagreed on those very
  fields. The genuinely whole-percent producers are declared by TYPE
  (`type: 'progress'` with `min: 0` / `max: 100`) and store only `0` or integers
  at or above `1`, where both rules agree by construction. The name test had no
  producer that needed it and two that it misread.
  
  **Migration.** A value strictly between `0` and `1` stored in a percent or
  progress column now reads as a fraction everywhere, including columns named
  `progress` or `completion`. A tenant that really stored sub-1 percentage points
  in such a column will see those cells move by two orders of magnitude; the fix
  is at the producer, by storing the fraction the column's other surfaces already
  assume. Values of `0`, and every value at or above `1`, are byte-identical
  before and after.
  
  ⚠️ **Dated note, 2026-10-02 — the magnitude guess is retired in this same release — objectui#11475.**
  Later in this same release `percentDisplayValue` (`@object-ui/core`) stopped
  inferring a percentage's storage from the value: it takes the storage as a
  required argument, and every percent face passes the storage the field
  declares (`percentScaleOf` in `@objectstack/spec/data`: a fraction unless the
  field declares a `max` above 1). So the cell's magnitude comes from neither the column's name nor the value:
  a fraction-stored `1` reads `100%`, a `progress` column is percentage points at
  every magnitude, and the closing sentence above about values at or above `1`
  holds only for a field declaring a `max` above 1. The rest of this entry is kept as the reading of this change.
- f0f2046: Give the `file` grid cell a per-file view/download affordance (objectui#9485).
  
  `FileCell` — the compact `file` control a line-item grid row draws — rendered each
  stored file as a chip of image thumbnail or file icon, the filename, and a delete
  button. There was no anchor anywhere inside that chip, so an attachment on a grid row
  could not be opened or downloaded. Line-item grids are where downstream projects put
  per-row attachments (delivery-note lines, material certificates), so the consequence is
  the one objectui#9161 already ruled on, one surface further down.
  
  **`disabled` is the worse half.** `disabled` is this control's read-only state: it draws
  no picker button and no delete button either, so the chip was *nothing but* a filename —
  no route to the file existed at all.
  
  **What changed.** The chip's bare name becomes the same shared `FileValueAffordance`
  that objectui#9161 landed for the cell renderer, `FileField`'s `readonly` branch and its
  edit-state rows, with `icon` suppressed because the chip already draws its own thumbnail
  or file icon immediately to the left. The chip's other furniture — the thumbnail, the
  file icon, the delete button while editable — is untouched.
  
  **No new module, endpoint, authoring switch or translation key.** The shared component
  was already imported into this very file by objectui#9161, and the URL was already in
  hand: `readFileValues` resolves the expanded value's own `url`, or derives the stable
  `/api/v1/storage/files/:id` endpoint from a bare `sys_file` id, which 302-redirects to a
  freshly-signed short-lived URL per request. The link text is the file name, so it is the
  anchor's accessible name and nothing new had to be translated; a value carrying no name
  of its own still falls back to the existing `fields.file.fileFallback`.
  
  **A value that resolves to no URL still renders as plain text, never as a dead anchor** —
  objectui#8490's ruling for `email` / `url` / `phone` applied to this family. That case is
  pinned green on both sides of this change, because it is the one the fallback exists for.
  
  The card was filed from a source reading, with the filer stating that it had not been
  reproduced in a browser. The pins added here render the cell and read its DOM in both
  states, so this behaviour is measured rather than inferred.
- 9aa2a57: The percent EDIT WIDGET reads `scale` for its fraction width, not `precision`
  (objectui#9568).
  
  `PercentField` took `precision` as the decimal-place count for three things at
  once: the readonly face's `toFixed` width, the number input's `step` attribute
  and the slider's step. `@objectstack/spec` declares the pair on the field face
  in its own words — `precision` is "Total digits (non-negative integer)" and
  `scale` is "Decimal places (non-negative integer)" — so a percent field carrying
  an accurate `decimal(p, s)` pair was padded out to the column's TOTAL width. A
  `decimal(10, 2)` percent field rendered `25.0000000000%` readonly and offered
  `step="0.0000000001"` while editing, with a slider that moved in `1e-10`
  increments. The step half is not cosmetic: it makes the control unusable for the
  value it is declared to edit.
  
  This is the correction `NumberField` beside it already carried for its own step,
  and the one objectui#9295 made on the read-only cell, the grid summary footer
  and the record summary chip. The edit widget is the face that did not move.
  
  **Behaviour moves in two directions**, for percent fields that declare these
  members:
  
  - A percent field declaring `scale` now honours it, in all three places.
    Declaring `scale: 0` previously rendered `25.00%` and stepped by `0.01`; it
    now renders `25%` and steps by `1`.
  - A percent field declaring `precision` no longer pads to it. Declaring
    `precision: 10` previously rendered `25.0000000000%` and stepped by `1e-10`;
    it now takes the width of a percent field that declares no `scale` (below).
  
  **Migration.** Restate the intended fraction width as `scale`, the member the
  contract has always declared for it. Metadata carrying an accurate
  `decimal(p, s)` pair — both members, as a database column exposes them — needs no
  change and simply stops being padded.
  
  **A percent field that declares neither member.** This change left its width
  alone: the widget kept its own two decimals while `PercentCellRenderer` spelled
  the same absence as zero fraction digits, and objectui#9568 declined to settle
  that disagreement as a side effect of moving the member that is read. It was
  settled by its own ruling, in objectui#9843, released alongside this change: the
  absent width is `@objectstack/spec`'s, read through `resolveFieldScale` on every
  percent face, so the editor and the grid cell now agree for a field that
  declares nothing. The whole-percent convention this widget detects from a
  declared `max` above 1 is untouched.
  
  `CurrencyField` is not part of this change: a currency's decimal places are the
  currency's own ISO 4217 minor-unit count, and since objectui#10276 that widget
  reads neither `precision` nor `scale` for them. `CurrencyConfigSchema.precision`
  is a third surface again, with the opposite convention and its own `scale`
  alias, and the spec warns against conflating it with the field face.
- f7fcc2c: fix(components): Tailwind no longer compiles this package's prose into the published stylesheet
  
  `@object-ui/components`' Tailwind entry opened with a bare `@import 'tailwindcss'`
  — the only one of this repository's four stylesheet entries without a
  `source(none)` pin. Tailwind v4's automatic source detection was therefore ON,
  and it roots at the PROCESS working directory, so it scanned every non-ignored
  file in the package: `CHANGELOG.md`, `README.md`, the markdown beside the
  renderers, `shadcn-components.json`, even an English sentence in a comment inside
  `tsconfig.test.json`. Every class-shaped token in that prose compiled into a real
  rule in the published `dist/index.css`.
  
  The entry now reads `@import 'tailwindcss' source(none);`. It keeps the FULL
  Tailwind import, because this is the root sheet: preflight, the `@theme` block
  and the base layer are emitted exactly as before. Only automatic detection is
  off, so the entry's own `@source` lines are the whole input set — and the
  compiled sheet is now byte-identical whatever directory the build is launched
  from, which it previously was not.
  
  ## Breaking: 23 prose-derived utilities leave `@object-ui/components/style.css`
  
  None of these is emitted by any component under this package's `src`; each one
  existed solely because some prose in the package mentioned it. Grouped by the
  file that was creating it:
  
  - from `CHANGELOG.md` — `cursor-not-allowed`, `flex-shrink-0`, `lg:p-8`,
    `md:text-2xl`, `origin-[--radix-...]`, `pb-20`, `scale-0`, `sm:px-6`,
    `sm:py-4`, `space-y-8`, `w-[--sidebar-width]`, `xl:flex`
  - from `README.md` — `bg-blue-500`, `hover:bg-blue-700`, `text-white`
  - from `README_SHADCN_SYNC.md` — `dark:backdrop-blur-sm`, `dark:bg-background/95`
  - from the JSON examples in the renderer docs — `bg-blue-50`, `bg-gray-50`,
    `h-[600px]`, `h-[800px]`
  - from `shadcn-components.json` — a variant of `origin-[--radix-` ending in a
    typographic ellipsis
  - from a prose comment in `tsconfig.test.json` — `invert`, which is an ordinary
    English word there
  
  Two of them are worth calling out. `flex-shrink-0` is a deprecated Tailwind v3
  alias this repository deliberately migrated away from, and it was shipping only
  because the changelog entry announcing that migration names it.
  `w-[--sidebar-width]` and the `origin-[--radix-` pair are the v3 bracket syntax,
  shipping only because the changelog entry recording the move to v4 syntax quotes
  the old spelling. A consumer who had come to rely on any of the 23 should add it
  to their own Tailwind sources; they were never this package's to publish.
  
  ## Fixed: three sibling packages get back classes their own components emit
  
  The plugin stylesheets subtract every rule `@object-ui/components` already
  ships, so any class the prose invented was subtracted out of THEIR sheets while
  their components still emitted it — under-styled published packages with a green
  build. Restored by this change:
  
  - `@object-ui/plugin-kanban` — `h-[600px]`, `sm:px-6`, `sm:py-4`
  - `@object-ui/plugin-grid` — `bg-blue-50`, `cursor-not-allowed`
  - `@object-ui/fields` — `bg-blue-50`, `bg-blue-500`, `bg-gray-50`, `text-white`
  
  The same mechanism was also a loaded gun for the release lane: `changeset:version`
  writes changeset bodies into `packages/components/CHANGELOG.md`, so a changeset
  that merely QUOTED a class name promoted it to a real utility in this sheet and
  stripped it out of the plugin sheets at the next release. That is no longer
  possible for these four packages — which is why this body can safely quote 23
  class names.
  
  ## Why `minor` rather than `patch`
  
  Removing utilities from a published stylesheet is a contraction of a published
  artifact, so it carries a breaking semantic. This repository does not ship
  `major` outside the `@objectstack` major-sync release, and marks its own breaking
  changes `minor` with the break spelled out — which is what the section above is.
- 1560d46: Store a typed percent by shifting the decimal, not by dividing a float by 100
  (objectui#9810, maintainer ruling batch #161 item 3, letter B).
  
  The percent edit widget converted a typed percentage-point value to its stored
  fraction with `n / 100`. That division is not representable in binary floating
  point, so the quotient carried residue nobody typed — `66.67` reached the write
  path as `0.6667000000000001`, `99.99` as `0.9998999999999999`.
  
  The ruling settles which quantity `scale` names on a `percent` field: the
  DISPLAYED percentage-point decimals, with storage DERIVED — a fraction-stored
  percent (`percentScaleOf` = `fraction`) allows `scale + 2` decimal places in the
  stored fraction. The platform enforces that allowance by REJECTION, never
  rounding, so every residue value above is a write this widget's own `step`
  attribute offers and the write path then refuses.
  
  **What changes for a consumer.** For a fraction-stored percent field, the value
  handed to `onChange` is now the double nearest the decimal the author typed: a
  display value carrying `d` decimal places stores `d + 2` places and no more.
  Values the old division already got exactly right are byte-identical. The
  `whole` convention (a field declaring `max > 1`) is untouched — there the typed
  number is the stored number.
  
  **Not a rounding.** An author who types finer than the declared width still
  stores every digit they typed and is still refused upstream; a widget-side
  rounding would convert the platform's refusal into silent data alteration.
- 4d7d322: Stop `FilterConditionField` writing a `between` row into stored criteria until BOTH bounds
  are filled in (objectui#9914).
  
  `condToMongo`'s `between` arm handed whatever was in the two boxes straight to
  `coerceByType`, which returns `''` unchanged (its `value !== ''` conjunct). So a range the
  admin had half typed travelled through `handleBuilderChange` → `filterGroupToMongo` →
  `onChange(JSON.stringify(mongo))` into a stored `sys_sharing_rule.criteria_json`. The
  existing operator pin exercises `between` with a COMPLETE pair only, so the half-filled
  case had never been driven.
  
  Measured against `ValueDataSource`'s matcher over four rows, the three documents this
  could author are three different predicates and not one of them is the range being typed:
  
  - `{ age: { $gte: 1, $lte: '' } }` matched **0 of 4** rows — `1 <= ''` is `1 <= 0` — so a
    sharing rule saved mid-edit silently shares nothing;
  - `{ age: { $gte: '', $lte: 5 } }` matched **3 of 4**, including a row the real lower
    bound would have excluded, because `''` compares as `0`;
  - `{ age: {} }` matched **all 4**. That is what an untouched `between` row emitted the
    moment the operator was picked: the builder clears both bounds to `[]` and
    `JSON.stringify` drops the two `undefined`s. On a sharing rule that is an over-share,
    and the widget's own `isMatchAllCriteria` hint does not catch it — a field key holding a
    nested object is not one of the vacuous shapes it recognises.
  
  That last shape also fails `kvToCondition`, so the widget read its own emission back as
  unrepresentable and forced ITSELF into the raw-JSON editor with the toggle disabled.
  Picking **Between** therefore ended visual editing of the rule — objectui#8748's shape, on
  a second operator. It is fixed by the same change.
  
  **What changes.** A `between` condition whose lower or upper bound is `undefined` / `null`
  / `''` now emits no fragment at all, exactly as an unfinished text row already did. A
  complete range emits precisely what it emitted before, and `0` and `false` stay real
  bounds — the drop is spelled `===` against the three unfilled shapes, never `!bound`. A
  rule whose only row is a half-filled range therefore saves as empty criteria and is
  refused on save (objectstack#3896) instead of storing a predicate nobody typed. Criteria
  already stored are untouched: they still load, and they still emit what they carry once
  both bounds are on screen.
  
  **Why the row is dropped rather than narrowed to the one bound that IS filled.** That
  question is already ruled in this tree: `isFilterValueComplete` states that a range
  missing an end "is not a narrower range, it is a query the server refuses", and both the
  view fold and the view-override recovery pass drop such a row rather than narrow it.
  Emitting a one-sided `$gte` here would author a filter the admin never typed, into a rule
  that decides who sees what.
  
  **The widget keeps its own completeness rule**, deliberately diverging from
  `isFilterValueComplete` as its comment declares: `equals ''` is a real predicate here and
  goes on being emitted, and this drop takes no dependency on a helper marked `@internal` in
  another package. What the divergence protects is the EMITTED DOCUMENT, not the dropdown's
  notion of a finished row — which is why the new drop fits inside it rather than replacing
  it.
- 6ef48b1: A `datetime` cell now honours the authored `dueLike` key its `date` sibling already honoured (objectui#8958).
  
  `DetailViewFieldSchema.dueLike` declares itself, in the `describe` text an author reads,
  as marking "a date/datetime field as due/deadline-semantic, gating the relative
  'Overdue Nd' wording". Both types. `DateTimeCellRenderer` never read the key, so an
  author who marked a `datetime` column `dueLike` published successfully and the
  affordance silently did not appear. Measured before anything was changed — clock pinned
  to `2026-09-09T12:00:00.000Z`, `TZ=UTC`, `en-US`, value `2026-09-06T09:30:00.000Z`:
  
      date     dueLike: true  ->  "Overdue 3d"   tabular-nums text-red-600
      datetime dueLike: true  ->  "3 days ago"   tabular-nums text-sm whitespace-nowrap
      datetime  no key        ->  "3 days ago"   tabular-nums text-sm whitespace-nowrap
  
  The last two rows were byte-identical: the authored key changed nothing, and the cell
  still looked like a legitimate relative date, so the drop was invisible to a reader.
  After this change the `datetime` row reads `"Overdue 3d"` with the red styling, matching
  its `date` sibling on the same instant.
  
  Both halves of the affordance travel, because the affordance is both: the "Overdue Nd"
  wording (which also reaches the i18n translate fn, so a zh session no longer reads
  `Overdue 3d` beside a translated date cell) and the red styling, which is applied
  whichever display face the cell paints — gating it on the relative face alone would
  leave `compact`, this cell's default face, still disagreeing with its `date` sibling.
  
  Two populations change appearance, and the second is the larger one:
  
  - `datetime` fields with `dueLike: true` authored explicitly;
  - `datetime` fields whose NAME matches the due/deadline convention (`due_*`, `deadline`,
    `expires_at`, `expiry`, `expected_close`, `target_close`, `sla*`, `return_by`,
    `renewal*`, `next_action*`) with no key authored at all. That heuristic was already
    live on `date` columns; it now answers the same on `datetime` columns, which is the
    parity being restored.
  
  `DateTimeFieldMetadata` gains `dueLike?: boolean`, which `DateFieldMetadata` already
  carried. Nothing narrows and no accepted input is rejected: the key was already accepted
  by the view schema for both types, and leaving it off the datetime interface would have
  kept the declared-vs-enforced mismatch alive with the sign flipped — a key the renderer
  honours but the authoring type rejects.
  
  The affordance is day-granular on both cells, inherited from the shared relative-time
  path rather than re-decided here: the wording gates on whole calendar days, so a
  datetime a few hours past its deadline still reads "Today" and is not red, and
  "Overdue 0d" is not a string this codebase can produce. Sub-day precision is a separate
  call and was not taken.
- 58be55e: A `datetime` grid cell now honours the same authored `field.format` words a `date` cell already honoured (objectui#8853).
  
  `DateCellRenderer` and `DateTimeCellRenderer` are neighbours reading ONE authored key
  and handing it to two formatters with different vocabularies: `formatDate` honours
  `'short'` and `'relative'`, `formatDateTime`'s `options.style` honours `'compact'`
  alone. So `format: 'relative'` painted the relative face on a `date` column and the
  verbose absolute face on a `datetime` one — no error, no warning, no fallback.
  Measured end to end through a real `ObjectGrid` column before anything was changed:
  one object, one row, one instant (`2026-09-11T09:30:00.000Z`, clock pinned to
  `2026-09-09T12:00:00.000Z`, `en-US`), `format: 'relative'` authored on both fields,
  the grid's own body cells read
  
      ["1Open", "Row One", "In 2 days", "Sep 11, 2026, 09:30 AM"]
  
  with the `date` column honouring the key and the `datetime` column beside it dropping
  it. After this change the same run reads `["1Open", "Row One", "In 2 days", "In 2
  days"]`.
  
  The cell now SELECTS a formatter instead of threading one, the way objectui#8352
  already ruled for `formatMeasureDate`'s datetime arm — the same defect class one
  surface over:
  
  - `'relative'` resolves through `formatRelativeDate`, the same function the `date`
    cell reaches, so one calendar day reads the same phrase in either column.
  - `'short'` resolves to the dense face of this type, which for a `datetime` cell is
    the compact face it already paints — the time of day is kept, and it stays
    byte-identical to an unstyled cell.
  - every other string, `'compact'` and date patterns such as `'YYYY-MM-DD'` included,
    falls to the default face exactly as before.
  
  **Behaviour change, spelled out.** Two authored spellings render differently than they
  did, and one of them loses a component:
  
  - `format: 'relative'` on a `datetime` field: was the verbose absolute face
    (`Sep 11, 2026, 09:30 AM`), is now the relative phrase (`In 2 days`).
  - `format: 'short'` on a `datetime` field: was that same verbose face, is now the
    compact face (`9/11/2026 9:30 am`).
  - ⚠️ **Beyond the ±7-day window a `'relative'` datetime now shows no time of day.**
    `formatRelativeDate` falls back to an absolute DATE face out there, so
    `2026-09-20T09:30:00.000Z` renders `Sep 20` where it rendered
    `Sep 20, 2026, 09:30 AM` before. That window belongs to `formatRelativeDate` and is
    inherited rather than re-decided at the call site — re-deciding it would put a
    second copy of the convention in the renderer, which is objectui#4576. `'relative'`
    is day-granular by construction (it shows no time inside the window either), and
    any other fallback would make the two columns unequal again, which is the defect
    being closed.
  
  Note what the delta is and is not: this renderer ignored both words outright before,
  so nothing was taken from a working feature — it starts honouring a request whose
  granularity is days. It reaches only a `datetime` field whose author actually wrote
  one of those two words. An unstyled `datetime` cell, an explicit `'compact'` one, an
  authored empty string, and any other spelling all render exactly as they did.
  
  No published signature moved. `formatDateTime(value, options?)` is unchanged and
  still ignores `'relative'` and `'short'` in its `options.style` key — threading the
  authored word into it would have honoured `'compact'`, the one word the `date` cell
  does NOT honour, while still ignoring both words it does, which is the defect
  inverted rather than closed. No spelling that rendered before is refused now; adding
  a refusal would be a breaking narrowing of a published metadata surface.
  
  `dueLike` is deliberately not threaded and is filed separately as objectui#8958: it
  is a different authored key whose affordance travels with red styling and a
  field-name heuristic, and acquiring a second key's behaviour while honouring the
  first would be an unruled change.
- 9a1fb41: **API addition (public-surface widening):** `FileCell` — the compact upload
  control `@object-ui/fields` exports for line-item grid cells — gains the
  published optional `error?: string` slot, mirroring `LookupField` and
  `FileField`: the same validation slot `@objectstack/spec/ui`'s
  `FieldWidgetPropsSchema` declares and `FieldWidgetComponentProps` names
  (objectui#3222). When set, `FileCell` puts `aria-invalid` on its own focusable
  picker button; the message text stays with the host (objectui#5431).
  
  `GridField` now passes that slot for a required-but-empty `file` cell — the one
  cell type objectui#3318's per-cell `aria-invalid` delivery left out. Before
  this, a required `file` cell flagged only the visual ring and `title` on the
  `td`; no element in the cell subtree announced the state, so assistive tech was
  told nothing (a wrapper-only mark is exactly what objectui#5223 forbids). Text,
  number, select, and lookup cells were wired in PR #5429; `file` cells now
  behave identically.

### Patch Changes

- ad694ac: fix(core): the shared date path refuses a calendar day that does not exist, with the marker it already renders for an unparsable value
  
  A date-only value naming a day its month does not have — `2026-02-30`, `2024-02-31`, `2025-02-29` — used to render as a real, different day on every date face: the engine's parse accepts a day of `01`-`31` for any month and rolls the surplus forward, so `2026-02-30` showed as `Mar 2`, with nothing to say the stored value was wrong. The filter builder already refused the same value at the authoring boundary, so the repo gave one concept two answers.
  
  - **New export `isRealCalendarDate(dateOnly)` from `@object-ui/core`.** It moved from `@object-ui/components`' filter builder, which now imports it — one implementation, shared by the authoring boundary and the display path. It answers `true` only for a `YYYY-MM-DD` string whose year, month and day exist. It now also reads a year below 100 as that year (it used to answer `false` for `0026-08-01`), so the filter builder keeps such a date instead of clearing it.
  - **`toDisplayDate` returns an Invalid Date for such a value**, so `formatDate` (every face: default, `short`, `relative`), `formatRelativeDate` and `formatDateTime` render `—`, and `formatDateTimeCompactParts` returns `null` — each function's existing answer for an unparsable value. A caller that reads `toDisplayDate` directly gets the same refusal and shows its own unparsable face: the History tab and the record summary chip now show the stored string instead of a rolled date.
  - **A dataset measure agrees with the list cell on the refusal.** A date-only measure value of `2024-02-30` renders `—`, the same as the `date` cell beside it. The measure takes that answer from the shared path and makes no judgement of its own.
  - **`@object-ui/fields`:** the `date` and `datetime` cells, the readonly `DateField` and a date-returning `FormulaField` show the shared "No value" placeholder for such a day, exactly as for an unparsable value, instead of a bare dash.
  
  This change covers date-only values only. (A value that carries a time, such as `2026-02-30T10:00:00Z`, is refused by the same path too — objectui#10301, a separate entry in this release.)
- 5f00ff4: feat(types): `SliderFieldMetadata` declares `step`
  
  `@objectstack/spec`'s `FieldSchema` declares `step` ("Step increment for slider
  (default: 1)") and `SliderField` has always read it, defaulting to `1`, but the
  published `SliderFieldMetadata` did not declare it, so an author annotating a
  slider field with the type could not write the key the widget honours. The
  member is now declared, matching the spec's prose.
  
  `SliderField` now reads `min`, `max` and `step` through the keys
  `SliderFieldMetadata` declares instead of an untyped `field as any` carrier. No
  runtime behaviour changes.
- 0361d6b: fix(fields): a declared `scale` above 100 no longer crashes the number cell or a grid's computed column (#10071)
  
  `@objectstack/spec` 17.4.0 accepts a field `scale` above 100, but both
  `Intl.NumberFormat` and `Number.prototype.toFixed` refuse more than 100 fraction
  digits. `NumberCellRenderer` passed the declared `scale` straight into `Intl`,
  so the cell threw `RangeError` at render; `computeRow` rounded a computed grid
  column with `toFixed(scale)`, so editing a master-detail line threw out of the
  edit. Both now take the ruling the percent faces already took (objectui#9808):
  the width is clamped to 100 and a one-time `console.warn` names the declared
  width, the rendered width and the card. In-range, negative and non-integer
  widths are unchanged.
  
  ⚠️ **Dated note, 2026-09-29 — the clamp above was retired in this same release — objectui#11073.**
  Later in this release this repository began resolving `@objectstack/spec` 17.5.0, which refuses a field `scale` above 100 at the declaration (`too_big` at `scale`, a computed number field included). The objectui#9808 ruling this change followed retires at exactly that point, so the clamp and its one-time warning are gone from `NumberCellRenderer` and from a grid's computed column: the declared width is passed through again, and a width above 100 is no longer something an author can declare.
- 80c5412: A form no longer submits — nor offers — a field the CALLER may read but not edit.
  
  **Clause-②: no** — no exported symbol is added, removed, renamed or retyped, no key on a published payload moves, and no accept set is relaxed. `sanitizeFormData` gains an optional third argument and `fieldWriteGate` / `applyFieldPermissions` are new, but `@object-ui/plugin-form` publishes `.` only, from `index.tsx`, which re-exports neither module — measured on the built `dist/index.d.ts`, where neither name appears. `LookupField`'s props are unchanged. What moves is what the client PUTS on the wire and which controls it draws.
  
  **What it was.** The platform refuses a write to a field the caller's permission set marks `editable: false`, and it cannot tell a round-trip of the value it just served from an attempted write. A form echoing an UNCHANGED `score` back is therefore a 403 for the whole save, even when the user touched only a field they *are* allowed to edit — so the standard edit form was unusable for any role with a field-level restriction on it. The list view's inline grid succeeded on the same record for the same user, because it sends only the changed cell.
  
  The verdict that answers 「may this caller edit this field」 already existed and one path already used it: `checkField(object, field, 'write')` in `@object-ui/permissions`, reading the server's `/me/permissions` grant. What had gone wrong is that each form container spelled its own COPY of the strip and of the render pass, and the family had drifted — the same defect class as objectui#10108, one layer up. Measured on one record with one permission set: the simple form and the modal withheld `score` while the drawer sent it, and the drawer rendered it as a live input while the other two rendered it disabled. One family, three answers; the third container carried neither half.
  
  **What changed, in observable terms.**
  
  - The field-level verdict now arrives at the ONE outbound filter as a predicate (`sanitizeFormData`'s `canEdit`), instead of as a strip loop written out after each container's call. ⚠️ `DrawerForm` previously sent every displayed field regardless of the caller's field permissions; it no longer does. `ObjectForm` and `ModalForm` already withheld the refused field, and still do — their loops were correct, they were just copies.
  - The render pass is likewise one function for all three containers. ⚠️ `DrawerForm` previously drew a field the caller may read but not edit as a live input; it now draws it read-only and disabled, exactly as the other two already did. A field the caller may not READ is dropped, also as before.
  - Both halves stay fail-open with no `PermissionProvider` / `MePermissionsProvider` mounted, unchanged: a standalone form, a designer preview and a guest surface have no resolvable principal, and the server still enforces.
  - A lookup's selected chip no longer offers its remove ✕ when the field is disabled. ⚠️ This is how BOTH refusals reach the widget — a field the object declares `readonly` is folded into `disabled` by the form's section builder, and a field the permission set refuses is marked disabled by the pass above — so a reporter could previously clear a master-detail parent the server would then refuse to unset. The trigger and the browse button were already disabled; the chip's ✕ was the one control the gate had missed. The chips themselves stay: the value is readable, only the affordance goes.
  
  **Deliberately not here.** Submitting only DIRTY fields is objectui#10156, filed with its own risk argument (a false CLEAN silently drops a user's edit and returns 200). Naming the refused field in the 403 instead of the generic console message is owned by the producing side.
- 212c451: `TextField` renders the declared `maxLength` as the `maxlength` attribute of its input, or of its textarea when the field has `rows` above 1 (objectui#10179).
  
  `FieldSchema` in `@objectstack/spec` declares `maxLength`, and `TextAreaField` already honoured it, but the single-line text widget never read it. Its DOM props pass through `toDomProps`, which forwards no `maxLength`, so no host could supply the limit either. Any host that renders the widget directly accepted input past the declared limit: the console's `/f/:slug` and `/forms/:name` form routes, `ActionParamDialog`, and `BulkActionDialog`. The record form was not affected, because it enforces the limit as a validation rule. A field that declares no `maxLength` renders no attribute, as before.
- a04b06d: A wizard no longer writes a record without a file whose upload was still running when the user
  pressed Next (objectui#10180).
  
  To reproduce: pick a file on a wizard step, press Next before the upload finishes, then press
  Create on the last step before the upload settles. The record was written WITHOUT the attachment
  and the wizard reported success.
  
  The upload itself was never cancelled. `FileField` and `ImageField` do not abort an upload
  when their step unmounts, and when it finishes the value still reaches the form. What went
  missing was the upload's REPORT. A widget publishes "an upload is in flight" as its own
  React state, so leaving the step unmounted the widget and ended the report while the
  upload kept running. The final-commit gate objectui#10166 put on the wizard then read
  "nothing uploading": Create was enabled and labelled "Create", and pressing it in that
  window wrote the record before the file arrived.
  
  `FileField` and `ImageField` in `@object-ui/fields` now also hold the enclosing uploading
  scope for the upload's own lifetime; `FileCell`, the line-item grid cell, does not. The hold
  is taken when the upload starts and released once the upload settles, whether or not the
  widget is still mounted: after the value has been handed to the form when it succeeds, and
  on a failure too. While a file from an earlier step is still uploading, the wizard gives the
  same answer objectui#10166's gate gives for any other in-flight upload. Create reads
  "Uploading…" and is disabled, the wizard shows the reason it already gives, and a submit
  that reaches it anyway is refused, not queued. A Create pressed once the upload settles
  writes the record with the file. `Next` is not gated, and no new element or message is
  introduced: the label and the reason are the ones objectui#10166 added.
  
  No exported symbol, prop or type changes. `useUploadingScope().anyUploading` now stays
  true until an upload that `FileField` or `ImageField` started inside the scope has settled,
  instead of going false when that widget unmounts. A widget that publishes only through the
  exported `useUploadingSignal` still releases its report when it unmounts, as before, so an
  upload such a widget leaves running after it unmounts is not visible to the scope. A hold
  can last only as long as its upload is unsettled, which is the same limit a mounted widget's
  report already has.
- 4ab4f1b: A date-only value now renders the calendar day it names, west of UTC, at four more places (objectui#10183).
  
  **Clause-②: yes** — `@object-ui/core` gains one export, `toDisplayDate(value)`: the parse step every date formatter in `utils/date-display.ts` already went through, now reachable by a caller that formats with its own `Intl` options or compares a value with today. Nothing else is added, removed, renamed or retyped, and `@object-ui/fields` does not re-export it.
  
  **What it was.** objectui#10110 repaired the shared date path: a date-only value such as `2026-08-01` is UTC midnight to the JavaScript engine, so reading it back in the viewer's zone lost a day west of UTC. The repair rebuilt such a value at local midnight inside the shared formatters, but four places never reached it. `data-table`'s default cell face parsed the string into a `Date` first, and the shared step leaves a `Date` alone. The record summary chip, the record History tab and the `date` cell's overdue colouring each parsed the value themselves. Measured in `America/Los_Angeles`: `2026-08-01` rendered `Jul 31` in a table cell, `2026年7月31日` on a zh-CN summary chip and `7/31/2026` in History, and a deadline falling today read `Today` in red.
  
  **What changed, in observable terms.**
  
  - A `data-table` cell with no cell renderer hands the string to `formatDate` / `formatDateTime`. This also covers a related list whose child object schema is unavailable, since its cells fall back to that face.
  - The summary chip and the History tab take their `Date` from `toDisplayDate`. Their faces are unchanged: the chip keeps `dateStyle: 'medium'`, History keeps the locale's default numeric date.
  - The `date` cell's overdue colouring compares the day `toDisplayDate` names, so a deadline falling today is no longer red west of UTC. The cell's text was already right, and its hover title is unchanged.
  - ⚠️ The summary chip's and History's `datetime` arms share that parse, so they follow the shared path's rule: the value's shape decides, never the field's type. An instant still converts into the viewer's zone. A date-only value stored on a `datetime` field now reads as local midnight of its day, as `formatDateTime` already rendered it; before, it read as the previous evening west of UTC and as a morning hour east of it.
  
  In UTC every face is byte-identical to before. East of UTC every date face and the overdue colouring are too; only that `datetime`-arm reading of a date-only value moves there.
- 65f1e8d: fix(fields): a lookup's candidate queries expand the reference columns they display
  
  Opening a lookup field's dropdown sent the candidate query without `$expand`.
  Every reference column the dropdown previews under each candidate (by default
  the referenced object's leading `highlightFields`) therefore arrived as a bare
  foreign key, and the lookup cell renderer fetched each related record on its
  own: one extra request per candidate per such column, on every open. The
  browse-all picker (`RecordPickerDialog`) did the same once per table row.
  
  Both queries now ask for `$expand` on the reference columns they display,
  chosen by `buildExpandFields` from `@object-ui/core` (the rule the list views
  apply to their visible columns): the dropdown's previewed columns, and the
  picker's columns other than its id column. The dropdown's recently-used rail
  asks for the same expansion. Related records in the expanded columns now
  render with no request per row.
  
  Field-level security gates that list the way it gates the other
  `buildExpandFields` call sites: once the permission policy has loaded, a
  reference column the user may not read on the referenced object is left out of
  `$expand`; before the policy loads, nothing is filtered. `@object-ui/fields`
  now depends on `@object-ui/permissions` for that check. A reference column
  from a backend that ignores the parameter still arrives as a bare id and is
  resolved one by one as before. A column the policy denies is not drawn at all,
  and a field it denies is not shown in an option's label or in the picker's
  title column (objectui#10373).
  
  `buildExpandFields` covers `user` columns as well as `lookup`,
  `master_detail` and `tree`. A previewed `user` column therefore now shows the
  person, as the picker table and the list views do, where it used to show the
  raw id marked as unresolved.
  
  What the dropdown and the picker hand onward is built from each row with its
  expanded relations collapsed back to ids, through `toPredicateRecord` from
  `@object-ui/core`. That covers option labels, `titleFormat` titles, the
  committed value, and the records passed to `onSelectRecord` and
  `onSelectRecords`, so none of them carries an expanded object. One difference
  remains: `toPredicateRecord` returns ids as strings, so a numeric foreign key
  in an expanded column reaches those callbacks in its string form.
- 1f8ef0a: fix(fields): a failed image upload is reported in `ImageField`, not swallowed
  
  Both upload paths of `ImageField` — the native picker and the crop dialog's
  confirm — ran the upload inside `try … finally` with no `catch`. Both are
  invoked fire-and-forget (React ignores the promise an `onChange` handler returns,
  and the cropper does not await `onConfirm`), so a rejected upload (a network
  error, a 413, a storage outage) showed the user nothing and escaped as an
  unhandled promise rejection.
  
  A failed upload now renders the same translated `fields.file.uploadFailed`
  message `FileField` shows for the same failure, in the widget's existing error
  row. The failed image is not added: on the picker path the other picks of a
  multi-select still upload and land, as in `FileField`; on the crop path the
  original image stays and the dialog closes so the message is visible.
- 544aca2: fix(core,fields): a date-time written on a calendar day that does not exist is refused, not rolled into another day
  
  `2026-02-30T10:00:00Z` names a day February does not have. The engine parses it anyway and rolls the surplus forward, so it rendered as `Mar 2, 2026, 10:00 AM`: a real day nobody wrote, with nothing to say the stored value was wrong. objectui#10026 made the shared date path refuse such a day on a date-only value; this extends the same refusal to a value that carries a time.
  
  - **`toDisplayDate` returns an Invalid Date for an ISO date-time whose leading `YYYY-MM-DD` is not a real calendar day** (the `isRealCalendarDate` judgement). The day is read from the stored string as written, so a real day written with an offset — `2026-02-28T23:30:00-05:00`, which is March 1st in UTC — is not refused, and a real date-time renders exactly as before. `formatDateTime`, `formatDate` and `formatRelativeDate` render `—` for such a value, `formatDateTimeCompactParts` returns `null`, and a dataset measure over it renders the same `—`: each function's existing answer for an unparsable value.
  - **`@object-ui/fields`:** the `datetime` and `date` cells, the readonly `date` widget and a date-returning `FormulaField` show the shared "No value" placeholder for such a value, and the readonly `datetime` widget shows `—`, exactly as each does for an unparsable value.
  - **The sub-grid (`GridField` / `LineItemsField`) `date` and `datetime` columns read the shared parse step instead of building their own `Date`.** A value that step refuses shows the stored string, this surface's existing face for a value it cannot parse: an impossible day in either column (`2026-02-30`, which the `date` column still rolled into March after objectui#10026), and an out-of-range month (`2026-13-45`, which the `date` column rendered as `Feb 14, 2027`). A `date` value with a year below 100 (`0026-08-01`) now renders that year, as the `date` cell does, instead of 1926.
- 8c929e6: fix(fields): a lookup option's label ranks the field's `displayField`, then the referenced object's `nameField`, then `titleFormat` — the ADR-0079 order the record page follows
  
  ⚠️ Behaviour change: which text a lookup dropdown option (and the chip it
  leaves behind) shows. The inherited lookup branch of ruling C1 on
  objectui#9436, tracked as objectui#10343.
  
  - **Before.** `LookupField`'s option label rendered the referenced object's
    deprecated `titleFormat` first, above the object's declared `nameField` and
    above the lookup field's own `displayField`. The same record read one way on
    its record page and in its lookup cell, and another way in the dropdown
    that picks it.
  - **After.** The label is `@object-ui/core`'s `getRecordDisplayName` with the
    field's declared `displayField` as its `titleField`, the same call the lookup
    cell renderer already makes: the field's declared `displayField`, then the
    object's `nameField` (and its deprecated aliases), then `titleFormat`, then
    type-aware derivation. A `nameField` blank on the record still falls through
    to the template, and an object that declares only a `titleFormat` still
    renders it.
  - **The widget's `name` default no longer outranks the object.** A lookup field
    that declares no `displayField` still reads `name` for quick-create and the
    picker's display column, but in the option label that guess now sits below
    the object's declarations, as `@objectstack/spec` describes the default
    ("the referenced object's name/title"). Without the object's schema the
    label reads `name` first, as before.
  - **Templates render through the shared renderer.** The widget's private copy
    of the template renderer is gone. A `{{field}}` placeholder now renders as
    its `{field}` twin, as the `titleFormat` describe says every title renderer
    does, where the option used to show the value inside a stray pair of braces.
  
  **Upgrade effect.** An option label moves when the referenced object declares
  a `nameField` and a `titleFormat` that renders something else, or when a
  lookup field without a `displayField` points at an object whose `nameField`
  is not `name` and whose records also carry a `name` value. objectui#10486
  moved the browse-all record picker's display column onto the same resolver,
  so on such an object the picker and the dropdown read the same label.
- 9d25b9b: fix(fields): the lookup dropdown and record picker stop showing fields field-level security denies, and PeoplePicker's `$expand` is gated
  
  A lookup field's dropdown and its browse-all picker (`RecordPickerDialog`)
  filtered their `$expand` through field-level security, but not what they
  draw. Once the permission policy had loaded, a column the user may not read
  on the referenced object was still previewed under each dropdown candidate,
  and still headed and rendered in every picker row. A denied relation column,
  left out of `$expand`, arrived as a bare id, and the lookup cell renderer then
  fetched each related record on its own. A denied display field still labelled
  every option, and a `titleFormat` template still printed every field it
  named.
  
  Both now treat those fields the way `RelatedList` treats its columns: once the
  policy has loaded, a column the user may not read on the referenced object is
  not previewed in the dropdown, and is neither headed nor rendered in the
  picker. The picker's display column is gated like any other column. Its id
  column never is, and when the policy leaves no other column to draw, the
  picker draws the id column so that every row can still be told apart and
  chosen. A `renderGrid` slot on the picker receives the same columns. Before
  the policy loads, nothing is filtered, and the columns are re-derived when it
  arrives.
  
  An option's label is built from the row with the denied fields removed,
  the same row ObjectStack's `FieldMasker` already serves, so on that backend
  labels do not change. A denied display field therefore falls through to the
  next source of a label, ending at the record id, and a `titleFormat` template,
  in the dropdown's labels and in the picker's display column, leaves a denied
  field's slot empty. The label is a display value only: the committed value is
  unchanged, the records the picker hands to `onSelectRecords` are unchanged,
  and the option the dropdown hands to `onSelectRecord` still carries the served
  row's other fields beside its label.
  
  `PeoplePicker`, which a lookup opens when its field sets `picker: 'search'`,
  derives its `$expand` from dotted `subtitle` paths such as
  `primary_business_unit_id.name` when no `expand` is passed, and that list had
  no permission check. Once the policy has loaded, a relation the user may not
  read on the object the picker queries is now left out of `$expand`, whether
  the list was derived from the subtitle paths or passed as `expand`. A subtitle
  segment that goes through a relation left out shows nothing, as it does when a
  backend ignores `$expand`.
  
  This is defence in depth: ObjectStack's `FieldMasker` already removes the
  fields a user may not read from the rows it returns. The change matters for a
  backend that does not.
- 111fa4c: fix(fields): PeoplePicker rows and its selection tray, and a people lookup's chip, stop drawing fields field-level security denies
  
  A lookup field that sets `picker: 'search'` (every user field does by default)
  opens `PeoplePicker`, whose rows show an avatar and a subtitle line built from
  the field's `subtitle` paths, such as `primary_business_unit_id.name` and
  `email`. Only the `$expand` those paths imply was filtered through field-level
  security. Once the permission policy had loaded, a row still drew every
  subtitle field and the avatar straight from the record the server returned, so
  a field the user may not read on the queried object, such as `email`, still
  showed. The multi-select tray drew the same avatar, and the field's selected
  chips drew theirs from the configured avatar field, then from `image`.
  
  Now, once the policy has loaded, a row leaves out each subtitle path whose
  field on the queried object the user may not read, and draws no avatar image
  when the avatar field is denied: the initials show instead, and the row can
  still be chosen. A path through a relation is judged by the relation field, so
  it is left out even when a backend returns the related record without being
  asked. The tray follows the same rule. A chip judges both keys it reads: the
  configured avatar field, and `image`, which it falls back to. A readable
  `image` still stands in for a denied avatar field. Before the policy loads,
  nothing is withheld. The records the picker hands to `onSelectRecords` are
  unchanged.
  
  This is defence in depth: ObjectStack's `FieldMasker` already removes the
  fields a user may not read from the rows it returns. The change matters for a
  backend that does not.
- 39bf246: The retired-field tombstone now names the spelling it was resolved under, not
  the live `type` of the field it is handed (objectui#10471).
  
  A retired spelling can reach the tombstone through an authored `widget`, which
  wins over `type` in both form hosts. A field such as
  `{ type: 'user', widget: 'owner' }` was therefore answered by the `owner`
  tombstone, but the tombstone re-derived its spelling from the field and said
  "Field type `user` was retired": it named a LIVE type as retired, dropped the
  migration prescription for `owner`, and logged nothing to the console.
  
  `getLazyFieldWidget` and the `field:` registrations made by
  `registerAllFields()` now hand out a tombstone bound to the retired key they
  resolved, one component per spelling. `RetiredFieldTombstone` reads a new
  optional `retiredFieldType` prop first and falls back to the field's `type` only
  when it is absent, so a host that renders it directly with a field whose `type`
  is the retired spelling behaves as before.
  
  The retired-type table itself is unchanged. The registry entry under
  `field:owner` is now the bound tombstone rather than `RetiredFieldTombstone`
  itself, so code that compared the registry entry by identity against
  `RetiredFieldTombstone` should compare what it renders instead.
- 8740e86: fix(fields): the editable date-time faces no longer roll a stored impossible day into a real one
  
  `toDateTimeInputValue` let a `Z`, offset or date-only spelling fall through to
  `new Date(...)`, which accepts a day of 01-31 for every month and rolls the
  surplus forward: a stored `2026-02-30T10:00:00Z` reached the `datetime-local`
  control as `2026-03-02T10:00`, and an edit could save that day back. The read
  faces already refuse such a value (objectui#10026, objectui#10301).
  
  The adapter now asks the same judgement (`isRealCalendarDate`) of the day AS
  WRITTEN, before any conversion, in every spelling, and `fromDateTimeInputValue`
  never re-emits a nonexistent day as a rolled one. A `datetime-local` control can
  paint a nonexistent day only blank (measured in Chromium), so the editable
  `DateTimeField` and the sub-grid's editable `datetime` cell leave the control
  empty, mark it `aria-invalid`, and name the stored string beside it with the new
  `fields.dateTime.impossibleDay` sentence (all ten packs). Nothing is written until
  the user picks a new value; a real date-time and a zone-less value behave as before.
- fde4caf: fix(fields): a lookup value hydrated from a bare id is labelled from the referenced object's schema once it arrives (objectui#10487)
  
  A lookup that mounts already holding a value (an edit form opening an existing
  record) fetches the referenced record to label its chip. It also asks for the
  referenced object's schema, and nothing orders the two. When the record came
  back first, the chip was labelled without the schema, on the `name` guess, and
  it kept that label. The hydration cached a built option with its label frozen,
  and the schema's arrival never rebuilt it. The dropdown, the read cell and the
  record page read the object's declared `nameField` for the same record. So the
  chip read `Acme` while its own dropdown option read `HT-001`, until the user
  picked the record again, and a reload brought `Acme` back.
  
  The hydration now keeps the fetched rows and builds no label. The chip's option
  is derived from those rows on every render through the same `recordToOption`
  call, with the same inputs, that the dropdown uses. So its label follows the
  schema when it arrives. It also follows the permission policy in force: a field
  the policy denies after the chip was labelled (a policy that loads late) leaves
  the chip's label as it leaves the dropdown's. The record is still fetched once,
  and no remount is involved. When
  the schema arrived while the record fetch was still in flight, the fetch used to
  be cancelled and issued a second time; it is issued once now.
- caf0ed0: fix(fields): an image, avatar or signature cell holding a `data:` URI no longer names its image with the base64 payload (objectui#10493)
  
  `readFileValue` took the text after a URL's last `/` as the file's display name. A `data:` URI
  has no path, so a `data:image/png;base64,…` value was named `png;base64,…` (or a fragment of the
  payload, when the base64 holds a `/`). The image cell uses a value's name as its `<img>` alt, and
  `SignatureField` stores `canvas.toDataURL('image/png')`, so every populated signature cell had
  kilobytes of base64 as its alt, which a screen reader reads aloud.
  
  A `data:` URI now carries no display name, so `readFileValue` answers the caller's fallback name
  for it, as a string value and as the `url` of an object value. The image cell (registered for
  `image`, `avatar` and `signature`) now reads its images with no fallback name, so a value that
  carries no name of its own gets the translated `fields.image.imageAlt` alt ("Image 1", numbered by
  position) and the lightbox it opens gets the translated alt and title. Before this, such a value
  was named with the untranslated literal `Image` on every locale. That applied to a bare `sys_file`
  id too, which now also gets the translated alt.
  
  What an author or reader sees change: the alt of a data-URI or bare-id thumbnail in a read-mode
  cell, and the file cell's link text for a data-URI value, which is now the translated file
  fallback. Stored values do not change: the `data:` URI is still the `<img>` `src` byte for byte.
  A value that carries a name keeps it, whether from `name` / `original_name` or from an `https` or
  `blob:` URL's last segment.
- a7df45f: fix(fields): the lookup cell names the referenced record from the fields the viewer may read (objectui#10501)
  
  `LookupCellRenderer` names the record a lookup points at through the referenced
  object's schema: the column's `displayField`, then the object's `nameField`,
  then its `titleFormat`, then the type-aware derivation. It did that on the row
  as served. On a backend that does not strip the fields a permission policy
  denies (ObjectStack's `FieldMasker` does strip them), a `titleFormat` or
  `nameField` naming a denied field printed that field's value in every list,
  grid and detail cell that shows the lookup. The lookup editor's option label
  already applied the rule (objectui#10411), as does the record title
  (objectui#10434).
  
  The cell now resolves the name from the row with the fields the loaded policy
  denies on the REFERENCED object removed; `id` and `_id` are kept. The name
  falls through to the next source exactly as it does for the row a stripping
  backend serves. Every shape the cell names a record from is covered: an
  expanded record, a JSON-encoded reference, each chip of a multi-value cell and
  the overflow chip's tooltip, and a bare id resolved on demand. With no policy
  loaded, or no `PermissionProvider` mounted, the row is named as served, as
  before.
  
  A bare id resolved on demand used to cache the resolved NAME. It now caches the
  fetched record and schema, and the name is resolved on every render, the same
  shape objectui#10487 gave the lookup editor's hydrated chip. So a policy that
  loads or changes after the record arrived relabels the mounted cell, with no
  second read of the record.
- 6516320: fix(fields): PeoplePicker rows, its selection tray and the read-only user cell stop drawing a person's name or avatar that field-level security denies
  
  `PeoplePicker` (the search-first picker every user field opens by default)
  read each person's name straight from the record the server returned: the
  field's display field, then `name`, `username` and `label`. Once the
  permission policy had loaded, a name the user may not read on the queried
  object still showed in the candidate row, in the multi-select tray chip, in
  the avatar's alt text and in the chip's remove label. The read-only `user`
  cell drew the name (`name`, then `username`) and the avatar (`image`) of an
  expanded person the same way, in both its single and its multi-value form.
  
  Now, once the policy has loaded, a name field the user may not read is
  skipped and the next readable one shows instead, the same fallback the lookup
  field's option label already uses. When none is readable, the row and the
  tray show their usual placeholder, and the cell shows `User`. The cell draws
  no avatar image when `image` is denied: the initials show instead. The cell
  judges the fields on the object the field's `reference_to` (or `reference`)
  names, and on `sys_user` when it names none. A policy that loads or changes
  later relabels what is already on screen. Before the policy loads, nothing is
  withheld. The records the picker hands to `onSelect` and `onSelectRecords`
  are unchanged.
  
  This is defence in depth: ObjectStack's `FieldMasker` already removes the
  fields a user may not read from the rows it returns, and on those rows nothing
  changes. The change matters for a backend that does not.
  
  ⚠️ **Dated note, 2026-09-30 — the cell reads the person's object from `reference` alone — objectui#11070.** "the object the field's `reference_to` (or `reference`) names" above held when this change landed. Later in this same release objectui#11070 (round 4) narrowed `UserCellRenderer` to `reference`, with `sys_user` when it names none. The read gate is unaffected. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
- 98b1a7c: fix(fields): a lookup value picked before the referenced object's schema loads is labelled from that schema once it arrives (objectui#10559)
  
  A pick used to cache the option it was handed, with its label built at pick
  time. A lookup asks for the referenced object's schema when it mounts, so a
  record picked before that schema arrived was labelled on the `name` guess, and
  the chip kept that label. The dropdown option for the same record read the
  object's declared `nameField` once the schema arrived. So the chip read `Acme`
  while its own dropdown option read `HT-001`. This held for a pick from the
  dropdown, from the browse-all dialog and from quick-create.
  
  A pick now keeps the record's row instead of the option. The chip's option is
  derived from that row on every render, through the same derivation the hydrated
  value uses since objectui#10487, so its label follows the schema when it
  arrives. The row a dropdown pick keeps is the candidate as served, with
  relations collapsed to ids, as the dropdown builds its options. The browse-all
  dialog and the search-first people picker keep the rows they hand back, and
  quick-create keeps the created record. No record is fetched again to relabel
  it, and no remount is involved. An authored static option keeps no row: its
  chip resolves from the authored `options` list, which is consulted first.
- ac2d6f1: fix(fields): the editable date-only faces no longer blank a stored impossible day silently
  
  `toDateInputValue` keeps a stored `2026-02-30` as written and never rolls it,
  but an `<input type="date">` sanitises a day that does not exist to an empty
  value (measured in Chromium). So `DateField` and the sub-grid's editable `date`
  cell showed an empty control with no marker for a value that was stored. That
  is a silent blank, which the direction of objectui#10026 rules out, and it is
  the date-only half of objectui#10474.
  
  Both faces now judge the day as written with `isImpossibleStoredDay` (the check
  objectui#10474 added). For such a day they hand the control an empty value,
  mark it `aria-invalid`, and name the stored string beside it with the new
  date-only sentence `fields.date.impossibleDay`, in all ten packs. The control's
  `aria-describedby` points at that sentence. Nothing is written until the user
  picks a new day, and picking a real day clears the marker. Real days and empty
  values render as before.
- 9a5f998: `@object-ui/core` exports `withoutDeniedFields(record, policy, objectName, extraKeep?)`, the field-read rule for one record: the record as the viewer may read it on `objectName` (objectui#10594).
  
  Every field the loaded `policy` denies is removed, which leaves the row ObjectStack's `FieldMasker` already serves. `id`, `_id` and any key in `extraKeep` (a declared id field) are never judged. Before a policy loads, with no policy, with no object name, or for a value that is not an object, the record comes back as it is; when nothing is withheld the SAME object comes back. `policy` is structural (`isLoaded` and `checkField`), so `usePermissions()` from `@object-ui/permissions` satisfies it and `@object-ui/core` gains no dependency.
  
  The renderer's display surfaces that each carried a module-private copy of this rule now call the export, with no change in what they draw:
  
  - `@object-ui/fields`: the lookup cell's name and the user cell's name and avatar (the package entry), and the lookup editor's option label and search chip avatar (`LookupField`).
  - `@object-ui/react`: `useRecordSearch`'s hit label under `fieldReadPolicy`.
  - `@object-ui/app-shell`: the record page's title and the row its blocks read (`RecordDetailView`).
  - `@object-ui/plugin-detail`: `DetailView`'s header title and `record:details`' title dedupe. The package-internal `withoutDeniedFields` module is removed; it was never a package export.
- 1c5ee33: `RecordPickerDialog` builds its display column's title from the row that `withoutDeniedFields` from `@object-ui/core` returns, and its module-private copy of that field-read rule is deleted (objectui#10594). It was the last hand-written copy of the rule; the export is now its only definition.
  
  For a named object nothing the picker draws changes: a field the loaded policy denies is still removed before the title is built, and `id`, `_id` and the declared `idField` are still kept. The one change is an empty `objectName`: the copy judged every field but `id`, `_id` and the declared `idField` against `''`, while the export passes the row through, as the other surfaces do. The picker reads no records without an object name, so the change can show only in the single render after a host empties the object name of an open picker, before the rows of the previous object are cleared, and only in the display column.
- a9c5ea0: fix(fields): a file URL whose last segment holds a bare `%` renders, named by its raw segment (objectui#10614)
  
  `readFileValue` names a file value that carries no name of its own after the last
  segment of its URL, decoded with `decodeURIComponent`. A segment that is not a
  valid percent-encoding (`https://cdn.example.com/100%.png`, or
  `{ url: 'https://cdn.example.com/a%zz.pdf' }`) made that decode throw
  `URIError: URI malformed`, and the throw left `readFileValue` during render.
  `FileValueSchema.url` is a plain string, so such a value passes the contract.
  
  What a user saw: every face that reads the value (the `file`, `image` and
  `signature` cells, `FileField`, `FileCell`, `ImageField`, and a gallery's cover)
  threw while rendering. Under `SchemaRenderer` the nearest error boundary caught it,
  so one such value replaced a whole grid table, valid rows included, or a whole
  gallery with the "failed to render" panel.
  
  The decode is now guarded once, in the one helper that performs it: on `URIError`
  the name is the raw segment (`100%.png`, `a%zz.pdf`). A valid escape decodes as
  before (`report%20q3.pdf` is named `report q3.pdf`), and a value that carries its
  own `name` or `original_name` is unaffected.
- 4758b33: The native date/time control adapters (`toDateInputValue`, `toDateTimeInputValue`, `fromDateTimeInputValue`) now live in `@object-ui/core`, and `@object-ui/fields` re-exports them unchanged (objectui#10625). Imports from `@object-ui/fields` keep working and name the same functions, and the date widgets behave as before.
- 3cd6c5e: fix(fields): the image field widget names an image that carries no name of its own with the translated `fields.image.imageAlt`, not the literal `Image` (objectui#10637)
  
  `ImageField` read its images with the untranslated literal `'Image'` as the fallback name, so a
  value with no name of its own (a bare `sys_file` id, or a `data:` URI) was named `Image` on every
  locale. Its `<img>` alt, the read-mode enlarge button's accessible name and the lightbox it opens
  all read that word, and the translated `fields.image.imageAlt` fallback never ran.
  
  `ImageField` now reads its images with no fallback name, as the image cell has since
  objectui#10493. A nameless image gets the translated alt ("Image 1" in `en`, numbered by
  position) in read mode and edit mode, the enlarge button's name embeds that alt, and the lightbox
  gets the translated alt and the translated preview title. A value that carries a name keeps it.
  The cropper's output file name for a nameless image is now the widget's own fallback
  (`image-0.png` for the first image), where it was `Image`. Stored values do not change.
- 5bb855d: fix(fields): a readonly `password` field with no value now says "No value" (objectui#10639)
  
  The readonly branch of the `PasswordField` widget never read its value. It drew
  the eight-dot mask for every input, `null` included, so on a readonly form or
  detail surface a credential that was never set looked exactly like one that is
  set.
  
  An empty value now renders the shared `EmptyValue` affordance, whose accessible
  name is "No value". "Empty" is the rule the `password` cell has used since
  objectui#8678: `null`, `undefined`, `''` and `[]` are empty. `{}` and a
  whitespace-only string are stored values and keep the mask.
  
  A stored value renders exactly what it rendered before: the same mask, in the
  same element. The value is still never printed. The editable widget is
  unchanged.
- bf14b64: fix(fields): `useRecordQuery` commits nothing once it can no longer query, and a pending debounced search never runs an older query (objectui#10712)
  
  `useRecordQuery`, the query kernel behind `LookupField`, the people picker and
  `RecordPickerDialog`, cleared its records when `enabled` went false (a dialog
  closing), but a read still in flight at that moment was the latest run: its
  answer committed over the cleared state, and the loading state stayed on until
  it landed. `reset()` had the same gap. When `objectName` or `dataSource` went
  null nothing was cleared at all, so the previous object's records stayed and a
  read in flight committed.
  
  Now the reset applies whenever the hook can no longer query (`enabled` false,
  or no data source or object name) and on `reset()`: it supersedes any read in
  flight, so that read's answer commits nothing, ends the loading state, drops a
  pending debounced search and clears the query state.
  
  The debounced `setSearch` timer also ran the query it was armed with. A filter,
  object, data-source or page-size change inside the debounce window already
  re-ran the query with the typed term; the timer then ran the older query too,
  and as the latest call its answer won, so the results shown were for the
  previous filter. Now a pending debounced search is dropped when the query
  changes. No prop, export or option changes.
- 4345558: fix(fields): `useRecordQuery` shows the answer to its latest query when an earlier answer lands late (objectui#10712, objectui#10713)
  
  `useRecordQuery`, the query kernel behind `LookupField`, the people picker and
  `RecordPickerDialog`, runs a query when the page, sort or filter changes, when
  the debounced search fires, and on `refetch`. A later query can start while an
  earlier one is still in flight. Every answer was committed, and every query
  ended the loading state when it settled. So an earlier query's answer that
  landed last replaced the current results (a user who typed or filtered faster
  than the server answered saw the results for an earlier term), and one that
  landed first ended the loading state while the current query was still
  pending.
  
  Now only the latest query commits its records, total or error, and only it ends
  the loading state. No prop, export or option changes.
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
- 97672ba: fix(fields): "Is empty" / "Is not empty" in the filter-condition widget store a criteria the objectstack filter faces accept
  
  `FilterConditionField` (the `filter-condition` widget behind `relatedListFilter`, a
  roll-up's `summaryOperations.filter` and `sys_sharing_rule.criteria_json`) stored
  "Is empty" as `{ FIELD: { $in: [null, ''] } }` and "Is not empty" as
  `{ FIELD: { $nin: [null, ''] } }`. A `null` list member is refused by
  `@objectstack/spec`'s comparand-shape face (`assertListComparandShapes`,
  `INVALID_FILTER` / 400) in every position, so a related list, roll-up or sharing
  rule authored with either operator failed whenever it was evaluated.
  
  They now store the spelling that refusal prescribes, with the same meaning — no
  value OR the empty string, and its complement:
  
  - "Is empty": `{ $or: [{ FIELD: { $in: [''] } }, { FIELD: { $null: true } }] }`
  - "Is not empty": `{ FIELD: { $nin: [''], $null: false } }`
  
  Criteria saved in the old shape still open in the builder as the same row, and
  opening one rewrites nothing; the builder writes the new shape the next time any
  row of that criteria is edited.
  
  **Correction, 2026-10-03 (objectui#10813).** The two shapes above are not what this release
  writes. Later in the same release the pair moved to the spec's one 「is empty」 operator:
  "Is empty" stores `{ FIELD: { $empty: true } }` and "Is not empty" `{ FIELD: { $empty: false } }`,
  whose meaning is the field's declared row of the spec's per-type table rather than "no value OR
  the empty string" on every type. Criteria saved in either earlier shape still open as the same
  row and are written as `$empty` on their next edit (`.changeset/10813-filter-condition-empty-operator.md`).
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
- 0a3e540: The grid field's `sort_field` is declared, and a master-detail detail's sort field is derived only (objectui#11070, round 9).
  
  `GridField` stamps each row with its index in the field `sort_field` names, on every change, so the order a drag-reorder leaves is saved with the rows. It read that key while no face declared it. Its one producer is `MasterDetailForm`, which hands the grid the sort field `deriveDetail` picks from the child object: the first of its fields named `position`, `sort_order`, `sequence`, `line_no`, `line_number` or `sort`. A detail could also override that pick with an authored `sortField`, which nothing wrote in either repository and no spec key carries.
  
  - **`sort_field` is declared (`@object-ui/types`).** `GridFieldMetadata` declares `sort_field?: string`, documented as the CHILD field stamped with each row's index. `GridField` now reads its config as `GridFieldMetadata` alone, so every key it reads is declared there (`@object-ui/fields`; no runtime change).
  - **The authored override is retired (`@object-ui/plugin-form`).** `MasterDetailDetailConfig` no longer has a `sortField` member, and `MasterDetailForm` no longer reads one. The sort field the grid receives is the derived one, carried on the form's internal per-detail state.
  
  **Clause-②: yes (narrowing).** The published `GridFieldMetadata` face widens by one optional member. The published `MasterDetailDetailConfig` face narrows by one member, and what `MasterDetailForm` honours narrows with it.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  - **TypeScript.** A `MasterDetailDetailConfig` literal that writes `sortField` is a compile error. Fix: delete it. The sort field comes from the child object; name the child's position field `position` (or another of the names above) so the derivation finds it.
  - **Rendering.** A detail written with `sortField` (through a cast, or in a document the compiler never saw) renders as if the key were absent. On a detail the form derives, the grid stamps the child's sort-named field; on a fully configured detail (relationship field set and every column typed), which loads no child schema, the grid stamps none.
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
- 385ebc5: fix(plugin-form,fields,i18n): the record page's line-items panel and the line-items grid speak the user's language
  
  Under a Chinese session the record page's `record:line_items` panel still
  rendered some of its chrome in English. Its default title read `Line Items` and
  its button read `Save` / `Saving…`. The line-items grid (`GridField`) read
  `Add line` on its Add button, `No items yet — click “Add” to begin.` in list
  mode, and `No items` when read-only.
  
  They now read the locale packs. The button reuses `common.save` and
  `detail.saving`, and the empty text names `detail.add`. Four new keys are added
  to all ten packs: `form.lineItems.title`, `fields.grid.addLine`,
  `fields.grid.noItems` and `fields.grid.noItemsAddHint`.
  
  Only the defaults move. An authored `title` or `add_label` still wins, and an
  authored `add_label` is also the label the empty text names. English output is
  byte-identical to the literals these replace, with or without an i18n provider.
- 3a0e7ab: fix(fields): a multi-value select shows its placeholder while nothing is selected
  
  `MultiSelectField` read no `placeholder`. A `select` field declared `multiple: true`, or a `multiselect` field, silently dropped the key that the single-value select honours. The catalog's `fields-select/multi-select` example authors `"placeholder": "Select tags..."`, and it showed nothing.
  
  The editable chip row now shows the author's `placeholder` as muted text while the value is empty, and hides it after the first pick. The key is read from the field metadata, the same place the single-value select reads it. An empty string counts as none. A field with no `placeholder` renders the same markup as before, with no default text, because every option is already on screen as a chip. The host label still names the group, and the placeholder never becomes its accessible name. A readonly empty field still renders the "No value" mark.
- a8c5509: fix(plugin-form,fields,i18n): the line-items panel, the grid field and the master-detail heading finish speaking the user's language
  
  Under a Chinese session the rest of the line-items chrome still rendered in
  English. The record page's `record:line_items` panel read `Loading…`, `Save the
  record first to add line items.`, `This record’s line items have not been
  loaded.`, the `Failed to load line items` / `Failed to save line items`
  fallbacks and its no-`childObject` hint. The line-items grid (`GridField`) read
  its footer `Total`, its column chooser's `Columns` / `Optional columns`, the
  computed cell's `Computed` tooltip and its row actions. A master-detail
  collection with no `title` was headed `Line Items`.
  
  They now read the locale packs. Reused keys: `common.loading`, `table.columns`,
  `form.masterDetail.total` (the footer), `view.dragToReorder` (the drag handle)
  and `form.lineItems.title` (the master-detail heading). New keys, in all ten
  packs: `form.lineItems.saveRecordFirst`, `form.lineItems.notLoaded`,
  `form.lineItems.loadFailed`, `form.lineItems.saveFailed`,
  `form.lineItems.noChildObject`, `fields.grid.optionalColumns`,
  `fields.grid.computed`, `fields.grid.openRow`, `fields.grid.duplicateRow` and
  `fields.grid.removeRow`.
  
  Each row action now has one key, read by both its `aria-label` and its `title`.
  The English kept for each is the accessible name it already had:
  
  - open the row in the full form: `Open row` (the tooltip was `Open full form`);
  - duplicate the row: `Duplicate row` (the tooltip was `Duplicate line`);
  - remove the row: `Remove row` (no tooltip, as before);
  - the drag handle: `Drag to reorder`.
  
  Only the defaults move. An authored collection `title` still wins, and so does
  a failure message the server sent. Apart from the two tooltips above, English
  output is byte-identical to the literals these replace, with or without an i18n
  provider.
- c2a8d23: fix(fields,plugin-form,i18n): the line-items grid's required-cell text and the master-detail form's config hints read the locale packs
  
  Under a Chinese session two parts of the line-items family still rendered in
  English. The line-items grid (`GridField`) named a required, empty cell as the
  column label followed by ` is required`. That text is the plain cell's tooltip
  and the `error` the lookup and file cells take. A master-detail collection that
  could not be resolved showed one of three English configuration hints: no
  `childObject`, a child schema that failed to load, or no lookup or
  master_detail field linking the child to the parent.
  
  They now read the locale packs. The grid cells reuse `validation.required`
  (`{{field}} is required`), with the column label in `{{field}}`: the sentence
  the form renderer already shows for a required field. The three hints read
  new keys in all ten packs: `form.masterDetail.noChildObject`,
  `form.masterDetail.schemaUnavailable` and
  `form.masterDetail.noRelationshipField`. Property names (`childObject`,
  `relationshipField`) and object names stay code elements and are never
  translated.
  
  English output is byte-identical to the literals these replace, with or
  without an i18n provider.
- c1763e5: fix(fields): the number cell ignores a malformed `scale` instead of flooring it or crashing
  
  `NumberCellRenderer` took any JavaScript number in `scale` as the decimal width. A
  non-integer `scale: 1.5` rendered `3.14159` as `3.1`, a width nobody declared. A
  negative `scale: -1` made the cell throw a `RangeError`, which took the row down. The
  cell now reads the width through `resolveFieldScale` from `@objectstack/spec/data`,
  the function the percent cell, the detail view and the grid footer already use. A
  malformed declaration counts as no declaration, so the value shows as stored.
  
  A well-formed `scale`, or no `scale` at all, renders exactly as before. The grouping
  rule is unchanged too: a declared `scale: 0` (a year, for example) still renders
  without thousands separators, and a field with no `scale` still groups.
- 52c95a1: fix(fields): a read-only number field shows its value the way its table cell does (objectui#11431)
  
  A read-only `NumberField` printed the raw stored value. A field declaring `scale: 2`
  and holding `1234.5` read `1234.5` in a read-only form, exactly as with no `scale`,
  while `NumberCellRenderer` showed the same field `1,234.50`: the read-only face applied
  no decimal width, no thousands grouping and no display locale.
  
  Both faces now make the same formatting call. The width is the one `resolveFieldScale`
  in `@objectstack/spec/data` answers, the grouping follows the field's `useGrouping` over
  the `scale` heuristic, and the locale is the display locale. So the form and the table
  show one field's value identically: `1,234.50` for `scale: 2`, the value's natural
  precision (`1,234.5`) when no `scale` is declared, `2026` for a `scale: 0` year, and
  `1.234,50` in German. An empty value still shows the placeholder.
  
  Nothing changes in the editable input, in the table cell's output, or in any exported
  name or type.
- 6007dd4: fix(fields): a read-only percent or currency field shows its value the way its table cell does, and a whole currency amount keeps its minor units (objectui#11444)
  
  A read-only `PercentField` printed the percentage with a literal `%` and no display
  locale. A field declaring `scale: 2` and holding `0.25` read `25.00%` in a German
  read-only form while its table cell read `25,00 %`, and a four-digit percentage lost
  its grouping (`1234.5%` against the cell's `1,234.5%`). The read-only face now renders
  through the same call the cell's `formatPercent` uses, so the locale's percent
  convention, its grouping and the declared width match. The width is still the one
  `resolveFieldScale` answers, and the face still reads a value as a fraction unless the
  field declares `max > 1`.
  
  A read-only `CurrencyField` and `CurrencyCellRenderer` disagreed on a whole amount: the
  form read `$3,456.00` while the cell read `$3,456`. Triage ruled that the declared
  width, a currency's ISO 4217 minor-unit count, is the protocol's convention, and retired
  the whole-amount trimming `formatCurrency` applied since objectui#4033 (objectui#11444,
  comment 5946462862). The read-only face now calls `formatCurrency` itself.
  
  **Visible change in table cells.** `formatCurrency` no longer drops the fraction of a
  whole amount. Every face that formats through it moves with it: the currency table
  cell, the record detail panel, the grid column-summary footer, the dashboard metric
  tile and table widget, and the gantt tooltip. A whole USD amount reads `$3,456.00`
  instead of `$3,456`, a whole KWD amount `KWD 3,456.000` instead of `KWD 3,456`, and an
  amount with no currency resolved `3,456.00` instead of `3,456`. A currency with no
  minor unit is unchanged: a whole JPY amount still reads `¥3,456`. Fractional amounts
  render exactly as before. The dashboard metric tile restated the cell's no-currency
  width for a field with no currency resolved (no decimals for a whole amount); it now
  restates two decimals, so a whole amount reads `3,456.00` on the tile as in the cell.
  
  `formatCurrency` keeps its name, its signature and its `@object-ui/fields` export.
  Nothing changes in the editable inputs.
- 4a1adb7: The record picker's record count reads the right noun form in every language at every count (objectui#11445): it passes `count` to the `lookup.recordCount` count family instead of choosing `lookup.recordCountOne` on `=== 1`, so Russian reads `2 записи` and Arabic uses its dual at 2. The provider-less defaults table carries the family's `_one` / `_other` rows.
- 185b7a0: fix(fields): a `json` field edits as JSON — it shows the stored value as JSON text and saves the parsed value (objectui#11448)
  
  `json` was aliased to `field:code`, the raw-text code editor. In the record Edit
  dialog a stored object therefore showed as the literal text `[object Object]`, and
  saving an edit sent the text as a **string**: `{"a":1}` was stored as `'{"a":1}'`,
  silently changing the stored value's type. Unparsable text was saved as a string
  too. The same alias reached the inline editors in the grid and the detail panel.
  
  `json` now resolves to `field:object` — `ObjectField`, the JSON editor `object`,
  `composite` and `record` already used — so one editor serves the four free-form
  JSON types (`object`, `composite`, `record`, `json`). It shows the stored value as
  `JSON.stringify(value, null, 2)` and saves `JSON.parse(text)`, and it carries every JSON value, not only objects: an array, a
  number, a string, a boolean or `null`. The grid and detail-panel inline editors
  keep editing `json` in place, now with the same face. `code` is unchanged: it stays
  the raw-text editor and saves its text.
  
  The action-parameter dialogs resolve a param's widget through the same alias
  table, so a `json`-typed action parameter (or one backed by a `json` field) now
  edits with the JSON editor too and **posts the parsed value instead of the text**
  — `{ "a": 1 }` arrives as an object, no longer as the string `'{"a":1}'`. An
  endpoint that parsed the text itself receives the value already parsed.
  
  Three fixes to `ObjectField` itself come with it, so they also reach `object`,
  `composite` and `record`:
  
  - **An unparsable draft stays in the box.** The editor used to replace any text
    that did not parse with the stored value on every keystroke, so a value could not
    be typed one character at a time: in an empty field the first `{` vanished, and
    in a filled one the box snapped back to the last valid value while still saying
    "Invalid JSON".
  - **A form will not submit unparsable text.** A refused draft never became a form
    value, so the form still held the last value that parsed and a save sent that
    stale value. The box now marks itself invalid through the browser's constraint
    validation, so the submit button is refused, the box is focused and its message
    is shown; nothing is sent until the text parses. The detail panel's inline save
    bar has no form element, so there the refusal stays the box's own message.
  - **The read-only face prints a stored `0` or `false`** instead of the empty
    affordance, as the json table cell already did.
  
  A record already saved as a string by the old editor now shows as a JSON string
  literal (`"{\"a\":1}"`) rather than as `{"a":1}` — that is the value it holds.
  Retyping it as JSON and saving stores the object.
- 06a8af5: `QueryParams.$filter` now declares both shapes the data sources actually accept — the
  MongoDB-style field-keyed record, or a `FilterArray`, the ObjectQL AST sugar bound from
  `@objectstack/spec/data` (objectui#3909).
  
  **Nothing is narrowed and no accepted value changes.** `Record<string, any>` already
  accepted arrays structurally — they satisfy its string index — so the union documents
  shapes that were always legal rather than admitting new ones. Measured both ways under
  `tsc --strict`: all five inputs `translateFilterToAST` enumerates assign to the old and
  new declarations alike, and both reject a bare number and a bare string identically. A
  downstream `turbo run build` over all 43 dependent packages is green, which is the
  evidence a published type change breaks no consumer.
  
  The harm was entirely on the type face, and it was two-sided. The declaration blocked
  nothing while describing one legal shape as though it were the only one — objectui#3831
  is what that cost, a rule array accepted by a `Record<string, any>` slot, object-spread
  flattened to `{"0": {...}}`, types green, and the query filtering on a column literally
  named `0`. And someone writing a new consumer would read the type and its record-only
  `@example`, conclude the array path was illegal, and add a tolerant conversion for it —
  the "widen the consumer to tolerate the producer" shape AGENTS.md #0.1 forbids. Two
  producers have fed arrays through this slot all along: `plugin-list`'s
  `buildEffectiveFilter` (grid and export) and `plugin-view`'s `ObjectView` (calendar /
  kanban / gallery / timeline). The runtime was right; the declaration was narrow.
  
  The array half is **bound** to the spec's `FilterArray` rather than restated locally, so
  it cannot fork from the vocabulary the servers parse — the same failure two hand-written
  operator lists had in objectui#3948. The doc comment names `translateFilterToAST` as the
  authoritative accepted set instead of carrying a second list to drift from.
  
  `@object-ui/fields` drops the local cast this defect forced. PR objectui#3908 wrote
  `filter as Record<string, any>` at one assignment in `useRecordQuery`, deliberately, as
  debt rather than widening the shared type. `hasFilter` is now a type predicate narrowing
  to the `$filter` slot's own type, so the assignment needs no cast and the guard cannot
  drift from the declaration it guards. Type-only throughout; no runtime behaviour changes.
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
- 88e9109: Declare the two consumed-but-undeclared field-metadata keys ruled on
  objectui#6140 / objectui#6153 (maintainer 2026-08-25, Option A), and de-cast
  the widget reads they legalize:
  
  - `MarkdownFieldMetadata.rows` and `HtmlFieldMetadata.rows` (`@object-ui/types`)
    — the inline-editor height `RichTextField` has always read through an
    `as any` (default 8), following the `TextareaFieldMetadata` precedent. NOT a
    spec key: `@objectstack/spec` `FieldSchema` refuses `rows` BY NAME
    (`unrecognized_keys`) on all four of textarea/markdown/html/richtext, so it is
    an objectui render hint that must not be written into authored object
    metadata. The four inert editor keys (`toolbar`/`preview`/`minHeight`/
    `maxHeight`) stay deliberately undeclared and are pinned so.
  - `SelectOptionMetadata.description` — secondary option text `LookupField`
    searches on authored static options and emits from `recordToOption`. NOT a
    spec key either: `@objectstack/spec` `SelectOptionSchema` is strict over
    exactly `{label, value, color, default, visibleWhen}` and refuses
    `description` BY NAME, and `FieldSchema` routes `options` through that schema,
    so the key must never reach authored object metadata.
  - `RichTextField` and `TextAreaField` (`@object-ui/fields`) now read their
    metadata through the declared types instead of `field as any` (the spec-face
    `maxLength` dual-read in `TextAreaField` stays as a documented structural
    read). Behaviour unchanged; `rows` and option `description` are now legal to
    author in an objectui **annotated literal** — never in an object document sent
    to the platform.
  
  Both spec attributions above were corrected in place before release
  (objectui#7537): as first written this changeset claimed each key was "aligned
  with" a `@objectstack/spec` schema member that does not exist. Re-measured on
  `@objectstack/spec@17.2.0`, each refusal is paired with a control that accepts
  the same payload minus the key. Same correction as `0e3b3be09` (PR #7510) made
  to the published JSDoc; the package bumps and the declared behaviour are
  unchanged.
  
  ⚠️ **Dated note, 2026-09-27 — the spec has since declared both keys, so neither
  refusal above holds — objectui#10801.** `@objectstack/spec` 17.3.0 declared
  `rows` and option `description` (the objectui#6140 / objectui#6153 ruling), and
  this repository resolves 17.4.0 on this date. Measured on 17.2.0, 17.3.0 and
  17.4.0, each probe beside a control that differs only by the key: 17.2.0 refuses
  both by name, as above. From 17.3.0 `SelectOptionSchema` declares
  `description`, so an option carrying it is accepted and a select field or an
  object whose `options` carry it parses whole; `icon` is still refused by name
  (`unrecognized_keys`). From 17.3.0 `FieldSchema` accepts `rows` on the four
  multiline editor types (`textarea`, `markdown`, `html`, `richtext`); on 17.4.0
  every other field type refuses it by a cross-field refinement (issue code
  `custom` at `rows`), not by name. So the sentences above that call these keys
  "NOT a spec key" and keep them out of an object document sent to the platform
  no longer describe the contract: both may be authored there, `rows` on those
  four types only. The rest of this entry, and the 17.2.0 correction above, are
  kept as the reading of this change; `select-option-spec-extension-7014.test.ts`
  in `@object-ui/types` re-derives both boundaries against the installed spec.
  
  ⚠️ **Dated note, 2026-09-30 — `TextAreaField`'s dual read is retired — objectui#11070.** "the spec-face `maxLength` dual-read in `TextAreaField` stays as a documented structural read" above no longer describes what ships. Later in this same release objectui#11070 (its text-family round) declared `maxLength` on `TextareaFieldMetadata` by reference to `@objectstack/spec`'s `FieldSchema.maxLength`, and `TextAreaField` reads it through that declared type, alone; the snake_case `max_length` is retired. `.changeset/11070-text-family-round5.md` states what ships; the text above is kept as the reading of this change.
- 5d3a2d1: The capability picker localizes `manage_sharing` (objectui#6285). Before this, "Manage
  Sharing" was the one platform capability in `sys_permission_set`'s picker that rendered in
  English in every locale, beside seven siblings that translated — a user-visible missing
  translation, in all ten packs at once.
  
  The cause was an unchecked copy. `CURATED_CAPABILITY_LABELS` in
  `CapabilityMultiSelectField.tsx` listed seven capability names under a doc comment claiming
  it mirrored `@objectstack/spec/security`'s `PLATFORM_CAPABILITIES`; the spec grew an eighth
  member and the list did not follow, so `manage_sharing` fell through to the English label
  the `sys_capability` registry serves. Nothing could catch it: the i18n gate reads that list
  as this key family's vocabulary and checks the members it names — all seven had keys — and
  no instrument compared the vocabulary to the array it was named after.
  
  `capability.label.manage_sharing` is now authored in all ten packs and in the field widgets'
  provider-less defaults map, the list carries the member, and the prose claim is replaced by
  a check: `CapabilityMultiSelectField.specParity-6285.test.tsx` imports `PLATFORM_CAPABILITIES`
  and fails on any difference in either direction, reading the declaration through the i18n
  gate's own source reader so what it pins is exactly what that gate consumes. `labelFor` also
  gains a `defaultValue`, so a capability that arrives in a future spec bump before its
  translation is authored degrades to the registry's English label rather than rendering a raw
  i18n key at the user.
- dddb942: Delete the dead `metadata-admin/previews/object-fields-bridge.ts` module, and the three
  prose references that still described it as wired.
  
  The module exported `bridgeFromDraft`, `commitToDraft` and `FieldsBridgeResult` and had
  **zero importers** — re-measured on the merged base, not inherited from the filing. Nothing
  in the repository could reach it either: `@object-ui/app-shell`'s `exports` map declares
  only `.` and `./styles.css`, so the file was not addressable as a deep import even from
  outside the workspace.
  
  Removing it is not the whole change. Three comments — in `types/src/designer.ts`, `types`'
  `designer-field-types.test.ts` (twice) and `fields`' `richtext-cell-renderer-5452.test.tsx`
  — cited the bridge as a live corroborating source. Left behind, they would have swapped
  dead code for false documentation: three in-repo pointers telling a future reader that this
  bridge mediates between the framework field record and `FieldDesigner`, and nothing telling
  them it is unreachable. The two that named it as the consumer deriving an editable-subset
  check from `DESIGNER_FIELD_TYPES` now name `MetadataFieldsPage`, which does exactly that
  with the same idiom and the same `objectui#3017` anchor. The third cited the bridge's
  `richtext` → `html` mapping as one of three corroborations that `richtext` stores HTML; the
  other two (the showcase seed and the field-type decision tree) are live and carry the point
  on their own, so that clause is dropped rather than repointed.
  
  No behaviour changes: nothing imported the module, so there is nothing to migrate.
- 98188c2: `LocationField` no longer discards a location's `altitude` / `accuracy` when the user
  retypes the coordinate pair (objectui#6664).
  
  The widget edits the pair as one comma-separated text box and rebuilt its emission as a
  fresh `{ lat, lng }` from the parsed text, so the two OPTIONAL keys `@objectstack/spec`
  declares alongside them — `LocationValue` is `{ lat, lng, altitude?, accuracy? }` — were
  gone the moment anyone edited the coordinates. Nothing warned; they simply were not in
  the object handed to `onChange`. Both keys are registered on the platform's authorable
  surface (`authorable-surface.base.json`), so a customer may author them even though the
  platform itself produces neither today — measured in both repos.
  
  The drop **predates** objectui#6272: before that flip the widget emitted
  `{ latitude, longitude }` and discarded the rest identically. What #6272 changed is only
  that the *declared* value type is now the spec's, so the type claimed four keys while the
  write path handled two. This closes that gap; it is not a regression #6272 introduced.
  
  The carry is a key-by-key pick of exactly those two keys out of a value that is already a
  valid `LocationValue` — deliberately **not** a spread of the incoming value, which would
  carry a stored record's retired `latitude` / `longitude` spelling straight back into the
  emitted object and undo #6272's rename. A negative control pins that. Each key is taken
  only when it is a usable number, because the spec's `z.number()` rejects `NaN`, `Infinity`
  and a numeric string alike; leaving such a value behind narrows the emission rather than
  widening what the widget accepts.
- f46bd39: `LocationField` no longer emits a coordinate pair the platform's own validator
  refuses (objectui#6714).
  
  `@objectstack/spec`'s `LocationValueSchema` constrains the coordinate **range**
  (`lat` −90..90, `lng` −180..180), but the widget's guard tested only that each
  coordinate was a finite number. Typing `999, 999` therefore emitted
  `{ lat: 999, lng: 999 }` — a value `valueSchemaFor({ type: 'location' })`
  rejects with `too_big` at both keys. That is the producer direction of the
  contract-first failure class (AGENTS.md #0.1): a renderer writing what the
  contract rejects. It was open to every user who edits a location field, since
  typing the coordinates is this field's only interaction.
  
  **Measured before choosing the disposition**, as triage required: nothing
  downstream rejects or repairs the value. Driving a real `ObjectForm` with a
  `type: 'location'` field and typing `999, 999` called `dataSource.create` once
  with `place: { lat: 999, lng: 999 }` verbatim, `aria-invalid="false"` on the
  control and no error text anywhere. `sanitizeFormData` filters keys and never
  inspects a value, and `buildValidationRules` has no `location` branch. So the
  out-of-range pair reached storage silently, and the widget is the only place a
  refusal can work.
  
  The fix therefore **refuses the emission**, extending the rule this widget
  already applies to text that isn't a coordinate pair from *format* to *range*:
  the typed pair is simply not written and the prior value stands. No new UI and
  no new mechanism — the same `// If invalid, don't update the value` branch.
  
  The bounds are **not** restated in the widget. A hand-copied `-90..90` would be
  a second contract free to drift from the spec, so the emission is put to
  `LocationValueSchema` itself. Two consequences of asking the schema rather than
  testing two bounds by hand: the check covers the WHOLE emitted object, so the
  `altitude`/`accuracy` carried across an edit (objectui#6664) are held to the
  contract too; and `Infinity` is refused as well, which the finiteness gate let
  through (`parseFloat('Infinity')` is `Infinity`, and `!isNaN(Infinity)` is
  `true`).
  
  Reading is deliberately unchanged: a record that already holds an out-of-range
  pair still renders in the box, so the person who can correct it can still see
  it. objectui#6272's empty render was for a value whose *shape* this widget
  cannot read; this shape is readable, it is only not writable.
- b98352a: `LocationField` no longer invents a coordinate out of text that is only partly a
  number (objectui#6715).
  
  Each half of the typed pair was read with a bare `parseFloat`, which stops at the
  first character it cannot read and returns what it got. So `"12abc, 34"` emitted
  `{ lat: 12, lng: 34 }` — a coordinate nobody typed.
  
  **Why nothing downstream could catch it, and why that makes this different from
  objectui#6714.** Every one of those truncations is a pair
  `valueSchemaFor({ type: 'location' })` ACCEPTS: well-formed, in range, and wrong.
  #6714's `999, 999` was at least a value the contract refuses, so something
  downstream could in principle have objected; here the platform validator cannot
  be the oracle at all. Measured on `b76ca6764` by driving a real `ObjectForm`
  (create mode, a `type: 'location'` field, a fake `DataSource`) and submitting:
  
  ```
  typed "12abc, 34"    create({ place: {"lat":12,"lng":34} })    aria-invalid=false
  typed "1.2.3, 4"     create({ place: {"lat":1.2,"lng":4} })    aria-invalid=false
  typed "12deg, 34"    create({ place: {"lat":12,"lng":34} })    aria-invalid=false
  typed "0x10, 34"     create({ place: {"lat":0,"lng":34} })     aria-invalid=false
  typed "12.5 N, 34 E" create({ place: {"lat":12.5,"lng":34} })  aria-invalid=false
  ```
  
  The last two show the size of the class. `0x10` truncates to `0` — objectui#6272's
  `|| 0` in the Gulf of Guinea, arriving through a different door — and
  `"12.5 N, 34 E"` drops the hemisphere, so a `12.5 S` paste would have been stored
  as `+12.5`, on the wrong side of the equator, with nothing said.
  
  **The fix** parses each half as a strict whole-string number, applying
  objectui#6272's precedent: a field that renders a plausible wrong place is worse
  than one that renders nothing. The test is `parseFloat`'s OWN grammar, anchored —
  not a stricter notion of a number invented in the widget — so every form that is
  a number today still is: negatives, a leading `+`, surrounding whitespace,
  exponent forms (`3.027e1`), and a bare decimal point on either side (`.5`, `30.`).
  
  The refusal is **announced**, through the machinery objectui#6716 landed rather
  than a new one, and it names the half it could not read: *Not saved: latitude
  "12abc" is not a number. Enter plain decimals (example: 30.2741, 120.1551).* A
  third silent refusal would have re-opened the defect #6716 had just closed.
  
  Two boundaries drawn deliberately:
  
  - Text with **no** number at the front (`abc`, `NaN`, `here, there`) keeps the
    pre-existing format sentence. "No number at all" and "a number with text after
    it" are different mistakes and get different advice.
  - `Infinity` carries no residue — `parseFloat` reads the whole word — so it is
    still refused by objectui#6714's **range** arm, not by the new one.
  
  ⛔ Degree/hemisphere notation (`12°N, 34°E`) is **not** parsed. It stays refused,
  per the maintainer ruling of 2026-08-29: the paste route is unmeasured, and it
  becomes its own feature card if real demand arrives.
- b76ca67: `LocationField` says WHY it refused an edit, instead of refusing in silence
  (objectui#6716).
  
  The widget refuses to emit for input it cannot accept, and used to say nothing
  when it did. Two refusals shared that silence: text that is not a
  comma-separated pair (pre-existing), and a pair outside the spec's coordinate
  range (objectui#6714). In both, `onChange` was never called, so the typed text
  vanished with `aria-invalid` reading `"false"` throughout — a screen reader was
  told the control was fine right after it had rejected the entry.
  
  - Both arms now render a short reason and set `aria-invalid` on the control. The
    range message is built from `LocationValueSchema`'s own issues, never from a
    hand-copied `-90..90`, so it cannot drift from the spec.
  - The box now HOLDS the refused text, so the message has something to point at
    and the entry can be corrected in place. Measured first without it: with the
    value derived straight from the stored one, React restores the control in the
    same tick, so typing a valid coordinate one character at a time left the box
    empty, stored nothing, and lit a refusal on the final keystroke too.
  - Refusal is unchanged: a coordinate the platform validator rejects is still
    never emitted, and never stored. The published objectui#3222 `error` slot keeps
    its single author (the form renderer); the widget's own state is separate, as
    `ObjectField`'s `parseError` already is.
- b392674: Field widgets say WHY they refused an edit in the reader's language
  (objectui#6755, maintainer ruling 2026-08-29).
  
  Three sentences a person has to read to recover from a refusal were string
  literals in the widgets, inside a package whose locale channel 11 of its 55
  widgets already use: `ObjectField`'s `Invalid JSON`, and `LocationField`'s
  format and range refusals (objectui#6716 / #6714). So a zh / ja / ar user who
  mistyped a coordinate or a JSON blob was told why in English, in a form whose
  labels, gate hints and validation copy were all translated.
  
  - All three now read from `useFieldTranslation` / `FIELD_DEFAULTS` under
    `fields.object.invalidJson`, `fields.location.refusedFormat` and
    `fields.location.refusedRange`, with entries in all ten locale packs — bound
    from now on by `check:i18n-drift`.
  - The `en` values are byte-identical to the literals they replace, so English
    and provider-less rendering are unchanged, and the refusal pins of
    objectui#6716 / #6715 and `plugin-form`'s two refusal suites are untouched.
  - `fields.location.refusedRange` keys the FRAME only: the interpolated
    `{{detail}}` is `LocationValueSchema`'s own complaint, because the widget must
    not restate the spec's bounds (a hand-copied range is a second contract).
  - Not in scope, and recorded rather than folded in: `LocationField`'s third
    refusal sentence — the residue arm objectui#6715 added after the ruling was
    written — is still a literal. The card behind `320374d2a` carries it.
- 8579e34: `CurrencyField` and `TagsField` now compose a host-supplied `onBlur` instead of
  overriding it (objectui#6802).
  
  `onBlur` is a DECLARED DOM pass-through key — named in `FieldWidgetDomProps`
  and in `SDUI_DOM_PASS_THROUGH_KEYS`, and forwarded by `toDomProps` — but both
  widgets wrote their own `onBlur={…}` AFTER the `{...toDomProps(props)}` spread,
  so the host's handler was overwritten and never reached the control. Each now
  resolves `toDomProps(props)` into `domProps` and calls `domProps.onBlur?.(e)`
  at the end of its own handler, the idiom the other four widgets of this package
  already use.
  
  ⚠️ This is a REAL behaviour change, not the no-op the finding was filed as. The
  form renderer hosts every field through react-hook-form's `Controller` and
  spreads the controller field — `{ name, value, onChange, onBlur, ref, disabled }`
  — into the widget's props, so the overridden handler was the one that marks a
  field touched and runs its validation. Concretely: on a form declaring
  `validationMode: 'onBlur'` or `'onTouched'`, currency and tags fields were
  silently opted out of blur-mode validation while every sibling field type kept
  it. They now behave like the rest.
  
  Currency keeps emitting its rounded value before handing the event on, so a
  blur-mode validator reads the parsed amount rather than the raw text; tags
  still commits the typed draft first, so the validator reads the committed list.
- d57db5d: `NumberField` now reads the published `error` validation slot, so a number
  field marked invalid is announced to assistive tech by the widget itself
  (objectui#6803, closing an objectui#3222 gap).
  
  The widget destructured `{ value, onChange, field, readonly, ...props }` with
  no `error`, so the slot landed in the open tail and `toDomProps` — a whitelist
  — dropped it. It wrote `aria-invalid` only while its own bad-input refusal was
  active, which meant that on any host that does not hand a value down itself,
  an invalid number field carried no `aria-invalid` at all.
  
  `error` is now wired and the conditional spread becomes the ordinary
  `aria-invalid={!!error || !!refusal}` the sibling number widgets already use.
  Both halves ship together on purpose: reading `error` is what makes an
  unconditional attribute safe to write, and leaving the attribute conditional
  would have kept the wiring invisible. Un-conditionalising WITHOUT reading
  `error` is the regression this pairing forbids — it would stamp `"false"` over
  the correct value `FormControl`'s Radix Slot hands down.
- 320374d: Key `LocationField`'s THIRD refusal sentence — the residue arm — into the locale
  packs.
  
  Typing a half that is only PARTLY a number (`12abc, 34`) is refused by
  `LocationField` with its own sentence, added by objectui#6715. objectui#6755 had
  ruled two weeks earlier that a widget's own refusal sentence goes through
  `useFieldTranslation` + `FIELD_DEFAULTS`, and named three sentences — but it was
  written on 2026-08-29 14:53 and this arm landed after, so it stayed a hard-coded
  English literal while its two siblings were keyed.
  
  **The consequence was worse than one more English string.** All three refusal arms
  render through the SAME `<p>` and the same `refusalError` state, so after #6755
  landed that one line spoke the reader's language when the format or range arm fired
  and English when the residue arm did — objectui#4028's shape ("four Chinese labels
  around one English one") compressed into a single sentence position, which reads to
  a user as a bug rather than as a missing translation.
  
  **Arity is answered explicitly, not defaulted.** Unlike the other two sentences, this
  one had grammatical number: `verb` was `is not a number` / `are not numbers`, chosen
  in TypeScript. Handing a pack an English verb form through a `{{hole}}` gives it a
  fragment it cannot inflect around — Arabic has a DUAL, and two halves is exactly that
  case. So the verb is not a hole. It lives inside two SIBLING keys picked at the call
  site, `fields.location.refusedResidue` and `fields.location.refusedResidueOne`,
  following this repo's own plural convention rather than i18next's `_one`/`_other`
  suffixes — the same shape `RecordPickerDialog` already uses in this very defaults map
  (`lookup.recordCount` / `lookup.recordCountOne`), and for the reason `ReactionPicker`
  states in source: zh/ja/ko have no separate singular form, would legitimately omit a
  `_one` half, and `all-locales-key-parity` reads that as a missing key. The `ar` pack
  now uses its dual (`ليسا رقمين`), which the old implementation could not have produced.
  
  The English conjunction `' and '` and the coordinate NOUNS go the same way: each pack
  writes its own conjunction inside the two-half value, and `latitude` / `longitude`
  become `fields.location.latitude` / `fields.location.longitude`, keyed once each and
  interpolated into both arities so no locale holds two spellings of the same word. The
  only holes carrying untranslated data are `{{text}}` / `{{otherText}}` — the
  characters the person actually typed.
  
  **No behaviour moves.** The English values are byte-identical to the literal they
  replace in both arities, verified by `check:i18n-drift` (0 en values changed, 4 added)
  and by objectui#6715's own `LocationField.strictNumeric.test.tsx` and `plugin-form`'s
  `ObjectForm.locationResidue.test.tsx` passing untouched. Provider-less rendering is
  unchanged, the refusal itself is unchanged, and the four new keys are bound from here
  on by `check:i18n-keys` and `all-locales-key-parity` like their three siblings.
- b458300: `FieldEditWidget` now DELIVERS the DOM pass-through block it DECLARES
  (objectui#6909).
  
  Its props are `FieldWidgetComponentProps` — the controlled-input keys
  intersected with `FieldWidgetDomProps`, `AriaAttributes` and the open `data-`
  family — so a host could always pass `id`, `name`, `autoFocus`, `tabIndex`,
  `onBlur`, `onFocus`, `onClick`, any `aria-*` and any `data-*` with no type
  error. The body then destructured five keys and rendered the widget with those,
  so `autoFocus` was the ONLY survivor of the whole block and everything else was
  silently dropped. That is this package's own first-class defect class, named in
  `widgets/toDomProps.ts`: a key that type-checks, reads as supported, and
  silently never reaches the element (objectui#3290's `aria-required`,
  objectui#3222's validation slot).
  
  Not a widening, and not a contract change. The keys were already declared, and
  each widget still re-filters through its own `toDomProps` before anything
  reaches a DOM element — what any widget accepts or rejects is unchanged. The
  factory was simply the one link in the chain nothing bound to the declaration:
  `toDomProps` binds the WIDGET contract to its whitelist with compile-time
  assertions in both directions, and the factory sat above them, bound to
  neither.
  
  The fix hands the widget `toDomProps(props)` — this package's own executor —
  rather than a second key list written out in the factory. That reuse is the
  guard: `toDomProps.ts`'s direction-2 assertion already makes
  `keyof FieldWidgetDomProps extends DomPassThroughKey` a compile error to
  violate, so a key added to the declared DOM block now reaches the widget
  through this factory automatically. One mechanism, one judge — a private list
  here would have been free to drift, which is how the factory came to deliver
  one key out of seven.
  
  The forwarded set is a deliberate superset of `FieldWidgetDomProps`: it also
  carries `className` and `disabled`, declared on the controlled-input block and
  forwarded by the same executor for the reason stated there — withholding them
  makes it a silent styling- and interactivity-dropper. The semantic props
  (`field`, `value`, `onChange`, `readonly`, and `compact` for the relational
  pickers) stay explicit and are applied after the spread, so a host cannot
  displace them.
  
  **No host in this repo changes behaviour.** Measured on all three call sites
  before the fix: `ObjectGrid.renderCellEditor` passes `{ field, value, onChange }`,
  `InlineFieldInput` passes those plus `autoFocus` (the key that already worked),
  and `RequiredFieldsDialog` passes those plus `readonly`. None passes a dropped
  key, so this is a plain repair rather than a live regression — but
  `RequiredFieldsDialog` had already worked *around* the drop, wrapping each
  control in a `label` because "`FieldEditWidget` … takes no `id` to associate
  with". It does now.
  
  Also corrects a comment in `@object-ui/components`' `data-table.tsx` that this
  change falsifies. It justified the injected editor's document-level
  `pointerdown` listener partly with "`FieldEditWidget` forwards `autoFocus` and
  nothing else out of the DOM block, so a host handler could not reach the
  control through it even if one were passed" — no longer true. The listener is
  still load-bearing for the other half of that reason, which is untouched: the
  `renderCellEditor` context object has nowhere to put an `onBlur` in the first
  place. Comment only; no behaviour change in that package.
- 39d69ad: Stop shipping `dist/__tests__/numberInputBrowserReadings.d.ts` in the published tarball.
  `packages/fields/tsconfig.json` now excludes the tooling DIRECTORIES
  (`__tests__`, `__mocks__`, `__benchmarks__`), not just the `*.test.*` NAME.
  
  `numberInputBrowserReadings.ts` holds the measured Chromium/happy-dom readings the number
  widget suites share. It is deliberately not a `*.test.ts` — it carries no assertions — so
  the name-only exclude list did not catch it, and it was emitted into `dist` and published
  while its 79 neighbours in the same directory were kept out. That made
  `check:published-dist` red on `main`, and because the same script is the first link in
  `changeset:publish`, it also failed the publish command at its first step.
  
  This is the third instance of the same name-versus-directory mismatch (objectui#4006 here,
  objectui#4836 in plugin-grid / plugin-view / plugin-designer), so the exclude table is now
  the directory convention itself rather than a list of names to extend.
  
  Which program had to be fixed was measured rather than assumed, because this package's
  build is `tsc && vite build` and the `tsc` leg inherits the root's `noEmit`: run alone the
  `tsc` leg exited 0 and wrote zero files, while `vite build` alone produced the whole
  81-file output including the offending declaration. vite-plugin-dts is the emitting
  program, and it builds its declaration program from this package's `tsconfig.json`, so
  that is where the exclude belongs.
  
  No type coverage moves with the change and no API surface moves: `numberInputBrowserReadings.ts`
  is the only file the directory patterns newly remove from the build program, and the
  `tsconfig.test.json` chained off `type-check` already reads it as a transitive input of the
  three suites that import it. The name patterns stay, because 52 `*.test.ts(x)` files in this
  package sit outside any `__tests__/` directory.
- 639114c: Carry `manage_org_presentation`, the ninth platform capability (objectui#7122).
  
  `@objectstack/spec` 17.3.0 declares a ninth member of `PLATFORM_CAPABILITIES`
  and the capability picker's curated set carried eight, so
  `CapabilityMultiSelectField` fell back to the `sys_capability` registry's
  English label for it in every locale — the exact defect objectui#6285 filed
  when `manage_sharing` did the same thing.
  
  The label is the spec artifact's own (`Manage Organization Presentation`), read
  off the installed build rather than invented, and it is authored everywhere the
  widget's docblock requires of any edit to that list: `useFieldTranslation.ts`
  and all ten locale packs. Each non-English string is composed from that pack's
  own established sibling vocabulary (`manage_org_users`,
  `manage_platform_settings`) rather than machine-translated; a native review pass
  is welcome on the nine, and nothing about the capability's behaviour depends on
  the wording.
  
  The parity pin is unchanged and still fails on ANY difference in either
  direction, which is what made this visible before it reached a screen.
- e8e4c4d: The last five inline edit widgets read the delivered `error` slot, so a failed
  required `text` / `boolean` / `date` / `datetime` / `time` control finally
  reports `aria-invalid` (objectui#7126).
  
  `f08bcd9af` made `FieldEditWidget` DELIVER the declared `error` key to
  whichever widget it resolves. Of the 27 distinct components in `EDIT_WIDGETS`,
  21 read it; five did not — `TextField`, `BooleanField` (serving both `boolean`
  and `toggle`), `DateField`, `DateTimeField` and `TimeField` — so for their field
  types the delivery was inert and the attribute was still never set.
  
  `text` being in that set is what made this a live defect rather than tidiness.
  It is the most common field type in any object, so it is the likeliest thing a
  kanban column makes required: `RequiredFieldsDialog` computed the failure, drew
  the red "Required" hint, handed the state to the control, and the control said
  nothing to assistive tech. The grid's inline cell editor and the detail page's
  inline edit (`InlineFieldInput`) compose the same seam.
  
  Each of the five now computes `aria-invalid={!!error}` **after** its DOM
  pass-through spread — one existing idiom, the objectui#3222 discipline the other
  21 already share, so a valid field says an explicit `"false"` rather than staying
  mute. Two judgements worth stating:
  
  - **The FORM path was never broken and is unchanged.** `<FormControl>` is a
    Radix `Slot` whose `aria-invalid` reached each control through the props
    spread; the form also produces `error`, so the widget's own computation now
    agrees with the value it replaces. The gap was every host WITHOUT that Slot.
  - **`BooleanField` is the one composite here, and the mark goes on the
    control.** Its Radix `Checkbox` / `Switch` renders a real
    `button[role=checkbox]` / `button[role=switch]`; the wrapping flex `div` is
    deliberately not the target, because a wrapper mark satisfies a subtree query
    while telling a screen-reader user nothing (objectui#5223). The three
    date/time widgets each render one native input, so the browser's picker raises
    no second-element question.
  
  This buys the MARKING only. The objectui#3222 slot drives `aria-invalid` and
  renders no text: the visible message stays with the host, and nothing that was
  invisible becomes visible.
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
- 554e647: Retire the dead `SchemaRendererContext` tail of the dependent-record
  resolution. `LookupField` and `useCascadingOptions` now resolve
  `dependentValues ?? {}`.
  
  Both widgets used to resolve the record a cascade gates on as
  `dependentValues ?? ctx.formValues ?? ctx.data ?? {}`. Neither of the last two
  members exists: `SchemaRendererContextType` declares exactly `dataSource`,
  `debug`, `debugFlags` and `apiFetch`, and `SchemaRendererProvider` accepts no
  other prop — so that tail was unsettable rather than merely unset, and resolved
  the empty record for every host that has ever rendered these widgets. Retired
  under ADR-0049 enforce-or-remove (objectui#7206, maintainer ruling letter C).
  
  Nothing observable moves, and that is the point: no host could populate those
  members, so no surface ever took that branch. What changes is that the one
  correct way to supply a record is now the only way there is — a host passes
  `dependentValues`, and a host that does not gets a visibly gated picker or a
  gated option list, rather than an empty record a documented fallback was
  supposed to have filled.
  
  The prose describing that tail as a working "record scope" channel goes with
  it, in the widgets' own docs and at the reader sites that quoted the chain. A
  comment asserting a channel the code does not have is what the next author
  copies: this one had already been read as a live host-supplied channel by two
  separate dependent-lookup investigations (objectui#7165, objectui#7190), which
  is why the retirement takes the comments with the reads.
- 544ecba: docs(types,fields): the `rows` / `options[].description` docblocks stop asserting a refusal the contract no longer performs
  
  Five shipped doc comments told a reader that `@objectstack/spec` REFUSES two keys BY NAME. It declares both. The sentences were measured correctly against 17.2.0 and outlived the contract they described — `@objectstack/spec` 17.3.0 implemented the maintainer's 2026-08-25 Option-A ruling on objectui#6140 / objectui#6153 and declared them, and this repo's pin has since moved past it. Docblocks in `packages/types/src` ship in `dist/*.d.ts`, so the false prose was reaching consumers.
  
  Corrected, each against the installed artifact rather than against the changelog:
  
  - **`rows`** — `FieldSchema` accepts it on `textarea` / `markdown` / `html` / `richtext` as an integer of at least 1. It is TYPE-GATED: on a field type with no rows-sized editor surface the refusal arrives as a cross-field refinement naming the key, deliberately not `unrecognized_keys`, so "declared" must not be read as "declared everywhere". `MarkdownFieldMetadata.rows`, `HtmlFieldMetadata.rows` and the `RichtextFieldMetadata` cross-reference now say so.
  - **`options[].description`** — `SelectOptionSchema` accepts it as a string, and a field whose `options` carry it parses whole, so it may now be authored. `SelectOptionMetadata` and its interface docblock now put the still-refused keys where the emphasis belongs: `icon` and `disabled`, which are what keeps "the schema still refuses something" a live fact.
  - **`select-option.ts`** no longer enumerates the spec's option keys. The enumeration is what went stale — the keys arrive through the `Omit` by reference, so a list written above the derivation can only ever disagree with it — and it is deliberately not replaced with a longer list.
  
  No runtime behaviour, type surface or export changes; every assertion in the repaired files passes unchanged before and after, which is the point — nothing mechanical was watching these sentences.
  
  Two of the five sites are now watched. They are written as single-line claims about the installed pin, which moves them out of `scripts/check-installed-spec-pin-claims.mjs`'s ledger of known-stale debt and into the population that gate re-derives at every bump; their ledger entries are deleted in the same change, as that gate's both-direction ratchet requires. The remaining three sit on facts no instrument reads, and say so rather than reading as live.
- f52a9d7: `GeolocationField` renders a `0` coordinate as the place it is, and stops leaking a literal
  `0` into the DOM (objectui#8055).
  
  Two independent defects were live in the widget's **display/read** path, and fixing either
  one alone left the other:
  
  1. **A valid location displayed as empty.** Every presence test in the widget asked the
     parsed NUMBER whether it was falsy — `if (!loc.latitude || !loc.longitude)` — and `0` is
     falsy. So the equator (`latitude: 0`), the prime meridian (`longitude: 0`) and a perfect
     `accuracy: 0` all took the "no value" branch: the coordinates row showed the `EmptyValue`
     em dash, the accuracy row vanished, and "View on map" was withheld — including its
     `openInMaps` handler, which refused the same value a second time. The stored data was
     intact and unreachable.
  
  2. **A literal `0` reached the DOM.** Three of those guards were JSX render expressions
     (`{location.latitude && location.longitude && (…)}`). With `latitude === 0` such an
     expression evaluates to `0`, and React renders the NUMBER as a text node. Measured on
     `main`, `{ latitude: 0, longitude: 120.1551 }` rendered `"—0"`: the em dash from defect 1,
     and a stray `0` beside it from defect 2.
  
  Both are closed by one predicate that is nullish **and** boolean-valued — nullish so `0`
  counts as present, boolean so no numeric operand can ever reach the DOM through `&&`.
  
  **The delta is exactly `0` and `-0`.** The predicate excludes `NaN` just as the old falsy
  guard did; a bare `!= null` would have started rendering `"NaN, NaN"` at a surface that has
  always shown the placeholder for an unreadable coordinate. `Infinity`, `null`, `undefined`, a
  missing half of the pair and a non-number all answer exactly as they did before.
  
  **If you depended on the old rendering**, you were depending on a zero coordinate displaying
  as no coordinate; nothing in this repo did (the sibling `LocationField` already pins the
  opposite — a stored `{ lat: 0, lng: 0 }` renders `0, 0`). A `type: 'geolocation'` record
  holding a zero now shows its coordinates, its accuracy row and its map link.
- 6778809: Key the `type="number"` bad-input refusal — the FIFTH sentence of this class,
  and the only shared one — into the locale packs (objectui#8148).
  
  objectui#6755 ruled that a widget's OWN refusal sentence goes through
  `useFieldTranslation` + `FIELD_DEFAULTS`, and `320374d2a` applied that to
  `LocationField`'s residue arm as the fourth. The four already keyed are each one
  widget's. This one is not: a single literal in `widgets/numberBadInput.tsx`
  produced the sentence for `NumberField`, `CurrencyField`, `PercentField` and
  BOTH of `GeolocationField`'s boxes, through one hook, with five different
  example values.
  
  **The measured consequence is on the geolocation surface.**
  `GeolocationField` sits beside `LocationField`, whose three refusal sentences
  are all keyed, so on the same form two adjacent coordinate widgets refused bad
  input in two different languages — a language switch mid-screen, which reads to
  a user as a bug rather than as a missing translation.
  
  **The example stays a HOLE, and that is the authoring decision this card had to
  make.** Five different values reach the one sentence — `1234`, `1234.56`,
  `12.5`, `30.2741` and `120.1551` — so keying the example per widget would have
  meant five keys across ten packs, and each pack would then hold a decimal
  numeral it could legitimately re-punctuate. A pack writing `1234,56` reads as
  the `latitude, longitude` PAIR the adjacent widget's `fields.location.refusedFormat`
  asks for. With `{{example}}` filled by the widget in ASCII, no pack spells a
  digit at all, and all five values still reach the rendered sentence in every
  language. That property is pinned by name.
  
  **No behaviour moves.** The English value is byte-identical to the literal it
  replaces, so English and provider-less rendering are unchanged — verified
  through the rendered widget for all five boxes, under an `en` provider and with
  no provider at all. objectui#6780's own announce suite keeps every verdict it
  had; it now spells its expected English sentence locally, because the helper
  that composes it takes the widget's `t` and reads
  `fields.number.badInput` rather than building an English string on its own. The
  guard still announces without refusing, and the new key is bound from here on by
  `check:i18n-keys`, `check:i18n-drift` and `all-locales-key-parity` like its four
  siblings.
- 3a3dd28: `LocationField`'s fallback placeholder now speaks the reader's language
  (objectui#8149).
  
  When a `location` field declares no `placeholder`, the box used to show the
  English literal `latitude, longitude`. `320374d2a` had already keyed the two
  coordinate nouns for the widget's residue refusal, so on a Chinese console the
  box said `latitude` while the refusal one line beneath it said the Chinese word
  for the same coordinate. The fallback is now composed from those same keys,
  `fields.location.latitude` and `fields.location.longitude`, which extends
  objectui#6755's principle — a widget's own copy is keyed — to placeholder copy,
  as objectui#3342 did for `TagsField`.
  
  **An authored `placeholder` still wins**, verbatim, in every language.
  
  **The order and the separator stay the widget's.** The box reads what is typed
  by splitting on an ASCII comma and taking the first part as the latitude, so
  the hint's `, ` is input grammar rather than punctuation. A pack-owned joiner
  could have written its own script's comma (fullwidth, ideographic or Arabic),
  each of which the box refuses, and the hint would then have taught a format the
  box will not read. This is objectui#8148's settlement applied to the separator:
  there, no pack spells an example digit; here, no pack spells the separator.
  Every pack already writes its refusal's example pair with the same ASCII
  separator.
  
  **No new keys, and English does not move.** Under `en`, and with no
  `I18nProvider` mounted, the placeholder is byte-identical to the literal it
  replaces.
- a695f50: `@object-ui/i18n` now publishes `TranslateFn` — i18next's `t` narrowed to
  `(key: string, options?: Record<string, unknown>) => string` — as the one
  authority for that name (objectui#8261, on the maintainer's ruling on
  objectui#8165, option A):
  
  ```ts
  import type { TranslateFn } from '@object-ui/i18n';
  ```
  
  `@object-ui/app-shell` (`writeWarningToast`, which its sibling toast modules
  re-export) and
  `@object-ui/fields` (`file-size-guard`) each declared their own copy of this
  type. Both copies were byte-identical to the new declaration, and both modules
  now re-export it from `@object-ui/i18n` instead of declaring it, so every
  existing import of `TranslateFn` from those modules resolves to the same type
  it did before — no call site's contract moves. Neither package publishes the
  name from its own entry; `@object-ui/i18n` is the one place to import it from.
  
  The `TranslateFn` entry in the one-authority gate's `KNOWN_COLLISIONS` baseline
  (`scripts/__tests__/one-authority-per-exported-name-6273.test.ts`) is removed:
  the name now has one declaration.
- 309728c: A `user` reference that resolved to nothing is no longer rendered as a person
  (objectui#8434, routed from cloud#2074).
  
  `UserCellRenderer`'s first branch printed any primitive as plain truncated text
  under the comment *"Primitive value: just display the ID/username as text"*. On a
  `user` field the premise of that comment is wrong: `user` is a lookup specialised
  to `sys_user`, so a primitive arriving there means precisely that nothing turned
  the reference into a person. Printing it as displayable text rendered
  **"resolution failed" as "resolution succeeded"** — and, measured, the cell was
  **byte-identical** to what a `text` cell prints for the same string. The only
  difference from a resolved person was the *absence* of the avatar, which is a
  subtractive signal; a user who has never seen the avatar has no reason to read
  absence as failure.
  
  Such a cell now keeps the raw value **visible** and adds a stated affordance
  beside it: a muted marker glyph plus a sentence ("Unresolved reference: … was
  not resolved to a user", keyed as `detail.unresolvedReference` in all ten locale
  packs). The multi-value shape gets the same treatment, so a `user` field is not
  honest on one input shape and silent on the other.
  
  **The sentence is deliberately epistemic, not ontological.** This branch has two
  populations and the renderer cannot tell them apart — it has no resolver at all,
  unlike `LookupCellRenderer`: an unexpanded `sys_user` id is the *legitimate*
  stored form (`packages/core/src/utils/expand-fields.ts`: "a `user` column that is
  NOT requested for expansion comes back as a raw user id", objectui#2032), and a
  name written into the column is dirty data. A "not found" claim would be false
  for the first, so the affordance states only what is true of both: this screen
  did not resolve it.
  
  **Nothing else moves.** An expanded reference still renders avatar + name; a
  reference object carrying only an id still draws its avatar; `{}` still prints
  the coerced text (objectui#8596's boundary); the save-side `reference_not_found`
  refusal and the edit form are untouched — this change is display-only.
- aa08d7e: Route the `repeater` and `file` cell COUNT labels through i18n (objectui#8441).
  
  The `repeater` cell in the standard renderer table counted its rows with a hardcoded
  Chinese unit word. Two rules broke on that one literal: AGENTS.md #-1 (all user-facing
  text MUST be English) and, the half a translation to English would not have fixed, it
  bypassed i18n entirely — every reader on every locale read it, English ones included,
  beside the English siblings `[Vector]`, `[Grid]` and `FileCellRenderer` on the same
  detail page. It now reads `detail.repeaterItemCount` through `useFieldTranslate`, the
  channel this file already imported and four of its other cells already use.
  
  `FileCellRenderer` moves with it, to `detail.fileCount`. Its `count === 1 ? 'file' :
  'files'` was not a rule violation — it is English — but it was equally unlocalized and
  plural-safe for English only: `ru` has four plural categories and `ar` six, and a
  two-branch ternary can spell neither. Two adjacent cells answering one concept two ways
  is what the single channel closes. **English output is byte-identical**: `2 files`
  stays `2 files`, and the provider-less fallback is pinned byte-equal to the `en` pack.
  
  Both keys are REAL i18next plural families — base + `_one` + `_other` in all ten packs,
  not the two-sibling-key `xxxCountOne` shape. The base key is load-bearing (objectui#3863):
  i18next asks `Intl.PluralRules` for the one suffix a number needs and, finding no slot,
  walks `fallbackLng` to `en`, so without it a Russian reader gets English at counts 2-20.
  
  The `repeater` entry also stops being an inline arrow in `getCellRenderer`'s table and
  becomes a module-level component. That table is rebuilt on every call and both call
  sites resolve inside render, so an inline entry is a fresh component type per render:
  React would remount the cell and tear down react-i18next's language subscription with
  it. No export was added — the published surface is unchanged.
- 2152962: An empty array no longer makes a cell renderer fabricate a value (objectui#8490).
  
  objectui#8481 fixed the shared read renderers whose output for `[]` was *blank*. These
  are the other half of that census: the renderers whose output for `[]` was not blank
  but **wrong** — a value the record does not hold. Measured by rendering on `e411c3e58`:
  
  | field types | renderer | rendered for `[]` before |
  |---|---|---|
  | `boolean`, `toggle` | `BooleanCellRenderer` | a **checked**, disabled checkbox (`aria-checked` true); a completion field drew the green "Completed" indicator |
  | `number`, `slider`, `rating` | `NumberCellRenderer` | the digit `0` |
  | `currency` | `CurrencyCellRenderer` | the digit `0` |
  | `percent`, `progress` | `PercentCellRenderer` | a 0% progress bar with `aria-valuenow` of 0 |
  | `email` | `EmailCellRenderer` | a live anchor whose `href` was `mailto:` with no address, plus a copy button |
  | `url` | `UrlCellRenderer` | a live `_blank` anchor with an empty `href` |
  | `phone` | `PhoneCellRenderer` | a live anchor whose `href` was `tel:` with no number |
  | `color` | `ColorSwatchCellRenderer` | a bordered swatch box with no colour and an empty hex span |
  | `date` | `DateCellRenderer` | a hand-rolled em-dash with no accessible name (not the shared placeholder) |
  
  All of them now render the shared `EmptyValue` affordance — the muted em-dash with a
  `No value` accessible name — exactly as they already did for `null`.
  
  **The ruling is per renderer, not one predicate.** A boolean cell is not a text cell:
  `[]` holds no boolean, so the column holds *no value*, not `false` — a real `false` is
  still an unchecked box, and only `[]` moves (scalar truthiness coercions are untouched).
  The number family's `0` was `Number('')`, a coercion artefact rather than a stored zero,
  so its guard is now on the coerced *text* — which **deliberately also sweeps a stored
  `''`** (the same fabrication one input shape over); a real stored `0` still prints. The
  link family draws no anchor when there is nothing to link to; `color` draws no swatch
  without a colour string; `date` reaches the shared affordance instead of `formatDate`'s
  private dash.
  
  **Deliberately narrow.** `{}` is untouched everywhere, `json` still draws the array
  literal and `file` still states `0 files` (the objectui#8481 fence), and whether a
  non-boolean *scalar* in a boolean column should surface as a coercion error is a separate
  question this change does not answer.
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
- 3e71b26: `markdown`, `html` and `richtext` cells no longer draw a childless container for `[]` or the literal `[object Object]` for `{}` (objectui#8580).
  
  Third part of the empty-array census: objectui#8481 moved the three multi-value renderers whose output for `[]` was blank, objectui#8490 the nine that fabricated a value. Measured by rendering every registered field type on `7102b20d9`, this family was what remained of the blank class:
  
  | field types | renderer | rendered for `[]` before | rendered for `{}` before |
  |---|---|---|---|
  | `markdown` | `MarkdownCellRenderer` | a childless `prose` block (its loading fallback a childless span) | a paragraph reading `[object Object]` |
  | `html`, `richtext` | `HtmlCellRenderer` | a childless `prose` block | the text `[object Object]` |
  
  **Two defects, two rulings.** `@objectstack/spec` types all three fields as a plain string (`STRING_VALUE_TYPES`), in the same value class as `text` / `textarea` / `code`, and neither shape is a value of that class:
  
  - `[]` now renders the shared `EmptyValue` affordance — the muted em-dash with a `No value` accessible name — exactly as `null` and `''` already did, and as its twelve siblings do. It holds no string and nothing to format.
  - `{}` is **not** swept into the affordance (the record is storing something, so "No value" would be false) and is no longer `String()`'d. The three types now coerce exactly as the text class does (`coerceToSafeValue`): an object carrying a display name renders that name; a bare `{}` renders `[Object]`, the same text a `text` cell shows for it. A one-entry array formats its one entry, as `email` links its one address.
  
  Populated values are untouched: a stored string reaches each pipeline verbatim, so `html` / `richtext` run through the same sanitiser on the same bytes (pinned byte-for-byte), and `markdown` still drops raw HTML.
  
  `coerceToSafeValue` moved into its own module inside the package so the rich-content display module can share it without importing the barrel; it is still exported from `@object-ui/fields`, unchanged.
- b89583b: `DateCellRenderer`: an unparsable date value renders the shared `EmptyValue`
  affordance instead of `formatDate`'s hand-rolled em-dash (objectui#8581).
  
  A `date` column holding `not-a-date` used to reach `formatDate`, which returns
  its own `'—'` for any value whose `new Date(...)` is invalid, and the renderer
  wrapped that string in a span classed `tabular-nums`. The result was naked
  punctuation: no `data-slot` of `empty-value`, no accessible name — the same
  defect class as objectui#8475 (`RelatedList`) and objectui#8491 (`ObjectGrid`).
  objectui#8490 routed this renderer's coerced-EMPTY input (`[]`, `''`,
  whitespace) to the shared affordance and left this input for its own card.
  
  The guard is now spelled exactly as `DateTimeCellRenderer`'s one function down
  — the nearest sibling, which answers the identical input and has returned
  `EmptyValue` all along. The two date renderers no longer disagree about the
  same value, and that agreement is measured in the pin, not asserted.
  
  **Visible change.** An unparsable value now reads "No value" to a screen reader
  and is muted like every other empty cell. The raw string that was reachable on
  hover through that span's `title` is gone on this branch only — nothing in the
  tree read it (searched with lit controls before the change). A PARSEABLE value
  is untouched: it keeps its formatted face, its overdue colour and its ISO
  `title`. A numeric epoch timestamp still renders — the guard reproduces
  `formatDate`'s own parse, so it is co-extensive with the dash it replaces and
  never wider.
- 70c4523: `BooleanCellRenderer` no longer reads a non-boolean scalar by truthiness (objectui#8582).
  
  objectui#8490 ruled that a boolean column holding `[]` holds **no value** and deliberately
  left every other non-boolean input on the old coercion. This takes that untouched half.
  Measured by rendering on `2a38862f5`:
  
  | stored value | rendered before | rendered now |
  |---|---|---|
  | the string `'false'`, the string `'0'`, `{}` | a **checked**, disabled checkbox | the shared `EmptyValue` affordance |
  | `'false'` on a completion field (`completed`, `done`, …) | the green "Completed" indicator | the affordance |
  | `'false'` on a status field (`active`, `enabled`, …) | a **checked** checkbox, no "Off" badge | the affordance |
  | `0`, `''` | an **unchecked** checkbox | the affordance |
  | `0` on a status field | the destructive "… — Off" badge | the affordance |
  | `'true'`, `'1'`, `1` | a checked checkbox | the affordance |
  | a real `true` / `false` | checked / unchecked | **unchanged** |
  
  **The ruling is the spec's.** `@objectstack/spec` declares the runtime value of `boolean` /
  `toggle` as a bare `z.boolean()` — "a JS boolean on the wire (driver read-coercion repairs SQL
  0/1)", stored "never text on any backend". The truth table that turns `'true'` / `1` / `'0'`
  into a boolean already lives at the producer boundaries (objectql's read-path
  `coerceBooleanFields` and its `invalid_boolean` write refusal, `rest`'s CSV `parseBooleanCell`),
  so a non-boolean that reaches the renderer is a producer that skipped its repair, and a second
  copy of that table in the renderer would be the lenient dialect the contract forbids. Only a
  real boolean is a value of a boolean column; everything else renders the affordance, whose
  accessible name "No value" is a statement about the field's type.
  
  **Declared, not smoothed.** `{}` and `'false'` now land on the same affordance for the same
  reason, and neither is "checked". The affordance does not say *which* wrong-typed value the
  column holds — surfacing that is the write path's job, not the read renderer's. A consumer
  that fed this renderer `1` / `0` or `'true'` / `'false'` from a backend of its own now sees the
  affordance instead of a box: coerce at the data source, where the platform does.
- 64f1cf1: `BooleanField`'s readonly branch no longer reads the value by truthiness (objectui#8593).
  
  objectui#8582 ruled, on `@objectstack/spec`'s value contract, that only a real boolean is a
  value of a boolean column and moved `BooleanCellRenderer` off truthiness. This takes the same
  reading one surface over: the read-only branch of the edit widget that `FieldEditWidget`
  registers for `boolean` / `toggle` and every generated form renders for a readonly boolean.
  Measured by rendering on `21529629c`:
  
  | stored value | readonly widget said before | says now |
  |---|---|---|
  | the string `'false'`, the string `'0'`, `{}`, `[]` | **Yes** | the shared `EmptyValue` affordance |
  | the string `'true'`, the string `'1'`, `1` | Yes | the affordance |
  | `0`, `''` | **No** | the affordance |
  | `null`, `undefined` | No | the affordance |
  | a real `true` / `false` | Yes / No | **unchanged** |
  
  **The ruling is the spec's.** `@objectstack/spec` declares the runtime value of `boolean` /
  `toggle` as a bare `z.boolean()` — "a JS boolean on the wire (driver read-coercion repairs SQL
  0/1)", stored "never text on any backend". The truth table that turns `'true'` / `1` / `'0'`
  into a boolean already lives at the producer boundaries (objectql's `coerceBooleanFields` and
  its `invalid_boolean` write refusal, `rest`'s CSV `parseBooleanCell`), so a non-boolean that
  reaches the widget is a producer that skipped its repair, and a second copy of that table in
  the widget would be the lenient dialect the contract forbids.
  
  **Both directions.** The truthy non-booleans said "Yes" — an affirmative the record never
  made — and the falsy ones, plus a missing value, said "No", a negative it never made either.
  The widget has no status-name badge, so unlike the cell renderer the fabricated "No" weighed
  no more than the fabricated "Yes"; both now land on the affordance.
  
  **Why `EmptyValue`.** It is this directory's own convention: every sibling widget with a
  readonly branch and a nullable value (`NumberField`, `CurrencyField`, `PercentField`,
  `DateTimeField`, `EmailField`, `PhoneField`, `RadioField`, `ObjectField`, …) draws it for the
  absent case, and the cell renderer happens to draw the same component — the two surfaces agree
  by convention, not by import. A consumer that fed the widget `1` / `0` or `'true'` / `'false'`
  from a backend of its own now sees the affordance instead of a word: coerce at the data source,
  where the platform does.
- da5e4f6: An object literal is no longer drawn as an invented identity in six cell-renderer
  families (objectui#8596).
  
  Measured by rendering all 53 registered field types through `getCellRenderer` against
  `[]`, `{}`, `''` and `null` — 212 cells — before and after. **14 cells moved, all in the
  `{}` column**; the `[]`, `''` and `null` columns are byte-identical.
  
  | field types | `{}` drew | `{}` now draws |
  |---|---|---|
  | `email` / `url` / `phone` | a live anchor — `mailto:[Object]`, `tel:[Object]` — plus a copy button | `[Object]`, exactly as `text` prints it |
  | `color` | a swatch whose `background` was the string `[object Object]` | `[Object]`, exactly as `text` prints it |
  | `select` / `status` / `multiselect` / `radio` / `checkboxes` / `tags` | a badge reading `[Object Object]` | a badge reading `[Object]` |
  | `user` | an avatar captioned `U`, labelled `User` | `[Object]`, exactly as `lookup` prints it |
  | `file` / `video` / `audio` | a chip named `File` | the shared "No value" affordance |
  
  The direction is the spec's, per family, not one sweep. `email` / `url` / `phone` /
  `color` are `STRING_VALUE_TYPES` ("Value is a plain string") — the same set whose `{}`
  ruling landed for `markdown` / `html` / `richtext`: the record IS storing something, so
  it prints the family's existing coercion rather than the "No value" affordance, and
  draws no affordance that asserts more (a `mailto:[Object]` cannot send mail; a copy
  button offers `[Object]` to the clipboard; `background: [object Object]` is a
  declaration the browser drops). The option families resolve to a string code, so the
  same coercion answers them and the badge stays. `user` shares its `valueSchemaFor` arm
  with `lookup`, which already answered an object it cannot name with the coerced text.
  
  `file` / `video` / `audio` are the family whose answer differs, and the spec names the
  input: the media value schema makes `url` its one required member and rejects "an empty
  object", so `{}` is a value of neither the stored nor the expanded form — the record
  holds no file, and "No value" is true of it. `image` / `avatar`, the same spec family,
  already answered `{}` that way.
  
  Deliberately not swept: `boolean` / `toggle` (already fixed), the declared json-literal
  fence on `location` / `geolocation` / `json` / `object` / `composite` / `record`, the
  `date` renderer's own dash, arrays (a one-entry array still coerces and still links), and
  any object carrying a member — a `{ name: 'contract.pdf' }` attachment and a
  `{ id: 'u_1' }` reference render exactly as before, so real data is never hidden.
- 88a629d: A `signature` cell holding `{}` now prints `[Object]`, as every other member of its
  value class does, instead of the "No value" affordance (objectui#8677).
  
  `@objectstack/spec` places `signature` in `STRING_VALUE_TYPES` ("Value is a plain
  string" — the stored value is a data-URI PNG), not in the file-reference class with
  `image` and `avatar`. objectui#8580 ruled the cell output of that class's empty-shaped
  values and objectui#8596 applied it to the rest of the class: `[]`, `''` and `null`
  draw the shared affordance, and `{}` prints the coerced text exactly as `text` prints
  it, because the record is storing something. `signature` was registered straight to
  `ImageCellRenderer`, whose answer for a value with nothing to draw is the media rule —
  "No value" — so it was the one member of the class still drawing the affordance for
  `{}`.
  
  `getCellRenderer('signature')` now resolves to a signature cell with two arms. A value
  the image cell can draw — the stored data-URI string, and the URL and file-reference
  shapes it already resolved — renders exactly as before, byte-equal to what `image`
  draws. Anything else is read the way the string class reads it: `[]`, `''` and `null`
  still draw the affordance (the same bytes as before), and `{}` prints `[Object]`. An
  object the image cell cannot draw but that carries a display name now prints that
  name, and a stray number prints as text, both as `text` prints them.
  
  `image` and `avatar` are unchanged: they are file references, and "No value" is their
  correct answer to `{}`. No export was added or removed.
- cdd2542: fix(fields): an empty `password`, `secret`, `vector` or `grid` cell now says "No value"
  
  These four cell renderers never read their value. `password` and `secret` drew
  the six-dot mask and `vector` and `grid` printed `[Vector]` and `[Grid]` for every
  input, `null` included. A credential that was never set therefore looked exactly
  like one that is set wherever the cell is drawn for an empty value, such as an
  `ObjectGrid` column.
  
  An empty value now renders the shared `EmptyValue` affordance, whose accessible
  name is "No value":
  
  - `password` / `secret` use the string class's rule, the same one `text` applies:
    `null`, `undefined`, `''` and `[]` are empty. `{}` and a whitespace-only string
    are stored values and keep the mask.
  - `vector` / `grid` use the shared emptiness floor: `null`, `undefined`, `''` and
    `[]`.
  
  A stored value renders exactly what it rendered before: the same mask, the same
  literal. The value of a `password` or `secret` is still never printed.
- 0eaed83: The readonly `date` widget faces draw `formatDate`'s em-dash through the shared
  `EmptyValue` affordance instead of a plain span (objectui#8809). Two sites:
  `DateField`'s readonly branch and `FormulaField`'s `return_type: 'date'` path.
  
  ⚠️ **Dated note, 2026-09-30 — the formula key above has since been renamed —
  objectui#11070.** "`FormulaField`'s `return_type: 'date'` path" above held when this change
  landed. Later in this same release objectui#11070 (round 3) moved `FormulaField` to
  `@objectstack/spec`'s `returnType` and retired the `return_type` read, so that path is the
  one a formula declaring `returnType: 'date'` takes.
  `.changeset/11070-field-metadata-spec-spellings.md` states what ships; the text above is
  kept as the reading of this change.
  
  A truthy value `new Date(...)` cannot read — `not-a-date`, `2024-13-45` — used
  to reach `formatDate`, which answers it with its own em-dash, and that dash was
  painted in a span with no `data-slot` of `empty-value` and no accessible name.
  A screen reader got naked punctuation. Same defect class as objectui#8475
  (`RelatedList`) and objectui#8491 (`ObjectGrid`).
  
  **The glyph does not change.** `EmptyValue`'s own default glyph is that same
  em-dash, so the rendered text is identical and only the carrier moves: the dash
  now has `data-slot` of `empty-value` and reads as "No value" (localized) to
  assistive technology, muted like every other empty affordance.
  
  That distinction is deliberate. objectui#8194 enumerated the four `formatDate`
  sites, fed each the same unparsable value and split them 3-1 on purpose —
  `GridField` keeps the raw stored string (objectui#3569, "showing the user what
  is actually stored beats hiding it"), the other three inherit the shared empty
  face. This change preserves that split rather than reopening it, and #8194's
  three landed assertions stay green because they read rendered text.
  
  A PARSEABLE value is untouched — it keeps its formatted face and carries no
  affordance. The guard reproduces `formatDate`'s own parse, so it is
  co-extensive with the dash it replaces and never wider.
  
  Not swept in: the `$date` lookup fallback draws the same dash but returns plain
  text rather than an element, so converging it is a decision about that
  function's contract; and `GridField` is on the other side of the #8194 split.
- 2e97c8c: `file-size-guard`'s docblock no longer restates a built-in locale count, and points at the
  test that re-derives it (objectui#9615).
  
  The shared `fields.file.exceedsMaxSize` docblock asserted that the key was already
  translated in all **11** built-in locales. `@object-ui/i18n` ships ten —
  `BUILT_IN_LANGUAGE_CODES` and the `@object-ui/i18n/locales` map agree on
  `en zh ja ko de fr es pt ru ar`, and `readme-locale-count-7989.test.ts` asserts that
  agreement. This is not an internal note: the docblock is emitted into
  `dist/widgets/file-size-guard.d.ts`, which is in this package's `files`, so the false count
  went out in every tarball and is what a consumer's editor shows on hover.
  
  Correcting the numeral to ten was weighed and refused. A restated count is the construct
  that permitted the error, and this repository has now watched it recur three times over the
  same fact — objectui#3351 in a changeset file, objectui#7989 in `packages/i18n/README.md`,
  and this one in published source. So the number is **gone** rather than corrected: the
  sentence now claims only what it needs (the key is translated in every locale the package
  ships) and names `all-locales-key-parity.test.ts` as the instrument that re-derives it.
  That test asserts the stronger invariant — every pack defines every `en` key — over
  whatever the pack set is on the day it runs, so an eleventh pack makes the sentence more
  true rather than false, and there is no figure left to rot (AGENTS.md commandment #9).
- e22fa12: Stop a declared percent `scale` above the engine's fraction-width ceiling from
  crashing the render, on both percent faces (objectui#9808).
  
  The `@objectstack/spec` this repository installs accepts `scale` as any
  non-negative integer, so `scale: 101` is a declaration the platform takes — and
  it threw `RangeError` out of `PercentField` (the readonly face and the spinner
  `step`) and out of `PercentCellRenderer` (through `formatPercent`), which for a
  React render takes out the subtree with no signal to the author.
  
  Both faces now take one ruling: a width the installed spec ACCEPTS and the
  engine REFUSES is clamped to the ceiling and reported on the console, naming the
  declared width, the width rendered and the card. The ceiling is the formatters'
  own — `Number.prototype.toFixed` and `Intl.NumberFormat`'s
  `maximumFractionDigits` share it on the integers — not a policy this renderer
  invented, which is why a refusal was declined: refusing a declaration the
  contract accepts would be a renderer inventing a stricter contract than the one
  it is built against.
  
  The ruling reaches exactly that set and nothing else. A negative, non-finite or
  non-integer `scale` is a declaration the installed spec already REFUSES, so it
  keeps the behaviour it had before this change rather than being rescued here:
  making off-spec metadata render is the renderer-side default AGENTS.md #0.1
  lists by name, and the place to repair such a declaration is the producer that
  wrote it. A width the engines already accept is likewise untouched, including at
  the inclusive ceiling.
  
  Nothing here changes which member a face reads or what an absent `scale` means.
  
  The ruling sits behind `formatPercent`, so this also widens what that published
  function ACCEPTS for the clamped set: widths that threw now return a string, and
  every caller of that door — the percent cell, the metric widget, the
  record-field and detail summaries, the Gantt tooltip, the grid footer and the
  column summary — moves from crash to clamp-and-report. Same ruling, wider reach
  than the two percent faces. No new symbol is published: the shared rule lives in
  a module the package barrel imports and does not re-export, the shape
  `address-format` and `file-affordance` already use here.
  
  SUNSET, recorded because this repair's justification has an expiry date, and
  pinned because a recorded sunset that nothing re-derives is how an expired
  premise goes on reading like a live one. The clamp is defensible only while the
  spec this repository INSTALLS leaves `scale` unbounded. The trigger is therefore
  a spec release this repository takes — not the upstream card landing, which has
  already happened (objectstack#18972, landed as objectstack#19083) and changed
  nothing here, because the bound is merged and unreleased at the installed
  17.4.0. On the day a bump brings it in, the clamp becomes exactly the lenient
  renderer-side fallback #0.1 bans, and the module is to be deleted rather than
  kept beside the enforced contract. The percent pin file asks the installed
  `FieldSchema` that question on every run and fails with those instructions.
  
  ⚠️ **Dated note, 2026-09-29 — the SUNSET above fired in this same release — objectui#11073.**
  Later in this release this repository began resolving `@objectstack/spec` 17.5.0, which bounds `scale` at 100: a percent field declaring `scale: 101` is now refused at the declaration (`too_big` at `scale`). That is the condition the SUNSET paragraph names, and it fired as written. The clamp, its console warning and the module that held them are deleted, and `formatPercent` and both percent faces pass the declared width through again. So what this release ships is the spec's refusal at the declaration, not the clamp-and-report described above, and `formatPercent` no longer returns a string for a width the engine refuses.
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
- 968dc1e: The option widgets and the lookup read `dependsOn` through the declared type.
  
  `SelectField`, `MultiSelectField`, `RadioField` and `CheckboxesField` now read the
  cascade key as `field.dependsOn` — `BaseFieldMetadata.dependsOn` — instead of
  through an `as any`; `LookupField` reads both of its spellings (`depends_on`, then
  `dependsOn`) through `LookupFieldMetadata`. Behaviour is unchanged: a select whose
  metadata carries `dependsOn` still gates and prunes its options, a lookup still
  scopes its candidate queries, and the metadata key still wins over the `dependsOn`
  widget prop. What changed is that a wrong spelling or shape at the read site is now
  a compile error rather than a silent no-op. objectui#6153.
- a865c73: Grid field widget: announce a form-level validation failure to assistive tech.
  
  A required `grid` submitted while still empty rendered its "is required" message
  but marked nothing — every row was a ghost row, and ghost rows were skipped by
  the widget's per-cell validity channel. A sighted user saw the red message; a
  screen-reader user was told nothing at all.
  
  The host failure now drives the per-cell channel the widget already owns: when
  the `error` slot is set on an empty grid, the ghost entry row's required cells
  flag, and the mark sits on each cell's own control rather than on the `td`
  wrapper (a `td` is not focusable, and assistive tech reads validity from the
  control). Populated grids are unaffected — they already marked their own empty
  required cells inline.
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
- e4e9557: A multi-value lookup cell no longer grows its row without bound: `LookupCellRenderer`
  now shows at most 3 chips and collapses the rest into one muted `+N` chip, the same
  cap `UserCellRenderer` has always applied to its avatar stack in the very same file.
  
  Previously the array branch rendered EVERY referenced record as its own chip inside a
  `flex-wrap` container. In a grid column that wraps to one chip per line, so a cell
  referencing a large set — a production 排班计划 row referencing 60+ work objects — grew
  a single row to several screens of height and blew the page layout apart. The same
  uncapped rendering reached every surface that resolves through `getCellRenderer('lookup')`:
  grid, related lists, gallery, kanban, report and dashboard tables, and the record detail
  sections.
  
  The collapsed names stay reachable: the `+N` chip's `title` lists the display names of
  the hidden references (resolved through the same option/label/record-name path as the
  visible chips), and the record's own detail view remains the place to see the full set.
  The first 3 chips keep their per-record links (#4336) and their resolution order —
  nothing changes for cells with 3 or fewer references.
- 7a28e1e: A lookup's inline dropdown renders its columns through the same cell renderer the browse-all picker uses, so one `lookup_columns` declaration cannot produce two answers.
  
  A form's lookup field offers two ways to pick a related record, and both read
  the same declaration: the inline dropdown under the field, and the
  "browse all records" picker behind it. The picker resolved every cell through
  the type-aware cell renderer. The dropdown did not — it printed
  `record[descriptionField]` verbatim into the option subtitle and concatenated
  `label: String(rawValue)` into the row's `title` attribute. Measured on the
  same declaration, on a real 17.1.0 deployment:
  
  ```
  column          inline dropdown (before)          browse-all picker
  lookup          T5MsMCuwP4t_yUHq (bare FK id)     the related record's name
  date            2026-08-20T00:00:00.000Z (ISO)    a formatted date
  select          pending (enum code)               the authored option label
  ```
  
  Both surfaces now call one shared module — `widgets/lookupColumnDisplay.tsx`,
  which owns column normalisation, the field-descriptor enrichment from the
  referenced object's schema, and the render itself. The picker's own
  `renderCellContent` and `columnFieldDescriptors` are now thin calls into it, so
  there is a single renderer left to drift from. The dropdown's extra columns are
  rendered into the option row itself; the row's `title` keeps the full option
  label, which is what a truncated label needs, instead of a raw-value dump.
  
  This change touched no query and widened no contract. `lookupColumns` entries
  stay bare field names — no dot paths, no populate/expand semantics — because
  at the time neither surface's request carried populate: the picker resolved a
  foreign-key id to a name client-side, in the lookup cell renderer, and the
  dropdown inherited exactly that. A later change (objectui#10223) has both
  requests ask for `$expand` on the reference columns they display, minus any
  the loaded permission policy denies, and another (objectui#10373) stops both
  surfaces from drawing a column that policy denies or showing a field it denies
  in a record's title. A readable value that still arrives as a bare id is
  resolved by that same cell renderer. An unresolved reference therefore renders
  what the picker renders for it, and keeps its column: among the columns the
  policy lets the user read, a slot is dropped only when the record holds no
  value for the field, decided on the raw value and never on what the renderer
  makes of it, so an unresolved id can never degrade into a silently empty
  column.
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
- b6e83be: **Bug — a `code`/`text` value whose text is JSON rendered as the literal `[Object]`.** `coerceToSafeValue` classified strings by SHAPE: any string starting `{`/`[` and ending `}`/`]` was `JSON.parse`d and the result run through the reference-label extraction (`name || label || externalId || id || _id || '[Object]'`), which answers the placeholder for an object carrying none of those keys. Every text-like cell reaches that helper — `text`, `textarea`, `code`, `time`, `auto_number` and `qrcode` all register to `TextCellRenderer` — so a stored `{"ok": true}` displayed as `[Object]`, and `[1, 2, 3]` in a text field displayed as `1, 2, 3`.
  
  A string is now returned verbatim, whatever its shape. The reference case the parse was written for (an unresolved external-id reference arriving as `'{"externalId":"…"}'`) belongs to reference-TYPED columns and is already handled there: `LookupCellRenderer` carries its own JSON-string branch, which resolves the label through the referenced object's schema and links to the record — neither of which the type-blind helper could do. The behaviour is scoped to the column type that owns it, not dropped. Object and array VALUES still coerce, so React error #310 stays fixed.
- 4bb940b: A readonly `markdown` / `html` / `richtext` form field now renders its content
  FORMATTED instead of showing the user its markup source.
  
  `RichTextField`'s readonly early return rendered `{value}` as a React text child,
  so a readonly field of any of those three types displayed the stored markup as
  literal characters — a markdown field's asterisks and hashes, a richtext field's
  tags. The `prose` classes on that wrapper were the tell: they style rendered rich
  content, and there was none to style. Every other read surface — grid, kanban
  card, gallery, related list, dashboard record panel and the record detail page's
  read mode — dispatches through `getCellRenderer` and rendered the same stored
  bytes formatted, so one field disagreed with itself depending on which surface it
  was read on.
  
  The readonly branch now renders through the same components `getCellRenderer`
  resolves: `markdown` through the GFM renderer, `html` and `richtext` through the
  sanitizing HTML renderer. The two renderers moved out of the package barrel into
  `widgets/richTextDisplay.tsx` so the widget can reach them without importing the
  barrel back, and both sides now read one shared type-to-renderer table rather
  than two that can drift apart.
  
  The editor header's format label is fixed with it: it was computed as
  `field.format || 'markdown'`, and `format` is declared on `date` / `datetime` /
  `time` / `phone` / `auto_number` and on no rich-content type — so it read
  `undefined` for every real field and labelled an `html` field "Format: markdown".
  The label is now derived from the field type's display pipeline, so it names the
  syntax the value is actually stored in.
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
- f1690d4: A populated `richtext` field no longer renders as a blank cell (objectui#5452).
  
  `richtext` stores HTML — the spec documents the type as "Formatted content with
  HTML/WYSIWYG", the showcase seed's own specimen is `<p>Rich <strong>text</strong></p>`,
  and this repo's designer bridge already maps `richtext` onto its `html` type. The
  display registry nevertheless dispatched it to `MarkdownCellRenderer`, whose
  sanitizing GFM pipeline runs react-markdown with no `rehype-raw` and therefore drops
  raw HTML. Because a richtext value is *entirely* HTML, everything was dropped and the
  cell body came out empty — with no error, no fallback and no console warning, so a
  populated field read as an empty field and anyone auditing data through a grid
  concluded the records were blank. Measured on the same stored bytes, a neighbouring
  `html`-typed column rendered them correctly, which is what ruled out "the value never
  arrived".
  
  `richtext` now resolves to `HtmlCellRenderer`, which sanitizes with `sanitizeHtml`
  (script/style/iframe/object/embed blocks, inline event handlers and `javascript:`
  URLs removed) and keeps everything a rich-text editor legitimately emits — headings,
  paragraphs, emphasis, lists, links, quotes. One map entry fixes every read surface at
  once: the grid, the kanban card, the gallery, the related list, the dashboard record
  panel and the record detail page all resolve their read-mode cells through this same
  `getCellRenderer`.
  
  The markdown pipeline is untouched. Passing raw HTML through it would have "fixed"
  one type by moving every `markdown` cell's trust boundary, so `markdown` still drops
  raw HTML — pinned alongside the fix, on the same bytes `richtext` must now render.
- 982885d: fix(fields): a zero-option `field:select` keeps its label association
  
  A registered `field:select` whose option list resolved empty rendered the
  shared `OptionsEmptyState` box and returned before its DOM pass-through, so the
  host's `…-form-item` id reached no element at all and the visible label's `for`
  DANGLED. Measured on a real form: `HTMLLabelElement.control` was `null`, the
  rendered `<FormDescription>` had zero consumers, and `getByLabelText` threw
  "however no form control was found associated to that label" — an error that
  reads like a broken renderer against a correctly rendered empty state.
  
  The widget declares `labelling: 'control'`, which the registry defines as "the
  component's outermost rendered element is a LABELABLE HTML element". That is
  true of the Radix `button[role="combobox"]` it renders with options and was
  false of the `div` it rendered without them. The zero-option box is now an
  `<output>` — labelable, and a role that claims no interactivity — carrying the
  host id and `aria-describedby`. The label's `for` resolves, the box is named by
  the label and described by the help text, and nothing on the host side moved.
  
  Landing the id on the `div` instead was measured and rejected: `for` may only
  reference a labelable element, so the pointer stopped dangling while the label
  stayed exactly as unusable. Declaring `select` as `labelling: 'group'` was also
  measured and rejected: it moved the LIVE path (a select WITH options lost its
  working `<label for>` to the combobox) and still left the zero-option branch
  with no association.
  
  Breaking-ness: none intended, and none published — the repaired surface is the
  rendered element of one widget state. Apps or tests selecting that box by its
  `data-testid` are unaffected; any that asserted the literal `div` tag name will
  see an `<output>`.
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
- Updated dependencies [a1c41c5]
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
  - @object-ui/permissions@17.7.0
  - @object-ui/providers@17.7.0

## 17.6.0

### Minor Changes

- a09bc33: fix(fields): render the option colour an author declared as an explicit hex, instead of quantizing it to nine palette families (objectui#5141)
  
  `options[].color` accepts any hex, but the badge renderer answered a lossy
  question with it: `hexToPaletteName` bucketed the value by hue into nine
  families (`red`/`orange`/`yellow`/`green`/`blue`/`indigo`/`purple`/`pink`, plus
  `gray` below 22% saturation), and `BADGE_COLOR_MAP` held exactly one class set
  per family. Two tiers an author declared as distinct therefore rendered
  byte-identical: `#2ecc71` ("in progress") and `#1e8449` ("completed") differ by
  0.1 degree of hue, both landed in `green`, and both emitted
  `bg-green-50 text-green-700 border-green-200`. Pressing the second colour darker
  still changed nothing. End users could not tell the two states apart in a list.
  
  `plugin-gantt` had already settled this class of conflict the other way —
  *explicit colorField value (hex or semantic name) — metadata wins* — and
  Studio's own option editor paints the author's swatch straight from the raw hex.
  Badges were the odd surface out.
  
  Now an explicitly declared hex is rendered as declared: the soft-pill surface,
  label and border are derived from that hex rather than snapped to a family, for
  both `appearance: 'badge'` and `appearance: 'dot'`.
  
  Two properties the family maps gave us for free are kept deliberately:
  
  - **The design system keeps control of theming.** The derived colours are
    published as CSS custom properties and consumed by *static* Tailwind
    utilities, so light and dark remain ordinary `dark:` variants
    (`.dark\:bg-...:where(.dark, .dark *)` in the built sheet) rather than a
    hard-coded inline background that would render identically in dark mode.
    Tailwind cannot generate a class for a runtime value, so the custom property —
    not the colour — has to be the dynamic part.
  - **Contrast is pinned, not just colour identity.** The label is the lightness
    along the declared hue nearest the declared one that still clears WCAG AA
    (4.5:1) against the surface actually rendered. Authors can and do declare
    colours that are unreadable under a label; honoring the declaration must not
    turn legibility loose across every list view. Dots are held to 1.9:1 against
    the row, the measured floor of the `-500` shades shipped today.
  
  **What changes for an author relying on the current look:** every select/status
  badge whose option colour is declared as a hex — which the renderer's own notes
  describe as almost all of them — will render in that declared colour rather than
  its palette family's fixed pill. Colours near a family's canonical shade look
  much as before; a colour the author picked deliberately *away* from it (a deep
  green, a muted red) now looks like what was written, and the pill's depth tracks
  the declared lightness. Declarations that are not an explicit hex are untouched:
  family names, the semantic value map and the deterministic hash fallback all
  resolve exactly as they did, and `getSemanticColorName` still returns family
  names, so the Gantt path is unaffected.
  
  The badge classes exported by `getBadgeColorClasses` are unchanged, so callers
  that consume only a class string (the grid's compact card view and group-header
  pills, Kanban) keep today's quantized rendering until they adopt the new
  `getBadgeHexAppearance` / `getDotHexAppearance` helpers.
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

### Patch Changes

- 69251bf: `AddressField` is translatable, shows no US example placeholders, and formats its readonly line in the reader's address order.
  
  The five sub-labels ("Street Address", "City", "State / Province", "ZIP /
  Postal Code", "Country") were English string literals with no i18n key. On a
  non-English console every address field showed five English words in the middle
  of an otherwise fully translated form, and an app had no way to reach them: the
  parts are not fields on the object (`billing_address` is a single `address`
  column), so a translation bundle had nothing to key on, there is no `subLabels`
  property to declare, and the widget cannot be replaced from metadata. They now
  resolve through `fields.address.street` / `.city` / `.state` / `.postalCode` /
  `.country`, added to all ten locale packs. The `en` values are byte-identical to
  the literals they replace, and `FIELD_DEFAULTS` carries the same five, so
  English and provider-less rendering are unchanged.
  
  The five input placeholders (`123 Main St`, `San Francisco`, `CA`, `94102`,
  `United States`) are **removed** rather than keyed. They were untranslated and
  US-specific — a zh/ja/ar user was shown an American address as the example of
  what to type — and the right example is a function of the address's country,
  not the reader's language, which no channel in the stored value can supply
  today. Each box keeps the visible label that names it.
  
  The readonly line's part order now follows the reader's display locale
  (`useDisplayLocale()`): `zh`, `ja` and `ko` read largest-first (`Country, ZIP
  State, City, Street`), every other locale keeps the unchanged small-to-large
  order (`Street, City, State ZIP, Country`). The display cell renderer takes the
  same locale through the same shared `formatAddress`, so a stored address reads
  identically in a readonly form and in a grid cell.
- 0ae27f7: The form renderer's built-in `textarea` branch now honours a declared character cap the same way the registered `field:textarea` widget does.
  
  One `maxLength` declaration produced two experiences. The registered path has
  shipped four things since objectui#3406/#3408/#3417 — the native cap, visible
  `{n}/{max}` digits, a description reached through `aria-describedby` so the
  limit is announced on focus, and a threshold-gated debounced near-limit notice.
  The built-in branch — the path standalone and embedded hosts take, the ones that
  call no `registerAllFields()` — shipped a subset of one of them.
  
  The accessibility half is the half that mattered: a screen-reader user on this
  path learned the field's limit only as a validation error AFTER submitting. All
  four affordances now render on both of the branch's surfaces (the inline control
  and the fullscreen dialog), from the SAME `CharacterCount` component the widget
  renders rather than a second copy of it.
  
  Also fixed, and wider than the visible gap: the branch never READ the cap, it
  only spread its leftover field props onto the element. A camelCase `maxLength`
  therefore worked by coincidence — it names a real DOM attribute — while the
  legacy `max_length` spelling, which the registered widget and all three
  producers of a form field have dual-read since framework#1878 §3, landed as a
  stray inert `max_length="…"` attribute and capped nothing at all. The branch now
  resolves both spellings and keeps the non-attribute spelling off the DOM.
  
  `CharacterCount` moved from `@object-ui/fields` to `@object-ui/components`, the
  package both render paths may import, in the direction and for the reason
  objectui#3398 measured for `FullscreenEditor`. It was internal to `fields` (never
  exported from that package's barrel), so no published export changed; it is a
  new export of `@object-ui/components`. Its copy moved with it onto the same
  `fields.textarea.*` keys with byte-identical English defaults, so the ten locale
  packs need no edit and provider-less rendering is unchanged.
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
- 65e88e6: `@object-ui/fields` stops publishing its `src/` tree
  
  The manifest's `files` array listed `src` alongside `dist`, so every published tarball carried all 173 source files — 97 of them `*.test.tsx` / `*.test.ts`. It has been that way since the file's first commit (`780a1b993`), where `files` was already `["dist", "src", "README.md"]` while `exports` named only `dist`, so the entry was never added for a consumer. objectui#4006 recorded this exact shape and did not act on it: its scope was the `*.test.d.ts` half the build program emitted into `dist`, and it noted in passing that the test sources were already in the tarball by this other route.
  
  Nothing in the published surface reached those files, which is why no consumer changes in either direction. Measured on a cleanly rebuilt `dist`, all four ways in are closed: the `exports` map has two entries and both target `dist` (`.` resolves `types` / `import` / `require` to `./dist/index.d.ts` / `./dist/index.js` / `./dist/index.cjs`, and `./style.css` to `./dist/index.css`); `main` / `module` / `types` are `./dist/index.cjs`, `./dist/index.js`, `./dist/index.d.ts`; no deep import into this package exists anywhere in the repo or the docs — the one that used to, `@object-ui/fields/widgets/MarkdownContent`, was ruled out by objectui#4325 precisely because a package's surface is its index, and the `../fields/src` paths in sibling `vite.config.ts` files are workspace aliases resolved through `resolve()` against the source tree, which no `files` array shapes; and the tarball holds no sourcemap that could point back at `src`. That last one is the check that had to be measured rather than assumed, because this package emits its declarations through `vite-plugin-dts` rather than the `tsup` of objectui#4847 or the bare `tsc` of `@object-ui/types`: a clean rebuild writes 78 files into `dist`, of which zero are `.d.ts.map`, zero are `.js.map`, zero contain a `sourceMappingURL` comment and zero mention `../src`. `src/index.css` is an input to `scripts/build-css.mjs`, not an output anyone resolves; the sheet the `./style.css` export names is the built `dist/index.css`, which still ships.
  
  `npm pack --dry-run` across the change, on the same `dist`:
  
  | | before | after |
  | --- | --- | --- |
  | entries | 255 | 82 |
  | unpacked | 2265557 B | 841772 B |
  | tarball | 629843 B | 252364 B |
  
  173 files leave, none arrives, nothing outside `src/` moves, and every surviving entry is byte-identical apart from the edited `package.json` itself. The 173 are the 97 tests plus 76 implementation modules, whose published form remains the bundled `dist/index.js` / `dist/index.cjs` and the 75 declaration files beside them.
  
  `@object-ui/types` keeps its `src` entry for now, and that is a different judgement rather than an omission: it builds with a bare `tsc` under a `declarationMap` / `sourceMap` config with no `inlineSources`, so its shipped `dist/*.d.ts.map` name `../src/*.ts` with no embedded content and dropping `src` there would leave published maps pointing at files the tarball no longer carries. That trade-off is filed as objectui#4851.
- 37f6844: FilterConditionField can author the spec's `$icontains` — case-insensitive contains is reachable from the filter UI.
  
  `@objectstack/spec`'s `FieldOperatorsSchema` gained `$icontains` between
  `17.0.0-rc.2` and `rc.5`, and every driver and evaluation face the platform
  ships now executes it. `FilterConditionField` had no builder operator that could
  author it, so the capability was unreachable from the sharing-rule criteria
  builder and sat in that widget's parity test as an explicit `KNOWN_UNREACHABLE`
  entry.
  
  The FilterBuilder gains a `containsCaseInsensitive` operator ("Contains (ignore
  case)", translated in all ten locale packs). `condToMongo` emits
  `{ field: { $icontains: value } }` and `kvToCondition` reads it back, so a saved
  criteria reopens in the visual builder instead of falling into the raw-JSON
  editor. Today's `contains` is unchanged and still emits the case-SENSITIVE
  `$contains`; whether it should have been case-insensitive all along is a product
  question that stays open, and stored filter views keep meaning what they meant.
  
  The fold is ASCII-only by contract — `café` does not match `CAFÉ`.
  
  The new operator is **opt-in per consumer**: `FilterBuilder` takes an
  `extraOperators` prop, and only `FilterConditionField` passes it. The one
  dropdown feeds three at-rest dialects and only the MongoDB-style criteria this
  widget writes can carry the operator — the spec's `VIEW_FILTER_OPERATORS` (saved
  views) and `VALID_AST_OPERATORS` (the live grid's filter AST) have no
  case-insensitive contains, so offering it there would author a filter those
  paths cannot execute. Every other FilterBuilder is unchanged.
- 911ceaa: The fullscreen long-text dialog announces the field's validation state and carries the field's name
  
  objectui#4824, objectui#4832.
  
  `mobile.fullscreenLongText` is a shipped opt-in, and with it on the phone user
  edits long text in this dialog and nowhere else. Measured on all three surfaces
  that render the dialog — `TextAreaField`, `RichTextField`, and the form
  renderer's built-in `textarea` branch — with the field genuinely invalid at that
  moment:
  
  ```
  INLINE  richtext  aria-invalid= true
  DIALOG  richtext  aria-invalid= false   aria-describedby= null
  INLINE  textarea  aria-invalid= true
  DIALOG  textarea  aria-invalid= null    aria-describedby= null
  ```
  
  and the accessible name of every dialog control empty, against `F` on every
  inline one. The rich-text row is the sharp half: the dialog was not silent about
  the failure, it was announcing the OPPOSITE of the inline control for the same
  field at the same moment, because `RichTextEditorSurface` computed
  `aria-invalid={!!error}` from an `error` prop the dialog rendering never
  received. 3 surfaces, 3 broken, one cause: the dialog's control is built from
  scratch by the host, so none of the wiring the inline control gets from the form
  renderer reaches it.
  
  **Answered once, in the primitive.** `FullscreenEditor` now takes the field's
  `error` and owns what the dialog does with it: it renders the message in a
  dialog-local node, and hands `children` a required fourth argument — a
  spreadable set of DOM attributes — carrying `aria-labelledby` (the dialog
  title's text, i.e. the field label #3393 already put there), `aria-invalid`, and
  `aria-errormessage` naming that node. The host spreads it; the host never learns
  an id, so it cannot name the wrong node, cannot compose the attributes subtly
  wrong, and cannot compute its own `aria-invalid` from a prop it forgot to plumb.
  Three hosts hand-answering this is the shape that produced three identical
  holes.
  
  **On objectui#3222's "the text belongs to `FormMessage`".** The maintainer's
  ruling of 2026-08-16 restates that rule as what it was always protecting —
  only one copy of the error text is in the accessibility tree at any moment —
  which the dialog-local node satisfies: it exists only while the dialog is open,
  and for exactly that window Radix `aria-hidden`s everything outside the modal,
  `FormMessage` included. The shortcut of pointing the dialog control's
  `aria-describedby` / `aria-errormessage` at the host's `FormMessage` id is
  forbidden rather than merely unused: it resolves to a node that is `aria-hidden`
  for the whole time the reference is live (an ARIA MUST violation), and neither
  happy-dom nor jsdom can see the difference — which is why every new pin asserts
  that the named node is inside THIS dialog, not merely that it exists.
  
  `aria-errormessage` carries a single IDREF and is emitted only alongside
  `aria-invalid="true"`. It is deliberately not folded into the host's
  `aria-describedby` chain, which on the textarea surface already carries the
  fullscreen character counter's sentence.
  
  **The name reuses the visible title rather than minting a second author for it**
  (#3978): `aria-labelledby` points at a span inside `DialogTitle`, not at
  `DialogTitle` itself — Radix renders the title as `h2` with the id its own
  `DialogContent` `aria-labelledby` names, so putting an id on it would buy the
  control a name at the cost of the dialog's.
  
  **Breaking (shipped as `minor`, see below), `@object-ui/components` only.**
  `FullscreenEditorProps.error` is REQUIRED, not optional, and
  `FullscreenEditorProps['children']` takes a fourth argument.
  
  FROM → TO for an out-of-repo host:
  
  ```
  <FullscreenEditor value={v} onCommit={c} label={l} testIdPrefix="x">
    {(draft, setDraft, disabled) => <textarea … />}
  </FullscreenEditor>
  
  <FullscreenEditor value={v} onCommit={c} label={l} testIdPrefix="x" error={err}>
    {(draft, setDraft, disabled, aria) => <textarea {...aria} … />}
  </FullscreenEditor>
  ```
  
  A render prop may still declare fewer parameters, so only `error` fails to
  compile — which is the point of making it required. Every consumer already has
  the value at hand (registered widgets take `error` off the widget props
  contract, objectui#3222; the built-in branch reads `fieldState.error?.message`),
  and an omitted `error` reproduces this defect exactly: a dialog announcing
  `aria-invalid="false"` for a field its own form has already failed. An optional
  key was forgotten by three surfaces in a row; a required one cannot be.
  
  `@object-ui/fields` is `patch`: `FullscreenFieldEditor` is internal to that
  package (not re-exported from its entry), so nothing in its public surface
  changes — only the behaviour of the two long-text widgets' dialogs.
  
  `minor` rather than `major` follows the repo's standing retirement precedent
  (AGENTS.md §版本号策略, enforced by `scripts/check-changeset-no-major.mjs`): all
  publishable packages sit in one `fixed` group, so a `major` here would carry the
  whole family up against an `@objectstack` that has not moved.
- 0bffb18: A readonly group-labelled field is now DESCRIBED by its own help text, not just named by its label.
  
  The seven `labelling: 'group'` widgets (`address`, `geolocation`, `checkboxes`, `radio`, `rating`, `file`, `multiselect`) render a `<FormDescription>` in their readonly and zero-option states, and the form renderer publishes its `id` — but nothing in the document referenced that id, so the visible help text had no programmatic association with the field it describes. Measured before the change, one field per row: `consumers=0` on every readonly surface of all seven, against `consumers=1` on the same widget's editable one.
  
  `toHostGroupProps` now carries `aria-describedby` alongside the host `id` and `aria-labelledby`, onto the `role="group"` surface those states already render (a group is a description carrier under ARIA 1.2 — no focusable control required, which is why this became possible only once objectui#3990 gave those surfaces a role).
  
  Control-channel state deliberately does NOT come along: `aria-invalid` and `aria-required` report what a user's editing may do wrong, and a readonly display cannot be edited. The boundary is pinned from both sides, including with a live failed validation on a readonly required field. Editable surfaces are unchanged — a composite's editable container still leaves the description on the sub-input the user focuses, so the help text is never announced twice.
- 800f455: fix(fields): grid columns are keyed by the declared `name`, so spec-compliant grid metadata renders populated cells
  
  `GridField` declared its own column interface keyed by `field` and read
  `c.field` at every site (`key=`, `row[…]`, the blank row, cell writes, the
  column chooser, the running-total lookup), while the published
  `GridColumnDefinition` in `@object-ui/types` — and the grid documentation, and
  the `fields-grid` catalog examples — declare the key as `name`. Metadata
  authored against the published type therefore rendered a grid with the correct
  row count and every cell empty, plus a React "unique key" warning per column.
  
  The renderer now reads the declared `name`, and the master-detail derivation
  (`deriveColumns` / `hydrateColumns` / `pickAmountField`) produces and consumes
  the same key. There is deliberately **no** `col.field ?? col.name` alias: one
  spelling at the producer (AGENTS.md #0.1).
  
  **Breaking for `field`-keyed columns.** Grid / line-item / master-detail
  subform columns spelled `{ field: 'amount' }` must be re-spelled
  `{ name: 'amount' }`. This affects author-supplied `columns` on the `grid`
  field, `record:line_items`, `object-master-detail-form` details and a
  relationship field's `inlineColumns`. Auto-derived columns (no explicit
  `columns` block) need no change. List-view and `object-grid` columns are a
  different contract (`ListColumn`) and keep their own `field` key.
- 5458414: Publish relative import specifiers with explicit `.js` extensions so these six packages load under plain Node ESM.
  
  Node's ESM resolver does not extension-search relative specifiers and `tsc` never rewrites them, so an extensionless `./Foo` in the source shipped as an extensionless `./Foo` in `dist` and importing the package entry outside a bundler failed with `ERR_MODULE_NOT_FOUND`. Bundled consumers were unaffected. Unbundled consumers — plain Node ESM, an SSR host importing the package directly, anyone running the published tarball without a build step — can now import these entries, and so can the downstream `@object-ui/plugin-*` packages that evaluate through `mobile`, `permissions` and `providers`.
- 3241559: `object-kanban` now caps its fetch with a real top-level `$top`, and honours `limit`.
  
  The board's row cap was written `dataSource.find(objectName, { options: { $top: 100 }, $filter: … })`
  — `$filter` at the top level, where the adapters read it, and the cap one level
  down under `options`, which is not a `QueryParams` key. Nothing in this repo
  reads `params.options` (`convertQueryParams` in `@object-ui/data-objectstack` and
  `ApiDataSource` both read `params.$top`), so the intended cap never reached the
  wire: a board over a large object fetched every row the server would return and
  grouped all of it into lanes client-side. The author's 100 was never live.
  
  The cap is now `$top: schema.limit ?? 100`, the shape `object-timeline` took for
  the identical defect. Two consequences worth reading before upgrading:
  
  - **A board that used to fetch unbounded now fetches 100 rows by default.** That
    is the previously-declared intent taking effect, not a new limit — but a board
    over an object with more than 100 matching records will show fewer cards than
    it did. Authors who want the old behaviour should declare the window they
    actually want (`limit: 500`), not rely on the absence of one.
  - **`limit` is now mapped from the `dataSource` binding** (`object-kanban`'s
    `ElementDataSourceMapping` gains `limit: 'limit'`). A board bound to a saved
    view is capped by that view's `pagination.pageSize`, and the binding's own
    `limit` overrides it. The flag comes with the read site: it stayed unmapped
    until now on the rationale that the board had a "fixed window", which is the
    claim this change falsifies. `sort` remains unmapped — the board still has no
    `$orderby` read site — and `columns` remains unmapped because a board's columns
    are its swimlanes, not a field projection.
  
  `KanbanSchema` gains `limit?: number` (the board's row cap; distinct from a
  column's `limit`, which is that lane's WIP limit and never reaches the query),
  and the guide's per-block table in `content/docs/guide/data-source.md` no longer
  claims a fixed window for `object-kanban`.
  
  `@object-ui/fields` carried the same nesting in the lookup-name fallback
  (`find(referenceTo, { $filter: { id }, options: { $top: 1 } })`) where it was
  harmless — a primary-key equality returns at most one row with or without a cap.
  It is spelled `$top: 1` now, so no live instance of the dead nesting is left in
  the repo to read as precedent. No behaviour change there.
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
- 6c68b13: Lookup "recently used" now obeys the field's declared filters. The recents rail
  re-fetched its rows without merging either `lookupFilters` or the `dependsOn`
  cascade, so a record the author's metadata excludes stayed visible and
  selectable — pick a product under project A, switch the form to project B, and
  project A's product was still offered. Both re-fetch channels are fixed: the
  inline dropdown (which re-read each remembered id with an unfiltered `findOne`)
  and the search-first picker (which batched recents into an unfiltered `$in`
  query). The currently-selected value still resolves unfiltered, so an existing
  value keeps its label and a selection tray is never silently emptied.
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
- e7747f1: fix(fields): retire the `owner` field-type alias with a loud tombstone
  
  `owner` was a synonym for `user` with zero behavioral delta — both resolved to
  the same `UserField` widget — and it is not a member of `@objectstack/spec`'s
  closed `FieldType`, so no object schema could ever declare it. It was reachable
  only through hand-written SDUI, and the three code faces that read it had
  already drifted apart on the word: the form's data-source rule excluded it,
  while plugin-grid's bulk-action dialog and app-shell's `paramToField` included
  it.
  
  The retired spelling now fails **loudly**. Deleting the alias on its own would
  have been absorbed by two silent tails (`mapFieldTypeToFormType`'s
  `|| 'field:text'` and `resolveFormWidgetType`'s `: 'text'`), each handing back a
  working plain text input with no check turning red — so anyone who had written
  `type: 'owner'`, including an AI author copying it out of a doc, would have
  shipped a text box believing they shipped a person picker. Instead:
  
  - `type: 'owner'` and `widget: 'field:owner'` both resolve to a registered
    tombstone widget that renders a visible refusal naming the migration;
  - the same prescription is written to the console once per spelling;
  - the read/cell path degrades to the text cell deliberately and says so.
  
  Migration: write the record-owner field as `{ type: 'user', name: 'owner' }` —
  the field NAME carries the ownership meaning, the type carries the widget.
  `UserField` and `UserCellRenderer` are unchanged; only the synonym is gone.
  
  Also corrects the `dataSource` TSDoc in `@object-ui/fields`, which listed `grid`
  among the widgets the form renderer wires a DataSource to. `GridField` never
  read `dataSource` and no data-source table ever contained the key.
- ac2f332: Retired field-type spellings can no longer reach an inline editor by delegation — the grid's inline cell editor stops offering a working person picker for `owner`.
  
  objectui#4814 retired the `owner` field type with a loud tombstone, and the
  record form has answered `type: 'owner'` with a visible refusal ever since.
  `FieldEditWidget` did not participate, and the reason it was missed is that no
  routing table had to list the spelling for it to stay alive:
  `hasFieldEditWidget` answers `resolveInlineEditType(type) in EDIT_WIDGETS`, and
  `resolveInlineEditType` returns a type **unchanged** when it is already a key of
  `EDIT_WIDGETS`. So while `owner: UserField` sat in that map, the alias table —
  where the retirement lives — was never consulted, and the retirement never
  applied. Measured: `hasFieldEditWidget('owner') === true`, and a direct
  `FieldEditWidget` call rendered a working person picker. Every host built on
  this seam, the data grid's inline cell editor being the user-facing one, still
  let a person be picked and saved for a field the record form refuses.
  
  The gate now consults the retirement table itself, so this closes the **class**
  rather than the spelling — the next retirement covers this seam the day it lands
  in `RETIRED_FIELD_TYPES`, with no edit here:
  
  - `hasFieldEditWidget()` answers `false` for any retired spelling, ahead of
    every table lookup (so it holds even if a retired spelling is still a key of
    the widget map);
  - `isInlineExcludedFieldType()` answers `true` for any retired spelling, which
    is what routes a host to its read-only path;
  - `FieldEditWidget` itself renders no control for a retired spelling and writes
    the once-per-spelling console prescription naming the migration;
  - `owner` is dropped from `EDIT_WIDGETS` and from the cosmetic
    `COMPACT_EDIT_TYPES` sizing set.
  
  The second bullet is load-bearing and not cosmetic. `ObjectGrid` marks a column
  `editable: false` exactly when `isFieldInlineEditable` is false, and that
  predicate consults `isInlineExcludedFieldType`. Without it, closing the first
  gate alone would have left the column editable, handed the cell editor a `null`
  widget, and let DataTable fall back to its built-in **plain text input** — which
  for a stored person reference displays a coerced value and writes a bare string
  straight back over it. Measured before/after on the grid consumer: a stored
  `owner` field went from an editable cell rendering the person picker to a
  read-only cell (`isFieldInlineEditable('owner')` `true` → `false`), which is the
  same disposition `password`, `formula` and `composite` already get, for the same
  reason. The read path is unchanged from #4814: the text cell plus the console
  prescription.
  
  `user` is untouched — it keeps the person picker, its compact sizing and its
  expanded-object value resolution. The record-owner idiom survives verbatim as
  `{ type: 'user', name: 'owner' }`: the field NAME carries the ownership meaning,
  the type carries the widget.
- a777058: Editable `markdown` / `html` / `richtext` fields now carry the host's `id` and `aria-describedby` on the editor.
  
  `RichTextField` — the one widget all three registry keys resolve to — read only
  `className` and `disabled` off its props and had no `toDomProps` anywhere in the
  file, so everything `<FormControl>`'s Radix `Slot` hands a field widget landed on
  no element at all. Measured on a real form with a field carrying a description:
  
  ```
  markdown  editable  descEl=SET  consumers=0  hostIdEl=NONE  for=DANGLING
  text      editable  descEl=SET  consumers=1  hostIdEl=input     for=RESOLVES
  textarea  editable  descEl=SET  consumers=1  hostIdEl=textarea  for=RESOLVES
  ```
  
  Two user-visible consequences: the form's visible label pointed at an id nothing
  carried, so clicking it did not reach the editor and the control had no
  accessible name; and the `<FormDescription>` the form rendered below the field
  had zero consumers, so a screen reader never announced the help text or — on a
  failed submit — the error message id that rides in the same `aria-describedby`.
  
  The fix is objectui#3318's standing recipe: `toDomProps(props)` spread onto the
  REAL focusable control, which here is the `<Textarea>` inside the shared
  `RichTextEditorSurface`. The pass-through is given to the inline surface only —
  the fullscreen dialog's copy of the same surface must not carry a duplicate of
  the host id, and the description ids it names sit outside the modal Radix
  `aria-hidden`s. `aria-invalid` still comes from the widget's own `error` read,
  kept after the spread so objectui#3318's PASS entry for this widget is unchanged.
  
  The readonly branch is untouched: the same reading there belongs to
  objectui#4788, whose mechanism is still open.
- 75444e3: The dependency-gate hint now enumerates its controlling fields with the locale's
  own list separator, and reads identically whichever caller produced it.
  
  `lookup.selectFirst` and `fields.options.selectFirst` are deliberately one
  wording, so a field gated on two or more parents says the same thing whether the
  lookup widget or the form renderer rendered it. The sentence was shared but its
  `{{fields}}` slot was not: each call site joined the controlling-field names
  with its own hardcoded separator, and not even the same one — `', '` in
  `LookupField`, `' / '` in the form renderer's `gatedHint` and in
  `OptionsEmptyState`. A field gated on Account and Lead Source read
  `Select Account, Lead Source first` from one side and
  `Select Account / Lead Source first` from the other.
  
  A list separator is a property of the locale rather than of the code, so both
  spellings were also wrong for the script under zh/ja (which enumerate with
  U+3001) and under ar (U+060C). All three call sites now read
  `validation.formInvalidJoiner` — the key already shipped in all ten packs for
  the invalid-submit toast's field list, which is the same class of truncated-name
  list. One key, every caller: a second, gate-specific key would have recreated
  the divergence the shared sentence exists to prevent.
  
  No locale pack changes, and no change to what a provider-less render produces in
  English: the `@object-ui/fields` defaults table declares the joiner as `', '`,
  the `en` pack's value and the literal `LookupField` previously hardcoded.
- dad51e5: fix(fields): deliver the host's a11y channels to `slider` and name `signature`
  
  `SliderField` and `SignatureField` forwarded nothing a form host handed them —
  neither spread `toDomProps(props)` at all — so `<FormControl>`'s whole payload
  landed on nothing. Measured on a real form, one required field per row, freshly
  failed validation:
  
  ```
  slider     ariaInvalidTrue=[]  labelFor=…-form-item -> DANGLING  descConsumers=0  ids=[]
  signature  ariaInvalidTrue=[]  labelFor=…-form-item -> DANGLING  descConsumers=0  ids=[]
  text       ariaInvalidTrue=[input]  labelFor -> input            descConsumers=1
  ```
  
  `ids=[]` is the tell: no element in either row carried an id at all, so the
  visible label pointed `for` at nothing, the rendered help text had zero
  consumers, and a failed slider announced no error state.
  
  **`slider`** now delivers all three. Its focusable control is Radix's
  `span[role="slider"]` thumb, which the synced `ui/slider.tsx` renders internally
  and does not export, so the primitive grew a declared `thumbProps` — routed
  through a new `lib/slider-thumb` and applied to the no-touch file as a declared
  sync patch, so it survives regeneration. The split of which keys stay on Root
  (`name`, `disabled`) is the one the `select` fix already settled.
  
  **`signature`** gets the name and the description on a `role="group"` container.
  Its control state deliberately does not follow: the drawing surface is a
  `<canvas>` with no keyboard path, and its only other element is disabled while
  the pad is empty, so there is no element a control state could be read from.
  
  Both are now declared `labelling: 'group'` — a `<span>` and a `<canvas>` are not
  labelable elements, so a host `for` could only dangle at them.
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
  - @object-ui/providers@17.6.0

## 17.5.0

### Minor Changes

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

- 52d878a: fix(fields): `formatPercent` renders percentage points directly — ties round half-up and extremes keep every digit

  `formatPercent` rendered a value that is already in percentage POINTS through
  `Intl`'s `style: 'percent'`, which expects a FRACTION, so the body divided by
  100 for `Intl` to multiply straight back. That round trip is not
  value-preserving: `Intl` formats from the shortest decimal representation of the
  double it is handed, and the quotient's is not the authored one. A stored
  `1.005` at 2 decimals rendered `1.00%` where half-up on the authored decimal is
  `1.01%`; `1.45` at 1 decimal rendered `1.4%` for `1.5%`. Every case was a
  last-digit off-by-one — the failure mode least likely to be noticed and most
  likely to be trusted.

  The body now renders through `style: 'percentPoints'` with no scaling round
  trip. Measured on this repo's runner (node v22.22.2 / ICU 78.2), 27,577 of
  1,200,003 ordinary en-US forms move (0.005-step grid to 2,000, precisions
  0/1/2), and the same artefact at the top of the double range is gone too:
  `Number.MAX_SAFE_INTEGER` percentage points rendered `9,007,199,254,740,990%`
  and now render `9,007,199,254,740,991%`.

  The locale percent CONVENTION is unchanged — this is a numeral move only.
  `'percentPoints'` is `Intl`'s `style: 'unit'` / `unit: 'percent'`, re-measured on
  this call shape across 720 combinations (10 locales x 18 values x 4 precisions):
  0 convention differences, 130 numeral differences. The no-break space in
  de/fr/ru/sv, Turkish's prefixed sign, Arabic's own percent sign and Bengali's
  digits all render exactly as before. Percent SCALING (a stored fraction below 1
  scaling by 100) is upstream of the render and untouched.

  A percentage point now reads identically in a list cell and in a dashboard
  measure, which `formatMeasure` already rendered this way.

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

- e2e6360: A `Field.address` value now reads as a formatted postal address on the record detail page, instead of stringified JSON.

  The display (read) registry mapped `address` straight to `JsonCellRenderer`, so a populated address rendered as `{"street":"中策路 1 号","city":"杭州",…}` — while a `location` field sitting next to it in the same field group rendered formatted, and the create/edit dialog rendered the very same value as proper Street / City / State / ZIP / Country inputs. The gap was display-side only: the input registry has always carried `address`. Both read surfaces the detail page exposes are affected and both are fixed, because they share one `displayValue` path — read mode, and the inline-edit read state (the row carrying the pencil affordance, before a field is actually being edited).

  Layout is not invented for the read side. `AddressField`'s readonly branch already collapsed a stored address to a single line, and that rule — `Street, City, State ZIP, Country`, with `state` and the postal code sharing one comma group — is now the _only_ implementation, moved into a pure `address-format` module that both surfaces call. A readonly form and a detail page therefore cannot spell one stored address two ways; a second copy next to the renderer would have been a rule that drifts. The module is deliberately React-free, so the eagerly-loaded barrel can format a cell without pulling `AddressField` and its inputs out of the lazy widget chunk.

  Partial values degrade the way the readonly line already did: absent, non-string and whitespace-only parts are dropped rather than spaced over, so a street-only address renders as `中策路 1 号` and never as `, , ,` or as the string `undefined`. Legacy records whose postal code was written under `zipCode` (objectstack#5143) still render it, matching what the input widget reads.

  Nothing is silently swallowed by the change: a value the formatter cannot recognize — an object carrying no known part — keeps today's compact-JSON rendering rather than disappearing, and `{}` or a null value shows the usual empty placeholder. A plain string address passes straight through. `location`, `geolocation`, and the genuinely structural `json` / `object` types are untouched.

  The address _input_ is unchanged on every surface, including the create/edit dialog.

- dde7283: `chatbot` and `chatbot-enhanced` now pass only whitelisted DOM props to their host element (objectui#4431)

  Both registrations destructured `schema` and `className` and forwarded everything else. `SchemaRenderer` hands a registered component the authored node's own keys, the contents of its `props` container, the ARIA it resolved and the host's trailing props — so all of it became attributes on the chat root `div`, because React passes unknown lowercase attributes through in silence and stringifies object values. Measured through the real SDUI path with a data-source adapter attached: **14 non-DOM attributes on each widget**, including `datasource="[object Object]"` (the injected adapter, which only appears on a deployment that really loads data) and a camelCase `arialabel` sitting next to the resolved `aria-label`, so the element carried each ARIA value twice under two spellings — one of them meaningless to assistive technology.

  Both are now consume-or-whitelist: configuration is read off `schema` as before, the evaluated `disabled` verdict is consumed by name, and only `toDomProps`' output reaches the element. The resolved `aria-label` / `aria-describedby`, `role`, `id`, `tabIndex` and the `data-*` family still arrive — dropping them would have been an accessibility regression dressed as a leak fix, so the pin asserts the delivered set exactly, not just the absent one. `chatbot-floating` is untouched: its content mounts through a portal and its root never spread.

  `@object-ui/core` gains the shared executor this migration needs (`utils/dom-props.ts`): `toDomProps` for the SDUI widget contract, plus `pickDomProps` — the mechanism — for a package whose own contract declares a different key set. That is the objectui#4409 dependency direction: plugin packages declare `@object-ui/core` and must not grow a dependency on `@object-ui/fields` to reach a whitelist.

  `@object-ui/fields` keeps its own key list and its compile-time bindings, and now executes them through core's mechanism. Its behaviour is unchanged and its exported `DomProps<P>` is the same structural type. The two lists differ for measured reasons and no longer can drift silently: `name` and `disabled` are legal only on form controls, which is what every field widget renders and what `FieldWidgetComponentProps` declares, while `role` is resolved by `SchemaRenderer` for every SDUI node and is not part of the field contract. A new assertion binds every shared key in both directions, with `role` named as the single deliberate exception.

- 0f21348: Currency amounts now follow each currency's own ISO 4217 fraction-digit
  convention instead of a hardcoded 2 (objectui#4361).

  Both currency formatting paths in `@object-ui/fields` picked a fraction-digit
  width and handed it to `Intl.NumberFormat`, which OVERRIDES the digit count
  `Intl` already knows for the currency being rendered. `formatCurrency` derived
  its width from the VALUE's wholeness alone (`isWhole ? 0 : 2` — a literal 2 for
  every currency on earth), and `CurrencyField` defaulted an undeclared
  `precision` to the same literal. So a yen amount was printed with cents the
  currency does not have and a dinar amount with one digit fewer than it does:

  |              | before         | after       |
  | ------------ | -------------- | ----------- |
  | JPY `1234.5` | `¥1,234.50`    | `¥1,235`    |
  | KWD `1.5`    | `KWD 1.50`     | `KWD 1.500` |
  | CLP `1234.5` | `CLP 1,234.50` | `CLP 1,235` |
  | BHD `2.5`    | `BHD 2.50`     | `BHD 2.500` |
  | USD `1234.5` | `$1,234.50`    | `$1,234.50` |
  | USD `1234`   | `$1,234`       | `$1,234`    |

  Both call sites now derive the width from the currency itself
  (`Intl.NumberFormat(undefined, { style: 'currency', currency })
.resolvedOptions().maximumFractionDigits`, memoized per code) and switch
  wholeness against THAT.

  **The whole-number convention is extended, not retired.** Simply dropping both
  bounds and letting `Intl` decide would have fixed the digit count while turning
  `$1,234` back into `$1,234.00` — the Salesforce convention `formatCurrency`
  documents and objectui#4033 pinned. A whole amount still drops the fraction, now
  for every currency: `KWD 1` renders `KWD 1`, not `KWD 1.000`. Two-decimal
  currencies are byte-identical to before, which is why the objectui#4033 and
  objectui#4332 pins pass unchanged.

  **On `CurrencyField`, an explicitly authored `precision` still wins** — it is
  authored metadata and authored metadata keeps priority, so a JPY field declaring
  `precision: 2` still renders `¥1,234.50`. Only an ABSENT `precision` derives from
  the currency; because that derivation is the widget's one precision, it also
  reaches the spinner `step` and the blur rounding, so a JPY field no longer offers
  a `0.01` step for a currency with no minor unit. Whether a declared `precision`
  that contradicts the currency's ISO 4217 digits should be REJECTED at publish
  time is a contract question, filed upstream in `@objectstack/spec` rather than
  answered here by overriding the author.

  Reachable wherever the resolved currency is not a 2-decimal one — the field's
  `currency`, `currencyConfig.defaultCurrency`, or the tenant default (ADR-0053).

- d2e2caf: fix(fields): `formatCurrency` keeps both cents digits on a fractional amount

  The symbol branch passed `minimumFractionDigits: 0` against a
  wholeness-switched `maximumFractionDigits`, which handed `Intl` the range
  `[0, 2]` — and `Intl` emits the shortest representation in range, so a real
  cents value of `.50` was printed as `.5`. Any price ending in a zero cent digit
  rendered one digit short: `$1,234.50` as `$1,234.5`, `$19.90` as `$19.9`,
  `$0.50` as `$0.5` — money on a record page and in grid cells reading as a data
  error rather than a formatting one.

  Both bounds now take the same wholeness-switched width, so the function
  delivers the contract its own doc comment states: a fractional amount shows
  exactly two digits, a whole amount still drops `.00` (`$1,234`). The
  no-currency branch and the bad-currency fallback already behaved this way; only
  the symbol branch disagreed.

  Reaches every consumer of the shared helper: `CurrencyCellRenderer`,
  `ObjectGrid`, the dashboard `recordFields` and `ObjectGantt`.

- 3a9021e: fields: the currency adornment has one symbol channel

  `CurrencyField` carried the same one-entry fact twice — a dead `CURRENCY_SYMBOLS`
  map that nothing read, and a live `currency === 'USD' ? '$' : currency` ternary
  two lines below it. Both were hand copies of knowledge `Intl` already carries,
  and both are gone: a new `currencySymbol(currency, locale)` beside
  `currencyFractionDigits()` reads the `currency` part of the very format the
  widget's readonly branch already renders amounts with.

  USD is unchanged at the display-locale default. Other currencies now show their
  real symbol instead of the bare ISO code — `€` for EUR, `¥` for JPY, `£` for
  GBP — which is what the same widget's readonly mode has always displayed; the
  edit adornment simply stopped disagreeing with it. Currencies CLDR has no symbol
  for (KWD, BHD, CHF, ISK, CLP) still render their code, exactly as before.

- 8f60d73: `@object-ui/fields` and `@object-ui/plugin-editor` stop publishing their test declarations

  Both packages' build tsconfigs set `include: ["src"]` with no test exclude, so every test file entered the declaration program and its `.d.ts` was written into `dist/`. Both are published (`private` is false, `files` contains `dist`), so those declarations shipped: 85 from `@object-ui/fields` and one from `@object-ui/plugin-editor`. Adding the test exclude the other twenty-odd packages already use removes them.

  Nothing else about either artifact moves. Measured by building each package both ways from a cleared `dist/`, then diffing the file lists: `@object-ui/fields` goes from 163 files to 78 and `@object-ui/plugin-editor` from 6 to 5, every one of the 86 disappearances is a `*.test.d.ts`, no file appears, and all 83 surviving files are byte-identical by sha256 — including each package's entry `dist/index.d.ts`. The entry type surface is therefore unchanged and no import can break; this is the tarball shedding files nothing resolved.

  The type coverage those files were a side effect of did not go with them. Because the build program read the tests, these two packages counted as "tests type-checked" in `scripts/check-type-check-coverage.mjs` — a correct verdict reached through an emit nobody wanted. Excluding the tests alone would have silently dropped 86 test files out of every `tsc` program, so the same change adds a `tsconfig.test.json` per package, chained from each package's `type-check` script, and the coverage gate stays at 41 of 41 packages compiling their tests with zero declared debt on both sides of the change.

- cb13400: One fullscreen long-text editor, hoisted to the package both render paths may import

  The "expand to a full-height dialog" interaction had two independent implementations. `FullscreenTextarea` lived inside the form renderer's built-in (unregistered) `textarea` branch in `@object-ui/components`; `FullscreenFieldEditor` lived in `@object-ui/fields` and served the registered `TextAreaField` / `RichTextField` widgets. They exist because ONE form-level promise — `ObjectFormSchema.mobile.fullscreenLongText`, projected onto every long-text field as `mobile_fullscreen` — is honoured on two render paths, and each path grew its own answer.

  Two copies of a state machine drift, and these did, in both directions: objectui#3400 measured a read-only long-text field that was fully editable through the built-in branch's dialog (and "Done" wrote the edit into form state), objectui#3402 measured the same write-back hole for `disabled` on the registered path, and objectui#3393 (the dialog title needs the field label) and objectui#3272 (the copy needs i18n) each landed on one side before the other. Every repair was correct and none of them scaled.

  `@object-ui/components` now exports `FullscreenEditor`, a single primitive owning the affordance, the dialog, the draft/commit state machine and the copy. The direction follows the measured import graph rather than fighting it: `@object-ui/fields` depends on `@object-ui/components`, and `components` declares no dependency on `fields` in either `dependencies` or `peerDependencies`, so the shared code can only live in `components`. `FullscreenFieldEditor` becomes a thin wrapper over it and keeps its name, its props and its test-id namespaces, so both hosts and their pins are unchanged.

  The load-bearing part of the merge is that the primitive DEFINES `readOnly` and `disabled` instead of inheriting them by accident. Neither copy defined both: the built-in one grew them under objectui#3400, while the fields one declared only `disabled` and was shielded from `readonly` by its hosts' early return — a single implementation cannot be shielded by one caller's control flow. So both are answered once, and both call paths inherit the same answers: `readOnly` renders no affordance at all (it means "shown plainly", so advertising an expand button the user cannot use is worse than showing none), `disabled` leaves an inert one (it means "not interactive, muted"). Neither relies on the toggle alone, because `disabled` also carries the form's `isSubmitting` and can flip to true while the dialog is already open — so opening refuses independently of the attribute, the injected editor is told, "Done" is disabled, and `onCommit` is gated as the single point where a value leaves for host state.

  No copy changed and no locale pack needed an edit: the primitive consumes the same `form.fullscreen.*` / `common.cancel` keys both copies already read, through `createSafeTranslation` with English defaults byte-identical to the literals, so provider-less hosts render exactly what they did. The now-unread `form.fullscreen.*` defaults are dropped from `useFieldTranslation`, where they would have re-created in the defaults map precisely the duplication this change removes from the components.

  `toggleClassName` is not carried into the new primitive. It was declared on `FullscreenFieldEditorProps` and written by nobody — zero producers repo-wide — and `FullscreenFieldEditor` is not exported from the `@object-ui/fields` barrel, so no consumer outside the package could ever have set it. Minting it as part of a NEW public export in `@object-ui/components` would have published a prop with no producer, the shape objectui#3232/#3233 keeps deleting.

- bc64bfe: A dependency-gated option list no longer deletes the field's stored value on mount

  The four fixed-option widgets (`SelectField`, `MultiSelectField`, `CheckboxesField`, `RadioField`) end their cascade resolution with a "drop what is no longer offered" effect, and the form renderer runs an equivalent clear of its own over every option field. Both read `resolveCascadingOptions`, which returns an **empty** offered set whenever the list is _gated_ — a declared `dependsOn` parent is still empty. Nothing the field held could be "still offered" against an empty set, so both paths wrote the field empty **on mount, with no interaction**, while the control rendered "Select Country first" beside it: it told the user it could not offer anything, and deleted what they had.

  Gated means **unknown**, not invalid. The cascade clear exists (ADR-0058) so a user-driven parent change prunes a now-invalid child; a withheld list on mount is missing information — the record simply arrived with its controlling field empty (a later-cleared parent, an import, a partially-migrated row) — and that is not a reason to destroy stored data. Both clears now skip while gated, reading the resolver's own `gated` flag rather than re-deriving it from an empty offered set, which would collide with the distinct never-configured case guarded separately in objectui#4220.

  Convergence stays exactly where it belongs: once the parent **is** chosen and the resolved set genuinely excludes the stored value, the prune applies unchanged — including at the moment the gate lifts, so picking a parent whose list does not contain the old value still clears it on that transition. The three states are pinned apart (never-configured / gated / resolved-and-excludes) across all four widgets and the form host, so a future edit cannot collapse them back into one empty-set test.

  Reachable on every host that mounts these widgets with a live record: the form renderer, the grid's inline cell editor, and the detail page's inline editor — where each `onChange` went straight into the record draft the save bar commits.

- 3e19fe7: i18n copy: one ellipsis glyph across the ten packs, `usted` in the es draft-preview empty state, and a pt sentence that stops contracting `de` onto its own hole

  Three locale-copy defects that no gate could see, because all three are _value_ defects on keys whose names, placeholders and key sets were already correct.

  **One ellipsis (objectui#3878).** `en` ended 33 values with three ASCII full stops (`Loading...`, `Ask anything...`) and 110 with the typographic ellipsis `…`, and the nine translation packs had copied `en` value by value — so a user could read both glyphs on one screen: `common.loading` beside `dashboard.loading`, `console.ai.askAnything` beside its own panel's siblings. All ten packs now spell it `…` (U+2026), per the maintainer-authorized consistency pass registered on objectstack#6015. 312 pack values changed: 34 in `en` (the 33 trailing plus the one mid-sentence `collaboration.commentPlaceholder`) and 278 across the nine. Eleven inline `defaultValue` call sites were re-synchronised with the new `en` text, which `scripts/check-i18n-call-site-keys.mjs` requires byte-for-byte.

  The convention is now pinned so the split cannot regrow: `packages/i18n/src/__tests__/ellipsis-glyph-3878.test.ts` fails, by key name, on any value in any of the ten packs that holds three ASCII full stops. It is deliberately wider than "a trailing `...` in `en`", because the census showed the narrow rule would have shipped with two holes in it — `collaboration.commentPlaceholder` puts the ellipsis mid-sentence, and `list.loading` had the packs wrong while `en` was already right, which no `en`-only rule can see.

  Fifteen module-local **no-provider fallback** entries were moved with the packs, across `useCollaborationTranslation`, `useFieldTranslation`, `useDetailTranslation`, `ObjectGrid`, `KanbanImpl`, `data-table` and `ConnectionStatus`. Those maps exist to render when no `LocalizationProvider` is mounted, and each one's own docblock requires it to stay byte-identical to the `en` pack — a requirement objectui#3440 already enforces mechanically for the collaboration map. Leaving them behind would have made the provider-less path disagree with the provider path on ten keys.

  **es `usted` (objectui#3875).** `preview.empty.notReadyDescription` said `Revisa la conversación` — the tú imperative — in a namespace that is otherwise 23:1 usted, and it renders _underneath the usted draft-preview banner at the same moment_, not before or after it. `Revisa` → `Revise`; nothing else in the sentence carries a register. The neighbouring `approvalsInbox` namespace is legitimately tú and was left alone.

  **pt contraction (objectui#3877).** `ConcurrentUpdateDialog` splits `detail.concurrentUpdateDescription` on `{{field}}` and renders a bolded label in the gap, and pt left a bare `de` in front of that gap. When the multi-field conflict branch passes the record label (`este registro`), Portuguese users read `de este registro` — a contraction error every native speaker sees, and one that no spelling of the leaf value could fix (`deste registro` renders `de deste registro`). The pt sentence is rewritten so the hole is preceded by the verb `afeta` instead of any preposition, which closes the whole class rather than trading `de` for an `em` or `a` that contract just as hard. pt only; `en` is unchanged.

  No behavior, no keys added or removed, no placeholder changed.

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

- 433ff9f: An image field's declared `maxSize` is enforced before the upload starts, not after it finishes

  `ImageField` received a `maxSize` and ignored it. `paramToField` copies `maxSize` onto the field config for every action param regardless of type, so an image param declared with a 5 MB limit handed the widget its constraint and the widget uploaded anyway: a 6.3 MB PNG fired the full `presigned → PUT → complete` chain and rendered a thumbnail, with no rejection anywhere. The sibling file param, declared the same way, refused the identical pick without a single request. Reported from a QA run driving the two side by side (objectui#4141).

  Both of the widget's upload doors now check the limit first. The native picker rejects oversize picks before any request, keeping FileField's partial-acceptance rule — the in-limit members of a multi-select still upload, and only the oversize ones are reported. The crop dialog is the second door and needed the check in its own right: the cropper re-encodes to PNG, so cropping an in-limit JPEG can produce a blob _over_ the limit, and it is the crop's size that is uploaded. A rejected pick or crop now surfaces the same message the file widget has always shown, in a new error row — this widget had no surface for rejections before, because it never rejected anything.

  The guard itself moved into one shared `maxSizeError` helper that both widgets call, rather than a second copy living in the image widget. The check is the only thing between a declared limit and a real upload, and a per-widget copy is what let these two drift apart unnoticed in the first place. Both widgets also share the existing `fields.file.exceedsMaxSize` message: it names a file and a limit, says nothing file-specific, and is already translated in all built-in locales, so no new key was added and no translation is pending. FileField's own behavior is unchanged — same threshold, same message, same partial acceptance.

  An undeclared `maxSize` still means unrestricted; the falsy check is preserved deliberately, so a missing limit can never be read as a zero-byte one.

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

- b953a97: fix(detail): lookup field values link to the referenced record

  A valued lookup on a record detail page rendered as plain text plus a copy
  button — the referenced document's name was visible but unreachable, so users
  copied the number and searched for it from the list page instead. Lookup cells
  inside a related list that pointed at a third object were dead the same way.

  `LookupCellRenderer` — the one cell renderer both surfaces resolve through —
  now renders the display value as a link to the referenced record. The display
  name resolution, the copy affordance and every non-lookup field are unchanged,
  and a lookup with no value still renders its placeholder rather than an empty
  link.

  The URL is not assembled in the renderer. `RelatedRecordActionsContext` gains
  an optional `recordHref` / `openRecord` pair, published by the console's
  `RelatedRecordActionsBridge` from the SAME builder its related-list row
  navigation already used, so there is one record-route shape rather than a
  second one. A host that does not provide it (Studio designer, embedded
  renderers, standalone grids) renders exactly what it rendered before.

- 45e1949: Numbers render in the user's locale, and a `Field.number` year is no longer `2,026`

  Every numeric field the console rendered went through an `Intl.NumberFormat` built with the locale hardcoded to `en-US` and `useGrouping` never set. Two defects rode in that one construction: a `zh-CN` or `de-DE` console still grouped and pointed decimals the US way, and a four-digit **year** stored as `Field.number({ scale: 0 })` rendered as `2,026` — in every locale, with no field property able to turn it off. Apps had been converting year columns to `Field.text` to escape it, permanently trading numeric comparison, range filters and dataset dimension types for a display detail.

  The construction had been copied into five places — the number cell renderer, the currency cell renderer, the `CurrencyField` widget, the compact `formatNumber` helper, and the dashboard `MetricWidget` — so fixing any one surface never changed the answer. They now share one formatter, `formatDisplayNumber` in `@object-ui/i18n`, which owns the locale and the grouping policy together, plus one locale resolver, `useDisplayLocale`.

  `useDisplayLocale` composes the two locale channels this repo already had rather than adding a third: the tenant's regional default (`useLocalization().locale`, ADR-0053) when an org has configured one, otherwise the active UI language (`useObjectTranslation().language`) so grouping and decimal marks follow a language switch. That second step is what covers the case the report was measured in — a fresh database, where the tenant localization endpoint has no locale to give.

  Grouping is now suppressed when a field declares `scale: 0` and carries no currency, which is what makes years, fiscal periods and other ordinals render plainly. This is an **interim default** with an accepted cost: a large scale-0 _count_ loses its separators too. It holds only until the spec gains an authorable presentation hint, which is being specified separately, contract-first; when that lands it overrides this heuristic.

  Three surfaces deliberately keep their separators, because a zero-decimal display there does not come from a field declaration: the dashboard `MetricWidget` (its decimals are parsed from a numeral.js format pattern, and its own contract calls the separators load-bearing — "`1,930,000` not `1930000`"), the `element:number` aggregate renderer, and every currency path including amounts whose currency code could not be resolved. An **undeclared** `scale` also keeps grouping — absent means "decimals unknown", not "integer".

  `formatCurrency`, `formatCompactCurrency` and `formatNumber` each take a new optional trailing `locale` argument. Existing calls are unaffected; omitting it now follows the runtime default rather than forcing US conventions.

- ac853ce: i18n: retire the reader-less `common.search` key from all ten locale packs

  `common.search` (`Search`, no ellipsis) had exactly one consumer: `LookupField`
  built its dialog placeholder by concatenating the key with three ASCII full
  stops. objectui#4375 / PR #4391 retired that concatenation — the placeholder is
  the reused `table.search` pack value (`Search…`, one U+2026 glyph), which is what
  brought it under objectui#3878's glyph pin. That left `common.search` with zero
  readers repo-wide while it still existed in all ten packs.

  Re-verified before deleting, repo-wide: no `t()` call site in any package or app,
  no MDX or JSON reference, and the one dynamic template-literal reader of the
  `common` namespace takes a two-member union parameter (`'openChat' |
'closeChat'`) that cannot resolve to it. No user-visible string changes — this key never rendered.

  The dormant copy in `@object-ui/fields`' no-provider fallback table
  (`useFieldTranslation.ts`'s `FIELD_DEFAULTS`) goes with it. That table is a
  module-local `Record<string, string>` read only when no `LocalizationProvider`
  is mounted; it is not exported, so removing an entry no reader asks for changes
  no rendered output and narrows no public type. Hence patch for that package,
  while the pack change is a minor: deleting a key from `en` narrows the exported
  `TranslationKeys` type (`typeof en`), so code indexing `TranslationKeys` at
  `common.search` stops type-checking. Same grading, for the same reason, as
  objectui#4145's `report.editor.*` retirement. No runtime consumer existed to
  break.

  Retiring a key from `common` was the ruled decision on objectui#4392 rather than
  keeping it as vocabulary: nothing pins a dormant key's meaning, so its next
  reader inherits an unreviewed contract, and a dormant key beside a live
  `table.search` is where a second dialect gets started. The objectui#4328
  dead-surface family has consistently chosen removal for zero-consumer surfaces.

  The neighbouring `common.select` (minted one commit earlier by objectui#4386 /
  PR #4397) is a different key and is untouched.

  A negative pin (`packages/i18n/src/__tests__/common-search-retired-4392.test.ts`)
  fails if the key returns to any pack, if any package reads or re-declares it, or
  if a dynamic `common.*` reader grows a `search` member — every existing i18n gate
  runs call site to key, and none of them can see a key with no call site.

- 06915b0: fix(i18n): every date branch threads the active locale, so a `zh` session no longer renders half its dates in English

  Date rendering had two locale channels and only one followed the user's
  language, so the same row could read `逾期 6 天` in one column and `In 3 days`
  in the next, with a datetime column showing `8/11/2026 12:00 am`
  (objectui#4468).

  The overdue phrase resolves through the translate fn (the active UI language),
  while every `Intl` branch took its tag from the raw tenant locale
  (`useLocalization().locale`) — which is `undefined` on any workspace that never
  configured one, and `undefined` makes `Intl` use the _machine's_ locale.
  `DateTimeCellRenderer` passed no tag at all.

  Every date-formatting site in `@object-ui/fields` now resolves through the one
  existing channel, `useDisplayLocale()` (tenant regional default → active UI
  language → `en`): `DateCellRenderer` (relative past, relative future, near-today
  and the beyond-±7-days absolute fallback), `DateTimeCellRenderer`, the read-only
  `DateField` / `DateTimeField` / `FormulaField` faces, and the sub-grid's
  temporal cells. English output is unchanged, and the already-localized overdue
  wording is untouched.

  No public signature changed. `@object-ui/i18n` carries a documentation
  correction only: `useDisplayLocale`'s docstring claimed `DateCellRenderer`
  already formatted from this channel, which was the very thing that was not true.

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
  - @object-ui/providers@17.5.0

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

- 65bb513: fields: remove the docs-demo registration path (`registerFields` + `createFieldRenderer`), and host the docs field examples in a real form

  **Breaking (shipped as `minor` per AGENTS.md §版本号策略 — objectui's major tracks `@objectstack`, so the repo's own breaking changes are `minor` with the break spelled out here):** two public exports are removed from `@object-ui/fields`:

  - `registerFields()` — registered every widget under the same `field:<type>` keys as `registerAllFields()`, but wrapped in a demo-only renderer. Two paths writing the same registry keys meant whoever ran LAST won it for every consumer sharing the registry.
  - `createFieldRenderer()` — that wrapper. It synthesized a `label`, a description, and a local `useState`/`onChange` around a widget.

  **Migration:** there is nothing to migrate for an application. `registerAllFields()` runs on import of `@object-ui/fields` and is the one registration seam (`registerField(type)` for a single type); no shipped application ever called the removed pair — the docs site was the only caller. Code that rendered a **bare field node** standalone (`{ type: 'currency', label: 'Amount' }`) and relied on the wrapper for label and value state must host the field in a form instead: `{ type: 'form', fields: [{ name: 'amount', label: 'Amount', type: 'currency' }] }`. Seed values through the form's `defaultValues`, not a field-level `value`.

  **Why the removal rather than a relocation** (ruling B of objectui#3798, confirmed by the maintainer; objectui#3308 is the origin, PR #3793 the safety net that first corrected the misleading `@deprecated` note): the wrapper existed only so the documentation could render a bare field node as a labelled, editable input. No application produces that rendering — on the live path a bare field node has no host for its label or its value. So the field docs, which are a first-hand transcription source for AI authors, were teaching a shape that does not work, and an author copying it got a node with neither label nor `onChange`. Relocating the wrapper into the docs site would have preserved that divergence under a new owner. Hosting the examples in a real form removes the reason for the wrapper to exist: the form renderer already owns label and value state, so the docs can only show what an application actually renders.

  The 74 bare-node examples under `examples/schema-catalog/src/schemas/fields-*` are now form-hosted (the other 2 already were). A field's `value` moved to the form's `defaultValues`, because the form renderer spreads react-hook-form's state after the schema props and a field-level `value` is therefore ignored — a catalog guard now pins that so a dead `value` cannot come back.

- b19162d: Build and publish `@object-ui/fields/style.css` — the subpath the package has always declared and never shipped

  `packages/fields/package.json` has declared `"./style.css": "./dist/index.css"` for the package's entire life, while its build was `tsc && vite build` and the package contained no `.css` file for Vite to extract. **No published version up to and including 17.3.0 contains a stylesheet** — the `@object-ui/fields@17.3.0` tarball has zero `.css` files in it. The subpath did not merely render badly, it failed to resolve: a consumer writing the `@import '@object-ui/fields/style.css'` that the quick-start guide taught got a build error. This release is the first one where that import works, so it is a new capability rather than a repair of a working one, and no existing consumer can be relying on the old behaviour — an import that never resolved has no working callers.

  Removing the export was the cheaper option and was rejected on a measurement: fields' class surface is not a subset of what `@object-ui/components` publishes. 155 classes exist only here, and 17 of them (`hover:bg-accent/30`, `ring-destructive/50`, `bg-primary/20`, …) resolve `@theme` tokens declared in unpublished package source, so no consumer-side Tailwind configuration can generate them. Dropping the export would have made the field widgets permanently under-styled with no supported remedy.

  The new sheet is a **supplement, not a replacement** — it is compiled against the components theme and then has every rule that package's sheet already ships subtracted from it, so it is ~22 kB rather than another ~180 kB of near-duplicate CSS. Import it after the components sheet:

  ```css
  @import "tailwindcss";
  @import "@object-ui/components/style.css";
  @import "@object-ui/fields/style.css";
  ```

  Also adds a workspace-wide guard (`scripts/__tests__/package-files-exist.test.ts`) that fails when any package exports a subpath its published tarball cannot contain, so a stylesheet export with nothing building it cannot recur silently.

- 1bd6faa: fix(fields,plugin-form): stop the inline child grid from collapsing `datetime`/`time` columns onto the `date` control

  `deriveMasterDetail`'s `fieldTypeToColumnType` mapped `date`, `datetime` and `time` onto the single `date` grid column type, and `GridField` renders that as `<input type="date">`. The consequence was not cosmetic: that control emits a bare `YYYY-MM-DD` on change, so a user who merely re-picked the **day** of a `datetime` cell silently wrote the record's time component out of existence — a `14:30` became midnight with no warning and no undo.

  `GridColumn['type']` now carries `'datetime'` and `'time'` alongside `'date'`, and each renders its own control with its own read/write adapter:

  - `datetime` → `<input type="datetime-local">`, read through `toDateTimeInputValue` and written back through `fromDateTimeInputValue`, so the stored shape stays ISO-8601 and read and write share one basis (the contract `DateTimeField` already follows, objectui#3127).
  - `time` → `<input type="time">`, round-tripping the stored zone-less `HH:mm[:ss]` verbatim.
  - `date` → unchanged.

  The read-only surfaces are fixed with it. `displayText()` and the read-only table both fell through to `String(value)` and printed the raw stored ISO on screen (`2026-06-17T00:00:00.000Z`); each temporal type now formats as itself — a day for `date`, day + local time for `datetime`, the wall clock for `time`. That could not be fixed before the type collapse was undone, because with one column type the renderer had no way to know which of the two to show.

  Authors writing explicit grid `columns` can now declare `type: 'datetime'` / `type: 'time'`; previously those spellings were not part of the exported union.

### Patch Changes

- 0186cdc: `address` widget: the ZIP box now reads and writes `postalCode`, the part name the platform stores

  `AddressField` bound its ZIP input to `zipCode` — a part name that appears
  nowhere in `@objectstack/spec`. The stored value uses `postalCode`, which
  `AddressValueSchema` declares and enforces with `$strip` semantics, so the two
  sides never met:

  - opening a stored address showed an **empty** ZIP box (no input read
    `postalCode`), while street / city / state / country all populated — four of
    five parts working is what let this survive review;
  - anything the user then typed into that box was written back as `zipCode` and
    **stripped at the contract boundary**. On a new record the postal code was
    lost outright; on an existing one the correction was silently discarded and
    the stale stored code remained, with no error anywhere.

  The widget now uses `postalCode` throughout — state key, sub-input id, the
  `onChange` part name and the read-only formatter. Data written by the previous
  builds is still **read** through `zipCode` as a compatibility limb, and the
  first edit of any part normalizes such a record onto `postalCode` rather than
  writing the split shape back out. Nothing writes `zipCode` any more, and it is
  deliberately not part of the exported `AddressValue` type, so authoring code
  cannot spell it.

  `AddressValue` is otherwise unchanged in shape; consumers that referenced
  `AddressValue['zipCode']` must read `postalCode`.

  Fixes objectstack-ai/objectstack#5143.

- ea41a59: fix(fields): `BooleanField` uses the control id its host hands down, so a boolean field's visible label is really associated with the switch

  A `boolean` / `checkbox` field inside a form emitted **two** labels with the same text, and the visible one pointed at nothing. `<FormControl>` (a Radix `Slot`) hands the control the id its `<FormLabel htmlFor>` already references, and the widget replaced it with the field name — so `label for="_r_3_-form-item"` had no target while the switch carried `id="notifications"`. Clicking the visible label, the normal affordance for a switch/checkbox row, toggled nothing on every generated form in every app; the accessible name survived only through the widget's own `sr-only` label.

  The widget now honours the id it was handed (`id` is a declared key of the widget contract, forwarded by `toDomProps`) and stops emitting its own label when a host supplied one. Standalone rendering is unchanged: with no host id the id still falls back to the field name and then to `useId()`, and the `sr-only` label — the only accessible name the inline grid editor and the console's action-param dialog have — is still emitted.

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

- c97a45e: Group-labelled field widgets now consume the host label's IDREF in their readonly and zero-option states, so the visible label names something there too

  A field declared `labelling: 'group'` (objectui#3961) is named by IDREF: the form
  renderer publishes its `<FormLabel>`'s own `id`, drops the inert `for`, and hands
  the widget `aria-labelledby` plus the host control `id`. All seven such widgets
  consumed that pair on their editable surface only. A field-level
  `readonly: true`, and an option list that resolved to zero offered options, take
  early returns that render before the container doing the consuming — so the label
  published an id that no element in the document referenced.

  Measured on the previous `main`, one field per row in a real form, counting the
  elements that reference the host label's published id:

  ```
                               consumers  byLabelText  named group
  multiselect  readonly+value      0           0           0
  multiselect  readonly+empty      0           0           0
  multiselect  zeroOptions         0           0           0
  multiselect  editable            1           1           1
  ```

  All seven measured identically in every readonly state; each is 1 now. The
  user-visible effect is the one objectui#3961 fixed for editable fields: the
  visible label was the accessible name of NOTHING, so a readonly "Tags" or
  "Shipping Address" was announced as loose text next to unattributed values. It is
  not a regression of #3961 or objectui#3975 — before them these same states
  emitted a `for` pointing at an id no element carried, which named nothing either.
  The shape changed from a dangling `for` to an unconsumed IDREF; the defect did
  not.

  Each readonly surface now carries exactly two keys — the host `id` and
  `aria-labelledby` — plus the `role="group"` that makes them meaningful, in one
  shared spelling (`toHostGroupProps`). The narrow pair is deliberate: a readonly
  display has no focusable control, so `aria-describedby` / `aria-required` /
  `disabled` / the focus handlers have nothing to announce on, and `name` on a
  `div` is exactly the DOM leak objectui#3291 sweeps for.

  Two widgets answer with a different role than they do while editable, because
  they render a different surface: `radio` (editable `radiogroup`) shows the chosen
  option's label as text with no radios in it, and `file` (editable `button`, the
  dropzone) shows file names with no dropzone. `role="group"` is also what the
  shared "no options available" box now answers with for `checkboxes` / `radio` /
  `multiselect`; the single `select` is not group-labelled, keeps its working
  `for`, and that box emits nothing new for it.

  Standalone rendering is untouched. The grid's inline cell editor and bare SDUI
  nodes hand down neither key, so nothing is emitted and the markup stays
  byte-identical — including the `EmptyValue` placeholder, which keeps its own
  `aria-label` and gains no role. Hosted-and-empty, that placeholder is the whole
  readonly surface, so it carries the group props: its `aria-label` ("No value") is
  then outranked by `aria-labelledby` per accname, which is the intended outcome —
  on the `generic` role that span carries, an author name is prohibited and was
  never exposed, so the choice was between the field's name and no name.

- d8a0be4: A form-hosted `multiselect` field is now NAMED by its visible label. It was the
  residual of objectui#3961: that issue's probe audited six widgets and fixed
  them, and re-running the same probe over the whole widget map afterwards put
  `multiselect` on the byte-identical failure shape as `checkboxes` — the host's
  `id` kept, but on the chip row's wrapper `div`, where a `<label for>` is inert
  HTML (`HTMLLabelElement.control` is `null`, so it activates nothing and
  contributes no accessible name). Measured on the tree that already carried
  #3961's fix, one field per row:

  ```
  checkboxes   for=(none) ownId=…-group-label   byLabelText=1(div[role=group])
  multiselect  for=…-form-item ownId=(none)     byLabelText=0
  ```

  Visually the field had a "Tags" label; a screen reader heard only "Alpha" /
  "Beta" and nothing about what the set of chips was for.

  No new mechanism — #3961's declaration, applied to one more widget:
  `multiselect` declares `labelling: 'group'` at the registration boundary, so
  the form renderer publishes its label's `id` and drops the dead `for`, and the
  chip row answers with `role="group"` + the handed-down `aria-labelledby`.

  Unchanged on purpose: each chip keeps its own accessible name from its text
  content (the group name sits one level up and does not override it), and
  STANDALONE rendering — the grid's inline cell editor, a bare SDUI node, where
  nobody hands an id and there is no host label to point at — emits no role and
  no IDREF, exactly as before.

- f4b97c8: `percent` / `progress` cells now give the NUMBER shrink priority over the decorative bar (objectstack#5066)

  In a narrow clipping container the percent display renderer sacrificed the wrong
  half of itself. It emitted a `w-16 shrink-0` bar in front of a shrinkable value
  span, so in a `record:highlights` chip — `basis-[9rem]`, shrinking toward
  `min-w-[7rem]` as chips are added, clipping with `truncate` — the 64px bar plus
  the 8px gap consumed the content box and `truncate` removed what was left of the
  value. A stored `33.33` carried `33%` in the DOM and read as `3` on screen
  (measured: 79px clip box, 32px text node, 25px overflow), with no ellipsis and
  nothing in the accessible name to signal the loss: a silently smaller, plausible
  number rather than a cosmetic glitch. Downstream the app had to override the
  highlight's render type to `number` to get its digits back, losing the `%` glyph
  and the bar entirely.

  The priority is now inverted, on the principle that the number is the CONTENT and
  the bar is DECORATION: the value span is `shrink-0` and the bar carries
  `min-w-0 shrink`, keeping `w-16` only as its PREFERRED width, so a squeezed
  container eats the bar and the digits survive intact.

  The bar is deliberately NOT `flex-1`. `flex-1` would let it GROW as well as
  shrink, stretching the bar across every wide grid cell and changing a surface
  that has no bug; `w-16` stays the upper bound, so wide containers render exactly
  as before and only the shrink direction changed. Below roughly 40px of content
  the bar has collapsed to nothing and the value clips like any other single-line
  cell — same floor as the plain number renderer, which is as far as a
  self-contained renderer fix reaches (the chip's own width is a function of how
  many chips the record has, so the strip's `@container` cannot see it).

  The neighbouring `number` renderer is untouched.

- c2ecbae: 相关列表 Add 选择器兑现 `add.picker.filter`:作者限定的候选范围现在真的生效

  `record:related_list.add.picker.filter` 被 spec 声明为「Restrict which records the picker offers」,但渲染器从未读过它 —— 挂 `RecordPickerDialog` 时不传任何 filter,对话框照样提供 `picker.object` 的全部记录,选中即建链接行或改父,`os validate` / `os build` 全绿、运行时零诊断。作者写下「只允许指派 active 的岗位」「只允许挂未过期的许可」,得到的是完整候选列表。

  现在它按原样传给 `RecordPickerDialog` 的 `baseFilter` —— 不是 `lookupFilters`,后者会把条件渲染成用户可编辑的筛选栏行,等于把作者的硬性限制降级成建议。

  `baseFilter` 因此接受两种形状,按结构判别(`Array.isArray`):

  - **`QueryParams.$filter` 记录形式**(依赖型 lookup 链)保持原有的键覆盖语义逐字节不变 —— 级联父值必须**替换**同字段上过期的 `lookupFilters` 条目,而不是与之求交。
  - **spec 的 `ViewFilterRule[]`** 经 `mergeFilterNodes`(仓内唯一的 filter 下沉口)下沉,19 个 operator 全部无损到达服务端,包括记录形式没有 `$op` 可用的 `before` / `after` / `is_empty` / `is_not_empty`。此处**不新增**第二份 operator 词汇表。

  槽位类型同时从 `Record<string, any>` 收紧为 `unknown`:前者会接受规则数组(数组满足 `any` 的字符串索引),旧的对象展开再把它压成 `{"0": {...}}`,于是查询去过滤名为 `0` 的列 —— 类型全绿、查询错误、无任何诊断。

- 11c1e71: Resolve a `select` field declared `multiple: true` to the `field:multiselect` widget, so the object form's visible label actually names the chip picker it renders (objectui#3986).

  `mapFieldTypeToFormType` keyed the widget id on the field's `type` string alone, so an object-schema `{ type: 'select', multiple: true }` picklist — a spec-legal, entirely ordinary shape — became `field:select`. `SelectField` then delegated to `MultiSelectField` on `config.multiple`, so the component that RENDERED was the chip picker while everything keyed on the widget id still answered for the single-value combobox. Above all the label-association declaration (`ComponentMeta.labelling`, objectui#3961), which the form renderer resolves per widget id: the host emitted `<label for>` at the chip row's wrapper `div`, where a `for` is inert — `HTMLLabelElement.control` returns `null`. Visually the field had a label; in the accessibility tree that label named nothing. Measured on the object-form path, `role=group` + accessible name went from 1 for a `multiselect`-typed field (fixed in objectui#3975) to 0 for this one.

  Declaring `select` itself `labelling: 'group'` was not available: a single-value select's trigger is a labelable `button[role=combobox]` whose `for` association works, and a bare `select` is a builtin the renderer resolves without consulting the registry at all. The fix is therefore at the producer — the widget id now carries the arity, so one place decides which widget renders and the declaration can no longer be addressed to a widget that is not rendering.

  - `mapFieldTypeToFormType(fieldType, config?)` takes an optional second argument — the rest of the field definition, of which only `multiple` is read. Existing single-argument calls are unchanged, and so is every type outside the new table: `select` is the only one whose `multiple` form is a different WIDGET. The spec's multi-capable set is larger (select / lookup / file / image, with `radio` on the select branch and `user` storing like `lookup`), but `LookupField`, `FileField` and `ImageField` each render both arities themselves, so their id — and their labelling declaration — is already right for either.
  - The four object-form producers pass the pair: `ObjectForm`, `DrawerForm`, `ModalForm`, and `sectionFields` (Tabbed / Wizard / Split / Drawer / Modal). In `sectionFields` the id is now computed once from the EFFECTIVE pair, after view-level overrides have merged, because `multiple` is itself a spec `FormField` key: a view restating only `multiple: true` over a single-value object field moves the widget too, and `multiple: false` moves it back.
  - `SelectField`'s `multiple` delegation is KEPT, not retired. Measured, it stays reachable from three entrances that never consult the alias map: the inline grid editor (`FieldEditWidget` finds `select` in its own table first), `ActionParamDialog` (`resolveFormWidgetType` returns `select` from `fieldWidgetMap` first), and hand-written SDUI addressing `field:select` by name with `multiple` on its metadata.

  Read-only rendering of these widgets is untouched (objectui#4005), as is the built-in `Select` branch (objectui#3976).

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
  - @object-ui/providers@17.4.0

## 17.3.0

### Minor Changes

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

- 19b8c9b: Field widgets no longer spread renderer-only props — or arbitrary keys from a
  field config — onto the DOM element they render (objectui#3291).

  **Behaviour change:** an unknown key written on a field configuration (or on an
  SDUI `field:*` node) stops becoming an HTML attribute on the rendered control.
  Nothing reads those attributes, but they were serialized into the DOM, into
  snapshots, and into anything scraping rendered markup.

  ## What was happening

  Widgets forwarded their leftover props with a bare spread, so whatever a host
  handed them became an attribute. Measured on a real form with a real widget:

  ```
  <input placeholder="PH-f" zzcanary="CANARY-STR" zzcanaryobj="[object Object]"
         zzcanarynum="42" id="…" type="text" value="" name="f">
  ```

  `zzcanaryobj="[object Object]"` is an ordinary extra key on the field config
  being `String()`-ed onto an attribute. React 19 does not warn about any of it:
  an all-lowercase unknown attribute is passed through in complete silence, which
  is why this went unnoticed.

  Eleven widgets carried a line that looked like it prevented exactly this:

  ```ts
  const { inputType, ...domProps } = props as any; // "Filter out non-DOM props"
  ```

  `inputType` is already stripped by the form renderer before a widget sees it,
  so that line filtered nothing — the comment actively misled. It is gone.

  ## What changed

  - New `toDomProps(props)`, exported from `@object-ui/fields`. It keeps only
    what may legitimately become a DOM attribute and drops the rest.
  - The 14 field widgets that spread onto a host element now go through it:
    `text`, `textarea`, `number`, `boolean`, `date`, `datetime`, `time`, `email`,
    `phone`, `url`, `password`, `currency`, `percent`, and `select`.

  **It is a whitelist, not a list of keys to drop.** The largest leak source is
  not any named renderer prop — it is the open tail of author-supplied keys. The
  form renderer destructures a fixed set of known keys and forwards the rest
  verbatim, and `SchemaRenderer` is wider still: it spreads the whole authored
  node as props with no strip layer at all, so on that path a widget's own spread
  is the only line of defence. A blacklist of today's renderer-only props would
  pass every canary above and would not stop the next authored key either.

  The forwarded set is the one `FieldWidgetComponentProps` already **declares**:
  `id`, `name`, `autoFocus`, `tabIndex`, `onBlur`, `onFocus`, `onClick`,
  `className`, `disabled`, plus `aria-*` and the `data-*` family. Until now that
  was a type-level claim a widget could violate at runtime just by spreading;
  `toDomProps` is its executable form.

  Two compile-time assertions tie the helper to the declaration, and it is worth
  being exact about which drift each one prevents:

  - the contract's DOM pass-through block is now a named type
    (`FieldWidgetDomProps`), and **both directions are compiler-bound**:
    forwarding a key the contract does not declare fails to compile, and
    declaring a DOM key the helper does not forward fails to compile too. The
    second direction guards _declared but not delivered_ — a key that
    type-checks, reads as supported, and silently never reaches the element. The
    leak test structurally cannot see that class of bug: it looks for attributes
    that arrive, not for ones that go missing.
  - `className` and `disabled` are bound in the **forward direction only**. They
    are DOM-legal and are forwarded, but they live in the controlled-input block
    because widgets also interpret them, so they are deliberately outside
    `FieldWidgetDomProps`.

  An HTML global attribute the contract does not declare (`role`, say) is no
  longer forwarded. It only ever arrived through the open spread. If a field node
  should be able to author one, declare it on `FieldWidgetComponentProps` and add
  it to the whitelist — the fix belongs at the contract, not in a wider spread.

  ## Regression gate

  A new contract test renders **every** registered field widget through **both**
  hosts — the real form renderer and `SchemaRenderer` — and fails on any
  attribute HTML does not define for that element. It walks real DOM attributes
  rather than listening for React warnings (React 19 is silent for the exact case
  that leaked), asserts a validation error genuinely rendered before scanning the
  error variant, and calibrates its own judge against two fixtures: standard
  markup that must produce zero findings, and planted fake attributes that must
  all be found. A new widget type is covered automatically — the sweep is derived
  from the widget registry, so adding one without covering it fails the test.

- 56409c2: Field widgets are finally told when their field fails validation, and the props
  slot that carries it takes the name the published contract gives it
  (objectui#3222).

  **Breaking** for anyone implementing a field widget (see migration below). The
  repo version policy keeps this a `minor` — objectui's major tracks
  `@objectstack`'s — so read the bump as "breaking within objectui".

  ## The a11y defect this fixes

  `@objectstack/spec/ui`'s `FieldWidgetPropsSchema` — the published contract that
  third-party and AI-authored field widgets are written against — has always
  declared `error?: string`. `@object-ui/fields` declared its own slot as
  `errorMessage`. That looked like a naming split; it was worse:

  ```
  producers of `errorMessage` anywhere in packages/ + apps/ :  0
  reads of `errorMessage` in packages/fields/src            : 15  (7 widgets)
  reads of `props.error`                                    :  0
  ```

  The slot was dead under BOTH spellings. No host ever passed it: the form
  renderer showed validation text through its own `<FormMessage/>` and never
  forwarded the prop. So `EmailField`, `CurrencyField`, `UrlField`,
  `RichTextField`, `PercentField`, `TextAreaField` and `PhoneField` each computed
  `aria-invalid={!!errorMessage}` from a value that was `undefined` forever —
  **`aria-invalid` had never once been set, and a screen reader was never told
  the field had failed validation.**

  Worse than "never set": `<FormControl>` is a Radix `Slot` that hands its child a
  CORRECT `aria-invalid`, but a widget's own attribute is written after the props
  spread, so it wins. Those seven widgets were actively overwriting the right
  answer with `false`.

  FROM: `renderFieldComponent` received no validation state, and the widget props
  type declared `errorMessage?: string`, which nothing produced.
  TO: the form renderer passes react-hook-form's `fieldState.error?.message` down
  as `error` when it renders a registered widget, and the props type declares
  `error?: string`. Both ends of the contract are live for the first time; a
  rename alone would only have swapped one dead key for another.

  ## Migration for widget authors

  ```diff
  -export function MyField({ value, onChange, field, readonly, errorMessage }: FieldWidgetComponentProps< string >) {
  -  return <Input value={value} aria-invalid={!!errorMessage} />;
  +export function MyField({ value, onChange, field, readonly, error }: FieldWidgetComponentProps< string >) {
  +  return <Input value={value} aria-invalid={!!error} />;
  ```

  No alias is kept. `errorMessage` was retained nowhere on purpose — a tolerant
  second spelling is exactly the de-facto second contract AGENTS.md #0.1 forbids,
  and it is what would let a missed call site go quiet again. Because
  objectui#3221 had already removed the type's `[key: string]: any`, every missed
  site is a compile error rather than a silent `any`, so the compiler — not grep
  — validated this rename.

  ## Responsibilities are split, not duplicated

  The widget consumes `error` **only** to drive `aria-invalid` on the control it
  renders (which only it can do — `aria-invalid` has to sit on the input element).
  The message TEXT stays with `<FormMessage/>` in the form renderer. A widget that
  also renders the text double-displays it, and the docs, the agent prompt and the
  tests all now say so.

  For the same reason `required` — also declared by the spec, also never delivered
  — is deliberately NOT lowered into widget props: the required marker has exactly
  one author, the renderer's `<FormLabel>`, and giving widgets the flag invites a
  second asterisk. The a11y state a widget could legitimately carry is
  `aria-required`, which needs no contract change at all (`AriaAttributes` is
  already part of the type and widgets already forward it).

  Builtin field types are unaffected: they render inside `<FormControl>`, whose
  Slot already supplies `aria-invalid`, so `error` is stripped there rather than
  leaking into the DOM as a stray attribute.

  Docs updated to match: `content/docs/guide/plugin-development.md`,
  `skills/objectui/guides/plugin-development.md` and
  `.github/prompts/component.prompt.md` — the last of which additionally used the
  spec's non-generic type alias as a generic (`FieldWidgetProps< number >`) and
  destructured a `mode` prop that exists on neither type.

- 042e09d: **BREAKING (v17)** — field widgets receive their metadata on ONE key, `field`.
  `schema` is removed from the widget contract (objectui#3233).

  ## What changed

  `schema` was a second carrier for what `field` already means. Two producers fed
  it: `SchemaRenderer` passed the authored node as `schema`, and the form
  renderer's `renderFieldComponent` passed `schema={props.field || props.schema ||
props}` _alongside_ `field`. The predictable result was ~30 widgets resolving
  their config as `field || schema` — one concept, two spellings, a de-facto
  second contract (AGENTS.md #0.1).

  - `FieldWidgetComponentProps` no longer declares `schema`. Reading
    `props.schema` is now a compile error, not a silent `any`.
  - Both producers converged. The form renderer passes `field` only. The SDUI node
    → `field` translation happens exactly once, in a new registration adapter
    (`withFieldCarrier`), which every built-in field widget is registered through.
  - All `field || schema` reads in `@object-ui/fields` are now plain `field` reads.

  ## Migrating a widget you wrote

  **Reading the metadata** — replace the fallback with the single key:

  ```diff
  -const config = field || (props as any).schema;
  +const config = field;
  ```

  **Registering a widget** — if your widget can be rendered from a schema node
  (anything `SchemaRenderer` dispatches, not just forms), wrap it once so it still
  gets `field`:

  ```diff
  +import { withFieldCarrier } from '@object-ui/fields';
  +
  -ComponentRegistry.register('color', ColorField, { namespace: 'field' });
  +ComponentRegistry.register('color', withFieldCarrier(ColorField), { namespace: 'field' });
  ```

  `withFieldCarrier` forwards the node **by reference** — nothing is copied,
  narrowed or renamed — and consumes `schema` so it cannot reach the DOM through a
  widget's `...props` spread.

  A third-party widget that still reads `props.schema` and is **not** re-registered
  through the adapter will read `undefined` in v17 and silently render an empty /
  default state. That is the deliberate cost of a major boundary: one contract
  beats N dialects, and a widget that picks the wrong spelling should fail at
  compile time rather than work under one host and not another.

  ## What did NOT change

  - **Host metadata (SDUI JSON) is untouched.** No authored schema changes; this is
    a change to how widgets are _written_, not to what apps declare.
  - **`schema` is still the universal SDUI prop** every registered component
    receives from `SchemaRenderer` (`element:*`, `page:*`, grids, reports). Only
    the _field-widget_ contract retired it. In particular `renderFieldComponent`
    still passes `schema` when a form field type resolves to a plain component
    through the bare-name fallback (e.g. `type: 'text'` reaching the display text
    widget) — that component's contract is the node, and dropping it there would
    render `undefined.className`.

  ## Payload equivalence

  Every path that used to deliver a payload through `schema` now delivers the
  identical object through `field`, and both halves are pinned by tests asserting
  **object identity**, not shape:

  - form path — `packages/components/src/renderers/form/__tests__/form-field-carrier.test.tsx`
  - SDUI path — `packages/fields/src/__tests__/field-carrier-sdui.test.tsx`

- 30ae33a: `RichTextField` honours `mobile_fullscreen`, so `mobile.fullscreenLongText` is
  finally true of rich text too (objectui#3301).

  `ObjectFormSchema.mobile.fullscreenLongText` has always been documented as
  "textarea/rich-text get an expand button", and `ObjectForm` has always stamped
  `mobile_fullscreen` onto `field:markdown` / `field:html` fields to deliver it.
  Both of those types resolve to `RichTextField`, and that widget never read the
  flag: a producer with no consumer. Turning the setting on gave a phone user an
  expand affordance on their textareas and nothing at all on their markdown or
  HTML fields, with nothing anywhere reporting that half the feature was inert.

  FROM: `RichTextField` ignored the flag entirely (`grep fullscreen` over that
  file returned nothing). TO: it reads `field.mobile_fullscreen` — the same single
  metadata carrier `TextAreaField` reads, and nowhere else — and renders the same
  expand affordance and full-height editing dialog.

  **The affordance now has one implementation, not two.** One form-level setting
  should produce one behaviour, so the expand button, the dialog and the
  draft/commit semantics moved into a shared `FullscreenFieldEditor` that both
  widgets render; only the EDITOR is per-widget. A second hand-written copy of
  that state machine would be the same defect this release fixes, with an extra
  step — it drifts, and nothing reports the drift. The rich-text dialog hosts the
  widget's real editing surface (same format indicator, same editor), not a bare
  textarea, so whatever that editor grows into, both positions get it at once.

  Behaviour is identical across the two widgets and unchanged for
  `TextAreaField`: the dialog seeds its draft from the committed value at open
  time, keeps typing local (a react-hook-form field is not marked dirty by an
  edit the user may still cancel), commits once on "Done", and discards on
  "Cancel". Test ids follow the existing convention per widget —
  `richtext-fullscreen-toggle` / `-dialog` / `-input` / `-save` alongside the
  `textarea-*` ones, since a single form can contain both.

  There is deliberately no prop spelling of the flag and no `??` fallback chain in
  either widget. The field metadata is the one carrier (objectui#3233), so a
  misspelled or misplaced flag stays inert and visible rather than being quietly
  caught by a tolerant consumer.

  Also removes a dead type from the producer: `ObjectForm` stamped the flag on
  `'string-multiline'`, a string that `grep -rn` finds exactly once across both
  this repo and `objectstack` — that line itself. No producer emitted it, no
  registry key matched it, no widget read it. The remaining four stamped types
  (`textarea`, `field:textarea`, `field:markdown`, `field:html`) each have a real
  reader.

### Patch Changes

- b7165ce: AddressField / GeolocationField sub-inputs now derive their DOM ids from a `useId()` prefix + sub-field name (the RadioField / CheckboxesField `groupId` paradigm) instead of hardcoded literals ("street", "city", "state", "zipCode", "country", "latitude", "longitude"). Two address or geolocation fields in one form no longer produce duplicate DOM ids, and each sub-label's `htmlFor` resolves to and focuses its own field's input instead of the first match in the document (#3343).
- 7d08c3f: `TextAreaField` / `RichTextField` now honour `disabled` on their fullscreen editing path. `disabled` used to reach the inline control only: `showFullscreenButton` never consulted it, neither widget forwarded it to `FullscreenFieldEditor`, and that component did not declare the prop at all. A disabled long-text or rich-text field therefore sat correctly greyed out next to a live expand button whose dialog accepted any edit and wrote it straight back through `onCommit` — reproduced dynamically before the fix as toggle `disabled=false`, dialog input `disabled=false`, `onChange` called with "EDITED WHILE DISABLED". The state was easy to miss precisely because the visible control looked right.

  `FullscreenFieldEditor` now declares `disabled`: the expand button stays (disabled means "not interactive, muted", unlike `readonly`, which suppresses the affordance entirely via each widget's read-only early return) but is disabled and refuses to open, the dialog's editor is disabled through a new third `children` argument, and "Done" is both disabled and gated before `onCommit`. The dialog locks on its own rather than trusting the button, because the form renderer folds `isSubmitting` into `disabled` — so a submit starting while the dialog was already open used to leave the field editable for the duration of the submit. Cancel and Esc stay live in every state. This is the registered-widget half of the same defect #3400 / #3401 fixed on the built-in `form.tsx` path, so both render paths now give the same metadata the same behaviour (#3402).

- 6fe485b: fix(fields): translate the registered path's fullscreen long-text dialog (objectui#3404)

  `FullscreenFieldEditor` — the expand button and dialog that `TextAreaField`
  (`field:textarea`) and `RichTextField` (`field:markdown` / `field:html`) render
  when `ObjectFormSchema.mobile.fullscreenLongText` is on — shipped four English
  literals: the toggle's accessible name (`Edit {label} fullscreen`), the title
  fallback `Edit text`, `Cancel` and `Done`.

  No translation was missing. `form.fullscreen.*` and `common.cancel` have shipped
  in all ten locale packs since objectui#3272 translated the built-in branch; this
  path simply never consumed them. The result was visible inside a SINGLE form: a
  zh session saw 「取消 / 完成」 on a built-in-rendered long-text field and
  `Cancel / Done` on a registered-widget one.

  All four now consume those existing keys — **no new keys, no locale-pack
  change**. The dialog also gained the sr-only `form.fullscreen.description` the
  built-in branch already carries, so it has an accessible description
  (`aria-describedby`) instead of none.

  Copy resolves through `useFieldTranslation()` (`createSafeTranslation`), as the
  built-in branch does, whose English defaults are byte-identical to the literals
  they replace — so widgets rendered with no `I18nProvider` (standalone/embedded
  hosts) render exactly what they did before rather than raw i18n keys.

- 825bbe3: The option widgets' "this list cannot be filled" message now has one source, and
  it is translated (objectui#3231).

  FROM: `SelectField`, `MultiSelectField`, `RadioField` and `CheckboxesField` each
  carried their own copy of the empty/gated state, each destructured the declared
  `emptyHint` prop into `_emptyHint` and dropped it, and each rendered a hardcoded
  English literal (`'No options available'`, `` `Select ${…} first` ``) even in a
  Chinese or Japanese session. TO: one shared `OptionsEmptyState` — the host's
  `emptyHint` when it supplied one, otherwise a translated fallback
  (`fields.options.empty` / `fields.options.selectFirst`, added to all ten locale
  packs).

  `emptyHint` was declared, produced by the form renderer and transported, then
  lost three times over — so no registered widget could ever render it. All three
  breaks are fixed, because closing only the last one delivers nothing:

  - `isOptionField` compared the raw resolved type against `'select'` /`'radio'` /
    `'multiselect'` / `'checkboxes'`. Object-derived forms emit
    `mapFieldTypeToFormType`'s prefixed ids (`field:select`), which matched none of
    them, so for every option field coming from an object schema — the normal case
    in the console — the whole cascade block was skipped and no hint was computed
    at all. It now normalizes the `field:` prefix, the same normalization
    `stripRegisteredFieldProps` already applied a few lines below.
  - `stripRegisteredFieldProps` then removed the `emptyHint` key from what was
    left. It is now forwarded to the four cascade option types, alongside
    `dependentValues`. This stays an allow-list rather than a blanket
    pass-through: every other registered widget spreads its leftover props onto a
    DOM node, where an unknown `emptyHint` attribute is a React warning.
  - the widgets themselves discarded it. Keeping it out of the `...props` spread
    was correct; not using it afterwards was not.

  User-visible effect: a dependency-gated option list now prompts with the
  controlling field's **label** ("Select Country first") instead of its raw
  metadata name, in the session's language; an unconfigured list says so in the
  session's language too. The gate sentence is one i18n key shared by the renderer
  and the widget fallback, so the two sides cannot word it differently.

  Untouched: the built-in (unregistered) `select` branch of the form renderer,
  which already consumed `emptyHint`. That is a separate live path.

- 34d9169: The record picker's filter panel now sends the AUTHORED value of a picked `select` filter option instead of the control's stringified form. Radix `Select` speaks strings — options render as `String(opt.value)` and `onValueChange` returns that string — and the panel stored it as-is, so a filter option whose value is a number or a boolean queried `{ level: "1" }` against records storing `level: 1`. The user picked an option that plainly has records and got an empty list. This bit the `lookup_filters` auto-derivation in particular: `lookup_filters: [{ field: 'level', operator: 'in', value: [1, 2, 3] }]` derives options whose values keep the author's type (`LookupFilterDef.value` is `unknown`), so every non-string option in the picker was unfilterable. The control's string is now mapped back through `col.options` at the control boundary — the control speaks string, the payload keeps the authored type — reusing the `matchOptionValue` / `toControlValue` semantics `@object-ui/components` introduced for the standalone form's select (#3090), rather than coercing in `filterValuesToRecord`, which would have to guess whether `"1"` meant `1` or `"1"`. Options coming from the object schema are strings by spec and round-trip unchanged, and the `number` / `boolean` filter inputs (which already converted explicitly) are untouched — the `select` branch is lifted to their standard, resolving the three-way inconsistency (#3422).
- 5881a2c: The lookup "Browse all records" Record Picker's filter panel now offers the
  options a `select` field declares in its schema (objectui#3336). `LookupField`
  turns each typed picker column into a filter column, and those carried no
  `options` — so the filter panel's dropdown opened EMPTY and the column could
  not be filtered at all, even though the same column's table cells had rendered
  the authored option labels since objectui#3333.

  `RecordPickerDialog` now fills a `select` filter column's missing `options`
  from `fieldsMeta` (the referenced object's schema `fields` map) through the
  same resolver — and the same i18n option translation — the table cells use, so
  the filter dropdown and the cells can never disagree about what an option is
  called. Explicitly authored filter `options` still win (including the ones
  auto-derived from an `in`/`notIn` `lookup_filters` entry), and a select field
  whose schema declares no options keeps an empty dropdown: no options are
  synthesised from the loaded page's raw stored values.

- 9bc3709: The lookup "Browse all records" Record Picker now formats its columns with
  the same field metadata the list view uses (objectui#3333). Previously the
  dialog handed cell renderers a bare `{ name, type }` descriptor, so a
  `select` column had no `options` and fell back to title-casing the raw
  stored value (`manufacturing` rendered as "Manufacturing" instead of the
  authored option label, e.g. "03 制造") — while the same field displayed
  correctly in the list view and on the record detail page.

  `RecordPickerDialog` gains an optional `fieldsMeta` prop (the referenced
  object's schema `fields` map). When provided, each column's field descriptor
  is enriched from the schema — `options` (run through the shared i18n option
  translation), `currency`, `scale`, `precision`, `format`, `reference_to`, … —
  and columns authored as plain strings in `lookup_columns` inherit the schema
  field's `type`, so they format identically to typed columns. `LookupField`
  passes the referenced object's schema it already fetches for `titleFormat`.
  Callers that don't pass `fieldsMeta` keep the previous behavior.

- 49f7449: `field:select` now announces its validation state to assistive tech: the
  widget's DOM pass-through lands on the Radix `SelectTrigger` — the focusable
  `<button role="combobox">` a user actually interacts with — instead of
  `Select.Root`, which renders no DOM element of its own and silently dropped
  every `aria-*` the form renderer delivered (objectui#3306).

  Before this, a required select that failed validation showed the red message
  while a screen reader was told nothing: `aria-invalid`, `aria-describedby`
  (the link to the message text) and `aria-required` (objectui#3290's state
  channel) all landed on Root and vanished. All three now reach the trigger,
  and the widget computes `aria-invalid` from the published `error` slot after
  the spread, the objectui#3222 discipline — a valid field explicitly says
  `aria-invalid="false"` rather than staying mute.

  Two keys deliberately stay on Root: `name` (Root forwards it to the hidden
  native `<select>` that takes part in form submission) and `disabled` (Root is
  the single authority that disables trigger, items and hidden select together).

  Guarding the whole class forward, a new registry-wide sweep
  (`widget-aria-invalid-registry-e2e.test.tsx`, the objectui#3291 leak-sweep
  paradigm) renders every registered field widget through the real form, drives
  a real validation failure, and asserts `aria-invalid="true"` appears inside
  the field's row. The 29 widget types measured not to deliver yet are pinned in
  a ratchet ledger (tracked in objectui#3318): fixing one turns its ledger row
  red until the entry is removed, so the ledger only ever shrinks.

- c7ed4c3: `TagsField` no longer ships a hardcoded Chinese input placeholder
  (objectui#3342, AGENTS.md Commandment #-1). The placeholder now resolves
  through the pinned chain: the author-declared `field.placeholder` wins
  (previously ignored by this widget); otherwise the widget's own copy arrives
  via `useFieldTranslation()` under the new `fields.tags.placeholder` key, added
  at full parity across all locale packs (Chinese lives in the zh pack, not in
  code); with no `I18nProvider` mounted the English default from FIELD_DEFAULTS
  renders — never a raw key.
- 2409e1d: `TextAreaField`'s character counter now announces itself in the session locale. The counter block — rendered only when the field declares `maxLength` — carried the accessible name `Character count: {n} of {max}` as an English literal, and the element is an `aria-live="polite"` region, so a zh/ja/ar session had that English sentence read out on every keystroke while sighted users saw only the language-independent `{n}/{max}` digits. Nothing was wrong on screen, which is why it survived: only screen reader users could perceive it (#3406).

  Unlike #3404, no key existed to consume — none of the ten locale packs had any character-count string. `fields.textarea.characterCount` is new in all ten, interpolating `{{count}}` and `{{max}}` as one sentence rather than parts assembled in code, because `ja` and `ko` put the cap before the count ("of {{max}} characters, {{count}}"), an order no concatenation can produce. The English pack value and the `FIELD_DEFAULTS` fallback are byte-identical to the literal they replace, so an `en` session and a provider-less embed both render exactly what they did before.

  Behaviour is unchanged: `aria-live="polite"` and the per-keystroke recompute are deliberately untouched here and tracked separately (#3408).

- 789fe3e: `TextAreaField`'s character counter no longer re-announces itself on every keystroke. Measured on `main` in a zh session with `maxLength: 500`, typing a 52-character sentence one character at a time produced 52 distinct screen-reader announcements totalling 979 spoken characters — roughly 19x the text being written, each one cutting off the reader's echo of the letter just typed. The counter element was simultaneously the visible `{n}/{max}` digits, the carrier of the translated sentence and the `aria-live` region itself, so "re-render" and "announce" were the same event; the field also had no `aria-describedby`, so focusing it said nothing about the cap at all (#3408).

  It is now the three-node shape the GOV.UK Design System character-count component uses: the visible digits are `aria-hidden` and purely decorative; the counter sentence (`fields.textarea.characterCount`, unchanged in all ten packs) has moved onto the textarea's `aria-describedby`, so focus reads "Character count: 12 of 500" once and then stays quiet; and a separate visually-hidden `aria-live="polite"` region carries a new near-limit warning, `fields.textarea.charactersRemaining` (new in all ten packs), which stays silent until the value is inside the last 10% or last 20 characters of the cap — whichever the typist reaches first — and updates only after typing pauses for a second. The same 52-keystroke probe now produces zero announcements; a run that types all the way onto a 500-character cap produces five. Any `aria-describedby` the host already supplied (the form renderer's description and error-message ids) is appended to, never replaced.

  No metadata change: the counter still renders exactly when the field declares `maxLength` (or the legacy `max_length`), and a widget rendered with no `I18nProvider` still shows the same English sentences.

- f789c3b: `TextAreaField`'s fullscreen edit dialog now gives screen reader users the character count it has always shown sighted ones. The dialog's footer counter was a bare `{n}/{max}` span: no accessible name, nothing `aria-live`, and nothing tying it to the dialog's textarea — so browse mode read "5 slash 500" if it happened to sweep the footer, and focusing the input said nothing about the cap at all. The inline surface of the same field has carried a proper three-node counter since #3408, so the fullscreen branch was at zero for the same field, the same cap and the same user (#3417). It is reachable on any phone form with `ObjectFormSchema.mobile.fullscreenLongText` on, for every long-text field that declares a limit.

  The counting UI is now ONE shared `CharacterCount` component that both surfaces render, instead of two hand-written copies that could only drift. In the dialog it renders `aria-hidden` digits plus a visually-hidden description carrying `fields.textarea.characterCount`, wired to the dialog's textarea through `aria-describedby`, so focus reads "Character count: 12 of 500" once and the count follows the draft as it is edited. The description ids are per surface, because the dialog's draft and the committed value diverge as soon as the user types.

  The dialog deliberately gets NO live region: it is a modal opened to write at length, the description already delivers the cap on focus, and the inline surface's `aria-live` region stays mounted behind the overlay. The inline surface is unchanged — same DOM, same threshold-gated debounced announcements, same ten locale packs and the same English fallbacks with no `I18nProvider` mounted. No new i18n keys and no metadata change: the counter still renders exactly when the field declares `maxLength` (or the legacy `max_length`).

- a321fa4: `TextAreaField`'s mobile fullscreen flag converges on its one real producer
  (objectui#3232).

  FROM: the widget resolved the "show the expand affordance" decision through a
  four-way `??` chain — a `mobileFullscreen` (camelCase) prop, the field
  metadata's `mobile_fullscreen`, a `mobile_fullscreen` prop, and
  `schema.mobile_fullscreen`. TO: a single read of the field metadata's
  `mobile_fullscreen`, resolved through the `field || schema` carrier pair every
  widget in this package already uses.

  No runtime behaviour changes, because three of those four reads were
  permanently `undefined`:

  - `mobileFullscreen` (camelCase) had **no producer anywhere in the repo** — the
    only occurrences of that spelling were the widget's own read and the
    destructure that kept it off the DOM spread. The doc comment nonetheless
    claimed "the host form passes `mobileFullscreen`", so the contract it
    described had never held.
  - `mobile_fullscreen` as a **prop** cannot arrive: the form renderer's
    `stripRegisteredFieldProps` explicitly removes `mobile_fullscreen` and
    `fullscreen` from the props forwarded to registered field widgets.
  - `schema.mobile_fullscreen` was the same object `field || schema` already
    resolves, so it could only ever restate the metadata read.

  What actually drives the affordance — and is now the only thing that does — is
  the field metadata flag `ObjectForm` stamps onto long-text fields from
  `ObjectFormSchema.mobile.fullscreenLongText`. That path is unchanged and is now
  pinned by tests (button, dialog, and the committed edit), so the cleanup cannot
  have silently removed the working behaviour.

  Also untouched: the built-in (unregistered) `textarea` branch of the form
  renderer, which reads `mobile_fullscreen || fullscreen` off the form-field
  props and renders its own `FullscreenTextarea`. That is a separate live path.

  Why this is worth a changeset rather than a silent tidy-up: reads that nobody
  writes are not free. They document a contract that does not exist — the next
  author follows the comment, passes the prop, and is ignored without a word —
  and a `??` chain that accepts four spellings and rejects none is exactly where
  a misspelled key hides. With one source, a wrong spelling has no read path left
  to absorb it. Per AGENTS.md #0.1 and Prime Directive #12, divergence like this
  converges at the producer, not by accumulating tolerance at the consumer. No
  host-override prop was invented in its place: inventing a key with no producer
  is the same mistake in the other direction.

- 8d8094a: 20 more registered field widgets now announce a failed validation to assistive
  tech: `multiselect`, `radio`, `checkboxes`, `tags`, `lookup`, `master_detail`,
  `user`, `owner`, `file`, `image`, `location`, `object`, `color`, `rating`,
  `code`, `avatar`, `address`, `geolocation`, `qrcode` and `object-ref` carry
  `aria-invalid="true"` on their real focusable control after a validation
  failure, where before the red message rendered while a screen reader was told
  nothing (objectui#3318, the registry-wide gap objectui#3306's sweep measured).

  Each widget follows the objectui#3222/#3306 pattern: the `toDomProps(props)`
  whitelist spread goes onto the control the user actually focuses — the input,
  the lookup trigger button, the radiogroup (`role="radiogroup"` is the
  ARIA-designated carrier for a set of radios), every chip/checkbox/star of the
  composite option widgets, the upload dropzone/button — followed by an explicit
  `aria-invalid={!!error}` computed from the published `error` slot. Wrapper
  `<div>`s never carry the state, and `name` is withheld from non-form-control
  elements (the objectui#3291 leak class).

  `Combobox` (`@object-ui/components`) now accepts standard button attributes
  and forwards them to its focusable `role="combobox"` trigger, giving
  combobox-based widgets an element to deliver `aria-invalid` /
  `aria-describedby` to — the same seam objectui#3306 opened on
  `SelectTrigger`.

  Nine types remain on the objectui#3318 ratchet ledger with their blockers
  documented there (`formula`/`summary`/`auto_number`/`vector` render no
  focusable control; `grid`, `slider`, `signature` need component-level design;
  `filter-condition`/`recipient-picker` deliver in their editable states but
  render a dependency-gate hint with no control in a fresh form).

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
  - @object-ui/providers@17.3.0

## 17.2.0

### Minor Changes

- 785b8a5: `FieldWidgetComponentProps` stops claiming to have every key (objectui#3221).

  **Breaking for widget authors**: the exported `FieldWidgetComponentProps` no
  longer ends in `[key: string]: any`. FROM: any prop name at all type-checked and
  read as `any`. TO: the type declares a closed set — the controlled-input
  contract (`value` / `onChange` / `field` / `readonly` / `disabled` /
  `className` / `errorMessage` / `onUploadingChange`), the host plumbing a
  renderer forwards (`schema`, `dataSource`, `dependentValues`, `dependsOn`,
  `emptyHint`, `compact`, `onSelectRecord`, `onCreateNew`), and DOM pass-through
  (`id`, `name`, `autoFocus`, `tabIndex`, `onBlur`/`onFocus`/`onClick`, every
  `aria-*`, and `data-*` via a template-literal key). A custom widget reading
  anything else now fails `tsc`; the fix is to read it off `field` (the metadata)
  or to add the key here with its producer named.

  Scored `minor`, not `major`, per this repo's fixed-group rule — objectui's major
  tracks `@objectstack`, so breaking changes of our own ship as minor with the
  semantics spelled out (see AGENTS.md §版本号策略). The practical blast radius is
  small: every call site in this monorepo — `plugin-detail`'s inline editor,
  `plugin-grid`'s cell editor, `app-shell`'s metadata inspectors, the form
  renderer — compiles unchanged, because the closed set was derived from them.

  Why it mattered: an index signature is the objectstack#4075 mechanism — **a type
  that claims to have every key can never be reported as missing one**. Three
  things followed, and all three are now fixed:

  - `props.required` and `props.error`, both declared by the spec's
    `FieldWidgetPropsSchema` and both absent here, were legal reads typed `any`
    and `undefined` at runtime forever. They are compile errors now, which is what
    makes the `error` / `errorMessage` divergence (objectui#3222) decidable by the
    compiler instead of by a symbol guard. This change deliberately does **not**
    resolve that divergence — only make it visible.
  - A misspelled prop (`readOnly` for `readonly`, `onchange` for `onChange`)
    compiled and silently did nothing.
  - Any structural / parity comparison against the type was useless _in
    principle_, which is why objectui#3161's batch-7 symbol guard was the only
    detector that could see the collision at all.

  Also cleaned up inside the package: ~20 `(props as any).x` reads of keys the
  type now declares (`compact`, `dataSource`, `disabled`, `name`, `id`,
  `onCreateNew`, `onSelectRecord`, `contextRecord`, `dependentValues`) read
  through the type instead — leaving them would have kept the "a typo compiles"
  half of the defect alive at exactly the sites that matter. The three batch-7
  tripwires that existed to go red on this change
  (`_IndexSignatureStillThere` / `_RequiredSilentlyReadsAsAny` /
  `_ErrorSilentlyReadsAsAny`) are replaced by their inverse, so re-widening the
  type fails a test rather than passing one.

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

### Patch Changes

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
  - @object-ui/providers@17.2.0

## 17.1.0

### Minor Changes

- f8a95e5: fix(fields): the sharing-criteria builder stops calling an empty criteria "All records" (objectstack#3896)

  `FilterConditionField` renders `sys_sharing_rule.criteria_json`. With no
  criteria it displayed **"All records"**, and `filterGroupToMongo` carried a
  matching `// empty = match all` comment. That was describing a bug as a
  feature: a sharing rule with no predicate was stored as `criteria_json: null`
  and evaluated as `find(object, { filter: {} })` under the system context —
  every record of the object, granted to the recipient. `SharingRuleSchema` had
  always forbidden the shape ("never seeded as a permissive match-all",
  ADR-0049); the REST and data-API entries just never checked.

  objectstack#3896 closes those entries: the server now refuses to save a rule
  whose criteria would match everything, and one already stored shares nothing.
  This is the renderer catching up.

  - **The empty read-only state now says the rule shares nothing**, in
    `destructive` styling — key renamed `fields.filterCondition.allRecords` →
    `fields.filterCondition.noCriteria`, retranslated across all ten locales.
    Nothing else read the old key.
  - **A new `fields.filterCondition.criteriaRequired` hint** renders under the
    builder (and the JSON editor) while the criteria is empty. The server's
    rejection is precise but only arrives as a toast _after_ Save; this says it
    while the admin is still looking at the empty builder.
  - **`isMatchAllCriteria` is exported** — a client-side mirror of the server
    predicate covering `{}`, `[]`, and the vacuous combinators (`{ $and: [] }`,
    `{ $or: [{}] }`), conservative in the same direction. The server stays
    authoritative; this only decides whether to show the hint.

  Unparsable JSON keeps its own `invalidJson` message and does **not** also
  collect the empty-criteria hint.

  Note for anyone wiring this end-to-end: the Criteria field is not marked
  `required` in the object metadata, deliberately — `sys_sharing_rule.criteria_json`
  is nullable in deployed tenants, so `required: true` would only produce a
  destructive `NOT NULL` migration that those nulls block. The invariant lives in
  the server's write guards; this change makes the UI stop contradicting it.

### Patch Changes

- aecc934: fix(fields): PeoplePicker's keyboard cursor can no longer be eaten by a late reset

  The cursor reset on new results lived in a `useEffect`. Effects flush
  asynchronously after the render that delivered the records — so a reset queued
  by their arrival could land AFTER a subsequent ArrowDown and wipe the just-set
  cursor. That was the residual ArrowDown→Enter flake in
  `PeoplePicker.test.tsx` (the earlier signature-keyed fix closed the
  too-often resets, not the too-late one), and a real fast-fingers UX bug: rows
  appear, the user presses ArrowDown, the highlight vanishes.

  The reset now runs in the render phase (the "adjusting state during render"
  pattern), in the same render that shows the new rows — by the time a row is
  visible, the reset has already happened, so it can never race a keypress.
  Semantics unchanged and now pinned by a test: a replaced result set does not
  inherit the previous set's cursor.

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
  - @object-ui/providers@17.1.0

## 17.0.0

### Minor Changes

- 697cda4: feat(fields): adopt the file-as-reference value shape (ObjectStack ADR-0104 D3 wave 2)

  A `file`/`image` field value now reaches the UI in one of three forms, and the
  rules for reading them live in one place — `@object-ui/fields`' new
  `file-value` module — instead of being re-derived in each widget:

  1. **Reference** — a bare `sys_file` id string, what the backend stores once
     file-as-reference is adopted.
  2. **Expanded** — `{ id, name, size, mimeType, url }`, what the read path
     returns after resolving a reference.
  3. **Legacy inline blob** — `{ file_id?, name, original_name, size, mime_type,
url }`, the pre-reference shape this package used to build itself.

  **The casing split is the bug this fixes.** The expanded form carries
  `mimeType`; the legacy blob carries `mime_type`. `FileField`, `FileCell` and
  `ImageField` all read only `mime_type`, so the moment a backend starts returning
  the expanded form they stop recognising images — thumbnails silently degrade to
  a generic file icon, with nothing pointing at a value shape as the cause.
  `readFileValue()` accepts both.

  **Uploads now submit the reference form** — the bare `sys_file` id — when the
  upload adapter surfaced one, falling back to the legacy blob when it did not
  (the object-URL fallback adapter, or a backend predating file-as-reference). The
  same build therefore works against both. Action params already POSTed a bare
  fileId; record field values now use the same contract, and
  `serializeParamValues` shares the `fileIdOf()` extractor so the two surfaces
  cannot drift on what counts as an id.

  Because a bare id carries no name or URL, each widget remembers the display
  details of files it just uploaded, keyed by id, so an upload renders immediately
  rather than showing a bare token until the next read enriches it.

### Patch Changes

- 4b1ed7d: feat(app-shell): approval approver values become record lookups (framework #3508)

  - The flow designer's approver `Value` cell now sources directory kinds from DATA
    records instead of the metadata registry: `user` / `team` / `department` / `position`
    render a single-select record lookup (`LookupField` over `sys_user` / `sys_team` /
    `sys_business_unit` / `sys_position` via the DataSource adapter), with a manual-entry
    escape hatch and a plain free-text fallback when no adapter is available (offline
    preview). `position` commits the machine name; the others commit the record id —
    matching the approval engine's resolution semantics.
  - `org-membership-level` is now a strict select (owner/admin/member); a stored
    out-of-enum value renders flagged instead of being blanked.
  - `manager` renders as an auto-resolved (disabled) cell; `queue` is no longer offered
    for new approver rows and stored queue rows carry a "not supported by the runtime"
    warning.
  - `@object-ui/fields`: `LookupField` hydrates the selected label through `id_field`
    when it is not the primary id (e.g. `id_field: 'name'`), instead of always calling
    `findOne` with the primary id.

- 3e886eb: fix(i18n): localize FileField upload widget + approvals snapshot field labels

  - `FileField` (the shared upload widget) hard-coded every visible string
    ("Drag & drop files here", "or click to browse", "Take photo", "Uploading…",
    size/upload validation messages, …). They now route through
    `useObjectTranslation` with new `fields.file.*` keys, translated across all
    10 locale bundles. This is why the approvals Approve/Reject dialog's
    attachment dropzone was English in a Chinese console.
  - The approvals inbox record-snapshot summary title-cased raw machine keys
    instead of the target object's field labels. It now consumes the
    server-sent `payload_labels` in `payloadSummary`/`decisionAmountEntry`,
    falling back to the prettified key when absent; `approvalsApi`'s row type
    gains `payload_labels`.

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

- 341bfb5: fix: read spec-canonical keys for dashboard header title and field length rules

  Two naming-drift closeouts (framework#1878 / framework#1891):

  - `DashboardRenderer` header now falls back to the spec-canonical `label` when
    the legacy `title` is absent (mirrors the `DashboardGridLayout` fallback from
    #2666) — a spec-compliant dashboard gets its header title.
  - Field validation rules now read the spec-canonical camelCase
    `minLength`/`maxLength` (what the server record-validator enforces) with the
    legacy snake_case `min_length`/`max_length` kept as fallback — authored
    length constraints reach the client form.

- 2f947e4: fix(page,field): consume the spec's `type`/`label`/`maxLength` keys (framework#1878 §3 naming-drift recheck)

  Three forward-drifts where objectui read a different key than the spec
  declares, so authoring the documented key silently no-oped:

  - **page `type` → `pageType`** (app-shell + components): `PageSchema` declares
    the page KIND as `type`, but `PageRenderer` reads `schema.pageType` and fell
    back to `'record'` — and nothing mapped between them. Every non-record page
    (`home`/`app`/`list`/`utility`) rendered with the record max-width, a wrong
    `data-page-type` attribute, and a suppressed header. `PageView` now passes
    `pageType` alongside the SchemaNode discriminator `type`.
  - **page `label` → `title`** (components): `PageSchema.label` is required but the
    region renderer read only `title`. Now dual-reads `title ?? label`, mirroring
    the fallback `DashboardRenderer` already uses. Coupled with the above — the
    header is gated on `pageType !== 'record'`, so both were needed for a title to
    appear.
  - **field `maxLength`/`minLength`** (plugin-form + fields): validation already
    dual-read these, but `ObjectForm`'s HTML-attribute pass and `TextAreaField`
    read `max_length` only, so a spec-authored `maxLength` gave no browser cap and
    no character counter. Both now dual-read, matching `buildValidationRules`.

  Verified in the browser against the showcase: `capability_map` (`type: 'home'`)
  now renders `data-page-type="home"`, the `home` max-width and its page title;
  record pages are unchanged.

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
  - @object-ui/providers@17.0.0

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

- ef14f69: feat(fields): CheckboxesField per-option `visibleWhen` cascading + `dependsOn` gating (completes the option-widget parity set)

  `checkboxes` was the last static-option widget still rendering `config.options`
  raw — with no per-option `visibleWhen` filtering, `dependsOn` gating, or cascade
  clear. It now matches `MultiSelectField` (its multi-value sibling), completing
  the ADR-0058 parity across `select` / `multiselect` / `radio` / `checkboxes`.

  - **`@object-ui/fields`**: `CheckboxesField` routes through the shared
    `useCascadingOptions` hook — offered boxes narrow against the live record +
    `current_user`, the control gates behind a "select the parent first" hint
    while a `dependsOn` field is empty, and selections no longer offered are
    pruned per-element from the array. Adds `checkboxes-empty-*` /
    `checkboxes-option-*` testids.
  - **`@object-ui/components`**: adds `checkboxes` to the form renderer's option
    field sets (`CASCADE_OPTION_FIELD_TYPES`, the cross-field cascade-clear
    effect, and the option pre-filter) so a `checkboxes` field is threaded
    `dependentValues` and gated identically to the other option widgets.
  - Tests: `CheckboxesField.cascade.test.tsx` mirrors `MultiSelectField.cascade.test.tsx`.

- 14cb729: feat(fields): MultiSelectField per-option `visibleWhen` cascading + `dependsOn` gating (parity with single select, #2715)

  The multi-value chip picker now implements the same ADR-0058 option
  resolution as the single `SelectField`, closing the gap #2709 opened when a
  `select` + `multiple` (and the `multiselect` type) started delegating to it.

  - Extracted `useCascadingOptions` — the shared hook that resolves per-option
    `visibleWhen` filtering, `dependsOn` gating, and the live `dependentValues` +
    predicate-scope wiring — and routed both `SingleSelectField` and
    `MultiSelectField` through it (no duplicated resolver).
  - `MultiSelectField` narrows its offered chips against the live record +
    `current_user`, gates behind a "select the parent first" hint while a
    `dependsOn` field is empty, and surfaces a legible empty state instead of a
    bare chip row.
  - Cascade-clear: when the offered set changes (parent changed / predicate
    flipped) the widget prunes only the now-invalid selections, keeping the
    still-offered ones — the array analogue of the single select's clear.
  - Tests: `MultiSelectField.cascade.test.tsx` mirrors `SelectField.cascade.test.tsx`
    (gating, per-element cascade clear, role/context gating).

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

### Patch Changes

- 0318118: fix(app-shell): block ActionParamDialog submit while a file/image param is uploading; map spec `autonumber` (ADR-0059 follow-ups)

  Two follow-ups to the shared-field-widget param rendering (ADR-0059):

  - **Upload-in-progress guard.** A `file`/`image` param's value only becomes its
    fileId once the presigned upload settles, so confirming mid-upload sent an
    empty/stale value. `FileField`/`ImageField` now surface their upload state via
    an optional `onUploadingChange` prop (shared `useUploadingSignal` hook,
    ignored by other widgets); `ActionParamDialog` wires it for `file`/`image`
    params and disables Confirm (label → "Uploading…", new `actionDialog.uploading`
    i18n key across all locales) plus blocks submit while any upload is in flight.
  - **`autonumber` spelling.** `mapFieldTypeToFormType` now maps the spec
    `FieldType` spelling `autonumber` (in addition to the widget-map key
    `auto_number`) to the AutoNumber widget, so a spec-typed `autonumber`
    field/param no longer falls through to the plain text input — fixes the object
    form path as well as action params.

- aefcf39: feat(action-params): serialize file/image action params to storage id(s); retire the approvals composer

  Declared action params of `type: 'file'`/`'image'` now POST the portable API
  contract — the storage id(s) — instead of the upload widget's rich object:

  - `FileField` surfaces the id it already receives from the upload adapter
    (`meta.fileId`) as `file_id` on each emitted file object (additive; the
    record file-field value shape is unchanged).
  - `ActionParamDialog` maps upload-param values to their `file_id`(s) at submit
    (`serializeParamValues`, pure + exported): single → string, `multiple` →
    `string[]`. The api handler already forwards param values untouched, so an
    action with a `file` param POSTs `attachments: string[]`.

  This lets the approvals inbox retire its last hand-wired UI — the approve/reject
  composer with its bespoke attachment upload — so the drawer renders every
  decision through `DeclaredActionsBar` with the declared `attachments` file param
  (framework side declares it; see the paired framework change). `DeclaredActionsBar`'s
  `exclude` prop stays as a general capability.

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
  - @object-ui/i18n@16.1.0
  - @object-ui/core@16.1.0
  - @object-ui/types@16.1.0
  - @object-ui/react@16.1.0
  - @object-ui/components@16.1.0
  - @object-ui/providers@16.1.0

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
  - @object-ui/core@16.0.0
  - @object-ui/providers@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/i18n@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0
- @object-ui/providers@15.0.0

## 14.1.0

### Minor Changes

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

- 2b30583: fix(fields): LookupCellRenderer honors the target object's configured `display_field` (framework#2926 ⑧). ObjectGrid already forwarded `display_field` on the column meta, but the read cell ignored it and always ran the hardcoded heuristics (`name` first), so lookup columns showed the raw API name instead of the configured display/label field. The preferred field now threads through every render path (expanded objects, arrays, JSON strings, and the on-demand `useLookupName` fetch, whose cache key includes the display field to prevent cross-column stale names).
- 3e8bf07: fix(fields): PeoplePicker keyboard cursor no longer resets on identity-only
  result re-emissions

  The cursor-reset effect keyed on the records array identity, so a background
  refetch returning the same records (StrictMode double-effect, refetch-on-focus)
  yanked the active row back to none mid-navigation — surfacing as a flaky
  ArrowDown→Enter CI test and a real (if rare) keyboard UX glitch. The reset is
  now keyed on the record-id signature, so the cursor only resets when the
  results actually change.

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

- Updated dependencies [82441e4]
- Updated dependencies [2efa9fd]
- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [23d65c3]
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
  - @object-ui/components@14.1.0
  - @object-ui/providers@14.1.0

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
  - @object-ui/providers@14.0.0

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

- Updated dependencies [80901aa]
- Updated dependencies [53c40c2]
- Updated dependencies [e492b9d]
  - @object-ui/components@13.2.0
  - @object-ui/i18n@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0
  - @object-ui/providers@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/i18n@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0
- @object-ui/providers@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [9e38270]
- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/i18n@13.0.0
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0
  - @object-ui/providers@13.0.0

## 12.1.0

### Patch Changes

- 6cbccf3: Localize form validation messages, toast client-side validation failures, and make native date/time picker icons legible in dark mode.

  Record-form validation messages (required, min/max length, min/max value, pattern, email, URL) were hard-coded English even when the field label was localized — e.g. a Chinese "计划开始日期" field showed "计划开始日期 is required". `buildValidationRules` baked English strings, so the form renderer's `t(...)` fallback never applied. It now emits `required: true` and, for the other rules, a `messageKey` + `undefined` message (a field-authored `*_message` still wins and passes through verbatim); the form renderer fills the blanks via i18n (`validation.*` keys already exist in every locale), so messages track the label's language.

  When client-side validation blocks a submit, the offending field's inline error can sit below the fold in a long modal/drawer form — the user clicks 创建 and sees nothing happen. The form renderer now also fires a `toast.error` naming the fields (`validation.formInvalid`, added to all 10 locales), mirroring the existing server-error toast so the feedback is visible regardless of scroll position.

  Separately, native controls now declare `color-scheme` (`light` on `:root`, `dark` on `.dark`), so the webkit calendar-picker-indicator and other built-in glyphs render light-on-dark instead of vanishing against the dark input background.

- Updated dependencies [6cbccf3]
- Updated dependencies [e1840bf]
- Updated dependencies [c31874d]
  - @object-ui/components@12.1.0
  - @object-ui/i18n@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0
  - @object-ui/providers@12.1.0

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

- e36a9c7: Align the DetailView column density with the entry form (objectui#2578 "多列显示").

  - **Detail views now reach up to 4 columns, matching the form.** `inferDetailColumns` was hard-capped at 2 columns and the section column count was derived per-section, so a field-heavy record displayed 2 columns in detail but 4 in the edit form. It now uses the same density scale as the form's `inferColumns` (1 → 2 → 3 → 4 by field count) and `deriveFieldGroupDetailSections` derives the count from the object's _total_ field count and stamps it uniformly on every section — so view and edit read at the same width. The responsive grid classes and `getResponsiveSpanClass` ladder were extended through the 3- and 4-column breakpoints, and the effective column count is clamped to the number of visible fields so a lone field never sits at 1/N width.
  - **Long JSON values no longer spill into the neighbouring column.** `JsonCellRenderer` (used by `address`/`json`/`object`/`composite`/`record` fields) applied `truncate` to a bare inline `<span>`, where `overflow:hidden`/`text-overflow:ellipsis` never clip (there is no width box) and the accompanying `white-space:nowrap` also defeated the cell's `break-words`; a long name-keyed map or address JSON therefore overflowed into the adjacent GPS/color cell once the grid narrowed to multi-column. The renderer is now a `block max-w-full` element so `truncate` clamps to the cell width (full value still on hover), and the detail cell wrappers carry `min-w-0` so unbreakable values wrap instead of setting the track's min width.

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
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/providers@12.0.0
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
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/core@11.5.0
  - @object-ui/providers@11.5.0

## 11.4.0

### Minor Changes

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

- bce581a: Fix dependent (cascading) lookups: unlock on parent selection and enforce the
  cascade filter on every candidate surface (#2215).

  Two breaks made `depends_on` unusable end to end:

  - **The gate never unlocked in create mode.** `LookupField` resolved dependent
    values from `ctx.formValues` — a member `SchemaRendererContext` never had —
    and nothing injected the `dependentValues` prop, so with a fresh record
    (`ctx.data = {}`) the child lookup stayed disabled no matter what the user
    picked in the parent field. The form renderer now injects its live form
    values (the same reactive snapshot that drives field rules) as
    `dependentValues` for data-source fields.
  - **The Level-2 table picker bypassed the cascade.** The `depends_on` chain
    only reached the quick-select popover filter; `RecordPickerDialog` (and the
    search-first `PeoplePicker`) received just `lookup_filters`, listing the full
    unfiltered record set. Both pickers now take a `baseFilter` — a hard
    `$filter` constraint merged after `lookupFilters` and user filter-bar input,
    so it can never be widened back out — and `LookupField` passes the dependent
    chain there, shares the same filter with the popover query, and disables the
    browse-all button while dependencies are missing.

- 5160832: fix(fields): inline-edit relational fields with the standard picker (not a text box)

  Inline cell editing reuses the form's field widgets, but the inline map
  (`EDIT_WIDGETS`) was a hand-maintained subset of the form's (`fieldWidgetMap`)
  and had drifted: **lookup / master_detail / user / owner** had perfectly good
  form pickers yet fell back to a plain text box inline (you'd type a raw record
  id). Wire them up — `lookup`/`master_detail` → `LookupField`, `user`/`owner` →
  `UserField`, the exact widgets the form uses. They read the related-object
  dataSource from `SchemaRendererContext` (which the grid provides), so the
  record picker opens, fetches, and selects inline.

  To stop the two lists drifting again, `index` now exports `FORM_FIELD_TYPES`
  and a drift-guard test pins the contract: every form widget type must have an
  explicit inline decision — an editor in `EDIT_WIDGETS` or an entry in the new
  `INLINE_EXCLUDED_FIELD_TYPES` (computed/binary/heavy/container types, each with
  a reason). A future form widget can no longer silently become a text box (or a
  missing editor) in the grid.

- 69d6b94: feat(fields): inline-edit structured-value fields (color, address, location, geolocation, code, qrcode)

  Completes the inline-editor ↔ form-widget parity from the previous fix: the six
  structured types that already had lightweight form widgets — `color`,
  `address`, `location`, `geolocation`, `code`, `qrcode` — now edit inline with
  those same widgets instead of being deferred. All are dependency-light (no map
  or code-editor libraries) and use the standard `FieldWidgetProps`. Verified
  inline on the field-zoo: color → a color picker, code → a textarea, the rest
  their value editors. The drift-guard's exclusion set now contains only the
  genuinely-non-inline types (computed, binary, heavy editors, containers).

- 243a9ba: fix(fields): inline lookup editor shows the selected record's name (not the "Select…" placeholder)

  When editing a `lookup` / `master_detail` / `user` / `owner` field inline in the
  data grid, the `LookupField` picker showed the placeholder instead of the
  current record's name. The grid requests `$expand` for visible reference
  columns, so a lookup cell's value arrives as the related record **object**
  (`{ id, name }`) rather than a bare id. The read cell (`LookupCellRenderer`)
  already resolves objects via the display-name path, but the inline editor only
  matched **primitive** ids (`findOption(value)` with a strict `===`), so an
  object value never resolved — and the hydration effect made it worse by calling
  `findOne(referenceTo, <object>)` with a bogus id.

  `LookupField` now resolves an expanded-reference object directly into its
  display option (mirroring the read cell), skips the pointless per-object fetch,
  and normalises object values to their id for option matching / multi-select
  toggle / removal. `FieldEditWidget` also renders the relational pickers
  `compact` inline — the same single-line, borderless trigger the line-item grid
  uses — so the record name shows **in** the trigger instead of a chip stacked
  above a "Select…" button.

- 289be5b: fix(fields): align inline lookup value resolution with the read cell (external-id strings, tolerant id match)

  Follow-up to #2125. `LookupField`'s inline display now resolves every value
  shape the read cell (`LookupCellRenderer`) does:

  - **JSON-encoded external-id references** (`'{"externalId":"Website Relaunch"}'`)
    are parsed and shown by their external id, and excluded from the hydration
    fetch (so we never `findOne` with a raw JSON string). `recordToOption` gained
    an `externalId` fallback for both the value and the label.
  - **Tolerant id matching** — a `String()`-coerced fallback (`findOptionLoose`)
    resolves a numeric cell value against a string-keyed option (and vice versa),
    matching the read cell's `String(a) === String(b)` comparison. Only consulted
    when the strict match misses, so homogeneous option lists are unaffected.

  Also adds explicit inline-editor tests for `user` / `owner` fields (they
  delegate to `LookupField` via `UserField`), completing coverage for the full
  relational set wired inline in #2122.

- 09e1b26: Show inline line-item (master-detail subform) row actions always, not on hover.
  In grid mode the per-row remove (🗑) and duplicate buttons were `opacity-0`
  until the row was hovered (`group-hover`), so they read as "delete not
  supported" and were unreachable on touch / coarse-pointer devices with no hover.
  They now render at full opacity (kept muted via `text-muted-foreground`); the
  action column width was already reserved, so there is no layout shift. Existing
  `allow_delete: false` / `readonly` / `disabled` / `min_rows` gating is unchanged.
- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [bce581a]
- Updated dependencies [9cd9be1]
- Updated dependencies [c38d107]
- Updated dependencies [7782698]
- Updated dependencies [790558b]
- Updated dependencies [e84d64d]
  - @object-ui/types@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/i18n@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/providers@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/i18n@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0
  - @object-ui/providers@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0
  - @object-ui/i18n@11.2.0
  - @object-ui/providers@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [6726a2b]
  - @object-ui/i18n@11.1.0
  - @object-ui/components@11.1.0
  - @object-ui/react@11.1.0
  - @object-ui/types@11.1.0
  - @object-ui/core@11.1.0
  - @object-ui/providers@11.1.0

## 7.3.0

### Minor Changes

- 788dbf9: feat(fields): wire the `user` field picker to a real `sys_user` search

  The `user`/`owner` field widgets previously rendered a placeholder ("User
  selection component requires integration with user management system") and the
  form-type map fell through to `field:text`, so a `user` field rendered as a
  plain text input.

  `UserField` now **delegates to the shared `LookupField`** with the reference
  fixed to `sys_user` — reusing the existing debounced candidate search, the
  record-picker dialog, and id resolution — so selecting a person works the same
  way as any lookup, with zero bespoke data plumbing. `mapFieldTypeToFormType`
  now maps `user`/`owner` to `field:user`/`field:owner`, satisfying the existing
  `field-type-coverage` regression guard (which already listed both but had no
  mapping wired — the widget map and cell renderers were registered, the form-type
  map was the missing link). Table-cell display continues to use `UserCellRenderer`
  (avatars/initials).

  Pairs with the framework `user` field type (a lookup specialized to `sys_user`).

### Patch Changes

- @object-ui/types@7.3.0
- @object-ui/core@7.3.0
- @object-ui/i18n@7.3.0
- @object-ui/react@7.3.0
- @object-ui/components@7.3.0
- @object-ui/providers@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [8e7c1da]
- Updated dependencies [d23db5c]
  - @object-ui/i18n@7.2.0
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/react@7.2.0
  - @object-ui/core@7.2.0
  - @object-ui/providers@7.2.0

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
  - @object-ui/providers@7.1.0
  - @object-ui/i18n@7.1.0

## 7.0.0

### Minor Changes

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

- 66ed3ad: Line-item grid: item-typeahead auto-fill from a lookup column.

  When a lookup cell's record is picked, `GridField` now copies any of the chosen record's fields whose names match a sibling column (e.g. a product's `unit_price` / `description` drop into the row), then recomputes computed columns — the catalog-typeahead behaviour of QuickBooks / Stripe / NetSuite. Opt out per column with `autofill: false`. `LookupField` gains an optional `onSelectRecord(record)` callback that surfaces the full selected record (not just its id). New pure export `lookupAutofillPatch(columns, col, record)`.

- c6445b6: Line-item grid: inline validation, duplicate, and drag-to-reorder.

  - **Inline per-cell validation** — a required, non-computed cell that's empty on a real (non-ghost) row flags red in place (`aria-invalid` + ring), so errors are visible without submitting.
  - **Duplicate row** — a hover Copy action clones a line (id stripped) directly below it, for near-identical lines.
  - **Drag-to-reorder** — a hover grip handle reorders rows via native drag-and-drop. Set `sort_field` on the grid config to persist order (`row[sortField] = index` stamped on every change); otherwise reorder is order-of-entry.

- 80c133c: Spreadsheet-style line-item grid editor.

  `GridField`'s editable grid mode is reworked into an enterprise line-item editor (the QuickBooks / Stripe / NetSuite pattern), generalised across every inline grid:

  - **Computed read-only columns** — a child field with an arithmetic `expression` (e.g. `amount = quantity * unit_price`) renders read-only, recomputes live as its inputs change, and writes the result back into the row so it persists and the running total reflects it. A small safe arithmetic evaluator (`+ - * / %`, parens, `record.<field>` refs; no `eval`) powers it.
  - **Trailing "ghost" row** — start-with-one + auto-append: typing in the ghost materialises a real row (index-stable, so focus/caret survive), so you keep entering lines without clicking "Add".
  - **Borderless click-to-focus cells** + role-based column widths (description flexes; qty/price/amount stay narrow).
  - **Keyboard navigation** — Enter / ArrowUp / ArrowDown move between rows in the same column.
  - Per-row "expand to full form" is gated to grids that omit fields (no redundant expand on thin lines).
  - `deriveColumns` surfaces a field `expression` as a computed column; the running-total column prefers the computed/last-currency column. Blank/ghost rows are filtered from the persisted batch (`isBlankRow`).

- 5e1b838: Lookup cells in line-item grids. `LineItemsField` columns now support `type: 'lookup'` (with `reference` / `displayField` / `idField`), rendering a real lookup picker per cell that resolves display labels and stores the foreign-key id — so master-detail line grids can reference other objects (category, account, assignee, …) instead of only plain selects.
- 90acb7f: Master-detail subform + lightweight list primitives (SDUI).

  - `MasterDetailForm` (`object-master-detail-form`): enter a parent record and its child line items together; client-orchestrated transactional create (parent → FK → bulk children → rollup → cleanup). Enterprise-convention layout (header on top, line grid, single Save bar at the bottom).
  - `LineItemsField` editable child grid (line numbers, right-aligned numerics, running total) and `LineItemsPanel` (`record:line_items`) for detail-page inline edit.
  - `element:definition-list` and `element:repeater` — lightweight, low-chrome list primitives for simple data.

- 18728c1: Master-detail entry: lighter layout, compact lookup cells, persisted line order.

  - **De-framed line-item section** — the subform no longer double-frames the grid in a `Card` (border + `p-6`); it renders as a light label + the grid's own bordered table, reclaiming the width the line table needs.
  - **Compact lookup cells** — `LookupField` gains a `compact` mode (used by grid cells): the selected value shows inline in a borderless single-line trigger instead of a chip stacked above a separate "Select…" button.
  - **Persisted drag-reorder** — `deriveMasterDetail` detects a sort field (`position`/`sort_order`/…), excludes it from the editable columns/row-form, and threads it as the grid's `sort_field` so reordering stamps `row[position] = index` and survives a reload.

### Patch Changes

- 2d47e94: B2 follow-ups (A): field conditional rules in inline grids + submit-time enforcement.

  - **Grids**: a line-item column's `readonlyWhen` / `requiredWhen` CEL rule is now honored per row — `deriveMasterDetail` carries the props onto the `GridColumn` and `GridField` evaluates them against each row via `resolveFieldRuleState` (a `readonlyWhen`-TRUE cell locks; a `requiredWhen`-TRUE empty cell flags inline-invalid). Rules are row-scoped (`record.*`); the core helpers gained an optional `scope` (and `GridField` a `contextRecord` prop) so a future header-driven lock can bind `parent.*` — that wiring is deferred (it needs the master-detail header's re-renders isolated).
  - **Submit enforcement**: `requiredWhen` already drove react-hook-form's `required` rule, so submit is blocked with a field error when the predicate is TRUE and the value is empty. Added a reactive cleanup so a stale _required_ error clears when the predicate flips FALSE (and all errors clear when a field is hidden by `visibleWhen`).

- bd398df: Render reference/lookup cells as labels, not raw JSON

  A `lookup` / `master_detail` value can arrive as a JSON-encoded object string —
  e.g. an unresolved external-id reference `{"externalId":"Website Relaunch"}`.
  `LookupCellRenderer` treated the whole JSON string as an opaque id, failed to
  resolve it, and fell through to `String(value)`, leaking raw JSON into the grid
  cell (and detail/kanban surfaces).

  - `LookupCellRenderer` now parses a JSON-object-looking string value and renders
    a human label (`name` → `label` → `externalId` → `id`).
  - `coerceToSafeValue` (the shared safe-render helper used by 8 cell renderers)
    gains the same JSON-string parsing, and `externalId` is added to the
    reference-label precedence for plain object values and arrays.

  Verified in the browser (showcase task grid: Project column shows "Website
  Relaunch" instead of `{"externalId":"Website Relaunch"}`) and by unit tests.

- 514f426: fix(master-detail): reliable submit + stable e2e hooks

  Fixes the "click Create, nothing happens" report, surfaced by a new live browser
  e2e harness that drives the form with real input.

  - **MasterDetailForm `handleSave`** now triggers the button-less parent form's
    submit from a deferred macrotask and re-queries the live `<form>` inside it.
    Calling `requestSubmit()` synchronously inside the click handler (right after
    the `setSaving` state update) intermittently dropped the nested submit event,
    so react-hook-form's `onSubmit` never ran and the click appeared to do nothing
    — only the occasional click got through. Deferring makes it fire every time.
  - **Stable `data-testid`s** so automation/e2e can drive the widgets
    deterministically (Radix Select + react-hook-form cannot be driven by
    synthetic DOM events): `select-trigger-{field}` / `select-option-{value}`
    (SelectField), `lookup-trigger-{field}` (LookupField), `line-items-add`
    (GridField), `md-form-submit` / `md-form-cancel` (MasterDetailForm).

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
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [0ad72a6]
- Updated dependencies [3fa23a7]
- Updated dependencies [18d0339]
- Updated dependencies [59b6bbb]
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
- Updated dependencies [2f31406]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/i18n@7.0.0
  - @object-ui/types@7.0.0
  - @object-ui/providers@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/i18n@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3
- @object-ui/providers@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2
  - @object-ui/i18n@6.2.2
  - @object-ui/providers@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/i18n@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1
- @object-ui/providers@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0
- @object-ui/i18n@6.2.0
- @object-ui/providers@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/react@6.1.0
  - @object-ui/providers@6.1.0
  - @object-ui/i18n@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/i18n@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4
- @object-ui/providers@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/i18n@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3
- @object-ui/providers@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/i18n@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2
- @object-ui/providers@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/i18n@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1
- @object-ui/providers@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/i18n@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0
- @object-ui/providers@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/i18n@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2
- @object-ui/providers@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/i18n@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1
- @object-ui/providers@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/providers@5.4.0
  - @object-ui/react@5.4.0
  - @object-ui/i18n@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/i18n@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2
- @object-ui/providers@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/i18n@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1
- @object-ui/providers@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/i18n@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0
- @object-ui/providers@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/i18n@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1
- @object-ui/providers@5.2.1

## 5.2.0

### Patch Changes

- 6c3f018: `CurrencyCellRenderer` now reads the currency code from three locations
  in priority order: `field.currency` (legacy grid configs) →
  `field.defaultCurrency` (canonical top-level) →
  `field.currencyConfig.defaultCurrency` (nested shape emitted by
  `@objectstack/spec` `Field.currency({ currencyConfig: ... })`).

  Previously the renderer only checked the first two, so currency-type
  fields defined via the canonical spec helper rendered without their
  configured symbol. When none of the three is set, the cell still
  gracefully degrades to a plain formatted number — never silently
  assuming USD.

- d912a60: CRM polish — denser kanban cards, smarter currency, calmer dates.

  - **plugin-kanban card body**: drop the verbose `Label: value` two-column
    grid in favor of a single-column dense list (values only, with the
    field label preserved as a hover `title` for accessibility). Pipeline
    cards across Salesforce / HubSpot / Linear all do this because the
    value's own type carries its meaning, and the saved space lets the
    title breathe.
  - **fields/formatCurrency**: drop trailing `.00` when the value is a
    whole number (Salesforce convention: `$1,234.50` keeps cents,
    `$1,234` doesn't). Pipeline amounts like `500,000.00` now read as
    `500,000`.
  - **fields/formatDate** default branch: drop the year when it matches
    the current year — `7月21日` instead of `2026年7月21日`. Past- and
    future-year dates keep the year for disambiguation
    (`2025年11月23日`).
  - **fields/CurrencyCellRenderer**: removed the now-redundant
    `.replace(/[.,]00$/, '')` workaround that hid cents for `precision:0`
    fields; the formatter now handles whole-unit trimming natively.

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

- d9c3bae: `RichTextField` now translates its inline hints (`Format: markdown`,
  `Rich text editor (basic)`, `Enter text...`) instead of hardcoding
  English. Adds `fields.richText.*` keys to the en / zh locale packs.
- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [321294c]
- Updated dependencies [b2d1704]
- Updated dependencies [0a644f0]
- Updated dependencies [a3cb88f]
- Updated dependencies [5425608]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [e919433]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [d9c3bae]
- Updated dependencies [d1442e3]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/i18n@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/components@5.2.0
  - @object-ui/providers@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/i18n@5.1.1
  - @object-ui/react@5.1.1
  - @object-ui/providers@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [1976691]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [49b1760]
- Updated dependencies [c0b236f]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/i18n@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0
  - @object-ui/providers@5.1.0

## 5.0.2

### Patch Changes

- Updated dependencies [cab6a93]
  - @object-ui/i18n@5.0.2
  - @object-ui/components@5.0.2
  - @object-ui/react@5.0.2
  - @object-ui/types@5.0.2
  - @object-ui/core@5.0.2
  - @object-ui/providers@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/i18n@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1
- @object-ui/providers@5.0.1

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
  - @object-ui/core@5.0.0
  - @object-ui/providers@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/i18n@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0
- @object-ui/providers@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/i18n@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0
- @object-ui/providers@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [3ee436d]
  - @object-ui/components@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/i18n@4.6.0
  - @object-ui/react@4.6.0
  - @object-ui/providers@4.6.0

## 4.5.0

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

- Updated dependencies [ab5e281]
- Updated dependencies [6b6afd1]
- Updated dependencies [22fa558]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/i18n@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/providers@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- 63eb66d: fix(detail): expand lookup fields so subtitle + lookup cells show display names

  The record-page fetch in `RecordDetailView` (the page-mode path) now
  requests `$expand` for every lookup/master_detail field on the object,
  mirroring the behaviour the legacy `DetailView` already had. Combined
  with two small downstream fixes — `PageHeader` subtitle interpolation
  now extracts `name/label` from expanded reference objects instead of
  rendering `[object Object]`, and `LookupCellRenderer` now short-circuits
  to `pickRecordDisplayName` when the value is already a nested record —
  all `record:*` renderers and the page header subtitle (`Owned by
{account}`) now display the related record's name rather than the raw
  foreign-key id.

- Updated dependencies [2bd45af]
  - @object-ui/components@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/i18n@4.4.0
  - @object-ui/react@4.4.0
  - @object-ui/providers@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [5f4ac6e]
- Updated dependencies [6b683c8]
  - @object-ui/i18n@4.3.1
  - @object-ui/components@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1
  - @object-ui/providers@4.3.1

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
  - @object-ui/react@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0
  - @object-ui/providers@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/i18n@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1
- @object-ui/providers@4.2.1

## 4.2.0

### Patch Changes

- Updated dependencies [eb738bd]
- Updated dependencies [650392e]
- Updated dependencies [84b4bf1]
  - @object-ui/i18n@4.2.0
  - @object-ui/components@4.2.0
  - @object-ui/react@4.2.0
  - @object-ui/types@4.2.0
  - @object-ui/core@4.2.0
  - @object-ui/providers@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/i18n@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0
- @object-ui/providers@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/i18n@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12
- @object-ui/providers@4.0.12

## 4.0.11

### Patch Changes

- Updated dependencies [1909bc3]
  - @object-ui/i18n@4.0.11
  - @object-ui/components@4.0.11
  - @object-ui/react@4.0.11
  - @object-ui/types@4.0.11
  - @object-ui/core@4.0.11
  - @object-ui/providers@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/i18n@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10
- @object-ui/providers@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/i18n@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9
- @object-ui/providers@4.0.9

## 4.0.8

### Patch Changes

- Updated dependencies [3d58eaa]
  - @object-ui/i18n@4.0.8
  - @object-ui/components@4.0.8
  - @object-ui/react@4.0.8
  - @object-ui/types@4.0.8
  - @object-ui/core@4.0.8
  - @object-ui/providers@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
- Updated dependencies [fd15918]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/i18n@4.0.7
  - @object-ui/types@4.0.7
  - @object-ui/providers@4.0.7

## 4.0.6

### Patch Changes

- 89ae109: Fix click navigation and required-FK form rendering

  - **plugin-grid**: ObjectGrid's `getSelectFields()` now always includes `id` in
    the SELECT projection. Previously, when a view configured `columns` without
    `id`, the SQL driver stripped it from results, and row-click handlers silently
    no-oped because `record.id` was undefined.
  - **plugin-form / fields**: Master-detail fields now render as a single-value
    lookup picker (`LookupField`) in create/edit forms instead of a one-to-many
    related-list widget. From the child-side, master-detail is the FK to the
    parent record and is typically NOT NULL — it must appear in forms. Prior
    behavior dropped it via the auto-layout exclusion list, which caused server
    errors like "NOT NULL constraint failed: contact.account" when users tried
    to create child records.

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
  - @object-ui/i18n@4.0.6
  - @object-ui/react@4.0.6
  - @object-ui/providers@4.0.6

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
  - @object-ui/i18n@4.0.5
  - @object-ui/react@4.0.5
  - @object-ui/providers@4.0.5

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
  - @object-ui/i18n@4.0.4
  - @object-ui/react@4.0.4
  - @object-ui/providers@4.0.4

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
  - @object-ui/providers@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/i18n@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1
- @object-ui/providers@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/providers@4.0.0
  - @object-ui/react@4.0.0
  - @object-ui/i18n@4.0.0

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

- de881ef: Mobile UX round 3 — Form: sticky save bar, fullscreen long-text editor, and auto-stepper for long forms on small viewports.

  **`@object-ui/types`** — `ObjectFormSchema.mobile` (new) lets a single form opt into all three behaviours:

  ```ts
  {
    type: 'object-form',
    objectName: 'leads',
    mode: 'create',
    mobile: {
      stickyActions: true,        // pin Submit/Cancel to bottom on phones
      stepper: 'auto',            // long forms render one field per step
      stepperMinFields: 8,        // …but only past this many fields
      stepperFieldsPerStep: 1,    // … (default 1)
      fullscreenLongText: true,   // textarea fields get an "expand" affordance
    },
  }
  ```

  `FormSchema.mobileStickyActions` (new) is the lower-level escape hatch — applied automatically when `mobile.stickyActions` is set on `ObjectFormSchema`.

  **`@object-ui/plugin-form`** — `ObjectForm` now:

  - propagates `mobile.fullscreenLongText` to every textarea/markdown/html field as `mobile_fullscreen: true`,
  - sets `mobileStickyActions` on the inner form schema and adds `pb-20` padding so content isn't covered by the fixed bar,
  - when `mobile.stepper === true` (or `'auto'` + `useIsMobile()` + > `stepperMinFields` fields), routes the flat field list through the existing `WizardForm` with synthetic single-field "steps" — keeping per-step validation and the existing `Next`/`Back`/`Submit` flow.

  **`@object-ui/components`** — the registered `form` renderer adds:

  - a `mobileStickyActions` opt-in that turns the action row into a `position: sticky; bottom: 0` bar on small viewports, and
  - an inline `FullscreenTextarea` wrapper used when no field-package widget is registered, providing the same expand-button + edit-dialog UX so the feature works even in lighter setups.

  **`@object-ui/fields`** — `TextAreaField` ships the actual fullscreen UX: a top-right `Maximize2` button opens a near-fullscreen `Dialog` containing a full-height `Textarea` with a draft-then-commit save model (Cancel reverts).

  All three behaviours are off by default — existing forms render unchanged.

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/providers@3.3.3
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

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/i18n@3.3.1
  - @object-ui/react@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/i18n@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/i18n@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/react@3.1.5
- @object-ui/components@3.1.5
- @object-ui/types@3.1.5
- @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/components@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/components@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/components@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/components@3.0.2

## 3.0.1

### Patch Changes

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
  - @object-ui/components@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/components@2.0.0

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/types@0.3.1
  - @object-ui/core@0.3.1
  - @object-ui/components@0.3.1
