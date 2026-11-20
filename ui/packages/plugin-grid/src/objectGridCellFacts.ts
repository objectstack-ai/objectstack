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
