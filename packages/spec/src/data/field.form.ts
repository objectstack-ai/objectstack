// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * Field Metadata Form
 * 
 * Form layout for creating/editing field metadata definitions.
 */
export const fieldForm = defineForm({
  schemaId: 'field',
  type: 'simple',
  sections: [
    {
      name: 'basics',
      label: 'Basics',
      description: 'Core field identity and constraints.',
      columns: 2,
      fields: [
        { field: 'name', required: true, immutable: true, colSpan: 1, helpText: 'Unique identifier (snake_case, immutable after creation)' },
        { field: 'label', required: true, colSpan: 1, helpText: 'Display name for users' },
        { field: 'type', required: true, colSpan: 1, helpText: 'Data type of this field' },
        { field: 'group', colSpan: 1, helpText: 'Group name for form layout' },
        { field: 'description', widget: 'textarea', colSpan: 2, helpText: 'Help text shown to users' },
        { field: 'required', colSpan: 1, helpText: 'User must provide a value' },
        { field: 'unique', colSpan: 1, helpText: 'No two records can have the same value' },
        { field: 'multiple', colSpan: 1, helpText: 'Allow multiple values (for select/lookup)' },
      ],
    },
    {
      name: 'configuration',
      label: 'Configuration',
      description: 'Field-type specific settings (visible blocks depend on the chosen type).',
      fields: [
        { field: 'defaultValue', helpText: 'Default value for new records' },
        { field: 'placeholder', helpText: 'Hint text shown inside the empty input (disappears once a value is entered); use inlineHelpText for always-visible help' },
        // #19331 — nineteen scalars FieldSchema declares had no control on this
        // form, so the per-field editor sent an author to the Source tab's
        // free-text JSON for every one of them. The row beside `placeholder` is
        // the key that row's own help text already names.
        { field: 'inlineHelpText', helpText: 'Always-visible help shown below the input, unlike `placeholder`, which disappears once a value is entered.' },
        // Text field options
        // #11949 — `minLength` converges on the same bounded-string types as
        // `maxLength` below (BOUNDED_STRING_FIELD_TYPES; maintainer ruling
        // 2026-08-25: the #11566 template applies in full). This row used to
        // show the key for 3 types while the schema accepted it on every
        // type; it moves with the set, exactly like the row below.
        { field: 'minLength', visibleWhen: "data.type in ['text','textarea','email','url','phone','password','markdown','html','richtext','code','signature','qrcode']", helpText: 'Minimum character length' },
        // #11566 — `maxLength` is shown for exactly the bounded-string types
        // the schema accepts it on and the write-time validator enforces it
        // for (BOUNDED_STRING_FIELD_TYPES; maintainer ruling 2026-08-24).
        // This list used to be a third opinion (3 types here, 9 in
        // object.form, 10 at the validator); it converged to the validator's.
        // #11875 added `signature`/`qrcode` to the set (the write seam now
        // enforces their declared bound); this visibleWhen moves with it.
        { field: 'maxLength', visibleWhen: "data.type in ['text','textarea','email','url','phone','password','markdown','html','richtext','code','signature','qrcode']", helpText: 'Maximum character length' },
        // #14168 (maintainer ruling 2026-09-02, option A) — `valueDomain` is
        // shown for exactly the types the schema accepts it on
        // (VALUE_DOMAIN_FIELD_TYPES in field.zod.ts — `text` alone, the one
        // type whose stored value is a single plain string naming the member);
        // this visibleWhen moves with the set, like the two rows above. The
        // `in [...]` form rather than `== 'text'` for that reason: the row
        // mirrors a SET, and a widening edits the list in place.
        //
        // Shown in the same stroke that the record validator starts refusing a
        // non-member (`value_domain`) and the liveness row flips `live` —
        // declared = enforced = shown. A key offered in Studio before any write
        // path enforces it is the ADR-0078 shape.
        { field: 'valueDomain', visibleWhen: "data.type in ['text']", helpText: 'Standard the written value must belong to: iana_time_zone, iso_4217_currency or iso_3166_alpha2. A write carrying a non-member is refused' },
        // objectui#6140 (maintainer ruling 2026-08-25, Option A) — `rows` is
        // shown for exactly the multiline editor types the schema accepts it
        // on (MULTILINE_EDITOR_FIELD_TYPES in field.zod.ts); this visibleWhen
        // moves with the set.
        { field: 'rows', visibleWhen: "data.type in ['textarea','markdown','html','richtext']", helpText: 'Inline editor height in text rows' },
        // Number field options
        { field: 'min', visibleWhen: "data.type == 'number' || data.type == 'currency'", helpText: 'Minimum value' },
        { field: 'max', visibleWhen: "data.type == 'number' || data.type == 'currency'", helpText: 'Maximum value' },
        { field: 'precision', visibleWhen: "data.type == 'currency' || data.type == 'number'", helpText: 'Decimal places (e.g., 2 for $10.50)' },
        { field: 'scale', visibleWhen: "data.type == 'number'", helpText: 'Number of decimal digits' },
        // Every `visibleWhen` below is a MEANINGFULNESS gate, not a parse gate:
        // `FieldSchema` accepts each key on any type, and each is mirrored from
        // the key's own contract text and from the same row in the object
        // designer's quick-add grid (`object.form.ts`), so the two surfaces
        // cannot disagree about when a knob applies.
        { field: 'step', visibleWhen: "data.type == 'slider'", helpText: 'Step increment for the slider (default 1). Renderer-only: the write path does not reject a value off the step grid.' },
        { field: 'maxSize', visibleWhen: "data.type in ['image','file','avatar','video','audio']", helpText: 'Maximum permitted file size in BYTES (positive integer). Enforced server-side on write against the stored file size — a file with no recorded size cannot fail it.' },
        { field: 'dimensions', visibleWhen: "data.type == 'vector'", helpText: 'Vector dimensionality — an integer from 1 to 10000 (e.g. 1536 for OpenAI embeddings).' },
        { field: 'language', visibleWhen: "data.type == 'code'", helpText: 'Editor language for syntax highlighting (e.g. javascript, python, sql).' },
        { field: 'autonumberFormat', visibleWhen: "data.type == 'autonumber'", helpText: 'Literal text plus a {0000} counter, {YYYY}/{MM}/{DD}/{YYYYMMDD} date tokens in the business time zone, and {field_name} interpolation. The counter resets per rendered prefix. Omitted on an autonumber field it defaults to {0000}.' },
        { field: 'referenceVia', visibleWhen: "data.type == 'text'", helpText: 'Makes this text field the id half of a polymorphic pointer: names the SIBLING field on the same object that holds the target object name, per row (ADR-0052 §5). snake_case; text fields only, and mutually exclusive with `reference`.' },
        // Select field options
        {
          field: 'options',
          type: 'repeater',
          visibleWhen: "data.type == 'select' || data.type == 'multiselect'",
          helpText: 'Available options (label/value pairs)',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'label', label: 'Label' },
            { field: 'value', label: 'Value' },
            { field: 'description', label: 'Description' },
            { field: 'color', label: 'Color' },
            { field: 'default', label: 'Default' },
            { field: 'visibleWhen', label: 'Visible When' },
          ],
        },
        // Reference field options
        { field: 'reference', widget: 'ref:object', visibleWhen: "data.type == 'lookup' || data.type == 'master_detail'", helpText: 'Referenced object name' },
        // Two declarations of one key, with disjoint `visibleWhen` (#11410) —
        // the same split `object.form.ts` carries, and for the same reason:
        // #9689 made `set_null` on a `master_detail` a parse-time rejection, so
        // one shared control offered a choice publish refuses.
        //
        // This file reached that defect by the OTHER route. It declares no
        // `options`, which is not a narrower offer but the renderer's DERIVED
        // source: with no inline list the metadata-admin form falls through to
        // the JSON Schema `enum` — `['set_null','cascade','restrict']`, which
        // additionally advertises `default: 'set_null'`. A Zod enum has no
        // per-type narrowing to give, so `master_detail` can only be served by
        // an EXPLICIT list; omitting one re-offers the refused value.
        //
        // `lookup` keeps deriving from that enum, untouched: all three outcomes
        // are legal there, and leaving the source alone keeps its labels and
        // their translation exactly as they are today. The two branches are
        // mutually exclusive, so no author ever sees both spellings at once.
        //
        // `helpText` is identical on both — they share one i18n key
        // (`metadataForms.field.fields.deleteBehavior`), so divergent text would
        // collide silently.
        { field: 'deleteBehavior', visibleWhen: "data.type == 'lookup'", helpText: 'What happens when referenced record is deleted' },
        { field: 'deleteBehavior', type: 'select', visibleWhen: "data.type == 'master_detail'", helpText: 'What happens when referenced record is deleted', options: [
          { label: 'Cascade (delete children)', value: 'cascade' },
          { label: 'Restrict (block the delete)', value: 'restrict' },
        ] },
        // #19085 — `relatedListFilter` gets the row its declaration always
        // implied. The served schema DECLARED the key and no form offered it,
        // so an author's only door was the Source tab's free-text JSON, where
        // nothing validates the sibling key they invent until the runtime
        // refuses it.
        //
        // The face is `filter-condition`, ⛔ NOT `filter-builder`: the two
        // widgets speak different wires. `filter-builder` consumes a rule
        // ARRAY (what `view.filter`, `dataset.filter` and `page.filterBy`
        // store); this key is a canonical Query-DSL `FilterCondition` — an
        // object keyed by field, with `$and`/`$or`/`$not`. Routing it to the
        // array widget would write metadata the runtime refuses, which is the
        // authoring trap this row exists to close, re-created one layer up.
        // `filter-condition` names the FilterCondition wire, and this file
        // already uses it one section down for `summaryOperations.filter`, the
        // sibling FilterConditionSchema key.
        //
        // ⚠ What the hint renders as TODAY, measured at the pinned
        // `.objectui-sha`, is the announced raw-JSON editor carrying the hint —
        // ⛔ NOT a criteria builder. The renderer that consumes this registry is
        // the metadata-admin `SchemaForm`, whose own `WIDGETS` map registers no
        // `filter-condition` (the `FilterConditionField` of that name lives in
        // `@object-ui/fields`, on the ComponentRegistry path `ObjectForm` uses,
        // not this one), and its `resolveFieldFace` falls past the registry,
        // past both structural fallbacks — the served node is
        // `{ $ref: '#/$defs/…' }` onto the recursive FilterCondition, an
        // `allOf: [open record, { $and/$or/$not }]` with NO top-level `type`,
        // so neither an object form nor an array-of-objects can be derived
        // (objectui#9912 measured the same for 12 of the 14 served pointer
        // rows) — and lands on `{ kind: 'raw-json', hint }`. That is the same
        // face `summaryOperations.filter` gets, it hands `JSON.parse` output
        // through verbatim, and the save door judges it, so the wire is exact
        // either way. The hint is the forward-looking half: it is what a
        // renderer resolves when it can, and it is ⛔ never `filter-builder`.
        //
        // `visibleWhen` mirrors the key's own contract text — "it is
        // meaningful on a child's `master_detail`/`lookup` field" — and the
        // `reference` row above. The schema accepts the key on every type, so
        // this is a MEANINGFULNESS gate, not a parse gate: on a non-reference
        // field the related-list derivation never reads it, and offering a
        // knob the runtime does not deliver is what Prime Directive #10
        // forbids.
        { field: 'relatedListFilter', widget: 'filter-condition', visibleWhen: "data.type in ['lookup','master_detail']", helpText: "Default filter for this relationship's related list on the parent's detail page — AND-composed with the parent-record match, and the tab badge counts the same set" },
        // The record-picker knobs. All four are read by the lookup renderer and
        // none had a control, so the picker could only be configured from the
        // Source tab.
        { field: 'displayField', visibleWhen: "data.type in ['lookup','master_detail']", helpText: "Field shown as each candidate's label in the picker. Omitted, the referenced object's own title field is used." },
        { field: 'descriptionField', visibleWhen: "data.type in ['lookup','master_detail']", helpText: 'Secondary field shown under the label in the quick-select popover.' },
        { field: 'allowCreate', visibleWhen: "data.type in ['lookup','master_detail']", helpText: 'Let the user create a record from the typed text when the picker finds no match. Best for objects whose only required field is the display field.' },
        { field: 'lookupPageSize', visibleWhen: "data.type in ['lookup','master_detail']", helpText: 'Rows per page in the record-picker dialog — a positive integer; default 10.' },
        { field: 'relatedListTitle', visibleWhen: "data.type in ['lookup','master_detail']", helpText: "Title for this relationship's related list on the parent's detail page." },
        { field: 'inlineTitle', visibleWhen: "data.type == 'master_detail'", helpText: 'Title for the inline master-detail grid on the parent record.' },
        { field: 'inlineAmountField', visibleWhen: "data.type == 'master_detail'", helpText: 'Numeric child field summed for the inline grid total.' },
      ],
    },
    {
      name: 'formula',
      label: 'Formula & Computed',
      description: 'Calculated values and roll-up summaries.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'expression', widget: 'textarea', helpText: 'CEL expression to calculate this field (makes it read-only)' },
        // The four members are what FieldSchema declares — an explicit list, not
        // the derived enum, so this row cannot pick up a member the formula
        // return type does not have.
        { field: 'returnType', type: 'select', visibleWhen: "data.type == 'formula'", helpText: 'Declared value type of the formula, stamped from the inferred CEL type. Consumers read it instead of re-parsing the expression.', options: [
          { label: 'Text', value: 'text' },
          { label: 'Number', value: 'number' },
          { label: 'Boolean', value: 'boolean' },
          { label: 'Date', value: 'date' },
        ] },
        {
          field: 'summaryOperations',
          type: 'composite',
          visibleWhen: "data.type == 'summary'",
          helpText: 'Roll-up summary configuration (for parent-child relationships)',
          // Declare the composite's inner shape so the protocol-driven form
          // renders structured sub-fields (not a raw JSON blob). Mirrors the
          // `summaryOperations` Zod schema in field.zod.ts; `filter` is bound to
          // the FilterCondition widget so only matching child rows aggregate.
          fields: [
            { field: 'object', widget: 'ref:object', required: true, helpText: 'Child object to aggregate' },
            {
              field: 'function',
              type: 'select',
              required: true,
              options: [
                { label: 'Count', value: 'count' },
                { label: 'Sum', value: 'sum' },
                { label: 'Min', value: 'min' },
                { label: 'Max', value: 'max' },
                { label: 'Average', value: 'avg' },
              ],
              helpText: 'Aggregation function',
            },
            { field: 'field', required: true, helpText: 'Child field to aggregate (ignored for count)' },
            { field: 'relationshipField', helpText: 'Child FK back to this parent (auto-detected when omitted)' },
            { field: 'filter', widget: 'filter-condition', helpText: 'Only child rows matching this predicate are aggregated (e.g. status == received)' },
          ],
        },
      ],
    },
    {
      name: 'advanced',
      label: 'Advanced',
      description: 'Database, UI, audit, and security settings.',
      collapsible: true,
      collapsed: true,
      columns: 2,
      fields: [
        // Database & Performance
        { field: 'externalId', colSpan: 1, helpText: 'Mark as external ID for upsert operations' },
        // UI & Visibility
        { field: 'readonly', colSpan: 1, helpText: 'Field is read-only in forms' },
        { field: 'hidden', colSpan: 1, helpText: 'Hide field from default UI views' },
        { field: 'searchable', colSpan: 1, helpText: 'Include in global search results' },
        { field: 'sortable', colSpan: 1, helpText: 'Allow sorting lists by this field' },
        // Partial masking (#8993): a preset name or a {keepHead, keepTail} JSON
        // object; the runtime FieldMasker enforces it on read AND export.
        { field: 'maskingRule', colSpan: 2, helpText: "Partial masking: preset ('phone', 'id_card', 'bank_account', 'email', 'name') or {\"keepHead\": n, \"keepTail\": m}. Masked for callers not holding this field's requiredPermissions" },
        { field: 'internal', colSpan: 1, helpText: "Never return this field's value on the generic data path: the engine omits the key from find/findOne results and from the create and update response bodies, on the default projection and when a client names the field in ?select=. Storage, filtering and indexing are untouched." },
        { field: 'trackHistory', colSpan: 1, helpText: "Render this field's value changes as entries on the record activity timeline (ADR-0052 §5b). Opt-in per field." },
        { field: 'widget', colSpan: 2, helpText: 'Form widget override — names a registered field component, looked up as `field:` plus this name, to render the field instead of the type default. An unregistered name degrades to the type renderer.' },
        { field: 'ackPlaintextMasking', label: 'Acknowledge plaintext at rest', colSpan: 2, visibleWhen: "data.type == 'password'", helpText: "Affirm that this generic password field's plaintext-at-rest, masked-on-read contract is intended, silencing the author-time warning (ADR-0100). No effect on any other type." },
      ],
    },
  ],
});
