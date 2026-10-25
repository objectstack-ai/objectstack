/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The slice of a field definition the widget decision reads beyond `type`.
 *
 * Structural (not the spec `Field`) for the same reason the spec's own
 * `ValueShapeFieldDef` is: every caller — object-schema metadata, a spec
 * `FormFieldSchema` override, an action param def — can pass its own trimmed
 * shape verbatim. `multiple` is the only key read; nothing else here is
 * consulted, so a caller that has the whole metadata object may hand it over
 * as-is.
 */
export interface FieldTypeMappingConfig {
  /** `FieldSchema.multiple` — the field holds zero-or-more values. */
  multiple?: boolean | null;
}

/**
 * Field types whose `multiple: true` form is a DIFFERENT registered widget,
 * rather than the same widget in another mode (objectui#3986).
 *
 * `select` is the only member, and the narrowness is measured, not assumed. The
 * spec's `MULTI_CAPABLE_TYPES` is larger — select / lookup / file / image, with
 * `radio` on the select branch and `user` storing like `lookup` — and every
 * member EXCEPT `radio` renders both arities INSIDE one widget: `LookupField`,
 * `FileField` and `ImageField` each branch on `multiple` themselves, and
 * `UserField` inherits that branch by delegating to `LookupField`, so their
 * registry id, and with it their `labelling` declaration, is the same either
 * way. A `select` declared `multiple: true` renders `MultiSelectField` instead:
 * a different component, whose labelled surface is a chip row's container that
 * a `<label for>` cannot address (it must be named by IDREF, which is what
 * `field:multiselect`'s `labelling: 'group'` declares — objectui#3975/#3961).
 *
 * `radio` is the EXCEPTION, and it is deliberate rather than a gap to be patched
 * here: `RadioField` reads `multiple` nowhere, so a spec-legal
 * `{ type: 'radio', multiple: true }` renders an ordinary single-value radio
 * group — radio is the one `MULTI_CAPABLE_TYPES` member with no multi-arity
 * renderer at all. Do not paper over that by mapping radio onto a checkbox
 * group: this repo's emitted value-shape contract pins radio as single-value
 * (`@object-ui/app-shell`'s `PARAM_VALUE_SHAPES` declares `radio` with
 * `cardinality: 'scalar'`, drift-tested in `paramValueShape.test.ts`), so a
 * multi-value rendering would emit `string[]` where that contract says
 * `string`. The mismatch is being addressed on the PRODUCER side instead: the
 * maintainer ruling of 2026-08-22 refuses an authored `radio` + `multiple: true`
 * at the spec's schema/publish entrance, prescribing `checkboxes`/`multiselect`/
 * `tags`. That work is tracked in objectstack-ai/objectstack#11437 (filed, not
 * landed as of this comment), with objectui#4015 as the decision anchor.
 *
 * So the widget id has to carry the arity. When it did not, the host label was
 * associated by the declaration registered under `select` — a single-value
 * combobox that was NOT rendering — and the visible label of a normal
 * `{ type: 'select', multiple: true }` picklist named nothing at all. One place
 * decides which widget renders, so the declaration and the render cannot
 * disagree again.
 */
const MULTI_VALUE_FORM_TYPES: Record<string, string> = {
  select: 'field:multiselect',
};

/**
 * The retirement half of this module — the TOMBSTONE table
 * {@link RETIRED_FIELD_TYPES}, the {@link isRetiredFieldType} gate, and the
 * once-per-spelling reporter — now lives in `@object-ui/core`
 * (`utils/retired-field-types.ts`), hoisted there by objectui#4914 so that
 * `@object-ui/components`' filter builder can read the SAME table: `fields`
 * depends on `components`, so the six ruled predicate faces could not all
 * reach a table that lived here. The module's docblock carries the full
 * reasoning, including why a second copy in `components` would have broken the
 * ruling's "fires once" clause on day one.
 *
 * Re-exported from here, and from the `./index` barrel, so `@object-ui/fields`'
 * published surface is exactly what it was plus the newly ruled gate. This file
 * remains the retirement table's first consumer (the `field:text` tail below).
 */
export {
  RETIRED_FIELD_TYPES,
  isRetiredFieldType,
  reportRetiredFieldType,
  resetRetiredFieldTypeReports,
} from '@object-ui/core';
import { reportRetiredFieldType } from '@object-ui/core';

/** Namespace prefix the retired spellings resolve into. */
const RETIRED_WIDGET_KEY_PREFIX = 'field:';

