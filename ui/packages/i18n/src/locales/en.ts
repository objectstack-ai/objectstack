/**
 * English (en) - Default language pack for Object UI
 */
const en = {
  // objectui#4467 — the impersonation banner (app-shell ImpersonationBanner).
  // Raised by `session.impersonatedBy`, so it survives SPA reboots; it names
  // BOTH parties because the audit trail attributes the work to the impersonated
  // user, and the exit states its own failure rather than appearing to succeed.
  impersonation: {
    banner: {
      message: 'You are impersonating {{user}} — every action is recorded as them.',
      startedBy: 'Started by administrator {{admin}}.',
      stop: 'Stop impersonating',
      stopping: 'Stopping…',
      stopFailed: 'Could not stop impersonating: {{reason}}',
      notRestored: 'The server accepted the request but did not restore your administrator session — you are still impersonating {{user}}. Sign out and sign in again to end it.',
    },
  },
  // objectui#2600 B5 — capability picker scope group headers (labels come from
  // the capability registry; only these group titles are UI strings).
  capability: {
    group: {
      platform: 'Platform',
      org: 'Organization',
      other: 'Other',
    },
    // Curated platform capability labels (objectui#2600 B5). Registry-served
    // labels are English; these mirror them and give non-en locales a fallback.
    label: {
      manage_users: 'Manage Users',
      manage_org_users: 'Manage Organization Users',
      manage_metadata: 'Manage Metadata',
      manage_mailboxes: 'Manage Mailboxes',
      manage_platform_settings: 'Manage Platform Settings',
      setup_access: 'Setup Access',
      setup_write: 'Write Settings',
      studio_access: 'Studio Access',
      manage_sharing: 'Manage Sharing',
      view_all_audit_log: 'View All Audit Log',
    },
  },
  lookup: {
    recentlyUsed: 'Recently used',
    allResults: 'All results',
    loading: 'Loading…',
    noOptions: 'No options found',
    noRecords: 'No records found',
    createNew: 'Create new',
    createNamed: 'Create new "{{name}}"',
    showingResults: 'Showing {{shown}} of {{total}} results',
    showAllResults: 'Show all results ({{count}})',
    selectedBadge: 'Selected',
    browseAll: 'Browse all records',
    remove: 'Remove {{label}}',
    selectFirst: 'Select {{fields}} first',
    selectRecord: 'Select record',
    recordCount: '{{count}} records',
    recordCount_one: '{{count}} record',
    recordCount_other: '{{count}} records',
    pageOf: 'Page {{current}} of {{total}}',
    filters: 'Filters',
    clear: 'Clear',
    yes: 'Yes',
    filterPlaceholder: 'Filter {{label}}',
    prevPage: 'Previous page',
    nextPage: 'Next page',
    jumpToPage: 'Jump to page',
    retry: 'Retry',
  },
  common: {
    // objectui#13461 — a disclosure toggle's name (the tree-view node toggle).
    expand: 'Expand',
    collapse: 'Collapse',
    loading: 'Loading…',
    save: 'Save',
    // The SHARED "throw away the unsaved draft" verb, read by
    // `@object-ui/components`' `ConfigPanelRenderer` footer (objectui#4750).
    // The three older spellings stay where they are because each belongs to one
    // surface's wording: `form.discard` is the confirm button of plugin-form's
    // "Discard changes?" alert dialog, `console.settingsView.discard` and
    // `console.objectView.discard` are two console view footers — and the last
    // of those already disagrees with the other two in zh/ko/fr. This one is
    // the shared component's, and its ten values are the majority spelling.
    discard: 'Discard',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    filter: 'Filter',
    reset: 'Reset',
    confirm: 'Confirm',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    previous: 'Previous',
    submit: 'Submit',
    refresh: 'Refresh',
    export: 'Export',
    import: 'Import',
    yes: 'Yes',
    no: 'No',
    ok: 'OK',
    actions: 'Actions',
    more: 'More',
    selectAll: 'Select All',
    clearAll: 'Clear All',
    addToFavorites: 'Add to favorites',
    removeFromFavorites: 'Remove from favorites',
    noData: 'No data',
    noResults: 'No results found',
    required: 'Required',
    optional: 'Optional',
    selectOption: 'Select an option',
    select: 'Select…',
    openChat: 'Open chat',
    closeChat: 'Close chat',
    closePanel: 'Close panel',
    resizeDrawer: 'Resize drawer',
    // Count badge on a tab / section header. An i18next count family
    // (objectui#11445): the badge passes `count` and i18next picks the slot
    // each pack's CLDR rules select.
    itemCount: '{{count}} items',
    itemCount_one: '{{count}} item',
    itemCount_other: '{{count}} items',
    toggleSidebar: 'Toggle sidebar',
    breadcrumb: 'Breadcrumb',
    package: 'Package',
    done: 'Done',
    editInStudio: 'Edit in studio',
    record: 'Record',
    retry: 'Retry',
    printDialogHint: 'Opens your browser’s print dialog (not a PDF export)',
    // The non-grid row ceiling's footnote (objectui#7210). Two keys because
    // there are two conditions: a reported `total` states the fact with BOTH
    // numbers, a missing one cannot name how many. Kept terse deliberately —
    // this copy is eagerly loaded, and since objectui#7399 these bytes are
    // budgeted by the `i18n-locales` chunk, not `framework`. ⛔ That ceiling's
    // headroom is deliberately NOT restated here — it moves on every
    // re-baseline, and the figure that was here went stale.
    // `pnpm check:eager-closure` prints it.
    rowCeilingNote: 'Showing the first {{shown}} of {{total}} records. Narrow the filter.',
    rowCeilingNoteUnknownTotal: 'Showing the first {{shown}} records. Narrow the filter.',
  },
  actions: {
    decisionOutput: {
      help: 'Handed to the flow as a decision output.',
      helpMultiValue: 'Handed to the flow as a decision output. Comma-separate multiple values.',
    },
    resultDialog: {
      // objectui#13461 — the secret block's reveal toggle, an icon-only button.
      showValue: 'Show value',
      hideValue: 'Hide value',
      defaultTitle: 'Save this value now',
      acknowledge: 'I have saved this',
      copyAll: 'Copy all',
    },
    // The refusal notice for an action whose `autoTrigger` its own declared
    // `visible` gate outranks (objectui#4191) — the deep link or host asked
    // for it, but the author hid it on this surface.
    notAvailableHere: '"{{action}}" is not available on the current page.',
    // The reason a record action greyed out by its declared `disabled`
    // predicate gives on hover, on focus and as its accessible description
    // (objectui#11811): the generic one, since the action spec carries no
    // author-written reason. Not `notAvailableHere` — that one is about the
    // page, this one about the record.
    notAvailableForRecord: 'Not available for this record',
    // The success toast the action runner shows when no `outcomeMessages`
    // entry applies to the answer and the action declares no `successMessage`;
    // the server's message plays no part (objectui#11344). It is the one
    // success-toast text the runner writes itself (objectui#10900).
    completedSuccessfully: 'Action completed successfully',
    // The runner's other own text (objectui#10969): the error fallbacks when no
    // readable error message reached it, and the Undo label it hands the toast
    // handler for an undoable success toast.
    failed: 'Action failed',
    parallelFailed: 'One or more parallel actions failed',
    // The two row-count refusals of a single-record action launched from a
    // list toolbar (`resolveServerActionRecordId` in `@object-ui/core`); the
    // runner asks for them before any confirmation or param dialog opens
    // (objectui#13384).
    selectExactlyOneRow: 'This action runs on a single record — select exactly one row.',
    selectRowFirst: 'This action runs on a single record — select a row first.',
    undo: 'Undo',
    // The confirmation toast after that Undo has run — written by the console's
    // two undo handlers (`useConsoleActionRuntime` and `RecordDetailView`), not
    // by the runner (objectui#11056).
    undone: 'Change undone',
    // The console's global Ctrl+Z / Ctrl+Shift+Z toasts, raised by
    // `AppContent`'s `useGlobalUndo` handlers once the operation has been
    // undone / redone (objectui#11080). `{{description}}` is the operation's
    // own description, passed through unchanged; the pack owns the words and
    // the word order around it.
    undoneOperation: 'Undo: {{description}}',
    redoneOperation: 'Redo: {{description}}',
  },
  validation: {
    required: '{{field}} is required',
    minLength: '{{field}} must be at least {{min}} characters',
    maxLength: '{{field}} must be at most {{max}} characters',
    min: '{{field}} must be at least {{min}}',
    max: '{{field}} must be at most {{max}}',
    email: 'Please enter a valid email address',
    url: 'Please enter a valid URL',
    pattern: '{{field}} format is invalid',
    formInvalid: 'Please check the highlighted fields: {{fields}}',
    // Separator between the field names interpolated into `formInvalid`.
    // Per-locale because list punctuation is a locale property, not a code
    // constant: CJK enumerates with U+3001, Latin scripts with a comma+space,
    // Arabic with U+060C. Hardcoding one of them in the renderer put the CJK
    // comma into the English toast (objectstack#5407).
    formInvalidJoiner: ', ',
    unique: '{{field}} must be unique',
    type: '{{field}} must be a valid {{type}}',
  },
  form: {
    noPermissionToSave: "You don't have permission to save this record.",
    // The notice a record form shows when every field is locked because the
    // object's affordance for the form's mode is closed for this user
    // (objectui#11000). `{{object}}` is the object's label.
    noPermissionToCreate: "You don't have permission to create {{object}} records. The fields are read-only.",
    noPermissionToEdit: "You don't have permission to edit {{object}} records. The fields are read-only.",
    submitFailed: 'Could not save. Please try again.',
    uploadInFlight: 'Wait for the upload to finish before saving.',
    // The notice the record form raises when a field's own `visibleWhen` turns
    // it invisible and the form clears the value it held (objectui#8070 names
    // the `6a449fc49` clear). `{{fields}}` is the cleared fields' labels joined
    // with `validation.formInvalidJoiner`. A list after a colon, so no word has
    // to agree with how many fields were cleared.
    clearedOnHide: 'Cleared — no longer applicable given the current values: {{fields}}',
    // The refusal a record form raises at SUBMIT when a field's own
    // `visibleWhen` could not be evaluated (objectui#8069, ADR-0137 D2 as ruled:
    // the client refuses the one rule no server judges). It names the rule and
    // the fields — `{{fields}}` is their labels joined with
    // `validation.formInvalidJoiner` — because the fix is to the metadata, not
    // to anything the person filling the form can type.
    visibleWhenFaulted: "Can't submit: the visibleWhen rule of {{fields}} could not be evaluated. The rule must be fixed before this form can be submitted.",
    removeItem: 'Remove item',
    fieldRequired: 'This field is required',
    invalidFormat: 'Invalid format',
    saveSuccess: 'Saved successfully',
    saveError: 'Failed to save',
    unsavedChanges: 'You have unsaved changes. Are you sure you want to leave?',
    discardTitle: 'Discard changes?',
    discardMessage: 'You have unsaved changes. If you close this form now, your edits will be lost.',
    // The create/edit dialog's `sr-only` accessible description, used when the
    // form declares no `description` of its own (objectui#4024). Not visible
    // copy: it is what assistive tech announces for the dialog. An app could
    // only displace it by authoring a `description`, which makes a VISIBLE
    // subtitle appear on every form — so the fallback has to come from here.
    dialogDescriptionFallback: 'Complete the form fields, then submit or cancel.',
    // The hint under a field the caller may read but not write, shown when the
    // field declares no description of its own (objectui#11071).
    deniedDescription: 'You do not have edit access to this field.',
    // The hint under an empty field on a create form whose default the server
    // resolves at insert — a CEL expression or a runtime token the form cannot
    // evaluate, so it leaves the field empty and omits it (objectui#12108).
    // Shown only while the field is empty: a typed value is saved instead.
    serverDefaultHint: 'Set automatically when saved.',
    // The size-limit hint the flat `ObjectForm` appends to a `file` or `image`
    // field's description when the field declares `maxSize` (objectui#12156).
    // `{{size}}` is the formatted limit ("10.0 MB"); only the words translate.
    maxFileSize: 'Max size: {{size}}',
    // The master-detail form's own chrome (objectui#11071): the collection
    // placeholder while its columns resolve, the document totals stack
    // (`{{rate}}` is the header's tax rate), the row editor's title
    // (`{{title}}` is the collection's authored title, or `lineItem` when it
    // has none; `{{row}}` is the 1-based row number), its Apply button, and the
    // sr-only description of the dialog that hosts the form. The verbs `Add`,
    // `Close` and `Saving…` come from `detail.add`, `common.close` and
    // `detail.saving`.
    masterDetail: {
      loadingColumns: 'Loading columns…',
      subtotal: 'Subtotal',
      tax: 'Tax ({{rate}}%)',
      total: 'Total',
      lineItem: 'Line item',
      rowTitle: '{{title}} — row {{row}}',
      applyRow: 'Apply',
      editorDescription: 'Enter the record and its line items, then save.',
      // A collection's configuration hints (objectui#11160): no `childObject`
      // (the twin of `lineItems.noChildObject`, which names the panel), a
      // child schema that failed to load, and no lookup or master_detail
      // field on the child that references the parent. `{{property}}` is a
      // property name and `{{object}}` / `{{parent}}` are object names; each
      // is rendered as code and never translated. `lookup` and
      // `master_detail` are field type names, so every pack keeps them as
      // written.
      noChildObject: 'This collection has no child object configured: set {{property}} to the object whose rows it lists.',
      schemaUnavailable: 'Could not load the schema of {{object}}, so this collection has no columns to show. Check that the object exists and is readable, then reload.',
      noRelationshipField: 'Could not work out how {{object}} links to {{parent}}: no lookup or master_detail field on it references the parent. Set {{property}} on this collection to the field that holds the parent record.',
    },
    // The record page's `record:line_items` panel (objectui#11131): its
    // title when the author declared none. Its Save / Saving… button reads
    // `common.save` / `detail.saving`. `MasterDetailForm` reads `title` too,
    // for a collection that authors no heading (objectui#11145).
    //
    // The rest is the panel's own states (objectui#11145): no parent record
    // bound yet, rows held for another parent, and the two fallbacks for a
    // failed load or save, shown when the server sent no message of its own.
    // Its loading line reads `common.loading`. `noChildObject` is the config
    // hint for a panel with no `childObject`: `{{property}}` is filled with
    // the property name, rendered as code and never translated.
    lineItems: {
      title: 'Line Items',
      saveRecordFirst: 'Save the record first to add line items.',
      notLoaded: 'This record’s line items have not been loaded.',
      loadFailed: 'Failed to load line items',
      saveFailed: 'Failed to save line items',
      noChildObject: 'This panel has no child object configured: set {{property}} to the object whose rows it lists.',
    },
    keepEditing: 'Keep editing',
    discard: 'Discard',
    conflictTitle: 'Save conflict',
    conflictMessage: 'This record was changed by someone else while you were editing. Overwriting will replace their changes with yours.',
    conflictLatestVersion: 'Their save: {{time}}',
    conflictOverwrite: 'Overwrite',
    stepOf: 'Step {{current}} of {{total}}',
    createTitle: 'Create {{object}}',
    editTitle: 'Edit {{object}}',
    viewTitle: 'View {{object}}',
    createTargetOrg: 'Creates in {{org}}',
    saveRecord: 'Save',
    create: 'Create',
    update: 'Update',
    createSuccess: '{{object}} created successfully',
    updateSuccess: '{{object}} updated successfully',
    deleteSuccess: '{{object}} deleted successfully',
    // plugin-form's own feedback chrome (objectui#11039): the success toast
    // a form raises when the author declared no `successMessage` (`created`
    // after a create, `saved` after an edit), the master-detail form's edit
    // toast when the form has a `title` (`{{title}}` is that title), and the
    // console form page's toast after a submit. An authored message always
    // wins; these are only the defaults. The form's loading line and its
    // thank-you panel read `publicForm.loading` / `publicForm.thankYouTitle` /
    // `publicForm.thankYouMessage`, which say the same thing.
    created: 'Created',
    saved: 'Saved',
    savedNamed: '{{title}} saved',
    submitted: 'Submitted',
    // The heading of the panel a form shows when its object schema or its
    // record could not be loaded; the error's own message follows it.
    errorLoading: 'Error loading form',
    // Rides the success toast when a DECLARED `navigateOnSuccess` produced no
    // destination (objectui#5034): the write succeeded, the declared
    // navigation did not happen. `navigateOnSuccess` is the metadata key's
    // name, so every pack keeps it as written.
    navigateRefused: 'The `navigateOnSuccess` destination declared for this form was refused, so the navigation did not happen.',
    fullscreen: {
      title: 'Edit text',
      description: 'Edit the full text value, then save or cancel your changes.',
      done: 'Done',
      toggle: 'Edit {{label}} fullscreen',
      textFallback: 'text',
    },
  },
  fields: {
    // objectui#13461 — names for icon-only buttons in the field widgets.
    masterDetail: {
      view: 'Open {{name}}',
      remove: 'Remove {{name}}',
    },
    password: {
      show: 'Show password',
      hide: 'Hide password',
    },
    qrCode: {
      copy: 'Copy value',
      show: 'Show QR code',
      hide: 'Hide QR code',
    },
    relativeDate: {
      overdue: 'Overdue {{count}}d',
      overdue_one: 'Overdue {{count}}d',
      overdue_other: 'Overdue {{count}}d',
    },
    file: {
      dragDropHere: 'Drag & drop files here',
      dropFilesHere: 'Drop files here',
      browseHint: 'or click to browse',
      browseHintCamera: 'or click to browse • use the camera button below',
      takePhoto: 'Take photo',
      takeSelfie: 'Take selfie',
      cameraCapture: 'Camera capture',
      uploading: 'Uploading…',
      uploadingPct: 'Uploading… ({{pct}}%)',
      fileFallback: 'File',
      upload: 'Upload',
      remove: 'Remove {{name}}',
      exceedsMaxSize: '"{{name}}" exceeds max size ({{max}} MB)',
      uploadFailed: 'Failed to upload "{{name}}": {{error}}',
      uploadIncomplete: 'Upload of "{{name}}" did not complete: no file id was returned, so nothing was saved',
      restricted: 'Restricted file',
      restrictedHint: 'You do not have access to the details of this file',
    },
    image: {
      upload: 'Upload image',
      addMore: 'Add more images',
      uploading: 'Uploading…',
      imageAlt: 'Image {{index}}',
      crop: 'Crop image {{index}}',
      remove: 'Remove image {{index}}',
      enlarge: 'Enlarge {{name}}',
      preview: 'Image preview',
      cropPreview: 'Image crop preview',
      previous: 'Previous image',
      next: 'Next image',
      counter: '{{current}} / {{total}}',
    },
    percent: {
      slider: 'Percentage',
    },
    richText: {
      format: 'Format: {{format}}',
      basicEditorHint: 'Rich text editor (basic)',
      placeholder: 'Enter text…',
    },
    // objectui#3231 — the "this option list cannot be filled" copy shared by
    // the fixed-option widgets (select / multiselect / radio / checkboxes) AND
    // by the form renderer's gate hint. One key, one sentence: the renderer
    // interpolates field LABELS, a standalone widget its raw field names.
    options: {
      empty: 'No options available',
      selectFirst: 'Select {{fields}} first',
    },
    objectRef: {
      loading: 'Loading objects…',
      placeholder: 'Select an object',
      search: 'Search objects…',
      empty: 'No objects found',
    },
    registryRef: {
      loadFailed: 'The list could not be loaded. You can still type the name.',
      notFound: '{{name}} (not found)',
    },
    recipient: {
      selectTypeFirst: 'Select a recipient type first.',
      loading: 'Loading…',
      search: 'Search…',
      empty: 'No matches',
      select: 'Select a recipient',
      selectUser: 'Select a user',
      selectTeam: 'Select a team',
      selectBusinessUnit: 'Select a business unit',
      selectPosition: 'Select a position',
      selectUnitAndSubordinates: 'Select a business unit',
      selectField: 'Select a user field',
      noUserFields: 'No user fields on this object',
      fieldNotUserTyped: '{{name}} — not a user field',
    },
    filterCondition: {
      selectObjectFirst: 'Select an object first.',
      noCriteria: 'No criteria — this rule shares nothing',
      criteriaRequired: 'Add at least one condition. A rule with no criteria would share every record, so it cannot be saved.',
      invalidJson: 'Invalid JSON — the rule will match no records until fixed.',
      jsonOnly: 'This criteria can only be edited as JSON',
      editAsJson: 'Edit as JSON',
      useVisualBuilder: 'Use visual builder',
    },
    // objectui#6755 — a widget's OWN refusal sentence: `ObjectField`'s
    // unparsable JSON draft, and `LocationField`'s format and range refusals
    // (objectui#6716 / #6714). They were string literals in the widgets, so a
    // zh / ja / ar user who mistyped a coordinate or a JSON blob was told why in
    // English inside a form whose every other word was translated.
    //
    // KEYED, where objectui#4028 DROPPED the five address placeholders in the
    // namespace below — and the difference is what that decision's own comment
    // records about them: "The right example is a function of the address's
    // COUNTRY, not the reader's language", and "Each box here already has a
    // visible label naming exactly what it wants". Neither reaches a refusal
    // sentence: nothing else on the screen says why the edit was refused, and
    // what that sentence must say IS a function of the reader's language. What
    // #4028 does establish for both is the COST — ten pack entries per key,
    // bound from then on by `check:i18n-drift` — and the 2026-08-29 maintainer
    // ruling accepted that cost for these three sentences.
    //
    // Values are byte-identical to the literals they replace (`FIELD_DEFAULTS`
    // in `packages/fields/src/widgets/useFieldTranslation.ts` carries the same
    // three), so English and provider-less rendering are unchanged.
    //
    // `{{detail}}` is the SPEC's own complaint about the refused pair.
    // `LocationField` refuses to restate `LocationValueSchema`'s bounds — a
    // hand-copied range is a second contract — so this key translates the frame
    // and interpolates whatever the schema said.
    object: {
      invalidJson: 'Invalid JSON',
    },
    location: {
      refusedFormat:
        'Not saved: enter a latitude, longitude pair (example: 30.2741, 120.1551).',
      refusedRange: 'Not saved: {{detail}}',
      latitude: 'latitude',
      longitude: 'longitude',
      refusedResidueOne:
        'Not saved: {{name}} "{{text}}" is not a number. Enter plain decimals (example: 30.2741, 120.1551).',
      refusedResidue:
        'Not saved: {{name}} "{{text}}" and {{otherName}} "{{otherText}}" are not numbers. Enter plain decimals (example: 30.2741, 120.1551).',
    },
    // objectui#8148 — the FIFTH refusal sentence of objectui#6755's class, and
    // the only SHARED one. The four above are each ONE widget's; this one is
    // produced by `numberBadInput.tsx` for `NumberField`, `CurrencyField`,
    // `PercentField` and both of `GeolocationField`'s boxes. That last is the
    // sharpest case: it sits beside `LocationField`, whose refusals are keyed
    // right above, so two adjacent coordinate widgets refused bad input in two
    // different languages on the same form.
    //
    // ⭐ `{{example}}` is a HOLE, and that is what keeps decimal numerals out
    // of every pack. Five different values reach this one sentence (`1234`,
    // `1234.56`, `12.5`, `30.2741`, `120.1551`), so keying the example per
    // widget would be five keys times ten packs — and each pack would then
    // hold a decimal it could legitimately re-punctuate, where `1234,56` reads
    // as the `latitude, longitude` PAIR `refusedFormat` above asks for. The
    // widget fills the hole in ASCII; no pack spells a digit.
    //
    // The English value is byte-identical to the literal it replaces
    // (`FIELD_DEFAULTS` in `packages/fields/src/widgets/useFieldTranslation.ts`
    // carries the same one), so English and provider-less rendering are
    // unchanged.
    // objectui#10567 — the editable date-only face's notice for a stored value
    // written on a day that does not exist, the date-only sibling of
    // `dateTime.impossibleDay` below: an `<input type="date">` can only paint
    // such a value blank, so the widget names the stored string beside it.
    // `FIELD_DEFAULTS` in `packages/fields/src/widgets/useFieldTranslation.ts`
    // carries the same English value for provider-less rendering.
    date: {
      impossibleDay:
        'The stored value "{{value}}" is not a real date. Pick a date to replace it.',
    },
    // objectui#10474 — the editable date-time face's notice for a stored value
    // written on a day that does not exist. The `datetime-local` control can
    // only paint such a value blank, so the widget names the stored string
    // beside it; a blank control alone would hide it (objectui#3127).
    // `FIELD_DEFAULTS` in `packages/fields/src/widgets/useFieldTranslation.ts`
    // carries the same English value for provider-less rendering.
    dateTime: {
      impossibleDay:
        'The stored value "{{value}}" is not a real date. Pick a date and time to replace it.',
    },
    // objectui#12622 — the record form's date picker: its two shortcuts,
    // the clear / calendar buttons' accessible names, and the notice for
    // typed text that names no date ({{format}} is the locale pattern).
    datePicker: {
      today: 'Today',
      tomorrow: 'Tomorrow',
      clear: 'Clear date',
      openCalendar: 'Open calendar',
      invalid:
        'Not saved: "{{value}}" is not a date. Type it as {{format}}, or pick one from the calendar.',
    },
    number: {
      badInput:
        'Not saved: the text in this box is not a number. Enter a plain decimal (example: {{example}}).',
    },
    // objectui#3342 — the tags widget's input hint, shown while the tag list
    // is empty. The author-declared `field.placeholder` always wins over this.
    tags: {
      placeholder: 'Type and press Enter to add…',
    },
    // objectui#4028 — `AddressField`'s five sub-labels, previously English
    // string literals with no key at all: on a Chinese console every address
    // field showed five English words in the middle of an otherwise fully
    // translated form, and an app had NO way to reach them. The parts are not
    // fields on the object (`billing_address` is a single `address` column),
    // so there was nothing for a translation bundle to key on and no
    // `subLabels` property to declare — the only workaround left was to stop
    // using `Field.address()` and author five text fields, losing the
    // structured value, geocoding and map view.
    //
    // Values are byte-identical to the literals they replace, so English and
    // provider-less rendering are unchanged (`FIELD_DEFAULTS` in
    // `packages/fields/src/widgets/useFieldTranslation.ts` carries the same
    // five, which is what a host with no `I18nProvider` renders).
    //
    // The five INPUT PLACEHOLDERS that sat next to these labels are gone
    // rather than keyed — see the widget for that measurement.
    address: {
      street: 'Street Address',
      city: 'City',
      state: 'State / Province',
      postalCode: 'ZIP / Postal Code',
      country: 'Country',
    },
    // objectui#3406 — the accessible sentence of the textarea character
    // counter, rendered only when the field declares `maxLength`. The visible
    // text is `{count}/{max}` digits and needs no locale. ONE interpolated key
    // rather than assembled parts: ja and ko put the cap BEFORE the count
    // ("of {{max}} characters, {{count}}"), an order no code-side
    // concatenation can produce.
    //
    // objectui#3408 moved it off the `aria-live` region and onto the
    // textarea's `aria-describedby` — read once when focus lands, instead of
    // re-announced on every keystroke — and added `charactersRemaining` as the
    // one thing that IS still spoken while typing: after a pause, and only
    // inside the last 10% (or last 20 characters) of the cap.
    //
    // `charactersRemaining` is deliberately colon-form. `count` sends i18next
    // to plural lookup before the base key, and these packs declare the base
    // key only; a sentence whose grammar does not bend on the number is
    // correct at 1 without ten plural entries per pack.
    // objectui#11689 — `BooleanCellRenderer`'s own words (every list
    // surface draws them): the badge a status-named column (`active`,
    // `enabled`, …) shows for `false`, where `{{label}}` is the column label
    // the face is handed, and the completion indicator's accessible names.
    boolean: {
      offBadge: '{{label}} — Off',
      completed: 'Completed',
      notCompleted: 'Not completed',
    },
    textarea: {
      characterCount: 'Character count: {{count}} of {{max}}',
      charactersRemaining: 'Characters remaining: {{count}}',
    },
    // objectui#11131 — the line-items grid's default chrome (`GridField`):
    // its Add button, the read-only grid's empty state, and the list-mode
    // grid's empty state. An authored `addLabel` still wins over `addLine`,
    // and it fills the `{{label}}` hole (`detail.add` when none is authored).
    //
    // objectui#11145 — the rest of that chrome: the column chooser's heading,
    // the computed cell's tooltip, and the row actions. Each row action has
    // one key, read by both its `aria-label` and its `title`. The chooser's
    // button reads `table.columns`, the footer `form.masterDetail.total` and
    // the drag handle `view.dragToReorder`.
    grid: {
      addLine: 'Add line',
      noItems: 'No items',
      noItemsAddHint: 'No items yet — click “{{label}}” to begin.',
      optionalColumns: 'Optional columns',
      computed: 'Computed',
      openRow: 'Open row',
      duplicateRow: 'Duplicate row',
      removeRow: 'Remove row',
    },
  },
  table: {
    rowsPerPage: 'Rows per page',
    showing: 'Showing {{from}} to {{to}} of {{total}}',
    noRows: 'No rows to display',
    sortAsc: 'Sort ascending',
    sortDesc: 'Sort descending',
    filterColumn: 'Filter {{column}}',
    columns: 'Columns',
    exportCSV: 'Export CSV',
    exportExcel: 'Export Excel',
    selectRow: 'Select row',
    selectAllRows: 'Select all rows',
    expandRow: 'Expand row',
    collapseRow: 'Collapse row',
    rowActions: 'Row actions',
    hideColumn: 'Hide column',
    freezeColumn: 'Freeze column',
    unfreezeColumn: 'Unfreeze column',
    pageInfo: 'Page {{current}} of {{total}}',
    firstPage: 'First page',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    lastPage: 'Last page',
    totalRecords: '{{count}} total',
    noResults: 'No results found',
    noResultsHint: 'Try adjusting your filters or search query.',
    cancelAll: 'Cancel All',
    saveAll: 'Save All ({{count}})',
    addRecord: 'Add record',
    open: 'Open',
    search: 'Search…',
    modified: '{{count}} row modified',
    modified_one: '{{count}} row modified',
    modified_other: '{{count}} rows modified',
    saved: '{{count}} row saved',
    saved_one: '{{count}} row saved',
    saved_other: '{{count}} rows saved',
    saveFailed: 'Save failed',
    selected: '{{count}} selected',
    selected_one: '{{count}} selected',
    selected_other: '{{count}} selected',
    edit: 'Edit',
    delete: 'Delete',
  },
  grid: {
    actions: 'Actions',
    edit: 'Edit',
    delete: 'Delete',
    export: 'Export',
    exportAs: 'Export as {{format}}',
    loading: 'Loading grid…',
    errorLoading: 'Error loading grid',
    pullToRefresh: 'Pull to refresh',
    refreshing: 'Refreshing…',
    openRecord: 'Open record',
    recordUnavailable: '{{object}} · record unavailable',
    openMenu: 'Open menu',
    bulkSelected: '{{count}} selected',
    bulkSelected_one: '{{count}} selected',
    bulkSelected_other: '{{count}} selected',
    bulkSelectedAllMatches: '{{count}} selected (all matches)',
    bulkClear: 'Clear',
    bulkAllOnPage: 'All {{count}} on this page are selected.',
    bulkAllOnPage_one: '{{count}} record on this page is selected.',
    bulkAllOnPage_other: 'All {{count}} on this page are selected.',
    bulkSelectAllMatching: 'Select all {{count}} matching',
    bulkAllMatchingSelected: 'All {{count}} matching records are selected.',
    bulkActions: 'Bulk actions',
    rowHeight: 'Row height: {{mode}}',
    empty: 'Empty',
    yes: 'Yes',
    no: 'No',
    systemFields: 'System',
    // objectui#10881 — the grouped grid's two refusals: over a data source
    // that cannot answer the group header query, and over rows a host
    // handed in while declaring them one page of more. `queryGroupHeaders`
    // is the member's name and stays untranslated.
    grouping: {
      needsHeaderQuery:
        'This view is grouped, but its data source does not implement queryGroupHeaders, so the groups cannot be counted. Remove the grouping to show the records.',
      needsWholeRows:
        'Grouping needs every record, but this grid was handed one page of them, so the groups cannot be counted. Hand in every record, or let the grid fetch them from a data source that implements queryGroupHeaders.',
    },
    // Column-footer aggregate prefixes, keyed by the spec's `ColumnSummary`
    // vocabulary (objectui#4024). The footer already formatted its NUMBER
    // through the locale-aware formatter and then put a hardcoded English
    // `Avg: ` / `Sum: ` in front of it.
    //
    // `pattern` is a key rather than a `': '` baked into the renderer: the
    // separator is translatable content — ja/zh set a fullwidth colon, ar runs
    // right-to-left — so a pack owns the whole shape. Same reasoning as
    // `collaboration.resolvedSuffix` below.
    //
    // `pagePattern` is `pattern` for a figure that covers only the page on
    // screen of a larger matched set — the footer's fallback when the server
    // cannot answer the whole set's figure (objectui#12081 item 3). A whole
    // pattern rather than a suffix, for the same reason: where the scope sits
    // is the pack's.
    //
    // `countEmpty`/`percentEmpty` (and the filled pair) deliberately share a
    // word: the trailing `%` is what tells the two families apart on screen,
    // exactly as the renderer's own comment says.
    summary: {
      pattern: '{{label}}: {{value}}',
      pagePattern: '{{label}} (this page): {{value}}',
      count: 'Count',
      countEmpty: 'Empty',
      countFilled: 'Filled',
      countUnique: 'Unique',
      percentEmpty: 'Empty',
      percentFilled: 'Filled',
      sum: 'Sum',
      avg: 'Avg',
      min: 'Min',
      max: 'Max',
    },
    toolbar: {
      densityMode: 'Density',
      densityCompact: 'Compact',
      densityComfortable: 'Comfortable',
      densitySpacious: 'Spacious',
      densityCycleHint: '{{label}} (click to cycle)',
      densityCycleShortHint: 'Click to cycle',
    },
    import: {
      title: 'Import {{object}}',
      stepUpload: 'Upload',
      stepMapping: 'Mapping',
      stepPreview: 'Preview',
      uploadDescription: 'Upload a CSV or Excel file, or paste from a spreadsheet to get started.',
      mappingDescription: 'Map columns to object fields.',
      previewDescription: 'Review data before importing.',
      dragDrop: 'Drag & drop a CSV or Excel file here, or click to browse',
      browseFiles: 'Browse Files',
      downloadTemplate: 'Download template',
      downloadTemplateHint: 'Get an Excel file of the columns you can import (required fields marked *), with instructions for filling it in.',
      templateFileName: '{{object}}-import-template',
      templateDownloadFailed: 'Could not download the template. Please try again.',
      templateNotPermitted: 'You do not have permission to create records of this object, so its import template is not available.',
      parsing: 'Parsing…',
      pasteHint: 'or paste (Ctrl/⌘+V) rows copied from Excel or Google Sheets',
      legacyXls: 'Legacy .xls files aren\'t supported — please re-save as .xlsx.',
      unsupportedFile: 'Unsupported file type. Use CSV, TSV, or Excel (.xlsx).',
      parseFailed: 'Could not read this file. Please check the format and try again.',
      fileNeedsHeader: 'File must contain a header row and at least one data row.',
      mappingTemplate: 'Mapping template:',
      chooseTemplate: 'Choose template…',
      noSavedTemplates: 'No saved templates',
      noneOption: '— None —',
      saveCurrent: 'Save current',
      templateName: 'Template name',
      save: 'Save',
      deleteTemplate: 'Delete template',
      savedMapping: 'Saved mapping:',
      chooseSavedMapping: 'Choose a saved mapping…',
      manualMapping: '— Map columns manually —',
      transform: 'Transform',
      savedMappingHint: 'Mapping “{{name}}” applies rename + transforms + type coercion on the server. Column mapping is read-only.',
      savedMappingPreviewNote: 'The preview shows your source columns; on import, mapping “{{name}}” applies rename, transforms and type coercion on the server.',
      csvColumn: 'Column',
      mapsTo: 'Maps To',
      typeMismatch: 'Looks like {{type}}',
      autoMatched: 'Auto-matched',
      autoMatchedSummary: 'Auto-matched {{count}} column(s) — review and adjust below.',
      autoMatchedSummary_one: 'Auto-matched {{count}} column — review and adjust below.',
      autoMatchedSummary_other: 'Auto-matched {{count}} columns — review and adjust below.',
      confidence: {
        high: 'High confidence',
        medium: 'Medium confidence',
        low: 'Low confidence',
      },
      type: {
        number: 'Number',
        boolean: 'Boolean',
        date: 'Date',
        datetime: 'Date & time',
        text: 'Text',
      },
      status: 'Status',
      skipColumn: 'Skip column',
      skip: '— Skip —',
      mapped: 'Mapped',
      skipped: 'Skipped',
      rowsWithErrors: '{{count}} row(s) with errors',
      rowsWithErrors_one: '{{count}} row with errors',
      rowsWithErrors_other: '{{count}} rows with errors',
      rowsCorrected: '{{count}} row(s) corrected',
      rowsCorrected_one: '{{count}} row corrected',
      rowsCorrected_other: '{{count}} rows corrected',
      clickToFix: '— click a highlighted cell to fix it inline.',
      showingRows: 'Showing {{shown}} of {{total}} rows',
      importing: 'Importing… {{progress}}%',
      asyncQueued: 'Queued — preparing to import…',
      asyncProcessing: 'Importing {{processed}} of {{total}} rows… {{progress}}%',
      asyncLargeHint: 'This file is large, so it will be imported in the background.',
      largeSampleNotice: 'Previewing the first {{shown}} of {{total}} rows.',
      cancelImport: 'Cancel import',
      importCancelled: 'Import cancelled',
      resultsTruncated: 'Showing the first {{count}} row results (of {{total}}).',
      resultsTruncated_one: 'Showing the first {{count}} row result (of {{total}}).',
      resultsTruncated_other: 'Showing the first {{count}} row results (of {{total}}).',
      importComplete: 'Import Complete',
      importPartial: 'Import finished with errors',
      importFailed: 'Import failed',
      imported: '{{count}} imported',
      createdCount: '{{count}} created',
      createdCount_one: '{{count}} created',
      createdCount_other: '{{count}} created',
      updatedCount: '{{count}} updated',
      updatedCount_one: '{{count}} updated',
      updatedCount_other: '{{count}} updated',
      skippedCount: '{{count}} skipped',
      moreErrors: '…and {{count}} more errors',
      moreErrors_one: '…and {{count}} more error',
      moreErrors_other: '…and {{count}} more errors',
      downloadFailed: 'Download failed rows',
      options: 'Import options',
      writeMode: 'When a row matches an existing record',
      writeModeOpt: {
        insert: 'Always create new',
        update: 'Update existing (skip if no match)',
        upsert: 'Update if matched, else create',
      },
      matchFields: 'Match on',
      matchFieldsPlaceholder: 'Choose match field(s)…',
      matchFieldsHint: 'Rows are matched to existing records by these field(s).',
      needMatchFields: 'Select at least one field to match on.',
      matchOnlyField: '(match only)',
      optCreateOptions: 'Keep unknown option values',
      optSkipBlankKey: 'Skip rows with a blank match value',
      optBackground: 'Import in the background',
      optBackgroundHint: '(runs as an undoable job)',
      validate: 'Validate data',
      validating: 'Validating…',
      validateHint: 'Check every row against the server before importing.',
      validatePassed: 'All {{ok}} rows are valid.',
      validateFailed: '{{ok}} valid, {{errors}} with errors.',
      errorRowPrefix: 'Row {{row}}: ',
      referenceNotFound: 'No matching record for "{{value}}"',
      referenceAmbiguous: '"{{value}}" matches more than one record — use a unique value or the record id',
      invalidBoolean: '"{{value}}" is not a valid true/false value',
      invalidNumber: '"{{value}}" is not a valid number',
      invalidDate: '"{{value}}" is not a valid date',
      invalidTime: '"{{value}}" is not a valid time',
      invalidOption: '"{{value}}" is not one of the allowed options',
      requiredValue: 'This field is required',
      matchAmbiguous: 'Matches more than one existing record — use a unique value or the record id',
      history: 'History',
      historyBack: 'Back to import',
      historyDescription: 'Recent imports for this object.',
      historyHint: 'Background import jobs, newest first.',
      historyRefresh: 'Refresh',
      historyLoading: 'Loading…',
      historyEmpty: 'No imports yet.',
      historyUnsupported: 'Import history isn’t available for this data source.',
      historyColStatus: 'Status',
      historyColRows: 'Rows',
      historyColResult: 'Result',
      historyColTime: 'When',
      errorCount: '{{count}} errors',
      errorCount_one: '{{count}} error',
      errorCount_other: '{{count}} errors',
      undoImport: 'Undo import',
      undoing: 'Undoing…',
      undoConfirm: 'Undo this import? Records it created will be deleted and records it updated will be restored to their previous values.',
      reverted: 'Undone',
      undoPartial: '{{count}} rows were not undone. Undo again to retry only those rows.',
      undoPartial_one: '{{count}} row was not undone. Undo again to retry only that row.',
      undoPartial_other: '{{count}} rows were not undone. Undo again to retry only those rows.',
      jobStatus: {
        pending: 'Pending',
        running: 'Running',
        succeeded: 'Succeeded',
        failed: 'Failed',
        cancelled: 'Cancelled',
      },
      cancel: 'Cancel',
      back: 'Back',
      next: 'Next',
      close: 'Close',
      importNRows: 'Import {{count}} Rows',
      importNRows_one: 'Import {{count}} Row',
      importNRows_other: 'Import {{count}} Rows',
      importingProgress: 'Importing…',
      required: 'Required',
      invalidType: 'Invalid {{type}}',
      legacyReferenceBlocked: 'Import blocked: {{fields}} are relation fields that need the server import route to resolve names into record IDs, and this connection doesn’t support it. Importing them as plain text would corrupt the data. Upgrade the backend/client, or unmap these columns and import them separately.',
      missingRequiredHint: 'Can’t continue — required field(s) not mapped: {{fields}}. Add a matching column to your file, or go back and upload one that includes it.',
      legacyFallbackNotice: 'Imported via a compatibility fallback: this connection doesn’t support the server import route, so values were saved as text without server-side type coercion. Upgrade the backend/client for full import support (type coercion and relation lookups).',
      notAllowed: 'This object is not open for import.',
      requiredMark: '*',
    },
    bulk: {
      confirmDefault: 'This will apply to {{count}} record(s).',
      confirmDefault_one: 'This will apply to {{count}} record.',
      confirmDefault_other: 'This will apply to {{count}} records.',
      overLimit: 'Selection ({{count}}) exceeds the action limit ({{limit}}). Reduce the selection to proceed.',
      affectedRecords: 'Affected records ({{count}}):',
      skippedIneligible: '{{count}} selected record(s) are not eligible for this action and will be skipped.',
      skippedIneligible_one: '{{count}} selected record is not eligible for this action and will be skipped.',
      skippedIneligible_other: '{{count}} selected records are not eligible for this action and will be skipped.',
      rowFallback: 'Row {{index}}',
      andMore: '\u2026 and {{count}} more',
      processed: '{{count}} / {{total}} processed',
      processedFailed: ' \u00b7 {{count}} failed',
      undonePrefix: 'Undone \u2014 ',
      succeeded: 'Succeeded {{count}} / {{total}}',
      resultFailed: ' \u00b7 Failed {{count}}',
      retry: 'Retry',
      downloadErrorCsv: 'Download error CSV',
      cancel: 'Cancel',
      back: 'Back',
      next: 'Next',
      run: 'Run',
      running: 'Running\u2026',
      undo: 'Undo',
      undoing: 'Undoing\u2026',
      done: 'Done',
      loading: 'Loading\u2026',
    },
  },
  calendar: {
    today: 'Today',
    month: 'Month',
    week: 'Week',
    day: 'Day',
    allDay: 'All Day',
    newEvent: 'New event',
    moreEvents: '+{{count}} more',
    unscheduled: 'Unscheduled ({{count}})',
    loading: 'Loading calendar…',
    loadError: 'Error: {{message}}',
    configRequired: 'Calendar configuration required. Please specify startDateField, the calendar\'s one required key; the event title resolves without titleField.',
    configRequiredHint: 'It belongs on the view\'s calendar block. An interface page has no calendar slot of its own: point its sourceView at a view that declares one.',
    eventDetails: 'Event Details',
    pullToRefresh: 'Pull to refresh',
    refreshing: 'Refreshing…',
    onDate: 'On {{date}}',
    eventTitle: 'Title',
    eventTitlePlaceholder: 'What\'s this event about?',
    creating: 'Creating…',
    titleRequired: 'Title is required',
    a11y: {
      region: 'Calendar',
      grid: 'Calendar grid',
      goToToday: 'Go to today',
      previousPeriod: 'Previous period',
      nextPeriod: 'Next period',
      currentDate: 'Current date: {{date}}',
      dayCell: '{{date}}, {{count}} events',
      dayCell_one: '{{date}}, {{count}} event',
      dayCell_other: '{{date}}, {{count}} events',
      resizeEventEnd: 'Resize event end',
      resizeEventEndHint: 'Drag to change end date',
      resizeStart: 'Resize start',
      resizeEnd: 'Resize end',
    },
  },
  list: {
    loading: 'Loading records…',
    recordCount: '{{count}} records',
    recordCount_one: '{{count}} record',
    recordCount_other: '{{count}} records',
    addRecord: 'Add record',
    // objectui#12703 — the compact list's footer link to the object's list or the block's view.
    viewAll: 'View all',
    tabs: 'Tabs',
    allRecords: 'All Records',
    // objectui#13405 — the synthetic trailing tab a `showAllRecords` user-filter bar adds.
    userFilters: {
      allRecords: 'All records',
    },
    search: 'Search',
    filter: 'Filter',
    filterRecords: 'Filter Records',
    filterActive: 'Filter, {{count}} active',
    filterActive_one: 'Filter, {{count}} active',
    filterActive_other: 'Filter, {{count}} active',
    sort: 'Sort',
    sortRecords: 'Sort Records',
    sortByIdSuffix: '(by ID)',
    sortRelationalHint:
      'Columns that link to another record are not listed: they can only be sorted by the stored ID, not by the name shown in the cell. To sort by that name, denormalize it onto this object as a stored field, written when the source changes, and sort by that. Not a formula field: it is virtual, so no column is stored for it and the server refuses to sort by one.',
    sortRelationalPicked: 'A linked column sorts by the stored ID, not the name shown.',
    resetSortToDefault: 'Reset to view default',
    group: 'Group',
    groupBy: 'Group By',
    export: 'Export',
    exportAs: 'Export as {{format}}',
    color: 'Color',
    rowColor: 'Row Color',
    colorByField: 'Color by field',
    clear: 'Clear',
    none: 'None',
    hideFields: 'Hide fields',
    noItems: 'No items found',
    noItemsMessage: 'There are no records to display. Try adjusting your filters or adding new data.',
    firstRunTitle: 'Nothing here yet',
    firstRunMessage: 'Create your first record to get started.',
    noMatches: 'No matching records',
    noMatchesMessage: 'No records match your current filters or search. Try adjusting or clearing them.',
    viewFilterNoMatchesMessage: 'No records match this view’s filter.',
    loadErrorTitle: 'Couldn\u2019t load records',
    loadErrorMessage: 'Something went wrong while loading this data. Check your connection and try again.',
    loadErrorForbiddenTitle: 'You don\u2019t have access',
    loadErrorForbiddenMessage: 'You don\u2019t have permission to view these records. Contact your administrator if you think you should have access.',
    loadErrorUnauthorizedTitle: 'Sign in required',
    loadErrorUnauthorizedMessage: 'Your session has expired or you are signed out. Sign in again to view these records.',
    loadErrorRejectedTitle: 'This view’s query was rejected',
    loadErrorRejectedMessage: 'The server could not process this view’s filter or query options. Clearing the filters usually fixes it; if the view is saved this way, an administrator needs to correct it.',
    loadErrorApiDisabledTitle: 'This object isn’t available through the API',
    loadErrorApiDisabledMessage: 'This page can’t load its records because the object is not exposed through the API. That is a setting on the object itself, not a permission — an administrator has to enable API access for it before this page can work.',
    retry: 'Retry',
    managedBy: {
      system: {
        title: 'Nothing here yet',
        message:
          'Entries appear automatically when their source action runs (e.g. Submit for Approval, Share, Invite). Trigger one of those on a source record to create a row.',
      },
      appendOnly: {
        title: 'No events recorded',
        message:
          'This is an immutable audit log. Rows are written by the platform when events occur — you can export the history but cannot create entries from here.',
      },
      betterAuth: {
        title: 'No identity records',
        message:
          'These records are created by the authentication provider — through sign-in, provisioning, and security flows — not added by hand here.',
      },
      betterAuthUser: {
        title: 'No users yet',
        message:
          'User accounts are provisioned by the authentication provider, not created here. Invite teammates to your organization and they appear automatically on first sign-in (SSO just-in-time provisioning). App end-users arrive when they sign up through your app.',
      },
      betterAuthTeam: {
        title: 'No teams yet',
        message:
          'Teams group members within an organization. Create one with “Create Team”, or they arrive through your auth provider’s organization and SSO provisioning flows.',
      },
    },
    showAll: 'Show all',
    refresh: 'Refresh',
    pullToRefresh: 'Pull to refresh',
    refreshing: 'Refreshing…',
    share: 'Share',
    print: 'Print',
    hideFieldsTitle: 'Hide Fields',
    dataLimitReached: 'Showing first {{limit}} records. More data may be available.',
    display: 'Display',
    layout: 'Layout',
    rowNumbers: 'Row numbers',
    resetToViewDefault: 'Reset to view default',
    addGroup: 'Add group field',
    collapsedByDefault: 'Collapsed by default',
    removeGroup: 'Remove',
    inlineEditShort: 'Edit inline',
    inlineEditLabel: 'Edit records inline (click a cell to edit)',
  },
  managedByBadge: {
    config: {
      short: 'Admin config',
      title: 'Administrator configuration',
      body: 'These rows define how the platform behaves at runtime. Author them here; the runtime data they produce lives in a separate table.',
    },
    system: {
      short: 'System-managed',
      title: 'Managed by the platform',
      body: 'Rows here are created automatically when actions run on the source record. The list below is a read-only monitoring surface — row-level actions (Approve, Recall, Resend, …) live on each row.',
    },
    systemWritable: {
      short: 'Platform schema',
      title: 'Platform-defined, admin-writable',
      body: "This object's schema is defined by the platform, but its rows are yours to create and edit here. Who may write is governed by delegated administration and record-level security, not by this badge.",
    },
    appendOnly: {
      short: 'Read-only · Audit log',
      title: 'Read-only historical record',
      body: "Immutable audit log. Rows cannot be created, edited, or deleted from the UI — they're written by the platform when events occur. Use Export to download for compliance review.",
    },
    betterAuth: {
      short: 'Identity',
      title: 'Managed by the identity provider',
      body: "This object's schema is owned by {{provider}}. Direct edits bypass password hashing, session validation, two-factor checks, and audit hooks. Manage these records through your authentication provider's sign-in, invitation, and security flows instead.",
    },
  },
  kanban: {
    addCard: 'Add card',
    addColumn: 'Add column',
    moveCard: 'Move card',
    deleteCard: 'Delete card',
    deleteColumn: 'Delete column',
    noCards: 'No cards',
    columnCards: '{{column}} cards',
    laneCards: '{{column}} - {{lane}} cards',
    cardTitlePlaceholder: 'Enter card title…',
    uncategorized: 'Uncategorized',
    loadMore: 'Load more',
    columns: 'columns',
    requiredFieldsTitle: 'Complete required fields',
    requiredFieldsDescription: 'This move makes the fields below required. Fill them in to continue.',
    dnd: {
      start: 'Picked up {{card}} in {{column}}.',
      overCard: 'Moving {{card}} over {{target}} in {{column}}.',
      overColumn: 'Moving {{card}} over {{column}}.',
      overNone: 'Moving {{card}}. It is not over a column.',
      moved: 'Moved {{card}} to {{column}}.',
      dropped: 'Dropped {{card}}. It stays in {{column}}.',
      cancelled: 'Cancelled moving {{card}}. It stays in {{column}}.',
      untitledCard: 'an untitled card',
      unnamedColumn: 'an unnamed column',
      instructions: 'To move this card to another column, drag it with a pointer or by touch.',
      dragging: 'Dragging {{card}}',
    },
  },
  timeline: {
    bucket: {
      earlier: 'Earlier',
      today: 'Today',
      tomorrow: 'Tomorrow',
      thisWeek: 'This week',
      nextWeek: 'Next week',
      later: 'Later',
      noDate: 'No date',
      unassigned: 'Unassigned',
    },
    scale: {
      week: 'Week {{n}}',
      quarter: 'Q{{quarter}} {{year}}',
    },
    gantt: {
      rowLabel: 'Items',
      unusableRange: {
        malformedDate:
          'Unusable gantt date range — {{path}} is {{value}}, which is not a valid date. Every gantt date has to parse: the startDate and endDate on every row item, plus any minDate / maxDate pinned on the schema.',
        malformedRow:
          'Unusable gantt rows — {{path}} is {{value}}, which is not a row shape. A gantt draws items as a list of rows, every row as an object with a label and its own items, and every row\'s items as a list of bars; a null, a number, a string or a plain object in any of those places cannot be drawn.',
        inverted:
          'Unusable gantt date range — minDate {{minDate}} is after maxDate {{maxDate}}. A pinned minDate / maxDate overrides the range computed from the rows, so this axis has no columns and no bar can be placed on it; swap the two values.',
      },
    },
    unsupported: {
      objectBoundGantt: 'Unsupported variant "gantt" — an object-bound timeline renders the feed variants ({{variants}}). Gantt needs literal rows, each with its own nested items, so the gantt axis (scale) has no effect here.',
    },
    unconfigured: {
      noDateAxis: 'Timeline date axis required — this view declares no date field, and an object-bound timeline will not invent one. Declare one of: {{fields}}. The first is the spec spelling; the rest are legacy aliases.',
    },
  },
  gantt: {
    column: {
      taskName: 'Task Name',
      start: 'Start',
      end: 'End',
    },
    toolbar: {
      prevPeriod: 'Previous period',
      nextPeriod: 'Next period',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      jumpToToday: 'Jump to today',
      today: 'Today',
      thisWeek: 'This week',
      thisMonth: 'This month',
      showTaskList: 'Show task list',
      hideTaskList: 'Hide task list',
      viewMode: 'Timeline granularity',
      enterFullscreen: 'Enter fullscreen',
      exitFullscreen: 'Exit fullscreen',
      criticalPath: 'Highlight critical path',
      autoSchedule: 'Auto-schedule dependencies',
      exportPng: 'Export as PNG',
      exportPdf: 'Export PDF',
      saveLayout: 'Save layout',
      refresh: 'Refresh',
      undo: 'Undo',
      redo: 'Redo',
    },
    viewMode: {
      day: 'Day',
      week: 'Week',
      month: 'Month',
      quarter: 'Quarter',
      year: 'Year',
    },
    row: {
      expand: 'Expand',
      collapse: 'Collapse',
      open: 'Open details',
    },
    aria: {
      taskList: 'Task list',
      refreshing: 'Refreshing…',
    },
    tooltip: {
      days: 'd',
    },
    menu: {
      view: 'View details',
      edit: 'Edit inline',
      delete: 'Delete',
      addPredecessor: 'Add predecessor…',
      addSuccessor: 'Add successor…',
      removeDependency: 'Remove dependency',
      noCandidates: 'No available tasks',
      searchTasks: 'Search tasks…',
    },
    delete: {
      title: 'Delete this task?',
      body: '"{{title}}" will be permanently removed. This action cannot be undone.',
      cancel: 'Cancel',
      confirm: 'Delete',
      deleting: 'Deleting…',
    },
    drawer: {
      fallbackTitle: 'Task Details',
    },
    linkType: {
      fs: 'Finish → Start',
      ss: 'Start → Start',
      ff: 'Finish → Finish',
      sf: 'Start → Finish',
    },
    linkEnd: {
      start: 'start',
      end: 'end',
    },
    link: {
      rejected: {
        self: 'A task cannot depend on itself.',
        locked: 'This row is locked and cannot take a new dependency.',
        group: 'A summary row cannot take a dependency — link one of its tasks instead.',
        cycle: 'That link would create a circular dependency.',
      },
    },
    conflict: {
      title: 'Schedule conflict',
      body: 'This move conflicts with dependency constraints. Auto-reschedule {{count}} affected task(s)?',
      body_one: 'This move conflicts with dependency constraints. Auto-reschedule {{count}} affected task?',
      body_other: 'This move conflicts with dependency constraints. Auto-reschedule {{count}} affected tasks?',
      confirm: 'Auto-reschedule',
      cancel: 'Keep as is',
    },
    autoScheduleDlg: {
      title: 'Auto-schedule',
      body: 'Shift {{count}} task(s) later to satisfy dependency links?',
      body_one: 'Shift {{count}} task later to satisfy dependency links?',
      body_other: 'Shift {{count}} tasks later to satisfy dependency links?',
      skipped: '{{count}} locked task(s) also violate links and were skipped.',
      skipped_one: '{{count}} locked task also violates links and was skipped.',
      skipped_other: '{{count}} locked tasks also violate links and were skipped.',
      confirm: 'Apply',
      cancel: 'Cancel',
      none: 'All dependencies satisfied — nothing to reschedule.',
    },
    resource: {
      header: 'Resource',
      peak: 'Peak',
      over: 'overloaded',
      empty: 'No tasks to allocate.',
    },
    quickFilter: {
      all: 'All',
      clear: 'Clear filters',
      empty: 'No options',
      // SINGLE braces on purpose: the ObjectGantt call site resolves these
      // with a literal `.replace('{shown}', …)`, not i18next interpolation.
      // The last key in the gantt namespace on that idiom — `conflict.body`
      // and the two `autoScheduleDlg` counts moved to `{{count}}` + i18next
      // interpolation in objectui#4157, where the single-brace call site met
      // a `{{count}}` pack and rendered a literal `{2}`.
      resultSummary: 'Showing {shown} / {total} tasks',
    },
    readOnly: 'Read-only',
    readOnlyHint: 'Editing is disabled for this view.',
    lockedHint: 'No edit permission',
    writeFailed: 'Save failed — the change was rolled back',
  },
  view: {
    editViewConfig: 'Edit view config',
    rename: 'Rename',
    duplicateView: 'Duplicate View',
    shareView: 'Share View',
    setAsDefault: 'Set as Default',
    pinView: 'Pin View',
    unpinView: 'Unpin View',
    changeViewType: 'Change View Type',
    deleteView: 'Delete View',
    addView: 'Add View',
    unsavedChanges: 'Unsaved changes',
    saveAsView: 'Save as View',
    moreViews: '{{count}} more',
    activeFilters: 'Active filters',
    activeSort: 'Active sort',
    manageViews: 'Manage views',
    manageAllViews: 'Manage all views…',
    manageViewsDescription: 'Reorder, rename, pin, or delete every view in this object.',
    searchViews: 'Search views',
    addNewView: 'Add new view',
    done: 'Done',
    noViewsFound: 'No views match your search.',
    dragToReorder: 'Drag to reorder',
    defaultView: 'Default view',
    defaultBadge: 'default',
    tabActionsFor: 'View actions for {{name}}',
    readonlyAriaLabel: 'Read-only view',
    readonlyTooltip: 'System view — defined in code, read-only.',
    malformedFilter: 'This view’s filter is malformed, so no records are shown: the {{subject}} condition cannot be applied.',
    // objectui#11605 — an object-bound block whose node names its object in
    // neither place (no own key, no `dataSource.object`). `{{property}}` is the
    // block's object key (`objectName`), interpolated and never translated; the
    // wording was `element.number.noObject`'s with the property as a hole,
    // before objectui#11880 dropped that notice's flat `object`.
    noObject: 'No object named: set {{property}} or dataSource.object.',
  },
  detail: {
    back: 'Back',
    edit: 'Edit',
    editInline: 'Edit',
    save: 'Save',
    saveChanges: 'Save changes',
    saving: 'Saving…',
    editFieldsInline: 'Edit fields',
    editInlineHint: 'Double-click to edit',
    lockedByApproval: 'Locked for approval',
    lockedTooltip: 'This record has a pending approval request; editing is locked',
    writeStrippedTitle: 'Saved — but some fields did not take effect',
    writeWarningsTitle: 'Saved — with warnings',
    writeStrippedReadonly: 'Read-only, so it did not take effect: {{fields}}',
    writeStrippedByState: "Not editable in this record's current state, so it did not take effect: {{fields}}",
    writeStrippedPrimaryKey: "The record's identifier cannot be changed by a save, so it did not take effect: {{fields}}",
    writeStrippedComputed: 'Calculated by the server from a formula, so the value sent did not take effect: {{fields}}',
    writeStrippedStoredExpression: 'Computed from the record, so the computed value was saved instead of the one sent: {{fields}}',
    writeStrippedUnknownReason: 'Not applied by the server: {{fields}}',
    approvalPendingEditable: 'In approval · editable',
    approvalPendingTooltip: 'This record has a pending approval request; this step still allows editing',
    approvalProgress: 'Approvals — {{got}} of {{need}}',
    approvalProgressGroups: 'Sign-off — {{got}} of {{need}} groups',
    approvalProgressLabel: 'Approval progress',
    approvalsPanelTitle: 'Approvals',
    cancelApproval: 'Recall approval',
    cancelApprovalInFlight: 'Recalling…',
    cancelApprovalTooltip: 'Recall the pending approval request to unlock this record',
    cancelApprovalTooltipUnlocked: 'Recall the pending approval request',
    cancelApprovalFailed: 'Failed to recall approval',
    cancelApprovalUnavailable: 'Recalling approvals is not supported on this data source',
    // objectui#5916 — `record:path` stage state in the ACCESSIBLE NAME.
    // Each stage is a `role="listitem"`, which is name-from-AUTHOR only, so
    // visually-hidden text inside it computes to an EMPTY name; these compose
    // the stage's own (already picklist-localized) label with its state into the
    // `aria-label`. The ✓/✗ glyphs stay `aria-hidden` decoration.
    pathLabel: 'Record path',
    pathStageCompleted: '{{stage}}, completed',
    pathStageCurrent: '{{stage}}, current stage',
    pathStageUpcoming: '{{stage}}, upcoming',
    pathStageLostCurrent: '{{stage}}, closed lost, current stage',
    pathStageLostUpcoming: '{{stage}}, closed lost, not reached',
    pathStageWonUpcoming: '{{stage}}, goal stage, not reached',
    linkCopied: 'Link copied to clipboard',
    commentFailed: 'Your comment was not posted. Nothing was saved — please try again.',
    reactionFailed: 'Your reaction was not saved. Please try again.',
    // objectui#12268 — the author's Edit and Delete on their own comment in the
    // record feed: the two buttons' names, the delete confirm, and the two
    // refusals the record page raises.
    editComment: 'Edit comment',
    deleteComment: 'Delete comment',
    deleteCommentConfirm: 'Are you sure you want to delete this comment?',
    commentEditFailed: 'Your edit was not saved. The comment keeps its previous text.',
    commentDeleteFailed: 'The comment was not deleted. Please try again.',
    linkCopyFailed: 'Failed to copy link',
    cancel: 'Cancel',
    cancelEdit: 'Discard changes',
    sectionMoreDetails: 'More details',
    // Concurrent update (OCC) dialog
    concurrentUpdateTitle: 'This record was modified by someone else',
    concurrentUpdateDescription: 'Another user saved a newer version of {{field}} while you were editing. To prevent silently overwriting their change, please choose how to resolve the conflict.',
    concurrentUpdateYourEdit: 'Your edit',
    concurrentUpdateCurrentValue: 'Current value',
    concurrentUpdateUpdatedBy: 'Updated by {{name}}',
    concurrentUpdateUpdatedAt: 'Updated at {{when}}',
    concurrentUpdateReload: 'Reload latest',
    concurrentUpdateOverwrite: 'Overwrite anyway',
    concurrentUpdateCancel: 'Cancel',
    concurrentUpdateRecordLabel: 'this record',
    openInNewTab: 'Open in new tab',
    share: 'Share',
    duplicate: 'Duplicate',
    export: 'Export',
    viewHistory: 'View history',
    delete: 'Delete',
    moreActions: 'More actions',
    addReaction: 'Add reaction',
    pageHeaderActions: 'Page header actions',
    emojiPicker: 'Emoji picker',
    reactionCount: '{{emoji}} {{count}} reactions',
    reactionCount_one: '{{emoji}} {{count}} reaction',
    reactionCount_other: '{{emoji}} {{count}} reactions',
    // Record-overlay chrome (objectstack#5506). `recordDetail` is the VISIBLE
    // heading the overlay falls back to when the host passes no title;
    // `openAsFullPage` is the icon-only expand button's default accessible
    // name; `recordDetailOverlay` is the sr-only description on the
    // Sheet/Dialog when the host supplies none.
    recordDetail: 'Record Detail',
    // Same heading, but for the hosts that DO know which object they are
    // showing (objectui#3426): `ListView` / `ObjectGrid` used to string-build
    // `` `${label} Detail` `` in TypeScript and hand it to the overlay's
    // `title` prop, so `recordDetail` above never got a chance to apply and a
    // non-English session read one English heading. Interpolating keeps the
    // object label in the heading without freezing English word order — a pack
    // whose qualifier trails the noun (de: a hyphenated compound) or that needs
    // a possessive particle (ja/zh) writes its own arrangement here.
    recordDetailWithLabel: '{{label}} Detail',
    openAsFullPage: 'Open as full page',
    recordDetailOverlay: 'Record detail overlay for {{title}}.',
    addToFavorites: 'Add to favorites',
    removeFromFavorites: 'Remove from favorites',
    previousRecord: 'Previous record',
    nextRecord: 'Next record',
    recordOf: '{{current}} of {{total}}',
    recordNotFound: 'Record not found',
    recordNotFoundDescription: 'The record you are looking for does not exist or may have been deleted.',
    goBack: 'Go back',
    details: 'Details',
    related: 'Related',
    relatedRecords: '{{count}} records',
    relatedRecordOne: '{{count}} record',
    noRelatedRecords: 'No related records found',
    loading: 'Loading…',
    copyToClipboard: 'Copy to clipboard',
    copied: 'Copied!',
    deleteConfirmation: 'Are you sure you want to delete this record?',
    deleted: 'Record deleted',
    editRecord: 'Edit record',
    viewAll: 'View All',
    new: 'New',
    add: 'Add',
    activity: 'Activity',
    history: 'History',
    historyEmpty: 'No history yet',
    editRow: 'Edit',
    deleteRow: 'Delete',
    deleteRowConfirmation: 'Are you sure you want to delete "{{name}}"?',
    deleteRowTitle: 'Delete record',
    actions: 'Actions',
    previousPage: 'Previous',
    nextPage: 'Next',
    pageOf: 'Page {{current}} of {{total}}',
    sortBy: 'Sort by',
    filterPlaceholder: 'Filter…',
    highlightFields: 'Key Fields',
    highlightsLabel: 'Record highlights',
    // Comments
    comments: 'Comments',
    searchComments: 'Search comments…',
    addCommentPlaceholder: 'Add a comment… (Ctrl+Enter to submit)',
    noMatchingComments: 'No matching comments',
    noCommentsYet: 'No comments yet',
    pinned: 'Pinned',
    pin: 'Pin',
    unpin: 'Unpin',
    justNow: 'just now',
    minutesAgo: '{{count}}m ago',
    minutesAgo_one: '{{count}}m ago',
    minutesAgo_other: '{{count}}m ago',
    hoursAgo: '{{count}}h ago',
    hoursAgo_one: '{{count}}h ago',
    hoursAgo_other: '{{count}}h ago',
    daysAgo: '{{count}}d ago',
    daysAgo_one: '{{count}}d ago',
    daysAgo_other: '{{count}}d ago',
    // Activity feed actors
    systemActor: 'System',
    unknownUser: 'Unknown',
    // Record meta footer (audit provenance). `created`/`updated` are the
    // actor-less variants — "Created by · 5m ago" dangles when created_by
    // is null (system/seeded rows), so the footer falls back to these.
    createdBy: 'Created by',
    updatedBy: 'Updated by',
    created: 'Created',
    updated: 'Updated',
    // Attachments
    dropFilesToUpload: 'Drop files here or click to upload',
    attachmentCount: '{{count}} attachment',
    attachmentCount_one: '{{count}} attachment',
    attachmentCount_other: '{{count}} attachments',
    removeAttachment: 'Remove attachment',
    // Record Attachments panel (enable.files, objectstack#4358)
    attachments: 'Attachments',
    uploadAttachment: 'Upload',
    loadingAttachments: 'Loading attachments…',
    noAttachments: 'No attachments yet. Upload a file to get started.',
    downloadAttachment: 'Download',
    deleteAttachment: 'Delete attachment',
    deleteAttachmentConfirm: 'Are you sure you want to delete the attachment "{{name}}"?',
    attachmentDeleteDenied: 'Only the uploader or someone who can edit this record may delete this attachment.',
    attachmentParentAccessDenied: "You don't have access to attach files to this record.",
    attachmentDownloadDenied: "You don't have access to download this attachment.",
    attachmentAuthRequired: 'Please sign in to download this attachment.',
    attachmentPermissionDenied: "You don't have permission to do that.",
    attachmentsAccessDenied: "You don't have access to these attachments.",
    attachmentsLoadFailed: "We couldn't load the attachments for this record.",
    attachmentsApiUnavailable: 'The attachments list is not available on this object.',
    retryLoadAttachments: 'Retry',
    // Discussion
    discussion: 'Discussion',
    showDiscussion: 'Show Discussion ({{count}})',
    hideDiscussion: 'Hide discussion',
    // Rich text editor
    bold: 'Bold (Ctrl+B)',
    italic: 'Italic (Ctrl+I)',
    listFormat: 'List',
    inlineCode: 'Inline code',
    mentionSomeone: 'Mention someone',
    preview: 'Preview',
    submitComment: 'Submit (Ctrl+Enter)',
    sendComment: 'Send',
    writeComment: 'Write a comment…',
    // Subscription
    subscribedTooltip: 'Subscribed — click to unsubscribe',
    unsubscribedTooltip: 'Subscribe to notifications',
    // The reference rail's empty related-record list
    noRecords: 'No records',
    // objectui#3863 — the BASE key; since objectui#11432 every pack also spells out
    // each CLDR category its language selects, so with a count no pack reaches the
    // base. In `en` this value is parity ballast — and it must stay byte-identical to
    // the call site's inline `defaultValue` in `record-reference-rail.tsx`, which
    // `check:i18n-keys` now judges as class 3.
    showEmptyRelated: '+ {{count}} empty',
    showEmptyRelated_one: '+ {{count}} empty',
    showEmptyRelated_other: '+ {{count}} empty',
    // Activity timeline
    allActivity: 'All Activity',
    commentsOnly: 'Comments Only',
    fieldChangesFilter: 'Field Changes',
    tasksOnly: 'Tasks Only',
    leaveCommentPlaceholder: 'Leave a comment… (Ctrl+Enter to submit)',
    noActivity: 'No activity recorded',
    activityAccessDenied: "You don't have permission to view activity on this record.",
    commentsAccessDenied: "You don't have permission to view comments on this record.",
    // objectui#7149 — the rest of `ActivityTimeline`. The four chip labels the
    // `detail.*` pack did not already name, and the `formatFieldChange`
    // sentences, which are assembled in code and so need interpolation holes.
    allFilter: 'All',
    createsFilter: 'Creates',
    deletesFilter: 'Deletes',
    statusChangesFilter: 'Status Changes',
    activityEmptyValue: '(empty)',
    activityFieldChanged: 'Changed {{field}} from "{{old}}" to "{{new}}"',
    activityCreated: 'Created this record',
    activityDeleted: 'Deleted this record',
    activityStatusChanged: 'Changed status to "{{value}}"',
    activityUpdated: 'Updated record',
    loadMore: 'Load more',
    edited: '(edited)',
    via: 'via {{source}}',
    viewSource: 'View source',
    // Replies
    replyCount: '{{count}} reply',
    replyCount_one: '{{count}} reply',
    replyCount_other: '{{count}} replies',
    replyPlaceholder: 'Reply…',
    // Aria labels
    filterActivity: 'Filter activity',
    openDiscussion: 'Open discussion panel',
    closeDiscussion: 'Close discussion panel',
    subscribeAriaLabel: 'Subscribe to notifications',
    unsubscribeAriaLabel: 'Unsubscribe from notifications',
    clearSearch: 'Clear search',
    copyEmail: 'Copy email',
    copyPhone: 'Copy phone number',
    copyRecordId: 'Copy record ID',
    showEmptyFields: 'Show {{count}} empty fields',
    showEmptyFields_one: 'Show {{count}} empty field',
    showEmptyFields_other: 'Show {{count}} empty fields',
    hideEmptyFields: 'Hide empty fields',
    noValue: 'No value',
    unresolvedReference: 'Unresolved reference: {{value}} was not resolved to a user',
    unresolvedLookupReference: 'Unresolved reference: {{value}} was not resolved to a record on this screen',
    restrictedLookupReference: 'Restricted record',
    // Cell-level COUNT phrases for the `repeater` and file cells
    // (objectui#8441). Both were written straight into the renderer before this
    // — `repeater` as a number plus a hardcoded Chinese unit word, which every
    // reader on every locale saw, and `FileCellRenderer` as an English-only
    // `count === 1 ? 'file' : 'files'`, which is not plural-safe anywhere else.
    // One channel, two call sites.
    //
    // REAL i18next plural families — the one count shape this repo uses since
    // objectui#11445 retired the code-selected `xxxCountOne` / `xxxCountPlural`
    // sibling keys. i18next asks `Intl.PluralRules` for the
    // ONE suffix a number needs, so each pack carries every category its language
    // selects (`ru` `_few`/`_many`, `ar` `_zero`/`_two`/`_few`/`_many` —
    // objectui#11432) plus the base key (objectui#3863).
    // `all-locales-key-parity.test.ts` owns both rules.
    repeaterItemCount: '{{count}} items',
    repeaterItemCount_one: '{{count}} item',
    repeaterItemCount_other: '{{count}} items',
    fileCount: '{{count}} files',
    fileCount_one: '{{count}} file',
    fileCount_other: '{{count}} files',
  },
  chart: {
    loading: 'Loading chart…',
    refreshing: 'Refreshing…',
    nullCategory: '(None)',
    // The refusal a scatter renders when handed more than one series
    // (objectui#7194): it binds ONE measure, so a second series was painted at
    // the first one's y values. One short sentence on purpose — this pack is
    // eagerly loaded and the `framework` chunk's gzip ceiling has ~0.2 KB of
    // headroom; the series keys are rendered by the chart as data, after it.
    scatterOneMeasure: 'A scatter plots one measure. Keep exactly one series:',
    // The note under a sankey that drew only some of its rows (objectui#7148,
    // translated by objectui#13404): a flow has no negative width, so rows whose
    // measure is not above zero are left out. A count family on the OMITTED
    // rows; `{{field}}` is where the chart draws the measure key as a code chip.
    sankeyOmittedRows: 'Showing {{shown}} of {{total}} rows — {{count}} rows have no {{field}} above zero, which a flow cannot draw.',
    sankeyOmittedRows_one: 'Showing {{shown}} of {{total}} rows — {{count}} row has no {{field}} above zero, which a flow cannot draw.',
    sankeyOmittedRows_other: 'Showing {{shown}} of {{total}} rows — {{count}} rows have no {{field}} above zero, which a flow cannot draw.',
    // The refusal an object-bound chart renders when it declares no category
    // axis (objectui#8168) — `aggregate.groupBy` / `xAxisKey` / `xAxis.field`
    // all absent, so `runAggregate` would have grouped on a name nobody wrote.
    // The twin of `timeline.unconfigured.noDateAxis`. ONE short sentence, for
    // the same reason `scatterOneMeasure` above is one: the packs ship it ten
    // times, and the binding names are rendered by the component after it
    // rather than interpolated, so a rung added to or retired from the
    // resolver cannot leave this sentence naming a stale vocabulary.
    unconfigured: {
      noCategoryAxis: 'Chart category axis required — an object-bound chart will not invent one. Declare one of:',
    },
  },
  report: {
    total: 'Total',
    rowTotal: 'Row Total',
    columnTotal: 'Column Total',
    grandTotal: 'Grand Total',
    totals: 'Totals',
    rowsLabel: 'Row',
    columnsLabel: 'Column',
    allLabel: '(All)',
    emptyLabel: '(Empty)',
    loading: 'Loading…',
    failedToLoad: 'Failed to load matrix: {{message}}',
    needsAcross: 'Matrix report requires at least one `groupingsAcross` field.',
    // objectui#12330 — the report's no-access state; its title is `dashboard.widgetForbiddenTitle`.
    forbiddenMessage: 'You don’t have permission to view the data behind this report.',
    aggregate: {
      count: 'Count',
      countDistinct: 'Distinct Count',
      sum: 'Sum',
      avg: 'Average',
      min: 'Min',
      max: 'Max',
      first: 'First',
    },
    editor: {
      // ONE key by design, not by accident (objectui#4145). This namespace held
      // 106 keys labelling the hand-rolled report editor form; that form is gone
      // — `ReportConfigPanel`'s body is `ReportDefaultInspector`, a spec-driven
      // inspector whose labels come from the report spec's own metadata. The
      // other 105 keys had no reader in any package, in any pack, in any dynamic
      // `t()` form, so they were retired here rather than left for the next
      // author to infer a live UI from.
      //
      // `panelTitle` names the PANEL (its heading and its `role="complementary"`
      // landmark). It is minted by objectui#4137 and is the namespace's only
      // consumer. Do not grow this namespace back: the spec-driven inspector is
      // the settled direction, and
      // `packages/i18n/src/__tests__/report-editor-retired-4145.test.ts` fails on
      // any retired key that returns.
      panelTitle: 'Edit report',
    },
  },
  designer: {
    undo: 'Undo',
    redo: 'Redo',
    canvasMinimap: 'Canvas minimap',
    versionHistory: 'Version history',
  },
  dashboard: {
    addWidget: 'Add widget',
    editLayout: 'Edit layout',
    saveLayout: 'Save layout',
    resetLayout: 'Reset layout',
    total: 'Total',
    noDataSourceFor: 'No data source available for',
    // objectui#7063 — the DEFAULT empty state every dashboard widget renders
    // when its query SUCCEEDED and returned nothing. It replaced the terse
    // per-widget `noRows` / `noDataAvailable` fragments at the render site;
    // objectui#7125 deleted those two keys from all ten packs once nothing
    // read them. The copy here has to read as a state rather than a failure,
    // which is why it says the widget loaded. `sourceLabel` carries its own
    // punctuation so the call site concatenates no separator (see
    // `WidgetEmptyState`).
    empty: {
      title: 'No data yet',
      message: 'This widget loaded successfully and its query returned no records yet.',
      sourceLabel: 'Source:',
    },
    loading: 'Loading…',
    refreshing: 'Refreshing…',
    refreshAll: 'Refresh All',
    refreshDashboard: 'Refresh dashboard',
    pickMeasures: 'Pick measures (values) for this dataset widget.',
    datasetUnsupported: 'This data source does not support dataset queries.',
    widgetForbiddenTitle: 'You don’t have access',
    widgetForbiddenMessage: 'You don’t have permission to view the data behind this widget.',
    details: 'Details',
    exportCsv: 'Export CSV',
    openInList: 'Open in list',
    config: {
      breadcrumb: {
        dashboard: 'Dashboard',
        configuration: 'Configuration',
        widget: 'Widget',
        chart: 'Chart',
        table: 'Table',
        pivotTable: 'Pivot table',
      },
      section: {
        general: 'General',
        layout: 'Layout',
        data: 'Data',
        dataBinding: 'Data Binding',
        appearance: 'Appearance',
      },
      field: {
        title: 'Title',
        description: 'Description',
        columns: 'Columns',
        gap: 'Gap',
        rowHeight: 'Row height (px)',
        autoRefresh: 'Auto refresh',
        showDescription: 'Show description',
        theme: 'Theme',
        widgetType: 'Widget type',
        colorVariant: 'Color variant',
        dataset: 'Dataset',
        dimensions: 'Dimensions',
        values: 'Values',
        width: 'Width (columns)',
        height: 'Height (rows)',
      },
      placeholder: {
        dashboardTitle: 'Dashboard title',
        dashboardDescription: 'Short summary shown under the title',
        widgetTitle: 'Widget title',
        widgetDescription: 'Widget description',
        datasetName: 'Dataset name',
        selectDataset: 'Select dataset…',
        searchDatasets: 'Search datasets…',
        addDimension: 'Add dimension…',
        addMeasure: 'Add measure…',
        searchMembers: 'Search…',
      },
      empty: {
        datasets: 'No datasets found.',
        dimensions: 'No dimensions selected.',
        measures: 'No measures selected.',
        nothingToAdd: 'Nothing left to add.',
      },
      help: {
        dataset: 'The semantic-layer dataset this widget binds to (ADR-0021).',
        dimensions: 'Group/split the values by these dataset dimensions.',
        dimensionsPivot: 'Group/split fields. The last dimension spreads across as columns.',
        values: 'Measure(s) from the dataset to display (at least one).',
      },
      action: {
        add: 'Add',
        remove: 'Remove {{name}}',
      },
      refresh: {
        off: 'Off',
        every30s: 'Every 30s',
        every1m: 'Every 1 min',
        every5m: 'Every 5 min',
        every15m: 'Every 15 min',
        every30m: 'Every 30 min',
        every1h: 'Every 1 hour',
      },
      themeOption: {
        light: 'Light',
        dark: 'Dark',
        auto: 'Auto',
      },
      widgetType: {
        metric: 'Metric',
        bar: 'Bar Chart',
        horizontalBar: 'Horizontal Bar',
        line: 'Line Chart',
        pie: 'Pie Chart',
        donut: 'Donut Chart',
        area: 'Area Chart',
        scatter: 'Scatter Plot',
        funnel: 'Funnel',
        table: 'Table',
        pivot: 'Pivot Table',
      },
      color: {
        default: 'Default',
        blue: 'Blue',
        teal: 'Teal',
        orange: 'Orange',
        purple: 'Purple',
        success: 'Success',
        warning: 'Warning',
        danger: 'Danger',
      },
    },
    trend: {
      vsLastQuarter: 'vs last quarter',
      vsLastMonth: 'vs last month',
      vsLastWeek: 'vs last week',
      vsLastYear: 'vs last year',
      vsYesterday: 'vs yesterday',
      vsPreviousPeriod: 'vs previous period',
    },
    filters: {
      label: 'Dashboard filters',
      dateRange: 'Date range',
      allTime: 'All time',
      custom: 'Custom…',
      all: 'All',
      reset: 'Reset',
      range: {
        today: 'Today',
        yesterday: 'Yesterday',
        this_week: 'This week',
        last_week: 'Last week',
        this_month: 'This month',
        last_month: 'Last month',
        this_quarter: 'This quarter',
        last_quarter: 'Last quarter',
        this_year: 'This year',
        last_year: 'Last year',
        last_7_days: 'Last 7 days',
        last_30_days: 'Last 30 days',
        last_90_days: 'Last 90 days',
      },
    },
  },
  appDesigner: {
    createApp: 'Create Application',
    editApp: 'Edit Application',
    basicInfo: 'Basic Info',
    objects: 'Objects',
    navigation: 'Navigation',
    branding: 'Branding',
    appName: 'App Name',
    appTitle: 'Title',
    appDescription: 'Description',
    appIcon: 'Icon',
    template: 'Template',
    selectObjects: 'Select Objects',
    searchObjects: 'Search objects…',
    selectAll: 'Select All',
    deselectAll: 'Deselect All',
    navBuilder: 'Navigation Builder',
    addGroup: 'Add Group',
    addUrl: 'Add URL',
    addSeparator: 'Add Separator',
    logoUrl: 'Logo URL',
    primaryColor: 'Primary Color',
    faviconUrl: 'Favicon URL',
    preview: 'Preview',
    complete: 'Complete',
    snakeCaseHint: 'Must be snake_case (e.g. my_app)',
    modeEdit: 'Edit',
    modePreview: 'Preview',
    modeCode: 'Code',
    addWidget: 'Add Widget',
    widgetProperties: 'Widget Properties',
    dataSource: 'Data Source',
    valueField: 'Value Field',
    aggregate: 'Aggregate',
    colorVariant: 'Color Variant',
    addComponent: 'Add Component',
    componentProperties: 'Component Properties',
    viewType: 'View Type',
    fields: 'Fields',
    toolbar: 'Toolbar',
    showSearch: 'Show Search',
    showFilters: 'Show Filters',
    showSort: 'Show Sort',
    appearance: 'Appearance',
    rowHeight: 'Row Height',
    livePreview: 'Live Preview',
    stepBasicDesc: 'Name, title, and icon',
    stepObjectsDesc: 'Select business objects',
    stepNavigationDesc: 'Build navigation tree',
    stepBrandingDesc: 'Logo, colors, and favicon',
    noObjectsFound: 'No objects found.',
    noNavItemsHint: 'No navigation items yet. Select objects in the previous step or add items manually.',
    separatorLabel: '— Separator —',
    newGroup: 'New Group',
    newLink: 'New Link',
    saveDraft: 'Save Draft',
    cancelConfirmTitle: 'Discard changes?',
    cancelConfirmMessage: 'You have unsaved changes. Are you sure you want to cancel?',
    confirmDiscard: 'Discard',
    keepEditing: 'Keep Editing',
    navNoItems: 'No navigation items. Click buttons above to add items.',
    navNoPreviewItems: 'No items',
    navLivePreview: 'Live Preview',
    navCollapseGroup: 'Collapse group',
    navExpandGroup: 'Expand group',
    navAddChild: 'Add child',
    navMoveUp: 'Move up',
    navMoveDown: 'Move down',
    navRemove: 'Remove',
    navObjectPage: 'Object Page',
    navDashboard: 'Dashboard',
    navPage: 'Page',
    navReport: 'Report',
    navGroup: 'Group',
    navUrl: 'URL',
    navSeparator: 'Separator',
    navTypeObject: 'Object',
    navTypeDashboard: 'Dashboard',
    navTypePage: 'Page',
    navTypeReport: 'Report',
    navTypeUrl: 'URL',
    navTypeGroup: 'Group',
    navTypeSeparator: 'Separator',
    navTypeAction: 'Action',
    navTypeComponent: 'Component',
    navTypeDoc: 'Doc',
    navEditIcon: 'Edit icon',
    navToggleVisible: 'Toggle visibility',
    navHidden: 'Hidden',
    navExportSchema: 'Export JSON',
    navImportSchema: 'Import JSON',
    navExportSuccess: 'Navigation schema exported',
    navImportSuccess: 'Navigation schema imported',
    navImportError: 'Invalid navigation JSON',
    navIconPlaceholder: 'Icon name (e.g. Users)',
    dashboardEditor: 'Dashboard Editor',
    noWidgets: 'No widgets. Click a button above to add one.',
    widgetLayoutSize: 'Layout Size',
    widgetWidth: 'Width',
    widgetHeight: 'Height',
    dashboardPreview: 'Dashboard Preview',
    noWidgetsPreview: 'No widgets to preview',
    pageCanvasEditor: 'Page Canvas Editor',
    emptyPage: 'Empty page. Click a button above to add a component.',
    pagePreview: 'Page Preview',
    noComponentsPreview: 'No components to preview',
    modePage: 'Page',
    modeDashboard: 'Dashboard',
    undo: 'Undo',
    redo: 'Redo',
    brandingEditor: 'Branding Editor',
    brandingExport: 'Export JSON',
    brandingImport: 'Import JSON',
    brandingPreview: 'Preview',
    brandingSampleButton: 'Sample Button',
    brandingSampleText: 'This is how your brand theme will look.',
    colorPalette: 'Color Palette',
    fontFamily: 'Font Family',
    fontDefault: 'Default (System)',
    modeLight: 'Light',
    modeDark: 'Dark',
    mobilePreview: 'Mobile Preview',
    objectManager: {
      title: 'Object Manager',
      addObject: 'New Object',
      searchPlaceholder: 'Search objects…',
      noObjects: 'No objects found.',
      objectName: 'API Name',
      objectLabel: 'Label',
      pluralLabel: 'Plural Label',
      icon: 'Icon',
      selectIcon: 'Select icon…',
      group: 'Group',
      noGroup: 'No Group',
      sortOrder: 'Sort Order',
      enabled: 'Enabled',
      relationships: 'Relationships',
      systemBadge: 'System',
      fieldCount: '{{count}} fields',
      ungrouped: 'Ungrouped',
      deleteConfirmTitle: 'Delete Object?',
      deleteConfirmMessage: 'This will permanently delete the object and all its fields. This action cannot be undone.',
    },
    fieldDesigner: {
      title: 'Field Designer',
      addField: 'New Field',
      searchPlaceholder: 'Search fields…',
      allTypes: 'All Types',
      noFields: 'No fields found.',
      fieldName: 'API Name',
      fieldLabel: 'Label',
      fieldType: 'Type',
      fieldGroup: 'Group',
      description: 'Description',
      required: 'Required',
      unique: 'Unique',
      readOnly: 'Read Only',
      hidden: 'Hidden',
      externalId: 'External ID',
      trackHistory: 'Track History',
      defaultValue: 'Default Value',
      placeholder: 'Placeholder',
      referenceTo: 'Reference To',
      options: 'Options',
      addOption: 'Add Option',
      systemBadge: 'System',
      ungrouped: 'General',
      deleteConfirmTitle: 'Delete Field?',
      deleteConfirmMessage: 'This will permanently delete the field. Existing data in this field will be lost.',
      basicSection: 'Basic',
      typeSpecificSection: 'Type Settings',
      advancedSection: 'Advanced',
      typeCategory: {
        text: 'Text',
        number: 'Number',
        date: 'Date & Time',
        choice: 'Choice',
        relation: 'Relation',
        advanced: 'Advanced',
      },
    },
  },
  console: {
    // The fixed crumb `AppHeader`'s `studio` variant draws on the Studio front
    // door (objectui#11863), as `organizations.title` is the `orgs` variant's.
    // A product name, which every pack writes as is.
    studio: {
      title: 'Studio',
      // What a principal without `studio.access` reads at the Studio URL they
      // opened (objectui#12035), in place of the silent redirect home.
      accessRequired: 'You need Studio access to open Studio.',
    },
    saveAdvisoryTitle: 'Saved — the authoring check raised {{count}} advisory finding(s)',
    saveAdvisoryTitle_one: 'Saved — the authoring check raised {{count}} advisory finding',
    saveAdvisoryTitle_other: 'Saved — the authoring check raised {{count}} advisory findings',
    publishAdvisoryTitle: 'Published — the authoring check raised {{count}} advisory finding(s)',
    publishAdvisoryTitle_one: 'Published — the authoring check raised {{count}} advisory finding',
    publishAdvisoryTitle_other: 'Published — the authoring check raised {{count}} advisory findings',
    importMappingsUnavailable: 'Saved import mappings for {{object}} could not be loaded',
    importMappingsRefused: 'The server refused this request, so this list is empty because it could not be read — not because nothing is registered. Sign in again, or ask an administrator for access.',
    importMappingsUnreadable: 'This list is empty because it could not be read, not because nothing is registered. Try again, and report this if it keeps happening.',
    savedViewsUnavailable: 'Saved views for {{object}} could not be loaded',
    savedViewsRefused: 'The server refused this request, so this list is empty because it could not be read — not because this object has no saved views. Sign in again, or ask an administrator for access.',
    savedViewsUnreadable: 'This list is empty because it could not be read, not because this object has no saved views. Try again, and report this if it keeps happening.',
    title: 'ObjectOS',
    initializing: 'Opening your console…',
    skipToContent: 'Skip to content',
    search: 'Search…',
    breadcrumb: {
      system: 'System',
      // The Setup system page segment after `System` (objectui#10900).
      marketplace: 'Marketplace',
      // The console app's own `system/*` pages after `System` (objectui#10969).
      settings: 'Settings',
      apps: 'Apps',
      profile: 'Profile',
      approvals: 'Approvals',
      aiApprovals: 'AI Approvals',
      auditLog: 'Audit Log',
    },
    nav: {
      pinItem: 'Pin {{name}}',
      unpinItem: 'Unpin {{name}}',
      favorites: 'Favorites',
      launcherLabel: 'App launcher',
      menuLabel: 'App navigation',
      menuEmpty: 'This app has no navigation entries you can open.',
      // objectui#12427 — the ⋯ menu a sidebar entry shows on hover (`SidebarItemMenu`).
      itemMenu: 'More actions for {{name}}',
      openInNewTab: 'Open in new tab',
      copyLink: 'Copy link',
      linkCopied: 'Link copied to clipboard',
      linkCopyFailed: 'Failed to copy link',
      design: 'Design',
    },
    settingsHub: {
      title: 'Settings',
      subtitle: 'Configure your system, integrations, and feature flags.',
      loadError: 'Failed to load settings',
      empty: 'No settings registered. Plugins can register settings manifests via the SettingsService.',
      settingsCount: '{{n}} settings',
      beta: 'Beta',
      // Section headers, keyed by the manifest `category` value. Unknown
      // (plugin-authored) categories fall back to the literal category string.
      categories: {
        Workspace: 'General',
        Communication: 'Communication',
        Security: 'Security',
        Infrastructure: 'Infrastructure',
        Beta: 'Beta',
        Other: 'Other',
      },
    },
    // The single-namespace settings screen (objectui#4024). Placed beside
    // `settingsHub` deliberately: `SettingsView.tsx` and `SettingsHub.tsx` are
    // the same feature in the same directory, and the view was the one file
    // written against a different convention — every string below was a
    // hardcoded English literal while its sibling resolved through the bundle.
    //
    // `useSettingsLabel` already translates the manifest-authored CONTENT
    // (title, description, field labels), so a plugin author could translate
    // what is INSIDE a settings namespace but had no key reaching the chrome
    // around it — a zh-CN admin read translated field labels inside an English
    // save bar.
    settingsView: {
      backToHub: 'All settings',
      back: 'Back',
      noNamespace: 'No namespace selected.',
      loadError: 'Failed to load settings',
      saved: 'Settings saved',
      saveFailed: 'Save failed',
      // Parameterized, never concatenated: `{{key}}` is spliced into the
      // sentence so a pack can put the key where its own grammar wants it.
      lockedByEnv: 'Locked by environment: {{key}}',
      // The server named no key — the same refusal without a subject.
      lockedByEnvNoKey: 'Locked by environment',
      actionSucceeded: 'Action succeeded',
      actionFailed: 'Action failed',
      discard: 'Discard',
      saveChanges: 'Save changes',
      // Save-bar counter. A REAL i18next plural family, not an English-only
      // `change(s)`.
      //
      // i18next asks `Intl.PluralRules` for the one suffix a language needs, so
      // each pack spells out every category its language selects — `ru` has
      // four, `ar` six (objectui#11432) — and keeps the base key
      // (objectui#3863). `all-locales-key-parity.test.ts` owns both rules.
      unsavedCount: '{{count}} unsaved changes',
      unsavedCount_one: '{{count}} unsaved change',
      unsavedCount_other: '{{count}} unsaved changes',
      // The toast of a save the server refused field by field (objectui#13146).
      // `{{settings}}` is the refused settings' labels, as their rows draw them,
      // joined with `validation.formInvalidJoiner`; each row shows its own
      // reason, so the toast names the settings and gives no reason.
      fieldErrorsToast: '{{count}} settings need attention: {{settings}}',
      fieldErrorsToast_one: '{{count}} setting needs attention: {{settings}}',
      fieldErrorsToast_other: '{{count}} settings need attention: {{settings}}',
      // The fail-closed crypto refusal (objectstack#8396). objectui#4579 added
      // these as English literals on purpose — routing one string through i18n
      // would have left a single translated string among a dozen hardcoded
      // ones — and deferred them to this card, which converts the screen whole.
      cryptoRefusalTitle: 'This deployment cannot encrypt secrets',
      // `{{subject}}` is rendered as a `< code >` element by the view, so the
      // sentence is split around it rather than interpolated.
      cryptoRefusalSubjectSuffix: 'is declared encrypted, so nothing was written.',
      cryptoRefusalNoSubject: 'The declared-encrypted value was refused, so nothing was written.',
      cryptoRefusalToast: 'Cannot encrypt secrets: {{subject}}',
      cryptoRefusalToastNoSubject: 'Cannot encrypt secrets',
      // The source badge beside a settings row's label (objectui#12694): the
      // layer a value comes from. `{{source}}` is that layer's label, which the
      // server translates under `settingsCommon.sourceLabels`. One sentence per
      // badge, so a pack puts the layer where its own grammar wants it.
      sourceBadgeInherited: 'Inherited from {{source}}',
      sourceBadgeOverrides: 'Overrides {{source}}',
      // The action beside an `Overrides` badge (objectui#13145): it clears this
      // layer's value in the draft, and Save sends it as `null` (unset), so the
      // row falls back to the value the layer above carries.
      resetToDefault: 'Reset to default',
      // The chips on a settings row's header (objectui#12821): the env-lock
      // chip and the title it shows when the server sends no reason, and the
      // `Deprecated` chip, with `{{replacedBy}}` the key that replaces it.
      // `unsupportedSpecifierType` is the row drawn for a specifier type the
      // page has no control for, `{{type}}` that type.
      envLockBadge: 'Locked by env',
      envLockBadgeTitle: 'Pinned by environment variable — cannot be edited from the UI.',
      deprecatedBadge: 'Deprecated',
      deprecatedBadgeReplacedBy: 'Deprecated → {{replacedBy}}',
      unsupportedSpecifierType: 'Unsupported specifier type: {{type}}',
      // A settings value that misses its type's declared format blocks Save
      // (objectui#13287). `email` and `url` reuse `validation.email` and
      // `validation.url`; these two name what a phone number and a colour take.
      invalidPhone: 'Enter a phone number using only digits, spaces and + ( ) - .',
      invalidColor: 'Enter a hex color, such as #1a2b3c',
    },
    // The one-time workspace-timezone prompt (objectui#11758): asked of an
    // administrator while `localization.timezone` is still the manifest default.
    // `{{current}}` is that default, `{{zone}}` the zone the admin confirmed.
    workspaceTimezonePrompt: {
      title: 'Set the system timezone',
      description: 'This system still uses the platform default timezone, {{current}}. The system timezone decides what "today" means in formulas, how reports group dates and how dates and times are shown, for everyone in the system. Your browser timezone is filled in below.',
      laterHint: 'You can change it at any time on the Settings page.',
      decline: 'Keep the default',
      confirm: 'Set timezone',
      saved: 'System timezone set to {{zone}}',
    },
    error: {
      connectionFailed: 'Cannot connect to server',
      serverUnreachable: 'The server at {{url}} is unreachable.',
      checkServer: 'Please check your network connection or that the backend is running.',
      timeout: 'Connection timed out after 10 seconds.',
    },
    actions: {
      retry: 'Retry',
      retrying: 'Retrying…',
    },
    // Copy owned by the console server-action wrapper (`consoleServerAction.ts`,
    // objectui#3321): the pre-opened SSO spinner tab and the popup-blocked toast.
    serverAction: {
      openingTitle: 'Opening…',
      openingBody: 'Opening… this may take a moment.',
      popupBlockedTitle: 'Popup blocked',
      popupBlockedDescription: 'Your browser blocked the new tab from opening.',
      popupBlockedAction: 'Open in new tab',
      // The `newTabUrl` fast path's refusal when no record id resolves
      // (`createConsoleServerActionHandler`, objectui#13397).
      noRecordId: 'This action runs on a single record — no record id available.',
    },
    shortcuts: {
      title: 'Keyboard Shortcuts',
      description: 'Quick reference for all available keyboard shortcuts.',
      groups: {
        general: 'General',
        navigation: 'Navigation',
        aiChat: 'AI assistant',
      },
      openCommandPalette: 'Open command palette',
      showShortcuts: 'Show keyboard shortcuts',
      closeDialog: 'Close dialog / panel',
      toggleSidebar: 'Toggle sidebar',
      newChat: 'New chat',
      toggleChatsList: 'Toggle conversations list',
      goHome: 'Back to home',
    },
    reportIndex: {
      title: 'Reports',
      emptyTitle: 'No reports',
      emptyDescription: 'This app has no reports you can open.',
    },
    commandPalette: {
      title: 'Command palette',
      placeholder: 'Type a command or search…',
      noResults: 'No results found.',
      searching: 'Searching…',
      records: 'Records',
      recentRecords: 'Recently viewed',
      objects: 'Objects',
      packages: 'Packages',
      flows: 'Flows',
      dashboards: 'Dashboards',
      pages: 'Pages',
      reports: 'Reports',
      switchApp: 'Switch App',
      current: 'Current',
      preferences: 'Preferences',
      lightTheme: 'Light Theme',
      darkTheme: 'Dark Theme',
      systemTheme: 'System Theme',
      actions: 'Actions',
      openFullSearch: 'Open Full Search Page',
      createApp: 'Create New App',
    },
    ai: {
      pendingDrafts: {
        count: '{{count}} change(s) are not published yet — users cannot see them.',
        publish: 'Publish',
        published: 'All pending changes are live.',
        failed: 'Publish failed.',
        publishedWithFindings: 'Published, but the runtime probes reported problems: {{detail}}',
      },
      usage: {
        title: 'AI usage',
        // objectui#11658 — the popover's ONE figure: the share of the single
        // AI pool already used (a formatted percentage, never a token count).
        // It replaced the build / data-Q&A split, which could not attribute a
        // single-composer turn honestly.
        poolUsed: '{{percent}} used',
        statusOk: 'Plenty left',
        statusLow: 'Running low',
        statusFull: 'Limit reached',
        resetsDaily: 'Resets tonight',
        resetsMonthly: 'Resets next cycle',
        // `resetKind: 'weekly'` (free plan's rolling 7-day window, cloud PR
        // #1852): "N days" (or "N hours" inside the final day). A REAL
        // i18next plural family — see the `unsavedCount` note above — so the
        // BASE key carries no suffix and must stay in every pack's lookup
        // chain (`all-locales-key-parity.test.ts`'s base-key rule).
        resetsWeeklyDays: 'Resets in {{count}} days',
        resetsWeeklyDays_one: 'Resets in {{count}} day',
        resetsWeeklyDays_other: 'Resets in {{count}} days',
        resetsWeeklyHours: 'Resets in {{count}} hours',
        resetsWeeklyHours_one: 'Resets in {{count}} hour',
        resetsWeeklyHours_other: 'Resets in {{count}} hours',
        ctaUpgrade: 'Upgrade to keep going',
        ctaTopUp: 'Add credits to continue',
        ariaLabel: 'AI usage: {{status}}',
      },
      workspaceTitle: 'AI Workspace',
      workspaceSubtitle: 'Ask, inspect, and resume conversations',
      openChats: 'Open chats',
      chats: 'Chats',
      chatsDescription: 'Browse and manage AI conversations.',
      share: 'Share',
      shareTitle: 'Share this conversation',
      shareDisabledTitle: 'Start chatting to enable sharing',
      // The build conversation's Build Doctor button (its accessible name,
      // and its tooltip enabled / before the first message) and the drawer
      // title it opens (objectui#10900).
      buildDoctor: 'Build Doctor',
      buildDoctorTitle: 'Build Doctor — what actually landed?',
      buildDoctorDisabledTitle: 'Send a message first',
      // The Build Doctor drawer's body (objectui#10969): its description, the
      // loading and not-found states, the summary line, the verdict, and each
      // section's title and hint. What the report itself carries (tool, artifact
      // and status names, timeline text) is data and stays verbatim.
      buildDoctorDrawer: {
        description: 'What the agent claimed vs what is actually live. Read-only diagnostic.',
        reconciling: 'Reconciling…',
        notAvailable: 'Not available — the conversation was not found or you are not authorized.',
        untitled: '(untitled)',
        summary: '{{turns}} turn(s) · {{messages}} msgs · {{tokens}} tok · {{seconds}}s LLM',
        allLive: 'All {{count}} attempted change(s) are live — nothing evaporated.',
        discrepancies: "{{count}} discrepancy(ies) — what the chat said doesn't match what's live.",
        orphanedTitle: 'Proposed but never applied',
        orphanedHint: 'A confirm card the agent proposed but no later turn applied — the change silently evaporated.',
        missingTitle: 'Claimed but missing',
        missingHint: "A tool result said it was applied, but the artifact isn't live in sys_metadata.",
        toolErrorsTitle: 'Tool errors',
        toolErrorsHint: 'Tool calls that returned an error during the build.',
        verifyTitle: 'Build check (verify_build)',
        yourApp: 'Your app:',
        noIssues: '0 issues',
        issueCount: '{{count}} issue(s)',
        platformNoise: '{{count}} platform sys_* finding(s) hidden',
        pendingActions: 'Pending actions',
        timeline: 'Timeline ({{count}})',
      },
      newChat: 'New',
      searchChats: 'Search chats…',
      noChatsYet: 'No chats yet',
      noChatsDescription: 'Start a new conversation to see it here.',
      noMatchingChats: 'No matching chats.',
      newConversation: 'New conversation',
      renameConversation: 'Rename conversation',
      deleteConversation: 'Delete conversation',
      saveRename: 'Save rename',
      cancelRename: 'Cancel rename',
      loadingHistory: 'Loading conversation history…',
      conversationReady: 'Conversation ready',
      preparingConversation: 'Preparing a new conversation',
      offlineDemoMode: 'Offline demo mode — agent list unavailable',
      sendFailedRateLimited:
        "You're sending messages too quickly. Your message is kept below — wait a moment and try again.",
      sendFailedGeneric:
        "Couldn't send your message. It's kept below — please try again.",
      askAgent: 'Ask {{agent}}…',
      assistant: 'Assistant',
      liveCanvas: 'Live preview — {{app}} (draft)',
      liveCanvasUnlisted: 'Live app — {{app}} (unlisted until published)',
      loadingAgents: 'Loading agents…',
      askAnything: 'Ask anything…',
      askOrChangeApp: 'Ask about your data, or ask me to change this app…',
      describeAppToBuild: 'Describe the app you want to build, or what to change…',
      emptyTitle: 'Start a conversation',
      emptyDescription: 'Ask anything — the assistant has access to your current app context.',
      switchAssistant: 'Switch assistant',
      chooseAgent: 'Choose assistant…',
      // objectui#8329 — the maker's empty-state prose, and the FIRST sentence a
      // new user reads on the build surface (it sits above the start chips).
      // Same ADR-0112 v1 boundary the chips answer to (cloud#1984 /
      // objectui#7709 for the starters, cloud#2022 for the model's own closing
      // suggestions): these two descriptions are the product PROMISING, so they
      // may only name what v1 BUILDS — objects, fields, views, pages,
      // dashboards, sample data, apps and navigation. `build.description` used
      // to offer "an app or workflow … objects, screens and automations" and
      // `editApp.description` "… view or automation"; v1 has no flows, actions
      // or schedules, so a user who took either at its word was refused
      // outright — the worst possible answer to the first line on the page.
      //
      // NOT the same thing as the platform's manual automation surfaces, which
      // are real and stay as they are: `home.build.subtitle` (that card opens
      // Studio, which does author flows), `engine.studio.landing.description`,
      // `packagedAutomation.*` and the
      // marketplace `automation` category. The boundary is v1 AI AUTHORING, not
      // the word "automation".
      //
      // REVERT both sentences when ADR-0112 v2 re-adds flows and actions — same
      // line of the version roadmap as the chips. Every pack's wording is
      // guarded, in its own script, by
      // `packages/i18n/src/__tests__/makerEmptyState-v1-scope-8329.test.ts`.
      empty: {
        build: {
          title: 'Build with AI',
          description:
            'Describe an app in plain language — I draft the objects, screens and sample data, then you review and publish.',
        },
        ask: {
          title: 'Ask your data',
          description:
            'Ask questions about your records — counts, lists, and summaries across the data you can access.',
        },
        editApp: {
          title: 'Editing “{{app}}”',
          titleGeneric: 'Edit this app',
          description:
            'What would you like to change? I’ll modify this app in place — add a field, object, view or dashboard, or adjust what’s already there.',
        },
      },
      clearConversation: 'Clear',
      sendHint: 'to send',
      newlineHint: 'for a new line',
      agentActivity: 'Agent activity',
      toolCompleted: 'Completed',
      toolRunning: 'Running',
      toolAwaitingApproval: 'Awaiting approval',
      toolFailed: 'Failed',
      toolDetailsHidden: 'Tool inputs and raw results are hidden in this view.',
      // objectui#11667 — the inline HITL deny reason (stored on the pending
      // action as `rejection_reason`, read as prose) and the ADR-0057 P4
      // "Open in Builder" handoff card. The card's Approve / Reject buttons
      // borrow `aiApprovals.approveAndExecute` / `aiApprovals.reject`.
      toolDenyReason: 'Operator rejected from chat',
      builderHandoffTitle: 'Build this in the Builder',
      builderHandoffOpen: 'Open in Builder →',
      builderHandoffSuperseded: 'A newer request is available',
      copy: 'Copy',
      copied: 'Copied',
      regenerate: 'Regenerate',
      model: 'Model',
      submit: 'Submit',
      uploadFiles: 'Upload files',
      stopResponse: 'Stop response',
      trace: 'trace',
      viewTrace: 'View trace',
      // Build-flow draft + "Proposed plan" confirm-gate card (AiChatPage /ai/build).
      // Mirror the ConsoleFloatingChatbot locale object so both AI surfaces match.
      nextSteps: "What's next",
      publishDrafts: 'Publish',
      publishOk: 'Published — objects are now live.',
      seedWarn: 'Published, but some sample data failed to load.',
      openBuiltApp: 'Open app',
      viewBuiltAppInStudio: 'View in Studio',
      previewDraft: 'Preview',
      previewApp: 'Preview app',
      resizeSplit: 'Resize chat and preview',
      hideChats: 'Hide chats',
      showChats: 'Show chats',
      planTitle: 'Proposed plan',
      planQuestions: 'Confirm before building',
      planAssumptions: 'Assumptions',
      planApproveHint: 'Reply to approve or adjust this plan.',
      planApprove: 'Build it',
      planAdjust: 'Adjust',
      planApproveMessage: 'Looks good — build it as proposed.',
      planApproveDefaultsMessage:
        'Build it with your best assumptions; use sensible defaults for the open questions.',
      planAnswerMessage: 'For "{{question}}", go with: {{option}}.',
      changesTitle: 'Confirm changes',
      changesConfirmed: 'Confirmed',
      changesConfirm: 'Confirm',
      changesConfirmHint: 'Reply to confirm or adjust this change.',
      changesApplying: 'Applying…',
      changesApplied: 'Applied',
      changesDrafted: 'Saved as draft',
      changesFailed: 'Not applied',
      discussing: 'Discussing: {{target}}',
      // Wording is load-bearing: this is SENT to the agent and must satisfy the
      // cloud confirm gate's English clause `apply (this|the) change`
      // (service-ai-studio confirm-gate.ts APPROVAL_RE). "apply what you just
      // proposed" did NOT match, so the button was inert. Singular "the change"
      // so it still matches if the gate ever adds a word boundary.
      changesConfirmMessage: 'Confirm — apply the change you just proposed.',
      changeVerb: {
        createObject: 'Create object',
        addField: 'Add field',
        modifyField: 'Modify field',
        deleteField: 'Delete field',
        createMetadata: 'Create',
        updateMetadata: 'Modify',
        createSeed: 'Generate sample data',
        createPackage: 'Create app package',
      },
      justNow: 'just now',
      minutesAgo: '{{count}}m ago',
      hoursAgo: '{{count}}h ago',
      daysAgo: '{{count}}d ago',
      agentLabels: {
        ask: 'Ask',
        build: 'Build',
        // Legacy keys kept for back-compat with any external overrides.
        dataChat: 'Assistant',
        metadataAssistant: 'Metadata Assistant',
      },
      suggestions: {
        dataChat: {
          userCount: 'How many users are in the system? List their emails.',
          recentRecords: 'List the 5 most recently created records.',
          recordCounts: 'Count records for each object.',
        },
        // cloud#1984 — these five chips are the maker's own recommendations, so
        // they may only ask for what ADR-0112 v1 BUILDS: objects, fields, views
        // (grid/kanban/calendar/gallery), pages, dashboards and sample data. No
        // wording that promises autonomous behaviour (alert / remind / notify /
        // automate / status workflow) — v1 has no flows, actions or schedules, and
        // the model silently degrades such a request into a board or a filtered
        // view, so the chip would promise an alert and deliver a page. REVERT to
        // the automation wording when ADR-0112 v2 re-adds flows and actions.
        metadataAssistant: {
          buildCrm: 'Build a sales CRM — customers, contacts, and deals with a stage field, plus a dashboard that totals deal value by stage.',
          buildApp: 'Create a project tracker — projects, tasks with owners and due dates, a board grouped by status, and a calendar of due dates.',
          buildFlow: 'Design a support desk — tickets with priority and status fields, a board grouped by status, and links to customers.',
          buildInventory: 'Build an inventory app — products, stock levels, suppliers, and a view that filters the items below their reorder point.',
          buildRecruiting: 'Make an applicant tracker — candidates, open roles, an interview-stage field, and a board grouped by stage.',
        },
        generic: {
          help: 'What can you help me with?',
          availableObjects: 'List the available data objects.',
          recentActivity: 'Summarize my recent activity.',
        },
        // objectui#7709 — the edit-mode starters, shown when the maker is bound
        // to an EXISTING app (`?package=`). Same rule as the five above: they
        // may only ask for what ADR-0112 v1 BUILDS. The fourth chip used to be
        // `addAutomation` ("an approval, a status flow, or a notification") and
        // every capability it named is refused by v1 (cloud#1956 / PR #1970), so
        // it now asks for sample data — `seed` IS on v1's whitelist, and having
        // no data is what an existing app most often lacks. REVERT: when
        // ADR-0112 v2 re-adds flows and actions, THIS chip's automation wording
        // comes back as `addAutomation`; the retired string is pinned for every
        // pack in `packages/i18n/src/__tests__/makerEditChips-v1-scope-7709.test.ts`.
        editApp: {
          addField: 'Add a field to one of the objects.',
          addObject: 'Add a new object and relate it to an existing one.',
          addDashboard: 'Add a dashboard for the key metrics.',
          addSampleData: 'Fill the existing objects with realistic sample records so I can demo the app.',
        },
      },
      // objectui#3546 slice four — the AI console surfaces: the /ai chat page's app switcher,
      // connection banner and plan/publish cards, the ChatDock chrome, and the
      // conversation-list date buckets. `group.*` is the template-key family
      // `console.ai.group.${key}` (ConversationsSidebar), enumerated from the
      // ConversationGroupKey union — all five members, no wildcard.
      collapseToDock: 'Collapse to side panel',
      switchApp: 'Switch app',
      switchAppLabel: 'Build conversations by app',
      newApp: 'New app',
      connectionWaiting: 'Waiting for server…',
      connectionStalled: 'Still working…',
      connectionOffline: 'Connection lost — reconnecting…',
      designingPlan: 'Designing your app…',
      designingPlanHint: {
        data: 'Mapping out the data you’ll track…',
        objects: 'Shaping objects and their fields…',
        relations: 'Connecting related records…',
        lookups: 'Setting up relationships and lookups…',
        views: 'Planning the screens and views…',
        forms: 'Laying out forms and lists…',
        defaults: 'Adding sensible defaults and validations…',
        dashboard: 'Sketching a dashboard to track it…',
        review: 'Double-checking the structure hangs together…',
        finalize: 'Pulling the plan together…',
      },
      planBuilding: 'Building…',
      planBuilt: 'Built',
      planDeferred: 'Not yet built',
      planReady: 'The plan is ready. Build it now, or tell me what to adjust.',
      published: 'Published',
      publishFailed: 'Publish failed',
      unavailableTitle: 'AI assistant unavailable',
      unavailableDescription: "This deployment doesn't have an AI assistant enabled. Everything else works as usual.",
      unavailableError: "Couldn't reach the AI service. It may be temporarily offline — try again, or head back home.",
      unavailableRetry: 'Try again',
      unavailableHome: 'Back to home',
      dock: {
        title: 'Assistant',
        description: 'AI assistant chat',
        resize: 'Resize chat',
        collapse: 'Collapse chat',
        maximize: 'Open full page',
        open: 'Open assistant',
        // objectui#11666 — the launchers' marker while a proposed plan awaits approval.
        planAwaitingApproval: 'A proposed plan is waiting for your approval',
      },
      group: {
        today: 'Today',
        yesterday: 'Yesterday',
        previous7Days: 'Previous 7 days',
        previous30Days: 'Previous 30 days',
        older: 'Older',
      },
    },
    // objectui#9954 — the environment admin's read-rate report (cloud#2333).
    // Two anomalous cases, two sets of words: an ABSENT `readsPerWrite` means the
    // environment wrote nothing at all, so the ratio is unbounded — the most
    // severe reading, and never a missing number. `{{threshold}}` always comes
    // from the wire; this repo holds no copy of the line. Report only — the copy
    // states that nothing is limited or blocked, and must keep doing so.
    readRate: {
      ratioTitle: 'Unusual read volume in this system',
      ratio: 'Reads are running at {{ratio}} rows for every row written. The platform flags anything above {{threshold}}. Nothing is limited or blocked; this is a report so the read pattern can be reviewed.',
      noWritesTitle: 'Reads with no writes at all in this system',
      noWrites: 'Rows are being read while none at all are being written, so the read rate has no upper bound. This is the most severe reading. The platform flags anything above {{threshold}}. Nothing is limited or blocked; this is a report so the read pattern can be reviewed.',
    },
    // objectui#10439 — the environment admin's storage-capacity banner (cloud#2135).
    // Raised by the tenant runtime's own verdict on `/api/v1/usage/storage`: `warn`
    // (80% and up) or `blocked` (uploads and bulk imports refused). `{{used}}` and
    // `{{limit}}` are that response's `usedMb` / `limitMb`, already formatted.
    storageUsage: {
      warningTitle: 'Storage is filling up',
      warning: '{{used}} MB of {{limit}} MB used. Uploads and imports pause once storage is full.',
      blockedTitle: 'Storage is full: uploads and imports are paused',
      blocked: '{{used}} MB of {{limit}} MB used. Existing data is untouched, and reading, exporting and editing single records still work.',
      upgrade: 'Upgrade to continue',
    },
    errors: {
      somethingWentWrong: 'Something went wrong',
      unexpectedError: 'An unexpected error occurred while rendering this view.',
      tryAgain: 'Try Again',
      goHome: 'Go Home',
      errorDetails: 'Error Details (dev only)',
    },
    // objectui#3546 slice four — the console's catch-all route (AppContent `RouteNotFound`).
    notFound: {
      title: 'Page not found',
      description: 'The URL you followed does not match any view in this app.',
      back: 'Go back',
    },
    theme: {
      toggle: 'Toggle theme',
      light: 'Light',
      dark: 'Dark',
      system: 'System',
    },
    objectData: {
      badge: 'Data',
      description: 'URL-defined data slice — not bound to any saved view.',
      filteredBy: 'Filtered by',
      removeFilter: 'Remove filter {{field}}',
      saveAsView: 'Save as view',
      noAccessTitle: 'Access denied',
      noAccess: 'You do not have permission to view this data.',
    },
    identityImport: {
      policyTitle: 'Sign-in setup for imported users',
      policy: {
        auto: 'Automatic (recommended)',
        invite: 'Send invitations',
        temporary: 'Temporary passwords',
        none: 'No password (identity only)',
      },
      policyHint: {
        auto: 'Reachable users get an invitation (email or SMS); anyone we can\'t reach gets a one-time password, shown ONCE on the result screen. Works with or without an email/SMS service.',
        invite: 'Every created user gets a set-your-password email (or an invitation SMS for phone-only rows). Requires a configured email/SMS service — unreachable rows fail.',
        temporary: 'For deployments without email/SMS: every created user gets a one-time password, shown ONCE on the result screen. First sign-in forces a change.',
        none: 'Users first sign in with a phone OTP, magic link, or password-reset link, then set their own password.',
      },
      passwordsNote: 'Temporary passwords — shown once, never stored. Save them now; each user must change theirs at first sign-in.',
      passwordsMore: 'More entries omitted — use the download.',
      passwordsDownload: 'Download CSV',
    },
    objectView: {
      // objectui#13330 — Setup → Users on a managed environment.
      managedUsers: {
        inviteLine: 'This environment is managed from the cloud. Invite people to your organization there; they appear here when they first sign in. A user marked Not authorized holds nothing beyond the access every member has: give them a permission set or a position.',
        unauthorized: 'Not authorized',
        unauthorizedHint: 'Holds no permission set beyond the baseline every signed-in member has. Give them a permission set or a position.',
      },
      objectNotFound: 'Object Not Found',
      objectNotFoundDescription: 'The object "{{objectName}}" does not exist in the current configuration.',
      objectNotFoundHint: 'Check your app navigation settings or select a different object from the sidebar.',
      objectPackageDisabled: 'The object "{{objectName}}" belongs to a package that is disabled, so it is not being served.',
      filterOrNotSavable: 'This filter uses OR between conditions, which a saved view cannot store yet. It still applies to this list — remove the OR grouping to save it to the view.',
      filterNestedNotSavable: 'This filter uses nested condition groups, which a saved view cannot store. Flatten it to a single list of conditions to save it to the view.',
      systemViewReadonly: 'System view defined in code — read-only.',
      // ObjectView.tsx references ONE edit-denied key from four call sites
      // (rename / pin / set-as-default / configure), so the copy has to cover
      // any change to a built-in view rather than name one operation.
      cannotEditMetaView: 'This view is built in and defined in code — it cannot be changed.',
      resetView: 'Reset view',
      resetViewTitle: 'Set this view back to its own sort, filters and column widths. Only yours change.',
      cannotDeleteMetaView: 'This view is built in and defined in code — it cannot be deleted.',
      expandToPage: 'Open as full page',
      allRecords: 'All Records',
      new: 'New',
      import: 'Import',
      importTitle: 'Import from CSV',
      importedToast: 'Imported {{count}} row(s).',
      importedToast_one: 'Imported {{count}} row.',
      importedToast_other: 'Imported {{count}} rows.',
      importedWithSkipped: 'Imported {{ok}} row(s); skipped {{skipped}}.',
      configureView: 'Configure View',
      toolbarEnabledCount: '{{count}} of {{total}} enabled',
      searchFields: 'Search fields…',
      title: 'Title',
      viewType: 'View type',
      recordCount: '{{count}} records',
      recordCount_one: '{{count}} record',
      recordCount_other: '{{count}} records',
      save: 'Save',
      discard: 'Discard',
      createView: 'Create View',
      createViewDesc: 'Pick a view type, then give it a name. You can change every setting afterwards.',
      cancel: 'Cancel',
      create: 'Create',
      delete: 'Delete',
      deleteViewTitle: 'Delete view',
      deleteViewConfirm: 'Are you sure you want to delete the view "{{name}}"? This cannot be undone.',
      bulkDeleteConfirm: 'Delete {{count}} selected records? This cannot be undone.',
      bulkDeleteConfirm_one: 'Delete {{count}} selected record? This cannot be undone.',
      bulkDeleteConfirm_other: 'Delete {{count}} selected records? This cannot be undone.',
      duplicateViewName: 'A view with this name already exists.',
      viewTypeGrid: 'Grid',
      viewTypeGridDesc: 'A spreadsheet-style table of records.',
      viewTypeKanban: 'Kanban',
      viewTypeKanbanDesc: 'Cards grouped into columns by a single-select field.',
      viewTypeCalendar: 'Calendar',
      viewTypeCalendarDesc: 'Records placed on a monthly calendar by date.',
      viewTypeGallery: 'Gallery',
      viewTypeGalleryDesc: 'Large image cards driven by an attachment field.',
      viewTypeTimeline: 'Timeline',
      viewTypeTimelineDesc: 'Records along a horizontal time axis.',
      viewTypeGantt: 'Gantt',
      viewTypeGanttDesc: 'Project bars with start / end and dependencies.',
      viewTypeMap: 'Map',
      viewTypeMapDesc: 'Geographic markers from latitude / longitude fields.',
      viewTypeChart: 'Chart',
      viewTypeChartDesc: 'Aggregated bar / line / pie visualisations.',
      viewTypeTree: 'Tree',
      viewTypeTreeDesc: 'Nest self-referencing records into a hierarchy by a parent field.',
      parentField: 'Parent field',
      parentFieldHelp: 'The field pointing to the parent record (same object) that defines the hierarchy. Only self-referencing fields qualify.',
      newView: 'New View',
      viewName: 'Name',
      viewNameHelp: 'Machine key (snake_case). Auto-filled from the title — edit if you like.',
      viewNameRequired: 'Enter a key (lowercase letters, numbers, underscore). Not auto-filled for non-Latin titles.',
      viewNameInvalid: 'Use lowercase letters, numbers and underscores; start with a letter or underscore.',
      groupByField: 'Group by field',
      groupByFieldHelp: 'The kanban groups records into columns by this field\'s values.',
      startDateField: 'Start date field',
      startDateFieldHelp: 'The calendar places records on the cell matching this date.',
      ganttStartDateFieldHelp: 'The left edge of each Gantt bar uses this date.',
      ganttEndDateFieldHelp: 'The right edge of each Gantt bar uses this date.',
      timelineDateFieldHelp: 'Records are placed on the timeline by this date.',
      titleField: 'Title field',
      latitudeField: 'Latitude field',
      latitudeFieldHelp: 'Field providing the latitude coordinate (geo fields only).',
      longitudeField: 'Longitude field',
      longitudeFieldHelp: 'Field providing the longitude coordinate (geo fields only).',
      imageField: 'Image field',
      imageFieldHelp: 'The gallery cover comes from this image or attachment field.',
      selectField: 'Select field…',
      selectOption: 'Select…',
      noEligibleFieldForType: 'No eligible field of this type. Add one to the object first.',
      viewTypeUnavailable: 'This object has no field that can serve as "{{field}}".',
      viewTypeUnavailableShort: 'Not supported by this object.',
      chartType: 'Chart type',
      chartTypeHelp: 'Determines how the data is rendered.',
      chartTypeBar: 'Bar chart',
      chartTypeLine: 'Line chart',
      chartTypePie: 'Pie chart',
      chartTypeArea: 'Area chart',
      chartTypeScatter: 'Scatter chart',
      dataset: 'Dataset',
      datasetHelp: 'The chart reads its numbers from this dataset of the object.',
      chartMeasure: 'Measure',
      chartMeasureHelp: 'The dataset measure plotted on the value axis.',
      chartDimension: 'Dimension',
      chartDimensionHelp: 'The dataset dimension the values are grouped by (optional).',
      viewTypeUnavailableDataset: 'This object exposes no dataset to chart.',
      noDatasetMeasure: 'This dataset declares no measure to chart.',
      endDateField: 'End date field',
      ufTabs: 'Tabs',
      ufAddField: '+ Add filter field…',
      ufShowAllRecords: 'Show "All records" tab',
    },
    // The runtime draft bar's Publish / Discard refusals (RuntimeDraftBar,
    // objectui#11583). The toast's description is the refusal itself.
    runtimeDraft: {
      publishFailed: 'Publish failed',
      discardFailed: 'Discard failed',
    },
    localeSwitcher: {
      label: 'Language',
    },
    developer: {
      apiConsole: {
        endpointsTitle: 'API Endpoints',
        refreshEndpoints: 'Refresh endpoints',
        searchPlaceholder: 'Search endpoints…',
        discovering: 'Discovering APIs…',
        noMatching: 'No matching endpoints',
        noEndpoints: 'No endpoints found',
        queryParameters: 'Query Parameters',
        addParameter: 'Add',
        hintLimit: 'limit',
        hintOffset: 'offset',
        hintSort: 'sort field',
        hintSelect: 'fields',
        hintCount: 'total count',
        hintFilter: 'OData filter',
        parameterKey: 'key',
        parameterValue: 'value',
        send: 'Send',
        requestBody: 'Request Body (JSON)',
        sending: 'Sending request…',
        networkError: 'Network Error: {{message}}',
        copy: 'Copy',
        copied: 'Copied',
        emptyHint: 'Select an endpoint or type a URL and click {{send}}',
        emptySubhint: 'All registered APIs are auto-discovered from the platform',
        history: 'History ({{total}})',
        clearHistory: 'Clear',
        replay: 'Replay request',
      },
      integrations: {
        title: 'Integrations & APIs',
        subtitle: 'Every object you build is instantly a REST API. Drive your app from code or an agent.',
        copy: 'Copy',
        copied: 'Copied',
        baseUrlTitle: 'Base URL',
        baseUrlDescription: 'This environment\'s API root.',
        copyBaseUrl: 'Copy base URL',
        endpointsTitle: 'REST endpoints',
        endpointsDescription: 'Auto-generated CRUD for every published object (OData query params on list).',
        openApiConsole: 'Open API Console',
        loadingObjects: 'Loading objects…',
        loadFailed: 'Couldn\'t load objects: {{message}}',
        noObjects: 'No business objects yet — build one with the AI assistant, publish it, and it appears here as an API.',
        endpointList: 'List / query',
        endpointCreate: 'Create',
        endpointRead: 'Read one',
        endpointUpdate: 'Update',
        endpointDelete: 'Delete',
        authTitle: 'Authentication',
        authInConsole: 'In the console you\'re already authenticated — use {{action}} above to call these endpoints now.',
        authExternal: 'For external programs and AI agents, generate a {{apiKey}} in the {{section}} section above. Send it as the {{header}} header; it runs under your permissions and row-level security, and is revocable.',
        selfServeKey: 'self-serve API key',
        connectSection: 'Connect an AI agent',
        sampleTitle: 'Sample (cURL)',
        copySample: 'Copy cURL sample',
      },
      publicForms: {
        title: 'Public Forms',
        description: 'Forms anyone can fill out — no login required. Publish a form to get a shareable link; submissions land directly in the bound object.',
        publishNone: 'No non-public FormViews available',
        publishTooltip: 'Publish a FormView',
        publishButton: 'Publish form…',
        emptyTitle: 'No public forms yet',
        emptyBody: 'Click {{action}} above to share an existing form, or build a new one in Views & Apps and mark it public.',
        columnName: 'Name',
        columnObject: 'Object',
        columnSlug: 'Slug',
        columnPublicUrl: 'Public URL',
        copyUrl: 'Copy URL',
        copyIframe: 'Copy <iframe> embed',
        copyReact: 'Copy React snippet',
        editSharing: 'Edit sharing & post-submit behavior',
        copiedUrl: 'Copied URL',
        copiedIframe: 'Copied iframe snippet',
        copiedReact: 'Copied React snippet',
        clipboardUnavailable: 'Clipboard unavailable',
        invalidSlug: 'Invalid slug',
        published: 'Published {{name}}',
        publishFailed: 'Publish failed: {{message}}',
        saved: 'Saved {{name}}',
        saveFailed: 'Save failed: {{message}}',
        publishDialogTitle: 'Publish a FormView',
        publishDialogDescription: 'Pick an existing FormView to open it to anonymous visitors. Publishing sets {{enabled}}, {{allowAnonymous}} and {{publicLink}} in its config: the public form route serves a form only when all three are set.',
        formView: 'FormView',
        selectFormView: '— Select a FormView —',
        urlSlug: 'URL slug',
        slugHint: 'Lowercase letters, digits, dashes and underscores only.',
        publishing: 'Publishing…',
        publish: 'Publish',
        editTitle: 'Edit {{name}}',
        editTitleFallback: 'Edit form',
        editDescription: 'Configure the public URL and what happens after submit.',
        afterSubmit: 'After submit',
        behaviorThankYou: 'Show a thank-you panel',
        behaviorRedirect: 'Redirect to a URL',
        behaviorContinue: 'Reset for another response',
        behaviorNextRecord: 'Advance to next record (internal queues)',
        thankYouTitle: 'Title',
        thankYouTitlePlaceholder: 'Thanks!',
        thankYouMessage: 'Message',
        thankYouMessagePlaceholder: 'Your submission has been received.',
        redirectUrl: 'Redirect URL',
        redirectHint: 'An in-app path, starting with {{slash}} — interpolate a field of the submitted record as {{token}}. To send the browser out of the app, use an app navigation item instead.',
        saving: 'Saving…',
      },
      // objectui#13460 — Developer → Flow Runs (`FlowRunsPage`).
      flowRuns: {
        title: 'Flow Runs',
        subtitle: 'Pick a flow, trigger a test run with sample inputs, and inspect recent run history',
        flowTitle: 'Flow',
        flowDescription: 'Select a flow definition to test',
        noFlows: 'No flow definitions found.',
        testRunTitle: 'Test Run',
        testRunDescription: 'Provide input values and invoke the flow',
        noInputs: 'This flow declares no input variables. Click {{action}} to invoke it with no parameters.',
        running: 'Running…',
        runFlow: 'Run Flow',
        failed: 'Failed',
        waitingForInput: 'Waiting for input',
        result: 'Result',
        pausedAtScreen: 'This run is paused at screen {{node}}.',
        continueRun: 'Continue run',
        recentRuns: 'Recent Runs',
        noRuns: 'No runs yet. Use the {{panel}} panel to invoke this flow.',
        columnRun: 'Run',
        columnStatus: 'Status',
        columnStarted: 'Started',
        columnDuration: 'Duration',
        runTitle: 'Run {{id}}',
        stepInput: 'Input',
        stepOutput: 'Output',
        stepError: 'Error',
      },
      // objectui#13460 — the Integrations page's "Connect an AI agent" card (`AgentConnectSection`).
      agentConnect: {
        title: 'Connect an AI agent (MCP)',
        description: 'Every app in this environment is an agent-ready toolset. Connect Claude, Cursor, Codex or any MCP client — one connection covers all your apps (new ones appear automatically).',
        endpoint: 'MCP endpoint',
        disabledTitle: 'MCP is not enabled for this environment',
        disabledBody: 'Connecting agents is opt-in. An admin can enable it by setting {{flag}}. You can still generate a key and download the skill below.',
        copyMcpUrl: 'Copy MCP URL',
        apiKey: 'API key',
        keyNamePlaceholder: 'Key name (e.g. Claude desktop)',
        generating: 'Generating…',
        generateKey: 'Generate key',
        keyHint: 'The key acts as you (your permissions + row-level security). Shown once — copy it immediately. Revoke anytime from the API Keys list.',
        noKeyInResponse: 'The request succeeded but the response carried no API key. Nothing failed in transit — inspect the response body of {{route}}.',
        requestFailed: 'Request failed ({{status}})',
        generateFailed: 'Failed to generate key',
        skillTitle: 'Agent skill (portable)',
        skillHint: 'Works with any skills-capable agent (Claude, Codex, Gemini, Cursor…).',
        stepsTitle: 'Connect in 3 steps',
        step1: 'Add a remote MCP server pointing at the endpoint above.',
        step2: 'Set the header {{header}} (a session Bearer token is not an API key).',
        step3: 'Drop in {{file}} so the agent knows how to drive your data.',
        newKeyTitle: 'Your new API key',
        newKeyDescription: 'Copy this now — {{notice}}',
        newKeyNotice: 'for your security it will not be shown again.',
        sendAs: 'Send it as {{header}}. It carries your permissions — store it like a password and revoke it if leaked.',
      },
    },
    system: {
      aiApprovals: {
        title: 'AI Approvals',
        subtitle: 'Review actions an AI agent proposed. Approve to execute them server-side; reject to send a reason back to the model so it can revise the next turn.',
        queueTitle: 'Queue',
        queueDescription: 'Polled every 5 seconds. Decisions are recorded under your identity.',
      },
      // objectui#13460 — System → Audit Log (`AuditLogPage`).
      auditLog: {
        title: 'Audit Log',
        subtitle: 'Read-only system activity and record changes. Newest first.',
        openAsList: 'Open as list',
        openPresetAsList: 'Open {{label}} as list',
        presets: 'Presets',
        presetOtherSource: 'This view reads another data source.',
        presetFilterUnsupported: "This view's filter cannot be applied here: {{message}}",
        action: 'Action',
        allActions: 'All actions',
        object: 'Object',
        anyObject: 'Any object',
        searchObjects: 'Search objects…',
        loadingObjects: 'Loading objects…',
        noObjects: 'No objects found.',
        actor: 'Actor',
        anyUser: 'Any user',
        from: 'From',
        to: 'To',
        clearFilters: 'Clear filters ({{n}})',
        loadFailed: 'Failed to load audit log',
        emptyTitle: 'No audit entries',
        emptyFiltered: 'Try clearing filters or widening the date range.',
        emptyUnfiltered: 'Events will appear here once tracked objects are modified.',
        timestamp: 'Timestamp',
        page: 'Page {{page}}',
        pageEnd: 'Page {{page}} · end',
        eventFallback: 'Audit Event',
        ipAddress: 'IP Address',
        tenant: 'Tenant',
        targetRecord: 'Target record',
        userAgent: 'User Agent',
        changePayload: 'Change payload',
        before: 'Before',
        after: 'After',
        metadata: 'Metadata',
        system: 'System',
      },
    },
  },
  auth: {
    login: {
      title: 'Sign in to your account',
      description: 'Enter your email and password to continue',
      emailLabel: 'Email',
      emailPlaceholder: 'name@example.com',
      passwordLabel: 'Password',
      passwordPlaceholder: 'Enter your password',
      forgotPasswordText: 'Forgot password?',
      submitButton: 'Sign In',
      submittingButton: 'Signing in…',
      noAccountText: "Don't have an account?",
      signUpText: 'Sign up',
      signingIn: 'Signing you in…',
      ssoHandoff: 'Continue to {{target}}',
      // Phone/OTP sign-in labels. `LoginForm` interpolates `{seconds}` with a
      // literal `.replace('{seconds}', …)` of its own (in `LoginForm`),
      // so those SINGLE braces must survive translation — i18next never sees
      // them.
      emailOrPhoneLabel: 'Email or phone number',
      emailOrPhonePlaceholder: 'name@example.com or +1 555 000 0000',
      phoneLabel: 'Phone number',
      phonePlaceholder: '+1 555 000 0000',
      otpCodeLabel: 'Verification code',
      otpCodePlaceholder: '6-digit code',
      sendOtpButton: 'Get code',
      resendOtpCountdownText: 'Resend in {seconds}s',
      usePhoneOtpText: 'Sign in with verification code',
      usePasswordSignInText: 'Sign in with password instead',
      // The social provider buttons and the divider under them
      // (`SocialSignInButtons`, fed through `LoginForm`'s labels).
      // `{provider}` is the component's own single-brace hole, filled by a
      // literal `.replace()` with the provider's name as the server reports
      // it — the same convention as `{seconds}` above (objectui#10900).
      socialButton: 'Continue with {provider}',
      orText: 'or continue with email',
      // SSO sign-in (objectui#12762): the SSO button, and under SSO-only
      // ("enforced") mode the line that says how to sign in, the break-glass
      // link to the password form and the link back. Each English value is
      // `LoginForm`'s own default for that label, so an English session reads
      // the same with or without the pack.
      ssoButton: 'Sign in with SSO',
      ssoOnlyDescription: "Sign in with your organization's single sign-on",
      usePasswordText: 'Use a password instead',
      backToSsoText: 'Back to single sign-on',
      // objectui#12600 — the console login card's own header, the password
      // field's reveal toggle, and the footer's legal links.
      welcomeTitle: 'Welcome back',
      welcomeDescription: 'Sign in to continue your work',
      showPasswordText: 'Show password',
      hidePasswordText: 'Hide password',
      footer: {
        privacy: 'Privacy',
        terms: 'Terms',
      },
      devAdminHint: {
        title: 'Local development instance',
        signIn: 'Sign in as dev admin',
      },
      errors: {
        invalidCredentials: 'Invalid email or password. Please try again.',
        emailNotVerified: 'Please verify your email address before signing in.',
        oauthCallbackFailed: 'Single sign-on could not be completed — the sign-in link expired or was already used. Please try again.',
      },
    },
    register: {
      title: 'Create an account',
      description: 'Create your account to start building.',
      nameLabel: 'Name',
      namePlaceholder: 'John Doe',
      emailLabel: 'Email',
      emailPlaceholder: 'name@example.com',
      passwordLabel: 'Password',
      passwordPlaceholder: 'Create a password (min. 8 characters)',
      confirmPasswordLabel: 'Confirm Password',
      confirmPasswordPlaceholder: 'Confirm your password',
      passwordMismatchError: 'Passwords do not match',
      passwordTooShortError: 'Password must be at least 8 characters',
      submitButton: 'Create Account',
      submittingButton: 'Creating account…',
      hasAccountText: 'Already have an account?',
      signInText: 'Sign in',
      // Same pair as `auth.login.socialButton` / `orText`, for sign-up.
      socialButton: 'Sign up with {provider}',
      orText: 'or continue with email',
      errors: {
        userExists: 'An account with this email already exists. Try signing in instead.',
        selfRegistrationClosed: 'Self-registration is not open on this system. Ask an administrator for an invitation.',
        emailDomainNotAllowed: "This email's domain is not allowed to register here. Use your organization email, or ask an administrator for an invitation.",
      },
      verifyInbox: {
        title: 'Check your inbox',
        description: "We've sent a verification link to {{email}}. Click the link to activate your account.",
        resend: 'Resend verification email',
        resending: 'Sending…',
        resent: 'Verification email sent.',
        backToSignIn: 'Back to sign in',
      },
    },
    forgotPassword: {
      title: 'Reset your password',
      description: "Enter your email address and we'll send you a link to reset your password",
      emailLabel: 'Email',
      emailPlaceholder: 'name@example.com',
      submitButton: 'Send Reset Link',
      submittingButton: 'Sending…',
      successTitle: 'Check your email',
      successDescription: "We've sent a password reset link to {email}. Please check your inbox.",
      backToSignInText: 'Back to sign in',
      rememberPasswordText: 'Remember your password?',
      signInText: 'Sign in',
      // The SMS branch of the same form: request an OTP, then set the new
      // password inline instead of following an emailed link. `{seconds}` is
      // ForgotPasswordForm's own hole (packages/auth/src/ForgotPasswordForm.tsx:367).
      phoneLabel: 'Phone number',
      phonePlaceholder: '+1 555 000 0000',
      otpCodeLabel: 'Verification code',
      otpCodePlaceholder: '6-digit code',
      sendOtpButton: 'Get code',
      resendOtpCountdownText: 'Resend in {seconds}s',
      newPasswordLabel: 'New password',
      newPasswordPlaceholder: 'Enter a new password',
      resetButton: 'Reset Password',
      usePhoneResetText: 'Reset via SMS code',
      useEmailResetText: 'Reset via email instead',
      phoneSuccessTitle: 'Password reset',
      phoneSuccessDescription: 'Your password has been reset. You can now sign in with your new password.',
    },
    resetPassword: {
      title: 'Set a new password',
      description: 'Choose a password you have not used before.',
      newPassword: 'New password',
      confirmPassword: 'Confirm password',
      submit: 'Update password',
      submitting: 'Updating…',
      success: 'Password updated',
      failed: 'Reset failed',
      invalidToken: 'This reset link is invalid or has expired.',
      missingToken: 'Reset link is missing or expired',
      passwordsMismatch: 'Passwords do not match',
      requestNewLink: 'Request a new link',
    },
    verifyEmail: {
      title: 'Verify your email address',
      description:
        'We sent a verification link to your email address. Please click the link to verify your account.',
      sentTo: 'Sent to:',
      verifyingTitle: 'Verifying…',
      verifyingDescription: 'Hang tight while we confirm your email.',
      successTitle: 'Email verified',
      successDescription: 'Your email is confirmed. You can now sign in.',
      errorTitle: 'Verification failed',
      errorDescription: 'Verification failed. Please request a new link.',
      missingToken: 'Verification link is missing a token.',
      emailMissing: 'Email address is missing',
      resendButton: 'Resend verification email',
      resending: 'Sending…',
      resent: 'Email sent! Check your inbox',
      resentSuccess: 'Verification email sent!',
      resentDescription: 'Please check your inbox and click the verification link.',
      resendFailed: 'Cannot resend verification email',
      resendUnavailable:
        'Email delivery may not be configured for this system. Contact support if this persists.',
      signInLink: 'Go to sign in',
      backToSignIn: 'Back to sign in',
      backToLogin: 'Back to login',
      checkSpam: "Didn't receive the email? Check your spam folder or contact support.",
      or: 'Or',
    },
    setup: {
      welcomeTitle: 'Welcome to ObjectStack',
      description: 'Create the first owner account to finish setting up this deployment.',
      yourName: 'Your name',
      orgName: 'Organization name',
      orgNamePlaceholder: 'Acme Inc.',
      emailLabel: 'Email',
      emailPlaceholder: 'name@example.com',
      passwordLabel: 'Password',
      passwordHint: 'Minimum 8 characters',
      submit: 'Create owner account',
      submitting: 'Setting up…',
      failed: 'Setup failed',
    },
    device: {
      title: 'Authorize new device',
      subtitle: 'Approve this device to sign in as {{email}}.',
      userCodeLabel: 'Device code',
      requesterLabel: 'Connection request from',
      approveWarning: 'Only approve if you started this connection yourself a moment ago. Once approved, this runtime can access your organization\'s private packages.',
      loggedInAs: 'Signed in as {{email}}',
      approve: 'Approve device',
      approving: 'Approving…',
      approvedTitle: 'Device authorized',
      approvedDescription: 'You can return to the device — it should sign in shortly.',
      approveSuccess: 'Device authorized',
      approveSuccessDescription: 'You can close this window.',
      approveFailed: 'Approval failed',
      deny: 'Deny request',
      denying: 'Denying…',
      deniedTitle: 'Access denied',
      deniedDescription: 'The device will not be granted access.',
      denyFailed: 'Failed to deny request',
      invalidTitle: 'Invalid device link',
      invalidDescription: 'No device code was provided in the URL.',
      // Shown when the deployment has the device-authorization plugin off, so
      // the endpoints 404 (framework#2874 / objectui#2513).
      disabledTitle: 'Device authorization not enabled',
      disabledDescription:
        'This deployment does not have device authorization enabled, so this device cannot be approved here.',
      loading: 'Loading…',
      cancel: 'Cancel',
    },
    shell: {
      tenantHostHint: 'You are signing in to this system',
    },
    // These were previously supplied only as inline `defaultValue:` args at the
    // SetPasswordPage call sites, so `zh` was the only pack that could carry a
    // translation. Owning them here makes the page translatable everywhere.
    setPassword: {
      title: 'Set a recovery password',
      description:
        'You signed in via single sign-on. Set a local password so you can still sign in directly if SSO ever becomes unavailable.',
      email: 'Email',
      newPassword: 'New password',
      confirmPassword: 'Confirm password',
      submit: 'Set password',
      submitting: 'Saving…',
      success: 'Local password set',
      failed: 'Could not set password',
      passwordsMismatch: 'Passwords do not match',
      noSession: 'Your session has expired.',
      backToSignIn: 'Sign in again',
    },
    layout: {
      headline: 'Build powerful business applications, faster.',
      subhead: 'The universal platform for enterprise data management, workflows, and analytics.',
    },
    // ADR-0069 full-screen remediation gate. A user hitting this cannot reach
    // the rest of the app until they finish, so it must read in their language.
    remediation: {
      signOut: 'Sign out instead',
      password: {
        title: 'Your password has expired',
        resetTitle: 'You must change your password',
        fallbackMessage: 'Please set a new password to continue.',
        current: 'Current password',
        next: 'New password',
        confirm: 'Confirm new password',
        submit: 'Change password & continue',
        submitting: 'Updating…',
        mismatch: 'New passwords do not match.',
        failed: 'Could not change password.',
      },
      mfa: {
        title: 'Set up two-factor authentication',
        fallbackMessage: 'Your organization requires an authenticator app to continue.',
        confirmPassword: 'Confirm your password',
        continue: 'Continue',
        preparing: 'Preparing…',
        enrollFailed: 'Could not start enrollment.',
        scanTitle: 'Scan with your authenticator',
        scanBody: 'Scan this QR code with Google Authenticator, 1Password, Authy, etc., then enter the 6-digit code.',
        backupTitle: 'Save your backup codes',
        backupBody: 'Store these somewhere safe — each can be used once if you lose your device.',
        codeLabel: '6-digit code',
        verify: 'Verify & continue',
        verifying: 'Verifying…',
        invalidCode: 'Invalid code. Try again.',
      },
      // objectui#13208 — the overlay on an IMPERSONATION session: the held
      // credential is the impersonated user's, so it offers the way out instead
      // of their forms. `{{user}}` is the impersonated user's display name.
      impersonation: {
        passwordTitle: '{{user}} must change their password',
        mfaTitle: '{{user}} must set up two-factor authentication',
        body: 'You are impersonating {{user}}, and only they can do this themselves. Stop impersonating to return to your own account.',
      },
    },
  },
  // The OAuth authorization-code consent screen (`/oauth/consent`). A third
  // party asks for scopes and the signed-in user grants or denies them, so
  // every string here is a security decision the user must read in their own
  // language — objectui#3546 slice three.
  oauth: {
    consent: {
      // `{{appName}}` is the client's registered name, or `unknownApp` while the
      // lookup is in flight or when it gives no name. `{{suffix}}` is the
      // parenthesised account hint the page passes (empty when no user is
      // loaded), so it must stay attached to the sentence's last word.
      title: '{{appName}} wants to access your account',
      request: '{{appName}} is requesting permission{{suffix}}.',
      unknownApp: 'an application',
      // Shown when the lookup gives no registered name, above the raw
      // `client_id` labelled `clientId` — the id is never shown as the name.
      unidentified: 'This application could not be identified.',
      clientId: 'Client ID',
      willAllow: 'This app will be able to:',
      // Only the seven scopes the page maps by name; anything else renders the
      // raw scope string, which is why there is no generic entry here.
      scope: {
        openid: 'Confirm your identity',
        profile: 'Read your basic profile (name, picture)',
        email: 'Read your email address',
        offlineAccess: 'Stay signed in (refresh access)',
        dataRead: 'Read records, within your own permissions',
        dataWrite: 'Create, change and delete records, within your own permissions',
        actionsExecute: 'Run actions on your behalf, within your own permissions',
      },
      deny: 'Deny',
      authorize: 'Authorize',
      submitting: 'Authorizing…',
      granted: 'Access granted',
      denied: 'Access denied',
      noRedirect: 'No redirect URL returned by the server.',
      failed: 'Consent failed',
      footer: 'You can revoke access at any time from your account settings.',
    },
  },
  profile: {
    title: 'Profile',
    subtitle: 'Manage your account settings',
    saving: 'Saving…',
    avatar: {
      upload: 'Upload',
      replace: 'Replace',
      remove: 'Remove',
    },
    info: {
      title: 'Personal Information',
      description: 'Update your name and view account details',
      saved: 'Profile updated successfully.',
      name: 'Name',
      email: 'Email',
      emailImmutable: 'Email cannot be changed.',
      role: 'Role',
      save: 'Save Changes',
    },
    language: {
      title: 'Language',
      description: 'The language used for notifications and messages sent to you. The interface language is chosen separately, from the globe menu.',
      label: 'Preferred language',
      systemDefault: 'Use the deployment default',
      save: 'Save',
      saved: 'Language preference updated.',
      readOnly: 'Your administrator manages the language for your account.',
    },
    password: {
      changeTitle: 'Change Password',
      setTitle: 'Set Local Password',
      changeDescription: 'Update the password you use to sign in.',
      setDescription:
        'You signed in via single sign-on. Set a local password to also sign in with email and password.',
      current: 'Current password',
      new: 'New password',
      password: 'Password',
      confirm: 'Confirm password',
      tooShort: 'Password must be at least 8 characters',
      mismatch: 'Passwords do not match',
      enterCurrent: 'Enter your current password',
      changed: 'Password changed.',
      localSet: 'Local password set. You can now sign in with email and password.',
      changeAction: 'Change password',
      setAction: 'Set password',
    },
  },
  errors: {
    networkError: 'Network error. Please check your connection.',
    serverError: 'Server error. Please try again later.',
    notFound: 'Resource not found.',
    unauthorized: 'You are not authorized to perform this action.',
    forbidden: 'Access denied.',
    timeout: 'Request timed out. Please try again.',
    unknown: 'An unexpected error occurred.',
  },
  // A refused write's message (objectui#13332): its first sentence is shown,
  // and the whole server text sits behind the More / Less toggle with a copy
  // button. Read by app-shell's `RefusalMessage`.
  refusalDetails: {
    more: 'More',
    less: 'Less',
    copy: 'Copy details',
    copied: 'Copied',
  },
  workspace: {
    label: 'Organizations',
    default: 'My Organization',
    switch: 'Switch organization',
    createTitle: 'Create an organization',
    createDescription: 'An organization is a shared space for your team to collaborate.',
    createButton: 'Create organization',
    nameLabel: 'Organization name',
    namePlaceholder: 'e.g., Acme Inc',
    slugLabel: 'URL slug',
    slugHint: 'Used in URLs. Only lowercase letters, numbers, and hyphens.',
    invite: 'Invite member',
    members: 'Members',
    settings: 'Organization settings',
    multiOrgDisabled: 'Creating new organizations is disabled on this instance.',
    createFailed: 'Failed to create organization',
  },
  help: {
    onThisPage: 'On this page',
    appDocs: "This app's docs",
    allDocs: 'All documentation',
    keyboardShortcuts: 'Keyboard shortcuts',
    onlineDocs: 'Online documentation',
    loadingDocumentation: 'Loading documentation',
    about: 'About',
    aboutTitle: 'About this console',
    aboutDescription: 'The build this console was compiled from.',
    aboutBuild: 'Console build',
    aboutBuildUnknown: 'Unknown build (no version was set when this console was built)',
  },
  sidebar: {
    settings: 'Settings',
    helpTooltip: 'Help & Documentation',
    activityFeed: 'Activity feed',
    notifications: 'Notifications',
    approvals: 'Approvals',
    inbox: 'Inbox',
    inboxAriaLabel: 'Open inbox',
    area: 'Area',
    scope: 'Scope',
    packageManagement: 'Package management',
    searchNavigation: 'Search navigation…',
    recent: 'Recent',
    starred: 'Starred',
    removeFromFavorites: 'Remove {{name}} from favorites',
    allReports: 'All reports',
  },
  topbar: {
    aiAssistant: 'AI Assistant',
    designInStudio: 'Design in Studio',
    editApp: 'Edit app',
    openAssistant: 'Open {{name}} assistant',
    offline: 'Offline',
    usersOnline: 'Users currently online',
    switchView: 'Switch view',
    connection: {
      connecting: 'Connecting…',
      reconnecting: 'Reconnecting…',
      disconnected: 'Disconnected',
      error: 'Connection Error',
    },
    // Platform lifecycle chip shown next to the product wordmark (PreviewBadge).
    stage: {
      preview: 'Preview',
      beta: 'Beta',
      tooltip: 'This platform is in preview — features may change.',
    },
  },
  home: {
    title: 'Home',
    nav: 'Home',
    allApps: 'All Applications',
    yourApps: 'Your apps',
    showMoreApps: 'More',
    showLess: 'Show less',
    continueEmpty: 'Items you open will show up here.',
    // objectui#12602 — Home's "My work" section: its heading, the link to the
    // full inbox, each column's title, "view all" link and empty line.
    myWork: {
      title: "My work",
      openInbox: "Open inbox",
      viewAll: "View all",
      approvals: "Awaiting approval",
      approvalsEmpty: "Nothing waiting for your approval",
      notifications: "Notifications",
      notificationsEmpty: "No unread notifications",
    },
    greetingMorning: 'Good morning',
    greetingAfternoon: 'Good afternoon',
    greetingEvening: 'Good evening',
    greetingNight: 'Working late',
    // objectui#11689 — the greeting's two joiners: the separator between the
    // greeting and the person's name (rendered only when there is a name), and
    // the closing mark. Punctuation is a locale property: zh-CN and ja write
    // full-width marks, ar its own comma.
    greetingSeparator: ', ',
    greetingEnd: '.',
    // objectui#12601 — the field in Home's top bar that opens the command palette.
    search: 'Search apps, records, pages…',
    // objectui#12601 — the line under the greeting that sums up what is
    // waiting: the approvals count, or `none` at zero.
    summary: {
      approvals: 'You have {{count}} approval(s) waiting today',
      approvals_one: 'You have {{count}} approval waiting today',
      approvals_other: 'You have {{count}} approvals waiting today',
      none: 'Nothing is waiting for you today',
    },
    // objectui#12601 — an admin's trailing tile in the apps strip; opens the marketplace.
    addApp: 'Add app',
    // objectui#12601 — the line under a Home app tile: when the user last had
    // the app open, `time` a compact relative time ("2 hr. ago"). The line is
    // 11 px in a 112 px tile and never cut, so a pack adds a verb only where
    // verb and time still fit (zh "{{time}}打开"); English does not have the
    // room for "Opened". Held to its width budget in every pack by
    // `appTileOpenedLine-12601.test.ts` (app-shell).
    appOpened: '{{time}}',
    build: {
      title: 'Build an app',
      noCapability: 'Building apps isn\'t available in this system — it requires the “Manage Metadata” permission, which your account doesn\'t have.',
    },
    template: {
      title: 'Start with a template',
      marketplaceDisabled: 'This runtime has no app marketplace configured, so there are no templates to install here.',
    },
    open: 'Open',
    loading: 'Loading…',
    welcome: 'Build your business system with AI',
    welcomeDescription: 'Describe your business in one sentence — AI generates the objects, screens, APIs and agent tools. Or start from scratch.',
    welcomeAdminDescription: 'Describe your business in one sentence — AI generates the objects, screens, APIs and agent tools. Or set things up yourself from the menu on the left.',
    welcomeAdminDescriptionNoBuild: 'Set up your first application from the Administration menu on the left. Once you have data, the AI assistant can help you explore it.',
    welcomeAdminDescriptionNoAi: 'Set up your first application from the Administration menu on the left.',
    noAppsTitle: 'No applications yet',
    noAppsDescription: 'The system is being set up — apps your admin shares with you will show up here.',
    buildWithAI: 'Build with AI',
    askAI: 'Ask AI',
    recoveryReminder: {
      message: 'Set a recovery password so you can still sign in if single sign-on is ever unavailable.',
      cta: 'Set password',
      dismiss: 'Dismiss',
    },
    pendingDrafts: {
      // objectui#12602 — the drafts row in Home's "My work" section: the
      // count, then the first draft names joined by `nameSeparator`, in
      // their package when they share one.
      title: "{{count}} unpublished change(s)",
      title_one: "{{count}} unpublished change",
      title_other: "{{count}} unpublished changes",
      inPackage: "{{names}} waiting to publish in {{package}}",
      waiting: "{{names}} waiting to publish",
      nameSeparator: ", ",
      cta: 'Publish',
      publishing: 'Publishing…',
      published: 'Published! Your changes are live.',
      publishFailed: 'Publish failed',
      // objectui#3546 slice six — the rest of `usePublishAllDrafts`'s toasts
      // (the ADR-0038 L3 probe / seed health report and the ADR-0066 ⑨
      // capability-reference lint). Same banner, same publish button, so they
      // live beside the five keys above rather than in a namespace of their own.
      nothing: 'Nothing to publish.',
      probeWarn: 'Published, but verification found problems.',
      seedWarn: 'Published, but some sample data failed to load.',
      publishedVerified: 'Published & verified — {{count}} sample row(s) live.',
      capabilityWarn: 'Authoring check: {{count}} capability reference(s) resolve nowhere.',
    },
    createFirstApp: 'Create app manually',
    systemSettings: 'System Settings',
    browseMarketplace: 'Browse App Marketplace',
    quickActions: {
      title: 'Quick Actions',
      manageObjects: 'Manage Objects',
      manageObjectsDesc: 'Configure data models',
      systemSettings: 'System Settings',
      systemSettingsDesc: 'Configure your system',
    },
    recentApps: {
      title: 'Recently Accessed',
      itemType: {
        object: 'Object',
        dashboard: 'Dashboard',
        page: 'Page',
        report: 'Report',
        package: 'Package',
        view: 'List view',
        record: 'Record',
        metadata: 'Metadata',
      },
    },
    starredApps: {
      title: 'Starred',
    },
    gettingStarted: {
      title: 'Make this home yours',
      description:
        'Star an app to pin it here for one-click access. Anything you open will show up under Recently Accessed automatically.',
      cta: 'Browse all applications',
    },
    appCard: {
      noDescription: 'No description',
      default: 'Default',
    },
  },
  layout: {
    appSwitcher: {
      home: 'Home',
      switchApplication: 'Switch Application',
      appsAvailable: '{{count}} apps available',
      addApp: 'Add App',
      editApp: 'Edit App',
      editNavigation: 'Edit Navigation',
      manageAllApps: 'Manage All Apps',
      systemConsole: 'System Console',
      noAppsConfigured: 'No apps configured',
      allApps: 'All apps',
      editAppInStudio: 'Edit {{app}} in Studio',
      backToHome: 'Back to home',
      settings: 'Settings',
      productHome: '{{product}} home',
    },
    systemNav: {
      systemSettings: 'System Settings',
      applications: 'Applications',
      appMarketplace: 'App Marketplace',
      objectManager: 'Object Manager',
      users: 'Users',
      organizations: 'Organizations',
      roles: 'Roles',
      configuration: 'Configuration',
      administration: 'Administration',
      datasources: 'Datasources',
      documentation: 'Documentation',
    },
    activityFeed: {
      title: 'Recent Activity',
      filter: 'Filter',
      empty: 'No recent activity',
      accessDenied: "You don't have permission to view activity.",
      viewAll: 'View all activity',
      ariaLabel: 'Activity feed',
      typeCreate: 'Create',
      typeUpdate: 'Update',
      typeDelete: 'Delete',
      typeComment: 'Comment',
      typeSystem: 'System',
      relativeJustNow: 'just now',
      relativeSecondsAgo: '{{count}}s ago',
      relativeMinutesAgo: '{{count}}m ago',
      relativeHoursAgo: '{{count}}h ago',
      relativeDaysAgo: '{{count}}d ago',
    },
    metadata: {
      label: 'Metadata',
      toggleTitle: 'Toggle Metadata Inspector',
      panelTitle: 'Metadata Inspector',
      jsonBadge: 'JSON',
      copyJson: 'Copy JSON',
    },
  },
  search: {
    title: 'Search',
    back: 'Back',
    placeholder: 'Search objects, dashboards, pages, reports…',
    inputAriaLabel: 'Search objects, dashboards, pages, reports',
    resultsCount: '{{count}} result for "{{query}}"',
    resultsCount_one: '{{count}} result for "{{query}}"',
    resultsCount_other: '{{count}} results for "{{query}}"',
    itemsAvailable: '{{count}} items available',
    itemsAvailable_one: '{{count}} item available',
    itemsAvailable_other: '{{count}} items available',
    noResults: 'No results found',
    noResultsHint: 'Try adjusting your search terms',
    typeObjects: 'Objects',
    typeDashboards: 'Dashboards',
    typePages: 'Pages',
    typeReports: 'Reports',
    badgeObject: 'object',
    badgeDashboard: 'dashboard',
    badgePage: 'page',
    badgeReport: 'report',
  },
  empty: {
    objectNotFound: 'Object Not Found',
    objectNotFoundDescription: 'Object "{{name}}" definition missing. Check your configuration or navigate back to select a valid object.',
    interfacePageSourceMissing: 'This interface page references "{{name}}", which is not available.',
    recordNotFound: 'Record not found',
    recordNotFoundDescription: 'The record you are looking for does not exist or may have been deleted.',
    recordAccessDenied: 'You don’t have access to {{object}} records',
    recordAccessDeniedDescription: 'You don’t have permission to view records of this type. Contact your administrator if you think you should have access.',
    recordLoadFailed: 'Couldn’t load this record',
    recordLoadFailedDescription: 'Something went wrong while loading it. Check your connection and try again.',
    pageNotFound: 'Page Not Found',
    pageNotFoundDescription: 'The page "{{name}}" could not be found. It may have been removed or renamed.',
    dashboardNotFound: 'Dashboard Not Found',
    dashboardNotFoundDescription: 'The dashboard "{{name}}" could not be found. It may have been removed or renamed.',
    reportNotFound: 'Report Not Found',
    reportNotFoundDescription: 'The report "{{name}}" could not be found. It may have been removed or renamed.',
    noAppsConfigured: 'No Apps Configured',
    noAppsConfiguredDescription: 'No applications have been registered. Create your first app or visit System Settings to configure your environment.',
    appNotAvailable: 'App not available',
    appNotAvailableDescription: 'This app is not available — try again in a moment.',
    appNotFound: "This app can't be opened",
    appNotFoundDescription: 'The server did not return this app for your account.',
    appUnreachable: "Couldn't reach the server",
    appUnreachableDescription: 'This app could not be checked. Try again in a moment.',
    appAccessDenied: "You don't have access to this app",
    appAccessDeniedDescription: 'This app exists, but your account is not authorized to open it. Ask an administrator to grant you access.',
    appAccessDeniedHome: 'Back to home',
    // objectui#12079 — the app root when the app serves this caller no navigation (`AppNoAccessEmptyState`).
    appNothingAvailable: 'Nothing in {{app}} is available to you yet',
    appNothingAvailableDescription: 'This app has no pages your account can open. Ask an administrator to grant you access.',
    appNothingAvailableGrantDescription: 'This app has no pages your account can open. You can grant access in Setup.',
    appNoReadableObjectDescription: 'Your account cannot read any of the records in this app yet. Ask an administrator to assign you a permission set.',
    appNoReadableObjectGrantDescription: 'Your account cannot read any of the records in this app yet. You can grant access in Setup.',
    openSetup: 'Open Setup',
    createFirstApp: 'Create Your First App',
    systemSettings: 'System Settings',
    back: 'Back',
  },
  preview: {
    empty: {
      loadFailedTitle: 'Draft preview failed to load',
      loadFailedDescription: 'The draft overlay could not be read. Retry, or check your connection.',
      notReadyTitle: '“{{app}}” isn’t in the draft yet',
      notReadyDescription: 'The build may still be running, or it may have failed before this app was staged. Check the conversation for the build status — this pane refreshes as drafts land.',
      nothingTitle: 'Nothing to preview yet',
      retry: 'Retry',
    },
    draftBar: {
      message: 'Draft preview — you are seeing unpublished changes. Nothing here is live until you publish.',
      messageClean: 'Draft preview — no unpublished changes; everything here is already live.',
      publish: 'Publish',
      publishing: 'Publishing…',
      exit: 'Exit preview',
      changes: 'Changes',
      // objectui#12968 — what is pending on the surface the preview shows.
      pendingHere: 'Draft preview · {{count}} unpublished changes on this page',
      pendingHere_one: 'Draft preview · {{count}} unpublished change on this page',
      pendingHere_other: 'Draft preview · {{count}} unpublished changes on this page',
      // Magic-moment hint: a freshly-built draft renders empty (dashboards at 0,
      // lists "Nothing here yet") because seed/sample rows only load on publish.
      // Say so plainly so an empty preview never reads as a broken build.
      sampleDataTitle: 'Sample data appears once you publish',
      sampleDataBody:
        'You’re previewing your app’s structure. Publish to load example records and make it live.',
      publishCta: 'Publish to see it live',
    },
    changes: {
      title: 'Pending changes',
      description: 'What publishing will change. New items are added; updates overwrite the live version.',
      loading: 'Loading pending changes…',
      loadFailed: 'Could not load pending changes:',
      empty: 'Nothing pending — every draft has been published.',
      kindNew: 'New',
      kindUpdate: 'Update',
      detailLoading: 'Loading detail…',
      detailLoadFailed: 'Could not load change detail:',
      detailNone: 'No differences detected — the draft matches the published version.',
      detailChangedKeys: 'Also changed:',
      confirmNote: 'Publishing releases all {{count}} pending drafts of this package atomically.',
      confirmNote_one: 'Publishing releases the {{count}} pending draft of this package atomically.',
      confirmNote_other: 'Publishing releases all {{count}} pending drafts of this package atomically.',
      // objectui#11591 — the package-less sheet: no package to batch, so each
      // draft publishes by itself and one that fails stays pending.
      confirmNoteSeparate: 'Publishing releases the {{count}} pending drafts one at a time: a draft that fails stays pending while the others go live.',
      confirmNoteSeparate_one: 'Publishing releases the {{count}} pending draft on its own: if it fails, it stays pending.',
      confirmNoteSeparate_other: 'Publishing releases the {{count}} pending drafts one at a time: a draft that fails stays pending while the others go live.',
      publishConfirm: 'Publish all',
      // objectui#12517 — the confirm posture's summary line above the list:
      // the item count, then one `{{n}} {{type}}` per type group.
      summaryItems: '{{count}} items',
      summaryItems_one: '{{count}} item',
      summaryItems_other: '{{count}} items',
      summaryType: '{{n}} {{type}}',
      // objectui#13147 — one count family per known metadata type, so the summary
      // reads "2 flows", not "2 flow". A type with no row here keeps `summaryType`.
      typeCount: {
        object: '{{count}} objects',
        object_one: '{{count}} object',
        object_other: '{{count}} objects',
        view: '{{count}} views',
        view_one: '{{count}} view',
        view_other: '{{count}} views',
        page: '{{count}} pages',
        page_one: '{{count}} page',
        page_other: '{{count}} pages',
        dashboard: '{{count}} dashboards',
        dashboard_one: '{{count}} dashboard',
        dashboard_other: '{{count}} dashboards',
        app: '{{count}} apps',
        app_one: '{{count}} app',
        app_other: '{{count}} apps',
        action: '{{count}} actions',
        action_one: '{{count}} action',
        action_other: '{{count}} actions',
        report: '{{count}} reports',
        report_one: '{{count}} report',
        report_other: '{{count}} reports',
        flow: '{{count}} flows',
        flow_one: '{{count}} flow',
        flow_other: '{{count}} flows',
        permission: '{{count}} permission sets',
        permission_one: '{{count}} permission set',
        permission_other: '{{count}} permission sets',
        agent: '{{count}} agents',
        agent_one: '{{count}} agent',
        agent_other: '{{count}} agents',
        email_template: '{{count}} email templates',
        email_template_one: '{{count}} email template',
        email_template_other: '{{count}} email templates',
      },
      // objectui#12929 — the unchecked choice under an added object field whose
      // literal default the batch publish can write into the existing records.
      backfillOption: 'Backfill default ({{count}} existing records)',
      backfillOption_one: 'Backfill default ({{count}} existing record)',
      backfillOption_other: 'Backfill default ({{count}} existing records)',
      backfillOptionNoCount: 'Backfill default',
      // [`7a90afdf9`] Pre-publish security-posture findings, shown next to
      // the confirm button so a refusal the door would issue is read BEFORE
      // the click rather than as a toast after the batch rolled back.
      securityBlockTitle: 'Publishing will be refused — {{count}} item(s) need a decision first',
      securityBlockTitle_one: 'Publishing will be refused — {{count}} item needs a decision first',
      securityBlockTitle_other: 'Publishing will be refused — {{count}} items need a decision first',
      securityBlockWhere: 'Fix it on the object under Settings → Record sharing, then publish again.',
    },
    // ADR-0045 — the materialized-but-unlisted app banner
    // (UnpublishedAppBar.tsx), sibling of draftBar above.
    unpublishedBar: {
      message: 'Unpublished app — fully functional, but only builders can see it. Publish to make it visible to your users.',
      publish: 'Publish',
      publishing: 'Publishing…',
      published: 'Published! The app is now visible to your users.',
      publishFailed: 'Publish failed',
    },
    // ADR-0067 — the append-only build/revert timeline (CommitTimeline.tsx);
    // `button` is the banner's entry point into it.
    history: {
      button: 'History',
      title: 'Build history',
      description: 'Every change to this app, newest first. Revert any step to undo it — no publish confirmation needed.',
      loadFailed: 'Could not load history:',
      // objectui#3529 — the retryable class gets its own sentence: a 503 means
      // the read never reached the commit store, which is a different operator
      // disposition from a 404/500 and must not read as a bare status code.
      loadFailedUnavailable:
        'Commit store temporarily unreachable — this read did not happen, so no history is shown. Retry in a moment.',
      loading: 'Loading history…',
      empty: 'No history yet for this app.',
      revertLabel: 'Reverted a change',
      applyLabel: 'Build change',
      revert: 'revert',
      // objectui#9266 — the count is INSIDE the value, one interpolated string
      // per pack. It used to be a bare unit word that `CommitTimeline` glued to
      // a number it rendered itself, which no pack could make agree: `de` read
      // `1 Elemente`, `ru` `1 элементов`, `ar` `1 عناصر`. Each pack now states
      // the count in its own count-INVARIANT idiom — `en` keeps the `(s)` marker
      // it already dodged with, `zh`/`ja`/`ko` keep the inline counter their
      // grammar needs no plural for, and `de`/`fr`/`es`/`pt`/`ru`/`ar` use the
      // label-colon form (`Elemente: 3`, `Элементов: 3`), which is the shape
      // `fields.textarea.charactersRemaining` already uses for this exact
      // reason. It needs no family: every pack's form reads at any number,
      // which is why `count-families-11445.test.ts` names it on its
      // count-neutral list rather than holding it to the family rule.
      items: '{{count}} item(s)',
      revertAction: 'Revert',
      reverted: 'Reverted — the change has been undone.',
      revertFailed: 'Revert failed',
      // The WRITE half of the same fact. Not "try again": the revert may have
      // landed before the 503, and re-issuing appends a second revert commit.
      revertUnavailable:
        'Commit store temporarily unreachable — the revert may not have been applied. Reopen this history to check before retrying.',
    },
  },
  actionDialog: {
    title: 'Action Parameters',
    description: 'Please provide the required information to continue.',
    selectPlaceholder: 'Select {{label}}',
    requiredError: '{{label}} is required',
    lookupPlaceholder: 'Record id for {{label}}',
    lookupHelpText: 'No reference object is configured for this parameter, so the record picker is unavailable. Enter a record id, or ask an administrator to fix the action parameter.',
    unresolvedParam: 'This parameter cannot be shown: the field it is backed by is missing from the object metadata, so the control it needs cannot be built. Ask an administrator to fix the action definition.',
    carryOverHint: 'Carried over unchanged (read-only)',
    cancel: 'Cancel',
    confirm: 'Confirm',
    uploading: 'Uploading…',
  },
  actionConfirm: {
    title: 'Confirm Action',
    confirm: 'Continue',
    cancel: 'Cancel',
  },
  navigationSync: {
    addedPage: 'Navigation updated: added page "{{name}}"',
    addedDashboard: 'Navigation updated: added dashboard "{{name}}"',
    removedPage: 'Navigation updated: removed page "{{name}}"',
    removedDashboard: 'Navigation updated: removed dashboard "{{name}}"',
    renamedPage: 'Navigation updated: renamed page "{{oldName}}" → "{{newName}}"',
    renamedDashboard: 'Navigation updated: renamed dashboard "{{oldName}}" → "{{newName}}"',
    undoLabel: 'Undo',
    undone: 'Navigation change undone',
    undoFailed: 'Failed to undo navigation change',
    updateFailed: 'Failed to update navigation',
  },
  objectActions: {
    deleteSuccess: '{{label}} deleted successfully',
    deleteFailed: 'Failed to delete {{label}}',
    noRecordId: 'No record ID provided',
    deleteConfirm: 'Are you sure you want to delete this record?',
    deleteConfirmTitle: 'Delete {{label}} "{{name}}"?',
    bulkDeleteConfirmTitle: 'Delete {{count}} {{label}} records?',
    bulkDeleteConfirmTitle_one: 'Delete {{count}} {{label}} record?',
    bulkDeleteConfirmTitle_other: 'Delete {{count}} {{label}} records?',
    deleteConfirmButton: 'Delete',
    bulkDeleteSuccess: 'Deleted {{count}} {{label}} records',
    bulkDeleteSuccess_one: 'Deleted {{count}} {{label}} record',
    bulkDeleteSuccess_other: 'Deleted {{count}} {{label}} records',
    bulkDeletePartial: '{{succeeded}} deleted, {{failed}} failed',
  },
  objectViewActions: {
    renameFailed: 'Failed to rename view',
    deleteFailed: 'Failed to delete view',
  },
  dashboardActions: {
    printDialogOpening: 'Opening your browser’s print dialog (not a PDF export)',
    exportFailed: 'Export failed: {{message}}',
    forecastSoon: 'Forecast view coming soon',
  },
  user: {
    // objectui#13461 — the top bar's avatar button, which holds only the avatar.
    accountMenu: 'Account menu',
    profile: 'Profile',
    settings: 'Settings',
    logout: 'Log out',
    preferences: 'Preferences',
    theme: 'Theme',
    language: 'Language',
  },
  organizations: {
    mine: 'My Organizations',
    create: 'Create organization',
    title: 'Organizations',
    heading: 'Your Organizations',
    subtitle: 'Select an organization to continue, or create a new one.',
    searchPlaceholder: 'Search for an organization',
    new: 'New organization',
    current: 'Current organization',
    manage: 'Manage',
    emptyTitle: 'No organizations yet',
    emptyDescription: 'Create your first organization to get started.',
    noMatches: 'No organizations match your search.',
  },
  // Organization MANAGEMENT (packages/app-shell/src/console/organizations/**
  // plus the workspace switcher). Distinct from `organizations` above, which
  // is the org PICKER — same domain, different surface, and the singular /
  // plural spelling is the only thing telling them apart at a call site.
  organization: {
    roles: {
      owner: 'Owner',
      admin: 'Admin',
      delegatedAdmin: 'Delegated Admin',
      member: 'Member',
      external: 'External',
    },
    errors: {
      notAllowedToInvite: 'You are not allowed to invite users to this organization',
      notAllowedToInviteWithRole: 'You are not allowed to invite a user with this role',
      alreadyInvited: 'This user has already been invited to this organization',
      organizationExists: 'Organization already exists',
      slugTaken: 'That URL slug is already taken',
      notAllowedToCreate: 'You are not allowed to create a new organization',
      notTheRecipient: 'You are not the recipient of the invitation',
      invitationNotFound: 'This invitation no longer exists or has expired',
      unknown: 'Something went wrong. Please try again.',
    },
    backToList: 'Back to organizations',
    notFound: 'Organization not found',
    notFoundDescription: 'This organization does not exist or you do not have access.',
    tabs: {
      members: 'Members',
      invitations: 'Invitations',
      settings: 'Settings',
    },
    members: {
      title: 'Members',
      inviteMember: 'Invite member',
      inviteRestrictedNote: 'Only organization admins can invite members.',
      inviteManagedNote: 'People join through your organization in the cloud. Invite them there.',
      removeMember: 'Remove member',
      removeConfirmTitle: 'Remove member?',
      removeConfirmDescription: 'This will remove {{name}} from the organization. They will lose access immediately.',
      removeConfirmAction: 'Remove',
      memberRemoved: 'Member removed',
      removeFailed: 'Failed to remove member',
      roleUpdated: 'Role updated',
      roleUpdateFailed: 'Failed to update role',
      memberActions: 'Member actions',
      loadFailed: 'Failed to load members',
    },
    invitations: {
      title: 'Invitations',
      empty: 'No invitations found.',
      expiresAt: 'Expires',
      linkCopied: 'Invitation link copied',
      copyFailed: 'Failed to copy link',
      canceled: 'Invitation canceled',
      cancelFailed: 'Failed to cancel invitation',
      cancelTitle: 'Cancel invitation?',
      cancelDescription: 'The invitation for {{email}} will be revoked.',
      cancelAction: 'Cancel invitation',
      inviteTitle: 'Invite a member',
      inviteDescription: 'They will receive an invitation to join this organization.',
      emailLabel: 'Email',
      roleLabel: 'Role',
      // Placement = business unit + positions applied to the invitee on
      // accept. The lists are already filtered to what the inviter may
      // delegate.
      placementLabel: 'Placement (optional)',
      placementDescription: 'Applied when the invitation is accepted. Only units and positions you may delegate are listed.',
      businessUnitLabel: 'Business unit',
      businessUnitPlaceholder: 'No placement',
      positionsLabel: 'Positions',
      sendInvite: 'Send invite',
      sentTitle: 'Invitation created',
      sentDescription: 'Share the link below with the invitee. They will need to sign in to accept.',
      linkLabel: 'Accept link',
      invitedAs: '{{email}} invited as {{role}}',
      copyLinkLabel: 'Copy invitation link',
      loadFailed: 'Failed to load invitations',
      inviteFailed: 'Failed to invite member',
      status: {
        all: 'All',
        pending: 'Pending',
        accepted: 'Accepted',
        rejected: 'Rejected',
        canceled: 'Canceled',
      },
    },
    settings: {
      generalTitle: 'General',
      generalDescription: 'Update your organization information.',
      readOnlyNote: 'Only owners can change settings.',
      nameLabel: 'Organization name',
      // The org's URL segment. `deleteConfirmSlugLabel` asks the user to
      // retype it, so the two must keep naming the same thing.
      slugLabel: 'Slug',
      slugLockedNote: 'This organization has active environments, so its slug can’t be changed here: renaming it also moves their subdomains.',
      logoLabel: 'Logo',
      logoUpload: 'Upload',
      logoReplace: 'Replace',
      logoClear: 'Remove',
      logoUploaded: 'Logo uploaded — save to apply',
      logoUploadFailed: 'Failed to upload logo',
      save: 'Save changes',
      saved: 'Settings saved',
      saveFailed: 'Failed to save settings',
      leaveTitle: 'Leave organization',
      leaveDescription: 'You will lose access to this organization.',
      leaveAction: 'Leave',
      leaveConfirmTitle: 'Leave organization?',
      leaveConfirmDescription: 'Are you sure you want to leave {{name}}? You will lose access immediately.',
      leaveConfirmAction: 'Leave',
      leftOrg: 'You have left the organization',
      leaveFailed: 'Failed to leave organization',
      dangerZone: 'Danger zone',
      deleteTitle: 'Delete organization',
      deleteDescription: 'Permanently delete this organization and all its data.',
      deleteAction: 'Delete',
      deleteConfirmTitle: 'Delete organization?',
      deleteConfirmDescription: 'This action is irreversible. All data will be permanently deleted. Type the organization slug to confirm.',
      deleteConfirmSlugLabel: 'Type "{{slug}}" to confirm',
      deleteConfirmAction: 'Delete organization',
      deleted: 'Organization deleted',
      deleteFailed: 'Failed to delete organization',
    },
    accept: {
      title: 'You have been invited',
      description: 'You have been invited to join {{orgName}} as {{role}}.',
      errorTitle: 'Invitation unavailable',
      goToOrgs: 'Go to organizations',
      loading: 'Loading invitation…',
      organization: 'Organization',
      role: 'Role',
      expiresAt: 'Expires',
      accept: 'Accept invitation',
      accepted: 'Invitation accepted',
      acceptFailed: 'Failed to accept invitation',
      decline: 'Decline',
      declined: 'Invitation declined',
      declineFailed: 'Failed to decline invitation',
    },
    current: {
      label: 'Current organization',
    },
    switcher: {
      label: 'Switch organization',
      groupLabel: 'Working organization',
      groupHint: 'New records are created here. Views show data from all your organizations.',
      manageMembers: 'Manage members',
    },
  },
  notifications: {
    regionLabel: 'Notifications',
    empty: 'No notifications',
    emptyUnread: "You're all caught up",
    filterUnread: 'Unread',
    filterAll: 'All',
    markAllRead: 'Mark all read',
    viewAll: 'View all notifications',
    groupCount: '{{count}} notifications',
    groupUnread: '{{count}} unread',
    groupUnread_one: '{{count}} unread',
    groupUnread_other: '{{count}} unread',
    groupMarkRead: 'Mark read',
    groupMarkReadTitle: 'Mark all of this type read',
    approvalsPending: '{{count}} pending approvals',
    approvalsPending_one: '{{count}} pending approval',
    approvalsPending_other: '{{count}} pending approvals',
    viewApprovals: 'View approvals',
    noPendingApprovals: 'No pending approvals',
    openApprovalsInbox: 'Open Approvals Inbox',
    // Bell-badge breakdown (objectstack-ai/objectstack#7233): the badge sums unread notification topics
    // and pending approvals, then clamps at "9+". These three spell the sum
    // out inside the popover so the number is explainable.
    badgeTotal: '{{total}} total',
    badgeNotifications: '{{count}} notifications',
    badgeNotifications_one: '{{count}} notification',
    badgeNotifications_other: '{{count}} notifications',
    badgeApprovals: '{{count}} pending approvals',
    badgeApprovals_one: '{{count}} pending approval',
    badgeApprovals_other: '{{count}} pending approvals',
    // objectui#7011 — the arrival announcement (toast / desktop notification)
    // and the two switches that govern it.
    arrivalMany: '{{count}} new messages',
    arrivalMany_one: '{{count}} new message',
    arrivalMany_other: '{{count}} new messages',
    arrivalRepeats: '{{count}} new messages on this topic',
    arrivalRepeats_one: '{{count}} new message on this topic',
    arrivalRepeats_other: '{{count}} new messages on this topic',
    arrivalOpen: 'View',
    toastEnabled: 'In-app alerts',
    desktopEnabled: 'Desktop notifications',
    desktopBlocked: 'Blocked. Allow notifications for this site in your browser settings.',
    desktopUnsupported: 'This browser does not support desktop notifications.',
  },
  // objectui#13460 — the share-link dialog (`@object-ui/components` `ShareDialog`).
  shareDialog: {
    title: 'Share {{label}}',
    thisRecord: 'this record',
    description: 'Generate a link anyone (or selected people) can use to open this record. Links can be revoked at any time.',
    whoCanAccess: 'Who can access',
    audienceLinkOnly: 'Anyone with the link',
    audienceLinkOnlyHelp: 'No sign-in required',
    audienceSignedIn: 'Signed-in users',
    audienceSignedInHelp: 'Must be logged in to view',
    expiresIn: 'Expires in',
    expiry1d: '1 day',
    expiry7d: '7 days',
    expiry30d: '30 days',
    expiry90d: '90 days',
    expiryNever: 'Never',
    password: 'Password (optional)',
    passwordPlaceholder: 'Require a password to open',
    label: 'Label (only you see this)',
    labelPlaceholder: 'e.g. Sent to design review',
    createLink: 'Create link',
    existingLinks: 'Existing links',
    existingLinksCount: 'Existing links ({{n}})',
    noLinks: 'No share links yet. Create one above.',
    revokedHeading: 'Revoked',
    revokedBadge: 'revoked',
    copy: 'Copy',
    copied: 'Copied!',
    revoke: 'Revoke',
    loadFailed: 'Failed to load share links',
    createFailed: 'Failed to create share link',
    revokeFailed: 'Failed to revoke link',
  },
  // objectui#13460 — the public landing of a `/s/:token` share link (`SharedRecordPage`).
  sharedRecord: {
    signInTitle: 'Sign in required',
    signInBody: 'The owner shared this link with signed-in users only.',
    signIn: 'Sign in',
    passwordTitle: 'Password required',
    passwordBody: 'The owner protected this link with a password.',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Enter password',
    continue: 'Continue',
    cannotOpen: "Can't open this link",
    passwordUnsendable: "This password has characters that can't be sent, such as Chinese characters or emoji. Ask the link's owner to set a password without them.",
    wrongPassword: 'Wrong password.',
    loadFailedStatus: 'Failed to load (HTTP {{status}}).',
    invalidLink: 'This link is invalid or no longer available.',
    expiredLink: 'This link has expired or was revoked.',
    loadFailed: 'Failed to load shared content.',
    sharedConversation: 'Shared conversation',
    loadingMessages: 'Loading messages…',
    noMessages: 'This conversation has no messages yet.',
    sharedObject: 'Shared {{object}}',
    redactedFields: 'Some fields are hidden by the owner: {{fields}}',
  },
  publicForm: {
    submit: 'Submit',
    submitting: 'Submitting…',
    submitAnother: 'Submit another response',
    poweredBy: 'Powered by ObjectStack',
    secureNotice: 'Your information is transmitted securely and only used to respond to your request.',
    thankYouTitle: 'Thank you!',
    thankYouMessage: 'Your submission has been received successfully.',
    redirecting: 'Redirecting in {{seconds}} seconds…',
    // The console form page's line for a submit whose declared redirect is
    // pending (objectui#11071). `redirecting` above is the embeddable form's
    // countdown and carries a `{{seconds}}` hole this page has no value for.
    redirectPending: 'Redirecting…',
    unavailableTitle: 'Form unavailable',
    unavailableDescription:
      'No public form is available at this URL. Make sure the underlying view has anonymous sharing enabled and matches this slug.',
    tryDemo: 'Try the demo',
    retry: 'Retry',
    loading: 'Loading form…',
    requiredHint: '* Required field',
    // The console form page's client-side refusal when required rows are empty
    // (objectui#11071). `{{fields}}` is the empty rows' labels joined with a
    // comma; the colon, its spacing and the order are the pack's.
    requiredFields: 'Required: {{fields}}',
    consentLabelDefault: 'I agree to the privacy policy and consent to my data being processed for this request.',
    consentLink: 'Privacy policy',
    consentRequired: 'Please accept the privacy policy to continue.',
    rateLimited: 'Please take a moment to review your answers before submitting.',
    redirectBlocked: 'Submission accepted, but the redirect URL was blocked for security.',
  },
  connectAgent: {
    disabled: {
      title: 'MCP is disabled on this deployment',
      body: 'The MCP surface is off (OS_MCP_SERVER_ENABLED=false), so there is nothing to connect. Ask your operator to re-enable it.',
    },
    url: {
      title: 'This system\'s MCP endpoint',
      body: 'Any MCP-capable AI client connects with this URL. Identity is self-serve: the deployment is its own OAuth 2.1 authorization server, so interactive clients just open a browser login — you connect as yourself, and every call runs under your own permissions and row-level security.',
      downloadSkill: 'Download SKILL.md',
      skillHint: 'The portable agent skill: teaches any skills-capable agent how to work with this system.',
    },
    claude: {
      body: 'Settings → Connectors → Add custom connector, then paste this URL. Sign in through the browser when prompted.',
      reachability: 'claude.ai (web) connects from Anthropic\'s servers — the deployment must be reachable over public HTTPS. Claude Desktop and local clients also reach intranet deployments.',
    },
    claudeCode: {
      body: 'One command — the OAuth login opens automatically on first use:',
      plugin: 'Or install the official plugin (adds the ObjectStack skill and a guided /objectstack:connect command):',
    },
    cursor: {
      addButton: 'Add to Cursor',
      body: 'Use the one-click button, or add this to .cursor/mcp.json:',
    },
    vscode: {
      body: 'Add to .vscode/mcp.json (or via the MCP: Add Server command):',
    },
    codex: {
      body: 'Add to ~/.codex/config.toml. If your Codex version lacks the OAuth flow, use an API key header instead (see below):',
    },
    apiKey: {
      title: 'API keys',
      badge: 'headless',
      body: 'For CI, scripts, and agents without a browser. The key acts as you — treat it like a password. It is shown ONCE.',
      namePlaceholder: 'Key name (e.g. ci-agent)',
      mint: 'Create key',
      confirmTitle: 'Create the API key "{{name}}"?',
      minting: 'Creating…',
      showOnce: 'Key "{{name}}" created — copy it now, it will not be shown again:',
      done: 'Done — hide it',
    },
  },
  excelImport: {
    noImportableFields: 'That object has no importable fields.',
    schemaReadFailed: 'Could not read the object schema.',
    imported: 'Imported {{count}} row(s) into {{object}}.',
    imported_one: 'Imported {{count}} row into {{object}}.',
    imported_other: 'Imported {{count}} rows into {{object}}.',
    importFrom: 'Import the real rows from',
    into: 'into',
    opening: 'Opening…',
    importAction: 'Import',
    dismiss: 'Dismiss',
  },
  // `cloud:workspace-timezone-notice` — the Cloud welcome page's line naming the
  // timezone a workspace was seeded with at creation (objectui#11930). `{{zone}}`
  // is the seed, an IANA id printed verbatim.
  cloudWorkspaceTimezoneNotice: {
    seeded: 'The environment timezone was set to {{zone}} from your browser when the environment was created. You can change it in Settings → Localization.',
  },
  // `@object-ui/plugin-ai` — the `nl-query`, `ai-form-assist` and
  // `ai-recommendations` components (objectui#10232). The two count labels are
  // i18next count families (objectui#11445): the component passes `count` and
  // each pack carries every CLDR category its language selects.
  ai: {
    nlQuery: {
      placeholder: 'Ask a question about your data…',
      ask: 'Ask',
      results: 'Results',
      match: '{{percent}} match',
      simulatedSummary: 'Results for: {{query}}',
      noResults: 'No matching records found',
      recentQueries: 'Recent Queries',
    },
    formAssist: {
      title: 'AI Suggestions',
      suggestionCount: '{{count}} suggestions',
      suggestionCount_one: '{{count}} suggestion',
      suggestionCount_other: '{{count}} suggestions',
      applyAll: 'Apply All',
      confidence: '{{percent}} confidence',
      appliedCount: '{{count}} suggestions applied',
      appliedCount_one: '{{count}} suggestion applied',
      appliedCount_other: '{{count}} suggestions applied',
    },
    recommendations: {
      title: 'Recommendations',
      generating: 'Generating recommendations…',
      empty: 'No recommendations available',
    },
  },
  // The AI HITL approval inbox (`@object-ui/plugin-chatbot`'s
  // `AiPendingActionsInbox`) — objectui#7173. Its four relative-time phrases
  // are NOT here: it borrows `detail.justNow` / `minutesAgo` / `hoursAgo` /
  // `daysAgo`, already translated in all ten packs, the way `ObjectGrid` and
  // `ObjectKanban` borrow `detail.recordDetail`. Distinct from
  // `approvalsInbox` above, which is the human approval-PROCESS inbox:
  // different surface, different feature, so no rows are shared with it.
  aiApprovals: {
    title: 'AI Approvals',
    description: 'Actions an AI agent proposed that need a human review before execution.',
    tabPending: 'Pending',
    tabDecided: 'Decided',
    tabAll: 'All',
    statusPending: 'Pending',
    statusApproved: 'Approved',
    statusExecuted: 'Executed',
    statusFailed: 'Failed',
    statusRejected: 'Rejected',
    colTool: 'Tool',
    colAction: 'Action',
    colObject: 'Object',
    colStatus: 'Status',
    colProposed: 'Proposed',
    colDecision: 'Decision',
    emptyTitle: 'No actions waiting',
    emptyDescription: 'When the AI proposes a sensitive action it will appear here for review.',
    view: 'View',
    approve: 'Approve',
    reject: 'Reject',
    working: 'Working…',
    approveAndExecute: 'Approve & Execute',
    outcomeApprove: 'Approve for {{id}}: {{message}}',
    outcomeReject: 'Reject for {{id}}: {{message}}',
    outcomeExecuteFailed: 'Action failed during execution',
    drawerFallbackTitle: 'Pending action',
    drawerSubtitle: 'Tool {{tool}} on {{object}}',
    fieldProposedBy: 'Proposed by',
    fieldDecidedBy: 'Decided by',
    fieldConversation: 'Conversation',
    fieldToolInput: 'Tool input',
    fieldResult: 'Result',
    fieldError: 'Error',
    fieldRejectionReason: 'Rejection reason',
    rejectTitle: 'Reject this action?',
    rejectBody: 'The reason is shown back to the AI so it can adjust its next response.',
    rejectPlaceholder: "Optional reason (e.g. 'Wrong record id — please confirm with the user first.')",
  },
  aiModelStatus: {
    summary: 'Build / Ask uses {{conversational}} ({{conversationalSource}}); structured uses {{structured}} ({{structuredSource}}).',
    summaryRouting: 'Routing policy: free plans → {{free}}, paid plans → {{paid}}.',
    modelUnknown: 'unknown',
    sourceUnknown: 'not reported by the adapter',
    rowConversational: 'Build / Ask model',
    rowStructured: 'Structured (blueprint / seed)',
    rowReasoning: 'Reasoning effort',
    readFailed: 'Couldn\'t read the effective AI model. This system may not run an AI service, or you may lack the ai:read permission.',
    readFailedWithStatus: 'Couldn\'t read the effective AI model (HTTP {{status}}). This system may not run an AI service, or you may lack the ai:read permission.',
    overridesInEffect: 'Overrides in effect: ',
    noOverrides: 'none — running the deployed code defaults.',
    adapter: 'Adapter: ',
    sourceCodeDefault: 'code default (no env override)',
    sourceInherits: 'same as build/ask',
    sourcePinned: 'pinned by {{source}}',
  },
  // objectui#7254 — the AI copilot's tool cards. Three families, all of them
  // English-only until this landed while every other string on the same screen
  // was translated:
  //
  //   `tool.*`      — one entry per PLATFORM-PROVIDED tool name
  //                   (@objectstack/spec `PLATFORM_TOOLS_BY_PACKAGE`, the
  //                   closed registry those runtimes are conformance-tested
  //                   against). `humanizeToolName` looks each up as
  //                   `chatbot.tool.<tool_name>` and falls back to its English
  //                   title-caser for a custom / third-party tool, so a name
  //                   missing here is degraded, never broken. Every value, `en`
  //                   included, is a short sentence in the pack's language
  //                   saying what the step does (cloud#2927 Target 3, ruled
  //                   「同意」; objectui#12724): never the tool id, and never
  //                   the title-caser's output for it, which is how the step
  //                   reads for a tool the pack has no entry for.
  //                   `toolLabels-locale-parity-7481` holds both.
  //   `toolState.*` — the card-header badge + activity-chip vocabulary. ONE
  //                   set for both surfaces (they used to carry separate
  //                   tables and disagreed on casing).
  //   `build.*`    — the apply_blueprint BUILD PANEL's own copy (objectui#7388).
  //                   Everything else on that panel is fed by the host as an
  //                   already-translated prop; these strings were literals in
  //                   the component, so they stayed English in every language.
  //                   `building`/`built` interpolate `appFallback` when the
  //                   build has no app label, so each pack must keep BOTH
  //                   frames in the one case/gender that noun phrase is in.
  //                   `verifying`/`verifyStep`/`verified` are the post-apply
  //                   verification line and `unknownPhase` the warning for a
  //                   phase outside the spec's vocabulary (objectui#11988).
  //   `plan.*`      — the "N objects · N views · N dashboards" strip. Plural
  //                   FAMILIES: one slot per CLDR category the pack's language
  //                   selects (objectui#11432), plus the base key for a call
  //                   made without a count. `all-locales-key-parity.test.ts`
  //                   derives the required slots from `Intl.PluralRules`.
  //
  // objectui#7481 — five `tool.*` entries are NEWER than the registry above:
  // `get_authoring_rules` (cloud#1837), `load_tools`, `open_record`, `test_flow`
  // and `toggle_flow` are registered by cloud `service-ai-studio` but the pinned
  // `@objectstack/spec` snapshot does not list them yet. They are kept here on
  // purpose: a step label the user reads must not wait on a pin bump. When the
  // pin advances, `chatbotToolLabels-locale-parity-7481` starts checking them
  // against the registry instead of against its own hand-held list.
  chatbot: {
    // objectui#13461 — the composer's send button and the scroll-to-latest button.
    sendMessage: 'Send message',
    scrollToBottom: 'Scroll to the latest message',
    answer: {
      showFull: 'Show full answer',
      collapse: 'Collapse',
      expandTable: 'Expand',
      exitExpandedTable: 'Close',
    },
    tool: {
      aggregate_data: 'Aggregate the data',
      get_record: 'Read the record',
      query_data: 'Query the data',
      query_records: 'Look up the records',
      search_knowledge: 'Search the knowledge base',
      visualize_data: 'Chart the data',
      add_field: 'Add a field',
      apply_blueprint: 'Build the app from the plan',
      apply_edit: 'Apply the change',
      create_metadata: 'Create a metadata item',
      create_object: 'Create an object',
      create_package: 'Create a package',
      create_seed: 'Generate sample data',
      delete_field: 'Delete a field',
      describe_metadata: 'Look at the metadata',
      describe_object: 'Look at the object structure',
      get_active_package: 'Check the active package',
      get_authoring_rules: 'Read the authoring rules',
      get_metadata_schema: 'Read the metadata format',
      get_package: 'Look at the package',
      list_metadata: 'List the existing metadata',
      list_objects: 'List the existing objects',
      list_packages: 'List the existing packages',
      load_tools: 'Load more tools',
      modify_field: 'Change a field',
      open_record: 'Open the record',
      propose_blueprint: 'Draft the app plan',
      set_active_package: 'Switch to the target package',
      suggest_builder: 'Suggest building it with AI',
      test_flow: 'Try out the flow',
      todo_write: 'Note follow-up checks',
      toggle_flow: 'Turn the flow on or off',
      update_metadata: 'Update a metadata item',
      validate_expression: 'Check the expression',
      verify_build: 'Check the build',
    },
    toolState: {
      agentActivity: 'Agent activity',
      pending: 'Pending',
      running: 'Running',
      awaitingApproval: 'Awaiting approval',
      responded: 'Responded',
      completed: 'Completed',
      error: 'Error',
      denied: 'Denied',
      failed: 'Failed',
    },
    phase: {
      build: 'Build',
      design: 'Design the plan',
      stepCount: '{{count}} steps',
      stepCount_one: '{{count}} step',
      stepCount_other: '{{count}} steps',
      expand: 'Show steps',
      collapse: 'Hide steps',
    },
    plan: {
      countObjects: '{{count}} objects',
      countObjects_one: '{{count}} object',
      countObjects_other: '{{count}} objects',
      countViews: '{{count}} views',
      countViews_one: '{{count}} view',
      countViews_other: '{{count}} views',
      countDashboards: '{{count}} dashboards',
      countDashboards_one: '{{count}} dashboard',
      countDashboards_other: '{{count}} dashboards',
      countSeedData: 'sample data',
      extendTarget: 'Adding to existing app: {{app}}',
      awaitingConfirm: 'Awaiting confirmation',
      objectsAndFields: 'Objects and fields',
      views: 'Views',
      suggestedField: 'suggested',
      nameField: 'Name: {{field}}',
    },
    build: {
      building: 'Building {{app}}…',
      built: 'Built {{app}}',
      builtAndLive: 'Built and live · {{app}}',
      appFallback: 'your app',
      addingSampleData: 'adding sample data',
      group: {
        object: 'Objects',
        view: 'Views',
        dashboard: 'Dashboards',
        app: 'App',
        seed: 'Sample data',
      },
      moreArtifacts: '+{{n}} more',
      verifying: 'Checking the change…',
      verifyStep: 'step {{n}}',
      verified: 'Checked the change',
      unknownPhase: 'Unknown build phase',
      nextStepsLead: 'Next, you can say: {{steps}}',
      nextStepQuote: '“{{step}}”',
      draftPosture: 'Later changes are saved as drafts, and you publish them in Studio.',
      checksPassed: 'Checks passed {{passed}}/{{total}}',
    },
    changes: {
      planTitle: 'Change plan · {{count}} changes',
      planTitle_one: 'Change plan · {{count}} change',
      planTitle_other: 'Change plan · {{count}} changes',
      saveDraft: 'Save as draft',
      reviewAndPublish: 'Review changes and publish',
      undo: 'Undo',
      undoWithOthers: 'Undo (and {{count}} other drafts)',
      undoWithOthers_one: 'Undo (and {{count}} other draft)',
      undoWithOthers_other: 'Undo (and {{count}} other drafts)',
      undoConfirm: 'Undo discards all {{total}} unpublished drafts of this package, including {{count}} that are not part of this change.',
      undoConfirm_one: 'Undo discards all {{total}} unpublished drafts of this package, including {{count}} that is not part of this change.',
      undoConfirm_other: 'Undo discards all {{total}} unpublished drafts of this package, including {{count}} that are not part of this change.',
      undoConfirmUnknown: 'Undo discards every unpublished draft of this package, not only this change.',
      undoConfirmAction: 'Undo all',
      undoCancel: 'Cancel',
      undoing: 'Undoing…',
      undone: 'Undone',
      undoFailed: 'Undo failed',
      kind: {
        field: 'Field',
        object: 'Object',
        view: 'View',
        dashboard: 'Dashboard',
        app: 'App',
        seed: 'Sample data',
        package: 'App package',
      },
    },
  },
  chatbotError: {
    title: 'Response failed',
    fallbackDetail: 'Something went wrong. Please try again.',
    details: 'Details',
    hide: 'Hide',
    retry: 'Retry',
  },
  chatbotQuota: {
    title: 'Upgrade needed',
    fallbackMessage: 'You have reached your AI quota.',
    buyCredits: 'Buy a credit pack',
    upgradePlan: 'Upgrade plan',
  },
  // Plan-tier labels, keyed by the TIER rather than by the surface that draws
  // them, so every plan-locked mark reuses one string (objectui#12190). The zh
  // value follows the cloud control plane's own zh plan label.
  planTier: {
    teamAndUp: 'Team plan and up',
  },
  environment: {
    setUpProduction: 'Set up your production environment',
    addDevelopment: 'Add development environment',
    // The plan-locked stand-in for the create action (objectui#12190).
    // `{{tier}}` is a `planTier.*` label.
    developmentLocked: 'Development environments · {{tier}}',
    // Plan/capacity dialog (EnvironmentEntitlementDialog). Shown on a paid
    // conversion path, so it must read in the user's language — cloud#959.
    entitlement: {
      productionLimitTitle: 'You already have your production environment',
      productionLimitBody:
        'Each organization includes exactly one production environment. Create a separate organization for another, or contact us about an Enterprise arrangement.',
      planLockedTitle: 'Development environments are a paid feature',
      planLockedBody:
        'Your {{plan}} includes one production environment. Upgrade to add development environments — build in dev, then publish to production.',
      limitTitle: 'Development environment limit reached',
      limitBody:
        'Capacity scales with AI seats. Add an AI seat, or archive an unused development environment to free one up.',
      limitBodyWithCount:
        'You are using {{used}} of {{limit}} development environments. Capacity scales with AI seats — add an AI seat, or archive an unused development environment to free one up.',
      freePlan: 'free plan',
      namedPlan: '{{plan}} plan',
      upgradeCta: 'Upgrade plan',
      contactSalesCta: 'Contact sales',
    },
  },
  cloudConnection: {
    checking: 'Checking connection…',
    retry: 'Try again',
    errors: {
      expired: 'The request expired before it was approved. Start again.',
      accessDenied: 'The connection request was denied. Start again.',
      bindFailed: 'Binding failed.',
      deviceCodeFailed: 'Device code request failed.',
    },
    waiting: {
      popupOpened: 'Approve the connection in the window that just opened — this page updates by itself.',
      polling: 'Waiting for approval in the cloud console…',
      openApproval: 'Open the approval page',
      copy: 'Copy',
      copied: 'Copied',
      codePrefilled: 'The code is pre-filled on the approval page.',
      openItHere: 'Window did not appear? Open it here',
      cancel: 'Cancel',
    },
    bound: {
      title: 'Connected to ObjectStack Cloud',
      runtime: 'Runtime',
      organization: 'Organization',
      approvedBy: 'Approved by',
      runtimeId: 'Runtime ID',
      environment: 'Environment',
      since: 'Since',
      privatePackages: 'Your organization\'s private packages now appear in the Marketplace under “Your organization”.',
      disconnect: 'Disconnect',
    },
    unbound: {
      title: 'Not connected',
      body: 'This runtime is not connected to a control plane. Connect opens your cloud account in a new window, where one click approves the link — no ids or credentials are typed into this page.',
      connect: 'Connect',
    },
  },
  marketplace: {
    title: 'App Marketplace',
      subtitle: 'Browse approved apps published to the ObjectStack catalog. Click an app to view details and install it into one of your environments.',
      searchPlaceholder: 'Search apps by name or app ID…',
      searchAria: 'Search marketplace apps',
      installed: 'Installed',
      installedCount: 'Installed ({{count}})',
      refresh: 'Refresh',
      all: 'All',
      noApprovedYet: 'No apps have been approved for the marketplace yet.',
      noMatchFilters: 'No apps match your filters.',
      noDescription: 'No description provided.',
      back: 'Back to marketplace',
      browseLink: 'Browse the marketplace →',
      installedAdditiveNote: 'Uninstall removes the app from the running kernel at once, together with its permission sets and their grants, and deletes the cached manifest so the package does not load at the next start. Records stored in its objects stay in the database.',
      versionBadge: 'v{{version}}',
      installedBadge: 'Installed v{{version}}',
      // objectui#11645 — an install-local entry this runtime refused to load at
      // startup (the listing's `notLoaded` marker), read on Installed Apps.
      notLoaded: {
        badge: 'Not loaded',
        protocolIncompatible: 'This runtime did not load this package: it targets protocol {{requiredRange}}, which this runtime does not support.',
        otherReason: 'This runtime did not load this package ({{code}}).',
      },
      load: {
        failed: 'Failed to load marketplace',
        failedHintConfigured: 'This runtime reaches the marketplace through the control plane at {{url}}. Check that it is online and reachable from here.',
        failedHintSameOrigin: 'The marketplace catalog is reached through this runtime. Check that the runtime is online and can reach the catalog.',
        loading: 'Loading the marketplace catalog…',
        slow: 'Still loading — the marketplace catalog is slow to answer.',
        retry: 'Retry',
        unreachable: 'The marketplace catalog could not be reached.',
        answeredError: 'The marketplace catalog answered with an error (HTTP {{status}}).',
        packageFailed: 'Failed to load package',
        notFound: 'Not found.',
      },
      disabled: {
        title: 'App Marketplace is turned off',
        description: 'This runtime has no marketplace configured, so there is nothing to browse or install from here.',
        hint: 'That is the expected state when the runtime is started with <code>OS_CLOUD_URL=off</code> (or <code>none</code>, <code>local</code>, <code>disabled</code>). To turn the marketplace on, point <code>OS_CLOUD_URL</code> at a control plane and restart the runtime.',
      },
      detail: {
        homepage: 'Homepage',
        installedV: 'Installed · v{{version}}',
        about: 'About',
        noReadme: 'No readme provided.',
        versions: 'Versions',
        noApprovedVersions: 'No approved versions.',
        prerelease: 'pre',
        moreOptions: 'More install options',
        uninstallFromRuntime: 'Uninstall from this runtime',
        addSampleData: 'Add sample data',
        reseedAgain: 'Re-seed sample data',
        purgeSampleData: 'Purge sample data',
        purgeConfirm: 'Delete all sample records seeded by this package? User-added records will NOT be touched.',
        purgeSuccess: 'Removed {{count}} sample record(s).',
        purgeSuccess_one: 'Removed {{count}} sample record.',
        purgeSuccess_other: 'Removed {{count}} sample records.',
        purgeNoData: 'No sample records found to purge.',
        reseedQueued: 'Sample data will be re-seeded on next environment access.',
        reseedLocalSuccess: 'Re-seeded sample data: {{inserted}} inserted, {{updated}} updated.',
        reseedPartialErrors: '({{count}} record(s) failed to write)',
        reseedPartialErrors_one: '({{count}} record failed to write)',
        reseedPartialErrors_other: '({{count}} records failed to write)',
        sampleDataKernelUnavailable: 'This control plane has no environment kernel, so sample data cannot be re-seeded or purged from here. Do it from the environment\'s own runtime.',
        updateAvailable: 'Update available',
      },
      action: {
        install: 'Install',
        reinstall: 'Reinstall',
        working: 'Working…',
        installToCloud: 'Install to cloud…',
        installed: 'Installed',
        installing: 'Installing…',
        updating: 'Updating…',
        uninstall: 'Uninstall',
        uninstalling: 'Uninstalling…',
        details: 'Details',
        close: 'Close',
        dismiss: 'Dismiss',
        openOnCloud: 'Open on cloud',
        backHome: 'Back to home',
        updateTo: 'Update',
      },
      install: {
        dialogTitle: 'Install {{name}}',
        dialogDescCurrent: 'Install into this environment ({{host}}).',
        dialogDescPicker: 'Choose an environment to install this app into. You need to be signed into ObjectStack Cloud.',
        environment: 'Environment',
        environmentPlaceholder: 'Pick an environment',
        includeSampleData: 'Include sample data',
        noEnvs: 'No environments found in your active organization.',
        noPermission: 'You do not have permission to install apps in any environment. Only organization owners and admins can install — ask your organization admin.',
        signInFirst: 'You need to sign into ObjectStack Cloud first. Click "Open on cloud" below.',
        success: 'Installed successfully. Open the environment to see the new app.',
        localSuccess: 'Installed v{{version}} to this runtime. "{{name}}" should now appear in the app switcher.',
        // objectui#12098 — the install answered `hotLoaded: false`: installed, and
        // the running kernel did not register it (objectstack#22695), so nothing
        // of it is served before the next restart.
        localLoadsAtRestart: 'Installed v{{version}} to this runtime. "{{name}}" loads when the runtime next restarts; it does not appear in the app switcher until then.',
        localManifestConflict: '{{message}}\nTip: a local app already owns this manifest_id. Remove it from objectstack.config.ts first.',
        localUnauthorized: 'Sign in to this runtime first, then try again.',
        localMarketplaceUnavailable: 'This runtime has no OS_CLOUD_URL configured, so the marketplace catalog is unreachable.',
        updateTo: 'Update → v{{version}}',
        installedVersion: 'Installed v{{version}}',
        // objectui#12087 — an install into THIS environment, from its answer
        // until the runtime serves the package's app (MarketplacePackagePage).
        deploying: 'Deploying the app…',
        deployed: 'The app is deployed and ready.',
        openApp: 'Open {{name}}',
        deployTimeout: 'The install was recorded, but this environment is not serving the app yet. It may still be deploying — check again shortly. If it never appears, the package may not have loaded, may include no app, or its app may need a permission you do not hold.',
        checkAgain: 'Check again',
        // ADR-0131 D6 — the install modes a package's manifest permits, and
        // what an unmanaged install answers (MarketplacePackagePage).
        mode: {
          label: 'Install mode',
          managed: 'Managed',
          managedHint: 'The package stays the authority: it is registered as code, receives its upgrades, and its items are not edited here.',
          unmanaged: 'Unmanaged copy',
          unmanagedHint: 'Copied once into this runtime as its own metadata: every item is editable here, and the copy receives no upgrade.',
          required: 'Choose an install mode to install this package.',
        },
        unmanagedSuccess: 'Copied v{{version}} of "{{name}}" into this runtime as its own metadata, in the base {{base}}. The copy is editable and receives no upgrade.',
        unmanagedStrippedLocks: 'The package locked these items. The copy is editable, so their locks were not copied:',
        unmanagedIgnored: 'This runtime does not support unmanaged installs, so "{{name}}" was installed managed (registered as code) instead of copied. Upgrade the runtime, then uninstall the package and install it again as an unmanaged copy.',
      },
      // objectui#12146 — the install dialog opened as an UPDATE of the copy
      // this environment holds (MarketplacePackagePage).
      update: {
        dialogTitle: 'Update {{name}}',
        dialogDescCurrent: 'Update the copy installed in this environment ({{host}}).',
        dialogDescPicker: 'Choose the environment whose installed copy to update. You need to be signed into ObjectStack Cloud.',
        majorNotice: 'This is a major version update (v{{fromMajor}} → v{{toMajor}}), which may include breaking changes.',
        releaseNotes: 'Read the v{{version}} release notes',
        success: 'Updated to v{{version}}.',
        deployTimeout: 'The update was recorded, but this environment is not serving v{{version}} yet. It may still be deploying — check again shortly.',
      },
      // objectui#3546 — the MarketplacePage "Your organization" strip.
      org: {
        heading: 'Your organization',
        install: 'Install',
        installed: 'Installed {{name}}',
        installedBadge: 'Installed',
        installing: 'Installing…',
      },
      // ADR-0025 PD4 §3.5/§3.11 — the pre-install consent panel
      // (PluginDisclosure.tsx). `runtime` is a CLOSED enum: spec
      // PluginRuntimeSchema = z.enum(['node', 'sandbox', 'worker']).
      disclosure: {
        containsCode: 'This package contains code',
        reviewed: 'Reviewed & approved',
        unreviewed: 'Not yet reviewed',
        signed: 'Signed',
        grantsIntro: 'This package requests:',
        notEnforced: 'Recorded at install, and re-confirmed if a later version asks for more — but the runtime does not yet restrict the package to this list.',
        services: 'Platform services',
        hooks: 'Lifecycle hooks',
        network: 'Network access',
        fs: 'Filesystem access',
        noPermissions: 'Requests no special permissions.',
        acknowledge: 'I understand this package runs code and grants the permissions above.',
        runtime: {
          node: 'In-process · full trust',
          sandbox: 'Sandboxed',
          worker: 'Out-of-process',
        },
      },
      // ADR-0090 D5/D9 — a package's isDefault permission set is an
      // install-time suggestion to bind it to the everyone/guest position;
      // the admin confirms here, the server never auto-binds.
      suggestedBindings: {
        promptEveryone: 'This app suggests granting "{{set}}" to all signed-in users (the Everyone position).',
        promptGuest: 'This app suggests granting "{{set}}" to unauthenticated visitors (the Guest position).',
        confirm: 'Grant',
        confirming: 'Granting…',
        dismiss: 'Dismiss',
        confirmedToast: '"{{set}}" is now granted to {{anchor}}.',
        dismissedToast: 'Suggestion for "{{set}}" dismissed.',
        guestUnsupported: 'Cannot be granted here: the Guest position takes no sets from accepted suggestions.',
        acceptedState: '"{{set}}" was accepted for all signed-in users (the Everyone position).',
        notInForceState: '"{{set}}" was accepted but is not in force yet: the Everyone position did not change on this request. The server log says why.',
        dismissedState: '"{{set}}" is not granted: the suggestion was dismissed or revoked.',
        revoke: 'Revoke',
        revoking: 'Revoking…',
        revokedToast: 'Acceptance of "{{set}}" revoked.',
      },
      uninstall: {
        confirm: 'Uninstall {{manifestId}} v{{version}} from this runtime?\n\nThe app will leave the running kernel at once, together with its permission sets and their grants, and its cached manifest will be removed. Records stored in its objects stay in the database.',
        successInList: 'Removed {{manifestId}}: the app has left the running kernel, with its permission sets and their grants. Records stored in its objects stay in the database.',
        successInDetail: 'Removed {{manifestId}} and its cached manifest: the app has left the running kernel, with its permission sets and their grants. Records stored in its objects stay in the database.',
        confirmNotLoaded: 'Uninstall {{manifestId}} v{{version}} from this runtime?\n\nThe cached manifest will be removed. This runtime did not load the package, so none of it is running.',
        successNotLoaded: 'Removed {{manifestId}}. It was not loaded, so no restart is needed.',
      },
      accessDenied: {
        title: 'App Marketplace is admin-only',
        description: 'You don\'t have permission to install apps in this environment. Ask an owner or admin of this organization for access.',
      },
      category: {
        crm: 'CRM',
        erp: 'ERP',
        hr: 'Human Resources',
        finance: 'Finance',
        project: 'Project Management',
        collaboration: 'Collaboration',
        analytics: 'Analytics',
        integration: 'Integration',
        automation: 'Automation',
        ai: 'AI',
        security: 'Security',
        'developer-tools': 'Developer Tools',
        'ui-theme': 'UI Theme',
        storage: 'Storage',
        other: 'Other',
      },
      relativeTime: {
        today: 'today',
        daysAgo: '{{count}}d ago',
        monthsAgo: '{{count}}mo ago',
        monthsAgo_one: '{{count}}mo ago',
        monthsAgo_other: '{{count}}mo ago',
        yearsAgo: '{{count}}y ago',
        yearsAgo_one: '{{count}}y ago',
        yearsAgo_other: '{{count}}y ago',
      },
    },
  approvalsInbox: {
    recordUnresolvable: 'This record cannot be opened',
    loadMore: 'Load more',
    loadingMore: 'Loading…',
    loadedOf: 'Loaded {{loaded}} of {{total}}',
    actEscalate: 'SLA escalated',
    systemSlaActor: 'System (SLA)',
    reassignBtn: 'Reassign',
    reassignTitle: 'Hand this approval to someone else?',
    reassignBody: 'Your approver slot moves to the person you pick — they are notified and can act immediately.',
    reassignTo: 'New approver',
    reassignToPlaceholder: 'Pick a user or type an email / role:<name>',
    reassignSuccess: 'Handed to {{to}}',
    requestInfoBtn: 'Request info',
    requestInfoTitle: 'Ask the requester for more information?',
    requestInfoBody: 'The request stays pending; the requester is notified and can reply on the thread.',
    requestInfoPlaceholder: 'What do you need from the requester?',
    requestInfoSent: 'Sent back to the requester for more information',
    remindBtn: 'Send reminder',
    remindSuccess: 'Reminder sent to {{count}} approver(s)',
    remindSuccess_one: 'Reminder sent to {{count}} approver',
    remindSuccess_other: 'Reminder sent to {{count}} approvers',
    remindThrottled: 'A reminder was sent recently — try again later.',
    replyPlaceholder: 'Reply on this request…',
    slaRemaining: 'SLA {{dur}} left',
    slaOverdue: 'SLA overdue {{dur}}',
    actReassign: 'Reassigned',
    reassignFromTo: 'from {{from}} to {{to}}',
    actRemind: 'Reminder sent',
    actRequestInfo: 'Requested more info',
    actComment: 'Commented',
    stepProgress: 'Approval steps',
    prevRequest: 'Previous',
    nextRequest: 'Next',
    positionOf: 'Request {{index}} of {{total}}',
    progressApprovals: 'Approvals — {{got}} of {{need}}',
    progressGroups: 'Sign-off progress — {{got}} of {{need}} groups',
    progressEligible: '{{count}} eligible approver(s)',
    progressEligible_one: '{{count}} eligible approver',
    progressEligible_other: '{{count}} eligible approvers',
    progressBar: 'Decision progress',
    declaredActions: 'Actions',
    decisionPanelOffRequestPage: 'The approval decision panel only works on approval request pages.',
    attachmentChip: 'Attachment',
    attachmentOpenFailed: 'Could not open the attachment — please try again',
    approveOneTitle: 'Approve "{{title}}"?',
    approveOneBody: 'This approves the request with your identity. To add a comment or attachment, open the request instead.',
    flowOrigin: 'Flow-initiated',
    sortBy: 'Sort',
    sortRecent: 'Newest first',
    sortOldest: 'Oldest first',
    sortAmount: 'Amount (high→low)',
    quickPhrase1: 'Approved — meets requirements.',
    quickPhrase2: 'Approved with conditions — please monitor execution.',
    quickPhrase3: 'Please add supporting material and resubmit.',
    title: 'Approvals Inbox',
    subtitle: 'Review and act on approval requests.',
    refresh: 'Refresh',
    tabMyPending: 'My Pending',
    tabSubmitted: 'Submitted by me',
    tabAll: 'All',
    searchPlaceholder: 'Search record, process, requester…',
    clearSearch: 'Clear search',
    statusFilter: 'Status',
    allStatuses: 'All statuses',
    processFilter: 'Process',
    allProcesses: 'All processes',
    objectFilter: 'Object',
    allObjects: 'All objects',
    filterCount: '{{shown}} of {{total}}',
    selected: 'selected',
    actionableCount: '({{count}} actionable)',
    actionableCount_one: '({{count}} actionable)',
    actionableCount_other: '({{count}} actionable)',
    selectAll: 'Select all',
    selectRow: 'Select request',
    colRequest: 'Request',
    colRecord: 'Record',
    colRequester: 'Requester',
    colStatus: 'Status',
    colWaiting: 'Submitted',
    colActions: 'Actions',
    statusPending: 'Pending',
    statusApproved: 'Approved',
    statusRejected: 'Rejected',
    statusRecalled: 'Recalled',
    statusReturned: 'Returned for revision',
    sendBackBtn: 'Send back',
    sendBackTitle: 'Send this request back for revision?',
    sendBackBody: 'This round ends and the record unlocks so the requester can fix the data. When they resubmit, a fresh approval round opens for all approvers.',
    sendBackPlaceholder: 'What needs to be fixed before this can be approved?',
    sendBackSuccess: 'Sent back for revision — the requester can now edit and resubmit',
    sendBackAutoRejected: 'Revision limit reached — the request was auto-rejected',
    actRevise: 'Sent back for revision',
    actResubmit: 'Resubmitted',
    roundChip: 'Round {{n}}',
    returnedHint: 'An approver sent this back to you. The record is unlocked — fix the data, then resubmit to start a new approval round.',
    resubmitBtn: 'Resubmit',
    resubmitting: 'Resubmitting…',
    resubmitSuccess: 'Resubmitted — a new approval round has opened',
    resubmitPlaceholder: 'What did you change?',
    editRecordBtn: 'Edit record',
    abandonTitle: 'Abandon this revision?',
    abandonBody: 'This withdraws the request instead of resubmitting it. The approval ends here.',
    emptyTitle: 'No requests',
    emptyPending: "You're all caught up — nothing is waiting on you.",
    emptyOther: 'Nothing here yet.',
    emptyViewAll: 'Browse all requests',
    waitingOnOthers: '{{count}} requests are waiting on other approvers',
    waitingOnOthers_one: '{{count}} request is waiting on other approvers',
    waitingOnOthers_other: '{{count}} requests are waiting on other approvers',
    noMatches: 'No matches for current filters.',
    keyboardHint: 'Keyboard: j/k move · Enter open · x select · a approve · r reject',
    drawerTitle: 'Approval Request',
    submittedAgo: 'Submitted {{when}}',
    completedAt: 'Completed {{when}}',
    waitingOn: 'Waiting on',
    approverNameSeparator: ', ',
    approverUnstaffed: '{{seat}} (no current holder)',
    history: 'Activity',
    noActions: 'No actions yet.',
    actSubmit: 'Submitted',
    actApprove: 'Approved',
    actReject: 'Rejected',
    actRecall: 'Recalled',
    overrideActionLabel: 'Override {{action}}',
    overrideNotice: 'You hold no approver slot on this step. Continuing uses your admin override: it finalises the step immediately, bypassing any approver who has not acted. The decision is recorded as an admin override.',
    overrideNoticeWho: 'You hold no approver slot on this step. Continuing uses your admin override: it finalises the step immediately and bypasses the approvers who have not acted — {{who}}. The decision is recorded as an admin override.',
    overrideReassignNotice: 'You hold no approver slot on this step. Continuing uses your admin override: the step moves to the new approver you pick, replacing any approver who has not acted. The request stays pending and waits on the new approver. The reassignment is recorded as an admin override.',
    overrideReassignNoticeWho: 'You hold no approver slot on this step. Continuing uses your admin override: the step moves to the new approver you pick, replacing the approvers who have not acted — {{who}}. The request stays pending and waits on the new approver. The reassignment is recorded as an admin override.',
    overrideRecallNotice: 'You did not submit this request. Continuing uses your admin override: the request is withdrawn, any approver who has not acted can no longer act on it, and the record is unlocked.',
    overrideRecallNoticeWho: 'You did not submit this request. Continuing uses your admin override: the request is withdrawn, the record is unlocked, and the approvers who have not acted can no longer act on it — {{who}}.',
    viaOverrideChip: 'Admin override',
    viaOverrideHint: 'The actor held no approver slot on this step — admitted by the admin-override path.',
    overrideActor: 'Act as another identity (admin)',
    actor: 'Actor',
    auto: 'Auto',
    overrideHint: 'e.g. role:sales_manager. Leave blank to use the auto-detected identity.',
    comment: 'Comment (optional)',
    approve: 'Approve',
    approving: 'Approving…',
    reject: 'Reject',
    rejecting: 'Rejecting…',
    recall: 'Recall',
    recalling: 'Recalling…',
    cancel: 'Cancel',
    clear: 'Clear',
    approveN: 'Approve {{count}}',
    rejectN: 'Reject {{count}}',
    bulkApproveTitle: 'Approve {{count}} requests?',
    bulkApproveTitle_one: 'Approve {{count}} request?',
    bulkApproveTitle_other: 'Approve {{count}} requests?',
    bulkApproveBody: 'Each request is approved with your identity and its flow continues down the approve branch.',
    bulkRejectTitle: 'Reject {{count}} requests?',
    bulkRejectTitle_one: 'Reject {{count}} request?',
    bulkRejectTitle_other: 'Reject {{count}} requests?',
    bulkRejectBody: 'This rejects the selected requests and notifies their submitters.',
    bulkApproved: 'Approved {{count}} requests',
    bulkApproved_one: 'Approved {{count}} request',
    bulkApproved_other: 'Approved {{count}} requests',
    bulkRejected: 'Rejected {{count}} requests',
    bulkRejected_one: 'Rejected {{count}} request',
    bulkRejected_other: 'Rejected {{count}} requests',
    bulkPartial: '{{ok}} succeeded, {{fail}} failed: {{which}}',
    rejectOneTitle: 'Reject "{{title}}"?',
    rejectOneBody: 'This rejects the request and notifies the submitter.',
    rejectTitle: 'Reject this request?',
    rejectBody: 'This marks the request as rejected and notifies the submitter.',
    recallTitle: 'Recall this request?',
    recallBody: 'This withdraws your request. Approvers can no longer act on it, and the record is unlocked.',
    inlineApproved: 'Approved "{{title}}"',
    inlineRejected: 'Rejected "{{title}}"',
    approvedFinal: 'Approved',
    approvedWaiting: 'Approved — waiting on the remaining approvers',
    rejectedToast: 'Rejected',
    recalledToast: 'Request recalled',
    whyDisabled: 'Only the assigned approvers can act on this request. It is waiting on: {{who}}.',
    whyDisabledSubmitter: 'You submitted this request, so you can recall it — but only the assigned approvers can approve or reject.',
    noActor: 'Cannot determine the acting identity',
    actionFailed: 'Action failed',
    loadFailed: 'Failed to load request',
    recallUnavailable: 'Recall is not available on this deployment.',
    requestGone: 'This request no longer exists. Refresh the list.',
    notAllowed: 'You are not allowed to perform this action.',
    alreadyDecided: 'This request was already decided. Refresh the list.',
    justNow: 'just now',
    minutesAgo: '{{count}}m ago',
    minutesAgo_one: '{{count}}m ago',
    minutesAgo_other: '{{count}}m ago',
    hoursAgo: '{{count}}h ago',
    hoursAgo_one: '{{count}}h ago',
    hoursAgo_other: '{{count}}h ago',
    daysAgo: '{{count}}d ago',
    daysAgo_one: '{{count}}d ago',
    daysAgo_other: '{{count}}d ago',
  },
  filterBuilder: {
    where: 'Where',
    and: 'AND',
    or: 'OR',
    clearAll: 'Clear all',
    selectField: 'Select field',
    operator: 'Operator',
    selectValue: 'Select value',
    value: 'Value',
    addFilter: 'Add filter',
    removeCondition: 'Remove condition',
    trueLabel: 'True',
    falseLabel: 'False',
    noResults: 'No results',
    searchField: 'Search {{label}}…',
    enterId: 'Enter {{label}} id',
    addValue: 'Type a value, press Enter',
    removeValue: 'Remove {{value}}',
    rangeStart: 'From',
    rangeEnd: 'To',
    operators: {
      equals: 'Equals',
      not_equals: 'Does not equal',
      contains: 'Contains',
      icontains: 'Contains (ignore case)',
      not_contains: 'Does not contain',
      is_empty: 'Is empty',
      is_not_empty: 'Is not empty',
      greater_than: 'Greater than',
      less_than: 'Less than',
      greater_than_or_equal: 'Greater than or equal',
      less_than_or_equal: 'Less than or equal',
      before: 'Before',
      after: 'After',
      between: 'Between',
      in: 'In',
      not_in: 'Not in',
      starts_with: 'Starts with',
      ends_with: 'Ends with',
      is_null: 'Is null',
      is_not_null: 'Is not null',
      exists: 'Is set',
      notExists: 'Is not set',
    },
    emptyCheckHint: {
      text: '"{{isEmpty}}" also matches blank text; "{{isNull}}" matches only a missing value.',
      list: '"{{isEmpty}}" also matches an empty list; "{{isNull}}" matches only a missing value.',
    },
  },
  sortBuilder: {
    sortBy: 'Sort by',
    thenBy: 'Then by',
    selectField: 'Select field',
    ascending: 'A → Z',
    descending: 'Z → A',
    addSort: 'Add sort',
    removeSort: 'Remove sort',
  },
  // `@object-ui/collaboration` — the comment thread's copy (objectstack#5506,
  // objectui#3424). The package used to carry every one of these as an English
  // literal, so a zh session read a Chinese console with an English comment
  // thread inside it. `COLLAB_DEFAULT_TRANSLATIONS` in that package mirrors
  // this namespace verbatim as its no-provider fallback; keep the two in step.
  //
  // The generic action words (Save / Cancel / Edit / Delete) are NOT repeated
  // here — the thread reads them from `common`.
  collaboration: {
    // Thread header. An i18next count family (objectui#11445): the component
    // passes `count` and i18next picks the slot each pack's CLDR rules select.
    commentCount: '{{count}} comments',
    commentCount_one: '{{count}} comment',
    commentCount_other: '{{count}} comments',
    // Appended to the count, separator included, so a translator owns the
    // whole phrase rather than inheriting an English-shaped ` · ` glue.
    resolvedSuffix: ' · Resolved',
    sortComments: 'Sort comments',
    sortOldest: 'Oldest',
    sortNewest: 'Newest',
    resolve: 'Resolve',
    reopen: 'Reopen',
    // Relative comment age. Word-level entries only — the component keeps its
    // existing minute/hour/day buckets and no date library was introduced.
    justNow: 'just now',
    minutesAgo: '{{count}}m ago',
    minutesAgo_one: '{{count}}m ago',
    minutesAgo_other: '{{count}}m ago',
    hoursAgo: '{{count}}h ago',
    hoursAgo_one: '{{count}}h ago',
    hoursAgo_other: '{{count}}h ago',
    daysAgo: '{{count}}d ago',
    daysAgo_one: '{{count}}d ago',
    daysAgo_other: '{{count}}d ago',
    edited: '(edited)',
    // Reaction-chip tooltip. A DEDICATED pair rather than `detail.reactionCount`:
    // that one interpolates `{{emoji}}`, and here the emoji is the chip's
    // visible label with nothing to hand the placeholder.
    reactionCount: '{{count}} reactions',
    reactionCount_one: '{{count}} reaction',
    reactionCount_other: '{{count}} reactions',
    addThumbsUp: 'Add thumbs up',
    reply: 'Reply',
    // Accessible names for the three emoji-only controls (objectui#3441).
    // A `button`'s accessible name is computed from its CONTENT before `title`
    // is ever consulted, so '👍' / '❤️' / '✕' named themselves — these keys are
    // wired as `aria-label`, which overrides content.
    //
    // `reactThumbsUp` stays distinct from `addThumbsUp` above even though both
    // dispatch the same reaction today: that one names the reaction-bar `+`
    // picker, and the two render side by side on a comment that already has
    // reactions.
    reactThumbsUp: 'React with thumbs up',
    reactHeart: 'React with heart',
    // Not `common.cancel`: an accessible name has to say what is cancelled.
    // Only the reply TARGET is dropped — the composer keeps whatever was typed.
    cancelReply: 'Cancel reply',
    replyingTo: 'Replying to {{name}}…',
    // The no-author-found half of the reply banner, as a whole sentence:
    // languages that inflect around the addressee cannot build it by
    // substituting a noun into the `{{name}}` form.
    replyingToComment: 'Replying to comment…',
    commentPlaceholder: 'Add a comment… (use @ to mention)',
    send: 'Send',
    // Presence avatar stack (objectui#3440). `presentUserCount*` is the avatar
    // group's `aria-label` — with only images and initials inside, that label
    // IS the control for a screen reader. Count families, like `commentCount`
    // above.
    presentUserCount: '{{count}} users present',
    presentUserCount_one: '{{count}} user present',
    presentUserCount_other: '{{count}} users present',
    moreUserCount: '{{count}} more users',
    moreUserCount_one: '{{count}} more user',
    moreUserCount_other: '{{count}} more users',
    // Avatar tooltip. The parentheses are part of the translation, spacing
    // included, so the CJK packs can drop the space English puts before `(`.
    userStatusTitle: '{{name}} ({{status}})',
    // Display copy for the `PresenceUser['status']` enum. The enum value
    // itself stays raw data — it is translated at the render exit only, and a
    // status outside the union falls back to the raw string.
    statusActive: 'active',
    statusIdle: 'idle',
    statusAway: 'away',
  },
  // Multi-step form (plugin-form's WizardForm). `{{fields}}` is a
  // comma-joined, already-truncated label list built at the call site.
  wizard: {
    missingRequired: 'Please complete the required fields: {{fields}}',
    // The wizard's footer and step chrome (objectui#10999). The generic verbs
    // it shows come from `common.cancel`, `common.next`, `form.create`,
    // `form.update` and `form.stepOf`; these five are the wizard's own.
    // The Previous-step button. Not `common.back`: some packs say a wizard's
    // step back with a different word from a page's back (zh reads "previous
    // step" here and "return" for `common.back`), and the wizard spelling is
    // the one `grid.import.back` and `grid.bulk.back` already use.
    back: 'Back',
    // The final button while the record is being written.
    submitting: 'Submitting…',
    // The step indicator's label for a step that declares no `label`.
    // `{{n}}` is the 1-based step number.
    stepFallback: 'Step {{n}}',
    // The step indicator's `aria-label` — what a screen reader calls the list
    // of steps.
    progressLabel: 'Progress',
    // Shown in place of the fields on a step that has none (a final review
    // step is the usual case).
    emptyStep: 'No fields configured for this step',
  },
  // The screen-flow runner dialog (`app-shell/views/FlowRunner`) — the modal a
  // `type: 'flow'` action opens when its run pauses at a `screen` node.
  //
  // What is deliberately NOT here: the sentence a refused resume shows. That is
  // the ADR-0112 envelope's own `error.message`, prose the automation engine
  // composed for a human ("Node 'create_quote' failed: … at most 2 decimal
  // places"), so it has no fixed catalogue to key against and is passed through
  // untranslated — the same division `appManagement` states above. The runner
  // borrows `common.{loading,cancel,close,submit}` for its chrome and
  // `wizard.missingRequired` for the pre-submit check, which is the same
  // sentence `plugin-form`'s WizardForm raises.
  flowRunner: {
    // Fallback dialog title, used only when the `screen` node declares none.
    title: 'Input',
    submitting: 'Submitting…',
    // The submit label of an `object-form` step: it saves a record AND advances
    // the run, so it is not the plain `common.submit`.
    saveAndContinue: 'Save & Continue',
    // A multi-screen wizard advanced to the next step (not the end of the run).
    nextStep: 'Saved — next step',
    // Terminal success, used only when the flow declares no `successMessage`
    // of its own.
    completed: 'Flow "{{flow}}" completed',
  },
  // Console › System › Applications (objectui#4307). The page's OWN chrome —
  // headings, controls, badges and the frames of its toasts.
  //
  // What is deliberately NOT here: the server's refusal text. Each failure
  // toast is a template with a `{{reason}}` hole, and what fills that hole is
  // whatever `PUT/DELETE /api/v1/meta/app/:name` answered (`forbidden:
  // manage_metadata required`, a 5xx body, an offline message), passed through
  // untranslated. The server does not promise a fixed catalogue of sentences,
  // so there is nothing here for those to key against — see PR #4300 and the
  // page's own header.
  appManagement: {
    title: 'Applications',
    subtitle: 'Manage all configured applications',
    newApp: 'New App',
    // `searchLabel` is the input's sr-only `<label>`; `searchPlaceholder` is
    // what a sighted user reads. Both, because a placeholder is not a label.
    searchLabel: 'Search apps',
    searchPlaceholder: 'Search apps…',
    selectedCount: '{{n}} selected',
    // The two bulk buttons. Bare verbs — the selection badge beside them is
    // what says how many rows they act on.
    bulkEnable: 'Enable',
    bulkDisable: 'Disable',
    selectAll: 'Select all ({{n}})',
    empty: 'No apps found.',
    defaultBadge: 'Default',
    active: 'Active',
    inactive: 'Inactive',
    // Row controls. Each is a pair: the `title` tooltip names the ACTION, the
    // `aria-label` names the action AND its target, because a screen reader
    // reaching an icon button has no row context to borrow from.
    selectApp: 'Select {{name}}',
    openApp: 'Open app',
    openAppNamed: 'Open {{name}}',
    editApp: 'Edit app',
    editAppNamed: 'Edit {{name}}',
    editWithAi: 'Edit with AI',
    editWithAiNamed: 'Edit {{name}} with AI',
    enableApp: 'Enable app',
    disableApp: 'Disable app',
    enableAppNamed: 'Enable {{name}}',
    disableAppNamed: 'Disable {{name}}',
    setDefault: 'Set as default',
    setDefaultNamed: 'Set {{name}} as default',
    deleteApp: 'Delete app',
    deleteAppNamed: 'Delete {{name}}',
    // Delete is a two-click control: the first click arms it and the label
    // becomes the confirmation prompt.
    confirmDelete: 'Click again to confirm delete',
    confirmDeleteNamed: 'Confirm delete {{name}}',
    toast: {
      noClient: 'Cannot reach the metadata service',
      // What `reason()` says when the failure carried no message at all. The
      // ONE localized part of an otherwise verbatim server string.
      unknownError: 'unknown error',
      appEnabled: '{{name}} enabled',
      appDisabled: '{{name}} disabled',
      toggleFailed: 'Failed to toggle app status: {{reason}}',
      setDefaultDone: '{{name}} set as default',
      setDefaultFailed: 'Failed to set default app: {{reason}}',
      appDeleted: '{{name}} deleted',
      deleteFailed: 'Failed to delete app: {{reason}}',
      // A `reset: false` answer: no customization row existed, so nothing was
      // removed. `{{reason}}` is the server's own sentence, passed through raw.
      nothingToDelete: 'Nothing to delete for {{name}}: {{reason}}',
      // `{{reason}}` above when that answer carried no sentence of its own.
      alreadyAtDefault: 'it is already at its package default',
      // `{{n}}` is the count that actually LANDED, not the selection size — a
      // bulk toggle is N independent writes with no transaction behind them.
      bulkEnabled: '{{n}} apps enabled',
      bulkDisabled: '{{n}} apps disabled',
      bulkFailed: 'Failed for {{n}}: {{details}}',
      // One entry of `{{details}}`. The bracket pair and the space before it
      // are part of the translation, so the CJK packs can set their own — the
      // same reason `detail.userStatusTitle` is keyed rather than composed.
      bulkFailureEntry: '{{name}} ({{reason}})',
      // Separator between those entries. Per-locale because list punctuation
      // is a locale property, not a code constant — `validation.
      // formInvalidJoiner` is the same key for the same past defect.
      bulkFailureJoiner: '; ',
      bulkOperationFailed: 'Bulk operation failed: {{reason}}',
    },
  },
  // objectui#6301 — Setup › Packaged automation (ADR-0126 §7.4): the
  // operational surface for the flows an installed package ships. Authoring
  // stays in Studio, so this group has no editing vocabulary at all; it is
  // on/off, clone, and the states those two produce.
  //
  // ⛔ No drift or ancestry wording anywhere in this group (ADR-0126 §9). There
  // is deliberately no "customized", no "based on v3", no "out of date" — the
  // platform does not track that lineage, and a translatable string for it is
  // the cheapest way for the surface to grow one.
  //
  // ⛔ Server refusals are NOT in this group either. The posture gate, the
  // subflow guard and the clone name conflict all arrive as server-authored
  // prose and are rendered verbatim; the four `*Failed*` keys below are the
  // last-resort fallbacks for a response that carried no message at all.
  packagedAutomation: {
    title: 'Packaged automation',
    // Covers BOTH sections since ADR-0126 §8 item 2 put packaged actions on
    // this page: only flows can be cloned, so the clone clause names them.
    subtitle:
      'Flows and actions shipped by installed packages. Turn one off for this deployment, or clone a flow under a new name to customize it. Editing happens in Studio.',
    refresh: 'Refresh',
    // Section headings — the page carries two tables.
    flowsHeading: 'Packaged flows',
    actionsHeading: 'Packaged actions',
    colFlow: 'Flow',
    colActivation: 'Activation',
    colActions: 'Actions',
    // The switch's accessible name — the only place a row's label is spoken.
    toggleLabel: 'Activation for {{label}}',
    on: 'On',
    off: 'Off',
    // The Activation badge on a flow whose switch is ON but whose trigger the
    // engine has not armed on this deployment (objectui#13159): the switch
    // keeps the flag, this says the flow does not run. The same words as
    // Studio's rail for the same state (`engine.studio.auto.notRunning`).
    notRunning: 'Not running here',
    clone: 'Clone',
    cloneTitle: 'Clone packaged flow',
    cloneBody:
      'The copy carries the whole definition and takes a new machine name and label. Edit the copy in Studio.',
    cloneName: 'New machine name',
    cloneLabel: 'New label',
    // The Clone dialog's prefilled label (objectui#13344): the source flow's
    // label, or its machine name when it has none, marked as the copy.
    cloneCopyLabel: '{{label}} (copy)',
    cancel: 'Cancel',
    cloneConfirm: 'Create clone',
    cloneCreated: 'Created flow "{{name}}".',
    // The clone result's next steps (objectui#13270): switch the flow the
    // admin cloned from off through its own toggle, or open the clone where
    // it is edited. The sharing-rule clone's words for the same offer.
    cloneSwitchSourceOff: 'Switch "{{label}}" off',
    cloneSourceOff: 'The packaged flow "{{label}}" is switched off.',
    cloneOpen: 'Open the clone in Studio',
    emptyTitle: 'No packaged flows',
    emptyBody:
      'No installed package ships an automation flow on this deployment. Flows you author yourself live in Studio.',
    loadFailed: 'Could not load packaged automation.',
    // Two keys per action, not one: the response arm has an HTTP status to
    // name and the transport-exception arm does not, and a single key cannot
    // carry a hole only half its call sites can fill.
    // Artifact-neutral by wording, and shared by BOTH sections' toggles: the
    // sentence says nothing about flows, so the actions half reuses it rather
    // than defining a second key with the same English in ten packs.
    toggleFailedHttp: 'Could not change activation (HTTP {{status}}).',
    toggleFailed: 'Could not change activation.',
    cloneFailedHttp: 'Could not clone this flow (HTTP {{status}}).',
    cloneFailed: 'Could not clone this flow.',
    // The chip an unarmed flow row's platform sentence opens from
    // (objectui#12609). ⛔ Generic on purpose: the same word on every row that
    // carries a sentence, whatever the sentence says. The sentence itself is
    // the server's and is never kept in a pack; a label naming its cause would
    // be the console classifying a field the contract says not to parse.
    reasonDetails: 'Details',

    // ── Packaged ACTIONS section (ADR-0126 §8 item 2, ruling 3) ────────────
    // ⛔ No clone key here on purpose: the action-clone half is unchartered,
    // and a string is the cheapest way for an unchartered surface to appear.
    actionsSubtitle:
      'Actions shipped by installed packages. Turn one off for this deployment and it stops running everywhere it is offered. Authoring your own action alongside it stays open in Studio.',
    colAction: 'Action',
    colObject: 'Object',
    // The object is part of the accessible name because it is part of the
    // identity — two objects may declare the same action name.
    actionToggleLabel: 'Activation for {{label}} on {{object}}',
    actionsEmptyTitle: 'No packaged actions',
    actionsEmptyBody:
      'No installed package declares an action on this deployment. Actions you author yourself live in Studio.',
    actionsLoadFailed: 'Could not load packaged actions.',
  },
  element: {
    // objectui#10951 — `element:number` authored with an aggregate and no
    // `dataSource.object` (objectui#11880: the flat `object` is not read). Kept
    // terse: this pack is eager, and the console closure budget weighs it.
    number: {
      noObject: 'No object named: set dataSource.object.',
      // objectui#12910 — the title of the panel this block draws when its
      // `dataSource.view` names nothing.
      sourceUnresolved: 'This metric’s data source could not be resolved',
    },
    // objectui#12910 — `element:image` with no `src`.
    image: {
      noSource: 'No image source',
    },
    // objectui#12910 — `element:record_picker`'s panel title, same case.
    recordPicker: {
      sourceUnresolved: 'This record picker’s data source could not be resolved',
    },
    // objectui#12920 — the same panel title for every other data-bound block,
    // one key per block kind. `element:number` above also titles the
    // dashboard's `object-metric`; `component` is the @object-ui/react
    // panel's own default, for a block that passes no title.
    calendar: {
      sourceUnresolved: 'This calendar’s data source could not be resolved',
    },
    chart: {
      sourceUnresolved: 'This chart’s data source could not be resolved',
    },
    pivotTable: {
      sourceUnresolved: 'This pivot table’s data source could not be resolved',
    },
    detailView: {
      sourceUnresolved: 'This detail view’s data source could not be resolved',
    },
    relatedList: {
      sourceUnresolved: 'This related list’s data source could not be resolved',
      // The panel drawn when the list's `parentDataSource` read fails.
      parentUnreadable: 'This related list’s parent record could not be read',
    },
    form: {
      sourceUnresolved: 'This form’s data source could not be resolved',
    },
    lineItems: {
      sourceUnresolved: 'This line-items panel’s data source could not be resolved',
    },
    gantt: {
      sourceUnresolved: 'This gantt chart’s data source could not be resolved',
    },
    grid: {
      sourceUnresolved: 'This grid’s data source could not be resolved',
    },
    board: {
      sourceUnresolved: 'This board’s data source could not be resolved',
    },
    listView: {
      sourceUnresolved: 'This list view’s data source could not be resolved',
    },
    map: {
      sourceUnresolved: 'This map’s data source could not be resolved',
    },
    timeline: {
      sourceUnresolved: 'This timeline’s data source could not be resolved',
    },
    component: {
      sourceUnresolved: 'This component’s data source could not be resolved',
      // The panel drawn when a block resolved no adapter at all.
      noDataSource: 'No data source resolved',
      // objectui#12197 — the two titles of a page element's API binding
      // (`dataSource: { provider: 'api', … }`): refused by the spec's schema,
      // or read and failed.
      apiRefused: 'This component’s API data source is refused',
      apiUnreadable: 'This component’s API data source could not be read',
    },
    // objectui#12910 — `element:metadata_viewer` (the ```metadata doc fence).
    // A `{{name}}`-style slot that the renderer draws as a `<code>` chip is
    // filled with a private-use mark and split on, so each language places
    // the chip. Counts read as "Label: N" so no key needs a plural family.
    metadataViewer: {
      missingKey: 'Missing {{key}} for this view.',
      loading: 'Loading {{name}}…',
      loadFailed: 'Failed to load {{name}}: {{message}}',
      notFound: '{{name}} not found.',
      stateMachine: 'State machine',
      flow: 'Flow',
      permission: 'Permission',
      noStateMachine: 'No state machine on {{object}}.',
      noStateMachineNamed: 'No state machine named “{{name}}” on {{object}}.',
      lifecycle: 'Lifecycle of {{object}}',
      field: 'field {{field}}',
      initial: 'initial',
      final: 'final',
      steps: 'Steps: {{count}}',
      noSteps: 'No steps to show.',
      untitledStep: '(step)',
      hiddenSteps: 'Technical steps hidden: {{count}} · set {{setting}} to show all',
      objectAccess: 'Object access: {{count}}',
      noPermissions: 'No object permissions declared.',
      object: 'Object',
      unknownType: 'Unknown metadata view type. Expected {{a}}, {{b}} or {{c}}.',
      unknownTypeNamed: 'Unknown metadata view type “{{type}}”. Expected {{a}}, {{b}} or {{c}}.',
    },
  },
} as const;

export default en;
export type TranslationKeys = typeof en;
