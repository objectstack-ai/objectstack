// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';
import { ValueDomainSchema, type ValueDomain } from '../shared/value-domain.zod';

/**
 * The `valueDomain` control's choices, DERIVED from the closed vocabulary
 * (#14168). The labels are a `Record` over the union, so a member added to
 * `ValueDomainSchema` without a label here fails to compile rather than
 * silently reaching Studio as a machine word — the same exhaustiveness the
 * membership table beside the schema uses.
 */
const VALUE_DOMAIN_LABELS: Readonly<Record<ValueDomain, string>> = {
  iana_time_zone: 'IANA time zone',
  iso_4217_currency: 'ISO 4217 currency code',
  iso_3166_alpha2: 'ISO 3166-1 alpha-2 country code',
};

const VALUE_DOMAIN_OPTIONS = ValueDomainSchema.options.map((value) => ({
  label: VALUE_DOMAIN_LABELS[value],
  value,
}));

/**
 * Form Layout for Object Metadata Type
 */
export const objectForm = defineForm({
  schemaId: 'object',
  type: 'simple',
  sections: [
    {
      name: 'basics',
      label: 'Basics',
      description: 'Identity, labels, and taxonomy.',
      columns: 2,
      fields: [
        { field: 'name', type: 'text', required: true, immutable: true, colSpan: 1, helpText: 'snake_case unique identifier (immutable after creation)' },
        { field: 'label', type: 'text', colSpan: 1, helpText: 'Singular display name (e.g. "Account")' },
        { field: 'pluralLabel', type: 'text', colSpan: 1, helpText: 'Plural display name (e.g. "Accounts")' },
        { field: 'icon', type: 'text', colSpan: 1, helpText: 'Lucide icon name (e.g. "building", "users")' },
        { field: 'description', type: 'textarea', colSpan: 2, helpText: 'Developer documentation' },
        // #19331 — `nameField` is declared by ObjectSchema and was offered by no
        // control, so the ADR-0079 record-title pointer could only be written
        // through the Source tab's free-text JSON. A plain text row: the value
        // names one of THIS object's own fields, and this registry has no
        // own-field picker to route it to (`field-multi` is multi-valued and
        // takes its candidates from a `dependsOn` source row, which a top-level
        // object row has nothing to point at).
        { field: 'nameField', type: 'text', colSpan: 1, helpText: 'Field whose value titles each record (e.g. "name", "subject"). ADR-0079 canonical pointer — read by record display, ObjectQL search and related-record previews.' },
        { field: 'isSystem', type: 'boolean', colSpan: 1, helpText: 'System object (protected from deletion; defaults sharing to public)' },
        // #20349 — the object's two own field-name LISTS, beside the `nameField`
        // pointer. Free text, the `view.form.ts` `searchableFields` row's face:
        // `string-tags` is a chip input over `string[]`, which is exactly this
        // node. A field picker is not an option here — `field-multi` takes its
        // catalog from the draft's `object` / `objectName` / `data.object` /
        // `interfaceConfig.source`, and an object draft carries none of them, so
        // it would offer an empty list. A misspelt entry is not dropped quietly:
        // the publish door refuses it (`object-field-ref-unknown`,
        // `searchable-field-unknown`, both at `error`), and so does `os validate`.
        { field: 'highlightFields', widget: 'string-tags', colSpan: 2, helpText: 'Field names of this object, most important first — the first entry wins where only one fits (ADR-0085). Drives the default list columns, cards, child-record previews and the detail highlight strip. A name that is not a field of this object is refused at publish.' },
        { field: 'searchableFields', widget: 'string-tags', colSpan: 2, helpText: 'Field names the $search query matches (ADR-0061): the default for the record picker, list quick-search and global search; a view may narrow it. Unset, search uses the name/title field plus short-text fields. Each entry must name a stored field of this object — an unknown name or a virtual formula field is refused at publish.' },
        // #19332 (flight G2a of ruling record 5861442317) — the object's field
        // groups, the ADR-0085 layout role beside `nameField` / `highlightFields`.
        // A repeater whose sub-rows are DECLARED, the `fields.options` repeater's
        // face below, for two reasons:
        //
        //   - A derived repeater renders every key of the entry schema, and three
        //     of its nine are the `[DEPRECATED → collapse]` aliases
        //     (`defaultExpanded`, `collapsible`, `collapsed`). Declaring the six
        //     canonical keys keeps the aliases off screen; each alias carries a
        //     nested `omit` row in the reconciliation ledger.
        //   - A declared sub-row's label and help text reach the translation
        //     catalogs, which a schema-derived one never does.
        //
        // Each sub-row copies the face a registered row already gives the same
        // node: `key` / `label` / `icon` the plain text rows above, `description`
        // the textarea row above, `collapse` a select over an enum whose three
        // members are all spellable option values, and `visibleWhen` the
        // `type: 'code'` / `language: 'expression'` predicate rows of the
        // `fields` grid. An edit merges into the stored entry, so an alias an
        // entry already carries survives a save, and a `collapse` set here
        // outranks it (the parse derives `collapse` from an alias only when
        // `collapse` is absent).
        //
        // No field-name list lives here: a field joins a group through its own
        // `group` key, so there is no name for a misspelling to hide in.
        {
          field: 'fieldGroups',
          type: 'repeater',
          colSpan: 2,
          helpText: 'Ordered sections that group this object\'s fields on the entry form and the record detail page (ADR-0085); array order is display order. A field joins a group by naming its key in the field\'s own group setting. Fields in no group follow the groups, and a group no field joins is not drawn.',
          fields: [
            { field: 'key', label: 'Key', type: 'text', required: true, helpText: 'Machine key in snake_case, unique within this object — the schema refuses anything else. Fields join the group by naming this key, so renaming it leaves them ungrouped.' },
            { field: 'label', label: 'Label', type: 'text', required: true, helpText: 'Header text of the group\'s section.' },
            { field: 'icon', label: 'Icon', type: 'text', helpText: 'Lucide icon name shown beside the header on the record detail page (e.g. "banknote"). The entry form does not show it.' },
            { field: 'description', label: 'Description', type: 'textarea', helpText: 'Text shown under the header, on the entry form and the record detail page.' },
            { field: 'collapse', label: 'Collapse', type: 'select', helpText: 'Whether the section can be collapsed, on the entry form and the record detail page. Unset: none.', options: [
              { label: 'None — always open, no toggle', value: 'none' },
              { label: 'Expanded — collapsible, starts open', value: 'expanded' },
              { label: 'Collapsed — collapsible, starts closed', value: 'collapsed' },
            ] },
            { field: 'visibleWhen', label: 'Visible When', type: 'code', language: 'expression', helpText: 'CEL predicate over the record (e.g. record.type == \'invoice\') — the entry form shows the whole group, header included, only while it is TRUE.' },
          ],
        },
      ],
    },
    {
      name: 'fields',
      label: 'Fields',
      description: 'Define the data model — each entry becomes a column in the database table.',
      fields: [
        {
          field: 'fields',
          type: 'record',
          required: true,
          helpText: 'Add the columns this object will store',
          keyField: {
            field: 'name',
            label: 'Name',
            placeholder: 'snake_case_identifier',
            helpText: 'snake_case machine name (used as column name and API key)',
            regex: '^[a-z_][a-z0-9_]*$',
            immutable: true,
          },
          fields: [
            { field: 'label', type: 'text', helpText: 'Display label' },
            {
              field: 'type',
              type: 'select',
              required: true,
              helpText: 'Field type',
              options: [
                { label: 'Text', value: 'text' },
                { label: 'Textarea', value: 'textarea' },
                { label: 'Email', value: 'email' },
                { label: 'URL', value: 'url' },
                { label: 'Phone', value: 'phone' },
                { label: 'Password', value: 'password' },
                { label: 'Markdown', value: 'markdown' },
                { label: 'HTML', value: 'html' },
                { label: 'Rich Text', value: 'richtext' },
                { label: 'Number', value: 'number' },
                { label: 'Currency', value: 'currency' },
                { label: 'Percent', value: 'percent' },
                { label: 'Date', value: 'date' },
                { label: 'Date & Time', value: 'datetime' },
                { label: 'Time', value: 'time' },
                { label: 'Boolean', value: 'boolean' },
                { label: 'Toggle', value: 'toggle' },
                { label: 'Select', value: 'select' },
                { label: 'Multiselect', value: 'multiselect' },
                { label: 'Radio', value: 'radio' },
                { label: 'Checkboxes', value: 'checkboxes' },
                { label: 'Lookup (reference)', value: 'lookup' },
                { label: 'Master–Detail', value: 'master_detail' },
                { label: 'Tree', value: 'tree' },
                { label: 'Image', value: 'image' },
                { label: 'File', value: 'file' },
                { label: 'Avatar', value: 'avatar' },
                { label: 'Video', value: 'video' },
                { label: 'Audio', value: 'audio' },
                { label: 'Formula (computed)', value: 'formula' },
                { label: 'Summary (rollup)', value: 'summary' },
                { label: 'Autonumber', value: 'autonumber' },
                { label: 'Composite (embedded)', value: 'composite' },
                { label: 'Repeater (embedded array)', value: 'repeater' },
                { label: 'Record (keyed map)', value: 'record' },
                { label: 'Location (GPS)', value: 'location' },
                { label: 'Address', value: 'address' },
                { label: 'Code', value: 'code' },
                { label: 'JSON', value: 'json' },
                { label: 'Color', value: 'color' },
                { label: 'Rating', value: 'rating' },
                { label: 'Slider', value: 'slider' },
                { label: 'Signature', value: 'signature' },
                { label: 'QR / Barcode', value: 'qrcode' },
                { label: 'Progress', value: 'progress' },
                { label: 'Tags', value: 'tags' },
                { label: 'Vector embedding', value: 'vector' },
              ],
            },
            { field: 'description', type: 'textarea', helpText: 'Developer documentation for this column' },
            { field: 'required', type: 'boolean', helpText: 'Must be set on every record' },
            { field: 'unique', type: 'boolean', helpText: 'Disallow duplicate values' },
            // `indexed` removed: a field-level index flag built no index and was
            // pruned from FieldSchema in the 16.x line (#2377, ADR-0049).
            // Declare the index in the object's `indexes[]` instead.
            { field: 'readonly', type: 'boolean', helpText: 'Visible but never user-editable' },
            // `immutable` removed: never a FieldSchema key. The mechanism is the
            // `readonlyWhen` predicate below.
            { field: 'hidden', type: 'boolean', helpText: 'Hidden from default UI' },
            // `maskingRule` declared 2026-08-16 (#8993, ruled Option A): partial
            // masking enforced by plugin-security's FieldMasker on read + export.
            { field: 'maskingRule', type: 'text', helpText: "Partial masking: preset ('phone', 'id_card', 'bank_account', 'email', 'name') or {\"keepHead\": n, \"keepTail\": m}. Masked unless the caller holds this field's requiredPermissions" },
            { field: 'searchable', type: 'boolean', helpText: 'Include in full-text search' },
            { field: 'sortable', type: 'boolean', helpText: 'Allow sorting on this column' },
            // `filterable` removed: never a FieldSchema key (only `sortable` and
            // `searchable` exist); every declared column is filterable.
            { field: 'defaultValue', type: 'text', helpText: 'Default value for new records (JSON literal)' },
            // `placeholder` declared 2026-08-16 (#9019, ruled on objectui#4676):
            // in-input hint text, distinct from `inlineHelpText` (always-visible
            // help below the field) and `description` (tooltip).
            { field: 'placeholder', type: 'text', helpText: 'Hint text shown inside the empty input; disappears once a value is entered' },

            // Text constraints
            // #11566 — aligned to the bounded-string types the schema accepts
            // `maxLength` on (BOUNDED_STRING_FIELD_TYPES — the write-time
            // validator's list; maintainer ruling 2026-08-24). `code` was the
            // one this list was missing. #11875 added `signature`/`qrcode`
            // (the write seam now enforces their declared bound); this
            // visibleWhen moves with the set.
            { field: 'maxLength', type: 'number', helpText: 'Max characters', visibleWhen: "data.type in ['text','textarea','email','url','phone','password','markdown','html','richtext','code','signature','qrcode']" },
            // #11949 — `minLength` aligned to the same set (maintainer ruling
            // 2026-08-25: the #11566 template applies in full). This row used
            // to stop at 9 types (`code` was the one it was missing); it moves
            // with the set, exactly like the row above.
            { field: 'minLength', type: 'number', helpText: 'Min characters', visibleWhen: "data.type in ['text','textarea','email','url','phone','password','markdown','html','richtext','code','signature','qrcode']" },
            // #14168 (maintainer ruling 2026-09-02, option A) — `valueDomain`
            // is shown for exactly the types the schema accepts it on
            // (VALUE_DOMAIN_FIELD_TYPES in field.zod.ts — `text` alone); this
            // visibleWhen moves with the set, and the offered choices are
            // DERIVED from the vocabulary rather than re-typed here, so this
            // control cannot become a second opinion on what the closed
            // vocabulary is (the #12017 two-copies shape). Shown in the same
            // stroke that the write path starts refusing a non-member and the
            // liveness row flips `live` — declared = enforced = shown.
            {
              field: 'valueDomain',
              type: 'select',
              helpText: 'Standard the written value must belong to; a write carrying a non-member is refused',
              visibleWhen: "data.type in ['text']",
              options: VALUE_DOMAIN_OPTIONS,
            },
            // objectui#6140 (maintainer ruling 2026-08-25, Option A) — `rows`
            // is shown for exactly the multiline editor types the schema
            // accepts it on (MULTILINE_EDITOR_FIELD_TYPES in field.zod.ts);
            // this visibleWhen moves with the set.
            { field: 'rows', type: 'number', helpText: 'Inline editor height (text rows)', visibleWhen: "data.type in ['textarea','markdown','html','richtext']" },

            // Numeric constraints
            { field: 'min', type: 'number', helpText: 'Minimum value', visibleWhen: "data.type in ['number','currency','percent','rating','slider','progress']" },
            { field: 'max', type: 'number', helpText: 'Maximum value', visibleWhen: "data.type in ['number','currency','percent','rating','slider','progress']" },
            { field: 'precision', type: 'number', helpText: 'Total digits', visibleWhen: "data.type in ['number','currency','percent']" },
            // #19629 (ruling 5791803339 B): `scale` is retired from `currency` and refused at parse, so it is not offered there.
            { field: 'scale', type: 'number', helpText: 'Decimal places', visibleWhen: "data.type in ['number','percent']" },

            // Selection options
            //
            // The offered inputs are exactly `SelectOptionSchema`'s authorable
            // keys, minus `visibleWhen` (a CEL predicate, not a repeater text
            // input). An `icon` input used to sit between `color` and
            // `description` and was withdrawn under ADR-0049 enforce-or-remove:
            // the option shape is strict and has never declared `icon`, so a
            // Lucide name typed there was an `unrecognized_keys` refusal at
            // publish — the author found out at the 422, the same
            // offer-vs-door class #11410 and #12868 retired elsewhere.
            //
            // Remove rather than declare, on a premise measured for THIS
            // surface rather than inherited from #5016's action-param reading:
            // objectui declares `icon` on `SelectOptionMetadata`, but no
            // field-option render path READS it. Measured at the
            // `.objectui-sha` pin `d8ec8d6d4f011b11c8eb1e6dbd364ef206711391`
            // (the console this repo ships) and again on that repo's
            // `origin/main`, same answer both times, with a live positive
            // control: the select/multiselect cell renderer
            // (`packages/fields/src/index.tsx`, the `renderOne` badge/dot
            // branch) reads `option?.label` and `option?.color` off that very
            // `SelectOptionMetadata[]` and never `option?.icon`. The only
            // `opt.icon` read in that tree belongs to the config-panel
            // `ConfigField` vocabulary, whose `icon` is a `React.ReactNode` an
            // authored field option cannot reach. Declaring it instead would
            // be an accepted-set expansion, which needs a maintainer ruling.
            // `field-rows-option-description.test.ts` pins both halves — the
            // schema still refuses `icon`, and this list no longer offers it.
            {
              field: 'options',
              type: 'repeater',
              helpText: 'Available choices',
              visibleWhen: "data.type in ['select','multiselect','radio','checkboxes']",
              fields: [
                { field: 'label', label: 'Label', type: 'text', required: true },
                { field: 'value', label: 'Value', type: 'text', required: true },
                { field: 'color', label: 'Color', type: 'color' },
                { field: 'description', label: 'Description', type: 'text' },
              ],
            },

            // Relational
            // ONE shared row for the three reference-carrying types (#14892):
            // the text carries the `tree` rule the schema enforces — optional,
            // and if given this object — so the designer never invites the
            // foreign target `ObjectSchema` refuses at publish.
            { field: 'reference', type: 'text', helpText: 'Target object name. For a tree field it is optional and, if given, must be this object (a tree is a hierarchy within its own object — link a different object with a lookup)', visibleWhen: "data.type in ['lookup','master_detail','tree']" },
            // `lookupFilters`, not `referenceFilter`: an array of
            // {field, operator, value} rules, not a CEL string.
            { field: 'lookupFilters', widget: 'json', helpText: 'Filter rules applied to the picker ({field, operator, value})', visibleWhen: "data.type in ['lookup','master_detail']" },
            // `deleteBehavior`, not a `cascadeDelete` boolean: the schema models
            // three outcomes, and only one of them is "cascade".
            //
            // TWO declarations of one key, with disjoint `visibleWhen` (#11410).
            // #9689 made `set_null` on a `master_detail` a named parse-time
            // rejection, so a single shared option list offered a choice the
            // publish door refuses — the author found out at the 422. The split
            // is the narrowest shape the form DSL already supports: field-level
            // `visibleWhen` is what the metadata-admin renderer evaluates as
            // `evaluatePredicate(visibility, { data: row })`, exactly as it does
            // for every other type-conditional control in this repeater.
            //
            // Per-option `visibleWhen` (`SelectOptionSchema`, ADR-0068) would be
            // the tighter-looking spelling and is deliberately NOT used: the
            // metadata-admin renderer maps `fieldSpec.options` straight to select
            // items and never reads it, so it would ship an ADR-0049
            // declared-but-unenforced key. And on the runtime surface that DOES
            // honor it, the per-option evaluator binds `record`, never `data` —
            // a `data.`-rooted predicate there is an unbound identifier, and
            // visibility fails OPEN, keeping the option. Either way the author
            // would still be offered "Set null".
            //
            // ⚠️ The predicates must stay disjoint AND total over the two types:
            // an overlap renders two selects writing one key, a gap makes the
            // control vanish for that type. Both are pinned in
            // `form-delete-behavior-options.test.ts`.
            //
            // `helpText` is deliberately IDENTICAL on both. The i18n bundle keys
            // form fields by field PATH (`metadataForms.<type>.fields.<path>`),
            // so these two declarations share one translation key — divergent
            // text here would collide silently, last writer winning.
            { field: 'deleteBehavior', type: 'select', helpText: 'What happens when the referenced record is deleted', visibleWhen: "data.type == 'lookup'", options: [
              { label: 'Set null', value: 'set_null' },
              { label: 'Cascade (delete children)', value: 'cascade' },
              { label: 'Restrict (block the delete)', value: 'restrict' },
            ] },
            // `master_detail`: no `set_null`. A detail row without its master is
            // the orphan the master-detail relationship exists to prevent, so
            // the schema refuses the combination outright (#9689).
            { field: 'deleteBehavior', type: 'select', helpText: 'What happens when the referenced record is deleted', visibleWhen: "data.type == 'master_detail'", options: [
              { label: 'Cascade (delete children)', value: 'cascade' },
              { label: 'Restrict (block the delete)', value: 'restrict' },
            ] },
            { field: 'multiple', type: 'boolean', helpText: 'Allow selecting multiple records', visibleWhen: "data.type in ['lookup']" },

            // Formula / summary
            // `expression`, not `formula` — the key is named for what it holds,
            // not for the field type that uses it.
            { field: 'expression', type: 'code', language: 'expression', helpText: 'CEL formula expression', visibleWhen: "data.type == 'formula'" },
            // The four members are what `FieldSchema.returnType` declares, and
            // the same explicit list the field designer's own control carries
            // in `field.form.ts` (#19677). This grid additionally offered
            // `datetime` and `currency`, so an author who added a formula field
            // here and picked either wrote a value the parse refuses — the
            // refusal arriving from the save door, naming a key they never
            // typed. Declared-vs-enforced, one seam before that door.
            { field: 'returnType', type: 'select', helpText: 'Result type for formulas', visibleWhen: "data.type == 'formula'", options: [
              { label: 'Text', value: 'text' }, { label: 'Number', value: 'number' },
              { label: 'Boolean', value: 'boolean' }, { label: 'Date', value: 'date' },
            ] },
            // A roll-up is ONE key — `summaryOperations` {object, field, function}.
            // The flat `summaryType` / `summaryField` pair named neither of them
            // and also lost `object`, so a roll-up authored here saved nothing.
            {
              field: 'summaryOperations',
              type: 'composite',
              helpText: 'Roll-up: which child object, which field, which aggregation',
              visibleWhen: "data.type == 'summary'",
              fields: [
                { field: 'object', type: 'text', required: true, helpText: 'Source child object name' },
                { field: 'field', type: 'text', required: true, helpText: 'Field on the child object to aggregate (ignored for count)' },
                { field: 'function', type: 'select', required: true, helpText: 'Aggregation function', options: [
                  { label: 'Count', value: 'count' }, { label: 'Sum', value: 'sum' }, { label: 'Avg', value: 'avg' },
                  { label: 'Min', value: 'min' }, { label: 'Max', value: 'max' },
                ] },
              ],
            },

            // Autonumber — `autonumberFormat`, not `displayFormat`. There is no
            // `startingNumber`: the counter resets per rendered prefix, which the
            // format string itself determines (e.g. AD{YYYYMMDD}{0000} resets daily).
            { field: 'autonumberFormat', type: 'text', helpText: 'e.g. "INV-{0000}"; date tokens {YYYY}/{MM}/{DD} and {field_name} interpolation supported', visibleWhen: "data.type == 'autonumber'" },

            // Code language
            { field: 'language', type: 'text', helpText: 'Editor language (e.g. sql, javascript)', visibleWhen: "data.type == 'code'" },

            // Governance. `validation` / `errorMessage` are not FieldSchema keys —
            // a record-level predicate is a `validation` metadata item on the
            // object, which carries its own message. `audit` / `pii` / `encrypted`
            // named the `auditTrail` / `dataQuality` / `encryptionConfig` family
            // pruned in 2026-06 as dead in both layers (see the FieldSchema
            // tombstone); at-rest protection is `type: 'secret'`, not a flag.
            { field: 'trackHistory', type: 'boolean', helpText: 'Summarize this field on the record activity timeline' },
            { field: 'visibleWhen', type: 'code', language: 'expression', helpText: 'CEL predicate — field is shown only when TRUE' },
            { field: 'readonlyWhen', type: 'code', language: 'expression', helpText: 'CEL predicate — field is read-only when TRUE (enforced server-side)' },
            { field: 'requiredWhen', type: 'code', language: 'expression', helpText: 'CEL predicate — field is required when TRUE (enforced server-side)' },
          ],
        },
      ],
    },
    {
      name: 'capabilities',
      label: 'Capabilities',
      description: 'System features and API exposure.',
      collapsible: true,
      collapsed: true,
      fields: [
        {
          // The key is `enable` (ObjectCapabilities). This block named
          // `capabilities` — a key ObjectSchema has never declared — so every
          // toggle below was stripped on save and the section did nothing.
          field: 'enable',
          type: 'composite',
          helpText: 'Enable/disable system features',
          fields: [
            { field: 'trackHistory', type: 'boolean' },
            { field: 'searchable', type: 'boolean' },
            { field: 'apiEnabled', type: 'boolean' },
            { field: 'files', type: 'boolean' },
            { field: 'feeds', type: 'boolean' },
            { field: 'activities', type: 'boolean' },
            { field: 'clone', type: 'boolean' },
          ],
        },
      ],
    },
    {
      name: 'advanced',
      label: 'Advanced',
      description: 'State machines, actions, and storage.',
      collapsible: true,
      collapsed: true,
      fields: [
        // #19085 — `validations` gets the row its declaration always implied.
        // The served schema DECLARED the key and no form offered it, so an
        // author's only door was the Source tab's free-text JSON. This section
        // already advertises "State machines" in its description, and a state
        // machine IS a `validations` member (ADR-0020) — the row was missing,
        // not the section.
        //
        // The face is the `json` control rather than a schema-derived
        // repeater, and that is a measurement, not a preference. The served
        // node is an array whose items are a DOUBLE-HOP pointer
        // (`items.$ref` → `$defs/__schema1` → `$defs/__schema2`) landing on a
        // `oneOf` over the six ValidationRule members. A repeater would have
        // to resolve both hops AND pick a union branch before it could render
        // a row; neither half is measured for this node, and a repeater that
        // resolves neither renders an empty row whose values never land — the
        // offer-vs-door defect the reconciliation gate beside this file
        // exists to catch. The Zod parse still refuses a malformed rule loudly
        // at publish. Same treatment as the sibling structured-array rows
        // `permission.rowLevelSecurity` and `email_template.variables`.
        //
        // ⚠ Precisely: `json` is in the metadata-admin renderer's passthrough
        // set, but that set is consulted AFTER the structural fallbacks, ⛔ not
        // instead of them — `resolveFieldFace` tries the widget registry, then
        // an object form, then an array-of-objects, and only then the
        // passthrough check. So this row reaches the raw-JSON editor today
        // because the unresolved double-hop pointer derives nothing, ⛔ not
        // because the hint suppresses derivation. Once the pin moves past
        // objectui's pointer resolution the same hint on this node derives an
        // `object-rows` repeater over the FIRST `oneOf` branch (`script`) —
        // that is the renderer's precedence, not this repo's contract, and
        // whoever bumps the pin owns re-measuring this row and its two
        // shape-siblings named above.
        //
        // Upgrading this to a structured control is a form-face addition — the
        // same boundary the reconciliation ledger draws for the
        // `lifecycle.*.onlyWhen` rows — ⛔ not a reconciliation, and not this
        // row's price of admission.
        { field: 'validations', widget: 'json', helpText: 'Object-level validation rules — an array of rule objects, e.g. [{ "type": "script", "name": "amount_positive", "condition": "amount > 0", "message": "Amount must be positive" }]. State-machine transition tables are declared here too (ADR-0020)' },
        // #19332 (flight G2b of ruling record 5861442317) — the object's
        // declarative timeline milestones (ADR-0052 §5b.2), beside `validations`:
        // a milestone fires on a field reaching a value, the same transition a
        // `state_machine` rule above governs. A repeater with declared sub-rows,
        // the `fieldGroups` repeater's face, over the four keys the entry schema
        // has, all plain text, as plugin-audit reads them
        // (`audit-writers.ts` `matchMilestone` / `renderMilestoneSummary`).
        //
        // `field` pins `widget: 'text'`, and that is a measurement, not a
        // preference: with no `widget`, objectui's name convention turns a
        // string sub-row named `field` into the `field-ref` picker, whose catalog
        // an object draft never fills (it names no `object` / `objectName` /
        // `data.object` / `interfaceConfig.source`), so the picker would offer
        // only "None" and a new milestone could not name its field. An explicit
        // `widget` skips the name convention; `text` is a passthrough hint, so
        // the face is the plain text input.
        //
        // No authoring door judges `field` or a `{token}` of `summary`: not the
        // parse, not the publish door, not `os validate`
        // (`validate-object-field-refs` leaves `activityMilestones[].field` out
        // by name). The help text claims what the runtime does with a miss.
        {
          field: 'activityMilestones',
          type: 'repeater',
          helpText: 'Timeline entries fired by a field reaching a value (ADR-0052 §5b.2): when an update moves the watched field into the value, the audit plugin writes the milestone\'s summary to the record\'s activity timeline instead of the field-change entry. The first milestone that matches wins.',
          fields: [
            { field: 'field', label: 'Field', widget: 'text', required: true, helpText: 'Name of the field to watch on this object (e.g. status). Nothing checks it when you save or publish: a name that is not a field of this object never fires.' },
            { field: 'value', label: 'Value', type: 'text', required: true, helpText: 'The stored value the field must change into, compared exactly as text — for a select field the option value, not its label (e.g. done). A milestone on a number or boolean field never fires.' },
            { field: 'summary', label: 'Summary', type: 'text', required: true, helpText: 'Timeline text (e.g. "Deal won: {name}"). A {field_name} token takes the record\'s value after the update, and the token of a lookup, master-detail or user field shows the referenced record\'s title; a token that names no field renders empty.' },
            { field: 'type', label: 'Type', type: 'text', helpText: 'Activity type of the timeline entry: a built-in kind such as completed, or your own word, stored as written. Unset: updated.' },
          ],
        },
        { field: 'datasource', type: 'text', helpText: 'Target datasource ID (default: "default")' },
        // #19332 (flight G2a of ruling record 5861442317) — the object's declared
        // indexes, beside `datasource`: storage. A repeater with declared
        // sub-rows, as `fieldGroups` above, over the three keys the driver reads
        // (`name`, `fields`, `unique`); `type` and `partial` are tombstones and
        // need no row.
        //
        // `fields` is a free-text list, the `highlightFields` row's face. The
        // schema parse, so a draft save, does not judge its names. Publishing and
        // `os validate` refuse one that is not a field of this object
        // (`object-field-ref-unknown`, `error`, since #20432). The SQL driver's
        // `syncDeclaredIndexes` skips an index naming a column the table does
        // not have, logging an error (the durability channel, since #20432),
        // which is what still befalls a real field that is not a stored column
        // (a formula). The help text claims exactly those three.
        //
        // `unique` is a select over `global` / `organization` ONLY, as the
        // ruling says. The node is `boolean | 'global' | 'organization'`: a
        // derived face takes the union's first arm, the boolean, and would offer
        // a switch that writes the deprecated bare `true`; and no option can
        // spell a boolean anyway (`FormSelectOptionSchema.value` is a lowercase
        // identifier). So the select writes only the two scopes the parse
        // accepts now and after protocol 18. A stored `true` / `false` is shown
        // by no option, and it is not rewritten: an edit merges into the stored
        // entry, so `unique` changes only when the author picks a scope.
        {
          field: 'indexes',
          type: 'repeater',
          helpText: 'Database indexes on this object\'s table. The SQL driver creates each one the table lacks when it syncs the table; a sync never drops an index.',
          fields: [
            { field: 'name', label: 'Name', type: 'text', helpText: 'Physical index name. Unset: generated from the table and the columns (e.g. idx_task_status).' },
            { field: 'fields', label: 'Fields', widget: 'string-tags', required: true, helpText: 'Column names of this object, in key order (e.g. status, owner). Saving does not check them; publishing and os validate refuse a name that is not a field of this object. A field that is not a stored column (a formula, say) makes the SQL driver skip the whole index, with an error in the server log.' },
            { field: 'unique', label: 'Unique', type: 'select', helpText: 'Uniqueness scope (ADR-0120). Unset: not unique. The deprecated bare true (it means global) is not offered; an index that carries it keeps it until you pick a scope.', options: [
              { label: 'Global — one holder across the installation, over exactly these columns', value: 'global' },
              { label: 'Organization — one holder per organization (the driver prepends the organization column)', value: 'organization' },
            ] },
          ],
        },
        // #19331 — five more declared scalars with no control. Each enum gets an
        // explicit `options` list because the bare member reads as a word and
        // the choice it stands for is a security or lifecycle contract; the copy
        // states what the runtime does with the value, including what ABSENCE
        // resolves to, which is the half an author cannot see from the enum.
        { field: 'ownership', type: 'select', helpText: 'Record-ownership model. Absent resolves to user.', options: [
          { label: 'User — reassignable owner_id plus owning_business_unit_id', value: 'user' },
          { label: 'Business unit — owning_business_unit_id only, no owner_id', value: 'business_unit' },
          { label: 'Organization', value: 'org' },
          { label: 'None — no per-record owner, neither anchor', value: 'none' },
        ] },
        { field: 'sharingModel', type: 'select', helpText: 'Org-Wide Default record visibility for internal users. A custom object that omits it resolves to private at runtime (ADR-0090 D1).', options: [
          { label: 'Private — owner only', value: 'private' },
          { label: 'Public read — everyone reads, owner writes', value: 'public_read' },
          { label: 'Public read/write — everyone reads and writes', value: 'public_read_write' },
          { label: 'Controlled by parent — derived from the master record', value: 'controlled_by_parent' },
        ] },
        // #20349 — the two ADR-0066 access keys, beside `sharingModel`, the third
        // leg of the same story (grant coverage, capability gate, record
        // visibility).
        //
        // `access` is a strict object with ONE enum member, both of whose values
        // are spellable option values, so it takes the `lifecycle` row's face: a
        // composite over a select. The sub-row is declared rather than derived
        // so its label and help text reach the translation catalogs, which a
        // schema-derived sub-field never does.
        {
          field: 'access',
          type: 'composite',
          helpText: "Wildcard-grant posture (ADR-0066 D2). Absent resolves to public. It decides whether a permission set's '*' object grant covers this object; record visibility between users is sharingModel.",
          fields: [
            { field: 'default', type: 'select', helpText: "public: covered by '*' wildcard grants. private: needs an explicit per-object grant, and is exempt from wildcard row-level security.", options: [
              { label: 'Public — covered by wildcard (*) grants', value: 'public' },
              { label: 'Private — needs an explicit per-object grant', value: 'private' },
            ] },
          ],
        },
        // `requiredPermissions` is a UNION — `string[]` or a strict
        // `{read, create, update, delete}` map — so it takes `json`, the
        // `validations` row's hint, and ⛔ never `string-tags`: that widget reads
        // a non-array as `[]` and its first edit writes the list back, so a
        // stored per-operation map would be silently replaced. `json` is not a
        // registered widget, so the renderer resolves the face from the stored
        // value's union branch instead: a stored map renders the map's four
        // sub-keys and an edit merges into the stored object, a stored list
        // renders a list input. On a create the first branch (the list)
        // renders; the map arm is written in source or reached once stored.
        { field: 'requiredPermissions', widget: 'json', helpText: 'Capabilities (permission-set systemPermissions) a caller must hold to reach this object, checked in addition to CRUD grants (ADR-0066 D3). A list gates every operation; a {read, create, update, delete} map gates only the operations it lists. Absent or empty: no capability gate.' },
        // #19332 (flight G2b of ruling record 5861442317) — the share-LINK policy,
        // after the three principal-access rows above: `sharingModel` shares with
        // named principals, this block with whoever holds a link. A composite
        // with declared sub-rows, the `access` / `lifecycle` face, over all six
        // keys of the strict block, each read by plugin-sharing
        // (`share-link-service.ts` `getPolicy`, `createLink`, `resolveToken`):
        //
        //   - `enabled` a switch, the `enable` toggles' face.
        //   - `allowedAudiences` / `allowedPermissions` are arrays of an enum
        //     whose members are all spellable option values, so they take the
        //     `multiselect` widget objectui derives for an array of enum (the
        //     derived `appearance.allowedVisualizations` of the view and page
        //     forms), declared here so each choice carries a label. It writes
        //     nothing when every choice is cleared, so the form cannot store the
        //     empty list the service reads as "any audience".
        //   - `maxExpiryDays` a number, `min` the schema's positive integer.
        //   - `redactFields` a free-text list, the `highlightFields` face and for
        //     the same reason (`field-multi` has no catalog on an object draft).
        //     It pins its widget on purpose: a string list named `*Fields` is
        //     otherwise turned into that very picker by objectui's name
        //     convention. A misspelt entry is refused at publish
        //     (`object-field-ref-unknown`, `error`), and by `os validate`.
        //   - `eligibility` a plain CEL string (not an ADR-0089 envelope), the
        //     `type: 'code'` / `language: 'expression'` predicate rows' face.
        {
          field: 'publicSharing',
          type: 'composite',
          helpText: 'Share-link policy: whether records of this object can be published through a link that anyone holding it opens, and on what terms. Separate from sharingModel, which shares with named users and teams. Unset or off: no link can be created, and none opens.',
          fields: [
            { field: 'enabled', label: 'Enabled', type: 'boolean', helpText: 'Allow share links for this object\'s records. Checked on every redemption: switching it off stops every existing link from opening, and switching it back on serves them again. Off (the default): nothing else here applies.' },
            { field: 'allowedAudiences', label: 'Allowed Audiences', widget: 'multiselect', helpText: 'Audiences a new link may name; any other is refused. Unset: link only. Every audience still needs the link itself: signed in also needs a signed-in user, and email also needs the recipient\'s address on the link\'s list.', options: [
              { label: 'Public', value: 'public' },
              { label: 'Link only — anyone with the link', value: 'link_only' },
              { label: 'Signed in — signed-in users with the link', value: 'signed_in' },
              { label: 'Email — listed recipients with the link', value: 'email' },
            ] },
            { field: 'allowedPermissions', label: 'Allowed Permissions', widget: 'multiselect', helpText: 'Permission levels a new link may grant; any other is refused. Unset: view only.', options: [
              { label: 'View', value: 'view' },
              { label: 'Comment', value: 'comment' },
              { label: 'Edit', value: 'edit' },
            ] },
            { field: 'maxExpiryDays', label: 'Max Expiry Days', type: 'number', min: 1, helpText: 'Latest expiry a new link may request, in days from now; a later one is refused. Unset: 365. It does not force an expiry: a link created without one never expires.' },
            { field: 'redactFields', label: 'Redact Fields', widget: 'string-tags', helpText: 'Field names of this object removed from every record a link serves, whatever the audience; the owner\'s own access is unaffected. A name that is not a field of this object is refused at publish.' },
            { field: 'eligibility', label: 'Eligibility', type: 'code', language: 'expression', helpText: 'CEL predicate over the record (e.g. record.status == \'published\'): a link is created only while it is TRUE, and an existing link stops opening once its record no longer qualifies. A predicate that does not compile, or faults, refuses the link.' },
          ],
        },
        // No inline `options` here, and that is a CONSTRAINT rather than a
        // preference: `FormSelectOptionSchema.value` is a system identifier
        // (`^[a-z][a-z0-9_.]*$`), so the four hyphenated members of this enum —
        // `system-data`, `engine-owned`, `append-only`, `better-auth` — cannot be
        // spelled as option values at all. The enum derives from the served JSON
        // Schema, which carries every member verbatim, and the meanings ride the
        // help text instead of a list the form face would refuse.
        { field: 'managedBy', helpText: 'Lifecycle bucket: platform (user CRUD), config (admin authored), system-data (platform-defined schema with admin/user-writable data), engine-owned (no user writes), append-only (audit), better-auth (identity). UI clients derive their CRUD affordances from it, so it decides what a user is offered on records of this object.' },
        // #19332 (flight G2b of ruling record 5861442317) — the per-entry override
        // of the matrix `managedBy` above resolves (`resolveCrudAffordances`),
        // so it sits directly under it. A composite with declared sub-rows over
        // all five keys of the strict block (its alias and guidance words —
        // `new`, `export`, the VIEW block's `sort`, … — are refusals, not keys).
        //
        // `create` / `import` / `edit` / `delete` are each a UNION — a boolean,
        // or a strict `{ enabled, visibleWhen, disabledWhen }` object — so the
        // ruling's union rule applies: `json`, ⛔ never a face that can only
        // write one arm. `json` is not a registered widget, so objectui resolves
        // the face from the stored value's union branch: a stored boolean or a
        // new entry (the first arm) renders a switch, and a stored object
        // renders its three keys, whose edits merge into it. The object arm is
        // therefore written in source and edited here once stored. `exportCsv` is
        // a plain boolean, the `enable` toggles' face.
        //
        // A switch reads `false` for an unset entry, which is not what the
        // resolved default says for most buckets, so the composite's help text
        // states the defaults the switch cannot show.
        {
          field: 'userActions',
          type: 'composite',
          helpText: 'Which generic entries (New, Import, Edit, Delete, Export) UI clients offer on this object\'s records, overriding the managedBy default one entry at a time. An unset entry keeps that default: platform offers all five; config and system-data all but Import; engine-owned, append-only and better-auth only Export. An untouched switch writes nothing, so it reads off even where the default offers the entry. On an engine-owned or append-only object, turning an entry on also lets users make that write through the data API. Users still need the matching permission.',
          fields: [
            { field: 'create', label: 'Create', widget: 'json', helpText: 'The New button: on shows it, off hides it. A stored {enabled, visibleWhen, disabledWhen} object is edited key by key; write one in source to gate the button on the record in scope, evaluated once per toolbar (the host record on a related list).' },
            { field: 'import', label: 'Import', widget: 'json', helpText: 'The CSV import entry: on shows it, off hides it. A stored {enabled, visibleWhen, disabledWhen} object is edited key by key; write one in source to gate the entry on the record in scope, evaluated once per toolbar.' },
            { field: 'edit', label: 'Edit', widget: 'json', helpText: 'Editing existing records, inline and in the form: on offers it, off hides it. A stored {enabled, visibleWhen, disabledWhen} object is edited key by key; write one in source to gate each row on its own record.' },
            { field: 'delete', label: 'Delete', widget: 'json', helpText: 'Row and bulk delete: on offers it, off hides it. A stored {enabled, visibleWhen, disabledWhen} object is edited key by key; write one in source to gate each row on its own record.' },
            { field: 'exportCsv', label: 'Export CSV', type: 'boolean', helpText: 'The CSV export entry. Unset: shown, since every managedBy bucket offers export.' },
          ],
        },
        { field: 'editMode', type: 'select', helpText: "Edit-interaction intent for records of this object. Absent, the renderer picks its own default. Cross-renderer intent, not styling.", options: [
          { label: 'Modal — edit form as a dialog over the current view', value: 'modal' },
          { label: 'Page — navigate to a dedicated full-page edit route', value: 'page' },
        ] },
        { field: 'fileAccessDelegate', type: 'text', helpText: "Kernel service that authorizes downloads of files owned by this object's media fields, instead of testing whether the caller can read the owning row. For objects whose access is mediated by a service. Fails closed." },
        {
          field: 'lifecycle',
          type: 'composite',
          helpText:
            'Data lifecycle contract (ADR-0057): how long rows live and how space is reclaimed. Leave empty for permanent record semantics. Non-record classes require at least one bounding policy (retention, TTL, or rotation).',
          fields: [
            {
              field: 'class',
              type: 'select',
              helpText: 'Persistence contract for the rows of this object',
              options: [
                { label: 'Record (business truth — permanent)', value: 'record' },
                { label: 'Audit (compliance ledger — retain → archive → delete)', value: 'audit' },
                { label: 'Telemetry (high-frequency log — short retention)', value: 'telemetry' },
                { label: 'Transient (ephemeral state — TTL expiry)', value: 'transient' },
                { label: 'Event (bus messages — very short TTL)', value: 'event' },
              ],
            },
            {
              field: 'retention',
              type: 'composite',
              helpText: 'Age-based retention window',
              fields: [
                { field: 'maxAge', type: 'text', helpText: 'Rows older than this (by created_at) are reaped. Duration literal: h/d/w/y, e.g. "30d"' },
              ],
            },
            {
              field: 'ttl',
              type: 'composite',
              helpText: 'Per-row TTL expiry',
              fields: [
                { field: 'field', type: 'text', helpText: 'Timestamp field the TTL is measured from (e.g. expires_at)' },
                { field: 'expireAfter', type: 'text', helpText: 'Rows expire this long after the field, e.g. "1d"' },
              ],
            },
            {
              field: 'storage',
              type: 'composite',
              helpText: 'Physical rotation for high-frequency telemetry (SQLite: O(1) shard DROP)',
              fields: [
                {
                  field: 'strategy',
                  type: 'select',
                  helpText: 'Storage strategy',
                  options: [{ label: 'Rotation (time-shard + drop oldest)', value: 'rotation' }],
                },
                { field: 'shards', type: 'number', min: 2, helpText: 'Shards retained; total window = shards × unit' },
                {
                  field: 'unit',
                  type: 'select',
                  helpText: 'Time width of one shard',
                  options: [
                    { label: 'Day', value: 'day' },
                    { label: 'Week', value: 'week' },
                    { label: 'Month', value: 'month' },
                  ],
                },
              ],
            },
            {
              field: 'archive',
              type: 'composite',
              helpText: 'Cold-store hand-off (audit class). Rows are never hot-deleted before the archive copy succeeded.',
              fields: [
                { field: 'after', type: 'text', helpText: 'Archive rows older than this — must equal retention.maxAge' },
                { field: 'to', type: 'text', helpText: 'Target datasource name for cold storage' },
                { field: 'keep', type: 'text', helpText: 'How long the archive keeps rows (empty = forever), e.g. "7y"' },
              ],
            },
            { field: 'reclaim', type: 'boolean', helpText: 'Reclaim driver space after sweeps (default on for non-record classes)' },
          ],
        },
      ],
    },
  ],
});
