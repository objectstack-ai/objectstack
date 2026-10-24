# @object-ui/plugin-form

## 18.1.0

### Patch Changes

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

- 902ebab: The `record:line_items` registration no longer declares `childObject` required,
  so the page compile accepts a node whose `dataSource` binding names the child
  object (objectui#11569).
  
  `@objectstack/spec`'s `record:line_items` row leaves `childObject` optional,
  because the node's `dataSource` binding can supply it, and the renderer agrees:
  `dataSource.object` lands on `childObject` before the panel reads the node. The
  registration still declared `required: true`, and the page compile reads the
  registration, so a bound node with no `childObject` of its own was refused with
  `missing-required-prop` and the save failed.
  
  **Clause-②: yes (widening)** — a `record:line_items` node that names its child object
  through `dataSource.object` and sets no `childObject` now compiles and saves. A
  node that names its child object in neither place also compiles now: the panel
  shows its configuration hint naming `childObject` and loads nothing, as it did
  before when such a node reached it. `relationshipField` and `columns` are still
  required. The published `childObject` input now carries a description that says
  the binding can supply it.
- fd060f0: The `object-form`, `view:form`, `embeddable-form` and
  `object-master-detail-form` registrations no longer declare `objectName`
  required, so the page compile accepts a node whose `dataSource` binding names the
  object, and a form that names its object in neither place shows a hint instead of
  a form with no fields (objectui#11605).
  
  `@objectstack/spec`'s `object-form` and `object-master-detail-form` rows leave
  `objectName` optional, because the node's `dataSource` binding can supply it;
  `embeddable-form` has no spec row, and the binding doc says a bound node needs no
  `objectName` of its own. Each renderer agrees: `dataSource.object` lands on
  `objectName` before the form reads the node. The registrations still declared
  `required: true`, and the page compile reads them, so a bound form with no
  `objectName` of its own was refused with `missing-required-prop` and the save
  failed.
  
  **Clause-②: yes (widening)** — an `object-form`, `view:form`, `embeddable-form`
  or `object-master-detail-form` node that names its object through
  `dataSource.object` and sets no `objectName` now compiles and saves. A node that
  names its object in neither place also compiles now, and shows "No object named:
  set objectName or dataSource.object." where it used to draw a field-less card, a
  public form that could not submit, or an empty parent form. An `object-form`
  or `view:form` whose fields are declared inline shows no hint and renders as
  before: non-empty `customFields`, or `sections` whose every field is an inline
  field, the target-less collector the `tabbed`, `wizard`, `split`, `drawer` and
  `modal` variants render. `formId` on `embeddable-form` and `details` on
  `object-master-detail-form` are still required. The published `objectName`
  inputs now carry a description that says the binding can supply them.
- 9dfaca6: The default (`simple`) `object-form` draws a self-describing inline section entry, as the `tabbed`, `wizard`, `split`, `drawer` and `modal` forms already did (objectui#11615). Before, the default form resolved every section entry against its parent field pool and skipped an inline `{ name, … }` entry whose name the pool did not hold. The same section drew that entry on every other form type and drew nothing for it on `simple`, apart from a console warning when the object declared the name.
  
  **Clause-②: yes (widening, with one break for TypeScript readers).** Authored input is only widened: nothing either package accepted before is refused now. Code that READS `ObjectFormSection.fields` can break at compile time, described under "Breaking for TypeScript readers" below.
  
  - `@object-ui/types`: `ObjectFormSection.fields` is `(string | SpecFormFieldInput | FormField)[]`. The new arm is the form view's `{ field, … }` entry, and it is `@objectstack/spec`'s `FormFieldInput` by reference, not a copy. The form already drew that entry. Before, a TypeScript author could not annotate it, because `FormField` requires `name` and types `field` as an object. The zod mirror is unchanged: a section's `fields` entry is still `z.any()` there.
  - `@object-ui/plugin-form`, layout types: the section `fields` of the five layout configs is `NonNullable<ObjectFormSection['fields']>`, by reference. Those configs are `FormSectionConfig` (tabbed), `WizardStepConfig`, `SplitFormSectionConfig`, `DrawerFormSectionConfig` and `ModalFormSectionConfig`, reached through the exported `TabbedFormSchema`, `WizardFormSchema`, `SplitFormSchema`, `DrawerFormSchema` and `ModalFormSchema`. Each of these layouts already drew the `{ field }` entry. Before, their types refused it, and `ObjectForm` passing an authored section to them would no longer compile once the section type named the entry.
  - `@object-ui/plugin-form`, section drawing: on `simple`, an entry that names itself is drawn as it stands, whatever the field pool holds. Such an entry is an object whose `field` is not a string and whose `name` is a string. This is the existing `isInlineFieldDef` predicate that the submit-target rule already reads. It does not require `type`: the spec's inline arm makes `type` optional, and the other five forms draw a typeless entry as the default input.
  - `@object-ui/plugin-form`, inline collector: a `simple` form with no data source and no `submitHandler`, whose sections list only inline entries, is now a self-contained collector, as on the other five forms. It opens on `initialValues` / `initialData`, and its `onSuccess` receives the collected values. Before, that form drew no fields and refused the submit. Its submit carve-out now reads the shared `hasInlineFieldSource`.
  
  **Breaking for TypeScript readers of `ObjectFormSection.fields`** (still `minor`: objectui's major follows the `@objectstack` family major, so its own breaks ship as `minor` and are stated here). A consumer that narrowed an entry with `typeof entry === 'string' ? entry : entry.name` compiled while every object entry was typed as an inline `FormField`. It no longer compiles: `Property 'name' does not exist on type 'FormFieldInput | FormField'`. The read was already wrong at runtime for a `{ field }` entry, where it gave `undefined`. Remedy: name an entry by its arm. The string is the name itself, the `{ field }` entry names its field by `field`, and the inline entry names it by `name`. `@object-ui/plugin-form` now exports `sectionEntryName(entry)`, which applies exactly that rule and returns `undefined` for an entry that names nothing. It sits beside `resolveSectionGroupReferences`, whose result it reads. The repo's own reader, an app-shell test over that resolver's result, is respelled this way.
  
  **What stays refused or warned.**
  
  - A field name and a `{ field }` entry still resolve against the pool on `simple`. A name the pool does not hold is still dropped, and still warned about once when the object declares it, because top-level `fields` and `sections` still intersect (objectui#9884).
  - An inline entry with no `name` is malformed and is still not drawn on `simple`.
  - A form with no data source and no `submitHandler` still refuses its submit with `DataSource is required for form submission (inline mode not configured)` unless every section entry is inline. One name or `{ field }` entry among inline ones is enough to refuse, on all six forms.
  
  **Behaviour change for an existing schema.** On `simple`, an inline entry whose name the object declares but top-level `fields` leaves out used to be dropped with the intersection warning. It is now drawn as its own definition, with no warning, as on the other five forms. With a data source, its value is still written only if the object declares the field. As on every form, a key the object does not declare is stripped from the write.
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
- 923504f: The record form draws a field's `inlineHelpText` under its control, and no longer reads a field's `help` (objectui#12213).
  
  `@objectstack/spec`'s `FieldSchema` declares `inlineHelpText` ("Help text displayed below the field in forms"), and Studio's object field inspector writes it. `ObjectForm`'s field builder and `fromObjectSchema` both built a field's help line from `help`, then `description`, and never read `inlineHelpText`, so help text typed in Studio never appeared on the record form. Flow screens already drew it.
  
  - FROM `field.help || field.description` → TO `field.inlineHelpText || field.description`
  
  The two builders now share one read (`fieldHelpText`, exported by `@object-ui/fields`), so the flat, sectioned and tabbed forms cannot drift apart. The line is the control's accessible description, drawn under it, where flow screens draw it. An empty `inlineHelpText` reads as absent, so the field's description still shows. A `file` or `image` field's size hint follows the help text as before.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  Translated field help on the record form needs an objectstack server on `@objectstack/spec` 17.7.0 or later (objectstack-ai/objectstack `bab76850c`, objectstack-ai/objectstack#21956). `FieldSchema` refuses `help` as an authoring key, and its one producer was a server on spec 17.6.0 or earlier, whose translator put a field's translated description on the served field's `help` key. 17.7.0 serves that text on `description`, which the form reads. Against an older server, a field's help line shows its `description` as the server stores it, untranslated, and a field whose only help is a served `help` key shows no help line. Fix: run the server on spec 17.7.0 or later, within the same major. (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
- 7b5e558: **A record dialog with no authored layout opens bounded, and draws two fields per row wherever no `columns` is declared** (objectui#12521). Three defaults of `ModalForm` change. None reaches a setting the author declared.
  
  - **Size.** A dialog with no `modalSize` derived its width from its inferred column count, and three or more columns derived `full` (95vw). It now derives `lg` or `xl` from the grid it renders and its field count, and never `full`. `inferModalSize` returns `'lg'` for one column and `'xl'` for two or more. An authored `modalSize`, `'full'` included, is used as written.
  - **Flat grid.** A dialog whose form declares no `columns` and draws no sections inferred one to four columns from its field count. It now lays out at two columns from the container's `@md` tier up and one below it, so the phone sheet is unchanged. Every field takes one cell, so fields of one kind share one width. A wide kind (textarea, rich text, markdown, html, an inline grid) and a `span: 'full'` field take the whole row. The object's `fieldGroups` fallback lays out the same way.
  - **Section density.** In a form that declares no `columns`, a section that declares none draws two fields per row from `@md`, whatever the other sections declare. Beside a `columns: 3` section it draws two per row on the 12-track grid of objectui#12548, where before it filled three; with no section declaring any, the grid is two wide. A declared count, `1` included, is drawn as written, and a form-level `columns` still sets an undeclared section's count. Until `@objectstack/spec` drops `FormSectionSchema.columns`' `default(1)` (objectstack-ai/objectstack#23740), the spec's parse writes `columns: 1` into every section that omits it, so a section from an authored stack arrives declared and draws one column, as before.
  - **What does not move.** A declared form `columns`, a declared section `columns` and a field's `colSpan` / `span` render the same grid classes as before. `inferColumns`, and the page form, drawer and detail view that read it, are unchanged. A host that passes a `modalSize` of its own keeps it.
- 611566b: A form view field's `visibleOn` is no longer read when sections are normalized (`normalizeSectionField`, used by `ObjectForm`, `ModalForm` and the record form page) (objectui#12654). `@objectstack/spec` 18 retires the form view field's `visibleOn` as a `retiredKey` tombstone naming `visibleWhen` (objectstack#23543 F4), so the field's `visibleWhen` is the one view-level predicate carried onto the runtime field.
  
  What a raw schema loses: a form view section entry `{ field: 'x', visibleOn: 'PREDICATE' }` that did not pass through the spec's parse no longer hides the field; write `visibleWhen`. A runtime `FormField` (an inline field object with its own `name`) keeps its `visibleOn` slot: that is the runtime field's view-level gate, a different key, and it is unchanged.
  
  What is unaffected: form views served by an ObjectStack runtime. They already arrive with `visibleWhen`: the spec's parse folds the old key through the 18 pre-releases, and spec 18's stored-row rehydration rewrites a row stored with it.
- 684f22e: A section entry written as a bare field name no longer reads the object field's `visibleOn` when sections are normalized (`normalizeSectionField`, used by `ObjectForm`, `ModalForm` and the record form page) (objectui#12719). The spec's object `FieldSchema` declares no `visibleOn`: an object field's visibility predicate is `visibleWhen`, which the shorthand already carries onto the runtime field as its field-level rule.
  
  Clause-②: no (narrowing). The shorthand stops honouring an object field's `visibleOn` (it was copied into the runtime field's view-level `visibleOn` slot), and starts reading nothing new.
  
  What a raw schema loses: an object schema handed straight to the form, whose field carries `visibleOn: 'PREDICATE'`, no longer hides that field where a section lists it by name; write `visibleWhen` on the object field. What is unaffected: object schemas served by an ObjectStack runtime, which the spec's strict `FieldSchema` parse never lets carry `visibleOn`; a form view field's `visibleWhen`; and a runtime `FormField`'s own `visibleOn` slot.
- 32b492b: Line-item grids read a boolean column's options and a file cell's text in the session language (objectui#12924). Under a zh-CN session, a master-detail or `record:line_items` grid showed English in two places: the two options of a column derived from a `boolean` or `toggle` child field (`Yes` / `No`, in the editable picker and in the per-row form's list), and a file cell's text (`N files` for a cell holding several files, `File` for a file with no name). Both now come from the language packs, and English reads as before.
  
  - **Boolean options.** The labels are the session's word for each value, from `useBooleanValueLabel` (`@object-ui/fields`), which reads `common.yes` / `common.no`, the keys read-only booleans already use. The stored values are unchanged: `'true'` and `'false'`. `MasterDetailForm` and `LineItemsPanel` call the hook and pass it to the derive functions. Both re-label the options when the session's words change, so a catalogue that lands after the child schema, or a language switch, reaches them without re-reading the lines.
  - **File text.** `GridField` reads the count from `detail.fileCount`, the plural family the file cell renderer already uses, so each language gets its own plural forms (Russian `few` / `many`, for example). The name of a nameless file comes from `fields.file.fileFallback`. The per-row form's list cell and the read-only table both show these words.
  
  No language-pack key is added.
  
  BREAKING (`@object-ui/plugin-form`), for a caller of the exported `deriveDetail` or `deriveColumns`: both now require `booleanLabel`, a function that names a boolean value in the session language. Pass `useBooleanValueLabel()` from `@object-ui/fields`: `deriveDetail(childObject, childSchema, parentObjectName, { booleanLabel })`, and `deriveColumns(childSchema, { booleanLabel })`. There is no default, because an English default would label the options in English for a session in any other language. (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  Clause-②: no (narrowing)
- b9e1887: Publish `optionListDefault` (and its parameter type `OptionListFieldLike`) from the package entry: the reading of an option list's `default: true` that create forms seed from (objectui#11914). The console's public form page (`/f/:slug`) now seeds a field's option-list default through it, so a required select whose options mark a default opens on that option and submits it, instead of refusing the submit on the client (objectui#13049).
  
  Console: on a public form, a select whose options mark `default: true` (and that declares no `defaultValue`) now opens with that option selected, so an untouched submit sends it instead of failing with "Required: FIELD".

### Patch Changes

- 15f6702: `deriveColumns`, the default columns of a master-detail inline grid whose author listed none, now takes which columns it draws, their order and which of them are `defaultHidden` from `@objectstack/spec`'s `deriveInlineGridColumns`, and its visible budget from the spec's `DEFAULT_MAX_INLINE_GRID_COLUMNS` (objectui#11345). The rule is the spec's now, so objectstack's `field-no-consumers` lint credits exactly the columns this grid draws.
  
  The output does not change. The signature is the same, and each column's label, cell type, options, lookup target, conditional rules and computed expression are still built from the child field here, including a plain text column for a field whose definition is falsy. The module-level `DEFAULT_MAX_INLINE_COLUMNS` constant, which the package entry never exported, is removed.
  
  `@object-ui/plugin-form` raises its `@objectstack/spec` floor from `^17.0.0` to `^17.6.0`, because its published entry now imports `deriveInlineGridColumns` and `DEFAULT_MAX_INLINE_GRID_COLUMNS`, which the spec first exports in 17.6.0.
- 3f0b0cd: The per-row expand form of an inline master-detail collection now takes both of its rules from `@objectstack/spec` (objectui#11428), as the collection's grid columns already do. `deriveFormFields`, the form's fields when its author listed none, returns the spec's `deriveInlineRowFormFields` answer, and `MasterDetailForm` offers a row the form when the spec's `isInlineRowFormOffered` says so. The rules are the spec's now, so objectstack's `field-no-consumers` lint credits exactly the fields this form draws.
  
  The output does not change. `deriveFormFields` keeps its signature and returns the same names in the same order, and a row is offered the form exactly when it was before: always in `form` mode, and in `grid` mode only when the form has more fields than the grid has columns. How each named field renders is still decided here.
  
  `@object-ui/plugin-form` raises its `@objectstack/spec` floor from `^17.6.0` to `^17.7.0`, because its published entry now imports `deriveInlineRowFormFields` and `isInlineRowFormOffered`, which the spec first exports in 17.7.0.
- c0862c1: `@objectstack/spec` 17.7.0 retires `sortField` on an `object-master-detail-form` `details` entry (objectstack-ai/objectstack#21589), so `objectui validate` now refuses an entry that writes it, at that member, with the spec's retired-key message (objectui#11717). The form never read it: the line-position field is derived from the child object (objectui#11070). The `details` registration description and the `MasterDetailDetailConfig` docblock now say so. The type is unchanged: it already left the key off.
- e06365c: fix(components): fields that belong to no field group no longer render under the last group's heading (objectui#11777)
  
  On an object where some fields join a declared `fieldGroups` entry and the rest join none, the create and edit forms drew the ungrouped fields straight on under the last group's heading, in the same grid and even in the same row as that group's last field, so they read as its members. The Studio form designer shows those fields apart, in their own trailing area.
  
  The form renderer now ends a section's field grid where the section's heading stops claiming fields. The fields after it start a block of their own below a rule, with no heading and no placeholder title. Ungrouped fields keep their place after the groups, and a section without a heading that follows a titled one is set apart the same way. Every stacked form layout gets this: the default form, `formType: 'modal'` and `formType: 'drawer'`, with sections derived from `fieldGroups` or listed explicitly. A form with no groups, a form whose every field is in a group, collapse and a group's `visibleWhen` render as before.
- ccddd11: A create form preselects the option a field's option list marks `default: true` (objectui#11914).
  
  A `select` field that declares no `defaultValue` but marks one option `default: true` opened on the "Select an option" placeholder in every object-form container, the console's create dialog included. The server stores the marked option when a create omits the field, so the objectstack tutorial's Create Ticket form showed Priority and Status empty and could not be submitted until the user picked the values the metadata had already chosen.
  
  The create form now reads the option list the way the server's insert path does:
  
  - only when the field declares no `defaultValue`. A field-level default, static or runtime, always wins, and the option flag is then not seeded;
  - a single-valued field takes the first marked option;
  - a multi-valued field (`multiselect`, or `select` with `multiple: true`) takes every marked option, as an array.
  
  A value the caller seeds or the user picks still wins. Edit forms are unchanged: they show the stored record.
  
  Nothing is added to the package entry: no export, prop or type member.
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
- 5330038: Console rendering fixes from the HotCRM browser pass (objectui#12110):
  
  - **Grid:** a view column's authored `label` is the header. It used to lose to the field's translated label whenever the app bundle translated the field.
  - **Form:** a field `widget` that names no registered component falls back to the field type's renderer, as the spec's `widget` description says. A `rating` field declaring `widget: 'star_rating'` now draws the star widget instead of a text box. A built-in control name (`input`, `textarea`, …) and the native password and email inputs still render as before.
  - **Cells:** a `rating` value draws stars out of the field's `max` (5 by default) in list, detail and related-list cells, instead of a bare number.
  - **Reference rail:** a related row is named by its object's declared `nameField`, and the rail refetches in place when the record, a related object or everything is invalidated. A record action with `refreshAfter: true` therefore refreshes the rail too.
  - **Gantt:** the task list, the tooltip and the drag previews show a date's year when it is not the current year.
  - **Approvals drawer:** a `position:` approver shows the position's label, from the console's position registry, instead of a truncated id. The headline figure prefers the object's declared `currency` field and never shows a zero from a field matched only by its name.
  - **Public form:** a form with no title of its own is headed by its object's label, not the object's API name.
- d2500d8: A form field declares `step` and `className` on both faces, so the strict authoring face stops telling authors to remove two keys that work. A built-in form branch now joins an entry's `className` with its own classes, and the form renderer's own number input derives its step, so `ObjectForm` no longer writes `step: 'any'` (objectui#12130).
  
  These were the last two keys the form-field channel census (`form-field-channel-census-12130.test.tsx` in `examples/schema-catalog/test/`) listed as read and undeclared with the question open. Each is measured through the real `SchemaRenderer`, with and without the key, in `form-field-channel-effects-12130.test.tsx` beside it.
  
  - **`step`, declared by reference to `@objectstack/spec`'s `FieldSchema.step`:** a number. The `number` widget and the form renderer's own number input put it on the `<input>`; the `slider` widget steps by it.
  - **The form renderer's own number input (`@object-ui/components`).** The built-in `input` branch, and the default branch for an unregistered widget, draw a native number input under `inputType: 'number'`. Its step now follows the `number` widget's rule, read off the field's metadata: an explicit `step` wins, else `10^-scale`, else `any`. Before, it took only a `step` written on the entry, and with none the input kept HTML's step of 1, which refuses decimals. An entry with `inputType: 'number'` and neither `step` nor `scale` now accepts decimals. On an `ObjectForm` field drawn by that input (`widget: 'input'`), a `step` the object field declares now wins over `scale`, as it always did in the `number` widget.
  - **`ObjectForm` (`@object-ui/plugin-form`) no longer writes `step`** onto the number, currency and percent fields it builds. It wrote `10^-scale`, or `'any'` with no `scale`, and the spec's numeric `step` refuses `'any'`. Both routes `objectFormNumericStep-9574.test.tsx` measures render the same steps as before, and that pin passes unchanged.
  - **`className`, declared as a string:** the classes of the element the field's type renders. That is the control on a built-in branch, the element a registered field widget renders, or a `section-divider` row's divider. It is never the field row; a field's width is `colSpan` / `span`. Some widgets draw no class from it, and most read-only displays draw none.
  - **Built-in branches merge it (`@object-ui/components`).** The `input`, `textarea`, `checkbox` and `switch` branches and the unregistered-widget default used to let an entry's `className` replace their own classes, which dropped the touch-target height and the read-only tint. They now join the two with `cn`, as the built-in `select` already did, so a conflicting utility in `className` still wins.
  - **TypeScript.** `FormField` gains both members. `step` is `number`, so assigning `'any'` is now a compile error.
  - **zod (`@object-ui/types/zod`).** WIDENS on the strict authoring face (`StrictAnyComponentSchema`): both keys used to be refused with `unrecognized_keys`, and now parse, `step` as a number. NARROWS on the tolerant face (`safeValidateSchema`), where both keys used to be stripped unjudged. `step: 'any'` was accepted and dropped there, and is now refused at `fields[].step`. A non-string `className` is now refused too. The face is flat: both keys are accepted on every field type.
  
  BREAKING (`@object-ui/types`), for a document whose form field carries `step: 'any'` or a non-number `step`, or a non-string `className`: it no longer validates on the tolerant face. Delete `step: 'any'` (a number input with no `step` and no `scale` already steps by `any`), or write a number. (The bumps are `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  **Clause-②: yes (narrowing)**: the two declared keys widen the strict face's accept set. Typing `step` as the spec's number narrows the tolerant face, from accepting `step: 'any'` (stripped) to refusing it at `fields[].step`.
- b231607: The flat `ObjectForm`'s file-size hint now reads the spec's `maxSize`, and it is shown in the session language (objectui#12156).
  
  A `file` or `image` field that declares a size limit gets a size-limit hint appended to its description. The form read the limit as `max_size`, a spelling the spec's `FieldSchema` refuses by name, so metadata the server serves never carried it and the hint never appeared. It now reads `maxSize`, the spelling the file and image widgets already enforce, and no longer reads `max_size`.
  
  The hint's words were an English literal ("Max size: …"). Once the hint started to appear, a session in any other language would have shown that English beside a translated form. The words now come from the `form.maxFileSize` pack key in the session language. The number and unit are still formatted the same way ("10.0 MB"). A host with no i18n provider still sees the English sentence.
- 6c437b0: A record's Edit form saves the owner the user changes or clears (objectui#12205). The form dropped `owner_id` from every save, so a reassignment or a clear made in the Edit dialog never reached the server: Save answered as if it had saved, the dialog closed, and the record kept its old owner. When the owner was the only change, the update carried every other field unchanged and no owner.
  
  An edit now sends `owner_id` when, and only when, its value differs from the record the form loaded: a new owner is sent as its id, and a cleared owner as `null`. This applies to the modal, drawer and page Edit forms, and to the tabbed, split and wizard layouts. The server stays the authority: a role without the transfer grant is refused, and the form shows that refusal as its error and stays open.
  
  Unchanged:
  
  - An owner the user did not touch is still never sent, so a save from a role without the transfer grant is not refused for echoing it back (objectui#10108). This holds for a save with nothing changed, and for any save where the form has no loaded record to compare against.
  - A create never sends the owner.
  - The caller's field-level security, and an object that declares its owner read-only, still keep the owner off the wire.
  - The business-unit and tenant columns (`owning_business_unit_id`, `organization_id`, `tenant_id`) and the audit columns are still never sent, even when they differ.
  - A form laid out automatically still renders no owner input.
  - The master-detail form's batch still sends no owner, for the header record as well as its lines. An owner changed in a master-detail header is therefore still not saved.
  
  Nothing is added to the package entry: no export, prop or type changes.
  
  Clause-②: no
- 10aba37: The record form stops reading a field's snake_case `visible_on`. A field's visibility is `visibleWhen`, the key `@objectstack/spec`'s `FieldSchema` declares (objectui#12242).
  
  `ObjectForm`'s object-field builder and the sectioned forms' name-string entries read `visible_on` beside `visibleWhen` and carried it onto the runtime field as a view-level gate. The spec refuses `visible_on` by name and suggests `visibleWhen`, and `BaseFieldMetadata` now refuses it, so the read retires with no alias.
  
  - FROM `visibleWhen` plus the `visible_on` gate → TO `visibleWhen` alone, carried as before.
  
  A predicate written under `visible_on` now gates nothing and is not reported. Write it as `visibleWhen`; a CEL predicate keeps the same text.
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
- fc211e8: A New form now saves the owner the user picks (objectui#12359). When the form's layout shows Owner, the user could pick a user and see that user's chip. The create request still carried no `owner_id`, so the server saved the record under the creator, answered 201 and showed no error.
  
  Every create writer in the package now sends `owner_id` when the user picked an owner that differs from the value the form opened with. The six writers are `ModalForm`, `DrawerForm`, and the simple, tabbed, split and wizard layouts of `ObjectForm`. They read the same admission objectui#12205 gave the Edit form. An owner the form was seeded with and the user left alone is still not sent. That covers the acting user from a `current_user` default and an owner in the caller's initial values. The caller's field-level security and an owner the object declares `readonly` still refuse it. The client does not decide whether the caller may assign another owner. The server judges the pick: an insert that names another user is refused without the transfer grant (`allowTransfer` or `modifyAllRecords`), and the form shows that refusal as its error.
  
  Not published: nothing changes on the package entry. No export, prop or type member is added or removed.
- 5f8ecf6: A sectioned create or edit form draws every section at its own `columns` count per row, whatever the other sections declare (objectui#12548).
  
  `@objectstack/spec` `FormSectionSchema.columns` is a per-section count, but all of a form's sections share one field grid, sized by the widest section, and each field spanned `Math.round(grid / sectionColumns)` cells of it. A section whose count did not fit that grid drew the wrong number per row. A `columns: 2` section beside a `columns: 3` one spanned 2 of 3 cells, so it drew one field per row and left the right third empty. A `columns: 3` section beside a `columns: 4` one spanned 1 of 4 cells, so it drew four per row.
  
  `ModalForm`, `ObjectForm`, `SplitForm`, `TabbedForm` and `WizardForm` now share one rule:
  
  - When every section's count is 1 or the grid's own width, the form keeps the grid and spans it always had, class for class.
  - Otherwise the field grid is 12 tracks wide from `@md` (`grid-cols-1 @md:grid-cols-12`). Each field spans 12 / 6 / 4 / 3 twelfths of the row for a 1 / 2 / 3 / 4-column section. `span: 'full'` and wide widgets take the row, and an authored `colSpan` counts its section's columns.
  
  The form renderer draws a twelfths `colSpan` with the step ladder each count has on its own grid: at most two per row at `@md`, three at `@2xl` and four at `@4xl`. Below `@md` the form stays one column.
  
  No type, prop or export changes. A form with no section `columns` is unchanged.
- 0081cdc: Opening a collapsed section in a record dialog no longer takes the whole console off screen (objectui#12559).
  
  The field widgets `@object-ui/fields` registers load on demand: a type's code is fetched the first time a form draws it. Nothing inside the modal form caught that wait, so it landed on the host's nearest loading boundary. In the console's record create and edit dialog that is the boundary around the whole console, because the dialog mounts beside the pages rather than inside one. Opening a collapsed section whose fields used a type not loaded yet, for example a currency or address field, swapped the whole console, dialog included, for the loading screen until the code arrived. The full-page form hid only its page.
  
  The modal form now owns that wait: the dialog keeps its header and footer, its body shows a placeholder until the widget's code arrives, and the form underneath keeps its state, so the section the user opened is open and everything typed elsewhere is kept. Nothing is added to the package entry: no export, prop or type member.
- 96fa4b9: A form section that declares no `columns` now draws two fields per row from the container's `@md` width (one below it) on every page form host — `ObjectForm`, `SplitForm`, `TabbedForm` and `WizardForm` — as the record dialog already did (objectui#12592). Before this, `ObjectForm` sized it by field count and the other three drew it one per row, or at the widest declared count. `@objectstack/spec` no longer defaults a section's `columns` to `1`, so this reaches every section an author left undeclared, a field-group section included. The rule lives once, in the shared sectioned-form layout, and a declared `columns` (`1` included) is drawn as written.
  
  Clause-② reading: no. Only how many columns an undeclared section draws changes; no published type, prop, export, schema read or pack key changes, and the ruling on objectui#12521 makes an undeclared density the renderer's choice by available width.
- 85e8961: An `lg` or `xl` `ModalForm` dialog keeps a 1rem gutter on each side of the window from `sm` (640px) up (objectui#12593).
  
  The two sizes are bounded at 672px (`lg`) and 1024px (`xl`), but the dialog took the full width of any window narrower than that, at x = 0, with no margin. Since every field-heavy create or edit in the console opens `lg` or `xl`, a laptop or tablet window between 640px and 1056px drew those dialogs edge to edge. Both sizes now read one shared width, the window less 2rem, under their own max width, so the dialog is centred with an equal gutter. On a window wider than the max width plus 2rem each size is exactly as wide as before.
  
  Unchanged: the `sm`, `default` and `full` sizes, the full-screen sheet below `sm`, and the dialog's height rules. Nothing is added to the package entry: no export, prop, type member or `modalSize` value.
- 726d8c9: Every wide centred dialog keeps a 1rem gutter on each side of the window from `sm` (640px) up, by one shared class (objectui#12603).
  
  `@object-ui/components` adds one export, `DIALOG_VIEWPORT_GUTTER` (`sm:w-[calc(100%-2rem)]`): the gutter `ModalForm` introduced for its `lg` and `xl` sizes (objectui#12593), promoted so every wide dialog reads the same value. A dialog that raises its cap with `sm:max-w-2xl` or wider writes this constant beside the cap.
  
  Dialogs that ran edge to edge between `sm` and their max width and now keep the gutter:
  
  - the action modal's `lg` and `xl` sizes (`xl` is what a `type: 'modal'` action with a page target and no size opens at);
  - the action parameter dialog with a long parameter list, the flow runner's object-form or long screen step, and the CEL test-run dialog;
  - the full-screen text editor dialog, the image lightbox and the import wizard.
  
  The record picker reads the same class under every width rung; it kept a `95vw` margin of its own before, so between `sm` and its cap it is now the window less 2rem instead. `ModalForm` reads the shared export instead of its private copy, with no change in output.
  
  Unchanged: sheets, the phone sheet below `sm`, the `full` size (`95vw`), and every dialog's width on a window wider than its max width plus 2rem.
- 54e79f9: `record:line_items` fills an untyped column from the child object's field (objectui#12854, the objectui half of objectstack-ai/objectstack#24140).
  
  A column listed only by `name` was headed by the bare field name and edited as plain text, on screen and on a print page. The panel now passes its columns through `hydrateColumns`, the function the master-detail form already uses: a column without a `type` takes its `label`, `type` and `options` (and the field's `required`, lookup reference and formula) from the child object's field. The child schema is the one the panel already loads, which the object-metadata endpoint serves in the session locale, so a heading translates the same way a master-detail grid's does.
  
  An authored `label` or `type` still wins, and a column whose field the child object does not declare renders as before. Nothing is added to the package entry: no export, prop, type member or language-pack key.
- 1e6d83b: Data-bound blocks title their "data source could not be resolved" panel in the page's language (objectui#12920, the family of objectui#12910). The panel shows when a block's `dataSource.view` names a view its object does not have. Each block's title now reads `@object-ui/i18n` through `useObjectTranslation`, with the `en` pack's value as the inline default, so a page with no `I18nProvider` draws the same English it drew before.
  
  - **Plugin blocks.** `object-calendar`, `object-chart`, `object-metric`, `object-pivot`, `detail-view`, `record:related_list`, `object-form`, `embeddable-form`, `object-master-detail-form`, `record:line_items`, `object-gantt`, `object-grid`, `object-kanban`, `list-view`, `object-map` and `object-timeline` read one `element.KIND.sourceUnresolved` key per block kind. `object-metric` reads `element.number.sourceUnresolved`, the key `element:number` already reads for the same sentence. The three forms share `element.form.sourceUnresolved`. `record:related_list`'s panel for a failed `parentDataSource` read reads `element.relatedList.parentUnreadable` ("This related list’s parent record could not be read").
  - **`@object-ui/react` panel defaults.** `ElementDataSourceErrorPanel` with no `title` reads `element.component.sourceUnresolved`, and `NoDataSourcePanel` with no `title` reads `element.component.noDataSource`. A passed `title` still wins, an empty string included. Props and markup do not change.
  
  Clause-②: yes
  
  The new keys in `@object-ui/i18n` widen its exported `TranslationKeys`. No prop, input or export of these packages changes.
- fb85637: A field group whose `visibleWhen` cannot be evaluated is now hidden, header and members, on the form and on the record detail page (objectui#13055).
  
  `@objectstack/spec` declares `ObjectFieldGroupSchema.visibleWhen` fail-closed: "the whole group (header included) is shown only when TRUE, else hidden (fail-closed)". Until now both surfaces failed open. A group whose predicate had a parse error, named an unknown field or root, or failed to evaluate was drawn in full, with only a console warning.
  
  - **Form.** Every layout now hides the group: simple, tabbed, split, drawer, modal, and the console's form page. This holds whether the group comes from the object's `fieldGroups` fallback or from a `{ group }` section reference. Members of a group hidden this way behave as they do under a FALSE predicate: their values still submit and their client-side validation is skipped.
  - **Record detail page.** `record:details` hides the group's section.
  - **Diagnostic.** The one-time warning still fires, and now names the default taken: `safe default (false)` and "the group is hidden".
  - **What stays fail-open.** An authored form-view section's own `visibleWhen` still faults open, as `FormSectionSchema.visibleWhen` declares. So do a field's own `visibleWhen`, `readonlyWhen` and `requiredWhen` (ADR-0137 D3), and every other predicate slot. A well-formed predicate gates exactly as before.
  
  How the direction reaches the renderer: a form-view section's predicate and a field group's predicate arrive at the form renderer in the same slot, a `section-divider` row's (or a tab's) `visibleWhen`. So the direction travels with the predicate. `@object-ui/types` declares one runtime hand-off key, `visibleWhenFault?: 'hidden' | 'shown'`, on `ObjectFormSection`, `FormField` (`section-divider` rows only) and `FormFieldTab`, and mirrors it on the zod faces. `deriveFieldGroupSections` stamps `'hidden'` beside a group's predicate. Every layout carries it next to `visibleWhen`, and the form renderer reads it as the fault fallback. Absent means today's fail-open. It is not an authoring key: the spec's strict `FormSectionSchema` refuses it in authored metadata.
- bc98626: A master-detail edit form now applies its line rules to the header record however late that record loads (objectui#13062).
  
  A line column's `readonlyWhen` / `requiredWhen` rule that reads `parent.*` was evaluated against a copy of the header form read from the page at mount and 120, 360 and 800 ms after it. When the header record loaded later than that, `parent` stayed empty. A stored paid invoice then opened with its `readonlyWhen: parent.status == 'paid'` line cells editable until the user changed a header field.
  
  The line grids now take the header's own record when the header's read returns, and the user's header edits apply over it as they are made. A status change still locks or unlocks the cells at once. The timers are gone. A create form starts from its prefilled values (`initialValues` / `initialData`).
  
  Nothing is added to the package entry: no export, prop or type member.
- 9eb1479: Keyboard access to the console: a "Skip to content" link, and record dialogs that open on their first field (objectui#13130).
  
  - **Skip to content.** The console shell's first Tab stop is now a "Skip to content" link. It stays out of sight until it is focused. Activating it moves focus to the element that holds the page, so the next Tab reaches the page's first control without walking the app bar and every sidebar entry. It moves focus without writing a hash into the URL. Its text is the new `console.skipToContent` key in all ten language packs.
  - **Create/Edit dialogs open on their first editable field.** `ModalForm`'s dialog opened with focus on its Close button (the master-detail dialog on one of its buttons), never on a field. Its body (the object schema, the record on edit, and the field widgets) loads after the dialog opens, so when the dialog took focus no field was there yet. While the body loads, the dialog now keeps focus on itself. When the fields arrive, focus moves to the first field that can be edited, skipping disabled and read-only ones. If the user has already moved focus to another control, focus stays there. This covers both of `ModalForm`'s dialogs: the flat form and the master-detail form.
  
  No export, prop or schema key is added.
- ab4e4d7: Record drawers open on their first field (objectui#13219), as record dialogs do since objectui#13130.
  
  `DrawerForm`'s panel opened with focus on its Close button (the master-detail drawer on its Cancel button), never on a field. The object schema, and on edit the record, are read after the drawer opens, so when the drawer took focus no field was there yet. While the body loads, the drawer now keeps focus on its own panel. When the fields arrive, focus moves to the first field that can be edited, skipping disabled and read-only ones. If the user has already moved focus to another control, focus stays there. This covers both of the drawer's bodies: the form and the master-detail form.
  
  No export, prop or schema key is added.
- a29f615: A record drawer stays open on its first open (objectui#13238). On the first open in a page session, the drawer's body is drawn for the first time once the record is read, and its field widgets' code is still loading, so that render waits. The drawer had no place of its own to wait, so the wait was handed to the page's: in the console, the whole page was replaced by the loading screen, and when it came back a `kind:'react'` page that hosted the drawer was rebuilt and lost its own state, closing the drawer it had opened a second or two earlier. The drawer now waits inside its own sheet, as the record dialog already does: the header stays, the body shows a placeholder until its fields can be drawn, focus stays in the sheet and moves to the first field when it lands, and the page behind is never hidden. Escape, the Close button and a click outside still close the drawer.
  
  Nothing is added to the package entry: no export, prop or type member.
- ff128e3: Opening a collapsed form section keeps keyboard focus on its header the first time too (objectui#13246).
  
  The first time a section opens, the widget code for its fields can still be loading. In the record dialog (`ModalForm`), that wait hid the whole dialog body, and the header the user had just pressed with it. The browser then dropped focus from the hidden header, and focus came back to the dialog itself, so the next Tab started again at the dialog's first field. The record drawer (`DrawerForm`) had no wait of its own: the same toggle hid everything under the host's nearest loading boundary, the drawer included. Later toggles were not affected, because the widget code was already loaded.
  
  Both forms now open and close a section as a React transition. While the section's widgets load, the form stays on screen as it was. The header keeps focus, the section opens when its fields can be drawn, and the next Tab reaches the section's first field. The dialog keeps its own loading placeholder for every other wait, such as the first draw of its body after the record loads.
  
  Nothing is added to the package entry: no export, prop or type member.
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
- d5cb261: fix(plugin-form): `customFields` members render inside explicit `sections` on the drawer, modal, tabbed, wizard and split arms
  
  The registered description of `object-form.customFields` is one sentence for
  every `formType`: "Field definitions merged over the set generated from object
  metadata." With explicit `sections`, an `object-form` with `formType: 'drawer'`,
  `'modal'`, `'tabbed'`, `'wizard'` or `'split'` (and a `DrawerForm`, `ModalForm`,
  `TabbedForm`, `WizardForm` or `SplitForm` mounted directly) built every field a
  section names from the object schema alone, so a member naming that field was
  dropped: its label, its `required` and the rest of its definition never reached
  the form. The default arm already drew the member.
  
  Those five arms now take a section field's definition from the member naming
  it, through the same lookup the default arm's merge uses; a field no member
  names is built from the object schema as before. This holds for a bare field
  name and for a spec `{ field }` entry, whose own overrides still apply on top
  of the member. Over a member, the widget changes only when the entry restates
  `type`. A section naming a field that only a member supplies now renders that
  member, where it used to render a plain text input labelled with the field
  name. A member that no section lists is still not drawn when `sections` are
  given, as on the default arm. `TabbedFormSchema`, `WizardFormSchema` and
  `SplitFormSchema` now declare `customFields`, as `DrawerFormSchema` and
  `ModalFormSchema` already did.
  
  Unchanged: the rules for what a section entry may override, which still differ
  between the default arm and the other five.
- 37140f4: refactor(plugin-form)!: retire the `form-analytics` node type key (objectui#10859, batch 8 phase 2b)
  
  **BREAKING (authoring):** the plugin no longer registers `form-analytics` (and with it `plugin-form:form-analytics`). `objectui validate` refused a `form-analytics` node at `type`, and nothing in this repository, its examples or objectstack authored it. A node authored `type: "form-analytics"` now renders the "Unknown component type" panel. `FormAnalytics` stays a named export.
  
  Migration:
  
  - `{ "type": "form-analytics", "formId": …, "formTitle": …, "metrics": … }` → mount `FormAnalytics` directly with the same three props.
  
  **Clause-②: yes** — a registration leaves the runtime (narrowing), released as `minor` with this banner.
- 8aa68b1: A master-detail form whose `title`, `submitText` or `cancelText` is a per-locale map now shows the viewer's language instead of crashing or toasting "[object Object] saved" (objectui#10935).
  
  **What it was.** `@objectstack/spec` types these three members of `object-master-detail-form` as `I18nLabel`, a plain string or an inline per-locale map such as `{ en: 'Purchase order', 'zh-CN': '采购单' }`, and objectui's validator accepts such a map in the node's `properties` (objectui#10927). `MasterDetailForm` read all three raw. `submitText` and `cancelText` are Button children, so a map threw "Objects are not valid as a React child" and took the form down. A map `title` went into the built-in edit-save toast as "[object Object] saved".
  
  **What changed, in observable terms.**
  
  - Each of the three is resolved with `pickLocalized` against the active UI language (`useObjectTranslation().language`), the source `ObjectMetricWidget` resolves its own `I18nLabel` members against. A map shows the entry for the viewer's language, then falls back the way `pickLocalized` does.
  - A plain string renders exactly as authored.
  - With nothing authored, this change leaves the defaults as they were: 'Create' or 'Save' on the Save button, 'Cancel' on the Cancel button, and 'Created' or 'Saved' in the built-in save toast. objectui#11039 moves those defaults, and the " saved" the toast puts after an authored `title`, into the locale packs, so they follow the session language.
  - On the two buttons, an authored empty string, or a map with no string entry, now shows the default. An authored empty string used to render an empty button; a map with no string entry used to throw as a React child.
  - The parent `ObjectForm` is handed the resolved `title` string, the `string` its `ObjectFormSchema.title` declares.
  - The block's registration declares both arms for the three keys, `type: ['string', 'object']`, with descriptions that teach the per-locale map. The manifest built from `ComponentRegistry.getPublicConfigs()` therefore no longer makes `validateTree` report `type-mismatch` on a locale map for these keys. A value that matches neither arm, such as a number, is still reported.
  
  **Types.** `MasterDetailFormSchema.title`, `.submitText` and `.cancelText` widen from `string` to `I18nLabel` (from `@object-ui/types`), matching the spec row. Code that writes these members compiles unchanged. Code that reads one of them and uses it as a `string` no longer compiles: resolve it first, for example with `pickLocalized` from `@object-ui/i18n`.
  
  **Clause-②: yes** — three members of `MasterDetailFormSchema`, which the package entry exports, widen from `string` to `I18nLabel`, and the registration's `inputs` for the same three keys widen from `'string'` to `['string', 'object']`. Nothing that was accepted before is refused now.
- 19f484f: `FormulaFieldMetadata` declares `@objectstack/spec`'s `expression` in place of `formula`, and three readers of a lookup's display pointer read the spec's `displayField` alone (objectui#11070, round 6). Both retired spellings go at once, with no alias.
  
  - **Types.** `FormulaFieldMetadata.formula` is removed. `FormulaFieldMetadata.expression` is `FieldSchema`'s `expression` by reference: a CEL source string, or the spec's `{ dialect, source, … }` envelope. Nothing in ObjectUI read the removed member through the type. `FieldSchema` refuses `formula` by name on every field type, with a rename hint to `expression`.
  - **Form payloads.** `sanitizeFormData` (`@object-ui/plugin-form`) no longer treats a `formula` key as a "computed" flag. Every `type: 'formula'` field is still dropped from the payload by its type, as before. Only a field of some other type that carries `formula` changes: its value is now sent like any writable field's. The spec refuses such a definition at publish, so a served one cannot carry it.
  - **Display pointer.** `deriveColumns` and `hydrateColumns` (`@object-ui/plugin-form`, the master-detail grid columns), `ObjectChart`'s group-by labels (`@object-ui/plugin-charts`) and the action-param resolver (`@object-ui/app-shell`) read `displayField`, then `reference_field`. None of them reads `display_field` any more.
  - **A fix for spec-spelled lookups in master-detail grids.** `deriveColumns` and `hydrateColumns` read `display_field || reference_field` before, with no `displayField` leg. A lookup that declared only `displayField`, which is the spec's spelling, got no display pointer on its grid column. It now gets one.
  
  A definition served through `ObjectStackAdapter.getObjectSchema` or `MetadataProvider` loses nothing: the ingestion pass (objectui#7650) stamps a stored `display_field` onto `displayField` before any of these readers sees it. Measured with a lookup carrying `display_field: 'title'` served through `ObjectStackAdapter.getObjectSchema`: the master-detail column (`deriveColumns` and `hydrateColumns`), the chart's axis label and the action param all resolve the `title` column before and after this change.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  TypeScript that writes `formula` on a `FormulaFieldMetadata` no longer compiles (an excess-property error naming the key). Rename it to `expression` and write the formula in CEL against the record, for example `record.quantity * record.unit_price`.
  
  At runtime, a lookup whose display pointer is spelled only `display_field` loses it wherever the ingestion pass does not run first. Measured before and after this change, on a lookup with `display_field: 'title'` handed to the readers directly:
  
  - **`deriveColumns` / `hydrateColumns` with a `childSchema` that did not come through the ingestion pass** (an external caller, or a master-detail form whose `DataSource` is not `ObjectStackAdapter`): the column's `displayField` was `title`. It is now absent.
  - **`ObjectChart` on a `DataSource` other than `ObjectStackAdapter`**, grouped by that lookup: the axis label came from the `title` column. It now comes from the `name` column, the generic fallback.
  - **The action-param resolver, when a host passes its own unfolded `objects`** (for example through `RecordDetailView`'s `objects` prop): the lookup param's `displayField` was `title`. It is now absent.
  
  The same lookups spelled `displayField` resolve the `title` column in all three after this change. Before it, the chart and the action param already did, and the master-detail columns did not (the fix above).
  
  **Fix:** spell the pointer `displayField`, or serve the definition through `ObjectStackAdapter`.
- 0a3e540: The grid field's `sort_field` is declared, and a master-detail detail's sort field is derived only (objectui#11070, round 9).
  
  `GridField` stamps each row with its index in the field `sort_field` names, on every change, so the order a drag-reorder leaves is saved with the rows. It read that key while no face declared it. Its one producer is `MasterDetailForm`, which hands the grid the sort field `deriveDetail` picks from the child object: the first of its fields named `position`, `sort_order`, `sequence`, `line_no`, `line_number` or `sort`. A detail could also override that pick with an authored `sortField`, which nothing wrote in either repository and no spec key carries.
  
  - **`sort_field` is declared (`@object-ui/types`).** `GridFieldMetadata` declares `sort_field?: string`, documented as the CHILD field stamped with each row's index. `GridField` now reads its config as `GridFieldMetadata` alone, so every key it reads is declared there (`@object-ui/fields`; no runtime change).
  - **The authored override is retired (`@object-ui/plugin-form`).** `MasterDetailDetailConfig` no longer has a `sortField` member, and `MasterDetailForm` no longer reads one. The sort field the grid receives is the derived one, carried on the form's internal per-detail state.
  
  **Clause-②: yes (narrowing).** The published `GridFieldMetadata` face widens by one optional member. The published `MasterDetailDetailConfig` face narrows by one member, and what `MasterDetailForm` honours narrows with it.
  
  ## ⚠️ BREAKING, priced as minor under the fixed group's version policy
  
  - **TypeScript.** A `MasterDetailDetailConfig` literal that writes `sortField` is a compile error. Fix: delete it. The sort field comes from the child object; name the child's position field `position` (or another of the names above) so the derivation finds it.
  - **Rendering.** A detail written with `sortField` (through a cast, or in a document the compiler never saw) renders as if the key were absent. On a detail the form derives, the grid stamps the child's sort-named field; on a fully configured detail (relationship field set and every column typed), which loads no child schema, the grid stamps none.
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
- 17dc167: `object-form.layout` publishes only `vertical` and `horizontal`. This is objectui#11168 slice 3 and delivers objectui#7759 group C. `@objectstack/spec` 17.5.0 retired `inline` and `grid` from the form layout enum (objectstack#20221). The authored `object-form` arm, which reads the spec row by reference, already refused both. The registration still published them, so the page validator passed values `objectui validate` refuses.
  
  ⚠️ This narrows a published input. Measured through the real `SchemaRenderer` before the change, `inline` and `grid` rendered byte-identical to `vertical` on the simple, tabbed, wizard and split layouts. Nothing that rendered is lost. A stored document carrying either value is refused at authoring; write `vertical` (the default) or `horizontal`. The fixed group ships the change as `minor`.
  
  The fold that mapped `inline` / `grid` to `vertical` is retired with them, in `ObjectForm` (simple, drawer and modal routes), `DrawerForm` and `ModalForm`. `layout` now passes through unfolded, and an absent `layout` still draws as `vertical`.
- 072b7e8: `record:line_items` now publishes every key of its `@objectstack/spec` 17.6.0
  row (objectui#11536). Each key was decided by measuring it through
  `SchemaRenderer` and the block's registration, per the objectui#11111 ruling:
  declare what the panel honours, leave out what it does not. All ten keys the
  row added over the registration move the panel, so all ten are declared.
  
  Newly published, so the SDUI manifest, the JSX intrinsics and the page
  validator accept them instead of reporting `unknown-prop`:
  
  - `parentId` and `recordId`: the parent record whose lines are loaded and
    saved. `parentId` outranks `recordId`, and both outrank the record the page
    shows.
  - `parentObject`: the parent object the line total is written to on Save,
    together with `totalField`. It outranks the object of the record the page
    shows.
  - `title`: the panel heading, a plain string.
  - `readonly`: lines are shown without editing (no Save, no row actions).
  - `minRows` / `maxRows`: Remove row is disabled at the floor; Add line and
    Duplicate row are disabled at the cap.
  - `filter`, `sort` and `limit`: the additional criteria (AND-combined behind
    the parent relationship, never replacing it), the load order and the row
    cap (default 500), each read as a top-level key as well as through a
    `dataSource` binding.
  
  Nothing changes at runtime: the panel already read every one of these keys.
- 9c74902: Retire the form-view section `className` / `gridClassName` reads (objectstack#13626,
  maintainer ruling 2026-09-01, director decision batch C).
  
  **Breaking, deliberately.** A `className` or `gridClassName` authored on a form-view
  section no longer has any effect. Before this change an authored `gridClassName`
  reached the section's field-grid `<div>` and an authored `className` reached the
  section wrapper / divider header; both are now dropped at the renderer.
  
  The two keys sit on the SDUI-only side of the authorable boundary: `@objectstack/spec`
  deliberately does not declare either on the form-view/section surface (its
  `component.zod.ts` says so in as many words) and the authorable-surface ledger carries
  no entry for them. The renderer nevertheless reached them off the parsed view through
  `as any` at seven sites — the boundary declared on one side and crossed on the other,
  with the two repos each deliberate and in opposite directions.
  
  Declaring the keys instead was weighed and **not** adopted: it would formally invite
  free Tailwind strings into authored metadata, the exact class the boundary exists to
  keep out — and per ADR-0065 / ADR-0080 (rev. 2026-06-30) utility classNames in runtime
  metadata are never scanned by the build-time Tailwind, so they silently produce no CSS
  anyway. Declaring them would have published a styling surface whose most obvious use
  does nothing. If per-view styling becomes a real product need it gets an explicit
  controlled token surface, not two leaked keys.
  
  **Migration.** Nothing in the measured corpora has to change. A census across the
  objectstack corpus, this repo's corpus, and the hotcrm application found **zero**
  authored uses of either key on a form-view section (201 authored section nodes reached,
  0 carrying either key). If you author them in your own metadata, move the styling to
  the host application's own CSS, or to the form ROOT `className` — which is a different
  key on a different node and is **unaffected** by this change.
  
  Six sites in `ObjectForm` (the tabbed / wizard / split / drawer / modal section maps and
  the stacked section-divider) and one in `DrawerForm` (its own divider) stop copying the
  keys. The omission is pinned behaviourally across all seven arms rather than by a source
  grep, because `ObjectFormSection` still declares both keys — so a later uncast
  `className: s.className` would type-check and silently restore consumption.
- 636b236: `navigateOnSuccess` is relative-only, escapes the interpolated id, and is deprecated in favour of `submitBehavior`
  
  The url contract for this key was undeclared: it was same-origin-guarded (so a same-origin
  ABSOLUTE value was accepted), it interpolated `{id}` / `{recordId}` without escaping the
  substituted value, and nothing said which of those was intended. The maintainer ruled it on
  2026-08-17: `navigateOnSuccess` is the pre-ruling ancestor of the `submitBehavior` family
  rather than a second dialect, so as a compat alias it runs under the semantics
  objectstack#7496 ruled for that family.
  
  **Relative paths only.** A same-origin absolute such as `https://own-host/record/{id}` is
  now refused like any other out-of-contract value, rather than accepted and navigated at
  browser level. The destination is authored metadata, which is exactly where an address
  somebody else chose gets copied in. Cross-origin and protocol-relative values were already
  refused and still are; every relative shape that worked before still works.
  
  **The interpolated id is URL-escaped.** `/r/{id}` with an id of `a/b c` resolved to
  `/r/a/b c`, silently growing a path segment, and a template of `{id}` let the id become the
  whole destination. The substituted value now goes through `encodeURIComponent`, so a token
  is a value in the path and never a way to add path structure. The template is the author's
  and is untouched — only the id, which is data read off the written record, is escaped.
  
  Both halves are needed and neither implies the other: relative-only is a rule about where a
  destination starts, so it cannot see structure injected further along; escaping runs only on
  the substituted value, so it cannot see an absolute the author wrote out.
  
  This can only narrow what is reachable. Every destination the key now accepts is a relative
  reference, and a relative reference cannot carry an authority, so it was already accepted by
  the same-origin guard this replaces — no value that was refused is now followed. With every
  accepted destination relative, the browser-level `window.location.assign` fallback at both
  call sites became unreachable and was removed; an accepted destination goes to the injected
  navigation seam, and the absent-seam fallback inside the shared hook is unchanged.
  
  **Deprecation.** `navigateOnSuccess` is marked `@deprecated` in favour of `submitBehavior`,
  which already takes precedence over it and carries the richer `{{record.field_name}}`
  interpolation. The `{id}` / `{recordId}` dialect keeps working for forms that already
  declare it — the ruling converges the documentation and the semantics, not the spelling.
- 7a72422: Publish the create-payload rule from `@object-ui/plugin-form`'s entry, so a
  second form renderer can call it instead of composing it by hand
  (objectui#6059).
  
  Newly importable from `@object-ui/plugin-form` — two functions, nothing else:
  
  ```typescript
  import { omitServerResolvedDefaults, isRequiredInForm } from '@object-ui/plugin-form';
  ```
  
  - `omitServerResolvedDefaults(values, objectSchema)` — drop the keys a CREATE
    payload must leave to the producer: a field whose declared `defaultValue` is a
    runtime instruction (`NOW()` / `current_user`, or a CEL envelope) and whose
    submitted value is empty. `ObjectQL.applyFieldDefaults` resolves a declaration
    only for a field that arrives absent or null, so submitting a blank stores
    `''` and silently defeats it. **Create-only** — the caller keeps the mode gate.
  - `isRequiredInForm(field, isCreateForm)` — the `required` a form should
    enforce, given the mode. Published as the pair's other half on purpose:
    excusing a server-owned field from `required` and then submitting the key
    anyway is not half a fix, it is no fix.
  
  Both are pure functions over plain data (no React, no registry). The rest of
  `schemaDefaults.ts` — `seedCreateValues`, `schemaDefaultValues`,
  `isSeedableDefault`, `isCreateFormMode`, `SeedContext` — stays module-private,
  and `isRuntimeDefault` stays `@object-ui/core`'s to publish.
  
  No behaviour change. The console's `FormPage` now calls the published helper
  instead of composing `isRuntimeDefault` + `isMissingForRequired` locally; its
  create payload is decided identically before and after, pinned against the
  deleted implementation over the full matrix of default shapes, value spellings
  and both modes.
- 5173a5e: ⚠️ **Behaviour change: `current_user` predicates that have been doing nothing on
  the console form routes and in the wizard's submit gate now TAKE EFFECT.** Read
  this before upgrading if any of your form metadata gates on the session user.
  
  objectui#6010 bound the host predicate scope on the five authored-predicate call
  sites in the components form renderer, so `current_user` (plus the ADR-0068
  `user` / `ctx.user` / `os.user` aliases) resolves on `visibleWhen` / `visibleOn`
  there. Two other authored-predicate evaluators were still passing `undefined`
  for that argument, so the same authored text meant two different things
  depending on which surface opened the form (objectui#6110):
  
  - **`apps/console`'s form renderer**, on the authed internal route
    `/forms/:name`. The internal route is a runtime record surface by ADR-0089
    D1's own words (*"runtime record surfaces bind `record` + `current_user`"*),
    and its `visibleWhen` metadata is the same `*.view.ts` FormView the
    object-view chain renders — so a role gate authored once behaved differently
    depending on which route opened the form.
  - **`WizardForm`'s submit-time required re-check** (`missingRequiredByStep`),
    the gate that re-checks the whole declared field set at final submit because
    `allowSkip` can jump past a step. Its docstring promises *"the same verdict
    from all three rather than a second, divergent dialect"*, and since #6010 it
    was the divergent one.
  
  **Why nobody noticed, and why the fix is felt as a change.** `visibleWhen` fails
  OPEN: a field on screen is what you get when the predicate resolves TRUE, when
  the scope was never bound so the predicate faulted, *and* when the predicate is
  broken. Those worlds were indistinguishable, so an app that authored a
  `current_user` gate saw the field render and had no way to tell the rule was
  inert. After this change the predicate is evaluated for real, and fields and
  sections that have always been visible will disappear for the users the rule
  excludes. `requiredWhen` fails the other way (CLOSED), so a `current_user`
  requiredWhen that has been silently not applying will now start holding submits.
  
  In the wizard the change is a fix in the user's favour as well: a required field
  the wizard HID from this user was still counted as visible by the submit gate,
  so the submit was refused on a control the submitter could neither see nor fill
  in.
  
  **Before upgrading**, audit any `visibleWhen` / `visibleOn` / `requiredWhen` in
  your form-view and object metadata that names `current_user`, and confirm each
  predicate says what you actually want evaluated against `record` +
  `current_user`.
  
  **The public anonymous form `/f/:slug` is deliberately unchanged.** It is
  mounted outside `ProtectedRoute` so an anonymous visitor can submit it, there is
  no authenticated principal, and no provider is mounted above it — so its scope
  is empty and a `current_user` predicate authored on a public form still faults
  and still fails open, exactly as before. Nothing new is declared to say so: the
  two routes are told apart by which component mounts them.
  
  `@object-ui/app-shell` exports `buildExpressionUser`, the `ExpressionProvider`
  user normalisation, so every console surface that mounts the provider publishes
  the same `current_user` shape rather than re-deriving it.
- 971d387: ⚠️ **Behaviour change: an authored `FormSection.visibleWhen` that has been doing nothing
  will now START HIDING SECTIONS.** Read this before upgrading if any of your metadata
  authors a section predicate.
  
  `@objectstack/spec` declares `FormSection.visibleWhen` and this repo's spec bridge maps it
  through, but every plugin-form layout renders a section header as a virtual
  `section-divider` pseudo-field and none of them copied the predicate onto it. On the
  object-view chain — the create/edit modal, the drawer, the split form, and the full-page
  record form — the key was declared, mapped, carried, and then dropped one hop before
  anything could evaluate it. The section rendered unconditionally, with no diagnostic
  (objectui#6111).
  
  **Why nobody noticed, and why the fix is felt as a regression.** `visibleWhen` fails OPEN:
  a section that renders is what you get when the predicate resolves TRUE, when the predicate
  never arrives, *and* when the predicate faults. Those three worlds were indistinguishable,
  so an app that authored a section predicate saw its section render and had no way to tell
  that the rule was inert. Every such app has been running with the rule switched off, and
  some will have been authored — or simply grown used to — that state. After this change the
  predicate is evaluated for real, and sections that have always been visible will disappear
  for the users the rule excludes.
  
  This is the intended ADR-0089 contract being delivered, not a new capability: the key was
  already declared, already documented, and already honoured by the console form renderer.
  The object-view chain was the one that silently ignored it.
  
  **Before upgrading**, audit any `sections[].visibleWhen` in your form-view metadata and
  confirm each predicate says what you actually want, evaluated against `record` +
  `current_user`. A predicate that was written speculatively, or left behind after a rework,
  now takes effect.
  
  **Measured scope of the hide.** The predicate gates the section's HEADER row. The renderer
  treats `section-divider` as presentational and holds no association between it and the
  fields that follow it, so a false predicate removes the heading and the section's fields
  keep rendering. The console renderer (`apps/console`) drops the whole `<section>`, fields
  included. That divergence is real, is pinned honestly by this change's tests rather than
  implied away, and is filed separately — it needs a renderer-side grouping contract, not
  another line in a layout.
  
  Two hops were dropping the key and both are repaired: `ObjectForm` rebuilds each section
  key by key when it delegates to Split/Drawer/Modal (and `ModalForm`'s own `groups` map does
  it again), so a key those maps did not copy never reached the layout at all; and the six
  `section-divider` synthesis sites across the four layout files.
  
  `@object-ui/types` gains the matching `ObjectFormSection.visibleWhen` declaration.
- 5ef9c4f: The section grouping contract (objectui#6236, maintainer ruling 2026-08-27): a
  `section-divider` row may now CLAIM its member fields — `FormField.fields: string[]`, the
  same membership shape `FormFieldTab.fields` / `FormFieldPane.fields` already model — and
  the form renderer then gates the WHOLE group on the divider's own visibility verdict
  (`visibleWhen` / `visibleOn` / legacy `condition`).
  
  Before this, one authored `FormSection.visibleWhen` meant two different things: the
  console renderer drops the whole `<section>` (heading and fields), while the plugin-form
  chain's renderer treated `section-divider` as a purely presentational row and hid only
  the HEADING, leaving the section's fields rendering (measured in objectui#6111, which
  pinned that honestly rather than implying a guarantee it did not deliver).
  
  Ruled semantics, now pinned in `section-grouping-6236.test.tsx`:
  
  - **Visibility decides what is DRAWN and nothing else** (console precedent, 2026-08-22
    ruling after #5594) — a hidden section's values still submit.
  - **A hidden section's fields skip client-side validation** — a user is never blocked by
    an error pointing at a control they cannot see (the objectui#6110 defect shape); the
    server-side contract remains the loud floor for genuinely-required data. A section
    hiding mid-session also clears its members' stale errors, the way a field's own false
    predicate already did.
  - **A divider without a claim keeps the old contract** (its predicate gates only the
    heading), so existing schemas are untouched.
  
  Both halves ride the mechanism the field-level predicate already uses (return `null`;
  react-hook-form keeps the value and skips the unmounted control), so field-level and
  section-level visibility cannot drift apart. The zod mirror (`FormFieldSchema`) declares
  the key with the same scope note.
  
  `@object-ui/plugin-form` wires the producer half: all six `section-divider` synthesis
  sites (ObjectForm's stacked simple path, ModalForm's sectioned and derived-fieldGroup
  paths, DrawerForm's sectioned and derived-fieldGroup paths, SplitForm's panes) now stamp
  the membership claim onto the divider they emit, from the RESOLVED member list — so an
  authored `FormSection.visibleWhen` finally hides the whole section on the object-view
  chain, matching the console renderer. The #6111 honest pin (`measured scope`) flipped
  accordingly: it now pins heading-and-fields hiding together, and every per-layout DENIED
  row asserts the claimed member as well as the heading. The derived-fieldGroup sites carry
  the claim for uniformity but stay fail-open — the spec `fieldGroups` vocabulary has no
  section-predicate slot to author. The tabbed arm's predicate slot (objectui#6237) is
  designed to reuse this same grouping contract.
- 46f0bb4: The tabbed arm of the grouping contract (objectui#6237, same maintainer ruling as
  objectui#6236): `FormFieldTab` gains the predicate slot the ruling named —
  `visibleWhen?: string | { dialect?: string; source: string }` — so a section rendered as
  a TAB PANEL (`ModalForm` `contentLayout: 'tabbed'`) can finally carry an authored
  `FormSection.visibleWhen`. The tabbed layout synthesises no `section-divider` at all, so
  the #6236 membership-claim mechanism had nothing to stamp the predicate onto and no slot
  to copy it into; the predicate was silently dropped one hop before evaluation (measured
  in objectui#6237's card).
  
  The form renderer evaluates the tab's predicate with the same record assembly the
  field-level rules use (`ruleRecord` / `previousRecord` / host predicate scope, #6010),
  fail-open, and when FALSE draws neither the tab's trigger nor its panel. Not drawing the
  panel unmounts the claimed fields through the exact mechanism a field's own false
  predicate uses, so the ruled hidden-group semantics are inherited rather than
  re-implemented, and are pinned in `fieldtab-visiblewhen-6237.test.tsx`:
  
  - **Visibility decides what is DRAWN and nothing else** — a hidden tab's values still
    submit.
  - **A hidden tab's fields skip client-side validation** — a user is never blocked by an
    error pointing at a control they cannot see; the server-side contract remains the loud
    floor for genuinely-required data (#2959's trap, answered the same way for tabs as for
    sections). A tab hiding mid-session clears its members' stale errors.
  - **Deterministic re-selection**: a predicate hiding the ACTIVE tab activates the user's
    pick if still visible, else the declared default, else the first visible tab — never an
    empty panel — and the user's pick is restored the moment its tab is re-admitted.
  - **No mid-interaction collapse**: whether the tabbed arm engages stays judged on the
    DECLARED tabs, so a predicate hiding one of two tabs filters the strip (and hides the
    tab's fields) instead of collapsing the modal into the stacked layout under the user's
    cursor. With every tab hidden the strip is omitted; unclaimed fields still render.
  - **A tab without the key keeps the pre-#6237 contract** (always drawn), so existing
    schemas are untouched.
  
  `@object-ui/plugin-form` wires the producer half: `ModalForm`'s tabbed synthesis site now
  copies the section's `visibleWhen` onto the tab it emits, and the #6111 layout matrix
  gains the tabbed-modal rows (direct and via `ObjectForm` delegation). `TabbedForm` /
  `WizardForm` still declare no section predicate in their own section configs — those arms
  remain open on objectui#6237.
- 2da6441: `formType: 'tabbed'` now honours an authored section `visibleWhen` (objectui#6237).
  
  The tabbed arm of the one grouping contract ruled 2026-08-29 (option A). Before
  this, an authored `FormSection.visibleWhen` was dropped on the tabbed route
  while `split` / `drawer` / `modal` and the flat layout all honoured it — the key
  never reached a renderer at all, so it did nothing.
  
  `TabbedForm` already synthesised the renderer's `fieldTabs`, which is the same
  machinery the `modal` + `contentLayout: 'tabbed'` arm runs on. The predicate was
  simply dropped at three points on the way there, and all three now carry it:
  `ObjectForm`'s tabbed section map, `FormSectionConfig` (which declared no such
  key), and `TabbedForm`'s `fieldTabs` synthesis.
  
  Because the arm reaches the existing evaluator, the three ruled semantics are
  inherited rather than re-implemented beside it: a hidden tab's values still
  submit, its fields skip client-side validation (so a required field on a hidden
  tab cannot block a submit invisibly — objectui#2959's defect through a new
  door), a predicate hiding the ACTIVE tab re-selects deterministically instead of
  drawing an empty panel, and arm engagement stays structural on the DECLARED
  tabs so a predicate cannot collapse the strip mid-interaction.
  
  Two boundaries are deliberate:
  
  - A single-section tabbed form never engages the tab arm, so it degrades to the
    untabbed layout's own predicate mechanism — a chrome-less `section-divider`
    claiming its members by name. Existing single-section forms are unchanged; the
    gate is emitted only where a predicate was actually authored.
  - Wizard STEPS still do not take a predicate, and now say so in the type:
    `WizardStepConfig` omits the key, because a step predicate is a different
    contract (step-boundary reactive against the ruled live-record reactivity, and
    needing navigation and final-gate semantics none of this machinery supplies).
    `ObjectForm` continues to report that gap at runtime for untyped JSON.
- a29ae2d: A form-view section can reference a declared field group instead of copying its
  members (objectstack#13855, objectui#7051 — the view-level half; the
  `record:details` half shipped as objectui#8497).
  
  `@objectstack/spec` 17.3.0 declares two ways for a `form.sections[]` entry to give
  itself members: enumerate `fields`, or point `group` at one of the object's declared
  `fieldGroups` and inherit that group's membership **and** its presentation. Nothing on
  this renderer read `group`, and the omission was not a no-op:
  
  - on the default `simple` layout an authored `{ group: 'contact_info' }` threw
    `Cannot read properties of undefined (reading 'map')` out of the section loop in
    `SimpleObjectForm`'s own body — above the JSX it returns, so no per-section error
    boundary could contain it — and **blanked the entire form**, taking every
    well-formed sibling section with it;
  - on `tabbed` / `split` / `drawer` / `modal` the section silently rendered nothing;
  - on `wizard` it rendered an empty step.
  
  `ObjectForm` now resolves the reference **once**, above its routing fork, so all six
  layouts inherit it: a `{ group }` section renders the members that group declares, in
  the order and with the label, description and collapse state the object declares them
  with. Resolution goes through `deriveFieldGroupLayout` (ADR-0085 §5) via this
  package's existing single adapter — the same code path the no-sections field-group
  fallback already used, so authoring a group by reference and letting the fallback
  derive it produce the same section by construction. No assembly rule is
  re-implemented here.
  
  The object definition is fetched only when a section actually authors `group`, so a
  form that does not use the reference form issues no additional request and takes no
  new path.
  
  Diagnostics rather than silence, for the shapes the spec door cannot see (programmatic
  SDUI callers): a `group` naming no declared group renders nothing and is reported once
  on the console (`@objectstack/lint` owns it as `form-section-group-unknown`); a
  group-owned presentation key restated beside `group` is ignored — the spec grants no
  override semantics — and reported; `group` on a wizard step is refused and reported,
  because a step has no slot for the `collapse` / `visibleWhen` a group carries.
  
  Also in this change: `@object-ui/types`' `ObjectFormSection` declares `group` and makes
  `fields` optional, so the spec-legal shape finally compiles for a TypeScript author;
  and the shared field-group adapter now carries the group's `description` and
  `visibleWhen` onto the section it derives — both are keys the assembler emits and
  `ObjectFormSection` declares, and a key-by-key rebuild that drops one is how a declared
  group's presentation goes missing.
- 2d3fe73: Publish the parameter types of the entry's own exported functions, so a consumer can
  name what it must pass (objectui#7324).
  
  `ChildObjectSchemaLike` and `FieldDefaultsSchemaLike` are now exported from
  `@object-ui/plugin-form`. They are **type-only** additions — no runtime name is added
  to the entry, which is pinned.
  
  **Why `minor`, not `patch`.** Nothing breaks and no behaviour changes, but two names
  join the published surface of a published package. Additions are `minor` in this repo,
  and a new public export is the kind of addition a consumer's lockfile-pinned range
  should be able to see.
  
  **What was wrong.** Five exported derive functions (`deriveDetail`, `deriveColumns`,
  `deriveFormFields`, `findRelationshipField`, `resolveInlineMode`) take a `childSchema`,
  and the exported `omitServerResolvedDefaults` takes an `objectSchema` — and neither
  parameter type reached the entry. A host with its own form renderer (the reason
  objectui#6059 published `omitServerResolvedDefaults` in the first place) has to hold
  that schema in a variable or a prop, and could not annotate it. Structural typing means
  such a host still compiled by writing the shape out by hand, so the cost was not a hard
  failure but a producer-owned shape restated in every consumer, invisible to every gate
  until the producer's shape moved. The package README carried exactly that restatement,
  and now imports the real name instead.
  
  **Renamed at the declaration site first, deliberately.** Both types were called
  `ObjectSchemaLike`, in two files, and they are **not** the same type: the defaults one
  pins the four field members its rule reads (`defaultValue`, `type`, `reference`,
  `reference_to`), while the child one leaves a field value as `any` because the derive
  functions read much more of it. Measured with `tsc`, they are mutually assignable
  **only** through that `any` — replace it with `unknown` and the child → defaults
  direction fails (TS2322) — so re-exporting either under the shared name would have put
  a name on the public surface that already meant something else two files over, with
  nothing in the name to say which. Neither old name was reachable from outside the
  package (the package `exports` map has a single `.` entry and the entry never re-exported
  them), so the rename is not a break for any consumer.
  
  **Not** `@object-ui/types`' `ObjectSchemaMetadata`: measured, it requires `name`,
  requires a `type` on every field, and has no `reference_to` member — while
  `isCurrentUserSeedField` honours both `reference` and `reference_to` on purpose. Adopting
  it would have narrowed what these functions accept and dropped one of the two honoured
  spellings, not widened anything.
  
  ⚠️ **Dated note, 2026-09-30 — `FieldDefaultsSchemaLike` pins three members now — objectui#11070.** "the four field members its rule reads (`defaultValue`, `type`, `reference`, `reference_to`)" and "honours both `reference` and `reference_to`" above held when this change landed. Later in this same release objectui#11070 (round 4) retired `reference_to` there: `isCurrentUserSeedField` reads the target as `reference` alone, and the published type no longer carries a `reference_to` member. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
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
- 6fda1a9: Render a form section that REFERENCES a field group on the console's form page,
  and publish the resolver that does it (objectui#8641).
  
  `@objectstack/spec` 17.3.0 lets a `form.sections[]` entry declare its members
  either way — enumerate `fields`, or point `group` at one of the object's declared
  `fieldGroups` (objectstack#13855, ADR-0085 §5). `apps/console`'s `FormPage` has
  its own section builder, on none of `@object-ui/plugin-form`'s code path, and it
  read `sec.fields ?? []` and `sec.label` — neither of which a `{ group }` section
  carries. Measured in the DOM on both routes before the fix: the `<section>` was
  emitted with its border and padding and then stood **empty** — no heading, no
  inputs, no diagnostic — so a submitter saw a blank card where the group's fields
  belong. The same silent-drop class objectui#7051 closed on the `plugin-form`
  chain, at the third consumer.
  
  Newly importable from `@object-ui/plugin-form` — one function and the options
  type its signature requires, nothing else:
  
  ```typescript
  import {
    resolveSectionGroupReferences,
    type ResolveSectionGroupsOptions,
  } from '@object-ui/plugin-form';
  ```
  
  - `resolveSectionGroupReferences(sections, { objectName, formType, objectDef })`
    — replace every `{ group: 'x' }` section with the section that group declares
    (label, members, description, collapse state), leaving everything else
    untouched. With no reference in the list it returns its input **by identity**,
    so it cannot perturb an existing form and is safe inside a `useMemo`. An
    unresolvable reference yields an empty section, never a dropped one, and is
    reported once naming the object and the key.
  
  `hasSectionGroupReference`, `resetSectionGroupReports`, `GROUP_OWNED_SECTION_KEYS`
  and `SECTION_LAYOUT_KEYS` stay module-private, pinned as the withheld set.
  
  ⛔ No assembly rule is re-implemented on the console side: declared order, the
  empty-group drop, the ungrouped trailing bucket and the collapse / `visibleWhen`
  passthrough all reach it from `deriveFieldGroupLayout` through this package's one
  adapter — the same code path `ObjectForm` resolves through — which is why the
  resolver is exported rather than the derivation being read a second time.
  
  `ObjectSchemaPayload` in the console now carries `fieldGroups`, and its internal
  `/meta/object/:name` loader copies the key: that rebuild is key by key, so an
  uncopied key is gone before the builder can see it.
  
  No behaviour change for any form that does not author `group`.
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
- 63bf47d: `object-form`'s two seed keys now merge PER MEMBER. `initialData` is registered as
  the "alternate spelling of `initialValues` … read FIRST", and every presentation
  arm implemented that by choosing between the two as WHOLE OBJECTS —
  `schema.initialData || schema.initialValues`. `||` tests the object and never its
  size, and `{}` is truthy, so the two ways an author loses data were:
  
  - an EMPTY `initialData` — the shape a `?? {}` producer hands over when it has
    nothing to contribute — blanked a populated `initialValues` completely; and
  - a PARTIAL `initialData` naming one member dropped every other `initialValues`
    member, including the ones it said nothing about.
  
  Neither produced a warning, a diagnostic or an empty state: the form simply
  opened blank where it used to open seeded.
  
  ⚠️ **Behaviour change.** A page that used an empty or partial `initialData` to
  BLANK a form now gets the merge its description promised — `initialData` wins per
  member, `initialValues` supplies the rest. A page relying on the blanking must
  stop authoring `initialValues` on that node, or author the blank members
  explicitly (an explicit `null` member is still a value, not an absence).
  
  One shared `resolveInitialRecord(schema)` replaces the expression at every read
  site across every presentation arm — the flat form, Modal, Drawer, Tabbed, Split,
  Wizard and the master-detail parent form, which inherits it. Both read shapes go
  through it, and both keep the object schema's declared `defaultValue`s under the
  authored record — the sectioned arms at seed time through
  `seedCreateValues(objectSchema, …, ctx)`, the flat form one composition later at
  render. Neither layers an inline `customFields` member's own `defaultValue`, which
  is read from object metadata only. Each site is pinned rather than assumed.
  
  Registration descriptions are unchanged in substance; the two that quoted the
  deleted `||` expression now state the per-member precedence instead.
- 5a311a3: `object-form.customFields` now MERGES over the metadata-generated field set, as its
  registered description always promised (objectui#9778, maintainer ruling 2026-09-18,
  director seat batch #161 item 5).
  
  **Behaviour change, deliberately.** Hosts that used `customFields` as a full
  replacement now see the metadata-generated members too. Before this change a
  non-empty `customFields` replaced the generated set outright and the object's schema
  was never even fetched; the registration has always described the other thing —
  "Field definitions merged over the set generated from object metadata. With inline
  definitions and no data source, this becomes the only field source." The per-member
  merge the prose describes already existed as code in `ObjectForm` — the
  `customFields?.find((f) => f.name === name)` lookup inside the metadata branch — and
  was unreachable, because that branch ran only when `customFields` was absent or
  empty, i.e. only when the lookup had nothing to find.
  
  The merge takes three directions, one pinned case each in
  `objectFormCustomFieldsMembers-8071.test.tsx`:
  
  - **override** — a member naming a declared field supplies that field's whole
    definition, in the generated set's position, inheriting nothing from it;
  - **keep** — a declared field no member names still renders, from object metadata;
  - **append** — a member naming a field the metadata never declares is added after
    the generated set, in authored order.
  
  **Unchanged where there is nothing to merge over.** With no data source (or no
  `objectName`) there is no generated set, so the members remain the only field
  source — the registration's second sentence, and the shape `EmbeddableForm` uses,
  which deliberately passes no data source once inline members are present. An object
  the adapter cannot describe now falls back to that same members-only source rather
  than replacing a form that used to render with an error panel.
  
  **Migration.** ⛔ No "replace mode" option is added: a host that wants a bespoke set
  declares its own form. Two routes exist for a host that wants exactly its member
  list against an object that HAS metadata, both through the existing `fields`
  whitelist, which narrows the generated set the members merge over (measured):
  `fields: []` leaves the members as the whole set, and `fields: ['customer']` renders
  that one generated field plus the members. Authors who intended the documented merge
  all along need to change nothing.
- 8813335: `object-form`: one rule for section divider rows on the default, modal and drawer layouts,
  and there a section's own settings apply whether or not it has a heading (objectui#9849 step
  two, director ruling letter E). The split, tabbed and wizard layouts are not changed.
  
  Before this change, the default, modal and drawer layouts gave four different answers for a
  section with no `label`. Some drew no row, some drew a row carrying only the blurb, and some
  drew a full row. Whether the section's `visibleWhen` predicate and its `collapsed` /
  `collapsible` pair were honoured depended on which of those answers the layout gave.
  There is now one rule:
  
  - A section's `visibleWhen` predicate gates its fields on these three layouts, heading or not. A
    section with a `description` and no `label` on the default layout used to show its fields
    even when its predicate was false. That group is now hidden, like a titled one.
  - The divider row is drawn when the section has a `label` or a `description`. With a
    `description` alone it is the blurb-only row (no heading, just the blurb). The drawer's
    explicit `sections` path used to push a row for every section; it follows the same rule now.
  - The collapse control sits on that row. A blurb-only row can now collapse its section: on the
    default layout, `collapsed: true` on a section with a `description` and no `label` used to be
    ignored. It now starts closed, and clicking the blurb opens it.
  - A section that declares `collapsible` or `collapsed` but has neither a `label` nor a
    `description` has no row to hold the control. It renders open, and a console warning says
    so: "collapsible section has no heading or description to carry its control". Its fields
    are never hidden without a control.
  - The modal layout now honours `collapsible` / `collapsed`, both for explicit `sections`
    (`ModalFormSectionConfig` gains the two members) and for sections derived from the
    object's `fieldGroups`. Before, it ignored both and always drew every field. A modal with
    `contentLayout: 'tabbed'` and more than one explicit section draws tabs, which do not
    collapse, so that case is unchanged; with a single section, or with sections derived from
    `fieldGroups`, it renders stacked and honours the pair.
- 3c9fca3: Create forms pre-fill the `current_user` defaultValue token with the acting user (#5683). `PermissionContextValue` gains `userId` (from `/me/permissions`; `null` = unknown), and the create-form seeding resolves `defaultValue: 'current_user'` on `user` / `lookup→sys_user` fields to that id — the same value the engine stamps at insert, so the pre-fill is a preview of the server's own resolution, not a second default contract. Unknown user (no provider / anonymous / role-based provider) seeds nothing and keeps the omit-and-let-the-engine-resolve behavior. `NOW()` and CEL defaults stay server-owned.
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

### Patch Changes

- 142fdfd: fix(plugin-form): `customFields` merges on the drawer and modal arms too
  
  The registered description of `object-form.customFields` is one sentence for
  every `formType`: "Field definitions merged over the set generated from object
  metadata." The default arm has merged since objectui#9778, but an `object-form`
  with `formType: 'drawer'` or `'modal'` (and a `DrawerForm` / `ModalForm` mounted
  directly) still REPLACED the generated fields with the members, so the same key
  meant two different things depending on the arm.
  
  All three arms now resolve the members through one rule: a member naming a
  declared field is that field's whole definition, in its position; a declared
  field no member names still renders; a member naming nothing declared is
  appended after the generated set, in authored order. With no data source the
  members remain the only field source.
  
  `customFields` also no longer switches off the object's `fieldGroups` fallback
  or the modal's auto-layout (and so its auto-sized width), matching the default
  arm: the groups are derived over the merged field set.
  
  ⚠️ Behaviour change for authors who relied on the drawer or modal replacing the
  generated set: the object's other fields now appear alongside the members. To
  narrow the generated set, list the fields to draw in the `fields` whitelist, as
  on the default arm; the members are drawn either way.
- e026e15: A form no longer emits the columns the server owns, and a master-detail batch sends only the cells the user changed (objectui#10108).
  
  **Clause-②: no** — nothing an author writes changes, and no export moves. `SERVER_OWNED_FIELD_NAMES` is module-scoped inside the package (the package publishes `.` only, from `index.tsx`, which does not re-export `sanitize`), so this is a change to what the client PUTS on the wire, not to the package's face.
  
  **What it was.** The write-side roster in `sanitize.ts` and the render-side roster in `autoLayout.ts` were two hand-written copies of the same list, and they drifted. The render copy had learned to drop `owner_id`; the write copy never did. A form therefore showed the user business inputs only, and sent back every ownership and audit column it had read — `owner_id`, `owning_business_unit_id`, `created_by`, `updated_by` — while dropping `created_at` and `organization_id` from the same payload, because those two happened to be in the write copy.
  
  That is not a cosmetic difference. The platform refuses a write to a system-managed ownership column unless the caller holds the transfer grant, and it cannot tell a round-trip of the value it just served from an attempted ownership transfer. Echoing an UNCHANGED `owner_id` back was therefore a 403 for every role without that grant — and a master-detail save commits as one atomic batch, so one echoed column on one row refused the parent and every sibling row with it. The roles this blocked are the line-entry roles the feature exists for, which by definition do not hold the transfer grant.
  
  **What changed, in observable terms.**
  
  - One roster now serves both readings, so a form never writes a field it refuses to render. The unified list adds `owning_business_unit_id`, `company_id`, `space`, `_id`, `__v`, `created`, `modified`, `modified_by` and the camelCase spellings of the ownership FKs to BOTH sides. ⚠️ If an auto-laid-out form in your app was rendering one of those as an editable input, it no longer does, and no form writes one.
  - `sanitizeFormData` also refuses any field the object schema marks `system: true`, whatever it is called — so the next column the platform injects does not need an edit here to be refused.
  - A master-detail edit batch sends only the cells that differ from the loaded snapshot, and a row where nothing moved produces no operation at all (it used to be rewritten in full on every save). The comparison resolves everything it cannot settle towards SENDING, so a real edit is never dropped: `1000` and `'1000'` read as different, and a snapshot that does not show a row already linked still gets its FK re-asserted.
  - The lifecycle bookkeeping columns (`locked`, `instance_state`, `deleted`, `is_deleted`) are deliberately NOT in the roster — they are plausibly author-writable, and adding them on the strength of the pattern alone would silently drop a value a form was asked to persist.
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
- 2dd4d3f: An edit form now writes only the fields that changed (objectui#10156).
  
  **Clause-②: no.** No exported symbol, type or prop changes. `@object-ui/plugin-form` publishes `.` only, from `index.tsx`, and `index.tsx` re-exports neither `sanitize` nor `masterDetailTx`. After a build, `dist/index.d.ts` names none of the new helpers. The change is in what the client sends, and ⚠️ in what a host `submitHandler` receives in edit mode (see below).
  
  **Before.** A master-detail child row already sent only the cells that differed from its loaded snapshot (objectui#10108). The other two edit payloads did not. The plain record edit `PATCH` and the parent operation of a master-detail batch sent every sanitized field on every save, including fields the user never touched. With the concurrency guard, a `409` followed by **Overwrite** therefore rewrote every field, not only the ones this user changed.
  
  **What changed, in observable terms.**
  
  - In edit mode, `ObjectForm`, `ModalForm` and `DrawerForm` compare their save with the record they read through `findOne`, and write only the fields that differ. The parent operation of a master-detail batch follows, because its header is a simple `ObjectForm`.
  - There is one comparison, shared with the master-detail child rows. It sends anything it cannot prove unchanged. `null` and `undefined` count as the same value. `null` and `''` are different. So are `5` and `'5'`, a lookup id and its expanded object, a `Date` and a date string, and two objects whose keys come in a different order. A field the form changed by itself after the read, such as a cascade clear, is sent.
  - A save with nothing changed still sends the full sanitized payload. It stays a real request, with the same concurrency guard and a real server record for `onSuccess`.
  - A form that did not read the record itself still sends every field. That covers a create, a record supplied as `initialData`, and inline `customFields`.
  - After a successful save, the form counts the fields it just wrote as saved. A form that stays open compares its next save with the record as it is now. Changing a field back to its first-read value is therefore still sent.
  - The concurrency guard is unchanged by this rule. The update carries `ifMatch` = the `updated_at` the form read (after a save, a form that stays open sends the `updated_at` that save returned instead, objectui#10565), and a `409` still offers **Keep editing** or **Overwrite**. **Overwrite** now resends only the changed fields.
  - ⚠️ A host `submitHandler` on an edit form receives the payload the form would have written. That is the changed fields, or the full sanitized payload when nothing changed. A host that needs the whole record must read it itself. In this repository, only `MasterDetailForm` passes a `submitHandler` to an edit form. Its header form receives the changed fields. Its row editor has no `recordId`, so it still receives every value.
  - The JSDoc of `ObjectFormSchema.submitHandler` in `@object-ui/types`, and its copies on `ModalFormSchema` and `DrawerFormSchema`, now say what an edit-mode handler receives.
  
  **Not covered at this change.** The `tabbed`, `wizard` and `split` variants had save paths of their own and still sent every value they held. That included a master-detail header laid out `tabbed`, and a simple form whose mobile `stepper` option shows it one step at a time through the wizard.
  
  ⚠️ **Dated note, 2026-09-25 — those variants have since been covered — objectui#10563.** Later in this same release the `tabbed`, `wizard` and `split` save paths, the `stepper` route and a master-detail header laid out `tabbed` write through the same sequence as the simple form: the same strip, and on an edit the same comparison against the record they read. The rest of this entry is kept as the reading of this change; the objectui#10563 entry states what those layouts now send.
- b809375: A `record:line_items` grid no longer offers a cell the CALLER may read but not edit (objectui#10163).
  
  **What it was.** `80c54122e` taught the record-form containers to render a field the caller's permission set marks `editable: false` as disabled, through one shared render pass. The line-items panel stayed outside that pass: it read `readonly` and nothing else, so on the same page the same column rendered as a live, editable cell — inviting an edit the server refuses.
  
  **What changed, in observable terms.**
  
  - The panel's columns now go through the same render pass the form containers use, adapted to the grid: a column the caller may read but not edit renders its cells locked (on loaded rows and on the entry row alike), and a column the caller may not read is omitted, exactly as the forms omit such a field. Columns the caller may edit are unchanged.
  - Adding and removing lines are unchanged: they still follow the panel's `readonly`.
  - With no permission provider mounted the grid is exactly as before — every cell editable. That fail-open posture is objectui#10161's and is not moved here; the server still enforces.
  
  **Clause-②: no** — no exported symbol is added, removed, renamed or retyped. The new column adapter lives in a module `@object-ui/plugin-form`'s entry does not re-export. No authored key changes meaning and no accept set is relaxed.
  
  **Not in this entry.** The master-detail form's own child grid (`object-master-detail-form`) is covered by the companion objectui#10163 entry.
- 6099dd8: A master-detail form's child grid no longer offers a cell the CALLER may read but not edit (objectui#10163).
  
  **What it was.** The companion objectui#10163 entry routed the `record:line_items` panel's columns through the render pass the record-form containers share. The master-detail form's own child grid (`object-master-detail-form`) renders through the same line-items widget and read no field-level permission, so a child column the caller's permission set marks `editable: false` rendered as a live, editable cell — inviting an edit the server refuses.
  
  **What changed, in observable terms.**
  
  - Each child collection's columns now go through that same pass: a child column the caller may read but not edit renders its cells locked (on loaded rows and on the entry row alike), and a child column the caller may not read is omitted, exactly as the line-items panel does. Columns the caller may edit are unchanged.
  - With no permission provider mounted the grid is exactly as before — every cell editable. That fail-open posture is objectui#10161's and is not moved here; the server still enforces.
  - The per-row "expand to full form" editor is unchanged: it is a record form and already rendered through the form containers' pass.
  
  **Clause-②: no** — no exported symbol is added, removed, renamed or retyped, and no prop changes. No authored key changes meaning and no accept set is relaxed.
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
- 88a4ef6: fix(plugin-form): `DrawerForm` no longer paints an editable form before the record it edits has loaded
  
  Opening an edit drawer showed the form empty and editable while the record read
  was still in flight, and when the record arrived it replaced whatever had been
  typed there — the value was gone from the screen and from the save, with no
  warning. The drawer already refused this when switching from one record to
  another; it now refuses it on the first load too, keeping its loading state
  until the record read lands.
  
  `DrawerForm` builds its fields and reads its record in two effects that both run
  when the object schema arrives. The field-building effect used to end the
  loading state unconditionally; it now leaves that to the record read whenever
  one is outstanding.
- 6ea68e6: fix(plugin-form): the default `object-form` layout draws a section's members in the order the section lists them, and applies each section entry's overrides
  
  With explicit `sections` and no `formType`, `ObjectForm` resolved each
  section's members with a name filter over the form's field list. The members
  came out in the order of that list (top-level `fields`, or the object's own
  field order), not in the order the section wrote them, and a section entry
  written as a spec `FormFieldSchema` object (`{ field: 'note', label: …,
  required: true }`) kept only its `visibleOn`, `colSpan` and `span`. Every other
  override was dropped without a warning. An authored `required: true` was
  therefore not enforced, and `label`, `readonly`, `hidden`, `helpText`,
  `placeholder`, `options`, `min` / `max`, `widget` and `visibleWhen` did nothing.
  The `drawer`, `modal`, `tabbed`, `wizard` and `split` layouts already honoured
  all of them, so the same `sections` block laid out differently depending on
  `formType`.
  
  The default layout now builds sections the way the other five do. Members
  render in the section's order, and every entry override applies: `required`
  refuses an empty submit, and `visibleWhen` hides the member until the record
  satisfies it. Two things stay as they were. First, a section member that the
  top-level `fields` does not list is still dropped, with its console warning,
  because the two keys intersect. Second, at this change the form's own field
  definition remains the starting point for an override, so an override does not
  lift a managed object's field lock, and field-level security still hides or
  locks each member. The same fix reaches `object-master-detail-form`, whose
  parent form renders through this layout.
  
  ⚠️ **Dated note, 2026-09-25 — the managed-object field lock no longer rides the form's own field definition — objectui#10612.**
  Later in this same release the lock moved out of this layout's field generator
  into the one field-gate step every layout draws its fields through, after the
  section builder and together with field-level security. An override still does
  not lift the lock, but the reason is now that the lock is applied after the
  override, on every layout, rather than that it rides the definition the
  override starts from. The rest of this entry is kept as the reading of this
  change.
- e0f8202: The `tabbed`, `wizard` and `split` form layouts now write what the simple form writes (objectui#10563).
  
  **Clause-②: no.** No exported symbol, type or prop changes. The shared sequence lives in an internal module that `index.tsx` does not re-export. The change is in what the client sends, and ⚠️ in what a host `submitHandler` receives from these layouts (see below).
  
  **Before.** The simple form, `ModalForm` and `DrawerForm` strip a save before sending it, and on an edit they send only the fields that differ from the record they read (objectui#10108, `80c54122e`, objectui#10156). `TabbedForm`, `SplitForm` and `WizardForm` did neither. An edit sent every value the form held: `id`, `owner_id`, `created_by`, `updated_at`, formula columns, and fields the caller's field-level security refuses. The server answered with a `403` or an unknown-field refusal. A create seeded with a whole record, such as a copy of an existing one, posted those columns too. A simple form whose mobile `stepper` option shows it one step at a time renders through `WizardForm`, so it had the same defect.
  
  **What changed, in observable terms.**
  
  - In edit mode, the `tabbed`, `wizard` and `split` layouts and the `stepper` route write only the fields that differ from the record they read with `findOne`. They use the same comparison as every other layout. A save with nothing changed still sends the full stripped payload, with the same concurrency guard.
  - On every save, create or edit, these layouts drop the fields a form never writes. That means server-owned columns, computed, formula and read-only columns, keys the object does not declare, and fields the caller's field-level security refuses. A field whose name is on the server-owned roster, such as `owner`, is not written even when an object declares it as an ordinary field. The other layouts already worked this way.
  - A field the caller may read but not edit now renders disabled on these layouts, as on the others, also when a section names it by a bare string. Before, it rendered as a live input. With the strip above, a value typed there would have been dropped while the save reported success.
  - After a save succeeds, a form that stays open compares its next save with the record as it now is.
  - ⚠️ A host `submitHandler` on one of these layouts now receives, in edit mode, the payload the form would have written. That is the changed fields, or the full stripped payload when nothing changed. A master-detail header laid out `tabbed` therefore sends only its changed fields in the parent operation, as a `simple` header already did.
  - With inline `customFields`, the object definition is not used for the strip, as on the simple form. An inline member may name a field the object does not declare, and its value is still sent.
  - An empty field whose runtime default the server resolves is left out of the payload whenever the form has no persisted record: `mode: 'create'`, or no `recordId`. That is the rule the simple form and the seeding of these layouts already use. Before, these layouts left it out only when `mode` was `create`.
  - The JSDoc of `ObjectFormSchema.submitHandler` in `@object-ui/types` no longer lists these layouts as exceptions. The copies on `TabbedFormSchema`, `SplitFormSchema` and `WizardFormSchema` now say what an edit-mode handler receives.
- cc07476: A master-detail edit form that stays open after a save no longer re-creates the line items it just created, re-deletes the ones it just deleted, or drops a line cell changed back to its first-read value (objectui#10564).
  
  **Clause-②: no.** No exported symbol, type or prop changes. The change is in what the form's next save sends.
  
  **Before.** The form diffed every save against the child rows it read when it opened. A host that keeps the form mounted after a save (an `onSuccess` that does not navigate away) therefore got:
  
  - a second copy of a line the first save created, because that row never learned its id and was created again on the next save;
  - a second `delete` of a line the first save had already deleted;
  - a lost edit when a line cell was changed, saved, and changed back to its first-read value: the second save sent no line operation and still reported success, and the server kept the first save's value.
  
  **What changed, in observable terms.**
  
  - After a successful edit save, the rows that save created take the ids the batch returned for them, and the collection's baseline takes on what the save wrote. The next save compares with the lines as they now stand. This is the same rule the parent record already followed after a save (objectui#10156).
  - A save that fails advances nothing, neither the parent nor the lines, so a retry still sends every operation.
  - The lines take no input while a save is in flight (objectui#10631), so nothing typed during a save can separate a line the save created from its id.
  - Create mode is unchanged: a successful create still clears the lines and the header for the next entry.
- f99f9cd: An edit form that stays open no longer meets the conflict dialog over its own earlier save (objectui#10565).
  
  **Clause-②: no.** No exported symbol, type or prop changes. The change is in which `ifMatch` an edit save sends.
  
  **Before.** Every edit layout (the simple form, `modal`, `drawer`, `tabbed`, `split` and `wizard`) sent `ifMatch` = the `updated_at` of the record it read with `findOne`, on every save. None of them refreshes that record after a save. The first save moves the stored `updated_at`, so the second save from the same open form sent a version the server no longer held. A server that enforces `ifMatch` answered `409 CONCURRENT_UPDATE`, and the user was offered **Keep editing** or **Overwrite** over a conflict with their own first save.
  
  **What changed, in observable terms.**
  
  - After a save lands, the next save of the same record from the same open form sends the `updated_at` that save returned, for every layout. The **Overwrite** retry counts as a save, so the save after it sends the version the overwrite returned.
  - A genuine conflict still answers `409`: if someone else saves the record between two saves, the dialog still opens.
  - If the form reads the record again and gets a different `updated_at`, the new read's token is sent.
  - A record read without an `updated_at` is still saved without `ifMatch`. When a data source's `update` resolves without an `updated_at`, the next save sends the read's token, as before.
  - What a save writes is unchanged: an edit still sends only the fields that differ from the record the form read (objectui#10156).
- 4a3d500: `object-form` in edit mode re-reads its record when the data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a change to that record, its object, or everything (objectui#10572). The re-read is gated on pristine: an untouched form refreshes in place without remounting, while a form holding unsaved input keeps both the typed values and the version token its edit started from, so a real conflict still surfaces at save. One held re-read is replayed once the edit is saved or the form returns to pristine. A change to another record of the object reads nothing.
- 41dcbd5: Every `object-form` layout now locks a managed object's fields, as the simple form does (objectui#10612).
  
  **Clause-②: no.** No exported symbol, type or prop changes. The shared step lives in `fieldWriteGate.ts`, an internal module that `index.tsx` does not re-export. What changes is which inputs the `drawer`, `modal`, `tabbed`, `split` and `wizard` layouts draw enabled.
  
  **Before.** ADR-0092 D4 locks a form on a managed object: when the object's CRUD affordance for the form's mode is closed, every field is disabled. The affordance comes from the object's `managedBy` bucket, its `userActions` opt-in (`create` on a create form, `edit` on an edit form) and the server's effective API operations. Only the simple form applied this lock, inside its own field generator. The `drawer`, `modal`, `tabbed`, `split` and `wizard` layouts drew live inputs on, for example, a `managedBy: 'better-auth'` object with no `userActions.create`, and the server then refused the save. The layouts disagreed with each other on the same object for the same user.
  
  **What changed, in observable terms.**
  
  - The `drawer`, `modal`, `tabbed`, `split` and `wizard` layouts, flat or sectioned, now disable every field of an object whose affordance for the form's mode is closed. This covers a managed bucket that does not open the mode, and any object whose `create` or `update` the server's effective API operations deny. The simple form did this already.
  - The lock and field-level security now run as one step that every layout calls on the fields it has resolved. A field the caller may not read is dropped, and a field they may read but not edit is locked, on every layout, as before.
  - ⚠️ On the simple form, an inline `customFields` member, and a section entry already written as a full field definition, are now locked with the rest of a managed object's fields. The lock used to be set only on the fields the simple form generated from the object, so those two escaped it.
  - The lock sets `disabled` only, as it did on the simple form, and the submit button stays on screen on every layout. The server's write guard is still what refuses the write. The notice that explains the lock, and the wizard's disabled Next, come with objectui#11000.
- 5c61e52: A master-detail form no longer takes input into its lines, or sends a second batch, while its save is in flight. A slow save can no longer write the same records twice, or leave the lines it created without their ids (objectui#10631).
  
  **Clause-②: no.** No exported symbol, type or prop changes. The line-item grids are given the `disabled` prop they already had.
  
  **Before.**
  
  - Save re-armed 1.5 s after it was clicked, whatever the batch was doing. With a batch slower than that, a second click sent a second batch built from the same baseline. In edit mode the lines that save created were created twice; in create mode the whole document, parent and lines, was.
  - The lines stayed editable during the save. A line the save creates takes the id the batch returns for it only while it is still the row object the batch was built from, and a grid with a sort field (a child field named `position`, `sort_order`, `sequence`, `line_no`, `line_number` or `sort`) replaces every row object on any change. One keystroke in such a grid during the save left every line the save created without its id, and the next save deleted and re-created all of them.
  - A save started by submitting the header form without the Save button (an implicit submission, when the header has a single text input) left Save and the lines enabled, and a second such submit sent a second batch.
  
  **What changed, in observable terms.**
  
  - Save stays disabled and reads "Saving…" until the batch succeeds or fails. A failed batch re-enables it, and the refusal is shown as before. The 1.5 s release is kept for a submit that never reaches the batch, such as a header that fails validation, so Save is never left stuck.
  - While a save is in flight every line-item grid is disabled: no cell takes input, and there is no empty trailing row, add, duplicate, remove or reorder. An open row editor ("expand to full form") is disabled too, "Apply" included. Both take input again once the save has settled.
  - A header-form submit that arrives while a batch is in flight is refused and sends nothing. The host's `onError` hears of it, and the save that is running keeps Save disabled until its own outcome.
  - The header fields stay editable during the save. In edit mode an edit made there is kept and sent by the next save; in create mode the header still clears for the next entry once the create lands.
  - The `record:line_items` panel's grid is disabled while its own save is in flight. That panel reloads its rows once the save lands, so a line edited in the meantime used to be overwritten by the reload, with the panel reading clean.
- 1ea21c4: fix(plugin-form): `ModalForm` no longer paints an editable form before the record it edits has loaded
  
  Opening an edit modal showed the form empty and editable while the record read
  was still in flight. When the record arrived it replaced whatever had been
  typed, and the save that followed sent the whole record with its original
  values. The value was gone from the screen and from the save, with no warning.
  The modal now keeps its loading state until the record read lands, as the edit
  drawer has done since objectui#10190.
  
  `ModalForm` builds its fields and reads its record in two effects that both run
  when the object schema arrives. The field-building effect used to end the
  loading state unconditionally. It now leaves that to the record read whenever
  one is outstanding, through the same check the drawer uses, which both
  containers now share.
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
- ee6f6c6: fix(plugin-form): the line-items panel clears its load error when a later load commits rows (objectui#10682, objectui#10683)
  
  The `record:line_items` panel (`LineItemsPanel`) shows one banner, written by a
  failed load and by a failed save. Only the start of a save cleared it, so after
  a failed load the banner stayed over the rows a later load drew, and after a
  failed save it stayed over the rows a later load put in place of the edits it
  was about. Now only the current load writes that banner. When it commits rows it
  clears the banner, whether it holds a failed load's message or a failed save's.
  A load that fails shows its own failure instead. A load that another has
  superseded (another parent record, say, while it was in flight) neither raises
  the banner nor clears it. This is the rule objectui#10578 set for `ObjectGantt`:
  the error is cleared when the current load commits, never when a load starts.
- b526480: fix(plugin-form): a failed read no longer keeps a record form on its error screen after a later read of the same kind succeeds (objectui#10682)
  
  Every layout `ObjectForm` routes to (its default layout, `DrawerForm`,
  `ModalForm`, `SplitForm`, `TabbedForm` and `WizardForm`) reads the object
  schema and then the record before it draws, and shows its error screen ahead of
  the form whenever a load error is set. Both reads wrote that one error and
  nothing ever cleared it. After one failed read, a later read that succeeded
  still wrote its values, but the form stayed on the error screen until it
  remounted. Since objectui#10572 the default layout also re-reads its record in
  place when the data-invalidation bus reports a change to that record, to its
  object as a whole, or to everything, and holds that re-read while the form has
  unsaved input. So one failed background re-read was enough.
  
  Each form now keeps the failure of each read apart and shows the error screen
  while either is set. A read's failure is cleared when a later run of the same
  read commits. A record read that succeeds clears an earlier record failure and
  never a schema failure: after a failed schema read, a record read can only run
  over a schema read earlier, for another object or data source. This is the rule
  objectui#10578 set for `ObjectGantt`, applied per read. Only the current run of each read writes its failure, so a superseded
  read can neither clear the current failure nor raise its own over the current
  values. The error is not cleared when a read starts; it stays until that read
  commits.
  
  A failed background re-read is still reported: no form has a silent mode, so it
  shows the error screen rather than keeping the last good values, and the next
  re-read that succeeds takes the screen back.
- bf14b64: fix(plugin-form): the line-items panel commits only the answer to its current load, a save only to the parent it was issued for, and holds a same-parent reload while it has unsaved edits (objectui#10712)
  
  The `record:line_items` panel (`LineItemsPanel`) loads its rows again whenever
  the parent record or a load input changes. When a load was superseded by a
  newer one while it was in flight (the host moved the panel to another parent,
  say), its answer still landed. Landing last, it replaced the current parent's
  lines (since objectui#10740 the rows it brought were refused as another
  parent's, so the current lines were gone either way); landing first, it ended
  the loading state and drew the grid while the current load was still pending.
  Now a superseded load commits nothing: not the rows, not the end of the loading
  state.
  
  The panel's save reloaded the rows through the `load` it captured when Save was
  clicked. A save that landed after the panel had moved to another parent
  re-read the old parent, its lines were then committed into the new parent's
  panel (and, since objectui#10740, refused there behind the placeholder), and
  its failure was written over the new parent's panel. Now a save reloads only
  while the parent it saved is still on screen, reading the panel's current
  inputs (sort, limit, filter) rather than the ones captured at the click, and a
  save whose parent has left the screen neither re-reads nor reports.
  
  A change to a load input other than the parent (sort, limit or filter) re-read
  the rows while the author had unsaved lines, and the read's commit discarded
  those lines with no signal. Now, as the default record form already does for
  its own background re-read, the panel holds such a change while it has unsaved
  edits for the current parent: no read is issued, the edited lines stay drawn
  and saveable, and the next read that runs (the post-save reload, a parent move,
  or the commit of a same-parent read that was in flight) carries the change.
  While a change is held, the grid shows the rows under the previous sort, filter
  or limit until the panel saves, with no signal. A change while the panel is
  clean, a parent move, and a change of adapter or child object still read as
  before. No prop, export or schema key changes.
- 4345558: fix(plugin-form): a record form keeps what its current read committed when an earlier read lands late (objectui#10712)
  
  Every layout `ObjectForm` routes to (its default layout, `DrawerForm`,
  `ModalForm`, `SplitForm`, `TabbedForm` and `WizardForm`) reads the object
  schema and then the record before it draws. When the form is pointed at
  another record or object while a read is in flight, that earlier read is
  superseded, but two of its writes still landed:
  
  - The default layout and `WizardForm` wrote a superseded record read's values
    over the current record's. If the previous record's answer landed last, the
    form showed the previous record's values under the new record id. If it
    landed first, it ended the loading state while the current read was still
    pending. The other four layouts already ignored such an answer.
  - All six layouts wrote a superseded object-schema read over the current one.
    After an `objectName` or data-source change, the previous object's schema
    could land last, and the current record was then drawn against the previous
    object's fields. A superseded schema read that failed also ended the loading
    state while the current one was pending, on the four layouts whose failure
    branch ends it.
  
  Now a superseded read commits nothing: not the values, not the schema, and not
  the end of the loading state. Each read's failure is still reported only by
  its current run, as objectui#10682 set. No prop, export or schema key changes.
- 704e05b: fix(plugin-form): every `object-form` layout re-reads its record on the data-invalidation bus (objectui#10715)
  
  `object-form` in edit mode re-reads its record when the data-invalidation bus
  (`notifyDataChanged` from `@object-ui/react`) reports a change to that record,
  its object, or everything, gated on pristine (objectui#10572). Until now only
  the default layout did. With `formType` set to `drawer`, `modal`, `split`,
  `tabbed` or `wizard`, the form kept the record as first read: after a change
  another writer announced on the bus, `findOne` stayed at one call on each of
  the five, while the default layout read again.
  
  The five layouts now read the bus by the default layout's rule, which is stated
  once in the package: a pristine form re-reads in place, without remounting; a
  form holding unsaved input keeps the typed values and the version token its
  edit started from, and replays one held re-read once the edit is saved or the
  form returns to pristine; a change to another object, or to another record of
  the object, reads nothing; a create form reads nothing. The re-read runs
  through each layout's own record read, so a re-read a later one has superseded
  commits nothing (objectui#10712).
  
  Two layouts have state of their own. A wizard also holds the re-read while a
  step submitted with Next carries an answer not yet saved, so a re-read never
  discards it, and a re-read never moves the wizard off its current step. A
  closed drawer or modal reads while closed and opens on the fresh values, with
  no further read on open. No prop, export or schema key changes.
- cf00ea8: fix(plugin-form): a wizard goes back to its loading state when it is pointed at another record (objectui#10726)
  
  When a mounted `WizardForm` in edit mode was given another `recordId`, it kept
  drawing the previous record while the new record was read. The previous
  record's values stayed on the current step and could be edited, so anything
  typed in that window was typed into the previous record's values while the form
  already stood for the new record.
  
  The wizard now does what `DrawerForm`, `ModalForm`, `SplitForm` and
  `TabbedForm` already do: a change of record takes it back to the loading state
  until the new record's answer lands. Only a change of record does this. A
  wizard whose record read runs again for the same record, for example because
  the caller rebuilt `initialValues`, stays on screen. A create wizard never goes
  back to loading.
  
  The current step, the completed-step marks and the step error marks carry over
  a record change, as before. No step draws a value of the previous record once
  the new record lands, since every step reads its values from the new record's
  answer. No prop, export or schema key changes.
- 0896838: fix(plugin-form): the line-items panel neither draws nor saves the lines it holds for another parent record (objectui#10740)
  
  The `record:line_items` panel (`LineItemsPanel`) holds one set of rows, replaced
  when a load commits. When the host moved the panel to another parent record
  without a remount and that parent's load failed, the previous parent's lines
  stayed on screen, edits included, drawn editable with Save enabled; Save then
  wrote them under the new parent's id, moving another record's lines to it. A load
  that declined for the new parent (a refused filter) drew the decline's own notice
  but left the same Save enabled over the same held rows.
  
  Now the panel records which parent its held rows belong to, wherever the rows are
  written: a load's commit, or an edit made before any load settled. While that
  parent is not the current one, no held line is drawn (after a failed load a
  placeholder stands where the grid would be, under the failure's banner; after a
  refused-filter decline that filter's own notice stands there, as before; after a
  lost-adapter decline the placeholder stands alone), the Save button is off, and a
  save sends nothing. A load for the current parent that commits
  takes the grid back. Unchanged: a load for the new parent that succeeds replaces
  the rows as before, and a re-load of the same parent that fails keeps the
  author's unsaved edits drawn, editable and saveable under that parent.
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
- ed76b1b: fix(plugin-report,plugin-form): a dataset report and an authored-parent `record:line_items` panel re-read on the data-invalidation bus
  
  The one fetch every dataset report presentation runs through (the tabular and
  summary table, the matrix, the embedded chart, each joined block) now names the
  `useDataInvalidation` nonce for the dataset's base object, the object the
  query's answer names. So a write declared on the bus (`notifyDataChanged`, as a
  page action over raw HTTP does) re-reads a `report` / `spec-report` block in
  place: the rows on screen stay drawn until the answer replaces them, where
  before the block dropped back to "Running report…". The `spec-report` a
  drill-down drawer opens for `drillDown.report` re-reads the same way. A report
  whose answer names no object does not subscribe. A re-read that fails shows the
  error in place of the rows and keeps listening, so the next such write re-reads
  the report; a first load that fails, or a new selection, listens to nothing
  until an answer names its object.
  
  The child-row read of `record:line_items` now names the nonce for its child
  object, so a panel with an authored `parentId` / `recordId` (one a stored page
  holds with no record context) re-reads its lines after such a write. A re-read
  of the lines on screen keeps the grid drawn, taking no input until the answer
  lands. While the panel holds unsaved edits the re-read is held, and the save's
  reload carries it, as for any other re-read of this panel.
  
  Before, both refreshed after such a write only when their host remounted them,
  and `PageView` is about to stop doing that (objectui#10519).
  
  ⚠️ **Dated note, 2026-10-02 — `spec-report` is retired — objectui#11440.**
  Later in this same release `@object-ui/plugin-report` stopped registering `spec-report`, an alias of
  `report`, and the drill-down drawer renders `drillDown.report` as `{ type: 'report', report }`. So
  "a `report` / `spec-report` block" above now reads a `report` block, and "The `spec-report` a
  drill-down drawer opens" reads the `report` node it opens; both re-read the same way.
  `.changeset/11440-retire-spec-report.md` states what ships. The rest of this entry is kept as the
  reading of this change.
- de1b879: fix(plugin-form,components): an edit-mode `object-master-detail-form`'s detail lines and `element:record_picker`'s options re-read on the data-invalidation bus
  
  An `object-master-detail-form` in edit mode now reads the bus for each detail
  collection's child object: a write declared there (`notifyDataChanged`, as a
  page action over raw HTTP does), or an unscoped `'*'`, re-reads that
  collection's lines in place, and the rows and the baseline the next save diffs
  against move together. A collection only re-reads for its own child object. The
  header already re-read through its own form. While a collection holds lines the
  user has changed since they were last read or saved (compared the way the save
  compares rows, with the link to the parent set aside), or while the row editor
  ("Open row") is open on it, its re-read is held. It runs once, when the row
  editor is closed and either the lines have been changed back or this form's
  save has landed. A line typed while a re-read is in flight, in the grid or in
  the row editor, is kept, and the re-read is held behind it; an open row editor
  is never reset by a re-read. A re-read that fails keeps the lines on screen.
  `object-form` with `subforms`, which renders the same form, re-reads the same
  way.
  
  `element:record_picker` now re-reads its options when the bus reports a write to
  the object it queries. The re-read keeps the control enabled over the options on
  screen (no "Loading…") and never touches the bound page variable. If the bound
  record is no longer among the options, the variable keeps its value and the
  control shows no label until a later read offers that record again.
  
  Before, both refreshed after such a write only when their host remounted them,
  and `PageView` is about to stop doing that (objectui#10519).
- e3782d2: docs(plugin-form): the README's authored `object-form` examples write their props in the `properties` bag (objectui#10859, batch 4)
  
  The multi-step and metadata-route examples now author `{ "type": "object-form", "properties": { … } }`, the spelling `@objectstack/spec`'s `ComponentPropsMap['object-form']` row declares and `objectui validate` now requires. The example that mounts `WizardForm` directly keeps the flat `schema` prop: a component mounted without `SchemaRenderer` receives the node as the renderer reads it after the hoist. No runtime change.
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
- 2eaf5be: `WizardForm`'s own chrome now reads the locale packs (objectui#10999). The
  default Cancel, Back, Next, Submitting, Create and Update labels, the
  "Step x of y" counter, the step indicator's label for a step that declares no
  `label`, the indicator's accessible name, and the notice on a step with no
  fields were English literals, so a wizard in a zh session showed `Cancel`,
  `Step 1 of 3` and `Next` beside a Chinese UI. They now resolve through the
  wizard's existing `createSafeTranslation` hook, the way the rest of
  plugin-form's chrome does.
  
  An authored `cancelText`, `prevText`, `nextText` or `submitText` still renders
  exactly as authored, in every locale: only the defaults are localized, and the
  four keys stay plain strings.
  
  Five of the strings reuse keys the packs already carried: `common.cancel`,
  `common.next`, `form.create`, `form.update`, and `form.stepOf`, a key that
  `pnpm check:i18n-dead-keys` listed as read by nothing until now. Five are new
  under `wizard.` in all ten packs: `back`, `submitting`, `stepFallback`,
  `progressLabel` and `emptyStep`. The wizard gets its own `back` rather than
  `common.back` because zh words a wizard's step back ("previous step", the term
  `grid.import.back` and `grid.bulk.back` already use) differently from a page's
  back ("return").
  
  The zh value of `form.stepOf` gains the spaces around its numbers that the zh
  pack's other position counters, such as `table.pageInfo` and
  `detail.recordOf`, already carry.
  
  **One rendered English string changes**: the final button's in-flight label was
  typed with three ASCII full stops and is now `Submitting…` with the typographic
  ellipsis, because it is a pack value now and `ellipsis-glyph-3878.test.ts`
  holds every pack value to U+2026. Every other English default renders the same
  text as before.
- bf7ab35: A record form whose fields are all locked because the user may not create (or
  edit) records of its object now says so (objectui#11000). The ADR-0092 D4 lock
  disables every field when the object's affordance for the form's mode is
  closed: the object's `managedBy` bucket keeps it closed, or the server's
  effective API operation set for the user lacks `create` (or `update` on an edit
  form). Until now nothing on the form said why, and a wizard's Next stayed
  enabled.
  
  - Every form layout that draws the lock (the default form, `drawer`, `modal`,
    `tabbed`, `split` and `wizard`) renders one notice above the fields, such as
    "You don't have permission to create Project records. The fields are
    read-only." It names the object by its label, translated when the app's
    locale bundle translates it, and names `create` on a create form or `edit` on
    an edit form. It is announced as a status (`role="status"`).
  - The notice reads the same verdict the lock does, so it appears exactly when
    every field is locked for that reason. A field locked on its own (one the
    user may read but not edit, or one declared `readonly`) shows no notice.
  - A wizard does not walk a user who cannot submit through its steps: while the
    lock holds, Next and the final submit button are disabled, and the step
    indicator does not jump forward even with `allowSkip`. Cancel and Back stay
    usable, and every step is still shown. A user whose affordance is open sees
    no change.
  - Two keys are new in the `form` namespace of all ten packs:
    `noPermissionToCreate` and `noPermissionToEdit`, each with an `{{object}}`
    placeholder.
  
  The lock itself is unchanged, and so is the Save button of the non-wizard
  layouts.
- 51c2949: The form family's own feedback chrome now reads the locale packs (objectui#11039). The default success toast, the thank-you heading, the loading line, the load-failure heading and the default submit and cancel labels were English literals, so a zh session saw `Created`, `Thanks!`, `Loading form...` and `Error loading form` beside a Chinese UI. They now resolve through the i18n catalogue, the way `WizardForm`'s footer has since objectui#10999.
  
  **What moved.**
  
  - `@object-ui/plugin-form`, across the presentations `object-form` routes to:
    - The success toast when no `successMessage` is authored: `form.created` after a create, `form.saved` after an edit (the default arm and `WizardForm`), and `MasterDetailForm`'s built-in save toast, whose "… saved" after an authored `title` is `form.savedNamed`.
    - The note that rides that toast when a declared `navigateOnSuccess` was refused: `form.navigateRefused`. The submitter reads it, as the toast's description.
    - The thank-you heading when a `thank-you` submit behaviour declares no `title` (the default arm and `WizardForm`): `publicForm.thankYouTitle`.
    - The loading line of the default arm, `TabbedForm`, `SplitForm`, `WizardForm` and `DrawerForm`: `publicForm.loading`.
    - The heading of the load-failure panel in those five and `ModalForm`: `form.errorLoading`.
    - The default submit label, `form.create` or `form.update`, in the default arm, `TabbedForm`, `SplitForm`, `DrawerForm` and `ModalForm`; the default Cancel of `DrawerForm` and `ModalForm`, `common.cancel`; and `MasterDetailForm`'s default Save, Create and Cancel, `common.save`, `form.create` and `common.cancel`.
  - `@object-ui/console`: the form page (`/f/:slug` and `/forms/:name`) reads its loading line from `common.loading`, its success toast from `form.submitted`, and its default thank-you heading and message from `publicForm.thankYouTitle` and `publicForm.thankYouMessage`, through the `I18nProvider` that `main.tsx` mounts above every console route.
  - `@object-ui/i18n`: six keys are new under `form.` in all ten packs: `created`, `saved`, `savedNamed` (`{{title}}`), `submitted`, `errorLoading` and `navigateRefused`. The three `publicForm.` keys were already in all ten packs with nothing reading them (`pnpm check:i18n-dead-keys` listed them as confirmed dead), and say the same thing. The zh value of `publicForm.thankYouTitle` ends with a full-width exclamation mark instead of an ASCII one.
  
  **Authored values still win.** An authored `successMessage`, `submitText` or `cancelText`, a plain string or a per-locale map, and a `thank-you` behaviour's own `title` and `message`, render as authored in every locale. Only the defaults are localized. No schema key is added, renamed or retyped.
  
  **Three English strings change their rendered text**, because each is now the value of a key whose English differs from the old literal:
  
  - the loading line, `Loading form...` with three ASCII full stops, is now `Loading form…` with the typographic ellipsis;
  - the thank-you heading, `Thanks!`, is now `Thank you!`, in the default arm, `WizardForm` and the form page;
  - the form page's default thank-you message, `Your submission has been received.`, is now `Your submission has been received successfully.`
  
  Every other English default renders the same text as before. With no i18n provider mounted, plugin-form's forms still render English from their defaults tables, which `pnpm check:i18n-keys` holds byte-identical to the `en` pack.
- 559a2e2: fix(plugin-form): `object-form`'s `modalCloseButton: false` hides the modal's close button
  
  An author can now hide the close (X) button of a modal form. `modalCloseButton`
  was declared on `ObjectFormSchema` and on the `object-form` registration, and
  `ObjectForm`'s modal route forwarded it, but `ModalForm` never read it: `false`
  still drew the X, with no effect and no error. `ModalForm` now honours it on both
  of its dialog arms (the flat form and the `subforms` master-detail form). Only an
  explicit `false` hides the button; unset and `true` keep it. With the X hidden the
  modal still closes on Escape, and on the Cancel action when that is shown.
  
  `@object-ui/components`: `MobileDialogContent` gains an optional `showCloseButton`
  prop, default `true`, named after upstream Shadcn's `DialogContent` prop of the
  same purpose. `false` leaves the close button out of the DOM. Existing callers are
  unchanged. The component's exported props type gains this one optional member,
  which is why this package takes a minor bump.
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
- 54997ff: fix(console,plugin-form,i18n): the public form page and the master-detail form chrome speak the user's language
  
  objectui#11039 moved the form family's feedback chrome onto the locale packs and
  left two halves behind, both still English inside a Chinese UI.
  
  The console form page (`/f/:slug`, `/forms/:name`) rendered its action chrome from
  literals: the submit button's `Submit`, its in-flight `Submitting…` and
  `Uploading…`, the `Redirecting…` line of a pending redirect, and the frame of the
  `Required: …` refusal. They now read `publicForm.submit`, `publicForm.submitting`,
  `fields.file.uploading` (the key every other form's in-flight Save label already
  reads), and two new keys, `publicForm.redirectPending` and
  `publicForm.requiredFields`. The refusal is one key with a `{{fields}}` hole and
  its labels are joined with the pack's own list separator, so the colon, its
  spacing and the word order belong to the locale.
  
  `plugin-form` had the same literals in the master-detail form: `Loading columns…`,
  the `Subtotal` / `Tax (N%)` / `Total` stack, the row editor's `Line item — row N`
  title with its `Apply` and `Close`, the in-form collection's `Add`, and the Save
  button's `Saving…`; in `ModalForm`, the sr-only description of a master-detail
  dialog; and in `ObjectForm`, the hint under a field the caller may read but not
  write. They now read the pack (new keys under `form.masterDetail` and
  `form.deniedDescription`, plus the existing `detail.add`, `detail.saving` and
  `common.close`), in all ten packs.
  
  Only defaults move. An authored value still wins everywhere it did: a collection
  `title` and `addLabel`, a dialog `description`, a field `description`, an authored
  field label inside the refusal. English output is byte-identical to the literals.
- 3fa1938: The `object-master-detail-form` registration's `fields` description no longer calls that key "the submitted set" (objectui#11114).
  
  The sentence told an author, or an AI authoring metadata, that the parent field pool bounds what Save writes. It does not, and it was never meant to: `fields` bounds what the parent form DRAWS and edits, and on a create the parent leg of the atomic batch is the drawn fields plus any parent value seeded through `initialValues` (or its alternate spelling `initialData`), drawn or not. The description now says exactly that, and adds that a seed for an undeclared, server-owned, computed or read-only field is still stripped, as on any save.
  
  Text only. The description is a declared input of a public-tier block, so it reaches the published `sdui.manifest.json`; no input, type, default or accepted value moves, and no runtime behaviour changes. The parent leg is deliberately not filtered to `fields`: that would silently drop author-seeded values, which is how a hidden parent key reaches a record.
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
- 1923d35: fix(plugin-form): the master-detail form's Subtotal / Tax / Total show the amount's currency, not a hard-coded yen sign (objectui#11132)
  
  The document totals stack under a master-detail form's line items printed a
  literal `¥` in front of every amount, whatever the amount field's currency or the
  tenant's. A USD tenant's invoice read `¥1,234.50` under lines in dollars.
  
  The stack now resolves its currency through `resolveFieldCurrency`, the one
  precedence every currency face shares: the amount field's fixed currency
  (`currencyConfig` with `currencyMode: 'fixed'`), else the tenant's default
  currency. The field definition is the one the form already loads from the child
  object to derive or hydrate its columns. The amount is `Intl`'s currency format in
  the display locale, so:
  
  - the sign sits where the locale puts it: `$1,234.50` in English, `1.234,50 $` in
    German;
  - the decimal places are the currency's own: two for USD and EUR, none for JPY
    (a JPY tenant's stack read `¥1,234.50` and now reads `¥1,235`), three for KWD;
  - the digits still follow the display locale, as objectui#9909 made them.
  
  With no currency known, or when the stack adds entries whose amounts resolve to
  different currencies, the lines are plain numbers at two places with no sign.
  
  A fully configured detail entry (relationship field and every column typed) loads
  no child schema, so its amount field's own currency is not read and the stack
  shows the tenant's currency for it.
- 263dcd7: fix(plugin-form): a master-detail child with authored inline columns derives its sort field and amount field, so line order persists and the total shows (objectui#11144)
  
  A master-detail child whose relationship field declares `inlineColumns` lost two
  things in the parent's form. A line created or dragged into a new order carried no
  `position`, so the order was gone after save. And unless the relationship also
  declared `inlineAmountField`, no running total rendered: neither the grid's own
  total nor the Subtotal / Tax / Total stack.
  
  Such a detail reaches the form with a relationship field and an authored column
  set, and that path only filled in the column types from the child object. The sort
  field (a `position`-, `sort_order`- or similarly named field on the child) and the
  amount field were picked only for details without authored columns, and nothing
  else supplies them: the spec has no inline sort-field key.
  
  A detail with authored columns now takes both from the same derivation as every
  other detail, while keeping its own columns, order and labels. The amount field is
  picked from the authored columns by the rule a derived grid already uses. An
  authored `inlineAmountField` (or a detail's own `amountField` / `sortField`) still
  wins over the derived one.
  
  **Note, 2026-10-01 (objectui#11070 round 9, shipping in this same release).**
  A detail's own `sortField` no longer wins, because it is no longer read:
  objectui#11070 round 9 retired that member of `MasterDetailDetailConfig`. The
  derived sort field is the only one. An authored `inlineAmountField` (or a
  detail's own `amountField`) still wins over the derived amount field.
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
- dbd1081: The top-level `fields` input descriptions of `object-form`, `view:form`,
  `embeddable-form` and `object-master-detail-form`, and the `console.warn` a
  top-level `fields` member that resolves to no field name draws, no longer say
  that a `{ name }` object member "is tolerated" (objectui#11550). Each still says
  that the members are bare field names, and the warning still names the right
  spelling: a bare field-name string, or an entry in `sections[].fields`.
  
  Write top-level `fields` members as bare field-name strings, for example
  `"fields": ["name", "email"]`. A per-field override (`colSpan`, a label) goes on
  a `sections[].fields` entry instead.
  
  Behaviour is unchanged. A `{ name }` member already stored in a form view still
  reads at render, and the member that resolves to no name is still skipped with
  the same warning; only the wording that taught `{ name }` as an authoring
  spelling is gone.
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
- 17ccec9: `object-master-detail-form` declines to fetch a detail collection whose child object it never resolved, instead of calling `getObjectSchema(undefined)`.
  
  `childObject` is REQUIRED on `MasterDetailDetailConfig` and is what every downstream read is keyed
  on — `deriveDetail(d.childObject, …)`, the child-schema cache, and the FK scope of each child
  fetch. But a detail entry reaches the renderer straight off an authored schema, so a malformed one
  arrives with the key `undefined`, and the resolve effect asked the data layer for it anyway.
  Measured: mounting the block with a detail entry that carries no `childObject` issued
  `getObjectSchema(undefined)` — a real backend receives a query for an object literally named
  `undefined`, and whatever it returns becomes the console's problem.
  
  The resolve effect now skips such an entry and warns, leaving it in place so the grid card shows
  its config hint and the row-state array stays index-matched. This is the choice `RelatedList`
  already makes for the same class of missing key (*"has no referenceField/parentId — refusing to
  fetch all rows"*), and the sibling child-schema-cache effect in this same component already spelled
  it `.filter(Boolean)`; the three now agree. A detail collection that names its child object fetches
  exactly as before.
- c9a7252: `record:line_items` declines to fetch the child schema of a panel whose child object it never resolved, instead of calling `getObjectSchema(undefined)`.
  
  `childObject` is declared `required: true` on the block's registry entry and typed `string` on
  `LineItemsPanelSchema`, but nothing enforces either — `inputs[].required` is designer metadata, and
  the block has no spec schema — so a node reaches the renderer straight off an authored schema with
  the key `undefined`, and the child-schema effect asked the data layer for it anyway. Measured:
  mounting the block through the registry with `childObject` unset issued
  `getObjectSchema(undefined)`, and a real backend receives a query for an object literally named
  `undefined`. The effect's `.catch` then turned the answer into a null child schema, so the visible
  outcome was a silently unsanitized child grid rather than an error.
  
  The effect now declines and warns, naming the key and what to set it to, and clears the cached child
  schema so a later save is never sanitized against a previous object's fields. This is the choice
  `RelatedList` already makes for the same class of missing key (*"has no referenceField/parentId —
  refusing to fetch all rows"*), and the one `object-master-detail-form` makes on this exact key. A
  panel that names its child object fetches exactly as before.
- 5f19b92: `record:line_items` declines to LOAD OR WRITE the rows of a panel whose child object it never resolved, instead of calling `find(undefined, …)` — the sibling site of the child-schema decline, in the same component.
  
  `LineItemsPanel` read `schema.childObject` at two sites. The first now declines; the row load still
  asked the data layer to `find` an object literally named `undefined`, scoped by
  `{ [relationshipField]: parentId }`. `load` guarded the *data source* and the *parent id* — the two
  things `RelatedList` calls "can I scope this query" — but not the *object being queried*.
  
  Declining that fetch is not enough on its own, and this is the part worth reading: `load` owns
  `loading`, and the panel branched `loading ? "Loading…" : !parentId ? "Save the record first…" :
  <grid>`. So the moment the fetch declined, an unresolvable panel with a parent id bound fell to the
  third branch and showed an **empty editable grid with an Add button, over an object that does not
  exist** — a worse outcome than the fetch it replaced. Measured on the pre-fix component: one
  keystroke in the grid's always-present ghost row materialised a row, which enabled Save, which
  reached `batchTransaction([{ object: undefined, action: 'create', data: { qty: 3, invoice: 'inv-1' } }])`.
  The bad *read* was one keystroke away from a bad *write*.
  
  An unresolvable panel therefore gets its own render branch — a config hint naming `childObject` and
  what to set it to, following the precedent `object-master-detail-form` set for this exact key and
  `AdvancedChartImpl`'s refusal placeholders. It is checked ahead of `loading`, because nothing is
  pending: the schema itself already says the panel can never resolve, so there is no honest moment at
  which "Loading…" is true. `save` takes the same one-line guard, for the one route the render branch
  cannot close — a schema edited to drop `childObject` while rows are already dirty.
  
  A panel that names its child object loads, renders and saves exactly as before.
- e0b289d: An authored section `visibleWhen` on `formType: 'tabbed'` or `formType: 'wizard'` now
  **reports** that the layout cannot honour it, instead of being silently dropped
  (objectui#6237).
  
  `ObjectForm` rebuilds each section key by key when it delegates to a layout, so a key
  the map does not copy never reaches a renderer at all. Three of those maps copy
  `visibleWhen` (`split` / `drawer` / `modal`, objectui#6111) and the flat arm carries it
  on the `section-divider` pseudo-field — but the `tabbed` and `wizard` maps copy nothing,
  so an author writing the key on those two arms watched it do exactly nothing, with no
  signal anywhere. That silence is the defect this ships against.
  
  The two arms now log a warning naming the layout and the sections whose predicate is
  being dropped, through one shared message builder so they cannot drift apart.
  
  **This changes no rendering behaviour** — the predicate is still not evaluated on those
  arms. It is the interim half of a maintainer ruling (2026-08-29) that the real repair is
  a **design** task: one renderer-side section/group contract with a predicate slot,
  designed once for every layout arm (tabbed / TabbedForm / WizardForm / flat) rather than
  patched arm by arm. The ruling requires the diagnostic to land first, so the gap stops
  being invisible while that contract is designed.
  
  Deliberately silent on the arms that work, so the warning stays worth reading:
  
  - `split` / `drawer` / `modal`, and the flat layout — all honour a section `visibleWhen`.
  - `ModalForm` with `contentLayout: 'tabbed'` — honours it through the real
    `FormFieldTab.visibleWhen` slot that landed in objectui#6619. "Tabbed" names two
    different things on this card; only `formType: 'tabbed'` (`TabbedForm`) is inert.
  - A master-detail parent, which re-enters `ObjectForm` through its own parent schema —
    the report is left to that inner pass, where the real layout is decided (a
    master-detail `wizard` parent renders `simple`, which honours the key). Reporting at
    both would double-report the tabbed parent and false-report the wizard one.
  
  No authorable key is added anywhere: declaring `visibleWhen` on a type whose renderer
  ignores it is the defect this card family exists to close, and the shared
  `FormSectionConfig` that `WizardForm` uses for its steps makes that trap concrete.
- 3b9c774: Split `WizardStepConfig` off `FormSectionConfig`, and correct the section-predicate
  support table (objectui#6237, maintainer ruling 2026-08-30).
  
  `WizardForm` typed its steps as `Omit<FormSectionConfig, 'visibleWhen'>` — a
  subtraction from the TabbedForm section type, which is the predicate-CARRYING
  type. That defended the one key it named and left the mechanism open: every key
  added to `FormSectionConfig` reached a wizard step by default, so the next
  predicate in the same family (`readonlyWhen` / `requiredWhen`, already this
  package's field-level vocabulary) would have handed the wizard a silent slot its
  renderer does not read — the declared-but-unenforced shape the ruling split the
  types to stop.
  
  `WizardStepConfig` is now declared independently in `WizardForm.tsx`, which is
  simply what `SplitFormSectionConfig`, `ModalFormSectionConfig` and
  `DrawerFormSectionConfig` already do: each layout owns its group shape, documents
  `className` / `gridClassName` in its own terms, and declares `visibleWhen` only
  where its renderer honours it. The derivation flips from subtractive to additive
  — a key is authorable on a wizard step only if someone writes it there.
  
  No behaviour change and no key added or removed: `WizardStepConfig` exports the
  same key set it already had, and `visibleWhen` on a wizard step literal was, and
  remains, a compile error. What is new is that it stays one for the whole
  predicate family, pinned by a type-level assertion that fails the build if any
  `*When` key ever appears on the step type.
  
  Documentation repair in the same stroke: the support table in the README and in
  `content/docs/plugins/plugin-form.mdx` still said `formType: 'tabbed'` sections
  drop the predicate. That stopped being true when the tabbed arm landed — the row
  now reads **Yes**, the surrounding prose no longer claims two inert arms or a
  diagnostic that fires for `tabbed`, and the wizard row stays **No**, which is
  still exactly true.
- 1c19722: `object-master-detail-form` now renders a config hint naming `childObject` for a detail
  collection whose child object never resolved, instead of `Loading columns…` forever
  (objectui#6360).
  
  `MasterDetailForm` already declines to fetch the schema of such a detail (objectui#5940)
  and returns the entry unresolved, which is correct — asking the data layer for an object
  literally named `undefined` is what that guard removed. But the decline is precisely the
  guarantee that the entry's columns can never arrive, and the render branch it fell into
  read `!d.columns?.length ? <p>Loading columns…</p>`. The author was shown a
  spinner-shaped message that was permanently, unfixably wrong, and that never named the
  key they had to set.
  
  The `!d.childObject` case now takes its own branch, checked **before** the columns arm
  because nothing is pending — there is no first paint where "loading" is honest. The copy
  and structure are `LineItemsPanel`'s, which took the same branch for the same key in
  objectui#6194 / PR #6359; the two components had been disagreeing about what an author
  sees for the identical authoring mistake, and the weaker of the two was the one that read
  as the precedent. The hint carries its own `data-testid` (`md-detail-no-child-object`).
  
  Two source comments — at the decline itself and at the resolver's `catch` — asserted that
  "the grid card shows a config hint". They were false, and following them cost a reader a
  run of the component. The first is now true and says so. The second is **corrected rather
  than made true**: a detail whose schema fetch *threw* does name a child object, so it
  skips the new branch and still lands on `Loading columns…`. Distinguishing that from
  "still in flight" needs per-entry error state the resolver does not keep, so it is filed
  as objectui#6372 and the comment now points at it instead of promising a hint that is not
  rendered there.
  
  No spec or schema change: `childObject` is already REQUIRED on `MasterDetailDetailConfig`.
  This is renderer-side reporting of an authoring error that the type system cannot catch,
  because a detail entry reaches this renderer straight off an authored JSON schema.
- faa863d: `MasterDetailForm` gives every detail collection a per-entry record carrying its own
  identity and its own resolution status, closing two defects that both came from the same
  absence (objectui#6372, objectui#6371).
  
  `resolvedDetails` was a plain `MasterDetailDetailConfig[]` with no per-entry metadata, so
  both *what happened to this entry* and *which entry is this* were inferred from the
  entry's position in the array. One record answers both, which is why they land together —
  either one alone would have reshaped this structure and the second would then have
  rewritten the first.
  
  **objectui#6372 — a detail whose schema fetch threw sat on "Loading columns…" forever.**
  The resolver's `catch` returned the entry unchanged, and an entry with no `columns` is how
  *still in flight* is represented too, so the two states were indistinguishable and the
  render branch showed the same spinner-shaped message for both. For the failed one it never
  ended: the fetch is not retried, so nothing could ever replace it. Entries now carry a
  resolution status, and a failed one renders a refusal placeholder naming the child object
  whose schema could not be loaded (shaped on `AdvancedChartImpl`'s refusal placeholders —
  `role="status"`, because a refusal is a state, not an alert). Measured before the fix
  rather than read from source: a detail whose `getObjectSchema` rejects rendered
  `<p>Loading columns…</p>`.
  
  The thrown error is no longer discarded. The bare `catch` threw away the whole diagnosis,
  so whoever debugged this had neither a message nor a stack; the decline arm next to it has
  warned since objectui#5940, and this arm now matches it and passes the error object
  through.
  
  ⭐ The fetch and the derive are caught **separately**, because they are different failures
  with different truths to tell. A schema that loads fine and then yields no relationship
  field is a configuration error, and calling it a load failure would be false. That arm's
  render is deliberately unchanged; only its error stops being swallowed.
  
  **objectui#6371 — a declined entry had no identity across a reorder.** There was no
  duplicate-key collision: the map index is unique among siblings by construction, so two
  declined details keyed as `undefined-0` and `undefined-1`, distinct. The real defect is
  that for a declined entry the data half of that key is `undefined`, leaving position as
  the entry's whole identity — and the row-state store was addressed the same way, seeded
  once at mount and never re-synced when the authored config changed. Reordering or removing
  an entry therefore handed a collection a different collection's rows.
  
  Entries now carry an id synthesized once from the incoming config: the child object for a
  named collection, and the authored position for a declined one, which has no other
  identity to offer. Row state is keyed by that id, so a collection can only ever read its
  own slot. Three reads were affected, not the one the report named:
  
  - the grid value, which showed the wrong collection's rows;
  - the document **subtotal** reducer, so a reorder did not merely mis-associate a grid, it
    mis-computed the total;
  - the batch payload on save, which read
    `details.filter(d => d.relationshipField).map((d, i) => state[i])` — after the filter `i`
    indexed the filtered array while the row state was indexed against the full one, so a
    declined entry above a real collection shifted every read below it by one and that
    collection's rows were **silently dropped from the transaction**. Data loss on save, not
    a display defect.
- fd814d6: `MasterDetailForm` shows a config hint naming `relationshipField` for a detail collection
  whose child schema **loaded fine but could not be derived from**, instead of a permanent
  `Loading columns…` (objectui#6394).
  
  This is the third and last arm of the same resolver to be closed. `deriveDetail` throws
  when no lookup/`master_detail` field on the child object references the parent — a
  configuration error whose remedy is a key the author writes. The `catch` returned the
  entry unresolved, so it fell through to `!d.columns?.length ? <p>Loading columns…</p>`,
  and that message never ended: the derive is not retried, so those columns could never
  arrive. Same unbounded-wait-shown-as-a-spinner family as objectui#5940 / objectui#6188 /
  objectui#6194 / objectui#6360 / objectui#6372.
  
  The entry now carries `status: 'underivable'`, and the renderer gives it a branch of its
  own that names both ends of the relationship it could not find and the key to set:
  
  > Could not work out how `po_line` links to `purchase_order`: no lookup or master_detail
  > field on it references the parent. Set `relationshipField` on this collection to the
  > field that holds the parent record.
  
  ⛔ Deliberately **not** objectui#6372's refusal placeholder, which states the schema could
  not be loaded — false for a schema that loaded fine. The two failures keep separate copy
  because they have different remedies: one is "check the object exists and reload", this one
  is "set this key". The thrown error is still logged with its stack (objectui#6372), since
  the placeholder shows the author the key rather than the raw message.
  
  Behaviour is unchanged for the other two arms and for a detail that is genuinely still
  fetching — that one keeps `Loading columns…`, where the message is true.
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
- ecd9cb2: Wizard view v1, the objectui half (Card R, objectui#6985) — alignment + pins for the
  ruled `type: 'wizard'` tightening (objectstack#13622 D1–D8, maintainer ruling
  2026-08-31; spec half PR objectstack#13733).
  
  The renderer was already aligned: `WizardStepConfig` carries no predicate/collapse
  keys (objectui#6237's ruled split), the wizard route drops-and-reports an authored
  step `visibleWhen`, and `allowSkip` has been navigation-freedom-not-validation-
  exemption since #2959. This card lands the residue:
  
  - **metadata-admin view create seeds one starter step for a wizard** (app-shell
    `anchors.ts`): the create body used to emit `sections: []` for every form type,
    which for `type: 'wizard'` is exactly the shape the tightened spec refuses at
    parse (D7 — a stepless wizard silently rendered as a plain simple form). Same
    seed-the-required-shape move the flow anchor makes for its `type` enum
    (objectui#2326). Other form types keep the bare `[]` — only the wizard variant
    refuses emptiness.
  - **`@object-ui/types` TSDoc states the ruled wizard boundary** where the shared
    section/form types restate the form-view family: `ObjectFormSection.visibleWhen`
    / `collapsible` / `collapsed` name the wizard drop + spec-door refusal;
    `ObjectFormSchema.sections` states sections-ARE-steps and array-order-is-step-
    order; `allowSkip` states the D4 semantics. Type SHAPES are unchanged — the
    spec's own ruled mechanism is a parse-time refinement over the single shared
    section schema (D2 option A), which these types mirror at the type level.
  - **Consumer-side behaviour pins** (`wizardRuledSemantics-6985.test.tsx`): the
    wizard-inert step keys are dropped, never honoured (a denying `visibleWhen`
    does not remove a step; `collapsible`/`collapsed: true` produce no collapse
    affordance, with a positive control on the affordance probe); the empty-steps
    wizard's measured degradation to a simple form is pinned as the shape the spec
    door now refuses (one-step wizards stay legal — no arity floor); array order
    is step order (with a reversed-array control).
  - **Installed-spec door pins** (`wizardSpecDoor-6985.test.ts`), gated on a
    capability probe of the installed `FormViewSchema` rather than a version
    string: the post-Card-S half (refusal messages, prescriptions, the authored-
    `false` collapse boundary, the wizard-scoped control) activates by itself on
    the lockfile bump that brings the tightening in; until then the pre-tightening
    half records the 17.2.x accept-set it measured. `steps:` is pinned refused on
    every spec line.
  
  No teaching material — the objectstack#13337 / objectstack#13267 fence lifts only after both halves land;
  docs changes here are TSDoc/comments only.
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
- 7dedec6: A master-detail form no longer ends on a screen asserting both a failure and a success
  (objectui#7345).
  
  `MasterDetailForm` raised its two save outcomes — `handleSaved`'s confirmation and
  `handleError`'s refusal — under sonner's auto-generated ids, so nothing held a handle on
  the previous attempt's toast. A save the server refused left its error toast on screen,
  and when the user corrected the input and saved again inside that toast's lifetime the
  confirmation landed *beside* the refusal, exactly the objectui#7252 defect on a renderer
  that fix did not touch.
  
  Both outcomes now travel under one stable per-form id (`React.useId()`-scoped, the same
  spelling the form renderer and the console's `FormPage` publish under), and each save
  attempt retires the previous attempt's toast before it starts:
  
  - with no host `onSuccess` (SDUI / embedded hosts), the confirmation supersedes the
    refusal instead of stacking beside it;
  - with a host `onSuccess` (the console), where the built-in confirmation is deliberately
    skipped, the dismissal is what retires the refusal — otherwise it stood over a save
    that had succeeded.
  
  Toast durations are unchanged: this is about supersession, not lifetime.
- 0809f8a: Fix a refused master-detail save showing the same refusal twice (objectui#7354).
  
  `MasterDetailForm`'s `handleError` toasted the write's error message under its own
  sonner id, and the parent `<ObjectForm>` then re-threw the same error, which surfaced
  in the form renderer's own catch (`packages/components/.../renderers/form/form.tsx`)
  and toasted it AGAIN under a different, independently-generated `form-outcome:<id>`.
  Two raisers reported one refusal.
  
  `handleError` now only releases the save guard and forwards the error to the host's
  own `onError` (if supplied) for bookkeeping — it no longer toasts. Display is left to
  the form renderer's catch, which every `submitHandler` host already shares and which
  already extracts a better message (permission-aware, honours the author-marked
  `userMessage`) than the raw `err.message` this callback showed.
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
- 8fda009: `object-form`'s top-level `fields` (and its `form` / `view:form` alias and
  `object-master-detail-form`'s parent `fields`) now emit a named
  `console.warn` when a member resolves to no field name, instead of silently
  dropping it (objectui#8738 route 1, ruled after route 2 landed in a prior
  release).
  
  Top-level `fields` reads only bare field-name strings (`{ name }` tolerated)
  — a different vocabulary from `sections[].fields`, which also accepts the
  spec `FormFieldSchema` object (identity key `field`, e.g.
  `{ field: 'note', colSpan: 2 }`). Moving one of those objects into a
  top-level `fields` array resolves to no name and used to vanish without a
  word; it is now reported once per distinct offender via `console.warn`,
  naming the skipped shape and the vocabulary difference, modelled on
  `sectionFields.ts`'s existing `warnOnMixedVocabulary`.
  
  The render outcome is unchanged — the member is still dropped, not resolved;
  this is a diagnostic-only addition, not a lenient fallback. `form` /
  `view:form` (the same `ObjectFormRenderer`) and `object-master-detail-form`'s
  parent `fields` (routed through the same `SimpleObjectForm` read path via
  `ObjectForm`) inherit the warning for free; both registrations' `description`
  now also document the vocabulary (objectui#8847).
- fd9bf26: `object-form`'s top-level `fields` input now documents its member vocabulary
  (objectui#8738, route 2 of 2 — route 1, a diagnostic `console.warn`, was a
  separate ruling still pending when this was written; it landed 92 minutes
  later, see the dated note below).
  
  The registration declared `{ name: 'fields', type: 'array' }` with no
  description, so an author had nowhere to read that this key's members are
  **bare field names** — a different vocabulary from `sections[].fields`, which
  also accepts the spec `FormFieldSchema` object (identity key `field`, e.g.
  `{ field: 'note', colSpan: 2 }`). Moving one of those objects to the top-level
  `fields` resolves to no name and is skipped by `SimpleObjectForm`
  (`ObjectForm.tsx`) and by `buildFlatFields` (`flatFields.ts`, shared by the
  drawer/modal presentations). Behaviour is unchanged by this entry; it only adds
  the description text an author would need to avoid the drop before writing it.
  
  ⚠️ Dated correction, so the original reading is not taken for the behaviour of
  the release this publishes into. As written — `fd9bf26df0`, 2026-09-09T14:28:48Z
  — that drop was SILENT: no throw, no warning, no empty-state. That reading was
  true for 92 minutes. `8fda009057` (objectui#8859, route 1 of the same card) put
  a de-duplicated `console.warn` at both named read sites at 2026-09-09T16:00:31Z,
  so the drop is no longer silent. What did NOT change: the member is still
  skipped, and there is still no throw and no empty-state.
- 60e1f80: `embeddable-form`'s top-level `fields` input now documents its member
  vocabulary (objectui#8847, the last of the registrations #8738 opened — the
  same trap already documented on `object-form`, `form` / `view:form`, and
  `object-master-detail-form`'s parent `fields`).
  
  The registration declared `{ name: 'fields', type: 'array' }` with no
  description, so an author had nowhere to read that this key's members are
  **bare field names** — a different vocabulary from `sections[].fields`, which
  also accepts the spec `FormFieldSchema` object (identity key `field`, e.g.
  `{ field: 'note', colSpan: 2 }`). `EmbeddableForm` passes `config.fields`
  straight through to `<ObjectForm>` with no `sections`, so it renders through
  the same `SimpleObjectForm` read path as `object-form`; moving one of those
  objects into `embeddable-form`'s `fields` resolves to no name and is silently
  skipped. Behaviour is unchanged — this only adds the description text, and
  records (measured, not assumed) that this surface already inherits the
  `console.warn` route 1 (objectui#8738/#8859) added at that same read site.
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
- 6df9141: `ObjectForm`'s numeric `step` now follows `scale` (decimal places), not `precision`
  (total digit count) — objectui#9574.
  
  `@objectstack/spec` declares the two members apart: `precision` is "Total digits
  (non-negative integer)", `scale` is "Decimal places (non-negative integer)". The
  auto-generated form field derived its step from `precision`, so a `decimal(10, 0)`
  field — ten total digits, ZERO decimal places — was handed `step` `1e-10` instead of
  `1`, and a `decimal(10, 2)` got `1e-10` instead of `0.01`. `NumberField` states the
  same rule verbatim one layer down and already moved; this is the producer one layer up
  catching up with it.
  
  Two further consequences of the same expression:
  
  - **`scale: 0` is honoured.** The test is `typeof field.scale === 'number'`, not
    truthiness — a declared zero means "steps by 1", and the spec's own example of a
    `scale: 0` field is an ordinal integer.
  - **An undeclared `scale` now resolves to `step="any"`, not to no attribute at all.**
    An absent `step` is HTML's default of 1, which marks every decimal `:invalid` and
    blocks the submit — a granularity the author never declared. This matches
    `NumberField`'s tail for the same case.
  
  **Where the change is observable.** The registered `field:*` widgets do not read this
  key: their metadata carrier is the raw object-schema field, their DOM whitelist does
  not forward `step`, and each derives its own — measured by deleting the assignment
  outright and re-rendering, which left every `<input>` on that route byte-identical. The
  key IS read on the renderer's unregistered-widget fallback, where a field whose declared
  `widget` names a component the app never registered has its leftover props spread onto
  the `<input>`; there the producer's step is the granularity the browser enforces. Both
  routes are pinned side by side in `objectFormNumericStep-9574.test.tsx`.
  
  `percent` is covered by the same expression it was always covered by, and moves from
  `10^-precision` to `10^-scale`. What `scale` means for a percent field that stores a
  0–1 fraction — stored decimals, which is what the record validator enforces, or
  displayed percentage points, which is the landed display convention — is open at
  objectui#9810 and is not decided here.
- 99c4eb8: `object-form`: a section that declares `collapsed: true` is now collapsible — the
  disclosure control is installed whether or not `collapsible` is also written
  (objectui#9780, maintainer ruling 2026-09-18, letter A).
  
  The grouped layout read `collapsed` for the section's initial state
  unconditionally, but installed the toggle only for a section that also declared
  `collapsible`. The two are independent members and every declaration face accepts
  either alone, so `collapsed: true` written by itself — the most natural spelling of
  "collapsed by default" — rendered a permanently closed section: its fields were out
  of the DOM and nothing on the page could bring them back, with no error, warning or
  degradation.
  
  `collapsible: true` on its own is unchanged (open, toggle present), and
  `collapsible: false` together with `collapsed: true` resolves the same way the
  ruling states: collapsed wins and the toggle is present. A section declaring
  neither member is untouched. Nothing is refused that was accepted before — the
  accept set is unchanged and only behaviour widens, so no author can lose anything
  they could previously depend on.
- 19d1f24: fix(plugin-form): the drawer arm hands a section's `description` to the divider it already draws
  
  An `object-form` rendered as `formType: 'drawer'` dropped its sections'
  `description`, and it dropped it one layer LATER than the default layout did.
  `ObjectForm`'s drawer map copies the key onto `DrawerFormSectionConfig` — which
  has always declared it — and `DrawerForm`'s own `section-divider` pushes then
  rebuilt the row key by key without it. So the author wrote the key correctly,
  the first layer passed it correctly, and the last layer did not take it. The
  sibling member `label` arrived in the same call, so a titled section with a
  blurb rendered the title and silently ate the blurb.
  
  Both of that file's pushes dropped it and both are repaired: the
  explicit-sections one (the shape a form view authors) and the
  derived-fieldGroups one (the fallback the drawer takes when the object's own
  metadata declares `fieldGroups` and the host passes no sections). One key copied
  onto each push; nothing else in the renderer moved.
  
  ⛔ No gate was widened. The condition that decides whether a divider row is
  drawn at all also decides the ADR-0089 section predicate and the objectui#6236
  membership claim that gates the whole group, so it is a ruling about other keys.
  The derived push keeps its heading gate untouched, and a derived group with no
  heading still draws no divider and still drops its blurb. ⚠️ The
  explicit-sections push, by contrast, was ALREADY unconditional, so once the key
  is copied a drawer section carrying a `description` and no heading renders the
  blurb alone — where the default layout draws nothing for the same member. That
  is a consequence of copying the key, not of touching the gate, and it is pinned
  as a reading.
  
  The drawer arm's behaviour here was watched by nothing before this change. It
  now has its own pin, `drawerFormSectionDescription-9834`, covering both routes a
  host can take into `DrawerForm` — through the real `ObjectForm` with
  `formType: 'drawer'`, and mounted directly — plus the derived-fieldGroups push,
  an absence control and the ungated-push reading above.
  `objectFormSectionMembers-8071` carried a sentence about which arms render a
  blurb for a headingless member, which this change makes false; it is corrected
  in the same change, as is the member-pin ledger entry for `object-form.sections`
  in `registry-inputs-spec-parity`, whose prose describes the behaviour being
  repaired. No published behaviour of `@object-ui/console` changes.
- 8f37c4e: Render a headingless section's `description` in the default (grouped) form layout
  (objectui#9835, maintainer ruling 2026-09-18, letter B).
  
  A form section that authored a `description` and neither `name` nor `label` lost its
  blurb on the default layout — the one a section-carrying `object-form` gets when it
  declares no `formType`. That layout pushes its `section-divider` row only for a member
  that yields a heading, so a member with no heading had nothing to carry the blurb on.
  The `split`, `modal`, `wizard` and `tabbed` arms all rendered it, so one authored
  section rendered differently depending only on which arm the host chose.
  
  Such a member now gets a **blurb-only** row: it carries the `description` and nothing
  else. In particular it does **not** carry the ADR-0089 `visibleWhen` predicate, the
  objectui#6236 membership claim that gates the whole group, or the
  `collapsed` / `collapsible` pair. Widening the heading gate instead (the obvious
  one-line fix) was considered and refused: that same condition implements those three
  semantics, so widening it would let an untitled section's predicate hide its group and
  let an untitled `collapsed: true` remove its fields from the DOM with no control to
  bring them back — a decision about two other keys, taken while fixing a blurb.
  
  **What changes for authors.** A section with a `description` and no title now shows
  that text on every layout arm instead of four out of five. Nothing else moves: a titled
  section renders exactly as before, and an untitled section's `visibleWhen`, `collapsed`
  and `collapsible` keep doing exactly what they did (nothing) on this layout.
- 58d65c5: `object-form`: a drawer section that declares `collapsed: true` can be opened again. The
  drawer now resolves `collapsed` / `collapsible` the way the default layout does
  (objectui#9849 step one, which converges the collapse rules onto objectui#9780).
  
  The drawer's explicit `sections` path read `collapsed` for the section's initial state
  unconditionally, but installed the disclosure control only for a section that also wrote
  `collapsible`. So `formType: 'drawer'` with `collapsed: true` written alone (the most
  natural spelling of "collapsed by default") drew a permanently closed section. Its fields
  were out of the DOM and nothing on the page could bring them back. The default layout
  stopped doing this under objectui#9780. The drawer still did, and its derived-`fieldGroups`
  path spelled the same two keys a third way.
  
  All three paths now use one resolution:
  
  - `collapsed: true` implies `collapsible`, so the control is installed.
  - `collapsible: false` together with `collapsed: true` resolves in favour of `collapsed`,
    with the control present.
  - `collapsible: true` alone is unchanged: the section is open and has the control.
  - A section declaring neither member is untouched.
  - A section is collapsed only while its row is on the page to carry the control. A drawer
    section with no heading and no description therefore keeps its fields open instead of
    hiding them behind nothing.
  
  Nothing is refused that was accepted before. The accept set is unchanged. The sections
  that render differently are ones whose fields could not be reached, plus two edge cases:
  
  - A section that shares its key with a collapsible sibling is no longer hidden by that
    sibling's toggle.
  - A drawer section that was declared `collapsed` at mount, and whose declaration is later
    removed, now follows the declaration until the user toggles it. It used to stay closed.
- 509f8ed: The section-configuration → `section-divider` projection is one path, and a modal form
  built from an object's own `fieldGroups` metadata now renders each group's authored
  `description` (objectui#9849).
  
  Six pushes across `ObjectForm`, `ModalForm` and `DrawerForm` each rebuilt the divider row
  key by key. A key one of them forgot was invisible to the author, because its siblings on
  the same section arrived in the same call — the same failure carded three times running
  for one key (objectui#9779 default arm, objectui#9834 drawer arm, and this card's modal
  derived push, the last site still dropping it). A modal form that passes no `sections` and
  leans on the object's declared `fieldGroups` drew each group's heading and silently ate
  the blurb its author wrote.
  
  All six sites now go through one projection, so the key set is copied once: the blurb, the
  ADR-0089 `visibleWhen` predicate, the objectui#6236 membership claim, the collapse pair
  and the row's span. A key added there is added for every arm at once, and a key dropped
  there is dropped for every arm at once — which is what makes the loss visible instead of
  silent.
  
  **What changes for authors.** A `fieldGroups`-derived group renders its `description` in a
  modal form, as it already did in a drawer and on the default layout. Nothing else moves:
  every arm's gate, its collapse resolution and its predicate handling are unchanged, and
  each arm hands its own resolutions to the shared projection rather than inheriting
  another's.
- 76f1543: `object-master-detail-form`'s `fields` registration no longer claims to be
  "Ignored when `sections` is given", and a section member the top-level `fields`
  excludes is now reported instead of vanishing (objectui#9884).
  
  The declaration was the wrong half, ruled from the tree rather than from the
  principle. One `SimpleObjectForm` renders this block's parent form and
  `object-form` alike — `MasterDetailForm`'s `parentSchema` memo literally builds
  a `{ type: 'object-form', ... }` node and renders it through a directly
  imported `<ObjectForm>` — and the three sibling `fields` registrations
  (`object-form`, `form`, `embeddable-form`) all declare the key as the field
  selection with no such exemption, with `objectFormFieldsMembers-8071` pinning
  it as one. Honouring the exemption would have falsified three declarations to
  satisfy one, and it would have done so on a pool that is not only the layout:
  `fields` builds the parent field set that also feeds create defaults, the
  `initialValues` merge and the values a submit carries.
  
  So the rendered outcome is unchanged and the intersection stands: the parent
  field pool is built from `fields` first, and each section resolves its members
  against that pool. What changed is that the loss is audible.
  `warnSectionMemberExcludedByFields` (`sectionFields.ts`, beside the two
  warnings objectui#8738 and objectui#3090 added) names the section, the member
  and the two keys that collided, once per distinct pair, whenever a member the
  object really declares is dropped for the sole reason that `fields` omits it —
  including the expensive case where it was the section's last surviving member
  and the section disappears with its heading. A member the object never declares
  at all is deliberately NOT recruited into this warning: it resolves to nothing
  whether or not `fields` is authored, which is a different silence with a
  different remedy.
  
  The `object-master-detail-form.sections` member pin moves in the same change
  rather than after it: its sharp row keeps the two DOM assertions objectui#8071
  slice 15 wrote, and gains the warning legs plus a firing control and a leg
  keeping the warning off the other silence. Nothing in it was relaxed.
  
  The member-pin ledger moves with it. `apps/console`'s registry-inputs parity
  suite carried the old reading in two prose passages — the
  `object-master-detail-form.sections` entry quoting the retired sentence and
  recording the drop as having no diagnostic and the finding as not acted on, and
  the slice-15 narrative repeating the quote. Both now state the ruling. That file
  is a test and releases nothing: `@object-ui/console` ships no source from it, so
  this declaration covers `@object-ui/plugin-form` alone.
  
  Refs objectui#9884, objectui#8071.
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
- 9f7e846: Refuse a row cap the contract already refuses before it reaches `$top`, at the
  LAST read point in the repo that still forwarded one — `record:line_items`
  (objectui#9925).
  
  This panel spelled its row cap as a bare `schema.limit ?? DEFAULT_LINE_ITEMS_LIMIT`.
  `??` rejects only `null` and `undefined`, so a value the contract refuses was not
  nullish and survived as a real fetch window: it reached the adapter as `$top: 0`,
  the panel asked the server for nothing, and the empty line-items grid named no
  cause. A negative went out the same way, and a non-integer became a fractional
  window.
  
  The read now goes through one resolver, mirroring the shape objectui#9853 landed
  on `ObjectGrid`, objectui#9897 repeated on `ListView`, and objectui#9925 landed on
  `object-kanban`, `object-timeline` and `record:reference_rail` — one resolver at
  every entry is what keeps the answer single. A refused value is dropped, this
  panel's own default is used, and one `console.warn` names the block, the child
  object and the value. The warning is conditional and deduped: an absent `limit`
  and a usable one both stay silent, and one declaration warns once rather than
  once per render.
  
  This closes BOTH entrances into the panel, which is why the repair is at the read
  point. The panel reads one key, and two authoring shapes fill it: a `dataSource`
  binding lowers a named view's `pagination.pageSize` into `schema.limit`, and a
  panel with no binding at all carries the authored `limit` straight through. A
  repair at the lowering layer would close only the first.
  
  Refusing this is not a renderer choosing a meaning. `@objectstack/spec` declares
  the element data source `limit` a binding lowers into this key a positive integer
  (`z.number().int().positive().optional()`), and so is the `pagination.pageSize`
  of a named view that fills it.
  
  ⛔ No fallback literal changed: the panel keeps the `500` it already documented.
  ⛔ No shared helper was extracted — a shared home would be `@object-ui/core`,
  which is objectui#9928's package and out of this card's face.
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
- 425762e: `object-master-detail-form` declares `formType` as a closed vocabulary instead of a bare `string`.
  
  The block declared `formType` as `type: 'string'` while the sibling `object-form` declared the
  same key as an `enum`, and both funnel into the renderer that switches on those variant names. A
  value outside the vocabulary therefore matched no branch and fell through to the flat field list
  with no diagnostic — measured, a `formType` of `'wizzard'` renders the parent half with its
  authored sections silently gone.
  
  The declared set is `simple | tabbed`, measured against the master-detail composition rather than
  copied from the sibling's six: `drawer` and `modal` host the parent half in a portal dialog outside
  the master-detail container, so its single bottom Save bar has no form to submit; `wizard` mounts
  only the current step's fields and turns that Save bar into a `Next`; `split` renders inline but
  persists through `dataSource.create` instead of the atomic batch.
  
  Authoring-surface only. The manifest, the JSX-page compiler and the save gate now report an
  out-of-vocabulary value as `invalid-enum`; rejection at publish time remains `@objectstack/spec`'s.
- 584eeca: The record dialog now draws a `form.sections[].group` section (objectui#11542).
  
  A form view section can declare its members by pointing `group` at one of the
  object's `fieldGroups` (the reference form of objectstack#13855). `ObjectForm`
  resolved that form, but `ModalForm` did not, and the console's More actions ›
  Edit / New dialog and action-opened modals mount `ModalForm` directly with the
  form view's sections as authored. A `{ group }` section therefore reached the
  dialog with no fields and was dropped: a tabbed form view showed no tab for the
  group, a stacked one showed no header, and the fields only that group carries
  could not be edited in the dialog.
  
  `ModalForm` now resolves its sections through `resolveSectionGroupReferences`,
  the same resolver `ObjectForm` uses, against the object schema it already
  loads. The group's section is drawn with the group's label and members in both
  content layouts, its members pass the same field-level security gate as
  enumerated fields, and an unknown group renders nothing and is reported once,
  as it is on `ObjectForm`. A section list that uses no `group` reaches the
  dialog unchanged.
- 83ec618: `README.md`'s "Not a `FormField` key" table said a field-level `className` is
  "read on exactly one pseudo-field, `type: 'section-divider'`". That quantifier
  holds only for the renderer's *explicit* read — `className={fp.className}` on
  the `section-divider` branch of
  `packages/components/src/renderers/form/form.tsx`. The same renderer forwards
  every key it did not destructure, and `className` is not among the names taken
  off the field config, not among the ones `stripRendererOnlyProps` removes, and
  so rides `{...fieldProps}` into `renderFieldComponent`, whose built-in `input`
  branch spreads it onto `<Input>`. A field-level `className` therefore lands
  visibly on ordinary built-in controls, and a reader taking "exactly one"
  literally concludes the opposite of what the code does (objectui#5131).
  
  The cell now describes the contract rather than the reader count: an undeclared
  key still rides the props spread down to whichever component the field resolves
  to, nothing in the contract promises that, and a registered widget honours it
  only if it happens to spread its leftover props — the wording the docs site
  already ships, so the two sources agree again. The advice in the row is
  unchanged and was never wrong (`span` / `colSpan` for width,
  `FormSchema.fieldContainerClass` for the grid), and the explicit
  `section-divider` read is kept, now named as explicit.
  
  This is a documentation fix to a file `plugin-form` publishes to npm, which is
  why it carries a version: the npm landing page only picks up the correction on a
  release. No behaviour, export, type, or `dist` byte changes.
- 4d963a2: fix(plugin-form): `object-form`'s default layout hands a section's `description` to the divider it already draws
  
  An `object-form` that declares `sections` and no `formType` renders through
  `SimpleObjectForm`'s grouped branch, which rebuilds each section key by key into
  a virtual `section-divider` row. That rebuild copied `label`, the ADR-0089
  `visibleWhen`, the objectui#6236 membership claim and the collapse pair — and
  not `description`. The key was therefore dropped on the layout an author reaches
  by default, while `SectionDivider` (the very component the row renders as) has
  always drawn a blurb and the `tabbed` / `wizard` / `split` / `modal` rebuilds all
  copied one. Its sibling `label` on the same member arrived, so a titled section
  with a blurb rendered the title and silently ate the blurb.
  
  Measured on this branch, arm by arm, through the real renderer: `tabbed`,
  `wizard`, `split` and `modal` render it; the default layout and `drawer` did
  not. Only the default layout is changed here — the `drawer` miss is a separate
  defect and is handed back as a finding rather than fixed under this card.
  
  The boundary that did NOT move: the divider row exists only for a member that
  yields a heading (a `name` or a `label`), so a member carrying a `description`
  and neither of those still draws no divider and still drops its blurb. That gate
  also decides the section predicate and the membership claim, so widening it is a
  ruling about other keys, not this one.
  
  `objectFormSectionMembers-8071`'s sixth row pinned the drop as behaviour; it is
  rewritten onto the new behaviour in this same change, plus a row pinning the
  boundary above. `registry-inputs-spec-parity`'s member-pin ledger entry for
  `object-form.sections` described the old row in prose and is corrected with it —
  no published behaviour of `@object-ui/console` changes.
- 43ca9d5: `SimpleObjectForm`: consult a declared `submitHandler` before the inline-fields carve-out
  
  `ObjectFormSchema.submitHandler` is documented as handing the collected values to the host INSTEAD of calling `dataSource.create` / `dataSource.update`, so a form that declares it has a submit target with or without an adapter. `SimpleObjectForm.handleSubmit` nevertheless opened with the inline-fields carve-out (`hasInlineFields && !dataSource`), which returned before the persistence chain: a host that had declared it owns the write was never asked, and `onSuccess` confirmed a write that never happened (measured `onSuccess 1 / submitHandler 0`).
  
  The carve-out now fires only when no `submitHandler` is declared, and the "no submit target" refusal moved into the persistence chain after the seam — the shape the five variant renderers already use, reusing their shared refusal from `submitTarget.ts` rather than a private copy. A form with inline fields and no seam is unchanged: its `onSuccess` is still the write.
- bd09957: fix(form): a whole-row field now spans the whole row at **every** breakpoint tier, not only the widest
  
  The form's column count is resolved per tier by container queries
  (`grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3` is three column counts on one
  screen), but the renderer emitted a single col-span class for the widest tier
  that reached the target. A field authored `span: 'full'` — the spelling
  `@objectstack/spec` declares as «whole row at any column count» and tells
  authors to prefer — therefore took 1 of 2 cells at the middle tier, rendering
  pixel-identical to authoring nothing at all (measured in Chromium at 285px of
  a 586px grid). It now emits one class per multi-column tier, each clamped to
  that tier's column count: `@md:col-span-2 @2xl:col-span-3`.
  
  ⚠️ **Existing forms will look different at intermediate container widths** —
  that is the fix. A field that was silently narrow in a modal or drawer now
  occupies the full row there, as its metadata always asked. Narrowest and
  widest tiers are unchanged, and a `colSpan` smaller than the grid is
  unchanged. Layouts hand-tuned around the old behaviour should be re-checked at
  modal width.
- ba306e3: Honour the declared `submitHandler` seam in every form variant, not just the simple one.
  
  `ObjectFormSchema.submitHandler` is documented as the seam a host uses to own persistence: the form validates and hands the collected values over instead of calling `dataSource.create` / `dataSource.update`. `ObjectForm` forwarded the key into every variant it routes to, but only `SimpleObjectForm` read it — `TabbedForm`, `WizardForm`, `SplitForm`, `DrawerForm` and `ModalForm` persisted directly.
  
  **Behaviour change on a persistence path.** A master-detail parent half rendered `tabbed` (or `split`) now commits through the atomic `batchTransaction` together with its child collections, instead of writing the parent independently through `dataSource.create`. Previously the child leg was never attempted on those layouts: the parent was committed alone, the entered line items were silently discarded, no compensation ran, and a success toast confirmed the save. A failing child leg now leaves no committed parent, on every layout that renders the parent half inline.
  
  `WizardForm` additionally skips its own default success toast / redirect arms when a `submitHandler` is present, matching `ObjectForm`, so a host that owns the write also owns the outcome.
  
  The `object-master-detail-form.formType` vocabulary is unchanged and stays `simple | tabbed`.
- 26a2238: `navigateOnSuccess` now honours a mounted host, and says so when its destination is refused
  
  `ObjectForm` and `WizardForm` consume `navigateOnSuccess` through
  `resolveSuccessNavigate`, and both arms travelled to an accepted destination with a bare
  `window.location.assign`. A rooted path such as `/apps/x/o/record/{id}` assigned that way
  resolves against the ORIGIN root, so under a host mounted at a sub-path (the framework CLI
  configures one for every embedded deployment) an authored in-app destination left the
  application. Both arms now route an app-relative destination through the injected
  navigation seam both components already held for `submitBehavior.url`, so a mounted host's
  basename is applied. With no host seam the behaviour is byte-for-byte what it was — a host
  with no router has no basename, so origin-rooted resolution is already correct there. A
  same-origin ABSOLUTE destination also keeps browser-level navigation: the seam's declared
  input is an application-relative path, and an author who spelled out a whole address asked
  for that address.
  
  A declared `navigateOnSuccess` whose destination is refused — a mistyped value, or a written
  record carrying no usable id — used to produce a success toast identical to the one a form
  with no `navigateOnSuccess` produces, so the navigation failed with nobody told. That toast
  now carries a note that the declared navigation did not happen, and the template the author
  wrote is logged for them. The write genuinely succeeded, so this stays a success rather than
  becoming an error state.
  
  Which destinations are ACCEPTED is unchanged: the same-origin guard, the `{id}` /
  `{recordId}` dialect and the unescaped interpolation are the subject of an open contract
  question and are deliberately untouched here.
- 5d79faf: Variant forms refuse a submit that has nowhere to go, instead of reporting success
  
  `TabbedForm`, `WizardForm`, `SplitForm`, `DrawerForm` and `ModalForm` each opened
  `handleSubmit` with `if (!dataSource) { await schema.onSuccess?.(data); return data; }`
  — a success signal emitted without consulting a declared `submitHandler` and without
  persisting anything. Through `MasterDetailForm`, whose parent schema declares both
  `submitHandler: submitViaBatch` and `onSuccess: handleSaved`, that produced a success
  toast and, in create mode, a form reset clearing values nobody wrote.
  
  All five now answer the question the same way `SimpleObjectForm` and the `object-form`
  element gate already do. A form has a submit target when it has a `dataSource` or a
  declared `submitHandler`; with neither, the one legitimate shape is inline fields —
  a non-empty `customFields`, or `sections` whose fields are all inline runtime
  `FormField` objects — whose `onSuccess` is the write. Anything else throws
  `DataSource is required for form submission (inline mode not configured)`, which
  reaches `schema.onError` and is rethrown. A declared `submitHandler` is consulted
  first, so a host that owns the write is never bypassed for want of an adapter it
  never needed.
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

- 8c0d52e: A form's ruled `submitBehavior.url` redirect can now be performed by the HOST, so a destination stays inside a console mounted at a sub-path (objectui#4989 defect 4).
  
  `ObjectForm` and `WizardForm` accept a relative in-app path and used to travel to it with `window.location.assign`. A rooted path resolves against the ORIGIN there, so under a mounted host — `<BrowserRouter basename="/_console">`, which the framework CLI configures for every embedded deployment — an authored `/thanks` left the application. The destination was correct and the navigation was wrong, and a published renderer cannot fix that alone: only the host knows its mount.
  
  **New: `HostNavigationContext` (`@object-ui/react`).** A host offers its own navigate; a renderer uses it when it is there:
  
  ```tsx
  import { HostNavigationProvider } from '@object-ui/react';
  import { useNavigate } from 'react-router-dom';
  
  function Bridge({ children }) {
    const navigate = useNavigate();
    return (
      <HostNavigationProvider value={{ navigate: (to, o) => navigate(to, { replace: o?.replace ?? false }) }}>
        {children}
      </HostNavigationProvider>
    );
  }
  ```
  
  `@object-ui/app-shell`'s `ConsoleShell` now mounts that bridge above every console route, so the console's own routes, and its basename, are what a post-submit redirect resolves against — and the redirect becomes an SPA transition instead of a full page load.
  
  **Nothing changes for a host that wires nothing.** With no provider the behaviour is byte-for-byte what it was: one `window.location.assign` of the resolved path after the declared `delayMs`. A host with no router has no basename, so origin-rooted resolution is already right there — the seam changes what a MOUNTED host gets and nothing else. `useHostNavigation()` outside a provider answers `{ navigate: undefined }` and never throws.
  
  Two mechanisms were weighed and rejected by the ruling, recorded so they are not re-proposed. **Reading React Router's context when a router happens to be present** is implicit, and unavailable anyway: a React context is a module-instance object, so reading the host's means importing `react-router` into the renderer — which `@object-ui/plugin-form` declares in none of its dependency fields, whose published build externalises every bare specifier, and which two real consumers (`apps/site`, `packages/plugin-view`) do not install. **Requiring `react-router` as a peer** is the honest version of the same thing and costs the package its property of dropping into any React application.
  
  What the host takes on by supplying a navigate: the destination becomes a client-side transition, so an in-app path with no matching route renders the host's not-found instead of a full page load. That is the host's routing table to answer for, which is why the choice is the host's. The contract verdict is unchanged either way — a destination `@objectstack/spec` refuses is refused identically with or without a seam, so an injected navigate can never launder a value the authoring door rejects.
  
  `navigateOnSuccess` is a different declared key with its own open contract question (objectui#5034) and is deliberately untouched here.

### Patch Changes

- 9b20dea: Fix: a `drawer` form with no `sections` now renders the object's declared
  `fieldGroups` as sections, matching `ObjectForm` and `ModalForm`.
  
  `deriveFieldGroupSections` had exactly two call sites in the repo —
  `ObjectForm` and `ModalForm` — so the same object, with the same metadata,
  rendered one section per declared group in the modal create dialog and one
  ungrouped flat list in the drawer. The author who laid the groups out in the
  object designer saw them honoured on two surfaces out of three.
  
  `DrawerForm` now runs the same fallback the modal does: gated on "no explicit
  `sections`, no `customFields`", over the same auto-layout-filtered field list
  (system fields dropped, auto-generated fields dropped in create mode), with the
  flat path's inferred column count carried onto the grouped layout. A curated
  `sections` list from a form view still wins, and an object whose fields join no
  declared group keeps its flat layout untouched. A derived group declaring
  ADR-0085 `collapse` renders as a collapsible header, like an authored one.
- 469b604: Fix: a `drawer` form with no `sections` now honours the object's field-level
  conditional rules (`visibleWhen` / `readonlyWhen` / `requiredWhen`) and field
  `group`.
  
  `ModalForm` and `DrawerForm` each carried their own copy of the "object-schema
  field to runtime FormField" loop for the no-sections case, and the drawer's
  copy had fallen behind: it stopped at `multiple`, so the ADR-0036 predicates
  never reached the runtime field and `resolveFieldRuleState` had nothing to
  resolve. A hidden field rendered anyway, a frozen field stayed editable (with
  the server then dropping the write), and a conditionally-required field never
  blocked the submit.
  
  Both containers now build that list through one shared `buildFlatFields`, which
  resolves each field through the same `fromObjectSchema` the sectioned path uses
  — so the next field-mapping fix lands once and reaches every container.
- d7be3bd: `EmbeddableForm`'s thank-you redirect stops being mount-blind: an in-app destination now goes through the host's injected navigate.
  
  The redirect ended in one unconditional `window.location.href = url`. That is
  right for the external destination this key deliberately admits, and wrong for
  the in-app one it equally admits: a rooted path such as `/thanks` assigned to
  `location.href` resolves against the ORIGIN root, so under a host mounted at a
  sub-path — the framework CLI configures one for every embedded deployment, and
  the console runs at basename `/_console` — the submitter landed outside the
  application, usually on the host's own 404. Nothing refused either half of that
  authoring, so the failure was silent. This is objectui#4989 defect 4 on the key
  that card explicitly did not cover, and it is fixed here through the seam
  objectui#5111 landed (`HostNavigationContext`, `@object-ui/react`).
  
  The destinations are now split by who can travel to them:
  
  - an **app-relative** destination (`/thanks`, `thanks`, `?ok=1`, `#done`) is
    handed to the host's navigate when a host supplied one, so a mounted host
    places it inside its mount; with no provider the behaviour is byte-for-byte
    what it was — a host with no router has no basename, so origin-rooted
    resolution is already correct there;
  - an **external** destination admitted by `allowedRedirectHosts` keeps
    browser-level navigation **unconditionally**. This is the seam's own declared
    input contract, not a conservatism: `HostNavigationValue.navigate` documents
    `to` as an application-relative path, "never an absolute URL", because a host
    navigate is a client-side router transition. Since a relative reference cannot
    carry an authority, the seam is now structurally incapable of being handed a
    cross-origin URL.
  
  A same-origin **absolute** URL — the one shape those two arms do not name — also
  keeps browser-level navigation. Routing it through the seam would mean rewriting
  the author's full address into a path a mounted router then places at a
  different address; an author who spelled out the whole address asked for that
  address.
  
  Not changed, deliberately: `isRedirectUrlSafe` and `allowedRedirectHosts` —
  WHICH destinations are followed. That acceptance set (same-origin OR the
  author's allowlist) is this key's own contract, a refused destination reaches
  neither the seam nor the browser, and objectstack#7496's relative-only ruling
  belongs to `submitBehavior.url` and is not imported onto this key. The wait's
  ownership (objectui#5049) and the thank-you panel's copy (objectui#5073) are
  carried over unchanged: unmounting or pressing "Submit Another Response" still
  cancels a pending redirect, seam or no seam.
- a954b48: A public form's thank-you countdown ("Redirecting in {{seconds}} seconds…") now
  actually counts down, instead of rendering a number once and leaving it frozen
  for the whole wait.
  
  All ten locale packs document `publicForm.redirecting`'s `{{seconds}}` as "the
  remaining seconds", but `EmbeddableForm` computed it exactly once — at the render
  that first shows the thank-you panel — from `pendingRedirect.delayMs`, and never
  touched it again. On the 3 second default delay, a submitter saw a fully static
  "Redirecting in 3 seconds…" for the entire wait (objectui#5083).
  
  The number is now owned by a per-second `setInterval`, on the same ownership
  model PR #5070 established for the redirect wait itself: an effect keyed on the
  accepted destination (`pendingRedirect`), cancelled on unmount and on
  `handleReset`'s `Submit Another Response` — the exact regression surface
  objectui#5049 fixed for the navigation timer, restated here rather than
  reintroduced. The interval also stops itself once it reaches 0, rather than
  ticking indefinitely past a wait that has already ended.
  
  Nothing about WHICH destinations are followed or refused changes
  (`isRedirectUrlSafe` / `allowedRedirectHosts`, objectui#4989), and neither does
  the navigation wait's own ownership (objectui#5049 / PR #5070) — this is the
  display only.
- bda9b12: A public form's thank-you panel no longer promises a redirect its own guard just
  refused, and the `texts.redirectBlocked` string can finally reach a screen.
  
  `EmbeddableForm` decided whether to redirect from `isRedirectUrlSafe` /
  `allowedRedirectHosts`, but the panel's copy was keyed on something else: whether
  a `thankYouPage.redirectUrl` had been *authored* (objectui#5073). An author who
  declared a cross-origin destination without allowlisting its host therefore got a
  submitter who was told `Redirecting in 3 seconds…` and was then never redirected.
  The guard did its job; the screen contradicted it. That screen is the terminal
  state of a public form, so nothing came after to correct the impression.
  
  On the same path, the `texts.redirectBlocked` string the refusal set was
  unreachable in every locale. It was recorded with `setError(...)`, whose banner
  lives in the form branch — and `setSubmitted(true)` has already run one statement
  earlier, so the component is showing the thank-you branch, which renders no error
  at all. That was the only assignment of the key anywhere; pressing
  `Submit Another Response` cleared it rather than showing it.
  
  Both now follow the verdict:
  
  - The countdown renders on `pendingRedirect` — the destination that was actually
    accepted — and reads its seconds from the delay captured with it, so the
    displayed wait is the wait being served. A refused destination, and the
    honeypot's silent fake-success (which accepts no destination either), simply
    omit the line.
  - A refused destination renders `texts.redirectBlocked` in the thank-you panel
    when the author declared it — the case the key exists for, in the author's own
    words to the public. Undeclared means silence; the author keeps the existing
    `console.warn`, which is the channel for the person who can fix the
    declaration.
  
  Which destinations are refused is unchanged: `isRedirectUrlSafe` and
  `allowedRedirectHosts` are untouched, as is the timer ownership introduced for
  objectui#5049. Nothing was ever at risk in the data — the write succeeds before
  any of this — the harm was a false statement on the confirmation screen and a
  shipped, translated string no user could see.
- e354dd0: A public form's thank-you redirect no longer outlives the form that armed it, and
  "Submit Another Response" now cancels it.
  
  `EmbeddableForm` armed the `thankYouPage.redirectUrl` wait with a bare
  `setTimeout` inside the submit handler: the handle was not stored, nothing cleared
  it, and no part of the component owned it (objectui#5049). Two consequences, and
  the second needs no unmount at all:
  
  - For the whole of the delay a full-page navigation was pending that survived the
    form being taken off screen — an embed removed by the host page, a route change,
    a re-keyed subtree. With `redirectDelay` unset that window is the 3000 ms
    default, so this was the normal state of every submit on this surface rather
    than an edge authoring; the thank-you panel says as much out loud with
    `Redirecting in {{seconds}} seconds…`.
  - Under `allowMultiple`, `Submit Another Response` only flipped `submitted` back
    to false while the pending navigation kept ticking. The component invited the
    submitter into a fresh form and then, about three seconds later, threw the whole
    page away while they were typing the next response.
  
  The wait now lives in an effect keyed on the accepted destination, with a
  `clearTimeout` cleanup, so unmounting cancels it; and `handleReset` drops the
  destination, so pressing `Submit Another Response` cancels it too. The button
  offers the submitter a fresh form, and that offer cannot be honoured alongside
  discarding the page a moment later. This is the same move `ObjectForm` /
  `WizardForm` (objectui#5033) and `apps/console`'s `FormPage` already made for
  their own copies of this defect.
  
  Nothing else changed. Which destinations are followed and which are refused is
  still decided by the same `isRedirectUrlSafe` / `allowedRedirectHosts` guard, on
  the same line as before — only who owns the wait changed. The delay is captured
  together with the destination at the moment the write is accepted, so a host
  re-rendering with a different `redirectDelay` mid-wait cannot restart the pause
  under the submitter. The countdown copy is untouched. No data was ever at risk:
  the write has already succeeded before the wait begins, so the harm was a
  surprising navigation — and, on the `allowMultiple` path, the loss of what the
  submitter had just re-typed.
- f68018d: A form's declared redirect delay no longer outlives the form that armed it.
  
  `ObjectForm` and `WizardForm` consumed `submitBehavior: { kind: 'redirect' }` by
  arming the `delayMs` wait with a bare `setTimeout` inside the submit handler. The
  handle was not stored, nothing cleared it on unmount, and no part of the component
  owned it — so for the whole of the declared delay there was a pending full-page
  navigation that survived the form being taken off screen (objectui#5033). A
  submitter who dismissed the modal or drawer variant after the confirmation, who
  clicked an in-app link, or whose host re-keyed the subtree for its own reasons was
  pulled away from wherever they had gone by a timer belonging to a form that no
  longer existed. The longer the authored delay, the wider that window — and a
  non-trivial delay is the intended authoring, since `delayMs` exists so the
  confirmation is readable before the redirect.
  
  The wait now lives in an effect keyed on the accepted destination, with a
  `clearTimeout` cleanup, so unmounting cancels it. This is the same move
  `apps/console`'s `FormPage` already made for its own copy of this defect.
  
  `delayMs` semantics are unchanged: the pause is still a pause, an unset value is
  still "go now" (a zero timer, exactly as the in-handler version scheduled it), and
  which destinations are followed or refused is untouched — the contract verdict
  that decides WHETHER to navigate is the same one, only WHEN it happens is now
  owned by the component. The delay is captured together with the destination at the
  moment the write is accepted, so a host re-rendering with a different `delayMs`
  mid-wait cannot restart the pause under the submitter. Nothing was ever at risk of
  being lost: the write has already succeeded before the wait begins, so the harm
  was a surprising navigation, not a corrupted record.
- 375efb4: Publish the authoring surfaces of the four GA `object-*` blocks
  
  `object-form`, `object-grid`, `object-master-detail-form` and `object-metric`
  each honoured far more keys than they declared as registry `inputs`. An author —
  very often an AI author — who wrote one of the undeclared keys got an
  `unknown-prop` report from `sdui-parser` on a key that works, while the designer
  panel and the generated `sdui-intrinsics.d.ts` denied it existed.
  
  68 keys are now declared with descriptions written to teach correct authoring:
  `object-form` +20 (record binding, button labels, post-submit behaviour, mobile
  overrides), `object-grid` +21 (sorting, pagination, grouping, selection, row and
  bulk actions, navigation, export), `object-master-detail-form` +10, and
  `object-metric` +14 (formatting, comparison, drill-down). No renderer behaviour
  changes — this documents what already shipped, so the manifest, the generated
  `.d.ts`, the designer panel and the renderers finally agree.
  
  Ten of `object-grid`'s spec-declared keys are deliberately NOT published:
  its own `@deprecated` legacy spellings (`fields`, `staticData`, `selectable`,
  `pageSize`, `showSearch`, `showPagination`, `defaultSort`, `defaultFilters`,
  `resizableColumns`, `title`). The renderer keeps reading them so existing
  documents render, but recommending a deprecated alias as new authoring surface
  would harden it into a second dialect. Each canonical replacement — `columns`,
  `data`, `selection`, `pagination`, `searchableFields`, `sort`, `filter`,
  `resizable`, `label` — is declared, and each carries a description naming the
  legacy spelling it supersedes.
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
- 3b03704: `mobile.fullscreenLongText` now reaches fields the spec spells `richtext` (objectui#4831).
  
  `ObjectForm` is the one and only producer of the `mobile_fullscreen` flag: when a form
  sets `mobile: { fullscreenLongText: true }` it stamps that flag onto the metadata of
  every long-text field, and the widget renders an expand affordance plus a full-height
  editing dialog from it. The list of types it stamped was four hand-written literals —
  `textarea`, `field:textarea`, `field:markdown`, `field:html` — and `field:richtext` was
  not among them.
  
  `richtext` is the name `@objectstack/spec`'s `FieldType` gives this type; `markdown` and
  `html` are the other two, and all three are registry keys on ONE widget, `RichTextField`,
  which has read the flag since objectui#3301. So the consumer side was complete and two of
  the widget's three keys were stamped: a field authored exactly as the spec prescribes
  (`type: richtext`) rendered the rich-text editor with no expand button, on a form whose
  `mobile` documentation promises "textarea/rich-text get an expand button". `markdown` and
  `html` beside it worked. This is the same hole objectui#4250 found in this package's
  `WIDE_FIELD_TYPES`, which is why the twin set already lists `richtext` and this one did
  not.
  
  Adding the missing key is the whole change; no other type's behaviour moves, and a form
  that has not opted in still stamps nothing.
- 958d757: The plugin-form documentation-site page now teaches the `validation` shape the
  form renderer actually reads, so a copied example validates instead of only
  looking as though it does.
  
  `content/docs/plugins/plugin-form.mdx` carried the same two defects
  `packages/plugin-form/README.md` did before it was rewritten (objectui#5075 /
  objectui#5118): the README half was fixed and the documentation-site mirror was
  not touched.
  
  `### Form Field` redeclared a local `interface FormField` whose `validation` was
  `ValidationRule[]`. No `ValidationRule` type exists in this repository under any
  spelling, and `validation` is not an array — it is `FieldValidationRules`
  (`packages/types/src/form.ts`), an object keyed by rule name. The block also
  listed `defaultValue` and `className`, neither of which is a declared member of
  `FormField`, and marked `type` and `label` required when `name` is the only
  required key of the 23. The section no longer declares a local interface at all
  — a hand-written `interface` in a documentation snippet compiles nowhere, which
  is how it drifted this far — and references the declared keys instead, each one
  measured against the renderer's read points.
  
  `### Form with Validation` authored the array to match, and that spelling fails
  silently rather than loudly. The only reader of the key spreads it into the rule
  object handed to react-hook-form (`const rules: any = { ...validation }`,
  `packages/components/src/renderers/form/form.tsx:1652`); spreading an array
  produces numeric keys, react-hook-form recognises none of them, and every rule
  is dropped without an error. Measured against the real renderer: the old snippet
  submits a two-character username under `minLength: 3` with no message shown,
  while the rewritten one blocks it. The example is now annotated `FormSchema`, so
  the array spelling is a compile error (TS2559) rather than a runtime surprise,
  and a JSON variant is given alongside it for metadata authoring.
  
  Three facts a reader could previously only discover by experiment are now
  stated: `validation.required` supplies the required *message* while `required` /
  `requiredWhen` on the field decide whether it is required; there is no `email`
  rule name, an email check is a `pattern`; and a hand-authored `pattern` has to
  carry a RegExp, because react-hook-form applies a pattern only when its value is
  `instanceof RegExp` — it is the object-metadata path (`buildValidationRules`)
  that compiles a declared string into one.
  
  The two `DOC_TYPE_EXEMPTIONS` entries this page held in
  `scripts/check-doc-component-types.mjs` are deleted with it. They exempted
  `minLength` / `maxLength` as "ValidationRule discriminants under a field's
  `validation[]`" — a reason whose every clause was the fiction being removed —
  and without them the gate now fails if the array spelling returns.
- bfb64ee: `plugin-form` README: the "Integration with Data Sources" section now teaches the adapter's real path instead of two keys no form renderer reads.
  
  The section taught backend wiring as two keys on a form schema — `dataSource`
  (the adapter itself) and `resource: 'users'` — on an un-annotated
  `const schema = { … }`. Neither key is read anywhere on either form route:
  
  - **`dataSource`** is *discarded* by the basic form. The renderer reads its
    adapter off `SchemaRendererContext`
    (`packages/components/src/renderers/form/form.tsx:1004`) and passes it down per
    field (`:2061`); a same-named key arriving on the schema or props is dropped by
    the discard destructures at `form.tsx:304` and `:2168`, so it reaches neither a
    widget nor the DOM.
  - **`resource`** is declared on neither `FormSchema` nor `ObjectFormSchema`. The
    key exists in the protocol, but on `CRUDSchema` (`packages/types/src/crud.ts`,
    `type: 'crud'`); no form renderer reads it under any spelling.
  
  Both survived compilation because `FormSchema` and `ObjectFormSchema` extend
  `BaseSchema`, which declares `[key: string]: any` — so an invented key is never a
  type error, merely never read. A reader who copied the block got a form that did
  not connect to a backend, with nothing reported: what appeared to work was the
  hand-written `onSubmit` closure, which genuinely runs (the renderer awaits it at
  `form.tsx:1428`) using the adapter its *closure* captured, entirely independently
  of the two keys beside it.
  
  The section is rewritten around the real mechanism: the adapter is injected once
  by `SchemaRendererProvider` and travels on context, the metadata route uses
  `object-form` with its required `objectName` + `mode`, and the TypeScript route
  is a bare `form` whose `onSubmit` owns persistence. Both examples now carry real
  type annotations (`ObjectFormSchema` / `FormSchema`) in line with the rest of the
  file — an un-annotated object literal type-checks whatever is written in it. A
  closing note records the one thing a top-level `dataSource` *does* mean on a
  schema node: the spec's element binding (`{ object }`, objectstack#6953), which
  explicitly rejects a live adapter (`element-data-source.ts:131` refuses any value
  carrying a `find` method).
  
  Documentation only — no source, type or behavior change. This also removes a
  self-contradiction inside the same README, whose "Registering a component under
  your own key" section already stated the rule correctly ("never a `dataSource` —
  that travels on `SchemaRendererContext`").
- e09f9e8: Docs only: `packages/plugin-form/README.md`'s Schema API and Examples now spell
  the keys the form renderers actually read (objectui#5075). Three connected
  drifts, judged against the build product's `dist/index.d.ts` under `strict`:
  
  - **`validation` was written as an ARRAY** of `{ type, value, message }` entries
    in three places. The real key is `FormField.validation?: FieldValidationRules`
    — an OBJECT keyed by rule name (`required`, `minLength`, `maxLength`, `min`,
    `max`, `pattern`, `validate`). The array form is worse than a type error,
    because its runtime failure is SILENT: the only reader spreads the value into
    the rule object handed to react-hook-form (`const rules: any = { ...validation }`,
    `packages/components/src/renderers/form/form.tsx:1652`), and spreading an array
    into an object literal yields numeric keys (`{ '0': …, '1': … }`).
    react-hook-form's field validator reads exactly `required`, `maxLength`,
    `minLength`, `min`, `max`, `pattern`, `validate`, `valueAsNumber` off its
    descriptor, so every documented rule was dropped with nothing thrown — a form
    copied from this README looked validated while validating nothing. The rewrite
    also records two facts a reader could not have guessed: `validation.required`
    supplies the required MESSAGE only (presence is decided by the field's own
    `required` / `requiredWhen`), and a hand-authored `pattern.value` must be a
    RegExp, since react-hook-form only applies a pattern whose value
    `instanceof RegExp` and it is the object-metadata path (`buildValidationRules`)
    that compiles a declared string into one.
  
  - **`type: 'multi-step-form'` is registered nowhere**, and `steps` is not a key
    on any form schema — so the whole "Multi-Step Form" example rendered the
    unknown-component placeholder, with the fields inside `steps` never read. The
    example is replaced by the two real entry points: an `object-form` with
    `formType: 'wizard'`, whose steps are its `sections` (this is what
    `ObjectForm` routes to `WizardForm`), and the exported `WizardForm` itself
    with inline section fields and no data source — the shape closest to what the
    old snippet was reaching for. No new schema type was registered to make the
    old spelling true.
  
  - **The `FormField` reference block declared a local `interface FormField`**,
    which type-checks whatever it says because it is unrelated to the real type.
    Five of its rows were wrong (`type` and `label` are OPTIONAL; `validation` is
    the object above; `defaultValue` and `className` are not declared keys — the
    form-level `defaultValues` and `span` / `colSpan` / `fieldContainerClass` are),
    it named a `ValidationRule` type that exists nowhere in the repo, and it listed
    7 of the real 23 keys. The block is now a key table over the real declaration,
    with `FormSchema`'s own keys beside it, and both examples are annotated with
    their real types — the annotation is the point: `FormField` and `BaseSchema`
    both declare `[key: string]: any`, so an un-annotated `const schema = { … }`
    accepts any invented key and a nonexistent key is never a compile error.
  
  No renderer behaviour changes, and no capability, export or type was added to
  make an example true.
- 03e5f97: `packages/plugin-form/README.md`: three assertions about this package's export
  surface were false, and the export names are now taken from the built
  `dist/index.d.ts` (TS compiler API `checker.getExportsOfModule`) with every
  TypeScript block compiled against those same declarations under `strict`.
  
  - **`formComponents`** — fiction, and not a name that could be corrected: there
    is no aggregate component map on the surface at all, so the "Manual
    Registration" section described a mechanism that does not exist. Copying it got
    `undefined` and threw on `Object.entries(undefined)`. It is replaced by what
    actually happens: registration is a side effect of importing the entry, whose
    six `ComponentRegistry.register(...)` calls claim
    `plugin-form:object-form`, `view:form`, `plugin-form:embeddable-form`,
    `plugin-form:form-analytics`, `plugin-form:object-master-detail-form` and
    `record:line_items` — the two `skipFallback: true` calls being why bare `form`
    and bare `line_items` are *not* taken over. The section also lists the real
    export surface, and shows the thing the old snippet was reaching for: putting
    an exported component on a schema type of your own, with the caveat that the
    package's own registered renderers are internal wrappers that first resolve
    `dataSource` from `SchemaRendererContext`.
  - **`FormSchema` / `FormField`** — real types imported from the wrong package.
    Both are protocol types declared in `@object-ui/types` (`src/form.ts`); this
    package imports them and does not re-export them, so the documented import was
    a `TS2305` pair. Only the import path changed — no re-export was added to make
    the old path true, since widening a package's public surface is a contract
    change and not a documentation fix. The section now also points at the form
    types that *are* on this entry (`TabbedFormSchema`, `WizardFormSchema`,
    `ModalFormSchema`, …).
  - **`isRuntimeDefault` "(re-exported here)"** — the create-defaults section
    claimed the predicate is re-exported by this package. It is re-exported by
    `src/schemaDefaults.ts` for internal use only, never from the entry, and the
    package publishes just the `"."` export — so `import { isRuntimeDefault } from
    '@object-ui/plugin-form'` is another `TS2305`. The parenthetical now says where
    the re-export actually lives.
  
  No code, types or runtime behaviour change — the diff is one README plus this
  changeset. It declares a patch because `README.md` is in the package's published
  `files`, so the correction reaches npm with the next release.
- ae804ec: `ObjectForm` and `WizardForm` now consume a declared `submitBehavior: { kind: 'redirect' }` the way objectstack#7496 ruled it (objectui#4989): the destination is a **relative** path, `{{record.field_name}}` tokens are substituted from the record the submit just wrote and URL-escaped as the redirect is built, and a destination outside the contract is **refused on screen** instead of being dropped in silence.
  
  Both call sites previously read the value through `isSameOriginUrl` — resolve against `window.location.href`, compare origins — and navigated when that answered yes. That is not an open redirect (a cross-origin destination never reached the navigation) but it diverged from the ruled contract three ways, all fixed here:
  
  - **An out-of-contract destination was dropped in silence.** When the guard answered no the `if` simply did not fire: no toast, no error, no confirmation. The write had already succeeded, so the submitter was left facing a still-filled form with no feedback about what happened — and the obvious next move, submitting again, wrote a second record. A refusal now shows the spec's own author-facing prescription in an alert beside the confirmation that the record WAS written, toasts it, and replaces the filled form so there is nothing left to resubmit. Silence is the one outcome the ruling's consumer half rules out.
  - **A same-origin ABSOLUTE url was followed**, where the contract is relative-only — so this renderer accepted a spelling the authoring door refuses, which is how a rejected spelling stays alive in a corpus. The verdict is no longer restated here at all: `resolveSubmitRedirect` asks `@objectstack/spec`'s own `FormViewSchema` at the moment of use, so an absolute URL, a protocol-relative `//host`, a backslash, a whitespace or control-character smuggle, a malformed token or a document-relative path is refused with the spec's own wording — and a later widening of the ruling is followed by the version pin rather than by an edit here.
  - **`{{record.field_name}}` tokens were never substituted**, so an authored `/thanks?ref={{record.id}}` navigated with the literal braces in the query. Substitution now happens where the ruling assigns it — when the redirect is built — from the values as submitted with whatever the DataSource answered layered on top, and every interpolated value goes through `encodeURIComponent`, so a token is a value in the path and never a way to add path structure.
  
  `delayMs` semantics are unchanged. `navigateOnSuccess` is a different declared key with its own dialect and its own open contract question, and is deliberately untouched; `isSameOriginUrl` survives because that key still needs it.
  
  **Escalated rather than guessed at, and since ruled:** this change left a ruled in-app path handed to a browser-level navigation, which resolves it against the origin root, so under a host mounted at a sub-path the destination still left the app (objectui#4989 defect 4). Applying the mount means learning it, and every mechanism available to a published renderer package changes its contract. The maintainer ruled the mechanism on 2026-08-17 — an optional injected navigation seam — and it ships in the same release; see the `plugin-form-injected-navigation-4989` changeset for what a host now supplies and what a host that supplies nothing still gets.
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

- ae10a01: Console chrome reaches the bundle — the list switcher, the aggregate footer, the dialog a11y fallbacks and the whole Settings namespace screen stop being English on non-English consoles

  Six strings on the two screens a user looks at most were hardcoded English literals rather than bundle lookups, so they stayed English on every non-English console with nothing an app could author to change them. They are not object, field, view or action labels — no key in `TranslationData` reaches them — while the console's own bundle already ships zh-CN, ja-JP, es-ES, de, fr, pt, ru, ko and ar and translates hundreds of neighbouring strings. Omissions from an otherwise complete bundle, not a missing capability.

  **Two of the six needed no new keys at all, which is the more interesting half.** The list-view mode switcher named its nine visualizations from a private `VIEW_LABELS` table while `console.objectView.viewType*` — the same nine words — had been resolved through the bundle by the create-view picker for months; the switcher now reads those keys, so the picker's 「画廊」 and the switcher's 「画廊」 cannot drift apart in nine languages. The create/edit dialog's close button is the remainder of a fix that already landed: objectstack#5505 routed the `sr-only` close label through `common.close` for the two Shadcn-synced primitives, but `MobileDialogContent` is a hand-written wrapper outside that regeneration zone with its own close button, and it is exactly what `ModalForm` renders — so the dialog the report measured was the one place still announcing "Close" in English.

  The aggregate footer is the one the original report singled out: the **number** was already locale-formatted and the **prefix** was a hardcoded `Avg: ` / `Sum: `. All eleven aggregation kinds now take their prefix from `grid.summary.*`, and the label/value join is its own key rather than a `': '` baked into the renderer — the separator is translatable content, so zh sets a fullwidth colon and fr the French space-before-colon. The numbers are untouched. The form dialog's `sr-only` description fallback joins the packs too; it is clipped, not visible, so the only way an app could displace it was to author a `description` and thereby put a visible subtitle on every dialog.

  **The Settings namespace screen converts as one unit.** `SettingsView` routed zero framing copy through i18n — save/failure toasts, the env-lock and crypto refusals, the load-error card, the empty-route state, the navigation buttons, the unsaved-changes save bar — while its immediate sibling `SettingsHub`, in the same directory, resolved everything through `t('console.settingsHub.*')`. A zh-CN admin read correctly translated field labels sitting inside an English save bar, because `useSettingsLabel` translates a namespace's authored content but reaches none of the chrome around it. All of it now resolves through a `console.settingsView.*` namespace placed beside the hub's, including the crypto-refusal strings that objectui#4579 deliberately left in English rather than leave one translated string among a dozen literals.

  The save-bar counter was an English plural rule executing in every locale (`change` plus an `s` when the count exceeds one). It is now a real i18next plural family — base key plus `_one` and `_other` in all ten packs — not the `(s)` spelling translated nine ways. The base key is the load-bearing part: i18next asks `Intl.PluralRules` for the one suffix a language needs and, finding no such slot, falls back to English, so without it Russian would read English at counts 2-20 and Arabic at 2-99. Russian and Arabic take the "noun: {count}" form their packs already use for this exact reason, and the counter is verified rendering in-language at 1, 2 and 5.

  The Beta badge reuses the hub's existing key rather than minting a twin, and the refusal messages interpolate their subject through the bundle instead of concatenating a translated word onto an English prefix.

- c32a8a1: `richtext` fields are placed like the long-form fields they are — four layout sets stopped spelling the type three ways the spec rejects

  `@objectstack/spec` spells the WYSIWYG type `richtext`, one word, and **rejects** `rich_text` and `rich-text`: both exist only as typo keys in the spec's own `suggestFieldType` table, so `FieldSchema` refuses a field declared with either. Four sets that place fields by matching the RAW type string carried nothing else — `SKIP_TYPES` in the related list spelled it `rich_text`, both `WIDE_FIELD_TYPES` and `SECONDARY_FIELD_TYPES` spelled it `rich-text` — so each set was inert for the only spelling a producer can emit, and every one of them named the type it was failing to handle.

  For a real `richtext` field that meant: it was auto-derived into a related-list column, it never spanned the full row in a multi-column detail section or form (unlike `markdown` and `html` sitting right beside it in the same sets), and it stayed in the dense primary section of the record page instead of dropping into "More details". All four move together — half of them would have left the detail page and the form disagreeing about the same field, which is worse than the uniform gap.

  The dead spellings are dropped rather than kept alongside the live one: the alias table is the single place aliases belong, and a set that carries both invites the next drift. The pins are derived from the spec's own `FieldType` vocabulary instead of enumerated, so a member that stops being a real type name fails by name — replacing an assertion that was green only because the set contained the string it asked about.

  `markdown` joins `richtext` and `html` in the related list's `SKIP_TYPES`, on a measurement rather than on the assumption that it renders raw. It does not: markdown and richtext both render through `MarkdownCellRenderer`, formatted and sanitized. The reason none of the three works in a table is that the formatted output is block-level — a heading, paragraphs, a list — inside a single-line truncating cell, so a document shows as one clipped heading with the rest invisible. `textarea` stays derived for the same reason read the other way: it renders as plain truncated text, which is a useful column. Author-declared columns are untouched — this set only filters the zero-config auto-derive walk.

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
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [433ff9f]
- Updated dependencies [5cc847c]
- Updated dependencies [e7663f2]
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
- Updated dependencies [36310dc]
- Updated dependencies [52d878a]
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
  - @object-ui/fields@17.5.0
  - @object-ui/types@17.5.0
  - @object-ui/permissions@17.5.0

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

- 1bd6faa: fix(fields,plugin-form): stop the inline child grid from collapsing `datetime`/`time` columns onto the `date` control

  `deriveMasterDetail`'s `fieldTypeToColumnType` mapped `date`, `datetime` and `time` onto the single `date` grid column type, and `GridField` renders that as `<input type="date">`. The consequence was not cosmetic: that control emits a bare `YYYY-MM-DD` on change, so a user who merely re-picked the **day** of a `datetime` cell silently wrote the record's time component out of existence — a `14:30` became midnight with no warning and no undo.

  `GridColumn['type']` now carries `'datetime'` and `'time'` alongside `'date'`, and each renders its own control with its own read/write adapter:

  - `datetime` → `<input type="datetime-local">`, read through `toDateTimeInputValue` and written back through `fromDateTimeInputValue`, so the stored shape stays ISO-8601 and read and write share one basis (the contract `DateTimeField` already follows, objectui#3127).
  - `time` → `<input type="time">`, round-tripping the stored zone-less `HH:mm[:ss]` verbatim.
  - `date` → unchanged.

  The read-only surfaces are fixed with it. `displayText()` and the read-only table both fell through to `String(value)` and printed the raw stored ISO on screen (`2026-06-17T00:00:00.000Z`); each temporal type now formats as itself — a day for `date`, day + local time for `datetime`, the wall clock for `time`. That could not be fixed before the type collapse was undone, because with one column type the renderer had no way to know which of the two to show.

  Authors writing explicit grid `columns` can now declare `type: 'datetime'` / `type: 'time'`; previously those spellings were not part of the exported union.

### Patch Changes

- 8497579: A required field whose `defaultValue` is a runtime token is submittable from a create form

  `@objectstack/spec` lets a field's `defaultValue` be a runtime _instruction_
  rather than a value — the `DEFAULT_VALUE_TOKENS` family (`'NOW()'`,
  `'current_user'`) or a CEL Expression envelope. The server resolves those per
  insert, in `ObjectQL.applyFieldDefaults`, for any field that arrives absent or
  null, which is why a create form must leave them empty: seeding the literal text
  `NOW()` into a datetime input and submitting it suppresses the very resolution
  the declaration asked for.

  Correct for an optional field. Combined with `required: true` it deadlocked:

  ```ts
  remind_at: Field.datetime({ required: true, defaultValue: 'NOW()' }),
  ```

  the control opened empty, the client-side required rule refused the submit, and
  there was nothing sensible for the user to type — the declaration had already
  said what the value is, and omitting the field is exactly what makes the server
  supply it. Same shape as the `required` + static-default case, one layer down.

  In **create** mode a runtime `defaultValue` now suppresses the client-side
  `required` rule, and the field is omitted from the payload. The producer
  guarantees the value at insert, so the field is not "missing" — it is
  server-owned. `required: true` alongside a runtime default is coherent authoring
  (storage-level required, producer-guaranteed), not an authoring error.

  Both halves matter. Suppressing the rule alone would have been half an answer: a
  rendered control registers with the form whether or not anything seeded it, so
  an untouched runtime-default field still reached the payload as `undefined` — or
  as `''` once anything focused it. `undefined` is invisible to a
  `JSON.stringify` inspection while remaining a KEY a data source may translate
  into an explicit column write, and `''` is neither absent nor null, so it stores
  a blank and defeats the declaration outright.

  Three boundaries came with it, each pinned in both directions:

  - **Create only.** An edit form shows a persisted row, where the token was
    resolved at insert; blanking a required column there is a real removal and is
    still refused.
  - **Runtime defaults only.** A static literal default _is_ seeded into the
    control, so if the user clears it they have removed a value that was really
    there — `required` still fires.
  - **The rule, not the field.** A value the user does type is submitted normally
    and outranks the declared default. Only the "must not be empty" check is
    suppressed.

  Seeding and this rule read ONE predicate (`isRuntimeDefault`), so a form can
  never seed a field it also refuses to submit. The suppression also drops the
  required marker and `aria-required` for that field in create mode, since both
  are driven by the same boolean — the honest reading, as the user really is not
  required to provide the value. Surfacing what the server _will_ supply, as a
  non-authoritative preview, is a separate follow-up.

  Not extended to `requiredWhen` (the conditional-required CEL rule), which is
  resolved downstream in the form renderer against the live record.

- f0c9a90: Create forms now open with the object schema's declared `defaultValue`s

  A field declared `required: true, defaultValue: 'draft'` opened the console's
  create dialog with an empty select and a required marker: the user had to pick a
  value the system already knew, with every neighbouring option — some with side
  effects — one click away. `defaultValue` + `required` produced the worst create
  experience of any modelling choice, strictly worse than declaring no default.

  The server was never the problem. Omitting the field from a create request
  stores the declared default, because `ObjectQL.applyFieldDefaults` resolves it on
  insert. The gap was container-side: `ObjectForm` seeded its opening values from
  the object schema, and the five other object-form containers did not — their
  create branch set the form data to `initialData || initialValues || {}` and never
  looked at the schema. The console's create dialog is the global `<ModalForm>`,
  one of those five. Modal, Drawer, Tabbed, Split and Wizard now seed through one
  shared module (`schemaDefaults`), so a create form opens preselected and
  submittable.

  Three boundaries came with it, each pinned in both directions:

  - **Create only.** An edit form shows a persisted row as the server holds it.
    `ObjectForm`'s pass had been running in every mode, so a column the record
    leaves unset showed the default — arming a silent write of a value the user
    never chose on the next save of any other field. It is now gated on the same
    "no persisted record" test the data-fetch effect uses.
  - **Static defaults only.** A `defaultValue` may be an instruction the server
    resolves per insert — the `NOW()` / `current_user` runtime tokens
    (`DEFAULT_VALUE_TOKENS`) or a CEL Expression envelope. `ObjectForm` had been
    seeding those verbatim, which put the literal text `NOW()` into a datetime
    input and then submitted it as the field's value, suppressing the very
    resolution the declaration asked for (`applyFieldDefaults` only fills fields
    that arrive empty). Those are now left empty for the server.
  - **Callers still win.** `initialData` / `initialValues` outrank a schema
    default — a lookup prefill or a duplicate-record seed is the more specific
    instruction.

  Only the field-level `defaultValue` is honoured, not a select option's
  `default: true`, even though `@objectstack/spec`'s `SelectOptionSchema` declares
  that key: the insert path resolves `defaultValue` and nothing else, so seeding
  from option-level `default` would preselect values the server would never have
  applied — a UI-only second default contract.

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

- 11c1e71: Resolve a `select` field declared `multiple: true` to the `field:multiselect` widget, so the object form's visible label actually names the chip picker it renders (objectui#3986).

  `mapFieldTypeToFormType` keyed the widget id on the field's `type` string alone, so an object-schema `{ type: 'select', multiple: true }` picklist — a spec-legal, entirely ordinary shape — became `field:select`. `SelectField` then delegated to `MultiSelectField` on `config.multiple`, so the component that RENDERED was the chip picker while everything keyed on the widget id still answered for the single-value combobox. Above all the label-association declaration (`ComponentMeta.labelling`, objectui#3961), which the form renderer resolves per widget id: the host emitted `<label for>` at the chip row's wrapper `div`, where a `for` is inert — `HTMLLabelElement.control` returns `null`. Visually the field had a label; in the accessibility tree that label named nothing. Measured on the object-form path, `role=group` + accessible name went from 1 for a `multiselect`-typed field (fixed in objectui#3975) to 0 for this one.

  Declaring `select` itself `labelling: 'group'` was not available: a single-value select's trigger is a labelable `button[role=combobox]` whose `for` association works, and a bare `select` is a builtin the renderer resolves without consulting the registry at all. The fix is therefore at the producer — the widget id now carries the arity, so one place decides which widget renders and the declaration can no longer be addressed to a widget that is not rendering.

  - `mapFieldTypeToFormType(fieldType, config?)` takes an optional second argument — the rest of the field definition, of which only `multiple` is read. Existing single-argument calls are unchanged, and so is every type outside the new table: `select` is the only one whose `multiple` form is a different WIDGET. The spec's multi-capable set is larger (select / lookup / file / image, with `radio` on the select branch and `user` storing like `lookup`), but `LookupField`, `FileField` and `ImageField` each render both arities themselves, so their id — and their labelling declaration — is already right for either.
  - The four object-form producers pass the pair: `ObjectForm`, `DrawerForm`, `ModalForm`, and `sectionFields` (Tabbed / Wizard / Split / Drawer / Modal). In `sectionFields` the id is now computed once from the EFFECTIVE pair, after view-level overrides have merged, because `multiple` is itself a spec `FormField` key: a view restating only `multiple: true` over a single-value object field moves the widget too, and `multiple: false` moves it back.
  - `SelectField`'s `multiple` delegation is KEPT, not retired. Measured, it stays reachable from three entrances that never consult the alias map: the inline grid editor (`FieldEditWidget` finds `select` in its own table first), `ActionParamDialog` (`resolveFormWidgetType` returns `select` from `fieldWidgetMap` first), and hand-written SDUI addressing `field:select` by name with `multiple` on its metadata.

  Read-only rendering of these widgets is untouched (objectui#4005), as is the built-in `Select` branch (objectui#3976).

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
- Updated dependencies [54233b1]
- Updated dependencies [c2ecbae]
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
  - @object-ui/react@17.4.0
  - @object-ui/core@17.4.0
  - @object-ui/fields@17.4.0
  - @object-ui/i18n@17.4.0
  - @object-ui/types@17.4.0
  - @object-ui/permissions@17.4.0

## 17.3.0

### Minor Changes

- f44d872: `mobile.fullscreenLongText` finally reaches auto-generated long-text fields, and
  `mobile_fullscreen` gets one declared carrier (objectui#3245).

  FROM: `ObjectForm` stamped the flag onto the FormField itself
  (`{ ...f, mobile_fullscreen: true }`). TO: it stamps the flag onto the object the
  form renderer will actually forward to the widget as `field` — `f.field || f`,
  resolved exactly the way `renderFieldComponent` resolves it.

  **The flag's only legal carrier is the field metadata, and its only producer is
  `ObjectForm`.** That convention was already what the widget side assumed after
  objectui#3232/#3233 (`TextAreaField` reads `field.mobile_fullscreen` and nothing
  else, and `field` is the single metadata carrier); the producer was writing to a
  different object, so for auto-generated fields the two never met.

  What was broken, end to end: `ObjectForm` builds an auto-generated field as
  `type: 'field:textarea'` **and** stashes the object-field metadata on `.field`.
  The renderer forwards `field: field.field || field`, so the widget received the
  raw metadata — which never carried the flag — while the FormField-level copy was
  dropped by `stripRegisteredFieldProps`. Every entry point into `TextAreaField`
  therefore read `undefined` and the expand affordance never rendered. Only the
  hand-authored `customFields` path (no `.field` to shadow the FormField) ever
  worked, i.e. the feature was dead on the path virtually every form takes. Unit
  tests on both ends passed the whole time, because the break lived in the seam
  between them; this release adds the feature's first integration coverage — real
  `ObjectForm` → real form renderer → real `TextAreaField`, no mocks — which fails
  against the old producer and passes against the new one.

  `mobile_fullscreen` is now declared on `@object-ui/types`' `BaseFieldMetadata`,
  hence on every member of the `FieldMetadata` union that
  `FieldWidgetComponentProps.field` resolves to. It is deliberately **not** an
  `@objectstack/spec` property: nobody authors it on a field definition, it is a
  projection of the form-level `ObjectFormSchema.mobile.fullscreenLongText` setting
  onto the field metadata at render time. Declaring it removes the last untyped
  end of the chain — the producer's `as FormField` cast is gone — so the two sides
  can now disagree out loud instead of silently.

  The hand-authored `customFields` path keeps working unchanged, and keeps its own
  metadata: the flag is stamped on the FormField only when there is no `.field` to
  carry it. Synthesizing a `field` object in that case would light the affordance
  up while quietly replacing the field's `rows` / `placeholder` with defaults — the
  regression test pins that too.

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
  - @object-ui/types@17.3.0
  - @object-ui/i18n@17.3.0
  - @object-ui/react@17.3.0
  - @object-ui/permissions@17.3.0

## 17.2.0

### Minor Changes

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
- Updated dependencies [785b8a5]
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
  - @object-ui/fields@17.2.0
  - @object-ui/permissions@17.2.0

## 17.1.0

### Minor Changes

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

- 03bd53b: feat(form): `SplitForm` honours the spec's new `FormSection.pane`

  A split form's panel assignment was a hardcoded positional rule — first section
  left, everything else right. The rule was invisible in the metadata, so
  reordering sections silently moved them across the divider, and an author could
  not place two sections in the left pane at all.

  Sections now declare their panel: `pane: 'primary' | 'secondary'`
  (@objectstack/spec `FormSection.pane`, objectstack#4160). Placement follows the
  key, not the array position — reordering paned sections never changes the
  layout. Omitted keys keep the exact legacy rule (first section `primary`, rest
  `secondary`), so existing metadata renders unchanged.

  `ObjectForm`'s split dispatch copies the key through its per-key section mapping
  (the path that once silently dropped `visibleOn`), and `ObjectFormSection`
  declares it. The spec side rejects `pane` on non-split form types at parse, so
  the key can never be an accepted-but-ignored no-op.

### Patch Changes

- 7639a61: fix(form): the spec↔runtime form-field chokepoint stops dropping spec 17 vocabulary, and the validator stops contradicting the renderer — #3090

  `normalizeSectionField` — the one translation point between the spec's authored
  form-field shape (`field` = object-field reference) and the runtime shape
  (`name` = data path) — silently dropped four spec keys, worst of all the
  ADR-0089 **canonical** `visibleWhen` spelling while the deprecated `visibleOn`
  worked. Now:

  - view-level `visibleWhen` routes into the view-level slot (`visibleOn`) so it
    ANDs with the object-level rule instead of clobbering it, and the wizard's
    final-submit gate folds the same slot into its verdict (before, a required
    field the view itself hides could block submission from off-screen);
  - `dependsOn`, `keyField`, and `disclosure` carry through;
  - a behavioral parity gate walks the spec `FormFieldSchema` key set — a key the
    spec adds fails as unmapped, a key it retires fails as stale.

  `SelectOptionSchema` is now derived from `@objectstack/spec/data` by reference
  (it used to strip `color` — which `@object-ui/fields` renders — plus `default`
  and the per-option `visibleWhen` gate), with pinned divergences (`value`
  widened for UI forms, `visibleWhen` on the #2212 wire contract) and documented
  UI-only extensions (`disabled`, `icon`). `SelectOption` (TS) gains `color` and
  `default`.

  `FormFieldSchema` (the runtime vocabulary `objectui validate` enforces) now
  covers every key the `FormField` interface declares — `widget`, `dependsOn`,
  `hidden`, `readonly`, `visibleOn`/`visibleWhen`/`readonlyWhen`/`requiredWhen`,
  `span` — and `type` is optional, matching the interface. A typo'd predicate now
  fails loudly instead of being stripped; spec-shape fields (`{ field: … }`) are
  still rejected, pinning the two-layer boundary.

- 94e63ef: fix(form): the runtime `field` metadata slot is declared instead of smuggled, and importing the spec's FormField is a lint error — #3090

  `FormField.field` — the slot where object-bound form paths stash the resolved
  field-metadata **object** for widgets — rode through the index signature,
  undeclared, readable only via `as any`. Same key, different layer: in the spec
  form-view vocabulary `field` is a _string_ (the referenced object-field name),
  and the undeclared slot kept that pun latent. The slot is now declared
  (`field?: Record<string, any>`) with the invariant in its JSDoc: on a runtime
  FormField it is never a string — the authored string form ends at the
  `normalizeSectionField` chokepoint, and a tripwire test pins that across all
  three input shapes. Assigning a string is now a compile error; the `as any`
  casts at the read sites are gone.

  A `no-restricted-imports` tripwire bans importing `FormField`/
  `FormFieldSchema` from `@objectstack/spec/ui` inside this repo: the spec's
  FormField TYPE erases to `any` in its dist (objectstack#4171), so the
  misimport silently deletes type safety — tsc says nothing. The lint message
  names the two layers and the correct import. The drift-guard parity test is
  the one legitimate importer, exempted inline with its reason.

  Ledger: `FormField` and `FormFieldSchema` move from untriaged DEBT to ALLOW
  with the two-layer rationale written down (122 → 120).

- aeb0bd2: fix(form): a tabbed/split form honours the form view's own `columns`

  `FormView.columns` is a spec key, but only `ObjectForm`'s simple path and
  `ModalForm` read it. `TabbedForm` and `SplitForm` derived the grid width from the
  per-section `columns` alone, so a view declaring `columns: 3` rendered 3 columns
  in a modal and **single-column** as a tab or split — the same metadata laying out
  differently depending on which host picked it up.

  Both now resolve the grid the way the other hosts already did:

      explicit form `columns`  ??  widest section's `columns`  ??  1

  The two keys answer different questions and the precedence reflects that: the
  view's `columns` is how wide the grid is, a section's `columns` is how densely
  that section fills it (via per-field `colSpan`). `columns` is declared on
  `TabbedFormSchema` / `SplitFormSchema` accordingly — `ObjectForm` already spread
  it through, it was simply being dropped on arrival.

- c735bf7: fix(form): a spec-vocabulary field no longer crashes the standalone form, and every surface now says which vocabulary you meant — #3090

  Writing the regression test against the unfixed renderer proved the failure
  was worse than the assumed silent drop: a `{ field: 'x' }` entry (spec
  form-VIEW vocabulary) slipped past the `f?.name` guards into a
  react-hook-form Controller with `name === undefined` and crashed the whole
  standalone form on `name.split('.')`, with nothing naming the culprit entry.
  The renderer now partitions such entries out — the rest of the form renders —
  and surfaces them with an inline alert plus a console.error whose text is the
  fix instruction (rename to `name`, or use an object-bound form whose sections
  accept the spec shape).

  `objectui validate` grows the same boundary awareness: on failure, a
  `{ field: … }` entry in a standalone form gets a "likely cause" hint naming
  the real fix instead of the bare `invalid_union` — the previous message read
  as "bolt a `name` on", which converts spec metadata wrongly. On success,
  mixed-vocabulary entries (`name` + string `field`) get a warning: they
  validate, but the spec key is dead weight the renderer ignores.

  `normalizeSectionField` warns (once per site) when an authored section field
  mixes both identity keys — the spec branch derives the runtime name from
  `field`, so an authored `name` was silently overwritten.

- e339d60: fix(plugin-form): swapping `recordId` no longer leaves the previous record on screen

  `loading` in `ModalForm` / `DrawerForm` / `TabbedForm` / `SplitForm` was only ever
  set `true` once, by `useState(true)`, and thereafter only ever set `false`. A
  `recordId` change therefore re-entered the fetch effect **without** going back
  through the loading branch: the form stayed mounted showing — and accepting edits
  to — record A's values, with nothing indicating a different record had been asked
  for, until B's response landed and replaced them in place. Anything typed in that
  window read as A's on screen and would have been submitted against B.

  The same effect had no staleness guard either, so two overlapping reads landed in
  **completion** order rather than request order: ask for B then C, and a slow B
  arriving last left the form showing B while the caller had asked for C.

  Both are the same defect from the user's side — the form displays a record nobody
  asked for — so both are fixed:

  - a change of record re-enters the loading state before the read, so the previous
    record is off screen while the next one is in flight. Gated on the record
    actually changing: the effect also re-runs on `initialData`/`initialValues`
    identity churn (callers rebuild those objects every render), and flashing the
    loading state for that would thrash;
  - the effect's cleanup marks its read stale, so a response that is no longer the
    one being awaited is dropped instead of overwriting a newer record.

  `ObjectForm` already re-entered loading before its fetch, which is why this only
  ever reproduced on the four sectioned variants.

  **Also fixed, a consequence of the above:** hiding the form unmounts the inner
  renderer, and that renderer is the only thing that reports dirtiness via
  `onDirtyChange` — it gets no chance to report `false` on the way out. Without
  clearing the flag, the overlay's unsaved-input guards would stay armed for input
  belonging to a record no longer on screen: a plain refresh would prompt, and
  closing would offer to discard nothing.

- aa35561: fix(form): a split create/edit form no longer loses the panel you are not submitting from (#2153)

  `SplitForm` rendered one `SchemaRenderer` — one react-hook-form instance and one
  `<form>` element — **per section**, and its two groups of sections live in
  separate resizable panels. So each panel owned isolated form state: submitting
  from one panel's action bar sent only that section's fields and silently dropped
  everything the user had typed on the other side of the divider. Filling both
  panels and clicking Create persisted `{ subject }` alone.

  The same isolation killed cross-panel field rules: a `visibleWhen` in the right
  panel referencing a left-panel field never saw that field in its record, so the
  predicate faulted and failed **open** — the field the author meant to hide was
  always shown.

  Both panels are now ONE form. The panel group became a layout the form renderer
  owns, via a new `FormSchema.fieldPanes` (+ `fieldPanesOrientation`,
  `fieldPanesResizable`) that mirrors `fieldTabs` (#2959): the `<form>` wraps the
  whole `ResizablePanelGroup` and each pane holds only fields, which is what lets a
  single react-hook-form instance span the divider. Sections inside a pane render
  behind the inline `section-divider` header, each at its own declared column
  density within the form's shared grid.

  One more fix falls out of moving the panels into the renderer: `splitResizable:
false` now actually pins the divider. It previously only hid the grip — the
  separator stayed draggable, because nothing passed the panel library's
  `disabled`.

  Each pane is its own `@container`, so a multi-column section collapses to fewer
  columns as its panel is dragged narrower instead of overflowing.

- 3c1f321: fix(form): a tabbed/sectioned create-edit form no longer loses the tabs you are not looking at (#2959, #2153)

  The explicit-`sections` path rendered one `SchemaRenderer` — one react-hook-form
  instance and one `<form>` element — **per section**, all sharing the same
  `formId`. Two failures compounded:

  1. the footer submit button (`form={formId}`) can only be associated with the
     **first** of those forms, so section 2+ never reached the payload; and
  2. in the `tabbed` variant Radix unmounted the inactive panel, destroying that
     tab's form state outright.

  Reported flow (HotCRM, 3 tabs, required `description` on tab 3): fill tab 1 →
  submit → server 400 `description is required` → switch to tab 3, fill it →
  submit → the server now reports `subject; description; status; priority` **all**
  missing, because the second submit's body had lost every earlier value.

  `ModalForm` (stacked and `contentLayout: 'tabbed'`) and `TabbedForm` now render
  ONE form for all sections, matching `ObjectForm` / `DrawerForm`. Stacked sections
  use the existing inline `section-divider` header (which now also renders the
  section's `description`); tabbed sections go through a new
  `FormSchema.fieldTabs` (+ `defaultFieldTab`, `fieldTabsPosition`) that the form
  renderer distributes into **force-mounted** Radix panels — CSS-hidden rather
  than unmounted, since react-hook-form skips validation for unmounted fields,
  which is how a required field on a tab nobody opened used to sail past the
  client and come back as a server 400.

  Validation feedback now points at the tab: a rejected field activates its tab and
  every tab holding one is marked on its trigger, for client-side rules and server
  `fields[]` rejections alike.

- c0d0bc8: fix(form): a wizard with `allowSkip` no longer submits past the required fields you skipped

  `allowSkip` let the user jump to any step from the indicator, and
  `handleStepClick` did so without validating anything on the way. Since a wizard
  mounts ONE step at a time and react-hook-form only validates the fields currently
  **mounted**, a required field on a step nobody opened was never registered, never
  validated, and simply absent from the payload.

  Measured against the unfixed component — 3 steps, required `owner` on step 2,
  `allowSkip: true`, click step 3's indicator, fill it, hit Create:

      createCalls: 1
      payload:     { subject: 'S1', notes: 'S3' }   // `owner` missing entirely
      UI mentions "required": false                 // nothing said so

  So an invalid create went out and the client said nothing about why — #2959's
  validation half, wearing a wizard's clothes.

  The final submit now checks the WHOLE declared field set, and when something is
  outstanding it returns the user to the first step that has one, marks that step's
  indicator (`data-error="true"`, destructive circle + icon), names the fields in a
  toast, and sends nothing. Conditional rules are honoured: the check runs on the
  canonical `resolveFieldRuleState`, the same engine the form renderer and the
  server's rule-validator use, so a field hidden by `visibleWhen` or not yet
  required by `requiredWhen` is not demanded. The sequential path is unaffected —
  a forward jump is refused without `allowSkip`, so Next already validated each step.

  Also in `WizardForm`:

  - `FormView.columns` is now honoured (spec key, previously dropped): the grid
    width is the view's `columns`, else the step's own. Unlike the tabbed/split
    hosts there is no widest-section fallback — wizard steps never share a viewport,
    so each keeps its authored width.
  - the root gained `@container`. The step grid is sized with container queries, and
    without a container ancestor every `@md:`/`@2xl:` variant was inert — a step
    declaring 2 columns rendered single-column. Found by running it in a browser;
    the class was present all along, which is why asserting the class alone had
    missed it.

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
- Updated dependencies [2307b52]
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
  - @object-ui/permissions@17.1.0
  - @object-ui/fields@17.1.0

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

- 662bdf9: fix(fls): wire the real per-caller FLS channel into import targets and grid
  columns; remove the never-populated `field.permissions` shape (objectstack#3661)

  The `permissions?: { read?, write?, edit? }` key on `@object-ui/types` field
  definitions (Phase 3.2.6) was declared-but-never-enforced: no producer in the
  stack ever populated it, so every guard reading it short-circuited to "allow".
  Per ADR-0049 enforce-or-remove, the shape is deleted and the three consumers
  now use the server-resolved `/auth/me/permissions` channel
  (`usePermissions().checkField`) — the same channel ObjectForm/ModalForm/ListView
  already enforce:

  - **ImportWizard target fields (app-shell `ObjectView`)**: the importable
    field set (and thus the downloadable CSV template's columns) now drops
    fields the caller cannot edit, instead of offering columns the server's
    FLS write gate would 403.
  - **ObjectGrid auto-derived columns**: columns the caller cannot read are
    dropped (same gate ListView applies), instead of a dead schema-shape check.
  - **ObjectForm**: the redundant dead guard in field generation is removed;
    the existing `applyFieldPerms` gate remains the real enforcement point.

  BREAKING CHANGE: `@object-ui/types` field definitions no longer accept a
  `permissions` key. It never carried data at runtime; consumers needing
  per-caller field-level permissions must use `@object-ui/permissions`
  (`MePermissionsProvider` + `useFieldPermissions`/`checkField`).

- dc7a798: fix(plugin-grid,plugin-form,plugin-designer,cli,vscode-extension): type-check the last five unchecked packages, and fix the two runtime bugs that hid there (#2919)

  Closes the remaining `DEBT` entries from the #2911 sweep. Each package gains
  `"type-check": "tsc --noEmit"` and loses its entry in
  `scripts/check-type-check-coverage.mjs`; coverage goes 36 -> 41 of 45 and
  outstanding errors 25 -> 5 (only #2916 `plugin-view` and #2918 `layout` remain).

  **Two of these were real bugs, not just type noise.**

  `@object-ui/cli` — `objectui validate` could never report a validation failure.
  `ZodError.errors` was removed in Zod 4 (the repo is on 4.4.3), so `.errors` read
  `undefined` and `.forEach` threw a `TypeError` that the enclosing `catch`
  reported as `✗ Error reading or parsing schema file: Cannot read properties of
undefined` — swallowing the very errors the command exists to print. Now reads
  `.issues`. Verified against the built CLI: an invalid schema now prints
  `1. Invalid input / Code: invalid_union` and exits 1.

  `@object-ui/plugin-grid` — grouping a grid by a boolean column showed the raw
  i18n key. `t('grid.booleanTrue', 'Yes')` asked for a key present in neither
  `GRID_DEFAULT_TRANSLATIONS` nor any locale bundle, and passed the English
  fallback as a bare second argument — which `createSafeTranslation`'s no-provider
  translator reads as an _options object_, so the fallback never applied and the
  header rendered the literal `grid.booleanTrue`. Switched to the `grid.yes` /
  `grid.no` keys the boolean cell renderer (`ObjectGrid.tsx`) and
  `BulkActionDialog` already use, with the fallback passed as `defaultValue`.
  Covered by a new regression test, confirmed to fail against the old code.

  The rest are type-only corrections that preserve runtime behaviour exactly:

  - **plugin-grid** `importParsers.ts` — `scorePair`'s `score`/`reason` moved into
    one `best` record. They were captured `let`s mutated only inside the `bump`
    closure, which TypeScript's control-flow analysis does not track, so it still
    believed `reason` was `'none'` at the type gate and flagged the comparisons as
    non-overlapping (TS2367). The gate — which stops a text column being mapped
    onto a number field — is unchanged; its two dedicated tests still pass.
  - **plugin-form** — `SectionFieldsContext.fieldLabel` now requires `fallback`,
    matching the `useSafeFieldLabel` producer in `@object-ui/i18n` (an omitted
    fallback could not satisfy the `=> string` return, and all four call sites
    already pass one). This one signature cleared six errors.
    `MasterDetailFormSchema.recordId` widens to `string | number`, matching
    `ObjectFormSchema` and the five envelopes that forward straight into it;
    it is narrowed with `String()` only at the batch-transaction boundary, whose
    `BatchTransactionOperation.id` is a string by protocol (the `isEdit` guard
    already proves it non-null there). `deriveMasterDetail`'s column sort gets an
    explicit `fillPriority` helper — `GridColumn.type` is optional, and a column
    without one keeps sorting at priority 5 exactly as the old
    `TYPE_FILL_PRIORITY[undefined] ?? 5` lookup put it.
  - **plugin-designer** — unused `index` parameter prefixed `_`, matching the
    `_entry` beside it.
  - **cli** — a stale `@ts-expect-error` removed; `viteConfig` is typed `any`, so
    the line it guarded had stopped erroring.
  - **vscode-extension** (`object-ui`) — migrated off `moduleResolution: "node"`,
    which is deprecated and stops working in TypeScript 7, to `node16` paired with
    `module: "node16"` (the package has no `"type": "module"`, so node16 resolves
    it as the CommonJS that tsup emits, and it gains the `exports`-map awareness
    node10 lacks). Its error count was under-reported as 1: that TS5107 config
    error masked four more. The package uses `console`/`Buffer` but sets
    `lib: ["ES2020"]` with no DOM and never declared `@types/node` — added, with an
    explicit `types: ["node", "vscode"]`.

  Also: `plugin-grid`, `plugin-form` and `plugin-designer` gain the `baseUrl` +
  `paths` override their type-checked plugin peers already carry, and `cli` an
  empty `paths`. Without it the inherited root `paths` point `@object-ui/*` at
  sibling `src/`, which is outside each project's `rootDir` and produces the ~104
  spurious TS6059 errors noted in #2915; workspace deps instead resolve through
  node_modules to built `.d.ts`, which `type-check`'s `dependsOn: ["^build"]`
  guarantees exist.

  Verified the gate genuinely covers all five rather than trusting the green:
  injecting a type error into each package makes `pnpm type-check --filter <pkg>`
  fail, which was impossible before this change.

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

- 0a3710b: **Finish the `managedBy` / `userActions` de-dup — one parser for the override shape (completes objectui#2712, framework#3343).** #2712 consolidated the bucket _union_ + affordance _set_ mirrors but left four surfaces still parsing the `userActions.{create,edit,delete}` override shape by hand. They now all route through the shared `@object-ui/core` policy, so no package re-implements the boolean / #2614-object-form parse locally.

  - **`@object-ui/core`** promotes the internal `normalizeOverride` to the exported **`normalizeUserAction(v, base)`** (the one parser) and adds **`userActionPredicates(v)`** for per-record CEL predicate extraction.
  - **`app-shell/utils/managedByEmptyState.ts`** — the writable-`system` create check and its local `EmptyStateUserActions` interface are replaced by `resolveCrudAffordances({ managedBy, userActions }).create`.
  - **`plugin-grid/rowCrudAffordances.ts`** — the local `isOptedOut` / `predicatesOf` helpers (and duplicated `RowCrudUserAction` / `RowCrudPredicates` types) fold into `normalizeUserAction`; the historical type names stay re-exported for compat.
  - **`plugin-detail/RelatedList.tsx`** — its inline `predicatesOf` fold into `userActionPredicates`.
  - **`plugin-form/ObjectForm.tsx`** — the hand-rolled `managedBy !== 'platform'` blanket lock + `userActions` unlock is replaced by the resolved affordance for the current mode (`edit` / `create`), the **same** `resolveCrudAffordances` contract the detail (`isObjectInlineEditable`) and grid surfaces use.

  Behavior-preserving for `platform` / `system` / `append-only` / `better-auth`, with one deliberate alignment: an admin-editable **`config`**-bucket object (e.g. `sys_webhook`, `sys_permission_set`) is now editable in `ObjectForm` — it was previously over-locked as "non-`platform`", while detail/grid already treated it as editable (`config` resolves `edit: true`). New unit coverage for the shared parser and the config / create-mode form gate; all existing affordance/edit-gate tests stay green.

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
  - @object-ui/components@16.1.0
  - @object-ui/permissions@16.1.0

## 16.0.0

### Minor Changes

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

### Patch Changes

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

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/i18n@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0
- @object-ui/fields@15.0.0
- @object-ui/permissions@15.0.0

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

- Updated dependencies [82441e4]
- Updated dependencies [2efa9fd]
- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [579b24d]
- Updated dependencies [2b30583]
- Updated dependencies [2b30583]
- Updated dependencies [23d65c3]
- Updated dependencies [055e1d2]
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
  - @object-ui/fields@14.1.0
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/permissions@14.1.0
  - @object-ui/components@14.1.0

## 14.0.0

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
  - @object-ui/fields@14.0.0
  - @object-ui/permissions@14.0.0

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

- 5da9905: fix(plugin-form): honor `userActions.edit` on managed objects instead of blanket-disabling every field (ADR-0092 D4)

  `ObjectForm` disabled every field on any non-`platform` lifecycle bucket
  (config / system / append-only / better-auth) — a defensive default from when
  those objects had no generic edit affordance at all. Now that an object can
  OPEN per-record editing via `userActions.{edit,create}` (framework ADR-0092 D4
  — e.g. `sys_user` exposing its `name`/`image` profile fields), the blanket
  lock lifts for the current mode when its affordance is `true`, and each
  field's own `readonly` flag decides. Managed buckets still default the
  affordance off, so an object that doesn't opt in is unchanged. The server-side
  identity write guard remains the real boundary; this is UX only.

- Updated dependencies [80901aa]
- Updated dependencies [53c40c2]
- Updated dependencies [e492b9d]
  - @object-ui/components@13.2.0
  - @object-ui/i18n@13.2.0
  - @object-ui/fields@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0
  - @object-ui/permissions@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/i18n@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0
- @object-ui/fields@13.1.0
- @object-ui/permissions@13.1.0

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

- 195121a: Studio form designer + preview now match the runtime form's column density.

  The Data pillar's **Form → Layout** designer laid every section out in a fixed 2-column grid capped at `max-w-3xl`, and **Form → Preview** capped the real `ObjectForm` at `max-w-2xl`. So on a wide screen the studio showed at most 2 columns while the record the end user actually edits spreads to up to 4 — the design surface misrepresented the real layout.

  `ObjectFormDesigner` now derives its column count the same way the runtime form does (`inferColumns` over the object's editable field count, objectui#2578) and lays each section out with the shared container-query grid classes (`containerGridColsFor`) inside a per-section `@container`, so a field-heavy object reaches 4 fields per row on wide screens and collapses to one column when the panel is narrow. Wide widgets (textarea/markdown/html/…) span the full row, mirroring the form. Both the layout and preview canvases were widened to `max-w-6xl` so the container queries can actually reach 4 columns. `containerGridColsFor` is now exported from `@object-ui/plugin-form` as the single source of truth for these grid classes.

- Updated dependencies [6cbccf3]
- Updated dependencies [e1840bf]
- Updated dependencies [c31874d]
  - @object-ui/components@12.1.0
  - @object-ui/fields@12.1.0
  - @object-ui/i18n@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0
  - @object-ui/permissions@12.1.0

## 12.0.0

### Minor Changes

- e4de456: Fix form section grouping inconsistencies found in a UX review of grouped forms:

  - **Unified section visual language.** `FormSection`'s Card-wrapped path (used by Modal/Split/Tabbed/Wizard forms) previously rendered as a nearly-invisible white-on-white card (same `bg-card` as the page background, distinguished only by a barely-visible shadow) with a duplicated, inconsistent header (different title size, and a collapse chevron positioned differently) versus the flat `SectionDivider` path used by simple/drawer forms. Both now share the same header treatment (`text-sm font-semibold`, inline-left chevron, bottom border), and the Card path gets a soft `bg-muted/40` tint so grouped sections are visually distinguishable without relying on shadow alone.
  - **`readonly` no longer renders as `disabled`.** A field marked `readonly` (statically or via `readonlyWhen`) was being folded into the `disabled` prop before reaching field widgets, so widgets with a dedicated readonly display (e.g. `EmailField`'s mailto link, `TextField`'s plain-text view) never received it — every readonly field just looked permanently disabled. `readonly` is now forwarded as its own prop; generic `input`/`textarea` fields get a distinct readonly style (`bg-muted/40`, no `cursor-not-allowed`) instead of the disabled look.
  - **Section `className`/`gridClassName` now flow through JSON schemas.** `ObjectFormSection` and the per-form-variant section configs (`ModalFormSectionConfig`, `SplitFormSectionConfig`, `FormSectionConfig`, `DrawerFormSectionConfig`) accept `className` (and `gridClassName` where applicable), wired through `ObjectForm`'s form-type dispatch into `FormSection`/`SectionDivider` — closing a gap where section wrappers couldn't be customized from schema despite `FormSection` itself already supporting it.

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

### Patch Changes

- fae75e2: Fix two bugs verified still-present after #2254 claimed to resolve them (framework#2620 / framework#2616 Showcase UX pass, tracked in #2268):

  - **Wizard/form `submitBehavior: 'thank-you'` allowed duplicate resubmission.** #2254 fixed the spec-bridge dropping `submitBehavior` before it reached the renderer, so the configured toast message started appearing — but `WizardForm`'s last step and `ObjectForm`'s submit handler only ever called `toast.success(...)` for `thank-you`/`next-record`; the form stayed mounted and fully filled with its submit button re-enabled once the request settled, so a second click created a second record. Both components now track a terminal `submitted` state and, when set, replace the form with a confirmation panel (using the behavior's `title`/`message`, which were also never read before) — mirroring the pattern `apps/console/src/components/FormPage.tsx` already used for its own standalone forms.

  - **Command Center-style 3-up chart bands stayed collapsed to ~100-130px, and a dataset-bound chart's measure leaked its raw field name.**
    - `responsiveStyles` (and `style`) were declared on the page-spec `PageComponent` bridge input type but never copied onto the `SchemaNode` in `spec-bridge/bridges/page.ts::mapComponent()` — so a page author's ADR-0065 layout override (e.g. forcing `display: 'grid'` on a `type: 'flex'` band) never reached `SchemaRenderer`, and the node silently fell back to its default flex layout. Both fields are now mapped through.
    - `ObjectChart`'s dataset-bound fetch path (`schema.dataset` + `ds.queryDataset(...)`) discarded the response's `fields` array (which carries each measure's `label`, e.g. `{ name: 'task_count', label: 'Tasks' }`) before it ever reached `buildChartSeries()` — whose `fields` param already resolves this correctly (see `chart-series.test.ts`) — so the legend/tooltip always fell back to the raw field name. The fetched `fields` are now captured and threaded through.

- ec9c8ee: Fix master-detail record create: stop double success toast + localize the Cancel button.

  Objects with inline subforms (master-detail, e.g. a Lead with product line items)
  render `MasterDetailForm` inside `ModalForm`/`DrawerForm` instead of the plain
  footer, which exposed two mismatches with the host contract:

  - **Double success toast.** Flat `ObjectForm` delegates confirmation to the host
    when an `onSuccess` is supplied (skips its own default toast), but
    `MasterDetailForm.handleSaved` ALWAYS toasted `Created`/`Saved` AND ran
    `onSuccess`. In the console the host's `onSuccess` chains into the `crud_success`
    handler, which toasts a localized message — so create fired both `Created` and
    e.g. `线索创建成功`. `handleSaved` now only toasts as a fallback when no host
    `onSuccess` is provided, matching the `ObjectForm` contract; saves without a host
    handler stay non-silent.

  - **Hardcoded English `Cancel`.** The master-detail action bar wrote `Cancel` as a
    literal and accepted no `cancelText`, so the button stayed English while the
    submit button was localized (`submitText` was already forwarded).
    `MasterDetailForm` now takes `cancelText`, and `ModalForm`/`DrawerForm`/`ObjectForm`
    forward the host's localized label down the subforms branch.

  Adds regression tests: create with a host `onSuccess` fires no built-in toast (no
  double-confirm), and the Cancel button renders the host-supplied `cancelText`.

- 6c1ad9e: Record task flows open as derived overlays with lossless return (framework#2604, extends framework#2578).

  - **Create/Edit never route** — the global record form is URL-driven (`?form=new` / `?form=<id>`): browser Back closes the overlay with the origin (list scroll/filters, detail state) intact; field-heavy objects derive a full-screen modal (`modalSize:'full'`) via the new `deriveRecordFlowSurface` mirror in plugin-view, light ones keep the auto-sized modal. `editMode:'page'` opt-in unchanged.
  - **Save invariant** — _edit never moves you_ (origin refetches in place); _create lands on the new record's detail_ on its derived surface (drawer over the still-intact list for light objects, detail route for heavy), with `replace:true` so Back skips the transient form entry.
  - **Subtable child create/edit = overlay over the parent detail, never a route** — related-list New/Edit push `?form=…&formObject=<child>&formLink=<fk>:<parentId>`; the one global overlay pre-links the parent (refresh-safe), sizes to the CHILD object, and on save stays on the parent while only the child's related lists refetch. ModalForm now forwards `initialValues` into its master-detail (subforms) branch so pre-links survive for children with inline line items.

- Updated dependencies [544d8eb]
- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
  - @object-ui/i18n@11.5.0
  - @object-ui/react@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/fields@11.5.0
  - @object-ui/core@11.5.0
  - @object-ui/permissions@11.5.0

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

- 144ab55: Consume the ADR-0085 object semantic roles from `@objectstack/spec@11.7.0`, retiring the per-surface hint dialects:

  - **Single-source fieldGroups derivation**: `plugin-form`'s `deriveFieldGroupSections` and `plugin-detail`'s `deriveFieldGroupDetailSections` are now thin adapters over the spec's `deriveFieldGroupLayout` (ADR-0085 §5) — forms, modals and detail pages render the SAME grouping from one implementation. The canonical `collapse: 'none' | 'expanded' | 'collapsed'` enum is honoured everywhere (deprecated `collapsible`/`collapsed` and `defaultExpanded` spellings still read for pre-11.7 metadata).
  - **`stageField` semantic role**: the detail stepper reads the top-level `stageField`; `stageField: false` now actually suppresses stage detection (previously the `false` handling was wired to the removed `detail.stageField` key, so spec-authored `false` fell through to the name heuristic).
  - **`highlightFields` rename**: default grid columns, card compact views, the detail highlight strip, child-record preview fields and interface-page default columns read the object's `highlightFields` (deprecated `compactLayout` spelling read as fallback for pre-11.7 metadata).
  - **Removed dead reads**: the never-spec-writable `objectDef.views.*` UI hints and the ADR-0085-removed `detail.*` block (`sections`, `sectionGroups`, `highlightFields`, `stageField`, `useFieldGroups`, `showReferenceRail`, `hideReferenceRail`, `hideRelatedTab`, `relatedLayout`) are no longer consulted. Per-page customization goes through an assigned Page schema (`record:reference_rail` remains available there as a renderer capability). `detail.renderViaSchema` survives only as the legacy-renderer kill-switch and is removed together with that path.

### Patch Changes

- c38d107: Fix view-level `FormField.visibleOn` (CEL) never taking effect (#2212).

  The spec ships `visibleOn` as an Expression object `{ dialect: 'cel', source }`
  (what the `P` template emits) or a bare string, but the whole chain dropped it:

  - `sectionFields.ts` / `ObjectForm.tsx` only accepted the bare-string shape and
    attached a dead `visible()` closure no renderer ever called — the Expression
    object shape was silently discarded.
  - The form renderer destructured `visibleOn` out of the field config and never
    evaluated it.
  - `RecordFormPage` dropped a `simple` form view's `sections` entirely, so
    page-mode create/edit fell back to the raw schema (every field, no authored
    selection/grouping) while the modal path honored the same view.
  - `ObjectForm`'s grouped-sections path matched section fields by name only,
    dropping per-field `visibleOn` overrides.

  `visibleOn` now flows through normalization verbatim (both wire shapes) and is
  evaluated reactively by the form renderer with the canonical expression engine
  (`evalFieldPredicate` — same engine, record scope, and fail-open semantics as
  field-level `visibleWhen`; both predicates must allow a field for it to show).
  Sectioned/flat normalization also copies field-level `visibleWhen` /
  `readonlyWhen` / `requiredWhen` rules it previously lost.

- 1e9145d: Hydrate widget types on hand-authored master-detail subform columns. A view can
  list a child grid's columns as bare `{ field, label }` (the common authoring
  form); previously such untyped columns were passed straight to the grid, so a
  `select` / `lookup` / `date` / `number` field silently rendered as a plain text
  cell. `MasterDetailForm` (and `deriveDetail`) now resolve each untyped column's
  `type` (plus `options` / `reference` / computed `expr`) from the child object's
  schema via the new `hydrateColumns` helper — a picklist becomes a dropdown, a
  lookup a record picker, a date a date input — while preserving the author's
  exact column set, order and labels. Columns that already declare a `type` are
  left untouched (the author's explicit choice still wins).
- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [bce581a]
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
  - @object-ui/components@11.4.0
  - @object-ui/fields@11.4.0
  - @object-ui/i18n@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/permissions@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/i18n@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/fields@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0
  - @object-ui/permissions@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/fields@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0
  - @object-ui/i18n@11.2.0
  - @object-ui/permissions@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [6726a2b]
  - @object-ui/i18n@11.1.0
  - @object-ui/components@11.1.0
  - @object-ui/fields@11.1.0
  - @object-ui/react@11.1.0
  - @object-ui/types@11.1.0
  - @object-ui/core@11.1.0
  - @object-ui/permissions@11.1.0

## 7.3.0

### Patch Changes

- Updated dependencies [788dbf9]
  - @object-ui/fields@7.3.0
  - @object-ui/types@7.3.0
  - @object-ui/core@7.3.0
  - @object-ui/react@7.3.0
  - @object-ui/components@7.3.0
  - @object-ui/permissions@7.3.0

## 7.2.0

### Patch Changes

- 4aa8b84: fix(plugin-form): call `useRecordContext` unconditionally; drop impure render-time `Date.now()`

  `LineItemsPanel` wrapped `useRecordContext()` in a `try/catch`, which ESLint flagged
  as `react-hooks/rules-of-hooks` ("React Hook is called conditionally") — a genuine
  hook-order hazard if the `catch` ever fired part-way through render. `useRecordContext`
  returns `null` outside a `<RecordContextProvider>` and never throws, so the guard was
  dead code; it's now called unconditionally at the top level and the `null` case is
  handled by the existing optional chaining.

  Also clears a second pre-existing lint error: `EmbeddableForm` now seeds `mountedAtRef`
  from `0` instead of calling the impure `Date.now()` during render (the mount effect
  already overwrites it before any submit, so the anti-bot min-fill check is unchanged),
  fixing the react-compiler "Cannot call impure function during render" error. No
  behavior change.

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/fields@7.2.0
  - @object-ui/react@7.2.0
  - @object-ui/core@7.2.0
  - @object-ui/permissions@7.2.0

## 7.1.0

### Patch Changes

- aae8791: Flow Screen preview: render inline master-detail subforms (follow-up to #1944)

  The object-form mode of the Screen-node preview now renders inline master-detail
  child grids, matching runtime. `ScreenPreview` feeds the SAME enriched object
  list the runtime `FlowRunner` uses (`useMetadata().objects`, which derives
  `form.subforms` from `inlineEdit` relationships via `attachInlineSubforms`), so
  e.g. a `showcase_invoice` object-form step previews its **Line Items** grid
  (with live Subtotal/Tax/Total) — only fetched in object-form mode.

  To keep the preview non-persisting — consistent with the flat-field preview
  (disabled Submit) and the simple object-form preview (no Save) — `MasterDetailForm`
  now honours a `showSubmit` flag (default shown; backward-compatible) that
  `ObjectForm` forwards, so the preview hides the master-detail Save bar. Also drops
  a dead `e = formData` assignment in `ObjectForm` (lint `no-useless-assignment`).

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0
  - @object-ui/react@7.1.0
  - @object-ui/components@7.1.0
  - @object-ui/fields@7.1.0
  - @object-ui/permissions@7.1.0

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

- 80c133c: Spreadsheet-style line-item grid editor.

  `GridField`'s editable grid mode is reworked into an enterprise line-item editor (the QuickBooks / Stripe / NetSuite pattern), generalised across every inline grid:

  - **Computed read-only columns** — a child field with an arithmetic `expression` (e.g. `amount = quantity * unit_price`) renders read-only, recomputes live as its inputs change, and writes the result back into the row so it persists and the running total reflects it. A small safe arithmetic evaluator (`+ - * / %`, parens, `record.<field>` refs; no `eval`) powers it.
  - **Trailing "ghost" row** — start-with-one + auto-append: typing in the ghost materialises a real row (index-stable, so focus/caret survive), so you keep entering lines without clicking "Add".
  - **Borderless click-to-focus cells** + role-based column widths (description flexes; qty/price/amount stay narrow).
  - **Keyboard navigation** — Enter / ArrowUp / ArrowDown move between rows in the same column.
  - Per-row "expand to full form" is gated to grids that omit fields (no redundant expand on thin lines).
  - `deriveColumns` surfaces a field `expression` as a computed column; the running-total column prefers the computed/last-currency column. Blank/ghost rows are filtered from the persisted batch (`isBlankRow`).

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

- 69510df: feat(master-detail): derive child columns + relationship FK from metadata

  A master-detail child collection can now be configured with **just the child
  object name** — the relationship FK and the editable grid columns are derived
  from the child object's schema (via `DataSource.getObjectSchema`), instead of a
  hand-authored columns block.

  ```ts
  // before: ~40 lines of columns + relationshipField
  details: [{ childObject: 'task', relationshipField: 'project', columns: [ ...12 lines... ] }]
  // after:
  details: [{ childObject: 'task' }]
  ```

  - `relationshipField` is auto-detected from the child's `master_detail`/`lookup`
    field that references the parent (master_detail preferred).
  - `columns` are derived from the child's fields, skipping system/audit fields,
    the back-reference FK, and non-editable types (formula/summary/autonumber/
    file/json/…); select options and lookup references carry through.
  - `amountField` (running-total source) defaults to the first numeric/currency
    column.
  - Any of these can still be set explicitly to override the derived defaults.
  - Save is gated until derivation resolves; new pure helpers
    (`deriveDetail`/`deriveColumns`/`findRelationshipField`) are unit-tested.

- b148daf: feat(master-detail): atomic EDIT via the cross-object batch endpoint

  Edit mode now persists the parent update together with its child line-item
  create/update/delete diffs in ONE server transaction (commit all or roll back
  all), matching what create already did. Previously only create used the atomic
  `/api/v1/batch` path; edit fell back to client-orchestrated writes with
  best-effort cleanup.

  - New pure helper `buildMasterDetailEditBatch(parentObject, parentId,
parentData, details)` — emits a parent `update` op (index 0) then diffs each
    child collection against its loaded snapshot into `create` / `update` /
    `delete` ops (children reference the known parent id directly, no `$ref`).
  - `MasterDetailForm` now treats `canBatch` as available whenever the data
    source exposes `batchTransaction` (create AND edit). `submitViaBatch` builds
    create-ops or edit-ops by mode; `onSuccess` → `handleSaved` ("saved" toast,
    no form reset in edit).

  The server `/api/v1/batch` handler already supports `update`/`delete` actions,
  and the adapter already forwards `action`/`id`, so this is a front-end change.
  Unit-tested (parent update + child create/update/delete diff); the create path
  remains verified by the live e2e.

- 90acb7f: Master-detail subform + lightweight list primitives (SDUI).

  - `MasterDetailForm` (`object-master-detail-form`): enter a parent record and its child line items together; client-orchestrated transactional create (parent → FK → bulk children → rollup → cleanup). Enterprise-convention layout (header on top, line grid, single Save bar at the bottom).
  - `LineItemsField` editable child grid (line numbers, right-aligned numerics, running total) and `LineItemsPanel` (`record:line_items`) for detail-page inline edit.
  - `element:definition-list` and `element:repeater` — lightweight, low-chrome list primitives for simple data.

- 00f8d2d: Master-detail form: live Subtotal / Tax / Total stack.

  `MasterDetailForm` now renders a right-aligned document totals stack under the line items when the parent form has a tax-rate field (`taxRateField`, default `tax_rate`): **Subtotal** (Σ line amounts) → **Tax** (header rate %) → **Total**, recomputed live as lines and the rate change. The header rate is read via scoped event delegation on the form host (no coupling into `ObjectForm` internals). When the stack is shown, the per-grid footer total is subsumed.

- 300d755: feat(form): inline master-detail in a plain ObjectForm via `subforms`

  `ObjectFormSchema` gains a `subforms` array. When set, a regular `object-form`
  renders as a master-detail form — the object's own fields on top, an editable
  grid per child collection below, persisted together in one atomic transaction —
  without a bespoke `object-master-detail-form` page.

  ```ts
  { type: 'object-form', objectName: 'expense_claim',
    subforms: [{ childObject: 'expense_line' }] }   // FK + columns auto-derived
  ```

  Each subform needs only `childObject` (relationship FK and columns are derived
  from the child object's metadata; override with `relationshipField`/`columns`).
  This is the config-driven, page-less way to express master-detail entry — a form
  view can declare its child collections directly.

- 18728c1: Master-detail entry: lighter layout, compact lookup cells, persisted line order.

  - **De-framed line-item section** — the subform no longer double-frames the grid in a `Card` (border + `p-6`); it renders as a light label + the grid's own bordered table, reclaiming the width the line table needs.
  - **Compact lookup cells** — `LookupField` gains a `compact` mode (used by grid cells): the selected value shows inline in a borderless single-line trigger instead of a chip stacked above a separate "Select…" button.
  - **Persisted drag-reorder** — `deriveMasterDetail` detects a sort field (`position`/`sort_order`/…), excludes it from the editable columns/row-form, and threads it as the grid's `sort_field` so reordering stamps `row[position] = index` and survives a reload.

- 8426db7: feat(form): standard New/Edit modal renders form-view subforms (Tier 0)

  The console's standard create/edit record modal now renders inline child
  collections when the object's form view declares `subforms` — master-detail
  entry with **no bespoke page**, persisted as one atomic transaction.

  - `ModalForm` (and the create/edit modal in app-shell `AppContent`) detects
    `subforms` and renders `MasterDetailForm` inside the dialog (it owns its Save
    bar; the modal footer is suppressed); on success the modal closes + refreshes.
  - `AppContent` sources `subforms` from the object's default form view
    (`form.subforms` / `formViews.default.subforms`).
  - `ModalFormSchema` gains `subforms`.

  With this, declaring `formViews.default.subforms: [{ childObject }]` is enough
  to make an object's standard New/Edit screen a master-detail form — completing
  the config-driven master-detail story (Tier 0 → derive everything from the
  relationship + child metadata).

### Patch Changes

- ddbe4a2: B2 step 3: client-side field-level conditional rules (`visibleWhen` / `readonlyWhen` / `requiredWhen`). The form renderer now evaluates these CEL predicates reactively against the live record and gates each field's visibility, read-only state, and required-ness accordingly. Evaluation delegates to the canonical `@objectstack/formula` `ExpressionEngine` — the _same_ dialect the server enforces (`requiredWhen` in the rule-validator, `readonlyWhen` in `stripReadonlyWhenFields`) — so the UX and the persisted verdict always agree. New core helpers `evalFieldPredicate` / `resolveFieldRuleState` (zero-React, fail-open). `FormField` gains `visibleWhen` / `readonlyWhen` / `requiredWhen` (+ deprecated `conditionalRequired` alias), and `ObjectForm` carries them through from object metadata.
- 2d47e94: B2 follow-ups (A): field conditional rules in inline grids + submit-time enforcement.

  - **Grids**: a line-item column's `readonlyWhen` / `requiredWhen` CEL rule is now honored per row — `deriveMasterDetail` carries the props onto the `GridColumn` and `GridField` evaluates them against each row via `resolveFieldRuleState` (a `readonlyWhen`-TRUE cell locks; a `requiredWhen`-TRUE empty cell flags inline-invalid). Rules are row-scoped (`record.*`); the core helpers gained an optional `scope` (and `GridField` a `contextRecord` prop) so a future header-driven lock can bind `parent.*` — that wiring is deferred (it needs the master-detail header's re-renders isolated).
  - **Submit enforcement**: `requiredWhen` already drove react-hook-form's `required` rule, so submit is blocked with a field error when the predicate is TRUE and the value is empty. Added a reactive cleanup so a stale _required_ error clears when the predicate flips FALSE (and all errors clear when a field is hidden by `visibleWhen`).

- f6044fa: feat(form): subforms in DrawerForm + full-page record form (Tier 0 everywhere)

  Completes config-driven master-detail across all standard create/edit entry
  points (after the modal in the previous change):

  - `DrawerForm` now hosts `MasterDetailForm` inside the drawer when the schema
    declares `subforms` (its own Save bar; closes + refreshes on success).
  - `RecordFormPage` (full-page New/Edit) sources `subforms` from the object's
    form view, so the full-page form renders inline child collections too.
  - `ObjectForm`'s subforms shortcut now defers to the drawer/modal variants for
    those formTypes (so they keep their envelope), and only renders the
    master-detail form directly for inline/simple forms.

  Declaring `formViews.default.subforms: [{ childObject }]` now yields a
  master-detail experience in the modal, drawer, AND full-page form — no bespoke
  page anywhere.

- ad8ade6: feat(components): metadata-derived field locators on generated forms (ADR-0054 Phase 4)

  The form renderer now emits a stable `data-testid="field:{objectName}.{field}"`
  (plus `data-field`) on every field wrapper, derived from the form's `objectName`
  and each field's name — closing the locator gap at the source so every generated
  form (`ObjectForm`/`ModalForm`/`DrawerForm`/`SplitForm`/`WizardForm`) inherits
  testable fields with zero per-app work (ADR-0054 C4). `FormSchema` gains an
  optional `objectName`; the object prefix is omitted (`field:{field}`) when a form
  has none. `FormItem` now accepts `data-*` attributes.

- 3870c20: feat(forms): declarative `navigateOnSuccess` + `resetOnSuccess` on object-form

  Rounds out declarative success behavior for metadata-only forms (which can't
  pass an `onSuccess` function), complementing `successMessage`:

  - **`navigateOnSuccess`** — after a successful create/update, navigate here.
    Supports `{id}`/`{recordId}` interpolation from the saved record and is
    same-origin-guarded; takes precedence over the toast (landing on the record
    is the confirmation).
  - **`resetOnSuccess`** — after a successful create, reset the form for another
    entry (the wizard returns to a cleared step 1). Ignored when navigating.

  Wired in both ObjectForm and WizardForm via a small shared `successBehavior`
  helper (kept dependency-free to avoid an EmbeddableForm import cycle).

- b88c560: feat(forms): declarative `successMessage` on object-form

  Metadata-only forms (a wizard/object-form authored as JSON) cannot pass an
  `onSuccess` function, so the post-create/update feedback was a fixed
  "Created"/"Saved" toast. `ObjectFormSchema` now accepts `successMessage`, which
  ObjectForm and WizardForm use for the default success toast when no `onSuccess`
  handler is supplied. Falls back to "Created"/"Saved".

- 7913390: fix(master-detail): never silent on save — feedback, reset, and a duplicate-submit guard

  `MasterDetailForm`'s "Create" submitted successfully but gave **no feedback**: no toast, no form reset, no navigation. A successful create looked broken, and re-clicking created duplicate records.

  - On success: a `toast.success`, and on create the form clears (line items reset + parent `<ObjectForm>` remounts) ready for the next entry. A page-supplied `onSuccess` still runs afterwards (e.g. to navigate).
  - On failure (validation / network / atomic rollback): a `toast.error` surfaces the message instead of failing silently.
  - In-flight guard: the Create button shows "Saving…" and is disabled while a submit is running, preventing duplicate submissions, with a safety release if client-side validation blocks the submit.
  - `@object-ui/components` now re-exports `toast` (alongside `Toaster`) from its sonner wrapper.

  Tests: two new `MasterDetailForm` tests assert success → toast + form clear, and failure → error toast.

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

- 586a027: B2 follow-up (#1581): parent-scoped conditional rules in inline grids — "paid invoice → lock lines". `MasterDetailForm` now binds the live header record to every line-item grid as `parent`, so a column's `readonlyWhen` / `requiredWhen` CEL rule can react to the header (e.g. `parent.status == 'paid'` locks quantity / unit price / product when the invoice is paid). The line grids + document totals moved into a dedicated `<MasterDetailLines>` child that owns the scraped header record, so a header edit re-renders only the lines and never resets the header `ObjectForm`'s react-hook-form state mid-edit; the scrape is deduped by value to avoid needless churn. (`@object-ui/fields`' `GridField.contextRecord` and column-rule derivation already existed — this wires the last link.)
- 9aac2b8: feat(form): modal forms can host a tabbed layout (modal + tabbed composes)

  `ModalForm` rendered sections as a flat vertical stack — a modal create/edit
  form could never be tabbed, because `formType` (one field) couldn't be both
  `modal` (container) and `tabbed` (layout). Per ADR-0050 (additive first), the
  modal container now accepts a `contentLayout` ('simple' | 'tabbed'): when
  `tabbed`, sections render as tabs inside the dialog. The console record
  New/Edit modal (`AppContent`) forwards the default form view's layout, so a
  `type:'tabbed'` form view now renders tabbed in the modal too — not just on the
  full-page route (#1762). Non-breaking; `FormView.type` enum unchanged.

  Refs objectstack-ai/objectstack#1890, ADR-0050

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
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [6c0c92c]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [5332639]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [bd398df]
- Updated dependencies [66ed3ad]
- Updated dependencies [c6445b6]
- Updated dependencies [80c133c]
- Updated dependencies [5e1b838]
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
- Updated dependencies [18728c1]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/types@7.0.0
  - @object-ui/fields@7.0.0
  - @object-ui/permissions@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3
- @object-ui/fields@6.2.3
- @object-ui/permissions@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/fields@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2
  - @object-ui/permissions@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1
- @object-ui/fields@6.2.1
- @object-ui/permissions@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/fields@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0
- @object-ui/permissions@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/fields@6.1.0
  - @object-ui/react@6.1.0
  - @object-ui/permissions@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4
- @object-ui/fields@6.0.4
- @object-ui/permissions@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3
- @object-ui/fields@6.0.3
- @object-ui/permissions@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2
- @object-ui/fields@6.0.2
- @object-ui/permissions@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1
- @object-ui/fields@6.0.1
- @object-ui/permissions@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0
- @object-ui/fields@6.0.0
- @object-ui/permissions@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2
- @object-ui/fields@5.4.2
- @object-ui/permissions@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1
- @object-ui/fields@5.4.1
- @object-ui/permissions@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/fields@5.4.0
  - @object-ui/permissions@5.4.0
  - @object-ui/react@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2
- @object-ui/fields@5.3.2
- @object-ui/permissions@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1
- @object-ui/fields@5.3.1
- @object-ui/permissions@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0
- @object-ui/fields@5.3.0
- @object-ui/permissions@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1
- @object-ui/fields@5.2.1
- @object-ui/permissions@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [b2d1704]
- Updated dependencies [6c3f018]
- Updated dependencies [d912a60]
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
  - @object-ui/react@5.2.0
  - @object-ui/fields@5.2.0
  - @object-ui/components@5.2.0
  - @object-ui/permissions@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/fields@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/react@5.1.1
  - @object-ui/permissions@5.1.1

## 5.1.0

### Minor Changes

- c0b236f: Platform detail/form polish:
  - **Auto-section grouping**: When an object has no authored `views.form.sections`, the detail page now splits fields into a primary section and a collapsible "More details" section based on a field-type/name heuristic (textarea / markdown / description / notes / remarks). Eliminates the wall-of-fields layout on objects without explicit detail metadata.
  - **FormSection card chrome**: `FormSection` now accepts `showBorder`. Defaults to `true` for titled sections (Card wrapper) and `false` for untitled sections (flat). Same auto-default already applied to `DetailSection`.
  - **Origin breadcrumb**: Navigating from a list/kanban into a record now records the source view; the detail page shows a `← <view label>` back-link above the page header.
  - New i18n key `detail.sectionMoreDetails` (en + zh-CN).

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
  - @object-ui/fields@5.1.0
  - @object-ui/permissions@5.1.0

## 5.0.2

### Patch Changes

- a311e22: Fix EmbeddableForm rendering no inputs on the public-form path. When the
  caller passes a `fields: string[]` list (e.g. the response from
  `GET /api/v1/forms/:slug`) the inner `ObjectForm` now receives a
  read-only wrapper of the data source — preserving `getObjectSchema()`
  so it can materialise widgets, while neutralising mutating ops so all
  backend writes still go through `EmbeddableForm.handleSubmit` (and its
  consent / honeypot / min-fill / redirect / payload-sanitisation gates).
  - @object-ui/components@5.0.2
  - @object-ui/fields@5.0.2
  - @object-ui/react@5.0.2
  - @object-ui/types@5.0.2
  - @object-ui/core@5.0.2
  - @object-ui/permissions@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1
- @object-ui/fields@5.0.1
- @object-ui/permissions@5.0.1

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
  - @object-ui/fields@5.0.0
  - @object-ui/core@5.0.0
  - @object-ui/permissions@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0
- @object-ui/fields@4.8.0
- @object-ui/permissions@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0
- @object-ui/fields@4.7.0
- @object-ui/permissions@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [3ee436d]
  - @object-ui/components@4.6.0
  - @object-ui/fields@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/react@4.6.0
  - @object-ui/permissions@4.6.0

## 4.5.0

### Patch Changes

- 6b6afd1: ModalForm / SplitForm / WizardForm now honor field-level `visibleOn` (CEL
  expression on inline fields) and `visible_on` (object schema mirror) inside
  their section-mode rendering. Previously only flat-field forms via ObjectForm
  respected the expression; section-mode dropped it so conditional fields
  always rendered.
- Updated dependencies [ab5e281]
- Updated dependencies [d714e85]
- Updated dependencies [6b6afd1]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/fields@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/permissions@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [63eb66d]
- Updated dependencies [2bd45af]
  - @object-ui/fields@4.4.0
  - @object-ui/components@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/react@4.4.0
  - @object-ui/permissions@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [6b683c8]
  - @object-ui/components@4.3.1
  - @object-ui/fields@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1
  - @object-ui/permissions@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/components@4.3.0
  - @object-ui/fields@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1
- @object-ui/fields@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/components@4.2.0
- @object-ui/fields@4.2.0
- @object-ui/react@4.2.0
- @object-ui/types@4.2.0
- @object-ui/core@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0
- @object-ui/fields@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12
- @object-ui/fields@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/components@4.0.11
- @object-ui/fields@4.0.11
- @object-ui/react@4.0.11
- @object-ui/types@4.0.11
- @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10
- @object-ui/fields@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9
- @object-ui/fields@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/components@4.0.8
- @object-ui/fields@4.0.8
- @object-ui/react@4.0.8
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
