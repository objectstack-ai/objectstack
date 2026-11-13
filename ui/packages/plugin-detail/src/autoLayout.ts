/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Auto-Layout for DetailView
 *
 * Provides intelligent, zero-configuration default layout for detail sections.
 * When the user has not explicitly set columns on a section, this module
 * infers optimal column count based on the number of fields.
 *
 * Priority: User configuration > Auto-layout inference
 *
 * Column rules mirror the entry form's `inferColumns` so a record reads at the
 * same width in view and edit (objectui#2578 "多列显示"):
 * - 0-3 fields   → 1 column
 * - 4-8 fields   → 2 columns
 * - 9-15 fields  → 3 columns
 * - 16+ fields   → 4 columns
 *
 * This is the UPPER BOUND; the grid's responsive breakpoints clamp it to the
 * real container width at render, so a heavy record does not render 4 sparse
 * columns on a narrow viewport.
 */

import type { DetailViewField } from '@object-ui/types';

/**
 * Field types that should span full width in multi-column layouts.
 *
 * Two spellings per type on purpose: the BARE entries are `@objectstack/spec`
 * `FieldType` names (a raw `objectDef.fields[x].type` reaches here from the
 * detail synth and from app-shell's form designer), the `field:` entries are
 * the widget ids `mapFieldTypeToFormType` produces. Both are matched RAW, so a
 * bare member that is not a spec type name — and a `field:` member that is not
 * a registered widget id — silently matches nothing.
 *
 * That is what `rich-text` / `field:rich-text` were: the spec spells the type
 * `richtext` (widget `field:richtext`) and REJECTS `rich-text`, which survives
 * only as a typo key in the spec's own `suggestFieldType` table. The set
 * therefore never widened a rich-text field, while `markdown` and `html` right
 * beside it did (#4250). The dead spellings are dropped rather than kept
 * alongside: the alias table is the one place aliases belong.
 *
 * `grid` is NOT a spec `FieldType` — it is a sanctioned objectui-local key
 * (`GridFieldMetadata` in `@object-ui/types`), which is why it is exempt from
 * the spec-name pin in the tests.
 */
const WIDE_FIELD_TYPES = new Set([
  'textarea',
  'markdown',
  'html',
  'grid',
  'richtext',
  'field:textarea',
  'field:markdown',
  'field:html',
  'field:grid',
  'field:richtext',
]);

/**
 * Check if a field type is "wide" (should span full row in multi-column layout).
 */
export function isWideFieldType(type: string): boolean {
  return WIDE_FIELD_TYPES.has(type);
}

/**
 * Field types whose value is a LIST of files once the object field declares
 * `multiple: true` — the multi-capable upload types `@objectstack/spec`
 * declares (`file`, `image`), in the same two spellings as
 * {@link WIDE_FIELD_TYPES}: the bare spec name and the widget id
 * `mapFieldTypeToFormType` maps it to.
 *
 * Kept OUT of `WIDE_FIELD_TYPES` on purpose: the type alone does not make the
 * field wide — a single file is one short name and reads fine in one cell —
 * so {@link isWideFieldType} keeps answering on the type alone, the question
 * the entry form asks too.
 */
const MULTI_FILE_FIELD_TYPES = new Set(['file', 'image', 'field:file', 'field:image']);

/** The object-field keys {@link isWideDetailField} reads. */
export type DetailLayoutObjectFields = Record<
  string,
  { readonly multiple?: unknown; readonly [key: string]: unknown } | null | undefined
>;

/**
 * Should this detail field take the full row?
 *
 * A wide type (see {@link isWideFieldType}), or a `file` / `image` field whose
 * OBJECT field declares `multiple: true`: its value is a list of file names,
 * and in one cell of a multi-column grid each name is cut short, so the reader
 * cannot tell the files apart. The detail panel offers the author no width key
 * (the form's `span` does not reach it), so the default is the only lever.
 *
 * `multiple` is read from the object field and nothing else: it is the
 * field's declaration, and a detail-view entry declares no such key.
 */
export function isWideDetailField(
  field: DetailViewField,
  objectFields?: DetailLayoutObjectFields,
): boolean {
  if (!field.type) return false;
  if (isWideFieldType(field.type)) return true;
  return (
    MULTI_FILE_FIELD_TYPES.has(field.type) &&
    objectFields?.[field.name]?.multiple === true
  );
}

/**
 * Infer optimal number of columns for a detail section based on field count.
 * When containerWidth is provided, limits columns for narrower viewports.
 *
 * Rules (field-count based, aligned with the form):
 * - 0-3 fields   → 1 column
 * - 4-8 fields   → 2 columns
 * - 9-15 fields  → 3 columns
 * - 16+ fields   → 4 columns
 *
 * Responsive capping (when containerWidth is supplied):
 * - containerWidth < 640px → max 1 column
 */
export function inferDetailColumns(fieldCount: number, containerWidth?: number): number {
  // Density scale — the UPPER BOUND, identical to the entry form's
  // `inferColumns` (plugin-form) so a record reads at the same width in view
  // and edit (objectui#2578 "多列显示"). The detail path previously
  // hard-capped at 2, which is why field-heavy records showed 2 columns in
  // detail but 4 in the form. The grid's breakpoints clamp this to the real
  // width at render.
  let cols: number;
  if (fieldCount <= 3) cols = 1;
  else if (fieldCount <= 8) cols = 2;
  else if (fieldCount <= 15) cols = 3;
  else cols = 4;

  // Apply responsive capping when container width is known
  if (containerWidth !== undefined) {
    if (containerWidth < 640) return Math.min(cols, 1);
  }

  return cols;
}

/**
 * Apply auto span to wide fields so they span the full row.
 * Only sets span if the field does not already have one explicitly set.
 *
 * @returns A new array of fields with span applied where needed.
 */
export function applyAutoSpan(
  fields: DetailViewField[],
  columns: number,
  objectFields?: DetailLayoutObjectFields,
): DetailViewField[] {
  if (columns <= 1) return fields;

  return fields.map((field) => {
    // User-defined span takes priority
    if (field.span !== undefined) return field;

    // Wide fields should span full row
    if (isWideDetailField(field, objectFields)) {
      return { ...field, span: columns };
    }

    return field;
  });
}

/**
 * Main auto-layout orchestrator for detail sections.
 * Applies intelligent defaults only when the user has not explicitly configured columns.
 *
 * @param fields - The section fields
 * @param schemaColumns - User-provided columns (from DetailViewSection or DetailViewSchema)
 * @param containerWidth - Optional container width in px for responsive column capping
 * @param objectFields - The object's field definitions, for the `multiple` a multi-file field declares
 * @returns Object with processed fields and inferred columns
 */
export function applyDetailAutoLayout(
  fields: DetailViewField[],
  schemaColumns: number | undefined,
  containerWidth?: number,
  objectFields?: DetailLayoutObjectFields,
): { fields: DetailViewField[]; columns: number } {
  // If user explicitly set columns, respect it but still apply auto span
  if (schemaColumns !== undefined) {
    const processed = applyAutoSpan(fields, schemaColumns, objectFields);
    return { fields: processed, columns: schemaColumns };
  }

  // Infer columns from field count (with optional container-width capping)
  const columns = inferDetailColumns(fields.length, containerWidth);

  // Apply auto span for wide fields
  const processed = applyAutoSpan(fields, columns, objectFields);

  return { fields: processed, columns };
}