/**
 * Map field type to form component type
 *
 * @param fieldType - The ObjectQL field type identifier to convert
 * (for example: `"text"`, `"number"`, `"date"`, `"lookup"`).
 * @param config - The rest of the field definition, for the types whose widget
 * identity depends on more than the type string. Only `multiple` is read; see
 * {@link MULTI_VALUE_FORM_TYPES}. Omitting it maps the single-value form, which
 * is what every non-multi-capable type resolves to anyway.
 * @returns The normalized form field type string used in the form schema
 * (for example: `"input"`, `"textarea"`, `"date-picker"`, `"select"`).
 */
export function mapFieldTypeToFormType(
  fieldType: string,
  config?: FieldTypeMappingConfig,
): string {
  const typeMap: Record<string, string> = {
    // Text-based fields
    text: 'field:text',
    textarea: 'field:textarea',
    markdown: 'field:markdown', // Markdown editor (fallback to textarea)
    html: 'field:html', // Rich text editor (fallback to textarea)
    richtext: 'field:richtext', // WYSIWYG rich-text editor
    secret: 'field:password', // encrypted-at-rest value — mask input like a password

    // Numeric fields
    number: 'field:number',
    currency: 'field:currency',
    percent: 'field:percent',
    slider: 'field:slider',
    progress: 'field:slider', // bounded 0..100 progress — edit via slider
    rating: 'field:rating',

    // Date/Time fields
    date: 'field:date',
    datetime: 'field:datetime',
    time: 'field:time',

    // Boolean
    boolean: 'field:boolean',
    toggle: 'field:boolean', // toggle is a boolean rendered as a switch

    // Selection fields
    select: 'field:select',
    multiselect: 'field:multiselect',
    radio: 'field:radio',
    checkboxes: 'field:checkboxes',
    tags: 'field:tags',
    lookup: 'field:lookup',
    master_detail: 'field:master_detail',
    tree: 'field:lookup', // hierarchical reference — pick the parent via a lookup
    // `user` is a lookup specialized to sys_user, rendered by the UserField
    // person-picker (which delegates to the lookup picker). Without it the type
    // would fall through to `field:text`.
    //
    // `owner` was its synonym until objectui#4814 retired it — see
    // {@link RETIRED_FIELD_TYPES}. It is deliberately NOT re-added here: a
    // retired spelling must not resolve through the live table.
    user: 'field:user',

    // Contact fields
    email: 'field:email',
    phone: 'field:phone',
    url: 'field:url',

    // File / media fields
    file: 'field:file',
    image: 'field:image',
    avatar: 'field:avatar',
    video: 'field:file', // uploads as a file
    audio: 'field:file', // uploads as a file
    signature: 'field:signature',

    // Special / enhanced fields
    password: 'field:password',
    location: 'field:location', // Location/map field (fallback to input)
    geolocation: 'field:geolocation',
    address: 'field:address',
    color: 'field:color',
    code: 'field:code',
    // A JSON value is edited as JSON — shown with `JSON.stringify`, saved
    // with `JSON.parse` — by the editor `object`, `composite` and `record`
    // below use (objectui#11448). It used to alias `field:code`, the raw-text
    // editor, which showed a stored object as `[object Object]` and saved an
    // edit as a string. `code` keeps the raw-text editor.
    json: 'field:object',
    qrcode: 'field:qrcode',
    vector: 'field:vector',

    // Embedded structured values (stored as JSON on the row)
    object: 'field:object',
    composite: 'field:object', // embedded object
    record: 'field:object', // name-keyed map
    repeater: 'field:grid', // embedded array of rows

    // Auto-generated/computed fields (typically read-only)
    formula: 'field:formula',
    summary: 'field:summary',
    // `@objectstack/spec` spells this `autonumber`; the widget map key is
    // `auto_number`. Map both spellings so a spec-typed field/param doesn't
    // fall through to the plain text input.
    autonumber: 'field:auto_number',
    auto_number: 'field:auto_number',
  };

  // The arity override comes FIRST and is table-driven: only a type listed in
  // `MULTI_VALUE_FORM_TYPES` has a second widget to move to, so `multiple` on
  // any other type (a multi `lookup`, a multi `file`) resolves exactly as
  // before and keeps reaching the widget that handles both arities itself.
  if (config?.multiple && MULTI_VALUE_FORM_TYPES[fieldType]) {
    return MULTI_VALUE_FORM_TYPES[fieldType];
  }

  const live = typeMap[fieldType];
  if (live) return live;

  // A RETIRED spelling is answered before the `field:text` tail, and never by
  // it: falling through would render a working text input, which is exactly the
  // silent degradation the tombstone exists to prevent (objectui#4814).
  if (reportRetiredFieldType(fieldType)) {
    return `${RETIRED_WIDGET_KEY_PREFIX}${fieldType}`;
  }

  return 'field:text';
}
