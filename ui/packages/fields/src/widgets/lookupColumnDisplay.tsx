/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE place that answers "what does column C of a candidate record
 * display?" for a lookup field (objectui#5492).
 *
 * A lookup declares its columns once (`lookupColumns`) and
 * two surfaces consume that one declaration:
 *
 *   1. the inline dropdown under the form field (LookupField's popover), and
 *   2. the "browse all records" picker (RecordPickerDialog's table).
 *
 * They used to answer differently. The picker resolved each cell through the
 * type-aware cell renderer, while the dropdown built its option subtitle and
 * its hover tooltip by plain string concatenation of the RAW stored value — so
 * one declaration produced a resolved name in the picker and a bare foreign-key
 * id in the dropdown, a formatted date beside a raw ISO timestamp, an option
 * label beside an enum code. Both surfaces now call into this module, so the
 * two cannot drift again: there is only one renderer left.
 *
 * Note what this module deliberately does NOT do: it does not widen the
 * `lookupColumns` contract. Column entries stay bare field names — no dot
 * paths, no populate/expand semantics. A lookup column whose value arrives as
 * an unresolved foreign-key id is resolved the same way the picker has always
 * resolved it — client-side, by the lookup cell renderer — so the two surfaces
 * agree whether or not the related record came back expanded: both queries ask
 * for `$expand` on the readable reference columns they display
 * (objectui#10223), and an expanded value renders through that same cell
 * renderer without a fetch.
 */

import React from 'react';
import { formatDate, getRecordDisplayName } from '@object-ui/core';
import type { LookupColumnDef } from '@object-ui/types';
import { BooleanValueText } from './booleanValueLabel.js';

/**
 * Cell renderer function signature — matches `getCellRenderer` from
 * `@object-ui/fields`. Re-declared here (rather than imported from
 * RecordPickerDialog) so this module sits BELOW both consumers in the import
 * graph and neither surface can pull the other in.
 */
export type LookupCellRendererResolver = (
  fieldType: string,
) => React.FC<{ value: any; field: any }>;

/**
 * A select option as the object schema declares it — `{ value, label }` plus
 * whatever the renderer also reads (`color`, …), which the i18n translation
 * carries through untouched.
 */
export type SchemaOption = { value: any; label: string; [key: string]: any };

/** Translate a schema field's options through the shared i18n option path. */
export type OptionTranslator = (
  objectName: string,
  fieldName: string,
  options: SchemaOption[],
) => SchemaOption[];

/**
 * Normalise a lookupColumns entry (string | LookupColumnDef) into a
 * concrete LookupColumnDef object.
 */
export function normalizeColumn(col: string | LookupColumnDef): LookupColumnDef {
  return typeof col === 'string' ? { field: col } : col;
}

/**
 * Pretty-print a field name as a column header label.
 * Converts snake_case / camelCase to Title Case.
 */
export function fieldToLabel(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Resolve a field's select options from the referenced object's schema field
 * definition (`fieldsMeta[field]`), translated through the shared i18n option
 * path.
 *
 * This is the SINGLE source for every surface that needs option labels: the
 * picker table cells (#3333), the picker's filter panel select inputs (#3336)
 * and the inline dropdown's option preview (#5492) — so a picker column, the
 * filter input for that same column and the dropdown row can never disagree
 * about what an option is called.
 *
 * Returns `undefined` when the schema field declares no options: a select
 * field with no authored options genuinely has nothing to offer, and
 * synthesising entries from the loaded page's raw stored values would paper
 * over the metadata gap with a list that changes per page.
 */
export function resolveSchemaOptions(
  meta: { options?: unknown } | undefined,
  objectName: string,
  fieldName: string,
  translateOptions: OptionTranslator,
): SchemaOption[] | undefined {
  const raw = meta?.options;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const options = raw as SchemaOption[];
  if (!objectName) return options;
  return translateOptions(objectName, fieldName, options);
}

/**
 * Field descriptors handed to the type-aware cell renderers, enriched from the
 * referenced object's schema (`fieldsMeta`) the same way the list view enriches
 * its columns. This is what lets a `select` column resolve its option label
 * (options + i18n) instead of title-casing the raw value (#3333), and what
 * carries `reference` through to the lookup cell renderer so
 * an unresolved foreign-key id resolves to a name (#5492).
 *
 * Columns whose def carries no `type` inherit the schema field's type, so
 * string-authored `lookupColumns` format identically to object-authored ones.
 */
export function buildLookupColumnDescriptors(
  columns: LookupColumnDef[],
  fieldsMeta: Record<string, any> | undefined,
  objectName: string,
  translateOptions: OptionTranslator,
): Record<string, any> {
  const map: Record<string, any> = {};
  for (const col of columns) {
    const meta = fieldsMeta?.[col.field];
    const type = col.type ?? meta?.type;
    if (!type) continue;
    const descriptor: any = meta ? { ...meta, name: col.field, type } : { name: col.field, type };
    const options = resolveSchemaOptions(meta, objectName, col.field, translateOptions);
    if (options) descriptor.options = options;
    map[col.field] = descriptor;
  }
  return map;
}

export interface LookupColumnRenderContext {
  /** Field descriptors from {@link buildLookupColumnDescriptors}. */
  descriptors: Record<string, any>;
  /** Type-aware renderer resolver; when absent every cell degrades to text. */
  cellRenderer?: LookupCellRendererResolver;
  /**
   * The referenced object's schema. When given, the display column renders the
   * record's title through `@object-ui/core`'s `getRecordDisplayName`, the same
   * call the lookup dropdown's option label and the read cell make
   * (objectui#10486).
   */
  objectSchema?: Record<string, unknown> | null;
  /**
   * The lookup field's DECLARED display field, handed to the resolver as its
   * `titleField`. `undefined` when the field declares none: the `name` default
   * the display column is keyed on is a guess, and a guess never outranks the
   * referenced object's own declarations.
   */
  titleField?: string;
  /** The column the record title stands in for (the display column's key). */
  displayField?: string;
  /** Locale for the plain-text `$date` fallback. */
  displayLocale?: string;
}

/**
 * Render one column of one candidate record.
 *
 * Order:
 *   1. the record title, for the display column only and only when the
 *      referenced object's schema is given: `getRecordDisplayName` with the
 *      lookup's declared display field as its `titleField`, i.e. the field's
 *      own `displayField`, then the object's `nameField`, then its deprecated
 *      `titleFormat` template, then type-aware derivation (ADR-0079; the lookup
 *      branch of objectui#9436's ruling C1). The resolver's own floor
 *      (`Untitled` / `Record #<id>`) is not a title here, so a record with
 *      nothing nameable falls through to step 2 and keeps its column's value.
 *   2. the type-aware cell renderer for the column's field descriptor.
 *   3. a plain-text fallback for columns with no descriptor / no resolver.
 *
 * Step 3 never blanks a populated value: an object with no recognised shape
 * keeps its JSON and a primitive keeps its `String()` form. That floor is
 * deliberate — an unresolved reference showing its bare id is strictly better
 * than a silently empty column (objectui#5492).
 */
export function renderLookupColumnValue(
  record: any,
  col: LookupColumnDef,
  ctx: LookupColumnRenderContext,
): React.ReactNode {
  const { descriptors, cellRenderer, objectSchema, titleField, displayField, displayLocale } = ctx;

  // The display column reads the record's title exactly as the dropdown's
  // option label does (`recordToOption` in LookupField): same resolver, same
  // `titleField`, same floor exclusion. The ladder itself lives in
  // `getRecordDisplayName` alone, so the picker, the dropdown and the read cell
  // cannot rank the object's declarations differently again (objectui#10486).
  if (objectSchema && col.field === displayField) {
    const title = getRecordDisplayName(objectSchema, record, { titleField });
    const id = record?.id ?? record?._id;
    const isFloor =
      title === 'Untitled' || (id !== null && id !== undefined && title === `Record #${id}`);
    if (!isFloor) return title;
  }

  const val = record?.[col.field];

  // Use the type-aware renderer when a field descriptor (column `type`, or the
  // schema field's type via `fieldsMeta`) and a resolver are available.
  const descriptor = descriptors[col.field];
  if (descriptor && cellRenderer) {
    const Renderer = cellRenderer(descriptor.type);
    if (Renderer) {
      return <Renderer value={val} field={descriptor} />;
    }
  }

  // Fallback: plain text formatting.
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    // Handle MongoDB types / expanded references
    if (val.$numberDecimal) return String(Number(val.$numberDecimal));
    if (val.$oid) return String(val.$oid);
    // `formatDate`'s DEFAULT style — the one home for the `date` display
    // convention (objectui#8194, following the maintainer's ruling A behind
    // `c15d7eca6`). This fallback used to call `toLocaleDateString` with NO
    // options bag, i.e. `Intl`'s numeric default (`7/4/2026`), which made the
    // split visible INSIDE this one function: a column that HAS a descriptor
    // goes through `cellRenderer` above -> `DateCellRenderer` -> `formatDate`
    // and renders `Jul 4`, while a column that has none landed here and
    // rendered `7/4/2026`. Two faces for one value in one picker table,
    // chosen by which path the cell happened to take.
    // The value is handed over unchanged: `formatDate` parses it with the same
    // `value instanceof Date ? value : new Date(value)` step this line used to
    // do inline, so nothing about WHICH instant is read changes here.
    if (val.$date) return formatDate(val.$date, undefined, { locale: displayLocale });
    if (val.name || val.label) return String(val.name || val.label);
    return JSON.stringify(val);
  }
  // The locale's word for the value (objectui#11689), the one every read-only
  // boolean word reads. A node rather than a string: this function cannot call
  // the translation hook itself, and both callers render what it returns.
  if (typeof val === 'boolean') return <BooleanValueText value={val} />;
  return String(val);
}
