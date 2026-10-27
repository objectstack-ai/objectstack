// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `studio` namespace's English catalogue — the RESIDENT one.
 *
 * Every other language of this namespace falls back to it, key by key, so it
 * is the one catalogue `./index.ts` imports statically; the rest are fetched on
 * demand. The keys and the `{token}` placeholder syntax are the Studio
 * designer's own (`tFormat()` in app-shell's `views/metadata-admin/i18n.ts`
 * substitutes them), which is why this is a namespace of its own and not a
 * group inside the `locales/en.ts` pack. `./index.ts` says what the namespace
 * is and which gates read it.
 *
 * ⛔ Keep the declaration `const STUDIO_EN: Record<string, string> = { … }`
 * with plain string values: `ui/scripts/check-i18n-dead-keys.mjs`
 * (`collectDesignerKeys`) reads this file by AST under that name, and a value
 * that is not a static string makes it throw rather than drop the key.
 *
 * The typographic ellipsis is U+2026 `…`, never `...` — the convention the
 * designer table's header records.
 */
const STUDIO_EN: Record<string, string> = {
  // Permission matrix
  'perm.action.create': 'Create',
  'perm.action.read': 'Read',
  'perm.action.edit': 'Edit',
  'perm.action.delete': 'Delete',
  'perm.action.transfer': 'Transfer ownership',
  'perm.action.viewAll': 'View All Records (bypass sharing)',
  'perm.action.modifyAll': 'Modify All Records (bypass sharing)',
  'perm.col.object': 'Object',
  'perm.col.bulk': 'Bulk',
  'perm.posture.private': 'Private',
  'perm.posture.private.tip': 'Secure-by-default object (access.default = private): a permission set’s “*” wildcard grant does NOT cover it. Access needs an explicit grant on this object (or View/Modify All Records). Grants you edit here apply normally.',
  'perm.owd.tip': 'Org-wide default (sharingModel): the record-level visibility baseline for internal users, applied before positions and sharing rules. Object CRUD here gates the operation; the OWD decides which records it reaches (own vs org-wide).',
  'perm.owd.defaultPrivate': 'Private (default)',
  'perm.owd.editLink': 'Edit in the package’s Record Sharing Baseline (OWD) overview',
  'perm.owd.private': 'Private',
  'perm.owd.public_read': 'Public read',
  'perm.owd.public_read_write': 'Public read/write',
  'perm.owd.controlled_by_parent': 'By parent',
  'perm.bulk.read': 'R',
  'perm.bulk.crud': 'CRUD',
  'perm.bulk.all': 'All',
  'perm.bulk.none': 'None',
  // objectstack#26187 — the record-scope pickers (ADR-0057 D1 access depth).
  'perm.scope.unset': 'Not set',
  'perm.scope.value.own': 'Own',
  'perm.scope.value.own_and_reports': 'Own and reports',
  'perm.scope.value.unit': 'My unit',
  'perm.scope.value.unit_and_below': 'My unit and below',
  'perm.scope.value.org': 'Whole org',
  'perm.scope.hierarchyHint': 'requires enterprise; otherwise owner-only',
  'perm.scope.readTip': 'Read scope: which records this set’s read reaches, by where the user sits in the org.',
  'perm.scope.writeTip': 'Write scope: which records this set’s edit and delete reach, by where the user sits in the org.',
  'perm.scope.lockedByViewAll': 'View All Records already grants org-wide read, so no read scope applies. Untick View All to set one.',
  'perm.scope.lockedByModifyAll': 'Modify All Records already grants org-wide read and write, so no scope applies. Untick Modify All to set one.',
  'perm.filter.placeholder': 'Filter objects…',
  'perm.filter.onlyGranted': 'Only granted',
  'perm.filter.empty': 'No objects match the filter.',
  'perm.field.name': 'Name',
  'perm.field.label': 'Label',
  'perm.basics.editHint': 'Edit name / label',
  'perm.cap.none': 'No system capabilities',
  'perm.cap.add': 'Add capability',
  'perm.badge.package': 'Package',
  'perm.badge.custom': 'Custom',
  'perm.badge.default': 'Default for new users',
  'perm.field.loading': 'Loading fields…',
  'perm.field.empty': 'No fields registered for this object.',
  'perm.field.filter': 'Filter fields…',
  'perm.field.filterEmpty': 'No fields match the filter.',
  'perm.field.bulk.readable': 'Read-only all',
  'perm.field.bulk.writable': 'Write all',
  'perm.field.bulk.clear': 'Clear',
  // objectstack#26597 — a field row with no rule draws the object grant.
  'perm.field.inherited.legend': 'Grey boxes: no rule for that field, so it follows the object’s Read and Edit. A click there writes a rule.',
  'perm.field.inherited.tip': 'No rule for this field: it follows the object’s Read and Edit. A click writes a rule.',
  'perm.field.capped.read': 'This rule grants Read, but the object does not: a holder of this set alone cannot read the field.',
  'perm.field.capped.edit': 'This rule grants Edit, but the object does not: a holder of this set alone cannot edit the field.',
  'perm.field.col.name': 'Field',
  'perm.field.read': 'Read',
  'perm.field.edit': 'Edit',
  'perm.field.when': 'When (edit)',
  'perm.field.when.label': 'WHEN (edit vote — row condition)',
  'perm.field.when.add': 'Add condition',
  'perm.field.when.edit': 'Edit condition',
  'perm.field.when.readOff': 'A row condition needs Read on.',
  'perm.field.when.tip':
    'Row condition on the Edit vote, in the CEL of row-level security USING. On a row it matches the entry votes as declared; on any other row the entry is absent, as if this set had not declared the field. Switching Read off clears it.',
  'perm.stat.objects': 'Objects granted',
  'perm.stat.fields': 'Fields granted',
  'perm.stat.objectsGranted': 'Objects granted',
  'perm.stat.fieldOverrides': 'Field overrides',
  'perm.stat.objectsSuffix': 'objects',
  'perm.subtitle.set': 'Permission set',
  'perm.field.systemCapabilities': 'System Capabilities',
  'perm.field.systemCapabilitiesHelp':
    'Platform / org capabilities granted to holders of this set (e.g. Studio access, user management). Designed here; Setup shows them read-only.',
  'perm.rls.title': 'Row-Level Security',
  'perm.rls.help': 'Row filters (CEL predicates) scoping which records holders may read/change.',
  'perm.rls.name': 'Policy name',
  'perm.rls.object': 'Object (* = all)',
  'perm.rls.enabled': 'Enabled',
  'perm.rls.using': 'USING (read filter)',
  'perm.rls.check': 'CHECK (write filter)',
  'perm.rls.checkPlaceholder': 'optional — defaults to USING',
  'perm.rls.empty': 'No row-level policies.',
  'perm.rls.add': 'Add policy',
  'perm.rls.remove': 'Remove policy',
  'perm.rls.nameNeeded': 'Give the policy a name to save it.',
  'perm.rls.nameRefused': 'Not saved. Policy name, on row {row}: {problem}',
  // CEL authoring safety for RLS predicates (objectui#2413).
  'perm.cel.valid': 'Valid CEL',
  'perm.cel.suggestions': 'Field and scope suggestions',
  'perm.cel.type': 'Result type:',
  'perm.cel.type.number': 'Number',
  'perm.cel.type.text': 'Text',
  'perm.cel.type.boolean': 'Boolean',
  'perm.cel.type.date': 'Date',
  'perm.cel.type.unknown': 'Unknown',
  'perm.cel.type.unknownHint':
    'the engine cannot prove a single type. Wrap operands in double() / int() / string() to pin it — only proven-Number formulas are offered as dataset measures.',
  'perm.cel.saveBlocked': 'Fix the CEL syntax errors before saving.',
  // The editor's inspector-blocked Save title (objectui#6900, ruling 5831744213):
  // that channel carries more than CEL faults, so its copy names no one kind.
  'perm.inspector.saveBlocked': 'Fix the issues shown in the inspector before saving.',
  'perm.cel.test.title': 'Test policy',
  'perm.cel.test.help':
    'Dry-run this predicate against a sample record and acting user — the same CEL engine the server uses — to see whether the row is allowed or denied before you save.',
  'perm.cel.test.run': 'Test',
  'perm.cel.test.clause': 'Clause',
  'perm.cel.test.noPredicate': 'Add a USING or CHECK predicate first, then test it.',
  'perm.cel.test.record': 'Sample record',
  'perm.cel.test.user': 'Acting user',
  'perm.cel.test.allow': 'Allowed',
  'perm.cel.test.allowHint': 'The record is in scope — the holder may access it.',
  'perm.cel.test.deny': 'Denied',
  'perm.cel.test.denyHint': 'The record is out of scope — it is excluded for the holder.',
  'perm.cel.test.nonBool': 'Non-boolean result',
  'perm.cel.test.nonBoolHint': 'a row filter should evaluate to true or false.',
  'perm.cel.test.error': 'Evaluation error',
  'perm.cel.test.unavailable': 'CEL engine unavailable',
  'perm.cel.test.unavailableHint': 'The in-browser CEL engine could not be loaded.',
  'perm.tabs.title': 'Tab Visibility',
  'perm.tabs.help': 'Per-tab visibility for holders of this set.',
  'perm.tabs.empty': 'No tab overrides.',
  'perm.tabs.add': 'Add tab',
  'perm.tabs.remove': 'Remove tab',
  'perm.tabs.vis.visible': 'Visible',
  'perm.tabs.vis.hidden': 'Hidden',
  'perm.tabs.vis.default_on': 'Default on',
  'perm.tabs.vis.default_off': 'Default off',
  'perm.admin.title': 'Delegated Admin Scope',
  'perm.admin.help':
    'Lets holders administer a business-unit subtree (assign users) without full admin.',
  'perm.admin.businessUnit': 'Business unit',
  // The dependent controls' disabled reason (objectui#9464): `businessUnit` is
  // the one key the framework's admin-scope shape requires, so a scope written
  // before one is named is refused wholesale when the record is saved.
  'perm.admin.businessUnitRequired':
    'Name a business unit first — a scope without one is refused when the record is saved.',
  'perm.admin.includeSubtree': 'Include subtree',
  'perm.admin.manageAssignments': 'Manage assignments',
  'perm.admin.assignableSets': 'Assignable permission sets',
  'perm.admin.noSets': 'No permission sets loaded.',
  // The grants a scope's holder needs beside the scope itself before they can
  // act on it: enter Setup, pick people and units, write the assignment rows.
  'perm.admin.companions.title': 'What a delegate also needs',
  'perm.admin.companions.help':
    'The scope says what its holders may administer; it does not let them in. A delegate also needs to enter Setup, to read people and business units so the lookups can pick them, and to create, read, edit and delete position assignments. These grants may sit on this set or on another set the delegate holds.',
  'perm.admin.companions.setupAccess': 'Enter Setup',
  'perm.admin.companions.read': 'Read',
  'perm.admin.companions.crud': 'Create, read, edit and delete',
  'perm.admin.companions.granted': 'On this set',
  'perm.admin.companions.missing': 'Not on this set',
  'perm.admin.companions.grant': 'Grant the missing ones',
  'perm.admin.companions.packageNote':
    'Under a package, grant these on an environment permission set in Setup, one the delegate holds: this editor saves only the package’s own objects.',
  'perm.loading': 'Loading permission set {name}…',
  // objectui#9420 — the package door refuses rather than PUTs when the
  // save-time layered re-read REJECTS: without it the merge base falls back
  // to the already-sliced draft and the write deletes every other package's
  // permission rows with a 200. Worded as a refusal plus the retry, because
  // nothing was written and retrying is the whole remedy.
  'perm.save.rereadFailed':
    'Save cancelled: the current permission set could not be re-read, so rows contributed by other packages cannot be preserved. Nothing was saved — please try again.',
  // objectui#9484 — the ENVIRONMENT door's re-read runs AFTER the write, so
  // its rejection is not a failed save and must not be worded like one. It
  // opens with the outcome that is certain ("Saved."), then says exactly what
  // is degraded: the matrix on screen is the accepted body, not a fresh read.
  // Deliberately shares no wording with `perm.save.rereadFailed` above — that
  // one cancels a save, this one confirms one, and a permission surface cannot
  // afford the two reading alike.
  'perm.save.rereadStale':
    'Saved. The follow-up read that refreshes this view did not answer, so the matrix below shows what was just saved rather than the server\'s copy. Reopen this permission set to confirm.',
  // objectui#4446 — names the gate that actually tripped. The old wording
  // ("OS_METADATA_WRITABLE not enabled") blamed a deployment env var for a
  // per-type registry declaration, and had no reachable honest case: the env
  // var FLIPS `allowEnvironmentOverlay` to true, so whenever it is on for this type
  // the surface is writable and this badge never renders.
  'perm.readOnly': 'Read-only (this metadata type has no runtime write channel)',
  'perm.readOnly.hint':
    'The metadata-type registry declares both allowEnvironmentOverlay and allowRuntimeCreate false for this type, so the platform accepts no runtime write for it. Edit the source artifact and redeploy, or ask an operator for the documented OS_METADATA_WRITABLE escape hatch, which opens only the sets no package ships, never a set a package ships.',
  // objectui#12183 — the WALL, a third reason: under `isolated` / `group` the
  // security catalog is the platform operator's, and the doors refuse a
  // tenant's write of a set whatever it holds. Its hint is the catalog's own
  // walled sentence, `engine.catalog.readOnly.walled`.
  'perm.readOnly.walled': 'Read-only (the platform operator defines this catalog)',
  // objectui#13011 — the CALLER, a fourth reason: the type is open and this
  // caller lacks `manage_metadata`. Naming the type tier there was false. Its
  // hint is the capability banner's own sentence, `engine.edit.capabilityReadOnly`.
  'perm.readOnly.capability': 'Read-only (requires the `manage_metadata` capability)',
  // objectui#4518 — the ARTIFACT tier, the server's SECOND refusal. Distinct
  // from `perm.readOnly` above on purpose: the TYPE does have a runtime write
  // channel here (a brand-new set authored on this screen saves fine), so
  // blaming the type would be the mirror-image lie. What is locked is THIS set,
  // because a code package ships it and overwriting a packaged item is an
  // overlay — which `permission` has not opted into.
  'perm.readOnly.artifact': 'Read-only (this set is provided by a code package)',
  // objectui#5987 — the ruled path comes FIRST (maintainer ruling of
  // 2026-08-24, objectstack `e170b0ae5`: lock the base, clone to customize). The remedies that
  // used to lead ("edit the source artifact and redeploy", a new runtime set)
  // stay, as the secondary routes they are.
  // objectui#12141 — the operator hatch is no longer one of them. ADR-0131 D6
  // seals what a managed package ships: `OS_METADATA_WRITABLE` opens a type's
  // items that no package ships, and no door admits a write onto a packaged
  // set on it. The hint names the hatch only to say so, as the server's own
  // refusal sentence does.
  'perm.readOnly.artifact.hint':
    'A code package ships this permission set, so it is locked here: an environment-scope edit would overlay a packaged item, and the metadata-type registry declares allowEnvironmentOverlay false for permission (ADR-0131 D6 forbids an environment overlay of a packaged set: silent privilege drift). The server refuses the write with 403 not_overridable. Clone to customize: the copy is an ordinary permission set authored in this system, under a new name, that you edit here, and upgrades keep flowing to this base. Other routes: edit the source artifact and redeploy, or create a new runtime set. The OS_METADATA_WRITABLE escape hatch does not open a set a package ships (ADR-0131 D6).',
  // objectui#5987 — "Clone to customize", the locked editor's primary action.
  // objectui#7611 — it asks for a new name and label (`PermissionSetCloneDialog.tsx`)
  // and calls the server's clone door (`permission-set-clone.ts`), which copies
  // the whole definition; never a hand-rolled copy.
  'perm.clone.action': 'Clone to customize',
  'perm.clone.hint':
    'Copies this set under a new name you choose. The copy is an ordinary permission set authored in this system, editable here, and upgrades keep flowing to the package-provided base.',
  'perm.clone.guidance':
    'Locked: a code package provides this permission set, so it cannot be edited in place here (upgrades keep flowing to it). Clone to customize — the copy is an ordinary permission set authored in this system, editable here.',
  'perm.clone.dialogTitle': 'Clone permission set',
  'perm.clone.dialogBody':
    'Copies {name} under a new machine name and label. The server decides what the copy carries, and says what it left out.',
  'perm.clone.name': 'New machine name',
  'perm.clone.label': 'New label',
  'perm.clone.confirm': 'Create copy',
  // Used only when the server's refusal carries no message of its own; its
  // message is otherwise shown as sent.
  'perm.clone.failedHttp': 'Could not clone this permission set (HTTP {status}).',
  'perm.clone.failed': 'Could not clone this permission set.',
  'perm.clone.noName':
    'The clone was created, but the server\'s answer did not name it. Open it from the permission-set list.',
  // Embedded hosts have no route to navigate to, so the clone is announced.
  'perm.clone.done': 'Cloned as {name}. Open it from the permission-set list to edit.',
  // A save that still reached the server and was refused as a packaged set:
  // the same guidance as the lock, keyed on the refusal's code (never its
  // prose), instead of the transport's generic message.
  'perm.save.locked':
    'Save refused (403 not_overridable): a code package provides this permission set, so the server does not accept an in-place edit. Clone to customize instead — the copy is an ordinary permission set authored in this system, and upgrades keep flowing to this base.',
  // Designer wrapper
  'designer.unsavedChanges': 'Unsaved changes',
  'designer.editingOverlay': 'Editing overlay',
  'designer.codeBaseline': 'Code baseline',
  // Object form-designer canvas
  'designer.canvas.nameToStart': 'Name the object in the Properties panel to start designing fields.',
  'designer.canvas.noFields': 'No fields yet',
  'designer.canvas.noFieldsHint':
    'Add a field to start designing the form. Click any field to edit its properties on the right.',
  'designer.canvas.addField': 'Add field',
  'designer.canvas.addSection': 'Add section',
  'designer.canvas.addFieldToSection': 'Add field to this section',
  'designer.canvas.searchFieldType': 'Search field type…',
  'designer.canvas.noMatchingTypes': 'No matching types.',
  'designer.canvas.ungrouped': 'Ungrouped',
  'designer.canvas.emptySection': 'Empty section',
  'designer.canvas.dropHint': 'Drag fields here, or add one below',
  'designer.canvas.dropToAssign': 'drop to assign',
  'designer.canvas.collapseAll': 'Collapse all',
  'designer.canvas.expandAll': 'Expand all',
  'designer.canvas.fields': 'fields',
  'designer.canvas.required': 'required',
  'designer.canvas.sections': 'sections',
  'designer.canvas.collapseSection': 'Collapse section',
  'designer.canvas.expandSection': 'Expand section',
  'designer.canvas.moveSectionUp': 'Move section up',
  'designer.canvas.moveSectionDown': 'Move section down',
  'designer.canvas.removeSection': 'Remove section',
  'designer.canvas.removeSectionHint': 'Remove section (fields move to Ungrouped)',
  'designer.canvas.renameHint': 'Double-click to rename',
  'designer.canvas.sectionN': 'Section {n}',
  // Field stubs (disabled runtime-preview placeholders)
  'designer.stub.pickDate': 'Pick a date…',
  'designer.stub.off': 'Off',
  'designer.stub.select': 'Select…',
  'designer.stub.pickMulti': 'Pick one or more…',
  'designer.stub.uploadImage': 'Upload image',
  'designer.stub.uploadAvatar': 'Upload avatar',
  'designer.stub.upload': 'Upload {type}',
  'designer.stub.qrcode': 'QR code',
  'designer.stub.computed': 'Computed value',
  'designer.stub.composite': 'Composite — nested sub-fields edit in the inspector.',
  'designer.stub.repeater': 'Repeater — repeating row group.',
  'designer.stub.searchRef': 'Search {ref}…',
  'designer.stub.chooseRelated': 'Choose related object…',
  'designer.stub.latLng': 'Lat, lng',
  // objectui#10862, slice 4 — the address stub's three-line placeholder.
  'designer.stub.address': 'Street\nCity, State ZIP\nCountry',
  // Field inspector
  'designer.field.kind': 'Field',
  'designer.field.close': 'Close',
  'designer.field.missing': 'This field no longer exists in the draft.',
  'designer.field.remove': 'Remove “{label}”',
  'designer.field.section.basic': 'Basic',
  'designer.field.section.advanced': 'Advanced',
  'designer.field.section.options': '{type} options',
  'designer.field.apiName': 'API name',
  'designer.field.label': 'Label',
  // objectui#11782 — under the Label input: the label a translation shows instead.
  'designer.field.labelTranslated': 'Shown as “{label}” in {language}: the app’s translation bundle overrides this label.',
  'designer.field.type': 'Type',
  'designer.field.required': 'Required',
  'designer.field.requiredCbpMaster':
    'Required is locked on: this object is controlled by parent, and it derives its master from this master-detail field, which must be required.',
  'designer.field.unique': 'Unique',
  'designer.field.description': 'Description',
  'designer.field.readonly': 'Read-only',
  'designer.field.hidden': 'Hidden',
  'designer.field.externalId': 'External ID',
  'designer.field.trackHistory': 'Track history',
  'designer.field.placeholder': 'Placeholder',
  'designer.field.group': 'Group',
  'designer.field.noGroup': '— No group —',
  'designer.field.picklistValues': 'Picklist values',
  'designer.field.noValues': 'No values yet.',
  // objectui#10202 — "use picklist": the field names a shared picklist instead of its own options.
  'designer.field.optionSource': 'Options from',
  'designer.field.optionSourceInline': "This field's own options",
  'designer.field.picklistBound':
    'Options come from the picklist “{picklist}”. A field bound to a picklist has no options of its own: to offer another value, add it to the picklist in its package.',
  'designer.field.picklistOwnValues':
    'These are the picklist’s own values. Values other packages add to it are offered too.',
  'designer.field.optMalformed': 'This option cannot be edited here',
  'designer.field.optMalformed.notAnObject': 'It is not an option object.',
  'designer.field.optMalformed.valueNotText': 'Its `value` is missing or is not text.',
  'designer.field.optMalformed.valueEmpty': 'Its `value` is empty.',
  'designer.field.optMalformed.labelNotText': 'Its `label` is not text.',
  'designer.field.optMalformed.colorNotText': 'Its `color` is not text.',
  'designer.field.optMalformedHint': 'It is kept exactly as authored. Repair it in the JSON source, or remove it here.',
  'designer.field.addValue': 'Add value',
  'designer.field.optValue': 'value',
  'designer.field.optLabel': 'Label',
  'designer.field.optColor': 'Color',
  'designer.field.moveUp': 'Move up',
  'designer.field.moveDown': 'Move down',
  'designer.field.removeValue': 'Remove',
  // objectui#11786 — the inline hint under the input that holds the save: the
  // object write guard refuses this field until it is filled in.
  'designer.field.hint.addOption': 'Add at least one option. Changes are saved once the field has one.',
  'designer.field.hint.pickTarget': 'Pick the object to link to. Changes are saved once the field has one.',
  'designer.field.relatedObject': 'Related object',
  'designer.field.objectNamePlaceholder': 'object_name',
  // Lookup "Picker config" advanced sub-panel
  'designer.field.lookup.pickerConfig': 'Picker config',
  'designer.field.lookup.displayField': 'Display field',
  'designer.field.lookup.descriptionField': 'Description field',
  'designer.field.lookup.selectField': 'Select a field…',
  'designer.field.lookup.setTargetFirst': 'Set the target object first',
  'designer.field.lookup.searchFields': 'Search fields…',
  'designer.field.lookup.selectableRecords': 'Selectable records',
  'designer.field.lookup.addFilter': 'Add filter',
  'designer.field.lookup.noFilter': 'No filter — every {ref} record is selectable.',
  'designer.field.lookup.filterN': 'Filter {n}',
  'designer.field.lookup.removeFilter': 'Remove filter',
  'designer.field.lookup.filterField': 'Field',
  'designer.field.lookup.filterOperator': 'Operator',
  'designer.field.lookup.filterValue': 'Value',
  'designer.field.lookup.dependsOn': 'Depends on (same-record fields)',
  'designer.field.lookup.addDependsOn': 'Add a field this lookup depends on…',
  'designer.field.lookup.searchHostFields': "Search this object's fields…",
  'designer.field.lookup.pageSize': 'Picker page size',
  'designer.field.lookup.allowCreate': 'Allow quick-create',
  'designer.field.formula': 'Formula (CEL)',
  // Roll-up summary (summaryOperations)
  'designer.field.summary.object': 'Child object',
  'designer.field.summary.function': 'Aggregation',
  'designer.field.summary.fn.count': 'Count — child records',
  'designer.field.summary.fn.sum': 'Sum',
  'designer.field.summary.fn.min': 'Min',
  'designer.field.summary.fn.max': 'Max',
  'designer.field.summary.fn.avg': 'Average',
  'designer.field.summary.field': 'Child field to aggregate',
  'designer.field.summary.relationshipField': 'Child relationship field (optional)',
  'designer.field.summary.setObjectFirst': 'Set the child object first',
  'designer.field.summary.countFieldHint': 'Ignored for count, but still required — pick any child field.',
  'designer.field.summary.filterSection': 'Filter (rows to aggregate)',
  'designer.field.summary.addFilter': 'Add condition',
  'designer.field.summary.noFilter': 'No filter — every child row is aggregated.',
  'designer.field.summary.filterHint':
    'Only child rows matching ALL conditions are aggregated — this is how one child object can feed several different totals (e.g. an approved-only sum vs the grand total).',
  'designer.field.summary.filterAdvanced':
    'This filter uses an advanced shape (OR / nested logic) that the row editor can’t show. Edit it as raw metadata to preserve it.',
  'designer.field.summary.hint':
    'Recomputed automatically when child records are created, updated, or deleted. The relationship field is auto-detected when the child has exactly one relation back to this object.',
  'designer.field.precision': 'Precision',
  'designer.field.scale': 'Scale',
  'designer.field.min': 'Min',
  'designer.field.max': 'Max',
  'designer.field.maxLength': 'Max length',
  // objectui#7597 — the `valueDomain` select on a text field. The three member
  // labels are NOT here: they are read from the spec's own describe() prose.
  'designer.field.valueDomain': 'Value domain',
  'designer.field.valueDomainNone': '— None —',
  // Object basics (no-selection default inspector)
  'designer.object.kind': 'Object',
  'designer.object.section.basic': 'Basic info',
  'designer.object.section.basicHint': 'Identity, display names & classification',
  'designer.object.name': 'Name',
  'designer.object.nameHint': 'snake_case unique identifier (cannot change after create)',
  'designer.object.namePlaceholder': 'account',
  'designer.object.label': 'Label',
  'designer.object.labelPlaceholder': 'e.g. Account',
  'designer.object.pluralLabel': 'Plural label',
  'designer.object.pluralPlaceholder': 'e.g. Accounts',
  'designer.object.icon': 'Icon',
  'designer.object.description': 'Description',
  'designer.object.descriptionPlaceholder': 'What this object represents',
  // Access controls (ADR-0066 D2/D3/④/⑤)
  'designer.object.section.access': 'Access',
  'designer.object.section.accessHint': 'Exposure posture and capability requirements. Enforced server-side by the security engine.',
  'designer.object.posture': 'Exposure posture',
  'designer.object.posture.public': 'Public — covered by wildcard grants (default)',
  'designer.object.posture.private': 'Private — needs an explicit grant',
  'designer.object.posture.publicHint': 'Covered by a permission set’s “*” wildcard grant — the platform default for business objects.',
  'designer.object.posture.privateHint': 'Not covered by “*” wildcard grants: only an explicit grant on this object (or View/Modify All Records) reaches it. Make sure some permission set grants this object before publishing, or nobody but platform admins can use it.',
  'designer.object.reqPerms': 'Required capabilities',
  'designer.object.reqPerms.hint': 'AND-gate: callers must hold every listed capability IN ADDITION to their CRUD grants. Comma-separated capability names (e.g. manage_platform_settings). A name no permission set grants fails closed at runtime.',
  'designer.object.reqPerms.mode.all': 'All operations',
  'designer.object.reqPerms.mode.perOp': 'Per operation',
  'designer.object.reqPerms.placeholder': 'e.g. manage_billing',
  'designer.object.reqPerms.op.read': 'Read',
  'designer.object.reqPerms.op.create': 'Create',
  'designer.object.reqPerms.op.update': 'Update',
  'designer.object.reqPerms.op.delete': 'Delete',
  // Field ergonomics (Tier 2)
  'designer.field.defaultValue': 'Default value',
  'designer.field.defaultNone': '— None —',
  'designer.field.true': 'True',
  'designer.field.false': 'False',
  'designer.field.duplicate': 'Duplicate field',
  'designer.field.copySuffix': ' copy',
  // Field power props (Tier 2 — conditional & validation)
  'designer.field.helpText': 'Help text',
  'designer.field.helpTextPlaceholder': 'Shown below the field on the form',
  'designer.field.minLength': 'Min length',
  'designer.field.conditionalRules': 'Conditional rules (CEL)',
  'designer.field.visibleWhen': 'Visible when',
  'designer.field.readonlyWhen': 'Read-only when',
  'designer.field.requiredWhen': 'Required when',
  'designer.field.conditionalRulesHint':
    'While a predicate is true the field becomes visible / read-only / required. Reference the live record as record.<field>, the last saved values as previous.<field>, and (in master-detail line items) the header record as parent.<field>.',
  // Bulk multi-select (Tier 2)
  'designer.canvas.bulkSelected': '{n} selected',
  'designer.canvas.bulkMoveTo': 'Move to section',
  'designer.canvas.bulkDelete': 'Delete',
  'designer.canvas.bulkClear': 'Clear',
  'designer.canvas.bulkHint': 'Ctrl/⌘-click or Shift-click to select multiple fields.',
  // Review / diff mode (Tier 3 — AI-draft review)
  'designer.canvas.reviewChanges': 'Review changes',
  'designer.canvas.reviewExit': 'Exit review',
  'designer.canvas.reviewVsPublished': 'vs last published',
  'designer.canvas.diffAdded': 'Added',
  'designer.canvas.diffChanged': 'Changed',
  'designer.canvas.diffRemoved': 'Removed',
  'designer.canvas.diffChangedKeys': 'Changed: {keys}',
  // ADR-0033 Phase B — generic draft review/diff (host level)
  'designer.draftReview.title': 'Review changes',
  'designer.draftReview.badge': '{n} pending',
  'designer.draftReview.empty': 'No changes vs the published version.',
  // AI assistant entry points
  'designer.canvas.askAi': 'Ask AI',
  'designer.canvas.askAiGenerate': 'Generate fields with AI',
};

export default STUDIO_EN;
