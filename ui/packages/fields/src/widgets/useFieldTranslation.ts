/**
 * Safe translation hook for field widgets.
 * Falls back to English defaults when no I18nProvider is available.
 */
import { createSafeTranslation } from '@object-ui/i18n';

const FIELD_DEFAULTS: Record<string, string> = {
  'common.selectOption': 'Select an option',
  'common.select': 'Select…',
  'common.loading': 'Loading…',
  'common.noResults': 'No results found',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  // objectui#11689 — the word a read-only boolean value is drawn with
  // (`useBooleanValueLabel`). Same values as the `en` pack, so a provider-less
  // render still says what the literals it replaced said.
  'common.yes': 'Yes',
  'common.no': 'No',
  // objectui#11689 — `BooleanCellRenderer`'s own words: the status column's
  // "LABEL — Off" badge (`{{label}}` is the column label the face is handed)
  // and the completion indicator's two accessible names. Same values as the
  // `en` pack, so a provider-less render reads what the literals did.
  'fields.boolean.offBadge': '{{label}} — Off',
  'fields.boolean.completed': 'Completed',
  'fields.boolean.notCompleted': 'Not completed',
  'table.selected': '{{count}} selected',
  'table.search': 'Search…',
  'lookup.loading': 'Loading…',
  'lookup.noOptions': 'No options found',
  'lookup.noRecords': 'No records found',
  'lookup.recentlyUsed': 'Recently used',
  'lookup.allResults': 'All results',
  'lookup.createNew': 'Create new',
  'lookup.createNamed': 'Create new "{{name}}"',
  'lookup.showingResults': 'Showing {{shown}} of {{total}} results',
  'lookup.showAllResults': 'Show all results ({{count}})',
  'lookup.selectedBadge': 'Selected',
  'lookup.browseAll': 'Browse all records',
  'lookup.remove': 'Remove {{label}}',
  'lookup.selectFirst': 'Select {{fields}} first',
  'lookup.selectRecord': 'Select record',
  'lookup.recordCount': '{{count}} records',
  // A count family (objectui#11445): `fallbackT` reads the `_one` / `_other`
  // row for a numeric `count`, as i18next reads the `en` pack.
  'lookup.recordCount_one': '{{count}} record',
  'lookup.recordCount_other': '{{count}} records',
  'lookup.pageOf': 'Page {{current}} of {{total}}',
  'lookup.filters': 'Filters',
  'lookup.clear': 'Clear',
  'lookup.yes': 'Yes',
  'lookup.filterPlaceholder': 'Filter {{label}}',
  'lookup.prevPage': 'Previous page',
  'lookup.nextPage': 'Next page',
  'lookup.jumpToPage': 'Jump to page',
  'lookup.retry': 'Retry',
  // objectui#3231 — the empty / dependency-gated state of the fixed-option
  // widgets (select, multiselect, radio, checkboxes). Only used when the host
  // supplies no `emptyHint`; the gate sentence shares its key with the form
  // renderer so both cannot drift apart in a locale.
  'fields.options.empty': 'No options available',
  'fields.options.selectFirst': 'Select {{fields}} first',
  // objectui#12145 — three widgets' accessible names: the crop dialog's
  // preview canvas, the percent slider, and the record picker's grid. The
  // grid borrows the command palette's `Records` key rather than adding a
  // second key for the same name. Same values as the `en` pack.
  'fields.image.cropPreview': 'Image crop preview',
  'fields.percent.slider': 'Percentage',
  'console.commandPalette.records': 'Records',
  // objectui#4026 — the separator between the controlling-field names that
  // fill `{{fields}}` of the two gate sentences above/below (`lookup.
  // selectFirst`, `fields.options.selectFirst`). It is a LOCALE property, not
  // a code constant: the call sites hardcoded it, and not even to the same
  // value (`', '` in `LookupField`, `' / '` in `OptionsEmptyState` and the
  // form renderer), so one deliberately-shared sentence read differently
  // depending on which side produced it. Deliberately the SAME key
  // objectstack#5407 added for the invalid-submit toast's field list rather
  // than a gate-specific twin — it is the same class of truncated-name list,
  // and a second key would recreate exactly the divergence being removed.
  // The default here is the `en` pack's value, so a provider-less render is
  // byte-identical to what `LookupField` produced before.
  'validation.formInvalidJoiner': ', ',
  // objectstack#3821 — sharing-rule authoring widgets (object-ref /
  // recipient-picker / filter-condition). The recipient placeholder is keyed
  // PER TYPE rather than interpolating the enum value into an English
  // sentence, which no locale could translate.
  'fields.objectRef.loading': 'Loading objects…',
  'fields.objectRef.placeholder': 'Select an object',
  'fields.objectRef.search': 'Search objects…',
  'fields.objectRef.empty': 'No objects found',
  // objectui#7611 — the registry-name pickers (`position-ref` /
  // `permission-ref`). The failed-load sentence names no cause of its own (the
  // transport's message is shown beside it) and says what still works; the
  // flag marks a stored name the loaded registry does not list. Same values as
  // the `en` pack.
  'fields.registryRef.loadFailed': 'The list could not be loaded. You can still type the name.',
  'fields.registryRef.notFound': '{{name}} (not found)',
  'fields.recipient.selectTypeFirst': 'Select a recipient type first.',
  'fields.recipient.loading': 'Loading…',
  'fields.recipient.search': 'Search…',
  'fields.recipient.empty': 'No matches',
  'fields.recipient.select': 'Select a recipient',
  'fields.recipient.selectUser': 'Select a user',
  'fields.recipient.selectTeam': 'Select a team',
  'fields.recipient.selectBusinessUnit': 'Select a business unit',
  'fields.recipient.selectPosition': 'Select a position',
  'fields.recipient.selectUnitAndSubordinates': 'Select a business unit',
  // objectui#7613 — the `field` recipient kind (maintainer ruling
  // objectstack#14103, executor objectstack#15072). It picks a user-valued
  // COLUMN of the shared object rather than a record, so its three sentences
  // are about columns and none of the per-type placeholders above fits.
  // `noUserFields` exists rather than reusing `fields.recipient.empty`
  // ("No matches") because an empty list here is not a failed search: it is
  // the object having no column the evaluator could read as users, and an
  // admin who is not told that has no way to act on it.
  'fields.recipient.selectField': 'Select a user field',
  'fields.recipient.noUserFields': 'No user fields on this object',
  'fields.recipient.fieldNotUserTyped': '{{name}} — not a user field',
  'fields.filterCondition.selectObjectFirst': 'Select an object first.',
  // objectstack#3896 — this used to be 'All records'. An empty criteria never
  // meant "share everything"; it meant the predicate was missing, and the
  // sharing evaluator failed open on it. Such a rule is now refused on save
  // and shares nothing, so say that rather than advertise the old bug.
  'fields.filterCondition.noCriteria': 'No criteria — this rule shares nothing',
  'fields.filterCondition.criteriaRequired':
    'Add at least one condition. A rule with no criteria would share every record, so it cannot be saved.',
  'fields.filterCondition.invalidJson': 'Invalid JSON — the rule will match no records until fixed.',
  'fields.filterCondition.jsonOnly': 'This criteria can only be edited as JSON',
  'fields.filterCondition.editAsJson': 'Edit as JSON',
  'fields.filterCondition.useVisualBuilder': 'Use visual builder',
  // objectui#6755 — the two widgets whose OWN refusal sentence was a string
  // literal: `ObjectField`'s unparsable draft and `LocationField`'s format and
  // range refusals (objectui#6716/#6714). Every one of them is what a person
  // reads to recover from an edit the widget declined, and none of them could
  // be reached by a locale — inside a package 11 of whose 55 widgets already
  // read this map.
  //
  // Values are byte-identical to the literals they replace, so English and
  // provider-less rendering are unchanged and the pins in
  // `LocationField.refusalDiagnostic.test.tsx` and `plugin-form`'s two refusal
  // suites keep asserting what they asserted.
  //
  // `refusedRange` carries the spec's OWN complaint in `{{detail}}`: the widget
  // refuses to restate `LocationValueSchema`'s bounds (a hand-copied range is a
  // second contract), so this key translates the frame and interpolates what
  // the schema said.
  'fields.object.invalidJson': 'Invalid JSON',
  'fields.location.refusedFormat':
    'Not saved: enter a latitude, longitude pair (example: 30.2741, 120.1551).',
  'fields.location.refusedRange': 'Not saved: {{detail}}',
  // `320374d2a` — the THIRD refusal arm (`12abc, 34`), added by objectui#6715
  // after #6755's ruling was written and therefore outside the three sentences
  // it named. All three arms share one `<p>`, so a literal here made ONE line
  // bilingual rather than one screen.
  //
  // Two SIBLING keys, not an i18next `_one`/`_other` family: the verb is
  // English grammar and cannot be a hole, and the two arities interpolate
  // different holes — a structural pair selected by which halves the residue
  // holds, not a count (see `refusedResidueMessage`). The coordinate
  // NOUNS are keyed once each and interpolated into both, so a locale spells
  // `latitude` in exactly one place. `{{text}}`/`{{otherText}}` are what the
  // person typed and stay untouched by every pack.
  //
  // Values are byte-identical to the literal they replace, in both arities:
  // `Not saved: latitude "12abc" is not a number. …` and
  // `… latitude "12abc" and longitude "34xyz" are not numbers. …`.
  'fields.location.latitude': 'latitude',
  'fields.location.longitude': 'longitude',
  'fields.location.refusedResidueOne':
    'Not saved: {{name}} "{{text}}" is not a number. Enter plain decimals (example: 30.2741, 120.1551).',
  'fields.location.refusedResidue':
    'Not saved: {{name}} "{{text}}" and {{otherName}} "{{otherText}}" are not numbers. Enter plain decimals (example: 30.2741, 120.1551).',
  // objectui#8148 — the FIFTH refusal sentence of objectui#6755's class, and
  // the only SHARED one: `numberBadInput.tsx` produces it for `NumberField`,
  // `CurrencyField`, `PercentField` and both of `GeolocationField`'s boxes.
  // `GeolocationField` sits beside `LocationField`, whose refusals are all
  // keyed above, so two adjacent coordinate widgets refused in two languages.
  //
  // `{{example}}` is a HOLE, not five per-widget keys: five different decimals
  // reach this one sentence, and a pack that spelled one of them could
  // legitimately write `1234,56`, which reads as the `latitude, longitude` pair
  // the widget above asks for. The widget fills the hole in ASCII instead.
  //
  // Byte-identical to the literal it replaces, so English and provider-less
  // rendering are unchanged.
  'fields.number.badInput':
    'Not saved: the text in this box is not a number. Enter a plain decimal (example: {{example}}).',
  // objectui#10567 — `DateField` and the sub-grid's `date` cell name a stored
  // value written on a nonexistent day beside their control, which can only
  // paint it blank. Same value as the `en` pack.
  'fields.date.impossibleDay':
    'The stored value "{{value}}" is not a real date. Pick a date to replace it.',
  // objectui#10474 — `DateTimeField` and the sub-grid's `datetime` cell name a
  // stored value written on a nonexistent day beside their control, which can
  // only paint it blank. Same value as the `en` pack.
  'fields.dateTime.impossibleDay':
    'The stored value "{{value}}" is not a real date. Pick a date and time to replace it.',
  // objectui#12622 — the record form's date picker (`DatePickerField`). Same
  // values as the `en` pack.
  'fields.datePicker.today': 'Today',
  'fields.datePicker.tomorrow': 'Tomorrow',
  'fields.datePicker.clear': 'Clear date',
  'fields.datePicker.openCalendar': 'Open calendar',
  'fields.datePicker.invalid':
    'Not saved: "{{value}}" is not a date. Type it as {{format}}, or pick one from the calendar.',
  // objectui#3342 — the tags widget's input hint. Used only when the field
  // author declared no `placeholder` of their own (author declaration wins).
  'fields.tags.placeholder': 'Type and press Enter to add…',
  // objectui#4028 — `AddressField`'s five sub-labels. The parts of an address
  // are NOT fields on the object (`billing_address` is one column), so no
  // translation bundle could ever key them and an app had no workaround short
  // of abandoning `Field.address()`. Byte-identical to the literals they
  // replace, so English and provider-less rendering are unchanged.
  'fields.address.street': 'Street Address',
  'fields.address.city': 'City',
  'fields.address.state': 'State / Province',
  'fields.address.postalCode': 'ZIP / Postal Code',
  'fields.address.country': 'Country',
  // The character counter's copy (objectui#3406 / #3408) is NOT declared here
  // any more, for exactly the reason the fullscreen copy below is not: it moved
  // with the implementation. `CharacterCount` is now a primitive in
  // `@object-ui/components` (objectui#3439, hoisted so the form renderer's
  // built-in `textarea` branch renders the same counter instead of a third
  // copy), and it carries its own `createSafeTranslation` defaults for the same
  // `fields.textarea.*` keys — still byte-identical English, so provider-less
  // rendering is unchanged and the ten locale packs need no edit.
  //
  // The fullscreen long-text dialog's copy (objectui#3404) is NOT declared
  // here any more. It moved with the implementation: `FullscreenFieldEditor` is
  // a thin wrapper over `FullscreenEditor` in `@object-ui/components`
  // (objectui#3398), and that primitive carries its own `createSafeTranslation`
  // defaults for the same `form.fullscreen.*` / `common.cancel` keys — still
  // the built-in branch's keys, still byte-identical English, so provider-less
  // rendering is unchanged and the ten locale packs need no edit. Leaving the
  // entries here would have re-created in the defaults map exactly the
  // duplication #3398 removed from the components, and this map's own
  // discipline is that a default is declared where it is read.
  //
  // `common.cancel` stays above: `RecordPickerDialog` and `PeoplePicker` read
  // it independently of anything fullscreen.
  // objectui#2600 B5 — capability picker scope group headers.
  'capability.group.platform': 'Platform',
  'capability.group.org': 'Organization',
  'capability.group.other': 'Other',
  // objectui#2600 B5 — curated platform capability labels (registry serves
  // English; dots in the api-name become underscores in the key).
  'capability.label.manage_users': 'Manage Users',
  'capability.label.manage_org_users': 'Manage Organization Users',
  'capability.label.manage_metadata': 'Manage Metadata',
  'capability.label.manage_platform_settings': 'Manage Platform Settings',
  'capability.label.setup_access': 'Setup Access',
  'capability.label.setup_write': 'Write Settings',
  'capability.label.studio_access': 'Studio Access',
  'capability.label.manage_sharing': 'Manage Sharing',
  'capability.label.view_all_audit_log': 'View All Audit Log',
  'capability.label.manage_mailboxes': 'Manage Mailboxes',
};

export const useFieldTranslation = createSafeTranslation(
  FIELD_DEFAULTS,
  'common.selectOption',
);
