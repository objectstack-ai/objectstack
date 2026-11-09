/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The words the Pending changes drill-in names a property by (objectstack#27835):
 * the label the item type's authoring form gives that property, as the
 * inspector's `SchemaForm` row shows it — the row's own `label`, else its
 * prettified machine name. The form is the spec's own, read from
 * `METADATA_FORM_REGISTRY`, the one type → form map `/meta/types` serves; no
 * key → label table lives here.
 *
 * A property the form declares no row for has no label: the drill-in shows its
 * key, as before.
 *
 * Translated as the inspector translates its rows (objectstack#29704): the
 * form passes through the inspector's own locale overlay
 * (`localizeMetadataForm`), and a row it leaves unlabelled reads the raw
 * schema-field label `SchemaForm` falls back to (`translateSchemaFieldLabel`),
 * then its prettified machine name. Both come from modules that carry no
 * string table, so this panel's EAGER graph stays off the metadata-admin one
 * (see `computeChangeDetail`).
 */

import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { prettifyFieldName } from '../views/metadata-admin/field-source-label.js';
import { localizeMetadataForm } from '../views/metadata-admin/metadata-form-i18n.js';
import { translateSchemaFieldLabel } from '../views/metadata-admin/schema-field-label.js';

interface FormRow {
  field: string;
  label?: unknown;
  fields?: ReadonlyArray<FormRow | string>;
}

function asRow(row: FormRow | string): FormRow {
  return typeof row === 'string' ? { field: row } : row;
}

type FormShape = { sections?: ReadonlyArray<{ fields?: ReadonlyArray<FormRow | string> }> };

/**
 * Every top-level row of `type`'s form, across all of its sections, with the
 * inspector's overlay for `locale` applied (the same form object when it has
 * none for that locale).
 */
function formRootRows(type: string, locale: string | undefined): FormRow[] {
  const declared = Object.prototype.hasOwnProperty.call(METADATA_FORM_REGISTRY, type)
    ? (METADATA_FORM_REGISTRY[type] as Record<string, unknown>)
    : undefined;
  const form = localizeMetadataForm(declared, type, locale) as FormShape | undefined;
  return (form?.sections ?? []).flatMap((section) => (section.fields ?? []).map(asRow));
}

/**
 * The row the form declares at `path`, one segment per level: a top-level row
 * first, then the declared sub-rows of each row below it. A view is stored as a
 * ViewItem whose view body sits under `config`, and its inspector renders the
 * view form against that body (`draft.config`), so `config.KEY` is the form's
 * top-level `KEY` there.
 */
function formRowAt(type: string, path: readonly string[], locale: string | undefined): FormRow | undefined {
  const segments = type === 'view' && path[0] === 'config' && path.length > 1 ? path.slice(1) : path;
  let rows: FormRow[] = formRootRows(type, locale);
  let row: FormRow | undefined;
  for (const segment of segments) {
    row = rows.find((r) => r.field === segment);
    if (!row) return undefined;
    rows = (row.fields ?? []).map(asRow);
  }
  return row;
}

/**
 * The label `type`'s form gives the property at dot path `key`, as its form
 * row shows it in `locale` (the spec's English when none is given);
 * `undefined` when the form has no row there.
 */
export function formKeyLabel(type: string, key: string, locale?: string): string | undefined {
  const path = key.split('.');
  const row = formRowAt(type, path, locale);
  if (!row) return undefined;
  const declared = typeof row.label === 'string' ? row.label.trim() : '';
  if (declared !== '') return declared;
  const last = path[path.length - 1]!;
  return translateSchemaFieldLabel(last, undefined, locale) ?? prettifyFieldName(last);
}

/**
 * Whether a row named `label` should still show its key: only when the label
 * does not already spell its last segment — `SchemaForm`'s own machine-name
 * rule, so `sharingModel` under "Sharing Model" shows no key and
 * `fieldGroups.relatedList` under "Related List" shows none either.
 */
export function labelSpellsKey(label: string, key: string): boolean {
  const last = key.split('.').pop() ?? key;
  return prettifyFieldName(last).toLowerCase() === label.toLowerCase();
}
