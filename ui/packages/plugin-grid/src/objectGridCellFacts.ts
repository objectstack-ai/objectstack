/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What `ObjectGrid` tells the select-first table about a cell
 * (objectstack#35684, objectstack#35687): why it opens no editor, what typing
 * on it does, and what pasted text stands for. The table asks when the reader
 * acts on a cell, never while it draws.
 */
import { buildValidationRules } from '@object-ui/fields';
import { fieldInlineReadOnlyKind } from './inline-edit-options';

/** Why a cell opens no editor, in the order a cell names them. */
export type CellReadOnlyKind =
  | 'readonly'
  | 'computed'
  | 'notInline'
  | 'noFieldPermission'
  | 'viewOff'
  | 'objectReadOnly'
  | 'noPermission'
  | 'approvalLocked'
  | 'noRecordPermission';

/** The sentence a cell shows for a reason, in the reader's language. */
export function readOnlyReasonText(kind: CellReadOnlyKind, t: (key: string) => string): string {
  switch (kind) {
    case 'readonly': return t('grid.readOnlyReason.readonly');
    case 'computed': return t('grid.readOnlyReason.computed');
    case 'notInline': return t('grid.readOnlyReason.notInline');
    case 'noFieldPermission': return t('grid.readOnlyReason.noFieldPermission');
    case 'viewOff': return t('grid.readOnlyReason.viewOff');
    case 'objectReadOnly': return t('grid.readOnlyReason.objectReadOnly');
    case 'noPermission': return t('grid.readOnlyReason.noPermission');
    case 'approvalLocked': return t('grid.readOnlyReason.approvalLocked');
    case 'noRecordPermission': return t('grid.readOnlyReason.noRecordPermission');
  }
}

/** The grid-wide and row answers a cell's reason is read from. */
export interface CellReadOnlyInputs {
  /** The object's field definition for the column, when it has one. */
  fieldDef: { type?: unknown; readonly?: unknown } | null | undefined;
  /** May this reader write the field (`resolveFieldAffordance('listInlineEdit', …)`)? */
  fieldWritable: boolean;
  /** The authored `editable` the grid was handed (the list page folds `userActions.editInline` into it). */
  gridEditable: boolean;
  /** The object's own answer: lifecycle bucket, `userActions.edit` and the API operation set. */
  objectEditable: boolean;
  /** The reader's `update` grant on the object. */
  canUpdate: boolean;
  /** The record is held by an approval that locks it. */
  approvalLocked: boolean;
  /** The server's record-grained `update` verdict for this row; `undefined` while unknown. */
  recordUpdate: boolean | undefined;
}

/**
 * Why this cell opens no editor, or `null` when it opens one. A field's own
 * reason comes first (it holds on every row and in every view), then the
 * grid's, then the record's.
 */
export function cellReadOnlyKind(inputs: CellReadOnlyInputs): CellReadOnlyKind | null {
  const fieldKind = fieldInlineReadOnlyKind(inputs.fieldDef);
  if (fieldKind) return fieldKind;
  if (!inputs.fieldWritable) return 'noFieldPermission';
  if (!inputs.canUpdate) return 'noPermission';
  if (!inputs.objectEditable) return 'objectReadOnly';
  if (!inputs.gridEditable) return 'viewOff';
  if (inputs.approvalLocked) return 'approvalLocked';
  if (inputs.recordUpdate === false) return 'noRecordPermission';
  return null;
}

/** Field types a typed key writes into: the text replaces the value. */
const TYPED_FIELD_TYPES: ReadonlySet<string> = new Set([
  'text', 'textarea', 'email', 'url', 'phone', 'number', 'currency', 'percent',
]);

/** What typing on a cell of this field type does; `undefined` leaves it to the table. */
export function inlineTyping(fieldType: unknown): 'replace' | 'open' | undefined {
  if (typeof fieldType !== 'string') return undefined;
  return TYPED_FIELD_TYPES.has(fieldType) ? 'replace' : 'open';
}

const CHOICE_FIELD_TYPES: ReadonlySet<string> = new Set(['select', 'radio']);
const MULTI_CHOICE_FIELD_TYPES: ReadonlySet<string> = new Set(['multiselect', 'checkboxes', 'tags']);

/** The declared option a pasted word names, by value or by label, ignoring case. */
function optionOf(options: unknown, word: string): unknown {
  if (!Array.isArray(options)) return undefined;
  const wanted = word.trim().toLowerCase();
  if (wanted === '') return undefined;
  for (const option of options) {
    const value = option !== null && typeof option === 'object' ? (option as any).value : option;
    const label = option !== null && typeof option === 'object' ? (option as any).label : option;
    if (String(value).toLowerCase() === wanted || (typeof label === 'string' && label.toLowerCase() === wanted)) return value;
  }
  return undefined;
}

/**
 * The value pasted text stands for in a choice field: the option it names
 * (for a multi-choice field, every option of a comma-separated list), or
 * `undefined` when it names none, so nothing is written. `null` for a type
 * this answers nothing about: the table's own reading of the column applies.
 */
export function choiceFromText(
  fieldDef: { type?: unknown; options?: unknown } | null | undefined,
): ((text: string) => unknown) | null {
  const type = typeof fieldDef?.type === 'string' ? fieldDef.type : '';
  if (CHOICE_FIELD_TYPES.has(type)) return (text) => optionOf(fieldDef!.options, text.replace(/\r?\n$/, ''));
  if (MULTI_CHOICE_FIELD_TYPES.has(type)) {
    return (text) => {
      const words = text.split(/[,;\n]/).map((w) => w.trim()).filter(Boolean);
      const values = words.map((w) => optionOf(fieldDef!.options, w));
      return words.length > 0 && values.every((v) => v !== undefined) ? values : undefined;
    };
  }
  // A record reference holds an id, which pasted text is not.
  if (type === 'lookup' || type === 'master_detail' || type === 'user' || type === 'owner') return () => undefined;
  return null;
}

/**
 * Field types whose cell editor is a panel opened under the cell, which keeps
 * showing its value (objectstack#36023): a list to pick from, a calendar, a
 * clock, a palette. Typed input, long text and an address edit in place.
 */
const PANEL_EDITOR_FIELD_TYPES: ReadonlySet<string> = new Set([
  'select', 'status', 'radio', 'multiselect', 'checkboxes', 'tags',
  'date', 'datetime', 'time', 'color',
  'lookup', 'master_detail', 'user', 'owner',
]);

/** Where the cell editor of this field type draws; `undefined` leaves it to the table. */
export function inlineEditorPlacement(fieldType: unknown): 'below' | undefined {
  return typeof fieldType === 'string' && PANEL_EDITOR_FIELD_TYPES.has(fieldType) ? 'below' : undefined;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A value the cell holds nothing in: what Backspace writes and `required` refuses. */
export function isEmptyCellValue(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/** What a field's name reads as in a sentence about it. */
function fieldLabelOf(fieldDef: { label?: unknown; name?: unknown }, columnKey: string): string {
  return typeof fieldDef.label === 'string' && fieldDef.label !== '' ? fieldDef.label : columnKey;
}

/**
 * Why Backspace leaves this cell as it is: a required field is never cleared
 * (objectstack#36023). `null` when the cell may be cleared.
 */
export function clearRefusalText(
  fieldDef: Record<string, any> | null | undefined,
  columnKey: string,
  t: Translate,
): string | null {
  if (!fieldDef?.required) return null;
  return typeof fieldDef.required_message === 'string'
    ? fieldDef.required_message
    : t('validation.required', { field: fieldLabelOf(fieldDef, columnKey) });
}

/**
 * Why a value committed into a cell is refused before it is saved, by the
 * field's declared rules, or `null` (objectstack#36023). The rules are the
 * record form's own (`buildValidationRules`): required, length, range and
 * the email / URL shape, each said with the form's sentence. A rule other
 * than `required` does not judge an empty value.
 */
export function cellValueRefusal(
  fieldDef: Record<string, any> | null | undefined,
  columnKey: string,
  value: unknown,
  t: Translate,
): string | null {
  if (!fieldDef) return null;
  const rules = buildValidationRules(fieldDef);
  if (!rules) return null;
  const field = fieldLabelOf(fieldDef, columnKey);
  const said = (rule: any, interp: Record<string, unknown> = {}) =>
    typeof rule?.message === 'string' ? rule.message : t(rule?.messageKey ?? 'validation.pattern', { field, ...interp });
  if (isEmptyCellValue(value)) return clearRefusalText(fieldDef, columnKey, t);
  if (typeof value === 'string') {
    if (rules.minLength && value.length < rules.minLength.value) return said(rules.minLength, { min: rules.minLength.value });
    if (rules.maxLength && value.length > rules.maxLength.value) return said(rules.maxLength, { max: rules.maxLength.value });
    if (rules.pattern?.value instanceof RegExp && !rules.pattern.value.test(value)) return said(rules.pattern);
  }
  if (typeof value === 'number') {
    if (rules.min && value < rules.min.value) return said(rules.min, { min: rules.min.value });
    if (rules.max && value > rules.max.value) return said(rules.max, { max: rules.max.value });
  }
  return null;
}
