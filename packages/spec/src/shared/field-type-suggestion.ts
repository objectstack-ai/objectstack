// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { FieldType } from '../data/field.zod';

import { findClosestMatches } from './suggestions.zod';

/**
 * "Did you mean?" for a mistyped field `type` — the one suggester that needs
 * the FieldType vocabulary, kept OUT of `suggestions.zod.ts` on purpose (#19930).
 *
 * ## Why this is its own module
 *
 * `suggestions.zod.ts` is imported by `strict-object.ts`, and `strict-object.ts`
 * is imported by nearly every closed schema in this package — `data/filter.zod`
 * among them. While `suggestFieldType` lived there, `suggestions.zod.ts` carried
 * a VALUE import of `FieldType` from `data/field.zod`, so the first
 * `strictObject` import anywhere dragged `field.zod` in mid-flight:
 *
 *     data/filter.zod → shared/strict-object → shared/suggestions.zod → data/field.zod
 *
 * Under the default lazy schemas nothing reads a half-initialized partner at
 * module init, so the loop was invisible. Under `OS_EAGER_SCHEMAS=1` — the
 * documented emergency rollback, and how `gen:schema` runs — `field.zod`'s
 * `FieldSchema` factory runs at once and reads `FilterConditionSchema` while
 * `filter.zod` is still importing: the published `@objectstack/spec/api` and
 * `/data` entries threw at import (`Cannot access 'FilterConditionSchema'
 * before initialization` from source, `reading 'optional'` of undefined from
 * the bundle), as did 22 of the package's source modules taken as a first
 * import.
 *
 * `FieldType` is read here only when a suggestion is asked for, never at module
 * evaluation, so the dependency could always have been this one-directional
 * edge. Moving it here leaves `suggestions.zod.ts` free of schema imports, and
 * the public names are unchanged: `suggestFieldType` is still exported from
 * `@objectstack/spec` and `@objectstack/spec/shared`.
 *
 * ⛔ Do not move it back, and do not give `suggestions.zod.ts` any other value
 * import of a schema module — see that file's header.
 * `eager-entry-import.test.ts` imports every published entry first under the
 * flag and goes red on the loop.
 */

/**
 * Well-known aliases that map common typos / alternative names to valid FieldTypes.
 */
const FIELD_TYPE_ALIASES: Record<string, string> = {
  // Common alternative names
  string: 'text',
  str: 'text',
  varchar: 'text',
  char: 'text',
  int: 'number',
  integer: 'number',
  float: 'number',
  double: 'number',
  decimal: 'number',
  numeric: 'number',
  bool: 'boolean',
  checkbox: 'boolean',
  check: 'boolean',
  date_time: 'datetime',
  timestamp: 'datetime',
  // Common typos
  text_area: 'textarea',
  textarea_: 'textarea',
  textfield: 'text',
  dropdown: 'select',
  picklist: 'select',
  enum: 'select',
  multi_select: 'multiselect',
  multiselect_: 'multiselect',
  reference: 'lookup',
  ref: 'lookup',
  foreign_key: 'lookup',
  fk: 'lookup',
  relation: 'lookup',
  master: 'master_detail',
  richtext_: 'richtext',
  rich_text: 'richtext',
  upload: 'file',
  attachment: 'file',
  photo: 'image',
  picture: 'image',
  img: 'image',
  percent_: 'percent',
  percentage: 'percent',
  money: 'currency',
  price: 'currency',
  auto_number: 'autonumber',
  auto_increment: 'autonumber',
  sequence: 'autonumber',
  markdown_: 'markdown',
  md: 'markdown',
  barcode: 'qrcode',
  tag: 'tags',
  star: 'rating',
  stars: 'rating',
  geo: 'location',
  gps: 'location',
  coordinates: 'location',
  embed: 'vector',
  embedding: 'vector',
  embeddings: 'vector',
};

/**
 * Suggest valid FieldType values for an invalid input.
 *
 * First checks known aliases, then falls back to fuzzy matching.
 *
 * @param input - Invalid field type string
 * @returns Array of suggested valid FieldType values
 *
 * @example
 * ```ts
 * suggestFieldType('text_area');  // ['textarea']
 * suggestFieldType('String');     // ['text']
 * suggestFieldType('int');        // ['number']
 * suggestFieldType('dropdown');   // ['select']
 * ```
 */
export function suggestFieldType(input: string): string[] {
  const normalized = input.toLowerCase().replace(/[-\s]/g, '_');

  // Check alias map first
  const alias = FIELD_TYPE_ALIASES[normalized];
  if (alias) {
    return [alias];
  }

  // Fall back to fuzzy matching
  return findClosestMatches(normalized, FieldType.options);
}
